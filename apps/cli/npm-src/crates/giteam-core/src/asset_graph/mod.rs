//! 仓库记忆图谱：把会话/执行记录沉淀为可查询的 SQLite 属性图。
//!
//! 设计文档：`docs/repo-asset-graph-agent.md`。分层：
//! - [`store`]：SQLite schema + 幂等批量写入
//! - [`entity`]：语义实体身份（normalize → resolve → merge）
//! - [`extract`]：确定性抽取（live 事件 → 事实；不调 LLM）
//! - [`extraction`] / [`stage1`]：语义抽取（Codex 式：turn 入队，idle/startup 批处理）
//! - [`replay`]：存量会话 JSONL → 事实（与 live 同一套规则）
//! - [`query`]：检索/上下文构建（agent 工具与启动注入共用）
//!
//! 对外主入口 [`AssetGraph`]（每仓库一个实例，DB 在
//! `~/.giteam/memory/repos/<key>/memory.db`；旧版 `<repo>/.giteam/asset-graph.db`
//! 打开时自动迁入）与全局 [`on_event_published`]（由
//! `pi_agent::events::publish_event` 转发，失败静默——图谱绝不影响 agent 主流程）。

pub mod entity;
pub mod extract;
pub mod extraction;
pub mod query;
pub mod replay;
pub mod semantic;
pub mod stage1;
pub mod store;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use extract::SessionAccumulator;

/// 每仓库的图谱句柄：持有 SQLite 连接与 live 会话累积器。
pub struct AssetGraph {
    db: rusqlite::Connection,
    db_path: PathBuf,
    repo_path: PathBuf,
    /// (session_id, run_id) → 累积器。run 结束后清理（事实已落库）。
    live: HashMap<(String, String), SessionAccumulator>,
    /// 语义抽取宿主（PiAgentService 子代理）；None = 抽取禁用（纯过程层）。
    subagent_host: Option<std::sync::Arc<dyn crate::pi_agent::SubagentHost>>,
}

impl AssetGraph {
    /// 打开（或创建）仓库的记忆库（用户目录；必要时从仓库旁旧路径迁移）。
    pub fn open(repo_path: &Path) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        let db_path = resolve_memory_db_path(&canonical)?;
        let db = store::open(&db_path).map_err(|error| error.to_string())?;
        Ok(Self {
            db_path: db_path.clone(),
            db,
            repo_path: canonical,
            live: HashMap::new(),
            subagent_host: None,
        })
    }

    /// 注入子代理宿主（启用语义抽取）。
    pub fn with_subagent_host(
        mut self,
        host: std::sync::Arc<dyn crate::pi_agent::SubagentHost>,
    ) -> Self {
        self.subagent_host = Some(host);
        self
    }

    /// 存量回放：扫描该仓库的 pi-sessions 目录重建图谱（增量）。
    pub fn replay_backlog(&mut self) -> (usize, usize) {
        let sessions_dir = self.repo_sessions_dir();
        replay::replay_directory(&self.db, &self.repo_path.to_string_lossy(), &sessions_dir)
    }

    fn repo_sessions_dir(&self) -> PathBuf {
        // 对齐 pi_agent::secrets::pi_sessions_dir_for_repo（~/.giteam/pi-sessions/repos/<key>/），
        // 但也兼容仓库内 .giteam/pi-sessions（旧布局）。
        if let Some(dir) = crate::pi_agent::pi_sessions_dir_for_repo(&self.repo_path) {
            if dir.is_dir() {
                return dir;
            }
        }
        let legacy = self.repo_path.join(".giteam").join("pi-sessions");
        if legacy.is_dir() {
            return legacy;
        }
        // 都不存在时返回用户目录规范位置（replay_directory 对不存在目录返回 0）。
        crate::pi_agent::pi_sessions_dir_for_repo(&self.repo_path)
            .unwrap_or_else(|| legacy.clone())
    }

    /// live 事件入口：completed 级事件累积，turn/run 边界批量落库。
    pub fn ingest_live(&mut self, envelope: &crate::pi_agent::AgentEventEnvelope) {
        let key = (
            envelope.session_id.clone(),
            envelope.run_id.clone().unwrap_or_default(),
        );

        // Run 终态后会再收到 SessionStatusChanged(Idle/Failed/Aborted)。
        // 若走下面的 or_insert，会在 RunCompleted 刚 remove 之后又占位 live，
        // Stage-1 debounce 2s 后仍把该 session 当热路径排除 → pending 永不 claim。
        if matches!(
            &envelope.event,
            crate::pi_agent::AgentEvent::SessionStatusChanged {
                status:
                    crate::pi_agent::AgentSessionStatus::Idle
                    | crate::pi_agent::AgentSessionStatus::Failed
                    | crate::pi_agent::AgentSessionStatus::Aborted,
                ..
            }
        ) {
            self.live.remove(&key);
            if let Some(host) = current_extraction_host(&self.subagent_host) {
                stage1::schedule_idle_stage1(
                    host,
                    self.db_path.clone(),
                    self.repo_path.clone(),
                );
            }
            return;
        }

        let repo_path = self.repo_path.to_string_lossy().to_string();
        let acc = self
            .live
            .entry(key.clone())
            .or_insert_with(|| SessionAccumulator::new(&repo_path, &key.0, &key.1));
        let should_flush = acc.ingest(envelope);
        if should_flush {
            let batch = acc.take_batch();
            if let Err(error) = store::write_batch(&self.db, &batch) {
                eprintln!("[asset-graph] write batch failed: {error}");
            }
            // 语义抽取（Codex 式 Stage-1）：turn 边界只入队非真空内容，
            // **价值判定交给抽取 agent**（idle/startup 后跑）；热路径不调 LLM、不闪 UI。
            let is_turn_end =
                matches!(envelope.event, crate::pi_agent::AgentEvent::TurnCompleted { .. });
            let is_extraction_child = extraction::is_extract_session(&key.0);
            if is_turn_end && !is_extraction_child {
                let mut input =
                    acc.take_extraction_input(envelope.timestamp_ms, envelope.sequence);
                if input.repo_path.is_empty() {
                    input.repo_path = self.repo_path.to_string_lossy().to_string();
                }
                if let Some(host) = current_extraction_host(&self.subagent_host) {
                    if let Some(snap) = host.extraction_parent_snapshot(&input.session_id) {
                        if input.provider.is_none() {
                            input.provider = snap.provider;
                        }
                        if input.model.is_none() {
                            input.model = snap.model;
                        }
                        if input.thinking.is_none() {
                            input.thinking = snap.thinking;
                        }
                    }
                }
                if input.should_enqueue() {
                    if let Err(error) = stage1::enqueue_job(&self.db, &input) {
                        eprintln!("[asset-graph] enqueue extraction job failed: {error}");
                    }
                }
            }
            if matches!(
                envelope.event,
                crate::pi_agent::AgentEvent::RunCompleted
                    | crate::pi_agent::AgentEvent::RunFailed { .. }
            ) {
                // 同一 session 串行 run；终态时清掉该会话全部 live 占位（防御 run_id 偏差）。
                self.live
                    .retain(|(session_id, _), _| session_id != &envelope.session_id);
                // Run 结束后 debounce Stage-1（排除仍 live 的会话）。
                if let Some(host) = current_extraction_host(&self.subagent_host) {
                    stage1::schedule_idle_stage1(
                        host,
                        self.db_path.clone(),
                        self.repo_path.clone(),
                    );
                }
            }
        }
    }

    /// 当前仍有 live 累积器的 session_id（Stage-1 排除热路径）。
    #[must_use]
    pub fn live_session_keys(&self) -> Vec<(String, String)> {
        self.live.keys().cloned().collect()
    }

    /// 语义抽取宿主（重建时保留注入用）。
    #[must_use]
    pub fn subagent_host(&self) -> Option<std::sync::Arc<dyn crate::pi_agent::SubagentHost>> {
        self.subagent_host.clone()
    }

    /// 查询句柄（只读借用）。
    #[must_use]
    pub fn query(&self) -> query::GraphQuery<'_> {
        query::GraphQuery::new(&self.db)
    }

    /// 数据库连接（Control HTTP 端点等内部使用）。
    #[must_use]
    pub fn connection(&self) -> &rusqlite::Connection {
        &self.db
    }

    /// 当前记忆库落盘路径（用户目录）。
    #[must_use]
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }
}

/// 解析记忆库路径：优先 `~/.giteam/memory/...`；若仅有仓库旁旧库则迁入。
fn resolve_memory_db_path(repo_path: &Path) -> Result<PathBuf, String> {
    let target = crate::pi_agent::memory_db_path_for_repo(repo_path).ok_or_else(|| {
        "cannot resolve Giteam data directory (~/.giteam or $GITEAM_HOME)".to_string()
    })?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create memory dir failed: {e}"))?;
    }
    let legacy = crate::pi_agent::legacy_repo_memory_db_path(repo_path);
    if !target.exists() && legacy.is_file() {
        migrate_sqlite_bundle(&legacy, &target)?;
        eprintln!(
            "[asset-graph] migrated memory db {} → {}",
            legacy.display(),
            target.display()
        );
    }
    Ok(target)
}

/// 迁移 SQLite 主库及 WAL/SHM 旁路文件（存在才搬）。
fn migrate_sqlite_bundle(from_db: &Path, to_db: &Path) -> Result<(), String> {
    if let Some(parent) = to_db.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let suffixes = ["", "-wal", "-shm"];
    for suffix in suffixes {
        let from = PathBuf::from(format!("{}{suffix}", from_db.display()));
        if !from.is_file() {
            continue;
        }
        let to = PathBuf::from(format!("{}{suffix}", to_db.display()));
        if to.exists() {
            continue;
        }
        if std::fs::rename(&from, &to).is_err() {
            std::fs::copy(&from, &to).map_err(|e| format!("copy {} failed: {e}", from.display()))?;
            let _ = std::fs::remove_file(&from);
        }
    }
    Ok(())
}

// ---------- 全局挂载：publish_event → 图谱（失败静默） ----------

type GraphMap = Arc<Mutex<HashMap<PathBuf, Arc<Mutex<AssetGraph>>>>>;

/// 全局抽取宿主注册表：service 启动时登记，图谱实例挂载晚于/早于 service
/// 都不再影响抽取可用性（挂载时机不该决定 host 注入）。
fn extraction_host() -> &'static Mutex<Option<std::sync::Arc<dyn crate::pi_agent::SubagentHost>>> {
    static HOST: OnceLock<Mutex<Option<std::sync::Arc<dyn crate::pi_agent::SubagentHost>>>> =
        OnceLock::new();
    HOST.get_or_init(|| Mutex::new(None))
}

/// 登记/替换全局抽取宿主（PiAgentService 单例启动时调用），并 kick 已挂载仓库的 Stage-1。
pub fn set_extraction_host(host: std::sync::Arc<dyn crate::pi_agent::SubagentHost>) {
    if let Ok(mut slot) = extraction_host().lock() {
        *slot = Some(host.clone());
    }
    // 宿主后挂上时，消化此前堆积的 pending。
    let attached_repos: Vec<(PathBuf, PathBuf)> = graphs()
        .lock()
        .ok()
        .map(|map| {
            map.values()
                .filter_map(|graph| {
                    let g = graph.lock().ok()?;
                    Some((g.db_path().to_path_buf(), g.repo_path.clone()))
                })
                .collect()
        })
        .unwrap_or_default();
    for (db_path, repo_path) in attached_repos {
        stage1::kick_stage1(host.clone(), db_path, repo_path, stage1::Stage1Trigger::Startup);
    }
}

/// 当前可用的抽取宿主：实例级注入优先，回落全局注册表。
fn current_extraction_host(
    instance_host: &Option<std::sync::Arc<dyn crate::pi_agent::SubagentHost>>,
) -> Option<std::sync::Arc<dyn crate::pi_agent::SubagentHost>> {
    instance_host
        .clone()
        .or_else(|| extraction_host().lock().ok().and_then(|slot| slot.clone()))
}

fn graphs() -> &'static GraphMap {
    static GRAPHS: OnceLock<GraphMap> = OnceLock::new();
    GRAPHS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// 挂载（或替换）一个仓库的图谱实例。Desktop/CLI 启动会话时调用。
pub fn attach(graph: AssetGraph) {
    let repo = graph.repo_path.clone();
    let graph = Arc::new(Mutex::new(graph));
    if let Ok(mut graphs) = graphs().lock() {
        graphs.insert(repo, graph);
    }
}

/// 卸载仓库的图谱实例。
pub fn detach(repo_path: &Path) {
    let canonical = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
    if let Ok(mut graphs) = graphs().lock() {
        graphs.remove(&canonical);
    }
}

/// 便捷构造：打开 + 回放存量 + 挂载，一步完成（无语义抽取）。
pub fn attach_repo(repo_path: &Path) -> Result<(usize, usize), String> {
    let mut graph = AssetGraph::open(repo_path)?;
    let stats = graph.replay_backlog();
    attach(graph);
    Ok(stats)
}

/// 同 [`attach_repo`]，但注入子代理宿主启用 Stage-1 语义抽取，并 kick startup 扫描。
pub fn attach_repo_with_extraction(
    repo_path: &Path,
    host: std::sync::Arc<dyn crate::pi_agent::SubagentHost>,
) -> Result<(usize, usize), String> {
    let mut graph = AssetGraph::open(repo_path)?.with_subagent_host(host.clone());
    let stats = graph.replay_backlog();
    let db_path = graph.db_path().to_path_buf();
    let repo = graph.repo_path.clone();
    attach(graph);
    // Codex：挂载/新会话启动时消化跨会话 pending backlog（排除 live session）。
    stage1::kick_stage1(host, db_path, repo, stage1::Stage1Trigger::Startup);
    Ok(stats)
}

/// 重新挂载（重建索引用）：保留已挂载实例的抽取宿主——直接 attach_repo
/// 会把带 host 的实例换成裸实例，语义抽取在第一次重建后静默停止。
pub fn reattach_repo(repo_path: &Path) -> Result<(usize, usize), String> {
    let host = attached(repo_path)
        .and_then(|graph| graph.lock().ok().and_then(|g| g.subagent_host()));
    let mut graph = AssetGraph::open(repo_path)?;
    let db_path = graph.db_path().to_path_buf();
    let repo = graph.repo_path.clone();
    if let Some(host) = host.clone() {
        graph = graph.with_subagent_host(host);
    }
    let stats = graph.replay_backlog();
    attach(graph);
    if let Some(host) = host {
        stage1::kick_stage1(host, db_path, repo, stage1::Stage1Trigger::Startup);
    }
    Ok(stats)
}

/// `pi_agent::events::publish_event` 的转发入口。任何失败（含 panic）静默：
/// 图谱是旁路消费者，绝不影响 agent 主流程（设计文档 §7 失败隔离）。
pub fn on_event_published(envelope: &crate::pi_agent::AgentEventEnvelope) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // 旁路抽取 ephemeral session 只产出语义 JSON，过程层 message 会污染
        // FTS/search（"Extract semantic entities…"）；语义结果已由 write_batch 写入。
        if extraction::is_extract_session(&envelope.session_id) {
            return;
        }
        let repo = PathBuf::from(&envelope.repo_path);
        let canonical = std::fs::canonicalize(&repo).unwrap_or(repo);
        let graph = {
            let Ok(graphs) = graphs().lock() else { return };
            let Some(graph) = graphs.get(&canonical) else { return };
            Arc::clone(graph)
        };
        let guard = graph.lock();
        if let Ok(mut graph) = guard {
            graph.ingest_live(envelope);
        }
    }));
    if result.is_err() {
        eprintln!("[asset-graph] live ingest panicked (isolated)");
    }
}

/// 读取某仓库已挂载的图谱（供 Control HTTP 端点使用）。
pub fn attached(repo_path: &Path) -> Option<Arc<Mutex<AssetGraph>>> {
    let canonical = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
    graphs().lock().ok().and_then(|g| g.get(&canonical).cloned())
}

/// 抽取队列摘要：优先读已挂载实例；未挂载时直接打开记忆库（只读轮询，不创建目录）。
#[must_use]
pub fn extraction_queue_summary(repo_path: &Path) -> stage1::ExtractionQueueSummary {
    let empty = stage1::ExtractionQueueSummary {
        pending: 0,
        claimed: 0,
        updated_at_ms: 0,
    };
    if let Some(graph) = attached(repo_path) {
        if let Ok(graph) = graph.lock() {
            if let Ok(summary) = stage1::queue_summary(graph.connection()) {
                return summary;
            }
        }
    }
    let Some(db_path) = crate::pi_agent::memory_db_path_for_repo(repo_path) else {
        return empty;
    };
    if !db_path.is_file() {
        return empty;
    }
    let Ok(db) = store::open(&db_path) else {
        return empty;
    };
    stage1::queue_summary(&db).unwrap_or(empty)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_agent::{AgentEvent, AgentEventEnvelope};
    use crate::pi_agent::{AgentMessage, AgentPart, AgentRole};

    fn user_event(sequence: u64, id: &str, text: &str) -> AgentEventEnvelope {
        AgentEventEnvelope {
            schema_version: 1,
            event_id: format!("e{sequence}"),
            sequence,
            repo_path: String::new(),
            session_id: "sess-live".into(),
            run_id: Some("run-live".into()),
            timestamp_ms: sequence * 1000,
            event: AgentEvent::MessageCompleted {
                message: AgentMessage {
                    id: id.into(),
                    role: AgentRole::User,
                    created_at_ms: sequence * 1000,
                    parts: vec![AgentPart::Text { text: text.into() }],
                },
            },
        }
    }

    fn live_session(repo: &Path) -> Vec<AgentEventEnvelope> {
        vec![
            AgentEventEnvelope {
                schema_version: 1,
                event_id: "e0".into(),
                sequence: 0,
                repo_path: repo.to_string_lossy().to_string(),
                session_id: "sess-live".into(),
                run_id: Some("run-live".into()),
                timestamp_ms: 1,
                event: AgentEvent::TurnStarted { index: 0 },
            },
            {
                let mut env = user_event(1, "m1", "重构登录模块");
                env.repo_path = repo.to_string_lossy().to_string();
                env
            },
            AgentEventEnvelope {
                schema_version: 1,
                event_id: "e2".into(),
                sequence: 2,
                repo_path: repo.to_string_lossy().to_string(),
                session_id: "sess-live".into(),
                run_id: Some("run-live".into()),
                timestamp_ms: 3_000,
                event: AgentEvent::ToolStarted {
                    tool_call_id: "tc1".into(),
                    tool_name: "edit".into(),
                    input: serde_json::json!({"file_path": "src/login.rs"}),
                },
            },
            AgentEventEnvelope {
                schema_version: 1,
                event_id: "e3".into(),
                sequence: 3,
                repo_path: repo.to_string_lossy().to_string(),
                session_id: "sess-live".into(),
                run_id: Some("run-live".into()),
                timestamp_ms: 4_000,
                event: AgentEvent::ToolCompleted {
                    tool_call_id: "tc1".into(),
                    tool_name: "edit".into(),
                    output: serde_json::json!("ok"),
                    is_error: false,
                },
            },
            AgentEventEnvelope {
                schema_version: 1,
                event_id: "e4".into(),
                sequence: 4,
                repo_path: repo.to_string_lossy().to_string(),
                session_id: "sess-live".into(),
                run_id: Some("run-live".into()),
                timestamp_ms: 5_000,
                event: AgentEvent::TurnCompleted { index: 0 },
            },
        ]
    }

    #[test]
    fn live_events_flow_into_graph() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("giteam-home");
        std::fs::create_dir_all(&home).unwrap();
        // 测试隔离：记忆库落到临时 GITEAM_HOME，不污染真实 ~/.giteam。
        std::env::set_var("GITEAM_HOME", &home);
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let mut graph = AssetGraph::open(&repo).unwrap();
        assert!(
            graph.db_path().starts_with(&home.join("memory")),
            "db should live under GITEAM_HOME/memory, got {}",
            graph.db_path().display()
        );
        for env in live_session(&repo) {
            graph.ingest_live(&env);
        }
        let counts = graph.query().counts();
        assert!(counts.sessions >= 1, "{counts:?}");
        assert!(counts.files >= 1, "{counts:?}");
        assert!(counts.tool_calls >= 1, "{counts:?}");
        assert!(counts.edges >= 4, "{counts:?}");
        // 未闭环意图可查。
        let summary = graph
            .query()
            .recent_sessions(10)
            .into_iter()
            .find(|s| s.session_label.contains("重构登录模块"));
        assert!(summary.is_some(), "intent not found");
    }

    #[test]
    fn idle_status_after_run_completed_does_not_leak_live_session() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let mut graph = AssetGraph::open(&repo).unwrap();
        let repo_str = repo.to_string_lossy().to_string();

        for env in live_session(&repo) {
            graph.ingest_live(&env);
        }
        assert!(!graph.live_session_keys().is_empty());

        graph.ingest_live(&AgentEventEnvelope {
            schema_version: 1,
            event_id: "e-run-done".into(),
            sequence: 10,
            repo_path: repo_str.clone(),
            session_id: "sess-live".into(),
            run_id: Some("run-live".into()),
            timestamp_ms: 10_000,
            event: AgentEvent::RunCompleted,
        });
        assert!(
            graph.live_session_keys().is_empty(),
            "RunCompleted should clear live"
        );

        // 模拟 service 在 RunCompleted 之后发出的 Idle（此前会 or_insert 泄漏）。
        graph.ingest_live(&AgentEventEnvelope {
            schema_version: 1,
            event_id: "e-idle".into(),
            sequence: 11,
            repo_path: repo_str,
            session_id: "sess-live".into(),
            run_id: Some("run-live".into()),
            timestamp_ms: 10_500,
            event: AgentEvent::SessionStatusChanged {
                status: crate::pi_agent::AgentSessionStatus::Idle,
                error: None,
            },
        });
        assert!(
            graph.live_session_keys().is_empty(),
            "Idle must not re-register live accumulator"
        );
        assert!(
            stage1::live_session_ids_for_repo(&repo).is_empty(),
            "Stage-1 exclude set must stay empty"
        );
    }

    #[test]
    fn migrates_legacy_repo_db_into_user_dir() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("giteam-home");
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("GITEAM_HOME", &home);
        let repo = dir.path().join("repo");
        let legacy_dir = repo.join(".giteam");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        let legacy = legacy_dir.join("asset-graph.db");
        // 先按旧路径写一库，再 open 触发迁移。
        {
            let db = store::open(&legacy).unwrap();
            store::write_batch(
                &db,
                &store::FactBatch {
                    nodes: vec![store::NodeFact {
                        node_type: "session",
                        key: "session:migrate".into(),
                        label: "migrated".into(),
                        props: serde_json::json!({}),
                        timestamp_ms: 1,
                    }],
                    edges: vec![],
                },
            )
            .unwrap();
        }
        let graph = AssetGraph::open(&repo).unwrap();
        assert!(graph.db_path().starts_with(&home.join("memory")));
        assert!(!legacy.exists(), "legacy db should be moved");
        let count: i64 = graph
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM nodes WHERE key = 'session:migrate'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn global_hook_is_silent_and_routed() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("giteam-home");
        std::fs::create_dir_all(&home).unwrap();
        std::env::set_var("GITEAM_HOME", &home);
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        attach_repo(&repo).unwrap();
        for env in live_session(&repo) {
            on_event_published(&env);
        }
        let graph = attached(&repo).expect("attached");
        let counts = graph.lock().unwrap().query().counts();
        assert!(counts.sessions >= 1 && counts.files >= 1, "{counts:?}");
        detach(&repo);
        assert!(attached(&repo).is_none());

        // 未挂载仓库的事件：静默不炸。
        let mut stray = user_event(9, "mx", "stray");
        stray.repo_path = "/definitely/not/mounted".into();
        on_event_published(&stray);
    }
}

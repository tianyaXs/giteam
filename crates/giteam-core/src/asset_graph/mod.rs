//! 仓库记忆图谱：把会话/执行记录沉淀为可查询的 SQLite 属性图。
//!
//! 设计文档：`docs/repo-asset-graph-agent.md`。分层：
//! - [`store`]：SQLite schema + 幂等批量写入
//! - [`extract`]：确定性抽取（live 事件 → 事实；不调 LLM）
//! - [`replay`]：存量会话 JSONL → 事实（与 live 同一套规则）
//! - [`query`]：检索/上下文构建（agent 工具与启动注入共用）
//!
//! 对外主入口 [`AssetGraph`]（每仓库一个实例，DB 在
//! `~/.giteam/memory/repos/<key>/memory.db`；旧版 `<repo>/.giteam/asset-graph.db`
//! 打开时自动迁入）与全局 [`on_event_published`]（由
//! `pi_agent::events::publish_event` 转发，失败静默——图谱绝不影响 agent 主流程）。

pub mod extract;
pub mod extraction;
pub mod query;
pub mod replay;
pub mod semantic;
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
            // 语义抽取（M4）：turn 边界异步跑 extract 子代理，fire-and-forget。
            // 抽取子代理自身的事件（session 以 asset-graph-extract 前缀标识的
            // parent_tool_call_id）不再触发抽取，防自递归。
            let is_turn_end =
                matches!(envelope.event, crate::pi_agent::AgentEvent::TurnCompleted { .. });
            let is_extraction_child = extraction::is_extract_session(&key.0);
            if is_turn_end && !is_extraction_child {
                let input = acc.take_extraction_input(envelope.timestamp_ms, envelope.sequence);
                // 先确认 host 再 claim turn：无宿主时不登记，避免宿主后补挂上
                // 的事件重放因空 claim 永久跳过抽取。
                if input.worth_extracting() {
                    // host 解析：实例注入优先，回落全局注册表——图谱可能由面板
                    // rebuild 等路径先于 service 挂载（无 host），不能因此跳过抽取。
                    if let Some(host) = current_extraction_host(&self.subagent_host) {
                        // turn 去重：同一 turn（事件重放/乱序）只触发一次抽取调用。
                        let turn_claimed = input
                            .turn_key
                            .as_deref()
                            .map(extraction::claim_turn_extraction)
                            .unwrap_or(false);
                        if turn_claimed {
                            extraction::spawn_extraction(host, input, self.db_path.clone());
                        }
                    } else {
                        // 挂载时未注入宿主（旧实例/重建冲掉）——这是接线问题，
                        // 必须可见，否则语义层静默缺失。
                        eprintln!(
                            "[asset-graph] extraction skipped: no subagent host (session {})",
                            key.0
                        );
                    }
                }
            }
            if matches!(
                envelope.event,
                crate::pi_agent::AgentEvent::RunCompleted
                    | crate::pi_agent::AgentEvent::RunFailed { .. }
            ) {
                self.live.remove(&key);
            }
        }
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

/// 登记/替换全局抽取宿主（PiAgentService 单例启动时调用）。
pub fn set_extraction_host(host: std::sync::Arc<dyn crate::pi_agent::SubagentHost>) {
    if let Ok(mut slot) = extraction_host().lock() {
        *slot = Some(host);
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

/// 同 [`attach_repo`]，但注入子代理宿主启用 turn 级语义抽取。
pub fn attach_repo_with_extraction(
    repo_path: &Path,
    host: std::sync::Arc<dyn crate::pi_agent::SubagentHost>,
) -> Result<(usize, usize), String> {
    let mut graph = AssetGraph::open(repo_path)?.with_subagent_host(host);
    let stats = graph.replay_backlog();
    attach(graph);
    Ok(stats)
}

/// 重新挂载（重建索引用）：保留已挂载实例的抽取宿主——直接 attach_repo
/// 会把带 host 的实例换成裸实例，语义抽取在第一次重建后静默停止。
pub fn reattach_repo(repo_path: &Path) -> Result<(usize, usize), String> {
    let host = attached(repo_path)
        .and_then(|graph| graph.lock().ok().and_then(|g| g.subagent_host()));
    let mut graph = AssetGraph::open(repo_path)?;
    if let Some(host) = host {
        graph = graph.with_subagent_host(host);
    }
    let stats = graph.replay_backlog();
    attach(graph);
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

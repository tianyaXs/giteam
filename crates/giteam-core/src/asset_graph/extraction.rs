//! 语义抽取管道：turn 完成后异步旁路 completion，把实体/关系写进图谱。
//!
//! 流程（设计文档 §3 第二版 / M4 的落地）：
//! 1. `ExtractionInput` 在 turn flush 时从累积器收集：用户意图 + 助手结论
//!    + 工具动作摘要（edit 的文件 / bash 的命令 / 错误首行）——不喂原始
//!    工具输出，控制 token 成本。
//! 2. `spawn_extraction` 组装 prompt（注入图中已有实体以保 slug 稳定），经
//!    `SubagentHost::run_extraction_completion` 起 **ephemeral 无工具** 一次
//!    LLM 调用（非完整子代理会话）；经 `MemoryExtractionPublisher` 发
//!    `memory.extraction.*` 供 UI。
//! 3. 完成后 `parse_extraction` 解析 summary JSON → `write_batch` 入图。
//!    任何失败（JSON 坏 / host 无 / 超时）不阻断主流程（§7 失败隔离），
//!    但会发 `memory.extraction.failed`。
//!
//! 幂等：turn 节点 props 标 `semExtracted`，回放/重复 flush 不重抽。
//! 抽取质量：同一 EXTRACT_ROLE_RULES、父会话同模型；slug 稳定靠 known-entities 注入。

use serde_json::Value;

use super::semantic::{self, ExtractionAnchors};
use super::store;
use crate::pi_agent::{ExtractionCompletionRequest, SubagentHost};

/// 单次抽取的输入（turn 级摘要）。
#[derive(Debug, Clone, Default)]
pub struct ExtractionInput {
    pub session_id: String,
    pub run_id: String,
    pub turn_key: Option<String>,
    pub session_key: String,
    /// 本轮用户消息文本（意图）。
    pub user_text: String,
    /// 本轮助手结论文本。
    pub assistant_text: String,
    /// (相对路径, file 节点 key)：本轮读过/改过的文件。
    pub file_keys: Vec<(String, String)>,
    /// 本轮执行过的命令（归一化，去重）。
    pub commands: Vec<String>,
    /// 本轮错误首行。
    pub error_lines: Vec<String>,
    pub timestamp_ms: u64,
    pub sequence: u64,
}

impl ExtractionInput {
    /// 无语义价值的内容直接跳过（空 turn / 纯寒暄），省一次 LLM 调用。
    /// 短用户消息（"继续"/"好" 等 steer）本身不够格，但助手有实质产出或
    /// 动了文件时仍值得抽——否则多轮 steer 会话的语义层会大面积缺失。
    #[must_use]
    pub fn worth_extracting(&self) -> bool {
        let has_content = !self.user_text.trim().is_empty()
            || !self.assistant_text.trim().is_empty()
            || !self.file_keys.is_empty();
        if !has_content {
            return false;
        }
        if self.user_text.trim().chars().count() > 4 {
            return true;
        }
        self.assistant_text.trim().chars().count() > 40 || !self.file_keys.is_empty()
    }

    /// 组装抽取 prompt（附实体边界由系统提示承载，此处只给数据）。
    /// `known_entities` 为图中已有语义实体（`type\tid\ttitle` 行），用于 slug 复用。
    #[must_use]
    pub fn build_prompt(&self, known_entities: &[String]) -> String {
        let mut lines = vec![
            "Extract semantic entities and relations from this coding-agent turn. Reply with the JSON object only.".to_string(),
            String::new(),
            "## User intent".to_string(),
            snippet(&self.user_text, 1200),
        ];
        if !self.assistant_text.trim().is_empty() {
            lines.push("\n## Assistant conclusion".to_string());
            lines.push(snippet(&self.assistant_text, 1500));
        }
        if !self.file_keys.is_empty() {
            lines.push("\n## Files touched (repo-relative paths usable as relation endpoints)".to_string());
            let paths: Vec<String> =
                self.file_keys.iter().map(|(p, _)| p.clone()).take(15).collect();
            lines.push(paths.join("\n"));
        }
        if !self.commands.is_empty() {
            lines.push("\n## Commands executed".to_string());
            let cmds: Vec<String> = self.commands.iter().take(12).cloned().collect();
            lines.push(cmds.join("\n"));
        }
        if !self.error_lines.is_empty() {
            lines.push("\n## Errors encountered (first lines)".to_string());
            let errs: Vec<String> = self.error_lines.iter().take(6).cloned().collect();
            lines.push(errs.join("\n"));
        }
        if !known_entities.is_empty() {
            lines.push(
                "\n## Existing entities (REUSE these ids when the same concept appears; do not invent parallel slugs)"
                    .to_string(),
            );
            lines.push(known_entities.iter().take(40).cloned().collect::<Vec<_>>().join("\n"));
        }
        lines.push(
            "\nRemember: entity types decision/feature/module/tech_concept/error_pattern/api/tradeoff/open_task; \
             relation subjects/objects may be entity slugs, the file paths above, or \"session\". \
             Every entity needs a human-readable title (never the slug) and every entity/relation \
             must carry \"confidence\" (0.0-1.0) and \"evidence\" \
             (a verbatim quote copied exactly from the text above, <= 100 chars). \
             Prefer dense relations (decided/rationale/implements/located_in/affects/pattern_of). \
             Also output a top-level \"session_intent\": one concise line (<= 40 chars, same \
             language as the user) distilling what the user wants in this turn — resolve \
             shorthand like \"继续\" using the context, never copy the raw message."
                .to_string(),
        );
        lines.join("\n")
    }

    /// 构建语义锚点。
    #[must_use]
    pub fn anchors(&self) -> ExtractionAnchors {
        ExtractionAnchors {
            session_key: self.session_key.clone(),
            turn_key: self.turn_key.clone(),
            file_keys: self.file_keys.clone(),
            timestamp_ms: self.timestamp_ms,
            session_id: self.session_id.clone(),
            run_id: self.run_id.clone(),
            sequence: self.sequence,
            event_id: format!("extract-{}-{}", self.session_id, self.sequence),
            // evidence 校验基准 = 模型实际看到的文本（与 build_prompt 同一套截断）。
            source_text: format!(
                "{}\n{}",
                snippet(&self.user_text, 1200),
                snippet(&self.assistant_text, 1500)
            ),
        }
    }
}

// ---------- 防自递归注册表 ----------
// extract 子代理自身的事件流也会经 publish_event 进图（过程层数据照收，
// 有价值），但它的 turn 完成不得再触发抽取——否则指数爆炸。
// run_subagent 创建 extract 子会话时注册 session id，ingest_live 查询。

/// 已触发抽取的 turn key 集合（in-flight 去重）：turn flush 与 run 结束
/// 之间事件重放/乱序时，同一 turn 只触发一次抽取调用（token 不白花；
/// 落库本身幂等，这层只省调用）。容量上限防泄漏。
fn triggered_turns() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static TURNS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    TURNS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// 登记该 turn 的抽取：首次登记（应触发）返回 true；已登记过（重放/乱序
/// 导致的重复触发）返回 false。容量超限时淘汰旧条目（落库幂等兜底，
/// 最坏情况是多花一次调用，不会重复写）。
#[must_use]
pub fn claim_turn_extraction(turn_key: &str) -> bool {
    let Ok(mut set) = triggered_turns().lock() else {
        return true; // 锁异常：宁可跳过，不重复花钱
    };
    if set.len() > 512 {
        let drop: Vec<String> = set.iter().take(256).cloned().collect();
        for key in drop {
            set.remove(&key);
        }
    }
    set.insert(turn_key.to_string())
}

fn extract_sessions() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SESSIONS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    SESSIONS.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// 注册一个 extract 子代理的 session id（service.rs 创建子会话时调用）。
pub fn register_extract_session(session_id: &str) {
    if let Ok(mut set) = extract_sessions().lock() {
        set.insert(session_id.to_string());
        // 防泄漏：只保留最近 64 个（抽取会话是一次性的）。
        if set.len() > 64 {
            let oldest: Vec<String> = set.iter().take(set.len() - 64).cloned().collect();
            for id in oldest {
                set.remove(&id);
            }
        }
    }
}

/// 该 session 是否为 extract 子代理。
#[must_use]
pub fn is_extract_session(session_id: &str) -> bool {
    extract_sessions().lock().map(|set| set.contains(session_id)).unwrap_or(false)
}

/// 异步发起旁路抽取 completion → 解析 → 入图。
/// 返回 join handle 供测试等待；生产路径 fire-and-forget。
/// 可观测性：每个失败分支和最终结果都记 stderr（失败隔离 = 不影响主流程，
/// 不等于无迹可查）；空批次也打 semExtracted 标——「跑过但无产出」与
/// 「从未触发」必须在库里可区分。
pub fn spawn_extraction(
    host: std::sync::Arc<dyn SubagentHost>,
    input: ExtractionInput,
    db_path: std::path::PathBuf,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let extraction_id = format!("asset-graph-extract-{}", input.sequence);
        let publisher = host.memory_extraction_publisher(&input.session_id, &extraction_id);
        if let Some(pubber) = &publisher {
            pubber.started();
        }
        let started = std::time::Instant::now();
        let known = load_known_entities(&db_path);
        let request = ExtractionCompletionRequest {
            parent_session_id: input.session_id.clone(),
            extraction_id: extraction_id.clone(),
            prompt: input.build_prompt(&known),
        };
        let result = match host.run_extraction_completion(request).await {
            Ok(result) => result,
            Err(error) => {
                eprintln!(
                    "[asset-graph] extraction completion failed (session {}): {error}",
                    input.session_id
                );
                if let Some(pubber) = &publisher {
                    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
                    pubber.failed(error.to_string(), elapsed_ms);
                }
                return;
            }
        };
        let anchors = input.anchors();
        let extraction = semantic::parse_extraction(&result.summary, &anchors);
        let db = match store::open(&db_path) {
            Ok(db) => db,
            Err(error) => {
                eprintln!("[asset-graph] extraction db open failed: {error}");
                if let Some(pubber) = &publisher {
                    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
                    pubber.failed(format!("db open failed: {error}"), elapsed_ms);
                }
                return;
            }
        };
        if !extraction.batch.is_empty() {
            if let Err(error) = store::write_batch(&db, &extraction.batch) {
                eprintln!("[asset-graph] extraction write failed: {error}");
                if let Some(pubber) = &publisher {
                    let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
                    pubber.failed(format!("write failed: {error}"), elapsed_ms);
                }
                return;
            }
        }
        mark_turn_extracted(&db, input.turn_key.as_deref());
        if let Some(intent) = &extraction.intent {
            let _ = db.execute(
                "UPDATE nodes SET props = json_set(props, '$.intent', ?1)
                 WHERE key = ?2 AND type = 'session'",
                rusqlite::params![intent, anchors.session_key],
            );
        }
        let elapsed_ms = started
            .elapsed()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
            .max(result.elapsed_ms);
        if let Some(pubber) = &publisher {
            let entities = extraction
                .entity_summaries
                .iter()
                .map(|(etype, title)| crate::pi_agent::MemoryExtractionEntity {
                    entity_type: etype.clone(),
                    title: title.clone(),
                })
                .collect();
            pubber.completed(
                extraction.entity_count as u32,
                extraction.relation_count as u32,
                extraction.intent.clone(),
                entities,
                elapsed_ms,
            );
        }
        eprintln!(
            "[asset-graph] semantic extraction: +{} entities, +{} relations (session {})",
            extraction.entity_count, extraction.relation_count, input.session_id
        );
    })
}

/// 从图中读取近期语义实体，格式 `type\tslug\ttitle`，供 prompt 复用 id。
fn load_known_entities(db_path: &std::path::Path) -> Vec<String> {
    let Ok(db) = store::open(db_path) else {
        return Vec::new();
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT type, key, label FROM nodes
         WHERE key LIKE 'sem:%'
         ORDER BY last_seen_ms DESC
         LIMIT 40",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        let etype: String = row.get(0)?;
        let key: String = row.get(1)?;
        let label: String = row.get(2)?;
        Ok((etype, key, label))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for row in rows.flatten() {
        let (etype, key, label) = row;
        // key = sem:{type}:{slug} → 取 slug
        let slug = key
            .strip_prefix("sem:")
            .and_then(|rest| rest.split_once(':'))
            .map(|(_, slug)| slug)
            .unwrap_or(key.as_str());
        let title = if label.trim().is_empty() {
            slug.to_string()
        } else {
            label
        };
        out.push(format!("{etype}\t{slug}\t{title}"));
    }
    out
}

/// turn 节点打 `semExtracted` 标记（幂等：回放不重抽）。
fn mark_turn_extracted(db: &rusqlite::Connection, turn_key: Option<&str>) {
    let Some(key) = turn_key else { return };
    let _ = db.execute(
        "UPDATE nodes SET props = json_set(props, '$.semExtracted', json('true'))
         WHERE key = ?1 AND type = 'turn'",
        [key],
    );
}

/// turn 是否已抽过（回放增量判断用）。
#[must_use]
pub fn turn_already_extracted(db: &rusqlite::Connection, turn_key: &str) -> bool {
    db.query_row(
        "SELECT json_extract(props, '$.semExtracted') FROM nodes
         WHERE key = ?1 AND type = 'turn'",
        [turn_key],
        |row| row.get::<_, Option<bool>>(0),
    )
    .ok()
    .flatten()
    .unwrap_or(false)
}

fn snippet(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

/// 从 Value 工具入参提取文件相对路径（extraction input 收集用，与 extract.rs 的
/// extract_paths_from_input 保持同一套工具名单）。
#[must_use]
pub fn file_paths_from_input(tool_name: &str, input: &Value) -> Vec<String> {
    if !matches!(tool_name, "edit" | "write" | "read" | "multiedit" | "create" | "ls") {
        return Vec::new();
    }
    for field in ["file_path", "path", "notebook_path"] {
        if let Some(path) = input.get(field).and_then(Value::as_str) {
            if !path.trim().is_empty() {
                return vec![path.to_string()];
            }
            break;
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ExtractionInput {
        ExtractionInput {
            session_id: "sess-1".into(),
            run_id: "run-1".into(),
            turn_key: Some("turn:k".into()),
            session_key: "session:k".into(),
            user_text: "用 SQLite 存资产图谱，别上 Neo4j，我们要零运维".into(),
            assistant_text: "已决定采用 rusqlite + 属性图 schema。".into(),
            file_keys: vec![("src/store.rs".into(), "file:aaa".into())],
            commands: vec!["cargo test".into()],
            error_lines: vec![],
            timestamp_ms: 1,
            sequence: 5,
        }
    }

    #[test]
    fn worth_extracting_filters_chitchat() {
        assert!(input().worth_extracting());
        // 纯寒暄：短用户消息 + 无实质产出 → 不抽。
        let mut trivial = input();
        trivial.user_text = "hi".into();
        trivial.assistant_text = "在的".into();
        trivial.file_keys.clear();
        trivial.commands.clear();
        assert!(!trivial.worth_extracting());
        // 短 steer 消息但有实质产出（改了文件）→ 抽。
        let mut steer = input();
        steer.user_text = "继续".into();
        assert!(steer.worth_extracting());
        let mut empty = input();
        empty.user_text = String::new();
        empty.assistant_text = String::new();
        empty.file_keys.clear();
        assert!(!empty.worth_extracting());
    }

    #[test]
    fn prompt_carries_data_sections() {
        let prompt = input().build_prompt(&[]);
        assert!(prompt.contains("SQLite"));
        assert!(prompt.contains("src/store.rs"));
        assert!(prompt.contains("cargo test"));
        assert!(prompt.contains("entity types"));
    }

    #[test]
    fn extracted_marker_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        store::write_batch(
            &db,
            &store::FactBatch {
                nodes: vec![store::NodeFact {
                    node_type: "turn",
                    key: "turn:k".into(),
                    label: "turn 1".into(),
                    props: serde_json::json!({}),
                    timestamp_ms: 1,
                }],
                edges: vec![],
            },
        )
        .unwrap();
        assert!(!turn_already_extracted(&db, "turn:k"));
        mark_turn_extracted(&db, Some("turn:k"));
        assert!(turn_already_extracted(&db, "turn:k"));
        assert!(!turn_already_extracted(&db, "turn:missing"));
    }
}

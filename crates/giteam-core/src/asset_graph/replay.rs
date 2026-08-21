//! 存量回放：扫描 pi-sessions 目录的会话 JSONL，重建资产图谱。
//!
//! JSONL 记录格式（pi 会话文件，版本 3）：
//! - `{"type":"session","version":3,"id":uuid,"timestamp":iso,"cwd":path}`
//! - `{"type":"message","id":hex,"parentId":hex,"timestamp":iso,
//!    "message":{"role":"user|assistant|toolResult", …}}`
//!   - user: `content` 为字符串（意图）
//!   - assistant: `content` 为块数组，含 `{"type":"toolCall","id","name","arguments"}`
//!   - toolResult: `{"toolCallId","toolName","content":[…],"isError"?}`
//!
//! 做法是把 JSONL 记录投影回 `AgentEventEnvelope`（TurnStarted /
//! MessageCompleted / ToolStarted / ToolCompleted），复用 live 路径的
//! `SessionAccumulator::ingest` —— 回放与实时走**同一套确定性规则**，
//! 两条路径不会长出两种图。turn 以用户消息为界重建；toolCall 在
//! assistant 消息里登记、收到配对 toolResult 时一次性补齐 started+completed。
//!
//! 增量：`replay_state` 游标记录 (size, mtime)，未变化的文件跳过。

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::extract::SessionAccumulator;
use super::store::{self, FactBatch};
use crate::pi_agent::{AgentEvent, AgentEventEnvelope};
use crate::pi_agent::{AgentMessage, AgentPart, AgentRole};

/// 单个 JSONL 文件解析出的会话事实。
pub struct ReplayOutcome {
    pub session_id: String,
    pub batch: FactBatch,
}

struct ReplayState {
    acc: SessionAccumulator,
    turn_index: u64,
    /// toolCallId → (toolName, arguments)，等配对的 toolResult。
    pending: std::collections::HashMap<String, (String, Value)>,
}

impl ReplayState {
    /// 用 acc 自身的 session/run 标识合成一条事件信封（与 live 同构）。
    fn env(&self, sequence: u64, timestamp_ms: u64, event: AgentEvent) -> AgentEventEnvelope {
        AgentEventEnvelope {
            schema_version: 1,
            event_id: format!("replay-{sequence}"),
            sequence,
            repo_path: self.acc.repo_path().to_string(),
            session_id: self.acc.session_id().to_string(),
            run_id: Some(self.acc.run_id().to_string()),
            timestamp_ms,
            event,
        }
    }
}

/// 解析一个会话 JSONL 文本为图谱事实。repo_path 用于路径相对化。
#[must_use]
pub fn parse_session_jsonl(repo_path: &str, text: &str) -> Option<ReplayOutcome> {
    let mut state: Option<ReplayState> = None;
    let mut sequence: u64 = 0;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue; // 坏行跳过（半写入的最后一行常见）
        };
        sequence += 1;
        match record.get("type").and_then(Value::as_str) {
            Some("session") => {
                let id = record
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if id.is_empty() {
                    continue;
                }
                let run_id = format!("replay:{id}");
                state = Some(ReplayState {
                    acc: SessionAccumulator::new(repo_path, &id, &run_id),
                    turn_index: 0,
                    pending: std::collections::HashMap::new(),
                });
            }
            Some("message") => {
                let Some(state) = state.as_mut() else { continue };
                let Some(message) = record.get("message") else { continue };
                let timestamp_ms = record
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(parse_iso_ms)
                    .unwrap_or_else(|| sequence.saturating_mul(1000));
                let id = record
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("m{sequence}"));
                match message.get("role").and_then(Value::as_str) {
                    Some("user") => {
                        state.turn_index += 1;
                        let content = message_content_text(message);
                        if content.trim().is_empty() {
                            continue;
                        }
                        state.acc.ingest(&state.env(
                            sequence,
                            timestamp_ms,
                            AgentEvent::TurnStarted {
                                index: usize::try_from(state.turn_index).unwrap_or(0),
                            },
                        ));
                        state.acc.ingest(&state.env(
                            sequence,
                            timestamp_ms,
                            AgentEvent::MessageCompleted {
                                message: AgentMessage {
                                    id,
                                    role: AgentRole::User,
                                    created_at_ms: timestamp_ms,
                                    parts: vec![AgentPart::Text { text: content }],
                                },
                            },
                        ));
                    }
                    Some("assistant") => {
                        let blocks = message
                            .get("content")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        let mut text_parts = String::new();
                        for block in &blocks {
                            match block.get("type").and_then(Value::as_str) {
                                Some("text") => {
                                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                                        if !text.trim().is_empty() {
                                            text_parts.push_str(text);
                                            text_parts.push('\n');
                                        }
                                    }
                                }
                                Some("toolCall") => {
                                    let call_id = block
                                        .get("id")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default()
                                        .to_string();
                                    let name = block
                                        .get("name")
                                        .and_then(Value::as_str)
                                        .unwrap_or_default()
                                        .to_string();
                                    let args = block
                                        .get("arguments")
                                        .cloned()
                                        .unwrap_or_else(|| serde_json::json!({}));
                                    if !call_id.is_empty() && !name.is_empty() {
                                        state.pending.insert(call_id, (name, args));
                                    }
                                }
                                _ => {}
                            }
                        }
                        if !text_parts.trim().is_empty() && state.turn_index > 0 {
                            state.acc.ingest(&state.env(
                                sequence,
                                timestamp_ms,
                                AgentEvent::MessageCompleted {
                                    message: AgentMessage {
                                        id,
                                        role: AgentRole::Assistant,
                                        created_at_ms: timestamp_ms,
                                        parts: vec![AgentPart::Text { text: text_parts }],
                                    },
                                },
                            ));
                        }
                    }
                    Some("toolResult") => {
                        if state.turn_index == 0 {
                            continue; // 首个用户消息之前的内容不进图
                        }
                        let call_id = message
                            .get("toolCallId")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let reported_name = message
                            .get("toolName")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string();
                        let output = message
                            .get("content")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!([]));
                        let is_error = message
                            .get("isError")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        let Some((name, args)) = state.pending.remove(&call_id) else {
                            continue;
                        };
                        let name = if reported_name.is_empty() { name } else { reported_name };
                        state.acc.ingest(&state.env(
                            sequence,
                            timestamp_ms,
                            AgentEvent::ToolStarted {
                                tool_call_id: call_id.clone(),
                                tool_name: name.clone(),
                                input: args,
                            },
                        ));
                        state.acc.ingest(&state.env(
                            sequence,
                            timestamp_ms,
                            AgentEvent::ToolCompleted {
                                tool_call_id: call_id,
                                tool_name: name,
                                output,
                                is_error,
                            },
                        ));
                    }
                    _ => {}
                }
            }
            _ => {} // model_change / thinking_level_change 不进图
        }
    }
    let mut state = state?;
    let batch = state.acc.take_batch();
    if batch.is_empty() {
        return None;
    }
    Some(ReplayOutcome {
        session_id: state.acc.session_id().to_string(),
        batch,
    })
}

fn message_content_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// ISO-8601（RFC3339 变体）→ 毫秒。失败返回 None。
fn parse_iso_ms(iso: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|dt| u64::try_from(dt.timestamp_millis()).unwrap_or(0))
}

/// 扫描目录下全部 `*.jsonl` 会话文件，增量重建图谱。
/// 返回 (索引的文件数, 跳过数)。
pub fn replay_directory(
    db: &rusqlite::Connection,
    repo_path: &str,
    sessions_dir: &Path,
) -> (usize, usize) {
    let Ok(entries) = std::fs::read_dir(sessions_dir) else {
        return (0, 0);
    };
    let mut indexed = 0;
    let mut skipped = 0;
    let mut files: Vec<PathBuf> = entries
        .filter_map(std::result::Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "jsonl").unwrap_or(false))
        .collect();
    files.sort();
    for path in files {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let size = i64::try_from(meta.len()).unwrap_or(0);
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
            .unwrap_or(0);
        let path_str = path.to_string_lossy().to_string();
        if let Some((seen_size, seen_modified)) = store::replay_get_state(db, &path_str) {
            if seen_size == size && seen_modified == modified_ms {
                skipped += 1;
                continue;
            }
        }
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        if let Some(outcome) = parse_session_jsonl(repo_path, &text) {
            let _ = store::write_batch(db, &outcome.batch);
        }
        let _ = store::replay_upsert_state(db, &path_str, size, modified_ms, "");
        indexed += 1;
    }
    (indexed, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> String {
        [
            r#"{"type":"session","version":3,"id":"s-uuid-1","timestamp":"2026-08-15T08:27:50.000Z","cwd":"/repo"}"#,
            r#"{"type":"model_change","model":"x"}"#,
            r#"{"type":"message","id":"m1","timestamp":"2026-08-15T08:27:54.000Z","message":{"role":"user","content":"修一下构建失败","timestamp":1786956}}"#,
            r#"{"type":"message","id":"m2","timestamp":"2026-08-15T08:27:55.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_a","name":"bash","arguments":{"command":"cargo build"}}]}}"#,
            r#"{"type":"message","id":"m3","timestamp":"2026-08-15T08:27:56.000Z","message":{"role":"toolResult","toolCallId":"call_a","toolName":"bash","content":[{"type":"text","text":"error[E0308]: mismatched types at line 42"}],"isError":true}}"#,
            r#"{"type":"message","id":"m4","timestamp":"2026-08-15T08:27:57.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_b","name":"edit","arguments":{"file_path":"src/lib.rs"}}]}}"#,
            r#"{"type":"message","id":"m5","timestamp":"2026-08-15T08:27:58.000Z","message":{"role":"toolResult","toolCallId":"call_b","toolName":"edit","content":[{"type":"text","text":"done"}]}}"#,
        ]
        .join("\n")
    }

    #[test]
    fn parses_full_session_into_facts() {
        let outcome = parse_session_jsonl("/repo", &fixture()).expect("outcome");
        assert_eq!(outcome.session_id, "s-uuid-1");
        let batch = outcome.batch;
        let types: Vec<&str> = batch.nodes.iter().map(|n| n.node_type).collect();
        for expected in ["session", "message", "tool_call", "command", "error", "file", "turn", "run"] {
            assert!(types.contains(&expected), "missing {expected}: {types:?}");
        }
        let session = batch
            .nodes
            .iter()
            .find(|n| n.node_type == "session" && n.props.get("intent").is_some())
            .expect("session with intent");
        assert_eq!(session.props["intent"], "修一下构建失败");
        assert!(session.props.get("sessionId").is_some());
        let edges: Vec<&str> = batch.edges.iter().map(|e| e.edge_type).collect();
        for expected in ["has_turn", "has_message", "used_tool", "executed", "failed_with", "modified"] {
            assert!(edges.contains(&expected), "missing {expected}: {edges:?}");
        }
    }

    #[test]
    fn skips_bad_lines_and_empty_sessions() {
        let bad = concat!(
            r#"{"type":"session","version":3,"id":"s-x","timestamp":"2026-08-15T08:00:00.000Z","cwd":"/repo"}"#,
            "\n",
            "this line is not json\n",
            r#"{"type":"message","broken":"#,
        );
        // 无任何用户消息 → 空批次 → None。
        assert!(parse_session_jsonl("/repo", bad).is_none());
        assert!(parse_session_jsonl("/repo", "not json at all").is_none());
    }

    #[test]
    fn directory_replay_is_incremental() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::write(sessions.join("session-1.jsonl"), fixture()).unwrap();
        std::fs::write(
            sessions.join("session-2.jsonl"),
            concat!(
                r#"{"type":"session","version":3,"id":"s-2","timestamp":"2026-08-15T09:00:00.000Z","cwd":"/repo"}"#,
                "\n",
                r#"{"type":"message","id":"m1","timestamp":"2026-08-15T09:00:01.000Z","message":{"role":"user","content":"别的会话","timestamp":1}}"#,
            ),
        )
        .unwrap();
        std::fs::write(sessions.join("notes.txt"), "ignore me").unwrap();

        let db = store::open(&dir.path().join("graph.db")).unwrap();
        let (indexed, skipped) = replay_directory(&db, "/repo", &sessions);
        assert_eq!(indexed, 2);
        assert_eq!(skipped, 0);
        let messages: i64 = db
            .query_row("SELECT COUNT(*) FROM nodes WHERE type = 'message'", [], |r| r.get(0))
            .unwrap();
        assert!(messages >= 2);

        // 二次扫描：全部命中游标，且数据幂等。
        let (indexed2, skipped2) = replay_directory(&db, "/repo", &sessions);
        assert_eq!(indexed2, 0);
        assert_eq!(skipped2, 2);
        let messages2: i64 = db
            .query_row("SELECT COUNT(*) FROM nodes WHERE type = 'message'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(messages, messages2);
    }
}

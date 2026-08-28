//! 资产图谱工具面：让当前会话的 agent 查询其他会话的执行记录。
//!
//! 工具面组织借 codegraph 成熟模式——一个复合主工具 + 单点补充 + 路径追溯：
//! - `asset_context`（主工具）：改文件前/遇错时先调，一次返回
//!   匹配节点 + 一跳邻居 + 文件史 + 开放回路 + 错误先例。
//! - `asset_search`：单点检索节点。
//! - `asset_precedents`：按错误文本找历史修复对。
//! - `asset_trace`：两点间执行/语义路径（意图→工具→文件→提交）。
//!
//! 全部无副作用（effects=read）、不走审批、返回体限幅 8KB。

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;
use std::path::PathBuf;

const OUTPUT_BUDGET: usize = 8 * 1024;

fn text_output(text: String) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            clamp_output(text),
        ))],
        details: None,
        is_error: false,
    }
}

fn clamp_output(mut text: String) -> String {
    if text.len() <= OUTPUT_BUDGET {
        return text;
    }
    let mut end = OUTPUT_BUDGET;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push_str(
        "\n…（结果已达 8KB 预算上限；请用更精确的查询词或 asset_search 收窄范围）",
    );
    text
}

fn unavailable_output() -> ToolOutput {
    text_output(
        "记忆尚未挂载本仓库（会话创建时自动挂载；若无历史会话则为空）。\
         可直接继续任务，历史上下文暂不可用。"
            .to_string(),
    )
}

fn string_input(input: &Value, field: &str) -> String {
    input
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn short_key(key: &str) -> String {
    key.chars().take(16).collect()
}

// ---------- asset_context ----------

pub struct AssetContextTool {
    repo_root: PathBuf,
}

impl AssetContextTool {
    #[must_use]
    pub fn new(repo_root: PathBuf) -> Self {
        Self { repo_root }
    }
}

#[async_trait]
impl Tool for AssetContextTool {
    fn name(&self) -> &str {
        "asset_context"
    }

    fn label(&self) -> &str {
        "AssetContext"
    }

    fn description(&self) -> &str {
        "PRIMARY cross-session memory tool (codegraph_context style). Call BEFORE editing any file \
         and WHENEVER you hit an error. ONE call returns: matched nodes, 1-hop neighbors \
         (decisions↔files↔entities), file edit history with original intents, open loops \
         (unclosed open_task / unresolved errors), and inline fix precedents when the task looks \
         like an error. Do not blind-edit files with history you haven't checked. Do not grep \
         raw session JSONL under .giteam — use this instead."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "任务/文件路径/错误文本：任一形式皆可，图谱会混合检索"
                }
            },
            "required": ["task"]
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let task = string_input(&input, "task");
        if task.is_empty() {
            return Ok(text_output("缺少 task 参数。".into()));
        }
        let Some(graph) = crate::asset_graph::attached(&self.repo_root) else {
            return Ok(unavailable_output());
        };
        let Ok(graph) = graph.lock() else {
            return Ok(unavailable_output());
        };
        let bundle = graph.query().build_context(&task);
        let mut lines: Vec<String> = Vec::new();

        lines.push("## 记忆上下文".into());
        if bundle.matched_nodes.is_empty() {
            lines.push("（无匹配节点——该主题在历史会话中未出现过）".into());
        } else {
            lines.push("### Anchors（匹配节点）".into());
            for hit in bundle.matched_nodes.iter().take(8) {
                lines.push(format!("- [{}] {} ({})", hit.node_type, hit.label, hit.node_id));
            }
        }
        if !bundle.neighbors.is_empty() {
            lines.push("### Neighbors（一跳关联）".into());
            for n in bundle.neighbors.iter().take(12) {
                lines.push(format!(
                    "- {} -[{}]-> [{}] {}",
                    n.from_label, n.edge_type, n.neighbor_type, n.neighbor_label
                ));
            }
        }
        if !bundle.file_history.is_empty() {
            lines.push("### Who & why（文件修改史）".into());
            for entry in bundle.file_history.iter().take(8) {
                lines.push(format!(
                    "- [{}] {}（意图：{}）",
                    entry.timestamp_ms,
                    short_key(&entry.session_key),
                    entry.intent
                ));
            }
        }
        if !bundle.open_loops.is_empty() {
            lines.push("### Open loops（未闭环）".into());
            for loop_hit in bundle.open_loops.iter().take(6) {
                lines.push(format!(
                    "- [{}] {} — {}",
                    loop_hit.kind, loop_hit.label, loop_hit.detail
                ));
            }
        }
        if !bundle.precedents.is_empty() {
            lines.push("### Precedents（修复先例）".into());
            for hit in bundle.precedents.iter().take(5) {
                lines.push(format!(
                    "- 「{}」→ {}（意图：{}）",
                    hit.error_label, hit.resolved_by_label, hit.intent
                ));
            }
        }
        if !bundle.recent_sessions.is_empty() {
            lines.push("### 近期会话".into());
            for session in bundle.recent_sessions.iter().take(4) {
                let files = session
                    .files_modified
                    .iter()
                    .take(4)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                lines.push(format!("- 「{}」改了 [{}]", session.intent, files));
            }
        }
        if !bundle.unresolved_error_labels.is_empty() && bundle.precedents.is_empty() {
            lines.push("### 相关错误（可再调 asset_precedents）".into());
            for label in bundle.unresolved_error_labels.iter().take(4) {
                lines.push(format!("- {label}"));
            }
        }
        Ok(text_output(lines.join("\n")))
    }
}

// ---------- asset_search ----------

pub struct AssetSearchTool {
    repo_root: PathBuf,
}

impl AssetSearchTool {
    #[must_use]
    pub fn new(repo_root: PathBuf) -> Self {
        Self { repo_root }
    }
}

#[async_trait]
impl Tool for AssetSearchTool {
    fn name(&self) -> &str {
        "asset_search"
    }

    fn label(&self) -> &str {
        "AssetSearch"
    }

    fn description(&self) -> &str {
        "Locate asset-graph nodes by text (files, commands, errors, sessions, commits, \
         semantic entities). Use to pin down exact names BEFORE asset_context when the task \
         description is vague. Prefer asset_context for 'what's the deal with X' questions."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "检索词（路径片段/命令/错误关键词）"},
                "type": {
                    "type": "string",
                    "enum": [
                        "file", "command", "error", "session", "commit", "message", "tool_call",
                        "decision", "feature", "module", "tech_concept",
                        "error_pattern", "api", "tradeoff", "open_task"
                    ],
                    "description": "可选节点类型过滤（后 8 类为语义实体）"
                }
            },
            "required": ["query"]
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let query_text = string_input(&input, "query");
        if query_text.is_empty() {
            return Ok(text_output("缺少 query 参数。".into()));
        }
        let node_type = string_input(&input, "type");
        let node_type = (!node_type.is_empty()).then_some(node_type.as_str());
        let Some(graph) = crate::asset_graph::attached(&self.repo_root) else {
            return Ok(unavailable_output());
        };
        let Ok(graph) = graph.lock() else {
            return Ok(unavailable_output());
        };
        let hits = graph.query().search(&query_text, node_type, 20);
        if hits.is_empty() {
            return Ok(text_output("无命中。".into()));
        }
        let lines: Vec<String> = hits
            .iter()
            .map(|hit| format!("- [{}] {} ({})", hit.node_type, hit.label, hit.node_id))
            .collect();
        Ok(text_output(lines.join("\n")))
    }
}

// ---------- asset_precedents ----------

pub struct AssetPrecedentsTool {
    repo_root: PathBuf,
}

impl AssetPrecedentsTool {
    #[must_use]
    pub fn new(repo_root: PathBuf) -> Self {
        Self { repo_root }
    }
}

#[async_trait]
impl Tool for AssetPrecedentsTool {
    fn name(&self) -> &str {
        "asset_precedents"
    }

    fn label(&self) -> &str {
        "AssetPrecedents"
    }

    fn description(&self) -> &str {
        "Find how similar errors were fixed in past sessions (error text in → fix action + \
         session intent out). Numbers are normalized so line numbers need not match. \
         Prefer asset_context first when exploring a task; use this for a focused error lookup."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "error_text": {"type": "string", "description": "错误输出原文（首行即可）"}
            },
            "required": ["error_text"]
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let error_text = string_input(&input, "error_text");
        if error_text.is_empty() {
            return Ok(text_output("缺少 error_text 参数。".into()));
        }
        let Some(graph) = crate::asset_graph::attached(&self.repo_root) else {
            return Ok(unavailable_output());
        };
        let Ok(graph) = graph.lock() else {
            return Ok(unavailable_output());
        };
        let hits = graph.query().find_precedents(&error_text);
        if hits.is_empty() {
            return Ok(text_output("无同类错误的修复先例。".into()));
        }
        let lines: Vec<String> = hits
            .iter()
            .map(|hit| {
                format!(
                    "- 错误「{}」\n  由 {} 修复（会话意图：{}）",
                    hit.error_label, hit.resolved_by_label, hit.intent
                )
            })
            .collect();
        Ok(text_output(lines.join("\n")))
    }
}

// ---------- asset_trace ----------

pub struct AssetTraceTool {
    repo_root: PathBuf,
}

impl AssetTraceTool {
    #[must_use]
    pub fn new(repo_root: PathBuf) -> Self {
        Self { repo_root }
    }
}

#[async_trait]
impl Tool for AssetTraceTool {
    fn name(&self) -> &str {
        "asset_trace"
    }

    fn label(&self) -> &str {
        "AssetTrace"
    }

    fn description(&self) -> &str {
        "Trace the path between two asset-graph nodes (codegraph_trace style): intent/session → \
         turn → tool → file/error → commit, or decision → affects → file. ONE call returns the \
         whole hop list. Do NOT reconstruct paths with asset_search + manual chaining."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "from": {
                    "type": "string",
                    "description": "起点：节点 id / key / label（会话、文件、决策、错误等）"
                },
                "to": {
                    "type": "string",
                    "description": "终点：节点 id / key / label"
                },
                "max_hops": {
                    "type": "integer",
                    "description": "最大跳数（默认 5，上限 8）"
                }
            },
            "required": ["from", "to"]
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let from = string_input(&input, "from");
        let to = string_input(&input, "to");
        if from.is_empty() || to.is_empty() {
            return Ok(text_output("需要 from 与 to 参数。".into()));
        }
        let max_hops = input
            .get("max_hops")
            .and_then(Value::as_u64)
            .map(|n| n as u32)
            .unwrap_or(5);
        let Some(graph) = crate::asset_graph::attached(&self.repo_root) else {
            return Ok(unavailable_output());
        };
        let Ok(graph) = graph.lock() else {
            return Ok(unavailable_output());
        };
        let hops = graph.query().trace_path(&from, &to, max_hops);
        if hops.is_empty() {
            return Ok(text_output(format!(
                "未找到从「{from}」到「{to}」的路径（可先用 asset_search 确认两端节点）。"
            )));
        }
        let mut lines = vec![format!("## 路径 {} → {}（{} 跳）", from, to, hops.len().saturating_sub(1))];
        for (idx, hop) in hops.iter().enumerate() {
            if idx == 0 {
                lines.push(format!("1. [{}] {}", hop.node_type, hop.label));
            } else {
                let via = hop.via_edge.as_deref().unwrap_or("?");
                lines.push(format!(
                    "{}. -[{via}]-> [{}] {}",
                    idx + 1,
                    hop.node_type,
                    hop.label
                ));
            }
        }
        Ok(text_output(lines.join("\n")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_is_clamped_to_budget() {
        let huge = "x".repeat(OUTPUT_BUDGET + 500);
        let clamped = clamp_output(huge);
        assert!(clamped.len() < OUTPUT_BUDGET + 100);
        assert!(clamped.contains("预算上限"));
        let small = clamp_output("ok".into());
        assert_eq!(small, "ok");
    }

    #[test]
    fn tool_metadata_is_sane() {
        let tool = AssetContextTool::new(PathBuf::from("/repo"));
        assert_eq!(tool.name(), "asset_context");
        assert!(tool.description().contains("BEFORE editing"));
        let search = AssetSearchTool::new(PathBuf::from("/repo"));
        assert_eq!(search.name(), "asset_search");
        let precedents = AssetPrecedentsTool::new(PathBuf::from("/repo"));
        assert_eq!(precedents.name(), "asset_precedents");
        let trace = AssetTraceTool::new(PathBuf::from("/repo"));
        assert_eq!(trace.name(), "asset_trace");
        assert!(trace.description().contains("path"));
    }
}

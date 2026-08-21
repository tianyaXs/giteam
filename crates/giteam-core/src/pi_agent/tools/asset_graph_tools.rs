//! 资产图谱工具面：让当前会话的 agent 查询其他会话的执行记录。
//!
//! 三个只读工具（设计文档 docs/repo-asset-graph-agent.md §4.2，工具面组织
//! 借 codegraph 的成熟模式——一个复合主工具 + 单点补充）：
//! - `asset_context`（主工具）：改文件前/遇错时先调，一次组合返回
//!   相关会话（意图+改动+提交）+ 文件跨会话修改史 + 错误修复先例。
//! - `asset_search`：单点检索节点（文件/命令/错误/会话）。
//! - `asset_precedents`：按错误文本找历史修复对。
//!
//! 全部无副作用（effects=read）、不走审批、返回体限幅 8KB
//! （超限提示收窄查询，防撑爆上下文）。

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;
use std::path::PathBuf;

/// 工具输出的字符预算（对齐设计文档的护栏）。
const OUTPUT_BUDGET: usize = 8 * 1024;

// ---------- 公共辅助 ----------

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

// ---------- asset_context（主工具） ----------

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
        "Cross-session repository memory. Call this BEFORE editing any file or when hitting any error: \
         returns which sessions touched the relevant files (with the original user intent of each), \
         what they changed, produced commits, and how similar errors were fixed before. \
         Input is a task description, a file path, or an error message. Do not blind-edit files with \
         history you haven't checked."
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
        let query = graph.query();
        let bundle = query.build_context(&task);
        let mut lines: Vec<String> = Vec::new();

        lines.push("## 记忆上下文".into());
        if bundle.matched_nodes.is_empty() {
            lines.push("（无匹配节点——该主题在历史会话中未出现过）".into());
        } else {
            lines.push("### 匹配节点".into());
            for hit in bundle.matched_nodes.iter().take(10) {
                lines.push(format!("- [{}] {} ({})", hit.node_type, hit.label, hit.node_id));
            }
        }
        if !bundle.file_history.is_empty() {
            lines.push("### 文件修改史（谁、为何）".into());
            for entry in bundle.file_history.iter().take(10) {
                lines.push(format!(
                    "- [{}] {}（意图：{}）",
                    entry.timestamp_ms,
                    short_key(&entry.session_key),
                    entry.intent
                ));
            }
        }
        if !bundle.recent_sessions.is_empty() {
            lines.push("### 近期会话".into());
            for session in &bundle.recent_sessions {
                let files = session.files_modified.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
                let pending = session.unresolved_errors.iter().take(2).cloned().collect::<Vec<_>>().join(" / ");
                lines.push(format!(
                    "- 「{}」改了 [{}]{}{}",
                    session.intent,
                    files,
                    if session.commits.is_empty() { String::new() } else { format!("；提交 {}", session.commits.iter().take(3).cloned().collect::<Vec<_>>().join(",")) },
                    if pending.is_empty() { String::new() } else { format!("；未闭环：{pending}") }
                ));
            }
        }
        if !bundle.unresolved_error_labels.is_empty() {
            lines.push("### 相关错误（可用 asset_precedents 查修复先例）".into());
            for label in bundle.unresolved_error_labels.iter().take(5) {
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
        "Search asset-graph nodes by text: files, commands, errors, sessions, commits. \
         Returns node id / type / label. Use to locate exact targets before asset_context."
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
                    "description": "可选节点类型过滤（后 8 类为语义实体，由 extract 子代理抽取）"
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
        "Find how similar errors were fixed in past sessions: pass the error text, \
         get each precedent's fix action and the session intent behind it. \
         Numbers in the error are normalized, so 'line 42' matches 'line 99'."
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

fn short_key(key: &str) -> String {
    key.chars().take(16).collect()
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
    }
}

//! `task` 工具：同步 spawn 内置子 agent（对齐 Hermes `delegate_task`）。
//!
//! - 单任务：`description` + `prompt` + 可选 `context`
//! - 批并行：`tasks=[{description, prompt, context, subagent_type}, ...]`（最多
//!   [`MAX_CONCURRENT_CHILDREN`] 并发）
//!
//! 子 session 独立 session_id；父 tool result 只返回 summary 文本给模型；
//! UI 进度/嵌套事件由 service 投影为 `subagent.*`。

use std::sync::Arc;

use async_trait::async_trait;
use futures::stream::{self, StreamExt};
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

use super::super::interactions::InteractionHub;
use super::super::subagents::{
    SubagentHost, SubagentSpawnRequest, SubagentSpawnResult, MAX_CONCURRENT_CHILDREN,
};

pub struct TaskTool {
    hub: Arc<InteractionHub>,
    host: Arc<dyn SubagentHost>,
}

impl TaskTool {
    #[must_use]
    pub fn new(hub: Arc<InteractionHub>, host: Arc<dyn SubagentHost>) -> Self {
        Self { hub, host }
    }
}

#[async_trait]
impl Tool for TaskTool {
    fn name(&self) -> &str {
        "task"
    }

    fn label(&self) -> &str {
        "Task"
    }

    fn description(&self) -> &str {
        // 只写机制（模式/字段/隔离语义）；何时委派与 USE FOR / DO NOT USE
        // 取舍在 prompt.rs 工具清单——本描述随 schema 每轮发给模型，
        // 与清单条目是同一受众，重复必分叉。
        "Spawn one or more specialized subagents (subagent_type=plan) in isolated sessions and wait \
         for them to finish. Each child gets a focused system prompt (goal + context) and returns \
         only a summary — intermediate tool calls stay out of your context.\n\n\
         TWO MODES (one of single-task fields or 'tasks' is required):\n\
         1. Single: description + subagent_type (+ optional prompt, context)\n\
         2. Batch:  tasks=[{description, subagent_type, prompt?, context?}, ...] — run in parallel \
         (capped concurrency).\n\n\
         Children have no memory of your chat; pass everything they need via prompt and context."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "Short UI label / goal title for a single task"
                },
                "prompt": {
                    "type": "string",
                    "description": "Full goal instructions for the subagent. If omitted, description is used."
                },
                "context": {
                    "type": "string",
                    "description": "Background the child needs (paths, constraints, language). Children have no parent chat memory."
                },
                "subagent_type": {
                    "type": "string",
                    "description": "Built-in subagent type for a single task",
                    "enum": ["plan"]
                },
                "tasks": {
                    "type": "array",
                    "description": "Batch mode: run multiple subagents in parallel. When set, top-level description/prompt/context/subagent_type are ignored.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {
                                "type": "string",
                                "description": "Short UI label / goal title"
                            },
                            "prompt": {
                                "type": "string",
                                "description": "Full goal instructions"
                            },
                            "context": {
                                "type": "string",
                                "description": "Background for this child"
                            },
                            "subagent_type": {
                                "type": "string",
                                "enum": ["plan"]
                            }
                        },
                        "required": ["description", "subagent_type"]
                    }
                }
            }
        })
    }

    fn effects(&self) -> ToolEffects {
        // 启动本身不写盘；子 session 内写操作仍走各自 Approval。
        ToolEffects::read()
    }

    async fn execute(
        &self,
        tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let Some(run) = self.hub.run_context() else {
            return Ok(error_output(
                "task requires an active parent run context".to_string(),
            ));
        };

        let requests = match parse_spawn_requests(&run.session_id, tool_call_id, &input) {
            Ok(items) if !items.is_empty() => items,
            Ok(_) => {
                return Ok(error_output(
                    "task requires either description+subagent_type or a non-empty tasks array"
                        .to_string(),
                ));
            }
            Err(message) => return Ok(error_output(message)),
        };

        if requests.len() == 1 {
            return match self.host.run_subagent(requests.into_iter().next().unwrap()).await {
                Ok(result) => Ok(single_success_output(result)),
                Err(error) => Ok(error_output(error)),
            };
        }

        // Hermes 批并行：buffer_unordered 限制并发。
        let host = Arc::clone(&self.host);
        let results: Vec<std::result::Result<SubagentSpawnResult, String>> = stream::iter(requests)
            .map(|request| {
                let host = Arc::clone(&host);
                async move { host.run_subagent(request).await }
            })
            .buffer_unordered(MAX_CONCURRENT_CHILDREN)
            .collect()
            .await;

        Ok(batch_output(results))
    }
}

fn parse_spawn_requests(
    parent_session_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> std::result::Result<Vec<SubagentSpawnRequest>, String> {
    if let Some(tasks) = input.get("tasks").and_then(Value::as_array) {
        // 模型常误传 tasks:[] 同时又带顶层 description；回退为单任务，避免空数组直接失败。
        if tasks.is_empty() {
            if input
                .get("description")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .is_some()
            {
                return Ok(vec![parse_one_task(parent_session_id, tool_call_id, input)?]);
            }
            return Err(
                "tasks array must not be empty (or provide top-level description+subagent_type)"
                    .to_string(),
            );
        }
        // 单元素 tasks[] 与顶层单任务等价：共用父 toolCallId，UI 只出一张卡。
        if tasks.len() == 1 {
            return Ok(vec![parse_one_task(
                parent_session_id,
                tool_call_id,
                &tasks[0],
            )?]);
        }
        let mut out = Vec::with_capacity(tasks.len());
        for (index, task) in tasks.iter().enumerate() {
            out.push(parse_one_task(
                parent_session_id,
                &format!("{tool_call_id}:{index}"),
                task,
            )?);
        }
        return Ok(out);
    }

    Ok(vec![parse_one_task(parent_session_id, tool_call_id, input)?])
}

fn parse_one_task(
    parent_session_id: &str,
    parent_tool_call_id: &str,
    input: &Value,
) -> std::result::Result<SubagentSpawnRequest, String> {
    let description = input
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("")
        .to_string();
    if description.is_empty() {
        return Err("task requires a non-empty description".to_string());
    }
    let subagent_type = input
        .get("subagent_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or("")
        .to_string();
    if subagent_type.is_empty() {
        return Err("task requires subagent_type (supported: plan)".to_string());
    }
    let prompt = input
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| description.clone());
    let context = input
        .get("context")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();

    Ok(SubagentSpawnRequest {
        parent_session_id: parent_session_id.to_string(),
        parent_tool_call_id: parent_tool_call_id.to_string(),
        description,
        prompt,
        context,
        subagent_type,
    })
}

fn single_success_output(result: SubagentSpawnResult) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            result.summary.clone(),
        ))],
        details: Some(serde_json::json!({
            "childSessionId": result.child_session_id,
            "childRunId": result.child_run_id,
            "toolCount": result.tool_count,
            "elapsedMs": result.elapsed_ms,
        })),
        is_error: false,
    }
}

fn batch_output(results: Vec<std::result::Result<SubagentSpawnResult, String>>) -> ToolOutput {
    let total = results.len();
    let mut lines = Vec::with_capacity(total);
    let mut details = Vec::with_capacity(total);
    let mut any_error = false;
    for (index, result) in results.into_iter().enumerate() {
        match result {
            Ok(item) => {
                lines.push(format!(
                    "### Task {}\n{}",
                    index + 1,
                    item.summary.trim()
                ));
                details.push(serde_json::json!({
                    "index": index,
                    "ok": true,
                    "childSessionId": item.child_session_id,
                    "childRunId": item.child_run_id,
                    "toolCount": item.tool_count,
                    "elapsedMs": item.elapsed_ms,
                }));
            }
            Err(error) => {
                any_error = true;
                lines.push(format!("### Task {} — failed\n{error}", index + 1));
                details.push(serde_json::json!({
                    "index": index,
                    "ok": false,
                    "error": error,
                }));
            }
        }
    }
    let body = format!(
        "Completed {done}/{total} subagent task(s).\n\n{body}",
        done = details.iter().filter(|item| item.get("ok") == Some(&Value::Bool(true))).count(),
        total = total,
        body = lines.join("\n\n")
    );
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(body))],
        details: Some(serde_json::json!({ "tasks": details })),
        is_error: any_error,
    }
}

fn error_output(message: String) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            message,
        ))],
        details: None,
        is_error: true,
    }
}

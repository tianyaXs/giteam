//! TodoWrite 工具：模型维护结构化任务清单（全量写入语义）。
//!
//! 每次调用传入完整列表替换先前状态；pi 自动发 tool.completed 事件，
//! 前端 `readAgentTodosFromPart` 从 `details.todos` 解析渲染侧栏进度卡片。
//! 不改变本地文件、无需用户裁决，故 effects=read、不走审批闭环。

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

use super::super::types::{AgentTodo, AgentTodoStatus};

pub struct TodoTool;

impl TodoTool {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for TodoTool {
    fn name(&self) -> &str {
        "todowrite"
    }

    fn label(&self) -> &str {
        "Todo"
    }

    fn description(&self) -> &str {
        // 机制 only（对齐 Codex update_plan schema）；何时用/何时禁在 prompt Workflow。
        "Updates the task plan shown to the user. Each call replaces the previous list entirely, so always pass the full current list. Provide short steps with statuses pending / in_progress / completed / cancelled; at most one item may be in_progress. You may mark multiple items completed in a single call."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "description": "完整任务列表（每次全量替换）",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string", "description": "稳定标识，便于跨调用追踪同一项"},
                            "content": {"type": "string", "description": "简短任务描述"},
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed", "cancelled"]
                            },
                            "priority": {"type": "string", "description": "可选优先级"}
                        },
                        "required": ["id", "content", "status"]
                    }
                },
                "note": {
                    "type": "string",
                    "description": "本次清单变更的简短说明：增删、重排或取消步骤时说明原因；常规状态推进可省略"
                }
            },
            "required": ["todos"]
        })
    }

    fn effects(&self) -> ToolEffects {
        // 仅维护会话内任务清单，不读写本地文件、不执行命令。
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let todos = match parse_todos(&input) {
            Ok(todos) => todos,
            Err(message) => return Ok(invalid_output(message)),
        };
        let note = input
            .get("note")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string);
        Ok(todo_output(&todos, note.as_deref()))
    }
}

/// 解析并校验全量 todo 列表：content 非空、status 合法、最多一个 in_progress。
fn parse_todos(input: &Value) -> std::result::Result<Vec<AgentTodo>, String> {
    let items = input
        .get("todos")
        .and_then(Value::as_array)
        .ok_or_else(|| "缺少 todos 数组".to_string())?;
    let mut todos = Vec::with_capacity(items.len());
    let mut in_progress = 0;
    for (index, item) in items.iter().enumerate() {
        let content = item
            .get("content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .ok_or_else(|| format!("第 {} 项 content 不能为空", index + 1))?
            .to_string();
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("todo-{}", index + 1));
        let status = item
            .get("status")
            .and_then(Value::as_str)
            .and_then(parse_status)
            .ok_or_else(|| format!("第 {} 项 status 无效", index + 1))?;
        if status == AgentTodoStatus::InProgress {
            in_progress += 1;
        }
        let priority = item
            .get("priority")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string);
        todos.push(AgentTodo {
            id,
            content,
            status,
            priority,
        });
    }
    if todos.is_empty() {
        return Err("todos 不能为空".to_string());
    }
    if in_progress > 1 {
        return Err("最多只能有一项处于 in_progress".to_string());
    }
    Ok(todos)
}

fn parse_status(value: &str) -> Option<AgentTodoStatus> {
    match value {
        "pending" => Some(AgentTodoStatus::Pending),
        "in_progress" => Some(AgentTodoStatus::InProgress),
        "completed" => Some(AgentTodoStatus::Completed),
        "cancelled" => Some(AgentTodoStatus::Cancelled),
        _ => None,
    }
}

fn todo_output(todos: &[AgentTodo], note: Option<&str>) -> ToolOutput {
    let done = todos
        .iter()
        .filter(|todo| todo.status == AgentTodoStatus::Completed)
        .count();
    let active = todos
        .iter()
        .filter(|todo| todo.status == AgentTodoStatus::InProgress)
        .count();
    let mut summary = format!(
        "已更新 {} 项任务：{} 项进行中、{} 项已完成。",
        todos.len(),
        active,
        done
    );
    // 变更说明回显给模型：note 在调用点结构化（对照 Codex update_plan），
    // 回显确认其已被记录，同时供 UI 从 details 读取展示。
    if let Some(note) = note {
        summary.push_str(&format!("变更说明：{note}。"));
    }
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(summary))],
        details: Some(serde_json::json!({ "todos": todos, "note": note })),
        is_error: false,
    }
}

fn invalid_output(message: String) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
            format!("todowrite 参数无效：{message}"),
        ))],
        details: None,
        is_error: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_todos_accepts_full_list_and_defaults_id() {
        let input = serde_json::json!({
            "todos": [
                {"content": "读取文件", "status": "in_progress"},
                {"id": "t2", "content": "修改配置", "status": "pending", "priority": "high"}
            ]
        });
        let todos = parse_todos(&input).expect("valid");
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].id, "todo-1");
        assert_eq!(todos[0].status, AgentTodoStatus::InProgress);
        assert_eq!(todos[1].id, "t2");
        assert_eq!(todos[1].priority.as_deref(), Some("high"));
    }

    #[test]
    fn parse_todos_rejects_multiple_in_progress() {
        let input = serde_json::json!({
            "todos": [
                {"id": "a", "content": "x", "status": "in_progress"},
                {"id": "b", "content": "y", "status": "in_progress"}
            ]
        });
        assert!(parse_todos(&input).is_err());
    }

    #[test]
    fn parse_todos_rejects_empty_content_and_bad_status() {
        assert!(parse_todos(&serde_json::json!({"todos": [{"id": "a", "content": "  ", "status": "pending"}]})).is_err());
        assert!(parse_todos(&serde_json::json!({"todos": [{"id": "a", "content": "x", "status": "done"}]})).is_err());
    }

    #[test]
    fn todo_output_carries_full_list_in_details() {
        let todos = vec![AgentTodo {
            id: "t1".to_string(),
            content: "demo".to_string(),
            status: AgentTodoStatus::Pending,
            priority: None,
        }];
        let output = todo_output(&todos, None);
        assert!(!output.is_error);
        let details = output.details.expect("details present");
        assert_eq!(details["todos"][0]["status"], "pending");
        assert_eq!(details["todos"][0]["id"], "t1");
        assert!(details.get("note").is_some_and(serde_json::Value::is_null));
    }

    #[test]
    fn todo_output_surfaces_note_in_summary_and_details() {
        // note 是计划变更说明的调用点结构化通道（对照 Codex update_plan）：
        // 回显进摘要文本（模型可见）并透传 details（UI 可展示）。
        let todos = vec![AgentTodo {
            id: "t1".to_string(),
            content: "demo".to_string(),
            status: AgentTodoStatus::Pending,
            priority: None,
        }];
        let output = todo_output(&todos, Some("步骤 3 已由用户手动完成，移除"));
        let text = match &output.content[0] {
            pi::sdk::ContentBlock::Text(text) => text.text.clone(),
            _ => panic!("expected text block"),
        };
        assert!(text.contains("变更说明：步骤 3 已由用户手动完成，移除"));
        let details = output.details.expect("details present");
        assert_eq!(details["note"], "步骤 3 已由用户手动完成，移除");
    }
}

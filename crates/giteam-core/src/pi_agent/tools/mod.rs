//! Giteam 工具装配：在 pi 内置工具集上叠加审批门禁与 Question 工具。

mod approval;
mod edit_guard;
mod question;
mod todo;

use std::path::Path;
use std::sync::Arc;

use pi::sdk::{default_tool_registry, Config, Tool, ToolFactory, ToolRegistry};

use super::interactions::{InteractionHub, InteractionRisk};

pub use approval::ApprovalTool;
pub use edit_guard::{EditGuardTool, ReadRecorderTool};
pub use question::QuestionTool;
pub use todo::TodoTool;

/// 基于 pi `default_tool_registry` 装配，写/执行类工具包装 ApprovalTool；
/// question 不是 pi 内置工具，按启用情况追加。
pub struct GiteamToolFactory {
    hub: Arc<InteractionHub>,
    /// enabled_tools 未显式指定（默认全量）或显式包含 "question" 时为 true。
    question_enabled: bool,
    /// enabled_tools 未显式指定（默认全量）或显式包含 "todowrite" 时为 true。
    todo_enabled: bool,
}

impl GiteamToolFactory {
    #[must_use]
    pub fn new(hub: Arc<InteractionHub>, enabled_tools: Option<&[String]>) -> Self {
        let question_enabled = enabled_tools
            .map_or(true, |tools| tools.iter().any(|tool| tool == "question"));
        let todo_enabled = enabled_tools
            .map_or(true, |tools| tools.iter().any(|tool| tool == "todowrite"));
        Self {
            hub,
            question_enabled,
            todo_enabled,
        }
    }
}

impl ToolFactory for GiteamToolFactory {
    fn create_tool_registry(&self, enabled: &[&str], cwd: &Path, config: &Config) -> ToolRegistry {
        let wants_question = enabled.iter().any(|name| *name == "question");
        let wants_todo = enabled.iter().any(|name| *name == "todowrite");
        let builtin: Vec<&str> = enabled
            .iter()
            .copied()
            .filter(|name| *name != "question" && *name != "todowrite")
            .collect();
        let tools = default_tool_registry(&builtin, cwd, config).into_tools();
        let wrapped: Vec<Box<dyn Tool>> = tools
            .into_iter()
            .map(|tool| {
                let name = tool.name().to_string();
                // read 套记录器登记读取历史；edit 先套护栏（内层）强制 read-before-edit。
                let tool: Box<dyn Tool> = if name == "read" {
                    Box::new(ReadRecorderTool::new(tool, Arc::clone(&self.hub)))
                } else if name == "edit" {
                    Box::new(EditGuardTool::new(tool, Arc::clone(&self.hub)))
                } else {
                    tool
                };
                // 写/执行类工具再由 ApprovalTool 审批（外层）；edit 路径为
                // edit → EditGuardTool → ApprovalTool，审批放行后仍经护栏校验。
                if InteractionRisk::for_tool(tool.name()).requires_approval() {
                    Box::new(ApprovalTool::new(tool, Arc::clone(&self.hub))) as Box<dyn Tool>
                } else {
                    tool
                }
            })
            .collect();
        let mut registry = ToolRegistry::from_tools(wrapped);
        if self.question_enabled || wants_question {
            registry.push(Box::new(QuestionTool::new(Arc::clone(&self.hub))));
        }
        if self.todo_enabled || wants_todo {
            registry.push(Box::new(TodoTool::new()));
        }
        registry
    }
}

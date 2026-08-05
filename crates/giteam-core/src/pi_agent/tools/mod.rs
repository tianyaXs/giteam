//! Giteam 工具装配：在 pi 内置工具集上叠加审批门禁、后台 shell 与 Question 工具。
//!
//! bash 由 Giteam 版替换（`background::GiteamBashTool`）：前台仍委托 pi 内置执行，
//! 新增 `run_in_background` 一等公民后台（配套 bash_output / kill_shell），
//! 并带长驻命令前台护栏，避免再起服务挂死会话。

mod approval;
mod background;
mod edit_guard;
mod question;
mod todo;
mod web;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use pi::sdk::{default_tool_registry, Config, Tool, ToolFactory, ToolRegistry};

use super::interactions::{InteractionHub, InteractionRisk};

pub use approval::ApprovalTool;
pub use background::{BackgroundTaskRegistry, BashOutputTool, GiteamBashTool, KillShellTool};
pub use edit_guard::{EditGuardTool, ReadRecorderTool};
pub use question::QuestionTool;
pub use todo::TodoTool;
pub use web::{WebFetchTool, WebSearchTool};

/// 基于 pi `default_tool_registry` 装配，写/执行类工具包装 ApprovalTool；
/// question/todowrite 与后台三件套（bash/bash_output/kill_shell）不是 pi 内置工具，按启用情况追加。
pub struct GiteamToolFactory {
    hub: Arc<InteractionHub>,
    /// enabled_tools 未显式指定（默认全量）或显式包含 "question" 时为 true。
    question_enabled: bool,
    /// enabled_tools 未显式指定（默认全量）或显式包含 "todowrite" 时为 true。
    todo_enabled: bool,
    /// enabled_tools 未显式指定（默认全量）或显式包含 "web_fetch" 时为 true。
    web_fetch_enabled: bool,
    /// enabled_tools 未显式指定（默认全量）或显式包含 "web_search" 时为 true。
    web_search_enabled: bool,
    /// 后台任务日志目录（会话目录下）；no_session 模式为 None（落临时目录）。
    session_dir: Option<PathBuf>,
}

impl GiteamToolFactory {
    #[must_use]
    pub fn new(
        hub: Arc<InteractionHub>,
        enabled_tools: Option<&[String]>,
        session_dir: Option<PathBuf>,
    ) -> Self {
        let question_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "question"));
        let todo_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "todowrite"));
        let web_fetch_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "web_fetch"));
        let web_search_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "web_search"));
        Self {
            hub,
            question_enabled,
            todo_enabled,
            web_fetch_enabled,
            web_search_enabled,
            session_dir,
        }
    }
}

impl ToolFactory for GiteamToolFactory {
    fn create_tool_registry(&self, enabled: &[&str], cwd: &Path, config: &Config) -> ToolRegistry {
        let wants_question = enabled.contains(&"question");
        let wants_todo = enabled.contains(&"todowrite");
        // bash 走 Giteam 版（前台护栏 + run_in_background），不再用 pi 内置；
        // bash_output/kill_shell 随 bash 启用，由本工厂显式注册。
        let bash_enabled = enabled.contains(&"bash");
        let wants_web_fetch = enabled.contains(&"web_fetch");
        let wants_web_search = enabled.contains(&"web_search");
        let builtin: Vec<&str> = enabled
            .iter()
            .copied()
            .filter(|name| {
                !matches!(
                    *name,
                    "question" | "todowrite" | "bash" | "bash_output" | "kill_shell"
                        | "web_fetch" | "web_search"
                )
            })
            .collect();
        let tools = default_tool_registry(&builtin, cwd, config).into_tools();

        // 统一包装链：read 套记录器登记读取历史；edit 先套护栏（内层）强制 read-before-edit；
        // 写/执行类再包 ApprovalTool（外层）。edit 路径为 edit → EditGuardTool → ApprovalTool，
        // 审批放行后仍经护栏校验。
        let wrap = |tool: Box<dyn Tool>| -> Box<dyn Tool> {
            let name = tool.name().to_string();
            let tool: Box<dyn Tool> = if name == "read" {
                Box::new(ReadRecorderTool::new(tool, Arc::clone(&self.hub)))
            } else if name == "edit" {
                Box::new(EditGuardTool::new(tool, Arc::clone(&self.hub)))
            } else {
                tool
            };
            if InteractionRisk::for_tool(tool.name()).requires_approval() {
                Box::new(ApprovalTool::new(tool, Arc::clone(&self.hub))) as Box<dyn Tool>
            } else {
                tool
            }
        };

        let wrapped: Vec<Box<dyn Tool>> = tools.into_iter().map(&wrap).collect();
        let mut registry = ToolRegistry::from_tools(wrapped);

        if bash_enabled {
            let background = Arc::new(BackgroundTaskRegistry::new(
                self.session_dir.as_ref().map(|dir| dir.join("background-tasks")),
            ));
            registry.push(wrap(Box::new(GiteamBashTool::new(
                cwd,
                config,
                Arc::clone(&background),
            ))));
            registry.push(wrap(Box::new(BashOutputTool::new(Arc::clone(&background)))));
            registry.push(wrap(Box::new(KillShellTool::new(background))));
        }
        if self.question_enabled || wants_question {
            registry.push(Box::new(QuestionTool::new(Arc::clone(&self.hub))));
        }
        if self.todo_enabled || wants_todo {
            registry.push(Box::new(TodoTool::new()));
        }
        // web 工具经 wrap：InteractionRisk::for_tool 归 Network → 自动套 ApprovalTool。
        if self.web_fetch_enabled || wants_web_fetch {
            registry.push(wrap(Box::new(WebFetchTool::new())));
        }
        if self.web_search_enabled || wants_web_search {
            registry.push(wrap(Box::new(WebSearchTool::new())));
        }
        registry
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_agent::interactions::InteractionStore;

    fn make_factory(enabled_tools: Option<&[String]>) -> GiteamToolFactory {
        let hub = Arc::new(InteractionHub::new(Arc::new(InteractionStore::new())));
        GiteamToolFactory::new(hub, enabled_tools, None)
    }

    fn tool_names(registry: &ToolRegistry) -> Vec<String> {
        registry
            .tools()
            .iter()
            .map(|tool| tool.name().to_string())
            .collect()
    }

    #[test]
    fn factory_replaces_pi_bash_with_giteam_background_suite() {
        let factory = make_factory(None);
        let enabled: Vec<&str> = super::super::prompt::ALL_BUILTIN_TOOLS.to_vec();
        let cwd = std::env::temp_dir();
        let registry = factory.create_tool_registry(&enabled, &cwd, &Config::default());
        let names = tool_names(&registry);

        let bash = registry.get("bash").expect("bash must be registered");
        // Giteam 版 bash：schema 带 run_in_background，描述引导后台用法。
        let params = bash.parameters().to_string();
        assert!(params.contains("run_in_background"), "params: {params}");
        assert!(bash.description().contains("run_in_background"));
        // 后台配套工具随 bash 注册。
        assert!(names.contains(&"bash_output".to_string()), "{names:?}");
        assert!(names.contains(&"kill_shell".to_string()), "{names:?}");
        // 审批包装：bash/kill_shell 需审批（Execute），bash_output 直通（Read）。
        assert!(InteractionRisk::for_tool("bash").requires_approval());
        assert!(InteractionRisk::for_tool("kill_shell").requires_approval());
        assert!(!InteractionRisk::for_tool("bash_output").requires_approval());
    }

    #[test]
    fn factory_omits_background_suite_without_bash() {
        let enabled_tools = vec!["read".to_string(), "grep".to_string()];
        let factory = make_factory(Some(&enabled_tools));
        let enabled = ["read", "grep"];
        let cwd = std::env::temp_dir();
        let registry = factory.create_tool_registry(&enabled, &cwd, &Config::default());
        let names = tool_names(&registry);
        assert!(!names.contains(&"bash".to_string()));
        assert!(!names.contains(&"bash_output".to_string()));
        assert!(!names.contains(&"kill_shell".to_string()));
    }
}

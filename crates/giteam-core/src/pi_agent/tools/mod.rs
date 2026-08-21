//! Giteam 工具装配：在 pi 内置工具集上叠加审批门禁、后台 shell 与 Question 工具。
//!
//! bash 由 Giteam 版替换（`background::GiteamBashTool`）：前台自实现（std::process
//! 新增 `run_in_background` 一等公民后台（配套 bash_output / kill_shell），
//! 并带长驻命令前台护栏，避免再起服务挂死会话。

mod approval;
mod asset_graph_tools;
mod background;
mod browser_use;
mod command_safety;
mod shell_resolver;
mod edit_guard;
mod question;
mod task;
mod todo;
mod tool_budget;
mod web;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use pi::sdk::{default_tool_registry, Config, Tool, ToolFactory, ToolRegistry};

use super::browser_controller::SharedBrowserController;
use super::interactions::{InteractionHub, InteractionRisk};
use super::subagents::SubagentHost;

pub use approval::ApprovalTool;
pub use background::{BackgroundTaskRegistry, BashOutputTool, GiteamBashTool, KillShellTool};
pub use browser_use::BrowserUseTool;
pub use edit_guard::{EditGuardTool, ReadRecorderTool};
pub use question::QuestionTool;
pub use task::TaskTool;
pub use asset_graph_tools::{AssetContextTool, AssetPrecedentsTool, AssetSearchTool};
pub use todo::TodoTool;
pub use tool_budget::{ToolBudgetConfig, ToolBudgetTool};
pub use web::{WebFetchTool, WebSearchTool};

/// 基于 pi `default_tool_registry` 装配，写/执行类工具包装 ApprovalTool；
/// question/todowrite/task 与后台三件套（bash/bash_output/kill_shell）不是 pi 内置工具，按启用情况追加。
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
    /// enabled_tools 未显式指定（默认全量）或显式包含 "browser_use" 时为 true。
    browser_use_enabled: bool,
    /// enabled_tools 未显式指定（默认全量）或显式包含 "task" 时为 true；
    /// 实际注册还需要 `subagent_host`（子 agent 默认不注入 host，故不注册 task）。
    task_enabled: bool,
    /// 内置浏览器控制器；desktop 注入实现，CLI/control 为 None。
    browser_controller: SharedBrowserController,
    /// 后台任务日志目录（会话目录下）；no_session 模式为 None（落临时目录）。
    session_dir: Option<PathBuf>,
    /// 子 agent 宿主；主会话注入，plan 子会话为 None（禁止再委派）。
    subagent_host: Option<Arc<dyn SubagentHost>>,
    /// 工具结果预算（截断/落盘）；子 agent 用紧预算。
    tool_budget: Arc<ToolBudgetConfig>,
    /// 资产图谱工具（asset_context 等）：enabled_tools 未显式指定（默认全量）
    /// 或显式包含 "asset_context" 时为 true。子 agent 同样可用（只读）。
    asset_graph_enabled: bool,
}

impl GiteamToolFactory {
    #[must_use]
    pub fn new(
        hub: Arc<InteractionHub>,
        enabled_tools: Option<&[String]>,
        session_dir: Option<PathBuf>,
        browser_controller: SharedBrowserController,
        subagent_host: Option<Arc<dyn SubagentHost>>,
        tool_budget: ToolBudgetConfig,
    ) -> Self {
        let question_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "question"));
        let todo_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "todowrite"));
        let web_fetch_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "web_fetch"));
        let web_search_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "web_search"));
        let browser_use_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "browser_use"));
        let task_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "task"));
        let asset_graph_enabled = enabled_tools
            .is_none_or(|tools| tools.iter().any(|tool| tool == "asset_context"));
        Self {
            asset_graph_enabled,
            hub,
            question_enabled,
            todo_enabled,
            web_fetch_enabled,
            web_search_enabled,
            browser_use_enabled,
            task_enabled,
            browser_controller,
            session_dir,
            subagent_host,
            tool_budget: Arc::new(tool_budget),
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
        let wants_browser_use = enabled.contains(&"browser_use");
        let wants_task = enabled.contains(&"task");
        let builtin: Vec<&str> = enabled
            .iter()
            .copied()
            .filter(|name| {
                !matches!(
                    *name,
                    "question" | "todowrite" | "bash" | "bash_output" | "kill_shell"
                        | "web_fetch" | "web_search" | "browser_use" | "task"
                )
            })
            .collect();
        let tools = default_tool_registry(&builtin, cwd, config).into_tools();

        // 统一包装链：
        // 1) read → ReadRecorder；edit → EditGuard
        // 2) 全工具 → ToolBudget（截断/落盘；read 还钳制 limit）
        // 3) 写/执行类 → ApprovalTool（最外）
        // edit 路径：edit → EditGuard → ToolBudget → ApprovalTool。
        let wrap = |tool: Box<dyn Tool>| -> Box<dyn Tool> {
            let name = tool.name().to_string();
            let tool: Box<dyn Tool> = if name == "read" {
                Box::new(ReadRecorderTool::new(tool, Arc::clone(&self.hub)))
            } else if name == "edit" {
                Box::new(EditGuardTool::new(tool, Arc::clone(&self.hub)))
            } else {
                tool
            };
            let tool: Box<dyn Tool> =
                Box::new(ToolBudgetTool::new(tool, Arc::clone(&self.tool_budget)));
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
        // 资产图谱三件套：只读（InteractionRisk::Read，免审批）、自带 8KB
        // 输出限幅；与 Todo/Question 同模式不经 wrap（ToolBudget 面向大输出
        // 工具如 read/bash，这里无需再套）。
        if self.asset_graph_enabled {
            registry.push(Box::new(AssetContextTool::new(cwd.to_path_buf())));
            registry.push(Box::new(AssetSearchTool::new(cwd.to_path_buf())));
            registry.push(Box::new(AssetPrecedentsTool::new(cwd.to_path_buf())));
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
        // browser_use 经 wrap：InteractionRisk::for_tool 归 Network → 自动套 ApprovalTool。
        if self.browser_use_enabled || wants_browser_use {
            registry.push(wrap(Box::new(BrowserUseTool::new(self.browser_controller.clone()))));
        }
        // task：主会话全量或显式启用，且有 SubagentHost；子 agent 白名单不含 task / host=None。
        if (self.task_enabled || wants_task) && self.subagent_host.is_some() {
            let host = Arc::clone(self.subagent_host.as_ref().expect("checked above"));
            registry.push(Box::new(TaskTool::new(Arc::clone(&self.hub), host)));
        }
        registry
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_agent::interactions::InteractionStore;
    use crate::pi_agent::subagents::{
        SubagentHost, SubagentSpawnRequest, SubagentSpawnResult, PLAN_ENABLED_TOOLS,
    };
    use async_trait::async_trait;

    struct StubSubagentHost;

    #[async_trait]
    impl SubagentHost for StubSubagentHost {
        async fn run_subagent(
            &self,
            _request: SubagentSpawnRequest,
        ) -> std::result::Result<SubagentSpawnResult, String> {
            Err("stub".to_string())
        }

        async fn run_extraction_completion(
            &self,
            _request: crate::pi_agent::ExtractionCompletionRequest,
        ) -> std::result::Result<crate::pi_agent::ExtractionCompletionResult, String> {
            Err("stub".to_string())
        }
    }

    fn make_factory(enabled_tools: Option<&[String]>) -> GiteamToolFactory {
        let hub = Arc::new(InteractionHub::new(Arc::new(InteractionStore::new())));
        GiteamToolFactory::new(
            hub,
            enabled_tools,
            None,
            None,
            None,
            ToolBudgetConfig::for_primary(None),
        )
    }

    fn make_factory_with_host(enabled_tools: Option<&[String]>) -> GiteamToolFactory {
        let hub = Arc::new(InteractionHub::new(Arc::new(InteractionStore::new())));
        let host: Arc<dyn SubagentHost> = Arc::new(StubSubagentHost);
        GiteamToolFactory::new(
            hub,
            enabled_tools,
            None,
            None,
            Some(host),
            ToolBudgetConfig::for_primary(None),
        )
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

    #[test]
    fn factory_full_tools_registers_task_when_host_present() {
        let factory = make_factory_with_host(None);
        let enabled: Vec<&str> = super::super::prompt::ALL_BUILTIN_TOOLS.to_vec();
        let cwd = std::env::temp_dir();
        let registry = factory.create_tool_registry(&enabled, &cwd, &Config::default());
        let names = tool_names(&registry);
        assert!(names.contains(&"task".to_string()), "{names:?}");
        assert!(!InteractionRisk::for_tool("task").requires_approval());
    }

    #[test]
    fn factory_plan_whitelist_omits_task() {
        let enabled_tools: Vec<String> = PLAN_ENABLED_TOOLS
            .iter()
            .map(|name| (*name).to_string())
            .collect();
        // 即便误传 host，plan 白名单也不含 task → 不注册。
        let factory = make_factory_with_host(Some(&enabled_tools));
        let enabled: Vec<&str> = enabled_tools.iter().map(String::as_str).collect();
        let cwd = std::env::temp_dir();
        let registry = factory.create_tool_registry(&enabled, &cwd, &Config::default());
        let names = tool_names(&registry);
        assert!(!names.contains(&"task".to_string()), "{names:?}");
        for name in PLAN_ENABLED_TOOLS {
            assert!(
                names.contains(&(*name).to_string()),
                "missing {name} in {names:?}"
            );
        }
    }

    #[test]
    fn factory_omits_task_without_host() {
        let factory = make_factory(None);
        let enabled: Vec<&str> = super::super::prompt::ALL_BUILTIN_TOOLS.to_vec();
        let cwd = std::env::temp_dir();
        let registry = factory.create_tool_registry(&enabled, &cwd, &Config::default());
        let names = tool_names(&registry);
        assert!(!names.contains(&"task".to_string()), "{names:?}");
    }
}

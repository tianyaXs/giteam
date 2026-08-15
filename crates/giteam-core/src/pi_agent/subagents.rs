//! 内置子 agent 类型目录（对齐 Hermes `delegate_task` 模式）。
//!
//! 主会话默认全工具；需要只读规划时通过 `task` 工具同步 spawn `plan` 子 session。
//! 子 agent 使用 **ephemeral 系统提示**（goal + context + 交付摘要），不继承主会话
//! 「尽早 todowrite」等父级指南——否则首轮会浪费在写待办上、真正调研被挤到第二轮。

use async_trait::async_trait;

/// Plan 白名单：只读探索 + 提问 + 网络查阅。
/// 不含 `todowrite` / `task`（leaf 禁止再委派）。
pub const PLAN_ENABLED_TOOLS: &[&str] = &[
    "read",
    "grep",
    "find",
    "ls",
    "question",
    "web_fetch",
    "web_search",
];

/// 子 agent 墙钟超时（秒）：绝对上限（Hermes 旧默认 600）。
/// 可用环境变量 `GITEAM_SUBAGENT_TIMEOUT_SECS` 覆盖；`0` = 不限时。
pub const DEFAULT_CHILD_TIMEOUT_SECS: u64 = 600;

/// 子 agent 无进展超时（秒）：长时间无工具/无流式输出才判死（Hermes stall 方向）。
/// 可用 `GITEAM_SUBAGENT_STALL_SECS` 覆盖；`0` = 关闭 stall（只靠墙钟）。
pub const DEFAULT_CHILD_STALL_SECS: u64 = 240;

/// 批并行上限，对齐 Hermes `delegation.max_concurrent_children` 默认 3。
pub const MAX_CONCURRENT_CHILDREN: usize = 3;

/// Plan 角色附加规则（写入 ephemeral 系统提示，不是父级 append）。
const PLAN_ROLE_RULES: &str = "\
You are a planning subagent. Explore the codebase and return an actionable plan.\n\
Do NOT create, edit, or delete files. Do NOT run mutating shell commands.\n\
Start immediately with read/grep/find/ls — do not spend the first turn on checklists or narration.\n\
Prefer concrete file/symbol lookups over outlining a plan before you have evidence.\n\
Context budget: prefer grep/find/ls before large reads; keep each read small \
(limit ≤ 200, page with offset). Never dump whole files with limit 2000. \
If a tool result was truncated or spilled to disk, continue with a smaller window \
instead of re-reading the same huge range.\n\
Ask clarifying questions only when a requirement is truly ambiguous.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubagentType {
    Plan,
}

impl SubagentType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubagentDefinition {
    pub subagent_type: SubagentType,
    pub enabled_tools: Vec<String>,
}

/// 解析内置 `subagent_type`；未知类型返回错误文案（供 task 工具回传模型）。
pub fn resolve(subagent_type: &str) -> Result<SubagentDefinition, String> {
    let normalized = subagent_type.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "plan" => Ok(SubagentDefinition {
            subagent_type: SubagentType::Plan,
            enabled_tools: PLAN_ENABLED_TOOLS
                .iter()
                .map(|name| (*name).to_string())
                .collect(),
        }),
        "" => Err("subagent_type is required (supported: plan)".to_string()),
        other => Err(format!(
            "unknown subagent_type '{other}' (supported: plan)"
        )),
    }
}

/// Hermes 式子 agent 系统提示：任务专用，不带父级 todowrite/主 agent 指南。
///
/// 对照 `hermes-agent/tools/delegate_tool.py::_build_child_system_prompt`。
#[must_use]
pub fn build_child_system_prompt(
    definition: &SubagentDefinition,
    goal: &str,
    context: Option<&str>,
    workspace: Option<&str>,
) -> String {
    let mut parts = vec![
        "You are a focused subagent working on a specific delegated task.".to_string(),
        String::new(),
        format!("YOUR TASK:\n{}", goal.trim()),
    ];
    if let Some(ctx) = context.map(str::trim).filter(|text| !text.is_empty()) {
        parts.push(format!("\nCONTEXT:\n{ctx}"));
    }
    if let Some(path) = workspace.map(str::trim).filter(|text| !text.is_empty()) {
        parts.push(format!(
            "\nWORKSPACE PATH:\n{path}\n\
Use this exact path for local repository/workdir operations unless the task explicitly says otherwise."
        ));
    }
    match definition.subagent_type {
        SubagentType::Plan => {
            parts.push(format!("\n{PLAN_ROLE_RULES}"));
        }
    }
    parts.push(
        "\nComplete this task using the tools available to you. \
When finished, provide a clear, concise summary of:\n\
- What you did\n\
- What you found or accomplished\n\
- Key file paths and symbols\n\
- A concrete implementation plan the parent agent can execute (steps, files, risks)\n\
- Any issues or unresolved questions\n\n\
Be thorough but concise — your response is returned to the parent agent as a summary. \
Do not ask the parent to switch modes; just deliver the plan."
            .to_string(),
    );
    parts.join("\n")
}

/// 解析子 agent 墙钟超时；环境变量优先。
#[must_use]
pub fn child_timeout_secs() -> Option<std::time::Duration> {
    let raw = std::env::var("GITEAM_SUBAGENT_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_CHILD_TIMEOUT_SECS);
    if raw == 0 {
        None
    } else {
        Some(std::time::Duration::from_secs(raw))
    }
}

/// 解析子 agent 无进展超时；环境变量优先。
#[must_use]
pub fn child_stall_secs() -> Option<std::time::Duration> {
    let raw = std::env::var("GITEAM_SUBAGENT_STALL_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_CHILD_STALL_SECS);
    if raw == 0 {
        None
    } else {
        Some(std::time::Duration::from_secs(raw))
    }
}

/// TaskTool → PiAgentService 的 spawn 请求。
#[derive(Debug, Clone)]
pub struct SubagentSpawnRequest {
    pub parent_session_id: String,
    /// 父工具 call id；批并行时为 `{parent}:{index}`，便于 UI 分卡。
    pub parent_tool_call_id: String,
    /// UI 短标题（Hermes 用 goal 兼任；我们单独保留描述）。
    pub description: String,
    /// 子 agent 的 goal（作为 user message + 系统提示 YOUR TASK）。
    pub prompt: String,
    /// 可选背景（Hermes `context`）；不进 user message 正文时可放约束/路径。
    pub context: String,
    pub subagent_type: String,
}

/// 子 agent 跑完后回给父模型的摘要结果（UI 细节走 subagent.* 事件）。
#[derive(Debug, Clone)]
pub struct SubagentSpawnResult {
    pub child_session_id: String,
    pub child_run_id: String,
    pub summary: String,
    pub tool_count: u32,
    pub elapsed_ms: u64,
}

/// 由 service 实现；TaskTool 只依赖此 trait，避免工具层直接耦合 service 细节。
#[async_trait]
pub trait SubagentHost: Send + Sync {
    async fn run_subagent(
        &self,
        request: SubagentSpawnRequest,
    ) -> Result<SubagentSpawnResult, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_plan_type_returns_whitelist_without_task_or_todo() {
        let def = resolve("plan").expect("plan");
        assert_eq!(def.subagent_type, SubagentType::Plan);
        assert_eq!(
            def.enabled_tools,
            PLAN_ENABLED_TOOLS
                .iter()
                .map(|name| (*name).to_string())
                .collect::<Vec<_>>()
        );
        assert!(!def.enabled_tools.iter().any(|tool| tool == "task"));
        assert!(!def.enabled_tools.iter().any(|tool| tool == "todowrite"));
    }

    #[test]
    fn child_system_prompt_is_hermes_style_focused() {
        let def = resolve("plan").expect("plan");
        let prompt = build_child_system_prompt(
            &def,
            "调研会话创建",
            Some("只读，不要改文件"),
            Some("/tmp/repo"),
        );
        assert!(prompt.contains("focused subagent"));
        assert!(prompt.contains("YOUR TASK:\n调研会话创建"));
        assert!(prompt.contains("CONTEXT:\n只读，不要改文件"));
        assert!(prompt.contains("WORKSPACE PATH:\n/tmp/repo"));
        assert!(prompt.contains("Start immediately with read/grep/find/ls"));
        assert!(prompt.contains("Context budget"));
        assert!(prompt.contains("returned to the parent agent as a summary"));
        assert!(!prompt.contains("todowrite"));
        assert!(!prompt.contains("switching to Build"));
    }

    #[test]
    fn resolve_rejects_unknown_type() {
        assert!(resolve("build").is_err());
        assert!(resolve("").is_err());
    }
}

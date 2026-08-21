//! 内置子 agent 类型目录（对齐 Hermes `delegate_task` 模式）。
//!
//! 主会话默认全工具；需要只读规划时通过 `task` 工具同步 spawn `plan` 子 session。
//! 子 agent 使用 **ephemeral 系统提示**（goal + context + 交付摘要），不继承主会话
//! 「尽早 todowrite」等父级指南——否则首轮会浪费在写待办上、真正调研被挤到第二轮。

use async_trait::async_trait;

/// Plan 白名单：只读探索 + 网络查阅。
/// 不含 `todowrite` / `task`（leaf 禁止再委派），也**不含 `question`**：
/// 子会话的 interaction 事件只经 SubagentChildEvent 投影给父流，前端
/// 应答卡片只认主 sessionId——子代理提问永远等不到回答，只会挂到
/// stall 超时把整个 task 判死。歧义应带回摘要由父侧决策。
pub const PLAN_ENABLED_TOOLS: &[&str] = &[
    "read",
    "grep",
    "find",
    "ls",
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
Start exploring immediately — do not spend the first turn on checklists or narration.\n\
Prefer concrete file/symbol lookups over outlining a plan before you have evidence.\n\
Context budget: prefer grep/find/ls before large reads; keep each read small \
(limit ≤ 200, page with offset). Never dump whole files with limit 2000. \
If a tool result was truncated or spilled to disk, continue with a smaller window \
instead of re-reading the same huge range.\n\
You cannot ask the user questions — if a requirement is truly ambiguous, \
state the ambiguity and the candidate options in your final summary and let \
the parent agent decide.";

/// Extract 角色：从一轮会话记录中抽取语义实体/关系，输出严格 JSON。
/// 实体边界参照 semantica（NER 类型 + 决策智能字段）并适配代码仓库域。
pub const EXTRACT_ROLE_RULES: &str = "\
You are a knowledge-graph extraction subagent. You receive one turn of a coding \
agent session (user intent, assistant conclusion, tool actions) and must extract \
semantic entities and relations into STRICT JSON. \
Do NOT explore the repository. Do NOT call any tools. Answer with the JSON object \
and nothing else — no prose, no markdown fence. \
\
Entity types (extract ONLY these): \
- decision: a technical choice that was made (fields: title, category \
  [architecture|library|api|data|process|ui], scenario, reasoning, outcome, \
  confidence 0.0-1.0) \
- feature: a product capability or requirement being built/tracked \
- module: a code structural concept spanning files (e.g. \"pairing flow\", \
  \"event dispatch\") \
- tech_concept: a named technology or standard (Tauri, SQLite, MCP, tree-sitter…) \
- error_pattern: a semantic error class (borrow-checker failure, TS type \
  mismatch, network timeout) — NOT a raw message \
- api: an interface surface (HTTP endpoint, Tauri command, function contract) \
- tradeoff: an explicit alternative weighed and rejected (fields: chose, \
  rejected, because) \
- open_task: unfinished work, known issue, or TODO surfaced in the turn \
\
Relation types (subject and object must both appear in your entities or be a \
file path / session reference given in the input): \
decided, rationale, affects, implements, located_in, involves, pattern_of, \
exposes, blocked_by, similar_to, supersedes \
\
Rules: \
- Extract only what the text supports; NEVER invent. When nothing meaningful \
  is present, return {\"entities\":[],\"relations\":[]}. \
- Prefer 3-8 high-value entities over many weak ones. \
- When a new decision explicitly REPLACES an earlier one (\"改用X，弃用之前的Y\", \
  \"switch from Y to X\"), emit {\"type\":\"supersedes\",\"subject\":<new>,\"object\":<old>} \
  so the graph can retire the outdated decision. Also emit the new decision entity. \
- Every entity and relation MUST include \"confidence\" (0.0-1.0); omit guesses \
  below 0.4 entirely instead of emitting them. \
- Every entity and relation MUST include \"evidence\": a short verbatim quote \
  (<= 100 chars) copied EXACTLY from the input text that supports it — never \
  paraphrase evidence; entries with fabricated evidence are discarded. \
- Entity id = a short stable slug (lowercase ASCII hyphens, e.g. \"sqlite-asset-graph\"). \
  Reuse an Existing-entities id when the same concept appears — do not invent \
  a parallel slug. \
- Every entity MUST have a human-readable \"title\" in the same language as the \
  user (Chinese if the user wrote Chinese). NEVER use the id/slug as the title. \
  For tradeoff, title MUST summarize the choice \
  (e.g. \"选用 moka，弃用 Redis\" / \"Chose moka over Redis\"). \
- Emit dense typed relations for entities you keep — aim for roughly as many \
  relations as entities when files/alternatives are present: \
  decision→tech_concept decided; tradeoff→decision rationale; \
  feature|module→file implements or located_in; error_pattern→file pattern_of; \
  decision|feature→file affects; api→file|module exposes. \
- File references use the repo-relative path given in tool actions.";

/// 旁路抽取的墙钟超时（秒）。无工具，比 plan 子代理短；`GITEAM_EXTRACT_TIMEOUT_SECS` 可覆盖，`0`=不限。
pub const DEFAULT_EXTRACT_TIMEOUT_SECS: u64 = 120;

#[must_use]
pub fn extract_timeout_secs() -> Option<std::time::Duration> {
    let raw = std::env::var("GITEAM_EXTRACT_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_EXTRACT_TIMEOUT_SECS);
    if raw == 0 {
        None
    } else {
        Some(std::time::Duration::from_secs(raw))
    }
}

/// 旁路抽取专用系统提示（无工具、严格 JSON）。
#[must_use]
pub fn build_extract_system_prompt(workspace: Option<&str>) -> String {
    let mut parts = vec![
        "You are a focused knowledge-graph extraction worker.".to_string(),
        String::new(),
        EXTRACT_ROLE_RULES.to_string(),
    ];
    if let Some(path) = workspace.map(str::trim).filter(|text| !text.is_empty()) {
        parts.push(format!(
            "\nWORKSPACE PATH:\n{path}\n\
File paths in the input are relative to this workspace unless absolute."
        ));
    }
    parts.push(
        "\nTOOLS AVAILABLE TO YOU: (none). \
Do not attempt tool calls. Reply with the JSON object only.".to_string(),
    );
    parts.join("")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubagentType {
    Plan,
    Extract,
}

impl SubagentType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Extract => "extract",
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
        "extract" => Ok(SubagentDefinition {
            subagent_type: SubagentType::Extract,
            // 纯抽取：无工具——prompt 已带全部上下文，模型只输出 JSON。
            enabled_tools: Vec::new(),
        }),
        "" => Err("subagent_type is required (supported: plan, extract)".to_string()),
        other => Err(format!(
            "unknown subagent_type '{other}' (supported: plan, extract)"
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
        SubagentType::Extract => {
            parts.push(format!("\n{EXTRACT_ROLE_RULES}"));
        }
    }
    // 能力边界如实陈述（Hermes literal-truth 原则）：列出真实工具集并
    // 明示不可再委派，避免模型臆造 bash/编辑能力或嵌套委派后撞工具错误。
    // 只读探索工具天然独立，顺带告知可并行（与主会话 Workflow 节同源）。
    let tools_line = definition.enabled_tools.join(", ");
    parts.push(format!(
        "\nTOOLS AVAILABLE TO YOU: {tools_line}. \
You may issue several of them in one turn (they run in parallel). \
There is no bash and no file editing unless listed above, and you cannot spawn \
further subagents — do not attempt tools outside this list."
    ));
    parts.push(
        "\nComplete this task using the tools available to you. \
Never assume the repository lives at /workspace/ or any other container-style \
path unless the task or context explicitly gives that path.\n\
When finished, provide a clear, concise summary of:\n\
- What you did\n\
- What you found or accomplished\n\
- Key file paths and symbols\n\
- A concrete implementation plan the parent agent can execute (steps, files, risks)\n\
- Any issues or unresolved questions\n\n\
Lead with outcomes and prefer bullets over process narration — your response is \
returned to the parent agent as a summary, and overlong summaries crowd out the \
parent's context window. Do not ask the parent to switch modes; just deliver the plan."
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

/// 旁路语义抽取 completion 请求（无子会话投影、无工具、一次 LLM 调用）。
#[derive(Debug, Clone)]
pub struct ExtractionCompletionRequest {
    pub parent_session_id: String,
    pub extraction_id: String,
    /// 用户消息：ExtractionInput.build_prompt()（可含 known entities 段）。
    pub prompt: String,
}

/// 旁路抽取 completion 结果。
#[derive(Debug, Clone)]
pub struct ExtractionCompletionResult {
    pub summary: String,
    pub elapsed_ms: u64,
}

/// 旁路记忆抽取的父 run 事件发布句柄。
///
/// 在抽取开始时从父 hub 克隆 run context，贯穿整个异步抽取生命周期——
/// 即使主 turn / run 随后结束，仍能把 `memory.extraction.*` 推到原订阅流。
pub struct MemoryExtractionPublisher {
    context: crate::pi_agent::interactions::InteractionRunContext,
    extraction_id: String,
}

impl MemoryExtractionPublisher {
    #[must_use]
    pub fn new(
        context: crate::pi_agent::interactions::InteractionRunContext,
        extraction_id: impl Into<String>,
    ) -> Self {
        Self {
            context,
            extraction_id: extraction_id.into(),
        }
    }

    #[must_use]
    pub fn extraction_id(&self) -> &str {
        &self.extraction_id
    }

    pub fn started(&self) {
        self.context
            .publish(crate::pi_agent::AgentEvent::MemoryExtractionStarted {
                extraction_id: self.extraction_id.clone(),
            });
    }

    pub fn completed(
        &self,
        entity_count: u32,
        relation_count: u32,
        intent: Option<String>,
        entities: Vec<crate::pi_agent::MemoryExtractionEntity>,
        elapsed_ms: u64,
    ) {
        self.context
            .publish(crate::pi_agent::AgentEvent::MemoryExtractionCompleted {
                extraction_id: self.extraction_id.clone(),
                entity_count,
                relation_count,
                intent,
                entities,
                elapsed_ms,
            });
    }

    pub fn failed(&self, error: impl Into<String>, elapsed_ms: u64) {
        self.context
            .publish(crate::pi_agent::AgentEvent::MemoryExtractionFailed {
                extraction_id: self.extraction_id.clone(),
                error: error.into(),
                elapsed_ms,
            });
    }
}

/// 由 service 实现；TaskTool 只依赖此 trait，避免工具层直接耦合 service 细节。
#[async_trait]
pub trait SubagentHost: Send + Sync {
    async fn run_subagent(
        &self,
        request: SubagentSpawnRequest,
    ) -> Result<SubagentSpawnResult, String>;

    /// 旁路语义抽取：ephemeral 无工具 session + 单次 prompt，不投影 subagent.*。
    async fn run_extraction_completion(
        &self,
        request: ExtractionCompletionRequest,
    ) -> Result<ExtractionCompletionResult, String>;

    /// 为旁路记忆抽取绑定父 run 发布器；无活跃父 run 时返回 None（抽取仍可跑，只是无 UI 事件）。
    fn memory_extraction_publisher(
        &self,
        _parent_session_id: &str,
        _extraction_id: &str,
    ) -> Option<MemoryExtractionPublisher> {
        None
    }
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
        // question 是自毁按钮：子会话 interaction 无人应答，只会挂到 stall 判死。
        assert!(!def.enabled_tools.iter().any(|tool| tool == "question"));
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
        assert!(prompt.contains("Start exploring immediately"));
        assert!(prompt.contains("Context budget"));
        assert!(prompt.contains("returned to the parent agent as a summary"));
        // 防臆造路径与摘要紧凑护栏。
        assert!(prompt.contains("Never assume the repository lives at /workspace/"));
        assert!(prompt.contains("overlong summaries crowd out the parent's context window"));
        // 能力边界如实陈述：工具集 + 不可再委派。
        assert!(prompt.contains("TOOLS AVAILABLE TO YOU: read, grep, find, ls, web_fetch, web_search"));
        assert!(prompt.contains("you cannot spawn further subagents"));
        // 歧义处理：不能提问（interaction 无人应答），带回摘要由父决策。
        assert!(prompt.contains("You cannot ask the user questions"));
        assert!(prompt.contains("state the ambiguity and the candidate options in your final summary"));
        assert!(!prompt.contains("todowrite"));
        assert!(!prompt.contains("switching to Build"));
    }

    #[test]
    fn resolve_rejects_unknown_type() {
        assert!(resolve("build").is_err());
        assert!(resolve("").is_err());
    }
}


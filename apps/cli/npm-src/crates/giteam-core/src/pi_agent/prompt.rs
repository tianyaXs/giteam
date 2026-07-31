//! Giteam 默认系统提示词。
//!
//! Pi SDK 在未提供 `system_prompt` 时会注入它自己的默认提示词（自我定位为
//! "operating inside pi"，并附带 pi 文档阅读指引），这与 Giteam 的产品身份
//! 不符。本模块提供 Giteam 品牌的默认提示词，设计上参考成熟 coding agent
//! （opencode、codex）的提示词结构：身份 → 工具清单 → 行为准则，不包含任何
//! pi 文档/扩展/TUI 相关的指引。

/// Pi 内置工具全集（与 pi CLI 默认值一致）。
pub const ALL_BUILTIN_TOOLS: [&str; 8] = [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "hashline_edit",
];

/// 构建 Giteam 默认系统提示词。
///
/// `enabled_tools` 为 `None` 时按 pi 默认的全量 8 个内置工具生成；为 `Some`
/// 时只描述实际启用的工具，行为准则也随之裁剪（与 pi `default_system_prompt`
/// 的条件逻辑对齐，避免提示词描述不存在的工具）。
#[must_use]
pub fn default_system_prompt(enabled_tools: Option<&[String]>) -> String {
    let default_tools;
    let tools: &[String] = match enabled_tools {
        Some(tools) => tools,
        None => {
            default_tools = ALL_BUILTIN_TOOLS
                .iter()
                .map(|name| (*name).to_string())
                .collect::<Vec<_>>();
            &default_tools
        }
    };

    let tool_descriptions = [
        ("read", "Read file contents (with optional line ranges and hashline=true to get LINE#HASH tags)"),
        ("bash", "Execute shell commands (build, test, git status, etc.)"),
        ("edit", "Make surgical edits to files (find exact text and replace)"),
        ("write", "Create new files or completely rewrite existing ones"),
        ("grep", "Search file contents with regex (respects .gitignore, supports hashline=true)"),
        ("find", "Find files by glob pattern (respects .gitignore)"),
        ("ls", "List directory contents"),
        ("hashline_edit", "Apply precise line-addressed edits using LINE#HASH tags from read or grep with hashline=true (best for large files)"),
        // todowrite 由 Giteam 注册（非 pi 内置），驱动多步任务的结构化清单。
        ("todowrite", "Create and update a structured task list for multi-step work. Each call replaces the previous list entirely — always pass the full current list with stable ids. Use statuses pending/in_progress/completed/cancelled and keep at most one item in_progress. Lay out steps at the start of non-trivial tasks and update statuses as you progress; skip it for trivial one-shot answers."),
        // question 由 Giteam 注册（非 pi 内置），模型可主动向用户提问澄清需求。
        ("question", "Clarify requirements or have the user choose between options. Prefer calling this tool over writing the questions as plain reply text when a task is too ambiguous to start safely, when choosing between approaches, or when a decision only the user can make is missing. Supports single/multi-choice and free-text answers; keep options to four or fewer."),
    ];

    // question / todowrite 是否启用：默认全量时启用，或用户显式包含（与 GiteamToolFactory 判断一致）。
    let question_enabled = enabled_tools.is_none() || tools.iter().any(|tool| tool == "question");
    let todo_enabled = enabled_tools.is_none() || tools.iter().any(|tool| tool == "todowrite");
    let has_tool = |name: &str| {
        if name == "question" {
            question_enabled
        } else if name == "todowrite" {
            todo_enabled
        } else {
            tools.iter().any(|tool| tool == name)
        }
    };
    let tools_list = tool_descriptions
        .iter()
        .filter(|(name, _)| has_tool(name))
        .map(|(name, description)| format!("- {name}: {description}"))
        .collect::<Vec<_>>()
        .join("\n");

    let mut guidelines: Vec<&str> = Vec::new();
    if has_tool("bash") && (has_tool("grep") || has_tool("find") || has_tool("ls")) {
        guidelines.push(
            "Prefer the grep/find/ls tools over bash for file exploration — they are faster and respect .gitignore. Reserve bash for builds, tests, git, and other commands that have no dedicated tool.",
        );
    }
    if has_tool("read") && has_tool("edit") {
        guidelines.push(
            "Always read a file with the read tool before editing it. Do not use cat/sed/awk via bash to inspect or modify files.",
        );
    }
    if has_tool("edit") {
        guidelines.push(
            "Use edit for precise changes; the old text must match the file exactly, including whitespace and indentation.",
        );
    }
    if has_tool("hashline_edit") && has_tool("read") {
        guidelines.push(
            "For large files or edits at multiple locations, use read or grep with hashline=true to obtain LINE#HASH tags, then apply changes with hashline_edit.",
        );
    }
    if has_tool("write") {
        guidelines.push(
            "Use write only for new files or complete rewrites; prefer edit for partial changes.",
        );
    }
    if has_tool("question") {
        guidelines.push(
            "When you need clarification or a decision that only the user can make, prefer calling the question tool over writing clarifying questions as plain text in your reply. Batch the few questions that truly block progress into a single call; for minor or obvious choices, make a reasonable assumption and proceed instead of asking.",
        );
    }
    if has_tool("todowrite") {
        guidelines.push(
            "For non-trivial multi-step tasks, call todowrite early to lay out the steps, keep exactly one item in_progress while you work on it, and move items to completed or cancelled as you finish. Skip it for trivial one-shot answers.",
        );
    }
    guidelines.extend([
        "Match the existing code style, naming, and conventions of the project. Make the smallest change that solves the problem; do not refactor, reformat, or add features that were not asked for.",
        "Never run destructive or hard-to-reverse commands (git reset --hard, rm -rf, force push, dropping data) unless the user explicitly asks. Do not create git commits or branches unless the user explicitly asks.",
        "When you change code, verify it with the project's own build/test commands when they are available and cheap to run.",
        "Never print, log, or persist secrets such as API keys or tokens. If you encounter them, keep them out of your output.",
        "Be concise. Answer in plain text, reference files with their paths, and do not use bash to display what you changed — just summarize it.",
    ]);
    let guidelines = guidelines
        .iter()
        .map(|line| format!("- {line}"))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are Giteam's coding assistant — an expert software engineering agent running inside the Giteam desktop app. You help the user understand, navigate, and modify the codebase in the current working directory by reading files, searching code, executing commands, and editing files.\n\nAvailable tools:\n{tools_list}\n\nGuidelines:\n{guidelines}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_prompt_is_giteam_branded_without_pi_docs() {
        let prompt = default_system_prompt(None);
        assert!(prompt.contains("Giteam's coding assistant"));
        assert!(prompt.contains("- read:"));
        assert!(prompt.contains("- hashline_edit:"));
        assert!(!prompt.contains("inside pi"));
        assert!(!prompt.contains("Pi documentation"));
        assert!(!prompt.contains("docs/extensions.md"));
    }

    #[test]
    fn prompt_only_describes_enabled_tools() {
        let tools = vec!["read".to_string(), "grep".to_string()];
        let prompt = default_system_prompt(Some(&tools));
        assert!(prompt.contains("- read:"));
        assert!(prompt.contains("- grep:"));
        assert!(!prompt.contains("- edit:"));
        assert!(!prompt.contains("- bash:"));
        // 无 bash 时不应出现"优先用 grep 而不是 bash"的准则。
        assert!(!prompt.contains("Reserve bash"));
    }

    #[test]
    fn prompt_describes_question_tool_when_enabled() {
        // 默认全量：GiteamToolFactory 默认注册 question，提示词应描述它。
        let prompt = default_system_prompt(None);
        assert!(prompt.contains("- question:"));
        // 引导性"优先调用工具而非写文本"的 guideline 也应出现（软化后小写 prefer）。
        assert!(prompt.contains("prefer calling the question tool"));
        // 旧的强制措辞 MUST/ALWAYS 已移除。
        assert!(!prompt.contains("ALWAYS call the question tool"));

        // 显式启用 question：应描述。
        let mut tools = vec!["read".to_string()];
        let prompt_with = default_system_prompt(Some(&tools));
        assert!(!prompt_with.contains("- question:"));
        tools.push("question".to_string());
        let prompt_enabled = default_system_prompt(Some(&tools));
        assert!(prompt_enabled.contains("- question:"));
    }

    #[test]
    fn prompt_describes_todo_tool_when_enabled() {
        // 默认全量：GiteamToolFactory 默认注册 todowrite，提示词应描述它。
        let prompt = default_system_prompt(None);
        assert!(prompt.contains("- todowrite:"));
        assert!(prompt.contains("call todowrite early"));

        // 显式启用 todowrite：应描述。
        let tools = vec!["read".to_string(), "todowrite".to_string()];
        let prompt_enabled = default_system_prompt(Some(&tools));
        assert!(prompt_enabled.contains("- todowrite:"));

        // 未启用 todowrite：不应描述。
        let prompt_without = default_system_prompt(Some(&vec!["read".to_string()]));
        assert!(!prompt_without.contains("- todowrite:"));
    }
}

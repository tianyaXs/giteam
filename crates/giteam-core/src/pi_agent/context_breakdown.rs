//! 上下文窗口分类占用（chars÷4 估计），供 Composer 浮层对齐 Cursor 风分类统计。

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::environment::build_workspace_context;
use super::project_memory::read_project_memory;
use super::prompt::{default_system_prompt, model_discipline_prompt};
use super::prompt_assembly::estimate_tokens;
use super::runtime_context::build_runtime_snapshot;
use super::skills::build_skills_prompt;
use super::messages::AgentTokenUsage;

pub const ESTIMATOR_CHARS_DIV_4: &str = "chars_div_4";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContextCategoryId {
    System,
    Rules,
    Skills,
    Workspace,
    Tools,
    Mcp,
    Runtime,
    Summary,
    Conversation,
}

impl ContextCategoryId {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Rules => "rules",
            Self::Skills => "skills",
            Self::Workspace => "workspace",
            Self::Tools => "tools",
            Self::Mcp => "mcp",
            Self::Runtime => "runtime",
            Self::Summary => "summary",
            Self::Conversation => "conversation",
        }
    }

    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::System => "System prompt",
            Self::Rules => "Rules",
            Self::Skills => "Skills",
            Self::Workspace => "Workspace",
            Self::Tools => "Tool definitions",
            Self::Mcp => "MCP & dynamic tools",
            Self::Runtime => "Runtime context",
            Self::Summary => "Summarized conversation",
            Self::Conversation => "Conversation",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCategoryUsage {
    pub id: ContextCategoryId,
    pub label: String,
    pub estimated_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBreakdown {
    pub estimated_total: u64,
    pub billed_prompt: u64,
    pub categories: Vec<ContextCategoryUsage>,
    pub estimator: String,
}

#[derive(Debug, Clone)]
pub struct ContextBreakdownInput<'a> {
    pub repo_path: &'a Path,
    pub enabled_tools: Option<&'a [String]>,
    pub provider: Option<&'a str>,
    pub model: Option<&'a str>,
    pub session_kind: &'a str,
    pub runtime_extra: Option<&'a str>,
    pub sandbox_text: Option<&'a str>,
    pub digest: Option<&'a str>,
    pub summary: Option<&'a str>,
    /// 工具 schema 估计：`(tools_tokens, mcp_tokens)`。
    pub tool_schema_tokens: (u64, u64),
    pub billed_prompt: u64,
}

fn category(id: ContextCategoryId, tokens: u64) -> Option<ContextCategoryUsage> {
    if tokens == 0 {
        return None;
    }
    Some(ContextCategoryUsage {
        id,
        label: id.label().to_string(),
        estimated_tokens: tokens,
    })
}

fn tokens_of(text: &str) -> u64 {
    estimate_tokens(text) as u64
}

/// 从装配分段 + 工具 schema + billed prompt 残差合成分类占用。
#[must_use]
pub fn build_context_breakdown(input: ContextBreakdownInput<'_>) -> ContextBreakdown {
    let can_execute = match input.enabled_tools {
        None => true,
        Some(tools) => tools
            .iter()
            .any(|tool| tool == "bash" || tool == "edit" || tool == "write"),
    };

    let mut system = default_system_prompt(input.enabled_tools);
    if let Some(discipline) =
        model_discipline_prompt(input.provider, input.model)
    {
        if !system.is_empty() {
            system.push_str("\n\n");
        }
        system.push_str(&discipline);
    }

    let rules = read_project_memory(input.repo_path)
        .map(|memory| format!("# 项目记忆 (GITEAM.md)\n{memory}"))
        .unwrap_or_default();

    let skills = if input.session_kind == "subagent" {
        String::new()
    } else {
        build_skills_prompt(input.repo_path).unwrap_or_default()
    };

    let workspace = build_workspace_context(input.repo_path, can_execute);
    let runtime = build_runtime_snapshot(
        input.sandbox_text.map(str::to_string),
        input.digest.map(str::to_string),
        input.runtime_extra,
    );
    let summary = input.summary.unwrap_or("").to_string();

    let system_tokens = tokens_of(&system);
    let rules_tokens = tokens_of(&rules);
    let skills_tokens = tokens_of(&skills);
    let workspace_tokens = tokens_of(&workspace);
    let runtime_tokens = tokens_of(&runtime);
    let summary_tokens = tokens_of(&summary);
    let (tools_tokens, mcp_tokens) = input.tool_schema_tokens;

    let fixed = system_tokens
        .saturating_add(rules_tokens)
        .saturating_add(skills_tokens)
        .saturating_add(workspace_tokens)
        .saturating_add(tools_tokens)
        .saturating_add(mcp_tokens)
        .saturating_add(runtime_tokens)
        .saturating_add(summary_tokens);

    // 残差对齐账单 prompt：把无法在边界截获的 pi Project Context / 历史对话
    // 全部归入 conversation，避免估计合计漂离 billed。
    let conversation_tokens = input.billed_prompt.saturating_sub(fixed);

    let mut categories = Vec::new();
    for item in [
        category(ContextCategoryId::System, system_tokens),
        category(ContextCategoryId::Rules, rules_tokens),
        category(ContextCategoryId::Skills, skills_tokens),
        category(ContextCategoryId::Workspace, workspace_tokens),
        category(ContextCategoryId::Tools, tools_tokens),
        category(ContextCategoryId::Mcp, mcp_tokens),
        category(ContextCategoryId::Runtime, runtime_tokens),
        category(ContextCategoryId::Summary, summary_tokens),
        category(ContextCategoryId::Conversation, conversation_tokens),
    ]
    .into_iter()
    .flatten()
    {
        categories.push(item);
    }

    let estimated_total = categories
        .iter()
        .map(|row| row.estimated_tokens)
        .fold(0u64, u64::saturating_add);

    ContextBreakdown {
        estimated_total,
        billed_prompt: input.billed_prompt,
        categories,
        estimator: ESTIMATOR_CHARS_DIV_4.to_string(),
    }
}

/// 从 ToolRegistry 扫描 schema 体积，拆成内置工具 vs MCP。
#[must_use]
pub fn estimate_tool_schema_tokens(
    tools: &[(String, String, String)],
) -> (u64, u64) {
    let mut builtin = 0u64;
    let mut mcp = 0u64;
    for (name, description, parameters) in tools {
        let blob = format!("{name}\n{description}\n{parameters}");
        let tokens = tokens_of(&blob);
        if name.starts_with("mcp__") {
            mcp = mcp.saturating_add(tokens);
        } else {
            builtin = builtin.saturating_add(tokens);
        }
    }
    (builtin, mcp)
}

#[must_use]
pub fn billed_prompt_tokens(usage: &AgentTokenUsage) -> u64 {
    usage
        .input
        .saturating_add(usage.cache_read)
        .saturating_add(usage.cache_write)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn residual_conversation_keeps_total_aligned_with_billed() {
        let temp = tempfile::tempdir().expect("tempdir");
        let breakdown = build_context_breakdown(ContextBreakdownInput {
            repo_path: temp.path(),
            enabled_tools: None,
            provider: None,
            model: None,
            session_kind: "primary",
            runtime_extra: Some("MODE"),
            sandbox_text: Some("SANDBOX"),
            digest: Some("## 仓库近期变更上下文\n- a"),
            summary: None,
            tool_schema_tokens: (1_200, 300),
            billed_prompt: 50_000,
        });
        assert_eq!(breakdown.billed_prompt, 50_000);
        assert_eq!(breakdown.estimated_total, 50_000);
        assert!(breakdown
            .categories
            .iter()
            .any(|row| row.id == ContextCategoryId::Tools && row.estimated_tokens == 1_200));
        assert!(breakdown
            .categories
            .iter()
            .any(|row| row.id == ContextCategoryId::Mcp && row.estimated_tokens == 300));
        assert!(breakdown
            .categories
            .iter()
            .any(|row| row.id == ContextCategoryId::Conversation));
    }

    #[test]
    fn empty_optional_sections_are_omitted() {
        let temp = tempfile::tempdir().expect("tempdir");
        let breakdown = build_context_breakdown(ContextBreakdownInput {
            repo_path: temp.path(),
            enabled_tools: Some(&[]),
            provider: None,
            model: None,
            session_kind: "subagent",
            runtime_extra: None,
            sandbox_text: None,
            digest: None,
            summary: None,
            tool_schema_tokens: (0, 0),
            billed_prompt: 10,
        });
        assert!(!breakdown
            .categories
            .iter()
            .any(|row| row.id == ContextCategoryId::Skills));
        assert!(!breakdown
            .categories
            .iter()
            .any(|row| row.id == ContextCategoryId::Mcp));
    }

    #[test]
    fn tool_schema_split_respects_mcp_prefix() {
        let (tools, mcp) = estimate_tool_schema_tokens(&[
            ("read".into(), "Read files".into(), "{\"type\":\"object\"}".into()),
            (
                "mcp__browser__navigate".into(),
                "Navigate".into(),
                "{\"type\":\"object\"}".into(),
            ),
        ]);
        assert!(tools > 0);
        assert!(mcp > 0);
    }
}

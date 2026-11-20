//! 最终提示词装配顺序与粗粒度 token 估计（缓存治理回归用）。

use std::path::Path;

use super::environment::build_workspace_context;
use super::project_memory::read_project_memory;
use super::prompt::default_system_prompt;
use super::runtime_context::build_runtime_snapshot;
use super::skills::build_skills_prompt;

/// 稳定 system append 段顺序（不含 pi 自带的 Project Context / date / cwd）。
/// skills 走官方 `SessionOptions.skills_prompt`，不在 append 内。
pub const STABLE_APPEND_ORDER: &[&str] = &["memory", "workspace"];

/// 官方 skills 槽位（与 append 并列，见 `SessionOptions.skills_prompt`）。
pub const SKILLS_PROMPT_SECTION: &str = "skills";

/// 动态 runtime 段顺序（独立 Custom，不进 system）。
pub const RUNTIME_SECTION_ORDER: &[&str] = &["sandbox", "digest", "extra"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptAssemblyReport {
    pub stable_sections: Vec<&'static str>,
    pub runtime_sections: Vec<&'static str>,
    pub stable_chars: usize,
    pub runtime_chars: usize,
    /// 粗估：chars/4（非模型 tokenizer，仅预算信号）。
    pub estimated_stable_tokens: usize,
    pub estimated_runtime_tokens: usize,
}

#[must_use]
pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(4)
}

/// 采样当前仓库的稳定/动态装配占用（测试与诊断用）。
#[must_use]
pub fn sample_prompt_assembly(
    repo_path: &Path,
    sandbox_policy: Option<String>,
    digest: Option<String>,
    extra: Option<&str>,
) -> PromptAssemblyReport {
    let mut stable_parts: Vec<String> = Vec::new();
    let mut stable_sections = Vec::new();
    if let Some(memory) = read_project_memory(repo_path) {
        stable_parts.push(format!("# 项目记忆 (GITEAM.md)\n{memory}"));
        stable_sections.push("memory");
    }
    stable_parts.push(build_workspace_context(repo_path, true));
    stable_sections.push("workspace");
    let skills = build_skills_prompt(repo_path);
    if skills.is_some() {
        stable_sections.push(SKILLS_PROMPT_SECTION);
    }
    let stable = {
        let mut base = default_system_prompt(None);
        if !stable_parts.is_empty() {
            if !base.is_empty() {
                base.push_str("\n\n");
            }
            base.push_str(&stable_parts.join("\n\n"));
        }
        if let Some(skills) = skills.as_deref() {
            if !base.is_empty() {
                base.push_str("\n\n");
            }
            base.push_str(skills);
        }
        base
    };
    let runtime = build_runtime_snapshot(sandbox_policy.clone(), digest, extra);
    let mut runtime_sections = Vec::new();
    if sandbox_policy
        .as_deref()
        .map(str::trim)
        .is_some_and(|text| !text.is_empty())
    {
        runtime_sections.push("sandbox");
    }
    if runtime.contains("## 仓库近期变更上下文") || runtime.contains("DIGEST") {
        runtime_sections.push("digest");
    }
    if extra.map(str::trim).is_some_and(|text| !text.is_empty()) {
        runtime_sections.push("extra");
    }
    PromptAssemblyReport {
        stable_sections,
        runtime_sections,
        stable_chars: stable.chars().count(),
        runtime_chars: runtime.chars().count(),
        estimated_stable_tokens: estimate_tokens(&stable),
        estimated_runtime_tokens: estimate_tokens(&runtime),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_order_constant_matches_policy() {
        assert_eq!(STABLE_APPEND_ORDER, &["memory", "workspace"]);
        assert_eq!(SKILLS_PROMPT_SECTION, "skills");
        assert_eq!(RUNTIME_SECTION_ORDER, &["sandbox", "digest", "extra"]);
    }

    #[test]
    fn sample_keeps_runtime_out_of_stable_sections() {
        let temp = tempfile::tempdir().expect("tempdir");
        let report = sample_prompt_assembly(
            temp.path(),
            Some("SANDBOX_POLICY".into()),
            Some("## 仓库近期变更上下文\n- x".into()),
            Some("MODE_POLICY"),
        );
        assert!(report.stable_sections.contains(&"workspace"));
        assert!(!report.stable_sections.iter().any(|s| *s == "digest"));
        assert_eq!(
            report.runtime_sections,
            vec!["sandbox", "digest", "extra"]
        );
        assert!(report.estimated_runtime_tokens > 0);
    }
}

//! MCP 工具名构造：`mcp__{sanitized_service}__{sanitized_tool}`。
//!
//! 快照（`McpToolSpec`）保留真实 `instance_id + tool_name`，调用不依赖展示名反查；
//! 同一暴露名出现两次视为配置错误，由 runtime 报 `NameCollision`，不静默覆盖。

/// 分段清洗：仅保留 `[A-Za-z0-9_]`，其余（含 `-`）折叠为单个 `-`，去掉首尾 `-`。
#[must_use]
pub fn sanitize_segment(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "x".to_string()
    } else {
        trimmed.to_string()
    }
}

/// 暴露给 Pi 的限定工具名。
#[must_use]
pub fn qualified_name(service_name: &str, tool_name: &str) -> String {
    format!(
        "mcp__{}__{}",
        sanitize_segment(service_name),
        sanitize_segment(tool_name)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_to_safe_segments() {
        assert_eq!(sanitize_segment("GitHub Repo!"), "GitHub-Repo");
        assert_eq!(sanitize_segment("a---b"), "a-b");
        assert_eq!(sanitize_segment("-lead-trail-"), "lead-trail");
        assert_eq!(sanitize_segment("///"), "x");
        assert_eq!(sanitize_segment("keep_case_123"), "keep_case_123");
    }

    #[test]
    fn qualified_name_uses_double_underscore() {
        assert_eq!(qualified_name("github", "list_repos"), "mcp__github__list_repos");
        assert_eq!(qualified_name("my srv", "tool.name"), "mcp__my-srv__tool-name");
    }
}

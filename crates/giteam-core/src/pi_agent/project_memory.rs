//! 项目记忆文件：从仓库目录向上查找 GITEAM.md，命中即把其内容作为项目
//! 规范注入系统提示词。无配置、无副作用，纯文件查找。
//!
//! 设计参考 Claude Code 的 CLAUDE.md 与 codex 的 AGENTS.md 约定：agent 启动时
//! 自动加载项目根的规范文件，零配置获得项目特定的编码/流程约束。
//!
//! 注意：AGENTS.md/CLAUDE.md 不在此回退读取——pi 底座自身的
//! `# Project Context` 注入会收集 cwd 及祖先目录的这些文件；若此处也读，
//! 同一文件会被双重注入（内容冲突 + token 浪费）。

use std::fs;
use std::path::{Path, PathBuf};

/// Giteam 原生记忆文件名。
const GITEAM_MEMORY_FILE: &str = "GITEAM.md";

/// 记忆注入预算（对照 codex `project_doc_max_bytes`）：超限截断，
/// 防止巨大的规范文件撑爆 system prompt。
const MAX_MEMORY_BYTES: usize = 32 * 1024;

/// 截断标记：让模型知道内容被裁而非原文如此。
const TRUNCATION_NOTICE: &str = "\n\n[GITEAM.md truncated — file exceeds the 32 KiB injection budget]";

/// 从 `repo_path` 起向上逐级目录查找 GITEAM.md，返回其（去首尾空白后
/// 非空的）内容。整条向上路径都未命中时返回 `None`。
#[must_use]
pub fn read_project_memory(repo_path: &Path) -> Option<String> {
    find_memory_file(repo_path).and_then(|path| read_trimmed(&path))
}

fn find_memory_file(start: &Path) -> Option<PathBuf> {
    // canonicalize 失败（路径不存在/无权限）时退回原路径，查找逻辑照常进行。
    let base = fs::canonicalize(start).unwrap_or_else(|_| start.to_path_buf());
    let mut current: Option<&Path> = if base.is_file() {
        base.parent()
    } else {
        Some(base.as_path())
    };
    while let Some(dir) = current {
        let giteam = dir.join(GITEAM_MEMORY_FILE);
        if giteam.is_file() {
            return Some(giteam);
        }
        current = dir.parent();
    }
    None
}

fn read_trimmed(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(truncate_to_budget(trimmed))
    }
}

/// 超预算时截到字节预算内（回退到 UTF-8 字符边界）并附截断标记。
fn truncate_to_budget(text: &str) -> String {
    if text.len() <= MAX_MEMORY_BYTES {
        return text.to_string();
    }
    let mut end = MAX_MEMORY_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{TRUNCATION_NOTICE}", &text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("giteam-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn finds_giteam_md_walking_up_from_nested_dir() {
        let root = unique_dir("pm-walkup");
        let nested = root.join("a").join("b");
        fs::create_dir_all(&nested).expect("create nested dirs");
        fs::write(root.join(GITEAM_MEMORY_FILE), "  规范：禁止裸 git commit  ")
            .expect("write GITEAM.md");

        let memory = read_project_memory(&nested).expect("should find GITEAM.md walking up");
        assert_eq!(memory, "规范：禁止裸 git commit");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn giteam_md_takes_precedence_and_agents_md_is_left_to_pi() {
        let root = unique_dir("pm-precedence");
        // AGENTS.md 存在也不读取：pi 的 # Project Context 通道负责注入它，
        // 此处再读会双重注入。
        fs::write(root.join("AGENTS.md"), "legacy").expect("write AGENTS.md");
        fs::write(root.join(GITEAM_MEMORY_FILE), "canonical").expect("write GITEAM.md");

        let memory = read_project_memory(&root).expect("should find memory");
        assert_eq!(memory, "canonical");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn agents_md_alone_is_not_read_by_giteam() {
        let root = unique_dir("pm-agents");
        fs::write(root.join("AGENTS.md"), "agents rules").expect("write AGENTS.md");

        assert!(read_project_memory(&root).is_none());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn returns_none_when_no_memory_file_anywhere_upward() {
        let root = unique_dir("pm-none");
        assert!(read_project_memory(&root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ignores_empty_or_whitespace_only_memory_file() {
        let root = unique_dir("pm-empty");
        fs::write(root.join(GITEAM_MEMORY_FILE), "   \n\t  \n").expect("write empty GITEAM.md");
        assert!(read_project_memory(&root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn oversized_memory_is_truncated_to_budget() {
        let root = unique_dir("pm-truncate");
        // 超预算的多字节内容（中文 3 字节/字）：验证截断落在字符边界且带标记。
        let oversized = "规范条目。".repeat(10_000);
        fs::write(root.join(GITEAM_MEMORY_FILE), &oversized).expect("write oversized GITEAM.md");

        let memory = read_project_memory(&root).expect("should read and truncate");
        assert!(memory.ends_with(TRUNCATION_NOTICE));
        assert!(memory.len() <= MAX_MEMORY_BYTES + TRUNCATION_NOTICE.len());
        // 截断保留的是原文前缀（trim 后），内容未重排。
        let body = memory.trim_end_matches(TRUNCATION_NOTICE).trim_end();
        assert!(oversized.trim().starts_with(body));

        let _ = fs::remove_dir_all(&root);
    }
}

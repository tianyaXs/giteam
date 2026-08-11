//! 项目记忆文件：从仓库目录向上查找 GITEAM.md（优先）或 AGENTS.md（回退），
//! 命中即把其内容作为项目规范注入系统提示词。无配置、无副作用，纯文件查找。
//!
//! 设计参考 Claude Code 的 CLAUDE.md 与 codex 的 AGENTS.md 约定：agent 启动时
//! 自动加载项目根的规范文件，零配置获得项目特定的编码/流程约束。

use std::fs;
use std::path::{Path, PathBuf};

/// Giteam 原生记忆文件名（优先）。
const GITEAM_MEMORY_FILE: &str = "GITEAM.md";
/// 业界通用回退文件名（AGENTS.md 约定）。
const AGENTS_MEMORY_FILE: &str = "AGENTS.md";

/// 从 `repo_path` 起向上逐级目录查找项目记忆文件：
/// 命中 GITEAM.md 即返回其（去首尾空白后非空的）内容；否则回退 AGENTS.md。
/// 整条向上路径都未命中时返回 `None`。
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
        let agents = dir.join(AGENTS_MEMORY_FILE);
        if agents.is_file() {
            return Some(agents);
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
        Some(trimmed.to_string())
    }
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
    fn giteam_md_takes_precedence_over_agents_md() {
        let root = unique_dir("pm-precedence");
        fs::write(root.join(AGENTS_MEMORY_FILE), "legacy").expect("write AGENTS.md");
        fs::write(root.join(GITEAM_MEMORY_FILE), "canonical").expect("write GITEAM.md");

        let memory = read_project_memory(&root).expect("should find memory");
        assert_eq!(memory, "canonical");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn falls_back_to_agents_md_when_giteam_md_absent() {
        let root = unique_dir("pm-agents");
        fs::write(root.join(AGENTS_MEMORY_FILE), "agents rules").expect("write AGENTS.md");

        let memory = read_project_memory(&root).expect("should find AGENTS.md fallback");
        assert_eq!(memory, "agents rules");

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
}

//! 项目级权限规则持久化（对照 Claude Code 的 permissions 体系）。
//!
//! 规则文件：`{repo}/.giteam/permissions.json`，格式：
//! ```json
//! { "allow": ["bash:npm run build", "edit:src/main.rs", "read", ...] }
//! ```
//! 键格式与 [`super::interactions::always_rule_key`] 一致：bash→`bash:{command}`，
//! 写类工具→`{tool}:{path}`，其余→`{tool}`。
//! 加载时机：session 创建/恢复（hub 绑定 repo）；
//! 写入时机：用户「总是允许」(Always reply)，键带细粒度目标，跨会话/重启再生效。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const PERMISSIONS_FILE: &str = "permissions.json";

#[derive(Default, Serialize, Deserialize)]
struct PermissionsFile {
    #[serde(default)]
    allow: Vec<String>,
}

fn permissions_path(repo_path: &Path) -> PathBuf {
    repo_path.join(".giteam").join(PERMISSIONS_FILE)
}

/// 读取项目级 allow 规则；文件缺失/损坏返回空（fail-open，回退交互审批）。
pub fn load_allow_rules(repo_path: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(permissions_path(repo_path)) else {
        return Vec::new();
    };
    serde_json::from_str::<PermissionsFile>(&text)
        .map(|file| file.allow)
        .unwrap_or_default()
}

/// 追加一条 allow 规则并持久化；已存在则去重。目录/文件缺失自动创建，原子写避免并发损坏。
pub fn append_allow_rule(repo_path: &Path, key: &str) -> std::io::Result<()> {
    let path = permissions_path(repo_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = load_file(&path)?;
    if !file.allow.iter().any(|rule| rule == key) {
        file.allow.push(key.to_string());
        write_file(&path, &file)?;
    }
    Ok(())
}

fn load_file(path: &Path) -> std::io::Result<PermissionsFile> {
    match std::fs::read_to_string(path) {
        // 损坏回退空，避免阻塞审批（fail-open）。
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(PermissionsFile::default()),
        Err(err) => Err(err),
    }
}

fn write_file(path: &Path, file: &PermissionsFile) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(file)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, format!("{json}\n"))?;
    std::fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule_list(file: &PermissionsFile) -> &[String] {
        &file.allow
    }

    #[test]
    fn missing_file_yields_empty_rules() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_allow_rules(dir.path()).is_empty());
    }

    #[test]
    fn append_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        append_allow_rule(dir.path(), "bash:npm run build").unwrap();
        append_allow_rule(dir.path(), "read").unwrap();
        // 去重：重复追加不新增。
        append_allow_rule(dir.path(), "bash:npm run build").unwrap();
        let rules = load_allow_rules(dir.path());
        assert_eq!(rules, vec!["bash:npm run build".to_string(), "read".to_string()]);
        let _ = rule_list(&PermissionsFile::default());
    }

    #[test]
    fn corrupted_file_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = permissions_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not json").unwrap();
        assert!(load_allow_rules(dir.path()).is_empty());
    }
}

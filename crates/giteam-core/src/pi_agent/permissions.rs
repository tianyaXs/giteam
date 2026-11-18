//! 项目级权限规则持久化（对照 Claude Code 的 permissions 体系）。
//!
//! 规则文件：`{repo}/.giteam/permissions.json`，格式：
//! ```json
//! {
//!   "allow": ["bash:npm run build", "edit:src/main.rs", "read", ...],
//!   "deny": ["bash:rm -rf /", "edit:.env"]
//! }
//! ```
//! 键格式与 [`super::interactions::always_rule_key`] 一致：bash→`bash:{command}`，
//! 写类工具→`{tool}:{path}`，其余→`{tool}`。
//! deny 优先于 allow；损坏 JSON **fail-closed**（两边皆空，强制交互审批）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const PERMISSIONS_FILE: &str = "permissions.json";

#[derive(Default, Serialize, Deserialize)]
struct PermissionsFile {
    #[serde(default)]
    allow: Vec<String>,
    #[serde(default)]
    deny: Vec<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PermissionRules {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
}

fn permissions_path(repo_path: &Path) -> PathBuf {
    repo_path.join(".giteam").join(PERMISSIONS_FILE)
}

/// 读取项目级规则；文件缺失 → 空规则；损坏 → fail-closed 空规则（需人工审批）。
pub fn load_permission_rules(repo_path: &Path) -> PermissionRules {
    let Ok(text) = std::fs::read_to_string(permissions_path(repo_path)) else {
        return PermissionRules::default();
    };
    match serde_json::from_str::<PermissionsFile>(&text) {
        Ok(file) => PermissionRules {
            allow: file.allow,
            deny: file.deny,
        },
        Err(_) => PermissionRules::default(),
    }
}

/// 兼容旧调用：仅返回 allow 列表。
pub fn load_allow_rules(repo_path: &Path) -> Vec<String> {
    load_permission_rules(repo_path).allow
}

/// 读取 deny 列表。
pub fn load_deny_rules(repo_path: &Path) -> Vec<String> {
    load_permission_rules(repo_path).deny
}

/// `key` 是否被 deny（精确匹配或前缀 `tool:` 通配由调用方构造）。
#[must_use]
pub fn is_denied(rules: &PermissionRules, key: &str) -> bool {
    rules.deny.iter().any(|rule| rule == key)
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

/// 追加一条 deny 规则并持久化。
pub fn append_deny_rule(repo_path: &Path, key: &str) -> std::io::Result<()> {
    let path = permissions_path(repo_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = load_file(&path)?;
    if !file.deny.iter().any(|rule| rule == key) {
        file.deny.push(key.to_string());
        write_file(&path, &file)?;
    }
    Ok(())
}

fn load_file(path: &Path) -> std::io::Result<PermissionsFile> {
    match std::fs::read_to_string(path) {
        // 损坏回退空（fail-closed：无自动放行）。
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

    #[test]
    fn missing_file_yields_empty_rules() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_allow_rules(dir.path()).is_empty());
        assert!(load_deny_rules(dir.path()).is_empty());
    }

    #[test]
    fn append_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        append_allow_rule(dir.path(), "bash:npm run build").unwrap();
        append_allow_rule(dir.path(), "read").unwrap();
        append_deny_rule(dir.path(), "bash:rm -rf /").unwrap();
        append_allow_rule(dir.path(), "bash:npm run build").unwrap();
        let rules = load_permission_rules(dir.path());
        assert_eq!(
            rules.allow,
            vec!["bash:npm run build".to_string(), "read".to_string()]
        );
        assert_eq!(rules.deny, vec!["bash:rm -rf /".to_string()]);
        assert!(is_denied(&rules, "bash:rm -rf /"));
    }

    #[test]
    fn corrupted_file_yields_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = permissions_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not json").unwrap();
        assert!(load_allow_rules(dir.path()).is_empty());
        assert!(load_deny_rules(dir.path()).is_empty());
    }
}

//! Giteam 跨平台 secret store。
//!
//! 第一阶段实现为受文件权限保护的本地 vault（Unix `0600`），文件格式与 Pi
//! `auth.json` 对齐（`{"<provider>": {"type": "api_key", "key": "…"}}`），
//! 使 Pi `AuthStorage`/`ModelRegistry` 可以直接复用读取，OAuth 等高级凭据
//! 场景后续可零迁移接入。后续阶段可在同一接口下替换为 macOS Keychain、
//! Windows Credential Manager、Ubuntu Secret Service 等平台后端。
//!
//! 安全约束（迁移计划 §8.3）：
//! - api key/OAuth token 不进入普通 JSON catalog、session 文件、事件、日志、
//!   命令行参数或 Control 响应；
//! - 本模块所有 `Debug` 实现必须脱敏；
//! - 写入采用临时文件 + 原子 rename，失败不破坏既有凭据。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::PiAgentError;

/// 与 Pi `auth.json` 对齐的凭据文件：provider → credential JSON。
/// 未知凭据类型（OAuth、AWS、Bearer 等）以原始 JSON 保存，读写无损。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SecretFile {
    #[serde(flatten)]
    entries: HashMap<String, serde_json::Value>,
}

/// Giteam 统一 secret store。当前为文件后端，接口按平台后端可替换设计。
/// 本身只持有路径（无缓存），clone 代价极低且每次操作都回读磁盘，
/// 保证多写入方（Desktop/Control/CLI）不会看到过期的内存快照。
#[derive(Clone)]
pub struct SecretStore {
    path: PathBuf,
}

impl std::fmt::Debug for SecretStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SecretStore")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl SecretStore {
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Giteam 数据目录下的默认 vault 路径（跨平台）。
    ///
    /// 与 Pi `Config::auth_path()` 统一为同一文件：`PiAgentService` 初始化时
    /// 会把 `PI_CODING_AGENT_DIR` 指到 [`default_pi_agent_dir`]，于是 Pi 内部的
    /// `AuthStorage`/`ModelRegistry`（含 `set_model` 凭据解析、OAuth refresh）
    /// 与本 store 读写同一份 vault。若用户显式设置了 `PI_CODING_AGENT_DIR`，
    /// 尊重其指向（高级用户可借此与 pi CLI 共享环境）。
    #[must_use]
    pub fn default_path() -> Option<PathBuf> {
        let dir = std::env::var_os("PI_CODING_AGENT_DIR")
            .map(PathBuf::from)
            .or_else(default_pi_agent_dir)?;
        Some(dir.join("auth.json"))
    }

    /// 供 Pi `AuthStorage`/`ModelRegistry` 复用读取的 vault 路径。
    #[must_use]
    pub fn auth_file_path(&self) -> &Path {
        &self.path
    }

    /// 保存 provider 的 api key。同名 provider（大小写不敏感）覆盖写。
    pub fn set_api_key(&self, provider: &str, key: &str) -> Result<(), PiAgentError> {
        let provider = normalize_provider(provider);
        if provider.is_empty() {
            return Err(PiAgentError::Secret(
                "provider id must not be empty".to_string(),
            ));
        }
        if key.trim().is_empty() {
            return Err(PiAgentError::Secret("api key must not be empty".to_string()));
        }
        let mut file = self.read_file()?;
        remove_case_insensitive(&mut file.entries, &provider);
        file.entries.insert(
            provider,
            serde_json::json!({ "type": "api_key", "key": key }),
        );
        self.write_file(&file)
    }

    /// 读取 provider 的 api key（大小写不敏感）。仅返回内存中的短生命周期值，
    /// 调用方不得写入日志或持久化到 session/catalog。
    pub fn api_key(&self, provider: &str) -> Result<Option<String>, PiAgentError> {
        let file = self.read_file()?;
        Ok(file
            .entries
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(provider))
            .and_then(|(_, credential)| credential_key(credential)))
    }

    /// 是否已配置凭据（任意类型），不暴露凭据内容。供 provider catalog 标注。
    pub fn has_credential(&self, provider: &str) -> bool {
        self.read_file()
            .map(|file| {
                file.entries
                    .keys()
                    .any(|name| name.eq_ignore_ascii_case(provider))
            })
            .unwrap_or(false)
    }

    /// 删除 provider 凭据，返回是否存在。
    pub fn remove(&self, provider: &str) -> Result<bool, PiAgentError> {
        let mut file = self.read_file()?;
        let removed = remove_case_insensitive(&mut file.entries, &normalize_provider(provider));
        if removed {
            self.write_file(&file)?;
        }
        Ok(removed)
    }

    /// 列出已配置凭据的 provider id（不含凭据内容）。
    pub fn providers(&self) -> Result<Vec<String>, PiAgentError> {
        let file = self.read_file()?;
        let mut providers: Vec<String> = file.entries.keys().cloned().collect();
        providers.sort();
        Ok(providers)
    }

    fn read_file(&self) -> Result<SecretFile, PiAgentError> {
        let Ok(bytes) = fs::read(&self.path) else {
            return Ok(SecretFile::default());
        };
        serde_json::from_slice(&bytes).map_err(|error| {
            PiAgentError::Secret(format!("secret vault is corrupted: {error}"))
        })
    }

    fn write_file(&self, file: &SecretFile) -> Result<(), PiAgentError> {
        let parent = self.path.parent().ok_or_else(|| {
            PiAgentError::Secret("secret vault has no parent directory".to_string())
        })?;
        fs::create_dir_all(parent).map_err(|error| PiAgentError::Secret(error.to_string()))?;
        let payload = serde_json::to_vec_pretty(file)
            .map_err(|error| PiAgentError::Secret(error.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, payload).map_err(|error| PiAgentError::Secret(error.to_string()))?;
        restrict_permissions(&tmp)?;
        fs::rename(&tmp, &self.path).map_err(|error| PiAgentError::Secret(error.to_string()))?;
        Ok(())
    }
}

fn credential_key(credential: &serde_json::Value) -> Option<String> {
    let is_api_key = credential
        .get("type")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|kind| kind == "api_key");
    if !is_api_key {
        return None;
    }
    credential
        .get("key")
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
}

fn normalize_provider(provider: &str) -> String {
    provider.trim().to_string()
}

fn remove_case_insensitive(
    entries: &mut HashMap<String, serde_json::Value>,
    provider: &str,
) -> bool {
    let existing = entries
        .keys()
        .find(|name| name.eq_ignore_ascii_case(provider))
        .cloned();
    existing.is_some_and(|name| entries.remove(&name).is_some())
}

/// 仅 owner 可读写。Windows 上依赖用户配置目录 ACL，无 Unix 模式位。
#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), PiAgentError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| PiAgentError::Secret(error.to_string()))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<(), PiAgentError> {
    Ok(())
}

/// Giteam 管理的 Pi 全局目录（对应 Pi 的 `PI_CODING_AGENT_DIR`）。
///
/// 默认位于 Giteam 数据目录下的 `pi-agent/`，与 pi CLI 默认的 `~/.pi/agent`
/// 隔离；Pi 的 auth.json、settings.json、models.json 都落在其中。
#[must_use]
pub fn default_pi_agent_dir() -> Option<PathBuf> {
    default_data_dir().map(|dir| dir.join("pi-agent"))
}

/// 确保 `PI_CODING_AGENT_DIR` 指向 Giteam 管理的 Pi 目录（幂等）。
///
/// 必须在创建任何 Pi session/registry 之前调用；用户显式设置过该变量时不覆盖。
/// 返回生效的目录。
pub fn ensure_pi_agent_dir_env() -> Option<PathBuf> {
    if let Some(existing) = std::env::var_os("PI_CODING_AGENT_DIR") {
        let dir = PathBuf::from(existing);
        ensure_pi_retry_settings(&dir, 10);
        return Some(dir);
    }
    let dir = default_pi_agent_dir()?;
    std::env::set_var("PI_CODING_AGENT_DIR", &dir);
    ensure_pi_retry_settings(&dir, 10);
    Some(dir)
}

/// 幂等写入/合并 `{PI_CODING_AGENT_DIR}/settings.json` 的 retry 配置。
///
/// Giteam in-process prompt 也会读同一配置；产品要求默认最多自动重试 10 次。
pub fn ensure_pi_retry_settings(dir: &Path, max_retries: u32) {
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let path = dir.join("settings.json");
    let mut root = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<serde_json::Value>(&raw).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    let Some(obj) = root.as_object_mut() else {
        return;
    };
    let retry = obj.entry("retry").or_insert_with(|| serde_json::json!({}));
    let Some(retry_obj) = retry.as_object_mut() else {
        return;
    };
    retry_obj.insert("enabled".to_string(), serde_json::json!(true));
    retry_obj.insert("maxRetries".to_string(), serde_json::json!(max_retries));
    if let Ok(raw) = serde_json::to_string_pretty(&root) {
        let _ = fs::write(&path, format!("{raw}\n"));
    }
}

/// Giteam 跨平台数据目录（唯一权威根）。
///
/// 对齐 Codex（`~/.codex` + `CODEX_HOME`）等 coding CLI 惯例：
/// ```text
/// 默认：   ~/.giteam/
/// 覆盖：   $GITEAM_HOME（若设置且非空）
/// ```
/// 子目录约定：`pi-agent/`（auth/models）、`pi-sessions/`（catalog + 按仓库会话正文）、根级 `client.db` / `theme`。
///
/// 注意：仓库内的 `<repo>/.giteam/` 仅保留**项目级**附件等（如 `prompt-attachments/`），
/// Agent 会话 JSONL **不**再写入仓库旁，统一落在本全局根下。
#[must_use]
pub fn default_data_dir() -> Option<PathBuf> {
    if let Some(override_dir) = std::env::var_os("GITEAM_HOME") {
        let dir = PathBuf::from(override_dir);
        if !dir.as_os_str().is_empty() {
            return Some(dir);
        }
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".giteam"))
}

/// 确保权威数据根存在，返回路径。
pub fn ensure_data_dir() -> Option<PathBuf> {
    let dir = default_data_dir()?;
    if fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir)
}

/// 旧版平台 Application Support / XDG 数据根（迁到 `~/.giteam` 之前）。
#[must_use]
pub fn legacy_platform_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let home = PathBuf::from(home);
    #[cfg(target_os = "windows")]
    {
        let root = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        return Some(root.join("giteam"));
    }
    #[cfg(target_os = "macos")]
    {
        return Some(home.join("Library").join("Application Support").join("giteam"));
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let root = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"));
        Some(root.join("giteam"))
    }
}

/// Tauri 按 `identifier = io.giteam.desktop` 解析出的旧数据根。
#[must_use]
pub fn legacy_tauri_bundle_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let home = PathBuf::from(home);
    #[cfg(target_os = "windows")]
    {
        let root = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        return Some(root.join("io.giteam.desktop"));
    }
    #[cfg(target_os = "macos")]
    {
        return Some(
            home.join("Library")
                .join("Application Support")
                .join("io.giteam.desktop"),
        );
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let root = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"));
        Some(root.join("io.giteam.desktop"))
    }
}

fn copy_file_if_missing(from: &Path, to: &Path) {
    if to.exists() || !from.exists() {
        return;
    }
    if let Some(parent) = to.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::copy(from, to);
}

fn copy_dir_merge_missing(from: &Path, to: &Path) {
    if !from.is_dir() {
        return;
    }
    let _ = fs::create_dir_all(to);
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir_merge_missing(&src, &dst);
        } else {
            copy_file_if_missing(&src, &dst);
        }
    }
}

fn migrate_one_legacy_root(legacy: &Path, canonical: &Path) {
    if !legacy.exists() || legacy == canonical {
        return;
    }
    copy_file_if_missing(&legacy.join("theme"), &canonical.join("theme"));
    copy_file_if_missing(&legacy.join("client.db"), &canonical.join("client.db"));
    copy_file_if_missing(
        &legacy.join(".giteam").join("client.db"),
        &canonical.join("client.db"),
    );
    copy_file_if_missing(
        &legacy.join("pi-skill-source-groups.json"),
        &canonical.join("pi-skill-source-groups.json"),
    );
    copy_dir_merge_missing(&legacy.join("pi-agent"), &canonical.join("pi-agent"));
    copy_dir_merge_missing(&legacy.join("pi-sessions"), &canonical.join("pi-sessions"));
}

/// 一次性把旧数据根迁入权威 `~/.giteam`（幂等、不覆盖已有）。
///
/// 来源（按平台）：
/// - `~/Library/Application Support/giteam` / `%APPDATA%\giteam` / XDG `giteam`
/// - Tauri bundle id 目录 `io.giteam.desktop`
pub fn migrate_legacy_tauri_data_into_canonical() {
    let Some(canonical) = ensure_data_dir() else {
        return;
    };
    if let Some(legacy) = legacy_platform_data_dir() {
        migrate_one_legacy_root(&legacy, &canonical);
    }
    if let Some(legacy) = legacy_tauri_bundle_data_dir() {
        migrate_one_legacy_root(&legacy, &canonical);
    }
}

/// 全局会话根：`~/.giteam/pi-sessions/`（含 `catalog.json` 与 `repos/`）。
#[must_use]
pub fn pi_sessions_root() -> Option<PathBuf> {
    default_data_dir().map(|root| root.join("pi-sessions"))
}

/// 旧版仓库旁会话目录（迁移源）：`<repo>/.giteam/pi-sessions`。
#[must_use]
pub fn legacy_repo_pi_sessions_dir(repo_path: &Path) -> PathBuf {
    repo_path.join(".giteam").join("pi-sessions")
}

fn normalize_repo_path_key(repo_path: &Path) -> String {
    let canonical = fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
    let mut normalized = canonical.to_string_lossy().replace('\\', "/");
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    // macOS / Windows 路径大小写不敏感，统一小写避免同仓双目录。
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        normalized = normalized.to_lowercase();
    }
    normalized
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// 仓库隔离键：`<dirname>-<fnv1a64>`，稳定、可读、不依赖额外哈希 crate。
#[must_use]
pub fn repo_sessions_key(repo_path: &Path) -> String {
    let normalized = normalize_repo_path_key(repo_path);
    let digest = fnv1a64(normalized.as_bytes());
    let slug: String = repo_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .take(48)
        .collect();
    let slug = if slug.is_empty() {
        "repo".to_string()
    } else {
        slug
    };
    format!("{slug}-{digest:016x}")
}

/// 用户目录下按仓库隔离的会话目录：`~/.giteam/pi-sessions/repos/<key>/`。
#[must_use]
pub fn pi_sessions_dir_for_repo(repo_path: &Path) -> Option<PathBuf> {
    Some(
        pi_sessions_root()?
            .join("repos")
            .join(repo_sessions_key(repo_path)),
    )
}

pub(crate) fn write_repo_sessions_meta(session_dir: &Path, repo_path: &Path) {
    let meta_path = session_dir.join("repo.json");
    let canonical = fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
    let payload = serde_json::json!({
        "schemaVersion": 1,
        "repoPath": canonical.to_string_lossy(),
    });
    if let Ok(bytes) = serde_json::to_vec_pretty(&payload) {
        let _ = fs::write(meta_path, bytes);
    }
}

/// 确保用户目录会话仓存在，并写入 `repo.json` 便于人工排查。
pub fn ensure_repo_pi_sessions_dir(repo_path: &Path) -> Result<PathBuf, PiAgentError> {
    let dir = pi_sessions_dir_for_repo(repo_path).ok_or_else(|| {
        PiAgentError::Persistence("cannot resolve Giteam data directory (~/.giteam)".to_string())
    })?;
    fs::create_dir_all(&dir).map_err(|error| PiAgentError::Persistence(error.to_string()))?;
    write_repo_sessions_meta(&dir, repo_path);
    Ok(dir)
}

fn move_file_if_needed(from: &Path, to: &Path) -> Result<(), PiAgentError> {
    if from == to {
        return Ok(());
    }
    if !from.exists() {
        return Ok(());
    }
    if to.exists() {
        let _ = fs::remove_file(from);
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|error| PiAgentError::Persistence(error.to_string()))?;
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(from, to).map_err(|error| PiAgentError::Persistence(error.to_string()))?;
            let _ = fs::remove_file(from);
            Ok(())
        }
    }
}

/// 迁移会话 JSONL 及其 sidecar（`.bak` / wal / shm / `.lock`），幂等。
pub fn migrate_session_file_bundle(old_path: &Path, new_path: &Path) -> Result<(), PiAgentError> {
    move_file_if_needed(old_path, new_path)?;
    let sidecars = [
        old_path.with_extension("jsonl.bak"),
        old_path.with_extension("jsonl-wal"),
        old_path.with_extension("jsonl-shm"),
    ];
    let new_sidecars = [
        new_path.with_extension("jsonl.bak"),
        new_path.with_extension("jsonl-wal"),
        new_path.with_extension("jsonl-shm"),
    ];
    for (from, to) in sidecars.iter().zip(new_sidecars.iter()) {
        move_file_if_needed(from, to)?;
    }
    // 常见锁文件：`session-….jsonl.lock`
    let old_lock = PathBuf::from(format!("{}.lock", old_path.display()));
    let new_lock = PathBuf::from(format!("{}.lock", new_path.display()));
    move_file_if_needed(&old_lock, &new_lock)?;
    Ok(())
}

/// 若路径仍指向仓库旁旧布局，返回应迁入的用户目录目标路径。
#[must_use]
pub fn remap_legacy_session_path(repo_path: &Path, path: &Path) -> Option<PathBuf> {
    let legacy = legacy_repo_pi_sessions_dir(repo_path);
    let relative = path
        .strip_prefix(&legacy)
        .ok()
        .map(|p| p.to_path_buf())
        .or_else(|| {
            let canon_path = fs::canonicalize(path).ok()?;
            let canon_legacy = fs::canonicalize(&legacy).ok()?;
            Some(canon_path.strip_prefix(canon_legacy).ok()?.to_path_buf())
        })?;
    let new_dir = pi_sessions_dir_for_repo(repo_path)?;
    if relative.as_os_str().is_empty() {
        Some(new_dir)
    } else {
        Some(new_dir.join(relative))
    }
}

/// 确保仓库内 `.giteam/.gitignore` 存在，避免附件等被误提交（成熟项目惯例）。
///
/// 会话正文已迁至 `~/.giteam/pi-sessions/`；此处仍忽略历史残留的 `pi-sessions/`。
pub fn ensure_workspace_giteam_gitignore(repo_root: &Path) {
    let giteam_dir = repo_root.join(".giteam");
    if fs::create_dir_all(&giteam_dir).is_err() {
        return;
    }
    let ignore = giteam_dir.join(".gitignore");
    if ignore.exists() {
        return;
    }
    let _ = fs::write(
        ignore,
        "# Generated by Giteam — local agent runtime data\n\
pi-sessions/\n\
prompt-attachments/\n\
*.db\n\
*.db-journal\n\
*.lock\n",
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> (SecretStore, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "giteam-secret-test-{}-{}-{name}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |duration| duration.as_millis())
        ));
        (SecretStore::new(path.clone()), path)
    }

    #[test]
    fn api_key_round_trips_and_stays_out_of_debug_output() {
        let (store, path) = temp_store("roundtrip");
        store.set_api_key("openai", "sk-test-secret").expect("set key");

        assert_eq!(
            store.api_key("openai").expect("read key"),
            Some("sk-test-secret".to_string())
        );
        assert!(store.has_credential("openai"));

        let debug = format!("{store:?}");
        assert!(!debug.contains("sk-test-secret"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn provider_lookup_is_case_insensitive_and_overwrite_safe() {
        let (store, path) = temp_store("case");
        store.set_api_key("OpenAI", "first").expect("set first");
        store.set_api_key("openai", "second").expect("overwrite");

        assert_eq!(
            store.api_key("OPENAI").expect("read key"),
            Some("second".to_string())
        );
        assert_eq!(store.providers().expect("providers").len(), 1);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn unknown_credential_types_survive_round_trip() {
        let (store, path) = temp_store("oauth");
        let oauth = serde_json::json!({
            "type": "oauth",
            "access": "access-token",
            "refresh": "refresh-token",
            "expires": 1_234_567_i64,
        });
        let mut file = SecretFile::default();
        file.entries.insert("anthropic".to_string(), oauth.clone());
        store.write_file(&file).expect("write oauth");

        store.set_api_key("openai", "sk-other").expect("set api key");

        let reread = store.read_file().expect("reread");
        assert_eq!(reread.entries.get("anthropic"), Some(&oauth));
        assert!(store.api_key("anthropic").expect("read").is_none());
        assert!(store.has_credential("anthropic"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn remove_deletes_only_the_target_provider() {
        let (store, path) = temp_store("remove");
        store.set_api_key("openai", "a").expect("set a");
        store.set_api_key("deepseek", "b").expect("set b");

        assert!(store.remove("openai").expect("remove"));
        assert!(!store.remove("openai").expect("remove again"));
        assert!(store.api_key("openai").expect("read").is_none());
        assert_eq!(
            store.api_key("deepseek").expect("read"),
            Some("b".to_string())
        );

        let _ = fs::remove_file(path);
    }

    #[cfg(unix)]
    #[test]
    fn vault_file_is_owner_read_write_only() {
        use std::os::unix::fs::PermissionsExt;
        let (store, path) = temp_store("perms");
        store.set_api_key("openai", "sk-perm").expect("set key");

        let mode = fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn ensure_workspace_giteam_gitignore_is_idempotent() {
        let root = std::env::temp_dir().join(format!(
            "giteam-ws-ignore-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis())
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("mkdir");
        ensure_workspace_giteam_gitignore(&root);
        ensure_workspace_giteam_gitignore(&root);
        let content = fs::read_to_string(root.join(".giteam").join(".gitignore")).expect("read");
        assert!(content.contains("pi-sessions/"));
        assert!(content.contains("prompt-attachments/"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn default_data_dir_honors_giteam_home() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let override_dir = std::env::temp_dir().join(format!(
            "giteam-home-override-{}-{stamp}",
            std::process::id()
        ));
        let previous = std::env::var_os("GITEAM_HOME");
        // SAFETY: test-only env mutation scoped to this assertion.
        std::env::set_var("GITEAM_HOME", &override_dir);
        let resolved = default_data_dir().expect("data dir");
        assert_eq!(resolved, override_dir);
        match previous {
            Some(value) => std::env::set_var("GITEAM_HOME", value),
            None => std::env::remove_var("GITEAM_HOME"),
        }
    }

    #[test]
    fn migrate_one_legacy_root_copies_missing_files() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let base = std::env::temp_dir().join(format!(
            "giteam-migrate-{}-{stamp}",
            std::process::id()
        ));
        let legacy = base.join("legacy");
        let canonical = base.join("canonical");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(legacy.join("pi-agent")).expect("legacy pi-agent");
        fs::create_dir_all(&canonical).expect("canonical");
        fs::write(legacy.join("theme"), b"dark").expect("theme");
        fs::write(legacy.join("client.db"), b"db").expect("db");
        fs::write(legacy.join("pi-agent").join("auth.json"), b"{}").expect("auth");
        // Prefer existing canonical file over legacy.
        fs::write(canonical.join("theme"), b"keep").expect("keep theme");

        migrate_one_legacy_root(&legacy, &canonical);

        assert_eq!(fs::read_to_string(canonical.join("theme")).unwrap(), "keep");
        assert_eq!(fs::read(canonical.join("client.db")).unwrap(), b"db");
        assert_eq!(
            fs::read(canonical.join("pi-agent").join("auth.json")).unwrap(),
            b"{}"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn repo_sessions_key_is_stable_and_includes_dirname() {
        let repo = PathBuf::from("/tmp/demo-repo");
        let key = repo_sessions_key(&repo);
        assert!(key.starts_with("demo-repo-"));
        assert_eq!(key, repo_sessions_key(&repo));
    }

    #[test]
    fn remap_and_migrate_legacy_session_bundle() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis());
        let base = std::env::temp_dir().join(format!(
            "giteam-session-migrate-{}-{stamp}",
            std::process::id()
        ));
        let repo = base.join("repo");
        let home = base.join("home");
        let legacy = legacy_repo_pi_sessions_dir(&repo);
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&legacy).expect("legacy dir");
        let old_path = legacy.join("session-1.jsonl");
        fs::write(&old_path, b"{\"type\":\"session\"}\n").expect("write session");
        fs::write(
            PathBuf::from(format!("{}.lock", old_path.display())),
            b"lock",
        )
        .expect("write lock");

        let previous = std::env::var_os("GITEAM_HOME");
        std::env::set_var("GITEAM_HOME", &home);

        let remapped = remap_legacy_session_path(&repo, &old_path).expect("remap");
        assert!(remapped.starts_with(home.join("pi-sessions").join("repos")));
        migrate_session_file_bundle(&old_path, &remapped).expect("migrate");
        assert!(remapped.exists());
        assert!(!old_path.exists());
        assert!(PathBuf::from(format!("{}.lock", remapped.display())).exists());

        match previous {
            Some(value) => std::env::set_var("GITEAM_HOME", value),
            None => std::env::remove_var("GITEAM_HOME"),
        }
        let _ = fs::remove_dir_all(&base);
    }
}

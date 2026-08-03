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
/// 布局（对齐成熟桌面应用惯例，CLI / Desktop 共用同一根，避免按 bundle id 分裂）：
/// ```text
/// macOS:   ~/Library/Application Support/giteam/
/// Windows: %APPDATA%\giteam\
/// Linux:   ${XDG_DATA_HOME:-~/.local/share}/giteam/
/// ```
/// 子目录约定：`pi-agent/`（auth/models）、`pi-sessions/`（catalog）、根级 `client.db` / `theme`。
#[must_use]
pub fn default_data_dir() -> Option<PathBuf> {
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

/// 确保权威数据根存在，返回路径。
pub fn ensure_data_dir() -> Option<PathBuf> {
    let dir = default_data_dir()?;
    if fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir)
}

/// Tauri 按 `identifier = io.giteam.desktop` 解析出的旧数据根（与 `giteam/` 分裂）。
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

/// 一次性把旧 Tauri bundle 目录中的通用文件迁入权威 `giteam/` 根（幂等、不覆盖已有）。
///
/// 覆盖：`client.db`、`theme`，以及误放在 `io.giteam.desktop/.giteam/` 下的同名文件。
pub fn migrate_legacy_tauri_data_into_canonical() {
    let Some(canonical) = ensure_data_dir() else {
        return;
    };
    let Some(legacy) = legacy_tauri_bundle_data_dir() else {
        return;
    };
    if !legacy.exists() {
        return;
    }
    copy_file_if_missing(&legacy.join("theme"), &canonical.join("theme"));
    copy_file_if_missing(
        &legacy.join(".giteam").join("client.db"),
        &canonical.join("client.db"),
    );
    copy_file_if_missing(&legacy.join("client.db"), &canonical.join("client.db"));
}

/// 确保仓库内 `.giteam/.gitignore` 存在，避免会话/附件被误提交（成熟项目惯例）。
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
}

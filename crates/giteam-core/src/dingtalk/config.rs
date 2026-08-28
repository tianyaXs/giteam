//! 钉钉本地配置：非敏感 JSON + SecretStore 中的加签 / Outgoing Secret。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::pi_agent::{default_data_dir, ensure_data_dir, SecretStore};

const SETTINGS_FILE: &str = "dingtalk.json";
const SIGN_SECRET_PROVIDER: &str = "dingtalk_sign";
const OUTGOING_SECRET_PROVIDER: &str = "dingtalk_outgoing";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    #[default]
    New,
    Existing,
}

impl SessionMode {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Existing => "existing",
        }
    }

    #[must_use]
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "existing" => Self::Existing,
            _ => Self::New,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkSettings {
    /// 自定义机器人 Webhook URL（可不含 sign/timestamp query）。
    #[serde(default)]
    pub webhook_url: String,
    /// 是否允许钉钉 Outgoing 触发本机 Agent。
    #[serde(default)]
    pub allow_trigger: bool,
    /// 触发时绑定的仓库路径（必填才可双向）。
    #[serde(default)]
    pub repo_path: String,
    #[serde(default)]
    pub session_mode: SessionMode,
    #[serde(default)]
    pub session_id: Option<String>,
}

impl Default for DingTalkSettings {
    fn default() -> Self {
        Self {
            webhook_url: String::new(),
            allow_trigger: false,
            repo_path: String::new(),
            session_mode: SessionMode::New,
            session_id: None,
        }
    }
}

fn settings_path() -> Option<PathBuf> {
    ensure_data_dir().or_else(default_data_dir).map(|d| d.join(SETTINGS_FILE))
}

fn secret_store() -> Option<SecretStore> {
    SecretStore::default_path().map(SecretStore::new)
}

pub fn get_settings() -> DingTalkSettings {
    let Some(path) = settings_path() else {
        return DingTalkSettings::default();
    };
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => DingTalkSettings::default(),
    }
}

pub fn save_settings(settings: &DingTalkSettings) -> Result<(), String> {
    let path = settings_path().ok_or_else(|| "giteam data dir unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, format!("{raw}\n")).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn has_sign_secret() -> bool {
    secret_store()
        .map(|s| s.has_credential(SIGN_SECRET_PROVIDER))
        .unwrap_or(false)
}

pub fn has_outgoing_secret() -> bool {
    secret_store()
        .map(|s| s.has_credential(OUTGOING_SECRET_PROVIDER))
        .unwrap_or(false)
}

pub fn load_sign_secret() -> Option<String> {
    secret_store()
        .and_then(|s| s.api_key(SIGN_SECRET_PROVIDER).ok().flatten())
        .filter(|k| !k.trim().is_empty())
}

pub fn load_outgoing_secret() -> Option<String> {
    secret_store()
        .and_then(|s| s.api_key(OUTGOING_SECRET_PROVIDER).ok().flatten())
        .filter(|k| !k.trim().is_empty())
}

pub fn set_sign_secret(secret: &str) -> Result<(), String> {
    let store = secret_store().ok_or_else(|| "secret store unavailable".to_string())?;
    store
        .set_api_key(SIGN_SECRET_PROVIDER, secret.trim())
        .map_err(|e| e.to_string())
}

pub fn set_outgoing_secret(secret: &str) -> Result<(), String> {
    let store = secret_store().ok_or_else(|| "secret store unavailable".to_string())?;
    store
        .set_api_key(OUTGOING_SECRET_PROVIDER, secret.trim())
        .map_err(|e| e.to_string())
}

pub fn clear_sign_secret() -> Result<(), String> {
    let store = secret_store().ok_or_else(|| "secret store unavailable".to_string())?;
    let _ = store.remove(SIGN_SECRET_PROVIDER).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_outgoing_secret() -> Result<(), String> {
    let store = secret_store().ok_or_else(|| "secret store unavailable".to_string())?;
    let _ = store.remove(OUTGOING_SECRET_PROVIDER).map_err(|e| e.to_string())?;
    Ok(())
}

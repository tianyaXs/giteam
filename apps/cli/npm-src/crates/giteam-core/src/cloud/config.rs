use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Placeholder default; override via link `--url` / env / settings.
/// Production value is injected at release time via PUBLIC_BASE_URL on the server
/// and client config — never hardcode the final public hostname here.
pub const DEFAULT_CLOUD_BASE_URL: &str = "http://127.0.0.1:8787";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAccessKeyRecord {
    /// Public access key id (`aki_…`), stable across reconnects.
    pub id: String,
    pub name: String,
    pub access_key: String,
    #[serde(default)]
    pub workspace_id: String,
    #[serde(default)]
    pub cloud_base_url: String,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub last_used_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudLinkSettings {
    pub enabled: bool,
    pub cloud_base_url: String,
    #[serde(default)]
    pub workspace_id: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub device_token: String,
    #[serde(default)]
    pub access_key: String,
    /// Display name of the currently active access key.
    #[serde(default)]
    pub key_name: String,
    #[serde(default)]
    pub device_name: String,
    /// Local vault of known keys (provider-style). Never drop except manual delete.
    #[serde(default)]
    pub access_keys: Vec<CloudAccessKeyRecord>,
}

impl Default for CloudLinkSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            cloud_base_url: DEFAULT_CLOUD_BASE_URL.to_string(),
            workspace_id: String::new(),
            device_id: String::new(),
            device_token: String::new(),
            access_key: String::new(),
            key_name: String::new(),
            device_name: String::new(),
            access_keys: Vec::new(),
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn access_key_id_local(access_key: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(access_key.as_bytes());
    let digest = hex::encode(hasher.finalize());
    format!("aki_{}", &digest[..16.min(digest.len())])
}

fn cloud_settings_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("giteam")
                    .join("cloud-link.json"),
            );
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(p) = std::env::var("APPDATA") {
            return Some(PathBuf::from(p).join("giteam").join("cloud-link.json"));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(
                PathBuf::from(home)
                    .join(".config")
                    .join("giteam")
                    .join("cloud-link.json"),
            );
        }
    }
    None
}

pub fn get_cloud_link_settings() -> CloudLinkSettings {
    let Some(path) = cloud_settings_path() else {
        return CloudLinkSettings::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return CloudLinkSettings::default();
    };
    let mut cfg = serde_json::from_str::<CloudLinkSettings>(&raw).unwrap_or_default();
    cfg.cloud_base_url = cfg
        .cloud_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    if cfg.cloud_base_url.is_empty() {
        cfg.cloud_base_url = DEFAULT_CLOUD_BASE_URL.to_string();
    }
    // Migrate legacy single key into vault.
    if !cfg.access_key.trim().is_empty()
        && !cfg
            .access_keys
            .iter()
            .any(|k| k.access_key == cfg.access_key)
    {
        let id = access_key_id_local(&cfg.access_key);
        let name = if cfg.key_name.trim().is_empty() {
            "默认".to_string()
        } else {
            cfg.key_name.trim().to_string()
        };
        let ts = now_ms();
        cfg.access_keys.push(CloudAccessKeyRecord {
            id,
            name: name.clone(),
            access_key: cfg.access_key.clone(),
            workspace_id: cfg.workspace_id.clone(),
            cloud_base_url: cfg.cloud_base_url.clone(),
            created_at_ms: ts,
            last_used_at_ms: ts,
        });
        if cfg.key_name.trim().is_empty() {
            cfg.key_name = name;
        }
        let _ = set_cloud_link_settings(&cfg);
    }
    cfg
}

pub fn set_cloud_link_settings(settings: &CloudLinkSettings) -> Result<(), String> {
    let path = cloud_settings_path().ok_or_else(|| "cannot resolve cloud-link.json path".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut next = settings.clone();
    next.cloud_base_url = next
        .cloud_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    let raw = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

/// Upsert a key into the local vault and mark it active on settings.
pub fn remember_access_key(
    settings: &mut CloudLinkSettings,
    access_key: &str,
    name: &str,
    workspace_id: &str,
) {
    let key = access_key.trim();
    if key.is_empty() {
        return;
    }
    let id = access_key_id_local(key);
    let ts = now_ms();
    let display = {
        let n = name.trim();
        if n.is_empty() {
            "默认".to_string()
        } else {
            n.to_string()
        }
    };
    if let Some(existing) = settings.access_keys.iter_mut().find(|k| k.access_key == key || k.id == id)
    {
        if !display.is_empty() {
            existing.name = display.clone();
        }
        existing.workspace_id = workspace_id.to_string();
        existing.cloud_base_url = settings.cloud_base_url.clone();
        existing.last_used_at_ms = ts;
    } else {
        settings.access_keys.push(CloudAccessKeyRecord {
            id: id.clone(),
            name: display.clone(),
            access_key: key.to_string(),
            workspace_id: workspace_id.to_string(),
            cloud_base_url: settings.cloud_base_url.clone(),
            created_at_ms: ts,
            last_used_at_ms: ts,
        });
    }
    settings.access_key = key.to_string();
    settings.key_name = display;
    settings.workspace_id = workspace_id.to_string();
}

/// Rename a key in the local vault. Does not call the server.
pub fn rename_access_key_local(key_id_or_secret: &str, name: &str) -> Result<CloudLinkSettings, String> {
    let needle = key_id_or_secret.trim();
    let display = name.trim();
    if needle.is_empty() {
        return Err("key id required".into());
    }
    if display.is_empty() {
        return Err("name required".into());
    }
    let mut settings = get_cloud_link_settings();
    let Some(existing) = settings
        .access_keys
        .iter_mut()
        .find(|k| k.id == needle || k.access_key == needle)
    else {
        return Err("key not found".into());
    };
    existing.name = display.to_string();
    if settings.access_key == existing.access_key {
        settings.key_name = display.to_string();
    }
    set_cloud_link_settings(&settings)?;
    Ok(settings)
}

/// Remove a key from the local vault. Does not call the server.
pub fn forget_access_key_local(key_id_or_secret: &str) -> Result<CloudLinkSettings, String> {
    let mut settings = get_cloud_link_settings();
    let needle = key_id_or_secret.trim();
    settings.access_keys.retain(|k| k.id != needle && k.access_key != needle);
    if settings.access_key == needle
        || access_key_id_local(&settings.access_key) == needle
        || settings
            .access_keys
            .iter()
            .all(|k| k.access_key != settings.access_key)
    {
        if let Some(next) = settings.access_keys.first().cloned() {
            settings.access_key = next.access_key;
            settings.key_name = next.name;
            settings.workspace_id = next.workspace_id;
        } else {
            settings.access_key.clear();
            settings.key_name.clear();
            settings.workspace_id.clear();
            settings.device_id.clear();
            settings.device_token.clear();
            settings.enabled = false;
        }
    }
    set_cloud_link_settings(&settings)?;
    Ok(settings)
}

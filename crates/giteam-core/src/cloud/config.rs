use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Placeholder default; override via link `--url` / env / settings.
/// Production value is injected at release time via PUBLIC_BASE_URL on the server
/// and client config — never hardcode the final public hostname here.
pub const DEFAULT_CLOUD_BASE_URL: &str = "http://127.0.0.1:8787";

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
    #[serde(default)]
    pub device_name: String,
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
            device_name: String::new(),
        }
    }
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

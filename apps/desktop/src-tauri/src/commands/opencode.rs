use super::command_runner;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
use wait_timeout::ChildExt;

const OPENCODE_TIMEOUT_SECS: u64 = 45;
const DEFAULT_OPENCODE_SERVICE_PORT: u16 = 4098;

struct ManagedOpencodeService {
    child: Option<std::process::Child>,
    base: String,
}

static OPENCODE_SERVICE_POOL: OnceLock<Mutex<Option<ManagedOpencodeService>>> = OnceLock::new();

fn service_pool() -> &'static Mutex<Option<ManagedOpencodeService>> {
    OPENCODE_SERVICE_POOL.get_or_init(|| Mutex::new(None))
}

fn run_opencode(args: &[&str], repo_path: &str) -> Result<String, String> {
    command_runner::run_and_capture_in_dir_with_timeout("opencode", args, repo_path, OPENCODE_TIMEOUT_SECS)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModelConfig {
    pub config_path: String,
    pub configured_model: String,
    pub exists: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeProviderConfig {
    pub provider: String,
    pub npm: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub endpoint: String,
    pub region: String,
    pub profile: String,
    pub project: String,
    pub location: String,
    pub resource_name: String,
    pub enterprise_url: String,
    pub timeout: String,
    pub chunk_timeout: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeCatalogProvider {
    pub id: String,
    pub name: String,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeConfigProviderCatalog {
    pub id: String,
    pub name: String,
    pub npm: String,
    pub models: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeServerProviderCatalog {
    pub id: String,
    pub name: String,
    pub models: Vec<String>,
    #[serde(rename = "modelNames")]
    pub model_names: HashMap<String, String>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeServerProviderState {
    pub providers: Vec<OpencodeServerProviderCatalog>,
    pub connected: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeServiceSettings {
    pub port: u16,
}

fn normalize_provider_key(input: &str) -> String {
    input
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
}

fn merge_server_provider_catalog(
    mut base: Vec<OpencodeServerProviderCatalog>,
    extra: Vec<OpencodeServerProviderCatalog>,
) -> Vec<OpencodeServerProviderCatalog> {
    if base.is_empty() {
        return extra;
    }
    if extra.is_empty() {
        return base;
    }
    let mut extra_by_key: HashMap<String, OpencodeServerProviderCatalog> = HashMap::new();
    for p in extra {
        extra_by_key.insert(normalize_provider_key(&p.id), p);
    }
    for b in &mut base {
        let key = normalize_provider_key(&b.id);
        if let Some(e) = extra_by_key.get(&key) {
            if b.name.trim().is_empty() {
                b.name = e.name.clone();
            }
            if e.name.trim().len() > 0 && b.name.trim() == b.id {
                // Prefer nicer display name when base is still the raw id.
                b.name = e.name.clone();
            }
            // Merge models and model names (prefer non-empty display names).
            for m in &e.models {
                if !b.models.contains(m) {
                    b.models.push(m.clone());
                }
            }
            for (mid, mname) in &e.model_names {
                let display = mname.trim();
                if display.is_empty() {
                    continue;
                }
                let cur = b.model_names.get(mid).cloned().unwrap_or_default();
                if cur.trim().is_empty() || cur.trim() == mid.as_str() {
                    b.model_names.insert(mid.clone(), display.to_string());
                }
            }
            if b.source.as_deref().unwrap_or("").trim().is_empty() {
                b.source = e.source.clone();
            }
            b.models.sort();
            b.models.dedup();
        }
    }
    base.sort_by(|a, b| a.id.cmp(&b.id));
    base
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeStreamEvent {
    pub request_id: String,
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeSessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeSessionMessage {
    pub id: String,
    pub role: String,
    pub content: String,
}

fn extract_config_provider_catalog(root: &Value) -> Vec<OpencodeConfigProviderCatalog> {
    let mut out: Vec<OpencodeConfigProviderCatalog> = Vec::new();
    let Some(provider_root) = root.get("provider").and_then(|v| v.as_object()) else {
        return out;
    };
    for (pid, node) in provider_root {
        let pobj = node.as_object();
        let name = pobj
            .and_then(|o| o.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or(pid.as_str())
            .to_string();
        let npm = pobj
            .and_then(|o| o.get("npm"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let models_obj = pobj.and_then(|o| o.get("models")).and_then(|v| v.as_object());
        let mut models: Vec<String> = models_obj.map(|m| m.keys().cloned().collect()).unwrap_or_default();
        models.sort();
        out.push(OpencodeConfigProviderCatalog {
            id: pid.clone(),
            name,
            npm,
            models,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn opencode_auth_path() -> Option<PathBuf> {
    if let Ok(xdg_data_home) = std::env::var("XDG_DATA_HOME") {
        let p = xdg_data_home.trim();
        if !p.is_empty() {
            return Some(PathBuf::from(p).join("opencode").join("auth.json"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            return Some(PathBuf::from(h).join(".local").join("share").join("opencode").join("auth.json"));
        }
    }
    None
}

fn opencode_service_settings_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let h = home.trim();
            if !h.is_empty() {
                return Some(
                    PathBuf::from(h)
                        .join("Library")
                        .join("Application Support")
                        .join("giteam")
                        .join("opencode-service.json"),
                );
            }
        }
    }

    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg_config_home.trim();
        if !p.is_empty() {
            return Some(PathBuf::from(p).join("giteam").join("opencode-service.json"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            return Some(PathBuf::from(h).join(".config").join("giteam").join("opencode-service.json"));
        }
    }
    None
}

fn default_opencode_service_settings() -> OpencodeServiceSettings {
    OpencodeServiceSettings {
        port: DEFAULT_OPENCODE_SERVICE_PORT,
    }
}

fn read_opencode_service_settings() -> OpencodeServiceSettings {
    let Some(path) = opencode_service_settings_path() else {
        return default_opencode_service_settings();
    };
    let raw = match fs::read_to_string(&path) {
        Ok(v) => v,
        Err(_) => return default_opencode_service_settings(),
    };
    let mut cfg = match serde_json::from_str::<OpencodeServiceSettings>(&raw) {
        Ok(v) => v,
        Err(_) => return default_opencode_service_settings(),
    };
    if cfg.port == 0 {
        cfg.port = DEFAULT_OPENCODE_SERVICE_PORT;
    }
    cfg
}

fn write_opencode_service_settings(settings: &OpencodeServiceSettings) -> Result<(), String> {
    let Some(path) = opencode_service_settings_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create service settings dir failed: {e}"))?;
    }
    let text =
        serde_json::to_string_pretty(settings).map_err(|e| format!("serialize service settings failed: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("write service settings failed: {e}"))?;
    Ok(())
}

fn read_opencode_auth_map() -> Map<String, Value> {
    let Some(path) = opencode_auth_path() else {
        return Map::new();
    };
    let raw = match fs::read_to_string(&path) {
        Ok(v) => v,
        Err(_) => return Map::new(),
    };
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn write_opencode_auth_map(map: &Map<String, Value>) -> Result<(), String> {
    let Some(path) = opencode_auth_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create auth dir failed: {e}"))?;
    }
    let text = serde_json::to_string_pretty(map).map_err(|e| format!("serialize auth config failed: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("write auth config failed: {e}"))?;
    Ok(())
}

fn get_opencode_auth_api_key(provider: &str) -> String {
    if provider.trim().is_empty() {
        return String::new();
    }
    read_opencode_auth_map()
        .get(provider.trim())
        .and_then(|v| v.get("key"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn set_opencode_auth_api_key(provider: &str, api_key: &str) -> Result<(), String> {
    let pid = provider.trim();
    if pid.is_empty() {
        return Ok(());
    }
    let mut auth = read_opencode_auth_map();
    let key = api_key.trim();
    if key.is_empty() {
        auth.remove(pid);
    } else {
        auth.insert(
            pid.to_string(),
            serde_json::json!({
                "type": "api",
                "key": key
            }),
        );
    }
    write_opencode_auth_map(&auth)
}

fn parse_env_placeholder(raw: &str) -> Option<String> {
    // Matches OpenCode UI format: "{env:ENV_VAR_NAME}"
    let s = raw.trim();
    if !s.starts_with("{env:") || !s.ends_with('}') {
        return None;
    }
    let inner = s.trim_start_matches("{env:").trim_end_matches('}').trim();
    if inner.is_empty() {
        return None;
    }
    Some(inner.to_string())
}

fn opencode_models_cache_path() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("OPENCODE_MODELS_PATH") {
        let p = explicit.trim();
        if !p.is_empty() {
            let pp = PathBuf::from(p);
            if pp.exists() {
                return Some(pp);
            }
        }
    }

    let mut homes: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            homes.push(PathBuf::from(h));
        }
    }
    if let Ok(user) = std::env::var("USER") {
        let u = user.trim();
        if !u.is_empty() {
            homes.push(PathBuf::from(format!("/Users/{u}")));
            homes.push(PathBuf::from(format!("/home/{u}")));
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    for home in homes {
        if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
            candidates.push(PathBuf::from(xdg).join("opencode").join("models.json"));
        }
        candidates.push(home.join("Library").join("Caches").join("opencode").join("models.json"));
        candidates.push(home.join(".cache").join("opencode").join("models.json"));
    }

    for root in ["/Users", "/home"] {
        let root_path = Path::new(root);
        if !root_path.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(root_path) {
            for entry in entries.flatten() {
                let hp = entry.path();
                candidates.push(hp.join("Library").join("Caches").join("opencode").join("models.json"));
                candidates.push(hp.join(".cache").join("opencode").join("models.json"));
            }
        }
    }

    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for p in candidates {
        if !p.exists() {
            continue;
        }
        let modified = fs::metadata(&p)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        match &best {
            Some((t, _)) if &modified <= t => {}
            _ => best = Some((modified, p)),
        }
    }
    if let Some((_, p)) = best {
        return Some(p);
    }
    None
}

fn parse_models_dev_catalog(raw: &str) -> Result<Vec<OpencodeCatalogProvider>, String> {
    let value: Value = serde_json::from_str(raw).map_err(|e| format!("parse models.dev catalog failed: {e}"))?;
    let obj = value
        .as_object()
        .ok_or_else(|| "invalid models.dev catalog format".to_string())?;

    let mut providers: Vec<OpencodeCatalogProvider> = obj
        .iter()
        .map(|(id, provider)| {
            let name = provider
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(id)
                .to_string();
            let models_obj = provider.get("models").and_then(|v| v.as_object());
            let mut models: Vec<String> = models_obj
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default();
            models.sort();
            OpencodeCatalogProvider {
                id: id.clone(),
                name,
                models,
            }
        })
        .collect();

    providers.sort_by(|a, b| {
        let a_is_opencode = a.id.starts_with("opencode");
        let b_is_opencode = b.id.starts_with("opencode");
        if a_is_opencode && !b_is_opencode {
            return std::cmp::Ordering::Less;
        }
        if !a_is_opencode && b_is_opencode {
            return std::cmp::Ordering::Greater;
        }
        a.id.cmp(&b.id)
    });
    Ok(providers)
}

fn build_stream_path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();
    let extra = [
        format!("{home}/.local/bin"),
        format!("{home}/miniconda3/bin"),
        format!("{home}/anaconda3/bin"),
        format!("{home}/.pyenv/shims"),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    for d in extra {
        if !d.is_empty() && !dirs.iter().any(|x| x == &d) {
            dirs.push(d);
        }
    }
    dirs.join(":")
}

fn extract_run_json_text(raw: &str) -> String {
    let mut out = String::new();
    for line in raw.lines() {
        let value: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let kind = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if kind != "text" {
            continue;
        }
        let text = value
            .get("part")
            .and_then(|v| v.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(text);
    }
    out
}

fn emit_stream_event(app: &tauri::AppHandle, request_id: &str, kind: &str, text: String) {
    let _ = app.emit(
        "opencode-stream",
        OpencodeStreamEvent {
            request_id: request_id.to_string(),
            kind: kind.to_string(),
            text,
        },
    );
}

fn parse_model_ref(model: &str) -> Option<(String, String)> {
    let m = model.trim();
    if m.is_empty() {
        return None;
    }
    let mut parts = m.splitn(2, '/');
    let provider = parts.next()?.trim();
    let model_id = parts.next()?.trim();
    if provider.is_empty() || model_id.is_empty() {
        return None;
    }
    Some((provider.to_string(), model_id.to_string()))
}

fn run_curl_json(
    repo_path: &str,
    method: &str,
    url: &str,
    body: Option<&str>,
    timeout_secs: u64,
) -> Result<String, String> {
    let mut args: Vec<String> = vec![
        "-sS".to_string(),
        "--fail".to_string(),
        "--max-time".to_string(),
        timeout_secs.to_string(),
        "-X".to_string(),
        method.to_string(),
        "-H".to_string(),
        format!("x-opencode-directory: {repo_path}"),
    ];
    if body.is_some() {
        args.push("-H".to_string());
        args.push("Content-Type: application/json".to_string());
    }
    if let Some(b) = body {
        args.push("--data-raw".to_string());
        args.push(b.to_string());
    }
    args.push(url.to_string());
    command_runner::run_and_capture_in_dir_with_timeout("curl", &args, repo_path, timeout_secs)
}

fn merge_json(base: &mut Value, overlay: Value) {
    match (base, overlay) {
        (Value::Object(base_obj), Value::Object(overlay_obj)) => {
            for (k, v) in overlay_obj {
                if let Some(existing) = base_obj.get_mut(&k) {
                    merge_json(existing, v);
                } else {
                    base_obj.insert(k, v);
                }
            }
        }
        (base_slot, overlay_v) => {
            *base_slot = overlay_v;
        }
    }
}

fn run_config_get(repo_path: &str, base: &str) -> Result<Value, String> {
    // Align with OpenCode web flow:
    // - /global/config stores provider/model catalogs
    // - /config may store per-project overrides (e.g. selected model)
    // Return a merged view so provider catalogs from global config are visible.
    let global_cfg = run_curl_json(repo_path, "GET", format!("{base}/global/config").as_str(), None, 15)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let local_cfg = run_curl_json(repo_path, "GET", format!("{base}/config").as_str(), None, 15)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());

    match (global_cfg, local_cfg) {
        (Some(mut g), Some(l)) => {
            merge_json(&mut g, l);
            Ok(g)
        }
        (Some(g), None) => Ok(g),
        (None, Some(l)) => Ok(l),
        (None, None) => Err("read /global/config and /config failed".to_string()),
    }
}

fn run_config_patch(repo_path: &str, base: &str, patch: &Value) -> Result<Value, String> {
    // Per observed OpenCode web flow:
    // - provider/disabled_providers updates go to /global/config
    // - model selection typically lives under /config
    //
    // We still support both endpoints and fall back as needed.
    let wants_global_first =
        patch.get("provider").is_some() || patch.get("disabled_providers").is_some() || patch.get("model").is_some();

    let try_patch = |url: String| -> Result<Value, String> {
        // OpenCode /config and /global/config PATCH both validate full Config.Info.
        // Merge patch into current config and submit the full object.
        let mut merged = run_curl_json(repo_path, "GET", url.as_str(), None, 20)
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        merge_json(&mut merged, patch.clone());
        let body = serde_json::to_string(&merged).map_err(|e| format!("serialize merged config failed: {e}"))?;
        let raw = run_curl_json(repo_path, "PATCH", url.as_str(), Some(body.as_str()), 20)?;
        serde_json::from_str(&raw).map_err(|e| format!("parse patch response failed: {e}"))
    };

    if wants_global_first {
        if let Ok(json) = try_patch(format!("{base}/global/config")) {
            return Ok(json);
        }
        if let Ok(json) = try_patch(format!("{base}/config")) {
            return Ok(json);
        }
        // last attempt, bubble error
        return try_patch(format!("{base}/global/config"));
    }

    if let Ok(json) = try_patch(format!("{base}/config")) {
        return Ok(json);
    }
    if let Ok(json) = try_patch(format!("{base}/global/config")) {
        return Ok(json);
    }
    try_patch(format!("{base}/config"))
}

fn service_is_ready(repo_path: &str, base: &str) -> bool {
    let ready_url = format!("{base}/project/current");
    run_curl_json(repo_path, "GET", ready_url.as_str(), None, 3).is_ok()
}

fn start_opencode_service(repo_path: &str, settings: &OpencodeServiceSettings) -> Result<(Option<std::process::Child>, String), String> {
    let base = format!("http://127.0.0.1:{}", settings.port);
    if service_is_ready(repo_path, &base) {
        // A healthy service is already listening on the configured endpoint.
        return Ok((None, base));
    }
    let mut serve = Command::new("opencode");
    serve
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(settings.port.to_string())
        .arg("--print-logs")
        .current_dir(repo_path)
        .env("PATH", build_stream_path_env())
        .env("ACCESSIBLE", "1")
        .env("PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = serve
        .spawn()
        .map_err(|e| format!("failed to start `opencode serve`: {e}"))?;

    let wait_deadline = Instant::now() + Duration::from_secs(12);
    let mut ready = false;
    while Instant::now() < wait_deadline {
        if service_is_ready(repo_path, &base) {
            ready = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(180));
    }
    if !ready {
        return Err("opencode service did not become ready".to_string());
    }
    Ok((Some(child), base))
}

fn release_managed_service() {
    if let Ok(mut pool) = service_pool().lock() {
        if let Some(mut svc) = pool.take() {
            if let Some(mut child) = svc.child.take() {
                let _ = child.kill();
                let _ = child.wait_timeout(Duration::from_secs(1));
            }
        }
    }
}

pub fn shutdown_managed_opencode_service() {
    release_managed_service();
}

pub fn warmup_managed_opencode_service() {
    let repo = std::env::current_dir()
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| ".".to_string());
    let _ = ensure_managed_service_local(repo.as_str());
}

fn ensure_managed_service_local(repo_path: &str) -> Result<String, String> {
    let settings = read_opencode_service_settings();
    let expected_base = format!("http://127.0.0.1:{}", settings.port);
    if let Ok(mut guard) = service_pool().lock() {
        if let Some(svc) = guard.as_mut() {
            if svc.base == expected_base {
                let child_ok = if let Some(child) = svc.child.as_mut() {
                    matches!(child.try_wait(), Ok(None))
                } else {
                    true
                };
                if child_ok && service_is_ready(repo_path, &svc.base) {
                    return Ok(svc.base.clone());
                }
            }
            if let Some(mut stale) = guard.take() {
                if let Some(mut child) = stale.child.take() {
                    let _ = child.kill();
                    let _ = child.wait_timeout(Duration::from_secs(1));
                }
            }
        }
    }

    let (child, base) = start_opencode_service(repo_path, &settings)?;
    let mut pool = service_pool()
        .lock()
        .map_err(|_| "opencode service lock poisoned".to_string())?;
    *pool = Some(ManagedOpencodeService {
        child,
        base: base.clone(),
    });
    Ok(base)
}

fn with_service_base<T, F: FnMut(&str) -> Result<T, String>>(repo_path: &str, mut task: F) -> Result<T, String> {
    let base = ensure_managed_service_local(repo_path)?;
    match task(base.as_str()) {
        Ok(v) => Ok(v),
        Err(first_err) => {
            release_managed_service();
            let retry_base = ensure_managed_service_local(repo_path)?;
            task(retry_base.as_str()).map_err(|retry_err| format!("{first_err}\nretry failed: {retry_err}"))
        }
    }
}

fn parse_session_summary(v: &Value) -> Option<OpencodeSessionSummary> {
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    if id.is_empty() {
        return None;
    }
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let time = v.get("time").and_then(|x| x.as_object());
    let created_at = time
        .and_then(|t| t.get("created"))
        .and_then(|x| x.as_i64().or_else(|| x.as_u64().map(|u| u as i64)))
        .unwrap_or(0);
    let updated_at = time
        .and_then(|t| t.get("updated"))
        .and_then(|x| x.as_i64().or_else(|| x.as_u64().map(|u| u as i64)))
        .unwrap_or(created_at);
    Some(OpencodeSessionSummary {
        id,
        title,
        created_at,
        updated_at,
    })
}

fn extract_text_from_parts(parts: &[Value]) -> String {
    let mut out = String::new();
    for p in parts {
        let ptype = p.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if ptype != "text" {
            continue;
        }
        let text = p.get("text").and_then(|x| x.as_str()).unwrap_or("");
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(text);
    }
    out
}

fn summarize_tool_trace(tool: &str, input: Option<&Map<String, Value>>) -> String {
    let t = tool.trim().to_lowercase();
    let get = |k: &str| {
        input
            .and_then(|m| m.get(k))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let path = {
        let p = get("filePath");
        if p.is_empty() {
            get("path")
        } else {
            p
        }
    };
    let query = get("query");
    let pattern = get("pattern");
    let command = {
        let c = get("command");
        if c.is_empty() {
            get("cmd")
        } else {
            c
        }
    };
    if t == "read" || t == "view" || t == "cat" {
        if !path.is_empty() {
            return format!("Read {path}");
        }
        return "Read file".to_string();
    }
    if t == "codesearch" || t == "grep" || t == "search" || t == "ripgrep" {
        if !query.is_empty() {
            return format!("Find {query}");
        }
        if !pattern.is_empty() {
            return format!("Find {pattern}");
        }
        return "Find text".to_string();
    }
    if t == "bash" || t == "shell" || t == "command" {
        if !command.is_empty() {
            return format!("Run {command}");
        }
        return "Run command".to_string();
    }
    format!("Run {tool}")
}

fn stream_prompt_via_opencode_service(
    app: &tauri::AppHandle,
    repo_path: &str,
    prompt: &str,
    model: &str,
    session_id: Option<&str>,
    request_id: &str,
) -> Result<(), String> {
    let mut stream_child: Option<std::process::Child> = None;
    let run = with_service_base(repo_path, |base| {

        let session_id = if let Some(id) = session_id {
            let sid = id.trim();
            if sid.is_empty() {
                return Err("session_id must not be empty".to_string());
            }
            sid.to_string()
        } else {
            let create_url = format!("{base}/session");
            let created_raw = run_curl_json(repo_path, "POST", create_url.as_str(), Some("{}"), 8)?;
            let created_json: Value = serde_json::from_str(&created_raw)
                .map_err(|e| format!("parse session create response failed: {e}"))?;
            let sid = created_json
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if sid.is_empty() {
                return Err("session create returned empty id".to_string());
            }
            sid
        };
        emit_stream_event(app, request_id, "session", session_id.clone());
        let model_trim = model.trim();
        if let Some((pid, mid)) = parse_model_ref(model_trim) {
            emit_stream_event(
                app,
                request_id,
                "debug",
                format!("HTTP SSE /global/event + POST /session/{session_id}/prompt_async model={pid}/{mid}"),
            );
        } else if !model_trim.is_empty() {
            emit_stream_event(
                app,
                request_id,
                "debug",
                format!("HTTP SSE /global/event + POST /session/{session_id}/prompt_async model={model_trim}"),
            );
        } else {
            emit_stream_event(
                app,
                request_id,
                "debug",
                format!("HTTP SSE /global/event + POST /session/{session_id}/prompt_async model=(empty)"),
            );
        }

        // Subscribe to OpenCode global events (SSE).
        let event_url = format!("{base}/global/event");
        let mut stream_cmd = Command::new("curl");
        stream_cmd
            .arg("-sS")
            .arg("-N")
            .arg("--fail")
            .arg("-H")
            .arg(format!("x-opencode-directory: {repo_path}"))
            .arg("-H")
            .arg("Accept: text/event-stream")
            .arg(event_url.as_str())
            .current_dir(repo_path)
            .env("PATH", build_stream_path_env())
            .env("ACCESSIBLE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let spawned_stream = stream_cmd
            .spawn()
            .map_err(|e| format!("open event stream failed: {e}"))?;
        stream_child = Some(spawned_stream);

        let mut prompt_body = serde_json::json!({
            "parts": [
                {
                    "type": "text",
                    "text": prompt,
                }
            ]
        });
        if let Some((provider_id, model_id)) = parse_model_ref(model) {
            prompt_body["model"] = serde_json::json!({
                "providerID": provider_id,
                "modelID": model_id
            });
        }

        let prompt_url = format!("{base}/session/{session_id}/prompt_async");
        let prompt_raw =
            serde_json::to_string(&prompt_body).map_err(|e| format!("serialize prompt body failed: {e}"))?;
        let post_res = run_curl_json(repo_path, "POST", prompt_url.as_str(), Some(prompt_raw.as_str()), 12);
        if let Err(post_err) = post_res {
            emit_stream_event(app, request_id, "debug", format!("prompt_async failed: {post_err}"));
            return Err(post_err);
        }

        let stream = stream_child
            .as_mut()
            .and_then(|c| c.stdout.take())
            .ok_or_else(|| "event stream stdout unavailable".to_string())?;
        let mut reader = BufReader::new(stream);
        let mut buf = String::new();
        let mut last_any_event = Instant::now();
        let timeout = Duration::from_secs(120);
        let mut seen_activity = false;
        let mut part_text: HashMap<String, String> = HashMap::new();
        let mut reasoning_part_text: HashMap<String, String> = HashMap::new();
        let mut message_roles: HashMap<String, String> = HashMap::new();
        let mut pending_delta: HashMap<String, String> = HashMap::new();
        let mut pending_part_full: HashMap<String, HashMap<String, String>> = HashMap::new();
        let mut pending_reasoning_full: HashMap<String, HashMap<String, String>> = HashMap::new();
        let mut trace_seen: HashSet<String> = HashSet::new();
        // True once we saw `message.part.delta` with `field == "text"` for the assistant (streaming text).
        let mut got_text_field_delta = false;
        // True once we saw `message.part.delta` with `field == "reasoning"` for the assistant (streaming reasoning).
        let mut got_reasoning_field_delta = false;

        loop {
            buf.clear();
            let n = reader
                .read_line(&mut buf)
                .map_err(|e| format!("read event stream failed: {e}"))?;
            if n == 0 {
                // SSE ends when the server closes the stream. Treat EOF as completion once we saw work,
                // instead of erroring — OpenCode may not send a dedicated "done" frame after tool bursts.
                if seen_activity {
                    return Ok(());
                }
                return Err("event stream closed unexpectedly".to_string());
            }
            let line = buf.trim_end_matches(['\r', '\n']);
            if !line.starts_with("data: ") {
                if seen_activity && last_any_event.elapsed() > timeout {
                    return Err("no stream events received within 120s".to_string());
                }
                continue;
            }
            last_any_event = Instant::now();
            let payload = &line[6..];
            let mut event: Value = match serde_json::from_str(payload) {
                Ok(v) => v,
                Err(_) => continue,
            };
            // Newer OpenCode server wraps events as:
            // { directory, payload: { type, properties } }
            // or { payload: { type, properties } }
            if let Some(wrapped) = event.get("payload") {
                event = wrapped.clone();
            }
            let typ = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

            if typ == "session.error" {
                let sid = event
                    .get("properties")
                    .and_then(|v| v.get("sessionID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid == session_id {
                    let err_msg = event
                        .get("properties")
                        .and_then(|v| v.get("error"))
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "session.error".to_string());
                    emit_stream_event(app, request_id, "trace", format!("session.error {err_msg}"));
                    return Err(format!("session error: {err_msg}"));
                }
            }

            // `/global/event` is a long-lived stream (with heartbeats), so it does not close per prompt.
            // For the current session, treat idle as terminal only after assistant activity was observed.
            if typ == "session.idle" {
                let sid = event
                    .get("properties")
                    .and_then(|v| v.get("sessionID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid == session_id {
                    if seen_activity {
                        emit_stream_event(app, request_id, "debug", "session.idle -> complete".to_string());
                        return Ok(());
                    }
                    emit_stream_event(app, request_id, "debug", "session.idle (no assistant activity yet)".to_string());
                    continue;
                }
            }

            if typ == "session.status" {
                let props = event.get("properties").and_then(|v| v.as_object());
                let sid = props
                    .and_then(|p| p.get("sessionID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid == session_id {
                    let status_typ = props
                        .and_then(|p| p.get("status"))
                        .and_then(|v| v.get("type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if status_typ == "idle" {
                        if seen_activity {
                            emit_stream_event(app, request_id, "debug", "session.status idle -> complete".to_string());
                            return Ok(());
                        }
                        emit_stream_event(app, request_id, "debug", "session.status idle (no assistant activity yet)".to_string());
                        continue;
                    }
                }
            }

            if typ == "message.updated" {
                let props = event.get("properties").and_then(|v| v.as_object());
                let sid = props
                    .and_then(|p| p.get("sessionID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid != session_id {
                    continue;
                }
                let info = props.and_then(|p| p.get("info")).and_then(|v| v.as_object());
                let role = info
                    .and_then(|i| i.get("role"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let mid = info
                    .and_then(|i| i.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !mid.is_empty() {
                    message_roles.insert(mid.to_string(), role.to_string());
                }
                if role == "assistant" && !mid.is_empty() {
                    seen_activity = true;
                    // Surface the server message id so the frontend can load detailed parts
                    // for the correct message (frontend creates its own local placeholder id).
                    emit_stream_event(app, request_id, "assistant_message_id", mid.to_string());
                    if let Some(delta) = pending_delta.remove(mid) {
                        if !delta.is_empty() {
                            got_text_field_delta = true;
                            emit_stream_event(app, request_id, "delta", delta);
                        }
                    }
                    let reasoning_key = format!("{mid}__reasoning");
                    if let Some(delta) = pending_delta.remove(&reasoning_key) {
                        if !delta.is_empty() {
                            emit_stream_event(app, request_id, "trace", delta.clone());
                            let payload = serde_json::json!({"type":"reasoning","text": delta}).to_string();
                            emit_stream_event(app, request_id, "delta", payload);
                            got_reasoning_field_delta = true;
                        }
                    }
                    if let Some(parts) = pending_part_full.remove(mid) {
                        for (part_id, full) in parts {
                            if full.is_empty() {
                                continue;
                            }
                            let key = format!("{mid}:{part_id}");
                            part_text.insert(key, full.clone());
                            if !got_text_field_delta {
                                emit_stream_event(app, request_id, "delta", full);
                            }
                        }
                    }
                    if let Some(parts) = pending_reasoning_full.remove(mid) {
                        for (part_id, full) in parts {
                            if full.is_empty() {
                                continue;
                            }
                            let key = format!("{mid}:{part_id}");
                            reasoning_part_text.insert(key.clone(), full.clone());
                            if !got_reasoning_field_delta {
                                let payload = serde_json::json!({"type":"reasoning","text": full}).to_string();
                                emit_stream_event(app, request_id, "delta", payload);
                                got_reasoning_field_delta = true;
                            }
                        }
                    }
                }
                continue;
            }

            if typ == "message.part.delta" {
                let props = event.get("properties").and_then(|v| v.as_object());
                let sid = props
                    .and_then(|p| p.get("sessionID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid != session_id {
                    continue;
                }
                let message_id = props
                    .and_then(|p| p.get("messageID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if message_id.is_empty() {
                    continue;
                }
                let field = props
                    .and_then(|p| p.get("field"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let delta = props
                    .and_then(|p| p.get("delta"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !delta.is_empty() {
                    if field == "reasoning" {
                        match message_roles.get(message_id).map(String::as_str) {
                            Some("assistant") => {
                                seen_activity = true;
                                emit_stream_event(app, request_id, "trace", delta.to_string());
                                let payload = serde_json::json!({"type":"reasoning","text": delta}).to_string();
                                emit_stream_event(app, request_id, "delta", payload);
                                got_reasoning_field_delta = true;
                            }
                            Some(_) => {}
                            None => {
                                let prev = pending_delta
                                    .entry(format!("{message_id}__reasoning"))
                                    .or_insert_with(String::new);
                                prev.push_str(&delta);
                            }
                        }
                        continue;
                    }
                    if field != "text" {
                        continue;
                    }
                    match message_roles.get(message_id).map(String::as_str) {
                        Some("assistant") => {
                            seen_activity = true;
                            got_text_field_delta = true;
                            emit_stream_event(app, request_id, "delta", delta.to_string());
                        }
                        Some(_) => {}
                        None => {
                            let prev = pending_delta.get(message_id).cloned().unwrap_or_default();
                            pending_delta.insert(message_id.to_string(), format!("{prev}{delta}"));
                        }
                    }
                }
                continue;
            }

            if typ == "message.part.updated" {
                let part = event
                    .get("properties")
                    .and_then(|v| v.get("part"))
                    .and_then(|v| v.as_object());
                let Some(part_obj) = part else {
                    continue;
                };
                let sid = part_obj
                    .get("sessionID")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid != session_id {
                    continue;
                }
                let message_id = part_obj
                    .get("messageID")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if message_id.is_empty() {
                    continue;
                }
                seen_activity = true;
                let part_type = part_obj
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let part_id = part_obj.get("id").and_then(|v| v.as_str()).unwrap_or("");

                if part_type == "tool" {
                    let tool = part_obj
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool");
                    let status = part_obj
                        .get("state")
                        .and_then(|v| v.get("status"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if status == "pending" || status == "running" || status == "completed" || status == "error" {
                        let key = format!("tool:{message_id}:{part_id}:{status}");
                        if !trace_seen.contains(key.as_str()) {
                            trace_seen.insert(key);
                            let input = part_obj
                                .get("state")
                                .and_then(|v| v.get("input"))
                                .and_then(|v| v.as_object());
                            let action = summarize_tool_trace(tool, input);
                            // OpenCode only enables "fetch detailed execution" for explore tasks.
                            if tool == "task" {
                                let subagent = input
                                    .and_then(|i| i.get("subagent_type"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                if subagent == "explore" {
                                    let payload = serde_json::json!({
                                        "messageID": message_id,
                                        "partID": part_id,
                                        "status": status,
                                        "input": input,
                                    });
                                    emit_stream_event(app, request_id, "explore_task", payload.to_string());
                                }
                            }
                            let human = if status == "error" {
                                format!("Error {action}")
                            } else if status == "completed" {
                                format!("Done {action}")
                            } else {
                                action
                            };
                            let structured = serde_json::json!({
                                "messageID": message_id,
                                "partID": part_id,
                                "type": "tool",
                                "status": status,
                                "tool": tool,
                                "text": human,
                            });
                            emit_stream_event(app, request_id, "trace_event", structured.to_string());
                            emit_stream_event(app, request_id, "trace", human);
                        }
                    }
                } else if part_type == "step-start" || part_type == "step-finish" {
                    let status = if part_type == "step-start" { "start" } else { "finish" };
                    let key = format!("step:{message_id}:{part_id}:{status}");
                    if !trace_seen.contains(key.as_str()) {
                        trace_seen.insert(key);
                        let title = part_obj
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("step")
                            .trim()
                            .to_string();
                        let action = if part_type == "step-start" { "Step" } else { "Done" };
                        let human = format!("{action} {title}");
                        let structured = serde_json::json!({
                            "messageID": message_id,
                            "partID": part_id,
                            "type": part_type,
                            "status": status,
                            "title": title,
                            "text": human,
                        });
                        emit_stream_event(app, request_id, "trace_event", structured.to_string());
                        emit_stream_event(app, request_id, "trace", human);
                    }
                }

                if part_type == "text" && !got_text_field_delta {
                    let key = format!("{message_id}:{part_id}");
                    let full = part_obj
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    match message_roles.get(message_id).map(String::as_str) {
                        Some("assistant") => {}
                        Some(_) => continue,
                        None => {
                            let bucket = pending_part_full
                                .entry(message_id.to_string())
                                .or_insert_with(HashMap::new);
                            bucket.insert(part_id.to_string(), full);
                            continue;
                        }
                    }
                    let prev = part_text.get(key.as_str()).cloned().unwrap_or_default();
                    let delta = if full.starts_with(prev.as_str()) {
                        full.get(prev.len()..).unwrap_or("").to_string()
                    } else {
                        full.clone()
                    };
                    part_text.insert(key, full);
                    if !delta.is_empty() {
                        emit_stream_event(app, request_id, "delta", delta);
                    }
                }

                if part_type == "reasoning" && !got_reasoning_field_delta {
                    let key = format!("{message_id}:{part_id}");
                    let full = part_obj
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    match message_roles.get(message_id).map(String::as_str) {
                        Some("assistant") => {}
                        Some(_) => continue,
                        None => {
                            let bucket = pending_reasoning_full
                                .entry(message_id.to_string())
                                .or_insert_with(HashMap::new);
                            bucket.insert(part_id.to_string(), full);
                            continue;
                        }
                    }
                    let prev = reasoning_part_text.get(key.as_str()).cloned().unwrap_or_default();
                    let delta = if full.starts_with(prev.as_str()) {
                        full.get(prev.len()..).unwrap_or("").to_string()
                    } else {
                        full.clone()
                    };
                    reasoning_part_text.insert(key, full);
                    if !delta.is_empty() {
                        let payload = serde_json::json!({"type":"reasoning","text": delta}).to_string();
                        emit_stream_event(app, request_id, "delta", payload);
                    }
                }
                continue;
            }

            if seen_activity && last_any_event.elapsed() > timeout {
                return Err("no stream events received within 120s".to_string());
            }
        }
    });

    if let Some(mut s) = stream_child {
        let _ = s.kill();
        let _ = s.wait_timeout(Duration::from_secs(1));
    }
    run
}

#[tauri::command]
pub fn list_opencode_sessions(repo_path: &str, limit: Option<u32>) -> Result<Vec<OpencodeSessionSummary>, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let mut url = format!("{base}/session");
        if let Some(l) = limit {
            if l > 0 {
                url.push_str(format!("?limit={}", l).as_str());
            }
        }
        let raw = run_curl_json(repo_path, "GET", url.as_str(), None, 10)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse session list failed: {e}"))?;
        let arr = json
            .as_array()
            .ok_or_else(|| "invalid session list response".to_string())?;
        let mut out: Vec<OpencodeSessionSummary> = arr.iter().filter_map(parse_session_summary).collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    })
}

#[tauri::command]
pub fn get_opencode_current_project(repo_path: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/project/current").as_str(), None, 10)?;
        serde_json::from_str::<Value>(&raw).map_err(|e| format!("parse current project failed: {e}"))
    })
}

#[tauri::command]
pub fn list_opencode_projects(repo_path: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/project").as_str(), None, 10)?;
        serde_json::from_str::<Value>(&raw).map_err(|e| format!("parse project list failed: {e}"))
    })
}

#[tauri::command]
pub fn create_opencode_session(repo_path: &str, title: Option<String>) -> Result<OpencodeSessionSummary, String> {
    command_runner::validate_repo_path(repo_path)?;
    let body = if let Some(t) = title.as_deref() {
        let tt = t.trim();
        if tt.is_empty() {
            "{}".to_string()
        } else {
            serde_json::json!({ "title": tt }).to_string()
        }
    } else {
        "{}".to_string()
    };
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "POST", format!("{base}/session").as_str(), Some(body.as_str()), 10)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse session create failed: {e}"))?;
        parse_session_summary(&json).ok_or_else(|| "invalid session create response".to_string())
    })
}

#[tauri::command]
pub fn delete_opencode_session(repo_path: &str, session_id: &str) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let sid = session_id.trim();
    if sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        let _ = run_curl_json(
            repo_path,
            "DELETE",
            format!("{base}/session/{sid}").as_str(),
            None,
            10,
        )?;
        Ok(true)
    })
}

#[tauri::command]
pub fn get_opencode_session_messages(
    repo_path: &str,
    session_id: &str,
    limit: Option<u32>,
) -> Result<Vec<OpencodeSessionMessage>, String> {
    command_runner::validate_repo_path(repo_path)?;
    let sid = session_id.trim();
    if sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        let mut url = format!("{base}/session/{sid}/message");
        if let Some(l) = limit {
            if l > 0 {
                url.push_str(format!("?limit={}", l).as_str());
            }
        }
        let raw = run_curl_json(repo_path, "GET", url.as_str(), None, 15)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse session messages failed: {e}"))?;
        let arr = json
            .as_array()
            .ok_or_else(|| "invalid session messages response".to_string())?;
        let mut out: Vec<OpencodeSessionMessage> = Vec::new();
        for item in arr {
            let info = item.get("info").and_then(|v| v.as_object());
            let parts = item.get("parts").and_then(|v| v.as_array());
            let id = info
                .and_then(|x| x.get("id"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if id.is_empty() {
                continue;
            }
            let role = info
                .and_then(|x| x.get("role"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if role != "user" && role != "assistant" {
                continue;
            }
            let content = extract_text_from_parts(parts.unwrap_or(&Vec::new()));
            out.push(OpencodeSessionMessage { id, role, content });
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn get_opencode_session_messages_detailed(
    repo_path: &str,
    session_id: &str,
    directory: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let sid = session_id.trim();
    if sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        let mut url = format!("{base}/session/{sid}/message");
        let mut qs: Vec<String> = Vec::new();
        if let Some(dir) = &directory {
            let d = dir.trim();
            if !d.is_empty() {
                // Keep behavior aligned with the web client which sends `directory=...`.
                // Note: run_curl_json also attaches directory header; query param improves compatibility.
                qs.push(format!("directory={}", urlencoding::encode(d)));
            }
        }
        if let Some(l) = limit {
            if l > 0 {
                qs.push(format!("limit={}", l));
            }
        }
        if !qs.is_empty() {
            url.push('?');
            url.push_str(qs.join("&").as_str());
        }
        let raw = run_curl_json(repo_path, "GET", url.as_str(), None, 15)?;
        serde_json::from_str::<Value>(&raw).map_err(|e| format!("parse session messages failed: {e}"))
    })
}

#[tauri::command]
pub fn post_opencode_session_prompt_async(
    repo_path: &str,
    session_id: &str,
    prompt: &str,
    model: Option<String>,
) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let sid = session_id.trim();
    if sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    let text = prompt.trim();
    if text.is_empty() {
        return Err("prompt must not be empty".to_string());
    }
    let mut body = serde_json::json!({
        "parts": [{ "type": "text", "text": text }]
    });
    if let Some(m) = model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        if let Some(obj) = body.as_object_mut() {
            if let Some((provider_id, model_id)) = parse_model_ref(m) {
                obj.insert(
                    "model".to_string(),
                    serde_json::json!({
                        "providerID": provider_id,
                        "modelID": model_id
                    }),
                );
            } else {
                return Err("model must be in format provider/model".to_string());
            }
        }
    }
    with_service_base(repo_path, |base| {
        let raw = serde_json::to_string(&body).map_err(|e| format!("serialize prompt_async body failed: {e}"))?;
        let _ = run_curl_json(
            repo_path,
            "POST",
            format!("{base}/session/{sid}/prompt_async").as_str(),
            Some(raw.as_str()),
            45,
        )?;
        Ok(true)
    })
}

#[tauri::command]
pub fn abort_opencode_session(
    repo_path: &str,
    session_id: &str,
    directory: Option<String>,
) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let sid = session_id.trim();
    if sid.is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        let mut url = format!("{base}/session/{sid}/abort");
        if let Some(d) = directory.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            url.push_str(format!("?directory={}", urlencoding::encode(d)).as_str());
        }
        let _ = run_curl_json(repo_path, "POST", url.as_str(), Some("{}"), 12)?;
        Ok(true)
    })
}

#[tauri::command]
pub fn get_opencode_model_config(repo_path: &str) -> Result<OpencodeModelConfig, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/global/config").as_str(), None, 15)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse /global/config failed: {e}"))?;
        let configured_model = json
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(OpencodeModelConfig {
            config_path: "server:/global/config".to_string(),
            configured_model,
            exists: true,
        })
    })
}

#[tauri::command]
pub fn get_opencode_config_provider_catalog(repo_path: &str) -> Result<Vec<OpencodeConfigProviderCatalog>, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/global/config").as_str(), None, 15)?;
        let root: Value = serde_json::from_str(&raw).map_err(|e| format!("parse /global/config failed: {e}"))?;
        Ok(extract_config_provider_catalog(&root))
    })
}

fn parse_server_provider_models(provider: &Value) -> (Vec<String>, HashMap<String, String>) {
    // Provider shape can vary across versions. Be defensive:
    // - models: string[]
    // - models: { id: string }[]
    // - models: { [modelID]: ... } (rare)
    // - modelNames / model_names: { [modelID]: displayName } (sometimes separate from models)
    let mut models: Vec<String> = Vec::new();
    let mut model_names: HashMap<String, String> = HashMap::new();
    if let Some(arr) = provider.get("models").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                let cleaned = s.trim();
                if !cleaned.is_empty() {
                    models.push(cleaned.to_string());
                    model_names.insert(cleaned.to_string(), cleaned.to_string());
                }
                continue;
            }
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                let cleaned = id.trim();
                if !cleaned.is_empty() {
                    models.push(cleaned.to_string());
                    let display = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(|v| v.trim())
                        .filter(|v| !v.is_empty())
                        .unwrap_or(cleaned);
                    model_names.insert(cleaned.to_string(), display.to_string());
                }
            }
        }
    } else if let Some(obj) = provider.get("models").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            let cleaned = k.trim();
            if !cleaned.is_empty() {
                models.push(cleaned.to_string());
                let display = v
                    .get("name")
                    .and_then(|vv| vv.as_str())
                    .map(|vv| vv.trim())
                    .filter(|vv| !vv.is_empty())
                    .unwrap_or(cleaned);
                model_names.insert(cleaned.to_string(), display.to_string());
            }
        }
    }

    // Some /provider versions provide display names separately, e.g.
    // { models: ["k2p5"], modelNames: { "k2p5": "kimi2.5" } }
    // Merge these mappings (prefer explicit display names when non-empty).
    for key in ["modelNames", "model_names"] {
        if let Some(obj) = provider.get(key).and_then(|v| v.as_object()) {
            for (mid, name_v) in obj {
                let model_id = mid.trim();
                if model_id.is_empty() {
                    continue;
                }
                if let Some(display_raw) = name_v.as_str() {
                    let display = display_raw.trim();
                    if !display.is_empty() {
                        model_names.insert(model_id.to_string(), display.to_string());
                    }
                }
            }
        }
    }

    models.sort();
    models.dedup();
    for id in &models {
        model_names.entry(id.clone()).or_insert_with(|| id.clone());
    }
    (models, model_names)
}

fn parse_server_providers_from_json(root: &Value) -> Vec<OpencodeServerProviderCatalog> {
    let mut out: Vec<OpencodeServerProviderCatalog> = Vec::new();
    let providers = root
        .get("providers")
        .and_then(|v| v.as_array())
        .or_else(|| root.get("all").and_then(|v| v.as_array()))
        .cloned()
        .unwrap_or_default();
    for p in providers {
        let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if id.is_empty() {
            continue;
        }
        let name = p
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(id.as_str())
            .trim()
            .to_string();
        let (models, model_names) = parse_server_provider_models(&p);
        let source = p
            .get("source")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        out.push(OpencodeServerProviderCatalog {
            id,
            name,
            models,
            model_names,
            source,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[tauri::command]
pub fn get_opencode_server_provider_catalog(repo_path: &str) -> Result<Vec<OpencodeServerProviderCatalog>, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        // Source of truth for provider + model catalog is /provider.
        let prov_raw = run_curl_json(repo_path, "GET", format!("{base}/provider").as_str(), None, 12)?;
        let prov_json: Value = serde_json::from_str(&prov_raw).map_err(|e| format!("parse /provider failed: {e}"))?;
        let parsed = parse_server_providers_from_json(&prov_json);
        if !parsed.is_empty() {
            return Ok(parsed);
        }
        // Fallback to /config/providers only when /provider returns empty in unexpected environments.
        let cfg_raw = run_curl_json(repo_path, "GET", format!("{base}/config/providers").as_str(), None, 12)?;
        let cfg_json: Value = serde_json::from_str(&cfg_raw).map_err(|e| format!("parse /config/providers failed: {e}"))?;
        Ok(parse_server_providers_from_json(&cfg_json))
    })
}

#[tauri::command]
pub fn get_opencode_server_provider_state(repo_path: &str) -> Result<OpencodeServerProviderState, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/provider").as_str(), None, 15)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse /provider failed: {e}"))?;
        let connected: Vec<String> = json
            .get("connected")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut providers = parse_server_providers_from_json(&json);

        // Some OpenCode builds return only model ids in /provider, while richer model objects
        // (with display `name`) live under /config/providers (or `all`-like shapes).
        // If modelNames are missing (or all equal to id), merge from /config/providers.
        let needs_names = providers.iter().any(|p| {
            p.models.iter().any(|mid| match p.model_names.get(mid) {
                None => true,
                Some(v) => {
                    let s = v.trim();
                    s.is_empty() || s == mid.as_str()
                }
            })
        });
        if needs_names {
            if let Ok(cfg_raw) = run_curl_json(repo_path, "GET", format!("{base}/config/providers").as_str(), None, 12) {
                if let Ok(cfg_json) = serde_json::from_str::<Value>(&cfg_raw) {
                    let extra = parse_server_providers_from_json(&cfg_json);
                    providers = merge_server_provider_catalog(providers, extra);
                }
            }
        }
        Ok(OpencodeServerProviderState { providers, connected })
    })
}

#[tauri::command]
pub fn get_opencode_server_provider_auth(repo_path: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/provider/auth").as_str(), None, 15)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse /provider/auth failed: {e}"))?;
        Ok(json)
    })
}

#[tauri::command]
pub fn get_opencode_server_config(repo_path: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        run_config_get(repo_path, base)
    })
}

#[tauri::command]
pub fn get_opencode_service_base(repo_path: &str) -> Result<String, String> {
    command_runner::validate_repo_path(repo_path)?;
    ensure_managed_service_local(repo_path)
}

#[tauri::command]
pub fn get_opencode_service_settings() -> Result<OpencodeServiceSettings, String> {
    Ok(read_opencode_service_settings())
}

#[tauri::command]
pub fn set_opencode_service_settings(
    settings: OpencodeServiceSettings,
    repo_path: Option<String>,
) -> Result<OpencodeServiceSettings, String> {
    if settings.port == 0 {
        return Err("service port must be between 1 and 65535".to_string());
    }
    let next = OpencodeServiceSettings {
        port: settings.port,
    };
    write_opencode_service_settings(&next)?;
    release_managed_service();
    if let Some(repo) = repo_path {
        let rp = repo.trim().to_string();
        if !rp.is_empty() {
            command_runner::validate_repo_path(rp.as_str())?;
            let _ = ensure_managed_service_local(rp.as_str())?;
        }
    }
    Ok(next)
}

#[tauri::command]
pub fn get_opencode_server_global_config(repo_path: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/global/config").as_str(), None, 15)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse /global/config failed: {e}"))?;
        Ok(json)
    })
}

#[tauri::command]
pub fn patch_opencode_server_config(repo_path: &str, patch: Value) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    with_service_base(repo_path, |base| {
        run_config_patch(repo_path, base, &patch)
    })
}

#[tauri::command]
pub fn set_opencode_server_current_model(repo_path: &str, model: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let m = model.trim();
    if m.is_empty() {
        return Err("model must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        // OpenCode behavior: current model lives under /config (not /global/config).
        let body = serde_json::json!({ "model": m }).to_string();
        let raw = run_curl_json(repo_path, "PATCH", format!("{base}/config").as_str(), Some(body.as_str()), 20)?;
        serde_json::from_str(&raw).map_err(|e| format!("parse patch /config response failed: {e}"))
    })
}

#[tauri::command]
pub fn put_opencode_server_auth(repo_path: &str, provider_id: &str, key: &str) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let pid = provider_id.trim();
    if pid.is_empty() {
        return Err("provider_id must not be empty".to_string());
    }
    let k = key.trim();
    if k.is_empty() {
        return Err("key must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        let body = serde_json::json!({ "type": "api", "key": k }).to_string();
        let _ = run_curl_json(
            repo_path,
            "PUT",
            format!("{base}/auth/{pid}").as_str(),
            Some(body.as_str()),
            15,
        )?;
        // Re-enable provider if it was previously disabled by "disconnect".
        if let Ok(global_raw) = run_curl_json(repo_path, "GET", format!("{base}/global/config").as_str(), None, 15) {
            if let Ok(global_json) = serde_json::from_str::<Value>(&global_raw) {
                let disabled = global_json
                    .get("disabled_providers")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty() && s != pid)
                    .collect::<Vec<_>>();
                let patch = serde_json::json!({ "disabled_providers": disabled });
                let _ = run_config_patch(repo_path, base, &patch);
            }
        }
        // Match OpenCode web behavior: dispose global state so auth/provider
        // changes are immediately reflected by /provider and /config views.
        let _ = run_curl_json(repo_path, "POST", format!("{base}/global/dispose").as_str(), Some("{}"), 8);
        Ok(true)
    })
}

#[tauri::command]
pub fn delete_opencode_server_auth(repo_path: &str, provider_id: &str) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let pid = provider_id.trim();
    if pid.is_empty() {
        return Err("provider_id must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        let _ = run_curl_json(
            repo_path,
            "DELETE",
            format!("{base}/auth/{pid}").as_str(),
            None,
            15,
        )?;
        // Keep provider/auth state consistent for subsequent /provider reads.
        let _ = run_curl_json(repo_path, "POST", format!("{base}/global/dispose").as_str(), Some("{}"), 8);
        Ok(true)
    })
}

#[tauri::command]
pub fn disconnect_opencode_server_provider(repo_path: &str, provider_id: &str) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let pid = provider_id.trim();
    if pid.is_empty() {
        return Err("provider_id must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        // Inspect latest provider state from server.
        let state_raw = run_curl_json(repo_path, "GET", format!("{base}/provider").as_str(), None, 15)?;
        let state_json: Value =
            serde_json::from_str(&state_raw).map_err(|e| format!("parse /provider failed: {e}"))?;
        let mut source = String::new();
        if let Some(all) = state_json.get("all").and_then(|v| v.as_array()) {
            for item in all {
                let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
                if id == pid {
                    source = item
                        .get("source")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_lowercase();
                    break;
                }
            }
        }

        // Always try removing auth first (ignore missing-auth errors).
        let _ = run_curl_json(
            repo_path,
            "DELETE",
            format!("{base}/auth/{}", urlencoding::encode(pid)).as_str(),
            None,
            15,
        );

        // For config providers, disconnect also disables provider in global config.
        let global_raw = run_curl_json(repo_path, "GET", format!("{base}/global/config").as_str(), None, 15)?;
        let mut global_json: Value =
            serde_json::from_str(&global_raw).map_err(|e| format!("parse /global/config failed: {e}"))?;
        let has_provider_cfg = global_json
            .get("provider")
            .and_then(|v| v.as_object())
            .map(|m| m.contains_key(pid))
            .unwrap_or(false);
        if source == "config" || has_provider_cfg {
            let mut disabled = global_json
                .get("disabled_providers")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            if !disabled.iter().any(|x| x == pid) {
                disabled.push(pid.to_string());
            }
            disabled.sort();
            disabled.dedup();
            if let Some(obj) = global_json.as_object_mut() {
                obj.insert(
                    "disabled_providers".to_string(),
                    Value::Array(disabled.into_iter().map(Value::String).collect()),
                );
            }
            let body =
                serde_json::to_string(&global_json).map_err(|e| format!("serialize global config failed: {e}"))?;
            let _ = run_curl_json(
                repo_path,
                "PATCH",
                format!("{base}/global/config").as_str(),
                Some(body.as_str()),
                20,
            )?;
        }

        // Dispose for immediate consistency in provider listing.
        let _ = run_curl_json(repo_path, "POST", format!("{base}/global/dispose").as_str(), Some("{}"), 8);
        Ok(true)
    })
}

#[tauri::command]
pub fn set_opencode_model_config(repo_path: &str, model: &str) -> Result<OpencodeModelConfig, String> {
    command_runner::validate_repo_path(repo_path)?;
    if model.trim().is_empty() {
        return Err("model must not be empty".to_string());
    }
    let model_full = model.trim().to_string();
    with_service_base(repo_path, |base| {
        let body = serde_json::to_string(&serde_json::json!({ "model": model_full }))
            .map_err(|e| format!("serialize config patch failed: {e}"))?;
        let _ = run_curl_json(
            repo_path,
            "PATCH",
            format!("{base}/global/config").as_str(),
            Some(body.as_str()),
            20,
        )?;
        let _ = run_curl_json(repo_path, "POST", format!("{base}/global/dispose").as_str(), Some("{}"), 8);
        Ok(OpencodeModelConfig {
            config_path: "server:/global/config".to_string(),
            configured_model: model.trim().to_string(),
            exists: true,
        })
    })
}

#[tauri::command]
pub fn get_opencode_provider_config(repo_path: &str, provider: &str) -> Result<OpencodeProviderConfig, String> {
    command_runner::validate_repo_path(repo_path)?;
    if provider.trim().is_empty() {
        return Err("provider must not be empty".to_string());
    }
    with_service_base(repo_path, |base| {
        let raw = run_curl_json(repo_path, "GET", format!("{base}/global/config").as_str(), None, 15)?;
        let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse /global/config failed: {e}"))?;
        let pnode = json
            .get("provider")
            .and_then(|v| v.get(provider.trim()))
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        let options = pnode.get("options").cloned().unwrap_or_else(|| Value::Object(Map::new()));

        Ok(OpencodeProviderConfig {
            provider: provider.trim().to_string(),
            npm: pnode.get("npm").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name: pnode.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            base_url: options
                .get("baseURL")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            api_key: {
                let key_in_config = options
                    .get("apiKey")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if key_in_config.trim().is_empty() {
                    get_opencode_auth_api_key(provider)
                } else {
                    key_in_config
                }
            },
            endpoint: options
                .get("endpoint")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            region: options
                .get("region")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            profile: options
                .get("profile")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            project: options
                .get("project")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            location: options
                .get("location")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            resource_name: options
                .get("resourceName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            enterprise_url: options
                .get("enterpriseUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            timeout: options
                .get("timeout")
                .map(|v| if v.is_number() { v.to_string() } else { v.as_str().unwrap_or("").to_string() })
                .unwrap_or_default(),
            chunk_timeout: options
                .get("chunkTimeout")
                .map(|v| if v.is_number() { v.to_string() } else { v.as_str().unwrap_or("").to_string() })
                .unwrap_or_default(),
        })
    })
}

#[tauri::command]
pub fn set_opencode_provider_config(
    repo_path: &str,
    provider: &str,
    npm: Option<String>,
    name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    headers: Option<Map<String, Value>>,
    endpoint: Option<String>,
    region: Option<String>,
    profile: Option<String>,
    project: Option<String>,
    location: Option<String>,
    resource_name: Option<String>,
    enterprise_url: Option<String>,
    timeout: Option<String>,
    chunk_timeout: Option<String>,
    model_id: Option<String>,
    model_name: Option<String>,
) -> Result<OpencodeProviderConfig, String> {
    command_runner::validate_repo_path(repo_path)?;
    if provider.trim().is_empty() {
        return Err("provider must not be empty".to_string());
    }

    let npm_v = npm.unwrap_or_default().trim().to_string();
    let name_v = name.unwrap_or_default().trim().to_string();
    let base = base_url.unwrap_or_default().trim().to_string();
    let key_raw = api_key.unwrap_or_default().trim().to_string();
    let key_env = parse_env_placeholder(&key_raw);
    let key = if key_env.is_some() { String::new() } else { key_raw.clone() };
    let endpoint_v = endpoint.unwrap_or_default().trim().to_string();
    let region_v = region.unwrap_or_default().trim().to_string();
    let profile_v = profile.unwrap_or_default().trim().to_string();
    let project_v = project.unwrap_or_default().trim().to_string();
    let location_v = location.unwrap_or_default().trim().to_string();
    let resource_name_v = resource_name.unwrap_or_default().trim().to_string();
    let enterprise_url_v = enterprise_url.unwrap_or_default().trim().to_string();
    let timeout_v = timeout.unwrap_or_default().trim().to_string();
    let chunk_timeout_v = chunk_timeout.unwrap_or_default().trim().to_string();
    let model_id_v = model_id.unwrap_or_default().trim().to_string();
    let model_name_v = model_name.unwrap_or_default().trim().to_string();
    with_service_base(repo_path, |base_ep| {
        let mut options = Map::new();
        if !base.is_empty() {
            options.insert("baseURL".to_string(), Value::String(base.clone()));
        }
        if let Some(h) = headers.clone() {
            let mut header_obj: Map<String, Value> = Map::new();
            for (k, v) in h {
                let kk = k.trim().to_string();
                let vv = v.as_str().unwrap_or("").trim().to_string();
                if !kk.is_empty() && !vv.is_empty() {
                    header_obj.insert(kk, Value::String(vv));
                }
            }
            if !header_obj.is_empty() {
                options.insert("headers".to_string(), Value::Object(header_obj));
            }
        }
        if !endpoint_v.is_empty() {
            options.insert("endpoint".to_string(), Value::String(endpoint_v.clone()));
        }
        if !region_v.is_empty() {
            options.insert("region".to_string(), Value::String(region_v.clone()));
        }
        if !profile_v.is_empty() {
            options.insert("profile".to_string(), Value::String(profile_v.clone()));
        }
        if !project_v.is_empty() {
            options.insert("project".to_string(), Value::String(project_v.clone()));
        }
        if !location_v.is_empty() {
            options.insert("location".to_string(), Value::String(location_v.clone()));
        }
        if !resource_name_v.is_empty() {
            options.insert("resourceName".to_string(), Value::String(resource_name_v.clone()));
        }
        if !enterprise_url_v.is_empty() {
            options.insert("enterpriseUrl".to_string(), Value::String(enterprise_url_v.clone()));
        }
        if !timeout_v.is_empty() {
            if let Ok(n) = timeout_v.parse::<i64>() {
                options.insert("timeout".to_string(), Value::Number(n.into()));
            } else {
                options.insert("timeout".to_string(), Value::String(timeout_v.clone()));
            }
        }
        if !chunk_timeout_v.is_empty() {
            if let Ok(n) = chunk_timeout_v.parse::<i64>() {
                options.insert("chunkTimeout".to_string(), Value::Number(n.into()));
            } else {
                options.insert("chunkTimeout".to_string(), Value::String(chunk_timeout_v.clone()));
            }
        }

        let mut provider_node = Map::new();
        if !npm_v.is_empty() {
            provider_node.insert("npm".to_string(), Value::String(npm_v.clone()));
        }
        if !name_v.is_empty() {
            provider_node.insert("name".to_string(), Value::String(name_v.clone()));
        }
        if !options.is_empty() {
            provider_node.insert("options".to_string(), Value::Object(options));
        }
        if !model_id_v.is_empty() {
            let model_entry = if model_name_v.is_empty() {
                Value::Object(Map::new())
            } else {
                serde_json::json!({ "name": model_name_v })
            };
            let mut models_patch = Map::new();
            models_patch.insert(model_id_v.clone(), model_entry);
            provider_node.insert(
                "models".to_string(),
                Value::Object(models_patch),
            );
        }
        if let Some(env_name) = key_env.as_deref() {
            provider_node.insert("env".to_string(), Value::Array(vec![Value::String(env_name.to_string())]));
        }

        let global_raw = run_curl_json(repo_path, "GET", format!("{base_ep}/global/config").as_str(), None, 15)?;
        let mut global_json: Value =
            serde_json::from_str(&global_raw).map_err(|e| format!("parse /global/config failed: {e}"))?;

        // If caller does not provide a model id, keep existing models for this provider.
        if model_id_v.is_empty() {
            let existing_models = global_json
                .get("provider")
                .and_then(|v| v.get(provider.trim()))
                .and_then(|v| v.get("models"))
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            if !existing_models.is_empty() {
                provider_node.insert("models".to_string(), Value::Object(existing_models));
            }
        }

        let filtered_disabled = global_json
            .get("disabled_providers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str())
                    .filter(|id| *id != provider.trim())
                    .map(|id| Value::String(id.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        // Replace target provider node in full global config to avoid stale model merge.
        if !global_json.is_object() {
            global_json = serde_json::json!({});
        }
        let obj = global_json.as_object_mut().ok_or_else(|| "global config is not an object".to_string())?;
        if !obj.contains_key("provider") || !obj.get("provider").unwrap_or(&Value::Null).is_object() {
            obj.insert("provider".to_string(), Value::Object(Map::new()));
        }
        if let Some(provider_obj) = obj.get_mut("provider").and_then(|v| v.as_object_mut()) {
            provider_obj.insert(provider.trim().to_string(), Value::Object(provider_node.clone()));
        }
        obj.insert("disabled_providers".to_string(), Value::Array(filtered_disabled));

        let body = serde_json::to_string(&global_json).map_err(|e| format!("serialize config patch failed: {e}"))?;
        let _ = run_curl_json(
            repo_path,
            "PATCH",
            format!("{base_ep}/global/config").as_str(),
            Some(body.as_str()),
            20,
        )?;

        if let Some(_) = key_env {
            set_opencode_auth_api_key(provider, "")?;
        } else {
            set_opencode_auth_api_key(provider, key.as_str())?;
        }
        let _ = run_curl_json(repo_path, "POST", format!("{base_ep}/global/dispose").as_str(), Some("{}"), 8);
        Ok(())
    })?;

    Ok(OpencodeProviderConfig {
        provider: provider.trim().to_string(),
        npm: npm_v,
        name: name_v,
        base_url: base,
        api_key: key_raw,
        endpoint: endpoint_v,
        region: region_v,
        profile: profile_v,
        project: project_v,
        location: location_v,
        resource_name: resource_name_v,
        enterprise_url: enterprise_url_v,
        timeout: timeout_v,
        chunk_timeout: chunk_timeout_v,
    })
}

#[tauri::command]
pub fn run_opencode_version(repo_path: &str) -> Result<String, String> {
    run_opencode(&["--version"], repo_path)
}

#[tauri::command]
pub fn run_opencode_providers(repo_path: &str) -> Result<String, String> {
    run_opencode(&["providers", "list"], repo_path)
}

#[tauri::command]
pub fn run_opencode_models(repo_path: &str, provider: Option<String>) -> Result<String, String> {
    if let Some(p) = provider {
        if p.trim().is_empty() {
            return run_opencode(&["models"], repo_path);
        }
        return run_opencode(&["models", p.trim()], repo_path);
    }
    run_opencode(&["models"], repo_path)
}

#[tauri::command]
pub fn get_opencode_models_dev_catalog(repo_path: &str) -> Result<Vec<OpencodeCatalogProvider>, String> {
    if let Some(cache_path) = opencode_models_cache_path() {
        if let Ok(raw) = fs::read_to_string(&cache_path) {
            if let Ok(parsed) = parse_models_dev_catalog(&raw) {
                if !parsed.is_empty() {
                    return Ok(parsed);
                }
            }
        }
    }

    let raw = command_runner::run_and_capture_in_dir_with_timeout(
        "curl",
        &["-fsSL", "https://models.dev/api.json"],
        repo_path,
        30,
    )?;
    parse_models_dev_catalog(&raw)
}

#[tauri::command]
pub fn run_opencode_agent(repo_path: &str) -> Result<String, String> {
    run_opencode(&["agent", "list"], repo_path)
}

#[tauri::command]
pub fn run_opencode_mcp(repo_path: &str) -> Result<String, String> {
    run_opencode(&["mcp", "list"], repo_path)
}

#[tauri::command]
pub fn run_opencode_stats(repo_path: &str) -> Result<String, String> {
    run_opencode(&["stats"], repo_path)
}

#[tauri::command]
pub fn test_opencode_model(repo_path: &str, model: &str, message: Option<String>) -> Result<String, String> {
    if model.trim().is_empty() {
        return Err("model must not be empty".to_string());
    }
    let prompt = message.unwrap_or_else(|| "Respond with OK only.".to_string());
    command_runner::run_and_capture_in_dir_with_timeout(
        "opencode",
        &[
            "run",
            prompt.as_str(),
            "--model",
            model.trim(),
            "--format",
            "json",
        ],
        repo_path,
        90,
    )
}

#[tauri::command]
pub fn run_opencode_prompt(
    repo_path: &str,
    prompt: &str,
    model: Option<String>,
) -> Result<String, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt must not be empty".to_string());
    }
    let model_trimmed = model.unwrap_or_default().trim().to_string();
    if model_trimmed.is_empty() {
        return command_runner::run_and_capture_in_dir_with_timeout(
            "opencode",
            &["run", prompt, "--format", "json"],
            repo_path,
            120,
        );
    }
    command_runner::run_and_capture_in_dir_with_timeout(
        "opencode",
        &["run", prompt, "--model", model_trimmed.as_str(), "--format", "json"],
        repo_path,
        120,
    )
}

#[tauri::command]
pub fn run_opencode_prompt_stream(
    app: tauri::AppHandle,
    repo_path: &str,
    prompt: &str,
    model: Option<String>,
    session_id: Option<String>,
    request_id: &str,
) -> Result<(), String> {
    command_runner::validate_repo_path(repo_path)?;
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt must not be empty".to_string());
    }
    let model = model.unwrap_or_default().trim().to_string();
    let session_id = session_id.unwrap_or_default().trim().to_string();
    let repo = repo_path.to_string();
    let req = request_id.trim().to_string();
    if req.is_empty() {
        return Err("request_id must not be empty".to_string());
    }

    std::thread::spawn(move || {
        let sid_opt = if session_id.is_empty() {
            None
        } else {
            Some(session_id.as_str())
        };
        let stream_res = stream_prompt_via_opencode_service(&app, &repo, &prompt, &model, sid_opt, &req);
        match stream_res {
            Ok(()) => emit_stream_event(&app, &req, "done", String::new()),
            Err(stream_err) => {
                let fallback = if model.is_empty() {
                    run_opencode_prompt(&repo, &prompt, None)
                } else {
                    run_opencode_prompt(&repo, &prompt, Some(model.clone()))
                };
                match fallback {
                    Ok(raw) => {
                        let text = extract_run_json_text(&raw);
                        if !text.trim().is_empty() {
                            emit_stream_event(&app, &req, "delta", text);
                            emit_stream_event(&app, &req, "fallback", String::new());
                        } else {
                            emit_stream_event(
                                &app,
                                &req,
                                "error",
                                format!("stream failed and fallback returned empty: {stream_err}"),
                            );
                        }
                    }
                    Err(fallback_err) => {
                        emit_stream_event(
                            &app,
                            &req,
                            "error",
                            format!("stream failed: {stream_err}\nfallback failed: {fallback_err}"),
                        );
                    }
                }
                emit_stream_event(&app, &req, "done", String::new());
            }
        };
    });

    Ok(())
}

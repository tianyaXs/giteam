use super::command_runner;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;
use wait_timeout::ChildExt;

const OPENCODE_TIMEOUT_SECS: u64 = 45;

struct ManagedOpencodeService {
    child: std::process::Child,
    base: String,
}

static OPENCODE_SERVICE_POOL: OnceLock<Mutex<HashMap<String, ManagedOpencodeService>>> = OnceLock::new();

fn service_pool() -> &'static Mutex<HashMap<String, ManagedOpencodeService>> {
    OPENCODE_SERVICE_POOL.get_or_init(|| Mutex::new(HashMap::new()))
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeServerProviderState {
    pub providers: Vec<OpencodeServerProviderCatalog>,
    pub connected: Vec<String>,
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

fn project_config_path(repo_path: &str) -> String {
    Path::new(repo_path)
        .join("opencode.json")
        .to_string_lossy()
        .to_string()
}

fn read_project_config_json(repo_path: &str) -> Result<Value, String> {
    let path = project_config_path(repo_path);
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(Value::Object(Map::new()));
    }
    let raw = fs::read_to_string(p).map_err(|e| format!("read opencode config failed: {e}"))?;
    serde_json::from_str::<Value>(&raw).map_err(|e| format!("parse opencode config failed: {e}"))
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

fn pick_free_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("bind free port failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("read free port failed: {e}"))?
        .port();
    drop(listener);
    Ok(port)
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
    let body = serde_json::to_string(patch).map_err(|e| format!("serialize config patch failed: {e}"))?;

    let wants_global_first = patch.get("provider").is_some() || patch.get("disabled_providers").is_some();

    let try_patch = |url: String| -> Result<Value, String> {
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

fn start_opencode_service(repo_path: &str) -> Result<(std::process::Child, String), String> {
    let port = pick_free_port()?;
    let base = format!("http://127.0.0.1:{port}");
    let mut serve = Command::new("opencode");
    serve
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
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
    let ready_url = format!("{base}/project/current");
    let mut ready = false;
    while Instant::now() < wait_deadline {
        if run_curl_json(repo_path, "GET", ready_url.as_str(), None, 3).is_ok() {
            ready = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(180));
    }
    if !ready {
        return Err("opencode service did not become ready".to_string());
    }
    Ok((child, base))
}

fn release_managed_service(repo_path: &str) {
    if let Ok(mut pool) = service_pool().lock() {
        if let Some(mut svc) = pool.remove(repo_path) {
            let _ = svc.child.kill();
            let _ = svc.child.wait_timeout(Duration::from_secs(1));
        }
    }
}

fn ensure_managed_service(repo_path: &str) -> Result<String, String> {
    if let Ok(mut pool) = service_pool().lock() {
        if let Some(svc) = pool.get_mut(repo_path) {
            match svc.child.try_wait() {
                Ok(Some(_)) | Err(_) => {
                    let _ = svc.child.kill();
                    let _ = svc.child.wait_timeout(Duration::from_secs(1));
                    pool.remove(repo_path);
                }
                Ok(None) => {
                    let ready_url = format!("{}/project/current", svc.base);
                    if run_curl_json(repo_path, "GET", ready_url.as_str(), None, 3).is_ok() {
                        return Ok(svc.base.clone());
                    }
                    let _ = svc.child.kill();
                    let _ = svc.child.wait_timeout(Duration::from_secs(1));
                    pool.remove(repo_path);
                }
            }
        }
    }

    let (child, base) = start_opencode_service(repo_path)?;
    let mut pool = service_pool()
        .lock()
        .map_err(|_| "opencode service lock poisoned".to_string())?;
    pool.insert(
        repo_path.to_string(),
        ManagedOpencodeService {
            child,
            base: base.clone(),
        },
    );
    Ok(base)
}

fn with_service_base<T, F: FnMut(&str) -> Result<T, String>>(repo_path: &str, mut task: F) -> Result<T, String> {
    let base = ensure_managed_service(repo_path)?;
    match task(base.as_str()) {
        Ok(v) => Ok(v),
        Err(first_err) => {
            release_managed_service(repo_path);
            let retry_base = ensure_managed_service(repo_path)?;
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
        let mut message_roles: HashMap<String, String> = HashMap::new();
        let mut pending_delta: HashMap<String, String> = HashMap::new();
        let mut pending_part_full: HashMap<String, HashMap<String, String>> = HashMap::new();
        let mut trace_seen: HashSet<String> = HashSet::new();
        let mut got_delta = false;

        loop {
            buf.clear();
            let n = reader
                .read_line(&mut buf)
                .map_err(|e| format!("read event stream failed: {e}"))?;
            if n == 0 {
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

            // OpenCode marks prompt completion via session idle signals.
            // When a session becomes idle, we can stop consuming the event stream.
            if typ == "session.idle" {
                let sid = event
                    .get("properties")
                    .and_then(|v| v.get("sessionID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid == session_id {
                    return Ok(());
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
                        return Ok(());
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
                    if let Some(delta) = pending_delta.remove(mid) {
                        if !delta.is_empty() {
                            got_delta = true;
                            emit_stream_event(app, request_id, "delta", delta);
                        }
                    }
                    if let Some(parts) = pending_part_full.remove(mid) {
                        for (part_id, full) in parts {
                            if full.is_empty() {
                                continue;
                            }
                            let key = format!("{mid}:{part_id}");
                            part_text.insert(key, full.clone());
                            if !got_delta {
                                emit_stream_event(app, request_id, "delta", full);
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
                if field != "text" {
                    continue;
                }
                let delta = props
                    .and_then(|p| p.get("delta"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !delta.is_empty() {
                    match message_roles.get(message_id).map(String::as_str) {
                        Some("assistant") => {
                            seen_activity = true;
                            got_delta = true;
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
                            if status == "error" {
                                emit_stream_event(app, request_id, "trace", format!("Error {action}"));
                            } else if status == "completed" {
                                emit_stream_event(app, request_id, "trace", format!("Done {action}"));
                            } else {
                                emit_stream_event(app, request_id, "trace", action);
                            }
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
                        emit_stream_event(app, request_id, "trace", format!("{action} {title}"));
                    }
                }

                if part_type == "text" && !got_delta {
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
                continue;
            }

            if typ == "session.status" {
                let props = event.get("properties").and_then(|v| v.as_object());
                let sid = props
                    .and_then(|p| p.get("sessionID"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if sid != session_id {
                    continue;
                }
                let status_type = props
                    .and_then(|p| p.get("status"))
                    .and_then(|v| v.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if status_type == "idle" && seen_activity {
                    break;
                }
            }

            if seen_activity && last_any_event.elapsed() > timeout {
                return Err("no stream events received within 120s".to_string());
            }
        }
        Ok(())
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
pub fn get_opencode_model_config(repo_path: &str) -> Result<OpencodeModelConfig, String> {
    let path = project_config_path(repo_path);
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(OpencodeModelConfig {
            config_path: path,
            configured_model: String::new(),
            exists: false,
        });
    }

    let raw = fs::read_to_string(p).map_err(|e| format!("read opencode config failed: {e}"))?;
    let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse opencode config failed: {e}"))?;
    let configured_model = json
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(OpencodeModelConfig {
        config_path: path,
        configured_model,
        exists: true,
    })
}

#[tauri::command]
pub fn get_opencode_config_provider_catalog(repo_path: &str) -> Result<Vec<OpencodeConfigProviderCatalog>, String> {
    command_runner::validate_repo_path(repo_path)?;
    let root = read_project_config_json(repo_path)?;
    Ok(extract_config_provider_catalog(&root))
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
        out.push(OpencodeServerProviderCatalog { id, name, models, model_names });
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
        // Match OpenCode web behavior: dispose global state so auth/provider
        // changes are immediately reflected by /provider and /config views.
        let _ = run_curl_json(repo_path, "POST", format!("{base}/global/dispose").as_str(), Some("{}"), 8);
        Ok(true)
    })
}

#[tauri::command]
pub fn set_opencode_model_config(repo_path: &str, model: &str) -> Result<OpencodeModelConfig, String> {
    if model.trim().is_empty() {
        return Err("model must not be empty".to_string());
    }

    let path = project_config_path(repo_path);
    let p = Path::new(&path);
    let mut root = if p.exists() {
        let raw = fs::read_to_string(p).map_err(|e| format!("read opencode config failed: {e}"))?;
        serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| Value::Object(Map::new()))
    } else {
        Value::Object(Map::new())
    };

    if !root.is_object() {
        root = Value::Object(Map::new());
    }

    if let Some(obj) = root.as_object_mut() {
        if !obj.contains_key("$schema") {
            obj.insert(
                "$schema".to_string(),
                Value::String("https://opencode.ai/config.json".to_string()),
            );
        }
        let model_full = model.trim().to_string();
        obj.insert("model".to_string(), Value::String(model_full.clone()));

        if let Some((provider_id, model_id)) = parse_model_ref(model_full.as_str()) {
            let provider_root = obj
                .entry("provider".to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if !provider_root.is_object() {
                *provider_root = Value::Object(Map::new());
            }
            if let Some(provider_map) = provider_root.as_object_mut() {
                let provider_node = provider_map
                    .entry(provider_id)
                    .or_insert_with(|| Value::Object(Map::new()));
                if !provider_node.is_object() {
                    *provider_node = Value::Object(Map::new());
                }
                if let Some(provider_obj) = provider_node.as_object_mut() {
                    // For custom providers, default to OpenAI-compatible SDK when npm is absent.
                    if !provider_obj.contains_key("npm") {
                        provider_obj.insert(
                            "npm".to_string(),
                            Value::String("@ai-sdk/openai-compatible".to_string()),
                        );
                    }
                    let models_node = provider_obj
                        .entry("models".to_string())
                        .or_insert_with(|| Value::Object(Map::new()));
                    if !models_node.is_object() {
                        *models_node = Value::Object(Map::new());
                    }
                    if let Some(models_obj) = models_node.as_object_mut() {
                        models_obj.entry(model_id).or_insert_with(|| Value::Object(Map::new()));
                    }
                }
            }
        }
    }

    let text = serde_json::to_string_pretty(&root).map_err(|e| format!("serialize config failed: {e}"))?;
    fs::write(p, text).map_err(|e| format!("write opencode config failed: {e}"))?;
    release_managed_service(repo_path);

    Ok(OpencodeModelConfig {
        config_path: path,
        configured_model: model.trim().to_string(),
        exists: true,
    })
}

#[tauri::command]
pub fn get_opencode_provider_config(repo_path: &str, provider: &str) -> Result<OpencodeProviderConfig, String> {
    if provider.trim().is_empty() {
        return Err("provider must not be empty".to_string());
    }

    let path = project_config_path(repo_path);
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(OpencodeProviderConfig {
            provider: provider.trim().to_string(),
            npm: String::new(),
            name: String::new(),
            base_url: String::new(),
            api_key: String::new(),
            endpoint: String::new(),
            region: String::new(),
            profile: String::new(),
            project: String::new(),
            location: String::new(),
            resource_name: String::new(),
            enterprise_url: String::new(),
            timeout: String::new(),
            chunk_timeout: String::new(),
        });
    }

    let raw = fs::read_to_string(p).map_err(|e| format!("read opencode config failed: {e}"))?;
    let json: Value = serde_json::from_str(&raw).map_err(|e| format!("parse opencode config failed: {e}"))?;
    let node = json
        .get("provider")
        .and_then(|v| v.get(provider.trim()))
        .and_then(|v| v.get("options"));

    Ok(OpencodeProviderConfig {
        provider: provider.trim().to_string(),
        npm: json
            .get("provider")
            .and_then(|v| v.get(provider.trim()))
            .and_then(|v| v.get("npm"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        name: json
            .get("provider")
            .and_then(|v| v.get(provider.trim()))
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        base_url: node
            .and_then(|v| v.get("baseURL"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        api_key: {
            let key_in_config = node
                .and_then(|v| v.get("apiKey"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if key_in_config.trim().is_empty() {
                get_opencode_auth_api_key(provider)
            } else {
                key_in_config
            }
        },
        endpoint: node
            .and_then(|v| v.get("endpoint"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        region: node
            .and_then(|v| v.get("region"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        profile: node
            .and_then(|v| v.get("profile"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        project: node
            .and_then(|v| v.get("project"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        location: node
            .and_then(|v| v.get("location"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        resource_name: node
            .and_then(|v| v.get("resourceName"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        enterprise_url: node
            .and_then(|v| v.get("enterpriseUrl"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        timeout: node
            .and_then(|v| v.get("timeout"))
            .map(|v| {
                if v.is_number() {
                    v.to_string()
                } else {
                    v.as_str().unwrap_or("").to_string()
                }
            })
            .unwrap_or_default(),
        chunk_timeout: node
            .and_then(|v| v.get("chunkTimeout"))
            .map(|v| {
                if v.is_number() {
                    v.to_string()
                } else {
                    v.as_str().unwrap_or("").to_string()
                }
            })
            .unwrap_or_default(),
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
    if provider.trim().is_empty() {
        return Err("provider must not be empty".to_string());
    }

    let path = project_config_path(repo_path);
    let p = Path::new(&path);
    let mut root = if p.exists() {
        let raw = fs::read_to_string(p).map_err(|e| format!("read opencode config failed: {e}"))?;
        serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| Value::Object(Map::new()))
    } else {
        Value::Object(Map::new())
    };
    if !root.is_object() {
        root = Value::Object(Map::new());
    }

    let obj = root
        .as_object_mut()
        .ok_or_else(|| "invalid root config object".to_string())?;
    if !obj.contains_key("$schema") {
        obj.insert(
            "$schema".to_string(),
            Value::String("https://opencode.ai/config.json".to_string()),
        );
    }

    let provider_obj = obj
        .entry("provider".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !provider_obj.is_object() {
        *provider_obj = Value::Object(Map::new());
    }
    let providers = provider_obj
        .as_object_mut()
        .ok_or_else(|| "invalid provider config object".to_string())?;

    let pnode = providers
        .entry(provider.trim().to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !pnode.is_object() {
        *pnode = Value::Object(Map::new());
    }
    let pobj = pnode
        .as_object_mut()
        .ok_or_else(|| "invalid provider entry".to_string())?;

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

    if npm_v.is_empty() {
        pobj.remove("npm");
    } else {
        pobj.insert("npm".to_string(), Value::String(npm_v.clone()));
    }
    if name_v.is_empty() {
        pobj.remove("name");
    } else {
        pobj.insert("name".to_string(), Value::String(name_v.clone()));
    }

    let options_node = pobj
        .entry("options".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !options_node.is_object() {
        *options_node = Value::Object(Map::new());
    }
    let options = options_node
        .as_object_mut()
        .ok_or_else(|| "invalid provider options".to_string())?;

    if base.is_empty() {
        options.remove("baseURL");
    } else {
        options.insert("baseURL".to_string(), Value::String(base.clone()));
    }

    // Match OpenCode behavior:
    // - apiKey is NOT stored in opencode.json options; it is stored in auth store (auth.json) or env list.
    // - optional custom headers are stored under options.headers.
    options.remove("apiKey");

    // Merge user-provided headers into options.headers (string map only).
    if let Some(h) = headers {
        let mut header_obj: Map<String, Value> = Map::new();
        for (k, v) in h {
            let kk = k.trim().to_string();
            if kk.is_empty() {
                continue;
            }
            let vv = v.as_str().unwrap_or("").trim().to_string();
            if vv.is_empty() {
                continue;
            }
            header_obj.insert(kk, Value::String(vv));
        }
        if !header_obj.is_empty() {
            let headers_node = options
                .entry("headers".to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if !headers_node.is_object() {
                *headers_node = Value::Object(Map::new());
            }
            if let Some(headers_obj) = headers_node.as_object_mut() {
                for (k, v) in header_obj {
                    headers_obj.insert(k, v);
                }
            }
        }
    }
    if endpoint_v.is_empty() {
        options.remove("endpoint");
    } else {
        options.insert("endpoint".to_string(), Value::String(endpoint_v.clone()));
    }
    if region_v.is_empty() {
        options.remove("region");
    } else {
        options.insert("region".to_string(), Value::String(region_v.clone()));
    }
    if profile_v.is_empty() {
        options.remove("profile");
    } else {
        options.insert("profile".to_string(), Value::String(profile_v.clone()));
    }
    if project_v.is_empty() {
        options.remove("project");
    } else {
        options.insert("project".to_string(), Value::String(project_v.clone()));
    }
    if location_v.is_empty() {
        options.remove("location");
    } else {
        options.insert("location".to_string(), Value::String(location_v.clone()));
    }
    if resource_name_v.is_empty() {
        options.remove("resourceName");
    } else {
        options.insert("resourceName".to_string(), Value::String(resource_name_v.clone()));
    }
    if enterprise_url_v.is_empty() {
        options.remove("enterpriseUrl");
    } else {
        options.insert("enterpriseUrl".to_string(), Value::String(enterprise_url_v.clone()));
    }
    if timeout_v.is_empty() {
        options.remove("timeout");
    } else if let Ok(n) = timeout_v.parse::<i64>() {
        options.insert("timeout".to_string(), Value::Number(n.into()));
    } else {
        options.insert("timeout".to_string(), Value::String(timeout_v.clone()));
    }
    if chunk_timeout_v.is_empty() {
        options.remove("chunkTimeout");
    } else if let Ok(n) = chunk_timeout_v.parse::<i64>() {
        options.insert("chunkTimeout".to_string(), Value::Number(n.into()));
    } else {
        options.insert("chunkTimeout".to_string(), Value::String(chunk_timeout_v.clone()));
    }

    if !model_id_v.is_empty() {
        let models_node = pobj
            .entry("models".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !models_node.is_object() {
            *models_node = Value::Object(Map::new());
        }
        let models = models_node
            .as_object_mut()
            .ok_or_else(|| "invalid provider models".to_string())?;
        let model_entry = if model_name_v.is_empty() {
            Value::Object(Map::new())
        } else {
            serde_json::json!({ "name": model_name_v })
        };
        models.insert(model_id_v, model_entry);
    }

    let text = serde_json::to_string_pretty(&root).map_err(|e| format!("serialize config failed: {e}"))?;
    fs::write(p, text).map_err(|e| format!("write opencode config failed: {e}"))?;

    // Ensure provider is not disabled after configuration (OpenCode UI removes it).
    if let Ok(mut root_json) = read_project_config_json(repo_path) {
        if let Some(obj) = root_json.as_object_mut() {
            if let Some(disabled) = obj.get_mut("disabled_providers").and_then(|v| v.as_array_mut()) {
                disabled.retain(|x| x.as_str().unwrap_or("") != provider.trim());
            }
            let patch_text =
                serde_json::to_string_pretty(&root_json).map_err(|e| format!("serialize config failed: {e}"))?;
            fs::write(Path::new(&project_config_path(repo_path)), patch_text)
                .map_err(|e| format!("write opencode config failed: {e}"))?;
        }
    }

    // Persist key:
    // - "{env:FOO}" => config.provider[provider].env = ["FOO"] (handled by caller via writing provider env in config)
    // - "plain key" => auth store (auth.json)
    if let Some(env_name) = key_env.as_deref() {
        // store env array at provider root (not options)
        // re-read and patch minimal to avoid overwriting prior edits
        let mut root2 = read_project_config_json(repo_path)?;
        if !root2.is_object() {
            root2 = Value::Object(Map::new());
        }
        if let Some(obj2) = root2.as_object_mut() {
            let provider_obj2 = obj2
                .entry("provider".to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if !provider_obj2.is_object() {
                *provider_obj2 = Value::Object(Map::new());
            }
            if let Some(pmap2) = provider_obj2.as_object_mut() {
                let pnode2 = pmap2
                    .entry(provider.trim().to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                if !pnode2.is_object() {
                    *pnode2 = Value::Object(Map::new());
                }
                if let Some(pobj2) = pnode2.as_object_mut() {
                    pobj2.insert("env".to_string(), Value::Array(vec![Value::String(env_name.to_string())]));
                }
            }
        }
        let patch_text2 = serde_json::to_string_pretty(&root2).map_err(|e| format!("serialize config failed: {e}"))?;
        fs::write(Path::new(&project_config_path(repo_path)), patch_text2)
            .map_err(|e| format!("write opencode config failed: {e}"))?;
        // Clear any stored key for this provider if env placeholder is used.
        set_opencode_auth_api_key(provider, "")?;
    } else {
        set_opencode_auth_api_key(provider, key.as_str())?;
    }
    release_managed_service(repo_path);

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

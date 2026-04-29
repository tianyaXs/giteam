use super::opencode;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_CONTROL_SERVER_HOST: &str = "0.0.0.0";
const DEFAULT_CONTROL_SERVER_PORT: u16 = 4100;
const DEFAULT_PAIR_TTL_MODE: &str = "24h";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlServerSettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub public_base_url: String,
    #[serde(default = "default_pair_code_ttl_mode")]
    pub pair_code_ttl_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPairCodeInfo {
    pub code: String,
    pub expires_at: u64,
    pub ttl_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlAccessInfo {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub public_base_url: String,
    pub pair_code: String,
    pub expires_at: u64,
    pub local_urls: Vec<String>,
    pub pair_code_ttl_mode: String,
    pub no_auth: bool,
}

#[derive(Debug)]
struct ControlRuntime {
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
    settings: ControlServerSettings,
}

#[derive(Debug, Clone)]
struct PairState {
    code: String,
    expires_at: u64,
}

fn question_cache() -> &'static Mutex<HashMap<String, Vec<Value>>> {
    static CELL: OnceLock<Mutex<HashMap<String, Vec<Value>>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn question_cache_key(repo_path: &str, session_id: &str) -> String {
    format!("{}\n{}", repo_path.trim(), session_id.trim())
}

fn cache_question_requests(repo_path: &str, session_id: &str, requests: Vec<Value>) {
    if requests.is_empty() {
        return;
    }
    let key = question_cache_key(repo_path, session_id);
    if let Ok(mut guard) = question_cache().lock() {
        let bucket = guard.entry(key).or_default();
        for request in requests {
            let id = request.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_empty() || bucket.iter().any(|item| item.get("id").and_then(|v| v.as_str()) == Some(id)) {
                continue;
            }
            bucket.push(request);
        }
    }
}

fn remove_cached_question(request_id: &str) {
    let id = request_id.trim();
    if id.is_empty() {
        return;
    }
    if let Ok(mut guard) = question_cache().lock() {
        for bucket in guard.values_mut() {
            bucket.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(id));
        }
    }
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairAuthRequest {
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionRequest {
    repo_path: String,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptRequest {
    repo_path: String,
    session_id: Option<String>,
    prompt: String,
    model: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AbortRequest {
    repo_path: String,
    session_id: String,
}

static CONTROL_RUNTIME: OnceLock<Mutex<Option<ControlRuntime>>> = OnceLock::new();
static CONTROL_PAIR_STATE: OnceLock<Mutex<PairState>> = OnceLock::new();
static CONTROL_BEARER_TOKEN: OnceLock<Mutex<String>> = OnceLock::new();

fn runtime_cell() -> &'static Mutex<Option<ControlRuntime>> {
    CONTROL_RUNTIME.get_or_init(|| Mutex::new(None))
}

fn pair_state_cell() -> &'static Mutex<PairState> {
    CONTROL_PAIR_STATE.get_or_init(|| {
        Mutex::new(PairState {
            code: generate_pair_code(),
            expires_at: now_unix_secs() + 24 * 60 * 60,
        })
    })
}

fn token_cell() -> &'static Mutex<String> {
    CONTROL_BEARER_TOKEN.get_or_init(|| Mutex::new(read_persisted_bearer_token()))
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn default_control_server_settings() -> ControlServerSettings {
    ControlServerSettings {
        // Desktop manages this as a user-facing toggle; default should be OFF after install.
        enabled: false,
        host: DEFAULT_CONTROL_SERVER_HOST.to_string(),
        port: DEFAULT_CONTROL_SERVER_PORT,
        public_base_url: String::new(),
        pair_code_ttl_mode: default_pair_code_ttl_mode(),
    }
}

fn default_pair_code_ttl_mode() -> String {
    DEFAULT_PAIR_TTL_MODE.to_string()
}

fn control_server_settings_path() -> Option<PathBuf> {
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
                        .join("control-server.json"),
                );
            }
        }
    }
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg_config_home.trim();
        if !p.is_empty() {
            return Some(PathBuf::from(p).join("giteam").join("control-server.json"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            return Some(
                PathBuf::from(h)
                    .join(".config")
                    .join("giteam")
                    .join("control-server.json"),
            );
        }
    }
    None
}

fn mobile_model_state_path() -> Option<PathBuf> {
    control_server_settings_path().map(|path| path.with_file_name("mobile-model-state.json"))
}

fn read_mobile_model_state() -> Value {
    let Some(path) = mobile_model_state_path() else {
        return serde_json::json!({});
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return serde_json::json!({});
    };
    serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| serde_json::json!({}))
}

fn write_mobile_model_state(value: &Value) -> Result<(), String> {
    let Some(path) = mobile_model_state_path() else {
        return Err("mobile model state path unavailable".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create model state dir failed: {e}"))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("serialize model state failed: {e}"))?;
    fs::write(path, text).map_err(|e| format!("write model state failed: {e}"))
}

fn attach_mobile_model_state(mut config: Value) -> Value {
    let state = read_mobile_model_state();
    if let Some(obj) = config.as_object_mut() {
        obj.insert("giteamMobileModelState".to_string(), state);
    }
    config
}

fn control_auth_token_path() -> Option<PathBuf> {
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
                        .join("control-auth.json"),
                );
            }
        }
    }
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg_config_home.trim();
        if !p.is_empty() {
            return Some(PathBuf::from(p).join("giteam").join("control-auth.json"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            return Some(
                PathBuf::from(h)
                    .join(".config")
                    .join("giteam")
                    .join("control-auth.json"),
            );
        }
    }
    None
}

fn read_persisted_bearer_token() -> String {
    let Some(path) = control_auth_token_path() else {
        return generate_token();
    };
    let raw = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return generate_token(),
    };
    let parsed = serde_json::from_str::<Value>(&raw).ok();
    parsed
        .and_then(|v| {
            v.get("token")
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(generate_token)
}

fn write_persisted_bearer_token(token: &str) {
    let Some(path) = control_auth_token_path() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let body = serde_json::json!({ "token": token });
    if let Ok(text) = serde_json::to_string_pretty(&body) {
        let _ = fs::write(path, text);
    }
}

fn read_control_server_settings() -> ControlServerSettings {
    let Some(path) = control_server_settings_path() else {
        return default_control_server_settings();
    };
    let raw = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return default_control_server_settings(),
    };
    let mut cfg = match serde_json::from_str::<ControlServerSettings>(&raw) {
        Ok(v) => v,
        Err(_) => return default_control_server_settings(),
    };
    cfg.host = cfg.host.trim().to_string();
    if cfg.host.is_empty() {
        cfg.host = DEFAULT_CONTROL_SERVER_HOST.to_string();
    }
    if cfg.port == 0 {
        cfg.port = DEFAULT_CONTROL_SERVER_PORT;
    }
    cfg.public_base_url = cfg.public_base_url.trim().trim_end_matches('/').to_string();
    cfg.pair_code_ttl_mode = normalize_pair_code_ttl_mode(cfg.pair_code_ttl_mode.as_str());
    cfg
}

fn write_control_server_settings(settings: &ControlServerSettings) -> Result<(), String> {
    let Some(path) = control_server_settings_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create control config dir failed: {e}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("serialize control settings failed: {e}"))?;
    fs::write(path, text).map_err(|e| format!("write control settings failed: {e}"))?;
    Ok(())
}

fn normalize_pair_code_ttl_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "none" => "none".to_string(),
        "24h" => "24h".to_string(),
        "7d" => "7d".to_string(),
        "forever" => "forever".to_string(),
        _ => DEFAULT_PAIR_TTL_MODE.to_string(),
    }
}

fn pair_mode_ttl_secs(mode: &str) -> Option<u64> {
    match normalize_pair_code_ttl_mode(mode).as_str() {
        "24h" => Some(24 * 60 * 60),
        "7d" => Some(7 * 24 * 60 * 60),
        "forever" => None,
        "none" => None,
        _ => Some(24 * 60 * 60),
    }
}

fn generate_pair_code() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:06}", (n % 1_000_000) as u32)
}

fn generate_token() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    format!("gtm_{:032x}", n ^ (pid << 17))
}

fn is_no_auth_mode() -> bool {
    let settings = read_control_server_settings();
    normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str()) == "none"
}

fn sync_pair_state_for_mode(state: &mut PairState, mode: &str, now: u64, force_new_code: bool) {
    let normalized = normalize_pair_code_ttl_mode(mode);
    match normalized.as_str() {
        "none" => {
            state.code.clear();
            state.expires_at = now;
        }
        "forever" => {
            if force_new_code || state.code.trim().is_empty() {
                state.code = generate_pair_code();
            }
            state.expires_at = u64::MAX;
        }
        _ => {
            let ttl = pair_mode_ttl_secs(normalized.as_str()).unwrap_or(24 * 60 * 60);
            if force_new_code || state.code.trim().is_empty() || now >= state.expires_at {
                state.code = generate_pair_code();
                state.expires_at = now.saturating_add(ttl);
            }
        }
    }
}

fn refresh_pair_code() -> ControlPairCodeInfo {
    let settings = read_control_server_settings();
    let mode = normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str());
    let now = now_unix_secs();
    let mut state = pair_state_cell().lock().expect("pair state lock poisoned");
    sync_pair_state_for_mode(&mut state, mode.as_str(), now, true);
    ControlPairCodeInfo {
        code: state.code.clone(),
        expires_at: state.expires_at,
        ttl_seconds: if mode == "forever" {
            u64::MAX
        } else {
            state.expires_at.saturating_sub(now)
        },
    }
}

fn current_pair_code() -> ControlPairCodeInfo {
    let settings = read_control_server_settings();
    let mode = normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str());
    let mut state = pair_state_cell().lock().expect("pair state lock poisoned");
    let now = now_unix_secs();
    sync_pair_state_for_mode(&mut state, mode.as_str(), now, false);
    ControlPairCodeInfo {
        code: state.code.clone(),
        expires_at: state.expires_at,
        ttl_seconds: if mode == "forever" {
            u64::MAX
        } else {
            state.expires_at.saturating_sub(now)
        },
    }
}

fn verify_pair_code(code: &str) -> Result<(), String> {
    let settings = read_control_server_settings();
    let mode = normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str());
    if mode == "none" {
        return Err("pair code auth disabled (no-auth mode)".to_string());
    }
    let now = now_unix_secs();
    let mut state = pair_state_cell().lock().expect("pair state lock poisoned");
    sync_pair_state_for_mode(&mut state, mode.as_str(), now, false);
    if mode != "forever" && now >= state.expires_at {
        return Err("pair code expired".to_string());
    }
    if state.code.trim() != code.trim() {
        return Err("invalid pair code".to_string());
    }
    Ok(())
}

fn candidate_client_db_paths() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    // 1) Prefer the desktop app bundle app-data path first.
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let h = home.trim();
            if !h.is_empty() {
                out.push(
                    PathBuf::from(h)
                        .join("Library")
                        .join("Application Support")
                        .join("io.giteam.desktop")
                        .join(".giteam")
                        .join("client.db"),
                );
            }
        }
    }
    // 2) Then prefer the same app-data root used by control settings/auth files.
    if let Some(cfg) = control_server_settings_path() {
        if let Some(parent) = cfg.parent() {
            out.push(parent.join(".giteam").join("client.db"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let h = home.trim();
            if !h.is_empty() {
                out.push(
                    PathBuf::from(h)
                        .join("Library")
                        .join("Application Support")
                        .join("giteam")
                        .join(".giteam")
                        .join("client.db"),
                );
            }
        }
    }
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg_config_home.trim();
        if !p.is_empty() {
            out.push(
                PathBuf::from(p)
                    .join("giteam")
                    .join(".giteam")
                    .join("client.db"),
            );
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            out.push(
                PathBuf::from(h)
                    .join(".config")
                    .join("giteam")
                    .join(".giteam")
                    .join("client.db"),
            );
        }
    }
    // 3) Last-resort fallback: workspace-local legacy db.
    if let Ok(cwd) = std::env::current_dir() {
        out.push(cwd.join(".giteam").join("client.db"));
    }
    out
}

fn read_client_repositories() -> Result<Vec<Value>, String> {
    let db = candidate_client_db_paths()
        .into_iter()
        .find(|p| p.exists() && p.is_file());
    let Some(path) = db else {
        return Ok(Vec::new());
    };
    let conn = Connection::open(path).map_err(|e| format!("open client db failed: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, name, added_at
             FROM repositories
             ORDER BY added_at_ms DESC",
        )
        .map_err(|e| format!("prepare repository list failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let path: String = row.get(1)?;
            let name: String = row.get(2)?;
            let added_at: String = row.get(3)?;
            Ok(serde_json::json!({
                "id": id,
                "path": path,
                "name": name,
                "addedAt": added_at
            }))
        })
        .map_err(|e| format!("query repository list failed: {e}"))?;
    let mut out: Vec<Value> = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("decode repository row failed: {e}"))?);
    }
    Ok(out)
}

fn current_bearer_token() -> String {
    let mut token = token_cell().lock().expect("token lock poisoned");
    if token.trim().is_empty() {
        *token = generate_token();
        write_persisted_bearer_token(token.as_str());
    } else {
        // Ensure current token is on disk for cross-restart stability.
        write_persisted_bearer_token(token.as_str());
    }
    token.clone()
}

fn detect_primary_lan_ip() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    let _ = sock.connect("8.8.8.8:80");
    let ip = sock.local_addr().ok()?.ip();
    if ip.is_loopback() {
        return None;
    }
    if let IpAddr::V4(v4) = ip {
        let oct = v4.octets();
        let is_private = oct[0] == 10
            || (oct[0] == 172 && (16..=31).contains(&oct[1]))
            || (oct[0] == 192 && oct[1] == 168)
            || (oct[0] == 100 && (64..=127).contains(&oct[1]));
        let is_reserved_benchmark = oct[0] == 198 && (oct[1] == 18 || oct[1] == 19);
        if is_private && !is_reserved_benchmark {
            return Some(v4.to_string());
        }
        return None;
    }
    None
}

fn parse_query(q: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for chunk in q.split('&').filter(|s| !s.is_empty()) {
        let mut p = chunk.splitn(2, '=');
        let k = p.next().unwrap_or("").trim();
        if k.is_empty() {
            continue;
        }
        let v = p.next().unwrap_or("").trim();
        let key = urlencoding::decode(k)
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| k.to_string());
        let value = urlencoding::decode(v)
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| v.to_string());
        out.insert(key, value);
    }
    out
}

fn read_stream_chunk(stream: &mut TcpStream, tmp: &mut [u8], label: &str) -> Result<usize, String> {
    let mut attempts = 0u8;
    loop {
        match stream.read(tmp) {
            Ok(n) => return Ok(n),
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {
                attempts = attempts.saturating_add(1);
                if attempts >= 6 {
                    return Err(format!("{label} failed after retry: {e}"));
                }
                thread::sleep(Duration::from_millis(12 * attempts as u64));
            }
            Err(e) => return Err(format!("{label} failed: {e}")),
        }
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| format!("set read timeout failed: {e}"))?;

    let mut buf: Vec<u8> = Vec::new();
    let mut tmp = [0u8; 1024];
    let header_end = loop {
        let n = read_stream_chunk(stream, &mut tmp, "read request")?;
        if n == 0 {
            return Err("connection closed".to_string());
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.len() > 2 * 1024 * 1024 {
            return Err("request too large".to_string());
        }
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let req_line = lines.next().unwrap_or("");
    let mut req_parts = req_line.split_whitespace();
    let method = req_parts.next().unwrap_or("").to_string();
    let target = req_parts.next().unwrap_or("").to_string();
    if method.is_empty() || target.is_empty() {
        return Err("invalid request line".to_string());
    }

    let (path, query) = if let Some(idx) = target.find('?') {
        (target[..idx].to_string(), parse_query(&target[idx + 1..]))
    } else {
        (target, HashMap::new())
    };

    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some(idx) = line.find(':') {
            let k = line[..idx].trim().to_ascii_lowercase();
            let v = line[idx + 1..].trim().to_string();
            headers.insert(k, v);
        }
    }
    let content_len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_len {
        let n = read_stream_chunk(stream, &mut tmp, "read body")?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
        if body.len() > 4 * 1024 * 1024 {
            return Err("request body too large".to_string());
        }
    }
    if body.len() > content_len {
        body.truncate(content_len);
    }
    Ok(HttpRequest {
        method,
        path,
        query,
        headers,
        body,
    })
}

fn write_stream_all(stream: &mut TcpStream, bytes: &[u8], label: &str) -> Result<(), String> {
    let mut written = 0usize;
    let mut attempts = 0u8;
    while written < bytes.len() {
        match stream.write(&bytes[written..]) {
            Ok(0) => return Err(format!("{label} failed: connection closed while writing")),
            Ok(n) => {
                written += n;
                attempts = 0;
            }
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {
                attempts = attempts.saturating_add(1);
                if attempts >= 12 {
                    return Err(format!("{label} failed after retry: {e}"));
                }
                thread::sleep(Duration::from_millis(12 * attempts as u64));
            }
            Err(e) => return Err(format!("{label} failed: {e}")),
        }
    }
    Ok(())
}

fn write_http_json(stream: &mut TcpStream, status: u16, body: &Value) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let payload = serde_json::to_vec(body).map_err(|e| format!("encode response failed: {e}"))?;
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\nAccess-Control-Allow-Headers: Authorization,Content-Type,Accept,Cache-Control,Pragma,Last-Event-ID,X-Requested-With\r\nAccess-Control-Max-Age: 86400\r\n\r\n",
        status,
        reason,
        payload.len()
    );
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    write_stream_all(stream, head.as_bytes(), "write response headers")?;
    write_stream_all(stream, &payload, "write response body")?;
    stream
        .flush()
        .map_err(|e| format!("write response failed: {e}"))
}

fn write_http_no_content(stream: &mut TcpStream, status: u16) -> Result<(), String> {
    let reason = if status == 204 { "No Content" } else { "OK" };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: 0\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\nAccess-Control-Allow-Headers: Authorization,Content-Type,Accept,Cache-Control,Pragma,Last-Event-ID,X-Requested-With\r\nAccess-Control-Max-Age: 86400\r\n\r\n",
        status, reason
    );
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    write_stream_all(stream, head.as_bytes(), "write response headers")?;
    stream
        .flush()
        .map_err(|e| format!("write response failed: {e}"))
}

fn write_sse_headers(stream: &mut TcpStream) -> Result<(), String> {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\nAccess-Control-Allow-Headers: Authorization,Content-Type,Accept,Cache-Control,Pragma,Last-Event-ID,X-Requested-With\r\nAccess-Control-Max-Age: 86400\r\n\r\n";
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    write_stream_all(stream, head.as_bytes(), "write sse headers")
}

fn write_sse_event(stream: &mut TcpStream, event: &str, payload: &Value) -> Result<(), String> {
    let body =
        serde_json::to_string(payload).map_err(|e| format!("encode sse payload failed: {e}"))?;
    let chunk = format!("event: {event}\ndata: {body}\n\n");
    write_stream_all(stream, chunk.as_bytes(), "write sse event")?;
    stream
        .flush()
        .map_err(|e| format!("write sse event failed: {e}"))
}

fn sse_frame_data(frame: &str) -> Option<String> {
    let mut data = String::new();
    for line in frame.lines() {
        if let Some(rest) = line.trim_end().strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
    }
    if data.trim().is_empty() {
        None
    } else {
        Some(data)
    }
}

fn wrapped_opencode_event(data: &str) -> Option<Value> {
    let json = serde_json::from_str::<Value>(data.trim()).ok()?;
    Some(json.get("payload").cloned().unwrap_or(json))
}

fn event_session_id(event: &Value) -> &str {
    event
        .get("properties")
        .and_then(|v| v.get("sessionID"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

fn stream_opencode_global_events(
    stream: &mut TcpStream,
    repo: &str,
    session_id: &str,
) -> Result<(), String> {
    let base = opencode::get_opencode_service_base(repo)?;
    let url = format!("{base}/global/event");
    let mut child = Command::new("curl")
        .arg("-sS")
        .arg("-N")
        .arg("--fail")
        .arg("-H")
        .arg(format!("x-opencode-directory: {repo}"))
        .arg("-H")
        .arg("Accept: text/event-stream")
        .arg(url.as_str())
        .current_dir(repo)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("open opencode global event stream failed: {e}"))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("opencode global event stdout unavailable".to_string());
    };

    let mut message_roles = HashMap::<String, String>::new();
    let mut part_types = HashMap::<String, String>::new();
    let mut pending_delta = HashMap::<String, Vec<(String, String, String)>>::new();
    let mut frame = String::new();
    let reader = BufReader::new(stdout);
    let finish = |child: &mut std::process::Child| {
        let _ = child.kill();
        let _ = child.wait();
    };

    for line_result in reader.lines() {
        let line = line_result.map_err(|e| format!("read opencode global event failed: {e}"))?;
        if !line.trim().is_empty() {
            frame.push_str(line.as_str());
            frame.push('\n');
            continue;
        }
        let data = sse_frame_data(frame.as_str());
        frame.clear();
        let Some(data) = data else { continue };
        let Some(event) = wrapped_opencode_event(data.as_str()) else { continue };
        let typ = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if event_session_id(&event) != session_id {
            continue;
        }

        if typ == "session.idle" {
            let _ = write_sse_event(stream, "end", &serde_json::json!({ "reason": "idle" }));
            finish(&mut child);
            return Ok(());
        }
        if typ == "session.status" {
            let status_type = event
                .get("properties")
                .and_then(|v| v.get("status"))
                .and_then(|v| v.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if status_type == "idle" {
                let _ = write_sse_event(stream, "end", &serde_json::json!({ "reason": "idle" }));
                finish(&mut child);
                return Ok(());
            }
        }
        if typ == "session.error" {
            let error = event
                .get("properties")
                .and_then(|v| v.get("error"))
                .cloned()
                .unwrap_or(Value::String("session.error".to_string()));
            let _ = write_sse_event(stream, "error", &serde_json::json!({ "error": error }));
            finish(&mut child);
            return Ok(());
        }
        if typ == "message.updated" {
            let props = event.get("properties").and_then(|v| v.as_object());
            let info = props
                .and_then(|p| p.get("info"))
                .and_then(|v| v.as_object());
            let role = info
                .and_then(|i| i.get("role"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let message_id = info
                .and_then(|i| i.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !message_id.is_empty() {
                message_roles.insert(message_id.to_string(), role.to_string());
                if role == "assistant" {
                    let _ = write_sse_event(
                        stream,
                        "assistant_message",
                        &serde_json::json!({ "sessionId": session_id, "messageId": message_id }),
                    );
                    if let Some(deltas) = pending_delta.remove(message_id) {
                        for (part_id, field, delta) in deltas {
                            let event_type = match part_types.get(part_id.as_str()).map(String::as_str) {
                                Some("reasoning") => "reasoning",
                                Some("text") => "text",
                                _ if field == "reasoning" => "reasoning",
                                _ => "text",
                            };
                            if write_sse_event(
                                stream,
                                "delta",
                                &serde_json::json!({
                                    "sessionId": session_id,
                                    "messageId": message_id,
                                    "partId": part_id,
                                    "type": event_type,
                                    "delta": delta
                                }),
                            )
                            .is_err()
                            {
                                finish(&mut child);
                                return Ok(());
                            }
                        }
                    }
                }
            }
            continue;
        }
        if typ == "message.part.delta" {
            let props = event.get("properties").and_then(|v| v.as_object());
            let message_id = props
                .and_then(|p| p.get("messageID"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let field = props
                .and_then(|p| p.get("field"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let part_id = props
                .and_then(|p| p.get("partID"))
                .and_then(|v| v.as_str())
                .unwrap_or(field);
            let delta = props
                .and_then(|p| p.get("delta"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if message_id.is_empty() || delta.is_empty() || (field != "text" && field != "reasoning") {
                continue;
            }
            if message_roles.get(message_id).map(String::as_str) != Some("assistant") {
                pending_delta
                    .entry(message_id.to_string())
                    .or_default()
                    .push((part_id.to_string(), field.to_string(), delta.to_string()));
                continue;
            }
            let event_type = match part_types.get(part_id).map(String::as_str) {
                Some("reasoning") => "reasoning",
                Some("text") => "text",
                _ if field == "reasoning" => "reasoning",
                _ => "text",
            };
            if write_sse_event(
                stream,
                "delta",
                &serde_json::json!({
                    "sessionId": session_id,
                    "messageId": message_id,
                    "partId": part_id,
                    "type": event_type,
                    "delta": delta
                }),
            )
            .is_err()
            {
                finish(&mut child);
                return Ok(());
            }
            continue;
        }
        if typ == "message.part.updated" {
            let part = event
                .get("properties")
                .and_then(|v| v.get("part"))
                .cloned()
                .unwrap_or(Value::Null);
            if let (Some(part_id), Some(part_type)) = (
                part.get("id").and_then(|v| v.as_str()),
                part.get("type").and_then(|v| v.as_str()),
            ) {
                if !part_id.is_empty() && !part_type.is_empty() {
                    part_types.insert(part_id.to_string(), part_type.to_string());
                }
            }
            let message_id = part
                .get("messageID")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if message_id.is_empty() {
                continue;
            }
            if message_roles.get(message_id).map(String::as_str) != Some("assistant") {
                continue;
            }
            if write_sse_event(
                stream,
                "part",
                &serde_json::json!({
                    "sessionId": session_id,
                    "messageId": message_id,
                    "part": part
                }),
            )
            .is_err()
            {
                finish(&mut child);
                return Ok(());
            }
        }
    }

    finish(&mut child);
    Ok(())
}

fn extract_bearer(req: &HttpRequest) -> String {
    let auth = req
        .headers
        .get("authorization")
        .map(String::as_str)
        .unwrap_or("")
        .trim();
    if let Some(rest) = auth.strip_prefix("Bearer ") {
        return rest.trim().to_string();
    }
    String::new()
}

fn ensure_authorized(req: &HttpRequest) -> Result<(), String> {
    if is_no_auth_mode() {
        return Ok(());
    }
    let token = extract_bearer(req);
    if token.is_empty() {
        return Err("missing bearer token".to_string());
    }
    let expected = current_bearer_token();
    if token != expected {
        return Err("invalid bearer token".to_string());
    }
    Ok(())
}

fn ensure_loopback(remote_ip: Option<IpAddr>, route: &str) -> Result<(), (u16, Value)> {
    if let Some(ip) = remote_ip {
        if !ip.is_loopback() {
            return Err((
                403,
                serde_json::json!({ "error": format!("{route} only allowed from loopback") }),
            ));
        }
    }
    Ok(())
}

fn parse_body_json(req: &HttpRequest) -> Result<Value, String> {
    if req.body.is_empty() {
        return Ok(Value::Object(Default::default()));
    }
    serde_json::from_slice::<Value>(&req.body).map_err(|e| format!("invalid json body: {e}"))
}

#[derive(Debug, Clone, Copy)]
struct SessionLoopStats {
    synthetic_size_limit_user: usize,
    compaction_assistant: usize,
    non_compaction_assistant_renderable: usize,
}

fn analyze_session_loop_stats(messages: &Value) -> SessionLoopStats {
    let mut stats = SessionLoopStats {
        synthetic_size_limit_user: 0,
        compaction_assistant: 0,
        non_compaction_assistant_renderable: 0,
    };
    let Some(arr) = messages.as_array() else {
        return stats;
    };

    for item in arr {
        let info = item.get("info").and_then(|v| v.as_object());
        let role = info
            .and_then(|x| x.get("role"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let mode = info
            .and_then(|x| x.get("mode"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let agent = info
            .and_then(|x| x.get("agent"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let summary = info
            .and_then(|x| x.get("summary"))
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let is_compaction = mode == "compaction" || agent == "compaction" || summary;
        let parts = item
            .get("parts")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if role == "user" {
            for p in &parts {
                let ptype = p.get("type").and_then(|x| x.as_str()).unwrap_or("").trim();
                if ptype != "text" {
                    continue;
                }
                let synthetic = p
                    .get("synthetic")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false);
                if !synthetic {
                    continue;
                }
                let text = p
                    .get("text")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_lowercase();
                if text.contains("exceeded the provider") && text.contains("size limit") {
                    stats.synthetic_size_limit_user += 1;
                }
            }
            continue;
        }

        if role != "assistant" {
            continue;
        }
        if is_compaction {
            stats.compaction_assistant += 1;
            continue;
        }

        let mut renderable = false;
        for p in &parts {
            let ptype = p.get("type").and_then(|x| x.as_str()).unwrap_or("").trim();
            if ptype == "tool" {
                let tool = p.get("tool").and_then(|x| x.as_str()).unwrap_or("").trim();
                if !tool.is_empty() && tool != "todowrite" {
                    renderable = true;
                    break;
                }
                continue;
            }
            if ptype == "reasoning" || ptype == "text" {
                let text = p.get("text").and_then(|x| x.as_str()).unwrap_or("").trim();
                if !text.is_empty() {
                    renderable = true;
                    break;
                }
            }
        }
        if renderable {
            stats.non_compaction_assistant_renderable += 1;
        }
    }
    stats
}

fn is_size_limit_compaction_loop(stats: SessionLoopStats) -> bool {
    stats.synthetic_size_limit_user >= 2
        && stats.compaction_assistant >= 2
        && stats.non_compaction_assistant_renderable == 0
}

fn push_loop_notice_message(mut v: Value, session_id: &str, stats: SessionLoopStats) -> Value {
    let Some(arr) = v.as_array_mut() else {
        return v;
    };
    let now_ms = (now_unix_secs() as i64) * 1000;
    let synthetic = serde_json::json!({
        "info": {
            "id": format!("msg_loop_notice_{}", now_unix_secs()),
            "role": "assistant",
            "agent": "control",
            "mode": "system",
            "sessionID": session_id,
            "time": { "created": now_ms, "completed": now_ms },
            "finish": "stop",
            "error": {
                "name": "SizeLimitCompactionLoop",
                "data": {
                    "code": "SIZE_LIMIT_COMPACTION_LOOP",
                    "syntheticSizeLimitUserCount": stats.synthetic_size_limit_user,
                    "compactionAssistantCount": stats.compaction_assistant
                }
            }
        },
        "parts": [
            {
                "type": "text",
                "text": format!(
                    "检测到 SIZE_LIMIT_COMPACTION_LOOP，已自动中断当前会话。synthetic={}，compaction={}。请切换模型或清理上游上下文后重试。",
                    stats.synthetic_size_limit_user, stats.compaction_assistant
                )
            }
        ]
    });
    arr.push(synthetic);
    v
}

fn mobile_message_role(item: &Value) -> &str {
    item.get("info")
        .and_then(|v| v.get("role"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
}

fn mobile_message_id(item: &Value) -> &str {
    item.get("info")
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
}

fn mobile_message_parent_id(item: &Value) -> &str {
    item.get("info")
        .and_then(|v| v.get("parentID").or_else(|| v.get("parentId")))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
}

fn mobile_message_has_error(item: &Value) -> bool {
    item.get("info")
        .and_then(|v| v.get("error"))
        .map(|v| !v.is_null())
        .unwrap_or(false)
}

fn mobile_message_has_compaction_part(item: &Value) -> bool {
    item.get("parts")
        .and_then(|v| v.as_array())
        .map(|parts| {
            parts.iter().any(|part| {
                part.get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    == "compaction"
            })
        })
        .unwrap_or(false)
}

fn mobile_message_is_completed_summary(item: &Value) -> bool {
    if mobile_message_role(item) != "assistant" || mobile_message_has_error(item) {
        return false;
    }
    let Some(info) = item.get("info") else {
        return false;
    };
    let summary = info
        .get("summary")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let finish = info.get("finish");
    summary && finish.is_some() && !finish.is_some_and(|v| v.is_null())
}

fn filter_mobile_compacted_messages(v: Value) -> Value {
    let Some(arr) = v.as_array() else {
        return v;
    };
    let mut completed = HashSet::<String>::new();
    let mut out = Vec::<Value>::new();
    for item in arr.iter().rev() {
        out.push(item.clone());
        if mobile_message_role(item) == "user"
            && !mobile_message_id(item).is_empty()
            && completed.contains(mobile_message_id(item))
            && mobile_message_has_compaction_part(item)
        {
            break;
        }
        if mobile_message_is_completed_summary(item) {
            let parent_id = mobile_message_parent_id(item);
            if !parent_id.is_empty() {
                completed.insert(parent_id.to_string());
            }
        }
    }
    out.reverse();
    Value::Array(out)
}

fn compact_mobile_tool_metadata(metadata: Option<&Map<String, Value>>) -> Option<Value> {
    let Some(metadata) = metadata else {
        return None;
    };
    let mut out = Map::new();
    if let Some(v) = metadata.get("sessionId").cloned() {
        out.insert("sessionId".to_string(), v);
    }
    if let Some(v) = metadata.get("sessionID").cloned() {
        out.insert("sessionID".to_string(), v);
    }
    if let Some(v) = metadata.get("todos").cloned() {
        out.insert("todos".to_string(), v);
    }
    if out.is_empty() {
        None
    } else {
        Some(Value::Object(out))
    }
}

fn compact_mobile_tool_input(input: Option<&Map<String, Value>>) -> Option<Value> {
    let Some(input) = input else {
        return None;
    };
    let mut out = Map::new();
    for key in [
        "description",
        "filePath",
        "pattern",
        "query",
        "url",
        "path",
        "subagent_type",
        "todos",
        "questions",
    ] {
        if let Some(v) = input.get(key).cloned() {
            out.insert(key.to_string(), v);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(Value::Object(out))
    }
}

fn compact_mobile_tool_output(value: Option<&Value>) -> Option<Value> {
    let Some(value) = value else {
        return None;
    };
    const MAX_OUTPUT_CHARS: usize = 4096;
    match value {
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else if trimmed.chars().count() <= MAX_OUTPUT_CHARS {
                Some(Value::String(trimmed.to_string()))
            } else {
                Some(Value::String(format!(
                    "{}...",
                    trimmed.chars().take(MAX_OUTPUT_CHARS).collect::<String>()
                )))
            }
        }
        other => {
            let text = serde_json::to_string(other).unwrap_or_default();
            if text.is_empty() {
                None
            } else if text.chars().count() <= MAX_OUTPUT_CHARS {
                Some(Value::String(text))
            } else {
                Some(Value::String(format!(
                    "{}...",
                    text.chars().take(MAX_OUTPUT_CHARS).collect::<String>()
                )))
            }
        }
    }
}

fn compact_mobile_message_parts(role: &str, parts: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for part in parts {
        let Some(part_obj) = part.as_object() else {
            continue;
        };
        let part_type = part_obj
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        match part_type {
            "text" => {
                let text = part_obj
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                if text.is_empty() {
                    continue;
                }
                let mut node = Map::new();
                node.insert("type".to_string(), Value::String("text".to_string()));
                if let Some(id) = part_obj.get("id").cloned() {
                    node.insert("id".to_string(), id);
                }
                node.insert("text".to_string(), Value::String(text.to_string()));
                if let Some(synthetic) = part_obj.get("synthetic").cloned() {
                    node.insert("synthetic".to_string(), synthetic);
                }
                out.push(Value::Object(node));
            }
            "reasoning" if role == "assistant" => {
                let text = part_obj
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                if text.is_empty() {
                    continue;
                }
                let mut node = Map::new();
                node.insert("type".to_string(), Value::String("reasoning".to_string()));
                if let Some(id) = part_obj.get("id").cloned() {
                    node.insert("id".to_string(), id);
                }
                node.insert("text".to_string(), Value::String(text.to_string()));
                out.push(Value::Object(node));
            }
            "tool" if role == "assistant" => {
                let tool = part_obj
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                if tool.is_empty() {
                    continue;
                }
                let mut node = Map::new();
                node.insert("type".to_string(), Value::String("tool".to_string()));
                node.insert("tool".to_string(), Value::String(tool.to_string()));
                if let Some(id) = part_obj.get("id").cloned() {
                    node.insert("id".to_string(), id);
                }
                if let Some(call_id) = part_obj.get("callID").cloned() {
                    node.insert("callID".to_string(), call_id);
                }
                if let Some(message_id) = part_obj.get("messageID").cloned() {
                    node.insert("messageID".to_string(), message_id);
                }
                if let Some(metadata) = compact_mobile_tool_metadata(
                    part_obj.get("metadata").and_then(|v| v.as_object()),
                ) {
                    node.insert("metadata".to_string(), metadata);
                }
                if let Some(state) = part_obj.get("state").and_then(|v| v.as_object()) {
                    let mut compact_state = Map::new();
                    if let Some(v) = state.get("status").cloned() {
                        compact_state.insert("status".to_string(), v);
                    }
                    if let Some(v) = state.get("title").cloned() {
                        compact_state.insert("title".to_string(), v);
                    }
                    if let Some(v) = state.get("error").cloned() {
                        compact_state.insert("error".to_string(), v);
                    }
                    if let Some(input) =
                        compact_mobile_tool_input(state.get("input").and_then(|v| v.as_object()))
                    {
                        compact_state.insert("input".to_string(), input);
                    }
                    if let Some(output) = compact_mobile_tool_output(state.get("output")) {
                        compact_state.insert("output".to_string(), output);
                    }
                    if let Some(metadata) = compact_mobile_tool_metadata(
                        state.get("metadata").and_then(|v| v.as_object()),
                    ) {
                        compact_state.insert("metadata".to_string(), metadata);
                    }
                    if !compact_state.is_empty() {
                        node.insert("state".to_string(), Value::Object(compact_state));
                    }
                }
                out.push(Value::Object(node));
            }
            "compaction" if role == "user" => {
                let mut node = Map::new();
                node.insert("type".to_string(), Value::String("compaction".to_string()));
                node.insert(
                    "auto".to_string(),
                    Value::Bool(
                        part_obj
                            .get("auto")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                    ),
                );
                out.push(Value::Object(node));
            }
            _ => {}
        }
    }
    out
}

fn compact_mobile_message_payload(mut v: Value) -> Value {
    let Some(arr) = v.as_array_mut() else {
        return v;
    };
    for item in arr.iter_mut() {
        let Some(item_obj) = item.as_object_mut() else {
            continue;
        };
        let role = item_obj
            .get("info")
            .and_then(|v| v.get("role"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let Some(info) = item_obj.get_mut("info").and_then(|v| v.as_object_mut()) else {
            continue;
        };
        // `info.system` often contains the full agent/system prompt and can be huge.
        // Mobile rendering does not use it, but forwarding it through the lightweight
        // desktop HTTP server makes older history pages much larger and prone to truncation.
        info.remove("system");
        // Keep summary only when it's a boolean flag used by loop detection semantics.
        if !matches!(info.get("summary"), Some(Value::Bool(_))) {
            info.remove("summary");
        }
        if let Some(parts) = item_obj.get("parts").and_then(|v| v.as_array()) {
            item_obj.insert(
                "parts".to_string(),
                Value::Array(compact_mobile_message_parts(role.as_str(), parts)),
            );
        }
    }
    v
}

fn normalize_provider_key(input: &str) -> String {
    input
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
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

fn validate_prompt_model(repo_path: &str, model: &str) -> Result<(), String> {
    let (provider_id, model_id) = parse_model_ref(model)
        .ok_or_else(|| "model must be in format provider/model".to_string())?;
    let provider_key = normalize_provider_key(&provider_id);

    // Keep behavior aligned with OpenCode/client: disabled providers are matched
    // by exact id text (case-sensitive), so `Vllm` does not disable `vllm`.
    if let Ok(cfg) = opencode::get_opencode_server_config(repo_path) {
        let disabled = cfg
            .get("disabled_providers")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for item in disabled {
            let pid = item.as_str().unwrap_or("").trim();
            if pid.is_empty() {
                continue;
            }
            if pid == provider_id {
                return Err(format!(
                    "model provider '{}' is disabled by config.disabled_providers",
                    provider_id
                ));
            }
        }
    }

    let state = opencode::get_opencode_server_provider_state(repo_path)?;
    let provider = state
        .providers
        .iter()
        .find(|p| normalize_provider_key(p.id.as_str()) == provider_key)
        .ok_or_else(|| {
            format!(
                "model provider '{}' not found in server provider catalog",
                provider_id
            )
        })?;

    let model_exists = provider
        .models
        .iter()
        .any(|m| m.trim() == model_id || m.trim().eq_ignore_ascii_case(model_id.as_str()));
    if !model_exists {
        return Err(format!(
            "model '{}' is not available under provider '{}'",
            model_id, provider.id
        ));
    }

    let connected = state
        .connected
        .iter()
        .any(|pid| normalize_provider_key(pid.as_str()) == provider_key);
    if !connected {
        return Err(format!(
            "model provider '{}' is not connected; connect provider first",
            provider.id
        ));
    }
    Ok(())
}

fn handle_stream_messages_sse(mut stream: TcpStream, req: &HttpRequest) {
    if let Err(e) = ensure_authorized(req) {
        let _ = write_http_json(&mut stream, 401, &serde_json::json!({ "error": e }));
        return;
    }
    let repo = req.query.get("repoPath").cloned().unwrap_or_default();
    let session_id = req.query.get("sessionId").cloned().unwrap_or_default();
    if repo.trim().is_empty() || session_id.trim().is_empty() {
        let _ = write_http_json(
            &mut stream,
            400,
            &serde_json::json!({ "error": "repoPath and sessionId are required" }),
        );
        return;
    }
    let interval_ms = req
        .query
        .get("intervalMs")
        .and_then(|v| v.parse::<u64>().ok())
        .map(|v| v.clamp(300, 3000))
        .unwrap_or(900);

    if let Err(e) = write_sse_headers(&mut stream) {
        eprintln!("[control] sse headers failed: {}", e);
        return;
    }
    let _ = write_sse_event(
        &mut stream,
        "ready",
        &serde_json::json!({
            "repoPath": repo,
            "sessionId": session_id,
            "intervalMs": interval_ms,
            "mode": "opencode-global-event"
        }),
    );

    match stream_opencode_global_events(&mut stream, repo.as_str(), session_id.as_str()) {
        Ok(()) => return,
        Err(e) => {
            let _ = write_sse_event(
                &mut stream,
                "stream_fallback",
                &serde_json::json!({ "reason": e, "mode": "message-snapshot" }),
            );
        }
    }

    let mut prev_fingerprint = String::new();
    let start = now_unix_secs();
    let mut unchanged_since = now_unix_secs();
    loop {
        match opencode::get_opencode_session_messages_detailed(
            repo.as_str(),
            session_id.as_str(),
            None,
            Some(80),
        ) {
            Ok(v) => {
                let stats = analyze_session_loop_stats(&v);
                if is_size_limit_compaction_loop(stats) {
                    let _ =
                        opencode::abort_opencode_session(repo.as_str(), session_id.as_str(), None);
                    let _ = write_sse_event(
                        &mut stream,
                        "error",
                        &serde_json::json!({
                            "error": "detected size-limit compaction loop; session aborted",
                            "code": "SIZE_LIMIT_COMPACTION_LOOP",
                            "sessionId": session_id,
                            "syntheticSizeLimitUserCount": stats.synthetic_size_limit_user,
                            "compactionAssistantCount": stats.compaction_assistant
                        }),
                    );
                    let _ = write_sse_event(
                        &mut stream,
                        "end",
                        &serde_json::json!({"reason":"size_limit_compaction_loop"}),
                    );
                    break;
                }
                let filtered_v = filter_mobile_compacted_messages(v);
                let compact_v = compact_mobile_message_payload(filtered_v);
                let fp = serde_json::to_string(&compact_v).unwrap_or_default();
                if fp != prev_fingerprint {
                    prev_fingerprint = fp;
                    unchanged_since = now_unix_secs();
                    if write_sse_event(&mut stream, "messages", &compact_v).is_err() {
                        break;
                    }
                } else if write_sse_event(
                    &mut stream,
                    "heartbeat",
                    &serde_json::json!({"ts": now_unix_secs()}),
                )
                .is_err()
                {
                    break;
                }
            }
            Err(e) => {
                let _ = write_sse_event(&mut stream, "error", &serde_json::json!({ "error": e }));
            }
        }
        // If snapshots do not change for too long, close stream so mobile UI won't spin forever
        // on stale pending tool states (e.g., task/write stuck in pending).
        if now_unix_secs().saturating_sub(unchanged_since) > 40 {
            let _ = write_sse_event(
                &mut stream,
                "end",
                &serde_json::json!({"reason":"no_change_timeout"}),
            );
            break;
        }
        // Safety timeout for stale mobile connections. Client can reconnect.
        if now_unix_secs().saturating_sub(start) > 60 * 8 {
            let _ = write_sse_event(&mut stream, "end", &serde_json::json!({"reason":"timeout"}));
            break;
        }
        thread::sleep(Duration::from_millis(interval_ms));
    }
}

fn handle_api_request(req: HttpRequest, remote_ip: Option<IpAddr>) -> (u16, Value) {
    if req.method == "OPTIONS" {
        return (204, Value::Null);
    }

    if req.method == "GET" && req.path == "/api/v1/health" {
        let settings = read_control_server_settings();
        let mode = normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str());
        return (
            200,
            serde_json::json!({
                "ok": true,
                "service": {
                    "enabled": settings.enabled,
                    "host": settings.host,
                    "port": settings.port
                },
                "auth": {
                    "pairCodeTtlMode": mode,
                    "noAuth": mode == "none"
                },
                "opencodeServiceBase": format!("http://127.0.0.1:{}", opencode::get_opencode_service_settings().map(|s| s.port).unwrap_or(4098)),
            }),
        );
    }

    if req.method == "POST" && req.path == "/api/v1/pair/request" {
        if let Err(resp) = ensure_loopback(remote_ip, "pair.request") {
            return resp;
        }
        let settings = read_control_server_settings();
        let info = if normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str()) == "none" {
            current_pair_code()
        } else {
            refresh_pair_code()
        };
        return (
            200,
            serde_json::json!({
                "code": info.code,
                "expiresAt": info.expires_at,
                "ttlSeconds": info.ttl_seconds
            }),
        );
    }

    if req.method == "GET" && req.path == "/api/v1/pair/current" {
        if let Err(resp) = ensure_loopback(remote_ip, "pair.current") {
            return resp;
        }
        let info = current_pair_code();
        return (
            200,
            serde_json::json!({
                "code": info.code,
                "expiresAt": info.expires_at,
                "ttlSeconds": info.ttl_seconds
            }),
        );
    }

    if req.method == "GET" && req.path == "/api/v1/admin/control/settings" {
        if let Err(resp) = ensure_loopback(remote_ip, "admin.control.settings") {
            return resp;
        }
        return match get_control_server_settings() {
            Ok(v) => serde_json::to_value(v)
                .map(|value| (200, value))
                .unwrap_or_else(|e| (500, serde_json::json!({ "error": format!("serialize control settings failed: {e}") }))),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "PUT" && req.path == "/api/v1/admin/mobile/model-state" {
        if let Err(resp) = ensure_loopback(remote_ip, "admin.mobile.model-state") {
            return resp;
        }
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        return match write_mobile_model_state(&raw) {
            Ok(_) => (200, serde_json::json!({ "ok": true })),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "PUT" && req.path == "/api/v1/admin/control/settings" {
        if let Err(resp) = ensure_loopback(remote_ip, "admin.control.settings") {
            return resp;
        }
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        let payload: ControlServerSettings = match serde_json::from_value(raw) {
            Ok(v) => v,
            Err(e) => {
                return (
                    400,
                    serde_json::json!({ "error": format!("invalid payload: {e}") }),
                )
            }
        };
        return match set_control_server_settings(payload) {
            Ok(v) => serde_json::to_value(v)
                .map(|value| (200, value))
                .unwrap_or_else(|e| (500, serde_json::json!({ "error": format!("serialize control settings failed: {e}") }))),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/admin/control/access-info" {
        if let Err(resp) = ensure_loopback(remote_ip, "admin.control.access-info") {
            return resp;
        }
        return match get_control_access_info() {
            Ok(v) => serde_json::to_value(v)
                .map(|value| (200, value))
                .unwrap_or_else(|e| (500, serde_json::json!({ "error": format!("serialize control access info failed: {e}") }))),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    let settings = read_control_server_settings();
    if !settings.enabled {
        return (
            503,
            serde_json::json!({
                "error": "mobile control API is disabled",
                "enabled": false
            }),
        );
    }

    if req.method == "POST" && req.path == "/api/v1/auth/pair" {
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        let payload: PairAuthRequest = match serde_json::from_value(raw) {
            Ok(v) => v,
            Err(e) => {
                return (
                    400,
                    serde_json::json!({ "error": format!("invalid payload: {e}") }),
                )
            }
        };
        if let Err(reason) = verify_pair_code(payload.code.as_str()) {
            return (401, serde_json::json!({ "error": reason }));
        }
        let token = current_bearer_token();
        return (
            200,
            serde_json::json!({ "token": token, "tokenType": "Bearer" }),
        );
    }

    if let Err(e) = ensure_authorized(&req) {
        return (401, serde_json::json!({ "error": e }));
    }

    let resolve_repo_path = || -> Option<String> {
        let from_query = req.query.get("repoPath").cloned().unwrap_or_default();
        if !from_query.trim().is_empty() {
            return Some(from_query);
        }
        if let Ok(rows) = read_client_repositories() {
            if let Some(path) = rows
                .iter()
                .filter_map(|row| row.get("path").and_then(|value| value.as_str()))
                .map(str::trim)
                .find(|path| !path.is_empty())
            {
                return Some(path.to_string());
            }
        }
        let mut dir = std::env::current_dir().ok()?;
        loop {
            if dir.join(".git").exists() {
                return dir.to_str().map(|s| s.to_string());
            }
            if !dir.pop() {
                break;
            }
        }
        None
    };

    if req.method == "GET" && req.path == "/api/v1/opencode/project/current" {
        let Some(repo) = resolve_repo_path() else {
            return (200, Value::Null);
        };
        return match opencode::get_opencode_current_project(repo.as_str()) {
            Ok(v) => (200, v),
            Err(e) if e.contains("not a git repository") => (200, Value::Null),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/opencode/project" {
        let Some(repo) = resolve_repo_path() else {
            return (200, Value::Array(Vec::new()));
        };
        return match opencode::list_opencode_projects(repo.as_str()) {
            Ok(v) => (200, v),
            Err(e) if e.contains("not a git repository") => (200, Value::Array(Vec::new())),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/repository/list" {
        return match read_client_repositories() {
            Ok(rows) => (200, Value::Array(rows)),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/opencode/config" {
        let repo = req.query.get("repoPath").cloned().unwrap_or_default();
        if repo.trim().is_empty() {
            return (400, serde_json::json!({ "error": "repoPath is required" }));
        }
        return match opencode::get_opencode_server_config(repo.as_str()) {
            Ok(v) => (200, attach_mobile_model_state(v)),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/opencode/session" {
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        let payload: CreateSessionRequest = match serde_json::from_value(raw) {
            Ok(v) => v,
            Err(e) => {
                return (
                    400,
                    serde_json::json!({ "error": format!("invalid payload: {e}") }),
                )
            }
        };
        return match opencode::create_opencode_session(payload.repo_path.as_str(), payload.title) {
            Ok(v) => (
                201,
                serde_json::json!({
                    "id": v.id,
                    "title": v.title,
                    "createdAt": v.created_at,
                    "updatedAt": v.updated_at
                }),
            ),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/opencode/session" {
        let repo = req.query.get("repoPath").cloned().unwrap_or_default();
        if repo.trim().is_empty() {
            return (400, serde_json::json!({ "error": "repoPath is required" }));
        }
        let limit = req.query.get("limit").and_then(|v| v.parse::<u32>().ok());
        return match opencode::list_opencode_sessions(repo.as_str(), limit) {
            Ok(v) => (
                200,
                Value::Array(
                    v.into_iter()
                        .map(|s| {
                            serde_json::json!({
                                "id": s.id,
                                "title": s.title,
                                "createdAt": s.created_at,
                                "updatedAt": s.updated_at
                            })
                        })
                        .collect::<Vec<_>>(),
                ),
            ),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/opencode/session/status" {
        let repo = req.query.get("repoPath").cloned().unwrap_or_default();
        if repo.trim().is_empty() {
            return (400, serde_json::json!({ "error": "repoPath is required" }));
        }
        return match opencode::get_opencode_session_status(repo.as_str()) {
            Ok(v) => (200, v),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/opencode/prompt" {
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        let payload: PromptRequest = match serde_json::from_value(raw) {
            Ok(v) => v,
            Err(e) => {
                return (
                    400,
                    serde_json::json!({ "error": format!("invalid payload: {e}") }),
                )
            }
        };
        if let Some(model) = payload
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
        {
            if let Err(e) = validate_prompt_model(payload.repo_path.as_str(), model) {
                return (400, serde_json::json!({ "error": e }));
            }
        }
        let mut session_id = payload
            .session_id
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string();
        if session_id.is_empty() {
            let created = match opencode::create_opencode_session(
                payload.repo_path.as_str(),
                payload.title.clone(),
            ) {
                Ok(s) => s,
                Err(e) => return (500, serde_json::json!({ "error": e })),
            };
            session_id = created.id;
        }
        {
            let repo_for_capture = payload.repo_path.clone();
            let sid_for_capture = session_id.clone();
            thread::spawn(move || {
                // Capture question events for up to 120 seconds to handle slow question generation
                if let Ok(requests) = opencode::capture_opencode_question_events(
                    repo_for_capture.as_str(),
                    sid_for_capture.as_str(),
                    120,
                ) {
                    cache_question_requests(repo_for_capture.as_str(), sid_for_capture.as_str(), requests);
                }
            });
            thread::sleep(Duration::from_millis(180));
        }
        return match opencode::post_opencode_session_prompt_async(
            payload.repo_path.as_str(),
            session_id.as_str(),
            payload.prompt.as_str(),
            payload.model.clone(),
        ) {
            Ok(_) => (
                200,
                serde_json::json!({
                    "accepted": true,
                    "sessionId": session_id
                }),
            ),
            Err(e) => {
                let is_bad_request = e.contains("model must be in format provider/model")
                    || e.contains("prompt must not be empty")
                    || e.contains("session_id must not be empty");
                if is_bad_request {
                    (400, serde_json::json!({ "error": e }))
                } else {
                    (500, serde_json::json!({ "error": e }))
                }
            }
        };
    }

    if req.method == "GET" && req.path == "/api/v1/opencode/messages" {
        let repo = req.query.get("repoPath").cloned().unwrap_or_default();
        let sid = req.query.get("sessionId").cloned().unwrap_or_default();
        if repo.trim().is_empty() || sid.trim().is_empty() {
            return (
                400,
                serde_json::json!({ "error": "repoPath and sessionId are required" }),
            );
        }
        let limit = req.query.get("limit").and_then(|v| v.parse::<u32>().ok());
        let before = req.query.get("before").cloned();
        return match opencode::get_opencode_session_messages_detailed_page(
            repo.as_str(),
            sid.as_str(),
            None,
            before,
            limit,
        ) {
            Ok((items, next_cursor)) => {
                let stats = analyze_session_loop_stats(&items);
                let final_items = if is_size_limit_compaction_loop(stats) {
                    let _ = opencode::abort_opencode_session(repo.as_str(), sid.as_str(), None);
                    push_loop_notice_message(items, sid.as_str(), stats)
                } else {
                    items
                };
                let filtered_items = filter_mobile_compacted_messages(final_items);
                let compact_items = compact_mobile_message_payload(filtered_items);
                (
                    200,
                    serde_json::json!({
                        "items": compact_items,
                        "nextCursor": next_cursor
                    }),
                )
            }
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/opencode/abort" {
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        let payload: AbortRequest = match serde_json::from_value(raw) {
            Ok(v) => v,
            Err(e) => {
                return (
                    400,
                    serde_json::json!({ "error": format!("invalid payload: {e}") }),
                )
            }
        };
        return match opencode::abort_opencode_session(
            payload.repo_path.as_str(),
            payload.session_id.as_str(),
            None,
        ) {
            Ok(v) => (200, serde_json::json!({ "ok": v })),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/opencode/question" {
        let repo = req.query.get("repoPath").cloned().unwrap_or_default();
        if repo.trim().is_empty() {
            return (400, serde_json::json!({ "error": "repoPath is required" }));
        }
        let session_id = req.query.get("sessionId").cloned().unwrap_or_default();
        let cached: Vec<Value> = if let Ok(guard) = question_cache().lock() {
            guard
                .iter()
                .filter(|(key, _)| key.starts_with(format!("{}\n", repo.trim()).as_str()))
                .flat_map(|(_, rows)| rows.clone())
                .filter(|item| {
                    if session_id.is_empty() {
                        return true;
                    }
                    item.get("sessionID").and_then(|v| v.as_str()) == Some(session_id.as_str())
                })
                .collect()
        } else {
            Vec::new()
        };
        match opencode::list_opencode_questions(repo.as_str()) {
            Ok(v) => {
                let mut rows = v.as_array().cloned().unwrap_or_default();
                // Filter by sessionId if provided
                if !session_id.is_empty() {
                    rows.retain(|row| row.get("sessionID").and_then(|v| v.as_str()) == Some(session_id.as_str()));
                }
                for item in cached {
                    let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if !id.is_empty() && !rows.iter().any(|row| row.get("id").and_then(|v| v.as_str()) == Some(id)) {
                        rows.push(item);
                    }
                }
                return (200, Value::Array(rows));
            }
            Err(e) => {
                if !cached.is_empty() {
                    return (200, Value::Array(cached));
                }
                return (500, serde_json::json!({ "error": e }));
            }
        }
    }

    // Question reply/reject endpoints
    if req.method == "POST" && req.path.starts_with("/api/v1/opencode/question/") {
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        let repo_path = raw
            .get("repoPath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if repo_path.is_empty() {
            return (400, serde_json::json!({ "error": "repoPath is required" }));
        }
        let path_parts: Vec<&str> = req.path.split('/').collect();
        if path_parts.len() >= 6 {
            let request_id = path_parts[5];
            if req.path.ends_with("/reply") {
                let answers: Vec<Vec<String>> = raw
                    .get("answers")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.as_array().map(|inner| {
                                inner.iter().filter_map(|s| s.as_str().map(String::from)).collect()
                            }))
                            .collect()
                    })
                    .unwrap_or_default();
                // Try direct submission first
                match opencode::post_opencode_question_reply(&repo_path, request_id, answers.clone()) {
                    Ok(_) => {
                        remove_cached_question(request_id);
                        return (200, serde_json::json!({ "ok": true }));
                    }
                    Err(direct_err) => {
                        // If direct submission fails and request_id looks like a tool callID,
                        // try to find the actual question request_id from cache or opencode list
                        if request_id.starts_with("call_function_") {
                            // Try cache first
                            if let Ok(guard) = question_cache().lock() {
                                for (_, bucket) in guard.iter() {
                                    for item in bucket {
                                        let cached_call_id = item.get("tool")
                                            .and_then(|v| v.get("callID"))
                                            .and_then(|v| v.as_str());
                                        if cached_call_id == Some(request_id) {
                                            if let Some(actual_id) = item.get("id").and_then(|v| v.as_str()) {
                                                match opencode::post_opencode_question_reply(
                                                    &repo_path, actual_id, answers.clone()) {
                                                    Ok(_) => {
                                                        remove_cached_question(actual_id);
                                                        return (200, serde_json::json!({ "ok": true }));
                                                    }
                                                    Err(_) => {}
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Try fetching from opencode and match by callID
                            if let Ok(v) = opencode::list_opencode_questions(repo_path.as_str()) {
                                if let Some(rows) = v.as_array() {
                                    for row in rows {
                                        let row_call_id = row.get("tool")
                                            .and_then(|v| v.get("callID"))
                                            .and_then(|v| v.as_str());
                                        if row_call_id == Some(request_id) {
                                            if let Some(actual_id) = row.get("id").and_then(|v| v.as_str()) {
                                                match opencode::post_opencode_question_reply(&repo_path, actual_id, answers.clone()) {
                                                    Ok(_) => {
                                                        remove_cached_question(actual_id);
                                                        return (200, serde_json::json!({ "ok": true }));
                                                    }
                                                    Err(_) => {}
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        return (500, serde_json::json!({ "error": direct_err }));
                    }
                }
            } else if req.path.ends_with("/reject") {
                return match opencode::post_opencode_question_reject(&repo_path, request_id) {
                    Ok(_) => {
                        remove_cached_question(request_id);
                        (200, serde_json::json!({ "ok": true }))
                    }
                    Err(e) => (500, serde_json::json!({ "error": e })),
                };
            }
        }
    }

    (404, serde_json::json!({ "error": "not found" }))
}

fn handle_connection(mut stream: TcpStream, remote_ip: Option<IpAddr>) {
    // TcpListener is set to non-blocking; some platforms may yield accepted streams
    // that behave non-blocking and return EAGAIN ("Resource temporarily unavailable")
    // during reads. This breaks HTTP parsing and causes spurious 400 errors.
    let _ = stream.set_nonblocking(false);
    let response = match read_http_request(&mut stream) {
        Ok(req) => {
            if req.method == "GET" && req.path == "/api/v1/opencode/stream" {
                handle_stream_messages_sse(stream, &req);
                return;
            }
            handle_api_request(req, remote_ip)
        }
        Err(e) => (400, serde_json::json!({ "error": e })),
    };
    if response.0 == 204 {
        if let Err(e) = write_http_no_content(&mut stream, 204) {
            eprintln!("[control] write 204 failed: {}", e);
        }
    } else {
        if let Err(e) = write_http_json(&mut stream, response.0, &response.1) {
            eprintln!("[control] write {} failed: {}", response.0, e);
        }
    }
}

fn run_control_server_loop(
    settings: ControlServerSettings,
    listener: TcpListener,
    stop: Arc<AtomicBool>,
) {
    let addr = format!("{}:{}", settings.host, settings.port);
    eprintln!("[control] listening on http://{}", addr);

    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, remote)) => {
                let ip = Some(remote.ip());
                thread::spawn(move || handle_connection(stream, ip));
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(120));
            }
            Err(e) => {
                eprintln!("[control] accept error: {}", e);
                thread::sleep(Duration::from_millis(180));
            }
        }
    }
    eprintln!("[control] server loop exited");
}

pub fn stop_control_server() {
    if let Ok(mut guard) = runtime_cell().lock() {
        if let Some(mut rt) = guard.take() {
            rt.stop.store(true, Ordering::Relaxed);
            if let Some(join) = rt.join.take() {
                let _ = join.join();
            }
        }
    }
}

pub fn start_control_server() -> Result<(), String> {
    let settings = read_control_server_settings();
    if !settings.enabled {
        stop_control_server();
        return Ok(());
    }
    if let Ok(mut guard) = runtime_cell().lock() {
        if let Some(current) = guard.as_ref() {
            if current.settings.host == settings.host
                && current.settings.port == settings.port
                && current.settings.enabled == settings.enabled
            {
                return Ok(());
            }
        }
        if let Some(mut old) = guard.take() {
            old.stop.store(true, Ordering::Relaxed);
            if let Some(join) = old.join.take() {
                let _ = join.join();
            }
        }
        let addr = format!("{}:{}", settings.host, settings.port);
        let listener = TcpListener::bind(addr.as_str())
            .map_err(|e| format!("control server bind failed on {addr}: {e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("control server set_nonblocking failed on {addr}: {e}"))?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = Arc::clone(&stop);
        let cfg_for_thread = settings.clone();
        let join = thread::spawn(move || {
            run_control_server_loop(cfg_for_thread, listener, stop_for_thread)
        });
        *guard = Some(ControlRuntime {
            stop,
            join: Some(join),
            settings,
        });
        return Ok(());
    }
    Err("failed to lock control runtime".to_string())
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn get_control_server_settings() -> Result<ControlServerSettings, String> {
    Ok(read_control_server_settings())
}

pub fn persist_control_server_settings(
    settings: ControlServerSettings,
) -> Result<ControlServerSettings, String> {
    let mut next = settings.clone();
    if next.host.trim().is_empty() {
        next.host = DEFAULT_CONTROL_SERVER_HOST.to_string();
    } else {
        next.host = next.host.trim().to_string();
    }
    if next.port == 0 {
        return Err("control server port must be between 1 and 65535".to_string());
    }
    next.public_base_url = next
        .public_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    next.pair_code_ttl_mode = normalize_pair_code_ttl_mode(next.pair_code_ttl_mode.as_str());
    write_control_server_settings(&next)?;
    {
        let now = now_unix_secs();
        let mut state = pair_state_cell().lock().expect("pair state lock poisoned");
        sync_pair_state_for_mode(&mut state, next.pair_code_ttl_mode.as_str(), now, false);
    }
    Ok(next)
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn set_control_server_settings(
    settings: ControlServerSettings,
) -> Result<ControlServerSettings, String> {
    let next = persist_control_server_settings(settings)?;
    start_control_server()?;
    Ok(next)
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn get_control_pair_code() -> Result<ControlPairCodeInfo, String> {
    Ok(current_pair_code())
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn refresh_control_pair_code() -> Result<ControlPairCodeInfo, String> {
    Ok(refresh_pair_code())
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn get_control_access_info() -> Result<ControlAccessInfo, String> {
    let settings = read_control_server_settings();
    let pair = current_pair_code();
    let mut urls: Vec<String> = Vec::new();
    if !settings.public_base_url.trim().is_empty() {
        urls.push(settings.public_base_url.trim().to_string());
    }
    if settings.enabled {
        if settings.host == "0.0.0.0" {
            if let Some(ip) = detect_primary_lan_ip() {
                urls.push(format!("http://{}:{}", ip, settings.port));
            }
            urls.push(format!("http://127.0.0.1:{}", settings.port));
        } else {
            urls.push(format!("http://{}:{}", settings.host, settings.port));
        }
    }
    Ok(ControlAccessInfo {
        enabled: settings.enabled,
        host: settings.host,
        port: settings.port,
        public_base_url: settings.public_base_url,
        pair_code: pair.code,
        expires_at: pair.expires_at,
        local_urls: urls,
        pair_code_ttl_mode: normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str()),
        no_auth: normalize_pair_code_ttl_mode(settings.pair_code_ttl_mode.as_str()) == "none",
    })
}

use super::desktop_rpc;
use super::pi_agent::{
    AgentEvent, AgentEventEnvelope, AgentEventReceiver, AgentEventSink, AgentInteractionReply,
    CustomProviderInput, PiAgentError, PiAgentService, PiSessionConfig,
};
use futures::executor::block_on;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
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
struct PiControlCreateSessionRequest {
    repo_path: String,
    session_dir: Option<String>,
    session_path: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    system_prompt: Option<String>,
    append_system_prompt: Option<String>,
    enabled_tools: Option<Vec<String>>,
    extension_paths: Option<Vec<String>>,
    no_session: Option<bool>,
    /// 单次 run 最大工具迭代次数；None/省略 = 不限制。
    max_tool_iterations: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiControlPromptRequest {
    session_id: String,
    run_id: Option<String>,
    prompt: String,
    #[serde(default)]
    images: Vec<crate::pi_agent::AgentPromptImage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiControlCredentialRequest {
    provider: String,
    api_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiControlSetModelRequest {
    session_id: String,
    provider: String,
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiControlSetThinkingRequest {
    session_id: String,
    level: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiControlInteractionReplyRequest {
    interaction_id: String,
    reply: AgentInteractionReply,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiControlAutoApproveRequest {
    session_id: String,
    #[serde(default)]
    enabled: bool,
}

fn pi_session_dir(repo_path: &str) -> PathBuf {
    PathBuf::from(repo_path).join(".giteam").join("pi-sessions")
}

fn pi_error_response(error: PiAgentError) -> (u16, Value) {
    let status = match &error {
        PiAgentError::SessionNotFound(_) => 404,
        PiAgentError::RunAlreadyExists(_) | PiAgentError::SessionBusy(_) => 409,
        // 交互回复无效（已 resolved / 种类不匹配）属客户端错误。
        PiAgentError::Interaction(_) => 400,
        PiAgentError::Sdk(_)
        | PiAgentError::State(_)
        | PiAgentError::Persistence(_)
        | PiAgentError::Secret(_)
        | PiAgentError::Provider(_)
        | PiAgentError::SessionAlreadyExists(_) => {
            500
        }
    };
    (status, serde_json::json!({ "error": error.to_string() }))
}

static CONTROL_RUNTIME: OnceLock<Mutex<Option<ControlRuntime>>> = OnceLock::new();
static CONTROL_PAIR_STATE: OnceLock<Mutex<PairState>> = OnceLock::new();
static CONTROL_BEARER_TOKEN: OnceLock<Mutex<String>> = OnceLock::new();
static WEB_STATIC_DIR: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn web_static_dir_cell() -> &'static Mutex<Option<PathBuf>> {
    WEB_STATIC_DIR.get_or_init(|| Mutex::new(None))
}

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

fn write_mobile_model_state(value: &Value) -> Result<(), String> {
    let Some(path) = mobile_model_state_path() else {
        return Err("mobile model state path unavailable".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create model state dir failed: {e}"))?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("serialize model state failed: {e}"))?;
    fs::write(path, text).map_err(|e| format!("write model state failed: {e}"))
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn set_mobile_model_state_from_desktop(state: Value) -> Result<(), String> {
    write_mobile_model_state(&state)
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
    if cfg.port == 5100
        && cfg.host == DEFAULT_CONTROL_SERVER_HOST
        && cfg.public_base_url.is_empty()
        && normalize_pair_code_ttl_mode(cfg.pair_code_ttl_mode.as_str()) != "none"
    {
        cfg.port = DEFAULT_CONTROL_SERVER_PORT;
    }
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

fn normalize_control_server_settings(
    settings: ControlServerSettings,
) -> Result<ControlServerSettings, String> {
    let mut next = settings;
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
    Ok(next)
}

fn effective_control_server_settings() -> ControlServerSettings {
    if let Ok(guard) = runtime_cell().lock() {
        if let Some(rt) = guard.as_ref() {
            return rt.settings.clone();
        }
    }
    read_control_server_settings()
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
    let settings = effective_control_server_settings();
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
    let settings = effective_control_server_settings();
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
    let settings = effective_control_server_settings();
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
    let settings = effective_control_server_settings();
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
    // 1) Prefer the CLI-compatible config path first so web + desktop RPC read
    // the same repository database.
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
                        .join("client.db"),
                );
            }
        }
    }
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg_config_home.trim();
        if !p.is_empty() {
            out.push(PathBuf::from(p).join("giteam").join("client.db"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            out.push(
                PathBuf::from(h)
                    .join(".config")
                    .join("giteam")
                    .join("client.db"),
            );
        }
    }

    // 2) Legacy app-data locations.
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
    // 3) Then prefer the same app-data root used by control settings/auth files.
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
    // 4) Last-resort fallback: workspace-local legacy db.
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

fn guess_content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html",
        Some("js") => "application/javascript",
        Some("mjs") => "application/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn write_http_file(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        status, reason, content_type, body.len()
    );
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    write_stream_all(stream, head.as_bytes(), "write file headers")?;
    write_stream_all(stream, body, "write file body")?;
    stream
        .flush()
        .map_err(|e| format!("write file response failed: {e}"))
}

fn serve_static_file(stream: &mut TcpStream, req: &HttpRequest) -> bool {
    let static_dir = match web_static_dir_cell().lock() {
        Ok(guard) => guard.clone(),
        Err(_) => None,
    };
    let Some(static_dir) = static_dir.as_ref() else {
        return false;
    };
    // Only serve GET requests for static files
    if req.method != "GET" {
        return false;
    }
    // Don't serve API routes as static files
    if req.path.starts_with("/api/") {
        return false;
    }

    let sanitized = req.path.trim_start_matches('/').replace("..", "");
    let file_path = if sanitized.is_empty() || sanitized.ends_with('/') {
        static_dir.join("index.html")
    } else {
        static_dir.join(&sanitized)
    };

    // Security: ensure the resolved path is within static_dir
    let canonical_file = match std::fs::canonicalize(&file_path) {
        Ok(p) => p,
        Err(_) => {
            // File doesn't exist; try SPA fallback
            let index_path = static_dir.join("index.html");
            if let Ok(bytes) = std::fs::read(&index_path) {
                let ct = guess_content_type(&index_path);
                let _ = write_http_file(stream, 200, ct, &bytes);
                return true;
            }
            return false;
        }
    };
    let Ok(canonical_dir) = std::fs::canonicalize(static_dir) else {
        return false;
    };
    if !canonical_file.starts_with(&canonical_dir) {
        return false;
    }

    if canonical_file.is_file() {
        if let Ok(bytes) = std::fs::read(&canonical_file) {
            let ct = guess_content_type(&canonical_file);
            let _ = write_http_file(stream, 200, ct, &bytes);
            return true;
        }
    }

    // Directory or missing file: SPA fallback
    let index_path = static_dir.join("index.html");
    if let Ok(bytes) = std::fs::read(&index_path) {
        let ct = guess_content_type(&index_path);
        let _ = write_http_file(stream, 200, ct, &bytes);
        return true;
    }

    false
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

fn summarize_rpc_log_value(value: &Value, depth: usize) -> Value {
    if depth >= 2 {
        return match value {
            Value::Array(arr) => Value::String(format!("[array:{}]", arr.len())),
            Value::Object(_) => Value::String("[object]".to_string()),
            _ => value.clone(),
        };
    }
    match value {
        Value::Array(arr) => Value::Array(
            arr.iter()
                .take(6)
                .map(|item| summarize_rpc_log_value(item, depth + 1))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, raw) in map {
                let lower = key.to_lowercase();
                if lower.contains("key")
                    || lower.contains("token")
                    || lower.contains("secret")
                    || lower.contains("password")
                {
                    out.insert(key.clone(), Value::String("[redacted]".to_string()));
                    continue;
                }
                if matches!(lower.as_str(), "prompt" | "message" | "log" | "output") {
                    if let Some(text) = raw.as_str() {
                        let short = if text.chars().count() > 160 {
                            format!("{}…", text.chars().take(160).collect::<String>())
                        } else {
                            text.to_string()
                        };
                        out.insert(key.clone(), Value::String(short));
                        continue;
                    }
                }
                out.insert(key.clone(), summarize_rpc_log_value(raw, depth + 1));
            }
            Value::Object(out)
        }
        Value::String(text) => {
            if text.chars().count() > 160 {
                Value::String(format!("{}…", text.chars().take(160).collect::<String>()))
            } else {
                Value::String(text.clone())
            }
        }
        _ => value.clone(),
    }
}

fn summarize_desktop_rpc_args(args: &Value) -> String {
    serde_json::to_string(&summarize_rpc_log_value(args, 0))
        .unwrap_or_else(|_| "\"[unserializable args]\"".to_string())
}

fn handle_agent_events_sse(mut stream: TcpStream, req: &HttpRequest) {
    if let Err(error) = ensure_authorized(req) {
        let _ = write_http_json(&mut stream, 401, &serde_json::json!({ "error": error }));
        return;
    }
    let session_id = req
        .query
        .get("sessionId")
        .map(String::as_str)
        .unwrap_or("")
        .trim();
    let run_id = req
        .query
        .get("runId")
        .map(String::as_str)
        .unwrap_or("")
        .trim();
    if session_id.is_empty() || run_id.is_empty() {
        let _ = write_http_json(
            &mut stream,
            400,
            &serde_json::json!({ "error": "sessionId and runId are required" }),
        );
        return;
    }
    if let Err(error) = write_sse_headers(&mut stream) {
        eprintln!("[control] Pi agent SSE headers failed: {error}");
        return;
    }
    let receiver: AgentEventReceiver =
        PiAgentService::global().subscribe_events(session_id, run_id);
    let _ = write_sse_event(
        &mut stream,
        "ready",
        &serde_json::json!({
            "sessionId": session_id,
            "runId": run_id,
            "mode": "pi-in-process"
        }),
    );

    loop {
        match receiver.recv_timeout(Duration::from_secs(20)) {
            Ok(event) => {
                let terminal = matches!(
                    event.event,
                    AgentEvent::RunCompleted
                        | AgentEvent::RunFailed { .. }
                        | AgentEvent::SessionStatusChanged {
                            status: super::pi_agent::AgentSessionStatus::Idle
                                | super::pi_agent::AgentSessionStatus::Aborted
                                | super::pi_agent::AgentSessionStatus::Failed,
                            ..
                        }
                );
                let payload = serde_json::to_value(&event)
                    .unwrap_or_else(|error| serde_json::json!({ "error": error.to_string() }));
                if write_sse_event(&mut stream, "agent", &payload).is_err() {
                    break;
                }
                if terminal {
                    let _ = write_sse_event(
                        &mut stream,
                        "end",
                        &serde_json::json!({ "runId": run_id }),
                    );
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if write_sse_event(
                    &mut stream,
                    "heartbeat",
                    &serde_json::json!({ "ts": now_unix_secs() }),
                )
                .is_err()
                {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                let _ = write_sse_event(
                    &mut stream,
                    "end",
                    &serde_json::json!({ "reason": "disconnected" }),
                );
                break;
            }
        }
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
                "agentRuntime": PiAgentService::global().runtime_info(),
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
    let is_desktop_rpc = req.method == "POST" && req.path == "/api/v1/desktop/rpc";
    if !settings.enabled && !is_desktop_rpc {
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

    // Pi is the new in-process Agent API. Keep this route provider-neutral:
    // clients must not depend on Pi SDK or legacy runtime wire types.
    if req.method == "GET" && req.path == "/api/v1/agent/runtime" {
        return (
            200,
            serde_json::to_value(PiAgentService::global().runtime_info())
                .unwrap_or_else(|error| serde_json::json!({ "error": error.to_string() })),
        );
    }

    if req.method == "POST" && req.path == "/api/v1/agent/session" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let request: PiControlCreateSessionRequest = match serde_json::from_value(raw) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
        };
        let repo_path = request.repo_path.trim().to_string();
        if repo_path.is_empty() {
            return (400, serde_json::json!({ "error": "repoPath is required" }));
        }
        let session_dir = request
            .session_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| pi_session_dir(repo_path.as_str()));
        if let Err(error) = fs::create_dir_all(&session_dir) {
            return (
                500,
                serde_json::json!({ "error": format!("create Pi session directory failed: {error}") }),
            );
        }
        let config = PiSessionConfig {
            repo_path: PathBuf::from(repo_path),
            session_dir,
            session_path: request.session_path.map(PathBuf::from),
            provider: request.provider,
            model: request.model,
            api_key: request.api_key,
            system_prompt: request.system_prompt,
            append_system_prompt: request.append_system_prompt,
            enabled_tools: request.enabled_tools,
            extension_paths: request
                .extension_paths
                .unwrap_or_default()
                .into_iter()
                .map(PathBuf::from)
                .collect(),
            no_session: request.no_session.unwrap_or(false),
            thinking: None,
            max_tool_iterations: request.max_tool_iterations,
        };
        return match block_on(PiAgentService::global().create_session(config)) {
            Ok(summary) => serde_json::to_value(summary)
                .map(|value| (201, value))
                .unwrap_or_else(|error| (500, serde_json::json!({ "error": error.to_string() }))),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/agent/session" {
        if let Some(session_id) = req
            .query
            .get("sessionId")
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return match block_on(PiAgentService::global().session_summary(session_id)) {
                Ok(session) => serde_json::to_value(session)
                    .map(|value| (200, value))
                    .unwrap_or_else(|error| {
                        (500, serde_json::json!({ "error": error.to_string() }))
                    }),
                Err(error) => pi_error_response(error),
            };
        }
        return match block_on(PiAgentService::global().list_sessions()) {
            Ok(sessions) => serde_json::to_value(sessions)
                .map(|value| (200, value))
                .unwrap_or_else(|error| (500, serde_json::json!({ "error": error.to_string() }))),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "DELETE" && req.path == "/api/v1/agent/session" {
        let session_id = req
            .query
            .get("sessionId")
            .map(String::as_str)
            .unwrap_or("")
            .trim();
        if session_id.is_empty() {
            return (400, serde_json::json!({ "error": "sessionId is required" }));
        }
        return match PiAgentService::global().delete_session(session_id) {
            Ok(deleted) => (200, serde_json::json!({ "deleted": deleted })),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/agent/messages" {
        let session_id = req
            .query
            .get("sessionId")
            .map(String::as_str)
            .unwrap_or("")
            .trim();
        if session_id.is_empty() {
            return (400, serde_json::json!({ "error": "sessionId is required" }));
        }
        return match block_on(PiAgentService::global().messages(session_id)) {
            Ok(messages) => serde_json::to_value(messages)
                .map(|value| (200, value))
                .unwrap_or_else(|error| (500, serde_json::json!({ "error": error.to_string() }))),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/prompt" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let request: PiControlPromptRequest = match serde_json::from_value(raw) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
        };
        if request.session_id.trim().is_empty()
            || (request.prompt.trim().is_empty() && request.images.is_empty())
        {
            return (
                400,
                serde_json::json!({ "error": "sessionId and prompt or images are required" }),
            );
        }
        let run_id = request
            .run_id
            .unwrap_or_else(|| format!("control-{}-{}", request.session_id, now_unix_secs()));
        let events: Arc<Mutex<Vec<AgentEventEnvelope>>> = Arc::new(Mutex::new(Vec::new()));
        let events_for_sink = Arc::clone(&events);
        let sink: AgentEventSink = Arc::new(move |event| {
            if let Ok(mut events) = events_for_sink.lock() {
                events.push(event);
            }
        });
        let result = block_on(PiAgentService::global().prompt(
            request.session_id.as_str(),
            run_id.as_str(),
            request.prompt,
            request.images,
            sink,
        ));
        return match result {
            Ok(message) => {
                let events = events.lock().map(|items| items.clone()).unwrap_or_default();
                (
                    200,
                    serde_json::json!({
                        "runId": run_id,
                        "message": message,
                        "events": events,
                    }),
                )
            }
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/abort" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let run_id = raw
            .get("runId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if run_id.is_empty() {
            return (400, serde_json::json!({ "error": "runId is required" }));
        }
        return (
            200,
            serde_json::json!({ "ok": PiAgentService::global().abort(run_id) }),
        );
    }

    if req.method == "GET" && req.path == "/api/v1/agent/providers" {
        return match PiAgentService::global().list_providers() {
            Ok(providers) => serde_json::to_value(providers)
                .map(|value| (200, value))
                .unwrap_or_else(|error| (500, serde_json::json!({ "error": error.to_string() }))),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/provider" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let request: CustomProviderInput = match serde_json::from_value(raw) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
        };
        return match PiAgentService::global().save_custom_provider(&request) {
            Ok(()) => (200, serde_json::json!({ "ok": true })),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "DELETE" && req.path == "/api/v1/agent/provider" {
        let provider = req
            .query
            .get("provider")
            .map(String::as_str)
            .unwrap_or("")
            .trim();
        if provider.is_empty() {
            return (400, serde_json::json!({ "error": "provider is required" }));
        }
        return match PiAgentService::global().remove_custom_provider(provider) {
            Ok(removed) => (200, serde_json::json!({ "removed": removed })),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/provider/openai-compatible" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let base_url = raw
            .get("baseUrl")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let api_key = raw
            .get("apiKey")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let name = raw
            .get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let provider = raw
            .get("provider")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if base_url.is_empty() || api_key.is_empty() || name.is_empty() {
            return (
                400,
                serde_json::json!({ "error": "name, baseUrl and apiKey are required" }),
            );
        }
        return match PiAgentService::global().connect_openai_compatible(
            &base_url,
            &api_key,
            &name,
            provider.as_deref(),
        ) {
            Ok((provider_id, added)) => (
                200,
                serde_json::json!({ "provider": provider_id, "name": name, "added": added }),
            ),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/provider/endpoint" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let provider = raw
            .get("provider")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let base_url = raw
            .get("baseUrl")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let api = raw
            .get("api")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if provider.is_empty() || base_url.is_empty() {
            return (
                400,
                serde_json::json!({ "error": "provider and baseUrl are required" }),
            );
        }
        return match PiAgentService::global().update_provider_endpoint(
            &provider,
            &base_url,
            api.as_deref(),
        ) {
            Ok(()) => (200, serde_json::json!({ "ok": true })),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/provider/refresh" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let provider = raw
            .get("provider")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if provider.is_empty() {
            return (400, serde_json::json!({ "error": "provider is required" }));
        }
        return match PiAgentService::global().refresh_provider_models(&provider) {
            Ok(added) => (200, serde_json::json!({ "added": added })),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "GET" && req.path == "/api/v1/agent/models" {
        return match PiAgentService::global().list_models() {
            Ok(models) => serde_json::to_value(models)
                .map(|value| (200, value))
                .unwrap_or_else(|error| (500, serde_json::json!({ "error": error.to_string() }))),
            Err(error) => pi_error_response(error),
        };
    }

    if req.path == "/api/v1/agent/credential" {
        let provider = req
            .query
            .get("provider")
            .map(String::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        match req.method.as_str() {
            "GET" => {
                if provider.is_empty() {
                    return (400, serde_json::json!({ "error": "provider is required" }));
                }
                // 只返回布尔标注，凭据内容永远不出 vault。
                return (
                    200,
                    serde_json::json!({
                        "provider": provider,
                        "hasCredential": PiAgentService::global().has_credential(&provider),
                    }),
                );
            }
            "POST" => {
                let raw = match parse_body_json(&req) {
                    Ok(value) => value,
                    Err(error) => return (400, serde_json::json!({ "error": error })),
                };
                let request: PiControlCredentialRequest = match serde_json::from_value(raw) {
                    Ok(value) => value,
                    Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
                };
                let body_provider = request.provider.trim().to_string();
                let provider = if body_provider.is_empty() {
                    provider
                } else {
                    body_provider
                };
                let api_key = request.api_key.unwrap_or_default();
                if provider.is_empty() || api_key.trim().is_empty() {
                    return (
                        400,
                        serde_json::json!({ "error": "provider and apiKey are required" }),
                    );
                }
                return match PiAgentService::global().save_api_key(&provider, &api_key) {
                    Ok(()) => (200, serde_json::json!({ "ok": true })),
                    Err(error) => pi_error_response(error),
                };
            }
            "DELETE" => {
                if provider.is_empty() {
                    return (400, serde_json::json!({ "error": "provider is required" }));
                }
                return match PiAgentService::global().remove_api_key(&provider) {
                    Ok(removed) => (200, serde_json::json!({ "removed": removed })),
                    Err(error) => pi_error_response(error),
                };
            }
            _ => {}
        }
    }

    if req.method == "POST" && req.path == "/api/v1/agent/model" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let request: PiControlSetModelRequest = match serde_json::from_value(raw) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
        };
        if request.session_id.trim().is_empty()
            || request.provider.trim().is_empty()
            || request.model_id.trim().is_empty()
        {
            return (
                400,
                serde_json::json!({ "error": "sessionId, provider and modelId are required" }),
            );
        }
        return match block_on(PiAgentService::global().set_model(
            request.session_id.as_str(),
            request.provider.as_str(),
            request.model_id.as_str(),
        )) {
            Ok(summary) => serde_json::to_value(summary)
                .map(|value| (200, value))
                .unwrap_or_else(|error| (500, serde_json::json!({ "error": error.to_string() }))),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/thinking" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let request: PiControlSetThinkingRequest = match serde_json::from_value(raw) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
        };
        if request.session_id.trim().is_empty() || request.level.trim().is_empty() {
            return (
                400,
                serde_json::json!({ "error": "sessionId and level are required" }),
            );
        }
        return match block_on(PiAgentService::global().set_thinking_level(
            request.session_id.as_str(),
            request.level.as_str(),
        )) {
            Ok(()) => (200, serde_json::json!({ "ok": true })),
            Err(error) => pi_error_response(error),
        };
    }

    // PR6：审批/提问交互。pending 只含脱敏输入，回复走首响应胜出语义。
    if req.method == "GET" && req.path == "/api/v1/agent/interactions" {
        let session_id = req
            .query
            .get("sessionId")
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let interactions = PiAgentService::global().list_interactions(session_id);
        return serde_json::to_value(interactions)
            .map(|value| (200, value))
            .unwrap_or_else(|error| (500, serde_json::json!({ "error": error.to_string() })));
    }

    if req.method == "POST" && req.path == "/api/v1/agent/interaction/reply" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let request: PiControlInteractionReplyRequest = match serde_json::from_value(raw) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
        };
        if request.interaction_id.trim().is_empty() {
            return (
                400,
                serde_json::json!({ "error": "interactionId is required" }),
            );
        }
        return match PiAgentService::global()
            .reply_interaction(&request.interaction_id, request.reply)
        {
            Ok(()) => (200, serde_json::json!({ "ok": true })),
            Err(error) => pi_error_response(error),
        };
    }

    if req.method == "POST" && req.path == "/api/v1/agent/auto-approve" {
        let raw = match parse_body_json(&req) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error })),
        };
        let request: PiControlAutoApproveRequest = match serde_json::from_value(raw) {
            Ok(value) => value,
            Err(error) => return (400, serde_json::json!({ "error": error.to_string() })),
        };
        if request.session_id.trim().is_empty() {
            return (400, serde_json::json!({ "error": "sessionId is required" }));
        }
        return match block_on(PiAgentService::global().set_auto_approve(
            request.session_id.as_str(),
            request.enabled,
        )) {
            Ok(()) => (200, serde_json::json!({ "ok": true })),
            Err(error) => pi_error_response(error),
        };
    }

    // OpenCode HTTP API 已下线；手机端请改用 /api/v1/agent/**（后续重构）。
    if req.path == "/api/v1/opencode"
        || req.path.starts_with("/api/v1/opencode/")
    {
        return (
            410,
            serde_json::json!({
                "error": "OpenCode API removed. Use /api/v1/agent/** instead.",
                "code": "opencode_removed"
            }),
        );
    }

    if req.method == "GET" && req.path == "/api/v1/repository/list" {
        return match read_client_repositories() {
            Ok(rows) => (200, Value::Array(rows)),
            Err(e) => (500, serde_json::json!({ "error": e })),
        };
    }

    // Desktop RPC endpoint (used by giteam web)
    if req.method == "POST" && req.path == "/api/v1/desktop/rpc" {
        let raw = match parse_body_json(&req) {
            Ok(v) => v,
            Err(e) => return (400, serde_json::json!({ "error": e })),
        };
        let command = raw.get("command").and_then(|v| v.as_str()).unwrap_or("");
        let args = raw
            .get("args")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let args_summary = summarize_desktop_rpc_args(&args);
        return match desktop_rpc::handle_desktop_rpc(command, args) {
            Ok(v) => (200, v),
            Err(e) => {
                eprintln!(
                    "[desktop-rpc] command failed command={} args={} error={}",
                    command, args_summary, e
                );
                (500, serde_json::json!({ "error": e }))
            }
        };
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
            // Try static file serving first (for giteam web)
            if serve_static_file(&mut stream, &req) {
                return;
            }
            if req.method == "GET" && req.path == "/api/v1/opencode/stream" {
                let body = serde_json::json!({
                    "error": "OpenCode stream removed. Use /api/v1/agent/stream instead.",
                    "code": "opencode_removed"
                });
                let _ = write_http_json(&mut stream, 410, &body);
                return;
            }
            if req.method == "GET" && req.path == "/api/v1/agent/stream" {
                handle_agent_events_sse(stream, &req);
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

pub fn set_web_static_dir(dir: Option<PathBuf>) {
    if let Ok(mut guard) = web_static_dir_cell().lock() {
        *guard = dir;
    }
}

pub fn is_web_static_mode() -> bool {
    web_static_dir_cell()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

pub fn start_control_server_with_settings(settings: ControlServerSettings) -> Result<(), String> {
    let settings = normalize_control_server_settings(settings)?;
    if !settings.enabled {
        stop_control_server();
        return Ok(());
    }
    if let Ok(mut guard) = runtime_cell().lock() {
        if let Some(current) = guard.as_ref() {
            if current.settings.host == settings.host
                && current.settings.port == settings.port
                && current.settings.enabled == settings.enabled
                && current.settings.public_base_url == settings.public_base_url
                && current.settings.pair_code_ttl_mode == settings.pair_code_ttl_mode
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

pub fn start_control_server() -> Result<(), String> {
    start_control_server_with_settings(read_control_server_settings())
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn get_control_server_settings() -> Result<ControlServerSettings, String> {
    Ok(read_control_server_settings())
}

pub fn persist_control_server_settings(
    settings: ControlServerSettings,
) -> Result<ControlServerSettings, String> {
    let next = normalize_control_server_settings(settings.clone())?;
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
    let settings = effective_control_server_settings();
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

use super::control;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use wait_timeout::ChildExt;

const SERVICE_BOOT_TIMEOUT_MS: u64 = 6000;
const HTTP_TIMEOUT_MS: u64 = 1500;

#[derive(Debug)]
struct GiteamCliRuntime {
    child: Child,
}

static GITEAM_RUNTIME: OnceLock<Mutex<Option<GiteamCliRuntime>>> = OnceLock::new();
static GITEAM_START_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn runtime_cell() -> &'static Mutex<Option<GiteamCliRuntime>> {
    GITEAM_RUNTIME.get_or_init(|| Mutex::new(None))
}

fn start_lock() -> &'static Mutex<()> {
    GITEAM_START_LOCK.get_or_init(|| Mutex::new(()))
}

fn build_path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();
    let extras = [
        format!("{home}/.local/bin"),
        format!("{home}/.npm-global/bin"),
        format!("{home}/.cargo/bin"),
        format!("{home}/miniconda3/bin"),
        format!("{home}/anaconda3/bin"),
        format!("{home}/.pyenv/shims"),
        "/opt/homebrew/Caskroom/miniconda/base/bin".to_string(),
        "/opt/homebrew/Caskroom/miniconda3/base/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    for dir in extras {
        if !dir.is_empty() && !dirs.iter().any(|d| d == &dir) {
            dirs.push(dir);
        }
    }
    dirs.join(":")
}

fn build_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    for dir in build_path_env().split(':').filter(|s| !s.trim().is_empty()) {
        let path = PathBuf::from(dir);
        if !paths.iter().any(|item| item == &path) {
            paths.push(path);
        }
    }
    paths
}

fn resolve_giteam_binary() -> Result<PathBuf, String> {
    for dir in build_search_paths() {
        let candidate = dir.join("giteam");
        if candidate.is_file() {
            let lossy = candidate.to_string_lossy();
            if lossy.contains("node_modules/.bin") {
                continue;
            }
            return Ok(candidate);
        }
    }
    Err("giteam CLI is not installed or not on PATH".to_string())
}

fn service_addr(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

fn service_is_reachable(port: u16) -> bool {
    TcpStream::connect_timeout(&service_addr(port), Duration::from_millis(HTTP_TIMEOUT_MS)).is_ok()
}

fn wait_for_service_port(port: u16) -> Result<(), String> {
    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < u128::from(SERVICE_BOOT_TIMEOUT_MS) {
        if service_is_reachable(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err(format!(
        "giteam CLI service did not become reachable on port {port}"
    ))
}

fn http_json(method: &str, port: u16, path: &str, body: Option<&str>) -> Result<Value, String> {
    let mut stream =
        TcpStream::connect_timeout(&service_addr(port), Duration::from_millis(HTTP_TIMEOUT_MS))
            .map_err(|e| format!("connect local control api failed: {e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(HTTP_TIMEOUT_MS)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(HTTP_TIMEOUT_MS)));
    let payload = body.unwrap_or("");
    let mut req =
        format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n");
    if !payload.is_empty() {
        req.push_str("Content-Type: application/json\r\n");
        req.push_str(&format!("Content-Length: {}\r\n", payload.len()));
    }
    req.push_str("\r\n");
    req.push_str(payload);
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write local control api failed: {e}"))?;
    let mut raw = String::new();
    stream
        .read_to_string(&mut raw)
        .map_err(|e| format!("read local control api failed: {e}"))?;
    let (head, body_text) = raw
        .split_once("\r\n\r\n")
        .ok_or_else(|| "invalid local control api response".to_string())?;
    let status_line = head.lines().next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(500);
    let json = if body_text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(body_text)
            .map_err(|e| format!("invalid local control api json: {e}"))?
    };
    if (200..300).contains(&status) {
        Ok(json)
    } else {
        let message = json
            .get("error")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("HTTP {status}"));
        Err(message)
    }
}

fn current_pair_from_service(port: u16) -> Result<control::ControlPairCodeInfo, String> {
    let value = http_json("GET", port, "/api/v1/pair/current", None)?;
    serde_json::from_value(value).map_err(|e| format!("invalid pair.current payload: {e}"))
}

fn refresh_pair_from_service(port: u16) -> Result<control::ControlPairCodeInfo, String> {
    let value = http_json("POST", port, "/api/v1/pair/request", Some("{}"))?;
    serde_json::from_value(value).map_err(|e| format!("invalid pair.request payload: {e}"))
}

fn put_settings_to_service(
    port: u16,
    settings: &control::ControlServerSettings,
) -> Result<control::ControlServerSettings, String> {
    let body = serde_json::to_string(settings)
        .map_err(|e| format!("serialize control settings failed: {e}"))?;
    let value = http_json(
        "PUT",
        port,
        "/api/v1/admin/control/settings",
        Some(body.as_str()),
    )?;
    serde_json::from_value(value)
        .map_err(|e| format!("invalid admin control settings payload: {e}"))
}

fn access_info_from_service(port: u16) -> Result<control::ControlAccessInfo, String> {
    let value = http_json("GET", port, "/api/v1/admin/control/access-info", None)?;
    serde_json::from_value(value).map_err(|e| format!("invalid admin control access payload: {e}"))
}

fn cli_installed() -> bool {
    resolve_giteam_binary().is_ok()
}

fn require_cli_installed() -> Result<(), String> {
    if cli_installed() {
        Ok(())
    } else {
        Err("giteam CLI is not installed. Install the giteam plugin first.".to_string())
    }
}

fn run_giteam_cli(args: &[&str]) -> Result<String, String> {
    let binary = resolve_giteam_binary()?;
    let output = Command::new(binary)
        .args(args)
        .env("PATH", build_path_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("failed to run giteam CLI: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        Err(stderr)
    } else if !stdout.is_empty() {
        Err(stdout)
    } else {
        Err(format!("giteam CLI exited with status {}", output.status))
    }
}

fn load_cli_bootstrap_settings() -> Result<control::ControlServerSettings, String> {
    require_cli_installed()?;
    control::get_control_server_settings()
}

fn sync_cli_bootstrap_settings() -> Result<control::ControlServerSettings, String> {
    let settings = load_cli_bootstrap_settings()?;
    let running = service_is_reachable(settings.port);
    if settings.enabled == running {
        return Ok(settings);
    }
    let mut synced = settings;
    synced.enabled = running;
    control::persist_control_server_settings(synced.clone())
}

fn stop_managed_giteam_service() {
    if let Ok(mut guard) = runtime_cell().lock() {
        if let Some(mut runtime) = guard.take() {
            let _ = runtime.child.kill();
            let _ = runtime.child.wait_timeout(Duration::from_secs(1));
        }
    }
}

fn start_managed_giteam_service() -> Result<(), String> {
    let settings = load_cli_bootstrap_settings()?;
    if !settings.enabled {
        stop_managed_giteam_service();
        control::stop_control_server();
        return Ok(());
    }
    if service_is_reachable(settings.port) {
        return Ok(());
    }
    let binary = resolve_giteam_binary()?;
    stop_managed_giteam_service();
    control::stop_control_server();
    let child = Command::new(binary)
        .arg("serve")
        .env("PATH", build_path_env())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to spawn giteam CLI service: {e}"))?;
    if let Ok(mut guard) = runtime_cell().lock() {
        *guard = Some(GiteamCliRuntime { child });
    }
    if let Err(e) = wait_for_service_port(settings.port) {
        stop_managed_giteam_service();
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn giteam_cli_get_settings() -> Result<control::ControlServerSettings, String> {
    sync_cli_bootstrap_settings()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiteamMobileServiceStatus {
    pub cli_installed: bool,
    pub enabled: bool,
    pub port: u16,
    pub running: bool,
}

/// Fast status for UI: never starts the service.
#[tauri::command]
pub fn giteam_cli_get_mobile_service_status() -> Result<GiteamMobileServiceStatus, String> {
    let installed = cli_installed();
    if !installed {
        return Ok(GiteamMobileServiceStatus {
            cli_installed: false,
            enabled: false,
            port: 0,
            running: false,
        });
    }
    let settings = sync_cli_bootstrap_settings()?;
    let running = service_is_reachable(settings.port);
    Ok(GiteamMobileServiceStatus {
        cli_installed: true,
        enabled: settings.enabled,
        port: settings.port,
        running,
    })
}

/// Start service in background (never blocks the UI thread).
#[tauri::command]
pub fn giteam_cli_start_mobile_service_background() -> Result<(), String> {
    require_cli_installed()?;
    let settings = load_cli_bootstrap_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if service_is_reachable(settings.port) {
        return Ok(());
    }
    std::thread::spawn(move || {
        let _guard = start_lock().lock();
        let _ = start_managed_giteam_service();
    });
    Ok(())
}

#[tauri::command]
pub fn giteam_cli_set_settings(
    settings: control::ControlServerSettings,
) -> Result<control::ControlServerSettings, String> {
    let previous = load_cli_bootstrap_settings()?;
    let saved = control::persist_control_server_settings(settings)?;
    if previous.enabled && service_is_reachable(previous.port) {
        if saved.enabled {
            let applied = put_settings_to_service(previous.port, &saved)?;
            wait_for_service_port(applied.port)?;
            return Ok(applied);
        }

        let _ = run_giteam_cli(&["stop"]);
        stop_managed_giteam_service();
        control::stop_control_server();
        return Ok(saved);
    }
    if saved.enabled {
        start_managed_giteam_service()?;
    } else {
        stop_managed_giteam_service();
        control::stop_control_server();
    }
    Ok(saved)
}

#[tauri::command]
pub fn giteam_cli_get_pair_code() -> Result<control::ControlPairCodeInfo, String> {
    let settings = load_cli_bootstrap_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if !service_is_reachable(settings.port) {
        return Err("giteam mobile control service is starting".to_string());
    }
    current_pair_from_service(settings.port)
}

#[tauri::command]
pub fn giteam_cli_refresh_pair_code() -> Result<control::ControlPairCodeInfo, String> {
    let settings = load_cli_bootstrap_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if !service_is_reachable(settings.port) {
        return Err("giteam mobile control service is starting".to_string());
    }
    refresh_pair_from_service(settings.port)
}

#[tauri::command]
pub fn giteam_cli_get_access_info() -> Result<control::ControlAccessInfo, String> {
    let settings = load_cli_bootstrap_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if !service_is_reachable(settings.port) {
        return Err("giteam mobile control service is starting".to_string());
    }
    access_info_from_service(settings.port)
}

pub fn start_managed_mobile_service() {
    if cli_installed() {
        let _ = sync_cli_bootstrap_settings();
    }
}

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
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    let mut extras: Vec<PathBuf> = Vec::new();
    if !home.is_empty() {
        let home_path = PathBuf::from(&home);
        extras.extend([
            home_path.join(".local").join("bin"),
            home_path.join(".npm-global").join("bin"),
            home_path.join(".cargo").join("bin"),
            home_path.join("miniconda3").join("bin"),
            home_path.join("anaconda3").join("bin"),
            home_path.join(".pyenv").join("shims"),
        ]);
    }
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            extras.push(PathBuf::from(appdata).join("npm"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            extras.push(PathBuf::from(&local).join("npm"));
            extras.push(PathBuf::from(local).join("Programs").join("nodejs"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            extras.push(PathBuf::from(pf).join("nodejs"));
        }
    }
    #[cfg(not(windows))]
    {
        extras.extend([
            PathBuf::from("/opt/homebrew/Caskroom/miniconda/base/bin"),
            PathBuf::from("/opt/homebrew/Caskroom/miniconda3/base/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
    }
    for dir in extras {
        if !dir.as_os_str().is_empty() && !dirs.iter().any(|d| d == &dir) {
            dirs.push(dir);
        }
    }
    std::env::join_paths(dirs)
        .map(|os| os.to_string_lossy().into_owned())
        .unwrap_or_else(|_| std::env::var("PATH").unwrap_or_default())
}

fn build_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    for path in std::env::split_paths(std::ffi::OsStr::new(&build_path_env())) {
        if !paths.iter().any(|item| item == &path) {
            paths.push(path);
        }
    }
    paths
}

fn resolve_giteam_binary() -> Result<PathBuf, String> {
    #[cfg(windows)]
    const NAMES: &[&str] = &["giteam.exe", "giteam.cmd", "giteam.bat", "giteam"];
    #[cfg(not(windows))]
    const NAMES: &[&str] = &["giteam"];

    for dir in build_search_paths() {
        for name in NAMES {
            let candidate = dir.join(name);
            if !candidate.is_file() {
                continue;
            }
            let lossy = candidate.to_string_lossy();
            if lossy.contains("node_modules")
                && (lossy.contains(".bin") || lossy.contains("node_modules\\"))
            {
                continue;
            }
            return Ok(candidate);
        }
    }
    Err("giteam CLI is not installed or not on PATH".to_string())
}

/// npm 全局在 Windows 上常是 `.cmd` shim；`CreateProcess` 不能直接跑，需经 `cmd /C`。
#[cfg(windows)]
fn command_for_giteam(bin: &std::path::Path) -> Command {
    let ext = bin
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "cmd" || ext == "bat" {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(bin);
        cmd
    } else {
        Command::new(bin)
    }
}

#[cfg(not(windows))]
fn command_for_giteam(bin: &std::path::Path) -> Command {
    Command::new(bin)
}

fn service_addr(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

#[allow(dead_code)]
fn service_is_reachable(port: u16) -> bool {
    TcpStream::connect_timeout(&service_addr(port), Duration::from_millis(HTTP_TIMEOUT_MS)).is_ok()
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
fn current_pair_from_service(port: u16) -> Result<control::ControlPairCodeInfo, String> {
    let value = http_json("GET", port, "/api/v1/pair/current", None)?;
    serde_json::from_value(value).map_err(|e| format!("invalid pair.current payload: {e}"))
}

#[allow(dead_code)]
fn refresh_pair_from_service(port: u16) -> Result<control::ControlPairCodeInfo, String> {
    let value = http_json("POST", port, "/api/v1/pair/request", Some("{}"))?;
    serde_json::from_value(value).map_err(|e| format!("invalid pair.request payload: {e}"))
}

#[allow(dead_code)]
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

#[allow(dead_code)]
fn access_info_from_service(port: u16) -> Result<control::ControlAccessInfo, String> {
    let value = http_json("GET", port, "/api/v1/admin/control/access-info", None)?;
    serde_json::from_value(value).map_err(|e| format!("invalid admin control access payload: {e}"))
}

fn cli_installed() -> bool {
    resolve_giteam_binary().is_ok()
}

#[allow(dead_code)]
fn require_cli_installed() -> Result<(), String> {
    if cli_installed() {
        Ok(())
    } else {
        Err("giteam CLI is not installed. Install the giteam plugin first.".to_string())
    }
}

#[allow(dead_code)]
fn run_giteam_cli(args: &[&str]) -> Result<String, String> {
    let binary = resolve_giteam_binary()?;
    let mut cmd = command_for_giteam(&binary);
    cmd.args(args)
        .env("PATH", build_path_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = cmd
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

fn load_host_settings() -> Result<control::ControlServerSettings, String> {
    control::get_control_server_settings()
}

fn stop_managed_giteam_service() {
    if let Ok(mut guard) = runtime_cell().lock() {
        if let Some(mut runtime) = guard.take() {
            let _ = runtime.child.kill();
            let _ = runtime.child.wait_timeout(Duration::from_secs(1));
        }
    }
}

fn start_embedded_host(settings: control::ControlServerSettings) -> Result<u16, String> {
    // 不再依赖外部 giteam CLI；Desktop 进程内嵌同一套 Control。
    stop_managed_giteam_service();
    control::start_control_server_with_settings(settings)?;
    control::control_bound_port().ok_or_else(|| "control server failed to bind".to_string())
}

fn stop_embedded_host() {
    stop_managed_giteam_service();
    control::stop_control_server();
}

#[tauri::command]
pub fn giteam_cli_get_settings() -> Result<control::ControlServerSettings, String> {
    load_host_settings()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiteamMobileServiceStatus {
    /// CLI 仍可用于无头/doctor；手机 Host 不再依赖它。
    pub cli_installed: bool,
    pub enabled: bool,
    /// 设置中的偏好端口。
    pub port: u16,
    /// 本进程实际监听端口（未运行则为 0）。
    pub listening_port: u16,
    pub running: bool,
    /// preferred 被占用后发生了顺延。
    pub port_remapped: bool,
}

/// Fast status for UI: never starts the service.
#[tauri::command]
pub fn giteam_cli_get_mobile_service_status() -> Result<GiteamMobileServiceStatus, String> {
    let settings = load_host_settings()?;
    let bound = control::control_bound_port().unwrap_or(0);
    let running = control::control_is_running();
    Ok(GiteamMobileServiceStatus {
        cli_installed: cli_installed(),
        enabled: settings.enabled,
        port: settings.port,
        listening_port: bound,
        running,
        port_remapped: running && bound > 0 && bound != settings.port,
    })
}

/// Start embedded Host in background (never blocks the UI thread).
#[tauri::command]
pub fn giteam_cli_start_mobile_service_background() -> Result<(), String> {
    let settings = load_host_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if control::control_is_running() {
        return Ok(());
    }
    std::thread::spawn(move || {
        let _guard = start_lock().lock();
        let _ = start_embedded_host(settings);
    });
    Ok(())
}

#[tauri::command]
pub fn giteam_cli_set_settings(
    settings: control::ControlServerSettings,
) -> Result<control::ControlServerSettings, String> {
    let saved = control::persist_control_server_settings(settings)?;
    if saved.enabled {
        let _ = start_embedded_host(saved.clone())?;
    } else {
        stop_embedded_host();
    }
    Ok(saved)
}

#[tauri::command]
pub fn giteam_cli_get_pair_code() -> Result<control::ControlPairCodeInfo, String> {
    let settings = load_host_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if !control::control_is_running() {
        return Err("giteam mobile control service is starting".to_string());
    }
    control::get_control_pair_code()
}

#[tauri::command]
pub fn giteam_cli_refresh_pair_code() -> Result<control::ControlPairCodeInfo, String> {
    let settings = load_host_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if !control::control_is_running() {
        return Err("giteam mobile control service is starting".to_string());
    }
    control::refresh_control_pair_code()
}

#[tauri::command]
pub fn giteam_cli_get_access_info() -> Result<control::ControlAccessInfo, String> {
    let settings = load_host_settings()?;
    if !settings.enabled {
        return Err("giteam mobile control service is disabled".to_string());
    }
    if !control::control_is_running() {
        return Err("giteam mobile control service is starting".to_string());
    }
    control::get_control_access_info()
}

pub fn start_managed_mobile_service() {
    // Cloud tunnel 自动重连：桌面进程是 tunnel 归属方（owner=desktop）。
    ensure_desktop_tunnel_owner();
    if let Ok(cs) = load_host_settings() {
        if cs.enabled {
            let _ = start_embedded_host(cs);
        }
    }
    let cloud = giteam_core::cloud::get_cloud_link_settings();
    if cloud.enabled && !cloud.device_token.trim().is_empty() {
        let port = control::control_bound_port()
            .or_else(|| load_host_settings().ok().map(|s| s.port))
            .unwrap_or(0);
        if port > 0 {
            let _ = giteam_core::cloud::start_cloud_tunnel_background(port);
        }
    }
}

/// 桌面进程首次启动把空的 tunnel_owner 迁移为 "desktop"（这台机有桌面端 → 归桌面）。
fn ensure_desktop_tunnel_owner() {
    let mut settings = giteam_core::cloud::get_cloud_link_settings();
    if settings.tunnel_owner.trim().is_empty() {
        settings.tunnel_owner = "desktop".to_string();
        let _ = giteam_core::cloud::set_cloud_link_settings(&settings);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAccessKeyView {
    pub id: String,
    pub name: String,
    pub access_key: String,
    pub workspace_id: String,
    pub cloud_base_url: String,
    pub created_at_ms: i64,
    pub last_used_at_ms: i64,
    pub active: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudLinkStatusView {
    pub enabled: bool,
    pub cloud_base_url: String,
    pub workspace_id: String,
    pub device_id: String,
    pub device_name: String,
    pub access_key: String,
    pub key_name: String,
    pub tunnel_running: bool,
    /// True only after Gateway WebSocket handshake succeeds.
    pub tunnel_connected: bool,
    pub access_keys: Vec<CloudAccessKeyView>,
}

fn cloud_status_view() -> CloudLinkStatusView {
    let settings = giteam_core::cloud::get_cloud_link_settings();
    let active = settings.access_key.clone();
    let access_keys = settings
        .access_keys
        .iter()
        .map(|k| CloudAccessKeyView {
            id: k.id.clone(),
            name: k.name.clone(),
            access_key: k.access_key.clone(),
            workspace_id: k.workspace_id.clone(),
            cloud_base_url: k.cloud_base_url.clone(),
            created_at_ms: k.created_at_ms,
            last_used_at_ms: k.last_used_at_ms,
            active: k.access_key == active,
        })
        .collect();
    CloudLinkStatusView {
        enabled: settings.enabled,
        cloud_base_url: settings.cloud_base_url,
        workspace_id: settings.workspace_id,
        device_id: settings.device_id,
        device_name: settings.device_name,
        access_key: settings.access_key,
        key_name: settings.key_name,
        tunnel_running: giteam_core::cloud::tunnel_running(),
        tunnel_connected: giteam_core::cloud::tunnel_connected(),
        access_keys,
    }
}

#[tauri::command]
pub fn giteam_cloud_status() -> Result<CloudLinkStatusView, String> {
    Ok(cloud_status_view())
}

#[tauri::command]
pub fn giteam_cloud_link(
    url: Option<String>,
    access_key: Option<String>,
    name: Option<String>,
    force_new: Option<bool>,
    key_name: Option<String>,
) -> Result<CloudLinkStatusView, String> {
    let existing = giteam_core::cloud::get_cloud_link_settings();
    let base = url
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            let saved = existing.cloud_base_url.trim().to_string();
            if saved.is_empty() {
                None
            } else {
                Some(saved)
            }
        })
        .unwrap_or_else(|| giteam_core::cloud::DEFAULT_CLOUD_BASE_URL.to_string())
        .trim()
        .trim_end_matches('/')
        .to_string();
    let device_name = name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "giteam-desktop".to_string());
    let version = env!("CARGO_PKG_VERSION").to_string();
    let settings = giteam_core::cloud::link_device_with_opts(
        &base,
        &device_name,
        &version,
        access_key.as_deref(),
        giteam_core::cloud::LinkDeviceOptions {
            force_new: force_new.unwrap_or(false),
            key_name,
            tunnel_owner: Some("desktop".into()),
        },
    )?;
    let _ = settings;
    let port = control::control_bound_port()
        .or_else(|| control::get_control_server_settings().ok().map(|s| s.port))
        .unwrap_or(0);
    // Block until WS is up so create/switch returns with「中继已连接」.
    let ready = giteam_core::cloud::start_cloud_tunnel_and_wait(
        port,
        std::time::Duration::from_secs(6),
    )?;
    if !ready {
        eprintln!("[giteam-cloud] link finished but tunnel not ready within timeout");
    }
    Ok(cloud_status_view())
}

#[tauri::command]
pub fn giteam_cloud_unlink() -> Result<CloudLinkStatusView, String> {
    giteam_core::cloud::stop_cloud_tunnel();
    let mut settings = giteam_core::cloud::get_cloud_link_settings();
    settings.enabled = false;
    settings.device_token.clear();
    giteam_core::cloud::set_cloud_link_settings(&settings)?;
    Ok(cloud_status_view())
}

#[tauri::command]
pub fn giteam_cloud_forget_key(key_id: String) -> Result<CloudLinkStatusView, String> {
    let _ = giteam_core::cloud::forget_access_key_local(&key_id)?;
    Ok(cloud_status_view())
}

#[tauri::command]
pub fn giteam_cloud_rename_key(key_id: String, name: String) -> Result<CloudLinkStatusView, String> {
    let _ = giteam_core::cloud::rename_access_key_local(&key_id, &name)?;
    Ok(cloud_status_view())
}

#[tauri::command]
pub fn giteam_cloud_use_key(access_key: String) -> Result<CloudLinkStatusView, String> {
    let key = access_key.trim();
    if key.is_empty() {
        return Err("accessKey required".into());
    }
    let settings = giteam_core::cloud::get_cloud_link_settings();
    let record = settings.access_keys.iter().find(|k| k.access_key == key);
    let base = record
        .map(|k| k.cloud_base_url.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let saved = settings.cloud_base_url.trim().to_string();
            if saved.is_empty() {
                None
            } else {
                Some(saved)
            }
        })
        .unwrap_or_else(|| giteam_core::cloud::DEFAULT_CLOUD_BASE_URL.to_string());
    let name = record.map(|k| k.name.clone());
    let linked = giteam_core::cloud::link_device_with_opts(
        &base,
        if settings.device_name.trim().is_empty() {
            "giteam-desktop"
        } else {
            settings.device_name.as_str()
        },
        env!("CARGO_PKG_VERSION"),
        Some(key),
        giteam_core::cloud::LinkDeviceOptions {
            force_new: false,
            key_name: name,
            tunnel_owner: Some("desktop".into()),
        },
    )?;
    let _ = linked;
    let port = control::control_bound_port()
        .or_else(|| control::get_control_server_settings().ok().map(|s| s.port))
        .unwrap_or(0);
    let ready = giteam_core::cloud::start_cloud_tunnel_and_wait(
        port,
        std::time::Duration::from_secs(6),
    )?;
    if !ready {
        eprintln!("[giteam-cloud] use_key finished but tunnel not ready within timeout");
    }
    Ok(cloud_status_view())
}

#[tauri::command]
pub fn giteam_cloud_qr_payload() -> Result<serde_json::Value, String> {
    let settings = giteam_core::cloud::get_cloud_link_settings();
    if settings.access_key.is_empty() || settings.workspace_id.is_empty() {
        return Err("not linked; run cloud link first".into());
    }
    Ok(serde_json::json!({
        "mode": "cloud",
        "cloudBaseUrl": settings.cloud_base_url,
        "workspaceId": settings.workspace_id,
        "deviceId": settings.device_id,
        "accessKey": settings.access_key,
    }))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileClientView {
    pub jti: String,
    pub workspace_id: String,
    pub device_id: String,
    pub client_name: String,
    pub connected_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
}

#[tauri::command]
pub fn giteam_cloud_list_clients() -> Result<Vec<MobileClientView>, String> {
    let rows = giteam_core::cloud::list_mobile_clients()?;
    Ok(rows
        .into_iter()
        .map(|c| MobileClientView {
            jti: c.jti,
            workspace_id: c.workspace_id,
            device_id: c.device_id,
            client_name: c.client_name,
            connected_at: c.connected_at,
            last_seen_at: c.last_seen_at,
            expires_at: c.expires_at,
        })
        .collect())
}

#[tauri::command]
pub fn giteam_cloud_disconnect_client(jti: String) -> Result<bool, String> {
    giteam_core::cloud::disconnect_mobile_client(&jti)?;
    Ok(true)
}

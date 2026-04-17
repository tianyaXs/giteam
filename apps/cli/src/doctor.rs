use giteam_core::{command_runner, control, opencode};
use serde::Serialize;
use std::env;
use std::ffi::OsString;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const CONNECT_TIMEOUT_MS: u64 = 600;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub name: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortProbe {
    pub host: String,
    pub port: u16,
    pub reachable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmupStatus {
    pub attempted: bool,
    pub ready: bool,
    pub base_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub platform: String,
    pub arch: String,
    pub repo_path: Option<String>,
    pub control: DoctorControl,
    pub opencode: DoctorOpencode,
    pub binaries: Vec<BinaryStatus>,
    pub summary: DoctorSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorControl {
    pub settings: control::ControlServerSettings,
    pub access: control::ControlAccessInfo,
    pub local_probe: PortProbe,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorOpencode {
    pub settings: opencode::OpencodeServiceSettings,
    pub local_probe: PortProbe,
    pub warmup: WarmupStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorSummary {
    pub status: String,
    pub warnings: Vec<String>,
    pub failures: Vec<String>,
}

pub fn detect_default_repo_path() -> Option<String> {
    let cwd = env::current_dir().ok()?;
    let text = cwd.to_string_lossy().trim().to_string();
    if text.is_empty() {
        return None;
    }
    command_runner::validate_repo_path(&text).ok()?;
    Some(text)
}

pub fn build_report(repo_path: Option<String>, warmup: bool) -> Result<DoctorReport, String> {
    let repo_path = normalize_repo_path(repo_path)?;
    let control_settings = control::get_control_server_settings()?;
    let control_access = control::get_control_access_info()?;
    let opencode_settings = opencode::get_opencode_service_settings()?;

    let control_probe_host = if control_settings.host == "0.0.0.0" {
        "127.0.0.1".to_string()
    } else {
        control_settings.host.clone()
    };
    let control_probe = PortProbe {
        host: control_probe_host.clone(),
        port: control_settings.port,
        reachable: can_connect(&control_probe_host, control_settings.port),
    };

    let opencode_probe = PortProbe {
        host: "127.0.0.1".to_string(),
        port: opencode_settings.port,
        reachable: can_connect("127.0.0.1", opencode_settings.port),
    };

    let binaries = vec![
        detect_binary_status(
            "git",
            &["--version"],
            "install git and ensure it is on PATH",
        ),
        detect_binary_status(
            "cargo",
            &["--version"],
            "install Rust/Cargo for source fallback builds",
        ),
        detect_binary_status(
            "npm",
            &["--version"],
            "install Node.js/npm for npm-based installs",
        ),
        detect_binary_status(
            "opencode",
            &["--version"],
            "install opencode with brew or npm i -g opencode-ai",
        ),
    ];

    let warmup_status = build_warmup_status(repo_path.as_deref(), warmup);

    let mut warnings = Vec::new();
    let mut failures = Vec::new();

    if control_settings.enabled && !control_probe.reachable {
        warnings.push(format!(
            "control server is enabled but nothing is listening on {}:{}",
            control_probe.host, control_probe.port
        ));
    }
    if !control_settings.enabled {
        warnings.push("control server is disabled".to_string());
    }

    let opencode_binary = binaries
        .iter()
        .find(|item| item.name == "opencode")
        .map(|item| item.installed)
        .unwrap_or(false);
    if !opencode_binary {
        failures.push("opencode binary is missing".to_string());
    } else if !opencode_probe.reachable {
        warnings.push(format!(
            "opencode managed service is not listening on {}:{}",
            opencode_probe.host, opencode_probe.port
        ));
    }

    let cargo_binary = binaries
        .iter()
        .find(|item| item.name == "cargo")
        .map(|item| item.installed)
        .unwrap_or(false);
    if !cargo_binary {
        warnings.push("cargo is missing, source fallback install will be unavailable".to_string());
    }

    if warmup && repo_path.is_none() {
        warnings.push("warmup requested but no git repo path was available".to_string());
    }
    if warmup_status.attempted && !warmup_status.ready {
        failures.push(
            warmup_status
                .error
                .clone()
                .unwrap_or_else(|| "opencode warmup failed".to_string()),
        );
    }

    let status = if !failures.is_empty() {
        "fail"
    } else if !warnings.is_empty() {
        "warn"
    } else {
        "ok"
    }
    .to_string();

    Ok(DoctorReport {
        platform: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        repo_path,
        control: DoctorControl {
            settings: control_settings,
            access: control_access,
            local_probe: control_probe,
        },
        opencode: DoctorOpencode {
            settings: opencode_settings,
            local_probe: opencode_probe,
            warmup: warmup_status,
        },
        binaries,
        summary: DoctorSummary {
            status,
            warnings,
            failures,
        },
    })
}

pub fn render_human(report: &DoctorReport) -> String {
    let mut lines = Vec::new();
    lines.push(format!(
        "summary: {}",
        render_summary_label(report.summary.status.as_str())
    ));
    lines.push(format!("platform: {}/{}", report.platform, report.arch));
    lines.push(format!(
        "repo_path: {}",
        report.repo_path.as_deref().unwrap_or("(not set)")
    ));
    lines.push(String::new());

    lines.push("binaries:".to_string());
    for binary in &report.binaries {
        lines.push(format!(
            "  - {}: {}{}{}",
            binary.name,
            if binary.installed {
                "installed"
            } else {
                "missing"
            },
            binary
                .version
                .as_deref()
                .map(|v| format!(", version={v}"))
                .unwrap_or_default(),
            binary
                .path
                .as_deref()
                .map(|p| format!(", path={p}"))
                .unwrap_or_default()
        ));
    }
    lines.push(String::new());

    lines.push("control:".to_string());
    lines.push(format!(
        "  enabled: {}, host: {}, port: {}",
        report.control.settings.enabled, report.control.settings.host, report.control.settings.port
    ));
    lines.push(format!(
        "  public_base_url: {}",
        empty_as_placeholder(&report.control.settings.public_base_url)
    ));
    lines.push(format!(
        "  pair_code_ttl_mode: {}",
        report.control.settings.pair_code_ttl_mode
    ));
    lines.push(format!(
        "  local_probe: {}:{} -> {}",
        report.control.local_probe.host,
        report.control.local_probe.port,
        if report.control.local_probe.reachable {
            "reachable"
        } else {
            "not listening"
        }
    ));
    if report.control.access.local_urls.is_empty() {
        lines.push("  access_urls: (none)".to_string());
    } else {
        lines.push("  access_urls:".to_string());
        for url in &report.control.access.local_urls {
            lines.push(format!("    - {url}"));
        }
    }
    if !report.control.access.no_auth {
        lines.push(format!("  pair_code: {}", report.control.access.pair_code));
    }
    lines.push(String::new());

    lines.push("opencode:".to_string());
    lines.push(format!("  port: {}", report.opencode.settings.port));
    lines.push(format!(
        "  local_probe: {}:{} -> {}",
        report.opencode.local_probe.host,
        report.opencode.local_probe.port,
        if report.opencode.local_probe.reachable {
            "reachable"
        } else {
            "not listening"
        }
    ));
    if report.opencode.warmup.attempted {
        lines.push(format!(
            "  warmup: {}{}{}",
            if report.opencode.warmup.ready {
                "ready"
            } else {
                "failed"
            },
            report
                .opencode
                .warmup
                .base_url
                .as_deref()
                .map(|v| format!(", base_url={v}"))
                .unwrap_or_default(),
            report
                .opencode
                .warmup
                .error
                .as_deref()
                .map(|v| format!(", error={v}"))
                .unwrap_or_default()
        ));
    } else {
        lines.push("  warmup: skipped".to_string());
    }

    if !report.summary.warnings.is_empty() {
        lines.push(String::new());
        lines.push("warnings:".to_string());
        for warning in &report.summary.warnings {
            lines.push(format!("  - {warning}"));
        }
    }
    if !report.summary.failures.is_empty() {
        lines.push(String::new());
        lines.push("failures:".to_string());
        for failure in &report.summary.failures {
            lines.push(format!("  - {failure}"));
        }
    }

    lines.join("\n")
}

fn normalize_repo_path(repo_path: Option<String>) -> Result<Option<String>, String> {
    let Some(repo_path) = repo_path else {
        return Ok(detect_default_repo_path());
    };
    let normalized = repo_path.trim().to_string();
    if normalized.is_empty() {
        return Ok(None);
    }
    command_runner::validate_repo_path(&normalized)?;
    Ok(Some(normalized))
}

fn build_warmup_status(repo_path: Option<&str>, warmup: bool) -> WarmupStatus {
    if !warmup {
        return WarmupStatus {
            attempted: false,
            ready: false,
            base_url: None,
            error: None,
        };
    }
    let Some(repo_path) = repo_path else {
        return WarmupStatus {
            attempted: false,
            ready: false,
            base_url: None,
            error: Some("no repo path available for warmup".to_string()),
        };
    };
    match opencode::get_opencode_service_base(repo_path) {
        Ok(base_url) => WarmupStatus {
            attempted: true,
            ready: true,
            base_url: Some(base_url),
            error: None,
        },
        Err(err) => WarmupStatus {
            attempted: true,
            ready: false,
            base_url: None,
            error: Some(err),
        },
    }
}

fn detect_binary_status(name: &str, version_args: &[&str], hint: &str) -> BinaryStatus {
    let path = find_binary(name);
    let version = path
        .as_deref()
        .and_then(|path| read_version(path, version_args).ok())
        .filter(|text| !text.trim().is_empty());
    BinaryStatus {
        name: name.to_string(),
        installed: path.is_some(),
        path: path.map(|p| p.to_string_lossy().to_string()),
        version,
        hint: hint.to_string(),
    }
}

fn read_version(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new(path)
        .args(args)
        .output()
        .map_err(|e| format!("failed to start {}: {e}", path.display()))?;
    if !output.status.success() {
        return Err(format!(
            "{} failed with code {:?}",
            path.display(),
            output.status.code()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let first = stdout
        .lines()
        .chain(stderr.lines())
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(first)
}

fn build_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default();
    let home = env::var("HOME").unwrap_or_default();
    let extras: [OsString; 9] = [
        format!("{home}/.local/bin").into(),
        format!("{home}/miniconda3/bin").into(),
        format!("{home}/anaconda3/bin").into(),
        format!("{home}/.pyenv/shims").into(),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
    ];
    for extra in extras {
        let path = PathBuf::from(extra);
        if !path.as_os_str().is_empty() && !paths.iter().any(|item| item == &path) {
            paths.push(path);
        }
    }
    paths
}

fn find_binary(name: &str) -> Option<PathBuf> {
    for dir in build_search_paths() {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn can_connect(host: &str, port: u16) -> bool {
    let target = format!("{host}:{port}");
    let timeout = Duration::from_millis(CONNECT_TIMEOUT_MS);
    let Ok(addrs) = target.to_socket_addrs() else {
        return false;
    };
    for addr in addrs {
        if try_connect(addr, timeout) {
            return true;
        }
    }
    false
}

fn try_connect(addr: SocketAddr, timeout: Duration) -> bool {
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

fn empty_as_placeholder(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "(empty)"
    } else {
        trimmed
    }
}

fn render_summary_label(status: &str) -> &str {
    match status {
        "ok" => "ok",
        "warn" => "warn",
        "fail" => "fail",
        _ => "unknown",
    }
}

mod doctor;

use clap::{Args, Parser, Subcommand, ValueEnum};
use giteam_core::{control, opencode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::{self, IsTerminal, Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const HTTP_TIMEOUT_MS: u64 = 1500;
const START_TIMEOUT_MS: u64 = 8000;
const STOP_TIMEOUT_MS: u64 = 8000;

#[derive(Parser, Debug)]
#[command(name = "giteam")]
#[command(about = "Terminal giteam control service", version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    #[command(about = "Manage the mobile control service")]
    Service {
        #[command(subcommand)]
        command: ServiceCommands,
    },
    #[command(
        about = "Run control service in foreground",
        long_about = "Run the giteam mobile control service in the current terminal. Use this for local debugging, live logs, and Ctrl+C shutdown."
    )]
    #[command(hide = true)]
    Serve {
        #[arg(long, default_value_t = true)]
        warmup: bool,
        #[arg(long)]
        json: bool,
        #[arg(long, hide = true, default_value_t = false)]
        no_banner: bool,
    },
    #[command(
        about = "Start control service in background",
        long_about = "Start the giteam mobile control service in the background and return immediately. Use `giteam logs --follow` to inspect runtime output."
    )]
    #[command(hide = true)]
    Start {
        #[arg(long, default_value_t = true)]
        warmup: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(hide = true)]
    Stop {
        #[arg(long)]
        force: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(hide = true)]
    Restart {
        #[arg(long, default_value_t = true)]
        warmup: bool,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(hide = true)]
    Logs {
        #[arg(long, default_value_t = 80)]
        tail: usize,
        #[arg(long)]
        follow: bool,
    },
    #[command(hide = true)]
    Status {
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Check and optionally install required CLI dependencies")]
    Init {
        #[arg(long, help = "Install missing dependencies automatically")]
        install_missing: bool,
        #[arg(long, help = "Force the guided terminal experience")]
        interactive: bool,
        #[arg(
            long = "with",
            value_enum,
            value_delimiter = ',',
            help = "Only process selected plugins, e.g. --with git,opencode"
        )]
        with: Vec<PluginName>,
        #[arg(long)]
        json: bool,
    },
    Plugin {
        #[command(subcommand)]
        command: PluginCommands,
    },
    PairCode {
        #[arg(long)]
        refresh: bool,
        #[arg(long)]
        json: bool,
    },
    Config {
        #[command(subcommand)]
        command: ConfigCommands,
    },
    Doctor {
        #[arg(long)]
        repo_path: Option<String>,
        #[arg(long)]
        warmup: bool,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand, Debug)]
enum ServiceCommands {
    #[command(about = "Run service in foreground")]
    Serve {
        #[arg(long, default_value_t = true)]
        warmup: bool,
        #[arg(long)]
        json: bool,
        #[arg(long, hide = true, default_value_t = false)]
        no_banner: bool,
    },
    #[command(about = "Start service in background")]
    Start {
        #[arg(long, default_value_t = true)]
        warmup: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Stop background service")]
    Stop {
        #[arg(long)]
        force: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Restart background service")]
    Restart {
        #[arg(long, default_value_t = true)]
        warmup: bool,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Show service logs")]
    Logs {
        #[arg(long, default_value_t = 80)]
        tail: usize,
        #[arg(long)]
        follow: bool,
    },
    #[command(about = "Show current service status")]
    Status {
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Diagnose service state and suggest fixes")]
    Doctor {
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Install the service into the OS service manager")]
    Install,
    #[command(about = "Remove the service from the OS service manager")]
    Uninstall,
    #[command(about = "Enable automatic startup in the OS service manager")]
    Enable,
    #[command(about = "Disable automatic startup in the OS service manager")]
    Disable,
}

#[derive(Subcommand, Debug)]
enum ConfigCommands {
    Get {
        #[arg(long)]
        json: bool,
    },
    Set(ConfigSetArgs),
}

#[derive(Subcommand, Debug)]
enum PluginCommands {
    List {
        #[arg(long)]
        json: bool,
    },
    Check {
        name: PluginName,
        #[arg(long)]
        json: bool,
    },
    Install {
        name: PluginName,
    },
    Uninstall {
        name: PluginName,
    },
    Update {
        name: PluginName,
    },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, ValueEnum)]
enum PluginName {
    Git,
    Entire,
    Opencode,
    Giteam,
}

impl PluginName {
    fn as_str(self) -> &'static str {
        match self {
            Self::Git => "git",
            Self::Entire => "entire",
            Self::Opencode => "opencode",
            Self::Giteam => "giteam",
        }
    }
}

#[derive(Args, Debug)]
struct ConfigSetArgs {
    #[arg(long)]
    enabled: Option<bool>,
    #[arg(long)]
    host: Option<String>,
    #[arg(long)]
    port: Option<u16>,
    #[arg(long)]
    public_base_url: Option<String>,
    #[arg(long)]
    pair_code_ttl_mode: Option<String>,
    #[arg(long)]
    opencode_port: Option<u16>,
    #[arg(long)]
    repo_path: Option<String>,
    #[arg(long)]
    json: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigView {
    control: control::ControlServerSettings,
    opencode: opencode::OpencodeServiceSettings,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PidState {
    pid: u32,
    started_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeView {
    running: bool,
    pid: Option<u32>,
    pid_alive: bool,
    log_path: String,
    health: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusView {
    control: control::ControlAccessInfo,
    runtime: RuntimeView,
    manager: ServiceManagerStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartStopView {
    ok: bool,
    action: String,
    message: String,
    runtime: RuntimeView,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginStatus {
    name: String,
    checked: bool,
    installed: bool,
    path: Option<String>,
    version: Option<String>,
    install_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceManagerStatus {
    kind: String,
    supported: bool,
    installed: bool,
    loaded: bool,
    enabled: bool,
    label: String,
    definition_path: Option<String>,
    definition_exists: bool,
    definition_summary: Option<String>,
    definition_matches_cli: Option<bool>,
    expected_exec: Option<String>,
    recent_error: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitReport {
    ok: bool,
    install_missing: bool,
    plugins: Vec<PluginStatus>,
}

#[derive(Debug, Default)]
struct InitWizardOutcome {
    imported_repo: Option<String>,
    configured_model: Option<String>,
    service_action: Option<String>,
    project_step_done: bool,
    model_step_done: bool,
    model_step_note: Option<String>,
}

struct TerminalModeGuard {
    active: bool,
}

impl TerminalModeGuard {
    fn enter_raw() -> Self {
        let active = Command::new("stty")
            .args(["-icanon", "-echo", "min", "1", "time", "0"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        Self { active }
    }
}

impl Drop for TerminalModeGuard {
    fn drop(&mut self) {
        if self.active {
            let _ = Command::new("stty").arg("sane").status();
            let _ = Command::new("stty").arg("echo").status();
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ImportedProjectsRegistry {
    projects: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceDoctorIssue {
    level: String,
    code: String,
    message: String,
    suggestion: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceDoctorReport {
    ok: bool,
    control: control::ControlAccessInfo,
    runtime: RuntimeView,
    manager: ServiceManagerStatus,
    issues: Vec<ServiceDoctorIssue>,
}

struct PidFileGuard {
    pid: u32,
}

impl Drop for PidFileGuard {
    fn drop(&mut self) {
        clear_pid_file_if_matches(self.pid);
    }
}

fn print_json<T: Serialize>(value: &T) -> Result<(), String> {
    let text =
        serde_json::to_string_pretty(value).map_err(|e| format!("serialize json failed: {e}"))?;
    println!("{text}");
    Ok(())
}

fn service_label() -> &'static str {
    "com.giteam.control-service"
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn user_id() -> Result<String, String> {
    let output = Command::new("id")
        .arg("-u")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("resolve user id failed: {e}"))?;
    if !output.status.success() {
        return Err("resolve user id failed".to_string());
    }
    let uid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if uid.is_empty() {
        Err("resolve user id failed".to_string())
    } else {
        Ok(uid)
    }
}

fn launch_agents_dir() -> Result<PathBuf, String> {
    Ok(ensure_app_support_dir()?
        .parent()
        .ok_or_else(|| "resolve LaunchAgents dir failed".to_string())?
        .parent()
        .ok_or_else(|| "resolve LaunchAgents dir failed".to_string())?
        .join("LaunchAgents"))
}

fn launchd_plist_path() -> Result<PathBuf, String> {
    Ok(launch_agents_dir()?.join(format!("{}.plist", service_label())))
}

fn launchctl_domain() -> Result<String, String> {
    Ok(format!("gui/{}", user_id()?))
}

fn systemd_user_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("XDG_CONFIG_HOME") {
        let dir = dir.trim();
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir).join("systemd").join("user"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let home = home.trim();
        if !home.is_empty() {
            return Ok(PathBuf::from(home)
                .join(".config")
                .join("systemd")
                .join("user"));
        }
    }
    Err("resolve systemd user dir failed".to_string())
}

fn systemd_unit_path() -> Result<PathBuf, String> {
    Ok(systemd_user_dir()?.join(format!("{}.service", service_label())))
}

fn run_systemctl(args: &[&str]) -> Result<(bool, String, String), String> {
    let output = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("run systemctl failed: {e}"))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

fn run_launchctl(args: &[&str]) -> Result<(bool, String, String), String> {
    let output = Command::new("launchctl")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("run launchctl failed: {e}"))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}

fn read_text_if_exists(path: &PathBuf) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn current_exe_string() -> Option<String> {
    std::env::current_exe()
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

fn extract_launchd_exec(text: &str) -> Option<String> {
    let marker = "<key>ProgramArguments</key>";
    let start = text.find(marker)?;
    let rest = &text[start..];
    let s1 = rest.find("<string>")? + "<string>".len();
    let rest2 = &rest[s1..];
    let s2 = rest2.find("</string>")?;
    Some(rest2[..s2].to_string())
}

fn extract_systemd_exec(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.strip_prefix("ExecStart="))
        .and_then(|line| line.split_whitespace().next())
        .map(ToString::to_string)
}

fn summarize_definition(
    path: &PathBuf,
    kind: &str,
) -> (bool, Option<String>, Option<bool>, Option<String>) {
    let exists = path.is_file();
    if !exists {
        return (false, None, None, current_exe_string());
    }
    let Some(text) = read_text_if_exists(path) else {
        return (true, None, None, current_exe_string());
    };
    let expected = current_exe_string();
    let exec = match kind {
        "launchd" => extract_launchd_exec(&text),
        "systemd-user" => extract_systemd_exec(&text),
        _ => None,
    };
    let matches_cli = match (&exec, &expected) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };
    let summary = match kind {
        "launchd" => exec.map(|value| format!("ProgramArguments[0]={value}")),
        "systemd-user" => text
            .lines()
            .find(|line| line.starts_with("ExecStart=") || line.starts_with("WorkingDirectory="))
            .map(ToString::to_string),
        _ => None,
    };
    (true, summary, matches_cli, expected)
}

fn recent_log_error() -> Option<String> {
    let path = log_file_path().ok()?;
    let text = fs::read_to_string(path).ok()?;
    text.lines()
        .rev()
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            (lower.contains("error") || lower.contains("failed") || lower.contains("panic"))
                && !lower.contains("broken pipe")
                && !lower.contains("write response body failed")
        })
        .map(ToString::to_string)
}

fn launchd_status() -> Result<ServiceManagerStatus, String> {
    let plist_path = launchd_plist_path()?;
    let label = service_label().to_string();
    let definition_path = Some(plist_path.display().to_string());
    if cfg!(not(target_os = "macos")) {
        return Ok(ServiceManagerStatus {
            kind: "none".to_string(),
            supported: false,
            installed: false,
            loaded: false,
            enabled: false,
            label,
            definition_path,
            definition_exists: false,
            definition_summary: None,
            definition_matches_cli: None,
            expected_exec: current_exe_string(),
            recent_error: recent_log_error(),
            note: Some(
                "OS-managed service install is currently implemented for macOS launchd only"
                    .to_string(),
            ),
        });
    }

    let installed = plist_path.is_file();
    let (definition_exists, definition_summary, definition_matches_cli, expected_exec) =
        summarize_definition(&plist_path, "launchd");
    let domain = launchctl_domain()?;
    let target = format!("{}/{}", domain, service_label());
    let (loaded, _, _) = run_launchctl(&["print", target.as_str()])?;
    let (_, disabled_stdout, _) = run_launchctl(&["print-disabled", domain.as_str()])?;
    let enabled =
        installed && !disabled_stdout.contains(format!("\"{}\" => true", service_label()).as_str());
    Ok(ServiceManagerStatus {
        kind: "launchd".to_string(),
        supported: true,
        installed,
        loaded,
        enabled,
        label,
        definition_path,
        definition_exists,
        definition_summary,
        definition_matches_cli,
        expected_exec,
        recent_error: recent_log_error(),
        note: None,
    })
}

fn systemd_status() -> Result<ServiceManagerStatus, String> {
    let unit_path = systemd_unit_path()?;
    let label = format!("{}.service", service_label());
    let definition_path = Some(unit_path.display().to_string());
    if cfg!(not(target_os = "linux")) {
        return Ok(ServiceManagerStatus {
            kind: "none".to_string(),
            supported: false,
            installed: false,
            loaded: false,
            enabled: false,
            label,
            definition_path,
            definition_exists: false,
            definition_summary: None,
            definition_matches_cli: None,
            expected_exec: current_exe_string(),
            recent_error: recent_log_error(),
            note: Some(
                "OS-managed service install is currently implemented for macOS launchd and Linux systemd --user"
                    .to_string(),
            ),
        });
    }

    let installed = unit_path.is_file();
    let (definition_exists, definition_summary, definition_matches_cli, expected_exec) =
        summarize_definition(&unit_path, "systemd-user");
    let (loaded, _, _) = run_systemctl(&["status", service_label()])?;
    let (enabled_ok, enabled_stdout, enabled_stderr) =
        run_systemctl(&["is-enabled", service_label()])?;
    let enabled_text = if enabled_ok {
        enabled_stdout.trim()
    } else {
        enabled_stderr.trim()
    };
    let enabled = matches!(
        enabled_text,
        "enabled" | "static" | "indirect" | "generated" | "alias"
    );
    Ok(ServiceManagerStatus {
        kind: "systemd-user".to_string(),
        supported: true,
        installed,
        loaded,
        enabled,
        label,
        definition_path,
        definition_exists,
        definition_summary,
        definition_matches_cli,
        expected_exec,
        recent_error: recent_log_error(),
        note: None,
    })
}

fn service_manager_status() -> Result<ServiceManagerStatus, String> {
    if cfg!(target_os = "macos") {
        launchd_status()
    } else if cfg!(target_os = "linux") {
        systemd_status()
    } else {
        Ok(ServiceManagerStatus {
            kind: "none".to_string(),
            supported: false,
            installed: false,
            loaded: false,
            enabled: false,
            label: service_label().to_string(),
            definition_path: None,
            definition_exists: false,
            definition_summary: None,
            definition_matches_cli: None,
            expected_exec: current_exe_string(),
            recent_error: recent_log_error(),
            note: Some(
                "OS-managed service install is currently implemented for macOS launchd and Linux systemd --user"
                    .to_string(),
            ),
        })
    }
}

fn human_service_manager_state(status: &ServiceManagerStatus) -> String {
    if !status.supported {
        return format!("{} (unsupported)", status.kind);
    }
    format!(
        "{} (installed={}, loaded={}, enabled={})",
        status.kind, status.installed, status.loaded, status.enabled
    )
}

fn print_service_manager_summary(status: &ServiceManagerStatus) {
    println!("service manager: {}", human_service_manager_state(status));
    println!("label: {}", status.label);
    if let Some(path) = &status.definition_path {
        println!("definition: {}", path);
    }
    println!("definition_exists: {}", status.definition_exists);
    if let Some(matches) = status.definition_matches_cli {
        println!("definition_matches_cli: {}", matches);
    }
    if let Some(expected) = &status.expected_exec {
        println!("expected_exec: {}", expected);
    }
    if let Some(summary) = &status.definition_summary {
        println!("definition_summary: {}", summary);
    }
    if let Some(err) = &status.recent_error {
        println!("recent_error: {}", err);
    }
    if let Some(note) = &status.note {
        println!("note: {}", note);
    }
}

fn service_doctor_report() -> Result<ServiceDoctorReport, String> {
    let control = control::get_control_access_info()?;
    let runtime = runtime_view()?;
    let manager = service_manager_status()?;
    let mut issues = Vec::new();

    if !runtime.running && control.enabled {
        issues.push(ServiceDoctorIssue {
            level: "warning".to_string(),
            code: "SERVICE_STOPPED_BUT_ENABLED".to_string(),
            message: "control service is configured as enabled but is not currently running".to_string(),
            suggestion: Some("Run `giteam service start` for ad-hoc usage, or `giteam service enable` for OS-managed startup.".to_string()),
        });
    }

    if runtime.running && !control.enabled {
        issues.push(ServiceDoctorIssue {
            level: "warning".to_string(),
            code: "SERVICE_RUNNING_BUT_DISABLED".to_string(),
            message: "control service is running even though config says disabled".to_string(),
            suggestion: Some("Stop it with `giteam service stop`, or turn it back on via `giteam config set --enabled true`.".to_string()),
        });
    }

    if manager.supported && manager.installed && !manager.definition_exists {
        issues.push(ServiceDoctorIssue {
            level: "error".to_string(),
            code: "MANAGER_DEFINITION_MISSING".to_string(),
            message:
                "service manager reports an installed service, but the definition file is missing"
                    .to_string(),
            suggestion: Some(
                "Run `giteam service install` to recreate the service definition.".to_string(),
            ),
        });
    }

    if manager.supported
        && manager.installed
        && matches!(manager.definition_matches_cli, Some(false))
    {
        issues.push(ServiceDoctorIssue {
            level: "warning".to_string(),
            code: "MANAGER_POINTS_TO_OLD_BINARY".to_string(),
            message: "service manager definition points to a different giteam binary than the current CLI".to_string(),
            suggestion: Some("Reinstall the managed service with `giteam service install` after upgrading the CLI.".to_string()),
        });
    }

    if manager.supported && manager.installed && manager.enabled && !manager.loaded {
        issues.push(ServiceDoctorIssue {
            level: "warning".to_string(),
            code: "MANAGER_ENABLED_NOT_LOADED".to_string(),
            message: "service manager has the service enabled, but it is not loaded right now"
                .to_string(),
            suggestion: Some(
                "Run `giteam service enable` or inspect the manager-specific error output."
                    .to_string(),
            ),
        });
    }

    if let Some(err) = &manager.recent_error {
        issues.push(ServiceDoctorIssue {
            level: "info".to_string(),
            code: "RECENT_LOG_ERROR".to_string(),
            message: format!("recent service log error: {err}"),
            suggestion: Some("Inspect recent logs with `giteam service logs --tail 120` or `giteam service logs --follow`.".to_string()),
        });
    }

    Ok(ServiceDoctorReport {
        ok: !issues.iter().any(|issue| issue.level == "error"),
        control,
        runtime,
        manager,
        issues,
    })
}

fn print_service_doctor(json: bool) -> Result<(), String> {
    let report = service_doctor_report()?;
    if json {
        return print_json(&report);
    }

    println!("service doctor");
    println!();
    println!("running: {}", report.runtime.running);
    println!("config enabled: {}", report.control.enabled);
    println!("manager: {}", human_service_manager_state(&report.manager));
    if let Some(path) = &report.manager.definition_path {
        println!("definition: {}", path);
    }
    if let Some(expected) = &report.manager.expected_exec {
        println!("expected exec: {}", expected);
    }
    println!();

    if report.issues.is_empty() {
        println!("No obvious service issues found.");
        return Ok(());
    }

    for issue in &report.issues {
        println!("[{}] {}", issue.level, issue.message);
        if let Some(suggestion) = &issue.suggestion {
            println!("  fix: {}", suggestion);
        }
    }
    Ok(())
}

fn manager_unsupported_error(manager: &ServiceManagerStatus) -> String {
    manager
        .note
        .clone()
        .unwrap_or_else(|| "service manager is not supported on this platform".to_string())
}

fn write_launchd_plist() -> Result<PathBuf, String> {
    let plist_path = launchd_plist_path()?;
    let launch_agents = launch_agents_dir()?;
    fs::create_dir_all(&launch_agents).map_err(|e| format!("create LaunchAgents failed: {e}"))?;
    let exe = std::env::current_exe().map_err(|e| format!("resolve current exe failed: {e}"))?;
    let out = log_file_path()?;
    let err = log_file_path()?;
    let content = format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
            "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n",
            "<plist version=\"1.0\">\n",
            "<dict>\n",
            "  <key>Label</key>\n  <string>{label}</string>\n",
            "  <key>ProgramArguments</key>\n",
            "  <array>\n",
            "    <string>{exe}</string>\n",
            "    <string>service</string>\n",
            "    <string>serve</string>\n",
            "    <string>--no-banner</string>\n",
            "  </array>\n",
            "  <key>RunAtLoad</key>\n  <true/>\n",
            "  <key>KeepAlive</key>\n  <true/>\n",
            "  <key>WorkingDirectory</key>\n  <string>{workdir}</string>\n",
            "  <key>StandardOutPath</key>\n  <string>{stdout}</string>\n",
            "  <key>StandardErrorPath</key>\n  <string>{stderr}</string>\n",
            "</dict>\n",
            "</plist>\n"
        ),
        label = xml_escape(service_label()),
        exe = xml_escape(exe.to_string_lossy().as_ref()),
        workdir = xml_escape(std::env::current_dir().map_err(|e| format!("resolve current dir failed: {e}"))?.to_string_lossy().as_ref()),
        stdout = xml_escape(out.to_string_lossy().as_ref()),
        stderr = xml_escape(err.to_string_lossy().as_ref()),
    );
    fs::write(&plist_path, content).map_err(|e| format!("write launchd plist failed: {e}"))?;
    Ok(plist_path)
}

fn write_systemd_unit() -> Result<PathBuf, String> {
    let unit_path = systemd_unit_path()?;
    let unit_dir = systemd_user_dir()?;
    fs::create_dir_all(&unit_dir).map_err(|e| format!("create systemd user dir failed: {e}"))?;
    let exe = std::env::current_exe().map_err(|e| format!("resolve current exe failed: {e}"))?;
    let out = log_file_path()?;
    let err = log_file_path()?;
    let workdir =
        std::env::current_dir().map_err(|e| format!("resolve current dir failed: {e}"))?;
    let content = format!(
        concat!(
            "[Unit]\n",
            "Description=giteam mobile control service\n",
            "After=network.target\n\n",
            "[Service]\n",
            "Type=simple\n",
            "WorkingDirectory={workdir}\n",
            "ExecStart={exe} service serve --no-banner\n",
            "Restart=always\n",
            "RestartSec=2\n",
            "StandardOutput=append:{stdout}\n",
            "StandardError=append:{stderr}\n\n",
            "[Install]\n",
            "WantedBy=default.target\n"
        ),
        workdir = workdir.display(),
        exe = exe.display(),
        stdout = out.display(),
        stderr = err.display(),
    );
    fs::write(&unit_path, content).map_err(|e| format!("write systemd unit failed: {e}"))?;
    Ok(unit_path)
}

fn service_install() -> Result<(), String> {
    let existing = service_manager_status()?;
    if !existing.supported {
        return Err(manager_unsupported_error(&existing));
    }
    if existing.installed && existing.loaded && existing.enabled {
        println!("{} is already installed and enabled", service_label());
        print_service_manager_summary(&existing);
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        let plist = write_launchd_plist()?;
        let domain = launchctl_domain()?;
        let _ = run_launchctl(&["bootout", domain.as_str(), plist.to_string_lossy().as_ref()]);
        let (ok, _, err) = run_launchctl(&[
            "bootstrap",
            domain.as_str(),
            plist.to_string_lossy().as_ref(),
        ])?;
        if !ok {
            return Err(format!("launchctl bootstrap failed: {}", err.trim()));
        }
        let _ = run_launchctl(&["enable", format!("{}/{}", domain, service_label()).as_str()]);
        println!("installed {} via launchd", service_label());
    } else if cfg!(target_os = "linux") {
        let unit = write_systemd_unit()?;
        let (ok_reload, _, err_reload) = run_systemctl(&["daemon-reload"])?;
        if !ok_reload {
            return Err(format!(
                "systemctl daemon-reload failed: {}",
                err_reload.trim()
            ));
        }
        let (ok_enable, _, err_enable) = run_systemctl(&["enable", service_label()])?;
        if !ok_enable {
            return Err(format!("systemctl enable failed: {}", err_enable.trim()));
        }
        let _ = run_systemctl(&["restart", service_label()]);
        println!(
            "installed {} via systemd --user ({})",
            service_label(),
            unit.display()
        );
    } else {
        return Err(manager_unsupported_error(&existing));
    }
    print_service_manager_summary(&service_manager_status()?);
    Ok(())
}

fn service_uninstall() -> Result<(), String> {
    let manager = service_manager_status()?;
    if !manager.supported {
        return Err(manager_unsupported_error(&manager));
    }
    if !manager.installed {
        println!("{} is not installed", service_label());
        print_service_manager_summary(&manager);
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        let plist = launchd_plist_path()?;
        let domain = launchctl_domain()?;
        let _ = run_launchctl(&["bootout", domain.as_str(), plist.to_string_lossy().as_ref()]);
        let _ = fs::remove_file(&plist);
        println!("removed {} from launchd", service_label());
    } else if cfg!(target_os = "linux") {
        let unit = systemd_unit_path()?;
        let _ = run_systemctl(&["disable", "--now", service_label()]);
        let _ = fs::remove_file(&unit);
        let _ = run_systemctl(&["daemon-reload"]);
        println!("removed {} from systemd --user", service_label());
    } else {
        return Err(manager_unsupported_error(&manager));
    }
    print_service_manager_summary(&service_manager_status()?);
    Ok(())
}

fn service_enable() -> Result<(), String> {
    let manager = service_manager_status()?;
    if !manager.supported {
        return Err(manager_unsupported_error(&manager));
    }
    if manager.enabled && manager.loaded {
        println!("{} is already enabled", service_label());
        print_service_manager_summary(&manager);
        return Ok(());
    }
    if !manager.installed {
        service_install()?;
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        let domain = launchctl_domain()?;
        let target = format!("{}/{}", domain, service_label());
        let (ok, _, err) = run_launchctl(&["enable", target.as_str()])?;
        if !ok {
            return Err(format!("launchctl enable failed: {}", err.trim()));
        }
        let plist = launchd_plist_path()?;
        let _ = run_launchctl(&[
            "bootstrap",
            domain.as_str(),
            plist.to_string_lossy().as_ref(),
        ]);
        println!("enabled {}", service_label());
    } else if cfg!(target_os = "linux") {
        let (ok, _, err) = run_systemctl(&["enable", "--now", service_label()])?;
        if !ok {
            return Err(format!("systemctl enable --now failed: {}", err.trim()));
        }
        println!("enabled {}", service_label());
    } else {
        return Err(manager_unsupported_error(&manager));
    }
    print_service_manager_summary(&service_manager_status()?);
    Ok(())
}

fn service_disable() -> Result<(), String> {
    let manager = service_manager_status()?;
    if !manager.supported {
        return Err(manager_unsupported_error(&manager));
    }
    if !manager.installed {
        println!("{} is not installed", service_label());
        print_service_manager_summary(&manager);
        return Ok(());
    }
    if !manager.enabled && !manager.loaded {
        println!("{} is already disabled", service_label());
        print_service_manager_summary(&manager);
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        let domain = launchctl_domain()?;
        let target = format!("{}/{}", domain, service_label());
        let _ = run_launchctl(&["disable", target.as_str()])?;
        let plist = launchd_plist_path()?;
        let _ = run_launchctl(&["bootout", domain.as_str(), plist.to_string_lossy().as_ref()]);
        println!("disabled {}", service_label());
    } else if cfg!(target_os = "linux") {
        let (ok, _, err) = run_systemctl(&["disable", "--now", service_label()])?;
        if !ok {
            return Err(format!("systemctl disable --now failed: {}", err.trim()));
        }
        println!("disabled {}", service_label());
    } else {
        return Err(manager_unsupported_error(&manager));
    }
    print_service_manager_summary(&service_manager_status()?);
    Ok(())
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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

fn run_shell_capture(script: &str, timeout_secs: u64) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new("/bin/zsh");
    cmd.args(["-fc", script]);
    cmd.env("PATH", build_path_env());
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let output = cmd
        .output()
        .map_err(|e| format!("failed to spawn shell: {e}"))?;
    let code = output
        .status
        .code()
        .unwrap_or(if output.status.success() { 0 } else { -1 });
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if timeout_secs == 0 {
        return Err("invalid timeout".to_string());
    }
    Ok((code, stdout, stderr))
}

fn check_dep(name: &str, version_args: &[&str], install_hint: &str) -> PluginStatus {
    let path_cmd = format!("rehash 2>/dev/null || true; command -v {name}");
    let path_out = run_shell_capture(&path_cmd, 5)
        .ok()
        .filter(|(code, _, _)| *code == 0)
        .map(|(_, stdout, _)| stdout.trim().to_string())
        .filter(|s| !s.is_empty());
    let version_script = format!("{} {}", name, version_args.join(" "));
    let version_out = run_shell_capture(&version_script, 8)
        .ok()
        .filter(|(code, _, _)| *code == 0)
        .map(|(_, stdout, _)| stdout.lines().next().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty());
    let installed = path_out.is_some() && version_out.is_some();
    PluginStatus {
        name: name.to_string(),
        checked: true,
        installed,
        path: path_out,
        version: version_out,
        install_hint: install_hint.to_string(),
    }
}

fn check_giteam_npm_global() -> PluginStatus {
    const INSTALL_HINT: &str = "npm install -g giteam@latest";
    let script = r##"
BIN=""
if command -v giteam >/dev/null 2>&1; then
  BIN=$(command -v giteam)
fi
if [ -n "$BIN" ] && printf '%s' "$BIN" | grep -q 'node_modules/.bin'; then
  BIN=""
fi
if [ -z "$BIN" ]; then
  for p in "$HOME/.npm-global/bin/giteam" "/usr/local/bin/giteam" "/opt/homebrew/bin/giteam" "/opt/homebrew/Caskroom/miniconda/base/bin/giteam" "/opt/homebrew/Caskroom/miniconda3/base/bin/giteam"; do
    if [ -x "$p" ]; then
      BIN=$p
      break
    fi
  done
fi
if [ -z "$BIN" ]; then
  printf 'NO_PKG\t\t\n'
  exit 0
fi
VER=$("$BIN" --version 2>/dev/null | head -1 | tr -d '\r')
printf 'OK\t%s\t%s\n' "$BIN" "$VER"
exit 0
"##;
    let Ok((code, stdout, _)) = run_shell_capture(script, 12) else {
        return PluginStatus {
            name: "giteam".to_string(),
            checked: true,
            installed: false,
            path: None,
            version: None,
            install_hint: INSTALL_HINT.to_string(),
        };
    };
    if code != 0 {
        return PluginStatus {
            name: "giteam".to_string(),
            checked: true,
            installed: false,
            path: None,
            version: None,
            install_hint: INSTALL_HINT.to_string(),
        };
    }
    let line = stdout.lines().next().unwrap_or("");
    let mut parts = line.splitn(3, '\t');
    let status = parts.next().unwrap_or("").trim();
    let path = parts.next().unwrap_or("").trim();
    let ver = parts.next().unwrap_or("").trim();
    if status != "OK" {
        return PluginStatus {
            name: "giteam".to_string(),
            checked: true,
            installed: false,
            path: None,
            version: None,
            install_hint: INSTALL_HINT.to_string(),
        };
    }
    let path_opt = (!path.is_empty()).then(|| path.to_string());
    let ver_opt = (!ver.is_empty()).then(|| ver.to_string());
    let installed = path_opt.is_some() && ver_opt.is_some();
    PluginStatus {
        name: "giteam".to_string(),
        checked: true,
        installed,
        path: path_opt,
        version: ver_opt,
        install_hint: INSTALL_HINT.to_string(),
    }
}

fn plugin_status(name: PluginName) -> PluginStatus {
    match name {
        PluginName::Git => check_dep("git", &["--version"], "brew install git"),
        PluginName::Entire => check_dep(
            "entire",
            &["--version"],
            "brew tap entireio/tap && brew install entireio/tap/entire",
        ),
        PluginName::Opencode => check_dep(
            "opencode",
            &["--version"],
            "brew install anomalyco/tap/opencode (or npm i -g opencode-ai)",
        ),
        PluginName::Giteam => check_giteam_npm_global(),
    }
}

fn plugin_status_list() -> Vec<PluginStatus> {
    [
        PluginName::Git,
        PluginName::Entire,
        PluginName::Opencode,
        PluginName::Giteam,
    ]
    .into_iter()
    .map(plugin_status)
    .collect()
}

fn selected_plugins(selected: &[PluginName]) -> Vec<PluginName> {
    if selected.is_empty() {
        vec![
            PluginName::Git,
            PluginName::Entire,
            PluginName::Opencode,
            PluginName::Giteam,
        ]
    } else {
        selected.to_vec()
    }
}

fn plugin_status_symbol(installed: bool) -> &'static str {
    if installed {
        "[ok]"
    } else {
        "[missing]"
    }
}

fn print_plugin_status_item(item: &PluginStatus) {
    println!("{} {}", plugin_status_symbol(item.installed), item.name);
    println!(
        "  version: {}",
        item.version
            .clone()
            .unwrap_or_else(|| "(unknown)".to_string())
    );
    println!(
        "  path: {}",
        item.path.clone().unwrap_or_else(|| "(none)".to_string())
    );
    if !item.installed {
        println!("  install_hint: {}", item.install_hint);
    }
}

fn collect_plugin_statuses(names: &[PluginName]) -> Vec<PluginStatus> {
    names.iter().copied().map(plugin_status).collect()
}

fn build_init_report(plugins: Vec<PluginStatus>, install_missing: bool) -> InitReport {
    InitReport {
        ok: plugins.iter().all(|p| p.installed),
        install_missing,
        plugins,
    }
}

fn wizard_clear_screen() {
    print!("\x1B[2J\x1B[H");
    let _ = io::stdout().flush();
}

fn wizard_step_badge(done: bool) -> &'static str {
    if done {
        "[done]"
    } else {
        "[    ]"
    }
}

fn print_wizard_header(step: &str, body: &str, completed: &[&str]) {
    wizard_clear_screen();
    println!("{}", mobile_banner());
    println!("giteam setup wizard");
    println!();
    let steps = [
        "Runtime Check",
        "Dependency Install",
        "Project Import",
        "Model Setup",
        "Finish",
    ];
    for item in steps {
        let done = completed.iter().any(|x| x == &item);
        println!("{} {}", wizard_step_badge(done), item);
    }
    println!();
    println!("{step}");
    println!("{body}");
    println!();
}

fn completed_steps(
    missing_step_done: bool,
    outcome: &InitWizardOutcome,
    include_finish: bool,
) -> Vec<&'static str> {
    let mut steps = vec!["Runtime Check"];
    if missing_step_done {
        steps.push("Dependency Install");
    }
    if outcome.project_step_done {
        steps.push("Project Import");
    }
    if outcome.model_step_done {
        steps.push("Model Setup");
    }
    if include_finish {
        steps.push("Finish");
    }
    steps
}

fn print_init_report(report: &InitReport) {
    println!("giteam init");
    println!();
    for item in &report.plugins {
        print_plugin_status_item(item);
    }
    println!();
    if report.ok {
        println!("Environment looks good. You can now run `giteam service start` or `giteam service serve`.");
    } else if report.install_missing {
        println!("Some dependencies are still missing. Check the install hints above.");
    } else {
        println!("Some dependencies are missing. Re-run with `giteam init --install-missing`.");
    }
}

fn imported_projects_path() -> Result<PathBuf, String> {
    Ok(ensure_app_support_dir()?.join("imported-projects.json"))
}

fn load_imported_projects() -> Vec<String> {
    let Ok(path) = imported_projects_path() else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<ImportedProjectsRegistry>(&raw)
        .map(|r| r.projects)
        .unwrap_or_default()
}

fn save_imported_project(path: &str) -> Result<(), String> {
    let canonical = fs::canonicalize(path)
        .map_err(|e| format!("resolve project path failed: {e}"))?
        .to_string_lossy()
        .to_string();
    let mut projects = load_imported_projects();
    projects.retain(|p| p != &canonical);
    projects.insert(0, canonical);
    if projects.len() > 32 {
        projects.truncate(32);
    }
    let registry = ImportedProjectsRegistry { projects };
    let file = imported_projects_path()?;
    let text = serde_json::to_string_pretty(&registry)
        .map_err(|e| format!("serialize imported projects failed: {e}"))?;
    fs::write(file, text).map_err(|e| format!("write imported projects failed: {e}"))
}

fn detect_default_repo() -> Option<String> {
    let cwd = std::env::current_dir().ok()?;
    let text = cwd.to_string_lossy().to_string();
    if giteam_core::command_runner::validate_repo_path(&text).is_ok() {
        Some(text)
    } else {
        None
    }
}

fn prompt_secret_line(prompt: &str) -> Result<String, String> {
    print!("{prompt}");
    io::stdout()
        .flush()
        .map_err(|e| format!("flush stdout failed: {e}"))?;
    let _ = Command::new("stty").arg("-echo").status();
    let mut line = String::new();
    let read_res = io::stdin().read_line(&mut line);
    let _ = Command::new("stty").arg("echo").status();
    println!();
    read_res.map_err(|e| format!("read input failed: {e}"))?;
    Ok(line.trim().to_string())
}

fn read_key_byte() -> Result<u8, String> {
    let mut buf = [0u8; 1];
    io::stdin()
        .read_exact(&mut buf)
        .map_err(|e| format!("read key failed: {e}"))?;
    Ok(buf[0])
}

fn terminal_columns() -> usize {
    if let Ok(cols) = std::env::var("COLUMNS") {
        if let Ok(v) = cols.trim().parse::<usize>() {
            if v > 20 {
                return v;
            }
        }
    }
    Command::new("tput")
        .arg("cols")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|out| {
            if !out.status.success() {
                return None;
            }
            String::from_utf8(out.stdout).ok()
        })
        .and_then(|s| s.trim().parse::<usize>().ok())
        .filter(|v| *v > 20)
        .unwrap_or(100)
}

fn truncate_for_terminal(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    if max_chars <= 3 {
        return "...".chars().take(max_chars).collect();
    }
    let mut out = String::new();
    for ch in input.chars().take(max_chars - 3) {
        out.push(ch);
    }
    out.push_str("...");
    out
}

fn interactive_select(
    title: &str,
    hint: &str,
    items: &[String],
    initial_index: Option<usize>,
) -> Result<Option<usize>, String> {
    if items.is_empty() {
        return Ok(None);
    }
    if !(io::stdin().is_terminal() && io::stdout().is_terminal()) {
        for (idx, item) in items.iter().enumerate() {
            println!("  {}. {}", idx + 1, item);
        }
        let answer = prompt_line("Select an item (or s to skip): ")?;
        if answer.eq_ignore_ascii_case("s") || answer.is_empty() {
            return Ok(None);
        }
        let idx = answer
            .parse::<usize>()
            .map_err(|_| "invalid selection".to_string())?;
        return Ok(Some(idx.saturating_sub(1)));
    }

    let _guard = TerminalModeGuard::enter_raw();
    let mut selected = initial_index
        .unwrap_or(0)
        .min(items.len().saturating_sub(1));
    let mut offset = 0usize;
    let page_size = 10usize;
    let mut query = String::new();
    loop {
        let filtered: Vec<usize> = if query.trim().is_empty() {
            (0..items.len()).collect()
        } else {
            let q = query.to_ascii_lowercase();
            items
                .iter()
                .enumerate()
                .filter_map(|(idx, item)| item.to_ascii_lowercase().contains(&q).then_some(idx))
                .collect()
        };
        if filtered.is_empty() {
            selected = 0;
            offset = 0;
        } else if !filtered.contains(&selected) {
            selected = filtered[0];
            offset = 0;
        }
        wizard_clear_screen();
        let cols = terminal_columns();
        let info_width = cols.saturating_sub(2).max(20);
        let list_width = cols.saturating_sub(4).max(18);
        println!("{}", mobile_banner());
        println!("{}", truncate_for_terminal(title, info_width));
        println!("{}", truncate_for_terminal(hint, info_width));
        println!();
        println!(
            "{}",
            truncate_for_terminal(
                &format!(
                    "Search: {}",
                    if query.is_empty() {
                        "(none)"
                    } else {
                        query.as_str()
                    }
                ),
                info_width,
            )
        );
        println!();
        let end = (offset + page_size).min(filtered.len());
        for filtered_idx in offset..end {
            let absolute = filtered[filtered_idx];
            let cursor = if absolute == selected { ">" } else { " " };
            println!(
                "{} {}",
                cursor,
                truncate_for_terminal(&items[absolute], list_width)
            );
        }
        println!();
        if !filtered.is_empty() {
            let current_pos = filtered
                .iter()
                .position(|idx| *idx == selected)
                .map(|v| v + 1)
                .unwrap_or(1);
            let page = (offset / page_size) + 1;
            let total_pages = filtered.len().div_ceil(page_size);
            println!(
                "{}",
                truncate_for_terminal(
                    &format!(
                        "Showing {} items · current {}/{} · page {}/{}",
                        filtered.len(),
                        current_pos,
                        filtered.len(),
                        page,
                        total_pages.max(1)
                    ),
                    info_width,
                )
            );
        } else {
            println!(
                "{}",
                truncate_for_terminal("No matches for current search.", info_width)
            );
        }
        println!(
            "{}",
            truncate_for_terminal(
                "Use ↑/↓ or j/k to move, type to search, Backspace to clear, Enter to confirm, q to skip",
                info_width,
            )
        );

        match read_key_byte()? {
            b'q' | b'Q' => return Ok(None),
            127 | 8 => {
                query.pop();
            }
            b'k' => {
                if let Some(pos) = filtered.iter().position(|idx| *idx == selected) {
                    if pos > 0 {
                        selected = filtered[pos - 1];
                    }
                }
            }
            b'j' => {
                if let Some(pos) = filtered.iter().position(|idx| *idx == selected) {
                    if pos + 1 < filtered.len() {
                        selected = filtered[pos + 1];
                    }
                }
            }
            b'\r' | b'\n' => {
                if !filtered.is_empty() {
                    return Ok(Some(selected));
                }
            }
            27 => {
                let b1 = read_key_byte().unwrap_or_default();
                let b2 = read_key_byte().unwrap_or_default();
                if b1 == b'[' {
                    match b2 {
                        b'A' => {
                            if let Some(pos) = filtered.iter().position(|idx| *idx == selected) {
                                if pos > 0 {
                                    selected = filtered[pos - 1];
                                }
                            }
                        }
                        b'B' => {
                            if let Some(pos) = filtered.iter().position(|idx| *idx == selected) {
                                if pos + 1 < filtered.len() {
                                    selected = filtered[pos + 1];
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            byte if byte.is_ascii_graphic() || byte == b' ' => {
                query.push(byte as char);
            }
            _ => {}
        }
        if let Some(pos) = filtered.iter().position(|idx| *idx == selected) {
            if pos < offset {
                offset = pos;
            } else if pos >= offset + page_size {
                offset = pos + 1 - page_size;
            }
        }
    }
}

fn prompt_line(prompt: &str) -> Result<String, String> {
    print!("{prompt}");
    io::stdout()
        .flush()
        .map_err(|e| format!("flush stdout failed: {e}"))?;
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|e| format!("read input failed: {e}"))?;
    Ok(line.trim().to_string())
}

fn prompt_yes_no(prompt: &str, default_yes: bool) -> Result<bool, String> {
    loop {
        let suffix = if default_yes { "[Y/n]" } else { "[y/N]" };
        let line = prompt_line(&format!("{prompt} {suffix} "))?;
        if line.is_empty() {
            return Ok(default_yes);
        }
        match line.to_ascii_lowercase().as_str() {
            "y" | "yes" => return Ok(true),
            "n" | "no" => return Ok(false),
            _ => println!("Please answer yes or no."),
        }
    }
}

fn prompt_missing_plugins(plugins: &[PluginStatus]) -> Result<Vec<PluginName>, String> {
    let missing: Vec<PluginName> = plugins
        .iter()
        .filter(|p| !p.installed)
        .filter_map(|p| match p.name.as_str() {
            "git" => Some(PluginName::Git),
            "entire" => Some(PluginName::Entire),
            "opencode" => Some(PluginName::Opencode),
            "giteam" => Some(PluginName::Giteam),
            _ => None,
        })
        .collect();
    if missing.is_empty() {
        return Ok(Vec::new());
    }

    println!("Missing dependencies:");
    for (idx, name) in missing.iter().enumerate() {
        println!("  {}. {}", idx + 1, name.as_str());
    }
    println!("  a. install all missing dependencies");
    println!("  s. skip installation");
    let answer = prompt_line("Choose dependencies to install (e.g. 1,3 / a / s): ")?;
    if answer.eq_ignore_ascii_case("s") || answer.is_empty() {
        return Ok(Vec::new());
    }
    if answer.eq_ignore_ascii_case("a") {
        return Ok(missing);
    }

    let mut selected = Vec::new();
    for part in answer.split(',') {
        let idx = part
            .trim()
            .parse::<usize>()
            .map_err(|_| format!("invalid selection: {part}"))?;
        let item = missing
            .get(idx.saturating_sub(1))
            .copied()
            .ok_or_else(|| format!("selection out of range: {idx}"))?;
        if !selected.contains(&item) {
            selected.push(item);
        }
    }
    Ok(selected)
}

fn maybe_offer_service_setup() -> Result<Option<String>, String> {
    print_wizard_header(
        "Optional · Service Setup",
        "Choose whether giteam should run once in the background or be installed as an OS-managed service.",
        &["Runtime Check", "Dependency Install", "Project Import", "Model Setup", "Finish"],
    );
    let status = service_manager_status()?;
    if !status.supported {
        println!("Tip: use `giteam service start` for ad-hoc runs on this platform.");
        return Ok(Some("ad-hoc only on this platform".to_string()));
    }
    if status.installed && status.enabled {
        println!("OS-managed service is already configured.");
        return Ok(Some("service already managed by OS".to_string()));
    }
    println!();
    println!("Next step: choose how you want the service to run.");
    println!("  1. Start once in background now");
    println!("  2. Install and enable OS-managed startup");
    println!("  3. Skip for now");
    let answer = prompt_line("Select an option [1/2/3]: ")?;
    match answer.as_str() {
        "1" => {
            start_background(true, false)?;
            Ok(Some("started once in background".to_string()))
        }
        "2" => {
            service_install()?;
            Ok(Some("installed and enabled via OS manager".to_string()))
        }
        _ => {
            println!("Skipped service setup.");
            Ok(Some("skipped service setup".to_string()))
        }
    }
}

fn choose_project_for_setup() -> Result<Option<String>, String> {
    let default_repo = detect_default_repo();
    let imported = load_imported_projects();

    print_wizard_header(
        "Step 3/5 · Project Import",
        "Choose a Git repository for OpenCode model configuration. This project can be saved for later reuse.",
        &["Runtime Check", "Dependency Install"],
    );

    let mut options: Vec<(String, String)> = Vec::new();
    if let Some(repo) = &default_repo {
        options.push(("Use current directory".to_string(), repo.clone()));
    }
    for path in imported.iter().take(5) {
        options.push((format!("Use saved project: {path}"), path.clone()));
    }
    println!("Available options:");
    for (idx, (label, _)) in options.iter().enumerate() {
        println!("  {}. {}", idx + 1, label);
    }
    println!("  p. Enter a different project path");
    println!("  s. Skip project setup for now");
    loop {
        let answer = prompt_line("Select a project option: ")?;
        if answer.eq_ignore_ascii_case("s") || answer.is_empty() {
            return Ok(None);
        }
        let selected_path = if answer.eq_ignore_ascii_case("p") {
            prompt_line("Enter a local Git repository path: ")?
        } else {
            let idx = match answer.parse::<usize>() {
                Ok(v) => v,
                Err(_) => {
                    println!("Please choose a listed project option.");
                    continue;
                }
            };
            match options
                .get(idx.saturating_sub(1))
                .map(|(_, path)| path.clone())
            {
                Some(path) => path,
                None => {
                    println!("Project selection is out of range.");
                    continue;
                }
            }
        };
        match giteam_core::command_runner::validate_repo_path(&selected_path) {
            Ok(()) => {
                save_imported_project(&selected_path)?;
                return Ok(Some(selected_path));
            }
            Err(e) => {
                println!("Project is not usable: {e}");
            }
        }
    }
}

fn choose_provider_index(
    rows: &[giteam_core::opencode::OpencodeServerProviderCatalog],
    connected: &[String],
) -> Result<Option<usize>, String> {
    if rows.is_empty() {
        return Ok(None);
    }
    let items = rows
        .iter()
        .map(|row| {
            let is_connected = connected.iter().any(|id| id == &row.id);
            let status = if is_connected {
                "connected"
            } else {
                "needs auth"
            };
            format!("{} [{}]", row.name, status)
        })
        .collect::<Vec<_>>();
    interactive_select(
        "Provider Selection",
        "Choose an OpenCode provider. Connected providers can still be reconfigured.",
        &items,
        None,
    )
}

fn choose_model_for_provider(
    provider: &giteam_core::opencode::OpencodeServerProviderCatalog,
    current_model: Option<&str>,
) -> Result<Option<String>, String> {
    let mut items = provider
        .models
        .iter()
        .map(|model| {
            let display = provider
                .model_names
                .get(model)
                .cloned()
                .unwrap_or_else(|| model.clone());
            format!("{} ({})", display, model)
        })
        .collect::<Vec<_>>();
    items.push("Enter a custom model id".to_string());
    let initial_index =
        current_model.and_then(|current| provider.models.iter().position(|model| model == current));
    let selected = interactive_select(
        &format!("Model Selection · {}", provider.name),
        "Use ↑/↓ or j/k to move, Enter to confirm, q to skip.",
        &items,
        initial_index,
    )?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    if selected == items.len() - 1 {
        let custom = prompt_line("Enter model id (without provider prefix): ")?;
        if custom.trim().is_empty() {
            return Ok(None);
        }
        return Ok(Some(custom));
    }
    let model = provider
        .models
        .get(selected)
        .cloned()
        .ok_or_else(|| "model selection out of range".to_string())?;
    Ok(Some(model))
}

fn maybe_configure_opencode_model(repo_path: &str) -> Result<Option<String>, String> {
    print_wizard_header(
        "Step 4/5 · OpenCode Model Setup",
        "Optionally connect a provider, choose a model, and persist it for this machine and project.",
        &["Runtime Check", "Dependency Install", "Project Import"],
    );
    println!("Project: {repo_path}");
    println!();
    if !prompt_yes_no("Would you like to configure an OpenCode model now?", true)? {
        println!("Skipped model configuration.");
        return Ok(None);
    }

    println!("Starting OpenCode service and fetching provider catalog...");
    opencode::warmup_managed_opencode_service();
    let current_model_cfg = opencode::get_opencode_model_config(repo_path).ok();
    if let Some(cfg) = &current_model_cfg {
        if !cfg.configured_model.trim().is_empty() {
            println!("Current configured model: {}", cfg.configured_model);
        }
    }
    let mut state = opencode::get_opencode_server_provider_state(repo_path)?;
    let provider_index = match choose_provider_index(&state.providers, &state.connected)? {
        Some(idx) => idx,
        None => return Ok(None),
    };
    let provider = state
        .providers
        .get(provider_index)
        .cloned()
        .ok_or_else(|| "provider selection out of range".to_string())?;
    let is_connected = state.connected.iter().any(|id| id == &provider.id);
    println!();
    if is_connected {
        println!("Provider '{}' is already connected.", provider.name);
        if prompt_yes_no("Would you like to update its API key?", false)? {
            let key = prompt_secret_line(&format!("New API key for {}: ", provider.id))?;
            if !key.trim().is_empty() {
                opencode::put_opencode_server_auth(repo_path, &provider.id, &key)?;
                state = opencode::get_opencode_server_provider_state(repo_path)?;
            }
        }
    } else {
        println!("Provider '{}' is not connected yet.", provider.name);
        if prompt_yes_no("Enter an API key now?", true)? {
            let key = prompt_secret_line(&format!("API key for {}: ", provider.id))?;
            if !key.trim().is_empty() {
                opencode::put_opencode_server_auth(repo_path, &provider.id, &key)?;
                state = opencode::get_opencode_server_provider_state(repo_path)?;
            }
        }
    }
    let refreshed = state
        .providers
        .iter()
        .find(|p| p.id == provider.id)
        .cloned()
        .unwrap_or(provider);
    let current_model_id = current_model_cfg
        .as_ref()
        .and_then(|cfg| cfg.configured_model.split_once('/'))
        .and_then(|(provider_id, model_id)| (provider_id == refreshed.id).then_some(model_id));
    let Some(model_id) = choose_model_for_provider(&refreshed, current_model_id)? else {
        return Ok(None);
    };
    let full_model = format!("{}/{}", refreshed.id, model_id.trim());
    opencode::set_opencode_server_current_model(repo_path, &full_model)?;
    let saved = opencode::set_opencode_model_config(repo_path, &full_model)?;
    println!();
    println!("Configured OpenCode model: {}", saved.configured_model);
    Ok(Some(saved.configured_model))
}

fn run_init_interactive(selected: Vec<PluginName>) -> Result<(), String> {
    let names = selected_plugins(&selected);
    let mut outcome = InitWizardOutcome::default();
    print_wizard_header(
        "Step 1/5 · Runtime Check",
        "We will verify required dependencies, optionally configure a project and model, then help you start the service.",
        &[],
    );

    let mut plugins = collect_plugin_statuses(&names);
    let initial = build_init_report(plugins.clone(), false);
    print_init_report(&initial);

    let missing = plugins.iter().any(|p| !p.installed);
    let mut dependency_install_executed = false;
    if missing {
        print_wizard_header(
            "Step 2/5 · Dependency Install",
            "Select which missing dependencies should be installed now.",
            &["Runtime Check"],
        );
        for item in &plugins {
            print_plugin_status_item(item);
        }
        println!();
        let to_install = prompt_missing_plugins(&plugins)?;
        dependency_install_executed = true;
        for name in to_install {
            println!();
            println!("Installing {}...", name.as_str());
            run_plugin_action(name, "install")?;
        }
        plugins = collect_plugin_statuses(&names);
    }

    let final_report = build_init_report(plugins, missing);
    let summary_step = if missing {
        "Step 3/5 · Environment Summary"
    } else {
        "Step 2/5 · Environment Summary"
    };
    let completed_for_summary = completed_steps(dependency_install_executed, &outcome, false);
    print_wizard_header(
        summary_step,
        "Here is the final dependency status before optional project and model setup.",
        &completed_for_summary,
    );
    print_init_report(&final_report);

    if final_report.ok {
        outcome.imported_repo = choose_project_for_setup()?;
        outcome.project_step_done = outcome.imported_repo.is_some();
        if let Some(repo_path) = outcome.imported_repo.as_deref() {
            outcome.configured_model = maybe_configure_opencode_model(repo_path)?;
            outcome.model_step_done = true;
            if outcome.configured_model.is_none() {
                outcome.model_step_note =
                    Some("model setup was opened but skipped in this run".to_string());
            }
        } else {
            outcome.model_step_note =
                Some("model setup requires a selected Git project, so it was skipped".to_string());
        }
    } else {
        outcome.model_step_note =
            Some("model setup is available after dependencies are ready".to_string());
    }

    print_wizard_header(
        "Step 5/5 · Finish",
        "Review the result and optionally continue into service setup.",
        &completed_steps(dependency_install_executed, &outcome, false),
    );
    print_init_report(&final_report);
    if let Some(repo) = &outcome.imported_repo {
        println!("Imported project: {repo}");
    } else {
        println!("Imported project: skipped in this run");
    }
    println!(
        "OpenCode model: {}",
        outcome
            .configured_model
            .clone()
            .unwrap_or_else(|| "not configured in this run".to_string())
    );
    println!();
    if final_report.ok && prompt_yes_no("Would you like help setting up the service now?", true)? {
        outcome.service_action = maybe_offer_service_setup()?;
    } else {
        outcome.service_action = Some("skipped service setup".to_string());
    }

    print_wizard_header(
        "Setup Complete",
        "Here is your final setup summary and the most useful next actions.",
        &completed_steps(dependency_install_executed, &outcome, true),
    );
    println!("[ok] Dependencies ready: {}", final_report.ok);
    println!(
        "[ok] Project: {}",
        outcome
            .imported_repo
            .clone()
            .unwrap_or_else(|| "not imported in this run".to_string())
    );
    println!(
        "[ok] Model: {}",
        outcome
            .configured_model
            .clone()
            .or_else(|| outcome.model_step_note.clone())
            .unwrap_or_else(|| "not configured in this run".to_string())
    );
    println!(
        "[ok] Service: {}",
        outcome
            .service_action
            .clone()
            .unwrap_or_else(|| "no action taken".to_string())
    );
    println!();
    println!("Suggested next steps:");
    println!("  1. giteam service status");
    println!("  2. giteam pair-code");
    println!("  3. giteam service doctor");
    Ok(())
}

fn install_script(name: PluginName, action: &str) -> Result<&'static str, String> {
    match (name, action) {
        (PluginName::Git, "install") => Ok(r#"if command -v brew >/dev/null 2>&1; then
  brew install git
else
  xcode-select --install || true
  echo "Homebrew not found. Triggered Xcode Command Line Tools installer."
fi"#),
        (PluginName::Git, "uninstall") => Ok(r#"if command -v brew >/dev/null 2>&1; then
  brew uninstall git || true
else
  echo "Git installed by Xcode Command Line Tools must be removed manually."
fi"#),
        (PluginName::Entire, "install") => Ok(r#"if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install Entire CLI."
  exit 2
fi
brew tap entireio/tap
brew install entireio/tap/entire"#),
        (PluginName::Entire, "uninstall") => Ok(r##"if command -v brew >/dev/null 2>&1; then
  brew uninstall entireio/tap/entire || true
fi
if [ -f "$HOME/.local/bin/entire" ]; then
  rm -f "$HOME/.local/bin/entire"
fi
echo "Entire uninstall finished.""##),
        (PluginName::Opencode, "install") => Ok(r##"if command -v brew >/dev/null 2>&1; then
  brew install anomalyco/tap/opencode
elif command -v npm >/dev/null 2>&1; then
  npm install -g opencode-ai
else
  curl -fsSL https://opencode.ai/install | bash
fi"##),
        (PluginName::Opencode, "uninstall") => Ok(r##"if command -v opencode >/dev/null 2>&1; then
  opencode uninstall --force || true
fi
if command -v brew >/dev/null 2>&1; then
  brew uninstall anomalyco/tap/opencode || true
fi
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g opencode-ai || true
fi
echo "OpenCode uninstall finished.""##),
        (PluginName::Giteam, "install") | (PluginName::Giteam, "update") => Ok(r##"NPM_CMD=""
if command -v npm >/dev/null 2>&1; then
  NPM_CMD=$(command -v npm)
else
  for p in "$HOME/.npm-global/bin/npm" "/usr/local/bin/npm" "/opt/homebrew/bin/npm" "/opt/homebrew/Caskroom/miniconda/base/bin/npm" "/opt/homebrew/Caskroom/miniconda3/base/bin/npm"; do
    if [ -x "$p" ]; then
      NPM_CMD=$p
      break
    fi
  done
fi
if [ -z "$NPM_CMD" ]; then
  echo "npm is required to install giteam CLI (not found in PATH)."
  exit 2
fi
"$NPM_CMD" install -g giteam@latest"##),
        (PluginName::Giteam, "uninstall") => Ok(r##"NPM_CMD=""
if command -v npm >/dev/null 2>&1; then
  NPM_CMD=$(command -v npm)
else
  for p in "$HOME/.npm-global/bin/npm" "/usr/local/bin/npm" "/opt/homebrew/bin/npm" "/opt/homebrew/Caskroom/miniconda/base/bin/npm" "/opt/homebrew/Caskroom/miniconda3/base/bin/npm"; do
    if [ -x "$p" ]; then
      NPM_CMD=$p
      break
    fi
  done
fi
if [ -n "$NPM_CMD" ]; then
  "$NPM_CMD" uninstall -g giteam || true
fi
echo "giteam uninstall finished.""##),
        _ => Err(format!("unsupported action: {action} {}", name.as_str())),
    }
}

fn print_plugin_status(name: Option<PluginName>, json: bool) -> Result<(), String> {
    if let Some(name) = name {
        let status = plugin_status(name);
        if json {
            return print_json(&status);
        }
        print_plugin_status_item(&status);
        return Ok(());
    }
    let all = plugin_status_list();
    if json {
        return print_json(&all);
    }
    for item in all {
        print_plugin_status_item(&item);
    }
    Ok(())
}

fn run_plugin_action(name: PluginName, action: &str) -> Result<(), String> {
    let script = install_script(name, action)?;
    let status = Command::new("/bin/zsh")
        .args(["-fc", script])
        .env("PATH", build_path_env())
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|e| format!("failed to run {action} for {}: {e}", name.as_str()))?;
    if !status.success() {
        return Err(format!(
            "{} {} failed with status {}",
            action,
            name.as_str(),
            status
        ));
    }
    println!();
    print_plugin_status(Some(name), false)
}

fn run_init(selected: Vec<PluginName>, install_missing: bool, json: bool) -> Result<(), String> {
    let names = selected_plugins(&selected);
    let mut plugins = Vec::new();

    for name in names {
        let mut status = plugin_status(name);
        if install_missing && !status.installed {
            run_plugin_action(name, "install")?;
            status = plugin_status(name);
        }
        plugins.push(status);
    }

    let report = build_init_report(plugins, install_missing);

    if json {
        return print_json(&report);
    }

    print_init_report(&report);
    Ok(())
}

fn app_support_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = home.trim();
            if !home.is_empty() {
                return Ok(PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("giteam"));
            }
        }
    }
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let xdg_config_home = xdg_config_home.trim();
        if !xdg_config_home.is_empty() {
            return Ok(PathBuf::from(xdg_config_home).join("giteam"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let home = home.trim();
        if !home.is_empty() {
            return Ok(PathBuf::from(home).join(".config").join("giteam"));
        }
    }
    Err("unable to resolve giteam config directory".to_string())
}

fn ensure_app_support_dir() -> Result<PathBuf, String> {
    let dir = app_support_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("create giteam config dir failed: {e}"))?;
    Ok(dir)
}

fn pid_file_path() -> Result<PathBuf, String> {
    Ok(ensure_app_support_dir()?.join("control-server.pid"))
}

fn log_file_path() -> Result<PathBuf, String> {
    Ok(ensure_app_support_dir()?.join("control-server.log"))
}

fn read_pid_state() -> Option<PidState> {
    let path = pid_file_path().ok()?;
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<PidState>(&text).ok()
}

fn write_pid_state(pid: u32) -> Result<(), String> {
    let path = pid_file_path()?;
    let state = PidState {
        pid,
        started_at: now_unix_secs(),
    };
    let text = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("serialize pid state failed: {e}"))?;
    fs::write(path, text).map_err(|e| format!("write pid state failed: {e}"))
}

fn clear_pid_file_if_matches(expected_pid: u32) {
    let Ok(path) = pid_file_path() else {
        return;
    };
    let Some(current) = read_pid_state() else {
        return;
    };
    if current.pid == expected_pid {
        let _ = fs::remove_file(path);
    }
}

fn pid_is_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn find_pid_by_port(port: u16) -> Option<u32> {
    let output = Command::new("lsof")
        .arg("-ti")
        .arg(format!("tcp:{port}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok())
}

fn service_addr(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}

fn http_json(method: &str, port: u16, path: &str, body: Option<&str>) -> Result<Value, String> {
    let mut stream =
        TcpStream::connect_timeout(&service_addr(port), Duration::from_millis(HTTP_TIMEOUT_MS))
            .map_err(|e| format!("connect control api failed: {e}"))?;
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
        .map_err(|e| format!("write control api failed: {e}"))?;
    let mut raw = String::new();
    stream
        .read_to_string(&mut raw)
        .map_err(|e| format!("read control api failed: {e}"))?;
    let (head, body_text) = raw
        .split_once("\r\n\r\n")
        .ok_or_else(|| "invalid control api response".to_string())?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(500);
    let json = if body_text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(body_text).map_err(|e| format!("invalid health json: {e}"))?
    };
    if (200..300).contains(&status) {
        Ok(json)
    } else {
        Err(json
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("request failed")
            .to_string())
    }
}

fn fetch_health(port: u16) -> Option<Value> {
    http_json("GET", port, "/api/v1/health", None).ok()
}

fn service_running(port: u16) -> bool {
    fetch_health(port)
        .and_then(|v| v.get("ok").and_then(|x| x.as_bool()))
        .unwrap_or(false)
}

fn wait_for_running(port: u16, timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < u128::from(timeout_ms) {
        if service_running(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(180));
    }
    false
}

fn wait_for_stopped(port: u16, timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < u128::from(timeout_ms) {
        if !service_running(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(180));
    }
    false
}

fn runtime_view() -> Result<RuntimeView, String> {
    let control = control::get_control_server_settings()?;
    let log_path = log_file_path()?.display().to_string();
    let pid_state = read_pid_state();
    let pid = pid_state
        .as_ref()
        .map(|v| v.pid)
        .or_else(|| find_pid_by_port(control.port));
    let pid_alive = pid.map(pid_is_alive).unwrap_or(false);
    let health = fetch_health(control.port);
    Ok(RuntimeView {
        running: health.is_some(),
        pid,
        pid_alive,
        log_path,
        health,
    })
}

fn mobile_banner() -> &'static str {
    include_str!("../字符画.txt")
}

fn print_banner() {
    println!("{}", mobile_banner());
    println!("giteam mobile control service");
    println!();
}

fn print_status(json: bool) -> Result<(), String> {
    let view = StatusView {
        control: control::get_control_access_info()?,
        runtime: runtime_view()?,
        manager: service_manager_status()?,
    };
    if json {
        return print_json(&view);
    }
    println!("running: {}", view.runtime.running);
    println!(
        "mode: {}",
        if view.runtime.running {
            if view.runtime.pid_alive {
                "managed/background"
            } else {
                "external"
            }
        } else {
            "stopped"
        }
    );
    println!("enabled: {}", view.control.enabled);
    println!("host: {}", view.control.host);
    println!("port: {}", view.control.port);
    println!(
        "pid: {}",
        view.runtime
            .pid
            .map(|v| v.to_string())
            .unwrap_or_else(|| "(none)".to_string())
    );
    println!("pid_alive: {}", view.runtime.pid_alive);
    println!("log_path: {}", view.runtime.log_path);
    println!("no_auth: {}", view.control.no_auth);
    println!("pair_code_ttl_mode: {}", view.control.pair_code_ttl_mode);
    println!(
        "service_manager: {}",
        human_service_manager_state(&view.manager)
    );
    if let Some(path) = &view.manager.definition_path {
        println!("service_definition: {}", path);
    }
    println!(
        "service_definition_exists: {}",
        view.manager.definition_exists
    );
    if let Some(matches) = view.manager.definition_matches_cli {
        println!("service_definition_matches_cli: {}", matches);
    }
    if let Some(expected) = &view.manager.expected_exec {
        println!("service_expected_exec: {}", expected);
    }
    if let Some(summary) = &view.manager.definition_summary {
        println!("service_definition_summary: {}", summary);
    }
    if let Some(err) = &view.manager.recent_error {
        println!("service_recent_error: {}", err);
    }
    if let Some(note) = &view.manager.note {
        println!("service_note: {}", note);
    }
    if !view.control.no_auth {
        println!("pair_code: {}", view.control.pair_code);
        println!("expires_at: {}", view.control.expires_at);
    }
    if !view.control.local_urls.is_empty() {
        println!("local_urls:");
        for url in view.control.local_urls {
            println!("  - {url}");
        }
    }
    if !view.control.public_base_url.trim().is_empty() {
        println!("public_base_url: {}", view.control.public_base_url);
    }
    Ok(())
}

fn print_pair_code(refresh: bool, json: bool) -> Result<(), String> {
    let pair = if refresh {
        control::refresh_control_pair_code()?
    } else {
        control::get_control_pair_code()?
    };
    if json {
        return print_json(&pair);
    }
    println!("code: {}", pair.code);
    println!("expires_at: {}", pair.expires_at);
    println!("ttl_seconds: {}", pair.ttl_seconds);
    Ok(())
}

fn print_config(json: bool) -> Result<(), String> {
    let view = ConfigView {
        control: control::get_control_server_settings()?,
        opencode: opencode::get_opencode_service_settings()?,
    };
    if json {
        return print_json(&view);
    }
    println!("control:");
    println!("  enabled: {}", view.control.enabled);
    println!("  host: {}", view.control.host);
    println!("  port: {}", view.control.port);
    println!(
        "  public_base_url: {}",
        if view.control.public_base_url.trim().is_empty() {
            "(empty)"
        } else {
            view.control.public_base_url.as_str()
        }
    );
    println!("  pair_code_ttl_mode: {}", view.control.pair_code_ttl_mode);
    println!("opencode:");
    println!("  port: {}", view.opencode.port);
    Ok(())
}

fn update_config(args: ConfigSetArgs) -> Result<(), String> {
    let has_control_change = args.enabled.is_some()
        || args.host.is_some()
        || args.port.is_some()
        || args.public_base_url.is_some()
        || args.pair_code_ttl_mode.is_some();
    let has_opencode_change = args.opencode_port.is_some();
    if !has_control_change && !has_opencode_change {
        return Err("config set requires at least one field to update".to_string());
    }

    let mut control_settings = control::get_control_server_settings()?;
    if let Some(enabled) = args.enabled {
        control_settings.enabled = enabled;
    }
    if let Some(host) = args.host {
        control_settings.host = host;
    }
    if let Some(port) = args.port {
        control_settings.port = port;
    }
    if let Some(public_base_url) = args.public_base_url {
        control_settings.public_base_url = public_base_url;
    }
    if let Some(pair_code_ttl_mode) = args.pair_code_ttl_mode {
        control_settings.pair_code_ttl_mode = pair_code_ttl_mode;
    }
    if has_control_change {
        control_settings = control::set_control_server_settings(control_settings)?;
    }

    let mut opencode_settings = opencode::get_opencode_service_settings()?;
    if let Some(port) = args.opencode_port {
        opencode_settings.port = port;
        opencode_settings = opencode::set_opencode_service_settings(
            opencode_settings,
            normalize_repo_path(args.repo_path)?,
        )?;
    }

    let view = ConfigView {
        control: control_settings,
        opencode: opencode_settings,
    };
    if args.json {
        return print_json(&view);
    }
    print_config(false)
}

fn run_doctor(repo_path: Option<String>, warmup: bool, json: bool) -> Result<(), String> {
    let report = doctor::build_report(repo_path, warmup)?;
    if json {
        return print_json(&report);
    }
    println!("{}", doctor::render_human(&report));
    Ok(())
}

fn normalize_repo_path(repo_path: Option<String>) -> Result<Option<String>, String> {
    let Some(repo_path) = repo_path else {
        return Ok(None);
    };
    let trimmed = repo_path.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    giteam_core::command_runner::validate_repo_path(&trimmed)?;
    Ok(Some(trimmed))
}

fn ensure_enabled() -> Result<control::ControlServerSettings, String> {
    let mut settings = control::get_control_server_settings()?;
    if !settings.enabled {
        settings.enabled = true;
        settings = control::persist_control_server_settings(settings)?;
    }
    Ok(settings)
}

fn print_start_stop(view: &StartStopView, json: bool) -> Result<(), String> {
    if json {
        return print_json(view);
    }
    println!("{}", view.message);
    println!("running: {}", view.runtime.running);
    println!(
        "pid: {}",
        view.runtime
            .pid
            .map(|v| v.to_string())
            .unwrap_or_else(|| "(none)".to_string())
    );
    println!("log_path: {}", view.runtime.log_path);
    Ok(())
}

fn open_log_append() -> Result<File, String> {
    let path = log_file_path()?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open log file failed: {e}"))
}

fn start_background(warmup: bool, json: bool) -> Result<(), String> {
    let settings = ensure_enabled()?;
    if service_running(settings.port) {
        let view = StartStopView {
            ok: true,
            action: "start".to_string(),
            message: format!(
                "giteam control server already running on port {}",
                settings.port
            ),
            runtime: runtime_view()?,
        };
        return print_start_stop(&view, json);
    }

    if !json {
        print_banner();
    }

    let mut stdout_file = open_log_append()?;
    let stderr_file = stdout_file
        .try_clone()
        .map_err(|e| format!("clone log file failed: {e}"))?;
    writeln!(
        stdout_file,
        "\n===== giteam start {} =====",
        now_unix_secs()
    )
    .map_err(|e| format!("write log header failed: {e}"))?;

    let mut cmd = Command::new(
        std::env::current_exe().map_err(|e| format!("resolve current exe failed: {e}"))?,
    );
    cmd.arg("serve");
    if !warmup {
        cmd.arg("--warmup=false");
    }
    cmd.arg("--no-banner");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));
    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn background server failed: {e}"))?;
    write_pid_state(child.id())?;

    if !wait_for_running(settings.port, START_TIMEOUT_MS) {
        return Err(format!(
            "giteam control server did not become healthy on port {}. Check logs: {}",
            settings.port,
            log_file_path()?.display()
        ));
    }

    let view = StartStopView {
        ok: true,
        action: "start".to_string(),
        message: format!(
            "giteam control server started in background on port {}",
            settings.port
        ),
        runtime: runtime_view()?,
    };
    print_start_stop(&view, json)
}

fn signal_pid(pid: u32, force: bool) -> Result<(), String> {
    let sig = if force { "-KILL" } else { "-TERM" };
    let status = Command::new("/bin/kill")
        .arg(sig)
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("signal process failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "signal process {} failed with status {}",
            pid, status
        ))
    }
}

fn stop_background(force: bool, json: bool) -> Result<(), String> {
    let settings = control::get_control_server_settings()?;
    let runtime = runtime_view()?;
    let Some(pid) = runtime.pid else {
        let view = StartStopView {
            ok: true,
            action: "stop".to_string(),
            message: "giteam control server is not tracked by pid file".to_string(),
            runtime,
        };
        return print_start_stop(&view, json);
    };
    if !runtime.pid_alive && !runtime.running {
        clear_pid_file_if_matches(pid);
        let view = StartStopView {
            ok: true,
            action: "stop".to_string(),
            message: "giteam control server is already stopped".to_string(),
            runtime: runtime_view()?,
        };
        return print_start_stop(&view, json);
    }

    signal_pid(pid, false)?;
    if !wait_for_stopped(settings.port, STOP_TIMEOUT_MS) && force {
        signal_pid(pid, true)?;
        let _ = wait_for_stopped(settings.port, STOP_TIMEOUT_MS / 2);
    }
    if pid_is_alive(pid) && !force {
        return Err(format!(
            "giteam control server is still running (pid {}). Retry with `giteam stop --force`",
            pid
        ));
    }
    clear_pid_file_if_matches(pid);
    let view = StartStopView {
        ok: true,
        action: "stop".to_string(),
        message: format!("giteam control server stopped (pid {})", pid),
        runtime: runtime_view()?,
    };
    print_start_stop(&view, json)
}

fn restart_background(warmup: bool, force: bool, json: bool) -> Result<(), String> {
    let _ = stop_background(force, true);
    start_background(warmup, json)
}

fn tail_lines(text: &str, n: usize) -> String {
    if n == 0 {
        return String::new();
    }
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

fn show_logs(tail: usize, follow: bool) -> Result<(), String> {
    let path = log_file_path()?;
    if !path.is_file() {
        return Err(format!("log file not found: {}", path.display()));
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read log file failed: {e}"))?;
    let snippet = tail_lines(&text, tail);
    if !snippet.is_empty() {
        println!("{snippet}");
    }
    if !follow {
        return Ok(());
    }

    let mut file = OpenOptions::new()
        .read(true)
        .open(&path)
        .map_err(|e| format!("open log file failed: {e}"))?;
    let mut pos = file
        .seek(SeekFrom::End(0))
        .map_err(|e| format!("seek log file failed: {e}"))?;
    loop {
        let len = file
            .metadata()
            .map_err(|e| format!("read log metadata failed: {e}"))?
            .len();
        if len < pos {
            pos = 0;
        }
        if len > pos {
            file.seek(SeekFrom::Start(pos))
                .map_err(|e| format!("seek log delta failed: {e}"))?;
            let mut buf = String::new();
            file.read_to_string(&mut buf)
                .map_err(|e| format!("read log delta failed: {e}"))?;
            print!("{buf}");
            let _ = std::io::stdout().flush();
            pos = len;
        }
        thread::sleep(Duration::from_millis(500));
    }
}

fn run_service_command(command: ServiceCommands) -> Result<(), String> {
    match command {
        ServiceCommands::Serve {
            warmup,
            json,
            no_banner,
        } => serve(warmup, json, no_banner),
        ServiceCommands::Start { warmup, json } => start_background(warmup, json),
        ServiceCommands::Stop { force, json } => stop_background(force, json),
        ServiceCommands::Restart {
            warmup,
            force,
            json,
        } => restart_background(warmup, force, json),
        ServiceCommands::Logs { tail, follow } => show_logs(tail, follow),
        ServiceCommands::Status { json } => print_status(json),
        ServiceCommands::Doctor { json } => print_service_doctor(json),
        ServiceCommands::Install => service_install(),
        ServiceCommands::Uninstall => service_uninstall(),
        ServiceCommands::Enable => service_enable(),
        ServiceCommands::Disable => service_disable(),
    }
}

fn serve(warmup: bool, json: bool, no_banner: bool) -> Result<(), String> {
    ensure_enabled()?;
    if !no_banner && !json {
        print_banner();
    }
    write_pid_state(std::process::id())?;
    let _pid_guard = PidFileGuard {
        pid: std::process::id(),
    };

    if warmup {
        thread::spawn(|| {
            opencode::warmup_managed_opencode_service();
        });
    }
    control::start_control_server()?;
    print_status(json)?;
    if !json {
        eprintln!("giteam control server running, press Ctrl+C to stop");
        eprintln!("logs: {}", log_file_path()?.display());
    }

    let running = Arc::new(AtomicBool::new(true));
    let signal = Arc::clone(&running);
    ctrlc::set_handler(move || {
        signal.store(false, Ordering::Relaxed);
    })
    .map_err(|e| format!("failed to install Ctrl+C handler: {e}"))?;

    while running.load(Ordering::Relaxed) {
        thread::sleep(Duration::from_millis(250));
    }

    control::stop_control_server();
    opencode::shutdown_managed_opencode_service();
    Ok(())
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command.unwrap_or(Commands::Serve {
        warmup: true,
        json: false,
        no_banner: false,
    }) {
        Commands::Service { command } => run_service_command(command),
        Commands::Serve {
            warmup,
            json,
            no_banner,
        } => run_service_command(ServiceCommands::Serve {
            warmup,
            json,
            no_banner,
        }),
        Commands::Start { warmup, json } => {
            run_service_command(ServiceCommands::Start { warmup, json })
        }
        Commands::Stop { force, json } => {
            run_service_command(ServiceCommands::Stop { force, json })
        }
        Commands::Restart {
            warmup,
            force,
            json,
        } => run_service_command(ServiceCommands::Restart {
            warmup,
            force,
            json,
        }),
        Commands::Logs { tail, follow } => {
            run_service_command(ServiceCommands::Logs { tail, follow })
        }
        Commands::Status { json } => run_service_command(ServiceCommands::Status { json }),
        Commands::Init {
            install_missing,
            interactive,
            with,
            json,
        } => {
            let use_interactive = !json
                && !install_missing
                && (interactive
                    || (with.is_empty()
                        && io::stdin().is_terminal()
                        && io::stdout().is_terminal()));
            if use_interactive {
                run_init_interactive(with)
            } else {
                run_init(with, install_missing, json)
            }
        }
        Commands::Plugin { command } => match command {
            PluginCommands::List { json } => print_plugin_status(None, json),
            PluginCommands::Check { name, json } => print_plugin_status(Some(name), json),
            PluginCommands::Install { name } => run_plugin_action(name, "install"),
            PluginCommands::Uninstall { name } => run_plugin_action(name, "uninstall"),
            PluginCommands::Update { name } => run_plugin_action(name, "update"),
        },
        Commands::PairCode { refresh, json } => print_pair_code(refresh, json),
        Commands::Config { command } => match command {
            ConfigCommands::Get { json } => print_config(json),
            ConfigCommands::Set(args) => update_config(args),
        },
        Commands::Doctor {
            repo_path,
            warmup,
            json,
        } => run_doctor(repo_path, warmup, json),
    };

    if let Err(err) = result {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

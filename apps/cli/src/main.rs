mod doctor;

use clap::{Args, Parser, Subcommand, ValueEnum};
use giteam_core::pi_agent::PiAgentService;
use giteam_core::cloud;
use giteam_core::control;
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
            help = "Only process selected plugins, e.g. --with git,entire,giteam"
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
    #[command(about = "Manage cloud relay link (remote mobile access)")]
    Cloud {
        #[command(subcommand)]
        command: CloudCommands,
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
enum CloudCommands {
    #[command(about = "Link this machine to the cloud gateway (reuses saved access key by default)")]
    Link {
        #[arg(long, help = "Cloud gateway base URL")]
        url: Option<String>,
        #[arg(long = "access-key", help = "Join an existing workspace / use a specific key")]
        access_key: Option<String>,
        #[arg(long, help = "Device display name")]
        name: Option<String>,
        #[arg(long = "key-name", help = "Name for a newly minted access key")]
        key_name: Option<String>,
        #[arg(long = "new", help = "Force mint a new workspace access key (do not reuse local key)")]
        force_new: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Show cloud link status")]
    Status {
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Disable cloud link and stop tunnel (keeps saved access keys)")]
    Unlink {
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Print mobile QR payload JSON for cloud pairing")]
    Qr {
        #[arg(long)]
        json: bool,
    },
    #[command(about = "List locally saved cloud access keys")]
    Keys {
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Remove a key from the local vault (does not revoke on server)")]
    ForgetKey {
        #[arg(help = "access key id (aki_…) or full gtm_aks_… secret")]
        key: String,
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
    #[command(about = "Reconcile stale service registrations and old binaries")]
    Reconcile,
    #[command(
        about = "Ensure managed service uses the current CLI (rewrite path / reload binary if needed)"
    )]
    Ensure,
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
    Giteam,
}

impl PluginName {
    fn as_str(self) -> &'static str {
        match self {
            Self::Git => "git",
            Self::Entire => "entire",
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
    #[arg(long, hide = true)]
    repo_path: Option<String>,
    #[arg(long)]
    json: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigAgentView {
    runtime: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigView {
    control: control::ControlServerSettings,
    agent: ConfigAgentView,
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
            suggestion: Some(
                "Upgrade already installed? New CLI auto-fixes via `giteam service ensure` (also runs on npm postinstall)."
                    .to_string(),
            ),
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
    auto_ensure_managed_service();
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
    // 固定工作目录到 app support，避免 npm postinstall 时 cwd 落在将被替换的 package 目录
    let workdir = ensure_app_support_dir()?;
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
            // 绑定失败时避免 KeepAlive 无间隔狂重试占满日志 / CPU
            "  <key>ThrottleInterval</key>\n  <integer>10</integer>\n",
            "  <key>WorkingDirectory</key>\n  <string>{workdir}</string>\n",
            "  <key>StandardOutPath</key>\n  <string>{stdout}</string>\n",
            "  <key>StandardErrorPath</key>\n  <string>{stderr}</string>\n",
            "</dict>\n",
            "</plist>\n"
        ),
        label = xml_escape(service_label()),
        exe = xml_escape(exe.to_string_lossy().as_ref()),
        workdir = xml_escape(workdir.to_string_lossy().as_ref()),
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
    let workdir = ensure_app_support_dir()?;
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
    let already_current = existing.installed
        && existing.loaded
        && existing.enabled
        && matches!(existing.definition_matches_cli, Some(true));
    if already_current {
        println!("{} is already installed and enabled", service_label());
        print_service_manager_summary(&existing);
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        let control = control::get_control_server_settings()?;
        let _ = free_control_port(control.port);
        let plist = write_launchd_plist()?;
        let domain = launchctl_domain()?;
        let target = format!("{}/{}", domain, service_label());
        let _ = run_launchctl(&["enable", target.as_str()]);
        let _ = run_launchctl(&["bootout", domain.as_str(), plist.to_string_lossy().as_ref()]);
        thread::sleep(Duration::from_millis(200));
        let _ = free_control_port(control.port);
        let (ok, _, err) = run_launchctl(&[
            "bootstrap",
            domain.as_str(),
            plist.to_string_lossy().as_ref(),
        ])?;
        if !ok {
            return Err(format!("launchctl bootstrap failed: {}", err.trim()));
        }
        let _ = run_launchctl(&["enable", target.as_str()]);
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

fn kill_processes_matching(_pattern: &str) -> Result<(), String> {
    // 保留兼容入口；实际清理统一走 free_control_port，避免错误的 giteam-cli 模式匹配。
    let port = control::get_control_server_settings()?.port;
    free_control_port(port)
}

fn service_reconcile() -> Result<(), String> {
    let manager = service_manager_status()?;
    if !manager.supported {
        return Err(manager_unsupported_error(&manager));
    }

    let tracked = manager.definition_exists
        || manager.installed
        || manager.enabled
        || manager.loaded;
    if !tracked {
        println!("{} has no managed registration to reconcile", service_label());
        print_service_manager_summary(&manager);
        return Ok(());
    }

    // 禁止「先 uninstall 再 install」：bootstrap 一旦失败会丢掉 LaunchAgent，自启彻底没了。
    // 统一走 kick_reload：清端口 → 重写定义 → bootout/bootstrap（或 systemd restart）。
    service_kick_reload()?;
    let refreshed = service_manager_status()?;
    println!("reconciled service manager state");
    print_service_manager_summary(&refreshed);
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServiceEnsureAction {
    Skipped,
    AlreadyCurrent,
    Reconciled,
    Reloaded,
}

fn ensured_cli_version_path() -> Result<PathBuf, String> {
    Ok(ensure_app_support_dir()?.join("last_ensured_cli_version"))
}

fn read_ensured_cli_version() -> Option<String> {
    let path = ensured_cli_version_path().ok()?;
    let text = fs::read_to_string(path).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn write_ensured_cli_version(version: &str) -> Result<(), String> {
    let path = ensured_cli_version_path()?;
    fs::write(&path, format!("{version}\n"))
        .map_err(|e| format!("write ensured cli version failed: {e}"))
}

fn running_service_version(port: u16) -> Option<String> {
    let health = fetch_health(port)?;
    health
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn service_kick_reload() -> Result<(), String> {
    let manager = service_manager_status()?;
    if !manager.supported {
        return Err(manager_unsupported_error(&manager));
    }
    let control = control::get_control_server_settings()?;
    // 先清掉 managed/background 或失败重试残留，再让 launchd/systemd 独占端口
    free_control_port(control.port)?;

    if cfg!(target_os = "macos") {
        // 刷新 plist（二进制路径 + ThrottleInterval），再 bootout/bootstrap 清掉 thrash 状态
        let plist = write_launchd_plist()?;
        let domain = launchctl_domain()?;
        let target = format!("{}/{}", domain, service_label());
        // disable 过的 label 会 bootstrap 失败（Input/output error），先 enable
        let _ = run_launchctl(&["enable", target.as_str()]);
        let _ = run_launchctl(&["bootout", domain.as_str(), plist.to_string_lossy().as_ref()]);
        thread::sleep(Duration::from_millis(250));
        // bootout 后可能还有孤儿占口
        let _ = free_control_port(control.port);
        let (ok, _, err) = run_launchctl(&[
            "bootstrap",
            domain.as_str(),
            plist.to_string_lossy().as_ref(),
        ])?;
        if !ok {
            let (ok2, _, err2) = run_launchctl(&["kickstart", "-k", target.as_str()])?;
            if !ok2 {
                return Err(format!(
                    "launchctl reload failed: {} {}",
                    err.trim(),
                    err2.trim()
                ));
            }
        }
        let _ = run_launchctl(&["enable", target.as_str()]);
    } else if cfg!(target_os = "linux") {
        let _ = write_systemd_unit()?;
        let (ok_reload, _, err_reload) = run_systemctl(&["daemon-reload"])?;
        if !ok_reload {
            return Err(format!(
                "systemctl daemon-reload failed: {}",
                err_reload.trim()
            ));
        }
        let (ok, _, err) = run_systemctl(&["restart", service_label()])?;
        if !ok {
            return Err(format!("systemctl restart failed: {}", err.trim()));
        }
    } else {
        return Err(manager_unsupported_error(&manager));
    }

    if !wait_for_running(control.port, START_TIMEOUT_MS) {
        return Err(format!(
            "managed service did not become healthy on port {} after reload; check {}",
            control.port,
            log_file_path()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "(log path unavailable)".to_string())
        ));
    }
    Ok(())
}

/// 若用户曾安装过托管服务：路径漂移则 reconcile；同路径升级则 reload。
/// 未安装过则 no-op（不会偷偷装上）。
fn service_ensure(verbose: bool) -> Result<ServiceEnsureAction, String> {
    if std::env::var_os("GITEAM_SKIP_SERVICE_ENSURE").is_some() {
        return Ok(ServiceEnsureAction::Skipped);
    }

    let manager = service_manager_status()?;
    if !manager.supported {
        return Ok(ServiceEnsureAction::Skipped);
    }

    let tracked = manager.definition_exists
        || manager.installed
        || manager.enabled
        || manager.loaded;
    if !tracked {
        return Ok(ServiceEnsureAction::Skipped);
    }

    let cli_ver = env!("CARGO_PKG_VERSION");
    let path_stale = matches!(manager.definition_matches_cli, Some(false));

    if path_stale {
        if verbose {
            println!(
                "service ensure: managed definition points to a different binary; reconciling…"
            );
        }
        service_reconcile()?;
        let _ = write_ensured_cli_version(cli_ver);
        return Ok(ServiceEnsureAction::Reconciled);
    }

    let control = control::get_control_server_settings()?;
    let running_ver = running_service_version(control.port);
    let stamp = read_ensured_cli_version();

    // 已在跑当前版本：只写 stamp，绝不能 reload（否则 serve→status→ensure 会杀掉自己）。
    if running_ver.as_deref() == Some(cli_ver) {
        let _ = write_ensured_cli_version(cli_ver);
        if verbose {
            println!("service ensure: managed service already matches CLI {cli_ver}");
            print_service_manager_summary(&service_manager_status()?);
        }
        return Ok(ServiceEnsureAction::AlreadyCurrent);
    }

    // 仅在「版本真变了」或「该托管却没在跑」时 reload。
    // 旧逻辑在 stamp=None 时只要 loaded 就 drift，会在首次 serve 自毁循环。
    let version_drift = match (&running_ver, &stamp) {
        (Some(rv), _) if rv != cli_ver => true,
        (None, Some(s)) if s != cli_ver => manager.loaded || manager.installed || manager.enabled,
        (None, Some(_)) => {
            // stamp 已是当前版本，但进程挂了 → 拉起来
            !service_running(control.port) && (manager.loaded || manager.installed)
        }
        (None, None) => {
            // 从未 ensure：若定义存在却没在听端口，做一次拉起；已在听则只盖 stamp
            !service_running(control.port) && (manager.loaded || manager.installed || manager.enabled)
        }
        _ => false,
    };

    if version_drift {
        if verbose {
            println!(
                "service ensure: reloading managed service to pick up CLI {cli_ver}…"
            );
        }
        if manager.loaded || manager.installed || manager.enabled {
            service_kick_reload()?;
        } else {
            service_install()?;
        }
        let _ = write_ensured_cli_version(cli_ver);
        return Ok(ServiceEnsureAction::Reloaded);
    }

    let _ = write_ensured_cli_version(cli_ver);
    if verbose {
        println!("service ensure: managed service already matches CLI {cli_ver}");
        print_service_manager_summary(&service_manager_status()?);
    }
    Ok(ServiceEnsureAction::AlreadyCurrent)
}

fn auto_ensure_managed_service() {
    match service_ensure(false) {
        Ok(ServiceEnsureAction::Reconciled) => {
            eprintln!(
                "giteam: managed service definition updated to current CLI ({})",
                env!("CARGO_PKG_VERSION")
            );
        }
        Ok(ServiceEnsureAction::Reloaded) => {
            eprintln!(
                "giteam: managed service reloaded onto CLI {}",
                env!("CARGO_PKG_VERSION")
            );
        }
        Ok(_) => {}
        Err(err) => {
            eprintln!("giteam: service ensure skipped: {err}");
        }
    }
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
        format!("{home}/.bun/bin"),
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

fn resolve_posix_shell_path() -> String {
    #[cfg(unix)]
    {
        [
            std::env::var("SHELL").ok(),
            Some("/bin/bash".to_string()),
            Some("/usr/bin/bash".to_string()),
            Some("/bin/sh".to_string()),
            Some("/usr/bin/sh".to_string()),
        ]
        .into_iter()
        .flatten()
        .map(|item| item.trim().to_string())
        .find(|item| !item.is_empty() && std::path::Path::new(item).exists())
        .unwrap_or_else(|| "/bin/sh".to_string())
    }
    #[cfg(windows)]
    {
        // Windows 无 POSIX shell：依赖体检（git/gh --version 等简单命令）用 cmd.exe 跑。
        std::env::var("COMSPEC")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "cmd.exe".to_string())
    }
    #[cfg(not(any(unix, windows)))]
    {
        "/bin/sh".to_string()
    }
}

fn run_shell_capture(script: &str, timeout_secs: u64) -> Result<(i32, String, String), String> {
    let shell = resolve_posix_shell_path();
    let mut cmd = Command::new(shell.as_str());
    #[cfg(windows)]
    cmd.args(["/C", script]);
    #[cfg(not(windows))]
    cmd.args(["-lc", script]);
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
        PluginName::Giteam => check_giteam_npm_global(),
    }
}

fn plugin_status_list() -> Vec<PluginStatus> {
    [
        PluginName::Git,
        PluginName::Entire,
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
        "Choose a Git repository for agent model configuration. This project can be saved for later reuse.",
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

fn maybe_configure_agent_model(repo_path: &str) -> Result<Option<String>, String> {
    print_wizard_header(
        "Step 4/5 · Agent Model Setup",
        "Desktop agent uses the in-process Pi SDK. Configure providers and models in the Giteam desktop app.",
        &["Runtime Check", "Dependency Install", "Project Import"],
    );
    println!("Project: {repo_path}");
    println!();
    println!("Skipped CLI model configuration.");
    println!("Open Desktop → Settings → Agent / Providers to connect models.");
    Ok(None)
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
            outcome.configured_model = maybe_configure_agent_model(repo_path)?;
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
        "Agent model: {}",
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
    let shell = resolve_posix_shell_path();
    let status = Command::new(shell.as_str())
        .args(["-lc", script])
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
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let appdata = appdata.trim();
            if !appdata.is_empty() {
                return Ok(PathBuf::from(appdata).join("giteam"));
            }
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            let home = home.trim();
            if !home.is_empty() {
                return Ok(PathBuf::from(home).join(".config").join("giteam"));
            }
        }
    }
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let xdg_config_home = xdg_config_home.trim();
        if !xdg_config_home.is_empty() {
            return Ok(PathBuf::from(xdg_config_home).join("giteam"));
        }
    }
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
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
    #[cfg(windows)]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        let Ok(output) = output else {
            return false;
        };
        if !output.status.success() {
            return false;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        // tasklist prints "INFO: No tasks..." when missing; otherwise a row containing the pid.
        text.lines().any(|line| {
            let line = line.trim();
            !line.is_empty()
                && !line.to_ascii_uppercase().starts_with("INFO:")
                && line.split_whitespace().any(|tok| tok == pid.to_string())
        })
    }
    #[cfg(not(windows))]
    {
        Command::new("/bin/kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn find_pid_by_port(port: u16) -> Option<u32> {
    find_pids_by_port(port).into_iter().next()
}

fn find_pids_by_port(port: u16) -> Vec<u32> {
    let current_pid = std::process::id();
    let mut pids = Vec::new();

    #[cfg(windows)]
    {
        let output = Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let upper = line.to_ascii_uppercase();
            if !upper.contains("LISTENING") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Proto LocalAddress ForeignAddress State PID
            if parts.len() < 5 {
                continue;
            }
            let local = parts[1];
            let local_port = local
                .rsplit_once(':')
                .and_then(|(_, p)| p.trim_end_matches(']').parse::<u16>().ok());
            if local_port != Some(port) {
                continue;
            }
            let Ok(pid) = parts[parts.len() - 1].parse::<u32>() else {
                continue;
            };
            if pid != 0 && pid != current_pid && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        return pids;
    }

    #[cfg(not(windows))]
    {
        let output = Command::new("lsof")
            .arg("-ti")
            .arg(format!("tcp:{port}"))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let Ok(pid) = line.trim().parse::<u32>() else {
                continue;
            };
            if pid != current_pid && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        pids
    }
}

/// 升级 / reload 前释放控制口：停掉 pid 文件进程，并清掉仍占端口的孤儿实例。
/// 避免「managed/background」与 launchd KeepAlive 双开抢 4100。
fn free_control_port(port: u16) -> Result<(), String> {
    if let Some(state) = read_pid_state() {
        if pid_is_alive(state.pid) {
            let _ = signal_pid(state.pid, false);
            if !wait_for_stopped(port, STOP_TIMEOUT_MS) && pid_is_alive(state.pid) {
                let _ = signal_pid(state.pid, true);
                let _ = wait_for_stopped(port, STOP_TIMEOUT_MS / 2);
            }
        }
        clear_pid_file_if_matches(state.pid);
        if let Ok(path) = pid_file_path() {
            if !pid_is_alive(state.pid) {
                let _ = fs::remove_file(path);
            }
        }
    }

    for round in 0..2 {
        let pids = find_pids_by_port(port);
        if pids.is_empty() {
            return Ok(());
        }
        for pid in pids {
            let _ = signal_pid(pid, round > 0);
        }
        let _ = wait_for_stopped(port, STOP_TIMEOUT_MS / 2);
        thread::sleep(Duration::from_millis(200));
    }

    if !find_pids_by_port(port).is_empty() {
        return Err(format!(
            "control port {port} is still in use after cleanup; stop conflicting process and retry"
        ));
    }
    Ok(())
}

fn os_managed_service_registered(manager: &ServiceManagerStatus) -> bool {
    manager.supported
        && (manager.definition_exists || manager.installed || manager.loaded || manager.enabled)
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

fn fetch_access_info_from_service(port: u16) -> Option<control::ControlAccessInfo> {
    http_json("GET", port, "/api/v1/admin/control/access-info", None)
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
}

fn fetch_pair_code_from_service(port: u16, refresh: bool) -> Option<control::ControlPairCodeInfo> {
    let method = if refresh { "POST" } else { "GET" };
    let path = if refresh {
        "/api/v1/pair/request"
    } else {
        "/api/v1/pair/current"
    };
    http_json(method, port, path, if refresh { Some("{}") } else { None })
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
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
    let bound = control::control_bound_port().unwrap_or(0);
    let probe_port = if bound > 0 { bound } else { control.port };
    let pid_state = read_pid_state();
    let pid = pid_state
        .as_ref()
        .map(|v| v.pid)
        .or_else(|| find_pid_by_port(probe_port))
        .or_else(|| {
            if probe_port != control.port {
                find_pid_by_port(control.port)
            } else {
                None
            }
        });
    let pid_alive = pid.map(pid_is_alive).unwrap_or(false);
    let health = fetch_health(probe_port).or_else(|| {
        if probe_port != control.port {
            fetch_health(control.port)
        } else {
            None
        }
    });
    Ok(RuntimeView {
        running: health.is_some(),
        pid,
        pid_alive,
        log_path,
        health,
    })
}

fn resolved_control_access_info() -> Result<control::ControlAccessInfo, String> {
    let settings = control::get_control_server_settings()?;
    if service_running(settings.port) {
        if let Some(info) = fetch_access_info_from_service(settings.port) {
            return Ok(info);
        }
    }
    control::get_control_access_info()
}

fn resolved_pair_code(refresh: bool) -> Result<control::ControlPairCodeInfo, String> {
    let settings = control::get_control_server_settings()?;
    if service_running(settings.port) {
        if let Some(info) = fetch_pair_code_from_service(settings.port, refresh) {
            return Ok(info);
        }
    }
    if refresh {
        control::refresh_control_pair_code()
    } else {
        control::get_control_pair_code()
    }
}

fn mobile_banner() -> &'static str {
    include_str!("../字符画.txt")
}

fn print_banner() {
    println!("{}", mobile_banner());
    println!("Giteam control service v{}", env!("CARGO_PKG_VERSION"));
    println!();
}

fn print_status(json: bool) -> Result<(), String> {
    auto_ensure_managed_service();
    let view = StatusView {
        control: resolved_control_access_info()?,
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
            if os_managed_service_registered(&view.manager)
                && (view.manager.loaded || view.manager.installed)
            {
                "os-managed"
            } else if view.runtime.pid_alive {
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
    if matches!(view.manager.definition_matches_cli, Some(false)) {
        println!(
            "service_warning: managed service still points to an older binary; run `giteam service ensure`"
        );
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
    auto_ensure_managed_service();
    let pair = resolved_pair_code(refresh)?;
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
        agent: ConfigAgentView {
            runtime: "pi-sdk".to_string(),
        },
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
    println!("agent:");
    println!("  runtime: {}", view.agent.runtime);
    Ok(())
}

fn update_config(args: ConfigSetArgs) -> Result<(), String> {
    let has_control_change = args.enabled.is_some()
        || args.host.is_some()
        || args.port.is_some()
        || args.public_base_url.is_some()
        || args.pair_code_ttl_mode.is_some();
    let _ = args.repo_path;
    if !has_control_change {
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
    let _ = control::set_control_server_settings(control_settings)?;

    if args.json {
        return print_config(true);
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

fn ensure_enabled() -> Result<control::ControlServerSettings, String> {
    let mut settings = control::get_control_server_settings()?;
    if !settings.enabled {
        settings.enabled = true;
        settings = control::persist_control_server_settings(settings)?;
    }
    Ok(settings)
}

/// The CLI control server embeds the same Pi service as Desktop. This is a
/// cheap health touch, not a child-process warmup and not a network runtime.
fn warmup_agent_runtime() {
    let _ = PiAgentService::global().runtime_info();
}

fn shutdown_agent_runtime() {
    PiAgentService::global().shutdown();
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
    let manager = service_manager_status()?;

    // 已安装 OS 自启时，禁止再 spawn 第二份 managed/background，否则升级必抢端口。
    if os_managed_service_registered(&manager) {
        if service_running(settings.port) {
            let running_ver = running_service_version(settings.port);
            let cli_ver = env!("CARGO_PKG_VERSION");
            if running_ver.as_deref() == Some(cli_ver) {
                let view = StartStopView {
                    ok: true,
                    action: "start".to_string(),
                    message: format!(
                        "giteam control server already running on port {} via {}",
                        settings.port, manager.kind
                    ),
                    runtime: runtime_view()?,
                };
                return print_start_stop(&view, json);
            }
        }
        if !json {
            print_banner();
        }
        service_kick_reload()?;
        let view = StartStopView {
            ok: true,
            action: "start".to_string(),
            message: format!(
                "giteam control server started via {} on port {}",
                manager.kind, settings.port
            ),
            runtime: runtime_view()?,
        };
        return print_start_stop(&view, json);
    }

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
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        if force {
            cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
        } else {
            cmd.args(["/PID", &pid.to_string()]);
        }
        let status = cmd
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
    #[cfg(not(windows))]
    {
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
}

fn stop_background(force: bool, json: bool) -> Result<(), String> {
    let settings = control::get_control_server_settings()?;
    let manager = service_manager_status()?;

    // OS 自启开启时 KeepAlive 会立刻拉回；stop 改为 unload（保留 plist，下次 start/ensure 可恢复）
    if os_managed_service_registered(&manager) && (manager.loaded || manager.installed) {
        if cfg!(target_os = "macos") {
            let plist = launchd_plist_path()?;
            let domain = launchctl_domain()?;
            let _ = run_launchctl(&["bootout", domain.as_str(), plist.to_string_lossy().as_ref()]);
        } else if cfg!(target_os = "linux") {
            let _ = run_systemctl(&["stop", service_label()]);
        }
        let _ = free_control_port(settings.port);
        let view = StartStopView {
            ok: true,
            action: "stop".to_string(),
            message: format!(
                "giteam control server stopped (unloaded {}); run start/ensure to bring it back",
                manager.kind
            ),
            runtime: runtime_view()?,
        };
        return print_start_stop(&view, json);
    }

    let runtime = runtime_view()?;
    let Some(pid) = runtime.pid else {
        if force {
            let _ = free_control_port(settings.port);
        }
        let view = StartStopView {
            ok: true,
            action: "stop".to_string(),
            message: "giteam control server is not tracked by pid file".to_string(),
            runtime: runtime_view()?,
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
    if force {
        let _ = free_control_port(settings.port);
    }
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
        ServiceCommands::Reconcile => service_reconcile(),
        ServiceCommands::Ensure => {
            let action = service_ensure(true)?;
            if matches!(
                action,
                ServiceEnsureAction::Skipped | ServiceEnsureAction::AlreadyCurrent
            ) {
                // verbose path already printed details when AlreadyCurrent
                if action == ServiceEnsureAction::Skipped {
                    println!("service ensure: no managed service registration found");
                }
            }
            Ok(())
        }
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
            warmup_agent_runtime();
        });
    }
    control::start_control_server()?;
    // 禁止在 serve 进程内走 print_status→auto_ensure：ensure/reload 会 bootout 掉自己。
    // 盖上版本戳，让后续 CLI ensure 认作已对齐。
    let _ = write_ensured_cli_version(env!("CARGO_PKG_VERSION"));
    if json {
        let view = StatusView {
            control: resolved_control_access_info()?,
            runtime: runtime_view()?,
            manager: service_manager_status()?,
        };
        print_json(&view)?;
    } else if !no_banner {
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
    shutdown_agent_runtime();
    Ok(())
}

fn run_cloud_command(command: CloudCommands) -> Result<(), String> {
    match command {
        CloudCommands::Link {
            url,
            access_key,
            name,
            key_name,
            force_new,
            json,
        } => {
            let existing = cloud::get_cloud_link_settings();
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
                .unwrap_or_else(|| cloud::DEFAULT_CLOUD_BASE_URL.to_string())
                .trim()
                .trim_end_matches('/')
                .to_string();
            let device_name = name.unwrap_or_else(|| {
                std::env::var("HOST")
                    .or_else(|_| std::env::var("HOSTNAME"))
                    .unwrap_or_else(|_| "giteam-cli".to_string())
            });
            let version = env!("CARGO_PKG_VERSION").to_string();
            if force_new && key_name.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
                return Err("creating a new key requires --key-name (e.g. --key-name phone)".into());
            }
            let settings = cloud::link_device_with_opts(
                &base,
                &device_name,
                &version,
                access_key.as_deref(),
                cloud::LinkDeviceOptions {
                    force_new,
                    key_name,
                    // CLI 不传 tunnel_owner：保留已存值；首次 link 为空 → 视为 cli，
                    // 由本 CLI 进程负责 tunnel（control.rs 判 owner != "desktop" 才拉）。
                    tunnel_owner: None,
                },
            )?;
            let port = control::get_control_server_settings()?.port;
            let _ = cloud::start_cloud_tunnel_background(port);
            if json {
                println!("{}", serde_json::to_string_pretty(&settings).unwrap_or_default());
            } else {
                println!("cloud linked");
                println!("  cloud_base_url: {}", settings.cloud_base_url);
                println!("  workspace_id:   {}", settings.workspace_id);
                println!("  device_id:      {}", settings.device_id);
                println!("  key_name:       {}", settings.key_name);
                println!("  access_key:     {}", settings.access_key);
                println!("  tunnel:         {}", if cloud::tunnel_running() { "starting/running" } else { "not running (start control service)" });
                println!();
                println!("Mobile QR payload:");
                let qr = serde_json::json!({
                    "mode": "cloud",
                    "cloudBaseUrl": settings.cloud_base_url,
                    "workspaceId": settings.workspace_id,
                    "deviceId": settings.device_id,
                    "accessKey": settings.access_key,
                });
                println!("{}", serde_json::to_string_pretty(&qr).unwrap_or_default());
            }
            Ok(())
        }
        CloudCommands::Status { json } => {
            let settings = cloud::get_cloud_link_settings();
            let running = cloud::tunnel_running();
            if json {
                let view = serde_json::json!({
                    "enabled": settings.enabled,
                    "cloudBaseUrl": settings.cloud_base_url,
                    "workspaceId": settings.workspace_id,
                    "deviceId": settings.device_id,
                    "deviceName": settings.device_name,
                    "tunnelRunning": running,
                    "hasAccessKey": !settings.access_key.is_empty(),
                });
                println!("{}", serde_json::to_string_pretty(&view).unwrap_or_default());
            } else {
                println!("enabled: {}", settings.enabled);
                println!("cloud_base_url: {}", settings.cloud_base_url);
                println!("workspace_id: {}", settings.workspace_id);
                println!("device_id: {}", settings.device_id);
                println!("device_name: {}", settings.device_name);
                println!("tunnel_running: {}", running);
                if !settings.access_key.is_empty() {
                    println!("access_key: {}", settings.access_key);
                }
            }
            Ok(())
        }
        CloudCommands::Unlink { json } => {
            cloud::stop_cloud_tunnel();
            let mut settings = cloud::get_cloud_link_settings();
            settings.enabled = false;
            settings.device_token.clear();
            cloud::set_cloud_link_settings(&settings)?;
            if json {
                println!("{{\"ok\":true}}");
            } else {
                println!("cloud unlinked (device token cleared, tunnel stopped)");
            }
            Ok(())
        }
        CloudCommands::Qr { json: _json } => {
            let settings = cloud::get_cloud_link_settings();
            if settings.access_key.is_empty() || settings.workspace_id.is_empty() {
                return Err("not linked; run `giteam cloud link` first".into());
            }
            let qr = serde_json::json!({
                "mode": "cloud",
                "cloudBaseUrl": settings.cloud_base_url,
                "workspaceId": settings.workspace_id,
                "deviceId": settings.device_id,
                "accessKey": settings.access_key,
            });
            println!("{}", serde_json::to_string_pretty(&qr).unwrap_or_default());
            Ok(())
        }
        CloudCommands::Keys { json } => {
            let settings = cloud::get_cloud_link_settings();
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&settings.access_keys).unwrap_or_default()
                );
            } else if settings.access_keys.is_empty() {
                println!("(no saved access keys)");
            } else {
                for k in &settings.access_keys {
                    let mark = if k.access_key == settings.access_key {
                        "*"
                    } else {
                        " "
                    };
                    println!(
                        "{} {}  {}  {}",
                        mark,
                        k.name,
                        k.id,
                        k.access_key
                    );
                }
                println!("(* = active)");
            }
            Ok(())
        }
        CloudCommands::ForgetKey { key, json } => {
            let settings = cloud::forget_access_key_local(&key)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&settings).unwrap_or_default());
            } else {
                println!("forgot local key record: {key}");
            }
            Ok(())
        }
    }
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
        Commands::Cloud { command } => run_cloud_command(command),
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

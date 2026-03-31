use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const INSTALL_TIMEOUT_SECS: u64 = 15 * 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyStatus {
    pub name: String,
    pub checked: bool,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub install_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirementsStatus {
    pub platform: String,
    pub homebrew_installed: bool,
    pub git: RuntimeDependencyStatus,
    pub entire: RuntimeDependencyStatus,
    pub opencode: RuntimeDependencyStatus,
}

#[derive(Debug, Clone)]
struct RuntimeActionJob {
    job_id: String,
    name: String,
    action: String,
    status: String,
    log: String,
    started_at_ms: i64,
    finished_at_ms: Option<i64>,
    exit_code: Option<i32>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionJobStatus {
    pub job_id: String,
    pub name: String,
    pub action: String,
    pub status: String,
    pub log: String,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

static JOBS: OnceLock<Mutex<HashMap<String, RuntimeActionJob>>> = OnceLock::new();

fn jobs() -> &'static Mutex<HashMap<String, RuntimeActionJob>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
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
    for dir in extras {
        if !dir.is_empty() && !dirs.iter().any(|d| d == &dir) {
            dirs.push(dir);
        }
    }
    dirs.join(":")
}

fn append_job_log(job_id: &str, msg: &str) {
    if let Ok(mut map) = jobs().lock() {
        if let Some(job) = map.get_mut(job_id) {
            job.log.push_str(msg);
            if !msg.ends_with('\n') {
                job.log.push('\n');
            }
        }
    }
}

fn set_job_done(job_id: &str, success: bool, exit_code: Option<i32>, err: Option<String>) {
    if let Ok(mut map) = jobs().lock() {
        if let Some(job) = map.get_mut(job_id) {
            job.status = if success {
                "succeeded".to_string()
            } else {
                "failed".to_string()
            };
            job.exit_code = exit_code;
            job.error = err;
            job.finished_at_ms = Some(now_millis());
        }
    }
}

fn check_dep(name: &str, version_args: &[&str], install_hint: &str) -> RuntimeDependencyStatus {
    let path_cmd = format!("command -v {name}");
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

    RuntimeDependencyStatus {
        name: name.to_string(),
        checked: true,
        installed: path_out.is_some(),
        path: path_out,
        version: version_out,
        install_hint: install_hint.to_string(),
    }
}

#[tauri::command]
pub async fn check_runtime_dependency(name: &str) -> Result<RuntimeDependencyStatus, String> {
    let dep_name = name.to_string();
    tauri::async_runtime::spawn_blocking(move || match dep_name.as_str() {
        "git" => Ok(check_dep("git", &["--version"], "brew install git")),
        "entire" => Ok(check_dep(
            "entire",
            &["--version"],
            "brew tap entireio/tap && brew install entireio/tap/entire",
        )),
        "opencode" => Ok(check_dep(
            "opencode",
            &["--version"],
            "brew install anomalyco/tap/opencode (or npm i -g opencode-ai)",
        )),
        _ => Err(format!("unsupported dependency: {}", dep_name)),
    })
    .await
    .map_err(|e| format!("failed to check dependency: {e}"))?
}

fn run_shell_capture(script: &str, timeout_secs: u64) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new("/bin/zsh");
    cmd.args(["-ic", script]);
    cmd.env("PATH", build_path_env());
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("failed to spawn shell: {e}"))?;

    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("failed waiting shell: {e}"))? {
            let out = child
                .stdout
                .take()
                .ok_or_else(|| "missing stdout pipe".to_string())?;
            let err = child
                .stderr
                .take()
                .ok_or_else(|| "missing stderr pipe".to_string())?;
            let mut out_reader = BufReader::new(out);
            let mut err_reader = BufReader::new(err);
            let mut stdout = String::new();
            let mut stderr = String::new();
            out_reader
                .read_to_string(&mut stdout)
                .map_err(|e| format!("read stdout failed: {e}"))?;
            err_reader
                .read_to_string(&mut stderr)
                .map_err(|e| format!("read stderr failed: {e}"))?;
            return Ok((status.code().unwrap_or(-1), stdout, stderr));
        }
        if start.elapsed() > Duration::from_secs(timeout_secs) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("command timed out".to_string());
        }
        thread::sleep(Duration::from_millis(120));
    }
}

fn install_script(name: &str, action: &str) -> Result<&'static str, String> {
    match (name, action) {
        ("git", "install") => Ok(
            r#"if command -v brew >/dev/null 2>&1; then
  brew install git
else
  xcode-select --install || true
  echo "Homebrew not found. Triggered Xcode Command Line Tools installer."
fi"#,
        ),
        ("git", "uninstall") => Ok(
            r#"if command -v brew >/dev/null 2>&1; then
  brew uninstall git || true
else
  echo "Git installed by Xcode Command Line Tools must be removed manually."
fi"#,
        ),
        ("entire", "install") => Ok(
            r#"if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install Entire CLI."
  exit 2
fi
brew tap entireio/tap
brew install entireio/tap/entire"#,
        ),
        ("entire", "uninstall") => Ok(
            r##"if command -v brew >/dev/null 2>&1; then
  brew uninstall entireio/tap/entire || true
fi
if [ -f "$HOME/.local/bin/entire" ]; then
  rm -f "$HOME/.local/bin/entire"
fi
echo "Entire uninstall finished.""##,
        ),
        ("opencode", "install") => Ok(
            r##"if command -v brew >/dev/null 2>&1; then
  brew install anomalyco/tap/opencode
elif command -v npm >/dev/null 2>&1; then
  npm install -g opencode-ai
else
  curl -fsSL https://opencode.ai/install | bash
fi"##,
        ),
        ("opencode", "uninstall") => Ok(
            r##"if command -v opencode >/dev/null 2>&1; then
  opencode uninstall --force || true
fi
if command -v brew >/dev/null 2>&1; then
  brew uninstall anomalyco/tap/opencode || true
fi
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g opencode-ai || true
fi
echo "OpenCode uninstall finished.""##,
        ),
        _ => Err(format!("unsupported action: {action} {name}")),
    }
}

#[tauri::command]
pub async fn check_runtime_requirements() -> RuntimeRequirementsStatus {
    tauri::async_runtime::spawn_blocking(check_runtime_requirements_sync)
        .await
        .unwrap_or_else(|_| check_runtime_requirements_sync())
}

fn check_runtime_requirements_sync() -> RuntimeRequirementsStatus {
    let homebrew = check_dep("brew", &["--version"], "Install Homebrew first.");
    let git = check_dep("git", &["--version"], "brew install git");
    let entire = check_dep(
        "entire",
        &["--version"],
        "brew tap entireio/tap && brew install entireio/tap/entire",
    );
    let opencode = check_dep(
        "opencode",
        &["--version"],
        "brew install anomalyco/tap/opencode (or npm i -g opencode-ai)",
    );
    RuntimeRequirementsStatus {
        platform: std::env::consts::OS.to_string(),
        homebrew_installed: homebrew.installed,
        git,
        entire,
        opencode,
    }
}

#[tauri::command]
pub fn start_runtime_dependency_action(name: &str, action: &str) -> Result<String, String> {
    let script = install_script(name, action)?;
    let job_id = format!("job-{}-{}", now_millis(), std::process::id());
    let job = RuntimeActionJob {
        job_id: job_id.clone(),
        name: name.to_string(),
        action: action.to_string(),
        status: "running".to_string(),
        log: format!("Starting {action} for {name}...\n"),
        started_at_ms: now_millis(),
        finished_at_ms: None,
        exit_code: None,
        error: None,
    };
    {
        let mut map = jobs()
            .lock()
            .map_err(|_| "failed to lock install jobs".to_string())?;
        map.insert(job_id.clone(), job);
    }

    let script_owned = script.to_string();
    let job_id_for_thread = job_id.clone();
    thread::spawn(move || {
        let mut cmd = Command::new("/bin/zsh");
        cmd.args(["-ic", &script_owned]);
        cmd.env("PATH", build_path_env());
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                append_job_log(&job_id_for_thread, &format!("spawn error: {e}"));
                set_job_done(
                    &job_id_for_thread,
                    false,
                    Some(-1),
                    Some(format!("failed to spawn process: {e}")),
                );
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(out) = stdout {
            let jid = job_id_for_thread.clone();
            thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines().map_while(Result::ok) {
                    append_job_log(&jid, &line);
                }
            });
        }

        if let Some(err) = stderr {
            let jid = job_id_for_thread.clone();
            thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().map_while(Result::ok) {
                    append_job_log(&jid, &line);
                }
            });
        }

        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if status.success() {
                        set_job_done(&job_id_for_thread, true, status.code(), None);
                    } else {
                        set_job_done(
                            &job_id_for_thread,
                            false,
                            status.code(),
                            Some(format!("action failed with code {:?}", status.code())),
                        );
                    }
                    break;
                }
                Ok(None) => {
                    if start.elapsed() > Duration::from_secs(INSTALL_TIMEOUT_SECS) {
                        let _ = child.kill();
                        let _ = child.wait();
                        append_job_log(&job_id_for_thread, "installation timed out.");
                        set_job_done(
                            &job_id_for_thread,
                            false,
                            Some(-1),
                            Some("installation timed out".to_string()),
                        );
                        break;
                    }
                    thread::sleep(Duration::from_millis(150));
                }
                Err(e) => {
                    append_job_log(&job_id_for_thread, &format!("wait error: {e}"));
                    set_job_done(
                        &job_id_for_thread,
                        false,
                        Some(-1),
                        Some(format!("failed waiting process: {e}")),
                    );
                    break;
                }
            }
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub fn get_runtime_dependency_action(job_id: &str) -> Result<RuntimeActionJobStatus, String> {
    let map = jobs()
        .lock()
        .map_err(|_| "failed to lock install jobs".to_string())?;
    let job = map
        .get(job_id)
        .ok_or_else(|| format!("job not found: {job_id}"))?;
    Ok(RuntimeActionJobStatus {
        job_id: job.job_id.clone(),
        name: job.name.clone(),
        action: job.action.clone(),
        status: job.status.clone(),
        log: job.log.clone(),
        started_at_ms: job.started_at_ms,
        finished_at_ms: job.finished_at_ms,
        exit_code: job.exit_code,
        error: job.error.clone(),
    })
}

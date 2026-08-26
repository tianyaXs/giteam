use std::ffi::{OsStr, OsString};
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use wait_timeout::ChildExt;

const DEFAULT_COMMAND_TIMEOUT_SECS: u64 = 20;
const MAX_STDERR_CHARS: usize = 4000;
static TEMP_FILE_SEQ: AtomicU64 = AtomicU64::new(1);

#[cfg(unix)]
const EXTRA_BIN_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

fn command_runner_debug_enabled() -> bool {
    matches!(
        std::env::var("GITEAM_TRACE_COMMAND_RUNNER")
            .ok()
            .as_deref()
            .map(str::trim),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn trim_stderr(s: &str) -> String {
    if s.len() <= MAX_STDERR_CHARS {
        return s.to_string();
    }
    format!("{}...(truncated)", &s[..MAX_STDERR_CHARS])
}

fn wait_with_timeout(cmd: &mut Command, timeout: Duration) -> Result<ExitStatus, String> {
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn process: {e}"))?;

    match child
        .wait_timeout(timeout)
        .map_err(|e| format!("failed waiting for process: {e}"))?
    {
        Some(status) => Ok(status),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            Err("command timed out".to_string())
        }
    }
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn build_path_env() -> OsString {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();

    // Agent 私有 rg/fd（~/.giteam/bin），优先于系统扩展目录。
    if let Some(agent_bin) = crate::pi_agent::agent_bin_dir_string() {
        let agent_path = PathBuf::from(agent_bin);
        if !dirs.iter().any(|d| d == &agent_path) {
            dirs.insert(0, agent_path);
        }
    }

    if let Some(home) = user_home_dir() {
        let home_dirs: Vec<PathBuf> = if cfg!(windows) {
            vec![
                home.join("AppData").join("Roaming").join("npm"),
                home.join(".cargo").join("bin"),
                home.join("scoop").join("shims"),
            ]
        } else {
            vec![
                home.join(".npm-global").join("bin"),
                home.join(".local").join("bin"),
                home.join(".cargo").join("bin"),
                home.join("miniconda3").join("bin"),
                home.join("anaconda3").join("bin"),
                home.join(".pyenv").join("shims"),
            ]
        };
        for dir in home_dirs {
            if !dirs.iter().any(|d| d == &dir) {
                dirs.push(dir);
            }
        }
    }

    #[cfg(unix)]
    {
        for dir in EXTRA_BIN_DIRS {
            let path = PathBuf::from(dir);
            if !dirs.iter().any(|d| d == &path) {
                dirs.push(path);
            }
        }
    }

    std::env::join_paths(dirs).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

fn resolve_program(program: &str, path_env: &OsStr) -> Option<PathBuf> {
    let looks_absolute = Path::new(program).is_absolute()
        || program.contains('/')
        || (cfg!(windows) && program.contains('\\'));
    if looks_absolute {
        let path = PathBuf::from(program);
        return path.exists().then_some(path);
    }

    if let Ok(path) = which::which(program) {
        return Some(path);
    }

    for dir in std::env::split_paths(path_env) {
        // Windows：优先 .exe，避免先命中同名 .cmd/.bat 后 CreateProcess 失败。
        #[cfg(windows)]
        {
            for ext in ["exe", "com", "cmd", "bat"] {
                let with_ext = dir.join(format!("{program}.{ext}"));
                if with_ext.is_file() {
                    return Some(with_ext);
                }
            }
        }
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(windows)]
fn is_windows_batch_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("cmd" | "bat")
    )
}

/// Windows 上 `.cmd`/`.bat` 不能直接 CreateProcess，必须经 `cmd.exe /C`，
/// 且参数要拼进 `/C` 后的那一条命令行，否则会被 cmd 丢掉。
fn command_for_program<S: AsRef<OsStr>>(program: PathBuf, args: &[S]) -> Command {
    #[cfg(windows)]
    {
        if is_windows_batch_file(&program) {
            let comspec = std::env::var_os("COMSPEC").unwrap_or_else(|| OsString::from("cmd.exe"));
            let mut cmd = Command::new(comspec);
            let mut line = format!("\"{}\"", program.to_string_lossy());
            for arg in args {
                let raw = arg.as_ref().to_string_lossy();
                line.push(' ');
                if raw.is_empty() {
                    line.push_str("\"\"");
                } else if raw.chars().any(|c| c.is_whitespace() || matches!(c, '"' | '&' | '|' | '<' | '>')) {
                    line.push('"');
                    line.push_str(&raw.replace('"', "\"\""));
                    line.push('"');
                } else {
                    line.push_str(&raw);
                }
            }
            cmd.args(["/D", "/C", &line]);
            return cmd;
        }
    }
    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd
}

#[cfg(windows)]
fn is_wsl_or_store_bash(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    lower.contains(r"\windows\system32\bash.exe")
        || lower.contains(r"\windows\sysnative\bash.exe")
        || lower.contains(r"\windowsapps\")
        || lower.contains(r"\microsoft\windowsapps\")
}

#[cfg(windows)]
fn windows_git_bash_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for key in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        let Ok(root) = std::env::var(key) else {
            continue;
        };
        let base = PathBuf::from(root);
        let prefixes = if key == "LOCALAPPDATA" {
            vec![base.join("Programs").join("Git")]
        } else {
            vec![base.join("Git")]
        };
        for prefix in prefixes {
            out.push(prefix.join("bin").join("bash.exe"));
            out.push(prefix.join("usr").join("bin").join("bash.exe"));
            out.push(prefix.join("bin").join("sh.exe"));
            out.push(prefix.join("usr").join("bin").join("sh.exe"));
        }
    }
    out
}

fn shell_quote(arg: &str) -> String {
    if arg.is_empty() {
        return "''".to_string();
    }
    if !arg.contains('\'') {
        return format!("'{arg}'");
    }
    let escaped = arg.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
}

fn make_temp_log_path(kind: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "giteam-{kind}-{}-{stamp}-{seq}.log",
        std::process::id()
    ))
}

/// 解析当前平台可用于跑脚本 / 交互终端的 shell。
pub fn resolve_login_shell() -> Option<String> {
    #[cfg(unix)]
    {
        [
            std::env::var("SHELL").ok().filter(|s| !s.is_empty()),
            Some("/bin/zsh".to_string()),
            Some("/bin/bash".to_string()),
            Some("/usr/bin/bash".to_string()),
            Some("/bin/sh".to_string()),
        ]
        .into_iter()
        .flatten()
        .find(|path| Path::new(path).exists())
    }
    #[cfg(windows)]
    {
        // 1) 优先 Git for Windows 自带 bash（稳定、POSIX）；跳过 WSL/Store 的 bash.exe。
        for candidate in windows_git_bash_candidates() {
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
        for exe in ["bash", "sh"] {
            if let Ok(path) = which::which(exe) {
                if !is_wsl_or_store_bash(&path) {
                    return Some(path.to_string_lossy().into_owned());
                }
            }
        }
        // 2) PowerShell / cmd
        for exe in ["pwsh", "powershell"] {
            if let Ok(path) = which::which(exe) {
                return Some(path.to_string_lossy().into_owned());
            }
        }
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.trim().is_empty() && Path::new(&comspec).exists() {
                return Some(comspec);
            }
        }
        Some("cmd.exe".to_string())
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

fn shell_kind(shell: &str) -> &'static str {
    let stem = Path::new(shell)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match stem.as_str() {
        "cmd" => "cmd",
        "powershell" | "pwsh" => "powershell",
        _ => "bash",
    }
}

/// 用平台默认 shell 执行一段脚本。
pub fn run_shell_script_in_dir(
    script: &str,
    repo_path: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    let shell = resolve_login_shell().ok_or_else(|| "no usable shell found".to_string())?;
    match shell_kind(&shell) {
        "cmd" => run_and_capture_in_dir_with_timeout(
            &shell,
            &["/C", script],
            repo_path,
            timeout_secs,
        ),
        "powershell" => run_and_capture_in_dir_with_timeout(
            &shell,
            &["-NoProfile", "-Command", script],
            repo_path,
            timeout_secs,
        ),
        _ => {
            // Windows Git Bash 的 -l 会跑 profile 并常 cd ~，破坏 current_dir。
            // 一次性脚本用 -c 即可；交互终端才走 --login（并设 CHERE_INVOKING）。
            let args: &[&str] = if cfg!(windows) {
                &["-c", script]
            } else {
                &["-lc", script]
            };
            run_and_capture_in_dir_with_timeout(&shell, args, repo_path, timeout_secs)
        }
    }
}

pub fn run_and_capture_in_dir<S: AsRef<OsStr>>(
    program: &str,
    args: &[S],
    repo_path: &str,
) -> Result<String, String> {
    run_and_capture_in_dir_with_timeout(program, args, repo_path, DEFAULT_COMMAND_TIMEOUT_SECS)
}

pub fn run_and_capture_in_dir_with_timeout<S: AsRef<OsStr>>(
    program: &str,
    args: &[S],
    repo_path: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    validate_repo_path(repo_path)?;

    let rendered_args = args
        .iter()
        .map(|a| a.as_ref().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(" ");
    if command_runner_debug_enabled() {
        eprintln!(
            "[giteam] exec cwd={} cmd={} {}",
            repo_path, program, rendered_args
        );
    }

    let now = std::time::Instant::now();
    let stdout_path = make_temp_log_path("stdout");
    let stderr_path = make_temp_log_path("stderr");
    let stdout_file = File::create(&stdout_path)
        .map_err(|e| format!("failed creating stdout temp file: {e}"))?;
    let stderr_file = File::create(&stderr_path)
        .map_err(|e| format!("failed creating stderr temp file: {e}"))?;

    let path_env = build_path_env();
    let resolved_program = resolve_program(program, &path_env);
    let mut cmd = if let Some(path) = resolved_program {
        command_for_program(path, args)
    } else if cfg!(unix) {
        // GUI 冷启动 PATH 可能不完整：经 login shell 再解析（仅 Unix）。
        let rendered_shell_args = args
            .iter()
            .map(|a| shell_quote(&a.as_ref().to_string_lossy()))
            .collect::<Vec<_>>()
            .join(" ");
        let script = format!("{program} {rendered_shell_args}");
        let shell = resolve_login_shell().unwrap_or_else(|| "/bin/sh".to_string());
        let mut c = Command::new(shell);
        c.args(["-lc", &script]);
        c
    } else {
        return Err(format!(
            "program not found on PATH: {program} (checked PATH and PATHEXT)"
        ));
    };
    cmd.current_dir(repo_path);
    cmd.env("PATH", &path_env);
    // Force non-pager, non-interactive textual output for CLI tools.
    cmd.env("PAGER", "cat");
    cmd.env("GIT_PAGER", "cat");
    cmd.env("LESS", "FRX");
    cmd.env("ACCESSIBLE", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::from(stdout_file));
    cmd.stderr(Stdio::from(stderr_file));
    let status = wait_with_timeout(&mut cmd, Duration::from_secs(timeout_secs))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    File::open(&stdout_path)
        .and_then(|mut f| f.read_to_string(&mut stdout))
        .map_err(|e| format!("failed reading stdout temp file: {e}"))?;
    File::open(&stderr_path)
        .and_then(|mut f| f.read_to_string(&mut stderr))
        .map_err(|e| format!("failed reading stderr temp file: {e}"))?;
    let _ = fs::remove_file(&stdout_path);
    let _ = fs::remove_file(&stderr_path);

    if command_runner_debug_enabled() {
        eprintln!(
            "[giteam] done code={:?} elapsed_ms={} stdout_chars={} stderr_chars={}",
            status.code(),
            now.elapsed().as_millis(),
            stdout.len(),
            stderr.len()
        );
    }

    if status.success() {
        return Ok(stdout);
    }

    Err(format!(
        "{} failed with code {:?}: {}",
        program,
        status.code(),
        trim_stderr(&stderr)
    ))
}

pub fn validate_commit_sha(input: &str) -> Result<(), String> {
    if input.is_empty() {
        return Err("empty commit sha".to_string());
    }
    if input.len() > 64 {
        return Err("commit sha too long".to_string());
    }
    if input.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(());
    }
    Err("commit sha must be hexadecimal".to_string())
}

pub fn validate_repo_path(repo_path: &str) -> Result<(), String> {
    if repo_path.trim().is_empty() {
        return Err("repo path is empty".to_string());
    }
    let p = Path::new(repo_path);
    if !p.is_dir() {
        return Err(format!(
            "repo path does not exist or is not a directory: {repo_path}"
        ));
    }
    fs::canonicalize(p)
        .map(|_| ())
        .map_err(|e| format!("failed to resolve workspace path: {e}"))
}

use std::ffi::OsStr;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

const DEFAULT_COMMAND_TIMEOUT_SECS: u64 = 20;
const MAX_STDERR_CHARS: usize = 4000;
const EXTRA_BIN_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

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

fn build_path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();
    let home_dirs = [
        format!("{home}/.local/bin"),
        format!("{home}/miniconda3/bin"),
        format!("{home}/anaconda3/bin"),
        format!("{home}/.pyenv/shims"),
    ];
    for dir in home_dirs {
        if !home.is_empty() && !dirs.iter().any(|d| d == &dir) {
            dirs.push(dir);
        }
    }
    for dir in EXTRA_BIN_DIRS {
        if !dirs.iter().any(|d| d == dir) {
            dirs.push((*dir).to_string());
        }
    }
    dirs.join(":")
}

fn resolve_program(program: &str, path_env: &str) -> Option<PathBuf> {
    if program.contains('/') {
        let path = PathBuf::from(program);
        return path.exists().then_some(path);
    }
    for dir in path_env.split(':').filter(|s| !s.trim().is_empty()) {
        let candidate = Path::new(dir).join(program);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
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
    eprintln!("[giteam] exec cwd={} cmd={} {}", repo_path, program, rendered_args);

    let now = std::time::Instant::now();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let stdout_path = std::env::temp_dir().join(format!("giteam-stdout-{}-{}.log", std::process::id(), stamp));
    let stderr_path = std::env::temp_dir().join(format!("giteam-stderr-{}-{}.log", std::process::id(), stamp));
    let stdout_file = File::create(&stdout_path).map_err(|e| format!("failed creating stdout temp file: {e}"))?;
    let stderr_file = File::create(&stderr_path).map_err(|e| format!("failed creating stderr temp file: {e}"))?;

    let path_env = build_path_env();
    let resolved_program = resolve_program(program, &path_env);
    let mut cmd = if let Some(path) = resolved_program {
        let mut c = Command::new(path);
        c.args(args);
        c
    } else {
        // Fallback for GUI-launched apps on macOS: PATH may not include user-installed CLIs.
        // Execute via login shell so user PATH initialization can resolve tools like `entire`.
        let rendered_shell_args = args
            .iter()
            .map(|a| shell_quote(&a.as_ref().to_string_lossy()))
            .collect::<Vec<_>>()
            .join(" ");
        let script = format!("{program} {rendered_shell_args}");
        let mut c = Command::new("/bin/zsh");
        c.args(["-ic", &script]);
        c
    };
    cmd.current_dir(repo_path);
    cmd.env("PATH", path_env);
    // Force non-pager, non-interactive textual output for CLI tools.
    cmd.env("PAGER", "cat");
    cmd.env("GIT_PAGER", "cat");
    cmd.env("LESS", "FRX");
    cmd.env("ACCESSIBLE", "1");
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

    eprintln!(
        "[giteam] done code={:?} elapsed_ms={} stdout_chars={} stderr_chars={}",
        status.code(),
        now.elapsed().as_millis(),
        stdout.len(),
        stderr.len()
    );

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
        return Err(format!("repo path does not exist or is not a directory: {repo_path}"));
    }
    let git_dir = p.join(".git");
    if !git_dir.exists() {
        return Err(format!("not a git repository: {repo_path}"));
    }
    fs::canonicalize(p)
        .map(|_| ())
        .map_err(|e| format!("failed to resolve repo path: {e}"))
}

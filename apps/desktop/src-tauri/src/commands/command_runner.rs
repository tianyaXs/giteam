use std::ffi::OsStr;
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

const DEFAULT_COMMAND_TIMEOUT_SECS: u64 = 20;
const MAX_STDERR_CHARS: usize = 4000;

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

    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.current_dir(repo_path);
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

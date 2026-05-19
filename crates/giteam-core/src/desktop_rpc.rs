use super::command_runner;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const TERMINAL_MAX_BUFFER_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub sha: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchSummary {
    pub is_current: bool,
    pub is_remote: bool,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphNode {
    pub graph: String,
    pub sha: String,
    pub parents: Vec<String>,
    pub date: String,
    pub author: String,
    pub refs: String,
    pub subject: String,
    pub is_connector: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeEntry {
    pub path: String,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeOverview {
    pub branch: String,
    pub tracking: String,
    pub ahead: u32,
    pub behind: u32,
    pub clean: bool,
    pub staged_count: u32,
    pub unstaged_count: u32,
    pub untracked_count: u32,
    pub entries: Vec<GitWorktreeEntry>,
    pub raw: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLinkedWorktree {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_current: bool,
    pub is_main_worktree: bool,
    pub is_detached: bool,
    pub clean: bool,
    pub staged_count: u32,
    pub unstaged_count: u32,
    pub untracked_count: u32,
    pub locked: String,
    pub prunable: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateResult {
    pub path: String,
    pub branch: String,
    pub head: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeRemoveResult {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUserIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeFileContent {
    pub original: String,
    pub modified: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoTerminalSnapshot {
    pub output: String,
    pub seq: u64,
    pub alive: bool,
    pub cwd: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFinding {
    pub id: String,
    pub severity: String,
    pub file: String,
    pub summary: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRecord {
    pub id: String,
    pub repo_path: String,
    pub commit_sha: String,
    pub status: String,
    pub summary: String,
    pub findings: Vec<ReviewFinding>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAction {
    pub id: String,
    pub repo_path: String,
    pub review_id: String,
    pub finding_id: String,
    pub action: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub added_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyStatus {
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub install_hint: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirementsStatus {
    pub ok: bool,
    pub git: RuntimeDependencyStatus,
    pub entire: RuntimeDependencyStatus,
    pub opencode: RuntimeDependencyStatus,
    pub giteam: RuntimeDependencyStatus,
}

#[derive(Debug, Serialize, Deserialize)]
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

static JOBS: OnceLock<Mutex<HashMap<String, RuntimeActionJob>>> = OnceLock::new();

fn jobs() -> &'static Mutex<HashMap<String, RuntimeActionJob>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
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

const INSTALL_TIMEOUT_SECS: u64 = 15 * 60;

// Terminal session management
#[derive(Debug)]
struct TerminalChunk {
    seq: u64,
    text: String,
    bytes: usize,
}

#[derive(Debug, Default)]
struct TerminalBuffer {
    chunks: VecDeque<TerminalChunk>,
    next_seq: u64,
    total_bytes: usize,
}

impl TerminalBuffer {
    fn push(&mut self, text: String) {
        if text.is_empty() {
            return;
        }
        self.next_seq += 1;
        let bytes = text.len();
        self.total_bytes += bytes;
        self.chunks.push_back(TerminalChunk {
            seq: self.next_seq,
            text,
            bytes,
        });
        while self.total_bytes > TERMINAL_MAX_BUFFER_BYTES {
            let Some(front) = self.chunks.pop_front() else { break };
            self.total_bytes = self.total_bytes.saturating_sub(front.bytes);
        }
    }

    fn clear(&mut self) {
        self.chunks.clear();
        self.total_bytes = 0;
    }

    fn read_after(&self, after_seq: u64) -> (u64, String) {
        let mut out = String::new();
        for chunk in self.chunks.iter() {
            if chunk.seq > after_seq {
                out.push_str(&chunk.text);
            }
        }
        (self.next_seq, out)
    }
}

#[derive(Debug)]
struct ManagedRepoTerminalSession {
    child: Child,
    stdin: ChildStdin,
    buffer: Arc<Mutex<TerminalBuffer>>,
    cwd: String,
}

static REPO_TERMINAL_SESSIONS: OnceLock<Mutex<HashMap<String, ManagedRepoTerminalSession>>> =
    OnceLock::new();

fn terminal_sessions() -> &'static Mutex<HashMap<String, ManagedRepoTerminalSession>> {
    REPO_TERMINAL_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn normalize_repo_key(repo_path: &str) -> Result<String, String> {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        return Err("repo path is empty".to_string());
    }
    let path = std::path::Path::new(trimmed);
    if !path.exists() {
        return Err(format!("repo path does not exist: {trimmed}"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("failed to resolve repo path: {e}"))?;
    Ok(canonical.to_string_lossy().to_string())
}

fn normalize_terminal_id(session_id: Option<&str>) -> String {
    session_id.unwrap_or("default").trim().to_string()
}

fn make_terminal_key(repo_key: &str, terminal_id: &str) -> String {
    format!("{}#{}", repo_key, terminal_id)
}

fn spawn_terminal_reader<R>(mut reader: R, buffer: Arc<Mutex<TerminalBuffer>>)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut tmp = [0u8; 4096];
        loop {
            match reader.read(&mut tmp) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&tmp[..n]).to_string();
                    if let Ok(mut guard) = buffer.lock() {
                        guard.push(text);
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn session_alive(session: &mut ManagedRepoTerminalSession) -> bool {
    match session.child.try_wait() {
        Ok(None) => true,
        _ => false,
    }
}

fn spawn_repo_terminal_session(repo_path: &str) -> Result<ManagedRepoTerminalSession, String> {
    let repo = normalize_repo_key(repo_path)?;
    let mut child = Command::new("/usr/bin/script")
        .args(["-q", "/dev/null", "/bin/zsh", "-i"])
        .env("GITEAM_EMBEDDED_TERMINAL", "1")
        .env("TERM", "dumb")
        .env("CLICOLOR", "0")
        .current_dir(&repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn terminal: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to acquire terminal stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to acquire terminal stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to acquire terminal stderr".to_string())?;
    let buffer = Arc::new(Mutex::new(TerminalBuffer::default()));
    spawn_terminal_reader(stdout, Arc::clone(&buffer));
    spawn_terminal_reader(stderr, Arc::clone(&buffer));
    Ok(ManagedRepoTerminalSession {
        child,
        stdin,
        buffer,
        cwd: repo,
    })
}

fn ensure_terminal_session(repo_path: &str, session_id: Option<&str>) -> Result<String, String> {
    let repo_key = normalize_repo_key(repo_path)?;
    let tid = normalize_terminal_id(session_id);
    let key = make_terminal_key(&repo_key, &tid);
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    if let Some(session) = sessions.get_mut(&key) {
        if session_alive(session) {
            return Ok(key);
        }
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    let new_session = spawn_repo_terminal_session(&repo_key)?;
    sessions.insert(key.clone(), new_session);
    Ok(key)
}

fn read_terminal_snapshot(
    repo_path: &str,
    session_id: Option<&str>,
    after_seq: u64,
) -> Result<RepoTerminalSnapshot, String> {
    let key = ensure_terminal_session(repo_path, session_id)?;
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    let Some(session) = sessions.get_mut(&key) else {
        return Ok(RepoTerminalSnapshot {
            output: String::new(),
            seq: after_seq,
            alive: false,
            cwd: repo_path.to_string(),
        });
    };
    let alive = session_alive(session);
    let (seq, output) = {
        let guard = session
            .buffer
            .lock()
            .map_err(|_| "failed to lock terminal buffer".to_string())?;
        guard.read_after(after_seq)
    };
    Ok(RepoTerminalSnapshot {
        output,
        seq,
        alive,
        cwd: session.cwd.clone(),
    })
}

fn close_terminal_session(repo_path: &str, session_id: Option<&str>) -> Result<(), String> {
    let repo_key = normalize_repo_key(repo_path)?;
    let tid = normalize_terminal_id(session_id);
    let key = make_terminal_key(&repo_key, &tid);
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    if let Some(mut session) = sessions.remove(&key) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

// Git helpers
fn run_git(args: &[&str], repo_path: &str) -> Result<String, String> {
    command_runner::run_and_capture_in_dir("git", args, repo_path)
}

fn run_git_with_timeout(args: &[&str], repo_path: &str, timeout_secs: u64) -> Result<String, String> {
    command_runner::run_and_capture_in_dir_with_timeout("git", args, repo_path, timeout_secs)
}

fn decode_git_quoted_path(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            let mut octal = String::with_capacity(3);
            for _ in 0..3 {
                if let Some(&next) = chars.peek() {
                    if next.is_ascii_digit() && next != '8' && next != '9' {
                        octal.push(next);
                        chars.next();
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            if octal.len() == 3 {
                if let Ok(byte) = u8::from_str_radix(&octal, 8) {
                    bytes.push(byte);
                    continue;
                }
            }
            bytes.push(b'\\');
            bytes.extend(octal.bytes());
        } else if ch == '"' {
            continue;
        } else {
            let mut buf = [0u8; 4];
            let s = ch.encode_utf8(&mut buf);
            bytes.extend(s.bytes());
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).to_string())
}

fn parse_worktree_overview(raw: String) -> GitWorktreeOverview {
    let mut branch = String::new();
    let mut tracking = String::new();
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut staged_count = 0u32;
    let mut unstaged_count = 0u32;
    let mut untracked_count = 0u32;
    let mut entries = Vec::new();

    for (idx, line) in raw.lines().enumerate() {
        if idx == 0 && line.starts_with("## ") {
            let head = line.trim_start_matches("## ").trim();
            let mut branch_part = head;
            let mut meta_part = "";
            if let Some((lhs, rhs)) = head.split_once("...") {
                branch_part = lhs.trim();
                meta_part = rhs.trim();
            }
            branch = branch_part.to_string();
            if !meta_part.is_empty() {
                if let Some((tracking_name, rest)) = meta_part.split_once(' ') {
                    tracking = tracking_name.trim().to_string();
                    let meta = rest.trim();
                    if let Some(start) = meta.find('[') {
                        if let Some(end) = meta.rfind(']') {
                            let body = &meta[start + 1..end];
                            for item in body.split(',') {
                                let it = item.trim();
                                if let Some(v) = it.strip_prefix("ahead ") {
                                    ahead = v.trim().parse::<u32>().unwrap_or(0);
                                } else if let Some(v) = it.strip_prefix("behind ") {
                                    behind = v.trim().parse::<u32>().unwrap_or(0);
                                }
                            }
                        }
                    }
                } else {
                    tracking = meta_part.to_string();
                }
            }
            continue;
        }

        let index_status = line.chars().next().unwrap_or(' ');
        let worktree_status = line.chars().nth(1).unwrap_or(' ');
        let raw_path = line.get(3..).unwrap_or("").trim();
        let path = decode_git_quoted_path(raw_path);
        if path.is_empty() {
            continue;
        }
        let staged = index_status != ' ' && index_status != '?';
        let unstaged = worktree_status != ' ' && worktree_status != '?';
        let untracked = index_status == '?' || worktree_status == '?';
        if staged {
            staged_count += 1;
        }
        if unstaged {
            unstaged_count += 1;
        }
        if untracked {
            untracked_count += 1;
        }
        entries.push(GitWorktreeEntry {
            path,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
            staged,
            unstaged,
            untracked,
        });
    }

    GitWorktreeOverview {
        branch,
        tracking,
        ahead,
        behind,
        clean: entries.is_empty(),
        staged_count,
        unstaged_count,
        untracked_count,
        entries,
        raw,
    }
}

fn sanitize_branch_for_dir(branch: &str) -> String {
    let mut out = String::new();
    for ch in branch.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "worktree".to_string()
    } else {
        trimmed
    }
}

fn main_worktree_root(repo_path: &str) -> Result<PathBuf, String> {
    let common_dir = run_git(&["rev-parse", "--git-common-dir"], repo_path)?;
    let common = std::path::Path::new(common_dir.trim());
    let absolute = if common.is_absolute() {
        common.to_path_buf()
    } else {
        normalize_repo_key(repo_path).map(PathBuf::from)?.join(common)
    };
    absolute
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "failed to resolve main worktree root".to_string())
}

fn split_fields<'a>(line: &'a str, sep: char) -> Vec<&'a str> {
    if line.contains(sep) {
        return line.split(sep).collect();
    }
    if line.contains("%x1f") {
        return line.split("%x1f").collect();
    }
    if line.contains("^_") {
        return line.split("^_").collect();
    }
    vec![line]
}

// DB helpers (CLI-compatible paths)
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn legacy_db_path() -> Option<PathBuf> {
    let root = std::env::current_dir().ok()?;
    Some(root.join(".giteam").join("client.db"))
}

fn cli_db_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let h = home.trim();
            if !h.is_empty() {
                return Ok(PathBuf::from(h)
                    .join("Library")
                    .join("Application Support")
                    .join("giteam"));
            }
        }
    }
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg.trim();
        if !p.is_empty() {
            return Ok(PathBuf::from(p).join("giteam"));
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            return Ok(PathBuf::from(h).join(".config").join("giteam"));
        }
    }
    Err("cannot resolve db directory".to_string())
}

fn db_path() -> Result<PathBuf, String> {
    let dir = cli_db_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create db directory: {e}"))?;
    let db = dir.join("client.db");
    if !db.exists() {
        if let Some(legacy) = legacy_db_path() {
            if legacy.exists() {
                fs::copy(&legacy, &db)
                    .map_err(|e| format!("cannot migrate legacy database: {e}"))?;
            }
        }
    }
    Ok(db)
}

fn column_exists(conn: &Connection, table: &str, col: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| format!("prepare pragma failed: {e}"))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("query pragma failed: {e}"))?;
    while let Some(row) = rows.next().map_err(|e| format!("iterate pragma failed: {e}"))? {
        let name: String = row.get(1).map_err(|e| format!("read pragma row failed: {e}"))?;
        if name == col {
            return Ok(true);
        }
    }
    Ok(false)
}

fn open_db() -> Result<Connection, String> {
    let path = db_path()?;
    let conn = Connection::open(path).map_err(|e| format!("open sqlite failed: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS review_records (
            id TEXT PRIMARY KEY,
            repo_path TEXT NOT NULL DEFAULT '',
            commit_sha TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL,
            findings_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("migrate sqlite failed: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS review_actions (
            id TEXT PRIMARY KEY,
            repo_path TEXT NOT NULL,
            review_id TEXT NOT NULL,
            finding_id TEXT NOT NULL,
            action TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("migrate review_actions failed: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS repositories (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            added_at TEXT NOT NULL,
            added_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("migrate repositories failed: {e}"))?;

    if !column_exists(&conn, "review_records", "repo_path")? {
        conn.execute_batch("ALTER TABLE review_records ADD COLUMN repo_path TEXT NOT NULL DEFAULT '';")
            .map_err(|e| format!("add repo_path column failed: {e}"))?;
    }
    Ok(conn)
}

fn chrono_like_now() -> String {
    format!("{}", now_millis())
}

// Entire helpers
fn run_entire(args: &[&str], repo_path: &str) -> Result<String, String> {
    command_runner::run_and_capture_in_dir("entire", args, repo_path)
}

// Environment helpers
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
    let extra = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
    for dir in extra {
        if !dirs.iter().any(|d| d == dir) {
            dirs.push((*dir).to_string());
        }
    }
    dirs.join(":")
}

fn check_dep(name: &str, version_args: &[&str], install_hint: &str) -> RuntimeDependencyStatus {
    let path_env = build_path_env();
    let mut cmd = Command::new("/bin/zsh");
    cmd.arg("-ic");
    let script = format!("{} {}", shell_quote(name), version_args.join(" "));
    cmd.arg(&script);
    cmd.env("PATH", path_env);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let output = cmd.output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let path = which::which(name).ok().map(|p| p.to_string_lossy().to_string());
            let version = if stdout.is_empty() {
                None
            } else {
                Some(stdout)
            };
            RuntimeDependencyStatus {
                name: name.to_string(),
                installed: o.status.success(),
                version,
                path,
                install_hint: install_hint.to_string(),
            }
        }
        Err(_) => RuntimeDependencyStatus {
            name: name.to_string(),
            installed: false,
            version: None,
            path: None,
            install_hint: install_hint.to_string(),
        },
    }
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

fn install_script(name: &str, action: &str) -> Result<&'static str, String> {
    match (name, action) {
        ("git", "install") => Ok(r#"if command -v brew >/dev/null 2>&1; then
  brew install git
else
  xcode-select --install || true
  echo "Homebrew not found. Triggered Xcode Command Line Tools installer."
fi"#),
        ("git", "uninstall") => Ok(r#"if command -v brew >/dev/null 2>&1; then
  brew uninstall git || true
else
  echo "Git installed by Xcode Command Line Tools must be removed manually."
fi"#),
        ("entire", "install") => Ok(r#"if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install Entire CLI."
  exit 2
fi
brew tap entireio/tap
brew install entireio/tap/entire"#),
        ("entire", "uninstall") => Ok(r##"if command -v brew >/dev/null 2>&1; then
  brew uninstall entireio/tap/entire || true
fi
if [ -f "$HOME/.local/bin/entire" ]; then
  rm -f "$HOME/.local/bin/entire"
fi
echo "Entire uninstall finished."##),
        ("opencode", "install") => Ok(r##"if command -v brew >/dev/null 2>&1; then
  brew install anomalyco/tap/opencode
elif command -v npm >/dev/null 2>&1; then
  npm install -g opencode-ai
else
  curl -fsSL https://opencode.ai/install | bash
fi"##),
        ("opencode", "uninstall") => Ok(r##"if command -v opencode >/dev/null 2>&1; then
  opencode uninstall --force || true
fi
if command -v brew >/dev/null 2>&1; then
  brew uninstall anomalyco/tap/opencode || true
fi
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g opencode-ai || true
fi
echo "OpenCode uninstall finished."##),
        ("giteam", "install") | ("giteam", "update") => Ok(r##"NPM_CMD=""
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
# Install the highest published version, ignoring dist-tags.
# Do NOT rely on `node` existing in GUI PATH; use python3 to parse JSON.
PYTHON_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD=$(command -v python3)
else
  for p in "/usr/bin/python3" "/opt/homebrew/bin/python3" "$HOME/.pyenv/shims/python3" "/opt/homebrew/Caskroom/miniconda/base/bin/python3" "/opt/homebrew/Caskroom/miniconda3/base/bin/python3"; do
    if [ -x "$p" ]; then
      PYTHON_CMD=$p
      break
    fi
  done
fi
if [ -z "$PYTHON_CMD" ]; then
  echo "python3 is required to install latest giteam version (not found in PATH)."
  exit 2
fi
VERSIONS_JSON=$("$NPM_CMD" view giteam versions --json 2>/dev/null || true)
LATEST=$("$NPM_CMD" view giteam versions --json 2>/dev/null | "$PYTHON_CMD" -c 'import json,sys; raw=sys.stdin.read().strip();
import sys as _s
try: arr=json.loads(raw) if raw else []
except Exception: arr=[]
_s.stdout.write(str(arr[-1]).strip() if isinstance(arr,list) and arr else "")')
echo "[giteam] versions=$(echo "$VERSIONS_JSON" | tr -d '\n' | cut -c1-2000)"
echo "[giteam] resolved_latest=$LATEST"
if [ -z "$LATEST" ]; then
  echo "[giteam] falling back to dist-tag latest"
  "$NPM_CMD" install -g giteam@latest
else
  "$NPM_CMD" install -g "giteam@$LATEST"
fi
PREFIX=$("$NPM_CMD" prefix -g)
BIN="$PREFIX/bin/giteam"
if [ -x "$BIN" ]; then
  echo "[giteam] installed_version=$("$BIN" --version 2>/dev/null | head -1 | tr -d '\r')"
  echo "[giteam] installed_bin=$BIN"
else
  echo "[giteam] install finished but bin not found at $BIN"
fi"##),
        ("giteam", "uninstall") => Ok(r##"NPM_CMD=""
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
echo "giteam uninstall finished."##),
        _ => Err(format!("unsupported action: {action} {name}")),
    }
}

// Main RPC dispatcher
pub fn handle_desktop_rpc(command: &str, args: Value) -> Result<Value, String> {
    match command {
        // Git commands
        "run_git_head_commit" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_git(&["rev-parse", "HEAD"], repo_path)?;
            Ok(Value::String(result))
        }
        "run_git_pull" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_git_with_timeout(&["pull", "--ff-only"], repo_path, 90)?;
            Ok(Value::String(result))
        }
        "run_git_push" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_git_with_timeout(&["push"], repo_path, 90)?;
            Ok(Value::String(result))
        }
        "run_git_commit" => {
            let repo_path = get_str(&args, "repoPath")?;
            let message = get_str(&args, "message")?;
            let m = message.trim();
            if m.is_empty() {
                return Err("commit message must not be empty".to_string());
            }
            let result = run_git(&["commit", "-m", m], repo_path)?;
            Ok(Value::String(result))
        }
        "run_git_show_patch" => {
            let commit_sha = get_str(&args, "commitSha")?;
            let repo_path = get_str(&args, "repoPath")?;
            command_runner::validate_commit_sha(commit_sha)?;
            let result = run_git(&["show", "--patch", "--format=fuller", commit_sha], repo_path)?;
            Ok(Value::String(result))
        }
        "run_git_recent_commits" => {
            let repo_path = get_str(&args, "repoPath")?;
            let limit = get_u32_opt(&args, "limit").unwrap_or(30).clamp(1, 200);
            let sep = '\u{1f}';
            let pretty = format!("%H{sep}%an{sep}%ad{sep}%s");
            let raw = run_git(
                &["log", &format!("-n{limit}"), "--date=iso-strict", &format!("--pretty=format:{pretty}")],
                repo_path,
            )?;
            let mut commits = Vec::new();
            for line in raw.lines() {
                let parts = split_fields(line, sep);
                let sha = parts.first().copied().unwrap_or("").trim().to_string();
                let author = parts.get(1).copied().unwrap_or("").trim().to_string();
                let date = parts.get(2).copied().unwrap_or("").trim().to_string();
                let subject = parts.get(3).copied().unwrap_or("").trim().to_string();
                if sha.is_empty() { continue; }
                commits.push(GitCommitSummary { sha, author, date, subject });
            }
            serde_json::to_value(commits).map_err(|e| e.to_string())
        }
        "run_git_local_branches" => {
            let repo_path = get_str(&args, "repoPath")?;
            let local_raw = run_git(&["for-each-ref", "--format=%(refname:short)", "refs/heads"], repo_path)
                .or_else(|_| run_git(&["branch", "--list"], repo_path))
                .unwrap_or_default();
            let remote_raw = run_git(&["for-each-ref", "--format=%(refname:short)", "refs/remotes"], repo_path)
                .unwrap_or_default();
            let current = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            let mut seen = std::collections::HashSet::new();
            let mut branches = Vec::new();
            for line in local_raw.lines() {
                let mut name = line.trim().to_string();
                if name.starts_with('*') { name = name.trim_start_matches('*').trim().to_string(); }
                if name.is_empty() || name.starts_with("entire/") { continue; }
                seen.insert(name.clone());
                branches.push(GitBranchSummary { is_current: name == current, is_remote: false, name });
            }
            for line in remote_raw.lines() {
                let name = line.trim().to_string();
                if name.is_empty() || name.starts_with("entire/") { continue; }
                if name.contains(" -> ") { continue; }
                if seen.contains(&name) { continue; }
                seen.insert(name.clone());
                branches.push(GitBranchSummary { is_current: false, is_remote: true, name });
            }
            if branches.is_empty() && !current.is_empty() && current != "HEAD" && !current.starts_with("entire/") {
                branches.push(GitBranchSummary { name: current, is_current: true, is_remote: false });
            }
            serde_json::to_value(branches).map_err(|e| e.to_string())
        }
        "run_git_branch_commits" => {
            let repo_path = get_str(&args, "repoPath")?;
            let branch_name = get_str(&args, "branchName")?;
            let limit = get_u32_opt(&args, "limit").unwrap_or(30).clamp(1, 200);
            let sep = '\u{1f}';
            let pretty = format!("%H{sep}%an{sep}%ad{sep}%s");
            let raw = run_git(
                &["log", branch_name, &format!("-n{limit}"), "--date=iso-strict", &format!("--pretty=format:{pretty}")],
                repo_path,
            )?;
            let mut commits = Vec::new();
            for line in raw.lines() {
                let parts = split_fields(line, sep);
                let sha = parts.first().copied().unwrap_or("").trim().to_string();
                let author = parts.get(1).copied().unwrap_or("").trim().to_string();
                let date = parts.get(2).copied().unwrap_or("").trim().to_string();
                let subject = parts.get(3).copied().unwrap_or("").trim().to_string();
                if sha.is_empty() { continue; }
                commits.push(GitCommitSummary { sha, author, date, subject });
            }
            serde_json::to_value(commits).map_err(|e| e.to_string())
        }
        "run_git_commit_graph" => {
            let repo_path = get_str(&args, "repoPath")?;
            let limit = get_u32_opt(&args, "limit").unwrap_or(120).clamp(20, 300);
            let sep = '\u{1f}';
            let pretty = format!("{sep}%H{sep}%P{sep}%ad{sep}%an{sep}%d{sep}%s");
            let raw = run_git(
                &["log", "--graph", "--decorate=short", "--date-order", "--all", &format!("-n{limit}"), "--date=short", &format!("--pretty=format:{pretty}")],
                repo_path,
            )?;
            let mut nodes = Vec::new();
            for line in raw.lines() {
                let parts = split_fields(line, sep);
                if parts.len() < 7 {
                    let graph = parts.first().copied().unwrap_or("").to_string();
                    if graph.is_empty() { continue; }
                    nodes.push(GitGraphNode { graph, sha: String::new(), parents: Vec::new(), date: String::new(), author: String::new(), refs: String::new(), subject: String::new(), is_connector: true });
                    continue;
                }
                let graph = parts.first().copied().unwrap_or("").to_string();
                let sha = parts.get(1).copied().unwrap_or("").trim().to_string();
                if sha.is_empty() {
                    if graph.is_empty() { continue; }
                    nodes.push(GitGraphNode { graph, sha: String::new(), parents: Vec::new(), date: String::new(), author: String::new(), refs: String::new(), subject: String::new(), is_connector: true });
                    continue;
                }
                let parents_raw = parts.get(2).copied().unwrap_or("").trim();
                let parents: Vec<String> = parents_raw.split_whitespace().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
                nodes.push(GitGraphNode {
                    graph, sha, parents,
                    date: parts.get(3).copied().unwrap_or("").trim().to_string(),
                    author: parts.get(4).copied().unwrap_or("").trim().to_string(),
                    refs: parts.get(5).copied().unwrap_or("").trim().to_string(),
                    subject: parts.get(6).copied().unwrap_or("").trim().to_string(),
                    is_connector: false,
                });
            }
            serde_json::to_value(nodes).map_err(|e| e.to_string())
        }
        "run_git_commit_changed_files" => {
            let repo_path = get_str(&args, "repoPath")?;
            let commit_sha = get_str(&args, "commitSha")?;
            command_runner::validate_commit_sha(commit_sha)?;
            let raw = run_git(&["show", "--pretty=format:", "--name-only", commit_sha], repo_path)?;
            let mut files = Vec::new();
            for line in raw.lines() {
                let name = line.trim();
                if !name.is_empty() { files.push(name.to_string()); }
            }
            serde_json::to_value(files).map_err(|e| e.to_string())
        }
        "run_git_commit_file_patch" => {
            let repo_path = get_str(&args, "repoPath")?;
            let commit_sha = get_str(&args, "commitSha")?;
            let file_path = get_str(&args, "filePath")?;
            command_runner::validate_commit_sha(commit_sha)?;
            if file_path.trim().is_empty() { return Err("file path is empty".to_string()); }
            if file_path.contains('\n') || file_path.contains('\r') { return Err("file path contains invalid line breaks".to_string()); }
            let result = run_git(&["show", "--format=", "--patch", commit_sha, "--", file_path], repo_path)?;
            Ok(Value::String(result))
        }
        "run_git_worktree_overview" => {
            let repo_path = get_str(&args, "repoPath")?;
            let raw = run_git(&["status", "--short", "--branch"], repo_path)?;
            let mut overview = parse_worktree_overview(raw);
            if overview.branch.is_empty() {
                overview.branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path).unwrap_or_default().trim().to_string();
            }
            serde_json::to_value(overview).map_err(|e| e.to_string())
        }
        "run_git_worktree_list" => {
            let repo_path = get_str(&args, "repoPath")?;
            let raw = run_git(&["worktree", "list", "--porcelain"], repo_path)?;
            let mut rows = Vec::new();
            let current_key = normalize_repo_key(repo_path).unwrap_or_else(|_| repo_path.trim().to_string());
            let mut path = String::new();
            let mut head = String::new();
            let mut branch = String::new();
            let mut locked = String::new();
            let mut prunable = String::new();
            let mut is_current = false;
            let mut is_detached = false;

            let push_current = |rows: &mut Vec<GitLinkedWorktree>, path: &mut String, branch: &mut String, head: &mut String, locked: &mut String, prunable: &mut String, is_current: &mut bool, is_detached: &mut bool| {
                if path.trim().is_empty() { return; }
                let overview = run_git(&["status", "--short", "--branch"], path).map(parse_worktree_overview).unwrap_or_else(|_| parse_worktree_overview(String::new()));
                let is_main_worktree = rows.is_empty();
                rows.push(GitLinkedWorktree {
                    path: path.trim().to_string(),
                    branch: if branch.trim().is_empty() { overview.branch.clone() } else { branch.trim().to_string() },
                    head: head.trim().to_string(),
                    is_current: *is_current,
                    is_main_worktree,
                    is_detached: *is_detached,
                    clean: overview.clean,
                    staged_count: overview.staged_count,
                    unstaged_count: overview.unstaged_count,
                    untracked_count: overview.untracked_count,
                    locked: locked.trim().to_string(),
                    prunable: prunable.trim().to_string(),
                });
                path.clear(); branch.clear(); head.clear(); locked.clear(); prunable.clear();
                *is_current = false; *is_detached = false;
            };

            for line in raw.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    push_current(&mut rows, &mut path, &mut branch, &mut head, &mut locked, &mut prunable, &mut is_current, &mut is_detached);
                    continue;
                }
                if let Some(v) = trimmed.strip_prefix("worktree ") {
                    path = v.trim().to_string();
                    is_current = normalize_repo_key(&path).unwrap_or_else(|_| path.trim().to_string()) == current_key;
                    continue;
                }
                if let Some(v) = trimmed.strip_prefix("HEAD ") { head = v.trim().to_string(); continue; }
                if let Some(v) = trimmed.strip_prefix("branch ") {
                    let raw_branch = v.trim();
                    branch = raw_branch.strip_prefix("refs/heads/").unwrap_or(raw_branch).trim().to_string();
                    continue;
                }
                if let Some(v) = trimmed.strip_prefix("locked") { locked = v.trim().to_string(); continue; }
                if let Some(v) = trimmed.strip_prefix("prunable") { prunable = v.trim().to_string(); continue; }
                if trimmed == "detached" { is_detached = true; if branch.is_empty() { branch = "(detached)".to_string(); } }
            }
            push_current(&mut rows, &mut path, &mut branch, &mut head, &mut locked, &mut prunable, &mut is_current, &mut is_detached);
            if let Some(current_idx) = rows.iter().position(|row| row.is_current) {
                let current = rows.remove(current_idx);
                rows.insert(0, current);
            }
            serde_json::to_value(rows).map_err(|e| e.to_string())
        }
        "run_git_checkout_branch" => {
            let repo_path = get_str(&args, "repoPath")?;
            let branch_name = get_str(&args, "branchName")?;
            let branch = branch_name.trim();
            if branch.is_empty() { return Err("branch name is empty".to_string()); }
            if branch.contains('\n') || branch.contains('\r') { return Err("branch name contains invalid line breaks".to_string()); }
            let result = run_git_with_timeout(&["checkout", branch], repo_path, 60)?;
            Ok(Value::String(result))
        }
        "run_git_checkout_remote_branch" => {
            let repo_path = get_str(&args, "repoPath")?;
            let remote_branch = get_str(&args, "remoteBranch")?;
            let local_branch = get_str_opt(&args, "localBranch");
            let remote = remote_branch.trim();
            if remote.is_empty() { return Err("remote branch name is empty".to_string()); }
            let local = local_branch.map(|s| s.trim().to_string()).unwrap_or_else(|| remote.split('/').nth(1).unwrap_or(remote).to_string());
            if local.is_empty() { return Err("local branch name is empty".to_string()); }
            let result = run_git_with_timeout(&["checkout", "-b", &local, remote], repo_path, 60)?;
            Ok(Value::String(result))
        }
        "run_git_discard_changes" => {
            let repo_path = get_str(&args, "repoPath")?;
            let file_path = get_str(&args, "filePath")?;
            let is_untracked = get_bool(&args, "isUntracked");
            let path = file_path.trim();
            if path.is_empty() { return Err("file path is empty".to_string()); }
            let result = if is_untracked {
                run_git(&["clean", "-f", "--", path], repo_path)?
            } else {
                run_git(&["restore", "--source=HEAD", "--staged", "--worktree", "--", path], repo_path)?
            };
            Ok(Value::String(result))
        }
        "run_git_stage_file" => {
            let repo_path = get_str(&args, "repoPath")?;
            let file_path = get_str(&args, "filePath")?;
            let path = file_path.trim();
            if path.is_empty() { return Err("file path is empty".to_string()); }
            let result = run_git(&["add", "--", path], repo_path)?;
            Ok(Value::String(result))
        }
        "run_git_unstage_file" => {
            let repo_path = get_str(&args, "repoPath")?;
            let file_path = get_str(&args, "filePath")?;
            let path = file_path.trim();
            if path.is_empty() { return Err("file path is empty".to_string()); }
            let result = run_git(&["restore", "--staged", "--", path], repo_path)?;
            Ok(Value::String(result))
        }
        "run_git_create_branch" => {
            let repo_path = get_str(&args, "repoPath")?;
            let branch_name = get_str(&args, "branchName")?;
            let start_point = get_str_opt(&args, "startPoint");
            let branch = branch_name.trim();
            if branch.is_empty() { return Err("branch name is empty".to_string()); }
            if branch.contains('\n') || branch.contains('\r') || branch.contains('\0') { return Err("branch name contains invalid characters".to_string()); }
            let start = start_point.unwrap_or_default().trim().to_string();
            if start.is_empty() {
                run_git(&["branch", branch], repo_path)?;
            } else {
                run_git(&["branch", branch, &start], repo_path)?;
            }
            Ok(Value::String(branch.to_string()))
        }
        "run_git_delete_branch" => {
            let repo_path = get_str(&args, "repoPath")?;
            let branch_name = get_str(&args, "branchName")?;
            let branch = branch_name.trim();
            if branch.is_empty() { return Err("branch name is empty".to_string()); }
            if branch.contains('\n') || branch.contains('\r') || branch.contains('\0') { return Err("branch name contains invalid characters".to_string()); }
            run_git_with_timeout(&["branch", "-d", branch], repo_path, 60)?;
            Ok(Value::String(branch.to_string()))
        }
        "run_git_create_worktree_from_branch" => {
            let repo_path = get_str(&args, "repoPath")?;
            let branch_name = get_str(&args, "branchName")?;
            let target_path = get_str_opt(&args, "targetPath");
            let branch = branch_name.trim();
            if branch.is_empty() { return Err("branch name is empty".to_string()); }
            if branch.contains('\n') || branch.contains('\r') || branch.contains('\0') { return Err("branch name contains invalid characters".to_string()); }

            let target_text = if let Some(custom) = target_path {
                let trimmed = custom.trim();
                if trimmed.is_empty() { return Err("target path is empty".to_string()); }
                let candidate = PathBuf::from(trimmed);
                if candidate.exists() { return Err(format!("target path already exists: {trimmed}")); }
                if let Some(parent) = candidate.parent() { fs::create_dir_all(parent).map_err(|e| format!("failed to create parent directory: {e}"))?; }
                candidate.to_string_lossy().to_string()
            } else {
                let main_root = main_worktree_root(repo_path)?;
                let repo_name = main_root.file_name().and_then(|name| name.to_str()).filter(|name| !name.trim().is_empty()).unwrap_or("repo");
                let parent = main_root.parent().ok_or_else(|| "failed to resolve parent directory for worktrees".to_string())?;
                let worktree_root = parent.join(format!("{repo_name}.worktrees"));
                fs::create_dir_all(&worktree_root).map_err(|e| format!("failed to create worktree root: {e}"))?;
                let base_name = sanitize_branch_for_dir(branch);
                let mut target_path = worktree_root.join(&base_name);
                let mut suffix = 2u32;
                while target_path.exists() { target_path = worktree_root.join(format!("{base_name}-{suffix}")); suffix += 1; }
                target_path.to_string_lossy().to_string()
            };
            run_git_with_timeout(&["worktree", "add", &target_text, branch], repo_path, 120)?;
            let head = run_git(&["rev-parse", "HEAD"], &target_text).unwrap_or_default().trim().to_string();
            serde_json::to_value(GitWorktreeCreateResult { path: target_text, branch: branch.to_string(), head }).map_err(|e| e.to_string())
        }
        "run_git_create_detached_worktree" => {
            let repo_path = get_str(&args, "repoPath")?;
            let start_point = get_str(&args, "startPoint")?;
            let target_path = get_str_opt(&args, "targetPath");
            let start = start_point.trim();
            if start.is_empty() { return Err("start point is empty".to_string()); }

            let target_text = if let Some(custom) = target_path {
                let trimmed = custom.trim();
                if trimmed.is_empty() { return Err("target path is empty".to_string()); }
                let candidate = PathBuf::from(trimmed);
                if candidate.exists() { return Err(format!("target path already exists: {trimmed}")); }
                if let Some(parent) = candidate.parent() { fs::create_dir_all(parent).map_err(|e| format!("failed to create parent directory: {e}"))?; }
                candidate.to_string_lossy().to_string()
            } else {
                let main_root = main_worktree_root(repo_path)?;
                let repo_name = main_root.file_name().and_then(|name| name.to_str()).filter(|name| !name.trim().is_empty()).unwrap_or("repo");
                let parent = main_root.parent().ok_or_else(|| "failed to resolve parent directory for worktrees".to_string())?;
                let worktree_root = parent.join(format!("{repo_name}.worktrees"));
                fs::create_dir_all(&worktree_root).map_err(|e| format!("failed to create worktree root: {e}"))?;
                let base_name = sanitize_branch_for_dir(start);
                let mut target_path = worktree_root.join(&base_name);
                let mut suffix = 2u32;
                while target_path.exists() { target_path = worktree_root.join(format!("{base_name}-{suffix}")); suffix += 1; }
                target_path.to_string_lossy().to_string()
            };
            run_git_with_timeout(&["worktree", "add", "--detach", &target_text, start], repo_path, 120)?;
            let head = run_git(&["rev-parse", "HEAD"], &target_text).unwrap_or_default().trim().to_string();
            serde_json::to_value(GitWorktreeCreateResult { path: target_text, branch: "(detached)".to_string(), head }).map_err(|e| e.to_string())
        }
        "run_git_remove_worktree" => {
            let repo_path = get_str(&args, "repoPath")?;
            let target_path = get_str(&args, "targetPath")?;
            let target = target_path.trim();
            if target.is_empty() { return Err("target path is empty".to_string()); }
            let current_key = normalize_repo_key(repo_path)?;
            let target_key = normalize_repo_key(target)?;
            if current_key == target_key { return Err("cannot remove current worktree".to_string()); }
            run_git_with_timeout(&["worktree", "remove", "--force", target], repo_path, 120)?;
            serde_json::to_value(GitWorktreeRemoveResult { path: target.to_string() }).map_err(|e| e.to_string())
        }
        "run_git_worktree_file_patch" => {
            let repo_path = get_str(&args, "repoPath")?;
            let file_path = get_str(&args, "filePath")?;
            let path = file_path.trim();
            if path.is_empty() { return Err("file path is empty".to_string()); }
            if path.contains('\n') || path.contains('\r') { return Err("file path contains invalid line breaks".to_string()); }
            let staged = run_git(&["diff", "--cached", "--", path], repo_path)?;
            let unstaged = run_git(&["diff", "--", path], repo_path)?;
            let mut parts = Vec::new();
            if !staged.trim().is_empty() { parts.push(format!("# Staged\n\n{}", staged.trim_end())); }
            if !unstaged.trim().is_empty() { parts.push(format!("# Working Tree\n\n{}", unstaged.trim_end())); }
            if parts.is_empty() { return Ok(Value::String("No staged or unstaged patch available for this file.".to_string())); }
            Ok(Value::String(parts.join("\n\n")))
        }
        "run_git_worktree_file_content" => {
            let repo_path = get_str(&args, "repoPath")?;
            let file_path = get_str(&args, "filePath")?;
            let path = file_path.trim();
            if path.is_empty() { return Err("file path is empty".to_string()); }
            if path.contains('\n') || path.contains('\r') || path.contains('\0') { return Err("file path contains invalid characters".to_string()); }
            let rel_path = std::path::Path::new(path);
            if rel_path.is_absolute() || path.split('/').any(|part| part == "..") { return Err("file path must be repository-relative".to_string()); }
            let original = run_git(&["show", &format!("HEAD:{path}")], repo_path).unwrap_or_default();
            let repo_root = normalize_repo_key(repo_path)?;
            let full_path = PathBuf::from(repo_root).join(rel_path);
            let modified = fs::read(full_path).map(|bytes| String::from_utf8_lossy(&bytes).to_string()).unwrap_or_default();
            serde_json::to_value(GitWorktreeFileContent { original, modified }).map_err(|e| e.to_string())
        }
        "run_repo_terminal_command" => {
            let repo_path = get_str(&args, "repoPath")?;
            let command = get_str(&args, "command")?;
            let script = command.trim();
            if script.is_empty() { return Err("command is empty".to_string()); }
            if script.contains('\0') { return Err("command contains invalid null byte".to_string()); }
            let result = command_runner::run_and_capture_in_dir_with_timeout("/bin/zsh", &["-lc", script], repo_path, 30)?;
            Ok(Value::String(result))
        }
        "start_repo_terminal_session" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str_opt(&args, "sessionId");
            ensure_terminal_session(repo_path, session_id.as_deref())?;
            let snap = read_terminal_snapshot(repo_path, session_id.as_deref(), 0)?;
            serde_json::to_value(snap).map_err(|e| e.to_string())
        }
        "send_repo_terminal_input" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str_opt(&args, "sessionId");
            let input = get_str(&args, "input")?;
            let key = ensure_terminal_session(repo_path, session_id.as_deref())?;
            if input.is_empty() { return Err("terminal input is empty".to_string()); }
            if input.contains('\0') { return Err("terminal input contains invalid null byte".to_string()); }
            let mut sessions = terminal_sessions().lock().map_err(|_| "failed to lock terminal sessions".to_string())?;
            let Some(session) = sessions.get_mut(&key) else { return Err("terminal session not found".to_string()); };
            session.stdin.write_all(input.as_bytes()).map_err(|e| format!("failed writing terminal input: {e}"))?;
            session.stdin.flush().map_err(|e| format!("failed flushing terminal input: {e}"))?;
            Ok(Value::Null)
        }
        "read_repo_terminal_output" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str_opt(&args, "sessionId");
            let after_seq = get_u64(&args, "afterSeq")?;
            let snap = read_terminal_snapshot(repo_path, session_id.as_deref(), after_seq)?;
            serde_json::to_value(snap).map_err(|e| e.to_string())
        }
        "clear_repo_terminal_session" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str_opt(&args, "sessionId");
            let key = ensure_terminal_session(repo_path, session_id.as_deref())?;
            let mut sessions = terminal_sessions().lock().map_err(|_| "failed to lock terminal sessions".to_string())?;
            let Some(session) = sessions.get_mut(&key) else { return Ok(Value::Null); };
            let mut guard = session.buffer.lock().map_err(|_| "failed to lock terminal buffer".to_string())?;
            guard.clear();
            Ok(Value::Null)
        }
        "close_repo_terminal_session" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str_opt(&args, "sessionId");
            close_terminal_session(repo_path, session_id.as_deref())?;
            Ok(Value::Null)
        }
        "run_git_user_identity" => {
            let repo_path = get_str(&args, "repoPath")?;
            let name = run_git(&["config", "user.name"], repo_path).unwrap_or_default().trim().to_string();
            let email = run_git(&["config", "user.email"], repo_path).unwrap_or_default().trim().to_string();
            serde_json::to_value(GitUserIdentity { name, email }).map_err(|e| e.to_string())
        }

        // Entire commands
        "run_entire_status_detailed" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_entire(&["status", "--detailed"], repo_path)?;
            Ok(Value::String(result))
        }
        "run_entire_explain_commit" => {
            let commit_sha = get_str(&args, "commitSha")?;
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_entire(&["explain", "--commit", commit_sha, "--no-pager"], repo_path)?;
            Ok(Value::String(result))
        }
        "run_entire_explain_commit_short" => {
            let commit_sha = get_str(&args, "commitSha")?;
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_entire(&["explain", "--commit", commit_sha, "--no-pager", "--short"], repo_path)?;
            Ok(Value::String(result))
        }
        "run_entire_explain_checkpoint" => {
            let checkpoint_id = get_str(&args, "checkpointId")?;
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_entire(&["explain", "--checkpoint", checkpoint_id, "--no-pager", "--short"], repo_path)?;
            Ok(Value::String(result))
        }
        "run_entire_explain_checkpoint_raw_transcript" => {
            let checkpoint_id = get_str(&args, "checkpointId")?;
            let repo_path = get_str(&args, "repoPath")?;
            let result = run_entire(&["explain", "--checkpoint", checkpoint_id, "--no-pager", "--raw-transcript"], repo_path)?;
            Ok(Value::String(result))
        }

        // DB commands
        "db_save_review_record" => {
            let record: ReviewRecord = serde_json::from_value(get_field(&args, "record")?).map_err(|e| format!("invalid record: {e}"))?;
            let conn = open_db()?;
            let findings_json = serde_json::to_string(&record.findings).map_err(|e| format!("serialize findings failed: {e}"))?;
            conn.execute(
                "INSERT OR REPLACE INTO review_records (id, repo_path, commit_sha, status, summary, findings_json, created_at, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![record.id, record.repo_path, record.commit_sha, record.status, record.summary, findings_json, record.created_at, now_millis()],
            ).map_err(|e| format!("insert review record failed: {e}"))?;
            Ok(Value::Null)
        }
        "db_list_review_records" => {
            let repo_path = get_str(&args, "repoPath")?;
            let limit = get_i64_opt(&args, "limit").unwrap_or(100).clamp(1, 1000);
            let conn = open_db()?;
            let mut stmt = conn.prepare("SELECT id, repo_path, commit_sha, status, summary, findings_json, created_at FROM review_records WHERE repo_path = ?1 ORDER BY created_at_ms DESC LIMIT ?2")
                .map_err(|e| format!("prepare list query failed: {e}"))?;
            let rows = stmt.query_map(params![repo_path, limit], |row| {
                let findings_json: String = row.get(5)?;
                let findings: Vec<ReviewFinding> = serde_json::from_str(&findings_json).unwrap_or_else(|_| Vec::new());
                Ok(ReviewRecord { id: row.get(0)?, repo_path: row.get(1)?, commit_sha: row.get(2)?, status: row.get(3)?, summary: row.get(4)?, findings, created_at: row.get(6)? })
            }).map_err(|e| format!("query list failed: {e}"))?;
            let mut out = Vec::new();
            for row in rows { out.push(row.map_err(|e| format!("decode row failed: {e}"))?); }
            serde_json::to_value(out).map_err(|e| e.to_string())
        }
        "db_add_repository" => {
            let path = get_str(&args, "path")?;
            if path.trim().is_empty() { return Err("repository path is empty".to_string()); }
            let p = std::path::Path::new(path);
            if !p.is_dir() { return Err(format!("repository directory does not exist: {path}")); }
            if !p.join(".git").exists() { return Err(format!("not a git repository: {path}")); }
            let canonical = fs::canonicalize(p).map_err(|e| format!("failed to resolve repository path: {e}"))?;
            let canonical_str = canonical.to_str().ok_or_else(|| "repository path is not valid utf-8".to_string())?.to_string();
            let name = canonical.file_name().and_then(|s| s.to_str()).unwrap_or("repo").to_string();
            let id = format!("repo-{}", now_millis());
            let added_at = chrono_like_now();
            let conn = open_db()?;
            conn.execute("INSERT OR IGNORE INTO repositories (id, path, name, added_at, added_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)", params![&id, &canonical_str, &name, &added_at, now_millis()])
                .map_err(|e| format!("insert repository failed: {e}"))?;
            let mut stmt = conn.prepare("SELECT id, path, name, added_at FROM repositories WHERE path = ?1 LIMIT 1")
                .map_err(|e| format!("prepare select repository failed: {e}"))?;
            let row = stmt.query_row(params![&canonical_str], |r| {
                Ok(RepositoryEntry { id: r.get(0)?, path: r.get(1)?, name: r.get(2)?, added_at: r.get(3)? })
            }).map_err(|e| format!("fetch inserted repository failed: {e}"))?;
            serde_json::to_value(row).map_err(|e| e.to_string())
        }
        "db_list_repositories" => {
            let conn = open_db()?;
            let mut stmt = conn.prepare("SELECT id, path, name, added_at FROM repositories ORDER BY added_at_ms DESC")
                .map_err(|e| format!("prepare list repositories failed: {e}"))?;
            let rows = stmt.query_map([], |row| {
                Ok(RepositoryEntry { id: row.get(0)?, path: row.get(1)?, name: row.get(2)?, added_at: row.get(3)? })
            }).map_err(|e| format!("query list repositories failed: {e}"))?;
            let mut out = Vec::new();
            let mut stale_ids = Vec::new();
            for row in rows {
                let entry = row.map_err(|e| format!("decode repository row failed: {e}"))?;
                let repo_path = std::path::Path::new(&entry.path);
                if repo_path.is_dir() && repo_path.join(".git").exists() {
                    out.push(entry);
                } else {
                    stale_ids.push(entry.id);
                }
            }
            drop(stmt);
            for id in stale_ids {
                let _ = conn.execute("DELETE FROM repositories WHERE id = ?1", params![id]);
            }
            serde_json::to_value(out).map_err(|e| e.to_string())
        }
        "db_remove_repository" => {
            let id = get_str(&args, "id")?;
            let conn = open_db()?;
            conn.execute("DELETE FROM repositories WHERE id = ?1", params![id])
                .map_err(|e| format!("delete repository failed: {e}"))?;
            Ok(Value::Null)
        }
        "pick_repository_folder" => {
            // Web fallback: return null (frontend will use text input)
            Ok(Value::Null)
        }
        "db_save_review_action" => {
            let action: ReviewAction = serde_json::from_value(get_field(&args, "action")?).map_err(|e| format!("invalid action: {e}"))?;
            let conn = open_db()?;
            conn.execute(
                "INSERT OR REPLACE INTO review_actions (id, repo_path, review_id, finding_id, action, note, created_at, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![action.id, action.repo_path, action.review_id, action.finding_id, action.action, action.note, action.created_at, now_millis()],
            ).map_err(|e| format!("insert review action failed: {e}"))?;
            Ok(Value::Null)
        }
        "db_list_review_actions" => {
            let repo_path = get_str(&args, "repoPath")?;
            let review_id = get_str_opt(&args, "reviewId");
            let limit = get_i64_opt(&args, "limit").unwrap_or(300).clamp(1, 2000);
            let conn = open_db()?;
            let (sql, bind_review) = if review_id.is_some() {
                ("SELECT id, repo_path, review_id, finding_id, action, note, created_at FROM review_actions WHERE repo_path = ?1 AND review_id = ?2 ORDER BY created_at_ms DESC LIMIT ?3", true)
            } else {
                ("SELECT id, repo_path, review_id, finding_id, action, note, created_at FROM review_actions WHERE repo_path = ?1 ORDER BY created_at_ms DESC LIMIT ?2", false)
            };
            let mut stmt = conn.prepare(sql).map_err(|e| format!("prepare action list query failed: {e}"))?;
            let mut out = Vec::new();
            if bind_review {
                let rid = review_id.unwrap_or_default();
                let mut rows = stmt.query(params![repo_path, rid, limit]).map_err(|e| format!("query action list failed: {e}"))?;
                while let Some(row) = rows.next().map_err(|e| format!("iterate action rows failed: {e}"))? {
                    out.push(ReviewAction {
                        id: row.get(0).map_err(|e| format!("decode action row failed: {e}"))?,
                        repo_path: row.get(1).map_err(|e| format!("decode action row failed: {e}"))?,
                        review_id: row.get(2).map_err(|e| format!("decode action row failed: {e}"))?,
                        finding_id: row.get(3).map_err(|e| format!("decode action row failed: {e}"))?,
                        action: row.get(4).map_err(|e| format!("decode action row failed: {e}"))?,
                        note: row.get(5).map_err(|e| format!("decode action row failed: {e}"))?,
                        created_at: row.get(6).map_err(|e| format!("decode action row failed: {e}"))?,
                    });
                }
            } else {
                let mut rows = stmt.query(params![repo_path, limit]).map_err(|e| format!("query action list failed: {e}"))?;
                while let Some(row) = rows.next().map_err(|e| format!("iterate action rows failed: {e}"))? {
                    out.push(ReviewAction {
                        id: row.get(0).map_err(|e| format!("decode action row failed: {e}"))?,
                        repo_path: row.get(1).map_err(|e| format!("decode action row failed: {e}"))?,
                        review_id: row.get(2).map_err(|e| format!("decode action row failed: {e}"))?,
                        finding_id: row.get(3).map_err(|e| format!("decode action row failed: {e}"))?,
                        action: row.get(4).map_err(|e| format!("decode action row failed: {e}"))?,
                        note: row.get(5).map_err(|e| format!("decode action row failed: {e}"))?,
                        created_at: row.get(6).map_err(|e| format!("decode action row failed: {e}"))?,
                    });
                }
            }
            serde_json::to_value(out).map_err(|e| e.to_string())
        }

        // Environment / runtime commands
        "check_runtime_requirements" => {
            let git = check_dep("git", &["--version"], "brew install git");
            let entire = check_dep("entire", &["--version"], "brew install anomalyco/tap/entire");
            let opencode = check_dep("opencode", &["--version"], "brew install anomalyco/tap/opencode");
            let giteam = check_dep("giteam", &["--version"], "cargo install giteam");
            let ok = git.installed && entire.installed && opencode.installed && giteam.installed;
            serde_json::to_value(RuntimeRequirementsStatus { ok, git, entire, opencode, giteam }).map_err(|e| e.to_string())
        }
        "check_runtime_dependency" => {
            let name = get_str(&args, "name")?;
            let dep = match name {
                "git" => check_dep("git", &["--version"], "brew install git"),
                "entire" => check_dep("entire", &["--version"], "brew tap entireio/tap && brew install entireio/tap/entire"),
                "opencode" => check_dep("opencode", &["--version"], "brew install anomalyco/tap/opencode (or npm i -g opencode-ai)"),
                "giteam" => check_dep("giteam", &["--version"], "npm install -g giteam@latest"),
                _ => return Err(format!("unsupported dependency: {name}")),
            };
            serde_json::to_value(dep).map_err(|e| e.to_string())
        }
        "start_runtime_dependency_action" => {
            let name = get_str(&args, "name")?;
            let action = get_str(&args, "action")?;
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
                cmd.args(["-fc", &script_owned]);
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

            Ok(Value::String(job_id))
        }
        "get_runtime_dependency_action" => {
            let job_id = get_str(&args, "jobId")?;
            let map = jobs()
                .lock()
                .map_err(|_| "failed to lock install jobs".to_string())?;
            let job = map
                .get(job_id)
                .ok_or_else(|| format!("job not found: {job_id}"))?;
            let status = RuntimeActionJobStatus {
                job_id: job.job_id.clone(),
                name: job.name.clone(),
                action: job.action.clone(),
                status: job.status.clone(),
                log: job.log.clone(),
                started_at_ms: job.started_at_ms,
                finished_at_ms: job.finished_at_ms,
                exit_code: job.exit_code,
                error: job.error.clone(),
            };
            serde_json::to_value(status).map_err(|e| e.to_string())
        }

        // UI commands (no-op for web)
        "set_window_theme" => Ok(Value::Null),

        // Watch commands (no-op for web)
        "start_git_worktree_watcher" => Ok(Value::Null),
        "stop_git_worktree_watcher" => Ok(Value::Null),

        // Giteam CLI commands (pass through to control module)
        "giteam_cli_get_settings" => {
            let settings = super::control::get_control_server_settings()?;
            serde_json::to_value(settings).map_err(|e| e.to_string())
        }
        "giteam_cli_get_mobile_service_status" => {
            // Return a simple status
            let settings = super::control::get_control_server_settings()?;
            serde_json::to_value(serde_json::json!({
                "enabled": settings.enabled,
                "host": settings.host,
                "port": settings.port
            })).map_err(|e| e.to_string())
        }
        "giteam_cli_start_mobile_service_background" => {
            super::control::start_control_server().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "giteam_cli_set_settings" => {
            let settings = serde_json::from_value(args).map_err(|e| format!("invalid settings: {e}"))?;
            let result = super::control::set_control_server_settings(settings)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "giteam_cli_get_pair_code" => {
            let info = super::control::get_control_pair_code()?;
            serde_json::to_value(info).map_err(|e| e.to_string())
        }
        "giteam_cli_refresh_pair_code" => {
            let info = super::control::refresh_control_pair_code()?;
            serde_json::to_value(info).map_err(|e| e.to_string())
        }
        "giteam_cli_get_access_info" => {
            let info = super::control::get_control_access_info()?;
            serde_json::to_value(info).map_err(|e| e.to_string())
        }

        // Opencode commands
        "create_opencode_session" => {
            let repo_path = get_str(&args, "repoPath")?;
            let title = get_str_opt(&args, "title");
            let agent = get_str_opt(&args, "agent");
            let result = super::opencode::create_opencode_session(repo_path, title, agent, None)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_service_base" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_service_base(repo_path)?;
            Ok(Value::String(result))
        }
        "list_opencode_sessions" => {
            let repo_path = get_str(&args, "repoPath")?;
            let limit = get_u32_opt(&args, "limit");
            let result = super::opencode::list_opencode_sessions(repo_path, limit)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_session_messages_detailed" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str(&args, "sessionId")?;
            let directory = get_str_opt(&args, "directory");
            let limit = get_u32_opt(&args, "limit");
            let result = super::opencode::get_opencode_session_messages_detailed(repo_path, session_id, directory, limit)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "delete_opencode_session" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str(&args, "sessionId")?;
            let result = super::opencode::delete_opencode_session(repo_path, session_id)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_server_provider_state" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_server_provider_state(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_model_config" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_model_config(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_service_settings" => {
            let result = super::opencode::get_opencode_service_settings()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "set_opencode_service_settings" => {
            let settings: super::opencode::OpencodeServiceSettings = serde_json::from_value(args.get("settings").cloned().unwrap_or_else(|| serde_json::json!({})))
                .map_err(|e| format!("invalid settings: {e}"))?;
            let repo_path = get_str_opt(&args, "repoPath");
            let result = super::opencode::set_opencode_service_settings(settings, repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_config_provider_catalog" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_config_provider_catalog(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_server_provider_auth" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_server_provider_auth(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_server_global_config" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_server_global_config(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_server_config" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_server_config(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "disconnect_opencode_server_provider" => {
            let repo_path = get_str(&args, "repoPath")?;
            let provider_id = get_str(&args, "providerId")?;
            let result = super::opencode::disconnect_opencode_server_provider(repo_path, provider_id)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "delete_opencode_server_auth" => {
            let repo_path = get_str(&args, "repoPath")?;
            let provider_id = get_str(&args, "providerId")?;
            let result = super::opencode::delete_opencode_server_auth(repo_path, provider_id)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "patch_opencode_server_config" => {
            let repo_path = get_str(&args, "repoPath")?;
            let patch = serde_json::from_value(args.get("patch").cloned().unwrap_or_else(|| serde_json::json!({})))
                .map_err(|e| format!("invalid patch: {e}"))?;
            let result = super::opencode::patch_opencode_server_config(repo_path, patch)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "put_opencode_server_auth" => {
            let repo_path = get_str(&args, "repoPath")?;
            let provider_id = get_str(&args, "providerId")?;
            let key = get_str(&args, "key")?;
            let result = super::opencode::put_opencode_server_auth(repo_path, provider_id, key)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "set_opencode_server_current_model" => {
            let repo_path = get_str(&args, "repoPath")?;
            let model = get_str(&args, "model")?;
            let result = super::opencode::set_opencode_server_current_model(repo_path, model)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "post_opencode_session_prompt_async" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str(&args, "sessionId")?;
            let prompt = get_str(&args, "prompt")?;
            let parts = args.get("parts").cloned();
            let model = get_str_opt(&args, "model");
            let result = super::opencode::post_opencode_session_prompt_async(repo_path, session_id, prompt, parts, model, None, None)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "abort_opencode_session" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str(&args, "sessionId")?;
            let directory = get_str_opt(&args, "directory");
            let result = super::opencode::abort_opencode_session(repo_path, session_id, directory)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_opencode_questions" => {
            let repo_path = get_str(&args, "repoPath")?;
            super::opencode::list_opencode_questions(repo_path)
        }
        "post_opencode_question_reply" => {
            let repo_path = get_str(&args, "repoPath")?;
            let request_id = get_str(&args, "requestId")?;
            let answers = args
                .get("answers")
                .cloned()
                .map(serde_json::from_value::<Vec<Vec<String>>>)
                .transpose()
                .map_err(|e| format!("invalid answers: {e}"))?
                .unwrap_or_default();
            let result = super::opencode::post_opencode_question_reply(
                repo_path, request_id, answers,
            )?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "post_opencode_question_reject" => {
            let repo_path = get_str(&args, "repoPath")?;
            let request_id = get_str(&args, "requestId")?;
            let result = super::opencode::post_opencode_question_reject(repo_path, request_id)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_session_messages_detailed_page" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str(&args, "sessionId")?;
            let directory = get_str_opt(&args, "directory");
            let before = get_str_opt(&args, "before");
            let limit = get_u32_opt(&args, "limit");
            let result = super::opencode::get_opencode_session_messages_detailed_page(repo_path, session_id, directory, before, limit)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_provider_config" => {
            let repo_path = get_str(&args, "repoPath")?;
            let provider = get_str(&args, "provider")?;
            let result = super::opencode::get_opencode_provider_config(repo_path, provider)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_current_project" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_current_project(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "list_opencode_projects" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::list_opencode_projects(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_session_messages" => {
            let repo_path = get_str(&args, "repoPath")?;
            let session_id = get_str(&args, "sessionId")?;
            let limit = get_u32_opt(&args, "limit");
            let result = super::opencode::get_opencode_session_messages(repo_path, session_id, limit)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "get_opencode_server_provider_catalog" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_server_provider_catalog(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "run_opencode_version" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::run_opencode_version(repo_path)?;
            Ok(Value::String(result))
        }
        "run_opencode_prompt" => {
            let repo_path = get_str(&args, "repoPath")?;
            let prompt = get_str(&args, "prompt")?;
            let model = get_str_opt(&args, "model");
            let result = super::opencode::run_opencode_prompt(repo_path, prompt, model)?;
            Ok(Value::String(result))
        }
        "test_opencode_model" => {
            let repo_path = get_str(&args, "repoPath")?;
            let model = get_str(&args, "model")?;
            let message = get_str_opt(&args, "message");
            let result = super::opencode::test_opencode_model(repo_path, model, message)?;
            Ok(Value::String(result))
        }
        "get_opencode_models_dev_catalog" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::get_opencode_models_dev_catalog(repo_path)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "run_opencode_providers" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::run_opencode_providers(repo_path)?;
            Ok(Value::String(result))
        }
        "run_opencode_models" => {
            let repo_path = get_str(&args, "repoPath")?;
            let provider = get_str_opt(&args, "provider");
            let result = super::opencode::run_opencode_models(repo_path, provider)?;
            Ok(Value::String(result))
        }
        "run_opencode_agent" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::run_opencode_agent(repo_path)?;
            Ok(Value::String(result))
        }
        "run_opencode_mcp" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::run_opencode_mcp(repo_path)?;
            Ok(Value::String(result))
        }
        "run_opencode_stats" => {
            let repo_path = get_str(&args, "repoPath")?;
            let result = super::opencode::run_opencode_stats(repo_path)?;
            Ok(Value::String(result))
        }
        "set_opencode_provider_config" => {
            let repo_path = get_str(&args, "repoPath")?;
            let provider = get_str(&args, "provider")?;
            let npm = get_str_opt(&args, "npm");
            let name = get_str_opt(&args, "name");
            let base_url = get_str_opt(&args, "baseUrl");
            let api_key = get_str_opt(&args, "apiKey");
            let headers = args.get("headers").and_then(|v| v.as_object().cloned());
            let endpoint = get_str_opt(&args, "endpoint");
            let region = get_str_opt(&args, "region");
            let profile = get_str_opt(&args, "profile");
            let project = get_str_opt(&args, "project");
            let location = get_str_opt(&args, "location");
            let resource_name = get_str_opt(&args, "resourceName");
            let enterprise_url = get_str_opt(&args, "enterpriseUrl");
            let timeout = get_str_opt(&args, "timeout");
            let chunk_timeout = get_str_opt(&args, "chunkTimeout");
            let model_id = get_str_opt(&args, "modelId");
            let model_name = get_str_opt(&args, "modelName");
            let result = super::opencode::set_opencode_provider_config(
                repo_path, provider, npm, name, base_url, api_key, headers,
                endpoint, region, profile, project, location, resource_name,
                enterprise_url, timeout, chunk_timeout, model_id, model_name,
            )?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "set_opencode_model_config" => {
            let repo_path = get_str(&args, "repoPath")?;
            let model = get_str(&args, "model")?;
            let result = super::opencode::set_opencode_model_config(repo_path, model)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }

        _ => Err(format!("unknown desktop rpc command: {command}")),
    }
}

// JSON helper functions
fn get_field(value: &Value, key: &str) -> Result<Value, String> {
    value.get(key).cloned().ok_or_else(|| format!("missing field: {key}"))
}

fn get_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("missing or invalid string field: {key}"))
}

fn get_str_opt(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn get_bool(value: &Value, key: &str) -> bool {
    value.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn get_u32(value: &Value, key: &str) -> Result<u32, String> {
    value
        .get(key)
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .ok_or_else(|| format!("missing or invalid u32 field: {key}"))
}

fn get_u32_opt(value: &Value, key: &str) -> Option<u32> {
    value.get(key).and_then(|v| v.as_u64()).map(|v| v as u32)
}

fn get_u64(value: &Value, key: &str) -> Result<u64, String> {
    value
        .get(key)
        .and_then(|v| v.as_u64())
        .ok_or_else(|| format!("missing or invalid u64 field: {key}"))
}

fn get_i64_opt(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|v| v.as_i64())
}

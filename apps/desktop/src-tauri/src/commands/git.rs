use super::command_runner;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::fs;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

const TERMINAL_MAX_BUFFER_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoTerminalSnapshot {
    pub output: String,
    pub seq: u64,
    pub alive: bool,
    pub cwd: String,
}

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
            let Some(front) = self.chunks.pop_front() else {
                break;
            };
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

static REPO_TERMINAL_SESSIONS: OnceLock<Mutex<HashMap<String, ManagedRepoTerminalSession>>> = OnceLock::new();

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
    let raw = session_id.unwrap_or("default").trim();
    if raw.is_empty() {
        return "default".to_string();
    }
    raw.chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(64)
        .collect::<String>()
}

fn make_terminal_key(repo_key: &str, terminal_id: &str) -> String {
    format!("{repo_key}::{terminal_id}")
}

fn spawn_terminal_reader<R>(mut reader: R, buffer: Arc<Mutex<TerminalBuffer>>)
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut bytes = [0_u8; 4096];
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&bytes[..n]).to_string();
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
        Ok(Some(_)) => false,
        Ok(None) => true,
        Err(_) => false,
    }
}

fn spawn_repo_terminal_session(repo_path: &str) -> Result<ManagedRepoTerminalSession, String> {
    // Use `script` to allocate a PTY so interactive shell behavior matches a real terminal better.
    let mut child = Command::new("/usr/bin/script")
        .args(["-q", "/dev/null", "/bin/zsh", "-il"])
        .current_dir(repo_path)
        .env("TERM", "xterm-256color")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start terminal shell: {e}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "failed to open terminal stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "failed to open terminal stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "failed to open terminal stderr".to_string())?;
    let buffer = Arc::new(Mutex::new(TerminalBuffer::default()));
    spawn_terminal_reader(stdout, Arc::clone(&buffer));
    spawn_terminal_reader(stderr, Arc::clone(&buffer));
    Ok(ManagedRepoTerminalSession {
        child,
        stdin,
        buffer,
        cwd: repo_path.to_string(),
    })
}

fn ensure_terminal_session(repo_path: &str, session_id: Option<&str>) -> Result<String, String> {
    let repo_key = normalize_repo_key(repo_path)?;
    let terminal_id = normalize_terminal_id(session_id);
    let key = make_terminal_key(&repo_key, &terminal_id);
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    let should_spawn = match sessions.get_mut(&key) {
        Some(existing) => !session_alive(existing),
        None => true,
    };
    if should_spawn {
        sessions.remove(&key);
        let session = spawn_repo_terminal_session(&repo_key)?;
        sessions.insert(key.clone(), session);
    }
    Ok(key)
}

fn read_terminal_snapshot(repo_path: &str, session_id: Option<&str>, after_seq: u64) -> Result<RepoTerminalSnapshot, String> {
    let repo_key = normalize_repo_key(repo_path)?;
    let terminal_id = normalize_terminal_id(session_id);
    let key = make_terminal_key(&repo_key, &terminal_id);
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    let Some(session) = sessions.get_mut(&key) else {
        return Ok(RepoTerminalSnapshot {
            output: String::new(),
            seq: after_seq,
            alive: false,
            cwd: repo_key,
        });
    };
    let alive = session_alive(session);
    let (seq, output) = session
        .buffer
        .lock()
        .map_err(|_| "failed to lock terminal buffer".to_string())?
        .read_after(after_seq);
    Ok(RepoTerminalSnapshot {
        output,
        seq,
        alive,
        cwd: session.cwd.clone(),
    })
}

fn close_terminal_session(repo_path: &str, session_id: Option<&str>) -> Result<(), String> {
    let repo_key = normalize_repo_key(repo_path)?;
    let terminal_id = normalize_terminal_id(session_id);
    let key = make_terminal_key(&repo_key, &terminal_id);
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    if let Some(mut session) = sessions.remove(&key) {
        let _ = session.child.kill();
    }
    Ok(())
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
pub struct GitCommitSummary {
    pub sha: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchSummary {
    pub name: String,
    pub is_current: bool,
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
            // Skip surrounding quotes Git may add for escaped paths
            continue;
        } else {
            let mut buf = [0u8; 4];
            let s = ch.encode_utf8(&mut buf);
            bytes.extend(s.bytes());
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|e| {
        String::from_utf8_lossy(e.as_bytes()).to_string()
    })
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

#[tauri::command]
pub fn run_git_head_commit(repo_path: &str) -> Result<String, String> {
    run_git(&["rev-parse", "HEAD"], repo_path)
}

#[tauri::command]
pub fn run_git_pull(repo_path: &str) -> Result<String, String> {
    // Network operations can take longer than local reads.
    run_git_with_timeout(&["pull", "--ff-only"], repo_path, 90)
}

#[tauri::command]
pub fn run_git_push(repo_path: &str) -> Result<String, String> {
    // Network operations can take longer than local reads.
    run_git_with_timeout(&["push"], repo_path, 90)
}

#[tauri::command]
pub fn run_git_commit(repo_path: &str, message: &str) -> Result<String, String> {
    let m = message.trim();
    if m.is_empty() {
        return Err("commit message must not be empty".to_string());
    }
    run_git(&["commit", "-m", m], repo_path)
}

#[tauri::command]
pub fn run_git_show_patch(commit_sha: &str, repo_path: &str) -> Result<String, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    run_git(&["show", "--patch", "--format=fuller", commit_sha], repo_path)
}

#[tauri::command]
pub fn run_git_recent_commits(repo_path: &str, limit: Option<u32>) -> Result<Vec<GitCommitSummary>, String> {
    let n = limit.unwrap_or(30).clamp(1, 200);
    let sep = '\u{1f}';
    let pretty = format!("%H{sep}%an{sep}%ad{sep}%s");
    let raw = run_git(
        &[
            "log",
            &format!("-n{n}"),
            "--date=iso-strict",
            &format!("--pretty=format:{pretty}"),
        ],
        repo_path,
    )?;

    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts = split_fields(line, sep);
        let sha = parts.first().copied().unwrap_or("").trim().to_string();
        let author = parts.get(1).copied().unwrap_or("").trim().to_string();
        let date = parts.get(2).copied().unwrap_or("").trim().to_string();
        let subject = parts.get(3).copied().unwrap_or("").trim().to_string();
        if sha.is_empty() {
            continue;
        }
        commits.push(GitCommitSummary {
            sha,
            author,
            date,
            subject,
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn run_git_local_branches(repo_path: &str) -> Result<Vec<GitBranchSummary>, String> {
    // Branch names list (plain, one per line).
    let names_raw = run_git(&["for-each-ref", "--format=%(refname:short)", "refs/heads"], repo_path)
        .or_else(|_| run_git(&["branch", "--list"], repo_path))?;

    // Current branch name from HEAD.
    let current = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let mut branches = Vec::new();
    for line in names_raw.lines() {
        let mut name = line.trim().to_string();
        // `git branch --list` fallback may include marker like "* main"
        if name.starts_with('*') {
            name = name.trim_start_matches('*').trim().to_string();
        }
        if name.is_empty() || name.starts_with("entire/") {
            continue;
        }
        branches.push(GitBranchSummary {
            is_current: name == current,
            name,
        });
    }

    // Guarantee at least one branch when HEAD is valid.
    if branches.is_empty() && !current.is_empty() && current != "HEAD" && !current.starts_with("entire/") {
        branches.push(GitBranchSummary {
            name: current,
            is_current: true,
        });
    }

    Ok(branches)
}

#[tauri::command]
pub fn run_git_branch_commits(
    repo_path: &str,
    branch_name: &str,
    limit: Option<u32>,
) -> Result<Vec<GitCommitSummary>, String> {
    let n = limit.unwrap_or(30).clamp(1, 200);
    let sep = '\u{1f}';
    let pretty = format!("%H{sep}%an{sep}%ad{sep}%s");
    let raw = run_git(
        &[
            "log",
            branch_name,
            &format!("-n{n}"),
            "--date=iso-strict",
            &format!("--pretty=format:{pretty}"),
        ],
        repo_path,
    )?;

    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts = split_fields(line, sep);
        let sha = parts.first().copied().unwrap_or("").trim().to_string();
        let author = parts.get(1).copied().unwrap_or("").trim().to_string();
        let date = parts.get(2).copied().unwrap_or("").trim().to_string();
        let subject = parts.get(3).copied().unwrap_or("").trim().to_string();
        if sha.is_empty() {
            continue;
        }
        commits.push(GitCommitSummary {
            sha,
            author,
            date,
            subject,
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn run_git_commit_graph(repo_path: &str, limit: Option<u32>) -> Result<Vec<GitGraphNode>, String> {
    let n = limit.unwrap_or(120).clamp(20, 300);
    let sep = '\u{1f}';
    // Include parents so frontend can compute proper lanes/merge links.
    let pretty = format!("{sep}%H{sep}%P{sep}%ad{sep}%an{sep}%d{sep}%s");
    let raw = run_git(
        &[
            "log",
            "--graph",
            "--decorate=short",
            "--date-order",
            "--all",
            &format!("-n{n}"),
            "--date=short",
            &format!("--pretty=format:{pretty}"),
        ],
        repo_path,
    )?;

    let mut nodes = Vec::new();
    for line in raw.lines() {
        let parts = split_fields(line, sep);
        // `git log --graph` may emit connector-only rows that still include the pretty-format field
        // separators, yielding `parts.len() == 6` but with an empty sha/date/author/etc.
        // Keep those rows to preserve lane continuity for the UI.
        if parts.len() < 7 {
            // Preserve trailing spaces for stable column alignment in the UI.
            let graph = parts.first().copied().unwrap_or("").to_string();
            if graph.is_empty() {
                continue;
            }
            nodes.push(GitGraphNode {
                graph,
                sha: String::new(),
                parents: Vec::new(),
                date: String::new(),
                author: String::new(),
                refs: String::new(),
                subject: String::new(),
                is_connector: true,
            });
            continue;
        }

        // Preserve trailing spaces for stable column alignment in the UI.
        let graph = parts.first().copied().unwrap_or("").to_string();
        let sha = parts.get(1).copied().unwrap_or("").trim().to_string();
        if sha.is_empty() {
            if graph.is_empty() {
                continue;
            }
            nodes.push(GitGraphNode {
                graph,
                sha: String::new(),
                parents: Vec::new(),
                date: String::new(),
                author: String::new(),
                refs: String::new(),
                subject: String::new(),
                is_connector: true,
            });
            continue;
        }
        let parents_raw = parts.get(2).copied().unwrap_or("").trim();
        let parents: Vec<String> = parents_raw
            .split_whitespace()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        nodes.push(GitGraphNode {
            graph,
            sha,
            parents,
            date: parts.get(3).copied().unwrap_or("").trim().to_string(),
            author: parts.get(4).copied().unwrap_or("").trim().to_string(),
            refs: parts.get(5).copied().unwrap_or("").trim().to_string(),
            subject: parts.get(6).copied().unwrap_or("").trim().to_string(),
            is_connector: false,
        });
    }
    Ok(nodes)
}

#[tauri::command]
pub fn run_git_commit_changed_files(repo_path: &str, commit_sha: &str) -> Result<Vec<String>, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    let raw = run_git(
        &["show", "--pretty=format:", "--name-only", commit_sha],
        repo_path,
    )?;
    let mut files = Vec::new();
    for line in raw.lines() {
        let name = line.trim();
        if !name.is_empty() {
            files.push(name.to_string());
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn run_git_commit_file_patch(
    repo_path: &str,
    commit_sha: &str,
    file_path: &str,
) -> Result<String, String> {
    command_runner::validate_commit_sha(commit_sha)?;
    if file_path.trim().is_empty() {
        return Err("file path is empty".to_string());
    }
    if file_path.contains('\n') || file_path.contains('\r') {
        return Err("file path contains invalid line breaks".to_string());
    }
    run_git(
        &["show", "--format=", "--patch", commit_sha, "--", file_path],
        repo_path,
    )
}

#[tauri::command]
pub fn run_git_worktree_overview(repo_path: &str) -> Result<GitWorktreeOverview, String> {
    let raw = run_git(&["status", "--short", "--branch"], repo_path)?;
    let mut overview = parse_worktree_overview(raw);
    if overview.branch.is_empty() {
        overview.branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], repo_path)
            .unwrap_or_default()
            .trim()
            .to_string();
    }
    Ok(overview)
}

#[tauri::command]
pub fn run_git_worktree_list(repo_path: &str) -> Result<Vec<GitLinkedWorktree>, String> {
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

    let push_current = |rows: &mut Vec<GitLinkedWorktree>,
                        path: &mut String,
                        branch: &mut String,
                        head: &mut String,
                        locked: &mut String,
                        prunable: &mut String,
                        is_current: &mut bool,
                        is_detached: &mut bool| {
        if path.trim().is_empty() {
            return;
        }
        let overview = run_git(&["status", "--short", "--branch"], path)
            .map(parse_worktree_overview)
            .unwrap_or_else(|_| parse_worktree_overview(String::new()));
        let is_main_worktree = rows.is_empty();
        rows.push(GitLinkedWorktree {
            path: path.trim().to_string(),
            branch: if branch.trim().is_empty() {
                overview.branch.clone()
            } else {
                branch.trim().to_string()
            },
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
        path.clear();
        branch.clear();
        head.clear();
        locked.clear();
        prunable.clear();
        *is_current = false;
        *is_detached = false;
    };

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            push_current(
                &mut rows,
                &mut path,
                &mut branch,
                &mut head,
                &mut locked,
                &mut prunable,
                &mut is_current,
                &mut is_detached,
            );
            continue;
        }
        if let Some(v) = trimmed.strip_prefix("worktree ") {
            path = v.trim().to_string();
            is_current = normalize_repo_key(&path).unwrap_or_else(|_| path.trim().to_string()) == current_key;
            continue;
        }
        if let Some(v) = trimmed.strip_prefix("HEAD ") {
            head = v.trim().to_string();
            continue;
        }
        if let Some(v) = trimmed.strip_prefix("branch ") {
            let raw_branch = v.trim();
            branch = raw_branch
                .strip_prefix("refs/heads/")
                .unwrap_or(raw_branch)
                .trim()
                .to_string();
            continue;
        }
        if let Some(v) = trimmed.strip_prefix("locked") {
            locked = v.trim().to_string();
            continue;
        }
        if let Some(v) = trimmed.strip_prefix("prunable") {
            prunable = v.trim().to_string();
            continue;
        }
        if trimmed == "detached" {
            is_detached = true;
            if branch.is_empty() {
                branch = "(detached)".to_string();
            }
        }
    }

    push_current(
        &mut rows,
        &mut path,
        &mut branch,
        &mut head,
        &mut locked,
        &mut prunable,
        &mut is_current,
        &mut is_detached,
    );

    if let Some(current_idx) = rows.iter().position(|row| row.is_current) {
        let current = rows.remove(current_idx);
        rows.insert(0, current);
    }
    Ok(rows)
}

#[tauri::command]
pub fn run_git_checkout_branch(repo_path: &str, branch_name: &str) -> Result<String, String> {
    let branch = branch_name.trim();
    if branch.is_empty() {
        return Err("branch name is empty".to_string());
    }
    if branch.contains('\n') || branch.contains('\r') {
        return Err("branch name contains invalid line breaks".to_string());
    }
    run_git_with_timeout(&["checkout", branch], repo_path, 60)
}

#[tauri::command]
pub fn run_git_discard_changes(
    repo_path: &str,
    file_path: &str,
    is_untracked: bool,
) -> Result<String, String> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err("file path is empty".to_string());
    }

    if is_untracked {
        // Untracked (new) files: remove from filesystem
        // --  separates options from path names
        run_git(&["clean", "-f", "--", path], repo_path)
    } else {
        // Tracked files: restore to HEAD (same as VS Code "Discard Changes")
        // This handles staged, unstaged, or partially-staged files in one go
        run_git(
            &["restore", "--source=HEAD", "--staged", "--worktree", "--", path],
            repo_path,
        )
    }
}

#[tauri::command]
pub fn run_git_stage_file(repo_path: &str, file_path: &str) -> Result<String, String> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err("file path is empty".to_string());
    }
    run_git(&["add", "--", path], repo_path)
}

#[tauri::command]
pub fn run_git_unstage_file(repo_path: &str, file_path: &str) -> Result<String, String> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err("file path is empty".to_string());
    }
    run_git(&["restore", "--staged", "--", path], repo_path)
}

#[tauri::command]
pub fn run_git_create_branch(repo_path: &str, branch_name: &str, start_point: Option<String>) -> Result<String, String> {
    let branch = branch_name.trim();
    if branch.is_empty() {
        return Err("branch name is empty".to_string());
    }
    if branch.contains('\n') || branch.contains('\r') || branch.contains('\0') {
        return Err("branch name contains invalid characters".to_string());
    }
    let start = start_point.unwrap_or_default().trim().to_string();
    if start.is_empty() {
        run_git(&["branch", branch], repo_path)?;
    } else {
        run_git(&["branch", branch, &start], repo_path)?;
    }
    Ok(branch.to_string())
}

#[tauri::command]
pub fn run_git_delete_branch(repo_path: &str, branch_name: &str) -> Result<String, String> {
    let branch = branch_name.trim();
    if branch.is_empty() {
        return Err("branch name is empty".to_string());
    }
    if branch.contains('\n') || branch.contains('\r') || branch.contains('\0') {
        return Err("branch name contains invalid characters".to_string());
    }
    run_git_with_timeout(&["branch", "-d", branch], repo_path, 60)?;
    Ok(branch.to_string())
}

#[tauri::command]
pub fn run_git_create_worktree_from_branch(
    repo_path: &str,
    branch_name: &str,
    target_path: Option<String>,
) -> Result<GitWorktreeCreateResult, String> {
    let branch = branch_name.trim();
    if branch.is_empty() {
        return Err("branch name is empty".to_string());
    }
    if branch.contains('\n') || branch.contains('\r') || branch.contains('\0') {
        return Err("branch name contains invalid characters".to_string());
    }

    let target_text = if let Some(custom) = target_path {
        let trimmed = custom.trim();
        if trimmed.is_empty() {
            return Err("target path is empty".to_string());
        }
        let candidate = PathBuf::from(trimmed);
        if candidate.exists() {
            return Err(format!("target path already exists: {trimmed}"));
        }
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create parent directory: {e}"))?;
        }
        candidate.to_string_lossy().to_string()
    } else {
        let main_root = main_worktree_root(repo_path)?;
        let repo_name = main_root
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("repo");
        let parent = main_root
            .parent()
            .ok_or_else(|| "failed to resolve parent directory for worktrees".to_string())?;
        let worktree_root = parent.join(format!("{repo_name}.worktrees"));
        fs::create_dir_all(&worktree_root)
            .map_err(|e| format!("failed to create worktree root: {e}"))?;

        let base_name = sanitize_branch_for_dir(branch);
        let mut target_path = worktree_root.join(&base_name);
        let mut suffix = 2u32;
        while target_path.exists() {
            target_path = worktree_root.join(format!("{base_name}-{suffix}"));
            suffix += 1;
        }
        target_path.to_string_lossy().to_string()
    };

    // Create worktree based on an existing branch (no -b flag).
    run_git_with_timeout(&["worktree", "add", &target_text, branch], repo_path, 120)?;
    let head = run_git(&["rev-parse", "HEAD"], &target_text)
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(GitWorktreeCreateResult {
        path: target_text,
        branch: branch.to_string(),
        head,
    })
}

#[tauri::command]
pub fn run_git_remove_worktree(
    repo_path: &str,
    target_path: &str,
) -> Result<GitWorktreeRemoveResult, String> {
    let target = target_path.trim();
    if target.is_empty() {
        return Err("target path is empty".to_string());
    }
    let current_key = normalize_repo_key(repo_path)?;
    let target_key = normalize_repo_key(target)?;
    if current_key == target_key {
      return Err("cannot remove current worktree".to_string());
    }
    run_git_with_timeout(&["worktree", "remove", "--force", target], repo_path, 120)?;
    Ok(GitWorktreeRemoveResult {
        path: target.to_string(),
    })
}

#[tauri::command]
pub fn run_git_worktree_file_patch(repo_path: &str, file_path: &str) -> Result<String, String> {
    let path = file_path.trim();
    if path.is_empty() {
        return Err("file path is empty".to_string());
    }
    if path.contains('\n') || path.contains('\r') {
        return Err("file path contains invalid line breaks".to_string());
    }

    let staged = run_git(&["diff", "--cached", "--", path], repo_path)?;
    let unstaged = run_git(&["diff", "--", path], repo_path)?;
    let mut parts = Vec::new();
    if !staged.trim().is_empty() {
        parts.push(format!("# Staged\n\n{}", staged.trim_end()));
    }
    if !unstaged.trim().is_empty() {
        parts.push(format!("# Working Tree\n\n{}", unstaged.trim_end()));
    }
    if parts.is_empty() {
        return Ok("No staged or unstaged patch available for this file.".to_string());
    }
    Ok(parts.join("\n\n"))
}

#[tauri::command]
pub fn run_repo_terminal_command(repo_path: &str, command: &str) -> Result<String, String> {
    let script = command.trim();
    if script.is_empty() {
        return Err("command is empty".to_string());
    }
    if script.contains('\0') {
        return Err("command contains invalid null byte".to_string());
    }
    command_runner::run_and_capture_in_dir_with_timeout("/bin/zsh", &["-lc", script], repo_path, 30)
}

#[tauri::command]
pub fn start_repo_terminal_session(repo_path: &str, session_id: Option<String>) -> Result<RepoTerminalSnapshot, String> {
    ensure_terminal_session(repo_path, session_id.as_deref())?;
    read_terminal_snapshot(repo_path, session_id.as_deref(), 0)
}

#[tauri::command]
pub fn send_repo_terminal_input(repo_path: &str, session_id: Option<String>, input: &str) -> Result<(), String> {
    let key = ensure_terminal_session(repo_path, session_id.as_deref())?;
    if input.is_empty() {
        return Err("terminal input is empty".to_string());
    }
    if input.contains('\0') {
        return Err("terminal input contains invalid null byte".to_string());
    }
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    let Some(session) = sessions.get_mut(&key) else {
        return Err("terminal session not found".to_string());
    };
    session
        .stdin
        .write_all(input.as_bytes())
        .map_err(|e| format!("failed writing terminal input: {e}"))?;
    session
        .stdin
        .flush()
        .map_err(|e| format!("failed flushing terminal input: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn read_repo_terminal_output(
    repo_path: &str,
    session_id: Option<String>,
    after_seq: u64,
) -> Result<RepoTerminalSnapshot, String> {
    read_terminal_snapshot(repo_path, session_id.as_deref(), after_seq)
}

#[tauri::command]
pub fn clear_repo_terminal_session(repo_path: &str, session_id: Option<String>) -> Result<(), String> {
    let key = ensure_terminal_session(repo_path, session_id.as_deref())?;
    let mut sessions = terminal_sessions()
        .lock()
        .map_err(|_| "failed to lock terminal sessions".to_string())?;
    let Some(session) = sessions.get_mut(&key) else {
        return Ok(());
    };
    let mut guard = session
        .buffer
        .lock()
        .map_err(|_| "failed to lock terminal buffer".to_string())?;
    guard.clear();
    Ok(())
}

#[tauri::command]
pub fn close_repo_terminal_session(repo_path: &str, session_id: Option<String>) -> Result<(), String> {
    close_terminal_session(repo_path, session_id.as_deref())
}

#[tauri::command]
pub fn run_git_user_identity(repo_path: &str) -> Result<GitUserIdentity, String> {
    let name = run_git(&["config", "user.name"], repo_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let email = run_git(&["config", "user.email"], repo_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(GitUserIdentity { name, email })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn local_branches_smoke_test() {
        let repo_path = "/Users/tianya/Documents/project/giteam/test";
        if !Path::new(repo_path).exists() {
            return;
        }
        let branches = run_git_local_branches(repo_path).expect("run_git_local_branches should succeed");
        // At least one regular branch should be visible for a valid repo.
        assert!(
            !branches.is_empty(),
            "expected at least one local branch, got empty: {:?}",
            branches
        );
    }
}

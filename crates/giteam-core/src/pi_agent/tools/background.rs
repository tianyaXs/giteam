//! 后台 shell：参照成熟 coding agent（Claude Code 的 run_in_background /
//! BashOutput / KillShell，Hermes 的 terminal background=true + process
//! poll/wait）为 Giteam 提供一等公民的后台进程管理，根治「前台起服务把
//! 会话挂死」这一类问题。
//!
//! 设计要点：
//! - `bash(run_in_background=true)` 立即返回 shell_id；进程在独立进程组
//!   运行，stdout/stderr 落盘日志，monitor 线程跟踪退出状态；
//! - `bash_output` 读取日志尾部，或限时等待退出（condvar + oneshot，
//!   不阻塞 async executor）；
//! - `kill_shell` 终止整个进程组树；
//! - 完成通知注入下一次工具结果，模型无需盲轮询；
//! - 会话结束（registry Drop）统一回收仍在运行的后台进程，避免孤儿。
//!
//! 前台护栏（Hermes 式）：拒绝 `timeout: 0` 与超长前台 timeout，识别
//! nohup/setsid/disown/结尾 `&` 以及长驻服务模式（http.server、
//! npm run dev、uvicorn 等），一律给出改用 run_in_background 的指引，
//! 而不是默默挂住。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use pi::sdk::{ContentBlock, Result, TextContent, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

/// 前台硬上限：超过一律引导走后台（Hermes FOREGROUND_MAX_TIMEOUT 同值）。
pub const MAX_FOREGROUND_TIMEOUT_SECS: u64 = 600;
/// bash_output wait 上限。
pub const MAX_OUTPUT_WAIT_SECS: u64 = 600;
/// bash_output 返回的日志尾部上限。
const OUTPUT_TAIL_BYTES: u64 = 64 * 1024;
const OUTPUT_TAIL_LINES: usize = 500;
/// SIGTERM 后到 SIGKILL 的宽限。
const KILL_GRACE: Duration = Duration::from_secs(2);
/// 完成通知里命令的展示长度。
const NOTICE_COMMAND_CHARS: usize = 120;

// ============================================================================
// 前台护栏：长驻/伪后台模式识别
// ============================================================================

/// 去掉单/双引号与反引号包裹的内容，避免 commit message、python -c 等
/// 字符串里的关键词误伤（与 Hermes `_strip_quotes` 一致）。
fn strip_quotes(command: &str) -> String {
    let mut out = String::with_capacity(command.len());
    let mut chars = command.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' => {
                for c in chars.by_ref() {
                    if c == '\'' {
                        break;
                    }
                }
                out.push(' ');
            }
            '"' => {
                let mut escaped = false;
                for c in chars.by_ref() {
                    if escaped {
                        escaped = false;
                        continue;
                    }
                    match c {
                        '\\' => escaped = true,
                        '"' => break,
                        _ => {}
                    }
                }
                out.push(' ');
            }
            '`' => {
                for c in chars.by_ref() {
                    if c == '`' {
                        break;
                    }
                }
                out.push(' ');
            }
            _ => out.push(ch),
        }
    }
    out
}

/// 帮助/版本查询是有界命令，永不拦截。
fn looks_like_help_or_version(command: &str) -> bool {
    let normalized = command.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = normalized.to_lowercase();
    lower.contains(" --help")
        || lower.ends_with(" -h")
        || lower.contains(" --version")
        || lower.ends_with(" -v")
}

/// 常见「永不退出」的服务/守护/监听命令模式（对齐 Hermes
/// `_LONG_LIVED_FOREGROUND_PATTERNS`，并覆盖本仓库实锤过的 http.server 场景）。
fn matches_long_lived_pattern(unquoted: &str) -> bool {
    let lower = unquoted.to_lowercase();
    let tokens: Vec<&str> = lower
        .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-' || c == '.'))
        .filter(|t| !t.is_empty())
        .collect();
    let has = |word: &str| tokens.iter().any(|t| t.eq_ignore_ascii_case(word));
    let phrase = |p: &str| lower.contains(p);

    // 包管理器 dev/start/serve/watch 脚本
    let pkg = ["npm", "pnpm", "yarn", "bun", "deno"].iter().any(|p| has(p));
    let script = ["dev", "serve", "watch"].iter().any(|s| has(s)) || has("start");
    if pkg && script {
        return true;
    }
    // docker compose up（-d/--detach 是有界的，放行）
    if (phrase("docker compose up") || phrase("docker-compose up"))
        && !phrase(" -d")
        && !phrase("--detach")
    {
        return true;
    }
    // python 静态文件服务器（本仓库实锤场景）
    if phrase("-m http.server") {
        return true;
    }
    // 各类 dev server / watcher 框架（整词，避免 next/nuxt 之类普通词误伤）
    for word in ["uvicorn", "gunicorn", "nodemon", "vite", "webpack-dev-server"] {
        if has(word) {
            return true;
        }
    }
    if phrase("next dev") || phrase("nuxt dev") {
        return true;
    }
    if phrase("flask run") || phrase("jekyll serve") || phrase("hugo server") {
        return true;
    }
    if has("rails") && (has("server") || has("s")) {
        return true;
    }
    if has("php") && has("-s") {
        return true;
    }
    if has("cargo") && has("watch") {
        return true;
    }
    // 经典监听/跟随（watch 命令本身即长驻）
    if has("tail") && (has("-f") || has("--follow")) {
        return true;
    }
    if has("watch") {
        return true;
    }
    false
}

/// 壳层伪后台：nohup / setsid / disown（出现在命令位：行首、`;`/`&&`/`||`/`|`/`&`/`(`
/// 之后，或 sudo/env 之后）。
fn matches_shell_level_background(unquoted: &str) -> bool {
    let lower = unquoted.to_lowercase();
    for keyword in ["nohup", "setsid", "disown"] {
        let mut start = 0;
        while let Some(pos) = lower[start..].find(keyword) {
            let abs = start + pos;
            let prefix = lower[..abs].trim_end();
            let at_command_position = prefix.is_empty()
                || prefix.ends_with(';')
                || prefix.ends_with("&&")
                || prefix.ends_with("||")
                || prefix.ends_with('|')
                || prefix.ends_with('&')
                || prefix.ends_with('(')
                || prefix.ends_with("sudo")
                || prefix.ends_with("env");
            if at_command_position {
                return true;
            }
            start = abs + keyword.len();
        }
    }
    false
}

/// 结尾或独立的 `&` 后台符号（`cmd &` / `cmd & echo ok`）。
fn matches_inline_background_amp(unquoted: &str) -> bool {
    let bytes: Vec<char> = unquoted.chars().collect();
    for (i, &c) in bytes.iter().enumerate() {
        if c != '&' {
            continue;
        }
        // 跳过 &&（逻辑与）
        let prev_amp = i > 0 && bytes[i - 1] == '&';
        let next_amp = i + 1 < bytes.len() && bytes[i + 1] == '&';
        if prev_amp || next_amp {
            continue;
        }
        return true;
    }
    false
}

/// 前台护栏：返回 None 放行，Some(guidance) 拒绝并给出改法。
fn foreground_guard(command: &str, timeout: Option<u64>) -> Option<String> {
    if looks_like_help_or_version(command) {
        return None;
    }
    if let Some(value) = timeout {
        if value == 0 {
            return Some(
                "`timeout: 0` is not allowed — an unbounded foreground command hangs the agent \
                 (this is exactly how `python3 -m http.server` froze a session). For a bounded \
                 command pass an explicit timeout (max 600s); for a long-lived command \
                 (server, watcher, daemon) re-send with run_in_background=true."
                    .to_string(),
            );
        }
        if value > MAX_FOREGROUND_TIMEOUT_SECS {
            return Some(format!(
                "Foreground timeout {value}s exceeds the maximum of \
                 {MAX_FOREGROUND_TIMEOUT_SECS}s. Re-send with run_in_background=true and \
                 manage the process with bash_output / kill_shell."
            ));
        }
    }
    let unquoted = strip_quotes(command);
    if matches_shell_level_background(&unquoted) {
        return Some(
            "Foreground command uses shell-level background wrappers (nohup/setsid/disown). \
             Re-send WITHOUT the wrapper as bash(command=..., run_in_background=true) so the \
             process is tracked, then verify readiness and run follow-ups in separate calls."
                .to_string(),
        );
    }
    if matches_inline_background_amp(&unquoted) {
        return Some(
            "Foreground command uses '&' backgrounding. Re-send WITHOUT the '&' as \
             bash(command=..., run_in_background=true), then run health checks and tests in \
             follow-up calls."
                .to_string(),
        );
    }
    if matches_long_lived_pattern(&unquoted) {
        return Some(
            "This foreground command appears to start a long-lived server/watch process that \
             never exits, which would hang the session. Re-send with run_in_background=true, \
             verify readiness (health endpoint via curl, or log output via bash_output), then \
             continue in separate calls."
                .to_string(),
        );
    }
    None
}

// ============================================================================
// 后台进程注册表
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskStatus {
    Running,
    Exited(i32),
    Killed(i32),
}

impl TaskStatus {
    const fn is_running(self) -> bool {
        matches!(self, Self::Running)
    }
}

#[derive(Debug, Clone)]
pub struct TaskSnapshot {
    pub shell_id: String,
    pub command: String,
    pub cwd: PathBuf,
    pub pid: u32,
    pub started_at_ms: u64,
    pub elapsed: Duration,
    pub status: String,
    pub running: bool,
    pub log_path: PathBuf,
}

struct BackgroundTask {
    shell_id: String,
    command: String,
    cwd: PathBuf,
    pid: u32,
    started_at: Instant,
    started_at_ms: u64,
    log_path: PathBuf,
    status: TaskStatus,
    kill_requested: bool,
    completion_noticed: bool,
}

#[derive(Default)]
struct RegistryState {
    tasks: HashMap<String, BackgroundTask>,
}

struct RegistryInner {
    state: Mutex<RegistryState>,
    changed: Condvar,
}

/// 会话级后台进程注册表：factory 每会话一份，Drop 时回收仍在运行的进程。
pub struct BackgroundTaskRegistry {
    inner: Arc<RegistryInner>,
    log_dir: PathBuf,
}

impl BackgroundTaskRegistry {
    #[must_use]
    pub fn new(log_dir: Option<PathBuf>) -> Self {
        let log_dir = log_dir.unwrap_or_else(|| {
            std::env::temp_dir().join(format!("giteam-bg-tasks-{}", std::process::id()))
        });
        Self {
            inner: Arc::new(RegistryInner {
                state: Mutex::new(RegistryState::default()),
                changed: Condvar::new(),
            }),
            log_dir,
        }
    }

    fn snapshot(task: &BackgroundTask) -> TaskSnapshot {
        let (status, running) = match task.status {
            TaskStatus::Running => ("running".to_string(), true),
            TaskStatus::Exited(code) => (format!("exited (code {code})"), false),
            TaskStatus::Killed(code) => (format!("killed (code {code})"), false),
        };
        TaskSnapshot {
            shell_id: task.shell_id.clone(),
            command: task.command.clone(),
            cwd: task.cwd.clone(),
            pid: task.pid,
            started_at_ms: task.started_at_ms,
            elapsed: task.started_at.elapsed(),
            status,
            running,
            log_path: task.log_path.clone(),
        }
    }

    fn with_task<R>(&self, shell_id: &str, f: impl FnOnce(&BackgroundTask) -> R) -> Option<R> {
        let state = self.inner.state.lock().ok()?;
        state.tasks.get(shell_id).map(f)
    }

    #[must_use]
    pub fn get(&self, shell_id: &str) -> Option<TaskSnapshot> {
        self.with_task(shell_id, Self::snapshot)
    }

    #[must_use]
    pub fn list(&self) -> Vec<TaskSnapshot> {
        let Ok(state) = self.inner.state.lock() else {
            return Vec::new();
        };
        let mut tasks: Vec<_> = state.tasks.values().map(Self::snapshot).collect();
        tasks.sort_by_key(|t| t.started_at_ms);
        tasks
    }

    /// 后台启动：独立进程组 + 日志落盘 + monitor 线程跟踪退出。
    pub fn spawn(
        &self,
        cwd: &Path,
        shell_path: Option<&str>,
        command_prefix: Option<&str>,
        command: &str,
    ) -> std::result::Result<TaskSnapshot, String> {
        if !cwd.exists() {
            return Err(format!(
                "Working directory does not exist: {}",
                cwd.display()
            ));
        }
        let shell = shell_path.map(str::to_string).unwrap_or_else(|| {
            for path in ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"] {
                if Path::new(path).exists() {
                    return path.to_string();
                }
            }
            "sh".to_string()
        });
        let command = command_prefix
            .filter(|p| !p.trim().is_empty())
            .map_or_else(|| command.to_string(), |prefix| format!("{prefix}\n{command}"));

        fs::create_dir_all(&self.log_dir).map_err(|e| format!("failed to create log dir: {e}"))?;
        let shell_id = format!("bg-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        let log_path = self.log_dir.join(format!("{shell_id}.log"));
        let log_file = File::create(&log_path)
            .map_err(|e| format!("failed to create log file {}: {e}", log_path.display()))?;
        let log_err = log_file
            .try_clone()
            .map_err(|e| format!("failed to clone log file handle: {e}"))?;

        let mut cmd = Command::new(&shell);
        cmd.arg("-c")
            .arg(&command)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_err));
        isolate_process_group(&mut cmd);

        let mut child: Child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn shell {shell}: {e}"))?;
        let pid = child.id();
        let started_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);

        let task = BackgroundTask {
            shell_id: shell_id.clone(),
            command: command.clone(),
            cwd: cwd.to_path_buf(),
            pid,
            started_at: Instant::now(),
            started_at_ms,
            log_path: log_path.clone(),
            status: TaskStatus::Running,
            kill_requested: false,
            completion_noticed: false,
        };
        let snapshot = Self::snapshot(&task);
        {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|e| format!("registry lock poisoned: {e}"))?;
            state.tasks.insert(shell_id.clone(), task);
        }

        // monitor 线程：等待退出并更新状态，唤醒 bash_output 的 waiter。
        let inner = Arc::clone(&self.inner);
        let monitor_id = shell_id.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            let code = status.map_or(-1, |s| exit_status_code(&s));
            if let Ok(mut state) = inner.state.lock() {
                if let Some(task) = state.tasks.get_mut(&monitor_id) {
                    task.status = if task.kill_requested {
                        TaskStatus::Killed(code)
                    } else {
                        TaskStatus::Exited(code)
                    };
                }
            }
            inner.changed.notify_all();
        });

        Ok(snapshot)
    }

    /// 限时等待退出：condvar 阻塞在独立线程，结果经 oneshot 送回 async 侧。
    pub fn wait_for_exit_async(
        &self,
        shell_id: &str,
        timeout: Duration,
    ) -> futures::channel::oneshot::Receiver<Option<TaskSnapshot>> {
        let (tx, rx) = futures::channel::oneshot::channel();
        let inner = Arc::clone(&self.inner);
        let id = shell_id.to_string();
        std::thread::spawn(move || {
            let deadline = Instant::now() + timeout;
            let snapshot = {
                let Ok(mut state) = inner.state.lock() else {
                    let _ = tx.send(None);
                    return;
                };
                loop {
                    if let Some(task) = state.tasks.get(&id) {
                        if !task.status.is_running() {
                            break Some(Self::snapshot(task));
                        }
                    } else {
                        break None;
                    }
                    let now = Instant::now();
                    if now >= deadline {
                        break state.tasks.get(&id).map(Self::snapshot);
                    }
                    let remaining = deadline.saturating_duration_since(now);
                    let slice = remaining.min(Duration::from_millis(100));
                    state = match inner.changed.wait_timeout(state, slice) {
                        Ok((guard, _)) => guard,
                        Err(_) => break None,
                    };
                }
            };
            let _ = tx.send(snapshot);
        });
        rx
    }

    /// 终止进程组树：先 SIGTERM，宽限后 SIGKILL（Windows 走 taskkill /T /F）。
    pub fn kill(&self, shell_id: &str) -> Option<TaskSnapshot> {
        let (pid, running) = {
            let Ok(mut state) = self.inner.state.lock() else {
                return None;
            };
            let task = state.tasks.get_mut(shell_id)?;
            task.kill_requested = true;
            (task.pid, task.status.is_running())
        };
        if running {
            terminate_process_tree(pid);
            // 给 monitor 线程一个窗口写入 Killed 状态。
            let deadline = Instant::now() + KILL_GRACE + Duration::from_secs(1);
            while Instant::now() < deadline {
                if let Some(snapshot) = self.get(shell_id) {
                    if !snapshot.running {
                        return Some(snapshot);
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        self.get(shell_id)
    }

    /// 取走「自上次以来完成」的通知（每个完成事件只取一次）。
    pub fn take_completion_notices(&self) -> Vec<String> {
        let Ok(mut state) = self.inner.state.lock() else {
            return Vec::new();
        };
        let mut notices = Vec::new();
        for task in state.tasks.values_mut() {
            if task.status.is_running() || task.completion_noticed {
                continue;
            }
            task.completion_noticed = true;
            let mut command = task.command.clone();
            if command.chars().count() > NOTICE_COMMAND_CHARS {
                command = command.chars().take(NOTICE_COMMAND_CHARS).collect();
                command.push('…');
            }
            notices.push(format!(
                "{} {} after {}s: {}",
                task.shell_id,
                match task.status {
                    TaskStatus::Exited(code) => format!("exited (code {code})"),
                    TaskStatus::Killed(code) => format!("killed (code {code})"),
                    TaskStatus::Running => unreachable!(),
                },
                task.started_at.elapsed().as_secs(),
                command,
            ));
        }
        notices
    }

    /// 会话结束回收：杀掉所有仍在运行的后台进程。
    pub fn kill_all(&self) {
        let ids: Vec<String> = {
            let Ok(state) = self.inner.state.lock() else {
                return;
            };
            state
                .tasks
                .values()
                .filter(|t| t.status.is_running())
                .map(|t| t.shell_id.clone())
                .collect()
        };
        for id in ids {
            let _ = self.kill(&id);
        }
    }
}

impl Drop for BackgroundTaskRegistry {
    fn drop(&mut self) {
        self.kill_all();
    }
}

// ============================================================================
// 平台进程操作
// ============================================================================

#[cfg(unix)]
fn isolate_process_group(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            // setsid：子进程自立会话/进程组，killpg 可整组回收。
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
fn isolate_process_group(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW：独立进程组便于整树回收，
    // 同时避免 GUI 宿主下每次 bash 后台任务闪出控制台。
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
}

#[cfg(not(any(unix, windows)))]
fn isolate_process_group(_cmd: &mut Command) {}

#[cfg(unix)]
fn signal_process_group(pid: u32, signal: i32) {
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

#[cfg(unix)]
fn terminate_process_tree(pid: u32) {
    signal_process_group(pid, libc::SIGTERM);
    std::thread::sleep(KILL_GRACE);
    signal_process_group(pid, libc::SIGKILL);
}

#[cfg(windows)]
fn terminate_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(_pid: u32) {}

#[cfg(unix)]
fn exit_status_code(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status
        .code()
        .unwrap_or_else(|| status.signal().map_or(-1, |signal| -signal))
}

#[cfg(not(unix))]
fn exit_status_code(status: &std::process::ExitStatus) -> i32 {
    status.code().unwrap_or(-1)
}

// ============================================================================
// 输出读取
// ============================================================================

/// 读取日志尾部：按字节与行数双上限截取，返回 (text, truncated)。
fn read_log_tail(path: &Path) -> (String, bool) {
    let Ok(mut file) = File::open(path) else {
        return (String::new(), false);
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut truncated = false;
    if len > OUTPUT_TAIL_BYTES {
        truncated = true;
        let start = len - OUTPUT_TAIL_BYTES;
        use std::io::{Seek, SeekFrom};
        let _ = file.seek(SeekFrom::Start(start));
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return (String::new(), truncated);
    }
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if truncated {
        // 第一行可能是半行，丢弃。
        if let Some(pos) = text.find('\n') {
            text.drain(..=pos);
        }
    }
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > OUTPUT_TAIL_LINES {
        truncated = true;
        text = lines[lines.len() - OUTPUT_TAIL_LINES..].join("\n");
    }
    (text, truncated)
}

fn format_elapsed(elapsed: Duration) -> String {
    let secs = elapsed.as_secs();
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m{}s", secs / 60, secs % 60)
    } else {
        format!("{}h{}m", secs / 3600, (secs % 3600) / 60)
    }
}

fn render_snapshot(snapshot: &TaskSnapshot) -> String {
    format!(
        "{}  {}  pid {}  {}  {}",
        snapshot.shell_id,
        snapshot.status,
        snapshot.pid,
        format_elapsed(snapshot.elapsed),
        snapshot.command.lines().next().unwrap_or(""),
    )
}

fn prepend_notices(notices: Vec<String>, body: String) -> String {
    if notices.is_empty() {
        return body;
    }
    let header = notices
        .iter()
        .map(|n| format!("- {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("Background shells completed since last call:\n{header}\n\n{body}")
}

fn text_output(text: String, details: Option<Value>, is_error: bool) -> ToolOutput {
    ToolOutput {
        content: vec![ContentBlock::Text(TextContent::new(text))],
        details,
        is_error,
    }
}

// ============================================================================
// bash 工具（Giteam 版）：前台委托 pi，新增 run_in_background
// ============================================================================

pub struct GiteamBashTool {
    inner: pi::tools::BashTool,
    registry: Arc<BackgroundTaskRegistry>,
    cwd: PathBuf,
    shell_path: Option<String>,
    command_prefix: Option<String>,
}

impl GiteamBashTool {
    #[must_use]
    pub fn new(
        cwd: &Path,
        config: &pi::sdk::Config,
        registry: Arc<BackgroundTaskRegistry>,
    ) -> Self {
        let shell_path = config.shell_path.clone();
        let command_prefix = config.shell_command_prefix.clone();
        let inner =
            pi::tools::BashTool::with_shell(cwd, shell_path.clone(), command_prefix.clone());
        Self {
            inner,
            registry,
            cwd: cwd.to_path_buf(),
            shell_path,
            command_prefix,
        }
    }
}

#[async_trait]
impl Tool for GiteamBashTool {
    fn name(&self) -> &str {
        "bash"
    }

    fn label(&self) -> &str {
        "bash"
    }

    fn description(&self) -> &str {
        "Execute a bash command in the current working directory. Returns stdout and stderr; \
         output is truncated to the last 2000 lines or 1MB.\n\
         Foreground (default): returns when the command exits. `timeout` is in seconds, \
         defaults to 120, maximum 600; `timeout: 0` is rejected. Commands needing longer must \
         run in the background.\n\
         Background: set run_in_background=true for servers, watchers, and any command that \
         does not exit on its own. The call returns immediately with a shell_id; output goes \
         to a log file. Use bash_output to read output or wait for completion, and kill_shell \
         to terminate. Do NOT use a trailing '&', nohup, setsid, or disown — the tool manages \
         backgrounding itself. After starting a server, verify readiness with a health check \
         (e.g. curl) in a separate foreground call instead of sleeping blindly. Background \
         shells are terminated when this session ends."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Bash command to execute"
                },
                "timeout": {
                    "type": "integer",
                    "description": "Foreground timeout in seconds (default 120, max 600; 0 is rejected). Ignored with run_in_background."
                },
                "run_in_background": {
                    "type": "boolean",
                    "description": "Run without blocking and return a shell_id immediately. Required for long-lived commands (dev servers, watchers, daemons)."
                }
            },
            "required": ["command"]
        })
    }

    fn effects(&self) -> ToolEffects {
        self.inner.effects()
    }

    async fn execute(
        &self,
        tool_call_id: &str,
        input: Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        #[derive(serde::Deserialize)]
        struct GiteamBashInput {
            command: String,
            timeout: Option<u64>,
            #[serde(default, alias = "runInBackground")]
            run_in_background: bool,
        }
        let input: GiteamBashInput = match serde_json::from_value(input) {
            Ok(parsed) => parsed,
            Err(error) => {
                return Ok(text_output(
                    format!("bash 参数无效：{error}"),
                    None,
                    true,
                ));
            }
        };

        let notices = self.registry.take_completion_notices();

        if input.run_in_background {
            return Ok(match self.registry.spawn(
                &self.cwd,
                self.shell_path.as_deref(),
                self.command_prefix.as_deref(),
                &input.command,
            ) {
                Ok(snapshot) => {
                    let body = format!(
                        "Started background shell {} (pid {}, {}).\n\
                         Log: {}\n\
                         Use bash_output(shell_id=\"{}\") to read output or wait for exit, \
                         and kill_shell(shell_id=\"{}\") to terminate. Verify readiness with a \
                         health check in a separate foreground call.",
                        snapshot.shell_id,
                        snapshot.pid,
                        snapshot.status,
                        snapshot.log_path.display(),
                        snapshot.shell_id,
                        snapshot.shell_id,
                    );
                    text_output(
                        prepend_notices(notices, body),
                        Some(serde_json::json!({
                            "background": true,
                            "shellId": snapshot.shell_id,
                            "pid": snapshot.pid,
                            "logPath": snapshot.log_path,
                        })),
                        false,
                    )
                }
                Err(error) => text_output(
                    prepend_notices(notices, format!("Failed to start background shell: {error}")),
                    None,
                    true,
                ),
            });
        }

        if let Some(guidance) = foreground_guard(&input.command, input.timeout) {
            return Ok(text_output(prepend_notices(notices, guidance), None, true));
        }

        // 前台委托 pi 内置 bash（超时默认 120s，进程组树超时回收均已内置）。
        let delegated = serde_json::json!({
            "command": input.command,
            "timeout": input.timeout,
        });
        let mut output = self
            .inner
            .execute(tool_call_id, delegated, on_update)
            .await?;
        if !notices.is_empty() {
            if let Some(ContentBlock::Text(text)) = output.content.first_mut() {
                text.text = prepend_notices(notices, std::mem::take(&mut text.text));
            }
        }
        Ok(output)
    }
}

// ============================================================================
// bash_output 工具
// ============================================================================

pub struct BashOutputTool {
    registry: Arc<BackgroundTaskRegistry>,
}

impl BashOutputTool {
    #[must_use]
    pub fn new(registry: Arc<BackgroundTaskRegistry>) -> Self {
        Self { registry }
    }
}

#[async_trait]
impl Tool for BashOutputTool {
    fn name(&self) -> &str {
        "bash_output"
    }

    fn label(&self) -> &str {
        "bash_output"
    }

    fn description(&self) -> &str {
        "Read the output and status of a background shell started with \
         bash(run_in_background=true). `shell_id` identifies the shell; omit it to list all \
         background shells of this session. `wait` (seconds, default 0, max 600) blocks up to \
         that long for the shell to exit. Returns the tail of the log plus the full log path \
         for deeper inspection. Prefer waiting on this over sleeping in bash."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "shell_id": {
                    "type": "string",
                    "description": "Background shell id (bg-xxxxxxxx). Omit to list all background shells."
                },
                "wait": {
                    "type": "integer",
                    "description": "Seconds to wait for the shell to exit (default 0 = return immediately, max 600)."
                }
            }
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let shell_id = input
            .get("shell_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let wait_secs = input
            .get("wait")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(MAX_OUTPUT_WAIT_SECS);

        let notices = self.registry.take_completion_notices();

        let Some(shell_id) = shell_id else {
            let tasks = self.registry.list();
            let body = if tasks.is_empty() {
                "No background shells in this session.".to_string()
            } else {
                tasks.iter().map(render_snapshot).collect::<Vec<_>>().join("\n")
            };
            return Ok(text_output(prepend_notices(notices, body), None, false));
        };

        let mut snapshot = self.registry.get(&shell_id);
        if wait_secs > 0 && snapshot.as_ref().is_some_and(|s| s.running) {
            if let Ok(done) = self
                .registry
                .wait_for_exit_async(&shell_id, Duration::from_secs(wait_secs))
                .await
            {
                if done.is_some() {
                    snapshot = done;
                }
            }
        }

        let Some(snapshot) = snapshot else {
            let known = self.registry.list();
            let hint = if known.is_empty() {
                "No background shells exist in this session.".to_string()
            } else {
                format!("Known shells:\n{}", known.iter().map(render_snapshot).collect::<Vec<_>>().join("\n"))
            };
            return Ok(text_output(
                prepend_notices(notices, format!("Unknown shell_id \"{shell_id}\". {hint}")),
                None,
                true,
            ));
        };

        let (tail, truncated) = read_log_tail(&snapshot.log_path);
        let mut body = format!(
            "shell_id: {}\nstatus: {} (pid {}, elapsed {})\nlog: {}\n",
            snapshot.shell_id,
            snapshot.status,
            snapshot.pid,
            format_elapsed(snapshot.elapsed),
            snapshot.log_path.display(),
        );
        if tail.is_empty() {
            body.push_str("--- output ---\n(no output yet)");
        } else {
            body.push_str(if truncated {
                "--- output (tail, truncated) ---\n"
            } else {
                "--- output ---\n"
            });
            body.push_str(&tail);
        }
        Ok(text_output(
            prepend_notices(notices, body),
            Some(serde_json::json!({
                "shellId": snapshot.shell_id,
                "status": snapshot.status,
                "running": snapshot.running,
                "pid": snapshot.pid,
                "cwd": snapshot.cwd,
                "logPath": snapshot.log_path,
                "truncated": truncated,
            })),
            false,
        ))
    }
}

// ============================================================================
// kill_shell 工具
// ============================================================================

pub struct KillShellTool {
    registry: Arc<BackgroundTaskRegistry>,
}

impl KillShellTool {
    #[must_use]
    pub fn new(registry: Arc<BackgroundTaskRegistry>) -> Self {
        Self { registry }
    }
}

#[async_trait]
impl Tool for KillShellTool {
    fn name(&self) -> &str {
        "kill_shell"
    }

    fn label(&self) -> &str {
        "kill_shell"
    }

    fn description(&self) -> &str {
        "Terminate a background shell started with bash(run_in_background=true), including \
         its whole process tree. Always kill shells you started once they are no longer \
         needed — dev servers keep ports occupied."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "shell_id": {
                    "type": "string",
                    "description": "Background shell id (bg-xxxxxxxx) to terminate."
                }
            },
            "required": ["shell_id"]
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::process()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let shell_id = input
            .get("shell_id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let Some(shell_id) = shell_id else {
            return Ok(text_output(
                "kill_shell 参数无效：缺少 shell_id".to_string(),
                None,
                true,
            ));
        };

        let notices = self.registry.take_completion_notices();
        match self.registry.kill(&shell_id) {
            Some(snapshot) => Ok(text_output(
                prepend_notices(
                    notices,
                    format!(
                        "Shell {} is now {} (pid {}).",
                        snapshot.shell_id, snapshot.status, snapshot.pid
                    ),
                ),
                Some(serde_json::json!({
                    "shellId": snapshot.shell_id,
                    "status": snapshot.status,
                    "running": snapshot.running,
                    "pid": snapshot.pid,
                })),
                snapshot.running,
            )),
            None => Ok(text_output(
                prepend_notices(notices, format!("Unknown shell_id \"{shell_id}\".")),
                None,
                true,
            )),
        }
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guard_rejects_zero_timeout() {
        let guidance = foreground_guard("sleep 5", Some(0)).expect("timeout 0 must be rejected");
        assert!(guidance.contains("run_in_background"), "guidance: {guidance}");
    }

    #[test]
    fn guard_rejects_excessive_timeout() {
        assert!(foreground_guard("make build", Some(601)).is_some());
        assert!(foreground_guard("make build", Some(600)).is_none());
        assert!(foreground_guard("make build", Some(120)).is_none());
    }

    #[test]
    fn guard_allows_normal_commands() {
        for cmd in [
            "cargo test",
            "git status",
            "npm install",
            "ls -la",
            "curl -s http://localhost:8080/health",
        ] {
            assert!(foreground_guard(cmd, None).is_none(), "should allow: {cmd}");
        }
    }

    #[test]
    fn guard_flags_long_lived_servers() {
        for cmd in [
            "python3 -m http.server 8080 --directory pomodoro",
            "python -m http.server 8000",
            "npm run dev",
            "pnpm dev",
            "yarn start",
            "bun run serve",
            "docker compose up",
            "docker-compose up --build",
            "uvicorn app:app --port 8000",
            "npx vite --port 5173",
            "next dev",
            "nodemon server.js",
            "gunicorn app:app",
            "tail -f /var/log/syslog",
            "watch -n 1 ls",
            "flask run",
            "cargo watch -x test",
        ] {
            assert!(
                foreground_guard(cmd, None).is_some(),
                "should flag: {cmd}"
            );
        }
    }

    #[test]
    fn guard_allows_detached_compose_and_help() {
        assert!(foreground_guard("docker compose up -d", None).is_none());
        assert!(foreground_guard("docker compose up --detach", None).is_none());
        assert!(foreground_guard("npm run dev --help", None).is_none());
        assert!(foreground_guard("uvicorn --version", None).is_none());
    }

    #[test]
    fn guard_flags_shell_backgrounding() {
        for cmd in [
            "python3 -m http.server 8080 &",
            "nohup node server.js > /dev/null 2>&1 &",
            "setsid ./daemon.sh",
            "sleep 10 & echo done",
            "sudo nohup ./server &",
        ] {
            assert!(
                foreground_guard(cmd, None).is_some(),
                "should flag: {cmd}"
            );
        }
    }

    #[test]
    fn guard_ignores_quoted_keywords() {
        // 引号内的关键词不得误伤
        assert!(
            foreground_guard("git commit -m \"fix http.server hang\"", None).is_none(),
            "quoted http.server must not trigger"
        );
        assert!(
            foreground_guard("python3 -c \"import os; os.setsid()\"", None).is_none(),
            "quoted setsid must not trigger"
        );
        // 逻辑与 && 不算后台符号
        assert!(foreground_guard("cargo build && cargo test", None).is_none());
    }

    #[test]
    fn strip_quotes_removes_string_content() {
        assert_eq!(strip_quotes("echo 'hello world' x"), "echo   x");
        assert_eq!(strip_quotes("echo \"a\\\"b\" y"), "echo   y");
        assert_eq!(strip_quotes("echo `pwd` z"), "echo   z");
    }

    fn test_registry() -> Arc<BackgroundTaskRegistry> {
        let dir = std::env::temp_dir().join(format!(
            "giteam-bg-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        Arc::new(BackgroundTaskRegistry::new(Some(dir)))
    }

    #[cfg(unix)]
    #[test]
    fn registry_spawn_wait_and_read_output() {
        let registry = test_registry();
        let snapshot = registry
            .spawn(Path::new("/tmp"), None, None, "echo hello-background")
            .expect("spawn should succeed");
        assert!(snapshot.running);
        assert!(snapshot.shell_id.starts_with("bg-"));

        // 等进程退出
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut final_snapshot = registry.get(&snapshot.shell_id).expect("task exists");
        while final_snapshot.running && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
            final_snapshot = registry.get(&snapshot.shell_id).expect("task exists");
        }
        assert!(!final_snapshot.running, "process should have exited");
        assert_eq!(final_snapshot.status, "exited (code 0)");

        let (tail, truncated) = read_log_tail(&final_snapshot.log_path);
        assert!(!truncated);
        assert!(tail.contains("hello-background"), "tail: {tail}");

        // 完成通知只取一次
        let notices = registry.take_completion_notices();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains(&snapshot.shell_id));
        assert!(registry.take_completion_notices().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn registry_kill_terminates_long_runner() {
        let registry = test_registry();
        let snapshot = registry
            .spawn(Path::new("/tmp"), None, None, "sleep 300")
            .expect("spawn should succeed");
        let killed = registry.kill(&snapshot.shell_id).expect("task exists");
        assert!(!killed.running, "sleep 300 should be terminated");
        assert!(killed.status.starts_with("killed"), "status: {}", killed.status);
        // 进程组确已不在
        let alive = unsafe { libc::kill(-(snapshot.pid as i32), 0) } == 0;
        assert!(!alive, "process group should be gone");
    }

    #[cfg(unix)]
    #[test]
    fn registry_wait_for_exit_async_unblocks_on_completion() {
        let registry = test_registry();
        let snapshot = registry
            .spawn(Path::new("/tmp"), None, None, "sleep 0.2 && echo done")
            .expect("spawn should succeed");
        let rx = registry.wait_for_exit_async(&snapshot.shell_id, Duration::from_secs(10));
        let done = futures::executor::block_on(rx).expect("waiter sends");
        let snapshot = done.expect("task resolves");
        assert!(!snapshot.running);
        let (tail, _) = read_log_tail(&snapshot.log_path);
        assert!(tail.contains("done"), "tail: {tail}");
    }

    #[cfg(unix)]
    #[test]
    fn registry_list_and_unknown_shell() {
        let registry = test_registry();
        assert!(registry.list().is_empty());
        let snapshot = registry
            .spawn(Path::new("/tmp"), None, None, "sleep 300")
            .expect("spawn should succeed");
        assert_eq!(registry.list().len(), 1);
        assert!(registry.get("bg-nonexistent").is_none());
        registry.kill_all();
        assert!(registry.list().iter().all(|t| !t.running));
        let _ = snapshot;
    }

    #[cfg(unix)]
    #[test]
    fn background_children_are_killed_with_group() {
        // 背景子进程（cmd &）随进程组一起回收，不留孤儿。
        let registry = test_registry();
        let snapshot = registry
            .spawn(
                Path::new("/tmp"),
                None,
                None,
                "sleep 300 & echo child-started; sleep 300",
            )
            .expect("spawn should succeed");
        std::thread::sleep(Duration::from_millis(200));
        let killed = registry.kill(&snapshot.shell_id).expect("task exists");
        assert!(!killed.running);
        std::thread::sleep(Duration::from_millis(200));
        let alive = unsafe { libc::kill(-(snapshot.pid as i32), 0) } == 0;
        assert!(!alive, "whole group should be gone");
    }
}

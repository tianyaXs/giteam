//! 接收端：下载 → 校验 → clone → rekey → 注册。

use super::manifest::ShareManifest;
use super::{client, pack, ShareError, ShareResult};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 导入进度回调（Desktop UI 可选注入）。
pub type ImportProgressHook = Arc<dyn Fn(ImportProgress) + Send + Sync>;

/// 取消标志：`true` 时导入应尽快退出。
pub type ImportCancelFlag = Arc<AtomicBool>;

/// 导入进度快照（整体 percent + 可选字节进度）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    /// `meta` / `download_context` / `unpack` / `clone` / `download_repo` / `apply` / `done`
    pub stage: String,
    pub message: String,
    /// 0–100。
    pub percent: u8,
    pub bytes_done: Option<u64>,
    pub bytes_total: Option<u64>,
}

#[derive(Clone, Default)]
pub struct ImportOptions {
    /// 显式目标目录（默认 `~/giteam-projects/<repo-name>`，冲突自动追加序号）。
    pub dir: Option<PathBuf>,
    /// 已有同仓场景：跳过代码克隆，仅把上下文 rekey 到既有仓库路径。
    pub attach: Option<PathBuf>,
    /// 覆盖显示名与默认目标文件夹名（默认用 manifest.repo.name）。
    pub name: Option<String>,
    /// 进度回调（None = 静默）。
    pub on_progress: Option<ImportProgressHook>,
    /// 取消标志（置位后下载/克隆循环会返回 `Cancelled`）。
    pub cancel: Option<ImportCancelFlag>,
}

fn is_cancelled(opts: &ImportOptions) -> bool {
    opts.cancel
        .as_ref()
        .map(|flag| flag.load(Ordering::SeqCst))
        .unwrap_or(false)
}

fn check_cancelled(opts: &ImportOptions) -> ShareResult<()> {
    if is_cancelled(opts) {
        Err(ShareError::Cancelled)
    } else {
        Ok(())
    }
}

fn emit_progress(
    opts: &ImportOptions,
    stage: &str,
    message: &str,
    percent: u8,
    bytes_done: Option<u64>,
    bytes_total: Option<u64>,
) {
    let Some(hook) = opts.on_progress.as_ref() else {
        return;
    };
    hook(ImportProgress {
        stage: stage.to_string(),
        message: message.to_string(),
        percent: percent.min(100),
        bytes_done,
        bytes_total,
    });
}

fn map_download_percent(start: u8, end: u8, done: u64, total: Option<u64>) -> u8 {
    let span = end.saturating_sub(start);
    let Some(total) = total.filter(|t| *t > 0) else {
        return start;
    };
    let ratio = (done as f64 / total as f64).clamp(0.0, 1.0);
    start.saturating_add((ratio * f64::from(span)).round() as u8)
}

#[derive(Debug)]
pub struct ImportOutcome {
    pub target_dir: PathBuf,
    pub share_id: String,
    pub repo_name: String,
    pub sessions_imported: usize,
    pub catalog_records_merged: usize,
    pub memory_imported: bool,
    pub attachments_imported: u64,
    pub reviews_imported: usize,
    /// 路径重写命中的文件数（jsonl / catalog / memory.db 行）。
    pub rekeyed_entries: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedReviewRecord {
    id: String,
    commit_sha: String,
    status: String,
    summary: String,
    findings_json: String,
    created_at: String,
    created_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedReviewAction {
    id: String,
    review_id: String,
    finding_id: String,
    action: String,
    note: Option<String>,
    created_at: String,
    created_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedReviews {
    #[serde(default)]
    records: Vec<ExportedReviewRecord>,
    #[serde(default)]
    actions: Vec<ExportedReviewAction>,
}

fn canonical_string(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn run_git(repo: &Path, args: &[&str]) -> ShareResult<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| ShareError::Git(format!("spawn git: {e}")))?;
    if !output.status.success() {
        return Err(ShareError::Git(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_git_in(dir: &Path, args: &[String]) -> ShareResult<String> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(dir, &refs)
}

/// 可取消的 git 子进程（用于长时间 clone）；取消时 kill 并返回 `Cancelled`。
fn run_git_in_cancellable(
    opts: &ImportOptions,
    dir: &Path,
    args: &[String],
) -> ShareResult<String> {
    check_cancelled(opts)?;
    let Some(cancel) = opts.cancel.clone() else {
        return run_git_in(dir, args);
    };
    let mut child = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| ShareError::Git(format!("spawn git: {e}")))?;
    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| ShareError::Git("missing git stdout".into()))?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| ShareError::Git("missing git stderr".into()))?;
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ShareError::Cancelled);
        }
        match child
            .try_wait()
            .map_err(|e| ShareError::Git(format!("wait git: {e}")))?
        {
            Some(status) => {
                use std::io::Read;
                let mut stdout = String::new();
                let mut stderr = String::new();
                let _ = stdout_pipe.read_to_string(&mut stdout);
                let _ = stderr_pipe.read_to_string(&mut stderr);
                if !status.success() {
                    return Err(ShareError::Git(format!(
                        "git {} failed: {}",
                        args.join(" "),
                        stderr.trim()
                    )));
                }
                return Ok(stdout.trim().to_string());
            }
            None => std::thread::sleep(Duration::from_millis(120)),
        }
    }
}

fn home_dir() -> ShareResult<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Ok(PathBuf::from(home));
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        if !home.is_empty() {
            return Ok(PathBuf::from(home));
        }
    }
    Err(ShareError::InvalidInput(
        "cannot resolve home directory".into(),
    ))
}

/// 选定目标目录：`~/giteam-projects/<name>`，冲突时追加 `-2` / `-3`…
fn resolve_target_dir(repo_name: &str, explicit: Option<&PathBuf>) -> ShareResult<PathBuf> {
    if let Some(dir) = explicit {
        return Ok(dir.clone());
    }
    let base = home_dir()?.join("giteam-projects");
    let candidate = base.join(repo_name);
    if !candidate.exists() {
        return Ok(candidate);
    }
    for index in 2..100 {
        let next = base.join(format!("{repo_name}-{index}"));
        if !next.exists() {
            return Ok(next);
        }
    }
    Err(ShareError::InvalidInput(
        "cannot find free target directory".into(),
    ))
}

fn replace_paths(text: &str, from: &str, to: &str) -> (String, u64) {
    if from.trim().is_empty() || from == to {
        return (text.to_string(), 0);
    }
    let hits = text.matches(from).count() as u64;
    if hits == 0 {
        return (text.to_string(), 0);
    }
    (text.replace(from, to), hits)
}

/// 会话文件落盘 + 路径重写。
fn import_sessions(
    staging_sessions: &Path,
    new_sessions_dir: &Path,
    origin_hint: &str,
    new_repo_path: &str,
    sessions_dir_hint: &str,
) -> ShareResult<(usize, u64)> {
    if !staging_sessions.is_dir() {
        return Ok((0, 0));
    }
    let mut imported = 0usize;
    let mut rekeyed = 0u64;
    let mut entries: Vec<_> = fs::read_dir(staging_sessions)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    entries.sort();
    for src in entries {
        let name = src
            .file_name()
            .ok_or_else(|| ShareError::Package("bad session file name".into()))?;
        let text = fs::read_to_string(&src).map_err(|e| {
            ShareError::Package(format!("session file not utf-8 ({}): {e}", src.display()))
        })?;
        let (text, hits_repo) = replace_paths(&text, origin_hint, new_repo_path);
        let (text, hits_dir) = replace_paths(&text, sessions_dir_hint, &new_sessions_dir.to_string_lossy());
        fs::write(new_sessions_dir.join(name), text)?;
        imported += 1;
        if hits_repo + hits_dir > 0 {
            rekeyed += 1;
        }
    }
    Ok((imported, rekeyed))
}

/// 合并 context/catalog.json 进全局 catalog（按 sessionId 幂等去重 + 路径重写）。
fn import_catalog(
    staging_catalog: &Path,
    new_repo_path: &str,
    new_sessions_dir: &Path,
) -> ShareResult<usize> {
    if !staging_catalog.exists() {
        return Ok(0);
    }
    let bytes = fs::read(staging_catalog)?;
    let incoming: Vec<serde_json::Value> = serde_json::from_slice(&bytes)
        .map_err(|e| ShareError::Package(format!("context catalog parse: {e}")))?;
    if incoming.is_empty() {
        return Ok(0);
    }
    let Some(root) = crate::pi_agent::default_data_dir() else {
        return Err(ShareError::Persistence(
            "cannot resolve Giteam data directory (~/.giteam)".into(),
        ));
    };
    let catalog_path = root.join("pi-sessions").join("catalog.json");
    if let Some(parent) = catalog_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut global: Vec<serde_json::Value> = fs::read(&catalog_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let mut existing: std::collections::HashSet<String> = global
        .iter()
        .filter_map(|record| {
            record
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .collect();

    let mut merged = 0usize;
    for mut record in incoming {
        let session_id = record
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if session_id.is_empty() || existing.contains(&session_id) {
            continue;
        }
        let old_session_path = record
            .get("sessionPath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let file_name = Path::new(&old_session_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format!("session-{session_id}.jsonl"));
        record["repoPath"] = serde_json::Value::String(new_repo_path.to_string());
        record["sessionDir"] =
            serde_json::Value::String(new_sessions_dir.to_string_lossy().to_string());
        record["sessionPath"] =
            serde_json::Value::String(new_sessions_dir.join(&file_name).to_string_lossy().to_string());
        existing.insert(session_id);
        global.push(record);
        merged += 1;
    }
    if merged > 0 {
        let bytes = serde_json::to_vec_pretty(&global)
            .map_err(|e| ShareError::Persistence(format!("catalog serialize: {e}")))?;
        fs::write(&catalog_path, bytes)?;
    }
    Ok(merged)
}

/// 记忆库落盘 + SQL 路径重写。
fn import_memory_db(
    staging_db: &Path,
    target: &Path,
    origin_hint: &str,
    sessions_dir_hint: &str,
    warnings: &mut Vec<String>,
) -> ShareResult<(bool, u64)> {
    if !staging_db.exists() {
        return Ok((false, 0));
    }
    let Some(dst) = crate::pi_agent::memory_db_path_for_repo(target) else {
        return Err(ShareError::Persistence(
            "cannot resolve memory db path".into(),
        ));
    };
    if dst.exists() {
        warnings.push(format!(
            "目标已有记忆库 {}，跳过导入（未合并）",
            dst.display()
        ));
        return Ok((false, 0));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(staging_db, &dst)?;

    let new_repo_path = canonical_string(target);
    let new_sessions_dir = crate::pi_agent::pi_sessions_dir_for_repo(target)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let conn = rusqlite::Connection::open(&dst)
        .map_err(|e| ShareError::Persistence(format!("open imported memory.db: {e}")))?;
    let mut rekeyed = 0u64;
    let rewrite = |table: &str, key_col: &str, text_col: &str| -> ShareResult<u64> {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )
            .map_err(|e| ShareError::Persistence(e.to_string()))?;
        if !exists {
            return Ok(0);
        }
        let mut changed = 0u64;
        for (from, to) in [
            (origin_hint, new_repo_path.as_str()),
            (sessions_dir_hint, new_sessions_dir.as_str()),
        ] {
            if from.trim().is_empty() || from == to {
                continue;
            }
            let sql = format!(
                "UPDATE {table} SET {text_col} = replace({text_col}, ?1, ?2)
                 WHERE instr({text_col}, ?1) > 0"
            );
            changed += conn
                .execute(&sql, params![from, to])
                .map_err(|e| ShareError::Persistence(e.to_string()))?
                as u64;
        }
        let _ = key_col;
        Ok(changed)
    };
    rekeyed += rewrite("replay_state", "path", "path")?;
    rekeyed += rewrite("extraction_jobs", "turn_key", "input_json")?;
    rekeyed += rewrite("nodes", "id", "props")?;
    rekeyed += rewrite("edges", "id", "props")?;
    Ok((true, rekeyed))
}

/// 附件落盘：文本附件做与会话一致的路径重写，二进制原样拷贝。
fn copy_attachments_rekey(
    src: &Path,
    dst: &Path,
    origin_hint: &str,
    new_repo_path: &str,
    sessions_dir_hint: &str,
    new_sessions_dir: &str,
    rekeyed: &mut u64,
) -> ShareResult<u64> {
    let mut count = 0u64;
    if !src.is_dir() {
        return Ok(0);
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            count += copy_attachments_rekey(
                &path,
                &target,
                origin_hint,
                new_repo_path,
                sessions_dir_hint,
                new_sessions_dir,
                rekeyed,
            )?;
            continue;
        }
        let bytes = fs::read(&path)?;
        match String::from_utf8(bytes) {
            Ok(text) => {
                let (text, hits_a) = replace_paths(&text, origin_hint, new_repo_path);
                let (text, hits_b) = replace_paths(&text, sessions_dir_hint, new_sessions_dir);
                fs::write(&target, text)?;
                if hits_a + hits_b > 0 {
                    *rekeyed += 1;
                }
            }
            Err(err) => {
                fs::write(&target, err.into_bytes())?;
            }
        }
        count += 1;
    }
    Ok(count)
}

fn open_client_db() -> ShareResult<Option<rusqlite::Connection>> {
    let Some(path) = crate::pi_agent::default_data_dir().map(|root| root.join("client.db")) else {
        return Ok(None);
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| ShareError::Persistence(format!("open client.db: {e}")))?;
    conn.busy_timeout(std::time::Duration::from_millis(2000))
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    // 与 apps/desktop db.rs 保持同构的幂等建表。
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS repositories (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            added_at TEXT NOT NULL,
            added_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS review_records (
            id TEXT PRIMARY KEY,
            repo_path TEXT NOT NULL DEFAULT '',
            commit_sha TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL,
            findings_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS review_actions (
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
    .map_err(|e| ShareError::Persistence(e.to_string()))?;
    Ok(Some(conn))
}

fn register_repository(conn: &rusqlite::Connection, target: &Path, name: &str) -> ShareResult<()> {
    let canonical = canonical_string(target);
    let id = format!("repo-{}", now_ms());
    conn.execute(
        "INSERT OR IGNORE INTO repositories (id, path, name, added_at, added_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            canonical,
            name,
            chrono::Utc::now().to_rfc3339(),
            now_ms()
        ],
    )
    .map_err(|e| ShareError::Persistence(format!("register repository: {e}")))?;
    Ok(())
}

fn import_reviews(conn: &rusqlite::Connection, staging: &Path, new_repo_path: &str) -> ShareResult<usize> {
    if !staging.exists() {
        return Ok(0);
    }
    let bytes = fs::read(staging)?;
    let payload: ExportedReviews = serde_json::from_slice(&bytes)
        .map_err(|e| ShareError::Package(format!("reviews parse: {e}")))?;
    let mut count = 0usize;
    for record in &payload.records {
        conn.execute(
            "INSERT OR REPLACE INTO review_records
             (id, repo_path, commit_sha, status, summary, findings_json, created_at, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id,
                new_repo_path,
                record.commit_sha,
                record.status,
                record.summary,
                record.findings_json,
                record.created_at,
                record.created_at_ms,
            ],
        )
        .map_err(|e| ShareError::Persistence(format!("insert review record: {e}")))?;
        count += 1;
    }
    for action in &payload.actions {
        conn.execute(
            "INSERT OR REPLACE INTO review_actions
             (id, repo_path, review_id, finding_id, action, note, created_at, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                action.id,
                new_repo_path,
                action.review_id,
                action.finding_id,
                action.action,
                action.note,
                action.created_at,
                action.created_at_ms,
            ],
        )
        .map_err(|e| ShareError::Persistence(format!("insert review action: {e}")))?;
    }
    Ok(count)
}

/// 分享导入主流程。
pub fn import_share(share_url: &str, opts: &ImportOptions) -> ShareResult<ImportOutcome> {
    let (mut base, share_id) = client::parse_share_url(share_url)?;
    if base.is_empty() {
        let settings = crate::cloud::get_cloud_link_settings();
        base = settings.cloud_base_url.trim().to_string();
    }
    if base.is_empty() {
        return Err(ShareError::InvalidInput(
            "cannot resolve cloud base url; pass a full share url".into(),
        ));
    }

    emit_progress(opts, "meta", "正在读取分享信息…", 2, None, None);
    check_cancelled(opts)?;
    let meta = client::fetch_share_meta(&base, &share_id)?;
    check_cancelled(opts)?;
    if meta.status != "active" {
        return Err(ShareError::InvalidInput(format!(
            "share is not downloadable (status: {})",
            meta.status
        )));
    }
    if meta.encrypted {
        return Err(ShareError::InvalidInput(
            "E2E 加密分享暂未支持，将在 P3 提供".into(),
        ));
    }

    let mut warnings = Vec::new();
    let context_sha = if !meta.context_sha256.trim().is_empty() {
        meta.context_sha256.clone()
    } else {
        meta.meta
            .get("contextSha256")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let is_split = !context_sha.is_empty()
        || meta
            .meta
            .get("layout")
            .and_then(|v| v.as_str())
            .map(|s| s.starts_with("split"))
            .unwrap_or(false)
        || !meta.git_url.trim().is_empty();

    let staging = std::env::temp_dir().join(format!(
        "giteam-share-import-{}-{}",
        std::process::id(),
        now_ms()
    ));
    fs::create_dir_all(&staging)?;

    let result = if is_split {
        let context_hint = meta
            .context_size_bytes
            .max(
                meta.meta
                    .get("contextSizeBytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
            );
        let context_pkg = download_with_progress(
            opts,
            &base,
            &share_id,
            "context",
            &context_sha,
            "download_context",
            "正在下载会话与记忆…",
            5,
            42,
            if context_hint > 0 {
                Some(context_hint)
            } else {
                None
            },
        )?;
        let import_result =
            import_split(&base, &share_id, &context_pkg, &staging, &meta, opts, &mut warnings);
        let _ = fs::remove_file(&context_pkg);
        import_result
    } else {
        // P1 单包兼容：整包 tar.zst 内含 repo.bundle + context。
        let package = download_with_progress(
            opts,
            &base,
            &share_id,
            "blob",
            &meta.content_sha256,
            "download_context",
            "正在下载分享包…",
            5,
            55,
            if meta.size_bytes > 0 {
                Some(meta.size_bytes)
            } else {
                None
            },
        )
        .or_else(|_| {
            download_with_progress(
                opts,
                &base,
                &share_id,
                "context",
                &meta.content_sha256,
                "download_context",
                "正在下载分享包…",
                5,
                55,
                if meta.size_bytes > 0 {
                    Some(meta.size_bytes)
                } else {
                    None
                },
            )
        })?;
        let import_result =
            import_from_legacy_package(&package, &staging, &base, &share_id, opts, &mut warnings);
        let _ = fs::remove_file(&package);
        import_result
    };
    let _ = fs::remove_dir_all(&staging);
    let mut outcome = result?;
    outcome.warnings.append(&mut warnings);
    emit_progress(opts, "done", "导入完成", 100, None, None);
    Ok(outcome)
}

fn download_with_progress(
    opts: &ImportOptions,
    base: &str,
    share_id: &str,
    artifact: &str,
    expected_sha: &str,
    stage: &str,
    message: &str,
    percent_start: u8,
    percent_end: u8,
    size_hint: Option<u64>,
) -> ShareResult<PathBuf> {
    check_cancelled(opts)?;
    emit_progress(
        opts,
        stage,
        message,
        percent_start,
        Some(0),
        size_hint,
    );
    let mut last_percent = percent_start;
    let mut last_emit_done = 0u64;
    let hook = opts.on_progress.clone();
    let cancel = opts.cancel.clone();
    let stage_owned = stage.to_string();
    let message_owned = message.to_string();
    let mut on_bytes = |done: u64, total: Option<u64>| -> ShareResult<()> {
        if cancel
            .as_ref()
            .map(|flag| flag.load(Ordering::SeqCst))
            .unwrap_or(false)
        {
            return Err(ShareError::Cancelled);
        }
        let total = total.or(size_hint);
        let percent = map_download_percent(percent_start, percent_end, done, total);
        let should_emit = percent > last_percent
            || done.saturating_sub(last_emit_done) >= 256 * 1024
            || total.map(|t| done >= t).unwrap_or(false);
        if !should_emit {
            return Ok(());
        }
        last_percent = percent;
        last_emit_done = done;
        if let Some(hook) = hook.as_ref() {
            hook(ImportProgress {
                stage: stage_owned.clone(),
                message: message_owned.clone(),
                percent,
                bytes_done: Some(done),
                bytes_total: total,
            });
        }
        Ok(())
    };
    client::download_share_artifact_with_progress(
        base,
        share_id,
        artifact,
        expected_sha,
        Some(&mut on_bytes),
    )
}

fn import_split(
    base: &str,
    share_id: &str,
    context_package: &Path,
    staging: &Path,
    meta: &client::ShareMeta,
    opts: &ImportOptions,
    warnings: &mut Vec<String>,
) -> ShareResult<ImportOutcome> {
    check_cancelled(opts)?;
    emit_progress(opts, "unpack", "正在解压上下文…", 45, None, None);
    pack::unpack_archive(context_package, staging)?;
    check_cancelled(opts)?;
    let manifest_bytes = fs::read(staging.join("manifest.json"))
        .map_err(|e| ShareError::Package(format!("manifest missing: {e}")))?;
    let manifest = ShareManifest::parse(&manifest_bytes).map_err(ShareError::Package)?;
    if manifest.repo.dirty_worktree {
        warnings.push("分享导出时存在未提交变更，快照不含 working tree".to_string());
    }

    let display_name = opts
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(manifest.repo.name.as_str())
        .to_string();

    let git_url = if !meta.git_url.trim().is_empty() {
        meta.git_url.trim().to_string()
    } else {
        format!("{}/s/{share_id}/repo.git", base.trim_end_matches('/'))
    };

    let (target, cloned) = if let Some(attach) = &opts.attach {
        let canonical = fs::canonicalize(attach)
            .map_err(|e| ShareError::InvalidInput(format!("attach path: {e}")))?;
        if !canonical.is_dir() {
            return Err(ShareError::InvalidInput(format!(
                "attach path is not a directory: {}",
                attach.display()
            )));
        }
        (canonical, false)
    } else {
        let target = resolve_target_dir(&display_name, opts.dir.as_ref())?;
        let target_arg = target.to_string_lossy().to_string();
        // 优先 clone 云端 dumb-HTTP；失败时回退下载 repo.bundle。
        emit_progress(opts, "clone", "正在克隆代码仓库…", 50, None, None);
        let clone_remote = run_git_in_cancellable(
            opts,
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            &["clone".into(), git_url.clone(), target_arg.clone()],
        );
        if let Err(error) = clone_remote {
            let _ = fs::remove_dir_all(&target);
            if matches!(error, ShareError::Cancelled) {
                return Err(error);
            }
            warnings.push(format!(
                "从 git remote clone 失败，回退下载 repo.bundle：{error}"
            ));
            let repo_hint = meta.size_bytes.max(
                meta.meta
                    .get("repoSizeBytes")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0),
            );
            let bundle = download_with_progress(
                opts,
                base,
                share_id,
                "repo",
                &meta.content_sha256,
                "download_repo",
                "正在下载代码包…",
                52,
                82,
                if repo_hint > 0 { Some(repo_hint) } else { None },
            )?;
            let bundle_arg = bundle.to_string_lossy().to_string();
            emit_progress(opts, "clone", "正在从代码包还原仓库…", 84, None, None);
            let result = run_git_in_cancellable(
                opts,
                &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
                &["clone".into(), bundle_arg, target_arg],
            );
            let _ = fs::remove_file(&bundle);
            if let Err(error) = result {
                let _ = fs::remove_dir_all(&target);
                return Err(error);
            }
        }
        (fs::canonicalize(&target).unwrap_or(target), true)
    };

    finish_import(
        &target,
        cloned,
        base,
        share_id,
        &git_url,
        &manifest,
        staging,
        &display_name,
        warnings,
        opts,
    )
}

fn import_from_legacy_package(
    package: &Path,
    staging: &Path,
    base: &str,
    share_id: &str,
    opts: &ImportOptions,
    warnings: &mut Vec<String>,
) -> ShareResult<ImportOutcome> {
    emit_progress(opts, "unpack", "正在解压分享包…", 58, None, None);
    pack::unpack_archive(package, staging)?;
    let manifest_bytes = fs::read(staging.join("manifest.json"))
        .map_err(|e| ShareError::Package(format!("manifest missing: {e}")))?;
    let manifest = ShareManifest::parse(&manifest_bytes).map_err(ShareError::Package)?;
    if manifest.repo.dirty_worktree {
        warnings.push("分享导出时存在未提交变更，快照不含 working tree".to_string());
    }

    let display_name = opts
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(manifest.repo.name.as_str())
        .to_string();

    let git_url = format!("{}/s/{share_id}/repo.git", base.trim_end_matches('/'));
    let (target, cloned) = if let Some(attach) = &opts.attach {
        let canonical = fs::canonicalize(attach)
            .map_err(|e| ShareError::InvalidInput(format!("attach path: {e}")))?;
        if !canonical.is_dir() {
            return Err(ShareError::InvalidInput(format!(
                "attach path is not a directory: {}",
                attach.display()
            )));
        }
        (canonical, false)
    } else {
        let target = resolve_target_dir(&display_name, opts.dir.as_ref())?;
        let bundle = staging.join("repo.bundle");
        let bundle_arg = bundle.to_string_lossy().to_string();
        let target_arg = target.to_string_lossy().to_string();
        emit_progress(opts, "clone", "正在从代码包还原仓库…", 70, None, None);
        run_git_in_cancellable(
            opts,
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            &["clone".into(), bundle_arg, target_arg.clone()],
        )?;
        (fs::canonicalize(&target).unwrap_or(target), true)
    };

    finish_import(
        &target,
        cloned,
        base,
        share_id,
        &git_url,
        &manifest,
        staging,
        &display_name,
        warnings,
        opts,
    )
}

fn finish_import(
    target: &Path,
    cloned: bool,
    base: &str,
    share_id: &str,
    git_url: &str,
    manifest: &ShareManifest,
    staging: &Path,
    display_name: &str,
    warnings: &mut Vec<String>,
    opts: &ImportOptions,
) -> ShareResult<ImportOutcome> {
    check_cancelled(opts)?;
    emit_progress(opts, "apply", "正在导入会话与记忆…", 88, None, None);
    // 幂等提示：已导入过同一分享。
    if let Ok(existing) = run_git(target, &["config", "--get", "giteam.shareId"]) {
        if existing == share_id {
            warnings.push("该仓库已导入过此分享（giteam.shareId 相同），上下文已按幂等规则合并".to_string());
        }
    }

    if cloned {
        let origin = if git_url.trim().is_empty() {
            format!("{}/s/{share_id}/repo.git", base.trim_end_matches('/'))
        } else {
            git_url.to_string()
        };
        let _ = run_git(target, &["remote", "set-url", "origin", &origin]);
        if !manifest.repo.upstream_url.trim().is_empty() {
            let _ = run_git(
                target,
                &["remote", "add", "upstream", manifest.repo.upstream_url.trim()],
            );
        }
    }
    let _ = run_git(target, &["config", "giteam.shareId", share_id]);

    // 2) rekey：会话 / catalog / 记忆
    let new_repo_path = canonical_string(target);
    let new_sessions_dir = crate::pi_agent::ensure_repo_pi_sessions_dir(target)
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    let origin_hint = manifest.repo.origin_path_hint.as_str();
    let sessions_dir_hint = manifest.context.sessions_dir_hint.as_str();

    emit_progress(opts, "apply", "正在写入会话…", 90, None, None);
    let (sessions_imported, rekeyed_sessions) = import_sessions(
        &staging.join("context").join("sessions"),
        &new_sessions_dir,
        origin_hint,
        &new_repo_path,
        sessions_dir_hint,
    )?;
    let catalog_merged = import_catalog(
        &staging.join("context").join("catalog.json"),
        &new_repo_path,
        &new_sessions_dir,
    )?;
    emit_progress(opts, "apply", "正在写入记忆与附件…", 94, None, None);
    let (memory_imported, rekeyed_memory) = import_memory_db(
        &staging.join("context").join("memory.db"),
        target,
        origin_hint,
        sessions_dir_hint,
        warnings,
    )?;

    // 3) 附件（文本做路径重写）
    let mut rekeyed_attachments = 0u64;
    let attachments_imported = copy_attachments_rekey(
        &staging.join("context").join("attachments"),
        &target.join(".giteam").join("prompt-attachments"),
        origin_hint,
        &new_repo_path,
        sessions_dir_hint,
        &new_sessions_dir.to_string_lossy(),
        &mut rekeyed_attachments,
    )?;
    if attachments_imported > 0 {
        crate::pi_agent::ensure_workspace_giteam_gitignore(target);
    }

    // 4) review 记录 + 仓库注册（统一走 client.db）
    emit_progress(opts, "apply", "正在注册项目…", 97, None, None);
    let mut reviews_imported = 0usize;
    if let Some(conn) = open_client_db()? {
        reviews_imported = import_reviews(
            &conn,
            &staging.join("context").join("reviews.json"),
            &new_repo_path,
        )?;
        register_repository(&conn, target, display_name)?;
    } else {
        warnings.push("无法解析 ~/.giteam，仓库未注册进项目列表".to_string());
    }

    Ok(ImportOutcome {
        target_dir: target.to_path_buf(),
        share_id: share_id.to_string(),
        repo_name: display_name.to_string(),
        sessions_imported,
        catalog_records_merged: catalog_merged,
        memory_imported,
        attachments_imported,
        reviews_imported,
        rekeyed_entries: rekeyed_sessions + rekeyed_memory + rekeyed_attachments,
        warnings: std::mem::take(warnings),
    })
}

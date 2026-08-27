//! 导出端：收集 git bundle + 上下文，脱敏后打包上传。

use super::manifest::{
    ShareContextInfo, ShareManifest, SharePackageInfo, ShareRepoInfo, ShareSourceInfo,
    MANIFEST_SCHEMA_VERSION,
};
use super::{client, pack, redact, RedactionStats, ShareError, ShareResult, UPLOAD_PART_SIZE};
use rusqlite::params;
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct ExportOptions {
    /// `git bundle create --all`；否则仅当前分支 + tags。
    pub all_refs: bool,
    /// 关闭内容脱敏（默认开启，不推荐关闭）。
    pub no_redact: bool,
    /// 附带 `client.db` 中该仓库的 review 记录（默认开启）。
    pub include_reviews: bool,
    /// 覆盖上下文包输出路径（默认系统临时目录）。
    pub out_file: Option<PathBuf>,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            all_refs: false,
            no_redact: false,
            include_reviews: true,
            out_file: None,
        }
    }
}

#[derive(Debug)]
pub struct ExportOutcome {
    /// 代码包：`git bundle`。
    pub repo_bundle_path: PathBuf,
    /// 上下文包：`manifest.json` + `context/` 的 tar.zst。
    pub context_package_path: PathBuf,
    pub manifest: ShareManifest,
    pub warnings: Vec<String>,
}

pub struct ShareCreated {
    pub share_id: String,
    pub share_url: String,
    pub git_url: String,
    pub manifest: ShareManifest,
    pub warnings: Vec<String>,
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

fn now_iso() -> String {
    let secs = (now_ms() / 1000).max(0) as u64;
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// days since epoch → (y, m, d)，Howard Hinnant 算法。
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 逐行脱敏复制（JSONL 场景：单行可能很大，但不能整文件载入）。
fn redact_copy_lines(src: &Path, dst: &Path, stats: &mut RedactionStats) -> ShareResult<()> {
    let reader = BufReader::new(fs::File::open(src)?);
    let mut writer = BufWriter::new(fs::File::create(dst)?);
    for line in reader.lines() {
        let line = line?;
        let out = redact::redact_text(&line, stats);
        writer.write_all(out.as_bytes())?;
        writer.write_all(b"\n")?;
    }
    writer.flush()?;
    Ok(())
}

/// 小文本文件整体脱敏复制；二进制 / 超大文件原样复制并记录跳过。
fn redact_copy_whole(src: &Path, dst: &Path, stats: &mut RedactionStats) -> ShareResult<()> {
    const WHOLE_LIMIT: u64 = 32 * 1024 * 1024;
    let meta = fs::metadata(src)?;
    if meta.len() > WHOLE_LIMIT {
        fs::copy(src, dst)?;
        return Ok(());
    }
    let bytes = fs::read(src)?;
    match String::from_utf8(bytes) {
        Ok(text) => {
            let out = redact::redact_text(&text, stats);
            fs::write(dst, out)?;
        }
        Err(err) => {
            // 二进制附件原样保留。
            fs::write(dst, err.into_bytes())?;
        }
    }
    Ok(())
}

fn copy_dir_filtered(src: &Path, dst: &Path, stats: &mut RedactionStats, redact: bool) -> ShareResult<u64> {
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
            count += copy_dir_filtered(&path, &target, stats, redact)?;
        } else if redact {
            redact_copy_whole(&path, &target, stats)?;
            count += 1;
        } else {
            fs::copy(&path, &target)?;
            count += 1;
        }
    }
    Ok(count)
}

/// 导出 catalog 中属于该仓库的记录（按 canonical repoPath 匹配）。
fn export_catalog_records(repo: &Path, dst: &Path, stats: &mut RedactionStats, redact: bool) -> ShareResult<usize> {
    let Some(catalog_path) = crate::pi_agent::default_data_dir()
        .map(|root| root.join("pi-sessions").join("catalog.json"))
    else {
        return Ok(0);
    };
    let Ok(bytes) = fs::read(&catalog_path) else {
        return Ok(0);
    };
    let Ok(records) = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes) else {
        return Ok(0);
    };
    let canonical = canonical_string(repo);
    let matched: Vec<serde_json::Value> = records
        .into_iter()
        .filter(|record| {
            let raw = record
                .get("repoPath")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            !raw.is_empty() && canonical_string(Path::new(raw)) == canonical
        })
        .collect();
    if matched.is_empty() {
        return Ok(0);
    }
    let matched_total = matched.len();
    let mut text = serde_json::to_string_pretty(&matched)
        .map_err(|e| ShareError::Package(format!("catalog serialize: {e}")))?;
    if redact {
        text = redact::redact_text(&text, stats);
    }
    fs::write(dst, text)?;
    Ok(matched_total)
}

/// `VACUUM INTO` 取记忆库一致性快照，然后对文本列做脱敏。
fn export_memory_db(repo: &Path, dst: &Path, redact: bool, stats: &mut RedactionStats) -> ShareResult<bool> {
    let Some(src) = crate::pi_agent::memory_db_path_for_repo(repo) else {
        return Ok(false);
    };
    if !src.exists() {
        return Ok(false);
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    {
        let conn = rusqlite::Connection::open(&src)
            .map_err(|e| ShareError::Persistence(format!("open memory.db: {e}")))?;
        conn.execute("VACUUM INTO ?1", params![dst.to_string_lossy().as_ref()])
            .map_err(|e| ShareError::Persistence(format!("vacuum memory.db: {e}")))?;
    }
    if redact {
        redact_memory_db(dst, stats)?;
    }
    Ok(true)
}

fn redact_memory_db(path: &Path, stats: &mut RedactionStats) -> ShareResult<()> {
    let mut conn = rusqlite::Connection::open(path)
        .map_err(|e| ShareError::Persistence(format!("open memory snapshot: {e}")))?;
    let tx = conn
        .transaction()
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    redact_table_column(&tx, "nodes", "id", "props", stats)?;
    redact_table_column(&tx, "edges", "id", "props", stats)?;
    redact_table_column(&tx, "extraction_jobs", "turn_key", "input_json", stats)?;
    tx.commit()
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    Ok(())
}

fn redact_table_column(
    conn: &rusqlite::Connection,
    table: &str,
    key_col: &str,
    text_col: &str,
    stats: &mut RedactionStats,
) -> ShareResult<()> {
    // 表在旧版本快照里可能不存在，缺失即跳过。
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get(0),
        )
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    if !exists {
        return Ok(());
    }
    let query = format!("SELECT {key_col}, {text_col} FROM {table}");
    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    // key 可能是 TEXT（nodes.id / extraction_jobs.turn_key）或 INTEGER（edges.id）。
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, rusqlite::types::Value>(0)?,
                row.get::<_, String>(1)?,
            ))
        })
        .map_err(|e| ShareError::Persistence(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    drop(stmt);
    let update = format!("UPDATE {table} SET {text_col} = ?1 WHERE {key_col} = ?2");
    for (key, text) in rows {
        let mut local = RedactionStats::default();
        let redacted = redact::redact_text(&text, &mut local);
        if local.hits > 0 {
            conn.execute(&update, params![redacted, key])
                .map_err(|e| ShareError::Persistence(e.to_string()))?;
            stats.hits += local.hits;
        }
    }
    Ok(())
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedReviews {
    records: Vec<ExportedReviewRecord>,
    actions: Vec<ExportedReviewAction>,
}

fn client_db_path() -> Option<PathBuf> {
    crate::pi_agent::default_data_dir().map(|root| root.join("client.db"))
}

fn export_reviews(repo: &Path, dst: &Path) -> ShareResult<usize> {
    let Some(db_path) = client_db_path() else {
        return Ok(0);
    };
    if !db_path.exists() {
        return Ok(0);
    }
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| ShareError::Persistence(format!("open client.db: {e}")))?;
    let table_exists = |name: &str| -> bool {
        conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![name],
            |row| row.get(0),
        )
        .unwrap_or(false)
    };
    if !table_exists("review_records") {
        return Ok(0);
    }
    let canonical = canonical_string(repo);
    let raw = repo.to_string_lossy().to_string();

    let mut stmt = conn
        .prepare(
            "SELECT id, commit_sha, status, summary, findings_json, created_at, created_at_ms
             FROM review_records WHERE repo_path = ?1 OR repo_path = ?2",
        )
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    let records = stmt
        .query_map(params![canonical, raw], |row| {
            Ok(ExportedReviewRecord {
                id: row.get(0)?,
                commit_sha: row.get(1)?,
                status: row.get(2)?,
                summary: row.get(3)?,
                findings_json: row.get(4)?,
                created_at: row.get(5)?,
                created_at_ms: row.get(6)?,
            })
        })
        .map_err(|e| ShareError::Persistence(e.to_string()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| ShareError::Persistence(e.to_string()))?;
    drop(stmt);

    let mut actions = Vec::new();
    if table_exists("review_actions") {
        let mut stmt = conn
            .prepare(
                "SELECT id, review_id, finding_id, action, note, created_at, created_at_ms
                 FROM review_actions WHERE repo_path = ?1 OR repo_path = ?2",
            )
            .map_err(|e| ShareError::Persistence(e.to_string()))?;
        actions = stmt
            .query_map(params![canonical, raw], |row| {
                Ok(ExportedReviewAction {
                    id: row.get(0)?,
                    review_id: row.get(1)?,
                    finding_id: row.get(2)?,
                    action: row.get(3)?,
                    note: row.get(4)?,
                    created_at: row.get(5)?,
                    created_at_ms: row.get(6)?,
                })
            })
            .map_err(|e| ShareError::Persistence(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| ShareError::Persistence(e.to_string()))?;
    }

    if records.is_empty() && actions.is_empty() {
        return Ok(0);
    }
    let count = records.len();
    let payload = ExportedReviews { records, actions };
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| ShareError::Package(format!("reviews serialize: {e}")))?;
    fs::write(dst, text)?;
    Ok(count)
}

/// 导出产物：代码 `*.bundle` + 上下文 `*.tar.zst`（含 manifest）。
pub fn export_package(repo_path: &Path, opts: &ExportOptions) -> ShareResult<ExportOutcome> {
    let repo = fs::canonicalize(repo_path)
        .map_err(|e| ShareError::NotARepo(format!("{}: {e}", repo_path.display())))?;
    if run_git(&repo, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Err(ShareError::NotARepo(repo.display().to_string()));
    }

    let mut warnings = Vec::new();
    let head = run_git(&repo, &["rev-parse", "HEAD"])?;
    let branch = run_git(&repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_default();
    let upstream_url = run_git(&repo, &["config", "--get", "remote.origin.url"])
        .unwrap_or_default();
    let dirty = !run_git(&repo, &["status", "--porcelain"])
        .unwrap_or_default()
        .is_empty();
    if dirty {
        warnings.push("存在未提交变更，bundle 仅包含已提交历史".to_string());
    }
    let repo_name = repo
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo")
        .to_string();

    // 1) git bundle
    let staging = std::env::temp_dir().join(format!("giteam-share-{}-{}", std::process::id(), now_ms()));
    fs::create_dir_all(&staging)?;
    let bundle_path = staging.join("repo.bundle");
    let bundle_refs: Vec<String> = if opts.all_refs {
        vec!["--all".to_string()]
    } else {
        let mut refs = vec!["HEAD".to_string()];
        if !branch.is_empty() {
            refs.push(format!("refs/heads/{branch}"));
        }
        refs.push("--tags".to_string());
        refs
    };
    let bundle_file = bundle_path.to_string_lossy().to_string();
    let mut args: Vec<&str> = vec!["bundle", "create", &bundle_file];
    args.extend(bundle_refs.iter().map(String::as_str));
    run_git(&repo, &args)?;

    // 2) context pack
    let context_dir = staging.join("context");
    fs::create_dir_all(&context_dir)?;
    let mut stats = RedactionStats::default();
    let redact_on = !opts.no_redact;

    let mut session_files = Vec::new();
    let mut sessions_dir_hint = String::new();
    if let Some(sessions_dir) = crate::pi_agent::pi_sessions_dir_for_repo(&repo) {
        sessions_dir_hint = sessions_dir.to_string_lossy().to_string();
        let out_dir = context_dir.join("sessions");
        fs::create_dir_all(&out_dir)?;
        if sessions_dir.is_dir() {
            let mut entries: Vec<_> = fs::read_dir(&sessions_dir)?
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.is_file()
                        && p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.starts_with("session-") && n.ends_with(".jsonl"))
                            .unwrap_or(false)
                })
                .collect();
            entries.sort();
            for src in entries {
                let name = src.file_name().expect("file name checked");
                let dst = out_dir.join(name);
                if redact_on {
                    redact_copy_lines(&src, &dst, &mut stats)?;
                } else {
                    fs::copy(&src, &dst)?;
                }
                session_files.push(format!("context/sessions/{}", name.to_string_lossy()));
            }
        }
    }
    let session_count = session_files.len();

    let catalog_path = context_dir.join("catalog.json");
    let catalog_count = export_catalog_records(&repo, &catalog_path, &mut stats, redact_on)?;
    let has_catalog = catalog_count > 0;

    let memory_path = context_dir.join("memory.db");
    let has_memory_db = export_memory_db(&repo, &memory_path, redact_on, &mut stats)?;

    let attachments_src = repo.join(".giteam").join("prompt-attachments");
    let attachments_dst = context_dir.join("attachments");
    let attachment_count = copy_dir_filtered(&attachments_src, &attachments_dst, &mut stats, redact_on)?;
    let has_attachments = attachment_count > 0;

    let review_record_count = if opts.include_reviews {
        export_reviews(&repo, &context_dir.join("reviews.json"))?
    } else {
        0
    };

    // 3) manifest（写进上下文包根）
    let manifest = ShareManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        share_id: String::new(), // finalize 后由云端分配，导入端不校验该字段
        created_at: now_iso(),
        source: ShareSourceInfo {
            app: "giteam-cli".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
        },
        repo: ShareRepoInfo {
            name: repo_name,
            default_branch: if branch.is_empty() { "HEAD".to_string() } else { branch },
            head_commit: head,
            upstream_url,
            bundle_refs,
            origin_path_hint: canonical_string(&repo),
            dirty_worktree: dirty,
        },
        context: ShareContextInfo {
            session_count,
            session_files,
            sessions_dir_hint,
            has_catalog,
            has_memory_db,
            has_attachments,
            review_record_count,
            redactions: stats.hits,
        },
        package: SharePackageInfo {
            format: "git+context".to_string(),
            sha256: String::new(),
            size_bytes: 0,
            context_sha256: String::new(),
            context_size_bytes: 0,
            encrypted: false,
        },
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| ShareError::Package(format!("manifest serialize: {e}")))?;
    fs::write(staging.join("manifest.json"), manifest_bytes)?;

    // 4) 拆包：repo.bundle 独立；context/ + manifest → context.tar.zst
    let stamp = now_ms();
    let pid = std::process::id();
    let repo_out = std::env::temp_dir().join(format!("giteam-share-repo-{pid}-{stamp}.bundle"));
    fs::rename(&bundle_path, &repo_out)?;
    let repo_sha256 = pack::sha256_file(&repo_out)?;
    let repo_size = fs::metadata(&repo_out)?.len();

    let context_root = staging.join("_context_root");
    fs::create_dir_all(&context_root)?;
    fs::rename(staging.join("manifest.json"), context_root.join("manifest.json"))?;
    fs::rename(context_dir, context_root.join("context"))?;

    let context_out = opts.out_file.clone().unwrap_or_else(|| {
        std::env::temp_dir().join(format!("giteam-share-context-{pid}-{stamp}.tar.zst"))
    });
    pack::pack_dir(&context_root, &context_out)?;
    let context_sha256 = pack::sha256_file(&context_out)?;
    let context_size = fs::metadata(&context_out)?.len();
    let _ = fs::remove_dir_all(&staging);

    let manifest = ShareManifest {
        package: SharePackageInfo {
            format: "git+context".to_string(),
            sha256: repo_sha256,
            size_bytes: repo_size,
            context_sha256,
            context_size_bytes: context_size,
            encrypted: false,
        },
        ..manifest
    };
    if let Ok(bytes) = serde_json::to_vec_pretty(&manifest) {
        let _ = fs::write(context_out.with_extension("manifest.json"), bytes);
    }

    Ok(ExportOutcome {
        repo_bundle_path: repo_out,
        context_package_path: context_out,
        manifest,
        warnings,
    })
}

/// 完整分享闭环：导出 → 云端建档 → 分块上传代码+上下文 → finalize。
pub fn create_share(repo_path: &Path, opts: &ExportOptions) -> ShareResult<ShareCreated> {
    let settings = crate::cloud::get_cloud_link_settings();
    if settings.device_token.trim().is_empty() || settings.cloud_base_url.trim().is_empty() {
        return Err(ShareError::CloudLink(
            "尚未 link 云端，请先执行 `giteam cloud link`".into(),
        ));
    }
    let outcome = export_package(repo_path, opts)?;
    let meta = &outcome.manifest;
    let created = client::create_share_record(
        &settings.cloud_base_url,
        &settings.device_token,
        &client::CreateShareRequest {
            name: meta.repo.name.clone(),
            repo_name: meta.repo.name.clone(),
            default_branch: meta.repo.default_branch.clone(),
            head_commit: meta.repo.head_commit.clone(),
            size_bytes: meta.package.size_bytes,
            content_sha256: meta.package.sha256.clone(),
            context_sha256: meta.package.context_sha256.clone(),
            context_size_bytes: meta.package.context_size_bytes,
            encrypted: meta.package.encrypted,
            meta: serde_json::json!({
                "layout": "split-v1",
                "sessionCount": meta.context.session_count,
                "hasMemoryDb": meta.context.has_memory_db,
                "hasAttachments": meta.context.has_attachments,
                "reviewRecordCount": meta.context.review_record_count,
                "createdAt": meta.created_at,
                "sourceOs": meta.source.os,
                "dirtyWorktree": meta.repo.dirty_worktree,
                "repoSizeBytes": meta.package.size_bytes,
                "contextSizeBytes": meta.package.context_size_bytes,
            }),
        },
    )?;
    client::upload_share_parts(
        &settings.cloud_base_url,
        &settings.device_token,
        &created.share_id,
        &outcome.repo_bundle_path,
        UPLOAD_PART_SIZE,
        "repo",
    )?;
    client::upload_share_parts(
        &settings.cloud_base_url,
        &settings.device_token,
        &created.share_id,
        &outcome.context_package_path,
        UPLOAD_PART_SIZE,
        "context",
    )?;
    let finalized = client::finalize_share(
        &settings.cloud_base_url,
        &settings.device_token,
        &created.share_id,
    )?;
    let _ = fs::remove_file(&outcome.repo_bundle_path);
    let _ = fs::remove_file(&outcome.context_package_path);
    let _ = fs::remove_file(outcome.context_package_path.with_extension("manifest.json"));

    let mut manifest = outcome.manifest;
    manifest.share_id = created.share_id.clone();
    let git_url = if finalized.git_url.trim().is_empty() {
        format!(
            "{}/s/{}/repo.git",
            settings.cloud_base_url.trim_end_matches('/'),
            created.share_id
        )
    } else {
        finalized.git_url
    };
    Ok(ShareCreated {
        share_id: created.share_id,
        share_url: finalized.share_url,
        git_url,
        manifest,
        warnings: outcome.warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn redact_memory_db_handles_integer_edge_ids() {
        let dir = std::env::temp_dir().join(format!(
            "giteam-share-redact-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("memory.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE nodes (
                    id TEXT PRIMARY KEY,
                    props TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE edges (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    props TEXT NOT NULL DEFAULT '{}'
                );
                INSERT INTO nodes(id, props) VALUES ('n1', '{"token":"sk-abc1234567890xyz"}');
                INSERT INTO edges(props) VALUES ('{"token":"sk-edgekey123456789"}');
                "#,
            )
            .unwrap();
        }
        let mut stats = RedactionStats::default();
        redact_memory_db(&db_path, &mut stats).expect("redact should accept integer edge ids");
        assert!(stats.hits >= 2, "expected redaction hits, got {}", stats.hits);
        let conn = Connection::open(&db_path).unwrap();
        let edge_props: String = conn
            .query_row("SELECT props FROM edges WHERE id = 1", [], |row| row.get(0))
            .unwrap();
        assert!(!edge_props.contains("sk-edgekey"), "edge props should be redacted: {edge_props}");
        let _ = fs::remove_dir_all(&dir);
    }
}

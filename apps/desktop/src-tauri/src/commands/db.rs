use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

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

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let dir = app_data.join(".giteam");
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create .giteam directory: {e}"))?;
    let db = dir.join("client.db");

    if !db.exists() {
        if let Some(legacy) = legacy_db_path() {
            if legacy.exists() {
                fs::copy(&legacy, &db).map_err(|e| {
                    format!("cannot migrate legacy database from {:?}: {e}", legacy)
                })?;
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
    while let Some(row) = rows
        .next()
        .map_err(|e| format!("iterate pragma failed: {e}"))?
    {
        let name: String = row
            .get(1)
            .map_err(|e| format!("read pragma row failed: {e}"))?;
        if name == col {
            return Ok(true);
        }
    }
    Ok(false)
}

fn open_db(app_handle: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app_handle)?;
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
        conn.execute_batch(
            "ALTER TABLE review_records ADD COLUMN repo_path TEXT NOT NULL DEFAULT '';",
        )
        .map_err(|e| format!("add repo_path column failed: {e}"))?;
    }
    Ok(conn)
}

#[tauri::command]
pub fn db_save_review_record(app_handle: AppHandle, record: ReviewRecord) -> Result<(), String> {
    let conn = open_db(&app_handle)?;
    let findings_json = serde_json::to_string(&record.findings)
        .map_err(|e| format!("serialize findings failed: {e}"))?;

    conn.execute(
        "INSERT OR REPLACE INTO review_records
        (id, repo_path, commit_sha, status, summary, findings_json, created_at, created_at_ms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.id,
            record.repo_path,
            record.commit_sha,
            record.status,
            record.summary,
            findings_json,
            record.created_at,
            now_millis()
        ],
    )
    .map_err(|e| format!("insert review record failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn db_list_review_records(
    app_handle: AppHandle,
    repo_path: &str,
    limit: Option<i64>,
) -> Result<Vec<ReviewRecord>, String> {
    let conn = open_db(&app_handle)?;
    let safe_limit = limit.unwrap_or(100).clamp(1, 1000);
    let mut stmt = conn
        .prepare(
            "SELECT id, repo_path, commit_sha, status, summary, findings_json, created_at
             FROM review_records
             WHERE repo_path = ?1
             ORDER BY created_at_ms DESC
             LIMIT ?2",
        )
        .map_err(|e| format!("prepare list query failed: {e}"))?;

    let rows = stmt
        .query_map(params![repo_path, safe_limit], |row| {
            let findings_json: String = row.get(5)?;
            let findings: Vec<ReviewFinding> =
                serde_json::from_str(&findings_json).unwrap_or_else(|_| Vec::new());
            Ok(ReviewRecord {
                id: row.get(0)?,
                repo_path: row.get(1)?,
                commit_sha: row.get(2)?,
                status: row.get(3)?,
                summary: row.get(4)?,
                findings,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("query list failed: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let item = row.map_err(|e| format!("decode row failed: {e}"))?;
        out.push(item);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_add_repository(app_handle: AppHandle, path: &str) -> Result<RepositoryEntry, String> {
    if path.trim().is_empty() {
        return Err("repository path is empty".to_string());
    }
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(format!("repository directory does not exist: {path}"));
    }
    if !p.join(".git").exists() {
        return Err(format!("not a git repository: {path}"));
    }

    let canonical =
        fs::canonicalize(p).map_err(|e| format!("failed to resolve repository path: {e}"))?;
    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| "repository path is not valid utf-8".to_string())?
        .to_string();
    let name = canonical
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo")
        .to_string();
    let id = format!("repo-{}", now_millis());
    let added_at = chrono_like_now();

    let conn = open_db(&app_handle)?;
    conn.execute(
        "INSERT OR IGNORE INTO repositories (id, path, name, added_at, added_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, canonical_str, name, added_at, now_millis()],
    )
    .map_err(|e| format!("insert repository failed: {e}"))?;

    let mut stmt = conn
        .prepare("SELECT id, path, name, added_at FROM repositories WHERE path = ?1 LIMIT 1")
        .map_err(|e| format!("prepare select repository failed: {e}"))?;
    let row = stmt
        .query_row(params![canonical_str], |r| {
            Ok(RepositoryEntry {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                added_at: r.get(3)?,
            })
        })
        .map_err(|e| format!("fetch inserted repository failed: {e}"))?;
    Ok(row)
}

#[tauri::command]
pub fn db_list_repositories(app_handle: AppHandle) -> Result<Vec<RepositoryEntry>, String> {
    let conn = open_db(&app_handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, name, added_at
             FROM repositories
             ORDER BY added_at_ms DESC",
        )
        .map_err(|e| format!("prepare list repositories failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RepositoryEntry {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                added_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("query list repositories failed: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("decode repository row failed: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_remove_repository(app_handle: AppHandle, id: &str) -> Result<(), String> {
    let conn = open_db(&app_handle)?;
    conn.execute("DELETE FROM repositories WHERE id = ?1", params![id])
        .map_err(|e| format!("delete repository failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn pick_repository_folder() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("Select Git Repository Folder")
        .pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

fn chrono_like_now() -> String {
    // Keep dependency surface small by using a plain timestamp string.
    // This format is enough for display and ordering is handled by millis column.
    format!("{}", now_millis())
}

#[tauri::command]
pub fn db_save_review_action(app_handle: AppHandle, action: ReviewAction) -> Result<(), String> {
    let conn = open_db(&app_handle)?;
    conn.execute(
        "INSERT OR REPLACE INTO review_actions
        (id, repo_path, review_id, finding_id, action, note, created_at, created_at_ms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            action.id,
            action.repo_path,
            action.review_id,
            action.finding_id,
            action.action,
            action.note,
            action.created_at,
            now_millis()
        ],
    )
    .map_err(|e| format!("insert review action failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn db_list_review_actions(
    app_handle: AppHandle,
    repo_path: &str,
    review_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ReviewAction>, String> {
    let conn = open_db(&app_handle)?;
    let safe_limit = limit.unwrap_or(300).clamp(1, 2000);
    let (sql, bind_review) = if review_id.is_some() {
        (
            "SELECT id, repo_path, review_id, finding_id, action, note, created_at
            FROM review_actions
            WHERE repo_path = ?1 AND review_id = ?2
            ORDER BY created_at_ms DESC
            LIMIT ?3",
            true,
        )
    } else {
        (
            "SELECT id, repo_path, review_id, finding_id, action, note, created_at
            FROM review_actions
            WHERE repo_path = ?1
            ORDER BY created_at_ms DESC
            LIMIT ?2",
            false,
        )
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("prepare action list query failed: {e}"))?;

    let mut out = Vec::new();

    if bind_review {
        let rid = review_id.unwrap_or_default();
        let mut rows = stmt
            .query(params![repo_path, rid, safe_limit])
            .map_err(|e| format!("query action list failed: {e}"))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| format!("iterate action rows failed: {e}"))?
        {
            out.push(ReviewAction {
                id: row
                    .get(0)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                repo_path: row
                    .get(1)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                review_id: row
                    .get(2)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                finding_id: row
                    .get(3)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                action: row
                    .get(4)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                note: row
                    .get(5)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                created_at: row
                    .get(6)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
            });
        }
    } else {
        let mut rows = stmt
            .query(params![repo_path, safe_limit])
            .map_err(|e| format!("query action list failed: {e}"))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| format!("iterate action rows failed: {e}"))?
        {
            out.push(ReviewAction {
                id: row
                    .get(0)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                repo_path: row
                    .get(1)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                review_id: row
                    .get(2)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                finding_id: row
                    .get(3)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                action: row
                    .get(4)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                note: row
                    .get(5)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
                created_at: row
                    .get(6)
                    .map_err(|e| format!("decode action row failed: {e}"))?,
            });
        }
    }
    Ok(out)
}

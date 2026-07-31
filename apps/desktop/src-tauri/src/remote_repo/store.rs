use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::models::RemoteRepoConfig;

#[derive(Debug, Clone)]
pub struct RemoteRepoUiState {
    pub pinned: bool,
    pub sort_order: i64,
    pub last_accessed_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct RemoteRepoServiceStoredSetting {
    pub service_url: String,
    pub api_key: String,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn service_settings_columns(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(remote_repo_service_settings)")
        .map_err(|e| format!("prepare remote repo service settings schema check failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("query remote repo service settings schema failed: {e}"))?;
    let mut columns = Vec::new();
    for row in rows {
        columns.push(row.map_err(|e| format!("decode remote repo service settings schema failed: {e}"))?);
    }
    Ok(columns)
}

fn create_service_settings_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS remote_repo_service_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            service_url TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            updated_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("create remote repo service settings table failed: {e}"))
}

fn migrate_service_settings_schema(conn: &Connection) -> Result<(), String> {
    let columns = service_settings_columns(conn)?;
    if columns.iter().any(|column| column == "id") {
        if !columns.iter().any(|column| column == "api_key") {
            conn.execute_batch("ALTER TABLE remote_repo_service_settings ADD COLUMN api_key TEXT NOT NULL DEFAULT '';")
                .map_err(|e| format!("add remote repo service api key column failed: {e}"))?;
        }
        return Ok(());
    }
    if columns.is_empty() {
        return create_service_settings_table(conn);
    }

    let preserved_url = if columns.iter().any(|column| column == "service_url") {
        conn.query_row(
            "SELECT service_url FROM remote_repo_service_settings LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("read legacy remote repo service url failed: {e}"))?
        .unwrap_or_default()
    } else {
        String::new()
    };
    let preserved_api_key = if columns.iter().any(|column| column == "api_key") {
        conn.query_row(
            "SELECT api_key FROM remote_repo_service_settings LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("read legacy remote repo service api key failed: {e}"))?
        .unwrap_or_default()
    } else {
        String::new()
    };

    conn.execute_batch(
        "ALTER TABLE remote_repo_service_settings RENAME TO remote_repo_service_settings_legacy;
         CREATE TABLE remote_repo_service_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            service_url TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            updated_at_ms INTEGER NOT NULL
         );",
    )
    .map_err(|e| format!("rebuild remote repo service settings table failed: {e}"))?;

    if !preserved_url.trim().is_empty() || !preserved_api_key.trim().is_empty() {
        conn.execute(
            "INSERT INTO remote_repo_service_settings (id, service_url, api_key, updated_at_ms)
             VALUES (1, ?1, ?2, ?3)",
            params![preserved_url.trim(), preserved_api_key.trim(), now_millis()],
        )
        .map_err(|e| format!("preserve remote repo service url failed: {e}"))?;
    }

    conn.execute_batch("DROP TABLE IF EXISTS remote_repo_service_settings_legacy;")
        .map_err(|e| format!("drop legacy remote repo service settings table failed: {e}"))?;
    Ok(())
}

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let _ = app_handle;
    giteam_core::pi_agent::migrate_legacy_tauri_data_into_canonical();
    let dir = giteam_core::pi_agent::ensure_data_dir()
        .ok_or_else(|| "cannot resolve Giteam data dir".to_string())?;
    Ok(dir.join("client.db"))
}

fn open_db(app_handle: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app_handle)?;
    let conn = Connection::open(path).map_err(|e| format!("open sqlite failed: {e}"))?;
    conn.execute_batch(
        // TODO(security): api_key is stored in plaintext for the Phase 1 prototype.
        // Production must use OS keychain / secure storage (e.g. keyring crate or Tauri Stronghold).
        "CREATE TABLE IF NOT EXISTS remote_repo_configs (
            repo_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            service_url TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            default_ref TEXT NOT NULL DEFAULT 'main',
            session_id TEXT,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS remote_repo_service_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            service_url TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS remote_repo_ui_state (
            repo_id TEXT PRIMARY KEY,
            pinned INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            last_accessed_at_ms INTEGER NOT NULL DEFAULT 0,
            updated_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("migrate remote_repo_configs failed: {e}"))?;
    migrate_service_settings_schema(&conn)?;
    Ok(conn)
}

pub fn get_service_url(app_handle: &AppHandle) -> Result<Option<String>, String> {
    Ok(get_service_setting(app_handle)?.map(|setting| setting.service_url))
}

pub fn get_service_api_key(app_handle: &AppHandle) -> Result<Option<String>, String> {
    Ok(get_service_setting(app_handle)?.map(|setting| setting.api_key))
}

pub fn get_service_setting(app_handle: &AppHandle) -> Result<Option<RemoteRepoServiceStoredSetting>, String> {
    let conn = open_db(app_handle)?;
    let mut stmt = conn
        .prepare("SELECT service_url, api_key FROM remote_repo_service_settings WHERE id = 1 LIMIT 1")
        .map_err(|e| format!("prepare get remote repo service url failed: {e}"))?;
    let mut rows = stmt
        .query_map([], |row| {
            Ok(RemoteRepoServiceStoredSetting {
                service_url: row.get(0)?,
                api_key: row.get(1)?,
            })
        })
        .map_err(|e| format!("query remote repo service url failed: {e}"))?;
    rows.next()
        .transpose()
        .map_err(|e| format!("decode remote repo service url failed: {e}"))
}

pub fn set_service_url(app_handle: &AppHandle, service_url: &str) -> Result<(), String> {
    let api_key = get_service_api_key(app_handle)?.unwrap_or_default();
    set_service_setting(app_handle, service_url, &api_key)
}

pub fn set_service_setting(app_handle: &AppHandle, service_url: &str, api_key: &str) -> Result<(), String> {
    let conn = open_db(app_handle)?;
    if service_url.trim().is_empty() && api_key.trim().is_empty() {
        conn.execute("DELETE FROM remote_repo_service_settings WHERE id = 1", [])
            .map_err(|e| format!("clear remote repo service url failed: {e}"))?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO remote_repo_service_settings (id, service_url, api_key, updated_at_ms)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
            service_url = excluded.service_url,
            api_key = excluded.api_key,
            updated_at_ms = excluded.updated_at_ms",
        params![service_url.trim(), api_key.trim(), now_millis()],
    )
    .map_err(|e| format!("save remote repo service url failed: {e}"))?;
    Ok(())
}

pub fn get_ui_state(app_handle: &AppHandle, repo_id: &str) -> Result<RemoteRepoUiState, String> {
    let conn = open_db(app_handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT pinned, sort_order, last_accessed_at_ms
             FROM remote_repo_ui_state
             WHERE repo_id = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("prepare get remote repo UI state failed: {e}"))?;
    let mut rows = stmt
        .query_map(params![repo_id], |row| {
            Ok(RemoteRepoUiState {
                pinned: row.get::<_, i64>(0)? != 0,
                sort_order: row.get(1)?,
                last_accessed_at_ms: row.get(2)?,
            })
        })
        .map_err(|e| format!("query remote repo UI state failed: {e}"))?;
    Ok(rows
        .next()
        .transpose()
        .map_err(|e| format!("decode remote repo UI state failed: {e}"))?
        .unwrap_or(RemoteRepoUiState {
            pinned: false,
            sort_order: 0,
            last_accessed_at_ms: 0,
        }))
}

pub fn set_pinned(app_handle: &AppHandle, repo_id: &str, pinned: bool) -> Result<(), String> {
    let current = get_ui_state(app_handle, repo_id)?;
    let conn = open_db(app_handle)?;
    conn.execute(
        "INSERT INTO remote_repo_ui_state
            (repo_id, pinned, sort_order, last_accessed_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(repo_id) DO UPDATE SET
            pinned = excluded.pinned,
            sort_order = excluded.sort_order,
            last_accessed_at_ms = excluded.last_accessed_at_ms,
            updated_at_ms = excluded.updated_at_ms",
        params![
            repo_id,
            if pinned { 1 } else { 0 },
            current.sort_order,
            current.last_accessed_at_ms,
            now_millis()
        ],
    )
    .map_err(|e| format!("save remote repo pinned state failed: {e}"))?;
    Ok(())
}

pub fn touch_accessed(app_handle: &AppHandle, repo_id: &str) -> Result<(), String> {
    let current = get_ui_state(app_handle, repo_id)?;
    let now = now_millis();
    let conn = open_db(app_handle)?;
    conn.execute(
        "INSERT INTO remote_repo_ui_state
            (repo_id, pinned, sort_order, last_accessed_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(repo_id) DO UPDATE SET
            pinned = excluded.pinned,
            sort_order = excluded.sort_order,
            last_accessed_at_ms = excluded.last_accessed_at_ms,
            updated_at_ms = excluded.updated_at_ms",
        params![
            repo_id,
            if current.pinned { 1 } else { 0 },
            current.sort_order,
            now
        ],
    )
    .map_err(|e| format!("touch remote repo access state failed: {e}"))?;
    Ok(())
}

pub fn save_config(app_handle: &AppHandle, config: &RemoteRepoConfig) -> Result<(), String> {
    let conn = open_db(app_handle)?;
    conn.execute(
        "INSERT OR REPLACE INTO remote_repo_configs
        (repo_id, name, service_url, api_key, default_ref, session_id, updated_at_ms)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            config.repo_id,
            config.name,
            config.service_url,
            config.api_key,
            config.default_ref,
            config.session_id,
            now_millis()
        ],
    )
    .map_err(|e| format!("insert remote repo config failed: {e}"))?;
    Ok(())
}

pub fn list_configs(app_handle: &AppHandle) -> Result<Vec<RemoteRepoConfig>, String> {
    let conn = open_db(app_handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT repo_id, name, service_url, api_key, default_ref, session_id
             FROM remote_repo_configs
             ORDER BY updated_at_ms DESC",
        )
        .map_err(|e| format!("prepare list configs failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RemoteRepoConfig {
                repo_id: row.get(0)?,
                name: row.get(1)?,
                service_url: row.get(2)?,
                api_key: row.get(3)?,
                default_ref: row.get(4)?,
                session_id: row.get(5)?,
            })
        })
        .map_err(|e| format!("query configs failed: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("decode config row failed: {e}"))?);
    }
    Ok(out)
}

pub fn get_config(app_handle: &AppHandle, repo_id: &str) -> Result<Option<RemoteRepoConfig>, String> {
    let conn = open_db(app_handle)?;
    let mut stmt = conn
        .prepare(
            "SELECT repo_id, name, service_url, api_key, default_ref, session_id
             FROM remote_repo_configs
             WHERE repo_id = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("prepare get config failed: {e}"))?;
    let mut rows = stmt
        .query_map(params![repo_id], |row| {
            Ok(RemoteRepoConfig {
                repo_id: row.get(0)?,
                name: row.get(1)?,
                service_url: row.get(2)?,
                api_key: row.get(3)?,
                default_ref: row.get(4)?,
                session_id: row.get(5)?,
            })
        })
        .map_err(|e| format!("query config failed: {e}"))?;
    rows.next()
        .transpose()
        .map_err(|e| format!("decode config row failed: {e}"))
}

pub fn set_session_id(
    app_handle: &AppHandle,
    repo_id: &str,
    session_id: Option<&str>,
) -> Result<(), String> {
    let conn = open_db(app_handle)?;
    conn.execute(
        "UPDATE remote_repo_configs SET session_id = ?1, updated_at_ms = ?2 WHERE repo_id = ?3",
        params![session_id, now_millis(), repo_id],
    )
    .map_err(|e| format!("update session_id failed: {e}"))?;
    Ok(())
}

pub fn seed_default_config(app_handle: &AppHandle) -> Result<(), String> {
    let default = RemoteRepoConfig {
        repo_id: "remote-repo-skill-brainstorm_2_giteam".to_string(),
        name: "remote-repo-skill-brainstorm_2_giteam".to_string(),
        service_url: std::env::var("REMOTE_REPO_SERVICE_URL")
            .unwrap_or_else(|_| "http://localhost:8000".to_string()),
        api_key: std::env::var("REMOTE_REPO_API_KEY").unwrap_or_default(),
        default_ref: "main".to_string(),
        session_id: None,
    };
    if get_config(app_handle, &default.repo_id)?.is_none() {
        save_config(app_handle, &default)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_singleton_service_settings_without_losing_url() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE remote_repo_service_settings (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                service_url TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            INSERT INTO remote_repo_service_settings (singleton, service_url, updated_at_ms)
            VALUES (1, 'http://127.0.0.1:8765', 123);",
        )
        .unwrap();

        migrate_service_settings_schema(&conn).unwrap();

        let columns = service_settings_columns(&conn).unwrap();
        assert!(columns.iter().any(|column| column == "id"));
        assert!(columns.iter().any(|column| column == "api_key"));
        assert!(!columns.iter().any(|column| column == "singleton"));

        let (value, api_key): (String, String) = conn
            .query_row(
                "SELECT service_url, api_key FROM remote_repo_service_settings WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(value, "http://127.0.0.1:8765");
        assert_eq!(api_key, "");
    }

    #[test]
    fn creates_service_settings_table_when_missing() {
        let conn = Connection::open_in_memory().unwrap();

        migrate_service_settings_schema(&conn).unwrap();

        let columns = service_settings_columns(&conn).unwrap();
        assert!(columns.iter().any(|column| column == "id"));
        assert!(columns.iter().any(|column| column == "service_url"));
        assert!(columns.iter().any(|column| column == "api_key"));
    }

    #[test]
    fn adds_api_key_column_to_current_service_settings_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE remote_repo_service_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                service_url TEXT NOT NULL DEFAULT '',
                updated_at_ms INTEGER NOT NULL
            );
            INSERT INTO remote_repo_service_settings (id, service_url, updated_at_ms)
            VALUES (1, 'http://127.0.0.1:8765', 123);",
        )
        .unwrap();

        migrate_service_settings_schema(&conn).unwrap();

        let api_key: String = conn
            .query_row(
                "SELECT api_key FROM remote_repo_service_settings WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(api_key, "");
    }
}

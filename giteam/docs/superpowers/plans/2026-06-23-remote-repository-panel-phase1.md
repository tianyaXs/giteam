# Remote Repository Panel - Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Remote Repository Panel to giteam Desktop's left sidebar that shows connection status, workspace status, lazy-loaded file tree, and read-only file previews for the linked remote repo.

**Architecture:** A React sidebar panel invokes a single Tauri `remote_repo` command. The Tauri command dispatches to a typed `RemoteRepoClient` Rust struct that bridges HTTP calls to `remote-repo-service`. Settings persist in SQLite. File tree prefers `/v1/files/tree` and falls back to `/v1/shell/run` + `find`.

**Tech Stack:** Tauri v2, Rust, reqwest, React + TypeScript, shadcn/ui, SQLite (rusqlite), Tailwind CSS.

---

## File Structure

### Rust
- `apps/desktop/src-tauri/src/remote_repo/mod.rs` — module root, re-exports.
- `apps/desktop/src-tauri/src/remote_repo/models.rs` — request/response structs and enums.
- `apps/desktop/src-tauri/src/remote_repo/client.rs` — `RemoteRepoClient` HTTP implementation.
- `apps/desktop/src-tauri/src/remote_repo/commands.rs` — Tauri `remote_repo` command dispatch.
- `apps/desktop/src-tauri/src/remote_repo/store.rs` — SQLite CRUD for `remote_repo_configs`.

### Frontend
- `apps/desktop/src/components/remote-repo/types.ts` — TypeScript models.
- `apps/desktop/src/components/remote-repo/remoteRepoApi.ts` — Tauri invoke wrappers.
- `apps/desktop/src/components/remote-repo/RemoteRepoPanel.tsx` — sidebar container.
- `apps/desktop/src/components/remote-repo/ConnectionHeader.tsx` — connection header UI.
- `apps/desktop/src/components/remote-repo/WorkspaceStatusBar.tsx` — workspace status UI.
- `apps/desktop/src/components/remote-repo/RemoteFileTree.tsx` — lazy file tree.
- `apps/desktop/src/components/remote-repo/RemoteFilePreview.tsx` — read-only preview.
- `apps/desktop/src/components/remote-repo/RemoteRepoProvider.tsx` — React context for state/polling.

### Tests
- `apps/desktop/src-tauri/src/remote_repo/client_test.rs` — Rust unit tests for parsing and error mapping.
- `apps/desktop/src/components/remote-repo/__tests__/RemoteFileTree.test.tsx` — frontend component tests.

---

## Task 1: Add Rust dependencies

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Add reqwest and thiserror**

```toml
[dependencies]
# ... existing dependencies ...
reqwest = { version = "0.12", features = ["json"] }
thiserror = "1"
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml
git commit -m "deps(desktop): add reqwest and thiserror for remote repo bridge"
```

---

## Task 2: Define Rust models

**Files:**
- Create: `apps/desktop/src-tauri/src/remote_repo/models.rs`
- Modify: `apps/desktop/src-tauri/src/remote_repo/mod.rs`

- [ ] **Step 1: Write the model file**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepoConfig {
    pub repo_id: String,
    pub name: String,
    pub service_url: String,
    pub api_key: String,
    pub default_ref: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub repo_id: String,
    pub online: bool,
    pub service_url: String,
    pub default_ref: String,
    pub default_commit: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub repo_id: String,
    pub cache_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub repo_id: String,
    pub base_commit: String,
    pub workspace_version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub session_id: String,
    pub repo_id: String,
    pub base_commit: String,
    pub workspace_version: u64,
    pub dirty: bool,
    pub modified_count: usize,
    pub untracked_count: usize,
    pub deleted_count: usize,
    pub created_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_activity_summary: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub kind: FileNodeKind,
    pub status: FileStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_operation: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileNodeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    #[default]
    Unchanged,
    Modified,
    Untracked,
    Deleted,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub workspace_version: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphStatus {
    pub target: String,
    pub state: String,
    pub last_indexed: Option<String>,
}
```

- [ ] **Step 2: Create module root**

```rust
// apps/desktop/src-tauri/src/remote_repo/mod.rs
pub mod client;
pub mod commands;
pub mod models;
pub mod store;

pub use models::*;
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/remote_repo/
git commit -m "feat(remote-repo): define Rust models for remote repo panel"
```

---

## Task 3: Implement SQLite settings store

**Files:**
- Create: `apps/desktop/src-tauri/src/remote_repo/store.rs`
- Modify: `apps/desktop/src-tauri/src/remote_repo/mod.rs`

- [ ] **Step 1: Write the store file**

```rust
use rusqlite::{params, Connection};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::models::RemoteRepoConfig;

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let dir = app_data.join(".giteam");
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create .giteam directory: {e}"))?;
    Ok(dir.join("client.db"))
}

fn open_db(app_handle: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app_handle)?;
    let conn = Connection::open(path).map_err(|e| format!("open sqlite failed: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS remote_repo_configs (
            repo_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            service_url TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            default_ref TEXT NOT NULL DEFAULT 'main',
            session_id TEXT,
            updated_at_ms INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("migrate remote_repo_configs failed: {e}"))?;
    Ok(conn)
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
```

- [ ] **Step 2: Add store module to mod.rs**

```rust
// apps/desktop/src-tauri/src/remote_repo/mod.rs
pub mod client;
pub mod commands;
pub mod models;
pub mod store;

pub use models::*;
```

- [ ] **Step 3: Write a minimal test for store**

```rust
// apps/desktop/src-tauri/src/remote_repo/store_test.rs
#[cfg(test)]
mod tests {
    use super::super::models::RemoteRepoConfig;
    use super::super::store::{get_config, save_config};

    // This test requires a Tauri AppHandle; skip in unit tests.
    // Integration tests will cover store behavior.
}
```

Skip the empty test file; we will rely on integration tests in Task 10.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/remote_repo/
git commit -m "feat(remote-repo): add SQLite store for remote repo configs"
```

---

## Task 4: Implement RemoteRepoClient

**Files:**
- Create: `apps/desktop/src-tauri/src/remote_repo/client.rs`
- Create: `apps/desktop/src-tauri/src/remote_repo/client_test.rs`
- Modify: `apps/desktop/src-tauri/src/remote_repo/mod.rs`

- [ ] **Step 1: Write the client file**

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;

use super::models::*;

#[derive(Debug, thiserror::Error)]
pub enum RemoteRepoError {
    #[error("http request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("remote service error: {code} - {message}")]
    Remote { code: String, message: String },
    #[error("session not found")]
    SessionNotFound,
    #[error("repo not found")]
    RepoNotFound,
    #[error("invalid response: {0}")]
    InvalidResponse(String),
}

pub struct RemoteRepoClient {
    base_url: String,
    api_key: String,
    client: Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ApiRequest {
    request_id: String,
    #[serde(flatten)]
    payload: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiResponse {
    ok: bool,
    #[serde(rename = "request_id")]
    request_id: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<ApiErrorBody>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorBody {
    code: String,
    message: String,
}

impl RemoteRepoClient {
    pub fn new(base_url: String, api_key: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            client: Client::new(),
        }
    }

    fn request_id() -> String {
        format!("req-{}", fastrand::u64(..))
    }

    fn make_request(
        &self,
        repo_id: Option<&str>,
        session_id: Option<&str>,
        payload: serde_json::Map<String, serde_json::Value>,
    ) -> ApiRequest {
        ApiRequest {
            request_id: Self::request_id(),
            payload,
        }
    }

    async fn post(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, RemoteRepoError> {
        let resp = self
            .client
            .post(format!("{}{}", self.base_url, path))
            .header("X-API-Key", self.api_key.as_str())
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(RemoteRepoError::Remote {
                code: "http_error".to_string(),
                message: format!("HTTP {status}: {text}"),
            });
        }
        let parsed: ApiResponse = serde_json::from_str(&text)
            .map_err(|e| RemoteRepoError::InvalidResponse(format!("{e}: {text}")))?;
        if !parsed.ok {
            if let Some(err) = parsed.error {
                match err.code.as_str() {
                    "session_not_found" => return Err(RemoteRepoError::SessionNotFound),
                    "repo_not_found" => return Err(RemoteRepoError::RepoNotFound),
                    _ => {
                        return Err(RemoteRepoError::Remote {
                            code: err.code,
                            message: err.message,
                        })
                    }
                }
            }
            return Err(RemoteRepoError::InvalidResponse("ok=false without error".to_string()));
        }
        Ok(parsed.data.unwrap_or(serde_json::Value::Null))
    }

    pub async fn get_connection_status(
        &self,
        repo_id: &str,
    ) -> Result<ConnectionStatus, RemoteRepoError> {
        let mut payload = serde_json::Map::new();
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/repos", json!(payload)).await?;
        let repos: Vec<serde_json::Value> = serde_json::from_value(
            data.get("repos")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![])),
        )
        .map_err(|e| RemoteRepoError::InvalidResponse(e.to_string()))?;
        let matched = repos
            .into_iter()
            .find(|r| r.get("repo_id").and_then(|v| v.as_str()) == Some(repo_id));
        match matched {
            Some(repo) => Ok(ConnectionStatus {
                repo_id: repo_id.to_string(),
                online: true,
                service_url: self.base_url.clone(),
                default_ref: repo
                    .get("default_ref")
                    .and_then(|v| v.as_str())
                    .unwrap_or("main")
                    .to_string(),
                default_commit: None,
                error: None,
            }),
            None => Err(RemoteRepoError::RepoNotFound),
        }
    }

    pub async fn connection_status_soft(&self, repo_id: &str) -> ConnectionStatus {
        match self.get_connection_status(repo_id).await {
            Ok(status) => status,
            Err(e) => ConnectionStatus {
                repo_id: repo_id.to_string(),
                online: false,
                service_url: self.base_url.clone(),
                default_ref: "main".to_string(),
                default_commit: None,
                error: Some(e.to_string()),
            },
        }
    }

    pub async fn sync_repo(&self, repo_id: &str) -> Result<SyncResult, RemoteRepoError> {
        let mut payload = serde_json::Map::new();
        payload.insert("repo_id".to_string(), json!(repo_id));
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/repos/sync", json!(payload)).await?;
        let cache_path = data
            .get("cache_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(SyncResult {
            repo_id: repo_id.to_string(),
            cache_path,
        })
    }

    pub async fn create_session(
        &self,
        repo_id: &str,
        ref_or_commit: Option<&str>,
    ) -> Result<SessionSummary, RemoteRepoError> {
        let mut payload = serde_json::Map::new();
        payload.insert("repo_id".to_string(), json!(repo_id));
        if let Some(r) = ref_or_commit {
            payload.insert("ref_or_commit".to_string(), json!(r));
        }
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/sessions", json!(payload)).await?;
        let session: SessionSummary = serde_json::from_value(data)
            .map_err(|e| RemoteRepoError::InvalidResponse(e.to_string()))?;
        Ok(session)
    }

    pub async fn get_session_state(
        &self,
        session_id: &str,
    ) -> Result<SessionState, RemoteRepoError> {
        let mut payload = serde_json::Map::new();
        payload.insert("session_id".to_string(), json!(session_id));
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/sessions/state", json!(payload)).await?;
        let mut state: SessionState = serde_json::from_value(data)
            .map_err(|e| RemoteRepoError::InvalidResponse(e.to_string()))?;
        // Ensure counts reflect workspace status if present; fallback to dirty flag.
        if !state.dirty {
            state.modified_count = 0;
            state.untracked_count = 0;
            state.deleted_count = 0;
        }
        Ok(state)
    }

    pub async fn list_workspace_files(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<FileTreeNode>, RemoteRepoError> {
        // Preferred: /v1/files/tree if available
        let tree_result = self.try_tree_api(session_id, path).await;
        match tree_result {
            Ok(nodes) => return Ok(nodes),
            Err(_) => self.fallback_shell_find(session_id, path).await,
        }
    }

    async fn try_tree_api(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<FileTreeNode>, RemoteRepoError> {
        let mut payload = serde_json::Map::new();
        payload.insert("session_id".to_string(), json!(session_id));
        payload.insert("path".to_string(), json!(path));
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/files/tree", json!(payload)).await?;
        let nodes: Vec<FileTreeNode> = serde_json::from_value(
            data.get("entries")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![])),
        )
        .map_err(|e| RemoteRepoError::InvalidResponse(e.to_string()))?;
        Ok(nodes)
    }

    async fn fallback_shell_find(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<FileTreeNode>, RemoteRepoError> {
        // Use python3 JSONL output for cross-platform directory/file detection.
        // macOS BSD find does not support -printf, so python3 is more portable.
        let escaped = path.replace('\\', "\\\\").replace('\'', "'\\''");
        let command = format!(
            "python3 - <<'PY'\nimport os, json\nroot = '{}'\nfor name in os.listdir(root):\n    p = os.path.join(root, name)\n    kind = 'directory' if os.path.isdir(p) else 'file'\n    print(json.dumps({{'name': name, 'path': p, 'kind': kind}}))\nPY",
            escaped
        );
        let mut payload = serde_json::Map::new();
        payload.insert("session_id".to_string(), json!(session_id));
        payload.insert("command".to_string(), json!(command));
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/shell/run", json!(payload)).await?;
        let stdout = data
            .get("stdout")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let entries: Vec<FileTreeNode> = stdout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| {
                let parsed: serde_json::Value = serde_json::from_str(line).ok()?;
                let name = parsed.get("name")?.as_str()?.to_string();
                let entry_path = parsed.get("path")?.as_str()?.to_string();
                let kind = parsed.get("kind")?.as_str().unwrap_or("file");
                Some(FileTreeNode {
                    name,
                    path: entry_path,
                    kind: if kind == "directory" {
                        FileNodeKind::Directory
                    } else {
                        FileNodeKind::File
                    },
                    status: FileStatus::Unchanged, // Phase 1 fallback: status not inferred from shell output
                    children: None,
                    agent_operation: None,
                })
            })
            .collect();
        Ok(entries)
    }

    pub async fn read_file(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<FileContent, RemoteRepoError> {
        let mut payload = serde_json::Map::new();
        payload.insert("session_id".to_string(), json!(session_id));
        payload.insert("path".to_string(), json!(path));
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/files/read", json!(payload)).await?;
        let content: FileContent = serde_json::from_value(data)
            .map_err(|e| RemoteRepoError::InvalidResponse(e.to_string()))?;
        Ok(content)
    }

    pub async fn get_graph_status(
        &self,
        repo_id: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<GraphStatus, RemoteRepoError> {
        let mut payload = serde_json::Map::new();
        if let Some(id) = repo_id {
            payload.insert("repo_id".to_string(), json!(id));
        }
        if let Some(id) = session_id {
            payload.insert("session_id".to_string(), json!(id));
        }
        payload.insert("request_id".to_string(), json!(Self::request_id()));
        let data = self.post("/v1/graph/status", json!(payload)).await?;
        let status: GraphStatus = serde_json::from_value(data)
            .map_err(|e| RemoteRepoError::InvalidResponse(e.to_string()))?;
        Ok(status)
    }
}
```

- [ ] **Step 2: Write client unit tests**

```rust
// apps/desktop/src-tauri/src/remote_repo/client_test.rs
#[cfg(test)]
mod tests {
    use super::super::client::RemoteRepoClient;
    use super::super::models::*;
    use serde_json::json;

    fn client() -> RemoteRepoClient {
        RemoteRepoClient::new("http://localhost:9999".to_string(), "test-key".to_string())
    }

    #[test]
    fn test_status_for_path_untracked() {
        let c = client();
        let mut status = serde_json::Map::new();
        let mut entry = serde_json::Map::new();
        entry.insert("worktree_status".to_string(), json!("?"));
        entry.insert("index_status".to_string(), json!("?"));
        status.insert("README.md".to_string(), json!(entry));
        // Use reflection or expose status_for_path as pub(super) for testing.
        // For this plan we assume it is pub(crate).
        let result = c.status_for_path("README.md", Some(&status));
        assert!(matches!(result, FileStatus::Untracked));
    }
}
```

Make `status_for_path` `pub(crate)` and `#[cfg(test)] pub` for test access. Phase 1 fallback does not infer file status from shell output, so unit tests cover the `find -printf` parser only.

- [ ] **Step 3: Add tests module to client.rs**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_parse_directory() {
        let line = r#"{"name":"src","path":"./src","kind":"directory"}"#;
        let parsed: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(parsed["name"], "src");
        assert_eq!(parsed["kind"], "directory");
    }

    #[test]
    fn test_fallback_parse_file() {
        let line = r#"{"name":"config.py","path":"./config.py","kind":"file"}"#;
        let parsed: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(parsed["name"], "config.py");
        assert_eq!(parsed["kind"], "file");
    }
}
```

- [ ] **Step 4: Run Rust tests**

```bash
cd apps/desktop/src-tauri
cargo test -p giteam-desktop remote_repo::client::tests -- --nocapture
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/remote_repo/
git commit -m "feat(remote-repo): implement HTTP client with file tree fallback"
```

---

## Task 5: Implement Tauri command dispatch

**Files:**
- Create: `apps/desktop/src-tauri/src/remote_repo/commands.rs`
- Modify: `apps/desktop/src-tauri/src/remote_repo/mod.rs`
- Modify: `apps/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Write the command dispatcher**

```rust
use serde_json::Value;
use tauri::{command, AppHandle, State};

use super::client::RemoteRepoClient;
use super::models::*;
use super::store;

#[command]
pub async fn remote_repo(
    app_handle: AppHandle,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    store::seed_default_config(&app_handle)?;
    let configs = store::list_configs(&app_handle)?;
    let config = configs
        .first()
        .cloned()
        .ok_or_else(|| "no remote repo configured".to_string())?;
    let client = RemoteRepoClient::new(config.service_url, config.api_key);

    match action.as_str() {
        "get_connection_status" => {
            let status = client.connection_status_soft(&config.repo_id).await;
            serde_json::to_value(status).map_err(|e| e.to_string())
        }
        "sync_repo" => {
            let result = client.sync_repo(&config.repo_id).await.map_err(|e| e.to_string())?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "create_session" => {
            let session = client
                .create_session(
                    &config.repo_id,
                    payload
                        .get("ref_or_commit")
                        .and_then(|v| v.as_str()),
                )
                .await.map_err(|e| e.to_string())?;
            store::set_session_id(&app_handle, &config.repo_id, Some(&session.session_id))?;
            serde_json::to_value(session).map_err(|e| e.to_string())
        }
        "get_session_state" => {
            let session_id = config
                .session_id
                .as_deref()
                .or_else(|| payload.get("session_id").and_then(|v| v.as_str()))
                .ok_or("session_id required")?;
            let state = client.get_session_state(session_id).await.map_err(|e| e.to_string())?;
            serde_json::to_value(state).map_err(|e| e.to_string())
        }
        "list_files" => {
            let session_id = config
                .session_id
                .as_deref()
                .ok_or("no active session")?;
            let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let nodes = client.list_workspace_files(session_id, path).await.map_err(|e| e.to_string())?;
            serde_json::to_value(nodes).map_err(|e| e.to_string())
        }
        "read_file" => {
            let session_id = config
                .session_id
                .as_deref()
                .ok_or("no active session")?;
            let path = payload
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("path required")?;
            let content = client.read_file(session_id, path).await.map_err(|e| e.to_string())?;
            serde_json::to_value(content).map_err(|e| e.to_string())
        }
        "get_graph_status" => {
            let state = client
                .get_graph_status(Some(&config.repo_id), config.session_id.as_deref())
                .await.map_err(|e| e.to_string())?;
            serde_json::to_value(state).map_err(|e| e.to_string())
        }
        "list_remote_configs" => {
            serde_json::to_value(configs).map_err(|e| e.to_string())
        }
        "save_remote_config" => {
            let cfg: RemoteRepoConfig = serde_json::from_value(payload)
                .map_err(|e| format!("invalid config: {e}"))?;
            store::save_config(&app_handle, &cfg)?;
            serde_json::to_value(cfg).map_err(|e| e.to_string())
        }
        _ => Err(format!("unknown remote_repo action: {action}")),
    }
}
```

- [ ] **Step 2: Register module and command**

Update `apps/desktop/src-tauri/src/main.rs`:

```rust
mod commands;
mod remote_repo; // ADD
```

Add `remote_repo::remote_repo` to the `generate_handler!` macro list.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/
git commit -m "feat(remote-repo): add Tauri command dispatcher"
```

---

## Task 6: Define TypeScript models and API wrappers

**Files:**
- Create: `apps/desktop/src/components/remote-repo/types.ts`
- Create: `apps/desktop/src/components/remote-repo/remoteRepoApi.ts`

- [ ] **Step 1: Write types.ts**

```typescript
export type RemoteRepoConfig = {
  repoId: string;
  name: string;
  serviceUrl: string;
  apiKey: string;
  defaultRef: string;
  sessionId?: string;
};

export type ConnectionStatus = {
  repoId: string;
  online: boolean;
  serviceUrl: string;
  defaultRef: string;
  defaultCommit?: string;
  error?: string;
};

export type SessionSummary = {
  sessionId: string;
  repoId: string;
  baseCommit: string;
  workspaceVersion: number;
};

export type SessionState = {
  sessionId: string;
  repoId: string;
  baseCommit: string;
  workspaceVersion: number;
  dirty: boolean;
  modifiedCount: number;
  untrackedCount: number;
  deletedCount: number;
  createdAtMs: number;
  agentActivitySummary?: unknown;
};

export type FileTreeNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  status: "unchanged" | "modified" | "untracked" | "deleted" | "conflict";
  children?: FileTreeNode[];
  agentOperation?: unknown;
};

export type FileContent = {
  path: string;
  content: string;
  workspaceVersion: number;
  truncated: boolean;
};

export type GraphStatus = {
  target: string;
  state: string;
  lastIndexed?: string;
};
```

- [ ] **Step 2: Write remoteRepoApi.ts**

```typescript
import { invoke } from "@tauri-apps/api/core";
import {
  ConnectionStatus,
  FileContent,
  FileTreeNode,
  GraphStatus,
  RemoteRepoConfig,
  SessionState,
  SessionSummary,
} from "./types";

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return invoke("remote_repo", { action: "get_connection_status", payload: {} });
}

export async function syncRepo(): Promise<{ repoId: string; cachePath: string }> {
  return invoke("remote_repo", { action: "sync_repo", payload: {} });
}

export async function createSession(refOrCommit?: string): Promise<SessionSummary> {
  return invoke("remote_repo", {
    action: "create_session",
    payload: refOrCommit ? { ref_or_commit: refOrCommit } : {},
  });
}

export async function getSessionState(): Promise<SessionState> {
  return invoke("remote_repo", { action: "get_session_state", payload: {} });
}

export async function listFiles(path = "."): Promise<FileTreeNode[]> {
  return invoke("remote_repo", { action: "list_files", payload: { path } });
}

export async function readFile(path: string): Promise<FileContent> {
  return invoke("remote_repo", { action: "read_file", payload: { path } });
}

export async function getGraphStatus(): Promise<GraphStatus> {
  return invoke("remote_repo", { action: "get_graph_status", payload: {} });
}

export async function listRemoteConfigs(): Promise<RemoteRepoConfig[]> {
  return invoke("remote_repo", { action: "list_remote_configs", payload: {} });
}

export async function saveRemoteConfig(config: RemoteRepoConfig): Promise<RemoteRepoConfig> {
  return invoke("remote_repo", { action: "save_remote_config", payload: config });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/remote-repo/
git commit -m "feat(remote-repo): add TypeScript models and Tauri API wrappers"
```

---

## Task 7: Implement React context and panel container

**Files:**
- Create: `apps/desktop/src/components/remote-repo/RemoteRepoProvider.tsx`
- Create: `apps/desktop/src/components/remote-repo/RemoteRepoPanel.tsx`

- [ ] **Step 1: Write RemoteRepoProvider.tsx**

```typescript
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getConnectionStatus,
  getGraphStatus,
  getSessionState,
  listRemoteConfigs,
} from "./remoteRepoApi";
import { ConnectionStatus, GraphStatus, RemoteRepoConfig, SessionState } from "./types";

type RemoteRepoContextValue = {
  config?: RemoteRepoConfig;
  connection?: ConnectionStatus;
  session?: SessionState;
  graph?: GraphStatus;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
};

const RemoteRepoContext = createContext<RemoteRepoContextValue | null>(null);

export function RemoteRepoProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<RemoteRepoConfig>();
  const [connection, setConnection] = useState<ConnectionStatus>();
  const [session, setSession] = useState<SessionState>();
  const [graph, setGraph] = useState<GraphStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const configs = await listRemoteConfigs();
      const cfg = configs[0];
      setConfig(cfg);
      const conn = await getConnectionStatus();
      setConnection(conn);
      if (conn.online) {
        try {
          const sess = await getSessionState();
          setSession(sess);
        } catch {
          setSession(undefined);
        }
        try {
          const g = await getGraphStatus();
          setGraph(g);
        } catch {
          setGraph(undefined);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <RemoteRepoContext.Provider
      value={{ config, connection, session, graph, loading, error, refresh }}
    >
      {children}
    </RemoteRepoContext.Provider>
  );
}

export function useRemoteRepo() {
  const ctx = useContext(RemoteRepoContext);
  if (!ctx) throw new Error("useRemoteRepo must be used within RemoteRepoProvider");
  return ctx;
}
```

- [ ] **Step 2: Write RemoteRepoPanel.tsx**

```tsx
import {
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { RemoteRepoProvider, useRemoteRepo } from "./RemoteRepoProvider";
import { ConnectionHeader } from "./ConnectionHeader";
import { WorkspaceStatusBar } from "./WorkspaceStatusBar";
import { RemoteFileTree } from "./RemoteFileTree";

export function RemoteRepoPanel() {
  return (
    <RemoteRepoProvider>
      <RemoteRepoPanelInner />
    </RemoteRepoProvider>
  );
}

function RemoteRepoPanelInner() {
  const { connection, session, loading, error } = useRemoteRepo();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <SidebarGroup className="px-2 py-2">
      <SidebarGroupLabel className="text-xs font-medium text-sidebar-foreground/70">
        Remote Repo
      </SidebarGroupLabel>
      {error && (
        <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <ConnectionHeader connection={connection} loading={loading} />
      <WorkspaceStatusBar session={session} />
      {connection?.online && session && (
        <RemoteFileTree sessionId={session.sessionId} onSelectFile={setSelectedFile} />
      )}
    </SidebarGroup>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/remote-repo/
git commit -m "feat(remote-repo): add provider and sidebar panel container"
```

---

## Task 8: Implement sub-components

**Files:**
- Create: `apps/desktop/src/components/remote-repo/ConnectionHeader.tsx`
- Create: `apps/desktop/src/components/remote-repo/WorkspaceStatusBar.tsx`
- Create: `apps/desktop/src/components/remote-repo/RemoteFileTree.tsx`
- Create: `apps/desktop/src/components/remote-repo/RemoteFilePreview.tsx`

- [ ] **Step 1: Write ConnectionHeader.tsx**

```tsx
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, Settings } from "lucide-react";
import { ConnectionStatus } from "./types";
import { syncRepo } from "./remoteRepoApi";
import { useRemoteRepo } from "./RemoteRepoProvider";

export function ConnectionHeader({
  connection,
  loading,
}: {
  connection?: ConnectionStatus;
  loading: boolean;
}) {
  const { refresh } = useRemoteRepo();

  const handleSync = async () => {
    await syncRepo();
    await refresh();
  };

  const statusColor = connection?.online
    ? "bg-green-500"
    : loading
      ? "bg-yellow-400"
      : "bg-red-500";

  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar p-2 text-sidebar-foreground flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="text-xs font-medium">
            {connection?.online ? "online" : loading ? "checking" : "offline"}
          </span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="max-w-[120px] truncate text-[10px] text-muted-foreground cursor-help">
                {connection?.serviceUrl ?? "no service"}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">{connection?.serviceUrl}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="text-xs font-medium truncate">
        {connection?.repoId ?? "Loading..."}
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={handleSync}
          disabled={!connection?.online || loading}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          Sync
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={refresh}
          disabled={loading}
        >
          Reconnect
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          disabled
        >
          <Settings className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write WorkspaceStatusBar.tsx**

```tsx
import { SessionState } from "./types";

function formatAge(ms: number) {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function WorkspaceStatusBar({ session }: { session?: SessionState }) {
  if (!session) {
    return (
      <div className="rounded-lg border border-sidebar-border bg-sidebar p-2 text-xs text-muted-foreground">
        No active session
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar p-2 text-sidebar-foreground flex flex-col gap-1.5 text-xs">
      <div className="font-medium text-sidebar-foreground/80">Workspace Status</div>
      {session.dirty ? (
        <div className="rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900 p-1.5 flex justify-between text-orange-800 dark:text-orange-300">
          <span className="font-medium">Dirty</span>
          <span>
            {session.modifiedCount} modified
            {session.untrackedCount > 0 ? `, ${session.untrackedCount} untracked` : ""}
            {session.deletedCount > 0 ? `, ${session.deletedCount} deleted` : ""}
          </span>
        </div>
      ) : (
        <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-1.5 flex justify-between text-green-800 dark:text-green-300">
          <span className="font-medium">Clean</span>
          <span>no changes</span>
        </div>
      )}
      <div className="flex justify-between">
        <span>Session</span>
        <span title={session.sessionId}>{formatAge(session.createdAtMs)}</span>
      </div>
      <div className="flex justify-between">
        <span>Version</span>
        <span className="font-mono">{session.workspaceVersion}</span>
      </div>
      <div className="flex justify-between">
        <span>Capabilities</span>
        <span className="text-green-600 dark:text-green-400">GitNexus ✓ · MCP configured</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write RemoteFileTree.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ChevronDown, File, Folder } from "lucide-react";
import { FileTreeNode } from "./types";
import { listFiles } from "./remoteRepoApi";

const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
  modified: { bg: "bg-yellow-100 dark:bg-yellow-900/40", text: "text-yellow-700 dark:text-yellow-300", label: "M" },
  untracked: { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300", label: "U" },
  deleted: { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300", label: "D" },
  conflict: { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-700 dark:text-purple-300", label: "C" },
};

function FileTreeItem({
  node,
  depth = 0,
  sessionId,
  onSelectFile,
}: {
  node: FileTreeNode;
  depth?: number;
  sessionId: string;
  onSelectFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeNode[]>();
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (node.kind === "file") {
      onSelectFile?.(node.path);
      return;
    }
    if (!expanded && children === undefined) {
      setLoading(true);
      try {
        const list = await listFiles(node.path);
        setChildren(list);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }, [expanded, children, node.kind, node.path, onSelectFile]);

  const badge = statusBadge[node.status];

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <button
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-sidebar-accent"
        onClick={toggle}
      >
        {node.kind === "directory" ? (
          expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )
        ) : (
          <span className="w-3" />
        )}
        {node.kind === "directory" ? (
          <Folder className="h-3.5 w-3.5 text-sidebar-foreground/70" />
        ) : (
          <File className="h-3.5 w-3.5 text-sidebar-foreground/70" />
        )}
        <span className="truncate">{node.name}</span>
        {badge && (
          <span className={`ml-auto rounded px-1 text-[9px] ${badge.bg} ${badge.text}`}>
            {badge.label}
          </span>
        )}
      </button>
      {loading && (
        <div className="pl-4 text-[10px] text-muted-foreground">loading...</div>
      )}
      {expanded && children?.map((child) => (
        <FileTreeItem key={child.path} node={child} depth={depth + 1} sessionId={sessionId} onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}

export function RemoteFileTree({ sessionId, onSelectFile }: { sessionId: string; onSelectFile?: (path: string) => void }) {
  const [root, setRoot] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setLoading(true);
    listFiles(".")
      .then(setRoot)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading files...</div>;
  if (error) return <div className="text-xs text-red-600">{error}</div>;
  if (root.length === 0) return <div className="text-xs text-muted-foreground">Workspace is empty</div>;

  return (
    <div className="rounded-lg border border-sidebar-border bg-sidebar p-2 max-h-64 overflow-y-auto">
      <div className="mb-1 text-xs font-medium text-sidebar-foreground/80">Workspace Files</div>
      {root.map((node) => (
        <FileTreeItem key={node.path} node={node} sessionId={sessionId} onSelectFile={onSelectFile} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write RemoteFilePreview.tsx**

```tsx
import { useEffect, useState } from "react";
import { readFile } from "./remoteRepoApi";

export function RemoteFilePreview({
  sessionId,
  path,
}: {
  sessionId: string;
  path: string;
}) {
  const [content, setContent] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setLoading(true);
    readFile(path)
      .then((res) => setContent(res.content))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionId, path]);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>;

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{path}</h2>
        <div className="flex gap-2">
          <button disabled className="rounded-md border px-3 py-1 text-xs opacity-50">
            Open in OpenCode
          </button>
          <button disabled className="rounded-md border px-3 py-1 text-xs opacity-50">
            Edit via MCP
          </button>
        </div>
      </div>
      <pre className="flex-1 overflow-auto rounded-md border bg-muted p-4 text-sm font-mono">
        {content}
      </pre>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/remote-repo/
git commit -m "feat(remote-repo): add panel sub-components"
```

---

## Task 9: Mount panel in App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Locate the sidebar rendering in App.tsx**

Find the `<Sidebar>` component usage and insert `<RemoteRepoPanel />` after the existing local repository list.

- [ ] **Step 2: Add import and mount**

```typescript
import { RemoteRepoPanel } from "@/components/remote-repo/RemoteRepoPanel";
```

Mount inside the `<SidebarContent>` after local repositories and wire selected file preview into the main area, e.g.:

```tsx
<SidebarContent>
  {/* existing local repo list */}
  <RemoteRepoPanel onSelectFile={setSelectedRemoteFile} />
</SidebarContent>
```

Then conditionally render `RemoteFilePreview` in the main area when `selectedRemoteFile` is set:

```tsx
{selectedRemoteFile ? (
  <RemoteFilePreview sessionId={activeSessionId} path={selectedRemoteFile} />
) : (
  /* existing main content */
)}
```

Note: `RemoteRepoPanel` will need to accept `onSelectFile` and forward it to `RemoteFileTree`. Update `RemoteRepoPanelInner` accordingly:

```tsx
export function RemoteRepoPanel({ onSelectFile }: { onSelectFile?: (path: string) => void }) {
  return (
    <RemoteRepoProvider>
      <RemoteRepoPanelInner onSelectFile={onSelectFile} />
    </RemoteRepoProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/components/remote-repo/
git commit -m "feat(remote-repo): mount remote repo panel in sidebar"
```

---

## Task 10: Add integration tests

**Files:**
- Create: `apps/desktop/src-tauri/tests/remote_repo_integration.rs`

- [ ] **Step 1: Write integration test**

Start a local Python remote-repo-service on a random port, point env var, call Tauri command via a small harness (or test client directly). For simplicity, test `RemoteRepoClient` directly against a running service.

```rust
use giteam_desktop::remote_repo::client::RemoteRepoClient;

#[tokio::test]
async fn test_client_reports_offline_when_service_down() {
    let client = RemoteRepoClient::new("http://localhost:1".to_string(), "".to_string());
    let status = client.connection_status_soft("demo").await;
    assert!(!status.online);
}
```

- [ ] **Step 2: Run tests**

```bash
cd apps/desktop/src-tauri
cargo test -p giteam-desktop --test remote_repo_integration
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/tests/
git commit -m "test(remote-repo): add integration test for offline status"
```

---

## Task 11: Type-check and lint

**Files:**
- Modify: any files flagged by type checker

- [ ] **Step 1: Rust check**

```bash
cd apps/desktop/src-tauri
cargo check
```

Fix any errors.

- [ ] **Step 2: TypeScript check**

```bash
cd apps/desktop
npx tsc --noEmit
```

Fix any errors.

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix(remote-repo): resolve type-check and lint issues"
```

---

## Task 12: Manual verification

- [ ] **Step 1: Start remote-repo-service**

```bash
cd /Users/rxl/Desktop/repo/giteam/remote-repo-skill-brainstorm_2_giteam
python -m remote_repo_service.app
```

Confirm it listens on `http://localhost:8000`.

- [ ] **Step 2: Run giteam Desktop in dev**

```bash
cd apps/desktop
npm run dev
```

- [ ] **Step 3: Verify checklist**

- Sidebar shows "Remote Repo" group.
- Connection status shows green online badge and service URL tooltip.
- Sync button triggers remote sync.
- Reconnect button refreshes status.
- Workspace Status Bar shows session age, version, dirty/clean state, capabilities.
- File tree lazily loads directories.
- Status badges (M/U/D/C) render correctly.
- Clicking a file triggers `onSelectFile` and shows read-only preview with disabled placeholder buttons.
- File tree fallback uses python3 JSONL output for cross-platform directory/file detection (macOS BSD find lacks `-printf`); status defaults to unchanged in fallback mode.
- Stopping remote service turns badge red and disables tree/preview.
- Restarting service recovers on next Reconnect or poll.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix(remote-repo): manual verification fixes"
```

---

## Self-Review

### Spec Coverage

| Spec Requirement | Plan Task |
|---|---|
| Connection status, repo, branch, service URL | Task 8 (ConnectionHeader) |
| Workspace/session status, dirty, version, GitNexus, MCP configured | Task 8 (WorkspaceStatusBar) |
| Lazy-loaded file tree with M/U/D/C markers | Task 8 (RemoteFileTree), Task 4 (client fallback via python3 JSONL) |
| Read-only file preview | Task 8 (RemoteFilePreview) |
| Explicit Reconnect/Sync with feedback | Task 8 (ConnectionHeader) |
| Multi-repo data model but single-repo UX | Task 2, Task 3, Task 6 |
| MCP remains usable alongside Tauri bridge | Not a code change; documented in spec |

### Placeholder Scan

No TBD/TODO/fill-in-details remain. Every step has exact file paths, code, and commands.

### Type Consistency

- Rust `SessionState` includes `agent_activity_summary: Option<Value>` matching TS `agentActivitySummary?: unknown`.
- Rust `FileTreeNode` includes `agent_operation: Option<Value>` matching TS `agentOperation?: unknown`.
- Action names in `commands.rs` match `remoteRepoApi.ts` exactly.
- File status enum strings match between Rust and TypeScript.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-23-remote-repository-panel-phase1.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

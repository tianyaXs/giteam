use serde_json::Value;
use std::time::Duration;
use thiserror::Error;

use super::models::*;

#[derive(Debug, Error)]
pub enum RemoteRepoError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Remote error {code}: {message}")]
    Remote { code: String, message: String },
    #[error("Session not found")]
    SessionNotFound,
    #[error("Repo not found")]
    RepoNotFound,
    #[error("Remote service authorization is required")]
    Unauthorized,
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ApiErrorBody {
    code: String,
    message: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ApiResponse {
    ok: bool,
    request_id: String,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<ApiErrorBody>,
}

pub struct RemoteRepoClient {
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl RemoteRepoClient {
    pub fn new(base_url: String, api_key: String) -> Self {
        let base_url = base_url.trim_end_matches('/').to_string();
        Self {
            base_url,
            api_key,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    fn request_id(&self) -> String {
        fastrand::u64(0..u64::MAX).to_string()
    }

    async fn post(
        &self,
        path: &str,
        body: Value,
    ) -> Result<Value, RemoteRepoError> {
        if self.base_url.is_empty() {
            return Err(RemoteRepoError::InvalidResponse(
                "REMOTE_REPO_SERVICE_URL is not configured".to_string(),
            ));
        }
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .post(&url)
            .header("X-API-Key", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(RemoteRepoError::Http)?;

        let status = resp.status();
        let text = resp.text().await.map_err(RemoteRepoError::Http)?;

        if !status.is_success() {
            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return Err(RemoteRepoError::Unauthorized);
            }
            return Err(RemoteRepoError::Remote {
                code: "http_error".to_string(),
                message: format!("HTTP {}: {}", status, text),
            });
        }

        let parsed: ApiResponse = serde_json::from_str(&text).map_err(|e| {
            RemoteRepoError::InvalidResponse(format!("{} | body: {}", e, text))
        })?;

        if !parsed.ok {
            if let Some(err) = parsed.error {
                return Err(match err.code.as_str() {
                    "session_not_found" => RemoteRepoError::SessionNotFound,
                    "repo_not_found" => RemoteRepoError::RepoNotFound,
                    "auth_required" | "authentication_required" => RemoteRepoError::Unauthorized,
                    _ => RemoteRepoError::Remote {
                        code: err.code,
                        message: err.message,
                    },
                });
            }
        }

        Ok(parsed.data.unwrap_or(Value::Null))
    }

    pub async fn workspace_request(
        &self,
        operation: &str,
        input: Value,
    ) -> Result<Value, RemoteRepoError> {
        let path = match operation {
            "create_session" => "/v1/sessions",
            "session_state" => "/v1/sessions/state",
            "run_shell" => "/v1/shell/run",
            "list_files" => "/v1/files/list",
            "read_file" => "/v1/files/read",
            "find_files" => "/v1/find/files",
            "find_text" => "/v1/find/text",
            "write_file" => "/v1/files/write",
            "edit_file" => "/v1/files/edit",
            "apply_patch" => "/v1/files/apply-patch",
            "graph_status" => "/v1/graph/status",
            "graph_analyze" => "/v1/graph/analyze",
            "list_tools" => "/v1/tools",
            "list_workspaces" => "/v1/workspaces/list",
            "get_workspace" => "/v1/workspaces/get",
            "resume_workspace" => "/v1/workspaces/resume",
            "list_operations" => "/v1/workspaces/operations",
            "list_activities" => "/v1/activities/list",
            "repo_gitnexus_status" => "/v1/gitnexus/repo-status",
            _ => return Err(RemoteRepoError::InvalidResponse(format!("unsupported workspace operation: {operation}"))),
        };
        let mut body = input.as_object().cloned().ok_or_else(|| {
            RemoteRepoError::InvalidResponse("workspace operation input must be an object".to_string())
        })?;
        body.insert("request_id".to_string(), Value::String(self.request_id()));
        self.post(path, Value::Object(body)).await
    }

    pub async fn list_repositories(&self) -> Result<Vec<RemoteServiceRepo>, RemoteRepoError> {
        let body = serde_json::json!({
            "request_id": self.request_id(),
        });
        let data = self.post("/v1/repos", body).await?;
        let rows = data
            .get("repos")
            .and_then(Value::as_array)
            .or_else(|| data.as_array())
            .ok_or_else(|| RemoteRepoError::InvalidResponse("expected repos array from /v1/repos".to_string()))?
            .clone();
        rows.into_iter()
            .map(|row| serde_json::from_value(row).map_err(|e| RemoteRepoError::InvalidResponse(format!("repo list parse: {e}"))) )
            .collect()
    }

    pub async fn get_connection_status(
        &self,
        repo_id: &str,
    ) -> Result<ConnectionStatus, RemoteRepoError> {
        let found = self
            .list_repositories()
            .await?
            .into_iter()
            .find(|repo| repo.repo_id == repo_id)
            .ok_or(RemoteRepoError::RepoNotFound)?;

        Ok(ConnectionStatus {
            repo_id: repo_id.to_string(),
            online: true,
            service_url: self.base_url.clone(),
            default_ref: found.default_ref,
            default_commit: found.default_commit,
            error: None,
        })
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
        let body = serde_json::json!({
            "repo_id": repo_id,
            "request_id": self.request_id(),
        });
        let data = self.post("/v1/repos/sync", body).await?;

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

    pub async fn list_repo_branches(&self, repo_id: &str) -> Result<Vec<RemoteRepoBranch>, RemoteRepoError> {
        let data = self.post(
            "/v1/repos/branches",
            serde_json::json!({ "repo_id": repo_id, "request_id": self.request_id() }),
        ).await?;
        serde_json::from_value(data.get("branches").cloned().unwrap_or_else(|| Value::Array(vec![])))
            .map_err(|error| RemoteRepoError::InvalidResponse(format!("repo branch parse: {error}")))
    }

    pub async fn list_repo_files(
        &self,
        repo_id: &str,
        path: &str,
        ref_or_commit: Option<&str>,
    ) -> Result<RemoteRepoFileTree, RemoteRepoError> {
        let mut body = serde_json::json!({
            "repo_id": repo_id,
            "path": path,
            "request_id": self.request_id(),
        });
        if let Some(value) = ref_or_commit.filter(|value| !value.trim().is_empty()) {
            body["ref_or_commit"] = Value::String(value.to_string());
        }
        let data = self.post("/v1/repos/files/list", body).await?;
        serde_json::from_value(data)
            .map_err(|error| RemoteRepoError::InvalidResponse(format!("repo file tree parse: {error}")))
    }

    pub async fn read_repo_file(
        &self,
        repo_id: &str,
        path: &str,
        ref_or_commit: Option<&str>,
    ) -> Result<RemoteRepoFileContent, RemoteRepoError> {
        let mut body = serde_json::json!({
            "repo_id": repo_id,
            "path": path,
            "request_id": self.request_id(),
        });
        if let Some(value) = ref_or_commit.filter(|value| !value.trim().is_empty()) {
            body["ref_or_commit"] = Value::String(value.to_string());
        }
        let data = self.post("/v1/repos/files/read", body).await?;
        serde_json::from_value(data)
            .map_err(|error| RemoteRepoError::InvalidResponse(format!("repo file content parse: {error}")))
    }

    pub async fn add_repository(
        &self,
        repo_id: &str,
        name: &str,
        remote_url: &str,
        default_ref: &str,
        auth_method: Option<&str>,
    ) -> Result<Value, RemoteRepoError> {
        let mut body = serde_json::json!({
            "repo_id": repo_id,
            "name": name,
            "remote_url": remote_url,
            "default_ref": default_ref,
            "request_id": self.request_id(),
        });
        if let Some(auth_method) = auth_method.filter(|value| !value.trim().is_empty()) {
            body["auth_method"] = Value::String(auth_method.to_string());
        }
        self.post("/v1/repos/add", body).await
    }

    pub async fn update_repository(
        &self,
        repo_id: &str,
        name: Option<&str>,
        remote_url: Option<&str>,
        default_ref: Option<&str>,
        auth_method: Option<&str>,
    ) -> Result<Value, RemoteRepoError> {
        let mut body = serde_json::json!({
            "repo_id": repo_id,
            "request_id": self.request_id(),
        });
        if let Some(name) = name.filter(|value| !value.trim().is_empty()) {
            body["name"] = Value::String(name.to_string());
        }
        if let Some(remote_url) = remote_url.filter(|value| !value.trim().is_empty()) {
            body["remote_url"] = Value::String(remote_url.to_string());
        }
        if let Some(default_ref) = default_ref.filter(|value| !value.trim().is_empty()) {
            body["default_ref"] = Value::String(default_ref.to_string());
        }
        if let Some(auth_method) = auth_method.filter(|value| !value.trim().is_empty()) {
            body["auth_method"] = Value::String(auth_method.to_string());
        }
        self.post("/v1/repos/update", body).await
    }

    pub async fn remove_repository(&self, repo_id: &str) -> Result<Value, RemoteRepoError> {
        self.post(
            "/v1/repos/remove",
            serde_json::json!({
                "repo_id": repo_id,
                "request_id": self.request_id(),
            }),
        )
        .await
    }

    pub async fn reload_config(&self) -> Result<Value, RemoteRepoError> {
        self.post(
            "/v1/config/reload",
            serde_json::json!({ "request_id": self.request_id() }),
        )
        .await
    }

    pub async fn create_session(
        &self,
        repo_id: &str,
        ref_or_commit: Option<&str>,
    ) -> Result<SessionSummary, RemoteRepoError> {
        let mut body = serde_json::json!({
            "repo_id": repo_id,
            "request_id": self.request_id(),
        });
        if let Some(r) = ref_or_commit {
            body["ref"] = Value::String(r.to_string());
        }
        let data = self.post("/v1/sessions", body).await?;

        let session_id = data
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let base_commit = data
            .get("base_commit")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let workspace_version = data
            .get("workspace_version")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        Ok(SessionSummary {
            session_id,
            repo_id: repo_id.to_string(),
            base_commit,
            workspace_version,
        })
    }

    pub async fn get_session_state(
        &self,
        session_id: &str,
    ) -> Result<SessionState, RemoteRepoError> {
        let body = serde_json::json!({
            "session_id": session_id,
            "request_id": self.request_id(),
        });
        let data = self.post("/v1/sessions/state", body).await?;

        let mut state: SessionState = serde_json::from_value(data).map_err(|e| {
            RemoteRepoError::InvalidResponse(format!("session state parse: {}", e))
        })?;

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
        let body = serde_json::json!({
            "session_id": session_id,
            "path": path,
            "request_id": self.request_id(),
        });
        let data = match self.post("/v1/files/tree", body).await {
            Ok(d) => d,
            Err(_) => {
                let escaped = path.replace('\\', "\\\\").replace('\'', "'\\''");
                let command = format!(
                    "python3 - <<'PY'\nimport os, json\nroot = '{}'\nfor name in os.listdir(root):\n    p = os.path.join(root, name)\n    kind = 'directory' if os.path.isdir(p) else 'file'\n    print(json.dumps({{'name': name, 'path': p, 'kind': kind}}))\nPY",
                    escaped
                );
                let shell_body = serde_json::json!({
                    "session_id": session_id,
                    "command": command,
                    "request_id": self.request_id(),
                });
                let shell_data = self.post("/v1/shell/run", shell_body).await?;
                let stdout = shell_data
                    .get("stdout")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let mut nodes = Vec::new();
                for line in stdout.lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let obj: Value = serde_json::from_str(line).map_err(|e| {
                        RemoteRepoError::InvalidResponse(format!(
                            "JSONL parse error: {} | line: {}",
                            e, line
                        ))
                    })?;
                    let name = obj
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let node_path = obj
                        .get("path")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let kind = match obj.get("kind").and_then(|v| v.as_str()) {
                        Some("directory") => FileNodeKind::Directory,
                        _ => FileNodeKind::File,
                    };
                    nodes.push(FileTreeNode {
                        name,
                        path: node_path,
                        kind,
                        status: FileStatus::Unchanged,
                        children: None,
                        agent_operation: None,
                    });
                }
                return Ok(nodes);
            }
        };

        let nodes: Vec<FileTreeNode> = serde_json::from_value(data).map_err(|e| {
            RemoteRepoError::InvalidResponse(format!("file tree parse: {}", e))
        })?;
        Ok(nodes)
    }

    pub async fn read_file(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<FileContent, RemoteRepoError> {
        let body = serde_json::json!({
            "session_id": session_id,
            "path": path,
            "request_id": self.request_id(),
        });
        let data = self.post("/v1/files/read", body).await?;

        let file_content: FileContent = serde_json::from_value(data).map_err(|e| {
            RemoteRepoError::InvalidResponse(format!("file content parse: {}", e))
        })?;
        Ok(file_content)
    }

    pub async fn get_graph_status(
        &self,
        repo_id: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<GraphStatus, RemoteRepoError> {
        let mut body = serde_json::json!({
            "request_id": self.request_id(),
        });
        if let Some(r) = repo_id {
            body["repo_id"] = Value::String(r.to_string());
        }
        if let Some(s) = session_id {
            body["session_id"] = Value::String(s.to_string());
        }
        let data = self.post("/v1/graph/status", body).await?;

        let target = data
            .get("target")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let state = data
            .get("state")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let last_indexed = data
            .get("last_indexed")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(GraphStatus {
            target,
            state,
            last_indexed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_jsonl_parsing() {
        let dir_line = r#"{"name": "src", "path": "/workspace/src", "kind": "directory"}"#;
        let file_line = r#"{"name": "main.rs", "path": "/workspace/src/main.rs", "kind": "file"}"#;

        let dir_obj: Value = serde_json::from_str(dir_line).unwrap();
        let file_obj: Value = serde_json::from_str(file_line).unwrap();

        assert_eq!(dir_obj["name"].as_str().unwrap(), "src");
        assert_eq!(dir_obj["kind"].as_str().unwrap(), "directory");
        assert_eq!(file_obj["name"].as_str().unwrap(), "main.rs");
        assert_eq!(file_obj["kind"].as_str().unwrap(), "file");
    }

    #[test]
    fn test_connection_status_soft_offline() {
        let client = RemoteRepoClient::new("http://localhost:1".to_string(), "test-key".to_string());
        let status = tauri::async_runtime::block_on(client.connection_status_soft("test-repo"));
        assert!(!status.online);
        assert_eq!(status.repo_id, "test-repo");
        assert!(status.error.is_some());
    }
}

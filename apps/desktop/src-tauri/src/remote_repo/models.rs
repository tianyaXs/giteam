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
pub struct RemoteServiceRepo {
    #[serde(alias = "repo_id")]
    pub repo_id: String,
    pub name: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    #[serde(alias = "remote_url")]
    pub remote_url: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(alias = "default_ref")]
    pub default_ref: String,
    #[serde(default)]
    #[serde(alias = "default_commit")]
    pub default_commit: Option<String>,
    #[serde(default)]
    #[serde(alias = "sync_status")]
    pub sync_status: Option<String>,
    #[serde(default)]
    #[serde(alias = "error_message")]
    pub error_message: Option<String>,
    #[serde(default)]
    #[serde(alias = "last_synced_at_ms")]
    pub last_synced_at_ms: Option<i64>,
    #[serde(default)]
    #[serde(alias = "auth_method")]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub synced: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepoOverview {
    pub repo_id: String,
    pub display_name: String,
    pub provider: Option<String>,
    pub remote_url: Option<String>,
    pub connection_status: String,
    pub default_ref: String,
    pub default_commit: Option<String>,
    pub linked_project_ids: Vec<String>,
    pub pinned: bool,
    pub sort_order: i64,
    pub last_accessed_at_ms: i64,
    pub last_synced_at_ms: Option<i64>,
    pub error: Option<String>,
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
pub struct RemoteRepoBranch {
    pub name: String,
    #[serde(alias = "short_sha")]
    pub short_sha: String,
    #[serde(alias = "is_default")]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepoFileEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(alias = "short_sha")]
    pub short_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepoFileTree {
    pub r#ref: String,
    pub commit: String,
    pub path: String,
    pub entries: Vec<RemoteRepoFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepoFileContent {
    pub r#ref: String,
    pub commit: String,
    pub path: String,
    #[serde(alias = "start_line")]
    pub start_line: i64,
    #[serde(alias = "end_line")]
    pub end_line: i64,
    pub content: String,
    pub truncated: bool,
    pub sha256: String,
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

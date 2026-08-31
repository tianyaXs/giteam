//! `agent_mcp_*` RPC：MCP 管理面板后端薄壳，逻辑在
//! `giteam_core::pi_agent::mcp::admin`（每仓库管理 runtime + 配置文件）。

use std::path::Path;

use giteam_core::pi_agent::{
    mcp_admin_add_service, mcp_admin_authenticate_service, mcp_admin_connect_service,
    mcp_admin_disconnect_service, mcp_admin_list_services, mcp_admin_list_tools,
    mcp_admin_remove_service, McpMutationResult, McpServiceInput, McpServiceStatus,
    McpToolsSnapshot,
};

#[tauri::command]
pub async fn agent_mcp_list_services(
    repo_path: String,
) -> Result<Vec<McpServiceStatus>, String> {
    mcp_admin_list_services(Path::new(&repo_path))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_mcp_list_tools(repo_path: String) -> Result<McpToolsSnapshot, String> {
    mcp_admin_list_tools(Path::new(&repo_path))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_mcp_add_service(
    repo_path: String,
    input: McpServiceInput,
) -> Result<McpMutationResult, String> {
    mcp_admin_add_service(Path::new(&repo_path), &input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_mcp_remove_service(
    repo_path: String,
    name: String,
) -> Result<McpMutationResult, String> {
    mcp_admin_remove_service(Path::new(&repo_path), &name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_mcp_connect_service(
    repo_path: String,
    name: String,
) -> Result<McpServiceStatus, String> {
    mcp_admin_connect_service(Path::new(&repo_path), &name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_mcp_disconnect_service(
    repo_path: String,
    name: String,
) -> Result<McpServiceStatus, String> {
    mcp_admin_disconnect_service(Path::new(&repo_path), &name)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_mcp_authenticate_service(
    repo_path: String,
    name: String,
) -> Result<McpMutationResult, String> {
    mcp_admin_authenticate_service(Path::new(&repo_path), &name)
        .await
        .map_err(|error| error.to_string())
}

//! MCP 管理面（`agent_mcp_*` RPC 的核心实现）：每仓库一个懒建的管理
//! runtime（进程级缓存），提供 list/add/remove/connect/disconnect。
//!
//! 与会话的关系：管理面只改配置文件与自己缓存的连接；会话工具快照在
//! `create_session` 异步边界生成，因此所有变更返回 `requires_new_session`
//! （UI 明示"重建会话后生效"，不做热插拔，见设计文档）。
//!
//! authenticate：mcpstore light facade 未暴露 OAuth 认证流程，返回结构化
//! 不支持错误；带认证的服务当前以 headers/token 直接写配置。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use mcpstore::{Service, ServiceTarget};
use serde::Serialize;
use tokio::sync::Mutex;

use super::config::McpServiceInput;
use super::runtime::{self, McpRuntime, McpToolSpec, SERVICE_CONNECT_TIMEOUT};
use super::McpError;

/// 管理面连接/重连单个服务的等待上限（与会话发现一致）。
const ADMIN_CONNECT_TIMEOUT: Duration = SERVICE_CONNECT_TIMEOUT;

/// 面板展示的服务条目（`Service::info()` 只读投影）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServiceStatus {
    pub name: String,
    pub transport: String,
    pub url: Option<String>,
    pub command: Option<String>,
    /// stopped/starting/running/stopping（mcpstore RuntimePhase）。
    pub phase: String,
    pub tool_count: usize,
    pub failure: Option<String>,
}

/// 面板展示的工具条目（`McpToolSpec` 的可序列化视图，不含 instance_id）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub exposed_name: String,
    pub service_name: String,
    pub tool_name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServiceError {
    pub service: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolsSnapshot {
    pub tools: Vec<McpToolInfo>,
    pub service_errors: Vec<McpServiceError>,
}

/// 变更操作统一返回；`requires_new_session` 恒为 true（会话快照不可变）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpMutationResult {
    pub requires_new_session: bool,
}

fn mutation_result() -> McpMutationResult {
    McpMutationResult {
        requires_new_session: true,
    }
}

/// 管理面 runtime 缓存（repo 配置路径 → runtime）。add/remove 后逐出，
/// 下次调用重建（等效重读配置文件并重连）。
// ponytail: 进程级缓存不感知外部手改的配置文件；重启或增删服务后即重读。
static ADMIN_RUNTIMES: OnceLock<Mutex<HashMap<PathBuf, Arc<McpRuntime>>>> = OnceLock::new();

async fn management_runtime(base: &Path, repo_path: &Path) -> Result<Arc<McpRuntime>, McpError> {
    let key = runtime::mcp_config_path_in(base, repo_path);
    let cache = ADMIN_RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache.lock().await;
    if let Some(cached) = guard.get(&key) {
        return Ok(Arc::clone(cached));
    }
    let loaded = runtime::load_with_base(base, repo_path).await?;
    guard.insert(key, Arc::clone(&loaded));
    Ok(loaded)
}

async fn evict(base: &Path, repo_path: &Path) {
    let key = runtime::mcp_config_path_in(base, repo_path);
    if let Some(cache) = ADMIN_RUNTIMES.get() {
        cache.lock().await.remove(&key);
    }
}

/// `Service::info()` → 面板 DTO（info 失败时尽量降级，不中断整个列表）。
async fn service_status(service: &Service) -> McpServiceStatus {
    let info = service.info().await.unwrap_or(serde_json::Value::Null);
    let text = |key: &str| {
        info.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    let state = &info["state"];
    McpServiceStatus {
        name: text("service_name").unwrap_or_else(|| "<unknown>".to_string()),
        transport: text("transport").unwrap_or_default(),
        url: text("url"),
        command: text("command"),
        phase: state
            .get("phase")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        tool_count: state
            .get("tool_count")
            .or_else(|| info.get("tool_count"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_default() as usize,
        failure: state
            .pointer("/failure/message")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    }
}

pub async fn admin_list_services_with_base(
    base: &Path,
    repo_path: &Path,
) -> Result<Vec<McpServiceStatus>, McpError> {
    let runtime = management_runtime(base, repo_path).await?;
    let scope = runtime.store.for_store();
    let mut services = Vec::new();
    for service in scope.list_services().await? {
        services.push(service_status(&service).await);
    }
    Ok(services)
}

pub async fn admin_list_tools_with_base(
    base: &Path,
    repo_path: &Path,
) -> Result<McpToolsSnapshot, McpError> {
    let runtime = management_runtime(base, repo_path).await?;
    Ok(McpToolsSnapshot {
        tools: runtime.tools.iter().map(McpToolInfo::from_spec).collect(),
        service_errors: runtime
            .service_errors
            .iter()
            .map(|(service, message)| McpServiceError {
                service: service.clone(),
                message: message.clone(),
            })
            .collect(),
    })
}

impl McpToolInfo {
    fn from_spec(spec: &McpToolSpec) -> Self {
        Self {
            exposed_name: spec.exposed_name.clone(),
            service_name: spec.service_name.clone(),
            tool_name: spec.tool_name.clone(),
            description: spec.description.clone(),
            input_schema: spec.input_schema.clone(),
        }
    }
}

pub async fn admin_add_service_with_base(
    base: &Path,
    repo_path: &Path,
    input: &McpServiceInput,
) -> Result<McpMutationResult, McpError> {
    let runtime = management_runtime(base, repo_path).await?;
    runtime::add_service(&runtime, input).await?;
    evict(base, repo_path).await;
    Ok(mutation_result())
}

pub async fn admin_remove_service_with_base(
    base: &Path,
    repo_path: &Path,
    name: &str,
) -> Result<McpMutationResult, McpError> {
    let runtime = management_runtime(base, repo_path).await?;
    if !runtime::remove_service(&runtime, name).await? {
        return Err(McpError::InvalidConfig(format!("服务 {name} 不存在")));
    }
    evict(base, repo_path).await;
    Ok(mutation_result())
}

pub async fn admin_connect_service_with_base(
    base: &Path,
    repo_path: &Path,
    name: &str,
) -> Result<McpServiceStatus, McpError> {
    let runtime = management_runtime(base, repo_path).await?;
    let scope = runtime.store.for_store();
    let service = scope
        .find_service(ServiceTarget::ServiceName(name))
        .await?;
    let service = service.restart_service().await?;
    service.wait_service(ADMIN_CONNECT_TIMEOUT).await?;
    Ok(service_status(&service).await)
}

pub async fn admin_disconnect_service_with_base(
    base: &Path,
    repo_path: &Path,
    name: &str,
) -> Result<McpServiceStatus, McpError> {
    let runtime = management_runtime(base, repo_path).await?;
    let scope = runtime.store.for_store();
    let service = scope
        .find_service(ServiceTarget::ServiceName(name))
        .await?;
    service.disconnect_service().await?;
    Ok(service_status(&service).await)
}

pub async fn admin_authenticate_service_with_base(
    _base: &Path,
    _repo_path: &Path,
    _name: &str,
) -> Result<McpMutationResult, McpError> {
    Err(McpError::InvalidConfig(
        "mcpstore light facade 未暴露认证流程；带认证的服务请在配置中直接填写 token/headers"
            .to_string(),
    ))
}

// ── 仓库级便捷入口（生产路径；测试用 *_with_base 指定数据根） ──────────────

fn base_dir() -> Result<PathBuf, McpError> {
    super::super::secrets::default_data_dir().ok_or(McpError::NoHomeDir)
}

pub async fn admin_list_services(repo_path: &Path) -> Result<Vec<McpServiceStatus>, McpError> {
    let base = base_dir()?;
    admin_list_services_with_base(&base, repo_path).await
}

pub async fn admin_list_tools(repo_path: &Path) -> Result<McpToolsSnapshot, McpError> {
    let base = base_dir()?;
    admin_list_tools_with_base(&base, repo_path).await
}

pub async fn admin_add_service(
    repo_path: &Path,
    input: &McpServiceInput,
) -> Result<McpMutationResult, McpError> {
    let base = base_dir()?;
    admin_add_service_with_base(&base, repo_path, input).await
}

pub async fn admin_remove_service(
    repo_path: &Path,
    name: &str,
) -> Result<McpMutationResult, McpError> {
    let base = base_dir()?;
    admin_remove_service_with_base(&base, repo_path, name).await
}

pub async fn admin_connect_service(
    repo_path: &Path,
    name: &str,
) -> Result<McpServiceStatus, McpError> {
    let base = base_dir()?;
    admin_connect_service_with_base(&base, repo_path, name).await
}

pub async fn admin_disconnect_service(
    repo_path: &Path,
    name: &str,
) -> Result<McpServiceStatus, McpError> {
    let base = base_dir()?;
    admin_disconnect_service_with_base(&base, repo_path, name).await
}

pub async fn admin_authenticate_service(
    repo_path: &Path,
    name: &str,
) -> Result<McpMutationResult, McpError> {
    let base = base_dir()?;
    admin_authenticate_service_with_base(&base, repo_path, name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base() -> PathBuf {
        std::env::temp_dir().join(format!(
            "giteam-mcp-admin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ))
    }

    fn echo_input(script: &Path) -> McpServiceInput {
        McpServiceInput {
            name: "echo".into(),
            enabled: true,
            url: None,
            command: Some("python3".into()),
            args: vec![script.to_string_lossy().into_owned()],
            env: Default::default(),
            headers: Default::default(),
            description: None,
        }
    }

    fn write_echo_script() -> PathBuf {
        let script = std::env::temp_dir().join(format!(
            "giteam-mcp-admin-echo-{}.py",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ));
        std::fs::write(
            &script,
            r#"import json, sys
def send(msg): print(json.dumps(msg), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    method, mid = req.get("method"), req.get("id")
    if method == "initialize":
        send({"jsonrpc":"2.0","id":mid,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"echo","version":"1.0"}}})
    elif method == "notifications/initialized":
        pass
    elif method == "tools/list":
        send({"jsonrpc":"2.0","id":mid,"result":{"tools":[{"name":"echo","description":"Echo the input","inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}]}})
    elif method == "tools/call":
        text = req["params"]["arguments"].get("text","")
        send({"jsonrpc":"2.0","id":mid,"result":{"content":[{"type":"text","text":f"echo: {text}"}],"isError":False}})
    else:
        send({"jsonrpc":"2.0","id":mid,"error":{"code":-32601,"message":"unknown"}})
"#,
        )
        .expect("write echo script");
        script
    }

    #[tokio::test]
    async fn admin_panel_roundtrip_add_list_tools_disconnect_remove() {
        let base = temp_base();
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let script = write_echo_script();

        // 初始为空。
        assert!(admin_list_services_with_base(&base, &repo).await.unwrap().is_empty());

        // 添加 → 服务就绪、工具可发现。
        admin_add_service_with_base(&base, &repo, &echo_input(&script))
            .await
            .unwrap();
        let services = admin_list_services_with_base(&base, &repo).await.unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].name, "echo");
        assert_eq!(services[0].transport, "stdio");
        assert_eq!(services[0].phase, "running", "{services:?}");
        let tools = admin_list_tools_with_base(&base, &repo).await.unwrap();
        assert!(
            tools
                .tools
                .iter()
                .any(|tool| tool.exposed_name == "mcp__echo__echo"),
            "{:?}",
            tools.tools
        );

        // 断开 → stopped；重连 → running。
        let status = admin_disconnect_service_with_base(&base, &repo, "echo")
            .await
            .unwrap();
        assert_eq!(status.phase, "stopped", "{status:?}");
        let status = admin_connect_service_with_base(&base, &repo, "echo")
            .await
            .unwrap();
        assert_eq!(status.phase, "running", "{status:?}");

        // 移除 → 列表清空；再移除报不存在。
        admin_remove_service_with_base(&base, &repo, "echo")
            .await
            .unwrap();
        assert!(admin_list_services_with_base(&base, &repo).await.unwrap().is_empty());
        assert!(admin_remove_service_with_base(&base, &repo, "echo").await.is_err());

        // authenticate 显式不支持。
        assert!(admin_authenticate_service_with_base(&base, &repo, "echo").await.is_err());

        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_file(&script);
    }
}

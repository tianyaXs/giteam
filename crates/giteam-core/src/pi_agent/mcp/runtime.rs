//! 仓库级 MCP 运行时：每仓库一个 `MCPStore`（memory 后端 + 独立配置文件），
//! 启动时连接服务、发现工具并生成不可变快照供 Pi ToolRegistry 注册。
//!
//! 隔离：配置路径 `~/.giteam/mcp/repos/{repo-key}/mcpstore.json`，仓库间互不泄漏。
//! 会话规则：快照在 `PiAgentService::create_session` 的异步边界内生成；
//! 配置变化只对新会话生效，`ManagedSession` 不做热更新。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use mcpstore::{InstanceId, JsonStoreConfig, MCPStore, ScopeContext, StoreOptions};

use super::config::McpServiceInput;
use super::naming::qualified_name;
use super::McpError;

/// 连接单个 MCP 服务并完成工具发现的等待上限。
const SERVICE_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

/// Pi 可见的 MCP 工具快照。调用时用 `instance_id + tool_name` 定位真实工具，
/// 不依赖 `exposed_name` 反查。
#[derive(Debug, Clone)]
pub struct McpToolSpec {
    pub exposed_name: String,
    pub instance_id: InstanceId,
    pub service_name: String,
    pub tool_name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// 仓库级 MCP 运行时句柄。
pub struct McpRuntime {
    pub store: Arc<MCPStore>,
    pub config_path: PathBuf,
    pub tools: Arc<Vec<McpToolSpec>>,
    /// 连接失败的服务及原因（不影响其余服务与会话创建），供 UI 展示。
    pub service_errors: Vec<(String, String)>,
}

/// `~/.giteam/mcp/repos/{repo-key}/mcpstore.json`。
#[must_use]
pub fn repo_config_path(repo_path: &Path) -> Option<PathBuf> {
    super::super::secrets::default_data_dir().map(|base| mcp_config_path_in(&base, repo_path))
}

/// 在指定数据根下解析仓库 MCP 配置路径（测试用）。
#[must_use]
pub fn mcp_config_path_in(base: &Path, repo_path: &Path) -> PathBuf {
    base.join("mcp")
        .join("repos")
        .join(super::super::secrets::repo_sessions_key(repo_path))
        .join("mcpstore.json")
}

/// 为仓库加载 MCP 运行时：建 store、连接已配置服务、生成工具快照。
///
/// 无配置文件/空配置时返回空快照的 runtime，不报错。
pub async fn load_for_repo(repo_path: &Path) -> Result<Arc<McpRuntime>, McpError> {
    let base = super::super::secrets::default_data_dir()
        .ok_or(McpError::NoHomeDir)?;
    load_with_base(&base, repo_path).await
}

/// 同 [`load_for_repo`]，但允许指定数据根（隔离测试用）。
pub async fn load_with_base(base: &Path, repo_path: &Path) -> Result<Arc<McpRuntime>, McpError> {
    let config_path = mcp_config_path_in(base, repo_path);
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let store = MCPStore::setup_with_options(StoreOptions {
        config_path: Some(config_path.to_string_lossy().into_owned()),
        store: Some(JsonStoreConfig::memory()),
        ..StoreOptions::default()
    })?;
    let scope = store.for_store();
    let (tools, service_errors) = discover(&scope).await;
    Ok(Arc::new(McpRuntime {
        store,
        config_path,
        tools: Arc::new(tools),
        service_errors,
    }))
}

/// 重新发现工具（服务增删/重连后调用），返回新快照。调用方负责替换 runtime.tools。
pub async fn refresh_tools(runtime: &McpRuntime) -> Result<Vec<McpToolSpec>, McpError> {
    let scope = runtime.store.for_store();
    let (tools, _errors) = discover(&scope).await;
    Ok(tools)
}

/// 连接 scope 内全部服务并收集工具；单个服务失败记入 errors，不中断。
async fn discover(scope: &ScopeContext) -> (Vec<McpToolSpec>, Vec<(String, String)>) {
    let mut service_errors = Vec::new();
    for service in scope.list_services().await.unwrap_or_default() {
        let name = service
            .info()
            .await
            .ok()
            .and_then(|info| {
                info.get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "<unknown>".to_string());
        if let Err(error) = service.wait_service(SERVICE_CONNECT_TIMEOUT).await {
            service_errors.push((name, error.to_string()));
        }
    }
    let tools = match scope.list_tools().await {
        Ok(tools) => tools,
        Err(_) => return (Vec::new(), service_errors),
    };
    let mut specs = Vec::with_capacity(tools.len());
    for tool in tools {
        let Ok(entry) = tool.info().await else {
            continue;
        };
        specs.push(McpToolSpec {
            exposed_name: qualified_name(&entry.service_name, &entry.tool_name),
            instance_id: entry.instance_id,
            service_name: entry.service_name,
            tool_name: entry.tool_name,
            description: entry.description,
            input_schema: entry.input_schema,
        });
    }
    match build_specs(specs) {
        Ok(specs) => (specs, service_errors),
        // 工具名冲突属于配置错误：按文档要求显式失败，不静默覆盖。
        Err(error) => (Vec::new(), vec![("<all>".to_string(), error.to_string())]),
    }
}

/// 校验暴露名无冲突（同名服务的同名工具理论上不可能，跨服务清洗后撞名可能）。
fn build_specs(specs: Vec<McpToolSpec>) -> Result<Vec<McpToolSpec>, McpError> {
    let mut seen = std::collections::HashSet::with_capacity(specs.len());
    for spec in &specs {
        if !seen.insert(spec.exposed_name.clone()) {
            return Err(McpError::NameCollision {
                service: spec.service_name.clone(),
                tool: spec.tool_name.clone(),
            });
        }
    }
    Ok(specs)
}

/// 添加服务（持久化到 mcpstore.json 并触发连接）。`enabled == false` 的输入
/// 由调用方直接 remove，不会走到这里。
pub async fn add_service(runtime: &McpRuntime, input: &McpServiceInput) -> Result<(), McpError> {
    if !input.enabled {
        return Err(McpError::InvalidConfig(format!(
            "服务 {} 为 disabled，应调用 remove_service 而不是 add_service",
            input.name
        )));
    }
    let server_config = input.to_server_config()?;
    let scope = runtime.store.for_store();
    scope
        .add_service(mcpstore::McpConfig {
            mcp_servers: std::collections::HashMap::from([(
                input.name.trim().to_string(),
                server_config,
            )]),
        })
        .await?;
    Ok(())
}

/// 移除服务（持久化到 mcpstore.json）。
pub async fn remove_service(runtime: &McpRuntime, name: &str) -> Result<bool, McpError> {
    let scope = runtime.store.for_store();
    Ok(scope
        .remove_service(mcpstore::ServiceTarget::ServiceName(name))
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base(label: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "giteam-mcp-{}-{label}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos())
        ));
        let _ = fs::remove_dir_all(&base);
        base
    }

    #[test]
    fn config_paths_are_isolated_per_repo() {
        let base = PathBuf::from("/tmp/giteam-mcp-test");
        let a = mcp_config_path_in(&base, Path::new("/Volumes/work/repo-a"));
        let b = mcp_config_path_in(&base, Path::new("/Volumes/work/repo-b"));
        assert_ne!(a, b);
        assert!(a.starts_with(&base.join("mcp/repos")));
        assert!(a.ends_with("mcpstore.json"));
    }

    #[tokio::test]
    async fn empty_config_yields_empty_runtime() {
        let base = temp_base("empty");
        let runtime = load_with_base(&base, Path::new("/tmp/repo-empty")).await.unwrap();
        assert!(runtime.tools.is_empty());
        assert!(runtime.service_errors.is_empty());
        // 配置文件由 mcpstore 惰性落盘（首次写入时创建），此处只需父目录就绪。
        assert!(runtime.config_path.parent().unwrap().exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn two_repos_do_not_share_services() {
        let base = temp_base("iso");
        let repo_a = Path::new("/tmp/iso-repo-a");
        let repo_b = Path::new("/tmp/iso-repo-b");
        let runtime_a = load_with_base(&base, repo_a).await.unwrap();
        // 写入一条无法连接的服务（坏命令）验证配置落盘只影响 repo-a。
        let bad = McpServiceInput {
            name: "broken".into(),
            enabled: true,
            url: None,
            command: Some("/nonexistent/giteam-mcp-test-bin".into()),
            args: Vec::new(),
            env: Default::default(),
            headers: Default::default(),
            description: None,
        };
        add_service(&runtime_a, &bad).await.unwrap();
        let runtime_b = load_with_base(&base, repo_b).await.unwrap();
        assert!(runtime_b.tools.is_empty());
        assert!(runtime_b
            .service_errors
            .iter()
            .all(|(name, _)| name != "broken"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn build_specs_rejects_duplicate_exposed_names() {
        let spec = |service: &str, tool: &str| {
            let instance_id = InstanceId::from_key(&mcpstore::ServiceInstanceKey::new(
                service,
                mcpstore::ScopeRef::Store,
            ));
            McpToolSpec {
                exposed_name: qualified_name(service, tool),
                instance_id,
                service_name: service.to_string(),
                tool_name: tool.to_string(),
                description: String::new(),
                input_schema: serde_json::json!({}),
            }
        };
        let specs = vec![
            spec("my srv", "list"),
            spec("my-srv", "list"), // 清洗后撞名
        ];
        assert!(build_specs(specs).is_err());
    }
}

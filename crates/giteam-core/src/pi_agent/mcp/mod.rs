//! Pi Agent 的 MCP 子系统（基于 `mcpstore` crate，2.0.9+ light）。
//!
//! - `config`：Giteam 服务输入模型 → `mcpstore::ServerConfig` 唯一适配层；
//! - `naming`：`mcp__{service}__{tool}` 暴露名与冲突检测；
//! - `runtime`：仓库级 store、服务连接与工具快照（`load_for_repo` / `refresh_tools`）；
//! - `admin`：管理面（`agent_mcp_*` RPC 核心），带每仓库 runtime 缓存。
//!
//! 决策记录见 `docs/待办事项-未完成-0805_14-mcpstore-integration.md`：
//! 正式运行时直接集成 crate；配置变化只对新会话生效，不做热插拔。

mod admin;
mod config;
mod naming;
mod runtime;

pub use admin::{
    admin_add_service, admin_authenticate_service, admin_connect_service, admin_disconnect_service,
    admin_list_services, admin_list_tools, admin_remove_service, McpMutationResult,
    McpServiceError, McpServiceStatus, McpToolInfo, McpToolsSnapshot,
};
pub use config::{parse_opencode_entry, McpServiceInput};
pub use runtime::{
    add_service, load_for_repo, load_with_base, refresh_tools, remove_service,
    repo_config_path, McpRuntime, McpToolSpec,
};

use thiserror::Error;

/// MCP 子系统错误。
#[derive(Debug, Error)]
pub enum McpError {
    #[error("IO 错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("mcpstore 错误：{0}")]
    Store(#[from] mcpstore::StoreError),
    #[error("MCP 工具名冲突（{service}/{tool}），请重命名服务或工具")]
    NameCollision { service: String, tool: String },
    #[error("MCP 服务配置无效：{0}")]
    InvalidConfig(String),
    #[error("无法确定用户主目录（~/.giteam）")]
    NoHomeDir,
}

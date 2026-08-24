# mcpstore 集成可行性与实施设计

> **唯一决策：正式运行时直接集成 `mcpstore` Rust crate；CLI 只用于冒烟测试和诊断；暂不引入 daemon/sidecar。**

## 目标

- 将 `mcpstore` 的 stdio、Streamable HTTP、OAuth、工具发现、调用、超时、进度和取消能力接入 Pi Agent。
- 保留 Giteam 现有的 `ApprovalTool` 审批闭环，并按仓库隔离 MCP 配置和服务状态。
- 先完成 core 到新会话的稳定链路，再恢复桌面 MCP UI；配置变化只对新建会话生效。

## 当前状态与可行性结论

当前 MCP 尚未完成：`apps/desktop/src/lib/featureFlags.ts` 中 `MCP_MODULE_ENABLED = false`，`RuntimeCapabilities::foundation()` 中 `mcp = false`，`pi_agent` 没有 MCP runtime 或 Tool wrapper。现有 `*_opencode_mcp_*` 命令只是读写 OpenCode 配置，不是 Pi 运行时工具注册。

`mcpstore` 1.5.18 已具备所需协议和生命周期能力。CLI 每次调用都要启动进程，且不同子命令的错误输出有时是文本、有时是 JSON；daemon 依赖 Unix socket，调用接口没有流式进度/取消，跨平台发布也不成立。因此二者都不作为主调用链。

首要阻塞是 `mcpstore` crate 依赖本机绝对路径：`openkeyv = { path = "/Volumes/data0/data4work/2026_4/openkeyv/..." }`。必须先改成可移植的 git/version/workspace 依赖，并固定 revision。Giteam 使用 `reqwest 0.12`，`mcpstore` 使用 `0.13`，会产生重复依赖；首阶段使用 `default-features = false, features = ["light"]`，后端固定 memory，避免引入 redis/memcached/valkey。

## 目标架构

```text
桌面 MCP 面板 ── Tauri RPC ──┐
                              ▼
repo MCP Runtime ── Arc<MCPStore> ── stdio/HTTP/OAuth MCP 服务
       │              │
       │              └─ list_tools / start_tool_execution
       ▼
McpToolSpec 快照 ── GiteamToolFactory ── Pi ToolRegistry
                                             │
                                             ▼
                                      ApprovalTool → MCP 服务
```

## 详细设计

### 1. 依赖与配置隔离

在 `crates/giteam-core/Cargo.toml` 增加固定 revision 的 `mcpstore` 依赖，关闭默认 feature。禁止正式提交继续使用本机 path 依赖。每个仓库使用独立配置路径：

```text
~/.giteam/mcp/repos/{repo-key}/mcpstore.json
```

在 `crates/giteam-core/src/pi_agent/mcp/config.rs` 实现唯一适配层，将现有 OpenCode/Marketplace 形状转换为 `mcpstore::ServerConfig`：

```text
local  { type, command: [program, ...args], environment }
  →    { command: program, args, env: environment, transport: "stdio" }
remote { type, url, headers }
  →    { url, headers, transport: "streamable-http" }
```

`enabled` 只控制服务是否连接/暴露，不写入 `ServerConfig.extra`。前端不再负责运行时格式转换。

### 2. Runtime 与工具快照

新增 `crates/giteam-core/src/pi_agent/mcp/{mod.rs,config.rs,runtime.rs,naming.rs}`：

```rust
pub struct McpToolSpec {
    pub exposed_name: String,
    pub instance_id: mcpstore::InstanceId,
    pub service_name: String,
    pub tool_name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

pub struct McpRuntime {
    pub store: std::sync::Arc<mcpstore::MCPStore>,
    pub scope: mcpstore::ScopeContext,
    pub config_path: std::path::PathBuf,
    pub tools: std::sync::Arc<Vec<McpToolSpec>>,
}

pub async fn load_for_repo(repo_path: &std::path::Path) -> Result<std::sync::Arc<McpRuntime>, McpError>;
pub async fn refresh_tools(runtime: &McpRuntime) -> Result<Vec<McpToolSpec>, McpError>;
```

`load_for_repo` 使用 `MCPStore::setup_with_options(StoreOptions { config_path, backend: memory, .. })`，取得 `Arc<MCPStore>` 后通过 `SessionBuilder::for_store()` 或 `for_agent(repo_key)` 建立 scope；调用 `ScopeContext::list_services()`、`list_tools()` 生成不可变快照。服务连接和工具发现发生在 `PiAgentService::create_session` 的异步边界内，不能塞进同步的 `ToolFactory::create_tool_registry`。

工具名统一为 `mcp__{sanitized_service_name}__{sanitized_tool_name}`。冲突时直接返回配置错误，不静默覆盖；快照始终保留真实 `instance_id + tool_name`，调用不依赖展示名反查。

### 3. Pi Tool 包装与审批

新增 `crates/giteam-core/src/pi_agent/tools/mcp.rs`，实现 `pi::sdk::Tool`：

```rust
pub struct McpTool {
    pub spec: McpToolSpec,
    pub runtime: std::sync::Arc<McpRuntime>,
    pub timeout: std::time::Duration,
}
```

`name/label/description/parameters` 分别来自限定名、服务名/工具名、MCP description 和 `input_schema`。`execute` 先调用 `start_tool_execution(instance_id, tool_name, input, McpExecutionOptions)`，循环消费 `next_update()`：`Progress` 转为 Pi `ToolUpdate`，`Finished` 转为 `ToolOutput`。MCP content block 序列化为文本或 JSON；`is_error` 映射为错误输出而不是 panic。

扩展 `GiteamToolFactory` 增加 `mcp_tools: Arc<Vec<McpToolSpec>>`，在同步创建 registry 时注册 `McpTool`，并与其他写/执行工具一样套 `ApprovalTool`。首阶段未知 MCP 工具默认需要审批；不根据 MCP annotations 自动降级为只读。拒批、参数校验失败、服务断开和超时都返回可读的工具错误。

Pi abort 不能只停 Pi future：MCP wrapper 必须在 abort/任务取消时调用 `McpStoreToolExecutionHandle::cancel(reason)`。`PiAgentService::abort` 与 wrapper 使用同一运行上下文，确保 UI 中止后远端请求也被取消。

### 4. 会话和热更新规则

在 `crates/giteam-core/src/pi_agent/service.rs` 的 `create_session` 中按顺序执行：

1. 取得 repo runtime；
2. 加载配置、连接已启用服务、发现工具；
3. 生成 `Arc<Vec<McpToolSpec>>`；
4. 将快照传给 `sdk_options_with_factory`；
5. 创建 Pi session。

当前 `ManagedSession` 没有 registry 更新接口，因此服务增删、工具变更只对新 session 生效。RPC 返回 `requiresNewSession: true`，UI 明示“重建会话后生效”，不设计未知的热更新机制。

### 5. Tauri/RPC 迁移

新增 `agent_mcp_*` 命令，统一返回结构化结果：

| 现状 | 目标 |
|---|---|
| `list_opencode_mcp_status` | `agent_mcp_list_services` + `agent_mcp_list_tools` |
| `add_opencode_mcp_server` | `agent_mcp_add_service` |
| `connect_opencode_mcp_server` | `agent_mcp_connect_service` |
| `disconnect_opencode_mcp_server` | `agent_mcp_disconnect_service` |
| `authenticate_opencode_mcp_server` | `agent_mcp_authenticate_service` |
| `delete_opencode_mcp_server` | `agent_mcp_remove_service` |

后端命令直接调用 `McpRuntime`，不再写 `opencode.jsonc`。旧命令先保留但从 MCP UI 脱钩；所有新命令错误均返回 `{ code, message, details }`，避免 CLI 当前不一致的 stderr 契约。

### 6. 前端恢复

确认真实 RPC 和 agent tool 清单可用后，再修改：

- `apps/desktop/src/lib/featureFlags.ts`：开启 `MCP_MODULE_ENABLED`；
- `apps/desktop/src/App.tsx`：将 `*_opencode_mcp_*` 调用替换为 `agent_mcp_*`；
- `apps/desktop/src/lib/agentMcpConfig.ts`：保留表单模型，删除运行时格式转换；
- `apps/desktop/src/components/agent/AgentMcpPanels.tsx`：展示服务状态、工具、认证和错误；
- `crates/giteam-core/src/pi_agent/types.rs`：仅在完整链路通过测试后将 capability `mcp` 置为 `true`。

## 删除清单

- `crates/giteam-core/src/opencode.rs`：删除或迁移 `*_opencode_mcp_*` 的运行时路径；配置适配逻辑移入 `pi_agent/mcp/config.rs`。
- `crates/giteam-core/src/desktop_rpc.rs`：删除旧 MCP 命令分支，待 UI 迁移验证后执行。
- `apps/desktop/src/App.tsx`：删除 OpenCode MCP 的 invoke 和下线注释。
- `apps/desktop/src/lib/agentMcpConfig.ts`：删除仅服务于 OpenCode JSONC 的字段转换；保留表单类型和校验。
- 不删除 `AGENTS.md`、现有 MCP UI 组件或 `mcpstore` 工作区用户改动；这些不属于本次实现。

## 测试矩阵

1. **依赖构建**：macOS arm64、macOS x64、Linux GNU、Windows x64 MSVC 编译；验证没有绝对路径。
2. **配置**：stdio 参数映射、HTTP URL/headers、enabled 状态、缺少 command/url、重复服务名。
3. **发现**：空服务、服务重启、同名工具冲突、服务不可用时错误可见。
4. **调用**：JSON Schema 原样注册、文本/图片/JSON content block、MCP error、idle/max-total timeout。
5. **交互**：审批通过、审批拒绝、Pi abort 后 MCP cancel、progress 到 `ToolUpdate` 的映射。
6. **隔离**：两个 repo 的配置、服务、工具列表互不泄漏。
7. **桌面回归**：新增/连接/断开/认证/删除、重建会话提示、feature capability 状态一致。

## 执行顺序

1. 在 `mcpstore` 修复 `openkeyv` 可移植依赖并固定 revision；先通过三平台 `cargo check`。
2. 在 Giteam 加 crate 依赖和 `pi_agent/mcp` 配置、命名、runtime；写配置/隔离/发现测试。
3. 增加 `McpTool`、扩展 `GiteamToolFactory`，完成审批、结果、progress、cancel；运行 Rust 和 Pi 会话回归。
4. 增加 `agent_mcp_*` RPC，端到端验证后再切换前端。
5. 开启 feature/capability，执行三平台打包、OAuth、崩溃重启和 abort 验证。
6. 最后删除旧 OpenCode MCP 运行时路径，保留必要的迁移读取逻辑。

## 不在此次范围

- 不把 CLI 作为每次 Agent 工具调用的进程边界。
- 不采用当前 Unix socket daemon 作为跨平台 sidecar。
- 不实现已有 session 的工具热插拔。
- 不引入 Redis 或其他远程 cache backend。
- 不同时重构 Pi Agent 的非 MCP 工具、审批协议或 Marketplace 业务。

## 交付判断

在完成第 1 步前，Rust crate 方案只能判定为“架构可行、发布不可行”；完成依赖修复后，核心集成预计约 **8–12 个工程日**，OAuth、UI 和三平台发布验证预计总计 **12–18 个工程日**。因此可以外包给 `mcpstore` 项目承担底层 MCP，但 Giteam 仍需自己实现 Pi Tool、审批、会话和 Tauri UI 适配层，不能只替换一个 CLI 命令。

# ADR-0001: 使用 Pi SDK 作为唯一 Agent 运行时

**Date**: 2026-07-27  
**Status**: accepted  
**Deciders**: Giteam maintainers

## Context

Giteam 当前由 OpenCode 本地服务承担会话、流式事件、Provider、工具、权限、Question、Skills 和 MCP 等 Agent 能力，Desktop、CLI 和 Control Server 都直接依赖其进程或 HTTP/SSE 协议。项目决定重构底层实现并以 `pi_agent_rust` 的 `pi::sdk` 为基础，在 macOS、Windows 和 Ubuntu 上实现现有全部功能。

这项工作不是增加另一个可选后端，也不是用兼容层长期保留 OpenCode。Pi SDK 当前仍有工具链、传递依赖、异步运行时、Permission/Question/MCP 非同构等集成风险，但这些风险必须通过 Giteam 扩展、Pi 上游修改或受控 fork 解决。

## Decision

Giteam 使用进程内 `pi::sdk` 作为唯一生产 Agent 运行时。所有 Agent 请求进入 `PiAgentService`，由 Pi Session、Event、ModelRegistry、ToolFactory 和 Abort API 完成；Pi 缺少的 Permission、Question、MCP、会话索引和多端事件能力在 Giteam 内围绕 Pi SDK 补齐。

最终版本删除 OpenCode 进程、HTTP/SSE、端口、命令、配置和运行时路由。OpenCode 代码只能在重构期间作为行为参考，OpenCode 数据只能作为一次性离线迁移输入。

初始 Spike 固定到上游 commit `b27abd576cc0d2f39e2eef8f87f7897edec53b4f`，而不是只使用 crates.io 的 `0.1.22` 版本号；该 commit 在 `nightly-2026-07-05` 下已通过当前 macOS 的进程内编译检查。跨平台验证完成前，该 commit 仍属于集成基线，不代表最终发布版本。

## Alternatives Considered

### Pi Rust SDK vs Pi TypeScript/React 兼容性结论

Pi 生态目前有两条实现线：

- Rust `pi_agent_rust` 的 `pi::sdk`；
- TypeScript `pi-mono` 的 `@mariozechner/pi-agent-core`、`@mariozechner/pi-coding-agent`、`@mariozechner/pi-ai` 和 `@mariozechner/pi-web-ui`。

`pi-mono` 当前没有官方 React SDK；`pi-web-ui` 是基于 `mini-lit` 的 Web Components，`pi-agent-core` 是无 UI 的 TypeScript Agent 核心。它们可以被 React 包装或调用，但不是 React Native/Tauri 原生运行时。

对 Giteam 的整体兼容性评估如下：

| 维度 | Rust `pi::sdk` | TypeScript Pi / Web UI |
|---|---:|---:|
| 接入现有 Rust `giteam-core` | 高 | 低，需要 Node sidecar/IPC |
| 接入 Tauri Desktop 生命周期 | 高 | 中低，WebView 不能直接使用 Node API |
| 复用 Control Server、CLI、Mobile 后端 | 高 | 低，需要额外 Node 服务和协议 |
| Windows/macOS/Ubuntu 原生工具执行 | 高 | 中，需要 Node/sidecar 分发和进程管理 |
| 当前 React UI 的直接复用 | 高，通过 Giteam API | 中高，但 `pi-web-ui` 不是 React 组件且会带入另一套状态/存储 |
| 会话、扩展、CLI 行为参考完整度 | 中高，需在 Rust SDK 上补 Giteam 功能 | 高，但 coding-agent 依赖 Node/fs/child_process |
| 与 Giteam 单一底层目标的一致性 | 高 | 低 |

综合兼容性最高的是 Rust `pi::sdk` 进程内集成。React 版本只作为 Pi 行为和交互设计参考，Giteam 继续使用自己的 React UI，不引入 `pi-web-ui` 作为第二套 UI 运行时。

### Alternative 1: OpenCode 与 Pi 双运行时

- **Pros**: 可以灰度切换，短期回退成本低。
- **Cons**: 长期保留两套会话、配置、事件和工具协议，显著增加维护与测试矩阵。
- **Why not**: 与产品彻底基于 Pi SDK 重构、停止支持 OpenCode 的目标冲突。

### Alternative 2: 使用 `pi --mode rpc` 子进程作为产品运行时

- **Pros**: 进程隔离更强，Tauri 主进程依赖较少。
- **Cons**: 需要额外二进制分发、签名和进程管理，自定义 ToolFactory 与实时事件集成更复杂。
- **Why not**: 产品要求直接基于 Pi SDK 重构；RPC 不得被用来回避进程内 SDK 的集成工作。它仅可用于技术诊断，不属于产品架构。

### Alternative 3: 保持 OpenCode，仅替换部分模型调用

- **Pros**: 改动范围小。
- **Cons**: OpenCode 仍控制核心协议和生命周期，无法实现真正的 Pi SDK 底层重构。
- **Why not**: 不满足目标。

## Consequences

### Positive

- 产品只有一套 Agent 运行时、会话模型和工具扩展边界。
- Desktop、CLI、Mobile/Web 通过统一的 Giteam Agent 协议使用 Pi 能力。
- 可以直接利用 Pi 的 typed events、ModelRegistry、ToolFactory 和取消机制。
- OpenCode 服务进程、端口和 HTTP/SSE 依赖最终全部移除。

### Negative

- 迁移期间必须一次性补齐现有全部能力，不能依赖 OpenCode fallback。
- Pi SDK 的工具链和 0.x API 变化会直接影响 Giteam 构建。
- Permission、Question、MCP、多会话管理和跨端事件需要 Giteam 自行实现。
- macOS、Windows、Ubuntu 都需要真实环境构建和功能验收。

### Risks

- **工具链不兼容**：精确锁定 Pi 版本、Rust toolchain 和传递依赖，并在三平台 CI 验证。
- **异步运行时冲突**：通过隔离 Spike 验证 Tauri 与 Pi/asupersync 的 Future、取消和 drop 语义；必要时修复 Pi 或维护 fork。
- **功能缺口**：用功能等价矩阵和逐项验收测试约束，不允许静默降级。
- **密钥或数据风险**：使用平台 secret store、原子迁移和脱敏测试。
- **平台差异**：在 macOS、Windows、Ubuntu 原生环境测试 Session、Tool、MCP、Abort、安装和升级。

## Compliance Rules

后续实现必须遵守：

1. 不新增 OpenCode runtime、Adapter、fallback 或兼容路由。
2. 不把 `pi --mode rpc` 作为产品运行时。
3. 不把 Pi SDK 类型直接暴露给前端或外部 API。
4. Pi SDK 缺口通过 Giteam 扩展、上游贡献或受控 fork 解决。
5. 任一目标平台未通过核心功能验收时，不得宣布迁移完成。

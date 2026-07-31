# Pi SDK Spike 工作记录

**日期：** 2026-07-27  
**范围：** `crates/pi-sdk-spike` 与 `giteam-core` 的第一阶段接入

## 验证环境

- macOS arm64
- 当前稳定工具链：`rustc 1.93.1`
- Pi 上游工具链：`nightly-2026-07-05`，实际 rustc `1.98.0-nightly`
- Pi 上游当前 main：`b27abd576cc0d2f39e2eef8f87f7897edec53b4f`

## 结果

| 组合 | 结果 | 说明 |
|---|---|---|
| stable 1.93.1 + crates.io `pi_agent_rust = 0.1.22` | 失败 | `sysinfo 0.39.6` 要求 Rust 1.95 |
| nightly-2026-07-05 + crates.io `0.1.22` | 失败 | 上游发布包出现多处 `Future + Send` 错误，涉及 `acp.rs`、`rpc.rs`、`interactive/**` |
| nightly-2026-07-05 + git `b27abd5...` + `default-features = false` | 通过 | `cargo check` 通过 |
| nightly-2026-07-05 + git `b27abd5...` 运行编译期检查 | 通过 | Spike 启动并输出 compiled successfully |
| 上游仓库 `b27abd5...` `cargo check --lib --locked` | 通过 | 上游自身源码和 lockfile 可构建 |

## 当前决策

暂以 Pi 上游 commit `b27abd576cc0d2f39e2eef8f87f7897edec53b4f` 作为集成基线，使用 `nightly-2026-07-05`，继续验证 Tauri、Windows 和 Ubuntu。

这不是永久接受 crates.io `0.1.22`；发布来源必须保持源码、lockfile 和 API 的可复现性。若后续使用 crates.io，需要先确认其发布内容与已验证上游 commit 等价。

生产 `giteam-core` 接入时还发现 SQLite native link 冲突：Pi 的 `sqlmodel-sqlite 0.2.2` 使用 `libsqlite3-sys 0.37`，Giteam 原 `rusqlite 0.32` 使用 `libsqlite3-sys 0.30.1`。已选择把 Giteam `rusqlite` 升级到 `0.39`，使两侧统一使用 `libsqlite3-sys 0.37`。

## 第一阶段生产接入

已加入根目录 `rust-toolchain.toml`，统一使用 `nightly-2026-07-05`，并将 Pi git revision、`futures` 和 `thiserror` 接入 `giteam-core`。新增 `giteam_core::pi_agent`，目前包含：

- `PiAgentService`：进程内创建/保存/查询/列表/消息读取 Pi Session、单 Session 并发互斥、Prompt、Abort 和删除保护；
- `PiSessionConfig`：跨平台工作目录、Session 目录、Provider/Model、工具白名单、扩展路径配置；
- `PiEventTranslator`：将 Pi 生命周期、文本/思考流、工具执行、重试、压缩和扩展错误归一为 Giteam 事件；
- provider-neutral `AgentMessage` / `AgentPart`，覆盖文本、思考、图片、工具调用、工具结果和自定义消息；
- 事件 envelope 的 schema version、单调 sequence、repo/session/run 关联信息。
- Desktop Tauri 已注册 `pi_runtime_info`、Session CRUD/消息查询、`pi_prompt`、`pi_abort` 新命令；事件通过 `giteam://agent-event` 发出，且不再在启动阶段 warmup OpenCode 服务。

已验证：

- `cargo test --manifest-path crates/giteam-core/Cargo.toml`：19 tests passed（7 core unit + 5 domain contract + 7 service contract）；
- `cargo check --manifest-path crates/giteam-core/Cargo.toml`：通过；
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：通过；
- `cargo check --manifest-path apps/cli/Cargo.toml`：通过。
- 前端 `node node_modules/typescript/bin/tsc -p tsconfig.json`：通过；`npm run build` 的 Vite 阶段仍被本机 `lightningcss` Darwin arm64 optional native binary 损坏阻塞，非本轮 TypeScript 类型错误。

上述验证只证明 SDK 依赖图和第一阶段服务层可构建，尚不代表 Desktop/Control/CLI 主聊天路径已切换。下一阶段必须把 command/RPC/SSE 接入 `PiAgentService`，再迁移 Provider、Permission、Question、Skills、Extensions 和 MCP。

## 未完成项

- [ ] Tauri 实际依赖图构建
- [ ] Windows 原生构建和 Prompt/Tool/Abort
- [ ] Ubuntu x64/arm64 构建和 Prompt/Tool/Abort
- [ ] 真实 Provider Prompt
- [ ] ToolFactory、Session persistence、Question、Permission 和 MCP 集成
- [ ] release build 体积、冷启动、内存和长时间 soak 测量

## 本轮推进：稳定客户端与退出清理

- 新增 `/Users/tianya/Documents/project/giteam/apps/desktop/src/lib/agent/client.ts`，定义不泄漏 Pi/OpenCode 类型的 Giteam Agent 客户端协议；桌面 Tauri 和 Control Server 共用同一组 Session、Prompt、Abort、消息和事件订阅接口。
- Desktop Tauri/RPC 的新入口已统一命名为 `agent_*`，React 不再依赖 `pi_*` command 名称；Pi 只存在于 Rust service 实现层。
- Control 客户端使用带鉴权的 fetch + SSE reader，桌面客户端监听 `giteam://agent-event`；两者都按 `sessionId/runId` 过滤事件，避免跨 Session 串流。
- `PiAgentService::shutdown()` 已接入 Desktop Tauri `RunEvent::Exit`，退出时依次 abort active runs、清理事件订阅并释放 session handles；新增幂等性测试。
- CLI Control/Web 服务的生命周期已停止调用 OpenCode warmup/shutdown，改为触碰和清理同一个进程内 `PiAgentService`；Provider 配置向导仍属于后续 PR5 迁移范围。
- Core 全量测试首轮通过：6 个单元测试、5 个领域契约测试、7 个 Service 契约测试。

仍需注意：前端主聊天尚未接线到该客户端，旧 OpenCode 路径仍处于迁移期间；本轮没有恢复或修改用户已有的 `apps/mobile/.expo/**` 删除状态。

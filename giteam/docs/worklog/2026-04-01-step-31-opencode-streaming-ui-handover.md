# Step 31: OpenCode 流式渲染与交互改造交接

Date: 2026-04-01
Owner: Codex

## 目标与范围

本轮目标是把右侧 Agent 面板的流式渲染、过程层级、交互形态尽量贴近 OpenCode 官方前端体验，重点包括：

- 流结束后页面仍等待的问题
- 过程内容（Think / 工具执行 / 正文回复）层级混杂
- 多会话发送互相阻塞
- 缺少运行中止
- 输入区与等待态视觉不自然

## 核心决策（已落地）

1. 前端直连 OpenCode 服务端 SSE（不再走 Rust 二次过滤流）
- 前端通过 `get_opencode_service_base` 获取 base。
- 直接请求：
  - `GET /global/event?directory=...`
  - `POST /session/{id}/prompt_async?directory=...`
- Rust 层保留为「服务发现/启动与配置读写」，不再承担主渲染事件拼装。

2. 按 session 维度管理运行状态
- 新增 per-session busy/streaming 映射，修复“会话 A 在跑时会话 B 不能发消息”的问题。

3. 增加主动终止
- 前端 Stop 按钮会：
  - 取消本地 AbortController
  - 调 `POST /session/{id}/abort`

4. 渲染模型改为事件驱动 part 时间线
- 处理 `message.part.delta / updated / removed` 做实时渲染。
- 结束后再做一次 detailed hydrate 对齐。

5. Think 卡片线性化与防覆盖
- 对 reasoning 重写场景增加快照保留，避免新 plan 覆盖旧 plan。
- 流式时仅展开最新 think，旧 think 自动折叠，保持时间线可读性。

## 本轮关键接口核验（实际 curl）

1. SSE 连通性
- `GET /global/event` 可收到 `server.connected`。

2. 对用户给定 session 的 prompt_async 验证
- 调用后收到 `session.error` 且错误为 `NotFoundError`。
- 结论：该 session 在当时服务端已失效，后续联调需使用当前有效 session id。

## 主要代码变更

### 前端渲染与交互
- `apps/desktop/src/App.tsx`
  - 直连 SSE 的 prompt 流程与帧解析
  - per-session busy/streaming 状态
  - Stop 逻辑与 abort 接口调用
  - part timeline 分组渲染（text/reasoning/tool/context）
  - task 子会话跳转
  - reasoning 快照保留与“仅最新展开”策略
  - 移除输入区提示文案、移除右下“当前模型”重复展示

- `apps/desktop/src/styles.css`
  - 输入区整体节奏重构（更大输入区、统一留白、弱化厚重边框）
  - 过程区改为轻量行式状态（状态点 + 行内信息）
  - 等待态“读取/写入”动态效果优化
  - 清理部分不再使用的旧样式块

### Rust 服务层
- `apps/desktop/src-tauri/src/commands/opencode.rs`
  - 关键行为确认：服务懒启动（`ensure_managed_service`）
  - `get_opencode_service_base` 会触发服务可用性保证

## UI 行为现状（接手者应知）

已完成：
- 主回复 / Think / 执行步骤层级已分离，不再全量日志混排。
- explore/task 可通过按钮进入子会话。
- 发送按钮支持 Run/Stop 切换。
- 多会话并发发送不再互锁。

仍建议继续打磨：
- 与 OpenCode 官方在某些动效细节上仍有差距（尤其“写入中”微动效与空闲过渡）。
- 可继续对齐 OpenCode `message-part` / `basic-tool` 的字号、间距、显隐时机。

## 验证命令

1. 前端构建
- `npm run -w apps/desktop build`

2. Rust 检查
- `cargo check -q`（目录：`apps/desktop/src-tauri`）

3. DMG 打包
- `npm run -w apps/desktop tauri:build -v`
- 注意：在受限环境下可能因 `hdiutil` 失败，需要提权执行。

## 打包产物（本轮）

- `apps/desktop/src-tauri/target/release/bundle/dmg/giteam_0.1.0_aarch64.dmg`
- `apps/desktop/src-tauri/target/release/bundle/macos/giteam.app`

## 下次接手建议顺序

1. 用有效 session 复测一轮完整事件序列（新建 session + prompt_async）。
2. 对照 `opencode/packages/ui/src/components/message-part.tsx` 微调等待态与过程行动效。
3. 针对“think 折叠时机”加轻量单测/快照测试，避免回归覆盖问题。
4. 清理剩余 debug-only 样式和未使用 helper，保持渲染路径单一。

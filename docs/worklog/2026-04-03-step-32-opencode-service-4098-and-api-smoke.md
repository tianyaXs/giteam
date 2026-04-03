# Step 32: OpenCode 服务固定端口 + 自动保存 + API 冒烟验证

## 背景与目标
- 将 OpenCode 本地服务从随机端口改为固定端口（默认 `4098`）。
- 服务配置仅保留端口，不暴露地址配置。
- Settings 中端口改动后，关闭弹窗自动保存并重启服务（无 Save 按钮）。
- 应用启动后预热服务；应用退出时清理受管服务进程。
- 验证配置读取、会话、发消息、SSE 等关键服务端接口可访问。

## 实现摘要

### 1) Rust 服务管理改造
文件：`apps/desktop/src-tauri/src/commands/opencode.rs`
- 新增服务设置结构（仅端口）：
  - `OpencodeServiceSettings { port }`
- 默认端口：
  - `DEFAULT_OPENCODE_SERVICE_PORT = 4098`
- 服务启动改为固定监听：
  - `opencode serve --hostname 127.0.0.1 --port <port>`
- 新增命令：
  - `get_opencode_service_settings`
  - `set_opencode_service_settings`（保存后重启受管服务，可选 warmup）
- `get_opencode_service_base` 返回本地受管服务地址（`http://127.0.0.1:<port>`）。
- 增加进程清理与预热函数：
  - `shutdown_managed_opencode_service`
  - `warmup_managed_opencode_service`

### 2) Tauri 生命周期接入
文件：`apps/desktop/src-tauri/src/main.rs`
- `setup` 阶段后台预热 OpenCode 服务。
- `RunEvent::ExitRequested | RunEvent::Exit` 时清理受管服务进程。
- 注册新命令：
  - `get_opencode_service_settings`
  - `set_opencode_service_settings`

### 3) 前端设置交互改造
文件：`apps/desktop/src/App.tsx`
- `OpenCode API` 设置仅保留端口输入框。
- 去掉 Host/Public URL 字段。
- 去掉 `Save & Restart` 按钮。
- 关闭 Settings（点遮罩/Close）时：
  - 若端口无变化：直接关闭。
  - 若端口有变化：自动保存并重启服务，成功后关闭。
  - 保存失败：保留弹窗并提示错误。
- 去掉“`Current port: 4098`”展示，仅在有改动时显示 `Will save on close`。

## 接口冒烟验证（本机 4098）
> 说明：在当前执行环境中，本地回环请求需要提权后验证。

已验证通过的接口：
- `GET /project/current` -> `HTTP 200`
- `POST /session` -> 成功返回 `session id`
- `GET /session/{id}/message` -> `HTTP 200`
- `POST /session/{id}/prompt_async` -> `HTTP 204`
- `GET /global/event`（SSE）-> 成功收到事件流（如 `server.connected`、`session.status`）

示例（节选）：
- `project/current`: 返回当前 worktree 与 session 元信息，`HTTP 200`
- `prompt_async`: 返回 `HTTP 204`
- `global/event`: 可持续接收 `data: { ... }` 事件

## 编译校验
- `cargo check -q` ✅
- `npm run -w apps/desktop build` ✅

## 当前行为说明
- 应用启动后会尝试预热 OpenCode 服务（默认 `127.0.0.1:4098`）。
- 前端会通过 `get_opencode_service_base` 取服务地址后进行配置读取、发消息、SSE 订阅。
- 应用退出会清理本应用受管的 OpenCode 子进程。

## 后续可选优化
- 增加端口占用冲突提示（如 `4098` 被其他程序占用时的专用 UI 提示）。
- 在设置页补充“服务重启中”状态条（当前仅文案与日志提示）。

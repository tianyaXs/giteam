# Giteam 项目面试介绍与亮点

## 1. 30 秒电梯演讲

> Giteam 是一个基于 OpenCode 的 AI 原生 Git 客户端，把大模型能力直接嵌入到代码仓库的工作流里。它支持桌面端（Tauri + React）、移动端（Expo + React Native）和 CLI，三者通过统一的 Control Server 协同。项目最大的特点是：以仓库为上下文中心，让 AI 会话、工作树（worktree）、技能和 MCP 工具都围绕同一个 Git 仓库运转。

## 2. 项目核心亮点

### 2.1 多平台统一架构

- **桌面端**：Tauri v2 + React 18 + Vite 5 + Tailwind CSS v4，原生性能与 Web 开发效率结合；
- **移动端**：Expo SDK 55 + React Native 0.83 + React 19，支持 iOS/Android，通过 LAN 扫描发现桌面端；
- **CLI**：Rust + `clap`，提供 `giteam serve` 等无头服务；
- **共享核心**：`giteam-core` Rust crate 被三个前端复用，避免逻辑重复。

### 2.2 以仓库为中心的 AI 会话

- 每个仓库绑定独立的 OpenCode 服务实例，`x-opencode-directory` 头保证会话和配置按仓库隔离；
- 会话、消息、文件附件的持久化以 OpenCode 为唯一真相源，Giteam 只代理和缓存；
- SSE `/global/event` 实时流式返回 assistant 响应，桌面端和移动端共用同一套事件协议。

### 2.3 Git 工作树（worktree）原生集成

- 直接用 Git 原生 `git worktree` 命令实现多分支并行开发；
- UI 支持一键创建、切换、删除工作树；
- Rust 端维护 `giteam-core` 的工作树模型和文件系统监听（`notify`），前端实时同步状态。

### 2.4 Skill + MCP 扩展生态

- 内置技能通过 Rust `include_str!` 嵌入二进制，安装时落地到 `.opencode/skills/`；
- 技能的 `giteam.json` 可声明 MCP 服务器，Giteam 自动将其同步到 `opencode.jsonc`；
- 支持从 SkillsMP 市场搜索安装技能，也支持自定义 MCP 配置。

### 2.5 手机端与桌面端发现/配对

- 不使用 mDNS/Bonjour，而是实现显式 IPv4 网段扫描（最多 8 worker、2.2s 硬停止）；
- 6 位配对码 + Bearer Token 认证，支持二维码扫码配对；
- Control Server 暴露统一 REST + SSE API，移动端可远程创建会话、发送 prompt、同步消息。

### 2.6 本地优先与数据安全

- OpenCode 服务跑在本地 `127.0.0.1:4098`，模型请求/API Key 不经过远程中间件；
- 本地仓库记录、会话元数据使用 `rusqlite`（bundled SQLite）持久化；
- 手机端用 MMKV 加密缓存认证信息和聊天快照。

## 3. 技术栈总览

| 层级 | 技术 |
|------|------|
| 桌面端壳 | Tauri v2（Rust） |
| 桌面 UI | React 18、Radix UI、Headless UI、shadcn/ui、Tailwind CSS v4 |
| 桌面构建 | Vite 5、TypeScript 5 |
| 编辑器/终端 | Monaco Editor、xterm.js |
| Markdown | streamdown、react-markdown、remark-gfm、KaTeX |
| 移动端 | Expo SDK 55、React Native 0.83、React 19 |
| 移动端动画/手势 | react-native-reanimated、react-native-worklets、react-native-gesture-handler |
| 移动端存储 | react-native-mmkv、@react-native-async-storage/async-storage |
| 共享后端 | `giteam-core` Rust crate |
| 数据库 | SQLite（rusqlite bundled） |
| HTTP 客户端 | reqwest（Rust）、fetch/React Native |
| CLI | clap（Rust） |
| 远程仓库服务 | Python FastAPI + Pydantic + Uvicorn |
| MCP 桥接 | Python 标准库脚本 |

## 4. 面试时可展开的技术难点

### 4.1 OpenCode 服务生命周期管理

**问题**：用户移动或删除仓库后，旧的 `opencode serve` 进程仍然占用端口并绑定到已不存在的当前工作目录，导致 MCP 工具（如 Remote Repo）找不到启动脚本。

**解决方案**：

- 在 `ManagedOpencodeService` 中增加 `repo_path` 字段，记录服务启动时的规范路径；
- 启动前检测现有进程，如果 `base` 或 `cwd` 不匹配则先杀掉旧进程；
- 通过 `find_service_pid()` 和进程环境变量/当前目录比对，确保服务始终从正确仓库启动；
- 核心逻辑在 `giteam-core` 实现，桌面端和 CLI 共享同一套行为。

**面试话术**：

> 我们遇到过一个很隐蔽的 bug：用户把项目目录丢进废纸篓后，Giteam 管理的 OpenCode 服务其实还绑在旧路径上。Remote Repo MCP 调用时去找旧的 launcher 路径就失败了。我的做法是给服务池增加 repo_path 追踪，并在启动时做 cwd 一致性校验，路径或端口不匹配就主动杀掉旧进程重启。这个改动同时写到了 `giteam-core` 和 CLI 的 npm-src 副本，保证桌面和命令行行为一致。

### 4.2 移动端 LAN 发现

**问题**：不能依赖 Bonjour/mDNS，因为某些网络环境（企业 Wi-Fi、热点）会阻塞多播。

**解决方案**：

- 基于 `expo-network` 获取本机 IP 前缀；
- 构造 `x.y.z.1` ~ `x.y.z.254` 候选列表；
- 使用 8 worker 并发探测 `/api/v1/health`，2.2 秒硬超时；
- 缓存到 MMKV，标记离线设备，优先从种子 URL 的末位 IP 开始探测。

**面试话术**：

> 手机找电脑我们没有用 mDNS，因为很多公司网络会禁多播。我实现了一个 IPv4 网段扫描器，先拿本机 IP 前缀，再并发探测 254 个地址的 health 接口，8 个 worker、2.2 秒超时。同时用 MMKV 缓存历史设备，离线设备也会保留但标记状态。这个方案在热点和普通 Wi-Fi 下都稳定工作。

### 4.3 多平台代码复用

**问题**：桌面端、CLI、移动端需要共享 OpenCode 服务管理、配置读写、MCP 同步等逻辑。

**解决方案**：

- 抽象出 `giteam-core` Rust crate；
- 桌面 Tauri 通过 `tauri::command` 调用；
- CLI 直接链接同一 crate；
- 移动端通过桌面/CLI 暴露的 Control Server HTTP API 复用；
- 对 npm 分发的 CLI，再用 `npm-src` 自包含副本 + 平台二进制包策略。

**面试话术**：

> 项目里有三套前端要共享同一套 OpenCode 管理能力。我把核心逻辑抽到 `giteam-core` 这个 Rust crate，桌面端走 Tauri command，CLI 直接链接，手机端则通过 Control Server 的 REST API 复用。这样避免了三端各写一份业务逻辑，也降低了维护成本。

### 4.4 JSONC 配置读写

**问题**：OpenCode 使用 JSONC（带注释的 JSON），标准 JSON 解析器会失败。

**解决方案**：

- Rust 端自己实现 `strip_jsonc_comments`，去掉注释后再用 `serde_json` 解析；
- 支持项目级 `opencode.jsonc` / `opencode.json` 和全局 `~/.config/opencode/opencode.jsonc`；
- MCP 增删改都通过统一的 `upsert_mcp_to_config_file` / `remove_mcp_from_config_file` 完成。

**面试话术**：

> OpenCode 的配置文件是 JSONC，带注释，直接用 serde_json 会炸。我写了一个轻量的注释剥离函数，然后再解析。同时处理了项目级和全局两个配置源，MCP 的增删改都封装成统一接口，保证写回去的文件仍然合法可读。

### 4.5 流式响应与移动端同步

**问题**：移动端网络不稳定，SSE 可能断连，需要保证消息不丢失且能实时更新。

**解决方案**：

- 桌面 Control Server 代理 OpenCode 的 `/global/event` SSE；
- 移动端 `useStreamManager` 监听 `delta`、`part`、`assistant_message` 等事件；
- 同时维护 `useSessionMessageSync` 做分页消息轮询作为兜底；
- 消息合并采用基于 ID 的去重和乐观更新策略。

**面试话术**：

> 手机网络不稳定，SSE 随时可能断。我们做了两层保障：一层是 SSE 实时流，收到 delta/part 就更新 UI；另一层是定时分页拉取 `/messages` 做快照回填。发送 prompt 时还会乐观插入用户消息，避免用户觉得卡顿。这样即使断流，重新连接后也能恢复完整上下文。

## 5. 面试自我介绍参考

### 5.1 简短版（1 分钟）

> 我参与了一个叫 Giteam 的 AI 原生 Git 客户端项目，定位是把大模型能力直接嵌入代码仓库工作流。它包含桌面端、移动端和 CLI 三个入口，桌面端用 Tauri + React，移动端用 Expo + React Native，核心逻辑抽成了一个 Rust crate 叫 giteam-core。我主要负责 OpenCode 服务管理、Skill/MCP 同步、以及手机端和桌面端的发现配对。印象最深的一个难点是 OpenCode 进程绑定到已删除目录导致 MCP 失效，我们通过追踪 repo_path 和 cwd 校验解决了这个问题。

### 5.2 详细版（3 分钟）

> Giteam 是一个面向开发者的 AI Git 客户端，核心思路是以仓库为中心组织 AI 会话。用户打开一个项目后，Giteam 会启动本地 OpenCode 服务，所有对话、工具调用、MCP 扩展都围绕这个仓库隔离运行。
>
> 技术架构上，桌面端是 Tauri v2 + React 18 + Vite + Tailwind v4，移动端是 Expo SDK 55 + React Native 0.83，CLI 是 Rust。三端共享一个 `giteam-core` Rust crate，桌面通过 Tauri command 调用，手机通过 Control Server 的 REST API 调用。
>
> 我重点参与了几个模块：
> 1. **OpenCode 服务生命周期**：解决旧进程绑定删除目录导致的 MCP 失效，引入 repo_path 追踪和 cwd 校验；
> 2. **Skill/MCP 同步**：实现 `sync_opencode_skill_mcp_manifests`，把技能清单里的 MCP 配置自动写入 `opencode.jsonc`；
> 3. **手机发现与配对**：实现 IPv4 网段扫描、6 位配对码换 Bearer Token、二维码扫码配对；
> 4. **消息同步**：SSE 实时流 + 分页兜底，保证移动端弱网体验。
>
> 这个项目让我对跨平台架构、本地服务管理、Rust/TS 混合开发有了很深的理解。

## 6. 可能被问到的问题与回答

### Q1：为什么要自己管理 OpenCode 进程，而不是让用户自己启动？

> 因为 Giteam 需要保证每个仓库有独立的服务上下文，包括当前工作目录、`opencode.jsonc` 配置、技能安装路径。如果让用户手动启动，就无法按仓库隔离，也无法在目录变更后自动重启。我们把它封装成“按仓库托管的服务池”。

### Q2：移动端和桌面端通信为什么用 HTTP 而不是 WebSocket？

> 主要考虑到 SSE 已经能满足单向实时推送，而且 Control Server 需要同时被桌面、CLI、手机访问，HTTP 更容易穿透防火墙和热点网络。双向需求通过 REST + SSE 组合解决，降低了复杂度。

### Q3：如何保证不同平台的代码一致性？

> 业务逻辑尽量放在 `giteam-core` Rust crate。Tauri 和 CLI 直接调用 Rust 函数，移动端通过 Control Server 调用同一套函数。前端只做 UI 和状态管理。

### Q4：为什么 LAN 发现不用 mDNS？

> 企业 Wi-Fi 和某些手机热点会阻断或限制多播。显式 IPv2 扫描虽然看起来“暴力”，但实现简单、兼容性好、可控性强。

### Q5：遇到的最难问题是什么？

> 最棘手的是“ stale opencode serve ”问题：用户删除仓库后，旧进程还在跑，MCP 调用会指向不存在的脚本路径。表象是 Remote Repo 工具突然不可用。我们加了进程 cwd 和 repo_path 校验，不匹配就杀掉重启。这个问题锻炼了我从现象到根因的排查能力。

## 7. 项目数据与成果（可根据实际补充）

| 指标 | 数据 |
|------|------|
| 支持平台 | macOS / Windows / Linux / iOS / Android |
| 代码语言 | Rust + TypeScript + Python |
| 核心 crate | `giteam-core` |
| 主要前端 | 桌面 React 18、移动 React Native 0.83 |
| 本地服务端口 | OpenCode 4098、Control Server 4100 |
| 同步协议 | REST + SSE |
| 认证方式 | Pair Code → Bearer Token |

## 8. 关键文件索引

| 用途 | 路径 |
|------|------|
| 共享核心逻辑 | `giteam/crates/giteam-core/src/` |
| OpenCode 服务管理 | `giteam/crates/giteam-core/src/opencode.rs` |
| Control Server | `giteam/crates/giteam-core/src/control.rs` |
| HTTP API 路由 | `giteam/crates/giteam-core/src/desktop_rpc.rs` |
| 桌面端主逻辑 | `giteam/apps/desktop/src/App.tsx` |
| 移动端发现 | `giteam/apps/mobile/src/discovery.ts` |
| 移动端配对 | `giteam/apps/mobile/src/features/pairing/usePairingController.ts` |
| 移动端消息同步 | `giteam/apps/mobile/src/features/messages/useSessionMessageSync.ts` |
| CLI 入口 | `giteam/apps/cli/src/main.rs` |
| Tauri 命令注册 | `giteam/apps/desktop/src-tauri/src/main.rs` |

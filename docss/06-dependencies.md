# Giteam 后端实现深度解析：依赖体系

## 1. 一句话概括

Giteam 的依赖体系分为三层：**Rust 负责系统级核心逻辑，TypeScript/React 负责前端 UI，Python 负责远程仓库服务**。后端的核心是 `giteam-core` 这个 Rust crate，它被桌面端、CLI、Control Server 共用。

## 2. 为什么要这样分层？

### 2.1 为什么核心用 Rust？

Giteam 需要做的很多事情，用 Rust 最合适：

- **启动子进程**：启动/管理 OpenCode 服务、Git 命令、MCP 服务器；
- **文件系统监听**：worktree 变更检测；
- **本地数据库**：SQLite 存储仓库元数据；
- **跨平台原生桌面壳**：Tauri 本身就是 Rust；
- **性能和安全**：API Key、token 这些敏感操作放在 Rust 侧更可控。

### 2.2 为什么前端用 TypeScript/React？

- 桌面端用 React + Tauri，开发效率高，UI 一致性好；
- 移动端用 React Native + Expo，一套代码跑 iOS/Android；
- TypeScript 提供类型安全，大型前端项目必需。

### 2.3 为什么远程仓库服务用 Python？

Remote Repo Service 是一个相对独立的后端服务：

- 需要快速迭代；
- 主要做 REST API 和数据管理；
- FastAPI + Pydantic 开发体验好；
- 与 AI/ML 生态更贴近，未来扩展方便。

## 3. 后端核心依赖详解

### 3.1 `giteam-core`：共享核心 crate

这是整个后端的业务核心。它的 `Cargo.toml` 里：

```toml
[dependencies]
base64 = "0.22"
rusqlite = { version = "0.32", features = ["bundled"] }
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [], optional = true }
urlencoding = "2"
wait-timeout = "0.2"
which = "6"
```

#### `rusqlite`（bundled）

- 用来内嵌 SQLite，不需要用户安装系统 SQLite；
- 存仓库列表、review 记录、远程仓库配置等本地元数据。

#### `reqwest`

- Rust 侧调用 OpenCode HTTP API；
- 用阻塞模式 + rustls-tls，避免异步复杂度和 OpenSSL 依赖。

#### `serde` / `serde_json`

- 所有配置、API 响应、IPC 数据都用 JSON；
- derive 宏让结构体序列化/反序列化很方便。

#### `tauri`（optional）

- 只在启用 `tauri-app` feature 时编译；
- 让 `giteam-core` 能被 Tauri command 调用。

#### `which`

- 在 PATH 里找 `git`、`opencode` 这些可执行文件。

#### `wait-timeout`

- 启动 OpenCode 后等待健康检查，防止无限阻塞。

### 3.2 桌面端 Tauri crate

桌面端除了 `giteam-core`，还需要：

```toml
[dependencies]
giteam-core = { path = "...", features = ["tauri-app"] }
tauri = "2"
rfd = "0.14"
notify = "6.1"
reqwest = { version = "0.12", features = ["json"] }
thiserror = "1"
objc2* = "..."  # macOS only
```

#### `tauri`

- 桌面壳，管理窗口、菜单、系统托盘、权限；
- 提供 Tauri command 机制让前端调用 Rust。

#### `rfd`

- 原生文件/文件夹选择对话框。

#### `notify`

- 文件系统事件监听，用于 worktree 变更检测。

#### `thiserror`

- 自定义错误类型，让 Rust 错误处理更规范。

#### `objc2*`（仅 macOS）

- 桥接 Objective-C，实现自定义窗口按钮、上下文菜单等原生行为。

### 3.3 CLI crate

```toml
[dependencies]
clap = { version = "4", features = ["derive"] }
ctrlc = "3"
giteam-core = { path = "..." }
serde = "1"
serde_json = "1"
```

#### `clap`

- 命令行参数解析，用 derive 宏定义子命令。

#### `ctrlc`

- 捕获 Ctrl+C 信号，让 `giteam serve` 能优雅退出。

## 4. 为什么有些依赖有两份？

### 4.1 `giteam-core` 和 `npm-src/giteam-core`

`giteam/apps/cli/npm-src/` 下有一份 `giteam-core` 的完整副本。原因是：

- CLI 需要发布成 npm 包；
- npm 包需要包含完整的 Rust 源码，才能在不同平台编译；
- 用副本而不是 symlink，是为了让 npm publish 时把源码一起打包。

### 4.2 `desktop_rpc.rs` 和 Tauri command 重复

`giteam-core/src/desktop_rpc.rs` 里有一些和桌面端 Tauri command 类似的代码。原因是：

- Tauri command 给桌面端用；
- `desktop_rpc.rs` 给 CLI/mobile 服务用（通过 HTTP）；
- 两套接口形态不同，但业务逻辑相同，目前存在一定重复。

## 5. 遇到过什么难题？

### 5.1 难题一：GUI 应用 PATH 不完整

**现象**：桌面端启动后找不到 `git` 或 `opencode`。

**根因**：GUI 应用继承的 PATH 比终端少。

**解决**：

- `command_runner.rs` 主动增强 PATH；
- 失败后回退到 `/bin/zsh -ic` 获取用户 shell 的 PATH。

### 5.2 难题二：Rust 依赖体积

**现象**：Tauri 应用打包后体积偏大。

**根因**：Rust 静态链接、Tauri runtime、WebView 引擎都占空间。

**解决**：

- 前端代码按需加载，Vite 手动拆 chunk；
- Rust 侧只引入必需的 feature；
- CLI 用平台二进制包分发，避免用户本地编译。

### 5.3 难题三：跨平台原生能力差异

**现象**：macOS 需要自定义窗口按钮，Windows/Linux 不需要。

**根因**：不同操作系统 API 不同。

**解决**：

- 用 `#[cfg(target_os = "macos")]` 条件编译；
- macOS 专用 `objc2*` 依赖只在 macOS target 时启用。

### 5.4 难题四：移动端和桌面端依赖版本不一致

**现象**：桌面端 React 18，移动端 React 19；桌面端 Tailwind v4，移动端用不到 Tailwind。

**根因**：两个前端目标不同，技术栈自然不同。

**解决**：

- 各自独立的 `package.json`；
- 共享逻辑尽量抽到 `giteam-core` Rust crate，避免 JS 层重复。

## 6. 数据流总结

```
桌面端
  React 18 + Vite + Tailwind v4
    ↓ invoke
  Tauri Rust
    ↓ 调用
  giteam-core
    ↓ 启动/管理
  OpenCode / Git / MCP

CLI
  clap 解析参数
    ↓
  giteam-core
    ↓
  Control Server / OpenCode / Git

移动端
  React Native + Expo
    ↓ HTTP
  Control Server (giteam-core)
    ↓
  OpenCode / Git

远程仓库服务
  Python FastAPI
    ↓
  Remote Repo MCP
```

## 7. 面试可以怎么讲

> Giteam 的后端核心是一个叫 `giteam-core` 的 Rust crate，它被桌面端、CLI 和 Control Server 共用。选择 Rust 是因为 Giteam 需要启动子进程、监听文件系统、访问本地 SQLite、做跨平台桌面壳，这些用 Rust 很合适。
>
> `giteam-core` 里几个关键依赖：rusqlite bundled 做本地 SQLite，reqwest 调用 OpenCode API，serde 处理 JSON，which 找 git/opencode 可执行文件。桌面端 Tauri 提供窗口和前端通信，notify 监听 worktree 变化，rfd 做原生文件选择。
>
> 我们遇到过一个典型问题：macOS 上双击启动的 GUI 应用 PATH 不完整，找不到 Homebrew 装的 git。我们在 command_runner 里做了 PATH 增强，还加了 `/bin/zsh -ic` 回退。另外 CLI 发布成 npm 包时，需要把 Rust 源码一起打包，所以有一份 `npm-src` 副本。

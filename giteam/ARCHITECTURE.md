# Giteam 架构文档

> 本文档基于代码仓库结构、依赖分析与关键源码梳理自动生成，描述 Giteam 的整体系统架构、模块划分与多端协作机制。

---

## 1. 项目概述

**Giteam** 是一款面向开发者的**多端 Git 协作工具**，支持在桌面端、移动端和 Web 端访问同一个本地 Git 代码仓库，并内置 AI 辅助编程能力（基于 OpenCode 服务）。

核心特点：
- **多端同步**：桌面端/CLI 作为「主机」，移动端/Web 作为「遥控端」，通过配对码安全连接
- **AI 原生**：深度集成多模型 LLM、Agent、Skills、MCP（Model Context Protocol）扩展
- **Git 优先**：Worktree 管理、Diff 查看、终端操作、Commit/Review 工作流
- **跨平台**：桌面端覆盖 macOS/Windows/Linux，移动端覆盖 iOS/Android

---

## 2. 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户交互层                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Desktop    │  │    Mobile    │  │      Web         │  │
│  │  (Tauri App) │  │(Expo/ReactNative)│  (Browser)       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
          │  Tauri IPC      │  HTTP/REST        │  HTTP/REST
          │                 │                   │
┌─────────▼─────────────────▼───────────────────▼────────────┐
│                    控制与业务逻辑层                           │
│  ┌────────────────────────────────────────────────────┐    │
│  │         giteam-core (Rust Shared Library)          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐           │    │
│  │  │ control  │ │ opencode │ │ desktop_rpc│          │    │
│  │  │(HTTP服务) │ │(AI引擎)  │ │(桌面RPC) │           │    │
│  │  └──────────┘ └──────────┘ └──────────┘           │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │            Desktop Backend (Tauri Commands)         │    │
│  │  git / env / ui / db / opencode / watch / entire   │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │              CLI (Rust + clap)                      │    │
│  │         giteam-cli bin → 启动 mobile service       │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据与运行时层                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  SQLite DB   │  │  Git CLI     │  │  OpenCode Server │  │
│  │ (client.db)  │  │  (git)       │  │  (本地AI服务)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Monorepo 目录结构

```
giteam/
├── apps/
│   ├── cli/                    # Rust CLI 工具
│   │   ├── Cargo.toml          # giteam-cli
│   │   └── src/
│   │       ├── main.rs         # CLI 入口
│   │       └── doctor.rs       # 环境诊断
│   │
│   ├── desktop/                # Tauri 桌面应用
│   │   ├── package.json        # giteam-desktop (React + Vite)
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── App.tsx         # 桌面端根组件（4000+ 行状态机）
│   │   │   ├── main.tsx        # 前端入口
│   │   │   ├── components/     # UI 组件（git/opencode/settings/terminal...）
│   │   │   ├── layout/         # Workbench 工作台布局
│   │   │   ├── lib/            # 业务逻辑 Hooks 与工具
│   │   │   ├── styles/         # Tailwind CSS 主题与组件样式
│   │   │   └── types/          # TypeScript 类型定义
│   │   └── src-tauri/
│   │       ├── Cargo.toml      # Tauri 后端
│   │       ├── tauri.conf.json # Tauri 窗口/打包配置
│   │       └── src/
│   │           ├── main.rs     # Tauri 主入口（Command 注册）
│   │           └── commands/   # Tauri Commands（按域拆分）
│   │               ├── git.rs      # Git 操作命令
│   │               ├── opencode.rs # AI 服务命令
│   │               ├── control.rs  # 控制服务器命令
│   │               ├── db.rs       # 本地数据库命令
│   │               ├── env.rs      # 运行时环境检查
│   │               ├── ui.rs       # 桌面 UI 交互
│   │               ├── watch.rs    # Git Worktree 监听
│   │               └── entire.rs   # Entire 适配器（AI Explain）
│   │
│   └── mobile/                 # Expo / React Native 移动应用
│       ├── package.json        # giteam-mobile (Expo SDK 55)
│       ├── App.tsx             # 移动端根组件
│       ├── android/            # Android 原生工程
│       ├── src/
│       │   ├── api/
│       │   │   └── controlApi.ts   # 与 Desktop Control Server 通信
│       │   ├── components/
│       │   │   └── chat/           # ChatWorkspace、Composer、TurnCell
│       │   ├── features/
│       │   │   ├── chat/           # 聊天核心状态与 Hooks
│       │   │   ├── messages/       # 消息同步、乐观更新、分页
│       │   │   ├── stream/         # OpenCode 流式渲染
│       │   │   ├── media/          # 附件、相册、相机
│       │   │   ├── workspace/      # 项目目录、会话目录
│       │   │   ├── discovery/      # 局域网设备发现
│       │   │   ├── pairing/        # 配对流程
│       │   │   └── questions/      # AI 提问/权���弹窗
│       │   ├── screens/            # 页面路由
│       │   ├── storage/            # MMKV / AsyncStorage 封装
│       │   ├── styles/             # React Native 样式系统
│       │   └── types/              # 类型定义
│       └── assets/fonts/           # 自定义字体
│
├── crates/
│   └── giteam-core/            # Rust 共享核心库
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs          # 模块导出
│           ├── control.rs      # HTTP 控制服务器（配对码、认证、API）
│           ├── desktop_rpc.rs  # 桌面端 RPC 封装
│           ├── opencode.rs     # OpenCode AI 服务协议
│           └── command_runner.rs # 命令执行器
│
├── .github/                    # CI/CD 工作流
├── README.md
└── LIMITS.md                   # 架构限制与已知问题
```

---

## 4. 各端架构详解

### 4.1 桌面端（Desktop）

**技术栈**：
- **前端**：React 18 + TypeScript + Vite + Tailwind CSS v4 + Radix UI + Framer Motion
- **后端**：Tauri v2（Rust）
- **本地存储**：SQLite（rusqlite，文件位于 `~/Library/Application Support/giteam/client.db`）

**窗口配置**：
- 默认尺寸 1480×940，暗色主题，Overlay 标题栏
- 单窗口应用（`main` webview）

**核心模块**：

| 模块 | 说明 |
|------|------|
| `Git` | Worktree 管理、分支操作、Commit/Pull/Push、Diff 查看、终端集成 |
| `OpenCode` | AI Chat 会话管理、多模型 Provider、流式消息、Skills/MCP 市场 |
| `Control` | 内置 HTTP 控制服务器，供移动端/Web 连接 |
| `Watch` | Git Worktree 文件变更监听（notify） |
| `DB` | SQLite 本地数据库（仓库列表、Review 记录、Actions） |
| `UI` | 系统托盘、文件选择、剪贴板、附件、窗口主题 |

**特殊处理**：
- macOS 右键菜单拦截：通过 Objective-C Runtime Hook (`willOpenMenu:withEvent:`) 屏蔽原生右键菜单，保留前端自定义右键菜单
- 启动时自动预热：后台线程启动 OpenCode 服务 + Mobile Service

---

### 4.2 移动端（Mobile）

**技术栈**：
- **框架**：Expo SDK 55 + React Native 0.83 + React 19
- **导航**：自定义 Router（`MobileAppRouter`）
- **状态管理**：纯 Hooks + Refs（无 Redux/Zustand，使用大量 `useRef` + `useState` 组合）
- **存储**：MMKV（`react-native-mmkv`）+ AsyncStorage
- **动画**：Reanimated 4 + Gesture Handler
- **键盘**：Keyboard Controller

**架构特点**：

移动端是**「瘦客户端」**设计，本身不直接执行 Git 命令，而是作为桌面端/CLI 的**远程控制器**：

1. **连接层**：通过配对码（Pair Code）或二维码扫描与 Desktop 建立连接
2. **API 层**：通过 `controlApi.ts` 向 Desktop 的 Control Server 发送 HTTP 请求
3. **状态层**：本地维护会话列表、消息窗口、乐观更新、流式渲染状态
4. **渲染层**：高性能长列表（FlashList）、虚拟滚动、打字机动画、图片预览

**核心 Hooks 设计**：

| Hook | 职责 |
|------|------|
| `useMobileAppState` | 全局状态中心（40+ 个 state/setter） |
| `useMobileAppRefs` | 全局 Refs 容器（避免闭包过时） |
| `useChatListController` | 消息列表滚动、分页、视口跟踪 |
| `useTurnWindowController` | 消息窗口切片、历史加载、乐观消息合并 |
| `useStreamManager` | SSE/流式消息接收与解析 |
| `useOpenCodeStreamRuntime` | OpenCode 流式打字机渲染 |
| `useOptimisticUserMessages` | 乐观更新（先发后同步） |
| `useQuestionController` | AI 提问弹窗与权限管理 |
| `useMobileConnectionFlow` | 配对流程：扫码 → 发现 → 连接 → 认证 |

---

### 4.3 CLI 工具

**技术栈**：Rust + clap v4

**定位**：
- 轻量级命令行入口
- 可独立启动 `mobile service`（控制服务器），让移动端在没有桌面 GUI 的情况下也能连接
- 环境诊断（`doctor`）

---

### 4.4 共享核心（giteam-core）

**技术栈**：Rust + serde + rusqlite + reqwest

**模块说明**：

| 模块 | 职责 |
|------|------|
| `control` | **控制���务器**。内置 TCP/HTTP 服务器，处理配对码认证、REST API、静态资源服务 |
| `opencode` | **AI 协议层**。OpenCode 服务配置、模型管理、Skills、MCP 协议结构 |
| `desktop_rpc` | **桌面 RPC**。Desktop 与 OpenCode 服务之间的通信封装 |
| `command_runner` | **命令执行器**。安全执行外部进程（git、opencode 等） |

---

## 5. 多端协作机制（Control Server）

### 5.1 角色定义

| 角色 | 职责 | 代表端 |
|------|------|--------|
| **Host（主机）** | 运行 Control Server，持有 Git 仓库、执行 Git 命令、运行 AI 服务 | Desktop / CLI |
| **Client（客户端）** | 通过 HTTP API 连接 Host，发送指令并接收结果 | Mobile / Web |

### 5.2 连接流程

```
┌─────────┐                      ┌─────────────┐
│ Desktop │                      │   Mobile    │
│ (Host)  │                      │  (Client)   │
└────┬────┘                      └──────┬──────┘
     │                                  │
     │  1. 启动 Control Server          │
     │     (默认 0.0.0.0:4100)          │
     │                                  │
     │  2. 生成配对码 (6位数字)          │
     │     TTL: 24h / 7d / forever     │
     │                                  │
     │◄──────── 3. 局域网发现 ──────────│
     │     (UDP/mDNS/手动输入URL)       │
     │                                  │
     │◄──────── 4. 输入配对码 ──────────│
     │                                  │
     │  5. 验证配对码 → 颁发 Token       │
     │     (Bearer Token 持久化)        │
     │                                  │
     │◄──────── 6. 后续 API 调用 ───────│
     │     Authorization: Bearer <token>│
     │                                  │
```

### 5.3 认证与安全

- **配对码（Pair Code）**：6 位数字，可选 24h/7d/永久/无认证模式
- **Bearer Token**：配对成功后生成 `gtm_{32位hex}`，持久化到 `control-auth.json`
- **No-Auth 模式**：`pair_code_ttl_mode: "none"`，局域网完全开放（仅本地网络）
- **Public Base URL**：支持通过公网 URL + 反向代理访问

### 5.4 关键 API 端点

由 `control.rs` 实现的部分核心端点：

| 端点 | 说明 |
|------|------|
| `POST /api/pair` | 配对认证，提交 Pair Code 换取 Token |
| `GET /api/access` | 获取当前访问信息（URL、配对码、过期时间） |
| `GET /api/projects` | 获取仓库列表 |
| `GET /api/sessions` | 获取会话列表 |
| `POST /api/sessions` | 创建新会话 |
| `POST /api/prompt` | 发送 AI 提示词 |
| `POST /api/abort` | 中止 AI 生成 |
| `GET /api/messages` | 获取消息历史 |
| `GET /api/config` | 获取 OpenCode 配置（含模型列表） |
| `GET /api/status` | 获取 Mobile Service 状态 |

---

## 6. AI 子系统（OpenCode）

### 6.1 架构层次

```
用户界面 (Desktop/Mobile)
    │
    ▼
OpenCode Service (本地 HTTP Server)
    │
    ├── Provider Manager （多模型 Provider 路由）
    ├── Session Manager （会话持久化）
    ├── Skill Engine    （Skills 加载与执行）
    ├── MCP Client      （Model Context Protocol 服务器连接）
    └── Permission Gate （用户权限审批流）
    │
    ▼
LLM APIs (OpenAI / Anthropic / Ollama / 自定义 Provider)
```

### 6.2 核心概念

| 概念 | 说明 |
|------|------|
| **Session** | 一次连续的 AI 对话上下文，绑定到特定仓库 |
| **Agent** | 预定义的 AI 角色（如 Code Reviewer、Commit Writer） |
| **Skill** | 可插拔的 AI 能力扩展，从 Skill Marketplace 安装 |
| **MCP** | Model Context Protocol，连接外部工具/数据库/API |
| **Part** | OpenCode 消息的最小单元（text/thinking/todo/tool_use/attachment） |
| **Question** | AI 在生成过程中向用户发起的提问（如权限申请、确认） |

### 6.3 消息流式处理

1. **Desktop** 调用 `post_opencode_session_prompt_async`（Tauri Command）
2. **OpenCode Service** 接收请求，建立 SSE 流
3. **Desktop/Mobile** 通过 `useStreamManager` / `useOpenCodeStreamRuntime` 消费流
4. **流式解析**：将 SSE chunks 解析为 `Part` → 合并到消息 → 打字机动画渲染
5. **Question 拦截**：如果流中出现 `question` part，暂停并弹出用户确认对话框

---

## 7. Git 子系统

### 7.1 Worktree 模型

Giteam 以 **Git Worktree** 为核心工作单元：

- 每个分支可以有一个独立的 Worktree 目录
- 支持在 Worktree 之间快速切换，避免 `git stash/checkout` 的上下文丢失
- 文件树实时监听（`notify` crate），变更自动刷新 UI

### 7.2 Git 操作矩阵

| 操作 | Desktop UI | Mobile UI | 执行层 |
|------|-----------|-----------|--------|
| Commit | ✅ 完整编辑器 | ✅ 消息输入 | Tauri Command → git CLI |
| Diff | ✅ Monaco Diff | ✅ 文本 Diff | 后端生成 patch，前端渲染 |
| Worktree | ✅ 创建/删除/切换 | ❌ 仅查看 | 直接调用 `git worktree` |
| Terminal | ✅ xterm.js 嵌入 | ❌ | PTY + `wait-timeout` |
| Branch | ✅ 拓扑图 + 列表 | ✅ 列表 | `git branch` / `git for-each-ref` |

---

## 8. 数据层

### 8.1 SQLite 数据库

**位置**：`~/Library/Application Support/giteam/client.db`（macOS）

**核心表**：

| 表名 | 说明 |
|------|------|
| `repositories` | 用户添加的 Git 仓库列表 |
| `review_records` | AI Code Review 记录 |
| `review_actions` | Review 后的用户操作（Accept/Reject） |

### 8.2 配置文件

| 文件 | 说明 |
|------|------|
| `control-server.json` | Control Server 配置（端口、认证模式、公网URL） |
| `control-auth.json` | 持久化的 Bearer Token |
| `mobile-model-state.json` | 移动端模型选择状态同步 |

### 8.3 本地缓存

- **Desktop**：`localStorage`（宽度、主题、设置）+ `appCache.ts`（运行时状态）
- **Mobile**：MMKV（偏好设置）+ AsyncStorage（会话缓存）+ 内存缓存（消息窗口）

---

## 9. 构建与部署

### 9.1 Desktop 构建

```bash
cd apps/desktop
npm run tauri:build    # 打包原生应用（dmg/exe/appimage）
npm run build          # 仅构建前端（dist/）
npm run build:web      # 构建 Web 版本（dist-web/）
```

### 9.2 Mobile 构建

```bash
cd apps/mobile
npx expo start         # 开发服务器
npx expo run:android   # 本地 Android 构建
npx expo run:ios       # 本地 iOS 构建
eas build -p android   # EAS 云构建 APK
```

### 9.3 CLI 构建

```bash
cd apps/cli
cargo build --release  # 编译 giteam 二进制
```

---

## 10. 关键技术决策

| 决策 | 选型 | 理由 |
|------|------|------|
| 桌面框架 | Tauri v2 | 轻量、Rust 安全、比 Electron 更小的包体积 |
| 移动端框架 | Expo (RN) | 快速迭代、OTA 更新、跨平台 |
| 共享核心 | Rust crate | 类型安全、零成本抽象、被 CLI + Desktop 复用 |
| 状态管理 | 纯 Hooks | 项目复杂度可控，避免引入 Redux/Zustand 的额外抽象 |
| 样式方案 | Tailwind CSS v4 | 原子化、设计令牌、暗色主题一键切换 |
| UI 组件 | Radix UI + 自建 | Headless 可访问性 + 完全自定义样式 |
| 代码编辑器 | Monaco Editor | VS Code 同款，Diff 查看、语法高亮 |
| 终端模拟 | xterm.js | 与 Monaco 同生态，支持真彩色和复杂转义 |
| 流式协议 | SSE (Server-Sent Events) | 比 WebSocket 更简单，适合单向 AI 流 |

---

## 11. 已知限制（来自 LIMITS.md）

> 注：原 LIMITS.md 为空文件，以下为基于代码分析推断的潜在架构约束：

1. **移动端无法离线使用**：Mobile 必须连接到 Desktop/CLI 的 Control Server，没有本地 Git 执行能力
2. **Control Server 单实例**：同一时刻只有一个 Control Runtime，不支持多 Host 同时在线
3. **SQLite 并发**：rusqlite 在 Tauri 多线程环境下使用 Mutex 串行化，极端高频操作可能阻塞
4. **配对码冲突**：6 位数字在局域网内理论上有碰撞可能（但 TTL 机制降低了风险）
5. **Web 端能力受限**：浏览器安全限制导致 Web 端无法直接访问本地文件系统，需通过 Desktop 代理

---

## 12. ���结

Giteam 采用 **「Rust 核心 + TypeScript 前端 + 多端分发」** 的混合架构：

- **Rust（giteam-core）** 承担安全敏感、跨平台复用的底层能力：Git 命令执行、HTTP 控制服务器、AI 服务代理、SQLite 数据访问
- **React（Desktop）** 提供功能最全的开发者工作台，集成 Git 图形化、AI Chat、终端、Diff 编辑器
- **React Native（Mobile）** 作为随身遥控器，让开发者随时随地查看代码变更、与 AI 协作
- **Tauri** 作为桌面端的「微型操作系统」，打通 Web 前端与本地系统 API 的桥梁

整个架构围绕 **"Git 仓库是中心，AI 是助手，多端是延伸"** 的核心理念设计，在保持本地数据主权的同时，最大化开发者的移动办公效率。

---

*文档版本：v0.1.33（与代码库版本同步）*
*生成时间：2026-06-05*

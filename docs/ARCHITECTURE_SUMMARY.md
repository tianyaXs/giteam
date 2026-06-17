# Giteam 架构总览

> 一句话定义：**Giteam = Git 工作台 + AI 编程助手 + 多端遥控器**，让开发者在桌面、手机、Web 上无缝协作同一套代码仓库。

---

## 1. 架构全景

```
┌─────────────────────────────────────────────────────────────┐
│                        用户交互层                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Desktop    │  │    Mobile    │  │      Web         │  │
│  │  (Tauri App) │  │ (Expo / RN)  │  │  (Browser)       │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼─────────────────┼───────────────────┼────────────┘
          │                 │                   │
          │   Tauri IPC     │   HTTP/REST       │  HTTP/REST
          │                 │                   │
┌─────────▼─────────────────▼───────────────────▼────────────┐
│                    控制与业务逻辑层                           │
│  ┌────────────────────────────────────────────────────┐    │
│  │         giteam-core (Rust 共享核心库)               │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐           │    │
│  │  │ control  │ │ opencode │ │desktop_rpc│          │    │
│  │  │(HTTP服务) │ │(AI引擎)  │ │(桌面通信) │          │    │
│  │  └──────────┘ └──────────┘ └──────────┘           │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │            Desktop Backend (Tauri Commands)         │    │
│  │  git · env · ui · db · opencode · watch · entire   │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │              CLI (Rust + clap)                      │    │
│  │         独立启动 mobile service，无 GUI 也能用       │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据与运行时层                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  SQLite DB   │  │  Git CLI     │  │  OpenCode Server │  │
│  │ (client.db)  │  │  (git)       │  │  (本地 AI 服务)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo 目录结构

```
giteam/
├── apps/
│   ├── cli/                    # Rust CLI 工具（cargo）
│   │   ├── src/main.rs         # 入口：启动 mobile service
│   │   └── src/doctor.rs       # 环境诊断
│   │
│   ├── desktop/                # Tauri 桌面应用
│   │   ├── src/                # React 18 + Vite + Tailwind v4
│   │   │   ├── App.tsx         # 根组件（大型状态机）
│   │   │   ├── components/     # UI 组件（git/opencode/settings/terminal...）
│   │   │   ├── layout/         # Workbench 工作台布局
│   │   │   └── lib/            # 业务 Hooks 与工具
│   │   └── src-tauri/          # Rust 后端（Commands 按域拆分）
│   │       └── src/commands/
│   │           ├── git.rs
│   │           ├��─ opencode.rs
│   │           ├── control.rs
│   │           ├── db.rs
│   │           ├── env.rs
│   │           ├── ui.rs
│   │           ├── watch.rs
│   │           └── entire.rs
│   │
│   └── mobile/                 # Expo / React Native 移动应用
│       ├── App.tsx             # 移动端根组件
│       ├── src/
│       │   ├── api/            # Control Server HTTP 客户端
│       │   ├── components/     # 聊天 UI（Composer、TurnCell...）
│       │   ├── features/       # 按域拆分的业务逻辑
│       │   │   ├── chat/       # 会话、状态、生命周期
│       │   │   ├── messages/   # 消息同步、乐观更新、分页
│       │   │   ├── stream/     # SSE 流式渲染
│       │   │   ├── media/      # 附件、相册、相机
│       │   │   ├── discovery/  # 局域网设备发现
│       │   │   ├── pairing/    # 配对流程
│       │   │   └── questions/  # AI 提问弹窗
│       │   ├── screens/        # 页面路由
│       │   └── storage/        # MMKV / AsyncStorage 封装
│       └── android/            # Android 原生工程
│
├── crates/
│   └── giteam-core/            # Rust 共享核心库
│       └── src/
│           ├── lib.rs          # 模块导出
│           ├── control.rs      # HTTP 控制服务器（配对码、认证、API）
│           ├── desktop_rpc.rs  # 桌面端 RPC 封装
│           ├── opencode.rs     # OpenCode AI 服务协议
│           └── command_runner.rs # 安全命令执行器
│
└── docs/                       # 开发文档与工作日志
```

---

## 3. 核心设计：Host-Client 模式

Giteam 不是传统意义上的"云同步"，而是**局域网 P2P + 主机代理**模式：

| 角色 | 职责 | 代表端 |
|------|------|--------|
| **Host（主机）** | 持有 Git 仓库、执行 Git 命令、运行 AI 服务、暴露 Control Server | Desktop / CLI |
| **Client（客户端）** | 通过 HTTP API 连接 Host，发送指令并接收结果 | Mobile / Web |

### 连接流程

```
Desktop (Host)                          Mobile (Client)
     │                                        │
     │  1. 启动 Control Server (0.0.0.0:4100) │
     │                                        │
     │  2. 生成 6 位配对码（24h/7d/永久）      │
     │◄────────── 3. 局域网发现 ──────────────│
     │◄────────── 4. 输入配对码 ──────────────│
     │  5. 验证 → 颁发 Bearer Token            │
     │◄────────── 6. 后续 API 调用 ───────────│
```

### 关键 API

| 端点 | 说明 |
|------|------|
| `POST /api/pair` | 配对认证，换取 Token |
| `GET /api/projects` | 获取仓库列表 |
| `POST /api/prompt` | 发送 AI 提示词 |
| `GET /api/messages` | 获取消息历史 |
| `POST /api/abort` | 中止 AI 生成 |

---

## 4. 各端技术栈速查

### Desktop（功能最全的工作台）

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript + Vite |
| 样式 | Tailwind CSS v4 + Radix UI + Framer Motion |
| 编辑器 | Monaco Editor（代码 + Diff） |
| 终端 | xterm.js |
| 桌面壳 | Tauri v2（Rust） |
| 数据库 | SQLite（rusqlite） |
| 存储路径 | `~/Library/Application Support/giteam/client.db` |

**特殊处理**：macOS 右键菜单通过 Objective-C Runtime Hook 拦截，禁用原生菜单，保留前端自定义右键。

### Mobile（随身遥控器）

| 层级 | 技术 |
|------|------|
| 框架 | Expo SDK 55 + React Native 0.83 + React 19 |
| 导航 | 自定义 Router（MobileAppRouter） |
| 状态管理 | 纯 Hooks + Refs（无 Redux/Zustand） |
| 本地存储 | MMKV + AsyncStorage |
| 动画 | Reanimated 4 + Gesture Handler |
| 长列表 | FlashList |

**架构特点**：Mobile 是"瘦客户端"，本身不执行 Git，所有 Git/AI 操作都通过 `controlApi.ts` 代理到 Desktop。

### CLI（无头主机）

| 层级 | 技术 |
|------|------|
| 语言 | Rust + clap v4 |
| 用途 | 环境诊断、独立启动 Control Server |

### giteam-core（共享核心）

| 层级 | 技术 |
|------|------|
| 语言 | Rust |
| 职责 | HTTP 控制服务器、AI 协议、命令执行、数据库访问 |
| 复用方 | CLI + Desktop Backend |

---

## 5. AI 子系统（OpenCode）

```
用户界面 (Desktop / Mobile)
    │
    ▼
OpenCode Service (本地 HTTP Server)
    │
    ├── Provider Manager   # 多模型路由（OpenAI / Anthropic / Ollama...）
    ├── Session Manager    # 会话持久化
    ├── Skill Engine       # Skills 加载与执行
    ├── MCP Client         # Model Context Protocol 外部工具
    └── Permission Gate    # 用户权限审批流
    │
    ▼
LLM APIs
```

**核心概念**：

| 概念 | 说明 |
|------|------|
| **Session** | 一次连续 AI 对话，绑定到特定仓库 |
| **Agent** | 预定义 AI 角色（Code Reviewer / Commit Writer 等） |
| **Skill** | 可插拔 AI 能力扩展 |
| **MCP** | 连接外部工具/数据库/API 的标准协议 |
| **Part** | 消息最小单元（text / thinking / todo / tool_use / attachment） |
| **Question** | AI 生成过程中向用户发起的提问/权限申请 |

**流式处理**：SSE（Server-Sent Events）单向�� → `useStreamManager` 解析 → `useOpenCodeStreamRuntime` 打字机渲染。

---

## 6. Git 子系统

以 **Git Worktree** 为核心工作单元：

- 每个分支可拥有独立 Worktree 目录
- 快速切换分支，避免 stash/checkout 的上下文丢失
- 文件变更实时监听（Rust `notify` crate）

| 操作 | Desktop | Mobile | 执行层 |
|------|---------|--------|--------|
| Commit | ✅ 完整编辑器 | ✅ 消息输入 | Tauri Command → git CLI |
| Diff | ✅ Monaco Diff | ✅ 文本 Diff | 后端生成 patch |
| Worktree | ✅ 创建/删除/切换 | ❌ 仅查看 | `git worktree` |
| Terminal | ✅ xterm.js 嵌入 | ❌ | PTY + `wait-timeout` |
| Branch 图 | ✅ 拓扑可视化 | ✅ 列表 | `git for-each-ref` |

---

## 7. 数据层一览

| 数据类型 | Desktop | Mobile |
|----------|---------|--------|
| 业务数据 | SQLite（rusqlite） | 通过 API 从 Host 获取 |
| 偏好设置 | localStorage | MMKV |
| 会话缓存 | appCache.ts | AsyncStorage |
| 认证信息 | keychain / 文件 | MMKV（Token 持久化） |

**核心数据库表**：
- `repositories` — 仓库列表
- `review_records` — AI Code Review 记录
- `review_actions` — Review 后用户操作（Accept / Reject）

---

## 8. 关键技术决策

| 决策 | 选型 | 理由 |
|------|------|------|
| 桌面框架 | Tauri v2 | 轻量、Rust 安全、包体积远小于 Electron |
| 移动端框架 | Expo (RN) | 快速迭代、OTA 更新、跨平台 |
| 共享核心 | Rust crate | 类型安全、零成本抽象、CLI + Desktop 复用 |
| 状态管理 | 纯 Hooks | 复杂度可控，避免 Redux 额外抽象 |
| 样式方案 | Tailwind CSS v4 | 原子化、设计令牌、暗色主题一键切换 |
| 流式协议 | SSE | 比 WebSocket 简单，适合单向 AI 流 |
| 控制协议 | HTTP REST | 通用、易调试、Mobile/Web 都能直接访问 |

---

## 9. 构建速查

```bash
# Desktop
cd apps/desktop
npm run tauri:dev        # 开发
npm run tauri:build      # 打包 dmg/exe/appimage

# Mobile
cd apps/mobile
npx expo start           # Metro 开发
npx expo run:android     # 本地 APK
eas build -p android     # 云构建

# CLI
cd apps/cli
cargo build --release    # 编译 giteam 二进制

# Web（一键脚本）
./run_debug.sh           # http://localhost:5100
```

---

## 10. 已知架构约束

1. **Mobile 无法离线**：必须连接 Desktop/CLI 的 Control Server，无本地 Git 执行能力。
2. **Control Server 单实例**：同一时刻只能运行一个 Host。
3. **SQLite 串行化**：rusqlite 在 Tauri 多线程下通过 Mutex 保护，极端高频操作可能阻塞。
4. **Web 端受限**：浏览器安全策略限制，无法直接访问本地文件系统，需通过 Desktop 代理。

---

## 总结

Giteam 采用 **"Rust 核心 + TypeScript 前端 + 多端分发"** 的混合架构：

- **Rust（giteam-core）** → 安全敏感、跨平台复用的底层能力
- **React（Desktop）** → 功能最全的开发者工作台
- **React Native（Mobile）** → 随身遥控器，随时随地与 AI 协作
- **Tauri** → 打通 Web 前端与本地系统 API 的桥梁

核心理念：**Git 仓库是中心，AI 是助手，多端是延伸**。

---

*文档版本：v0.1.33 | 生成时间：2026-06-05*

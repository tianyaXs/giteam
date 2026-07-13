# Giteam 后端实现深度解析：手机端与电脑端连接

## 1. 一句话概括

Giteam 的手机端不直接连 OpenCode，而是连到电脑端/CLI 上的一个 **Control Server**。Control Server 是一个 Rust 写的 HTTP 服务器，负责认证、代理 OpenCode API、压缩消息数据，让手机能远程使用桌面端的能力。

## 2. 为什么要这么做？

### 2.1 手机为什么不直接跑 OpenCode？

OpenCode 和 Giteam 核心都是为桌面环境设计的：

- 需要访问本地 Git 仓库；
- 需要启动子进程（MCP 服务器、Git 命令）；
- 需要读写本地文件系统；
- 对性能和网络要求不同。

在手机上完整运行这一套不现实。所以手机作为**瘦客户端**，把重活都交给电脑端。

### 2.2 为什么用 HTTP + SSE，不用 WebSocket？

- SSE（Server-Sent Events）已经能满足单向实时推送（服务器 → 手机）；
- HTTP 更容易穿透防火墙、热点网络；
- 手机需要的双向通信通过 REST API 就够了；
- WebSocket 会增加连接管理和重连复杂度。

## 3. 后端具体怎么做？

### 3.1 启动 Control Server

Control Server 默认监听 `0.0.0.0:4100`，由两种方式启动：

- **CLI**：`giteam serve`
- **桌面端**：启动时派生后台线程，检查并启动 `giteam serve` 子进程

Control Server 的核心代码在 `giteam-core/src/control.rs`，被 CLI 和桌面端复用。

### 3.2 手机发现电脑

手机不用 mDNS/Bonjour，而是做**显式 IPv4 网段扫描**。

流程：

1. 通过 `expo-network` 获取手机本机 IP 前缀，比如 `192.168.1.x`；
2. 构造候选地址 `192.168.1.1` 到 `192.168.1.254`；
3. 并发探测 `http://<ip>:4100/api/v1/health`；
4. 最多 8 个 worker，2.2 秒硬超时；
5. 发现的设备缓存到 MMKV，离线设备也会保留但标记状态。

**为什么不用 mDNS？**

因为很多公司 Wi-Fi 和手机热点会阻断多播。mDNS 看起来优雅，但兼容性差。显式扫描虽然“暴力”，但可控、稳定、跨网络环境工作。

### 3.3 配对认证

发现电脑后，手机需要拿到长期访问凭证。流程：

1. 电脑端生成 6 位数字配对码；
2. 手机用户输入配对码；
3. 手机调用 `POST /api/v1/auth/pair`，body `{ code: "123456" }`；
4. Control Server 验证配对码；
5. 返回一个长期 Bearer Token；
6. 手机把 token 存到 MMKV，后续请求都带 `Authorization: Bearer <token>`。

配对码有过期策略：

- `none`：不需要认证
- `24h`：24 小时后过期
- `7d`：7 天后过期
- `forever`：永不过期

Bearer Token 生成一次后持久化到 `control-auth.json`，电脑重启后仍然有效。

### 3.4 代理 OpenCode API

Control Server 暴露了一套 `/api/v1/opencode/*` 端点，内部转发给本地的 OpenCode 服务：

| 移动端端点 | 内部转发 |
|-----------|---------|
| `GET /api/v1/opencode/session` | `GET /session` |
| `POST /api/v1/opencode/session` | `POST /session` |
| `GET /api/v1/opencode/messages` | `GET /messages` |
| `POST /api/v1/opencode/prompt` | `POST /session/{id}/prompt_async` |
| `GET /api/v1/opencode/stream` | SSE `/global/event` |
| `POST /api/v1/opencode/abort` | `POST /abort` |
| `GET/POST /api/v1/opencode/mcp/*` | MCP 相关命令 |
| `GET/POST /api/v1/opencode/skill*` | 技能相关命令 |

### 3.5 消息压缩

Control Server 返回消息前会做精简，因为手机网络可能不稳定，消息体太大会慢：

- 删除 `info.system`（完整的 system prompt，通常很大）；
- 删除非布尔值的 `summary`；
- tool 输出截断到 4096 字符；
- 只保留渲染需要的字段。

### 3.6 SSE 流代理

手机通过 `GET /api/v1/opencode/stream` 订阅实时更新。

Control Server 内部：

1. 优先连接 OpenCode 的 `/global/event` SSE；
2. 如果失败，回退到轮询 `/messages` 快照；
3. 把事件转发给手机。

事件类型包括：

- `ready`：流已就绪
- `messages` / `message`：消息更新
- `delta`：流式文本增量
- `part` / `part_removed`：part 更新/删除
- `permission` / `question`：权限/问题请求
- `session_status` / `heartbeat` / `error` / `end`

## 4. 遇到过什么难题？

### 4.1 难题一：手机和电脑不在同一网段

**现象**：有时候手机明明和电脑连着同一个 Wi-Fi，但扫描不到。

**根因**：某些路由器会把 2.4G 和 5G、或者访客网络和主网络隔离成不同网段；手机热点也可能用 `172.20.10.x` 这种特殊网段。

**解决**：

- 扫描不止本机前缀，还包括常见前缀：`192.168.0`、`192.168.1`、`192.168.50`、`10.0.0`、`172.20.10`；
- 缓存历史设备，优先从上次成功的 IP 附近开始探测；
- 提供手动输入 baseUrl 的入口。

### 4.2 难题二：配对码被 firewall/热点拦截

**现象**：手机能扫到电脑，但配对失败。

**根因**：某些网络环境会限制未加密 HTTP 或短暂连接。

**解决**：

- 支持 `none` 模式，完全关闭认证（适合本地开发或可信网络）；
- 二维码配对把 baseUrl 和 pair code 一起编码，减少手动输入错误；
- 如果 token 失效，手机端自动用缓存的 pair code 重新配对。

### 4.3 难题三：SSE 在移动端不稳定

**现象**：手机锁屏、切换网络、进入后台后，SSE 断开，消息不更新。

**根因**：移动操作系统对后台长连接有限制，网络切换也会断连。

**解决**：

- SSE 只做实时提示；
- 同时维护独立的分页拉取逻辑做兜底；
- 重新连接后，用 `before` 游标拉取断连期间新增的消息；
- 本地 MMKV 缓存聊天快照，断网也能先展示旧内容。

### 4.4 难题四：消息体积大

**现象**：长对话的消息体很大，手机加载慢、耗流量。

**根因**：OpenCode 消息包含完整 system prompt、tool 输出、parts 等，手机不需要全部字段。

**解决**：

- Control Server 做消息压缩：去掉 system prompt、截断 tool 输出、只保留必要字段；
- 移动端分页拉取，不是一次性加载全部历史；
- 本地缓存快照，避免每次重新拉取完整历史。

### 4.5 难题五：token 跨运行保持一致

**现象**：电脑重启后，手机端保存的 token 失效，需要重新配对。

**根因**：早期 token 存在内存里，进程结束就丢了。

**解决**：

- Bearer Token 生成后持久化到 `control-auth.json`；
- 只要文件还在，电脑重启后 token 不变，手机无需重新配对。

## 5. 数据流总结

```
手机打开发现页面
  ↓
expo-network 获取本机 IP 前缀
  ↓
构造 254 个候选地址
  ↓
并发探测 http://<ip>:4100/api/v1/health
  ↓
发现电脑，缓存到 MMKV
  ↓
用户输入配对码（或扫描二维码）
  ↓
POST /api/v1/auth/pair
  ↓
拿到 Bearer Token，存 MMKV
  ↓
后续所有请求带 Authorization: Bearer <token>
  ↓
GET /api/v1/opencode/session 等
  ↓
Control Server 转发给本地 OpenCode
```

## 6. 面试可以怎么讲

> Giteam 的手机端不是直接跑 OpenCode，而是作为瘦客户端连到电脑端的 Control Server。Control Server 是 Rust 写的 HTTP 服务，默认监听 4100 端口，负责认证、代理 OpenCode API、压缩消息数据。
>
> 手机发现电脑我们没有用 mDNS，因为很多网络环境会禁多播。我实现了一个 IPv4 网段扫描：先拿本机 IP 前缀，再并发探测 254 个地址的 health 接口，8 个 worker、2.2 秒超时。还会扫描一些常见网段比如 192.168.0、10.0.0、172.20.10，处理热点和子网隔离的情况。
>
> 认证用 6 位配对码换长期 Bearer Token。token 生成后持久化到电脑本地文件，电脑重启也不会失效。手机端如果 token 过期，会自动用缓存的配对码重新换 token。
>
> 消息同步方面，Control Server 会对 OpenCode 返回的消息做压缩，比如去掉 system prompt、截断 tool 输出。手机用 SSE 实时收消息，同时用分页拉取做兜底，弱网和断连情况下也能恢复。

# ADR-0002: 云端中继连接手机与本地 Control Server

**Date**: 2026-08-11  
**Status**: proposed  
**Deciders**: Giteam maintainers

## Context

手机端目前通过局域网 HTTP Control Server（默认 `0.0.0.0:4100`）直连本机 CLI：6 位配对码换 Bearer，业务走 REST，流式走 SSE。Agent 在本机 `PiAgentService` 内执行。`public_base_url` 仅用于二维码展示外网地址，没有中继实现。

异地访问本机开发环境需要公网可达入口，但不能把 Agent、仓库与工具执行搬到云端，也不能把现有 Local 模式替换掉。产品需要默认云、运维控制台、多 CLI 同时在线，以及可 docker-compose 部署到集群的形态。

## Decision

增加 **Cloud Relay** 连接平面，并锁定以下产品/技术决策：

1. **本地服务不变**：Control Server、`PiAgentService`、仓库与工具仍在本机 CLI 进程。
2. **云端只做鉴权、路由、双向转发与运维控制面**：手机请求经 CLI 出站隧道转到本机 `127.0.0.1:<control-port>`，响应/SSE 原路返回。
3. **Local 模式完整保留**。
4. **MVP 转发**：CLI tunnel 本地回环 HTTP 代理，复用现有 `/api/v1/*`。
5. **提供默认可配置云入口**：客户端与 QR 使用 `PUBLIC_BASE_URL` / `DEFAULT_CLOUD_BASE_URL`（支持域名或公网 IP）；上线前由运维填入，代码不绑死域名。
6. **Admin Console**：独立 Web 控制台（shadcn/ui），管理 workspace、已连接设备、access key、吊销与在线状态。
7. **多 CLI 同时在线**：同一 workspace 允许多台 device；手机请求按 `deviceId` 路由（Header > JWT `did` > 默认设备）。
8. **Client 凭证用 JWT**：`redeem` 签发 HS256 JWT（`wid`/`did`/`jti`）；`jti` 黑名单支持吊销。
9. **一 workspace 一把 accessKey**；设备 QR 带该 key + 本机 `deviceId`。
10. **Phase 1 Gateway 单实例**承载 tunnel；docker-compose 部署（gateway + postgres + console）。

## Alternatives Considered

### Alternative 1: 公网直接暴露本机 4100

- **Pros**: 改动最小。
- **Cons**: NAT 难穿透；弱配对码不适合公网。
- **Why not**: 不满足默认云与设备管理。

### Alternative 2: Agent 整体上云

- **Pros**: 手机只连云。
- **Cons**: 仓库/工具远程化等于新产品。
- **Why not**: 消息必须落到本地环境。

### Alternative 3: 仅 frp/ngrok 人工隧道

- **Pros**: 可验证 SSE。
- **Cons**: 无默认云、控制台、多设备路由。
- **Why not**: 非正式架构。

### Alternative 4: 单 CLI 在线 / 拒绝双在线

- **Pros**: 路由简单。
- **Cons**: 笔记本+台式场景差。
- **Why not**: 已明确要求多 CLI 同时在线。

### Alternative 5: Opaque client token

- **Pros**: 吊销只需删库。
- **Cons**: 每次请求都查库。
- **Why not**: 选用 JWT + `jti` 黑名单，兼顾无状态校验与吊销。

## Consequences

### Positive

- Local / Cloud 共用 Agent HTTP/SSE 契约。
- 默认云降低手机配置成本；同一 compose 栈可本地调试与集群部署。
- 控制台可运维设备与密钥；多 device 路由明确。

### Negative

- 新增 Gateway、Console、隧道客户端与部署工件。
- 多 device 时手机/扫码需带 `deviceId` 或默认设备选择。
- JWT 吊销依赖黑名单/短 TTL。

### Risks

- Tunnel hub 多实例时需粘性或共享 presence（compose/K8s 要设计）。
- 控制台权限（admin secret）泄露风险需强制与文档化。

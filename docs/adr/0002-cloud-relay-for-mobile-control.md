# ADR-0002: 云端中继连接手机与本地 Control Server

**Date**: 2026-08-11  
**Status**: proposed  
**Deciders**: Giteam maintainers

## Context

手机端目前通过局域网 HTTP Control Server（默认 `0.0.0.0:4100`）直连本机 CLI：6 位配对码换 Bearer，业务走 REST，流式走 SSE。Agent 在本机 `PiAgentService` 内执行。`public_base_url` 仅用于二维码展示外网地址，没有中继实现。

异地访问本机开发环境需要公网可达入口，但不能把 Agent、仓库与工具执行搬到云端，也不能把现有 Local 模式替换掉。

## Decision

增加 **Cloud Relay** 连接平面：

1. **本地服务不变**：Control Server、`PiAgentService`、仓库与工具仍在本机 CLI 进程。
2. **云端只做鉴权、路由与双向转发**：接收手机请求，经 CLI 出站隧道转到本机 `127.0.0.1:<control-port>`，再把响应/SSE 回传手机。
3. **Local 模式完整保留**：局域网地址 + 配对码路径继续可用。
4. **MVP 转发策略**：CLI tunnel 用本地回环 HTTP 代理复用全部现有 `/api/v1/*` 路由，不在云端重实现 Agent API。

手机在 Cloud 模式下只配置云端入口与连接密钥（或扫码），不再依赖局域网 IP。

## Alternatives Considered

### Alternative 1: 公网直接暴露本机 4100（仅配 `public_base_url` / 反向代理）

- **Pros**: 改动最小。
- **Cons**: NAT/防火墙难穿透；现有 6 位配对码与长期 Bearer 不适合公网；无多租户路由。
- **Why not**: 不满足「密钥连接 + 可靠异地访问」。

### Alternative 2: 将 Agent 整体部署到云服务器

- **Pros**: 手机只连云，无本机在线依赖。
- **Cons**: 仓库、shell、浏览器、密钥都需远程化，等于新产品。
- **Why not**: 明确要求消息落到本地环境执行。

### Alternative 3: 依赖用户自建 frp/ngrok/Cloudflare Tunnel

- **Pros**: 可快速验证公网 SSE。
- **Cons**: 无产品化配对、在线状态、吊销与多设备体验。
- **Why not**: 可作为 Phase 0 验证手段，不能作为正式架构。

### Alternative 4: WebRTC P2P（云仅信令）

- **Pros**: 数据面可绕开中继，延迟更好。
- **Cons**: NAT 穿越与移动端兼容复杂，MVP 风险高。
- **Why not**: 留作后续优化，不作为首版。

## Consequences

### Positive

- Local 与 Cloud 共用同一套 Agent HTTP/SSE 契约，手机业务层改动可控。
- Agent 安全边界与数据仍在用户机器。
- 云端可独立部署、扩容、替换实现，不耦合 `control.rs` 内核。

### Negative

- 增加 Cloud Gateway 与 CLI outbound tunnel 两套新组件。
- 多一跳延迟；SSE 经双跳更容易断线，需要心跳与重连策略。
- 默认信任模型下云可见明文流量（除非后续做 E2E）。

### Risks

- **本机必须在线且已 link**：产品需明确提示「设备未上线」。
- **密钥泄露**：Cloud 必须支持吊销与轮换；禁止 Cloud 模式 `noAuth`。
- **协议漂移**：tunnel 帧需稳定版本化，避免与 Control API 演进打架。

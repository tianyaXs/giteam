# Cloud Relay Phase 1 实施计划

> **状态：** 执行中（Gateway/CLI/Mobile/Desktop/Console 主路径已落地；待 Docker 联调验收）  
> **日期：** 2026-08-11  
> **规格：** [2026-08-11-cloud-relay-mobile-control-design.md](../specs/2026-08-11-cloud-relay-mobile-control-design.md)  
> **ADR：** [0002](../../adr/0002-cloud-relay-for-mobile-control.md)

## 目标

交付可本地 `docker compose up` 跑通的云中继 MVP：

- 多台 CLI 可 link 同一 workspace 并同时 online
- 手机用 accessKey 换 JWT，按 device 转发 prompt/SSE
- Admin Console（shadcn）可看设备、吊销、轮换 key
- Local 局域网模式不受影响
- 公网入口仅配置 `PUBLIC_BASE_URL`（域名或 IP，上线前再填）

## 非目标

- 不上 Redis、不做 Gateway 多副本 tunnel
- 不做请求日志页、C 端账号、E2E 加密
- 不迁 Agent 上云

## 技术选型（已定）

| 部件 | 选型 |
|------|------|
| Gateway | Rust + axum + tokio-tungstenite + sqlx + jsonwebtoken |
| DB | Postgres 16 |
| Console | Vite + React + TS + Tailwind + shadcn |
| CLI tunnel | `giteam-core` 新模块 `cloud` |
| 部署 | `services/cloud/docker-compose.yml` |

## 目录落点

```text
services/cloud/
  docker-compose.yml
  .env.example
  gateway/                 # Cargo 工程
  README.md
apps/cloud/                # Admin UI (Giteam Cloud)
crates/giteam-core/src/cloud/
apps/cli/src/…             # cloud 子命令
apps/desktop/…             # 云端设置
apps/mobile/…              # Cloud 配对
```

---

## Workstream A — Cloud Gateway + Compose

### A1. 脚手架与 compose

- [ ] 创建 `services/cloud/gateway`（axum 二进制）
- [ ] `docker-compose.yml`：`postgres` / `gateway` / `console`
- [ ] `.env.example`：`DATABASE_URL` `JWT_SECRET` `ADMIN_TOKEN` `PUBLIC_BASE_URL`
- [ ] README：本地启动、真机调试时 `PUBLIC_BASE_URL=http://<电脑局域网IP>:8787`

### A2. Schema 与仓库层

- [ ] 迁移：`workspaces` `devices` `jwt_blacklist` `audit_events`
- [ ] accessKey / deviceToken **只存 hash**（sha256 + 前缀 id）
- [ ] 生成：`ws_` `dev_` `gtm_aks_` `gtm_dev_` `ltk_` 前缀

### A3. 控制面 API

- [ ] `POST /cloud/v1/device/link/begin`（创建或带 accessKey 加入）
- [ ] `POST /cloud/v1/device/link/complete`
- [ ] `POST /cloud/v1/auth/redeem` → JWT（claims: `wid` `did` `jti`，TTL 24h）
- [ ] `GET /cloud/v1/workspace/status`
- [ ] `POST /cloud/v1/workspace/access-key/rotate`
- [ ] `POST /cloud/v1/auth/revoke`
- [ ] 错误体统一：`{ "code", "message", "devices"? }`

### A4. Admin API

- [ ] Bearer `ADMIN_TOKEN`
- [ ] workspaces / devices CRUD 读 + revoke + rotate + set default device
- [ ] Overview 计数：workspace 数、online 设备数

### A5. Tunnel Hub + 反代

- [ ] `WSS /cloud/v1/tunnel`（deviceToken）
- [ ] 内存 `deviceId → connection`；同 id 新连踢旧
- [ ] 心跳 15s / 超时 45s
- [ ] 白名单反代 `/api/v1/health|agent/*|repository/list`
- [ ] 路由：`X-Giteam-Device-Id` > JWT `did` > `default_device_id`
- [ ] SSE：chunk 原样透传；取消传播
- [ ] body 上限 8MiB → `413 payload_too_large`
- [ ] Phase 1 文档标明 Gateway **单实例**

**A 验收：** curl redeem + 假 tunnel echo health 通过。

---

## Workstream B — CLI Tunnel Client

### B1. 配置与命令

- [ ] `crates/giteam-core/src/cloud/`：config、link、tunnel client
- [ ] 落盘旁路 `control-server.json`（如 `cloud-link.json`）
- [ ] CLI：`giteam cloud link|status|unlink|devices|access-key`
- [ ] `service serve` 在 enabled 时拉起 tunnel 监督任务（指数退避重连）

### B2. 回环转发

- [ ] 收到 `http.request` → `127.0.0.1:{controlPort}`
- [ ] 流式读响应 → `responseStart/Body/End`
- [ ] 同进程 tunnel service token（仅 loopback），不把 JWT 写入本地 auth

**B 验收：** 两进程/两配置模拟两 device，均 online；经 Gateway 打到各自 control health。

---

## Workstream C — Admin Console

### C1. 工程

- [ ] `apps/cloud`：Vite React TS Tailwind
- [ ] 初始化 shadcn；页面壳 Sidebar

### C2. 页面

- [ ] `/login`：保存 `ADMIN_TOKEN`（localStorage）
- [ ] `/` Overview 计数
- [ ] `/devices` Table：online Badge、revoke
- [ ] `/workspaces` + `/workspaces/:id`：设备、default device、rotate key（Dialog 一次展示）
- [ ] 轮询 presence（5–10s）

**C 验收：** compose 起 console，能看到 B 连上的设备并 revoke。

---

## Workstream D — Mobile

### D1. 连接模型

- [ ] `ConnectionProfile`：`mode: local|cloud`
- [ ] 内置 `DEFAULT_CLOUD_BASE_URL`（可被设置/QR 覆盖；默认指向空或文档占位，dev 包可写局域网）
- [ ] `redeemCloudAccess`；JWT + `deviceId` 持久化
- [ ] 多设备 `409` → 选择器
- [ ] agent client 增加 `X-Giteam-Device-Id`
- [ ] 扫码解析 `mode==="cloud"`；无 mode 视为 local
- [ ] 401 自动 redeem；`device_offline` 文案

**D 验收：** 真机/模拟器经本地 Gateway 完成一轮 prompt + SSE。

---

## Workstream E — Desktop

### E1. 云端设置

- [ ] 设置区：cloud URL、link/unlink、online、设备名
- [ ] 手机 Cloud QR（payload 含 mode/cloudBaseUrl/accessKey/deviceId）
- [ ] 局域网 QR 保留并文案区分

**E 验收：** Desktop link 后 Console 可见；QR 可被 Mobile 扫入。

---

## 推荐执行顺序

```text
A1 → A2 → A3 → A5（hub 最小） → B1/B2 → A4 → C → D → E → 硬化与文档
```

垂直切片优先：**health 通 → prompt/SSE 通 → Console/Mobile/Desktop 包一层**。

## 测试清单

| # | 用例 |
|---|------|
| 1 | `docker compose up` 健康 |
| 2 | CLI-A 创建 workspace；CLI-B 用 accessKey 加入；两者 online |
| 3 | 手机 redeem 选 A / 选 B 各 prompt + SSE |
| 4 | 拔掉 A tunnel → 选 A 得 `device_offline`；选 B 仍可用 |
| 5 | Console revoke A → A 无法重连直至重新 link |
| 6 | rotate accessKey → 旧 key redeem 401；新 key 成功 |
| 7 | Local 模式回归（不经云） |
| 8 | 超大 body → 413 |

## 风险与对策

| 风险 | 对策 |
|------|------|
| 真机访问本机 Gateway | README 写清用电脑 LAN IP，勿用手机上的 127.0.0.1 |
| SSE 双跳断流 | 15s 心跳；手机侧保留现有重连 |
| axum 与现有 control 自研 HTTP 差异 | tunnel 只当原始 TCP/HTTP 客户端，不解析 SSE 语义 |
| npm-src 镜像 | 改 `giteam-core` 后按仓库惯例 sync CLI 源 |

## 完成定义（Phase 1 Done）

- [ ] 规格验收清单全部勾选
- [ ] `services/cloud/README.md` 可独立按文档起环境
- [ ] ADR-0002 状态可改为 `accepted`

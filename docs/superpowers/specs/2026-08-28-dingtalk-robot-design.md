# 钉钉机器人接入设计

> 日期：2026-08-28  
> 状态：实施中  
> 关联：群自定义机器人 Webhook（发消息）+ Outgoing → Cloud Gateway → Desktop Agent（双向 @）

## 1. 目标与场景

1. **一期（只发）**：Agent / 用户通过配置的群自定义机器人 Webhook，向钉钉群发送 `text` / `markdown` 消息（含加签、可选 `@`）。
2. **二期（双向）**：群内 `@机器人` 时，钉钉 Outgoing 回调经公网 Gateway 隧道转到本机 Desktop，触发 Agent `prompt`，再用 `sessionWebhook`（失败回退自定义机器人 Webhook）回群。

本方案**不走**开放平台企业应用 AppKey/OAuth；默认「群自定义机器人」。

## 2. 已锁定决策

| 决策 | 结论 |
|------|------|
| 机器人类型 | 群自定义机器人（Webhook + 可选加签 Secret） |
| 入站公网入口 | Cloud Gateway `POST /cloud/v1/dingtalk/outgoing` |
| 桌面可达性 | 已有 device tunnel（HTTP-over-WS），不直连 `127.0.0.1` |
| Secret 存储 | 本地 vault（`auth.json` 风格）；Gateway 绑定表存 Outgoing Secret 明文以供 HMAC 校验 |
| Agent 出站 | 工具 `dingtalk_send`，`InteractionRisk::Network` + 审批 |
| 回群优先 | payload `sessionWebhook` → 失败再自定义机器人 Webhook |

## 3. 一期：只发

### 配置

- 非敏感：`~/.giteam/dingtalk.json`（Webhook URL、双向开关、绑定仓库/会话）
- 敏感：`SecretStore`（`dingtalk_sign` / `dingtalk_outgoing`）

### 工具 `dingtalk_send`

| 参数 | 说明 |
|------|------|
| `msgtype` | `text` \| `markdown` |
| `content` | 正文（markdown 时为 markdown 文本） |
| `title` | markdown 可选标题 |
| `at_all` | 是否 `@所有人` |
| `at_mobiles` | 手机号列表 |

加签：`timestamp + "\n" + secret` → HMAC-SHA256 → Base64 → URL encode，拼到 Webhook query。

### 桌面

Settings「钉钉」分区：Webhook、加签 Secret、测试发送；二期再展示 Outgoing URL / 允许触发。

## 4. 二期：双向

```text
钉钉群 @机器人
  → DingTalk POST Outgoing
  → Gateway 校验 timestamp+sign
  → 立即 200 应答钉钉
  → 异步 tunnel proxy → Desktop Control POST /api/v1/dingtalk/outgoing
  → Desktop 建/复用 session + prompt
  → POST sessionWebhook（或 Webhook 回退）回群
```

### Gateway

| 路由 | 鉴权 | 作用 |
|------|------|------|
| `POST /cloud/v1/dingtalk/outgoing?workspace=` | Outgoing Secret 签名 | 公开回调 |
| `PUT /cloud/v1/dingtalk/binding` | Device token | 注册/更新绑定（secret、enabled） |
| `GET /cloud/v1/dingtalk/binding` | Device token | 查询绑定与 Outgoing URL |
| `DELETE /cloud/v1/dingtalk/binding` | Device token | 清除绑定 |

表 `dingtalk_bindings`：`workspace_id`、`device_id`、`outgoing_secret`、`enabled`。

选设备：绑定 `device_id` → 否则 workspace `default_device_id` → 单台上线自动选。

### Desktop Control

`POST /api/v1/dingtalk/outgoing`：校验本地 `allow_trigger`；立即 202；后台 prompt；用 `sessionWebhook` 回群。

## 5. 安全

- Outgoing：HMAC + 时间窗（约 1 小时）
- workspace/device 绑定，避免 query 塞密钥
- 可选：未配置仓库路径时拒绝触发
- `dingtalk_send` 走 Network 审批；域名级 always 键 `dingtalk_send:oapi.dingtalk.com`

## 6. 验收

### 一期

1. Settings 可保存 Webhook + Secret；测试发送进群  
2. Agent 调 `dingtalk_send` 需 Network 审批；加签正确  
3. `text` / `markdown`、`@all` / `@mobile` 可用  

### 二期

1. Outgoing URL 可复制；绑定后 Gateway 有记录  
2. 群内 `@机器人` → 本机 Agent 执行 → 群内收到回复  
3. `allow_trigger=false` 时不触发；设备离线时 Gateway 记审计、不拖死钉钉回调  
4. `sessionWebhook` 过期时回退自定义机器人 Webhook（若已配置）

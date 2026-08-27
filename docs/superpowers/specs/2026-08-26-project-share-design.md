# 项目分享（Project Share）设计

> 日期：2026-08-26
> 状态：P2 最小闭环已实现（代码 `repo.git` dumb-HTTP + 上下文独立 `context.tar.zst`；P1 单包仍可导入兼容）；P3 未实施
> 关联：`2026-08-11-cloud-relay-mobile-control-design.md`（Cloud Relay / Gateway）

## 1. 目标与场景

分享者在桌面端把一个本地项目「发布」为一个云端地址，接收人打开该地址即可完成项目初始化，初始化后拥有分享者导出时刻的：

- 代码快照（云端 git remote：`/s/<shareId>/repo.git`，由 `git bundle` 物化）
- AI 会话记录（`~/.giteam/pi-sessions/repos/<key>/session-*.jsonl`）
- 项目记忆 / 资产图谱（`~/.giteam/memory/repos/<key>/memory.db`）
- 项目级附件（`<repo>/.giteam/prompt-attachments/`）
- 可选：Review 记录（`client.db.review_records` 按 `repo_path` 归属）

非目标（本期不做）：实时协同、双向同步、分享后再编辑合并。

## 2. 核心概念

**Share = 一次导出时刻的不可变快照**。包含两部分，**分开上传**：

1. **代码包**：`git bundle` → Gateway finalize 时 `git clone --bare` + `update-server-info` → 公开 dumb-HTTP
2. **上下文包（context pack）**：会话、记忆、附件 + `manifest.json` → `context.tar.zst`

云端返回分享地址：

```
https://<cloud>/s/<shareId>
```

- 浏览器打开 → 落地页
- Desktop/CLI → 下载上下文 + `git clone` remote（失败回退 bundle）→ rekey
- `origin` 指向 `https://<cloud>/s/<id>/repo.git`（可继续 `git pull`；增量 `share push` 仍属后续）

### 2.1 URL 与凭据设计

| 组成 | 说明 |
|------|------|
| `shareId` | `shr_<128bit 随机>`，本身即 capability（不可枚举）；云端可对下载再要求独立 token |
| `#k=<encKey>` | E2E 加密密钥放 URL fragment，**不发送到服务器**，云端零知识；未加密模式则无 fragment |
| 深链 | `giteam://import?url=<urlencoded>`（Desktop 经 tauri-plugin-deep-link；移动端复用 `parsePairPayload` 的 URL 分支思路扩展） |
| CLI | `giteam init --from <url> [--dir <path>]` / `giteam share import <url>` |

## 3. 导出端（分享者）

入口：Desktop 侧边栏项目右键「分享…」+ CLI `giteam share create [--all|--shallow N] [--no-redact] [--encrypt]`。

### 3.1 流程

1. **预检**
   - 必须是 git 仓库；提示未提交变更（bundle 不含 working tree，可选附 `git diff` 补丁包）
   - 估算产物体积，超阈值（默认 500MiB）要求确认或改用浅快照
   - 要求设备已 `cloud link`（复用 device token 鉴权上传）
2. **代码包**：`git bundle create <tmp> <refs...>`（默认 `HEAD` + tags）
3. **收集上下文**
   - 会话：`pi_sessions_dir_for_repo(repo)` 下全部 `session-*.jsonl`（**只收 `.jsonl` 正文**，排除 `.bak` / `-wal` / `-shm` / `.lock` sidecar）；`catalog.json` 中 `repoPath` 匹配的条目摘录；同时收 `repos/<key>/repo.json`（导入端重写 `repoPath` 的依据）
   - 记忆：`memory_db_path_for_repo(repo)`，用 `VACUUM INTO` 取一致性快照（WAL 模式下避免丢失未 checkpoint 数据；`file_key` 已做仓内相对化，路径重写压力小）
   - 附件：`<repo>/.giteam/prompt-attachments/`
   - 可选：从 `client.db` 按 `repo_path` **SELECT 抽行**导出 `review_records` / `review_actions`（严禁整库打包）
4. **脱敏（默认开启）**
   - 内置规则扫描 jsonl/文本内容中的高危串（`sk-`、`gtm_aks_`、`gtm_dev_`、Bearer token、私钥头等），命中即替换为 `***` 并在 manifest 记录命中数
   - **绝不打包**：`client.db`（整库）、`pi-agent/` 凭据、`~/.giteam/updater.key`（Tauri 更新签名私钥）、`remote_repo_configs.api_key`（随 client.db 天然排除）
   - **天然不打包**（位于平台目录而非 `~/.giteam`，收集器只扫 `~/.giteam` 即安全）：`cloud-link.json`（deviceToken/accessKey 明文）、`control-auth.json`、`control-server.json`；导入端也不得触碰这些文件
   - 导出前 UI 展示「将分享 N 个会话 / 记忆库大小 / 命中脱敏条数」，由用户确认
5. **打包**：`manifest.json` + `repo.bundle` + `context/` → `tar.zst`；可选 XChaCha20-Poly1305 加密（密钥随机生成，只出现在 URL fragment）
6. **上传**：分块 multipart（单块 ≤ 4MiB，绕开 Gateway 8MiB body 上限）→ finalize 校验 sha256 → 返回分享 URL，复制到剪贴板

### 3.2 manifest.json

```json
{
  "schemaVersion": 1,
  "shareId": "shr_...",
  "createdAt": "2026-08-26T10:00:00Z",
  "source": { "app": "desktop", "version": "0.1.33", "os": "macos" },
  "repo": {
    "name": "giteam",
    "defaultBranch": "main",
    "headCommit": "abc123...",
    "upstreamUrl": "git@github.com:org/repo.git",
    "bundleRefs": ["refs/heads/main", "refs/tags/*"],
    "originPathHint": "/Users/alice/project/giteam"
  },
  "context": {
    "sessionCount": 12,
    "sessionFiles": ["context/sessions/session-....jsonl"],
    "catalog": "context/catalog.json",
    "memoryDb": "context/memory.db",
    "attachments": "context/attachments/",
    "redactions": 3
  },
  "package": { "format": "tar.zst", "sha256": "...", "sizeBytes": 123456, "encrypted": true }
}
```

`originPathHint` 是导入端做绝对路径重写的依据（见 §5.3），不是安全边界（内容本身含旧路径）。

## 4. 云端（Gateway 扩展）

在现有 `giteam-cloud-gateway` 上扩展，复用其鉴权（device token / ADMIN_TOKEN）与审计。

### 4.1 新表（`migrations/003_shares.sql`）

| 表 | 关键列 |
|----|--------|
| `shares` | `id`(shr_*)，`workspace_id`(CASCADE)，`name`，`repo_name`，`default_branch`，`head_commit`，`size_bytes`，`content_sha256`，`encrypted`，`status`(uploading/active/revoked/expired)，`storage_key`，`expires_at`，`download_count`，`created_at`，`meta_json` JSONB（manifest 公开子集） |

### 4.2 路由

| 路由 | 鉴权 | 说明 |
|------|------|------|
| `POST /cloud/v1/shares` | device token | 创建元数据，返回 `shareId` 与上传凭证 |
| `PUT /cloud/v1/shares/{id}/blob?part=N` | device token | 分块上传 |
| `POST /cloud/v1/shares/{id}/finalize` | device token | 校验 sha256 → `active`，返回完整分享 URL |
| `GET /cloud/v1/shares/{id}` | capability | 公开元信息（名称/大小/commit/时间，**不含内容**），供落地页 |
| `GET /cloud/v1/shares/{id}/download` | capability（+可选 `t=` 下载令牌） | 产物下载，支持 Range |
| `GET /cloud/v1/shares/{id}/repo.git/*` | capability | Phase 2：dumb-HTTP git remote |
| `GET /cloud/v1/shares` | device token | 管理自己 workspace 的分享列表 |
| `DELETE /cloud/v1/shares/{id}` | device token / admin | 撤销 |

### 4.3 存储

抽象 `BlobStore` trait：Phase 1 本地目录（与现有 replicas=1 约束一致）；Phase 2 切换 S3 兼容对象存储 + 预签名 URL 直传（届时 Gateway 才具备水平扩容前提）。

### 4.4 治理

- 默认过期 30 天（创建时可调），后台任务清理过期产物
- 配额：按 workspace 限制总分享存储（默认 5GiB）
- 审计事件：`share.created` / `share.finalized` / `share.downloaded` / `share.revoked`
- 落地页由 `apps/cloud` 增加 `/s/:shareId` 路由渲染

## 5. 接收端（导入初始化）

### 5.1 入口

- 浏览器打开分享 URL → 落地页展示项目快照信息，提供两个动作：
  - 「在 Giteam 中打开」→ `giteam://import?url=...` 深链唤起 Desktop
  - 复制 CLI 命令：`giteam init --from <url>`
- Desktop 深链：新增 `tauri-plugin-deep-link`，弹确认对话框（来源、体积、目标目录）后走与 CLI 相同的 Rust 核心导入函数（放 `giteam-core`，两端复用）

### 5.2 导入流程（`giteam-core::share::import`）

1. 解析 URL → 拉取公开元信息 → 用户确认 → 下载产物（校验 sha256，支持断点/重试）
2. 解密（若 URL 带 `#k=`）
3. 选定目标目录（默认 `~/giteam-projects/<repo-name>/`，冲突时追加序号）
4. `git clone <repo.bundle> <dir>`；`origin` 设置策略：
   - Phase 1：若 manifest 有 `upstreamUrl` 则记为 `upstream` remote；`origin` 指向分享云端地址
   - Phase 2：`origin = https://<cloud>/s/<id>/repo.git`（天然可 `git pull`）
5. **重映射上下文**（关键，见 §5.3）
6. 注册进 `repositories` 表；Desktop 弹出「导入完成」并切换到该项目

### 5.3 重映射规则（rekey）

当前会话/记忆按 `repo_sessions_key(repo_path) = slug-fnv1a64(canonical path)` 隔离，接收方路径必然不同，导入时必须 rekey：

| 数据 | 处理 |
|------|------|
| 会话文件 | 写入 `~/.giteam/pi-sessions/repos/<newKey>/`，文件名保留 |
| `repo.json` | 写入新 key 目录，`repoPath` 重写为新仓库 canonical 路径；检查 `schemaVersion` 兼容性 |
| catalog 条目 | 合并进全局 `catalog.json`：`sessionId` 保留，`repoPath` / `sessionDir` / `sessionPath` 全部重写为新值；按 `sessionId` 幂等去重；检查 `schema_version` 兼容性 |
| 会话 jsonl 内容 | 字符串级替换 `originPathHint` → 新路径（覆盖头行 `cwd`、toolCall 参数中的绝对路径）；替换比例写入导入报告 |
| memory.db | 复制到 `~/.giteam/memory/repos/<newKey>/memory.db`；`file_key` 已相对化，需重写：① `replay_state.path`（会话 jsonl 绝对路径）② `extraction_jobs.input_json` 内的 `repo_path` ③ `nodes.props` / `edges.props` 文本中残留的旧绝对路径（尽力替换） |
| 附件 | 落到 `<newRepo>/.giteam/prompt-attachments/`，文本附件做同样的路径替换 |
| Review 记录 | 以新 `repo_path` 批量插入 `review_records` / `review_actions` |

**实现约束**：

- newKey 必须直接调用 `giteam_core::pi_agent::secrets::repo_sessions_key()` 计算（内含 canonicalize + macOS/Windows 小写化逻辑），禁止自行实现 hash
- 写 `client.db`（注册 repositories、插入 review 记录）必须与 Desktop/control.rs 统一写路径，避免两方直开 SQLite 造成锁冲突（建议收拢到 giteam-core 的 db 函数）

**幂等**：目标目录 `git config giteam.shareId` 记录来源 shareId；重复导入时提示「已导入，直接打开 / 重新导入」。

**已有同仓场景**：`--attach <existingPath>` 模式跳过代码克隆，仅把上下文 rekey 到既有仓库路径。

## 6. 安全与隐私

- **链接即凭据**：`shareId` 128bit 不可枚举；可选下载令牌 / 密码（PBKDF2 派生）
- **E2E 可选**：密钥在 URL fragment，云端只见密文与公开元信息；代价是无法在落地页预览会话摘要
- **脱敏默认开启**，导出前明示将分享的内容清单（会话可能含内部地址、密钥等，必须用户确认）
- 撤销立即生效（产物删除 + 状态翻转）；过期自动清理
- 上传/下载全量审计

## 7. 分阶段实施

| 阶段 | 内容 | 主要改动点 |
|------|------|-----------|
| **P1：一次性分享闭环** | bundle + context pack 上传/下载；CLI `giteam share create` / `giteam init --from`；落地页；rekey 导入 | `giteam-core` 新增 `share` 模块；gateway `003_shares.sql` + 路由；`apps/cloud` 落地页 |
| **P2：云端 git 地址** | dumb-HTTP git remote；`giteam share push` 增量更新；接收方 `origin` 指向云端 | gateway 静态 git 端点；导出端 `git update-server-info`；S3 BlobStore |
| **P3：体验完善** | Desktop 深链 + 右键分享 UI；脱敏预览界面；移动端打开分享；E2E 加密 | tauri-plugin-deep-link；Desktop 分享对话框 |

P1 即可满足「发出地址 → 对方初始化后拥有会话与记忆」的完整闭环。

## 8. 开放问题

1. **大仓策略**：超过配额的仓库是强制浅快照、排除 LFS，还是允许「仅分享上下文（不含代码）」模式（接收方自行 clone 原仓）？
2. **路径重写可靠性**：jsonl 中工具结果、错误堆栈里的绝对路径只能字符串级替换，存在漏网；是否接受「尽力重写 + 导入报告」？
3. **会话 ID 冲突**：保留原 `sessionId` 在多人都从同一分享导入后再互相分享时可能撞 ID，是否需要导入时重新生成（代价：需同步改写 catalog 的 `parentSessionId` 引用与 memory.db 中 `edges.session_id` / 相关节点 props 里的会话引用）？
4. **多副本部署**：blob 落本地目录与 replicas=1 绑定，上 S3 前分享功能是单点。
5. **大文件通道**：Gateway 现有 `max_body_bytes = 8MiB` 且隧道代理全量缓冲，分享上传/下载必须走新增的流式端点（分块 + Range），严禁复用 `/api/v1/*` 隧道代理。

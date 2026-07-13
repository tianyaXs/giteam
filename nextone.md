# Remote Repo 与 Giteam 接入交接文档

交接日期：2026-07-13

本文档面向下一位接手 `remote-repo-skill-brainstorm_2` 和 Giteam 远程仓库接入工作的同学。目标是把当前已经实现的功能、API、调用链、数据结构、关键文件、测试覆盖、风险和后续方向尽量完整地写清楚。读完后应该可以做到：

- 知道远程仓库服务是什么、为什么存在、和 Giteam/OpenCode 的关系是什么。
- 知道服务端每个 API 做什么、需要什么参数、返回什么数据、常见错误是什么。
- 知道 Giteam 桌面端远程仓库 UI 和 Tauri/Rust 桥接分别在哪些文件里。
- 知道 OpenCode skill/MCP 是怎样接入这套服务的。
- 知道如何本地启动、验证、调试和继续开发。

## 1. 一句话概括

这部分工作把“远程仓库会话服务”从一个独立原型推进到 Giteam 产品链路中：服务端负责同步远程 Git 仓库、创建服务端 workspace、执行 shell、读写文件、搜索代码和运行 GitNexus；OpenCode 通过 `opencode-remote-repo` skill 和 `remote_repo` MCP 工具使用这些能力；Giteam 桌面端提供服务配置、仓库列表、仓库概览、只读文件浏览和可写远程工作区面板。

核心思想：

```text
用户 / OpenCode / Giteam UI
        |
        | Tauri command / MCP stdio / HTTP
        v
Remote Repo Service
        |
        | Git mirror + commit-pinned workspace + SQLite state
        v
服务端仓库缓存和 workspace
```

## 2. 工作范围

本次交接范围主要包含两个目录：

```text
remote-repo-skill-brainstorm_2/
giteam/
```

其中 `remote-repo-skill-brainstorm_2` 是独立的远程仓库服务原型，包含服务端、CLI、MCP bridge、OpenCode skill、部署文档和测试。

`giteam` 中对应内容主要是：

- Desktop 前端 remote repo UI。
- Tauri/Rust `remote_repo` command。
- Rust HTTP client 和本地 SQLite 设置存储。
- 内置 `opencode-remote-repo` skill 资源。
- OpenCode skill marketplace 中的内置 skill 条目。

## 3. 关键术语

### repo_id

远程仓库服务内部使用的仓库唯一 ID。所有 API 都用 `repo_id` 识别仓库，而不是直接依赖显示名或 Git URL。

例子：

```text
remote-repo-skill-brainstorm_2_giteam
demo
my-repo
```

### Git mirror / repo cache

服务端对远程仓库做的 mirror 缓存，路径通常是：

```text
{storage_root}/repos/{repo_id}.git
```

它是服务读取分支、commit、文件树和创建 worktree 的基础。新仓库必须先 sync，否则很多 API 会返回 `repo_not_synced`。

### workspace

服务端为一次具体工作创建的可写 worktree。它固定在某个 commit，不会自动跟随分支移动。

路径通常是：

```text
{storage_root}/workspaces/ws_xxx
```

workspace 会有：

- `workspace_id`
- `repo_id`
- `base_commit`
- `workspace_path`
- `workspace_version`
- `dirty`
- `status`

### session

OpenCode/Giteam 对某个 workspace 的操作句柄。所有可写/可执行 API 都需要传 `session_id`。

session ID 格式类似：

```text
sess_...
```

### workspace_version

远程 workspace 的逻辑版本号。创建时为 `1`。如果 shell、write、edit、apply patch 等操作导致 Git status 变化，版本号会递增。

### dirty

workspace 是否有未提交改动。根据 `git status --porcelain` 判断。

### repo_head 与 session_workspace

GitNexus 支持两类分析目标：

- `repo_head`：分析仓库镜像中某个 ref/commit 的只读 HEAD。
- `session_workspace`：分析某个可写 workspace 当前版本。

## 4. 总体调用链

### 4.1 Giteam Desktop 调用链

```text
React UI
  -> remoteRepoApi.ts
  -> invoke("remote_repo", { action, payload })
  -> apps/desktop/src-tauri/src/remote_repo/commands.rs
  -> RemoteRepoClient
  -> HTTP /v1/*
  -> remote-repo-service
```

Giteam 桌面端不会直接读写远程仓库文件。它只通过 Tauri command 调用服务。

### 4.2 Giteam Web 预览调用链

```text
React UI
  -> remoteRepoWebApi.ts
  -> fetch(serviceBase + /v1/*)
  -> remote-repo-service
```

Web 模式没有 Tauri，因此服务地址/API key 保存在浏览器 localStorage 或从 Vite 环境变量读取。

### 4.3 OpenCode / MCP 调用链

```text
OpenCode skill: opencode-remote-repo
  -> remote_repo MCP server
  -> stdio JSON-RPC
  -> mcp_server.py
  -> HTTP /v1/*
  -> remote-repo-service
```

Giteam 内置 OpenCode 使用时，MCP launcher 会从 Giteam 桌面端设置读取 Remote Repo Service URL 和 API key。skill 中明确要求 AI 不要自己去找本地配置、SQLite 或环境变量。

## 5. remote-repo-skill-brainstorm_2 目录结构

核心目录：

```text
remote-repo-skill-brainstorm_2/
├── src/remote_repo_service/
│   ├── app.py
│   ├── cli.py
│   ├── config.py
│   ├── file_reader.py
│   ├── git_ops.py
│   ├── graph.py
│   ├── mcp_server.py
│   ├── models.py
│   ├── session_store.py
│   ├── shell_runner.py
│   ├── state_store.py
│   └── workspace_tools.py
├── skills/opencode-remote-repo/
│   ├── SKILL.md
│   ├── giteam.json
│   ├── agents/openai.yaml
│   ├── references/api.md
│   ├── references/mcp-tools.md
│   ├── scripts/remote_repo_client.py
│   └── mcp/
├── tests/
├── docs/
├── Dockerfile
├── docker-compose.yml
├── service.json
└── pyproject.toml
```

## 6. remote-repo-service 模块职责

### app.py

FastAPI 应用入口。负责：

- 注册 HTTP API。
- 注入 `Settings`、`GitOps`、`SessionStore`、`WorkspaceTools`、`ShellRunner`、`GraphService`。
- 统一成功/失败响应 envelope。
- API key 中间件。
- CORS 配置。
- config reload。
- shutdown 时取消后台 clone task。

### config.py

配置模型和配置文件读写。重点：

- `RepoConfig` 校验 Git URL。
- `Settings` 定义全局参数。
- 支持从 `REMOTE_REPO_SERVICE_CONFIG` 或默认 `service.json` 加载配置。
- `save_to` 用 file lock + 临时文件 + `os.replace` 原子写回配置。

允许的 remote_url 类型：

- 本地绝对路径。
- `file://` 绝对路径。
- `http://` / `https://`。
- `ssh://`。
- SCP-style SSH，例如 `git@github.com:owner/repo.git`。

### git_ops.py

Git 操作封装。负责：

- mirror clone/fetch。
- 仓库同步状态。
- ref/commit 解析。
- 分支列表。
- 只读仓库文件树。
- 只读仓库文件切片。
- worktree 创建和清理。
- Git status/diff summary。

重要行为：

- repo cache 路径是 `{storage_root}/repos/{repo_id}.git`。
- `sync_repo` 如果 cache 已存在，会 `git remote set-url origin` 后 fetch。
- `sync_repo` 如果 cache 不存在，会 `git clone --mirror`。
- auth 失败会标记为 `auth_required`，其他同步失败标记为 `failed`。
- ref 会做安全校验，拒绝空 ref、`-` 开头、包含 `..` 或非法字符的 ref。
- repo 路径会拒绝绝对路径和 `..`，避免逃逸仓库。

### session_store.py

session/workspace 生命周期管理。负责：

- 创建 session/workspace。
- 从 `state.db` 恢复服务重启前的 workspace/session。
- 根据 session_id 获取当前 workspace 状态。
- 恢复已有 workspace。
- 在命令或文件操作后更新 dirty/version/last_command_id。

创建 session 的逻辑：

```text
repo_id + ref_or_commit
  -> 从 mirror cache resolve 到 base_commit
  -> git worktree add --detach 到 storage_root/workspaces/ws_xxx
  -> 创建 workspace_id 和 session_id
  -> workspace_version = 1
  -> dirty = false
  -> 写入 state.db
```

### state_store.py

服务端持久化。SQLite 文件位于：

```text
{storage_root}/state.db
```

表结构：

- `repos`：仓库配置、连接状态、错误信息、最近同步时间。
- `workspaces`：workspace ID、repo、base commit、路径、版本、dirty、状态。
- `sessions`：session ID、workspace、repo、状态、访问时间。
- `gitnexus_indexes`：GitNexus 索引状态。
- `activities`：repo 级活动记录。
- `workspace_operations`：workspace 内操作历史，包括 shell、文件操作、GitNexus 等。

启动恢复逻辑：

- 读取 `workspaces` + `sessions`。
- 检查 workspace 路径是否仍在 `workspace_root` 内。
- 检查路径是否存在。
- 不合法或缺失则标记为 `expired`。
- 可恢复的 workspace/session 会回填到内存索引。

### shell_runner.py

在 session workspace 内执行 shell 命令。返回：

- `command_id`
- `cwd`
- `exit_code`
- `stdout`
- `stderr`
- `elapsed_ms`
- `timed_out`
- `stdout_truncated`
- `stderr_truncated`
- `diff_truncated`
- `status_before`
- `status_after`
- `diff_summary`
- `workspace_version`

限制：

- `cwd` 必须是 workspace 相对路径。
- `cwd` 不能逃逸 workspace。
- 使用 `settings.command_timeout_seconds` 控制超时。
- stdout/stderr/diff 会按配置截断。

安全注意：

当前 V0 仍然是 `shell=True` 执行命令，只做了工作目录、超时和输出大小限制，没有完整沙箱、命令白名单或审计策略。不能裸露公网。

### file_reader.py

读取 session workspace 中的文件切片。特点：

- path 必须是 workspace 相对路径。
- 读取时会计算整个文件的 sha256。
- 默认最多返回 `settings.max_file_slice_lines` 行。
- 返回内容还会被 `settings.max_file_slice_bytes` 限制。
- 每次读取会写入 `workspace_operations`，kind 为 `read_file`。

### workspace_tools.py

提供 session workspace 内文件和搜索工具：

- `list_tools`
- `list_files`
- `find_files`
- `grep`
- `write_file`
- `edit_file`
- `apply_patch`

细节：

- `list_files` 跳过 `.git`。
- `find_files` 支持 glob；如果 query 不含 `*?[]`，则按路径子串大小写不敏感匹配。
- `grep` 使用 Python regex，跳过无法 UTF-8 解码的文件。
- `write_file` 写完整文件，可自动创建父目录。
- `edit_file` 做精确文本替换，默认只替换第一次，`replace_all=true` 时替换全部。
- `apply_patch` 使用 `git apply --whitespace=nowarn -`。
- 写入类操作会更新 workspace dirty/version，并记录 diff summary。

### graph.py

GitNexus 分析封装。负责：

- repo HEAD 或 session workspace 的分析状态。
- 运行 `settings.gitnexus_analyze_command`，默认是：

```text
npx gitnexus analyze --index-only
```

服务会自动补充：

- `--index-only`
- `--name giteam-...`
- `--allow-duplicate-name`

状态枚举：

- `READY`
- `STALE`
- `INDEXING`
- `FAILED`

特殊处理：

- 如果 GitNexus 报 “Analysis did not finalize” 或 registry entry 类不完整索引错误，会删除 workspace 下 `.gitnexus` 后重试一次。
- 分析结果会写入 `gitnexus_indexes`。
- repo/workspace 活动会写入 `activities` 和 `workspace_operations`。

### mcp_server.py

stdio MCP server。它不直接访问仓库文件，只把 MCP tool call 翻译成 HTTP `/v1/*` 请求。

OpenCode 通过该 server 使用 `remote_repo` 工具。

### cli.py / __main__.py

服务 CLI 入口。支持：

- 启动服务。
- 添加/更新/删除仓库。
- 列出仓库。
- 触发同步。
- reload 配置。

## 7. 服务配置

配置文件通常通过环境变量指定：

```bash
export REMOTE_REPO_SERVICE_CONFIG=/absolute/path/service.json
```

如果没有环境变量，会尝试读取当前目录的 `service.json`。

关键配置字段：

```json
{
  "storage_root": ".remote-repo-service",
  "api_keys": [],
  "cors_allowed_origins": ["http://localhost:1420", "http://127.0.0.1:1420"],
  "command_timeout_seconds": 30,
  "max_stdout_bytes": 64000,
  "max_stderr_bytes": 64000,
  "max_diff_bytes": 64000,
  "max_file_slice_bytes": 24000,
  "max_file_slice_lines": 120,
  "gitnexus_analyze_command": ["npx", "gitnexus", "analyze", "--index-only"],
  "repos": {
    "my-repo": {
      "repo_id": "my-repo",
      "name": "my-org/my-repo",
      "remote_url": "https://example.com/my-org/my-repo.git",
      "default_ref": "main",
      "auth_method": "ssh_key",
      "credential_id": "default"
    }
  }
}
```

API key 也可以通过环境变量配置：

```text
REMOTE_REPO_SERVICE_API_KEY
REMOTE_REPO_SERVICE_API_KEYS
```

如果配置了 API key，客户端需要带：

```text
X-API-Key: <key>
```

## 8. 服务端存储布局

推荐部署布局：

```text
/etc/giteam/remote-repo-service.json
/var/lib/giteam/remote-repo-service/
├── state.db
├── repos/
├── workspaces/
└── graph-worktrees/
```

本地开发时一般是：

```text
remote-repo-skill-brainstorm_2/.remote-repo-service/
```

注意：`storage_root` 必须放在持久磁盘或 Docker volume 中，否则服务重启/容器重建后 workspace 和状态会丢失。

## 9. HTTP API 统一响应格式

大部分 POST API 返回统一 envelope。

成功：

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "repo_id": "demo",
  "session_id": "sess_xxx",
  "state": {},
  "data": {},
  "warnings": []
}
```

失败：

```json
{
  "ok": false,
  "request_id": "req_xxx",
  "repo_id": "demo",
  "session_id": "sess_xxx",
  "state": {},
  "error": {
    "code": "repo_not_found",
    "message": "Repository not found",
    "retryable": false,
    "details": {}
  }
}
```

`request_id` 由客户端传入，用于串联日志和调试。

## 10. HTTP API 清单

下面按功能列出当前已经实现的服务端 API。

### 10.1 基础状态

#### GET `/`

用途：返回内置静态页面 `static/index.html`。

实现位置：`app.py` 的 `frontend()`。

#### GET `/v1/health`

用途：健康检查。

返回：

```json
{
  "service": {
    "status": "ready",
    "version": "0.1.0"
  }
}
```

#### GET `/v1/dashboard`

用途：Giteam 设置页测试服务地址时使用；返回服务状态和仓库摘要。

返回：

```json
{
  "service": {
    "status": "ready",
    "version": "0.1.0"
  },
  "repos": []
}
```

仓库摘要来自 `repo_summary(repo_id)`，包含 repo id、显示名、remote URL/origin、provider、默认 ref、默认 commit、sync 状态、错误信息、最近同步时间等。

### 10.2 仓库配置与同步

#### POST `/v1/repos`

用途：列出当前服务配置中的所有仓库。

请求：

```json
{
  "request_id": "req_repos"
}
```

返回 data：

```json
{
  "repos": [
    {
      "repo_id": "demo",
      "name": "Demo",
      "remote_url": "...",
      "origin": "...",
      "provider": "github|gitlab|local|unknown",
      "default_ref": "main",
      "default_commit": "完整 SHA 或 null",
      "sync_status": "connected|syncing|auth_required|failed|stale",
      "synced": true,
      "error_message": null,
      "last_synced_at_ms": 1234567890
    }
  ]
}
```

#### POST `/v1/repos/add`

用途：动态添加一个仓库到服务配置，并排队后台 clone。

请求：

```json
{
  "request_id": "req_add",
  "repo_id": "demo",
  "name": "Demo",
  "remote_url": "https://example.com/demo.git",
  "default_ref": "main",
  "auth_method": "ssh_key",
  "credential_id": "default"
}
```

必填：

- `request_id`
- `repo_id`
- `name`
- `remote_url`

可选：

- `default_ref`，默认 `main`
- `auth_method`
- `credential_id`

实现细节：

- 校验 repo_id 是否已存在。
- 构造 `RepoConfig` 并写入 `settings.repos`。
- 如果服务有 config path，会写回配置文件。
- 写入 `state.db` 的 `repos` 表。
- 写入 activity：`repo_added`。
- 调用 `git_ops.queue_clone(repo)` 后台 clone。

返回 data：

```json
{
  "repo_id": "demo",
  "sync_queued": true
}
```

常见错误：

- `repo_id_exists`
- `config_persist_failed`

#### POST `/v1/repos/remove`

用途：从服务配置中删除仓库。

请求：

```json
{
  "request_id": "req_remove",
  "repo_id": "demo"
}
```

实现细节：

- 从 `settings.repos` 删除。
- 写回配置文件。
- `git_ops.forget_repo(repo_id)` 删除内存同步状态。
- `state_store.delete_repo_config(repo_id)` 删除 repo config。
- 写入 activity：`repo_removed`。

返回 data：

```json
{
  "repo_id": "demo",
  "removed": true
}
```

常见错误：

- `repo_not_found`
- `config_persist_failed`

#### POST `/v1/repos/update`

用途：更新仓库配置。

请求：

```json
{
  "request_id": "req_update",
  "repo_id": "demo",
  "name": "New Name",
  "remote_url": "https://example.com/new.git",
  "default_ref": "develop",
  "auth_method": "ssh_key",
  "credential_id": "default"
}
```

只有 `repo_id` 必填，其余字段可选。传了 `remote_url` 或 `default_ref` 时，会把 repo sync 状态标记为 stale，需要重新同步。

返回 data：

```json
{
  "repo_id": "demo",
  "updated": true,
  "requires_sync": true
}
```

常见错误：

- `repo_not_found`
- `repo_update_failed`
- `config_persist_failed`

#### POST `/v1/config/reload`

用途：从磁盘重新加载配置文件。适用于外部工具修改了配置文件后让服务刷新内存状态。

请求：

```json
{
  "request_id": "req_reload"
}
```

返回 data：

```json
{
  "repos": []
}
```

常见错误：

- `config_path_not_set`
- `config_reload_failed`

#### POST `/v1/repos/sync`

用途：同步仓库 mirror cache。

请求：

```json
{
  "request_id": "req_sync",
  "repo_id": "demo"
}
```

实现细节：

- 如果 `{storage_root}/repos/{repo_id}.git` 已存在：更新 origin URL，执行 fetch/prune。
- 如果不存在：执行 `git clone --mirror`。
- 成功后状态为 `connected`，记录 `last_synced_at_ms`。
- 失败时根据错误判断 `auth_required` 或 `failed`。
- 写入 activity：`repo_synced`。

返回 data：

```json
{
  "cache_path": "/path/to/storage/repos/demo.git"
}
```

常见错误：

- `repo_not_found`
- `auth_required`
- `failed`
- `sync_failed`

#### POST `/v1/repos/branches`

用途：读取已同步 mirror 中的分支列表，不创建 workspace。

请求：

```json
{
  "request_id": "req_branches",
  "repo_id": "demo"
}
```

返回 data：

```json
{
  "branches": [
    {
      "name": "main",
      "short_sha": "abc1234",
      "is_default": true
    }
  ]
}
```

常见错误：

- `repo_not_found`
- `repo_not_synced`
- `repository_read_failed`

#### POST `/v1/repos/files/list`

用途：读取 repo mirror 中某个 ref/commit 的只读文件树，不创建 workspace。

请求：

```json
{
  "request_id": "req_tree",
  "repo_id": "demo",
  "ref_or_commit": "main",
  "path": ".",
  "max_entries": 200
}
```

字段：

- `ref_or_commit` 可选，不传时使用 repo 的 `default_ref`。
- `path` 默认 `.`。
- `max_entries` 范围 1 到 500，默认 200。

返回 data：

```json
{
  "ref": "main",
  "commit": "完整 commit SHA",
  "path": ".",
  "entries": [
    {
      "name": "README.md",
      "path": "README.md",
      "kind": "file",
      "short_sha": "abc1234"
    },
    {
      "name": "src",
      "path": "src",
      "kind": "directory",
      "short_sha": "def5678"
    }
  ]
}
```

常见错误：

- `repo_not_found`
- `repo_not_synced`
- `invalid_repository_path`
- `repository_read_failed`

#### POST `/v1/repos/files/read`

用途：读取 repo mirror 中某个 ref/commit 的只读文件内容切片，不创建 workspace。

请求：

```json
{
  "request_id": "req_read_repo_file",
  "repo_id": "demo",
  "ref_or_commit": "main",
  "path": "README.md",
  "start_line": 1,
  "max_lines": 120
}
```

返回 data：

```json
{
  "ref": "main",
  "path": "README.md",
  "commit": "完整 commit SHA",
  "start_line": 1,
  "end_line": 120,
  "content": "...",
  "truncated": true,
  "sha256": "..."
}
```

限制：

- `max_lines` 最多 500，但实际还会受 `settings.max_file_slice_lines` 限制。
- 内容字节数受 `settings.max_file_slice_bytes` 限制。

常见错误：

- `repo_not_found`
- `repo_not_synced`
- `invalid_repository_path`
- `repository_read_failed`

### 10.3 持久 workspace 查询与恢复

这些接口面向服务端持久状态，不一定创建新 session。Giteam 用它恢复 UI。

#### GET `/v1/repos/{repo_id}/workspaces`

用途：列出某个 repo 的历史 workspace。

查询参数：

```text
request_id=server
```

返回 data：

```json
{
  "workspaces": [
    {
      "workspace_id": "ws_xxx",
      "repo_id": "demo",
      "session_id": "sess_xxx",
      "base_commit": "...",
      "workspace_version": 2,
      "dirty": true,
      "updated_at_ms": 123,
      "status": "active|expired|removed"
    }
  ]
}
```

#### POST `/v1/workspaces/list`

用途：上一个 GET 接口的 POST bridge，供 Tauri/前端统一调用。

请求：

```json
{
  "request_id": "req_workspaces",
  "repo_id": "demo"
}
```

#### GET `/v1/workspaces/{workspace_id}`

用途：读取某个 workspace 的持久化摘要。

#### POST `/v1/workspaces/get`

用途：上一个 GET 接口的 POST bridge。

请求：

```json
{
  "request_id": "req_workspace",
  "workspace_id": "ws_xxx"
}
```

#### GET `/v1/workspaces/{workspace_id}/operations`

用途：读取 workspace 操作历史。

查询参数：

```text
request_id=server
limit=100
```

返回 data：

```json
{
  "operations": [
    {
      "operation_id": 1,
      "repo_id": "demo",
      "workspace_id": "ws_xxx",
      "session_id": "sess_xxx",
      "kind": "shell|read_file|write_file|edit_file|apply_patch|gitnexus_status|gitnexus_analyze|...",
      "summary": "...",
      "status": "completed|failed|timeout",
      "command": "git status --short",
      "cwd": ".",
      "path": "README.md",
      "exit_code": 0,
      "stdout": "...",
      "stderr": "...",
      "diff_summary": "...",
      "metadata": {},
      "workspace_version": 2,
      "started_at_ms": 123,
      "finished_at_ms": 456
    }
  ]
}
```

#### POST `/v1/workspaces/operations`

用途：上一个 GET 接口的 POST bridge。

请求：

```json
{
  "request_id": "req_ops",
  "workspace_id": "ws_xxx",
  "limit": 100
}
```

`limit` 范围 1 到 200。

#### POST `/v1/workspaces/{workspace_id}/resume`

用途：恢复一个服务端已有 workspace，返回其最新 session。

请求：

```json
{
  "request_id": "req_resume"
}
```

#### POST `/v1/workspaces/resume`

用途：上一个接口的 POST bridge。

请求：

```json
{
  "request_id": "req_resume",
  "workspace_id": "ws_xxx"
}
```

返回 data 与 `create_session` 类似：

```json
{
  "session_id": "sess_xxx",
  "repo_id": "demo",
  "workspace_id": "ws_xxx",
  "base_commit": "...",
  "workspace_path": "...",
  "workspace_version": 2,
  "dirty": true,
  "last_command_id": "cmd_xxx"
}
```

#### GET `/v1/repos/{repo_id}/activities`

用途：读取 repo 级活动记录。

#### POST `/v1/activities/list`

用途：活动记录 POST bridge。

请求：

```json
{
  "request_id": "req_activities",
  "repo_id": "demo"
}
```

返回 data：

```json
{
  "activities": [
    {
      "activity_id": 1,
      "repo_id": "demo",
      "workspace_id": "ws_xxx",
      "session_id": "sess_xxx",
      "kind": "repo_added|repo_synced|workspace_created|workspace_changed|workspace_resumed|gitnexus_analyzed",
      "summary": "...",
      "occurred_at_ms": 123
    }
  ]
}
```

#### GET `/v1/repos/{repo_id}/gitnexus/status`

用途：读取 repo 最新 GitNexus index 持久状态。

#### POST `/v1/gitnexus/repo-status`

用途：上一个接口的 POST bridge。

请求：

```json
{
  "request_id": "req_repo_graph_status",
  "repo_id": "demo"
}
```

#### 兼容路由别名

服务端还保留了几组不带 `/v1` 的兼容路由，主要是为了已有前端或调试脚本不立刻失效。新代码建议优先使用 `/v1/*`。

兼容别名：

- `GET /repos/{repo_id}/workspaces` -> `GET /v1/repos/{repo_id}/workspaces`
- `GET /workspaces/{workspace_id}` -> `GET /v1/workspaces/{workspace_id}`
- `GET /workspaces/{workspace_id}/operations` -> `GET /v1/workspaces/{workspace_id}/operations`
- `POST /workspaces/{workspace_id}/resume` -> `POST /v1/workspaces/{workspace_id}/resume`
- `GET /repos/{repo_id}/activities` -> `GET /v1/repos/{repo_id}/activities`
- `GET /repos/{repo_id}/gitnexus/status` -> `GET /v1/repos/{repo_id}/gitnexus/status`

### 10.4 session workspace 创建与状态

#### POST `/v1/sessions`

用途：为某个 repo/ref 创建新的 commit-pinned 可写 workspace。

请求：

```json
{
  "request_id": "req_session",
  "repo_id": "demo",
  "ref_or_commit": "main"
}
```

返回 data：

```json
{
  "session_id": "sess_xxx",
  "repo_id": "demo",
  "workspace_id": "ws_xxx",
  "base_commit": "完整 SHA",
  "workspace_path": "/path/to/workspace",
  "workspace_version": 1,
  "dirty": false,
  "last_command_id": null
}
```

常见错误：

- `repo_not_found`
- `ref_not_found`
- `workspace_creation_failed`

#### POST `/v1/sessions/state`

用途：读取 session 当前状态。

请求：

```json
{
  "request_id": "req_state",
  "session_id": "sess_xxx"
}
```

返回 data 与 `/v1/sessions` 类似。

常见错误：

- `session_not_found`

### 10.5 session workspace shell 与文件读取

#### POST `/v1/shell/run`

用途：在 session workspace 内执行 shell 命令。

请求：

```json
{
  "request_id": "req_shell",
  "session_id": "sess_xxx",
  "command": "git status --short",
  "cwd": "."
}
```

返回 data：

```json
{
  "command_id": "cmd_xxx",
  "cwd": ".",
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "elapsed_ms": 123,
  "timed_out": false,
  "stdout_truncated": false,
  "stderr_truncated": false,
  "diff_truncated": false,
  "status_before": "",
  "status_after": " M README.md\n",
  "diff_summary": "...",
  "workspace_version": 2
}
```

常见错误：

- `session_not_found`
- `cwd_escaped_workspace`

#### POST `/v1/files/read`

用途：读取 session workspace 内文件切片。

请求：

```json
{
  "request_id": "req_read",
  "session_id": "sess_xxx",
  "path": "README.md",
  "start_line": 1,
  "max_lines": 120
}
```

返回 data：

```json
{
  "path": "README.md",
  "start_line": 1,
  "end_line": 120,
  "content": "...",
  "truncated": false,
  "sha256": "...",
  "workspace_version": 1
}
```

常见错误：

- `session_not_found`
- `path_escaped_workspace`

#### POST `/v1/files/list`

用途：列出 session workspace 内目录。

请求：

```json
{
  "request_id": "req_list",
  "session_id": "sess_xxx",
  "path": ".",
  "max_entries": 200
}
```

返回 data：

```json
{
  "entries": [
    {
      "path": "README.md",
      "type": "file",
      "size": 1234
    },
    {
      "path": "src",
      "type": "directory",
      "size": null
    }
  ]
}
```

常见错误：

- `session_not_found`
- `path_escaped_workspace`

### 10.6 session workspace 搜索

#### POST `/v1/find/files`

用途：按 glob 或路径子串查找 session workspace 内文件。

请求：

```json
{
  "request_id": "req_find",
  "session_id": "sess_xxx",
  "query": "*.md",
  "max_results": 100
}
```

返回 data：

```json
{
  "paths": ["README.md", "docs/intro.md"]
}
```

匹配规则：

- query 含 `*?[]` 时按 glob。
- 否则按路径子串大小写不敏感匹配。

#### POST `/v1/find/text`

用途：在 session workspace 内按正则搜索文本。

请求：

```json
{
  "request_id": "req_grep",
  "session_id": "sess_xxx",
  "pattern": "TODO|FIXME",
  "path": ".",
  "max_results": 100
}
```

返回 data：

```json
{
  "matches": [
    {
      "path": "README.md",
      "line_number": 10,
      "line": "TODO: ..."
    }
  ]
}
```

常见错误：

- `session_not_found`
- `path_escaped_workspace`

### 10.7 session workspace 修改

#### POST `/v1/files/write`

用途：写完整文件内容。

请求：

```json
{
  "request_id": "req_write",
  "session_id": "sess_xxx",
  "path": "notes/todo.txt",
  "content": "hello\n",
  "create_dirs": true
}
```

返回 data：

```json
{
  "path": "notes/todo.txt",
  "sha256": "...",
  "bytes": 6,
  "workspace_version": 2,
  "status_after": "?? notes/todo.txt\n"
}
```

常见错误：

- `session_not_found`
- `path_escaped_workspace`

#### POST `/v1/files/edit`

用途：精确文本替换。

请求：

```json
{
  "request_id": "req_edit",
  "session_id": "sess_xxx",
  "path": "README.md",
  "old_text": "old",
  "new_text": "new",
  "replace_all": false
}
```

返回 data：

```json
{
  "path": "README.md",
  "sha256": "...",
  "bytes": 1234,
  "workspace_version": 3,
  "status_after": " M README.md\n",
  "replacements": 1
}
```

常见错误：

- `session_not_found`
- `file_edit_failed`，例如 `old_text not found`

#### POST `/v1/files/apply-patch`

用途：应用 unified diff patch。

请求：

```json
{
  "request_id": "req_patch",
  "session_id": "sess_xxx",
  "patch": "diff --git ..."
}
```

返回 data：

```json
{
  "applied": true,
  "stdout": "",
  "stderr": "",
  "workspace_version": 4,
  "status_after": " M README.md\n"
}
```

常见错误：

- `session_not_found`
- `patch_apply_failed`

### 10.8 工具能力

#### POST `/v1/tools`

用途：列出远程服务对 OpenCode/Codex 工具能力的映射。

请求：

```json
{
  "request_id": "req_tools"
}
```

返回 data：

```json
{
  "tools": [
    {
      "id": "bash",
      "opencode_tool": "bash",
      "endpoint": "/v1/shell/run",
      "description": "Run a bounded shell command in a session workspace.",
      "implemented": true
    }
  ]
}
```

已实现工具映射：

- `bash` -> `/v1/shell/run`
- `read` -> `/v1/files/read`
- `glob` -> `/v1/find/files`
- `grep` -> `/v1/find/text`
- `write` -> `/v1/files/write`
- `edit` -> `/v1/files/edit`
- `apply_patch` -> `/v1/files/apply-patch`

刻意不由服务代理的工具：

- `task`
- `webfetch`
- `websearch`
- `todowrite`
- `skill`

### 10.9 GitNexus

#### POST `/v1/graph/analyze`

用途：运行 GitNexus 分析。

repo HEAD 请求：

```json
{
  "request_id": "req_graph",
  "target_type": "repo_head",
  "repo_id": "demo",
  "ref_or_commit": "main"
}
```

session workspace 请求：

```json
{
  "request_id": "req_graph",
  "target_type": "session_workspace",
  "session_id": "sess_xxx"
}
```

返回 data：

```json
{
  "target": {
    "target_type": "repo_head",
    "repo_id": "demo",
    "commit": "..."
  },
  "status": "READY",
  "last_indexed_at": "2026-07-13T...",
  "error": null,
  "target_type": "repo_head"
}
```

常见错误：

- `repo_not_found`
- `graph_analysis_failed`
- `graph_target_required`

#### POST `/v1/graph/status`

用途：读取 GitNexus 状态，不一定重新分析。

请求结构同 `/v1/graph/analyze`。

返回状态可能是：

- `READY`
- `STALE`
- `INDEXING`
- `FAILED`

常见错误：

- `repo_not_found`
- `graph_status_failed`
- `graph_target_required`

## 11. MCP 工具清单

MCP server 名称为 `remote_repo`。工具定义在：

```text
remote-repo-skill-brainstorm_2/src/remote_repo_service/mcp_server.py
```

当前 MCP 工具：

| MCP 工具 | HTTP 端点 | 必填参数 | 用途 |
| --- | --- | --- | --- |
| `capabilities` | `/v1/tools` | 无 | 查看远程服务工具能力 |
| `list_repos` | `/v1/repos` | 无 | 列出仓库 |
| `sync_repo` | `/v1/repos/sync` | `repo_id` | 同步 mirror |
| `add_repo` | `/v1/repos/add` | `repo_id`, `name`, `remote_url` | 添加仓库并排队 clone |
| `reload_config` | `/v1/config/reload` | 无 | 重载配置 |
| `remove_repo` | `/v1/repos/remove` | `repo_id` | 删除仓库配置 |
| `update_repo` | `/v1/repos/update` | `repo_id` | 更新仓库配置 |
| `create_session` | `/v1/sessions` | `repo_id`, `ref_or_commit` | 创建 commit-pinned workspace |
| `get_session_state` | `/v1/sessions/state` | `session_id` | 获取 session 状态 |
| `run_shell` | `/v1/shell/run` | `session_id`, `command` | 执行 bounded shell |
| `read_file` | `/v1/files/read` | `session_id`, `path` | 读取 workspace 文件 |
| `list_files` | `/v1/files/list` | `session_id` | 列目录 |
| `find_files` | `/v1/find/files` | `session_id`, `query` | 文件搜索 |
| `grep` | `/v1/find/text` | `session_id`, `pattern` | 正则文本搜索 |
| `write_file` | `/v1/files/write` | `session_id`, `path`, `content` | 写文件 |
| `edit_file` | `/v1/files/edit` | `session_id`, `path`, `old_text`, `new_text` | 精确替换 |
| `apply_patch` | `/v1/files/apply-patch` | `session_id`, `patch` | 应用 patch |
| `graph_analyze` | `/v1/graph/analyze` | target 相关 | GitNexus 分析 |
| `graph_status` | `/v1/graph/status` | target 相关 | GitNexus 状态 |

graph target 参数规则：

- `target_type: "repo_head"` 时需要 `repo_id`，可选 `ref_or_commit`。
- `target_type: "session_workspace"` 时需要 `session_id`。

## 12. OpenCode Skill 交接

skill 位置：

```text
remote-repo-skill-brainstorm_2/skills/opencode-remote-repo/SKILL.md
```

核心约束：

1. 使用 `remote_repo` MCP server 提供的工具。
2. 不允许用本地 `bash/read/glob/grep/edit/write/apply_patch` 直接操作目标仓库。
3. 先 `list_repos`，必要时 `add_repo`。
4. 创建新 session 前先 `sync_repo`。
5. `create_session` 后必须保存 `session_id`。
6. 所有 session-scoped 调用必须传 `session_id`。
7. 重要操作后或不确定时调用 `get_session_state`。
8. 不做 commit、push、merge、rebase 或远端分支更新。

Giteam 启动契约：

- 从 Giteam 内置 OpenCode 使用该 skill 时，AI 不应该自己读本地 config、SQLite、`service.json` 或环境变量。
- Giteam 通过 launcher 启动 `remote_repo` MCP server，并把 service URL/API key 传进去。
- 仓库列表来自远程服务配置，必须通过 `list_repos` 发现。

参考文件：

```text
remote-repo-skill-brainstorm_2/skills/opencode-remote-repo/references/mcp-tools.md
remote-repo-skill-brainstorm_2/skills/opencode-remote-repo/references/api.md
remote-repo-skill-brainstorm_2/skills/opencode-remote-repo/scripts/remote_repo_client.py
```

## 13. remote_repo_client.py

位置：

```text
remote-repo-skill-brainstorm_2/skills/opencode-remote-repo/scripts/remote_repo_client.py
```

用途：给 OpenCode/Codex 或人工调试用的 HTTP CLI。

支持命令包括：

- `add-repo`
- `reload-config`
- `remove-repo`
- `update-repo`
- `list-repos`
- `tools`
- `sync`
- `create-session`
- `state`
- `run-shell`
- `read-file`
- `list-files`
- `find-files`
- `grep`
- `write-file`
- `edit-file`
- `apply-patch`
- `graph-analyze`
- `graph-status`

默认服务地址：

```text
http://127.0.0.1:8765
```

可通过：

```text
--base-url
REMOTE_REPO_SERVICE_URL
```

覆盖。

## 14. Giteam 桌面端接入

### 14.1 关键文件

Rust/Tauri：

```text
giteam/apps/desktop/src-tauri/src/remote_repo/mod.rs
giteam/apps/desktop/src-tauri/src/remote_repo/commands.rs
giteam/apps/desktop/src-tauri/src/remote_repo/client.rs
giteam/apps/desktop/src-tauri/src/remote_repo/models.rs
giteam/apps/desktop/src-tauri/src/remote_repo/store.rs
giteam/apps/desktop/src-tauri/src/main.rs
```

React/TypeScript：

```text
giteam/apps/desktop/src/components/remote-repo/
giteam/apps/desktop/src/App.tsx
giteam/apps/desktop/src/components/sidebar/DesktopSidebar.tsx
giteam/apps/desktop/src/components/common/AppChromeIcons.tsx
giteam/apps/desktop/src/lib/useRightModuleVisibility.ts
```

内置 skill：

```text
giteam/crates/giteam-core/src/opencode.rs
giteam/crates/giteam-core/resources/opencode-skills/opencode-remote-repo/
giteam/apps/desktop/src/lib/opencodeSkillMarketplace.ts
```

### 14.2 Tauri command

注册位置：

```text
giteam/apps/desktop/src-tauri/src/main.rs
```

命令名：

```text
remote_repo
```

前端调用形式：

```ts
invoke("remote_repo", {
  action: "list_overviews",
  payload: {}
});
```

### 14.3 Tauri action 清单

`commands.rs` 当前支持这些 action：

| action | 用途 |
| --- | --- |
| `get_service_url` | 读取有效服务地址/API key 信息 |
| `test_service_url` | 测试服务地址，实际 GET `/v1/dashboard` |
| `set_service_url` | 保存服务地址/API key |
| `list_overviews` | 列出远程仓库概览 |
| `sync_repo` | 同步仓库 |
| `touch_accessed` | 更新本地 UI 最近访问时间 |
| `reload_config` | 调远程服务 `/v1/config/reload` |
| `add_repo` | 添加远程仓库 |
| `update_repo` | 更新远程仓库 |
| `remove_repo` | 删除远程仓库 |
| `set_pinned` | 设置本地 pin 状态 |
| `list_branches` | 读取 repo 分支 |
| `list_files` | 读取 repo HEAD 文件树 |
| `read_file` | 读取 repo HEAD 文件 |
| `workspace_request` | workspace 相关通用桥接 |

`workspace_request` 支持的 operation：

- `create_session`
- `session_state`
- `run_shell`
- `list_files`
- `read_file`
- `find_files`
- `find_text`
- `write_file`
- `edit_file`
- `apply_patch`
- `graph_status`
- `graph_analyze`
- `list_tools`
- `list_workspaces`
- `get_workspace`
- `resume_workspace`
- `list_operations`
- `list_activities`
- `repo_gitnexus_status`

这些 operation 在 `RemoteRepoClient::workspace_request` 中映射到远程服务对应 HTTP path。

### 14.4 服务地址和 API key 优先级

Desktop/Tauri：

1. 用户在 Giteam 设置页保存的 `remote_repo_service_settings`。
2. 环境变量 `REMOTE_REPO_SERVICE_URL`。
3. 环境变量 `VITE_REMOTE_REPO_SERVICE_URL`。
4. 默认 `http://127.0.0.1:8765`。

API key：

1. 用户在 Giteam 设置页保存的 api_key。
2. 环境变量 `REMOTE_REPO_API_KEY`。
3. 环境变量 `REMOTE_REPO_SERVICE_API_KEY`。
4. 空字符串。

Web：

1. localStorage `giteam.remote-repo.service-url.v1`。
2. Vite 环境变量 `VITE_REMOTE_REPO_SERVICE_URL`。
3. 同源代理路径 fallback。

Web API key：

1. localStorage `giteam.remote-repo.service-api-key.v1`。
2. Vite 环境变量 `VITE_REMOTE_REPO_SERVICE_API_KEY`。

### 14.5 Giteam 本地 SQLite 表

位置：

```text
~/Library/Application Support/giteam/.giteam/client.db
```

具体由 Tauri `app_data_dir()` 决定。

remote repo 相关表：

#### remote_repo_service_settings

保存服务地址和 API key。

字段：

- `id`：固定为 1。
- `service_url`
- `api_key`
- `updated_at_ms`

注意：当前 API key 明文保存。代码里已有 TODO，生产应改为 Keychain/Stronghold 等安全存储。

#### remote_repo_ui_state

保存 UI 本地状态。

字段：

- `repo_id`
- `pinned`
- `sort_order`
- `last_accessed_at_ms`
- `updated_at_ms`

#### remote_repo_configs

早期/兼容用配置表。

字段：

- `repo_id`
- `name`
- `service_url`
- `api_key`
- `default_ref`
- `session_id`
- `updated_at_ms`

当前主要服务配置以远程服务为准，Giteam 本地保存服务地址和 UI 状态。

### 14.6 Rust RemoteRepoClient

位置：

```text
giteam/apps/desktop/src-tauri/src/remote_repo/client.rs
```

职责：

- 统一封装 reqwest HTTP 请求。
- 自动加 `X-API-Key`。
- 统一解析 remote service envelope。
- 把远程错误映射成 Rust error：
  - `SessionNotFound`
  - `RepoNotFound`
  - `Unauthorized`
  - `Remote`
  - `InvalidResponse`
  - `Http`
- 生成 request_id。
- 提供 repo、branch、file、workspace、graph 等调用方法。

### 14.7 React remote-repo 组件

目录：

```text
giteam/apps/desktop/src/components/remote-repo/
```

主要组件：

- `RemoteRepoCatalog.tsx`：全部远程仓库列表；支持引入、刷新、打开、编辑、同步、删除、pin。
- `RemoteRepoListItem.tsx`：单个 repo 列表项。
- `RemoteRepoOverview.tsx`：单仓库概览；展示状态、分支上下文、GitNexus、文件树状态、最近 workspace、最近活动。
- `RemoteRepoCodeResourcePanel.tsx`：只读代码资源面板；支持分支列表、repo mirror 文件浏览、文件内容预览。
- `RemoteRepoWorkspacePanel.tsx`：可写远程 workspace 面板；支持创建/恢复 session、shell、文件操作、搜索、GitNexus、操作历史。
- `RemoteRepoDialogs.tsx`：引入/编辑/删除等弹窗。
- `RemoteRepoStatusBadge.tsx`：连接状态 badge。

工具和数据层：

- `remoteRepoApi.ts`：Tauri/Web 双模式统一 API。
- `remoteRepoWebApi.ts`：Web 模式 fetch 实现。
- `remoteRepoWorkspaceApi.ts`：workspace 操作封装。
- `remoteRepoResources.ts`：repo 分支/文件树/文件内容归一化。
- `remoteRepoWorkspaceResources.ts`：workspace/session/shell/search/graph/operation 归一化。
- `remoteRepoAdapter.ts`：服务端 repo overview 到 UI model 的适配。
- `remoteRepoData.ts`：排序、状态 label、时间格式化。
- `remoteRepoServiceSettings.ts`：服务地址/API key 的读取、保存、测试。
- `remoteRepoServiceUrl.ts`：服务地址规范化。

### 14.8 Giteam UI 已实现功能

仓库列表：

- 读取远程服务仓库列表。
- 显示连接数量。
- 当前项目相关仓库优先排序。
- 支持引入仓库。
- 支持刷新。
- 支持打开仓库概览。
- 支持编辑仓库配置。
- 支持删除仓库。
- 支持同步仓库。
- 支持 pin。

仓库概览：

- 显示 repo 名称、repo ID、provider、origin。
- 显示连接状态。
- 显示最近同步时间。
- 显示当前分支、commit、GitNexus 状态、文件树状态。
- 支持读取分支列表。
- 支持切换分支上下文。
- 支持检查 repo HEAD GitNexus 状态。
- 支持分析当前分支。
- 支持进入只读文件浏览。
- 支持打开远程工作区。
- 显示最近 workspace/session。
- 显示最近活动。

只读代码资源：

- 读取 repo mirror 分支。
- 读取 repo mirror 文件树。
- 根据 selected ref/branch 读取文件。
- 不创建 workspace/session。
- 用于快速查看远程仓库代码。

远程 workspace：

- 创建 commit-pinned session。
- 粘贴已有 `sess_...` 恢复旧 session。
- 继续打开历史 workspace。
- Shell tab：执行命令，默认 `git status --short`。
- 文件 tab：列目录、读文件、写文件、精确替换、应用 patch。
- 搜索 tab：按文件名找文件、按正则 grep。
- GitNexus tab：查看/触发 repo head 或 workspace 分析。
- 记录 tab：查看 workspace operations 时间线，包括命令、stdout/stderr、diff summary、版本号等。

## 15. Giteam 内置 opencode-remote-repo skill

Giteam 内置资源位置：

```text
giteam/crates/giteam-core/resources/opencode-skills/opencode-remote-repo/
```

打包代码位置：

```text
giteam/crates/giteam-core/src/opencode.rs
```

这里通过 `include_str!` 把以下文件编译进 giteam-core：

- `SKILL.md`
- `giteam.json`
- `agents/openai.yaml`
- `references/api.md`
- `references/mcp-tools.md`
- `scripts/remote_repo_client.py`
- `mcp/giteam_mcp_launcher.py`
- `mcp/mcp_server.py`

marketplace 条目位置：

```text
giteam/apps/desktop/src/lib/opencodeSkillMarketplace.ts
```

条目信息：

- id/spec：`giteam/opencode-remote-repo@opencode-remote-repo`
- installSpec：`giteam-builtin:opencode-remote-repo`
- 描述：通过 Giteam 远程仓库服务和 `remote_repo` MCP 使用服务端工作区。

重要维护点：

`remote-repo-skill-brainstorm_2/skills/opencode-remote-repo/` 和 `giteam/crates/giteam-core/resources/opencode-skills/opencode-remote-repo/` 是两份内容。修改 skill、MCP server、launcher 或脚本时，要同步两边，否则 Giteam 内置版本会落后于独立服务仓库。

## 16. 本地启动与验证

### 16.1 启动 remote-repo-service

```bash
cd remote-repo-skill-brainstorm_2
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

export REMOTE_REPO_SERVICE_CONFIG=/absolute/path/service.json
python -m remote_repo_service start --host 127.0.0.1 --port 8765
```

也可以用旧方式：

```bash
python -m uvicorn --app-dir src remote_repo_service.app:create_app --factory --host 127.0.0.1 --port 8765
```

### 16.2 验证服务在线

无 API key：

```bash
curl http://127.0.0.1:8765/v1/dashboard
```

有 API key：

```bash
curl -H "X-API-Key: $REMOTE_REPO_SERVICE_API_KEY" http://127.0.0.1:8765/v1/dashboard
```

### 16.3 最小 API 验证流程

```bash
# 1. 列仓库
curl -X POST http://127.0.0.1:8765/v1/repos \
  -H "Content-Type: application/json" \
  -d '{"request_id":"req_repos"}'

# 2. 同步仓库
curl -X POST http://127.0.0.1:8765/v1/repos/sync \
  -H "Content-Type: application/json" \
  -d '{"request_id":"req_sync","repo_id":"demo"}'

# 3. 创建 session
curl -X POST http://127.0.0.1:8765/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"request_id":"req_session","repo_id":"demo","ref_or_commit":"main"}'

# 4. 读取文件
curl -X POST http://127.0.0.1:8765/v1/files/read \
  -H "Content-Type: application/json" \
  -d '{"request_id":"req_read","session_id":"sess_xxx","path":"README.md"}'

# 5. 执行命令
curl -X POST http://127.0.0.1:8765/v1/shell/run \
  -H "Content-Type: application/json" \
  -d '{"request_id":"req_shell","session_id":"sess_xxx","command":"git status --short","cwd":"."}'
```

### 16.4 Giteam 配置

打开 Giteam 设置页，找到远程仓库设置：

- service URL：`http://127.0.0.1:8765`
- API key：如果服务启用了 key，填同一个 key。

保存前会调用 `/v1/dashboard` 测试连接。

## 17. Docker/远程部署

相关文件：

```text
remote-repo-skill-brainstorm_2/Dockerfile
remote-repo-skill-brainstorm_2/docker-compose.yml
remote-repo-skill-brainstorm_2/docs/remote-deployment.md
remote-repo-skill-brainstorm_2/deploy/verify-service.sh
remote-repo-skill-brainstorm_2/deploy/config/remote-repo-service.json
```

Docker compose 设计：

- `init-permissions` 容器先修正挂载目录权限。
- `remote-repo-service` 主容器以非 root 用户运行。
- 配置目录挂载到 `/etc/giteam`。
- 数据卷挂载到 `/var/lib/giteam/remote-repo-service`。

受信任局域网开放方式：

```bash
REMOTE_REPO_BIND_ADDRESS=0.0.0.0 docker compose up --build -d
```

注意：

- 只能在受信任局域网使用。
- 不要把 8765 裸露公网。
- 公网必须加 TLS、反向代理、访问控制、限流、命令沙箱和审计。

## 18. 测试覆盖

### 18.1 remote-repo-service 测试

测试目录：

```text
remote-repo-skill-brainstorm_2/tests/
```

主要测试文件：

- `test_app.py`：FastAPI 基础 API。
- `test_cli.py`：CLI 行为。
- `test_config.py`：配置读取、校验和写回。
- `test_docker_deployment.py`：Docker/部署相关检查。
- `test_file_reader.py`：文件切片读取。
- `test_git_ops.py`：Git 同步、ref、tree、文件读取。
- `test_giteam_mcp_launcher.py`：Giteam MCP launcher。
- `test_graph.py`：GitNexus graph 状态与分析。
- `test_mcp_server.py`：MCP server 工具定义和调用。
- `test_models.py`：Pydantic 模型。
- `test_persistence.py`：state.db 持久化和服务重启恢复。
- `test_session_store.py`：session/workspace 生命周期。
- `test_shell_runner.py`：shell 执行、超时、输出截断。
- `test_tool_api.py`：工具 API、find/grep/write/edit/apply_patch。
- `test_workspace_tools.py`：workspace 文件工具。

运行：

```bash
cd remote-repo-skill-brainstorm_2
pytest
```

重要回归：

```bash
pytest -q tests/test_persistence.py
```

这个测试验证服务重启后 workspace/session/GitNexus 状态可恢复。

### 18.2 Giteam remote repo 测试

测试目录：

```text
giteam/apps/desktop/tests/
```

相关测试：

- `remoteRepoAdapter.test.mjs`
- `remoteRepoData.test.mjs`
- `remoteRepoResources.test.mjs`
- `remoteRepoServiceSettings.test.mjs`
- `remoteRepoWorkspaceHistory.test.mjs`
- `remoteRepoWorkspaceResources.test.mjs`

主要覆盖：

- 服务返回数据到 UI model 的适配。
- repo 排序、时间格式和状态 label。
- 文件树/分支/文件内容归一化。
- 服务地址规范化和设置优先级。
- workspace history/operations 归一化。
- shell/file/search/graph 返回结构归一化。

## 19. 常见错误和排查

### 服务连不上

现象：

- Giteam 设置页测试失败。
- OpenCode MCP 报连接失败。
- `curl /v1/dashboard` 失败。

排查：

1. 服务是否真的从本机 Terminal 启动，而不是 AI 助手沙箱或不可达环境。
2. URL 是否是 Giteam/OpenCode 进程可访问的地址。
3. 端口是否是 8765。
4. 如果有 API key，Giteam/OpenCode 是否带了正确 key。
5. Web 模式是否有 CORS 问题。

### `repo_not_synced`

说明 mirror cache 还没有准备好。先调用：

```text
POST /v1/repos/sync
```

添加仓库后虽然会 queue clone，但后台 clone 可能还没完成。

### `auth_required`

说明 clone/fetch 认证失败。检查：

- remote_url。
- SSH key/agent。
- HTTPS credential。
- Docker 容器内是否能访问凭据。

### `session_not_found`

可能原因：

- 服务重启后 state.db 或 workspace 丢失。
- session ID 写错。
- workspace 被标记 expired。

如果有 workspace ID，可以尝试 `/v1/workspaces/resume`。

### `path_escaped_workspace` 或 `cwd_escaped_workspace`

说明传入了绝对路径或包含 `..` 等试图逃逸 workspace 的路径。所有 workspace 路径都必须是相对路径。

### GitNexus `FAILED`

排查：

- 服务环境是否有 Node/npm/npx。
- `npx gitnexus analyze --index-only` 是否可运行。
- workspace 是否过大或依赖缺失。
- `.gitnexus` 是否存在坏索引。服务对部分坏索引会自动删除并重试一次。

### Giteam UI 显示 stale/failed

排查：

- `/v1/repos` 返回的 `sync_status` 和 `error_message`。
- 是否同步过仓库。
- 是否更新过 remote_url/default_ref 但没重新 sync。
- service URL/API key 是否已保存。

## 20. 当前限制与风险

必须重点交接这些限制：

1. `run_shell` 仍然是原型级能力，使用 `shell=True`，没有完整沙箱。
2. 当前只限制 cwd、超时、stdout/stderr/diff 大小，不限制具体命令。
3. API key 是最低限度认证，不适合公网。
4. Giteam 桌面端 API key 当前明文存 SQLite。
5. 远程 workspace 的改动不会自动 commit、push、merge 或 rebase。
6. 服务端 workspace 如果 storage_root 不持久化，重启或容器重建后会丢。
7. repo mirror 与 workspace 都在服务端，需要注意磁盘占用和清理策略。
8. `opencode-remote-repo` 有独立仓库版和 Giteam 内置版两份副本，需要同步维护。
9. GitNexus 依赖 Node/npm/npx/gitnexus 环境，部署环境需要提前验证。
10. 多用户/多租户隔离还没有做，当前更适合单用户或受信任内网。

## 21. 后续建议

优先级建议如下：

### P0：安全和部署

- 给 `run_shell` 加命令策略、denylist/allowlist 或真正沙箱。
- API key 改为更完整的认证体系。
- Giteam API key 改用系统 keychain 或 Tauri Stronghold。
- 远程部署必须加 TLS、反向代理访问控制、审计和限流。

### P1：产品化体验

- Giteam UI 的错误提示继续细化，例如把 `repo_not_synced`、`auth_required`、`session_not_found` 转成明确操作建议。
- 给 workspace 增加清理/归档能力。
- 增加 workspace diff 视图和导出 patch 功能。
- 增加“从 workspace 生成 PR/patch”的后续工作流，但不要在 V0 中直接 push。

### P1：工程维护

- 建立 skill 同步脚本，保证独立 skill 和 Giteam 内置 skill 一致。
- 把 API 契约抽成 OpenAPI 或共享 schema。
- 增加 Giteam 到服务端的集成测试。
- 增加真实 GitHub/GitLab 仓库端到端验证。

### P2：功能扩展

- 支持多仓库更完整的选择和筛选。
- 支持 workspace 文件树 status marker。
- 支持 GitNexus 结果在 Giteam UI 中更深展示。
- 支持服务端资源监控、仓库同步队列和后台任务状态。

## 22. 接手建议阅读顺序

建议按这个顺序看：

1. `remote-repo-skill-brainstorm_2/README.md`
2. `remote-repo-skill-brainstorm_2/src/remote_repo_service/app.py`
3. `remote-repo-skill-brainstorm_2/src/remote_repo_service/models.py`
4. `remote-repo-skill-brainstorm_2/src/remote_repo_service/session_store.py`
5. `remote-repo-skill-brainstorm_2/src/remote_repo_service/workspace_tools.py`
6. `remote-repo-skill-brainstorm_2/src/remote_repo_service/state_store.py`
7. `remote-repo-skill-brainstorm_2/skills/opencode-remote-repo/SKILL.md`
8. `giteam/apps/desktop/src-tauri/src/remote_repo/commands.rs`
9. `giteam/apps/desktop/src-tauri/src/remote_repo/client.rs`
10. `giteam/apps/desktop/src/components/remote-repo/remoteRepoApi.ts`
11. `giteam/apps/desktop/src/components/remote-repo/RemoteRepoWorkspacePanel.tsx`
12. `giteam/crates/giteam-core/src/opencode.rs`

## 23. 快速验收清单

接手后可以用这张清单确认环境和链路是否正常：

- [ ] `python -m remote_repo_service start --host 127.0.0.1 --port 8765` 能启动。
- [ ] `GET /v1/dashboard` 返回 ready。
- [ ] `POST /v1/repos` 能列出配置仓库。
- [ ] `POST /v1/repos/sync` 能同步仓库。
- [ ] `POST /v1/repos/branches` 能看到分支。
- [ ] `POST /v1/repos/files/list` 能列只读文件树。
- [ ] `POST /v1/sessions` 能创建 session。
- [ ] `POST /v1/files/read` 能读取 session 文件。
- [ ] `POST /v1/shell/run` 能执行 `git status --short`。
- [ ] `POST /v1/files/write` 能写入 workspace 文件。
- [ ] `POST /v1/files/edit` 能替换文本。
- [ ] `POST /v1/files/apply-patch` 能应用 patch。
- [ ] `POST /v1/graph/status` 能返回 GitNexus 状态。
- [ ] 重启服务后 `/v1/workspaces/list` 能看到历史 workspace。
- [ ] Giteam 设置页能保存服务 URL/API key。
- [ ] Giteam 远程仓库列表能展示 repo。
- [ ] Giteam 能打开远程工作区并运行 shell。
- [ ] OpenCode 安装/启用 `opencode-remote-repo` skill 后能调用 `remote_repo` MCP 工具。

## 24. 最重要的维护提醒

这套能力的边界要一直保持清楚：

- repo mirror 的只读 API 用于快速浏览代码，不创建 workspace。
- session workspace API 用于实际读写和执行命令。
- OpenCode 必须通过 MCP 工具操作远程仓库，不应该回退到本地文件系统。
- V0 不负责 commit/push/merge/rebase。
- 安全边界还没达到生产公网标准。
- Giteam 内置 skill 和独立 skill 要同步维护。

如果下一个同学只记住一句话：先保证 `repo_id -> sync -> session_id -> workspace_version` 这条状态链路不要被破坏。大多数功能、UI 和调试都围绕这条链路展开。

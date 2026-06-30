# Remote Repo Service

一个本地/内网原型的远程仓库会话服务。它让 AI 客户端无需本地 checkout 即可通过 HTTP API 或 MCP（Model Context Protocol）读写仓库、执行 shell 命令、运行 GitNexus 代码图分析。

## 功能

- **仓库镜像**：同步配置好的 Git 仓库到服务端缓存。
- **会话工作区**：基于指定 ref/commit 创建固定基线的可写工作区。
- **远程执行**：在会话工作区内运行有边界的 shell 命令。
- **文件操作**：读取、写入、编辑、查找文件，以及应用 patch。
- **代码图分析**：通过 GitNexus 分析仓库 HEAD 或会话工作区状态。
- **服务端持久化**：连接、workspace、session、GitNexus 状态与活动记录保存在 `storage_root/state.db`，服务重启后可恢复。
- **MCP 桥接**：以 stdio MCP 服务器形式暴露上述工具，供 OpenCode / Claude Code 等客户端调用。

## 环境要求

- Python >= 3.11
- Git
- Node.js + `npx gitnexus`（用于代码图分析，可选）

## 安装

```bash
# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装生产依赖
pip install -e .

# 安装开发依赖
pip install -e ".[dev]"
```

## 配置

服务通过环境变量 `REMOTE_REPO_SERVICE_CONFIG` 指向的 JSON 文件加载仓库配置。

示例 `config.json`：

```json
{
  "storage_root": ".remote-repo-service",
  "command_timeout_seconds": 30,
  "max_stdout_bytes": 64000,
  "repos": {
    "my-repo": {
      "repo_id": "my-repo",
      "name": "my-org/my-repo",
      "remote_url": "https://gitlab.com/my-org/my-repo.git",
      "default_ref": "main",
      "auth_method": "ssh_key",
      "credential_id": "default"
    }
  }
}
```

配置项说明：

| 字段 | 说明 |
|------|------|
| `storage_root` | 服务端本地缓存、工作区、图分析工作树的根目录 |
| `api_keys` | 可选服务 API key 列表；也可通过 `REMOTE_REPO_SERVICE_API_KEY` / `REMOTE_REPO_SERVICE_API_KEYS` 配置 |
| `command_timeout_seconds` | `run_shell` 命令超时时间 |
| `max_stdout_bytes` / `max_stderr_bytes` / `max_diff_bytes` | 命令输出与 diff 摘要大小上限 |
| `repos` | 仓库配置映射，key 为 `repo_id` |

远程部署时请将 `storage_root` 放在持久数据卷，而不是临时目录。完整的 systemd、反向代理和恢复验证方式见 [远程部署与持久化](docs/remote-deployment.md)。

需要以 Docker 在受信任局域网内运行时，可直接使用仓库根目录的 `docker-compose.yml`；跨电脑连接、挂载权限和安全限制见 [Docker 部署说明](docs/remote-deployment.md#docker受信任局域网部署)。

## 启动服务

### 默认启动（端口 8765）

```bash
export REMOTE_REPO_SERVICE_CONFIG=/path/to/config.json
python -m remote_repo_service start
```

旧方式仍可用：

```bash
export REMOTE_REPO_SERVICE_CONFIG=/path/to/config.json
python -m uvicorn --app-dir src remote_repo_service.app:create_app --factory --host 127.0.0.1 --port 8765
```

### 自定义端口

```bash
python -m remote_repo_service start --port 8766
```

### 验证服务

```bash
curl http://127.0.0.1:8765/v1/dashboard
```

预期返回：

```json
{"service":{"status":"ready","version":"0.1.0"},"repos":[...]}
```

如果配置了 `api_keys` 或 `REMOTE_REPO_SERVICE_API_KEY`，请求需要携带：

```bash
curl -H "X-API-Key: $REMOTE_REPO_SERVICE_API_KEY" http://127.0.0.1:8765/v1/dashboard
```

### 启动环境要求

HTTP 服务必须运行在 **Opencode 本机进程能够访问的环回地址**上。请从本机 Terminal（而非 IDE 内置终端、AI 助手沙箱或远程会话）中启动，否则 Opencode 可能看到 `127.0.0.1:8765 拒绝连接`。

如果需要后台保持，可以用 `nohup` 或 `tmux`：

```bash
nohup python -m remote_repo_service start --host 127.0.0.1 --port 8765 > service.log 2>&1 &
```

## 启动 MCP 服务（stdio）

让支持 MCP 的客户端通过当前服务调用工具：

```bash
export REMOTE_REPO_SERVICE_URL=http://127.0.0.1:8765
python -m remote_repo_service.mcp_server
```

默认连接 `http://127.0.0.1:8765`，可通过 `--base-url` 或 `REMOTE_REPO_SERVICE_URL` 环境变量修改。

## CLI 用法

除了 HTTP/MCP 接口，服务还内置命令行工具：

```bash
# 启动服务
python -m remote_repo_service start --host 127.0.0.1 --port 8765

# 添加仓库到配置文件（会通知运行中的服务重载配置）
python -m remote_repo_service repo add my-repo https://gitlab.com/my-org/my-repo.git --name "my-org/my-repo" --default-ref main

# 列出已配置仓库
python -m remote_repo_service repo list

# 更新仓库配置
python -m remote_repo_service repo update my-repo --name "New Name" --default-ref develop

# 删除仓库
python -m remote_repo_service repo remove my-repo

# 触发仓库同步
python -m remote_repo_service repo sync my-repo
```

默认配置文件为当前目录下的 `service.json`，可通过 `--config` 指定，或通过 `REMOTE_REPO_SERVICE_CONFIG` 环境变量设置。

## 主要 API

| 端点 | 说明 |
|------|------|
| `GET /` | 前端页面 |
| `GET /v1/dashboard` | 服务状态与仓库列表 |
| `POST /v1/repos` | 列出已配置仓库 |
| `POST /v1/repos/add` | 动态添加仓库并触发后台克隆 |
| `POST /v1/repos/remove` | 删除已配置仓库 |
| `POST /v1/repos/update` | 修改仓库配置 |
| `POST /v1/repos/sync` | 同步仓库缓存 |
| `POST /v1/config/reload` | 从磁盘重新加载配置 |
| `POST /v1/sessions` | 创建会话工作区 |
| `POST /v1/sessions/state` | 获取会话状态 |
| `POST /v1/shell/run` | 在会话工作区执行 shell 命令 |
| `POST /v1/files/read` | 读取文件片段 |
| `POST /v1/files/list` | 列出目录 |
| `POST /v1/files/write` | 写入文件 |
| `POST /v1/files/edit` | 精确文本替换 |
| `POST /v1/files/apply-patch` | 应用统一 diff patch |
| `POST /v1/find/files` | 按 glob/子串查找文件 |
| `POST /v1/find/text` | 正则搜索文件内容 |
| `POST /v1/graph/analyze` | 运行 GitNexus 分析 |
| `POST /v1/graph/status` | 获取 GitNexus 分析状态 |

详细请求/响应字段可参考 `src/remote_repo_service/models.py` 与 `src/remote_repo_service/mcp_server.py` 中的 `TOOLS` 定义。

## 开发

### 运行测试

```bash
pytest
```

### 项目结构

```
.
├── src/remote_repo_service/   # 服务端源码
│   ├── app.py                 # FastAPI 应用入口
│   ├── config.py              # 配置模型
│   ├── git_ops.py             # Git 操作
│   ├── session_store.py       # 会话与工作区管理
│   ├── shell_runner.py        # Shell 执行
│   ├── file_reader.py         # 文件读取
│   ├── workspace_tools.py     # 文件/查找/patch 工具
│   ├── graph.py               # GitNexus 图分析封装
│   ├── mcp_server.py          # stdio MCP 服务器
│   └── models.py              # Pydantic 请求/响应模型
├── tests/                     # 测试
├── pyproject.toml
└── README.md
```

## 安全提示

V0 是为单用户或受信任内网设计的原型。`run_shell` 只限制工作目录与输出大小，未实现严格的命令策略、沙箱或审计。在共享/生产环境使用前，必须增加权限控制、命令白名单、沙箱与审计机制。

## 故障排查

### Opencode 提示“远端仓库服务 remote_repo 当前未运行或无法连接（127.0.0.1:8765 拒绝连接）”

1. **确认服务在本机 Terminal 可达**：
   ```bash
   curl http://127.0.0.1:8765/v1/dashboard
   ```
   如果 Terminal 都连不上，说明服务没有在本机环回上监听。请在 Terminal 里重新启动 uvicorn，不要依赖 IDE/AI 助手的内置终端。

2. **确认 Opencode MCP 服务已连接**：
   ```bash
   opencode mcp list
   ```
   如果 `remote_repo` 未显示 connected，重启 Opencode。

3. **确认启动顺序**：先启动 HTTP 服务，再启动/重启 Opencode。

4. **检查端口冲突**：
   ```bash
   lsof -i :8765
   ```

5. **检查 `opencode.jsonc` 配置**：`--base-url` 必须是 Opencode 本机能访问的地址。同一台机器开发时保持 `http://127.0.0.1:8765` 即可。

### `http://localhost:8000/docs#/` 是什么？

这个项目的 HTTP 服务默认端口是 **8765**，不是 8000。`localhost:8000/docs` 通常是另一个 FastAPI 服务（例如你自己的后端服务），与 `remote_repo_service` 无关。

### 为什么无法通过 `remote_repo` 读取本项目 README？

`remote_repo` 操作的是**远程 Git 仓库**（通过 `repo_id` 配置）。当前项目目录本身不是 Git 仓库，因此它无法被 `remote_repo` 直接读取。如需让 Opencode 读取本项目的 `README.md`，请使用本地文件工具，或先把本项目初始化为 Git 仓库并在 `config.json` 中配置对应的 `repo_id`。

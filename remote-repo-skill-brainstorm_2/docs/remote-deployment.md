# 远程部署与持久化

`remote-repo-service` 的可恢复状态完全放在服务端的 `storage_root`。部署时必须把它挂载到持久磁盘；不要使用容器临时层、`/tmp` 或一次性工作目录。

建议目录：

```text
/etc/giteam/remote-repo-service.json       # 服务配置（可被服务端 CRUD 更新）
/var/lib/giteam/remote-repo-service/       # 持久数据卷
├── state.db                               # SQLite 状态库
├── repos/                                 # Git mirror
├── workspaces/                            # 可恢复的服务端 worktree
└── graph-worktrees/                       # GitNexus repo-HEAD 分析工作树
```

`state.db` 使用 SQLite WAL 模式，保存：

- `repos`：连接配置及同步状态、最近同步时间；
- `workspaces` 与 `sessions`：提交基线、路径、版本、dirty 状态与最近访问；
- `gitnexus_indexes`：仓库或 workspace 版本对应的索引状态和最近索引时间；
- `activities`：仓库同步、workspace 创建/恢复/修改、GitNexus 分析等活动。

服务启动时会从数据库恢复仍存在于 `workspaces/` 内的 workspace 和 session，并重新检查 Git dirty 状态。数据库记录指向缺失或越出 `workspace_root` 的路径会被安全跳过。

## 服务配置

创建 `/etc/giteam/remote-repo-service.json`：

```json
{
  "storage_root": "/var/lib/giteam/remote-repo-service",
  "api_keys": [],
  "cors_allowed_origins": ["https://giteam.example.com"],
  "command_timeout_seconds": 30,
  "repos": {}
}
```

服务用户必须同时对配置文件所在目录和 `storage_root` 有读写权限。因为“引入仓库 / 编辑 / 移除”会更新配置文件，建议将配置文件所有者设为专用服务用户，权限设为 `0600`。

## Docker：受信任局域网部署

仓库根目录提供了 `Dockerfile`、`docker-compose.yml`、示例配置及联通性检查脚本。容器镜像包含 Python、Git、Node/npm；首次运行 GitNexus 时，`npx` 会把分析工具缓存到持久数据卷。

先在运行 Docker 的服务器上创建挂载目录：

```bash
mkdir -p deploy/config deploy/data
```

示例配置已经位于 `deploy/config/remote-repo-service.json`。其中 `storage_root` 必须保持为容器路径 `/var/lib/giteam/remote-repo-service`；不要填写宿主机路径。

生成服务 API key，并在启动时传入容器：

```bash
export REMOTE_REPO_SERVICE_API_KEY="$(openssl rand -hex 32)"
```

本机试运行（只允许服务器本机访问）：

```bash
docker compose up --build -d
docker compose ps
curl -H "X-API-Key: $REMOTE_REPO_SERVICE_API_KEY" http://127.0.0.1:8765/v1/dashboard
```

让同一受信任局域网的另一台电脑访问时，显式开放监听地址：

```bash
REMOTE_REPO_BIND_ADDRESS=0.0.0.0 docker compose up --build -d
```

并在宿主机防火墙中仅允许你的局域网访问 TCP 8765。随后从另一台电脑验证：

```bash
sh deploy/verify-service.sh http://SERVER_LAN_IP:8765 "$REMOTE_REPO_SERVICE_API_KEY"
```

在另一台电脑的 Giteam 中打开「设置 → 远程仓库」，填入 `http://SERVER_LAN_IP:8765` 和同一个 API key，点击“测试连接”后保存。桌面版会把地址和 key 保存到自己的客户端 SQLite，不需要环境变量。

Compose 会先运行一次 `init-permissions` 容器，将两个挂载目录的所有者设为服务用户（UID/GID `10001`），随后主服务以非 root 用户运行。若宿主机策略禁止容器修改 bind mount 权限，再手动执行：

```bash
sudo chown -R 10001:10001 deploy/config deploy/data
```

浏览器版 Giteam 若跨域直连这个服务，还要将它的页面来源加入 `cors_allowed_origins`，例如 `"http://CLIENT_LAN_IP:1420"`。改完配置后执行 `docker compose restart`。

> 这个服务含有受限 Shell 与可写 workspace。API key 是最低限度的服务认证；公网部署前仍必须增加 TLS、反向代理访问控制、限流和更严格的命令沙箱，不要把 8765 直接裸露到公网。

以 systemd 运行的最小示例：

```ini
# /etc/systemd/system/giteam-remote-repo.service
[Unit]
Description=Giteam Remote Repo Service
After=network-online.target

[Service]
User=giteam
Group=giteam
Environment=REMOTE_REPO_SERVICE_CONFIG=/etc/giteam/remote-repo-service.json
WorkingDirectory=/opt/remote-repo-service
ExecStart=/opt/remote-repo-service/.venv/bin/python -m remote_repo_service start --host 127.0.0.1 --port 8765
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

把监听端口放在反向代理后面；不要把无认证的工作区 Shell API 直接暴露到公网。

## Giteam 服务地址

桌面端通过 `REMOTE_REPO_SERVICE_URL` 配置服务基址，例如：

```bash
export REMOTE_REPO_SERVICE_URL=https://giteam.example.com/remote-repo-service
```

Web 构建通过 `VITE_REMOTE_REPO_SERVICE_URL` 配置；更推荐让反向代理把同源的 `/remote-repo-service` 转发到服务，避免跨域配置：

```nginx
location /remote-repo-service/ {
  proxy_pass http://127.0.0.1:8765/;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

本地 Vite 开发也读取 `REMOTE_REPO_SERVICE_URL`，没有配置时代理到 `http://127.0.0.1:8765`。如果服务启用了 API key，再设置 `VITE_REMOTE_REPO_SERVICE_API_KEY` 或在 Giteam 设置页保存 key。

Giteam 设置页也可保存服务地址和 API key，优先级高于环境变量。桌面端把它保存到 Giteam 本地 SQLite；Web 端保存到浏览器本地存储。若 Web 端填写跨域的完整地址，请把 Giteam 页面来源加入服务端 `cors_allowed_origins`；默认仅允许本地开发地址 `localhost:1420` 和 `127.0.0.1:1420`。

## 恢复 API

Giteam 使用以下服务端状态接口恢复 UI：

- `GET /v1/repos/{repo_id}/workspaces`
- `GET /v1/workspaces/{workspace_id}`
- `POST /v1/workspaces/{workspace_id}/resume`
- `GET /v1/repos/{repo_id}/activities`
- `GET /v1/repos/{repo_id}/gitnexus/status`

保留了对应的 POST bridge 路由，供桌面端命令层使用；它们不是第二份状态，只是同一个 SQLite 状态库的适配入口。

## 发布前验证

在持久卷上执行以下流程：引入仓库、同步、创建 workspace、修改文件、创建/使用 session、运行 GitNexus 分析、停止服务、重新启动服务。之后应能从仓库概览重新看到该 workspace，点“继续工作”后读到修改的文件，并看到 dirty 与 GitNexus READY 状态。

该流程有自动回归测试：`pytest -q tests/test_persistence.py`。

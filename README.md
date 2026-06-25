# Giteam 远程仓库工作台

这个仓库是一个 Giteam 原型集成项目，包含两部分：

- `giteam/`：Giteam 桌面端 / Web 端客户端。
- `remote-repo-skill-brainstorm_2/`：Remote Repo Service，负责远程仓库连接、同步、只读代码资源、服务端 workspace/session、GitNexus 状态和持久化。

当前版本的重点是把“远程仓库”作为 Giteam 的一级工作台入口：用户可以在 Giteam 里引入远程仓库、查看分支和文件、同步远程元数据，并在需要时显式创建服务端远程工作区。

## 功能概览

### Giteam 客户端

- 左侧一级入口：`远程仓库`
- 右侧工作台展示：
  - 全部远程仓库列表
  - 仓库概览页
  - 分支只读页
  - 文件树 / 文件读取页
  - 远程工作区手动操作页
- 远程仓库操作：
  - 引入仓库
  - 编辑仓库
  - 移除仓库连接
  - 同步仓库元数据
  - 打开 / 继续远程工作区
- 服务地址可在 Giteam 设置页里配置，不需要每次手动 export。

### Remote Repo Service

- 仓库连接 CRUD
- Git mirror 同步
- 分支与提交读取
- 文件树与文件内容读取
- 显式创建 commit/ref 固定的服务端 workspace
- workspace 内受限 shell、文件写入、搜索、patch
- GitNexus 分析状态读取 / 触发
- SQLite 持久化：
  - repos
  - workspaces
  - sessions
  - gitnexus indexes
  - activities
- Docker 部署支持

## 项目结构

```text
.
├── giteam/
│   ├── apps/desktop/                 # Giteam 桌面端 / Web 预览
│   ├── apps/mobile/                  # 移动端
│   └── package.json
├── remote-repo-skill-brainstorm_2/
│   ├── src/remote_repo_service/      # Remote Repo Service 后端
│   ├── tests/                        # 后端测试
│   ├── docs/                         # 部署和集成文档
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── pyproject.toml
└── README.md
```

## 环境要求

本地开发建议准备：

- Node.js / npm
- Python 3.11+
- Git
- Rust 与 Tauri CLI（只在运行桌面壳时需要）
- Docker Desktop（只在 Docker 模拟远程服务时需要）
- GitNexus CLI（可选，用于代码图分析）

## 本地快速启动

### 1. 启动 Remote Repo Service

```bash
cd remote-repo-skill-brainstorm_2

python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

准备一个本地配置文件，例如：

```bash
mkdir -p "$HOME/.config/giteam"
cp docs/examples/remote-repo-service.local.json "$HOME/.config/giteam/remote-repo-service.local.json"
```

建议把配置里的 `storage_root` 改成固定持久目录，例如：

```json
{
  "storage_root": "/Users/rxl/.local/share/giteam/remote-repo-service"
}
```

然后启动服务：

```bash
REMOTE_REPO_SERVICE_CONFIG="$HOME/.config/giteam/remote-repo-service.local.json" \
python -m remote_repo_service start --host 127.0.0.1 --port 8765
```

验证：

```bash
curl http://127.0.0.1:8765/v1/dashboard
```

### 2. 启动 Giteam Web 预览

另开一个终端：

```bash
cd giteam/apps/desktop
npm install
REMOTE_REPO_SERVICE_URL=http://127.0.0.1:8765 npm run dev
```

访问：

```text
http://127.0.0.1:1420
```

如果不想每次传 `REMOTE_REPO_SERVICE_URL`，可以在 Giteam 的设置页中保存远程仓库服务地址。

### 3. 启动 Tauri 桌面端

```bash
cd giteam/apps/desktop
npm run tauri:dev
```

## Docker 模拟远程服务

Remote Repo Service 可以用 Docker 运行，适合模拟“服务部署在另一台机器，本机 Giteam 访问它”的场景。

```bash
cd remote-repo-skill-brainstorm_2
docker compose up --build -d
```

默认只监听本机：

```text
127.0.0.1:8765
```

如果要让局域网其他电脑访问，可在受信任网络中启动：

```bash
REMOTE_REPO_BIND_ADDRESS=0.0.0.0 docker compose up --build -d
```

然后在另一台电脑的 Giteam 设置里填写：

```text
http://<服务机器 IP>:8765
```

注意：Docker 访问 SSH 仓库时需要容器内具备 SSH 客户端和可用凭据；访问 GitHub HTTPS 仓库时需要宿主机和容器网络都能访问 GitHub。

## 远程仓库工作流

1. 打开 Giteam 左侧 `远程仓库`
2. 进入 `全部远程仓库`
3. 点击 `引入仓库`
4. 填写：
   - connection id / repo id
   - display name
   - repo url
   - default ref
5. 点击同步，刷新：
   - 分支
   - 提交
   - 文件元数据
   - GitNexus 状态
6. 点击仓库进入概览页
7. 根据需要进入：
   - 浏览文件
   - 查看分支
   - 打开远程工作区

同步只刷新服务端元数据，不会修改远端仓库，也不会隐式创建 workspace/session。

## 持久化说明

Remote Repo Service 的运行状态保存在 `storage_root` 下，核心文件是：

```text
storage_root/state.db
```

同时还会保存：

- 仓库 mirror
- workspace 工作区
- GitNexus 分析工作树
- npm / GitNexus 缓存

部署到远程服务器时，请把 `storage_root` 挂载到持久磁盘，例如：

```text
/var/lib/giteam/remote-repo-service
```

不要放在临时目录或容器内部不可持久的位置。

## 常用开发命令

### Giteam

```bash
cd giteam
npm run dev
npm run build
npm run tauri:dev
npm run tauri:build
```

桌面端相关测试：

```bash
cd giteam/apps/desktop
node --test tests/*.test.mjs
```

### Remote Repo Service

```bash
cd remote-repo-skill-brainstorm_2
pytest -q
```

常用 CLI：

```bash
python -m remote_repo_service repo list
python -m remote_repo_service repo add <repo-id> <repo-url> --name "<display-name>" --default-ref main
python -m remote_repo_service repo sync <repo-id>
python -m remote_repo_service repo remove <repo-id>
```

## 安全边界

当前版本面向本地开发和受信任内网原型，不建议直接暴露到公网。

需要特别注意：

- 不要在 Giteam UI 中保存 token。
- 仓库 URL 展示时应脱敏，不展示用户名、密码或 token。
- `run_shell` 只能在用户显式创建的服务端 workspace 内执行。
- workspace 修改不会自动提交、推送或合并。
- 对外部署前应补充认证、权限控制、审计和更严格的命令沙箱。

## 进一步文档

- `giteam/README.md`：Giteam 原项目说明
- `remote-repo-skill-brainstorm_2/README.md`：Remote Repo Service 详细说明
- `remote-repo-skill-brainstorm_2/docs/remote-deployment.md`：远程部署与持久化
- `remote-repo-skill-brainstorm_2/docs/opencode-mcp-integration.md`：OpenCode / MCP 集成


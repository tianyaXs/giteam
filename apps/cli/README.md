# `giteam`

`giteam` 是终端侧的控制服务入口，复用 `crates/giteam-core` 中的逻辑，对外提供与桌面端一致的局域网控制接口，供移动端发现并连接。

## 环境要求

- **Node.js**：`>= 18`（用于 `bin/giteam.js` 启动器）
- **Rust / Cargo**：当未命中平台预编译包时，会回退到本机编译（需已安装 `cargo`）

## 安装

全局安装后，命令行中应可直接使用 `giteam`：

```bash
npm install -g giteam
giteam --version
```

若安装后终端仍提示找不到命令，请检查全局 `npm` 的 `bin` 目录是否在 `PATH` 中（常见路径如 `~/.npm-global/bin`）。

## 支持的平台（预编译包）

安装器会优先尝试拉取对应平台的预编译包；若无匹配包，则在本机用 Cargo 编译。

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`

## 快速开始

第一次安装后，推荐先跑一遍初始化检查：

```bash
giteam init
```

默认会进入一个带步骤提示的终端引导流程，顶部会保留 giteam 字符画，并依次引导你：

- 检查依赖
- 按需安装缺失依赖
- 导入一个本地 Git 项目
- 配置 OpenCode provider / model
- 启动服务或接入系统托管

如果希望自动安装缺失依赖：

```bash
giteam init --install-missing
```

如果你在脚本里使用，或不希望进入交互引导，可以继续传明确参数；`--json` 也会自动关闭交互模式。

日常最常用的服务命令：

```bash
giteam service start
giteam service status
giteam service logs --follow
giteam service stop
```

## 命令总览

CLI 目前分成几类职责：

- `service`：控制移动端控制服务的前台/后台运行、日志、系统托管与诊断
- `init`：检查本机运行环境，必要时自动安装缺失依赖
- `plugin`：单独检查、安装、更新、卸载依赖项
- `pair-code`：查看或刷新移动端配对码
- `config`：查看和修改控制服务 / OpenCode 配置
- `doctor`：执行更偏仓库和运行环境层面的综合诊断

## 常用命令

```bash
giteam init
giteam init --install-missing
giteam plugin list
giteam plugin check giteam
giteam service serve
giteam service start
giteam service status
giteam service logs --tail 120
giteam service doctor
giteam service install
giteam service enable
giteam pair-code
giteam pair-code --refresh
giteam config get
giteam config set --host 0.0.0.0 --port 4100 --pair-code-ttl-mode forever
giteam doctor
giteam doctor --json
giteam doctor --warmup --repo-path /path/to/repo
```

为兼容旧脚本，以下旧入口仍可用：

```bash
giteam serve
giteam start
giteam stop
giteam status
giteam logs --follow
```

但新项目更推荐统一使用 `giteam service ...`。

### `init`

用于首次安装后的环境检查。

- 纯终端下默认进入向导式交互流程
- 默认只检查，不修改系统
- `--install-missing` 会尝试安装缺失依赖
- `--interactive` 可强制进入交互流程
- `--with git,opencode` 可只处理指定插件

### `plugin`

用于单独管理运行依赖：

```bash
giteam plugin list
giteam plugin check opencode
giteam plugin install giteam
giteam plugin uninstall giteam
giteam plugin update giteam
```

当前支持：

- `git`
- `entire`
- `opencode`
- `giteam`

### `service serve`

启动控制服务，并在前台保持运行（`Ctrl+C` 退出）。

适合：

- 本地调试
- 直接观察实时输出
- 短期临时运行

### `service start`

后台启动控制服务，适合日常使用。

启动后可配合：

```bash
giteam service status
giteam service logs --follow
```

### `service status`

查看当前控制服务状态，包括：

- 运行状态
- 监听地址和端口
- PID 与日志路径
- 配对策略
- 局域网 / 公网访问地址
- 系统服务托管状态（`launchd` / `systemd --user`）

### `service doctor`

对 service 层做专项诊断，聚焦：

- 配置与实际运行状态是否一致
- 系统 service manager 是否安装 / 加载 / 启用
- service 定义文件是否存在
- 定义是否仍指向当前 CLI 二进制
- 最近日志中是否出现错误线索

示例：

```bash
giteam service doctor
giteam service doctor --json
```

### `service install / enable / disable / uninstall`

用于把 giteam 控制服务接入操作系统托管。

当前支持：

- macOS：`launchd`
- Linux：`systemd --user`

命令示例：

```bash
giteam service install
giteam service enable
giteam service disable
giteam service uninstall
```

这些命令已做幂等处理，重复执行不会造成明显副作用。

### `pair-code`

查看当前验证码；加 `--refresh` 会轮换为新验证码（需具备相应权限/场景）。

### `config`

查看或更新控制服务与 OpenCode 相关配置。

常用字段示例：

- `--enabled`：是否对外启用控制接口（与桌面端「开关」语义一致）
- `--host` / `--port`：监听地址与端口
- `--public-base-url`：对外公告的公网/局域网基础 URL（可选）
- `--pair-code-ttl-mode`：验证码有效期策略
- `--opencode-port`：OpenCode 服务端口
- `--repo-path`：与仓库路径相关的设置（如传入）

### `doctor`

运行时自检：配置、端口、依赖（`git` / `cargo` / `npm` / `opencode` 等）与可选的 OpenCode 预热。

默认不主动拉起 OpenCode；仅当传入 `--warmup` 时才会做预热类检查。

## 仓库内本地运行（开发/调试）

在 monorepo 中可直接用启动器或 Cargo：

```bash
cd apps/cli
node ./bin/giteam.js service status --json
node ./bin/giteam.js service serve
node ./bin/giteam.js service doctor
# 或
cargo run -- service status
cargo run -- service serve
cargo run -- service doctor
```

`bin/giteam.js` 的解析顺序（简化说明）：

1. 已安装的平台预编译包（若存在）
2. 本地 `target/release/giteam-cli` 或 `target/debug/giteam-cli`
3. 打包内同步的 Rust 源码目录 + `cargo run`

## 与移动端配合时的提示

- 手机端连接地址一般为 `http://<电脑局域网IP>:<port>`，具体以 `giteam status` 输出为准。
- 若启用了验证码模式，请使用 `giteam pair-code` 获取当前码，或在桌面端完成配对后使用返回的 token（取决于你的客户端实现）。

## 推荐使用路径

如果你是第一次用：

```bash
giteam init
giteam service start
giteam pair-code
```

如果你要长期给移动端提供服务：

```bash
giteam service install
giteam service enable
giteam service status
```

如果你在排查问题：

```bash
giteam service doctor
giteam service logs --tail 200
giteam doctor --json
```

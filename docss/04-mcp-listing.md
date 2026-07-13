# Giteam 后端实现深度解析：MCP 服务器

## 1. 一句话概括

Giteam 不实现 MCP 协议本身，只负责**把 MCP 服务器的配置写入 OpenCode 能读取的文件**，然后启动 OpenCode 服务，让 OpenCode 自己去连接和调用这些 MCP 服务器。

## 2. 为什么要这么做？

### 2.1 什么是 MCP？

MCP（Model Context Protocol）是 Anthropic 推出的开放协议，用来让 AI 应用调用外部工具。比如：

- 查询数据库
- 读取本地文件
- 操作 Git 仓库
- 调用远程 API

MCP 服务器是一个独立进程，通过 stdio 或 HTTP/SSE 与 OpenCode 通信。

### 2.2 Giteam 为什么不自己实现 MCP？

MCP 协议包括：

- 发现工具（tools/list）
- 调用工具（tools/call）
- 资源管理
- 错误处理
- 生命周期管理

OpenCode 已经完整实现了 MCP client 能力。Giteam 只需要告诉 OpenCode：有哪些 MCP 服务器、怎么启动它们。这样架构最简单，也最容易扩展。

## 3. 后端具体怎么做？

### 3.1 MCP 配置存在哪里？

OpenCode 读取自己的配置文件来加载 MCP。Giteam 支持两类配置：

- **项目级**：`<repo>/opencode.jsonc` 或 `<repo>/opencode.json`
- **全局级**：`~/.config/opencode/opencode.jsonc`

一个典型的配置长这样：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "remote_repo": {
      "type": "local",
      "command": ["python3", "/absolute/path/to/giteam_mcp_launcher.py"],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

### 3.2 读取 JSONC

OpenCode 的配置文件是 JSONC，也就是带注释的 JSON。Rust 的 `serde_json` 不能直接解析带注释的 JSON。

所以 Giteam 后端先自己实现一个 `strip_jsonc_comments` 函数，把注释去掉，然后再用 `serde_json` 解析。

### 3.3 写入配置

后端提供两个核心函数：

- `upsert_mcp_to_config_file(path, name, config)`：插入或更新一个 MCP；
- `remove_mcp_from_config_file(path, name)`：删除一个 MCP，如果 `mcp` 对象空了，就把整个 `mcp` 键也删掉。

### 3.4 从技能同步 MCP

每个已安装技能的 `giteam.json` 可以声明 MCP。后端通过 `sync_opencode_skill_mcp_manifests` 自动把它们同步到 `opencode.jsonc`。

流程：

1. 扫描所有已安装技能；
2. 读取每个技能的 `giteam.json`；
3. 提取 `giteam.mcp`；
4. 规范化（去掉 `name`、默认 `enabled: true`、推断 `type`、解析相对路径为绝对路径）；
5. upsert 到项目 `opencode.jsonc`；
6. 返回哪些同步成功、哪些跳过。

### 3.5 MCP 配置如何生效？

关键：**Giteam 不把 MCP 配置作为参数传给 `opencode serve`**。

而是：

1. 先把 MCP 配置写进 `opencode.jsonc`；
2. 启动 `opencode serve` 时，把当前工作目录设成仓库根目录；
3. OpenCode 启动后自己读取 `opencode.jsonc`，然后连接 MCP 服务器。

这意味着：如果 MCP 配置改了，需要重启 OpenCode 服务才能生效（Giteam 已经处理了这个问题，会在必要时重启）。

### 3.6 列出已配置 MCP

`list_opencode_mcp_status` 读取项目级和全局级配置，返回所有已配置的 MCP。

注意：它只读磁盘上的配置，**不查询 OpenCode 的运行时状态**。也就是说，它知道某个 MCP 被配置了，但不知道它当前是否连接成功。

### 3.7 连接/断开/认证/登出

- **connect**：验证配置字段是否齐全（local 需要 `command[]`，remote 需要 `url`），返回成功。它实际上不会立刻启动 MCP，因为启动是 OpenCode 的职责。
- **disconnect**：把配置里的 `enabled` 设为 `false`。
- **authenticate**：运行 `opencode mcp auth <name>`。
- **logout**：运行 `opencode mcp logout <name>`。

## 4. 遇到过什么难题？

### 4.1 难题一：配置改了但 MCP 没重新加载

**现象**：用户添加或删除 MCP 后，OpenCode 还是用的旧配置。

**根因**：OpenCode 启动时读取一次 `opencode.jsonc`，运行中不会自动重新加载。

**解决**：

- Giteam 在修改 `opencode.jsonc` 后，判断是否需要重启 OpenCode 服务；
- 如果需要，杀掉旧进程并重新启动；
- 重启时从正确目录启动，读取最新配置。

### 4.2 难题二：相对路径解析

**现象**：技能 MCP 的启动脚本路径是相对技能目录的，OpenCode 找不到。

**根因**：OpenCode 的 cwd 是仓库根目录，不是技能目录。

**解决**：

- 在 `normalize_skill_mcp_config` 中，把 `command` 数组里的相对路径解析成绝对路径；
- 写入 `opencode.jsonc` 前完成解析。

### 4.3 难题三：市场和自定义 MCP 格式不统一

**现象**：市场目录 `servers.json`、自定义添加表单、技能清单三者的 MCP 配置格式略有不同。

**根因**：不同来源的数据结构不一致，比如有的用 `command` + `args`，有的用 `command[]`，有的用 `env` 而不是 `environment`。

**解决**：

- 前端 `mcpMarket.ts` 和 `opencodeMcpConfig.ts` 做了一层规范化；
- 后端 `add_opencode_mcp_server` 统一写入标准格式；
- 支持 `mcpServers` 这种旧键名作为别名。

### 4.4 难题四：项目和全局配置源冲突

**现象**：同一个 MCP 名可能同时出现在项目 `opencode.jsonc` 和全局 `opencode.jsonc` 里，用户不知道哪个生效。

**根因**：OpenCode 允许两级配置，Giteam 又同时管理这两级。

**解决**：

- 列出时标记每个 MCP 的 `source`（project 或 global）；
- 删除时尝试从所有已知配置文件中删除；
- disconnect 时把项目级和全局级的 `enabled` 都设为 false。

## 5. 数据流总结

```
用户从市场添加 MCP
  ↓
前端把配置传给后端 add_opencode_mcp_server
  ↓
后端写入 <repo>/opencode.jsonc
  ↓
如果需要，后端重启 opencode serve
  ↓
OpenCode 启动后读取 opencode.jsonc
  ↓
OpenCode 启动 MCP 服务器子进程
  ↓
AI 调用 MCP 工具

或：

安装内置技能
  ↓
sync_opencode_skill_mcp_manifests
  ↓
读取技能的 giteam.json
  ↓
把 MCP 配置 upsert 到 opencode.jsonc
  ↓
重启 OpenCode 生效
```

## 6. 面试可以怎么讲

> Giteam 不自己实现 MCP 协议，而是负责把 MCP 配置写进 OpenCode 的配置文件 `opencode.jsonc`，然后启动 OpenCode，让 OpenCode 去连接和调用 MCP 服务器。
>
> 后端主要做几件事：一是读写 JSONC 配置文件，因为 OpenCode 用带注释的 JSON，我们自己实现了注释剥离；二是从技能同步 MCP，每个技能的 `giteam.json` 可以声明 MCP，安装技能后自动 upsert 到 `opencode.jsonc`；三是列出、添加、删除、启用/禁用 MCP。
>
> 我们遇到过一个坑：用户添加 MCP 后 OpenCode 没生效，因为 OpenCode 启动时才读一次配置。后来我们加了配置变更后自动重启 OpenCode 的逻辑。另一个坑是相对路径，技能里的 MCP 脚本是相对技能目录的，OpenCode 的 cwd 是仓库根目录，所以同步时要把相对路径解析成绝对路径。

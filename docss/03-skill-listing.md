# Giteam 后端实现深度解析：技能（Skill）

## 1. 一句话概括

Giteam 不执行技能逻辑，只负责**管理技能的安装目录和元数据**。技能真正的运行由 OpenCode 负责。Giteam 需要做的是：发现本地已安装技能、从市场安装新技能、把内置技能打包进二进制、以及根据技能清单自动同步 MCP 配置。

## 2. 为什么要这么做？

### 2.1 什么是 Skill？

OpenCode Skill 是一套扩展包，通常包含：

- `SKILL.md`：技能说明和指令；
- `agents/*.yaml`：Agent 提示词配置；
- `references/`：参考资料；
- `scripts/`：脚本；
- `giteam.json`：Giteam 特有的元数据，比如声明 MCP。

Skill 让 OpenCode 能完成特定任务，比如操作远程仓库、查文档、跑测试等。

### 2.2 Giteam 为什么只管理，不执行？

执行技能意味着：

- 解析 `SKILL.md`；
- 调用 Agent；
- 管理工具调用上下文；
- 处理 skills 的依赖和版本。

这些能力 OpenCode 已经完整实现。Giteam 如果再做一遍，就是重复造轮子。所以 Giteam 只负责**把技能放到 OpenCode 能找得到的地方**，剩下的交给 OpenCode。

## 3. 后端具体怎么做？

### 3.1 发现已安装技能

后端扫描几个固定目录：

- 项目级：
  - `<repo>/.opencode/skills/*`
  - `<repo>/.agents/skills/*`
- 全局级：
  - `~/.config/opencode/skills/*`
  - `~/.opencode/skills/*`
  - `~/.agents/skills/*`

规则很简单：只要一个目录里有 `SKILL.md`，就认为它是一个技能。

后端返回每个技能的信息：

```json
{
  "name": "opencode-remote-repo",
  "path": "/Users/.../project/.opencode/skills/opencode-remote-repo",
  "scope": "project",
  "agents": ["openai"],
  "sourceGroup": "default"
}
```

### 3.2 内置技能（Built-in）

Giteam 把一些关键技能直接嵌入 Rust 二进制，避免用户首次使用时需要联网下载。

当前唯一的内置技能是 `opencode-remote-repo`。嵌入方式是用 Rust 的 `include_str!` 宏：

```rust
const REMOTE_REPO_SKILL_FILES: &[BuiltinOpencodeSkillFile] = &[
    BuiltinOpencodeSkillFile { path: "SKILL.md", contents: include_str!("...") },
    BuiltinOpencodeSkillFile { path: "giteam.json", contents: include_str!("...") },
    BuiltinOpencodeSkillFile { path: "mcp/giteam_mcp_launcher.py", contents: include_str!("...") },
    // ...
];
```

编译时，这些文件内容就被写死到二进制里了。

安装内置技能时，后端把这些字符串写到磁盘上：

- 项目级：`<repo>/.opencode/skills/opencode-remote-repo/`
- 全局级：`~/.config/opencode/skills/opencode-remote-repo/`

### 3.3 从市场安装技能

市场技能来源：

1. 硬编码推荐列表；
2. SkillsMP 搜索 API；
3. 传统路径：`npx skills find <query>`。

安装时，前端会执行：

```bash
SKILLS_CLONE_TIMEOUT_MS=600000 npx -y skills add <spec> --agent opencode -y [-g]
```

`-g` 表示全局安装，否则是项目级安装。

后端提供一个异步安装命令，前端可以轮询安装状态。

### 3.4 技能源分组（Source Groups）

有时候一次安装会装多个技能，为了 UI 上能把它们归为一组，Giteam 维护了一个“路径 → 分组”的映射。

- 项目级：`<repo>/.giteam/opencode-skill-source-groups.json`
- 全局级（macOS）：`~/Library/Application Support/giteam/opencode-skill-source-groups.json`
- 全局级（Linux）：`~/.config/giteam/opencode-skill-source-groups.json`

这样前端展示已安装技能时，可以按分组折叠。

## 4. `giteam.json` 是技能和后端的“约定”

技能目录里可以有一个 `giteam.json`，用来告诉 Giteam 一些额外信息。目前最重要的是声明 MCP：

```json
{
  "giteam": {
    "mcp": {
      "name": "remote_repo",
      "type": "local",
      "command": [
        "python3",
        "mcp/giteam_mcp_launcher.py"
      ],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

后端读取时会：

- 优先读 `giteam.mcp`，回退到顶层 `mcp`；
- 把 `name` 字段作为 MCP 的键名；
- 默认 `enabled: true`；
- 如果没写 `type`，有 `url` 就是 `remote`，否则是 `local`；
- 把 `command` 里的相对路径解析成绝对路径（相对于技能目录）。

## 5. 遇到过什么难题？

### 5.1 难题一：内置技能安装后 MCP 没有生效

**现象**：用户安装了 Remote Repo 内置技能，但 MCP 列表里没有 `remote_repo`。

**根因**：安装技能只是写了文件，OpenCode 不知道要加载这个 MCP。必须把 MCP 配置写进 `opencode.jsonc`，OpenCode 启动时才会加载。

**解决**：

- 安装内置技能后，自动调用 `sync_opencode_skill_mcp_manifests`；
- 这个函数会扫描所有已安装技能，读取它们的 `giteam.json`；
- 把其中的 MCP 配置 upsert 到项目 `opencode.jsonc`。

### 5.2 难题二：技能 MCP 路径是相对还是绝对？

**现象**：`giteam.json` 里写的是相对路径 `mcp/giteam_mcp_launcher.py`，但 OpenCode 从仓库根目录启动，找不到这个文件。

**根因**：OpenCode 的 cwd 是仓库根目录，而技能的脚本在 `.opencode/skills/<skill-name>/mcp/` 下面。

**解决**：

- 后端同步时，把 `command` 数组里的相对路径解析成绝对路径；
- 写入 `opencode.jsonc` 时已经是绝对路径，OpenCode 启动后可以直接执行。

### 5.3 难题三：异步安装状态怎么反馈给前端？

**现象**：市场技能安装可能耗时几分钟（比如要 clone 仓库），前端不能一直卡住等。

**根因**：`npx skills add` 是长时间运行的子进程。

**解决**：

- 后端提供异步安装命令 `install_opencode_skill_from_registry`，立刻返回一个任务 ID；
- 用单独线程运行 `npx skills add`，捕获 stdout/stderr；
- 前端通过 `get_opencode_skill_install_status` 轮询进度；
- Tauri 模式下还支持流式日志推送给前端。

### 5.4 难题四：多个配置源冲突

**现象**：同一个 MCP 可能同时出现在项目 `opencode.jsonc`、全局 `opencode.jsonc`、以及多个技能的 `giteam.json` 里。

**根因**：OpenCode 支持项目和全局两级配置，Giteam 又从技能自动同步。

**解决**：

- 技能同步只写入项目级 `opencode.jsonc`；
- 列出 MCP 时同时读取项目和全局配置，标记每个 MCP 的 `source`；
- 删除 MCP 时，尝试从所有已知配置文件中删除。

## 6. 数据流总结

```
用户点击安装内置技能
  ↓
前端 invoke install_builtin_opencode_skill
  ↓
后端把 include_str! 里的文件内容写到 .opencode/skills/
  ↓
后端调用 sync_opencode_skill_mcp_manifests
  ↓
扫描所有已安装技能，读取 giteam.json
  ↓
把 giteam.mcp 写入 opencode.jsonc
  ↓
下次启动 opencode serve 时，OpenCode 读取 opencode.jsonc 加载 MCP
```

## 7. 面试可以怎么讲

> Giteam 的技能系统只做安装和管理，不执行技能逻辑，真正的执行交给 OpenCode。后端会扫描 `.opencode/skills/` 和 `~/.config/opencode/skills/` 这些目录，只要有 `SKILL.md` 就认为是已安装技能。
>
> 内置技能用 Rust 的 `include_str!` 宏嵌入二进制，比如 Remote Repo 技能。安装时把这些文件落到磁盘，然后自动同步 `giteam.json` 里声明的 MCP 到 `opencode.jsonc`。这里有个关键点：`giteam.json` 里写的是相对路径，但 OpenCode 的 cwd 是仓库根目录，所以后端同步时会把相对路径解析成绝对路径再写进去。
>
> 我们遇到过一个坑：用户装完技能后 MCP 没出现，后来发现是只写了技能文件，没同步 `opencode.jsonc`。于是加了安装后自动同步的逻辑。市场技能安装耗时比较长，我们也做了异步安装和状态轮询。

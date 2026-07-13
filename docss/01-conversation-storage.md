# Giteam 后端实现深度解析：对话保存

## 1. 一句话概括

Giteam 自己不保存对话内容。对话的真实数据全部存在 OpenCode 服务里，Giteam 只是作为一个**本地代理**，帮前端把请求转发给 OpenCode，同时做一些缓存和状态同步。

## 2. 为什么要这么做？

### 2.1 什么是 OpenCode？

OpenCode 是一个本地运行的 AI 代理服务。它负责：

- 管理会话（session）
- 存储消息历史
- 调用大模型
- 调用 MCP 工具
- 管理技能和模型配置

Giteam 的愿景不是再造一个 AI 引擎，而是把 OpenCode 的能力包装成一个更好用的 Git 客户端。所以 Giteam 不会自己存对话，而是让 OpenCode 当“数据源”。

### 2.2 为什么不自己存？

如果 Giteam 自己保存对话，会遇到几个问题：

- **数据不一致**：用户可能直接用 OpenCode CLI 操作会话，Giteam 就会丢失这些信息；
- **重复开发**：会话模型、消息格式、工具调用结果这些 OpenCode 已经做得很好；
- **迁移困难**：用户换电脑或重装 Giteam 时，需要额外处理数据导入导出。

让 OpenCode 当唯一真相源，Giteam 只负责展示和交互，架构更清晰。

## 3. 后端具体怎么做？

### 3.1 启动 OpenCode 服务

当用户打开一个仓库时，Giteam 后端会检查这个仓库对应的 OpenCode 服务是否已经启动。

如果没有启动，就执行：

```
opencode serve --hostname 127.0.0.1 --port 4098 --print-logs
```

并且把当前工作目录设成这个仓库的根目录。

**为什么这么关键？**

因为 OpenCode 会读取当前目录下的 `opencode.jsonc` 配置文件。这个文件里有：

- 当前项目的 MCP 配置
- 当前项目的技能配置
- 当前项目的模型偏好

每个仓库的 `opencode.jsonc` 都可能不同，所以必须让 OpenCode 从正确的目录启动。

### 3.2 用 `x-opencode-directory` 头隔离仓库

OpenCode 服务本身可以服务多个仓库，但 Giteam 给每个仓库单独启动一个服务实例。更进一步，所有 HTTP 请求都会带上：

```
x-opencode-directory: /path/to/repo
```

这个头告诉 OpenCode：这次请求是针对哪个仓库的。

**为什么需要这个头？**

因为 OpenCode 内部可能有全局配置和项目配置之分。带上这个头后，OpenCode 知道应该加载哪个目录下的配置，避免不同仓库的配置互相污染。

### 3.3 后端代理了哪些 OpenCode API？

Giteam 后端的核心工作就是把前端请求转发给 OpenCode。主要代理的接口包括：

| 功能 | OpenCode 端点 | Giteam 后端作用 |
|------|---------------|-----------------|
| 创建会话 | `POST /session` | 转发，记录会话与仓库关系 |
| 列出会话 | `GET /session` | 转发并做本地索引缓存 |
| 获取消息 | `GET /messages` | 转发，支持分页参数 |
| 发送消息 | `POST /session/{id}/prompt_async` | 转发 prompt body |
| 实时流 | `GET /global/event` | 代理 SSE 流给前端 |
| 中止生成 | `POST /abort` | 转发 |
| 权限请求 | `GET /permission` | 转发并展示 |
| 问题请求 | `GET /question` | 转发并展示 |

### 3.4 本地 SQLite 存什么？

Giteam 后端用 SQLite（通过 `rusqlite`）存一些**元数据**，而不是消息内容本身：

- 仓库列表（路径、打开时间、worktree 数量）
- 会话与仓库的映射关系
- 最近的会话 ID，方便快速恢复
- 本地 review 记录、书签等 Giteam 特有功能的数据

**为什么元数据和消息内容要分开？**

消息内容变化频繁、体积大、格式由 OpenCode 控制；元数据体积小、结构稳定、由 Giteam 自己定义。分开存可以避免 Giteam 被 OpenCode 的数据格式变化绑架。

## 4. 遇到过什么难题？

### 4.1 难题一：OpenCode 服务“绑死”在旧目录

**现象**：用户把仓库目录移到废纸篓，或者重命名了项目文件夹，然后发现 AI 会话还能打开，但 MCP 工具（比如 Remote Repo）突然失效。

**根因**：旧的 `opencode serve` 进程还在后台运行，它的当前工作目录仍然是原来的路径。OpenCode 读取 `opencode.jsonc` 时还是从旧路径读，MCP 启动脚本的路径也是旧的，自然就找不到了。

**解决**：

- 在 Giteam 后端的服务池里，给每个托管的 OpenCode 服务记录它启动时的**规范路径**（`repo_path`）；
- 每次用户打开仓库时，检查现有服务：
  - 如果端口号不对，杀掉重启；
  - 如果当前工作目录和要打开的仓库不一致，杀掉重启；
  - 如果进程 PID 已经不存在，直接启动新的。

这个逻辑写在 `giteam-core` 里，桌面端和 CLI 共用。

### 4.2 难题二：移动端怎么同步对话？

**现象**：手机连上桌面端后，需要看到和桌面端一样的会话列表和消息历史。

**根因**：手机不直接访问 OpenCode，而是通过桌面端的 Control Server。Control Server 需要把 OpenCode 的消息数据“翻译”成适合移动端的格式。

**解决**：

- Control Server 提供 `GET /api/v1/opencode/messages`，内部调用 OpenCode 的 `/messages`；
- 对消息做“压缩”：去掉巨大的 `system` prompt、截断 tool 输出到 4096 字符；
- 移动端用分页拉取历史，同时用 SSE `/api/v1/opencode/stream` 接收实时更新；
- 手机本地用 MMKV 缓存聊天快照，弱网也能先展示旧内容。

### 4.3 难题三：SSE 流在手机端断连

**现象**：手机网络不稳定，SSE 流经常断开，消息更新中断。

**根因**：SSE 是长连接，移动网络切换或锁屏后容易断。

**解决**：

- SSE 只做实时推送；
- 同时维护一个独立的分页拉取逻辑做兜底；
- 每次重新连接后，用 `before` 参数拉取断开后新增的消息；
- 用消息 ID 去重，避免同一条消息显示两次。

## 5. 数据流总结

```
用户输入
  ↓
Giteam 前端（React / React Native）
  ↓
Giteam 后端（Tauri command / Control Server）
  ↓
OpenCode 本地服务（127.0.0.1:4098）
  ↓
大模型 / MCP 工具

对话内容：只存在 OpenCode
元数据：存在 Giteam 的 SQLite
缓存：移动端 MMKV，桌面端 localStorage/React state
```

## 6. 面试可以怎么讲

> Giteam 的对话保存策略是“OpenCode 当唯一真相源，Giteam 只做代理和缓存”。也就是说，真正的会话、消息、工具调用结果都存在 OpenCode 里，Giteam 的 SQLite 只存仓库列表、会话映射这些元数据。这样设计的原因是避免数据不一致，也让 Giteam 不用重复实现 OpenCode 已经做好的事情。
>
> 具体实现上，后端会为每个仓库启动一个 `opencode serve` 进程，并且把 cwd 设成仓库根目录。所有请求都带 `x-opencode-directory` 头，确保配置隔离。我们曾经遇到过一个坑：用户删除或重命名仓库后，旧进程还绑在原来的路径上，导致 MCP 找不到启动脚本。后来我们在服务池里加了 repo_path 追踪和 cwd 校验，路径不一致就杀掉重启。
>
> 移动端不直接连 OpenCode，而是通过桌面端的 Control Server。Control Server 会把 OpenCode 的消息做压缩后返回，比如去掉 system prompt、截断 tool 输出。移动端用 SSE 实时收消息，同时用分页拉取做兜底，断网重连后也不会丢消息。

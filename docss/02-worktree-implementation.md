# Giteam 后端实现深度解析：工作树（Worktree）

## 1. 一句话概括

Giteam 的工作树功能**没有自己造轮子**，而是直接调用 Git 原生的 `git worktree` 命令。后端的职责是：把前端的操作请求翻译成 Git 命令、解析 Git 的输出、把结果结构化后返回给前端，同时用文件系统监听让 UI 保持最新。

## 2. 为什么要用原生 Git worktree？

### 2.1 工作树是什么？

Git worktree 允许一个仓库同时拥有多个工作目录。每个 worktree 可以指向不同的分支或 commit，但共享同一个 `.git` 对象数据库。

典型用法：

- 主 worktree 在 `main` 分支写新功能；
- 再开一个 worktree 在 `bugfix` 分支修线上 bug；
- 两个目录互不干扰，不用来回 `git stash` / `git checkout`。

### 2.2 为什么不用虚拟文件系统或自己实现？

自己实现一套“工作树”会面临很多问题：

- **正确性**：Git 的索引、HEAD、ref、stash、submodule 等状态非常复杂，自己模拟容易出错；
- **兼容性**：用户可能同时用命令行操作 Git，Giteam 必须和命令行看到一致的状态；
- **维护成本**：Git 每次升级新特性，自己实现都要跟进。

直接用 `git worktree` 命令，Giteam 看到的就是 Git 看到的，零歧义。

## 3. 后端具体怎么做？

### 3.1 列出工作树

后端执行：

```bash
git worktree list --porcelain
```

这个命令输出类似这样：

```
worktree /path/to/repo
HEAD abcd1234
branch refs/heads/main

worktree /path/to/repo.worktrees/bugfix
HEAD efgh5678
branch refs/heads/bugfix
```

后端按空行分段解析，得到每个 worktree 的路径、HEAD、分支、是否 detached、是否 locked。

然后对每个 worktree 再执行：

```bash
git status --short --branch
```

拿到脏文件数量、 ahead/behind 等信息。

### 3.2 创建工作树

基于分支创建：

```bash
git worktree add /path/to/new-worktree branch-name
```

基于某个 commit 创建 detached：

```bash
git worktree add --detach /path/to/new-worktree commit-sha
```

**自动目录命名**：如果用户没指定路径，Giteam 会在仓库同级创建一个 `<repo-name>.worktrees/<branch-name>/` 目录。如果同名目录已存在，就自动加 `-2`、`-3` 后缀。

### 3.3 删除工作树

```bash
git worktree remove --force /path/to/worktree
```

**保护机制**：后端禁止删除当前正在使用的工作树。通过规范化路径比较，如果目标路径就是当前路径，直接报错。

### 3.4 切换工作树

Giteam 里的“切换 worktree”不是 Git 命令，而是**前端把当前选中的仓库路径改成目标 worktree 的路径**，然后重新加载数据。

为什么这么做？

因为每个 worktree 本质上就是一个独立的目录。Giteam 的很多功能（会话、AI 上下文、文件变更）都是围绕“当前仓库路径”组织的。路径一变，就相当于切换到了新的工作区。

### 3.5 文件系统监听

后端用 Rust 的 `notify` crate 监听整个仓库目录。当文件发生变更时，向前端发送 `git-worktree-changed` 事件，前端收到后刷新 worktree 状态。

监听时会过滤掉一些噪声目录：

- `node_modules`
- `dist`、`target`、`.next`、`.turbo`、`.expo`、`.gradle`
- `.git` 目录下大部分文件，只关心 `index`、`HEAD`、`refs`、`packed-refs`、`MERGE_HEAD`

## 4. 后端数据结构

后端把 Git 的输出封装成几个核心结构：

| 结构 | 含义 |
|------|------|
| `GitLinkedWorktree` | 一个 worktree 的元信息：路径、分支、HEAD、是否当前、是否干净、locked/prunable |
| `GitWorktreeOverview` | 某个 worktree 的整体状态：分支追踪、ahead/behind、脏文件计数、文件条目列表 |
| `GitWorktreeEntry` | 单个文件状态：路径、index 状态、worktree 状态、是否 staged/untracked |
| `GitWorktreeCreateResult` / `GitWorktreeRemoveResult` | 创建/删除结果 |

这些数据结构通过 Tauri command 返回给前端。

## 5. 本地持久化存什么？

### 5.1 Git 本身是真相源

Worktree 的物理存在、分支绑定、HEAD 位置完全由 Git 管理。Giteam 不额外持久化这些状态。

### 5.2 Giteam 存什么？

- **仓库列表**：SQLite `repositories` 表，记录用户添加过的仓库路径；
- **分支父子关系**：`localStorage` 里的 `giteam.branch-parent-map.v1`，用于拓扑图展示；
- **worktree 父分支映射**：`localStorage` 里的 `giteam.worktree-parent-map.v1`，用于把 detached worktree 归类到某个基础分支下；
- **workspace-agent 绑定**：`localStorage` 里的 `giteam.workspace-agent-bindings.v1`，记录某个工作区对应的 AI session。

## 6. 遇到过什么难题？

### 6.1 难题一：GUI 应用 PATH 不完整

**现象**：Giteam 从桌面启动后，调用 `git` 命令报“command not found”。

**根因**：macOS 上双击启动的 GUI 应用继承的 PATH 和用户终端里的 PATH 不一样，可能找不到通过 Homebrew 安装的 Git。

**解决**：

- 后端执行 Git 命令时，主动增强 PATH，加入常见目录：
  - `/opt/homebrew/bin`
  - `/usr/local/bin`
  - `~/.cargo/bin`
  - `~/.nvm/versions/node/*/bin`
  - 等等
- 如果直接执行失败，再用 `/bin/zsh -ic` 回退，让 zsh 加载用户配置里的 PATH。

### 6.2 难题二：跨平台路径和解析差异

**现象**：Windows 和 Linux/macOS 上 `git worktree list --porcelain` 的路径格式不同，解析时容易出错。

**根因**：Windows 路径带盘符和反斜杠，而 macOS/Linux 是正斜杠；Git 输出里也可能有 symbolic link 和真实路径的差异。

**解决**：

- 所有路径进入后端前先规范化（`canonical_repo_path` / `normalize_repo_key`）；
- 比较路径时不直接字符串比较，而是比较规范化后的 key；
- 分支名里的非法字符（如 `/`）在生成目录名时替换为 `-`。

### 6.3 难题三：大仓库文件监听性能

**现象**：大仓库（比如带大量 node_modules）下，文件监听很卡，CPU 占用高。

**根因**：`notify` 默认递归监听整个目录，大目录下事件风暴。

**解决**：

- 监听时过滤掉 `node_modules`、`dist`、`target` 等构建产物目录；
- `.git` 目录下只监听关键文件；
- 文件变更事件不直接触发全量刷新，而是发给前端，由前端根据当前视图决定是否刷新。

### 6.4 难题四：两套 Rust 实现重复

**现象**：桌面端 Tauri command 和 `giteam-core/desktop_rpc.rs` 里有很多几乎一样的 Git 操作代码。

**根因**：历史演进导致。`giteam-core` 原本给 CLI/mobile 服务用，Tauri command 给桌面端用，两套代码各自生长。

**解决**：

- 目前保持两套并行，但都尽量复用 `command_runner`；
- 后续可以进一步把 Git 操作抽到 `giteam-core`，让 Tauri command 只做转发。

## 7. 数据流总结

```
用户点击创建 worktree
  ↓
前端调用 gitAdapter.createGitWorktree(branch, path?)
  ↓
Tauri command: run_git_create_worktree_from_branch
  ↓
command_runner 执行 git worktree add ...
  ↓
Git 在磁盘创建新目录
  ↓
notify 检测到文件系统变化
  ↓
后端 emit git-worktree-changed 事件
  ↓
前端刷新 worktree 列表
```

## 8. 面试可以怎么讲

> Giteam 的工作树功能没有自己实现一套虚拟文件系统，而是直接调用 Git 原生的 `git worktree` 命令。后端的职责是把前端操作翻译成 Git 命令、解析 Git 的输出、结构化后返回给前端，同时用文件监听保持 UI 同步。
>
> 比如列出工作树，我们执行 `git worktree list --porcelain` 解析每个 worktree 的路径、HEAD、分支；创建就是 `git worktree add`；删除是 `git worktree remove --force`。切换 worktree 时，Giteam 实际上是把当前选中的仓库路径改成目标 worktree 的目录，然后重新加载数据。
>
> 遇到的难题主要是 GUI 应用 PATH 不完整。macOS 上双击启动的应用继承不到终端的 PATH，经常找不到 Homebrew 装的 Git。我们做了 PATH 增强，还会用 `/bin/zsh -ic` 回退去拿用户的 PATH。另外大仓库的文件监听我们也做了过滤，避免 node_modules 这种目录引发事件风暴。

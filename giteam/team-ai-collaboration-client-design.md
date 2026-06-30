# 团队 AI 协作客户端架构整理（基于 `entire` + `git`，避免重复建设）

## 1. 目标

在不重写 `entire` 既有能力的前提下，构建一个桌面客户端（最终发布 `dmg` 和 `exe`），实现：

- 基于本地仓库的提交上下文可视化（commit/checkpoint/trail）
- 引入独立 Review Agent，对提交做自动或手动审查
- 团队可追溯「改了什么、为什么改、审查结论是什么」

---

## 2. 已确认的 `entire` CLI 能力边界

以下能力已在源码中存在，应直接复用而不是重做：

### 2.1 顶层命令（公开）

- `entire rewind`
- `entire resume`
- `entire clean`
- `entire reset`
- `entire configure`
- `entire enable`
- `entire disable`
- `entire status`
- `entire login`
- `entire explain`
- `entire doctor`
- `entire trace`
- `entire version`

### 2.2 内部/隐藏命令（仍可被客户端调用）

- `entire hooks`
- `entire trail`
- `entire __send_analytics`
- `entire curl-bash-post-install`

### 2.3 已有结构化输出（优先使用）

- `entire rewind --list`：JSON（可用于“检查点列表”面板）
- `entire trail list --json`：JSON（可用于“任务/分支语义”面板）
- `entire explain --commit/--checkpoint`：已有 commit/checkpoint 关联解释能力

### 2.4 Agent Hook 生态（已覆盖）

- `entire hooks <agent> <hook-verb>` 动态注册机制已存在
- 内置 agent：`claude-code`、`gemini`、`opencode`、`cursor`、`factoryai-droid`、`copilot-cli`
- 支持 external agent 发现与注册

---

## 3. 不重复建设清单（硬约束）

客户端不实现以下逻辑，全部委托给 `entire`：

- session 生命周期管理
- checkpoint 生成、凝结、恢复与回滚
- git hook 安装/卸载与 hook 事件分发
- commit trailer（`Entire-Checkpoint`）的注入和解析主链路
- `resume/reset/clean/doctor` 的修复与运维逻辑

客户端只做：编排、可视化、增量 review 能力。

---

## 4. 推荐总体架构（桌面应用）

```text
Desktop UI (React/TS)
  -> App Service (TS, workflow orchestration)
    -> Local Gateway (Tauri Rust commands)
      -> entire CLI + git CLI
    -> Review Agent Runtime (LLM provider adapters)
    -> Local Store (SQLite)
```

### 4.1 技术栈

- 桌面壳：`Tauri v2`
- 前端：`React + TypeScript + Vite`
- 状态与数据：`Zustand + TanStack Query`
- 本地执行层：`Rust (tokio + serde)`
- 本地存储：`SQLite`（`rusqlite` 或 `sqlx`）
- 审查模型：OpenAI/Anthropic/Ollama 可插拔
- 打包：Tauri 原生构建 `dmg`、`exe`/`msi`

### 4.2 模块职责

- `EntireAdapter`
  - 统一执行：`status`、`explain`、`rewind --list`、`trail list --json` 等
  - 屏蔽 stdout/stderr/错误码差异，输出统一 DTO
- `GitAdapter`
  - 提供 `diff`、`log`、`show`、`blame` 等 `entire` 之外能力
- `ReviewOrchestrator`
  - 拼装审查输入：`git diff + entire explain + 可选规则`
  - 调度 LLM 并标准化 findings
- `ReviewStore`
  - 存本地 review 记录和审查操作历史
- `TimelineAggregator`
  - 聚合 commit + checkpoint + trail + review，生成 UI 时间线

---

## 5. 关键工作流

### 5.1 自动审查（提交后）

1. 监听新提交（或用户手动触发）
2. `EntireAdapter` 获取 checkpoint/上下文（通过 trailer + `entire explain`）
3. `GitAdapter` 拉取 diff 和文件片段
4. `ReviewOrchestrator` 调 LLM 生成结构化结论
5. 写入 `ReviewStore`，UI 展示并支持人工处理

### 5.2 时间线与追溯

1. 扫描 `git log`
2. 对每个 commit 关联 checkpoint（`entire explain --commit`）
3. 补充 trail 信息（`entire trail list --json`）
4. 合并 review 结果，形成统一 timeline

---

## 6. 数据模型（客户端侧）

### 6.1 `review_records`

- `id`
- `repo_path`
- `commit_sha`
- `checkpoint_id`
- `agent_name`
- `model_name`
- `status`（`pass`/`warn`/`fail`/`error`）
- `summary`
- `findings_json`
- `created_at`

### 6.2 `review_actions`

- `id`
- `review_id`
- `finding_id`
- `action`（`accept`/`dismiss`/`todo`）
- `note`
- `created_at`

---

## 7. 客户端与 `entire` 的接口约定（第一版）

- `entire status --detailed`
- `entire explain --commit <sha> --no-pager`
- `entire explain --checkpoint <id> --no-pager --short`
- `entire rewind --list`
- `entire trail list --json --all`

说明：
- 优先消费 JSON 输出（目前 `rewind`/`trail` 已满足）
- 对文本输出命令（如 `explain`）在 `EntireAdapter` 做稳定解析层，避免 UI 直接依赖原始文本

---

## 8. 打包与发布（`dmg` / `exe`）

### 8.1 构建产物

- macOS：`dmg`
- Windows：`exe` 或 `msi`

### 8.2 工程要求

- 配置签名（macOS Developer ID / Windows Code Signing）
- macOS 公证（Notarization）
- 自动更新（Tauri updater，可后续启用）
- CI 多平台构建（GitHub Actions）

---

## 9. 分阶段实施计划

### Phase 1（MVP）

- 完成 `EntireAdapter` + `GitAdapter`
- 落地基础时间线（commit + explain）
- 接入手动触发 review

### Phase 2（可协作）

- 自动审查任务队列
- findings 交互（采纳/忽略/备注）
- trail 视图整合

### Phase 3（发布）

- 完成签名、公证、安装包发布
- 稳定性与性能优化（缓存、并发与重试）

---

## 10. 验收标准

- 不重写 `entire` 已有会话/检查点能力
- 任意带 trailer 的 commit，均可在客户端看到：
  - commit 信息
  - 对应 checkpoint/explain
  - 对应 review 结果
- 可生成并安装 `dmg` 与 `exe`

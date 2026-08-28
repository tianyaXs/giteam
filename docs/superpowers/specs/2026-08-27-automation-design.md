# 自动化（Automation）设计

> 日期：2026-08-27  
> 状态：MVP 实施中  
> 关联：Desktop 本地调度；不依赖 Cloud Gateway 执行 Agent

## 1. 目标与场景

在 Desktop 新增 Codex 风格「自动化」模块：用户为**已导入项目**配置定时任务，到点后由本机 Agent 在**新会话**或**已有会话**中执行目标 prompt，并写入运行历史、可选桌面通知。

## 2. 已锁定决策

| 决策 | 结论 |
|------|------|
| 无工作空间 | **不支持**。`repoPath` 端到端必填；不做全局会话区、不做隐式默认 cwd |
| 宿主 | 仅 Desktop；进程运行时调度（可最小化到托盘） |
| 执行感知 | 静默执行；通知 + 运行历史；不自动抢焦点 |
| 触发（MVP） | 时间表 + 手动立即运行；事件 UI 占位 |
| 存储 | `~/.giteam/automation.db`（或 `$GITEAM_HOME/automation.db`） |
| 记忆 / Prompt | **不改**装配链；与手动会话同等注入与 extraction |
| 通知 | `send_desktop_notification` × 任务级开关 × `notificationsAgent` |

## 3. 产品形态

- 左栏「自动化」入口 → 主内容 `mainMode: agent | automation`
- 中栏：All / Enabled / Paused、搜索、Create、Suggestions、任务列表
- 右栏：标题、目标、运行于（新/已有会话）、**项目必选**、频率、通知、运行历史
- 文案：标明「需保持 Giteam 运行才会按时触发」

### 运行于

| 模式 | 行为 |
|------|------|
| 新会话 | `create_session(repoPath)` → `prompt(goal)` |
| 已有会话 | 校验 session 属该 repo 且非 busy → `prompt`；busy → `skipped` |

## 4. 数据模型

```text
automation_tasks
  id, title, goal_prompt, repo_path
  session_mode ('new'|'existing'), session_id
  schedule_kind ('cron'|'interval'|'once_at'), schedule_expr, timezone
  notify_on_success, notify_on_failure, enabled
  next_run_at_ms, last_run_at_ms, last_status
  created_at_ms, updated_at_ms

automation_runs
  id, task_id, status, trigger, session_id, repo_path
  started_at_ms, finished_at_ms, error_message, summary
```

## 5. 模块落点

| 层 | 路径 |
|----|------|
| Core | `crates/giteam-core/src/automation/` |
| Tauri | `apps/desktop/src-tauri/src/commands/automation.rs` |
| UI | `apps/desktop/src/components/automation/`、`lib/automation.ts` |

Commands：`automation_list_tasks` / `get` / `create` / `update` / `set_enabled` / `delete` / `list_runs` / `run_now`。

执行链：`tick → claim due → insert run(running) → create_session|prompt → update run/task → notify`。

## 6. 分期

1. **MVP**：CRUD、进程内调度、新/已有会话执行、三栏 UI、通知  
2. **增强**：启动补跑、并发队列、git 事件、深链打开会话、删项目级联  
3. **可靠性**：OS 唤醒、CLI、云同步定义、移动只读

## 7. MVP 验收

1. 左栏可进自动化；中栏列表 + 右栏表单可用  
2. 不选项目无法保存任务  
3. Desktop 运行中 Enabled 任务按时执行  
4. 成功/失败进历史，并按开关通知  
5. Paused 不触发；过滤正确  
6. 同项目下记忆/extraction 与手动会话一致  
7. 不存在无 `repoPath` 的 session 创建路径  

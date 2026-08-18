# 未提交 Agent 改动 — 验证 Case

范围：steer fetcher、quota 不重试、bash 只读白名单、prompt/环境/记忆、列表不阻塞、手机 steer/load-more。

## A. 自动（本机 `cargo test`）— 2026-08-17 本地已跑

| ID | Case | 对应测试 | 结果 |
|----|------|----------|------|
| A1 | steer 队列 FIFO + cap 淘汰最旧 | `steer_queue_is_fifo_with_cap_dropping_oldest` | PASS |
| A2 | 无活跃 run → Idle；空消息/未知会话失败 | `steer_idle_when_session_exists_but_no_active_run` | PASS |
| A3 | 限额文案识别 | `quota_errors_are_recognized_across_providers` | PASS |
| A4 | bash 只读白名单 | `command_safety::tests::*` (3) | PASS |
| A5 | 审批层接线只读 bash | `approval::tests::readonly_bash_input_*` (2) | PASS |
| A6 | 工作区上下文 / Pre-approved | `environment::tests::*` (9) | PASS |
| A7 | 仅读 GITEAM.md | `project_memory::tests::*` (6) | PASS |
| A8 | 品牌 prompt / 纪律门控 / 工具描述 | `prompt::tests::*` (12) | PASS |
| A9 | Plan 子代理工具白名单 | `subagents::tests::*` (3) | PASS |
| A0 | 全量 lib 回归 | `cargo test --lib` | **136 passed** |

```bash
cargo test --manifest-path crates/giteam-core/Cargo.toml --lib
```

## B. 桌面真机（自动测覆盖不到）

| ID | Case | 步骤 | 期望 | 结果 |
|----|------|------|------|------|
| B1 | 多工具中轮插话 | run 中连续工具时发送补充 | 同 run 注入；后续工具批可被 skip | ☐ |
| B2 | 流式无工具时插话 | 纯流式中途发送 | assistant 段落后注入并续答 | ☐ |
| B3 | steer 后立刻停止 | 排队后马上 Abort | 不丢语义：能再答或需明确重发（盯回归） | ☐ |
| B4 | 限额不重试 | 触发余额不足类错误 | 无多次 AutoRetry；文案透出 | ☐ |
| B5 | 审批：只读免批 | Plan/需批模式下 `git status` | 自动放行 | ☐ |
| B6 | 审批：写操作仍批 | 同模式 `rm` / 写文件 | 仍弹审批 | ☐ |
| B7 | 列表不阻塞 | A 长跑时侧栏加载更多 / 开 B | 不卡死；B 可跑 | ☐ |
| B8 | 项目记忆 | 有 GITEAM.md 新会话提问 | 能引用记忆 | ☐ |

## C. 手机 / Control

| ID | Case | 步骤 | 期望 | 结果 |
|----|------|------|------|------|
| C1 | 手机 steer | 桌面 run 中手机排队发送 | `POST /api/v1/agent/steer` queued；桌面同会话注入 | ☐ |
| C2 | 空闲发消息 | 无 run 时手机发送 | idle → 普通 prompt | ☐ |
| C3 | 加载更早消息 | 长会话上滑 | 不卡住；不打乱在飞流 | ☐ |

## 缺口说明

- **无** mock provider 的「fetcher 真注入工具批间隙」集成测 → B1/B2/B3 必须真机。
- 前端注释仍可能写「turn 结束后续跑」→ 以真机行为为准。

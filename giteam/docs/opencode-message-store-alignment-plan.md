# OpenCode 消息流渲染对齐重构计划

## 背景

当前移动端在消费 OpenCode 流式事件时，会把实时 `message` 和 `part` 事件压平成本地 chat message。事件乱序时，`message.part.updated` / `message.part.delta` 可能早于对应的 `message.updated` 到达，导致前端在尚未确认 role 的情况下创建 assistant 消息，或在流式过程中被半成品快照降级，从而出现 Markdown 和三点加载状态来回闪动。

OpenCode Web 端的模型更稳定：`message` 和 `part` 分开存储，`message.updated` 负责确认消息身份，`part` 只按 `messageID` 归档，渲染时再组合。

## 目标

- 避免未知 role 的 part 事件创建 assistant UI。
- 保证 streaming 期间内容单调增长，不被空状态降级为三点加载。
- 尽量对齐 OpenCode Web 的 message/part store 模型。
- 保持现有移动端 UI、工具渲染、thinking 展示和 final hydrate 行为稳定。

## 非目标

- 不在第一阶段完全重写聊天 UI。
- 不直接移植 OpenCode Web 的 Solid store 和组件。
- 不改变 OpenCode server API 或事件协议。

## 阶段一：兼容式修复

1. 增加 `messageID -> role` 的权威映射，只由 `message.updated` 写入。
2. `message.part.updated` 和 `message.part.delta` 在 role 未知时不创建 assistant，只进入 pending 缓存。
3. `message.updated role=assistant` 到达后，创建或绑定本地 assistant，并 flush pending parts/deltas。
4. `message.updated role=user` 到达后，丢弃该 `messageID` 下的 pending parts/deltas。
5. `message.part.delta` 如果对应 part 尚不存在，不凭空创建 assistant，先缓存或跳过。
6. streaming 结束后继续使用现有 final message hydrate 收敛。

验收标准：用 curl 新建会话并监听 `/global/event`，user `part.updated` 先到时，不产生 assistant Markdown；真正 assistant 到达前只显示合理 working 状态。

## 阶段二：渲染层防降级

1. 为正在 streaming 的 assistant 缓存 last non-empty render。
2. server 快照或 detail parts 暂时为空时，不覆盖已有非空内容。
3. 三点加载只在确实没有任何 assistant 内容且 session 仍 busy 时显示。

验收标准：长回复、reasoning、tool 调用中不会从已有 Markdown 回退到空三点。

## 阶段三：Store 模型对齐

1. 引入接近 OpenCode Web 的 store：`messagesBySession`、`partsByMessageId`、`sessionStatusById`。
2. 消息列表以 `message.role` 和真实 server `messageID` 为主，不再依赖多套 local/server id 映射。
3. 渲染层按 `message + parts` 组合出 text、reasoning、tool、permission、question。
4. 保留 optimistic user message，但 assistant 由 server `message.updated` 驱动创建。

验收标准：同一会话刷新、切换、流式输出、工具调用和历史加载都以同一套 store 为准。

## 阶段四：清理旧路径

1. 移除重复的 `content` fallback、`detailParts`、`liveParts` 之间的覆盖逻辑。
2. 将 final hydrate 改为对 `message/part` store 的 reconcile，而不是整段替换 UI messages。
3. 补充事件乱序、delta 早到、part 早到、tool 调用、reasoning-only 的测试用例。

## 风险与回滚

- 阶段一风险最低，改动集中在 SSE 消费层，可单独回滚。
- 阶段二可能影响 loading 视觉，需要验证空回复和错误回复。
- 阶段三影响面较大，应独立分支完成，并保留阶段一修复作为基线。
- 若出现工具/permission 展示延迟，优先检查 pending flush 是否覆盖所有 assistant part 类型。

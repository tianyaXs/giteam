# Mobile 端聊天链路梳理

本文聚焦 `apps/mobile` 里和聊天直接相关的 3 条主链路：

- 消息内容渲染
- 会话切换
- 发送消息

结论先说：

- 移动端聊天的真正数据源不是 UI 组件，而是 `sessionRawMapRef` 里的服务端原始 message rows。
- UI 展示分 3 层衍生：`raw rows -> timeline/renderedTurns -> displayedTurnCells -> FlashList`。
- 发消息和切会话都做了“先本地可见，再网络补齐”的优化，重点是 optimistic message、snapshot restore、memory cache、tail sync。

## 1. 入口和总装配

主装配在 [apps/mobile/App.tsx](../apps/mobile/App.tsx)。

这一层负责把几个核心能力串起来：

- `useSessionSwitchController`：切会话时清 UI、切 sessionId、尝试直接用缓存恢复
- `useSessionMessageSync`：从服务端同步消息、补历史、加载更多、tail refresh
- `usePromptActions`：发送消息、建会话、中断会话
- `useTurnCellRenderer`：把 cell 渲染成 `MobileTurnCell`
- `useChatUiActions`：把 UI 操作绑定到上面的业务动作
- `ChatWorkspaceScreen`：最终聊天页容器

相关文件：

- [apps/mobile/App.tsx](../apps/mobile/App.tsx)
- [apps/mobile/src/features/chat/useMobileAppState.ts](../apps/mobile/src/features/chat/useMobileAppState.ts)
- [apps/mobile/src/components/chat/ChatWorkspaceScreen.tsx](../apps/mobile/src/components/chat/ChatWorkspaceScreen.tsx)

## 2. 数据分层

### 2.1 原始层

服务端消息先进入 `sessionRawMapRef[sessionId]`，元素是 raw message row。

关键逻辑在：

- [apps/mobile/src/features/messages/useSessionMessageSync.ts](../apps/mobile/src/features/messages/useSessionMessageSync.ts)
- [apps/mobile/src/features/messages/turns.ts](../apps/mobile/src/features/messages/turns.ts)

这里会做：

- `mergeMessageRows()`：按 message id 合并，兼容流式 part 增量更新
- `replaceStreamRows()` / `ingestStreamRows()`：和流式 store 对齐
- `recordStreamMessageRoles()`：记录角色信息

### 2.2 解析层

`parseConversation()` 把 raw rows 解析成可展示的 timeline item。

文件：

- [apps/mobile/src/messageParser.ts](../apps/mobile/src/messageParser.ts)

会被解析成这些 UI 语义对象：

- `chat`：用户/助手正文
- `think`：思考过程卡片
- `context`：上下文探索过程
- `event`：工具执行事件
- `todo`：`todowrite` 任务卡
- `question`：问题卡
- `divider`：如 compaction 分隔
- `error`：助手执行错误

几个关键点：

- user message 会从 `text` + `file` part 里提取文字和图片附件
- assistant message 会按 opencode part 分组，区分 reasoning/context/tool/text
- `question`、`todo`、`apply_patch/edit/write/bash` 都会变成结构化卡片，而不是只显示纯文本
- 解析层有去重、context 合并、fallback 兜底逻辑

### 2.3 turn 层

`buildRenderedTurns()` 会把 timeline 聚合成“以 user turn 为中心”的 `renderedTurns`。

文件：

- [apps/mobile/src/features/messages/turns.ts](../apps/mobile/src/features/messages/turns.ts)

规则大致是：

- 一个 user chat 开一个 turn
- 后续 assistant/chat/context/event/think/todo/question 挂到这个 turn 下
- 如果 assistant 项先到、user turn 还没补齐，会先挂到 `pendingAssistant`，后面再并回去

### 2.4 cell 层

列表展示不是直接按 turn，而是先 `flattenTurnsForList()`。

文件：

- [apps/mobile/src/features/chat/displayedCells.ts](../apps/mobile/src/features/chat/displayedCells.ts)

它会把一个 turn 拆成多个 cell：

- 1 个用户气泡 cell
- 多个 assistant/context/event/todo/question/think cell

这样做的目的：

- `FlashList` 更容易增量刷新
- 每种 item 有独立高度和交互状态
- 最后一个可见 cell 的“流式中”状态更准确

## 3. 消息内容渲染链路

### 3.1 列表容器

`ChatConversationStage` 是消息列表舞台层。

文件：

- [apps/mobile/src/components/chat/ChatConversationStage.tsx](../apps/mobile/src/components/chat/ChatConversationStage.tsx)

职责：

- 用 `FlashList` 渲染 `displayedTurnCells`
- 空草稿态展示欢迎文案
- 顶部历史加载进度条
- “跳到最新”按钮
- 到列表顶部时触发 `onLoadOlderMessages`

### 3.2 cell 渲染入口

`useTurnCellRenderer()` 返回 `renderTurnCell()`，内部统一交给 `MobileTurnCell`。

文件：

- [apps/mobile/src/features/chat/useTurnCellRenderer.tsx](../apps/mobile/src/features/chat/useTurnCellRenderer.tsx)
- [apps/mobile/src/components/chat/MobileTurnCell.tsx](../apps/mobile/src/components/chat/MobileTurnCell.tsx)

它还会给每个 cell 注入：

- `interaction`：当前 cell 是否最后一个、哪些 think/question 展开
- `streaming`：是否应以流式态渲染
- `exploringStatus` / `exploringActions`：底部“探索中/已探索”状态

### 3.3 真正的消息 UI

`MobileTurnCell` 是消息展示核心。

它支持的内容类型：

- 用户消息：文本 + 图片附件条
- 助手消息：Markdown 气泡
- context：可展开的上下文工具列表
- event：工具事件卡，`bash` / `write` / `edit` / `apply_patch` 都有专门样式
- think：折叠预览 / 展开全文
- todo：任务进度卡
- question：历史问题卡
- divider：会话压缩提示
- error：错误卡

### 3.4 Markdown 渲染

助手正文和错误正文最终走 `MobileMarkedMarkdown`。

文件：

- [apps/mobile/src/components/chat/MobileTurnCell.tsx](../apps/mobile/src/components/chat/MobileTurnCell.tsx)
- [apps/mobile/src/components/chat/MobileMarkedMarkdown.tsx](../apps/mobile/src/components/chat/MobileMarkedMarkdown.tsx)

处理细节：

- `normalizeMarkdownForMobile()` 会先清理缩进并转义路径里的下划线，避免 markdown 误判
- 流式输出时只做一次轻量淡入，不会每次文本增量都重新动画
- user bubble 不走 markdown，assistant/think/error 才走 markdown

### 3.5 交互状态

cell 的展开收起状态不是存在 cell 组件本地，而是由 `useInteractiveTurnCells()` 统一生成。

文件：

- [apps/mobile/src/features/chat/useInteractiveTurnCells.ts](../apps/mobile/src/features/chat/useInteractiveTurnCells.ts)

它把这些状态签名化：

- `expandedThinkCards`
- `expandedTimelineQuestions`
- `timelineQuestionTabs`
- `isLastVisible`

配合 `React.memo`，让 `MobileTurnCell` 只在必要时重渲染。

## 4. 会话切换链路

### 4.1 触发点

左侧抽屉点 session 时，从 `handleDrawerSessionSelect()` 开始。

文件：

- [apps/mobile/src/features/chat/useLeftDrawerController.ts](../apps/mobile/src/features/chat/useLeftDrawerController.ts)

切换顺序很关键：

1. 记录 session switch perf
2. `stopStream()`
3. 先看内存缓存 `sessionRawMapRef[targetSid]`
4. 如果内存没命中，再尝试磁盘 snapshot `loadChatSnapshot()`
5. 必要时提前启动 `syncSessionMessages()` 预取
6. 调 `setActiveSession(targetSid)`
7. 如果 snapshot 足够完整，直接用 snapshot 的 `messages/renderedTurns` 抢先上屏
8. 否则等待网络同步
9. 最后 `reconnectRunningSession()`

### 4.2 setActiveSession 做什么

`setActiveSession()` 在 `useSessionSwitchController()` 里。

文件：

- [apps/mobile/src/features/chat/useSessionSwitchController.ts](../apps/mobile/src/features/chat/useSessionSwitchController.ts)

它本身不拉网络，主要做本地状态切换：

- 记录旧会话 viewport
- 重置列表交互态
- 清空 `messages/renderedTurns/question state`
- 写入新的 `sessionId`
- 如果新会话已有缓存 raw rows，立即 `applyTurnWindow()` 恢复可见内容

也就是说：

- `useLeftDrawerController` 负责“切换策略”
- `useSessionSwitchController` 负责“切换落地”

### 4.3 同步消息

真正把新会话消息拉齐的是 `useSessionMessageSync()`。

文件：

- [apps/mobile/src/features/messages/useSessionMessageSync.ts](../apps/mobile/src/features/messages/useSessionMessageSync.ts)

它负责：

- `refreshMessages()`：拉一页消息并合并 raw rows
- `syncSessionMessages()`：完整同步入口
- `onLoadOlderMessages()`：上滑加载历史
- `restoreLocalSnapshot()`：本地快照恢复
- `paginateHistoryBackfill()`：连续翻页回填历史

这层有几个重要策略：

- `tailOnly`：只拉最新消息尾部，不做整会话 hydrate
- `local snapshot restore`：先把本地恢复上屏，再后台 refresh
- `hydrate/backfill`：如果还有 `nextCursor`，持续向前翻，补齐更早历史
- `preserveViewport`：非首次切换时尽量保住用户阅读位置
- `history backoff`：历史页失败后对 cursor 做退避，避免连点把接口打爆

### 4.4 会话切换相关状态

关键 ref/state：

- `sessionIdRef`：当前会话 id
- `sessionRawMapRef`：每个会话的原始消息缓存
- `sessionVisibleTurnCountRef`：当前展示多少 turn
- `sessionTotalTurnCountRef`：该会话一共多少 turn
- `sessionNextCursor`：继续向前翻历史的 cursor
- `sessionHistoryRetryHint`：历史加载失败提示

## 5. 发送消息链路

### 5.1 UI 按钮到业务动作

发送按钮在 `ChatComposer`，但它只负责 UI。

文件：

- [apps/mobile/src/components/chat/ChatComposer.tsx](../apps/mobile/src/components/chat/ChatComposer.tsx)
- [apps/mobile/src/features/chat/useChatUiActions.ts](../apps/mobile/src/features/chat/useChatUiActions.ts)

链路是：

- `ChatComposer.onSend`
- `handleSendPrompt`
- `onSendPrompt`

### 5.2 onSendPrompt 主流程

核心逻辑在 `usePromptActions()`。

文件：

- [apps/mobile/src/features/messages/usePromptActions.ts](../apps/mobile/src/features/messages/usePromptActions.ts)

发送顺序：

1. 校验授权、repo、prompt、图片状态
2. 构造 `optimisticMessage`
3. 如果当前没有会话，先 `createSession()`
4. 把 optimistic user message 写入本地缓存和列表
5. 清空输入框、关闭 slash、清空附件
6. `startStream(targetSessionId)`
7. 调 `sendPrompt()`
8. 成功后触发 `syncSessionMessages(sessionId, { tailOnly: true })`
9. 刷新 session 列表

这里的设计点：

- 图片会先转成 `parts`，跟文本一起发
- optimistic message 先插本地，用户能立刻看到自己发出的消息
- 请求成功后不会因为服务端新建 task session 而强制跳页面
- 失败时会回滚 optimistic message，并尽量恢复输入框和附件

### 5.3 中断消息

同一个 hook 里还有 `onAbort()`：

- `stopStream()`
- 调 `abortSession()`
- 再做一次 `syncSessionMessages(tailOnly)`
- 清掉当前会话的 optimistic message

### 5.4 发送后的渲染如何收口

发送之后，最终仍然要回到同步层：

- 流式过程中：stream store 持续更新
- 请求完成后：`tailOnly` 同步最新 authoritative rows
- 再经 `parseConversation -> buildRenderedTurns -> flattenTurnsForList`
- 最终刷到 `FlashList`

所以发送链路并没有绕开渲染体系，只是提前插入了一层 optimistic UI。

## 6. 发送/切换共用的性能与缓存思路

代码里能明显看到移动端在压“首屏可见时间”：

- session 切换先命中内存，再命中 snapshot，再走网络
- 发消息先 optimistic append，再等服务端回包
- `tailOnly` 避免每次发送后都全量 hydrate
- raw row 合并采用 message id + part id 粒度，兼容流式增量
- `MobileTurnCell` 做了 `React.memo`
- cell 级交互状态签名化，减少无关重渲

## 7. 当前代码里的几个要点

- `useSessionMessageSync` 是移动端聊天最核心、也最复杂的状态机。
- `messageParser.ts` 决定“服务端返回的 opencode parts 在手机上长什么样”。
- `useSessionSwitchController` 只处理切换本地落地，不直接发网络请求。
- `useChatCellWindow` 目前基本是“全量 cell 直出”，没有再做二次裁剪窗口。
- `ChatWorkspaceScreen` / `ChatConversationStage` 更偏容器和列表舞台，不是业务源头。

## 8. 建议阅读顺序

如果后面要继续改这块，建议按这个顺序读：

1. [apps/mobile/src/features/messages/usePromptActions.ts](../apps/mobile/src/features/messages/usePromptActions.ts)
2. [apps/mobile/src/features/messages/useSessionMessageSync.ts](../apps/mobile/src/features/messages/useSessionMessageSync.ts)
3. [apps/mobile/src/messageParser.ts](../apps/mobile/src/messageParser.ts)
4. [apps/mobile/src/features/messages/turns.ts](../apps/mobile/src/features/messages/turns.ts)
5. [apps/mobile/src/components/chat/MobileTurnCell.tsx](../apps/mobile/src/components/chat/MobileTurnCell.tsx)
6. [apps/mobile/src/features/chat/useLeftDrawerController.ts](../apps/mobile/src/features/chat/useLeftDrawerController.ts)
7. [apps/mobile/src/features/chat/useSessionSwitchController.ts](../apps/mobile/src/features/chat/useSessionSwitchController.ts)

## 9. 一张简化链路图

```text
发送消息
ChatComposer
  -> useChatUiActions.handleSendPrompt
  -> usePromptActions.onSendPrompt
  -> optimistic message 写本地
  -> startStream
  -> controlApi.sendPrompt
  -> useSessionMessageSync.syncSessionMessages(tailOnly)
  -> parseConversation
  -> buildRenderedTurns
  -> flattenTurnsForList
  -> ChatConversationStage / FlashList

切换会话
LeftDrawer session click
  -> useLeftDrawerController.handleDrawerSessionSelect
  -> memory cache / snapshot / prefetch
  -> useSessionSwitchController.setActiveSession
  -> useSessionMessageSync.syncSessionMessages
  -> parseConversation
  -> buildRenderedTurns
  -> flattenTurnsForList
  -> ChatConversationStage / FlashList
```

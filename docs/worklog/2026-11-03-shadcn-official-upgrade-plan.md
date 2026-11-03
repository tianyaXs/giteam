# shadcn 官方组件升级计划

**日期：** 2026-11-03
**分支：** `feature/desktop-ai-ui-upgrade`
**原则：** 一切以官方组件为基线；仅保留窗口级（Tauri 拖拽区）与远程数据路径的自定义；不新增自定义 CSS 干扰官方默认效果。

## 背景

AI 会话流已对齐官方 ai-elements（Task/Trace/活动段时序、MessageScroller、PromptInput、Lenis 滚动），
提交 `ab4134d`。本轮把剩余的自造控件换成官方 shadcn 组件，范围：agent 会话流补强 + 设置页。

## A. Agent 会话流（对照 https://ui.shadcn.com/docs/ai-elements）

| # | 项目 | 现状 | 目标 | 状态 |
|---|------|------|------|------|
| A1 | Chain of Thought 摘要条 | 活动段卡片各自独立折叠 | 回合级官方 Trace 摘要行（执行中 / 已执行 N 步），展开区内按正文时序铺开段卡；段卡流式落位不变 | ✅ 完成 |
| A2 | Test Results 卡片 | bash 测试输出渲染为普通文本 | bash 测试命令（npm/pnpm/yarn/vitest/jest/cargo/pytest/go/node test）输出解析为官方 Trace 套件/用例卡，失败默认展开并内嵌官方 CodeBlock；不可解析仍走终端块 | ✅ 完成 |
| A3 | Context 用量条 | `ai-elements/context.tsx` 已 vendored 但会话视图未接 | pi SDK 暴露 token 用量时挂到 composer 工具条 | 待办（依赖能力侧） |
| A4 | Checkpoint 回合还原点 | Entire/Git 已有 checkpointId，会话内无 UI 入口 | 会话行级 checkpoint 标记 + 回滚入口；需先定 Rust 回滚语义 | 待办（依赖服务端语义） |

不引入：web-preview / actions / artifact（radix-rhea registry 无此条目）；inline-citation / sources 已 vendored，
等模型侧引用元数据接入。

## B. 设置页（对照 https://ui.shadcn.com/docs）

| # | 项目 | 现状（SettingsDialog.tsx） | 目标 | 状态 |
|---|------|------|------|------|
| B1 | 字号滑块 | `<input type=range>` + 自定义 `.gt-range` CSS | 官方 `slider` 组件；`.gt-range` 全局 CSS 已删除；预设按钮并入 `ButtonGroup` | ✅ 完成 |
| B2 | 设置行卡片 | 手写 `<article>` grid + border-b（`SettingsRows`） | 官方 `Item`/`ItemContent`/`ItemActions`；`SettingsGroup` 换 `ItemGroup` | ✅ 完成 |
| B3 | 主题选择器 | 手写网格 + 手写绝对定位 check 角标（`ThemePicker`） | 官方 `ToggleGroup`（variant="outline"），选中态由组件接管 | ✅ 完成 |
| B4 | 右侧导航列表 | 手写 ghost Button 列 | 官方 `SidebarMenuButton`（isActive）；`useSidebar` 增加无 Provider 安全回退；窗口级 portal 布局与拖拽区未动 | ✅ 完成 |

不换：整体 Dialog 骨架（Tauri 拖拽区需求）；Select 行（已是官方）；Card 包裹（官方设置示例同构）。

## 执行顺序

1. B1 → B2 → B3 → B4（设置页，1-2 为主要收益：删全局 CSS + 白拿官方状态机）
2. A1 → A2（会话流补强）
3. A3 / A4 在能力侧就绪后单独排期

每项完成后跑 `npm run build` + 相关 vitest/node 测试，全部完成后统一提交。

## 进度记录（2026-11-03）

- B1-B4 全部完成，`npm run build` ✅、desktop node tests 39/39 ✅。
- 新增依赖：`@radix-ui/react-slider@^1.3.0`；新增 `src/components/ui/slider.tsx`（radix-rhea vendor，import 路径适配）。
- 移除 `src/styles/base.css` 中 `.gt-range` 全局滑块样式。
- 待办：A1（Chain of Thought 摘要条）、A2（Test Results 卡片）为下一步。
- A1 完成：`AssistantTimeline` 在回合含活动段时改渲染一条官方 Trace 摘要行（TraceCollapsible），展开区按正文时序铺开既有段卡；段卡仅在回合折叠态下默认展开（`collapsedWhenIdle`），用户点过的段卡/回合状态优先，流式段落仍为末行 running、不重排。
- A2 完成：`ActivitySegment` 内识别单条 bash 测试命令（命令正则 + 输出 JSONL/✓✗ 文本解析），命中后渲染官方 TestResultsRow（Trace 套件 → 用例行，失败默认展开并内嵌官方 CodeBlock）；解析失败或非测试命令继续原终端块。
- 验证：`npx tsc --noEmit` ✅、`npm run build` ✅、agentParts vitest 10/10 ✅、desktop node tests 全绿 ✅。
- 待办：A3（Context 用量条）、A4（Checkpoint 回合还原点）仍依赖 pi SDK / Rust 服务端能力侧就绪。

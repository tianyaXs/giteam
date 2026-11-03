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
| A1 | Chain of Thought 摘要条 | 活动段卡片各自独立折叠 | 尝试回合级摘要行后回退：官方 CoT 的"一行摘要"语义与本项目「段卡=摘要行」结构重复（首行会把正文也收进折叠区，且与段头形成双折叠嵌套）；现行段卡本身就是官方 Trace 摘要行 | ↩️ 已回退（首行收拢正文 + 双层折叠，见 2026-11-03 截图反馈） |
| A2 | Test Results 卡片 | bash 测试输出渲染为普通文本 | bash 测试命令（npm/pnpm/yarn/vitest/jest/cargo/pytest/go/node test）输出解析为官方 Trace 套件/用例卡，失败默认展开并内嵌官方 CodeBlock；不可解析仍走终端块 | ✅ 完成 |
| A3 | Context 用量条 | `ai-elements/context.tsx` 已 vendored 但会话视图未接 | pi SDK 暴露 token 用量时挂到 composer 工具条 | 🚧 阻塞（2026-11-03 复核：desktop `agentSessions`/`types` 与 Rust core 均无 token/usage 数据源，需先做能力侧） |
| A4 | Checkpoint 回合还原点 | Entire/Git 已有 checkpointId，会话内无 UI 入口 | 会话行级 checkpoint 标记 + 回滚入口；需先定 Rust 回滚语义 | 🚧 阻塞（2026-11-03 复核：`src-tauri/src/commands/entire.rs` 仅 `explain`，无 restore/rollback 命令，需服务端先定语义） |

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
- A1 回退：回合级 TraceCollapsible 摘要行在真机上把整个回合（含正文）收进首行折叠区，且与段卡头形成「已执行 N 步 → 已运行 N 步」双折叠嵌套。官方 Chain-of-Thought 的「一行摘要」在本项目里已由段卡头承担（段卡=Trace 摘要行，展开即平铺步骤），再包一层属重复抽象。已还原为段卡平铺 + 正文穿插的原结构，A2 测试卡保留。
- A2 完成：`ActivitySegment` 内识别单条 bash 测试命令（命令正则 + 输出 JSONL/✓✗ 文本解析），命中后渲染官方 TestResultsRow（Trace 套件 → 用例行，失败默认展开并内嵌官方 CodeBlock）；解析失败或非测试命令继续原终端块。
- 验证：`npx tsc --noEmit` ✅、`npm run build` ✅、agentParts vitest 10/10 ✅、desktop node tests 全绿 ✅。
- 待办：A3（Context 用量条）、A4（Checkpoint 回合还原点）仍依赖 pi SDK / Rust 服务端能力侧就绪。
- B3/B4 回归修复：上一轮 ToggleGroup 接入后主题选中态变丑，根因是 vendored `toggle.tsx` 为旧版官方 API（选中态 `data-[state=on]:bg-accent` 蓝底），与 radix-rhea 新版组件不匹配，叠加手写 `border-foreground/40`/`font-semibold`/CheckIcon 角标后视觉更差。已将 `toggle.tsx` 重新 vendor 为 radix-rhea 官方版（选中态 `aria-pressed:bg-muted`），`ThemePicker` 删除全部手写选中态，只保留布局类（`h-auto w-[88px] flex-col gap-1 p-1`），选中态完全交由组件。
- 设置页滚动条修复：Radix `ScrollArea` 在设置 portal 容器里只渲染 thumb 不渲染轨道，两处（侧边导航 + 主内容）改为原生 `overflow-y-auto` + 会话流已在用的 `gt-subtle-scrollbar` 类；`scroll-area.tsx` 本身不动（其 viewport 扩展 props 在 AgentMessageStream 等处仍被使用）。
- 验证：`npx tsc --noEmit` ✅、`npm run build` ✅、desktop node tests ✅。

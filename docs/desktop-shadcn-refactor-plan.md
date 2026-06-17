# 桌面端 shadcn 组件化重构计划

## 背景

桌面端已经引入 `apps/desktop/components.json`，并在 `apps/desktop/src/components/ui` 下维护了一批 shadcn 风格组件，包括 `Button`、`Dialog`、`Input`、`Textarea`、`Select`、`Switch`、`Badge`、`Empty`、`Skeleton`、`Sidebar`、`DropdownMenu`、`ToggleGroup` 等。

当前问题不是完全没有使用 shadcn，而是业务界面处于半迁移状态：部分模块已经引入 shadcn 组件，但仍保留大量 `gt-*`、`opencode-*`、`settings-*`、`modal-*`、`path-input` 等自定义 CSS 类，用来模拟按钮、输入框、卡片、弹窗、徽章、空状态、骨架屏和开关。

本计划的目标是降低桌面端 UI 的重复样式维护成本，让交互控件优先由 shadcn 组件承载，同时保留必要的产品布局和领域样式。

## 当前盘点

扫描范围：`apps/desktop/src`，排除 `apps/desktop/src/components/ui` 自身。

结果：

- 业务 TSX 文件总数：34 个
- 已引入 shadcn/ui 的业务文件：24 个
- 存在原生控件或组件级 CSS 补丁的文件：26 个
- 完全未引入 shadcn/ui、但仍使用原生控件或组件级 CSS 的文件：5 个
- 原生 `button/input/select/textarea/dialog` 命中：15 处
- 疑似组件级 CSS 类使用点：约 255 处
- 疑似组件级 CSS 选择器：约 749 个，分布在 11 个 CSS 文件

高频 CSS 文件：

- `apps/desktop/src/styles/marketplace.css`：Skills 市场、worktree 拓扑、provider picker、移动端卡片等，组件级选择器约 244 个。
- `apps/desktop/src/styles/chat.css`：问题面板、composer、权限卡、消息附件、模块弹窗等，组件级选择器约 170 个。
- `apps/desktop/src/styles/sidebar.css`：旧侧栏、设置、modal、path input、空状态等，组件级选择器约 114 个。
- `apps/desktop/src/styles/layout.css`：Workbench、switch、activity button、rail toggle 等，组件级选择器约 61 个。
- `apps/desktop/src/styles/git.css`：git 列表、diff、commit dialog、badge、empty 等，组件级选择器约 55 个。
- `apps/desktop/src/styles/components.css`：commit 按钮、icon button、textarea、right card 等，组件级选择器约 54 个。
- `apps/desktop/src/styles/mcp.css`：MCP 搜索、资源卡片、安装按钮、配置弹窗等，组件级选择器约 36 个。

## 优先级

### P0：完全未组件化的业务入口

这些文件没有引入 shadcn/ui，迁移收益明确，改造边界相对清楚。

1. `apps/desktop/src/components/opencode/OpenCodeApiDialog.tsx`
   - 现状：自定义 `modal-mask`、`modal-card`、`settings-card`、原生 `input.path-input`。
   - 目标：改为 `Dialog`、`DialogContent`、`DialogTitle`、`Input`、`Button`。
   - 风险：低。弹窗结构简单。

2. `apps/desktop/src/components/QuestionDock.tsx`
   - 现状：原生 `button/input`，自绘 radio/checkbox，`gt-question-*` 样式完整接管交互外观。
   - 目标：用 `Button`、`Input`、`ToggleGroup` 或 `Checkbox/RadioGroup` 承载选项和操作；保留问题 dock 的布局类。
   - 风险：中。该组件有单选、多选、自定义输入、确认页、折叠和禁用态，需要先补足交互回归。

3. `apps/desktop/src/components/git/DocumentPreviewViewer.tsx`
   - 现状：Excel sheet tab 使用原生 `button`，empty state 使用 `gt-document-preview-empty`。
   - 目标：sheet tab 使用 `ToggleGroup` 或 `Button`，空状态使用 `Empty`。
   - 风险：低到中。需要确认表格预览横向滚动和 tab 视觉不回退。

4. `apps/desktop/src/components/git/GitStageToggle.tsx`
   - 现状：自定义 stage toggle 图标类。
   - 目标：如果是可交互控件，使用 `Button` 或 `IconButton`；如果只是图标，保留为纯展示组件。
   - 风险：低。

5. `apps/desktop/src/components/common/AppChromeIcons.tsx`
   - 现状：自定义图标类。
   - 目标：只处理确实是按钮外观的类；纯图标无需强行 shadcn 化。
   - 风险：低。

### P1：已混用 shadcn，但仍有大量 CSS 补丁的核心模块

这些模块已具备组件迁移基础，但仍通过 CSS 重建卡片、徽章、空状态、输入框、开关或弹窗。

1. `apps/desktop/src/components/opencode/OpencodeSkillsPanels.tsx`
   - 现状：已用 `Button`、`Collapsible`、`DropdownMenu`、`ToggleGroup`，但 Skills 市场 card、skeleton、empty、quality badge、安装日志仍为自定义结构。
   - 目标：`Card`、`Badge`、`Empty`、`Skeleton`、`Button` 统一市场列表、详情面板和加载态。
   - 风险：中。列表密度高，需保持市场浏览效率和滚动行为。

2. `apps/desktop/src/components/settings/SettingsDialog.tsx`
   - 现状：已用 `Dialog`、`Input`、`Select`、`Switch`、`ToggleGroup`，但 `settings-panel-card`、`settings-inline-input`、`settings-switch` 仍在补样式。
   - 目标：提取 `SettingsSection`、`SettingsRow`、`SettingsControl`，表单控件全部落到 shadcn 组件。
   - 风险：中。设置页覆盖范围广，需分 section 验证。

3. `apps/desktop/src/components/opencode/OpenCodeModulePanel.tsx`
   - 现状：已用 `Dialog`、`Input`、`Select`、`Switch`、`Textarea`、`ToggleGroup`，但模块容器、关闭按钮、权限/Agent/MCP/Skills 空状态仍为自定义类。
   - 目标：用 `Dialog` 完整组合、`Button` 关闭按钮、`Empty` 空状态、`Badge` 状态标记。
   - 风险：中。多个 tab 共享同一面板。

4. `apps/desktop/src/components/opencode/OpencodeMcpPanels.tsx`
   - 现状：已用部分 shadcn 控件，但 MCP 卡片、安装态、错误态、配置区仍靠 `gt-module-empty`、`settings-skill-card` 等类。
   - 目标：统一为 `Card`、`Badge`、`Empty`、`Button`、`Input`、`Textarea`。
   - 风险：中。需要保证 JSON/headers/env 编辑体验。

5. `apps/desktop/src/components/opencode/OpencodeComposerPanel.tsx`
   - 现状：已用 `Button`、`DropdownMenu`、`Input`、`Switch`、`Textarea`，但 composer shell、附件按钮、slash popover、模型选择菜单仍由 `opencode-*` 类控制。
   - 目标：保留 composer 的产品布局，优先把按钮、输入、菜单、切换项迁移到 shadcn primitives。
   - 风险：高。输入框、附件、slash 命令、模型选择都是高频路径。

### P2：领域布局和可视化区域

这些模块有大量业务视觉表达，迁移时应避免为了“组件化”牺牲信息密度或图形布局。

- `apps/desktop/src/App.tsx`：commit dialog、busy card、context menu 等可继续拆分后迁移。
- `apps/desktop/src/components/git/GitChangesPanel.tsx`：diff 操作、empty、badge、文件列表动作。
- `apps/desktop/src/components/git/GitTreeTopologyPanel.tsx`：已用多个 shadcn 组件，拓扑节点和图形区域应谨慎保留领域样式。
- `apps/desktop/src/components/mcp/McpMarketplace.tsx`：资源卡片、筛选、详情弹窗可逐步组件化。
- `apps/desktop/src/components/settings/RuntimeSetupDialog.tsx` 和 `MobileControlDialog.tsx`：运行时和移动控制设置可跟随 `SettingsDialog` 的抽象一并收敛。
- `apps/desktop/src/components/terminal/TerminalPanel.tsx`：终端 tab/icon button 可收敛到 `Button` 或 `IconButton`。

## 目标组件映射

| 当前模式 | 目标组件 |
| --- | --- |
| 原生 `button`、`*-btn`、`*-icon-btn` | `Button`、`IconButton` |
| 原生 `input.path-input`、`settings-inline-input`、`opencode-provider-picker-input` | `Input` |
| `gt-textarea`、`gt-module-textarea`、`gt-mcp-json-input` | `Textarea` |
| `settings-select`、`gt-mcp-filter-select` | `Select` |
| `gt-switch`、`settings-switch`、`opencode-switch` | `Switch` |
| `*-badge`、状态 span | `Badge` |
| `*-empty`、空 div 文案 | `Empty` |
| `*-skeleton-*`、`animate-pulse` 类加载块 | `Skeleton` |
| `modal-mask`、`modal-card`、`*-dialog` | `Dialog` 或 `AlertDialog` |
| 自定义 tabs/segmented buttons | `ToggleGroup` 或后续补充 `Tabs` |
| `border-t` 分隔线、空 div 分隔线 | `Separator` |
| 卡片容器类 | `Card`，仅限真实卡片或重复项，不把页面 section 套成卡片 |

## 分阶段计划

### 阶段 0：建立迁移护栏

目标：先统一口径，防止边迁移边新增 CSS 补丁。

任务：

- 明确允许保留的样式类型：布局、密度、滚动、领域图形、品牌/产品特有视觉。
- 明确优先迁移的样式类型：按钮、表单控件、弹窗、徽章、空状态、骨架屏、开关、菜单。
- 补一个轻量扫描脚本或 npm script，统计业务文件中的原生控件和组件级 CSS 类。
- 建立迁移 checklist：每改一个模块，都记录删除了哪些旧类、保留了哪些领域样式。

验收：

- 能稳定输出剩余原生控件数量和疑似组件级 CSS 类数量。
- 新增 UI 代码默认使用 `apps/desktop/src/components/ui` 下已有组件。

### 阶段 1：低风险弹窗和原生控件迁移

目标：优先消灭完全未组件化入口。

任务：

- 重构 `OpenCodeApiDialog.tsx` 为 shadcn `Dialog + Input`。
- 重构 `DocumentPreviewViewer.tsx` 中 Excel sheet tab 和 empty state。
- 梳理 `GitStageToggle.tsx` 与 `AppChromeIcons.tsx`，只迁移交互控件，不动纯图标。

验收：

- 原生控件命中从 15 处下降到约 8 处以内。
- `modal-mask`、`modal-card` 在 OpenCode API 弹窗路径不再使用。
- 弹窗可键盘关闭，有标题，焦点行为正常。

### 阶段 2：QuestionDock 专项

目标：把问题面板从自绘控件迁移到组件化控件。

任务：

- 用 `Button` 替换 dock 折叠、忽略、提交、下一步按钮。
- 用 `Input` 替换自定义答案输入框。
- 评估是否添加并使用 `Checkbox`、`RadioGroup`；如果暂不添加，则用 `ToggleGroup` 承载选项。
- 保留 dock 外层定位、动画、尺寸等布局类。
- 为单选、多选、自定义答案、确认页、disabledReason 写回归用例或手动验收清单。

验收：

- `QuestionDock.tsx` 不再出现原生 `button/input`。
- `gt-question-btn`、`gt-question-custom-input`、自绘 checkbox/radio 类被移除或降级为布局/状态类。
- 单问题自动提交、多问题确认、自定义输入、多选取消选择行为保持一致。

### 阶段 3：设置页和模块面板收敛

目标：把设置和 OpenCode 模块里的重复表单/卡片模式抽象成稳定组合。

任务：

- 在 `SettingsDialog.tsx` 内部或临近文件提取 `SettingsSection`、`SettingsRow`、`SettingsControl`。
- 把 `settings-inline-input` 全部替换为 `Input`。
- 把 `settings-switch`、`gt-switch`、`opencode-switch` 全部替换为 `Switch`。
- 把 `gt-module-empty` 系列替换为 `Empty` 或小型 `Empty` 组合。
- 把 `OpenCodeModulePanel.tsx` 的关闭按钮和 tab 操作统一用 `Button`、`ToggleGroup`。

验收：

- 设置相关 CSS 中 `settings-inline-input`、`settings-switch` 使用点清零。
- `OpenCodeModulePanel.tsx` 不再使用 `modal-close`、`path-input`、`gt-switch`。
- 设置页各 section 在中英文和繁中下文本不溢出。

### 阶段 4：市场、MCP、Skills 卡片迁移

目标：减少 `marketplace.css` 和 `mcp.css` 中重复定义的 card、badge、empty、skeleton、button。

任务：

- `OpencodeSkillsPanels.tsx` 的 marketplace list item 迁移到 `Card + Badge + Button`。
- loading 列表迁移到 `Skeleton`。
- 空搜索结果迁移到 `Empty`。
- quality、scope、installed 等状态统一使用 `Badge` variants。
- `McpMarketplace.tsx` 与 `OpencodeMcpPanels.tsx` 的资源卡片、安装按钮、配置状态同步迁移。

验收：

- `marketplace.css` 中 skill card、skill skeleton、skill empty 相关选择器显著减少。
- `mcp.css` 中 MCP resource card、installed badge、get button 的组件级样式减少。
- Skills 市场滚动分页、安装菜单、详情加载行为不变。

### 阶段 5：Composer 和高频交互收敛

目标：处理最敏感的聊天输入区，最后迁移以降低回归风险。

任务：

- 保留 composer 外层布局和尺寸策略。
- 附件按钮继续使用 `Button size="icon"`，移除 `opencode-image-btn` 中与按钮基础状态重复的样式。
- slash popover 评估改为 `DropdownMenu`、`Command` 或轻量自定义列表；不要破坏键盘导航。
- 模型选择区逐步替换自绘 menu row、switch、search input。
- 消息附件按钮、jump latest、stop button 统一 Button/IconButton。

验收：

- 输入、粘贴、拖拽附件、slash 命令、模型搜索、发送/停止全部通过手动回归。
- `opencode-input` 只保留 textarea 尺寸和 composer 特有排版，不再覆盖基础 input/textarea 视觉。

## 验证策略

每个阶段至少执行：

- `npm run build` 或项目已有等价构建命令。
- TypeScript 检查，如果项目脚本可用。
- 桌面端手动冒烟：启动应用，覆盖对应模块入口。
- 视觉验收：暗色/浅色主题、中文/英文长文本、窗口窄宽变化。
- 交互验收：键盘焦点、Escape 关闭弹窗、禁用态、加载态、错误态。

推荐为以下路径建立固定手动清单：

- 打开设置，切换通用、外观、工作区、模型、技能、MCP、移动端控制。
- 打开 OpenCode API 设置并修改端口。
- 触发 QuestionDock，验证单选、多选、自定义输入和确认页。
- 打开 Skills 市场，搜索、切 tab、滚动分页、安装菜单、查看详情。
- 打开 MCP 市场，筛选、查看详情、配置/安装。
- 在 chat composer 中输入、上传附件、触发 slash suggestions、切换模型。

## 风险和约束

- 不建议一次性删除大块 CSS。先迁移组件，再按选择器使用情况删除死样式。
- `marketplace.css` 里混有多个历史区域，删除前必须确认是否仍被 `App.tsx` 或 git/worktree 模块引用。
- `App.tsx` 体量较大，优先迁移局部弹窗和 context menu，不在本计划中做大拆分。
- `Sidebar` 已经较多使用 shadcn sidebar primitives，原生 button 有些是 `asChild` 的合理用法，不应简单按命中删除。
- 领域图形、diff、拓扑节点、终端布局不强求 shadcn 化；只迁移通用控件。

## 完成标准

第一轮重构完成时：

- 完全未引入 shadcn/ui 的问题入口从 5 个降到 0-1 个。
- 原生控件命中从 15 处降到 5 处以内，剩余均有说明，例如 `asChild` 或文件 input。
- 组件级 CSS 类使用点从约 255 处下降至少 40%。
- `modal-mask`、`modal-card`、`path-input`、`settings-switch`、`gt-question-btn` 等高重复类不再作为新代码依赖。
- 所有新弹窗都有 `DialogTitle` 或可访问标题。
- 按钮、输入、选择、开关、徽章、空状态、骨架屏优先使用 `apps/desktop/src/components/ui` 组件。

第二轮重构完成时：

- `marketplace.css`、`chat.css`、`sidebar.css`、`components.css` 中的通用控件样式大幅收敛。
- 自定义 CSS 主要承担布局、滚动、复杂图形、产品特有状态，而不是重建基础 UI 组件。

## 建议执行顺序

1. `OpenCodeApiDialog.tsx`
2. `DocumentPreviewViewer.tsx`
3. `QuestionDock.tsx`
4. `SettingsDialog.tsx`
5. `OpenCodeModulePanel.tsx`
6. `OpencodeMcpPanels.tsx` 和 `McpMarketplace.tsx`
7. `OpencodeSkillsPanels.tsx`
8. `OpencodeComposerPanel.tsx`
9. `App.tsx` 中残留 commit dialog、busy card、context menu
10. CSS 死样式清理和统计脚本固化


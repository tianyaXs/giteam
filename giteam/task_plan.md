# Task Plan: Giteam 设计系统整改

## Goal
建立完整的设计系统 Token 体系，将 17,000 行 styles.css 中的 23 种圆角、15 种字号、12 种字重、20+ 种间距、近百种阴影收敛到规范化的 Token 系统中；并将单文件拆分为按功能组织的模块化目录结构，实现统一管理。

## Phases
- [x] Phase 1: 建立 CSS Token 变量系统（在 :root 中定义所有 Design Token）
- [x] Phase 2: 全局基础样式整改（body、workbench、scrollbar、基础组件）
- [x] Phase 3: 高频组件样式整改（按钮、输入框、卡片、消息气泡、弹窗）
- [x] Phase 4: 中频组件样式整改（侧边栏、面板、设置、列表项）
- [x] Phase 5: 低频/边缘组件清理（图谱、MCP、OpenCode 对话框等）
- [x] Phase 6: 废弃值清理与一致性检查
- [x] Phase 7: 构建测试与视觉回归验证
- [x] Phase 8: 样式文件模块化拆分（单文件 → 14 个功能模块文件）

## Key Questions
1. 是否需要保留现有的 CSS 自定义属性（--bg, --text 等）？→ 保留，它们是颜色主题的基础
2. 新 Token 如何命名避免冲突？→ 使用 `--gt-radius-*`、`--gt-text-*`、`--gt-space-*`、`--gt-shadow-*` 前缀
3. 是否有内联样式在 TSX 中？→ 已检查并统一
4. 文件拆分是否会影响层叠顺序？→ 通过保持原顺序导入解决；跨边界的规则块已手动修复

## Decisions Made
- 圆角系统：5 级（0px / 3px / 5px / 7px / 999px）
- 字号系统：8 级（10px ~ 24px）
- 字重系统：4 级（400 / 500 / 600 / 700）
- 间距系统：4px base unit，12 级
- 阴影系统：5 级 Elevation
- 不影响业务：不改 JSX 结构，不改组件逻辑，只改 CSS 类名对应的样式值
- 文件拆分：保留原层叠顺序，按功能域切分

## Errors Encountered
- MonacoDiffViewer.tsx 的 `fontSize` 是 Monaco Editor API 选项，类型为 `number`，不能用 CSS 变量字符串 → 已恢复为硬编码 `12`
- 文件拆分后 utils.css 出现 `.graph-row` 规则块跨边界断裂 → 已手动修复（将跨边界属性合并到 git.css）

## Status
**ALL PHASES COMPLETED** — 设计系统 Token 已全面落地，文件已模块化拆分，Web 端构建测试通过。

## 文件结构（模块化后）
```
src/styles/
├── index.css          (入口，按原顺序 @import 所有模块)
├── tokens.css         (132 行 — 所有 Design Token)
├── base.css           (41 行 — reset, html, body)
├── layout.css         (2,679 行 — Workbench 骨架)
├── sidebar.css        (3,249 行 — 侧边栏内容)
├── editor.css         (已合并到其他文件)
├── git.css            (~850 行 — Git 图谱、changes、diff)
├── components.css     (~220 行 — 通用组件：按钮、chip、badge)
├── chat.css           (~2,050 行 — QuestionDock、composer、OpenCode)
├── marketplace.css    (~4,910 行 — Skills 市场)
├── mcp.css            (~2,150 行 — MCP 市场)
├── terminal.css       (~325 行 — 终端)
├── modal.css          (~400 行 — 弹窗、popover)
├── theme.css          (~40 行 — Light theme + responsive)
├── utils.css          (~90 行 — Scrollbars)
└── animations.css     (~180 行 — Keyframes)
```

## 修改统计
| 文件 | 变更 |
|---|---|
| `apps/desktop/src/styles/` | 新建目录，14 个模块化 CSS 文件 |
| `apps/desktop/src/styles.css` | 已删除（单文件拆分为模块） |
| `apps/desktop/src/main.tsx` | 导入路径更新为 `./styles/index.css` |
| `apps/desktop/src/App.tsx` | 30 行修改，内联样式硬编码值替换为 Token |
| `apps/desktop/src/components/opencode/OpenCodeAuthDialog.tsx` | 4 行修改 |
| `apps/desktop/src/components/opencode/OpenCodeProviderList.tsx` | 1 行修改 |

## 整改成果
- **border-radius**: 23 种 → 5 种 Token（100% 清除硬编码）
- **font-size**: 15 种 → 8 种 Token（100% 清除硬编码）
- **font-weight**: 12 种 → 4 种 Token（100% 清除硬编码）
- **line-height (px)**: 全部清除，映射到 8 级行高 Token
- **padding/margin/gap 单值**: 全部清除，映射到间距 Token
- **padding/margin/gap 复合值**: 大面积清除
- **box-shadow**: 55 处纯 elevation 阴影替换为 5 级 Elevation Token
- **TSX 内联样式**: 所有静态硬编码值已替换
- **文件组织**: 17,307 行单文件 → 14 个功能模块文件

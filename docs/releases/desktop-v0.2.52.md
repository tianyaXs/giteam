# Giteam Desktop v0.2.52

发布标签：`desktop-v0.2.52`

## 插件 / 技能 / MCP 设置

- 设置「插件」页对齐 Codex 式布局：插件 / 技能 / MCP 分区、搜索与添加入口
- MCP 列表与「连接至自定义 MCP」弹窗收紧样式；类型切换高度稳定，避免分段控件抖动
- MCP 服务列表访问后保活，切 tab 不再反复重拉；三点菜单去掉断开，开关不再刷连接态文案
- 运行时依赖（git / entire / giteam）改为「安装 / 更新」按钮，去掉卸载开关；并修复 Entire（Cask）等假成功卸载问题

## 会话体验

- 中途停止后半截正文可正确保留渲染
- 贴底滚动更稳：工具事件增高时仍跟随；半截 Markdown 不再拖垮渲染
- MCP / 工具事件行首帧样式更稳，减少抖动

## 说明

- 功能基线同 [v0.2.51](./desktop-v0.2.51.md)

## 发布

```bash
git tag desktop-v0.2.52
git push origin desktop-v0.2.52
```

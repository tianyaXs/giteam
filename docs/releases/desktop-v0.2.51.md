# Giteam Desktop v0.2.51

发布标签：`desktop-v0.2.51`

## 审查（Git 变更面板）

- 完善主按钮逻辑：有未提交变更（含未暂存/未跟踪）时走提交；无未提交但有 ahead/behind 时切为 VSCode 式 **Sync Changes N↑M↓**
- 主按钮常显、空闲时置灰，避免「出现后消失」的布局跳动
- 同步进行中保持文案稳定，仅图标旋转；下拉菜单补充 Sync / Commit 入口

## 分支切换

- 有未提交变更时切换分支会弹出提交对话框，显示「提交后切换」目标分支
- 提交成功后自动完成 checkout；取消提交则放弃待切换

## 其他

- 消息流滚动条样式微调
- 新增客户端使用文档 `docs/Giteam客户端使用文档.html`

## 说明

- 功能基线同 [v0.2.50](./desktop-v0.2.50.md)

## 发布

```bash
git tag desktop-v0.2.51
git push origin desktop-v0.2.51
```

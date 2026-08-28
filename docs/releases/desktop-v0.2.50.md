# Giteam Desktop v0.2.50

发布标签：`desktop-v0.2.50`

## Agent 行为

- 禁止假性许可提问（如「直接跑一遍吗？」「Should I proceed?」）：明显下一步直接执行，危险动作交给命令审批
- 明确：纯文本问号不是等待态，只有 `question` 工具才等用户
- 真决策与会被答案否决的 bash/write **同轮互斥**（可并行无害只读探索）

## 说明

- 功能基线同 [v0.2.49](./desktop-v0.2.49.md)

## 发布

```bash
git tag desktop-v0.2.50
git push origin desktop-v0.2.50
```

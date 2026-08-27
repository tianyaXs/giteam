# Giteam Desktop v0.2.44

发布标签：`desktop-v0.2.44`

## 自动化（新）

- 左侧栏新增「自动化」入口，主界面可在 Agent / 自动化之间切换
- 为**已导入项目**创建定时任务：到点由本机 Agent 静默执行目标 prompt（需保持 Giteam 运行）
- 支持**新会话** / **已有会话**；目标会话 busy 时自动 `skipped` 并写入历史
- 调度：每天 / 工作日 / 每周 / 间隔 / 自定义；可指定**模型**、**推理强度**、**通知级别**
- 三栏 UI：任务列表 + 创建/详情表单（Codex 风格交互）+ 运行历史
- 支持立即运行、暂停/启用、All/Enabled/Paused 过滤与搜索
- 运行完成**未读蓝点**；打开详情后标记已读；桌面通知尊重「Agent 通知」总开关
- 本地存储：`~/.giteam/automation.db`
- 规格：`docs/superpowers/specs/2026-08-27-automation-design.md`

## 项目分享（新）

- 将项目快照（代码 + AI 会话 + 记忆 + 附件 + review）导出并上传云端，生成分享链接
- 导出时自动**脱敏** API Key、Token、私钥等；代码（git bundle）与上下文**分包**上传
- 项目右键「分享项目…」；弹窗展示链接、体积、会话数与 CLI 导入命令
- 新增「**添加项目**」向导：本地文件夹导入，或凭分享链接**远程导入**
- 支持 `giteam://import` 深链与冷启动 pending URL
- 接收方可 `--attach` 将分享上下文合并到已有本地仓库
- 规格：`docs/superpowers/specs/2026-08-26-project-share-design.md`

## Agent 与会话

- 会话结束后用 history **对账**补全漏掉的最终回复，避免整表替换导致闪动
- 新增 `appendMissingTextPartsToLive`：finalized 后只补 live 正文
- 过滤 Pi **compaction** 注入的 user 摘要块，UI 不再展示模型专用英文摘要
- **停止响应更快**：prompt 整段与 abort 竞速；重试等待也支持 abort
- 新增按 session 中止活跃 run（`abortSession`）
- abort 时 revert 未完成响应，避免残留半截 assistant 消息
- 单元测试：`agentParts.appendText`、`agentSessions.reconcileTail`

## 桌面界面

- 分支切换从右侧面板移至左侧 **BranchPickerNavItem**（搜索 / 切换 / 新建分支）
- 设置中「工作树」文案统一为「**分支**」
- 资产图谱标签 **LOD**：拉近才显示名称、聚焦时非相关节点淡化
- 右侧栏 tab 轻量胶囊样式
- 导入项目时可自定义显示名称；`mainMode` 切换时自动回到 Agent 视图

## 云端 Gateway（自托管）

- Project Share API：分块上传 repo/context、finalize、元数据、下载、撤销
- finalize 后物化 bare git，公开 dumb-HTTP `/s/{id}/repo.git/*`
- 数据库迁移 `003_shares.sql`、`004_shares_split.sql`
- Cloud 管理后台 **Shares** 页；公开 **SharePage** 落地页

## 移动端（同仓库，需单独发版）

- compaction 摘要渲染为「会话已压缩」分隔线
- 合并连续重复 divider；剥离 session summary 注入块

## CLI 配套版本

请同步升级 CLI 至 **v0.1.52**（`npm install -g giteam@0.1.52`）以使用完整分享命令行能力。

## 发布

```bash
git tag desktop-v0.2.44
git push origin desktop-v0.2.44
```

或在 GitHub Actions 手动触发 **Desktop Release** workflow。

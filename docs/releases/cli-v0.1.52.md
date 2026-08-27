# Giteam CLI v0.1.52

发布标签：`cli-v0.1.52`

## 项目分享（新）

- `giteam share create`：导出当前工作区快照上传云端
  - 输出分享 URL、Git remote、代码/上下文体积、脱敏统计
- `giteam share import <url>`：从分享链接导入（等同 `giteam init --from`）
- `giteam share list`：列出本工作区已发布分享
- `giteam share revoke <id>`：撤销分享
- `giteam init --from <url>`：远程导入新项目
  - `--attach`：将上下文合并到已有本地仓库，跳过代码克隆
  - 支持跳过依赖检查的快速导入路径
- JSON 输出字段：`gitUrl`、`repoSizeBytes`、`contextSizeBytes`、`contextSha256` 等

## Core

- `giteam-core/share`：export / import / pack / redact / client
- 导出：`git bundle` + 会话 catalog + memory.db + 附件，脱敏后分包上传
- 导入：下载校验 → git clone（HTTP dumb server）→ rekey 路径 → 注册项目
- 集成测试：`share_roundtrip.rs`

## Control / Agent

- `/api/v1/agent/abort` 支持 `sessionId` 作为 `runId` 替代参数
- `PiAgentService`：`has_active_run_for_session`、`abort_session`

## 安装

```bash
npm install -g giteam@0.1.52
```

## 发布

```bash
git tag cli-v0.1.52
git push origin cli-v0.1.52
```

触发 **NPM Publish** workflow，发布各平台 optional 包并创建 GitHub Release。

## 配套桌面版

项目分享 UI、自动化模块、深链导入需 **Desktop v0.2.44** 及以上。

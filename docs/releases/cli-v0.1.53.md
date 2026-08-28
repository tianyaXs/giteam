# Giteam CLI v0.1.53

发布标签：`cli-v0.1.53`

## 修复

- **v0.1.52 发布失败**：各平台 optional 包已发布，但 root 包在 `npm --prefix apps/desktop ci` 阶段失败
  - 原因：`package-lock.json` 缺少 `@emnapi/core@1.11.3` / `@emnapi/runtime@1.11.3` 顶层条目（与 desktop 0.2.44 同源问题）
  - 已在 desktop 0.2.45 修复 lockfile；本版重新完成 root 包发布与 GitHub Release

## 功能（同 v0.1.52）

- 项目分享：`giteam share create/import/list/revoke`、`giteam init --from`、`--attach`
- Core：`giteam-core/share` 完整链路
- Control：`/api/v1/agent/abort` 支持 `sessionId`

## 安装

```bash
npm install -g giteam@0.1.53
```

## 发布

```bash
git tag cli-v0.1.53
git push origin cli-v0.1.53
```

## 配套桌面版

**Desktop v0.2.45** 及以上。

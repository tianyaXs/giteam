# Desktop 在线升级（Tauri Updater + GitHub Releases）

## 方案

- 客户端：`tauri-plugin-updater` + `tauri-plugin-process`
- 分发：GitHub Release 附件里的安装包 + `latest.json`
- 验签：minisign；公钥写在 `apps/desktop/src-tauri/tauri.conf.json`，私钥只放 CI Secret

更新入口：设置 → 关于。`updatesStartup` 控制启动后自动检查。

产品交互：

- 发现新版本：弹窗展示版本号与更新说明，可「稍后」或「下载并安装」
- 设置页：同步展示更新内容与进度
- 安装并重启后：弹出「已更新完成 / What's New」

Release body 会写入 `latest.json` 的 `notes`，请在打 tag 前写好更新说明（workflow 默认有一份通用 What's New）。

## 一次性密钥配置

本机已生成密钥（勿提交仓库）：

- 私钥：`~/.giteam/updater.key`
- 公钥：`~/.giteam/updater.key.pub`（已写入 `tauri.conf.json`）

在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：

1. `TAURI_SIGNING_PRIVATE_KEY`：**必填**，`cat ~/.giteam/updater.key` 的完整内容（一行 base64）
2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：仅在生成密钥时设了密码才需要；`--ci` 无密码生成时可省略
3. （可选）`GH_RELEASE_TOKEN`：classic PAT，勾选 `repo`。当默认 `GITHUB_TOKEN` 被锁成只读、Create Release 报 `Resource not accessible by integration` 时使用

同时打开 [Actions 权限](https://github.com/tianyaXs/giteam/settings/actions)：

- Workflow permissions → **Read and write permissions**
- 勾选 Allow GitHub Actions to create and approve pull requests（可选）

丢失私钥后无法给已安装用户继续签名升级，务必备份。

## 发布流程

1. 同步版本号：`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json`
2. 确认本地 `cd apps/desktop && npm run build` 能通过（CI 会跑同一条命令）
3. 打标签并推送：
   ```bash
   git tag desktop-v0.2.0
   git push origin desktop-v0.2.0
   ```
4. 或手动跑 Actions：`Desktop Release`
5. Actions 成功后 Release 会直接发布（非 draft），应含各平台安装包与 `latest.json`
6. 客户端 endpoint：
   `https://github.com/tianyaXs/giteam/releases/latest/download/latest.json`

## 本地验签构建（可选）

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.giteam/updater.key)"
cd apps/desktop && npm run tauri:build
```

产物目录会带 `.sig`；正式分发仍建议走 GitHub Actions。

## 注意

- macOS 正式分发还需要 Apple Developer 代码签名/公证（与 updater 签名是两套）
- 私有仓库的 Release 资产默认不可匿名下载，需改公开仓库或自建 CDN 镜像
- Web 模式不支持 updater，设置页会提示「当前环境不支持」

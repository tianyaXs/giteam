# Desktop 在线升级（Tauri Updater + GitHub Releases）

## 方案

- 客户端：`tauri-plugin-updater` + `tauri-plugin-process`
- 分发：GitHub Release 附件里的安装包 + `latest.json`
- 验签：minisign；公钥写在 `apps/desktop/src-tauri/tauri.conf.json`，私钥只放 CI Secret

更新入口：设置 → 更新。`updatesStartup` 控制启动后自动检查。

## 一次性密钥配置

本机已生成密钥（勿提交仓库）：

- 私钥：`~/.giteam/updater.key`
- 公钥：`~/.giteam/updater.key.pub`（已写入 `tauri.conf.json`）

在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：

1. `TAURI_SIGNING_PRIVATE_KEY`：`cat ~/.giteam/updater.key` 的完整内容
2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：若生成时设了密码则填；当前无密码可留空或不建

丢失私钥后无法给已安装用户继续签名升级，务必备份。

## 发布流程

1. 同步版本号：`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json`
2. 打标签并推送：
   ```bash
   git tag desktop-v0.1.34
   git push origin desktop-v0.1.34
   ```
3. 或手动跑 Actions：`Desktop Release`
4. 检查 draft Release：应有各平台安装包与 `latest.json`
5. 确认无误后 Publish Release
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

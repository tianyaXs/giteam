# Giteam Desktop v0.2.60

发布标签：`desktop-v0.2.60`

## 本版重点

- 对齐 Tauri NPM/Rust 主次版本（`@tauri-apps/api` 2.12.x / plugin-process 2.4 / plugin-updater 2.14），修复 0.2.59 全平台因版本检查失败无法打包
- 继续使用已验证的 `pi_agent_rust` fork tip（含 OpenAI null choices 与 Kimi message_delta cache 补丁）

## 说明

- 打开 **设置 → 关于** 即可安装，或在下方下载对应平台安装包
- Windows 建议安装 Git for Windows
- 详细说明见本文件

## 发布

```bash
git tag desktop-v0.2.60 && git push origin desktop-v0.2.60
```

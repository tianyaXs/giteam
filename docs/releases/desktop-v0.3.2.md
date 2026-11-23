# Giteam Desktop v0.3.2

发布标签：`desktop-v0.3.2`

## 本版重点

- 助手回合按 open / active / settled 收口：同一次重试只更新一行，不再每次 attempt 多出一组「已重试」
- 暂停后的重试标签留在对应的「继续」后面，不再被 history 对账提前到上一条消息上面
- 已经写出正文或工具的回合不再被下一条 `message.started` 收成同一个 id，过程内容保留原序

## 继承自 0.3.1（发布时不要退回）

- Windows 仍钉 `tianyaXs/pi_agent_rust@9daf269d`，保留 `windows_process_extensions_raw_attribute` feature gate（0.3.0 的 E0658）
- 工具链 `nightly-2026-08-31`；`giteam-core` recursion_limit 512
- macOS runner `macos-15`；Linux `ubuntu-24.04` 并安装 pipewire / gbm / EGL / wayland
- 前端构建 `NODE_OPTIONS=--max-old-space-size=8192`；npm 钉 10.9.8

## 说明

- 打开 **设置 → 关于** 即可安装，或在下方下载对应平台安装包
- Windows 建议安装 Git for Windows

## 发布

```bash
git tag desktop-v0.3.2 && git push origin desktop-v0.3.2
```

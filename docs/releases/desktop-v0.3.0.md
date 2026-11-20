# Giteam Desktop v0.3.0

发布标签：`desktop-v0.3.0`

## 本版重点

- 跟进队列改为累计排队；插队（Send Now）跨 abort 双终态不丢消息；停止只中止当前回合并冲刷队列
- 修复新发送消息插进历史中间的时序错乱：用户句只追加到末尾，历史对账按落盘顺序归并
- 帆船标尺蓝点与船位共用滚动进度轴；流式结束后停在输出完位置，不再跳回「user 贴底」
- 升级 `pi_agent_rust` 官方 tip + asupersync 0.5；移除 Windows HTTPS egress shim；提高 `giteam-core` rustc recursion_limit（修复 0.2.60 全平台编译失败）
- 桌面宠物窗口与相关设置入口

## CI 规避（相对 0.2.59 / 0.2.60）

- 保持 Tauri NPM/Rust 插件主次版本对齐（api 2.12 / process 2.4 / updater 2.14）
- `#![recursion_limit = "512"]`：避免 automation / pi_agent 大 async 状态机顶穿默认查询深度
- 发布 workflow 安装与 `rust-toolchain.toml` 一致的 nightly，避免 stable/nightly 漂移
- 继续使用 Node 22 + 8GB 堆，避免 macOS Vite OOM

## 说明

- 打开 **设置 → 关于** 即可安装，或在下方下载对应平台安装包
- Windows 建议安装 Git for Windows
- 详细说明见本文件

## 发布

```bash
git tag desktop-v0.3.0 && git push origin desktop-v0.3.0
```

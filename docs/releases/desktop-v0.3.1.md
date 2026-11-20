# Giteam Desktop v0.3.1

发布标签：`desktop-v0.3.1`

## 本版重点

- 修复 Windows 发布编译失败（E0658）：`pi_agent_rust` tip 仍用 `ProcThreadAttributeList` / `spawn_with_attributes`，但误删了 `windows_process_extensions_raw_attribute` feature gate
- 临时改钉 `tianyaXs/pi_agent_rust@9daf269d`（基于上游 `b217af5`，仅恢复 Windows gate）；上游 [#257](https://github.com/Dicklesworthstone/pi_agent_rust/issues/257) 合入后可切回官方 tip
- 功能相对 0.3.0 无变更；补齐 Windows 安装包

## 继承自 0.3.0

- 跟进队列累计 + 插队（Send Now）；停止只中止当前回合并冲刷队列
- 修复新消息插进历史中间的时序错乱
- 帆船蓝点与船位同轴；流式结束后停在输出完位置
- `pi_agent_rust` / asupersync 0.5；`giteam-core` recursion_limit 512
- 桌面宠物窗口

## 说明

- 打开 **设置 → 关于** 即可安装，或在下方下载对应平台安装包
- Windows 建议安装 Git for Windows

## 发布

```bash
git tag desktop-v0.3.1 && git push origin desktop-v0.3.1
```

# Anthropic `cache_control` 评估（P3）

## 结论

**暂不引入显式 `cache_control` 断点。**

## 依据

1. Giteam 与 dsh 当前都依赖提供商**自动前缀 KV 缓存**；usage 已透传 `cache_read` / `cache_write`。
2. 本轮已把易变 digest / mode policy 移出 system append，改为可 supersede 的 runtime Custom；稳定段顺序固定为 memory → workspace → skills。
3. 显式断点需要：
   - Anthropic Messages API 路径确认（当前多走 OpenAI 兼容 / DeepSeek）
   - 与 pi provider 转换层对接（断点落在 system 哪个 block）
   - 回归：断点移动导致 cache write 暴涨的风险

## 2026-11-17 kimi-coding 实测补记

- Provider：`kimi-coding` / `k3` 与 `kimi-for-coding`，Anthropic Messages 兼容（`api.kimi.com/coding/v1/messages`）。
- 现象：Giteam 多轮 `cacheRead` 全程为 0；**dsh 同端点同 key 有大量 `cacheReadTokens`**。
- 根因分层：
  1. **前缀打爆（已修）**：被动 digest 按本轮 prompt 裁剪 + `age_label` 分钟漂移 → runtime Custom 每轮改写。现被动 digest 不按 prompt 裁剪，相对时间改粗粒度桶。
  2. **usage 丢弃（真·显示根因，已修于 `pi_agent_rust`）**：kimi 流式把真实 `cache_read_input_tokens` / 拆分后的 `input_tokens` 放在 **`message_delta.usage`**；`message_start` 常为 `cache_read=0`。dsh 走 JS `pi-ai`，delta 会覆盖 cache；Giteam 的 rust `AnthropicDeltaUsage` 以前只读 `output_tokens`，导致命中永远显示 0。
- 原始 API 对照（非流/流式 turn2）：`k3` 与 `kimi-for-coding` 均可报 `cache_read_input_tokens=1536`；`cache_creation_input_tokens` 恒为 0。
- 显式 `cache_control` 对 coding 端点多为装饰，仍不引入。

## 何时再做

- 生产流量确认主要走 Anthropic Messages API，且自动前缀命中率持续偏低
- pi / provider 层暴露稳定的 block 级 `cache_control` 注入点
- 已有会话级 usage 与装配 token 报告，可量化断点收益

## 当前替代

- 稳定 system 前缀 + 动态 runtime Custom supersede（digest 内容跨轮尽量稳定）
- Desktop UI 用量控件（对齐 [shadcn Context](https://ui.shadcn.com/docs/ai-elements/base/context)）：
  - 布局：`[⊕] [N% 上下文] [缓存 N%] … [模型 ▾] [发送]`（用量在附件旁，不贴模型）
  - **上下文**：官方 `Context` HoverCard + Progress；最近一次 billed prompt / `contextWindow`
  - **缓存命中**：带「缓存」标签的文案；会话累计 `sessionUsage`
- `prompt_assembly::sample_prompt_assembly` 粗估稳定/动态占用

## 提示词长度 vs 工具（2026-11-17）

- kimi-coding/k3（262K）：短答多轮单次 prompt ≈ 10–11K（约 4% 窗口），相对窗口合理；长历史才是主压力。
- 固定税主要来自 **tools schema**（前缀缓存中 tools 通常先于 messages）；主会话工具面偏宽，对编码路径可接受，闲聊偏贵。
- 优先保持会话内 tools 字节稳定；模式化裁剪 / tools schema token 报告可后续做，本轮不加。

## 2026-11-17 sandbox policy 补记

- 统一 `SandboxMode`（默认 `workspace-write`）已进 runtime 慢变段；bash/文件工具共用同一 policy。
- OS 级围栏（Seatbelt/bwrap）与同轮 escalation UX **另开**；当前执行层仍是路径围栏 + bash 命令扫描。

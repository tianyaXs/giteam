# 上下文分类占用（临时版）计划

日期：2026-11-17  
目标：Composer 上下文环悬停后，接近 Cursor 的「分类统计」观感；**先可观测、后精确**。

## 结论

**可以做临时版。**  
现有 billed `input/output/cacheRead/cacheWrite` 不够反推分类；但装配路径已有清晰分段，可用 **chars÷4 估计** 先出一版，与真实 prompt 总量并排校验。

## Cursor 对照 → 临时版桶

| Cursor | 临时版 id | 数据来源（估计） | 优先级 |
|--------|-----------|------------------|--------|
| System prompt | `system` | `default_system_prompt` (+ discipline) | P0 |
| Rules | `rules` | `GITEAM.md`（`read_project_memory`） | P0 |
| Skills | `skills` | `build_skills_prompt` | P0 |
| Tool definitions | `tools` | registry：`name+description+parameters` JSON（非 `mcp__`） | P0 |
| MCP & dynamic tools | `mcp` | 同上，前缀 `mcp__` | P0 |
| （无直接对应） | `workspace` | `build_workspace_context` | P0 |
| （无直接对应） | `runtime` | `build_runtime_snapshot`（sandbox/digest/extra） | P1 |
| Summarized conversation | `summary` | 最近 compaction summary 文本（有则计） | P1 |
| Conversation | `conversation` | `max(0, billed_prompt − Σ固定桶)` 残差；或消息文本 chars/4 | P0 |
| Subagent definitions | — | 父会话几乎无目录体积，**临时版不做** | — |

说明：

- AGENTS.md / CLAUDE.md 由 pi `# Project Context` 注入，giteam 边界难精确截获 → 临时版并入 `system` 低估风险，文档标明「估计、可能偏低」。
- `conversation` 用残差法可避免与 billed `input+cache*` 对不齐；同时可算「消息文本估计」作对照。

## 非目标（本临时版不做）

- 模型 tokenizer 级精确 token
- 显式 Anthropic `cache_control` 断点
- Subagent 定义目录条
- 费用 `$` 行（无可靠 modelId 计价时继续隐藏）

## 数据契约（新增）

```ts
type ContextCategoryId =
  | "system" | "rules" | "skills" | "workspace"
  | "tools" | "mcp" | "runtime" | "summary" | "conversation";

type ContextCategoryUsage = {
  id: ContextCategoryId;
  label: string;          // 展示名
  estimatedTokens: number;
};

type ContextBreakdown = {
  /** 估计合计（各类之和；conversation 用残差时与 billed 对齐） */
  estimatedTotal: number;
  /** 最近一次 billed prompt = input+cacheRead+cacheWrite */
  billedPrompt: number;
  contextWindow: number;
  categories: ContextCategoryUsage[];
  /** chars/4；标明估计 */
  estimator: "chars_div_4";
};
```

下发时机（选一，临时版推荐 A）：

- **A.** 每次 assistant 完成时挂在该消息旁（与 `usage` 同生命周期）→ Composer 读末条
- **B.** 独立 RPC `agent.contextBreakdown` 按需拉取（实现重，可二期）

Rust 侧建议字段名：`context_breakdown` / `contextBreakdown`（camelCase serde）。

## 后端改动

1. **扩展 `prompt_assembly.rs`**
   - `sample_prompt_assembly` → 产出 **per-section** `{id, chars, estimated_tokens}`，不再只 stable/runtime 两合计。
   - 新增 `estimate_tool_schemas(registry) -> { tools, mcp }`。
2. **在 `into_sdk_options` / 发消息路径旁路采样**（与真实注入同参数：repo、sandbox、digest、skills 是否启用）。
3. **conversation 残差**  
   `conversation = max(0, billed_prompt - sum(system+rules+skills+workspace+tools+mcp+runtime+summary))`  
   若 billed 尚未到达（采样早于 usage），先只报固定桶，usage 到达后再补残差（或完成时一次性算）。
4. **单测**：空仓库最小桶；含 GITEAM.md + skills；tools/mcp 拆分；残差非负。

## 前端改动

1. `AgentChatUsage` 旁增加可选 `contextBreakdown?: ContextBreakdown`。
2. `ContextOccupancyMeter` 浮层：
   - 顶栏：`percent` + `billedPrompt / contextWindow`（真实账单 prompt）
   - 进度条：可先单色；有分类后改为 **分段色条**（按 `estimatedTokens` 比例）
   - 列表：色点 + label + estimatedTokens（Cursor 风）
   - 脚注小字：`估计 · chars/4`；若 `|estimatedTotal - billedPrompt| > 阈值` 显示「与账单偏差」
3. 圆环仍只表示 `billedPrompt / contextWindow`（真实占用），不被估计值带偏。

## 分段色（临时）

与 Cursor 无需像素级一致，固定一张表即可：

| id | 色 |
|----|----|
| system | muted |
| rules | green |
| skills | orange |
| workspace | teal |
| tools | purple |
| mcp | pink |
| runtime | blue |
| summary | rose |
| conversation | indigo |

## 实施切片

### Slice 0 — 契约 + 装配 per-section（0.5–1d）

- Rust `ContextBreakdown` + `prompt_assembly` per-section
- 单测；尚未接 UI

### Slice 1 — 挂到消息 + 基础列表 UI（0.5–1d）

- 完成时写入 `contextBreakdown`
- Desktop 浮层列表（无分段条）
- 圆环继续用 billed prompt

### Slice 2 — 工具/MCP schema + 残差 conversation（0.5d）

- registry 扫描
- conversation 残差对齐 billed

### Slice 3 — 分段色条 + 偏差提示（0.5d）

- 顶栏 Progress 分段
- 估计 vs 账单提示

**临时版合计约 2–3 人日。**

## 风险

| 风险 | 缓解 |
|------|------|
| chars/4 与模型 token 偏差大 | UI 标明估计；圆环用 billed |
| pi Project Context 未计入 | 脚注「system 可能偏低」；残差进 conversation |
| 每轮扫描 registry 成本 | schema 字符串可按 enabled 工具集缓存 |
| 与现有 Input/Cache 行冲突 | 临时版浮层改为分类列表，去掉账单 Input/Output |

## 验收

1. 空会话首轮：可见 system / tools（及 rules/skills 若有），conversation 较小。
2. 多轮后：conversation 明显上升；圆环 % 仍跟 billed prompt。
3. 启用 MCP 后出现 `mcp` 行。
4. 估计合计与 billed prompt 同量级（残差法下应接近或相等）。
5. 无 modelId 时不出现 `$0.00`。

## 建议落地顺序

先做 **Slice 0 → 1** 即可「临时提一版」给内测；Slice 2/3 紧随，不必等分类精确再发。

## 实施记录（2026-11-17）

已落地完整版（Slice 0–3）：

- Rust：`context_breakdown.rs` + 挂到 `AgentMessage.contextBreakdown`；prompt 采样固定桶，完成时残差对齐 billed。
- Desktop：圆环仍用 billed prompt；浮层分段色条 + 分类列表 + `chars/4` 脚注。
- 单测：`pi_agent::context_breakdown` 3 项通过。

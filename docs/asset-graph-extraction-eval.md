# 资产图谱语义抽取评测（Extraction Eval)

> 目标：量化 extract 子代理的**准确度**（抽得对不对）与**能力边界**（什么情况下会失效），
> 不依赖生产接线——离线跑：生成 prompt → 喂任意模型 → 用生产同款 `parse_extraction`
> 解析 → 对照黄金答案打分。

## 运行方式

```bash
cd crates/giteam-core

# 1. 生成某个 case 的抽取 prompt（生产同款 build_prompt）
cargo run --example extraction_eval -- prompt eval/extraction/decision-basic.json

# 2. 把 prompt 喂给任意模型，把原始输出存成文本，然后打分
cargo run --example extraction_eval -- score eval/extraction/decision-basic.json /tmp/out.txt

# 3. 批量：对 eval/extraction/*.json，到 outputs/ 找同名 .txt 打分并出汇总报告
cargo run --example extraction_eval -- report eval/extraction outputs/
```

打分用的是 `giteam_core::asset_graph::semantic::parse_extraction`——和生产路径
完全同一份解析/白名单/锚点解析代码，所以测的是「模型输出质量 + 解析容错」的
真实组合，不是玩具副本。

## 评测维度与 case 矩阵

### 维度 1：实体类型覆盖（recall）

| case | 考察点 | 黄金答案要点 |
|---|---|---|
| `decision-basic` | decision 三要素 | category/scenario/reasoning 进 props;affects 边到文件 |
| `feature-implements` | feature + implements 边 | 边连到真实改动的文件 |
| `error-pattern` | error_pattern 抽象能力 | 抽「借用检查冲突」这个**语义类**，而不是把 `E0502` 原始报行当实体（forbidden_label) |
| `tradeoff` | tradeoff | chose/rejected/because 三字段齐全 |
| `open-task` | open_task | 未完成事项 |
| `module-located` | module + located_in | 跨文件结构概念，边到多个文件 |
| `api-exposes` | api + exposes | Tauri 命令作为接口面 |
| `tech-concept-i18n` | 中英混合 slug | slug 是小写连字符、跨语言稳定 |

### 维度 2：precision 保护（对抗 case，不该抽的不能抽）

| case | 考察点 |
|---|---|
| `chitchat-gate` | 门控：`user_text ≤ 4 字符` 时 `worth_extracting() == false`（根本不调 LLM) |
| `chitchat-empty` | 闲聊即便进了 LLM，也必须返回空实体（测试模型对 "NEVER invent" 的服从度） |
| `hallucination-bait` | 幻觉诱导：文件列表里有 `auth.rs` 但文本没提 → 不得给它连边；人名不得成实体 |

### 维度 3：能力边界（诊断已知弱点）

| case | 诊断什么 |
|---|---|
| `long-truncation` (xfail) | `build_prompt` 对 assistant_text 取**前** 1500 字符——结论在末尾时丢上下文。预期失败，用来验证/量化头截断问题 |
| `merge-slug-a` / `merge-slug-b` | slug 稳定性：同一概念两种措辞，跨 case 必须产出**同一个** `sem:*` key，否则跨会话合并失效（report 模式的 slug_group 检查） |

## 指标与建议门槛

| 指标 | 计算 | 建议门槛 |
|---|---|---|
| JSON 可解析率 | 模型输出能剥出合法 JSON 的比例 | ≥ 95%（低于此说明要加 response_format 或换模型） |
| 实体召回（类型级） | 期望实体中 type+slug 命中的比例 | ≥ 80% |
| 关系召回 | 期望关系中 type+两端命中的比例 | ≥ 70% |
| 字段完整率 | decision/tradeoff 必需 props 齐全率 | ≥ 80% |
| 幻觉率 | forbidden 边/实体出现率 | **0%**（硬门槛） |
| 闲聊空输出率 | chitchat 类 case 零实体比例 | 100% |
| slug 一致率 | slug_group 内 key 一致的比例 | ≥ 80%（低则说明需要规范 id 或后处理归一） |

## 端到端（接线后）补充

离线 eval 之外，真实链路用三层 case 交叉验证：

1. **mock host 集成测试**（建议补进 `extraction.rs` tests)：实现 `SubagentHost`
   返回固定 JSON → 喂合成 `TurnCompleted` → 断言 `sem:*` 落库、`semExtracted`
   打标、同 turn 不重抽、extract 子会话不递归。
2. **真实会话冒烟**：上一轮列的 B1–B7（决策/错误模式/功能/闲聊/幂等/跨会话合并）。
3. **线上抽查**：接线跑几天后 `SELECT key, label FROM nodes WHERE key LIKE 'sem:%'`
   人工审 20 条，标注「抽得对/抽得偏/幻觉」，回填成新 eval case——eval 集会随
   真实坏例持续长大。

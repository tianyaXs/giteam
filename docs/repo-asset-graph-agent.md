# 仓库资产 Agent（Repo Asset Graph）设计提案

> 目标：把 Giteam 中每个会话、每次执行（工具调用、文件修改、错误与修复、提交）沉淀为一张**可查询的资产图谱**，让后续会话能够回答「这个文件上次为什么被改」「这个错误之前怎么修的」「这个功能是在哪个会话里做的」。
>
> 参考项目：`semantica`（本机 `/Users/tianya/Documents/project/semantica`）。

---

## 0a. 从 Codegraph 借什么（`@colbymchenry/codegraph`）

Codegraph 证明了「SQLite 属性图 + 本地 watcher + MCP 工具面」这条路线可以做到生产级完善。它的关键实现（源码见 `~/.codegraph/versions/v0.9.4/lib/dist/`）：

| Codegraph 的做法 | 值得搬到资产图谱 |
|---|---|
| **Schema 工程**：`nodes`（kind/qualified_name/精确行列号/signature/docstring）+ `edges`（kind/metadata JSON/line/provenance）+ `files`（**content_hash** 增量）+ `unresolved_refs`（跨文件解析不了的引用单独存，不硬凑边）+ `nodes_fts`（FTS5 external-content 全文索引）+ `schema_versions` 迁移 | 直接采用这套表结构约定。我们的 `props JSON` 对应它的 `metadata`；`files.content_hash` 的增量思想用于存量会话回放去重；`unresolved_refs` 的「不硬凑边」原则用于错误指纹无法归一化的情况 |
| **增量同步双通道**：fs.watch recursive（~500ms 防抖）+ git hooks（post-commit/post-merge/post-checkout 后台 `codegraph sync`，marker 块注入、卸载保留用户内容） | 我们的数据源是事件流（天然增量），但**git hooks 通道必须借**：commit/checkout 后把 `Commit` 节点和当次会话关联起来，是"哪个会话产出了这个提交"的关键边 |
| **工具面设计（这是最值得抄的部分）**：① 一个 `context` 复合主工具——一次调用组合 search+node+callers+callees，目标"一次回答，无需后续 Read/Grep"；② `explore` 批量源码工具（明确反对循环单查）；③ `trace` 两点间调用路径（grep 结构性做不到的查询）；④ **MCP initialize 时下发 server-level instructions**：按意图选工具、常见链、反模式清单 | 资产图谱的 agent 工具照此组织：`asset_context`（复合：给一个任务描述→相关会话+改动文件+错误修复史一次返回）、`asset_trace`（从意图到提交的执行路径）、`asset_explore`（批量）、并把使用说明注入 pi agent 系统提示词（对应它的 SERVER_INSTRUCTIONS） |
| **混合检索 + 重排**：FTS5 + `lower(name)` 精确匹配 + 多通道分数取 max + 多词共现加分重排 | 用于 `search()`：文件路径/命令/错误文本多通道检索合并 |
| 生态位 | 它索引**代码结构**，我们索引**执行历史**——两者是互补的两张图，见 §8 |

## 0. 从 Semantica 借什么、不借什么

Semantica 是一套面向受监管行业的重量级 Python 图基础设施（RDF/LPG、Neo4j/AGE/FalkorDB 多后端、本体管理、因果推理）。**不要整体引入**——运行时栈不匹配（Giteam 是 Rust + Tauri + SQLite），且其体量远超本需求。

真正值得搬走的是四个设计决策：

| Semantica 的做法 | 搬到 Giteam |
|---|---|
| **确定性建图**：图谱构建不依赖 LLM，用规则从结构化数据抽三元组 | 从 `AgentEventEnvelope` 事件流用确定性规则建图，零额外 token 成本，100% 可复现 |
| **Provenance 内建**：每个节点/边都带来源追踪 | 每条边记录 `(session_id, run_id, event_id, sequence, timestamp)`，任何图事实可回放定位到原始事件 |
| **实体消解/去重**：同一实体多形态出现时合并而非堆噪 | 文件路径 canonicalize、命令归一化（`cargo build` / `cargo build --release` 分开但 `git status` 幂等合并）|
| **决策智能工具面**：`record_decision` / `query_decisions` / `find_precedents` / `get_causal_chain` | 直接借鉴这套 MCP 工具命名，作为图谱的查询接口暴露给 pi agent |

## 1. 数据源：你已经有了，不用新采集

Giteam 的 `pi_agent/events.rs` 已经定义了完整的结构化事件：

```
AgentEventEnvelope { event_id, sequence, repo_path, session_id, run_id, timestamp_ms, event }
AgentEvent::MessageCompleted { message }          // 用户意图 / 助手结论
AgentEvent::ToolStarted  { tool_call_id, tool_name, input }
AgentEvent::ToolCompleted { tool_call_id, tool_name, output, is_error }
AgentEvent::TurnStarted/Completed { index }
```

这就是图谱的原料。**不需要改 pi_agent 的执行路径**，只需要在事件消费侧加一个订阅者（复用 `subscribe_events_after` 的分发机制，在 `service.rs` 事件入 `EventRingBuffer` 的同一位置 fan-out 一份给资产图谱构建器）。

## 1a. 主场景：跨会话上下文注入（本图的第一消费者是 agent，不是人）

核心流程：**新会话的 agent 感知其他会话改过什么、当时为什么改**。

### 注入时机一：会话启动摘要（自动，零工具调用）

agent 启动时，`AssetGraph` 生成一份紧凑的「仓库近期演进摘要」注入系统提示词（预算 ~2KB，接在 `GITEAM.md` 项目记忆之后，复用 `project_memory.rs` 的注入机制）：

```
## 仓库近期变更上下文（来自资产图谱，其他会话的记录）

- [2h前] session a3f2「重构 control.rs 的事件分发」：改了 control.rs, events.rs；
  产出 commit 8c1e；曾遇 borrow-checker 错误，以 Rc<RefCell> 解决
- [昨天] session 91b7「给移动端加配对重试」：改了 pairing/, controlApi.ts；产出 commit 4d9a
- [3天前] session 5e02「修 SQLite 锁死」：改了 db.rs, service.rs；产出 commit b77f
```

只列**与本仓库相关且近期的**（默认 7 天 / 上次会话以来的增量），每条 = 意图（用户首条 Message 摘要）+ 改动文件集 + 产出提交 + 踩坑记录。这正是"快速了解当时那个 agent 的意图"的答案。

### 注入时机二：工作中按需查询（agent 工具）

agent 改某个文件前，主动调 `asset_context`：

- "我要改 `service.rs`" → 返回：该文件近 N 次被改的会话、每次的意图摘要、相关的未完成事项（会话有 `Error` 无 `resolved_by`）、依赖它的提交
- "我遇到错误 X" → 返回：`find_precedents`，其他会话怎么修过同类错误

### 图谱 schema 对此场景的针对性保证

- **意图可还原**：`Message(user) ──在 Turn 里──▶ ToolCall ──modified──▶ File` 这条链，保证任何文件改动都能回溯到当轮用户意图文本（而不只是 diff）
- **未闭环知识**：`Error` 无出边 `resolved_by` = 该会话没修完就结束——正是下个会话最该知道的事
- **摘要生成是确定性的**：启动摘要不调 LLM，直接从图上 SELECT + 截断，启动零开销零成本

---

## 2. 存储选型：SQLite 属性图，不引入图数据库

Semantica 支持 5 种图后端是因为它要服务企业既有设施；Giteam 是本地优先的桌面应用，`rusqlite` 已捆绑。一张 10 万级的节点/边表在 SQLite 上递归 CTE 完全够用（`WITH RECURSIVE` 做多跳遍历），且随仓库走、零运维。

新建 `asset_graph.db`（与 `client.db` 分离，属仓库级资产，放 `.giteam/` 下并确保 gitignore，与会话目录同级）：

```sql
-- 节点：统一属性图，type 区分
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,            -- 稳定 ID：类型 + canonical key 的 hash
  type TEXT NOT NULL,             -- session|run|turn|message|tool_call|file|dir|command|commit|branch|error|skill
  key TEXT NOT NULL,              -- canonical key（文件绝对路径 / commit sha / 命令归一化串）
  label TEXT,
  props TEXT NOT NULL DEFAULT '{}',  -- JSON
  first_seen_ms INTEGER, last_seen_ms INTEGER,
  UNIQUE(type, key)
);

-- 边：每条边 = 一个可回放的事实
CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  src_id TEXT NOT NULL REFERENCES nodes(id),
  dst_id TEXT NOT NULL REFERENCES nodes(id),
  type TEXT NOT NULL,             -- 见下方边类型表
  props TEXT NOT NULL DEFAULT '{}',
  -- provenance（Semantica 的核心思想）
  session_id TEXT, run_id TEXT, event_id TEXT, sequence INTEGER, timestamp_ms INTEGER
);
CREATE INDEX idx_edges_src ON edges(src_id, type);
CREATE INDEX idx_edges_dst ON edges(dst_id, type);
CREATE INDEX idx_edges_prov ON edges(session_id, sequence);
```

**写放大控制**：事件先写内存增量，turn 结束（`TurnCompleted`）时批量落库一次——工具调用的中间态不进图，只有完成态进图。

## 3. 图谱 Schema（第一版本体）

节点和边全部由**确定性规则**从事件中抽取：

```
Session ──has_run──▶ Run ──has_turn──▶ Turn ──has_message──▶ Message(user)   ← 意图
                                    Turn ──used_tool──▶ ToolCall
ToolCall ──read / modified / created──▶ File        ← 从 edit/read/write 工具 input 中解析路径
ToolCall ──executed──▶ Command                    ← 从 bash 工具 input 中归一化命令
ToolCall ──failed_with──▶ Error                   ← is_error=true 时，从 output 提取错误指纹（首行/错误码 hash）
ToolCall ──produced──▶ Commit                     ← 从 git commit 类工具 output 解析 sha
Error ──resolved_by──▶ ToolCall                   ← 同一 turn 内，failed 调用之后的下一个成功同工具调用
Message(assistant) ──mentions──▶ File/Commit      ← 简单路径/SHA 正则，不做语义抽取
File ──child_of──▶ Dir（可选，用于按目录聚合）
```

关键规则细节：

- **文件路径 canonicalize**（Semantica entity_resolver 的最小版）：相对/绝对/worktree 前缀统一，避免同一文件裂成多个节点。
- **错误指纹**：`is_error` 输出取首个非空行 + 归一化数字/路径 → hash 作为 Error 节点 key。这样「同样的编译错误」跨会话可命中同一节点，`resolved_by` 边自然形成「这个错之前怎么修的」查询。
- **Command 幂等合并**：`cargo build` 反复执行不产生新节点，只在边上累加计数（存 props）。

### 第二版：LLM 语义增强（M4，已落地）

**语义实体层**（实体边界参照 semantica：NER 类型体系 + `record_decision` 字段边界 + RELATIONSHIP_TYPES，适配仓库/会话域）：

| 实体 | 参照 | 含义 |
|---|---|---|
| `decision` | semantica Decision | 技术决策（category/scenario/reasoning/outcome/confidence 五字段全对齐） |
| `feature` | PRODUCT | 功能/需求 |
| `module` | 本域特化 | 跨文件代码结构概念 |
| `tech_concept` | CONCEPT | 技术名词 |
| `error_pattern` | 本域特化 | 语义错误类（error 指纹之上） |
| `api` | 本域特化 | 接口面（HTTP/Tauri command） |
| `tradeoff` | Decision.causal | 显式权衡（chose/rejected/because） |
| `open_task` | EVENT | 未完成事项 |

关系：`decided/rationale/affects/implements/located_in/involves/pattern_of/exposes/blocked_by/similar_to`（映射 AFFECTS/CAUSES/LOCATED_IN/SIMILAR_TO…），边类型带 `sem/` 前缀与过程层隔离。

**抽取管道**（`asset_graph/extraction.rs` + `stage1.rs`，对齐 Codex memories Phase 1）：
1. `TurnCompleted` flush 后收集本轮摘要；**热路径不调 LLM**：非真空 turn → `enqueue` 为 `pending`（**不**用寒暄正则判定价值）
2. Stage-1 worker 在 **仓库挂载 / 新会话 startup** 或 **Run 结束后 idle**（默认 90s，`GITEAM_MEMORY_MIN_IDLE_SECS`）claim pending；排除仍有 live 累积器的会话
3. Claim 后由 **抽取 agent**（ephemeral 无工具、同父模型、`EXTRACT_ROLE_RULES` + minimum-signal no-op）自行判定是否值得沉淀；默认 **Silent**（不往聊天流发 `memory.extraction.*`）
4. 空产出 = Codex `succeeded_no_output`（job=`done`，不落语义节点）；有产出才 `write_batch`；失败 job=`failed` 可重试
5. 防自递归：`is_extract_session`；同父串行锁；失败隔离主流程（§7）

语义节点 `node_type` 直接用实体类别（前端按类型分霓虹色）；`asset_search` 的类型白名单同步扩展 8 类。

**实体身份（Semantica-style normalize / resolve / merge）**：写入路径在 `asset_graph/entity.rs`——`normalize_name` 折叠空白/小写/首尾标点；同 type 下精确归一化命中优先，否则 Levenshtein ratio ≥ 0.88 归并到已有 canonical（`sem:{type}:{normalized}`）；props 固定带 `normalizedName` / `aliases`，confidence 取 max，字符串 keep_most_complete。不做 blocking / embedding ER / 独立冲突引擎。旧节点无 `normalizedName` 时 catalog 用 label 回填，下次 upsert 写齐。

## 4. 查询接口：三处暴露

### 4.1 Rust 内核 API（`asset_graph` 模块）

新模块 `crates/giteam-core/src/asset_graph/`（mod.rs / store.rs / extract.rs / query.rs / mod tests）：

```rust
pub struct AssetGraph { /* 持有 sqlite 连接 + 内存增量缓冲 */ }
impl AssetGraph {
    pub fn open(repo_path: &Path) -> Result<Self>;              // .giteam/asset_graph.db
    pub fn ingest_event(&mut self, env: &AgentEventEnvelope);    // 确定性抽取
    pub fn flush_turn(&mut self) -> Result<()>;                  // 批量落库
    // 查询（工具面组织借鉴 codegraph：复合 context 优先，单点查询补充）
    pub fn search(&self, q: &str, node_type: Option<&str>) -> Vec<NodeHit>;  // FTS5 + 精确名混合，多通道分数取 max
    pub fn build_context(&self, task: &str) -> TaskContext;      // 一次组合：相关会话 + 改动文件 + 错误修复史（对应 codegraph_context）
    pub fn trace(&self, from: &str, to: &str) -> Vec<PathHop>;   // 意图 Message → … → Commit 的执行路径（对应 codegraph_trace）
    pub fn file_history(&self, path: &Path) -> Vec<SessionHit>;
    pub fn find_precedents(&self, error_fingerprint: &str) -> Vec<ResolutionHit>;
    pub fn session_outline(&self, session_id: &str) -> GraphSummary;
    pub fn subgraph(&self, center: &str, hops: u32, limit: u32) -> Subgraph; // 可视化用
}
```

### 4.2 pi_agent 工具（agent 自助查询）

**注册路径**：在 `GiteamToolFactory::create_tool_registry`（`pi_agent/tools/mod.rs`）中按 `question`/`task` 等现有自定义工具的同一模式注册——实现 pi 的 `Tool` trait（`name()/description()/parameters()/execute()`），经统一的 ToolBudget 包装链注入。工具实现只读 SQLite（`Arc<Mutex<AssetGraph>>` 或每次开只读连接），无副作用、无审批需求（不走 ApprovalTool）。

工具面按 codegraph 的成熟模式组织（一个复合主工具 + 少量单点补充），共 5 个：

| 工具 | 输入 | 返回 | 对应需求 |
|---|---|---|---|
| `asset_context`（**主工具**） | `task`: 任务/文件/错误描述 | 相关会话（意图摘要+改动文件+产出提交）+ 该文件近期修改史 + 未闭环错误，一次组合返回 | "我要改 X，之前谁动过、为什么" |
| `asset_trace` | `from`（会话/消息）`to`（文件/提交） | 意图→工具调用→文件→提交 的执行路径链 | "当时的 agent 具体怎么做的" |
| `asset_search` | `query`, `type?` | 节点命中列表（文件/命令/错误/会话） | 单点定位 |
| `asset_precedents` | `error_text` | 同指纹错误的历史修复对（错误→修复动作→结果） | "这个错以前怎么修的" |
| `asset_record`（可选，唯一写工具） | `decision`, `rationale`, `refs` | 显式记 Decision 节点及关联 | agent 主动留下决策供后人查（对应 semantica `record_decision`） |

**description 即提示词**：每个工具的 description 按 codegraph 的写法包含「何时用 / 何时不用 / 优先用主工具」——例如 `asset_context` 注明"改任何文件前、遇到任何报错时先调此工具，不要直接盲改"。此外在 `prompt.rs` 的系统提示词里加一段简短使用说明（对应 codegraph 的 SERVER_INSTRUCTIONS）：工具选择按意图、反模式（不要用 grep 翻历史会话文件，图查询快且全）。

**护栏**：所有工具返回体设上限（如 ≤8KB，超限截断+提示用 `asset_search` 收窄），避免大结果撑爆上下文——复用 `tool_budget.rs` 的截断/落盘机制，超限内容落盘返回路径。

这是整个功能的价值闭环：**下一个会话的 agent 自己查图**，人不用干预。

### 4.3 Control HTTP API（前端可视化）

`control.rs` 加三个只读端点：

```
GET /api/v1/graph/summary                     // 节点/边统计
GET /api/v1/graph/search?q=&type=
GET /api/v1/graph/subgraph?center=&hops=&limit=
```

桌面端新组件 `components/agent/AssetGraphPanel.tsx`（Obsidian 式图谱视图）：

- **主体 `sigma.js`（WebGL 渲染）+ graphology + ForceAtlas2 布局**（选型已定，见 [ADR-0003](adr/0003-sigma-js-for-asset-graph-visualization.md)）：节点按类型着色（Session/Run/File/Error/Commit），支持点击下钻（File→文件历史、Error→修复先例、Session→会话回放复用现有事件回放链路）
- **实体优先总览（Semantica-style entity hub + session satellites）**：compact 外层以语义实体为一等公民（file/error/commit 不进外层，点会话下钻才见改动细节）；`turn -extracted→ entity` 上卷为 `session -mentions→ entity`，会话节点 props 标 `role: "satellite"`（前端实体更大、卫星更小）。仅保留「至少连到一个语义实体」或「有 touches/fixed 资产边」的会话；`quality=low` 且无实体连接的会话不进总览。实体↔实体边只保留抽取 LLM 产出的 `sem/*`（启发式补边默认关闭）。
- **抽取质量分级（LLM，非寒暄词表）**：抽取结果顶层 `quality`（high/medium/low）与可选 `priority`；`quality=low` 不写语义节点；仅 `quality=high` 或 `priority=high` 发 `memory.extraction` 完成卡。寒暄轮通常自然落成 low + 空实体；若 LLM 认为可沉淀（如「问候」意图实体）则允许产出。
- **同语义会话聚合（super-node，对齐 Kumu/Neptune）**：compact 总览按「与实体层共享的 `normalize_name`」（大小写/空白/首尾标点不敏感；归一化后**硬相等**才聚合，不做 0.88 模糊）把 ≥2 个同标题 session 折叠成一个 `session_group:*` 超节点，成员的 touches/fixed/语义边全部并到超节点上，拓扑不丢；单击即在图内展开成成员会话 + 各自触达的资产。无论成员是否有工具动作都聚合——「hi」问了 5 次、其中一次跑了工具，也仍然是一组。另外：抽取子代理会话（管道内部，标题以 `Extract semantic entities…` 开头）不进总览与搜索；无资产动作的新会话可标 `props.chitchat`，启动注入摘要同时跳过 chitchat 与 `quality=low`（优先列高质量实体，不让「你好」类噪声进 agent 上下文）。
- **布局缓存**：首次打开 ForceAtlas2 跑布局（sigma 生态自带 `graphology-layout-forceatlas2`，支持 WebWorker 后台计算不阻塞 UI），坐标存 `nodes.layout_x/layout_y` 落库，增量节点局部微调，避免每次重跑物理仿真
- **Obsidian 式交互**：局部子图按需展开（`subgraph(center, hops, limit)`，永远只渲染当前邻域数百节点）、悬浮高亮邻居/淡化无关、侧栏按类型过滤、时间轴滑块（边带 `timestamp_ms`）、搜索命中后相机飞到节点
- **性能边界**：WebGL 渲染单视图数千节点无压力（靠子图查询保证规模上限），无需 LOD 降级方案

## 5. 接入点与改动面

| 位置 | 改动 |
|---|---|
| `pi_agent/service.rs` | 事件入 ring buffer 处 fan-out 一份给 `AssetGraph::ingest_event`（`TurnCompleted` 触发 flush）；停机时 flush |
| `crates/giteam-core/src/asset_graph/`（新） | 存储 + 抽取 + 查询，纯增量，不动现有执行路径 |
| `control.rs` | 3 个只读 graph 端点 |
| `pi_agent/tools/`（新文件） | 2–3 个 agent 自助工具 |
| `apps/desktop/src/components/agent/`（新） | 图谱面板 + sigma.js / graphology 依赖 |

回放建图（存量会话）：`AssetGraph::rebuild_from_events()`，扫 `.giteam` 会话 JSONL 重建，首次启用时跑一次。

## 6. 实施顺序（每步独立可交付）

> **状态 2026-08：M1–M4 全部落地**（`crates/giteam-core/src/asset_graph/`，
> 33 个单测 + 真实存量回放验证：49 会话文件 → 931 节点/1124 边/43 会话意图/
> 110 文件/19 错误/39 修复链）。工具面 `asset_context`/`asset_search`/
> `asset_precedents` 已注册进 GiteamToolFactory 并入默认系统提示词；启动摘要
> 注入 `service.rs` append 段；live 事件经 `events.rs::publish_event` 旁路进图。
> M3 可视化：Control 只读端点（`/api/v1/graph/{summary,search,subgraph,sessions}`）
> + Tauri 命令（桌面直连）+ 右侧「资产图谱」tab（**sigma.js WebGL + ForceAtlas2**，
> semantica Knowledge Explorer 视觉语言：深空底/霓虹节点/focus 聚焦/LOD 标签）。
> M4 语义层：旁路 `run_extraction_completion`（ephemeral 无工具、一次 LLM）
> 按 semantica 实体边界抽取 8 类语义实体
> （decision/feature/module/tech_concept/error_pattern/api/tradeoff/open_task）
> 与 10 类语义关系，turn 边界异步入图；prompt 注入图中已有实体保 slug 稳定；
> 发 `memory.extraction.started|completed|failed`，桌面时间线以「写入记忆中 /
> 已写入记忆」标签展示（与探索/运行/重试同套 ActivityStatus）。
> 失败静默隔离主流程；空批次仍打 `semExtracted`。

1. **M1 — 落库**：asset_graph 模块 + 事件 fan-out + SQLite schema + 存量回放。验收：一条会话跑完，`nodes`/`edges` 内容符合预期。✅
2. **M2 — 查询**：Rust 查询 API + agent 工具。验收：新会话里问「X 文件上次为什么被改」，agent 调工具给出正确会话与理由。✅
3. **M3 — 可视化**：Control 端点 + 桌面图谱面板（sigma WebGL）。✅
4. **M4 — LLM 增强**：extract 子代理 turn 级语义抽取 + 实体丰富。✅（temporal 查询仍为可选项）

## 7. 风险与边界

- **体积**：图只存事实指纹（工具 input/output 不整存，存摘要/路径/SHA），单仓库预估 < 50MB/千会话；原始细节靠 provenance 回放事件流获取，不复制数据。
- **隐私**：`asset_graph.db` 在 `.giteam/` 且默认 gitignore（复用 `ensure_workspace_giteam_gitignore`）。
- **失败隔离**：图谱构建器的任何 panic/error 只记日志，绝不影响 agent 主流程（fan-out 处 `catch_unwind` 或返回 Result 忽略）。
- **不做的事**：不上外部图数据库、不做 RDF/本体编辑器、第一版不做 LLM 建图——这些是 semantica 面向企业场景的包袱，不是本需求要解决的问题。

## 8. 与 Codegraph 的关系：两张互补的图

Codegraph（`~/.codegraph`，本地已装 v0.9.4）回答「**代码是什么结构**」：symbol 调用图、impact 分析、trace。资产图谱回答「**代码为什么变成这样**」：哪个会话、什么意图、改了哪些文件、踩了什么坑、产出哪个提交。

两图天然可联（M4 可选）：

- 资产图谱的 `File` 节点 key 与 codegraph `files.path` 同构（仓库相对路径）；`ToolCall ──modified──▶ File` 边 join codegraph `contains/calls` 边，即可回答「这次会话改的函数，还被谁调用」（执行历史 × 结构影响面）。
- Codegraph 是读 `.codegraph/codegraph.db`（SQLite，better-sqlite3 写入），Rust 侧用 rusqlite 只读打开即可，零集成成本；注意它可能有 WAL，开 `readonly + immutable=false` 正常读。
- 进一步：在 giteam 内置 codegraph 的建图能力（它基于 web-tree-sitter WASM，纯 Node，可在 Desktop Host 侧作为子进程跑 `codegraph sync`），用户不需要单独安装。

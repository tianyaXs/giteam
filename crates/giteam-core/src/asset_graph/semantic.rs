//! 语义实体层：从会话内容提取的知识级实体/关系（区别于过程层的
//! session/tool_call/file 执行记录）。
//!
//! 实体边界参照 semantica（`utils/constants.py` 的 NER 类型 +
//! MCP `record_decision` 的字段边界 category/scenario/reasoning/outcome/
//! confidence），适配「代码仓库 + agent 会话」域：
//!
//! | 实体 | 对应 semantica | 本域含义 |
//! |---|---|---|
//! | decision | Decision（决策智能） | 技术决策（含取舍理由与结果） |
//! | feature | PRODUCT | 正在做的功能/需求 |
//! | module | —（本域特化） | 跨文件的代码结构概念 |
//! | tech_concept | CONCEPT | 技术名词（Tauri/SQLite/MCP…） |
//! | error_pattern | —（本域特化） | 语义错误类（区别于 error 指纹） |
//! | api | —（本域特化） | 接口面（HTTP 端点/Tauri 命令） |
//! | tradeoff | Decision.causal | 显式权衡（chose/rejected/because） |
//! | open_task | EVENT（未完结） | 未完成事项/已知问题 |
//!
//! 关系类型映射 semantica RELATIONSHIP_TYPES（affects≈AFFECTS、
//! pattern_of≈CAUSES、similar_to≈SIMILAR_TO、located_in≈LOCATED_IN）。
//!
//! 写入路径：extract 子代理输出的 JSON → [`parse_extraction`] →
//! [`semantic_batch`]（复用 store::FactBatch，语义节点 type 前缀
//! `sem:` 与过程层隔离；幂等由 store 的 upsert 保证）。

use serde_json::Value;

use super::entity::{
    self, catalog_from_node, merge_entity_props, resolve_entity, CatalogEntity,
};
use super::store::{EdgeFact, FactBatch, NodeFact};

/// 合法语义实体类型（`sem:` 前缀后的部分）。
pub const SEMANTIC_ENTITY_TYPES: [&str; 8] = [
    "decision",
    "feature",
    "module",
    "tech_concept",
    "error_pattern",
    "api",
    "tradeoff",
    "open_task",
];

/// 合法语义关系类型。
pub const SEMANTIC_RELATION_TYPES: [&str; 12] = [
    "decided",
    "rationale",
    "affects",
    "implements",
    "located_in",
    "involves",
    "pattern_of",
    "exposes",
    "blocked_by",
    "similar_to",
    // 决策/事实取代：subject（新）取代 object（旧）。检索默认排除被
    // 取代者（semantica include_superseded=False / Graphiti invalidation）。
    "supersedes",
    // 任务关闭：subject（完成证据：决策/功能/新任务/会话）关闭 object（open_task）。
    // 落库为 sem/closed_by(open_task → closer)；不删节点，读侧默认排除。
    "closes",
];

/// 抽取整轮质量档（LLM 自报；对齐 Semantica confidence 分档，非寒暄正则）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExtractionQuality {
    High,
    Medium,
    #[default]
    Low,
}

/// 抽取整轮优先级（高优先才强调记忆事件渲染）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExtractionPriority {
    High,
    #[default]
    Normal,
    Low,
}

impl ExtractionQuality {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
        }
    }

    #[must_use]
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("high") => Self::High,
            Some("medium") | Some("med") => Self::Medium,
            Some("low") => Self::Low,
            _ => Self::Low,
        }
    }
}

impl ExtractionPriority {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Normal => "normal",
            Self::Low => "low",
        }
    }

    #[must_use]
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("high") => Self::High,
            Some("low") => Self::Low,
            _ => Self::Normal,
        }
    }
}

/// 抽取输出解析后的语义事实（实体 + 关系，带 provenance）。
#[derive(Debug, Default, Clone)]
pub struct SemanticExtraction {
    pub batch: FactBatch,
    pub entity_count: usize,
    pub relation_count: usize,
    /// 提炼后的会话意图（≤80 字符，semantica scenario 思路：存提炼描述
    /// 而非首条用户消息原文），由调用方写回 session 节点 props.intent。
    pub intent: Option<String>,
    /// 入图实体摘要（UI 预览；与 batch.nodes 顺序一致，已截断）。
    pub entity_summaries: Vec<(String, String)>,
    /// 整轮质量（写入 session.props.quality；low 不落语义节点）。
    pub quality: ExtractionQuality,
    /// 整轮优先级（high 时即使 medium 质量也可发记忆事件）。
    pub priority: ExtractionPriority,
}

impl SemanticExtraction {
    /// 是否写入语义实体/关系（low = 不写）。
    #[must_use]
    pub fn should_write_semantics(&self) -> bool {
        self.quality != ExtractionQuality::Low
    }

    /// 是否向聊天流发记忆完成卡（仅 high 质量或 high 优先）。
    #[must_use]
    pub fn should_emit_memory_event(&self) -> bool {
        self.quality == ExtractionQuality::High || self.priority == ExtractionPriority::High
    }
}

/// 实体/关系置信度下限：低于此值的猜测直接丢弃（对齐 Semantica
/// ExtractionValidator 的 confidence 阈值思想；取 0.4 保 recall）。
const MIN_CONFIDENCE: f64 = 0.4;

/// 无 evidence 时的豁免门槛（Semantica：高置信才可过门；默认仍要求 verbatim 证据）。
const EVIDENCE_EXEMPT_CONFIDENCE: f64 = 0.85;


/// 同 type 近名归并阈值（Semantica dedup 轻量版；略宽于跨 turn catalog fuzzy）。
const NEAR_DUP_FUZZY_RATIO: f64 = 0.82;

/// 单 turn 落库实体上限（open_task 优先保留，其余按 confidence 截断）。
const MAX_ENTITIES_PER_TURN: usize = 10;

/// 解析 extract 子代理的 JSON 输出。
///
/// 容错策略：剥 ```json 围栏、截取首个 `{` 到末个 `}`（模型偶发前后缀散文）；
/// 未知实体/关系类型丢弃（不硬凑，codegraph unresolved_refs 原则）；
/// 关系两端必须在实体集或输入给定的锚点（file 路径/session）中，否则丢。
///
/// 质量门槛（对齐 Semantica 的边界控制）：
/// - confidence < [`MIN_CONFIDENCE`] 的实体/关系丢弃；
/// - evidence 默认必填且须为输入文本逐字引用（Semantica temporal_source_text）；
///   仅当 confidence ≥ [`EVIDENCE_EXEMPT_CONFIDENCE`] 才允许缺 evidence；
/// - 自环关系（src == dst）丢弃；未知关系类型丢弃（不降级 related_to）。
///
/// 身份归并（Semantica normalize/resolve/merge 轻量版）：
/// - 批内先 resolve，再对 `catalog` resolve；
/// - props 写入 `normalizedName` / `aliases`。
///
/// 质量分级（LLM 自报 `quality`/`priority`，非寒暄正则）：
/// - `quality=low` → 清空实体/关系，不落语义图；`session_intent` 仍保留作会话标题；
/// - 未给 `quality` 时：有实体则按最高 confidence 推断，否则 low。
pub fn parse_extraction(
    raw: &str,
    anchors: &ExtractionAnchors,
    catalog: &[CatalogEntity],
) -> SemanticExtraction {
    let mut out = SemanticExtraction::default();
    let Some(json_text) = extract_json_object(raw) else {
        return out;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&json_text) else {
        return out;
    };

    out.priority = ExtractionPriority::parse(parsed.get("priority").and_then(Value::as_str));
    out.quality = match parsed.get("quality").and_then(Value::as_str) {
        Some(q) => ExtractionQuality::parse(Some(q)),
        None => ExtractionQuality::Low, // 解析完实体后再按 confidence 回填
    };

    // 会话标题与耐久语义解耦：即使 quality=low 也保留 session_intent，供图谱节点命名。
    out.intent = parsed
        .get("session_intent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| s.chars().count() >= 2)
        .map(|s| snippet(s, 80));

    // 低质量整轮：不沉淀语义实体（仍可由调用方写 session.props.quality / 写回意图标题）。
    if matches!(
        parsed.get("quality").and_then(Value::as_str).map(str::trim),
        Some("low")
    ) {
        return out;
    }

    // 实体 → sem:<type> 节点；key = `sem:{type}:{normalize(name)}`（fuzzy 命中复用已有）。
    let mut valid_keys: Vec<String> = Vec::new();
    let mut ref_index: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut in_batch: Vec<CatalogEntity> = Vec::new();

    // 先登记 catalog：closes/supersedes 可引用既有实体，无需本轮重发（Graphiti 式
    // episode 对照既有边）。retired 实体已在 load_entity_catalog 过滤。
    seed_catalog_refs(catalog, &mut valid_keys, &mut ref_index);

    if let Some(entities) = parsed.get("entities").and_then(Value::as_array) {
        for entity in entities.iter().take(20) {
            let Some(etype) = entity.get("type").and_then(Value::as_str) else {
                continue;
            };
            if !SEMANTIC_ENTITY_TYPES.contains(&etype) {
                continue;
            }
            let conf = confidence_of(entity);
            if conf.is_some_and(|c| c < MIN_CONFIDENCE) {
                continue;
            }
            let evidence = entity
                .get("evidence")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|e| !e.is_empty());
            if !evidence_acceptable(evidence, conf, anchors) {
                continue;
            }

            let id_raw = entity
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let title_raw = entity
                .get("title")
                .or_else(|| entity.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            // 身份名：title/name 优先，否则 id（与展示名一致时便于归并）。
            let identity_name = title_raw.or(id_raw).unwrap_or("");
            if identity_name.is_empty() {
                continue;
            }

            let mut props = serde_json::Map::new();
            for field in [
                "category",
                "scenario",
                "reasoning",
                "outcome",
                "confidence",
                "chose",
                "rejected",
                "because",
                "description",
                "evidence",
            ] {
                if let Some(value) = entity.get(field) {
                    if let Some(text) = value.as_str() {
                        if !text.trim().is_empty() {
                            props.insert(field.to_string(), Value::String(snippet(text, 500)));
                        }
                    } else if value.is_number() {
                        props.insert(field.to_string(), value.clone());
                    }
                }
            }
            let raw_label = title_raw.unwrap_or(identity_name).to_string();
            let display_label = humanize_entity_label(etype, &raw_label, &props);

            // open_task：探索问法多样，优先 fuzzy 命中已有 canonical（catalog/批内）。
            let resolved = if etype == "open_task" {
                let norm = entity::normalize_name(identity_name);
                if let Some(existing_key) = find_matching_open_task_key(
                    identity_name,
                    &norm,
                    &out.batch.nodes,
                    catalog,
                ) {
                    if let Some(entry) = catalog.iter().find(|e| e.key == existing_key) {
                        entity::ResolvedEntity {
                            key: entry.key.clone(),
                            label: entry.label.clone(),
                            normalized_name: entry.normalized_name.clone(),
                            aliases_to_add: vec![identity_name.to_string()],
                            existing_props: Some(entry.props.clone()),
                        }
                    } else if let Some(node) = out.batch.nodes.iter().find(|n| n.key == existing_key)
                    {
                        entity::ResolvedEntity {
                            key: node.key.clone(),
                            label: node.label.clone(),
                            normalized_name: node
                                .props
                                .get("normalizedName")
                                .and_then(Value::as_str)
                                .map(entity::normalize_name)
                                .unwrap_or_else(|| entity::normalize_name(&node.label)),
                            aliases_to_add: vec![identity_name.to_string()],
                            existing_props: Some(node.props.clone()),
                        }
                    } else {
                        resolve_entity(etype, identity_name, catalog, &in_batch)
                    }
                } else {
                    resolve_entity(etype, identity_name, catalog, &in_batch)
                }
            } else {
                resolve_entity(etype, identity_name, catalog, &in_batch)
            };
            if resolved.normalized_name.is_empty() {
                continue;
            }

            props.insert(
                "normalizedName".into(),
                Value::String(resolved.normalized_name.clone()),
            );
            let mut aliases: Vec<String> = resolved.aliases_to_add.clone();
            if let Some(id) = id_raw {
                if id != display_label
                    && id != identity_name
                    && !aliases.iter().any(|a| a == id)
                {
                    aliases.push(id.to_string());
                }
                // id 本身也常是别名（与 normalize 不同时）
                if id != resolved.normalized_name && !aliases.iter().any(|a| a == id) {
                    aliases.push(id.to_string());
                }
            }
            if !aliases.is_empty() {
                props.insert(
                    "aliases".into(),
                    Value::Array(aliases.iter().cloned().map(Value::String).collect()),
                );
            }

            let incoming_props = Value::Object(props);
            let merged_props = if let Some(existing) = &resolved.existing_props {
                merge_entity_props(existing, &incoming_props)
            } else {
                incoming_props
            };

            let Some(node_type) = static_entity_type(etype) else {
                continue;
            };
            let key = resolved.key.clone();

            // 批内已有同一 key → 合并 props，不新建节点。
            if let Some(idx) = out.batch.nodes.iter().position(|n| n.key == key) {
                let node = &mut out.batch.nodes[idx];
                node.props = merge_entity_props(&node.props, &merged_props);
                node.label = prefer_display_label(&node.label, &display_label);
                if let Some(entry) = in_batch.iter_mut().find(|e| e.key == key) {
                    entry.label = node.label.clone();
                    entry.props = node.props.clone();
                    entry.aliases = entity::catalog_from_node(
                        etype,
                        &key,
                        &node.label,
                        &node.props,
                    )
                    .aliases;
                }
            } else {
                out.batch.nodes.push(NodeFact {
                    node_type,
                    key: key.clone(),
                    label: prefer_display_label(&resolved.label, &display_label),
                    props: merged_props.clone(),
                    timestamp_ms: anchors.timestamp_ms,
                });
                if let Some(turn_key) = &anchors.turn_key {
                    out.batch.edges.push(edge_fact(
                        turn_key,
                        &key,
                        "extracted",
                        anchors,
                        None,
                    ));
                }
                in_batch.push(catalog_from_node(
                    etype,
                    &key,
                    &prefer_display_label(&resolved.label, &display_label),
                    &merged_props,
                ));
                valid_keys.push(key.clone());
                out.entity_count += 1;
                if out.entity_summaries.len() < 8 {
                    out.entity_summaries.push((
                        etype.to_string(),
                        prefer_display_label(&resolved.label, &display_label),
                    ));
                }
            }

            // 关系引用索引：id / title / normalize / 旧式 slug。
            register_ref(&mut ref_index, &key, identity_name);
            register_ref(&mut ref_index, &key, &display_label);
            if let Some(id) = id_raw {
                register_ref(&mut ref_index, &key, id);
                let slug = slugify(id);
                if !slug.is_empty() {
                    register_ref(&mut ref_index, &key, &slug);
                }
            }
            register_ref(&mut ref_index, &key, &resolved.normalized_name);
            for a in aliases {
                register_ref(&mut ref_index, &key, &a);
            }
        }
    }

    consolidate_open_tasks_in_batch(&mut out);
    consolidate_near_duplicate_entities(&mut out);
    let _ = demote_incomplete_decisions(&mut out.batch); // schema 完备度：缺字段 → feature

    // 关系：src/dst 可以是实体 slug/标题或锚点（file:/session:/turn: 前缀）。
    if let Some(relations) = parsed.get("relations").and_then(Value::as_array) {
        for relation in relations.iter().take(30) {
            let Some(rtype_raw) = relation.get("type").and_then(Value::as_str) else {
                continue;
            };
            let rtype = normalize_relation_type(rtype_raw);
            if !SEMANTIC_RELATION_TYPES.contains(&rtype) {
                continue;
            }
            let conf = confidence_of(relation);
            if conf.is_some_and(|c| c < MIN_CONFIDENCE) {
                continue;
            }
            let evidence = relation
                .get("evidence")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|e| !e.is_empty());
            if !evidence_acceptable(evidence, conf, anchors) {
                continue;
            }
            let Some(src) = relation
                .get("subject")
                .or_else(|| relation.get("source"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Some(dst) = relation
                .get("object")
                .or_else(|| relation.get("target"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Some(src_key) = resolve_ref(src, &valid_keys, &ref_index, anchors) else {
                continue;
            };
            let Some(dst_key) = resolve_ref(dst, &valid_keys, &ref_index, anchors) else {
                continue;
            };
            if src_key == dst_key {
                continue;
            }
            if !relation_endpoints_sensible(rtype, &src_key, &dst_key, &out.batch) {
                continue;
            }
            if rtype == "supersedes" {
                // supersedes(new→old) → sem/superseded_by(old→new)
                out.batch
                    .edges
                    .push(edge_fact(&dst_key, &src_key, "superseded_by", anchors, evidence));
            } else if rtype == "closes" {
                // closes(closer→open_task) → sem/closed_by(open_task→closer)
                out.batch
                    .edges
                    .push(edge_fact(&dst_key, &src_key, "closed_by", anchors, evidence));
            } else {
                out.batch
                    .edges
                    .push(edge_fact(&src_key, &dst_key, rtype, anchors, evidence));
            }
            out.relation_count += 1;
        }
    }

    // Graphiti 式废止副作用：写边后给被取代/关闭节点打 status（不删除历史）。
    apply_lifecycle_side_effects(&mut out.batch, anchors);

    // 关系落定后再做锚点门控：无代码/模块端点的 error_pattern 不可沉淀（机制，非工具名黑名单）。
    let dropped_errors = filter_unanchored_error_patterns(&mut out.batch);
    if dropped_errors > 0 {
        out.entity_count = out.entity_count.saturating_sub(dropped_errors);
    }

    // 未显式给 quality：按实体最高 confidence 推断（Semantica 分档思路）。
    if parsed.get("quality").and_then(Value::as_str).is_none() {
        let max_conf = out
            .batch
            .nodes
            .iter()
            .filter_map(|n| n.props.get("confidence").and_then(Value::as_f64))
            .fold(0.0_f64, f64::max);
        out.quality = if out.entity_count == 0 {
            ExtractionQuality::Low
        } else if max_conf >= 0.8 {
            ExtractionQuality::High
        } else if max_conf >= 0.5 {
            ExtractionQuality::Medium
        } else {
            ExtractionQuality::Low
        };
    }

    // quality=low（推断或显式）：丢弃语义实体写入，但保留 session_intent 作会话标题。
    if out.quality == ExtractionQuality::Low {
        out.batch = FactBatch::default();
        out.entity_count = 0;
        out.relation_count = 0;
        out.entity_summaries.clear();
        return out;
    }

    // session_intent：仅在「尚无耐久实体、且无 open_task」时升格为 open_task。
    // 已有 decision/feature/tradeoff 等时，intent 只挂 extracted 到主实体，避免决策轮再造孤立待办。
    if let Some(intent) = out.intent.clone() {
        ensure_intent_open_task(&mut out, &intent, anchors, catalog, &in_batch);
    }

    consolidate_open_tasks_in_batch(&mut out);
    attach_orphan_open_tasks(&mut out, anchors);
    attach_cooccurring_orphans(&mut out, anchors);
    prune_redundant_intent_open_tasks(&mut out);
    ensure_process_anchors(&mut out, anchors);
    trim_entities_if_needed(&mut out);

    // 实体↔实体关系仍以 LLM 为主；仅对仍存活的孤立 open_task 做 involves 兜底挂接。
    out
}

/// 耐久知识实体：有它们时 session_intent 不应再额外造 open_task。
fn has_durable_entities(nodes: &[NodeFact]) -> bool {
    nodes.iter().any(|n| {
        matches!(
            n.node_type,
            "decision" | "feature" | "tradeoff" | "api" | "error_pattern" | "module"
        )
    })
}

fn pick_primary_entity_key(nodes: &[NodeFact]) -> Option<String> {
    const RANK: &[&str] = &[
        "decision",
        "feature",
        "tradeoff",
        "open_task",
        "api",
        "error_pattern",
        "module",
        "tech_concept",
    ];
    let mut best: Option<(usize, f64, String)> = None;
    for n in nodes {
        let Some(rank) = RANK.iter().position(|t| *t == n.node_type) else {
            continue;
        };
        let conf = n
            .props
            .get("confidence")
            .and_then(Value::as_f64)
            .unwrap_or(0.5);
        let replace = match &best {
            None => true,
            Some((br, bc, _)) => rank < *br || (rank == *br && conf > *bc),
        };
        if replace {
            best = Some((rank, conf, n.key.clone()));
        }
    }
    best.map(|(_, _, k)| k)
}

/// 将 `session_intent` 有条件落实为 `open_task`（或挂到已有主实体）。
fn ensure_intent_open_task(
    out: &mut SemanticExtraction,
    intent: &str,
    anchors: &ExtractionAnchors,
    catalog: &[CatalogEntity],
    in_batch: &[CatalogEntity],
) {
    let trimmed = intent.trim();
    if trimmed.chars().count() < 4 {
        return;
    }
    let norm_intent = entity::normalize_name(trimmed);
    if norm_intent.is_empty() {
        return;
    }

    if let Some(existing_key) =
        find_matching_open_task_key(trimmed, &norm_intent, &out.batch.nodes, catalog)
    {
        link_turn_extracted(out, anchors, &existing_key, trimmed);
        return;
    }

    // 已有 open_task：只挂 provenance，不造平行待办。
    if let Some(existing) = out.batch.nodes.iter().find(|n| n.node_type == "open_task") {
        let key = existing.key.clone();
        link_turn_extracted(out, anchors, &key, trimmed);
        return;
    }

    // 已有耐久实体：intent 挂到主实体，不升格成 open_task（根因：决策轮膨胀孤立待办）。
    if has_durable_entities(&out.batch.nodes) {
        if let Some(primary) = pick_primary_entity_key(&out.batch.nodes) {
            link_turn_extracted(out, anchors, &primary, trimmed);
        }
        return;
    }

    let resolved = resolve_entity("open_task", trimmed, catalog, in_batch);
    if resolved.normalized_name.is_empty() {
        return;
    }
    let display = snippet(trimmed, 80);
    let props = serde_json::json!({
        "normalizedName": resolved.normalized_name,
        "source": "session_intent",
        "confidence": 0.75,
    });

    if !out.batch.nodes.iter().any(|n| n.key == resolved.key) {
        out.batch.nodes.push(NodeFact {
            node_type: "open_task",
            key: resolved.key.clone(),
            label: prefer_display_label(&resolved.label, &display),
            props,
            timestamp_ms: anchors.timestamp_ms,
        });
        out.entity_count += 1;
        if out.entity_summaries.len() < 8 {
            out.entity_summaries
                .push(("open_task".to_string(), display.clone()));
        }
    }
    link_turn_extracted(out, anchors, &resolved.key, trimmed);
}

/// 无 sem/* 邻居的 open_task：挂到同批最相关耐久实体（involves）。
fn attach_orphan_open_tasks(out: &mut SemanticExtraction, anchors: &ExtractionAnchors) {
    let linked: std::collections::HashSet<String> = out
        .batch
        .edges
        .iter()
        .filter(|e| e.edge_type.starts_with("sem/"))
        .flat_map(|e| [e.src_key.clone(), e.dst_key.clone()])
        .collect();
    let peers: Vec<(String, &'static str, f64)> = out
        .batch
        .nodes
        .iter()
        .filter(|n| {
            matches!(
                n.node_type,
                "decision" | "feature" | "module" | "tech_concept" | "api" | "tradeoff" | "error_pattern"
            )
        })
        .map(|n| {
            (
                n.key.clone(),
                n.node_type,
                n.props
                    .get("confidence")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5),
            )
        })
        .collect();
    if peers.is_empty() {
        return;
    }
    let orphans: Vec<String> = out
        .batch
        .nodes
        .iter()
        .filter(|n| n.node_type == "open_task" && !linked.contains(&n.key))
        .map(|n| n.key.clone())
        .collect();
    for task_key in orphans {
        let Some((peer_key, _, _)) = peers.iter().max_by(|a, b| {
            a.2.partial_cmp(&b.2)
                .unwrap_or(std::cmp::Ordering::Equal)
        }) else {
            break;
        };
        if batch_has_edge(&out.batch, &task_key, peer_key, "sem/involves") {
            continue;
        }
        out.batch.edges.push(edge_fact(
            &task_key,
            peer_key,
            "involves",
            anchors,
            Some("co-occurring entities in same turn"),
        ));
        out.relation_count += 1;
    }
}

/// 同批共现但仍无「实体↔实体」sem 边的 tech_concept/module/feature：挂到主决策/功能/取舍。
/// 仅有 located_in→file 不算已关联（compact 总览不画文件，否则会留下视觉孤点）。
fn attach_cooccurring_orphans(out: &mut SemanticExtraction, anchors: &ExtractionAnchors) {
    let sem_keys: std::collections::HashSet<String> = out
        .batch
        .nodes
        .iter()
        .filter(|n| SEMANTIC_ENTITY_TYPES.contains(&n.node_type))
        .map(|n| n.key.clone())
        .collect();
    let mut linked: std::collections::HashSet<String> = out
        .batch
        .edges
        .iter()
        .filter(|e| {
            e.edge_type.starts_with("sem/")
                && sem_keys.contains(&e.src_key)
                && sem_keys.contains(&e.dst_key)
        })
        .flat_map(|e| [e.src_key.clone(), e.dst_key.clone()])
        .collect();

    let hubs: Vec<(String, &'static str, f64)> = out
        .batch
        .nodes
        .iter()
        .filter(|n| {
            matches!(
                n.node_type,
                "decision" | "feature" | "tradeoff" | "open_task" | "api"
            )
        })
        .map(|n| {
            (
                n.key.clone(),
                n.node_type,
                n.props
                    .get("confidence")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5),
            )
        })
        .collect();
    if hubs.is_empty() {
        // 无 hub 时：孤立 module 之间互挂 involves，避免 module-only 批变成全散点。
        let mods: Vec<String> = out
            .batch
            .nodes
            .iter()
            .filter(|n| n.node_type == "module" && !linked.contains(&n.key))
            .map(|n| n.key.clone())
            .collect();
        if let Some(primary) = mods.first() {
            for m in mods.iter().skip(1) {
                if batch_has_edge(&out.batch, primary, m, "sem/involves") {
                    continue;
                }
                out.batch.edges.push(edge_fact(
                    primary,
                    m,
                    "involves",
                    anchors,
                    Some("co-occurring modules in same turn"),
                ));
                out.relation_count += 1;
                linked.insert(m.clone());
            }
        }
        return;
    }

    let orphans: Vec<(String, &'static str)> = out
        .batch
        .nodes
        .iter()
        .filter(|n| {
            matches!(n.node_type, "tech_concept" | "module" | "feature" | "api")
                && !linked.contains(&n.key)
        })
        .map(|n| (n.key.clone(), n.node_type))
        .collect();

    for (orphan_key, orphan_ty) in orphans {
        let Some((hub_key, hub_ty, _)) = hubs
            .iter()
            .filter(|(k, _, _)| k != &orphan_key)
            .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
        else {
            continue;
        };

        let (rtype, src, dst) = match (*hub_ty, orphan_ty) {
            ("decision", "tech_concept" | "module" | "api" | "feature") => {
                ("decided", hub_key.as_str(), orphan_key.as_str())
            }
            ("tradeoff", "tech_concept" | "decision" | "feature") => {
                ("rationale", orphan_key.as_str(), hub_key.as_str())
            }
            ("api", "module" | "feature") => ("exposes", hub_key.as_str(), orphan_key.as_str()),
            ("feature" | "open_task", _) => ("involves", hub_key.as_str(), orphan_key.as_str()),
            _ => ("involves", hub_key.as_str(), orphan_key.as_str()),
        };

        let edge_name = semantic_edge_type(rtype);
        if batch_has_edge(&out.batch, src, dst, edge_name)
            || batch_has_edge(&out.batch, dst, src, edge_name)
        {
            continue;
        }
        if !relation_endpoints_sensible(rtype, src, dst, &out.batch) {
            if rtype != "involves"
                && relation_endpoints_sensible("involves", hub_key, &orphan_key, &out.batch)
                && !batch_has_edge(&out.batch, hub_key, &orphan_key, "sem/involves")
            {
                out.batch.edges.push(edge_fact(
                    hub_key,
                    &orphan_key,
                    "involves",
                    anchors,
                    Some("co-occurring orphans in same turn"),
                ));
                out.relation_count += 1;
                linked.insert(orphan_key);
            }
            continue;
        }
        out.batch.edges.push(edge_fact(
            src,
            dst,
            rtype,
            anchors,
            Some("co-occurring orphans in same turn"),
        ));
        out.relation_count += 1;
        linked.insert(orphan_key);
    }
}

/// 丢掉仍无 sem/* 边、且 source=session_intent 的冗余 open_task（同批已有其它实体时）。
fn prune_redundant_intent_open_tasks(out: &mut SemanticExtraction) {
    let other_count = out
        .batch
        .nodes
        .iter()
        .filter(|n| n.node_type != "open_task")
        .count();
    if other_count == 0 {
        return;
    }
    let linked: std::collections::HashSet<String> = out
        .batch
        .edges
        .iter()
        .filter(|e| e.edge_type.starts_with("sem/"))
        .flat_map(|e| [e.src_key.clone(), e.dst_key.clone()])
        .collect();
    let drop_keys: Vec<String> = out
        .batch
        .nodes
        .iter()
        .filter(|n| {
            n.node_type == "open_task"
                && !linked.contains(&n.key)
                && n.props.get("source").and_then(Value::as_str) == Some("session_intent")
        })
        .map(|n| n.key.clone())
        .collect();
    if drop_keys.is_empty() {
        return;
    }
    let drop_set: std::collections::HashSet<String> = drop_keys.into_iter().collect();
    let removed = drop_set.len();
    out.batch.nodes.retain(|n| !drop_set.contains(&n.key));
    out.batch
        .edges
        .retain(|e| !drop_set.contains(&e.src_key) && !drop_set.contains(&e.dst_key));
    out.entity_count = out.entity_count.saturating_sub(removed);
    out.entity_summaries.retain(|(ty, title)| {
        *ty != "open_task"
            || out
                .batch
                .nodes
                .iter()
                .any(|n| n.node_type == "open_task" && (n.label == *title || n.label.contains(title)))
    });
}

/// 为 extracted 边物化 turn/session 过程节点，避免 write_batch 因缺端点静默丢边。
fn ensure_process_anchors(out: &mut SemanticExtraction, anchors: &ExtractionAnchors) {
    let Some(turn_key) = anchors.turn_key.as_deref() else {
        return;
    };
    let needs_turn = out
        .batch
        .edges
        .iter()
        .any(|e| e.edge_type == "extracted" && (e.src_key == turn_key || e.dst_key == turn_key));
    if !needs_turn {
        return;
    }
    if !out.batch.nodes.iter().any(|n| n.key == turn_key) {
        out.batch.nodes.push(NodeFact {
            node_type: "turn",
            key: turn_key.to_string(),
            label: snippet(
                out.intent.as_deref().unwrap_or("extraction turn"),
                80,
            ),
            props: serde_json::json!({
                "source": "llm_extraction",
                "synthetic": true,
            }),
            timestamp_ms: anchors.timestamp_ms,
        });
    }
    let session_key = anchors.session_key.as_str();
    if !session_key.is_empty() && !out.batch.nodes.iter().any(|n| n.key == session_key) {
        out.batch.nodes.push(NodeFact {
            node_type: "session",
            key: session_key.to_string(),
            label: snippet(
                out.intent.as_deref().unwrap_or("extraction session"),
                80,
            ),
            props: serde_json::json!({
                "source": "llm_extraction",
                "synthetic": true,
            }),
            timestamp_ms: anchors.timestamp_ms,
        });
    }
    if !session_key.is_empty()
        && !batch_has_edge(&out.batch, session_key, turn_key, "has_turn")
        && !out
            .batch
            .edges
            .iter()
            .any(|e| e.src_key == session_key && e.dst_key == turn_key && e.edge_type == "has_turn")
    {
        // has_turn 是过程边：不走 sem/ 映射。
        out.batch.edges.push(EdgeFact {
            src_key: session_key.to_string(),
            dst_key: turn_key.to_string(),
            edge_type: "has_turn",
            props: serde_json::json!({"source": "llm_extraction"}),
            session_id: anchors.session_id.clone(),
            run_id: anchors.run_id.clone(),
            event_id: anchors.event_id.clone(),
            sequence: anchors.sequence,
            timestamp_ms: anchors.timestamp_ms,
        });
    }
}

fn find_matching_open_task_key(
    intent: &str,
    norm_intent: &str,
    batch_nodes: &[NodeFact],
    catalog: &[CatalogEntity],
) -> Option<String> {
    for node in batch_nodes {
        if node.node_type != "open_task" {
            continue;
        }
        let node_norm = node
            .props
            .get("normalizedName")
            .and_then(Value::as_str)
            .map(entity::normalize_name)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| entity::normalize_name(&node.label));
        if open_task_matches_intent(intent, norm_intent, &node_norm, &node.label) {
            return Some(node.key.clone());
        }
    }
    for entry in catalog {
        if entry.entity_type != "open_task" {
            continue;
        }
        if open_task_matches_intent(intent, norm_intent, &entry.normalized_name, &entry.label) {
            return Some(entry.key.clone());
        }
    }
    None
}

fn open_task_matches_intent(intent: &str, _norm_intent: &str, node_norm: &str, node_label: &str) -> bool {
    open_task_labels_similar(intent, node_label) || open_task_labels_similar(intent, node_norm)
}

/// open_task 相似度：类型策略（宽 fuzzy + 去话语停用词后的内容 Jaccard + 方面冲突）。
/// 不依赖领域词表（番茄钟/pomodoro…）；同义靠 catalog 复用与内容词重叠。
fn open_task_labels_similar(a: &str, b: &str) -> bool {
    let na = entity::normalize_name(a);
    let nb = entity::normalize_name(b);
    if na.is_empty() || nb.is_empty() {
        return false;
    }
    if na == nb {
        return true;
    }
    if entity::levenshtein_ratio(&na, &nb) >= entity::fuzzy_threshold_for("open_task") {
        return true;
    }
    let (short, long) = if na.chars().count() <= nb.chars().count() {
        (na.as_str(), nb.as_str())
    } else {
        (nb.as_str(), na.as_str())
    };
    if short.chars().count() >= 6 && long.contains(short) {
        return true;
    }

    let ca = content_tokens(&na);
    let cb = content_tokens(&nb);
    if !ca.is_empty() && !cb.is_empty() {
        let jac = jaccard(&ca, &cb);
        let shares = ca.intersection(&cb).next().is_some();
        // 行动 vs 非行动：方面冲突时要求更高重叠，避免「修复 X」并到「了解 X」。
        let aspect_conflict = is_action_aspect(&na) != is_action_aspect(&nb);
        if aspect_conflict {
            return jac >= 0.6;
        }
        if jac >= 0.4 || (shares && jac >= 0.25) {
            return true;
        }
    }

    // 双方都是轻内容（多为话语/疑问骨架）且都非行动方面 → 同一探索 hub。
    if is_light_content(&na)
        && is_light_content(&nb)
        && !is_action_aspect(&na)
        && !is_action_aspect(&nb)
    {
        return true;
    }
    false
}

/// 话语/疑问停用词（语言学闭合集，用于抽内容词；不是业务领域黑名单）。
fn content_tokens(s: &str) -> std::collections::HashSet<String> {
    const STOP: &[&str] = &[
        // discourse / interrogative
        // discourse / interrogative only — keep nouns as content signals
        "了解", "概览", "探索", "熟悉", "介绍", "通读", "总结", "梳理", "诊断", "确认",
        "找出", "哪些", "如何", "什么", "怎么", "怎样", "一下", "这个", "那个", "我们",
        "一下", "一下", "最主要", "主要的",
        "the", "a", "an", "how", "what", "which", "where", "explore", "understand",
        "overview", "review", "check", "find", "about", "into", "from", "with", "this",
        "that",
    ];
    s.split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
        .map(|t| t.to_lowercase())
        .filter(|t| t.chars().count() >= 2)
        .filter(|t| !STOP.contains(&t.as_str()))
        .collect()
}

fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f64;
    let uni = a.union(b).count() as f64;
    if uni <= 0.0 {
        0.0
    } else {
        inter / uni
    }
}

/// 行动方面：以祈使/实施类动词起势（语言学 verb class，非产品个案）。
fn is_action_aspect(s: &str) -> bool {
    const VERBS: &[&str] = &[
        "修复", "实现", "添加", "删除", "替换", "重构", "接入", "落地", "持久化", "补充",
        "改", "写", "修", "fix", "implement", "add", "remove", "replace", "refactor",
        "persist", "wire", "patch", "migrate",
    ];
    VERBS.iter().any(|v| s.contains(v))
}

fn is_light_content(s: &str) -> bool {
    content_tokens(s).len() <= 2
}

fn node_confidence(node: &NodeFact) -> f64 {
    node.props
        .get("confidence")
        .and_then(Value::as_f64)
        .unwrap_or(0.55)
}

/// 批内相似 open_task 并到 canonical，避免「了解 X / 概览 X」并行 slug。
fn consolidate_open_tasks_in_batch(out: &mut SemanticExtraction) {
    let open_keys: Vec<String> = out
        .batch
        .nodes
        .iter()
        .filter(|n| n.node_type == "open_task")
        .map(|n| n.key.clone())
        .collect();
    if open_keys.len() < 2 {
        return;
    }

    let mut redirect: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for i in 0..open_keys.len() {
        for j in (i + 1)..open_keys.len() {
            let Some(ni) = out.batch.nodes.iter().find(|n| n.key == open_keys[i]) else {
                continue;
            };
            let Some(nj) = out.batch.nodes.iter().find(|n| n.key == open_keys[j]) else {
                continue;
            };
            if !open_task_labels_similar(&ni.label, &nj.label) {
                continue;
            }
            let (keep, drop) = pick_canonical_open_task(ni, nj);
            redirect.insert(drop.key.clone(), keep.key.clone());
        }
    }
    if redirect.is_empty() {
        return;
    }

    let resolve = |key: &str| -> String {
        let mut current = key.to_string();
        for _ in 0..8 {
            let Some(next) = redirect.get(&current) else {
                break;
            };
            if next == &current {
                break;
            }
            current = next.clone();
        }
        current
    };

    let mut removed = 0usize;
    for edge in &mut out.batch.edges {
        edge.src_key = resolve(&edge.src_key);
        edge.dst_key = resolve(&edge.dst_key);
    }
    out.batch.nodes.retain(|n| {
        if n.node_type != "open_task" {
            return true;
        }
        let canon = resolve(&n.key);
        if canon == n.key {
            true
        } else {
            removed += 1;
            false
        }
    });
    // 去掉自环/重复边
    let mut seen_edges = std::collections::HashSet::new();
    out.batch.edges.retain(|e| {
        if e.src_key == e.dst_key {
            return false;
        }
        seen_edges.insert((e.src_key.clone(), e.dst_key.clone(), e.edge_type.to_string()))
    });
    out.entity_count = out.entity_count.saturating_sub(removed);
}

fn pick_canonical_open_task<'a>(a: &'a NodeFact, b: &'a NodeFact) -> (&'a NodeFact, &'a NodeFact) {
    let ca = node_confidence(a);
    let cb = node_confidence(b);
    if (ca - cb).abs() > 0.05 {
        return if ca >= cb { (a, b) } else { (b, a) };
    }
    if a.label.chars().count() <= b.label.chars().count() {
        (a, b)
    } else {
        (b, a)
    }
}

/// evidence 门控（Semantica verbatim 证据思想）：有 evidence 则必须命中原文；
/// 无 evidence 仅当 confidence ≥ [`EVIDENCE_EXEMPT_CONFIDENCE`] 才放行。
fn evidence_acceptable(
    evidence: Option<&str>,
    confidence: Option<f64>,
    anchors: &ExtractionAnchors,
) -> bool {
    match evidence {
        Some(e) => anchors.evidence_supported(e),
        None => confidence.is_some_and(|c| c >= EVIDENCE_EXEMPT_CONFIDENCE),
    }
}

/// 批内同 type 近名归并（Semantica dedup 轻量版）：包含关系或 fuzzy ≥ 阈值。
fn consolidate_near_duplicate_entities(out: &mut SemanticExtraction) {
    let keys: Vec<String> = out.batch.nodes.iter().map(|n| n.key.clone()).collect();
    if keys.len() < 2 {
        return;
    }
    let mut redirect: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for i in 0..keys.len() {
        for j in (i + 1)..keys.len() {
            let Some(ni) = out.batch.nodes.iter().find(|n| n.key == keys[i]) else {
                continue;
            };
            let Some(nj) = out.batch.nodes.iter().find(|n| n.key == keys[j]) else {
                continue;
            };
            if ni.node_type != nj.node_type || ni.node_type == "open_task" {
                continue; // open_task 由专用 consolidate 处理
            }
            if !near_duplicate_labels(&ni.label, &nj.label) {
                continue;
            }
            let (keep, drop) = if node_confidence(ni) >= node_confidence(nj) {
                (ni, nj)
            } else {
                (nj, ni)
            };
            // 保留更完整的 label
            let (keep, drop) =
                if keep.label.chars().count() >= drop.label.chars().count() {
                    (keep, drop)
                } else {
                    (drop, keep)
                };
            redirect.insert(drop.key.clone(), keep.key.clone());
        }
    }
    if redirect.is_empty() {
        return;
    }
    apply_key_redirects(out, &redirect);
}

fn near_duplicate_labels(a: &str, b: &str) -> bool {
    let na = entity::normalize_name(a);
    let nb = entity::normalize_name(b);
    if na.is_empty() || nb.is_empty() {
        return false;
    }
    if na == nb {
        return true;
    }
    let (short, long) = if na.chars().count() <= nb.chars().count() {
        (na.as_str(), nb.as_str())
    } else {
        (nb.as_str(), na.as_str())
    };
    // 「X」与「X（useTimer）」类后缀变体
    if short.chars().count() >= 4 && long.starts_with(short) {
        let rest = &long[short.len()..];
        if rest.is_empty()
            || rest.starts_with('(')
            || rest.starts_with('（')
            || rest.starts_with('-')
            || rest.starts_with('_')
            || rest.starts_with(' ')
        {
            return true;
        }
    }
    entity::levenshtein_ratio(&na, &nb) >= NEAR_DUP_FUZZY_RATIO
}

fn apply_key_redirects(
    out: &mut SemanticExtraction,
    redirect: &std::collections::HashMap<String, String>,
) {
    let resolve = |key: &str| -> String {
        let mut current = key.to_string();
        for _ in 0..8 {
            let Some(next) = redirect.get(&current) else {
                break;
            };
            if next == &current {
                break;
            }
            current = next.clone();
        }
        current
    };
    let mut removed = 0usize;
    for edge in &mut out.batch.edges {
        edge.src_key = resolve(&edge.src_key);
        edge.dst_key = resolve(&edge.dst_key);
    }
    out.batch.nodes.retain(|n| {
        let canon = resolve(&n.key);
        if canon == n.key {
            true
        } else {
            removed += 1;
            false
        }
    });
    let mut seen = std::collections::HashSet::new();
    out.batch.edges.retain(|e| {
        if e.src_key == e.dst_key {
            return false;
        }
        seen.insert((e.src_key.clone(), e.dst_key.clone(), e.edge_type.to_string()))
    });
    out.entity_count = out.entity_count.saturating_sub(removed);
}

/// decision schema 不完备（无 chose/rejected/because）→ 降级为 feature。
/// 机制：类型字段契约（对齐 Graphiti/LlamaIndex strict schema），不靠产品词表。
fn demote_incomplete_decisions(batch: &mut FactBatch) -> usize {
    let mut demoted = 0usize;
    for node in &mut batch.nodes {
        if node.node_type != "decision" {
            continue;
        }
        let has_choice = ["chose", "rejected", "because"].iter().any(|field| {
            node.props
                .get(*field)
                .and_then(Value::as_str)
                .is_some_and(|s| !s.trim().is_empty())
        });
        if has_choice {
            continue;
        }
        let old_key = node.key.clone();
        let new_key = if let Some(rest) = old_key.strip_prefix("sem:decision:") {
            format!("sem:feature:{rest}")
        } else {
            format!("sem:feature:{}", entity::normalize_name(&node.label))
        };
        node.node_type = "feature";
        node.key = new_key.clone();
        if let Value::Object(ref mut props) = node.props {
            props.insert("demotedFrom".into(), Value::String("decision".into()));
        }
        for edge in &mut batch.edges {
            if edge.src_key == old_key {
                edge.src_key = new_key.clone();
            }
            if edge.dst_key == old_key {
                edge.dst_key = new_key.clone();
            }
        }
        demoted += 1;
    }
    demoted
}


/// 无代码锚点的 error_pattern 丢弃（GraphRAG orphan 思想）。
/// 锚点 = 已有 pattern_of/involves 到 file|module|feature|api，或 evidence 含路径/编译测试失败信号。
fn filter_unanchored_error_patterns(batch: &mut FactBatch) -> usize {
    let anchored: std::collections::HashSet<String> = batch
        .edges
        .iter()
        .filter(|e| matches!(e.edge_type, "sem/pattern_of" | "sem/involves" | "sem/affects"))
        .filter(|e| {
            matches!(
                lookup_node_type(batch, &e.dst_key),
                Some("file" | "module" | "feature" | "api")
            )
        })
        .map(|e| e.src_key.clone())
        .collect();

    let drop_keys: Vec<String> = batch
        .nodes
        .iter()
        .filter(|n| {
            if n.node_type != "error_pattern" {
                return false;
            }
            if anchored.contains(&n.key) {
                return false;
            }
            let evidence = n
                .props
                .get("evidence")
                .and_then(Value::as_str)
                .unwrap_or("");
            !evidence_has_code_anchor(evidence)
        })
        .map(|n| n.key.clone())
        .collect();
    if drop_keys.is_empty() {
        return 0;
    }
    let drop_set: std::collections::HashSet<String> = drop_keys.iter().cloned().collect();
    batch.nodes.retain(|n| !drop_set.contains(&n.key));
    batch.edges.retain(|e| !drop_set.contains(&e.src_key) && !drop_set.contains(&e.dst_key));
    drop_keys.len()
}

/// 通用代码失败锚点：路径扩展名 / 编译测试失败信号（非具体工具名黑名单）。
fn evidence_has_code_anchor(evidence: &str) -> bool {
    let e = evidence.to_lowercase();
    const PATH_MARKERS: &[&str] = &[
        ".rs", ".ts", ".tsx", ".js", ".jsx", ".vue", ".py", ".go", ".java", ".kt",
        ".swift", ".cs", ".cpp", ".c", ".h", ".rb", ".php", "/", "\\",
    ];
    const FAIL_MARKERS: &[&str] = &[
        "error:", "error[", "panic", "failed", "failure", "traceback", "exception",
        "compile", "compilation", "assert", "test failed", "tests failed", "typeerror",
        "borrow", "undefined", "nullpointer", "segfault", "stack overflow",
        // 中文失败信号（语言层，非具体工具名）
        "错误", "失败", "异常", "编译", "借用检查", "类型错误", "测试失败", "断言",
    ];
    PATH_MARKERS.iter().any(|m| e.contains(m)) || FAIL_MARKERS.iter().any(|m| e.contains(m))
}


fn lookup_node_type(batch: &FactBatch, key: &str) -> Option<&'static str> {
    batch
        .nodes
        .iter()
        .find(|n| n.key == key)
        .map(|n| n.node_type)
        .or_else(|| {
            if key.starts_with("file:") || key.contains('/') || key.ends_with(".ts") || key.ends_with(".rs")
                || key.ends_with(".vue") || key.ends_with(".tsx") || key.ends_with(".js")
            {
                Some("file")
            } else if key.starts_with("session:") || key == "session" {
                Some("session")
            } else if key.starts_with("turn:") {
                Some("turn")
            } else if let Some(rest) = key.strip_prefix("sem:") {
                // catalog-only 引用：从 key 解析类型，供 closes/supersedes 矩阵校验。
                let ty = rest.split(':').next().unwrap_or("");
                static_entity_type(ty)
            } else {
                None
            }
        })
}

/// 关系端点类型矩阵（数据驱动；对齐 LlamaIndex/Graphiti typed schema）。
/// `None` = 任意已解析类型（含 file/session 锚点）。
fn relation_type_matrix(rtype: &str) -> Option<RelationTypeRule> {
    match rtype {
        "pattern_of" => Some(RelationTypeRule {
            src: Some(&["error_pattern"]),
            dst: Some(&["file", "module", "feature", "api", "tech_concept", "decision"]),
        }),
        "affects" => Some(RelationTypeRule {
            src: Some(&["decision", "feature", "module", "error_pattern", "tradeoff"]),
            dst: Some(&["file", "module", "feature", "api", "tech_concept"]),
        }),
        "located_in" => Some(RelationTypeRule {
            src: Some(&["module", "feature", "api", "decision", "tech_concept"]),
            dst: Some(&["file", "module"]),
        }),
        "implements" => Some(RelationTypeRule {
            src: Some(&["feature", "module", "session"]),
            dst: Some(&["file", "module", "feature", "api"]),
        }),
        "decided" => Some(RelationTypeRule {
            src: Some(&["decision"]),
            dst: Some(&["tech_concept", "module", "feature", "api", "file", "tradeoff"]),
        }),
        "rationale" => Some(RelationTypeRule {
            src: Some(&["tradeoff", "decision"]),
            dst: Some(&["decision", "tradeoff", "tech_concept", "feature"]),
        }),
        "exposes" => Some(RelationTypeRule {
            src: Some(&["api"]),
            dst: Some(&["module", "file", "feature"]),
        }),
        "similar_to" => Some(RelationTypeRule {
            src: None, // same-type checked separately
            dst: None,
        }),
        "supersedes" => Some(RelationTypeRule {
            src: Some(&["decision", "feature", "open_task", "tech_concept", "tradeoff"]),
            dst: Some(&["decision", "feature", "open_task", "tech_concept", "tradeoff"]),
        }),
        "closes" => Some(RelationTypeRule {
            src: Some(&[
                "decision",
                "feature",
                "module",
                "open_task",
                "tech_concept",
                "api",
                "tradeoff",
                "session",
                "turn",
            ]),
            dst: Some(&["open_task"]),
        }),
        "blocked_by" => Some(RelationTypeRule {
            src: Some(&["open_task", "feature", "decision"]),
            dst: Some(&["error_pattern", "decision", "tradeoff", "open_task", "module"]),
        }),
        "involves" => Some(RelationTypeRule {
            src: Some(&["open_task", "decision", "feature"]),
            dst: Some(&[
                "module",
                "feature",
                "tech_concept",
                "decision",
                "api",
                "error_pattern",
                "tradeoff",
            ]),
        }),
        _ => None,
    }
}

struct RelationTypeRule {
    src: Option<&'static [&'static str]>,
    dst: Option<&'static [&'static str]>,
}

fn type_allowed(allowed: Option<&[&str]>, actual: Option<&str>) -> bool {
    match (allowed, actual) {
        (None, _) => true,
        (Some(_), None) => true, // 未知锚点宽松放行（file 启发式未命中时）
        (Some(list), Some(t)) => list.contains(&t),
    }
}

/// 关系端点类型纪律：查矩阵 + 少量全局禁边（open_task 不铺文件、pattern_of 不进 open_task）。
fn relation_endpoints_sensible(
    rtype: &str,
    src_key: &str,
    dst_key: &str,
    batch: &FactBatch,
) -> bool {
    let src_ty = lookup_node_type(batch, src_key);
    let dst_ty = lookup_node_type(batch, dst_key);

    // 全局禁边（schema 不变量，非个案）
    if src_ty == Some("open_task") && matches!(rtype, "affects" | "located_in") {
        return false;
    }
    if rtype == "pattern_of" && dst_ty == Some("open_task") {
        return false;
    }
    if rtype == "blocked_by"
        && matches!(src_ty, Some("module" | "feature" | "tech_concept" | "api"))
        && dst_ty == Some("open_task")
    {
        return false;
    }
    if rtype == "similar_to" {
        return src_ty.is_some() && src_ty == dst_ty;
    }

    let Some(rule) = relation_type_matrix(rtype) else {
        return true; // 白名单外的 type 已在上游丢弃
    };
    type_allowed(rule.src, src_ty) && type_allowed(rule.dst, dst_ty)
}


/// 超出 [`MAX_ENTITIES_PER_TURN`] 时保留全部 open_task + 高 confidence 实体。
fn trim_entities_if_needed(out: &mut SemanticExtraction) {
    if out.batch.nodes.len() <= MAX_ENTITIES_PER_TURN {
        return;
    }
    let open_keys: std::collections::HashSet<String> = out
        .batch
        .nodes
        .iter()
        .filter(|n| n.node_type == "open_task")
        .map(|n| n.key.clone())
        .collect();
    let mut ranked: Vec<(String, f64)> = out
        .batch
        .nodes
        .iter()
        .filter(|n| !open_keys.contains(&n.key))
        .map(|n| (n.key.clone(), node_confidence(n)))
        .collect();
    ranked.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let keep_budget = MAX_ENTITIES_PER_TURN.saturating_sub(open_keys.len());
    let mut keep_keys: std::collections::HashSet<String> = open_keys;
    for (key, _) in ranked.into_iter().take(keep_budget) {
        keep_keys.insert(key);
    }
    let drop_keys: std::collections::HashSet<String> = out
        .batch
        .nodes
        .iter()
        .filter(|n| !keep_keys.contains(&n.key))
        .map(|n| n.key.clone())
        .collect();
    let removed = drop_keys.len();
    out.batch.nodes.retain(|n| keep_keys.contains(&n.key));
    out.batch.edges.retain(|e| {
        !drop_keys.contains(&e.src_key) && !drop_keys.contains(&e.dst_key)
    });
    out.entity_count = out.entity_count.saturating_sub(removed);
    out.entity_summaries.retain(|(_, title)| {
        out.batch
            .nodes
            .iter()
            .any(|n| n.label == *title || n.label.contains(title.as_str()))
    });
}

fn link_turn_extracted(
    out: &mut SemanticExtraction,
    anchors: &ExtractionAnchors,
    entity_key: &str,
    intent: &str,
) {
    let Some(turn_key) = anchors.turn_key.as_deref() else {
        return;
    };
    if !batch_has_edge(&out.batch, turn_key, entity_key, "extracted") {
        out.batch.edges.push(edge_fact(
            turn_key,
            entity_key,
            "extracted",
            anchors,
            Some(intent),
        ));
    }
}

fn batch_has_edge(batch: &FactBatch, src: &str, dst: &str, edge_type: &str) -> bool {
    batch
        .edges
        .iter()
        .any(|e| e.src_key == src && e.dst_key == dst && e.edge_type == edge_type)
}

fn register_ref(
    index: &mut std::collections::HashMap<String, String>,
    key: &str,
    alias: &str,
) {
    let trimmed = alias.trim();
    if trimmed.is_empty() {
        return;
    }
    index.entry(trimmed.to_string()).or_insert_with(|| key.to_string());
    let norm = entity::normalize_name(trimmed);
    if !norm.is_empty() {
        index.entry(norm).or_insert_with(|| key.to_string());
    }
}

fn prefer_display_label(a: &str, b: &str) -> String {
    let a = a.trim();
    let b = b.trim();
    if a.is_empty() {
        return snippet(b, 120);
    }
    if b.is_empty() {
        return snippet(a, 120);
    }
    // 人话标题优先于 slug 形标题（slug 往往更长，不能只比字符数）。
    let a_slug = label_looks_like_slug(a);
    let b_slug = label_looks_like_slug(b);
    if a_slug && !b_slug {
        return snippet(b, 120);
    }
    if b_slug && !a_slug {
        return snippet(a, 120);
    }
    if b.chars().count() > a.chars().count() {
        snippet(b, 120)
    } else {
        snippet(a, 120)
    }
}

/// 读 confidence 字段（兼容数字与数字字符串）。
fn confidence_of(value: &Value) -> Option<f64> {
    match value.get("confidence") {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// 标题像 slug（`tradeoff-reject-redis`）时用人话替换；否则保留模型 title。
fn humanize_entity_label(
    etype: &str,
    label: &str,
    props: &serde_json::Map<String, Value>,
) -> String {
    let trimmed = label.trim();
    if !label_looks_like_slug(trimmed) {
        return snippet(trimmed, 120);
    }
    if etype == "tradeoff" {
        let chose = props.get("chose").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        let rejected = props
            .get("rejected")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        match (chose, rejected) {
            (Some(c), Some(r)) => return snippet(&format!("选用 {c}，弃用 {r}"), 120),
            (Some(c), None) => return snippet(&format!("选用 {c}"), 120),
            (None, Some(r)) => return snippet(&format!("弃用 {r}"), 120),
            _ => {}
        }
    }
    // 其它类型：把连字符拆成可读短句仍不够好，至少去掉类型前缀。
    let without_prefix = trimmed
        .strip_prefix(&format!("{etype}-"))
        .unwrap_or(trimmed);
    snippet(without_prefix, 120)
}

fn label_looks_like_slug(label: &str) -> bool {
    let t = label.trim();
    if t.is_empty() {
        return true;
    }
    if t.starts_with("tradeoff-")
        || t.starts_with("decision-")
        || t.starts_with("feature-")
        || t.starts_with("error-")
        || t.starts_with("module-")
        || t.starts_with("open-task-")
        || t.starts_with("task-")
    {
        return true;
    }
    // 纯 ascii 小写+数字+连字符，且含连字符 → 多半是 id 当 title。
    t.contains('-')
        && t.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 补全模型常漏的结构性边：只连接本批已有实体与文件锚点，不发明概念。
/// 默认关闭：实体↔实体边只信 LLM 输出（避免启发式盖过 agent 判断）。
#[allow(dead_code)]
fn enrich_missing_relations(out: &mut SemanticExtraction, anchors: &ExtractionAnchors) {
    let keys_of = |etype: &str| -> Vec<String> {
        out.batch
            .nodes
            .iter()
            .filter(|n| n.node_type == etype)
            .map(|n| n.key.clone())
            .collect()
    };
    let decisions = keys_of("decision");
    let tradeoffs = keys_of("tradeoff");
    let concepts = keys_of("tech_concept");
    let features = keys_of("feature");
    let modules = keys_of("module");
    let errors = keys_of("error_pattern");
    let apis = keys_of("api");
    let file_keys: Vec<String> = anchors.file_keys.iter().map(|(_, k)| k.clone()).collect();

    let mut push = |src: &str, dst: &str, rtype: &str| {
        if src == dst {
            return;
        }
        if has_sem_edge(&out.batch, src, dst, rtype) || has_sem_edge(&out.batch, dst, src, rtype) {
            return;
        }
        // 同类边已从该 src 发出则跳过，避免全连接爆炸。
        let edge_name = semantic_edge_type(rtype);
        if out
            .batch
            .edges
            .iter()
            .any(|e| e.src_key == src && e.edge_type == edge_name)
        {
            return;
        }
        let mut edge = edge_fact(src, dst, rtype, anchors, None);
        if let Value::Object(ref mut props) = edge.props {
            props.insert("source".into(), Value::String("relation_enrichment".into()));
        }
        out.batch.edges.push(edge);
        out.relation_count += 1;
    };

    for t in &tradeoffs {
        if let Some(d) = decisions.first() {
            push(t, d, "rationale");
        }
    }
    for d in &decisions {
        if let Some(c) = concepts.first() {
            push(d, c, "decided");
        }
        if let Some(f) = file_keys.first() {
            push(d, f, "affects");
        }
    }
    for f in &features {
        for file in file_keys.iter().take(2) {
            push(f, file, "implements");
        }
    }
    for m in &modules {
        for file in file_keys.iter().take(3) {
            push(m, file, "located_in");
        }
    }
    for e in &errors {
        if let Some(f) = file_keys.first() {
            push(e, f, "pattern_of");
        }
    }
    for a in &apis {
        if let Some(m) = modules.first() {
            push(a, m, "exposes");
        } else if let Some(f) = file_keys.first() {
            push(a, f, "exposes");
        }
    }
}

#[allow(dead_code)]
fn has_sem_edge(
    batch: &FactBatch,
    src: &str,
    dst: &str,
    rtype: &str,
) -> bool {
    let edge_name = semantic_edge_type(rtype);
    batch
        .edges
        .iter()
        .any(|e| e.src_key == src && e.dst_key == dst && e.edge_type == edge_name)
}

/// 抽取锚点：语义边允许挂接的过程层节点。
#[derive(Debug, Clone)]
pub struct ExtractionAnchors {
    pub session_key: String,
    pub turn_key: Option<String>,
    pub file_keys: Vec<(String, String)>, // (相对路径, file 节点 key)
    pub timestamp_ms: u64,
    pub session_id: String,
    pub run_id: String,
    pub sequence: u64,
    pub event_id: String,
    /// 模型实际看到的输入文本（user/assistant 截断版拼接），
    /// evidence 逐字引用校验的比对基准；空串表示不强制校验。
    pub source_text: String,
}

impl ExtractionAnchors {
    /// evidence 是否为输入文本的逐字引用（空白归一化后子串匹配）。
    /// 源文本为空（无 user/assistant 内容的 turn）时不强制，返回 true。
    #[must_use]
    pub fn evidence_supported(&self, evidence: &str) -> bool {
        if self.source_text.trim().is_empty() {
            return true;
        }
        let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
        normalize(&self.source_text).contains(&normalize(evidence))
    }

    /// 锚点文件查找：路径或裸文件名命中即返回节点 key。
    fn file_key(&self, reference: &str) -> Option<String> {
        let needle = reference.trim().trim_start_matches("./");
        if needle.is_empty() {
            return None;
        }
        for (path, key) in &self.file_keys {
            if path == needle
                || path.ends_with(&format!("/{needle}"))
                || needle.ends_with(path.as_str())
            {
                return Some(key.clone());
            }
        }
        None
    }
}

fn resolve_ref(
    reference: &str,
    entity_keys: &[String],
    ref_index: &std::collections::HashMap<String, String>,
    anchors: &ExtractionAnchors,
) -> Option<String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 0) 本批 ref 索引（id / title / normalize）。
    if let Some(key) = ref_index.get(trimmed) {
        return Some(key.clone());
    }
    let norm = entity::normalize_name(trimmed);
    if !norm.is_empty() {
        if let Some(key) = ref_index.get(&norm) {
            return Some(key.clone());
        }
    }
    // 1) 已声明的实体 slug（补全 sem:type: 前缀——先试原样，再按 type 猜）。
    if let Some(found) = entity_keys
        .iter()
        .find(|k| k.ends_with(&format!(":{trimmed}")) || (!norm.is_empty() && k.ends_with(&format!(":{norm}"))))
    {
        return Some(found.clone());
    }
    // 2) 显式 sem: 前缀。
    if trimmed.starts_with("sem:") && entity_keys.iter().any(|k| k == trimmed) {
        return Some(trimmed.to_string());
    }
    // 3) 锚点：file 路径。
    if let Some(file_key) = anchors.file_key(trimmed) {
        return Some(file_key);
    }
    // 4) 锚点：会话/轮次。
    if trimmed == "session" {
        return Some(anchors.session_key.clone());
    }
    if trimmed == "turn" {
        return anchors.turn_key.clone();
    }
    None
}

/// 从模型输出中剥出 JSON 对象文本（容忍围栏与前后散文）。
fn extract_json_object(raw: &str) -> Option<String> {
    let text = raw.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text)
        .trim();
    let text = text.strip_suffix("```").unwrap_or(text);
    let start = text.find('{')?;
    // 从末个 '}' 反向找配对起点之后的第一个（嵌套对象取最外层）。
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(text[start..=end].to_string())
}

/// 白名单实体类型 → 'static str（NodeFact.node_type 需要）。
fn static_entity_type(etype: &str) -> Option<&'static str> {
    match etype {
        "decision" => Some("decision"),
        "feature" => Some("feature"),
        "module" => Some("module"),
        "tech_concept" => Some("tech_concept"),
        "error_pattern" => Some("error_pattern"),
        "api" => Some("api"),
        "tradeoff" => Some("tradeoff"),
        "open_task" => Some("open_task"),
        _ => None,
    }
}

fn edge_fact(
    src: &str,
    dst: &str,
    edge_type: &str,
    anchors: &ExtractionAnchors,
    evidence: Option<&str>,
) -> EdgeFact {
    let mut props = serde_json::json!({"source": "llm_extraction"});
    if let Some(text) = evidence {
        props["evidence"] = Value::String(snippet(text, 200));
    }
    EdgeFact {
        src_key: src.to_string(),
        dst_key: dst.to_string(),
        edge_type: semantic_edge_type(edge_type), // 白名单映射；锚边 "extracted" 直传直用
        props,
        session_id: anchors.session_id.clone(),
        run_id: anchors.run_id.clone(),
        event_id: anchors.event_id.clone(),
        sequence: anchors.sequence,
        timestamp_ms: anchors.timestamp_ms,
    }
}

/// 语义边 type 带 `sem/` 前缀，与过程层边命名空间隔离。
fn semantic_edge_type(rtype: &str) -> &'static str {
    match rtype {
        "decided" => "sem/decided",
        "rationale" => "sem/rationale",
        "affects" => "sem/affects",
        "implements" => "sem/implements",
        "located_in" => "sem/located_in",
        "involves" => "sem/involves",
        "pattern_of" => "sem/pattern_of",
        "exposes" => "sem/exposes",
        "blocked_by" => "sem/blocked_by",
        "similar_to" => "sem/similar_to",
        // 取代边方向语义：supersedes(A→B) = A 取代 B，落库统一为
        // sem/superseded_by(B←A) 视角：被取代者 src、取代者 dst，检索按
        // 出边判断时效性。
        "supersedes" => "sem/superseded_by",
        "superseded_by" => "sem/superseded_by",
        // 关闭边：closes(closer→task) → sem/closed_by(task→closer)。
        "closes" => "sem/closed_by",
        "closed_by" => "sem/closed_by",
        // 锚边（实体 → turn）：非语义关系，原样通过。
        "extracted" => "extracted",
        _ => "sem/related_to",
    }
}

/// 关系类型别名归一：兼容 prompt/模型偶发的近义词，避免合法边被白名单误杀。
fn normalize_relation_type(rtype: &str) -> &'static str {
    match rtype.trim() {
        "decided" | "decides" | "chose" | "decision" => "decided",
        "rationale" | "because" | "reason" => "rationale",
        "affects" | "impact" | "impacts" => "affects",
        "implements" | "implement" | "realized_by" => "implements",
        "located_in" | "located_at" | "in_file" | "in_module" => "located_in",
        "involves" | "involve" => "involves",
        "pattern_of" | "pattern_for" | "caused_by" => "pattern_of",
        "exposes" | "expose" | "provides" => "exposes",
        "blocked_by" | "blocks" | "blocked" => "blocked_by",
        "similar_to" | "similar" | "same_as" | "related" | "related_to" => "similar_to",
        "supersedes" | "supersede" | "replaces" | "replaced" => "supersedes",
        "superseded_by" => "superseded_by",
        "closes" | "close" | "resolves" | "resolved" => "closes",
        "closed_by" => "closed_by",
        other => {
            for known in SEMANTIC_RELATION_TYPES {
                if known == other {
                    return known;
                }
            }
            // 未知类型：返回哨兵，随后被白名单丢弃（勿兜底成 involves，以免造假边）。
            "__unknown__"
        }
    }
}

/// 把 catalog 登记进 ref_index / valid_keys，使本轮 relations 可引用既有实体。
fn seed_catalog_refs(
    catalog: &[CatalogEntity],
    valid_keys: &mut Vec<String>,
    ref_index: &mut std::collections::HashMap<String, String>,
) {
    for entry in catalog {
        if !valid_keys.iter().any(|k| k == &entry.key) {
            valid_keys.push(entry.key.clone());
        }
        register_ref(ref_index, &entry.key, &entry.label);
        register_ref(ref_index, &entry.key, &entry.normalized_name);
        for alias in &entry.aliases {
            register_ref(ref_index, &entry.key, alias);
        }
        if let Some(slug) = entry
            .key
            .strip_prefix("sem:")
            .and_then(|rest| rest.split_once(':'))
            .map(|(_, slug)| slug)
        {
            register_ref(ref_index, &entry.key, slug);
        }
    }
}

/// 生命周期副作用（对齐 Graphiti invalidation：边废止 + 状态标记，不删节点）。
fn apply_lifecycle_side_effects(batch: &mut FactBatch, anchors: &ExtractionAnchors) {
    let updates: Vec<(String, &'static str)> = batch
        .edges
        .iter()
        .filter_map(|e| match e.edge_type {
            "sem/closed_by" => Some((e.src_key.clone(), "done")),
            "sem/superseded_by" => Some((e.src_key.clone(), "superseded")),
            _ => None,
        })
        .collect();
    for (key, status) in updates {
        if let Some(node) = batch.nodes.iter_mut().find(|n| n.key == key) {
            if let Some(obj) = node.props.as_object_mut() {
                obj.insert("status".into(), Value::String(status.into()));
                obj.insert(
                    "statusUpdatedAtMs".into(),
                    Value::from(anchors.timestamp_ms),
                );
            }
        }
        // 未进本批的实体：只靠边废止（避免 props 整表覆盖擦掉历史字段）。
    }
}

fn slugify(text: &str) -> String {
    let mut slug = String::with_capacity(text.len());
    for ch in text.trim().chars().take(48) {
        if ch.is_alphanumeric() {
            slug.push(ch.to_lowercase().next().unwrap_or(ch));
        } else if ch.is_whitespace() || ch == '-' || ch == '_' || ch == '/' {
            if !slug.ends_with('-') && !slug.is_empty() {
                slug.push('-');
            }
        }
    }
    slug.trim_matches('-').to_string()
}

fn snippet(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchors() -> ExtractionAnchors {
        ExtractionAnchors {
            session_key: "session:abc".into(),
            turn_key: Some("turn:abc/1".into()),
            file_keys: vec![("src/login.rs".into(), "file:aaa".into())],
            timestamp_ms: 1_000,
            session_id: "sess-1".into(),
            run_id: "run-1".into(),
            sequence: 7,
            event_id: "evt-7".into(),
            source_text: "用 SQLite 存资产图谱，别上 Neo4j，我们要零运维。已决定采用 rusqlite。\
                          配对重试已完成。借用检查错误已修复。"
                .into(),
        }
    }

    const SAMPLE: &str = r#"```json
{
  "entities": [
    {"id": "sqlite-asset-graph", "type": "decision", "title": "用 SQLite 存资产图谱",
     "category": "data", "scenario": "需要本地零运维图存储", "reasoning": "rusqlite 已捆绑",
     "chose": "SQLite", "rejected": "Neo4j", "because": "零运维", "confidence": 0.9,
     "evidence": "用 SQLite 存资产图谱"},
    {"id": "login-retry", "type": "feature", "title": "配对重试", "evidence": "配对重试已完成"},
    {"id": "borrow-checker", "type": "error_pattern", "title": "借用检查错误", "evidence": "借用检查错误已修复"},
    {"id": "unknown-thing", "type": "person", "title": "应被丢弃"}
  ],
  "relations": [
    {"type": "affects", "subject": "sqlite-asset-graph", "object": "src/login.rs",
     "confidence": 0.9, "evidence": "用 SQLite 存资产图谱"},
    {"type": "implements", "subject": "session", "object": "login-retry",
     "confidence": 0.85, "evidence": "配对重试已完成"},
    {"type": "pattern_of", "subject": "borrow-checker", "object": "src/login.rs",
     "confidence": 0.85, "evidence": "借用检查错误已修复"},
    {"type": "involves", "subject": "sqlite-asset-graph", "object": "不存在的引用",
     "confidence": 0.9, "evidence": "用 SQLite 存资产图谱"}
  ]
}
```"#;

    #[test]
    fn parses_entities_and_fences() {
        let out = parse_extraction(SAMPLE, &anchors(), &[]);
        // person 类型不在边界内 → 丢弃；其余 3 个保留。
        assert_eq!(out.entity_count, 3);
        let types: Vec<&String> = out.batch.nodes.iter().map(|n| &n.key).collect();
        assert!(types.iter().any(|k| k.starts_with("sem:decision:")));
        assert!(out.batch.nodes.iter().any(|n| {
            n.node_type == "decision"
                && n.props.get("normalizedName").and_then(|v| v.as_str())
                    == Some("用 sqlite 存资产图谱")
        }));
        assert!(!types.iter().any(|k| k.contains("person")));
        // 关系：affects/implements/pattern_of 有效；involves 目标缺失 → 丢。
        // enrich 可能再补 feature→file implements 等，故用 ≥ 并断言关键边仍在。
        assert!(out.relation_count >= 3);
        let edges: Vec<&str> = out.batch.edges.iter().map(|e| e.edge_type).collect();
        assert!(edges.contains(&"sem/affects"));
        assert!(edges.contains(&"sem/implements"));
        assert!(edges.contains(&"sem/pattern_of"));
        // 决策字段进 props。
        let decision = out.batch.nodes.iter().find(|n| n.key.contains("decision")).unwrap();
        assert_eq!(decision.props["category"], "data");
        assert_eq!(decision.props["confidence"], 0.9);
        // 实体挂到 turn 锚点。
        assert!(out.batch.edges.iter().any(|e| e.edge_type == "extracted"));
    }

    #[test]
    fn tolerates_prose_wrapping_and_bad_json() {
        let wrapped = format!("Here is the result:\n{{\"entities\":[],\"relations\":[]}}\nDone.");
        let out = parse_extraction(&wrapped, &anchors(), &[]);
        assert_eq!(out.entity_count, 0);
        let garbage = parse_extraction("no json at all", &anchors(), &[]);
        assert_eq!(garbage.entity_count, 0);
        let empty = parse_extraction("{\"entities\":[],\"relations\":[]}", &anchors(), &[]);
        assert!(empty.batch.is_empty());
    }

    #[test]
    fn json_extraction_finds_outermost_object() {
        let text = "prefix {\"a\":{\"b\":1}} suffix";
        assert_eq!(extract_json_object(text).as_deref(), Some("{\"a\":{\"b\":1}}"));
    }

    #[test]
    fn slugify_normalizes() {
        assert_eq!(slugify("SQLite Asset Graph!"), "sqlite-asset-graph");
        assert_eq!(slugify("  配对重试  "), "配对重试");
    }

    #[test]
    fn quality_gates_drop_low_confidence_fake_evidence_and_self_loops() {
        let raw = r#"{
          "entities": [
            {"id": "low-conf", "type": "feature", "title": "低置信猜测", "confidence": 0.2},
            {"id": "fake-evidence", "type": "module", "title": "假证据", "evidence": "原文里根本没有这句话"},
            {"id": "good", "type": "decision", "title": "用 SQLite 存资产图谱",
             "chose": "SQLite", "rejected": "Neo4j", "confidence": 0.9,
             "evidence": "用 SQLite 存资产图谱"}
          ],
          "relations": [
            {"type": "affects", "subject": "good", "object": "good"},
            {"type": "affects", "subject": "good", "object": "src/login.rs", "confidence": 0.1},
            {"type": "affects", "subject": "good", "object": "src/login.rs", "evidence": "已决定采用 rusqlite"},
            {"type": "involves", "subject": "low-conf", "object": "src/login.rs"}
          ]
        }"#;
        let out = parse_extraction(raw, &anchors(), &[]);
        // 低置信 + 假 evidence 的实体被丢，只剩 good（turn/session 锚点节点不计语义实体）。
        assert_eq!(out.entity_count, 1);
        let semantic: Vec<_> = out
            .batch
            .nodes
            .iter()
            .filter(|n| SEMANTIC_ENTITY_TYPES.contains(&n.node_type))
            .collect();
        assert_eq!(semantic.len(), 1);
        assert_eq!(semantic[0].node_type, "decision");
        assert!(semantic.iter().any(|n| {
            n.props
                .get("aliases")
                .and_then(|v| v.as_array())
                .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("good")))
        }));
        // 关系：自环丢、低置信丢、evidence 通过留、引用被丢实体的随之丢。
        assert_eq!(out.relation_count, 1);
        let kept = out
            .batch
            .edges
            .iter()
            .find(|e| e.edge_type == "sem/affects")
            .expect("kept relation");
        assert_eq!(kept.props["evidence"], "已决定采用 rusqlite");
    }

    #[test]
    fn evidence_matching_tolerates_whitespace_variation() {
        let mut anchors = anchors();
        anchors.source_text = "第一行\n  缩进   很多空白".into();
        assert!(anchors.evidence_supported("第一行 缩进 很多空白"));
        assert!(!anchors.evidence_supported("第一行 别的内容"));
        // 空源文本不强制（无 user/assistant 内容的 turn）。
        anchors.source_text = String::new();
        assert!(anchors.evidence_supported("任意引用"));
    }

    #[test]
    fn supersedes_flips_to_superseded_by() {
        let raw = r#"{
          "entities": [
            {"id": "redb-store", "type": "decision", "title": "改用 redb",
             "confidence": 0.9, "evidence": "最终决定弃用 LevelDB，改用 redb"},
            {"id": "leveldb-store", "type": "decision", "title": "LevelDB 方案",
             "confidence": 0.9, "evidence": "最终决定弃用 LevelDB，改用 redb"}
          ],
          "relations": [
            {"type": "supersedes", "subject": "redb-store", "object": "leveldb-store",
             "evidence": "最终决定弃用 LevelDB，改用 redb"}
          ]
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "最终决定弃用 LevelDB，改用 redb，因为要纯 Rust 零 C 依赖。".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert_eq!(out.entity_count, 2);
        assert!(out.relation_count >= 1);
        let edge = out
            .batch
            .edges
            .iter()
            .find(|e| e.edge_type == "sem/superseded_by")
            .expect("superseded_by edge");
        // 方向翻转：src=被取代的旧决策，dst=新决策（key 来自 title 归一化）。
        assert!(edge.src_key.starts_with("sem:decision:"));
        assert!(edge.dst_key.starts_with("sem:decision:"));
        assert_ne!(edge.src_key, edge.dst_key);
        assert!(
            edge.src_key.contains("leveldb"),
            "src={}",
            edge.src_key
        );
        assert!(edge.dst_key.contains("redb"), "dst={}", edge.dst_key);
    }

    #[test]
    fn closes_flips_to_closed_by_and_marks_done() {
        let raw = r#"{
          "entities": [
            {"id": "lost-keys", "type": "open_task", "title": "钥匙丢了",
             "confidence": 0.9, "evidence": "钥匙丢了，需要找回来"},
            {"id": "found-keys", "type": "decision", "title": "钥匙已找到",
             "confidence": 0.9, "evidence": "钥匙找到了，问题解决"}
          ],
          "relations": [
            {"type": "closes", "subject": "found-keys", "object": "lost-keys",
             "evidence": "钥匙找到了，问题解决"}
          ],
          "quality": "high"
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "钥匙丢了，需要找回来。后来钥匙找到了，问题解决。".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert!(out.entity_count >= 2);
        let edge = out
            .batch
            .edges
            .iter()
            .find(|e| e.edge_type == "sem/closed_by")
            .expect("closed_by edge");
        assert!(edge.src_key.starts_with("sem:open_task:"), "src={}", edge.src_key);
        assert!(edge.dst_key.starts_with("sem:decision:"), "dst={}", edge.dst_key);
        let task = out
            .batch
            .nodes
            .iter()
            .find(|n| n.key == edge.src_key)
            .expect("closed open_task");
        assert_eq!(task.props.get("status").and_then(|v| v.as_str()), Some("done"));
    }

    #[test]
    fn closes_can_target_catalog_open_task_without_reemit() {
        let catalog = [CatalogEntity {
            key: "sem:open_task:fix-login-bug".into(),
            entity_type: "open_task".into(),
            label: "修复登录 bug".into(),
            normalized_name: "修复登录 bug".into(),
            aliases: vec!["login-bug".into()],
            props: serde_json::json!({"confidence": 0.8}),
        }];
        let raw = r#"{
          "entities": [
            {"id": "login-fix", "type": "decision", "title": "登录已修复",
             "confidence": 0.9, "evidence": "登录 bug 已修好"}
          ],
          "relations": [
            {"type": "closes", "subject": "login-fix", "object": "fix-login-bug",
             "evidence": "登录 bug 已修好"}
          ],
          "quality": "high"
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "登录 bug 已修好，可以关掉之前的任务。".into();
        let out = parse_extraction(raw, &anchors, &catalog);
        let edge = out
            .batch
            .edges
            .iter()
            .find(|e| e.edge_type == "sem/closed_by")
            .expect("closed_by via catalog ref");
        assert_eq!(edge.src_key, "sem:open_task:fix-login-bug");
        assert!(edge.dst_key.starts_with("sem:decision:"));
    }

    #[test]
    fn humanizes_slug_like_tradeoff_title() {
        let raw = r#"{
          "entities": [
            {"id": "tradeoff-reject-redis", "type": "tradeoff",
             "title": "tradeoff-reject-redis",
             "chose": "moka", "rejected": "Redis", "because": "零外部依赖",
             "confidence": 0.9, "evidence": "改用进程内的 moka"},
            {"id": "cache-moka", "type": "decision", "title": "缓存用 moka",
             "confidence": 0.9, "evidence": "改用进程内的 moka"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "缓存层考虑过 Redis，最后改用进程内的 moka。".into();
        anchors.file_keys = vec![("src/cache/mod.rs".into(), "file:cache".into())];
        let out = parse_extraction(raw, &anchors, &[]);
        let tradeoff = out
            .batch
            .nodes
            .iter()
            .find(|n| n.node_type == "tradeoff")
            .expect("tradeoff");
        assert!(
            tradeoff.label.contains("moka") && tradeoff.label.contains("Redis"),
            "label={}",
            tradeoff.label
        );
        assert!(!tradeoff.label.starts_with("tradeoff-"));
        // 启发式补边已关闭：无 relations 时不再自动补 rationale/affects。
        // 实体↔实体边只信 LLM；本样例 relations 为空。
        assert_eq!(out.relation_count, 0);
        assert_eq!(out.entity_count, 2);
        assert_eq!(out.quality, ExtractionQuality::High);
    }

    #[test]
    fn keeps_human_readable_title_unchanged() {
        let raw = r#"{
          "entities": [
            {"id": "sqlite-store", "type": "decision",
             "title": "资产图谱存储采用 SQLite",
             "confidence": 0.95, "evidence": "用 SQLite"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "用 SQLite".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert_eq!(out.batch.nodes[0].label, "资产图谱存储采用 SQLite");
    }

    #[test]
    fn batch_aliases_collapse_to_one_node() {
        let raw = r#"{
          "entities": [
            {"id": "SQLite", "type": "tech_concept", "title": "SQLite",
             "confidence": 0.9, "evidence": "用 SQLite"},
            {"id": "sqlite", "type": "tech_concept", "title": "sqlite",
             "confidence": 0.85, "evidence": "用 SQLite"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "用 SQLite".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert_eq!(out.entity_count, 1);
        let semantic: Vec<_> = out
            .batch
            .nodes
            .iter()
            .filter(|n| SEMANTIC_ENTITY_TYPES.contains(&n.node_type))
            .collect();
        assert_eq!(semantic.len(), 1);
        let node = semantic[0];
        assert_eq!(node.key, "sem:tech_concept:sqlite");
        assert_eq!(
            node.props.get("normalizedName").and_then(|v| v.as_str()),
            Some("sqlite")
        );
        let aliases = node
            .props
            .get("aliases")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            aliases.iter().any(|v| v.as_str() == Some("SQLite"))
                || node.label == "SQLite"
                || aliases.iter().any(|v| v.as_str() == Some("sqlite")),
            "aliases={aliases:?} label={}",
            node.label
        );
        // confidence 取 max
        assert_eq!(node.props.get("confidence").and_then(|v| v.as_f64()), Some(0.9));
    }

    #[test]
    fn catalog_resolve_reuses_existing_key() {
        let catalog = [CatalogEntity {
            key: "sem:tech_concept:sqlite".into(),
            entity_type: "tech_concept".into(),
            label: "SQLite".into(),
            normalized_name: "sqlite".into(),
            aliases: vec!["SQLite".into()],
            props: serde_json::json!({
                "normalizedName": "sqlite",
                "aliases": ["SQLite"],
                "confidence": 0.8
            }),
        }];
        let raw = r#"{
          "entities": [
            {"id": "sqlite-db", "type": "tech_concept", "title": "Sqlite",
             "confidence": 0.95, "evidence": "用 SQLite"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "用 SQLite".into();
        let out = parse_extraction(raw, &anchors, &catalog);
        assert_eq!(out.entity_count, 1);
        assert_eq!(out.batch.nodes[0].key, "sem:tech_concept:sqlite");
        assert_eq!(
            out.batch.nodes[0]
                .props
                .get("confidence")
                .and_then(|v| v.as_f64()),
            Some(0.95)
        );
    }

    #[test]
    fn explicit_low_quality_drops_all_semantics() {
        let raw = r#"{
          "quality": "low",
          "priority": "normal",
          "entities": [
            {"id": "greet", "type": "tech_concept", "title": "问候",
             "confidence": 0.9, "evidence": "你好"}
          ],
          "relations": [
            {"type": "involves", "subject": "greet", "object": "src/login.rs"}
          ],
          "session_intent": "打招呼"
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "你好".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert_eq!(out.quality, ExtractionQuality::Low);
        assert!(!out.should_write_semantics());
        assert!(!out.should_emit_memory_event());
        assert_eq!(out.entity_count, 0);
        assert_eq!(out.relation_count, 0);
        assert!(out.batch.nodes.is_empty());
        // 低质量仍保留标题，避免图谱节点落成「未命名会话」。
        assert_eq!(out.intent.as_deref(), Some("打招呼"));
    }

    #[test]
    fn high_quality_keeps_llm_entity_edges() {
        let raw = r#"{
          "quality": "high",
          "priority": "high",
          "entities": [
            {"id": "sqlite", "type": "decision", "title": "用 SQLite 存图谱",
             "confidence": 0.95, "evidence": "决定用 SQLite 存图谱"},
            {"id": "rusqlite", "type": "tech_concept", "title": "rusqlite",
             "confidence": 0.9, "evidence": "决定用 SQLite 存图谱"}
          ],
          "relations": [
            {"type": "decided", "subject": "sqlite", "object": "rusqlite",
             "confidence": 0.9, "evidence": "决定用 SQLite 存图谱"}
          ]
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "决定用 SQLite 存图谱".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert_eq!(out.quality, ExtractionQuality::High);
        assert!(out.should_write_semantics());
        assert!(out.should_emit_memory_event());
        assert_eq!(out.entity_count, 2);
        assert!(out.relation_count >= 1);
        assert!(out.batch.edges.iter().any(|e| e.edge_type.starts_with("sem/")));
    }

    #[test]
    fn session_intent_does_not_spawn_open_task_when_durable_entities_exist() {
        let raw = r#"{
          "quality": "medium",
          "session_intent": "番茄钟功能如何实现",
          "entities": [
            {"id": "pomodoro", "type": "feature", "title": "番茄钟",
             "confidence": 0.85, "evidence": "番茄钟功能如何实现"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "番茄钟功能如何实现".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert_eq!(out.intent.as_deref(), Some("番茄钟功能如何实现"));
        assert!(
            !out.batch.nodes.iter().any(|n| n.node_type == "open_task"),
            "durable feature should suppress intent→open_task promotion"
        );
        let feature = out
            .batch
            .nodes
            .iter()
            .find(|n| n.node_type == "feature")
            .expect("feature kept");
        assert!(out.batch.edges.iter().any(|e| {
            e.edge_type == "extracted"
                && e.src_key == *anchors.turn_key.as_ref().unwrap()
                && e.dst_key == feature.key
        }));
        assert!(
            out.batch.nodes.iter().any(|n| n.node_type == "turn"),
            "extracted edge must materialize turn anchor"
        );
    }

    #[test]
    fn session_intent_becomes_open_task_when_no_durable_entities() {
        let raw = r#"{
          "quality": "medium",
          "session_intent": "番茄钟功能如何实现",
          "entities": [],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "番茄钟功能如何实现".into();
        let out = parse_extraction(raw, &anchors, &[]);
        let open_task = out
            .batch
            .nodes
            .iter()
            .find(|n| n.node_type == "open_task")
            .expect("open_task from session_intent when nothing else");
        assert_eq!(open_task.label, "番茄钟功能如何实现");
        assert!(out.batch.edges.iter().any(|e| {
            e.edge_type == "extracted"
                && e.src_key == *anchors.turn_key.as_ref().unwrap()
                && e.dst_key == open_task.key
        }));
    }

    #[test]
    fn session_intent_skips_duplicate_open_task() {
        let raw = r#"{
          "quality": "high",
          "session_intent": "登录超时如何修复",
          "entities": [
            {"id": "login-timeout", "type": "open_task", "title": "登录超时如何修复",
             "confidence": 0.9, "evidence": "登录超时如何修复"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "登录超时如何修复".into();
        let out = parse_extraction(raw, &anchors, &[]);
        let open_tasks: Vec<_> = out
            .batch
            .nodes
            .iter()
            .filter(|n| n.node_type == "open_task")
            .collect();
        assert_eq!(open_tasks.len(), 1);
    }

    #[test]
    fn cooccurring_orphans_get_linked_to_decision_hub() {
        let raw = r#"{
          "quality": "high",
          "entities": [
            {"id": "use-moka", "type": "decision", "title": "缓存用 moka 弃用 Redis",
             "chose": "moka", "rejected": "Redis", "confidence": 0.95,
             "evidence": "缓存用 moka 弃用 Redis"},
            {"id": "moka", "type": "tech_concept", "title": "moka",
             "confidence": 0.9, "evidence": "缓存用 moka 弃用 Redis"},
            {"id": "redis", "type": "tech_concept", "title": "Redis",
             "confidence": 0.85, "evidence": "缓存用 moka 弃用 Redis"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "缓存用 moka 弃用 Redis".into();
        let out = parse_extraction(raw, &anchors, &[]);
        let semantic_keys: std::collections::HashSet<_> = out
            .batch
            .nodes
            .iter()
            .filter(|n| SEMANTIC_ENTITY_TYPES.contains(&n.node_type))
            .map(|n| n.key.clone())
            .collect();
        assert_eq!(semantic_keys.len(), 3);
        let linked: std::collections::HashSet<_> = out
            .batch
            .edges
            .iter()
            .filter(|e| e.edge_type.starts_with("sem/"))
            .flat_map(|e| [e.src_key.clone(), e.dst_key.clone()])
            .collect();
        for key in &semantic_keys {
            assert!(
                linked.contains(key),
                "orphan {key} should be attached via co-occurrence"
            );
        }
        assert!(
            out.batch
                .edges
                .iter()
                .any(|e| e.edge_type == "sem/decided" || e.edge_type == "sem/involves"),
            "expected decided/involves edges, got {:?}",
            out.batch
                .edges
                .iter()
                .map(|e| e.edge_type)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn open_task_labels_similar_merges_explore_variants() {
        // 共享内容词（去话语停用词后）→ 同一探索 hub
        assert!(open_task_labels_similar(
            "了解番茄钟项目结构",
            "概览番茄钟应用目录"
        ));
        assert!(open_task_labels_similar(
            "番茄钟如何实现",
            "番茄钟功能如何实现"
        ));
        // 轻内容 + 非行动方面 → 探索 hub
        assert!(open_task_labels_similar(
            "通读项目结构",
            "了解项目目录"
        ));
        // 行动方面 vs 探索方面：不合并
        assert!(!open_task_labels_similar("修复登录超时", "了解项目结构"));
        assert!(!open_task_labels_similar(
            "实现持久化到 localStorage",
            "了解番茄钟项目结构"
        ));
    }

    #[test]
    fn consolidate_similar_open_tasks_in_batch() {
        let raw = r#"{
          "quality": "high",
          "entities": [
            {"id": "explore-pomodoro", "type": "open_task", "title": "了解番茄钟项目结构",
             "confidence": 0.9, "evidence": "了解番茄钟项目结构"},
            {"id": "overview-pomodoro", "type": "open_task", "title": "概览番茄钟应用目录",
             "confidence": 0.85, "evidence": "概览番茄钟应用目录"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "了解番茄钟项目结构，并概览番茄钟应用目录".into();
        let out = parse_extraction(raw, &anchors, &[]);
        let open_tasks: Vec<_> = out
            .batch
            .nodes
            .iter()
            .filter(|n| n.node_type == "open_task")
            .collect();
        assert_eq!(open_tasks.len(), 1, "similar open_tasks should consolidate");
    }

    #[test]
    fn filter_tooling_noise_error_patterns() {
        let raw = r#"{
          "quality": "high",
          "entities": [
            {"id": "missing-fd", "type": "error_pattern", "title": "环境缺少 fd 导致回退 find",
             "confidence": 0.9, "evidence": "环境缺少 fd，回退使用 find"},
            {"id": "borrow", "type": "error_pattern", "title": "借用检查错误",
             "confidence": 0.9, "evidence": "借用检查错误已修复"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "环境缺少 fd，回退使用 find。借用检查错误已修复。".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert!(
            !out.batch.nodes.iter().any(|n| n.label.contains("fd")),
            "agent tooling gap should not become error_pattern"
        );
        assert!(
            out.batch
                .nodes
                .iter()
                .any(|n| n.node_type == "error_pattern" && n.label.contains("借用")),
            "real project error_pattern should remain"
        );
    }

    #[test]
    fn drops_nonsensical_relation_endpoints() {
        let raw = r#"{
          "quality": "high",
          "entities": [
            {"id": "explore", "type": "open_task", "title": "了解项目结构",
             "confidence": 0.9, "evidence": "了解项目结构"},
            {"id": "timer", "type": "module", "title": "计时模块",
             "confidence": 0.9, "evidence": "计时模块"},
            {"id": "fd-gap", "type": "error_pattern", "title": "编译失败缺依赖",
             "confidence": 0.9, "evidence": "编译失败缺依赖"}
          ],
          "relations": [
            {"type": "affects", "subject": "explore", "object": "src/login.rs",
             "confidence": 0.9, "evidence": "了解项目结构"},
            {"type": "located_in", "subject": "explore", "object": "src/login.rs",
             "confidence": 0.9, "evidence": "了解项目结构"},
            {"type": "pattern_of", "subject": "fd-gap", "object": "explore",
             "confidence": 0.9, "evidence": "编译失败缺依赖"},
            {"type": "blocked_by", "subject": "timer", "object": "explore",
             "confidence": 0.9, "evidence": "计时模块"},
            {"type": "involves", "subject": "explore", "object": "timer",
             "confidence": 0.9, "evidence": "了解项目结构"},
            {"type": "pattern_of", "subject": "fd-gap", "object": "src/login.rs",
             "confidence": 0.9, "evidence": "编译失败缺依赖"}
          ]
        }"#;
        let mut anchors = anchors();
        anchors.source_text =
            "了解项目结构。计时模块。编译失败缺依赖。".into();
        let out = parse_extraction(raw, &anchors, &[]);
        let explore_key = out
            .batch
            .nodes
            .iter()
            .find(|n| n.node_type == "open_task")
            .map(|n| n.key.clone())
            .expect("open_task");
        assert!(
            !out.batch.edges.iter().any(|e| {
                e.src_key == explore_key
                    && (e.edge_type == "sem/affects" || e.edge_type == "sem/located_in")
            }),
            "open_task must not affect/located_in files"
        );
        assert!(
            !out.batch
                .edges
                .iter()
                .any(|e| e.edge_type == "sem/pattern_of" && e.dst_key == explore_key),
            "pattern_of must not target open_task"
        );
        assert!(
            !out.batch.edges.iter().any(|e| {
                e.edge_type == "sem/blocked_by" && e.dst_key == explore_key
            }),
            "module must not be blocked_by open_task"
        );
        assert!(
            out.batch.edges.iter().any(|e| {
                e.edge_type == "sem/involves" && e.src_key == explore_key
            }),
            "open_task —involves→ module should keep"
        );
        assert!(
            out.batch
                .edges
                .iter()
                .any(|e| e.edge_type == "sem/pattern_of" && e.dst_key == "file:aaa"),
            "error_pattern —pattern_of→ file should keep"
        );
    }

    #[test]
    fn demotes_incomplete_decision_schema_to_feature() {
        let raw = r#"{
          "quality": "high",
          "entities": [
            {"id": "nav-layout", "type": "decision", "title": "底部导航 480px 布局",
             "confidence": 0.9, "evidence": "底部导航 480px 布局"},
            {"id": "sqlite-store", "type": "decision", "title": "存储用 SQLite 而非 Neo4j",
             "chose": "SQLite", "rejected": "Neo4j", "confidence": 0.95,
             "evidence": "存储用 SQLite 而非 Neo4j"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "底部导航 480px 布局；存储用 SQLite 而非 Neo4j".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert!(
            out.batch.nodes.iter().any(|n| {
                n.node_type == "feature"
                    && n.label.contains("480px")
                    && n.props.get("demotedFrom").and_then(|v| v.as_str()) == Some("decision")
            }),
            "product-surface decision without chose/rejected should demote to feature"
        );
        assert!(
            out.batch.nodes.iter().any(|n| n.node_type == "decision" && n.label.contains("SQLite")),
            "real decision with chose/rejected should remain"
        );
    }

    #[test]
    fn trim_entities_keeps_open_tasks_and_top_confidence() {
        let mut out = SemanticExtraction {
            batch: FactBatch::default(),
            entity_count: 0,
            relation_count: 0,
            entity_summaries: vec![],
            quality: ExtractionQuality::High,
            priority: ExtractionPriority::Normal,
            intent: None,
        };
        for i in 0..12 {
            let etype = if i == 0 { "open_task" } else { "feature" };
            out.batch.nodes.push(NodeFact {
                node_type: etype,
                key: format!("sem:{etype}:{i}"),
                label: format!("实体 {i}"),
                props: serde_json::json!({
                    "confidence": if i == 0 { 0.7 } else { (i as f64) / 20.0 }
                }),
                timestamp_ms: 1,
            });
            out.entity_count += 1;
        }
        trim_entities_if_needed(&mut out);
        assert!(out.batch.nodes.len() <= MAX_ENTITIES_PER_TURN);
        assert!(
            out.batch.nodes.iter().any(|n| n.node_type == "open_task"),
            "open_task must survive trim"
        );
    }

    #[test]
    fn requires_evidence_unless_high_confidence() {
        let raw = r#"{
          "quality": "high",
          "entities": [
            {"id": "no-ev", "type": "module", "title": "无证据模块", "confidence": 0.7},
            {"id": "hi-conf", "type": "module", "title": "高置信模块", "confidence": 0.9},
            {"id": "with-ev", "type": "feature", "title": "有证据功能",
             "confidence": 0.7, "evidence": "有证据功能"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "有证据功能".into();
        let out = parse_extraction(raw, &anchors, &[]);
        assert!(
            !out.batch.nodes.iter().any(|n| n.label.contains("无证据")),
            "medium-confidence without evidence must drop"
        );
        assert!(
            out.batch.nodes.iter().any(|n| n.label.contains("高置信")),
            "high-confidence may omit evidence"
        );
        assert!(
            out.batch.nodes.iter().any(|n| n.label.contains("有证据")),
            "with evidence should keep"
        );
    }

    #[test]
    fn consolidates_near_duplicate_modules() {
        let raw = r#"{
          "quality": "high",
          "entities": [
            {"id": "timer-core", "type": "module", "title": "番茄钟计时核心逻辑",
             "confidence": 0.9, "evidence": "番茄钟计时核心逻辑"},
            {"id": "timer-hook", "type": "module", "title": "番茄钟计时核心逻辑（useTimer）",
             "confidence": 0.85, "evidence": "番茄钟计时核心逻辑（useTimer）"}
          ],
          "relations": []
        }"#;
        let mut anchors = anchors();
        anchors.source_text = "番茄钟计时核心逻辑。番茄钟计时核心逻辑（useTimer）".into();
        let out = parse_extraction(raw, &anchors, &[]);
        let modules: Vec<_> = out
            .batch
            .nodes
            .iter()
            .filter(|n| n.node_type == "module")
            .collect();
        assert_eq!(modules.len(), 1, "near-duplicate modules should merge: {:?}", modules.iter().map(|m| &m.label).collect::<Vec<_>>());
    }
}

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
pub const SEMANTIC_RELATION_TYPES: [&str; 11] = [
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
    // 决策取代：subject（新决策）取代 object（旧决策）。检索默认排除被
    // 取代者（semantica include_superseded=False 思路）。
    "supersedes",
];

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
}

/// 实体/关系置信度下限：低于此值的猜测直接丢弃（对齐 semantica
/// ExtractionValidator 的 confidence 阈值思想；取 0.4 保 recall）。
const MIN_CONFIDENCE: f64 = 0.4;

/// 解析 extract 子代理的 JSON 输出。
///
/// 容错策略：剥 ```json 围栏、截取首个 `{` 到末个 `}`（模型偶发前后缀散文）；
/// 未知实体/关系类型丢弃（不硬凑，codegraph unresolved_refs 原则）；
/// 关系两端必须在实体集或输入给定的锚点（file 路径/session）中，否则丢。
///
/// 质量门槛（对齐 semantica 的边界控制）：
/// - confidence < [`MIN_CONFIDENCE`] 的实体/关系丢弃；
/// - 带 `evidence` 的实体/关系，evidence 必须是输入文本的逐字引用
///   （semantica temporal_source_text 思路），对不上原文视为幻觉丢弃；
///   未提供 evidence 不强制（保 recall，prompt 要求带）；
/// - 自环关系（src == dst）丢弃。
pub fn parse_extraction(
    raw: &str,
    anchors: &ExtractionAnchors,
) -> SemanticExtraction {
    let mut out = SemanticExtraction::default();
    let Some(json_text) = extract_json_object(raw) else {
        return out;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&json_text) else {
        return out;
    };

    // 会话意图提炼（顶层可选字段）：替代首条用户消息原文的长 dump。
    out.intent = parsed
        .get("session_intent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| s.chars().count() >= 4)
        .map(|s| snippet(s, 80));

    // 实体 → sem:<type> 节点；key = `sem:{type}:{slug}`。
    let mut valid_keys: Vec<String> = Vec::new();
    if let Some(entities) = parsed.get("entities").and_then(Value::as_array) {
        for entity in entities.iter().take(20) {
            let Some(etype) = entity.get("type").and_then(Value::as_str) else { continue };
            if !SEMANTIC_ENTITY_TYPES.contains(&etype) {
                continue;
            }
            // 置信度门槛：低置信猜测直接丢。
            if confidence_of(entity).is_some_and(|c| c < MIN_CONFIDENCE) {
                continue;
            }
            // evidence 逐字引用校验：提供了却对不上原文 → 幻觉，丢。
            let evidence = entity
                .get("evidence")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|e| !e.is_empty());
            if evidence.is_some_and(|e| !anchors.evidence_supported(e)) {
                continue;
            }
            let slug = entity
                .get("id")
                .or_else(|| entity.get("title"))
                .and_then(Value::as_str)
                .map(slugify)
                .filter(|s| !s.is_empty());
            let Some(slug) = slug else { continue };
            let raw_label = entity
                .get("title")
                .or_else(|| entity.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(&slug)
                .to_string();
            let mut props = serde_json::Map::new();
            for field in ["category", "scenario", "reasoning", "outcome", "confidence", "chose", "rejected", "because", "description", "evidence"] {
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
            let label = humanize_entity_label(etype, &raw_label, &props);
            let key = format!("sem:{etype}:{slug}");
            // node_type 直接用实体类别（白名单内 → 'static），前端按类型分色。
            let Some(node_type) = static_entity_type(etype) else { continue };
            out.batch.nodes.push(NodeFact {
                node_type,
                key: key.clone(),
                label: label.clone(),
                props: Value::Object(props),
                timestamp_ms: anchors.timestamp_ms,
            });
            // 语义实体 → 所在会话/turn 的锚边。
            if let Some(turn_key) = &anchors.turn_key {
                out.batch.edges.push(edge_fact(
                    turn_key,
                    &key,
                    "extracted",
                    anchors,
                    None,
                ));
            }
            valid_keys.push(key);
            out.entity_count += 1;
            if out.entity_summaries.len() < 8 {
                out.entity_summaries.push((etype.to_string(), label));
            }
        }
    }

    // 关系：src/dst 可以是实体 slug 或锚点（file:/session:/turn: 前缀）。
    if let Some(relations) = parsed.get("relations").and_then(Value::as_array) {
        for relation in relations.iter().take(30) {
            let Some(rtype) = relation.get("type").and_then(Value::as_str) else { continue };
            if !SEMANTIC_RELATION_TYPES.contains(&rtype) {
                continue;
            }
            // 置信度门槛。
            if confidence_of(relation).is_some_and(|c| c < MIN_CONFIDENCE) {
                continue;
            }
            // evidence 逐字引用校验（提供了就必须对得上原文）。
            let evidence = relation
                .get("evidence")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|e| !e.is_empty());
            if evidence.is_some_and(|e| !anchors.evidence_supported(e)) {
                continue;
            }
            let Some(src) = relation.get("subject").or_else(|| relation.get("source")).and_then(Value::as_str) else { continue };
            let Some(dst) = relation.get("object").or_else(|| relation.get("target")).and_then(Value::as_str) else { continue };
            let Some(src_key) = resolve_ref(src, &valid_keys, anchors) else { continue };
            let Some(dst_key) = resolve_ref(dst, &valid_keys, anchors) else { continue };
            // 自环关系无信息量，丢。
            if src_key == dst_key {
                continue;
            }
            // supersedes（新→旧）落库翻转为 superseded_by（旧→新）：
            // 检索按「src 是否被某 dst 取代」过滤，方向统一后查询简单。
            if rtype == "supersedes" {
                out.batch.edges.push(edge_fact(&dst_key, &src_key, "superseded_by", anchors, evidence));
            } else {
                out.batch.edges.push(edge_fact(&src_key, &dst_key, rtype, anchors, evidence));
            }
            out.relation_count += 1;
        }
    }

    // 模型常漏边：用同 turn 已抽实体 + 文件锚点做结构性补边（不发明新实体）。
    enrich_missing_relations(&mut out, anchors);
    out
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
    anchors: &ExtractionAnchors,
) -> Option<String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 1) 已声明的实体 slug（补全 sem:type: 前缀——先试原样，再按 type 猜）。
    if let Some(found) = entity_keys.iter().find(|k| k.ends_with(&format!(":{trimmed}"))) {
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
        // dst 非空与否判断时效性。
        "supersedes" => "sem/superseded_by",
        "superseded_by" => "sem/superseded_by",
        // 锚边（实体 → turn）：非语义关系，原样通过。
        "extracted" => "extracted",
        _ => "sem/related_to",
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
     "category": "data", "scenario": "需要本地零运维图存储", "reasoning": "rusqlite 已捆绑", "confidence": 0.9,
     "evidence": "用 SQLite 存资产图谱"},
    {"id": "login-retry", "type": "feature", "title": "配对重试", "evidence": "配对重试已完成"},
    {"id": "borrow-checker", "type": "error_pattern", "title": "借用检查错误", "evidence": "借用检查错误已修复"},
    {"id": "unknown-thing", "type": "person", "title": "应被丢弃"}
  ],
  "relations": [
    {"type": "affects", "subject": "sqlite-asset-graph", "object": "src/login.rs", "evidence": "用 SQLite 存资产图谱"},
    {"type": "implements", "subject": "session", "object": "login-retry"},
    {"type": "pattern_of", "subject": "borrow-checker", "object": "src/login.rs"},
    {"type": "involves", "subject": "sqlite-asset-graph", "object": "不存在的引用"}
  ]
}
```"#;

    #[test]
    fn parses_entities_and_fences() {
        let out = parse_extraction(SAMPLE, &anchors());
        // person 类型不在边界内 → 丢弃；其余 3 个保留。
        assert_eq!(out.entity_count, 3);
        let types: Vec<&String> = out.batch.nodes.iter().map(|n| &n.key).collect();
        assert!(types.iter().any(|k| k.contains("sem:decision:sqlite-asset-graph")));
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
        let out = parse_extraction(&wrapped, &anchors());
        assert_eq!(out.entity_count, 0);
        let garbage = parse_extraction("no json at all", &anchors());
        assert_eq!(garbage.entity_count, 0);
        let empty = parse_extraction("{\"entities\":[],\"relations\":[]}", &anchors());
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
             "confidence": 0.9, "evidence": "用 SQLite 存资产图谱"}
          ],
          "relations": [
            {"type": "affects", "subject": "good", "object": "good"},
            {"type": "affects", "subject": "good", "object": "src/login.rs", "confidence": 0.1},
            {"type": "affects", "subject": "good", "object": "src/login.rs", "evidence": "已决定采用 rusqlite"},
            {"type": "involves", "subject": "low-conf", "object": "src/login.rs"}
          ]
        }"#;
        let out = parse_extraction(raw, &anchors());
        // 低置信 + 假 evidence 的实体被丢，只剩 good。
        assert_eq!(out.entity_count, 1);
        assert!(out.batch.nodes.iter().all(|n| n.key.contains(":good")));
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
        let out = parse_extraction(raw, &anchors);
        assert_eq!(out.entity_count, 2);
        assert!(out.relation_count >= 1);
        let edge = out
            .batch
            .edges
            .iter()
            .find(|e| e.edge_type == "sem/superseded_by")
            .expect("superseded_by edge");
        // 方向翻转：src=被取代的旧决策，dst=新决策。
        assert!(edge.src_key.ends_with(":leveldb-store"));
        assert!(edge.dst_key.ends_with(":redb-store"));
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
        let out = parse_extraction(raw, &anchors);
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
        // 无 relations 时 enrich 应补 rationale / decided / affects。
        assert!(out.relation_count >= 2);
        let types: Vec<&str> = out.batch.edges.iter().map(|e| e.edge_type).collect();
        assert!(types.contains(&"sem/rationale"), "{types:?}");
        assert!(types.contains(&"sem/affects") || types.contains(&"sem/decided"), "{types:?}");
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
        let out = parse_extraction(raw, &anchors);
        assert_eq!(out.batch.nodes[0].label, "资产图谱存储采用 SQLite");
    }
}

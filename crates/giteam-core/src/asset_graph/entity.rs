//! 语义实体身份层：Semantica 式 normalize → resolve → merge（轻量版）。
//!
//! 不做 blocking 桶、embedding ER、独立冲突引擎；同 type 下精确归一化命中
//! 优先，否则 Levenshtein ratio ≥ [`FUZZY_RATIO`] 归并到已有 canonical。

use serde_json::{Map, Value};

/// 模糊归并阈值（桌面图规模小，严于 Semantica 默认 ~0.7）。
pub const FUZZY_RATIO: f64 = 0.88;

/// 按实体类型的归并阈值（问法多样的类型更宽）。机制：类型策略，而非词表特例。
#[must_use]
pub fn fuzzy_threshold_for(etype: &str) -> f64 {
    match etype {
        "open_task" => 0.72,
        "module" | "feature" | "tech_concept" => 0.82,
        _ => FUZZY_RATIO,
    }
}

/// 图中已有（或本批已决议）的语义实体目录项。
#[derive(Debug, Clone)]
pub struct CatalogEntity {
    pub key: String,
    pub entity_type: String,
    pub label: String,
    pub normalized_name: String,
    pub aliases: Vec<String>,
    /// 已有 props（跨 turn 合并用；批内新建可为空对象）。
    pub props: Value,
}

/// resolve 结果：写入用的 canonical key + 展示名 + 应并入的别名。
#[derive(Debug, Clone)]
pub struct ResolvedEntity {
    pub key: String,
    pub label: String,
    pub normalized_name: String,
    /// 相对 canonical 新增的别名（含本次原始名，若与 label/normalized 不同）。
    pub aliases_to_add: Vec<String>,
    /// 命中目录项时带回既有 props，供 [`merge_entity_props`]。
    pub existing_props: Option<Value>,
}

/// 归一化名：折叠空白、小写、去首尾标点噪声；保留语义词（与 slugify 不同）。
#[must_use]
pub fn normalize_name(s: &str) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = trim_edge_noise(&collapsed);
    trimmed.to_lowercase()
}

/// 新建实体的稳定 key：`sem:{type}:{normalized}`。
#[must_use]
pub fn entity_key(etype: &str, normalized: &str) -> String {
    format!("sem:{etype}:{normalized}")
}

/// 同 type 下：精确归一化 → 模糊 → 新建。
///
/// `in_batch` 优先于 `catalog`（同 turn 别名先并到本批节点）。
#[must_use]
pub fn resolve_entity(
    etype: &str,
    name: &str,
    catalog: &[CatalogEntity],
    in_batch: &[CatalogEntity],
) -> ResolvedEntity {
    let raw = name.trim();
    let normalized = normalize_name(raw);
    if normalized.is_empty() {
        let key = entity_key(etype, "_");
        return ResolvedEntity {
            key,
            label: raw.to_string(),
            normalized_name: String::new(),
            aliases_to_add: Vec::new(),
            existing_props: None,
        };
    }

    if let Some(hit) = find_exact(etype, &normalized, in_batch)
        .or_else(|| find_fuzzy(etype, &normalized, in_batch))
        .or_else(|| find_exact(etype, &normalized, catalog))
        .or_else(|| find_fuzzy(etype, &normalized, catalog))
    {
        let mut aliases_to_add = Vec::new();
        push_alias_if_new(&mut aliases_to_add, raw, &hit.label, &hit.aliases);
        return ResolvedEntity {
            key: hit.key.clone(),
            label: prefer_label(&hit.label, raw),
            normalized_name: hit.normalized_name.clone(),
            aliases_to_add,
            existing_props: Some(hit.props.clone()),
        };
    }

    let key = entity_key(etype, &normalized);
    let mut aliases_to_add = Vec::new();
    // 原始展示与归一化不同时记别名（如 "SQLite" → normalized "sqlite"）。
    if raw != normalized {
        aliases_to_add.push(raw.to_string());
    }
    ResolvedEntity {
        key,
        label: raw.to_string(),
        normalized_name: normalized,
        aliases_to_add,
        existing_props: None,
    }
}

/// aliases 并集、confidence 取 max、字符串 keep_most_complete。
#[must_use]
pub fn merge_entity_props(existing: &Value, incoming: &Value) -> Value {
    let mut out = Map::new();
    if let Some(obj) = existing.as_object() {
        for (k, v) in obj {
            out.insert(k.clone(), v.clone());
        }
    }
    let Some(inc) = incoming.as_object() else {
        return Value::Object(out);
    };

    // aliases 并集
    let mut aliases = string_list(out.get("aliases"));
    for a in string_list(inc.get("aliases")) {
        if !aliases.iter().any(|x| x == &a) {
            aliases.push(a);
        }
    }
    if !aliases.is_empty() {
        out.insert(
            "aliases".into(),
            Value::Array(aliases.into_iter().map(Value::String).collect()),
        );
    }

    // confidence max
    let conf = max_f64(out.get("confidence"), inc.get("confidence"));
    if let Some(c) = conf {
        out.insert("confidence".into(), json_number(c));
    }

    for (k, v) in inc {
        if k == "aliases" || k == "confidence" {
            continue;
        }
        // status：终态优先（done/closed/superseded 等），避免「更长字符串」把 done 盖回 open。
        if k == "status" {
            out.insert(k.clone(), prefer_status(out.get(k), v));
            continue;
        }
        match (out.get(k), v) {
            (None, _) | (Some(Value::Null), _) => {
                out.insert(k.clone(), v.clone());
            }
            (Some(existing_v), incoming_v) => {
                out.insert(k.clone(), keep_most_complete(existing_v, incoming_v));
            }
        }
    }

    // normalizedName：以 incoming 非空优先，否则保留 existing
    if let Some(n) = inc.get("normalizedName").and_then(Value::as_str) {
        if !n.is_empty() {
            out.insert("normalizedName".into(), Value::String(n.to_string()));
        }
    }

    Value::Object(out)
}

fn find_exact<'a>(
    etype: &str,
    normalized: &str,
    entries: &'a [CatalogEntity],
) -> Option<&'a CatalogEntity> {
    entries.iter().find(|e| {
        !is_retired_status(&e.props)
            && e.entity_type == etype
            && (e.normalized_name == normalized
                || e.aliases.iter().any(|a| normalize_name(a) == normalized))
    })
}

fn find_fuzzy<'a>(
    etype: &str,
    normalized: &str,
    entries: &'a [CatalogEntity],
) -> Option<&'a CatalogEntity> {
    let threshold = fuzzy_threshold_for(etype);
    let mut best: Option<(&CatalogEntity, f64)> = None;
    for e in entries {
        if e.entity_type != etype || is_retired_status(&e.props) {
            continue;
        }
        // Semantica/Graphiti 式：canonical + aliases 参与 fuzzy。
        let mut ratio = levenshtein_ratio(normalized, &e.normalized_name);
        for alias in &e.aliases {
            let a = normalize_name(alias);
            if a.is_empty() {
                continue;
            }
            ratio = ratio.max(levenshtein_ratio(normalized, &a));
        }
        if ratio < threshold {
            continue;
        }
        if best.is_none_or(|(_, r)| ratio > r) {
            best = Some((e, ratio));
        }
    }
    best.map(|(e, _)| e)
}

fn push_alias_if_new(out: &mut Vec<String>, raw: &str, label: &str, existing: &[String]) {
    let raw = raw.trim();
    if raw.is_empty() || raw == label {
        return;
    }
    if existing.iter().any(|a| a == raw || normalize_name(a) == normalize_name(raw)) {
        return;
    }
    out.push(raw.to_string());
}

fn prefer_label(existing: &str, incoming: &str) -> String {
    let a = existing.trim();
    let b = incoming.trim();
    if a.is_empty() {
        return b.to_string();
    }
    if b.is_empty() {
        return a.to_string();
    }
    // keep_most_complete：更长优先
    if b.chars().count() > a.chars().count() {
        b.to_string()
    } else {
        a.to_string()
    }
}

fn trim_edge_noise(s: &str) -> &str {
    s.trim_matches(|c: char| {
        c.is_ascii_punctuation()
            || matches!(
                c,
                '「' | '」' | '『' | '』' | '《' | '》' | '（' | '）' | '【' | '】' | '…' | '—' | '·'
            )
    })
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect(),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                Vec::new()
            } else {
                vec![t.to_string()]
            }
        }
        _ => Vec::new(),
    }
}

fn max_f64(a: Option<&Value>, b: Option<&Value>) -> Option<f64> {
    let parse = |v: Option<&Value>| -> Option<f64> {
        match v {
            Some(Value::Number(n)) => n.as_f64(),
            Some(Value::String(s)) => s.trim().parse().ok(),
            _ => None,
        }
    };
    match (parse(a), parse(b)) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (Some(x), None) | (None, Some(x)) => Some(x),
        (None, None) => None,
    }
}

fn json_number(c: f64) -> Value {
    serde_json::Number::from_f64(c)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn keep_most_complete(existing: &Value, incoming: &Value) -> Value {
    match (existing, incoming) {
        (Value::String(a), Value::String(b)) => {
            let at = a.trim();
            let bt = b.trim();
            if at.is_empty() {
                return incoming.clone();
            }
            if bt.is_empty() {
                return existing.clone();
            }
            if bt.chars().count() > at.chars().count() {
                incoming.clone()
            } else {
                existing.clone()
            }
        }
        (Value::Null, _) => incoming.clone(),
        (_, Value::Null) => existing.clone(),
        (Value::String(a), _) if a.trim().is_empty() => incoming.clone(),
        (_, Value::String(b)) if b.trim().is_empty() => existing.clone(),
        // 非字符串：已有非空则保留；否则用 incoming
        _ => existing.clone(),
    }
}

/// 生命周期 status：终态不可被活跃态盖回（Graphiti invalidation 单调性）。
fn prefer_status(existing: Option<&Value>, incoming: &Value) -> Value {
    fn status_str(v: Option<&Value>) -> Option<String> {
        v.and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    }
    fn terminal(s: &str) -> bool {
        matches!(
            s.to_ascii_lowercase().as_str(),
            "done" | "closed" | "resolved" | "cancelled" | "canceled" | "superseded"
        )
    }
    match (status_str(existing), status_str(Some(incoming))) {
        (_, Some(inc)) if terminal(&inc) => incoming.clone(),
        (Some(ex), _) if terminal(&ex) => existing.cloned().unwrap_or_else(|| incoming.clone()),
        (_, Some(_)) => incoming.clone(),
        (Some(_), None) => existing.cloned().unwrap_or(Value::Null),
        _ => incoming.clone(),
    }
}

/// props.status 是否表示已废止/关闭（读侧与 catalog 过滤共用）。
#[must_use]
pub fn is_retired_status(props: &Value) -> bool {
    props
        .get("status")
        .and_then(Value::as_str)
        .map(|s| {
            matches!(
                s.trim().to_ascii_lowercase().as_str(),
                "done" | "closed" | "resolved" | "cancelled" | "canceled" | "superseded"
            )
        })
        .unwrap_or(false)
}

/// 字符级 Levenshtein 相似度：`1 - dist / max(len)`。
#[must_use]
pub fn levenshtein_ratio(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let dist = levenshtein_distance(&a, &b);
    let max_len = a.len().max(b.len()) as f64;
    1.0 - (dist as f64 / max_len)
}

fn levenshtein_distance(a: &[char], b: &[char]) -> usize {
    let (n, m) = (a.len(), b.len());
    if n == 0 {
        return m;
    }
    if m == 0 {
        return n;
    }
    let mut prev: Vec<usize> = (0..=m).collect();
    let mut curr = vec![0; m + 1];
    for i in 1..=n {
        curr[0] = i;
        for j in 1..=m {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            curr[j] = (prev[j] + 1)
                .min(curr[j - 1] + 1)
                .min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[m]
}

/// 从节点 props / label 回填目录项（旧节点无 normalizedName 时用 label）。
#[must_use]
pub fn catalog_from_node(
    entity_type: &str,
    key: &str,
    label: &str,
    props: &Value,
) -> CatalogEntity {
    let normalized = props
        .get("normalizedName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| normalize_name(label));
    let aliases = string_list(props.get("aliases"));
    CatalogEntity {
        key: key.to_string(),
        entity_type: entity_type.to_string(),
        label: label.to_string(),
        normalized_name: normalized,
        aliases,
        props: props.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_folds_case_and_whitespace() {
        assert_eq!(normalize_name("  SQLite  "), "sqlite");
        assert_eq!(normalize_name("sqlite"), "sqlite");
        assert_eq!(normalize_name("Sqlite"), "sqlite");
        assert_eq!(normalize_name("配对  重试"), "配对 重试");
        assert_eq!(normalize_name("Hello!"), "hello");
    }

    #[test]
    fn resolve_exact_merges_case_variants() {
        let catalog = [CatalogEntity {
            key: entity_key("tech_concept", "sqlite"),
            entity_type: "tech_concept".into(),
            label: "SQLite".into(),
            normalized_name: "sqlite".into(),
            aliases: vec![],
            props: serde_json::json!({}),
        }];
        let hit = resolve_entity("tech_concept", "sqlite", &catalog, &[]);
        assert_eq!(hit.key, catalog[0].key);
        let hit2 = resolve_entity("tech_concept", "Sqlite", &catalog, &[]);
        assert_eq!(hit2.key, catalog[0].key);
    }

    #[test]
    fn resolve_fuzzy_boundary_chinese() {
        let catalog = [CatalogEntity {
            key: entity_key("feature", "配对重试"),
            entity_type: "feature".into(),
            label: "配对重试".into(),
            normalized_name: "配对重试".into(),
            aliases: vec![],
            props: serde_json::json!({}),
        }];
        // 「配对重试」vs「配对重试功能」：ratio = 1 - 2/6 ≈ 0.667 < 0.88 → 不合并
        let miss = resolve_entity("feature", "配对重试功能", &catalog, &[]);
        assert_ne!(miss.key, catalog[0].key);
        assert!(miss.key.contains("配对重试功能"));

        // 近邻：差 1 字且较短时可能过阈——「配对重试」vs「配对重」
        // 1 - 1/4 = 0.75 < 0.88 → 不合并
        let miss2 = resolve_entity("feature", "配对重", &catalog, &[]);
        assert_ne!(miss2.key, catalog[0].key);
    }

    #[test]
    fn resolve_cross_type_does_not_merge() {
        let catalog = [CatalogEntity {
            key: entity_key("tech_concept", "sqlite"),
            entity_type: "tech_concept".into(),
            label: "SQLite".into(),
            normalized_name: "sqlite".into(),
            aliases: vec![],
            props: serde_json::json!({}),
        }];
        let other = resolve_entity("module", "sqlite", &catalog, &[]);
        assert_ne!(other.key, catalog[0].key);
        assert!(other.key.starts_with("sem:module:"));
    }

    #[test]
    fn merge_props_aliases_confidence_and_strings() {
        let existing = serde_json::json!({
            "aliases": ["SQLite"],
            "confidence": 0.7,
            "description": "db",
            "normalizedName": "sqlite"
        });
        let incoming = serde_json::json!({
            "aliases": ["sqlite"],
            "confidence": 0.9,
            "description": "embedded database",
            "evidence": "用 SQLite"
        });
        let merged = merge_entity_props(&existing, &incoming);
        let aliases = merged["aliases"].as_array().unwrap();
        assert!(aliases.iter().any(|v| v.as_str() == Some("SQLite")));
        assert!(aliases.iter().any(|v| v.as_str() == Some("sqlite")));
        assert_eq!(merged["confidence"].as_f64(), Some(0.9));
        assert_eq!(merged["description"], "embedded database");
        assert_eq!(merged["evidence"], "用 SQLite");
    }

    #[test]
    fn in_batch_exact_hits_before_new_key() {
        let batch = [CatalogEntity {
            key: entity_key("tech_concept", "sqlite"),
            entity_type: "tech_concept".into(),
            label: "SQLite".into(),
            normalized_name: "sqlite".into(),
            aliases: vec!["SQLite".into()],
            props: serde_json::json!({"aliases": ["SQLite"]}),
        }];
        let hit = resolve_entity("tech_concept", "sqlite", &[], &batch);
        assert_eq!(hit.key, batch[0].key);
    }

    #[test]
    fn fuzzy_matches_against_aliases() {
        let catalog = vec![CatalogEntity {
            key: "sem:tech_concept:sqlite".into(),
            entity_type: "tech_concept".into(),
            label: "SQLite".into(),
            normalized_name: "sqlite".into(),
            aliases: vec!["rusqlite crate".into()],
            props: serde_json::json!({}),
        }];
        let hit = resolve_entity("tech_concept", "rusqlite crate", &catalog, &[]);
        assert_eq!(hit.key, "sem:tech_concept:sqlite");
    }
}

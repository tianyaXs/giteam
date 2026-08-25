//! 查询层：跨会话上下文检索。
//!
//! 消费者三处共用：pi agent 工具（asset_context 等）、启动注入摘要
//! （recent_changes_digest）、Control HTTP 端点（可视化）。全部只读。
//!
//! 语义保证（对应设计文档 §1a / §3）：
//! - 「谁改过这个文件、为什么」：`modified` 边 + 会话节点 props.intent
//!   回溯当时用户意图（意图链确定性存在，不需要 LLM）。
//! - 「这个错以前怎么修」：`failed_with` + `resolved_by` 边。
//! - 「未闭环事项」：有 `failed_with` 出边但无 `resolved_by` 的 Error 节点。

use rusqlite::Connection;

/// 只读查询句柄。
pub struct GraphQuery<'a> {
    db: &'a Connection,
}

/// 图谱规模统计。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCounts {
    pub nodes: i64,
    pub edges: i64,
    pub sessions: i64,
    pub files: i64,
    pub tool_calls: i64,
    pub errors: i64,
    pub commits: i64,
}

/// 近期会话摘要（启动注入 / asset_context 的主载荷）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDigest {
    pub session_key: String,
    pub session_label: String,
    pub intent: String,
    pub last_seen_ms: i64,
    pub files_modified: Vec<String>,
    pub commits: Vec<String>,
    /// 未闭环错误（该会话失败且未见 resolved_by）。
    pub unresolved_errors: Vec<String>,
}

/// 文件的跨会话修改史条目。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub session_key: String,
    pub intent: String,
    pub timestamp_ms: i64,
}

/// 错误修复先例。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrecedentHit {
    pub error_label: String,
    pub resolved_by_label: String,
    pub session_key: String,
    pub intent: String,
    pub timestamp_ms: i64,
}

/// 搜索命中。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeHit {
    pub node_id: String,
    pub node_type: String,
    pub label: String,
    pub last_seen_ms: i64,
}

/// 匹配节点的一跳邻居（sem/* 或关键过程边）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeighborHit {
    pub from_id: String,
    pub from_label: String,
    pub edge_type: String,
    pub neighbor_id: String,
    pub neighbor_type: String,
    pub neighbor_label: String,
}

/// 未闭环事项（开放任务 / 未修复错误）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenLoopHit {
    pub kind: String,
    pub node_id: String,
    pub label: String,
    pub detail: String,
}

/// 路径追溯的一跳。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceHop {
    pub node_id: String,
    pub node_type: String,
    pub label: String,
    /// 进入该节点所用边类型；起点为 None。
    pub via_edge: Option<String>,
}

/// build_context 的组合载荷（对齐 codegraph context：一次调用含邻域与开放回路）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBundle {
    pub matched_nodes: Vec<NodeHit>,
    pub recent_sessions: Vec<SessionDigest>,
    pub file_history: Vec<FileHistoryEntry>,
    pub unresolved_error_labels: Vec<String>,
    /// 命中节点的一跳邻居（决策↔文件、实体↔实体等）。
    pub neighbors: Vec<NeighborHit>,
    /// 未 closes 的 open_task + 未 resolved 的 error。
    pub open_loops: Vec<OpenLoopHit>,
    /// 任务像错误时内联的修复先例（免再调 asset_precedents）。
    pub precedents: Vec<PrecedentHit>,
}

/// 子图节点（可视化载荷）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubgraphNode {
    pub node_id: String,
    pub node_type: String,
    pub label: String,
    /// 原始 props JSON 字符串（前端按需解析 intent 等字段）。
    pub props: String,
    pub last_seen_ms: i64,
}

/// 同语义会话聚合点 id 前缀（`session_group:<label-hash>`；compact 总览把
/// 归一化标题相同的多个 session 合成一个可展开超节点，对齐 Kumu/Neptune super-node）。
pub const SESSION_GROUP_PREFIX: &str = "session_group:";

/// 子图边（可视化载荷）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubgraphEdge {
    pub src_id: String,
    pub dst_id: String,
    pub edge_type: String,
    pub timestamp_ms: i64,
}

/// subgraph 结果。
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubgraphView {
    pub center: String,
    pub nodes: Vec<SubgraphNode>,
    pub edges: Vec<SubgraphEdge>,
}

/// 时间范围过滤（闭区间，epoch ms；节点按 last_seen_ms、边按 timestamp_ms）。
/// None = 不过滤（默认）。
pub type TimeRange = (i64, i64);

impl<'a> GraphQuery<'a> {
    #[must_use]
    pub fn new(db: &'a Connection) -> Self {
        Self { db }
    }

    /// 图谱规模。
    #[must_use]
    pub fn counts(&self) -> GraphCounts {
        let count = |sql: &str| -> i64 { self.db.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
        GraphCounts {
            nodes: count("SELECT COUNT(*) FROM nodes"),
            edges: count("SELECT COUNT(*) FROM edges"),
            sessions: count("SELECT COUNT(*) FROM nodes WHERE type = 'session'"),
            files: count("SELECT COUNT(*) FROM nodes WHERE type = 'file'"),
            tool_calls: count("SELECT COUNT(*) FROM nodes WHERE type = 'tool_call'"),
            errors: count("SELECT COUNT(*) FROM nodes WHERE type = 'error'"),
            commits: count("SELECT COUNT(*) FROM nodes WHERE type = 'commit'"),
        }
    }

    /// 近期会话摘要（按最后活动倒序）。limit 上限 50。
    #[must_use]
    pub fn recent_sessions(&self, limit: usize) -> Vec<SessionDigest> {
        let limit: i64 = limit.clamp(1, 50) as i64;
        let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT key, label, props, last_seen_ms
            FROM nodes
            WHERE type = 'session'
            ORDER BY last_seen_ms DESC
            LIMIT ?1
            "#,
        ) else {
            return Vec::new();
        };
        let rows: Vec<(String, String, String, i64)> = stmt
            .query_map([limit], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map(|rows| rows.filter_map(std::result::Result::ok).collect())
            .unwrap_or_default();
        rows.into_iter()
            .map(|(session_key, session_label, props_json, last_seen_ms)| {
                let props: serde_json::Value =
                    serde_json::from_str(&props_json).unwrap_or(serde_json::json!({}));
                let intent = props
                    .get("intent")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let session_id = props
                    .get("sessionId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string();
                SessionDigest {
                    files_modified: self.session_assets(&session_id, "modified", "file"),
                    commits: self.session_assets(&session_id, "produced", "commit"),
                    unresolved_errors: self.session_unresolved_errors(&session_id),
                    session_key,
                    session_label,
                    intent,
                    last_seen_ms,
                }
            })
            .collect()
    }

    /// 会话在某资产关系下的目标 label 列表（modified→file / produced→commit）。
    fn session_assets(&self, session_id: &str, edge_type: &str, target_type: &str) -> Vec<String> {
        let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT dst.label
            FROM edges e
            JOIN nodes dst ON dst.id = e.dst_id AND dst.type = ?2
            WHERE e.type = ?1 AND e.session_id = ?3
            ORDER BY e.timestamp_ms DESC
            LIMIT 20
            "#,
        ) else {
            return Vec::new();
        };
        let mut seen = std::collections::HashSet::new();
        stmt.query_map([edge_type, target_type, session_id], |row| row.get::<_, String>(0))
            .map(|rows| {
                rows.filter_map(std::result::Result::ok)
                    .filter(|label| seen.insert(label.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 会话内未闭环错误（failed_with 无 resolved_by）。
    fn session_unresolved_errors(&self, session_id: &str) -> Vec<String> {
        let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT err.label
            FROM edges fail
            JOIN nodes err ON err.id = fail.dst_id AND err.type = 'error'
            WHERE fail.type = 'failed_with' AND fail.session_id = ?1
              AND NOT EXISTS (
                SELECT 1 FROM edges res
                WHERE res.type = 'resolved_by' AND res.src_id = err.id
              )
            ORDER BY fail.timestamp_ms DESC
            LIMIT 10
            "#,
        ) else {
            return Vec::new();
        };
        stmt.query_map([session_id], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(std::result::Result::ok).collect())
            .unwrap_or_default()
    }

    /// 文件的跨会话修改史：哪个会话、什么意图、什么时候改过（含读过的会话）。
    #[must_use]
    pub fn file_history(&self, file_label: &str) -> Vec<FileHistoryEntry> {
        let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT e.session_id, e.timestamp_ms
            FROM edges e
            JOIN nodes f ON f.id = e.dst_id AND f.type = 'file'
            WHERE e.type = 'modified' AND f.label = ?1
            ORDER BY e.timestamp_ms DESC
            LIMIT 20
            "#,
        ) else {
            return Vec::new();
        };
        let rows: Vec<(String, i64)> = stmt
            .query_map([file_label], |row| Ok((row.get(0)?, row.get(1)?)))
            .map(|rows| rows.filter_map(std::result::Result::ok).collect())
            .unwrap_or_default();
        rows.into_iter()
            .map(|(session_id, timestamp_ms)| {
                let (session_key, intent) = self.session_intent(&session_id);
                FileHistoryEntry {
                    session_key,
                    intent,
                    timestamp_ms,
                }
            })
            .collect()
    }

    /// session_id → (session_key, intent)。
    fn session_intent(&self, session_id: &str) -> (String, String) {
        self.db
            .query_row(
                "SELECT key, props FROM nodes
                 WHERE type = 'session' AND json_extract(props, '$.sessionId') = ?1
                 LIMIT 1",
                [session_id],
                |row| {
                    let key: String = row.get(0)?;
                    let props: String = row.get(1)?;
                    Ok((key, props))
                },
            )
            .ok()
            .map(|(key, props)| {
                let intent = serde_json::from_str::<serde_json::Value>(&props)
                    .ok()
                    .and_then(|v| {
                        v.get("intent")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_string)
                    })
                    .unwrap_or_default();
                (key, intent)
            })
            .unwrap_or_else(|| (String::new(), String::new()))
    }

    /// 错误修复先例：按错误文本（或其指纹）找 resolved_by 链。
    #[must_use]
    pub fn find_precedents(&self, error_text: &str) -> Vec<PrecedentHit> {
        let fingerprint = crate::asset_graph::extract::error_fingerprint(error_text);
        if fingerprint.is_empty() {
            return Vec::new();
        }
        let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT err.label, tool.label, e.session_id, e.timestamp_ms
            FROM edges e
            JOIN nodes err ON err.id = e.src_id AND err.type = 'error'
            JOIN nodes tool ON tool.id = e.dst_id
            WHERE e.type = 'resolved_by'
              AND (err.label LIKE ?1 OR json_extract(err.props, '$.fingerprint') LIKE ?1)
            ORDER BY e.timestamp_ms DESC
            LIMIT 10
            "#,
        ) else {
            return Vec::new();
        };
        // LIKE 用指纹前段（数字已抹平）做宽松匹配。
        let prefix: String = fingerprint.chars().take(40).collect::<String>().replace('%', "");
        let pattern = format!("%{prefix}%");
        let rows: Vec<(String, String, String, i64)> = stmt
            .query_map([&pattern], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map(|rows| rows.filter_map(std::result::Result::ok).collect())
            .unwrap_or_default();
        rows.into_iter()
            .map(|(error_label, resolved_by_label, session_id, timestamp_ms)| {
                let (session_key, intent) = self.session_intent(&session_id);
                PrecedentHit {
                    error_label,
                    resolved_by_label,
                    session_key,
                    intent,
                    timestamp_ms,
                }
            })
            .collect()
    }

    /// 混合检索：FTS5 + label/key LIKE（CJK 兜底），多通道合并去重。
    /// 默认排序：语义实体优先于过程层（message/file/tool…），再按新近。
    #[must_use]
    pub fn search(&self, query_text: &str, node_type: Option<&str>, limit: usize) -> Vec<NodeHit> {
        let limit = limit.clamp(1, 50);
        let trimmed = query_text.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        // 多取候选再排序截断，避免 message 噪声挤掉语义命中。
        let fetch = (limit.saturating_mul(4)).clamp(limit, 80);
        let mut hits: Vec<NodeHit> = Vec::new();

        // 通道 1：FTS5（unicode61 对 CJK 不分词，中文靠通道 2 兜底）。
        let fts_query = sanitize_fts(trimmed);
        if !fts_query.is_empty() {
            let sql = match node_type {
                Some(t) => format!(
                    "SELECT n.id, n.type, n.label, n.last_seen_ms
                     FROM nodes n JOIN nodes_fts f ON f.id = n.id
                     WHERE nodes_fts MATCH ?1 AND n.type = '{t}' LIMIT ?2"
                ),
                None => "SELECT n.id, n.type, n.label, n.last_seen_ms
                         FROM nodes n JOIN nodes_fts f ON f.id = n.id
                         WHERE nodes_fts MATCH ?1 LIMIT ?2"
                    .to_string(),
            };
            if let Ok(mut stmt) = self.db.prepare(&sql) {
                if let Ok(rows) = stmt.query_map(rusqlite::params![fts_query, fetch as i64], |row| {
                    Ok(NodeHit {
                        node_id: row.get(0)?,
                        node_type: row.get(1)?,
                        label: row.get(2)?,
                        last_seen_ms: row.get(3)?,
                    })
                }) {
                    hits.extend(rows.filter_map(std::result::Result::ok));
                }
            }
        }

        // 通道 2：label/key LIKE（整句 + 锚点分词，覆盖中文/路径/错误指纹）。
        let mut like_needles: Vec<String> = vec![trimmed.replace('%', "")];
        for anchor in extract_search_anchors(trimmed) {
            let a = anchor.replace('%', "");
            if a.len() >= 2 && !like_needles.iter().any(|n| n.eq_ignore_ascii_case(&a)) {
                like_needles.push(a);
            }
        }
        let sql = match node_type {
            Some(t) => format!(
                "SELECT id, type, label, last_seen_ms FROM nodes
                 WHERE (label LIKE ?1 OR key LIKE ?1) AND type = '{t}' LIMIT ?2"
            ),
            None => "SELECT id, type, label, last_seen_ms FROM nodes
                     WHERE label LIKE ?1 OR key LIKE ?1 LIMIT ?2"
                .to_string(),
        };
        if let Ok(mut stmt) = self.db.prepare(&sql) {
            for needle in &like_needles {
                let like = format!("%{needle}%");
                if let Ok(rows) = stmt.query_map(rusqlite::params![like, fetch as i64], |row| {
                    Ok(NodeHit {
                        node_id: row.get(0)?,
                        node_type: row.get(1)?,
                        label: row.get(2)?,
                        last_seen_ms: row.get(3)?,
                    })
                }) {
                    hits.extend(rows.filter_map(std::result::Result::ok));
                }
            }
        }

        
        // 会话/轮次展示名：用 props.intent 覆盖占位 label（与 compact 视图一致）。
        for hit in &mut hits {
            if hit.node_type == "session" || hit.node_type == "turn" {
                if let Ok((label, props)) = self.db.query_row(
                    "SELECT label, props FROM nodes WHERE id = ?1",
                    [&hit.node_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                ) {
                    hit.label = display_label_with_intent(&label, &props);
                }
            }
        }

        hits.retain(|h| !is_search_noise(h));
        // Codegraph 式多通道 max 分：精确路径/名 > 锚点共现 > 类型秩 > 新近。
        let anchors = extract_search_anchors(trimmed);
        let query_terms = token_set(trimmed);
        hits.sort_by(|a, b| {
            let sa = search_hit_score(a, trimmed, &anchors, &query_terms);
            let sb = search_hit_score(b, trimmed, &anchors, &query_terms);
            sb.partial_cmp(&sa)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    search_type_rank(&a.node_type).cmp(&search_type_rank(&b.node_type))
                })
                .then_with(|| b.last_seen_ms.cmp(&a.last_seen_ms))
        });
        hits.dedup_by(|a, b| a.node_id == b.node_id);
        hits.truncate(limit);
        hits
    }

    /// 复合上下文（asset_context 主载荷）：给定任务/文件/错误描述，
    /// 一次组合返回相关会话 + 文件修改史 + 相关错误。
    ///
    /// 排序（semantica context_retriever 思路）：
    /// - 文本重叠（任务描述与节点 label 的词重叠）为主信号；
    /// - 连通性加成：度数高的节点（被多次引用的决策/文件）最多 +20%；
    /// - 置信度参与：语义实体 props.confidence 高者优先；
    /// - 已废止事实（sem/superseded_by、sem/closed_by、status 终态）默认排除
    ///   （Graphiti invalidation / semantica include_superseded=False）。
    #[must_use]
    pub fn build_context(&self, task: &str) -> ContextBundle {
        let mut hits = self.search(task, None, 12);
        let retired = self.retired_node_ids();
        hits.retain(|hit| !retired.contains(&hit.node_id));
        let query_terms = token_set(task);
        let mut scored: Vec<(f64, NodeHit)> = hits
            .into_iter()
            .map(|hit| {
                let overlap = jaccard(&query_terms, &token_set(&hit.label));
                let degree = self.node_degree(&hit.node_id);
                let connectivity = (degree as f64 * 0.02).min(0.2);
                let confidence = self.node_confidence(&hit.node_id);
                let quality = self.node_quality_boost(&hit.node_id);
                (overlap + connectivity + confidence * 0.1 + quality, hit)
            })
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let hits: Vec<NodeHit> = scored.into_iter().map(|(_, hit)| hit).collect();
        let mut file_entries = Vec::new();
        let mut error_labels = Vec::new();
        for hit in &hits {
            match hit.node_type.as_str() {
                "file" => file_entries.extend(self.file_history(&hit.label)),
                "error" => error_labels.push(hit.label.clone()),
                _ => {}
            }
        }
        let recent_sessions: Vec<SessionDigest> = self
            .recent_sessions(8)
            .into_iter()
            .filter(|s| !self.session_quality_is_low(&s.session_key))
            .take(5)
            .collect();
        let anchor_ids: Vec<String> = hits.iter().map(|h| h.node_id.clone()).collect();
        let neighbors = self.neighbors_of(&anchor_ids, 24);
        let mut open_loops = self.open_loops(8);
        let hit_labels: std::collections::HashSet<String> = hits
            .iter()
            .map(|h| h.label.to_ascii_lowercase())
            .collect();
        open_loops.sort_by_key(|loop_hit| {
            let needle = loop_hit.label.to_ascii_lowercase();
            let related = hit_labels.iter().any(|l| l.contains(&needle) || needle.contains(l));
            (!related, loop_hit.label.clone())
        });
        open_loops.truncate(8);

        let precedents = if looks_like_error(task) {
            self.find_precedents(task)
        } else {
            error_labels
                .iter()
                .flat_map(|label| self.find_precedents(label))
                .take(5)
                .collect()
        };

        ContextBundle {
            matched_nodes: hits,
            recent_sessions,
            file_history: file_entries,
            unresolved_error_labels: error_labels,
            neighbors,
            open_loops,
            precedents,
        }
    }

    /// 命中节点的一跳邻居（双向；优先 sem/*，兼收关键过程边）。
    #[must_use]
    pub fn neighbors_of(&self, node_ids: &[String], limit: usize) -> Vec<NeighborHit> {
        let limit = limit.clamp(1, 50);
        if node_ids.is_empty() {
            return Vec::new();
        }
        let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT e.src_id, src.label, src.type, e.type, e.dst_id, dst.type, dst.label
            FROM edges e
            JOIN nodes src ON src.id = e.src_id
            JOIN nodes dst ON dst.id = e.dst_id
            WHERE (e.src_id = ?1 OR e.dst_id = ?1)
              AND (
                    e.type LIKE 'sem/%'
                 OR e.type IN (
                        'modified','failed_with','resolved_by','produced','used_tool','executed','extracted'
                    )
              )
            ORDER BY e.timestamp_ms DESC
            LIMIT 40
            "#,
        ) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for id in node_ids {
            let rows = match stmt.query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            }) {
                Ok(rows) => rows.filter_map(std::result::Result::ok).collect::<Vec<_>>(),
                Err(_) => continue,
            };
            for (src_id, src_label, src_type, edge_type, dst_id, dst_type, dst_label) in rows {
                let (from_id, from_label, neighbor_id, neighbor_type, neighbor_label) =
                    if src_id == *id {
                        (src_id, src_label, dst_id, dst_type, dst_label)
                    } else {
                        (dst_id, dst_label, src_id, src_type, src_label)
                    };
                let key = (from_id.clone(), edge_type.clone(), neighbor_id.clone());
                if !seen.insert(key) {
                    continue;
                }
                out.push(NeighborHit {
                    from_id,
                    from_label,
                    edge_type,
                    neighbor_id,
                    neighbor_type,
                    neighbor_label,
                });
                if out.len() >= limit {
                    return out;
                }
            }
        }
        out
    }

    /// 未闭环：open_task（未 closed_by / 非终态）+ 无 resolved_by 的 error。
    #[must_use]
    pub fn open_loops(&self, limit: usize) -> Vec<OpenLoopHit> {
        let limit = limit.clamp(1, 30);
        let retired = self.retired_node_ids();
        let mut out = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT id, label FROM nodes
            WHERE type = 'open_task'
            ORDER BY last_seen_ms DESC
            LIMIT 40
            "#,
        ) {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for (id, label) in rows.flatten() {
                    if retired.contains(&id) {
                        continue;
                    }
                    out.push(OpenLoopHit {
                        kind: "open_task".into(),
                        node_id: id,
                        label,
                        detail: "尚未 closes".into(),
                    });
                    if out.len() >= limit {
                        return out;
                    }
                }
            }
        }
        if let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT err.id, err.label
            FROM nodes err
            WHERE err.type = 'error'
              AND EXISTS (
                    SELECT 1 FROM edges f
                    WHERE f.dst_id = err.id AND f.type = 'failed_with'
              )
              AND NOT EXISTS (
                    SELECT 1 FROM edges r
                    WHERE r.src_id = err.id AND r.type = 'resolved_by'
              )
            ORDER BY err.last_seen_ms DESC
            LIMIT 40
            "#,
        ) {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for (id, label) in rows.flatten() {
                    out.push(OpenLoopHit {
                        kind: "unresolved_error".into(),
                        node_id: id,
                        label,
                        detail: "无 resolved_by".into(),
                    });
                    if out.len() >= limit {
                        break;
                    }
                }
            }
        }
        out
    }

    /// 两点间最短路径（过程边 + sem/*），对齐 codegraph_trace。
    #[must_use]
    pub fn trace_path(&self, from: &str, to: &str, max_hops: u32) -> Vec<TraceHop> {
        let from = from.trim();
        let to = to.trim();
        if from.is_empty() || to.is_empty() {
            return Vec::new();
        }
        let max_hops = max_hops.clamp(1, 8);
        let Some(start_id) = self.resolve_node_ref(from) else {
            return Vec::new();
        };
        let Some(goal_id) = self.resolve_node_ref(to) else {
            return Vec::new();
        };
        if start_id == goal_id {
            return self
                .node_as_hop(&start_id, None)
                .into_iter()
                .collect();
        }

        use std::collections::{HashMap, HashSet, VecDeque};
        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();
        let mut parent: HashMap<String, (String, String)> = HashMap::new();
        queue.push_back((start_id.clone(), 0u32));
        visited.insert(start_id.clone());

        let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT e.src_id, e.dst_id, e.type FROM edges e
            WHERE (e.src_id = ?1 OR e.dst_id = ?1)
              AND (
                    e.type LIKE 'sem/%'
                 OR e.type IN (
                        'has_turn','has_message','used_tool','modified','failed_with',
                        'resolved_by','produced','executed','in_run','extracted'
                    )
              )
            "#,
        ) else {
            return Vec::new();
        };

        let mut reached = false;
        while let Some((current, depth)) = queue.pop_front() {
            if current == goal_id {
                reached = true;
                break;
            }
            if depth >= max_hops {
                continue;
            }
            let neighbors = stmt
                .query_map([&current], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map(|rows| rows.filter_map(std::result::Result::ok).collect::<Vec<_>>())
                .unwrap_or_default();
            for (src, dst, edge_type) in neighbors {
                let next = if src == current { dst } else { src };
                if !visited.insert(next.clone()) {
                    continue;
                }
                parent.insert(next.clone(), (current.clone(), edge_type));
                if next == goal_id {
                    reached = true;
                    // 不 break 外层：先把 parent 写好再退出
                    queue.clear();
                    break;
                }
                queue.push_back((next, depth + 1));
            }
        }
        if !reached {
            return Vec::new();
        }

        let mut ordered_ids = Vec::new();
        let mut cur = goal_id.clone();
        ordered_ids.push(cur.clone());
        while cur != start_id {
            let Some((par, _)) = parent.get(&cur).cloned() else {
                return Vec::new();
            };
            cur = par;
            ordered_ids.push(cur.clone());
        }
        ordered_ids.reverse();
        let mut hops = Vec::with_capacity(ordered_ids.len());
        for (idx, id) in ordered_ids.iter().enumerate() {
            let via = if idx == 0 {
                None
            } else {
                parent.get(id).map(|(_, e)| e.clone())
            };
            if let Some(hop) = self.node_as_hop(id, via) {
                hops.push(hop);
            }
        }
        hops
    }

    fn resolve_node_ref(&self, refer: &str) -> Option<String> {
        if let Ok(id) = self.db.query_row(
            "SELECT id FROM nodes WHERE id = ?1 OR key = ?1 OR label = ?1 LIMIT 1",
            [refer],
            |row| row.get::<_, String>(0),
        ) {
            return Some(id);
        }
        let like = format!("%{}%", refer.replace('%', ""));
        self.db
            .query_row(
                "SELECT id FROM nodes WHERE label LIKE ?1 OR key LIKE ?1
                 ORDER BY last_seen_ms DESC LIMIT 1",
                [like],
                |row| row.get::<_, String>(0),
            )
            .ok()
    }

    fn node_as_hop(&self, node_id: &str, via_edge: Option<String>) -> Option<TraceHop> {
        self.db
            .query_row(
                "SELECT id, type, label FROM nodes WHERE id = ?1",
                [node_id],
                |row| {
                    Ok(TraceHop {
                        node_id: row.get(0)?,
                        node_type: row.get(1)?,
                        label: row.get(2)?,
                        via_edge: via_edge.clone(),
                    })
                },
            )
            .ok()
    }

    /// 已废止的语义节点（取代边 / 关闭边 / props.status 终态）。
    fn retired_node_ids(&self) -> std::collections::HashSet<String> {
        let mut out = std::collections::HashSet::new();
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT DISTINCT src_id FROM edges
             WHERE type IN ('sem/superseded_by', 'sem/closed_by')",
        ) {
            if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                for id in rows.flatten() {
                    out.insert(id);
                }
            }
        }
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT id FROM nodes
             WHERE key LIKE 'sem:%'
               AND lower(COALESCE(json_extract(props, '$.status'), ''))
                   IN ('done', 'closed', 'resolved', 'cancelled', 'canceled', 'superseded')",
        ) {
            if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                for id in rows.flatten() {
                    out.insert(id);
                }
            }
        }
        out
    }

    /// 被取代的语义节点集合（存在 sem/superseded_by 出边 = 已有更新决策）。
    #[allow(dead_code)]
    fn superseded_node_ids(&self) -> std::collections::HashSet<String> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT DISTINCT src_id FROM edges WHERE type = 'sem/superseded_by'",
        ) else {
            return std::collections::HashSet::new();
        };
        stmt.query_map([], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(std::result::Result::ok).collect())
            .unwrap_or_default()
    }

    /// 节点度数（入+出）。连通性加成用（semantica context_boost ≤ +0.2）。
    fn node_degree(&self, node_id: &str) -> i64 {
        self.db
            .query_row(
                "SELECT (SELECT COUNT(*) FROM edges WHERE src_id = ?1)
                      + (SELECT COUNT(*) FROM edges WHERE dst_id = ?1)",
                [node_id],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    /// 语义实体置信度（props.confidence，0-1；过程层节点无则 0）。
    fn node_confidence(&self, node_id: &str) -> f64 {
        self.db
            .query_row(
                "SELECT json_extract(props, '$.confidence') FROM nodes WHERE id = ?1",
                [node_id],
                |row| row.get::<_, Option<f64>>(0),
            )
            .ok()
            .flatten()
            .unwrap_or(0.0)
            .clamp(0.0, 1.0)
    }

    /// props.quality 加权：high > medium > 缺省 > low（抑制低质会话/实体）。
    fn node_quality_boost(&self, node_id: &str) -> f64 {
        let raw: Option<String> = self
            .db
            .query_row(
                "SELECT json_extract(props, '$.quality') FROM nodes WHERE id = ?1",
                [node_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten();
        match raw
            .as_deref()
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("high") => 0.15,
            Some("medium") => 0.05,
            Some("low") => -0.2,
            _ => 0.0,
        }
    }

    /// 会话 props.quality == low。
    fn session_quality_is_low(&self, session_key: &str) -> bool {
        let props: Option<String> = self
            .db
            .query_row(
                "SELECT props FROM nodes WHERE key = ?1 AND type = 'session'",
                [session_key],
                |row| row.get(0),
            )
            .ok();
        props
            .as_deref()
            .map(session_props_quality_is_low)
            .unwrap_or(false)
    }

    /// 近期高质量语义实体行（启动摘要实体优先）。
    fn recent_high_quality_entity_lines(&self, limit: usize) -> Vec<String> {
        let limit = limit.clamp(1, 20);
        let Ok(mut stmt) = self.db.prepare(
            "SELECT type, label, props, last_seen_ms FROM nodes
             WHERE type IN (
               'decision','feature','module','tech_concept',
               'error_pattern','api','tradeoff','open_task'
             )
             ORDER BY last_seen_ms DESC
             LIMIT 40",
        ) else {
            return Vec::new();
        };
        let rows: Vec<(String, String, String, i64)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            })
            .map(|rows| rows.filter_map(std::result::Result::ok).collect())
            .unwrap_or_default();

        let mut high = Vec::new();
        let mut medium = Vec::new();
        for (ntype, label, props, last_seen) in rows {
            let parsed = serde_json::from_str::<serde_json::Value>(&props).ok();
            let quality = parsed
                .as_ref()
                .and_then(|v| v.get("quality").and_then(|q| q.as_str()))
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_else(|| {
                    let conf = parsed
                        .as_ref()
                        .and_then(|v| v.get("confidence").and_then(|c| c.as_f64()))
                        .unwrap_or(0.0);
                    if conf >= 0.8 {
                        "high".into()
                    } else if conf >= 0.5 {
                        "medium".into()
                    } else {
                        "low".into()
                    }
                });
            if quality == "low" {
                continue;
            }
            let line = format!(
                "- [{}] 实体/{}/「{}」",
                age_label(last_seen),
                ntype,
                truncate_chars(&label, 48)
            );
            if quality == "high" {
                high.push(line);
            } else {
                medium.push(line);
            }
        }
        let mut out = high;
        if out.len() < limit {
            out.extend(medium.into_iter().take(limit - out.len()));
        }
        out.truncate(limit);
        out
    }

    /// 局部子图（可视化用）：从中心节点 BFS 展开 hops 跳（双向邻接），限幅。
    /// center 可以是节点 id（`file:abc…`）、label（文件路径等）、或 `type:key`。
    /// 布局坐标不在此层——由前端 d3-force 计算（设计文档 §4.3）。
    /// `range`：时间过滤——非中心节点按 last_seen_ms、边按 timestamp_ms
    /// 落在闭区间内才保留（中心节点始终保留，保证下钻不空）。
    #[must_use]
    pub fn subgraph(
        &self,
        center: &str,
        hops: u32,
        limit: usize,
        range: Option<TimeRange>,
    ) -> SubgraphView {
        if center.trim().starts_with(SESSION_GROUP_PREFIX) {
            return self.session_group_subgraph(center.trim(), limit, range);
        }
        let limit = limit.clamp(1, 300);
        let hops = hops.clamp(1, 3);
        let Some(center_row) = self.resolve_center(center) else {
            return SubgraphView::default();
        };
        // 递归 CTE：双向展开（session→file 与 file→session 都要能走）。
        let sql = r#"
        WITH RECURSIVE walk(node_id, depth) AS (
            SELECT ?1, 0
            UNION
            SELECT e.dst_id, w.depth + 1
            FROM walk w JOIN edges e ON e.src_id = w.node_id
            WHERE w.depth < ?2
            UNION
            SELECT e.src_id, w.depth + 1
            FROM walk w JOIN edges e ON e.dst_id = w.node_id
            WHERE w.depth < ?2
        )
        SELECT n.id, n.type, n.label, n.props, n.last_seen_ms
        FROM nodes n
        JOIN (SELECT node_id, MIN(depth) AS depth FROM walk GROUP BY node_id) w
              ON w.node_id = n.id
        ORDER BY w.depth, n.last_seen_ms DESC
        LIMIT ?3
        "#;
        let mut nodes: Vec<SubgraphNode> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(sql) {
            if let Ok(rows) = stmt.query_map(
                rusqlite::params![center_row, i64::from(hops), limit as i64],
                |row| {
                    Ok(SubgraphNode {
                        node_id: row.get(0)?,
                        node_type: row.get(1)?,
                        label: row.get(2)?,
                        props: row.get(3)?,
                        last_seen_ms: row.get(4)?,
                    })
                },
            ) {
                nodes.extend(rows.filter_map(std::result::Result::ok));
            }
        }
        if nodes.is_empty() {
            return SubgraphView::default();
        }
        // 时间过滤：非中心节点按 last_seen_ms 落在区间内才保留
        // （BFS 展开不过滤——邻居的时间不应截断遍历路径，只影响最终渲染集）。
        if let Some((from, to)) = range {
            nodes.retain(|n| n.node_id == center_row || (n.last_seen_ms >= from && n.last_seen_ms <= to));
        }
        // 下钻视图去噪：丢掉无正文的 message（历史空 Tool/流式占位），
        // turn 若仍是裸 "turn N" 则用 props.intent 补标签。
        enrich_and_prune_process_nodes(&mut nodes, &center_row);
        // 子集内的边：按节点 id 分块 IN 过滤（节点集 ≤300，分块查询稳定，
        // 不依赖「全局最新 N 条」这种会漏旧会话边的截断）。
        let id_set: std::collections::HashSet<&str> =
            nodes.iter().map(|n| n.node_id.as_str()).collect();
        let mut edges: Vec<SubgraphEdge> = Vec::new();
        let ids: Vec<&str> = id_set.iter().copied().collect();
        for chunk in ids.chunks(100) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT src_id, dst_id, type, timestamp_ms FROM edges
                 WHERE src_id IN ({placeholders}) OR dst_id IN ({placeholders})"
            );
            // params 先于 stmt 声明（drop 顺序：stmt 先释放借用）。
            let mut params: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
            params.extend(chunk.iter().map(|id| id as &dyn rusqlite::ToSql));
            let Ok(mut stmt) = self.db.prepare(&sql) else {
                continue;
            };
            // 先绑定再 if let：query_map 的 Result 临时值不能活过 stmt。
            let mapped = stmt.query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            });
            if let Ok(rows) = mapped {
                for (src, dst, edge_type, ts) in rows.flatten() {
                    // 时间过滤：边按 timestamp_ms 落在区间内才保留。
                    if let Some((from, to)) = range {
                        if ts < from || ts > to {
                            continue;
                        }
                    }
                    // OR 命中单端也要筛：仅保留两端都在集合内的边。
                    if id_set.contains(src.as_str()) && id_set.contains(dst.as_str()) {
                        edges.push(SubgraphEdge {
                            src_id: src,
                            dst_id: dst,
                            edge_type,
                            timestamp_ms: ts,
                        });
                    }
                }
            }
        }
        edges.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
        SubgraphView {
            center: center_row,
            nodes,
            edges,
        }
    }

    /// 聚合点展开：按归一化标题找回成员会话，并带上各成员触达过的资产
    /// （touches/fixed 折叠边），让展开视图可直接看到「每个成员干了什么」。
    fn session_group_subgraph(
        &self,
        group_id: &str,
        limit: usize,
        range: Option<TimeRange>,
    ) -> SubgraphView {
        let limit = limit.clamp(1, 300);
        let (from, to) = range.unwrap_or((0, i64::MAX));
        // 全量 session 按归一化标题重组，定位目标组成员（组 id 是标题 hash）。
        let mut sessions: Vec<SubgraphNode> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT id, type, label, props, last_seen_ms FROM nodes
             WHERE type = 'session'
             ORDER BY last_seen_ms DESC LIMIT 500",
        ) {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok(SubgraphNode {
                    node_id: row.get(0)?,
                    node_type: row.get(1)?,
                    label: row.get(2)?,
                    props: row.get(3)?,
                    last_seen_ms: row.get(4)?,
                })
            }) {
                sessions.extend(rows.filter_map(std::result::Result::ok));
            }
        }
        sessions.retain(|n| !is_extraction_noise_label(&n.label));
        let mut members: Vec<SubgraphNode> = Vec::new();
        let mut group_label = String::new();
        {
            let mut by_label: std::collections::HashMap<String, Vec<SubgraphNode>> =
                std::collections::HashMap::new();
            for node in sessions {
                if is_placeholder_session_title(&node.label) {
                    continue;
                }
                let key = normalize_group_label(&node.label);
                if !key.is_empty() && !is_placeholder_session_title(&key) {
                    by_label.entry(key).or_default().push(node);
                }
            }
            for (label, group) in by_label {
                if group.len() >= 2 && super::store::node_id("session_group", &label) == group_id {
                    group_label = label;
                    members = group;
                    break;
                }
            }
        }
        if members.is_empty() {
            return SubgraphView::default();
        }
        let member_set: std::collections::HashSet<&str> =
            members.iter().map(|n| n.node_id.as_str()).collect();
        let mut nodes = members.clone();
        let mut edges: Vec<SubgraphEdge> = Vec::new();

        // 成员 → 资产折叠边（touches/fixed），与 compact 同规则但限定在成员内。
        let member_ids: Vec<String> = members.iter().map(|n| n.node_id.clone()).collect();
        let mut asset_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        for chunk in member_ids.chunks(50) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                r#"
                SELECT sess.id, asset.id, MAX(e3.timestamp_ms)
                FROM edges e1
                JOIN edges e2 ON e2.src_id = e1.dst_id AND e2.type = 'used_tool'
                JOIN edges e3 ON e3.src_id = e2.dst_id
                    AND e3.type IN ('modified','produced','failed_with')
                    AND e3.timestamp_ms BETWEEN ?1 AND ?2
                JOIN nodes sess ON sess.id = e1.src_id AND sess.type = 'session'
                JOIN nodes asset ON asset.id = e3.dst_id
                    AND asset.type NOT IN ('run','turn','message','tool_call')
                WHERE e1.type = 'has_turn' AND sess.id IN ({placeholders})
                GROUP BY sess.id, asset.id
                "#
            );
            let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 2);
            params.push(&from);
            params.push(&to);
            params.extend(chunk.iter().map(|id| id as &dyn rusqlite::ToSql));
            if let Ok(mut stmt) = self.db.prepare(&sql) {
                if let Ok(rows) = stmt.query_map(params.as_slice(), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                }) {
                    for (src, dst, ts) in rows.flatten() {
                        if member_set.contains(src.as_str()) {
                            asset_ids.insert(dst.clone());
                            edges.push(SubgraphEdge {
                                src_id: src,
                                dst_id: dst,
                                edge_type: "touches".to_string(),
                                timestamp_ms: ts,
                            });
                        }
                    }
                }
            }
        }
        // 资产节点行补齐。
        let asset_list: Vec<String> = asset_ids.into_iter().collect();
        for chunk in asset_list.chunks(100) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT id, type, label, props, last_seen_ms FROM nodes WHERE id IN ({placeholders})"
            );
            let params: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
            if let Ok(mut stmt) = self.db.prepare(&sql) {
                if let Ok(rows) = stmt.query_map(params.as_slice(), |row| {
                    Ok(SubgraphNode {
                        node_id: row.get(0)?,
                        node_type: row.get(1)?,
                        label: row.get(2)?,
                        props: row.get(3)?,
                        last_seen_ms: row.get(4)?,
                    })
                }) {
                    nodes.extend(rows.filter_map(std::result::Result::ok));
                }
            }
        }
        // member_of 结构边 + 超节点中心。
        for member in &members {
            edges.push(SubgraphEdge {
                src_id: group_id.to_string(),
                dst_id: member.node_id.clone(),
                edge_type: "member_of".to_string(),
                timestamp_ms: 0,
            });
        }
        let latest = members.iter().map(|n| n.last_seen_ms).max().unwrap_or(0);
        nodes.insert(
            0,
            SubgraphNode {
                node_id: group_id.to_string(),
                node_type: "session".to_string(),
                label: truncate_chars(&members[0].label, 48),
                props: serde_json::json!({
                    "count": members.len(),
                    "sessionGroup": group_label,
                    "members": members.iter().map(|m| m.node_id.clone()).collect::<Vec<_>>(),
                    "hint": "同语义会话聚合；点击展开查看成员"
                })
                .to_string(),
                last_seen_ms: latest,
            },
        );
        let _ = limit; // 成员通常远小于限幅；资产补齐已按组内实际计算。
        SubgraphView {
            center: group_id.to_string(),
            nodes,
            edges,
        }
    }

    /// session_key 是否标记为闲聊。
    /// 注意：有未闭环错误的会话绝不判闲聊（启动摘要必须提醒）。
    fn session_is_chitchat(&self, session_key: &str) -> bool {
        let flagged = self
            .db
            .query_row(
                "SELECT json_extract(props, '$.chitchat') FROM nodes
                 WHERE key = ?1 AND type = 'session'",
                [session_key],
                |row| row.get::<_, Option<bool>>(0),
            )
            .ok()
            .flatten()
            .unwrap_or(false);
        if !flagged {
            return false;
        }
        let session_id: String = self
            .db
            .query_row(
                "SELECT json_extract(props, '$.sessionId') FROM nodes
                 WHERE key = ?1 AND type = 'session'",
                [session_key],
                |row| row.get(0),
            )
            .unwrap_or_default();
        if session_id.is_empty() {
            return false;
        }
        // 有失败且无 resolved_by → 不视为闲聊。
        let unresolved: i64 = self
            .db
            .query_row(
                r#"
                SELECT COUNT(*) FROM edges fail
                WHERE fail.type = 'failed_with' AND fail.session_id = ?1
                  AND NOT EXISTS (
                    SELECT 1 FROM edges res
                    WHERE res.type = 'resolved_by' AND res.session_id = fail.session_id
                  )
                "#,
                [session_id.as_str()],
                |row| row.get(0),
            )
            .unwrap_or(0);
        unresolved == 0
    }

    fn sessions_unresolved_error_counts(
        &self,
        session_ids: &[String],
    ) -> std::collections::HashMap<String, i64> {
        let mut counts = std::collections::HashMap::new();
        for chunk in session_ids.chunks(50) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                r#"
                SELECT fail.session_id, COUNT(*) FROM edges fail
                WHERE fail.type = 'failed_with' AND fail.session_id IN ({placeholders})
                  AND NOT EXISTS (
                    SELECT 1 FROM edges res
                    WHERE res.type = 'resolved_by'
                      AND res.session_id = fail.session_id
                      AND res.src_id = fail.dst_id
                  )
                GROUP BY fail.session_id
                "#
            );
            let params: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
            if let Ok(mut stmt) = self.db.prepare(&sql) {
                if let Ok(rows) = stmt.query_map(params.as_slice(), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                }) {
                    for (sid, n) in rows.flatten() {
                        counts.insert(sid, n);
                    }
                }
            }
        }
        counts
    }

    /// 全图总览（Obsidian 打开即全图）。按新近度取最多 `limit` 个节点。
    ///
    /// `compact = true`（总览默认）时做**聚合折叠**（对齐 semantica
    /// grouped view）：过程节点（run/turn/message/tool_call）不渲染，
    /// 「会话→轮次→工具→资产」三跳链折叠成「会话→资产」直接边
    /// （touches/ran/faced/fixed 带次数聚合）。这是全图稀疏可读的关键——
    /// 否则过程链边占总边数 75%（370 used_tool + 177 has_message + 91
    /// has_turn + 91 in_run 对 931 节点），渲染即毛球。
    #[must_use]
    pub fn full_graph(&self, limit: usize) -> SubgraphView {
        self.full_graph_with_mode(limit, true, None)
    }

    /// 完整/聚合两种模式的总览图。`range`：节点按 last_seen_ms、
    /// 边按 timestamp_ms 落在闭区间内才保留（None = 不过滤）。
    #[must_use]
    pub fn full_graph_with_mode(
        &self,
        limit: usize,
        compact: bool,
        range: Option<TimeRange>,
    ) -> SubgraphView {
        if compact {
            return self.compact_graph(limit, range);
        }
        self.full_graph_raw(limit, range)
    }

    /// 聚合折叠总览：会话/文件/命令/错误/提交 + 语义实体。
    /// 同语义会话（归一化标题相同、≥2 个）折叠为 `session_group:*` 超节点，
    /// 成员的 touches/fixed/语义边并到超节点上（对齐 Kumu/Neptune super-node；
    /// 展开走 [`Self::subgraph`]）。抽取子代理会话（管道内部）不进总览。
    fn compact_graph(&self, limit: usize, range: Option<TimeRange>) -> SubgraphView {
        let limit = limit.clamp(1, 1000);
        let (from, to) = range.unwrap_or((0, i64::MAX));
        // 1) 节点：外层只要语义实体 + 会话（文件/错误/提交留给会话下钻）。
        //    对齐「实体核 + 会话卫星」；过程层与资产细节都不进 compact 外层。
        let mut nodes: Vec<SubgraphNode> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT id, type, label, props, last_seen_ms FROM nodes
             WHERE type IN (
               'session',
               'decision','feature','module','tech_concept',
               'error_pattern','api','tradeoff','open_task'
             )
               AND last_seen_ms BETWEEN ?2 AND ?3
             ORDER BY last_seen_ms DESC LIMIT ?1",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![limit as i64, from, to], |row| {
                Ok(SubgraphNode {
                    node_id: row.get(0)?,
                    node_type: row.get(1)?,
                    label: row.get(2)?,
                    props: row.get(3)?,
                    last_seen_ms: row.get(4)?,
                })
            }) {
                nodes.extend(rows.filter_map(std::result::Result::ok));
            }
        }
        // 抽取子代理会话是管道内部产物，不进总览。
        nodes.retain(|n| !(n.node_type == "session" && is_extraction_noise_label(&n.label)));
        if nodes.is_empty() {
            return SubgraphView::default();
        }
        let id_set: std::collections::HashSet<&str> =
            nodes.iter().map(|n| n.node_id.as_str()).collect();

        // 2) 折叠边：会话 → 资产（modified/read/executed/produced/failed_with/
        //    resolved_by 经 turn→tool_call 三跳聚合，COUNT 入 props 可加权）。
        //    时间过滤加在原始事件（e3）上：先过滤再聚合，语义才是
        //    「区间内碰过」而非「最近一次碰在区间内」。
        let mut edges: Vec<SubgraphEdge> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT sess.id, asset.id, MAX(e3.type), COUNT(*) AS hits, MAX(e3.timestamp_ms)
            FROM edges e1
            JOIN edges e2 ON e2.src_id = e1.dst_id AND e2.type = 'used_tool'
            JOIN edges e3 ON e3.src_id = e2.dst_id
                AND e3.type IN ('modified','produced','failed_with')
                AND e3.timestamp_ms BETWEEN ?1 AND ?2
            JOIN nodes sess ON sess.id = e1.src_id AND sess.type = 'session'
            JOIN nodes asset ON asset.id = e3.dst_id
                AND asset.type NOT IN ('run','turn','message','tool_call')
            WHERE e1.type = 'has_turn'
            GROUP BY sess.id, asset.id
            LIMIT 600
            "#,
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![from, to], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            }) {
                for (src, dst, _kind, _hits, ts) in rows.flatten() {
                    if id_set.contains(src.as_str()) && id_set.contains(dst.as_str()) {
                        edges.push(SubgraphEdge {
                            src_id: src,
                            dst_id: dst,
                            edge_type: "touches".to_string(),
                            timestamp_ms: ts,
                        });
                    }
                }
            }
        }
        // 修复链折叠：会话 → 错误（resolved_by 反向到会话）。
        if let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT sess.id, err.id, MAX(res.timestamp_ms)
            FROM edges res
            JOIN edges used ON used.dst_id = res.dst_id AND used.type = 'used_tool'
            JOIN edges ht ON ht.dst_id = used.src_id AND ht.type = 'has_turn'
            JOIN nodes sess ON sess.id = ht.src_id AND sess.type = 'session'
            JOIN nodes err ON err.id = res.src_id AND err.type = 'error'
            WHERE res.type = 'resolved_by' AND res.timestamp_ms BETWEEN ?1 AND ?2
            GROUP BY sess.id, err.id
            "#,
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![from, to], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
            }) {
                for (src, dst, ts) in rows.flatten() {
                    if id_set.contains(src.as_str()) && id_set.contains(dst.as_str()) {
                        edges.push(SubgraphEdge {
                            src_id: src,
                            dst_id: dst,
                            edge_type: "fixed".to_string(),
                            timestamp_ms: ts,
                        });
                    }
                }
            }
        }
        // 语义边（两端都在聚合节点集内）——直接 sem/*；turn→entity 的 extracted
        // 在下一步上卷为 session→entity（mentions），对齐 Semantica conversation→entity。
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT src_id, dst_id, type, timestamp_ms FROM edges
             WHERE type LIKE 'sem/%'
               AND timestamp_ms BETWEEN ?1 AND ?2",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![from, to], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            }) {
                for (src, dst, edge_type, ts) in rows.flatten() {
                    if id_set.contains(src.as_str()) && id_set.contains(dst.as_str()) {
                        edges.push(SubgraphEdge {
                            src_id: src,
                            dst_id: dst,
                            edge_type,
                            timestamp_ms: ts,
                        });
                    }
                }
            }
        }

        // 2b) 上卷 provenance：session -has_turn→ turn -extracted→ entity
        //     → session -mentions→ entity（总览可见会话卫星挂实体）。
        let mut mentioned_entity_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        let mut session_has_entity: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        if let Ok(mut stmt) = self.db.prepare(
            r#"
            SELECT sess.id, ent.id, MAX(ex.timestamp_ms)
            FROM edges ex
            JOIN nodes turn ON turn.id = ex.src_id AND turn.type = 'turn'
            JOIN edges ht ON ht.dst_id = turn.id AND ht.type = 'has_turn'
            JOIN nodes sess ON sess.id = ht.src_id AND sess.type = 'session'
            JOIN nodes ent ON ent.id = ex.dst_id
            WHERE ex.type = 'extracted' AND ex.timestamp_ms BETWEEN ?1 AND ?2
            GROUP BY sess.id, ent.id
            LIMIT 800
            "#,
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![from, to], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            }) {
                for (sess, ent, ts) in rows.flatten() {
                    session_has_entity.insert(sess.clone());
                    if !id_set.contains(ent.as_str()) {
                        mentioned_entity_ids.insert(ent.clone());
                    }
                    if id_set.contains(sess.as_str()) || true {
                        // 会话可能稍后被过滤；先记下边，终检时再裁。
                        edges.push(SubgraphEdge {
                            src_id: sess,
                            dst_id: ent,
                            edge_type: "mentions".to_string(),
                            timestamp_ms: ts,
                        });
                    }
                }
            }
        }
        // 补齐被提到但不在 LIMIT 窗口内的实体节点（实体优先）。
        if !mentioned_entity_ids.is_empty() {
            let missing: Vec<String> = mentioned_entity_ids
                .into_iter()
                .filter(|id| !id_set.contains(id.as_str()))
                .collect();
            for chunk in missing.chunks(40) {
                let placeholders = vec!["?"; chunk.len()].join(",");
                let sql = format!(
                    "SELECT id, type, label, props, last_seen_ms FROM nodes WHERE id IN ({placeholders})"
                );
                if let Ok(mut stmt) = self.db.prepare(&sql) {
                    let params: Vec<&dyn rusqlite::ToSql> =
                        chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
                    if let Ok(rows) = stmt.query_map(params.as_slice(), |row| {
                        Ok(SubgraphNode {
                            node_id: row.get(0)?,
                            node_type: row.get(1)?,
                            label: row.get(2)?,
                            props: row.get(3)?,
                            last_seen_ms: row.get(4)?,
                        })
                    }) {
                        for node in rows.flatten() {
                            nodes.push(node);
                        }
                    }
                }
            }
            // 重建 id_set
            let id_set: std::collections::HashSet<&str> =
                nodes.iter().map(|n| n.node_id.as_str()).collect();
            let _ = id_set; // 后面用 nodes 重算
        }

        // 2c) 外层会话 = 实体卫星：仅保留至少 mentions 到一个语义实体的 session；
        //     quality=low 且无实体连接 → 剔除。会话标 role=satellite。
        //     有资产改动但无实体的会话不进外层（细节在会话/资产下钻里看）。
        nodes.retain(|n| {
            if n.node_type != "session" {
                return true;
            }
            if !session_has_entity.contains(&n.node_id) {
                return false;
            }
            if session_props_quality_is_low(&n.props) {
                return false;
            }
            true
        });
        for node in &mut nodes {
            if node.node_type == "session" {
                mark_session_satellite_props(&mut node.props);
                node.label = display_label_with_intent(&node.label, &node.props);
            }
        }

        // 3) 同语义会话聚合：归一化标题相同（大小写/空白不敏感）的 session
        //    ≥2 个时折叠为一个 `session_group:*` 超节点；成员的资产/修复/语义边
        //    全部改指到超节点，拓扑信息不丢。
        let mut by_label: std::collections::HashMap<String, Vec<usize>> =
            std::collections::HashMap::new();
        for (idx, node) in nodes.iter().enumerate() {
            if node.node_type != "session" {
                continue;
            }
            if is_placeholder_session_title(&node.label) {
                continue;
            }
            let key = normalize_group_label(&node.label);
            if key.is_empty() || is_placeholder_session_title(&key) {
                continue;
            }
            by_label.entry(key).or_default().push(idx);
        }
        let mut member_to_group: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut grouped_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut group_nodes: Vec<SubgraphNode> = Vec::new();
        for (group_label, members) in &by_label {
            if members.len() < 2 {
                continue;
            }
            let group_id = super::store::node_id("session_group", group_label);
            let mut last_seen = 0i64;
            let mut display = String::new();
            let mut member_ids = Vec::with_capacity(members.len());
            for &idx in members {
                let node = &nodes[idx];
                last_seen = last_seen.max(node.last_seen_ms);
                if display.is_empty() {
                    display = node.label.clone();
                }
                member_ids.push(node.node_id.clone());
                grouped_ids.insert(node.node_id.clone());
                member_to_group.insert(node.node_id.clone(), group_id.clone());
            }
            group_nodes.push(SubgraphNode {
                node_id: group_id,
                node_type: "session".to_string(),
                label: truncate_chars(&display, 48),
                props: serde_json::json!({
                    "members": member_ids,
                    "count": members.len(),
                    "sessionGroup": group_label,
                    "role": "satellite",
                    "hint": "同语义会话聚合；点击展开查看成员"
                })
                .to_string(),
                last_seen_ms: last_seen,
            });
        }
        if !grouped_ids.is_empty() {
            nodes.retain(|n| !grouped_ids.contains(&n.node_id));
            nodes.extend(group_nodes);
            for edge in &mut edges {
                if let Some(group) = member_to_group.get(&edge.src_id) {
                    edge.src_id = group.clone();
                }
                if let Some(group) = member_to_group.get(&edge.dst_id) {
                    edge.dst_id = group.clone();
                }
            }
            // 组内自环 + 重边清理（保留最新时间戳）。
            edges.retain(|e| e.src_id != e.dst_id);
            let mut seen: std::collections::HashMap<(String, String, String), usize> =
                std::collections::HashMap::new();
            let mut deduped: Vec<SubgraphEdge> = Vec::with_capacity(edges.len());
            for edge in edges {
                let key = (edge.src_id.clone(), edge.dst_id.clone(), edge.edge_type.clone());
                if let Some(&pos) = seen.get(&key) {
                    if edge.timestamp_ms > deduped[pos].timestamp_ms {
                        deduped[pos].timestamp_ms = edge.timestamp_ms;
                    }
                } else {
                    seen.insert(key, deduped.len());
                    deduped.push(edge);
                }
            }
            edges = deduped;
        }
        // 终检：边端点必须在最终节点集内（聚合/噪声过滤后）。
        let final_ids: std::collections::HashSet<&str> =
            nodes.iter().map(|n| n.node_id.as_str()).collect();
        edges.retain(|e| {
            final_ids.contains(e.src_id.as_str()) && final_ids.contains(e.dst_id.as_str())
        });
        edges.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
        SubgraphView {
            center: String::new(),
            nodes,
            edges,
        }
    }

    /// 原始全图（下钻前的完整细节，保留过程节点）。
    #[must_use]
    pub fn full_graph_raw(&self, limit: usize, range: Option<TimeRange>) -> SubgraphView {
        let limit = limit.clamp(1, 1000);
        let (from, to) = range.unwrap_or((0, i64::MAX));
        let mut nodes: Vec<SubgraphNode> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT id, type, label, props, last_seen_ms FROM nodes
             WHERE last_seen_ms BETWEEN ?2 AND ?3
             ORDER BY last_seen_ms DESC LIMIT ?1",
        ) {
            if let Ok(rows) = stmt.query_map(rusqlite::params![limit as i64, from, to], |row| {
                Ok(SubgraphNode {
                    node_id: row.get(0)?,
                    node_type: row.get(1)?,
                    label: row.get(2)?,
                    props: row.get(3)?,
                    last_seen_ms: row.get(4)?,
                })
            }) {
                nodes.extend(rows.filter_map(std::result::Result::ok));
            }
        }
        if nodes.is_empty() {
            return SubgraphView::default();
        }
        // 节点集内边（分块 IN，与 subgraph 相同策略）。
        let id_set: std::collections::HashSet<&str> =
            nodes.iter().map(|n| n.node_id.as_str()).collect();
        let mut edges: Vec<SubgraphEdge> = Vec::new();
        let ids: Vec<&str> = id_set.iter().copied().collect();
        for chunk in ids.chunks(100) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!(
                "SELECT src_id, dst_id, type, timestamp_ms FROM edges
                 WHERE src_id IN ({placeholders}) OR dst_id IN ({placeholders})"
            );
            let mut params: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
            params.extend(chunk.iter().map(|id| id as &dyn rusqlite::ToSql));
            let Ok(mut stmt) = self.db.prepare(&sql) else { continue };
            let mapped = stmt.query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            });
            if let Ok(rows) = mapped {
                for (src, dst, edge_type, ts) in rows.flatten() {
                    if ts < from || ts > to {
                        continue;
                    }
                    if id_set.contains(src.as_str()) && id_set.contains(dst.as_str()) {
                        edges.push(SubgraphEdge {
                            src_id: src,
                            dst_id: dst,
                            edge_type,
                            timestamp_ms: ts,
                        });
                    }
                }
            }
        }
        edges.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
        SubgraphView {
            center: String::new(),
            nodes,
            edges,
        }
    }

    /// 按应用会话 id 反查会话节点 id（可视化「飞到当前会话」用）。
    /// 会话节点 props.sessionId 在写入时保证存在（extract.rs upsert 注释）。
    #[must_use]
    pub fn session_node_id(&self, session_id: &str) -> Option<String> {
        self.db
            .query_row(
                "SELECT id FROM nodes
                 WHERE type = 'session' AND json_extract(props, '$.sessionId') = ?1
                 ORDER BY last_seen_ms DESC LIMIT 1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
    }

    /// compact 总览里的焦点节点：若该会话已并入同语义超节点，返回超节点 id，
    /// 否则返回会话节点本身。视角跟踪必须指向图上真实存在的节点，否则金环/飞入空转。
    #[must_use]
    pub fn session_focus_node_id(&self, session_id: &str) -> Option<String> {
        let session_node = self.session_node_id(session_id)?;
        let label: String = self
            .db
            .query_row(
                "SELECT label FROM nodes WHERE id = ?1",
                [session_node.as_str()],
                |row| row.get(0),
            )
            .ok()?;
        let key = normalize_group_label(&label);
        if key.is_empty()
            || is_placeholder_session_title(&label)
            || is_placeholder_session_title(&key)
        {
            return Some(session_node);
        }
        // 同归一化标题的会话数 ≥2 → compact 会折叠，焦点应落在超节点上。
        let peers: i64 = self
            .db
            .query_row(
                "SELECT COUNT(*) FROM nodes WHERE type = 'session'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if peers < 2 {
            return Some(session_node);
        }
        // 精确统计同组：拉同 type 后在内存归一化比对（SQLite 无 Unicode fold）。
        let mut same = 0i64;
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT label FROM nodes WHERE type = 'session'",
        ) {
            if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                for other in rows.flatten() {
                    if is_extraction_noise_label(&other) {
                        continue;
                    }
                    if normalize_group_label(&other) == key {
                        same += 1;
                    }
                }
            }
        }
        if same >= 2 {
            Some(super::store::node_id("session_group", &key))
        } else {
            Some(session_node)
        }
    }

    /// center 解析：节点 id → key 精确 → label 精确 → `type:key` 形式。
    /// 注意 key 与 id 不同（id 是对 key 再 hash）：对外接口返回的
    /// sessionKey/fileKey 等是 key，必须走 key 通道命中。
    fn resolve_center(&self, center: &str) -> Option<String> {
        let trimmed = center.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Ok(id) = self.db.query_row(
            "SELECT id FROM nodes WHERE id = ?1",
            [trimmed],
            |row| row.get::<_, String>(0),
        ) {
            return Some(id);
        }
        if let Ok(id) = self.db.query_row(
            "SELECT id FROM nodes WHERE key = ?1 LIMIT 1",
            [trimmed],
            |row| row.get::<_, String>(0),
        ) {
            return Some(id);
        }
        if let Ok(id) = self.db.query_row(
            "SELECT id FROM nodes WHERE label = ?1 ORDER BY last_seen_ms DESC LIMIT 1",
            [trimmed],
            |row| row.get::<_, String>(0),
        ) {
            return Some(id);
        }
        if let Some((prefix, rest)) = trimmed.split_once(':') {
            if let Ok(id) = self.db.query_row(
                "SELECT id FROM nodes WHERE type = ?1 AND key = ?2 LIMIT 1",
                rusqlite::params![prefix, rest],
                |row| row.get::<_, String>(0),
            ) {
                return Some(id);
            }
        }
        None
    }

    /// 启动注入摘要：近期会话 → 紧凑 Markdown（确定性，零 LLM）。
    /// 每条 = 意图 + 改动文件 + 提交 + 未闭环错误。预算 ~2KB。
    /// 闲聊会话（props.chitchat）与 quality=low 会话不进摘要；优先列高质量实体。
    #[must_use]
    pub fn recent_changes_digest(&self, max_sessions: usize) -> String {
        let sessions = self.recent_sessions(max_sessions.saturating_mul(2));
        let mut lines: Vec<String> = Vec::with_capacity(sessions.len() + 8);
        // 高质量实体优先（实体核 → 会话卫星）；低质量会话跳过。
        for entity_line in self.recent_high_quality_entity_lines(6) {
            lines.push(entity_line);
        }
        for session in sessions {
            if session.intent.is_empty() {
                continue;
            }
            // 闲聊 / LLM quality=low 不入启动注入（避免「你好」类噪声）。
            if self.session_is_chitchat(&session.session_key)
                || self.session_quality_is_low(&session.session_key)
            {
                continue;
            }
            let files = if session.files_modified.is_empty() {
                String::new()
            } else {
                format!(
                    "：改了 {}",
                    session
                        .files_modified
                        .iter()
                        .take(5)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            };
            let commits = if session.commits.is_empty() {
                String::new()
            } else {
                format!(
                    "；产出 {}",
                    session.commits.iter().take(3).cloned().collect::<Vec<_>>().join(", ")
                )
            };
            let pending = if session.unresolved_errors.is_empty() {
                String::new()
            } else {
                format!(
                    "；未闭环错误：{}",
                    session
                        .unresolved_errors
                        .iter()
                        .take(2)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" / ")
                )
            };
            lines.push(format!(
                "- [{}] 会话 {}「{}」{}{}{}",
                age_label(session.last_seen_ms),
                truncate_chars(&session.session_label, 12),
                truncate_chars(&session.intent, 60),
                files,
                commits,
                pending
            ));
        }
        if lines.is_empty() {
            return String::new();
        }
        let mut digest =
            format!("## 仓库近期变更上下文（来自记忆，其他会话的记录）\n{}", lines.join("\n"));
        const BUDGET: usize = 2 * 1024;
        if digest.len() > BUDGET {
            let mut end = BUDGET;
            while end > 0 && !digest.is_char_boundary(end) {
                end -= 1;
            }
            digest.truncate(end);
            digest.push_str("\n…（摘要已达预算上限）");
        }
        digest
    }
}

/// 分词集合（文本重叠用）：ASCII 词 + CJK bigram，去停用词。
fn token_set(text: &str) -> std::collections::HashSet<String> {
    const STOP: [&str; 12] = [
        "the", "a", "an", "of", "to", "in", "for", "and", "or", "is", "这", "的",
    ];
    fn flush_cjk(
        run: &mut Vec<char>,
        out: &mut std::collections::HashSet<String>,
    ) {
        if run.len() >= 2 {
            for pair in run.windows(2) {
                out.insert(pair.iter().collect::<String>());
            }
        } else if run.len() == 1 {
            out.insert(run[0].to_string());
        }
        run.clear();
    }
    let mut tokens = std::collections::HashSet::new();
    let mut cjk_run: Vec<char> = Vec::new();
    let mut ascii_word = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            ascii_word.push(ch.to_ascii_lowercase());
            flush_cjk(&mut cjk_run, &mut tokens);
        } else if ('\u{4E00}'..='\u{9FFF}').contains(&ch) {
            if !ascii_word.is_empty() {
                if !STOP.contains(&ascii_word.as_str()) {
                    tokens.insert(ascii_word.clone());
                }
                ascii_word.clear();
            }
            cjk_run.push(ch);
        } else {
            if !ascii_word.is_empty() {
                if !STOP.contains(&ascii_word.as_str()) {
                    tokens.insert(ascii_word.clone());
                }
                ascii_word.clear();
            }
            flush_cjk(&mut cjk_run, &mut tokens);
        }
    }
    if !ascii_word.is_empty() && !STOP.contains(&ascii_word.as_str()) {
        tokens.insert(ascii_word);
    }
    flush_cjk(&mut cjk_run, &mut tokens);
    tokens
}

/// Jaccard 词重叠（semantica _calculate_decision_content_similarity 思路）。
fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let intersection = a.intersection(b).count();
    let union = a.union(b).count();
    intersection as f64 / union as f64
}

fn age_label(timestamp_ms: i64) -> String {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let delta_secs = (now_ms - timestamp_ms).max(0) / 1000;
    if delta_secs < 3600 {
        format!("{:2}m前", delta_secs / 60)
    } else if delta_secs < 86_400 {
        format!("{:2}h前", delta_secs / 3600)
    } else {
        format!("{:2}d前", delta_secs / 86_400)
    }
}

/// FTS5 查询消毒：保留字母数字，空格 AND 连接（FTS5 query 语法注入防护）。
fn sanitize_fts(text: &str) -> String {
    let terms: Vec<String> = text
        .split_whitespace()
        .map(|term| term.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|term: &String| !term.is_empty())
        .take(4)
        .collect();
    terms.join(" ")
}

/// 检索排序：语义实体 > 文件/会话 > 过程噪声。
fn looks_like_error(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("error")
        || lower.contains("panic")
        || lower.contains("failed")
        || lower.contains("错误")
        || lower.contains("失败")
        || lower.contains("e0")
        || (lower.contains("ts") && lower.contains("type"))
}

/// 从自然语言任务里抽出路径/标识符锚点（对齐 codegraph extractSymbolsFromQuery）。
fn extract_search_anchors(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let push = |s: &str, out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>| {
        let t = s.trim().trim_matches(|c: char| matches!(c, ',' | '.' | ';' | ':' | '"' | '\''));
        if t.len() < 2 {
            return;
        }
        let key = t.to_ascii_lowercase();
        if seen.insert(key) {
            out.push(t.to_string());
        }
    };
    for raw in text.split_whitespace() {
        if raw.contains('/') || raw.contains(".rs") || raw.contains(".ts") || raw.contains(".tsx") {
            push(raw, &mut out, &mut seen);
            if let Some(name) = raw.rsplit('/').next() {
                push(name, &mut out, &mut seen);
            }
        } else if raw.len() >= 3
            && raw
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            push(raw, &mut out, &mut seen);
        }
    }
    // CamelCase / snake_case / SCREAMING_SNAKE / error codes
    let re_tokens = regex_lite_anchors(text);
    for tok in re_tokens {
        push(&tok, &mut out, &mut seen);
    }
    out
}

fn regex_lite_anchors(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let flush = |cur: &mut String, out: &mut Vec<String>| {
        if cur.len() >= 2 {
            out.push(std::mem::take(cur));
        } else {
            cur.clear();
        }
    };
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            cur.push(ch);
        } else {
            flush(&mut cur, &mut out);
        }
    }
    flush(&mut cur, &mut out);
    out.into_iter()
        .filter(|t| {
            if t.len() < 3 {
                return false;
            }
            let lower = t.to_ascii_lowercase();
            const STOP: &[&str] = &[
                "the", "and", "for", "with", "from", "this", "that", "into", "over",
                "refactor", "module", "please", "fix", "bug",
            ];
            if STOP.contains(&lower.as_str()) {
                return false;
            }
            let has_upper = t.chars().any(|c| c.is_ascii_uppercase());
            let has_lower = t.chars().any(|c| c.is_ascii_lowercase());
            let has_sep = t.contains('_') || t.contains('-');
            let looks_err = t.chars().any(|c| c.is_ascii_digit()) && t.len() <= 12;
            (has_upper && has_lower)
                || has_sep
                || looks_err
                || t.contains('.')
                || (has_lower && t.chars().all(|c| c.is_ascii_alphanumeric()))
        })
        .collect()
}

fn search_hit_score(
    hit: &NodeHit,
    raw_query: &str,
    anchors: &[String],
    query_terms: &std::collections::HashSet<String>,
) -> f64 {
    let label = hit.label.to_ascii_lowercase();
    let q = raw_query.trim().to_ascii_lowercase();
    let mut score: f64 = 0.0;
    if !q.is_empty() && (label == q || hit.node_id.to_ascii_lowercase() == q) {
        score = score.max(10.0);
    }
    for a in anchors {
        let al = a.to_ascii_lowercase();
        if label == al {
            score = score.max(9.0);
        } else if label.ends_with(&al) || label.contains(&format!("/{al}")) {
            score = score.max(8.0);
        } else if label.contains(&al) {
            score = score.max(6.0);
        }
    }
    let overlap = jaccard(query_terms, &token_set(&hit.label));
    score = score.max(overlap * 5.0);
    // 类型微加成（语义实体略优先）
    score += match search_type_rank(&hit.node_type) {
        0 => 0.4,
        1 => 0.2,
        _ => 0.0,
    };
    score
}

fn search_type_rank(node_type: &str) -> u8 {
    if crate::asset_graph::semantic::SEMANTIC_ENTITY_TYPES.contains(&node_type) {
        0
    } else if matches!(node_type, "file" | "session" | "error" | "commit") {
        1
    } else if matches!(node_type, "turn" | "run") {
        2
    } else {
        // message / tool_call / command …
        3
    }
}

/// 下钻子图去噪：空正文 message 不渲染；裸 turn 标签用 props.intent 补全。
fn enrich_and_prune_process_nodes(nodes: &mut Vec<SubgraphNode>, center_id: &str) {
    nodes.retain(|n| {
        if n.node_id == center_id {
            return true;
        }
        if n.node_type != "message" {
            return true;
        }
        let label_blank = n.label.trim().is_empty() || n.label.trim() == "消息";
        if !label_blank {
            return true;
        }
        // props.text 为空 → 历史流式占位 / 空 Tool，直接丢掉。
        let text = serde_json::from_str::<serde_json::Value>(&n.props)
            .ok()
            .and_then(|v| {
                v.get("text")
                    .and_then(|t| t.as_str())
                    .map(str::trim)
                    .map(str::to_owned)
            })
            .unwrap_or_default();
        !text.is_empty()
    });
    for n in nodes.iter_mut() {
        if n.node_type != "turn" {
            continue;
        }
        let bare = {
            let t = n.label.trim();
            t.is_empty() || t.eq_ignore_ascii_case("turn") || {
                let rest = t
                    .strip_prefix("turn")
                    .or_else(|| t.strip_prefix("Turn"))
                    .unwrap_or("")
                    .trim();
                !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
            }
        };
        if !bare {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&n.props) {
            if let Some(intent) = v.get("intent").and_then(|t| t.as_str()).map(str::trim) {
                if intent.chars().count() >= 4 {
                    n.label = intent.chars().take(80).collect();
                }
            }
        }
    }
}

/// 丢掉抽取 prompt/JSON 污染与空标签过程消息。
fn is_search_noise(hit: &NodeHit) -> bool {
    let label = hit.label.trim();
    if label.is_empty() {
        return true;
    }
    if hit.node_type == "session" && is_extraction_noise_label(label) {
        return true;
    }
    if hit.node_type == "message" {
        if label.starts_with("Extract semantic entities") {
            return true;
        }
        if label.starts_with('{') && label.contains("\"entities\"") {
            return true;
        }
    }
    false
}

/// 会话 props.quality == low（LLM 质量档；非寒暄正则）。
fn session_props_quality_is_low(props: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(props)
        .ok()
        .and_then(|v| {
            v.get("quality")
                .and_then(|q| q.as_str())
                .map(|s| s.eq_ignore_ascii_case("low"))
        })
        .unwrap_or(false)
}

/// 总览里会话节点标为卫星（实体为主、会话环绕）。
fn mark_session_satellite_props(props: &mut String) {
    let mut value = serde_json::from_str::<serde_json::Value>(props)
        .unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = value.as_object_mut() {
        obj.insert("role".into(), serde_json::json!("satellite"));
    }
    *props = value.to_string();
}

/// 是否像会话/运行等内部 id（UUID、纯 hex、`session:<hash>`），禁止当展示名。
fn looks_like_opaque_id(label: &str) -> bool {
    let s = label.trim();
    if s.is_empty() {
        return true;
    }
    let lower = s.to_ascii_lowercase();
    // UUID（可截断）
    let uuidish = regex_is_uuidish(&lower);
    if uuidish {
        return true;
    }
    // 纯 hex 6..=32
    if lower.len() >= 6
        && lower.len() <= 32
        && lower.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return true;
    }
    // sess/session/run/... 前缀 + hex
    for prefix in ["sess", "session", "run", "msg", "turn"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            let rest = rest.trim_start_matches(['-', '_', ':']);
            if rest.len() >= 4 && rest.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
                return true;
            }
        }
    }
    // store::node_id 形态
    for prefix in [
        "session:",
        "run:",
        "turn:",
        "message:",
        "tool_call:",
        "file:",
        "session_group:",
    ] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            if rest.len() >= 8 && rest.chars().all(|c| c.is_ascii_hexdigit()) {
                return true;
            }
        }
    }
    false
}

fn regex_is_uuidish(s: &str) -> bool {
    // 8-4-4-4-12 或其截断前缀（历史 short(session_id)）
    let parts: Vec<&str> = s.split('-').collect();
    if parts.is_empty() {
        return false;
    }
    if !parts
        .iter()
        .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_hexdigit()))
    {
        return false;
    }
    match parts.as_slice() {
        [a] => a.len() == 8,
        [a, b] => a.len() == 8 && b.len() == 4,
        [a, b, c] => a.len() == 8 && b.len() == 4 && c.len() == 4,
        [a, b, c, d] => a.len() == 8 && b.len() == 4 && c.len() == 4 && d.len() == 4,
        [a, b, c, d, e] => {
            a.len() == 8 && b.len() == 4 && c.len() == 4 && d.len() == 4 && e.len() == 12
        }
        _ => false,
    }
}

/// 占位会话标题：不可作为「同语义聚合」键（否则多个无名会话会被错误合成一组）。
fn is_placeholder_session_title(label: &str) -> bool {
    let t = label.trim();
    t.is_empty()
        || t == "会话"
        || t.eq_ignore_ascii_case("session")
        || t == "未命名会话"
        || looks_like_opaque_id(t)
}

/// 节点展示名：优先 props.intent（turn 探索意图 / session 提炼问题）。
/// 会话节点若仍是内部 id / 占位「会话」，回落为「未命名会话」（不把 session id 当标题）。
fn display_label_with_intent(label: &str, props: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(props) {
        if let Some(intent) = value.get("intent").and_then(|v| v.as_str()) {
            let trimmed = intent.trim();
            // ≥2 字即可：短意图（如「hi」）也比占位「会话」有用。
            if trimmed.chars().count() >= 2 && !looks_like_opaque_id(trimmed) {
                return snippet(trimmed, 80);
            }
        }
    }
    let trimmed = label.trim();
    if looks_like_opaque_id(trimmed)
        || trimmed.eq_ignore_ascii_case("session")
        || trimmed.is_empty()
        || trimmed == "会话"
    {
        return "未命名会话".to_string();
    }
    trimmed.to_string()
}

fn snippet(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

/// 抽取子代理会话的标题特征（管道内部产物，不进总览/搜索）。
fn is_extraction_noise_label(label: &str) -> bool {
    label
        .trim_start()
        .starts_with(crate::asset_graph::extraction::EXTRACTION_USER_PROMPT_PREFIX)
}

/// 会话标题归一化：与实体层共用 [`crate::asset_graph::entity::normalize_name`]
///（大小写/空白/首尾标点不阻断同语义聚合；会话组仍要求归一化后完全相等）。
fn normalize_group_label(label: &str) -> String {
    crate::asset_graph::entity::normalize_name(label)
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    text.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asset_graph::extract::SessionAccumulator;
    use crate::asset_graph::store::{self, EdgeFact, FactBatch, NodeFact};
    use crate::pi_agent::{AgentEvent, AgentEventEnvelope};
    use crate::pi_agent::{AgentMessage, AgentPart, AgentRole};

    /// 用完整事件链种一个小图（两会话：一个改文件产提交，一个踩坑修坑）。
    fn seeded() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();

        // 会话 A：改 login.rs，产出提交。
        let mut a = SessionAccumulator::new("/repo", "sess-a", "run-a");
        a.ingest(&env(1, "sess-a", "run-a", AgentEvent::TurnStarted { index: 0 }));
        a.ingest(&env(2, "sess-a", "run-a", message("m1", AgentRole::User, "重构登录模块")));
        a.ingest(&env(
            3,
            "sess-a",
            "run-a",
            AgentEvent::ToolStarted {
                tool_call_id: "t1".into(),
                tool_name: "edit".into(),
                input: serde_json::json!({"file_path": "src/login.rs"}),
            },
        ));
        a.ingest(&env(
            4,
            "sess-a",
            "run-a",
            AgentEvent::ToolCompleted {
                tool_call_id: "t1".into(),
                tool_name: "edit".into(),
                output: serde_json::json!("ok"),
                is_error: false,
            },
        ));
        a.ingest(&env(
            5,
            "sess-a",
            "run-a",
            AgentEvent::ToolStarted {
                tool_call_id: "t2".into(),
                tool_name: "bash".into(),
                input: serde_json::json!({"command": "git commit -m fix"}),
            },
        ));
        a.ingest(&env(
            6,
            "sess-a",
            "run-a",
            AgentEvent::ToolCompleted {
                tool_call_id: "t2".into(),
                tool_name: "bash".into(),
                output: serde_json::json!("[main 8c1e2f3] fix"),
                is_error: false,
            },
        ));
        a.ingest(&env(7, "sess-a", "run-a", AgentEvent::TurnCompleted { index: 0 }));
        store::write_batch(&db, &a.take_batch()).unwrap();

        // 会话 B：构建失败 → 修复（resolved_by 链）。
        let mut b = SessionAccumulator::new("/repo", "sess-b", "run-b");
        b.ingest(&env(1, "sess-b", "run-b", AgentEvent::TurnStarted { index: 0 }));
        b.ingest(&env(2, "sess-b", "run-b", message("m2", AgentRole::User, "修构建失败")));
        b.ingest(&env(
            3,
            "sess-b",
            "run-b",
            AgentEvent::ToolStarted {
                tool_call_id: "t3".into(),
                tool_name: "bash".into(),
                input: serde_json::json!({"command": "cargo build"}),
            },
        ));
        b.ingest(&env(
            4,
            "sess-b",
            "run-b",
            AgentEvent::ToolCompleted {
                tool_call_id: "t3".into(),
                tool_name: "bash".into(),
                output: serde_json::json!("error[E0308]: mismatched types at line 42"),
                is_error: true,
            },
        ));
        b.ingest(&env(
            5,
            "sess-b",
            "run-b",
            AgentEvent::ToolStarted {
                tool_call_id: "t4".into(),
                tool_name: "bash".into(),
                input: serde_json::json!({"command": "cargo build"}),
            },
        ));
        b.ingest(&env(
            6,
            "sess-b",
            "run-b",
            AgentEvent::ToolCompleted {
                tool_call_id: "t4".into(),
                tool_name: "bash".into(),
                output: serde_json::json!("ok"),
                is_error: false,
            },
        ));
        b.ingest(&env(7, "sess-b", "run-b", AgentEvent::TurnCompleted { index: 0 }));
        store::write_batch(&db, &b.take_batch()).unwrap();
        (dir, db)
    }

    fn env(sequence: u64, session: &str, run: &str, event: AgentEvent) -> AgentEventEnvelope {
        AgentEventEnvelope {
            schema_version: 1,
            event_id: format!("e{sequence}"),
            sequence,
            repo_path: "/repo".into(),
            session_id: session.into(),
            run_id: Some(run.into()),
            timestamp_ms: sequence * 1000,
            event,
        }
    }

    fn message(id: &str, role: AgentRole, text: &str) -> AgentEvent {
        AgentEvent::MessageCompleted {
            message: AgentMessage {
                id: id.into(),
                role,
                created_at_ms: 0,
                parts: vec![AgentPart::Text { text: text.into() }],
            },
        }
    }

    #[test]
    fn counts_reflect_seeded_graph() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        let counts = q.counts();
        assert_eq!(counts.sessions, 2);
        assert!(counts.files >= 1);
        assert!(counts.commits >= 1);
        assert!(counts.errors >= 1);
    }

    #[test]
    fn file_history_recovers_intent() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        let history = q.file_history("src/login.rs");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].intent, "重构登录模块");
        assert!(history[0].session_key.starts_with("session:"));
    }

    #[test]
    fn precedents_find_resolution_chain() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        let hits = q.find_precedents("error[E0308]: mismatched types at line 99");
        assert!(!hits.is_empty(), "no precedents");
        assert_eq!(hits[0].intent, "修构建失败");
        assert!(hits[0].resolved_by_label.contains("bash"));
    }

    #[test]
    fn unresolved_errors_surface_in_digest() {
        let (dir, db) = seeded();
        // 会话 C：失败且未修复。
        let mut c = SessionAccumulator::new("/repo", "sess-c", "run-c");
        c.ingest(&env(1, "sess-c", "run-c", AgentEvent::TurnStarted { index: 0 }));
        c.ingest(&env(2, "sess-c", "run-c", message("m3", AgentRole::User, "加个功能")));
        c.ingest(&env(
            3,
            "sess-c",
            "run-c",
            AgentEvent::ToolStarted {
                tool_call_id: "t5".into(),
                tool_name: "bash".into(),
                input: serde_json::json!({"command": "make"}),
            },
        ));
        c.ingest(&env(
            4,
            "sess-c",
            "run-c",
            AgentEvent::ToolCompleted {
                tool_call_id: "t5".into(),
                tool_name: "bash".into(),
                output: serde_json::json!("fatal: something exploded at line 7"),
                is_error: true,
            },
        ));
        c.ingest(&env(5, "sess-c", "run-c", AgentEvent::TurnCompleted { index: 0 }));
        store::write_batch(&db, &c.take_batch()).unwrap();

        let q = GraphQuery::new(&db);
        let digest = q.recent_changes_digest(10);
        assert!(digest.contains("加个功能"), "{digest}");
        assert!(digest.contains("未闭环错误"), "{digest}");
        assert!(digest.contains("something exploded"), "{digest}");
        let _ = dir;
    }

    #[test]
    fn search_and_build_context() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        let hits = q.search("login", None, 10);
        assert!(hits.iter().any(|h| h.label == "src/login.rs"));
        let bundle = q.build_context("login.rs");
        assert!(!bundle.file_history.is_empty());
        assert_eq!(bundle.recent_sessions.len(), 2);
    }

    #[test]
    fn subgraph_expands_from_center() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        // 以文件为中心：应命中文件 + 经 modified 边连到 tool_call + 会话。
        let view = q.subgraph("src/login.rs", 2, 50, None);
        assert_eq!(view.nodes.len() >= 2, true, "nodes: {}", view.nodes.len());
        let types: Vec<&str> = view.nodes.iter().map(|n| n.node_type.as_str()).collect();
        assert!(types.contains(&"file"), "{types:?}");
        assert!(types.contains(&"tool_call") || types.contains(&"session"), "{types:?}");
        assert!(!view.edges.is_empty());
        // 全部边端点都在节点集内。
        let ids: std::collections::HashSet<&str> =
            view.nodes.iter().map(|n| n.node_id.as_str()).collect();
        for edge in &view.edges {
            assert!(ids.contains(edge.src_id.as_str()));
            assert!(ids.contains(edge.dst_id.as_str()));
        }
        // 未命中中心 → 空视图。
        let empty = q.subgraph("no-such-node", 2, 50, None);
        assert!(empty.nodes.is_empty());
    }

    #[test]
    fn full_graph_compact_rolls_up_process_chain() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        let view = q.full_graph(1000);
        // compact 外层：过程层与 file/error/commit 都不进；无实体时 seeded 会话也不保留。
        let types: std::collections::HashSet<&str> =
            view.nodes.iter().map(|n| n.node_type.as_str()).collect();
        for excluded in [
            "run", "turn", "message", "tool_call", "command", "file", "error", "commit",
        ] {
            assert!(!types.contains(excluded), "{excluded} should not be in entity-first outer layer");
        }
        let edge_types: Vec<&str> = view.edges.iter().map(|e| e.edge_type.as_str()).collect();
        assert!(!edge_types.contains(&"used_tool"));
        assert!(!edge_types.contains(&"has_turn"));
        // seeded 无语义实体 → 外层可为空（文件改动细节走会话下钻）。
        assert!(view.nodes.len() <= 3);
    }

    #[test]
    fn full_graph_raw_keeps_process_nodes() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        let view = q.full_graph_raw(1000, None);
        let types: std::collections::HashSet<&str> =
            view.nodes.iter().map(|n| n.node_type.as_str()).collect();
        for expected in ["session", "file", "error", "commit", "tool_call", "command"] {
            assert!(types.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn subgraph_respects_limit() {
        let (_dir, db) = seeded();
        let q = GraphQuery::new(&db);
        let view = q.subgraph("src/login.rs", 3, 2, None);
        assert!(view.nodes.len() <= 2);
    }

    #[test]
    fn compact_graph_groups_same_semantic_sessions() {
        let (dir, db) = seeded();
        // 三个同标题会话均 mentions 同一实体 → compact 聚成 session_group 卫星。
        let ts = 1_700_000_000_000u64;
        let entity_key = "sem:tech_concept:greeting".to_string();
        let mut nodes = vec![NodeFact {
            node_type: "tech_concept",
            key: entity_key.clone(),
            label: "问候".into(),
            props: serde_json::json!({"quality": "medium", "confidence": 0.8}),
            timestamp_ms: ts,
        }];
        let mut edges = Vec::new();
        for (i, (sid, label)) in [("sess-h1", "你好"), ("sess-h2", "你好"), ("sess-h3", "你好")]
            .into_iter()
            .enumerate()
        {
            let session_key = sid.to_string();
            let turn_key = format!("{sid}/turn/0");
            nodes.push(NodeFact {
                node_type: "session",
                key: session_key.clone(),
                label: label.into(),
                props: serde_json::json!({
                    "sessionId": sid,
                    "intent": "打招呼",
                    "quality": "medium"
                }),
                timestamp_ms: ts + i as u64,
            });
            nodes.push(NodeFact {
                node_type: "turn",
                key: turn_key.clone(),
                label: "turn 0".into(),
                props: serde_json::json!({}),
                timestamp_ms: ts + i as u64,
            });
            edges.push(EdgeFact {
                src_key: session_key,
                dst_key: turn_key.clone(),
                edge_type: "has_turn",
                props: serde_json::json!({}),
                session_id: sid.into(),
                run_id: "run-h".into(),
                event_id: format!("e-ht-{sid}"),
                sequence: (i as u64) * 2 + 1,
                timestamp_ms: ts + i as u64,
            });
            edges.push(EdgeFact {
                src_key: turn_key,
                dst_key: entity_key.clone(),
                edge_type: "extracted",
                props: serde_json::json!({}),
                session_id: sid.into(),
                run_id: "run-h".into(),
                event_id: format!("e-ex-{sid}"),
                sequence: (i as u64) * 2 + 2,
                timestamp_ms: ts + i as u64,
            });
        }
        store::write_batch(&db, &FactBatch { nodes, edges }).unwrap();
                let q = GraphQuery::new(&db);
        let view = q.full_graph(1000);
        let groups: Vec<&SubgraphNode> = view
            .nodes
            .iter()
            .filter(|n| n.node_id.starts_with(SESSION_GROUP_PREFIX))
            .collect();
        assert_eq!(groups.len(), 1, "expected exactly one group: {groups:?}");
        // 展示名优先 props.intent（「打招呼」），而非原始 label「你好」。
        assert!(groups[0].label.starts_with("打招呼"), "{}", groups[0].label);
        assert!(!groups[0].label.contains('×'), "label should not show ×N: {}", groups[0].label);
        let count = serde_json::from_str::<serde_json::Value>(&groups[0].props)
            .ok()
            .and_then(|v| v.get("count").and_then(|c| c.as_u64()))
            .unwrap_or(0);
        assert_eq!(count, 3, "props.count");
        // 组成员不再单独出现。
        let member_session_count = view
            .nodes
            .iter()
            .filter(|n| {
                n.node_type == "session" && !n.node_id.starts_with(SESSION_GROUP_PREFIX)
            })
            .count();
        // 外层只保留挂实体的会话；seeded 无实体会话不进 compact，组外 session 应为 0。
        assert_eq!(member_session_count, 0, "nodes: {:?}", view.nodes.iter().map(|n| &n.label).collect::<Vec<_>>());
        let _ = dir;
    }

    #[test]
    fn session_group_subgraph_expands_members_with_assets() {
        let (dir, db) = seeded();
        // 两个同标题会话，其中一个改了文件（验证资产边并入展开视图）。
        for (sid, with_tool) in [("sess-h1", true), ("sess-h2", false)] {
            let mut h = SessionAccumulator::new("/repo", sid, "run-h");
            h.ingest(&env(1, sid, "run-h", AgentEvent::TurnStarted { index: 0 }));
            h.ingest(&env(2, sid, "run-h", message("m-h", AgentRole::User, "查一下天气")));
            if with_tool {
                h.ingest(&env(
                    3,
                    sid,
                    "run-h",
                    AgentEvent::ToolStarted {
                        tool_call_id: "t-h".into(),
                        tool_name: "edit".into(),
                        input: serde_json::json!({"file_path": "src/weather.rs"}),
                    },
                ));
            }
            h.ingest(&env(4, sid, "run-h", AgentEvent::TurnCompleted { index: 0 }));
            store::write_batch(&db, &h.take_batch()).unwrap();
        }
        let q = GraphQuery::new(&db);
        let group_id = store::node_id("session_group", &normalize_group_label("查一下天气"));
        let view = q.subgraph(&group_id, 1, 100, None);
        assert_eq!(view.center, group_id);
        let member_count = view
            .nodes
            .iter()
            .filter(|n| n.node_type == "session" && n.node_id != group_id)
            .count();
        assert_eq!(member_count, 2, "nodes: {:?}", view.nodes.iter().map(|n| &n.label).collect::<Vec<_>>());
        assert!(view.edges.iter().any(|e| e.edge_type == "member_of"));
        // 有工具动作的成员把文件资产带进展开视图。
        assert!(view.nodes.iter().any(|n| n.label == "src/weather.rs"));
        assert!(view.edges.iter().any(|e| e.edge_type == "touches"));
        let _ = dir;
    }

    #[test]
    fn sanitize_fts_filters_and_joins() {
        assert_eq!(sanitize_fts("hello world"), "hello world");
        assert_eq!(sanitize_fts("a%b(c)"), "abc");
        assert_eq!(sanitize_fts("!!!"), "");
    }

    #[test]
    fn compact_drops_entityless_chitchat_session() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        let ts = 1_700_000_000_000u64;
        store::write_batch(
            &db,
            &FactBatch {
                nodes: vec![NodeFact {
                    node_type: "session",
                    key: "sess-hi".into(),
                    label: "你好".into(),
                    props: serde_json::json!({
                        "sessionId": "sess-hi",
                        "intent": "打招呼",
                        "quality": "low",
                        "chitchat": true
                    }),
                    timestamp_ms: ts,
                }],
                edges: vec![],
            },
        )
        .unwrap();
        let q = GraphQuery::new(&db);
        let view = q.full_graph(1000);
        assert!(
            !view.nodes.iter().any(|n| n.node_type == "session"),
            "entityless low-quality session must not appear in compact: {:?}",
            view.nodes.iter().map(|n| (&n.node_type, &n.label)).collect::<Vec<_>>()
        );
    }

    #[test]
    fn compact_rolls_extracted_into_mentions_satellites() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        let ts = 1_700_000_000_000u64;
        let session_key = "sess-sqlite".to_string();
        let turn_key = "sess-sqlite/turn/0".to_string();
        let entity_key = "sem:decision:sqlite-graph".to_string();
        store::write_batch(
            &db,
            &FactBatch {
                nodes: vec![
                    NodeFact {
                        node_type: "session",
                        key: session_key.clone(),
                        label: "定存储".into(),
                        props: serde_json::json!({
                            "sessionId": "sess-sqlite",
                            "intent": "选图谱存储",
                            "quality": "high"
                        }),
                        timestamp_ms: ts,
                    },
                    NodeFact {
                        node_type: "turn",
                        key: turn_key.clone(),
                        label: "turn 0".into(),
                        props: serde_json::json!({}),
                        timestamp_ms: ts,
                    },
                    NodeFact {
                        node_type: "decision",
                        key: entity_key.clone(),
                        label: "用 SQLite 存图谱".into(),
                        props: serde_json::json!({
                            "confidence": 0.95,
                            "quality": "high"
                        }),
                        timestamp_ms: ts,
                    },
                ],
                edges: vec![
                    EdgeFact {
                        src_key: session_key.clone(),
                        dst_key: turn_key.clone(),
                        edge_type: "has_turn",
                        props: serde_json::json!({}),
                        session_id: "sess-sqlite".into(),
                        run_id: "run-1".into(),
                        event_id: "e1".into(),
                        sequence: 1,
                        timestamp_ms: ts,
                    },
                    EdgeFact {
                        src_key: turn_key.clone(),
                        dst_key: entity_key.clone(),
                        edge_type: "extracted",
                        props: serde_json::json!({}),
                        session_id: "sess-sqlite".into(),
                        run_id: "run-1".into(),
                        event_id: "e2".into(),
                        sequence: 2,
                        timestamp_ms: ts,
                    },
                ],
            },
        )
        .unwrap();
        let q = GraphQuery::new(&db);
        let view = q.full_graph(1000);
        assert!(
            view.nodes.iter().any(|n| n.node_type == "decision"),
            "entity missing: {:?}",
            view.nodes
        );
        let session = view
            .nodes
            .iter()
            .find(|n| n.node_type == "session")
            .expect("session satellite should remain when linked to entity");
        let role = serde_json::from_str::<serde_json::Value>(&session.props)
            .ok()
            .and_then(|v| v.get("role").and_then(|r| r.as_str()).map(str::to_string));
        assert_eq!(role.as_deref(), Some("satellite"));
        assert!(
            view.edges.iter().any(|e| e.edge_type == "mentions"),
            "expected session-mentions->entity rollup, edges={:?}",
            view.edges.iter().map(|e| &e.edge_type).collect::<Vec<_>>()
        );
    }

    #[test]
    fn build_context_includes_neighbors_open_loops_and_precedents_fields() {
        let (dir, db) = seeded();
        let _ = dir;
        let q = GraphQuery::new(&db);
        let bundle = q.build_context("login.rs");
        // 字段应始终存在（可为空）；命中文件时至少有匹配节点。
        assert!(
            !bundle.matched_nodes.is_empty(),
            "expected login.rs hit: {:?}",
            bundle.matched_nodes
        );
        let _ = &bundle.neighbors;
        let _ = &bundle.open_loops;
        let _ = &bundle.precedents;
    }

    #[test]
    fn search_prefers_path_anchor_over_loose_text() {
        let (dir, db) = seeded();
        let _ = dir;
        let q = GraphQuery::new(&db);
        let hits = q.search("refactor login.rs module", None, 10);
        assert!(
            hits.iter().any(|h| h.label.contains("login.rs") || h.node_type == "file"),
            "path anchor should surface file: {:?}",
            hits
        );
    }

    #[test]
    fn trace_path_finds_session_to_file_chain() {
        let (dir, db) = seeded();
        let _ = dir;
        let q = GraphQuery::new(&db);
        let hops = q.trace_path("重构登录模块", "login.rs", 6);
        assert!(
            hops.len() >= 2,
            "expected multi-hop path, got {:?}",
            hops
        );
        assert!(
            hops.iter().any(|h| h.label.contains("login") || h.node_type == "file"),
            "path should include file hop: {:?}",
            hops
        );
    }

    #[test]
    fn build_context_excludes_superseded_and_closed_nodes() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        let ts = 1_700_000_000_000u64;
        let active_key = "sem:decision:use-sqlite".to_string();
        let superseded_key = "sem:decision:use-leveldb".to_string();
        let closed_key = "sem:open_task:find-keys".to_string();
        let closer_key = "sem:decision:keys-found".to_string();
        store::write_batch(
            &db,
            &FactBatch {
                nodes: vec![
                    NodeFact {
                        node_type: "decision",
                        key: active_key.clone(),
                        label: "用 SQLite".into(),
                        props: serde_json::json!({"confidence": 0.9}),
                        timestamp_ms: ts,
                    },
                    NodeFact {
                        node_type: "decision",
                        key: superseded_key.clone(),
                        label: "用 LevelDB".into(),
                        props: serde_json::json!({"confidence": 0.9}),
                        timestamp_ms: ts,
                    },
                    NodeFact {
                        node_type: "open_task",
                        key: closed_key.clone(),
                        label: "找钥匙".into(),
                        props: serde_json::json!({"confidence": 0.9, "status": "done"}),
                        timestamp_ms: ts,
                    },
                    NodeFact {
                        node_type: "decision",
                        key: closer_key.clone(),
                        label: "钥匙已找到".into(),
                        props: serde_json::json!({"confidence": 0.9}),
                        timestamp_ms: ts,
                    },
                ],
                edges: vec![
                    EdgeFact {
                        src_key: superseded_key.clone(),
                        dst_key: active_key.clone(),
                        edge_type: "sem/superseded_by",
                        props: serde_json::json!({}),
                        session_id: "s1".into(),
                        run_id: "r1".into(),
                        event_id: "e1".into(),
                        sequence: 1,
                        timestamp_ms: ts,
                    },
                    EdgeFact {
                        src_key: closed_key.clone(),
                        dst_key: closer_key.clone(),
                        edge_type: "sem/closed_by",
                        props: serde_json::json!({}),
                        session_id: "s1".into(),
                        run_id: "r1".into(),
                        event_id: "e2".into(),
                        sequence: 2,
                        timestamp_ms: ts,
                    },
                ],
            },
        )
        .unwrap();

        let q = GraphQuery::new(&db);

        // LIKE 通道是整串匹配；分开查以确保命中，再验证废止过滤。
        let active = q.build_context("SQLite");
        assert!(
            active
                .matched_nodes
                .iter()
                .any(|h| h.label.contains("SQLite")),
            "active fact should remain: {:?}",
            active.matched_nodes.iter().map(|h| &h.label).collect::<Vec<_>>()
        );

        let superseded = q.build_context("LevelDB");
        assert!(
            superseded
                .matched_nodes
                .iter()
                .all(|h| !h.label.contains("LevelDB")),
            "superseded fact should be filtered: {:?}",
            superseded.matched_nodes.iter().map(|h| &h.label).collect::<Vec<_>>()
        );

        let closed = q.build_context("找钥匙");
        assert!(
            closed.matched_nodes.iter().all(|h| h.label != "找钥匙"),
            "closed open_task should be filtered: {:?}",
            closed.matched_nodes.iter().map(|h| &h.label).collect::<Vec<_>>()
        );
        let _ = dir;
    }
}

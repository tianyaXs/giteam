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

/// build_context 的组合载荷。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBundle {
    pub matched_nodes: Vec<NodeHit>,
    pub recent_sessions: Vec<SessionDigest>,
    pub file_history: Vec<FileHistoryEntry>,
    pub unresolved_error_labels: Vec<String>,
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

        // 通道 2：label/key LIKE（覆盖中文、路径、错误指纹串）。
        let like = format!("%{}%", trimmed.replace('%', ""));
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

        hits.retain(|h| !is_search_noise(h));
        hits.sort_by(|a, b| {
            search_type_rank(&a.node_type)
                .cmp(&search_type_rank(&b.node_type))
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
    /// - 被取代的决策（sem/superseded_by 指向更新的决策）默认排除。
    #[must_use]
    pub fn build_context(&self, task: &str) -> ContextBundle {
        let mut hits = self.search(task, None, 12);
        let superseded = self.superseded_node_ids();
        hits.retain(|hit| !superseded.contains(&hit.node_id));
        let query_terms = token_set(task);
        let mut scored: Vec<(f64, NodeHit)> = hits
            .into_iter()
            .map(|hit| {
                let overlap = jaccard(&query_terms, &token_set(&hit.label));
                let degree = self.node_degree(&hit.node_id);
                let connectivity = (degree as f64 * 0.02).min(0.2);
                let confidence = self.node_confidence(&hit.node_id);
                (overlap + connectivity + confidence * 0.1, hit)
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
        ContextBundle {
            matched_nodes: hits,
            recent_sessions: self.recent_sessions(5),
            file_history: file_entries,
            unresolved_error_labels: error_labels,
        }
    }

    /// 被取代的语义节点集合（存在 sem/superseded_by 出边 = 已有更新决策）。
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
    fn compact_graph(&self, limit: usize, range: Option<TimeRange>) -> SubgraphView {
        let limit = limit.clamp(1, 1000);
        let (from, to) = range.unwrap_or((0, i64::MAX));
        // 1) 节点：剔除过程层（run/turn/message/tool_call）。
        let mut nodes: Vec<SubgraphNode> = Vec::new();
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT id, type, label, props, last_seen_ms FROM nodes
             WHERE type NOT IN ('run', 'turn', 'message', 'tool_call', 'command')
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
        // 语义边（两端都在聚合节点集内）。
        if let Ok(mut stmt) = self.db.prepare(
            "SELECT src_id, dst_id, type, timestamp_ms FROM edges
             WHERE (type LIKE 'sem/%' OR type = 'extracted')
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
                        edges.push(SubgraphEdge { src_id: src, dst_id: dst, edge_type, timestamp_ms: ts });
                    }
                }
            }
        }
        edges.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
        SubgraphView { center: String::new(), nodes, edges }
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
    #[must_use]
    pub fn recent_changes_digest(&self, max_sessions: usize) -> String {
        let sessions = self.recent_sessions(max_sessions);
        let mut lines: Vec<String> = Vec::with_capacity(sessions.len() + 1);
        for session in sessions {
            if session.intent.is_empty() {
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

/// 丢掉抽取 prompt/JSON 污染与空标签过程消息。
fn is_search_noise(hit: &NodeHit) -> bool {
    let label = hit.label.trim();
    if label.is_empty() {
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
    use crate::asset_graph::store::{self, FactBatch};
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
        // compact（默认）：过程节点剔除，保留知识节点。
        let types: std::collections::HashSet<&str> =
            view.nodes.iter().map(|n| n.node_type.as_str()).collect();
        for expected in ["session", "file", "error", "commit"] {
            assert!(types.contains(expected), "missing {expected}");
        }
        // command 剔除：其 executed 边已不在总览，孤立节点只是噪点。
        for excluded in ["run", "turn", "message", "tool_call", "command"] {
            assert!(!types.contains(excluded), "{excluded} should be rolled up");
        }
        // 折叠边：会话 → 资产（touches）存在；无原始过程边。
        let edge_types: Vec<&str> = view.edges.iter().map(|e| e.edge_type.as_str()).collect();
        assert!(edge_types.contains(&"touches"), "edges: {edge_types:?}");
        assert!(!edge_types.contains(&"used_tool"));
        assert!(!edge_types.contains(&"has_turn"));
        let capped = q.full_graph(3);
        assert_eq!(capped.nodes.len(), 3);
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
    fn sanitize_fts_filters_and_joins() {
        assert_eq!(sanitize_fts("hello world"), "hello world");
        assert_eq!(sanitize_fts("a%b(c)"), "abc");
        assert_eq!(sanitize_fts("!!!"), "");
    }
}

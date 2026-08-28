//! 资产图谱存储层：SQLite 属性图。
//!
//! 设计参考 `docs/repo-asset-graph-agent.md`（借 codegraph 的 schema 工程约定 +
//! semantica 的 provenance 思想）：
//! - `nodes`：统一属性图，`type` 区分（session/run/turn/message/tool_call/file/
//!   command/commit/error），`key` 是 canonical 键（相对路径 / sha / 归一化命令），
//!   `props` 存 JSON 附加事实（意图摘要、错误指纹原文等）。
//! - `edges`：每条边 = 一个可回放的事实，带完整 provenance
//!   （session_id/run_id/event_id/sequence/timestamp_ms）。
//! - `nodes_fts`：FTS5 external-content 全文索引（搜索用，触发器保持同步）。
//! - `schema_versions`：版本迁移记录。
//! - `replay_state`：存量会话 JSONL 的增量回放游标（size+mtime 变化才重建）。
//!
//! 写入路径全部幂等：节点 `ON CONFLICT DO UPDATE`（保 first_seen、推 last_seen），
//! 边靠唯一索引 `(src,dst,type,session_id,run_id,sequence)` 去重。

use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

/// 当前 schema 版本。
/// v2：Codex 式 `extraction_jobs`（turn 入队、idle/startup claim）。
const SCHEMA_VERSION: i64 = 2;

/// 节点/边 JSON props 的最大字节数（防异常事件撑爆库）。
const MAX_PROPS_BYTES: usize = 64 * 1024;

/// 图谱中的一个待写节点。
#[derive(Debug, Clone)]
pub struct NodeFact {
    pub node_type: &'static str,
    /// canonical 键：文件相对路径 / commit sha / 归一化命令 / 错误指纹等。
    pub key: String,
    pub label: String,
    /// JSON 对象附加属性。
    pub props: serde_json::Value,
    pub timestamp_ms: u64,
}

/// 图谱中的一条待写边（带 provenance）。
#[derive(Debug, Clone)]
pub struct EdgeFact {
    pub src_key: String,
    pub dst_key: String,
    pub edge_type: &'static str,
    pub props: serde_json::Value,
    pub session_id: String,
    pub run_id: String,
    pub event_id: String,
    pub sequence: u64,
    pub timestamp_ms: u64,
}

/// 一次 flush 的批量事实。
#[derive(Debug, Default, Clone)]
pub struct FactBatch {
    pub nodes: Vec<NodeFact>,
    pub edges: Vec<EdgeFact>,
}

impl FactBatch {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty() && self.edges.is_empty()
    }
}

/// 节点稳定 ID：`type:` + SHA-256(key) 前 16 hex（对齐 codegraph 的
/// `function:abc123` 约定；用 sha2 而非 std hasher 保证跨进程稳定）。
#[must_use]
pub fn node_id(node_type: &str, key: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(key.as_bytes());
    format!("{node_type}:{}", hex::encode(&digest[..8]))
}

/// 打开（或创建）指定路径的图谱库并应用迁移。
pub fn open(db_path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let db = Connection::open(db_path)?;
    db.pragma_update(None, "journal_mode", "WAL")?;
    db.pragma_update(None, "synchronous", "NORMAL")?;
    db.pragma_update(None, "foreign_keys", "ON")?;
    // 多连接写（live ingest 主连接 + 语义抽取旁路连接）下的 SQLITE_BUSY 兜底：
    // 等 2s 而不是立刻失败，避免抽取 batch 撞上 live 写事务被静默丢弃。
    db.busy_timeout(std::time::Duration::from_millis(2000))?;
    migrate(&db)?;
    Ok(db)
}

fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_versions (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
        );
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            key TEXT NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            props TEXT NOT NULL DEFAULT '{}',
            first_seen_ms INTEGER NOT NULL DEFAULT 0,
            last_seen_ms INTEGER NOT NULL DEFAULT 0,
            UNIQUE(type, key)
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
        CREATE INDEX IF NOT EXISTS idx_nodes_key ON nodes(key);
        CREATE TABLE IF NOT EXISTS edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            src_id TEXT NOT NULL,
            dst_id TEXT NOT NULL,
            type TEXT NOT NULL,
            props TEXT NOT NULL DEFAULT '{}',
            session_id TEXT NOT NULL DEFAULT '',
            run_id TEXT NOT NULL DEFAULT '',
            event_id TEXT NOT NULL DEFAULT '',
            sequence INTEGER NOT NULL DEFAULT 0,
            timestamp_ms INTEGER NOT NULL DEFAULT 0,
            UNIQUE(src_id, dst_id, type, session_id, run_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id, type);
        CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id, type);
        CREATE INDEX IF NOT EXISTS idx_edges_session ON edges(session_id, timestamp_ms);
        CREATE TABLE IF NOT EXISTS replay_state (
            path TEXT PRIMARY KEY,
            size_bytes INTEGER NOT NULL,
            modified_ms INTEGER NOT NULL,
            session_id TEXT NOT NULL DEFAULT '',
            indexed_at INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )?;
    // FTS5 external-content 全文索引 + 同步触发器（查询在 query.rs 使用）。
    db.execute_batch(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
            id UNINDEXED, label, key, props,
            content='nodes', content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes BEGIN
            INSERT INTO nodes_fts(rowid, id, label, key, props)
            VALUES (new.rowid, new.id, new.label, new.key, new.props);
        END;
        CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes BEGIN
            INSERT INTO nodes_fts(nodes_fts, rowid, id, label, key, props)
            VALUES ('delete', old.rowid, old.id, old.label, old.key, old.props);
        END;
        CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE OF label, key, props ON nodes BEGIN
            INSERT INTO nodes_fts(nodes_fts, rowid, id, label, key, props)
            VALUES ('delete', old.rowid, old.id, old.label, old.key, old.props);
            INSERT INTO nodes_fts(rowid, id, label, key, props)
            VALUES (new.rowid, new.id, new.label, new.key, new.props);
        END;
        "#,
    )?;
    let recorded: Option<i64> = db
        .query_row(
            "SELECT MAX(version) FROM schema_versions",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);
    let current = recorded.unwrap_or(0);
    if current < 2 {
        db.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS extraction_jobs (
                turn_key TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                run_id TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                input_json TEXT NOT NULL,
                enqueued_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                claimed_at_ms INTEGER,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status
                ON extraction_jobs(status, enqueued_at_ms);
            CREATE INDEX IF NOT EXISTS idx_extraction_jobs_session
                ON extraction_jobs(session_id, status);
            "#,
        )?;
    }
    if current < SCHEMA_VERSION {
        db.execute(
            "INSERT OR REPLACE INTO schema_versions (version, applied_at, description)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                SCHEMA_VERSION,
                now_ms(),
                "v2: extraction_jobs for deferred stage1 memory extraction"
            ],
        )?;
    }
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis().min(i64::MAX as u128) as i64)
}

fn clamp_props(props: &serde_json::Value) -> String {
    let text = serde_json::to_string(props).unwrap_or_else(|_| "{}".into());
    if text.len() <= MAX_PROPS_BYTES {
        return text;
    }
    // 超限降级为只保留 truncated 标记，不丢整条事实。
    format!("{{\"truncated\":true,\"bytes\":{}}}", text.len())
}

/// 单事务批量写入事实（幂等）。
pub fn write_batch(db: &Connection, batch: &FactBatch) -> rusqlite::Result<()> {
    if batch.is_empty() {
        return Ok(());
    }
    // 先写全部节点（边只引用节点 key→id，保证外键目标存在）。
    let mut upsert_node = db.prepare_cached(
        "INSERT INTO nodes (id, type, key, label, props, first_seen_ms, last_seen_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET
           last_seen_ms = MAX(last_seen_ms, excluded.last_seen_ms),
           -- 占位名（空/「会话」/session）不覆盖已有可读标题。
           label = CASE
             WHEN excluded.label = '' THEN nodes.label
             WHEN lower(excluded.label) IN ('session', '会话')
                  AND nodes.label != ''
                  AND lower(nodes.label) NOT IN ('session', '会话')
               THEN nodes.label
             ELSE excluded.label
           END,
           -- 浅合并 props：新键覆盖，旧键（如 intent）在新对象缺失时保留。
           props = CASE
             WHEN excluded.props = '{}' OR excluded.props = '' THEN nodes.props
             WHEN nodes.props = '{}' OR nodes.props = '' THEN excluded.props
             ELSE (
               SELECT json_group_object(key, value) FROM (
                 SELECT key, value FROM json_each(nodes.props)
                 WHERE key NOT IN (SELECT key FROM json_each(excluded.props))
                 UNION ALL
                 SELECT key, value FROM json_each(excluded.props)
               )
             )
           END",
    )?;
    // 边引用映射到已写入的节点 id：按 key 索引本批节点，跨批引用查库补。
    let mut id_index: HashMap<String, String> = HashMap::with_capacity(batch.nodes.len());
    for node in &batch.nodes {
        let id = node_id(node.node_type, &node.key);
        upsert_node.execute(rusqlite::params![
            id,
            node.node_type,
            node.key,
            truncate_label(&node.label),
            clamp_props(&node.props),
            i64::try_from(node.timestamp_ms).unwrap_or(0),
        ])?;
        id_index.insert(node.key.clone(), id);
    }
    drop(upsert_node);

    let mut upsert_edge = db.prepare_cached(
        "INSERT INTO edges (src_id, dst_id, type, props, session_id, run_id, event_id, sequence, timestamp_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(src_id, dst_id, type, session_id, run_id, sequence) DO NOTHING",
    )?;
    for edge in &batch.edges {
        let Some(src_id) = id_index
            .get(&edge.src_key)
            .cloned()
            .or_else(|| resolve_node_id(db, &edge.src_key))
        else {
            continue; // 端点未知——codegraph 的 unresolved_refs 原则：不硬凑边
        };
        let Some(dst_id) = id_index
            .get(&edge.dst_key)
            .cloned()
            .or_else(|| resolve_node_id(db, &edge.dst_key))
        else {
            continue;
        };
        upsert_edge.execute(rusqlite::params![
            src_id,
            dst_id,
            edge.edge_type,
            clamp_props(&edge.props),
            edge.session_id,
            edge.run_id,
            edge.event_id,
            i64::try_from(edge.sequence).unwrap_or(0),
            i64::try_from(edge.timestamp_ms).unwrap_or(0),
        ])?;
    }
    Ok(())
}

/// 边端点可能是早已写入的节点（跨批引用）：按 key 反查 id。
fn resolve_node_id(db: &Connection, key: &str) -> Option<String> {
    db.query_row(
        "SELECT id FROM nodes WHERE key = ?1 ORDER BY first_seen_ms LIMIT 1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// 更新会话回放游标（增量：文件 size/mtime 未变则跳过）。
pub fn replay_upsert_state(
    db: &Connection,
    path: &str,
    size_bytes: i64,
    modified_ms: i64,
    session_id: &str,
) -> rusqlite::Result<()> {
    db.execute(
        "INSERT INTO replay_state (path, size_bytes, modified_ms, session_id, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(path) DO UPDATE SET
           size_bytes = excluded.size_bytes,
           modified_ms = excluded.modified_ms,
           session_id = excluded.session_id,
           indexed_at = excluded.indexed_at",
        rusqlite::params![path, size_bytes, modified_ms, session_id, now_ms()],
    )
    .map(|_| ())
}

/// 读取会话回放游标；未索引过返回 None。
pub fn replay_get_state(db: &Connection, path: &str) -> Option<(i64, i64)> {
    db.query_row(
        "SELECT size_bytes, modified_ms FROM replay_state WHERE path = ?1",
        [path],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .ok()
}

fn truncate_label(label: &str) -> String {
    const MAX_LABEL: usize = 200;
    if label.len() <= MAX_LABEL {
        return label.to_string();
    }
    let mut end = MAX_LABEL;
    while end > 0 && !label.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &label[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = open(&dir.path().join("asset-graph.db")).expect("open");
        (dir, db)
    }

    #[test]
    fn schema_creates_tables_and_version() {
        let (_dir, db) = tmp_db();
        let version: i64 = db
            .query_row("SELECT MAX(version) FROM schema_versions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        for table in ["nodes", "edges", "replay_state", "nodes_fts", "extraction_jobs"] {
            let count: i64 = db
                .query_row(
                    &format!("SELECT COUNT(*) FROM sqlite_master WHERE name = '{table}'"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table {table}");
        }
    }

    #[test]
    fn node_ids_are_stable_and_typed() {
        let a = node_id("file", "src/main.rs");
        let b = node_id("file", "src/main.rs");
        let c = node_id("command", "src/main.rs");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with("file:"));
    }

    #[test]
    fn write_batch_is_idempotent() {
        let (_dir, db) = tmp_db();
        let batch = FactBatch {
            nodes: vec![
                NodeFact {
                    node_type: "file",
                    key: "src/main.rs".into(),
                    label: "src/main.rs".into(),
                    props: serde_json::json!({}),
                    timestamp_ms: 1_000,
                },
                NodeFact {
                    node_type: "session",
                    key: "sess-1".into(),
                    label: "sess-1".into(),
                    props: serde_json::json!({"intent": "fix bug"}),
                    timestamp_ms: 1_000,
                },
            ],
            edges: vec![EdgeFact {
                src_key: "sess-1".into(),
                dst_key: "src/main.rs".into(),
                edge_type: "modified",
                props: serde_json::json!({}),
                session_id: "sess-1".into(),
                run_id: "run-1".into(),
                event_id: "evt-1".into(),
                sequence: 7,
                timestamp_ms: 1_000,
            }],
        };
        write_batch(&db, &batch).unwrap();
        write_batch(&db, &batch).unwrap(); // 幂等重放
        let nodes: i64 = db.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0)).unwrap();
        let edges: i64 = db.query_row("SELECT COUNT(*) FROM edges", [], |r| r.get(0)).unwrap();
        assert_eq!(nodes, 2);
        assert_eq!(edges, 1);
    }

    #[test]
    fn write_batch_updates_last_seen_and_props() {
        let (_dir, db) = tmp_db();
        let node = NodeFact {
            node_type: "file",
            key: "a.rs".into(),
            label: "a.rs".into(),
            props: serde_json::json!({}),
            timestamp_ms: 1_000,
        };
        write_batch(&db, &FactBatch { nodes: vec![node], edges: vec![] }).unwrap();
        let again = NodeFact {
            node_type: "file",
            key: "a.rs".into(),
            label: "a.rs (new)".into(),
            props: serde_json::json!({"touch": 2}),
            timestamp_ms: 2_000,
        };
        write_batch(&db, &FactBatch { nodes: vec![again], edges: vec![] }).unwrap();
        let (first, last, label): (i64, i64, String) = db
            .query_row("SELECT first_seen_ms, last_seen_ms, label FROM nodes", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((first, last), (1_000, 2_000));
        assert_eq!(label, "a.rs (new)");
    }

    #[test]
    fn fts_index_follows_nodes() {
        let (_dir, db) = tmp_db();
        let node = NodeFact {
            node_type: "message",
            key: "msg-9".into(),
            label: "重构 control 模块的事件分发".into(),
            props: serde_json::json!({}),
            timestamp_ms: 1,
        };
        write_batch(&db, &FactBatch { nodes: vec![node], edges: vec![] }).unwrap();
        let hits: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM nodes_fts WHERE nodes_fts MATCH 'control'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }

    #[test]
    fn replay_state_roundtrip() {
        let (_dir, db) = tmp_db();
        assert!(replay_get_state(&db, "/x.jsonl").is_none());
        replay_upsert_state(&db, "/x.jsonl", 100, 123, "s1").unwrap();
        assert_eq!(replay_get_state(&db, "/x.jsonl"), Some((100, 123)));
        replay_upsert_state(&db, "/x.jsonl", 200, 456, "s1").unwrap();
        assert_eq!(replay_get_state(&db, "/x.jsonl"), Some((200, 456)));
    }
}

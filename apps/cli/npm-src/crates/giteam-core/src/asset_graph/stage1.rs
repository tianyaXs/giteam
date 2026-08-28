//! Codex 式 Stage-1：turn 只入队，会话 idle / 仓库挂载时再批处理抽取。
//!
//! 对齐 openai/codex memories Phase 1 的关键约束：
//! - 不在活跃对话热路径上立刻调 LLM（避免「你好」闪记忆卡、烧 completion）
//! - 只认 idle 足够久 / 非 live 会话的 pending job
//! - 空产出是一等公民（`succeeded_no_output` → job=`done`，无 UI）
//! - durable claim 落在 `extraction_jobs`，进程重启可续跑

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;

use super::extraction::{self, ExtractionInput};
use super::store;
use crate::pi_agent::SubagentHost;

/// 抽取队列摘要（图谱顶栏「沉淀中」指示器用）。
/// `pending`/`claimed` 均为 0 时前端应整块隐藏。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionQueueSummary {
    pub pending: i64,
    pub claimed: i64,
    /// 队列行最近更新时间（含已完成 job），用于前端判断是否有新写入。
    pub updated_at_ms: i64,
}

impl ExtractionQueueSummary {
    #[must_use]
    pub fn active(&self) -> i64 {
        self.pending.saturating_add(self.claimed)
    }
}

/// 统计抽取队列：只读，供面板轮询。
pub fn queue_summary(db: &Connection) -> rusqlite::Result<ExtractionQueueSummary> {
    let mut pending = 0i64;
    let mut claimed = 0i64;
    let mut stmt = db.prepare(
        "SELECT status, COUNT(*) FROM extraction_jobs
         WHERE status IN ('pending', 'claimed')
         GROUP BY status",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows.flatten() {
        match row.0.as_str() {
            "pending" => pending = row.1,
            "claimed" => claimed = row.1,
            _ => {}
        }
    }
    let updated_at_ms: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(updated_at_ms), 0) FROM extraction_jobs",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(ExtractionQueueSummary {
        pending,
        claimed,
        updated_at_ms,
    })
}

/// 默认最小空闲秒数：仅用于 Idle 触发的 claim 门控（可用环境变量覆盖）。
/// Run 已结束时走 Startup（min_idle=0），不再傻等 90s——否则视图长期看不到实体。
pub const DEFAULT_MIN_IDLE_SECS: u64 = 15;
/// 单次启动/扫库最多 claim 的 job 数（对齐 Codex startup claim 上限）。
pub const DEFAULT_CLAIM_LIMIT: usize = 8;
/// `claimed` 超时后重新放回 pending，避免 worker 崩溃卡死。
const CLAIM_STALE_SECS: u64 = 15 * 60;

/// Stage-1 触发原因（可观测日志用）。
#[derive(Debug, Clone, Copy)]
pub enum Stage1Trigger {
    /// 仓库挂载 / 新会话创建后扫 backlog。
    Startup,
    /// 某会话 run 结束后 debounce。
    Idle,
}

/// 环境变量 `GITEAM_MEMORY_MIN_IDLE_SECS`；`0` = 不要求 idle（仍排除 live session）。
#[must_use]
pub fn min_idle_secs() -> u64 {
    std::env::var("GITEAM_MEMORY_MIN_IDLE_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_MIN_IDLE_SECS)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis().min(i64::MAX as u128) as i64)
}

fn stage1_inflight() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn db_key(db_path: &Path) -> String {
    db_path.to_string_lossy().into_owned()
}

/// 入队一条待抽取 turn（幂等：同 turn_key 已 done/skipped 不覆盖；pending/failed 可更新 input）。
pub fn enqueue_job(db: &Connection, input: &ExtractionInput) -> rusqlite::Result<()> {
    let Some(turn_key) = input.turn_key.as_deref().filter(|k| !k.is_empty()) else {
        return Ok(());
    };
    let input_json = serde_json::to_string(input).unwrap_or_else(|_| "{}".into());
    let ts = now_ms();
    db.execute(
        "INSERT INTO extraction_jobs (
            turn_key, session_id, run_id, status, input_json,
            enqueued_at_ms, updated_at_ms, attempts, last_error
         ) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?5, 0, NULL)
         ON CONFLICT(turn_key) DO UPDATE SET
           input_json = excluded.input_json,
           session_id = excluded.session_id,
           run_id = excluded.run_id,
           updated_at_ms = excluded.updated_at_ms,
           status = CASE
             WHEN extraction_jobs.status IN ('done', 'skipped') THEN extraction_jobs.status
             ELSE 'pending'
           END,
           last_error = CASE
             WHEN extraction_jobs.status IN ('done', 'skipped') THEN extraction_jobs.last_error
             ELSE NULL
           END",
        rusqlite::params![turn_key, input.session_id, input.run_id, input_json, ts],
    )?;
    Ok(())
}

/// 回收超时 claimed，避免 worker 中断后永久卡住。
pub fn reclaim_stale_claims(db: &Connection) -> rusqlite::Result<usize> {
    let cutoff = now_ms().saturating_sub((CLAIM_STALE_SECS * 1000) as i64);
    let n = db.execute(
        "UPDATE extraction_jobs
         SET status = 'pending', updated_at_ms = ?1, last_error = 'reclaimed_stale_claim'
         WHERE status = 'claimed' AND claimed_at_ms IS NOT NULL AND claimed_at_ms < ?2",
        rusqlite::params![now_ms(), cutoff],
    )?;
    Ok(n)
}

/// Claim 一批可跑 job。
///
/// 规则（Codex idle / startup claim 的本地化）：
/// - `status = pending`
/// - `session_id` 不在 `exclude_sessions`（live 会话热路径排除）
/// - `enqueued_at_ms <= now - min_idle_ms`（idle 门控；startup 对非 live 仍可要求短 idle）
pub fn claim_jobs(
    db: &Connection,
    exclude_sessions: &HashSet<String>,
    min_idle_ms: u64,
    limit: usize,
) -> rusqlite::Result<Vec<(String, ExtractionInput)>> {
    let _ = reclaim_stale_claims(db);
    let cutoff = now_ms().saturating_sub(min_idle_ms as i64);
    let mut stmt = db.prepare(
        "SELECT turn_key, input_json FROM extraction_jobs
         WHERE status = 'pending' AND enqueued_at_ms <= ?1
         ORDER BY enqueued_at_ms ASC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![cutoff, limit as i64], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut claimed = Vec::new();
    let ts = now_ms();
    for row in rows.flatten() {
        let (turn_key, input_json) = row;
        let Ok(input) = serde_json::from_str::<ExtractionInput>(&input_json) else {
            let _ = mark_job_status(db, &turn_key, "failed", Some("invalid input_json"));
            continue;
        };
        if exclude_sessions.contains(&input.session_id) {
            continue;
        }
        // 已抽过则跳过（durable 幂等）。
        if extraction::turn_already_extracted(db, &turn_key) {
            let _ = mark_job_status(db, &turn_key, "done", None);
            continue;
        }
        let updated = db.execute(
            "UPDATE extraction_jobs
             SET status = 'claimed', claimed_at_ms = ?1, updated_at_ms = ?1,
                 attempts = attempts + 1
             WHERE turn_key = ?2 AND status = 'pending'",
            rusqlite::params![ts, turn_key],
        )?;
        if updated == 1 {
            claimed.push((turn_key, input));
        }
    }
    Ok(claimed)
}

pub fn mark_job_status(
    db: &Connection,
    turn_key: &str,
    status: &str,
    error: Option<&str>,
) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE extraction_jobs
         SET status = ?1, updated_at_ms = ?2, last_error = ?3,
             claimed_at_ms = CASE WHEN ?1 = 'pending' THEN NULL ELSE claimed_at_ms END
         WHERE turn_key = ?4",
        rusqlite::params![status, now_ms(), error, turn_key],
    )?;
    Ok(())
}

/// 当前挂载图谱里仍有 live 累积器的 session（热路径，不抽）。
#[must_use]
pub fn live_session_ids_for_repo(repo_path: &Path) -> HashSet<String> {
    let mut out = HashSet::new();
    let Some(graph) = super::attached(repo_path) else {
        return out;
    };
    let Ok(g) = graph.lock() else {
        return out;
    };
    for (session_id, _) in g.live_session_keys() {
        out.insert(session_id);
    }
    out
}

/// 在任意线程上调度 Stage-1 future。
/// Agent 事件回调常不在 tokio 运行时上；裸 `tokio::spawn` 会直接 panic 被上层
/// catch_unwind 吃掉 → job 永远 pending、图谱外层没有实体。
fn spawn_stage1_task<F>(fut: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(fut);
        return;
    }
    std::thread::Builder::new()
        .name("giteam-stage1".into())
        .spawn(move || {
            let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                eprintln!("[asset-graph] stage1: failed to build fallback runtime");
                return;
            };
            rt.block_on(fut);
        })
        .ok();
}

/// Kick Stage-1 worker：同 DB 串行；已在飞则合并为「稍后重扫」。
pub fn kick_stage1(
    host: std::sync::Arc<dyn SubagentHost>,
    db_path: PathBuf,
    repo_path: PathBuf,
    trigger: Stage1Trigger,
) {
    let key = db_key(&db_path);
    {
        let Ok(mut set) = stage1_inflight().lock() else {
            return;
        };
        if !set.insert(key.clone()) {
            // 已有 worker：记 dirty，当前 worker 收尾会再扫一轮。
            mark_dirty(&key);
            return;
        }
    }
    spawn_stage1_task(async move {
        let idle_ms = min_idle_secs().saturating_mul(1000);
        // Startup：对非 live 会话放宽 idle（0），尽快消化跨会话 backlog；
        // Idle：严格按 min_idle，避免刚说完「你好」立刻抽。
        let min_idle_ms = match trigger {
            Stage1Trigger::Startup => 0,
            Stage1Trigger::Idle => idle_ms,
        };
        loop {
            let exclude = live_session_ids_for_repo(&repo_path);
            let jobs = {
                let Ok(db) = store::open(&db_path) else {
                    break;
                };
                match claim_jobs(&db, &exclude, min_idle_ms, DEFAULT_CLAIM_LIMIT) {
                    Ok(jobs) => jobs,
                    Err(error) => {
                        eprintln!("[asset-graph] stage1 claim failed: {error}");
                        Vec::new()
                    }
                }
            };
            if jobs.is_empty() {
                if take_dirty(&key) {
                    continue;
                }
                break;
            }
            eprintln!(
                "[asset-graph] stage1 {:?}: claimed {} job(s) from {}",
                trigger,
                jobs.len(),
                db_path.display()
            );
            for (turn_key, input) in jobs {
                let outcome = extraction::run_extraction_job(
                    host.clone(),
                    input,
                    db_path.clone(),
                    repo_path.clone(),
                    // OnWrite：仅高质量/高优先完成卡会真正发出（见 run_extraction_job）。
                    extraction::ExtractionPublishMode::OnWrite,
                )
                .await;
                let Ok(db) = store::open(&db_path) else {
                    continue;
                };
                match outcome {
                    extraction::ExtractionJobOutcome::Wrote { .. }
                    | extraction::ExtractionJobOutcome::NoOutput => {
                        let _ = mark_job_status(&db, &turn_key, "done", None);
                    }
                    extraction::ExtractionJobOutcome::Failed(error) => {
                        let _ = mark_job_status(&db, &turn_key, "failed", Some(&error));
                    }
                }
            }
            if !take_dirty(&key) {
                // 可能还有 pending（limit 截断）；继续扫直到空。
                let Ok(db) = store::open(&db_path) else {
                    break;
                };
                let more = count_pending_eligible(&db, &exclude, min_idle_ms).unwrap_or(0);
                if more == 0 {
                    break;
                }
            }
        }
        if let Ok(mut set) = stage1_inflight().lock() {
            set.remove(&key);
        }
        // 收尾时若又有 dirty，再 kick 一次（避免竞态丢扫）。
        if take_dirty(&key) {
            if let Some(host) = current_host_fallback(host) {
                kick_stage1(host, db_path, repo_path, trigger);
            }
        }
    });
}

fn current_host_fallback(
    host: std::sync::Arc<dyn SubagentHost>,
) -> Option<std::sync::Arc<dyn SubagentHost>> {
    Some(host)
}

fn dirty_set() -> &'static Mutex<HashSet<String>> {
    static SET: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    SET.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_dirty(key: &str) {
    if let Ok(mut set) = dirty_set().lock() {
        set.insert(key.to_string());
    }
}

fn take_dirty(key: &str) -> bool {
    dirty_set()
        .lock()
        .map(|mut set| set.remove(key))
        .unwrap_or(false)
}

fn count_pending_eligible(
    db: &Connection,
    exclude_sessions: &HashSet<String>,
    min_idle_ms: u64,
) -> rusqlite::Result<usize> {
    let cutoff = now_ms().saturating_sub(min_idle_ms as i64);
    let mut stmt = db.prepare(
        "SELECT session_id FROM extraction_jobs
         WHERE status = 'pending' AND enqueued_at_ms <= ?1",
    )?;
    let rows = stmt.query_map(rusqlite::params![cutoff], |row| row.get::<_, String>(0))?;
    let mut n = 0usize;
    for session_id in rows.flatten() {
        if !exclude_sessions.contains(&session_id) {
            n += 1;
        }
    }
    Ok(n)
}

/// Run 结束后 debounce 再 kick（默认 min_idle）。
pub fn schedule_idle_stage1(
    host: std::sync::Arc<dyn SubagentHost>,
    db_path: PathBuf,
    repo_path: PathBuf,
) {
    // Run 已结束（调用方已从 live 移除会话）后尽快用 Startup 消化 pending；
    // 短延迟只为让同 tick 的落库事务提交完毕。不再空等 90s Idle 门控。
    let delay = Duration::from_secs(2);
    spawn_stage1_task(async move {
        tokio::time::sleep(delay).await;
        kick_stage1(host, db_path, repo_path, Stage1Trigger::Startup);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asset_graph::store;

    fn sample_input(turn: &str, session: &str) -> ExtractionInput {
        ExtractionInput {
            session_id: session.into(),
            run_id: "run-1".into(),
            turn_key: Some(turn.into()),
            session_key: "session:k".into(),
            user_text: "用 SQLite 存图谱".into(),
            assistant_text: "好的，用 rusqlite。".into(),
            file_keys: vec![("a.rs".into(), "file:a".into())],
            commands: vec![],
            error_lines: vec![],
            timestamp_ms: 1,
            sequence: 1,
            repo_path: "/tmp/repo".into(),
            provider: None,
            model: None,
            thinking: None,
        }
    }

    #[test]
    fn enqueue_and_claim_respects_idle_and_exclude() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        let input = sample_input("turn:a", "sess-a");
        enqueue_job(&db, &input).unwrap();

        let mut exclude = HashSet::new();
        exclude.insert("sess-a".into());
        let claimed = claim_jobs(&db, &exclude, 0, 8).unwrap();
        assert!(claimed.is_empty(), "live session must be excluded");

        let claimed = claim_jobs(&db, &HashSet::new(), 0, 8).unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].0, "turn:a");

        // 已 claimed，再次 claim 拿不到。
        let again = claim_jobs(&db, &HashSet::new(), 0, 8).unwrap();
        assert!(again.is_empty());
    }

    #[test]
    fn mark_job_done_after_claim() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        store::write_batch(
            &db,
            &store::FactBatch {
                nodes: vec![store::NodeFact {
                    node_type: "turn",
                    key: "turn:hi".into(),
                    label: "turn".into(),
                    props: serde_json::json!({}),
                    timestamp_ms: 1,
                }],
                edges: vec![],
            },
        )
        .unwrap();
        let mut input = sample_input("turn:hi", "sess");
        input.user_text = "你好".into();
        input.assistant_text = "你好！".into();
        input.file_keys.clear();
        enqueue_job(&db, &input).unwrap();
        let claimed = claim_jobs(&db, &HashSet::new(), 0, 8).unwrap();
        assert_eq!(claimed.len(), 1);
        mark_job_status(&db, "turn:hi", "done", None).unwrap();
        extraction::mark_turn_extracted(&db, Some("turn:hi"));
        assert!(extraction::turn_already_extracted(&db, "turn:hi"));
    }

    #[test]
    fn queue_summary_counts_pending_and_claimed() {
        let dir = tempfile::tempdir().unwrap();
        let db = store::open(&dir.path().join("g.db")).unwrap();
        enqueue_job(&db, &sample_input("turn:p1", "sess-a")).unwrap();
        enqueue_job(&db, &sample_input("turn:p2", "sess-b")).unwrap();
        let empty_exclude = HashSet::new();
        let claimed = claim_jobs(&db, &empty_exclude, 0, 1).unwrap();
        assert_eq!(claimed.len(), 1);

        let summary = queue_summary(&db).unwrap();
        assert_eq!(summary.pending, 1, "one still pending");
        assert_eq!(summary.claimed, 1, "one claimed");
        assert!(summary.active() == 2);
        assert!(summary.updated_at_ms > 0);

        mark_job_status(&db, &claimed[0].0, "done", None).unwrap();
        let after = queue_summary(&db).unwrap();
        assert_eq!(after.pending, 1);
        assert_eq!(after.claimed, 0);
        assert_eq!(after.active(), 1);
    }
}

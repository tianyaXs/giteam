//! 清空语义实体并重跑 Stage-1 backlog（修复 session-not-found 后验证用）。
//!
//! ```text
//! cargo run -p giteam-core --example extraction_drain -- \
//!   --repo /Users/tianya/Documents/project/test \
//!   --reset
//! ```

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use giteam_core::asset_graph::{self, stage1, store};
use giteam_core::pi_agent::PiAgentService;

#[tokio::main]
async fn main() {
    let args = parse_args();
    let service = PiAgentService::global();

    let db_path = giteam_core::pi_agent::memory_db_path_for_repo(&args.repo).unwrap_or_else(|| {
        eprintln!("cannot resolve memory db for {}", args.repo.display());
        std::process::exit(1);
    });
    println!("[ok] db {}", db_path.display());

    if args.reset {
        reset_semantics(&db_path);
    }

    let before = count_jobs(&db_path);
    println!(
        "[jobs] pending={} claimed={} failed={} done={}",
        before.pending, before.claimed, before.failed, before.done
    );

    // 挂载图谱 + 注入 subagent host，触发 Stage-1 worker。
    let host = service.asset_graph_subagent_host().unwrap_or_else(|| {
        eprintln!("no subagent host (provider catalog?)");
        std::process::exit(1);
    });
    let (nodes, edges) = asset_graph::attach_repo_with_extraction(&args.repo, host.clone())
        .unwrap_or_else(|e| {
            eprintln!("attach failed: {e}");
            std::process::exit(1);
        });
    println!("[ok] attached graph replay nodes={nodes} edges={edges}");

    // attach_repo_with_extraction 已 kick startup；长 backlog 时再显式 kick。
    stage1::kick_stage1(
        host,
        db_path.clone(),
        args.repo.clone(),
        stage1::Stage1Trigger::Startup,
    );

    let deadline = std::time::Instant::now() + Duration::from_secs(args.timeout_secs);
    loop {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let jobs = count_jobs(&db_path);
        let sem = count_sem(&db_path);
        println!(
            "[poll] pending={} claimed={} failed={} done={} sem_nodes={}",
            jobs.pending, jobs.claimed, jobs.failed, jobs.done, sem
        );
        // claimed 也要等：否则进程提前退出会杀掉 in-flight worker，job 永久卡在 claimed。
        if jobs.pending == 0 && jobs.claimed == 0 && jobs.failed == 0 {
            break;
        }
        if jobs.pending == 0 && jobs.claimed == 0 && jobs.failed > 0 {
            eprintln!("[warn] {failed} jobs failed (LLM/provider); stopping", failed = jobs.failed);
            break;
        }
        if std::time::Instant::now() >= deadline {
            eprintln!("[timeout] backlog not fully drained");
            std::process::exit(1);
        }
        if jobs.pending > 0 {
            if let Some(h) = service.asset_graph_subagent_host() {
                stage1::kick_stage1(
                    h,
                    db_path.clone(),
                    args.repo.clone(),
                    stage1::Stage1Trigger::Startup,
                );
            }
        }
    }

    print_sem_summary(&db_path);
    println!("[PASS] stage-1 backlog drained");
}

struct Args {
    repo: PathBuf,
    reset: bool,
    timeout_secs: u64,
}

fn parse_args() -> Args {
    let mut repo = std::env::var("GITEAM_RP_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let mut reset = false;
    let mut timeout_secs = 600u64;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--repo" => repo = PathBuf::from(args.next().expect("--repo value")),
            "--reset" => reset = true,
            "--timeout" => {
                timeout_secs = args.next().expect("--timeout value").parse().expect("u64");
            }
            other => {
                eprintln!("unknown arg: {other}");
                std::process::exit(2);
            }
        }
    }
    Args {
        repo,
        reset,
        timeout_secs,
    }
}

struct JobCounts {
    pending: i64,
    claimed: i64,
    failed: i64,
    done: i64,
}

fn count_jobs(db_path: &PathBuf) -> JobCounts {
    let Ok(db) = store::open(db_path) else {
        return JobCounts {
            pending: 0,
            claimed: 0,
            failed: 0,
            done: 0,
        };
    };
    fn q(db: &rusqlite::Connection, status: &str) -> i64 {
        db.query_row(
            "SELECT COUNT(*) FROM extraction_jobs WHERE status = ?1",
            [status],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }
    JobCounts {
        pending: q(&db, "pending"),
        claimed: q(&db, "claimed"),
        failed: q(&db, "failed"),
        done: q(&db, "done"),
    }
}

fn count_sem(db_path: &PathBuf) -> i64 {
    let Ok(db) = store::open(db_path) else {
        return 0;
    };
    db.query_row(
        "SELECT COUNT(*) FROM nodes WHERE key LIKE 'sem:%'",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

fn reset_semantics(db_path: &PathBuf) {
    let db = store::open(db_path).unwrap_or_else(|e| {
        eprintln!("open db: {e}");
        std::process::exit(1);
    });
    db.execute_batch(
        "DELETE FROM edges WHERE src_id IN (SELECT id FROM nodes WHERE key LIKE 'sem:%')
          OR dst_id IN (SELECT id FROM nodes WHERE key LIKE 'sem:%');
         DELETE FROM nodes WHERE key LIKE 'sem:%';
         UPDATE nodes SET props = json_remove(props, '$.semExtracted')
           WHERE type = 'turn' AND json_extract(props, '$.semExtracted') IS NOT NULL;
         UPDATE extraction_jobs
           SET status = 'pending', last_error = NULL, claimed_at_ms = NULL, attempts = 0
           WHERE status IN ('failed', 'done', 'claimed');",
    )
    .unwrap_or_else(|e| {
        eprintln!("reset failed: {e}");
        std::process::exit(1);
    });
    println!("[ok] cleared sem entities + reset extraction_jobs → pending");
}

fn print_sem_summary(db_path: &PathBuf) {
    let Ok(db) = store::open(db_path) else {
        return;
    };
    println!("----- semantic entities by type -----");
    let Ok(mut stmt) = db.prepare(
        "SELECT type, COUNT(*) FROM nodes WHERE key LIKE 'sem:%' GROUP BY type ORDER BY COUNT(*) DESC",
    ) else {
        return;
    };
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)));
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            println!("  {}: {}", row.0, row.1);
        }
    }
}

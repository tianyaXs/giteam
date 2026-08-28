//! 进程内调度循环：定期 claim due tasks 并执行。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::runner::{execute_task, RunOutcome};
use super::store::with_store;
use super::types::{now_ms, RunTrigger};
use super::AutomationResult;

const DEFAULT_TICK: Duration = Duration::from_secs(20);

/// 通知回调：由 Desktop 注入系统通知。
pub type NotifyHook = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// 启动后台调度（幂等：重复调用忽略）。
pub fn start_scheduler(notify: Option<NotifyHook>) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    // 启动时校准 next_run
    let _ = with_store(|s| s.recalibrate_next_runs());

    std::thread::Builder::new()
        .name("giteam-automation".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    eprintln!("[automation] failed to build runtime: {err}");
                    return;
                }
            };
            rt.block_on(async move {
                loop {
                    if let Err(err) = tick_once(notify.as_ref()).await {
                        eprintln!("[automation] tick error: {err}");
                    }
                    tokio::time::sleep(DEFAULT_TICK).await;
                }
            });
        })
        .ok();
}

async fn tick_once(notify: Option<&NotifyHook>) -> AutomationResult<()> {
    let due = with_store(|s| s.claim_due_tasks(now_ms()))?;
    for task in due {
        match execute_task(task, RunTrigger::Schedule).await {
            Ok(outcome) => emit_notify(notify, &outcome),
            Err(err) => eprintln!("[automation] execute failed: {err}"),
        }
    }
    Ok(())
}

fn emit_notify(notify: Option<&NotifyHook>, outcome: &RunOutcome) {
    if !outcome.should_notify {
        return;
    }
    if let Some(hook) = notify {
        hook(&outcome.notify_title, &outcome.notify_body);
    }
}

/// 手动立即运行（供 Tauri command）。
pub async fn run_now(task_id: &str) -> AutomationResult<RunOutcome> {
    let task = with_store(|s| {
        s.get_task(task_id)?
            .ok_or_else(|| super::AutomationError::NotFound(task_id.to_string()))
    })?;
    if with_store(|s| s.has_running_run(&task.id))? {
        // 仍允许插入 skipped 记录
        let run = with_store(|s| {
            let run = s.insert_run(&task, RunTrigger::Manual, super::types::RunStatus::Skipped)?;
            s.finish_run(
                &run.id,
                super::types::RunStatus::Skipped,
                None,
                Some("task already running"),
                None,
            )
        })?;
        return Ok(RunOutcome {
            should_notify: false,
            notify_title: format!("自动化：{}", task.title),
            notify_body: "任务正在运行".into(),
            run,
            task,
        });
    }
    let outcome = execute_task(task, RunTrigger::Manual).await?;
    Ok(outcome)
}

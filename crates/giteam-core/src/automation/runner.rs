//! 自动化执行器：桥接 PiAgentService create_session / prompt。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::pi_agent::{
    ensure_repo_pi_sessions_dir, AgentEventEnvelope, AgentMessage, AgentPart, AgentRole,
    PiAgentService, PiSessionConfig,
};

use super::store::with_store;
use super::types::{
    now_ms, should_notify_run, AutomationRun, AutomationTask, RunStatus, RunTrigger, SessionMode,
};
use super::{AutomationError, AutomationResult};

static ACTIVE_TASKS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn active_tasks() -> &'static Mutex<HashSet<String>> {
    ACTIVE_TASKS.get_or_init(|| Mutex::new(HashSet::new()))
}

struct TaskExecutionGuard {
    task_id: String,
}

impl Drop for TaskExecutionGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = active_tasks().lock() {
            set.remove(&self.task_id);
        }
    }
}

fn try_acquire_task(task_id: &str) -> Option<TaskExecutionGuard> {
    let mut set = active_tasks().lock().ok()?;
    if set.contains(task_id) {
        return None;
    }
    set.insert(task_id.to_string());
    Some(TaskExecutionGuard {
        task_id: task_id.to_string(),
    })
}

fn skip_already_running(task: &AutomationTask, trigger: RunTrigger) -> AutomationResult<RunOutcome> {
    let run = with_store(|s| {
        let run = s.insert_run(task, trigger, RunStatus::Skipped)?;
        let run = s.finish_run(
            &run.id,
            RunStatus::Skipped,
            None,
            Some("任务正在运行中"),
            None,
        )?;
        let task = s.mark_task_finished(&task.id, RunStatus::Skipped, trigger == RunTrigger::Schedule)?;
        Ok((run, task))
    })?;
    Ok(skipped_outcome(
        run.0,
        run.1,
        "任务正在运行中，请稍后再试",
    ))
}

/// 单次执行结果（含是否应发通知）。
#[derive(Debug, Clone)]
pub struct RunOutcome {
    pub run: AutomationRun,
    pub task: AutomationTask,
    pub notify_title: String,
    pub notify_body: String,
    pub should_notify: bool,
}

/// 执行任务：写 running run → agent → finish。
pub async fn execute_task(
    task: AutomationTask,
    trigger: RunTrigger,
) -> AutomationResult<RunOutcome> {
    let _guard = match try_acquire_task(&task.id) {
        Some(guard) => guard,
        None => return skip_already_running(&task, trigger),
    };

    // 清掉 DB 里上次异常退出遗留的 running 记录。
    with_store(|s| s.cancel_orphaned_runs(&task.id))?;

    if trigger != RunTrigger::Manual {
        let still_running = with_store(|s| s.has_running_run(&task.id))?;
        if still_running {
            return skip_already_running(&task, trigger);
        }
    }

    let run = with_store(|s| s.insert_run(&task, trigger, RunStatus::Running))?;

    // 校验仓库路径
    let repo = PathBuf::from(&task.repo_path);
    if !repo.is_dir() {
        return finalize_failure(
            &task,
            &run.id,
            trigger,
            format!("repo path missing: {}", task.repo_path),
            "项目目录不存在，任务已标记失败",
        )
        .await;
    }

    let service = PiAgentService::global();
    let session_id = match resolve_session(service, &task).await {
        Ok(id) => id,
        Err(err) => {
            return finalize_failure(&task, &run.id, trigger, err.to_string(), "创建/选择会话失败")
                .await;
        }
    };

    // 任务指定了模型则切到对应 provider/model 再执行。
    if let (Some(provider), Some(model)) = (
        task.provider.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        task.model.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    ) {
        if let Err(err) = service.set_model(&session_id, provider, model).await {
            return finalize_failure(
                &task,
                &run.id,
                trigger,
                format!("set model failed: {err}"),
                "切换模型失败",
            )
            .await;
        }
    }

    if let Some(level) = task
        .thinking_level
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Err(err) = service.set_thinking_level(&session_id, level).await {
            return finalize_failure(
                &task,
                &run.id,
                trigger,
                format!("set thinking level failed: {err}"),
                "切换推理强度失败",
            )
            .await;
        }
    }

    if service.has_active_run_for_session(&session_id) {
        let finished = with_store(|s| {
            let run = s.finish_run(
                &run.id,
                RunStatus::Skipped,
                Some(&session_id),
                Some("session busy"),
                None,
            )?;
            let task =
                s.mark_task_finished(&task.id, RunStatus::Skipped, trigger == RunTrigger::Schedule)?;
            Ok((run, task))
        })?;
        return Ok(skipped_outcome(
            finished.0,
            finished.1,
            "目标会话忙碌，已跳过",
        ));
    }

    let run_id = format!("auto-{}", uuid::Uuid::new_v4().simple());
    let events: Arc<std::sync::Mutex<Vec<AgentEventEnvelope>>> =
        Arc::new(std::sync::Mutex::new(Vec::new()));
    let events_sink = Arc::clone(&events);
    let sink: Arc<dyn Fn(AgentEventEnvelope) + Send + Sync> = Arc::new(move |event| {
        if let Ok(mut list) = events_sink.lock() {
            list.push(event);
        }
    });

    let prompt_result = service
        .prompt(
            &session_id,
            &run_id,
            task.goal_prompt.clone(),
            Vec::new(),
            sink,
        )
        .await;

    match prompt_result {
        Ok(message) => {
            let summary = resolve_run_summary(service, &session_id, &message).await;
            let finished = with_store(|s| {
                let run = s.finish_run(
                    &run.id,
                    RunStatus::Success,
                    Some(&session_id),
                    None,
                    Some(&summary),
                )?;
                let task = s.mark_task_finished(
                    &task.id,
                    RunStatus::Success,
                    trigger == RunTrigger::Schedule,
                )?;
                Ok((run, task))
            })?;
            let should_notify = should_notify_run(&finished.1, RunStatus::Success);
            let body = if summary.trim().is_empty() {
                "已完成".to_string()
            } else {
                summary
            };
            Ok(RunOutcome {
                notify_title: finished.1.title.clone(),
                notify_body: body,
                should_notify,
                run: finished.0,
                task: finished.1,
            })
        }
        Err(err) => {
            finalize_failure(
                &task,
                &run.id,
                trigger,
                err.to_string(),
                "执行失败",
            )
            .await
        }
    }
}

async fn resolve_session(
    service: &PiAgentService,
    task: &AutomationTask,
) -> Result<String, AutomationError> {
    match task.session_mode {
        SessionMode::New => {
            let session_dir = ensure_repo_pi_sessions_dir(Path::new(&task.repo_path))
                .map_err(|e| AutomationError::Execution(e.to_string()))?;
            let config = PiSessionConfig {
                repo_path: PathBuf::from(&task.repo_path),
                session_dir,
                session_path: None,
                provider: task.provider.clone(),
                model: task.model.clone(),
                api_key: None,
                system_prompt: None,
                append_system_prompt: None,
                enabled_tools: None,
                extension_paths: Vec::new(),
                no_session: false,
                thinking: task
                    .thinking_level
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string),
                max_tool_iterations: None,
                browser_controller: None,
                parent_session_id: None,
                parent_tool_call_id: None,
                session_kind: "primary".to_string(),
            };
            let summary = service
                .create_session(config)
                .await
                .map_err(|e| AutomationError::Execution(e.to_string()))?;
            Ok(summary.session_id)
        }
        SessionMode::Existing => {
            let sid = task
                .session_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    AutomationError::InvalidInput("session_id required for existing mode".into())
                })?;
            let summary = service
                .session_summary(sid)
                .await
                .map_err(|e| AutomationError::Execution(e.to_string()))?;
            let expected = canonicalize_loose(&task.repo_path);
            let actual = canonicalize_loose(&summary.repo_path.to_string_lossy());
            if expected != actual {
                return Err(AutomationError::InvalidInput(format!(
                    "session {} belongs to a different repo",
                    sid
                )));
            }
            Ok(sid.to_string())
        }
    }
}

fn canonicalize_loose(path: &str) -> String {
    let p = PathBuf::from(path.trim());
    std::fs::canonicalize(&p)
        .unwrap_or(p)
        .to_string_lossy()
        .to_string()
}

async fn finalize_failure(
    task: &AutomationTask,
    run_id: &str,
    trigger: RunTrigger,
    error: String,
    body: &str,
) -> AutomationResult<RunOutcome> {
    let finished = with_store(|s| {
        let run = s.finish_run(run_id, RunStatus::Failure, None, Some(&error), None)?;
        let task =
            s.mark_task_finished(&task.id, RunStatus::Failure, trigger == RunTrigger::Schedule)?;
        // 路径不存在时自动暂停，避免反复失败
        let task = if error.contains("repo path missing") {
            s.set_enabled(&task.id, false)?
        } else {
            task
        };
        Ok((run, task))
    })?;
    Ok(RunOutcome {
        should_notify: should_notify_run(&finished.1, RunStatus::Failure),
        notify_title: finished.1.title.clone(),
        notify_body: if body.trim().is_empty() {
            truncate(&error, 480)
        } else {
            format!("{body}\n\n{}", truncate(&error, 240))
        },
        run: finished.0,
        task: finished.1,
    })
}

fn skipped_outcome(run: AutomationRun, task: AutomationTask, body: &str) -> RunOutcome {
    RunOutcome {
        should_notify: false,
        notify_title: task.title.clone(),
        notify_body: body.to_string(),
        run,
        task,
    }
}

fn truncate(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// 仅提取 assistant 最终文本摘要（不含工具调用/结果）。
fn assistant_text_only(message: &AgentMessage) -> String {
    message
        .parts
        .iter()
        .filter_map(|part| match part {
            AgentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

async fn resolve_run_summary(
    service: &PiAgentService,
    session_id: &str,
    prompt_message: &AgentMessage,
) -> String {
    let from_prompt = assistant_text_only(prompt_message);
    if !from_prompt.is_empty() {
        return truncate(&from_prompt, 480);
    }
    if let Ok(messages) = service.messages(session_id).await {
        for message in messages.iter().rev() {
            if message.role != AgentRole::Assistant {
                continue;
            }
            let text = assistant_text_only(message);
            if !text.is_empty() {
                return truncate(&text, 480);
            }
        }
    }
    String::new()
}

/// 供测试/调试：仅校验不跑 agent。
#[allow(dead_code)]
pub fn validate_task_ready(task: &AutomationTask) -> AutomationResult<()> {
    if task.repo_path.trim().is_empty() {
        return Err(AutomationError::InvalidInput(
            "repo_path is required".into(),
        ));
    }
    if !Path::new(&task.repo_path).is_dir() {
        return Err(AutomationError::InvalidInput(format!(
            "repo path does not exist: {}",
            task.repo_path
        )));
    }
    let _ = now_ms();
    Ok(())
}

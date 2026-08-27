//! 自动化 Tauri 命令：CRUD / 启停 / 立即运行 / 历史。

use giteam_core::automation::{
    self, AutomationRun, AutomationTask, CreateTaskInput, RunOutcome, ScheduleKind, SessionMode,
    TaskFilter, UpdateTaskInput,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 应用启动时挂载调度器（经前端事件尊重 notificationsAgent）。
pub fn start_automation_scheduler(app: AppHandle) {
    let notify: automation::NotifyHook = std::sync::Arc::new(move |title, body| {
        let _ = app.emit(
            "giteam://automation-notify",
            serde_json::json!({ "title": title, "body": body }),
        );
    });
    automation::start_scheduler(Some(notify));
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksRequest {
    pub filter: Option<String>,
    pub repo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub title: String,
    pub goal_prompt: String,
    pub repo_path: String,
    pub session_mode: String,
    pub session_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub schedule_kind: String,
    pub schedule_expr: String,
    pub timezone: Option<String>,
    pub notify_on_success: Option<bool>,
    pub notify_on_failure: Option<bool>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    pub id: String,
    pub title: Option<String>,
    pub goal_prompt: Option<String>,
    pub repo_path: Option<String>,
    pub session_mode: Option<String>,
    pub session_id: Option<Option<String>>,
    pub provider: Option<Option<String>>,
    pub model: Option<Option<String>>,
    pub thinking_level: Option<Option<String>>,
    pub schedule_kind: Option<String>,
    pub schedule_expr: Option<String>,
    pub timezone: Option<String>,
    pub notify_on_success: Option<bool>,
    pub notify_on_failure: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWithRuns {
    #[serde(flatten)]
    pub task: AutomationTask,
    pub recent_runs: Vec<AutomationRun>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNowResult {
    pub run: AutomationRun,
    pub task: AutomationTask,
}

fn map_err(err: automation::AutomationError) -> String {
    err.to_string()
}

fn parse_session_mode(raw: &str) -> Result<SessionMode, String> {
    SessionMode::parse(raw).ok_or_else(|| format!("invalid session_mode: {raw}"))
}

fn parse_schedule_kind(raw: &str) -> Result<ScheduleKind, String> {
    ScheduleKind::parse(raw).ok_or_else(|| format!("invalid schedule_kind: {raw}"))
}

#[tauri::command]
pub fn automation_list_tasks(request: ListTasksRequest) -> Result<Vec<AutomationTask>, String> {
    let filter = TaskFilter::parse(request.filter.as_deref());
    automation::with_store(|s| s.list_tasks(filter, request.repo_path.as_deref())).map_err(map_err)
}

#[tauri::command]
pub fn automation_get_task(id: String) -> Result<TaskWithRuns, String> {
    automation::with_store(|s| {
        let task = s.ack_task_view(&id)?;
        let recent_runs = s.list_runs(&id, 20)?;
        Ok(TaskWithRuns { task, recent_runs })
    })
    .map_err(map_err)
}

#[tauri::command]
pub fn automation_create_task(request: CreateTaskRequest) -> Result<AutomationTask, String> {
    let input = CreateTaskInput {
        title: request.title,
        goal_prompt: request.goal_prompt,
        repo_path: request.repo_path,
        session_mode: parse_session_mode(&request.session_mode)?,
        session_id: request.session_id,
        provider: request.provider,
        model: request.model,
        thinking_level: request.thinking_level,
        schedule_kind: parse_schedule_kind(&request.schedule_kind)?,
        schedule_expr: request.schedule_expr,
        timezone: request.timezone,
        notify_on_success: request.notify_on_success,
        notify_on_failure: request.notify_on_failure,
        enabled: request.enabled,
    };
    automation::with_store(|s| s.create_task(input)).map_err(map_err)
}

#[tauri::command]
pub fn automation_update_task(request: UpdateTaskRequest) -> Result<AutomationTask, String> {
    let input = UpdateTaskInput {
        title: request.title,
        goal_prompt: request.goal_prompt,
        repo_path: request.repo_path,
        session_mode: request
            .session_mode
            .as_deref()
            .map(parse_session_mode)
            .transpose()?,
        session_id: request.session_id,
        provider: request.provider,
        model: request.model,
        thinking_level: request.thinking_level,
        schedule_kind: request
            .schedule_kind
            .as_deref()
            .map(parse_schedule_kind)
            .transpose()?,
        schedule_expr: request.schedule_expr,
        timezone: request.timezone,
        notify_on_success: request.notify_on_success,
        notify_on_failure: request.notify_on_failure,
    };
    automation::with_store(|s| s.update_task(&request.id, input)).map_err(map_err)
}

#[tauri::command]
pub fn automation_set_enabled(id: String, enabled: bool) -> Result<AutomationTask, String> {
    automation::with_store(|s| s.set_enabled(&id, enabled)).map_err(map_err)
}

#[tauri::command]
pub fn automation_delete_task(id: String) -> Result<(), String> {
    automation::with_store(|s| s.delete_task(&id)).map_err(map_err)
}

#[tauri::command]
pub fn automation_list_runs(task_id: String, limit: Option<usize>) -> Result<Vec<AutomationRun>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 100);
    automation::with_store(|s| s.list_runs(&task_id, limit)).map_err(map_err)
}

#[tauri::command]
pub async fn automation_run_now(app: AppHandle, id: String) -> Result<RunNowResult, String> {
    let outcome: RunOutcome = automation::run_now(&id).await.map_err(map_err)?;
    if outcome.should_notify {
        let _ = app.emit(
            "giteam://automation-notify",
            serde_json::json!({
                "title": outcome.notify_title,
                "body": outcome.notify_body,
            }),
        );
    }
    Ok(RunNowResult {
        run: outcome.run,
        task: outcome.task,
    })
}

//! 自动化任务类型与校验。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    New,
    Existing,
}

impl SessionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Existing => "existing",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "new" => Some(Self::New),
            "existing" => Some(Self::Existing),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleKind {
    Cron,
    Interval,
    OnceAt,
}

impl ScheduleKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cron => "cron",
            Self::Interval => "interval",
            Self::OnceAt => "once_at",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "cron" => Some(Self::Cron),
            "interval" => Some(Self::Interval),
            "once_at" => Some(Self::OnceAt),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Running,
    Success,
    Failure,
    Skipped,
    Cancelled,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Success => "success",
            Self::Failure => "failure",
            Self::Skipped => "skipped",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "success" => Some(Self::Success),
            "failure" => Some(Self::Failure),
            "skipped" => Some(Self::Skipped),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

/// 任务完成后的通知投递渠道（每任务仅一种）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum NotifyChannel {
    #[default]
    Desktop,
    DingTalk,
}

impl NotifyChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::DingTalk => "dingtalk",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw.trim() {
            "dingtalk" => Self::DingTalk,
            _ => Self::Desktop,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunTrigger {
    Schedule,
    Manual,
    Event,
}

impl RunTrigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Schedule => "schedule",
            Self::Manual => "manual",
            Self::Event => "event",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "schedule" => Some(Self::Schedule),
            "manual" => Some(Self::Manual),
            "event" => Some(Self::Event),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationTask {
    pub id: String,
    pub title: String,
    pub goal_prompt: String,
    pub repo_path: String,
    pub session_mode: SessionMode,
    pub session_id: Option<String>,
    /// 可选：执行时切到该 provider（如 openai）。
    pub provider: Option<String>,
    /// 可选：执行时切到该 model id。
    pub model: Option<String>,
    /// 可选：推理强度（off/minimal/low/medium/high/xhigh；空或 auto 表示默认）。
    pub thinking_level: Option<String>,
    pub schedule_kind: ScheduleKind,
    pub schedule_expr: String,
    pub timezone: String,
    pub notify_on_success: bool,
    pub notify_on_failure: bool,
    #[serde(default)]
    pub notify_channel: NotifyChannel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dingtalk_webhook_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dingtalk_sign_secret: Option<String>,
    pub enabled: bool,
    pub next_run_at_ms: Option<i64>,
    pub last_run_at_ms: Option<i64>,
    /// 用户上次在详情页确认的运行时间；用于未读蓝点。
    pub last_viewed_run_at_ms: Option<i64>,
    pub last_status: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub task_id: String,
    pub status: RunStatus,
    pub trigger: RunTrigger,
    pub session_id: Option<String>,
    pub repo_path: String,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
    pub error_message: Option<String>,
    pub summary: Option<String>,
}

#[must_use]
pub fn has_dingtalk_webhook(task: &AutomationTask) -> bool {
    task.dingtalk_webhook_url
        .as_deref()
        .map(str::trim)
        .is_some_and(|s| !s.is_empty())
}

/// 有 Webhook 时走钉钉，避免 channel 字段与表单不一致导致不发。
#[must_use]
pub fn effective_notify_channel(task: &AutomationTask) -> NotifyChannel {
    if task.notify_channel == NotifyChannel::DingTalk || has_dingtalk_webhook(task) {
        NotifyChannel::DingTalk
    } else {
        NotifyChannel::Desktop
    }
}

/// 按任务配置与运行结果判断是否应投递通知。
pub fn should_notify_run(task: &AutomationTask, status: RunStatus) -> bool {
    if !task.notify_on_success && !task.notify_on_failure {
        return false;
    }
    match status {
        RunStatus::Success => {
            if task.notify_on_success {
                return true;
            }
            // 配置了钉钉 Webhook：成功时也推送最终摘要。
            effective_notify_channel(task) == NotifyChannel::DingTalk && has_dingtalk_webhook(task)
        }
        RunStatus::Failure => task.notify_on_failure,
        _ => false,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub goal_prompt: String,
    pub repo_path: String,
    pub session_mode: SessionMode,
    pub session_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub schedule_kind: ScheduleKind,
    pub schedule_expr: String,
    pub timezone: Option<String>,
    pub notify_on_success: Option<bool>,
    pub notify_on_failure: Option<bool>,
    pub notify_channel: Option<NotifyChannel>,
    pub dingtalk_webhook_url: Option<String>,
    pub dingtalk_sign_secret: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInput {
    pub title: Option<String>,
    pub goal_prompt: Option<String>,
    pub repo_path: Option<String>,
    pub session_mode: Option<SessionMode>,
    pub session_id: Option<Option<String>>,
    pub provider: Option<Option<String>>,
    pub model: Option<Option<String>>,
    pub thinking_level: Option<Option<String>>,
    pub schedule_kind: Option<ScheduleKind>,
    pub schedule_expr: Option<String>,
    pub timezone: Option<String>,
    pub notify_on_success: Option<bool>,
    pub notify_on_failure: Option<bool>,
    pub notify_channel: Option<NotifyChannel>,
    pub dingtalk_webhook_url: Option<String>,
    pub dingtalk_sign_secret: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskFilter {
    All,
    Enabled,
    Paused,
}

impl TaskFilter {
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim).unwrap_or("all") {
            "enabled" => Self::Enabled,
            "paused" => Self::Paused,
            _ => Self::All,
        }
    }
}

pub fn new_task_id() -> String {
    format!("atm_{}", uuid::Uuid::new_v4().simple())
}

pub fn new_run_id() -> String {
    format!("run_{}", uuid::Uuid::new_v4().simple())
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

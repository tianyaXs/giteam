//! 桌面端本地自动化（定时 Agent 任务）。
//!
//! 设计文档：`docs/superpowers/specs/2026-08-27-automation-design.md`。
//!
//! - 任务强制绑定 `repo_path`（不支持无工作空间）
//! - 存储：`~/.giteam/automation.db`
//! - 调度：Desktop 进程内 tick；应用未运行则不触发

mod runner;
mod schedule;
mod scheduler;
mod store;
mod types;

pub use runner::{execute_task, RunOutcome};
pub use schedule::{
    compute_next_run_at, preset_daily, preset_weekdays, preset_weekly,
};
pub use scheduler::{run_now, start_scheduler, NotifyHook};
pub use store::{
    default_db_path, global_store, with_store, AutomationStore,
};
pub use types::{
    now_ms, AutomationRun, AutomationTask, CreateTaskInput, RunStatus, RunTrigger, ScheduleKind,
    SessionMode, TaskFilter, UpdateTaskInput,
};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AutomationError {
    #[error("{0}")]
    InvalidInput(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("persistence error: {0}")]
    Persistence(String),
    #[error("execution error: {0}")]
    Execution(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type AutomationResult<T> = Result<T, AutomationError>;

//! SQLite 持久化：`~/.giteam/automation.db`

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use rusqlite::{params, Connection, OptionalExtension};

use super::schedule::compute_next_run_at;
use super::types::{
    new_run_id, new_task_id, now_ms, AutomationRun, AutomationTask, CreateTaskInput, RunStatus,
    RunTrigger, ScheduleKind, SessionMode, TaskFilter, UpdateTaskInput,
};
use super::{AutomationError, AutomationResult};

static STORE: OnceLock<Mutex<AutomationStore>> = OnceLock::new();

pub struct AutomationStore {
    conn: Connection,
}

impl AutomationStore {
    pub fn open(path: &Path) -> AutomationResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> AutomationResult<()> {
        self.conn
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS automation_tasks (
                  id TEXT PRIMARY KEY NOT NULL,
                  title TEXT NOT NULL,
                  goal_prompt TEXT NOT NULL,
                  repo_path TEXT NOT NULL,
                  session_mode TEXT NOT NULL,
                  session_id TEXT,
                  provider TEXT,
                  model TEXT,
                  schedule_kind TEXT NOT NULL,
                  schedule_expr TEXT NOT NULL,
                  timezone TEXT NOT NULL,
                  notify_on_success INTEGER NOT NULL DEFAULT 1,
                  notify_on_failure INTEGER NOT NULL DEFAULT 1,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  next_run_at_ms INTEGER,
                  last_run_at_ms INTEGER,
                  last_status TEXT,
                  created_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_automation_tasks_due
                  ON automation_tasks(enabled, next_run_at_ms);
                CREATE INDEX IF NOT EXISTS idx_automation_tasks_repo
                  ON automation_tasks(repo_path);

                CREATE TABLE IF NOT EXISTS automation_runs (
                  id TEXT PRIMARY KEY NOT NULL,
                  task_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  trigger TEXT NOT NULL,
                  session_id TEXT,
                  repo_path TEXT NOT NULL,
                  started_at_ms INTEGER NOT NULL,
                  finished_at_ms INTEGER,
                  error_message TEXT,
                  summary TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_automation_runs_task
                  ON automation_runs(task_id, started_at_ms DESC);
                "#,
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        // 兼容已存在库：补齐 provider / model 列。
        self.ensure_column("automation_tasks", "provider", "TEXT")?;
        self.ensure_column("automation_tasks", "model", "TEXT")?;
        self.ensure_column("automation_tasks", "thinking_level", "TEXT")?;
        self.ensure_column("automation_tasks", "last_viewed_run_at_ms", "INTEGER")?;
        Ok(())
    }

    fn ensure_column(&self, table: &str, column: &str, decl: &str) -> AutomationResult<()> {
        let mut stmt = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| AutomationError::Persistence(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        if names.iter().any(|n| n == column) {
            return Ok(());
        }
        self.conn
            .execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"),
                [],
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        Ok(())
    }

    pub fn list_tasks(
        &self,
        filter: TaskFilter,
        repo_path: Option<&str>,
    ) -> AutomationResult<Vec<AutomationTask>> {
        let mut sql = String::from(
            "SELECT id, title, goal_prompt, repo_path, session_mode, session_id,
                    provider, model, thinking_level, schedule_kind, schedule_expr, timezone,
                    notify_on_success, notify_on_failure,
                    enabled, next_run_at_ms, last_run_at_ms, last_viewed_run_at_ms, last_status, created_at_ms, updated_at_ms
             FROM automation_tasks WHERE 1=1",
        );
        match filter {
            TaskFilter::All => {}
            TaskFilter::Enabled => sql.push_str(" AND enabled = 1"),
            TaskFilter::Paused => sql.push_str(" AND enabled = 0"),
        }
        if repo_path.is_some() {
            sql.push_str(" AND repo_path = ?1");
        }
        sql.push_str(" ORDER BY updated_at_ms DESC");

        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;

        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<AutomationTask> {
            Ok(row_to_task(row)?)
        };

        let tasks = if let Some(path) = repo_path {
            let rows = stmt
                .query_map(params![path], map_row)
                .map_err(|e| AutomationError::Persistence(e.to_string()))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| AutomationError::Persistence(e.to_string()))?
        } else {
            let rows = stmt
                .query_map([], map_row)
                .map_err(|e| AutomationError::Persistence(e.to_string()))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| AutomationError::Persistence(e.to_string()))?
        };
        Ok(tasks)
    }

    pub fn get_task(&self, id: &str) -> AutomationResult<Option<AutomationTask>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, goal_prompt, repo_path, session_mode, session_id,
                        provider, model, thinking_level, schedule_kind, schedule_expr, timezone,
                        notify_on_success, notify_on_failure,
                        enabled, next_run_at_ms, last_run_at_ms, last_viewed_run_at_ms, last_status, created_at_ms, updated_at_ms
                 FROM automation_tasks WHERE id = ?1",
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        stmt.query_row(params![id], |row| Ok(row_to_task(row)?))
            .optional()
            .map_err(|e| AutomationError::Persistence(e.to_string()))
    }

    /// 打开任务详情时标记运行结果已读（清除列表蓝点）。
    pub fn ack_task_view(&self, id: &str) -> AutomationResult<AutomationTask> {
        let mut task = self
            .get_task(id)?
            .ok_or_else(|| AutomationError::NotFound(id.to_string()))?;
        if let Some(last) = task.last_run_at_ms {
            task.last_viewed_run_at_ms = Some(last);
            task.updated_at_ms = now_ms();
            self.persist_task(&task)?;
        }
        Ok(task)
    }

    pub fn create_task(&self, input: CreateTaskInput) -> AutomationResult<AutomationTask> {
        validate_create(&input)?;
        let now = now_ms();
        let id = new_task_id();
        let timezone = input
            .timezone
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("local")
            .to_string();
        let enabled = input.enabled.unwrap_or(true);
        let next = if enabled {
            compute_next_run_at(input.schedule_kind, &input.schedule_expr, now)?
        } else {
            None
        };
        let session_id = match input.session_mode {
            SessionMode::New => None,
            SessionMode::Existing => input.session_id.clone(),
        };
        let provider = input
            .provider
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let model = input
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let thinking_level = normalize_thinking_level(input.thinking_level.as_deref());
        self.conn
            .execute(
                "INSERT INTO automation_tasks (
                    id, title, goal_prompt, repo_path, session_mode, session_id,
                    provider, model, thinking_level, schedule_kind, schedule_expr, timezone,
                    notify_on_success, notify_on_failure,
                    enabled, next_run_at_ms, last_run_at_ms, last_status, created_at_ms, updated_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,NULL,NULL,?17,?17)",
                params![
                    id,
                    input.title.trim(),
                    input.goal_prompt.trim(),
                    canonicalize_repo(&input.repo_path)?,
                    input.session_mode.as_str(),
                    session_id,
                    provider,
                    model,
                    thinking_level,
                    input.schedule_kind.as_str(),
                    input.schedule_expr.trim(),
                    timezone,
                    bool_i(input.notify_on_success.unwrap_or(true)),
                    bool_i(input.notify_on_failure.unwrap_or(true)),
                    bool_i(enabled),
                    next,
                    now,
                ],
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        self.get_task(&id)?
            .ok_or_else(|| AutomationError::Persistence("task missing after insert".into()))
    }

    pub fn update_task(&self, id: &str, input: UpdateTaskInput) -> AutomationResult<AutomationTask> {
        let mut task = self
            .get_task(id)?
            .ok_or_else(|| AutomationError::NotFound(id.to_string()))?;
        if let Some(title) = input.title {
            let t = title.trim();
            if t.is_empty() {
                return Err(AutomationError::InvalidInput("title is required".into()));
            }
            task.title = t.to_string();
        }
        if let Some(goal) = input.goal_prompt {
            let g = goal.trim();
            if g.is_empty() {
                return Err(AutomationError::InvalidInput("goal_prompt is required".into()));
            }
            task.goal_prompt = g.to_string();
        }
        if let Some(path) = input.repo_path {
            task.repo_path = canonicalize_repo(&path)?;
        }
        if let Some(mode) = input.session_mode {
            task.session_mode = mode;
            if mode == SessionMode::New {
                task.session_id = None;
            }
        }
        if let Some(sid) = input.session_id {
            if task.session_mode == SessionMode::Existing {
                let id = sid
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                if id.is_none() {
                    return Err(AutomationError::InvalidInput(
                        "session_id is required for existing session mode".into(),
                    ));
                }
                task.session_id = id;
            }
        }
        if let Some(provider) = input.provider {
            task.provider = provider
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
        }
        if let Some(model) = input.model {
            task.model = model
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
        }
        if let Some(level) = input.thinking_level {
            task.thinking_level = normalize_thinking_level(level.as_deref());
        }
        if let Some(kind) = input.schedule_kind {
            task.schedule_kind = kind;
        }
        if let Some(expr) = input.schedule_expr {
            let e = expr.trim();
            if e.is_empty() {
                return Err(AutomationError::InvalidInput(
                    "schedule_expr is required".into(),
                ));
            }
            task.schedule_expr = e.to_string();
        }
        if let Some(tz) = input.timezone {
            let t = tz.trim();
            if !t.is_empty() {
                task.timezone = t.to_string();
            }
        }
        if let Some(v) = input.notify_on_success {
            task.notify_on_success = v;
        }
        if let Some(v) = input.notify_on_failure {
            task.notify_on_failure = v;
        }
        // 校验日程仍可解析
        let _ = compute_next_run_at(task.schedule_kind, &task.schedule_expr, now_ms())?;
        if task.enabled {
            task.next_run_at_ms =
                compute_next_run_at(task.schedule_kind, &task.schedule_expr, now_ms())?;
        }
        task.updated_at_ms = now_ms();
        self.persist_task(&task)?;
        Ok(task)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> AutomationResult<AutomationTask> {
        let mut task = self
            .get_task(id)?
            .ok_or_else(|| AutomationError::NotFound(id.to_string()))?;
        task.enabled = enabled;
        task.updated_at_ms = now_ms();
        if enabled {
            task.next_run_at_ms =
                compute_next_run_at(task.schedule_kind, &task.schedule_expr, now_ms())?;
        } else {
            task.next_run_at_ms = None;
        }
        self.persist_task(&task)?;
        Ok(task)
    }

    pub fn delete_task(&self, id: &str) -> AutomationResult<()> {
        self.conn
            .execute("DELETE FROM automation_runs WHERE task_id = ?1", params![id])
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        let n = self
            .conn
            .execute("DELETE FROM automation_tasks WHERE id = ?1", params![id])
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        if n == 0 {
            return Err(AutomationError::NotFound(id.to_string()));
        }
        Ok(())
    }

    fn persist_task(&self, task: &AutomationTask) -> AutomationResult<()> {
        self.conn
            .execute(
                "UPDATE automation_tasks SET
                    title=?2, goal_prompt=?3, repo_path=?4, session_mode=?5, session_id=?6,
                    provider=?7, model=?8, thinking_level=?9, schedule_kind=?10, schedule_expr=?11, timezone=?12,
                    notify_on_success=?13, notify_on_failure=?14, enabled=?15,
                    next_run_at_ms=?16, last_run_at_ms=?17, last_viewed_run_at_ms=?18, last_status=?19, updated_at_ms=?20
                 WHERE id=?1",
                params![
                    task.id,
                    task.title,
                    task.goal_prompt,
                    task.repo_path,
                    task.session_mode.as_str(),
                    task.session_id,
                    task.provider,
                    task.model,
                    task.thinking_level,
                    task.schedule_kind.as_str(),
                    task.schedule_expr,
                    task.timezone,
                    bool_i(task.notify_on_success),
                    bool_i(task.notify_on_failure),
                    bool_i(task.enabled),
                    task.next_run_at_ms,
                    task.last_run_at_ms,
                    task.last_viewed_run_at_ms,
                    task.last_status,
                    task.updated_at_ms,
                ],
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        Ok(())
    }

    /// 领取到期任务：enabled 且 next_run_at_ms <= now，且当前无 running run。
    pub fn claim_due_tasks(&self, now: i64) -> AutomationResult<Vec<AutomationTask>> {
        let candidates = self.list_tasks(TaskFilter::Enabled, None)?;
        let mut claimed = Vec::new();
        for task in candidates {
            let Some(next) = task.next_run_at_ms else {
                continue;
            };
            if next > now {
                continue;
            }
            if self.has_running_run(&task.id)? {
                continue;
            }
            claimed.push(task);
        }
        Ok(claimed)
    }

    pub fn has_running_run(&self, task_id: &str) -> AutomationResult<bool> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT 1 FROM automation_runs WHERE task_id = ?1 AND status = 'running' LIMIT 1",
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        let found = stmt
            .exists(params![task_id])
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        Ok(found)
    }

    pub fn insert_run(
        &self,
        task: &AutomationTask,
        trigger: RunTrigger,
        status: RunStatus,
    ) -> AutomationResult<AutomationRun> {
        let now = now_ms();
        let run = AutomationRun {
            id: new_run_id(),
            task_id: task.id.clone(),
            status,
            trigger,
            session_id: None,
            repo_path: task.repo_path.clone(),
            started_at_ms: now,
            finished_at_ms: None,
            error_message: None,
            summary: None,
        };
        self.conn
            .execute(
                "INSERT INTO automation_runs (
                    id, task_id, status, trigger, session_id, repo_path,
                    started_at_ms, finished_at_ms, error_message, summary
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,NULL,NULL)",
                params![
                    run.id,
                    run.task_id,
                    run.status.as_str(),
                    run.trigger.as_str(),
                    run.session_id,
                    run.repo_path,
                    run.started_at_ms,
                ],
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        Ok(run)
    }

    pub fn finish_run(
        &self,
        run_id: &str,
        status: RunStatus,
        session_id: Option<&str>,
        error_message: Option<&str>,
        summary: Option<&str>,
    ) -> AutomationResult<AutomationRun> {
        let finished = now_ms();
        self.conn
            .execute(
                "UPDATE automation_runs SET
                    status=?2, session_id=COALESCE(?3, session_id),
                    finished_at_ms=?4, error_message=?5, summary=?6
                 WHERE id=?1",
                params![
                    run_id,
                    status.as_str(),
                    session_id,
                    finished,
                    error_message,
                    summary,
                ],
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        self.get_run(run_id)?
            .ok_or_else(|| AutomationError::NotFound(run_id.to_string()))
    }

    pub fn get_run(&self, id: &str) -> AutomationResult<Option<AutomationRun>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, task_id, status, trigger, session_id, repo_path,
                        started_at_ms, finished_at_ms, error_message, summary
                 FROM automation_runs WHERE id = ?1",
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        stmt.query_row(params![id], |row| Ok(row_to_run(row)?))
            .optional()
            .map_err(|e| AutomationError::Persistence(e.to_string()))
    }

    pub fn list_runs(&self, task_id: &str, limit: usize) -> AutomationResult<Vec<AutomationRun>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, task_id, status, trigger, session_id, repo_path,
                        started_at_ms, finished_at_ms, error_message, summary
                 FROM automation_runs WHERE task_id = ?1
                 ORDER BY started_at_ms DESC LIMIT ?2",
            )
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        let rows = stmt
            .query_map(params![task_id, limit as i64], |row| Ok(row_to_run(row)?))
            .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AutomationError::Persistence(e.to_string()))
    }

    /// 更新任务 last_* 与下次 next_run（仅 schedule 触发后推进；manual 不改 next）。
    pub fn mark_task_finished(
        &self,
        task_id: &str,
        status: RunStatus,
        advance_schedule: bool,
    ) -> AutomationResult<AutomationTask> {
        let mut task = self
            .get_task(task_id)?
            .ok_or_else(|| AutomationError::NotFound(task_id.to_string()))?;
        let now = now_ms();
        task.last_run_at_ms = Some(now);
        task.last_status = Some(status.as_str().to_string());
        task.updated_at_ms = now;
        if advance_schedule && task.enabled {
            task.next_run_at_ms =
                compute_next_run_at(task.schedule_kind, &task.schedule_expr, now)?;
            // once_at 跑完后自动暂停
            if task.schedule_kind == ScheduleKind::OnceAt && task.next_run_at_ms.is_none() {
                task.enabled = false;
            }
        }
        self.persist_task(&task)?;
        Ok(task)
    }

    /// 校准所有 enabled 任务的 next_run（启动时调用）。
    pub fn recalibrate_next_runs(&self) -> AutomationResult<()> {
        let now = now_ms();
        for task in self.list_tasks(TaskFilter::Enabled, None)? {
            let next = compute_next_run_at(task.schedule_kind, &task.schedule_expr, now)?;
            self.conn
                .execute(
                    "UPDATE automation_tasks SET next_run_at_ms = ?2, updated_at_ms = ?3 WHERE id = ?1",
                    params![task.id, next, now],
                )
                .map_err(|e| AutomationError::Persistence(e.to_string()))?;
        }
        Ok(())
    }
}

fn bool_i(v: bool) -> i64 {
    if v {
        1
    } else {
        0
    }
}

fn canonicalize_repo(path: &str) -> AutomationResult<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AutomationError::InvalidInput(
            "repo_path is required".into(),
        ));
    }
    let p = PathBuf::from(trimmed);
    if !p.exists() {
        return Err(AutomationError::InvalidInput(format!(
            "repo path does not exist: {trimmed}"
        )));
    }
    let canon = std::fs::canonicalize(&p).unwrap_or(p);
    Ok(canon.to_string_lossy().to_string())
}

fn validate_create(input: &CreateTaskInput) -> AutomationResult<()> {
    if input.title.trim().is_empty() {
        return Err(AutomationError::InvalidInput("title is required".into()));
    }
    if input.goal_prompt.trim().is_empty() {
        return Err(AutomationError::InvalidInput(
            "goal_prompt is required".into(),
        ));
    }
    if input.repo_path.trim().is_empty() {
        return Err(AutomationError::InvalidInput(
            "repo_path is required".into(),
        ));
    }
    if input.session_mode == SessionMode::Existing {
        let sid = input
            .session_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if sid.is_none() {
            return Err(AutomationError::InvalidInput(
                "session_id is required for existing session mode".into(),
            ));
        }
    }
    let _ = compute_next_run_at(input.schedule_kind, &input.schedule_expr, now_ms())?;
    Ok(())
}

fn normalize_thinking_level(raw: Option<&str>) -> Option<String> {
    let trimmed = raw.unwrap_or("").trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
        return None;
    }
    Some(trimmed.to_string())
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationTask> {
    let session_mode = SessionMode::parse(&row.get::<_, String>(4)?)
        .unwrap_or(SessionMode::New);
    let schedule_kind = ScheduleKind::parse(&row.get::<_, String>(9)?)
        .unwrap_or(ScheduleKind::Interval);
    Ok(AutomationTask {
        id: row.get(0)?,
        title: row.get(1)?,
        goal_prompt: row.get(2)?,
        repo_path: row.get(3)?,
        session_mode,
        session_id: row.get(5)?,
        provider: row.get(6)?,
        model: row.get(7)?,
        thinking_level: row.get(8)?,
        schedule_kind,
        schedule_expr: row.get(10)?,
        timezone: row.get(11)?,
        notify_on_success: row.get::<_, i64>(12)? != 0,
        notify_on_failure: row.get::<_, i64>(13)? != 0,
        enabled: row.get::<_, i64>(14)? != 0,
        next_run_at_ms: row.get(15)?,
        last_run_at_ms: row.get(16)?,
        last_viewed_run_at_ms: row.get(17)?,
        last_status: row.get(18)?,
        created_at_ms: row.get(19)?,
        updated_at_ms: row.get(20)?,
    })
}

fn row_to_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRun> {
    let status = RunStatus::parse(&row.get::<_, String>(2)?).unwrap_or(RunStatus::Failure);
    let trigger = RunTrigger::parse(&row.get::<_, String>(3)?).unwrap_or(RunTrigger::Manual);
    Ok(AutomationRun {
        id: row.get(0)?,
        task_id: row.get(1)?,
        status,
        trigger,
        session_id: row.get(4)?,
        repo_path: row.get(5)?,
        started_at_ms: row.get(6)?,
        finished_at_ms: row.get(7)?,
        error_message: row.get(8)?,
        summary: row.get(9)?,
    })
}

/// 默认库路径：`$GITEAM_HOME/automation.db` 或 `~/.giteam/automation.db`。
pub fn default_db_path() -> Option<PathBuf> {
    crate::pi_agent::default_data_dir().map(|d| d.join("automation.db"))
}

pub fn global_store() -> AutomationResult<&'static Mutex<AutomationStore>> {
    if let Some(lock) = STORE.get() {
        return Ok(lock);
    }
    let path = default_db_path().ok_or_else(|| {
        AutomationError::Persistence("cannot resolve Giteam data dir".into())
    })?;
    let store = AutomationStore::open(&path)?;
    let _ = STORE.set(Mutex::new(store));
    STORE
        .get()
        .ok_or_else(|| AutomationError::Persistence("automation store init race".into()))
}

pub fn with_store<T>(f: impl FnOnce(&AutomationStore) -> AutomationResult<T>) -> AutomationResult<T> {
    let lock = global_store()?;
    let store = lock
        .lock()
        .map_err(|_| AutomationError::Persistence("automation store lock poisoned".into()))?;
    f(&store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_input(repo: &Path) -> CreateTaskInput {
        CreateTaskInput {
            title: "Daily".into(),
            goal_prompt: "Summarize changes".into(),
            repo_path: repo.to_string_lossy().to_string(),
            session_mode: SessionMode::New,
            session_id: None,
            provider: None,
            model: None,
            thinking_level: None,
            schedule_kind: ScheduleKind::Interval,
            schedule_expr: "3600".into(),
            timezone: Some("local".into()),
            notify_on_success: Some(true),
            notify_on_failure: Some(true),
            enabled: Some(true),
        }
    }

    #[test]
    fn crud_roundtrip() {
        let dir = tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let db = dir.path().join("automation.db");
        let store = AutomationStore::open(&db).unwrap();

        let task = store.create_task(sample_input(&repo)).unwrap();
        assert!(task.enabled);
        assert!(task.next_run_at_ms.is_some());

        let listed = store.list_tasks(TaskFilter::Enabled, None).unwrap();
        assert_eq!(listed.len(), 1);

        let paused = store.set_enabled(&task.id, false).unwrap();
        assert!(!paused.enabled);
        assert!(paused.next_run_at_ms.is_none());

        store.delete_task(&task.id).unwrap();
        assert!(store.list_tasks(TaskFilter::All, None).unwrap().is_empty());
    }

    #[test]
    fn rejects_empty_repo() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("automation.db");
        let store = AutomationStore::open(&db).unwrap();
        let mut input = sample_input(dir.path());
        input.repo_path = "".into();
        assert!(store.create_task(input).is_err());
    }

    #[test]
    fn run_lifecycle() {
        let dir = tempdir().unwrap();
        let repo = dir.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let store = AutomationStore::open(&dir.path().join("a.db")).unwrap();
        let task = store.create_task(sample_input(&repo)).unwrap();
        let run = store
            .insert_run(&task, RunTrigger::Manual, RunStatus::Running)
            .unwrap();
        assert!(store.has_running_run(&task.id).unwrap());
        store
            .finish_run(&run.id, RunStatus::Success, Some("sess"), None, Some("ok"))
            .unwrap();
        assert!(!store.has_running_run(&task.id).unwrap());
        let runs = store.list_runs(&task.id, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, RunStatus::Success);
    }
}

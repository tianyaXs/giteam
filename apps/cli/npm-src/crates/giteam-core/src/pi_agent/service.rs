use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use futures::lock::Mutex as AsyncMutex;
use pi::sdk::{create_agent_session, AbortHandle, AgentSessionHandle, SessionOptions};
use thiserror::Error;

use super::interactions::{InteractionHub, InteractionRunContext, InteractionStore};
use super::tools::GiteamToolFactory;
use super::{
    ensure_pi_agent_dir_env, AgentEvent, AgentEventEnvelope, AgentInteraction,
    AgentInteractionReply, AgentMessage, AgentModelInfo, AgentProviderInfo, AgentSessionStatus,
    CustomProviderInput, PiEventTranslator, PiRuntimeInfo, ProviderCatalog, SecretStore,
};

pub type AgentEventSink = Arc<dyn Fn(AgentEventEnvelope) + Send + Sync>;
pub type AgentEventReceiver = Receiver<AgentEventEnvelope>;

#[derive(Clone)]
pub struct PiSessionConfig {
    pub repo_path: PathBuf,
    pub session_dir: PathBuf,
    pub session_path: Option<PathBuf>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub system_prompt: Option<String>,
    pub append_system_prompt: Option<String>,
    pub enabled_tools: Option<Vec<String>>,
    pub extension_paths: Vec<PathBuf>,
    pub no_session: bool,
    /// Thinking level（"off"/"minimal"/"low"/"medium"/"high"/"xhigh"）。
    pub thinking: Option<String>,
    /// 单次 run 的最大工具迭代次数。`None` = 不限制（映射为 `usize::MAX`，
    /// pi 侧 never-warn/never-stop）；`Some(n)` 透传 pi 的迭代预算与 80% 移交警告。
    pub max_tool_iterations: Option<usize>,
}

impl std::fmt::Debug for PiSessionConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PiSessionConfig")
            .field("repo_path", &self.repo_path)
            .field("session_dir", &self.session_dir)
            .field("session_path", &self.session_path)
            .field("provider", &self.provider)
            .field("model", &self.model)
            .field("api_key", &self.api_key.as_ref().map(|_| "[redacted]"))
            .field("system_prompt", &self.system_prompt)
            .field("append_system_prompt", &self.append_system_prompt)
            .field("enabled_tools", &self.enabled_tools)
            .field("extension_paths", &self.extension_paths)
            .field("no_session", &self.no_session)
            .field("thinking", &self.thinking)
            .field("max_tool_iterations", &self.max_tool_iterations)
            .finish()
    }
}

impl PiSessionConfig {
    #[must_use]
    pub fn persistent(repo_path: impl Into<PathBuf>, session_dir: impl Into<PathBuf>) -> Self {
        Self {
            repo_path: repo_path.into(),
            session_dir: session_dir.into(),
            session_path: None,
            provider: None,
            model: None,
            api_key: None,
            system_prompt: None,
            append_system_prompt: None,
            enabled_tools: None,
            extension_paths: Vec::new(),
            no_session: false,
            thinking: None,
            max_tool_iterations: None,
        }
    }

    fn into_sdk_options(self) -> SessionOptions {
        // 未显式指定系统提示词时注入 Giteam 品牌的默认提示词；
        // 否则 pi 会用它自己的默认提示词（自我定位为 pi 并附带 pi 文档指引）。
        let system_prompt = self
            .system_prompt
            .or_else(|| Some(super::default_system_prompt(self.enabled_tools.as_deref())));
        // 项目记忆（GITEAM.md / AGENTS.md）前置到 append_system_prompt，
        // 不覆盖品牌默认 system_prompt；三通道共用此装配，热恢复也生效。
        let memory_appended =
            prepend_project_memory(self.append_system_prompt, &self.repo_path);
        // 末尾追加 pi skills 注入块：pi 嵌入式 SDK 不会自动加载 skills，必须显式注入。
        // build_skills_prompt 内部 load_skills 扫 {repo}/.pi/skills + {PI_CODING_AGENT_DIR}/skills，
        // format_skills_for_prompt 自动过滤 disable-model-invocation；无可见 skill 时返回 None，
        // append 段保持原样。三通道共用此装配，热恢复 get_session 也带最新 skill 列表。
        let append_system_prompt =
            match (memory_appended, super::skills::build_skills_prompt(&self.repo_path)) {
                (Some(base), Some(skills)) => Some(format!("{base}\n{skills}")),
                (Some(base), None) => Some(base),
                (None, Some(skills)) => Some(skills),
                (None, None) => None,
            };
        SessionOptions {
            provider: self.provider,
            model: self.model,
            api_key: self.api_key,
            thinking: self
                .thinking
                .as_deref()
                .and_then(|level| level.parse().ok()),
            system_prompt,
            append_system_prompt,
            enabled_tools: self.enabled_tools,
            working_directory: Some(self.repo_path),
            no_session: self.no_session,
            session_path: self.session_path,
            session_dir: Some(self.session_dir),
            extension_paths: self.extension_paths,
            // None（不限制）映射为 usize::MAX：pi 官方支持的 never-warn 用法
            //（pi agent.rs `should_warn_at_iteration_threshold` 文档注释），
            // 警告与 100% 硬停双双不触发；Some(n) 原样透传。
            max_tool_iterations: self.max_tool_iterations.unwrap_or(usize::MAX),
            ..SessionOptions::default()
        }
    }
}

/// 把项目记忆（GITEAM.md 优先 / AGENTS.md 回退）前置到既有 append_system_prompt。
/// 命中记忆时用「项目记忆」小节包裹，再拼接调用方传入的追加段；未命中则原样返回。
fn prepend_project_memory(
    existing: Option<String>,
    repo_path: &std::path::Path,
) -> Option<String> {
    let memory = super::project_memory::read_project_memory(repo_path);
    match (memory, existing) {
        (Some(memory), Some(rest)) => {
            Some(format!("# 项目记忆 (GITEAM.md)\n{memory}\n\n{rest}"))
        }
        (Some(memory), None) => Some(format!("# 项目记忆 (GITEAM.md)\n{memory}")),
        (None, rest) => rest,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionSummary {
    pub session_id: String,
    pub repo_path: PathBuf,
    pub provider: String,
    pub model: String,
    pub message_count: usize,
    /// 最近一次活动（创建/prompt/模型切换）的毫秒时间戳，供侧栏排序展示。
    pub updated_at_ms: u64,
    /// 会话标题（首条用户消息摘要）；pi SessionHeader 无标题字段，
    /// 由本服务派生并缓存在 record 中。空会话为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSessionRecord {
    schema_version: u32,
    session_id: String,
    repo_path: PathBuf,
    session_dir: PathBuf,
    session_path: PathBuf,
    provider: String,
    model: String,
    no_session: bool,
    updated_at_ms: u64,
    /// 派生标题缓存；旧 catalog 无此字段，靠 default 兼容。
    #[serde(default)]
    title: Option<String>,
}

#[derive(Debug, Error)]
pub enum PiAgentError {
    #[error("Pi SDK error: {0}")]
    Sdk(String),
    #[error("agent session not found: {0}")]
    SessionNotFound(String),
    #[error("agent session already exists: {0}")]
    SessionAlreadyExists(String),
    #[error("agent run already exists: {0}")]
    RunAlreadyExists(String),
    #[error("agent session is already running: {0}")]
    SessionBusy(String),
    #[error("agent service state lock is unavailable: {0}")]
    State(String),
    #[error("agent session persistence failed: {0}")]
    Persistence(String),
    #[error("agent secret store failed: {0}")]
    Secret(String),
    #[error("agent provider catalog failed: {0}")]
    Provider(String),
    #[error("agent interaction failed: {0}")]
    Interaction(String),
}

struct ManagedSession {
    repo_path: PathBuf,
    handle: AsyncMutex<AgentSessionHandle>,
    /// 审批/提问交互枢纽（PR6）：随 session 创建，run 上下文在 prompt 时绑定。
    hub: Arc<InteractionHub>,
}

struct ActiveRun {
    session_id: String,
    abort_handle: AbortHandle,
}

type EventSubscriberKey = (String, String);

pub struct PiAgentService {
    sessions: Mutex<HashMap<String, Arc<ManagedSession>>>,
    records: Mutex<HashMap<String, PersistedSessionRecord>>,
    catalog_path: Option<PathBuf>,
    active_runs: Mutex<HashMap<String, ActiveRun>>,
    subscribers: Arc<Mutex<HashMap<EventSubscriberKey, Vec<Sender<AgentEventEnvelope>>>>>,
    /// 审批/提问 pending 注册表（PR6），跨 session 共享，按 id 裁决。
    interactions: Arc<InteractionStore>,
    /// 统一 secret vault。`None` 仅用于隔离测试（不触碰真实 vault 与环境变量）。
    secrets: Option<SecretStore>,
}

impl Default for PiAgentService {
    fn default() -> Self {
        Self::new()
    }
}

impl PiAgentService {
    #[must_use]
    pub fn global() -> &'static Arc<Self> {
        static SERVICE: OnceLock<Arc<PiAgentService>> = OnceLock::new();
        SERVICE.get_or_init(|| Arc::new(Self::new_with_catalog(true)))
    }

    #[must_use]
    pub fn new() -> Self {
        Self::new_with_catalog(false)
    }

    fn new_with_catalog(load_catalog: bool) -> Self {
        let catalog_path = global_catalog_path();
        let records = if load_catalog {
            load_catalog_records(catalog_path.as_ref())
        } else {
            HashMap::new()
        };
        // 生产模式（global）：先把 PI_CODING_AGENT_DIR 指到 Giteam 管理的目录，
        // 使 Pi 内部 AuthStorage/ModelRegistry 与本 service 的 vault 读写同一文件；
        // 然后 vault 与该目录下的 auth.json 对齐。必须在任何 Pi session 创建前完成。
        let secrets = if load_catalog {
            ensure_pi_agent_dir_env();
            SecretStore::default_path().map(SecretStore::new)
        } else {
            None
        };
        Self {
            sessions: Mutex::new(HashMap::new()),
            records: Mutex::new(records),
            catalog_path: if load_catalog { catalog_path } else { None },
            active_runs: Mutex::new(HashMap::new()),
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            interactions: Arc::new(InteractionStore::new()),
            secrets,
        }
    }

    /// 注入隔离的 secret vault（测试或自定义数据目录场景）。
    #[must_use]
    pub fn with_secrets(mut self, secrets: SecretStore) -> Self {
        self.secrets = Some(secrets);
        self
    }

    #[must_use]
    pub fn runtime_info(&self) -> PiRuntimeInfo {
        PiRuntimeInfo::current()
    }

    #[must_use]
    pub fn session_count(&self) -> usize {
        self.sessions.lock().map_or(0, |sessions| sessions.len())
    }

    #[must_use]
    pub fn active_run_count(&self) -> usize {
        self.active_runs.lock().map_or(0, |runs| runs.len())
    }

    /// Stop accepting work owned by this service and release all in-process
    /// session handles. Pi's abort handle is synchronous, so shutdown can be
    /// called from Tauri/CLI exit callbacks without blocking the runtime.
    pub fn shutdown(&self) {
        if let Ok(mut runs) = self.active_runs.lock() {
            for run in runs.values() {
                run.abort_handle.abort();
            }
            runs.clear();
        }
        // 拒绝全部 pending 交互，释放等待中的工具 future。
        self.interactions.reject_all("aborted");
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.clear();
        }
        let _ = self.persist_catalog();
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
        if let Ok(mut records) = self.records.lock() {
            records.clear();
        }
    }

    #[must_use]
    pub fn subscribe_events(&self, session_id: &str, run_id: &str) -> AgentEventReceiver {
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers
                .entry((session_id.to_string(), run_id.to_string()))
                .or_default()
                .push(sender);
        }
        receiver
    }

    pub async fn create_session(
        &self,
        config: PiSessionConfig,
    ) -> Result<PiSessionSummary, PiAgentError> {
        let mut config = self.with_secret_fallback(config)?;
        if !config.no_session {
            fs::create_dir_all(&config.session_dir)
                .map_err(|error| PiAgentError::Persistence(error.to_string()))?;
            if config.session_path.is_none() {
                config.session_path = Some(next_session_path(&config.session_dir));
            }
            // Pi 的 Session::open 要求 session_path 指向一个已存在的 JSONL 文件，
            // 否则报 SessionNotFound。新会话先写入一行合法 header（与 pi 自身测试
            // 手写 header 的做法一致），保持 Giteam 侧确定性的文件命名与 record 记账。
            if let Some(path) = &config.session_path {
                if !path.exists() {
                    let mut header = pi::session::SessionHeader::new();
                    header.cwd = config.repo_path.display().to_string();
                    let line = serde_json::to_string(&header)
                        .map_err(|error| PiAgentError::Persistence(error.to_string()))?;
                    fs::write(path, format!("{line}\n"))
                        .map_err(|error| PiAgentError::Persistence(error.to_string()))?;
                }
            }
        }
        let repo_path = config.repo_path.clone();
        let session_dir = config.session_dir.clone();
        let session_path = config.session_path.clone();
        let hub = Arc::new(InteractionHub::new(Arc::clone(&self.interactions)));
        let handle = create_agent_session(sdk_options_with_factory(config, &hub))
            .await
            .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
        let state = handle
            .state()
            .await
            .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
        let session_id = state
            .session_id
            .ok_or_else(|| PiAgentError::Sdk("Pi session did not return an id".to_string()))?;
        let summary = PiSessionSummary {
            session_id: session_id.clone(),
            repo_path: repo_path.clone(),
            provider: state.provider,
            model: state.model_id,
            message_count: state.message_count,
            updated_at_ms: now_ms(),
            title: None,
        };
        let managed = Arc::new(ManagedSession {
            repo_path,
            handle: AsyncMutex::new(handle),
            hub,
        });
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?;
        if sessions.contains_key(&session_id) {
            return Err(PiAgentError::SessionAlreadyExists(session_id));
        }
        sessions.insert(session_id, managed);
        drop(sessions);

        if let Some(session_path) = session_path {
            let record = PersistedSessionRecord {
                schema_version: 1,
                session_id: summary.session_id.clone(),
                repo_path: summary.repo_path.clone(),
                session_dir,
                session_path,
                provider: summary.provider.clone(),
                model: summary.model.clone(),
                no_session: false,
                updated_at_ms: now_ms(),
                title: None,
            };
            self.records
                .lock()
                .map_err(|error| PiAgentError::State(error.to_string()))?
                .insert(summary.session_id.clone(), record);
            self.persist_catalog()?;
        }
        Ok(summary)
    }

    pub async fn session_summary(
        &self,
        session_id: &str,
    ) -> Result<PiSessionSummary, PiAgentError> {
        let session = self.get_session(session_id).await?;
        let handle = session.handle.lock().await;
        let state = handle
            .state()
            .await
            .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
        Ok(PiSessionSummary {
            session_id: state
                .session_id
                .ok_or_else(|| PiAgentError::Sdk("Pi session did not return an id".to_string()))?,
            repo_path: session.repo_path.clone(),
            provider: state.provider,
            model: state.model_id,
            message_count: state.message_count,
            updated_at_ms: self.record_updated_at_ms(session_id),
            title: self.record_title(session_id),
        })
    }

    pub async fn list_sessions(&self) -> Result<Vec<PiSessionSummary>, PiAgentError> {
        let record_ids: Vec<String> = self
            .records
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .keys()
            .cloned()
            .collect();
        for session_id in record_ids {
            let _ = self.get_session(&session_id).await;
        }
        let sessions: Vec<_> = self
            .sessions
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .values()
            .cloned()
            .collect();
        let mut summaries = Vec::with_capacity(sessions.len());
        let mut titles_to_cache: Vec<(String, String)> = Vec::new();
        for session in sessions {
            let handle = session.handle.lock().await;
            let state = handle
                .state()
                .await
                .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
            let session_id = state
                .session_id
                .ok_or_else(|| PiAgentError::Sdk("Pi session did not return an id".to_string()))?;
            // 标题派生：pi SessionHeader 无标题字段，取首条用户消息摘要。
            // 派生结果缓存进 record（标题不会变），避免每次列表都全量解析消息。
            let cached_title = self.record_title(&session_id);
            let title = match cached_title {
                Some(title) => Some(title),
                None => {
                    let derived = handle
                        .messages()
                        .await
                        .ok()
                        .and_then(|messages| derive_session_title(&messages));
                    if let Some(title) = &derived {
                        titles_to_cache.push((session_id.clone(), title.clone()));
                    }
                    derived
                }
            };
            summaries.push(PiSessionSummary {
                session_id: session_id.clone(),
                repo_path: session.repo_path.clone(),
                provider: state.provider,
                model: state.model_id,
                message_count: state.message_count,
                updated_at_ms: self.record_updated_at_ms(&session_id),
                title,
            });
        }
        if !titles_to_cache.is_empty() {
            if let Ok(mut records) = self.records.lock() {
                for (session_id, title) in titles_to_cache {
                    if let Some(record) = records.get_mut(&session_id) {
                        record.title = Some(title);
                    }
                }
            }
            let _ = self.persist_catalog();
        }
        summaries.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        Ok(summaries)
    }

    pub async fn messages(&self, session_id: &str) -> Result<Vec<AgentMessage>, PiAgentError> {
        let session = self.get_session(session_id).await?;
        let handle = session.handle.lock().await;
        let messages = handle
            .messages()
            .await
            .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
        Ok(messages.into_iter().map(AgentMessage::from_pi).collect())
    }

    pub async fn prompt(
        &self,
        session_id: &str,
        run_id: &str,
        prompt: impl Into<String>,
        images: Vec<super::AgentPromptImage>,
        sink: AgentEventSink,
    ) -> Result<AgentMessage, PiAgentError> {
        let session = self.get_session(session_id).await?;
        let (abort_handle, abort_signal) = AgentSessionHandle::new_abort_handle();
        self.register_run(run_id, session_id, abort_handle)?;
        let abort_signal_for_prompt = abort_signal.clone();
        let prompt = prompt.into();

        let translator = Arc::new(PiEventTranslator::new(
            session.repo_path.to_string_lossy(),
            session_id,
            run_id,
        ));
        // 绑定 run 上下文：审批/提问事件与 pi 事件共用 sequence，双通道下发。
        session.hub.start_run(InteractionRunContext {
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            translator: Arc::clone(&translator),
            sink: Arc::clone(&sink),
            subscribers: Arc::clone(&self.subscribers),
        });
        let event_translator = Arc::clone(&translator);
        let event_sink = Arc::clone(&sink);
        let subscribers = Arc::clone(&self.subscribers);
        let on_event = move |event| {
            if let Some(event) = event_translator.translate(event) {
                // The service-owned bus is used by Control SSE; the
                // caller sink is used by Desktop Tauri/CLI adapters.
                // Both receive the same provider-neutral envelope.
                publish_event(&subscribers, &event);
                event_sink(event);
            }
        };
        // 与 Pi RPC prompt(images) 对齐：有图时走 multimodal content blocks。
        // 图片优先从 path 读盘，避免前端把大 base64 塞进 IPC。
        let resolved_images = match resolve_prompt_images(&images) {
            Ok(items) => items,
            Err(error) => {
                self.remove_run(run_id);
                session.hub.end_run(run_id);
                return Err(error);
            }
        };
        let content_blocks = if resolved_images.is_empty() {
            None
        } else {
            let mut blocks = Vec::new();
            if !prompt.trim().is_empty() {
                blocks.push(pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                    prompt.clone(),
                )));
            }
            for image in resolved_images {
                blocks.push(pi::sdk::ContentBlock::Image(image));
            }
            Some(blocks)
        };
        let result = {
            let mut handle = session.handle.lock().await;
            match content_blocks {
                None => {
                    handle
                        .prompt_with_abort(prompt, abort_signal_for_prompt, on_event)
                        .await
                }
                Some(blocks) => {
                    handle
                        .session_mut()
                        .run_with_content_with_abort(blocks, Some(abort_signal_for_prompt), on_event)
                        .await
                }
            }
        };
        let status = match &result {
            Ok(_) => AgentSessionStatus::Idle,
            Err(_) if abort_signal.is_aborted() => AgentSessionStatus::Aborted,
            Err(_) => AgentSessionStatus::Failed,
        };
        let error = result.as_ref().err().map(ToString::to_string);
        self.remove_run(run_id);
        session.hub.end_run(run_id);
        // run 结束（无论成败）释放残留 pending，工具 future 不得悬挂。
        self.interactions.reject_run(session_id, run_id, "aborted");
        if let Some(mut event) = translator.translate(pi::sdk::AgentEvent::AgentStart {
            session_id: session_id.into(),
        }) {
            event.event = AgentEvent::SessionStatusChanged { status, error };
            publish_event(&self.subscribers, &event);
            (sink)(event);
        }

        result
            .map(|message| AgentMessage::from_pi_assistant(message, Some(run_id.to_string())))
            .map_err(|error| PiAgentError::Sdk(error.to_string()))
    }

    #[must_use]
    pub fn abort(&self, run_id: &str) -> bool {
        let Ok(runs) = self.active_runs.lock() else {
            return false;
        };
        let Some(run) = runs.get(run_id) else {
            return false;
        };
        run.abort_handle.abort();
        let session_id = run.session_id.clone();
        drop(runs);
        // abort 立即释放该 run 的 pending 交互，等待中的工具按拒绝收尾。
        self.interactions.reject_run(&session_id, run_id, "aborted");
        true
    }

    pub fn delete_session(&self, session_id: &str) -> Result<bool, PiAgentError> {
        let runs = self
            .active_runs
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?;
        if runs.values().any(|run| run.session_id == session_id) {
            return Err(PiAgentError::SessionBusy(session_id.to_string()));
        }
        drop(runs);
        let record = self
            .records
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .remove(session_id);
        let removed = self
            .sessions
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .remove(session_id)
            .is_some()
            || record.is_some();
        if let Some(record) = record {
            remove_session_files(&record.session_path);
            self.persist_catalog()?;
        }
        self.interactions.reject_session(session_id, "aborted");
        Ok(removed)
    }

    /// 当前待裁决的交互列表（可按 session 过滤）。
    #[must_use]
    pub fn list_interactions(&self, session_id: Option<&str>) -> Vec<AgentInteraction> {
        self.interactions.list_pending(session_id)
    }

    /// 回复交互：permission 用 once/always/reject，question 用 answers/cancel。
    /// 首个有效回复胜出；重复/过期回复与种类不匹配均报错。
    pub fn reply_interaction(
        &self,
        interaction_id: &str,
        reply: AgentInteractionReply,
    ) -> Result<(), PiAgentError> {
        self.interactions
            .reply(interaction_id, reply)
            .map_err(PiAgentError::Interaction)
    }

    /// 显式开启/关闭 session 级自动接受（默认关；审计事件照常发布）。
    pub async fn set_auto_approve(
        &self,
        session_id: &str,
        enabled: bool,
    ) -> Result<(), PiAgentError> {
        let session = self.get_session(session_id).await?;
        session.hub.set_auto_approve(enabled);
        Ok(())
    }

    /// provider/model catalog 查询（每次从 vault 重建，凭据变更即时生效）。
    pub fn provider_catalog(&self) -> Result<ProviderCatalog, PiAgentError> {
        Ok(ProviderCatalog::new(self.secret_store()?))
    }

    pub fn list_providers(&self) -> Result<Vec<AgentProviderInfo>, PiAgentError> {
        self.provider_catalog()?.list_providers()
    }

    pub fn list_models(&self) -> Result<Vec<AgentModelInfo>, PiAgentError> {
        self.provider_catalog()?.list_models()
    }

    pub fn find_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<AgentModelInfo>, PiAgentError> {
        self.provider_catalog()?.find_model(provider, model_id)
    }

    /// 保存 provider 的 api key 到统一 vault（0600，原子写）。
    pub fn save_api_key(&self, provider: &str, key: &str) -> Result<(), PiAgentError> {
        self.secret_store()?.set_api_key(provider, key)
    }

    /// 保存/更新自定义 provider（models.json），api key 只进 vault。
    pub fn save_custom_provider(&self, input: &CustomProviderInput) -> Result<(), PiAgentError> {
        self.provider_catalog()?.save_custom_provider(input)
    }

    /// 用 provider 实时 `/v1/models` 刷新目录，返回新合并进目录的模型 id。
    pub fn refresh_provider_models(&self, provider: &str) -> Result<Vec<String>, PiAgentError> {
        self.provider_catalog()?.refresh_live_models(provider)
    }

    pub fn remove_api_key(&self, provider: &str) -> Result<bool, PiAgentError> {
        self.secret_store()?.remove(provider)
    }

    /// 是否已配置凭据（任意来源），不暴露凭据内容。
    pub fn has_credential(&self, provider: &str) -> bool {
        self.provider_catalog()
            .map(|catalog| catalog.has_credential(provider))
            .unwrap_or(false)
    }

    /// 切换 session 的 provider/model。运行中的 session 拒绝切换。
    /// 成功后同步更新持久化 catalog 中的 provider/model 记录。
    pub async fn set_model(
        &self,
        session_id: &str,
        provider: &str,
        model_id: &str,
    ) -> Result<PiSessionSummary, PiAgentError> {
        self.ensure_not_running(session_id)?;
        let session = self.get_session(session_id).await?;
        let state = {
            let mut handle = session.handle.lock().await;
            handle
                .set_model(provider, model_id)
                .await
                .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
            handle
                .state()
                .await
                .map_err(|error| PiAgentError::Sdk(error.to_string()))?
        };
        if let Ok(mut records) = self.records.lock() {
            if let Some(record) = records.get_mut(session_id) {
                record.provider = state.provider.clone();
                record.model = state.model_id.clone();
                record.updated_at_ms = now_ms();
            }
        }
        let _ = self.persist_catalog();
        Ok(PiSessionSummary {
            session_id: state.session_id.unwrap_or_else(|| session_id.to_string()),
            repo_path: session.repo_path.clone(),
            provider: state.provider,
            model: state.model_id,
            message_count: state.message_count,
            updated_at_ms: self.record_updated_at_ms(session_id),
            title: self.record_title(session_id),
        })
    }

    /// 设置 session 的 thinking level（off/minimal/low/medium/high/xhigh）。
    pub async fn set_thinking_level(
        &self,
        session_id: &str,
        level: &str,
    ) -> Result<(), PiAgentError> {
        self.ensure_not_running(session_id)?;
        let level: pi::sdk::ThinkingLevel = level.parse().map_err(PiAgentError::Sdk)?;
        let session = self.get_session(session_id).await?;
        let mut handle = session.handle.lock().await;
        handle
            .set_thinking_level(level)
            .await
            .map_err(|error| PiAgentError::Sdk(error.to_string()))
    }

    /// 显式 api_key 优先；否则从 vault 按 provider 解析注入（短生命周期值，
    /// 不落盘到 session record/catalog）。
    fn with_secret_fallback(
        &self,
        mut config: PiSessionConfig,
    ) -> Result<PiSessionConfig, PiAgentError> {
        if config.api_key.is_none() {
            if let (Some(secrets), Some(provider)) = (&self.secrets, config.provider.clone()) {
                config.api_key = secrets.api_key(&provider)?;
            }
        }
        Ok(config)
    }

    fn ensure_not_running(&self, session_id: &str) -> Result<(), PiAgentError> {
        let running = self
            .active_runs
            .lock()
            .map(|runs| runs.values().any(|run| run.session_id == session_id))
            .unwrap_or(false);
        if running {
            return Err(PiAgentError::SessionBusy(session_id.to_string()));
        }
        Ok(())
    }

    fn secret_store(&self) -> Result<SecretStore, PiAgentError> {
        self.secrets
            .clone()
            .or_else(|| SecretStore::default_path().map(SecretStore::new))
            .ok_or_else(|| PiAgentError::Secret("secret vault path is unavailable".to_string()))
    }

    /// 持久化 record 中的最近活动时间；无 record（临时 session）时回退当前时间。
    fn record_updated_at_ms(&self, session_id: &str) -> u64 {
        self.records
            .lock()
            .ok()
            .and_then(|records| records.get(session_id).map(|record| record.updated_at_ms))
            .unwrap_or_else(now_ms)
    }

    fn record_title(&self, session_id: &str) -> Option<String> {
        self.records.lock().ok().and_then(|records| {
            records
                .get(session_id)
                .and_then(|record| record.title.clone())
                .filter(|title| !title.trim().is_empty())
        })
    }

    async fn get_session(&self, session_id: &str) -> Result<Arc<ManagedSession>, PiAgentError> {
        if let Some(session) = self
            .sessions
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .get(session_id)
            .cloned()
        {
            return Ok(session);
        }

        let record = self
            .records
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .get(session_id)
            .cloned()
            .ok_or_else(|| PiAgentError::SessionNotFound(session_id.to_string()))?;
        if record.schema_version != 1 {
            return Err(PiAgentError::Sdk(format!(
                "unsupported persisted session schema: {}",
                record.schema_version
            )));
        }
        let config = PiSessionConfig {
            repo_path: record.repo_path.clone(),
            session_dir: record.session_dir.clone(),
            session_path: Some(record.session_path.clone()),
            provider: (!record.provider.is_empty()).then_some(record.provider),
            model: (!record.model.is_empty()).then_some(record.model),
            api_key: None,
            system_prompt: None,
            append_system_prompt: None,
            enabled_tools: None,
            extension_paths: Vec::new(),
            no_session: record.no_session,
            thinking: None,
            // 恢复路径不持久化该配置：None = 不限制，与默认语义一致。
            max_tool_iterations: None,
        };
        // 恢复 session 时凭据不落盘到 record，统一从 vault 现取注入。
        let config = self.with_secret_fallback(config)?;
        let hub = Arc::new(InteractionHub::new(Arc::clone(&self.interactions)));
        let handle = create_agent_session(sdk_options_with_factory(config, &hub))
            .await
            .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
        let state = handle
            .state()
            .await
            .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
        let actual_id = state
            .session_id
            .ok_or_else(|| PiAgentError::Sdk("Pi session did not return an id".to_string()))?;
        if actual_id != session_id {
            return Err(PiAgentError::Sdk(format!(
                "persisted session id mismatch: expected {session_id}, got {actual_id}"
            )));
        }
        let managed = Arc::new(ManagedSession {
            repo_path: record.repo_path,
            handle: AsyncMutex::new(handle),
            hub,
        });
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?;
        Ok(sessions
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::clone(&managed))
            .clone())
    }

    fn persist_catalog(&self) -> Result<(), PiAgentError> {
        let Some(path) = self.catalog_path.as_ref() else {
            return Ok(());
        };
        let records = self
            .records
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?;
        let mut values: Vec<_> = records.values().cloned().collect();
        values.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        let payload = serde_json::to_vec_pretty(&values)
            .map_err(|error| PiAgentError::Persistence(error.to_string()))?;
        let parent = path.parent().ok_or_else(|| {
            PiAgentError::Persistence("session catalog has no parent directory".to_string())
        })?;
        fs::create_dir_all(parent)
            .map_err(|error| PiAgentError::Persistence(error.to_string()))?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, payload).map_err(|error| PiAgentError::Persistence(error.to_string()))?;
        fs::rename(&tmp, path).map_err(|error| PiAgentError::Persistence(error.to_string()))?;
        Ok(())
    }

    fn register_run(
        &self,
        run_id: &str,
        session_id: &str,
        abort_handle: AbortHandle,
    ) -> Result<(), PiAgentError> {
        let mut runs = self
            .active_runs
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?;
        if runs.contains_key(run_id) {
            return Err(PiAgentError::RunAlreadyExists(run_id.to_string()));
        }
        if runs.values().any(|run| run.session_id == session_id) {
            return Err(PiAgentError::SessionBusy(session_id.to_string()));
        }
        runs.insert(
            run_id.to_string(),
            ActiveRun {
                session_id: session_id.to_string(),
                abort_handle,
            },
        );
        Ok(())
    }

    fn remove_run(&self, run_id: &str) {
        if let Ok(mut runs) = self.active_runs.lock() {
            runs.remove(run_id);
        }
    }
}

fn publish_event(
    subscribers: &Arc<Mutex<HashMap<EventSubscriberKey, Vec<Sender<AgentEventEnvelope>>>>>,
    event: &AgentEventEnvelope,
) {
    super::events::publish_event(subscribers, event);
}

fn resolve_prompt_images(
    images: &[super::AgentPromptImage],
) -> Result<Vec<pi::sdk::ImageContent>, PiAgentError> {
    use base64::Engine;

    let mut out = Vec::with_capacity(images.len());
    for image in images {
        let mut mime = image.mime_type.trim().to_string();
        let inline = image.data.trim();
        if !inline.is_empty() {
            if mime.is_empty() {
                mime = "image/png".to_string();
            }
            out.push(pi::sdk::ImageContent {
                data: inline.to_string(),
                mime_type: mime,
            });
            continue;
        }
        let path = image.path.trim();
        if path.is_empty() {
            continue;
        }
        let bytes = fs::read(path).map_err(|error| {
            PiAgentError::Sdk(format!("failed to read prompt image {path}: {error}"))
        })?;
        if bytes.is_empty() {
            return Err(PiAgentError::Sdk(format!("prompt image is empty: {path}")));
        }
        if mime.is_empty() {
            mime = mime_from_image_path(path);
        }
        out.push(pi::sdk::ImageContent {
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
            mime_type: mime,
        });
    }
    Ok(out)
}

fn mime_from_image_path(path: &str) -> String {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    }
    .to_string()
}

/// 装配带审批门禁的 SessionOptions：GiteamToolFactory 包装写/执行类工具，
/// 并按 enabled_tools 决定是否追加 question 工具。
fn sdk_options_with_factory(
    config: PiSessionConfig,
    hub: &Arc<InteractionHub>,
) -> pi::sdk::SessionOptions {
    let factory = GiteamToolFactory::new(Arc::clone(hub), config.enabled_tools.as_deref());
    let mut options = config.into_sdk_options();
    options.tool_factory = Some(Arc::new(factory));
    options
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
}

fn next_session_path(session_dir: &PathBuf) -> PathBuf {
    static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);
    let sequence = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
    session_dir.join(format!("session-{}-{sequence}.jsonl", now_ms()))
}

/// 从 pi 原生消息列表派生会话标题：首条用户消息的首段文本，
/// 压缩空白后截断。pi 本身不存标题，这是列表展示的唯一来源。
fn derive_session_title(messages: &[pi::sdk::Message]) -> Option<String> {
    const TITLE_MAX_CHARS: usize = 60;
    for message in messages {
        let pi::sdk::Message::User(user) = message else {
            continue;
        };
        let text = match &user.content {
            pi::sdk::UserContent::Text(text) => text.clone(),
            pi::sdk::UserContent::Blocks(blocks) => blocks
                .iter()
                .find_map(|block| match block {
                    pi::sdk::ContentBlock::Text(text) => Some(text.text.clone()),
                    _ => None,
                })
                .unwrap_or_default(),
        };
        let collapsed: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() {
            continue;
        }
        let truncated: String = collapsed.chars().take(TITLE_MAX_CHARS).collect();
        return Some(if collapsed.chars().count() > TITLE_MAX_CHARS {
            format!("{truncated}…")
        } else {
            truncated
        });
    }
    None
}

#[cfg(test)]
mod title_tests {
    use super::derive_session_title;

    #[test]
    fn title_comes_from_first_user_text() {
        let messages = vec![pi::sdk::Message::User(pi::sdk::UserMessage {
            content: pi::sdk::UserContent::Text("  帮我\n审查一下   最近的改动 ".to_string()),
            timestamp: 1,
        })];
        assert_eq!(
            derive_session_title(&messages).as_deref(),
            Some("帮我 审查一下 最近的改动")
        );
    }

    #[test]
    fn title_skips_non_user_and_empty_messages() {
        let messages = vec![pi::sdk::Message::User(pi::sdk::UserMessage {
            content: pi::sdk::UserContent::Text("   ".to_string()),
            timestamp: 1,
        })];
        assert_eq!(derive_session_title(&messages), None);
        assert_eq!(derive_session_title(&[]), None);
    }
}

fn global_catalog_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let home = PathBuf::from(home);
    #[cfg(target_os = "windows")]
    {
        let root = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        return Some(root.join("giteam").join("pi-sessions").join("catalog.json"));
    }
    #[cfg(target_os = "macos")]
    {
        return Some(
            home.join("Library")
                .join("Application Support")
                .join("giteam")
                .join("pi-sessions")
                .join("catalog.json"),
        );
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let root = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"));
        Some(root.join("giteam").join("pi-sessions").join("catalog.json"))
    }
}

fn load_catalog_records(path: Option<&PathBuf>) -> HashMap<String, PersistedSessionRecord> {
    let Some(path) = path else {
        return HashMap::new();
    };
    let Ok(bytes) = fs::read(path) else {
        return HashMap::new();
    };
    let Ok(records) = serde_json::from_slice::<Vec<PersistedSessionRecord>>(&bytes) else {
        return HashMap::new();
    };
    records
        .into_iter()
        .filter(|record| !record.session_id.trim().is_empty())
        .map(|record| (record.session_id.clone(), record))
        .collect()
}

fn remove_session_files(path: &PathBuf) {
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(path.with_extension("jsonl.bak"));
    let _ = fs::remove_file(path.with_extension("jsonl-wal"));
    let _ = fs::remove_file(path.with_extension("jsonl-shm"));
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::pi_agent::{AgentEvent, AGENT_EVENT_SCHEMA_VERSION};

    #[test]
    fn event_bus_delivers_only_matching_session_and_run() {
        let service = PiAgentService::new();
        let receiver = service.subscribe_events("session-1", "run-1");
        let event = AgentEventEnvelope {
            schema_version: AGENT_EVENT_SCHEMA_VERSION,
            event_id: "event-1".to_string(),
            sequence: 1,
            repo_path: "/tmp/repo".to_string(),
            session_id: "session-1".to_string(),
            run_id: Some("run-1".to_string()),
            timestamp_ms: 1,
            event: AgentEvent::RuntimeWarning {
                message: "test".to_string(),
            },
        };

        publish_event(&service.subscribers, &event);

        assert_eq!(
            receiver
                .recv_timeout(Duration::from_millis(50))
                .expect("matching subscriber should receive event"),
            event
        );
    }

    #[test]
    fn shutdown_is_idempotent_and_clears_service_state() {
        let service = PiAgentService::new();
        let _receiver = service.subscribe_events("session-1", "run-1");

        service.shutdown();
        service.shutdown();

        assert_eq!(service.session_count(), 0);
        assert_eq!(service.active_run_count(), 0);
        assert!(!service.abort("run-1"));
    }

    #[test]
    fn persisted_catalog_round_trips_without_secrets() {
        let path = std::env::temp_dir().join(format!(
            "giteam-pi-catalog-test-{}-{}.json",
            std::process::id(),
            now_ms()
        ));
        let record = PersistedSessionRecord {
            schema_version: 1,
            session_id: "session-1".to_string(),
            repo_path: PathBuf::from("/tmp/repo"),
            session_dir: PathBuf::from("/tmp/repo/.giteam/pi-sessions"),
            session_path: PathBuf::from("/tmp/repo/.giteam/pi-sessions/session-1.jsonl"),
            provider: "openai".to_string(),
            model: "gpt-5".to_string(),
            no_session: false,
            updated_at_ms: now_ms(),
            title: None,
        };
        fs::write(&path, serde_json::to_vec(&vec![record]).expect("serialize catalog"))
            .expect("write catalog");

        let loaded = load_catalog_records(Some(&path));
        let loaded = loaded.get("session-1").expect("catalog record should load");
        assert_eq!(loaded.repo_path, PathBuf::from("/tmp/repo"));
        assert!(!serde_json::to_string(loaded)
            .expect("serialize loaded record")
            .contains("api_key"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn session_summary_uses_stable_camel_case_contract() {
        let summary = PiSessionSummary {
            session_id: "session-1".to_string(),
            repo_path: PathBuf::from("/tmp/repo"),
            provider: "openai".to_string(),
            model: "gpt-5".to_string(),
            message_count: 2,
            updated_at_ms: 1_700_000_000_000,
            title: Some("审查改动".to_string()),
        };
        let value = serde_json::to_value(summary).expect("serialize summary");
        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["repoPath"], "/tmp/repo");
        assert_eq!(value["messageCount"], 2);
        assert_eq!(value["updatedAtMs"], 1_700_000_000_000_u64);
        assert_eq!(value["title"], "审查改动");
        assert!(value.get("session_id").is_none());
    }

    /// 回归：pi 的 Session::open 要求 session_path 已存在，新会话必须先写入
    /// header 行，否则 create_session 报 SessionNotFound（桌面端"发不出消息"的根因）。
    #[test]
    fn create_session_pre_creates_header_for_new_persistent_session() {
        let root = std::env::temp_dir().join(format!(
            "giteam-pi-create-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let repo = root.join("repo");
        let session_dir = root.join("sessions");
        fs::create_dir_all(&repo).expect("create repo dir");

        let service = PiAgentService::new();
        let mut config = PiSessionConfig::persistent(&repo, &session_dir);
        config.provider = Some("openai".to_string());
        config.model = Some("gpt-4o".to_string());
        config.api_key = Some("dummy-key".to_string());

        let summary =
            futures::executor::block_on(service.create_session(config)).expect("create session");
        assert!(!summary.session_id.is_empty());

        let files: Vec<_> = fs::read_dir(&session_dir)
            .expect("session dir should exist")
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
            .collect();
        assert_eq!(files.len(), 1, "exactly one session file should be created");
        let content = fs::read_to_string(&files[0]).expect("read session file");
        let header: serde_json::Value =
            serde_json::from_str(content.lines().next().expect("header line")).expect("parse header");
        assert_eq!(header["type"], "session");
        assert_eq!(header["cwd"], repo.display().to_string());

        service.shutdown();
        let _ = fs::remove_dir_all(&root);
    }
}

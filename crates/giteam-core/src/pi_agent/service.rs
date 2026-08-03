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
use super::provider_sanitizer::{
    ensure_tool_call_id_sanitizer, shorten_tool_call_id, OPENAI_TOOL_CALL_ID_MAX_LEN,
};
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
    /// 已安装的 tool call id 清洗包装（见 provider_sanitizer）。pi 切换模型会
    /// 重建 provider 丢弃包装，prompt 前按指针比对重装。
    sanitized_provider: Mutex<Option<Arc<dyn pi::sdk::Provider>>>,
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
            // 仓库 .giteam 下写入 ignore，避免会话/附件被用户误提交。
            if let Some(repo_root) = config.session_dir.parent().and_then(|p| p.parent()) {
                super::ensure_workspace_giteam_gitignore(repo_root);
            } else {
                super::ensure_workspace_giteam_gitignore(&config.repo_path);
            }
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
            sanitized_provider: Mutex::new(None),
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
        // 重试期间抑制 AgentEnd 映射出的 run.completed/failed，避免前端提前 finalize；
        // 循环结束后再发最终终态事件。
        let accept_terminal = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let accept_terminal_for_events = Arc::clone(&accept_terminal);
        let on_event = Arc::new(move |event: pi::sdk::AgentEvent| {
            if let Some(event) = event_translator.translate(event) {
                if !accept_terminal_for_events.load(Ordering::Relaxed) {
                    match &event.event {
                        AgentEvent::RunCompleted | AgentEvent::RunFailed { .. } => return,
                        AgentEvent::SessionStatusChanged {
                            status: AgentSessionStatus::Idle
                                | AgentSessionStatus::Failed
                                | AgentSessionStatus::Aborted,
                            ..
                        } => return,
                        _ => {}
                    }
                }
                publish_event(&subscribers, &event);
                event_sink(event);
            }
        });
        let emit_pi = |event: pi::sdk::AgentEvent| {
            on_event(event);
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
        // 模型能力分流（对齐 opencode：直传图片、不做文本降级）。
        // - 支持图片（input 含 Image）→ multimodal 直传 ContentBlock::Image；
        // - 纯文本模型（如 glm-5.2/deepseek）→ 不发 image block（否则 provider HTTP 400），
        //   让模型基于用户文字正常回复。绝不把图片降级成文本，也绝不向前端抛错。
        let supports_images = self.session_supports_images(session_id).unwrap_or(true);
        let resolved_image_count = resolved_images.len();
        let prompt_images: Vec<_> = if supports_images {
            resolved_images
        } else {
            Vec::new()
        };
        let dropped_image_count = resolved_image_count.saturating_sub(prompt_images.len());
        let content_blocks = if prompt_images.is_empty() {
            None
        } else {
            let mut blocks = Vec::new();
            if !prompt.trim().is_empty() {
                blocks.push(pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(
                    prompt.clone(),
                )));
            }
            for image in prompt_images {
                blocks.push(pi::sdk::ContentBlock::Image(image));
            }
            Some(blocks)
        };
        // 纯文本模型收不到图片（text-only API 在请求层拒收 image，是不可绕过的硬限制），
        // 但必须如实告知用户"看不到图"，而不是假装没收到、跑去干别的（如探索目录答非所问）。
        // 注意：这不是"文本降级"——绝不描述/猜测图片内容，只声明看不到，由模型转达并建议切换视觉模型。
        let effective_prompt = if dropped_image_count > 0 {
            let notice = format!(
                "（系统提示：用户本次还发送了 {dropped_image_count} 张图片，但当前模型不支持图像输入，你无法看到这些图片的内容。请在回复中如实告知用户你看不到图片，并建议切换到支持视觉的模型后重试；不要假装看到了图片，也不要忽略这条提示去自行猜测图片内容或做其它事情。）"
            );
            if prompt.trim().is_empty() {
                notice
            } else {
                format!("{prompt}\n\n{notice}")
            }
        } else {
            prompt.clone()
        };

        // 对齐 Pi RPC `run_prompt_with_retry`：可重试错误不终止任务，自动 resume；
        // 默认最多 10 次（settings.json retry.maxRetries，由 ensure_pi_retry_settings 写入）。
        let retry_config = pi::config::Config::load().unwrap_or_else(|_| pi::config::Config {
            retry: Some(pi::config::RetrySettings {
                enabled: Some(true),
                max_retries: Some(10),
                base_delay_ms: None,
                max_delay_ms: None,
            }),
            ..Default::default()
        });
        let retry_enabled = retry_config.retry_enabled();
        let max_retries = retry_config.retry_max_retries().max(1);
        let mut retry_count: u32 = 0;
        let mut final_error: Option<String> = None;

        let result: Result<pi::sdk::AssistantMessage, pi::error::Error> = {
            let mut handle = session.handle.lock().await;
            // 根修：给 provider 套上流事件清洗包装（见 provider_sanitizer 模块文档）。
            // indemind 等兼容网关逐 chunk 重复下发完整 tool_calls[].id，pi 端 push_str
            // 累加出超长 id（实测 1479）污染消息历史，下一轮回放 HTTP 400（call_id ≤ 64）。
            // 在事件层收敛 id，污染根本进不了历史，同一次 run 内不再 400。
            ensure_tool_call_id_sanitizer(
                &mut handle.session_mut().agent,
                &session.sanitized_provider,
            );
            // 发送前清洗历史里的“空文本块”：pi 的 anthropic-messages convert 不过滤空 text
            // （pi src/providers/anthropic.rs convert_content_block_to_anthropic），流式占位/截断
            // 会留下 TextContent{text:""} 并落地进历史，下一轮原样发给 provider。
            // kimi-coding 等严格端点据此返回 HTTP 400 “text content is empty”。
            // pi 仓库只读无法改其 convert，这里用 pi 公开的 messages/replace_messages 在发送前剔除。
            loop {
                // 每次尝试前都清洗：同一次 prompt 的 tool loop 里，兼容网关可能在每个
                // stream chunk 重复下发完整 tool_calls[].id，pi openai 适配器用 push_str
                // 累加后 id 可达数百/上千字符；下一轮回放会 HTTP 400（call_id ≤ 64）。
                // 仅在进入 prompt 前清洗一次拦不住「本轮流式刚写出的超长 id」。
                strip_empty_text_blocks(&mut handle.session_mut().agent);
                sanitize_oversized_tool_call_ids(&mut handle.session_mut().agent);

                let on_event_cb = {
                    let cb = Arc::clone(&on_event);
                    move |event| cb(event)
                };
                let attempt_result = if retry_count == 0 {
                    match &content_blocks {
                        None => {
                            handle
                                .prompt_with_abort(
                                    effective_prompt.clone(),
                                    abort_signal_for_prompt.clone(),
                                    on_event_cb,
                                )
                                .await
                        }
                        Some(blocks) => {
                            handle
                                .session_mut()
                                .run_with_content_with_abort(
                                    blocks.clone(),
                                    Some(abort_signal_for_prompt.clone()),
                                    on_event_cb,
                                )
                                .await
                        }
                    }
                } else {
                    handle
                        .continue_turn_with_abort(abort_signal_for_prompt.clone(), on_event_cb)
                        .await
                };

                if abort_signal.is_aborted() {
                    final_error = Some(
                        attempt_result
                            .as_ref()
                            .err()
                            .map(ToString::to_string)
                            .unwrap_or_else(|| "Retry aborted".to_string()),
                    );
                    break Err(attempt_result.err().unwrap_or_else(|| {
                        pi::error::Error::session("aborted".to_string())
                    }));
                }

                let should_retry = match &attempt_result {
                    Ok(message)
                        if matches!(
                            message.stop_reason,
                            pi::sdk::StopReason::Error
                        ) =>
                    {
                        let err_msg = message
                            .error_message
                            .clone()
                            .unwrap_or_else(|| "Request error".to_string());
                        final_error = Some(err_msg.clone());
                        retry_enabled
                            && retry_count < max_retries
                            && (pi::error::is_retryable_error(
                                &err_msg,
                                Some(message.usage.input),
                                None,
                            ) || is_tool_call_id_overflow_error(&err_msg))
                    }
                    Ok(message)
                        if matches!(message.stop_reason, pi::sdk::StopReason::Aborted) =>
                    {
                        final_error = message
                            .error_message
                            .clone()
                            .or_else(|| Some("Aborted".to_string()));
                        false
                    }
                    Ok(_) => {
                        final_error = None;
                        false
                    }
                    Err(err) => {
                        let err_str = err.to_string();
                        final_error = Some(err_str.clone());
                        retry_enabled
                            && retry_count < max_retries
                            && (err.is_transient()
                                || pi::error::is_retryable_error(&err_str, None, None)
                                || is_tool_call_id_overflow_error(&err_str))
                    }
                };

                match attempt_result {
                    Ok(message) if !should_retry => {
                        if matches!(
                            message.stop_reason,
                            pi::sdk::StopReason::Error | pi::sdk::StopReason::Aborted
                        ) {
                            break Err(pi::error::Error::session(
                                final_error
                                    .clone()
                                    .unwrap_or_else(|| "Request error".to_string()),
                            ));
                        }
                        break Ok(message);
                    }
                    Err(err) if !should_retry => break Err(err),
                    Ok(_) | Err(_) => {}
                }

                retry_count += 1;
                let delay_ms = retry_delay_ms(&retry_config, retry_count);
                let error_message = final_error
                    .clone()
                    .unwrap_or_else(|| "Request error".to_string());
                emit_pi(pi::sdk::AgentEvent::AutoRetryStart {
                    attempt: retry_count,
                    max_attempts: max_retries,
                    delay_ms: u64::from(delay_ms),
                    error_message,
                });

                // block_on 路径下用短睡切片检查 abort，避免一次长 sleep 无法响应停止。
                let deadline =
                    std::time::Instant::now() + std::time::Duration::from_millis(u64::from(delay_ms));
                let mut cancelled = false;
                while std::time::Instant::now() < deadline {
                    if abort_signal.is_aborted() {
                        cancelled = true;
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                if cancelled {
                    emit_pi(pi::sdk::AgentEvent::AutoRetryEnd {
                        success: false,
                        attempt: retry_count,
                        final_error: Some("Retry aborted".to_string()),
                    });
                    break Err(pi::error::Error::session("Retry aborted".to_string()));
                }

                let _ = handle.session_mut().revert_incomplete_response().await;
            }
        };

        if retry_count > 0 {
            let success = result.is_ok();
            emit_pi(pi::sdk::AgentEvent::AutoRetryEnd {
                success,
                attempt: retry_count,
                final_error: if success {
                    None
                } else {
                    final_error.clone()
                },
            });
        }

        accept_terminal.store(true, Ordering::Relaxed);
        let status = match &result {
            Ok(_) => AgentSessionStatus::Idle,
            Err(_) if abort_signal.is_aborted() => AgentSessionStatus::Aborted,
            Err(_) => AgentSessionStatus::Failed,
        };
        let error = result.as_ref().err().map(ToString::to_string);
        // 发出最终终态（重试期间被抑制的 AgentEnd 替代品）。
        let terminal = match status {
            AgentSessionStatus::Idle => translator.translate(pi::sdk::AgentEvent::AgentEnd {
                session_id: session_id.into(),
                messages: Vec::new(),
                error: None,
            }),
            AgentSessionStatus::Failed | AgentSessionStatus::Aborted => {
                translator.translate(pi::sdk::AgentEvent::AgentEnd {
                    session_id: session_id.into(),
                    messages: Vec::new(),
                    error: error.clone(),
                })
            }
            _ => None,
        };
        if let Some(event) = terminal {
            publish_event(&self.subscribers, &event);
            (sink)(event);
        }
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

    /// 当前 session 绑定模型是否支持图片输入（pi 清单 `input` 含 `Image`）。
    /// 供 prompt 按能力分流：查不到（自定义/未持久化模型）时返回 None，保守按"支持"处理，
    /// 与历史行为一致，避免误拦截视觉模型。
    fn session_supports_images(&self, session_id: &str) -> Option<bool> {
        let (provider, model) = {
            let records = self.records.lock().ok()?;
            let record = records.get(session_id)?;
            (record.provider.clone(), record.model.clone())
        };
        self.find_model(&provider, &model)
            .ok()?
            .map(|info| info.image_input)
    }

    /// 保存 provider 的 api key 到统一 vault（0600，原子写）。
    pub fn save_api_key(&self, provider: &str, key: &str) -> Result<(), PiAgentError> {
        self.secret_store()?.set_api_key(provider, key)
    }

    /// 保存/更新自定义 provider（models.json），api key 只进 vault。
    pub fn save_custom_provider(&self, input: &CustomProviderInput) -> Result<(), PiAgentError> {
        self.provider_catalog()?.save_custom_provider(input)
    }

    /// 删除自定义供应商（models.json 整项 + vault 凭据）。
    pub fn remove_custom_provider(&self, provider: &str) -> Result<bool, PiAgentError> {
        self.provider_catalog()?.remove_custom_provider(provider)
    }

    /// 连接 OpenAI Completions 兼容自定义端点（拉模型 + 写 models.json + vault）。
    /// 返回 `(provider_id, model_ids)`。
    pub fn connect_openai_compatible(
        &self,
        base_url: &str,
        api_key: &str,
        name: &str,
        provider: Option<&str>,
    ) -> Result<(String, Vec<String>), PiAgentError> {
        self.provider_catalog()?
            .connect_openai_compatible(base_url, api_key, name, provider)
    }

    /// 更新已有 provider 的 baseUrl（及可选 api），保留 models 列表。
    pub fn update_provider_endpoint(
        &self,
        provider: &str,
        base_url: &str,
        api: Option<&str>,
    ) -> Result<(), PiAgentError> {
        self.provider_catalog()?
            .update_provider_endpoint(provider, base_url, api)
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
    ///
    /// 跨 provider 切换时，若该 session 有持久化 record，会丢弃内存 live handle
    /// 并重建：旧 handle 若曾被注入 session 级 `api_key_override`，会把上一把
    /// key 带到新 provider 上导致 401；重建后由 AuthStorage 按目标 provider
    /// 重新解析。
    pub async fn set_model(
        &self,
        session_id: &str,
        provider: &str,
        model_id: &str,
    ) -> Result<PiSessionSummary, PiAgentError> {
        self.ensure_not_running(session_id)?;
        let session = self.get_session(session_id).await?;
        let current_provider = {
            let mut handle = session.handle.lock().await;
            handle
                .state()
                .await
                .map_err(|error| PiAgentError::Sdk(error.to_string()))?
                .provider
        };
        let provider_changed = !current_provider.eq_ignore_ascii_case(provider);
        let has_persisted_record = self
            .records
            .lock()
            .ok()
            .is_some_and(|records| records.contains_key(session_id));

        let session = if provider_changed && has_persisted_record {
            drop(session);
            if let Ok(mut records) = self.records.lock() {
                if let Some(record) = records.get_mut(session_id) {
                    record.provider = provider.to_string();
                    record.model = model_id.to_string();
                    record.updated_at_ms = now_ms();
                }
            }
            let _ = self.persist_catalog();
            if let Ok(mut sessions) = self.sessions.lock() {
                sessions.remove(session_id);
            }
            self.get_session(session_id).await?
        } else {
            session
        };

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

    /// 规范化 session 凭据注入策略。
    ///
    /// **绝不能**把 vault 里某个 provider 的 key 写进 `SessionOptions.api_key`：
    /// Pi 会把它设成 session 级 `api_key_override`，之后切到任何其它
    /// provider/model 时仍优先用这把 key（见 pi `resolve_stream_api_key_for_model`），
    /// 表现为「只剩第一个配置的模型能用，其它全部 401」。
    ///
    /// 正确做法：`api_key` 保持 None，让 Pi 通过 `AuthStorage`（与 vault 同文件
    /// 的 auth.json）按 **当前** provider 解析。调用方显式传入的 `api_key`
    /// （测试/一次性覆盖）仍原样保留。
    fn with_secret_fallback(
        &self,
        config: PiSessionConfig,
    ) -> Result<PiSessionConfig, PiAgentError> {
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
            sanitized_provider: Mutex::new(None),
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

fn retry_delay_ms(config: &pi::config::Config, attempt: u32) -> u32 {
    let base = u64::from(config.retry_base_delay_ms());
    let max = u64::from(config.retry_max_delay_ms());
    let shift = attempt.saturating_sub(1);
    let multiplier = 1u64.checked_shl(shift).unwrap_or(u64::MAX);
    let delay = base.saturating_mul(multiplier).min(max);
    u32::try_from(delay).unwrap_or(u32::MAX)
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

/// 判断一个 content block 是否是“空文本块”（text 去除首尾空白后为空）。
fn is_empty_text_block(block: &pi::sdk::ContentBlock) -> bool {
    matches!(
        block,
        pi::sdk::ContentBlock::Text(text) if text.text.trim().is_empty()
    )
}

/// 发送请求前剔除会话历史里 assistant / toolResult 消息中的“空文本块”。
///
/// # 背景
/// pi 的 anthropic-messages convert（`pi src/providers/anthropic.rs` 的
/// `convert_content_block_to_anthropic`）对 `ContentBlock::Text` **不过滤空串**，
/// 空文本块会被原样序列化成 `{"type":"text","text":""}` 发给 provider。而 pi 在流式
/// 响应里会先种入空 `TextContent` 占位（`pi src/agent.rs` TextStart 处理 + `anthropic.rs`
/// content_block_start），一旦后续 TextDelta 未到达（max_tokens 截断 / 网络断流 / abort），
/// 这个空文本块就会随 assistant 消息落地进历史。下一轮 `build_context` 原样借用，
/// kimi-coding 等严格端点直接返回 `HTTP 400 “text content is empty”`。
///
/// pi 的 openai-completions convert 对空 text 有兜底（`openai.rs` 里 `if text.is_empty()`），
/// 但 anthropic 路径没有；pi 仓库只读，无法在其 convert 层补过滤。
///
/// # 做法
/// 用 pi 公开的 `Agent::messages` / `Agent::replace_messages`（`pi src/agent.rs`）在每次发送前
/// 清洗内存历史。对所有 anthropic-messages provider（kimi-coding / minimax 等）统一生效，
/// 不碰 tool_use / tool_result 配对，也不合并连续 user 消息（仅删空文本块，最小侵入）。
/// 快速路径：历史无空块时直接返回，避免无谓 clone + replace。
/// 消息是否含空文本块（仅 assistant / toolResult 的 content 会进入 anthropic 请求体）。
fn message_has_empty_text_block(message: &pi::sdk::Message) -> bool {
    match message {
        pi::sdk::Message::Assistant(assistant) => assistant.content.iter().any(is_empty_text_block),
        pi::sdk::Message::ToolResult(result) => result.content.iter().any(is_empty_text_block),
        _ => false,
    }
}

/// 原地剔除消息列表里 assistant / toolResult 的空文本块，返回是否有改动。
/// 抽成独立纯函数便于单测（`strip_empty_text_blocks` 作用于 `Agent`，构造代价高）。
fn strip_empty_text_blocks_in_place(messages: &mut [pi::sdk::Message]) -> bool {
    let mut changed = false;
    for message in messages.iter_mut() {
        if !message_has_empty_text_block(message) {
            continue;
        }
        changed = true;
        match message {
            pi::sdk::Message::Assistant(arc) => {
                let mut assistant = (**arc).clone();
                assistant.content.retain(|block| !is_empty_text_block(block));
                *message = pi::sdk::Message::Assistant(Arc::new(assistant));
            }
            pi::sdk::Message::ToolResult(arc) => {
                let mut result = (**arc).clone();
                result.content.retain(|block| !is_empty_text_block(block));
                *message = pi::sdk::Message::ToolResult(Arc::new(result));
            }
            _ => {}
        }
    }
    changed
}

/// 发送请求前剔除会话历史里 assistant / toolResult 消息中的“空文本块”。
///
/// # 背景
/// pi 的 anthropic-messages convert（`pi src/providers/anthropic.rs` 的
/// `convert_content_block_to_anthropic`）对 `ContentBlock::Text` **不过滤空串**，
/// 空文本块会被原样序列化成 `{"type":"text","text":""}` 发给 provider。而 pi 在流式
/// 响应里会先种入空 `TextContent` 占位（`pi src/agent.rs` TextStart 处理 + `anthropic.rs`
/// content_block_start），一旦后续 TextDelta 未到达（max_tokens 截断 / 网络断流 / abort），
/// 这个空文本块就会随 assistant 消息落地进历史。下一轮 `build_context` 原样借用，
/// kimi-coding 等严格端点直接返回 `HTTP 400 “text content is empty”`。
///
/// pi 的 openai-completions convert 对空 text 有兜底（`openai.rs` 里 `if text.is_empty()`），
/// 但 anthropic 路径没有；pi 仓库只读，无法在其 convert 层补过滤。
///
/// # 做法
/// 用 pi 公开的 `Agent::messages` / `Agent::replace_messages`（`pi src/agent.rs`）在每次发送前
/// 清洗内存历史。对所有 anthropic-messages provider（kimi-coding / minimax 等）统一生效，
/// 不碰 tool_use / tool_result 配对，也不合并连续 user 消息（仅删空文本块，最小侵入）。
/// 快速路径：历史无空块时直接返回，避免无谓 clone + replace。
fn strip_empty_text_blocks(agent: &mut pi::sdk::Agent) {
    // 快速路径：无空块时直接返回，避免 clone + replace。
    if !agent.messages().iter().any(message_has_empty_text_block) {
        return;
    }
    let mut messages: Vec<pi::sdk::Message> = agent.messages().to_vec();
    strip_empty_text_blocks_in_place(&mut messages);
    agent.replace_messages(messages);
}

/// indemind 等兼容网关在每个 stream chunk 重复下发完整 `tool_calls[].id`，
/// pi `openai.rs` 用 `push_str` 累加后会变成 `call_XXXcall_XXX...`（可达上千字符），
/// 下一轮回放触发 `Invalid 'input[n].call_id': string too long`。
fn is_tool_call_id_overflow_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let mentions_call_id = lower.contains("call_id") || lower.contains("tool_call_id");
    if !mentions_call_id {
        return false;
    }
    lower.contains("string_above_max_length")
        || lower.contains("string too long")
        || lower.contains("maximum length 64")
        || lower.contains("max length 64")
        || lower.contains("above_max_length")
}

fn message_has_oversized_tool_call_id(message: &pi::sdk::Message) -> bool {
    match message {
        pi::sdk::Message::Assistant(assistant) => assistant.content.iter().any(|block| {
            matches!(
                block,
                pi::sdk::ContentBlock::ToolCall(call) if call.id.trim().len() > OPENAI_TOOL_CALL_ID_MAX_LEN
            )
        }),
        pi::sdk::Message::ToolResult(result) => {
            result.tool_call_id.trim().len() > OPENAI_TOOL_CALL_ID_MAX_LEN
        }
        _ => false,
    }
}

/// 原地缩短过长 tool call id，并保持 ToolCall ↔ ToolResult 配对一致。
fn sanitize_oversized_tool_call_ids_in_place(messages: &mut [pi::sdk::Message]) -> bool {
    use std::collections::HashMap;
    let mut remap: HashMap<String, String> = HashMap::new();
    for message in messages.iter() {
        match message {
            pi::sdk::Message::Assistant(assistant) => {
                for block in &assistant.content {
                    if let pi::sdk::ContentBlock::ToolCall(call) = block {
                        if call.id.trim().len() > OPENAI_TOOL_CALL_ID_MAX_LEN {
                            remap
                                .entry(call.id.clone())
                                .or_insert_with(|| shorten_tool_call_id(&call.id));
                        }
                    }
                }
            }
            pi::sdk::Message::ToolResult(result) => {
                if result.tool_call_id.trim().len() > OPENAI_TOOL_CALL_ID_MAX_LEN {
                    remap
                        .entry(result.tool_call_id.clone())
                        .or_insert_with(|| shorten_tool_call_id(&result.tool_call_id));
                }
            }
            _ => {}
        }
    }
    if remap.is_empty() {
        return false;
    }
    for message in messages.iter_mut() {
        match message {
            pi::sdk::Message::Assistant(arc) => {
                let needs = arc.content.iter().any(|block| {
                    matches!(
                        block,
                        pi::sdk::ContentBlock::ToolCall(call) if remap.contains_key(&call.id)
                    )
                });
                if !needs {
                    continue;
                }
                let mut assistant = (**arc).clone();
                for block in &mut assistant.content {
                    if let pi::sdk::ContentBlock::ToolCall(call) = block {
                        if let Some(next) = remap.get(&call.id) {
                            call.id = next.clone();
                        }
                    }
                }
                *message = pi::sdk::Message::Assistant(Arc::new(assistant));
            }
            pi::sdk::Message::ToolResult(arc) => {
                if let Some(next) = remap.get(&arc.tool_call_id) {
                    let mut result = (**arc).clone();
                    result.tool_call_id = next.clone();
                    *message = pi::sdk::Message::ToolResult(Arc::new(result));
                }
            }
            _ => {}
        }
    }
    true
}

fn sanitize_oversized_tool_call_ids(agent: &mut pi::sdk::Agent) {
    if !agent.messages().iter().any(message_has_oversized_tool_call_id) {
        return;
    }
    let mut messages: Vec<pi::sdk::Message> = agent.messages().to_vec();
    sanitize_oversized_tool_call_ids_in_place(&mut messages);
    agent.replace_messages(messages);
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
    super::default_data_dir().map(|root| root.join("pi-sessions").join("catalog.json"))
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
    fn with_secret_fallback_never_fills_api_key_from_vault() {
        // 回归契约：无论 vault 是否有 key，都不得把其写入 SessionOptions.api_key，
        // 否则会变成 Pi session 级 api_key_override，跨 provider 切模型 401。
        let service = PiAgentService::new();
        let mut config = PiSessionConfig::persistent("/tmp/repo", "/tmp/sessions");
        config.provider = Some("deepseek".to_string());
        config.model = Some("deepseek-chat".to_string());
        let resolved = service
            .with_secret_fallback(config)
            .expect("fallback should succeed");
        assert!(resolved.api_key.is_none());

        let mut with_explicit = PiSessionConfig::persistent("/tmp/repo", "/tmp/sessions");
        with_explicit.api_key = Some("explicit-override".to_string());
        let kept = service
            .with_secret_fallback(with_explicit)
            .expect("fallback should succeed");
        assert_eq!(kept.api_key.as_deref(), Some("explicit-override"));
    }

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

    #[test]
    fn strip_empty_text_blocks_in_place_removes_blank_text_keeps_rest() {
        // assistant：非空 text + 空 text + 纯空白 text + thinking(无签名)
        // → 仅删两个空/空白 text，保留 hello 与 thinking（thinking 由 pi convert 自行过滤，这里不动）
        let assistant = pi::sdk::Message::Assistant(Arc::new(pi::sdk::AssistantMessage {
            content: vec![
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("hello")),
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("")),
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("   ")),
                pi::sdk::ContentBlock::Thinking(pi::sdk::ThinkingContent {
                    thinking: "thought".to_string(),
                    thinking_signature: None,
                }),
            ],
            ..pi::sdk::AssistantMessage::default()
        }));
        // toolResult：非空 text + 空 text → 删空 text
        let tool_result = pi::sdk::Message::ToolResult(Arc::new(pi::sdk::ToolResultMessage {
            tool_call_id: "c1".to_string(),
            tool_name: "bash".to_string(),
            content: vec![
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("output")),
                pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("")),
            ],
            details: None,
            is_error: false,
            timestamp: 0,
        }));
        // user：纯文本，不应被触碰
        let user = pi::sdk::Message::User(pi::sdk::UserMessage {
            content: pi::sdk::UserContent::Text("hi".to_string()),
            timestamp: 0,
        });

        let mut messages = vec![assistant, tool_result, user];
        let changed = strip_empty_text_blocks_in_place(&mut messages);
        assert!(changed, "历史含空文本块时应报告有改动");

        let pi::sdk::Message::Assistant(assistant) = &messages[0] else {
            panic!("第一条仍是 assistant");
        };
        assert_eq!(
            assistant.content.len(),
            2,
            "删掉两个空/空白 text，保留 hello + thinking"
        );
        match &assistant.content[0] {
            pi::sdk::ContentBlock::Text(t) => assert_eq!(t.text, "hello"),
            _ => panic!("第一个块应为非空 text"),
        }
        assert!(
            matches!(&assistant.content[1], pi::sdk::ContentBlock::Thinking(_)),
            "第二个块应为 thinking"
        );

        let pi::sdk::Message::ToolResult(result) = &messages[1] else {
            panic!("第二条仍是 toolResult");
        };
        assert_eq!(result.content.len(), 1, "删掉空 text，保留 output");
        match &result.content[0] {
            pi::sdk::ContentBlock::Text(t) => assert_eq!(t.text, "output"),
            _ => panic!("toolResult 剩余块应为非空 text"),
        }

        assert!(
            matches!(&messages[2], pi::sdk::Message::User(_)),
            "user 消息不被触碰"
        );
    }

    #[test]
    fn strip_empty_text_blocks_in_place_noop_when_clean() {
        let assistant = pi::sdk::Message::Assistant(Arc::new(pi::sdk::AssistantMessage {
            content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("ok"))],
            ..pi::sdk::AssistantMessage::default()
        }));
        let mut messages = vec![assistant];
        let changed = strip_empty_text_blocks_in_place(&mut messages);
        assert!(!changed, "无空文本块时不应改动");
        assert_eq!(messages.len(), 1);
    }

    #[test]
    fn sanitize_oversized_tool_call_ids_keeps_pairing_under_64() {
        let long_id = "x".repeat(2204);
        let assistant = pi::sdk::Message::Assistant(Arc::new(pi::sdk::AssistantMessage {
            content: vec![pi::sdk::ContentBlock::ToolCall(pi::sdk::ToolCall {
                id: long_id.clone(),
                name: "bash".to_string(),
                arguments: serde_json::json!({"command": "ls"}),
                thought_signature: None,
            })],
            ..pi::sdk::AssistantMessage::default()
        }));
        let tool_result = pi::sdk::Message::ToolResult(Arc::new(pi::sdk::ToolResultMessage {
            tool_call_id: long_id,
            tool_name: "bash".to_string(),
            content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new("ok"))],
            details: None,
            is_error: false,
            timestamp: 0,
        }));
        let mut messages = vec![assistant, tool_result];
        assert!(sanitize_oversized_tool_call_ids_in_place(&mut messages));

        let pi::sdk::Message::Assistant(assistant) = &messages[0] else {
            panic!("expected assistant");
        };
        let pi::sdk::ContentBlock::ToolCall(call) = &assistant.content[0] else {
            panic!("expected tool call");
        };
        let pi::sdk::Message::ToolResult(result) = &messages[1] else {
            panic!("expected tool result");
        };
        assert!(call.id.len() <= OPENAI_TOOL_CALL_ID_MAX_LEN);
        assert_eq!(call.id, result.tool_call_id);
        assert_eq!(shorten_tool_call_id("short"), "short");
    }

    #[test]
    fn shorten_tool_call_id_collapses_repeated_stream_concatenation() {
        let unit = "call_uXpDRd1ZyOtU0XHAxi17HP0r";
        assert_eq!(unit.len(), 29);
        let long_id = unit.repeat(36);
        assert_eq!(long_id.len(), 1044);
        assert_eq!(shorten_tool_call_id(&long_id), unit);
        assert!(is_tool_call_id_overflow_error(
            r#"Invalid 'input[2].call_id': string too long. Expected a string with maximum length 64, but got a string with length 1044 instead.","code":"string_above_max_length""#
        ));
        assert!(!is_tool_call_id_overflow_error("HTTP 400 invalid api key"));
    }
}

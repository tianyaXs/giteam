use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::sync::{Arc, Mutex, Weak};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use futures::lock::Mutex as AsyncMutex;
use pi::sdk::{create_agent_session, AbortHandle, AgentSessionHandle, SessionOptions};
use thiserror::Error;

use super::https_egress::{ensure_https_egress_shim_with_paths, HttpsEgressShimState};
use super::interactions::{InteractionHub, InteractionRunContext, InteractionStore};
use super::provider_sanitizer::{
    ensure_tool_call_id_sanitizer, shorten_tool_call_id, OPENAI_TOOL_CALL_ID_MAX_LEN,
};
use super::subagents::{
    SubagentHost, SubagentSpawnRequest, SubagentSpawnResult,
};
use super::tools::GiteamToolFactory;
use super::{
    ensure_pi_agent_dir_env, AgentEvent, AgentEventEnvelope, AgentInteraction,
    AgentInteractionReply, AgentMessage, AgentModelInfo, AgentPart, AgentProviderInfo, AgentRole,
    AgentSessionStatus, CustomProviderInput, PiEventTranslator, PiRuntimeInfo, ProviderCatalog,
    SecretStore,
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
    /// 内置浏览器控制器（desktop 注入实现；CLI/control 为 None）。
    pub browser_controller: super::browser_controller::SharedBrowserController,
    /// 父会话 id（子 agent session 填写）。
    pub parent_session_id: Option<String>,
    /// 触发 spawn 的父 tool_call_id。
    pub parent_tool_call_id: Option<String>,
    /// `"primary"` | `"subagent"`；默认 primary。
    pub session_kind: String,
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
            .field("parent_session_id", &self.parent_session_id)
            .field("parent_tool_call_id", &self.parent_tool_call_id)
            .field("session_kind", &self.session_kind)
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
            browser_controller: None,
            parent_session_id: None,
            parent_tool_call_id: None,
            session_kind: "primary".to_string(),
        }
    }

    fn into_sdk_options(self) -> SessionOptions {
        // 未显式指定系统提示词时注入 Giteam 品牌的默认提示词；
        // 否则 pi 会用它自己的默认提示词（自我定位为 pi 并附带 pi 文档指引）。
        let base_prompt = self
            .system_prompt
            .or_else(|| Some(super::default_system_prompt(self.enabled_tools.as_deref())));
        // 模型纪律门控拼在品牌提示词尾部（append 段之前）：字节稳定、缓存友好。
        let system_prompt = match super::prompt::model_discipline_prompt(
            self.provider.as_deref(),
            self.model.as_deref(),
        ) {
            Some(discipline) => base_prompt.map(|base| format!("{base}\n\n{discipline}")),
            None => base_prompt,
        };
        // append 段按「稳定 → 易变」排序：项目记忆（GITEAM.md）→ 工作区快照
        // （git/平台/验证命令）→ skills 清单 → 调用方显式追加段。
        // AGENTS.md/CLAUDE.md 不在此注入——pi 的 # Project Context 通道会收集
        // （含祖先目录），此处再注入会导致双重注入。
        // 子 agent（Hermes skip_context_files）：保留记忆与工作区快照，不注入
        // 全局 skills 目录，避免 ephemeral 任务提示被 skill 清单淹没、拖慢首轮。
        // 快照的执行类信息（放行清单）只注入有 bash/edit/write 能力的会话：
        // 只读子代理收到 `Pre-approved: bash:...` 只是指向不存在工具的诱导。
        let can_execute = match self.enabled_tools.as_deref() {
            // None = 全量工具（含 bash/edit/write）。
            None => true,
            Some(tools) => tools
                .iter()
                .any(|tool| tool == "bash" || tool == "edit" || tool == "write"),
        };
        let mut append_parts: Vec<String> = Vec::new();
        if let Some(memory) = wrap_project_memory(&self.repo_path) {
            append_parts.push(memory);
        }
        // 跨会话感知（被动层）：近期其他会话的意图/改动/未闭环错误摘要。
        // 子 agent 不注入——上下文由父会话传递，保持 ephemeral 提示精简。
        if self.session_kind != "subagent" {
            if let Some(digest) = wrap_asset_graph_digest(&self.repo_path) {
                append_parts.push(digest);
            }
        }
        append_parts.push(super::environment::build_workspace_context(
            &self.repo_path,
            can_execute,
        ));
        if self.session_kind != "subagent" {
            if let Some(skills) = super::skills::build_skills_prompt(&self.repo_path) {
                append_parts.push(skills);
            }
        }
        if let Some(extra) = self.append_system_prompt.as_deref() {
            append_parts.push(extra.to_string());
        }
        let append_system_prompt = (!append_parts.is_empty())
            .then(|| append_parts.join("\n\n"));
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

/// 资产图谱近期变更摘要（跨会话感知的被动注入层）。
/// 图谱未挂载或图为空时返回 None（零成本跳过）。
fn wrap_asset_graph_digest(repo_path: &std::path::Path) -> Option<String> {
    let graph = crate::asset_graph::attached(repo_path)?;
    let graph = graph.lock().ok()?;
    let digest = graph.query().recent_changes_digest(8);
    (!digest.is_empty()).then_some(digest)
}

/// 读取项目记忆（仅 GITEAM.md）并用「项目记忆」小节包裹，供 append 段拼接。
/// AGENTS.md/CLAUDE.md 由 pi 的 # Project Context 通道注入（含祖先目录收集），
/// 此处不再回退读取，避免同一文件被双重注入。
fn wrap_project_memory(repo_path: &std::path::Path) -> Option<String> {
    super::project_memory::read_project_memory(repo_path)
        .map(|memory| format!("# 项目记忆 (GITEAM.md)\n{memory}"))
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
    /// `"primary"` | `"subagent"`。
    #[serde(default = "default_session_kind")]
    pub session_kind: String,
    /// 子 agent 的父会话；主会话为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    /// 触发该子 session 的父 task toolCallId；主会话为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_call_id: Option<String>,
}

fn default_session_kind() -> String {
    "primary".to_string()
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
    /// 工具白名单（Plan 模式限定只读 6 工具）；未限定时 None。持久化以便
    /// set_session_options 重建 handle 与冷启动恢复时回填，旧 catalog 靠 default 兼容。
    #[serde(default)]
    enabled_tools: Option<Vec<String>>,
    /// 用户层系统提示追加段（Build/Plan 模式提示）；恢复与重建时回填。
    #[serde(default)]
    append_system_prompt: Option<String>,
    /// 推理强度（off/minimal/low/medium/high/xhigh）；持久化以便恢复时回填，旧 catalog 靠 default 兼容。
    #[serde(default)]
    thinking: Option<String>,
    /// 单次 prompt 工具调用上限；持久化以便恢复时回填，旧 catalog 靠 default 兼容。
    #[serde(default)]
    max_tool_iterations: Option<usize>,
    /// `"primary"` | `"subagent"`；旧 catalog 缺省按 primary。
    #[serde(default = "default_session_kind")]
    session_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_tool_call_id: Option<String>,
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
    /// Windows HTTPS 出站旁路（见 https_egress）：https base → loopback HTTP 反代。
    https_egress_provider: Mutex<Option<HttpsEgressShimState>>,
    /// 已安装的 tool call id 清洗包装（见 provider_sanitizer）。pi 切换模型会
    /// 重建 provider 丢弃包装，prompt 前按指针比对重装。
    sanitized_provider: Mutex<Option<Arc<dyn pi::sdk::Provider>>>,
    /// prompt 会长时间占用 `handle` 锁；桌面/手机并发 `messages()` 时用此快照避免转圈卡住。
    message_snapshot: Arc<Mutex<Vec<AgentMessage>>>,
    /// steer 排队（run 进行中的用户补充指令）。注册为 pi 的 steering
    /// fetcher 后由 agent loop 在工具批/回合边界自动 drain——同一次 run
    /// 内中轮注入（收到即跳过剩余工具批，等价 Codex 插话）；run 结束后
    /// 遗留的消息在下次 prompt 的 run_loop 开头 drain（pi 自带边界）。
    /// Arc 供 fetcher 闭包无锁共享；上限与 pi MAX_STEERING_QUEUE_SIZE 对齐。
    pending_steers: Arc<Mutex<Vec<String>>>,
}

struct ActiveRun {
    session_id: String,
    abort_handle: AbortHandle,
}

/// steer 结果：排队成功 / 会话空闲（调用方应转普通 prompt）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SteerOutcome {
    /// 已入队；`run_id` 是承载投递的活跃 run。消息由 pi agent loop 在
    /// 下一个工具批/回合边界注入同一 run（中轮插话），前端以
    /// message.completed(user) 事件作为正式投递信号。
    Queued { run_id: String },
    /// 无活跃 run——steer 无处投递，调用方应走 `prompt` 正常发送。
    Idle,
}

type EventSubscriberKey = (String, String);

pub struct PiAgentService {
    sessions: Mutex<HashMap<String, Arc<ManagedSession>>>,
    records: Mutex<HashMap<String, PersistedSessionRecord>>,
    catalog_path: Option<PathBuf>,
    active_runs: Mutex<HashMap<String, ActiveRun>>,
    subscribers: Arc<Mutex<HashMap<EventSubscriberKey, Vec<Sender<AgentEventEnvelope>>>>>,
    /// 每 run 事件环，供 SSE 重连按 sequence 补洞。
    event_buffers: super::events::EventBufferBus,
    /// 审批/提问 pending 注册表（PR6），跨 session 共享，按 id 裁决。
    interactions: Arc<InteractionStore>,
    /// 统一 secret vault。`None` 仅用于隔离测试（不触碰真实 vault 与环境变量）。
    secrets: Option<SecretStore>,
    /// 内置浏览器 controller（desktop 注入）。不可持久化，故由 service 全局持有——
    /// 冷启动恢复 / set_session_options 重建 handle 时复用此引用，避免 controller 随
    /// 重建丢失导致 browser_use 在热切/恢复后失效（实测缺陷：旧 session 调
    /// browser_use 报「内置浏览器仅在桌面端可用」）。
    browser_controller: Mutex<super::browser_controller::SharedBrowserController>,
    /// `global()` / `bind_arc` 写入，供 TaskTool 的 SubagentHost 升级回 Arc。
    self_weak: Mutex<Option<Weak<PiAgentService>>>,
    /// 旁路抽取串行锁：parent_session_id → 锁。同父多轮抽取排队，避免并发打爆 provider。
    extract_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
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
        SERVICE.get_or_init(|| {
            let arc = Arc::new(Self::new_with_catalog(true));
            arc.bind_arc();
            // 登记资产图谱全局抽取宿主：图谱挂载可能早于首个会话创建（面板
            // rebuild 路径），host 可用性不能依赖挂载时机。
            if let Some(host) = arc.asset_graph_subagent_host() {
                crate::asset_graph::set_extraction_host(host);
            }
            arc
        })
    }

    /// 把 `Arc<Self>` 绑到 `self_weak`，使 TaskTool 能通过 SubagentHost 回调本实例。
    pub fn bind_arc(self: &Arc<Self>) {
        if let Ok(mut slot) = self.self_weak.lock() {
            *slot = Some(Arc::downgrade(self));
        }
    }

    #[must_use]
    pub fn new() -> Self {
        Self::new_with_catalog(false)
    }

    fn new_with_catalog(load_catalog: bool) -> Self {
        let catalog_path = global_catalog_path();
        let mut records = if load_catalog {
            load_catalog_records(catalog_path.as_ref())
        } else {
            HashMap::new()
        };
        let catalog_dirty = if load_catalog {
            migrate_repo_session_paths(&mut records)
        } else {
            false
        };
        // 生产模式（global）：先把 PI_CODING_AGENT_DIR 指到 Giteam 管理的目录，
        // 使 Pi 内部 AuthStorage/ModelRegistry 与本 service 的 vault 读写同一文件；
        // 然后 vault 与该目录下的 auth.json 对齐。必须在任何 Pi session 创建前完成。
        let secrets = if load_catalog {
            ensure_pi_agent_dir_env();
            // Pi 云端默认 HTTP 整请求超时 60s；子 agent 调研/长流式很容易踩中。
            // 桌面端强制抬到 30 分钟（除非用户显式设置了 PI_HTTP_REQUEST_TIMEOUT_SECS）。
            // 0 = 不限时。见 pi::http::client::DEFAULT_REMOTE_REQUEST_TIMEOUT_SECS。
            ensure_agent_http_timeout();
            SecretStore::default_path().map(SecretStore::new)
        } else {
            None
        };
        let service = Self {
            sessions: Mutex::new(HashMap::new()),
            records: Mutex::new(records),
            catalog_path: if load_catalog { catalog_path } else { None },
            active_runs: Mutex::new(HashMap::new()),
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            event_buffers: Arc::new(Mutex::new(HashMap::new())),
            interactions: Arc::new(InteractionStore::new()),
            secrets,
            browser_controller: Mutex::new(None),
            self_weak: Mutex::new(None),
            extract_locks: Mutex::new(HashMap::new()),
        };
        if catalog_dirty {
            let _ = service.persist_catalog();
        }
        service
    }

    /// 注入隔离的 secret vault（测试或自定义数据目录场景）。
    #[must_use]
    pub fn with_secrets(mut self, secrets: SecretStore) -> Self {
        self.secrets = Some(secrets);
        self
    }

    /// 注入内置浏览器 controller（desktop 启动时调用，全局共享）。`create_session`
    /// 注入时也会缓存到此。冷启动恢复旧 session / `set_session_options` 重建 handle
    /// 时复用，避免 controller 不可持久化导致 browser_use 在热切/恢复后失效。
    pub fn set_browser_controller(
        &self,
        controller: super::browser_controller::SharedBrowserController,
    ) {
        if let Ok(mut slot) = self.browser_controller.lock() {
            *slot = controller;
        }
    }

    /// 取当前缓存的 controller（会话恢复/热切重建路径回填 config 用）。
    fn current_browser_controller(&self) -> super::browser_controller::SharedBrowserController {
        self.browser_controller
            .lock()
            .map_or(None, |slot| slot.clone())
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
        if let Ok(mut buffers) = self.event_buffers.lock() {
            buffers.clear();
        }
        let _ = self.persist_catalog();
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
        if let Ok(mut records) = self.records.lock() {
            records.clear();
        }
    }

    /// 订阅 live 事件（after_seq=0，无重放）。
    #[must_use]
    pub fn subscribe_events(&self, session_id: &str, run_id: &str) -> AgentEventReceiver {
        self.subscribe_events_after(session_id, run_id, 0).1
    }

    /// 返回 `(replay, live_receiver)`：先挂 live，再快照 ring，避免中间丢帧；
    /// 与 replay 重叠的 live 事件由客户端按 sequence 去重。
    #[must_use]
    pub fn subscribe_events_after(
        &self,
        session_id: &str,
        run_id: &str,
        after_seq: u64,
    ) -> (Vec<AgentEventEnvelope>, AgentEventReceiver) {
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers
                .entry((session_id.to_string(), run_id.to_string()))
                .or_default()
                .push(sender);
        }
        let replay = super::events::replay_events_after(
            &self.event_buffers,
            session_id,
            run_id,
            after_seq,
        );
        (replay, receiver)
    }

    /// run 是否仍在 `active_runs`；用于 SSE 对账，避免把 interaction-idle 误判成已结束。
    #[must_use]
    pub fn run_active_session(&self, run_id: &str) -> Option<String> {
        self.active_runs
            .lock()
            .ok()?
            .get(run_id)
            .map(|run| run.session_id.clone())
    }

    /// 向 (session_id, run_id) 的 SSE 订阅者广播 run.failed 终态。
    /// control server 的 prompt 已后台化（HTTP 立即返回），早期失败（session 不存在、
    /// 图片读盘失败等）发生在任何 pi 事件之前，若不补发终态，手机端 SSE 会悬等心跳。
    pub fn publish_run_failed(&self, session_id: &str, run_id: &str, error: &str) {
        let sequence = next_event_sequence(&self.event_buffers, session_id, run_id);
        let event = AgentEventEnvelope {
            schema_version: super::events::AGENT_EVENT_SCHEMA_VERSION,
            event_id: format!("failed-{run_id}-{}", uuid::Uuid::new_v4()),
            sequence,
            repo_path: String::new(),
            session_id: session_id.to_string(),
            run_id: Some(run_id.to_string()),
            timestamp_ms: u64::try_from(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_millis())
                    .unwrap_or_default(),
            )
            .unwrap_or_default(),
            event: super::AgentEvent::RunFailed {
                error: error.to_string(),
            },
        };
        publish_event(&self.subscribers, &self.event_buffers, &event);
        self.schedule_clear_event_buffer(session_id, run_id);
    }

    pub async fn create_session(
        &self,
        config: PiSessionConfig,
    ) -> Result<PiSessionSummary, PiAgentError> {
        let mut config = self.with_secret_fallback(config)?;
        // 缓存 controller 到 service 全局槽：冷启动恢复 / set_session_options 重建
        // handle 时复用，避免 controller 随重建丢失（browser_use 在热切/恢复后失效）。
        if config.browser_controller.is_some() {
            if let Ok(mut slot) = self.browser_controller.lock() {
                *slot = config.browser_controller.clone();
            }
        }
        if !config.no_session {
            fs::create_dir_all(&config.session_dir)
                .map_err(|error| PiAgentError::Persistence(error.to_string()))?;
            // 用户目录会话仓写入 repo.json，便于人工对照仓库路径。
            super::secrets::write_repo_sessions_meta(&config.session_dir, &config.repo_path);
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
        // config 随 sdk_options_with_factory 按值消费；先把模式相关字段 clone 出来，
        // 供 record 持久化（set_session_options 重建与冷启动恢复都依赖此回填）。
        let enabled_tools = config.enabled_tools.clone();
        let append_system_prompt = config.append_system_prompt.clone();
        let thinking = config.thinking.clone();
        let max_tool_iterations = config.max_tool_iterations;
        let parent_session_id = config.parent_session_id.clone();
        let parent_tool_call_id = config.parent_tool_call_id.clone();
        let session_kind = if config.session_kind.trim().is_empty() {
            "primary".to_string()
        } else {
            config.session_kind.clone()
        };
        let hub = Arc::new(InteractionHub::new(Arc::clone(&self.interactions)));
        // 绑定仓库并加载项目级权限规则（.giteam/permissions.json），使持久化规则随会话生效。
        hub.set_repo_path(repo_path.clone());
        // 仓库资产图谱：会话创建即挂载（打开 + 增量回放存量会话），并注入
        // 子代理宿主启用 turn 级语义抽取（继承会话 provider/model；host 不可用
        // 时退化为仅过程层）。等待挂载完成再建会话，保证首个 turn 的事件不丢；
        // 失败只记日志——图谱是旁路能力，绝不阻塞会话创建。
        if crate::asset_graph::attached(&repo_path).is_none() {
            let host = self.subagent_host_for(&session_kind);
            let graph_repo = repo_path.clone();
            let _ = tokio::task::spawn_blocking(move || {
                let result = match host {
                    Some(host) => {
                        crate::asset_graph::attach_repo_with_extraction(&graph_repo, host)
                    }
                    None => crate::asset_graph::attach_repo(&graph_repo),
                };
                match result {
                    Ok((indexed, skipped)) => {
                        eprintln!("[asset-graph] attached {}: replayed {indexed}, unchanged {skipped}", graph_repo.display());
                    }
                    Err(error) => eprintln!("[asset-graph] attach {} failed: {error}", graph_repo.display()),
                }
            })
            .await;
        }
        let mut handle = create_agent_session(sdk_options_with_factory(
            config,
            &hub,
            self.subagent_host_for(&session_kind),
        ))
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
            session_kind: session_kind.clone(),
            parent_session_id: parent_session_id.clone(),
            parent_tool_call_id: parent_tool_call_id.clone(),
        };
        let pending_steers = Arc::new(Mutex::new(Vec::new()));
        register_steer_fetcher(&mut handle, &pending_steers);
        let managed = Arc::new(ManagedSession {
            repo_path,
            handle: AsyncMutex::new(handle),
            hub,
            https_egress_provider: Mutex::new(None),
            sanitized_provider: Mutex::new(None),
            message_snapshot: Arc::new(Mutex::new(Vec::new())),
            pending_steers,
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
                enabled_tools,
                append_system_prompt,
                thinking,
                max_tool_iterations,
                session_kind,
                parent_session_id,
                parent_tool_call_id,
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
            session_kind: self.record_session_kind(session_id),
            parent_session_id: self.record_parent_session_id(session_id),
            parent_tool_call_id: self.record_parent_tool_call_id(session_id),
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
        // 恢复失败分类：文件已丢失（Session not found）→ 记录是陈旧残留，
        // 自动清出 catalog（否则每次列表都刷一条错误）；provider/model 失效
        // → 保留记录，降级为 catalog 元数据行，会话不因 provider 暂时不可用
        // 而从列表消失。
        let mut catalog_dirty = false;
        let mut degraded_session_ids: Vec<String> = Vec::new();
        for session_id in record_ids {
            match self.get_session(&session_id).await {
                Ok(_) => {}
                Err(error) => {
                    let message = error.to_string();
                    if message.contains("Session not found") {
                        if let Ok(mut records) = self.records.lock() {
                            if records.remove(&session_id).is_some() {
                                catalog_dirty = true;
                                eprintln!(
                                    "[pi-agent] pruned stale catalog record (session file missing): {session_id}"
                                );
                            }
                        }
                    } else {
                        eprintln!(
                            "[pi-agent] list_sessions restore degraded for {session_id}: {message}"
                        );
                        degraded_session_ids.push(session_id);
                    }
                }
            }
        }
        if catalog_dirty {
            let _ = self.persist_catalog();
        }
        // 保留 map 键：busy 时拿不到 handle.state()，只能靠 session_id + catalog/snapshot。
        let sessions: Vec<(String, Arc<ManagedSession>)> = self
            .sessions
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .iter()
            .map(|(id, session)| (id.clone(), Arc::clone(session)))
            .collect();
        let mut summaries = Vec::with_capacity(sessions.len());
        let mut titles_to_cache: Vec<(String, String)> = Vec::new();
        for (session_id, session) in sessions {
            // 子 agent：靠 kind 或 parent 标记排除，不进主列表（UI 靠 subagent.* 事件）。
            // extract 子代理是 ephemeral 无记录会话：靠注册表排除（运行中的瞬态窗口）。
            let kind = self.record_session_kind(&session_id);
            if kind == "subagent"
                || self.record_parent_session_id(&session_id).is_some()
                || crate::asset_graph::extraction::is_extract_session(&session_id)
            {
                continue;
            }

            // 成熟产品形态：列表读 catalog / 非阻塞快照，绝不因某会话 prompt 持锁而挂起整表。
            let locked = session.handle.try_lock();
            let Some(handle) = locked.as_ref() else {
                summaries.push(self.summary_from_catalog_or_snapshot(&session_id, &session));
                continue;
            };

            let state = handle
                .state()
                .await
                .map_err(|error| PiAgentError::Sdk(error.to_string()))?;
            let live_id = state
                .session_id
                .unwrap_or_else(|| session_id.clone());
            // 标题派生：pi SessionHeader 无标题字段，取首条用户消息摘要。
            // 派生结果缓存进 record（标题不会变），避免每次列表都全量解析消息。
            let cached_title = self.record_title(&live_id);
            let (title, live_messages) = match cached_title {
                Some(title) => (Some(title), None),
                None => {
                    let messages = handle.messages().await.ok();
                    let derived = messages
                        .as_ref()
                        .and_then(|messages| derive_session_title(messages));
                    if let Some(title) = &derived {
                        titles_to_cache.push((live_id.clone(), title.clone()));
                    }
                    (derived, messages)
                }
            };
            // 无标题时刚读过 messages：顺带刷新快照，供下次 busy 列表兜底。
            if let Some(messages) = live_messages {
                let agent_messages: Vec<AgentMessage> =
                    messages.into_iter().map(AgentMessage::from_pi).collect();
                if let Ok(mut snap) = session.message_snapshot.lock() {
                    *snap = agent_messages;
                }
            }
            summaries.push(PiSessionSummary {
                session_id: live_id,
                repo_path: session.repo_path.clone(),
                provider: state.provider,
                model: state.model_id,
                message_count: state.message_count,
                updated_at_ms: self.record_updated_at_ms(&session_id),
                title,
                session_kind: self.record_session_kind(&session_id),
                parent_session_id: self.record_parent_session_id(&session_id),
                parent_tool_call_id: self.record_parent_tool_call_id(&session_id),
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
        // 最近活跃优先（updatedAtMs 降序，同刻按 id 保持确定性）。消费方
        // （桌面/移动/Web）都是「取前 N 条」分页：按 id 字典序返回会让
        // 字母序靠后的最新会话永远进不了第一页（表现为「重启后看不到
        // 刚聊过的会话」）。
        // provider/model 失效的会话：以 catalog 元数据降级入列（kind/parent
        // 过滤照常），记录保留——provider 修复后 get_session 恢复完整能力。
        for session_id in &degraded_session_ids {
            let Some(record) = self.records.lock().ok().and_then(|records| records.get(session_id).cloned()) else {
                continue;
            };
            if record.session_kind == "subagent" || record.parent_session_id.is_some() {
                continue;
            }
            summaries.push(PiSessionSummary {
                session_id: record.session_id.clone(),
                repo_path: record.repo_path.clone(),
                provider: record.provider.clone(),
                model: record.model.clone(),
                message_count: 0,
                updated_at_ms: record.updated_at_ms,
                title: record.title.clone().filter(|t| !t.trim().is_empty()),
                session_kind: record.session_kind.clone(),
                parent_session_id: record.parent_session_id.clone(),
                parent_tool_call_id: record.parent_tool_call_id.clone(),
            });
        }
        summaries.sort_by(|left, right| {
            right
                .updated_at_ms
                .cmp(&left.updated_at_ms)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        Ok(summaries)
    }

    /// prompt 持锁时的列表兜底：catalog 元数据 + message_snapshot，不 await handle。
    fn summary_from_catalog_or_snapshot(
        &self,
        session_id: &str,
        session: &ManagedSession,
    ) -> PiSessionSummary {
        let snap = session
            .message_snapshot
            .lock()
            .ok()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        let snap_title = derive_agent_session_title(&snap);
        let cached_title = self.record_title(session_id);
        let title = cached_title.or(snap_title);
        if let (Some(title), Ok(mut records)) = (title.clone(), self.records.lock()) {
            if let Some(record) = records.get_mut(session_id) {
                if record.title.as_ref().map(|t| t.trim().is_empty()).unwrap_or(true) {
                    record.title = Some(title.clone());
                }
            }
        }
        let (provider, model, repo_path) = self
            .records
            .lock()
            .ok()
            .and_then(|records| {
                records.get(session_id).map(|record| {
                    (
                        record.provider.clone(),
                        record.model.clone(),
                        record.repo_path.clone(),
                    )
                })
            })
            .unwrap_or_else(|| {
                (
                    String::new(),
                    String::new(),
                    session.repo_path.clone(),
                )
            });
        PiSessionSummary {
            session_id: session_id.to_string(),
            repo_path,
            provider,
            model,
            message_count: snap.len(),
            updated_at_ms: self.record_updated_at_ms(session_id),
            title,
            session_kind: self.record_session_kind(session_id),
            parent_session_id: self.record_parent_session_id(session_id),
            parent_tool_call_id: self.record_parent_tool_call_id(session_id),
        }
    }

    pub async fn messages(&self, session_id: &str) -> Result<Vec<AgentMessage>, PiAgentError> {
        let session = self.get_session(session_id).await?;
        // prompt 持锁期间不能阻塞读；否则桌面展开会话列表会一直转圈到整轮回复结束。
        let locked = {
            let handle_guard = session.handle.try_lock();
            if let Some(handle) = handle_guard.as_ref() {
                Some(
                    handle
                        .messages()
                        .await
                        .map_err(|error| PiAgentError::Sdk(error.to_string()))?
                        .into_iter()
                        .map(AgentMessage::from_pi)
                        .collect::<Vec<_>>(),
                )
            } else {
                None
            }
        };
        if let Some(messages) = locked {
            if let Ok(mut snap) = session.message_snapshot.lock() {
                *snap = messages.clone();
            }
            Ok(messages)
        } else {
            let snap = session
                .message_snapshot
                .lock()
                .map_err(|error| PiAgentError::State(error.to_string()))?;
            Ok(snap.clone())
        }
    }

    /// run 进行中排队用户补充指令（steer / 中轮插话）。
    ///
    /// 只写 `pending_steers` 队列，不持 handle 锁——本方法在 prompt 进行
    /// 中调用正是主场景。实际投递走 pi 的 **follow_up** fetcher（对齐 Codex
    /// `pending_input`）：等当前回合（含工具）跑完后再注入下一条，同一 run
    /// 内一次只开一条 follow-up；**不会**像 pi `steering` 那样用「Skipped due to queued user
    /// message」跳过未执行工具——否则连发「还有上海/南京」时前面的查询会被
    /// 全部跳过，模型容易只答最后一句。
    pub fn steer(&self, session_id: &str, message: &str) -> Result<SteerOutcome, PiAgentError> {
        let message = message.trim();
        if message.is_empty() {
            return Err(PiAgentError::Sdk("steer message is empty".to_string()));
        }
        let session = self
            .sessions
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?
            .get(session_id)
            .cloned()
            .ok_or_else(|| PiAgentError::SessionNotFound(session_id.to_string()))?;

        let active_run_id = self
            .active_runs
            .lock()
            .ok()
            .and_then(|runs| {
                runs.iter()
                    .find(|(_, run)| run.session_id == session_id)
                    .map(|(run_id, _)| run_id.clone())
            });
        let Some(run_id) = active_run_id else {
            return Ok(SteerOutcome::Idle);
        };

        let position = {
            let Ok(mut queue) = session.pending_steers.lock() else {
                return Err(PiAgentError::State("steer queue poisoned".to_string()));
            };
            push_pending_steer(&mut queue, message)
        };

        let sequence = next_event_sequence(&self.event_buffers, session_id, &run_id);
        let envelope = AgentEventEnvelope {
            schema_version: super::events::AGENT_EVENT_SCHEMA_VERSION,
            event_id: format!("steer-{run_id}-{}", uuid::Uuid::new_v4()),
            sequence,
            repo_path: String::new(),
            session_id: session_id.to_string(),
            run_id: Some(run_id.clone()),
            timestamp_ms: now_ms(),
            event: super::AgentEvent::SteerQueued {
                message: message.to_string(),
                position,
            },
        };
        publish_event(&self.subscribers, &self.event_buffers, &envelope);
        Ok(SteerOutcome::Queued { run_id })
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
            event_buffers: Arc::clone(&self.event_buffers),
        });
        let event_translator = Arc::clone(&translator);
        let event_sink = Arc::clone(&sink);
        let subscribers = Arc::clone(&self.subscribers);
        let event_buffers = Arc::clone(&self.event_buffers);
        let message_snapshot = Arc::clone(&session.message_snapshot);
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
                // 同步快照：并发 messages() 在 handle 被占用时可读到用户消息与进行中的 assistant。
                if let AgentEvent::MessageCompleted { message } = &event.event {
                    if let Ok(mut snap) = message_snapshot.lock() {
                        if let Some(pos) = snap.iter().position(|item| item.id == message.id) {
                            snap[pos] = message.clone();
                        } else {
                            snap.push(message.clone());
                        }
                    }
                }
                publish_event(&subscribers, &event_buffers, &event);
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
        // 模型能力分流（直传图片、不做文本降级）。
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
        // 图片降级重试用的纯文本 prompt：乐观直传图片后若 provider 拒收（不支持 image），
        // 去图用此 prompt 重试一次，附加软说明让模型如实告知用户，而非报错中断。
        let degraded_image_prompt = if prompt.trim().is_empty() {
            "（用户发送了图片，但当前端点不支持图像输入，图片已被忽略。请告知用户该端点无法处理图片，建议切换到支持视觉的模型后重试。）".to_string()
        } else {
            format!("{prompt}\n\n（系统提示：当前端点不支持图像输入，本次附图已被移除；请基于上述文字内容正常回复，并简要告知用户图片未能处理，建议切换到支持视觉的模型。）")
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
        // 图片降级重试标记：provider 拒收图片时去图重试一次，不报错中断（配套"默认允许图片"）。
        let mut image_degraded_retry = false;

        let result: Result<pi::sdk::AssistantMessage, pi::error::Error> = {
            let mut handle = session.handle.lock().await;
            // 持锁前先把当前历史写入快照，避免并发 messages() 读到空列表。
            if let Ok(current) = handle.messages().await {
                if let Ok(mut snap) = session.message_snapshot.lock() {
                    *snap = current.into_iter().map(AgentMessage::from_pi).collect();
                }
            }
            // Windows：https provider 经 loopback HTTP 反代出站（见 https_egress），
            // 避开 asupersync TLS 的 WSAENOTCONN 10057。必须在 sanitizer 之前安装，
            // 以便清洗包装套在 loopback provider 上。
            /* Windows HTTPS 出站已由 asupersync fork 的 connect 完成检测根治修复
             * （[patch.crates-io] tianyaXs/asupersync-1 分支 fix/windows-connect-completion-v0.3.9），
             * pi 直连 https 即可，不再需要 loopback 反代旁路。反代安装块暂时禁用，
             * 便于本次 fork 真机验证：若 10057 复现，去掉此块注释即可回退到反代兜底。
            if let Ok(store) = self.secret_store() {
                let models_path = store
                    .auth_file_path()
                    .parent()
                    .map(|dir| dir.join("models.json"));
                ensure_https_egress_shim_with_paths(
                    &mut handle.session_mut().agent,
                    &session.https_egress_provider,
                    store.auth_file_path(),
                    models_path,
                );
            }
            */
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
            // steer 投递由 pi agent loop 的 follow_up fetcher 负责（当前步骤/
            // 工具批完成后注入同一 run；见 register_steer_fetcher），
            // 这里不再手动续跑，避免双投。
            let attempt_outcome = loop {
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
                let attempt_result = if image_degraded_retry {
                    // 图片降级重试：provider 拒收图片，去图用纯文本重发，避免报错中断 agent。
                    image_degraded_retry = false;
                    handle
                        .prompt_with_abort(
                            degraded_image_prompt.clone(),
                            abort_signal_for_prompt.clone(),
                            on_event_cb,
                        )
                        .await
                } else if retry_count == 0 {
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
                        let image_unsup =
                            content_blocks.is_some() && is_image_unsupported_error(&err_msg);
                        if image_unsup {
                            image_degraded_retry = true;
                        }
                        final_error = Some(err_msg.clone());
                        // 限额/计费类不重试（充值前不会自愈），provider 文案透出。
                        retry_enabled
                            && retry_count < max_retries
                            && !is_quota_error(&err_msg)
                            && (pi::error::is_retryable_error(
                                &err_msg,
                                Some(message.usage.input),
                                None,
                            ) || is_tool_call_id_overflow_error(&err_msg)
                                || image_unsup)
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
                        let image_unsup =
                            content_blocks.is_some() && is_image_unsupported_error(&err_str);
                        if image_unsup {
                            image_degraded_retry = true;
                        }
                        final_error = Some(err_str.clone());
                        // 限额/计费类不重试（充值前不会自愈），provider 文案透出。
                        retry_enabled
                            && retry_count < max_retries
                            && !is_quota_error(&err_str)
                            && (err.is_transient()
                                || pi::error::is_retryable_error(&err_str, None, None)
                                || is_tool_call_id_overflow_error(&err_str)
                                || image_unsup)
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
            };

            // steer 续跑已由 pi follow_up fetcher 接管（步骤完成后注入同一 run），
            // 此处不再手动 drain。
            attempt_outcome
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
            publish_event(&self.subscribers, &self.event_buffers, &event);
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
            publish_event(&self.subscribers, &self.event_buffers, &event);
            (sink)(event);
        }

        // 终态已入环，短暂保留供 SSE 重连补洞；延迟清理避免无限堆积。
        self.schedule_clear_event_buffer(session_id, run_id);

        // run 收尾刷新会话活跃时间：列表「最近活跃优先」排序的数据源，
        // 否则 updated_at 停在创建时刻，重聊旧会话不会浮到列表顶部。
        let touched = now_ms();
        let activity_dirty = self
            .records
            .lock()
            .map(|mut records| {
                records
                    .get_mut(session_id)
                    .map(|record| {
                        if record.updated_at_ms < touched {
                            record.updated_at_ms = touched;
                            true
                        } else {
                            false
                        }
                    })
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if activity_dirty {
            let _ = self.persist_catalog();
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
        let candidates: Vec<(String, String)> = runs
            .iter()
            .filter(|(id, _)| *id != run_id)
            .map(|(id, child)| (id.clone(), child.session_id.clone()))
            .collect();
        drop(runs);

        // 父 run 暂停时一并中止其子 agent，避免子 session 继续烧配额、回写迟到事件。
        let mut child_targets: Vec<(String, String)> = Vec::new();
        for (child_run_id, child_session_id) in candidates {
            let Some(parent) = self.record_parent_session_id(&child_session_id) else {
                continue;
            };
            if parent == session_id {
                child_targets.push((child_run_id, child_session_id));
            }
        }
        if let Ok(runs) = self.active_runs.lock() {
            for (child_run_id, _) in &child_targets {
                if let Some(child) = runs.get(child_run_id) {
                    child.abort_handle.abort();
                }
            }
        }

        // abort 立即释放该 run 的 pending 交互，等待中的工具按拒绝收尾。
        self.interactions.reject_run(&session_id, run_id, "aborted");
        for (child_run_id, child_session_id) in child_targets {
            self.interactions
                .reject_run(&child_session_id, &child_run_id, "aborted");
        }
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
            // pi 已按新模型重建 provider，旁路/清洗缓存失效，下次 prompt 重装。
            if let Ok(mut slot) = session.https_egress_provider.lock() {
                *slot = None;
            }
            if let Ok(mut slot) = session.sanitized_provider.lock() {
                *slot = None;
            }
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
            session_kind: self.record_session_kind(session_id),
            parent_session_id: self.record_parent_session_id(session_id),
            parent_tool_call_id: self.record_parent_tool_call_id(session_id),
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

    /// 热切换已存在 session 的工具白名单与系统提示追加段（Build/Plan 模式切换）。
    ///
    /// pi 的 ToolRegistry 创建后不可变（无 remove/replace），无法直接改工具集；
    /// 这里复用 set_model 的「更新 record → 丢弃内存 handle → get_session 重建」模式：
    /// 重建会按新 enabled_tools/append_system_prompt 重装配工具与系统提示，同时从
    /// session_path 指向的 jsonl 重载全部对话历史，session_id 不变（对用户透明）。
    pub async fn set_session_options(
        &self,
        session_id: &str,
        enabled_tools: Option<Vec<String>>,
        append_system_prompt: Option<String>,
    ) -> Result<PiSessionSummary, PiAgentError> {
        self.ensure_not_running(session_id)?;
        // 选项未变时直接返回：避免「空 patch / 重复调用」仍丢弃 handle 并重载整段 jsonl。
        // 手机端经云端中继时，这种无意义重建会被放大成数秒～十余秒的发送阻塞。
        let unchanged = self
            .records
            .lock()
            .ok()
            .and_then(|records| {
                records.get(session_id).map(|record| {
                    record.enabled_tools == enabled_tools
                        && record.append_system_prompt == append_system_prompt
                })
            })
            .unwrap_or(false);
        if unchanged {
            let session = self.get_session(session_id).await?;
            let state = {
                let handle = session.handle.lock().await;
                handle
                    .state()
                    .await
                    .map_err(|error| PiAgentError::Sdk(error.to_string()))?
            };
            return Ok(PiSessionSummary {
                session_id: state.session_id.unwrap_or_else(|| session_id.to_string()),
                repo_path: session.repo_path.clone(),
                provider: state.provider,
                model: state.model_id,
                message_count: state.message_count,
                updated_at_ms: self.record_updated_at_ms(session_id),
                title: self.record_title(session_id),
                session_kind: self.record_session_kind(session_id),
                parent_session_id: self.record_parent_session_id(session_id),
                parent_tool_call_id: self.record_parent_tool_call_id(session_id),
            });
        }
        // 1. 更新持久化 record（锁内短改即释）。
        if let Ok(mut records) = self.records.lock() {
            if let Some(record) = records.get_mut(session_id) {
                record.enabled_tools = enabled_tools.clone();
                record.append_system_prompt = append_system_prompt.clone();
                record.updated_at_ms = now_ms();
            }
        }
        let _ = self.persist_catalog();
        // 2. 丢弃内存 handle，迫使 get_session 用新 record 重建。
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
        // 3. 重建：重载 jsonl 历史 + 新工具集/系统提示；session_id 不变。
        let session = self.get_session(session_id).await?;
        let state = {
            let handle = session.handle.lock().await;
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
            session_kind: self.record_session_kind(session_id),
            parent_session_id: self.record_parent_session_id(session_id),
            parent_tool_call_id: self.record_parent_tool_call_id(session_id),
        })
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

    fn record_session_kind(&self, session_id: &str) -> String {
        self.records
            .lock()
            .ok()
            .and_then(|records| {
                records
                    .get(session_id)
                    .map(|record| record.session_kind.clone())
            })
            .filter(|kind| !kind.trim().is_empty())
            .unwrap_or_else(|| "primary".to_string())
    }

    fn record_parent_session_id(&self, session_id: &str) -> Option<String> {
        self.records.lock().ok().and_then(|records| {
            records
                .get(session_id)
                .and_then(|record| record.parent_session_id.clone())
        })
    }

    fn record_parent_tool_call_id(&self, session_id: &str) -> Option<String> {
        self.records.lock().ok().and_then(|records| {
            records
                .get(session_id)
                .and_then(|record| record.parent_tool_call_id.clone())
        })
    }

    /// 列出某主会话下的子 agent 记录（含 parentToolCallId），供冷启动回填 task 卡。
    /// 只读 catalog，不必打开子 handle。
    pub fn list_child_sessions(&self, parent_session_id: &str) -> Vec<PiSessionSummary> {
        let parent = parent_session_id.trim();
        if parent.is_empty() {
            return Vec::new();
        }
        let Ok(records) = self.records.lock() else {
            return Vec::new();
        };
        let mut summaries: Vec<PiSessionSummary> = records
            .values()
            .filter(|record| {
                record.session_kind == "subagent"
                    && record
                        .parent_session_id
                        .as_deref()
                        .map(|id| id == parent)
                        .unwrap_or(false)
            })
            .map(|record| PiSessionSummary {
                session_id: record.session_id.clone(),
                repo_path: record.repo_path.clone(),
                provider: record.provider.clone(),
                model: record.model.clone(),
                message_count: 0,
                updated_at_ms: record.updated_at_ms,
                title: record.title.clone(),
                session_kind: record.session_kind.clone(),
                parent_session_id: record.parent_session_id.clone(),
                parent_tool_call_id: record.parent_tool_call_id.clone(),
            })
            .collect();
        // 与 list_sessions 一致：最近活跃优先，分页消费方才能取到最新会话。
        summaries.sort_by(|left, right| {
            right
                .updated_at_ms
                .cmp(&left.updated_at_ms)
                .then_with(|| left.session_id.cmp(&right.session_id))
        });
        summaries
    }

    /// 资产图谱语义抽取用的子代理宿主（主会话级 host；服务不可用时 None）。
    #[must_use]
    pub fn asset_graph_subagent_host(&self) -> Option<Arc<dyn SubagentHost>> {
        self.subagent_host_for("primary")
    }

    /// 主会话注入 SubagentHost；子 agent（session_kind=subagent）不注入，禁止再委派。
    fn subagent_host_for(&self, session_kind: &str) -> Option<Arc<dyn SubagentHost>> {
        if session_kind == "subagent" {
            return None;
        }
        let weak = self
            .self_weak
            .lock()
            .ok()
            .and_then(|slot| slot.clone())?;
        Some(Arc::new(ServiceSubagentHost { weak }))
    }

    /// 同步 spawn 子 agent：create_session + prompt，投影 subagent.* 到父 run stream。
    ///
    /// 不占用 BackgroundTaskRegistry；父 handle 在 tool 执行期间可能仍被 prompt 持锁，
    /// 本方法只读 parent record / hub.run_context，不锁父 handle。
    pub async fn run_subagent(
        &self,
        request: SubagentSpawnRequest,
    ) -> Result<SubagentSpawnResult, PiAgentError> {
        let started = Instant::now();
        ensure_agent_http_timeout();
        let definition = super::subagents::resolve(&request.subagent_type)
            .map_err(PiAgentError::Sdk)?;

        let parent_meta = {
            let records = self
                .records
                .lock()
                .map_err(|error| PiAgentError::State(error.to_string()))?;
            let record = records
                .get(&request.parent_session_id)
                .ok_or_else(|| {
                    PiAgentError::SessionNotFound(request.parent_session_id.clone())
                })?;
            (
                record.repo_path.clone(),
                record.session_dir.clone(),
                (!record.provider.is_empty()).then_some(record.provider.clone()),
                (!record.model.is_empty()).then_some(record.model.clone()),
                record.thinking.clone(),
            )
        };
        let (repo_path, session_dir, provider, model, thinking) = parent_meta;

        let parent_session = self.get_session(&request.parent_session_id).await?;
        let parent_run = parent_session.hub.run_context().ok_or_else(|| {
            PiAgentError::Sdk("parent run context unavailable for subagent".to_string())
        })?;

        let mut config = PiSessionConfig::persistent(repo_path.clone(), session_dir);
        config.provider = provider;
        config.model = model;
        config.thinking = thinking;
        config.enabled_tools = Some(definition.enabled_tools.clone());
        // Hermes：子 agent 用 ephemeral 系统提示，不继承主会话 default_system_prompt。
        let goal = if request.prompt.trim().is_empty() {
            request.description.clone()
        } else {
            request.prompt.clone()
        };
        let context = request.context.trim();
        config.system_prompt = Some(super::subagents::build_child_system_prompt(
            &definition,
            &goal,
            (!context.is_empty()).then_some(context),
            Some(repo_path.to_string_lossy().as_ref()),
        ));
        config.append_system_prompt = None;
        config.parent_session_id = Some(request.parent_session_id.clone());
        config.parent_tool_call_id = Some(request.parent_tool_call_id.clone());
        config.session_kind = "subagent".to_string();
        config.browser_controller = self.current_browser_controller();

        let child = self.create_session(config).await?;
        let child_session_id = child.session_id.clone();
        let child_run_id = format!(
            "sub-{}-{}",
            sanitize_run_id_fragment(&request.parent_tool_call_id),
            now_ms()
        );

        parent_run.publish(AgentEvent::SubagentStarted {
            parent_tool_call_id: request.parent_tool_call_id.clone(),
            child_session_id: child_session_id.clone(),
            child_run_id: child_run_id.clone(),
            subagent_type: definition.subagent_type.as_str().to_string(),
            description: request.description.clone(),
        });

        let tool_count = Arc::new(AtomicU32::new(0));
        let last_progress = Arc::new(Mutex::new(Instant::now()));
        let project_sink: AgentEventSink = {
            let parent_run = parent_run.clone();
            let parent_tool_call_id = request.parent_tool_call_id.clone();
            let child_session_id = child_session_id.clone();
            let tool_count = Arc::clone(&tool_count);
            let last_progress = Arc::clone(&last_progress);
            Arc::new(move |envelope: AgentEventEnvelope| {
                if marks_subagent_progress(&envelope.event) {
                    if let Ok(mut guard) = last_progress.lock() {
                        *guard = Instant::now();
                    }
                }
                if let AgentEvent::ToolStarted { tool_name, .. } = &envelope.event {
                    let count = tool_count.fetch_add(1, Ordering::Relaxed) + 1;
                    parent_run.publish(AgentEvent::SubagentProgress {
                        parent_tool_call_id: parent_tool_call_id.clone(),
                        tool_count: count,
                        current_tool_name: tool_name.clone(),
                        elapsed_ms: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
                    });
                }
                parent_run.publish(AgentEvent::SubagentChildEvent {
                    parent_tool_call_id: parent_tool_call_id.clone(),
                    child_session_id: child_session_id.clone(),
                    event: Box::new(envelope.event),
                });
            })
        };

        let prompt_future = self.prompt(
            &child_session_id,
            &child_run_id,
            goal,
            Vec::new(),
            project_sink,
        );
        let wall = super::subagents::child_timeout_secs();
        let stall = super::subagents::child_stall_secs();
        let result = {
            tokio::pin!(prompt_future);
            loop {
                tokio::select! {
                    inner = &mut prompt_future => break inner,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {
                        let idle = last_progress
                            .lock()
                            .map(|guard| guard.elapsed())
                            .unwrap_or_default();
                        let stalled = stall.is_some_and(|limit| idle >= limit);
                        let wall_hit = wall.is_some_and(|limit| started.elapsed() >= limit);
                        if !stalled && !wall_hit {
                            continue;
                        }
                        let _ = self.abort(&child_run_id);
                        let count = tool_count.load(Ordering::Relaxed);
                        let message = if stalled {
                            let secs = stall.map(|d| d.as_secs()).unwrap_or(0);
                            format!(
                                "Subagent stalled for {secs}s with no tool/stream progress \
                                 after {count} tool call(s). Context may be too large; \
                                 narrow the task or raise GITEAM_SUBAGENT_STALL_SECS."
                            )
                        } else {
                            let secs = wall.map(|d| d.as_secs()).unwrap_or(0);
                            if count == 0 {
                                format!(
                                    "Subagent timed out after {secs}s without making progress \
                                     (no tool calls). Check provider connectivity or raise \
                                     GITEAM_SUBAGENT_TIMEOUT_SECS."
                                )
                            } else {
                                format!(
                                    "Subagent timed out after {secs}s after {count} tool call(s). \
                                     Raise GITEAM_SUBAGENT_TIMEOUT_SECS or narrow the task."
                                )
                            }
                        };
                        parent_run.publish(AgentEvent::SubagentFailed {
                            parent_tool_call_id: request.parent_tool_call_id.clone(),
                            child_session_id: child_session_id.clone(),
                            error: message.clone(),
                        });
                        return Err(PiAgentError::Sdk(message));
                    }
                }
            }
        };

        let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
        let count = tool_count.load(Ordering::Relaxed);

        match result {
            Ok(message) => {
                let summary = assistant_text_summary(&message);
                parent_run.publish(AgentEvent::SubagentCompleted {
                    parent_tool_call_id: request.parent_tool_call_id.clone(),
                    child_session_id: child_session_id.clone(),
                    summary: summary.clone(),
                    tool_count: count,
                    elapsed_ms,
                });
                Ok(SubagentSpawnResult {
                    child_session_id,
                    child_run_id,
                    summary,
                    tool_count: count,
                    elapsed_ms,
                })
            }
            Err(error) => {
                let message = error.to_string();
                let aborted = message.to_ascii_lowercase().contains("abort");
                if aborted {
                    parent_run.publish(AgentEvent::SubagentAborted {
                        parent_tool_call_id: request.parent_tool_call_id.clone(),
                        child_session_id: child_session_id.clone(),
                    });
                } else {
                    parent_run.publish(AgentEvent::SubagentFailed {
                        parent_tool_call_id: request.parent_tool_call_id.clone(),
                        child_session_id: child_session_id.clone(),
                        error: message.clone(),
                    });
                }
                Err(error)
            }
        }
    }

    /// 旁路语义抽取：ephemeral 无工具 session + 单次 prompt。
    /// 不进 catalog、不投影 subagent.*；slug 稳定靠 prompt 注入已有实体。
    fn resolve_extraction_parent_meta(
        &self,
        parent_session_id: &str,
        fallback: Option<&super::subagents::ExtractionCompletionFallback>,
    ) -> Result<
        (
            PathBuf,
            PathBuf,
            Option<String>,
            Option<String>,
            Option<String>,
        ),
        PiAgentError,
    > {
        let fb = fallback.filter(|f| !f.repo_path.trim().is_empty());
        let fb_has_provider = fb.is_some_and(|f| {
            f.provider.as_ref().is_some_and(|s| !s.trim().is_empty())
                && f.model.as_ref().is_some_and(|s| !s.trim().is_empty())
        });
        if fb_has_provider {
            let fb = fb.expect("checked");
            let repo_path = PathBuf::from(&fb.repo_path);
            let session_dir = crate::pi_agent::pi_sessions_dir_for_repo(&repo_path)
                .unwrap_or_else(|| {
                    std::env::temp_dir().join(format!("giteam-extract-{parent_session_id}"))
                });
            return Ok((
                repo_path,
                session_dir,
                fb.provider.clone(),
                fb.model.clone(),
                fb.thinking.clone(),
            ));
        }
        if let Ok(records) = self.records.lock() {
            if let Some(record) = records.get(parent_session_id) {
                return Ok((
                    record.repo_path.clone(),
                    record.session_dir.clone(),
                    (!record.provider.is_empty()).then_some(record.provider.clone()),
                    (!record.model.is_empty()).then_some(record.model.clone()),
                    record.thinking.clone(),
                ));
            }
        }
        if let Some(fb) = fb {
            let repo_path = PathBuf::from(&fb.repo_path);
            let session_dir = crate::pi_agent::pi_sessions_dir_for_repo(&repo_path)
                .unwrap_or_else(|| {
                    std::env::temp_dir().join(format!("giteam-extract-{parent_session_id}"))
                });
            let provider = fb.provider.clone().filter(|s| !s.trim().is_empty());
            let model = fb.model.clone().filter(|s| !s.trim().is_empty());
            return Ok((
                repo_path,
                session_dir,
                provider,
                model,
                fb.thinking.clone(),
            ));
        }
        Err(PiAgentError::SessionNotFound(parent_session_id.to_string()))
    }

    /// Stage-1 入队时快照父会话 provider/model/repo（父 session 销毁后仍可抽）。
    #[must_use]
    pub fn extraction_parent_snapshot(
        &self,
        parent_session_id: &str,
    ) -> Option<super::subagents::ExtractionCompletionFallback> {
        let record = self.records.lock().ok()?.get(parent_session_id).cloned()?;
        Some(super::subagents::ExtractionCompletionFallback {
            repo_path: record.repo_path.to_string_lossy().into_owned(),
            provider: (!record.provider.is_empty()).then_some(record.provider),
            model: (!record.model.is_empty()).then_some(record.model),
            thinking: record.thinking,
        })
    }

    pub async fn run_extraction_completion(
        &self,
        request: super::subagents::ExtractionCompletionRequest,
    ) -> Result<super::subagents::ExtractionCompletionResult, PiAgentError> {
        let started = Instant::now();
        ensure_agent_http_timeout();

        let extract_lock = self
            .extract_locks
            .lock()
            .ok()
            .map(|mut map| {
                Arc::clone(
                    map.entry(request.parent_session_id.clone())
                        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
                )
            })
            .unwrap_or_else(|| Arc::new(tokio::sync::Mutex::new(())));
        let _queue_guard = extract_lock.lock().await;

        let parent_meta = self.resolve_extraction_parent_meta(
            &request.parent_session_id,
            request.fallback.as_ref(),
        )?;
        let (repo_path, session_dir, provider, model, thinking) = parent_meta;

        let mut config = PiSessionConfig::persistent(repo_path.clone(), session_dir);
        config.no_session = true;
        config.session_path = None;
        config.provider = provider;
        config.model = model;
        config.thinking = thinking;
        config.enabled_tools = Some(Vec::new());
        config.max_tool_iterations = Some(1);
        config.system_prompt = Some(super::subagents::build_extract_system_prompt(Some(
            repo_path.to_string_lossy().as_ref(),
        )));
        config.append_system_prompt = None;
        config.parent_session_id = Some(request.parent_session_id.clone());
        config.parent_tool_call_id = Some(request.extraction_id.clone());
        config.session_kind = "subagent".to_string();

        let child = self.create_session(config).await?;
        let child_session_id = child.session_id.clone();
        crate::asset_graph::extraction::register_extract_session(&child_session_id);
        eprintln!(
            "[pi-agent] extract completion: parent {} → ephemeral {child_session_id}",
            request.parent_session_id
        );

        let child_run_id = format!(
            "extract-{}-{}",
            sanitize_run_id_fragment(&request.extraction_id),
            now_ms()
        );
        let last_progress = Arc::new(Mutex::new(Instant::now()));
        let sink: AgentEventSink = {
            let last_progress = Arc::clone(&last_progress);
            Arc::new(move |envelope: AgentEventEnvelope| {
                if marks_subagent_progress(&envelope.event) {
                    if let Ok(mut guard) = last_progress.lock() {
                        *guard = Instant::now();
                    }
                }
            })
        };

        let prompt_future = self.prompt(
            &child_session_id,
            &child_run_id,
            request.prompt.clone(),
            Vec::new(),
            sink,
        );
        let wall = super::subagents::extract_timeout_secs();
        let result = {
            tokio::pin!(prompt_future);
            loop {
                tokio::select! {
                    inner = &mut prompt_future => break inner,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {
                        let idle = last_progress
                            .lock()
                            .map(|guard| guard.elapsed())
                            .unwrap_or_default();
                        let stalled = idle >= Duration::from_secs(30);
                        let wall_hit = wall.is_some_and(|limit| started.elapsed() >= limit);
                        if !stalled && !wall_hit {
                            continue;
                        }
                        let _ = self.abort(&child_run_id);
                        let message = if stalled {
                            "Extraction completion stalled for 30s with no stream progress."
                                .to_string()
                        } else {
                            let secs = wall.map(|d| d.as_secs()).unwrap_or(0);
                            format!(
                                "Extraction completion timed out after {secs}s. \
                                 Raise GITEAM_EXTRACT_TIMEOUT_SECS if needed."
                            )
                        };
                        let _ = self.delete_session(&child_session_id);
                        return Err(PiAgentError::Sdk(message));
                    }
                }
            }
        };

        let elapsed_ms = started.elapsed().as_millis().try_into().unwrap_or(u64::MAX);
        let outcome = match result {
            Ok(message) => Ok(super::subagents::ExtractionCompletionResult {
                summary: assistant_text_summary(&message),
                elapsed_ms,
            }),
            Err(error) => Err(error),
        };
        let _ = self.delete_session(&child_session_id);
        outcome
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
            provider: (!record.provider.is_empty()).then_some(record.provider.clone()),
            model: (!record.model.is_empty()).then_some(record.model.clone()),
            api_key: None,
            // system_prompt 保持 None：品牌默认提示由 into_sdk_options 的
            // default_system_prompt(enabled_tools) 按当前 mode 重算。
            system_prompt: None,
            // 回填用户层模式覆盖：冷启动恢复与 set_session_options 重建共用此路径。
            append_system_prompt: record.append_system_prompt.clone(),
            enabled_tools: record.enabled_tools.clone(),
            extension_paths: Vec::new(),
            no_session: record.no_session,
            thinking: record.thinking.clone(),
            max_tool_iterations: record.max_tool_iterations,
            // controller 不可持久化：从 service 全局缓存取（desktop 启动注入 +
            // create_session 缓存），冷启动恢复 / 热切重建 handle 均复用，不再丢 controller。
            browser_controller: self.current_browser_controller(),
            parent_session_id: record.parent_session_id.clone(),
            parent_tool_call_id: record.parent_tool_call_id.clone(),
            session_kind: record.session_kind.clone(),
        };
        // 恢复 session 时凭据不落盘到 record，统一从 vault 现取注入。
        let config = self.with_secret_fallback(config)?;
        let hub = Arc::new(InteractionHub::new(Arc::clone(&self.interactions)));
        // 绑定仓库并加载项目级权限规则（.giteam/permissions.json），使持久化规则随会话生效。
        hub.set_repo_path(record.repo_path.clone());
        let mut handle = create_agent_session(sdk_options_with_factory(
            config,
            &hub,
            self.subagent_host_for(&record.session_kind),
        ))
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
        let pending_steers = Arc::new(Mutex::new(Vec::new()));
        register_steer_fetcher(&mut handle, &pending_steers);
        let managed = Arc::new(ManagedSession {
            repo_path: record.repo_path,
            handle: AsyncMutex::new(handle),
            hub,
            https_egress_provider: Mutex::new(None),
            sanitized_provider: Mutex::new(None),
            message_snapshot: Arc::new(Mutex::new(Vec::new())),
            pending_steers,
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

    /// 外部进程（CLI 控制服务）可能并发新建/更新会话。这里做原子读取并
    /// 合并到内存，保证 desktop/手机端运行中也能看到新会话。
    pub fn refresh_sessions_from_catalog(&self) -> Result<bool, PiAgentError> {
        let Some(path) = self.catalog_path.as_ref() else {
            return Ok(false);
        };
        let disk_records = load_catalog_records(Some(path));
        let mut records = self
            .records
            .lock()
            .map_err(|error| PiAgentError::State(error.to_string()))?;
        let mut dirty = false;
        for (session_id, disk) in disk_records {
            match records.get_mut(&session_id) {
                Some(existing) => {
                    if existing.updated_at_ms < disk.updated_at_ms {
                        *existing = disk;
                        dirty = true;
                    }
                }
                None => {
                    records.insert(session_id, disk);
                    dirty = true;
                }
            }
        }
        if dirty {
            let mut values: Vec<_> = records.values().cloned().collect();
            values.sort_by(|left, right| left.session_id.cmp(&right.session_id));
            let payload = serde_json::to_vec_pretty(&values)
                .map_err(|error| PiAgentError::Persistence(error.to_string()))?;
            let tmp = path.with_extension("json.tmp");
            fs::write(&tmp, payload).map_err(|error| PiAgentError::Persistence(error.to_string()))?;
            fs::rename(&tmp, path).map_err(|error| PiAgentError::Persistence(error.to_string()))?;
        }
        Ok(dirty)
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

    /// 给 SSE 重连留窗口后再清环形缓冲（runId 为 UUID，不会与新 run 冲突）。
    fn schedule_clear_event_buffer(&self, session_id: &str, run_id: &str) {
        let buffers = Arc::clone(&self.event_buffers);
        let session_id = session_id.to_string();
        let run_id = run_id.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(EVENT_BUFFER_RETAIN_SECS));
            super::events::clear_event_buffer(&buffers, &session_id, &run_id);
        });
    }
}

/// SSE 终态后保留 ring 的秒数，覆盖 soft-reconnect / 弱网补洞窗口。
const EVENT_BUFFER_RETAIN_SECS: u64 = 120;

fn next_event_sequence(
    buffers: &super::events::EventBufferBus,
    session_id: &str,
    run_id: &str,
) -> u64 {
    let key = (session_id.to_string(), run_id.to_string());
    buffers
        .lock()
        .ok()
        .and_then(|buffers| buffers.get(&key).and_then(|buf| buf.last_sequence()))
        .map(|seq| seq.saturating_add(1))
        .unwrap_or(1)
}

fn publish_event(
    subscribers: &Arc<Mutex<HashMap<EventSubscriberKey, Vec<Sender<AgentEventEnvelope>>>>>,
    buffers: &super::events::EventBufferBus,
    event: &AgentEventEnvelope,
) {
    super::events::publish_event(subscribers, buffers, event);
}

/// 入队一条 steer（FIFO）。上限对齐 pi `MAX_STEERING_QUEUE_SIZE`（16）：
/// 打满丢最旧，保序不无界。返回该消息的排队位次（从 1 计）。
fn push_pending_steer(queue: &mut Vec<String>, message: &str) -> u32 {
    const MAX_PENDING_STEERS: usize = 16;
    if queue.len() >= MAX_PENDING_STEERS {
        queue.remove(0);
    }
    queue.push(message.to_string());
    u32::try_from(queue.len()).unwrap_or(u32::MAX)
}

/// 一次性取出队首一条 steer 并转为 pi 消息。
/// 对齐 Codex `maybe_send_next_queued_input`：当前回合结束后只开下一条，
/// 而不是把队列一次倒空。锁中毒时返回空——本轮不注入，留给下一个边界。
fn drain_pending_steers(queue: &Arc<Mutex<Vec<String>>>) -> Vec<pi::sdk::Message> {
    let text = queue
        .lock()
        .ok()
        .and_then(|mut queue| {
            if queue.is_empty() {
                None
            } else {
                Some(queue.remove(0))
            }
        });
    let Some(text) = text else {
        return Vec::new();
    };
    let timestamp = i64::try_from(now_ms()).unwrap_or(0);
    vec![
        pi::sdk::Message::User(pi::sdk::UserMessage {
            content: pi::sdk::UserContent::Text(text),
            timestamp,
        }),
        pi::sdk::Message::Custom(pi::sdk::CustomMessage {
            content: STEER_CONTINUE_HINT.to_string(),
            custom_type: "giteam.steer_continue".to_string(),
            display: false,
            details: None,
            timestamp,
        }),
    ]
}

/// 插话续跑提示：不进 UI（Custom display=false），只进模型上下文。
const STEER_CONTINUE_HINT: &str = "\
The user sent a follow-up after the previous reply finished. Answer this follow-up now. \
If an earlier user question in this run still lacks a complete answer, finish that first.";

/// 把 steer 队列注册为 pi 的 **follow_up** fetcher。
///
/// 注意：官方 TS SDK（pi-mono）的 `session.steer()` 会等当前回合工具全部跑完再注入；
/// 当前依赖的 pi_agent_rust 仍会在 steering 路径跳过未执行工具。桌面插话因此改为
/// 「本地队列 + 本轮 prompt 结束后再开下一次 prompt」，不再依赖本 fetcher。
/// 手机等仍调用 `steer()` 的端可继续用 follow_up 注入同一 run。
fn register_steer_fetcher(handle: &mut AgentSessionHandle, queue: &Arc<Mutex<Vec<String>>>) {
    let queue = Arc::clone(queue);
    let fetcher: pi::agent::MessageFetcher = Arc::new(move || {
        let queue = Arc::clone(&queue);
        Box::pin(async move { drain_pending_steers(&queue) })
    });
    handle
        .session_mut()
        .agent
        // steering=None, follow_up=Some —— 见上方注释。
        .register_message_fetchers(None, Some(fetcher));
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
/// 并按 enabled_tools 决定是否追加 question/task 等工具。
/// 后台任务日志落在会话目录 background-tasks/ 下；no_session 模式传 None
/// （registry 回落到临时目录），避免向磁盘写会话侧产物。
fn sdk_options_with_factory(
    config: PiSessionConfig,
    hub: &Arc<InteractionHub>,
    subagent_host: Option<Arc<dyn SubagentHost>>,
) -> pi::sdk::SessionOptions {
    let background_log_dir = (!config.no_session).then(|| config.session_dir.clone());
    let browser_controller = config.browser_controller.clone();
    let spill_dir = (!config.no_session).then(|| config.session_dir.join("tool-outputs"));
    let tool_budget = if config.session_kind == "subagent" {
        super::tools::ToolBudgetConfig::for_subagent(spill_dir)
    } else {
        super::tools::ToolBudgetConfig::for_primary(spill_dir)
    };
    let factory = GiteamToolFactory::new(
        Arc::clone(hub),
        config.enabled_tools.as_deref(),
        background_log_dir,
        browser_controller,
        subagent_host,
        tool_budget,
    );
    let mut options = config.into_sdk_options();
    options.tool_factory = Some(Arc::new(factory));
    options
}

struct ServiceSubagentHost {
    weak: Weak<PiAgentService>,
}

#[async_trait]
impl SubagentHost for ServiceSubagentHost {
    async fn run_subagent(
        &self,
        request: SubagentSpawnRequest,
    ) -> Result<SubagentSpawnResult, String> {
        let service = self
            .weak
            .upgrade()
            .ok_or_else(|| "agent service dropped".to_string())?;
        service
            .run_subagent(request)
            .await
            .map_err(|error| error.to_string())
    }

    async fn run_extraction_completion(
        &self,
        request: super::subagents::ExtractionCompletionRequest,
    ) -> Result<super::subagents::ExtractionCompletionResult, String> {
        let service = self
            .weak
            .upgrade()
            .ok_or_else(|| "agent service dropped".to_string())?;
        service
            .run_extraction_completion(request)
            .await
            .map_err(|error| error.to_string())
    }

    fn memory_extraction_publisher(
        &self,
        parent_session_id: &str,
        extraction_id: &str,
    ) -> Option<super::subagents::MemoryExtractionPublisher> {
        let service = self.weak.upgrade()?;
        let session = {
            let sessions = service.sessions.lock().ok()?;
            sessions.get(parent_session_id).cloned()
        }?;
        let context = session.hub.run_context()?;
        Some(super::subagents::MemoryExtractionPublisher::new(
            context,
            extraction_id,
        ))
    }

    fn extraction_parent_snapshot(
        &self,
        parent_session_id: &str,
    ) -> Option<super::subagents::ExtractionCompletionFallback> {
        let service = self.weak.upgrade()?;
        service.extraction_parent_snapshot(parent_session_id)
    }
}

fn assistant_text_summary(message: &AgentMessage) -> String {
    let text = message
        .parts
        .iter()
        .filter_map(|part| match part {
            AgentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if text.is_empty() {
        "(subagent finished with no text summary)".to_string()
    } else {
        text
    }
}

/// 子 agent stall 监视：工具执行或流式输出都算有进展；纯静默（常见于大上下文 LLM 挂起）不算。
fn marks_subagent_progress(event: &AgentEvent) -> bool {
    matches!(
        event,
        AgentEvent::ToolStarted { .. }
            | AgentEvent::ToolCompleted { .. }
            | AgentEvent::ToolProgress { .. }
            | AgentEvent::ToolCallStarted { .. }
            | AgentEvent::ToolCallDelta { .. }
            | AgentEvent::MessageStarted { .. }
            | AgentEvent::MessageDelta { .. }
            | AgentEvent::MessageCompleted { .. }
            | AgentEvent::ReasoningDelta { .. }
            | AgentEvent::TurnStarted { .. }
            | AgentEvent::TurnCompleted { .. }
            | AgentEvent::Compaction { .. }
            | AgentEvent::Retry { .. }
            | AgentEvent::InteractionRequested { .. }
            | AgentEvent::InteractionResolved { .. }
    )
}

/// Pi 云端默认整请求超时 60s，对子 agent 调研不够。未显式配置环境变量时抬到 30 分钟。
fn ensure_agent_http_timeout() {
    if std::env::var_os(pi::http::client::REQUEST_TIMEOUT_ENV).is_none() {
        pi::http::client::set_request_timeout_override(1800);
    }
}

fn sanitize_run_id_fragment(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "call".to_string()
    } else {
        cleaned.chars().take(48).collect()
    }
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

/// 限额/计费类错误判定（对照 Codex `usage_limit_reached` 不重试的取向）。
///
/// pi 的 `is_retryable_error` 把 `429`/`rate limit` 一律判可重试；但限额类
/// （余额不足、配额用尽、免费额度耗尽）重试 10 次毫无意义——充值前不会
/// 自愈。此处在 giteam 重试判定前短路：命中付费语义即终止并把 provider
/// 原文案透出给用户。模式只收明确付费语义（balance/欠费/usage limit/
/// exceeded your quota/额度不足等），纯 "rate limit"（瞬时限流）不在此列
/// ——那类应当继续退避重试。
fn is_quota_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    // "quota exceeded" 文案有歧义：无 retry 提示的是硬限额（OpenRouter 等）；
    // 带 retry/later 字样的是瞬时限流（阿里云 RPM 类），应继续走重试。
    if lower.contains("quota exceeded") || lower.contains("quota_exceeded") {
        return !lower.contains("retry") && !lower.contains("later");
    }
    // 付费语义锚点（中英文常见措辞，含连写形态如阿里云 AccountNoEnoughBalance）。
    const QUOTA_PATTERNS: &[&str] = &[
        "insufficient balance",
        "balance is not enough",
        "no enough balance",
        "accountnoenoughbalance",
        "余额不足",
        "账户余额",
        "欠费",
        "usage limit",
        "usage_limit",
        "exceeded your current quota",
        "exceeded your quota",
        "quota has been exhausted",
        "免费额度",
        "额度不足",
        "额度已用",
        "额度耗尽",
        "arrearage",
        "payment required",
        "402 payment",
        "please upgrade your plan",
        "billing hard limit",
        "spend limit reached",
    ];
    QUOTA_PATTERNS.iter().any(|pattern| lower.contains(pattern))
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

/// provider 拒收图片的常见错误措辞（OpenAI/Anthropic/各兼容网关）。
/// 仅用于乐观直传图片失败后的降级判断——去图用纯文本重试，避免报错中断 agent。
/// 关键词宽松（含 image/multimodal/vision/modality + 不支持/无效等）：误判仅多一次无图重试，
/// 去图后若仍失败则按原错误正常上报，无害。
fn is_image_unsupported_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let mentions_image = lower.contains("image")
        || lower.contains("multimodal")
        || lower.contains("vision")
        || lower.contains("modality");
    if !mentions_image {
        return false;
    }
    lower.contains("unsupported")
        || lower.contains("not support")
        || lower.contains("does not support")
        || lower.contains("not allowed")
        || lower.contains("invalid")
        || lower.contains("unable")
        || lower.contains("not enabled")
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

/// 从 AgentMessage 快照派生标题（busy 列表兜底，不碰 handle）。
fn derive_agent_session_title(messages: &[AgentMessage]) -> Option<String> {
    const TITLE_MAX_CHARS: usize = 60;
    for message in messages {
        if message.role != AgentRole::User {
            continue;
        }
        let text = message
            .parts
            .iter()
            .find_map(|part| match part {
                AgentPart::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .unwrap_or("");
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
    use super::{derive_agent_session_title, derive_session_title};
    use crate::pi_agent::{AgentMessage, AgentPart, AgentRole};

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
    fn agent_snapshot_title_matches_pi_title() {
        let messages = vec![AgentMessage {
            id: "u1".to_string(),
            role: AgentRole::User,
            created_at_ms: 1,
            parts: vec![AgentPart::Text {
                text: "  帮我\n审查一下   最近的改动 ".to_string(),
            }],
        }];
        assert_eq!(
            derive_agent_session_title(&messages).as_deref(),
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

/// 把 catalog 中仍指向 `<repo>/.giteam/pi-sessions` 的记录迁到
/// `~/.giteam/pi-sessions/repos/<key>/`（幂等）。返回是否改写了任何记录。
fn migrate_repo_session_paths(records: &mut HashMap<String, PersistedSessionRecord>) -> bool {
    let mut dirty = false;
    for record in records.values_mut() {
        if record.no_session {
            continue;
        }
        let Some(new_dir) = super::pi_sessions_dir_for_repo(&record.repo_path) else {
            continue;
        };
        let remapped_dir =
            super::remap_legacy_session_path(&record.repo_path, &record.session_dir);
        let remapped_path =
            super::remap_legacy_session_path(&record.repo_path, &record.session_path);
        if remapped_dir.is_none() && remapped_path.is_none() {
            continue;
        }
        if fs::create_dir_all(&new_dir).is_err() {
            continue;
        }
        super::secrets::write_repo_sessions_meta(&new_dir, &record.repo_path);

        let target_path = remapped_path.unwrap_or_else(|| {
            let name = record
                .session_path
                .file_name()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("session.jsonl"));
            new_dir.join(name)
        });
        if record.session_path != target_path {
            let _ = super::migrate_session_file_bundle(&record.session_path, &target_path);
            record.session_path = target_path;
            dirty = true;
        }
        if record.session_dir != new_dir {
            record.session_dir = new_dir;
            dirty = true;
        }
    }
    dirty
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
    fn steer_idle_when_session_exists_but_no_active_run() {
        // 无活跃 run：调用方应改走普通 prompt，不能假排队。
        let root = std::env::temp_dir().join(format!(
            "giteam-pi-steer-idle-{}-{}",
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

        assert!(
            matches!(
                service.steer(&summary.session_id, "mid-turn note"),
                Ok(SteerOutcome::Idle)
            ),
            "no active run must return Idle"
        );
        assert!(
            matches!(
                service.steer(&summary.session_id, "   "),
                Err(PiAgentError::Sdk(_))
            ),
            "empty steer must fail closed"
        );
        assert!(
            matches!(
                service.steer("missing-session", "x"),
                Err(PiAgentError::SessionNotFound(_))
            ),
            "unknown session must 404-equivalent"
        );

        service.shutdown();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn steer_queue_is_fifo_with_cap_dropping_oldest() {
        // FIFO 投递顺序 + 上限淘汰最旧（giteam 侧 cap=16；pi 内部队列另有上限）。
        let queue = Arc::new(Mutex::new(Vec::new()));
        assert_eq!(
            push_pending_steer(queue.lock().unwrap().as_mut(), "first"),
            1
        );
        assert_eq!(
            push_pending_steer(queue.lock().unwrap().as_mut(), "second"),
            2
        );
        let steer_texts = |messages: &[pi::sdk::Message]| -> Vec<String> {
            messages
                .iter()
                .filter_map(|message| match message {
                    pi::sdk::Message::User(user) => match &user.content {
                        pi::sdk::UserContent::Text(text) => Some(text.clone()),
                        pi::sdk::UserContent::Blocks(_) => Some(String::new()),
                    },
                    _ => None,
                })
                .collect()
        };
        let drained = drain_pending_steers(&queue);
        assert_eq!(steer_texts(&drained), vec!["first"]);
        assert!(
            drained.iter().any(|message| matches!(
                message,
                pi::sdk::Message::Custom(custom)
                    if custom.custom_type == "giteam.steer_continue" && !custom.display
            )),
            "drain must attach a non-display steer-continue hint for the model"
        );
        let drained_second = drain_pending_steers(&queue);
        assert_eq!(steer_texts(&drained_second), vec!["second"]);
        assert!(drain_pending_steers(&queue).is_empty());

        for index in 0..20 {
            push_pending_steer(queue.lock().unwrap().as_mut(), &format!("m{index}"));
        }
        assert_eq!(queue.lock().unwrap().len(), 16, "cap should drop oldest");
        let drained = drain_pending_steers(&queue);
        let texts = steer_texts(&drained);
        assert_eq!(texts, vec!["m4"]);
        assert!(
            drained.iter().any(|message| matches!(message, pi::sdk::Message::Custom(_))),
            "cap drain still attaches continue hint"
        );
    }

    #[test]
    fn quota_errors_are_recognized_across_providers() {
        // 限额/计费语义（中英文、连写形态）都不该进入重试循环。
        for message in [
            "402 Insufficient Balance",
            "429: exceeded your current quota, please upgrade",
            "Error: 账户余额不足，请充值",
            "AccountNoEnoughBalance",
            "usage limit reached (resets at 2026-08-18)",
            "您的人工智能免费额度已用完",
            "Rate limit 429 quota exceeded for requests",
        ] {
            assert!(is_quota_error(message), "should classify as quota: {message}");
        }
        // 瞬时限流与常规错误不属于限额——应继续走重试判定。
        for message in [
            "429 too many requests, retry after 30s",
            "503 service overloaded",
            "connection reset by peer",
            "context window exceeded",
        ] {
            assert!(!is_quota_error(message), "not quota: {message}");
        }
    }

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

        publish_event(&service.subscribers, &service.event_buffers, &event);

        assert_eq!(
            receiver
                .recv_timeout(Duration::from_millis(50))
                .expect("matching subscriber should receive event"),
            event
        );
    }

    #[test]
    fn event_buffer_replays_events_after_seq() {
        let service = PiAgentService::new();
        let make = |sequence: u64| AgentEventEnvelope {
            schema_version: AGENT_EVENT_SCHEMA_VERSION,
            event_id: format!("event-{sequence}"),
            sequence,
            repo_path: "/tmp/repo".to_string(),
            session_id: "session-1".to_string(),
            run_id: Some("run-1".to_string()),
            timestamp_ms: sequence,
            event: AgentEvent::RuntimeWarning {
                message: format!("w{sequence}"),
            },
        };
        publish_event(&service.subscribers, &service.event_buffers, &make(1));
        publish_event(&service.subscribers, &service.event_buffers, &make(2));
        publish_event(&service.subscribers, &service.event_buffers, &make(3));

        let (replay, _live) = service.subscribe_events_after("session-1", "run-1", 1);
        assert_eq!(
            replay.iter().map(|e| e.sequence).collect::<Vec<_>>(),
            vec![2, 3]
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
            enabled_tools: None,
            append_system_prompt: None,
            thinking: None,
            max_tool_iterations: None,
            session_kind: "primary".to_string(),
            parent_session_id: None,
            parent_tool_call_id: None,
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
            session_kind: "primary".to_string(),
            parent_session_id: None,
            parent_tool_call_id: None,
        };
        let value = serde_json::to_value(summary).expect("serialize summary");
        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["repoPath"], "/tmp/repo");
        assert_eq!(value["messageCount"], 2);
        assert_eq!(value["updatedAtMs"], 1_700_000_000_000_u64);
        assert_eq!(value["title"], "审查改动");
        assert_eq!(value["sessionKind"], "primary");
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

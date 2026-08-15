//! 权限/提问交互状态机（PR6）。
//!
//! 工具执行前登记 pending interaction 并阻塞等待用户裁决；裁决通过
//! `reply` 进入（Desktop Tauri / Control HTTP 共用），首个有效回复胜出。
//! timeout / abort / shutdown 都会以自动拒绝收尾，保证等待中的工具
//! future 永不悬挂。审计事件（interaction.requested/resolved）只携带
//! 脱敏后的输入与裁决结果，不记录敏感参数。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::channel::oneshot;
use serde_json::Value;

use super::events::{publish_event, AgentEvent, EventBufferBus, EventSubscriberBus, PiEventTranslator};
use super::service::AgentEventSink;
use super::types::{AgentInteraction, AgentInteractionReply};

/// 审批默认超时：超时自动拒绝（不得静默放行写/执行类操作）。
pub const DEFAULT_INTERACTION_TIMEOUT: Duration = Duration::from_secs(300);

/// 当前 run 的发布上下文：interaction 事件与 pi 事件共用 translator 的
/// sequence 计数器，经 sink（Desktop）与 subscribers bus（Control SSE）双通道下发。
#[derive(Clone)]
pub struct InteractionRunContext {
    pub session_id: String,
    pub run_id: String,
    pub translator: Arc<PiEventTranslator>,
    pub sink: AgentEventSink,
    pub subscribers: EventSubscriberBus,
    pub event_buffers: EventBufferBus,
}

impl InteractionRunContext {
    pub fn publish(&self, event: AgentEvent) {
        let envelope = self.translator.envelope(event);
        publish_event(&self.subscribers, &self.event_buffers, &envelope);
        (self.sink)(envelope);
    }
}

/// 工具风险分级。read 直通；write/execute/network 一律先审批。
/// 未知工具按 write 处理（fail-closed）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteractionRisk {
    Read,
    Write,
    Execute,
    /// 网络访问（web_fetch/web_search）：抓取外部数据进 context，首次审批、
    /// 按 `always_rule_key` 域名/后端粒度放行（见 `.giteam/permissions.json`）。
    Network,
}

impl InteractionRisk {
    #[must_use]
    pub fn for_tool(tool: &str) -> Self {
        match tool {
            // task：启动子 session 本身不写盘（子内写操作仍走 Approval）。
            "read" | "grep" | "find" | "ls" | "bash_output" | "task" | "todowrite"
            | "question" => Self::Read,
            "bash" | "kill_shell" => Self::Execute,
            "web_fetch" | "web_search" | "browser_use" => Self::Network,
            _ => Self::Write,
        }
    }

    #[must_use]
    pub const fn requires_approval(self) -> bool {
        !matches!(self, Self::Read)
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::Execute => "execute",
            Self::Network => "network",
        }
    }
}

/// 细粒度规则键（审计/调试用）：bash 绑命令，写类绑路径，其余为工具名。
/// 用户点「总是允许」时会话策略记的是工具名（见 `remember_always`），
/// 否则同任务里每次不同命令/路径都会反复弹窗。
#[must_use]
pub fn always_rule_key(tool: &str, input: &Value) -> String {
    let target: Option<String> = match tool {
        "bash" => input.get("command").and_then(Value::as_str).map(str::to_string),
        // web_fetch 按域名粒度：同站点一次「总是允许」覆盖后续页面。
        "web_fetch" => input.get("url").and_then(Value::as_str).and_then(url_host),
        // web_search 按后端粒度：搜索无固定目标，同一后端一次放行后续查询。
        "web_search" => Some(web_search_backend()),
        // browser_use 按域名粒度：navigate 有 url 时同站点一次放行后续操作；
        // click/type 等无 url 的操作退化为工具名粒度（同会话内 always 放行）。
        "browser_use" => input.get("url").and_then(Value::as_str).and_then(url_host),
        _ => input.get("path").and_then(Value::as_str).map(str::to_string),
    };
    match target.filter(|target| !target.is_empty()) {
        Some(target) => format!("{tool}:{target}"),
        None => tool.to_string(),
    }
}

/// 当前 web_search 后端（默认 duckduckgo；可经 `GITEAM_WEB_SEARCH_BACKEND` 覆盖）。
#[must_use]
pub fn web_search_backend() -> String {
    std::env::var("GITEAM_WEB_SEARCH_BACKEND").unwrap_or_else(|_| "duckduckgo".to_string())
}

/// 极简 URL host 提取（审批键用；只取主机名小写化，忽略端口/路径）。
fn url_host(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let host = after_scheme.split(['/', ':', '?', '#']).next()?;
    let host = host.trim();
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

#[derive(Default)]
struct ApprovalPolicy {
    /// 显式配置的自动接受（默认关；审计事件照常发布）。
    auto_approve: bool,
    /// session 级 always 规则：通常为工具名（「总是允许」）；亦兼容旧的细粒度键。
    always_rules: Vec<String>,
}

/// 单个 session 的交互枢纽：持有当前 run 上下文与审批策略。
/// 工具（ApprovalTool/QuestionTool）只依赖 hub，不接触 service。
pub struct InteractionHub {
    store: Arc<InteractionStore>,
    run: Mutex<Option<InteractionRunContext>>,
    policy: Mutex<ApprovalPolicy>,
    /// 本会话被 read 工具读取过的文件（canonicalize 后），EditGuardTool 据此放行 edit。
    read_files: Mutex<HashSet<PathBuf>>,
    /// 会话所在仓库（绑定后加载/写入 `.giteam/permissions.json`）；None 时持久化规则不可用。
    repo_path: Mutex<Option<PathBuf>>,
}

impl InteractionHub {
    #[must_use]
    pub fn new(store: Arc<InteractionStore>) -> Self {
        Self {
            store,
            run: Mutex::new(None),
            policy: Mutex::new(ApprovalPolicy::default()),
            read_files: Mutex::new(HashSet::new()),
            repo_path: Mutex::new(None),
        }
    }

    pub fn start_run(&self, context: InteractionRunContext) {
        if let Ok(mut run) = self.run.lock() {
            *run = Some(context);
        }
    }

    pub fn end_run(&self, run_id: &str) {
        if let Ok(mut run) = self.run.lock() {
            if run.as_ref().is_some_and(|context| context.run_id == run_id) {
                *run = None;
            }
        }
    }

    #[must_use]
    pub fn run_context(&self) -> Option<InteractionRunContext> {
        self.run.lock().ok().and_then(|run| run.clone())
    }

    pub fn set_auto_approve(&self, enabled: bool) {
        if let Ok(mut policy) = self.policy.lock() {
            policy.auto_approve = enabled;
        }
    }

    /// 快路径：显式自动接受，或命中 session 级 always 规则。
    #[must_use]
    pub fn is_allowed(&self, tool: &str, input: &Value) -> bool {
        let Ok(policy) = self.policy.lock() else {
            return false;
        };
        if policy.auto_approve {
            return true;
        }
        let key = always_rule_key(tool, input);
        policy
            .always_rules
            .iter()
            .any(|rule| rule == &key || rule == tool)
    }

    pub fn remember_always(&self, tool: &str, _input: &Value) {
        // 会话内按工具放行：一次「总是允许 bash」覆盖后续不同命令，避免同任务反复弹窗。
        if let Ok(mut policy) = self.policy.lock() {
            if !policy.always_rules.contains(&tool.to_string()) {
                policy.always_rules.push(tool.to_string());
            }
        }
    }

    /// 绑定会话所在仓库并加载项目级权限规则（`.giteam/permissions.json`）。
    /// service 创建/恢复 hub 后调用一次，使持久化规则随会话生效（跨重启）。
    pub fn set_repo_path(&self, repo_path: PathBuf) {
        let rules = super::permissions::load_allow_rules(&repo_path);
        if let Ok(mut policy) = self.policy.lock() {
            for rule in rules {
                if !policy.always_rules.contains(&rule) {
                    policy.always_rules.push(rule);
                }
            }
        }
        if let Ok(mut path) = self.repo_path.lock() {
            *path = Some(repo_path);
        }
    }

    /// 把「总是允许」的细粒度规则持久化到项目文件（跨会话/重启再生效）。
    /// 持久化失败仅记录、不影响本次执行（审批已通过，下次失败再弹窗）。
    pub fn persist_allow(&self, tool: &str, input: &Value) {
        let key = always_rule_key(tool, input);
        let Some(repo_path) = self.repo_path.lock().ok().and_then(|path| path.clone()) else {
            return;
        };
        if let Err(error) = super::permissions::append_allow_rule(&repo_path, &key) {
            eprintln!("giteam: persist allow rule failed ({key}): {error}");
        }
    }

    #[must_use]
    pub fn store(&self) -> &Arc<InteractionStore> {
        &self.store
    }

    /// 登记 read 工具成功读取过的文件（ReadRecorderTool 调用）。
    pub fn mark_read(&self, path: PathBuf) {
        let key = canonicalize_path_key(&path);
        if let Ok(mut read_files) = self.read_files.lock() {
            read_files.insert(key);
        }
    }

    /// 该文件是否在本会话被 read 过（EditGuardTool 校验）。
    #[must_use]
    pub fn was_read(&self, path: &Path) -> bool {
        let key = canonicalize_path_key(path);
        self.read_files
            .lock()
            .map_or(false, |read_files| read_files.contains(&key))
    }
}

/// 规范化路径键：canonicalize 失败（文件不存在等）则回退原样，保证登记与查询一致。
fn canonicalize_path_key(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// 工具侧收到的裁决结果。Reply 为用户显式回复；
/// 其余为系统自动收尾（一律视为拒绝）。
pub enum InteractionResolution {
    Reply(AgentInteractionReply),
    Timeout,
    Aborted,
    Shutdown,
}

struct PendingInteraction {
    interaction: AgentInteraction,
    context: InteractionRunContext,
    sender: oneshot::Sender<InteractionResolution>,
}

/// 服务级 pending 注册表。ID 为不可预测随机值（uuid v4），
/// pending 绑定 session/run/tool call；map 原子移除保证首个回复胜出。
#[derive(Default)]
pub struct InteractionStore {
    pending: Mutex<HashMap<String, PendingInteraction>>,
}

impl InteractionStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 登记 pending，发布 requested 事件，阻塞等待回复/超时。
    /// 超时由独立 watchdog 线程触发，不依赖调用方的 async runtime。
    pub async fn request(
        self: &Arc<Self>,
        interaction: AgentInteraction,
        context: &InteractionRunContext,
        timeout: Duration,
    ) -> InteractionResolution {
        let id = interaction.id().to_string();
        let (sender, receiver) = oneshot::channel();
        {
            let Ok(mut pending) = self.pending.lock() else {
                return InteractionResolution::Shutdown;
            };
            pending.insert(
                id.clone(),
                PendingInteraction {
                    interaction: interaction.clone(),
                    context: context.clone(),
                    sender,
                },
            );
        }
        context.publish(AgentEvent::InteractionRequested { interaction });

        let watchdog = Arc::clone(self);
        let watchdog_id = id.clone();
        thread::spawn(move || {
            thread::sleep(timeout);
            watchdog.expire(&watchdog_id);
        });

        receiver.await.unwrap_or(InteractionResolution::Shutdown)
    }

    /// 客户端回复入口（Tauri/Control 共用）。种类不匹配或已 resolved 报错。
    pub fn reply(&self, id: &str, reply: AgentInteractionReply) -> Result<(), String> {
        {
            let pending = self.pending.lock().map_err(|error| error.to_string())?;
            let Some(entry) = pending.get(id) else {
                return Err(format!("interaction not found or already resolved: {id}"));
            };
            let matches = match (&entry.interaction, &reply) {
                (
                    AgentInteraction::Permission { .. },
                    AgentInteractionReply::Once
                    | AgentInteractionReply::Always
                    | AgentInteractionReply::Reject,
                )
                | (
                    AgentInteraction::Question { .. },
                    AgentInteractionReply::Answers { .. } | AgentInteractionReply::Cancel,
                ) => true,
                _ => false,
            };
            if !matches {
                return Err(format!("reply kind does not match interaction: {id}"));
            }
        }
        let Some(pending) = self.take_pending(id) else {
            return Err(format!("interaction not found or already resolved: {id}"));
        };
        let resolution = match &reply {
            AgentInteractionReply::Once => "once",
            AgentInteractionReply::Always => "always",
            AgentInteractionReply::Reject => "reject",
            AgentInteractionReply::Answers { .. } => "answers",
            AgentInteractionReply::Cancel => "cancel",
        };
        let _ = pending.sender.send(InteractionResolution::Reply(reply));
        pending.context.publish(AgentEvent::InteractionResolved {
            id: id.to_string(),
            resolution: resolution.to_string(),
            automatic: false,
        });
        Ok(())
    }

    #[must_use]
    pub fn list_pending(&self, session_id: Option<&str>) -> Vec<AgentInteraction> {
        self.pending.lock().map_or_else(|_| Vec::new(), |pending| {
            pending
                .values()
                .filter(|entry| {
                    session_id.is_none_or(|session_id| {
                        interaction_session_id(&entry.interaction) == session_id
                    })
                })
                .map(|entry| entry.interaction.clone())
                .collect()
        })
    }

    /// 拒绝指定 run 的全部 pending（abort / run 结束时释放等待中的工具 future）。
    pub fn reject_run(&self, session_id: &str, run_id: &str, resolution: &str) {
        let ids: Vec<String> = self.pending.lock().map_or_else(|_| Vec::new(), |pending| {
            pending
                .iter()
                .filter(|(_, entry)| {
                    interaction_session_id(&entry.interaction) == session_id
                        && entry.context.run_id == run_id
                })
                .map(|(id, _)| id.clone())
                .collect()
        });
        for id in ids {
            if let Some(pending) = self.take_pending(&id) {
                let _ = pending.sender.send(InteractionResolution::Aborted);
                pending.context.publish(AgentEvent::InteractionResolved {
                    id,
                    resolution: resolution.to_string(),
                    automatic: true,
                });
            }
        }
    }

    /// 拒绝指定 session 的全部 pending（删除会话时）。
    pub fn reject_session(&self, session_id: &str, resolution: &str) {
        let ids: Vec<String> = self.pending.lock().map_or_else(|_| Vec::new(), |pending| {
            pending
                .iter()
                .filter(|(_, entry)| interaction_session_id(&entry.interaction) == session_id)
                .map(|(id, _)| id.clone())
                .collect()
        });
        for id in ids {
            if let Some(pending) = self.take_pending(&id) {
                let _ = pending.sender.send(InteractionResolution::Aborted);
                pending.context.publish(AgentEvent::InteractionResolved {
                    id,
                    resolution: resolution.to_string(),
                    automatic: true,
                });
            }
        }
    }

    /// 服务关闭：拒绝全部 pending，释放所有等待中的工具 future。
    pub fn reject_all(&self, resolution: &str) {
        let ids: Vec<String> = self
            .pending
            .lock()
            .map_or_else(|_| Vec::new(), |pending| pending.keys().cloned().collect());
        for id in ids {
            if let Some(pending) = self.take_pending(&id) {
                let _ = pending.sender.send(InteractionResolution::Shutdown);
                pending.context.publish(AgentEvent::InteractionResolved {
                    id,
                    resolution: resolution.to_string(),
                    automatic: true,
                });
            }
        }
    }

    /// watchdog 超时入口：pending 仍在则按自动拒绝收尾。
    fn expire(&self, id: &str) {
        if let Some(pending) = self.take_pending(id) {
            let _ = pending.sender.send(InteractionResolution::Timeout);
            pending.context.publish(AgentEvent::InteractionResolved {
                id: id.to_string(),
                resolution: "timeout".to_string(),
                automatic: true,
            });
        }
    }

    fn take_pending(&self, id: &str) -> Option<PendingInteraction> {
        self.pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id))
    }
}

fn interaction_session_id(interaction: &AgentInteraction) -> &str {
    match interaction {
        AgentInteraction::Permission { session_id, .. }
        | AgentInteraction::Question { session_id, .. } => session_id,
    }
}

#[must_use]
pub fn new_interaction_id() -> String {
    format!("int-{}", uuid::Uuid::new_v4())
}

/// 审计/UI 展示用的输入脱敏：敏感键整值打码，文本中的内联密钥模式
/// （sk-*、ghp_*、Bearer 等）替换为占位符，避免 secret 进入事件与日志。
#[must_use]
pub fn redact_tool_input(value: &Value) -> Value {
    match value {
        Value::Object(map) => map
            .iter()
            .map(|(key, value)| {
                let lowered = key.to_ascii_lowercase();
                let sensitive = ["key", "token", "secret", "password", "authorization"]
                    .iter()
                    .any(|marker| lowered.contains(marker));
                let redacted = if sensitive {
                    Value::String("[redacted]".to_string())
                } else {
                    redact_tool_input(value)
                };
                (key.clone(), redacted)
            })
            .collect::<serde_json::Map<String, Value>>()
            .into(),
        Value::Array(items) => Value::Array(items.iter().map(redact_tool_input).collect()),
        Value::String(text) => Value::String(redact_secret_patterns(text)),
        other => other.clone(),
    }
}

fn redact_secret_patterns(text: &str) -> String {
    let mut output = Vec::new();
    let mut tokens = text.split(' ').peekable();
    while let Some(token) = tokens.next() {
        let bare = token.trim_matches(|ch: char| ch == '"' || ch == '\'');
        let looks_secret = (bare.starts_with("sk-") && bare.len() > 10)
            || bare.starts_with("ghp_")
            || bare.starts_with("xoxb-")
            || bare.starts_with("xoxp-");
        if looks_secret {
            output.push("[redacted]");
        } else if bare == "Bearer" && tokens.peek().is_some() {
            output.push("Bearer");
            let _ = tokens.next();
            output.push("[redacted]");
        } else {
            output.push(token);
        }
    }
    output.join(" ")
}

#[must_use]
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi_agent::{AgentEventEnvelope, AGENT_EVENT_SCHEMA_VERSION};

    fn test_context(session_id: &str, run_id: &str) -> (InteractionRunContext, std::sync::mpsc::Receiver<AgentEventEnvelope>) {
        let (sink_tx, sink_rx) = std::sync::mpsc::channel();
        let context = InteractionRunContext {
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            translator: Arc::new(PiEventTranslator::new("/tmp/repo", session_id, run_id)),
            sink: Arc::new(move |envelope| {
                let _ = sink_tx.send(envelope);
            }),
            subscribers: Arc::new(Mutex::new(HashMap::new())),
            event_buffers: Arc::new(Mutex::new(HashMap::new())),
        };
        (context, sink_rx)
    }

    fn permission(id: &str, session_id: &str, run_id: &str) -> AgentInteraction {
        AgentInteraction::Permission {
            id: id.to_string(),
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            tool_call_id: "call-1".to_string(),
            tool: "bash".to_string(),
            risk: "execute".to_string(),
            input: serde_json::json!({"command": "ls"}),
            created_at_ms: 1,
        }
    }

    #[test]
    fn first_reply_wins_and_second_is_rejected() {
        let store = Arc::new(InteractionStore::new());
        let (context, _rx) = test_context("s1", "r1");
        let interaction = permission("int-1", "s1", "r1");
        let store_for_request = Arc::clone(&store);
        let context_for_request = context.clone();
        let waiter = thread::spawn(move || {
            futures::executor::block_on(store_for_request.request(
                interaction,
                &context_for_request,
                Duration::from_secs(60),
            ))
        });
        thread::sleep(Duration::from_millis(50));

        store.reply("int-1", AgentInteractionReply::Once).expect("first reply");
        assert!(store.reply("int-1", AgentInteractionReply::Reject).is_err());

        let resolution = waiter.join().expect("waiter should finish");
        assert!(matches!(
            resolution,
            InteractionResolution::Reply(AgentInteractionReply::Once)
        ));
    }

    #[test]
    fn kind_mismatched_reply_is_rejected_and_pending_survives() {
        let store = Arc::new(InteractionStore::new());
        let (context, _rx) = test_context("s1", "r1");
        let interaction = permission("int-2", "s1", "r1");
        let store_for_request = Arc::clone(&store);
        let context_for_request = context.clone();
        let waiter = thread::spawn(move || {
            futures::executor::block_on(store_for_request.request(
                interaction,
                &context_for_request,
                Duration::from_secs(60),
            ))
        });
        thread::sleep(Duration::from_millis(50));

        assert!(store
            .reply(
                "int-2",
                AgentInteractionReply::Answers {
                    answers: vec![vec!["x".to_string()]],
                },
            )
            .is_err());
        // 种类不匹配不消费 pending，后续有效回复仍生效
        store.reply("int-2", AgentInteractionReply::Reject).expect("valid reply");
        let resolution = waiter.join().expect("waiter should finish");
        assert!(matches!(
            resolution,
            InteractionResolution::Reply(AgentInteractionReply::Reject)
        ));
    }

    #[test]
    fn timeout_auto_rejects_and_publishes_resolved_event() {
        let store = Arc::new(InteractionStore::new());
        let (context, rx) = test_context("s1", "r1");
        let interaction = permission("int-3", "s1", "r1");
        let resolution = futures::executor::block_on(store.request(
            interaction,
            &context,
            Duration::from_millis(80),
        ));
        assert!(matches!(resolution, InteractionResolution::Timeout));

        let mut saw_resolved = false;
        while let Ok(envelope) = rx.recv_timeout(Duration::from_millis(200)) {
            if let AgentEvent::InteractionResolved {
                id,
                resolution,
                automatic,
            } = &envelope.event
            {
                assert_eq!(id, "int-3");
                assert_eq!(resolution, "timeout");
                assert!(*automatic);
                saw_resolved = true;
            }
        }
        assert!(saw_resolved, "resolved event should be published");
    }

    #[test]
    fn reject_run_releases_pending_and_ignores_other_runs() {
        let store = Arc::new(InteractionStore::new());
        let (context_a, _rx_a) = test_context("s1", "run-a");
        let (context_b, _rx_b) = test_context("s1", "run-b");
        let store_a = Arc::clone(&store);
        let store_b = Arc::clone(&store);
        let ctx_a = context_a.clone();
        let ctx_b = context_b.clone();
        let waiter_a = thread::spawn(move || {
            futures::executor::block_on(store_a.request(
                permission("int-a", "s1", "run-a"),
                &ctx_a,
                Duration::from_secs(60),
            ))
        });
        let waiter_b = thread::spawn(move || {
            futures::executor::block_on(store_b.request(
                permission("int-b", "s1", "run-b"),
                &ctx_b,
                Duration::from_secs(60),
            ))
        });
        thread::sleep(Duration::from_millis(50));

        store.reject_run("s1", "run-a", "aborted");

        let resolution_a = waiter_a.join().expect("run-a waiter should finish");
        assert!(matches!(resolution_a, InteractionResolution::Aborted));
        // run-b 不受影响，仍可正常回复
        store.reply("int-b", AgentInteractionReply::Once).expect("reply run-b");
        let resolution_b = waiter_b.join().expect("run-b waiter should finish");
        assert!(matches!(
            resolution_b,
            InteractionResolution::Reply(AgentInteractionReply::Once)
        ));
    }

    #[test]
    fn always_rule_keys_bind_tool_and_target() {
        assert_eq!(
            always_rule_key("bash", &serde_json::json!({"command": "cargo test"})),
            "bash:cargo test"
        );
        assert_eq!(
            always_rule_key("write", &serde_json::json!({"path": "/tmp/a.txt"})),
            "write:/tmp/a.txt"
        );
        assert_eq!(always_rule_key("webfetch", &serde_json::json!({})), "webfetch");
        // web_fetch 细粒度按域名（忽略端口/路径）。
        assert_eq!(
            always_rule_key("web_fetch", &serde_json::json!({"url": "https://doc.rust-lang.org/book/"})),
            "web_fetch:doc.rust-lang.org"
        );
        assert_eq!(
            always_rule_key("web_fetch", &serde_json::json!({"url": "http://EXAMPLE.com:8080/x?q=1"})),
            "web_fetch:example.com"
        );
        assert_eq!(
            always_rule_key("web_fetch", &serde_json::json!({})),
            "web_fetch"
        );
    }

    #[test]
    fn remember_always_allows_same_tool_with_different_targets() {
        let hub = InteractionHub::new(Arc::new(InteractionStore::new()));
        assert!(!hub.is_allowed("bash", &serde_json::json!({"command": "ls"})));
        hub.remember_always("bash", &serde_json::json!({"command": "ls"}));
        assert!(hub.is_allowed("bash", &serde_json::json!({"command": "ls"})));
        assert!(hub.is_allowed("bash", &serde_json::json!({"command": "pwd"})));
        assert!(!hub.is_allowed("write", &serde_json::json!({"path": "/tmp/a.txt"})));
    }

    #[test]
    fn risk_classification_defaults_fail_closed() {
        assert!(!InteractionRisk::for_tool("read").requires_approval());
        assert!(!InteractionRisk::for_tool("grep").requires_approval());
        assert!(!InteractionRisk::for_tool("task").requires_approval());
        assert_eq!(InteractionRisk::for_tool("task"), InteractionRisk::Read);
        assert!(InteractionRisk::for_tool("write").requires_approval());
        assert_eq!(InteractionRisk::for_tool("bash"), InteractionRisk::Execute);
        assert_eq!(InteractionRisk::for_tool("web_fetch"), InteractionRisk::Network);
        assert_eq!(InteractionRisk::for_tool("web_search"), InteractionRisk::Network);
        assert!(InteractionRisk::for_tool("web_fetch").requires_approval());
        assert!(InteractionRisk::for_tool("unknown_tool").requires_approval());
    }

    #[test]
    fn redaction_masks_sensitive_keys_and_inline_secrets() {
        let input = serde_json::json!({
            "command": "curl -H 'Authorization: Bearer abcdef123456' https://x",
            "api_key": "sk-1234567890abcdef",
            "nested": {"token": "tok-1"},
        });
        let redacted = redact_tool_input(&input);
        assert_eq!(redacted["api_key"], "[redacted]");
        assert_eq!(redacted["nested"]["token"], "[redacted]");
        let command = redacted["command"].as_str().expect("command string");
        assert!(!command.contains("abcdef123456"));
        assert!(command.contains("Bearer [redacted]"));
    }

    #[test]
    fn envelope_schema_version_is_stable() {
        let (context, _rx) = test_context("s1", "r1");
        let envelope = context.translator.envelope(AgentEvent::InteractionResolved {
            id: "int-1".to_string(),
            resolution: "once".to_string(),
            automatic: false,
        });
        assert_eq!(envelope.schema_version, AGENT_EVENT_SCHEMA_VERSION);
        assert_eq!(envelope.run_id.as_deref(), Some("r1"));
    }
}

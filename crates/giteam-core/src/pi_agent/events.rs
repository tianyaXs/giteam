use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::messages::{message_id, AgentMessage};
use super::types::AgentInteraction;
use super::AgentSessionStatus;

pub const AGENT_EVENT_SCHEMA_VERSION: u32 = 1;

/// 每个 run 保留的最近事件数，供 SSE 重连按 sequence 补洞。
pub const EVENT_RING_CAPACITY: usize = 2048;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventEnvelope {
    pub schema_version: u32,
    pub event_id: String,
    pub sequence: u64,
    pub repo_path: String,
    pub session_id: String,
    pub run_id: Option<String>,
    pub timestamp_ms: u64,
    pub event: AgentEvent,
}

// AgentInteraction 内含 serde_json::Value（非 Eq），事件层只保证 PartialEq。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentEvent {
    #[serde(rename = "message.delta")]
    MessageDelta {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(default)]
        index: usize,
        delta: String,
        /// 该 content block 的完整文本快照（replace-per-block 语义，
        /// 参考 pi coding agent 的 partial 投影；前端优先用快照而非拼接 delta）。
        #[serde(default)]
        partial: String,
    },
    #[serde(rename = "reasoning.delta")]
    ReasoningDelta {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(default)]
        index: usize,
        delta: String,
        /// 同 MessageDelta.partial，思考块的完整快照。
        #[serde(default)]
        partial: String,
    },
    /// LLM 流式生成 tool call 的开始（区别于 ToolStarted 的实际执行）。
    #[serde(rename = "toolCall.started")]
    ToolCallStarted {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
    },
    /// LLM 流式生成 tool call 参数的增量。
    #[serde(rename = "toolCall.delta")]
    ToolCallDelta {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        delta: String,
    },
    #[serde(rename = "message.started")]
    MessageStarted {
        #[serde(rename = "messageId")]
        message_id: String,
    },
    #[serde(rename = "message.completed")]
    MessageCompleted { message: AgentMessage },
    #[serde(rename = "tool.started")]
    ToolStarted {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool.progress")]
    ToolProgress {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        output: serde_json::Value,
    },
    #[serde(rename = "tool.completed")]
    ToolCompleted {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        output: serde_json::Value,
        #[serde(rename = "isError")]
        is_error: bool,
    },
    #[serde(rename = "session.status")]
    SessionStatusChanged {
        status: AgentSessionStatus,
        error: Option<String>,
    },
    #[serde(rename = "turn.started")]
    TurnStarted { index: usize },
    #[serde(rename = "turn.completed")]
    TurnCompleted { index: usize },
    #[serde(rename = "run.completed")]
    RunCompleted,
    #[serde(rename = "run.failed")]
    RunFailed { error: String },
    #[serde(rename = "runtime.compaction")]
    Compaction {
        phase: String,
        error: Option<String>,
    },
    #[serde(rename = "runtime.retry")]
    Retry {
        phase: String,
        attempt: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_attempts: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        delay_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        success: Option<bool>,
        error: Option<String>,
    },
    #[serde(rename = "runtime.warning")]
    RuntimeWarning { message: String },
    /// 工具执行前等待用户裁决（permission/question）。
    #[serde(rename = "interaction.requested")]
    InteractionRequested { interaction: AgentInteraction },
    /// 交互已裁决。resolution: once/always/reject/answers/cancel/timeout/aborted/auto。
    /// 审计事件只携带 id 与裁决结果，不回放敏感参数。
    #[serde(rename = "interaction.resolved")]
    InteractionResolved {
        id: String,
        resolution: String,
        #[serde(default)]
        automatic: bool,
    },
    /// 子 agent 已创建并开始跑（父 stream；勿仅靠 tool.progress 文本）。
    #[serde(rename = "subagent.started")]
    SubagentStarted {
        #[serde(rename = "parentToolCallId")]
        parent_tool_call_id: String,
        #[serde(rename = "childSessionId")]
        child_session_id: String,
        #[serde(rename = "childRunId")]
        child_run_id: String,
        #[serde(rename = "subagentType")]
        subagent_type: String,
        description: String,
    },
    /// 子 agent 进度（工具调用计数等）。
    #[serde(rename = "subagent.progress")]
    SubagentProgress {
        #[serde(rename = "parentToolCallId")]
        parent_tool_call_id: String,
        #[serde(rename = "toolCount")]
        tool_count: u32,
        #[serde(rename = "currentToolName")]
        current_tool_name: String,
        #[serde(rename = "elapsedMs")]
        elapsed_ms: u64,
    },
    /// 子 session 原始事件投影到父 stream（递归用 Box）。
    #[serde(rename = "subagent.childEvent")]
    SubagentChildEvent {
        #[serde(rename = "parentToolCallId")]
        parent_tool_call_id: String,
        #[serde(rename = "childSessionId")]
        child_session_id: String,
        event: Box<AgentEvent>,
    },
    #[serde(rename = "subagent.completed")]
    SubagentCompleted {
        #[serde(rename = "parentToolCallId")]
        parent_tool_call_id: String,
        #[serde(rename = "childSessionId")]
        child_session_id: String,
        summary: String,
        #[serde(rename = "toolCount")]
        tool_count: u32,
        #[serde(rename = "elapsedMs")]
        elapsed_ms: u64,
    },
    #[serde(rename = "subagent.failed")]
    SubagentFailed {
        #[serde(rename = "parentToolCallId")]
        parent_tool_call_id: String,
        #[serde(rename = "childSessionId")]
        child_session_id: String,
        error: String,
    },
    #[serde(rename = "subagent.aborted")]
    SubagentAborted {
        #[serde(rename = "parentToolCallId")]
        parent_tool_call_id: String,
        #[serde(rename = "childSessionId")]
        child_session_id: String,
    },
}

pub type EventSubscriberKey = (String, String);
pub type EventSubscriberBus =
    Arc<Mutex<HashMap<EventSubscriberKey, Vec<Sender<AgentEventEnvelope>>>>>;
pub type EventBufferBus = Arc<Mutex<HashMap<EventSubscriberKey, EventRingBuffer>>>;

/// 单 run 事件环：容量满时丢最旧；重连用 `after(seq)` 取 seq 之后的帧。
#[derive(Debug, Default)]
pub struct EventRingBuffer {
    events: VecDeque<AgentEventEnvelope>,
    capacity: usize,
}

impl EventRingBuffer {
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            events: VecDeque::with_capacity(capacity.min(256)),
            capacity: capacity.max(1),
        }
    }

    pub fn push(&mut self, event: AgentEventEnvelope) {
        while self.events.len() >= self.capacity {
            self.events.pop_front();
        }
        self.events.push_back(event);
    }

    #[must_use]
    pub fn after(&self, after_seq: u64) -> Vec<AgentEventEnvelope> {
        self.events
            .iter()
            .filter(|event| event.sequence > after_seq)
            .cloned()
            .collect()
    }

    #[must_use]
    pub fn last_sequence(&self) -> Option<u64> {
        self.events.back().map(|event| event.sequence)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }
}

/// 向匹配 (session_id, run_id) 的订阅者广播事件，并写入环形缓冲供重连补洞。
pub fn publish_event(
    subscribers: &EventSubscriberBus,
    buffers: &EventBufferBus,
    event: &AgentEventEnvelope,
) {
    let key = (
        event.session_id.clone(),
        event.run_id.clone().unwrap_or_default(),
    );
    if let Ok(mut buffers) = buffers.lock() {
        buffers
            .entry(key.clone())
            .or_insert_with(|| EventRingBuffer::with_capacity(EVENT_RING_CAPACITY))
            .push(event.clone());
    }
    if let Ok(mut subscribers) = subscribers.lock() {
        if let Some(senders) = subscribers.get_mut(&key) {
            senders.retain(|sender| sender.send(event.clone()).is_ok());
            if senders.is_empty() {
                subscribers.remove(&key);
            }
        }
    }
    if let Some(hook) = UI_EVENT_HOOK.get() {
        hook(event);
    }
}

/// 取出 sequence > after_seq 的缓冲事件（不含 live 通道）。
#[must_use]
pub fn replay_events_after(
    buffers: &EventBufferBus,
    session_id: &str,
    run_id: &str,
    after_seq: u64,
) -> Vec<AgentEventEnvelope> {
    let key = (session_id.to_string(), run_id.to_string());
    buffers
        .lock()
        .ok()
        .and_then(|buffers| buffers.get(&key).map(|buf| buf.after(after_seq)))
        .unwrap_or_default()
}

/// run 结束后可清缓冲，避免无限堆积；重连窗口内保留由调用方决定延迟清理。
pub fn clear_event_buffer(buffers: &EventBufferBus, session_id: &str, run_id: &str) {
    let key = (session_id.to_string(), run_id.to_string());
    if let Ok(mut buffers) = buffers.lock() {
        buffers.remove(&key);
    }
}

type UiEventHook = Arc<dyn Fn(&AgentEventEnvelope) + Send + Sync>;

static UI_EVENT_HOOK: OnceLock<UiEventHook> = OnceLock::new();

/// Desktop registers a hook so HTTP/mobile prompts also emit into the Tauri UI.
pub fn set_ui_event_hook(hook: UiEventHook) {
    let _ = UI_EVENT_HOOK.set(hook);
}

#[derive(Debug)]
pub struct PiEventTranslator {
    repo_path: String,
    session_id: String,
    run_id: String,
    sequence: AtomicU64,
}

impl PiEventTranslator {
    #[must_use]
    pub fn new(
        repo_path: impl Into<String>,
        session_id: impl Into<String>,
        run_id: impl Into<String>,
    ) -> Self {
        Self {
            repo_path: repo_path.into(),
            session_id: session_id.into(),
            run_id: run_id.into(),
            sequence: AtomicU64::new(0),
        }
    }

    /// 把一个已翻译好的 AgentEvent 包装成 envelope。交互事件不走 pi 事件流，
    /// 由 InteractionStore 直接调用，与 translate 共享同一 sequence 计数器。
    #[must_use]
    pub fn envelope(&self, event: AgentEvent) -> AgentEventEnvelope {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        AgentEventEnvelope {
            schema_version: AGENT_EVENT_SCHEMA_VERSION,
            event_id: format!("{}-{sequence}", self.run_id),
            sequence,
            repo_path: self.repo_path.clone(),
            session_id: self.session_id.clone(),
            run_id: Some(self.run_id.clone()),
            timestamp_ms: now_ms(),
            event,
        }
    }

    #[must_use]
    pub fn translate(&self, event: pi::sdk::AgentEvent) -> Option<AgentEventEnvelope> {
        let event = self.translate_event(event)?;
        Some(self.envelope(event))
    }

    fn translate_event(&self, event: pi::sdk::AgentEvent) -> Option<AgentEvent> {
        match event {
            pi::sdk::AgentEvent::AgentStart { .. } => Some(AgentEvent::SessionStatusChanged {
                status: AgentSessionStatus::Running,
                error: None,
            }),
            pi::sdk::AgentEvent::AgentEnd { error, .. } => Some(match error {
                Some(error) => AgentEvent::RunFailed { error },
                None => AgentEvent::RunCompleted,
            }),
            pi::sdk::AgentEvent::TurnStart { turn_index, .. } => {
                Some(AgentEvent::TurnStarted { index: turn_index })
            }
            pi::sdk::AgentEvent::TurnEnd { turn_index, .. } => {
                Some(AgentEvent::TurnCompleted { index: turn_index })
            }
            pi::sdk::AgentEvent::MessageStart { message } => Some(AgentEvent::MessageStarted {
                message_id: pi_message_id(&message),
            }),
            pi::sdk::AgentEvent::MessageUpdate {
                message,
                assistant_message_event,
            } => {
                use pi::model::AssistantMessageEvent as AME;
                let message_id = pi_message_id(&message);
                match assistant_message_event {
                    AME::TextDelta {
                        content_index,
                        delta,
                        partial,
                    } => Some(AgentEvent::MessageDelta {
                        message_id,
                        index: content_index,
                        delta,
                        partial: content_block_text(&partial, content_index),
                    }),
                    AME::ThinkingDelta {
                        content_index,
                        delta,
                        partial,
                    } => Some(AgentEvent::ReasoningDelta {
                        message_id,
                        index: content_index,
                        delta,
                        partial: content_block_text(&partial, content_index),
                    }),
                    AME::ToolCallStart {
                        content_index,
                        partial,
                    } => {
                        let (tool_call_id, tool_name) =
                            tool_call_identity(&partial, content_index);
                        // 流式早期可能只有 name、尚无 id；空 id 若落到前端会 makeId()
                        // 造出幽灵工具，过程中「已运行 N 条」虚高，结束后 history 对账又变少。
                        if tool_call_id.trim().is_empty() {
                            return None;
                        }
                        Some(AgentEvent::ToolCallStarted {
                            tool_call_id,
                            tool_name,
                        })
                    }
                    AME::ToolCallDelta {
                        content_index,
                        delta,
                        partial,
                    } => {
                        let (tool_call_id, _) = tool_call_identity(&partial, content_index);
                        if tool_call_id.trim().is_empty() {
                            return None;
                        }
                        Some(AgentEvent::ToolCallDelta {
                            tool_call_id,
                            delta,
                        })
                    }
                    // Start/TextStart/TextEnd/ThinkingStart/ThinkingEnd/ToolCallEnd/Done/Error
                    // 由 MessageStart、MessageEnd、ToolExecutionStart 与 AgentEnd 等
                    // 更高层事件覆盖，无需重复下发。
                    _ => None,
                }
            }
            pi::sdk::AgentEvent::MessageEnd { message } => Some(AgentEvent::MessageCompleted {
                message: AgentMessage::from_pi(message),
            }),
            pi::sdk::AgentEvent::ToolExecutionStart {
                tool_call_id,
                tool_name,
                args,
            } => Some(AgentEvent::ToolStarted {
                tool_call_id,
                tool_name,
                input: args,
            }),
            pi::sdk::AgentEvent::ToolExecutionUpdate {
                tool_call_id,
                tool_name,
                partial_result,
                ..
            } => Some(AgentEvent::ToolProgress {
                tool_call_id,
                tool_name,
                output: serde_json::to_value(partial_result).unwrap_or(serde_json::Value::Null),
            }),
            pi::sdk::AgentEvent::ToolExecutionEnd {
                tool_call_id,
                tool_name,
                result,
                is_error,
            } => Some(AgentEvent::ToolCompleted {
                tool_call_id,
                tool_name,
                output: serde_json::to_value(result).unwrap_or(serde_json::Value::Null),
                is_error,
            }),
            pi::sdk::AgentEvent::AutoCompactionStart { .. } => Some(AgentEvent::Compaction {
                phase: "started".to_string(),
                error: None,
            }),
            pi::sdk::AgentEvent::AutoCompactionEnd { error_message, .. } => {
                Some(AgentEvent::Compaction {
                    phase: "completed".to_string(),
                    error: error_message,
                })
            }
            pi::sdk::AgentEvent::AutoRetryStart {
                attempt,
                max_attempts,
                delay_ms,
                error_message,
            } => Some(AgentEvent::Retry {
                phase: "started".to_string(),
                attempt,
                max_attempts: Some(max_attempts),
                delay_ms: Some(delay_ms),
                success: None,
                error: Some(error_message),
            }),
            pi::sdk::AgentEvent::AutoRetryEnd {
                success,
                attempt,
                final_error,
            } => Some(AgentEvent::Retry {
                phase: "completed".to_string(),
                attempt,
                max_attempts: None,
                delay_ms: None,
                success: Some(success),
                error: final_error,
            }),
            pi::sdk::AgentEvent::ExtensionError { error, event, .. } => {
                Some(AgentEvent::RuntimeWarning {
                    message: format!("Pi extension event {event} failed: {error}"),
                })
            }
        }
    }
}

fn pi_message_id(message: &pi::sdk::Message) -> String {
    match message {
        pi::sdk::Message::User(message) => message_id("user", message.timestamp),
        pi::sdk::Message::Assistant(message) => message_id("assistant", message.timestamp),
        pi::sdk::Message::ToolResult(message) => message_id("tool", message.timestamp),
        pi::sdk::Message::Custom(message) => message_id("custom", message.timestamp),
    }
}

/// 从流式 partial message 的 content block 中恢复 tool call 的 id/name，
/// 使 ToolCallStart/ToolCallDelta 事件可以与后续 ToolExecution* 事件关联。
fn tool_call_identity(
    message: &pi::sdk::AssistantMessage,
    content_index: usize,
) -> (String, String) {
    match message.content.get(content_index) {
        Some(pi::sdk::ContentBlock::ToolCall(call)) => (call.id.clone(), call.name.clone()),
        _ => (String::new(), String::new()),
    }
}

/// 提取 partial message 中指定 content block 的完整文本快照
/// （text/thinking 块），供前端 replace-per-block 渲染。
fn content_block_text(message: &pi::sdk::AssistantMessage, content_index: usize) -> String {
    match message.content.get(content_index) {
        Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
        Some(pi::sdk::ContentBlock::Thinking(thinking)) => thinking.thinking.clone(),
        _ => String::new(),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            duration.as_millis().try_into().unwrap_or(u64::MAX)
        })
}

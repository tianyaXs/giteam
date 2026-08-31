use serde::{Deserialize, Serialize};

const PI_SDK_REVISION: &str = "b27abd576cc0d2f39e2eef8f87f7897edec53b4f";#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiRuntimeInfo {
    pub backend: String,
    pub transport: String,
    pub sdk_revision: String,
    pub capabilities: RuntimeCapabilities,
}

impl PiRuntimeInfo {
    #[must_use]
    pub fn current() -> Self {
        Self {
            backend: "pi".to_string(),
            transport: "inProcess".to_string(),
            sdk_revision: PI_SDK_REVISION.to_string(),
            capabilities: RuntimeCapabilities::foundation(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub sessions: bool,
    pub streaming: bool,
    pub abort: bool,
    pub tools: bool,
    pub reasoning: bool,
    pub approvals: bool,
    pub questions: bool,
    pub skills: bool,
    pub extensions: bool,
    pub mcp: bool,
}

impl RuntimeCapabilities {
    #[must_use]
    pub const fn foundation() -> Self {
        Self {
            sessions: true,
            streaming: true,
            abort: true,
            tools: true,
            reasoning: true,
            approvals: true,
            questions: true,
            skills: false,
            extensions: false,
            mcp: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentSessionStatus {
    Idle,
    Running,
    WaitingForInput,
    Aborted,
    Failed,
}

/// Question 工具的单个提问项。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuestion {
    pub question: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<AgentQuestionOption>,
    #[serde(default)]
    pub multiple: bool,
    /// 是否允许自由文本回答（无选项时必须为 true）。
    #[serde(default = "default_true")]
    pub custom: bool,
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuestionOption {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// TodoWrite 任务项状态。序列化为 snake_case 以匹配前端契约
///（`agentSessions.ts` 的 `AgentTodoItem["status"]`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentTodoStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "in_progress")]
    InProgress,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "cancelled")]
    Cancelled,
}

impl AgentTodoStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// TodoWrite 工具的单个任务项。前端 `readAgentTodosFromPart` 据此解析渲染侧栏卡片。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTodo {
    pub id: String,
    pub content: String,
    pub status: AgentTodoStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
}

/// 等待用户裁决的交互请求。`input` 已脱敏，审计/UI 可直接展示。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum AgentInteraction {
    #[serde(rename = "permission")]
    Permission {
        id: String,
        session_id: String,
        run_id: String,
        tool_call_id: String,
        tool: String,
        /// read/write/execute/network。
        risk: String,
        input: serde_json::Value,
        created_at_ms: u64,
    },
    #[serde(rename = "question")]
    Question {
        id: String,
        session_id: String,
        run_id: String,
        tool_call_id: String,
        questions: Vec<AgentQuestion>,
        created_at_ms: u64,
    },
}

impl AgentInteraction {
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::Permission { id, .. } | Self::Question { id, .. } => id,
        }
    }
}

/// 客户端对交互的回复。`once/always/reject` 仅用于 permission；
/// `answers/cancel` 仅用于 question，种类不匹配会被拒绝。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "camelCase")]
pub enum AgentInteractionReply {
    #[serde(rename = "once")]
    Once,
    #[serde(rename = "always")]
    Always,
    #[serde(rename = "reject")]
    Reject,
    #[serde(rename = "answers")]
    Answers { answers: Vec<Vec<String>> },
    #[serde(rename = "cancel")]
    Cancel,
}

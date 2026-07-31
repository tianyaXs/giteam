use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentRole {
    User,
    Assistant,
    System,
    Tool,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub role: AgentRole,
    pub created_at_ms: u64,
    pub parts: Vec<AgentPart>,
}

/// Prompt 附带的图片。优先 `path`（由桌面端落盘），否则用 `data`（纯 base64）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptImage {
    #[serde(default)]
    pub mime_type: String,
    /// 纯 base64，不含 data: 前缀。大图请改走 path，避免 IPC 撑爆。
    #[serde(default)]
    pub data: String,
    /// 本地可读图片路径；service 侧读盘后再送给 Pi。
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentPart {
    Text {
        text: String,
    },
    Reasoning {
        text: String,
    },
    RedactedReasoning,
    Image {
        mime_type: String,
        data: String,
    },
    ToolCall {
        tool_call_id: String,
        tool_name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_call_id: String,
        tool_name: String,
        output: serde_json::Value,
        is_error: bool,
    },
    Custom {
        custom_type: String,
        content: String,
        details: Option<serde_json::Value>,
    },
}

impl AgentMessage {
    pub(crate) fn from_pi(message: pi::sdk::Message) -> Self {
        match message {
            pi::sdk::Message::User(message) => {
                let parts = match message.content {
                    pi::sdk::UserContent::Text(text) => vec![AgentPart::Text { text }],
                    pi::sdk::UserContent::Blocks(blocks) => map_content_blocks(blocks),
                };
                Self {
                    id: message_id("user", message.timestamp),
                    role: AgentRole::User,
                    created_at_ms: timestamp_ms(message.timestamp),
                    parts,
                }
            }
            pi::sdk::Message::Assistant(message) => {
                Self::from_pi_assistant((*message).clone(), None)
            }
            pi::sdk::Message::ToolResult(message) => Self {
                id: message_id("tool", message.timestamp),
                role: AgentRole::Tool,
                created_at_ms: timestamp_ms(message.timestamp),
                parts: vec![AgentPart::ToolResult {
                    tool_call_id: message.tool_call_id.clone(),
                    tool_name: message.tool_name.clone(),
                    output: serde_json::to_value(&*message).unwrap_or(serde_json::Value::Null),
                    is_error: message.is_error,
                }],
            },
            pi::sdk::Message::Custom(message) => Self {
                id: message_id("custom", message.timestamp),
                role: AgentRole::Custom,
                created_at_ms: timestamp_ms(message.timestamp),
                parts: vec![AgentPart::Custom {
                    custom_type: message.custom_type,
                    content: message.content,
                    details: message.details,
                }],
            },
        }
    }

    pub(crate) fn from_pi_assistant(
        message: pi::sdk::AssistantMessage,
        id: Option<String>,
    ) -> Self {
        Self {
            id: id.unwrap_or_else(|| message_id("assistant", message.timestamp)),
            role: AgentRole::Assistant,
            created_at_ms: timestamp_ms(message.timestamp),
            parts: map_content_blocks(message.content),
        }
    }
}

fn map_content_blocks(blocks: Vec<pi::sdk::ContentBlock>) -> Vec<AgentPart> {
    blocks
        .into_iter()
        .map(|block| match block {
            pi::sdk::ContentBlock::Text(text) => AgentPart::Text { text: text.text },
            pi::sdk::ContentBlock::Thinking(thinking) => AgentPart::Reasoning {
                text: thinking.thinking,
            },
            pi::sdk::ContentBlock::RedactedThinking(_) => AgentPart::RedactedReasoning,
            pi::sdk::ContentBlock::Image(image) => AgentPart::Image {
                mime_type: image.mime_type,
                data: image.data,
            },
            pi::sdk::ContentBlock::ToolCall(call) => AgentPart::ToolCall {
                tool_call_id: call.id,
                tool_name: call.name,
                input: call.arguments,
            },
        })
        .collect()
}

pub(crate) fn message_id(role: &str, timestamp: i64) -> String {
    format!("{role}-{timestamp}")
}

fn timestamp_ms(timestamp: i64) -> u64 {
    timestamp.try_into().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// wire 级（JSON）契约：前端消费的是序列化后的 camelCase 字段。
    /// serde 枚举的 `rename_all` 只改变体名，字段必须靠 `rename_all_fields`，
    /// 本测试防止回退成 snake_case（前端 toolName undefined 的根因）。
    #[test]
    fn agent_part_serializes_camel_case_fields_on_the_wire() {
        let message = AgentMessage {
            id: "assistant-1".to_string(),
            role: AgentRole::Assistant,
            created_at_ms: 1,
            parts: vec![
                AgentPart::ToolCall {
                    tool_call_id: "call-1".to_string(),
                    tool_name: "bash".to_string(),
                    input: serde_json::json!({ "command": "ls" }),
                },
                AgentPart::ToolResult {
                    tool_call_id: "call-1".to_string(),
                    tool_name: "bash".to_string(),
                    output: serde_json::json!({ "ok": true }),
                    is_error: false,
                },
                AgentPart::Image {
                    mime_type: "image/png".to_string(),
                    data: "AA==".to_string(),
                },
                AgentPart::Custom {
                    custom_type: "widget".to_string(),
                    content: "x".to_string(),
                    details: None,
                },
            ],
        };
        let json = serde_json::to_value(&message).expect("serialize message");
        let parts = json["parts"].as_array().expect("parts array");
        assert_eq!(parts[0]["toolCallId"], "call-1");
        assert_eq!(parts[0]["toolName"], "bash");
        assert!(parts[0].get("tool_call_id").is_none());
        assert_eq!(parts[1]["toolName"], "bash");
        assert_eq!(parts[1]["isError"], false);
        assert!(parts[1].get("is_error").is_none());
        assert_eq!(parts[2]["mimeType"], "image/png");
        assert_eq!(parts[3]["customType"], "widget");
        // 反序列化同样走 camelCase（历史消息读取路径）。
        let round_trip: AgentMessage =
            serde_json::from_value(json).expect("deserialize message");
        assert_eq!(round_trip, message);
    }
}

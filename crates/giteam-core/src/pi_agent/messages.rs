use std::collections::HashMap;

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

/// pi SDK 的消息本身没有 id，我们只能按 role+timestamp 合成。
/// 同一批 provider 消息可能共享同一毫秒时间戳，直接合成会互相覆盖、
/// 导致历史重载后的分组/合并坍缩。这里按出现顺序给重复 id 追加序号，
/// 生成与 JSONL 行序一致的稳定 id。
pub(crate) fn assign_stable_message_ids(messages: Vec<AgentMessage>) -> Vec<AgentMessage> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut messages = messages;
    for message in &mut messages {
        let count = seen.entry(message.id.clone()).or_default();
        if *count > 0 {
            message.id = format!("{}-{}", message.id, *count);
        }
        *count += 1;
    }
    messages
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

    /// JSONL 实证：同一批 assistant/toolResult 消息可能共享同一毫秒时间戳。
    /// 历史读取时若继续合成相同 id，前端 details/分组会互相覆盖，步骤数坍缩。
    #[test]
    fn assign_stable_message_ids_disambiguates_repeated_timestamps() {
        let make = |role: AgentRole, text: &str| AgentMessage {
            id: message_id("assistant", 1_793_089_622_165),
            role,
            created_at_ms: 1_793_089_622_165,
            parts: vec![AgentPart::Text {
                text: text.to_string(),
            }],
        };
        let messages = assign_stable_message_ids(vec![
            make(AgentRole::Assistant, "a"),
            make(AgentRole::Assistant, "b"),
            make(AgentRole::Assistant, "c"),
        ]);
        let ids: Vec<_> = messages.iter().map(|message| message.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "assistant-1793089622165",
                "assistant-1793089622165-1",
                "assistant-1793089622165-2",
            ]
        );
    }

    /// 相同时间戳但角色不同并非冲突；只有完整 id 重复才需要追加序号。
    #[test]
    fn assign_stable_message_ids_keeps_distinct_roles_distinct() {
        let message = |id: &str, role: AgentRole| AgentMessage {
            id: id.to_string(),
            role,
            created_at_ms: 1,
            parts: Vec::new(),
        };
        let messages = assign_stable_message_ids(vec![
            message("user-1", AgentRole::User),
            message("assistant-1", AgentRole::Assistant),
        ]);
        assert_eq!(messages[0].id, "user-1");
        assert_eq!(messages[1].id, "assistant-1");
    }
}

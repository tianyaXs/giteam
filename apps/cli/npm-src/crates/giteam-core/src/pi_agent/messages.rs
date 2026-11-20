use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::context_breakdown::ContextBreakdown;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<AgentTokenUsage>,
    /// 截至这条 assistant 消息的整个持久会话累计用量；非 assistant 或旧数据缺省。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_usage: Option<AgentTokenUsage>,
    /// 上下文窗口分类占用（chars÷4 估计）；仅最近完成的 assistant 可能带。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_breakdown: Option<ContextBreakdown>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

impl AgentTokenUsage {
    pub(crate) fn from_pi(usage: &pi::model::Usage) -> Self {
        Self {
            input: usage.input,
            output: usage.output,
            cache_read: usage.cache_read,
            cache_write: usage.cache_write,
        }
    }

    fn add_assign(&mut self, next: &Self) {
        self.input = self.input.saturating_add(next.input);
        self.output = self.output.saturating_add(next.output);
        self.cache_read = self.cache_read.saturating_add(next.cache_read);
        self.cache_write = self.cache_write.saturating_add(next.cache_write);
    }

    fn sub_assign(&mut self, previous: &Self) {
        self.input = self.input.saturating_sub(previous.input);
        self.output = self.output.saturating_sub(previous.output);
        self.cache_read = self.cache_read.saturating_sub(previous.cache_read);
        self.cache_write = self.cache_write.saturating_sub(previous.cache_write);
    }
}

/// 会话级 usage projection：同一消息的最终/重复样本替换，不累加两次。
/// compaction 后的恢复由原始 SessionEntry 重建，不依赖裁剪后的 model messages。
#[derive(Debug, Default)]
pub(crate) struct AgentUsageProjection {
    by_message: HashMap<String, AgentTokenUsage>,
    total: AgentTokenUsage,
}

impl AgentUsageProjection {
    pub(crate) fn replace(&mut self, message_id: String, next: AgentTokenUsage) {
        if let Some(previous) = self.by_message.insert(message_id, next.clone()) {
            self.total.sub_assign(&previous);
        }
        self.total.add_assign(&next);
    }

    /// 实时 MessageCompleted 用：同毫秒多步不能共用一个 id，否则后一步会盖掉前一步。
    /// 流式 usage 未接入前不走 replace；run 结束仍以原始 entries 重建为准。
    pub(crate) fn insert_new(&mut self, base_id: String, next: AgentTokenUsage) {
        let mut id = base_id.clone();
        let mut n = 0usize;
        while self.by_message.contains_key(&id) {
            n += 1;
            id = format!("{base_id}-{n}");
        }
        self.replace(id, next);
    }

    pub(crate) fn total(&self) -> AgentTokenUsage {
        self.total.clone()
    }
}

/// 只把累计快照放在最后一条 assistant 上；前端无需遍历或累加分页消息。
pub(crate) fn attach_session_usage(
    messages: &mut [AgentMessage],
    usage: AgentTokenUsage,
) {
    if let Some(message) = messages
        .iter_mut()
        .rev()
        .find(|message| message.role == AgentRole::Assistant)
    {
        message.session_usage = Some(usage);
    }
}

/// 从当前分支的原始日志重建总量；Compaction 条目不删除前后的 assistant 用量。
pub(crate) fn project_session_usage(
    entries: &[&pi::session::SessionEntry],
) -> AgentUsageProjection {
    let mut projection = AgentUsageProjection::default();
    let mut seen: HashMap<String, usize> = HashMap::new();
    for entry in entries {
        let pi::session::SessionEntry::Message(entry) = entry else {
            continue;
        };
        let pi::session::SessionMessage::Assistant { message } = &entry.message else {
            continue;
        };
        let base_id = message_id("assistant", message.timestamp);
        let count = seen.entry(base_id.clone()).or_default();
        let id = if *count == 0 {
            base_id
        } else {
            format!("{base_id}-{}", *count)
        };
        *count += 1;
        projection.replace(id, AgentTokenUsage::from_pi(&message.usage));
    }
    projection
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
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
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
                    usage: None,
                    session_usage: None,
                    context_breakdown: None,
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
                usage: None,
                session_usage: None,
                context_breakdown: None,
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
                usage: None,
                session_usage: None,
                context_breakdown: None,
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
            usage: Some(AgentTokenUsage::from_pi(&message.usage)),
            session_usage: None,
            context_breakdown: None,
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
            // 音视频等非图媒体：暂以同结构 Image part 透传 mime/data，前端可按 mime 分支。
            pi::sdk::ContentBlock::Media(media) => AgentPart::Image {
                mime_type: media.mime_type,
                data: media.data,
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
            usage: None,
            session_usage: None,
            context_breakdown: None,
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
        let round_trip: AgentMessage = serde_json::from_value(json).expect("deserialize message");
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
            usage: None,
            session_usage: None,
            context_breakdown: None,
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
            usage: None,
            session_usage: None,
            context_breakdown: None,
        };
        let messages = assign_stable_message_ids(vec![
            message("user-1", AgentRole::User),
            message("assistant-1", AgentRole::Assistant),
        ]);
        assert_eq!(messages[0].id, "user-1");
        assert_eq!(messages[1].id, "assistant-1");
    }

    fn usage(input: u64, cache_read: u64, cache_write: u64) -> AgentTokenUsage {
        AgentTokenUsage {
            input,
            output: 7,
            cache_read,
            cache_write,
        }
    }

    #[test]
    fn usage_projection_replaces_duplicate_message_samples() {
        let mut projection = AgentUsageProjection::default();
        projection.replace("a1".to_string(), usage(100, 20, 10));
        projection.replace("a2".to_string(), usage(200, 40, 20));
        projection.replace("a1".to_string(), usage(80, 50, 10));

        assert_eq!(
            projection.total(),
            AgentTokenUsage {
                output: 14,
                ..usage(280, 90, 30)
            }
        );
    }

    #[test]
    fn usage_projection_insert_new_keeps_same_timestamp_steps() {
        let mut projection = AgentUsageProjection::default();
        projection.insert_new("assistant-100".to_string(), usage(100, 20, 10));
        projection.insert_new("assistant-100".to_string(), usage(200, 40, 20));

        assert_eq!(
            projection.total(),
            AgentTokenUsage {
                output: 14,
                ..usage(300, 60, 30)
            }
        );
    }

    #[test]
    fn usage_projection_recovers_across_compaction_entries() {
        fn assistant(timestamp: i64, input: u64) -> pi::session::SessionEntry {
            let message = pi::sdk::AssistantMessage {
                timestamp,
                usage: pi::model::Usage {
                    input,
                    cache_read: input * 2,
                    ..Default::default()
                },
                ..Default::default()
            };
            pi::session::SessionEntry::Message(pi::session::MessageEntry {
                base: pi::session::EntryBase::new(None, format!("entry-{timestamp}")),
                message: pi::session::SessionMessage::Assistant { message },
            })
        }

        let entries = vec![
            assistant(1, 100),
            pi::session::SessionEntry::Compaction(pi::session::CompactionEntry {
                base: pi::session::EntryBase::new(None, "compact-1".to_string()),
                summary: "summary".to_string(),
                first_kept_entry_id: "entry-2".to_string(),
                tokens_before: 500,
                details: None,
                from_hook: None,
            }),
            assistant(2, 200),
            // 同毫秒的真实另一条消息应获得稳定后缀，而不是互相替换。
            assistant(2, 300),
        ];
        let refs: Vec<_> = entries.iter().collect();
        let projection = project_session_usage(&refs);

        assert_eq!(projection.total().input, 600);
        assert_eq!(projection.total().cache_read, 1_200);
    }
}

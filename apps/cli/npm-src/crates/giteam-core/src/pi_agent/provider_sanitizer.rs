//! 流事件层修复超长 tool call id 的 Provider 包装器。
//!
//! # 背景
//! indemind 等 OpenAI 兼容网关在每个 stream chunk 重复下发完整 `tool_calls[].id`，
//! pi `openai.rs` 用 `push_str` 累加后会变成 `call_XXXcall_XXX...`（实测 29 字符 × 51
//! = 1479），agent 消息历史一旦被污染，下一轮回放触发上游 Responses API 的
//! `Invalid 'input[n].call_id': string too long`（上限 64 字符）HTTP 400。
//!
//! pi 是只读 git 依赖（改 cargo checkout 不会进入构建），无法在其内部修复。
//! 但 pi 公开了 `Provider` trait 与 `Agent::set_provider`，因此在这里包一层：
//! 流出的 `StreamEvent` 统一把 >64 的 tool call id 收敛回 ≤64，污染根本进不了
//! agent 消息历史——同一次 run 内也不会再 400，无需依赖失败后的重试清洗。
//!
//! 对正常 provider 是透传（id ≤64 原样放行），全 provider 统一安装。

use std::pin::Pin;
use std::sync::{Arc, Mutex};

use futures::{Stream, StreamExt};

/// OpenAI Responses API：`call_id` 最大 64 字符（`string_above_max_length`）。
pub(crate) const OPENAI_TOOL_CALL_ID_MAX_LEN: usize = 64;

/// 折叠「完整 id 被重复拼接」的形态：`call_ABCcall_ABC...` → `call_ABC`。
pub(crate) fn collapse_repeated_tool_call_id(id: &str) -> Option<String> {
    let trimmed = id.trim();
    let len = trimmed.len();
    if len <= OPENAI_TOOL_CALL_ID_MAX_LEN || trimmed.is_empty() {
        return None;
    }
    // 精确整数倍重复（session 实证：29 字符 × 36 = 1044、× 51 = 1479）。
    let max_period = OPENAI_TOOL_CALL_ID_MAX_LEN.min(len / 2);
    for period in 1..=max_period {
        if len % period != 0 {
            continue;
        }
        let unit = &trimmed[..period];
        if trimmed.as_bytes().chunks_exact(period).all(|chunk| chunk == unit.as_bytes()) {
            return Some(unit.to_string());
        }
    }
    None
}

/// 把超长 tool call id 收敛到 ≤64：优先折叠重复拼接（保留原始 id 可读性），
/// 否则取安全前缀 + 哈希（确定性，同一污染 id 必映射到同一短 id，保证配对一致）。
/// ≤64 的 id 原样返回。
pub(crate) fn shorten_tool_call_id(id: &str) -> String {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.len() <= OPENAI_TOOL_CALL_ID_MAX_LEN {
        return trimmed.to_string();
    }
    if let Some(collapsed) = collapse_repeated_tool_call_id(trimmed) {
        return collapsed;
    }
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    trimmed.hash(&mut hasher);
    let hash = hasher.finish();
    let prefix: String = trimmed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .take(12)
        .collect();
    let prefix = if prefix.is_empty() {
        "tc".to_string()
    } else {
        prefix
    };
    format!("{prefix}_{hash:016x}")
}

type ProviderStream = Pin<Box<dyn Stream<Item = pi::error::Result<pi::sdk::StreamEvent>> + Send>>;

/// 修复流出事件里超长 tool call id 的 Provider 包装器（详见模块文档）。
pub(crate) struct ToolCallIdSanitizerProvider {
    inner: Arc<dyn pi::sdk::Provider>,
}

impl ToolCallIdSanitizerProvider {
    fn wrap(inner: Arc<dyn pi::sdk::Provider>) -> Arc<dyn pi::sdk::Provider> {
        Arc::new(Self { inner })
    }
}

#[async_trait::async_trait]
impl pi::sdk::Provider for ToolCallIdSanitizerProvider {
    // name/api/model_id 原样委托：pi `set_provider_model` 的 already_active 判断
    // 依赖 name/model_id 与 registry 一致，包装层不得改变这些标识。
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn api(&self) -> &str {
        self.inner.api()
    }

    fn model_id(&self) -> &str {
        self.inner.model_id()
    }

    async fn stream(
        &self,
        context: &pi::sdk::ProviderContext<'_>,
        options: &pi::sdk::StreamOptions,
    ) -> pi::error::Result<ProviderStream> {
        let stream = self.inner.stream(context, options).await?;
        Ok(Box::pin(
            stream.map(|item| item.map(sanitize_stream_event_tool_call_ids)),
        ))
    }
}

/// 确保 agent 当前 provider 已套上清洗包装。
///
/// pi 在 `set_provider_model` 切换模型时会重建 provider（丢弃包装），所以每次
/// prompt 前按指针比对重装；`slot` 存当前已安装的包装，避免逐 prompt 叠包。
pub(crate) fn ensure_tool_call_id_sanitizer(
    agent: &mut pi::sdk::Agent,
    slot: &Mutex<Option<Arc<dyn pi::sdk::Provider>>>,
) {
    let current = agent.provider();
    let Ok(mut installed) = slot.lock() else {
        return;
    };
    if installed
        .as_ref()
        .is_some_and(|wrapper| Arc::ptr_eq(&current, wrapper))
    {
        return;
    }
    let wrapped = ToolCallIdSanitizerProvider::wrap(current);
    agent.set_provider(Arc::clone(&wrapped));
    *installed = Some(wrapped);
}

fn sanitize_stream_event_tool_call_ids(event: pi::sdk::StreamEvent) -> pi::sdk::StreamEvent {
    use pi::sdk::StreamEvent as SE;
    match event {
        SE::Start { mut partial } => {
            sanitize_assistant_tool_call_ids(&mut partial);
            SE::Start { partial }
        }
        SE::ToolCallStart {
            content_index,
            id,
            name,
        } => SE::ToolCallStart {
            content_index,
            id: shorten_tool_call_id(&id),
            name,
        },
        SE::ToolCallEnd {
            content_index,
            mut tool_call,
        } => {
            tool_call.id = shorten_tool_call_id(&tool_call.id);
            SE::ToolCallEnd {
                content_index,
                tool_call,
            }
        }
        SE::Done { reason, mut message } => {
            sanitize_assistant_tool_call_ids(&mut message);
            SE::Done { reason, message }
        }
        SE::Error { reason, mut error } => {
            sanitize_assistant_tool_call_ids(&mut error);
            SE::Error { reason, error }
        }
        // Text*/Thinking*/ToolCallDelta 不携带 tool call id，透传。
        other => other,
    }
}

fn sanitize_assistant_tool_call_ids(message: &mut pi::sdk::AssistantMessage) {
    for block in &mut message.content {
        if let pi::sdk::ContentBlock::ToolCall(call) = block {
            call.id = shorten_tool_call_id(&call.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubProvider {
        events: Vec<pi::sdk::StreamEvent>,
    }

    #[async_trait::async_trait]
    impl pi::sdk::Provider for StubProvider {
        fn name(&self) -> &str {
            "stub"
        }

        fn api(&self) -> &str {
            "openai-completions"
        }

        fn model_id(&self) -> &str {
            "stub-model"
        }

        async fn stream(
            &self,
            _context: &pi::sdk::ProviderContext<'_>,
            _options: &pi::sdk::StreamOptions,
        ) -> pi::error::Result<ProviderStream> {
            Ok(Box::pin(futures::stream::iter(
                self.events.clone().into_iter().map(Ok),
            )))
        }
    }

    fn tool_call(id: &str) -> pi::sdk::ToolCall {
        pi::sdk::ToolCall {
            id: id.to_string(),
            name: "bash".to_string(),
            arguments: serde_json::json!({"command": "git status"}),
            thought_signature: None,
        }
    }

    fn collect_wrapped(
        events: Vec<pi::sdk::StreamEvent>,
    ) -> Vec<pi::sdk::StreamEvent> {
        futures::executor::block_on(async {
            let provider = ToolCallIdSanitizerProvider::wrap(Arc::new(StubProvider { events }));
            let stream = provider
                .stream(
                    &pi::sdk::ProviderContext::default(),
                    &pi::sdk::StreamOptions::default(),
                )
                .await
                .expect("stub stream");
            stream
                .collect::<Vec<_>>()
                .await
                .into_iter()
                .collect::<Result<Vec<_>, _>>()
                .expect("no stream errors")
        })
    }

    #[test]
    fn wrapper_collapses_gateway_repeated_full_id() {
        let unit = "call_zQAyO3pHaOo4FK326tDhwP5F";
        assert_eq!(unit.len(), 29);
        let polluted = unit.repeat(51);
        assert_eq!(polluted.len(), 1479);
        let events = collect_wrapped(vec![
            pi::sdk::StreamEvent::ToolCallStart {
                content_index: 0,
                id: unit.to_string(),
                name: "bash".to_string(),
            },
            pi::sdk::StreamEvent::ToolCallEnd {
                content_index: 0,
                tool_call: tool_call(&polluted),
            },
            pi::sdk::StreamEvent::Done {
                reason: pi::sdk::StopReason::ToolUse,
                message: pi::sdk::AssistantMessage {
                    content: vec![pi::sdk::ContentBlock::ToolCall(tool_call(&polluted))],
                    ..pi::sdk::AssistantMessage::default()
                },
            },
        ]);

        let pi::sdk::StreamEvent::ToolCallStart { id, .. } = &events[0] else {
            panic!("ToolCallStart");
        };
        assert_eq!(id, unit, "起始 id 未超限时原样透传");
        let pi::sdk::StreamEvent::ToolCallEnd { tool_call, .. } = &events[1] else {
            panic!("ToolCallEnd");
        };
        assert_eq!(tool_call.id, unit, "1479 折叠回 29，与起始 id 一致");
        let pi::sdk::StreamEvent::Done { message, .. } = &events[2] else {
            panic!("Done");
        };
        let pi::sdk::ContentBlock::ToolCall(call) = &message.content[0] else {
            panic!("tool call block");
        };
        assert_eq!(call.id, unit, "终态消息同样收敛，历史不再被污染");
    }

    #[test]
    fn wrapper_passes_through_normal_ids_and_hashes_uncollapsible() {
        let normal = "call_abc123";
        let uncollapsible = "x".repeat(100);
        let events = collect_wrapped(vec![
            pi::sdk::StreamEvent::ToolCallEnd {
                content_index: 0,
                tool_call: tool_call(normal),
            },
            pi::sdk::StreamEvent::ToolCallEnd {
                content_index: 1,
                tool_call: tool_call(&uncollapsible),
            },
        ]);

        let pi::sdk::StreamEvent::ToolCallEnd { tool_call, .. } = &events[0] else {
            panic!("ToolCallEnd");
        };
        assert_eq!(tool_call.id, normal);
        let pi::sdk::StreamEvent::ToolCallEnd { tool_call, .. } = &events[1] else {
            panic!("ToolCallEnd");
        };
        assert!(tool_call.id.len() <= OPENAI_TOOL_CALL_ID_MAX_LEN);
        assert_eq!(
            tool_call.id,
            shorten_tool_call_id(&uncollapsible),
            "不可折叠时走确定性哈希，同一输入必得同一短 id"
        );
    }

    #[test]
    fn wrapper_delegates_identity_fields() {
        let provider = ToolCallIdSanitizerProvider::wrap(Arc::new(StubProvider { events: vec![] }));
        assert_eq!(provider.name(), "stub");
        assert_eq!(provider.api(), "openai-completions");
        assert_eq!(provider.model_id(), "stub-model");
    }
}

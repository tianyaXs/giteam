//! Pi `AgentEvent`/`AssistantMessageEvent` → Giteam `AgentEvent` 的 golden 契约测试。
//!
//! 这些测试不依赖真实 provider 网络，只用进程内构造的 Pi 事件验证归一化规则，
//! 防止事件翻译层在 SDK 升级或后续重构中静默漂移。

use std::sync::Arc;

use giteam_core::pi_agent::{AgentEvent, AgentSessionStatus, PiEventTranslator};
use pi::model::AssistantMessageEvent as AME;
use pi::sdk::{
    AgentEvent as PiAgentEvent, AssistantMessage, ContentBlock, Message, StopReason, TextContent,
    ThinkingContent, ToolCall, ToolOutput,
};

fn assistant_message(timestamp: i64) -> Message {
    Message::assistant(AssistantMessage {
        timestamp,
        ..AssistantMessage::default()
    })
}

fn partial_with_tool_call(id: &str, name: &str) -> Arc<AssistantMessage> {
    Arc::new(AssistantMessage {
        content: vec![ContentBlock::ToolCall(ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments: serde_json::json!({}),
            thought_signature: None,
        })],
        ..AssistantMessage::default()
    })
}

fn tool_output(text: &str, is_error: bool) -> ToolOutput {
    ToolOutput {
        content: vec![ContentBlock::Text(TextContent {
            text: text.to_string(),
            text_signature: None,
        })],
        details: None,
        is_error,
    }
}

#[test]
fn text_delta_maps_to_message_delta_with_content_index() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    // partial 携带两个 text 块，索引 1 的快照应取第二块的完整文本。
    let partial = Arc::new(AssistantMessage {
        content: vec![
            ContentBlock::Text(TextContent {
                text: "first".to_string(),
                text_signature: None,
            }),
            ContentBlock::Text(TextContent {
                text: "hello world".to_string(),
                text_signature: None,
            }),
        ],
        ..AssistantMessage::default()
    });
    let event = PiAgentEvent::MessageUpdate {
        message: assistant_message(42),
        assistant_message_event: AME::TextDelta {
            content_index: 1,
            delta: "hello".to_string(),
            partial,
        },
    };

    let envelope = translator.translate(event).expect("text delta should map");

    assert_eq!(
        envelope.event,
        AgentEvent::MessageDelta {
            message_id: "assistant-42".to_string(),
            index: 1,
            delta: "hello".to_string(),
            partial: "hello world".to_string(),
        }
    );
}

#[test]
fn thinking_delta_maps_to_reasoning_delta_with_content_index() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let event = PiAgentEvent::MessageUpdate {
        message: assistant_message(7),
        assistant_message_event: AME::ThinkingDelta {
            content_index: 0,
            delta: "thinking…".to_string(),
            partial: Arc::new(AssistantMessage::default()),
        },
    };

    let envelope = translator
        .translate(event)
        .expect("thinking delta should map");

    assert_eq!(
        envelope.event,
        AgentEvent::ReasoningDelta {
            message_id: "assistant-7".to_string(),
            index: 0,
            delta: "thinking…".to_string(),
            partial: String::new(),
        }
    );
}

#[test]
fn tool_call_stream_recovers_identity_from_partial_message() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let start = PiAgentEvent::MessageUpdate {
        message: assistant_message(9),
        assistant_message_event: AME::ToolCallStart {
            content_index: 0,
            partial: partial_with_tool_call("call-1", "bash"),
        },
    };
    let delta = PiAgentEvent::MessageUpdate {
        message: assistant_message(9),
        assistant_message_event: AME::ToolCallDelta {
            content_index: 0,
            delta: "{\"command\":".to_string(),
            partial: partial_with_tool_call("call-1", "bash"),
        },
    };

    let start = translator.translate(start).expect("tool call start should map");
    let delta = translator.translate(delta).expect("tool call delta should map");

    assert_eq!(
        start.event,
        AgentEvent::ToolCallStarted {
            tool_call_id: "call-1".to_string(),
            tool_name: "bash".to_string(),
        }
    );
    assert_eq!(
        delta.event,
        AgentEvent::ToolCallDelta {
            tool_call_id: "call-1".to_string(),
            delta: "{\"command\":".to_string(),
        }
    );
    assert!(delta.sequence > start.sequence);
}

#[test]
fn tool_call_stream_skips_events_without_call_id() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    // 流式早期常只有 name、尚无 id；若下发会让前端造幽灵工具，过程/结束计数不一致。
    let start = PiAgentEvent::MessageUpdate {
        message: assistant_message(9),
        assistant_message_event: AME::ToolCallStart {
            content_index: 0,
            partial: partial_with_tool_call("", "bash"),
        },
    };
    let delta = PiAgentEvent::MessageUpdate {
        message: assistant_message(9),
        assistant_message_event: AME::ToolCallDelta {
            content_index: 0,
            delta: "{\"command\":".to_string(),
            partial: partial_with_tool_call("", "bash"),
        },
    };

    assert!(translator.translate(start).is_none());
    assert!(translator.translate(delta).is_none());
}

#[test]
fn stream_markers_without_user_payload_are_dropped() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let message = || assistant_message(11);
    let partial = || Arc::new(AssistantMessage::default());
    let dropped = vec![
        AME::Start {
            partial: partial(),
        },
        AME::TextStart {
            content_index: 0,
            partial: partial(),
        },
        AME::TextEnd {
            content_index: 0,
            content: "final".to_string(),
            partial: partial(),
        },
        AME::ThinkingStart {
            content_index: 0,
            partial: partial(),
        },
        AME::ThinkingEnd {
            content_index: 0,
            content: "final thinking".to_string(),
            partial: partial(),
        },
        AME::ToolCallEnd {
            content_index: 0,
            tool_call: ToolCall {
                id: "call-1".to_string(),
                name: "read".to_string(),
                arguments: serde_json::json!({}),
                thought_signature: None,
            },
            partial: partial(),
        },
        AME::Done {
            reason: StopReason::Stop,
            message: partial(),
        },
        AME::Error {
            reason: StopReason::Error,
            error: partial(),
        },
    ];

    for marker in dropped {
        let event = PiAgentEvent::MessageUpdate {
            message: message(),
            assistant_message_event: marker,
        };
        assert!(
            translator.translate(event).is_none(),
            "marker-only stream events must be covered by higher-level events"
        );
    }
}

#[test]
fn agent_end_maps_to_run_completed_or_failed() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let completed = translator
        .translate(PiAgentEvent::AgentEnd {
            session_id: "session-1".into(),
            messages: vec![],
            error: None,
        })
        .expect("agent end should map");
    let failed = translator
        .translate(PiAgentEvent::AgentEnd {
            session_id: "session-1".into(),
            messages: vec![],
            error: Some("provider exploded".to_string()),
        })
        .expect("agent end with error should map");

    assert_eq!(completed.event, AgentEvent::RunCompleted);
    assert_eq!(
        failed.event,
        AgentEvent::RunFailed {
            error: "provider exploded".to_string(),
        }
    );
}

#[test]
fn tool_execution_update_and_end_map_to_progress_and_completed() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let update = translator
        .translate(PiAgentEvent::ToolExecutionUpdate {
            tool_call_id: "call-1".to_string(),
            tool_name: "bash".to_string(),
            args: serde_json::json!({"command": "ls"}),
            partial_result: tool_output("partial", false),
        })
        .expect("tool update should map");
    let end = translator
        .translate(PiAgentEvent::ToolExecutionEnd {
            tool_call_id: "call-1".to_string(),
            tool_name: "bash".to_string(),
            result: tool_output("boom", true),
            is_error: true,
        })
        .expect("tool end should map");

    assert_eq!(
        update.event,
        AgentEvent::ToolProgress {
            tool_call_id: "call-1".to_string(),
            tool_name: "bash".to_string(),
            output: serde_json::to_value(tool_output("partial", false)).expect("serialize output"),
        }
    );
    match end.event {
        AgentEvent::ToolCompleted {
            tool_call_id,
            tool_name,
            is_error,
            ..
        } => {
            assert_eq!(tool_call_id, "call-1");
            assert_eq!(tool_name, "bash");
            assert!(is_error);
        }
        other => panic!("expected tool.completed, got {other:?}"),
    }
}

#[test]
fn auto_retry_events_carry_the_success_flag() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let started = translator
        .translate(PiAgentEvent::AutoRetryStart {
            attempt: 2,
            max_attempts: 5,
            delay_ms: 500,
            error_message: "429 rate limited".to_string(),
        })
        .expect("retry start should map");
    let ended = translator
        .translate(PiAgentEvent::AutoRetryEnd {
            success: false,
            attempt: 5,
            final_error: Some("gave up".to_string()),
        })
        .expect("retry end should map");

    assert_eq!(
        started.event,
        AgentEvent::Retry {
            phase: "started".to_string(),
            attempt: 2,
            max_attempts: Some(5),
            delay_ms: Some(500),
            success: None,
            error: Some("429 rate limited".to_string()),
        }
    );
    assert_eq!(
        ended.event,
        AgentEvent::Retry {
            phase: "completed".to_string(),
            attempt: 5,
            max_attempts: None,
            delay_ms: None,
            success: Some(false),
            error: Some("gave up".to_string()),
        }
    );
}

#[test]
fn compaction_and_extension_errors_map_to_runtime_events() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let compaction = translator
        .translate(PiAgentEvent::AutoCompactionEnd {
            result: None,
            aborted: false,
            will_retry: false,
            error_message: Some("context too large".to_string()),
        })
        .expect("compaction end should map");
    let extension = translator
        .translate(PiAgentEvent::ExtensionError {
            extension_id: Some("ext-1".to_string()),
            event: "session_start".to_string(),
            error: "extension panicked".to_string(),
        })
        .expect("extension error should map");

    assert_eq!(
        compaction.event,
        AgentEvent::Compaction {
            phase: "completed".to_string(),
            error: Some("context too large".to_string()),
        }
    );
    match extension.event {
        AgentEvent::RuntimeWarning { message } => {
            assert!(message.contains("ext-1") || message.contains("session_start"));
            assert!(message.contains("extension panicked"));
        }
        other => panic!("expected runtime.warning, got {other:?}"),
    }
}

#[test]
fn turn_and_message_boundaries_are_preserved() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let turn = translator
        .translate(PiAgentEvent::TurnStart {
            session_id: "session-1".into(),
            turn_index: 3,
            timestamp: 100,
        })
        .expect("turn start should map");
    let message_start = translator
        .translate(PiAgentEvent::MessageStart {
            message: assistant_message(21),
        })
        .expect("message start should map");

    assert_eq!(turn.event, AgentEvent::TurnStarted { index: 3 });
    assert_eq!(
        message_start.event,
        AgentEvent::MessageStarted {
            message_id: "assistant-21".to_string(),
            role: giteam_core::pi_agent::AgentRole::Assistant,
        }
    );
}

#[test]
fn translated_envelope_is_monotonic_and_provider_neutral() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let mut last_sequence = 0;
    for index in 0..5 {
        let event = PiAgentEvent::MessageUpdate {
            message: assistant_message(30),
            assistant_message_event: AME::TextDelta {
                content_index: 0,
                delta: format!("chunk-{index}"),
                partial: Arc::new(AssistantMessage::default()),
            },
        };
        let envelope = translator.translate(event).expect("delta should map");
        assert!(envelope.sequence > last_sequence);
        last_sequence = envelope.sequence;

        let json = serde_json::to_string(&envelope).expect("envelope should serialize");
        let lowered = json.to_ascii_lowercase();
        assert!(!lowered.contains("opencode"));
        assert!(!lowered.contains("\"openai\""));
        assert!(!lowered.contains("\"anthropic\""));
    }
}

#[test]
fn reasoning_blocks_from_completed_messages_stay_intact() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let message = Message::assistant(AssistantMessage {
        timestamp: 55,
        content: vec![
            ContentBlock::Thinking(ThinkingContent {
                thinking: "plan first".to_string(),
                thinking_signature: None,
            }),
            ContentBlock::Text(TextContent {
                text: "answer".to_string(),
                text_signature: None,
            }),
        ],
        ..AssistantMessage::default()
    });

    let envelope = translator
        .translate(PiAgentEvent::MessageEnd { message })
        .expect("message end should map");

    match envelope.event {
        AgentEvent::MessageCompleted { message } => {
            assert_eq!(message.parts.len(), 2);
            assert!(matches!(
                &message.parts[0],
                giteam_core::pi_agent::AgentPart::Reasoning { text } if text == "plan first"
            ));
            assert!(matches!(
                &message.parts[1],
                giteam_core::pi_agent::AgentPart::Text { text } if text == "answer"
            ));
        }
        other => panic!("expected message.completed, got {other:?}"),
    }
}

#[test]
fn session_status_values_stay_stable_for_client_filters() {
    // 客户端依赖这些字符串做会话状态过滤；变动必须显式修改契约。
    let json = serde_json::to_value(AgentSessionStatus::WaitingForInput).expect("serialize status");
    assert_eq!(json, serde_json::json!("waitingForInput"));
}

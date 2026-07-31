use futures::executor::block_on;
use giteam_core::pi_agent::{
    AgentEvent, AgentSessionStatus, PiAgentService, PiEventTranslator, PiSessionConfig,
};

#[test]
fn session_config_is_explicitly_in_process_and_persistent() {
    let config = PiSessionConfig::persistent("/tmp/repo", "/tmp/sessions");

    assert_eq!(config.repo_path.to_string_lossy(), "/tmp/repo");
    assert_eq!(config.session_dir.to_string_lossy(), "/tmp/sessions");
    assert!(!config.no_session);
}

#[test]
fn session_config_debug_output_redacts_provider_secrets() {
    let mut config = PiSessionConfig::persistent("/tmp/repo", "/tmp/sessions");
    config.api_key = Some("super-secret".to_string());

    let debug = format!("{config:?}");

    assert!(!debug.contains("super-secret"));
    assert!(debug.contains("[redacted]"));
}

#[test]
fn service_starts_without_hidden_runtime_or_active_runs() {
    let service = PiAgentService::new();

    assert_eq!(service.runtime_info().backend, "pi");
    assert_eq!(service.runtime_info().transport, "inProcess");
    assert_eq!(service.session_count(), 0);
    assert_eq!(service.active_run_count(), 0);
    assert!(!service.abort("missing-run"));
}

#[test]
fn session_queries_fail_closed_for_unknown_sessions() {
    let service = PiAgentService::new();

    let error = block_on(service.session_summary("missing-session"))
        .expect_err("unknown session should not produce a synthetic summary");

    assert!(error.to_string().contains("session not found"));
}

#[test]
fn pi_tool_events_are_translated_to_the_giteam_contract() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let event = pi::sdk::AgentEvent::ToolExecutionStart {
        tool_call_id: "call-1".to_string(),
        tool_name: "read".to_string(),
        args: serde_json::json!({"path": "README.md"}),
    };

    let envelope = translator
        .translate(event)
        .expect("tool start should be translated");

    assert_eq!(envelope.sequence, 1);
    assert_eq!(envelope.repo_path, "/tmp/repo");
    assert_eq!(envelope.session_id, "session-1");
    assert_eq!(envelope.run_id.as_deref(), Some("run-1"));
    assert_eq!(
        envelope.event,
        AgentEvent::ToolStarted {
            tool_call_id: "call-1".to_string(),
            tool_name: "read".to_string(),
            input: serde_json::json!({"path": "README.md"}),
        }
    );
}

#[test]
fn pi_lifecycle_events_update_session_status() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let event = pi::sdk::AgentEvent::AgentStart {
        session_id: "pi-session-1".into(),
    };

    let envelope = translator
        .translate(event)
        .expect("agent start should be translated");

    assert_eq!(
        envelope.event,
        AgentEvent::SessionStatusChanged {
            status: AgentSessionStatus::Running,
            error: None,
        }
    );
}

#[test]
fn pi_text_stream_events_are_translated_without_provider_names() {
    let translator = PiEventTranslator::new("/tmp/repo", "session-1", "run-1");
    let message = pi::sdk::Message::assistant(pi::sdk::AssistantMessage {
        timestamp: 42,
        ..pi::sdk::AssistantMessage::default()
    });
    let event = pi::sdk::AgentEvent::MessageUpdate {
        message,
        assistant_message_event: pi::model::AssistantMessageEvent::TextDelta {
            content_index: 0,
            delta: "hello".to_string(),
            partial: std::sync::Arc::new(pi::sdk::AssistantMessage::default()),
        },
    };

    let envelope = translator
        .translate(event)
        .expect("text delta should be translated");

    assert_eq!(
        envelope.event,
        AgentEvent::MessageDelta {
            message_id: "assistant-42".to_string(),
            index: 0,
            delta: "hello".to_string(),
            partial: String::new(),
        }
    );
}

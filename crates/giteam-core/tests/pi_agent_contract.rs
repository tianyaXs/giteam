use giteam_core::pi_agent::{
    AgentEvent, AgentEventEnvelope, AgentInteraction, AgentInteractionReply, AgentMessage,
    AgentPart, AgentQuestion, AgentQuestionOption, AgentRole, AgentSessionStatus, AgentTodo,
    AgentTodoStatus, PiRuntimeInfo, RuntimeCapabilities, AGENT_EVENT_SCHEMA_VERSION,
};

#[test]
fn runtime_info_declares_pi_as_the_only_backend() {
    let info = PiRuntimeInfo::current();

    assert_eq!(info.backend, "pi");
    assert_eq!(info.transport, "inProcess");
    assert!(!info.sdk_revision.is_empty());
    assert!(info.capabilities.streaming);
    assert!(info.capabilities.abort);
}

#[test]
fn capabilities_cover_verified_foundation_and_interactions() {
    let capabilities = RuntimeCapabilities::foundation();

    assert!(capabilities.sessions);
    assert!(capabilities.streaming);
    assert!(capabilities.abort);
    assert!(capabilities.tools);
    assert!(capabilities.reasoning);
    // PR6：审批与提问交互已上线
    assert!(capabilities.approvals);
    assert!(capabilities.questions);
    assert!(!capabilities.skills);
    assert!(!capabilities.extensions);
    assert!(!capabilities.mcp);
}

#[test]
fn event_envelope_serializes_with_stable_camel_case_contract() {
    let event = AgentEventEnvelope {
        schema_version: AGENT_EVENT_SCHEMA_VERSION,
        event_id: "event-1".to_string(),
        sequence: 7,
        repo_path: "/tmp/repo".to_string(),
        session_id: "session-1".to_string(),
        run_id: Some("run-1".to_string()),
        timestamp_ms: 1234,
        event: AgentEvent::MessageDelta {
            message_id: "message-1".to_string(),
            index: 0,
            delta: "hello".to_string(),
            partial: "hello world".to_string(),
        },
    };

    let value = serde_json::to_value(event).expect("event envelope should serialize");

    assert_eq!(value["schemaVersion"], AGENT_EVENT_SCHEMA_VERSION);
    assert_eq!(value["eventId"], "event-1");
    assert_eq!(value["runId"], "run-1");
    assert_eq!(value["event"]["type"], "message.delta");
    assert_eq!(value["event"]["messageId"], "message-1");
    assert_eq!(value["event"]["delta"], "hello");
    assert_eq!(value["event"]["partial"], "hello world");
}

#[test]
fn message_parts_round_trip_without_provider_specific_types() {
    let message = AgentMessage {
        id: "message-1".to_string(),
        role: AgentRole::Assistant,
        created_at_ms: 1234,
        parts: vec![
            AgentPart::Reasoning {
                text: "checking".to_string(),
            },
            AgentPart::Text {
                text: "done".to_string(),
            },
        ],
    };

    let json = serde_json::to_string(&message).expect("message should serialize");
    assert!(!json.to_ascii_lowercase().contains("opencode"));

    let decoded: AgentMessage = serde_json::from_str(&json).expect("message should deserialize");
    assert_eq!(decoded, message);
}

#[test]
fn session_status_uses_explicit_terminal_and_interaction_states() {
    let statuses = [
        AgentSessionStatus::Idle,
        AgentSessionStatus::Running,
        AgentSessionStatus::WaitingForInput,
        AgentSessionStatus::Aborted,
        AgentSessionStatus::Failed,
    ];

    let json = serde_json::to_value(statuses).expect("statuses should serialize");
    assert_eq!(
        json,
        serde_json::json!(["idle", "running", "waitingForInput", "aborted", "failed"])
    );
}

/// PR6：interaction 事件的 wire 契约。字段名 camelCase、kind 标签稳定，
/// 前端依赖这些键渲染审批卡片与提问面板。
#[test]
fn interaction_events_use_stable_wire_contract() {
    let permission = AgentInteraction::Permission {
        id: "int-1".to_string(),
        session_id: "session-1".to_string(),
        run_id: "run-1".to_string(),
        tool_call_id: "call-1".to_string(),
        tool: "bash".to_string(),
        risk: "execute".to_string(),
        input: serde_json::json!({"command": "ls"}),
        created_at_ms: 1234,
    };
    let requested = AgentEvent::InteractionRequested {
        interaction: permission,
    };
    let value = serde_json::to_value(&requested).expect("serialize requested");
    assert_eq!(value["type"], "interaction.requested");
    assert_eq!(value["interaction"]["kind"], "permission");
    assert_eq!(value["interaction"]["toolCallId"], "call-1");
    assert_eq!(value["interaction"]["sessionId"], "session-1");
    assert_eq!(value["interaction"]["runId"], "run-1");
    assert_eq!(value["interaction"]["createdAtMs"], 1234);

    let resolved = AgentEvent::InteractionResolved {
        id: "int-1".to_string(),
        resolution: "once".to_string(),
        automatic: false,
    };
    let value = serde_json::to_value(&resolved).expect("serialize resolved");
    assert_eq!(value["type"], "interaction.resolved");
    assert_eq!(value["id"], "int-1");
    assert_eq!(value["resolution"], "once");
    assert_eq!(value["automatic"], false);

    let question = AgentInteraction::Question {
        id: "int-2".to_string(),
        session_id: "session-1".to_string(),
        run_id: "run-1".to_string(),
        tool_call_id: "call-2".to_string(),
        questions: vec![AgentQuestion {
            question: "继续吗？".to_string(),
            header: Some("确认".to_string()),
            options: vec![AgentQuestionOption {
                label: "继续".to_string(),
                description: None,
            }],
            multiple: false,
            custom: true,
        }],
        created_at_ms: 1235,
    };
    let value = serde_json::to_value(&question).expect("serialize question");
    assert_eq!(value["kind"], "question");
    assert_eq!(value["questions"][0]["question"], "继续吗？");
    assert_eq!(value["questions"][0]["options"][0]["label"], "继续");

    // 回复契约：tag=decision，answers 携带二维数组
    let reply = AgentInteractionReply::Answers {
        answers: vec![vec!["继续".to_string()]],
    };
    let value = serde_json::to_value(&reply).expect("serialize reply");
    assert_eq!(value["decision"], "answers");
    assert_eq!(value["answers"][0][0], "继续");
    let decoded: AgentInteractionReply =
        serde_json::from_value(serde_json::json!({"decision": "always"})).expect("parse reply");
    assert_eq!(decoded, AgentInteractionReply::Always);
}

/// TodoWrite 任务项的 wire 契约：status 为 snake_case（匹配前端 `AgentTodoItem`），
/// 字段 camelCase，priority 缺省不序列化，可 round-trip。
#[test]
fn todo_items_use_stable_wire_contract() {
    let todo = AgentTodo {
        id: "todo-1".to_string(),
        content: "读取文件".to_string(),
        status: AgentTodoStatus::InProgress,
        priority: Some("high".to_string()),
    };
    let value = serde_json::to_value(&todo).expect("serialize todo");
    assert_eq!(value["id"], "todo-1");
    assert_eq!(value["content"], "读取文件");
    assert_eq!(value["status"], "in_progress");
    assert_eq!(value["priority"], "high");

    // status 枚举全部序列化为 snake_case，匹配前端 parseAgentTodoItems 的白名单。
    let statuses = serde_json::to_value([
        AgentTodoStatus::Pending,
        AgentTodoStatus::InProgress,
        AgentTodoStatus::Completed,
        AgentTodoStatus::Cancelled,
    ])
    .expect("serialize statuses");
    assert_eq!(
        statuses,
        serde_json::json!(["pending", "in_progress", "completed", "cancelled"])
    );

    // priority 缺省不出现，且可 round-trip。
    let without_priority = AgentTodo {
        id: "todo-2".to_string(),
        content: "x".to_string(),
        status: AgentTodoStatus::Completed,
        priority: None,
    };
    let json = serde_json::to_string(&without_priority).expect("serialize");
    assert!(!json.contains("priority"));
    let decoded: AgentTodo = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(decoded, without_priority);
}

/// AskUserQuestion 升级：多选 + 4 选项上限的 wire 样本，确认前端可解析到完整 4 项。
#[test]
fn question_carries_up_to_four_options_with_multiple_flag() {
    let question = AgentQuestion {
        question: "选哪些？".to_string(),
        header: None,
        options: vec![
            AgentQuestionOption { label: "a".into(), description: None },
            AgentQuestionOption { label: "b".into(), description: None },
            AgentQuestionOption { label: "c".into(), description: None },
            AgentQuestionOption { label: "d".into(), description: None },
        ],
        multiple: true,
        custom: true,
    };
    let value = serde_json::to_value(&question).expect("serialize question");
    assert_eq!(value["multiple"], true);
    assert_eq!(value["custom"], true);
    assert_eq!(value["options"].as_array().map(Vec::len), Some(4));
    assert_eq!(value["options"][0]["label"], "a");
}

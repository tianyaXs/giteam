//! 钉钉 Outgoing → 本机 Agent → sessionWebhook / Webhook 回群。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::pi_agent::{
    ensure_repo_pi_sessions_dir, AgentEventEnvelope, AgentMessage, AgentPart, PiAgentService,
    PiSessionConfig,
};

use super::config::{get_settings, SessionMode};
use super::send::{post_robot_body, send_markdown, SendMessageResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingPayload {
    #[serde(default)]
    pub text: Option<OutgoingText>,
    #[serde(default)]
    pub msgtype: Option<String>,
    #[serde(default)]
    pub msg_id: Option<String>,
    #[serde(default)]
    pub create_at: Option<i64>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub conversation_type: Option<String>,
    #[serde(default)]
    pub conversation_title: Option<String>,
    #[serde(default)]
    pub sender_id: Option<String>,
    #[serde(default)]
    pub sender_nick: Option<String>,
    #[serde(default)]
    pub sender_staff_id: Option<String>,
    #[serde(default)]
    pub session_webhook: Option<String>,
    #[serde(default)]
    pub session_webhook_expired_time: Option<i64>,
    #[serde(default)]
    pub is_in_at_list: Option<bool>,
    #[serde(default)]
    pub raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingText {
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingTriggerResult {
    pub accepted: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply: Option<SendMessageResult>,
}

/// 解析钉钉 Outgoing JSON（兼容 snake_case / camelCase）。
pub fn parse_outgoing_body(raw: &Value) -> OutgoingPayload {
    let mut payload: OutgoingPayload =
        serde_json::from_value(raw.clone()).unwrap_or_else(|_| OutgoingPayload {
            text: None,
            msgtype: None,
            msg_id: None,
            create_at: None,
            conversation_id: None,
            conversation_type: None,
            conversation_title: None,
            sender_id: None,
            sender_nick: None,
            sender_staff_id: None,
            session_webhook: None,
            session_webhook_expired_time: None,
            is_in_at_list: None,
            raw: Some(raw.clone()),
        });
    if payload.text.is_none() {
        if let Some(content) = raw
            .pointer("/text/content")
            .and_then(Value::as_str)
            .map(str::to_string)
        {
            payload.text = Some(OutgoingText { content });
        }
    }
    if payload.session_webhook.is_none() {
        payload.session_webhook = raw
            .get("sessionWebhook")
            .or_else(|| raw.get("session_webhook"))
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    if payload.sender_nick.is_none() {
        payload.sender_nick = raw
            .get("senderNick")
            .or_else(|| raw.get("sender_nick"))
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    payload.raw = Some(raw.clone());
    payload
}

fn extract_user_text(payload: &OutgoingPayload) -> String {
    let raw = payload
        .text
        .as_ref()
        .map(|t| t.content.as_str())
        .unwrap_or("")
        .trim();
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn message_text(message: &AgentMessage) -> String {
    message
        .parts
        .iter()
        .filter_map(|part| match part {
            AgentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        return s.to_string();
    }
    let head: String = chars[..max].iter().collect();
    format!("{head}…")
}

async fn resolve_session(
    service: &PiAgentService,
    repo_path: &str,
    mode: SessionMode,
    session_id: Option<&str>,
) -> Result<String, String> {
    let repo = PathBuf::from(repo_path);
    if !repo.is_dir() {
        return Err(format!("repo path missing: {repo_path}"));
    }
    match mode {
        SessionMode::New => {
            let session_dir = ensure_repo_pi_sessions_dir(Path::new(repo_path))
                .map_err(|e| e.to_string())?;
            let config = PiSessionConfig {
                repo_path: repo,
                session_dir,
                session_path: None,
                provider: None,
                model: None,
                api_key: None,
                system_prompt: None,
                append_system_prompt: None,
                enabled_tools: None,
                extension_paths: Vec::new(),
                no_session: false,
                thinking: None,
                max_tool_iterations: None,
                browser_controller: None,
                parent_session_id: None,
                parent_tool_call_id: None,
                session_kind: "primary".to_string(),
            };
            let summary = service
                .create_session(config)
                .await
                .map_err(|e| e.to_string())?;
            Ok(summary.session_id)
        }
        SessionMode::Existing => {
            let sid = session_id
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "session_id required for existing mode".to_string())?;
            let _ = service.session_summary(sid).await.map_err(|e| e.to_string())?;
            Ok(sid.to_string())
        }
    }
}

fn reply_body(text: &str) -> Value {
    let content = if text.trim().is_empty() {
        "（Agent 无文本回复）".to_string()
    } else {
        truncate(text, 18_000)
    };
    json!({
        "msgtype": "markdown",
        "markdown": {
            "title": "Giteam",
            "text": content,
        }
    })
}

fn post_reply(session_webhook: Option<&str>, text: &str) -> Result<SendMessageResult, String> {
    let body = reply_body(text);
    if let Some(url) = session_webhook.map(str::trim).filter(|u| !u.is_empty()) {
        match post_robot_body(url, &body) {
            Ok(r) if r.ok => return Ok(r),
            Ok(r) => {
                eprintln!(
                    "[dingtalk] sessionWebhook reply failed: {} — fallback webhook",
                    r.errmsg
                );
            }
            Err(err) => {
                eprintln!("[dingtalk] sessionWebhook error: {err} — fallback webhook");
            }
        }
    }
    let md = body["markdown"]["text"].as_str().unwrap_or(text);
    send_markdown("Giteam", md, false, &[])
}

fn precheck(payload: &OutgoingPayload) -> Result<(String, String, SessionMode, Option<String>), String> {
    let settings = get_settings();
    if !settings.allow_trigger {
        return Err("dingtalk trigger disabled".into());
    }
    let repo = settings.repo_path.trim().to_string();
    if repo.is_empty() {
        return Err("repo_path not configured".into());
    }
    let user_text = extract_user_text(payload);
    if user_text.is_empty() {
        return Err("empty message content".into());
    }
    Ok((
        repo,
        user_text,
        settings.session_mode,
        settings.session_id.clone(),
    ))
}

/// 异步执行：建/复用 session → prompt → 回群。须在已有 tokio runtime 上 `block_on`。
pub async fn execute_outgoing(payload: OutgoingPayload) -> OutgoingTriggerResult {
    let (repo, user_text, session_mode, session_id_cfg) = match precheck(&payload) {
        Ok(v) => v,
        Err(message) => {
            return OutgoingTriggerResult {
                accepted: false,
                message,
                session_id: None,
                reply: None,
            };
        }
    };
    let nick = payload
        .sender_nick
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("钉钉用户");
    let prompt = format!(
        "你正在通过钉钉群机器人收到来自「{nick}」的消息。请直接完成对方请求，并用简洁中文回复（最终回复会发回钉钉群）。\n\n用户消息：\n{user_text}"
    );

    let service = PiAgentService::global();
    let session_id = match resolve_session(service, &repo, session_mode, session_id_cfg.as_deref())
        .await
    {
        Ok(id) => id,
        Err(err) => {
            return OutgoingTriggerResult {
                accepted: false,
                message: err,
                session_id: None,
                reply: None,
            };
        }
    };

    if service.has_active_run_for_session(&session_id) {
        return OutgoingTriggerResult {
            accepted: false,
            message: "session busy".into(),
            session_id: Some(session_id),
            reply: None,
        };
    }

    let run_id = format!("dingtalk-{}", uuid::Uuid::new_v4().simple());
    let sink: Arc<dyn Fn(AgentEventEnvelope) + Send + Sync> = Arc::new(|_e| {});
    match service
        .prompt(&session_id, &run_id, prompt, Vec::new(), sink)
        .await
    {
        Ok(message) => {
            let text = message_text(&message);
            let reply = post_reply(payload.session_webhook.as_deref(), &text).ok();
            OutgoingTriggerResult {
                accepted: true,
                message: "ok".into(),
                session_id: Some(session_id),
                reply,
            }
        }
        Err(err) => {
            let _ = post_reply(
                payload.session_webhook.as_deref(),
                &format!("Agent 执行失败：{err}"),
            );
            OutgoingTriggerResult {
                accepted: false,
                message: err.to_string(),
                session_id: Some(session_id),
                reply: None,
            }
        }
    }
}

/// 仅做配置预检并返回是否可接受；真正执行由调用方在后台 `execute_outgoing`。
pub fn handle_outgoing_async(payload: OutgoingPayload) -> OutgoingTriggerResult {
    match precheck(&payload) {
        Ok(_) => OutgoingTriggerResult {
            accepted: true,
            message: "accepted".into(),
            session_id: None,
            reply: None,
        },
        Err(message) => OutgoingTriggerResult {
            accepted: false,
            message,
            session_id: None,
            reply: None,
        },
    }
}

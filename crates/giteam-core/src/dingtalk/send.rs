//! 向钉钉自定义机器人 Webhook 发消息。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::config::{get_settings, load_sign_secret};
use super::sign::build_signed_webhook_url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    /// `text` 或 `markdown`。
    pub msgtype: String,
    pub content: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub at_all: bool,
    #[serde(default)]
    pub at_mobiles: Vec<String>,
    /// 覆盖配置中的 Webhook（测试发送用）。
    #[serde(default)]
    pub webhook_url: Option<String>,
    /// 覆盖配置中的加签 Secret（测试发送用；勿记日志）。
    #[serde(default)]
    pub sign_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageResult {
    pub ok: bool,
    pub errcode: i64,
    pub errmsg: String,
}

fn build_body(req: &SendMessageRequest) -> Result<Value, String> {
    let content = req.content.trim();
    if content.is_empty() {
        return Err("content must not be empty".into());
    }
    let msgtype = req.msgtype.trim().to_ascii_lowercase();
    let at = json!({
        "atMobiles": req.at_mobiles.iter().map(|m| m.trim()).filter(|m| !m.is_empty()).collect::<Vec<_>>(),
        "isAtAll": req.at_all,
    });
    match msgtype.as_str() {
        "text" => Ok(json!({
            "msgtype": "text",
            "text": { "content": content },
            "at": at,
        })),
        "markdown" => {
            let title = req
                .title
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .unwrap_or("Giteam");
            Ok(json!({
                "msgtype": "markdown",
                "markdown": { "title": title, "text": content },
                "at": at,
            }))
        }
        other => Err(format!("unsupported msgtype: {other}")),
    }
}

fn strip_dingtalk_sign_query(webhook_url: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(webhook_url.trim()) else {
        return webhook_url.trim().to_string();
    };
    let pairs: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(k, _)| k != "timestamp" && k != "sign")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    parsed.set_query(None);
    if !pairs.is_empty() {
        parsed.query_pairs_mut().extend_pairs(pairs);
    }
    parsed.to_string()
}

fn resolve_url(webhook_url: &str, sign_secret: Option<&str>) -> Result<String, String> {
    let url = webhook_url.trim();
    if url.is_empty() {
        return Err("webhook url is empty".into());
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("webhook url must be http(s)".into());
    }
    match sign_secret.map(str::trim).filter(|s| !s.is_empty()) {
        Some(secret) => {
            let base = strip_dingtalk_sign_query(url);
            let ts = chrono::Utc::now().timestamp_millis();
            Ok(build_signed_webhook_url(&base, ts, secret))
        }
        None => Ok(url.to_string()),
    }
}

fn resolve_sign_secret(req: &SendMessageRequest, use_global_config: bool) -> Option<String> {
    req.sign_secret
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            if use_global_config {
                load_sign_secret()
            } else {
                None
            }
        })
}

/// 发送消息（同步 HTTP）。优先用请求覆盖，否则读本地配置。
pub fn send_message(req: &SendMessageRequest) -> Result<SendMessageResult, String> {
    let settings = get_settings();
    let task_webhook = req
        .webhook_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let webhook = task_webhook.unwrap_or(settings.webhook_url.as_str());
    // 任务级 Webhook 只用任务 Secret，避免误用旧全局加签导致发送失败。
    let secret = resolve_sign_secret(req, task_webhook.is_none());
    let url = resolve_url(webhook, secret.as_deref())?;
    let body = build_body(req)?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("Giteam/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let value: Value = resp.json().unwrap_or_else(|_| json!({}));
    let errcode = value.get("errcode").and_then(Value::as_i64).unwrap_or(if status.is_success() {
        0
    } else {
        -1
    });
    let errmsg = value
        .get("errmsg")
        .and_then(Value::as_str)
        .unwrap_or(if status.is_success() { "ok" } else { "request failed" })
        .to_string();
    Ok(SendMessageResult {
        ok: errcode == 0,
        errcode,
        errmsg,
    })
}

pub fn send_text(content: &str, at_all: bool, at_mobiles: &[String]) -> Result<SendMessageResult, String> {
    send_message(&SendMessageRequest {
        msgtype: "text".into(),
        content: content.to_string(),
        title: None,
        at_all,
        at_mobiles: at_mobiles.to_vec(),
        webhook_url: None,
        sign_secret: None,
    })
}

pub fn send_markdown(
    title: &str,
    content: &str,
    at_all: bool,
    at_mobiles: &[String],
) -> Result<SendMessageResult, String> {
    send_message(&SendMessageRequest {
        msgtype: "markdown".into(),
        content: content.to_string(),
        title: Some(title.to_string()),
        at_all,
        at_mobiles: at_mobiles.to_vec(),
        webhook_url: None,
        sign_secret: None,
    })
}

/// 向任意 URL（含 sessionWebhook）POST 机器人消息体。
pub fn post_robot_body(url: &str, body: &Value) -> Result<SendMessageResult, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("reply url is empty".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("Giteam/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(url)
        .json(body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let value: Value = resp.json().unwrap_or_else(|_| json!({}));
    let errcode = value.get("errcode").and_then(Value::as_i64).unwrap_or(if status.is_success() {
        0
    } else {
        -1
    });
    let errmsg = value
        .get("errmsg")
        .and_then(Value::as_str)
        .unwrap_or(if status.is_success() { "ok" } else { "request failed" })
        .to_string();
    Ok(SendMessageResult {
        ok: errcode == 0 || status.is_success(),
        errcode,
        errmsg,
    })
}

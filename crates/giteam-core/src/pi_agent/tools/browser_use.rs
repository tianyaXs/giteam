//! `browser_use`：agent 驱动内置浏览器（navigate/click/type/read_dom/eval_read/screenshot）。
//!
//! 复用 web 工具的 SSRF 防护与不可信围栏（`fence`）：navigate 前用 `is_ssrf_allow_loopback`
//! 校验私网/链路本地（loopback 放行——浏览器打开本地 dev server 是核心场景）；返回的
//! DOM/文本统一包进 `<untrusted_web_content>` 防 prompt injection。
//! 实际操作经 `BrowserController` 抽象落到 desktop 的内置 webview（CLI/control 无
//! controller 时返回「仅桌面端可用」）。
//!
//! 归 `InteractionRisk::Network`（见 interactions.rs `for_tool`），经工厂 `wrap` 自动
//! 套 `ApprovalTool`，复用整套审批 UI 与域名级 `always_rule_key` 放行。

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;
use std::sync::Arc;

use super::super::browser_controller::{BrowserAction, BrowserController};
use super::approval::denied_output;
use super::web::{fence, is_ssrf_allow_loopback, text_output};

pub struct BrowserUseTool {
    controller: Option<Arc<dyn BrowserController>>,
}

impl BrowserUseTool {
    #[must_use]
    pub fn new(controller: Option<Arc<dyn BrowserController>>) -> Self {
        Self { controller }
    }
}

impl Default for BrowserUseTool {
    fn default() -> Self {
        Self::new(None)
    }
}

/// 从输入解析操作；错误字符串交调用方转 `denied_output`。
fn parse_action(input: &Value) -> std::result::Result<BrowserAction, String> {
    let action = input.get("action").and_then(Value::as_str).unwrap_or("");
    let get_str = |key: &str| {
        input
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    match action {
        "navigate" => {
            let url = get_str("url").ok_or_else(|| "navigate 需要 url".to_string())?;
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err("url 必须是 http(s) 协议".to_string());
            }
            if is_ssrf_allow_loopback(url) {
                return Err("目标地址属于私网/链路本地，已拒绝（SSRF 防护；loopback 已放行）".to_string());
            }
            Ok(BrowserAction::Navigate { url: url.to_string() })
        }
        "click" => Ok(BrowserAction::Click {
            selector: get_str("selector").ok_or_else(|| "click 需要 selector".to_string())?.to_string(),
        }),
        "type" => {
            let selector = get_str("selector")
                .ok_or_else(|| "type 需要 selector".to_string())?
                .to_string();
            let text = input.get("text").and_then(Value::as_str).unwrap_or("").to_string();
            Ok(BrowserAction::Type { selector, text })
        }
        "read_dom" => Ok(BrowserAction::ReadDom {
            selector: get_str("selector").map(str::to_string),
        }),
        "eval_read" => Ok(BrowserAction::EvalRead {
            js: get_str("js").ok_or_else(|| "eval_read 需要 js".to_string())?.to_string(),
        }),
        "screenshot" => Ok(BrowserAction::Screenshot),
        other => Err(format!("未知 action：{other}")),
    }
}

/// 解析 dataURL（`data:<mime>;base64,<data>`）为 `(mime, base64_data)`。
/// screenshot 回传的 image 是 dataURL，pi 的 `ImageContent.data` 需纯 base64。
fn parse_data_url(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("data:")?;
    let (header, data) = rest.split_once(',')?;
    let mime = header
        .split(';')
        .next()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "image/png".to_string());
    Some((mime, data.to_string()))
}

#[async_trait]
impl Tool for BrowserUseTool {
    fn name(&self) -> &str {
        "browser_use"
    }

    fn label(&self) -> &str {
        "BrowserUse"
    }

    fn description(&self) -> &str {
        "Drive the built-in browser the user is viewing: navigate to a URL, click an element, type text, read DOM text, run read-only JS, or take a screenshot. Use for reproducing or verifying local web apps. Only http(s) URLs (SSRF-guarded); returned content is wrapped in an untrusted fence."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["navigate", "click", "type", "read_dom", "eval_read", "screenshot"],
                    "description": "要执行的操作"
                },
                "url": {"type": "string", "description": "navigate 时的目标 http(s) URL"},
                "selector": {"type": "string", "description": "click/type/read_dom 的 CSS 选择器"},
                "text": {"type": "string", "description": "type 时输入的文本"},
                "js": {"type": "string", "description": "eval_read 时执行的只读 JS 表达式（返回值序列化返回）"}
            },
            "required": ["action"]
        })
    }

    fn effects(&self) -> ToolEffects {
        // 操作共享 webview 且触网，必须串行（scheduler 不并发）。
        ToolEffects::network()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let Some(controller) = &self.controller else {
            return Ok(denied_output("browser_use", "内置浏览器仅在桌面端可用"));
        };
        let action_str = input.get("action").and_then(Value::as_str).unwrap_or("").to_string();
        let action = match parse_action(&input) {
            Ok(action) => action,
            Err(message) => return Ok(denied_output("browser_use", &message)),
        };
        let result = controller.execute(action).await;
        if !result.ok {
            return Ok(denied_output(
                "browser_use",
                result.error.as_deref().unwrap_or("操作失败"),
            ));
        }
        let details = Some(serde_json::json!({
            "kind": "browser_use",
            "action": action_str,
        }));
        // screenshot 返回 image content block（dataURL → base64 + mime）。
        if let Some(data_url) = result.image.as_deref() {
            if let Some((mime, data)) = parse_data_url(data_url) {
                return Ok(ToolOutput {
                    content: vec![pi::sdk::ContentBlock::Image(pi::sdk::ImageContent {
                        data,
                        mime_type: mime,
                    })],
                    details,
                    is_error: false,
                });
            }
        }
        let body = result.text.unwrap_or_else(|| "ok".to_string());
        Ok(text_output(
            fence(&format!("browser_use — {action_str}"), &body),
            details,
        ))
    }
}

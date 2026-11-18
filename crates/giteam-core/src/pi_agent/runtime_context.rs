//! 运行时上下文快照：动态段（sandbox / digest / mode policy）以可 supersede 的
//! Custom 消息注入模型，不写入用户正文，避免历史膨胀与 UI/抽取污染。
//!
//! 对齐 dsh RuntimeContextProjection：仅内容变化时写入；旧快照 display=false
//! 退出模型上下文；用户可见路径统一剥离遗留的 `# Runtime Context` 文本。

use pi::sdk::{CustomMessage, Message};

/// 持久 Custom 消息的类型标记（事件/历史可识别并过滤）。
pub const RUNTIME_CONTEXT_CUSTOM_TYPE: &str = "giteam.runtime_context";

/// 清空标记：曾有快照、现为空时写入，声明旧上下文失效。
pub const RUNTIME_CONTEXT_CLEARED: &str =
    "Current runtime context: none. Earlier runtime-context snapshots no longer apply.";

const RUNTIME_CONTEXT_HEADING: &str = "# Runtime Context";

/// 跟踪本会话已保留的 runtime snapshot 文本。
#[derive(Debug, Default, Clone)]
pub struct RuntimeContextProjection {
    /// `None` = 从未写入；`Some(text)` = 当前生效快照（含 CLEARED）。
    retained: Option<String>,
}

impl RuntimeContextProjection {
    #[must_use]
    pub fn retained(&self) -> Option<&str> {
        self.retained.as_deref()
    }

    /// 若 `current` 与已保留文本不同，返回应写入的 Custom 消息内容。
    /// 空且从未写入 → 跳过；空且曾写入 → CLEARED；非空且变化 → 新快照。
    pub fn project(&mut self, current: &str) -> Option<String> {
        let snapshot = if current.trim().is_empty() {
            if self.retained.is_none() {
                return None;
            }
            RUNTIME_CONTEXT_CLEARED.to_string()
        } else {
            current.to_string()
        };
        if self.retained.as_deref() == Some(snapshot.as_str()) {
            return None;
        }
        self.retained = Some(snapshot.clone());
        Some(snapshot)
    }
}

/// 组装当次动态段正文（不含用户正文）。
/// 顺序固定：sandbox → digest → extra（慢变策略靠前，利于前缀缓存）。
#[must_use]
pub fn build_runtime_snapshot(
    sandbox_policy: Option<String>,
    digest: Option<String>,
    extra: Option<&str>,
) -> String {
    let parts: Vec<String> = sandbox_policy
        .into_iter()
        .chain(digest)
        .chain(extra.map(str::to_string))
        .filter(|part| !part.trim().is_empty())
        .collect();
    if parts.is_empty() {
        return String::new();
    }
    let mut out = Vec::with_capacity(parts.len() + 1);
    out.push(
        format!("{RUNTIME_CONTEXT_HEADING}\n\n以下运行时快照适用于当前请求，不是用户正文的字面内容。")
            .to_string(),
    );
    out.extend(parts);
    out.join("\n\n")
}

/// 构造写入会话的 Custom 消息（display=true 才会进入模型上下文）。
#[must_use]
pub fn runtime_context_message(content: String, timestamp_ms: i64) -> Message {
    Message::Custom(CustomMessage {
        content,
        custom_type: RUNTIME_CONTEXT_CUSTOM_TYPE.to_string(),
        display: true,
        details: None,
        timestamp: timestamp_ms,
    })
}

/// 从用户可见/抽取/标题路径剥离遗留 Runtime Context 段与标签块。
#[must_use]
pub fn strip_runtime_context(text: &str) -> String {
    let mut value = text.to_string();
    // 新格式：独立 Custom 不应进 user 正文；仍剥离历史拼进 user 的旧段。
    if let Some(idx) = value.find(RUNTIME_CONTEXT_HEADING) {
        value.truncate(idx);
    }
    if let Some(idx) = value.find("<runtime_context>") {
        if let Some(end) = value[idx..].find("</runtime_context>") {
            let end_abs = idx + end + "</runtime_context>".len();
            value = format!("{}{}", &value[..idx], &value[end_abs..]);
        } else {
            value.truncate(idx);
        }
    }
    // 清空标记整段。
    if value.trim() == RUNTIME_CONTEXT_CLEARED {
        return String::new();
    }
    value
        .lines()
        .filter(|line| !line.contains(RUNTIME_CONTEXT_CLEARED))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_skips_unchanged_and_emits_cleared() {
        let mut proj = RuntimeContextProjection::default();
        assert!(proj.project("").is_none());
        assert_eq!(proj.project("A").as_deref(), Some("A"));
        assert!(proj.project("A").is_none());
        assert_eq!(
            proj.project("").as_deref(),
            Some(RUNTIME_CONTEXT_CLEARED)
        );
        assert!(proj.project("").is_none());
    }

    #[test]
    fn build_orders_sandbox_before_digest_before_extra() {
        let text = build_runtime_snapshot(
            Some("SANDBOX".into()),
            Some("DIGEST".into()),
            Some("POLICY"),
        );
        let sandbox = text.find("SANDBOX").unwrap();
        let digest = text.find("DIGEST").unwrap();
        let policy = text.find("POLICY").unwrap();
        assert!(text.starts_with(RUNTIME_CONTEXT_HEADING));
        assert!(sandbox < digest);
        assert!(digest < policy);
        assert!(text.ends_with("POLICY"));
    }

    #[test]
    fn strip_removes_legacy_user_embedded_runtime() {
        let raw = "帮我修 bug\n\n# Runtime Context\n\nDIGEST\n\nPOLICY";
        assert_eq!(strip_runtime_context(raw), "帮我修 bug");
        assert_eq!(
            strip_runtime_context("hello\n<runtime_context>\nx\n</runtime_context>\n"),
            "hello"
        );
    }
}

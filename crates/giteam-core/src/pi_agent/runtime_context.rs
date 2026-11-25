//! 运行时上下文快照：动态段（sandbox / digest / mode policy）以 append-only 的
//! Custom 消息注入模型，不写入用户正文，避免 UI/抽取污染。
//!
//! 会话条目是持久事实，pi 会按持久化/内存指纹校验，禁止回改旧快照的 display。
//! 这里只做内容变化去重；sandbox/digest/mode 属低频状态，少量追加可接受。
//! 用户可见路径统一剥离遗留的 `# Runtime Context` 文本。

use pi::sdk::{CustomMessage, Message};

/// 持久 Custom 消息的类型标记（事件/历史可识别并过滤）。
pub const RUNTIME_CONTEXT_CUSTOM_TYPE: &str = "giteam.runtime_context";

/// 标题派生时跳过的附件注入提示（与桌面 `formatLocalFileAttachmentHint` /
/// `formatUiOnlyFileAttachmentHint` 文案保持同源；标题只应来自用户真实输入）。
pub(crate) const ATTACHMENT_HINT_TITLE_MARKER: &str = "The user attached a file named \"";
const ATTACHMENT_HINT_LINE_PATTERNS: [&str; 2] = [
  "The user attached a local file named \"",
  "The user attached a file named \"",
];

/// 标题派生用：在 `strip_runtime_context` 之上再剥附件注入段。
///
/// 这些段与用户输入拼在同一条 user text 里（桌面发送组装），可能是「仅说明
/// 不携带正文」的 hint，也可能是 `<attachment_content>` 内联正文块。标题只
/// 应来自用户真实输入，因此按行扫描并用状态机整段跳过，而不是逐行匹配。
#[must_use]
pub fn strip_runtime_context_for_title(text: &str) -> String {
  let stripped = strip_runtime_context(text);
  let mut kept: Vec<&str> = Vec::new();
  let mut title_from_attachment: Option<String> = None;
  // attachment 标签内的正文属于注入文档，不是用户输入，整块跳过。
  let mut in_attachment_body = false;
  for line in stripped.lines() {
    let trimmed = line.trim_start();
    if trimmed.starts_with("<attachment_content") {
      in_attachment_body = true;
      continue;
    }
    if in_attachment_body {
      if trimmed == "</attachment_content>" {
        in_attachment_body = false;
      }
      continue;
    }
    if let Some(name) = attachment_hint_filename(trimmed) {
      if title_from_attachment.is_none() {
        title_from_attachment = Some(name.to_string());
      }
      continue;
    }
    // hint 的后续说明行（Embedded…/Local path/Use the appropriate…/不可用提示）。
    if trimmed.starts_with("Embedded attachment contents follow:")
      || trimmed.starts_with("Local path: ")
      || trimmed.starts_with("Use the appropriate Pi tool ")
      || trimmed.starts_with(
        "The attachment was selected in the desktop UI but is not available",
      )
    {
      continue;
    }
    kept.push(line);
  }
  // 仅附件消息没有正文可作标题：回退第一个 hint 文件名，
  // 否则重启后 derive_* 返回 None，列表只能退化成 `Session <id前缀>`。
  if kept.iter().all(|line| line.trim().is_empty()) {
    return title_from_attachment.unwrap_or_default();
  }
  kept.join("\n")
}

/// 匹配附件 hint 行并返回其中的文件名；不匹配时返回 None。
fn attachment_hint_filename(line: &str) -> Option<&str> {
  let trimmed = line.trim_start();
  for prefix in ATTACHMENT_HINT_LINE_PATTERNS {
    let Some(rest) = trimmed.strip_prefix(prefix) else {
      continue;
    };
    let end = rest.find('"')?;
    let name = rest[..end].trim();
    return if name.is_empty() { None } else { Some(name) };
  }
  None
}

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

//! 自动化运行结果通知：系统通知或钉钉 Webhook。

use super::runner::RunOutcome;
use super::scheduler::NotifyHook;
use super::types::{effective_notify_channel, has_dingtalk_webhook, AutomationTask, NotifyChannel};
use crate::dingtalk::{send_message, SendMessageRequest};

/// 钉钉自定义机器人消息上限约 20000 字节；预留分段标记与 title 开销。
const DINGTALK_TEXT_MAX_BYTES: usize = 18_000;

fn task_notify_heading(task: &AutomationTask, notify_title: &str) -> String {
    let raw = notify_title.trim();
    if raw.starts_with("任务：") || raw.starts_with("任务:") {
        return if raw.starts_with("任务:") {
            format!("任务：{}", raw["任务:".len()..].trim())
        } else {
            raw.to_string()
        };
    }
    if raw.starts_with("自动化：") || raw.starts_with("自动化:") {
        let rest = raw
            .trim_start_matches("自动化：")
            .trim_start_matches("自动化:");
        return format!("任务：{}", rest.trim());
    }
    let title = task.title.trim();
    if title.is_empty() {
        "任务".to_string()
    } else {
        format!("任务：{title}")
    }
}

/// 按 UTF-8 字节上限切分，尽量在换行处断开。
fn chunk_utf8_by_bytes(text: &str, max_bytes: usize) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    if text.len() <= max_bytes {
        return vec![text.to_string()];
    }
    let mut chunks = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        if rest.len() <= max_bytes {
            chunks.push(rest.to_string());
            break;
        }
        let mut end = max_bytes.min(rest.len());
        while end > 0 && !rest.is_char_boundary(end) {
            end -= 1;
        }
        if end == 0 {
            let ch = rest.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
            end = ch.min(rest.len());
        }
        let mut split = end;
        if let Some(rel) = rest[..end].rfind('\n') {
            if rel >= max_bytes / 4 {
                split = rel + 1;
            }
        }
        while split > 0 && !rest.is_char_boundary(split) {
            split -= 1;
        }
        if split == 0 {
            split = end;
        }
        chunks.push(rest[..split].trim_end().to_string());
        rest = rest[split..].trim_start();
    }
    chunks.retain(|c| !c.is_empty());
    if chunks.is_empty() {
        vec![text.chars().take(200).collect()]
    } else {
        chunks
    }
}

/// 表格行较多时钉钉 markdown 效果差，改走 text。
fn prefers_plain_text(summary: &str) -> bool {
    let table_rows = summary
        .lines()
        .filter(|line| {
            let t = line.trim();
            t.starts_with('|') && t.matches('|').count() >= 2
        })
        .count();
    table_rows >= 3
}

/// 收敛为钉钉 markdown 子集：去掉围栏代码块、弱化表格行、规范换行。
fn sanitize_for_dingtalk_markdown(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut in_fence = false;
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            if in_fence {
                out.push_str("> ");
                let lang = trimmed.trim_start_matches('`').trim();
                if !lang.is_empty() {
                    out.push_str(lang);
                    out.push(' ');
                }
                out.push_str("代码\n\n");
            } else {
                out.push('\n');
            }
            continue;
        }
        if in_fence {
            out.push_str("> ");
            out.push_str(line);
            out.push('\n');
            continue;
        }
        // 表格分隔行跳过；普通表行改成列表，避免糊成一条
        let t = line.trim();
        if t.starts_with('|') && t.matches('|').count() >= 2 {
            if t.chars().all(|c| matches!(c, '|' | '-' | ':' | ' ' | '\t')) {
                continue;
            }
            let cells: Vec<&str> = t
                .trim_matches('|')
                .split('|')
                .map(str::trim)
                .filter(|c| !c.is_empty())
                .collect();
            if !cells.is_empty() {
                out.push_str("- ");
                out.push_str(&cells.join(" · "));
                out.push('\n');
            }
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    // 钉钉建议换行前后加两个空格，便于客户端折行
    out.lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("  \n")
        .trim()
        .to_string()
}

fn build_markdown_body(heading: &str, summary: &str) -> String {
    let body = if summary.is_empty() {
        "已完成".to_string()
    } else {
        sanitize_for_dingtalk_markdown(summary)
    };
    format!("### {heading}\n\n{body}")
}

fn build_plain_body(heading: &str, summary: &str) -> String {
    if summary.is_empty() {
        format!("{heading}\n\n已完成")
    } else {
        format!("{heading}\n\n{summary}")
    }
}

fn send_dingtalk(
    webhook: &str,
    sign_secret: Option<String>,
    msgtype: &str,
    title: Option<&str>,
    content: &str,
) -> Result<(), String> {
    let req = SendMessageRequest {
        msgtype: msgtype.into(),
        content: content.to_string(),
        title: title.map(str::to_string),
        at_all: false,
        at_mobiles: Vec::new(),
        webhook_url: Some(webhook.to_string()),
        sign_secret,
    };
    match send_message(&req) {
        Ok(r) if r.ok => Ok(()),
        Ok(r) => Err(format!("errcode={} {}", r.errcode, r.errmsg)),
        Err(err) => Err(err),
    }
}

fn deliver_dingtalk_markdown(
    webhook: &str,
    sign_secret: Option<String>,
    title: &str,
    summary: &str,
) -> Result<(), String> {
    let body = if summary.is_empty() {
        "已完成".to_string()
    } else {
        sanitize_for_dingtalk_markdown(summary)
    };
    // 预留标题行开销后再切分正文
    let reserve = format!("### {title}（99/99）\n\n").len() + 32;
    let max = DINGTALK_TEXT_MAX_BYTES.saturating_sub(reserve).max(1024);
    let chunks = chunk_utf8_by_bytes(&body, max);
    let total = chunks.len();
    for (idx, chunk) in chunks.into_iter().enumerate() {
        let (part_title, text) = if total > 1 {
            (
                format!("{title}（{}/{}）", idx + 1, total),
                format!("### {title}（{}/{}）\n\n{chunk}", idx + 1, total),
            )
        } else {
            (title.to_string(), format!("### {title}\n\n{chunk}"))
        };
        send_dingtalk(
            webhook,
            sign_secret.clone(),
            "markdown",
            Some(&part_title),
            &text,
        )?;
    }
    Ok(())
}

fn deliver_dingtalk_text(
    webhook: &str,
    sign_secret: Option<String>,
    title: &str,
    summary: &str,
) -> Result<(), String> {
    let content = build_plain_body(title, summary);
    let chunks = chunk_utf8_by_bytes(&content, DINGTALK_TEXT_MAX_BYTES);
    let total = chunks.len();
    for (idx, chunk) in chunks.into_iter().enumerate() {
        let body = if total > 1 {
            format!("（{}/{}）\n{chunk}", idx + 1, total)
        } else {
            chunk
        };
        send_dingtalk(webhook, sign_secret.clone(), "text", None, &body)?;
    }
    Ok(())
}

/// 按任务配置投递通知（桌面 hook 或钉钉 Webhook）。失败时返回错误描述。
pub fn deliver_run_notification(
    outcome: &RunOutcome,
    desktop_hook: Option<&NotifyHook>,
) -> Option<String> {
    if !outcome.should_notify {
        if has_dingtalk_webhook(&outcome.task) {
            eprintln!(
                "[automation] notify skipped despite webhook: should_notify=false success={} failure={} channel={:?}",
                outcome.task.notify_on_success,
                outcome.task.notify_on_failure,
                outcome.task.notify_channel,
            );
        }
        return None;
    }
    let heading = task_notify_heading(&outcome.task, &outcome.notify_title);
    let summary = outcome.notify_body.trim();
    match effective_notify_channel(&outcome.task) {
        NotifyChannel::Desktop => {
            if let Some(hook) = desktop_hook {
                let desktop_body = if summary.chars().count() > 280 {
                    let short: String = summary.chars().take(279).collect();
                    format!("{short}…")
                } else if summary.is_empty() {
                    "已完成".to_string()
                } else {
                    summary.to_string()
                };
                hook(&heading, &desktop_body);
            }
            None
        }
        NotifyChannel::DingTalk => {
            let webhook = outcome
                .task
                .dingtalk_webhook_url
                .as_deref()
                .map(str::trim)
                .unwrap_or("");
            if webhook.is_empty() {
                let err = "钉钉 Webhook 未配置".to_string();
                eprintln!("[automation] dingtalk notify skipped: webhook missing");
                return Some(err);
            }
            let sign_secret = outcome
                .task
                .dingtalk_sign_secret
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            let use_markdown = !prefers_plain_text(summary);
            if use_markdown {
                match deliver_dingtalk_markdown(
                    webhook,
                    sign_secret.clone(),
                    &heading,
                    summary,
                ) {
                    Ok(()) => return None,
                    Err(err) => {
                        eprintln!(
                            "[automation] dingtalk markdown failed, fallback to text: {err}"
                        );
                    }
                }
            }

            match deliver_dingtalk_text(webhook, sign_secret, &heading, summary) {
                Ok(()) => None,
                Err(err) => {
                    eprintln!("[automation] dingtalk notify failed: {err}");
                    Some(err)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::types::{
        AutomationTask, NotifyChannel, RunStatus, ScheduleKind, SessionMode,
    };

    fn sample_task(title: &str) -> AutomationTask {
        AutomationTask {
            id: "t".into(),
            title: title.into(),
            goal_prompt: "g".into(),
            repo_path: "/tmp".into(),
            session_mode: SessionMode::New,
            session_id: None,
            provider: None,
            model: None,
            thinking_level: None,
            schedule_kind: ScheduleKind::Interval,
            schedule_expr: "3600".into(),
            timezone: "local".into(),
            notify_on_success: true,
            notify_on_failure: true,
            notify_channel: NotifyChannel::DingTalk,
            dingtalk_webhook_url: Some("https://example.com".into()),
            dingtalk_sign_secret: None,
            enabled: true,
            next_run_at_ms: None,
            last_run_at_ms: None,
            last_viewed_run_at_ms: None,
            last_status: Some(RunStatus::Success.as_str().to_string()),
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn notify_heading_uses_task_prefix_and_rewrites_legacy_automation() {
        let task = sample_task("每日简报");
        assert_eq!(
            task_notify_heading(&task, "自动化：每日简报"),
            "任务：每日简报"
        );
        assert_eq!(task_notify_heading(&task, "每日简报"), "任务：每日简报");
        assert_eq!(
            task_notify_heading(&task, "任务：每日简报"),
            "任务：每日简报"
        );
    }

    #[test]
    fn chunk_utf8_splits_long_content_without_breaking_chars() {
        let long = "中文摘要。".repeat(5000);
        assert!(long.len() > DINGTALK_TEXT_MAX_BYTES);
        let chunks = chunk_utf8_by_bytes(&long, DINGTALK_TEXT_MAX_BYTES);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(chunk.len() <= DINGTALK_TEXT_MAX_BYTES);
            assert!(!chunk.is_empty());
        }
        assert_eq!(chunks.concat().replace('\n', ""), long.replace('\n', ""));
    }

    #[test]
    fn sanitize_strips_fences_and_softens_tables() {
        let raw = "结论\n```rust\nfn main() {}\n```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n**完成**";
        let out = sanitize_for_dingtalk_markdown(raw);
        assert!(!out.contains("```"));
        assert!(out.contains("代码"));
        assert!(out.contains("- a · b") || out.contains("- 1 · 2"));
        assert!(out.contains("**完成**"));
        assert!(!prefers_plain_text("只有一行 | a | b |"));
        assert!(prefers_plain_text(
            "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |"
        ));
    }

    #[test]
    fn markdown_body_includes_heading() {
        let body = build_markdown_body("任务：日报", "今天完成了 **两件事**");
        assert!(body.starts_with("### 任务：日报"));
        assert!(body.contains("**两件事**"));
    }
}

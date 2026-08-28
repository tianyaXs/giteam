//! 自动化运行结果通知：系统通知或钉钉 Webhook。

use super::runner::RunOutcome;
use super::scheduler::NotifyHook;
use super::types::{effective_notify_channel, has_dingtalk_webhook, AutomationTask, NotifyChannel};
use crate::dingtalk::{send_message, SendMessageRequest};

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
    let content = if summary.is_empty() {
        format!("{heading}\n\n已完成")
    } else {
        format!("{heading}\n\n{summary}")
    };
    match effective_notify_channel(&outcome.task) {
        NotifyChannel::Desktop => {
            if let Some(hook) = desktop_hook {
                hook(&heading, summary);
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
            let req = SendMessageRequest {
                msgtype: "text".into(),
                content,
                title: None,
                at_all: false,
                at_mobiles: Vec::new(),
                webhook_url: Some(webhook.to_string()),
                sign_secret,
            };
            match send_message(&req) {
                Ok(r) if r.ok => None,
                Ok(r) => {
                    let err = format!("errcode={} {}", r.errcode, r.errmsg);
                    eprintln!("[automation] dingtalk notify failed: {err}");
                    Some(err)
                }
                Err(err) => {
                    eprintln!("[automation] dingtalk notify error: {err}");
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
}

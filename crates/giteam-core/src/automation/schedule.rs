//! 调度表达式解析与下次运行时间计算。
//!
//! MVP 支持：
//! - `interval`：`schedule_expr` = 秒数（正整数）
//! - `once_at`：RFC3339 / 本地 `YYYY-MM-DDTHH:MM` / 纯毫秒时间戳
//! - `cron`：5 段 `分 时 日 月 周`；周支持 `*` / `1-5` / 单值 / 逗号列表（0=周日）

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc, Weekday};

use super::types::{ScheduleKind, ScheduleOverride};
use super::AutomationError;

/// 计算 `after_ms` 之后的下一次触发时间（毫秒 epoch）。
pub fn compute_next_run_at(
    kind: ScheduleKind,
    expr: &str,
    after_ms: i64,
) -> Result<Option<i64>, AutomationError> {
    compute_next_run_at_with_overrides(kind, expr, after_ms, &[])
}

/// 带日历例外：跳过被挪走的 origin 日源触发，并纳入目标时刻。
pub fn compute_next_run_at_with_overrides(
    kind: ScheduleKind,
    expr: &str,
    after_ms: i64,
    overrides: &[ScheduleOverride],
) -> Result<Option<i64>, AutomationError> {
    let expr = expr.trim();
    if expr.is_empty() {
        return Err(AutomationError::InvalidInput(
            "schedule_expr is required".into(),
        ));
    }
    match kind {
        ScheduleKind::Interval => next_interval(expr, after_ms),
        ScheduleKind::OnceAt => next_once_at(expr, after_ms),
        ScheduleKind::Cron => next_cron_with_overrides(expr, after_ms, overrides),
    }
}

fn next_interval(expr: &str, after_ms: i64) -> Result<Option<i64>, AutomationError> {
    let secs: i64 = expr
        .parse()
        .map_err(|_| AutomationError::InvalidInput(format!("invalid interval seconds: {expr}")))?;
    if secs <= 0 {
        return Err(AutomationError::InvalidInput(
            "interval must be a positive number of seconds".into(),
        ));
    }
    Ok(Some(after_ms.saturating_add(secs.saturating_mul(1000))))
}

fn next_once_at(expr: &str, after_ms: i64) -> Result<Option<i64>, AutomationError> {
    let target = parse_once_at_ms(expr)?;
    if target > after_ms {
        Ok(Some(target))
    } else {
        Ok(None)
    }
}

fn parse_once_at_ms(expr: &str) -> Result<i64, AutomationError> {
    if let Ok(ms) = expr.parse::<i64>() {
        if ms > 1_000_000_000_000 {
            return Ok(ms);
        }
        if ms > 1_000_000_000 {
            return Ok(ms * 1000);
        }
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(expr) {
        return Ok(dt.timestamp_millis());
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(expr, "%Y-%m-%dT%H:%M") {
        return Ok(Local
            .from_local_datetime(&naive)
            .single()
            .ok_or_else(|| AutomationError::InvalidInput(format!("ambiguous local time: {expr}")))?
            .timestamp_millis());
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(expr, "%Y-%m-%dT%H:%M:%S") {
        return Ok(Local
            .from_local_datetime(&naive)
            .single()
            .ok_or_else(|| AutomationError::InvalidInput(format!("ambiguous local time: {expr}")))?
            .timestamp_millis());
    }
    Err(AutomationError::InvalidInput(format!(
        "invalid once_at expression: {expr}"
    )))
}

#[derive(Debug, Clone)]
struct CronField {
    /// None = any (*)
    values: Option<Vec<u32>>,
}

impl CronField {
    fn matches(&self, value: u32) -> bool {
        match &self.values {
            None => true,
            Some(list) => list.contains(&value),
        }
    }
}

struct CronExpr {
    minute: CronField,
    hour: CronField,
    day: CronField,
    month: CronField,
    weekday: CronField,
}

fn parse_cron(expr: &str) -> Result<CronExpr, AutomationError> {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != 5 {
        return Err(AutomationError::InvalidInput(
            "cron must have 5 fields: minute hour day month weekday".into(),
        ));
    }
    Ok(CronExpr {
        minute: parse_field(parts[0], 0, 59)?,
        hour: parse_field(parts[1], 0, 23)?,
        day: parse_field(parts[2], 1, 31)?,
        month: parse_field(parts[3], 1, 12)?,
        weekday: parse_field(parts[4], 0, 6)?,
    })
}

fn parse_field(raw: &str, min: u32, max: u32) -> Result<CronField, AutomationError> {
    if raw == "*" {
        return Ok(CronField { values: None });
    }
    let mut values = Vec::new();
    for token in raw.split(',') {
        if let Some((a, b)) = token.split_once('-') {
            let start: u32 = a.parse().map_err(|_| {
                AutomationError::InvalidInput(format!("invalid cron range: {token}"))
            })?;
            let end: u32 = b.parse().map_err(|_| {
                AutomationError::InvalidInput(format!("invalid cron range: {token}"))
            })?;
            if start > end || start < min || end > max {
                return Err(AutomationError::InvalidInput(format!(
                    "cron range out of bounds: {token}"
                )));
            }
            values.extend(start..=end);
        } else {
            let v: u32 = token.parse().map_err(|_| {
                AutomationError::InvalidInput(format!("invalid cron value: {token}"))
            })?;
            if v < min || v > max {
                return Err(AutomationError::InvalidInput(format!(
                    "cron value out of bounds: {token}"
                )));
            }
            values.push(v);
        }
    }
    values.sort_unstable();
    values.dedup();
    Ok(CronField {
        values: Some(values),
    })
}

fn weekday_num(wd: Weekday) -> u32 {
    match wd {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

fn format_local_date(date: NaiveDate) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        date.month(),
        date.day()
    )
}

fn parse_origin_date(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok()
}

fn override_target_ms(ovr: &ScheduleOverride) -> Option<i64> {
    let origin = parse_origin_date(&ovr.origin_date)?;
    let target_date = origin + chrono::Duration::days(i64::from(ovr.day_offset));
    let hour = ovr.hour.min(23);
    let minute = ovr.minute.min(59);
    let naive = target_date.and_hms_opt(hour, minute, 0)?;
    Local
        .from_local_datetime(&naive)
        .single()
        .map(|dt| dt.timestamp_millis())
}

fn next_cron_with_overrides(
    expr: &str,
    after_ms: i64,
    overrides: &[ScheduleOverride],
) -> Result<Option<i64>, AutomationError> {
    let cron = parse_cron(expr)?;
    let after = Utc
        .timestamp_millis_opt(after_ms)
        .single()
        .unwrap_or_else(Utc::now);
    let after_local = after.with_timezone(&Local);
    // 从下一分钟起扫描，最多扫 366 天 * 24 * 60 分钟（安全上限）
    let mut cursor = after_local
        .with_second(0)
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(after_local)
        + chrono::Duration::minutes(1);

    let mut next_base: Option<i64> = None;
    for _ in 0..(366 * 24 * 60) {
        let minute = cursor.minute();
        let hour = cursor.hour();
        let day = cursor.day();
        let month = cursor.month();
        let wd = weekday_num(cursor.weekday());
        if cron.minute.matches(minute)
            && cron.hour.matches(hour)
            && cron.day.matches(day)
            && cron.month.matches(month)
            && cron.weekday.matches(wd)
        {
            let date_key = format_local_date(cursor.date_naive());
            let overridden = overrides.iter().any(|o| o.origin_date == date_key);
            if !overridden {
                next_base = Some(cursor.timestamp_millis());
                break;
            }
        }
        cursor += chrono::Duration::minutes(1);
    }

    let mut next_override: Option<i64> = None;
    for ovr in overrides {
        let Some(ms) = override_target_ms(ovr) else {
            continue;
        };
        if ms <= after_ms {
            continue;
        }
        next_override = Some(match next_override {
            Some(cur) => cur.min(ms),
            None => ms,
        });
    }

    Ok(match (next_base, next_override) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    })
}

/// UI 预设 → (kind, expr)
pub fn preset_daily(hour: u32, minute: u32) -> (ScheduleKind, String) {
    (ScheduleKind::Cron, format!("{minute} {hour} * * *"))
}

pub fn preset_weekdays(hour: u32, minute: u32) -> (ScheduleKind, String) {
    (ScheduleKind::Cron, format!("{minute} {hour} * * 1-5"))
}

pub fn preset_weekly(weekday: u32, hour: u32, minute: u32) -> (ScheduleKind, String) {
    (ScheduleKind::Cron, format!("{minute} {hour} * * {weekday}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_adds_seconds() {
        let next = compute_next_run_at(ScheduleKind::Interval, "60", 1_000).unwrap();
        assert_eq!(next, Some(61_000));
    }

    #[test]
    fn once_at_past_returns_none() {
        let next =
            compute_next_run_at(ScheduleKind::OnceAt, "1700000000000", 1_800_000_000_000).unwrap();
        assert_eq!(next, None);
    }

    #[test]
    fn cron_weekdays_parses() {
        let next = compute_next_run_at(ScheduleKind::Cron, "0 9 * * 1-5", 0).unwrap();
        assert!(next.is_some());
    }

    #[test]
    fn rejects_bad_cron() {
        assert!(compute_next_run_at(ScheduleKind::Cron, "0 9", 0).is_err());
    }

    #[test]
    fn cron_override_skips_origin_and_uses_target() {
        // 固定本地「今天」之后的下一次：构造一个明确的 origin。
        let after = Local
            .with_ymd_and_hms(2026, 11, 18, 8, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        // 源：每天 9:00；把 11-18 挪到 14:00
        let overrides = vec![ScheduleOverride {
            origin_date: "2026-11-18".into(),
            day_offset: 0,
            hour: 14,
            minute: 0,
        }];
        let next = compute_next_run_at_with_overrides(
            ScheduleKind::Cron,
            "0 9 * * *",
            after,
            &overrides,
        )
        .unwrap()
        .unwrap();
        let local = Utc
            .timestamp_millis_opt(next)
            .single()
            .unwrap()
            .with_timezone(&Local);
        assert_eq!(local.hour(), 14);
        assert_eq!(format_local_date(local.date_naive()), "2026-11-18");
    }
}

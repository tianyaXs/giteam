//! 钉钉自定义机器人 / Outgoing 加签（HMAC-SHA256）。

use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// 官方发消息加签：`timestamp + "\n" + secret` → HMAC-SHA256 → Base64。
#[must_use]
pub fn sign_payload(timestamp_ms: i64, secret: &str) -> String {
    let string_to_sign = format!("{timestamp_ms}\n{secret}");
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC_SHA256 accepts any key length");
    mac.update(string_to_sign.as_bytes());
    let result = mac.finalize().into_bytes();
    base64::engine::general_purpose::STANDARD.encode(result)
}

/// 把加签拼到 Webhook URL（`timestamp` + `sign` query；sign 需 URL encode）。
#[must_use]
pub fn build_signed_webhook_url(webhook_url: &str, timestamp_ms: i64, secret: &str) -> String {
    let sign = sign_payload(timestamp_ms, secret);
    let encoded = urlencoding::encode(&sign);
    let sep = if webhook_url.contains('?') { '&' } else { '?' };
    format!("{webhook_url}{sep}timestamp={timestamp_ms}&sign={encoded}")
}

/// 校验 Outgoing 回调签名；时间窗默认 ±1 小时（官方约定）。
pub fn verify_outgoing_sign(
    timestamp_ms: i64,
    sign: &str,
    secret: &str,
    now_ms: i64,
) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("outgoing secret not configured".into());
    }
    if (now_ms - timestamp_ms).abs() > 3_600_000 {
        return Err("timestamp out of window".into());
    }
    let expected = sign_payload(timestamp_ms, secret);
    if !constant_time_eq(expected.as_bytes(), sign.trim().as_bytes()) {
        return Err("invalid sign".into());
    }
    Ok(())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_is_stable_and_url_builds() {
        let ts = 1_700_000_000_000_i64;
        let secret = "SECtest";
        let sign = sign_payload(ts, secret);
        assert!(!sign.is_empty());
        let url = build_signed_webhook_url(
            "https://oapi.dingtalk.com/robot/send?access_token=abc",
            ts,
            secret,
        );
        assert!(url.contains(&format!("timestamp={ts}")));
        assert!(url.contains("sign="));
        verify_outgoing_sign(ts, &sign, secret, ts).unwrap();
        assert!(verify_outgoing_sign(ts, "bad", secret, ts).is_err());
    }
}

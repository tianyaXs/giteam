//! 导出脱敏：对即将打包的文本内容做高危串替换。
//!
//! 规则覆盖：OpenAI 风格 `sk-…`、Giteam 自有 token（`gtm_aks_` / `gtm_dev_`）、
//! GitHub token（`ghp_` / `gho_` / `github_pat_`）、AWS AKIA、Bearer 头、私钥块。
//! 处理单位是「整段文本」：调用方对 JSONL 按行喂入（JSON 转义后私钥块仍在同一
//! 逻辑行内），对小文本文件整体喂入。

use regex::Regex;
use std::sync::OnceLock;

const REDACTED: &str = "***REDACTED***";

#[derive(Debug, Clone, Copy, Default)]
pub struct RedactionStats {
    pub hits: u64,
}

fn rules() -> &'static [Regex] {
    static RULES: OnceLock<Vec<Regex>> = OnceLock::new();
    RULES.get_or_init(|| {
        [
            // 私钥块（同一行内；JSONL 中换行已被转义）。
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
            // Giteam 自有凭据。
            r"gtm_(aks|dev)_[0-9a-f]{8,}",
            // OpenAI / Anthropic 风格 key（sk-、sk-ant-、sk-proj- 均以 sk- 开头）。
            r"sk-[A-Za-z0-9_\-]{16,}",
            // GitHub token。
            r"(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}",
            r"github_pat_[A-Za-z0-9_]{22,}",
            // AWS access key id。
            r"AKIA[0-9A-Z]{16}",
            // Bearer 头。
            r"Bearer\s+[A-Za-z0-9._\-+/=]{20,}",
        ]
        .iter()
        .map(|pattern| Regex::new(pattern).expect("redaction regex must compile"))
        .collect()
    })
}

/// 替换文本中的高危串，返回替换后的文本与命中统计。
pub fn redact_text(input: &str, stats: &mut RedactionStats) -> String {
    let mut out = input.to_string();
    for rule in rules() {
        if !rule.is_match(&out) {
            continue;
        }
        let hits = rule.find_iter(&out).count() as u64;
        out = rule.replace_all(&out, REDACTED).into_owned();
        stats.hits += hits;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_secret_shapes() {
        let mut stats = RedactionStats::default();
        let input = "key=sk-abcdefghijklmnopqrstuvwxyz012345 tok=gtm_aks_0123456789abcdef \
                     aws=AKIA0123456789ABCDEF auth=Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def";
        let out = redact_text(input, &mut stats);
        assert!(!out.contains("sk-abcdefghij"));
        assert!(!out.contains("gtm_aks_"));
        assert!(!out.contains("AKIA"));
        assert!(!out.contains("eyJhbGci"));
        assert_eq!(stats.hits, 4);
    }

    #[test]
    fn redacts_private_key_block_on_one_line() {
        let mut stats = RedactionStats::default();
        let input = r"pem: -----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY----- end";
        let out = redact_text(input, &mut stats);
        assert!(out.contains(REDACTED));
        assert!(out.ends_with(" end"));
        assert_eq!(stats.hits, 1);
    }

    #[test]
    fn keeps_benign_text_untouched() {
        let mut stats = RedactionStats::default();
        let input = "cargo test -p giteam-core share -- --nocapture";
        let out = redact_text(input, &mut stats);
        assert_eq!(out, input);
        assert_eq!(stats.hits, 0);
    }
}

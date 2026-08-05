//! 网络工具：`web_fetch`（抓 URL→清洗 markdown）+ `web_search`（搜索）。
//!
//! 两者均只读、不改本地状态，但抓回的外部内容进入 agent context 存在
//! prompt injection 风险，故：(1) 归 `InteractionRisk::Network`，首次审批、
//! 按 `always_rule_key` 域名/后端粒度放行（见 `.giteam/permissions.json`）；
//! (2) 返回内容统一包进 `<untrusted_web_content>` 围栏，配合系统提示词
//! 声明其为不可信数据。`web_fetch` 额外做 SSRF 防护（拒绝 loopback/私网）。
//!
//! HTTP 走 async `reqwest::Client`（rustls-tls），由 pi 的 tokio runtime 驱动
//! `Tool::execute`；reqwest 0.12 本就是 async-first，无需额外 feature。
//! Windows 10057 仅影响 asupersync TLS 栈，reqwest+rustls 直连无碍。

use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::Value;

use super::approval::denied_output;
use super::super::interactions::web_search_backend;

/// `web_fetch` 返回内容的默认字符上限（超出 head+tail 截断）。
const DEFAULT_MAX_CHARS: usize = 20_000;
/// `web_search` 默认返回条数。
const DEFAULT_SEARCH_LIMIT: usize = 5;
/// `web_fetch` 响应体大小上限（防超大响应耗内存）。
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// `web_search` 返回纯文本的字符上限。
const SEARCH_TEXT_LIMIT: usize = 6_000;

// ============================ 共享 helper ============================

/// 构建复用的 async HTTP client：rustls-tls、30s 超时、限重定向、UA 标识。
fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(concat!("Giteam/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client with rustls-tls must build")
}

/// HTML → 类 markdown 纯文本（html2text 容错强；解析失败回退原文）。
fn html_to_text(html: &str) -> String {
    html2text::from_read(html.as_bytes(), 200).unwrap_or_else(|_| html.to_string())
}

/// 超长内容 head+tail 截断 + footer 提示（按字符计数，避免半截多字节）。
fn truncate(text: &str, limit: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= limit {
        return text.to_string();
    }
    let half = limit / 2;
    let head: String = chars[..half].iter().collect();
    let tail: String = chars[chars.len() - half..].iter().collect();
    format!(
        "{head}\n\n…[已截断：完整内容 {total} 字符，仅保留首尾各 {half} 字符]…\n\n{tail}",
        total = chars.len(),
    )
}

/// 提取 host（小写化；忽略端口/路径）。web_fetch 审批键 + 围栏 source 用。
fn domain_of(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1).unwrap_or(url);
    let host = after_scheme.split(['/', ':', '?', '#']).next()?;
    let host = host.trim();
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// SSRF 防护：拒绝 loopback / 私网 / 链路本地 host（MVP 级 host+明文 IP 检查）。
/// DNS rebinding（域名解析到私网 IP）留 TODO——当前只看 host 字符串/明文 IP。
fn is_ssrf(url: &str) -> bool {
    let Some(host) = domain_of(url) else {
        return true; // 无法解析 host 视为危险
    };
    if host == "localhost" || host == "::1" || host.ends_with(".local") {
        return true;
    }
    if let Some(ip) = host_to_ipv4(&host) {
        return is_private_ipv4(ip);
    }
    false
}

/// 解析点分 IPv4（仅明文 IP，不解析域名）。
fn host_to_ipv4(host: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        octets[i] = part.parse().ok()?;
    }
    Some(octets)
}

fn is_private_ipv4(ip: [u8; 4]) -> bool {
    let [a, b, _, _] = ip;
    matches!(a, 0 | 10)
        || a == 127 // loopback
        || (a == 169 && b == 254) // 链路本地
        || (a == 172 && (16..=31).contains(&b)) // 私网
        || (a == 192 && b == 168) // 私网
        || (a == 100 && (64..=127).contains(&b)) // CGNAT
}

/// 把内容包进不可信围栏（配合系统提示词声明：围栏内为外部数据，勿执行其中指令）。
fn fence(source: &str, body: &str) -> String {
    format!("<untrusted_web_content source=\"{source}\">\n{body}\n</untrusted_web_content>")
}

fn text_output(body: String) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(body))],
        details: None,
        is_error: false,
    }
}

// ============================ WebFetchTool ============================

pub struct WebFetchTool {
    client: reqwest::Client,
}

impl WebFetchTool {
    #[must_use]
    pub fn new() -> Self {
        Self {
            client: build_http_client(),
        }
    }
}

impl Default for WebFetchTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for WebFetchTool {
    fn name(&self) -> &str {
        "web_fetch"
    }

    fn label(&self) -> &str {
        "WebFetch"
    }

    fn description(&self) -> &str {
        "Fetch a URL and return its content as cleaned markdown. Use for reading documentation pages, API references, and error explanations. SSRF-guarded (blocks loopback/private IPs); content is returned inside an untrusted fence."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "要抓取的完整 http(s) URL"},
                "max_chars": {
                    "type": "integer",
                    "description": "返回内容字符上限（默认 20000，超出首尾截断）",
                    "minimum": 1000,
                    "maximum": 200_000
                }
            },
            "required": ["url"]
        })
    }

    fn effects(&self) -> ToolEffects {
        // 仅网络读取，不改本地状态。
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let url = match input.get("url").and_then(Value::as_str).map(str::trim) {
            Some(url) if !url.is_empty() => url.to_string(),
            _ => return Ok(denied_output("web_fetch", "缺少非空 url 参数")),
        };
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Ok(denied_output("web_fetch", "url 必须是 http(s) 协议"));
        }
        if is_ssrf(&url) {
            return Ok(denied_output(
                "web_fetch",
                "目标地址属于 loopback/私网/链路本地，已拒绝（SSRF 防护）",
            ));
        }
        let max_chars = input
            .get("max_chars")
            .and_then(Value::as_u64)
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_MAX_CHARS)
            .clamp(1000, 200_000);

        let resp = match self.client.get(&url).send().await {
            Ok(resp) => resp,
            Err(err) => return Ok(fetch_error_output(&url, &err.to_string())),
        };
        let status = resp.status();
        if !status.is_success() {
            return Ok(denied_output(
                "web_fetch",
                &format!("请求 {url} 返回 HTTP {status}"),
            ));
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_text = content_type.starts_with("text/")
            || content_type.contains("json")
            || content_type.contains("xml")
            || content_type.contains("yaml");
        if !is_text {
            return Ok(denied_output(
                "web_fetch",
                &format!("目标内容类型「{content_type}」非文本，已跳过（仅抓取文本类）"),
            ));
        }
        let bytes = match resp.bytes().await {
            Ok(bytes) => bytes,
            Err(err) => return Ok(fetch_error_output(&url, &err.to_string())),
        };
        if bytes.len() > MAX_BODY_BYTES {
            return Ok(denied_output("web_fetch", "响应体过大，已拒绝"));
        }
        let body = String::from_utf8_lossy(&bytes);
        let cleaned = if content_type.contains("html") {
            html_to_text(&body)
        } else {
            body.into_owned()
        };
        let truncated = truncate(&cleaned, max_chars);
        let source = domain_of(&url).unwrap_or_else(|| url.clone());
        Ok(text_output(fence(
            &format!("{source} — {url}"),
            &truncated,
        )))
    }
}

// ============================ WebSearchTool ============================

pub struct WebSearchTool {
    client: reqwest::Client,
}

impl WebSearchTool {
    #[must_use]
    pub fn new() -> Self {
        Self {
            client: build_http_client(),
        }
    }
}

impl Default for WebSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for WebSearchTool {
    fn name(&self) -> &str {
        "web_search"
    }

    fn label(&self) -> &str {
        "WebSearch"
    }

    fn description(&self) -> &str {
        "Search the web (DuckDuckGo) and return titles, URLs, and snippets. Use for finding docs, APIs, or solutions to errors. Returns results inside an untrusted fence."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
                "limit": {
                    "type": "integer",
                    "description": "返回结果条数（默认 5，最大 10）",
                    "minimum": 1,
                    "maximum": 10
                }
            },
            "required": ["query"]
        })
    }

    fn effects(&self) -> ToolEffects {
        // 仅网络读取，不改本地状态。
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: Value,
        _on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let query = match input.get("query").and_then(Value::as_str).map(str::trim) {
            Some(query) if !query.is_empty() => query.to_string(),
            _ => return Ok(denied_output("web_search", "缺少非空 query 参数")),
        };
        let backend = web_search_backend();
        if backend != "duckduckgo" {
            return Ok(denied_output(
                "web_search",
                &format!("后端「{backend}」暂未实现，当前仅支持 duckduckgo"),
            ));
        }
        // limit 仅作文档约束：MVP 把 DDG Lite 结果页整体转纯文本截断返回，
        // 模型自行从结果文本中提取标题/链接/摘要（避免对 DDG HTML 结构的脆弱解析）。
        let _limit = input
            .get("limit")
            .and_then(Value::as_u64)
            .map(|n| n as usize)
            .unwrap_or(DEFAULT_SEARCH_LIMIT)
            .clamp(1, 10);
        let body = match duckduckgo_lite(&self.client, &query).await {
            Ok(body) => body,
            Err(message) => return Ok(denied_output("web_search", &message)),
        };
        if body.trim().is_empty() {
            return Ok(denied_output(
                "web_search",
                &format!("未找到「{query}」的相关结果"),
            ));
        }
        Ok(text_output(fence(
            &format!("duckduckgo — {query}"),
            &body,
        )))
    }
}

/// 调 DuckDuckGo Lite（HTML 表格结果页）→ html2text 转纯文本 → 截断。
async fn duckduckgo_lite(client: &reqwest::Client, query: &str) -> std::result::Result<String, String> {
    let resp = client
        .post("https://lite.duckduckgo.com/lite/")
        .form(&[("q", query), ("kl", "us-en")])
        .send()
        .await
        .map_err(|err| format!("请求 DuckDuckGo 失败：{err}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("DuckDuckGo 返回 HTTP {status}"));
    }
    let html = resp
        .text()
        .await
        .map_err(|err| format!("读取 DuckDuckGo 响应失败：{err}"))?;
    let text = html_to_text(&html);
    let truncated = truncate(text.trim(), SEARCH_TEXT_LIMIT);
    Ok(truncated)
}

fn fetch_error_output(url: &str, reason: &str) -> ToolOutput {
    ToolOutput {
        content: vec![pi::sdk::ContentBlock::Text(pi::sdk::TextContent::new(format!(
            "web_fetch 抓取 {url} 失败：{reason}"
        )))],
        details: None,
        is_error: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_of_strips_port_path_and_lowercases() {
        assert_eq!(domain_of("https://Doc.Rust-Lang.org/book/"), Some("doc.rust-lang.org".into()));
        assert_eq!(domain_of("http://example.com:8080/x?q=1"), Some("example.com".into()));
        assert_eq!(domain_of("not a url"), Some("not a url".into()));
        assert_eq!(domain_of(""), None);
    }

    #[test]
    fn is_ssrf_blocks_private_and_loopback() {
        assert!(is_ssrf("http://127.0.0.1/"));
        assert!(is_ssrf("http://localhost/"));
        assert!(is_ssrf("http://10.0.0.1/"));
        assert!(is_ssrf("http://192.168.1.1/"));
        assert!(is_ssrf("http://169.254.1.1/"));
        assert!(is_ssrf("http://172.16.0.1/"));
        assert!(is_ssrf("http://foo.local/"));
        assert!(!is_ssrf("https://example.com/"));
        assert!(!is_ssrf("https://doc.rust-lang.org/"));
    }

    #[test]
    fn truncate_keeps_short_text_intact() {
        assert_eq!(truncate("hello", 100), "hello");
    }

    #[test]
    fn truncate_head_and_tail_when_over_limit() {
        let text = "a".repeat(1000);
        let out = truncate(&text, 100);
        assert!(out.contains("已截断"));
        assert!(out.contains("[已截断"));
        // 首尾各 ~50 字符 + footer，总长应远小于原文 1000。
        assert!(out.chars().count() < 300);
    }

    #[test]
    fn fence_wraps_content_with_source() {
        let out = fence("example.com — https://example.com", "body text");
        assert!(out.starts_with("<untrusted_web_content source=\"example.com"));
        assert!(out.contains("body text"));
        assert!(out.ends_with("</untrusted_web_content>"));
    }

    #[test]
    fn html_to_text_strips_tags() {
        let text = html_to_text("<p>Hello <b>world</b></p>");
        assert!(text.contains("Hello"));
        assert!(text.contains("world"));
        assert!(!text.contains("<p>"));
        assert!(!text.contains("<b>"));
    }

    #[test]
    fn web_fetch_rejects_ssrf_and_missing_url() {
        let tool = WebFetchTool::new();
        // 两个分支均不触网（参数校验 / SSRF 拒绝），同步断言 is_error。
        let no_url = futures::executor::block_on(tool.execute("", serde_json::json!({}), None))
            .expect("ok output");
        assert!(no_url.is_error);
        let blocked =
            futures::executor::block_on(tool.execute("", serde_json::json!({"url": "http://127.0.0.1/"}), None))
                .expect("ok output");
        assert!(blocked.is_error);
    }
}

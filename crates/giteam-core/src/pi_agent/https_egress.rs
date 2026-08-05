//! Windows HTTPS 出站旁路：把 provider 的 `https://` base_url 改写到本机 HTTP 反代。
//!
//! # 背景
//! pi 的 provider HTTP 走 asupersync TLS。在 Windows 上该路径对任意 HTTPS 端点都会
//! 稳定失败：`TLS connect failed ... (os error 10057)`（WSAENOTCONN；上游
//! asupersync#35 / pi#66/#106）。同进程里 giteam 用 reqwest+rustls 拉 `/models`
//! 是通的；asupersync 对明文 HTTP 也通。
//!
//! # 方案
//! 启动 loopback HTTP 反向代理（tiny_http 入站 + reqwest 出站），把 ModelEntry 的
//! `https://…` 改写成 `http://127.0.0.1:{port}/r/{id}/…`，再 `create_provider`
//! 重建 provider。pi 只连本机明文 HTTP；真实 HTTPS 由 reqwest 完成。
//! 用户可见的 models.json / UI 仍保存原始 https URL。
//!
//! 安装入口 [`ensure_https_egress_shim_with_paths`] 仅在 Windows 生效；其它平台空操作。

use std::sync::{Arc, Mutex};

/// 已安装旁路的缓存：同 provider/model/upstream 复用 create_provider 结果。
/// 字段在 Windows 安装路径读写；其它平台 `ensure_*` 为空操作。
#[allow(dead_code)]
pub(crate) struct HttpsEgressShimState {
    pub upstream_base: String,
    pub provider_name: String,
    pub model_id: String,
    pub provider: Arc<dyn pi::sdk::Provider>,
}

/// 规范化 upstream base：trim、去尾 `/`。非 https 返回 None。
#[cfg(any(windows, test))]
pub(crate) fn normalize_https_base(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return None;
    }
    Some(trimmed.to_string())
}

#[cfg(any(windows, test))]
fn split_route_path(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("/r/")?;
    let (id, suffix) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, ""),
    };
    if id.is_empty() {
        return None;
    }
    Some((id.to_string(), suffix.to_string()))
}

#[cfg(any(windows, test))]
fn join_upstream(base: &str, suffix: &str, query: Option<&str>) -> String {
    let base = base.trim_end_matches('/');
    let path = if suffix.is_empty() || suffix == "/" {
        base.to_string()
    } else if suffix.starts_with('/') {
        format!("{base}{suffix}")
    } else {
        format!("{base}/{suffix}")
    };
    match query {
        Some(q) if !q.is_empty() => format!("{path}?{q}"),
        _ => path,
    }
}

/// 若当前模型 base_url 为 https，则经 loopback 反代重建 provider（仅 Windows）。
///
/// 与 tool-call-id sanitizer 一样，pi `set_provider_model` 会丢弃包装/重建 provider，
/// 因此每次 prompt 前调用；`slot` 缓存已安装的旁路，避免重复 create。
pub(crate) fn ensure_https_egress_shim_with_paths(
    agent: &mut pi::sdk::Agent,
    slot: &Mutex<Option<HttpsEgressShimState>>,
    auth_path: &std::path::Path,
    models_path: Option<std::path::PathBuf>,
) {
    #[cfg(not(windows))]
    {
        let _ = (agent, slot, auth_path, models_path);
    }
    #[cfg(windows)]
    {
        proxy::install_https_egress_shim(agent, slot, auth_path, models_path);
    }
}

#[cfg(any(windows, test))]
mod proxy {
    use super::{join_upstream, normalize_https_base, split_route_path, HttpsEgressShimState};
    use std::collections::HashMap;
    use std::io::Read;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::Duration;

    use tiny_http::{Header, Response, Server, StatusCode};

    struct ProxyState {
        routes: Mutex<HashMap<String, String>>,
        by_upstream: Mutex<HashMap<String, String>>,
        client: reqwest::blocking::Client,
        port: u16,
    }

    static PROXY: OnceLock<Arc<ProxyState>> = OnceLock::new();

    fn proxy() -> &'static Arc<ProxyState> {
        PROXY.get_or_init(|| {
            let server = Server::http("127.0.0.1:0").expect(
                "failed to bind Windows HTTPS egress proxy on 127.0.0.1:0",
            );
            let port = server
                .server_addr()
                .to_ip()
                .expect("HTTPS egress proxy must bind an IP socket")
                .port();
            let client = reqwest::blocking::Client::builder()
                .timeout(None)
                .connect_timeout(Duration::from_secs(30))
                .pool_max_idle_per_host(4)
                .build()
                .expect("failed to build HTTPS egress reqwest client");
            let state = Arc::new(ProxyState {
                routes: Mutex::new(HashMap::new()),
                by_upstream: Mutex::new(HashMap::new()),
                client,
                port,
            });
            let worker = Arc::clone(&state);
            thread::Builder::new()
                .name("giteam-https-egress".into())
                .spawn(move || proxy_loop(server, worker))
                .expect("failed to spawn HTTPS egress proxy thread");
            state
        })
    }

    pub(super) fn loopback_base_for(upstream_https: &str) -> String {
        let state = proxy();
        let upstream = upstream_https.trim_end_matches('/');
        {
            let by_upstream = state.by_upstream.lock().expect("https egress lock");
            if let Some(id) = by_upstream.get(upstream) {
                return format!("http://127.0.0.1:{}/r/{id}", state.port);
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut routes = state.routes.lock().expect("https egress lock");
            let mut by_upstream = state.by_upstream.lock().expect("https egress lock");
            routes.insert(id.clone(), upstream.to_string());
            by_upstream.insert(upstream.to_string(), id.clone());
        }
        format!("http://127.0.0.1:{}/r/{id}", state.port)
    }

    fn is_hop_by_hop(name: &str) -> bool {
        matches!(
            name.to_ascii_lowercase().as_str(),
            "connection"
                | "keep-alive"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "te"
                | "trailers"
                | "transfer-encoding"
                | "upgrade"
                | "host"
                | "content-length"
        )
    }

    fn proxy_loop(server: Server, state: Arc<ProxyState>) {
        loop {
            let request = match server.recv() {
                Ok(req) => req,
                Err(_) => continue,
            };
            if let Err(err) = handle_request(request, &state) {
                eprintln!("[giteam https-egress] {err}");
            }
        }
    }

    fn handle_request(
        mut request: tiny_http::Request,
        state: &ProxyState,
    ) -> Result<(), String> {
        let url = request.url().to_string();
        let (path, query) = match url.split_once('?') {
            Some((p, q)) => (p.to_string(), Some(q.to_string())),
            None => (url, None),
        };
        let (route_id, suffix) =
            split_route_path(&path).ok_or_else(|| format!("invalid egress path: {path}"))?;
        let upstream_base = {
            let routes = state.routes.lock().map_err(|e| e.to_string())?;
            routes
                .get(&route_id)
                .cloned()
                .ok_or_else(|| format!("unknown egress route: {route_id}"))?
        };
        let target = join_upstream(&upstream_base, &suffix, query.as_deref());

        let method_owned = request.method().as_str().to_ascii_uppercase();
        let method = match method_owned.as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            "HEAD" => reqwest::Method::HEAD,
            "PATCH" => reqwest::Method::PATCH,
            "OPTIONS" => reqwest::Method::OPTIONS,
            other => {
                let _ = request.respond(
                    Response::from_string(format!(
                        "unsupported method for https egress: {other}"
                    ))
                    .with_status_code(StatusCode(405)),
                );
                return Ok(());
            }
        };

        let mut body = Vec::new();
        request
            .as_reader()
            .read_to_end(&mut body)
            .map_err(|e| e.to_string())?;

        let mut builder = state.client.request(method, &target);
        for header in request.headers() {
            let name = header.field.as_str().as_str();
            if is_hop_by_hop(name) {
                continue;
            }
            builder = builder.header(name, header.value.as_str());
        }
        if !body.is_empty() {
            builder = builder.body(body);
        }

        let upstream = match builder.send() {
            Ok(resp) => resp,
            Err(err) => {
                let msg = format!("upstream HTTPS request failed: {err}");
                let _ = request.respond(
                    Response::from_string(msg.clone()).with_status_code(StatusCode(502)),
                );
                return Err(msg);
            }
        };

        let status = StatusCode(upstream.status().as_u16());
        let mut headers = Vec::new();
        for (name, value) in upstream.headers().iter() {
            if is_hop_by_hop(name.as_str()) {
                continue;
            }
            let Ok(raw_value) = value.to_str() else {
                continue;
            };
            if let Ok(header) = Header::from_bytes(name.as_str().as_bytes(), raw_value.as_bytes())
            {
                headers.push(header);
            }
        }

        let content_length = upstream
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<usize>().ok());

        let response = Response::new(status, headers, upstream, content_length, None);
        request.respond(response).map_err(|e| e.to_string())
    }

    #[cfg(windows)]
    pub(super) fn install_https_egress_shim(
        agent: &mut pi::sdk::Agent,
        slot: &Mutex<Option<HttpsEgressShimState>>,
        auth_path: &std::path::Path,
        models_path: Option<std::path::PathBuf>,
    ) {
        let provider_name = agent.provider().name().to_string();
        let model_id = agent.provider().model_id().to_string();

        let Ok(auth) = pi::auth::AuthStorage::load(auth_path.to_path_buf()) else {
            return;
        };
        let registry = pi::sdk::ModelRegistry::load_for_listing(&auth, models_path);
        let Some(mut entry) = registry.find(&provider_name, &model_id) else {
            return;
        };
        let Some(upstream) = normalize_https_base(&entry.model.base_url) else {
            if let Ok(mut guard) = slot.lock() {
                *guard = None;
            }
            return;
        };

        // 复用已缓存的 loopback provider，并重新 set_provider：
        // pi set_provider_model 可能已换回 https；sanitizer 也会包一层导致 ptr 变化。
        if let Ok(guard) = slot.lock() {
            if let Some(state) = guard.as_ref() {
                if state.upstream_base == upstream
                    && state.provider_name == provider_name
                    && state.model_id == model_id
                {
                    agent.set_provider(Arc::clone(&state.provider));
                    return;
                }
            }
        }

        let loopback = loopback_base_for(&upstream);
        entry.model.base_url = loopback;
        let Ok(provider) = pi::providers::create_provider(&entry, None) else {
            return;
        };
        agent.set_provider(Arc::clone(&provider));
        if let Ok(mut guard) = slot.lock() {
            *guard = Some(HttpsEgressShimState {
                upstream_base: upstream,
                provider_name,
                model_id,
                provider,
            });
        }
    }

    #[cfg(test)]
    pub(super) fn proxy_port() -> u16 {
        proxy().port
    }

    #[cfg(test)]
    pub(super) fn route_upstream(id: &str) -> Option<String> {
        proxy().routes.lock().ok()?.get(id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_only_https() {
        assert_eq!(
            normalize_https_base("https://api.openai.com/v1/"),
            Some("https://api.openai.com/v1".to_string())
        );
        assert_eq!(normalize_https_base("http://127.0.0.1:8080/v1"), None);
        assert_eq!(normalize_https_base(""), None);
    }

    #[test]
    fn split_route_path_parses() {
        assert_eq!(
            split_route_path("/r/abc/chat/completions"),
            Some(("abc".to_string(), "/chat/completions".to_string()))
        );
        assert_eq!(
            split_route_path("/r/abc"),
            Some(("abc".to_string(), String::new()))
        );
        assert_eq!(split_route_path("/x/abc"), None);
    }

    #[test]
    fn join_upstream_keeps_base_path() {
        assert_eq!(
            join_upstream("https://api.openai.com/v1", "/chat/completions", None),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            join_upstream(
                "https://api.openai.com/v1",
                "/chat/completions",
                Some("x=1")
            ),
            "https://api.openai.com/v1/chat/completions?x=1"
        );
    }

    #[test]
    fn loopback_rewrites_stable_per_upstream() {
        let upstream = "https://example.invalid/v1";
        let a = proxy::loopback_base_for(upstream);
        let b = proxy::loopback_base_for(upstream);
        assert_eq!(a, b);
        assert!(a.starts_with("http://127.0.0.1:"));
        assert!(a.contains("/r/"));

        let prefix = format!("http://127.0.0.1:{}/", proxy::proxy_port());
        let path = a.strip_prefix(&prefix).expect("loopback prefix");
        let full = format!("/{path}/models");
        let (id, suffix) = split_route_path(&full).expect("route");
        assert_eq!(
            proxy::route_upstream(&id).as_deref(),
            Some(upstream)
        );
        assert_eq!(suffix, "/models");
    }
}

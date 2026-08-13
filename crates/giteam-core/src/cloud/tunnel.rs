//! Cloud relay tunnel: 进程级长驻单例 runtime + 配置热切换。
//!
//! 设计要点（相对旧"销毁-重建"模型）：
//! - runtime 进程级单例（`rt()`），tunnel 重连/换 key 不重建 runtime。
//! - `supervisor()` 常驻任务通过 `pending`(配置槽) + `rescan`(Notify) 驱动；
//!   配置未变且 WS 健康 → 幂等跳过；配置变了 → drop cancel + reap 旧 task(≤500ms)
//!   再起新 task，保证任意时刻全局最多一个 WS（避免新旧连接抢 gateway 同 device slot）。
//! - 单 WS task 的中断用 `oneshot`（零新依赖）；`stop_cloud_tunnel()` 不再阻塞 750ms。
//! - `HttpCancel` 帧真正中断本地代理（stream_id → `Arc<AtomicBool>` 取消表）。
//! - 普通响应与 SSE 统一走流式泵（不全量缓冲），首字节延迟 ≈ 读到第一段。

use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Notify};
use tokio::task::JoinHandle;
use tokio_tungstenite::{connect_async, tungstenite::http::Request, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum TunnelFrame {
    #[serde(rename = "hello")]
    Hello {
        v: u32,
        #[serde(rename = "deviceId")]
        device_id: String,
    },
    #[serde(rename = "ping")]
    Ping { v: u32, ts: i64 },
    #[serde(rename = "pong")]
    Pong { v: u32, ts: i64 },
    #[serde(rename = "http.request")]
    HttpRequest {
        v: u32,
        #[serde(rename = "streamId")]
        stream_id: String,
        method: String,
        path: String,
        headers: HashMap<String, String>,
        #[serde(default, rename = "bodyBase64")]
        body_base64: Option<String>,
    },
    #[serde(rename = "http.responseStart")]
    HttpResponseStart {
        v: u32,
        #[serde(rename = "streamId")]
        stream_id: String,
        status: u16,
        headers: HashMap<String, String>,
    },
    #[serde(rename = "http.responseBody")]
    HttpResponseBody {
        v: u32,
        #[serde(rename = "streamId")]
        stream_id: String,
        #[serde(rename = "chunkBase64")]
        chunk_base64: String,
        #[serde(default)]
        end: bool,
    },
    #[serde(rename = "http.responseEnd")]
    HttpResponseEnd {
        v: u32,
        #[serde(rename = "streamId")]
        stream_id: String,
    },
    #[serde(rename = "http.cancel")]
    HttpCancel {
        v: u32,
        #[serde(rename = "streamId")]
        stream_id: String,
        #[serde(default)]
        reason: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        v: u32,
        #[serde(default, rename = "streamId")]
        stream_id: Option<String>,
        code: String,
        message: String,
    },
}

/// 本地代理向 tunnel 发回的事件（普通响应与 SSE 共用流式泵）。
enum ProxyEvent {
    Start {
        status: u16,
        headers: HashMap<String, String>,
    },
    Body(Vec<u8>),
    End,
}

// ---- 连接状态 ----

fn connected_flag() -> &'static AtomicBool {
    static CONNECTED: AtomicBool = AtomicBool::new(false);
    &CONNECTED
}

fn set_tunnel_connected(connected: bool) {
    connected_flag().store(connected, Ordering::SeqCst);
}

/// Background supervisor 存活且 caller 意图为"想连"。
pub fn tunnel_running() -> bool {
    supervisor().want_running.load(Ordering::SeqCst)
}

/// WebSocket to Gateway is currently up (device would appear online for redeem).
pub fn tunnel_connected() -> bool {
    connected_flag().load(Ordering::SeqCst)
}

// ---- 进程级单例 runtime ----

fn rt() -> Option<&'static tokio::runtime::Runtime> {
    static RT: OnceLock<Option<tokio::runtime::Runtime>> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| eprintln!("[giteam-cloud] runtime build failed: {e}"))
            .ok()
    })
    .as_ref()
}

// ---- 配置（幂等判据） ----

#[derive(Clone, Debug, PartialEq, Eq)]
struct TunnelConfig {
    enabled: bool,
    cloud_base_url: String,
    device_token: String,
    control_port: u16,
}

fn config_from_settings(s: &super::config::CloudLinkSettings, control_port: u16) -> TunnelConfig {
    TunnelConfig {
        enabled: s.enabled,
        cloud_base_url: s.cloud_base_url.clone(),
        // trim 防尾部空白破坏幂等判据；base_url 已在 config.rs 归一化。
        device_token: s.device_token.trim().to_string(),
        control_port,
    }
}

// ---- Supervisor（单例） ----

struct Supervisor {
    pending: Arc<StdMutex<TunnelConfig>>,
    rescan: Arc<Notify>,
    want_running: Arc<AtomicBool>,
}

fn supervisor() -> &'static Supervisor {
    static SUP: OnceLock<Supervisor> = OnceLock::new();
    SUP.get_or_init(|| {
        let sup = Supervisor {
            pending: Arc::new(StdMutex::new(TunnelConfig {
                enabled: false,
                cloud_base_url: String::new(),
                device_token: String::new(),
                control_port: 0,
            })),
            rescan: Arc::new(Notify::new()),
            want_running: Arc::new(AtomicBool::new(false)),
        };
        if let Some(rt) = rt() {
            let pending = Arc::clone(&sup.pending);
            let rescan = Arc::clone(&sup.rescan);
            rt.spawn(supervisor_loop(pending, rescan));
        } else {
            eprintln!("[giteam-cloud] supervisor not started: runtime unavailable");
        }
        sup
    })
}

/// 当前 WS task 句柄 + 取消信号。
struct ActiveTunnel {
    handle: JoinHandle<()>,
    cancel: oneshot::Sender<()>,
}

/// 拆除当前 task：drop cancel 让其 select 命中，再等 ≤500ms 退出，保证全局单 WS。
async fn reap_active(active: &mut Option<ActiveTunnel>) {
    if let Some(a) = active.take() {
        drop(a.cancel);
        let _ = tokio::time::timeout(Duration::from_millis(500), a.handle).await;
    }
}

enum SupervisorEvent {
    Rescan,
    TaskEnded,
}

async fn supervisor_loop(pending: Arc<StdMutex<TunnelConfig>>, rescan: Arc<Notify>) {
    let mut running: Option<TunnelConfig> = None;
    let mut active: Option<ActiveTunnel> = None;
    let mut backoff_ms = 200u64;

    loop {
        let cfg = { pending.lock().unwrap().clone() };
        let want_up = cfg.enabled
            && !cfg.cloud_base_url.trim().is_empty()
            && !cfg.device_token.is_empty();

        if !want_up {
            set_tunnel_connected(false);
            if active.is_some() {
                reap_active(&mut active).await;
            }
            running = None;
            backoff_ms = 200;
            rescan.notified().await;
            continue;
        }

        let need_respawn = match &running {
            None => true,
            Some(r) => r != &cfg,
        };
        if need_respawn {
            if active.is_some() {
                reap_active(&mut active).await;
            }
            let (cancel_tx, cancel_rx) = oneshot::channel();
            let handle = tokio::spawn(run_tunnel_loop_owned(cfg.clone(), cancel_rx));
            active = Some(ActiveTunnel {
                handle,
                cancel: cancel_tx,
            });
            running = Some(cfg);
            backoff_ms = 200;
        }

        // 监督当前 task：等 rescan 或 task 自然结束。
        let event = {
            let handle = &mut active.as_mut().expect("active present").handle;
            tokio::select! {
                biased;
                _ = rescan.notified() => SupervisorEvent::Rescan,
                _ = handle => SupervisorEvent::TaskEnded,
            }
        };

        if matches!(event, SupervisorEvent::TaskEnded) {
            active = None;
            set_tunnel_connected(false);
            tokio::select! {
                biased;
                _ = rescan.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(backoff_ms)) => {}
            }
            backoff_ms = (backoff_ms.saturating_mul(2)).min(8_000);
            running = None; // 外层 loop 会 respawn
        }
        // Rescan：重新读配置评估（配置变了 → need_respawn → reap+spawn）。
    }
}

// ---- Public API（签名保持不变） ----

/// Start (or hot-swap) the outbound cloud tunnel. Non-blocking; idempotent.
pub fn start_cloud_tunnel_background(control_port: u16) -> Result<(), String> {
    let settings = super::config::get_cloud_link_settings();
    let cfg = config_from_settings(&settings, control_port);

    if !cfg.enabled {
        stop_cloud_tunnel();
        return Ok(());
    }
    if cfg.device_token.is_empty() || cfg.cloud_base_url.is_empty() {
        return Err("cloud link incomplete: missing deviceToken or cloudBaseUrl".into());
    }

    if rt().is_none() {
        return Err("cloud tunnel runtime unavailable".into());
    }
    let sup = supervisor();
    {
        let mut p = sup.pending.lock().unwrap();
        *p = cfg;
    }
    sup.want_running.store(true, Ordering::SeqCst);
    sup.rescan.notify_one();
    Ok(())
}

/// Restart tunnel and wait until Gateway marks this device online (WS up).
pub fn start_cloud_tunnel_and_wait(control_port: u16, timeout: Duration) -> Result<bool, String> {
    start_cloud_tunnel_background(control_port)?;
    Ok(wait_until_tunnel_connected(timeout))
}

pub fn stop_cloud_tunnel() {
    let sup = supervisor();
    sup.want_running.store(false, Ordering::SeqCst);
    set_tunnel_connected(false);
    {
        let mut p = sup.pending.lock().unwrap();
        p.enabled = false;
    }
    sup.rescan.notify_one();
}

/// Block until the tunnel WebSocket is up, or `timeout` elapses.
pub fn wait_until_tunnel_connected(timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if tunnel_connected() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    tunnel_connected()
}

// ---- WS task ----

async fn run_tunnel_loop_owned(cfg: TunnelConfig, cancel: oneshot::Receiver<()>) {
    match run_tunnel_loop(&cfg, cancel).await {
        Ok(()) => eprintln!("[giteam-cloud] tunnel loop exited cleanly"),
        Err(e) => eprintln!("[giteam-cloud] tunnel loop error: {e}"),
    }
    set_tunnel_connected(false);
}

async fn run_tunnel_loop(
    cfg: &TunnelConfig,
    mut cancel: oneshot::Receiver<()>,
) -> Result<(), String> {
    let url = ws_url(&cfg.cloud_base_url)?;
    let req = Request::builder()
        .uri(&url)
        .header("Authorization", format!("Bearer {}", cfg.device_token))
        .header("Host", {
            let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
            parsed
                .host_str()
                .ok_or_else(|| "missing host".to_string())?
                .to_string()
        })
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header(
            "Sec-WebSocket-Key",
            tokio_tungstenite::tungstenite::handshake::client::generate_key(),
        )
        .body(())
        .map_err(|e| e.to_string())?;

    let (ws, _) = tokio::select! {
        biased;
        _ = &mut cancel => return Ok(()),
        result = connect_async(req) => result.map_err(|e| format!("connect {url}: {e}"))?,
    };
    let (mut sink, mut stream) = ws.split();
    // Concurrent HTTP proxies (SSE + prompt) must not block each other on one tunnel.
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(128);

    // 活跃流的取消表：HttpCancel 帧真正中断本地代理。
    let cancels: Arc<StdMutex<HashMap<String, Arc<AtomicBool>>>> =
        Arc::new(StdMutex::new(HashMap::new()));

    set_tunnel_connected(true);
    eprintln!("[giteam-cloud] tunnel connected to {url}");

    let mut ping_tick = tokio::time::interval(Duration::from_secs(15));
    ping_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            biased;
            _ = &mut cancel => break,
            _ = ping_tick.tick() => {
                let frame = TunnelFrame::Ping { v: 1, ts: chrono::Utc::now().timestamp_millis() };
                let text = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
                if out_tx.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
            Some(msg) = out_rx.recv() => {
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let frame: TunnelFrame = serde_json::from_str(&text)
                            .map_err(|e| format!("bad frame: {e}"))?;
                        match frame {
                            TunnelFrame::HttpRequest {
                                stream_id,
                                method,
                                path,
                                headers,
                                body_base64,
                                ..
                            } => {
                                let tx = out_tx.clone();
                                let cancels = Arc::clone(&cancels);
                                let port = cfg.control_port;
                                tokio::spawn(async move {
                                    handle_http_request(
                                        tx, port, stream_id, method, path, headers, body_base64, &cancels,
                                    )
                                    .await;
                                });
                            }
                            TunnelFrame::HttpCancel { stream_id, reason, .. } => {
                                if let Some(flag) = cancels.lock().unwrap().remove(&stream_id) {
                                    flag.store(true, Ordering::SeqCst);
                                    eprintln!(
                                        "[giteam-cloud] cancel {stream_id} propagated: {:?}",
                                        reason
                                    );
                                } else {
                                    eprintln!("[giteam-cloud] cancel {stream_id}: no active stream");
                                }
                            }
                            TunnelFrame::Ping { ts, .. } => {
                                let pong = TunnelFrame::Pong { v: 1, ts };
                                let text = serde_json::to_string(&pong).map_err(|e| e.to_string())?;
                                if out_tx.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                            TunnelFrame::Pong { .. } | TunnelFrame::Hello { .. } => {}
                            other => {
                                eprintln!(
                                    "[giteam-cloud] ignore frame: {:?}",
                                    std::mem::discriminant(&other)
                                );
                            }
                        }
                    }
                    Some(Ok(Message::Ping(bin))) => {
                        if out_tx.send(Message::Pong(bin)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(err)) => return Err(err.to_string()),
                }
            }
        }
    }
    Ok(())
}

// ---- HTTP 代理（统一流式 + 取消） ----

async fn handle_http_request(
    out_tx: mpsc::Sender<Message>,
    control_port: u16,
    stream_id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body_base64: Option<String>,
    cancels: &Arc<StdMutex<HashMap<String, Arc<AtomicBool>>>>,
) {
    let body = match body_base64 {
        Some(b) if !b.is_empty() => {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(b.as_bytes()) {
                Ok(v) => v,
                Err(e) => {
                    let _ = send_error(&out_tx, Some(stream_id.clone()), "bad_body", &e.to_string())
                        .await;
                    return;
                }
            }
        }
        _ => Vec::new(),
    };

    // 注册取消标志；结束/出错/取消任一路径都 remove，避免泄漏。
    let flag = Arc::new(AtomicBool::new(false));
    cancels.lock().unwrap().insert(stream_id.clone(), Arc::clone(&flag));

    let (evt_tx, mut evt_rx) = mpsc::channel::<Result<ProxyEvent, String>>(32);
    let method_blk = method;
    let path_blk = path;
    let headers_blk = headers;
    let flag_blk = Arc::clone(&flag);
    let join = tokio::task::spawn_blocking(move || {
        let result = local_proxy_streaming(
            control_port,
            &method_blk,
            &path_blk,
            &headers_blk,
            &body,
            flag_blk,
            |evt| match evt_tx.blocking_send(Ok(evt)) {
                Ok(()) => Ok(()),
                Err(_) => Err("proxy event channel closed".to_string()),
            },
        );
        if let Err(err) = result {
            // 取消不算错误日志（正常路径），其它错误记录。
            if err != "cancelled" {
                eprintln!("[giteam-cloud] local proxy error: {err}");
            }
            // channel 可能已关闭（async 侧提前退出），忽略发送失败。
            let _ = evt_tx.blocking_send(Err(err));
        }
    });

    let mut started = false;
    let mut final_status: Result<(), String> = Ok(());
    while let Some(item) = evt_rx.recv().await {
        match item {
            Ok(ProxyEvent::Start { status, headers }) => {
                started = true;
                if send_frame(
                    &out_tx,
                    &TunnelFrame::HttpResponseStart {
                        v: 1,
                        stream_id: stream_id.clone(),
                        status,
                        headers,
                    },
                )
                .await
                .is_err()
                {
                    final_status = Err("tunnel outbound closed".into());
                    break;
                }
            }
            Ok(ProxyEvent::Body(bytes)) => {
                if !started {
                    final_status = Err("body before response start".into());
                    break;
                }
                if bytes.is_empty() {
                    continue;
                }
                use base64::Engine;
                let chunk = base64::engine::general_purpose::STANDARD.encode(&bytes);
                if send_frame(
                    &out_tx,
                    &TunnelFrame::HttpResponseBody {
                        v: 1,
                        stream_id: stream_id.clone(),
                        chunk_base64: chunk,
                        end: false,
                    },
                )
                .await
                .is_err()
                {
                    final_status = Err("tunnel outbound closed".into());
                    break;
                }
            }
            Ok(ProxyEvent::End) => {
                let _ = send_frame(
                    &out_tx,
                    &TunnelFrame::HttpResponseBody {
                        v: 1,
                        stream_id: stream_id.clone(),
                        chunk_base64: String::new(),
                        end: true,
                    },
                )
                .await;
                let _ = send_frame(
                    &out_tx,
                    &TunnelFrame::HttpResponseEnd {
                        v: 1,
                        stream_id: stream_id.clone(),
                    },
                )
                .await;
                break;
            }
            Err(err) => {
                if started {
                    let _ = send_frame(
                        &out_tx,
                        &TunnelFrame::HttpResponseEnd {
                            v: 1,
                            stream_id: stream_id.clone(),
                        },
                    )
                    .await;
                } else {
                    let _ = send_error(&out_tx, Some(stream_id.clone()), "local_proxy_error", &err)
                        .await;
                }
                break;
            }
        }
    }

    cancels.lock().unwrap().remove(&stream_id);
    // 关闭事件通道让 spawn_blocking 尽快收尾，再等它退出以防 detached 线程堆积。
    evt_rx.close();
    let _ = join.await;
    let _ = final_status;
}

/// 本地 control server 代理：流式读 header + body，边读边通过 `on_event` 上报；
/// `cancel` 在每次 read 间隙被检查，置位则 shutdown 写端并返回 `Err("cancelled")`。
/// 普通响应与 SSE 共用此函数（均靠 EOF 终结）。
fn local_proxy_streaming(
    port: u16,
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
    cancel: Arc<AtomicBool>,
    mut on_event: impl FnMut(ProxyEvent) -> Result<(), String>,
) -> Result<(), String> {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|e| format!("connect local control: {e}"))?;
    // 短 read 超时 + 循环，保证 cancel 在 ~1s 内生效（SSE 心跳 20s 也不会被误判超时）。
    stream
        .set_read_timeout(Some(Duration::from_millis(1000)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .ok();
    write_local_request(&mut stream, port, method, path, headers, body)?;

    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let header_end = loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        match stream.read(&mut tmp) {
            Ok(0) => return Err("proxy closed before headers".into()),
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) => return Err(format!("proxy read headers: {e}")),
        }
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > 1024 * 1024 {
            return Err("proxy headers too large".into());
        }
    };

    let header_bytes = &buf[..header_end];
    let header_text = String::from_utf8_lossy(header_bytes);
    let mut lines = header_text.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let mut parts = status_line.split_whitespace();
    let _http = parts.next();
    let status: u16 = parts
        .next()
        .ok_or_else(|| format!("bad status line: {status_line}"))?
        .parse()
        .map_err(|_| format!("bad status code: {status_line}"))?;
    let mut resp_headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            resp_headers.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    on_event(ProxyEvent::Start {
        status,
        headers: resp_headers,
    })?;

    let mut pending = buf[header_end + 4..].to_vec();
    if !pending.is_empty() {
        on_event(ProxyEvent::Body(std::mem::take(&mut pending)))?;
    }

    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = stream.shutdown(std::net::Shutdown::Write);
            return Err("cancelled".into());
        }
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => on_event(ProxyEvent::Body(tmp[..n].to_vec()))?,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) => return Err(format!("proxy read body: {e}")),
        }
    }
    on_event(ProxyEvent::End)?;
    Ok(())
}

// ---- 辅助 ----

fn ws_url(cloud_base_url: &str) -> Result<String, String> {
    let base = cloud_base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("empty cloud base url".into());
    }
    if let Some(rest) = base.strip_prefix("https://") {
        Ok(format!("wss://{rest}/cloud/v1/device/tunnel"))
    } else if let Some(rest) = base.strip_prefix("http://") {
        Ok(format!("ws://{rest}/cloud/v1/device/tunnel"))
    } else if let Some(rest) = base.strip_prefix("wss://") {
        Ok(format!("wss://{rest}/cloud/v1/device/tunnel"))
    } else if let Some(rest) = base.strip_prefix("ws://") {
        Ok(format!("ws://{rest}/cloud/v1/device/tunnel"))
    } else {
        Ok(format!("ws://{base}/cloud/v1/device/tunnel"))
    }
}

fn write_local_request(
    stream: &mut TcpStream,
    port: u16,
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
) -> Result<(), String> {
    let mut req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (k, v) in headers {
        let lk = k.to_ascii_lowercase();
        if matches!(
            lk.as_str(),
            "host" | "content-length" | "connection" | "transfer-encoding" | "authorization"
        ) {
            continue;
        }
        req.push_str(k);
        req.push_str(": ");
        req.push_str(v);
        req.push_str("\r\n");
    }
    if let Some(token) = crate::control::loopback_bearer_token() {
        req.push_str("Authorization: Bearer ");
        req.push_str(&token);
        req.push_str("\r\n");
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .and_then(|_| stream.write_all(body))
        .map_err(|e| e.to_string())
}

async fn send_frame(out_tx: &mpsc::Sender<Message>, frame: &TunnelFrame) -> Result<(), String> {
    let text = serde_json::to_string(frame).map_err(|e| e.to_string())?;
    out_tx
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| "tunnel outbound closed".to_string())
}

async fn send_error(
    out_tx: &mpsc::Sender<Message>,
    stream_id: Option<String>,
    code: &str,
    message: &str,
) -> Result<(), String> {
    send_frame(
        out_tx,
        &TunnelFrame::Error {
            v: 1,
            stream_id,
            code: code.to_string(),
            message: message.to_string(),
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{config_from_settings, TunnelConfig};
    use crate::cloud::config::CloudLinkSettings;

    fn sample_settings() -> CloudLinkSettings {
        CloudLinkSettings {
            enabled: true,
            cloud_base_url: "https://gw.example.com/".into(),
            workspace_id: "ws_x".into(),
            device_id: "dev_x".into(),
            device_token: "  gtm_dev_abc  ".into(), // 含首尾空白，验证 trim 不破坏幂等
            access_key: "aki".into(),
            key_name: "n".into(),
            device_name: "dn".into(),
            access_keys: vec![],
            tunnel_owner: "desktop".into(),
        }
    }

    #[test]
    fn config_from_settings_is_idempotent() {
        let s = sample_settings();
        let a = config_from_settings(&s, 4100);
        let b = config_from_settings(&s, 4100);
        assert_eq!(a, b, "identical settings must yield equal configs (tunnel would otherwise thrash)");
    }

    #[test]
    fn config_trims_token_whitespace() {
        let s = sample_settings();
        let cfg = config_from_settings(&s, 4100);
        assert_eq!(cfg.device_token, "gtm_dev_abc");
    }

    #[test]
    fn config_differs_when_port_changes() {
        let s = sample_settings();
        let a = config_from_settings(&s, 4100);
        let c = config_from_settings(&s, 4101);
        assert_ne!(a, c);
    }

    #[test]
    fn config_differs_when_token_changes() {
        let s = sample_settings();
        let a = config_from_settings(&s, 4100);
        let mut s2 = s;
        s2.device_token = "gtm_dev_other".into();
        let c = config_from_settings(&s2, 4100);
        assert_ne!(a, c);
        // 确保是按值比较，不是意外全部相等
        let _: &TunnelConfig = &a;
    }
}

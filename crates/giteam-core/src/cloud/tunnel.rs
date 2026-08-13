use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tokio::sync::mpsc;
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

struct TunnelRuntime {
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

fn runtime_cell() -> &'static Mutex<Option<TunnelRuntime>> {
    static CELL: OnceLock<Mutex<Option<TunnelRuntime>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

pub fn tunnel_running() -> bool {
    runtime_cell()
        .lock()
        .ok()
        .map(|g| g.as_ref().map(|r| !r.stop.load(Ordering::SeqCst)).unwrap_or(false))
        .unwrap_or(false)
}

pub fn stop_cloud_tunnel() {
    if let Ok(mut guard) = runtime_cell().lock() {
        if let Some(mut rt) = guard.take() {
            rt.stop.store(true, Ordering::SeqCst);
            if let Some(join) = rt.join.take() {
                let _ = join.join();
            }
        }
    }
}

/// Start (or restart) the outbound cloud tunnel in a background thread.
pub fn start_cloud_tunnel_background(control_port: u16) -> Result<(), String> {
    stop_cloud_tunnel();
    let settings = super::config::get_cloud_link_settings();
    if !settings.enabled {
        return Ok(());
    }
    if settings.device_token.trim().is_empty() || settings.cloud_base_url.trim().is_empty() {
        return Err("cloud link incomplete: missing deviceToken or cloudBaseUrl".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let cloud_base_url = settings.cloud_base_url.clone();
    let device_token = settings.device_token.clone();
    let join = thread::Builder::new()
        .name("giteam-cloud-tunnel".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("[giteam-cloud] runtime build failed: {e}");
                    return;
                }
            };
            rt.block_on(async move {
                let mut backoff_ms = 1_000u64;
                while !stop_for_thread.load(Ordering::SeqCst) {
                    match run_tunnel_loop(
                        &cloud_base_url,
                        &device_token,
                        control_port,
                        Arc::clone(&stop_for_thread),
                    )
                    .await
                    {
                        Ok(()) => {
                            if stop_for_thread.load(Ordering::SeqCst) {
                                break;
                            }
                            eprintln!("[giteam-cloud] tunnel closed; reconnecting…");
                        }
                        Err(e) => {
                            eprintln!("[giteam-cloud] tunnel error: {e}; retry in {backoff_ms}ms");
                        }
                    }
                    if stop_for_thread.load(Ordering::SeqCst) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                    backoff_ms = (backoff_ms.saturating_mul(2)).min(30_000);
                }
            });
        })
        .map_err(|e| e.to_string())?;
    if let Ok(mut guard) = runtime_cell().lock() {
        *guard = Some(TunnelRuntime {
            stop,
            join: Some(join),
        });
    }
    Ok(())
}

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

async fn run_tunnel_loop(
    cloud_base_url: &str,
    device_token: &str,
    control_port: u16,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let url = ws_url(cloud_base_url)?;
    let req = Request::builder()
        .uri(&url)
        .header("Authorization", format!("Bearer {device_token}"))
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

    let (ws, _) = connect_async(req)
        .await
        .map_err(|e| format!("connect {url}: {e}"))?;
    let (mut sink, mut stream) = ws.split();
    // Concurrent HTTP proxies (SSE + prompt) must not block each other on one tunnel.
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(128);

    eprintln!("[giteam-cloud] tunnel connected to {url}");

    let mut ping_tick = tokio::time::interval(Duration::from_secs(15));
    ping_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        tokio::select! {
            _ = ping_tick.tick() => {
                let frame = TunnelFrame::Ping {
                    v: 1,
                    ts: chrono::Utc::now().timestamp_millis(),
                };
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
                                tokio::spawn(async move {
                                    if let Err(err) = handle_http_request(
                                        tx.clone(),
                                        control_port,
                                        stream_id.clone(),
                                        method,
                                        path,
                                        headers,
                                        body_base64,
                                    )
                                    .await
                                    {
                                        let frame = TunnelFrame::Error {
                                            v: 1,
                                            stream_id: Some(stream_id),
                                            code: "local_proxy_error".into(),
                                            message: err,
                                        };
                                        if let Ok(text) = serde_json::to_string(&frame) {
                                            let _ = tx.send(Message::Text(text.into())).await;
                                        }
                                    }
                                });
                            }
                            TunnelFrame::Ping { ts, .. } => {
                                let pong = TunnelFrame::Pong { v: 1, ts };
                                let text = serde_json::to_string(&pong).map_err(|e| e.to_string())?;
                                if out_tx.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                            TunnelFrame::Pong { .. } | TunnelFrame::Hello { .. } => {}
                            TunnelFrame::HttpCancel { stream_id, reason, .. } => {
                                eprintln!("[giteam-cloud] cancel {stream_id}: {:?}", reason);
                            }
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

fn path_only(path: &str) -> &str {
    path.split('?').next().unwrap_or(path)
}

fn is_sse_path(path: &str) -> bool {
    path_only(path) == "/api/v1/agent/stream"
}

async fn handle_http_request(
    out_tx: mpsc::Sender<Message>,
    control_port: u16,
    stream_id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body_base64: Option<String>,
) -> Result<(), String> {
    let body = match body_base64 {
        Some(b) if !b.is_empty() => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(b.as_bytes())
                .map_err(|e| e.to_string())?
        }
        _ => Vec::new(),
    };

    if is_sse_path(&path) {
        return proxy_sse_streaming(out_tx, control_port, stream_id, method, path, headers, body)
            .await;
    }

    let result = tokio::task::spawn_blocking(move || {
        local_control_exchange(control_port, &method, &path, &headers, &body)
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok((status, resp_headers, resp_body)) => {
            send_frame(
                &out_tx,
                &TunnelFrame::HttpResponseStart {
                    v: 1,
                    stream_id: stream_id.clone(),
                    status,
                    headers: resp_headers,
                },
            )
            .await?;
            send_body_chunks(&out_tx, &stream_id, &resp_body).await?;
            send_frame(
                &out_tx,
                &TunnelFrame::HttpResponseEnd {
                    v: 1,
                    stream_id,
                },
            )
            .await?;
            Ok(())
        }
        Err(err) => Err(err),
    }
}

async fn proxy_sse_streaming(
    out_tx: mpsc::Sender<Message>,
    control_port: u16,
    stream_id: String,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
) -> Result<(), String> {
    let (chunk_tx, mut chunk_rx) = mpsc::channel::<Result<SseChunk, String>>(32);
    let sid = stream_id.clone();
    tokio::task::spawn_blocking(move || {
        let result = local_control_sse_stream(control_port, &method, &path, &headers, &body, |chunk| {
            chunk_tx
                .blocking_send(Ok(chunk))
                .map_err(|_| "sse chunk channel closed".to_string())
        });
        if let Err(err) = result {
            let _ = chunk_tx.blocking_send(Err(err));
        }
    });

    let mut started = false;
    while let Some(item) = chunk_rx.recv().await {
        match item {
            Ok(SseChunk::Start { status, headers }) => {
                started = true;
                send_frame(
                    &out_tx,
                    &TunnelFrame::HttpResponseStart {
                        v: 1,
                        stream_id: sid.clone(),
                        status,
                        headers,
                    },
                )
                .await?;
            }
            Ok(SseChunk::Body(bytes)) => {
                if !started {
                    return Err("sse body before response start".into());
                }
                if bytes.is_empty() {
                    continue;
                }
                use base64::Engine;
                send_frame(
                    &out_tx,
                    &TunnelFrame::HttpResponseBody {
                        v: 1,
                        stream_id: sid.clone(),
                        chunk_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                        end: false,
                    },
                )
                .await?;
            }
            Ok(SseChunk::End) => {
                if started {
                    send_frame(
                        &out_tx,
                        &TunnelFrame::HttpResponseBody {
                            v: 1,
                            stream_id: sid.clone(),
                            chunk_base64: String::new(),
                            end: true,
                        },
                    )
                    .await?;
                    send_frame(
                        &out_tx,
                        &TunnelFrame::HttpResponseEnd {
                            v: 1,
                            stream_id: sid,
                        },
                    )
                    .await?;
                }
                return Ok(());
            }
            Err(err) => return Err(err),
        }
    }
    if started {
        send_frame(
            &out_tx,
            &TunnelFrame::HttpResponseEnd {
                v: 1,
                stream_id: sid,
            },
        )
        .await?;
    }
    Ok(())
}

enum SseChunk {
    Start {
        status: u16,
        headers: HashMap<String, String>,
    },
    Body(Vec<u8>),
    End,
}

async fn send_frame(out_tx: &mpsc::Sender<Message>, frame: &TunnelFrame) -> Result<(), String> {
    let text = serde_json::to_string(frame).map_err(|e| e.to_string())?;
    out_tx
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| "tunnel outbound closed".to_string())
}

async fn send_body_chunks(
    out_tx: &mpsc::Sender<Message>,
    stream_id: &str,
    resp_body: &[u8],
) -> Result<(), String> {
    use base64::Engine;
    const CHUNK: usize = 64 * 1024;
    if resp_body.is_empty() {
        return Ok(());
    }
    let mut offset = 0;
    while offset < resp_body.len() {
        let end = (offset + CHUNK).min(resp_body.len());
        let slice = &resp_body[offset..end];
        offset = end;
        let last = offset >= resp_body.len();
        send_frame(
            out_tx,
            &TunnelFrame::HttpResponseBody {
                v: 1,
                stream_id: stream_id.to_string(),
                chunk_base64: base64::engine::general_purpose::STANDARD.encode(slice),
                end: last,
            },
        )
        .await?;
    }
    Ok(())
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

fn local_control_exchange(
    port: u16,
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
) -> Result<(u16, HashMap<String, String>, Vec<u8>), String> {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|e| format!("connect local control: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .ok();
    write_local_request(&mut stream, port, method, path, headers, body)?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    parse_http_response(&raw)
}

fn local_control_sse_stream(
    port: u16,
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    body: &[u8],
    mut on_chunk: impl FnMut(SseChunk) -> Result<(), String>,
) -> Result<(), String> {
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|e| format!("connect local control: {e}"))?;
    // Heartbeats arrive every ~20s; keep idle timeout above that.
    stream
        .set_read_timeout(Some(Duration::from_secs(180)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .ok();
    write_local_request(&mut stream, port, method, path, headers, body)?;

    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    let header_end = loop {
        let n = match stream.read(&mut tmp) {
            Ok(0) => return Err("sse closed before headers".into()),
            Ok(n) => n,
            Err(e) => return Err(format!("sse read headers: {e}")),
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > 1024 * 1024 {
            return Err("sse headers too large".into());
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
    on_chunk(SseChunk::Start {
        status,
        headers: resp_headers,
    })?;

    let mut pending = buf[header_end + 4..].to_vec();
    if !pending.is_empty() {
        on_chunk(SseChunk::Body(std::mem::take(&mut pending)))?;
    }

    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => on_chunk(SseChunk::Body(tmp[..n].to_vec()))?,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                // Keep waiting for heartbeats / agent events.
                continue;
            }
            Err(e) => return Err(format!("sse read body: {e}")),
        }
    }
    on_chunk(SseChunk::End)?;
    Ok(())
}

fn parse_http_response(raw: &[u8]) -> Result<(u16, HashMap<String, String>, Vec<u8>), String> {
    let header_end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "invalid http response from local control".to_string())?;
    let header_bytes = &raw[..header_end];
    let body = raw[header_end + 4..].to_vec();
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
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    Ok((status, headers, body))
}

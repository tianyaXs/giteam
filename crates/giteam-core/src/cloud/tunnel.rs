use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tokio_tungstenite::{connect_async, tungstenite::http::Request, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum TunnelFrame {
    #[serde(rename = "hello")]
    Hello {
        v: u32,
        #[serde(rename = "deviceId")]
        device_id: String,
        #[serde(rename = "workspaceId")]
        workspace_id: String,
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

/// Start background tunnel supervisor. Safe to call repeatedly.
pub fn start_cloud_tunnel_background(control_port: u16) -> Result<(), String> {
    let settings = super::config::get_cloud_link_settings();
    if !settings.enabled {
        return Ok(());
    }
    if settings.device_token.trim().is_empty() || settings.cloud_base_url.trim().is_empty() {
        return Err("cloud link incomplete: missing deviceToken or cloudBaseUrl".into());
    }

    stop_cloud_tunnel();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let cloud_base_url = settings.cloud_base_url.clone();
    let device_token = settings.device_token.clone();

    let join = thread::Builder::new()
        .name("giteam-cloud-tunnel".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .worker_threads(2)
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    eprintln!("[giteam-cloud] failed to build runtime: {err}");
                    return;
                }
            };
            rt.block_on(supervisor_loop(
                stop_flag,
                cloud_base_url,
                device_token,
                control_port,
            ));
        })
        .map_err(|e| e.to_string())?;

    *runtime_cell().lock().map_err(|e| e.to_string())? = Some(TunnelRuntime {
        stop,
        join: Some(join),
    });
    Ok(())
}

async fn supervisor_loop(
    stop: Arc<AtomicBool>,
    cloud_base_url: String,
    device_token: String,
    control_port: u16,
) {
    let mut backoff_ms: u64 = 1000;
    while !stop.load(Ordering::SeqCst) {
        match run_tunnel_once(&cloud_base_url, &device_token, control_port, stop.clone()).await {
            Ok(()) => {
                backoff_ms = 1000;
            }
            Err(err) => {
                eprintln!("[giteam-cloud] tunnel error: {err}");
            }
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms.saturating_mul(2)).min(30_000);
    }
}

fn ws_url(cloud_base_url: &str) -> Result<String, String> {
    let base = url::Url::parse(cloud_base_url).map_err(|e| e.to_string())?;
    let mut ws = base;
    match ws.scheme() {
        "https" => {
            ws.set_scheme("wss").map_err(|_| "set wss failed".to_string())?;
        }
        "http" => {
            ws.set_scheme("ws").map_err(|_| "set ws failed".to_string())?;
        }
        "ws" | "wss" => {}
        other => return Err(format!("unsupported cloud url scheme: {other}")),
    }
    ws.set_path("/cloud/v1/tunnel");
    ws.set_query(None);
    Ok(ws.to_string())
}

async fn run_tunnel_once(
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
                sink.send(Message::Text(text.into())).await.map_err(|e| e.to_string())?;
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
                                let sink_for_req = &mut sink;
                                handle_http_request(
                                    sink_for_req,
                                    control_port,
                                    stream_id,
                                    method,
                                    path,
                                    headers,
                                    body_base64,
                                ).await?;
                            }
                            TunnelFrame::Ping { ts, .. } => {
                                let pong = TunnelFrame::Pong { v: 1, ts };
                                let text = serde_json::to_string(&pong).map_err(|e| e.to_string())?;
                                sink.send(Message::Text(text.into())).await.map_err(|e| e.to_string())?;
                            }
                            TunnelFrame::Pong { .. } | TunnelFrame::Hello { .. } => {}
                            TunnelFrame::HttpCancel { stream_id, reason, .. } => {
                                eprintln!("[giteam-cloud] cancel {stream_id}: {:?}", reason);
                            }
                            other => {
                                eprintln!("[giteam-cloud] ignore frame: {:?}", std::mem::discriminant(&other));
                            }
                        }
                    }
                    Some(Ok(Message::Ping(bin))) => {
                        sink.send(Message::Pong(bin)).await.map_err(|e| e.to_string())?;
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

async fn handle_http_request(
    sink: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
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

    // Blocking TCP to local control in spawn_blocking to avoid stalling the runtime.
    let result = tokio::task::spawn_blocking(move || {
        local_control_exchange(control_port, &method, &path, &headers, &body)
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok((status, resp_headers, resp_body)) => {
            let start = TunnelFrame::HttpResponseStart {
                v: 1,
                stream_id: stream_id.clone(),
                status,
                headers: resp_headers,
            };
            let text = serde_json::to_string(&start).map_err(|e| e.to_string())?;
            sink.send(Message::Text(text.into()))
                .await
                .map_err(|e| e.to_string())?;

            // Chunk body for SSE friendliness.
            const CHUNK: usize = 64 * 1024;
            if resp_body.is_empty() {
                let end = TunnelFrame::HttpResponseEnd {
                    v: 1,
                    stream_id: stream_id.clone(),
                };
                let text = serde_json::to_string(&end).map_err(|e| e.to_string())?;
                sink.send(Message::Text(text.into()))
                    .await
                    .map_err(|e| e.to_string())?;
            } else {
                use base64::Engine;
                let mut offset = 0;
                while offset < resp_body.len() {
                    let end = (offset + CHUNK).min(resp_body.len());
                    let slice = &resp_body[offset..end];
                    offset = end;
                    let last = offset >= resp_body.len();
                    let frame = TunnelFrame::HttpResponseBody {
                        v: 1,
                        stream_id: stream_id.clone(),
                        chunk_base64: base64::engine::general_purpose::STANDARD.encode(slice),
                        end: last,
                    };
                    let text = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
                    sink.send(Message::Text(text.into()))
                        .await
                        .map_err(|e| e.to_string())?;
                }
                let end = TunnelFrame::HttpResponseEnd { v: 1, stream_id };
                let text = serde_json::to_string(&end).map_err(|e| e.to_string())?;
                sink.send(Message::Text(text.into()))
                    .await
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        Err(err) => {
            let frame = TunnelFrame::Error {
                v: 1,
                stream_id: Some(stream_id),
                code: "local_proxy_error".into(),
                message: err,
            };
            let text = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
            sink.send(Message::Text(text.into()))
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
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
        .map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    parse_http_response(&raw)
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

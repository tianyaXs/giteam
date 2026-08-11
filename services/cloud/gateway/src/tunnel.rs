use crate::error::{ApiError, ApiResult};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use uuid::Uuid;

const TUNNEL_REQUEST_TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TunnelFrame {
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
        #[serde(default, rename = "bodyBase64", skip_serializing_if = "Option::is_none")]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        v: u32,
        #[serde(default, rename = "streamId", skip_serializing_if = "Option::is_none")]
        stream_id: Option<String>,
        code: String,
        message: String,
    },
}

#[derive(Debug)]
pub struct ProxiedResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

struct PendingStream {
    start_tx: Option<oneshot::Sender<(u16, HashMap<String, String>)>>,
    body_tx: mpsc::Sender<Vec<u8>>,
}

struct DeviceConn {
    workspace_id: String,
    device_id: String,
    name: String,
    connected_at: i64,
    outbound: mpsc::Sender<TunnelFrame>,
    pending: Mutex<HashMap<String, PendingStream>>,
    generation: u64,
}

#[derive(Default)]
pub struct TunnelHub {
    devices: RwLock<HashMap<String, Arc<DeviceConn>>>,
    generation: AtomicU64,
}

impl TunnelHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn online_devices(&self, workspace_id: &str) -> Vec<DevicePresence> {
        let guard = self.devices.read().await;
        guard
            .values()
            .filter(|d| d.workspace_id == workspace_id)
            .map(|d| DevicePresence {
                id: d.device_id.clone(),
                name: d.name.clone(),
                online: true,
                connected_at: Some(d.connected_at),
            })
            .collect()
    }

    pub async fn is_online(&self, device_id: &str) -> bool {
        self.devices.read().await.contains_key(device_id)
    }

    pub async fn online_count(&self) -> usize {
        self.devices.read().await.len()
    }

    pub async fn register(
        &self,
        workspace_id: String,
        device_id: String,
        name: String,
        outbound: mpsc::Sender<TunnelFrame>,
    ) -> u64 {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let conn = Arc::new(DeviceConn {
            workspace_id,
            device_id: device_id.clone(),
            name,
            connected_at: chrono::Utc::now().timestamp(),
            outbound,
            pending: Mutex::new(HashMap::new()),
            generation,
        });
        let mut guard = self.devices.write().await;
        if let Some(old) = guard.insert(device_id, conn) {
            tracing::info!(
                device_id = %old.device_id,
                "replaced existing tunnel connection"
            );
        }
        generation
    }

    pub async fn unregister(&self, device_id: &str, generation: u64) {
        let mut guard = self.devices.write().await;
        if let Some(existing) = guard.get(device_id) {
            if existing.generation == generation {
                guard.remove(device_id);
            }
        }
    }

    pub async fn handle_frame(&self, device_id: &str, frame: TunnelFrame) {
        let Some(conn) = self.devices.read().await.get(device_id).cloned() else {
            return;
        };
        match frame {
            TunnelFrame::HttpResponseStart {
                stream_id,
                status,
                headers,
                ..
            } => {
                let mut pending = conn.pending.lock().await;
                if let Some(entry) = pending.get_mut(&stream_id) {
                    if let Some(tx) = entry.start_tx.take() {
                        let _ = tx.send((status, headers));
                    }
                }
            }
            TunnelFrame::HttpResponseBody {
                stream_id,
                chunk_base64,
                end,
                ..
            } => {
                let chunk = base64::engine::general_purpose::STANDARD
                    .decode(chunk_base64.as_bytes())
                    .unwrap_or_default();
                let mut pending = conn.pending.lock().await;
                if let Some(entry) = pending.get_mut(&stream_id) {
                    if !chunk.is_empty() {
                        let _ = entry.body_tx.send(chunk).await;
                    }
                    if end {
                        pending.remove(&stream_id);
                    }
                }
            }
            TunnelFrame::HttpResponseEnd { stream_id, .. } => {
                let mut pending = conn.pending.lock().await;
                pending.remove(&stream_id);
            }
            TunnelFrame::Error {
                stream_id: Some(stream_id),
                message,
                ..
            } => {
                tracing::warn!(%device_id, %stream_id, %message, "tunnel stream error");
                let mut pending = conn.pending.lock().await;
                pending.remove(&stream_id);
            }
            TunnelFrame::Pong { .. } | TunnelFrame::Ping { .. } | TunnelFrame::Hello { .. } => {}
            other => {
                tracing::debug!(?other, "ignored tunnel frame from device");
            }
        }
    }

    /// Unary-ish proxy: collect full body (used for non-SSE).
    pub async fn proxy_unary(
        &self,
        device_id: &str,
        method: &str,
        path: &str,
        headers: HashMap<String, String>,
        body: Vec<u8>,
        max_body: usize,
    ) -> ApiResult<ProxiedResponse> {
        if body.len() > max_body {
            return Err(ApiError::PayloadTooLarge(format!(
                "request body exceeds {max_body} bytes"
            )));
        }
        let conn = self
            .devices
            .read()
            .await
            .get(device_id)
            .cloned()
            .ok_or_else(crate::error::device_offline)?;

        let stream_id = Uuid::new_v4().to_string();
        let (start_tx, start_rx) = oneshot::channel();
        let (body_tx, mut body_rx) = mpsc::channel::<Vec<u8>>(32);
        {
            let mut pending = conn.pending.lock().await;
            pending.insert(
                stream_id.clone(),
                PendingStream {
                    start_tx: Some(start_tx),
                    body_tx,
                },
            );
        }

        let body_base64 = if body.is_empty() {
            None
        } else {
            Some(base64::engine::general_purpose::STANDARD.encode(&body))
        };

        let frame = TunnelFrame::HttpRequest {
            v: 1,
            stream_id: stream_id.clone(),
            method: method.to_string(),
            path: path.to_string(),
            headers,
            body_base64,
        };
        conn.outbound
            .send(frame)
            .await
            .map_err(|_| crate::error::device_offline())?;

        let (status, resp_headers) = tokio::time::timeout(
            std::time::Duration::from_secs(TUNNEL_REQUEST_TIMEOUT_SECS),
            start_rx,
        )
        .await
        .map_err(|_| ApiError::GatewayTimeout("tunnel response start timeout".into()))?
        .map_err(|_| ApiError::GatewayTimeout("tunnel response cancelled".into()))?;

        let mut collected = Vec::new();
        let deadline = tokio::time::Instant::now()
            + std::time::Duration::from_secs(TUNNEL_REQUEST_TIMEOUT_SECS);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                let _ = conn.outbound.send(TunnelFrame::HttpCancel {
                    v: 1,
                    stream_id: stream_id.clone(),
                    reason: Some("timeout".into()),
                });
                return Err(ApiError::GatewayTimeout("tunnel body timeout".into()));
            }
            match tokio::time::timeout(remaining, body_rx.recv()).await {
                Ok(Some(chunk)) => {
                    if collected.len() + chunk.len() > max_body {
                        return Err(ApiError::PayloadTooLarge(
                            "response body exceeds limit".into(),
                        ));
                    }
                    collected.extend(chunk);
                }
                Ok(None) => break,
                Err(_) => {
                    return Err(ApiError::GatewayTimeout("tunnel body timeout".into()));
                }
            }
            // If pending removed and channel closed, recv returns None — handled above.
            // Also break if no longer pending and channel empty.
            if !conn.pending.lock().await.contains_key(&stream_id) && body_rx.is_empty() {
                // drain remaining
                while let Ok(chunk) = body_rx.try_recv() {
                    collected.extend(chunk);
                }
                break;
            }
        }

        Ok(ProxiedResponse {
            status,
            headers: resp_headers,
            body: collected,
        })
    }

    /// Streaming proxy: returns response start + body chunk receiver (for SSE).
    pub async fn proxy_stream_start(
        &self,
        device_id: &str,
        method: &str,
        path: &str,
        headers: HashMap<String, String>,
        body: Vec<u8>,
        max_body: usize,
    ) -> ApiResult<(String, u16, HashMap<String, String>, mpsc::Receiver<Vec<u8>>)> {
        if body.len() > max_body {
            return Err(ApiError::PayloadTooLarge(format!(
                "request body exceeds {max_body} bytes"
            )));
        }
        let conn = self
            .devices
            .read()
            .await
            .get(device_id)
            .cloned()
            .ok_or_else(crate::error::device_offline)?;

        let stream_id = Uuid::new_v4().to_string();
        let (start_tx, start_rx) = oneshot::channel();
        let (body_tx, body_rx) = mpsc::channel::<Vec<u8>>(64);
        {
            let mut pending = conn.pending.lock().await;
            pending.insert(
                stream_id.clone(),
                PendingStream {
                    start_tx: Some(start_tx),
                    body_tx,
                },
            );
        }

        let body_base64 = if body.is_empty() {
            None
        } else {
            Some(base64::engine::general_purpose::STANDARD.encode(&body))
        };
        conn.outbound
            .send(TunnelFrame::HttpRequest {
                v: 1,
                stream_id: stream_id.clone(),
                method: method.to_string(),
                path: path.to_string(),
                headers,
                body_base64,
            })
            .await
            .map_err(|_| crate::error::device_offline())?;

        let (status, resp_headers) = tokio::time::timeout(
            std::time::Duration::from_secs(TUNNEL_REQUEST_TIMEOUT_SECS),
            start_rx,
        )
        .await
        .map_err(|_| ApiError::GatewayTimeout("tunnel response start timeout".into()))?
        .map_err(|_| ApiError::GatewayTimeout("tunnel response cancelled".into()))?;

        Ok((stream_id, status, resp_headers, body_rx))
    }

    pub async fn send_to_device(&self, device_id: &str, frame: TunnelFrame) -> bool {
        let Some(conn) = self.devices.read().await.get(device_id).cloned() else {
            return false;
        };
        conn.outbound.send(frame).await.is_ok()
    }

    pub async fn force_unregister(&self, device_id: &str) {
        self.devices.write().await.remove(device_id);
    }

    pub async fn cancel_stream(&self, device_id: &str, stream_id: &str) {
        if let Some(conn) = self.devices.read().await.get(device_id).cloned() {
            let _ = conn
                .outbound
                .send(TunnelFrame::HttpCancel {
                    v: 1,
                    stream_id: stream_id.to_string(),
                    reason: Some("client_disconnected".into()),
                })
                .await;
            conn.pending.lock().await.remove(stream_id);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePresence {
    pub id: String,
    pub name: String,
    pub online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<i64>,
}

use crate::auth::bearer_token;
use crate::proxy::find_device_by_token;
use crate::state::AppState;
use crate::tunnel::TunnelFrame;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

pub fn router() -> Router<AppState> {
    Router::new().route("/cloud/v1/tunnel", get(ws_upgrade))
}

async fn ws_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = match bearer_token(auth) {
        Ok(t) => t.to_string(),
        Err(err) => return err.into_response(),
    };

    let device = match find_device_by_token(&state, &token).await {
        Ok(d) => d,
        Err(err) => return err.into_response(),
    };

    ws.on_upgrade(move |socket| {
        handle_socket(state, socket, device.id, device.workspace_id, device.name)
    })
}

async fn handle_socket(
    state: AppState,
    socket: WebSocket,
    device_id: String,
    workspace_id: String,
    name: String,
) {
    let (mut sink, mut stream) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<TunnelFrame>(128);

    let generation = state
        .tunnels
        .register(
            workspace_id.clone(),
            device_id.clone(),
            name.clone(),
            outbound_tx,
        )
        .await;

    tracing::info!(%device_id, %workspace_id, %name, "tunnel connected");
    crate::proxy::write_audit(
        &state,
        Some(&workspace_id),
        "device.tunnel_connected",
        serde_json::json!({ "deviceId": device_id, "name": name }),
    )
    .await;
    let _ = sqlx::query("UPDATE devices SET last_seen_at = NOW() WHERE id = $1")
        .bind(&device_id)
        .execute(&state.pool)
        .await;

    let hello = TunnelFrame::Hello {
        v: 1,
        device_id: device_id.clone(),
        workspace_id: workspace_id.clone(),
    };
    if let Ok(text) = serde_json::to_string(&hello) {
        if sink.send(Message::Text(text.into())).await.is_err() {
            state.tunnels.unregister(&device_id, generation).await;
            return;
        }
    }

    // 对齐 ngrok：服务端也检测 liveness。设备长时间无入站帧 → 主动踢掉半开连接，
    // 避免 redeem 仍看到「幽灵在线」或桌面 CLOSE_WAIT 占着槽。
    let mut last_inbound = tokio::time::Instant::now();
    let mut idle_tick = tokio::time::interval(std::time::Duration::from_secs(10));
    idle_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    const IDLE_AFTER: std::time::Duration = std::time::Duration::from_secs(45);
    let mut server_ping = tokio::time::interval(std::time::Duration::from_secs(20));
    server_ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = idle_tick.tick() => {
                if last_inbound.elapsed() > IDLE_AFTER {
                    tracing::warn!(
                        %device_id,
                        idle_secs = IDLE_AFTER.as_secs(),
                        "tunnel idle timeout; closing"
                    );
                    break;
                }
            }
            _ = server_ping.tick() => {
                let frame = TunnelFrame::Ping {
                    v: 1,
                    ts: chrono::Utc::now().timestamp_millis(),
                };
                if let Ok(text) = serde_json::to_string(&frame) {
                    if sink.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
            }
            maybe_out = outbound_rx.recv() => {
                match maybe_out {
                    Some(frame) => {
                        match serde_json::to_string(&frame) {
                            Ok(text) => {
                                if sink.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(err) => tracing::warn!(error = %err, "serialize tunnel frame failed"),
                        }
                    }
                    None => break,
                }
            }
            maybe_msg = stream.next() => {
                match maybe_msg {
                    Some(Ok(Message::Text(text))) => {
                        last_inbound = tokio::time::Instant::now();
                        match serde_json::from_str::<TunnelFrame>(&text) {
                            Ok(TunnelFrame::Ping { ts, .. }) => {
                                let _ = state.tunnels.send_to_device(
                                    &device_id,
                                    TunnelFrame::Pong { v: 1, ts },
                                ).await;
                            }
                            Ok(TunnelFrame::Pong { .. }) => {
                                // desktop 对 server ping 的应答；只刷新 liveness。
                            }
                            Ok(frame) => {
                                state.tunnels.handle_frame(&device_id, frame).await;
                            }
                            Err(err) => {
                                tracing::warn!(error = %err, "invalid tunnel frame");
                            }
                        }
                        let _ = sqlx::query("UPDATE devices SET last_seen_at = NOW() WHERE id = $1")
                            .bind(&device_id)
                            .execute(&state.pool)
                            .await;
                    }
                    Some(Ok(Message::Ping(bin))) => {
                        last_inbound = tokio::time::Instant::now();
                        if sink.send(Message::Pong(bin)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_inbound = tokio::time::Instant::now();
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {
                        last_inbound = tokio::time::Instant::now();
                    }
                    Some(Err(_)) => break,
                }
            }
        }
    }

    state.tunnels.unregister(&device_id, generation).await;
    tracing::info!(%device_id, "tunnel disconnected");
    crate::proxy::write_audit(
        &state,
        Some(&workspace_id),
        "device.tunnel_disconnected",
        serde_json::json!({ "deviceId": device_id, "name": name }),
    )
    .await;
}

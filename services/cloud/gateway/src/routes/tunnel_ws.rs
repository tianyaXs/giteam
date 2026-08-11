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

    loop {
        tokio::select! {
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
                        match serde_json::from_str::<TunnelFrame>(&text) {
                            Ok(TunnelFrame::Ping { ts, .. }) => {
                                let _ = state.tunnels.send_to_device(
                                    &device_id,
                                    TunnelFrame::Pong { v: 1, ts },
                                ).await;
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
                        if sink.send(Message::Pong(bin)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }

    state.tunnels.unregister(&device_id, generation).await;
    tracing::info!(%device_id, "tunnel disconnected");
}

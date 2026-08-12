use crate::error::{ApiError, ApiResult};
use crate::proxy::{
    header_device_id, is_allowed_path, is_sse_path, list_devices_for_workspace, require_client,
    resolve_device_id,
};
use crate::state::AppState;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use futures_util::stream::Stream;
use serde_json::json;
use std::collections::HashMap;
use std::pin::Pin;
use std::task::{Context, Poll};

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/{*rest}", any(proxy_api))
}

async fn proxy_api(
    axum::extract::State(state): axum::extract::State<AppState>,
    req: Request,
) -> Result<Response, ApiError> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| uri.path().to_string());

    if !is_allowed_path(&method, &path_and_query) {
        return Err(ApiError::Forbidden(format!(
            "path not allowed via cloud: {path_and_query}"
        )));
    }

    let headers = req.headers().clone();

    if method == Method::GET && uri.path() == "/api/v1/health" {
        return cloud_health(&state, &headers).await;
    }

    let claims = require_client(&state, &headers).await?;
    state.clients.touch(&claims.jti).await;
    let ws_default: Option<(Option<String>,)> =
        sqlx::query_as("SELECT default_device_id FROM workspaces WHERE id = $1")
            .bind(&claims.wid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    let device_id = resolve_device_id(
        &state,
        &claims.wid,
        &claims.did,
        header_device_id(&headers).as_deref(),
        ws_default.and_then(|r| r.0).as_deref(),
    )
    .await?;

    let body_bytes = axum::body::to_bytes(req.into_body(), state.config.max_body_bytes)
        .await
        .map_err(|_| ApiError::PayloadTooLarge("request body too large or invalid".into()))?;

    let mut fwd_headers = filter_forward_headers(&headers);
    fwd_headers.insert("x-giteam-cloud-proxy".to_string(), "1".to_string());

    if is_sse_path(&path_and_query) {
        let (stream_id, status, resp_headers, body_rx) = state
            .tunnels
            .proxy_stream_start(
                &device_id,
                method.as_str(),
                &path_and_query,
                fwd_headers,
                body_bytes.to_vec(),
                state.config.max_body_bytes,
            )
            .await?;

        let mapped = BodyChunkStream {
            rx: body_rx,
            tunnels: state.tunnels.clone(),
            device_id,
            stream_id,
            done: false,
        };

        let mut builder = Response::builder().status(status);
        apply_response_headers(builder.headers_mut().unwrap(), &resp_headers);
        return builder
            .body(Body::from_stream(mapped))
            .map_err(|e| ApiError::Internal(e.into()));
    }

    let proxied = state
        .tunnels
        .proxy_unary(
            &device_id,
            method.as_str(),
            &path_and_query,
            fwd_headers,
            body_bytes.to_vec(),
            state.config.max_body_bytes,
        )
        .await?;

    let mut builder = Response::builder().status(proxied.status);
    apply_response_headers(builder.headers_mut().unwrap(), &proxied.headers);
    builder
        .body(Body::from(proxied.body))
        .map_err(|e| ApiError::Internal(e.into()))
}

async fn cloud_health(state: &AppState, headers: &HeaderMap) -> ApiResult<Response> {
    if headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .is_none()
    {
        let body = json!({
            "ok": true,
            "mode": "cloud",
            "noAuth": false
        });
        return Ok(JsonResponse(body).into_response());
    }

    let claims = require_client(state, headers).await?;
    state.clients.touch(&claims.jti).await;
    let devices = list_devices_for_workspace(state, &claims.wid).await?;
    let selected = resolve_device_id(
        state,
        &claims.wid,
        &claims.did,
        header_device_id(headers).as_deref(),
        None,
    )
    .await
    .ok();

    let body = json!({
        "ok": true,
        "mode": "cloud",
        "workspaceId": claims.wid,
        "devices": devices,
        "selectedDeviceId": selected,
        "noAuth": false
    });
    Ok(JsonResponse(body).into_response())
}

struct JsonResponse(serde_json::Value);

impl IntoResponse for JsonResponse {
    fn into_response(self) -> Response {
        (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            self.0.to_string(),
        )
            .into_response()
    }
}

fn filter_forward_headers(headers: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (name, value) in headers.iter() {
        let lname = name.as_str().to_ascii_lowercase();
        if matches!(
            lname.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "authorization"
                | "sec-websocket-key"
                | "sec-websocket-version"
                | "upgrade"
        ) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            out.insert(name.as_str().to_string(), v.to_string());
        }
    }
    out
}

fn apply_response_headers(map: &mut HeaderMap, headers: &HashMap<String, String>) {
    for (k, v) in headers {
        let lname = k.to_ascii_lowercase();
        if matches!(
            lname.as_str(),
            "transfer-encoding" | "connection" | "content-length"
        ) {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            map.insert(name, value);
        }
    }
}

struct BodyChunkStream {
    rx: tokio::sync::mpsc::Receiver<Vec<u8>>,
    tunnels: std::sync::Arc<crate::tunnel::TunnelHub>,
    device_id: String,
    stream_id: String,
    done: bool,
}

impl Stream for BodyChunkStream {
    type Item = Result<bytes::Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if self.done {
            return Poll::Ready(None);
        }
        match Pin::new(&mut self.rx).poll_recv(cx) {
            Poll::Ready(Some(chunk)) => Poll::Ready(Some(Ok(bytes::Bytes::from(chunk)))),
            Poll::Ready(None) => {
                self.done = true;
                let tunnels = self.tunnels.clone();
                let device_id = self.device_id.clone();
                let stream_id = self.stream_id.clone();
                tokio::spawn(async move {
                    tunnels.cancel_stream(&device_id, &stream_id).await;
                });
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

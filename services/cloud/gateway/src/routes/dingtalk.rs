//! 钉钉 Outgoing 公开回调 + Device token 绑定管理。

use crate::auth::bearer_token;
use crate::error::{ApiError, ApiResult};
use crate::proxy::{
    find_device_by_token, resolve_device_id, write_audit, WorkspaceRow,
};
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{post, put};
use axum::{Json, Router};
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::FromRow;
use std::collections::HashMap;

type HmacSha256 = Hmac<Sha256>;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/dingtalk/outgoing", post(outgoing_callback))
        .route(
            "/cloud/v1/dingtalk/binding",
            put(upsert_binding).get(get_binding).delete(delete_binding),
        )
}

#[derive(Debug, Deserialize)]
struct OutgoingQuery {
    #[serde(default)]
    workspace: String,
}

#[derive(Debug, FromRow)]
struct BindingRow {
    workspace_id: String,
    device_id: String,
    outgoing_secret: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertBindingRequest {
    #[serde(default)]
    outgoing_secret: String,
    #[serde(default)]
    enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BindingResponse {
    workspace_id: String,
    device_id: String,
    enabled: bool,
    outgoing_url: String,
    has_secret: bool,
}

fn sign_payload(timestamp_ms: i64, secret: &str) -> String {
    let string_to_sign = format!("{timestamp_ms}\n{secret}");
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC_SHA256 accepts any key length");
    mac.update(string_to_sign.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
}

fn verify_outgoing_sign(timestamp_ms: i64, sign: &str, secret: &str, now_ms: i64) -> ApiResult<()> {
    if secret.trim().is_empty() {
        return Err(ApiError::Unauthorized("outgoing secret not configured".into()));
    }
    if (now_ms - timestamp_ms).abs() > 3_600_000 {
        return Err(ApiError::Unauthorized("timestamp out of window".into()));
    }
    let expected = sign_payload(timestamp_ms, secret);
    let got = sign.trim().as_bytes();
    let exp = expected.as_bytes();
    if exp.len() != got.len() {
        return Err(ApiError::Unauthorized("invalid sign".into()));
    }
    let mut diff = 0u8;
    for (a, b) in exp.iter().zip(got.iter()) {
        diff |= a ^ b;
    }
    if diff != 0 {
        return Err(ApiError::Unauthorized("invalid sign".into()));
    }
    Ok(())
}

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

async fn load_binding(state: &AppState, workspace_id: &str) -> ApiResult<BindingRow> {
    let row: Option<BindingRow> = sqlx::query_as(
        r#"
        SELECT workspace_id, device_id, outgoing_secret, enabled
        FROM dingtalk_bindings
        WHERE workspace_id = $1
        "#,
    )
    .bind(workspace_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    row.ok_or_else(|| ApiError::NotFound("dingtalk binding not found".into()))
}

async fn load_workspace(state: &AppState, workspace_id: &str) -> ApiResult<WorkspaceRow> {
    let row: Option<WorkspaceRow> = sqlx::query_as(
        r#"
        SELECT id, access_key_hash, access_key_id, default_device_id, status
        FROM workspaces
        WHERE id = $1 AND status = 'active'
        "#,
    )
    .bind(workspace_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    row.ok_or_else(|| ApiError::NotFound("workspace not found".into()))
}

/// 钉钉 Outgoing 公开回调：校验签名后立即 200，异步经 tunnel 转发桌面。
async fn outgoing_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<OutgoingQuery>,
    body: axum::body::Bytes,
) -> ApiResult<StatusCode> {
    let workspace_id = query.workspace.trim().to_string();
    if workspace_id.is_empty() {
        return Err(ApiError::BadRequest("workspace query required".into()));
    }
    let binding = load_binding(&state, &workspace_id).await?;
    if !binding.enabled {
        write_audit(
            &state,
            Some(&workspace_id),
            "dingtalk.outgoing.disabled",
            serde_json::json!({}),
        )
        .await;
        return Ok(StatusCode::OK);
    }

    let timestamp = header_str(&headers, "timestamp")
        .or_else(|| header_str(&headers, "Timestamp"))
        .and_then(|s| s.parse::<i64>().ok())
        .ok_or_else(|| ApiError::Unauthorized("missing timestamp".into()))?;
    let sign = header_str(&headers, "sign")
        .or_else(|| header_str(&headers, "Sign"))
        .ok_or_else(|| ApiError::Unauthorized("missing sign".into()))?;
    let now_ms = Utc::now().timestamp_millis();
    verify_outgoing_sign(timestamp, &sign, &binding.outgoing_secret, now_ms)?;

    let workspace = load_workspace(&state, &workspace_id).await?;
    // 优先绑定设备；resolve 会校验在线，失败则回退绑定 id（spawn 内再报错）。
    let device_id = match resolve_device_id(
        &state,
        &workspace_id,
        binding.device_id.as_str(),
        None,
        workspace.default_device_id.as_deref(),
    )
    .await
    {
        Ok(id) => id,
        Err(_) => binding.device_id.clone(),
    };

    let payload = body.to_vec();
    let state_bg = state.clone();
    let workspace_bg = workspace_id.clone();
    tokio::spawn(async move {
        let mut fwd_headers = HashMap::new();
        fwd_headers.insert("content-type".into(), "application/json".into());
        fwd_headers.insert("x-giteam-dingtalk".into(), "1".into());
        match state_bg
            .tunnels
            .proxy_unary(
                &device_id,
                "POST",
                "/api/v1/dingtalk/outgoing",
                fwd_headers,
                payload,
                state_bg.config.max_body_bytes,
            )
            .await
        {
            Ok(resp) => {
                write_audit(
                    &state_bg,
                    Some(&workspace_bg),
                    "dingtalk.outgoing.forwarded",
                    serde_json::json!({ "status": resp.status, "deviceId": device_id }),
                )
                .await;
            }
            Err(err) => {
                tracing::warn!(%device_id, error = %err, "dingtalk outgoing forward failed");
                write_audit(
                    &state_bg,
                    Some(&workspace_bg),
                    "dingtalk.outgoing.forward_failed",
                    serde_json::json!({ "deviceId": device_id, "error": err.to_string() }),
                )
                .await;
            }
        }
    });

    Ok(StatusCode::OK)
}

async fn upsert_binding(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertBindingRequest>,
) -> ApiResult<Json<BindingResponse>> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = bearer_token(auth)?;
    let device = find_device_by_token(&state, token).await?;
    let secret = body.outgoing_secret.trim().to_string();
    if body.enabled && secret.is_empty() {
        // 允许只改 enabled 时复用已有 secret
        let existing = load_binding(&state, &device.workspace_id).await.ok();
        if existing.as_ref().map(|b| b.outgoing_secret.is_empty()).unwrap_or(true) {
            return Err(ApiError::BadRequest(
                "outgoingSecret required when enabling".into(),
            ));
        }
    }

    sqlx::query(
        r#"
        INSERT INTO dingtalk_bindings (workspace_id, device_id, outgoing_secret, enabled, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (workspace_id) DO UPDATE SET
            device_id = EXCLUDED.device_id,
            outgoing_secret = CASE
                WHEN EXCLUDED.outgoing_secret = '' THEN dingtalk_bindings.outgoing_secret
                ELSE EXCLUDED.outgoing_secret
            END,
            enabled = EXCLUDED.enabled,
            updated_at = NOW()
        "#,
    )
    .bind(&device.workspace_id)
    .bind(&device.id)
    .bind(&secret)
    .bind(body.enabled)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    write_audit(
        &state,
        Some(&device.workspace_id),
        "dingtalk.binding.upsert",
        serde_json::json!({ "deviceId": device.id, "enabled": body.enabled }),
    )
    .await;

    let row = load_binding(&state, &device.workspace_id).await?;
    Ok(Json(BindingResponse {
        workspace_id: row.workspace_id.clone(),
        device_id: row.device_id,
        enabled: row.enabled,
        outgoing_url: format!(
            "{}/cloud/v1/dingtalk/outgoing?workspace={}",
            state.config.public_base_url.trim_end_matches('/'),
            row.workspace_id
        ),
        has_secret: !row.outgoing_secret.is_empty(),
    }))
}

async fn get_binding(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<BindingResponse>> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = bearer_token(auth)?;
    let device = find_device_by_token(&state, token).await?;
    let row = load_binding(&state, &device.workspace_id).await?;
    Ok(Json(BindingResponse {
        workspace_id: row.workspace_id.clone(),
        device_id: row.device_id,
        enabled: row.enabled,
        outgoing_url: format!(
            "{}/cloud/v1/dingtalk/outgoing?workspace={}",
            state.config.public_base_url.trim_end_matches('/'),
            row.workspace_id
        ),
        has_secret: !row.outgoing_secret.is_empty(),
    }))
}

async fn delete_binding(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = bearer_token(auth)?;
    let device = find_device_by_token(&state, token).await?;
    sqlx::query("DELETE FROM dingtalk_bindings WHERE workspace_id = $1")
        .bind(&device.workspace_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    write_audit(
        &state,
        Some(&device.workspace_id),
        "dingtalk.binding.delete",
        serde_json::json!({ "deviceId": device.id }),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

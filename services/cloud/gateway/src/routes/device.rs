use crate::error::{ApiError, ApiResult};
use crate::ids::{access_key_id, hash_secret, new_id, new_secret};
use crate::proxy::{
    find_device_by_token, lookup_workspace_by_access_key, write_audit,
};
use crate::auth::bearer_token;
use crate::state::AppState;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/device/link/begin", post(link_begin))
        .route("/cloud/v1/device/link/complete", post(link_complete))
        .route("/cloud/v1/device/clients", get(list_clients))
        .route("/cloud/v1/device/clients/disconnect", post(disconnect_client))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkBeginRequest {
    #[serde(default)]
    device_name: String,
    #[serde(default)]
    client_version: String,
    /// Join existing workspace when provided.
    #[serde(default)]
    access_key: Option<String>,
    /// Display name for a newly minted access key (create workspace path).
    #[serde(default)]
    key_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QrPayload {
    mode: &'static str,
    cloud_base_url: String,
    workspace_id: String,
    device_id: String,
    access_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkBeginResponse {
    workspace_id: String,
    device_id: String,
    link_ticket: String,
    expires_at: i64,
    access_key: String,
    qr_payload: QrPayload,
}

async fn link_begin(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(body): Json<LinkBeginRequest>,
) -> ApiResult<Json<LinkBeginResponse>> {
    let device_name = if body.device_name.trim().is_empty() {
        "giteam-cli".to_string()
    } else {
        body.device_name.trim().to_string()
    };
    let client_version = body.client_version.trim().to_string();

    let (workspace_id, access_key_plain) = if let Some(key) = body
        .access_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        let ws = lookup_workspace_by_access_key(&state, &key).await?;
        (ws.id, key)
    } else {
        let workspace_id = new_id("ws");
        let access_key = new_secret("gtm_aks", 24);
        let aki = access_key_id(&access_key);
        let hash = hash_secret(&access_key);
        let key_name = body
            .key_name
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "默认".to_string());
        sqlx::query(
            r#"
            INSERT INTO workspaces (id, access_key_hash, access_key_id, status)
            VALUES ($1, $2, $3, 'active')
            "#,
        )
        .bind(&workspace_id)
        .bind(&hash)
        .bind(&aki)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
        sqlx::query(
            r#"
            INSERT INTO access_keys (id, workspace_id, name, key_hash, status)
            VALUES ($1, $2, $3, $4, 'active')
            "#,
        )
        .bind(&aki)
        .bind(&workspace_id)
        .bind(&key_name)
        .bind(&hash)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
        write_audit(
            &state,
            Some(&workspace_id),
            "workspace.created",
            serde_json::json!({ "accessKeyId": aki, "keyName": key_name }),
        )
        .await;
        (workspace_id, access_key)
    };

    let device_id = new_id("dev");
    sqlx::query(
        r#"
        INSERT INTO devices (id, workspace_id, name, client_version, status)
        VALUES ($1, $2, $3, $4, 'pending')
        "#,
    )
    .bind(&device_id)
    .bind(&workspace_id)
    .bind(&device_name)
    .bind(&client_version)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    // First device becomes default if unset.
    sqlx::query(
        r#"
        UPDATE workspaces
        SET default_device_id = COALESCE(default_device_id, $2)
        WHERE id = $1
        "#,
    )
    .bind(&workspace_id)
    .bind(&device_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let link_ticket = new_secret("ltk", 16);
    let expires_at = Utc::now() + Duration::seconds(state.config.link_ticket_ttl_secs);
    sqlx::query(
        r#"
        INSERT INTO link_tickets (ticket, workspace_id, device_id, expires_at)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(&link_ticket)
    .bind(&workspace_id)
    .bind(&device_id)
    .bind(expires_at)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    write_audit(
        &state,
        Some(&workspace_id),
        "device.link_begin",
        serde_json::json!({ "deviceId": device_id, "name": device_name }),
    )
    .await;

    Ok(Json(LinkBeginResponse {
        workspace_id: workspace_id.clone(),
        device_id: device_id.clone(),
        link_ticket,
        expires_at: expires_at.timestamp(),
        access_key: access_key_plain.clone(),
        qr_payload: QrPayload {
            mode: "cloud",
            cloud_base_url: state.config.public_base_url.clone(),
            workspace_id,
            device_id,
            access_key: access_key_plain,
        },
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkCompleteRequest {
    link_ticket: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkCompleteResponse {
    workspace_id: String,
    device_id: String,
    device_token: String,
}

async fn link_complete(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(body): Json<LinkCompleteRequest>,
) -> ApiResult<Json<LinkCompleteResponse>> {
    let ticket = body.link_ticket.trim();
    if ticket.is_empty() {
        return Err(ApiError::BadRequest("linkTicket required".into()));
    }

    let row: Option<(String, String, Option<chrono::DateTime<Utc>>, chrono::DateTime<Utc>)> =
        sqlx::query_as(
            r#"
            SELECT workspace_id, device_id, consumed_at, expires_at
            FROM link_tickets
            WHERE ticket = $1
            "#,
        )
        .bind(ticket)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let (workspace_id, device_id, consumed_at, expires_at) =
        row.ok_or_else(|| ApiError::Unauthorized("invalid link ticket".into()))?;
    if consumed_at.is_some() {
        return Err(ApiError::Unauthorized("link ticket already used".into()));
    }
    if expires_at < Utc::now() {
        return Err(ApiError::Unauthorized("link ticket expired".into()));
    }

    let device_token = new_secret("gtm_dev", 24);
    let token_hash = hash_secret(&device_token);

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    sqlx::query(
        r#"
        UPDATE link_tickets SET consumed_at = NOW() WHERE ticket = $1 AND consumed_at IS NULL
        "#,
    )
    .bind(ticket)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    sqlx::query(
        r#"
        UPDATE devices
        SET device_token_hash = $2, status = 'active', last_seen_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(&device_id)
    .bind(&token_hash)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    write_audit(
        &state,
        Some(&workspace_id),
        "device.link_complete",
        serde_json::json!({ "deviceId": device_id }),
    )
    .await;

    Ok(Json(LinkCompleteResponse {
        workspace_id,
        device_id,
        device_token,
    }))
}

async fn require_device_from_headers(
    state: &AppState,
    headers: &HeaderMap,
) -> ApiResult<crate::proxy::DeviceRow> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = bearer_token(auth)?;
    find_device_by_token(state, token).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListClientsResponse {
    clients: Vec<crate::clients::ClientSessionView>,
}

async fn list_clients(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<ListClientsResponse>> {
    let device = require_device_from_headers(&state, &headers).await?;
    let clients = state.clients.list_for_device(&device.id).await;
    Ok(Json(ListClientsResponse { clients }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisconnectClientRequest {
    jti: String,
}

#[derive(Debug, Serialize)]
struct DisconnectClientResponse {
    ok: bool,
}

async fn disconnect_client(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DisconnectClientRequest>,
) -> ApiResult<Json<DisconnectClientResponse>> {
    let device = require_device_from_headers(&state, &headers).await?;
    let jti = body.jti.trim();
    if jti.is_empty() {
        return Err(ApiError::BadRequest("jti required".into()));
    }

    let session = state
        .clients
        .get(jti)
        .await
        .ok_or_else(|| ApiError::NotFound("client session not found".into()))?;
    if session.device_id != device.id || session.workspace_id != device.workspace_id {
        return Err(ApiError::Forbidden("client not owned by this device".into()));
    }

    let exp = chrono::DateTime::from_timestamp(session.expires_at, 0)
        .unwrap_or_else(|| Utc::now() + Duration::hours(24));
    sqlx::query(
        r#"
        INSERT INTO jwt_blacklist (jti, workspace_id, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (jti) DO NOTHING
        "#,
    )
    .bind(jti)
    .bind(&device.workspace_id)
    .bind(exp)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let _ = state.clients.remove(jti).await;
    write_audit(
        &state,
        Some(&device.workspace_id),
        "client.disconnected",
        serde_json::json!({ "jti": jti, "deviceId": device.id }),
    )
    .await;

    Ok(Json(DisconnectClientResponse { ok: true }))
}

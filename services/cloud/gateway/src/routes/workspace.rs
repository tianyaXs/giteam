use crate::error::{ApiError, ApiResult};
use crate::ids::{access_key_id, hash_secret, new_secret};
use crate::proxy::{list_devices_for_workspace, require_client, write_audit};
use crate::state::AppState;
use axum::extract::Path;
use axum::http::HeaderMap;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/workspace/status", get(status))
        .route(
            "/cloud/v1/workspace/access-key/rotate",
            post(rotate_access_key),
        )
        .route("/cloud/v1/workspace/access-keys", get(list_access_keys))
        .route("/cloud/v1/workspace/access-keys", post(create_access_key))
        .route(
            "/cloud/v1/workspace/access-keys/{id}",
            delete(revoke_access_key),
        )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    workspace_id: String,
    default_device_id: Option<String>,
    devices: Vec<crate::proxy::DeviceInfo>,
}

async fn status(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<StatusResponse>> {
    let claims = require_client(&state, &headers).await?;
    let default_device_id: Option<(Option<String>,)> =
        sqlx::query_as("SELECT default_device_id FROM workspaces WHERE id = $1")
            .bind(&claims.wid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    let devices = list_devices_for_workspace(&state, &claims.wid).await?;
    Ok(Json(StatusResponse {
        workspace_id: claims.wid,
        default_device_id: default_device_id.and_then(|r| r.0),
        devices,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RotateResponse {
    access_key: String,
    access_key_id: String,
}

async fn rotate_access_key(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<RotateResponse>> {
    // Legacy "replace primary key": revoke all active keys, mint one named 默认.
    let claims = require_client(&state, &headers).await?;
    let access_key = new_secret("gtm_aks", 24);
    let aki = access_key_id(&access_key);
    let hash = hash_secret(&access_key);
    let now = Utc::now();
    sqlx::query(
        r#"
        UPDATE access_keys
        SET status = 'revoked', revoked_at = $2
        WHERE workspace_id = $1 AND status = 'active'
        "#,
    )
    .bind(&claims.wid)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let result = sqlx::query(
        r#"
        UPDATE workspaces
        SET access_key_hash = $2, access_key_id = $3
        WHERE id = $1
        "#,
    )
    .bind(&claims.wid)
    .bind(&hash)
    .bind(&aki)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("workspace not found".into()));
    }
    sqlx::query(
        r#"
        INSERT INTO access_keys (id, workspace_id, name, key_hash, status)
        VALUES ($1, $2, '默认', $3, 'active')
        "#,
    )
    .bind(&aki)
    .bind(&claims.wid)
    .bind(&hash)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    write_audit(
        &state,
        Some(&claims.wid),
        "access_key.rotated",
        serde_json::json!({ "accessKeyId": aki }),
    )
    .await;
    Ok(Json(RotateResponse {
        access_key,
        access_key_id: aki,
    }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct AccessKeyItem {
    id: String,
    name: String,
    status: String,
    created_at: chrono::DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revoked_at: Option<chrono::DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessKeyListResponse {
    keys: Vec<AccessKeyItem>,
}

async fn list_access_keys(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<AccessKeyListResponse>> {
    let claims = require_client(&state, &headers).await?;
    let keys: Vec<AccessKeyItem> = sqlx::query_as(
        r#"
        SELECT id, name, status, created_at, revoked_at
        FROM access_keys
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(&claims.wid)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(AccessKeyListResponse { keys }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAccessKeyRequest {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateAccessKeyResponse {
    id: String,
    name: String,
    /// Plaintext shown once — store locally; server only keeps hash.
    access_key: String,
}

async fn create_access_key(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateAccessKeyRequest>,
) -> ApiResult<Json<CreateAccessKeyResponse>> {
    let claims = require_client(&state, &headers).await?;
    let name = {
        let n = body.name.trim();
        if n.is_empty() {
            return Err(ApiError::BadRequest("name required".into()));
        }
        n.to_string()
    };
    let access_key = new_secret("gtm_aks", 24);
    let aki = access_key_id(&access_key);
    let hash = hash_secret(&access_key);
    sqlx::query(
        r#"
        INSERT INTO access_keys (id, workspace_id, name, key_hash, status)
        VALUES ($1, $2, $3, $4, 'active')
        "#,
    )
    .bind(&aki)
    .bind(&claims.wid)
    .bind(&name)
    .bind(&hash)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    // Keep legacy workspace columns pointing at latest created key for older clients.
    let _ = sqlx::query(
        r#"
        UPDATE workspaces
        SET access_key_hash = $2, access_key_id = $3
        WHERE id = $1
        "#,
    )
    .bind(&claims.wid)
    .bind(&hash)
    .bind(&aki)
    .execute(&state.pool)
    .await;
    write_audit(
        &state,
        Some(&claims.wid),
        "access_key.created",
        serde_json::json!({ "accessKeyId": aki, "name": name }),
    )
    .await;
    Ok(Json(CreateAccessKeyResponse {
        id: aki,
        name,
        access_key,
    }))
}

async fn revoke_access_key(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let claims = require_client(&state, &headers).await?;
    let key_id = id.trim();
    if key_id.is_empty() {
        return Err(ApiError::BadRequest("id required".into()));
    }
    let active_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint
        FROM access_keys
        WHERE workspace_id = $1 AND status = 'active'
        "#,
    )
    .bind(&claims.wid)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    if active_count.0 <= 1 {
        return Err(ApiError::BadRequest(
            "cannot revoke the last active access key".into(),
        ));
    }
    let now = Utc::now();
    let result = sqlx::query(
        r#"
        UPDATE access_keys
        SET status = 'revoked', revoked_at = $3
        WHERE id = $1 AND workspace_id = $2 AND status = 'active'
        "#,
    )
    .bind(key_id)
    .bind(&claims.wid)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("access key not found".into()));
    }
    write_audit(
        &state,
        Some(&claims.wid),
        "access_key.revoked",
        serde_json::json!({ "accessKeyId": key_id }),
    )
    .await;
    Ok(Json(serde_json::json!({ "ok": true, "id": key_id })))
}

use crate::error::{ApiError, ApiResult};
use crate::ids::{access_key_id, hash_secret, new_secret};
use crate::proxy::{list_devices_for_workspace, require_admin, write_audit, DeviceInfo};
use crate::state::AppState;
use axum::extract::Path;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/admin/metrics", get(metrics))
        .route("/cloud/v1/admin/workspaces", get(list_workspaces))
        .route("/cloud/v1/admin/workspaces/{id}", get(get_workspace))
        .route(
            "/cloud/v1/admin/workspaces/{id}/access-key/rotate",
            post(admin_rotate_key),
        )
        .route(
            "/cloud/v1/admin/workspaces/{id}/default-device",
            post(set_default_device),
        )
        .route("/cloud/v1/admin/devices", get(list_devices))
        .route("/cloud/v1/admin/devices/{id}/revoke", post(revoke_device))
        .route("/cloud/v1/admin/jwt/revoke", post(revoke_jwt))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricsResponse {
    workspace_count: i64,
    device_count: i64,
    online_device_count: usize,
}

async fn metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<MetricsResponse>> {
    require_admin(&state, &headers).await?;
    let workspace_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM workspaces")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    let device_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM devices WHERE status != 'revoked'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(MetricsResponse {
        workspace_count: workspace_count.0,
        device_count: device_count.0,
        online_device_count: state.tunnels.online_count().await,
    }))
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceListItem {
    id: String,
    status: String,
    access_key_id: String,
    default_device_id: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn list_workspaces(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<WorkspaceListItem>>> {
    require_admin(&state, &headers).await?;
    let rows: Vec<WorkspaceListItem> = sqlx::query_as(
        r#"
        SELECT id, status, access_key_id, default_device_id, created_at
        FROM workspaces
        ORDER BY created_at DESC
        LIMIT 500
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDetail {
    id: String,
    status: String,
    access_key_id: String,
    default_device_id: Option<String>,
    devices: Vec<DeviceInfo>,
}

async fn get_workspace(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<WorkspaceDetail>> {
    require_admin(&state, &headers).await?;
    let row: Option<(String, String, String, Option<String>)> = sqlx::query_as(
        r#"
        SELECT id, status, access_key_id, default_device_id
        FROM workspaces WHERE id = $1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    let (id, status, access_key_id, default_device_id) =
        row.ok_or_else(|| ApiError::NotFound("workspace not found".into()))?;
    let devices = list_devices_for_workspace(&state, &id).await?;
    Ok(Json(WorkspaceDetail {
        id,
        status,
        access_key_id,
        default_device_id,
        devices,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RotateKeyResponse {
    access_key: String,
    access_key_id: String,
}

async fn admin_rotate_key(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<RotateKeyResponse>> {
    require_admin(&state, &headers).await?;
    let access_key = new_secret("gtm_aks", 24);
    let aki = access_key_id(&access_key);
    let hash = hash_secret(&access_key);
    let result = sqlx::query(
        r#"
        UPDATE workspaces SET access_key_hash = $2, access_key_id = $3 WHERE id = $1
        "#,
    )
    .bind(&id)
    .bind(&hash)
    .bind(&aki)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("workspace not found".into()));
    }
    write_audit(
        &state,
        Some(&id),
        "access_key.rotated_admin",
        serde_json::json!({ "accessKeyId": aki }),
    )
    .await;
    Ok(Json(RotateKeyResponse {
        access_key,
        access_key_id: aki,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetDefaultDeviceRequest {
    device_id: String,
}

#[derive(Debug, Serialize)]
struct OkResponse {
    ok: bool,
}

async fn set_default_device(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SetDefaultDeviceRequest>,
) -> ApiResult<Json<OkResponse>> {
    require_admin(&state, &headers).await?;
    let exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM devices WHERE id = $1 AND workspace_id = $2 AND status != 'revoked'",
    )
    .bind(&body.device_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    if exists.is_none() {
        return Err(ApiError::BadRequest("device not in workspace".into()));
    }
    sqlx::query("UPDATE workspaces SET default_device_id = $2 WHERE id = $1")
        .bind(&id)
        .bind(&body.device_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(OkResponse { ok: true }))
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminDeviceRow {
    id: String,
    workspace_id: String,
    name: String,
    client_version: String,
    status: String,
    last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminDeviceView {
    #[serde(flatten)]
    row: AdminDeviceRow,
    online: bool,
}

async fn list_devices(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<AdminDeviceView>>> {
    require_admin(&state, &headers).await?;
    let rows: Vec<AdminDeviceRow> = sqlx::query_as(
        r#"
        SELECT id, workspace_id, name, client_version, status, last_seen_at, created_at
        FROM devices
        ORDER BY created_at DESC
        LIMIT 1000
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let online = state.tunnels.is_online(&row.id).await;
        out.push(AdminDeviceView { row, online });
    }
    Ok(Json(out))
}

async fn revoke_device(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<OkResponse>> {
    require_admin(&state, &headers).await?;
    let row: Option<(String,)> = sqlx::query_as("SELECT workspace_id FROM devices WHERE id = $1")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    let (workspace_id,) = row.ok_or_else(|| ApiError::NotFound("device not found".into()))?;

    sqlx::query(
        r#"
        UPDATE devices
        SET status = 'revoked', device_token_hash = NULL
        WHERE id = $1
        "#,
    )
    .bind(&id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    state.tunnels.force_unregister(&id).await;

    write_audit(
        &state,
        Some(&workspace_id),
        "device.revoked",
        serde_json::json!({ "deviceId": id }),
    )
    .await;
    Ok(Json(OkResponse { ok: true }))
}

#[derive(Debug, Deserialize)]
struct RevokeJwtRequest {
    jti: String,
    #[serde(default)]
    workspace_id: Option<String>,
}

async fn revoke_jwt(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RevokeJwtRequest>,
) -> ApiResult<Json<OkResponse>> {
    require_admin(&state, &headers).await?;
    let jti = body.jti.trim();
    if jti.is_empty() {
        return Err(ApiError::BadRequest("jti required".into()));
    }
    let wid = body.workspace_id.unwrap_or_else(|| "unknown".into());
    let expires = chrono::Utc::now() + chrono::Duration::days(2);
    sqlx::query(
        r#"
        INSERT INTO jwt_blacklist (jti, workspace_id, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (jti) DO NOTHING
        "#,
    )
    .bind(jti)
    .bind(&wid)
    .bind(expires)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(OkResponse { ok: true }))
}

use crate::error::{ApiError, ApiResult};
use crate::ids::{access_key_id, hash_secret, new_secret};
use crate::proxy::{list_devices_for_workspace, require_admin, write_audit, DeviceInfo};
use crate::state::AppState;
use axum::extract::{Path, Query};
use axum::http::HeaderMap;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/admin/metrics", get(metrics))
        .route("/cloud/v1/admin/workspaces", get(list_workspaces))
        .route(
            "/cloud/v1/admin/workspaces/{id}",
            get(get_workspace).delete(delete_workspace),
        )
        .route(
            "/cloud/v1/admin/workspaces/{id}/access-key/rotate",
            post(admin_rotate_key),
        )
        .route(
            "/cloud/v1/admin/workspaces/{id}/default-device",
            post(set_default_device),
        )
        .route(
            "/cloud/v1/admin/workspaces/{id}/disable",
            post(disable_workspace),
        )
        .route(
            "/cloud/v1/admin/workspaces/{id}/enable",
            post(enable_workspace),
        )
        .route("/cloud/v1/admin/devices", get(list_devices))
        .route(
            "/cloud/v1/admin/devices/revoke-batch",
            post(revoke_devices_batch),
        )
        .route("/cloud/v1/admin/devices/{id}/revoke", post(revoke_device))
        .route("/cloud/v1/admin/devices/{id}", delete(delete_device))
        .route("/cloud/v1/admin/jwt/revoke", post(revoke_jwt))
        .route("/cloud/v1/admin/audit", get(list_audit))
}

fn clamp_page(page: Option<i64>) -> i64 {
    page.unwrap_or(1).max(1)
}

fn clamp_page_size(page_size: Option<i64>) -> i64 {
    page_size.unwrap_or(20).clamp(1, 200)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageResponse<T> {
    items: Vec<T>,
    total: i64,
    page: i64,
    page_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricsResponse {
    workspace_count: i64,
    device_count: i64,
    online_device_count: usize,
    revoked_device_count: i64,
    disabled_workspace_count: i64,
    audit_event_count_24h: i64,
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
    let revoked_device_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM devices WHERE status = 'revoked'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    let disabled_workspace_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM workspaces WHERE status = 'disabled'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    let audit_event_count_24h: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM audit_events WHERE created_at >= NOW() - INTERVAL '24 hours'",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(MetricsResponse {
        workspace_count: workspace_count.0,
        device_count: device_count.0,
        online_device_count: state.tunnels.online_count().await,
        revoked_device_count: revoked_device_count.0,
        disabled_workspace_count: disabled_workspace_count.0,
        audit_event_count_24h: audit_event_count_24h.0,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceListQuery {
    q: Option<String>,
    status: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
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
    Query(query): Query<WorkspaceListQuery>,
) -> ApiResult<Json<PageResponse<WorkspaceListItem>>> {
    require_admin(&state, &headers).await?;
    let page = clamp_page(query.page);
    let page_size = clamp_page_size(query.page_size);
    let offset = (page - 1) * page_size;
    let q = query.q.as_deref().unwrap_or("").trim().to_string();
    let status = query
        .status
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let like = if q.is_empty() {
        None
    } else {
        Some(format!("%{}%", q.replace('%', "\\%").replace('_', "\\_")))
    };

    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM workspaces
        WHERE ($1::text IS NULL OR id ILIKE $1 OR access_key_id ILIKE $1)
          AND (
            ($2::text = '' AND status <> 'disabled')
            OR $2::text = 'all'
            OR ($2::text <> '' AND $2::text <> 'all' AND status = $2)
          )
        "#,
    )
    .bind(&like)
    .bind(&status)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let rows: Vec<WorkspaceListItem> = sqlx::query_as(
        r#"
        SELECT id, status, access_key_id, default_device_id, created_at
        FROM workspaces
        WHERE ($1::text IS NULL OR id ILIKE $1 OR access_key_id ILIKE $1)
          AND (
            ($2::text = '' AND status <> 'disabled')
            OR $2::text = 'all'
            OR ($2::text <> '' AND $2::text <> 'all' AND status = $2)
          )
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        "#,
    )
    .bind(&like)
    .bind(&status)
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(PageResponse {
        items: rows,
        total: total.0,
        page,
        page_size,
    }))
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
    // Keep access_keys table in sync: revoke active rows, insert the new key.
    let _ = sqlx::query(
        r#"
        UPDATE access_keys
        SET status = 'revoked', revoked_at = NOW()
        WHERE workspace_id = $1 AND status = 'active'
        "#,
    )
    .bind(&id)
    .execute(&state.pool)
    .await;
    let _ = sqlx::query(
        r#"
        INSERT INTO access_keys (id, workspace_id, name, key_hash, status)
        VALUES ($1, $2, 'admin-rotated', $3, 'active')
        ON CONFLICT (id) DO UPDATE
        SET key_hash = EXCLUDED.key_hash, status = 'active', revoked_at = NULL
        "#,
    )
    .bind(&aki)
    .bind(&id)
    .bind(&hash)
    .execute(&state.pool)
    .await;
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchOkResponse {
    ok: bool,
    revoked: usize,
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

async fn set_workspace_status(
    state: &AppState,
    id: &str,
    status: &str,
) -> ApiResult<Json<OkResponse>> {
    let result = sqlx::query("UPDATE workspaces SET status = $2 WHERE id = $1")
        .bind(id)
        .bind(status)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("workspace not found".into()));
    }
    write_audit(
        state,
        Some(id),
        if status == "disabled" {
            "workspace.disabled"
        } else {
            "workspace.enabled"
        },
        serde_json::json!({ "status": status }),
    )
    .await;
    Ok(Json(OkResponse { ok: true }))
}

async fn disable_workspace(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<OkResponse>> {
    require_admin(&state, &headers).await?;
    set_workspace_status(&state, &id, "disabled").await
}

async fn enable_workspace(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<OkResponse>> {
    require_admin(&state, &headers).await?;
    set_workspace_status(&state, &id, "active").await
}

async fn delete_workspace(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<OkResponse>> {
    require_admin(&state, &headers).await?;
    // Collect device ids first so we can drop live tunnels.
    let device_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM devices WHERE workspace_id = $1")
        .bind(&id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    for (device_id,) in &device_ids {
        state.tunnels.force_unregister(device_id).await;
    }
    let result = sqlx::query("DELETE FROM workspaces WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("workspace not found".into()));
    }
    write_audit(
        &state,
        Some(&id),
        "workspace.deleted",
        serde_json::json!({ "deviceCount": device_ids.len() }),
    )
    .await;
    Ok(Json(OkResponse { ok: true }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceListQuery {
    q: Option<String>,
    status: Option<String>,
    workspace_id: Option<String>,
    online: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
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
    Query(query): Query<DeviceListQuery>,
) -> ApiResult<Json<PageResponse<AdminDeviceView>>> {
    require_admin(&state, &headers).await?;
    let page = clamp_page(query.page);
    let page_size = clamp_page_size(query.page_size);
    let offset = (page - 1) * page_size;
    let q = query.q.as_deref().unwrap_or("").trim().to_string();
    let status = query
        .status
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let workspace_id = query
        .workspace_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let online_filter = query
        .online
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let like = if q.is_empty() {
        None
    } else {
        Some(format!("%{}%", q.replace('%', "\\%").replace('_', "\\_")))
    };
    let online_ids = state.tunnels.online_device_ids().await;
    let online_ids_for_sql: Option<Vec<String>> = match online_filter.as_str() {
        "true" | "1" | "online" => Some(online_ids.clone()),
        "false" | "0" | "offline" => Some(online_ids.clone()),
        _ => None,
    };
    let want_online = matches!(online_filter.as_str(), "true" | "1" | "online");

    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM devices
        WHERE ($1::text IS NULL OR id ILIKE $1 OR name ILIKE $1 OR workspace_id ILIKE $1 OR client_version ILIKE $1)
          AND (
            ($2::text = '' AND status <> 'revoked')
            OR $2::text = 'all'
            OR ($2::text <> '' AND $2::text <> 'all' AND status = $2)
          )
          AND ($3::text = '' OR workspace_id = $3)
          AND (
            $4::text[] IS NULL
            OR ($5::bool = true AND id = ANY($4))
            OR ($5::bool = false AND NOT (id = ANY($4)))
          )
        "#,
    )
    .bind(&like)
    .bind(&status)
    .bind(&workspace_id)
    .bind(&online_ids_for_sql)
    .bind(want_online)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let rows: Vec<AdminDeviceRow> = sqlx::query_as(
        r#"
        SELECT id, workspace_id, name, client_version, status, last_seen_at, created_at
        FROM devices
        WHERE ($1::text IS NULL OR id ILIKE $1 OR name ILIKE $1 OR workspace_id ILIKE $1 OR client_version ILIKE $1)
          AND (
            ($2::text = '' AND status <> 'revoked')
            OR $2::text = 'all'
            OR ($2::text <> '' AND $2::text <> 'all' AND status = $2)
          )
          AND ($3::text = '' OR workspace_id = $3)
          AND (
            $4::text[] IS NULL
            OR ($5::bool = true AND id = ANY($4))
            OR ($5::bool = false AND NOT (id = ANY($4)))
          )
        ORDER BY created_at DESC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(&like)
    .bind(&status)
    .bind(&workspace_id)
    .bind(&online_ids_for_sql)
    .bind(want_online)
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let online_set: std::collections::HashSet<_> = online_ids.into_iter().collect();
    let items = rows
        .into_iter()
        .map(|row| {
            let online = online_set.contains(&row.id);
            AdminDeviceView { row, online }
        })
        .collect();

    Ok(Json(PageResponse {
        items,
        total: total.0,
        page,
        page_size,
    }))
}

async fn revoke_one_device(state: &AppState, id: &str) -> ApiResult<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT workspace_id FROM devices WHERE id = $1")
        .bind(id)
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
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    state.tunnels.force_unregister(id).await;

    write_audit(
        state,
        Some(&workspace_id),
        "device.revoked",
        serde_json::json!({ "deviceId": id }),
    )
    .await;
    Ok(workspace_id)
}

async fn revoke_device(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<OkResponse>> {
    require_admin(&state, &headers).await?;
    let _ = revoke_one_device(&state, &id).await?;
    Ok(Json(OkResponse { ok: true }))
}

async fn delete_device(
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
    state.tunnels.force_unregister(&id).await;
    // Clear default pointer if this device was the workspace default.
    let _ = sqlx::query(
        "UPDATE workspaces SET default_device_id = NULL WHERE id = $1 AND default_device_id = $2",
    )
    .bind(&workspace_id)
    .bind(&id)
    .execute(&state.pool)
    .await;
    sqlx::query("DELETE FROM devices WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    write_audit(
        &state,
        Some(&workspace_id),
        "device.deleted",
        serde_json::json!({ "deviceId": id }),
    )
    .await;
    Ok(Json(OkResponse { ok: true }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevokeBatchRequest {
    device_ids: Vec<String>,
}

async fn revoke_devices_batch(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RevokeBatchRequest>,
) -> ApiResult<Json<BatchOkResponse>> {
    require_admin(&state, &headers).await?;
    let mut revoked = 0usize;
    for raw in body.device_ids {
        let id = raw.trim();
        if id.is_empty() {
            continue;
        }
        match revoke_one_device(&state, id).await {
            Ok(_) => revoked += 1,
            Err(ApiError::NotFound(_)) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(Json(BatchOkResponse { ok: true, revoked }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    write_audit(
        &state,
        Some(&wid),
        "jwt.revoked_admin",
        serde_json::json!({ "jti": jti }),
    )
    .await;
    Ok(Json(OkResponse { ok: true }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditListQuery {
    q: Option<String>,
    workspace_id: Option<String>,
    event_type: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditEventRow {
    id: i64,
    workspace_id: Option<String>,
    event_type: String,
    meta_json: serde_json::Value,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn list_audit(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditListQuery>,
) -> ApiResult<Json<PageResponse<AuditEventRow>>> {
    require_admin(&state, &headers).await?;
    let page = clamp_page(query.page);
    let page_size = clamp_page_size(query.page_size);
    let offset = (page - 1) * page_size;
    let q = query.q.as_deref().unwrap_or("").trim().to_string();
    let workspace_id = query
        .workspace_id
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let event_type = query
        .event_type
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let like = if q.is_empty() {
        None
    } else {
        Some(format!("%{}%", q.replace('%', "\\%").replace('_', "\\_")))
    };

    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM audit_events
        WHERE ($1::text IS NULL OR event_type ILIKE $1 OR COALESCE(workspace_id, '') ILIKE $1 OR meta_json::text ILIKE $1)
          AND ($2::text = '' OR workspace_id = $2)
          AND ($3::text = '' OR event_type = $3)
        "#,
    )
    .bind(&like)
    .bind(&workspace_id)
    .bind(&event_type)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let rows: Vec<AuditEventRow> = sqlx::query_as(
        r#"
        SELECT id, workspace_id, event_type, meta_json, created_at
        FROM audit_events
        WHERE ($1::text IS NULL OR event_type ILIKE $1 OR COALESCE(workspace_id, '') ILIKE $1 OR meta_json::text ILIKE $1)
          AND ($2::text = '' OR workspace_id = $2)
          AND ($3::text = '' OR event_type = $3)
        ORDER BY created_at DESC, id DESC
        LIMIT $4 OFFSET $5
        "#,
    )
    .bind(&like)
    .bind(&workspace_id)
    .bind(&event_type)
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(PageResponse {
        items: rows,
        total: total.0,
        page,
        page_size,
    }))
}

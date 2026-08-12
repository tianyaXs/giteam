use crate::auth::{bearer_token, verify_client_jwt, ClientClaims};
use crate::error::{
    device_offline, no_device_online, selection_required, ApiError, ApiResult,
};
use crate::ids::hash_secret;
use crate::state::AppState;
use crate::tunnel::DevicePresence;
use axum::http::{HeaderMap, Method};
use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, FromRow)]
pub struct WorkspaceRow {
    pub id: String,
    pub access_key_hash: String,
    pub access_key_id: String,
    pub default_device_id: Option<String>,
    pub status: String,
}

#[derive(Debug, FromRow, Clone)]
pub struct DeviceRow {
    pub id: String,
    pub workspace_id: String,
    pub device_token_hash: Option<String>,
    pub name: String,
    pub client_version: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_version: Option<String>,
}

pub fn is_allowed_path(method: &Method, path: &str) -> bool {
    let path_only = path.split('?').next().unwrap_or(path);
    if path_only == "/api/v1/health" && *method == Method::GET {
        return true;
    }
    if path_only == "/api/v1/repository/list" && *method == Method::GET {
        return true;
    }
    // Mobile model catalog over cloud relay.
    if path_only == "/api/v1/admin/mobile/model-state" && *method == Method::GET {
        return true;
    }
    // Mobile model toggles (enabled/hidden) — write path for bidirectional sync.
    if path_only == "/api/v1/admin/mobile/model-visibility" && *method == Method::PUT {
        return true;
    }
    if path_only.starts_with("/api/v1/agent/") {
        return true;
    }
    false
}

pub fn is_sse_path(path: &str) -> bool {
    let path_only = path.split('?').next().unwrap_or(path);
    path_only == "/api/v1/agent/stream"
}

pub async fn require_admin(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = bearer_token(auth)?;
    if token != state.config.admin_token {
        return Err(ApiError::Unauthorized("invalid admin token".into()));
    }
    Ok(())
}

pub async fn require_client(state: &AppState, headers: &HeaderMap) -> ApiResult<ClientClaims> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = bearer_token(auth)?;
    let claims = verify_client_jwt(&state.config.jwt_secret, token)?;
    let blacklisted: Option<(String,)> =
        sqlx::query_as("SELECT jti FROM jwt_blacklist WHERE jti = $1")
            .bind(&claims.jti)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    if blacklisted.is_some() {
        return Err(ApiError::Unauthorized("token revoked".into()));
    }
    Ok(claims)
}

pub async fn lookup_workspace_by_access_key(
    state: &AppState,
    access_key: &str,
) -> ApiResult<WorkspaceRow> {
    let key = access_key.trim();
    if key.is_empty() {
        return Err(ApiError::Unauthorized("invalid access_key".into()));
    }
    let aki = crate::ids::access_key_id(key);
    let expected_hash = hash_secret(key);

    // Prefer named keys table (multi-key).
    let keyed: Option<(String, String)> = sqlx::query_as(
        r#"
        SELECT workspace_id, key_hash
        FROM access_keys
        WHERE id = $1 AND status = 'active'
        "#,
    )
    .bind(&aki)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if let Some((workspace_id, key_hash)) = keyed {
        if key_hash != expected_hash {
            return Err(ApiError::Unauthorized("invalid access_key".into()));
        }
        let ws: Option<WorkspaceRow> = sqlx::query_as(
            r#"
            SELECT id, access_key_hash, access_key_id, default_device_id, status
            FROM workspaces
            WHERE id = $1 AND status = 'active'
            "#,
        )
        .bind(&workspace_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
        return ws.ok_or_else(|| ApiError::Unauthorized("invalid access_key".into()));
    }

    // Legacy fallback: single key columns on workspaces.
    let row: Option<WorkspaceRow> = sqlx::query_as(
        r#"
        SELECT id, access_key_hash, access_key_id, default_device_id, status
        FROM workspaces
        WHERE access_key_id = $1 AND status = 'active'
        "#,
    )
    .bind(&aki)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let ws = row.ok_or_else(|| ApiError::Unauthorized("invalid access_key".into()))?;
    if ws.access_key_hash != expected_hash {
        return Err(ApiError::Unauthorized("invalid access_key".into()));
    }
    Ok(ws)
}

pub async fn list_devices_for_workspace(
    state: &AppState,
    workspace_id: &str,
) -> ApiResult<Vec<DeviceInfo>> {
    let rows: Vec<DeviceRow> = sqlx::query_as(
        r#"
        SELECT id, workspace_id, device_token_hash, name, client_version, status
        FROM devices
        WHERE workspace_id = $1 AND status != 'revoked'
        ORDER BY created_at ASC
        "#,
    )
    .bind(workspace_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let online = state.tunnels.online_devices(workspace_id).await;
    let online_ids: std::collections::HashSet<_> = online.into_iter().map(|d| d.id).collect();

    Ok(rows
        .into_iter()
        .map(|d| DeviceInfo {
            id: d.id.clone(),
            name: d.name,
            online: online_ids.contains(&d.id),
            client_version: if d.client_version.is_empty() {
                None
            } else {
                Some(d.client_version)
            },
        })
        .collect())
}

pub async fn resolve_device_id(
    state: &AppState,
    workspace_id: &str,
    jwt_did: &str,
    header_did: Option<&str>,
    default_device_id: Option<&str>,
) -> ApiResult<String> {
    let devices = list_devices_for_workspace(state, workspace_id).await?;
    let online: Vec<_> = devices.iter().filter(|d| d.online).cloned().collect();
    if online.is_empty() {
        return Err(no_device_online());
    }

    let candidates = [
        header_did.map(str::to_string),
        Some(jwt_did.to_string()),
        default_device_id.map(str::to_string),
    ];

    for cand in candidates.into_iter().flatten() {
        if cand.is_empty() {
            continue;
        }
        if let Some(dev) = devices.iter().find(|d| d.id == cand) {
            if !dev.online {
                return Err(device_offline());
            }
            return Ok(cand);
        }
    }

    if online.len() == 1 {
        return Ok(online[0].id.clone());
    }

    let value = serde_json::to_value(
        online
            .iter()
            .map(|d| DevicePresence {
                id: d.id.clone(),
                name: d.name.clone(),
                online: true,
                connected_at: None,
            })
            .collect::<Vec<_>>(),
    )
    .unwrap_or_default();
    Err(selection_required(value))
}

pub fn header_device_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-giteam-device-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub async fn find_device_by_token(
    state: &AppState,
    device_token: &str,
) -> ApiResult<DeviceRow> {
    let hash = hash_secret(device_token);
    let row: Option<DeviceRow> = sqlx::query_as(
        r#"
        SELECT id, workspace_id, device_token_hash, name, client_version, status
        FROM devices
        WHERE device_token_hash = $1 AND status = 'active'
        "#,
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    row.ok_or_else(|| ApiError::Unauthorized("invalid device token".into()))
}

pub async fn write_audit(
    state: &AppState,
    workspace_id: Option<&str>,
    event_type: &str,
    meta: serde_json::Value,
) {
    let _ = sqlx::query(
        r#"
        INSERT INTO audit_events (workspace_id, event_type, meta_json)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(workspace_id)
    .bind(event_type)
    .bind(meta)
    .execute(&state.pool)
    .await;
}

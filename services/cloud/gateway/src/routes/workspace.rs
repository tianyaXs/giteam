use crate::error::{ApiError, ApiResult};
use crate::ids::{access_key_id, hash_secret, new_secret};
use crate::proxy::{list_devices_for_workspace, require_client, write_audit};
use crate::state::AppState;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/workspace/status", get(status))
        .route(
            "/cloud/v1/workspace/access-key/rotate",
            post(rotate_access_key),
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
    let claims = require_client(&state, &headers).await?;
    let access_key = new_secret("gtm_aks", 24);
    let aki = access_key_id(&access_key);
    let hash = hash_secret(&access_key);
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

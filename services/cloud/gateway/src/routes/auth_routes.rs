use crate::auth::issue_client_jwt;
use crate::error::{ApiError, ApiResult};
use crate::proxy::{
    list_devices_for_workspace, lookup_workspace_by_access_key, require_client, write_audit,
};
use crate::state::AppState;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/auth/redeem", post(redeem))
        .route("/cloud/v1/auth/revoke", post(revoke))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RedeemRequest {
    access_key: String,
    #[serde(default)]
    device_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RedeemResponse {
    workspace_id: String,
    device_id: String,
    token: String,
    token_type: &'static str,
    expires_at: i64,
    devices: Vec<crate::proxy::DeviceInfo>,
}

async fn redeem(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(body): Json<RedeemRequest>,
) -> ApiResult<Json<RedeemResponse>> {
    let ws = lookup_workspace_by_access_key(&state, &body.access_key).await?;
    let devices = list_devices_for_workspace(&state, &ws.id).await?;
    if devices.is_empty() {
        return Err(ApiError::Unavailable {
            code: "no_device_online".into(),
            message: "workspace has no devices".into(),
        });
    }

    let requested = body
        .device_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let selected = if let Some(did) = requested {
        devices
            .iter()
            .find(|d| d.id == did)
            .ok_or_else(|| ApiError::BadRequest("deviceId not in workspace".into()))?
            .id
            .clone()
    } else {
        let online: Vec<_> = devices.iter().filter(|d| d.online).collect();
        if online.len() == 1 {
            online[0].id.clone()
        } else if let Some(default_id) = ws.default_device_id.as_ref() {
            if devices.iter().any(|d| &d.id == default_id) {
                default_id.clone()
            } else if online.is_empty() && devices.len() == 1 {
                devices[0].id.clone()
            } else if online.len() > 1 {
                return Err(crate::error::selection_required(
                    serde_json::to_value(&devices).unwrap_or_default(),
                ));
            } else if devices.len() == 1 {
                devices[0].id.clone()
            } else {
                return Err(crate::error::selection_required(
                    serde_json::to_value(&devices).unwrap_or_default(),
                ));
            }
        } else if devices.len() == 1 {
            devices[0].id.clone()
        } else {
            return Err(crate::error::selection_required(
                serde_json::to_value(&devices).unwrap_or_default(),
            ));
        }
    };

    let (token, expires_at) = issue_client_jwt(
        &state.config.jwt_secret,
        &ws.id,
        &selected,
        state.config.jwt_ttl_secs,
    )?;

    Ok(Json(RedeemResponse {
        workspace_id: ws.id,
        device_id: selected,
        token,
        token_type: "Bearer",
        expires_at,
        devices,
    }))
}

#[derive(Debug, Serialize)]
struct RevokeResponse {
    ok: bool,
}

async fn revoke(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<RevokeResponse>> {
    let claims = require_client(&state, &headers).await?;
    let exp = chrono::DateTime::from_timestamp(claims.exp, 0)
        .unwrap_or_else(|| chrono::Utc::now() + chrono::Duration::hours(24));
    sqlx::query(
        r#"
        INSERT INTO jwt_blacklist (jti, workspace_id, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (jti) DO NOTHING
        "#,
    )
    .bind(&claims.jti)
    .bind(&claims.wid)
    .bind(exp)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    write_audit(
        &state,
        Some(&claims.wid),
        "jwt.revoked",
        serde_json::json!({ "jti": claims.jti }),
    )
    .await;

    Ok(Json(RevokeResponse { ok: true }))
}

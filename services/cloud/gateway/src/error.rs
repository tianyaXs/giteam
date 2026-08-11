use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{message}")]
    Conflict { code: String, message: String, devices: Option<serde_json::Value> },
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    PayloadTooLarge(String),
    #[error("{message}")]
    Unavailable { code: String, message: String },
    #[error("{0}")]
    GatewayTimeout(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    pub fn code(&self) -> &str {
        match self {
            Self::BadRequest(_) => "bad_request",
            Self::Unauthorized(msg) if msg.contains("expired") => "token_expired",
            Self::Unauthorized(msg) if msg.contains("revoked") => "token_revoked",
            Self::Unauthorized(msg) if msg.contains("access_key") => "invalid_access_key",
            Self::Unauthorized(_) => "unauthorized",
            Self::Forbidden(_) => "path_forbidden",
            Self::Conflict { code, .. } => code.as_str(),
            Self::NotFound(_) => "not_found",
            Self::PayloadTooLarge(_) => "payload_too_large",
            Self::Unavailable { code, .. } => code.as_str(),
            Self::GatewayTimeout(_) => "tunnel_timeout",
            Self::Internal(_) => "internal_error",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::Conflict { .. } => StatusCode::CONFLICT,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            Self::Unavailable { .. } => StatusCode::SERVICE_UNAVAILABLE,
            Self::GatewayTimeout(_) => StatusCode::GATEWAY_TIMEOUT,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    devices: Option<serde_json::Value>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        let devices = match &self {
            Self::Conflict { devices, .. } => devices.clone(),
            _ => None,
        };
        let message = match &self {
            Self::Conflict { message, .. } => message.clone(),
            Self::Unavailable { message, .. } => message.clone(),
            Self::Internal(err) => {
                tracing::error!(error = %err, "internal error");
                "internal error".to_string()
            }
            other => other.to_string(),
        };
        let body = ErrorBody {
            code: self.code().to_string(),
            message,
            devices,
        };
        (status, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

pub fn json_ok<T: Serialize>(value: T) -> impl IntoResponse {
    (StatusCode::OK, Json(value))
}

pub fn device_offline() -> ApiError {
    ApiError::Unavailable {
        code: "device_offline".into(),
        message: "selected device is offline".into(),
    }
}

pub fn no_device_online() -> ApiError {
    ApiError::Unavailable {
        code: "no_device_online".into(),
        message: "no device is online in this workspace".into(),
    }
}

pub fn selection_required(devices: serde_json::Value) -> ApiError {
    ApiError::Conflict {
        code: "device_selection_required".into(),
        message: "multiple devices online; select deviceId".into(),
        devices: Some(devices),
    }
}

pub fn audit_meta(value: impl Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or_else(|_| json!({}))
}

use crate::error::{ApiError, ApiResult};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientClaims {
    pub iss: String,
    pub sub: String,
    pub wid: String,
    pub did: String,
    pub jti: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn issue_client_jwt(
    secret: &str,
    workspace_id: &str,
    device_id: &str,
    ttl_secs: i64,
) -> ApiResult<(String, i64, String)> {
    let now = Utc::now();
    let exp = now + Duration::seconds(ttl_secs);
    let jti = uuid::Uuid::new_v4().to_string();
    let claims = ClientClaims {
        iss: "giteam-cloud".into(),
        sub: "client".into(),
        wid: workspace_id.to_string(),
        did: device_id.to_string(),
        jti: jti.clone(),
        iat: now.timestamp(),
        exp: exp.timestamp(),
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok((token, exp.timestamp(), jti))
}

pub fn verify_client_jwt(secret: &str, token: &str) -> ApiResult<ClientClaims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_issuer(&["giteam-cloud"]);
    validation.sub = Some("client".to_string());
    decode::<ClientClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|err| {
        let msg = err.to_string();
        if msg.to_lowercase().contains("expired") {
            ApiError::Unauthorized("token expired".into())
        } else {
            ApiError::Unauthorized("invalid token".into())
        }
    })
}

pub fn bearer_token<'a>(header: Option<&'a str>) -> ApiResult<&'a str> {
    let raw = header.ok_or_else(|| ApiError::Unauthorized("missing authorization".into()))?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .ok_or_else(|| ApiError::Unauthorized("invalid authorization scheme".into()))?
        .trim();
    if token.is_empty() {
        return Err(ApiError::Unauthorized("empty bearer token".into()));
    }
    Ok(token)
}

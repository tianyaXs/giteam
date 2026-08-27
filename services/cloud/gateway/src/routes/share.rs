//! Project Share 路由：代码包与上下文分块上传 / dumb-HTTP git / 下载 / 管理。
//!
//! 存储布局（active）：
//! ```text
//! SHARE_STORAGE_DIR/<shareId>/
//!   repo.bundle       # 上传的 git bundle（可选保留）
//!   repo.git/         # finalize 物化的 bare + update-server-info
//!   context.tar.zst   # 会话 / 记忆 / 附件 / manifest
//! ```
//!
//! 鉴权：写路径走 device token；`GET /cloud/v1/shares/{id}`、`/download`、
//! `/s/{id}/repo.git/*` 为 capability 公开端点（shareId 即凭据）。

use crate::error::{ApiError, ApiResult};
use crate::ids::new_id;
use crate::proxy::{find_device_by_token, write_audit};
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::services::fs::ServeFile;

/// 单块上传上限（客户端默认 4MiB，留余量到 16MiB）。
const MAX_PART_BYTES: usize = 16 * 1024 * 1024;
/// 上传会话（status=uploading）超过该时长视为放弃，由 sweeper 清理。
const UPLOAD_STALE_HOURS: i64 = 24;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cloud/v1/shares", post(create_share).get(list_shares))
        .route("/cloud/v1/shares/{id}/blob", put(upload_part))
        .route("/cloud/v1/shares/{id}/finalize", post(finalize_share))
        .route("/cloud/v1/shares/{id}", get(share_meta).delete(revoke_share))
        .route("/cloud/v1/shares/{id}/download", get(download_share))
        // 公开 dumb-HTTP git（须挂在 SPA fallback 之前，经 routes::router 合并即可）。
        .route("/s/{id}/repo.git/{*git_path}", get(serve_repo_git))
        // 上传端点绕开全局 body 限制，走流式写盘。
        .layer(DefaultBodyLimit::max(MAX_PART_BYTES))
}

#[derive(Debug, FromRow)]
struct ShareRow {
    id: String,
    workspace_id: String,
    name: String,
    repo_name: String,
    default_branch: String,
    head_commit: String,
    size_bytes: i64,
    content_sha256: String,
    context_sha256: String,
    context_size_bytes: i64,
    encrypted: bool,
    status: String,
    storage_key: String,
    expires_at: Option<DateTime<Utc>>,
    download_count: i64,
    created_at: DateTime<Utc>,
    meta_json: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareMetaResponse {
    share_id: String,
    name: String,
    repo_name: String,
    default_branch: String,
    head_commit: String,
    /// 代码包（repo.bundle）字节数。
    size_bytes: i64,
    content_sha256: String,
    context_sha256: String,
    context_size_bytes: i64,
    encrypted: bool,
    status: String,
    download_count: i64,
    created_at: String,
    expires_at: String,
    /// 约定推导：`{public}/s/{id}/repo.git`
    git_url: String,
    meta: serde_json::Value,
}

impl ShareMetaResponse {
    fn from_row(row: &ShareRow, public_base: &str) -> Self {
        Self {
            share_id: row.id.clone(),
            name: row.name.clone(),
            repo_name: row.repo_name.clone(),
            default_branch: row.default_branch.clone(),
            head_commit: row.head_commit.clone(),
            size_bytes: row.size_bytes,
            content_sha256: row.content_sha256.clone(),
            context_sha256: row.context_sha256.clone(),
            context_size_bytes: row.context_size_bytes,
            encrypted: row.encrypted,
            status: row.status.clone(),
            download_count: row.download_count,
            created_at: row.created_at.to_rfc3339(),
            expires_at: row
                .expires_at
                .map(|t| t.to_rfc3339())
                .unwrap_or_default(),
            git_url: format!(
                "{}/s/{}/repo.git",
                public_base.trim_end_matches('/'),
                row.id
            ),
            meta: row.meta_json.clone(),
        }
    }
}

fn share_dir(state: &AppState, share_id: &str) -> std::path::PathBuf {
    std::path::Path::new(&state.config.share_storage_dir).join(share_id)
}

const SHARE_SELECT: &str = r#"
        SELECT id, workspace_id, name, repo_name, default_branch, head_commit,
               size_bytes, content_sha256,
               COALESCE(context_sha256, '') AS context_sha256,
               COALESCE(context_size_bytes, 0) AS context_size_bytes,
               encrypted, status, storage_key,
               expires_at, download_count, created_at, meta_json
        FROM shares
"#;

async fn load_share(state: &AppState, share_id: &str) -> ApiResult<Option<ShareRow>> {
    sqlx::query_as::<_, ShareRow>(&format!("{SHARE_SELECT} WHERE id = $1"))
        .bind(share_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))
}

async fn require_owner(state: &AppState, headers: &HeaderMap, share_id: &str) -> ApiResult<ShareRow> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = crate::auth::bearer_token(auth)?;
    let device = find_device_by_token(state, token).await?;
    let row = load_share(state, share_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("share not found".into()))?;
    if row.workspace_id != device.workspace_id {
        return Err(ApiError::Forbidden("share belongs to another workspace".into()));
    }
    Ok(row)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateShareRequest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    repo_name: String,
    #[serde(default)]
    default_branch: String,
    #[serde(default)]
    head_commit: String,
    /// 代码包（repo.bundle）字节数。
    size_bytes: i64,
    #[serde(default)]
    content_sha256: String,
    #[serde(default)]
    context_sha256: String,
    #[serde(default)]
    context_size_bytes: i64,
    #[serde(default)]
    encrypted: bool,
    #[serde(default)]
    meta: serde_json::Value,
    /// 可选自定义有效期（秒），缺省用 SHARE_TTL_SECS。
    #[serde(default)]
    ttl_secs: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateShareResponse {
    share_id: String,
    upload_part_size: usize,
    expires_at: String,
}

async fn create_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateShareRequest>,
) -> ApiResult<Json<CreateShareResponse>> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = crate::auth::bearer_token(auth)?;
    let device = find_device_by_token(&state, token).await?;

    if body.size_bytes <= 0 {
        return Err(ApiError::BadRequest("sizeBytes (repo) must be positive".into()));
    }
    if body.context_size_bytes < 0 {
        return Err(ApiError::BadRequest("contextSizeBytes must be >= 0".into()));
    }
    let total = body.size_bytes.saturating_add(body.context_size_bytes);
    if total as usize > state.config.share_max_bytes {
        return Err(ApiError::PayloadTooLarge(format!(
            "share exceeds per-share limit of {} bytes",
            state.config.share_max_bytes
        )));
    }
    // 配额：本 workspace 未清理分享 + 本次合计 ≤ 上限。
    let used: (i64,) = sqlx::query_as(
        "SELECT COALESCE(SUM(size_bytes + COALESCE(context_size_bytes, 0)), 0)::BIGINT FROM shares
         WHERE workspace_id = $1 AND status IN ('uploading', 'active')",
    )
    .bind(&device.workspace_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    if used.0 + total > state.config.share_quota_bytes {
        return Err(ApiError::PayloadTooLarge(format!(
            "workspace share quota exceeded ({} / {} bytes used)",
            used.0, state.config.share_quota_bytes
        )));
    }

    let share_id = new_id("shr");
    let ttl = body.ttl_secs.unwrap_or(state.config.share_ttl_secs);
    let expires_at = Utc::now() + Duration::seconds(ttl.max(60));
    sqlx::query(
        r#"
        INSERT INTO shares (id, workspace_id, name, repo_name, default_branch, head_commit,
                            size_bytes, content_sha256, context_sha256, context_size_bytes,
                            encrypted, status, storage_key, expires_at, meta_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'uploading', $12, $13, $14)
        "#,
    )
    .bind(&share_id)
    .bind(&device.workspace_id)
    .bind(body.name.trim())
    .bind(body.repo_name.trim())
    .bind(body.default_branch.trim())
    .bind(body.head_commit.trim())
    .bind(body.size_bytes)
    .bind(body.content_sha256.trim())
    .bind(body.context_sha256.trim())
    .bind(body.context_size_bytes)
    .bind(body.encrypted)
    .bind(&share_id)
    .bind(expires_at)
    .bind(&body.meta)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let dir = share_dir(&state, &share_id);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    write_audit(
        &state,
        Some(&device.workspace_id),
        "share.created",
        serde_json::json!({
            "shareId": share_id,
            "repoName": body.repo_name,
            "repoSizeBytes": body.size_bytes,
            "contextSizeBytes": body.context_size_bytes,
        }),
    )
    .await;

    Ok(Json(CreateShareResponse {
        share_id,
        upload_part_size: 4 * 1024 * 1024,
        expires_at: expires_at.to_rfc3339(),
    }))
}

#[derive(Debug, Deserialize)]
struct UploadPartQuery {
    part: Option<usize>,
    /// `repo`（默认）或 `context`。
    artifact: Option<String>,
}

fn normalize_artifact(raw: Option<&str>) -> ApiResult<&'static str> {
    match raw.map(str::trim).unwrap_or("repo") {
        "" | "repo" | "bundle" => Ok("repo"),
        "context" => Ok("context"),
        other => Err(ApiError::BadRequest(format!(
            "artifact must be repo|context, got {other}"
        ))),
    }
}

async fn upload_part(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
    Query(query): Query<UploadPartQuery>,
    body: Body,
) -> ApiResult<StatusCode> {
    let row = require_owner(&state, &headers, &share_id).await?;
    if row.status != "uploading" {
        return Err(ApiError::Conflict {
            code: "share_not_uploading".into(),
            message: format!("share status is {}", row.status),
            devices: None,
        });
    }
    let artifact = normalize_artifact(query.artifact.as_deref())?;
    let part = query.part.unwrap_or(0);
    let path = share_dir(&state, &share_id).join(format!("{artifact}-part-{part:06}"));
    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut stream = body.into_data_stream();
    let mut total = 0usize;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| ApiError::BadRequest(format!("body stream: {e}")))?;
        total += chunk.len();
        if total > MAX_PART_BYTES {
            drop(file);
            let _ = tokio::fs::remove_file(&path).await;
            return Err(ApiError::PayloadTooLarge(format!(
                "part exceeds {} bytes",
                MAX_PART_BYTES
            )));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }
    file.flush().await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(StatusCode::OK)
}

async fn assemble_parts(
    dir: &std::path::Path,
    artifact: &str,
    out_name: &str,
) -> ApiResult<(String, i64, usize)> {
    let out_path = dir.join(out_name);
    let mut out = tokio::fs::File::create(&out_path)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    let mut hasher = Sha256::new();
    let mut part = 0usize;
    loop {
        let part_path = dir.join(format!("{artifact}-part-{part:06}"));
        if !part_path.exists() {
            break;
        }
        let bytes = tokio::fs::read(&part_path)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
        hasher.update(&bytes);
        out.write_all(&bytes)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
        part += 1;
    }
    out.flush().await.map_err(|e| ApiError::Internal(e.into()))?;
    drop(out);
    if part == 0 {
        return Err(ApiError::BadRequest(format!(
            "no {artifact} parts uploaded"
        )));
    }
    let digest = hex::encode(hasher.finalize());
    let size = tokio::fs::metadata(&out_path)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?
        .len() as i64;
    Ok((digest, size, part))
}

async fn materialize_bare_repo(dir: &std::path::Path) -> ApiResult<()> {
    let bundle = dir.join("repo.bundle");
    let bare = dir.join("repo.git");
    if bare.exists() {
        let _ = tokio::fs::remove_dir_all(&bare).await;
    }
    let clone = tokio::process::Command::new("git")
        .arg("clone")
        .arg("--bare")
        .arg(&bundle)
        .arg(&bare)
        .output()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("spawn git clone --bare: {e}")))?;
    if !clone.status.success() {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "git clone --bare failed: {}",
            String::from_utf8_lossy(&clone.stderr).trim()
        )));
    }
    let update = tokio::process::Command::new("git")
        .arg("--git-dir")
        .arg(&bare)
        .arg("update-server-info")
        .output()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("spawn git update-server-info: {e}")))?;
    if !update.status.success() {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "git update-server-info failed: {}",
            String::from_utf8_lossy(&update.stderr).trim()
        )));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinalizeShareResponse {
    share_id: String,
    share_url: String,
    git_url: String,
}

async fn finalize_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> ApiResult<Json<FinalizeShareResponse>> {
    let row = require_owner(&state, &headers, &share_id).await?;
    if row.status != "uploading" {
        return Err(ApiError::Conflict {
            code: "share_not_uploading".into(),
            message: format!("share status is {}", row.status),
            devices: None,
        });
    }
    let dir = share_dir(&state, &share_id);

    let (repo_digest, repo_size, repo_parts) = assemble_parts(&dir, "repo", "repo.bundle").await?;
    if !row.content_sha256.is_empty() && repo_digest != row.content_sha256 {
        let _ = tokio::fs::remove_file(dir.join("repo.bundle")).await;
        return Err(ApiError::BadRequest(format!(
            "repo sha256 mismatch: expect {}, got {repo_digest}",
            row.content_sha256
        )));
    }
    if row.size_bytes > 0 && repo_size != row.size_bytes {
        let _ = tokio::fs::remove_file(dir.join("repo.bundle")).await;
        return Err(ApiError::BadRequest(format!(
            "repo size mismatch: expect {}, got {repo_size}",
            row.size_bytes
        )));
    }

    let (ctx_digest, context_size, ctx_parts) =
        assemble_parts(&dir, "context", "context.tar.zst").await?;
    if !row.context_sha256.is_empty() && ctx_digest != row.context_sha256 {
        let _ = tokio::fs::remove_file(dir.join("context.tar.zst")).await;
        return Err(ApiError::BadRequest(format!(
            "context sha256 mismatch: expect {}, got {ctx_digest}",
            row.context_sha256
        )));
    }
    if row.context_size_bytes > 0 && context_size != row.context_size_bytes {
        let _ = tokio::fs::remove_file(dir.join("context.tar.zst")).await;
        return Err(ApiError::BadRequest(format!(
            "context size mismatch: expect {}, got {context_size}",
            row.context_size_bytes
        )));
    }

    materialize_bare_repo(&dir).await?;

    for index in 0..repo_parts {
        let _ = tokio::fs::remove_file(dir.join(format!("repo-part-{index:06}"))).await;
    }
    for index in 0..ctx_parts {
        let _ = tokio::fs::remove_file(dir.join(format!("context-part-{index:06}"))).await;
    }

    sqlx::query(
        "UPDATE shares SET status = 'active', size_bytes = $2, context_size_bytes = $3 WHERE id = $1",
    )
    .bind(&share_id)
    .bind(repo_size)
    .bind(context_size)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    write_audit(
        &state,
        Some(&row.workspace_id),
        "share.finalized",
        serde_json::json!({
            "shareId": share_id,
            "repoSizeBytes": repo_size,
            "contextSizeBytes": context_size,
        }),
    )
    .await;

    let share_url = format!("{}/s/{share_id}", state.config.public_base_url);
    let git_url = format!("{}/s/{share_id}/repo.git", state.config.public_base_url);
    Ok(Json(FinalizeShareResponse {
        share_id,
        share_url,
        git_url,
    }))
}

async fn share_meta(
    State(state): State<AppState>,
    Path(share_id): Path<String>,
) -> ApiResult<Json<ShareMetaResponse>> {
    let row = load_share(&state, &share_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("share not found".into()))?;
    if row.status == "uploading" {
        return Err(ApiError::NotFound("share not found".into()));
    }
    Ok(Json(ShareMetaResponse::from_row(
        &row,
        &state.config.public_base_url,
    )))
}

#[derive(Debug, Deserialize)]
struct DownloadQuery {
    /// `context`（默认）或 `repo`（调试用 bundle）。
    artifact: Option<String>,
}

async fn download_share(
    State(state): State<AppState>,
    Path(share_id): Path<String>,
    Query(query): Query<DownloadQuery>,
    request: Request<Body>,
) -> ApiResult<Response> {
    let row = load_share(&state, &share_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("share not found".into()))?;
    if row.status != "active" {
        return Err(ApiError::NotFound(format!("share status is {}", row.status)));
    }
    let artifact = match query.artifact.as_deref().map(str::trim).unwrap_or("context") {
        "" | "context" => "context.tar.zst",
        "repo" | "bundle" => "repo.bundle",
        // 旧单包布局兼容。
        "blob" | "package" => "blob",
        other => {
            return Err(ApiError::BadRequest(format!(
                "artifact must be context|repo, got {other}"
            )));
        }
    };
    let path = share_dir(&state, &share_id).join(artifact);
    if !path.exists() {
        return Err(ApiError::NotFound(format!("share {artifact} missing")));
    }
    let _ = sqlx::query("UPDATE shares SET download_count = download_count + 1 WHERE id = $1")
        .bind(&share_id)
        .execute(&state.pool)
        .await;
    write_audit(
        &state,
        Some(&row.workspace_id),
        "share.downloaded",
        serde_json::json!({ "shareId": share_id, "artifact": artifact }),
    )
    .await;
    let response = ServeFile::new(&path)
        .oneshot(request)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("serve blob: {e}")))?;
    Ok(response.into_response())
}

async fn serve_repo_git(
    State(state): State<AppState>,
    Path((share_id, git_path)): Path<(String, String)>,
    request: Request<Body>,
) -> ApiResult<Response> {
    let row = load_share(&state, &share_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("share not found".into()))?;
    if row.status != "active" {
        return Err(ApiError::NotFound(format!("share status is {}", row.status)));
    }
    if git_path.split('/').any(|seg| seg == "..") {
        return Err(ApiError::BadRequest("invalid git path".into()));
    }
    let root = share_dir(&state, &share_id).join("repo.git");
    if !root.is_dir() {
        return Err(ApiError::NotFound("share git remote missing".into()));
    }
    let file = root.join(&git_path);
    let canon_root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    let canon_file = match tokio::fs::canonicalize(&file).await {
        Ok(p) => p,
        Err(_) => return Err(ApiError::NotFound("git object missing".into())),
    };
    if !canon_file.starts_with(&canon_root) {
        return Err(ApiError::BadRequest("invalid git path".into()));
    }
    if !canon_file.is_file() {
        return Err(ApiError::NotFound("git object missing".into()));
    }
    let response = ServeFile::new(&canon_file)
        .oneshot(request)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("serve git: {e}")))?;
    Ok(response.into_response())
}

async fn list_shares(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let token = crate::auth::bearer_token(auth)?;
    let device = find_device_by_token(&state, token).await?;
    let rows = sqlx::query_as::<_, ShareRow>(&format!(
        "{SHARE_SELECT} WHERE workspace_id = $1 AND status != 'uploading' ORDER BY created_at DESC"
    ))
    .bind(&device.workspace_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    let shares: Vec<ShareMetaResponse> = rows
        .iter()
        .map(|r| ShareMetaResponse::from_row(r, &state.config.public_base_url))
        .collect();
    Ok(Json(serde_json::json!({ "shares": shares })))
}

async fn revoke_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> ApiResult<StatusCode> {
    let row = require_owner(&state, &headers, &share_id).await?;
    sqlx::query("UPDATE shares SET status = 'revoked' WHERE id = $1")
        .bind(&share_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    let _ = tokio::fs::remove_dir_all(share_dir(&state, &share_id)).await;
    write_audit(
        &state,
        Some(&row.workspace_id),
        "share.revoked",
        serde_json::json!({ "shareId": share_id }),
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// 过期/放弃上传清理：每小时跑一次。
pub async fn sweeper(state: AppState) {
    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3600));
    loop {
        ticker.tick().await;
        if let Err(error) = sweep_once(&state).await {
            tracing::warn!(error = %error, "share sweeper failed");
        }
    }
}

async fn sweep_once(state: &AppState) -> anyhow::Result<()> {
    let now = Utc::now();
    let stale_before = now - Duration::hours(UPLOAD_STALE_HOURS);
    let doomed: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT id, status FROM shares
        WHERE (status = 'active' AND expires_at IS NOT NULL AND expires_at < $1)
           OR (status = 'uploading' AND created_at < $2)
        "#,
    )
    .bind(now)
    .bind(stale_before)
    .fetch_all(&state.pool)
    .await?;
    for (share_id, _status) in doomed {
        sqlx::query("UPDATE shares SET status = 'expired' WHERE id = $1")
            .bind(&share_id)
            .execute(&state.pool)
            .await?;
        let _ = tokio::fs::remove_dir_all(share_dir(state, &share_id)).await;
        write_audit(
            state,
            None,
            "share.expired",
            serde_json::json!({ "shareId": share_id }),
        )
        .await;
    }
    Ok(())
}

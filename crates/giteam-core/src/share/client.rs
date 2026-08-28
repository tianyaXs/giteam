//! 分享云端 API 客户端（reqwest blocking）。

use super::{ShareError, ShareResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareRequest {
    pub name: String,
    pub repo_name: String,
    pub default_branch: String,
    pub head_commit: String,
    /// 代码包（repo.bundle）字节数。
    pub size_bytes: u64,
    pub content_sha256: String,
    #[serde(default)]
    pub context_sha256: String,
    #[serde(default)]
    pub context_size_bytes: u64,
    pub encrypted: bool,
    pub meta: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareResponse {
    pub share_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeShareResponse {
    pub share_id: String,
    pub share_url: String,
    #[serde(default)]
    pub git_url: String,
}

/// 公开元信息（落地页 / 导入预检用；不含内容）。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareMeta {
    pub share_id: String,
    pub name: String,
    pub repo_name: String,
    pub default_branch: String,
    pub head_commit: String,
    pub size_bytes: u64,
    pub content_sha256: String,
    #[serde(default)]
    pub context_sha256: String,
    #[serde(default)]
    pub context_size_bytes: u64,
    pub encrypted: bool,
    pub status: String,
    #[serde(default)]
    pub download_count: u64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub expires_at: String,
    #[serde(default)]
    pub git_url: String,
    #[serde(default)]
    pub meta: serde_json::Value,
}

fn client() -> ShareResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| ShareError::Network(e.to_string()))
}

fn join_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim().trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn check_status(resp: reqwest::blocking::Response, what: &str) -> ShareResult<reqwest::blocking::Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let text = resp.text().unwrap_or_default();
    Err(ShareError::Network(format!("{what} HTTP {status}: {text}")))
}

/// 解析分享 URL：支持 `https://<cloud>/s/<shareId>`、直传 shareId、
/// 以及 `giteam://import?url=…` 深链包装。返回 (cloud_base_url, share_id)。
pub fn parse_share_url(raw: &str) -> ShareResult<(String, String)> {
    let mut text = raw.trim().to_string();
    if text.is_empty() {
        return Err(ShareError::InvalidInput("share url is empty".into()));
    }
    // 深链包装：giteam://import?url=… / giteam://import/?url=…
    if let Some(rest) = text.strip_prefix("giteam://import") {
        let query = rest.trim_start_matches(|c| c == '/' || c == '?');
        for pair in query.split('&') {
            if let Some(value) = pair.strip_prefix("url=") {
                text = urlencoding::decode(value)
                    .map_err(|e| ShareError::InvalidInput(format!("bad deep link: {e}")))?
                    .into_owned();
                break;
            }
        }
    }
    if text.starts_with("shr_") && !text.contains('/') {
        // 裸 shareId：base URL 由调用方用本地 cloud-link 配置补齐。
        return Ok((String::new(), text));
    }
    let fragmentless = text.split('#').next().unwrap_or("").to_string();
    if text.contains("#k=") {
        return Err(ShareError::InvalidInput(
            "E2E 加密分享（#k=）暂未支持，将在 P3 提供".into(),
        ));
    }
    let parsed = url::Url::parse(&fragmentless)
        .map_err(|e| ShareError::InvalidInput(format!("invalid share url: {e}")))?;
    let path = parsed.path().to_string();
    let Some(pos) = path.find("/s/") else {
        return Err(ShareError::InvalidInput(format!(
            "share url must contain /s/<shareId>: {raw}"
        )));
    };
    let share_id = path[pos + 3..]
        .trim_end_matches('/')
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    if share_id.is_empty() {
        return Err(ShareError::InvalidInput(format!("missing shareId in url: {raw}")));
    }
    let prefix = path[..pos].trim_end_matches('/');
    let base = format!(
        "{}://{}{}",
        parsed.scheme(),
        parsed.host_str().unwrap_or(""),
        match parsed.port() {
            Some(port) => format!(":{port}"),
            None => String::new(),
        }
    );
    let base = format!("{base}{prefix}");
    Ok((base, share_id))
}

pub fn create_share_record(
    cloud_base_url: &str,
    device_token: &str,
    body: &CreateShareRequest,
) -> ShareResult<CreateShareResponse> {
    let url = join_url(cloud_base_url, "/cloud/v1/shares");
    let resp = client()?
        .post(&url)
        .header("Authorization", format!("Bearer {}", device_token.trim()))
        .json(body)
        .send()
        .map_err(|e| ShareError::Network(e.to_string()))?;
    let resp = check_status(resp, "share create")?;
    resp.json::<CreateShareResponse>()
        .map_err(|e| ShareError::Network(format!("share create parse: {e}")))
}

/// 分块上传单个 artifact（`repo` 或 `context`）。
pub fn upload_share_parts(
    cloud_base_url: &str,
    device_token: &str,
    share_id: &str,
    package: &Path,
    part_size: usize,
    artifact: &str,
) -> ShareResult<()> {
    let artifact = match artifact.trim() {
        "" | "repo" | "bundle" => "repo",
        "context" => "context",
        other => {
            return Err(ShareError::InvalidInput(format!(
                "artifact must be repo|context, got {other}"
            )));
        }
    };
    let mut file = fs::File::open(package)?;
    let http = client()?;
    let mut part = 0usize;
    loop {
        let mut buf = vec![0u8; part_size];
        let mut filled = 0usize;
        while filled < part_size {
            let read = file
                .read(&mut buf[filled..])
                .map_err(ShareError::Io)?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        if filled == 0 {
            break;
        }
        buf.truncate(filled);
        let url = join_url(
            cloud_base_url,
            &format!("/cloud/v1/shares/{share_id}/blob?part={part}&artifact={artifact}"),
        );
        let resp = http
            .put(&url)
            .header("Authorization", format!("Bearer {}", device_token.trim()))
            .header("Content-Type", "application/octet-stream")
            .body(buf)
            .send()
            .map_err(|e| ShareError::Network(e.to_string()))?;
        check_status(resp, "share upload part")?;
        part += 1;
    }
    Ok(())
}

pub fn finalize_share(
    cloud_base_url: &str,
    device_token: &str,
    share_id: &str,
) -> ShareResult<FinalizeShareResponse> {
    let url = join_url(cloud_base_url, &format!("/cloud/v1/shares/{share_id}/finalize"));
    let resp = client()?
        .post(&url)
        .header("Authorization", format!("Bearer {}", device_token.trim()))
        .send()
        .map_err(|e| ShareError::Network(e.to_string()))?;
    let resp = check_status(resp, "share finalize")?;
    resp.json::<FinalizeShareResponse>()
        .map_err(|e| ShareError::Network(format!("share finalize parse: {e}")))
}

pub fn fetch_share_meta(cloud_base_url: &str, share_id: &str) -> ShareResult<ShareMeta> {
    let url = join_url(cloud_base_url, &format!("/cloud/v1/shares/{share_id}"));
    let resp = client()?
        .get(&url)
        .send()
        .map_err(|e| ShareError::Network(e.to_string()))?;
    let resp = check_status(resp, "share meta")?;
    resp.json::<ShareMeta>()
        .map_err(|e| ShareError::Network(format!("share meta parse: {e}")))
}

/// 下载指定 artifact 并校验 sha256；返回临时文件路径。
/// `on_bytes`：每读一块调用 `(done, total_hint)`；`total_hint` 优先 Content-Length。
pub fn download_share_artifact(
    cloud_base_url: &str,
    share_id: &str,
    artifact: &str,
    expected_sha256: &str,
) -> ShareResult<std::path::PathBuf> {
    download_share_artifact_with_progress(
        cloud_base_url,
        share_id,
        artifact,
        expected_sha256,
        None,
    )
}

pub fn download_share_artifact_with_progress(
    cloud_base_url: &str,
    share_id: &str,
    artifact: &str,
    expected_sha256: &str,
    mut on_bytes: Option<&mut dyn FnMut(u64, Option<u64>) -> ShareResult<()>>,
) -> ShareResult<std::path::PathBuf> {
    let artifact = match artifact.trim() {
        "" | "context" => "context",
        "repo" | "bundle" => "repo",
        "blob" | "package" => "blob",
        other => {
            return Err(ShareError::InvalidInput(format!(
                "artifact must be context|repo, got {other}"
            )));
        }
    };
    let url = join_url(
        cloud_base_url,
        &format!("/cloud/v1/shares/{share_id}/download?artifact={artifact}"),
    );
    let resp = client()?
        .get(&url)
        .send()
        .map_err(|e| ShareError::Network(e.to_string()))?;
    let mut resp = check_status(resp, "share download")?;
    let total_hint = resp.content_length();
    let ext = if artifact == "context" || artifact == "blob" {
        "tar.zst"
    } else {
        "bundle"
    };
    let tmp = std::env::temp_dir().join(format!(
        "giteam-share-dl-{}-{}-{}.{}",
        std::process::id(),
        share_id,
        artifact,
        ext
    ));
    let cleanup = |path: &std::path::Path| {
        let _ = fs::remove_file(path);
    };
    let mut file = match fs::File::create(&tmp) {
        Ok(f) => f,
        Err(e) => return Err(ShareError::Io(e)),
    };
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut done = 0u64;
    let mut last_emit = 0u64;
    if let Some(cb) = on_bytes.as_mut() {
        if let Err(err) = cb(0, total_hint) {
            cleanup(&tmp);
            return Err(err);
        }
    }
    loop {
        let read = match resp.read(&mut buf) {
            Ok(n) => n,
            Err(e) => {
                cleanup(&tmp);
                return Err(ShareError::Network(e.to_string()));
            }
        };
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
        if let Err(e) = file.write_all(&buf[..read]) {
            cleanup(&tmp);
            return Err(ShareError::Io(e));
        }
        done = done.saturating_add(read as u64);
        // 每块都回调以便探测取消；调用方可自行节流进度 UI。
        if let Some(cb) = on_bytes.as_mut() {
            let should_report = done.saturating_sub(last_emit) >= 256 * 1024 || read < buf.len();
            if should_report {
                last_emit = done;
            }
            if let Err(err) = cb(done, total_hint) {
                cleanup(&tmp);
                return Err(err);
            }
        }
    }
    if let Some(cb) = on_bytes.as_mut() {
        if let Err(err) = cb(done, total_hint.or(Some(done))) {
            cleanup(&tmp);
            return Err(err);
        }
    }
    if let Err(e) = file.flush() {
        cleanup(&tmp);
        return Err(ShareError::Io(e));
    }
    let digest = hex::encode(hasher.finalize());
    if !expected_sha256.trim().is_empty() && digest != expected_sha256.trim() {
        cleanup(&tmp);
        return Err(ShareError::Package(format!(
            "sha256 mismatch: expect {expected_sha256}, got {digest}"
        )));
    }
    Ok(tmp)
}

/// 兼容旧调用：默认下载 context 包。
pub fn download_share(
    cloud_base_url: &str,
    share_id: &str,
    expected_sha256: &str,
) -> ShareResult<std::path::PathBuf> {
    download_share_artifact(cloud_base_url, share_id, "context", expected_sha256)
}

pub fn list_shares(cloud_base_url: &str, device_token: &str) -> ShareResult<Vec<ShareMeta>> {
    let url = join_url(cloud_base_url, "/cloud/v1/shares");
    let resp = client()?
        .get(&url)
        .header("Authorization", format!("Bearer {}", device_token.trim()))
        .send()
        .map_err(|e| ShareError::Network(e.to_string()))?;
    let resp = check_status(resp, "share list")?;
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ListResponse {
        shares: Vec<ShareMeta>,
    }
    let parsed = resp
        .json::<ListResponse>()
        .map_err(|e| ShareError::Network(format!("share list parse: {e}")))?;
    Ok(parsed.shares)
}

pub fn revoke_share(cloud_base_url: &str, device_token: &str, share_id: &str) -> ShareResult<()> {
    let url = join_url(cloud_base_url, &format!("/cloud/v1/shares/{share_id}"));
    let resp = client()?
        .delete(&url)
        .header("Authorization", format!("Bearer {}", device_token.trim()))
        .send()
        .map_err(|e| ShareError::Network(e.to_string()))?;
    check_status(resp, "share revoke")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_share_url() {
        let (base, id) = parse_share_url("https://cloud.example.com/s/shr_0123456789abcdef").unwrap();
        assert_eq!(base, "https://cloud.example.com");
        assert_eq!(id, "shr_0123456789abcdef");
    }

    #[test]
    fn parses_url_with_port_and_prefix() {
        let (base, id) = parse_share_url("http://127.0.0.1:8787/gateway/s/shr_ab12/").unwrap();
        assert_eq!(base, "http://127.0.0.1:8787/gateway");
        assert_eq!(id, "shr_ab12");
    }

    #[test]
    fn parses_deep_link_wrapper() {
        let inner = "https://cloud.example.com/s/shr_xyz";
        let link = format!("giteam://import?url={}", urlencoding::encode(inner));
        let (base, id) = parse_share_url(&link).unwrap();
        assert_eq!(base, "https://cloud.example.com");
        assert_eq!(id, "shr_xyz");
    }

    #[test]
    fn parses_deep_link_wrapper_with_slash() {
        let inner = "https://cloud.example.com/s/shr_xyz";
        let link = format!("giteam://import/?url={}", urlencoding::encode(inner));
        let (base, id) = parse_share_url(&link).unwrap();
        assert_eq!(base, "https://cloud.example.com");
        assert_eq!(id, "shr_xyz");
    }

    #[test]
    fn rejects_encrypted_fragment() {
        assert!(parse_share_url("https://c.example/s/shr_a#k=deadbeef").is_err());
    }

    #[test]
    fn accepts_bare_share_id() {
        let (base, id) = parse_share_url("shr_abc123").unwrap();
        assert!(base.is_empty());
        assert_eq!(id, "shr_abc123");
    }
}

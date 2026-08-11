use super::config::CloudLinkSettings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkBeginRequest {
    device_name: String,
    client_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    access_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPayload {
    pub mode: String,
    pub cloud_base_url: String,
    pub workspace_id: String,
    pub device_id: String,
    pub access_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkBeginResponse {
    pub workspace_id: String,
    pub device_id: String,
    pub link_ticket: String,
    pub expires_at: i64,
    pub access_key: String,
    pub qr_payload: QrPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkCompleteRequest {
    link_ticket: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCompleteResponse {
    pub workspace_id: String,
    pub device_id: String,
    pub device_token: String,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn join_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim().trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

pub fn link_begin(
    cloud_base_url: &str,
    device_name: &str,
    client_version: &str,
    access_key: Option<&str>,
) -> Result<LinkBeginResponse, String> {
    let url = join_url(cloud_base_url, "/cloud/v1/device/link/begin");
    let body = LinkBeginRequest {
        device_name: device_name.to_string(),
        client_version: client_version.to_string(),
        access_key: access_key
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };
    let resp = client()?
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("link/begin failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("link/begin HTTP {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("link/begin parse: {e}; body={text}"))
}

pub fn link_complete(
    cloud_base_url: &str,
    link_ticket: &str,
) -> Result<LinkCompleteResponse, String> {
    let url = join_url(cloud_base_url, "/cloud/v1/device/link/complete");
    let body = LinkCompleteRequest {
        link_ticket: link_ticket.to_string(),
    };
    let resp = client()?
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("link/complete failed: {e}"))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("link/complete HTTP {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("link/complete parse: {e}; body={text}"))
}

/// Perform begin+complete and persist settings.
pub fn link_device(
    cloud_base_url: &str,
    device_name: &str,
    client_version: &str,
    join_access_key: Option<&str>,
) -> Result<CloudLinkSettings, String> {
    let begin = link_begin(cloud_base_url, device_name, client_version, join_access_key)?;
    let complete = link_complete(cloud_base_url, &begin.link_ticket)?;
    let settings = CloudLinkSettings {
        enabled: true,
        cloud_base_url: cloud_base_url.trim().trim_end_matches('/').to_string(),
        workspace_id: complete.workspace_id,
        device_id: complete.device_id,
        device_token: complete.device_token,
        access_key: begin.access_key,
        device_name: device_name.to_string(),
    };
    super::config::set_cloud_link_settings(&settings)?;
    Ok(settings)
}

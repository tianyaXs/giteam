use super::config::CloudLinkSettings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkBeginRequest {
    device_name: String,
    client_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    access_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key_name: Option<String>,
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

#[derive(Debug, Clone, Default)]
pub struct LinkDeviceOptions {
    /// When true, mint a brand-new workspace+key even if a local key exists.
    pub force_new: bool,
    /// Name for a newly minted key (ignored when joining with an existing key).
    pub key_name: Option<String>,
    /// Who owns the cloud tunnel: "desktop" or "cli". None = keep existing value.
    pub tunnel_owner: Option<String>,
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
    join_access_key: Option<&str>,
) -> Result<LinkBeginResponse, String> {
    link_begin_with_opts(
        cloud_base_url,
        device_name,
        client_version,
        join_access_key,
        None,
    )
}

pub fn link_begin_with_opts(
    cloud_base_url: &str,
    device_name: &str,
    client_version: &str,
    join_access_key: Option<&str>,
    key_name: Option<&str>,
) -> Result<LinkBeginResponse, String> {
    let url = join_url(cloud_base_url, "/cloud/v1/device/link/begin");
    let body = LinkBeginRequest {
        device_name: device_name.to_string(),
        client_version: client_version.to_string(),
        access_key: join_access_key
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        key_name: key_name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };
    let resp = client()?
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
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
///
/// Default behavior: **reuse** the locally saved access key (or an explicitly
/// provided join key). Pass `opts.force_new = true` to mint a new workspace key.
pub fn link_device(
    cloud_base_url: &str,
    device_name: &str,
    client_version: &str,
    join_access_key: Option<&str>,
) -> Result<CloudLinkSettings, String> {
    link_device_with_opts(
        cloud_base_url,
        device_name,
        client_version,
        join_access_key,
        LinkDeviceOptions::default(),
    )
}

pub fn link_device_with_opts(
    cloud_base_url: &str,
    device_name: &str,
    client_version: &str,
    join_access_key: Option<&str>,
    opts: LinkDeviceOptions,
) -> Result<CloudLinkSettings, String> {
    let existing = super::config::get_cloud_link_settings();
    let explicit = join_access_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let join_key = if opts.force_new {
        None
    } else if explicit.is_some() {
        explicit
    } else if !existing.access_key.trim().is_empty() {
        Some(existing.access_key.trim().to_string())
    } else {
        None
    };

    let begin = link_begin_with_opts(
        cloud_base_url,
        device_name,
        client_version,
        join_key.as_deref(),
        opts.key_name.as_deref(),
    )?;
    let complete = link_complete(cloud_base_url, &begin.link_ticket)?;
    let mut settings = CloudLinkSettings {
        enabled: true,
        cloud_base_url: cloud_base_url.trim().trim_end_matches('/').to_string(),
        workspace_id: complete.workspace_id.clone(),
        device_id: complete.device_id,
        device_token: complete.device_token,
        access_key: begin.access_key.clone(),
        key_name: existing.key_name.clone(),
        device_name: device_name.to_string(),
        access_keys: existing.access_keys.clone(),
        tunnel_owner: opts
            .tunnel_owner
            .clone()
            .unwrap_or_else(|| existing.tunnel_owner.clone()),
    };
    let name = opts
        .key_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if settings.key_name.trim().is_empty() {
                "默认".to_string()
            } else {
                settings.key_name.trim().to_string()
            }
        });
    super::config::remember_access_key(
        &mut settings,
        &begin.access_key,
        &name,
        &complete.workspace_id,
    );
    super::config::set_cloud_link_settings(&settings)?;
    Ok(settings)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileClientSession {
    pub jti: String,
    pub workspace_id: String,
    pub device_id: String,
    pub client_name: String,
    pub connected_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListClientsResponse {
    clients: Vec<MobileClientSession>,
}

/// List online mobile clients for the local linked desktop device.
pub fn list_mobile_clients() -> Result<Vec<MobileClientSession>, String> {
    let settings = super::config::get_cloud_link_settings();
    if settings.device_token.trim().is_empty() || settings.cloud_base_url.trim().is_empty() {
        return Ok(vec![]);
    }
    let url = join_url(&settings.cloud_base_url, "/cloud/v1/device/clients");
    let resp = client()?
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", settings.device_token.trim()),
        )
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("list clients HTTP {status}: {text}"));
    }
    let parsed: ListClientsResponse =
        serde_json::from_str(&text).map_err(|e| format!("list clients parse: {e}; body={text}"))?;
    Ok(parsed.clients)
}

/// Disconnect a mobile client session (blacklist JWT).
pub fn disconnect_mobile_client(jti: &str) -> Result<(), String> {
    let jti = jti.trim();
    if jti.is_empty() {
        return Err("jti required".into());
    }
    let settings = super::config::get_cloud_link_settings();
    if settings.device_token.trim().is_empty() || settings.cloud_base_url.trim().is_empty() {
        return Err("cloud link incomplete".into());
    }
    let url = join_url(&settings.cloud_base_url, "/cloud/v1/device/clients/disconnect");
    let resp = client()?
        .post(&url)
        .header(
            "Authorization",
            format!("Bearer {}", settings.device_token.trim()),
        )
        .json(&serde_json::json!({ "jti": jti }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("disconnect client HTTP {status}: {text}"));
    }
    Ok(())
}

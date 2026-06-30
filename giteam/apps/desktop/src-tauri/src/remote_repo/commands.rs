use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::Duration;
use tauri::AppHandle;

use super::client::RemoteRepoClient;
use super::models::{
    RemoteRepoFileContent, RemoteRepoFileTree, RemoteRepoOverview, RemoteServiceRepo, SyncResult,
};
use super::store;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRepoServiceSetting {
    configured_url: String,
    effective_url: String,
    api_key: String,
    api_key_configured: bool,
    source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRepoServiceCheck {
    service_url: String,
    repo_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRepoServiceSaveResult {
    configured_url: String,
    effective_url: String,
    api_key: String,
    api_key_configured: bool,
    source: String,
    service_url: String,
    repo_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceRequestPayload {
    operation: String,
    input: Value,
}

fn command_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn normalize_service_url(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.starts_with('/') {
        if value.starts_with("//") {
            return Err("服务地址必须是 http(s) URL 或同源路径。".to_string());
        }
        let trimmed = value.trim_end_matches('/');
        return Ok(if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() });
    }

    let mut url = reqwest::Url::parse(value)
        .map_err(|_| "请输入有效的 http 或 https 服务地址。".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("服务地址仅支持 http 或 https。".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("服务地址不能包含用户名、密码、查询参数或片段。".to_string());
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn configured_default_service_url() -> (String, String) {
    if let Ok(value) = std::env::var("REMOTE_REPO_SERVICE_URL") {
        if !value.trim().is_empty() {
            return (value, "environment".to_string());
        }
    }
    if let Ok(value) = std::env::var("VITE_REMOTE_REPO_SERVICE_URL") {
        if !value.trim().is_empty() {
            return (value, "environment".to_string());
        }
    }
    ("http://127.0.0.1:8765".to_string(), "default".to_string())
}

fn configured_default_api_key() -> String {
    for name in ["REMOTE_REPO_API_KEY", "REMOTE_REPO_SERVICE_API_KEY"] {
        if let Ok(value) = std::env::var(name) {
            if !value.trim().is_empty() {
                return value.trim().to_string();
            }
        }
    }
    String::new()
}

fn service_setting(app_handle: &AppHandle) -> Result<RemoteRepoServiceSetting, String> {
    let stored = store::get_service_setting(app_handle)?.unwrap_or(store::RemoteRepoServiceStoredSetting {
        service_url: String::new(),
        api_key: String::new(),
    });
    let configured_url = stored.service_url;
    let configured_url = normalize_service_url(&configured_url)?;
    let api_key = if stored.api_key.trim().is_empty() {
        configured_default_api_key()
    } else {
        stored.api_key.trim().to_string()
    };
    let api_key_configured = !api_key.is_empty();
    if !configured_url.is_empty() {
        return Ok(RemoteRepoServiceSetting {
            configured_url: configured_url.clone(),
            effective_url: configured_url,
            api_key,
            api_key_configured,
            source: "setting".to_string(),
        });
    }

    let (default_url, source) = configured_default_service_url();
    Ok(RemoteRepoServiceSetting {
        configured_url: String::new(),
        effective_url: normalize_service_url(&default_url)?,
        api_key,
        api_key_configured,
        source,
    })
}

fn client_for_app(app_handle: &AppHandle) -> Result<RemoteRepoClient, String> {
    let setting = service_setting(app_handle)?;
    Ok(RemoteRepoClient::new(setting.effective_url, setting.api_key))
}

fn payload_string(payload: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        payload
            .get(*name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn payload_string_allow_empty(payload: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        payload
            .get(*name)
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
    })
}

fn payload_bool(payload: &Value, names: &[&str]) -> Option<bool> {
    names.iter().find_map(|name| payload.get(*name).and_then(Value::as_bool))
}

fn required_payload_string(payload: &Value, names: &[&str]) -> Result<String, String> {
    payload_string(payload, names).ok_or_else(|| format!("missing required field: {}", names[0]))
}

fn normalize_connection_status(repo: &RemoteServiceRepo) -> String {
    let raw = repo
        .sync_status
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match raw.as_str() {
        "connected" | "syncing" | "auth_required" | "failed" | "stale" => raw,
        "ready" | "ok" | "synced" => "connected".to_string(),
        "needs_auth" | "unauthorized" => "auth_required".to_string(),
        "" => {
            if repo.default_commit.as_deref().unwrap_or("").trim().is_empty() {
                if repo.synced == Some(false) {
                    "stale".to_string()
                } else {
                    "connected".to_string()
                }
            } else {
                "connected".to_string()
            }
        }
        _ => "failed".to_string(),
    }
}

fn remote_repo_overview(app_handle: &AppHandle, repo: RemoteServiceRepo) -> Result<RemoteRepoOverview, String> {
    let ui_state = store::get_ui_state(app_handle, &repo.repo_id)?;
    let connection_status = normalize_connection_status(&repo);
    Ok(RemoteRepoOverview {
        repo_id: repo.repo_id.clone(),
        display_name: if repo.name.trim().is_empty() { repo.repo_id } else { repo.name },
        provider: repo.provider,
        remote_url: repo.remote_url.or(repo.origin),
        connection_status,
        default_ref: if repo.default_ref.trim().is_empty() { "main".to_string() } else { repo.default_ref },
        default_commit: repo.default_commit,
        linked_project_ids: Vec::new(),
        pinned: ui_state.pinned,
        sort_order: ui_state.sort_order,
        last_accessed_at_ms: ui_state.last_accessed_at_ms,
        last_synced_at_ms: repo.last_synced_at_ms,
        error: repo.error_message,
    })
}

async fn check_service_url(raw_service_url: &str, api_key: &str) -> Result<RemoteRepoServiceCheck, String> {
    let service_url = normalize_service_url(raw_service_url)?;
    if service_url.is_empty() {
        return Err("服务地址不能为空。".to_string());
    }
    if service_url.starts_with('/') {
        return Err("打包 App 需要填写完整的 http(s) 服务地址；同源代理路径只适用于网页预览。".to_string());
    }

    let url = format!("{service_url}/v1/dashboard");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(command_error)?;
    let mut request = client.get(url);
    if !api_key.trim().is_empty() {
        request = request.header("X-API-Key", api_key.trim());
    }
    let response = request.send().await.map_err(command_error)?;
    let status = response.status();
    let text = response.text().await.map_err(command_error)?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    let payload: Value = serde_json::from_str(&text)
        .map_err(|error| format!("服务返回了无法解析的 JSON：{error}"))?;
    let repo_count = payload
        .get("repos")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    Ok(RemoteRepoServiceCheck { service_url, repo_count })
}

fn merge_setting_and_check(
    setting: RemoteRepoServiceSetting,
    check: RemoteRepoServiceCheck,
) -> RemoteRepoServiceSaveResult {
    RemoteRepoServiceSaveResult {
        configured_url: setting.configured_url,
        effective_url: setting.effective_url,
        api_key: setting.api_key,
        api_key_configured: setting.api_key_configured,
        source: setting.source,
        service_url: check.service_url,
        repo_count: check.repo_count,
    }
}

fn action_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| format!("serialize remote repo response failed: {error}"))
}

#[tauri::command]
pub async fn remote_repo(
    app_handle: AppHandle,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    match action.as_str() {
        "get_service_url" => action_value(service_setting(&app_handle)?),
        "test_service_url" => {
            let requested = payload_string(&payload, &["serviceUrl", "service_url"])
                .unwrap_or_else(|| service_setting(&app_handle).map(|setting| setting.effective_url).unwrap_or_default());
            let api_key = payload_string_allow_empty(&payload, &["apiKey", "api_key"])
                .unwrap_or_else(|| service_setting(&app_handle).map(|setting| setting.api_key).unwrap_or_default());
            action_value(check_service_url(&requested, &api_key).await?)
        }
        "set_service_url" => {
            let requested = payload_string(&payload, &["serviceUrl", "service_url"]).unwrap_or_default();
            let api_key = payload_string_allow_empty(&payload, &["apiKey", "api_key"])
                .unwrap_or_else(|| service_setting(&app_handle).map(|setting| setting.api_key).unwrap_or_default());
            let configured_url = normalize_service_url(&requested)?;
            if configured_url.is_empty() && api_key.trim().is_empty() {
                store::set_service_setting(&app_handle, "", "")?;
                let setting = service_setting(&app_handle)?;
                return action_value(RemoteRepoServiceSaveResult {
                    configured_url: String::new(),
                    effective_url: setting.effective_url.clone(),
                    api_key: setting.api_key,
                    api_key_configured: setting.api_key_configured,
                    source: setting.source,
                    service_url: setting.effective_url,
                    repo_count: 0,
                });
            }
            let target = if configured_url.is_empty() {
                service_setting(&app_handle)?.effective_url
            } else {
                configured_url.clone()
            };
            let checked = check_service_url(&target, &api_key).await?;
            store::set_service_setting(&app_handle, &configured_url, &api_key)?;
            let setting = service_setting(&app_handle)?;
            action_value(merge_setting_and_check(setting, checked))
        }
        "list_overviews" => {
            let client = client_for_app(&app_handle)?;
            let repos = client.list_repositories().await.map_err(command_error)?;
            let overviews = repos
                .into_iter()
                .map(|repo| remote_repo_overview(&app_handle, repo))
                .collect::<Result<Vec<_>, _>>()?;
            action_value(overviews)
        }
        "sync_repo" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let client = client_for_app(&app_handle)?;
            let result: SyncResult = client.sync_repo(&repo_id).await.map_err(command_error)?;
            store::touch_accessed(&app_handle, &repo_id)?;
            action_value(result)
        }
        "touch_accessed" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            store::touch_accessed(&app_handle, &repo_id)?;
            action_value(Map::new())
        }
        "reload_config" => {
            let client = client_for_app(&app_handle)?;
            client.reload_config().await.map_err(command_error)?;
            action_value(Map::new())
        }
        "add_repo" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let name = required_payload_string(&payload, &["name"])?;
            let remote_url = required_payload_string(&payload, &["remoteUrl", "remote_url"])?;
            let default_ref = payload_string(&payload, &["defaultRef", "default_ref"]).unwrap_or_else(|| "main".to_string());
            let auth_method = payload_string(&payload, &["authMethod", "auth_method"]);
            let client = client_for_app(&app_handle)?;
            client
                .add_repository(&repo_id, &name, &remote_url, &default_ref, auth_method.as_deref())
                .await
                .map_err(command_error)?;
            action_value(Map::new())
        }
        "update_repo" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let name = payload_string(&payload, &["name"]);
            let remote_url = payload_string(&payload, &["remoteUrl", "remote_url"]);
            let default_ref = payload_string(&payload, &["defaultRef", "default_ref"]);
            let auth_method = payload_string(&payload, &["authMethod", "auth_method"]);
            let client = client_for_app(&app_handle)?;
            client
                .update_repository(
                    &repo_id,
                    name.as_deref(),
                    remote_url.as_deref(),
                    default_ref.as_deref(),
                    auth_method.as_deref(),
                )
                .await
                .map_err(command_error)?;
            action_value(Map::new())
        }
        "remove_repo" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let client = client_for_app(&app_handle)?;
            client.remove_repository(&repo_id).await.map_err(command_error)?;
            action_value(Map::new())
        }
        "set_pinned" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let pinned = payload_bool(&payload, &["pinned"]).unwrap_or(false);
            store::set_pinned(&app_handle, &repo_id, pinned)?;
            action_value(Map::new())
        }
        "list_branches" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let client = client_for_app(&app_handle)?;
            action_value(client.list_repo_branches(&repo_id).await.map_err(command_error)?)
        }
        "list_files" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let path = payload_string(&payload, &["path"]).unwrap_or_else(|| ".".to_string());
            let ref_or_commit = payload_string(&payload, &["refOrCommit", "ref_or_commit"]);
            let client = client_for_app(&app_handle)?;
            let tree: RemoteRepoFileTree = client
                .list_repo_files(&repo_id, &path, ref_or_commit.as_deref())
                .await
                .map_err(command_error)?;
            action_value(tree)
        }
        "read_file" => {
            let repo_id = required_payload_string(&payload, &["repoId", "repo_id"])?;
            let path = required_payload_string(&payload, &["path"])?;
            let ref_or_commit = payload_string(&payload, &["refOrCommit", "ref_or_commit"]);
            let client = client_for_app(&app_handle)?;
            let content: RemoteRepoFileContent = client
                .read_repo_file(&repo_id, &path, ref_or_commit.as_deref())
                .await
                .map_err(command_error)?;
            action_value(content)
        }
        "workspace_request" => {
            let request: WorkspaceRequestPayload = serde_json::from_value(payload)
                .map_err(|error| format!("invalid workspace request payload: {error}"))?;
            let client = client_for_app(&app_handle)?;
            client
                .workspace_request(&request.operation, request.input)
                .await
                .map_err(command_error)
        }
        other => Err(format!("unsupported remote_repo action: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_service_url, payload_string, payload_string_allow_empty};
    use serde_json::json;

    #[test]
    fn normalizes_http_service_url() {
        assert_eq!(
            normalize_service_url(" http://127.0.0.1:8765/ ").unwrap(),
            "http://127.0.0.1:8765"
        );
        assert_eq!(
            normalize_service_url("https://example.com/remote-repo-service/").unwrap(),
            "https://example.com/remote-repo-service"
        );
    }

    #[test]
    fn rejects_credentials_in_service_url() {
        assert!(normalize_service_url("https://token@example.com").is_err());
        assert!(normalize_service_url("ssh://git@example.com/repo").is_err());
    }

    #[test]
    fn preserves_explicit_empty_payload_string_for_api_key() {
        let payload = json!({ "apiKey": "" });

        assert_eq!(payload_string(&payload, &["apiKey"]), None);
        assert_eq!(payload_string_allow_empty(&payload, &["apiKey"]), Some(String::new()));
    }
}

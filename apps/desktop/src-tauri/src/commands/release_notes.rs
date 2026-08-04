use serde::Serialize;

// 与 tauri.conf.json 里 updater plugin 的 endpoint 保持一致；改发布源时两处同步。
const LATEST_RELEASE_URL: &str =
    "https://github.com/tianyaXs/giteam/releases/latest/download/latest.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    pub version: String,
    pub notes: String,
}

/// 拉取最新版 release notes。reqwest 走 Rust 侧请求，绕开 webview 的 CORS 限制，
/// 供「关于 → 查看更新内容」入口在没有本地缓存（dev / 首次安装）时取到真实说明。
/// 网络/解析失败一律返回 Ok(None)，由前端退化为空骨架，不抛错打断交互。
#[tauri::command]
pub async fn fetch_latest_release() -> Result<Option<LatestRelease>, String> {
    let response = reqwest::get(LATEST_RELEASE_URL)
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let json: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    let version = json
        .get("version")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let notes = json
        .get("notes")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    if version.is_empty() {
        return Ok(None);
    }
    Ok(Some(LatestRelease { version, notes }))
}

//! skills.sh / SkillsMP HTTP helpers。
//! 供桌面 pi agent 的 skill 市场功能使用。

use super::command_runner;
use serde_json::Value;
use std::time::Duration;

fn fetch_skills_sh_json(
    repo_path: &str,
    endpoint: &str,
    timeout_secs: u64,
) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let ep = endpoint.trim();
    if !ep.starts_with("/api/v1/skills") || ep.contains('\n') || ep.contains('\r') {
        return Err("invalid skills.sh endpoint".to_string());
    }
    let url = format!("https://skills.sh{ep}");
    let args = vec![
        "-sSL",
        "--compressed",
        "--connect-timeout",
        "4",
        "--max-time",
        "12",
        url.as_str(),
    ];
    let raw = command_runner::run_and_capture_in_dir_with_timeout(
        "curl",
        &args,
        repo_path,
        timeout_secs,
    )?;
    let parsed = serde_json::from_str::<Value>(&raw)
        .map_err(|e| format!("parse skills.sh response failed: {e}"))?;
    if let Some(error) = parsed.get("error").and_then(|v| v.as_str()) {
        let message = parsed
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or(error);
        return Err(format!("skills.sh API {error}: {message}"));
    }
    Ok(parsed)
}

pub fn fetch_agent_skill_detail_api(repo_path: &str, id: &str) -> Result<Value, String> {
    let sid = id.trim().trim_matches('/');
    if sid.is_empty() || sid.contains("..") || sid.contains('\n') || sid.contains('\r') {
        return Err("invalid skill id".to_string());
    }
    fetch_skills_sh_json(repo_path, format!("/api/v1/skills/{sid}").as_str(), 18)
}

pub fn fetch_agent_skill_audit_api(repo_path: &str, id: &str) -> Result<Value, String> {
    let sid = id.trim().trim_matches('/');
    if sid.is_empty() || sid.contains("..") || sid.contains('\n') || sid.contains('\r') {
        return Err("invalid skill id".to_string());
    }
    match fetch_skills_sh_json(
        repo_path,
        format!("/api/v1/skills/audit/{sid}").as_str(),
        18,
    ) {
        Ok(v) => Ok(v),
        Err(e) if e.contains("returned error") || e.contains("exit status") => {
            Ok(serde_json::json!({ "id": sid, "audits": [] }))
        }
        Err(e) => Err(e),
    }
}

fn fetch_skillsmp_json_with_key(
    repo_path: &str,
    endpoint: &str,
    timeout_secs: u64,
    api_key: Option<String>,
) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let ep = endpoint.trim();
    if !ep.starts_with("/api/v1/skills/") || ep.contains('\n') || ep.contains('\r') {
        return Err("invalid SkillsMP endpoint".to_string());
    }
    let url = format!("https://skillsmp.com{ep}");
    let auth = api_key.unwrap_or_else(|| std::env::var("SKILLSMP_API_KEY").unwrap_or_default());
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(timeout_secs.max(1)))
        .user_agent("giteam-desktop/skillsmp")
        .build()
        .map_err(|e| format!("build SkillsMP client failed: {e}"))?;
    let mut req = client
        .get(url.as_str())
        .header("Accept", "application/json");
    if !auth.trim().is_empty() {
        req = req.bearer_auth(auth.trim());
    }
    let resp = req
        .send()
        .map_err(|e| format!("SkillsMP request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("SkillsMP HTTP {}", resp.status()));
    }
    let parsed = resp
        .json::<Value>()
        .map_err(|e| format!("parse SkillsMP response failed: {e}"))?;
    if parsed.get("success").and_then(|v| v.as_bool()) == Some(false) {
        let message = parsed
            .get("error")
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("SkillsMP request failed");
        return Err(message.to_string());
    }
    Ok(parsed)
}

pub fn fetch_skillsmp_skill_search(
    repo_path: &str,
    query: &str,
    page: Option<u64>,
    limit: Option<u64>,
    sort_by: Option<String>,
    category: Option<String>,
    occupation: Option<String>,
    api_key: Option<String>,
) -> Result<Value, String> {
    let q = query.trim();
    if q.len() < 2 || q == "*" {
        return Err("SkillsMP search query must be at least 2 characters".to_string());
    }
    let p = page.unwrap_or(1).max(1).min(1000);
    let lim = limit.unwrap_or(100).clamp(1, 100);
    let sort = match sort_by.unwrap_or_else(|| "stars".to_string()).as_str() {
        "recent" => "recent",
        _ => "stars",
    };
    let mut endpoint = format!(
        "/api/v1/skills/search?q={}&page={p}&limit={lim}&sortBy={sort}",
        urlencoding::encode(q)
    );
    let cat = category.unwrap_or_default();
    if !cat.trim().is_empty() {
        endpoint.push_str(format!("&category={}", urlencoding::encode(cat.trim())).as_str());
    }
    let occ = occupation.unwrap_or_default();
    if !occ.trim().is_empty() {
        endpoint.push_str(format!("&occupation={}", urlencoding::encode(occ.trim())).as_str());
    }
    fetch_skillsmp_json_with_key(repo_path, endpoint.as_str(), 15, api_key)
}

pub fn fetch_skillsmp_ai_search(
    repo_path: &str,
    query: &str,
    api_key: Option<String>,
) -> Result<Value, String> {
    let key = api_key.unwrap_or_else(|| std::env::var("SKILLSMP_API_KEY").unwrap_or_default());
    if key.trim().is_empty() {
        return Err("SKILLSMP_API_KEY is required for AI search".to_string());
    }
    let q = query.trim();
    if q.len() < 2 {
        return Err("SkillsMP AI search query must be at least 2 characters".to_string());
    }
    fetch_skillsmp_json_with_key(
        repo_path,
        format!("/api/v1/skills/ai-search?q={}", urlencoding::encode(q)).as_str(),
        20,
        Some(key),
    )
}

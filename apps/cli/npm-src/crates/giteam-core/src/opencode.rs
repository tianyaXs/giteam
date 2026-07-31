use super::command_runner;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

#[cfg(feature = "tauri-app")]
use std::collections::HashSet;
#[cfg(feature = "tauri-app")]
use tauri::Emitter;

const OPENCODE_TIMEOUT_SECS: u64 = 45;
fn run_opencode(args: &[&str], repo_path: &str) -> Result<String, String> {
    command_runner::run_and_capture_in_dir_with_timeout(
        "opencode",
        args,
        repo_path,
        OPENCODE_TIMEOUT_SECS,
    )
}

fn opencode_skill_source_groups_global_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let h = home.trim();
            if !h.is_empty() {
                return Some(
                    PathBuf::from(h)
                        .join("Library")
                        .join("Application Support")
                        .join("giteam")
                        .join("opencode-skill-source-groups.json"),
                );
            }
        }
    }
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg_config_home.trim();
        if !p.is_empty() {
            return Some(
                PathBuf::from(p)
                    .join("giteam")
                    .join("opencode-skill-source-groups.json"),
            );
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let h = home.trim();
        if !h.is_empty() {
            return Some(
                PathBuf::from(h)
                    .join(".config")
                    .join("giteam")
                    .join("opencode-skill-source-groups.json"),
            );
        }
    }
    None
}

fn opencode_skill_source_groups_project_path(repo_path: &str) -> PathBuf {
    Path::new(repo_path)
        .join(".giteam")
        .join("opencode-skill-source-groups.json")
}

fn read_opencode_skill_source_group_map(path: &Path) -> HashMap<String, String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    serde_json::from_str::<HashMap<String, String>>(&raw).unwrap_or_default()
}

fn load_opencode_skill_source_groups(repo_path: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let project_path = opencode_skill_source_groups_project_path(repo_path);
    out.extend(read_opencode_skill_source_group_map(project_path.as_path()));
    if let Some(global_path) = opencode_skill_source_groups_global_path() {
        out.extend(read_opencode_skill_source_group_map(global_path.as_path()));
    }
    out
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeInstalledSkill {
    pub name: String,
    pub path: String,
    pub scope: String,
    pub agents: Vec<String>,
    #[serde(default)]
    pub source_group: String,
}

fn opencode_global_config_file() -> Option<PathBuf> {
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        let p = xdg_config_home.trim();
        if !p.is_empty() {
            return Some(PathBuf::from(p).join("opencode").join("opencode.jsonc"));
        }
    }
    std::env::var("HOME").ok().map(|home| {
        PathBuf::from(home)
            .join(".config")
            .join("opencode")
            .join("opencode.jsonc")
    })
}

fn opencode_project_config_files(repo_path: &str) -> Vec<PathBuf> {
    let repo = PathBuf::from(repo_path);
    vec![repo.join("opencode.jsonc"), repo.join("opencode.json")]
}

fn strip_jsonc_comments(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(ch);
            continue;
        }
        if ch == '/' {
            match chars.peek().copied() {
                Some('/') => {
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == '\n' {
                            out.push('\n');
                            break;
                        }
                    }
                    continue;
                }
                Some('*') => {
                    chars.next();
                    let mut prev = '\0';
                    while let Some(c) = chars.next() {
                        if c == '\n' {
                            out.push('\n');
                        }
                        if prev == '*' && c == '/' {
                            break;
                        }
                        prev = c;
                    }
                    continue;
                }
                _ => {}
            }
        }
        out.push(ch);
    }
    out
}

fn remove_mcp_from_config_file(path: &Path, name: &str) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let raw =
        fs::read_to_string(path).map_err(|e| format!("read {} failed: {e}", path.display()))?;
    let stripped = strip_jsonc_comments(&raw);
    let mut json: Value = serde_json::from_str(&stripped)
        .map_err(|e| format!("parse {} failed: {e}", path.display()))?;
    let mut empty_mcp = false;
    let removed = if let Some(mcp) = json.get_mut("mcp").and_then(|v| v.as_object_mut()) {
        let did = mcp.remove(name).is_some();
        empty_mcp = mcp.is_empty();
        did
    } else {
        false
    };
    if empty_mcp {
        if let Some(obj) = json.as_object_mut() {
            obj.remove("mcp");
        }
    }
    if !removed {
        return Ok(false);
    }
    let next = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("serialize {} failed: {e}", path.display()))?;
    fs::write(path, format!("{}\n", next))
        .map_err(|e| format!("write {} failed: {e}", path.display()))?;
    Ok(true)
}

fn read_config_file(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw =
        fs::read_to_string(path).map_err(|e| format!("read {} failed: {e}", path.display()))?;
    let stripped = strip_jsonc_comments(&raw);
    let json: Value = serde_json::from_str(&stripped)
        .map_err(|e| format!("parse {} failed: {e}", path.display()))?;
    Ok(Some(json))
}

fn write_config_file(path: &Path, json: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create {} failed: {e}", parent.display()))?;
    }
    let next = serde_json::to_string_pretty(json)
        .map_err(|e| format!("serialize {} failed: {e}", path.display()))?;
    fs::write(path, format!("{}\n", next))
        .map_err(|e| format!("write {} failed: {e}", path.display()))
}

fn upsert_mcp_to_config_file_with_changed(
    path: &Path,
    name: &str,
    config: Value,
) -> Result<(Value, bool), String> {
    let mut json = read_config_file(path)?
        .unwrap_or_else(|| serde_json::json!({ "$schema": "https://opencode.ai/config.json" }));
    if !json.is_object() {
        json = serde_json::json!({ "$schema": "https://opencode.ai/config.json" });
    }
    let obj = json
        .as_object_mut()
        .ok_or_else(|| "config root is not an object".to_string())?;
    if !obj.get("mcp").map(|v| v.is_object()).unwrap_or(false) {
        obj.insert("mcp".to_string(), Value::Object(Map::new()));
    }
    let mcp = obj
        .get_mut("mcp")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "mcp config is not an object".to_string())?;
    if mcp.get(name) == Some(&config) {
        return Ok((json, false));
    }
    mcp.insert(name.to_string(), config);
    write_config_file(path, &json)?;
    Ok((json, true))
}

fn upsert_mcp_to_config_file(path: &Path, name: &str, config: Value) -> Result<Value, String> {
    upsert_mcp_to_config_file_with_changed(path, name, config).map(|(json, _)| json)
}

fn set_mcp_enabled_in_config_file(path: &Path, name: &str, enabled: bool) -> Result<bool, String> {
    let Some(mut json) = read_config_file(path)? else {
        return Ok(false);
    };
    let Some(mcp) = json.get_mut("mcp").and_then(|v| v.as_object_mut()) else {
        return Ok(false);
    };
    let Some(node) = mcp.get_mut(name).and_then(|v| v.as_object_mut()) else {
        return Ok(false);
    };
    node.insert("enabled".to_string(), Value::Bool(enabled));
    write_config_file(path, &json)?;
    Ok(true)
}

fn set_mcp_enabled_in_known_config_files(
    repo_path: &str,
    name: &str,
    enabled: bool,
) -> Result<bool, String> {
    let mut changed = false;
    let mut errors = Vec::new();
    for file in opencode_project_config_files(repo_path) {
        match set_mcp_enabled_in_config_file(&file, name, enabled) {
            Ok(true) => changed = true,
            Ok(false) => {}
            Err(e) => errors.push(e),
        }
    }
    if let Some(file) = opencode_global_config_file() {
        match set_mcp_enabled_in_config_file(&file, name, enabled) {
            Ok(true) => changed = true,
            Ok(false) => {}
            Err(e) => errors.push(e),
        }
    }
    if !changed && !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    Ok(changed)
}

fn scan_installed_skill_dir(
    root: PathBuf,
    scope: &str,
    source_group_map: &HashMap<String, String>,
    rows: &mut Vec<OpencodeInstalledSkill>,
) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("SKILL.md").is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|v| v.to_str()) {
            Some(name) if !name.trim().is_empty() => name.trim().to_string(),
            _ => continue,
        };
        rows.push(OpencodeInstalledSkill {
            name,
            path: path.to_string_lossy().to_string(),
            scope: scope.to_string(),
            agents: vec!["opencode".to_string()],
            source_group: source_group_map
                .get(path.to_string_lossy().as_ref())
                .cloned()
                .unwrap_or_default(),
        });
    }
}

fn opencode_skill_path_priority(path: &str) -> u8 {
    let normalized = path.replace('\\', "/");
    if normalized.contains("/.opencode/skills/")
        || normalized.contains("/.config/opencode/skills/")
    {
        return 0;
    }
    if normalized.contains("/.agents/skills/") {
        return 1;
    }
    2
}

fn collect_installed_opencode_skills(repo_path: &str) -> Vec<OpencodeInstalledSkill> {
    let mut rows: Vec<OpencodeInstalledSkill> = Vec::new();
    let source_group_map = load_opencode_skill_source_groups(repo_path);
    scan_installed_skill_dir(
        Path::new(repo_path).join(".opencode/skills"),
        "project",
        &source_group_map,
        &mut rows,
    );
    scan_installed_skill_dir(
        Path::new(repo_path).join(".agents/skills"),
        "project",
        &source_group_map,
        &mut rows,
    );
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        scan_installed_skill_dir(
            home.join(".config/opencode/skills"),
            "global",
            &source_group_map,
            &mut rows,
        );
        scan_installed_skill_dir(
            home.join(".opencode/skills"),
            "global",
            &source_group_map,
            &mut rows,
        );
        scan_installed_skill_dir(
            home.join(".agents/skills"),
            "global",
            &source_group_map,
            &mut rows,
        );
    }
    rows.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| {
                opencode_skill_path_priority(&a.path).cmp(&opencode_skill_path_priority(&b.path))
            })
            .then_with(|| a.path.cmp(&b.path))
    });
    rows.dedup_by(|a, b| a.scope == b.scope && a.name == b.name);
    rows
}

fn resolve_skill_manifest_path(skill_path: &Path, raw: &str) -> String {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return path.to_string_lossy().to_string();
    }
    skill_path.join(path).to_string_lossy().to_string()
}

fn normalize_skill_mcp_config(skill_path: &Path, raw: &Value) -> Result<(String, Value), String> {
    let mcp = raw
        .get("giteam")
        .and_then(|v| v.get("mcp"))
        .or_else(|| raw.get("mcp"))
        .ok_or_else(|| "missing giteam.mcp".to_string())?;
    let name = mcp
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err("mcp name must not be empty".to_string());
    }
    let mut config = mcp
        .as_object()
        .cloned()
        .ok_or_else(|| "giteam.mcp must be an object".to_string())?;
    config.remove("name");
    if !config.contains_key("enabled") {
        config.insert("enabled".to_string(), Value::Bool(true));
    }
    if !config.contains_key("type") {
        let inferred = if config.get("url").and_then(|v| v.as_str()).is_some() {
            "remote"
        } else {
            "local"
        };
        config.insert("type".to_string(), Value::String(inferred.to_string()));
    }
    if let Some(command) = config.get_mut("command").and_then(|v| v.as_array_mut()) {
        if command.len() > 1 {
            if let Some(script) = command.get(1).and_then(|v| v.as_str()).map(str::to_string) {
                command[1] = Value::String(resolve_skill_manifest_path(skill_path, &script));
            }
        }
    }
    Ok((name, Value::Object(config)))
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn sync_opencode_skill_mcp_manifests(repo_path: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let project_file = opencode_project_config_files(repo_path)
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(repo_path).join("opencode.jsonc"));
    let mut configured: Vec<Value> = Vec::new();
    let mut skipped: Vec<Value> = Vec::new();

    for skill in collect_installed_opencode_skills(repo_path) {
        let skill_path = PathBuf::from(&skill.path);
        let manifest_path = skill_path.join("giteam.json");
        if !manifest_path.is_file() {
            continue;
        }
        let raw = match fs::read_to_string(&manifest_path) {
            Ok(text) => text,
            Err(e) => {
                skipped.push(serde_json::json!({
                    "skill": skill.name,
                    "path": skill.path,
                    "reason": format!("read manifest failed: {e}"),
                }));
                continue;
            }
        };
        let parsed = match serde_json::from_str::<Value>(&raw) {
            Ok(value) => value,
            Err(e) => {
                skipped.push(serde_json::json!({
                    "skill": skill.name,
                    "path": skill.path,
                    "reason": format!("parse manifest failed: {e}"),
                }));
                continue;
            }
        };
        let (name, config) = match normalize_skill_mcp_config(&skill_path, &parsed) {
            Ok(value) => value,
            Err(e) => {
                skipped.push(serde_json::json!({
                    "skill": skill.name,
                    "path": skill.path,
                    "reason": e,
                }));
                continue;
            }
        };
        let changed = match upsert_mcp_to_config_file_with_changed(&project_file, &name, config) {
            Ok((_, changed)) => changed,
            Err(e) => {
                skipped.push(serde_json::json!({
                    "skill": skill.name,
                    "path": skill.path,
                    "mcp": name,
                    "reason": e,
                }));
                continue;
            }
        };
        configured.push(serde_json::json!({
            "skill": skill.name,
            "path": skill.path,
            "scope": skill.scope,
            "mcp": name,
            "changed": changed,
            "configPath": project_file.to_string_lossy(),
        }));
    }

    serde_json::to_value(serde_json::json!({
        "configured": configured,
        "skipped": skipped,
        "configPath": project_file.to_string_lossy(),
    }))
    .map_err(|e| format!("serialize skill mcp sync result failed: {e}"))
}

pub fn fetch_opencode_skill_audit_api(repo_path: &str, id: &str) -> Result<Value, String> {
    crate::skills_market::fetch_agent_skill_audit_api(repo_path, id)
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
    crate::skills_market::fetch_skillsmp_skill_search(
        repo_path, query, page, limit, sort_by, category, occupation, api_key,
    )
}

pub fn fetch_skillsmp_ai_search(
    repo_path: &str,
    query: &str,
    api_key: Option<String>,
) -> Result<Value, String> {
    crate::skills_market::fetch_skillsmp_ai_search(repo_path, query, api_key)
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn list_opencode_mcp_status(repo_path: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let mut out = Map::new();
    let mut add_config_rows = |cfg: Option<Value>, source: &str| {
        let Some(mcp) = cfg
            .as_ref()
            .and_then(|v| v.get("mcp"))
            .or_else(|| cfg.as_ref().and_then(|v| v.get("mcpServers")))
            .and_then(|v| v.as_object())
        else {
            return;
        };
        for (name, node) in mcp {
            let mut row = out
                .remove(name)
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default();
            if let Some(obj) = node.as_object() {
                for (k, v) in obj {
                    row.entry(k.clone()).or_insert(v.clone());
                }
            }
            let prev_source = row.get("source").and_then(|v| v.as_str()).unwrap_or("");
            let next_source = if prev_source.is_empty() {
                source.to_string()
            } else if prev_source == source || prev_source == "both" {
                prev_source.to_string()
            } else {
                "both".to_string()
            };
            row.insert("source".to_string(), Value::String(next_source));
            row.insert("configured".to_string(), Value::Bool(true));
            row.insert("runtimeKnown".to_string(), Value::Bool(false));
            row.entry("status".to_string())
                .or_insert(Value::String("configured".to_string()));
            out.insert(name.clone(), Value::Object(row));
        }
    };

    let project_cfg = opencode_project_config_files(repo_path)
        .into_iter()
        .find_map(|path| read_config_file(&path).ok().flatten());
    let global_cfg =
        opencode_global_config_file().and_then(|path| read_config_file(&path).ok().flatten());
    add_config_rows(project_cfg, "project");
    add_config_rows(global_cfg, "global");
    Ok(Value::Object(out))
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn add_opencode_mcp_server(
    repo_path: &str,
    name: &str,
    config: Value,
) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let n = name.trim();
    if n.is_empty() {
        return Err("mcp name must not be empty".to_string());
    }
    let project_file = opencode_project_config_files(repo_path)
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(repo_path).join("opencode.jsonc"));
    upsert_mcp_to_config_file(&project_file, n, config)
}

fn post_opencode_mcp_action(repo_path: &str, name: &str, action: &str) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let n = name.trim();
    if n.is_empty() {
        return Err("mcp name must not be empty".to_string());
    }
    if action == "disconnect" {
        return set_mcp_enabled_in_known_config_files(repo_path, n, false);
    }
    Err(format!("unsupported mcp action: {action}"))
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn connect_opencode_mcp_server(repo_path: &str, name: &str) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let n = name.trim();
    if n.is_empty() {
        return Err("mcp name must not be empty".to_string());
    }

    let mut found: Option<Value> = None;
    for file in opencode_project_config_files(repo_path) {
        if let Some(node) = read_config_file(&file)?
            .and_then(|json| json.get("mcp").and_then(|v| v.get(n)).cloned())
        {
            found = Some(node);
            break;
        }
    }
    if found.is_none() {
        if let Some(file) = opencode_global_config_file() {
            found = read_config_file(&file)?
                .and_then(|json| json.get("mcp").and_then(|v| v.get(n)).cloned());
        }
    }

    let Some(node) = found else {
        return Err(format!("mcp server not found in opencode config: {n}"));
    };
    let typ = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match typ {
        "local" => {
            let has_command = node
                .get("command")
                .and_then(|v| v.as_array())
                .map(|arr| !arr.is_empty())
                .unwrap_or(false);
            if !has_command {
                return Err(format!("local MCP {n} requires command[]"));
            }
        }
        "remote" => {
            let has_url = node
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if !has_url {
                return Err(format!("remote MCP {n} requires url"));
            }
        }
        other => return Err(format!("MCP {n} has invalid type: {other}")),
    }
    Ok(true)
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn disconnect_opencode_mcp_server(repo_path: &str, name: &str) -> Result<bool, String> {
    post_opencode_mcp_action(repo_path, name, "disconnect")
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn authenticate_opencode_mcp_server(repo_path: &str, name: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let n = name.trim();
    if n.is_empty() {
        return Err("mcp name must not be empty".to_string());
    }
    let out = run_opencode(&["mcp", "auth", n], repo_path)?;
    Ok(serde_json::json!({ "ok": true, "output": out }))
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn remove_opencode_mcp_auth(repo_path: &str, name: &str) -> Result<bool, String> {
    command_runner::validate_repo_path(repo_path)?;
    let n = name.trim();
    if n.is_empty() {
        return Err("mcp name must not be empty".to_string());
    }
    let _ = run_opencode(&["mcp", "logout", n], repo_path)?;
    Ok(true)
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn delete_opencode_mcp_server(repo_path: &str, name: &str) -> Result<Value, String> {
    command_runner::validate_repo_path(repo_path)?;
    let n = name.trim();
    if n.is_empty() {
        return Err("mcp name must not be empty".to_string());
    }
    let mut project_deleted = false;
    let mut global_deleted = false;
    let mut checked: Vec<String> = Vec::new();
    let mut deleted_from: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for file in opencode_project_config_files(repo_path) {
        checked.push(file.display().to_string());
        match remove_mcp_from_config_file(&file, n) {
            Ok(true) => {
                project_deleted = true;
                deleted_from.push(file.display().to_string());
            }
            Ok(false) => {}
            Err(e) => errors.push(e),
        }
    }
    if let Some(global_file) = opencode_global_config_file() {
        checked.push(global_file.display().to_string());
        match remove_mcp_from_config_file(&global_file, n) {
            Ok(true) => {
                global_deleted = true;
                deleted_from.push(global_file.display().to_string());
            }
            Ok(false) => {}
            Err(e) => errors.push(e),
        }
    }

    let still_present: Vec<String> = checked
        .iter()
        .filter_map(|p| {
            let path = PathBuf::from(p);
            let has_mcp = read_config_file(&path)
                .ok()
                .flatten()
                .and_then(|json| json.get("mcp").and_then(|v| v.get(n)).cloned())
                .is_some();
            if has_mcp {
                Some(p.clone())
            } else {
                None
            }
        })
        .collect();

    let ok = project_deleted || global_deleted;
    if !still_present.is_empty() {
        return Err(format!(
            "MCP {n} 删除后仍存在于配置文件:\n{}",
            still_present.join("\n")
        ));
    }
    if !ok && !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    Ok(serde_json::json!({
        "ok": ok,
        "projectDeleted": project_deleted,
        "globalDeleted": global_deleted,
        "projectFileDeleted": project_deleted,
        "globalFileDeleted": global_deleted,
        "checked": checked,
        "deletedFrom": deleted_from,
        "errors": errors,
        "message": if ok { "deleted from opencode config file" } else { "not found in opencode config files" }
    }))
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn run_opencode_mcp(repo_path: &str) -> Result<String, String> {
    run_opencode(&["mcp", "list"], repo_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("giteam-opencode-test-{label}-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn collect_installed_skills_prefers_opencode_native_path() {
        let repo = temp_repo("skill-priority");
        for dir in [".agents/skills/dup", ".opencode/skills/dup"] {
            let skill_dir = repo.join(dir);
            fs::create_dir_all(&skill_dir).unwrap();
            fs::write(
                skill_dir.join("SKILL.md"),
                "---\nname: dup\ndescription: test\n---\n",
            )
            .unwrap();
        }

        let rows = collect_installed_opencode_skills(repo.to_str().unwrap());

        let dup_rows: Vec<_> = rows.iter().filter(|row| row.name == "dup").collect();
        assert_eq!(dup_rows.len(), 1);
        assert_eq!(
            dup_rows[0].path,
            repo.join(".opencode/skills/dup").to_string_lossy()
        );

        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn skill_mcp_manifest_command_is_resolved_relative_to_skill_dir() {
        let repo = temp_repo("manifest");
        let skill_path = repo.join(".agents/skills/opencode-remote-repo");
        let manifest = serde_json::json!({
            "giteam": {
                "mcp": {
                    "name": "remote_repo",
                    "type": "local",
                    "command": ["python3", "mcp/giteam_mcp_launcher.py"],
                    "enabled": true
                }
            }
        });

        let (name, config) = normalize_skill_mcp_config(&skill_path, &manifest).unwrap();

        assert_eq!(name, "remote_repo");
        assert_eq!(config["type"], "local");
        assert_eq!(config["command"][0], "python3");
        assert_eq!(
            config["command"][1],
            Value::String(
                skill_path
                    .join("mcp/giteam_mcp_launcher.py")
                    .to_string_lossy()
                    .to_string()
            )
        );

        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn upsert_mcp_reports_unchanged_when_config_already_matches() {
        let repo = temp_repo("mcp-upsert");
        let config_path = repo.join("opencode.jsonc");
        let config = serde_json::json!({
            "type": "local",
            "command": ["python3", "/tmp/launcher.py"],
            "enabled": true
        });

        let (_, first_changed) =
            upsert_mcp_to_config_file_with_changed(&config_path, "remote_repo", config.clone())
                .unwrap();
        let (_, second_changed) =
            upsert_mcp_to_config_file_with_changed(&config_path, "remote_repo", config).unwrap();

        assert!(first_changed);
        assert!(!second_changed);

        let _ = fs::remove_dir_all(repo);
    }
}

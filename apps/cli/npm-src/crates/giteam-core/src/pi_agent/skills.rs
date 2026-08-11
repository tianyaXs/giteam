//! Pi 运行时下的 Skills 子系统。
//!
//! pi 嵌入式 SDK（`create_agent_session`）不会自动加载 skills，本模块封装
//! pi 目录（`.pi/skills` 项目级 + `{PI_CODING_AGENT_DIR}/skills` 全局级）的
//! skill 发现、注入、内置安装、删除与 source group 管理。
//!
//! - 发现/注入：调用 `pi::resources::load_skills` + `format_skills_for_prompt`；
//! - 安装/删除：pi 无安装/删除 API，Giteam 自行写盘/删盘到 pi 目录；
//! - MCP manifest 同步（PR8）、第三方 `npx skills add` CLI 安装、`/skill:` 命令展开
//!   不在本 PR 范围。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use pi::config::Config as PiConfig;
use pi::resources::{format_skills_for_prompt, load_skills, LoadSkillsOptions};
use serde::{Deserialize, Serialize};

// ── 数据结构（对齐 pi 的 source 值域，透传 description 供前端展示） ──

/// 已安装的 pi skill（对应 pi 目录下含 SKILL.md 的子目录）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstalledSkill {
    /// skill 目录名（= SKILL.md frontmatter 的 name）。
    pub name: String,
    /// frontmatter 的 description（pi 解析；缺失 description 的 skill 会被 pi 静默跳过）。
    pub description: String,
    /// skill 目录绝对路径（pi base_dir），source group map 的 key。
    pub path: String,
    /// SKILL.md 绝对路径（pi file_path），供 `/skill:` 定位与前端跳转。
    pub file_path: String,
    /// `"project"` | `"global"`（pi source `"user"`→`"global"`，其余→`"project"`）。
    pub scope: String,
    /// 透传 pi 的 source：`"project"` / `"user"` / `"path"`。
    pub source: String,
    /// 是否对模型隐藏（frontmatter `disable-model-invocation: true`）。
    pub disable_model_invocation: bool,
    /// 固定 `["pi"]`，前端兼容字段。
    pub agents: Vec<String>,
    /// 所属 source group（可空）。
    #[serde(default)]
    pub source_group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillSourceGroupEntry {
    pub path: String,
    /// `"project"` | `"global"`。
    pub scope: String,
    pub source_group: String,
}

// ── 内置 skill（giteam-remote-repo） ──

struct BuiltinAgentSkillFile {
    path: &'static str,
    contents: &'static str,
}

struct BuiltinAgentSkill {
    id: &'static str,
    name: &'static str,
    files: &'static [BuiltinAgentSkillFile],
}

const REMOTE_REPO_SKILL_FILES: &[BuiltinAgentSkillFile] = &[
    BuiltinAgentSkillFile {
        path: "SKILL.md",
        contents: include_str!("../../resources/agent-skills/giteam-remote-repo/SKILL.md"),
    },
    BuiltinAgentSkillFile {
        path: "giteam.json",
        contents: include_str!("../../resources/agent-skills/giteam-remote-repo/giteam.json"),
    },
    BuiltinAgentSkillFile {
        path: "agents/openai.yaml",
        contents: include_str!(
            "../../resources/agent-skills/giteam-remote-repo/agents/openai.yaml"
        ),
    },
    BuiltinAgentSkillFile {
        path: "references/api.md",
        contents: include_str!(
            "../../resources/agent-skills/giteam-remote-repo/references/api.md"
        ),
    },
    BuiltinAgentSkillFile {
        path: "references/mcp-tools.md",
        contents: include_str!(
            "../../resources/agent-skills/giteam-remote-repo/references/mcp-tools.md"
        ),
    },
    BuiltinAgentSkillFile {
        path: "scripts/remote_repo_client.py",
        contents: include_str!(
            "../../resources/agent-skills/giteam-remote-repo/scripts/remote_repo_client.py"
        ),
    },
    BuiltinAgentSkillFile {
        path: "mcp/giteam_mcp_launcher.py",
        contents: include_str!(
            "../../resources/agent-skills/giteam-remote-repo/mcp/giteam_mcp_launcher.py"
        ),
    },
    BuiltinAgentSkillFile {
        path: "mcp/mcp_server.py",
        contents: include_str!(
            "../../resources/agent-skills/giteam-remote-repo/mcp/mcp_server.py"
        ),
    },
];

pub const BUILTIN_AGENT_SKILLS: &[BuiltinAgentSkill] = &[BuiltinAgentSkill {
    id: "giteam-remote-repo",
    name: "giteam-remote-repo",
    files: REMOTE_REPO_SKILL_FILES,
}];

// ── 发现 / 注入 ──

/// 构造 load_skills 选项：cwd = 仓库根，agent_dir = pi 全局目录。
///
/// 全局目录由 `ensure_pi_agent_dir_env`（service 初始化）接管为 `{giteam_data}/pi-agent`，
/// 与 auth.json/models.json 同级；`load_skills` 自动扫 `{agent_dir}/skills` 子目录。
fn load_skills_options(cwd: &Path) -> LoadSkillsOptions {
    LoadSkillsOptions {
        cwd: cwd.to_path_buf(),
        agent_dir: PiConfig::global_dir(),
        skill_paths: vec![],
        include_defaults: true,
    }
}

/// pi `Skill.source` → 前端 scope。
fn pi_source_to_scope(source: &str) -> &'static str {
    match source {
        "user" => "global",
        _ => "project",
    }
}

/// 读取 pi 目录 skills 并格式化为 system prompt 注入块。
///
/// 无可见 skill（全部被 `disable-model-invocation` 过滤或目录为空）时返回 `None`，
/// 调用方据此保持 append_system_prompt 原样、不污染 prompt。
fn format_loaded_skills(options: LoadSkillsOptions) -> Option<String> {
    let result = load_skills(options);
    let prompt = format_skills_for_prompt(&result.skills);
    if prompt.trim().is_empty() {
        None
    } else {
        Some(prompt)
    }
}

/// 注入点入口（`service.rs::into_sdk_options` 调用）：返回 pi skills 提示块。
pub fn build_skills_prompt(repo_path: &Path) -> Option<String> {
    format_loaded_skills(load_skills_options(repo_path))
}

/// 列出 pi 目录下的全部已安装 skill（project + global）。
fn collect_pi_skills(repo_path: &str) -> Vec<AgentInstalledSkill> {
    let result = load_skills(load_skills_options(Path::new(repo_path)));
    let source_group_map = load_agent_skill_source_groups(repo_path);
    result
        .skills
        .iter()
        .map(|skill| {
            let base_dir = skill.base_dir.display().to_string();
            AgentInstalledSkill {
                name: skill.name.clone(),
                description: skill.description.clone(),
                path: base_dir.clone(),
                file_path: skill.file_path.display().to_string(),
                scope: pi_source_to_scope(&skill.source).to_string(),
                source: skill.source.clone(),
                disable_model_invocation: skill.disable_model_invocation,
                agents: vec!["pi".to_string()],
                source_group: source_group_map
                    .get(&base_dir)
                    .cloned()
                    .unwrap_or_default(),
            }
        })
        .collect()
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn list_installed_agent_skills(repo_path: &str) -> Result<Vec<AgentInstalledSkill>, String> {
    crate::command_runner::validate_repo_path(repo_path)?;
    Ok(collect_pi_skills(repo_path))
}

// ── 内置安装 ──

fn find_builtin_agent_skill(id: &str) -> Option<&'static BuiltinAgentSkill> {
    let target = id.trim();
    BUILTIN_AGENT_SKILLS
        .iter()
        .find(|skill| skill.id == target || skill.name == target)
}

/// project: `{repo}/.pi/skills/<name>/`；global: `{PI_CODING_AGENT_DIR}/skills/<name>/`。
fn builtin_agent_skill_target_dir(
    repo_path: &str,
    skill: &BuiltinAgentSkill,
    global: bool,
) -> Result<PathBuf, String> {
    if global {
        return Ok(PiConfig::global_dir().join("skills").join(skill.name));
    }
    Ok(Path::new(repo_path)
        .join(".pi")
        .join("skills")
        .join(skill.name))
}

fn write_builtin_agent_skill(
    repo_path: &str,
    skill: &BuiltinAgentSkill,
    global: bool,
) -> Result<PathBuf, String> {
    let target_dir = builtin_agent_skill_target_dir(repo_path, skill, global)?;
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("create builtin skill dir failed: {e}"))?;
    for file in skill.files {
        if file.path.split('/').any(|segment| segment == ".." || segment.is_empty()) {
            return Err(format!("invalid builtin skill file path: {}", file.path));
        }
        let path = target_dir.join(file.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("create builtin skill file dir failed: {e}"))?;
        }
        fs::write(&path, file.contents)
            .map_err(|e| format!("write builtin skill file {} failed: {e}", path.display()))?;
    }
    Ok(target_dir)
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn install_builtin_agent_skill(
    repo_path: &str,
    skill_id: &str,
    global: Option<bool>,
) -> Result<serde_json::Value, String> {
    crate::command_runner::validate_repo_path(repo_path)?;
    let skill = find_builtin_agent_skill(skill_id)
        .ok_or_else(|| format!("unknown builtin agent skill: {}", skill_id.trim()))?;
    let is_global = global.unwrap_or(false);
    // PR7 不做 MCP manifest 同步（归 PR8）；giteam.json / mcp/* 等文件照常写盘但闲置。
    let target_dir = write_builtin_agent_skill(repo_path, skill, is_global)?;
    serde_json::to_value(serde_json::json!({
        "installed": true,
        "builtin": true,
        "skillId": skill.id,
        "name": skill.name,
        "scope": if is_global { "global" } else { "project" },
        "path": target_dir.to_string_lossy(),
    }))
    .map_err(|e| format!("serialize builtin skill install result failed: {e}"))
}

// ── 删除（allowed_roots = `{repo}/.pi/skills` + `{PI_CODING_AGENT_DIR}/skills`，越界拒删） ──

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn remove_installed_agent_skills_by_path(
    repo_path: &str,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    crate::command_runner::validate_repo_path(repo_path)?;
    let repo_root =
        fs::canonicalize(repo_path).map_err(|e| format!("resolve repo path failed: {e}"))?;
    let allowed_roots = vec![
        repo_root.join(".pi").join("skills"),
        PiConfig::global_dir().join("skills"),
    ];

    let mut removed: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    for raw_path in paths {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let skill_path = PathBuf::from(trimmed);
        if !skill_path.exists() {
            missing.push(trimmed.to_string());
            continue;
        }
        let canonical = fs::canonicalize(&skill_path)
            .map_err(|e| format!("resolve skill path failed for {trimmed}: {e}"))?;
        let allowed = allowed_roots.iter().any(|root| canonical.starts_with(root));
        if !allowed {
            return Err(format!(
                "refusing to remove path outside pi skills directories: {trimmed}"
            ));
        }
        if !canonical.is_dir() {
            return Err(format!("skill path is not a directory: {trimmed}"));
        }
        fs::remove_dir_all(&canonical)
            .map_err(|e| format!("remove installed skill failed for {trimmed}: {e}"))?;
        removed.push(canonical.to_string_lossy().to_string());
    }

    prune_agent_skill_source_groups(repo_path, &removed)?;

    serde_json::to_value(serde_json::json!({
        "removed": removed,
        "missing": missing,
    }))
    .map_err(|e| format!("serialize removal result failed: {e}"))
}

// ── source group（文件名 pi-skill-source-groups.json） ──

/// 全局 source group 文件：放在 Giteam 数据目录（与 pi-agent 数据同级）。
fn agent_skill_source_groups_global_path() -> Option<PathBuf> {
    super::default_data_dir().map(|dir| dir.join("pi-skill-source-groups.json"))
}

fn agent_skill_source_groups_project_path(repo_path: &str) -> PathBuf {
    Path::new(repo_path)
        .join(".giteam")
        .join("pi-skill-source-groups.json")
}

fn read_agent_skill_source_group_map(path: &Path) -> HashMap<String, String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    serde_json::from_str::<HashMap<String, String>>(&raw).unwrap_or_default()
}

fn write_agent_skill_source_group_map(
    path: &Path,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create skill source group dir failed: {e}"))?;
    }
    let text = serde_json::to_string_pretty(map)
        .map_err(|e| format!("serialize skill source groups failed: {e}"))?;
    fs::write(path, format!("{text}\n"))
        .map_err(|e| format!("write skill source groups failed: {e}"))
}

fn load_agent_skill_source_groups(repo_path: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let project_path = agent_skill_source_groups_project_path(repo_path);
    out.extend(read_agent_skill_source_group_map(project_path.as_path()));
    if let Some(global_path) = agent_skill_source_groups_global_path() {
        out.extend(read_agent_skill_source_group_map(global_path.as_path()));
    }
    out
}

fn upsert_agent_skill_source_groups(
    repo_path: &str,
    entries: &[AgentSkillSourceGroupEntry],
) -> Result<usize, String> {
    crate::command_runner::validate_repo_path(repo_path)?;
    let project_path = agent_skill_source_groups_project_path(repo_path);
    let mut project_map = read_agent_skill_source_group_map(project_path.as_path());
    let global_path = agent_skill_source_groups_global_path();
    let mut global_map = global_path
        .as_ref()
        .map(|path| read_agent_skill_source_group_map(path.as_path()))
        .unwrap_or_default();
    let mut changed = 0usize;

    for entry in entries {
        let path = entry.path.trim();
        let source_group = entry.source_group.trim();
        let scope = entry.scope.trim();
        if path.is_empty() || source_group.is_empty() {
            continue;
        }
        let target_map = if scope == "global" {
            &mut global_map
        } else {
            &mut project_map
        };
        if target_map.get(path).map(|v| v.as_str()) == Some(source_group) {
            continue;
        }
        target_map.insert(path.to_string(), source_group.to_string());
        changed += 1;
    }

    if changed == 0 {
        return Ok(0);
    }
    write_agent_skill_source_group_map(project_path.as_path(), &project_map)?;
    if let Some(path) = global_path {
        write_agent_skill_source_group_map(path.as_path(), &global_map)?;
    }
    Ok(changed)
}

fn prune_agent_skill_source_groups(
    repo_path: &str,
    removed_paths: &[String],
) -> Result<(), String> {
    if removed_paths.is_empty() {
        return Ok(());
    }
    crate::command_runner::validate_repo_path(repo_path)?;
    let project_path = agent_skill_source_groups_project_path(repo_path);
    let mut project_map = read_agent_skill_source_group_map(project_path.as_path());
    let global_path = agent_skill_source_groups_global_path();
    let mut global_map = global_path
        .as_ref()
        .map(|path| read_agent_skill_source_group_map(path.as_path()))
        .unwrap_or_default();
    let mut project_changed = false;
    let mut global_changed = false;

    for path in removed_paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if project_map.remove(trimmed).is_some() {
            project_changed = true;
        }
        if global_map.remove(trimmed).is_some() {
            global_changed = true;
        }
    }

    if project_changed {
        write_agent_skill_source_group_map(project_path.as_path(), &project_map)?;
    }
    if global_changed {
        if let Some(path) = global_path {
            write_agent_skill_source_group_map(path.as_path(), &global_map)?;
        }
    }
    Ok(())
}

#[cfg_attr(feature = "tauri-app", tauri::command)]
pub fn save_agent_skill_source_groups(
    repo_path: &str,
    entries: Vec<AgentSkillSourceGroupEntry>,
) -> Result<serde_json::Value, String> {
    let changed = upsert_agent_skill_source_groups(repo_path, &entries)?;
    serde_json::to_value(serde_json::json!({ "saved": changed }))
        .map_err(|e| format!("serialize source group save result failed: {e}"))
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
        let path = std::env::temp_dir().join(format!("giteam-pi-skill-test-{label}-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    /// 在 `{repo}/.pi/skills/<name>/SKILL.md` 写一份最小 skill；description=None 模拟缺失。
    fn write_minimal_skill(repo: &Path, name: &str, description: Option<&str>) -> PathBuf {
        let dir = repo.join(".pi").join("skills").join(name);
        fs::create_dir_all(&dir).unwrap();
        let content = match description {
            Some(desc) => format!("---\nname: {name}\ndescription: {desc}\n---\nbody\n"),
            None => format!("---\nname: {name}\n---\nbody\n"),
        };
        fs::write(dir.join("SKILL.md"), content).unwrap();
        dir
    }

    #[test]
    fn pi_source_to_scope_maps_user_to_global() {
        assert_eq!(pi_source_to_scope("user"), "global");
        assert_eq!(pi_source_to_scope("project"), "project");
        assert_eq!(pi_source_to_scope("path"), "project");
        assert_eq!(pi_source_to_scope(""), "project");
    }

    #[test]
    fn install_builtin_writes_all_files_to_pi_dir() {
        let repo = temp_repo("builtin-install");
        let skill = find_builtin_agent_skill("giteam-remote-repo").unwrap();
        let target = write_builtin_agent_skill(repo.to_str().unwrap(), skill, false).unwrap();
        assert_eq!(target, repo.join(".pi/skills/giteam-remote-repo"));
        for rel in [
            "SKILL.md",
            "giteam.json",
            "agents/openai.yaml",
            "references/api.md",
            "references/mcp-tools.md",
            "scripts/remote_repo_client.py",
            "mcp/giteam_mcp_launcher.py",
            "mcp/mcp_server.py",
        ] {
            assert!(target.join(rel).is_file(), "missing builtin file: {rel}");
        }
        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn builtin_global_targets_pi_agent_skills_subdir() {
        // global 目标目录走 {PI_CODING_AGENT_DIR}/skills/<name>；此处只验证尾部相对结构。
        let repo = temp_repo("builtin-global");
        let skill = find_builtin_agent_skill("giteam-remote-repo").unwrap();
        let target = builtin_agent_skill_target_dir(repo.to_str().unwrap(), skill, true).unwrap();
        assert!(target.ends_with("skills/giteam-remote-repo"));
        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn collect_finds_project_skill_with_pi_scope() {
        let repo = temp_repo("collect-project");
        write_minimal_skill(&repo, "demo-collect-skill", Some("a demo skill"));

        let rows = collect_pi_skills(repo.to_str().unwrap());
        let hit = rows
            .iter()
            .find(|row| row.name == "demo-collect-skill")
            .expect("project skill should be discovered");
        assert_eq!(hit.scope, "project");
        assert_eq!(hit.source, "project");
        assert_eq!(hit.agents, vec!["pi".to_string()]);
        assert!(hit.path.replace('\\', "/").ends_with(".pi/skills/demo-collect-skill"));
        assert_eq!(hit.description, "a demo skill");

        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn format_loaded_skills_returns_none_when_empty() {
        let repo = temp_repo("format-empty");
        let agent = temp_repo("format-empty-agent");
        let options = LoadSkillsOptions {
            cwd: repo.clone(),
            agent_dir: agent.clone(),
            skill_paths: vec![],
            include_defaults: true,
        };
        assert_eq!(format_loaded_skills(options), None);
        let _ = fs::remove_dir_all(repo);
        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn format_loaded_skills_emits_xml_block_when_present() {
        let repo = temp_repo("format-present");
        let agent = temp_repo("format-present-agent");
        write_minimal_skill(&repo, "demo-format-skill", Some("a demo skill"));
        let options = LoadSkillsOptions {
            cwd: repo.clone(),
            agent_dir: agent.clone(),
            skill_paths: vec![],
            include_defaults: true,
        };
        let prompt = format_loaded_skills(options).expect("should emit prompt");
        assert!(prompt.contains("<available_skills>"));
        assert!(prompt.contains("<name>demo-format-skill</name>"));
        assert!(prompt.contains("a demo skill"));
        let _ = fs::remove_dir_all(repo);
        let _ = fs::remove_dir_all(agent);
    }

    #[test]
    fn skill_without_description_is_skipped_by_pi() {
        let repo = temp_repo("no-desc");
        let agent = temp_repo("no-desc-agent");
        write_minimal_skill(&repo, "nodesc-skill", None);
        let options = LoadSkillsOptions {
            cwd: repo.clone(),
            agent_dir: agent.clone(),
            skill_paths: vec![],
            include_defaults: true,
        };
        let result = load_skills(options);
        assert!(
            result.skills.iter().all(|s| s.name != "nodesc-skill"),
            "pi should skip skills missing description"
        );
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.message.contains("description")),
            "pi should emit a description diagnostic for the skipped skill"
        );
        let _ = fs::remove_dir_all(repo);
        let _ = fs::remove_dir_all(agent);
    }
}

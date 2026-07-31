use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use giteam_core::pi_agent::{
    AgentEventEnvelope, AgentInstalledSkill, AgentInteraction, AgentInteractionReply,
    AgentMessage, AgentModelInfo, AgentPromptImage, AgentProviderInfo, AgentSkillSourceGroupEntry,
    CustomProviderInput, PiAgentService, PiRuntimeInfo, PiSessionConfig, PiSessionSummary,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

fn service() -> &'static Arc<PiAgentService> {
    PiAgentService::global()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCreateSessionRequest {
    pub repo_path: String,
    pub session_dir: Option<String>,
    pub session_path: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
    pub system_prompt: Option<String>,
    pub append_system_prompt: Option<String>,
    pub enabled_tools: Option<Vec<String>>,
    #[serde(default)]
    pub extension_paths: Vec<String>,
    #[serde(default)]
    pub no_session: bool,
    /// Thinking level（off/minimal/low/medium/high/xhigh）。
    pub thinking: Option<String>,
    /// 单次 run 最大工具迭代次数；None/省略 = 不限制。
    pub max_tool_iterations: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPromptRequest {
    pub session_id: String,
    pub run_id: String,
    pub prompt: String,
    #[serde(default)]
    pub images: Vec<AgentPromptImage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptResponse {
    pub run_id: String,
    pub message: AgentMessage,
    pub events: Vec<AgentEventEnvelope>,
}

#[tauri::command]
pub fn agent_runtime_info() -> PiRuntimeInfo {
    service().runtime_info()
}

// ── Skills（pi 目录）：转发到 giteam_core::pi_agent::skills 的自由函数 ──

#[tauri::command]
pub fn list_installed_agent_skills(repo_path: String) -> Result<Vec<AgentInstalledSkill>, String> {
    giteam_core::pi_agent::list_installed_agent_skills(&repo_path)
}

#[tauri::command]
pub fn install_builtin_agent_skill(
    repo_path: String,
    skill_id: String,
    global: Option<bool>,
) -> Result<serde_json::Value, String> {
    giteam_core::pi_agent::install_builtin_agent_skill(&repo_path, &skill_id, global)
}

#[tauri::command]
pub fn remove_installed_agent_skills_by_path(
    repo_path: String,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    giteam_core::pi_agent::remove_installed_agent_skills_by_path(&repo_path, paths)
}

#[tauri::command]
pub fn save_agent_skill_source_groups(
    repo_path: String,
    entries: Vec<AgentSkillSourceGroupEntry>,
) -> Result<serde_json::Value, String> {
    giteam_core::pi_agent::save_agent_skill_source_groups(&repo_path, entries)
}

/// skills.sh 详情/审计 + SkillsMP 搜索（已迁到 `skills_market`，与 OpenCode 运行时无关）。
#[tauri::command]
pub fn fetch_agent_skill_detail_api(
    repo_path: String,
    id: String,
) -> Result<serde_json::Value, String> {
    giteam_core::skills_market::fetch_agent_skill_detail_api(&repo_path, &id)
}

#[tauri::command]
pub fn fetch_agent_skill_audit_api(
    repo_path: String,
    id: String,
) -> Result<serde_json::Value, String> {
    giteam_core::skills_market::fetch_agent_skill_audit_api(&repo_path, &id)
}

#[tauri::command]
pub fn fetch_skillsmp_skill_search(
    repo_path: String,
    query: String,
    page: Option<u64>,
    limit: Option<u64>,
    sort_by: Option<String>,
    category: Option<String>,
    occupation: Option<String>,
    api_key: Option<String>,
) -> Result<serde_json::Value, String> {
    giteam_core::skills_market::fetch_skillsmp_skill_search(
        &repo_path,
        &query,
        page,
        limit,
        sort_by,
        category,
        occupation,
        api_key,
    )
}

#[tauri::command]
pub fn fetch_skillsmp_ai_search(
    repo_path: String,
    query: String,
    api_key: Option<String>,
) -> Result<serde_json::Value, String> {
    giteam_core::skills_market::fetch_skillsmp_ai_search(&repo_path, &query, api_key)
}

#[tauri::command]
pub async fn agent_create_session(
    request: PiCreateSessionRequest,
) -> Result<PiSessionSummary, String> {
    let config = PiSessionConfig {
        repo_path: PathBuf::from(&request.repo_path),
        session_dir: request
            .session_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(&request.repo_path)
                    .join(".giteam")
                    .join("pi-sessions")
            }),
        session_path: request.session_path.map(PathBuf::from),
        provider: request.provider,
        model: request.model,
        api_key: request.api_key,
        system_prompt: request.system_prompt,
        append_system_prompt: request.append_system_prompt,
        enabled_tools: request.enabled_tools,
        extension_paths: request
            .extension_paths
            .into_iter()
            .map(PathBuf::from)
            .collect(),
        no_session: request.no_session,
        thinking: request.thinking,
        max_tool_iterations: request.max_tool_iterations,
    };
    service()
        .create_session(config)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_list_sessions() -> Result<Vec<PiSessionSummary>, String> {
    service()
        .list_sessions()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_get_session(session_id: String) -> Result<PiSessionSummary, String> {
    service()
        .session_summary(&session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_get_session_messages(session_id: String) -> Result<Vec<AgentMessage>, String> {
    service()
        .messages(&session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_prompt(
    app: AppHandle,
    request: PiPromptRequest,
) -> Result<AgentPromptResponse, String> {
    let app_for_events = app.clone();
    let events = Arc::new(Mutex::new(Vec::<AgentEventEnvelope>::new()));
    let events_for_sink = Arc::clone(&events);
    let sink: Arc<dyn Fn(AgentEventEnvelope) + Send + Sync> = Arc::new(move |event| {
        if let Ok(mut events) = events_for_sink.lock() {
            events.push(event.clone());
        }
        let _ = app_for_events.emit("giteam://agent-event", event);
    });
    let message = service()
        .prompt(
            &request.session_id,
            &request.run_id,
            request.prompt,
            request.images,
            sink,
        )
        .await
        .map_err(|error| error.to_string())?;
    let events = events.lock().map(|items| items.clone()).unwrap_or_default();
    Ok(AgentPromptResponse {
        run_id: request.run_id,
        message,
        events,
    })
}

#[tauri::command]
pub fn agent_abort(run_id: String) -> bool {
    service().abort(&run_id)
}

#[tauri::command]
pub fn agent_delete_session(session_id: String) -> Result<bool, String> {
    service()
        .delete_session(&session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_list_providers() -> Result<Vec<AgentProviderInfo>, String> {
    service()
        .list_providers()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_list_models() -> Result<Vec<AgentModelInfo>, String> {
    service().list_models().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_find_model(
    provider: String,
    model_id: String,
) -> Result<Option<AgentModelInfo>, String> {
    service()
        .find_model(&provider, &model_id)
        .map_err(|error| error.to_string())
}

/// 保存 provider api key 到统一 vault。key 只经过本命令内存，不进日志/事件。
#[tauri::command]
pub fn agent_save_api_key(provider: String, key: String) -> Result<(), String> {
    service()
        .save_api_key(&provider, &key)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_remove_api_key(provider: String) -> Result<bool, String> {
    service()
        .remove_api_key(&provider)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn agent_has_credential(provider: String) -> bool {
    service().has_credential(&provider)
}

/// 保存/更新自定义 provider（models.json）；api key 只进 vault。
#[tauri::command]
pub fn agent_save_custom_provider(request: CustomProviderInput) -> Result<(), String> {
    service()
        .save_custom_provider(&request)
        .map_err(|error| error.to_string())
}

/// 删除自定义供应商（models.json 整项 + vault）。
#[tauri::command]
pub fn agent_remove_custom_provider(provider: String) -> Result<bool, String> {
    service()
        .remove_custom_provider(&provider)
        .map_err(|error| error.to_string())
}

/// 连接 OpenAI Completions 兼容端点：拉 `/models` 并写入 openai-compatible 实例。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnectOpenAICompatibleResponse {
    pub provider: String,
    pub name: String,
    pub added: Vec<String>,
}

#[tauri::command]
pub fn agent_connect_openai_compatible(
    base_url: String,
    api_key: String,
    name: String,
    provider: Option<String>,
) -> Result<AgentConnectOpenAICompatibleResponse, String> {
    let (provider_id, models) = service()
        .connect_openai_compatible(&base_url, &api_key, &name, provider.as_deref())
        .map_err(|error| error.to_string())?;
    Ok(AgentConnectOpenAICompatibleResponse {
        provider: provider_id,
        name: name.trim().to_string(),
        added: models,
    })
}

/// 更新已有 provider 的 baseUrl（可选 api），用于内置供应商自定义端点。
#[tauri::command]
pub fn agent_update_provider_endpoint(
    provider: String,
    base_url: String,
    api: Option<String>,
) -> Result<(), String> {
    service()
        .update_provider_endpoint(&provider, &base_url, api.as_deref())
        .map_err(|error| error.to_string())
}

/// 用 provider 实时 `/v1/models` 刷新目录，返回新增模型 id。
/// 对抗内置快照过期（如 deepseek v4 上线后快照仍只有 chat/reasoner）。
/// 与 HTTP `/api/v1/agent/provider/refresh` 对齐，统一 `{ added }` 形状，
/// 避免前端误读 `Vec` 为 `.added` 得到 undefined。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRefreshModelsResponse {
    pub added: Vec<String>,
}

#[tauri::command]
pub fn agent_refresh_provider_models(provider: String) -> Result<AgentRefreshModelsResponse, String> {
    let added = service()
        .refresh_provider_models(&provider)
        .map_err(|error| error.to_string())?;
    Ok(AgentRefreshModelsResponse { added })
}

#[tauri::command]
pub async fn agent_set_model(
    session_id: String,
    provider: String,
    model_id: String,
) -> Result<PiSessionSummary, String> {
    service()
        .set_model(&session_id, &provider, &model_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_set_thinking(session_id: String, level: String) -> Result<(), String> {
    service()
        .set_thinking_level(&session_id, &level)
        .await
        .map_err(|error| error.to_string())
}

/// 当前待裁决的审批/提问列表（可按 session 过滤）。
#[tauri::command]
pub fn agent_list_interactions(session_id: Option<String>) -> Vec<AgentInteraction> {
    service().list_interactions(session_id.as_deref())
}

/// 回复审批（once/always/reject）或提问（answers/cancel）。
/// 首个有效回复胜出；重复/过期回复报错，前端据此清理卡片。
#[tauri::command]
pub fn agent_reply_interaction(
    interaction_id: String,
    reply: AgentInteractionReply,
) -> Result<(), String> {
    service()
        .reply_interaction(&interaction_id, reply)
        .map_err(|error| error.to_string())
}

/// 显式开启/关闭 session 级自动接受（默认关；审计事件照常发布）。
#[tauri::command]
pub async fn agent_set_auto_approve(session_id: String, enabled: bool) -> Result<(), String> {
    service()
        .set_auto_approve(&session_id, enabled)
        .await
        .map_err(|error| error.to_string())
}

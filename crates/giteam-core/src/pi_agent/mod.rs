mod browser_controller;
mod events;
mod https_egress;
mod interactions;
mod messages;
mod permissions;
mod project_memory;
mod prompt;
mod provider_sanitizer;
mod providers;
mod secrets;
mod service;
mod skills;
mod subagents;
mod tools;
mod types;

pub use browser_controller::{BrowserAction, BrowserActionResult, BrowserController};
pub use events::{
    set_ui_event_hook, AgentEvent, AgentEventEnvelope, PiEventTranslator, AGENT_EVENT_SCHEMA_VERSION,
};
pub use messages::{AgentMessage, AgentPart, AgentPromptImage, AgentRole};
pub use prompt::default_system_prompt;
pub use providers::{
    AgentModelCost, AgentModelInfo, AgentProviderInfo, CustomProviderInput, ProviderCatalog,
};
pub use secrets::{
    default_data_dir, default_pi_agent_dir, ensure_data_dir, ensure_pi_agent_dir_env,
    ensure_pi_retry_settings, ensure_repo_pi_sessions_dir, ensure_workspace_giteam_gitignore,
    legacy_platform_data_dir, legacy_repo_pi_sessions_dir, legacy_tauri_bundle_data_dir,
    migrate_legacy_tauri_data_into_canonical, migrate_session_file_bundle, pi_sessions_dir_for_repo,
    pi_sessions_root, remap_legacy_session_path, repo_sessions_key, SecretStore,
};
pub use service::{
    AgentEventReceiver, AgentEventSink, PiAgentError, PiAgentService, PiSessionConfig,
    PiSessionSummary,
};
pub use subagents::{
    build_child_system_prompt, child_timeout_secs, resolve as resolve_subagent_type,
    SubagentDefinition, SubagentHost, SubagentSpawnRequest, SubagentSpawnResult, SubagentType,
    DEFAULT_CHILD_TIMEOUT_SECS, MAX_CONCURRENT_CHILDREN, PLAN_ENABLED_TOOLS,
};
pub use skills::{
    build_skills_prompt, install_builtin_agent_skill, list_installed_agent_skills,
    remove_installed_agent_skills_by_path, save_agent_skill_source_groups, AgentInstalledSkill,
    AgentSkillSourceGroupEntry,
};
pub use types::{
    AgentInteraction, AgentInteractionReply, AgentQuestion, AgentQuestionOption, AgentSessionStatus,
    AgentTodo, AgentTodoStatus, PiRuntimeInfo, RuntimeCapabilities,
};

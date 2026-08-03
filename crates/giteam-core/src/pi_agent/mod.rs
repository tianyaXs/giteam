mod events;
mod interactions;
mod messages;
mod project_memory;
mod prompt;
mod providers;
mod secrets;
mod service;
mod skills;
mod tools;
mod types;

pub use events::{AgentEvent, AgentEventEnvelope, PiEventTranslator, AGENT_EVENT_SCHEMA_VERSION};
pub use messages::{AgentMessage, AgentPart, AgentPromptImage, AgentRole};
pub use prompt::default_system_prompt;
pub use providers::{
    AgentModelCost, AgentModelInfo, AgentProviderInfo, CustomProviderInput, ProviderCatalog,
};
pub use secrets::{
    default_data_dir, default_pi_agent_dir, ensure_data_dir, ensure_pi_agent_dir_env,
    ensure_pi_retry_settings, ensure_workspace_giteam_gitignore, legacy_platform_data_dir,
    legacy_tauri_bundle_data_dir, migrate_legacy_tauri_data_into_canonical, SecretStore,
};
pub use service::{
    AgentEventReceiver, AgentEventSink, PiAgentError, PiAgentService, PiSessionConfig,
    PiSessionSummary,
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

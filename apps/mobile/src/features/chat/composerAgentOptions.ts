import type { ComposerAgentName } from './mobileAppConfig';

/**
 * 主会话始终全工具。规划通过后端 `task(subagent_type=plan)` 子 agent 完成，
 * 不再向 create/setSessionOptions 注入 Plan 白名单。
 */
export function composerAgentSessionOptions(_agent?: ComposerAgentName): {
  enabledTools?: string[];
  appendSystemPrompt?: string;
} {
  return {};
}

/** @deprecated 白名单已迁到 Rust `subagents::PLAN_ENABLED_TOOLS` */
export const PLAN_ENABLED_TOOLS = [
  'read',
  'grep',
  'find',
  'ls',
  'question',
  'todowrite',
  'web_fetch',
  'web_search'
] as const;

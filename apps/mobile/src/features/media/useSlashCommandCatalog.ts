export type AgentSlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: 'builtin' | 'command' | 'skill';
};

/**
 * pi_agent 控制面暂未暴露 slash command 列表路由；远端目录恒为空，
 * 仅保留 hook 形态以维持调用方结构，本地内置命令由 useComposerUiController 提供。
 */
export function useSlashCommandCatalog(_params: {
  repoPath: string;
  serverUrl: string;
  token: string;
}): AgentSlashCommand[] {
  return [];
}

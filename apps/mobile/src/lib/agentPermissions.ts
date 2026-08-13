import type { AgentInteraction } from '../api/agent/types';

export type AgentPermissionReply = 'once' | 'always' | 'reject';

export type PermissionInteraction = Extract<AgentInteraction, { kind: 'permission' }>;

export type PermissionInteractionView = {
  tool: string;
  risk: string;
  target: string;
};

/** 从 permission 交互提取展示信息（bash→command，写类→path，web→url）。 */
export function describePermissionInteraction(
  interaction: PermissionInteraction
): PermissionInteractionView {
  const input = (interaction.input || {}) as Record<string, unknown>;
  const target =
    (typeof input.command === 'string' && input.command.trim()) ||
    (typeof input.url === 'string' && input.url.trim()) ||
    (typeof input.path === 'string' && input.path.trim()) ||
    (typeof input.query === 'string' && input.query.trim()) ||
    (typeof input.selector === 'string' && input.selector.trim()) ||
    '';
  return {
    tool: interaction.tool || 'tool',
    risk: interaction.risk || '',
    target
  };
}

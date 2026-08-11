import { createMobileAgentClient } from './client';
import { agentMessagesToLegacyRows, type LegacyRow } from './adapter';
import type { AgentInteraction, AgentSessionStatus } from './types';
import type { QuestionRequest, SessionStatusInfo } from '../../types';
import { toText } from '../../lib/text';

/** pi_agent 会话状态 → 手机端本地 SessionStatusInfo。 */
export function agentStatusToLegacy(status: AgentSessionStatus | string | undefined): SessionStatusInfo {
  const value = toText(status).trim();
  if (value === 'running' || value === 'waitingForInput') return { type: 'busy' };
  return { type: 'idle' };
}

/**
 * 历史消息拉取。/api/v1/agent/messages 返回全量 AgentMessage[]，
 * 不分页；游标恒为空，历史窗口完全由客户端 turn window 控制。
 */
export async function getAgentMessageRows(args: {
  baseUrl: string;
  token: string;
  sessionId: string;
}): Promise<{ items: LegacyRow[]; nextCursor: string }> {
  const client = createMobileAgentClient({ baseUrl: args.baseUrl, token: args.token });
  const messages = await client.getMessages(args.sessionId);
  return { items: agentMessagesToLegacyRows(messages), nextCursor: '' };
}

/** AgentInteraction(question) → 手机端 QuestionDock 的 QuestionRequest。 */
export function interactionToQuestionRequest(interaction: AgentInteraction): QuestionRequest | null {
  if (!interaction || interaction.kind !== 'question') return null;
  const questions = (interaction.questions || [])
    .map((q) => ({
      question: toText(q?.question),
      header: toText(q?.header) || undefined,
      options: Array.isArray(q?.options)
        ? q.options
            .map((opt) => ({ label: toText(opt?.label), description: toText(opt?.description) || undefined }))
            .filter((opt) => !!opt.label)
        : [],
      multiple: q?.multiple === true,
      custom: q?.custom !== false
    }))
    .filter((q) => q.question || q.options.length > 0);
  if (questions.length === 0) return null;
  return {
    id: interaction.id,
    sessionID: interaction.sessionId,
    questions,
    tool: interaction.toolCallId ? { messageID: '', callID: interaction.toolCallId } : undefined
  };
}

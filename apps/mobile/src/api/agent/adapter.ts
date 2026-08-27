import type { AgentMessage, AgentPart } from './types';
import { isCompactionSummaryUserText, stripInjectedSessionSummaryBlocks } from '../../lib/compactionDisplay';

/**
 * pi_agent AgentMessage/AgentPart → 手机端渲染管线消费的 legacy 行结构
 * （{ info, parts }，parts 形状对齐旧 messageParser 的读取习惯）。
 * 渲染契约（MobileTimelineItem 等）保持不变，只替换数据摄入层。
 */

export type LegacyRow = { info: Record<string, any>; parts: any[] };

/** pi 的 ls 等价旧协议 list，归入上下文工具分组。 */
function normalizeToolName(name: string): string {
  const n = String(name || '').trim();
  if (n === 'ls') return 'list';
  return n;
}

function outputToText(output: unknown): string {
  if (typeof output === 'string') return output.trim();
  if (output && typeof output === 'object') {
    const row = output as Record<string, any>;
    // pi ToolResult 序列化后常见 { content: [{ text }] } 或 { output: string }。
    if (typeof row.output === 'string' && row.output.trim()) return row.output.trim();
    if (Array.isArray(row.content)) {
      const text = row.content
        .map((item: any) => (typeof item === 'string' ? item : typeof item?.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) return text;
    }
    try {
      return JSON.stringify(output).trim();
    } catch {
      return '';
    }
  }
  return '';
}

type ToolResultIndex = Map<string, { output: string; isError: boolean }>;

function indexToolResults(messages: AgentMessage[]): ToolResultIndex {
  const index: ToolResultIndex = new Map();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'toolResult') continue;
      index.set(part.toolCallId, { output: outputToText(part.output), isError: part.isError === true });
    }
  }
  return index;
}

function toolCallToLegacyPart(part: Extract<AgentPart, { type: 'toolCall' }>, results: ToolResultIndex): any {
  const toolCallId = String(part.toolCallId || '').trim();
  const result = toolCallId ? results.get(toolCallId) : undefined;
  const status = result ? (result.isError ? 'error' : 'completed') : 'completed';
  const enriched = part as Extract<AgentPart, { type: 'toolCall' }> & {
    details?: Record<string, unknown>;
    timeline?: unknown[];
    childSessionId?: string;
    subagentType?: string;
    description?: string;
    summary?: string;
    toolCount?: number;
  };
  const details = enriched.details && typeof enriched.details === 'object' ? enriched.details : {};
  const metadata: Record<string, unknown> = { ...details };
  if (Array.isArray(enriched.timeline)) metadata.timeline = enriched.timeline;
  else if (Array.isArray((details as any).timeline)) metadata.timeline = (details as any).timeline;
  if (enriched.childSessionId) metadata.sessionId = enriched.childSessionId;
  if (enriched.subagentType) metadata.subagentType = enriched.subagentType;
  if (enriched.description) metadata.description = enriched.description;
  if (enriched.summary) metadata.summary = enriched.summary;
  if (enriched.toolCount != null) metadata.toolCount = enriched.toolCount;
  return {
    id: toolCallId || `toolcall:${part.toolName}`,
    callID: toolCallId || undefined,
    type: 'tool',
    tool: normalizeToolName(part.toolName),
    state: {
      status,
      input: part.input && typeof part.input === 'object' ? part.input : {},
      output: result?.output || enriched.summary || '',
      error: result?.isError ? result.output || 'tool failed' : undefined,
      metadata
    }
  };
}

/**
 * 单条消息转换。`results` 缺省时 toolCall 视为无结果（历史快照请用
 * agentMessagesToLegacyRows 以获得正确的 toolResult 关联）。
 */
export function agentMessageToLegacyRow(
  message: AgentMessage,
  results?: ToolResultIndex,
  opts?: { live?: boolean }
): LegacyRow | null {
  const id = String(message.id || '').trim();
  if (!id) return null;
  const role = String(message.role || '').trim();
  const created = Number(message.createdAtMs || 0) || Date.now();
  const parts: any[] = [];
  let textIndex = 0;
  let reasoningIndex = 0;

  for (const part of message.parts || []) {
    if (part.type === 'text') {
      const text = String(part.text || '');
      if (!text.trim()) continue;
      if (isCompactionSummaryUserText(text)) {
        parts.push({ id: `${id}:compaction`, type: 'compaction' });
        continue;
      }
      const displayText = stripInjectedSessionSummaryBlocks(text);
      if (!displayText.trim()) continue;
      parts.push({ id: `${id}:text:${textIndex++}`, type: 'text', text: displayText });
      continue;
    }
    if (part.type === 'reasoning') {
      const text = String(part.text || '');
      if (!text.trim()) continue;
      parts.push({
        id: `${id}:reasoning:${reasoningIndex++}`,
        type: 'reasoning',
        text,
        ...(opts?.live ? {} : { time: { end: created } })
      });
      continue;
    }
    if (part.type === 'image') {
      const mime = String(part.mimeType || '').trim();
      const data = String(part.data || '').trim();
      if (!data) continue;
      parts.push({
        id: `${id}:image:${parts.length}`,
        type: 'file',
        mime: mime || 'image/png',
        url: `data:${mime || 'image/png'};base64,${data}`
      });
      continue;
    }
    if (part.type === 'toolCall') {
      parts.push(toolCallToLegacyPart(part, results || new Map()));
      continue;
    }
    if (part.type === 'custom') {
      const customType = String(part.customType || '').toLowerCase();
      if (customType.includes('compaction')) parts.push({ id: `${id}:compaction`, type: 'compaction' });
      continue;
    }
    if (part.type === 'redactedReasoning') {
      // OpenAI Responses 系（gpt5.6 等）的加密思考：映射为 redacted 占位 reasoning part，
      // 否则纯思考轮转换后 parts 为空，时间线无正文（不再注入说明性 fallback 文案）。
      // 对齐桌面端 App.tsx 的 { type: "reasoning", redacted: true } 处理。
      parts.push({
        id: `${id}:redacted:${parts.length}`,
        type: 'reasoning',
        text: '',
        redacted: true,
        ...(opts?.live ? {} : { time: { end: created } })
      });
      continue;
    }
    // toolResult：由 indexToolResults 关联进 toolCall。
  }

  const info: Record<string, any> = {
    id,
    role,
    time: {
      created: created,
      ...(opts?.live ? {} : { completed: created })
    }
  };
  return { info, parts };
}

/** 历史快照转换：跳过 role=tool/system/custom 行（toolResult 已关联进 assistant 的 toolCall）。 */
export function agentMessagesToLegacyRows(messages: AgentMessage[]): LegacyRow[] {
  const rows = Array.isArray(messages) ? messages : [];
  const results = indexToolResults(rows);
  const out: LegacyRow[] = [];
  for (const message of rows) {
    const role = String(message?.role || '');
    if (role !== 'user' && role !== 'assistant') continue;
    const row = agentMessageToLegacyRow(message, results);
    if (row) out.push(row);
  }
  out.sort((a, b) => (Number(a.info?.time?.created || 0) - Number(b.info?.time?.created || 0)) || String(a.info?.id || '').localeCompare(String(b.info?.id || '')));
  return out;
}

/** 流式文本/思考 delta（partial 快照语义）对应的 legacy part。 */
export function streamTextPart(messageId: string, kind: 'text' | 'reasoning', index: number, text: string): any {
  return {
    id: `${messageId}:${kind}:${index}`,
    type: kind,
    text
  };
}

/** 流式工具事件对应的 legacy tool part。 */
export function streamToolPart(
  toolCallId: string,
  toolName: string,
  state: {
    status: string;
    input?: unknown;
    output?: unknown;
    metadata?: Record<string, unknown>;
  }
): any {
  const output = outputToText(state.output);
  return {
    id: toolCallId,
    callID: toolCallId,
    type: 'tool',
    tool: normalizeToolName(toolName),
    state: {
      status: state.status,
      input: state.input && typeof state.input === 'object' ? state.input : {},
      output,
      error: state.status === 'error' ? output || 'tool failed' : undefined,
      metadata: state.metadata && typeof state.metadata === 'object' ? state.metadata : {}
    }
  };
}

/**
 * Giteam Agent API（pi_agent）移动端类型定义。
 * 与桌面端 apps/desktop/src/lib/agent/client.ts 保持同一 wire 契约。
 */

export type AgentSessionStatus = 'idle' | 'running' | 'waitingForInput' | 'aborted' | 'failed';

export type AgentRuntimeInfo = {
  backend: 'pi';
  transport: 'inProcess';
  sdkRevision: string;
  capabilities: {
    sessions: boolean;
    streaming: boolean;
    abort: boolean;
    tools: boolean;
    reasoning: boolean;
    approvals: boolean;
    questions: boolean;
    skills: boolean;
    extensions: boolean;
    mcp: boolean;
  };
};

export type AgentSessionSummary = {
  sessionId: string;
  repoPath: string;
  provider: string;
  model: string;
  messageCount: number;
  updatedAtMs: number;
  /** 首条用户消息派生的标题；空会话缺省。 */
  title?: string;
  /** `"primary"` | `"subagent"`。 */
  sessionKind?: string;
  /** 子 agent 的父会话；主会话缺省。 */
  parentSessionId?: string;
  /** 子 agent 对应的父 task toolCallId。 */
  parentToolCallId?: string;
};

/** 主会话列表用：排除 task/subagent 子会话。 */
export function isPrimaryAgentSession(summary: Pick<AgentSessionSummary, 'sessionKind' | 'parentSessionId'>): boolean {
  const kind = String(summary.sessionKind || '').trim().toLowerCase();
  if (kind === 'subagent') return false;
  if (String(summary.parentSessionId || '').trim()) return false;
  return true;
}

export type AgentModelCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type AgentModelInfo = {
  provider: string;
  modelId: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  supportsXhigh?: boolean;
  imageInput: boolean;
  contextWindow: number;
  maxTokens: number;
  cost?: AgentModelCost;
  hasCredential: boolean;
};

export type AgentProviderInfo = {
  provider: string;
  name?: string;
  modelCount: number;
  hasCredential: boolean;
  removable?: boolean;
  models: AgentModelInfo[];
};

/** 桌面端推送的模型启用状态（mobile-model-state.json），供手机端只读同步。
 *  桌面端按 enabled/hidden/connected 过滤后写入；旧桌面端或未推送时整体为 null。
 *  Composer 只信 enabled/available，不再回退 listProviders 全量。 */
export type MobileModelState = {
  repoId?: string;
  repoPath?: string;
  /** 已启用且未隐藏且供应商已连接的模型 ref（"provider/modelId"）。 */
  availableModels?: string[];
  /** ref → 显示名。 */
  modelLabels?: Record<string, string>;
  enabledModels?: string[];
  hiddenModels?: string[];
  activeModel?: string;
  updatedAt?: number;
};

export type AgentQuestionOption = {
  label: string;
  description?: string;
};

export type AgentQuestion = {
  question: string;
  header?: string;
  options: AgentQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

/** 等待用户裁决的交互请求（permission/question）。input 已脱敏。 */
export type AgentInteraction =
  | {
      kind: 'permission';
      id: string;
      sessionId: string;
      runId: string;
      toolCallId: string;
      tool: string;
      risk: string;
      input: unknown;
      createdAtMs: number;
    }
  | {
      kind: 'question';
      id: string;
      sessionId: string;
      runId: string;
      toolCallId: string;
      questions: AgentQuestion[];
      createdAtMs: number;
    };

/** 客户端对交互的回复。once/always/reject 仅 permission；answers/cancel 仅 question。 */
export type AgentInteractionReply =
  | { decision: 'once' }
  | { decision: 'always' }
  | { decision: 'reject' }
  | { decision: 'answers'; answers: string[][] }
  | { decision: 'cancel' };

export type AgentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'redactedReasoning' }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'toolCall'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'toolResult'; toolCallId: string; toolName: string; output: unknown; isError: boolean }
  | { type: 'custom'; customType: string; content: string; details: unknown };

export type AgentMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'custom';
  createdAtMs: number;
  parts: AgentPart[];
};

export type AgentEvent = {
  schemaVersion: number;
  eventId: string;
  sequence: number;
  repoPath: string;
  sessionId: string;
  runId: string | null;
  timestampMs: number;
  event: {
    type: string;
    messageId?: string;
    delta?: string;
    /** 块级 partial 快照（replace 语义，优先于 delta 拼接）。 */
    partial?: string;
    /** message.completed 为 AgentMessage；runtime.warning 为 string。 */
    message?: AgentMessage | string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
    isError?: boolean;
    status?: AgentSessionStatus;
    error?: string | null;
    index?: number;
    phase?: string;
    attempt?: number;
    maxAttempts?: number;
    delayMs?: number;
    success?: boolean | null;
    /** interaction.requested 为 AgentInteraction。 */
    interaction?: AgentInteraction;
    /** interaction.resolved 携带 id/resolution/automatic。 */
    id?: string;
    resolution?: string;
    automatic?: boolean;
    /** subagent.* */
    parentToolCallId?: string;
    childSessionId?: string;
    childRunId?: string;
    subagentType?: string;
    description?: string;
    toolCount?: number;
    currentToolName?: string;
    elapsedMs?: number;
    summary?: string;
    event?: AgentEvent['event'];
  };
};

export type CreateAgentSessionInput = {
  repoPath: string;
  sessionDir?: string;
  sessionPath?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  enabledTools?: string[];
  extensionPaths?: string[];
  noSession?: boolean;
  /** Thinking level：off/minimal/low/medium/high/xhigh。 */
  thinking?: string;
  maxToolIterations?: number;
};

export type AgentPromptImage = {
  mimeType: string;
  /** 纯 base64；大图请改用 path。 */
  data?: string;
  path?: string;
};

export type PromptAgentInput = {
  sessionId: string;
  runId?: string;
  prompt: string;
  images?: AgentPromptImage[];
};

export type AgentPromptResult = {
  runId: string;
  message: AgentMessage;
  events: AgentEvent[];
};

export type AgentEventSubscription = {
  close: () => void;
};

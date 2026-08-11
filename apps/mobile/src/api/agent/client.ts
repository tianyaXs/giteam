import EventSource from 'react-native-sse';
import { NO_AUTH_TOKEN } from '../controlApi';
import type {
  AgentEvent,
  AgentEventSubscription,
  AgentInteraction,
  AgentInteractionReply,
  AgentMessage,
  AgentModelInfo,
  AgentPromptResult,
  AgentProviderInfo,
  AgentRuntimeInfo,
  AgentSessionSummary,
  CreateAgentSessionInput,
  MobileModelState,
  PromptAgentInput
} from './types';

export type MobileAgentClientConfig = {
  baseUrl: string;
  token: string;
};

const JSON_REQUEST_TIMEOUT_MS = 12000;
/** 长会话消息 JSON 较大，短超时易误判失败。 */
const MESSAGES_REQUEST_TIMEOUT_MS = 90000;

function normalizeBaseUrl(input: string): string {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `http://${raw}`;
}

function newRunId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeApiError(value: unknown, fallback: string): Error {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = (value as { error?: unknown }).error;
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}

export type MobileAgentClient = {
  runtimeInfo(): Promise<AgentRuntimeInfo>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionSummary>;
  listSessions(): Promise<AgentSessionSummary[]>;
  getSession(sessionId: string): Promise<AgentSessionSummary>;
  deleteSession(sessionId: string): Promise<boolean>;
  getMessages(sessionId: string): Promise<AgentMessage[]>;
  /** 阻塞到 run 完成；流式进度走 subscribeEvents。 */
  prompt(input: PromptAgentInput): Promise<AgentPromptResult>;
  abort(runId: string): Promise<boolean>;
  listInteractions(sessionId?: string): Promise<AgentInteraction[]>;
  replyInteraction(interactionId: string, reply: AgentInteractionReply): Promise<void>;
  setAutoApprove(sessionId: string, enabled: boolean): Promise<void>;
  setModel(sessionId: string, provider: string, modelId: string): Promise<AgentSessionSummary>;
  setThinking(sessionId: string, level: string): Promise<void>;
  setSessionOptions(
    sessionId: string,
    input: { enabledTools?: string[]; appendSystemPrompt?: string }
  ): Promise<AgentSessionSummary>;
  listProviders(): Promise<AgentProviderInfo[]>;
  listModels(): Promise<AgentModelInfo[]>;
  /** 桌面端推送的模型启用状态（null = 未推送/旧桌面端，调用方回退 listProviders）。 */
  getMobileModelState(): Promise<MobileModelState | null>;
  /** 写回模型开关变更（双向同步）。后端合并 enabled/hidden 进 state 文件并刷新 updatedAt，
   *  返回合并后的完整 state。桌面端轮询感知后重算 availableModels 回推。 */
  setMobileModelVisibility(input: { enabledModels: string[]; hiddenModels: string[] }): Promise<MobileModelState>;
  subscribeEvents(
    sessionId: string,
    runId: string,
    onEvent: (event: AgentEvent) => void,
    onError?: (error: unknown) => void
  ): AgentEventSubscription;
  /** 生成 runId，便于在 prompt 前先订阅事件流。 */
  newRunId(): string;
};

export function createMobileAgentClient(config: MobileAgentClientConfig): MobileAgentClient {
  const root = normalizeBaseUrl(config.baseUrl);
  const authHeaders = (): Record<string, string> => {
    const tk = (config.token || '').trim();
    if (!tk || tk === NO_AUTH_TOKEN) return {};
    return { Authorization: `Bearer ${tk}` };
  };

  const request = async <T>(
    path: string,
    init: RequestInit = {},
    timeoutMs: number = JSON_REQUEST_TIMEOUT_MS
  ): Promise<T> => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = ctrl && timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const response = await fetch(`${root}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...authHeaders(), ...(init.headers || {}) },
        ...(ctrl ? { signal: ctrl.signal } : {})
      });
      const text = await response.text();
      const value = text ? JSON.parse(text) : null;
      if (!response.ok) throw normalizeApiError(value, `Agent API request failed (${response.status})`);
      return value as T;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  return {
    newRunId,
    runtimeInfo: () => request<AgentRuntimeInfo>('/api/v1/agent/runtime'),
    createSession: (input) => request<AgentSessionSummary>('/api/v1/agent/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }),
    listSessions: () => request<AgentSessionSummary[]>('/api/v1/agent/session'),
    getSession: (sessionId) =>
      request<AgentSessionSummary>(`/api/v1/agent/session?sessionId=${encodeURIComponent(sessionId)}`),
    deleteSession: async (sessionId) =>
      (await request<{ deleted: boolean }>(
        `/api/v1/agent/session?sessionId=${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' }
      )).deleted,
    getMessages: (sessionId) =>
      request<AgentMessage[]>(
        `/api/v1/agent/messages?sessionId=${encodeURIComponent(sessionId)}`,
        {},
        MESSAGES_REQUEST_TIMEOUT_MS
      ),
    prompt: (input) => request<AgentPromptResult>('/api/v1/agent/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, runId: input.runId?.trim() || newRunId() })
      // 不传超时：prompt 阻塞到 run 完成，可能长达数分钟。
    }, 0),
    abort: async (runId) => (await request<{ ok: boolean }>('/api/v1/agent/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId })
    })).ok,
    listInteractions: (sessionId) => {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      return request<AgentInteraction[]>(`/api/v1/agent/interactions${query}`);
    },
    replyInteraction: (interactionId, reply) => request<void>('/api/v1/agent/interaction/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interactionId, reply })
    }),
    setAutoApprove: (sessionId, enabled) => request<void>('/api/v1/agent/auto-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, enabled })
    }),
    setModel: (sessionId, provider, modelId) => request<AgentSessionSummary>('/api/v1/agent/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, provider, modelId })
    }),
    setThinking: (sessionId, level) => request<void>('/api/v1/agent/thinking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, level })
    }),
    setSessionOptions: (sessionId, input) => request<AgentSessionSummary>('/api/v1/agent/session-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...input })
    }),
    listProviders: () => request<AgentProviderInfo[]>('/api/v1/agent/providers'),
    listModels: () => request<AgentModelInfo[]>('/api/v1/agent/models'),
    getMobileModelState: () => request<MobileModelState | null>('/api/v1/admin/mobile/model-state'),
    setMobileModelVisibility: (input) => request<MobileModelState>('/api/v1/admin/mobile/model-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }),
    subscribeEvents(sessionId, runId, onEvent, onError) {
      const url = `${root}/api/v1/agent/stream?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}`;
      const source = new EventSource<'agent' | 'ready'>(url, {
        headers: { ...authHeaders() },
        // 长连接保活由服务端 20s 心跳负责，这里禁用客户端过早断开。
        pollingInterval: 0
      });
      source.addEventListener('agent', (event) => {
        const data = typeof event.data === 'string' ? event.data : '';
        if (!data) return;
        try {
          const payload = JSON.parse(data) as AgentEvent;
          if (payload.sessionId === sessionId && payload.runId === runId && payload.event?.type) {
            onEvent(payload);
          }
        } catch {
          // 忽略非稳定协议的帧，连接保持可用。
        }
      });
      source.addEventListener('error', (event) => {
        if (onError) onError(event);
      });
      return { close: () => source.close() };
    }
  };
}

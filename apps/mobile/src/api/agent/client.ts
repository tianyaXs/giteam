import EventSource from 'react-native-sse';
import { getActiveDeviceId } from '../connectionContext';
import { NO_AUTH_TOKEN } from '../controlApi';
import {
  createAgentApiError,
  notifyCloudSessionInvalidation
} from './errors';
import type {
  AgentEvent,
  AgentEventSubscription,
  AgentInteraction,
  AgentInteractionReply,
  AgentMessage,
  AgentModelInfo,
  AgentPromptResult,
  AgentProviderInfo,
  AgentSteerOutcome,
  AgentRunStatus,
  AgentRuntimeInfo,
  AgentSessionSummary,
  CreateAgentSessionInput,
  MobileModelsResponse,
  MobileModelState,
  PromptAgentInput
} from './types';

export type MobileAgentClientConfig = {
  baseUrl: string;
  token: string;
  deviceId?: string;
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

export type MobileAgentClient = {
  runtimeInfo(): Promise<AgentRuntimeInfo>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionSummary>;
  listSessions(): Promise<AgentSessionSummary[]>;
  getSession(sessionId: string): Promise<AgentSessionSummary>;
  /** 查询 run 是否仍在服务端 active_runs（SSE 对账用，勿与 interaction-idle 混淆）。 */
  getRunStatus(runId: string): Promise<AgentRunStatus>;
  deleteSession(sessionId: string): Promise<boolean>;
  getMessages(sessionId: string): Promise<AgentMessage[]>;
  /** 阻塞到 run 完成；流式进度走 subscribeEvents。 */
  prompt(input: PromptAgentInput): Promise<AgentPromptResult>;
  /** run 进行中排队转向（当前 turn 完成后自动续跑）；idle 表示无活跃 run。 */
  steer(sessionId: string, message: string): Promise<AgentSteerOutcome>;
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
  /** Composer 主路径：已过滤的轻量模型清单。 */
  listMobileModels(): Promise<MobileModelsResponse>;
  /** 兼容旧 Host：完整 model-state（新路径请用 listMobileModels）。 */
  getMobileModelState(): Promise<MobileModelState | null>;
  /** 写回模型开关变更（双向同步）。 */
  setMobileModelVisibility(input: { enabledModels: string[]; hiddenModels: string[] }): Promise<MobileModelState>;
  subscribeEvents(
    sessionId: string,
    runId: string,
    onEvent: (event: AgentEvent) => void,
    onError?: (error: unknown) => void,
    options?: { afterSeq?: number }
  ): AgentEventSubscription;
  /** 生成 runId，便于在 prompt 前先订阅事件流。 */
  newRunId(): string;
};

export function createMobileAgentClient(config: MobileAgentClientConfig): MobileAgentClient {
  const root = normalizeBaseUrl(config.baseUrl);
  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    const tk = (config.token || '').trim();
    if (tk && tk !== NO_AUTH_TOKEN) headers.Authorization = `Bearer ${tk}`;
    const deviceId = String(config.deviceId || getActiveDeviceId() || '').trim();
    if (deviceId) headers['X-Giteam-Device-Id'] = deviceId;
    return headers;
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
      let value: unknown = null;
      if (text) {
        try {
          value = JSON.parse(text);
        } catch {
          value = { message: text };
        }
      }
      if (!response.ok) {
        const err = createAgentApiError(
          response.status,
          value,
          `Agent API request failed (${response.status})`
        );
        notifyCloudSessionInvalidation(err);
        throw err;
      }
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
    getRunStatus: (runId) =>
      request<AgentRunStatus>(`/api/v1/agent/run?runId=${encodeURIComponent(runId)}`),
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
    steer: (sessionId, message) => request<AgentSteerOutcome>('/api/v1/agent/steer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message })
    }),
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
    listMobileModels: () => request<MobileModelsResponse>('/api/v1/mobile/models'),
    getMobileModelState: () => request<MobileModelState | null>('/api/v1/admin/mobile/model-state'),
    setMobileModelVisibility: (input) => request<MobileModelState>('/api/v1/admin/mobile/model-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }),
    subscribeEvents(sessionId, runId, onEvent, onError, options) {
      const afterSeq = Math.max(0, Math.floor(Number(options?.afterSeq) || 0));
      const afterQs = afterSeq > 0 ? `&afterSeq=${encodeURIComponent(String(afterSeq))}` : '';
      const url = `${root}/api/v1/agent/stream?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}${afterQs}`;
      const headers: Record<string, string> = { ...authHeaders() };
      // 与 query afterSeq 双写：标准 SSE 客户端可走 Last-Event-ID。
      if (afterSeq > 0) headers['Last-Event-ID'] = String(afterSeq);
      const source = new EventSource<'agent' | 'ready'>(url, {
        headers,
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

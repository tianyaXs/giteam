import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Giteam Agent API 的稳定客户端。
 *
 * 这里故意只暴露 Giteam 自己的领域协议。React 不应依赖 Pi SDK 的内部
 * 类型，也不应再拼接 provider runtime 的 URL。桌面端使用 Tauri command，
 * Web/移动端使用 Control Server 的同一组 /api/v1/agent 路由。
 */

export type AgentSessionStatus = "idle" | "running" | "waitingForInput" | "aborted" | "failed";

export type AgentRuntimeInfo = {
  backend: "pi";
  transport: "inProcess";
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
};

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
  /** 是否支持 xhigh 推理档。 */
  supportsXhigh?: boolean;
  imageInput: boolean;
  contextWindow: number;
  maxTokens: number;
  cost?: AgentModelCost;
  /** 是否已配置凭据（不暴露凭据本身）。 */
  hasCredential: boolean;
};

export type AgentProviderInfo = {
  provider: string;
  modelCount: number;
  hasCredential: boolean;
  models: AgentModelInfo[];
};

export type CustomProviderInput = {
  provider: string;
  name: string;
  baseUrl: string;
  /** Pi api 适配器 id，缺省 openai-completions。 */
  api?: string;
  modelId: string;
  modelName?: string;
  headers?: Record<string, string>;
  /** 只写 vault，不落 models.json。 */
  apiKey?: string;
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
      kind: "permission";
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
      kind: "question";
      id: string;
      sessionId: string;
      runId: string;
      toolCallId: string;
      questions: AgentQuestion[];
      createdAtMs: number;
    };

/** 客户端对交互的回复。once/always/reject 仅 permission；answers/cancel 仅 question。 */
export type AgentInteractionReply =
  | { decision: "once" }
  | { decision: "always" }
  | { decision: "reject" }
  | { decision: "answers"; answers: string[][] }
  | { decision: "cancel" };

export type AgentPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "redactedReasoning" }
  | { type: "image"; mimeType: string; data: string }
  | { type: "toolCall"; toolCallId: string; toolName: string; input: unknown }
  | { type: "toolResult"; toolCallId: string; toolName: string; output: unknown; isError: boolean }
  | { type: "custom"; customType: string; content: string; details: unknown };

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "custom";
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
    success?: boolean | null;
    /** interaction.requested 为 AgentInteraction。 */
    interaction?: AgentInteraction;
    /** interaction.resolved 携带 id/分辨率/是否自动。 */
    id?: string;
    resolution?: string;
    automatic?: boolean;
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
  /** 单次任务最大工具调用轮数；省略/undefined = 不限制。 */
  maxToolIterations?: number;
};

export type AgentPromptImage = {
  mimeType: string;
  /** 纯 base64；大图请改用 path。 */
  data?: string;
  /** 本地图片路径（推荐）。 */
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

export type AgentClient = {
  runtimeInfo(): Promise<AgentRuntimeInfo>;
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionSummary>;
  listSessions(): Promise<AgentSessionSummary[]>;
  getSession(sessionId: string): Promise<AgentSessionSummary>;
  getMessages(sessionId: string): Promise<AgentMessage[]>;
  prompt(input: PromptAgentInput): Promise<AgentPromptResult>;
  abort(runId: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<boolean>;
  listProviders(): Promise<AgentProviderInfo[]>;
  listModels(): Promise<AgentModelInfo[]>;
  findModel(provider: string, modelId: string): Promise<AgentModelInfo | null>;
  /** 保存 provider api key 到统一 vault；key 只经过本调用内存，不进日志。 */
  saveApiKey(provider: string, key: string): Promise<void>;
  removeApiKey(provider: string): Promise<boolean>;
  hasCredential(provider: string): Promise<boolean>;
  saveCustomProvider(input: CustomProviderInput): Promise<void>;
  /** 用 provider 实时 /v1/models 刷新目录，返回新增模型 id（对抗内置快照过期）。 */
  refreshProviderModels(provider: string): Promise<string[]>;
  setModel(sessionId: string, provider: string, modelId: string): Promise<AgentSessionSummary>;
  setThinking(sessionId: string, level: string): Promise<void>;
  /** 当前待裁决的审批/提问列表（可按 session 过滤）。 */
  listInteractions(sessionId?: string): Promise<AgentInteraction[]>;
  /** 回复审批（once/always/reject）或提问（answers/cancel）。首个有效回复胜出。 */
  replyInteraction(interactionId: string, reply: AgentInteractionReply): Promise<void>;
  /** 显式开启/关闭 session 级自动接受（默认关；审计事件照常发布）。 */
  setAutoApprove(sessionId: string, enabled: boolean): Promise<void>;
  subscribeEvents(sessionId: string, runId: string, onEvent: (event: AgentEvent) => void): Promise<AgentEventSubscription>;
};

const AGENT_EVENT_NAME = "giteam://agent-event";

function newRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function withRunId(input: PromptAgentInput): PromptAgentInput & { runId: string } {
  return { ...input, runId: input.runId?.trim() || newRunId() };
}

function normalizeApiError(value: unknown, fallback: string): Error {
  if (value && typeof value === "object" && "error" in value) {
    const message = (value as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}

function createTauriAgentClient(): AgentClient {
  return {
    runtimeInfo: () => invoke<AgentRuntimeInfo>("agent_runtime_info"),
    createSession: (input) => invoke<AgentSessionSummary>("agent_create_session", { request: input }),
    listSessions: () => invoke<AgentSessionSummary[]>("agent_list_sessions"),
    getSession: (sessionId) => invoke<AgentSessionSummary>("agent_get_session", { sessionId }),
    getMessages: (sessionId) => invoke<AgentMessage[]>("agent_get_session_messages", { sessionId }),
    prompt: (input) => invoke<AgentPromptResult>("agent_prompt", { request: withRunId(input) }),
    abort: (runId) => invoke<boolean>("agent_abort", { runId }),
    deleteSession: (sessionId) => invoke<boolean>("agent_delete_session", { sessionId }),
    listProviders: () => invoke<AgentProviderInfo[]>("agent_list_providers"),
    listModels: () => invoke<AgentModelInfo[]>("agent_list_models"),
    findModel: (provider, modelId) =>
      invoke<AgentModelInfo | null>("agent_find_model", { provider, modelId }),
    saveApiKey: (provider, key) => invoke<void>("agent_save_api_key", { provider, key }),
    removeApiKey: (provider) => invoke<boolean>("agent_remove_api_key", { provider }),
    hasCredential: (provider) => invoke<boolean>("agent_has_credential", { provider }),
    saveCustomProvider: (input) => invoke<void>("agent_save_custom_provider", { request: input }),
    refreshProviderModels: async (provider) =>
      (await invoke<{ added: string[] }>("agent_refresh_provider_models", { provider })).added,
    setModel: (sessionId, provider, modelId) =>
      invoke<AgentSessionSummary>("agent_set_model", { sessionId, provider, modelId }),
    setThinking: (sessionId, level) => invoke<void>("agent_set_thinking", { sessionId, level }),
    listInteractions: (sessionId) =>
      invoke<AgentInteraction[]>("agent_list_interactions", { sessionId: sessionId ?? null }),
    replyInteraction: (interactionId, reply) =>
      invoke<void>("agent_reply_interaction", { interactionId, reply }),
    setAutoApprove: (sessionId, enabled) =>
      invoke<void>("agent_set_auto_approve", { sessionId, enabled }),
    async subscribeEvents(sessionId, runId, onEvent) {
      const unlisten: UnlistenFn = await listen<AgentEvent>(AGENT_EVENT_NAME, (event) => {
        if (event.payload.sessionId !== sessionId || event.payload.runId !== runId) return;
        onEvent(event.payload);
      });
      return { close: unlisten };
    },
  };
}

function createHttpAgentClient(baseUrl: string, token?: string): AgentClient {
  const root = baseUrl.replace(/\/+$/, "");
  const headers = () => ({
    Accept: "application/json",
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  });
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${root}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) },
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw normalizeApiError(value, `Agent API request failed (${response.status})`);
    return value as T;
  };

  return {
    runtimeInfo: () => request<AgentRuntimeInfo>("/api/v1/agent/runtime"),
    createSession: (input) => request<AgentSessionSummary>("/api/v1/agent/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
    listSessions: () => request<AgentSessionSummary[]>("/api/v1/agent/session"),
    getSession: (sessionId) => request<AgentSessionSummary>(`/api/v1/agent/session?sessionId=${encodeURIComponent(sessionId)}`),
    getMessages: (sessionId) => request<AgentMessage[]>(`/api/v1/agent/messages?sessionId=${encodeURIComponent(sessionId)}`),
    prompt: (input) => request<AgentPromptResult>("/api/v1/agent/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withRunId(input)),
    }),
    abort: async (runId) => (await request<{ ok: boolean }>("/api/v1/agent/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    })).ok,
    deleteSession: async (sessionId) => (await request<{ deleted: boolean }>(`/api/v1/agent/session?sessionId=${encodeURIComponent(sessionId)}`, { method: "DELETE" })).deleted,
    listProviders: () => request<AgentProviderInfo[]>("/api/v1/agent/providers"),
    listModels: () => request<AgentModelInfo[]>("/api/v1/agent/models"),
    async findModel(provider, modelId) {
      const models = await request<AgentModelInfo[]>("/api/v1/agent/models");
      return models.find((model) => model.provider === provider && model.modelId === modelId) ?? null;
    },
    saveApiKey: (provider, key) => request<void>("/api/v1/agent/credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey: key }),
    }),
    removeApiKey: async (provider) => (await request<{ removed: boolean }>(`/api/v1/agent/credential?provider=${encodeURIComponent(provider)}`, { method: "DELETE" })).removed,
    hasCredential: async (provider) => (await request<{ hasCredential: boolean }>(`/api/v1/agent/credential?provider=${encodeURIComponent(provider)}`)).hasCredential,
    saveCustomProvider: (input) => request<void>("/api/v1/agent/provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
    refreshProviderModels: async (provider) => (await request<{ added: string[] }>("/api/v1/agent/provider/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    })).added,
    setModel: (sessionId, provider, modelId) => request<AgentSessionSummary>("/api/v1/agent/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, provider, modelId }),
    }),
    setThinking: (sessionId, level) => request<void>("/api/v1/agent/thinking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, level }),
    }),
    listInteractions: async (sessionId) => {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      return request<AgentInteraction[]>(`/api/v1/agent/interactions${query}`);
    },
    replyInteraction: (interactionId, reply) => request<void>("/api/v1/agent/interaction/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactionId, reply }),
    }),
    setAutoApprove: (sessionId, enabled) => request<void>("/api/v1/agent/auto-approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, enabled }),
    }),
    async subscribeEvents(sessionId, runId, onEvent) {
      const controller = new AbortController();
      let buffer = "";
      const consume = async () => {
        const response = await fetch(`${root}/api/v1/agent/stream?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId)}`, {
          headers: { ...headers(), Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Agent event stream failed (${response.status})`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            try {
              const payload = JSON.parse(data) as AgentEvent;
              if (payload.sessionId === sessionId && payload.runId === runId && payload.event?.type) onEvent(payload);
            } catch {
              // 忽略不属于稳定 Agent 协议的 SSE 帧，连接仍保持可用。
            }
          }
        }
      };
      void consume().catch((error: unknown) => {
        if (!controller.signal.aborted) console.error("Agent event stream stopped", error);
      });
      return { close: () => controller.abort() };
    },
  };
}

/** 桌面 Tauri 主链路使用的客户端。Web/移动端显式传入 Control Server URL。 */
export function createAgentClient(options?: { controlBaseUrl?: string; token?: string }): AgentClient {
  return options?.controlBaseUrl ? createHttpAgentClient(options.controlBaseUrl, options.token) : createTauriAgentClient();
}

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 本地保留的运行失败信息；服务端历史不一定返回失败事件。 */
  error?: string;
  attachments?: Array<{ id: string; kind: "image" | "file"; uri: string; mime?: string; filename?: string }>;
};

export type AgentChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentChatMessage[];
  turnStart: number;
  loaded: boolean;
  nextCursor?: string;
  hasMore?: boolean;
};

export type ChatSessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  archivedAt?: number;
};

export type AgentSessionMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AgentDetailedPart = Record<string, unknown> & { type?: string };

export type AgentDetailedMessage = {
  info?: Record<string, unknown>;
  parts?: AgentDetailedPart[];
};

export type AgentTodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
};

export type AgentMessageWindowCacheEntry = {
  limit: number;
  mapped: AgentChatMessage[];
  turnCount: number;
  nextCursor?: string;
  hasMore: boolean;
  fetchedAt: number;
};

export type AgentMessagePageCacheEntry = {
  before: string;
  limit: number;
  items: AgentChatMessage[];
  detailsById: Record<string, AgentDetailedMessage>;
  nextCursor?: string;
  hasMore: boolean;
  fetchedAt: number;
};

const AGENT_SESSION_TITLE_MAX = 42;

function compactSessionTitleText(input?: string): string {
  return String(input || "").replace(/\s+/g, " ").trim();
}

export function clipAgentSessionTitle(input?: string): string {
  const trimmed = compactSessionTitleText(input);
  if (!trimmed) return "";
  return trimmed.length > AGENT_SESSION_TITLE_MAX ? `${trimmed.slice(0, AGENT_SESSION_TITLE_MAX - 1)}…` : trimmed;
}

function makeSessionId(): string {
  return Math.random().toString(16).slice(2, 14);
}

export function toAgentSessionTitle(prompt?: string, indexHint?: number): string {
  const clipped = clipAgentSessionTitle(prompt);
  if (!clipped) return `New Session ${indexHint ?? ""}`.trim();
  return clipped;
}

export function newAgentSession(seedPrompt?: string, indexHint?: number): AgentChatSession {
  const now = Date.now();
  return {
    id: `sess-${makeSessionId()}`,
    title: toAgentSessionTitle(seedPrompt, indexHint),
    createdAt: now,
    updatedAt: now,
    messages: [],
    turnStart: 0,
    loaded: true,
    nextCursor: undefined
  };
}

export function agentSessionFromSummary(summary: ChatSessionSummary, indexHint?: number): AgentChatSession {
  return {
    id: summary.id,
    title: toAgentSessionTitle(summary.title || "", indexHint),
    createdAt: summary.createdAt || Date.now(),
    updatedAt: summary.updatedAt || summary.createdAt || Date.now(),
    messages: [],
    turnStart: 0,
    loaded: false,
    nextCursor: undefined
  };
}

export function compareAgentSessionActivity(
  a: Pick<ChatSessionSummary, "id" | "createdAt" | "updatedAt">,
  b: Pick<ChatSessionSummary, "id" | "createdAt" | "updatedAt">
): number {
  const byUpdated = (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  if (byUpdated !== 0) return byUpdated;
  const byCreated = (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0);
  if (byCreated !== 0) return byCreated;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export function isArchivedChatSessionSummary(
  summary: Pick<ChatSessionSummary, "archivedAt">
): boolean {
  return typeof summary.archivedAt === "number" && summary.archivedAt > 0;
}

export function isChildChatSessionSummary(
  summary: Pick<ChatSessionSummary, "parentId">
): boolean {
  return Boolean(summary.parentId?.trim());
}

export function filterRootAgentSessionSummaries(rows: ChatSessionSummary[]): ChatSessionSummary[] {
  return rows.filter((row) => !isChildChatSessionSummary(row));
}

export function filterActiveAgentSessionSummaries(rows: ChatSessionSummary[]): ChatSessionSummary[] {
  return filterRootAgentSessionSummaries(rows).filter((row) => !isArchivedChatSessionSummary(row));
}

export function sortAgentSessionSummaries(rows: ChatSessionSummary[]): ChatSessionSummary[] {
  return [...rows].sort(compareAgentSessionActivity);
}

export type AgentQueuedFollowUp = {
  id: string;
  content: string;
};

/**
 * 已提交的用户句进入时间线；若当前有未冻结的 live assistant，插在它前面。
 * 待发送跟进不得走这条路径，应留在输入框上方队列。
 */
export function commitUserBeforeLiveAssistant(
  messages: AgentChatMessage[],
  userMessage: AgentChatMessage,
  liveAssistantId = ""
): AgentChatMessage[] {
  if (messages.some((row) => row.id === userMessage.id)) {
    return messages.map((row) =>
      row.id === userMessage.id
        ? { ...row, ...userMessage, attachments: row.attachments || userMessage.attachments }
        : row
    );
  }
  const liveId = String(liveAssistantId || "").trim();
  const liveIdx = liveId ? messages.findIndex((row) => row.id === liveId) : -1;
  if (liveIdx >= 0) {
    return [...messages.slice(0, liveIdx), userMessage, ...messages.slice(liveIdx)];
  }
  return [...messages, userMessage];
}

/** Codex：assistant 只追加；禁止插回已有正文前面。 */
export function appendAssistantMessage(
  messages: AgentChatMessage[],
  assistantMessage: AgentChatMessage
): AgentChatMessage[] {
  if (messages.some((row) => row.id === assistantMessage.id)) return messages;
  return [...messages, assistantMessage];
}

/** 跟进已写入 transcript 时，从预览队列按正文 FIFO 摘掉对应项。 */
export function consumeQueuedFollowUp(
  queue: AgentQueuedFollowUp[],
  committedContent: string
): { queue: AgentQueuedFollowUp[]; consumed: AgentQueuedFollowUp | null } {
  if (queue.length === 0) return { queue, consumed: null };
  const text = committedContent.trim();
  const idx = text ? queue.findIndex((item) => item.content.trim() === text) : -1;
  if (idx < 0) return { queue, consumed: null };
  return {
    queue: queue.filter((_, index) => index !== idx),
    consumed: queue[idx] || null
  };
}

/** 用户手动取消某条待发送跟进。 */
export function removeQueuedFollowUpById(
  queue: AgentQueuedFollowUp[],
  id: string
): AgentQueuedFollowUp[] {
  const target = String(id || "").trim();
  if (!target || queue.length === 0) return queue;
  return queue.filter((item) => item.id !== target);
}

/** 时间线里已经有的用户句不再留在跟进预览里。 */
export function dropQueuedFollowUpsAlreadyInTranscript(
  queue: AgentQueuedFollowUp[],
  messages: AgentChatMessage[]
): AgentQueuedFollowUp[] {
  if (queue.length === 0) return queue;
  const committed = new Set(
    messages
      .filter((row) => row.role === "user")
      .map((row) => String(row.content || "").trim())
      .filter(Boolean)
  );
  if (committed.size === 0) return queue;
  return queue.filter((item) => !committed.has(item.content.trim()));
}

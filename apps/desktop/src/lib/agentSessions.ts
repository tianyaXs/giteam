export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 本地保留的运行失败信息；服务端历史不一定返回失败事件。 */
  error?: string;
  attachments?: Array<{ id: string; kind: "image" | "file"; uri: string; mime?: string; filename?: string }>;
  /** 用户从资产图谱引用的节点（仅展示；模型上下文在发送时已注入）。 */
  graphRefs?: import("./graphContextRefs").GraphContextRef[];
};

export type AgentChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 会话当前 provider（服务端真相；有会话时 UI 只读此字段）。 */
  provider?: string;
  /** 会话当前 model id（服务端真相）。 */
  model?: string;
  parentId?: string;
  sessionKind?: string;
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
  /** 会话绑定的 provider（来自 list/getSession，禁止再靠 localStorage 猜）。 */
  provider?: string;
  /** 会话绑定的 model id。 */
  model?: string;
  parentId?: string;
  /** `"primary"` | `"subagent"`；子会话不得进侧栏。 */
  sessionKind?: string;
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
  const provider = String(summary.provider || "").trim();
  const model = String(summary.model || "").trim();
  const parentId = String(summary.parentId || "").trim();
  const sessionKind = String(summary.sessionKind || "").trim();
  return {
    id: summary.id,
    title: toAgentSessionTitle(summary.title || "", indexHint),
    createdAt: summary.createdAt || Date.now(),
    updatedAt: summary.updatedAt || summary.createdAt || Date.now(),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(parentId ? { parentId } : {}),
    ...(sessionKind ? { sessionKind } : {}),
    messages: [],
    turnStart: 0,
    loaded: false,
    nextCursor: undefined
  };
}

/** 从会话对象拼出 provider/model ref；缺任一端则返回空（有会话时不得回落 draft）。 */
export function modelRefFromChatSession(
  session: Pick<AgentChatSession, "provider" | "model"> | null | undefined
): string {
  const provider = String(session?.provider || "").trim();
  const model = String(session?.model || "").trim();
  if (!provider || !model) return "";
  return `${provider}/${model}`;
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
  summary: Pick<ChatSessionSummary, "parentId" | "sessionKind">
): boolean {
  const kind = String(summary.sessionKind || "").trim().toLowerCase();
  if (kind === "subagent") return true;
  return Boolean(summary.parentId?.trim());
}

/** 主会话列表用：排除 task/subagent 子会话（与移动端 isPrimaryAgentSession 对齐）。 */
export function isPrimaryAgentSessionSummary(
  summary: Pick<{ sessionKind?: string; parentSessionId?: string; parentId?: string }, "sessionKind" | "parentSessionId" | "parentId">
): boolean {
  const kind = String(summary.sessionKind || "").trim().toLowerCase();
  if (kind === "subagent") return false;
  if (String(summary.parentSessionId || "").trim()) return false;
  if (String(summary.parentId || "").trim()) return false;
  return true;
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

/**
 * history 比 live 短（JSONL 未落盘 / 同步过早）时，保留 live 末尾尚未入库的 assistant 气泡，
 * 避免最终回复闪过后被残缺 history 整表替换抹掉。
 */
export function mergeHistoryMessagesPreservingLive(
  history: AgentChatMessage[],
  live: AgentChatMessage[],
  options?: {
    hasLiveParts?: (messageId: string) => boolean;
    pickContent?: (historyContent: string, liveContent: string) => string;
  }
): AgentChatMessage[] {
  if (!Array.isArray(live) || live.length === 0) return history;
  if (!Array.isArray(history) || history.length === 0) {
    return live.filter((row) => {
      if (row.role !== "assistant") return false;
      return Boolean(String(row.content || "").trim()) || Boolean(options?.hasLiveParts?.(row.id));
    });
  }

  const historyIds = new Set(history.map((row) => row.id));
  const liveById = new Map(live.map((row) => [row.id, row]));
  const enriched = history.map((row) => {
    if (row.role !== "assistant") return row;
    const liveRow = liveById.get(row.id);
    if (!liveRow) return row;
    const content = options?.pickContent?.(row.content || "", liveRow.content || "") || row.content;
    if (content && content !== row.content) return { ...row, content };
    return row;
  });

  let lastSharedLiveIndex = -1;
  for (let i = live.length - 1; i >= 0; i -= 1) {
    if (historyIds.has(live[i].id)) {
      lastSharedLiveIndex = i;
      break;
    }
  }
  const trailing = live.slice(lastSharedLiveIndex + 1).filter((row) => {
    if (historyIds.has(row.id)) return false;
    if (row.role !== "assistant") return false;
    return Boolean(String(row.content || "").trim()) || Boolean(options?.hasLiveParts?.(row.id));
  });
  return trailing.length > 0 ? [...enriched, ...trailing] : enriched;
}

function assistantTailAfterUser(messages: AgentChatMessage[], userIndex: number): AgentChatMessage[] {
  if (userIndex < 0 || userIndex >= messages.length) return [];
  const tail: AgentChatMessage[] = [];
  for (let i = userIndex + 1; i < messages.length; i += 1) {
    const row = messages[i];
    if (row.role === "user") break;
    if (row.role === "assistant") tail.push(row);
  }
  return tail;
}

function findHistoryUserAnchor(
  history: AgentChatMessage[],
  currentUser: AgentChatMessage | undefined
): number {
  if (!currentUser) return -1;
  const byId = history.findIndex((row) => row.id === currentUser.id);
  if (byId >= 0) return byId;
  const content = String(currentUser.content || "").trim();
  if (!content) return -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row.role !== "user") continue;
    if (String(row.content || "").trim() === content) return i;
  }
  return -1;
}

/**
 * Pi 式收口：run 结束后用 history 对账「当前轮」assistant 尾部，只 append/patch，不整表替换。
 * 补齐 JSONL 已有、live 漏掉的最终总结，且保留现有 id / 时间线 DOM。
 */
export function reconcilePromptTailFromHistory(
  current: AgentChatMessage[],
  history: AgentChatMessage[],
  options?: {
    pickContent?: (historyContent: string, currentContent: string) => string;
    hasLiveParts?: (messageId: string) => boolean;
  }
): { messages: AgentChatMessage[]; changed: boolean; touchedAssistantIds: string[] } {
  if (!Array.isArray(current) || current.length === 0 || !Array.isArray(history) || history.length === 0) {
    return { messages: current, changed: false, touchedAssistantIds: [] };
  }
  let lastUserIdx = -1;
  for (let i = current.length - 1; i >= 0; i -= 1) {
    if (current[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) {
    return { messages: current, changed: false, touchedAssistantIds: [] };
  }
  const historyUserIdx = findHistoryUserAnchor(history, current[lastUserIdx]);
  if (historyUserIdx < 0) {
    return { messages: current, changed: false, touchedAssistantIds: [] };
  }

  const historyTail = assistantTailAfterUser(history, historyUserIdx);
  const currentTail = assistantTailAfterUser(current, lastUserIdx);
  if (historyTail.length === 0) {
    return { messages: current, changed: false, touchedAssistantIds: [] };
  }

  const pickContent =
    options?.pickContent
    || ((historyContent: string, liveContent: string) =>
      liveContent.length > historyContent.length ? liveContent : historyContent);
  const touchedAssistantIds: string[] = [];
  const historyIds = new Set(historyTail.map((row) => row.id));
  const currentById = new Map(currentTail.map((row) => [row.id, row]));
  const mergedTail: AgentChatMessage[] = [];

  for (const historyRow of historyTail) {
    const existing = currentById.get(historyRow.id);
    if (existing) {
      const content = pickContent(historyRow.content || "", existing.content || "");
      if (content !== existing.content) {
        mergedTail.push({ ...existing, content });
        touchedAssistantIds.push(historyRow.id);
      } else {
        mergedTail.push(existing);
      }
      continue;
    }
    mergedTail.push({ ...historyRow });
    touchedAssistantIds.push(historyRow.id);
  }

  for (const row of currentTail) {
    if (historyIds.has(row.id)) continue;
    const keep =
      Boolean(String(row.content || "").trim())
      || Boolean(options?.hasLiveParts?.(row.id));
    if (keep) mergedTail.push(row);
  }

  const prefix = current.slice(0, lastUserIdx + 1);
  const suffix = current.slice(lastUserIdx + 1 + currentTail.length);
  const next = [...prefix, ...mergedTail, ...suffix];
  const changed =
    next.length !== current.length
    || next.some((row, index) => row.id !== current[index]?.id || row.content !== current[index]?.content);
  if (!changed) {
    return { messages: current, changed: false, touchedAssistantIds: [] };
  }
  return { messages: next, changed: true, touchedAssistantIds };
}

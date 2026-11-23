import type { ContextBreakdown } from "./agent/client";
import { shouldKeepLiveAssistant, canInsertUserBeforeAssistant, isPauseFailureText } from "./agentParts.ts";

export type { ContextBreakdown, ContextCategoryId, ContextCategoryUsage } from "./agent/client";

export type AgentChatUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export function agentCacheHitRate(usage?: AgentChatUsage | null): number | null {
  if (!usage) return null;
  // input/cacheWrite 都是未命中部分；cacheRead 是命中部分。
  const totalInput = agentPromptTokens(usage);
  return totalInput > 0 ? Math.round((usage.cacheRead / totalInput) * 100) : null;
}

/** 单次请求的 billed prompt tokens（三类互不重叠）。 */
export function agentPromptTokens(usage?: AgentChatUsage | null): number {
  if (!usage) return 0;
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

/**
 * 上下文窗口占用：只计 prompt（input + cacheRead + cacheWrite）。
 * 不含 output——补全 token 不是「当前已装进窗口」的正确口径；
 * 否则会出现 Input 61k / Output 98 这种账单对比被误读成占用明细。
 */
export function agentContextUsedTokens(usage?: AgentChatUsage | null): number {
  return agentPromptTokens(usage);
}

export type AgentContextOccupancy = {
  percent: number;
  usedTokens: number;
  contextWindow: number;
};

/**
 * 上下文占用：used / 模型窗口。
 * 对齐官方 ContextDemo 的整数四舍五入与上限 100。
 */
export function agentContextOccupancy(
  usedTokens: number | null | undefined,
  contextWindow: number | null | undefined
): AgentContextOccupancy | null {
  if (
    usedTokens == null
    || contextWindow == null
    || !Number.isFinite(usedTokens)
    || !Number.isFinite(contextWindow)
    || contextWindow <= 0
  ) {
    return null;
  }
  const used = Math.max(0, Math.floor(usedTokens));
  return {
    percent: Math.min(100, Math.round((used / contextWindow) * 100)),
    usedTokens: used,
    contextWindow: Math.floor(contextWindow)
  };
}

/** 官方 ContextDemo.formatTokens：8420 → 8.4k。 */
export function formatAgentTokens(n: number): string {
  if (n < 1_000) return String(n);
  return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
}

export function agentChatUsageEquals(
  a?: AgentChatUsage,
  b?: AgentChatUsage
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.input === b.input
    && a.output === b.output
    && a.cacheRead === b.cacheRead
    && a.cacheWrite === b.cacheWrite
  );
}

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * 本地回合锚：同一次发送的 user + assistants 共享。
   * 归并对账按 turn 成组，禁止同文「继续」跨回合错配。
   */
  turnId?: string;
  /** 本地保留的运行失败信息；服务端历史不一定返回失败事件。 */
  error?: string;
  attachments?: Array<{ id: string; kind: "image" | "file"; uri: string; mime?: string; filename?: string }>;
  /** 用户从资产图谱引用的节点（仅展示；模型上下文在发送时已注入）。 */
  graphRefs?: import("./graphContextRefs").GraphContextRef[];
  /** token 用量（仅 assistant 消息有值）。 */
  usage?: AgentChatUsage;
  /** 截至此消息的完整会话累计用量；缓存圆环只读此字段。 */
  sessionUsage?: AgentChatUsage;
  /** 上下文分类占用（chars÷4 估计）。 */
  contextBreakdown?: ContextBreakdown;
};

/** 一条 user 及其后紧随的 assistants；无前导 user 的 leading assistants 单独成组。 */
export type AgentTimelineTurn = {
  turnId?: string;
  user?: AgentChatMessage;
  assistants: AgentChatMessage[];
};

/** 按 user 边界切回合；assistant 归入最近一条 user。 */
export function splitMessagesIntoTurns(messages: AgentChatMessage[]): AgentTimelineTurn[] {
  const turns: AgentTimelineTurn[] = [];
  let current: AgentTimelineTurn | null = null;
  for (const row of messages) {
    if (row.role === "user") {
      if (current) turns.push(current);
      const turnId = String(row.turnId || "").trim() || undefined;
      current = { turnId, user: row, assistants: [] };
      continue;
    }
    if (row.role !== "assistant") continue;
    const rowTurnId = String(row.turnId || "").trim() || undefined;
    if (!current) {
      current = { turnId: rowTurnId, assistants: [row] };
      continue;
    }
    if (!current.turnId && rowTurnId) current.turnId = rowTurnId;
    current.assistants.push(row);
  }
  if (current) turns.push(current);
  return turns;
}

function flattenTimelineTurn(turn: AgentTimelineTurn): AgentChatMessage[] {
  return turn.user ? [turn.user, ...turn.assistants] : [...turn.assistants];
}

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

/**
 * 右侧会话面板是否应显示「加载会话中…」。
 *
 * 关键规则：草稿态（draft = 用户意图是「无选中的新对话」）下，残留的
 * activeSessionId 不得把面板锁进 loading——典型场景是切到刚导入的空仓库：
 * bootstrap 还没清掉上一仓库的 active id，而会话列表为空，此时
 * 「active 不在列表」分支若不看 draft 会恒为真，页面永久停在加载态。
 *
 * @param hydratingActive     active 会话正在水合（getMessages 进行中）
 * @param pendingSidebarSwitch 侧栏点击触发的切换尚未落到列表
 * @param draft               当前是否处于新对话草稿态
 * @param activeSessionId     当前选中的会话 id（可为空串）
 * @param activeSession       在 agentSessions 列表中找到的会话对象（找不到为 null）
 */
export function isAgentSessionLoadingState(input: {
  hydratingActive: boolean;
  pendingSidebarSwitch: boolean;
  draft: boolean;
  activeSessionId: string;
  activeSession: Pick<AgentChatSession, "loaded"> | null;
}): boolean {
  if (input.hydratingActive || input.pendingSidebarSwitch) return true;
  const sid = input.activeSessionId.trim();
  if (!sid) return false;
  if (input.draft) return false;
  return !input.activeSession || !input.activeSession.loaded;
}

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

/** 待发送入队：始终追加，不顶掉已有条目。 */
export function appendQueuedFollowUp(
  queue: AgentQueuedFollowUp[],
  content: string,
  makeId: () => string
): AgentQueuedFollowUp[] {
  const text = content.trim();
  if (!text) return queue;
  return [...queue, { id: makeId(), content: text }];
}

/**
 * DSH：是否仍是 phase===open 的助手占位（可把新 user 插到前面）。
 * active/settled（含进行中或已收口的 runtime.retry）必须收口，新 user 只能 append。
 */
export function isOpenAssistantPlaceholder(
  row: AgentChatMessage | undefined,
  isStillOpen?: (messageId: string) => boolean
): boolean {
  if (!row || row.role !== "assistant") return false;
  // isStillOpen=false ⇒ live parts 已非 open；与 canInsertUserBeforeAssistant 同相。
  if (isStillOpen && !isStillOpen(row.id)) return false;
  return canInsertUserBeforeAssistant(row, null);
}

/**
 * 已提交的用户句进入时间线。
 * 只允许插到「当前最后一条」且仍是空占位的 live assistant 前面（发送时先建了回复泡）。
 * 助手 id 若落在更早的回合里，必须追加到末尾——插回去会把新消息嵌进历史中间，时序错乱。
 * 待发送跟进不得走这条路径，应留在输入框上方队列。
 */
export function commitUserBeforeLiveAssistant(
  messages: AgentChatMessage[],
  userMessage: AgentChatMessage,
  liveAssistantId = "",
  options?: { isStillOpenAssistant?: (messageId: string) => boolean }
): AgentChatMessage[] {
  if (messages.some((row) => row.id === userMessage.id)) {
    return messages.map((row) =>
      row.id === userMessage.id
        ? { ...row, ...userMessage, attachments: row.attachments || userMessage.attachments }
        : row
    );
  }
  const isStillOpen = options?.isStillOpenAssistant;
  const text = String(userMessage.content || "").trim();
  if (text) {
    let tailUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "user") {
        tailUser = i;
        break;
      }
    }
    const tail = tailUser >= 0 ? messages[tailUser] : undefined;
    const afterTail = tailUser >= 0 ? messages.slice(tailUser + 1) : [];
    // 只有「这句已经在末尾」才原地更新：后面没有实质回复。
    // 再发一遍相同正文必须追加，不能改写更早的那条。
    // DSH：active/settled 助手不算未答复占位。
    const tailIsUnanswered =
      afterTail.length === 0
      || (
        afterTail.length === 1
        && isOpenAssistantPlaceholder(afterTail[0], isStillOpen)
      );
    if (tail && tailIsUnanswered && String(tail.content || "").trim() === text) {
      return messages.map((row, index) =>
        index === tailUser
          ? { ...row, ...userMessage, id: row.id, attachments: row.attachments || userMessage.attachments }
          : row
      );
    }
  }
  const liveId = String(liveAssistantId || "").trim();
  const liveIdx = liveId ? messages.findIndex((row) => row.id === liveId) : -1;
  const live = liveIdx >= 0 ? messages[liveIdx] : undefined;
  // 只有末尾且 phase===open 的回复泡，才把用户句插到它前面。
  const liveIsOpenTail =
    liveIdx === messages.length - 1
    && isOpenAssistantPlaceholder(live, isStillOpen);
  if (liveIsOpenTail) {
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
 * history 与 live（本地时间线）按 **回合（turn）** 归并（DSH）。
 *
 * 不变量：一个 turn = 一条 user + 紧随 assistants；整 turn 写出，禁止交叉 flush。
 * 配对优先级：turnId → user id / serverIdByLocalId；**不做同文 content 配对**。
 * 行级是否保留 live 助手：phase !== open（见 shouldKeepLiveAssistant）。
 */
function keepLiveAssistantRow(
  row: AgentChatMessage,
  hasLiveParts?: (messageId: string) => boolean
): boolean {
  // hasLiveParts 语义 = phase !== open（App：livePartsHaveVisibleContent）。
  if (hasLiveParts?.(row.id)) return true;
  return shouldKeepLiveAssistant(row, null);
}

function filterLiveTimelineRows(
  rows: AgentChatMessage[],
  hasLiveParts?: (messageId: string) => boolean
): AgentChatMessage[] {
  return rows.filter((row) => {
    if (row.role === "user") return true;
    if (row.role !== "assistant") return false;
    return keepLiveAssistantRow(row, hasLiveParts);
  });
}

function mergeAnchoredMessage(
  historyRow: AgentChatMessage,
  liveRow: AgentChatMessage | undefined,
  pickContent?: (historyContent: string, liveContent: string) => string
): AgentChatMessage {
  if (!liveRow) return historyRow;
  let merged = historyRow;
  if (
    liveRow.role === "assistant"
    && String(liveRow.content || "").length > String(historyRow.content || "").length
  ) {
    const content = pickContent?.(historyRow.content || "", liveRow.content || "")
      || liveRow.content;
    merged = { ...historyRow, content };
  }
  // error / turnId 是本地通道字段（服务端历史不回传）。
  if (liveRow.error && !merged.error) merged = { ...merged, error: liveRow.error };
  const liveTurnId = String(liveRow.turnId || "").trim();
  if (liveTurnId && !String(merged.turnId || "").trim()) {
    merged = { ...merged, turnId: liveTurnId };
  }
  // id 保留 live 本地 id（换 id 会让列表卸载重挂）。
  if (liveRow.id !== merged.id) merged = { ...merged, id: liveRow.id };
  return merged;
}

function historyIdForLiveRow(
  row: AgentChatMessage,
  historyById: Map<string, AgentChatMessage>,
  serverIdByLocalId: Record<string, string>
): string {
  if (historyById.has(row.id)) return row.id;
  const mapped = String(serverIdByLocalId[row.id] || "").trim();
  if (mapped && historyById.has(mapped)) return mapped;
  return "";
}

function turnsMatchByAnchor(
  historyTurn: AgentTimelineTurn,
  liveTurn: AgentTimelineTurn,
  historyById: Map<string, AgentChatMessage>,
  serverIdByLocalId: Record<string, string>
): boolean {
  const historyTurnId = String(
    historyTurn.turnId
    || historyTurn.user?.turnId
    || historyTurn.assistants[0]?.turnId
    || ""
  ).trim();
  const liveTurnId = String(
    liveTurn.turnId
    || liveTurn.user?.turnId
    || liveTurn.assistants[0]?.turnId
    || ""
  ).trim();
  if (historyTurnId && liveTurnId && historyTurnId === liveTurnId) return true;

  const historyUser = historyTurn.user;
  const liveUser = liveTurn.user;
  if (historyUser && liveUser) {
    if (historyUser.id === liveUser.id) return true;
    if (historyIdForLiveRow(liveUser, historyById, serverIdByLocalId) === historyUser.id) {
      return true;
    }
  }
  return false;
}

function mergeTimelineTurns(
  historyTurn: AgentTimelineTurn,
  liveTurn: AgentTimelineTurn | undefined,
  options: {
    hasLiveParts?: (messageId: string) => boolean;
    pickContent?: (historyContent: string, liveContent: string) => string;
    historyById: Map<string, AgentChatMessage>;
    serverIdByLocalId: Record<string, string>;
    /** assistant id → 它在 live 里所属的回合下标。不属于当前 history 回合则推迟写出。 */
    assistantOwner?: Map<string, number>;
    liveTurnIndex?: number;
  }
): AgentChatMessage[] {
  const { hasLiveParts, pickContent, historyById, serverIdByLocalId, assistantOwner, liveTurnIndex } = options;
  const isDeferredAssistant = (id: string) => {
    const owned = assistantOwner?.get(id);
    if (owned == null) return false;
    if (liveTurnIndex == null) return true;
    return owned !== liveTurnIndex;
  };
  const ownedByThisLiveTurn = (id: string) =>
    liveTurnIndex != null && assistantOwner?.get(id) === liveTurnIndex;
  const liveAssistants = liveTurn?.assistants || [];
  const liveByHistoryId = new Map<string, AgentChatMessage>();
  for (const row of liveAssistants) {
    const historyId = historyIdForLiveRow(row, historyById, serverIdByLocalId) || row.id;
    if (!liveByHistoryId.has(historyId)) liveByHistoryId.set(historyId, row);
    if (!liveByHistoryId.has(row.id)) liveByHistoryId.set(row.id, row);
  }

  const out: AgentChatMessage[] = [];
  const turnId =
    String(liveTurn?.turnId || historyTurn.turnId || "").trim()
    || String(liveTurn?.user?.turnId || historyTurn.user?.turnId || "").trim()
    || undefined;

  if (historyTurn.user || liveTurn?.user) {
    const mergedUser = historyTurn.user
      ? mergeAnchoredMessage(historyTurn.user, liveTurn?.user, pickContent)
      : liveTurn!.user!;
    out.push(turnId && !mergedUser.turnId ? { ...mergedUser, turnId } : mergedUser);
  }

  const claimedLiveIds = new Set<string>();
  const mergedAssistants: AgentChatMessage[] = new Array(historyTurn.assistants.length);

  // 1) 先按 id / serverIdByLocalId 配对。
  for (let hi = 0; hi < historyTurn.assistants.length; hi += 1) {
    const historyAss = historyTurn.assistants[hi];
    // 属于更晚的 live 回合（同 turnId 的「继续」，或暂停标签）：不要提前写到上一回合。
    if (isDeferredAssistant(historyAss.id)) continue;
    let liveAss = liveByHistoryId.get(historyAss.id);
    if (!liveAss) {
      for (const [localId, serverId] of Object.entries(serverIdByLocalId)) {
        if (serverId === historyAss.id) {
          liveAss = liveByHistoryId.get(localId);
          break;
        }
      }
    }
    if (!liveAss || claimedLiveIds.has(liveAss.id)) continue;
    claimedLiveIds.add(liveAss.id);
    mergedAssistants[hi] = mergeAnchoredMessage(historyAss, liveAss, pickContent);
  }

  // 2) 同 turn 内剩余助手按位置配对（turnId 已对齐但 id 尚未 remap 的乐观行）。
  let livePos = 0;
  for (let hi = 0; hi < historyTurn.assistants.length; hi += 1) {
    if (mergedAssistants[hi]) continue;
    while (livePos < liveAssistants.length && claimedLiveIds.has(liveAssistants[livePos].id)) {
      livePos += 1;
    }
    const historyAss = historyTurn.assistants[hi];
    if (isDeferredAssistant(historyAss.id)) continue;
    const liveAss = livePos < liveAssistants.length ? liveAssistants[livePos] : undefined;
    if (
      liveAss
      && !historyIdForLiveRow(liveAss, historyById, serverIdByLocalId)
    ) {
      claimedLiveIds.add(liveAss.id);
      livePos += 1;
      mergedAssistants[hi] = mergeAnchoredMessage(historyAss, liveAss, pickContent);
    } else {
      mergedAssistants[hi] = turnId && !historyAss.turnId
        ? { ...historyAss, turnId }
        : historyAss;
    }
  }
  out.push(...mergedAssistants.filter((row): row is AgentChatMessage => Boolean(row)));

  for (const liveAss of liveAssistants) {
    if (claimedLiveIds.has(liveAss.id)) continue;
    const historyId = historyIdForLiveRow(liveAss, historyById, serverIdByLocalId);
    // 已在其它 history 回合出现的助手留给那边；本回合锚点上的暂停/重试标签必须留在这里。
    if (
      historyId
      && !ownedByThisLiveTurn(liveAss.id)
      && !ownedByThisLiveTurn(historyId)
    ) continue;
    if (!keepLiveAssistantRow(liveAss, hasLiveParts)) continue;
    out.push(turnId && !liveAss.turnId ? { ...liveAss, turnId } : liveAss);
  }

  return out;
}

function filterLiveOnlyTurn(
  turn: AgentTimelineTurn,
  historyById: Map<string, AgentChatMessage>,
  serverIdByLocalId: Record<string, string>,
  hasLiveParts: ((messageId: string) => boolean) | undefined,
  assistantOwner: Map<string, number> | undefined,
  liveTurnIndex: number
): AgentChatMessage[] {
  const rows = flattenTimelineTurn(turn).filter((row) => {
    const historyId = historyIdForLiveRow(row, historyById, serverIdByLocalId);
    if (historyId) {
      const ownedHere =
        assistantOwner?.get(row.id) === liveTurnIndex
        || assistantOwner?.get(historyId) === liveTurnIndex;
      if (row.role === "assistant" && ownedHere) {
        return keepLiveAssistantRow(row, hasLiveParts);
      }
      return false;
    }
    if (row.role === "user") return true;
    return keepLiveAssistantRow(row, hasLiveParts);
  });
  return filterLiveTimelineRows(rows, hasLiveParts);
}

/**
 * 只锁定「暂停/重试标签」所在的 live 回合。
 * 普通助手（正文、工具、思考）不进这张表：按 turnId 改归属会把过程消息挪走或丢掉。
 */
function assistantOwnerById(
  liveTurns: AgentTimelineTurn[],
  historyById: Map<string, AgentChatMessage>,
  serverIdByLocalId: Record<string, string>
): Map<string, number> {
  const owner = new Map<string, number>();
  const claim = (id: string, index: number) => {
    const key = String(id || "").trim();
    if (!key || owner.has(key)) return;
    owner.set(key, index);
  };
  liveTurns.forEach((turn, index) => {
    for (const row of turn.assistants) {
      if (!isPauseFailureText(String(row.error || ""))) continue;
      claim(row.id, index);
      const historyId = historyIdForLiveRow(row, historyById, serverIdByLocalId);
      if (historyId) claim(historyId, index);
    }
  });
  return owner;
}

/** 把属于本回合的助手挪进来，把属于别的回合的助手挪出去。 */
function liveTurnForEmit(
  liveTurns: AgentTimelineTurn[],
  index: number,
  assistantOwner: Map<string, number>
): AgentTimelineTurn {
  const turn = liveTurns[index];
  const assistants = turn.assistants.filter((row) => {
    const owned = assistantOwner.get(row.id);
    return owned == null || owned === index;
  });
  for (let i = 0; i < liveTurns.length; i += 1) {
    if (i === index) continue;
    for (const row of liveTurns[i].assistants) {
      if (assistantOwner.get(row.id) !== index) continue;
      if (assistants.some((item) => item.id === row.id)) continue;
      assistants.push(row);
    }
  }
  return { ...turn, assistants };
}

export function mergeHistoryWithLiveTimeline(
  history: AgentChatMessage[],
  live: AgentChatMessage[],
  options?: {
    hasLiveParts?: (messageId: string) => boolean;
    pickContent?: (historyContent: string, liveContent: string) => string;
    serverIdByLocalId?: Record<string, string>;
  }
): AgentChatMessage[] {
  if (!Array.isArray(live) || live.length === 0) return history;
  if (!Array.isArray(history) || history.length === 0) {
    // 完整保留 live turns（含 user），只滤掉无实质的空 assistant 占位。
    return filterLiveTimelineRows(live, options?.hasLiveParts);
  }

  const historyById = new Map(history.map((row) => [row.id, row]));
  const serverIdByLocalId = options?.serverIdByLocalId || {};
  const historyTurns = splitMessagesIntoTurns(history);
  const liveTurns = splitMessagesIntoTurns(live);
  const assistantOwner = assistantOwnerById(liveTurns, historyById, serverIdByLocalId);

  const liveTurnIndexByHistoryIndex = new Map<number, number>();
  const usedLiveTurn = new Set<number>();
  for (let hi = 0; hi < historyTurns.length; hi += 1) {
    const historyTurn = historyTurns[hi];
    let matched = -1;
    for (let li = 0; li < liveTurns.length; li += 1) {
      if (usedLiveTurn.has(li)) continue;
      if (turnsMatchByAnchor(historyTurn, liveTurns[li], historyById, serverIdByLocalId)) {
        matched = li;
        break;
      }
    }
    if (matched >= 0) {
      liveTurnIndexByHistoryIndex.set(hi, matched);
      usedLiveTurn.add(matched);
    }
  }

  const out: AgentChatMessage[] = [];
  let liveTurnCursor = 0;
  const emitLiveOnlyUntil = (stopLiveIndex: number) => {
    while (liveTurnCursor < stopLiveIndex && liveTurnCursor < liveTurns.length) {
      if (!usedLiveTurn.has(liveTurnCursor)) {
        out.push(
          ...filterLiveOnlyTurn(
            liveTurnForEmit(liveTurns, liveTurnCursor, assistantOwner),
            historyById,
            serverIdByLocalId,
            options?.hasLiveParts,
            assistantOwner,
            liveTurnCursor
          )
        );
      }
      liveTurnCursor += 1;
    }
  };

  for (let hi = 0; hi < historyTurns.length; hi += 1) {
    const liveIndex = liveTurnIndexByHistoryIndex.get(hi);
    if (liveIndex == null) {
      // history-only turn 留在 history 脊柱当前位置；其后的 live-only 在末尾排放。
      // 不再把未配对 history user 攒进 pending 再一次性 dump（那是跨回合交错的根因）。
      out.push(
        ...mergeTimelineTurns(historyTurns[hi], undefined, {
          hasLiveParts: options?.hasLiveParts,
          pickContent: options?.pickContent,
          historyById,
          serverIdByLocalId,
          assistantOwner
        })
      );
      continue;
    }
    // 配对 turn 之前的 live-only（尚未落盘的中间回合）原位保留。
    if (liveIndex >= liveTurnCursor) emitLiveOnlyUntil(liveIndex);
    out.push(
      ...mergeTimelineTurns(historyTurns[hi], liveTurnForEmit(liveTurns, liveIndex, assistantOwner), {
        hasLiveParts: options?.hasLiveParts,
        pickContent: options?.pickContent,
        historyById,
        serverIdByLocalId,
        assistantOwner,
        liveTurnIndex: liveIndex
      })
    );
    if (liveIndex >= liveTurnCursor) liveTurnCursor = liveIndex + 1;
  }
  emitLiveOnlyUntil(liveTurns.length);
  return out;
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
    return filterLiveTimelineRows(live, options?.hasLiveParts);
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
    return keepLiveAssistantRow(row, options?.hasLiveParts);
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

/**
 * 定位 history 中与当前 user 对应的锚点。
 * 只认 turnId / id / serverIdByLocalId——禁止同文「继续」跨回合错锚。
 */
function findHistoryUserAnchor(
  history: AgentChatMessage[],
  currentUser: AgentChatMessage | undefined,
  serverIdByLocalId?: Record<string, string>
): number {
  if (!currentUser) return -1;
  const byId = history.findIndex((row) => row.id === currentUser.id);
  if (byId >= 0) return byId;

  const mapped = String(serverIdByLocalId?.[currentUser.id] || "").trim();
  if (mapped) {
    const byMapped = history.findIndex((row) => row.id === mapped);
    if (byMapped >= 0) return byMapped;
  }

  const turnId = String(currentUser.turnId || "").trim();
  if (turnId) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const row = history[i];
      if (row.role !== "user") continue;
      if (String(row.turnId || "").trim() === turnId) return i;
    }
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
    serverIdByLocalId?: Record<string, string>;
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
  const historyUserIdx = findHistoryUserAnchor(
    history,
    current[lastUserIdx],
    options?.serverIdByLocalId
  );
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
      const usage = historyRow.usage ?? existing.usage;
      const sessionUsage = historyRow.sessionUsage ?? existing.sessionUsage;
      const contextBreakdown = historyRow.contextBreakdown ?? existing.contextBreakdown;
      if (
        content !== existing.content
        || !agentChatUsageEquals(usage, existing.usage)
        || !agentChatUsageEquals(sessionUsage, existing.sessionUsage)
        || contextBreakdown !== existing.contextBreakdown
      ) {
        mergedTail.push({ ...existing, content, usage, sessionUsage, contextBreakdown });
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
    if (keepLiveAssistantRow(row, options?.hasLiveParts)) mergedTail.push(row);
  }

  const prefix = current.slice(0, lastUserIdx + 1);
  const suffix = current.slice(lastUserIdx + 1 + currentTail.length);
  const next = [...prefix, ...mergedTail, ...suffix];
  const changed =
    next.length !== current.length
    || next.some((row, index) =>
      row.id !== current[index]?.id
      || row.content !== current[index]?.content
      || !agentChatUsageEquals(row.usage, current[index]?.usage)
      || !agentChatUsageEquals(row.sessionUsage, current[index]?.sessionUsage)
    );
  if (!changed) {
    return { messages: current, changed: false, touchedAssistantIds: [] };
  }
  return { messages: next, changed: true, touchedAssistantIds };
}

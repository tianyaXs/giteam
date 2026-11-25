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

/** 发送时登记、completed 时消费：一回合只有一个本地 user 身份。 */
export type OpenUserTurn = {
  localUserId: string;
  turnId: string;
  serverUserId?: string;
};

/**
 * 回合身份锚：发送时登记、completed 时绑定/收口。
 *
 * 「本回合唯一本地 user 行」只有这一个真相源；身份解析只靠显式状态
 * （pending 队列 / serverIdByLocalId 映射 / open-turn），不做 id 形态猜测。
 * - begin → 登记（runAgentPrompt 唯一写入点）
 * - bind → completed 到达，锚定 serverUserId 并返回绑定的 localUserId
 * - close → 回合终止（finalize / abort）后迟到 completed 不再允许另起/误绑
 * - reconcile → 回合终止后用权威 history 回补缺失映射，再交给归并对账
 *
 * 纯函数 + 不可变更新：App 只在登记/收口/对账生命周期点调用，不再散落判重。
 */
export function beginOpenUserTurn(
  openTurnBySession: Record<string, OpenUserTurn | null>,
  sessionId: string,
  turn: OpenUserTurn
): Record<string, OpenUserTurn | null> {
  return { ...openTurnBySession, [sessionId]: { ...turn } };
}

export function hasPendingOpenUserTurn(
  openTurnBySession: Record<string, OpenUserTurn | null | undefined>,
  sessionId: string
): boolean {
  return Boolean(openTurnBySession[sessionId]);
}

export function resolveBindLocalUserIdForCommit(input: {
  sessionId: string;
  serverUserId: string;
  pendingLocalId?: string;
  openTurnBySession: Record<string, OpenUserTurn | null | undefined>;
  serverIdByLocalId: Record<string, string>;
}): string {
  const serverUserId = String(input.serverUserId || "").trim();
  const mapped = Object.entries(input.serverIdByLocalId)
    .find(([, serverId]) => serverId === serverUserId)?.[0];
  if (mapped) return mapped;

  const open = input.openTurnBySession[input.sessionId];
  if (open?.localUserId && (!open.serverUserId || open.serverUserId === serverUserId)) {
    return open.localUserId;
  }
  return String(input.pendingLocalId || "").trim();
}

/**
 * completed 绑定成功后的唯一收口：锚定 serverUserId 并在列表中定位本地行。
 * 返回 serverUserId 为空串表示 completed 未绑定任何本地身份（upsert 前应取消）。
 */
export function bindOpenUserTurn(
  openTurnBySession: Record<string, OpenUserTurn | null>,
  sessionId: string,
  serverUserId: string,
  bindLocalUserId: string
): { openTurnBySession: Record<string, OpenUserTurn | null>; localUserId: string } {
  const open = openTurnBySession[sessionId];
  if (!open) return { openTurnBySession, localUserId: "" };
  const localUserId = bindLocalUserId || open.localUserId;
  if (!localUserId) return { openTurnBySession, localUserId: "" };
  return {
    openTurnBySession: {
      ...openTurnBySession,
      [sessionId]: { ...open, serverUserId }
    },
    localUserId
  };
}

/** 回合终止（run finalize / abort 收口）后唯一清理点：此后该回合无身份锚。 */
export function closeOpenUserTurn(
  openTurnBySession: Record<string, OpenUserTurn | null>,
  sessionId: string
): Record<string, OpenUserTurn | null> {
  if (!openTurnBySession[sessionId]) return openTurnBySession;
  const next = { ...openTurnBySession };
  delete next[sessionId];
  return next;
}

/** 权威对账的待回填结果：本地行就位（含 turnId）、local→server 映射、消费掉的 pending。 */
export type ReconcilePendingUserTurnsResult = {
  serverIdByLocalId: Record<string, string>;
  pendingLocalUserIds: string[];
  matchedCount: number;
};

/**
 * 回合终止后的权威身份对账：服务端 history（JSONL / 快照）是完成态事实来源。
 *
 * completed 丢失（超时 / abort）会让 local→server 映射缺失，此时同一回合在
 * history 与 live 时间线各有一行；归并对账只认显式身份（id / 映射 / turnId），
 * 绝不按正文猜测。这里按 FIFO 把「history 中尚未落到 live 的 user 行」与
 * 「pending 中尚未确认的本地乐观 id」显式配对，回填 turnId 与映射，
 * 让 mergeHistoryWithLiveTimeline / findHistoryUserAnchor 自然命中同一行。
 */
export function reconcilePendingUserTurns(input: {
  historyUsers: Array<{ id: string; turnId?: string }>;
  liveUserIds: Set<string>;
  pendingLocalUserIds?: string[];
  serverIdByLocalId: Record<string, string>;
}): ReconcilePendingUserTurnsResult {
  const pendingLocalUserIds = Array.isArray(input.pendingLocalUserIds)
    ? input.pendingLocalUserIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const serverIdByLocalId = { ...input.serverIdByLocalId };
  const liveUserIds = input.liveUserIds || new Set<string>();
  const pendingCount = pendingLocalUserIds.length;
  if (pendingCount === 0) {
    return { serverIdByLocalId, pendingLocalUserIds, matchedCount: 0 };
  }

  const isAccounted = (serverUserId: string) =>
    liveUserIds.has(serverUserId)
    || Object.values(serverIdByLocalId).includes(serverUserId);
  // 尾部对齐：pending 是最近发出的本地回合，只可能对应「最后一个已确认行」之后的
  // 未配对服务端行。全局 FIFO 会把陈旧 pending 错配到中间外来回合。
  const users = input.historyUsers || [];
  let lastAccountedIndex = -1;
  for (let i = users.length - 1; i >= 0; i -= 1) {
    const id = String(users[i]?.id || "").trim();
    if (id && isAccounted(id)) {
      lastAccountedIndex = i;
      break;
    }
  }
  const trailingUnmatched = users
    .slice(lastAccountedIndex + 1)
    .map((row) => ({
      serverUserId: String(row?.id || "").trim(),
      turnId: String(row?.turnId || "").trim()
    }))
    .filter((row) => row.serverUserId && !isAccounted(row.serverUserId));
  const from = Math.max(0, trailingUnmatched.length - pendingCount);
  const candidates = trailingUnmatched.slice(from);

  const usedLocalIds = new Set<string>();
  let matchedCount = 0;
  for (let i = 0; i < candidates.length && i < pendingCount; i += 1) {
    const localUserId = pendingLocalUserIds[i];
    if (!localUserId || usedLocalIds.has(localUserId)) continue;
    serverIdByLocalId[localUserId] = candidates[i].serverUserId;
    usedLocalIds.add(localUserId);
    matchedCount += 1;
  }

  return {
    serverIdByLocalId,
    pendingLocalUserIds: pendingLocalUserIds.filter((id) => !usedLocalIds.has(id)),
    matchedCount
  };
}

/**
 * 权威对账第二步：把已映射本地行缺失的 turnId 显式回填（不做任何行位置变更）。
 * turn 是归并对账的第一身份；补齐后 history 回合与 live 回合必然按 turn 配对。
 */
export function applyTurnIdReconciliation(
  messages: AgentChatMessage[],
  serverIdByLocalId: Record<string, string>,
  historyTurnIdByServerUserId: Map<string, string>
): { messages: AgentChatMessage[]; changed: boolean } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, changed: false };
  }
  let changed = false;
  const next = messages.map((row) => {
    if (row.role !== "user" || String(row.turnId || "").trim()) return row;
    const serverUserId = String(serverIdByLocalId[row.id] || "").trim();
    const turnId = serverUserId ? historyTurnIdByServerUserId.get(serverUserId) || "" : "";
    if (!turnId) return row;
    changed = true;
    return { ...row, turnId };
  });
  return changed ? { messages: next, changed } : { messages, changed: false };
}

export type UpsertCommittedUserOptions = {
  /** 本回合乐观本地 user id（pending / open-turn）。有则禁止另起一行。 */
  bindLocalUserId?: string;
  /** localId → serverId；用于迟到 completed 回绑。 */
  serverIdByLocalId?: Record<string, string>;
  liveAssistantId?: string;
  isStillOpenAssistant?: (messageId: string) => boolean;
};

export type UpsertCommittedUserResult = {
  messages: AgentChatMessage[];
  /** 时间线上最终保留的 user 行 id（始终优先本地乐观 id）。 */
  localUserId: string;
  inserted: boolean;
};

function mergeUserMessageRow(
  existing: AgentChatMessage,
  incoming: AgentChatMessage
): AgentChatMessage {
  return {
    ...existing,
    ...incoming,
    // 行身份以已上屏的为准，避免 local→server 换 id 触发列表重挂。
    id: existing.id,
    attachments: existing.attachments?.length ? existing.attachments : incoming.attachments,
    graphRefs: existing.graphRefs?.length ? existing.graphRefs : incoming.graphRefs,
    turnId: existing.turnId || incoming.turnId
  };
}

function findUserIndexById(messages: AgentChatMessage[], id: string): number {
  const target = String(id || "").trim();
  if (!target) return -1;
  return messages.findIndex((row) => row.role === "user" && row.id === target);
}

/**
 * 用户消息唯一落地入口（乐观确认 / 本地 completed / 远程 completed 共用）。
 *
 * 身份解析顺序（不做 id 形态猜测、不做「同文就合并」）：
 * 1. 已有同 id 行
 * 2. bindLocalUserId 指向的乐观行（open-turn / pending）
 * 3. serverIdByLocalId 反查已映射的本地行
 * 4. 同 turnId 的已有 user 行
 * 5. 以上皆无 → 才插入（open assistant 前或 append）
 */
export function upsertCommittedUserMessage(
  messages: AgentChatMessage[],
  incoming: AgentChatMessage,
  options?: UpsertCommittedUserOptions
): UpsertCommittedUserResult {
  const byExact = findUserIndexById(messages, incoming.id);
  if (byExact >= 0) {
    return {
      messages: messages.map((row, index) => (
        index === byExact ? mergeUserMessageRow(row, incoming) : row
      )),
      localUserId: messages[byExact].id,
      inserted: false
    };
  }

  const bindLocalUserId = String(options?.bindLocalUserId || "").trim();
  if (bindLocalUserId) {
    const bindIndex = findUserIndexById(messages, bindLocalUserId);
    if (bindIndex >= 0) {
      return {
        messages: messages.map((row, index) => (
          index === bindIndex ? mergeUserMessageRow(row, incoming) : row
        )),
        localUserId: bindLocalUserId,
        inserted: false
      };
    }
  }

  const mappedLocalId = Object.entries(options?.serverIdByLocalId || {})
    .find(([, serverId]) => serverId === incoming.id)?.[0];
  if (mappedLocalId) {
    const mappedIndex = findUserIndexById(messages, mappedLocalId);
    if (mappedIndex >= 0) {
      return {
        messages: messages.map((row, index) => (
          index === mappedIndex ? mergeUserMessageRow(row, incoming) : row
        )),
        localUserId: mappedLocalId,
        inserted: false
      };
    }
  }

  const turnId = String(incoming.turnId || "").trim();
  // 身份合并只认显式回合号（不猜 id 形态、不比正文）：同 turnId 即同回合。
  if (turnId) {
    const turnIndex = messages.findIndex(
      (row) => row.role === "user" && String(row.turnId || "").trim() === turnId
    );
    if (turnIndex >= 0) {
      return {
        messages: messages.map((row, index) => (
          index === turnIndex ? mergeUserMessageRow(row, incoming) : row
        )),
        localUserId: messages[turnIndex].id,
        inserted: false
      };
    }
  }

  const isStillOpen = options?.isStillOpenAssistant;
  const liveId = String(options?.liveAssistantId || "").trim();
  const liveIdx = liveId ? messages.findIndex((row) => row.id === liveId) : -1;
  const live = liveIdx >= 0 ? messages[liveIdx] : undefined;
  const liveIsOpenTail =
    liveIdx === messages.length - 1
    && isOpenAssistantPlaceholder(live, isStillOpen);
  if (liveIsOpenTail) {
    return {
      messages: [...messages.slice(0, liveIdx), incoming, ...messages.slice(liveIdx)],
      localUserId: incoming.id,
      inserted: true
    };
  }
  return {
    messages: [...messages, incoming],
    localUserId: incoming.id,
    inserted: true
  };
}

/**
 * 已提交的用户句进入时间线（兼容旧调用方）。
 * 必须显式传入 bindLocalUserId / serverIdByLocalId / turnId，禁止同文猜测。
 */
export function commitUserBeforeLiveAssistant(
  messages: AgentChatMessage[],
  userMessage: AgentChatMessage,
  liveAssistantId = "",
  options?: {
    isStillOpenAssistant?: (messageId: string) => boolean;
    bindLocalUserId?: string;
    serverIdByLocalId?: Record<string, string>;
  }
): AgentChatMessage[] {
  return upsertCommittedUserMessage(messages, userMessage, {
    bindLocalUserId: options?.bindLocalUserId,
    serverIdByLocalId: options?.serverIdByLocalId,
    liveAssistantId,
    isStillOpenAssistant: options?.isStillOpenAssistant
  }).messages;
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
  // history 不含 UI 附件 chip（docx 等）；优先保留 live 侧 attachments / graphRefs。
  if (liveRow.role === "user") {
    if (liveRow.attachments?.length) {
      merged = { ...merged, attachments: liveRow.attachments };
    }
    if (liveRow.graphRefs?.length) {
      merged = { ...merged, graphRefs: liveRow.graphRefs };
    }
  }
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

export type ReconcileLiveTimelineResult = {
  messages: AgentChatMessage[];
  changed: boolean;
  touchedAssistantIds: string[];
  /** 命中的 local→server 身份绑定对应的本地 user id；未绑定时空串。 */
  bindLocalUserId: string;
};

/**
 * 会话中途的 history 对账（DSH/pi 语义：事件流/live 时间线是唯一事实源）。
 *
 * 与 mergeHistoryWithLiveTimeline 的区别：不把 history 行集合并进时间线，而是
 * 以 live 为骨架，只把「当前尾部 user 回合」对应的 assistant 尾巴补齐/替换。
 * history 的 user 行永不进入 live 时间线，所以锚点缺失时最坏结果是「少一个
 * 回合的补齐」，绝不是「history 与 live 各出一行 user」。
 */
export function reconcileLiveTimelineFromHistory(
  current: AgentChatMessage[],
  history: AgentChatMessage[],
  options?: {
    hasLiveParts?: (messageId: string) => boolean;
    pickContent?: (historyContent: string, currentContent: string) => string;
    serverIdByLocalId?: Record<string, string>;
  }
): ReconcileLiveTimelineResult {
  if (!Array.isArray(current) || current.length === 0 || !Array.isArray(history) || history.length === 0) {
    return { messages: current, changed: false, touchedAssistantIds: [], bindLocalUserId: "" };
  }
  const serverIdByLocalId = options?.serverIdByLocalId || {};
  const historyById = new Map(history.map((row) => [row.id, row]));

  const lastUserIdx = current.reduce<number>((acc, row, index) => (
    row?.role === "user" ? index : acc
  ), -1);
  if (lastUserIdx < 0) {
    return { messages: current, changed: false, touchedAssistantIds: [], bindLocalUserId: "" };
  }

  // 唯一身份锚：id / local→server 映射 / 显式 turnId。不做同文猜测。
  const currentTurnId = String(current[lastUserIdx]?.turnId || "").trim();
  const historyTurnIdByUserId = new Map<string, string>();
  for (const row of history) {
    if (row.role !== "user") continue;
    const turnId = String(row.turnId || "").trim();
    if (turnId) historyTurnIdByUserId.set(row.id, turnId);
  }
  const bindLocalUserId = Object.entries(serverIdByLocalId).find(([localId, serverId]) => {
    if (!current.some((row) => row.role === "user" && row.id === localId)) return false;
    if (historyById.has(serverId)) return true;
    return Boolean(currentTurnId && historyTurnIdByUserId.get(serverId) === currentTurnId);
  })?.[0] || "";

  let historyUserIdx = findHistoryUserAnchor(history, current[lastUserIdx], serverIdByLocalId);
  if (historyUserIdx < 0 && currentTurnId) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const row = history[i];
      if (row.role !== "user") continue;
      if (historyTurnIdByUserId.get(row.id) === currentTurnId) {
        historyUserIdx = i;
        break;
      }
    }
  }
  if (historyUserIdx < 0) {
    return { messages: current, changed: false, touchedAssistantIds: [], bindLocalUserId: "" };
  }

  const historyTail = assistantTailAfterUser(history, historyUserIdx);
  const currentTail = assistantTailAfterUser(current, lastUserIdx);
  if (historyTail.length === 0) {
    return { messages: current, changed: false, touchedAssistantIds: [], bindLocalUserId: "" };
  }

  const pickContent = options?.pickContent
    || ((historyContent: string, liveContent: string) =>
      liveContent.length > historyContent.length ? liveContent : historyContent);
  const touchedAssistantIds: string[] = [];
  const historyTailIds = new Set(historyTail.map((row) => row.id));
  const currentTailById = new Map(currentTail.map((row) => [row.id, row]));
  const mergedTail: AgentChatMessage[] = [];

  for (const historyRow of historyTail) {
    const existing = currentTailById.get(historyRow.id);
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
        touchedAssistantIds.push(existing.id);
      } else {
        mergedTail.push(existing);
      }
      continue;
    }
    // history 独有的 assistant 尾巴补进来；其 local 乐观影子行若在原地，后面跳过。
    mergedTail.push({ ...historyRow });
    touchedAssistantIds.push(historyRow.id);
  }

  for (const row of currentTail) {
    if (historyTailIds.has(row.id)) continue;
    if (historyIdForLiveRow(row, historyById, serverIdByLocalId)) continue;
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
    return { messages: current, changed: false, touchedAssistantIds: [], bindLocalUserId: "" };
  }
  return {
    messages: next,
    changed: true,
    touchedAssistantIds: [...new Set(touchedAssistantIds)],
    bindLocalUserId
  };
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

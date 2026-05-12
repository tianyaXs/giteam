export type OpencodeChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ id: string; kind: "image"; uri: string; mime?: string; filename?: string }>;
};

export type OpencodeChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: OpencodeChatMessage[];
  turnStart: number;
  loaded: boolean;
  nextCursor?: string;
  hasMore?: boolean;
};

export type OpencodeSessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type OpencodeSessionMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type OpencodeDetailedPart = Record<string, unknown> & { type?: string };

export type OpencodeDetailedMessage = {
  info?: Record<string, unknown>;
  parts?: OpencodeDetailedPart[];
};

export type OpencodeTodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
};

export type OpencodeMessageWindowCacheEntry = {
  limit: number;
  mapped: OpencodeChatMessage[];
  turnCount: number;
  hasMore: boolean;
  fetchedAt: number;
};

export type OpencodeMessagePageCacheEntry = {
  before: string;
  limit: number;
  items: OpencodeChatMessage[];
  detailsById: Record<string, OpencodeDetailedMessage>;
  nextCursor?: string;
  hasMore: boolean;
  fetchedAt: number;
};

const OPENCODE_SESSION_TITLE_MAX = 42;

function makeSessionId(): string {
  return Math.random().toString(16).slice(2, 14);
}

export function toOpencodeSessionTitle(prompt?: string, indexHint?: number): string {
  const trimmed = (prompt || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return `New Session ${indexHint ?? ""}`.trim();
  return trimmed.length > OPENCODE_SESSION_TITLE_MAX ? `${trimmed.slice(0, OPENCODE_SESSION_TITLE_MAX - 1)}…` : trimmed;
}

export function newOpencodeSession(seedPrompt?: string, indexHint?: number): OpencodeChatSession {
  const now = Date.now();
  return {
    id: `sess-${makeSessionId()}`,
    title: toOpencodeSessionTitle(seedPrompt, indexHint),
    createdAt: now,
    updatedAt: now,
    messages: [],
    turnStart: 0,
    loaded: true,
    nextCursor: undefined
  };
}

export function opencodeSessionFromSummary(summary: OpencodeSessionSummary, indexHint?: number): OpencodeChatSession {
  return {
    id: summary.id,
    title: summary.title || `Session ${indexHint ?? ""}`.trim(),
    createdAt: summary.createdAt || Date.now(),
    updatedAt: summary.updatedAt || summary.createdAt || Date.now(),
    messages: [],
    turnStart: 0,
    loaded: false,
    nextCursor: undefined
  };
}

export function buildOpencodeTurnRanges(messages: OpencodeChatMessage[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let currentStart = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg?.role === "user") {
      if (i > currentStart) out.push({ start: currentStart, end: i });
      currentStart = i;
    }
  }
  if (messages.length > currentStart) out.push({ start: currentStart, end: messages.length });
  return out;
}

export function getInitialOpencodeTurnStart(totalTurns: number): number {
  const recentVisible = 2;
  return totalTurns > recentVisible ? totalTurns - recentVisible : 0;
}

export function sliceOpencodeMessagesByTurnStart(messages: OpencodeChatMessage[], turnStart: number): {
  visible: OpencodeChatMessage[];
  hidden: OpencodeChatMessage[];
  totalTurns: number;
} {
  const turns = buildOpencodeTurnRanges(messages);
  if (turns.length === 0) return { visible: [], hidden: [], totalTurns: turns.length };
  const startTurnIndex = Math.max(0, Math.min(Math.floor(turnStart || 0), turns.length - 1));
  const startMessageIndex = turns[startTurnIndex]?.start ?? 0;
  return {
    visible: messages.slice(startMessageIndex),
    hidden: messages.slice(0, startMessageIndex),
    totalTurns: turns.length
  };
}

export function sortOpencodeSessionSummaries(rows: OpencodeSessionSummary[]): OpencodeSessionSummary[] {
  return [...rows].sort((a, b) => {
    const byCreated = (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0);
    if (byCreated !== 0) return byCreated;
    const byUpdated = (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    if (byUpdated !== 0) return byUpdated;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

import { parseConversation } from '../../messageParser';
import type { MobileChatMessage, MobileRenderedTurn, MobileTimelineItem } from '../../types';

export type RawMessageRow = Record<string, any>;

export type TurnWindowResult = {
  mergedCount: number;
  visibleTurnCount: number;
  totalTurnCount: number;
  timeline: MobileTimelineItem[];
  renderedTurns: MobileRenderedTurn[];
  chatMessages: MobileChatMessage[];
  writing: boolean;
  hasError: boolean;
  hasUserTurn: boolean;
};

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function rowCreatedAt(row: RawMessageRow): number {
  const t = Number(row?.info?.time?.created || 0);
  return Number.isFinite(t) ? t : 0;
}

export function rowId(row: RawMessageRow): string {
  return toText(row?.info?.id);
}

export function mergeMessageRows(prev: RawMessageRow[], incoming: RawMessageRow[]): RawMessageRow[] {
  const byId = new Map<string, RawMessageRow>();
  for (const row of prev) {
    const id = rowId(row);
    if (!id) continue;
    byId.set(id, row);
  }
  for (const row of incoming) {
    const id = rowId(row);
    if (!id) continue;
    byId.set(id, row);
  }
  return [...byId.values()].sort((a, b) => {
    const ta = rowCreatedAt(a);
    const tb = rowCreatedAt(b);
    if (ta !== tb) return ta - tb;
    return rowId(a).localeCompare(rowId(b));
  });
}

export function inspectTurnWindow(raw: RawMessageRow[]) {
  const parsed = parseConversation(raw);
  const timeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
  const renderedTurns = buildRenderedTurns(timeline);
  return {
    hasUserTurn: renderedTurns.some((turn) => !!turn.userMessage),
    totalTurnCount: renderedTurns.length
  };
}

function timelineStableKey(item: MobileTimelineItem): string {
  if (item.kind === 'chat') return `chat:${toText(item.message.id)}`;
  if (item.kind === 'think') return `think:${toText(item.card.id)}`;
  if (item.kind === 'event') return `event:${toText(item.event.id)}`;
  if (item.kind === 'todo') return `todo:${toText(item.todo.id)}`;
  if (item.kind === 'divider') return `divider:${toText(item.divider.id)}`;
  if (item.kind === 'error') return `error:${toText(item.error.id)}`;
  return `context:${toText(item.context.id)}`;
}

function itemSignature(item: MobileTimelineItem): string {
  if (item.kind === 'chat') return `${timelineStableKey(item)}:${item.message.role}:${toText(item.message.text).length}`;
  if (item.kind === 'think') return `${timelineStableKey(item)}:${item.card.finished ? 1 : 0}:${toText(item.card.text).length}`;
  if (item.kind === 'event') {
    return `${timelineStableKey(item)}:${toText(item.event.status)}:${toText(item.event.detail).length}:${toText(item.event.output).length}`;
  }
  if (item.kind === 'todo') {
    const items = Array.isArray(item.todo.items) ? item.todo.items.map((todo) => `${todo.id}:${todo.status}`).join(',') : '';
    return `${timelineStableKey(item)}:${item.todo.finished ? 1 : 0}:${items}`;
  }
  if (item.kind === 'divider') return `${timelineStableKey(item)}:${toText(item.divider.label)}`;
  if (item.kind === 'error') return `${timelineStableKey(item)}:${toText(item.error.code)}:${toText(item.error.text).length}`;
  const tools = Array.isArray(item.context.tools) ? item.context.tools.map((tool) => tool.id).join(',') : '';
  return `${timelineStableKey(item)}:${toText(item.context.summary).length}:${tools}`;
}

export function buildRenderedTurns(timeline: MobileTimelineItem[]): MobileRenderedTurn[] {
  const out: MobileRenderedTurn[] = [];
  let current: { id: string; createdAt: number; userMessage?: MobileChatMessage; items: MobileTimelineItem[] } | null = null;
  let seq = 0;

  const flush = () => {
    if (!current || current.items.length === 0) return;
    out.push({
      id: current.id,
      createdAt: current.createdAt,
      userMessage: current.userMessage,
      items: current.items,
      signature: [
        current.userMessage
          ? `user:${toText(current.userMessage.id)}:${toText(current.userMessage.text).length}`
          : 'user:none',
        ...current.items.map(itemSignature)
      ].join('|')
    });
  };

  for (const item of timeline) {
    if (item.kind === 'chat' && item.message.role === 'user') {
      flush();
      seq += 1;
      const stable = timelineStableKey(item);
      const fallback = `turn:seq:${seq}:${item.createdAt || 0}`;
      current = {
        // IMPORTANT: turn.id must be unique & stable, otherwise FlatList cells can overlap.
        id: stable && !stable.endsWith(':') ? `turn:${stable}` : fallback,
        createdAt: item.createdAt,
        userMessage: item.message,
        items: [item]
      };
      continue;
    }

    if (!current) {
      seq += 1;
      current = {
        id: `turn:fallback:${timelineStableKey(item) || `seq:${seq}:${item.createdAt || 0}`}`,
        createdAt: item.createdAt,
        items: [item]
      };
      continue;
    }

    current.items.push(item);
  }

  flush();
  return out;
}

export function buildTurnWindow(raw: RawMessageRow[], visibleTurnCount: number): TurnWindowResult {
  const parsed = parseConversation(raw);
  const fullTimeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
  const fullRenderedTurns = buildRenderedTurns(fullTimeline);
  const totalTurnCount = fullRenderedTurns.length;
  const safeVisibleTurns = totalTurnCount > 0 ? Math.max(1, Math.min(Math.floor(visibleTurnCount || 0), totalTurnCount)) : 0;
  const visibleRenderedTurns =
    totalTurnCount > safeVisibleTurns ? fullRenderedTurns.slice(totalTurnCount - safeVisibleTurns) : fullRenderedTurns;
  const visibleIds = new Set(visibleRenderedTurns.map((turn) => turn.id));
  const itemTurnMap = new Map<MobileTimelineItem, string>();
  for (const turn of fullRenderedTurns) {
    for (const item of turn.items) {
      itemTurnMap.set(item, turn.id);
    }
  }
  const timeline = fullTimeline.filter((item) => {
    const ownerId = itemTurnMap.get(item);
    return ownerId ? visibleIds.has(ownerId) : false;
  });
  const chatMessages = timeline
    .filter((item): item is Extract<MobileTimelineItem, { kind: 'chat' }> => item.kind === 'chat')
    .map((item) => item.message);
  return {
    mergedCount: raw.length,
    visibleTurnCount: totalTurnCount > 0 ? safeVisibleTurns : 0,
    totalTurnCount,
    timeline,
    renderedTurns: visibleRenderedTurns,
    chatMessages,
    writing: parsed.writing,
    hasError: parsed.hasError,
    hasUserTurn: fullRenderedTurns.some((turn) => !!turn.userMessage)
  };
}

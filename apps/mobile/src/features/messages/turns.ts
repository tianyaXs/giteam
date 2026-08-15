import { mergeAgentStreamText } from '../../lib/agentParts';
import { mergeToolPartState } from '../../lib/subagentTimeline';
import { parseConversation } from '../../timelineParser';
import type { MobileChatMessage, MobileEventCard, MobileRenderedTurn, MobileTimelineItem } from '../../types';

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

/** 历史分页 cursor 兼容格式：base64url({ id, time })；新 agent API 已改为全量拉取。 */
export function encodeHistoryPageCursor(row: RawMessageRow): string {
  const id = rowId(row);
  const time = rowCreatedAt(row);
  if (!id || time <= 0) return '';
  try {
    const json = JSON.stringify({ id, time });
    if (typeof globalThis.btoa !== 'function') return '';
    const base64 = globalThis.btoa(unescape(encodeURIComponent(json)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch {
    return '';
  }
}

export function oldestHistoryPageCursor(rows: RawMessageRow[]): string {
  if (!Array.isArray(rows) || rows.length <= 0) return '';
  let oldest = rows[0];
  let minTs = rowCreatedAt(oldest);
  for (const row of rows) {
    const ts = rowCreatedAt(row);
    if (ts < minTs) {
      minTs = ts;
      oldest = row;
    }
  }
  return encodeHistoryPageCursor(oldest);
}

function partKey(part: any, index: number): string {
  const id = toText(part?.id) || toText(part?.partID) || toText(part?.callID);
  if (id) return id;
  return `${toText(part?.type) || 'part'}:${index}`;
}

function mergeMessageRow(prev: RawMessageRow | undefined, incoming: RawMessageRow): RawMessageRow {
  if (!prev) return incoming;
  const prevParts = Array.isArray(prev?.parts) ? prev.parts : [];
  const incomingParts = Array.isArray(incoming?.parts) ? incoming.parts : [];
  // 禁止用空 parts 覆盖已有内容（锁屏恢复 / tailOnly 合并时会出现空 assistant stub）
  if (incomingParts.length === 0 && prevParts.length > 0) {
    return {
      ...prev,
      ...incoming,
      info: { ...(prev.info || {}), ...(incoming.info || {}) },
      parts: prevParts
    };
  }
  if (prevParts.length === 0 || incomingParts.length === 0) {
    return { ...prev, ...incoming, info: { ...(prev.info || {}), ...(incoming.info || {}) } };
  }
  const parts = [...prevParts];
  const indexByKey = new Map<string, number>();
  parts.forEach((part, index) => indexByKey.set(partKey(part, index), index));
  incomingParts.forEach((part, index) => {
    const key = partKey(part, index);
    const existingIndex = indexByKey.get(key);
    if (typeof existingIndex === 'number') {
      parts[existingIndex] = mergeMessagePart(parts[existingIndex], part);
    } else {
      indexByKey.set(key, parts.length);
      parts.push(part);
    }
  });
  return {
    ...prev,
    ...incoming,
    info: { ...(prev.info || {}), ...(incoming.info || {}) },
    parts
  };
}

function mergeMessagePart(prev: any, incoming: any): any {
  const next = { ...(prev || {}), ...(incoming || {}) };
  const prevText = typeof prev?.text === 'string' ? prev.text : '';
  const incomingText = typeof incoming?.text === 'string' ? incoming.text : '';
  if (prevText || incomingText) {
    next.text = mergeAgentStreamText(prevText, incomingText);
  }
  if (prev?.state || incoming?.state) {
    next.state = mergeToolPartState(prev?.state, incoming?.state);
  }
  return next;
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
    byId.set(id, mergeMessageRow(byId.get(id), row));
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
  if (item.kind === 'question') return `question:${toText(item.question.id)}`;
  if (item.kind === 'divider') return `divider:${toText(item.divider.id)}`;
  if (item.kind === 'error') return `error:${toText(item.error.id)}`;
  if (item.kind === 'toolBatch') return `toolBatch:${toText(item.batch.id)}`;
  return `context:${toText(item.context.id)}`;
}

function itemSignature(item: MobileTimelineItem): string {
  if (item.kind === 'chat') return `${timelineStableKey(item)}:${item.message.role}:${toText(item.message.text).length}`;
  if (item.kind === 'think') return `${timelineStableKey(item)}:${item.card.finished ? 1 : 0}:${toText(item.card.text).length}`;
  if (item.kind === 'event') {
    const steps = Array.isArray(item.event.taskSteps) ? item.event.taskSteps.length : 0;
    const lastStep = Array.isArray(item.event.taskSteps) && item.event.taskSteps.length > 0
      ? item.event.taskSteps[item.event.taskSteps.length - 1]
      : null;
    const stepSig = lastStep
      ? `${toText(lastStep.id)}:${toText(lastStep.status)}`
      : '0';
    return `${timelineStableKey(item)}:${toText(item.event.status)}:${toText(item.event.detail).length}:${toText(item.event.output).length}:steps:${steps}:${stepSig}:${toText(item.event.taskCurrentTool)}`;
  }
  if (item.kind === 'todo') {
    const items = Array.isArray(item.todo.items) ? item.todo.items.map((todo) => `${todo.id}:${todo.status}`).join(',') : '';
    return `${timelineStableKey(item)}:${item.todo.finished ? 1 : 0}:${items}`;
  }
  if (item.kind === 'question') {
    const questions = Array.isArray(item.question.questions) ? item.question.questions.map((q) => `${toText(q.question)}:${q.options.length}`).join(',') : '';
    return `${timelineStableKey(item)}:${toText(item.question.status)}:${questions}`;
  }
  if (item.kind === 'divider') return `${timelineStableKey(item)}:${toText(item.divider.label)}`;
  if (item.kind === 'error') return `${timelineStableKey(item)}:${toText(item.error.code)}:${toText(item.error.text).length}`;
  if (item.kind === 'toolBatch') {
    const events = Array.isArray(item.batch.events)
      ? item.batch.events
          .map((event: MobileEventCard) => `${event.id}:${toText(event.status)}:${toText(event.detail).length}:${toText(event.output).length}`)
          .join(',')
      : '';
    return `${timelineStableKey(item)}:${toText(item.batch.status)}:${events}`;
  }
  const tools = Array.isArray(item.context.tools) ? item.context.tools.map((tool: MobileEventCard) => tool.id).join(',') : '';
  return `${timelineStableKey(item)}:${toText(item.context.summary).length}:${tools}`;
}

export function buildRenderedTurns(timeline: MobileTimelineItem[]): MobileRenderedTurn[] {
  const out: MobileRenderedTurn[] = [];
  let current: { id: string; createdAt: number; userMessage?: MobileChatMessage; items: MobileTimelineItem[] } | null = null;
  let pendingAssistant: MobileTimelineItem[] = [];
  let seq = 0;

  const isUserChat = (item: MobileTimelineItem): item is Extract<MobileTimelineItem, { kind: 'chat' }> =>
    item.kind === 'chat' && item.message.role === 'user';

  const flush = () => {
    if (!current || current.items.length === 0) return;
    if (!current.userMessage) {
      pendingAssistant.push(...current.items.filter((item) => !isUserChat(item)));
      current = null;
      return;
    }
    out.push({
      id: current.id,
      createdAt: current.createdAt,
      userMessage: current.userMessage,
      items: current.items,
      signature: [
        `user:${toText(current.userMessage.id)}:${toText(current.userMessage.text).length}`,
        ...current.items.map(itemSignature)
      ].join('|')
    });
    current = null;
  };

  for (const item of timeline) {
    if (isUserChat(item)) {
      flush();
      seq += 1;
      const stable = timelineStableKey(item);
      const fallback = `turn:seq:${seq}:${item.createdAt || 0}`;
      const assistantBeforeUser = pendingAssistant.length > 0 ? [...pendingAssistant] : [];
      pendingAssistant = [];
      current = {
        id: stable && !stable.endsWith(':') ? `turn:${stable}` : fallback,
        createdAt: item.createdAt,
        userMessage: item.message,
        items: [item, ...assistantBeforeUser]
      };
      continue;
    }

    if (!current) {
      pendingAssistant.push(item);
      continue;
    }

    current.items.push(item);
  }

  flush();
  // 权威 user 尚未进 rawRows（仅有乐观气泡）时，assistant 不能挂到上一轮，
  // 否则列表底部乐观轮永远是空的，流式内容要等最终 sync 才「一口气」出现。
  if (pendingAssistant.length > 0) {
    seq += 1;
    const createdAt = pendingAssistant[0]?.createdAt || Date.now();
    out.push({
      id: `turn:orphan-assistant:${seq}:${createdAt}`,
      createdAt,
      items: pendingAssistant,
      signature: ['user:none', ...pendingAssistant.map(itemSignature)].join('|')
    });
  }
  return out;
}

// 缓存结构，用于避免重复解析
let _cachedRaw: RawMessageRow[] | null = null;
let _cachedParsed: { timeline: MobileTimelineItem[]; writing: boolean; hasError: boolean } | null = null;
let _cachedRenderedTurns: MobileRenderedTurn[] | null = null;

function getCachedParsed(raw: RawMessageRow[]) {
  if (_cachedRaw === raw && _cachedParsed) {
    return _cachedParsed;
  }
  const parsed = parseConversation(raw);
  _cachedRaw = raw;
  _cachedParsed = parsed;
  _cachedRenderedTurns = null; // 清除 rendered turns 缓存
  return parsed;
}

function getCachedRenderedTurns(timeline: MobileTimelineItem[]) {
  if (_cachedRenderedTurns) {
    return _cachedRenderedTurns;
  }
  const turns = buildRenderedTurns(timeline);
  _cachedRenderedTurns = turns;
  return turns;
}

export function buildTurnWindow(raw: RawMessageRow[], visibleTurnCount: number): TurnWindowResult {
  const parsed = getCachedParsed(raw);
  const fullTimeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
  const fullRenderedTurns = getCachedRenderedTurns(fullTimeline);
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

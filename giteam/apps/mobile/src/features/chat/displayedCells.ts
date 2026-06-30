import { toText } from '../../lib/text';
import type { MobileRenderedTurn, MobileTimelineItem } from '../../types';

const INITIAL_CELL_LIMIT = 6;
const INITIAL_CELL_WINDOW_WEIGHT = 7.4;
const INITIAL_CELL_WINDOW_MAX = 12;
const CHAT_ESTIMATED_CELL_HEIGHT = 156;

export type DisplayedTurnCell = MobileRenderedTurn & { parentTurnId?: string };

function timelineItemKey(item: MobileTimelineItem, index: number): string {
  if (item.kind === 'chat') return `chat:${toText(item.message.id) || index}`;
  if (item.kind === 'think') return `think:${toText(item.card.id) || index}`;
  if (item.kind === 'event') return `event:${toText(item.event.id) || index}`;
  if (item.kind === 'context') return `context:${toText(item.context.id) || index}`;
  if (item.kind === 'todo') return `todo:${toText(item.todo.id) || index}`;
  if (item.kind === 'question') return `question:${toText(item.question.id) || index}`;
  if (item.kind === 'divider') return `divider:${toText(item.divider.id) || index}`;
  return `error:${toText(item.error.id) || index}`;
}

export function getDisplayedCellItemType(cell: DisplayedTurnCell): string {
  if (cell.userMessage) return 'user';
  const item = cell.items[0];
  if (!item) return 'turn';
  if (item.kind === 'chat') return item.message.role === 'user' ? 'user' : 'assistant';
  return item.kind;
}

export function flattenTurnsForList(turns: MobileRenderedTurn[]): DisplayedTurnCell[] {
  const out: DisplayedTurnCell[] = [];
  turns.forEach((turn) => {
    if (turn.userMessage) {
      out.push({
        ...turn,
        id: `${turn.id}:cell:user`,
        parentTurnId: turn.id,
        items: [],
        signature: `${turn.signature}:cell:user`
      });
    }
    turn.items.forEach((item, itemIndex) => {
      if (item.kind === 'chat' && item.message.role === 'user') return;
      const key = timelineItemKey(item, itemIndex);
      out.push({
        id: `${turn.id}:cell:${itemIndex}:${key}`,
        parentTurnId: turn.id,
        createdAt: item.createdAt || turn.createdAt,
        items: [item],
        signature: `${turn.signature}:cell:${itemIndex}:${key}:${item.createdAt || 0}`
      });
    });
  });
  return out.length > 0 ? out : turns;
}

export function takeTailCells(cells: DisplayedTurnCell[], visibleCount: number): DisplayedTurnCell[] {
  const count = Math.max(1, Math.floor(visibleCount || INITIAL_CELL_LIMIT));
  if (cells.length <= count) return cells;
  return cells.slice(cells.length - count);
}

function estimateDisplayedCellWeight(cell: DisplayedTurnCell): number {
  if (cell.userMessage) {
    const textLength = toText(cell.userMessage.text).trim().length;
    return Math.min(1.8, Math.max(1, textLength / 120));
  }
  const item = cell.items[0];
  if (!item) return 0.9;
  if (item.kind === 'chat') {
    const base = item.message.role === 'user' ? 1 : 1.18;
    const textLength = toText(item.message.text).trim().length;
    return Math.min(2.45, Math.max(base, textLength / 180));
  }
  if (item.kind === 'question') return 1.5;
  if (item.kind === 'think' || item.kind === 'todo') return 1.3;
  if (item.kind === 'error') return 1.25;
  if (item.kind === 'divider') return 0.45;
  return 0.95;
}

export function getInitialVisibleCellLimit(cells: DisplayedTurnCell[]): number {
  if (cells.length <= INITIAL_CELL_LIMIT) return cells.length || INITIAL_CELL_LIMIT;
  let weight = 0;
  let count = 0;
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    weight += estimateDisplayedCellWeight(cells[i]);
    count += 1;
    if (count >= INITIAL_CELL_LIMIT && (weight >= INITIAL_CELL_WINDOW_WEIGHT || count >= INITIAL_CELL_WINDOW_MAX)) {
      break;
    }
  }
  return Math.max(INITIAL_CELL_LIMIT, Math.min(cells.length, count));
}

function estimateCellHeight(cell: DisplayedTurnCell): number {
  const item = cell.items[0];
  if (cell.userMessage) {
    const textLength = toText(cell.userMessage.text).trim().length;
    return Math.min(210, Math.max(82, 62 + Math.ceil(textLength / 18) * 20));
  }
  if (item?.kind === 'chat') {
    const textLength = toText(item.message.text).trim().length;
    return Math.min(360, Math.max(96, 76 + Math.ceil(textLength / 24) * 20));
  }
  if (item?.kind === 'question') return 180;
  if (item?.kind === 'think' || item?.kind === 'todo') return 118;
  if (item?.kind === 'error') return 132;
  if (item?.kind === 'divider') return 38;
  return CHAT_ESTIMATED_CELL_HEIGHT;
}

export function getViewportAwareVisibleCellLimit(
  cells: DisplayedTurnCell[],
  viewportH: number,
  bottomInset: number,
  measuredHeights: Record<string, number>
): number {
  if (cells.length <= INITIAL_CELL_LIMIT) return cells.length || INITIAL_CELL_LIMIT;
  const available = Math.max(260, viewportH - bottomInset + 36);
  let height = 0;
  let count = 0;
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    const cell = cells[i];
    height += measuredHeights[cell.id] || estimateCellHeight(cell);
    count += 1;
    if (count >= INITIAL_CELL_LIMIT && (height >= available || count >= INITIAL_CELL_WINDOW_MAX)) {
      break;
    }
  }
  return Math.max(INITIAL_CELL_LIMIT, Math.min(cells.length, count));
}

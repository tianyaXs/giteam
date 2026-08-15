import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileRenderedTurn, MobileTodoCard } from '../../types';
import type { DisplayedTurnCell } from './displayedCells';

type ViewableRange = {
  startIndex: number;
  endIndex: number;
};

function todoFromCell(cell: DisplayedTurnCell | undefined): MobileTodoCard | null {
  const item = cell?.items?.[0];
  if (!item || item.kind !== 'todo') return null;
  return item.todo;
}

function collectTodoCards(turns: MobileRenderedTurn[]): MobileTodoCard[] {
  const out: MobileTodoCard[] = [];
  for (let turnIdx = turns.length - 1; turnIdx >= 0; turnIdx -= 1) {
    const turn = turns[turnIdx];
    for (let itemIdx = turn.items.length - 1; itemIdx >= 0; itemIdx -= 1) {
      const item = turn.items[itemIdx];
      if (item.kind === 'todo') out.push(item.todo);
    }
  }
  return out;
}

/**
 * 对齐桌面端：视口内有 todo 卡片时跟进该卡片；否则回退到最新/流式进度。
 */
function pickViewportTodoCard(params: {
  cells: DisplayedTurnCell[];
  range: ViewableRange | null;
  streamTodoCard: MobileTodoCard | null;
  sessionWorking: boolean;
  historyTodos: MobileTodoCard[];
}): MobileTodoCard | null {
  const { cells, historyTodos, range, sessionWorking, streamTodoCard } = params;
  const nearLatest =
    !range || cells.length <= 0 || range.endIndex >= Math.max(0, cells.length - 3);

  // 生成中且贴着最新消息：优先流式进度（实时 0/1），避免历史卡抢占。
  if (sessionWorking && streamTodoCard && nearLatest) {
    return streamTodoCard;
  }

  if (range && cells.length > 0) {
    const start = Math.max(0, Math.min(cells.length - 1, range.startIndex));
    const end = Math.max(start, Math.min(cells.length - 1, range.endIndex));
    const todosInView: Array<{ index: number; todo: MobileTodoCard }> = [];
    for (let i = start; i <= end; i += 1) {
      const todo = todoFromCell(cells[i]);
      if (todo) todosInView.push({ index: i, todo });
    }
    if (todosInView.length > 0) {
      // 取靠近视口上部锚点的 todo（约 15% 处），与桌面端 anchorY 策略一致。
      const anchor = start + Math.floor((end - start) * 0.15);
      todosInView.sort((a, b) => Math.abs(a.index - anchor) - Math.abs(b.index - anchor));
      return todosInView[0].todo;
    }
  }

  if (sessionWorking && streamTodoCard) return streamTodoCard;
  if (historyTodos.length > 0) return historyTodos[0];
  return streamTodoCard;
}

export function useTodoDockController(params: {
  displayedTurns: MobileRenderedTurn[];
  displayedTurnCells: DisplayedTurnCell[];
  viewableRange: ViewableRange | null;
  sessionId: string;
  sessionWorking: boolean;
  streamTodoCard: MobileTodoCard | null;
}) {
  const {
    displayedTurnCells,
    displayedTurns,
    sessionId,
    sessionWorking,
    streamTodoCard,
    viewableRange
  } = params;

  /** 默认收起为右上角气泡；仅用户点击才展开轻菜单。 */
  const [todoDockCollapsed, setTodoDockCollapsed] = useState(true);
  const [dismissedTodoCardId, setDismissedTodoCardId] = useState('');
  const lastCardIdRef = useRef('');

  useEffect(() => {
    setDismissedTodoCardId('');
    setTodoDockCollapsed(true);
    lastCardIdRef.current = '';
  }, [sessionId]);

  const historyTodos = useMemo(() => collectTodoCards(displayedTurns), [displayedTurns]);

  const latestTodoCard = useMemo(
    () =>
      pickViewportTodoCard({
        cells: displayedTurnCells,
        range: viewableRange,
        streamTodoCard,
        sessionWorking,
        historyTodos
      }),
    [displayedTurnCells, historyTodos, sessionWorking, streamTodoCard, viewableRange]
  );

  useEffect(() => {
    const id = latestTodoCard?.id || '';
    if (!id) {
      setTodoDockCollapsed(true);
      lastCardIdRef.current = '';
      return;
    }
    setDismissedTodoCardId((prev) => (prev && prev !== id ? '' : prev));
    // 仅在「新的进度会话」出现时收回展开态；视口翻页切换卡片时保持用户当前展开偏好。
    if (lastCardIdRef.current && lastCardIdRef.current.startsWith('todo:stream:') && id.startsWith('todo:stream:')) {
      lastCardIdRef.current = id;
      return;
    }
    if (lastCardIdRef.current !== id && id.startsWith('todo:stream:')) {
      setTodoDockCollapsed(true);
    }
    lastCardIdRef.current = id;
  }, [latestTodoCard?.id]);

  const toggleTodoDock = useCallback(() => {
    setTodoDockCollapsed((prev) => !prev);
  }, []);

  const collapseTodoDock = useCallback(() => {
    setTodoDockCollapsed(true);
  }, []);

  const dismissTodoDock = useCallback(() => {
    setDismissedTodoCardId(latestTodoCard?.id || '');
    setTodoDockCollapsed(true);
  }, [latestTodoCard?.id]);

  return {
    collapseTodoDock,
    dismissedTodoCardId,
    dismissTodoDock,
    latestTodoCard,
    todoDockCollapsed,
    toggleTodoDock
  };
}

import { useMemo, useRef, type MutableRefObject } from 'react';
import type { ChatViewportSnapshot } from './useChatListController';

export function useChatCellWindow<Cell extends { id: string }>(props: {
  allDisplayedTurnCells: Cell[];
  sessionId: string;
  chatListResetKey: number;
  chatViewportSnapshotRef: MutableRefObject<Record<string, ChatViewportSnapshot>>;
}) {
  const {
    allDisplayedTurnCells,
    chatListResetKey,
    chatViewportSnapshotRef,
    sessionId,
  } = props;

  const displayedTurnCellsRef = useRef<Cell[]>([]);
  const visibleCellCountRef = useRef(0);
  const displayedTurnCells = useMemo(
    () => allDisplayedTurnCells,
    [allDisplayedTurnCells]
  );

  const visibleCellCount = displayedTurnCells.length;
  const hasHiddenCells = false;
  const historyProgress = allDisplayedTurnCells.length > 0
    ? Math.min(1, Math.max(0, displayedTurnCells.length / allDisplayedTurnCells.length))
    : 1;
  const historyProgressWidth = `${Math.max(6, Math.round(historyProgress * 100))}%` as `${number}%`;

  const activeViewportSnapshot = sessionId ? chatViewportSnapshotRef.current[sessionId] : undefined;
  const canRestoreChatSnapshot = !!activeViewportSnapshot
    && !activeViewportSnapshot.nearBottom
    && Date.now() - activeViewportSnapshot.updatedAt <= 30 * 60 * 1000;

  const initialChatScrollIndex = useMemo(() => {
    if (!canRestoreChatSnapshot || !activeViewportSnapshot) return undefined;
    if (activeViewportSnapshot.firstVisibleCellId) {
      const exact = displayedTurnCells.findIndex((cell) => cell.id === activeViewportSnapshot.firstVisibleCellId);
      if (exact >= 0) return exact;
    }
    if (typeof activeViewportSnapshot.firstVisibleIndex === 'number') {
      return Math.max(0, Math.min(displayedTurnCells.length - 1, activeViewportSnapshot.firstVisibleIndex));
    }
    if (typeof activeViewportSnapshot.firstVisibleIndexFromEnd === 'number') {
      return Math.max(0, displayedTurnCells.length - 1 - activeViewportSnapshot.firstVisibleIndexFromEnd);
    }
    return undefined;
  }, [activeViewportSnapshot, canRestoreChatSnapshot, displayedTurnCells]);

  const initialChatScrollOffset = canRestoreChatSnapshot
    ? Math.max(0, Number(activeViewportSnapshot?.firstVisibleOffset || 0))
    : undefined;
  const chatStartsFromBottom = !canRestoreChatSnapshot;
  const chatListMountKey = `chat-list-${chatListResetKey}-${sessionId || 'draft'}-${chatStartsFromBottom ? 'bottom' : 'restore'}`;

  displayedTurnCellsRef.current = displayedTurnCells;
  visibleCellCountRef.current = visibleCellCount;
  return {
    displayedTurnCells,
    displayedTurnCellsRef,
    visibleCellCount,
    visibleCellCountRef,
    hasHiddenCells,
    historyProgressWidth,
    initialChatScrollIndex,
    initialChatScrollOffset,
    chatStartsFromBottom,
    chatListMountKey,
    bumpCellWindowVersion: () => {}
  };
}

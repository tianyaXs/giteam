import { useMemo, useRef } from 'react';

export function useChatCellWindow<Cell extends { id: string }>(props: {
  allDisplayedTurnCells: Cell[];
  sessionId: string;
}) {
  const {
    allDisplayedTurnCells,
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

  const chatListMountKey = `chat-list-${sessionId || 'draft'}`;

  displayedTurnCellsRef.current = displayedTurnCells;
  visibleCellCountRef.current = visibleCellCount;
  return {
    displayedTurnCells,
    displayedTurnCellsRef,
    visibleCellCount,
    visibleCellCountRef,
    hasHiddenCells,
    historyProgressWidth,
    chatListMountKey,
    bumpCellWindowVersion: () => {}
  };
}

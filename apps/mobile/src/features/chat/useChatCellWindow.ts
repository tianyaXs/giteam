import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { ChatViewportSnapshot } from './useChatListController';

export function useChatCellWindow<Cell extends { id: string }>(props: {
  allDisplayedTurnCells: Cell[];
  sessionId: string;
  windowHeight: number;
  messageBottomInset: number;
  chatListResetKey: number;
  initialCellLimit: number;
  messageViewportHRef: MutableRefObject<number>;
  chatCellHeightMapRef: MutableRefObject<Record<string, number>>;
  chatViewportSnapshotRef: MutableRefObject<Record<string, ChatViewportSnapshot>>;
  takeTailCells: (cells: Cell[], visibleCount: number) => Cell[];
  getInitialVisibleCellLimit: (cells: Cell[]) => number;
  getViewportAwareVisibleCellLimit: (
    cells: Cell[],
    viewportH: number,
    bottomInset: number,
    measuredHeights: Record<string, number>
  ) => number;
}) {
  const {
    allDisplayedTurnCells,
    chatCellHeightMapRef,
    chatListResetKey,
    chatViewportSnapshotRef,
    getInitialVisibleCellLimit,
    getViewportAwareVisibleCellLimit,
    initialCellLimit,
    messageBottomInset,
    messageViewportHRef,
    sessionId,
    takeTailCells,
    windowHeight
  } = props;

  const [cellWindowVersion, setCellWindowVersion] = useState(0);
  const displayedTurnCellsRef = useRef<Cell[]>([]);
  const visibleCellCountRef = useRef(initialCellLimit);
  const sessionVisibleCellCountRef = useRef<Record<string, number>>({});

  const seededVisibleCellCount = useMemo(
    () => Math.max(
      getInitialVisibleCellLimit(allDisplayedTurnCells),
      getViewportAwareVisibleCellLimit(
        allDisplayedTurnCells,
        messageViewportHRef.current || windowHeight,
        messageBottomInset,
        chatCellHeightMapRef.current
      )
    ),
    [
      allDisplayedTurnCells,
      chatCellHeightMapRef,
      getInitialVisibleCellLimit,
      getViewportAwareVisibleCellLimit,
      messageBottomInset,
      messageViewportHRef,
      windowHeight
    ]
  );

  const visibleCellCount = Math.max(
    seededVisibleCellCount,
    Number(sessionVisibleCellCountRef.current[sessionId] || 0)
  );

  const displayedTurnCells = useMemo(
    () => takeTailCells(allDisplayedTurnCells, visibleCellCount),
    [allDisplayedTurnCells, cellWindowVersion, takeTailCells, visibleCellCount]
  );

  const hasHiddenCells = allDisplayedTurnCells.length > displayedTurnCells.length;
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
    if (typeof activeViewportSnapshot.firstVisibleIndexFromEnd === 'number') {
      return Math.max(0, displayedTurnCells.length - 1 - activeViewportSnapshot.firstVisibleIndexFromEnd);
    }
    return undefined;
  }, [activeViewportSnapshot, canRestoreChatSnapshot, displayedTurnCells]);

  const initialChatScrollOffset = canRestoreChatSnapshot
    ? Math.max(0, Number(activeViewportSnapshot?.firstVisibleOffset || 0))
    : undefined;
  const chatStartsFromBottom = !canRestoreChatSnapshot;
  const chatListMountKey = `chat-list-${chatListResetKey}-${canRestoreChatSnapshot ? sessionId || 'draft' : 'bottom'}`;

  displayedTurnCellsRef.current = displayedTurnCells;
  visibleCellCountRef.current = visibleCellCount;

  return {
    displayedTurnCells,
    displayedTurnCellsRef,
    visibleCellCount,
    visibleCellCountRef,
    sessionVisibleCellCountRef,
    hasHiddenCells,
    historyProgressWidth,
    initialChatScrollIndex,
    initialChatScrollOffset,
    chatStartsFromBottom,
    chatListMountKey,
    bumpCellWindowVersion: () => setCellWindowVersion((value) => value + 1)
  };
}

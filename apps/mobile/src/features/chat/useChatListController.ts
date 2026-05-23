import { useCallback, useMemo, useRef, useState } from 'react';

export type ChatViewportSnapshot = {
  scrollY: number;
  viewportH: number;
  contentH: number;
  distanceFromBottom: number;
  visibleCellCount: number;
  firstVisibleCellId?: string;
  firstVisibleIndex?: number;
  firstVisibleIndexFromEnd?: number;
  firstVisibleOffset?: number;
  nearBottom: boolean;
  updatedAt: number;
};

export function useChatListController<Cell extends { id?: string }>(props: {
  initialCellLimit: number;
  chatBottomProximity: number;
  historyPrefetchCooldownMs: number;
}) {
  const { chatBottomProximity, historyPrefetchCooldownMs, initialCellLimit } = props;
  const [showLatestJump, setShowLatestJump] = useState(false);

  const messageScrollRef = useRef<any>(null);
  const forceScrollToLatestUntilRef = useRef(0);
  const latestJumpVisibleRef = useRef(false);
  const latestJumpLastChangeRef = useRef(0);
  const chatViewportSnapshotRef = useRef<Record<string, ChatViewportSnapshot>>({});
  const chatViewableRangeRef = useRef<{ startIndex: number; endIndex: number }>({ startIndex: 0, endIndex: 0 });
  const messageScrollYRef = useRef(0);
  const messageViewportHRef = useRef(0);
  const messageContentHRef = useRef(0);
  const historyPrefetchLastAtRef = useRef(0);
  const messageUserScrollingRef = useRef(false);
  const scrollReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatViewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 1 }), []);

  const clearScrollReleaseTimer = useCallback(() => {
    if (!scrollReleaseTimerRef.current) return;
    clearTimeout(scrollReleaseTimerRef.current);
    scrollReleaseTimerRef.current = null;
  }, []);

  const getDistanceFromBottom = useCallback((scrollY = messageScrollYRef.current) => {
    return Math.max(0, messageContentHRef.current - messageViewportHRef.current - scrollY);
  }, []);

  const updateLatestJumpVisibility = useCallback((distanceFromBottom: number, immediate = false) => {
    const now = Date.now();
    const currentlyVisible = latestJumpVisibleRef.current;
    const shouldShow = distanceFromBottom > 112;
    const shouldHide = distanceFromBottom < 42 || Date.now() < forceScrollToLatestUntilRef.current;
    let next = currentlyVisible;
    if (currentlyVisible) {
      if (shouldHide) next = false;
    } else if (shouldShow) {
      next = true;
    }
    if (next === currentlyVisible) return;
    if (!immediate && now - latestJumpLastChangeRef.current < 220) return;
    latestJumpVisibleRef.current = next;
    latestJumpLastChangeRef.current = now;
    setShowLatestJump(next);
  }, []);

  const onChatViewableItemsChanged = useCallback((info: { viewableItems: Array<{ index?: number | null }> }) => {
    const indices = info.viewableItems
      .map((item) => Number(item.index))
      .filter((index) => Number.isFinite(index) && index >= 0);
    if (indices.length <= 0) return;
    chatViewableRangeRef.current = {
      startIndex: Math.min(...indices),
      endIndex: Math.max(...indices)
    };
  }, []);

  const scrollToLatest = useCallback((animated?: boolean) => {
    if (messageUserScrollingRef.current) return;
    try {
      messageScrollRef.current?.scrollToEnd({ animated });
    } catch {}
  }, []);

  const jumpToLatest = useCallback(() => {
    messageUserScrollingRef.current = false;
    forceScrollToLatestUntilRef.current = Date.now() + 900;
    latestJumpVisibleRef.current = false;
    latestJumpLastChangeRef.current = Date.now();
    setShowLatestJump(false);
    scrollToLatest(true);
    [120, 320].forEach((delay) => {
      setTimeout(() => scrollToLatest(false), delay);
    });
  }, [scrollToLatest]);

  const prepareCellLayoutAdjustment = useCallback((_cellId: string, _previousHeight: number) => {}, []);

  const settleCellLayoutAdjustment = useCallback((_cellId: string, _nextHeight: number) => {}, []);

  const onMessageListScroll = useCallback((y: number, viewportH?: number, contentH?: number) => {
    messageScrollYRef.current = y;
    if (typeof viewportH === 'number' && Number.isFinite(viewportH)) {
      messageViewportHRef.current = viewportH;
    }
    if (typeof contentH === 'number' && Number.isFinite(contentH)) {
      messageContentHRef.current = contentH;
    }
    updateLatestJumpVisibility(getDistanceFromBottom(y));
  }, [getDistanceFromBottom, updateLatestJumpVisibility]);

  const handleScrollBeginDrag = useCallback(() => {
    clearScrollReleaseTimer();
    forceScrollToLatestUntilRef.current = 0;
    messageUserScrollingRef.current = true;
  }, [clearScrollReleaseTimer]);

  const handleScrollEndDrag = useCallback(() => {
    clearScrollReleaseTimer();
    scrollReleaseTimerRef.current = setTimeout(() => {
      scrollReleaseTimerRef.current = null;
      messageUserScrollingRef.current = false;
      updateLatestJumpVisibility(getDistanceFromBottom(), true);
    }, 140);
  }, [clearScrollReleaseTimer, getDistanceFromBottom, updateLatestJumpVisibility]);

  const handleMomentumScrollBegin = useCallback(() => {
    clearScrollReleaseTimer();
    messageUserScrollingRef.current = true;
  }, [clearScrollReleaseTimer]);

  const handleMomentumScrollEnd = useCallback(() => {
    clearScrollReleaseTimer();
    messageUserScrollingRef.current = false;
    updateLatestJumpVisibility(getDistanceFromBottom(), true);
  }, [clearScrollReleaseTimer, getDistanceFromBottom, updateLatestJumpVisibility]);

  const handleContentSizeChange = useCallback((height: number, opts: {
    canLoadEarlierHistory: boolean;
    loadingOlder: boolean;
    onLoadOlderMessages: () => void;
  }) => {
    messageContentHRef.current = Number(height || 0);
    updateLatestJumpVisibility(getDistanceFromBottom());
    if (
      opts.canLoadEarlierHistory
      && !opts.loadingOlder
      && messageViewportHRef.current > 0
      && messageContentHRef.current < messageViewportHRef.current + 48
    ) {
      const now = Date.now();
      if (now - historyPrefetchLastAtRef.current > historyPrefetchCooldownMs) {
        historyPrefetchLastAtRef.current = now;
        opts.onLoadOlderMessages();
      }
    }
  }, [getDistanceFromBottom, historyPrefetchCooldownMs, updateLatestJumpVisibility]);

  const handleListLayout = useCallback((height: number) => {
    messageViewportHRef.current = Number(height || 0);
  }, []);

  const rememberCurrentSessionViewport = useCallback((targetSessionId: string, params: {
    displayedTurnCells: Cell[];
    visibleCellCount: number;
  }) => {
    const sid = String(targetSessionId || '').trim();
    if (!sid) return;
    const cells = params.displayedTurnCells;
    const visibleCellCount = Math.max(initialCellLimit, Number(params.visibleCellCount || cells.length || initialCellLimit));
    const viewportH = Math.max(0, Number(messageViewportHRef.current || 0));
    const contentH = Math.max(0, Number(messageContentHRef.current || 0));
    const fallbackY = Math.max(0, Number(messageScrollYRef.current || 0));
    let scrollY = fallbackY;
    try {
      const currentOffset = Number(messageScrollRef.current?.getAbsoluteLastScrollOffset?.());
      if (Number.isFinite(currentOffset)) scrollY = Math.max(0, currentOffset);
    } catch {}
    const distanceFromBottom = Math.max(0, contentH - viewportH - scrollY);
    const viewableRange = chatViewableRangeRef.current;
    let firstVisibleIndex = Math.max(0, Math.floor(viewableRange.startIndex || 0));
    let lastVisibleIndex = Math.max(firstVisibleIndex, Math.floor(viewableRange.endIndex || firstVisibleIndex));
    try {
      const indices = messageScrollRef.current?.computeVisibleIndices?.();
      if (Array.isArray(indices) && indices.length > 0) {
        const normalized = indices
          .map((index) => Number(index))
          .filter((index) => Number.isFinite(index) && index >= 0);
        if (normalized.length > 0) {
          firstVisibleIndex = Math.min(...normalized);
          lastVisibleIndex = Math.max(...normalized);
        }
      } else if (indices && Number.isFinite(Number(indices.startIndex))) {
        firstVisibleIndex = Math.max(0, Number(indices.startIndex));
        lastVisibleIndex = Number.isFinite(Number(indices.endIndex))
          ? Math.max(firstVisibleIndex, Number(indices.endIndex))
          : firstVisibleIndex;
      }
    } catch {}
    const firstCell = cells[firstVisibleIndex];
    let firstVisibleOffset = 0;
    try {
      const layout = messageScrollRef.current?.getLayout?.(firstVisibleIndex);
      if (layout && Number.isFinite(Number(layout.y))) {
        firstVisibleOffset = Math.max(0, scrollY - Number(layout.y));
      }
    } catch {}
    const latestCellVisible = cells.length > 0 && lastVisibleIndex >= cells.length - 1;
    chatViewportSnapshotRef.current[sid] = {
      scrollY,
      viewportH,
      contentH,
      distanceFromBottom,
      visibleCellCount,
      firstVisibleCellId: firstCell?.id,
      firstVisibleIndex,
      firstVisibleIndexFromEnd: firstCell ? Math.max(0, cells.length - 1 - firstVisibleIndex) : undefined,
      firstVisibleOffset,
      nearBottom: latestCellVisible || distanceFromBottom <= chatBottomProximity,
      updatedAt: Date.now()
    };
  }, [chatBottomProximity, initialCellLimit]);

  const resetListInteractionState = useCallback(() => {
    clearScrollReleaseTimer();
    forceScrollToLatestUntilRef.current = 0;
    messageUserScrollingRef.current = false;
    messageScrollYRef.current = 0;
    messageViewportHRef.current = 0;
    messageContentHRef.current = 0;
    latestJumpVisibleRef.current = false;
    latestJumpLastChangeRef.current = Date.now();
    historyPrefetchLastAtRef.current = 0;
    setShowLatestJump(false);
  }, [clearScrollReleaseTimer]);

  return {
    showLatestJump,
    messageScrollRef,
    forceScrollToLatestUntilRef,
    chatViewportSnapshotRef,
    messageScrollYRef,
    messageViewportHRef,
    messageContentHRef,
    messageUserScrollingRef,
    chatViewabilityConfig,
    onChatViewableItemsChanged,
    scrollToLatest,
    jumpToLatest,
    prepareCellLayoutAdjustment,
    settleCellLayoutAdjustment,
    onMessageListScroll,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleMomentumScrollBegin,
    handleMomentumScrollEnd,
    handleContentSizeChange,
    handleListLayout,
    rememberCurrentSessionViewport,
    resetListInteractionState,
  };
}

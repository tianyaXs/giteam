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
  debugLog?: (message: string) => void;
}) {
  const { chatBottomProximity, debugLog, historyPrefetchCooldownMs, initialCellLimit } = props;
  const [showLatestJump, setShowLatestJump] = useState(false);
  const [suppressFloatingDocks, setSuppressFloatingDocks] = useState(false);

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
  const historyLoadAnchorRef = useRef<{ scrollY: number; contentH: number; viewportH: number; at: number } | null>(null);
  const historyLoadRequestLastAtRef = useRef(0);
  const lastUserScrollIntentAtRef = useRef(0);
  const messageUserScrollingRef = useRef(false);
  const scrollReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatingDockReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatViewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 1 }), []);

  const clearScrollReleaseTimer = useCallback(() => {
    if (!scrollReleaseTimerRef.current) return;
    clearTimeout(scrollReleaseTimerRef.current);
    scrollReleaseTimerRef.current = null;
  }, []);

  const clearFloatingDockReleaseTimer = useCallback(() => {
    if (!floatingDockReleaseTimerRef.current) return;
    clearTimeout(floatingDockReleaseTimerRef.current);
    floatingDockReleaseTimerRef.current = null;
  }, []);

  const holdFloatingDocks = useCallback(() => {
    clearFloatingDockReleaseTimer();
    setSuppressFloatingDocks(true);
  }, [clearFloatingDockReleaseTimer]);

  const releaseFloatingDocksSoon = useCallback(() => {
    clearFloatingDockReleaseTimer();
    floatingDockReleaseTimerRef.current = setTimeout(() => {
      floatingDockReleaseTimerRef.current = null;
      setSuppressFloatingDocks(false);
    }, 420);
  }, [clearFloatingDockReleaseTimer]);

  const getDistanceFromBottom = useCallback((scrollY = messageScrollYRef.current) => {
    return Math.max(0, scrollY);
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
      messageScrollRef.current?.scrollToOffset({ offset: 0, animated });
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

  const markHistoryLoadAnchor = useCallback((source = 'unknown') => {
    const now = Date.now();
    const scrollY = Math.max(0, Number(messageScrollYRef.current || 0));
    const contentH = Math.max(0, Number(messageContentHRef.current || 0));
    const viewportH = Math.max(0, Number(messageViewportHRef.current || 0));
    const recentUserIntent = now - lastUserScrollIntentAtRef.current < 2400;
    const requestCooldown = now - historyLoadRequestLastAtRef.current < 1600;
    if (scrollY < 80 || contentH <= 0 || viewportH <= 0 || !recentUserIntent || requestCooldown) {
      historyLoadAnchorRef.current = null;
      debugLog?.(`chat.history.anchor rejected source=${source} y=${Math.round(scrollY)} contentH=${Math.round(contentH)} viewportH=${Math.round(viewportH)} recentUser=${recentUserIntent ? 1 : 0} cooldown=${requestCooldown ? 1 : 0}`);
      return false;
    }
    historyLoadRequestLastAtRef.current = now;
    historyLoadAnchorRef.current = {
      scrollY,
      contentH,
      viewportH,
      at: Date.now()
    };
    debugLog?.(`chat.history.anchor set source=${source} y=${Math.round(scrollY)} contentH=${Math.round(contentH)} viewportH=${Math.round(viewportH)}`);
    return true;
  }, [debugLog]);

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
    holdFloatingDocks();
    forceScrollToLatestUntilRef.current = 0;
    lastUserScrollIntentAtRef.current = Date.now();
    messageUserScrollingRef.current = true;
  }, [clearScrollReleaseTimer, holdFloatingDocks]);

  const handleScrollEndDrag = useCallback(() => {
    clearScrollReleaseTimer();
    scrollReleaseTimerRef.current = setTimeout(() => {
      scrollReleaseTimerRef.current = null;
      messageUserScrollingRef.current = false;
      updateLatestJumpVisibility(getDistanceFromBottom(), true);
    }, 140);
    releaseFloatingDocksSoon();
  }, [clearScrollReleaseTimer, getDistanceFromBottom, releaseFloatingDocksSoon, updateLatestJumpVisibility]);

  const handleMomentumScrollBegin = useCallback(() => {
    clearScrollReleaseTimer();
    holdFloatingDocks();
    lastUserScrollIntentAtRef.current = Date.now();
    messageUserScrollingRef.current = true;
  }, [clearScrollReleaseTimer, holdFloatingDocks]);

  const handleMomentumScrollEnd = useCallback(() => {
    clearScrollReleaseTimer();
    messageUserScrollingRef.current = false;
    updateLatestJumpVisibility(getDistanceFromBottom(), true);
    releaseFloatingDocksSoon();
  }, [clearScrollReleaseTimer, getDistanceFromBottom, releaseFloatingDocksSoon, updateLatestJumpVisibility]);

  const handleContentSizeChange = useCallback((height: number, opts: {
    canLoadEarlierHistory: boolean;
    loadingOlder: boolean;
    onLoadOlderMessages: () => void;
  }) => {
    const previousHeight = Math.max(0, Number(messageContentHRef.current || 0));
    messageContentHRef.current = Number(height || 0);
    const anchor = historyLoadAnchorRef.current;
    if (anchor) {
      debugLog?.(`chat.history.content loading=${opts.loadingOlder ? 1 : 0} prevH=${Math.round(previousHeight)} nextH=${Math.round(height)} anchorY=${Math.round(anchor.scrollY)} anchorH=${Math.round(anchor.contentH)}`);
    }
    if (
      opts.loadingOlder
      && anchor
      && anchor.contentH > 0
      && Date.now() - anchor.at < 6000
      && height > anchor.contentH + 1
    ) {
      const heightDelta = Math.max(0, height - anchor.contentH);
      historyLoadAnchorRef.current = null;
      debugLog?.(`chat.history.nativeMaintain from=${Math.round(anchor.scrollY)} heightDelta=${Math.round(heightDelta)} viewportH=${Math.round(anchor.viewportH)}`);
    } else if (!opts.loadingOlder && previousHeight > 0) {
      historyLoadAnchorRef.current = null;
    }
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
        debugLog?.(`chat.history.autoload candidate contentH=${Math.round(messageContentHRef.current)} viewportH=${Math.round(messageViewportHRef.current)} y=${Math.round(messageScrollYRef.current)}`);
        if (markHistoryLoadAnchor('contentSize')) {
          opts.onLoadOlderMessages();
        }
      }
    }
  }, [debugLog, getDistanceFromBottom, historyPrefetchCooldownMs, markHistoryLoadAnchor, updateLatestJumpVisibility]);

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
    const distanceFromBottom = Math.max(0, scrollY);
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
    const latestCellVisible = cells.length > 0 && firstVisibleIndex <= 0;
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
    clearFloatingDockReleaseTimer();
    forceScrollToLatestUntilRef.current = 0;
    messageUserScrollingRef.current = false;
    messageScrollYRef.current = 0;
    messageViewportHRef.current = 0;
    messageContentHRef.current = 0;
    latestJumpVisibleRef.current = false;
    latestJumpLastChangeRef.current = Date.now();
    historyPrefetchLastAtRef.current = 0;
    historyLoadAnchorRef.current = null;
    historyLoadRequestLastAtRef.current = 0;
    lastUserScrollIntentAtRef.current = 0;
    setShowLatestJump(false);
    setSuppressFloatingDocks(false);
  }, [clearFloatingDockReleaseTimer, clearScrollReleaseTimer]);

  return {
    showLatestJump,
    suppressFloatingDocks,
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
    markHistoryLoadAnchor,
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

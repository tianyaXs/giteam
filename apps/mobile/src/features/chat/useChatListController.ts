import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SESSION_LIST_REVEAL_DELAY_MS } from './mobileAppConfig';

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

export type ChatMaintainVisibleContentPosition = {
  startRenderingFromBottom: boolean;
  autoscrollToBottomThreshold?: number;
  autoscrollToTopThreshold?: number;
  animateAutoScrollToBottom?: boolean;
};

export function useChatListController<Cell extends { id?: string }>(props: {
  initialCellLimit: number;
  chatBottomProximity: number;
  bottomContentInset?: number;
  debugLog?: (message: string) => void;
}) {
  const { bottomContentInset = 0, chatBottomProximity, debugLog, initialCellLimit } = props;
  const [showLatestJump, setShowLatestJump] = useState(false);
  const [suppressFloatingDocks, setSuppressFloatingDocks] = useState(false);
  const [followLatest, setFollowLatest] = useState(true);
  const [listRevealReady, setListRevealReady] = useState(false);

  const messageScrollRef = useRef<any>(null);
  const forceScrollToLatestUntilRef = useRef(0);
  const latestJumpVisibleRef = useRef(false);
  const latestJumpLastChangeRef = useRef(0);
  const chatViewportSnapshotRef = useRef<Record<string, ChatViewportSnapshot>>({});
  const chatViewableRangeRef = useRef<{ startIndex: number; endIndex: number }>({ startIndex: 0, endIndex: 0 });
  const messageScrollYRef = useRef(0);
  const messageViewportHRef = useRef(0);
  const messageContentHRef = useRef(0);
  const messageUserScrollingRef = useRef(false);
  const scrollReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatingDockReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressLoadOlderUntilRef = useRef(0);
  const historyPaginationReadyRef = useRef(false);
  const anchoredSessionRef = useRef('');
  const anchoredSessionIdRef = useRef('');
  const anchorInFlightRef = useRef('');
  const forceRevealScrollRef = useRef(false);
  const listRevealReadyRef = useRef(false);
  const pendingCellLayoutAdjustRef = useRef<{ cellId: string; previousHeight: number } | null>(null);
  const followLatestRef = useRef(true);
  const chatViewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 1 }), []);

  useEffect(() => {
    followLatestRef.current = followLatest;
  }, [followLatest]);

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
    const viewportH = Math.max(0, Number(messageViewportHRef.current || 0));
    const contentH = Math.max(0, Number(messageContentHRef.current || 0));
    if (contentH > 0 && viewportH > 0) {
      return Math.max(0, contentH - viewportH - Math.max(0, scrollY));
    }
    return Math.max(0, scrollY);
  }, []);

  const getVisibleDistanceFromBottom = useCallback((scrollY = messageScrollYRef.current) => {
    return Math.max(0, getDistanceFromBottom(scrollY) - Math.max(0, Number(bottomContentInset || 0)));
  }, [bottomContentInset, getDistanceFromBottom]);

  const scrollListToEnd = useCallback((animated = false) => {
    const list = messageScrollRef.current;
    if (!list) return;
    latestJumpVisibleRef.current = false;
    latestJumpLastChangeRef.current = Date.now();
    setShowLatestJump(false);
    try {
      list.scrollToEnd?.({ animated });
    } catch {}
    const viewportH = Math.max(0, Number(messageViewportHRef.current || 0));
    const contentH = Math.max(0, Number(messageContentHRef.current || 0));
    const maxOffset = Math.max(0, contentH - viewportH);
    if (maxOffset <= 0) return;
    try {
      list.scrollToOffset?.({ offset: maxOffset, animated });
      messageScrollYRef.current = maxOffset;
    } catch {}
  }, []);

  const shouldStickToLatest = useCallback(() => {
    return (
      (followLatest && !messageUserScrollingRef.current)
      || Date.now() < forceScrollToLatestUntilRef.current
    );
  }, [followLatest]);

  const updateLatestJumpVisibility = useCallback((distanceFromBottom: number, immediate = false) => {
    const now = Date.now();
    const currentlyVisible = latestJumpVisibleRef.current;
    const shouldHide = distanceFromBottom < chatBottomProximity || shouldStickToLatest();
    const shouldShow = distanceFromBottom > 112 && !shouldHide;
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
  }, [chatBottomProximity, shouldStickToLatest]);

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

  const guardHistoryLoad = useCallback((durationMs = 1200) => {
    suppressLoadOlderUntilRef.current = Date.now() + Math.max(400, durationMs);
  }, []);

  const shouldSuppressLoadOlder = useCallback(() => {
    if (!historyPaginationReadyRef.current) return true;
    return Date.now() < suppressLoadOlderUntilRef.current;
  }, []);

  const anchorSessionToLatest = useCallback((sessionKey: string, cellCount: number) => {
    const sid = String(sessionKey || '').trim();
    if (!sid || cellCount <= 0) return;
    const signature = `${sid}:${cellCount}`;
    const sessionChanged = anchoredSessionIdRef.current !== sid;

    if (sessionChanged) {
      anchoredSessionIdRef.current = sid;
      anchoredSessionRef.current = '';
      anchorInFlightRef.current = '';
      forceRevealScrollRef.current = true;
      listRevealReadyRef.current = false;
      setListRevealReady(false);
      guardHistoryLoad(2400);
      forceScrollToLatestUntilRef.current = Date.now() + 1800;
      latestJumpVisibleRef.current = false;
      latestJumpLastChangeRef.current = Date.now();
      setShowLatestJump(false);
      followLatestRef.current = true;
      setFollowLatest(true);
    } else if (listRevealReadyRef.current && anchoredSessionRef.current !== signature) {
      anchoredSessionRef.current = signature;
      return;
    } else if (anchoredSessionRef.current === signature && listRevealReadyRef.current) {
      return;
    }

    if (anchorInFlightRef.current === sid) return;
    anchorInFlightRef.current = sid;
    historyPaginationReadyRef.current = false;

    const finishReveal = (scrolled: boolean) => {
      if (anchorInFlightRef.current !== sid) return;
      anchorInFlightRef.current = '';
      anchoredSessionRef.current = signature;
      historyPaginationReadyRef.current = true;
      listRevealReadyRef.current = true;
      setListRevealReady(true);
      const distance = getVisibleDistanceFromBottom();
      debugLog?.(
        `chat.viewport.reveal sid=${sid} cells=${cellCount} distance=${Math.round(distance)} scrolled=${scrolled ? 1 : 0} delayMs=${SESSION_LIST_REVEAL_DELAY_MS}`
      );
    };

    let revealTimeoutId: ReturnType<typeof setTimeout> | null = null;

    let revealAttempts = 0;
    const tryReveal = () => {
      if (anchorInFlightRef.current !== sid) return;
      revealAttempts += 1;
      let scrolled = false;
      const forceScroll = forceRevealScrollRef.current;
      const layoutReady =
        messageViewportHRef.current > 0
        && (messageContentHRef.current > 0 || revealAttempts >= 8);
      if (forceScroll && !layoutReady && revealAttempts < 8) {
        requestAnimationFrame(tryReveal);
        return;
      }
      const shouldScroll =
        forceScroll
        || (followLatestRef.current && getVisibleDistanceFromBottom() <= chatBottomProximity);
      if (shouldScroll) {
        scrollListToEnd(false);
        scrolled = true;
      }
      requestAnimationFrame(() => {
        if (anchorInFlightRef.current !== sid) return;
        const forceScrollAgain = forceRevealScrollRef.current;
        const layoutReadyAgain =
          messageViewportHRef.current > 0
          && (messageContentHRef.current > 0 || revealAttempts >= 8);
        if (forceScrollAgain && !layoutReadyAgain && revealAttempts < 8) {
          requestAnimationFrame(tryReveal);
          return;
        }
        const shouldScrollAgain =
          forceScrollAgain
          || (followLatestRef.current && getVisibleDistanceFromBottom() <= chatBottomProximity);
        if (shouldScrollAgain) {
          scrollListToEnd(false);
          scrolled = true;
        }
        forceRevealScrollRef.current = false;
        finishReveal(scrolled);
      });
    };

    const revealDelayMs = Math.max(0, SESSION_LIST_REVEAL_DELAY_MS);
    if (revealDelayMs <= 0) {
      tryReveal();
    } else {
      revealTimeoutId = setTimeout(tryReveal, revealDelayMs);
    }

    return () => {
      if (revealTimeoutId !== null) clearTimeout(revealTimeoutId);
    };
  }, [
    chatBottomProximity,
    debugLog,
    getVisibleDistanceFromBottom,
    guardHistoryLoad,
    scrollListToEnd
  ]);

  const scrollToLatest = useCallback((animated?: boolean) => {
    if (messageUserScrollingRef.current && !shouldStickToLatest()) return;
    scrollListToEnd(!!animated);
    setFollowLatest(true);
  }, [scrollListToEnd, shouldStickToLatest]);

  const markFollowLatest = useCallback((durationMs = 0) => {
    setFollowLatest(true);
    if (durationMs > 0) {
      forceScrollToLatestUntilRef.current = Date.now() + durationMs;
    }
  }, []);

  const pauseFollowLatest = useCallback(() => {
    forceScrollToLatestUntilRef.current = 0;
    followLatestRef.current = false;
    setFollowLatest(false);
  }, []);

  const isViewportNearLatest = useCallback(() => {
    if (Date.now() < forceScrollToLatestUntilRef.current) return true;
    return getVisibleDistanceFromBottom() <= chatBottomProximity;
  }, [chatBottomProximity, getVisibleDistanceFromBottom]);

  const restoreSessionViewport = useCallback((sessionKey: string) => {
    const sid = String(sessionKey || '').trim();
    if (!sid) return;
    const snap = chatViewportSnapshotRef.current[sid];
    if (!snap || snap.scrollY < 0) return;
    messageScrollYRef.current = snap.scrollY;
    messageContentHRef.current = Math.max(messageContentHRef.current, snap.contentH);
    messageViewportHRef.current = Math.max(messageViewportHRef.current, snap.viewportH);
    try {
      messageScrollRef.current?.scrollToOffset?.({ offset: snap.scrollY, animated: false });
    } catch {}
    updateLatestJumpVisibility(getVisibleDistanceFromBottom(snap.scrollY), true);
  }, [getVisibleDistanceFromBottom, updateLatestJumpVisibility]);

  const jumpToLatest = useCallback(() => {
    messageUserScrollingRef.current = false;
    markFollowLatest(900);
    latestJumpVisibleRef.current = false;
    latestJumpLastChangeRef.current = Date.now();
    setShowLatestJump(false);
    scrollToLatest(true);
  }, [markFollowLatest, scrollToLatest]);

  const getMaintainVisibleContentPosition = useCallback((loadingOlder: boolean): ChatMaintainVisibleContentPosition => {
    const config: ChatMaintainVisibleContentPosition = {
      startRenderingFromBottom: true,
      animateAutoScrollToBottom: false
    };
    if (loadingOlder) {
      config.autoscrollToTopThreshold = 0.12;
    } else if (
      followLatest
      && listRevealReady
      && !messageUserScrollingRef.current
      && getVisibleDistanceFromBottom() <= chatBottomProximity
    ) {
      config.autoscrollToBottomThreshold = 0.12;
    }
    return config;
  }, [chatBottomProximity, followLatest, getVisibleDistanceFromBottom, listRevealReady]);

  const prepareCellLayoutAdjustment = useCallback((cellId: string, previousHeight: number) => {
    const key = String(cellId || '').trim();
    if (!key || !Number.isFinite(previousHeight) || previousHeight <= 0) {
      pendingCellLayoutAdjustRef.current = null;
      return;
    }
    if (getVisibleDistanceFromBottom() <= chatBottomProximity) {
      pendingCellLayoutAdjustRef.current = null;
      return;
    }
    pendingCellLayoutAdjustRef.current = { cellId: key, previousHeight };
  }, [chatBottomProximity, getVisibleDistanceFromBottom]);

  const settleCellLayoutAdjustment = useCallback((cellId: string, nextHeight: number) => {
    const pending = pendingCellLayoutAdjustRef.current;
    pendingCellLayoutAdjustRef.current = null;
    const key = String(cellId || '').trim();
    if (!pending || pending.cellId !== key) return;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    const delta = nextHeight - pending.previousHeight;
    if (Math.abs(delta) <= 1) return;
    if (getVisibleDistanceFromBottom() <= chatBottomProximity) return;
    const nextOffset = Math.max(0, Number(messageScrollYRef.current || 0) + delta);
    messageScrollYRef.current = nextOffset;
    try {
      messageScrollRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
    } catch {}
    updateLatestJumpVisibility(getVisibleDistanceFromBottom(nextOffset), true);
  }, [chatBottomProximity, getVisibleDistanceFromBottom, updateLatestJumpVisibility]);

  const onMessageListScroll = useCallback((y: number, viewportH?: number, contentH?: number) => {
    messageScrollYRef.current = y;
    if (typeof viewportH === 'number' && Number.isFinite(viewportH)) {
      messageViewportHRef.current = viewportH;
    }
    if (typeof contentH === 'number' && Number.isFinite(contentH)) {
      messageContentHRef.current = contentH;
    }
    const distance = getVisibleDistanceFromBottom(y);
    const forceStickToLatest = Date.now() < forceScrollToLatestUntilRef.current;
    if (listRevealReadyRef.current) {
      if (forceStickToLatest || (distance <= chatBottomProximity && !messageUserScrollingRef.current)) {
        followLatestRef.current = true;
        setFollowLatest(true);
      } else if (distance > chatBottomProximity * 2) {
        followLatestRef.current = false;
        setFollowLatest(false);
      }
    }
    updateLatestJumpVisibility(distance);
  }, [chatBottomProximity, getVisibleDistanceFromBottom, updateLatestJumpVisibility]);

  const handleScrollBeginDrag = useCallback(() => {
    clearScrollReleaseTimer();
    holdFloatingDocks();
    forceScrollToLatestUntilRef.current = 0;
    messageUserScrollingRef.current = true;
    setFollowLatest(false);
  }, [clearScrollReleaseTimer, holdFloatingDocks]);

  const handleScrollEndDrag = useCallback(() => {
    clearScrollReleaseTimer();
    scrollReleaseTimerRef.current = setTimeout(() => {
      scrollReleaseTimerRef.current = null;
      messageUserScrollingRef.current = false;
      const distance = getVisibleDistanceFromBottom();
      if (distance <= chatBottomProximity) setFollowLatest(true);
      updateLatestJumpVisibility(distance, true);
    }, 140);
    releaseFloatingDocksSoon();
  }, [chatBottomProximity, clearScrollReleaseTimer, getVisibleDistanceFromBottom, releaseFloatingDocksSoon, updateLatestJumpVisibility]);

  const handleMomentumScrollBegin = useCallback(() => {
    clearScrollReleaseTimer();
    holdFloatingDocks();
    messageUserScrollingRef.current = true;
    setFollowLatest(false);
  }, [clearScrollReleaseTimer, holdFloatingDocks]);

  const handleMomentumScrollEnd = useCallback(() => {
    clearScrollReleaseTimer();
    messageUserScrollingRef.current = false;
    const distance = getVisibleDistanceFromBottom();
    if (distance <= chatBottomProximity) setFollowLatest(true);
    updateLatestJumpVisibility(distance, true);
    releaseFloatingDocksSoon();
  }, [chatBottomProximity, clearScrollReleaseTimer, getVisibleDistanceFromBottom, releaseFloatingDocksSoon, updateLatestJumpVisibility]);

  const handleContentSizeChange = useCallback((height: number, opts: { loadingOlder: boolean }) => {
    const previousHeight = Math.max(0, Number(messageContentHRef.current || 0));
    const scrollY = Math.max(0, Number(messageScrollYRef.current || 0));
    const viewportH = Math.max(0, Number(messageViewportHRef.current || 0));
    const rawDistanceBefore =
      previousHeight > 0 && viewportH > 0
        ? Math.max(0, previousHeight - viewportH - scrollY)
        : 0;
    const distanceBefore = Math.max(0, rawDistanceBefore - Math.max(0, Number(bottomContentInset || 0)));
    const wasNearBottom = previousHeight <= 0 || distanceBefore <= chatBottomProximity;
    messageContentHRef.current = Number(height || 0);
    if (opts.loadingOlder) {
      if (previousHeight <= 0) return;
      const delta = Math.max(0, Number(height || 0) - previousHeight);
      if (delta <= 1) return;
      const nextOffset = Math.max(0, scrollY + delta);
      messageScrollYRef.current = nextOffset;
      try {
        messageScrollRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
      } catch {}
      updateLatestJumpVisibility(getVisibleDistanceFromBottom(nextOffset), true);
      return;
    }
    if (
      listRevealReadyRef.current
      && followLatestRef.current
      && !messageUserScrollingRef.current
      && wasNearBottom
      && getVisibleDistanceFromBottom() <= chatBottomProximity
    ) {
      scrollListToEnd(false);
      updateLatestJumpVisibility(getVisibleDistanceFromBottom(), true);
    }
  }, [
    chatBottomProximity,
    bottomContentInset,
    getVisibleDistanceFromBottom,
    scrollListToEnd,
    updateLatestJumpVisibility
  ]);

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
    let scrollY = Math.max(0, Number(messageScrollYRef.current || 0));
    try {
      const currentOffset = Number(messageScrollRef.current?.getAbsoluteLastScrollOffset?.());
      if (Number.isFinite(currentOffset)) scrollY = Math.max(0, currentOffset);
    } catch {}
    const distanceFromBottom = getVisibleDistanceFromBottom(scrollY);
    const viewableRange = chatViewableRangeRef.current;
    const lastVisibleIndex = Math.max(0, Math.floor(viewableRange.endIndex || 0));
    const lastCell = cells[lastVisibleIndex];
    chatViewportSnapshotRef.current[sid] = {
      scrollY,
      viewportH,
      contentH,
      distanceFromBottom,
      visibleCellCount,
      firstVisibleCellId: lastCell?.id,
      firstVisibleIndex: lastVisibleIndex,
      firstVisibleIndexFromEnd: lastCell ? Math.max(0, cells.length - 1 - lastVisibleIndex) : undefined,
      nearBottom: cells.length > 0 && lastVisibleIndex >= cells.length - 1 || distanceFromBottom <= chatBottomProximity,
      updatedAt: Date.now()
    };
  }, [chatBottomProximity, getVisibleDistanceFromBottom, initialCellLimit]);

  const clearSessionViewportSnapshot = useCallback((sessionKey: string) => {
    const sid = String(sessionKey || '').trim();
    if (!sid) return;
    delete chatViewportSnapshotRef.current[sid];
  }, []);

  const resetListInteractionState = useCallback((nextSessionKey?: string) => {
    clearScrollReleaseTimer();
    clearFloatingDockReleaseTimer();
    const sid = String(nextSessionKey || '').trim();
    forceScrollToLatestUntilRef.current = sid ? Date.now() + 1800 : 0;
    suppressLoadOlderUntilRef.current = 0;
    historyPaginationReadyRef.current = false;
    anchoredSessionRef.current = '';
    anchoredSessionIdRef.current = '';
    anchorInFlightRef.current = '';
    forceRevealScrollRef.current = false;
    listRevealReadyRef.current = false;
    setListRevealReady(false);
    messageUserScrollingRef.current = false;
    messageScrollYRef.current = 0;
    messageViewportHRef.current = 0;
    messageContentHRef.current = 0;
    pendingCellLayoutAdjustRef.current = null;
    latestJumpVisibleRef.current = false;
    latestJumpLastChangeRef.current = Date.now();
    setShowLatestJump(false);
    setSuppressFloatingDocks(false);
    followLatestRef.current = true;
    setFollowLatest(true);
    if (sid) clearSessionViewportSnapshot(sid);
  }, [clearFloatingDockReleaseTimer, clearScrollReleaseTimer, clearSessionViewportSnapshot]);

  return {
    showLatestJump,
    suppressFloatingDocks,
    listRevealReady,
    followLatest,
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
    markFollowLatest,
    pauseFollowLatest,
    isViewportNearLatest,
    restoreSessionViewport,
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
    clearSessionViewportSnapshot,
    resetListInteractionState,
    guardHistoryLoad,
    anchorSessionToLatest,
    getMaintainVisibleContentPosition,
    shouldSuppressLoadOlder,
    suppressLoadOlderUntilRef,
    historyPaginationReadyRef
  };
}

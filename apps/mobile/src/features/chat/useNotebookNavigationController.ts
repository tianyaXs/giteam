import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';

export function useNotebookNavigationController(props: {
  windowWidth: number;
  onBeforeOpenDrawer: () => void;
  onOpenLeftDrawer: () => void;
  onOpenRightDrawer: () => void;
}) {
  const { onBeforeOpenDrawer, onOpenLeftDrawer, onOpenRightDrawer, windowWidth } = props;
  const [drawerSide, setDrawerSide] = useState<'left' | 'right' | ''>('');
  const [notebookPage, setNotebookPage] = useState<'left' | 'main' | 'right'>('main');
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const notebookTrackX = useRef(new Animated.Value(-windowWidth)).current;
  const callbacksRef = useRef({ onBeforeOpenDrawer, onOpenLeftDrawer, onOpenRightDrawer });
  const drawerSideRef = useRef<'left' | 'right' | ''>('');
  const notebookPageRef = useRef<'left' | 'main' | 'right'>('main');
  const notebookPageIndexRef = useRef(1);
  const notebookDraggingRef = useRef(false);
  const notebookGestureStartIndexRef = useRef(1);
  const notebookGestureBaseXRef = useRef(-windowWidth);
  const notebookTrackXValueRef = useRef(-windowWidth);
  const notebookTouchActiveRef = useRef(false);
  const notebookTerminatedDuringTouchRef = useRef(false);
  const notebookAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  const notebookDragActivationPx = Math.max(18, Math.min(28, windowWidth * 0.055));
  const shouldStartNotebookPan = useCallback((gesture: { dx: number; dy: number }) => {
    const absDx = Math.abs(gesture.dx);
    const absDy = Math.abs(gesture.dy);
    if (absDx < notebookDragActivationPx) return false;
    if (absDx < absDy * 1.35) return false;
    const index = notebookPageIndexRef.current;
    if (index <= 0 && gesture.dx > 0) return false;
    if (index >= 2 && gesture.dx < 0) return false;
    return true;
  }, [notebookDragActivationPx]);

  const animateNotebookToIndex = useCallback((index: number) => {
    if (notebookTouchActiveRef.current) return;
    notebookPageIndexRef.current = index;
    notebookAnimationRef.current?.stop();
    const animation = Animated.spring(notebookTrackX, {
      toValue: -windowWidth * index,
      stiffness: 240,
      damping: 28,
      mass: 0.9,
      useNativeDriver: false
    });
    notebookAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (finished && notebookAnimationRef.current === animation) {
        notebookAnimationRef.current = null;
      }
    });
  }, [notebookTrackX, windowWidth]);

  const stopNotebookAnimation = useCallback(() => {
    notebookAnimationRef.current?.stop();
    notebookAnimationRef.current = null;
    notebookTrackX.stopAnimation((value) => {
      const numericValue = Number(value);
      notebookTrackXValueRef.current = Number.isFinite(numericValue)
        ? numericValue
        : -windowWidth * notebookPageIndexRef.current;
    });
  }, [notebookTrackX, windowWidth]);

  useEffect(() => {
    callbacksRef.current = { onBeforeOpenDrawer, onOpenLeftDrawer, onOpenRightDrawer };
  }, [onBeforeOpenDrawer, onOpenLeftDrawer, onOpenRightDrawer]);

  const switchNotebookPage = useCallback((next: 'left' | 'main' | 'right') => {
    notebookPageRef.current = next;
    setNotebookPage((prev) => (prev === next ? prev : next));
  }, []);

  const closeDrawer = useCallback(() => {
    drawerSideRef.current = '';
    setDrawerSide('');
    setWorkspaceSwitcherOpen(false);
    switchNotebookPage('main');
  }, [switchNotebookPage]);

  const openDrawer = useCallback((side: 'left' | 'right') => {
    if (drawerSideRef.current === side && notebookPageRef.current === side) return;
    callbacksRef.current.onBeforeOpenDrawer();
    drawerSideRef.current = side;
    setWorkspaceSwitcherOpen(false);
    setDrawerSide(side);
    switchNotebookPage(side);
    if (side === 'left') callbacksRef.current.onOpenLeftDrawer();
    else callbacksRef.current.onOpenRightDrawer();
  }, [switchNotebookPage]);

  const toggleWorkspaceSwitcher = useCallback(() => {
    setWorkspaceSwitcherOpen((v) => !v);
  }, []);

  const settleNotebookAfterTouch = useCallback(() => {
    if (notebookTouchActiveRef.current || notebookDraggingRef.current) return;
    const rawIndex = Math.round(Math.abs(notebookTrackXValueRef.current) / Math.max(1, windowWidth));
    const nextIndex = Math.max(0, Math.min(2, rawIndex));
    const nextPage = nextIndex === 0 ? 'left' : nextIndex === 2 ? 'right' : 'main';
    if (nextPage === notebookPageRef.current) {
      animateNotebookToIndex(nextIndex);
      return;
    }
    if (nextPage === 'left') openDrawer('left');
    else if (nextPage === 'right') openDrawer('right');
    else closeDrawer();
  }, [animateNotebookToIndex, closeDrawer, openDrawer, windowWidth]);

  useEffect(() => {
    if (notebookTouchActiveRef.current || notebookDraggingRef.current) return;
    const index = notebookPage === 'left' ? 0 : notebookPage === 'right' ? 2 : 1;
    animateNotebookToIndex(index);
  }, [animateNotebookToIndex, notebookPage]);

  useEffect(() => {
    const listenerId = notebookTrackX.addListener(({ value }) => {
      notebookTrackXValueRef.current = value;
    });
    return () => {
      notebookTrackX.removeListener(listenerId);
    };
  }, [notebookTrackX]);

  const notebookPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => shouldStartNotebookPan(gesture),
    onMoveShouldSetPanResponderCapture: (_, gesture) => shouldStartNotebookPan(gesture),
    onPanResponderGrant: () => {
      notebookTouchActiveRef.current = true;
      notebookDraggingRef.current = true;
      notebookTerminatedDuringTouchRef.current = false;
      notebookGestureStartIndexRef.current = notebookPageIndexRef.current;
      stopNotebookAnimation();
      notebookGestureBaseXRef.current = notebookTrackXValueRef.current;
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderMove: (_, gesture) => {
      const baseX = notebookGestureBaseXRef.current;
      const dragDx = Number(gesture.dx || 0);
      const nextX = Math.min(0, Math.max(-windowWidth * 2, baseX + dragDx));
      notebookTrackXValueRef.current = nextX;
      notebookTrackX.setValue(nextX);
    },
    onPanResponderRelease: (_, gesture) => {
      notebookTouchActiveRef.current = false;
      notebookDraggingRef.current = false;
      notebookTerminatedDuringTouchRef.current = false;
      const baseIndex = notebookGestureStartIndexRef.current;
      const threshold = Math.max(windowWidth * 0.22, 72);
      const projectedDx = Number(gesture.dx || 0) + gesture.vx * 90;
      let nextIndex = baseIndex;
      if (projectedDx < -threshold || gesture.vx < -0.75) nextIndex = Math.min(2, baseIndex + 1);
      else if (projectedDx > threshold || gesture.vx > 0.75) nextIndex = Math.max(0, baseIndex - 1);
      if (nextIndex === baseIndex) {
        animateNotebookToIndex(baseIndex);
        return;
      }
      const nextPage = nextIndex === 0 ? 'left' : nextIndex === 2 ? 'right' : 'main';
      if (nextPage === 'left') openDrawer('left');
      else if (nextPage === 'right') openDrawer('right');
      else closeDrawer();
    },
    onPanResponderTerminate: () => {
      notebookDraggingRef.current = false;
      notebookTerminatedDuringTouchRef.current = true;
      stopNotebookAnimation();
    }
  }), [animateNotebookToIndex, closeDrawer, notebookTrackX, openDrawer, shouldStartNotebookPan, stopNotebookAnimation, windowWidth]);

  const notebookPanHandlers = useMemo(() => ({
    ...notebookPanResponder.panHandlers,
    onTouchStart: () => {
      notebookTouchActiveRef.current = true;
      notebookTerminatedDuringTouchRef.current = false;
      stopNotebookAnimation();
    },
    onTouchEnd: () => {
      const shouldSettle = notebookTerminatedDuringTouchRef.current;
      notebookTouchActiveRef.current = false;
      notebookTerminatedDuringTouchRef.current = false;
      if (shouldSettle) settleNotebookAfterTouch();
    },
    onTouchCancel: () => {
      const shouldSettle = notebookDraggingRef.current || notebookTerminatedDuringTouchRef.current;
      notebookTouchActiveRef.current = false;
      notebookDraggingRef.current = false;
      notebookTerminatedDuringTouchRef.current = false;
      if (shouldSettle) settleNotebookAfterTouch();
    }
  }), [notebookPanResponder.panHandlers, settleNotebookAfterTouch, stopNotebookAnimation]);

  return {
    drawerSide,
    notebookPage,
    workspaceSwitcherOpen,
    setWorkspaceSwitcherOpen,
    notebookTrackX,
    notebookPanResponder: { panHandlers: notebookPanHandlers },
    openDrawer,
    closeDrawer,
    switchNotebookPage,
    toggleWorkspaceSwitcher
  };
}

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
  const notebookTrackX = useRef(new Animated.Value(0)).current;
  const notebookPageIndexRef = useRef(1);

  const switchNotebookPage = useCallback((next: 'left' | 'main' | 'right') => {
    setNotebookPage((prev) => (prev === next ? prev : next));
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerSide('');
    setWorkspaceSwitcherOpen(false);
    switchNotebookPage('main');
  }, [switchNotebookPage]);

  const openDrawer = useCallback((side: 'left' | 'right') => {
    if (drawerSide === side && notebookPage === side) return;
    onBeforeOpenDrawer();
    setWorkspaceSwitcherOpen(false);
    setDrawerSide(side);
    switchNotebookPage(side);
    if (side === 'left') onOpenLeftDrawer();
    else onOpenRightDrawer();
  }, [drawerSide, notebookPage, onBeforeOpenDrawer, onOpenLeftDrawer, onOpenRightDrawer, switchNotebookPage]);

  const toggleWorkspaceSwitcher = useCallback(() => {
    setWorkspaceSwitcherOpen((v) => !v);
  }, []);

  useEffect(() => {
    const index = notebookPage === 'left' ? 0 : notebookPage === 'right' ? 2 : 1;
    notebookPageIndexRef.current = index;
    Animated.spring(notebookTrackX, {
      toValue: -windowWidth * index,
      stiffness: 240,
      damping: 28,
      mass: 0.9,
      useNativeDriver: true
    }).start();
  }, [notebookPage, notebookTrackX, windowWidth]);

  const notebookPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
    onPanResponderGrant: () => {
      notebookTrackX.stopAnimation();
    },
    onPanResponderMove: (_, gesture) => {
      const baseX = -windowWidth * notebookPageIndexRef.current;
      const nextX = Math.min(0, Math.max(-windowWidth * 2, baseX + gesture.dx));
      notebookTrackX.setValue(nextX);
    },
    onPanResponderRelease: (_, gesture) => {
      const baseIndex = notebookPageIndexRef.current;
      const threshold = windowWidth * 0.14;
      let nextIndex = baseIndex;
      if (gesture.dx < -threshold || gesture.vx < -0.35) nextIndex = Math.min(2, baseIndex + 1);
      else if (gesture.dx > threshold || gesture.vx > 0.35) nextIndex = Math.max(0, baseIndex - 1);
      const nextPage = nextIndex === 0 ? 'left' : nextIndex === 2 ? 'right' : 'main';
      if (nextPage === 'left') openDrawer('left');
      else if (nextPage === 'right') openDrawer('right');
      else closeDrawer();
    },
    onPanResponderTerminate: () => {
      switchNotebookPage(notebookPage);
    }
  }), [closeDrawer, notebookPage, notebookTrackX, openDrawer, switchNotebookPage, windowWidth]);

  return {
    drawerSide,
    notebookPage,
    workspaceSwitcherOpen,
    setWorkspaceSwitcherOpen,
    notebookTrackX,
    notebookPanResponder,
    openDrawer,
    closeDrawer,
    switchNotebookPage,
    toggleWorkspaceSwitcher
  };
}

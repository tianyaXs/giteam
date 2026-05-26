import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, StatusBar, Text, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { ChatComposer, ComposerPickerSheet } from './ChatComposer';
import { ImagePreviewOverlay } from './MediaOverlays';
import { MobileTodoCardView } from './MobileTurnCell';
import { QuestionDock } from '../QuestionDock';
import { ChatConversationStage } from './ChatConversationStage';
import { NotebookGearGlyph, NotebookListGlyph } from './NotebookNavGlyphs';
import type { ChatMaintainVisibleContentPosition } from '../../features/chat/useChatListController';

type NotebookColors = {
  shell: string;
  main: string;
  left: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  paper: string;
};

type QuestionRequestLike = {
  id: string;
};

type NotebookPanel = 'left' | 'right' | '';

export type ChatWorkspaceScreenHandle = {
  closeDrawer: () => void;
  openDrawer: (side: 'left' | 'right') => void;
};

type ChatWorkspaceScreenProps = {
  styles: Record<string, any>;
  windowWidth: number;
  inputDockHeight: number;
  keyboardInset: number;
  notebookColors: NotebookColors;
  onBeforeOpenDrawer?: () => void;
  onOpenLeftDrawer: () => void;
  onOpenRightDrawer: () => void;
  onDrawerCloseSettled?: () => void;
  leftDrawer: React.ReactNode;
  rightDrawer: React.ReactNode;
  showNotebookSessionTitle: boolean;
  currentSessionTitle: string;
  showStreamTopGlow: boolean;
  streamTopGlowAnim: Animated.Value;
  renderedTurnsLength: number;
  currentWorkspaceName: string;
  chatListMountKey: string;
  messageScrollRef: React.RefObject<any>;
  messageBottomInset: number;
  displayedTurnCells: any[];
  chatViewabilityConfig: any;
  onChatViewableItemsChanged: (info: any) => void;
  loadingOlder: boolean;
  shouldSuppressLoadOlder: () => boolean;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
  onScroll: (evt: any) => void;
  onContentSizeChange: (w: number, h: number) => void;
  onListLayout: (evt: any) => void;
  onLoadOlderMessages: () => Promise<void>;
  anchorSessionToLatest: (sessionId: string, cellCount: number) => void;
  renderTurnCell: (info: { item: any; index: number }) => React.ReactElement;
  sessionId: string;
  sessionHistoryRetryHintText: string;
  historyProgressWidth: `${number}%`;
  showLatestJump: boolean;
  listRevealReady: boolean;
  maintainVisibleContentPosition: ChatMaintainVisibleContentPosition;
  onJumpToLatest: () => void;
  suppressFloatingDocks: boolean;
  latestTodoCard: any | null;
  dismissedTodoCardId: string;
  todoDockCollapsed: boolean;
  thinkingPulse: boolean;
  onToggleTodoDock: () => void;
  onDismissTodoDock: () => void;
  activeQuestionRequest: QuestionRequestLike | null;
  questionSubmitState: string;
  questionSubmitError?: string;
  onReplyQuestion: (requestId: string, answers: string[][]) => void;
  onDismissQuestion: (requestId: string) => void;
  composerProps: React.ComponentProps<typeof ChatComposer>;
  previewImage: { uri: string; filename?: string } | null;
  onClosePreviewImage: () => void;
  composerPickerProps: React.ComponentProps<typeof ComposerPickerSheet>;
};

export const ChatWorkspaceScreen = React.forwardRef<ChatWorkspaceScreenHandle, ChatWorkspaceScreenProps>(function ChatWorkspaceScreen(props, ref) {
  const {
    activeQuestionRequest,
    chatViewabilityConfig,
    composerPickerProps,
    composerProps,
    currentSessionTitle,
    chatListMountKey,
    currentWorkspaceName,
    dismissedTodoCardId,
    displayedTurnCells,
    historyProgressWidth,
    inputDockHeight,
    keyboardInset,
    latestTodoCard,
    leftDrawer,
    loadingOlder,
    shouldSuppressLoadOlder,
    maintainVisibleContentPosition,
    messageBottomInset,
    messageScrollRef,
    notebookColors,
    onBeforeOpenDrawer,
    onOpenLeftDrawer,
    onOpenRightDrawer,
    onDrawerCloseSettled,
    onChatViewableItemsChanged,
    onClosePreviewImage,
    onContentSizeChange,
    onDismissQuestion,
    onDismissTodoDock,
    onJumpToLatest,
    onListLayout,
    anchorSessionToLatest,
    onLoadOlderMessages,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onReplyQuestion,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onToggleTodoDock,
    previewImage,
    questionSubmitError,
    questionSubmitState,
    renderedTurnsLength,
    renderTurnCell,
    rightDrawer,
    sessionHistoryRetryHintText,
    sessionId,
    listRevealReady,
    showLatestJump,
    showNotebookSessionTitle,
    showStreamTopGlow,
    streamTopGlowAnim,
    styles,
    suppressFloatingDocks,
    thinkingPulse,
    todoDockCollapsed,
    windowWidth
  } = props;
  const [activeNotebookPanel, setActiveNotebookPanel] = useState<NotebookPanel>('');
  const activeNotebookPanelRef = useRef<NotebookPanel>('');
  const openNotifiedPanelRef = useRef<NotebookPanel>('');

  const setNotebookPanel = useCallback((next: NotebookPanel) => {
    activeNotebookPanelRef.current = next;
    setActiveNotebookPanel((prev) => (prev === next ? prev : next));
  }, []);

  const requestCloseDrawer = useCallback(() => {
    openNotifiedPanelRef.current = '';
    setNotebookPanel('');
  }, [setNotebookPanel]);

  const requestOpenDrawer = useCallback((side: 'left' | 'right') => {
    if (activeNotebookPanelRef.current === side) return;
    Keyboard.dismiss();
    onBeforeOpenDrawer?.();
    setNotebookPanel(side);
  }, [onBeforeOpenDrawer, setNotebookPanel]);

  const handleLeftDrawerOpen = useCallback(() => {
    setNotebookPanel('left');
    if (openNotifiedPanelRef.current !== 'left') {
      openNotifiedPanelRef.current = 'left';
      onOpenLeftDrawer();
    }
  }, [onOpenLeftDrawer, setNotebookPanel]);

  const handleRightDrawerOpen = useCallback(() => {
    setNotebookPanel('right');
    if (openNotifiedPanelRef.current !== 'right') {
      openNotifiedPanelRef.current = 'right';
      onOpenRightDrawer();
    }
  }, [onOpenRightDrawer, setNotebookPanel]);

  const handleLeftDrawerClose = useCallback(() => {
    if (activeNotebookPanelRef.current === 'left') {
      openNotifiedPanelRef.current = '';
      setNotebookPanel('');
    }
  }, [setNotebookPanel]);

  const handleRightDrawerClose = useCallback(() => {
    if (activeNotebookPanelRef.current === 'right') {
      openNotifiedPanelRef.current = '';
      setNotebookPanel('');
    }
  }, [setNotebookPanel]);

  const handleDrawerTransitionEnd = useCallback((closing: boolean) => {
    if (closing) onDrawerCloseSettled?.();
  }, [onDrawerCloseSettled]);

  useImperativeHandle(ref, () => ({
    closeDrawer: requestCloseDrawer,
    openDrawer: requestOpenDrawer
  }), [requestCloseDrawer, requestOpenDrawer]);

  const drawerWidth = useMemo(
    () => Math.round(windowWidth > 434 ? 300 : windowWidth * 0.83),
    [windowWidth]
  );
  const compactSessionTitle = useMemo(() => {
    const title = currentSessionTitle.trim();
    if (title.length <= 18) return title;
    return `${title.slice(0, 18).trimEnd()}...`;
  }, [currentSessionTitle]);
  const renderLeftDrawerContent = React.useCallback(
    () => <View style={styles.slideDrawerContent}>{leftDrawer}</View>,
    [leftDrawer, styles.slideDrawerContent]
  );
  const renderRightDrawerContent = React.useCallback(
    () => <View style={styles.slideDrawerContent}>{rightDrawer}</View>,
    [rightDrawer, styles.slideDrawerContent]
  );

  const mainContent = (
    <View style={[styles.notebookMainPage, { backgroundColor: notebookColors.main }]}>
      <StatusBar barStyle="dark-content" backgroundColor={notebookColors.shell} />
      <View style={[styles.topBar, { backgroundColor: notebookColors.main }]}>
        <View style={styles.topSideSlot}>
          <Pressable
            accessibilityLabel="打开左侧面板"
            hitSlop={10}
            onPress={activeNotebookPanel === 'left' ? requestCloseDrawer : () => requestOpenDrawer('left')}
            style={styles.topNavButton}
          >
            <Animated.View style={activeNotebookPanel === 'left' ? styles.topNavGlyphActive : styles.topNavGlyph}>
              <NotebookListGlyph color={activeNotebookPanel === 'left' ? '#1f4e86' : '#2f2922'} />
            </Animated.View>
          </Pressable>
        </View>
        <View style={styles.topBrand}>
          {showNotebookSessionTitle ? (
            <Text numberOfLines={1} style={[styles.topTitleCompact, { color: notebookColors.text }]}>
              {compactSessionTitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.topSideSlotRight}>
          <Pressable
            accessibilityLabel="打开右侧面板"
            hitSlop={10}
            onPress={activeNotebookPanel === 'right' ? requestCloseDrawer : () => requestOpenDrawer('right')}
            style={styles.topNavButton}
          >
            <Animated.View style={activeNotebookPanel === 'right' ? styles.topNavGlyphActive : styles.topNavGlyph}>
              <NotebookGearGlyph color={activeNotebookPanel === 'right' ? '#1f4e86' : '#2f2922'} />
            </Animated.View>
          </Pressable>
        </View>
      </View>
      <Animated.View style={styles.chatStageViewport}>
        <ChatConversationStage
          styles={styles}
          windowWidth={windowWidth}
          inputDockHeight={inputDockHeight}
          notebookColors={notebookColors}
          showStreamTopGlow={showStreamTopGlow}
          streamTopGlowAnim={streamTopGlowAnim}
          renderedTurnsLength={renderedTurnsLength}
          currentWorkspaceName={currentWorkspaceName}
          messageScrollRef={messageScrollRef}
          shouldSuppressLoadOlder={shouldSuppressLoadOlder}
          messageBottomInset={messageBottomInset}
          displayedTurnCells={displayedTurnCells}
          chatViewabilityConfig={chatViewabilityConfig}
          onChatViewableItemsChanged={onChatViewableItemsChanged}
          loadingOlder={loadingOlder}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onMomentumScrollEnd={onMomentumScrollEnd}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          onListLayout={onListLayout}
          anchorSessionToLatest={anchorSessionToLatest}
          onLoadOlderMessages={onLoadOlderMessages}
          renderTurnCell={renderTurnCell}
          sessionId={sessionId}
          sessionHistoryRetryHintText={sessionHistoryRetryHintText}
          historyProgressWidth={historyProgressWidth}
          listRevealReady={listRevealReady}
          showLatestJump={showLatestJump}
          maintainVisibleContentPosition={maintainVisibleContentPosition}
          onJumpToLatest={onJumpToLatest}
        />
        {latestTodoCard && dismissedTodoCardId !== latestTodoCard.id && !suppressFloatingDocks ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.todoDockWrap,
              {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: Math.max(104, inputDockHeight + keyboardInset + 14),
                zIndex: 30
              }
            ]}
          >
            <MobileTodoCardView
              card={latestTodoCard}
              compact
              collapsed={todoDockCollapsed}
              pulse={thinkingPulse}
              styles={styles}
              onToggle={onToggleTodoDock}
              onClose={onDismissTodoDock}
            />
          </View>
        ) : null}
        {activeQuestionRequest ? (
          <View key={activeQuestionRequest.id} style={styles.questionDockWrap}>
            <QuestionDock
              request={activeQuestionRequest as any}
              submitState={questionSubmitState as any}
              submitError={questionSubmitError}
              onReply={onReplyQuestion}
              onDismiss={onDismissQuestion}
            />
          </View>
        ) : null}
      </Animated.View>
      <ChatComposer {...composerProps} />
    </View>
  );

  return (
    <>
      <View style={[styles.notebookShell, { backgroundColor: notebookColors.shell }]}>
        <Drawer
          drawerPosition="left"
          drawerStyle={[styles.slideDrawerSurface, { width: drawerWidth, backgroundColor: notebookColors.left }]}
          drawerType="slide"
          keyboardDismissMode="on-drag"
          onClose={handleLeftDrawerClose}
          onOpen={handleLeftDrawerOpen}
          onTransitionEnd={handleDrawerTransitionEnd}
          open={activeNotebookPanel === 'left'}
          overlayAccessibilityLabel="关闭左侧面板"
          overlayStyle={styles.slideDrawerOverlay}
          renderDrawerContent={renderLeftDrawerContent}
          swipeEdgeWidth={42}
        >
          <Drawer
            drawerPosition="right"
            drawerStyle={[
              styles.slideDrawerSurface,
              styles.slideDrawerSurfaceRight,
              { width: drawerWidth, backgroundColor: notebookColors.left }
            ]}
            drawerType="slide"
            keyboardDismissMode="on-drag"
            onClose={handleRightDrawerClose}
            onOpen={handleRightDrawerOpen}
            onTransitionEnd={handleDrawerTransitionEnd}
            open={activeNotebookPanel === 'right'}
            overlayAccessibilityLabel="关闭右侧面板"
            overlayStyle={styles.slideDrawerOverlay}
            renderDrawerContent={renderRightDrawerContent}
            swipeEdgeWidth={42}
          >
            {mainContent}
          </Drawer>
        </Drawer>
      </View>
      <ImagePreviewOverlay styles={styles} image={previewImage} onClose={onClosePreviewImage} />
      <ComposerPickerSheet {...composerPickerProps} />
    </>
  );
});

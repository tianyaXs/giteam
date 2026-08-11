import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, StatusBar, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Drawer } from 'react-native-drawer-layout';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { QuestionDock } from '../QuestionDock';
import { ChatComposer, type ChatComposerHandle } from './ChatComposer';
import { ChatConversationStage } from './ChatConversationStage';
import { ImagePreviewOverlay } from './MediaOverlays';
import { MobileTodoCardView } from './MobileTurnCell';
type NotebookColors = {
  shell: string;
  main: string;
  left: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  paper: string;
  ink: string;
};

type QuestionRequestLike = {
  id: string;
};

type NotebookPanel = 'left' | '';
type MainRoute = 'chat' | 'settings';

export type ChatWorkspaceScreenHandle = {
  closeDrawer: () => void;
  openDrawer: (side: 'left' | 'right') => void;
  openSettings: () => void;
  closeSettings: () => void;
};

type ChatWorkspaceScreenProps = {
  styles: Record<string, any>;
  windowWidth: number;
  inputDockHeight: number;
  keyboardInset: number;
  notebookColors: NotebookColors;
  onBeforeOpenDrawer?: () => void;
  onOpenLeftDrawer: () => void;
  onOpenRightDrawer?: () => void;
  onDrawerCloseSettled?: () => void;
  onNewSession?: () => void;
  leftDrawer: React.ReactNode;
  settingsContent: React.ReactNode;
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
};

export const ChatWorkspaceScreen = React.forwardRef<ChatWorkspaceScreenHandle, ChatWorkspaceScreenProps>(function ChatWorkspaceScreen(props, ref) {
  const {
    activeQuestionRequest,
    chatViewabilityConfig,
    composerProps,
    currentSessionTitle,
    chatListMountKey,
    currentWorkspaceName,
    dismissedTodoCardId,
    displayedTurnCells,
    historyProgressWidth,
    inputDockHeight,
    latestTodoCard,
    leftDrawer,
    loadingOlder,
    shouldSuppressLoadOlder,
    messageBottomInset,
    messageScrollRef,
    notebookColors,
    onBeforeOpenDrawer,
    onOpenLeftDrawer,
    onOpenRightDrawer,
    onDrawerCloseSettled,
    onNewSession,
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
    settingsContent,
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
  const { colors: themeColors } = useMobileTheme();
  const themeDark = themeColors.isDark;
  const [activeNotebookPanel, setActiveNotebookPanel] = useState<NotebookPanel>('');
  const [mainRoute, setMainRoute] = useState<MainRoute>('chat');
  const activeNotebookPanelRef = useRef<NotebookPanel>('');
  const openNotifiedPanelRef = useRef<NotebookPanel>('');
  const composerRef = useRef<ChatComposerHandle>(null);
  // 与 KeyboardStickyView 同源：同一帧键盘 height，列表抬升才和输入框同步
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const listKeyboardAvoidStyle = useAnimatedStyle(() => {
    const lift = -keyboardHeight.value;
    return { marginBottom: lift > 0 ? lift : 0 };
  }, [keyboardHeight]);

  const dismissComposer = useCallback(() => {
    composerRef.current?.collapse();
  }, []);

  const setNotebookPanel = useCallback((next: NotebookPanel) => {
    activeNotebookPanelRef.current = next;
    setActiveNotebookPanel((prev) => (prev === next ? prev : next));
  }, []);

  const requestCloseDrawer = useCallback(() => {
    openNotifiedPanelRef.current = '';
    setNotebookPanel('');
  }, [setNotebookPanel]);

  const requestOpenSettings = useCallback(() => {
    Keyboard.dismiss();
    // swift-chat：设置是抽屉导航的兄弟主屏，关掉侧栏后切入设置页
    setNotebookPanel('');
    setMainRoute('settings');
    onOpenRightDrawer?.();
  }, [onOpenRightDrawer, setNotebookPanel]);

  const requestCloseSettings = useCallback(() => {
    setMainRoute('chat');
  }, []);

  const requestOpenDrawer = useCallback((side: 'left' | 'right') => {
    if (side === 'right') {
      requestOpenSettings();
      return;
    }
    if (activeNotebookPanelRef.current === 'left') return;
    Keyboard.dismiss();
    onBeforeOpenDrawer?.();
    setNotebookPanel('left');
  }, [onBeforeOpenDrawer, requestOpenSettings, setNotebookPanel]);

  const handleLeftDrawerOpen = useCallback(() => {
    setNotebookPanel('left');
    if (openNotifiedPanelRef.current !== 'left') {
      openNotifiedPanelRef.current = 'left';
      onOpenLeftDrawer();
    }
  }, [onOpenLeftDrawer, setNotebookPanel]);

  const handleLeftDrawerClose = useCallback(() => {
    if (activeNotebookPanelRef.current === 'left') {
      openNotifiedPanelRef.current = '';
      setNotebookPanel('');
    }
  }, [setNotebookPanel]);

  const handleDrawerTransitionEnd = useCallback((closing: boolean) => {
    if (closing) onDrawerCloseSettled?.();
  }, [onDrawerCloseSettled]);

  useImperativeHandle(ref, () => ({
    closeDrawer: () => {
      requestCloseDrawer();
      requestCloseSettings();
    },
    openDrawer: requestOpenDrawer,
    openSettings: requestOpenSettings,
    closeSettings: requestCloseSettings
  }), [requestCloseDrawer, requestCloseSettings, requestOpenDrawer, requestOpenSettings]);

  const drawerWidth = useMemo(
    () => Math.round(Math.min(windowWidth * 0.9, windowWidth - 36)),
    [windowWidth]
  );
  const compactSessionTitle = useMemo(() => {
    const title = currentSessionTitle.trim();
    if (title.length <= 18) return title;
    return `${title.slice(0, 18).trimEnd()}...`;
  }, [currentSessionTitle]);
  const renderLeftDrawerContent = React.useCallback(
    () => (
      <View style={[styles.slideDrawerContent, { height: '100%', width: drawerWidth }]}>
        {leftDrawer}
      </View>
    ),
    [drawerWidth, leftDrawer, styles.slideDrawerContent]
  );

  const mainContent = (
    <View style={[styles.notebookMainPage, { backgroundColor: notebookColors.main }]}>
      <StatusBar barStyle={themeDark ? 'light-content' : 'dark-content'} backgroundColor={notebookColors.shell} />
      <View style={[styles.topBar, { backgroundColor: notebookColors.main, borderBottomColor: notebookColors.line }]}>
        <Pressable
          accessibilityLabel="打开左侧面板"
          hitSlop={8}
          onPress={activeNotebookPanel === 'left' ? requestCloseDrawer : () => requestOpenDrawer('left')}
          style={[
            styles.topNavButton,
            { backgroundColor: themeDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }
          ]}
        >
          <Feather
            name="menu"
            size={18}
            color={activeNotebookPanel === 'left' ? notebookColors.ink : notebookColors.text}
          />
        </Pressable>
        <View style={styles.topBrand}>
          {showNotebookSessionTitle ? (
            <Text numberOfLines={1} style={[styles.topTitleCompact, { color: notebookColors.text }]}>
              {compactSessionTitle}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="新建会话"
          hitSlop={8}
          onPress={() => onNewSession?.()}
          style={[
            styles.topNavButton,
            { backgroundColor: themeDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }
          ]}
        >
          <Feather name="edit" size={16} color={notebookColors.text} />
        </Pressable>
      </View>
      {/* 输入条 StickyView + 列表 marginBottom 均跟 reanimated 键盘 height，同帧同步 */}
      <View style={styles.keyboardAwareContent}>
        <Reanimated.View style={[styles.chatStageViewport, listKeyboardAvoidStyle]}>
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
            onJumpToLatest={onJumpToLatest}
            hasEnabledModels={(composerProps.modelOptions?.length || 0) > 0}
            onOpenModelSettings={composerProps.onOpenModelManager}
            onBlankPress={dismissComposer}
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
                  bottom: Math.max(104, inputDockHeight + 14),
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
        </Reanimated.View>
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <ChatComposer ref={composerRef} {...composerProps} />
        </KeyboardStickyView>
      </View>
    </View>
  );

  const settingsPage = (
    <View style={[styles.notebookMainPage, { backgroundColor: notebookColors.main, flex: 1 }]}>
      <StatusBar barStyle={themeDark ? 'light-content' : 'dark-content'} backgroundColor={notebookColors.shell} />
      {settingsContent}
    </View>
  );

  return (
    <>
      <View style={[styles.notebookShell, { backgroundColor: notebookColors.shell }]}>
        <Drawer
          drawerPosition="left"
          drawerStyle={[styles.slideDrawerSurface, { width: drawerWidth, backgroundColor: themeDark ? '#1B1B1D' : '#FFFFFF' }]}
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
          {mainRoute === 'settings' ? settingsPage : mainContent}
        </Drawer>
      </View>
      <ImagePreviewOverlay styles={styles} image={previewImage} onClose={onClosePreviewImage} />
    </>
  );
});

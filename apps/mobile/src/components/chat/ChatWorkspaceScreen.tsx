import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, StatusBar, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Drawer } from 'react-native-drawer-layout';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { QuestionDock } from '../QuestionDock';
import { PermissionDock } from '../PermissionDock';
import type { PermissionInteraction } from '../../lib/agentPermissions';
import type { AgentPermissionReply } from '../../lib/agentPermissions';
import { ChatComposer, type ChatComposerHandle } from './ChatComposer';
import { ChatConversationStage } from './ChatConversationStage';
import { ImagePreviewOverlay } from './MediaOverlays';
import { MobileTodoProgressBubble } from './MobileTodoProgressBubble';
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
  onCollapseTodoDock: () => void;
  onDismissTodoDock: () => void;
  activeQuestionRequest: QuestionRequestLike | null;
  questionSubmitState: string;
  questionSubmitError?: string;
  onReplyQuestion: (requestId: string, answers: string[][]) => void;
  onDismissQuestion: (requestId: string) => void;
  activePermissionRequest?: PermissionInteraction | null;
  permissionSubmitState?: string;
  permissionSubmitError?: string;
  onReplyPermission?: (requestId: string, reply: AgentPermissionReply) => void;
  composerProps: React.ComponentProps<typeof ChatComposer>;
  /** idle/loading 时空会话不提示「去配置模型」 */
  modelCatalogStatus?: 'idle' | 'loading' | 'ready' | 'error';
  previewImage: { uri: string; filename?: string } | null;
  onClosePreviewImage: () => void;
};

export const ChatWorkspaceScreen = React.forwardRef<ChatWorkspaceScreenHandle, ChatWorkspaceScreenProps>(function ChatWorkspaceScreen(props, ref) {
  const {
    activeQuestionRequest,
    activePermissionRequest = null,
    permissionSubmitState = 'idle',
    permissionSubmitError,
    onReplyPermission,
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
    modelCatalogStatus = 'idle',
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
    onCollapseTodoDock,
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
    suppressFloatingDocks: _suppressFloatingDocks,
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
          style={styles.topNavButton}
        >
          <Feather
            name="menu"
            size={22}
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
          style={styles.topNavButton}
        >
          <Feather name="edit" size={20} color={notebookColors.text} />
        </Pressable>
      </View>
      {/* 整块内容区 + 输入框一起被键盘顶起（比 Sticky 分轨更稳） */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 48}
        style={styles.keyboardAwareContent}
      >
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
            onJumpToLatest={onJumpToLatest}
            hasEnabledModels={(composerProps.modelOptions?.length || 0) > 0}
            modelCatalogStatus={modelCatalogStatus}
            onOpenModelSettings={composerProps.onOpenModelManager}
            onBlankPress={dismissComposer}
          />
          {activePermissionRequest && onReplyPermission ? (
            <View key={activePermissionRequest.id} style={styles.questionDockWrap}>
              <PermissionDock
                request={activePermissionRequest}
                submitState={(permissionSubmitState as any) || 'idle'}
                submitError={permissionSubmitError}
                onReply={onReplyPermission}
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
        <ChatComposer ref={composerRef} {...composerProps} />
      </KeyboardAvoidingView>
      {/* 进度气泡挂在顶栏下方，不随滚动 suppress，并可跟视口 todo 切换 */}
      {latestTodoCard && dismissedTodoCardId !== latestTodoCard.id ? (
        <MobileTodoProgressBubble
          card={latestTodoCard}
          expanded={!todoDockCollapsed}
          busy={thinkingPulse}
          styles={styles}
          onToggle={onToggleTodoDock}
          onCollapse={onCollapseTodoDock}
        />
      ) : null}
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
          {/* 聊天 / 设置互切时都不卸载，避免 Composer 圆角丢失、模型列表闪重载 */}
          <View
            style={{ flex: 1, display: mainRoute === 'chat' ? 'flex' : 'none' }}
            pointerEvents={mainRoute === 'chat' ? 'auto' : 'none'}
          >
            {mainContent}
          </View>
          <View
            style={{ flex: 1, display: mainRoute === 'settings' ? 'flex' : 'none' }}
            pointerEvents={mainRoute === 'settings' ? 'auto' : 'none'}
          >
            {settingsPage}
          </View>
        </Drawer>
      </View>
      <ImagePreviewOverlay styles={styles} image={previewImage} onClose={onClosePreviewImage} />
    </>
  );
});

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, StatusBar, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Drawer } from 'react-native-drawer-layout';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Reanimated, {
  Easing as ReEasing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { QuestionDock } from '../QuestionDock';
import { PermissionDock } from '../PermissionDock';
import type { PermissionInteraction } from '../../lib/agentPermissions';
import type { AgentPermissionReply } from '../../lib/agentPermissions';
import { ChatComposer, type ChatComposerHandle } from './ChatComposer';
import { ChatConversationStage } from './ChatConversationStage';
import { ComposerSendGlyph } from './ComposerSendGlyph';
import { ImagePreviewOverlay } from './MediaOverlays';
import { MobileTodoProgressBubble } from './MobileTodoProgressBubble';

const TOP_BAR_HEIGHT = 52;
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
  /** 发送后进入专注模式：收起顶栏与输入区，结束后滑出 */
  focusMode?: boolean;
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
    focusMode = false,
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
  /** 专注模式下用户单击唤出 chrome 后置 true；再次单击可收起 */
  const [focusChromePinned, setFocusChromePinned] = useState(false);
  /**
   * 仅在收起/展开动画期间为 true：此时顶栏走裁切动画。
   * 动画结束后若已离开专注资格，再回到静态顶栏布局。
   */
  const [chromeLayoutLocked, setChromeLayoutLocked] = useState(false);
  /**
   * 列表 inset 的专注态：进入收起时立刻收紧；整个专注资格期内保持收紧
   * （含 pin 展开顶栏/输入），离开资格且动画结束后再恢复，避免展开时列表上跳。
   */
  const [layoutChromeCollapsed, setLayoutChromeCollapsed] = useState(false);
  const focusProgress = useSharedValue(0);
  const dockHeightSV = useSharedValue(Math.max(72, inputDockHeight || 88));
  const focusEligible =
    focusMode && !activeQuestionRequest && !activePermissionRequest;
  const focusEligibleRef = useRef(focusEligible);
  focusEligibleRef.current = focusEligible;
  /** true = 顶栏/输入收起中 */
  const focusChrome = focusEligible && !focusChromePinned;
  const canAbortNow = !!composerProps.canAbortNow;
  /**
   * 静止静态顶栏：仅在完全离开专注资格后使用。
   * 专注资格期内（含 pinned 展开）始终走动画包装，避免 pin/unpin 结束 remount 顶栏造成列表跳。
   */
  const chromeAtRest = !focusEligible && !chromeLayoutLocked;

  const finishExpandLayout = useCallback(() => {
    setChromeLayoutLocked(false);
    // pin 展开时仍在专注资格内：保持 inset 收紧，不要在这时撑高 padding
    if (!focusEligibleRef.current) {
      setLayoutChromeCollapsed(false);
    }
  }, []);

  useEffect(() => {
    dockHeightSV.value = Math.max(72, Number(inputDockHeight) || 88);
  }, [dockHeightSV, inputDockHeight]);

  useEffect(() => {
    // 进入/退出专注资格时复位 pin；新一轮发送从收起态开始
    setFocusChromePinned(false);
  }, [focusEligible]);

  useEffect(() => {
    if (focusChrome) {
      setChromeLayoutLocked(true);
      setLayoutChromeCollapsed(true);
      focusProgress.value = withTiming(1, {
        duration: 280,
        easing: ReEasing.bezier(0.22, 1, 0.36, 1)
      });
      return;
    }
    // 展开：先让顶栏/Composer 动画占回空间；inset 仅在离开资格后恢复
    focusProgress.value = withTiming(
      0,
      {
        duration: 360,
        easing: ReEasing.bezier(0.16, 1, 0.3, 1)
      },
      (finished) => {
        if (finished) runOnJS(finishExpandLayout)();
      }
    );
  }, [finishExpandLayout, focusChrome, focusProgress]);

  // 资格被硬切掉且已在展开静止态时，确保 inset 不卡住
  useEffect(() => {
    if (focusEligible || focusChrome || chromeLayoutLocked) return;
    if (layoutChromeCollapsed) setLayoutChromeCollapsed(false);
  }, [chromeLayoutLocked, focusChrome, focusEligible, layoutChromeCollapsed]);

  const topBarAnimStyle = useAnimatedStyle(() => {
    const p = focusProgress.value;
    return {
      height: interpolate(p, [0, 1], [TOP_BAR_HEIGHT, 0]),
      opacity: interpolate(p, [0, 1], [1, 0]),
      overflow: 'hidden' as const
    };
  });

  /**
   * 不用 height 裁切（会先吃掉底部 safe-area，恢复后输入框像上移）。
   * 仅用 opacity + 负 margin 收起占位；p=0 时等价于改造前「无额外样式」。
   */
  const composerAnimStyle = useAnimatedStyle(() => {
    const p = focusProgress.value;
    const h = Math.max(72, dockHeightSV.value);
    return {
      opacity: interpolate(p, [0, 1], [1, 0]),
      marginBottom: interpolate(p, [0, 1], [0, -h])
    };
  });

  const todoRootAnimStyle = useAnimatedStyle(() => ({
    top: interpolate(focusProgress.value, [0, 1], [TOP_BAR_HEIGHT, 8])
  }));

  const focusAbortAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focusProgress.value, [0.35, 1], [0, 1]),
    transform: [
      { translateY: interpolate(focusProgress.value, [0.35, 1], [20, 0]) },
      { scale: interpolate(focusProgress.value, [0.35, 1], [0.82, 1]) }
    ]
  }));

  const dismissComposer = useCallback(() => {
    composerRef.current?.collapse();
  }, []);

  /**
   * 列表空白单击（已由 ConversationStage 过滤掉消息/事件详情点击）：
   * - 专注资格内：切换顶栏/输入显隐
   * - 非专注：只收起输入扩展（不进入专注）
   */
  const handleContentTap = useCallback(() => {
    if (focusEligible) {
      setFocusChromePinned((prev) => !prev);
      return;
    }
    dismissComposer();
  }, [dismissComposer, focusEligible]);

  const handleStageScrollBeginDrag = useCallback(() => {
    // 滚动只收起输入扩展，不切换专注 chrome（与单击区分）
    dismissComposer();
    onScrollBeginDrag();
  }, [dismissComposer, onScrollBeginDrag]);

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
      {chromeAtRest ? (
        <View
          style={[
            styles.topBar,
            {
              backgroundColor: notebookColors.main,
              borderBottomColor: notebookColors.line
            }
          ]}
        >
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
      ) : (
        <Reanimated.View
          pointerEvents={focusChrome ? 'none' : 'auto'}
          style={[{ overflow: 'hidden', backgroundColor: notebookColors.main }, topBarAnimStyle]}
        >
          <View
            style={[
              styles.topBar,
              {
                backgroundColor: notebookColors.main,
                borderBottomColor: notebookColors.line
              }
            ]}
          >
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
        </Reanimated.View>
      )}
      {/* 整块内容区 + 输入框一起被键盘顶起（比 Sticky 分轨更稳） */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 48}
        style={[styles.keyboardAwareContent, { backgroundColor: notebookColors.main }]}
      >
        <Animated.View style={styles.chatStageViewport}>
          <ChatConversationStage
            styles={styles}
            windowWidth={windowWidth}
            inputDockHeight={layoutChromeCollapsed ? 24 : inputDockHeight}
            notebookColors={notebookColors}
            showStreamTopGlow={showStreamTopGlow}
            streamTopGlowAnim={streamTopGlowAnim}
            renderedTurnsLength={renderedTurnsLength}
            currentWorkspaceName={currentWorkspaceName}
            messageScrollRef={messageScrollRef}
            shouldSuppressLoadOlder={shouldSuppressLoadOlder}
            messageBottomInset={
              layoutChromeCollapsed
                ? Math.max(48, messageBottomInset * 0.35)
                : messageBottomInset
            }
            displayedTurnCells={displayedTurnCells}
            chatViewabilityConfig={chatViewabilityConfig}
            onChatViewableItemsChanged={onChatViewableItemsChanged}
            loadingOlder={loadingOlder}
            onScrollBeginDrag={handleStageScrollBeginDrag}
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
            onBlankPress={handleContentTap}
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
        {/* 与改造前相同：自然高度；专注态仅淡出+负 margin 收占位，不锁 height */}
        <Reanimated.View
          style={composerAnimStyle}
          pointerEvents={focusChrome ? 'none' : 'auto'}
        >
          <ChatComposer ref={composerRef} {...composerProps} />
        </Reanimated.View>
      </KeyboardAvoidingView>

      {canAbortNow ? (
        <Reanimated.View
          pointerEvents={focusChrome ? 'auto' : 'none'}
          style={[styles.focusAbortFabWrap, focusAbortAnimStyle]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="停止生成"
            onPress={() => composerProps.onAbort?.()}
            style={[
              styles.focusAbortFab,
              {
                backgroundColor: themeDark ? '#F4F4F5' : '#1A1A1F',
                shadowOpacity: themeDark ? 0.35 : 0.12
              }
            ]}
          >
            <ComposerSendGlyph busy color={themeDark ? '#1A1A1F' : '#FFFFFF'} size={20} />
          </Pressable>
        </Reanimated.View>
      ) : null}

      {/* 进度气泡挂在顶栏下方，不随滚动 suppress，并可跟视口 todo 切换 */}
      {latestTodoCard && dismissedTodoCardId !== latestTodoCard.id ? (
        <MobileTodoProgressBubble
          card={latestTodoCard}
          expanded={!todoDockCollapsed}
          busy={thinkingPulse}
          styles={styles}
          rootStyle={todoRootAnimStyle}
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

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, StatusBar, Text, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Drawer } from 'react-native-drawer-layout';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  Easing as ReEasing,
  interpolate,
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

/** 与 ChatComposer 输入条右下角发送/停止钮对齐 */
const COMPOSER_H_INSET = 16;
const COMPOSER_DOCK_PAD_X = 6;
const COMPOSER_DOCK_HEIGHT = 52;
const COMPOSER_ACTION_BTN = 32;
const COMPOSER_MIN_BOTTOM_PAD = 10;
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
  const insets = useSafeAreaInsets();
  const focusAbortBottom =
    Math.max(COMPOSER_MIN_BOTTOM_PAD, insets.bottom) +
    (COMPOSER_DOCK_HEIGHT - COMPOSER_ACTION_BTN) / 2;
  const focusAbortRight = COMPOSER_H_INSET + COMPOSER_DOCK_PAD_X;
  const [activeNotebookPanel, setActiveNotebookPanel] = useState<NotebookPanel>('');
  const [mainRoute, setMainRoute] = useState<MainRoute>('chat');
  const activeNotebookPanelRef = useRef<NotebookPanel>('');
  const openNotifiedPanelRef = useRef<NotebookPanel>('');
  const composerRef = useRef<ChatComposerHandle>(null);
  /** Sticky Composer 测量节点：只写 contentInsetEndAdjustment，不直接 reportContentInset */
  const composerShellRef = useRef<View>(null);
  /** 专注收起时点底部原输入区唤出 chrome 后置 true；离开专注资格后自动清零 */
  const [focusChromePinned, setFocusChromePinned] = useState(false);
  const focusProgress = useSharedValue(0);
  const focusEligible =
    focusMode && !activeQuestionRequest && !activePermissionRequest;
  /** true = 顶栏/输入收起中 */
  const focusChrome = focusEligible && !focusChromePinned;
  const canAbortNow = !!composerProps.canAbortNow;
  /**
   * 顶栏占位：专注时一次性收到 0，把高度还给列表；退出时一次性恢复。
   * 只做跳变、不做 height 插值，避免 maintainScrollAtEnd 每帧追底抖动。
   */
  const [topChromeInset, setTopChromeInset] = useState(TOP_BAR_HEIGHT);

  /**
   * 只用 shared value 驱动 KeyboardAwareLegendList 的 extraContentPadding。
   * 不要像官方 hook 那样再 reportContentInset(composerH)：键盘弹起时 ChatScrollView
   * 已通过 onContentInsetChange 上报「键盘+composer」合成 inset，再写一次会盖掉键盘分量 → 微抖。
   */
  const contentInsetEndAdjustment = useSharedValue(Math.max(72, Number(inputDockHeight) || 88));
  const lastComposerInsetHRef = useRef(Math.max(72, Number(inputDockHeight) || 88));
  const onComposerLayout = useCallback((event: LayoutChangeEvent) => {
    const h = Math.round(Number(event.nativeEvent.layout?.height || 0));
    if (h <= 0) return;
    if (Math.abs(h - lastComposerInsetHRef.current) <= 2) return;
    lastComposerInsetHRef.current = h;
    contentInsetEndAdjustment.value = h;
  }, [contentInsetEndAdjustment]);

  useEffect(() => {
    if (focusChrome) {
      setTopChromeInset(0);
      focusProgress.value = withTiming(1, {
        duration: 280,
        easing: ReEasing.bezier(0.22, 1, 0.36, 1)
      });
      return;
    }

    if (!focusEligible) {
      setFocusChromePinned(false);
    }
    setTopChromeInset(TOP_BAR_HEIGHT);
    const from = focusProgress.value;
    focusProgress.value = withTiming(0, {
      duration: from < 0.08 ? 200 : 340,
      easing: ReEasing.bezier(0.16, 1, 0.3, 1)
    });
  }, [focusChrome, focusEligible, focusProgress]);

  /**
   * 顶栏浮层：opacity + 上移收起；占位由 topChromeInset 一次性切换，不在这里改 layout height。
   */
  const topBarAnimStyle = useAnimatedStyle(() => {
    const p = focusProgress.value;
    return {
      opacity: interpolate(p, [0, 1], [1, 0]),
      transform: [{ translateY: interpolate(p, [0, 1], [0, -TOP_BAR_HEIGHT]) }]
    };
  });

  /**
   * 专注收起：仅视觉淡出/微移，保持 Sticky 测量高度与 contentInset 不变。
   */
  const composerAnimStyle = useAnimatedStyle(() => {
    const p = focusProgress.value;
    return {
      opacity: interpolate(p, [0, 1], [1, 0]),
      transform: [{ translateY: interpolate(p, [0, 1], [0, 16]) }]
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

  /** 与打断钮同节奏出现：底部原输入区热区 */
  const focusRevealAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focusProgress.value, [0.35, 1], [0, 1])
  }));

  const focusRevealHitHeight = Math.max(
    COMPOSER_DOCK_HEIGHT + Math.max(COMPOSER_MIN_BOTTOM_PAD, insets.bottom),
    Math.round(Number(inputDockHeight) || 0)
  );

  const dismissComposer = useCallback(() => {
    composerRef.current?.collapse();
  }, []);

  /** 空会话占位点击：非专注时收起输入扩展 */
  const handleContentTap = useCallback(() => {
    if (focusEligible) return;
    dismissComposer();
  }, [dismissComposer, focusEligible]);

  const revealFocusComposer = useCallback(() => {
    setFocusChromePinned(true);
  }, []);

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
      {/* 顶栏浮层：列表区 paddingTop 随专注一次性收放，把高度还给内容 */}
      <Reanimated.View
        pointerEvents={focusChrome ? 'none' : 'auto'}
        style={[
          styles.topBarOverlay,
          { backgroundColor: notebookColors.main },
          topBarAnimStyle
        ]}
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
      {/* 官方聊天结构：列表铺满 + 浮动 Sticky Composer；勿包 KAV，勿与 flex 底栏双占位 */}
      <View
        style={[
          styles.keyboardAwareContent,
          { backgroundColor: notebookColors.main, paddingTop: topChromeInset }
        ]}
      >
        <Animated.View
          style={[
            styles.chatStageViewport,
            activeQuestionRequest || activePermissionRequest
              ? { paddingBottom: Math.max(72, Number(inputDockHeight) || 88) }
              : null
          ]}
        >
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
            contentInsetEndAdjustment={contentInsetEndAdjustment}
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
        <KeyboardStickyView
          offset={{ closed: 0, opened: insets.bottom }}
          style={[styles.composerStickyDock, { backgroundColor: notebookColors.main }]}
        >
          <Reanimated.View
            style={composerAnimStyle}
            pointerEvents={focusChrome ? 'none' : 'auto'}
          >
            <View ref={composerShellRef} collapsable={false} onLayout={onComposerLayout}>
              <ChatComposer ref={composerRef} {...composerProps} />
            </View>
          </Reanimated.View>
        </KeyboardStickyView>
      </View>

      {focusEligible ? (
        <Reanimated.View
          pointerEvents={focusChrome ? 'auto' : 'none'}
          style={[
            styles.focusComposerRevealWrap,
            { height: focusRevealHitHeight },
            focusRevealAnimStyle
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="显示输入框"
            onPress={revealFocusComposer}
            style={styles.focusComposerRevealHit}
          />
        </Reanimated.View>
      ) : null}

      {canAbortNow ? (
        <Reanimated.View
          pointerEvents={focusChrome ? 'auto' : 'none'}
          style={[
            styles.focusAbortFabWrap,
            { right: focusAbortRight, bottom: focusAbortBottom },
            focusAbortAnimStyle
          ]}
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

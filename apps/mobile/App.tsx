import React, { useCallback, useEffect, useMemo } from "react";
import { InteractionManager, useWindowDimensions } from "react-native";
import { CameraView } from "expo-camera";
import { useFonts } from "expo-font";
import { useStreamManager } from "./src/features/stream/useStreamManager";
import { useOpenCodeStreamRuntime } from "./src/features/stream/useOpenCodeStreamRuntime";
import { useChatListController } from "./src/features/chat/useChatListController";
import { useChatCellWindow } from "./src/features/chat/useChatCellWindow";
import {
  flattenTurnsForList,
  type DisplayedTurnCell,
} from "./src/features/chat/displayedCells";
import { useBootstrapPersistence } from "./src/features/chat/useBootstrapPersistence";
import { useAuthedStartupEffects } from "./src/features/chat/useAuthedStartupEffects";
import {
  CHAT_BOTTOM_PROXIMITY,
  CHAT_LIST_BOTTOM_AIR,
  COMPOSER_MODE_OPTIONS,
  HISTORY_PREFETCH_COOLDOWN_MS,
  IMAGE_SEND_TIMEOUT_MS,
  INITIAL_CELL_LIMIT,
  INITIAL_MESSAGE_FETCH_LIMIT,
  INITIAL_SESSION_LIMIT,
  OLDER_MESSAGE_FETCH_LIMIT,
  OLDER_SESSION_LIMIT,
  stableSortSessionItems,
  streamDebug,
} from "./src/features/chat/mobileAppConfig";
import { useChatMotionState } from "./src/features/chat/useChatMotionState";
import { useChatScreenDerivedState } from "./src/features/chat/useChatScreenDerivedState";
import { useChatUiActions } from "./src/features/chat/useChatUiActions";
import { useChatWorkspaceEvents } from "./src/features/chat/useChatWorkspaceEvents";
import { useChatWorkspacePanelProps } from "./src/features/chat/useChatWorkspacePanelProps";
import { useComposerPresentationState } from "./src/features/chat/useComposerPresentationState";
import { useConnectionLogger } from "./src/features/chat/useConnectionLogger";
import { useDisplayedTurnsWithThinking } from "./src/features/chat/useDisplayedTurnsWithThinking";
import { useDrawerPulseState } from "./src/features/chat/useDrawerPulseState";
import { useGlobalErrorLogger } from "./src/features/chat/useGlobalErrorLogger";
import { useMobileConnectionFlow } from "./src/features/chat/useMobileConnectionFlow";
import { useMobileAppRefs } from "./src/features/chat/useMobileAppRefs";
import { useMobileAppServices } from "./src/features/chat/useMobileAppServices";
import { useMobileAppState } from "./src/features/chat/useMobileAppState";
import { useMobileShellLifecycle } from "./src/features/chat/useMobileShellLifecycle";
import { useNotebookColors } from "./src/features/chat/useNotebookColors";
import { useNotebookNavigationController } from "./src/features/chat/useNotebookNavigationController";
import { useNotebookDrawerRenderers } from "./src/features/chat/useNotebookDrawerRenderers";
import { useProjectSwitchAction } from "./src/features/chat/useProjectSwitchAction";
import { useSessionRecovery } from "./src/features/chat/useSessionRecovery";
import { useLeftDrawerController } from "./src/features/chat/useLeftDrawerController";
import { useRightDrawerController } from "./src/features/chat/useRightDrawerController";
import { useSessionHeaderState } from "./src/features/chat/useSessionHeaderState";
import { useSessionLifecycleActions } from "./src/features/chat/useSessionLifecycleActions";
import { useSessionSwitchController } from "./src/features/chat/useSessionSwitchController";
import { useSyncedLatestRefs } from "./src/features/chat/useSyncedLatestRefs";
import { useTodoDockController } from "./src/features/chat/useTodoDockController";
import { useInteractiveTurnCells } from "./src/features/chat/useInteractiveTurnCells";
import { useTurnCellRenderer } from "./src/features/chat/useTurnCellRenderer";
import {
  assistantTextWeight,
  formatSessionTimestamp,
  isPlaceholderSessionTitle,
  losesRenderedAssistant,
  pickSessionDisplayTitle,
  summarizePreview,
} from "./src/features/chat/sessionDisplay";
import { useAttachmentProcessor } from "./src/features/media/useAttachmentProcessor";
import { useComposerUiController } from "./src/features/media/useComposerUiController";
import { useSlashCommandCatalog } from "./src/features/media/useSlashCommandCatalog";
import { ChatWorkspaceScreen } from "./src/components/chat/ChatWorkspaceScreen";
import { MobileLaunchOverlay } from "./src/components/chat/MobileLaunchOverlay";
import { MobileAppRouter } from "./src/screens/MobileAppRouter";
import { toText } from "./src/lib/text";
import { formatClock } from "./src/lib/time";
import {
  FONT_DISPLAY_SERIF,
  FONT_TEXT_SERIF,
  FONT_TEXT_SERIF_SEMIBOLD,
  FONT_UI_MEDIUM,
  FONT_UI_REGULAR,
} from "./src/styles/mobileFonts";
import { styles } from "./src/styles/mobileAppStyles";
import {
  buildStreamUrl,
  getInstalledOpencodeSkills,
  getOpencodeConfig,
  getOpencodeMcpStatus,
  NO_AUTH_TOKEN,
} from "./src/api/controlApi";
import { inspectTurnWindow } from "./src/features/messages/turns";
import { buildLiveTodoCard } from "./src/features/messages/todoCards";
import { useOptimisticUserMessages } from "./src/features/messages/useOptimisticUserMessages";
import { usePromptActions } from "./src/features/messages/usePromptActions";
import { useSessionMessageSync } from "./src/features/messages/useSessionMessageSync";
import { useTurnWindowController } from "./src/features/messages/useTurnWindowController";
import { useQuestionController } from "./src/features/questions/useQuestionController";
import { useWorkspaceCatalogController } from "./src/features/workspace/useWorkspaceCatalogController";
import {
  extractModelOptionsFromConfig,
  normalizeMcpStatusMap,
  projectNameFromPath,
  sanitizeProjectOptions,
  stripUrlScheme,
  toProjectOptionsFromPaths,
} from "./src/features/workspace/catalogUtils";

// keys + storage moved to src/storage/*

const CameraViewCompat: any = CameraView;

// DEFAULT_PREFS moved to src/storage/prefs

// prefs + discover cache moved to src/storage/*

export default function App() {
  const [fontsLoaded] = useFonts({
    [FONT_DISPLAY_SERIF]: require("./assets/fonts/GalaxieCopernicus-Book.otf"),
    [FONT_TEXT_SERIF]: require("./assets/fonts/TestTiemposText-Regular.otf"),
    [FONT_TEXT_SERIF_SEMIBOLD]: require("./assets/fonts/TestTiemposText-Semibold.otf"),
    [FONT_UI_REGULAR]: require("./assets/fonts/StyreneA-Regular-Trial-BF63f6cbd970ee9.otf"),
    [FONT_UI_MEDIUM]: require("./assets/fonts/StyreneA-Medium-Trial-BF63f6cbdb24b6d.otf"),
  });
  const { width: windowWidth } = useWindowDimensions();
  const {
    loaded,
    setLoaded,
    busy,
    setBusy,
    status,
    setStatus,
    serverUrl,
    setServerUrl,
    serverUrlInput,
    setServerUrlInput,
    serverUrlTouched,
    setServerUrlTouched,
    preferHttps,
    setPreferHttps,
    pairCode,
    setPairCode,
    repoPath,
    setRepoPath,
    token,
    setToken,
    sessionId,
    setSessionId,
    model,
    setModel,
    composerAgent,
    setComposerAgent,
    autoAcceptPermissions,
    setAutoAcceptPermissions,
    modelOptions,
    setModelOptions,
    installedSkills,
    setInstalledSkills,
    installedMcpServers,
    setInstalledMcpServers,
    extensionsLoading,
    setExtensionsLoading,
    projects,
    setProjects,
    sessionSearch,
    setSessionSearch,
    imageAttachments,
    setImageAttachments,
    previewImage,
    setPreviewImage,
    messages,
    setMessages,
    renderedTurns,
    setRenderedTurns,
    sessionStatusMap,
    setSessionStatusMap,
    streaming,
    setStreaming,
    expandedThinkCards,
    setExpandedThinkCards,
    notebookTheme,
    setNotebookTheme,
    sessions,
    setSessions,
    sessionNextCursor,
    setSessionNextCursor,
    sessionHasMore,
    setSessionHasMore,
    sessionHistoryRetryHint,
    setSessionHistoryRetryHint,
    loadingOlder,
    setLoadingOlder,
    sessionDisplayedCount,
    setSessionDisplayedCount,
    inputDockHeight,
    setInputDockHeight,
    streamTodoCard,
    setStreamTodoCard,
    chatListResetKey,
    setChatListResetKey,
    startupSessionHydrating,
    setStartupSessionHydrating,
  } = useMobileAppState();
  const {
    streamRef,
    sessionIdRef,
    streamSessionRef,
    projectsRef,
    sessionsRef,
    messagesRef,
    renderedTurnsRef,
    chatCellHeightMapRef,
    sessionCacheRef,
    modelOptionsRef,
    sessionRawMapRef,
    sessionOptimisticUserMapRef,
    optimisticUserIdAliasRef,
    sentAttachmentCacheRef,
    pendingPromptSessionRef,
    renderRegressionRetryRef,
    streamMessageRoleRef,
    streamMessageStoreRef,
    streamPartStoreRef,
    streamSessionStatusStoreRef,
    streamPermissionStoreRef,
    streamQuestionStoreRef,
    streamTodoStoreRef,
    streamPendingPartEventsRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    streamRunIdRef,
    streamRenderTimerRef,
    streamTypewriterTimerRef,
    streamTypewriterQueueRef,
    sessionStatusEpochRef,
    busySinceRef,
    appStateRef,
    pairCodeMapRef,
    closeDiscoverRef,
    discoveredPairRequiredRef,
    sessionMessageSyncRef,
    applyTurnWindowRef,
    sessionRecoveryRef,
    getOpenCodeStreamStores,
    applyTurnWindow,
  } = useMobileAppRefs();
  const pushConnLog = useConnectionLogger();
  const {
    streamManagerHandleRef,
    workspaceCatalogHandleRef,
    startStream,
    stopStream,
    syncSessionStatus,
    refreshInstalledExtensions,
    refreshSessionsFromServer,
    refreshMessages,
    syncSessionMessages,
    onLoadOlderMessages,
    refreshModelCatalog,
    refreshProjectsCatalog,
  } = useMobileAppServices({
    sessionMessageSyncRef,
    sessionRecoveryRef,
  });

  const {
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
  } = useChatListController<DisplayedTurnCell>({
    initialCellLimit: INITIAL_CELL_LIMIT,
    chatBottomProximity: CHAT_BOTTOM_PROXIMITY,
    historyPrefetchCooldownMs: HISTORY_PREFETCH_COOLDOWN_MS,
  });
  const {
    leftDrawerPulse,
    rightDrawerPulse,
    triggerLeftPulse,
    triggerRightPulse,
  } = useDrawerPulseState();

  const authed = useMemo(() => token.trim().length > 0, [token]);
  const slashCommands = useSlashCommandCatalog({ repoPath, serverUrl, token });
  const {
    ingestStreamRows,
    publishStreamRows,
    recordStreamMessageRoles,
    renderStreamWindow,
    resetOpenCodeStreamStores,
  } = useOpenCodeStreamRuntime({
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    sessionIdRef,
    streamMessageRoleRef,
    streamMessageStoreRef,
    streamPartStoreRef,
    streamPendingPartEventsRef,
    streamRenderTimerRef,
    streamTypewriterTimerRef,
    streamTypewriterQueueRef,
    messageContentHRef,
    messageViewportHRef,
    messageScrollYRef,
    messageUserScrollingRef,
    forceScrollToLatestUntilRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    getOpenCodeStreamStores,
    applyTurnWindow,
    scrollToLatest,
    streamDebug,
    setStreaming,
  });
  const {
    activeQuestionRequest,
    dismissedQuestions,
    expandedTimelineQuestions,
    extractQuestionRequests,
    handleQuestionDismiss,
    handleQuestionReply,
    handleTimelineQuestionToggle,
    handleTimelineTabChange,
    persistQuestionDismissal,
    questionRequests,
    questionSubmitState,
    resetTimelineQuestionState,
    setDismissedQuestions,
    setQuestionRequests,
    setQuestionSubmitState,
    timelineQuestionTabs,
  } = useQuestionController({
    authed,
    serverUrl,
    token,
    repoPath,
    sessionId,
    streaming,
    sessionStatusMap,
    sessionIdRef,
    sessionRawMapRef,
    getOpenCodeStreamStores,
    pushConnLog,
    setStatus,
    startStream,
    syncSessionMessages,
    syncSessionStatus,
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
  });

  const { startStream: startStreamManager, stopStream: stopStreamManager } =
    useStreamManager({
      authed,
      serverUrl,
      repoPath,
      token,
      pairCode,
      NO_AUTH_TOKEN,
      sessionIdRef,
      streamRef,
      streamRunIdRef,
      streamSessionRef,
      sessionStatusEpochRef,
      streamRenderTimerRef,
      streamTypewriterTimerRef,
      streamTypewriterQueueRef,
      messageContentHRef,
      messageViewportHRef,
      messageScrollYRef,
      messageUserScrollingRef,
      forceScrollToLatestUntilRef,
      sessionVisibleTurnCountRef,
      sessionTotalTurnCountRef,
      getOpenCodeStreamStores,
      pushConnLog,
      streamDebug,
      setStreaming,
      setStatus,
      setToken,
      setSessionStatusMap,
      setStreamTodoCard,
      setQuestionRequests,
      setDismissedQuestions,
      applyTurnWindow,
      scrollToLatest,
      syncSessionMessages,
      syncSessionStatus,
      extractQuestionRequests,
      buildLiveTodoCard,
      saveQuestionDismissal: persistQuestionDismissal,
      dismissedQuestions,
    });
  streamManagerHandleRef.current = {
    startStream: startStreamManager,
    stopStream: stopStreamManager,
  };

  const resetSessionInteractionState = useCallback(() => {
    setExpandedThinkCards(new Set());
    resetTimelineQuestionState();
  }, [resetTimelineQuestionState, setExpandedThinkCards]);

  const streamTopGlowRequested = false;
  const { thinkingPulse, showStreamTopGlow, streamTopGlowAnim } =
    useChatMotionState({
      streaming,
      streamTopGlowRequested,
      streamTopGlowEnabled: false,
    });
  const appReady = fontsLoaded && loaded;
  const { keyboardInset, launchOverlayOpacity, launchOverlayVisible } =
    useMobileShellLifecycle({
      appReady,
      setStartupSessionHydrating,
      startupSessionHydrating,
    });
  useGlobalErrorLogger({ pushConnLog });

  useEffect(() => {
    setStreamTodoCard(null);
  }, [sessionId]);

  const statusText = toText(status);
  const notebookColors = useNotebookColors(notebookTheme);
  const {
    scannerOpen,
    scannerLocked,
    scannerReady,
    scanHitCount,
    lastScanAt,
    onAuthSubmit,
    onOpenScanner,
    onPickQrFromAlbum,
    onBarcodeScanned,
    onCloseScanner,
    onScannerReady,
    onScannerMountError,
    onScannerRescan,
    discoverOpen,
    discoveringUi,
    discoverDeviceRows,
    connectingDiscoverId,
    connectProgressScaleX,
    pairPromptOpen,
    pairPromptHostPort,
    pairPromptValue,
    onOpenDiscover,
    onCloseDiscover,
    startDiscover,
    onConnectDiscoverPress,
    setPairPromptValue,
    cancelPairPrompt,
    confirmPairPrompt,
  } = useMobileConnectionFlow({
    preferHttps,
    serverUrl,
    serverUrlInput,
    pairCode,
    pairCodeMapRef,
    closeDiscoverRef,
    discoveredPairRequiredRef,
    setBusy,
    setStatus,
    setServerUrl,
    setServerUrlInput,
    setServerUrlTouched,
    setPreferHttps,
    setPairCode,
    setToken,
    setRepoPath,
    setProjects,
    pushConnLog,
    refreshProjectsCatalog,
    toProjectOptionsFromPaths,
  });

  const {
    optimisticVersion,
    bumpOptimisticVersion,
    upsertOptimisticUserMessage,
    dropOptimisticUserMessage,
    reconcileOptimisticUserMessages,
    stabilizeServerUserTurnIds,
    overlayOptimisticTurns,
    appendOptimisticTurnAndStick,
    clearSessionOptimisticMessages,
  } = useOptimisticUserMessages({
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    sessionIdRef,
    sessionOptimisticUserMapRef,
    optimisticUserIdAliasRef,
    sentAttachmentCacheRef,
    forceScrollToLatestUntilRef,
    sessionVisibleTurnCountRef,
    setMessages,
    setRenderedTurns,
  });
  const turnWindowController = useTurnWindowController({
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
    repoPath,
    sessionNextCursor,
    sessionIdRef,
    sessionRawMapRef,
    sentAttachmentCacheRef,
    renderRegressionRetryRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    messagesRef,
    renderedTurnsRef,
    sessionMessageSyncRef,
    publishStreamRows,
    pushConnLog,
    summarizePreview,
    stableSortSessionItems,
    losesRenderedAssistant,
    assistantTextWeight,
    reconcileOptimisticUserMessages,
    stabilizeServerUserTurnIds,
    overlayOptimisticTurns,
    setMessages,
    setRenderedTurns,
    setSessions,
    setSessionHasMore,
  });
  applyTurnWindowRef.current = turnWindowController.applyTurnWindow;
  function onChangeServerUrl(value: string) {
    setServerUrlTouched(true);
    setServerUrlInput(value);
  }

  useSyncedLatestRefs({
    refs: [
      { ref: projectsRef, value: projects },
      { ref: sessionsRef, value: sessions },
      { ref: messagesRef, value: messages },
      { ref: renderedTurnsRef, value: renderedTurns },
      { ref: modelOptionsRef, value: modelOptions },
    ],
  });

  useAuthedStartupEffects({
    authed,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    loaded,
    projectsLength: projects.length,
    refreshModelCatalog,
    refreshProjectsCatalog,
    refreshSessionsFromServer,
    repoPath,
    serverUrl,
    sessionId,
    setStartupSessionHydrating,
    syncSessionMessages,
    token,
  });

  const sessionRecovery = useSessionRecovery({
    authed,
    busy,
    repoPath,
    serverUrl,
    token,
    streaming,
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
    sessionIdRef,
    appStateRef,
    busySinceRef,
    pendingPromptSessionRef,
    sessionStatusEpochRef,
    setBusy,
    setStatus,
    setStreaming,
    setSessionStatusMap,
    startStream,
    syncSessionMessages,
  });
  sessionRecoveryRef.current = sessionRecovery;

  const workspaceCatalog = useWorkspaceCatalogController({
    authed,
    repoPath,
    serverUrl,
    token,
    sessionsRef,
    projectsRef,
    sessionCacheRef,
    modelOptionsRef,
    setSessions,
    setProjects,
    setRepoPath,
    setModelOptions,
    setModel,
    setInstalledSkills,
    setInstalledMcpServers,
    setExtensionsLoading,
    setStatus,
    pushConnLog,
    triggerLeftPulse,
    triggerRightPulse,
    stableSortSessionItems,
    isPlaceholderSessionTitle,
    extractModelOptionsFromConfig,
    normalizeMcpStatusMap,
    sanitizeProjectOptions,
    projectNameFromPath,
  });
  workspaceCatalogHandleRef.current = workspaceCatalog;

  const {
    activeQuestionsForTurn,
    currentSessionStatus,
    latestTurnMeta,
    liveQuestionTurnId,
    localPendingCount,
    sessionWorking,
  } = useChatScreenDerivedState({
    sessionId,
    streaming,
    optimisticVersion,
    renderedTurns,
    sessionStatusMap,
    sessionOptimisticUserMapRef,
  });

  const {
    prompt,
    setPrompt,
    slashOpen,
    setSlashOpen,
    slashActiveIndex,
    slashSuggestions,
    attachmentMenuOpen,
    setAttachmentMenuOpen,
    attachmentPanelVisible,
    recentImages,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentImagesHasNext,
    composerPickerOpen,
    openComposerPicker,
    closeComposerPicker,
    actionIconAnim,
    attachmentToggleAnim,
    attachmentPanelStyle,
    recentScrollerHeight,
    canSendNow,
    canAbortNow,
    handlePromptChange,
    handleSlashSelect,
    handleToggleAttachmentMenu,
    handleDismissAttachmentPanel,
    maybeLoadMoreRecentImages,
  } = useComposerUiController({
    windowWidth,
    busy,
    sessionWorking,
    imageAttachments,
    slashCommands,
    setStatus,
  });

  const {
    albumPickerOpen,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    mediaAlbums,
    selectedMediaAlbumId,
    albumSelectedIds,
    albumSelectedSet,
    closeAlbumPicker,
    openAlbumPicker,
    selectMediaAlbum,
    toggleAlbumImage,
    confirmAlbumSelection,
    loadMoreAlbumImages,
    photoCameraOpen,
    photoCameraReady,
    photoCameraBusy,
    photoCameraRef,
    setPhotoCameraOpen,
    setPhotoCameraReady,
    pickImageFromLibrary,
    captureWithCamera,
    takePhotoFromInlineCamera,
    attachRecentImage,
  } = useAttachmentProcessor({
    setStatus,
    setImageAttachments,
    setAttachmentMenuOpen,
  });

  const {
    notebookPage,
    workspaceSwitcherOpen,
    setWorkspaceSwitcherOpen,
    notebookTrackX,
    notebookPanResponder,
    openDrawer,
    closeDrawer,
    switchNotebookPage,
    toggleWorkspaceSwitcher,
  } = useNotebookNavigationController({
    windowWidth,
    onBeforeOpenDrawer: closeComposerPicker,
    onOpenLeftDrawer: () => {
      void InteractionManager.runAfterInteractions(() => {
        void refreshProjectsCatalog();
        void refreshSessionsFromServer();
      });
    },
    onOpenRightDrawer: () => {
      void InteractionManager.runAfterInteractions(() => {
        void refreshInstalledExtensions();
      });
    },
  });

  useEffect(() => {
    if (notebookPage !== "right") return;
    void refreshInstalledExtensions();
  }, [notebookPage, repoPath, serverUrl, token, authed]);

  const { displayedTurns } = useDisplayedTurnsWithThinking({
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    streamDebug,
  });
  const allDisplayedTurnCells = useMemo(
    () => flattenTurnsForList(displayedTurns),
    [displayedTurns],
  );
  const messageBottomInset = CHAT_LIST_BOTTOM_AIR;
  const {
    displayedTurnCells,
    displayedTurnCellsRef,
    visibleCellCountRef,
    historyProgressWidth,
    initialChatScrollIndex,
    initialChatScrollOffset,
    chatStartsFromBottom,
    chatListMountKey,
  } = useChatCellWindow<DisplayedTurnCell>({
    allDisplayedTurnCells,
    sessionId,
    chatListResetKey,
    chatViewportSnapshotRef,
  });
  const { sessionSwitchingTo, setSessionSwitchingTo, setActiveSession } =
    useSessionSwitchController<DisplayedTurnCell>({
      initialSessionLimit: INITIAL_SESSION_LIMIT,
      sessionIdRef,
      sessionRawMapRef,
      sessionVisibleTurnCountRef,
      displayedTurnCellsRef,
      visibleCellCountRef,
      messagesRef,
      renderedTurnsRef,
      chatViewportSnapshotRef,
      sessionNextCursor,
      rememberCurrentSessionViewport,
      resetListInteractionState,
      resetSessionInteractionState,
      applyTurnWindow,
      setSessionId,
      setQuestionRequests,
      setQuestionSubmitState,
      setMessages,
      setRenderedTurns,
      setSessionStatusMap,
    });
  useBootstrapPersistence({
    loaded,
    serverUrl,
    serverUrlTouched,
    preferHttps,
    pairCode,
    repoPath,
    projects,
    token,
    sessionId,
    model,
    composerAgent,
    autoAcceptPermissions,
    notebookTheme,
    setLoaded,
    setStatus,
    setServerUrl,
    setServerUrlInput,
    setServerUrlTouched,
    setPreferHttps,
    setPairCode,
    setRepoPath,
    setProjects,
    setToken,
    setSessionId,
    setComposerAgent,
    setAutoAcceptPermissions,
    setNotebookTheme,
    setMessages,
    setRenderedTurns,
    setStartupSessionHydrating,
    setModel,
    setSessionSwitchingTo,
    sessionIdRef,
    pairCodeMapRef,
    sessionCacheRef,
    sessionRawMapRef,
    messagesRef,
    renderedTurnsRef,
    stopStream,
    stripUrlScheme,
    toProjectOptionsFromPaths,
  });
  const sessionMessageSync = useSessionMessageSync<DisplayedTurnCell>({
    authed,
    serverUrl,
    token,
    repoPath,
    sessionId,
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    olderSessionLimit: OLDER_SESSION_LIMIT,
    olderMessageFetchLimit: OLDER_MESSAGE_FETCH_LIMIT,
    sessionIdRef,
    pendingPromptSessionRef,
    sessionRawMapRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    displayedTurnCellsRef,
    visibleCellCountRef,
    sessionNextCursor,
    loadingOlder,
    pushConnLog,
    setStatus,
    setSessionNextCursor,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setLoadingOlder,
    setStreaming,
    setSessionSwitchingTo,
    ingestStreamRows,
    recordStreamMessageRoles,
    applyTurnWindow,
    syncSessionStatus,
    rememberCurrentSessionViewport,
    streamDebug,
  });
  sessionMessageSyncRef.current = sessionMessageSync;
  const { onNewSession, onResetAuth } = useSessionLifecycleActions({
    sessionIdRef,
    sessionRawMapRef,
    sessionOptimisticUserMapRef,
    optimisticUserIdAliasRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    renderRegressionRetryRef,
    sessionMessageSyncRef,
    stopStream,
    resetOpenCodeStreamStores,
    bumpOptimisticVersion,
    setActiveSession,
    setToken,
    setPairCode,
    setRepoPath,
    setProjects,
    setMessages,
    setRenderedTurns,
    setSessionNextCursor,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setStartupSessionHydrating,
    setStatus,
    pushConnLog,
  });
  const onSwitchProject = useProjectSwitchAction({
    repoPath,
    sessionCacheRef,
    sessionRawMapRef,
    sessionOptimisticUserMapRef,
    optimisticUserIdAliasRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    renderRegressionRetryRef,
    sessionsRef,
    sessionMessageSyncRef,
    stableSortSessionItems,
    projectNameFromPath,
    stopStream,
    resetOpenCodeStreamStores,
    bumpOptimisticVersion,
    refreshModelCatalog,
    refreshSessionsFromServer,
    setStartupSessionHydrating,
    setRepoPath,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setSessions,
    setSessionNextCursor,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setStatus,
  });
  const {
    currentSessionTitle,
    sessionSwitchingTitle,
    showNotebookSessionTitle,
  } = useSessionHeaderState({
    sessions,
    sessionId,
    sessionSwitchingTo,
    messages,
    renderedTurnsLength: renderedTurns.length,
    pickSessionDisplayTitle,
    isPlaceholderSessionTitle,
  });
  const {
    currentWorkspaceName,
    availableProjects,
    currentWorkspaceSessions,
    leftDrawerSessionRows,
    handleDrawerProjectSelect,
    handleDrawerSessionSelect,
    handleNewSession,
    handleShowMoreSessions,
    onChangeSessionSearch,
  } = useLeftDrawerController({
    projects,
    projectsRefCurrent: projectsRef.current,
    repoPath,
    sessions,
    sessionSearch,
    sessionDisplayedCount,
    sessionId,
    messages,
    sessionRawMapRef,
    sessionIdRef,
    pickSessionDisplayTitle,
    projectNameFromPath,
    sanitizeProjectOptions,
    formatSessionTimestamp,
    stopStream,
    closeDrawer,
    setWorkspaceSwitcherOpen,
    setMessages,
    setRenderedTurns,
    setSessionSearch,
    setSessionDisplayedCount,
    setSessionSwitchingTo,
    onNewSession,
    onSwitchProject,
    setActiveSession,
    syncSessionMessages,
    syncSessionStatus,
    startStream,
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
    messagesRef,
    renderedTurnsRef,
  });
  const { visibleQuickSkillRefs, visibleQuickMcpRefs, insertQuickReference } =
    useRightDrawerController({
      installedSkills,
      installedMcpServers,
      closeDrawer,
      setPrompt,
    });
  const { copyMessageText, onAbort, onSendPrompt } = usePromptActions({
    authed,
    serverUrl,
    token,
    repoPath,
    pairCode,
    prompt,
    model,
    composerAgent,
    autoAcceptPermissions,
    imageAttachments,
    imageSendTimeoutMs: IMAGE_SEND_TIMEOUT_MS,
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
    sessionIdRef,
    pendingPromptSessionRef,
    sentAttachmentCacheRef,
    setStatus,
    setBusy,
    setToken,
    setPrompt,
    setSlashOpen,
    setImageAttachments,
    setChatListResetKey,
    setSessionStatusMap,
    setActiveSession,
    startStream,
    stopStream,
    syncSessionMessages,
    syncSessionStatus,
    refreshSessionsFromServer,
    pushConnLog,
    upsertOptimisticUserMessage,
    dropOptimisticUserMessage,
    appendOptimisticTurnAndStick,
    clearSessionOptimisticMessages,
  });
  const canLoadEarlierHistory = !!sessionHasMore[sessionId] || !!toText(sessionNextCursor[sessionId]).trim();
  const { composerModeOptions, inputModelLabel } = useComposerPresentationState(
    {
      model,
      modelOptions,
      modeOptions: COMPOSER_MODE_OPTIONS,
    },
  );
  const {
    handleAbortPrompt,
    handleCaptureCamera,
    handleComposerHeight,
    handleComposerPickerMode,
    handleComposerPickerModel,
    handleCopyImage,
    handleCopyMessage,
    handleOpenAlbumPicker,
    handleOpenPreviewImage,
    handlePickAttachmentFile,
    handleRemoveAttachment,
    handleSendPrompt,
    handleThinkCardToggle,
  } = useChatUiActions({
    inputDockHeight,
    closeComposerPicker,
    copyMessageText,
    onSendPrompt,
    onAbort,
    captureWithCamera,
    openAlbumPicker,
    pickImageFromLibrary,
    setPreviewImage,
    setExpandedThinkCards,
    setInputDockHeight,
    setImageAttachments,
    setAttachmentMenuOpen,
    setComposerAgent,
    setModel,
  });
  const {
    dismissedTodoCardId,
    dismissTodoDock,
    latestTodoCard,
    todoDockCollapsed,
    toggleTodoDock,
  } = useTodoDockController({
    displayedTurns,
    sessionId,
    sessionWorking,
    streamTodoCard,
  });
  const interactionByCellId = useInteractiveTurnCells({
    displayedTurnCells,
    expandedThinkCards,
    expandedTimelineQuestions,
    newestFirst: true,
    timelineQuestionTabs,
  });
  const { getChatCellType, renderTurnCell } = useTurnCellRenderer({
    activeQuestionsForTurn,
    bodyFontFamily: FONT_UI_REGULAR,
    chatCellHeightMapRef,
    interactionByCellId,
    handleCopyImage,
    handleCopyMessage,
    handleOpenPreviewImage,
    handleQuestionReply,
    handleThinkCardToggle,
    handleTimelineQuestionToggle,
    handleTimelineTabChange,
    prepareCellLayoutAdjustment,
    settleCellLayoutAdjustment,
    liveQuestionTurnId,
    sessionWorking,
    styles,
    thinkingPulse,
  });
  const {
    handleLoadOlderMessages,
    handleWorkspaceContentSizeChange,
    handleWorkspaceListLayout,
    handleWorkspaceScroll,
  } = useChatWorkspaceEvents({
    canLoadEarlierHistory,
    handleContentSizeChange,
    handleListLayout,
    loadingOlder,
    onLoadOlderMessages,
    onMessageListScroll,
  });
  const {
    albumPickerProps,
    composerPickerProps,
    composerProps,
    handleClosePreviewImage,
  } = useChatWorkspacePanelProps({
    actionIconAnim,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    albumPickerOpen,
    albumSelectedIds,
    albumSelectedSet,
    attachRecentImage,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentPanelVisible,
    attachmentToggleAnim,
    autoAcceptPermissions,
    canAbortNow,
    canSendNow,
    closeAlbumPicker,
    closeComposerPicker,
    composerAgent,
    composerModeOptions,
    composerPickerOpen,
    confirmAlbumSelection,
    handleAbortPrompt,
    handleCaptureCamera,
    handleComposerHeight,
    handleComposerPickerMode,
    handleComposerPickerModel,
    handleDismissAttachmentPanel,
    handleOpenAlbumPicker,
    handleOpenPreviewImage,
    handlePickAttachmentFile,
    handlePromptChange,
    handleRemoveAttachment,
    handleSendPrompt,
    handleSlashSelect,
    handleToggleAttachmentMenu,
    imageAttachments,
    inputModelLabel,
    keyboardInset,
    loadMoreAlbumImages,
    mediaAlbums,
    maybeLoadMoreRecentImages,
    model,
    modelOptions,
    notebookColors,
    openComposerPicker,
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    selectedMediaAlbumId,
    selectMediaAlbum,
    setAutoAcceptPermissions,
    setPreviewImage,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles,
    toggleAlbumImage,
  });
  const { leftDrawer, rightDrawer } = useNotebookDrawerRenderers({
    styles,
    notebookColors,
    leftDrawerPulse,
    rightDrawerPulse,
    currentWorkspaceName,
    workspaceSwitcherOpen,
    availableProjects,
    repoPath,
    sessionSearch,
    leftDrawerSessionRows,
    showMoreSessions:
      !sessionSearch.trim() &&
      currentWorkspaceSessions.length > sessionDisplayedCount,
    isSessionListEmpty: currentWorkspaceSessions.length === 0,
    serverUrl,
    token,
    noAuthToken: NO_AUTH_TOKEN,
    pairCode,
    extensionsLoading,
    visibleQuickSkillRefs,
    visibleQuickMcpRefs,
    onToggleWorkspaceSwitcher: toggleWorkspaceSwitcher,
    onNewSession: handleNewSession,
    onSelectProject: handleDrawerProjectSelect,
    onChangeSessionSearch,
    onSelectSession: handleDrawerSessionSelect,
    onShowMoreSessions: handleShowMoreSessions,
    onInsertQuickReference: insertQuickReference,
    onResetAuth,
  });

  const launchOverlay = (
    <MobileLaunchOverlay
      styles={styles}
      visible={launchOverlayVisible}
      opacity={launchOverlayOpacity}
      fontFamily={FONT_DISPLAY_SERIF}
    />
  );
  const chatScreen = (
    <ChatWorkspaceScreen
      styles={styles}
      windowWidth={windowWidth}
      inputDockHeight={inputDockHeight}
      notebookColors={notebookColors}
      notebookPanHandlers={notebookPanResponder.panHandlers}
      notebookTrackX={notebookTrackX}
      leftDrawer={leftDrawer}
      rightDrawer={rightDrawer}
      showNotebookSessionTitle={showNotebookSessionTitle}
      currentSessionTitle={currentSessionTitle}
      showStreamTopGlow={showStreamTopGlow}
      streamTopGlowAnim={streamTopGlowAnim}
      sessionSwitchingTo={sessionSwitchingTo}
      sessionSwitchingTitle={sessionSwitchingTitle}
      renderedTurnsLength={renderedTurns.length}
      currentWorkspaceName={currentWorkspaceName}
      chatListMountKey={chatListMountKey}
      messageScrollRef={messageScrollRef}
      messageBottomInset={messageBottomInset}
      displayedTurnCells={displayedTurnCells}
      getChatCellType={getChatCellType}
      initialChatScrollIndex={initialChatScrollIndex}
      initialChatScrollOffset={initialChatScrollOffset}
      chatStartsFromBottom={chatStartsFromBottom}
      chatViewabilityConfig={chatViewabilityConfig}
      onChatViewableItemsChanged={onChatViewableItemsChanged}
      canLoadEarlierHistory={canLoadEarlierHistory}
      loadingOlder={loadingOlder}
      onLoadOlderMessages={handleLoadOlderMessages}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollEndDrag}
      onMomentumScrollBegin={handleMomentumScrollBegin}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      onScroll={handleWorkspaceScroll}
      onContentSizeChange={handleWorkspaceContentSizeChange}
      onListLayout={handleWorkspaceListLayout}
      renderTurnCell={renderTurnCell}
      sessionId={sessionId}
      sessionHistoryRetryHintText={toText(
        sessionHistoryRetryHint[sessionId],
      ).trim()}
      historyProgressWidth={historyProgressWidth}
      showLatestJump={showLatestJump}
      onJumpToLatest={jumpToLatest}
      latestTodoCard={latestTodoCard}
      dismissedTodoCardId={dismissedTodoCardId}
      todoDockCollapsed={todoDockCollapsed}
      thinkingPulse={thinkingPulse}
      onToggleTodoDock={toggleTodoDock}
      onDismissTodoDock={dismissTodoDock}
      activeQuestionRequest={activeQuestionRequest}
      questionSubmitState={
        activeQuestionRequest
          ? questionSubmitState[activeQuestionRequest.id]?.status || "idle"
          : "idle"
      }
      questionSubmitError={
        activeQuestionRequest
          ? questionSubmitState[activeQuestionRequest.id]?.error
          : undefined
      }
      onReplyQuestion={handleQuestionReply}
      onDismissQuestion={handleQuestionDismiss}
      composerProps={composerProps}
      albumPickerProps={albumPickerProps}
      previewImage={previewImage}
      onClosePreviewImage={handleClosePreviewImage}
      composerPickerProps={composerPickerProps}
    />
  );

  return (
    <MobileAppRouter
      appReady={appReady}
      authed={authed}
      backgroundColor={notebookColors.shell}
      busy={busy}
      CameraViewCompat={CameraViewCompat}
      chatScreen={chatScreen}
      connectProgressScaleX={connectProgressScaleX}
      connectingDiscoverId={connectingDiscoverId}
      discoverDeviceRows={discoverDeviceRows}
      discoverOpen={discoverOpen}
      discoveringUi={discoveringUi}
      fontFamily={FONT_DISPLAY_SERIF}
      gestureRootStyle={styles.gestureRoot}
      launchOverlay={launchOverlay}
      lastScanAtLabel={lastScanAt ? formatClock(lastScanAt) : ""}
      onAuthSubmit={() => void onAuthSubmit()}
      onBarcodeScanned={onBarcodeScanned}
      onCancelScanner={onCloseScanner}
      onChangePairCode={setPairCode}
      onChangeServerUrl={onChangeServerUrl}
      onCloseDiscover={onCloseDiscover}
      onConnectDiscoverPress={onConnectDiscoverPress}
      onMountScannerError={onScannerMountError}
      onOpenDiscover={onOpenDiscover}
      onOpenScanner={onOpenScanner}
      onPairPromptCancel={cancelPairPrompt}
      onPairPromptChange={setPairPromptValue}
      onPairPromptConfirm={confirmPairPrompt}
      onPickQrFromAlbum={() => void onPickQrFromAlbum()}
      onRescanDiscover={() => void startDiscover()}
      onRescanScanner={onScannerRescan}
      onScannerReady={onScannerReady}
      onTogglePreferHttps={() => setPreferHttps((value) => !value)}
      pairCode={pairCode}
      pairPromptHostPort={pairPromptHostPort}
      pairPromptOpen={pairPromptOpen}
      pairPromptValue={pairPromptValue}
      preferHttps={preferHttps}
      safeStyle={[styles.chatSafe, { backgroundColor: notebookColors.shell }]}
      scanHitCount={scanHitCount}
      scannerLocked={scannerLocked}
      scannerOpen={scannerOpen}
      scannerReady={scannerReady}
      serverUrlInput={serverUrlInput}
      startupStyles={styles}
      statusText={statusText}
    />
  );
}

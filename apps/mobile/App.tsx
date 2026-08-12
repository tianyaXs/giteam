import { CameraView } from "expo-camera";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, useWindowDimensions } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NO_AUTH_TOKEN, cloudHeartbeat } from "./src/api/controlApi";
import { interactionToQuestionRequest } from "./src/api/agent/bridge";
import { createMobileAgentClient } from "./src/api/agent/client";
import { setCloudSessionInvalidationHandler } from "./src/api/agent/errors";
import type { AgentInteraction } from "./src/api/agent/types";
import { ChatWorkspaceScreen, type ChatWorkspaceScreenHandle } from "./src/components/chat/ChatWorkspaceScreen";
import { AlbumPickerOverlay } from "./src/components/chat/MediaOverlays";
import { MobileLaunchOverlay } from "./src/components/chat/MobileLaunchOverlay";
import { conversationHasAssistantAfterUser } from "./src/features/chat/assistantTurnState";
import {
  flattenTurnsForList,
  type DisplayedTurnCell,
} from "./src/features/chat/displayedCells";
import {
  CHAT_BOTTOM_PROXIMITY,
  CHAT_LIST_BOTTOM_AIR,
  COMPOSER_MODE_OPTIONS,
  INITIAL_CELL_LIMIT,
  INITIAL_MESSAGE_FETCH_LIMIT,
  INITIAL_SESSION_LIMIT,
  OLDER_MESSAGE_FETCH_LIMIT,
  OLDER_SESSION_LIMIT,
  stableSortSessionItems,
  streamDebug,
} from "./src/features/chat/mobileAppConfig";
import {
  assistantTextWeight,
  formatSessionTimestamp,
  isPlaceholderSessionTitle,
  losesLatestUserMessage,
  losesRenderedAssistant,
  pickSessionDisplayTitle,
  sharesSessionMessageContext,
  summarizePreview,
} from "./src/features/chat/sessionDisplay";
import { getActiveSessionSwitchTrace, markSessionSwitchPerf } from "./src/features/chat/sessionSwitchPerf";
import { useAuthedStartupEffects } from "./src/features/chat/useAuthedStartupEffects";
import { useBootstrapPersistence } from "./src/features/chat/useBootstrapPersistence";
import { useChatCellWindow } from "./src/features/chat/useChatCellWindow";
import { useChatListController } from "./src/features/chat/useChatListController";
import { useChatMotionState } from "./src/features/chat/useChatMotionState";
import { useChatScreenDerivedState } from "./src/features/chat/useChatScreenDerivedState";
import { useChatUiActions } from "./src/features/chat/useChatUiActions";
import { useChatWorkspaceEvents } from "./src/features/chat/useChatWorkspaceEvents";
import { useChatWorkspacePanelProps } from "./src/features/chat/useChatWorkspacePanelProps";
import { useComposerPresentationState } from "./src/features/chat/useComposerPresentationState";
import { useConnectionLogger } from "./src/features/chat/useConnectionLogger";
import { useMobileThinkingLevel } from "./src/features/chat/useMobileThinkingLevel";
import { useDisplayedTurnsWithThinking } from "./src/features/chat/useDisplayedTurnsWithThinking";
import { useDrawerPulseState } from "./src/features/chat/useDrawerPulseState";
import { useGlobalErrorLogger } from "./src/features/chat/useGlobalErrorLogger";
import { useInteractiveTurnCells } from "./src/features/chat/useInteractiveTurnCells";
import { useLeftDrawerController } from "./src/features/chat/useLeftDrawerController";
import { useMobileAppRefs } from "./src/features/chat/useMobileAppRefs";
import { useMobileAppServices } from "./src/features/chat/useMobileAppServices";
import { useMobileAppState } from "./src/features/chat/useMobileAppState";
import { useMobileConnectionFlow } from "./src/features/chat/useMobileConnectionFlow";
import { useMobileShellLifecycle } from "./src/features/chat/useMobileShellLifecycle";
import { useNotebookColors } from "./src/features/chat/useNotebookColors";
import { useNotebookDrawerRenderers } from "./src/features/chat/useNotebookDrawerRenderers";
import { useProjectSwitchAction } from "./src/features/chat/useProjectSwitchAction";
import { useRightDrawerController } from "./src/features/chat/useRightDrawerController";
import { useSessionHeaderState } from "./src/features/chat/useSessionHeaderState";
import { useSessionLifecycleActions } from "./src/features/chat/useSessionLifecycleActions";
import { useSessionRecovery } from "./src/features/chat/useSessionRecovery";
import { useSessionSwitchController } from "./src/features/chat/useSessionSwitchController";
import { useSyncedLatestRefs } from "./src/features/chat/useSyncedLatestRefs";
import { useTodoDockController } from "./src/features/chat/useTodoDockController";
import { useTurnCellRenderer } from "./src/features/chat/useTurnCellRenderer";
import { useAttachmentProcessor } from "./src/features/media/useAttachmentProcessor";
import { useComposerUiController } from "./src/features/media/useComposerUiController";
import { useSlashCommandCatalog } from "./src/features/media/useSlashCommandCatalog";
import {
  getActiveMessageSendTrace,
  markMessageSendAssistantVisible,
  markMessageSendListCellsVisible,
  markMessageSendUserVisible,
} from "./src/features/messages/messageSendPerf";
import { buildLiveTodoCard } from "./src/features/messages/todoCards";
import { useOptimisticUserMessages } from "./src/features/messages/useOptimisticUserMessages";
import { usePromptActions } from "./src/features/messages/usePromptActions";
import { useSessionMessageSync } from "./src/features/messages/useSessionMessageSync";
import { useTurnWindowController } from "./src/features/messages/useTurnWindowController";
import { useQuestionController } from "./src/features/questions/useQuestionController";
import { useAgentStreamRuntime } from "./src/features/stream/useAgentStreamRuntime";
import { useAgentStreamManager } from "./src/features/stream/useAgentStreamManager";
import {
  projectNameFromPath,
  sanitizeProjectOptions,
  stripUrlScheme,
  toProjectOptionsFromPaths,
} from "./src/features/workspace/catalogUtils";
import {
  removeStreamQuestion,
  upsertStreamQuestion,
} from "./src/features/messages/agentStreamStore";
import { useWorkspaceCatalogController } from "./src/features/workspace/useWorkspaceCatalogController";
import { toText } from "./src/lib/text";
import { formatClock } from "./src/lib/time";
import { MobileAppRouter } from "./src/screens/MobileAppRouter";
import { styles } from "./src/styles/mobileAppStyles";
import { FONT_DISPLAY_SERIF, FONT_MIXED_BODY_REGULAR } from "./src/styles/mobileFonts";

// keys + storage moved to src/storage/*

const CameraViewCompat: any = CameraView;

// DEFAULT_PREFS moved to src/storage/prefs

// prefs + discover cache moved to src/storage/*

export default function App() {
  // paper 主题字体已移除，统一系统字体，无需异步加载。
  const fontsLoaded = true;
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
    connectionMode,
    setConnectionMode,
    accessKey,
    setAccessKey,
    deviceId,
    setDeviceId,
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
    modelCatalogStatus,
    setModelCatalogStatus,
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
    inputDockHeight,
    setInputDockHeight,
    streamTodoCard,
    setStreamTodoCard,
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
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    streamRunIdRef,
    streamRenderTimerRef,
    sessionActiveRunIdRef,
    sessionStatusEpochRef,
    busySinceRef,
    appStateRef,
    pairCodeMapRef,
    closeDiscoverRef,
    discoveredPairRequiredRef,
    sessionMessageSyncRef,
    applyTurnWindowRef,
    sessionRecoveryRef,
    getAgentStreamStores,
    applyTurnWindow,
  } = useMobileAppRefs();
  const openAlbumPickerForQrScanRef = React.useRef<(() => Promise<void>) | undefined>(undefined);
  const scanQrFromImageUriRef = React.useRef<((uri: string) => Promise<void>) | undefined>(undefined);
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
  const messageBottomInset = Math.max(CHAT_LIST_BOTTOM_AIR, Math.round(inputDockHeight + 16));

  const {
    showLatestJump,
    suppressFloatingDocks,
    messageScrollRef,
    forceScrollToLatestUntilRef,
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
    guardHistoryLoad,
    anchorSessionToLatest,
    markFollowLatest,
    pauseFollowLatest,
    isViewportNearLatest,
    restoreSessionViewport,
    followLatest,
    listRevealReady,
    shouldSuppressLoadOlder,
    suppressLoadOlderUntilRef,
  } = useChatListController<DisplayedTurnCell>({
    initialCellLimit: INITIAL_CELL_LIMIT,
    chatBottomProximity: CHAT_BOTTOM_PROXIMITY,
    bottomContentInset: messageBottomInset,
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
    replaceStreamRows,
    publishStreamRows,
    recordStreamMessageRoles,
    renderStreamWindow,
    scheduleStreamRender,
    resetAgentStreamStores,
  } = useAgentStreamRuntime({
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    sessionIdRef,
    streamRenderTimerRef,
    messageContentHRef,
    messageViewportHRef,
    messageScrollYRef,
    messageUserScrollingRef,
    forceScrollToLatestUntilRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    getAgentStreamStores,
    applyTurnWindow,
    scrollToLatest,
    streamDebug,
    setStreaming,
  });
  const {
    activeQuestionRequest,
    dismissedQuestions,
    expandedTimelineQuestions,
    handleQuestionDismiss,
    handleQuestionReply,
    handleTimelineQuestionToggle,
    handleTimelineTabChange,
    questionRequests,
    questionSubmitState,
    refreshQuestionRequestsFromStore,
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
    getAgentStreamStores,
    pushConnLog,
    setStatus,
    startStream,
    syncSessionMessages,
    syncSessionStatus,
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
  });

  const handleAgentInteractionRequested = useCallback(
    (interaction: AgentInteraction) => {
      if (interaction.kind === "question") {
        const request = interactionToQuestionRequest(interaction);
        if (request && !dismissedQuestions.has(request.id)) {
          upsertStreamQuestion(getAgentStreamStores(), request);
          refreshQuestionRequestsFromStore(interaction.sessionId);
        }
        return;
      }
      // permission：手机端沿用自动接受策略（服务端 autoApprove），这里仅记录日志。
      pushConnLog(
        `interaction.permission tool=${interaction.tool} risk=${interaction.risk}`,
      );
    },
    [
      dismissedQuestions,
      getAgentStreamStores,
      pushConnLog,
      refreshQuestionRequestsFromStore,
    ],
  );

  const handleAgentInteractionResolved = useCallback(
    (interactionId: string) => {
      const sid = sessionIdRef.current;
      if (sid) removeStreamQuestion(getAgentStreamStores(), sid, interactionId);
      setQuestionRequests((prev) =>
        prev.filter((row) => row.id !== interactionId),
      );
    },
    [getAgentStreamStores, sessionIdRef, setQuestionRequests],
  );

  const { startStream: startStreamManager, stopStream: stopStreamManager } =
    useAgentStreamManager({
      authed,
      serverUrl,
      token,
      pairCode,
      sessionIdRef,
      streamRef,
      streamRunIdRef,
      streamSessionRef,
      sessionActiveRunIdRef,
      sessionStatusEpochRef,
      streamRenderTimerRef,
      sessionVisibleTurnCountRef,
      sessionTotalTurnCountRef,
      getAgentStreamStores,
      pushConnLog,
      streamDebug,
      setStreaming,
      setStatus,
      setToken,
      setSessionStatusMap,
      setStreamTodoCard,
      applyTurnWindow,
      syncSessionMessages,
      syncSessionStatus,
      buildLiveTodoCard,
      onInteractionRequested: handleAgentInteractionRequested,
      onInteractionResolved: handleAgentInteractionResolved,
      renderStreamWindow,
      scheduleStreamRender,
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
  const previousKeyboardInsetRef = React.useRef(0);
  useEffect(() => {
    const previousInset = previousKeyboardInsetRef.current;
    previousKeyboardInsetRef.current = keyboardInset;
    if (previousInset === keyboardInset) return;
    if (!listRevealReady) return;
    if (!sessionId && keyboardInset <= 0) return;
    if (messageUserScrollingRef.current) return;
    if (!followLatest && !isViewportNearLatest()) return;
    markFollowLatest(320);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToLatest(true);
      });
    });
  }, [
    followLatest,
    isViewportNearLatest,
    keyboardInset,
    listRevealReady,
    markFollowLatest,
    messageUserScrollingRef,
    scrollToLatest,
    sessionId,
  ]);
  useGlobalErrorLogger({ pushConnLog });

  useEffect(() => {
    setStreamTodoCard(null);
  }, [sessionId]);

  const statusText = toText(status);
  const notebookColors = useNotebookColors();
  const {
    scannerOpen,
    scannerLocked,
    scannerReady,
    scanHitCount,
    lastScanAt,
    onAuthSubmit,
    onSelectCloudDevice,
    devicePickerOpen,
    pendingDevices,
    setDevicePickerOpen,
    onOpenScanner,
    onPickQrFromAlbum,
    scanQrFromImageUri,
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
    connectionMode,
    accessKey,
    deviceId,
    pairCodeMapRef,
    closeDiscoverRef,
    discoveredPairRequiredRef,
    openAlbumPickerForQrScanRef,
    setBusy,
    setStatus,
    setServerUrl,
    setServerUrlInput,
    setServerUrlTouched,
    setPreferHttps,
    setPairCode,
    setConnectionMode,
    setAccessKey,
    setDeviceId,
    setToken,
    setRepoPath,
    setProjects,
    pushConnLog,
    refreshProjectsCatalog,
    toProjectOptionsFromPaths,
  });

  React.useEffect(() => {
    scanQrFromImageUriRef.current = scanQrFromImageUri;
  }, [scanQrFromImageUri]);

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
    pendingPromptSessionRef,
    sentAttachmentCacheRef,
    forceScrollToLatestUntilRef,
    markFollowLatest,
    sessionVisibleTurnCountRef,
    messagesRef,
    renderedTurnsRef,
    applyTurnWindowRef,
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
    losesLatestUserMessage,
    losesRenderedAssistant,
    sharesSessionMessageContext,
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
    refreshModelCatalog,
    refreshProjectsCatalog,
    refreshSessionsFromServer,
    repoPath,
    serverUrl,
    sessionId,
    sessionIdRef,
    sessionRawMapRef,
    guardHistoryLoad,
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
    setModelCatalogStatus,
    setModel,
    setInstalledSkills,
    setExtensionsLoading,
    setStatus,
    pushConnLog,
    triggerLeftPulse,
    triggerRightPulse,
    stableSortSessionItems,
    isPlaceholderSessionTitle,
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
    localSending,
    sessionWorking,
  } = useChatScreenDerivedState({
    sessionId,
    streaming,
    optimisticVersion,
    messages,
    renderedTurns,
    sessionStatusMap,
    sessionOptimisticUserMapRef,
  });

  useEffect(() => {
    const sid = toText(sessionId).trim();
    if (!sid || streaming || localSending) return;
    if (!conversationHasAssistantAfterUser(renderedTurns, messages)) return;
    if (sessionStatusMap[sid]?.type !== "busy") return;
    setSessionStatusMap((prev) => ({ ...prev, [sid]: { type: "idle" } }));
  }, [localSending, messages, renderedTurns, sessionId, sessionStatusMap, streaming, setSessionStatusMap]);

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
    actionIconAnim,
    attachmentToggleAnim,
    attachmentPanelStyle,
    recentScrollerHeight,
    canSendNow,
    canAbortNow,
    handlePromptChange,
    clearPromptAfterSend,
    handleSlashSelect,
    handleToggleAttachmentMenu,
    handleDismissAttachmentPanel,
    maybeLoadMoreRecentImages,
  } = useComposerUiController({
    windowWidth,
    sessionWorking,
    imageAttachments,
    slashCommands,
    setStatus,
  });

  const {
    albumPickerOpen,
    albumPickerPurpose,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    mediaAlbums,
    selectedMediaAlbumId,
    albumSelectedIds,
    albumSelectedSet,
    closeAlbumPicker,
    openAlbumPicker,
    openAlbumPickerForQrScan,
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
    onQrScanFromAlbum: async (uri) => {
      await scanQrFromImageUriRef.current?.(uri);
    },
  });

  React.useEffect(() => {
    openAlbumPickerForQrScanRef.current = openAlbumPickerForQrScan;
  }, [openAlbumPickerForQrScan]);

  const chatWorkspaceRef = useRef<ChatWorkspaceScreenHandle>(null);
  const [settingsTab, setSettingsTab] = useState<'general' | 'models'>('general');
  const closeDrawer = useCallback(() => {
    chatWorkspaceRef.current?.closeDrawer();
  }, []);
  const openSettingsDrawer = useCallback((tab: 'general' | 'models' = 'general') => {
    setSettingsTab(tab);
    chatWorkspaceRef.current?.openSettings();
  }, []);
  const closeSettings = useCallback(() => {
    chatWorkspaceRef.current?.closeSettings();
  }, []);
  const openDrawerFromSettings = useCallback(() => {
    chatWorkspaceRef.current?.openDrawer('left');
  }, []);
  const handleToggleAutoAccept = useCallback(() => {
    setAutoAcceptPermissions((value) => !value);
  }, [setAutoAcceptPermissions]);
  const handleBeforeOpenNotebookDrawer = useCallback(() => {
    // 浮层自管 open/close：其全屏 overlay 拦截点击，开启时无法触发抽屉按钮。
  }, []);
  const leftDrawerRefreshAtRef = useRef(0);
  const handleLeftNotebookDrawerOpen = useCallback(() => {
    void InteractionManager.runAfterInteractions(() => {
      const now = Date.now();
      // 允许后台刷新，但短间隔内跳过，避免打开抽屉时整表闪一下
      if (now - leftDrawerRefreshAtRef.current < 8_000) return;
      leftDrawerRefreshAtRef.current = now;
      void refreshProjectsCatalog();
      void refreshSessionsFromServer();
    });
  }, [refreshProjectsCatalog, refreshSessionsFromServer]);
  const handleRightNotebookDrawerOpen = useCallback(() => {
    void InteractionManager.runAfterInteractions(() => {
      void refreshInstalledExtensions();
    });
  }, [refreshInstalledExtensions]);
  const handleNotebookDrawerCloseSettled = useCallback(() => {
    // no-op：项目树展开态由左抽屉 controller 自管
  }, []);

  const { displayedTurns, showThinkingPlaceholder, exploringState } = useDisplayedTurnsWithThinking({
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    sessionId,
    getAgentStreamStores,
    streamDebug,
  });

  // 构建探索中状态文本和actions
  const exploringStatus = useMemo(() => {
    if (!showThinkingPlaceholder) return undefined;

    const { currentActions, completedCounts } = exploringState;

    if (currentActions.length > 0) {
      const activeAction = currentActions[0];
      return {
        title: '探索中',
        summary: completedCounts.total > 0
          ? [
            completedCounts.read > 0 ? `${completedCounts.read} 次读取` : '',
            completedCounts.search > 0 ? `${completedCounts.search} 次搜索` : '',
            completedCounts.list > 0 ? `${completedCounts.list} 次列出` : '',
          ].filter(Boolean).join('，')
          : '正在收集上下文',
        detail: activeAction?.detail && activeAction.detail !== activeAction.tool ? activeAction.detail : undefined
      };
    }

    const completedTexts: string[] = [];
    if (completedCounts.read > 0) completedTexts.push(`${completedCounts.read} 次读取`);
    if (completedCounts.search > 0) completedTexts.push(`${completedCounts.search} 次搜索`);
    if (completedCounts.list > 0) completedTexts.push(`${completedCounts.list} 次列出`);

    if (completedTexts.length > 0) {
      return {
        title: '已探索',
        summary: completedTexts.join('，'),
        detail: undefined
      };
    }

    return {
      title: '探索中',
      summary: '正在收集上下文',
      detail: undefined
    };
  }, [showThinkingPlaceholder, exploringState]);

  // 构建探索actions用于展开显示
  const exploringActions = useMemo(() => {
    if (!showThinkingPlaceholder) return undefined;
    return {
      current: exploringState.currentActions,
      completed: exploringState.recentActions.filter(a => a.status === 'completed')
    };
  }, [showThinkingPlaceholder, exploringState]);
  const allDisplayedTurnCells = useMemo(
    () => flattenTurnsForList(displayedTurns),
    [displayedTurns],
  );
  const {
    displayedTurnCells,
    displayedTurnCellsRef,
    visibleCellCountRef,
    historyProgressWidth,
    chatListMountKey,
  } = useChatCellWindow<DisplayedTurnCell>({
    allDisplayedTurnCells,
    sessionId,
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
      sessionNextCursor,
      rememberCurrentSessionViewport,
      resetListInteractionState,
      guardHistoryLoad,
      resetSessionInteractionState,
      sessionTotalTurnCountRef,
      applyTurnWindow,
      setSessionId,
      setQuestionRequests,
      setQuestionSubmitState,
      setMessages,
      setRenderedTurns,
      setSessionStatusMap,
    });
  useEffect(() => {
    const trace = getActiveSessionSwitchTrace();
    if (!trace || trace.finished || trace.targetSid !== sessionId) return;
    if (sessionSwitchingTo) return;
    if (renderedTurns.length === 0) return;
    markSessionSwitchPerf(trace, "ui.content_visible", {
      turns: renderedTurns.length,
      cells: displayedTurnCells.length,
    });
  }, [sessionId, sessionSwitchingTo, renderedTurns.length, displayedTurnCells.length]);
  useEffect(() => {
    const trace = getActiveMessageSendTrace();
    if (!trace || trace.finished || trace.targetSid !== sessionId) return;
    const hasUserTurn = renderedTurns.some(
      (turn) => turn.userMessage?.id === trace.optimisticId,
    );
    if (hasUserTurn) {
      markMessageSendUserVisible(trace, { turns: renderedTurns.length });
    }
    const userCellVisible = displayedTurnCells.some(
      (cell) => cell.userMessage?.id === trace.optimisticId,
    );
    if (userCellVisible) {
      markMessageSendListCellsVisible(trace, {
        cells: displayedTurnCells.length,
      });
    }
    const lastTurn = renderedTurns[renderedTurns.length - 1];
    const hasAssistantText = !!lastTurn?.items?.some(
      (item) =>
        item.kind === "chat" &&
        item.message.role === "assistant" &&
        toText(item.message.text).trim().length > 0,
    );
    if (hasAssistantText) {
      markMessageSendAssistantVisible(trace, {
        turnId: lastTurn?.id,
        cells: displayedTurnCells.length,
      });
    }
  }, [sessionId, renderedTurns, displayedTurnCells]);
  useBootstrapPersistence({
    loaded,
    serverUrl,
    serverUrlTouched,
    preferHttps,
    pairCode,
    connectionMode,
    accessKey,
    deviceId,
    repoPath,
    projects,
    token,
    sessionId,
    model,
    composerAgent,
    autoAcceptPermissions,
    setLoaded,
    setStatus,
    setServerUrl,
    setServerUrlInput,
    setServerUrlTouched,
    setPreferHttps,
    setPairCode,
    setConnectionMode,
    setAccessKey,
    setDeviceId,
    setRepoPath,
    setProjects,
    setToken,
    setSessionId,
    setComposerAgent,
    setAutoAcceptPermissions,
    setMessages,
    setRenderedTurns,
    setStartupSessionHydrating,
    setModel,
    setSessionSwitchingTo,
    sessionIdRef,
    pairCodeMapRef,
    sessionCacheRef,
    sessionRawMapRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
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
    replaceStreamRows,
    recordStreamMessageRoles,
    applyTurnWindow,
    syncSessionStatus,
    rememberCurrentSessionViewport,
    guardHistoryLoad,
    pauseFollowLatest,
    isViewportNearLatest,
    restoreSessionViewport,
    suppressLoadOlderUntilRef,
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
    resetAgentStreamStores,
    bumpOptimisticVersion,
    setActiveSession,
    setToken,
    setPairCode,
    setDeviceId,
    setRepoPath,
    setProjects,
    setMessages,
    setRenderedTurns,
    setSessionNextCursor,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setStartupSessionHydrating,
    setModelCatalogStatus,
    setModelOptions,
    setStatus,
    pushConnLog,
  });

  useEffect(() => {
    setCloudSessionInvalidationHandler((reason) => {
      pushConnLog(`cloud session invalidated → login: ${reason}`, "error");
      onResetAuth(reason);
    });
    return () => setCloudSessionInvalidationHandler(null);
  }, [onResetAuth, pushConnLog]);

  useEffect(() => {
    if (!authed || connectionMode !== "cloud") return;
    const base = String(serverUrl || "").trim();
    const tk = String(token || "").trim();
    if (!base || !tk || tk === NO_AUTH_TOKEN) return;
    let cancelled = false;
    const beat = () => {
      if (cancelled) return;
      void cloudHeartbeat({ cloudBaseUrl: base, token: tk }).catch((e) => {
        pushConnLog(`cloud heartbeat warn ${String(e)}`, "info");
      });
    };
    beat();
    const timer = setInterval(beat, 25000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authed, connectionMode, serverUrl, token, pushConnLog]);

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
    resetAgentStreamStores,
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
    projectTrees,
    searchSessionRows,
    isSessionListEmpty,
    handlePressProject,
    handleDrawerSessionSelect,
    handleNewSession,
    handleShowMoreSessions,
    onChangeSessionSearch,
  } = useLeftDrawerController({
    projects,
    projectsRefCurrent: projectsRef.current,
    repoPath,
    sessions,
    sessionCacheRef,
    sessionSearch,
    sessionStatusMap,
    sessionId,
    messages,
    sessionRawMapRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    sessionIdRef,
    pickSessionDisplayTitle,
    projectNameFromPath,
    sanitizeProjectOptions,
    formatSessionTimestamp,
    stopStream,
    closeDrawer,
    setMessages,
    setRenderedTurns,
    setSessionNextCursor,
    setSessionHasMore,
    setSessionSearch,
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
    pushConnLog,
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
    initialSessionLimit: INITIAL_SESSION_LIMIT,
    initialMessageFetchLimit: INITIAL_MESSAGE_FETCH_LIMIT,
    sessionIdRef,
    sessionActiveRunIdRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    pendingPromptSessionRef,
    sentAttachmentCacheRef,
    setStatus,
    setBusy,
    setToken,
    setPrompt,
    clearPromptAfterSend,
    setSlashOpen,
    setImageAttachments,
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
  const { composerModeOptions, inputModelLabel } = useComposerPresentationState(
    {
      model,
      modelOptions,
      modeOptions: COMPOSER_MODE_OPTIONS,
    },
  );
  const { thinkingLevel, setThinkingLevel } = useMobileThinkingLevel({
    sessionId,
    serverUrl,
    token,
  });
  // 切模型时同步到服务端已有会话（agentClient.setModel 全工程首次接线）。
  // ref="provider/modelId" → setModel(sessionId, provider, modelId)。
  const handlePersistSessionModel = useCallback(async (sid: string, modelRef: string) => {
    const slash = modelRef.indexOf("/");
    if (slash <= 0 || !serverUrl) return;
    try {
      await createMobileAgentClient({ baseUrl: serverUrl, token })
        .setModel(sid, modelRef.slice(0, slash), modelRef.slice(slash + 1));
    } catch {
      // 静默：本地已切换，服务端同步失败不阻塞 UI
    }
  }, [serverUrl, token]);
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
    sessionId,
    onPersistSessionModel: handlePersistSessionModel,
    inputDockHeight,
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
    newestFirst: false,
    timelineQuestionTabs,
  });
  const { renderTurnCell } = useTurnCellRenderer({
    activeQuestionsForTurn,
    bodyFontFamily: FONT_MIXED_BODY_REGULAR,
    chatCellHeightMapRef,
    exploringStatus,
    exploringActions,
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
    thinkingPulse
  });
  const {
    handleWorkspaceContentSizeChange,
    handleWorkspaceListLayout,
    handleWorkspaceScroll,
  } = useChatWorkspaceEvents({
    handleContentSizeChange,
    handleListLayout,
    loadingOlder,
    onMessageListScroll,
  });
  // 模型开关已并入设置「模型」Tab；选择器「管理模型开关」跳转到该 Tab。
  const {
    albumPickerProps,
    composerProps,
    handleClosePreviewImage,
  } = useChatWorkspacePanelProps({
    onOpenModelManager: () => {
      openSettingsDrawer('models');
    },
    hasConversationContent: messages.length > 0 || renderedTurns.length > 0,
    sessionId,
    actionIconAnim,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    albumPickerOpen,
    albumPickerPurpose,
    albumSelectedIds,
    albumSelectedSet,
    attachRecentImage,
    attachmentMenuOpen,
    attachmentPanelStyle,
    attachmentPanelVisible,
    attachmentToggleAnim,
    canAbortNow,
    canSendNow,
    closeAlbumPicker,
    composerAgent,
    composerModeOptions,
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
    prompt,
    recentImages,
    recentImagesHasNext,
    recentImagesLoading,
    recentImagesLoadingMore,
    recentScrollerHeight,
    selectedMediaAlbumId,
    selectMediaAlbum,
    setPreviewImage,
    slashActiveIndex,
    slashOpen,
    slashSuggestions,
    styles,
    thinkingLevel,
    onThinkingLevelChange: setThinkingLevel,
    toggleAlbumImage,
  });
  const { leftDrawer, rightDrawer: settingsContent } = useNotebookDrawerRenderers({
    currentWorkspaceName,
    sessionSearch,
    projectTrees,
    searchSessionRows,
    isSessionListEmpty,
    serverUrl,
    token,
    settingsTab,
    onPressProject: handlePressProject,
    onNewSession: () => {
      closeSettings();
      handleNewSession();
    },
    onChangeSessionSearch,
    onSelectSession: (sessionId, worktree, active) => {
      closeSettings();
      handleDrawerSessionSelect(sessionId, worktree, active);
    },
    onShowMoreSessions: handleShowMoreSessions,
    onOpenSettings: () => openSettingsDrawer('general'),
    onCloseSettings: closeSettings,
    onOpenDrawerFromSettings: openDrawerFromSettings,
    onResetAuth,
    autoAcceptPermissions,
    onToggleAutoAccept: handleToggleAutoAccept,
    onModelsChanged: refreshModelCatalog,
  });

  const launchOverlay = (
    <MobileLaunchOverlay
      styles={styles}
      visible={launchOverlayVisible}
      opacity={launchOverlayOpacity}
      fontsReady={fontsLoaded}
      fontFamily={FONT_DISPLAY_SERIF}
    />
  );
  const chatScreen = (
    <ChatWorkspaceScreen
      ref={chatWorkspaceRef}
      styles={styles}
      windowWidth={windowWidth}
      inputDockHeight={inputDockHeight}
      notebookColors={notebookColors}
      onBeforeOpenDrawer={handleBeforeOpenNotebookDrawer}
      onOpenLeftDrawer={handleLeftNotebookDrawerOpen}
      onOpenRightDrawer={handleRightNotebookDrawerOpen}
      onDrawerCloseSettled={handleNotebookDrawerCloseSettled}
      onNewSession={() => {
        closeSettings();
        handleNewSession();
      }}
      leftDrawer={leftDrawer}
      settingsContent={settingsContent}
      showNotebookSessionTitle={showNotebookSessionTitle}
      currentSessionTitle={currentSessionTitle}
      showStreamTopGlow={showStreamTopGlow}
      streamTopGlowAnim={streamTopGlowAnim}
      renderedTurnsLength={renderedTurns.length}
      currentWorkspaceName={currentWorkspaceName}
      chatListMountKey={chatListMountKey}
      messageScrollRef={messageScrollRef}
      messageBottomInset={messageBottomInset}
      displayedTurnCells={displayedTurnCells}
      chatViewabilityConfig={chatViewabilityConfig}
      onChatViewableItemsChanged={onChatViewableItemsChanged}
      loadingOlder={loadingOlder}
      shouldSuppressLoadOlder={shouldSuppressLoadOlder}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollEndDrag}
      onMomentumScrollBegin={handleMomentumScrollBegin}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      onScroll={handleWorkspaceScroll}
      onContentSizeChange={handleWorkspaceContentSizeChange}
      onListLayout={handleWorkspaceListLayout}
      anchorSessionToLatest={anchorSessionToLatest}
      onLoadOlderMessages={onLoadOlderMessages}
      renderTurnCell={renderTurnCell}
      sessionId={sessionId}
      sessionHistoryRetryHintText={toText(
        sessionHistoryRetryHint[sessionId],
      ).trim()}
      historyProgressWidth={historyProgressWidth}
      listRevealReady={listRevealReady}
      showLatestJump={showLatestJump}
      onJumpToLatest={jumpToLatest}
      suppressFloatingDocks={suppressFloatingDocks || loadingOlder}
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
      modelCatalogStatus={modelCatalogStatus}
      previewImage={previewImage}
      onClosePreviewImage={handleClosePreviewImage}
    />
  );

  const albumPickerOverlay = albumPickerOpen ? (
    <AlbumPickerOverlay {...albumPickerProps} />
  ) : null;

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <MobileAppRouter
            albumPickerOverlay={albumPickerOverlay}
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
            fontsReady={fontsLoaded}
            fontFamily={FONT_DISPLAY_SERIF}
            gestureRootStyle={styles.gestureRoot}
            launchOverlay={launchOverlay}
            lastScanAtLabel={lastScanAt ? formatClock(lastScanAt) : ""}
            onAuthSubmit={() => void onAuthSubmit()}
            onBarcodeScanned={onBarcodeScanned}
            onCancelScanner={onCloseScanner}
            connectionMode={connectionMode}
            accessKey={accessKey}
            devicePickerOpen={devicePickerOpen}
            pendingDevices={pendingDevices}
            onChangeConnectionMode={setConnectionMode}
            onChangeAccessKey={setAccessKey}
            onChangePairCode={setPairCode}
            onChangeServerUrl={onChangeServerUrl}
            onCloseDiscover={onCloseDiscover}
            onConnectDiscoverPress={onConnectDiscoverPress}
            onMountScannerError={onScannerMountError}
            onOpenScanner={onOpenScanner}
            onPairPromptCancel={cancelPairPrompt}
            onPairPromptChange={setPairPromptValue}
            onPairPromptConfirm={confirmPairPrompt}
            onPickQrFromAlbum={() => void onPickQrFromAlbum()}
            onRescanDiscover={() => void startDiscover()}
            onRescanScanner={onScannerRescan}
            onResetAuthStatus={() => setStatus("准备就绪")}
            onScannerReady={onScannerReady}
            onSelectCloudDevice={(id) => void onSelectCloudDevice(id)}
            onCloseDevicePicker={() => setDevicePickerOpen(false)}
            pairCode={pairCode}
            pairPromptHostPort={pairPromptHostPort}
            pairPromptOpen={pairPromptOpen}
            pairPromptValue={pairPromptValue}
            safeStyle={[styles.chatSafe, { backgroundColor: notebookColors.shell }]}
            scanHitCount={scanHitCount}
            scannerLocked={scannerLocked}
            scannerOpen={scannerOpen}
            scannerReady={scannerReady}
            serverUrlInput={serverUrlInput}
            startupStyles={styles}
            statusText={statusText}
          />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

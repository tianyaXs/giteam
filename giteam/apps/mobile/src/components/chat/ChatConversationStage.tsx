import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlashList } from '@shopify/flash-list';
import { Animated, Pressable, Text, View } from 'react-native';
import { getDisplayedCellItemType } from '../../features/chat/displayedCells';
import type { ChatMaintainVisibleContentPosition } from '../../features/chat/useChatListController';
import { getActiveSessionSwitchTrace, markSessionSwitchPerf } from '../../features/chat/sessionSwitchPerf';
import { getActiveMessageSendTrace, markMessageSendPerf } from '../../features/messages/messageSendPerf';

type NotebookColors = {
  text: string;
  muted: string;
  faint: string;
  line: string;
  paper: string;
};

function ChatConversationStageImpl(props: {
  styles: Record<string, any>;
  windowWidth: number;
  inputDockHeight: number;
  notebookColors: NotebookColors;
  showStreamTopGlow: boolean;
  streamTopGlowAnim: Animated.Value;
  renderedTurnsLength: number;
  currentWorkspaceName: string;
  messageScrollRef: React.RefObject<any>;
  messageBottomInset: number;
  displayedTurnCells: any[];
  chatViewabilityConfig: any;
  onChatViewableItemsChanged: (info: any) => void;
  loadingOlder: boolean;
  shouldSuppressLoadOlder: () => boolean;
  maintainVisibleContentPosition: ChatMaintainVisibleContentPosition;
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
}) {
  const {
    chatViewabilityConfig,
    currentWorkspaceName,
    displayedTurnCells,
    historyProgressWidth,
    inputDockHeight,
    listRevealReady,
    loadingOlder,
    maintainVisibleContentPosition,
    messageBottomInset,
    messageScrollRef,
    notebookColors,
    onChatViewableItemsChanged,
    onContentSizeChange,
    onJumpToLatest,
    onListLayout,
    anchorSessionToLatest,
    onLoadOlderMessages,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    renderTurnCell,
    renderedTurnsLength,
    sessionHistoryRetryHintText,
    sessionId,
    shouldSuppressLoadOlder,
    showLatestJump,
    styles,
    windowWidth
  } = props;
  const chatContentContainerStyle = useMemo(
    () => ({
      paddingTop: 12,
      paddingBottom: messageBottomInset + 20,
      backgroundColor: 'transparent'
    }),
    [messageBottomInset]
  );
  const keyExtractor = useCallback((item: any) => `${sessionId || 'draft'}:${item.id}`, [sessionId]);
  const listExtraData = useMemo(
    () => `${sessionId}:${displayedTurnCells.length}`,
    [displayedTurnCells.length, sessionId]
  );
  const getItemType = useCallback((item: any) => getDisplayedCellItemType(item), []);
  const initialScrollIndex = displayedTurnCells.length > 0 ? displayedTurnCells.length - 1 : undefined;
  const hasActiveSession = Boolean(sessionId);
  const showEmptyDraft = !hasActiveSession && renderedTurnsLength === 0;
  const showConversationList = hasActiveSession || renderedTurnsLength > 0;
  const workspaceTitle = useMemo(() => {
    const name = currentWorkspaceName.trim();
    return name || "this workspace";
  }, [currentWorkspaceName]);
  const latestSettledSessionRef = useRef('');
  useEffect(() => {
    if (latestSettledSessionRef.current === sessionId) return;
    latestSettledSessionRef.current = sessionId;
    const switchPerf = getActiveSessionSwitchTrace();
    const sendPerf = getActiveMessageSendTrace();
    if (switchPerf && switchPerf.targetSid === sessionId) {
      markSessionSwitchPerf(switchPerf, 'ui.session_effect', { turns: renderedTurnsLength });
    }
    if (sendPerf && sendPerf.targetSid === sessionId) {
      markMessageSendPerf(sendPerf, 'ui.session_effect', { turns: renderedTurnsLength });
    }
  }, [renderedTurnsLength, sessionId]);

  const handleStartReached = useCallback(() => {
    if (loadingOlder || !sessionId) return;
    if (shouldSuppressLoadOlder()) return;
    void onLoadOlderMessages();
  }, [loadingOlder, onLoadOlderMessages, sessionId, shouldSuppressLoadOlder]);

  useEffect(() => {
    console.log(`[DEBUG] ChatConversationStage effect: sessionId=${sessionId} cells=${displayedTurnCells.length} loadingOlder=${loadingOlder}`);
    if (loadingOlder || !sessionId || displayedTurnCells.length <= 0) return;
    console.log(`[DEBUG] Calling anchorSessionToLatest for ${sessionId} with ${displayedTurnCells.length} cells`);
    return anchorSessionToLatest(sessionId, displayedTurnCells.length);
  }, [anchorSessionToLatest, displayedTurnCells.length, loadingOlder, sessionId]);

  return (
    <View style={styles.chatBodyWrap}>
      {showEmptyDraft ? (
        <View style={[styles.blankWrap, { paddingBottom: Math.max(84, inputDockHeight * 0.72) }]}>
          <View style={[styles.blankHero, { width: Math.min(windowWidth - 32, 420) }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={styles.blankTitle}>
              <Text>What should we build in </Text>
              <Text style={styles.blankTitleWorkspace}>{workspaceTitle}</Text>
              <Text>?</Text>
            </Text>
            <Text style={[styles.blankSub, { color: notebookColors.muted }]}>输入你的需求，或使用 `/` 调用命令与工作流。</Text>
          </View>
        </View>
      ) : null}
      {showConversationList ? (
        <View style={styles.chatListStage}>
          <FlashList
            ref={messageScrollRef}
            style={{ flex: 1, opacity: listRevealReady ? 1 : 0 }}
            contentContainerStyle={chatContentContainerStyle}
            onLayout={onListLayout}
            data={displayedTurnCells}
            initialScrollIndex={initialScrollIndex}
            maintainVisibleContentPosition={maintainVisibleContentPosition}
            alwaysBounceVertical
            bounces
            overScrollMode="always"
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            viewabilityConfig={chatViewabilityConfig}
            onViewableItemsChanged={onChatViewableItemsChanged}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollEndDrag}
            onMomentumScrollBegin={onMomentumScrollBegin}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onScroll={onScroll}
            onContentSizeChange={onContentSizeChange}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            extraData={listExtraData}
            renderItem={renderTurnCell}
            onStartReached={handleStartReached}
            onStartReachedThreshold={0.15}
            ListHeaderComponent={null}
            ListFooterComponent={null}
            estimatedItemSize={200}
          />
          {sessionId && (loadingOlder || sessionHistoryRetryHintText) ? (
            <View pointerEvents="none" style={styles.historyOverlay}>
              <View style={styles.historyOverlayRail}>
                <View style={[styles.historyOverlayFill, loadingOlder ? styles.historyOverlayFillActive : { width: historyProgressWidth }]} />
              </View>
              {sessionHistoryRetryHintText ? <Text style={styles.historyOverlayHint}>{sessionHistoryRetryHintText}</Text> : null}
            </View>
          ) : null}
          {showLatestJump ? (
            <Pressable style={styles.latestJumpBtn} onPress={onJumpToLatest}>
              <Text style={styles.latestJumpTxt}>↓</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export const ChatConversationStage = React.memo(ChatConversationStageImpl);

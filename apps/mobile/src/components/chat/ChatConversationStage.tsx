import React, { useCallback, useMemo } from 'react';
import { Animated, Platform, Pressable, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

type NotebookColors = {
  text: string;
  muted: string;
  faint: string;
  line: string;
  paper: string;
};

export function ChatConversationStage(props: {
  styles: Record<string, any>;
  windowWidth: number;
  inputDockHeight: number;
  notebookColors: NotebookColors;
  showStreamTopGlow: boolean;
  streamTopGlowAnim: Animated.Value;
  sessionSwitchingTo: string;
  sessionSwitchingTitle: string;
  renderedTurnsLength: number;
  currentWorkspaceName: string;
  chatListMountKey: string;
  messageScrollRef: React.RefObject<any>;
  messageBottomInset: number;
  displayedTurnCells: any[];
  getChatCellType: (item: any) => string;
  initialChatScrollIndex?: number;
  initialChatScrollOffset?: number;
  chatViewabilityConfig: any;
  onChatViewableItemsChanged: (info: any) => void;
  canLoadEarlierHistory: boolean;
  loadingOlder: boolean;
  onLoadOlderMessages: () => void;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
  onScroll: (evt: any) => void;
  onContentSizeChange: (w: number, h: number) => void;
  onListLayout: (evt: any) => void;
  renderTurnCell: (info: { item: any; index: number }) => React.ReactElement;
  sessionId: string;
  sessionHistoryRetryHintText: string;
  historyProgressWidth: `${number}%`;
  showLatestJump: boolean;
  onJumpToLatest: () => void;
}) {
  const {
    canLoadEarlierHistory,
    chatListMountKey,
    chatViewabilityConfig,
    currentWorkspaceName,
    displayedTurnCells,
    getChatCellType,
    historyProgressWidth,
    initialChatScrollIndex,
    initialChatScrollOffset,
    inputDockHeight,
    loadingOlder,
    messageBottomInset,
    messageScrollRef,
    notebookColors,
    onChatViewableItemsChanged,
    onContentSizeChange,
    onJumpToLatest,
    onListLayout,
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
    sessionSwitchingTitle,
    sessionSwitchingTo,
    showLatestJump,
    showStreamTopGlow,
    streamTopGlowAnim,
    styles,
    windowWidth
  } = props;
  const chatDrawDistance = useMemo(() => Math.max(720, windowWidth * 1.6), [windowWidth]);
  const chatContentContainerStyle = useMemo(
    () => ({
      paddingTop: 8,
      paddingBottom: messageBottomInset,
      backgroundColor: 'transparent'
    }),
    [messageBottomInset]
  );
  const maintainChatPosition = useMemo(
    () => ({
      startRenderingFromBottom: false,
      autoscrollToTopThreshold: 0.08,
      autoscrollToBottomThreshold: 0,
      animateAutoScrollToBottom: false
    }),
    []
  );
  const keyExtractor = useCallback((item: any) => item.id, []);
  const handleStartReached = useCallback(() => {
    if (canLoadEarlierHistory && !loadingOlder) onLoadOlderMessages();
  }, [canLoadEarlierHistory, loadingOlder, onLoadOlderMessages]);

  return (
    <View style={styles.chatBodyWrap}>
      {showStreamTopGlow ? (
        <View pointerEvents="none" style={styles.streamTopGlowTrack}>
          <Animated.View
            style={[
              styles.streamTopGlowSweep,
              {
                opacity: streamTopGlowAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.18, 0.46, 0.18] }),
                transform: [
                  {
                    translateX: streamTopGlowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-180, 360]
                    })
                  }
                ]
              }
            ]}
          />
        </View>
      ) : null}
      {sessionSwitchingTo ? (
        <View style={[styles.blankWrap, styles.sessionSwitchWrap, { paddingBottom: Math.max(84, inputDockHeight * 0.72) }]}>
          <View style={[styles.blankHero, styles.sessionSwitchHero, { width: Math.min(windowWidth - 56, 320) }]}>
            <Text numberOfLines={1} style={[styles.blankEyebrow, { color: notebookColors.faint }]}>
              Loading session
            </Text>
            <Text numberOfLines={2} style={[styles.sessionSwitchTitle, { color: notebookColors.text }]}>
              {sessionSwitchingTitle}
            </Text>
            <Text style={[styles.blankSub, { color: notebookColors.muted }]}>正在载入历史消息与上下文，请稍候。</Text>
            <View style={[styles.sessionSwitchRail, { borderColor: notebookColors.line, backgroundColor: notebookColors.paper }]}>
              <Animated.View style={[styles.sessionSwitchRailFill, { backgroundColor: notebookColors.text }]} />
            </View>
          </View>
        </View>
      ) : renderedTurnsLength === 0 ? (
        <View style={[styles.blankWrap, { paddingBottom: Math.max(84, inputDockHeight * 0.72) }]}>
          <View style={[styles.blankHero, { width: Math.min(windowWidth - 56, 320) }]}>
            <Text numberOfLines={1} style={[styles.blankEyebrow, { color: notebookColors.faint }]}>
              {currentWorkspaceName}
            </Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86} style={styles.blankTitle}>
              What shall we build?
            </Text>
            <Text style={[styles.blankSub, { color: notebookColors.muted }]}>输入你的需求，或使用 `/` 调用命令与工作流。</Text>
          </View>
        </View>
      ) : (
        <View style={styles.chatListStage}>
          <FlashList
            key={chatListMountKey}
            ref={messageScrollRef}
            drawDistance={chatDrawDistance}
            contentContainerStyle={chatContentContainerStyle}
            onLayout={onListLayout}
            data={displayedTurnCells}
            inverted
            getItemType={getChatCellType}
            initialScrollIndex={typeof initialChatScrollIndex === 'number' ? initialChatScrollIndex : undefined}
            initialScrollIndexParams={typeof initialChatScrollOffset === 'number' ? { viewOffset: initialChatScrollOffset } : undefined}
            removeClippedSubviews={Platform.OS === 'web'}
            alwaysBounceVertical
            bounces
            overScrollMode="always"
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            maintainVisibleContentPosition={maintainChatPosition}
            viewabilityConfig={chatViewabilityConfig}
            onViewableItemsChanged={onChatViewableItemsChanged}
            onEndReached={handleStartReached}
            onEndReachedThreshold={0.16}
            onScrollBeginDrag={onScrollBeginDrag}
            onScrollEndDrag={onScrollEndDrag}
            onMomentumScrollBegin={onMomentumScrollBegin}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onScroll={onScroll}
            onContentSizeChange={onContentSizeChange}
            keyExtractor={keyExtractor}
            renderItem={renderTurnCell}
            ListHeaderComponent={null}
            ListFooterComponent={null}
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
      )}
    </View>
  );
}

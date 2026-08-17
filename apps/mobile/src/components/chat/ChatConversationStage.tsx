import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { SharedValue } from 'react-native-reanimated';
import { getDisplayedCellItemType } from '../../features/chat/displayedCells';
import { getActiveSessionSwitchTrace, markSessionSwitchPerf } from '../../features/chat/sessionSwitchPerf';
import { getActiveMessageSendTrace, markMessageSendPerf } from '../../features/messages/messageSendPerf';
import { useMobileTheme } from '../../features/theme/ThemeProvider';

/** LegendList 位置保持：按官方聊天/前插指南开启 data+size，交给列表锚点，勿再手写 scroll 补偿。 */
const CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION = { data: true, size: true } as const;
/** Composer 占位由 contentInsetEndAdjustment 负责，这里只留极小呼吸空。 */
const CHAT_LIST_CONTENT_BOTTOM_AIR = 12;

const LATEST_JUMP_SIZE = 40;

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
  /** 官方 useKeyboardChatComposerInset → 列表底 inset，与 Sticky Composer 同步 */
  contentInsetEndAdjustment: SharedValue<number>;
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
  hasEnabledModels?: boolean;
  /** idle/loading：连接中；error：拉取失败；ready：可判断是否有模型 */
  modelCatalogStatus?: 'idle' | 'loading' | 'ready' | 'error';
  onOpenModelSettings?: () => void;
  /** 空会话占位点击：收起输入扩展 */
  onBlankPress?: () => void;
}) {
  const {
    chatViewabilityConfig,
    currentWorkspaceName,
    displayedTurnCells,
    hasEnabledModels = true,
    historyProgressWidth,
    inputDockHeight,
    listRevealReady,
    loadingOlder,
    contentInsetEndAdjustment,
    messageScrollRef,
    modelCatalogStatus = 'ready',
    notebookColors,
    onBlankPress,
    onChatViewableItemsChanged,
    onContentSizeChange,
    onJumpToLatest,
    onListLayout,
    anchorSessionToLatest,
    onLoadOlderMessages,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onOpenModelSettings,
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
      paddingTop: 4,
      paddingBottom: CHAT_LIST_CONTENT_BOTTOM_AIR,
      backgroundColor: 'transparent'
    }),
    []
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
  const { colors } = useMobileTheme();
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

  const settingsLinkColor = colors.isDark ? '#FFFFFF' : '#1A1A1F';

  useEffect(() => {
    console.log(`[DEBUG] ChatConversationStage effect: sessionId=${sessionId} cells=${displayedTurnCells.length} loadingOlder=${loadingOlder}`);
    if (loadingOlder || !sessionId || displayedTurnCells.length <= 0) return;
    console.log(`[DEBUG] Calling anchorSessionToLatest for ${sessionId} with ${displayedTurnCells.length} cells`);
    return anchorSessionToLatest(sessionId, displayedTurnCells.length);
  }, [anchorSessionToLatest, displayedTurnCells.length, loadingOlder, sessionId]);

  return (
    <View style={styles.chatBodyWrap}>
      {showEmptyDraft ? (
        <Pressable
          style={[styles.blankWrap, { paddingBottom: Math.max(24, inputDockHeight * 0.35) }]}
          onPress={onBlankPress}
          accessibilityRole="button"
          accessibilityLabel="收起输入框"
        >
          <View style={styles.blankHero} pointerEvents="box-none">
            {modelCatalogStatus === 'error' ? (
              <>
                <Text style={[styles.blankTitle, { color: colors.text }]}>连接未完成</Text>
                <Text style={[styles.blankSub, { color: notebookColors.muted }]}>
                  工作区或模型配置同步失败。请确认桌面端中继在线、已打开仓库后重试，或打开
                  <Text
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onOpenModelSettings?.();
                    }}
                    style={{
                      color: settingsLinkColor,
                      fontWeight: '700',
                      textDecorationLine: 'underline'
                    }}
                    accessibilityRole="link"
                    accessibilityLabel="打开模型设置"
                  >
                    设置
                  </Text>
                  查看详情
                </Text>
              </>
            ) : modelCatalogStatus === 'idle' || modelCatalogStatus === 'loading' ? (
              <>
                <Text style={[styles.blankTitle, { color: colors.text }]}>正在连接…</Text>
                <Text style={[styles.blankSub, { color: notebookColors.muted }]}>
                  正在获取工作区与模型配置，请稍候
                </Text>
              </>
            ) : !hasEnabledModels ? (
              <>
                <Text style={[styles.blankTitle, { color: colors.text }]}>先开启一个模型</Text>
                <Text style={[styles.blankSub, { color: notebookColors.muted }]}>
                  打开
                  <Text
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onOpenModelSettings?.();
                    }}
                    style={{
                      color: settingsLinkColor,
                      fontWeight: '700',
                      textDecorationLine: 'underline'
                    }}
                    accessibilityRole="link"
                    accessibilityLabel="打开模型设置"
                  >
                    设置
                  </Text>
                  里的模型开关后，就可以开始聊天
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.blankTitle, { color: colors.text }]}>有什么可以帮忙的？</Text>
                <Text style={[styles.blankSub, { color: notebookColors.muted }]}>
                  向 Giteam 提问，或输入 / 使用命令
                </Text>
              </>
            )}
          </View>
        </Pressable>
      ) : null}
      {showConversationList ? (
        <View style={styles.chatListStage}>
          <KeyboardAwareLegendList
            ref={messageScrollRef}
            style={{ flex: 1, opacity: listRevealReady ? 1 : 0 }}
            contentContainerStyle={chatContentContainerStyle}
            contentInsetEndAdjustment={contentInsetEndAdjustment}
            keyboardOffset={0}
            keyboardLiftBehavior="whenAtEnd"
            keyboardDismissMode="interactive"
            onLayout={onListLayout}
            data={displayedTurnCells}
            initialScrollIndex={initialScrollIndex}
            // 动态行以实测为准；200 仅作首屏分配提示（官方：不必贴实测均值）。
            estimatedItemSize={200}
            maintainVisibleContentPosition={CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION}
            // 不开启 alignItemsAtEnd：短会话/新发消息从顶部排起（贴底会变成「从下面冒出来」）。
            // 贴底增长仍保留，流式输出时跟到底。
            // 贴底增长：关闭 layout 触发，避免视口/chrome 变化时与 MVCP 互抢反复抖。
            maintainScrollAtEnd={{
              animated: false,
              on: { dataChange: true, itemLayout: true, layout: false }
            }}
            maintainScrollAtEndThreshold={0.12}
            // 行内有展开态；不开 recycleItems，避免虚拟化复用串开合状态（官方 Recycling 警告）。
            recycleItems={false}
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
            <View pointerEvents="box-none" style={latestJumpStyles.wrap}>
              <View
                style={[
                  latestJumpStyles.chrome,
                  { backgroundColor: colors.isDark ? colors.card : '#FFFFFF' }
                ]}
              >
                <Pressable
                  accessibilityLabel="拉到最新"
                  accessibilityRole="button"
                  onPress={onJumpToLatest}
                  android_ripple={{
                    color: colors.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                    borderless: true,
                    radius: LATEST_JUMP_SIZE / 2
                  }}
                  style={({ pressed }) => [latestJumpStyles.hit, { opacity: pressed ? 0.72 : 1 }]}
                >
                  <Feather name="arrow-down" size={18} color={colors.text} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export const ChatConversationStage = React.memo(ChatConversationStageImpl);

const latestJumpStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: 'center',
    zIndex: 30,
    elevation: 30
  },
  chrome: {
    width: LATEST_JUMP_SIZE,
    height: LATEST_JUMP_SIZE,
    borderRadius: LATEST_JUMP_SIZE / 2,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOpacity: 0.14,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 }
      },
      android: {
        elevation: 4
      },
      default: {}
    })
  },
  hit: {
    width: LATEST_JUMP_SIZE,
    height: LATEST_JUMP_SIZE,
    borderRadius: LATEST_JUMP_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

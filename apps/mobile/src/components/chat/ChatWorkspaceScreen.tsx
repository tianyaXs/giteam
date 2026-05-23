import React, { useMemo } from 'react';
import { Animated, StatusBar, Text, View } from 'react-native';
import { ChatComposer, ComposerPickerSheet } from './ChatComposer';
import { AlbumPickerOverlay, ImagePreviewOverlay } from './MediaOverlays';
import { MobileTodoCardView } from './MobileTurnCell';
import { QuestionDock } from '../QuestionDock';
import { ChatConversationStage } from './ChatConversationStage';

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

export function ChatWorkspaceScreen(props: {
  styles: Record<string, any>;
  windowWidth: number;
  inputDockHeight: number;
  notebookColors: NotebookColors;
  notebookPanHandlers: Record<string, any>;
  notebookTrackX: Animated.Value;
  leftDrawer: React.ReactNode;
  rightDrawer: React.ReactNode;
  showNotebookSessionTitle: boolean;
  currentSessionTitle: string;
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
  chatViewabilityConfig: any;
  onChatViewableItemsChanged: (info: any) => void;
  loadingOlder: boolean;
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
  maintainVisibleAnchor: boolean;
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
  albumPickerProps: React.ComponentProps<typeof AlbumPickerOverlay>;
  previewImage: { uri: string; filename?: string } | null;
  onClosePreviewImage: () => void;
  composerPickerProps: React.ComponentProps<typeof ComposerPickerSheet>;
}) {
  const {
    activeQuestionRequest,
    albumPickerProps,
    chatListMountKey,
    chatViewabilityConfig,
    composerPickerProps,
    composerProps,
    currentSessionTitle,
    currentWorkspaceName,
    dismissedTodoCardId,
    displayedTurnCells,
    historyProgressWidth,
    inputDockHeight,
    latestTodoCard,
    leftDrawer,
    loadingOlder,
    maintainVisibleAnchor,
    messageBottomInset,
    messageScrollRef,
    notebookColors,
    notebookPanHandlers,
    notebookTrackX,
    onChatViewableItemsChanged,
    onClosePreviewImage,
    onContentSizeChange,
    onDismissQuestion,
    onDismissTodoDock,
    onJumpToLatest,
    onListLayout,
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
    sessionSwitchingTitle,
    sessionSwitchingTo,
    showLatestJump,
    showNotebookSessionTitle,
    showStreamTopGlow,
    suppressFloatingDocks,
    streamTopGlowAnim,
    styles,
    thinkingPulse,
    todoDockCollapsed,
    windowWidth
  } = props;

  const leftPageMotionStyle = useMemo(
    () => ({
      opacity: notebookTrackX.interpolate({
        inputRange: [-windowWidth, 0],
        outputRange: [0.9, 1],
        extrapolate: 'clamp'
      }),
      transform: [
        {
          scale: notebookTrackX.interpolate({
            inputRange: [-windowWidth, 0],
            outputRange: [0.985, 1],
            extrapolate: 'clamp'
          })
        }
      ]
    }),
    [notebookTrackX, windowWidth]
  );
  const mainPageMotionStyle = useMemo(
    () => ({
      opacity: notebookTrackX.interpolate({
        inputRange: [-windowWidth * 2, -windowWidth, 0],
        outputRange: [0.9, 1, 0.9],
        extrapolate: 'clamp'
      }),
      transform: [
        {
          scale: notebookTrackX.interpolate({
            inputRange: [-windowWidth * 2, -windowWidth, 0],
            outputRange: [0.982, 1, 0.982],
            extrapolate: 'clamp'
          })
        }
      ]
    }),
    [notebookTrackX, windowWidth]
  );
  const rightPageMotionStyle = useMemo(
    () => ({
      opacity: notebookTrackX.interpolate({
        inputRange: [-windowWidth * 2, -windowWidth],
        outputRange: [1, 0.9],
        extrapolate: 'clamp'
      }),
      transform: [
        {
          scale: notebookTrackX.interpolate({
            inputRange: [-windowWidth * 2, -windowWidth],
            outputRange: [1, 0.985],
            extrapolate: 'clamp'
          })
        }
      ]
    }),
    [notebookTrackX, windowWidth]
  );

  return (
    <>
      <View style={[styles.notebookShell, { backgroundColor: notebookColors.shell }]} {...notebookPanHandlers}>
        <Animated.View
          style={[
            styles.notebookTrack,
            {
              width: windowWidth * 3,
              transform: [{ translateX: notebookTrackX }]
            }
          ]}
        >
          <Animated.View style={[styles.notebookPageFrame, { width: windowWidth }, leftPageMotionStyle]}>{leftDrawer}</Animated.View>
          <Animated.View style={[styles.notebookMainPage, { backgroundColor: notebookColors.main, width: windowWidth }, mainPageMotionStyle]}>
            <StatusBar barStyle="dark-content" backgroundColor={notebookColors.shell} />
            <View style={[styles.topBar, { backgroundColor: notebookColors.main }]}>
              <View style={styles.topSideSlot} />
              <View style={styles.topBrand}>
                {showNotebookSessionTitle ? (
                  <Text numberOfLines={1} style={[styles.topTitleCompact, { color: notebookColors.text }]}>
                    {currentSessionTitle}
                  </Text>
                ) : null}
              </View>
              <View style={styles.topSideSlotRight} />
            </View>
            <ChatConversationStage
              styles={styles}
              windowWidth={windowWidth}
              inputDockHeight={inputDockHeight}
              notebookColors={notebookColors}
              showStreamTopGlow={showStreamTopGlow}
              streamTopGlowAnim={streamTopGlowAnim}
              sessionSwitchingTo={sessionSwitchingTo}
              sessionSwitchingTitle={sessionSwitchingTitle}
              renderedTurnsLength={renderedTurnsLength}
              currentWorkspaceName={currentWorkspaceName}
              chatListMountKey={chatListMountKey}
              messageScrollRef={messageScrollRef}
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
              renderTurnCell={renderTurnCell}
              sessionId={sessionId}
              sessionHistoryRetryHintText={sessionHistoryRetryHintText}
              historyProgressWidth={historyProgressWidth}
              showLatestJump={showLatestJump}
              maintainVisibleAnchor={maintainVisibleAnchor}
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
            <ChatComposer {...composerProps} />
          </Animated.View>
          <Animated.View style={[styles.notebookPageFrame, { width: windowWidth }, rightPageMotionStyle]}>{rightDrawer}</Animated.View>
        </Animated.View>
      </View>
      <AlbumPickerOverlay {...albumPickerProps} />
      <ImagePreviewOverlay styles={styles} image={previewImage} onClose={onClosePreviewImage} />
      <ComposerPickerSheet {...composerPickerProps} />
    </>
  );
}

import React, { useCallback } from 'react';
import { toText } from '../../lib/text';
import type { MobileQuestionCard } from '../../types';
import type { DisplayedTurnCell } from './displayedCells';
import { MobileTurnCell } from '../../components/chat/MobileTurnCell';
import type { TurnCellInteractionState } from './useInteractiveTurnCells';

export function useTurnCellRenderer(params: {
  activeQuestionsForTurn: MobileQuestionCard[];
  bodyFontFamily: string;
  chatCellHeightMapRef: React.MutableRefObject<Record<string, number>>;
  interactionByCellId: Record<string, TurnCellInteractionState>;
  exploringStatus?: {
    title: string;
    summary: string;
    detail?: string;
  };
  exploringActions?: {
    current: Array<{ tool: string; detail: string; status: string }>;
    completed: Array<{ tool: string; detail: string; status: string }>;
  };
  handleCopyImage: (uri: string) => void;
  handleCopyMessage: (text: string) => void;
  handleOpenPreviewImage: (image: { uri: string; filename?: string }) => void;
  handleQuestionReply: (requestId: string, answers: string[][]) => void;
  handleThinkCardToggle: (id: string) => void;
  handleTimelineQuestionToggle: (id: string) => void;
  handleTimelineTabChange: (questionId: string, tabIndex: number) => void;
  /** @deprecated 展开高度改由 LegendList MVCP.size 处理，可省略 */
  prepareCellLayoutAdjustment?: (cellId: string, previousHeight: number) => void;
  /** @deprecated 同上 */
  settleCellLayoutAdjustment?: (cellId: string, nextHeight: number, previousHeight?: number) => void;
  liveQuestionTurnId: string;
  sessionWorking: boolean;
  styles: Record<string, any>;
  thinkingPulse: boolean;
}) {
  const {
    activeQuestionsForTurn,
    bodyFontFamily,
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
    liveQuestionTurnId,
    sessionWorking,
    styles,
    thinkingPulse
  } = params;

  // 仅缓存实测高度；不再 settle scroll（官方：size 变化交给 maintainVisibleContentPosition）。
  const rememberCellHeight = useCallback(
    (id: string, height: number) => {
      const key = toText(id).trim();
      if (!key || !Number.isFinite(height) || height <= 0) return;
      const prev = chatCellHeightMapRef.current[key] || 0;
      if (Math.abs(prev - height) <= 1) return;
      chatCellHeightMapRef.current[key] = height;
    },
    [chatCellHeightMapRef]
  );

  const renderTurnCell = useCallback(
    ({ item }: { item: DisplayedTurnCell; index: number }) => {
      const interaction = interactionByCellId[item.id] || {
        interactionSignature: '',
        isLastVisible: false,
        expandedThinkIds: {},
        expandedTimelineQuestionIds: {},
        timelineQuestionTabs: {}
      };

      const isUserOnlyCell = !!item.userMessage && item.items.length === 0;

      return (
        <MobileTurnCell
          bodyFontFamily={bodyFontFamily}
          styles={styles}
          turn={item}
          streaming={sessionWorking && interaction.isLastVisible && !isUserOnlyCell}
          isLastTurn={interaction.isLastVisible}
          thinkingPulse={thinkingPulse}
          hasLiveQuestion={liveQuestionTurnId === (item.parentTurnId || item.id)}
          liveQuestions={liveQuestionTurnId === (item.parentTurnId || item.id) ? activeQuestionsForTurn : []}
          interaction={interaction}
          exploringStatus={interaction.isLastVisible && !isUserOnlyCell ? exploringStatus : undefined}
          exploringActions={interaction.isLastVisible && !isUserOnlyCell ? exploringActions : undefined}
          onQuestionReply={handleQuestionReply}
          onCopyMessage={handleCopyMessage}
          onOpenImage={handleOpenPreviewImage}
          onCopyImage={handleCopyImage}
          onToggleTimelineQuestion={handleTimelineQuestionToggle}
          onToggleThinkCard={handleThinkCardToggle}
          onChangeTimelineTab={handleTimelineTabChange}
          onMeasuredHeight={rememberCellHeight}
        />
      );
    },
    [
      activeQuestionsForTurn,
      bodyFontFamily,
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
      liveQuestionTurnId,
      rememberCellHeight,
      sessionWorking,
      styles,
      thinkingPulse
    ]
  );

  return { renderTurnCell };
}

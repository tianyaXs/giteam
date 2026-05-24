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
  prepareCellLayoutAdjustment: (cellId: string, previousHeight: number) => void;
  settleCellLayoutAdjustment: (cellId: string, nextHeight: number) => void;
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
    prepareCellLayoutAdjustment,
    settleCellLayoutAdjustment,
    liveQuestionTurnId,
    sessionWorking,
    styles,
    thinkingPulse
  } = params;

  const rememberCellHeight = useCallback((id: string, height: number) => {
    const key = toText(id).trim();
    if (!key || !Number.isFinite(height) || height <= 0) return;
    const prev = chatCellHeightMapRef.current[key] || 0;
    settleCellLayoutAdjustment(key, height);
    if (Math.abs(prev - height) <= 1) return;
    chatCellHeightMapRef.current[key] = height;
  }, [chatCellHeightMapRef, settleCellLayoutAdjustment]);

  const renderTurnCell = useCallback(({ item }: { item: DisplayedTurnCell; index: number }) => {
    const interaction = interactionByCellId[item.id] || {
      interactionSignature: '',
      isLastVisible: false,
      expandedThinkIds: {},
      expandedTimelineQuestionIds: {},
      timelineQuestionTabs: {}
    };
    const prepareInteraction = () => {
      prepareCellLayoutAdjustment(item.id, chatCellHeightMapRef.current[item.id] || 0);
    };

    return (
      <MobileTurnCell
        bodyFontFamily={bodyFontFamily}
        styles={styles}
        turn={item}
        streaming={sessionWorking && interaction.isLastVisible}
        isLastTurn={interaction.isLastVisible}
        thinkingPulse={thinkingPulse}
        hasLiveQuestion={liveQuestionTurnId === (item.parentTurnId || item.id)}
        liveQuestions={liveQuestionTurnId === (item.parentTurnId || item.id) ? activeQuestionsForTurn : []}
        interaction={interaction}
        exploringStatus={interaction.isLastVisible ? exploringStatus : undefined}
        exploringActions={interaction.isLastVisible ? exploringActions : undefined}
        onQuestionReply={handleQuestionReply}
        onCopyMessage={handleCopyMessage}
        onOpenImage={handleOpenPreviewImage}
        onCopyImage={handleCopyImage}
        onToggleTimelineQuestion={(id) => {
          prepareInteraction();
          handleTimelineQuestionToggle(id);
        }}
        onToggleThinkCard={(id) => {
          prepareInteraction();
          handleThinkCardToggle(id);
        }}
        onChangeTimelineTab={handleTimelineTabChange}
        onMeasuredHeight={rememberCellHeight}
      />
    );
  }, [
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
    prepareCellLayoutAdjustment,
    rememberCellHeight,
    sessionWorking,
    styles,
    thinkingPulse
  ]);

  return {
    renderTurnCell
  };
}

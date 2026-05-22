import React, { useCallback } from 'react';
import { toText } from '../../lib/text';
import type { MobileQuestionCard } from '../../types';
import type { DisplayedTurnCell } from './displayedCells';
import { MobileTurnCell } from '../../components/chat/MobileTurnCell';

export function useTurnCellRenderer(params: {
  activeQuestionsForTurn: MobileQuestionCard[];
  bodyFontFamily: string;
  chatCellHeightMapRef: React.MutableRefObject<Record<string, number>>;
  displayedTurnCells: DisplayedTurnCell[];
  expandedThinkCards: Set<string>;
  expandedTimelineQuestions: Set<string>;
  handleCopyImage: (uri: string) => void;
  handleCopyMessage: (text: string) => void;
  handleOpenPreviewImage: (image: { uri: string; filename?: string }) => void;
  handleQuestionReply: (requestId: string, answers: string[][]) => void;
  handleThinkCardToggle: (id: string) => void;
  handleTimelineQuestionToggle: (id: string) => void;
  handleTimelineTabChange: (questionId: string, tabIndex: number) => void;
  liveQuestionTurnId: string;
  sessionWorking: boolean;
  styles: Record<string, any>;
  thinkingPulse: boolean;
  timelineQuestionTabs: Map<string, number>;
}) {
  const {
    activeQuestionsForTurn,
    bodyFontFamily,
    chatCellHeightMapRef,
    displayedTurnCells,
    expandedThinkCards,
    expandedTimelineQuestions,
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
    thinkingPulse,
    timelineQuestionTabs
  } = params;

  const rememberCellHeight = useCallback((id: string, height: number) => {
    const key = toText(id).trim();
    if (!key || !Number.isFinite(height) || height <= 0) return;
    const prev = chatCellHeightMapRef.current[key] || 0;
    if (Math.abs(prev - height) <= 1) return;
    chatCellHeightMapRef.current[key] = height;
  }, [chatCellHeightMapRef]);

  const getChatCellType = useCallback((item: DisplayedTurnCell) => {
    if (item.userMessage) return 'user';
    const timelineItem = item.items[0];
    return timelineItem?.kind || 'unknown';
  }, []);

  const renderTurnCell = useCallback(({ item }: { item: DisplayedTurnCell; index: number }) => (
    <MobileTurnCell
      bodyFontFamily={bodyFontFamily}
      styles={styles}
      turn={item}
      streaming={sessionWorking}
      isLastTurn={item.id === displayedTurnCells[displayedTurnCells.length - 1]?.id}
      thinkingPulse={thinkingPulse}
      hasLiveQuestion={liveQuestionTurnId === (item.parentTurnId || item.id)}
      liveQuestions={liveQuestionTurnId === (item.parentTurnId || item.id) ? activeQuestionsForTurn : []}
      onQuestionReply={handleQuestionReply}
      onCopyMessage={handleCopyMessage}
      onOpenImage={handleOpenPreviewImage}
      onCopyImage={handleCopyImage}
      expandedTimelineQuestions={expandedTimelineQuestions}
      onToggleTimelineQuestion={handleTimelineQuestionToggle}
      expandedThinkCards={expandedThinkCards}
      onToggleThinkCard={handleThinkCardToggle}
      timelineQuestionTabs={timelineQuestionTabs}
      onChangeTimelineTab={handleTimelineTabChange}
      onMeasuredHeight={rememberCellHeight}
    />
  ), [
    activeQuestionsForTurn,
    bodyFontFamily,
    displayedTurnCells,
    expandedThinkCards,
    expandedTimelineQuestions,
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
    thinkingPulse,
    timelineQuestionTabs
  ]);

  return {
    getChatCellType,
    renderTurnCell
  };
}

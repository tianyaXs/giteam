import { useMemo } from 'react';
import type { DisplayedTurnCell } from './displayedCells';

export type TurnCellInteractionState = {
  interactionSignature: string;
  isLastVisible: boolean;
  expandedThinkIds: Record<string, boolean>;
  expandedTimelineQuestionIds: Record<string, boolean>;
  timelineQuestionTabs: Record<string, number>;
};

function buildCellInteractionState(
  cell: DisplayedTurnCell,
  index: number,
  total: number,
  newestFirst: boolean,
  expandedThinkCards: Set<string>,
  expandedTimelineQuestions: Set<string>,
  timelineQuestionTabs: Map<string, number>
): TurnCellInteractionState {
  const expandedThinkIds: Record<string, boolean> = {};
  const expandedTimelineQuestionIds: Record<string, boolean> = {};
  const questionTabs: Record<string, number> = {};
  const isLastVisible = newestFirst ? index === 0 : index === total - 1;
  const signatureParts = [`last:${isLastVisible ? 1 : 0}`];

  for (const item of cell.items) {
    if (item.kind === 'think') {
      const id = item.card.id;
      const expanded = expandedThinkCards.has(id);
      expandedThinkIds[id] = expanded;
      signatureParts.push(`think:${id}:${expanded ? 1 : 0}`);
    }
    if (item.kind === 'question') {
      const id = item.question.id;
      const expanded = expandedTimelineQuestions.has(id);
      const tab = timelineQuestionTabs.get(id) || 0;
      expandedTimelineQuestionIds[id] = expanded;
      questionTabs[id] = tab;
      signatureParts.push(`question:${id}:${expanded ? 1 : 0}:${tab}`);
    }
  }

  return {
    interactionSignature: signatureParts.join('|'),
    isLastVisible,
    expandedThinkIds,
    expandedTimelineQuestionIds,
    timelineQuestionTabs: questionTabs
  };
}

export function useInteractiveTurnCells(params: {
  displayedTurnCells: DisplayedTurnCell[];
  expandedThinkCards: Set<string>;
  expandedTimelineQuestions: Set<string>;
  newestFirst?: boolean;
  timelineQuestionTabs: Map<string, number>;
}) {
  const {
    displayedTurnCells,
    expandedThinkCards,
    expandedTimelineQuestions,
    newestFirst = false,
    timelineQuestionTabs
  } = params;

  return useMemo(() => {
    const interactionByCellId: Record<string, TurnCellInteractionState> = {};
    displayedTurnCells.forEach((cell, index) => {
      interactionByCellId[cell.id] = buildCellInteractionState(
        cell,
        index,
        displayedTurnCells.length,
        newestFirst,
        expandedThinkCards,
        expandedTimelineQuestions,
        timelineQuestionTabs
      );
    });
    return interactionByCellId;
  }, [
    displayedTurnCells,
    expandedThinkCards,
    expandedTimelineQuestions,
    newestFirst,
    timelineQuestionTabs
  ]);
}

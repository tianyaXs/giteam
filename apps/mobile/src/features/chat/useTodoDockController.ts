import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MobileRenderedTurn, MobileTodoCard } from '../../types';

export function useTodoDockController(params: {
  displayedTurns: MobileRenderedTurn[];
  sessionId: string;
  sessionWorking: boolean;
  streamTodoCard: MobileTodoCard | null;
}) {
  const {
    displayedTurns,
    sessionId,
    sessionWorking,
    streamTodoCard
  } = params;

  const [todoDockCollapsed, setTodoDockCollapsed] = useState(false);
  const [dismissedTodoCardId, setDismissedTodoCardId] = useState('');

  useEffect(() => {
    setDismissedTodoCardId('');
    setTodoDockCollapsed(false);
  }, [sessionId]);

  const latestTodoCard = useMemo(() => {
    if (sessionWorking && streamTodoCard) return streamTodoCard;
    for (let turnIdx = displayedTurns.length - 1; turnIdx >= 0; turnIdx -= 1) {
      const turn = displayedTurns[turnIdx];
      for (let itemIdx = turn.items.length - 1; itemIdx >= 0; itemIdx -= 1) {
        const item = turn.items[itemIdx];
        if (item.kind === 'todo') return item.todo;
      }
    }
    return streamTodoCard;
  }, [displayedTurns, sessionWorking, streamTodoCard]);

  useEffect(() => {
    if (!latestTodoCard) {
      setTodoDockCollapsed(false);
      return;
    }
    if (dismissedTodoCardId && latestTodoCard.id !== dismissedTodoCardId) {
      setDismissedTodoCardId('');
    }
    if (sessionWorking) {
      setTodoDockCollapsed(false);
      return;
    }
    setTodoDockCollapsed(true);
  }, [dismissedTodoCardId, latestTodoCard?.id, latestTodoCard?.summary, latestTodoCard?.finished, sessionWorking]);

  const toggleTodoDock = useCallback(() => {
    setTodoDockCollapsed((prev) => !prev);
  }, []);

  const dismissTodoDock = useCallback(() => {
    setDismissedTodoCardId(latestTodoCard?.id || '');
  }, [latestTodoCard?.id]);

  return {
    dismissedTodoCardId,
    dismissTodoDock,
    latestTodoCard,
    todoDockCollapsed,
    toggleTodoDock
  };
}

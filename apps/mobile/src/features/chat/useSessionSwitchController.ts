import { useCallback, useState } from 'react';
import { getActiveSessionSwitchTrace, markSessionSwitchPerf } from './sessionSwitchPerf';
import type { SessionStatusInfo } from '../../types';

export function useSessionSwitchController<Cell extends { id: string }>(props: {
  initialSessionLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  displayedTurnCellsRef: React.MutableRefObject<Cell[]>;
  visibleCellCountRef: React.MutableRefObject<number>;
  messagesRef: React.MutableRefObject<any[]>;
  renderedTurnsRef: React.MutableRefObject<any[]>;
  sessionNextCursor: Record<string, string>;
  rememberCurrentSessionViewport: (targetSessionId: string, params: {
    displayedTurnCells: Cell[];
    visibleCellCount: number;
  }) => void;
  resetListInteractionState: (nextSessionId?: string) => void;
  guardHistoryLoad: (durationMs?: number) => void;
  resetSessionInteractionState: () => void;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => void;
  setSessionId: (sessionId: string) => void;
  setQuestionRequests: (value: any[]) => void;
  setQuestionSubmitState: (value: Record<string, any>) => void;
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setSessionStatusMap: React.Dispatch<React.SetStateAction<Record<string, SessionStatusInfo>>>;
}) {
  const {
    applyTurnWindow,
    guardHistoryLoad,
    displayedTurnCellsRef,
    initialSessionLimit,
    messagesRef,
    rememberCurrentSessionViewport,
    renderedTurnsRef,
    resetListInteractionState,
    resetSessionInteractionState,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setMessages,
    setQuestionRequests,
    setQuestionSubmitState,
    setRenderedTurns,
    setSessionId,
    setSessionStatusMap,
    visibleCellCountRef
  } = props;

  const [sessionSwitchingTo, setSessionSwitchingTo] = useState('');

  const setActiveSession = useCallback((nextSessionId: string) => {
    const sid = String(nextSessionId || '').trim();
    const prevSid = String(sessionIdRef.current || '').trim();
    if (sid === prevSid) return;
    const perf = getActiveSessionSwitchTrace();
    markSessionSwitchPerf(perf, 'setActiveSession.begin', { prevSid, sid });
    const cachedRowsForNextSession = sid && Array.isArray(sessionRawMapRef.current[sid]) ? sessionRawMapRef.current[sid] : [];
    rememberCurrentSessionViewport(prevSid, {
      displayedTurnCells: displayedTurnCellsRef.current,
      visibleCellCount: visibleCellCountRef.current
    });
    resetListInteractionState(sid);
    resetSessionInteractionState();
    markSessionSwitchPerf(perf, 'setActiveSession.reset_interaction');
    setQuestionRequests([]);
    setQuestionSubmitState({});
    messagesRef.current = [];
    renderedTurnsRef.current = [];
    setMessages([]);
    setRenderedTurns([]);
    markSessionSwitchPerf(perf, 'setActiveSession.clear_ui');
    if (!sid) {
      setSessionSwitchingTo('');
      sessionIdRef.current = '';
      setSessionId('');
      setSessionStatusMap({});
      return;
    }
    sessionIdRef.current = sid;
    setSessionId(sid);
    setSessionSwitchingTo('');
    guardHistoryLoad(1500);
    markSessionSwitchPerf(perf, 'setActiveSession.session_id_committed', {
      cachedRows: cachedRowsForNextSession.length
    });
    if (cachedRowsForNextSession.length > 0) {
      const totalTurnCount = Math.max(0, Number(sessionTotalTurnCountRef.current[sid] || 0));
      // 修复：visibleCount 应该至少显示 initialSessionLimit 个 turn，而不是被快照的 visibleTurnCount 限制
      // 如果 totalTurnCount > visibleTurnCount，说明有更多历史消息，应该显示更多
      const cachedVisibleCount = Math.max(0, Number(sessionVisibleTurnCountRef.current[sid] || 0));
      const visibleCount = Math.max(
        initialSessionLimit,
        cachedVisibleCount,
        totalTurnCount
      );
      const applyStartedAt = performance.now();
      applyTurnWindow(sid, visibleCount, sessionNextCursor[sid]);
      markSessionSwitchPerf(perf, 'setActiveSession.apply_turn_window', {
        visibleCount,
        totalTurnCount,
        applyMs: Math.round(performance.now() - applyStartedAt)
      });
      markSessionSwitchPerf(perf, 'setActiveSession.await_list_reveal', { source: 'memory_cache' });
      return;
    }
    markSessionSwitchPerf(perf, 'setActiveSession.await_sync', { cachedRows: 0 });
  }, [
    applyTurnWindow,
    guardHistoryLoad,
    displayedTurnCellsRef,
    initialSessionLimit,
    messagesRef,
    rememberCurrentSessionViewport,
    renderedTurnsRef,
    resetListInteractionState,
    resetSessionInteractionState,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setMessages,
    setQuestionRequests,
    setQuestionSubmitState,
    setRenderedTurns,
    setSessionId,
    setSessionStatusMap,
    visibleCellCountRef
  ]);

  return {
    sessionSwitchingTo,
    setSessionSwitchingTo,
    setActiveSession
  };
}

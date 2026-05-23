import { useCallback, useState } from 'react';
import type { SessionStatusInfo } from '../../types';

export function useSessionSwitchController<Cell extends { id: string }>(props: {
  initialSessionLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  displayedTurnCellsRef: React.MutableRefObject<Cell[]>;
  visibleCellCountRef: React.MutableRefObject<number>;
  messagesRef: React.MutableRefObject<any[]>;
  renderedTurnsRef: React.MutableRefObject<any[]>;
  sessionNextCursor: Record<string, string>;
  rememberCurrentSessionViewport: (targetSessionId: string, params: {
    displayedTurnCells: Cell[];
    visibleCellCount: number;
  }) => void;
  resetListInteractionState: () => void;
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
    const cachedRowsForNextSession = sid && Array.isArray(sessionRawMapRef.current[sid]) ? sessionRawMapRef.current[sid] : [];
    rememberCurrentSessionViewport(prevSid, {
      displayedTurnCells: displayedTurnCellsRef.current,
      visibleCellCount: visibleCellCountRef.current
    });
    resetListInteractionState();
    resetSessionInteractionState();
    setSessionSwitchingTo(sid && cachedRowsForNextSession.length === 0 ? sid : '');
    sessionIdRef.current = sid;
    setSessionId(sid);
    setQuestionRequests([]);
    setQuestionSubmitState({});
    if (!sid) {
      setSessionSwitchingTo('');
      messagesRef.current = [];
      renderedTurnsRef.current = [];
      setMessages([]);
      setRenderedTurns([]);
      setSessionStatusMap({});
      return;
    }
    if (cachedRowsForNextSession.length > 0) {
      const visibleCount = Math.max(initialSessionLimit, Number(sessionVisibleTurnCountRef.current[sid] || initialSessionLimit));
      applyTurnWindow(sid, visibleCount, sessionNextCursor[sid]);
      setSessionSwitchingTo('');
      return;
    }
    messagesRef.current = [];
    renderedTurnsRef.current = [];
    setMessages([]);
    setRenderedTurns([]);
  }, [
    applyTurnWindow,
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

import { useCallback, useState } from 'react';
import type { ChatViewportSnapshot } from './useChatListController';
import type { SessionStatusInfo } from '../../types';

export function useSessionSwitchController<Cell extends { id: string }>(props: {
  initialSessionLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionVisibleCellCountRef: React.MutableRefObject<Record<string, number>>;
  displayedTurnCellsRef: React.MutableRefObject<Cell[]>;
  visibleCellCountRef: React.MutableRefObject<number>;
  messagesRef: React.MutableRefObject<any[]>;
  renderedTurnsRef: React.MutableRefObject<any[]>;
  chatViewportSnapshotRef: React.MutableRefObject<Record<string, ChatViewportSnapshot>>;
  sessionNextCursor: Record<string, string>;
  rememberCurrentSessionViewport: (targetSessionId: string, params: {
    displayedTurnCells: Cell[];
    visibleCellCount: number;
  }) => void;
  resetListInteractionState: () => void;
  bumpCellWindowVersion: () => void;
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
    bumpCellWindowVersion,
    chatViewportSnapshotRef,
    displayedTurnCellsRef,
    initialSessionLimit,
    messagesRef,
    rememberCurrentSessionViewport,
    renderedTurnsRef,
    resetListInteractionState,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionVisibleCellCountRef,
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
    setSessionSwitchingTo(sid && cachedRowsForNextSession.length === 0 ? sid : '');
    if (sid) {
      const snapshot = chatViewportSnapshotRef.current[sid];
      if (snapshot?.visibleCellCount) {
        sessionVisibleCellCountRef.current[sid] = Math.max(initialSessionLimit, snapshot.visibleCellCount);
      } else if (!Number.isFinite(Number(sessionVisibleCellCountRef.current[sid]))) {
        sessionVisibleCellCountRef.current[sid] = 0;
      }
    }
    bumpCellWindowVersion();
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
    bumpCellWindowVersion,
    chatViewportSnapshotRef,
    displayedTurnCellsRef,
    initialSessionLimit,
    messagesRef,
    rememberCurrentSessionViewport,
    renderedTurnsRef,
    resetListInteractionState,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionVisibleCellCountRef,
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

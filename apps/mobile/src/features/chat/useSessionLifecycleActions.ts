import { useCallback } from 'react';
import { toText } from '../../lib/text';

export function useSessionLifecycleActions(params: {
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionOptimisticUserMapRef: React.MutableRefObject<Record<string, any[]>>;
  optimisticUserIdAliasRef: React.MutableRefObject<Record<string, Record<string, string>>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  renderRegressionRetryRef: React.MutableRefObject<Record<string, number>>;
  sessionMessageSyncRef: React.MutableRefObject<{ resetMessageSyncState: () => void } | null>;
  stopStream: () => void;
  resetOpenCodeStreamStores: () => void;
  bumpOptimisticVersion: () => void;
  setActiveSession: (sessionId: string) => void;
  setToken: (value: string) => void;
  setPairCode: (value: string) => void;
  setRepoPath: (value: string) => void;
  setProjects: (value: any[]) => void;
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setSessionNextCursor: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSessionHasMore: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSessionHistoryRetryHint: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setStartupSessionHydrating: (value: boolean) => void;
  setStatus: (value: string) => void;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
}) {
  const {
    bumpOptimisticVersion,
    optimisticUserIdAliasRef,
    pushConnLog,
    renderRegressionRetryRef,
    resetOpenCodeStreamStores,
    sessionIdRef,
    sessionMessageSyncRef,
    sessionOptimisticUserMapRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setActiveSession,
    setMessages,
    setPairCode,
    setProjects,
    setRenderedTurns,
    setRepoPath,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setStartupSessionHydrating,
    setStatus,
    setToken,
    stopStream
  } = params;

  const onNewSession = useCallback(() => {
    stopStream();
    const oldSid = toText(sessionIdRef.current).trim();
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    bumpOptimisticVersion();
    setSessionHistoryRetryHint((prev) => {
      if (!oldSid || !(oldSid in prev)) return prev;
      const next = { ...prev };
      delete next[oldSid];
      return next;
    });
    setSessionNextCursor((prev) => {
      const next = { ...prev };
      if (oldSid) delete next[oldSid];
      return next;
    });
    setSessionHasMore((prev) => {
      const next = { ...prev };
      if (oldSid) delete next[oldSid];
      return next;
    });
    if (oldSid) {
      const nextRaw = { ...sessionRawMapRef.current };
      delete nextRaw[oldSid];
      sessionRawMapRef.current = nextRaw;
    }
    setStatus('新会话已创建');
  }, [
    bumpOptimisticVersion,
    sessionIdRef,
    sessionRawMapRef,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setStatus,
    stopStream
  ]);

  const onResetAuth = useCallback(() => {
    stopStream();
    setToken('');
    setPairCode('');
    setRepoPath('');
    setProjects([]);
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    setSessionNextCursor({});
    setSessionHasMore({});
    setSessionHistoryRetryHint({});
    sessionRawMapRef.current = {};
    sessionOptimisticUserMapRef.current = {};
    optimisticUserIdAliasRef.current = {};
    resetOpenCodeStreamStores();
    sessionVisibleTurnCountRef.current = {};
    sessionTotalTurnCountRef.current = {};
    renderRegressionRetryRef.current = {};
    sessionMessageSyncRef.current?.resetMessageSyncState();
    bumpOptimisticVersion();
    setStartupSessionHydrating(false);
    setStatus('已退出授权');
    pushConnLog('reset auth');
  }, [
    bumpOptimisticVersion,
    optimisticUserIdAliasRef,
    pushConnLog,
    renderRegressionRetryRef,
    resetOpenCodeStreamStores,
    sessionMessageSyncRef,
    sessionOptimisticUserMapRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setActiveSession,
    setMessages,
    setPairCode,
    setProjects,
    setRenderedTurns,
    setRepoPath,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setStartupSessionHydrating,
    setStatus,
    setToken,
    stopStream
  ]);

  return {
    onNewSession,
    onResetAuth
  };
}

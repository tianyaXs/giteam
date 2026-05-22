import { useCallback } from 'react';
import { toText } from '../../lib/text';

type SessionItemLike = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

export function useProjectSwitchAction(params: {
  repoPath: string;
  sessionCacheRef: React.MutableRefObject<Record<string, SessionItemLike[]>>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionOptimisticUserMapRef: React.MutableRefObject<Record<string, any[]>>;
  optimisticUserIdAliasRef: React.MutableRefObject<Record<string, Record<string, string>>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  renderRegressionRetryRef: React.MutableRefObject<Record<string, number>>;
  sessionsRef: React.MutableRefObject<SessionItemLike[]>;
  sessionMessageSyncRef: React.MutableRefObject<{ resetMessageSyncState: () => void } | null>;
  stableSortSessionItems: (items: SessionItemLike[]) => SessionItemLike[];
  projectNameFromPath: (worktree: string) => string;
  stopStream: () => void;
  resetOpenCodeStreamStores: () => void;
  bumpOptimisticVersion: () => void;
  refreshModelCatalog: (targetRepoPath?: string) => Promise<void>;
  refreshSessionsFromServer: (targetRepoPath?: string) => Promise<SessionItemLike[]>;
  setStartupSessionHydrating: (value: boolean) => void;
  setRepoPath: (value: string) => void;
  setActiveSession: (sessionId: string) => void;
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionItemLike[]>>;
  setSessionNextCursor: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSessionHasMore: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSessionHistoryRetryHint: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setStatus: (value: string) => void;
}) {
  const {
    bumpOptimisticVersion,
    optimisticUserIdAliasRef,
    projectNameFromPath,
    refreshModelCatalog,
    refreshSessionsFromServer,
    renderRegressionRetryRef,
    repoPath,
    resetOpenCodeStreamStores,
    sessionCacheRef,
    sessionMessageSyncRef,
    sessionOptimisticUserMapRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    sessionsRef,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setRepoPath,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setSessions,
    setStartupSessionHydrating,
    setStatus,
    stableSortSessionItems,
    stopStream
  } = params;

  return useCallback(async (nextRepoPath: string) => {
    const next = toText(nextRepoPath).trim();
    if (!next) return;
    const current = toText(repoPath).trim();
    if (current === next) return;
    const cachedNextSessions = stableSortSessionItems(sessionCacheRef.current[next] || []);
    stopStream();
    setStartupSessionHydrating(false);
    sessionsRef.current = cachedNextSessions;
    setRepoPath(next);
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    setSessions(cachedNextSessions);
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
    setStatus(`已切换项目: ${projectNameFromPath(next)}`);
    await refreshModelCatalog(next);
    const nextSessions = await refreshSessionsFromServer(next);
    if (nextSessions.length > 0) {
      const latest = nextSessions[0];
      setActiveSession(latest.id);
    }
  }, [
    bumpOptimisticVersion,
    optimisticUserIdAliasRef,
    projectNameFromPath,
    refreshModelCatalog,
    refreshSessionsFromServer,
    renderRegressionRetryRef,
    repoPath,
    resetOpenCodeStreamStores,
    sessionCacheRef,
    sessionMessageSyncRef,
    sessionOptimisticUserMapRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    sessionsRef,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setRepoPath,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setSessions,
    setStartupSessionHydrating,
    setStatus,
    stableSortSessionItems,
    stopStream
  ]);
}

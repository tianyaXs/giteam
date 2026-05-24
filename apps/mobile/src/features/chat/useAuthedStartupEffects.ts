import { useEffect, useRef } from 'react';
import { markSessionSwitchPerfForSid } from './sessionSwitchPerf';

export function useAuthedStartupEffects(params: {
  authed: boolean;
  initialMessageFetchLimit: number;
  initialSessionLimit: number;
  loaded: boolean;
  projectsLength: number;
  refreshModelCatalog: () => Promise<void>;
  refreshProjectsCatalog: () => Promise<void>;
  refreshSessionsFromServer: () => Promise<any>;
  repoPath: string;
  serverUrl: string;
  sessionId: string;
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  guardHistoryLoad: (durationMs?: number) => void;
  setStartupSessionHydrating: (value: boolean) => void;
  syncSessionMessages: (
    targetSessionId: string,
    opts: { limit: number; fetchLimit: number }
  ) => Promise<any>;
  token: string;
}) {
  const {
    authed,
    guardHistoryLoad,
    initialMessageFetchLimit,
    initialSessionLimit,
    loaded,
    projectsLength,
    refreshModelCatalog,
    refreshProjectsCatalog,
    refreshSessionsFromServer,
    repoPath,
    serverUrl,
    sessionId,
    sessionIdRef,
    sessionRawMapRef,
    setStartupSessionHydrating,
    syncSessionMessages,
    token
  } = params;

  const actionsRef = useRef({
    refreshModelCatalog,
    refreshProjectsCatalog,
    refreshSessionsFromServer,
    setStartupSessionHydrating,
    syncSessionMessages
  });

  useEffect(() => {
    actionsRef.current = {
      refreshModelCatalog,
      refreshProjectsCatalog,
      refreshSessionsFromServer,
      setStartupSessionHydrating,
      syncSessionMessages
    };
  }, [
    refreshModelCatalog,
    refreshProjectsCatalog,
    refreshSessionsFromServer,
    setStartupSessionHydrating,
    syncSessionMessages
  ]);

  useEffect(() => {
    if (!loaded || !authed || !sessionId || !repoPath) return;
    const sid = sessionId;
    const cachedRows = Array.isArray(sessionRawMapRef.current[sid])
      ? sessionRawMapRef.current[sid].length
      : 0;
    guardHistoryLoad(cachedRows > 0 ? 1500 : 900);
    void (async () => {
      try {
        if (sessionIdRef.current !== sid) return;
        markSessionSwitchPerfForSid(sid, 'sync.startup_effect.begin', {
          cachedRows,
          deferred: cachedRows > 0 ? 1 : 0
        });
        const startedAt = performance.now();
        await actionsRef.current.syncSessionMessages(sid, {
          limit: initialSessionLimit,
          fetchLimit: initialMessageFetchLimit
        });
        if (sessionIdRef.current !== sid) return;
        markSessionSwitchPerfForSid(sid, 'sync.startup_effect.done', {
          ms: Math.round(performance.now() - startedAt),
          cachedRows
        });
      } finally {
        if (sessionIdRef.current === sid) {
          actionsRef.current.setStartupSessionHydrating(false);
        }
      }
    })();
  }, [
    authed,
    guardHistoryLoad,
    initialMessageFetchLimit,
    initialSessionLimit,
    loaded,
    repoPath,
    sessionId,
    sessionIdRef,
    sessionRawMapRef
  ]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath || sessionId) return;
    actionsRef.current.setStartupSessionHydrating(false);
  }, [authed, loaded, repoPath, sessionId]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath) return;
    void actionsRef.current.refreshModelCatalog();
  }, [authed, loaded, repoPath, serverUrl, token]);

  useEffect(() => {
    if (!loaded || !authed || !repoPath) return;
    void actionsRef.current.refreshSessionsFromServer();
  }, [authed, loaded, repoPath, serverUrl, token]);

  useEffect(() => {
    if (!loaded || !authed || !serverUrl || projectsLength > 0) return;
    void actionsRef.current.refreshProjectsCatalog();
  }, [authed, loaded, projectsLength, serverUrl, token]);
}

import { useEffect, useRef } from 'react';
import { markSessionSwitchPerfForSid } from './sessionSwitchPerf';

export function useAuthedStartupEffects(params: {
  authed: boolean;
  initialMessageFetchLimit: number;
  initialSessionLimit: number;
  loaded: boolean;
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
    if (!loaded || !authed || !serverUrl || !token) return;
    // 认证刚完成或 token 轮换后始终拉一次仓库列表。
    // 不能用 projectsLength>0 跳过：重连时可能留下旧 projects 但 repoPath 已被清空。
    void actionsRef.current.refreshProjectsCatalog();
  }, [authed, loaded, serverUrl, token]);
}

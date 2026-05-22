import { useEffect, useRef } from 'react';

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
  setStartupSessionHydrating: (value: boolean) => void;
  syncSessionMessages: (
    targetSessionId: string,
    opts: { limit: number; fetchLimit: number }
  ) => Promise<any>;
  token: string;
}) {
  const {
    authed,
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
    void (async () => {
      try {
        await actionsRef.current.syncSessionMessages(sessionId, {
          limit: initialSessionLimit,
          fetchLimit: initialMessageFetchLimit
        });
      } finally {
        actionsRef.current.setStartupSessionHydrating(false);
      }
    })();
  }, [authed, initialMessageFetchLimit, initialSessionLimit, loaded, repoPath, sessionId]);

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

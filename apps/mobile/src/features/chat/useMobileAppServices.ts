import { useCallback, useRef, type MutableRefObject } from "react";

type RefreshMessagesOptions = {
  limit?: number;
  fetchLimit?: number;
  before?: string;
  reason?: string;
};

type SyncSessionMessagesOptions = {
  limit?: number;
  fetchLimit?: number;
  loadingOlder?: boolean;
  before?: string;
  anchorStableKey?: string;
  forceVisibleCount?: number;
};

type RefreshProjectsCatalogOptions = {
  baseUrl?: string;
  token?: string;
  preferredRepoPath?: string;
};

type SessionMessageSyncHandle = {
  refreshMessages: (
    targetSessionId: string,
    opts?: RefreshMessagesOptions,
  ) => Promise<any>;
  syncSessionMessages: (
    targetSessionId: string,
    opts?: SyncSessionMessagesOptions,
  ) => Promise<any>;
  onLoadOlderMessages: () => Promise<void>;
};

type SessionRecoveryHandle = {
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
};

type StreamManagerHandle = {
  startStream: (targetSessionId: string) => void;
  stopStream: () => void;
};

type WorkspaceCatalogHandle = {
  refreshInstalledExtensions: () => Promise<void>;
  refreshSessionsFromServer: (targetRepoPath?: string) => Promise<any>;
  refreshModelCatalog: (targetRepoPath?: string) => Promise<void>;
  refreshProjectsCatalog: (
    opts?: RefreshProjectsCatalogOptions,
  ) => Promise<void>;
};

export function useMobileAppServices(params: {
  sessionMessageSyncRef: MutableRefObject<SessionMessageSyncHandle | null>;
  sessionRecoveryRef: MutableRefObject<SessionRecoveryHandle | null>;
}) {
  const { sessionMessageSyncRef, sessionRecoveryRef } = params;
  const streamManagerHandleRef = useRef<StreamManagerHandle | null>(null);
  const workspaceCatalogHandleRef = useRef<WorkspaceCatalogHandle | null>(null);

  const startStream = useCallback((targetSessionId: string) => {
    streamManagerHandleRef.current?.startStream(targetSessionId);
  }, []);

  const stopStream = useCallback(() => {
    streamManagerHandleRef.current?.stopStream();
  }, []);

  const syncSessionStatus = useCallback(
    async (targetSessionId?: string) =>
      await sessionRecoveryRef.current?.syncSessionStatus(targetSessionId),
    [sessionRecoveryRef],
  );

  const refreshInstalledExtensions = useCallback(async () => {
    await workspaceCatalogHandleRef.current?.refreshInstalledExtensions();
  }, []);

  const refreshSessionsFromServer = useCallback(
    async (targetRepoPath?: string) =>
      await workspaceCatalogHandleRef.current?.refreshSessionsFromServer(
        targetRepoPath,
      ),
    [],
  );

  const refreshMessages = useCallback(
    async (targetSessionId: string, opts?: RefreshMessagesOptions) =>
      await sessionMessageSyncRef.current?.refreshMessages(
        targetSessionId,
        opts,
      ),
    [sessionMessageSyncRef],
  );

  const syncSessionMessages = useCallback(
    async (targetSessionId: string, opts?: SyncSessionMessagesOptions) =>
      await sessionMessageSyncRef.current?.syncSessionMessages(
        targetSessionId,
        opts,
      ),
    [sessionMessageSyncRef],
  );

  const onLoadOlderMessages = useCallback(
    async () => await sessionMessageSyncRef.current?.onLoadOlderMessages(),
    [sessionMessageSyncRef],
  );

  const refreshModelCatalog = useCallback(
    async (targetRepoPath?: string) =>
      await workspaceCatalogHandleRef.current?.refreshModelCatalog(
        targetRepoPath,
      ),
    [],
  );

  const refreshProjectsCatalog = useCallback(
    async (opts?: RefreshProjectsCatalogOptions) =>
      await workspaceCatalogHandleRef.current?.refreshProjectsCatalog(opts),
    [],
  );

  return {
    streamManagerHandleRef,
    workspaceCatalogHandleRef,
    startStream,
    stopStream,
    syncSessionStatus,
    refreshInstalledExtensions,
    refreshSessionsFromServer,
    refreshMessages,
    syncSessionMessages,
    onLoadOlderMessages,
    refreshModelCatalog,
    refreshProjectsCatalog,
  };
}

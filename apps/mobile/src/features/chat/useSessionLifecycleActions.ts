import { useCallback } from 'react';
import { createMobileAgentClient } from '../../api/agent/client';
import { NO_AUTH_TOKEN, revokeCloudAccess } from '../../api/controlApi';
import {
  clearCloudConnectionExtras,
  getConnectionMode,
  setActiveAccessKey,
  setActiveDeviceId
} from '../../api/connectionContext';
import { normalizeWorkspacePath } from '../../lib/path';
import { toText } from '../../lib/text';

type SessionItemLike = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

export function useSessionLifecycleActions(params: {
  serverUrl: string;
  token: string;
  repoPath: string;
  sessions: SessionItemLike[];
  sessionIdRef: React.MutableRefObject<string>;
  sessionCacheRef: React.MutableRefObject<Record<string, SessionItemLike[]>>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionOptimisticUserMapRef: React.MutableRefObject<Record<string, any[]>>;
  optimisticUserIdAliasRef: React.MutableRefObject<Record<string, Record<string, string>>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  renderRegressionRetryRef: React.MutableRefObject<Record<string, number>>;
  sessionMessageSyncRef: React.MutableRefObject<{
    resetMessageSyncState: () => void;
    syncSessionMessages?: (sessionId: string, opts?: { limit?: number; fetchLimit?: number }) => Promise<any>;
  } | null>;
  stopStream: () => void;
  resetAgentStreamStores: () => void;
  bumpOptimisticVersion: () => void;
  setActiveSession: (sessionId: string) => void;
  setToken: (value: string) => void;
  setPairCode: (value: string) => void;
  setDeviceId?: (value: string) => void;
  setAccessKey?: (value: string) => void;
  setRepoPath: (value: string) => void;
  setProjects: (value: any[]) => void;
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionItemLike[]>>;
  setSessionNextCursor: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSessionHasMore: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSessionHistoryRetryHint: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setStartupSessionHydrating: (value: boolean) => void;
  setModelCatalogStatus?: (value: 'idle' | 'loading' | 'ready' | 'error') => void;
  setModelOptions?: (value: any[]) => void;
  setStatus: (value: string) => void;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
}) {
  const {
    bumpOptimisticVersion,
    optimisticUserIdAliasRef,
    pushConnLog,
    renderRegressionRetryRef,
    repoPath,
    resetAgentStreamStores,
    serverUrl,
    sessionCacheRef,
    sessionIdRef,
    sessionMessageSyncRef,
    sessionOptimisticUserMapRef,
    sessionRawMapRef,
    sessions,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setAccessKey,
    setActiveSession,
    setMessages,
    setModelCatalogStatus,
    setModelOptions,
    setPairCode,
    setDeviceId,
    setProjects,
    setRenderedTurns,
    setRepoPath,
    setSessions,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setStartupSessionHydrating,
    setStatus,
    setToken,
    stopStream,
    token
  } = params;

  const clearSessionLocalState = useCallback(
    (oldSid: string) => {
      if (!oldSid) return;
      setSessionHistoryRetryHint((prev) => {
        if (!(oldSid in prev)) return prev;
        const next = { ...prev };
        delete next[oldSid];
        return next;
      });
      setSessionNextCursor((prev) => {
        if (!(oldSid in prev)) return prev;
        const next = { ...prev };
        delete next[oldSid];
        return next;
      });
      setSessionHasMore((prev) => {
        if (!(oldSid in prev)) return prev;
        const next = { ...prev };
        delete next[oldSid];
        return next;
      });
      if (sessionRawMapRef.current[oldSid]) {
        const nextRaw = { ...sessionRawMapRef.current };
        delete nextRaw[oldSid];
        sessionRawMapRef.current = nextRaw;
      }
      if (sessionOptimisticUserMapRef.current[oldSid]) {
        const nextOpt = { ...sessionOptimisticUserMapRef.current };
        delete nextOpt[oldSid];
        sessionOptimisticUserMapRef.current = nextOpt;
      }
      if (optimisticUserIdAliasRef.current[oldSid]) {
        const nextAlias = { ...optimisticUserIdAliasRef.current };
        delete nextAlias[oldSid];
        optimisticUserIdAliasRef.current = nextAlias;
      }
      if (sessionVisibleTurnCountRef.current[oldSid] != null) {
        const nextVisible = { ...sessionVisibleTurnCountRef.current };
        delete nextVisible[oldSid];
        sessionVisibleTurnCountRef.current = nextVisible;
      }
      if (sessionTotalTurnCountRef.current[oldSid] != null) {
        const nextTotal = { ...sessionTotalTurnCountRef.current };
        delete nextTotal[oldSid];
        sessionTotalTurnCountRef.current = nextTotal;
      }
    },
    [
      optimisticUserIdAliasRef,
      sessionOptimisticUserMapRef,
      sessionRawMapRef,
      sessionTotalTurnCountRef,
      sessionVisibleTurnCountRef,
      setSessionHasMore,
      setSessionHistoryRetryHint,
      setSessionNextCursor
    ]
  );

  const onNewSession = useCallback(() => {
    stopStream();
    const oldSid = toText(sessionIdRef.current).trim();
    setActiveSession('');
    setMessages([]);
    setRenderedTurns([]);
    bumpOptimisticVersion();
    clearSessionLocalState(oldSid);
    setStatus('新会话已创建');
  }, [
    bumpOptimisticVersion,
    clearSessionLocalState,
    sessionIdRef,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setStatus,
    stopStream
  ]);

  /** 对齐桌面归档：本地先移除，再 DELETE session；当前会话则切到邻居或空白新会话。 */
  const onArchiveSession = useCallback(
    async (sessionId: string, worktree: string) => {
      const id = toText(sessionId).trim();
      if (!id) return;
      const wtKey =
        normalizeWorkspacePath(worktree) ||
        normalizeWorkspacePath(repoPath) ||
        '';
      const currentKey = normalizeWorkspacePath(repoPath);
      const sessionsSnapshot = sessions;
      const cacheSnapshot = { ...sessionCacheRef.current };
      const prevList = wtKey
        ? cacheSnapshot[wtKey] || (wtKey === currentKey ? sessions : [])
        : sessions;
      const idx = prevList.findIndex((s) => s.id === id);
      const nextList = prevList.filter((s) => s.id !== id);
      const fallback = nextList[Math.max(0, idx - 1)] ?? nextList[0] ?? null;
      const wasActive = toText(sessionIdRef.current).trim() === id;

      if (wtKey) {
        sessionCacheRef.current = { ...sessionCacheRef.current, [wtKey]: nextList };
      }
      if (!wtKey || wtKey === currentKey) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
      } else {
        // 非当前项目只改 cache，需轻推 sessions 触发抽屉重算
        setSessions((prev) => prev.slice());
      }

      if (wasActive) {
        stopStream();
        clearSessionLocalState(id);
        bumpOptimisticVersion();
        if (fallback) {
          setActiveSession(fallback.id);
          void sessionMessageSyncRef.current
            ?.syncSessionMessages?.(fallback.id)
            ?.catch(() => undefined);
        } else {
          setActiveSession('');
          setMessages([]);
          setRenderedTurns([]);
        }
      } else {
        clearSessionLocalState(id);
      }

      try {
        await createMobileAgentClient({ baseUrl: serverUrl, token }).deleteSession(id);
        pushConnLog(`session.archive ok ${id}`);
        setStatus('会话已归档');
      } catch (e) {
        pushConnLog(`session.archive error ${id} ${String(e)}`, 'error');
        sessionCacheRef.current = cacheSnapshot;
        setSessions(sessionsSnapshot);
        if (wasActive) {
          setActiveSession(id);
        }
        setStatus('归档失败');
      }
    },
    [
      bumpOptimisticVersion,
      clearSessionLocalState,
      pushConnLog,
      repoPath,
      serverUrl,
      sessionCacheRef,
      sessionIdRef,
      sessionMessageSyncRef,
      sessions,
      setActiveSession,
      setMessages,
      setRenderedTurns,
      setSessions,
      setStatus,
      stopStream,
      token
    ]
  );

  const onResetAuth = useCallback(async (statusText?: string) => {
    // 云端模式先吊销 JWT，否则桌面端 list_clients 会在 90s TTL 内仍显示「手机已连接」。
    const base = toText(serverUrl).trim();
    const tk = toText(token).trim();
    if (getConnectionMode() === 'cloud' && base && tk && tk !== NO_AUTH_TOKEN) {
      try {
        await revokeCloudAccess({ cloudBaseUrl: base, token: tk });
        pushConnLog('cloud revoke ok');
      } catch (e) {
        pushConnLog(`cloud revoke warn ${String(e)}`, 'info');
      }
    }
    stopStream();
    setToken('');
    setPairCode('');
    setDeviceId?.('');
    setAccessKey?.('');
    setActiveDeviceId('');
    setActiveAccessKey('');
    clearCloudConnectionExtras();
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
    resetAgentStreamStores();
    sessionVisibleTurnCountRef.current = {};
    sessionTotalTurnCountRef.current = {};
    renderRegressionRetryRef.current = {};
    sessionMessageSyncRef.current?.resetMessageSyncState();
    bumpOptimisticVersion();
    setStartupSessionHydrating(false);
    setModelCatalogStatus?.('idle');
    setModelOptions?.([]);
    setStatus(toText(statusText).trim() || '已退出授权');
    pushConnLog(`reset auth reason=${toText(statusText).trim() || 'manual'}`);
  }, [
    bumpOptimisticVersion,
    optimisticUserIdAliasRef,
    pushConnLog,
    renderRegressionRetryRef,
    resetAgentStreamStores,
    serverUrl,
    sessionMessageSyncRef,
    sessionOptimisticUserMapRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setAccessKey,
    setActiveSession,
    setDeviceId,
    setMessages,
    setModelCatalogStatus,
    setModelOptions,
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
    stopStream,
    token
  ]);

  return {
    onNewSession,
    onArchiveSession,
    onResetAuth
  };
}

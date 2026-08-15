import { useCallback } from 'react';
import { NO_AUTH_TOKEN, revokeCloudAccess } from '../../api/controlApi';
import {
  clearCloudConnectionExtras,
  getConnectionMode,
  setActiveAccessKey,
  setActiveDeviceId
} from '../../api/connectionContext';
import { toText } from '../../lib/text';

export function useSessionLifecycleActions(params: {
  serverUrl: string;
  token: string;
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionOptimisticUserMapRef: React.MutableRefObject<Record<string, any[]>>;
  optimisticUserIdAliasRef: React.MutableRefObject<Record<string, Record<string, string>>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  renderRegressionRetryRef: React.MutableRefObject<Record<string, number>>;
  sessionMessageSyncRef: React.MutableRefObject<{ resetMessageSyncState: () => void } | null>;
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
    resetAgentStreamStores,
    serverUrl,
    sessionIdRef,
    sessionMessageSyncRef,
    sessionOptimisticUserMapRef,
    sessionRawMapRef,
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
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setStartupSessionHydrating,
    setStatus,
    setToken,
    stopStream,
    token
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
    onResetAuth
  };
}

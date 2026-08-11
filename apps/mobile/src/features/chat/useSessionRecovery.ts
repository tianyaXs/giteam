import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { createMobileAgentClient } from '../../api/agent/client';
import { toText } from '../../lib/text';
import type { SessionStatusInfo } from '../../types';

export function useSessionRecovery(params: {
  authed: boolean;
  busy: boolean;
  repoPath: string;
  serverUrl: string;
  token: string;
  streaming: boolean;
  initialSessionLimit: number;
  initialMessageFetchLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  appStateRef: React.MutableRefObject<string>;
  busySinceRef: React.MutableRefObject<number>;
  pendingPromptSessionRef: React.MutableRefObject<Record<string, { id: string; startedAt: number }>>;
  sessionStatusEpochRef: React.MutableRefObject<number>;
  setBusy: (value: boolean) => void;
  setStatus: (value: string) => void;
  setStreaming: (value: boolean) => void;
  setSessionStatusMap: React.Dispatch<React.SetStateAction<Record<string, SessionStatusInfo>>>;
  startStream: (targetSessionId: string) => void;
  syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number }) => Promise<any>;
}) {
  const {
    appStateRef,
    authed,
    busy,
    busySinceRef,
    initialMessageFetchLimit,
    initialSessionLimit,
    pendingPromptSessionRef,
    repoPath,
    serverUrl,
    sessionIdRef,
    sessionStatusEpochRef,
    setBusy,
    setSessionStatusMap,
    setStatus,
    setStreaming,
    startStream,
    streaming,
    syncSessionMessages,
    token
  } = params;

  const syncSessionStatus = useCallback(async (targetSessionId?: string) => {
    const sid = toText(targetSessionId || sessionIdRef.current).trim();
    if (!authed || !serverUrl || !repoPath) return undefined;
    const epoch = sessionStatusEpochRef.current;
    try {
      // pi_agent 无全量状态端点：以待裁决交互推断 waitingForInput，
      // 运行中状态由 SSE session.status 事件驱动写入本地 map。
      const client = createMobileAgentClient({ baseUrl: serverUrl, token });
      const interactions = sid ? await client.listInteractions(sid).catch(() => []) : [];
      if (epoch !== sessionStatusEpochRef.current) return undefined;
      const next: SessionStatusInfo = interactions.length > 0 ? { type: 'busy' } : { type: 'idle' };
      if (sid) {
        setSessionStatusMap((prev) => ({ ...prev, [sid]: prev[sid]?.type === 'busy' && interactions.length === 0 ? prev[sid] : next }));
      }
      if (!sid) return undefined;
      return next;
    } catch {
      return undefined;
    }
  }, [authed, repoPath, serverUrl, sessionIdRef, sessionStatusEpochRef, setSessionStatusMap, token]);

  useEffect(() => {
    busySinceRef.current = busy ? Date.now() : 0;
  }, [busy, busySinceRef]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      if (!prevState.match(/inactive|background/) || nextState !== 'active') return;
      const sid = toText(sessionIdRef.current).trim();
      if (!sid || !authed || !repoPath) {
        setBusy(false);
        return;
      }
      const pending = pendingPromptSessionRef.current[sid];
      const busyForMs = busySinceRef.current ? Date.now() - busySinceRef.current : 0;
      // 勿在恢复时过早清 pending：prompt 会阻塞到整轮结束，长工具/子 agent 常超过 15s。
      if (busyForMs > 8000 || pending || streaming) {
        setStatus('正在恢复会话状态...');
        setBusy(false);
        void syncSessionMessages(sid, {
          limit: initialSessionLimit,
          fetchLimit: initialMessageFetchLimit
        });
        void syncSessionStatus(sid).then((info) => {
          if (info?.type === 'busy') {
            setStatus('服务端仍在处理，正在接回流式输出...');
            startStream(sid);
          } else {
            setStreaming(false);
            setStatus('会话已恢复');
          }
        });
      }
    });
    return () => sub.remove();
  }, [
    appStateRef,
    authed,
    busySinceRef,
    initialMessageFetchLimit,
    initialSessionLimit,
    pendingPromptSessionRef,
    repoPath,
    sessionIdRef,
    setBusy,
    setStatus,
    setStreaming,
    startStream,
    streaming,
    syncSessionMessages,
    syncSessionStatus
  ]);

  return {
    syncSessionStatus
  };
}

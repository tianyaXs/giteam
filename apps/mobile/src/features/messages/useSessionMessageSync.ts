import { useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { getMessages } from '../../api/controlApi';
import { toText } from '../../lib/text';
import type { MobileRenderedTurn, SessionStatusInfo } from '../../types';
import { computeVisibleTurnCount, fetchWithRetry } from './history';
import { inspectTurnWindow, mergeMessageRows } from './turns';

export type RefreshMessagesResult = {
  nextCursor: string;
  incomingCount: number;
  mergedCount: number;
  prevMergedCount: number;
  totalTurnCount: number;
};

type SyncOptions = {
  limit?: number;
  fetchLimit?: number;
  loadingOlder?: boolean;
  before?: string;
  anchorStableKey?: string;
  forceVisibleCount?: number;
};

function formatRetryDelay(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `${seconds}s 后可重试`;
}

export function useSessionMessageSync<Cell>(params: {
  authed: boolean;
  serverUrl: string;
  token: string;
  repoPath: string;
  sessionId: string;
  initialSessionLimit: number;
  olderSessionLimit: number;
  olderMessageFetchLimit: number;
  olderCellLimit: number;
  sessionIdRef: MutableRefObject<string>;
  pendingPromptSessionRef: MutableRefObject<Record<string, { id: string; startedAt: number }>>;
  sessionRawMapRef: MutableRefObject<Record<string, any[]>>;
  sessionVisibleTurnCountRef: MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: MutableRefObject<Record<string, number>>;
  sessionVisibleCellCountRef: MutableRefObject<Record<string, number>>;
  displayedTurnCellsRef: MutableRefObject<Cell[]>;
  visibleCellCountRef: MutableRefObject<number>;
  renderedTurnsRef: MutableRefObject<MobileRenderedTurn[]>;
  sessionNextCursor: Record<string, string>;
  loadingOlder: boolean;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
  setStatus: (value: string | ((prev: string) => string)) => void;
  setSessionNextCursor: Dispatch<SetStateAction<Record<string, string>>>;
  setSessionHasMore: Dispatch<SetStateAction<Record<string, boolean>>>;
  setSessionHistoryRetryHint: Dispatch<SetStateAction<Record<string, string>>>;
  setLoadingOlder: Dispatch<SetStateAction<boolean>>;
  setStreaming: Dispatch<SetStateAction<boolean>>;
  setSessionSwitchingTo: Dispatch<SetStateAction<string>>;
  ingestStreamRows: (targetSessionId: string, rows: any[]) => any[];
  recordStreamMessageRoles: (targetSessionId: string, rows: any[]) => void;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => any;
  syncSessionStatus: (targetSessionId?: string) => Promise<SessionStatusInfo | undefined>;
  rememberCurrentSessionViewport: (sessionId: string, snapshot: { displayedTurnCells: Cell[]; visibleCellCount: number }) => void;
  flattenTurnsForList: (turns: MobileRenderedTurn[]) => Cell[];
  getInitialVisibleCellLimit: (cells: Cell[]) => number;
  bumpCellWindowVersion: () => void;
  streamDebug?: (label: string, payload?: Record<string, unknown>) => void;
}) {
  const {
    applyTurnWindow,
    authed,
    bumpCellWindowVersion,
    displayedTurnCellsRef,
    flattenTurnsForList,
    getInitialVisibleCellLimit,
    ingestStreamRows,
    initialSessionLimit,
    loadingOlder,
    olderCellLimit,
    olderMessageFetchLimit,
    olderSessionLimit,
    pendingPromptSessionRef,
    pushConnLog,
    recordStreamMessageRoles,
    rememberCurrentSessionViewport,
    renderedTurnsRef,
    repoPath,
    serverUrl,
    sessionId,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleCellCountRef,
    sessionVisibleTurnCountRef,
    setLoadingOlder,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setSessionSwitchingTo,
    setStatus,
    setStreaming,
    streamDebug,
    syncSessionStatus,
    token,
    visibleCellCountRef
  } = params;

  const inflightMessageReqRef = useRef<Record<string, Promise<RefreshMessagesResult | undefined>>>({});
  const inflightSessionSyncRef = useRef<Record<string, Promise<any>>>({});
  const olderCursorBackoffRef = useRef<Record<string, { cursor: string; retryAt: number; failures: number }>>({});

  return useMemo(() => {
    const getOlderCursorBackoff = (sessionKey: string, cursor: string): { retryAt: number; failures: number } | null => {
      const current = olderCursorBackoffRef.current[sessionKey];
      if (!current) return null;
      if (current.cursor !== cursor) return null;
      if (current.retryAt <= Date.now()) return null;
      return { retryAt: current.retryAt, failures: current.failures };
    };

    const clearOlderCursorBackoff = (sessionKey: string, cursor?: string) => {
      const current = olderCursorBackoffRef.current[sessionKey];
      if (!current) return;
      if (cursor && current.cursor !== cursor) return;
      delete olderCursorBackoffRef.current[sessionKey];
      setSessionHistoryRetryHint((prev) => {
        if (!(sessionKey in prev)) return prev;
        const next = { ...prev };
        delete next[sessionKey];
        return next;
      });
    };

    const markOlderCursorFailure = (sessionKey: string, cursor: string, error: unknown) => {
      if (!cursor) return;
      const current = olderCursorBackoffRef.current[sessionKey];
      const failures = current && current.cursor === cursor ? current.failures + 1 : 1;
      const delayMs = Math.min(15000, 3000 * Math.max(1, failures));
      olderCursorBackoffRef.current[sessionKey] = {
        cursor,
        failures,
        retryAt: Date.now() + delayMs
      };
      setSessionHistoryRetryHint((prev) => ({
        ...prev,
        [sessionKey]: `历史加载失败，${formatRetryDelay(delayMs)}`
      }));
      pushConnLog(`GET messages backoff sid=${sessionKey} failures=${failures} delay=${delayMs} cursor=1 cause=${String(error)}`, 'error');
    };

    const refreshMessages = async (
      targetSessionId: string,
      opts?: {
        limit?: number;
        fetchLimit?: number;
        before?: string;
        reason?: string;
      }
    ): Promise<RefreshMessagesResult | undefined> => {
      if (!authed || !repoPath || !targetSessionId) return;
      const requestedLimit = Math.max(2, Number(opts?.limit || initialSessionLimit));
      const fetchLimit = Math.max(requestedLimit, Number(opts?.fetchLimit || 0));
      const before = toText(opts?.before).trim();
      const reqKey = `${targetSessionId}|${fetchLimit}|${before || '-'}`;
      const existing = inflightMessageReqRef.current[reqKey];
      if (existing) return await existing;

      const run = (async () => {
        try {
          pushConnLog(`GET messages sid=${targetSessionId} limit=${fetchLimit}${before ? ' before=cursor' : ''}${opts?.reason ? ` reason=${opts.reason}` : ''}`);
          const res = await fetchWithRetry({
            fetchLimit,
            hasBeforeCursor: !!before,
            fetchPage: (limit) =>
              getMessages({
                baseUrl: serverUrl,
                token,
                repoPath,
                sessionId: targetSessionId,
                limit,
                before: before || undefined
              }),
            onRetry: ({ limit, error }) => {
              pushConnLog(`GET messages retry sid=${targetSessionId} limit=${limit}${before ? ' before=cursor' : ''} cause=${String(error)}`, 'error');
            }
          });

          const incoming = Array.isArray(res.items) ? res.items : [];
          if (targetSessionId !== sessionIdRef.current) return;
          if (!before && pendingPromptSessionRef.current[targetSessionId]) {
            pushConnLog(`GET messages skip sid=${targetSessionId} reason=pending prompt`);
            return;
          }
          const prevRaw = sessionRawMapRef.current[targetSessionId] || [];
          const merged = before ? mergeMessageRows(prevRaw, incoming) : ingestStreamRows(targetSessionId, incoming);
          if (before) {
            sessionRawMapRef.current[targetSessionId] = merged;
            ingestStreamRows(targetSessionId, merged);
          }
          recordStreamMessageRoles(targetSessionId, merged);
          const turnInfo = inspectTurnWindow(merged);
          const nextCursor = toText(res.nextCursor).trim();
          pushConnLog(`GET messages ok sid=${targetSessionId} rows=${incoming.length} merged=${merged.length} turns=${turnInfo.totalTurnCount} next=${nextCursor ? 1 : 0}`);
          if (before) clearOlderCursorBackoff(targetSessionId, before);
          setSessionNextCursor((prev) => ({ ...prev, [targetSessionId]: nextCursor }));
          return {
            nextCursor,
            incomingCount: incoming.length,
            mergedCount: merged.length,
            prevMergedCount: prevRaw.length,
            totalTurnCount: turnInfo.totalTurnCount
          };
        } catch (e) {
          if (before && opts?.reason === 'loadingOlder') markOlderCursorFailure(targetSessionId, before, e);
          pushConnLog(`GET messages error ${String(e)}`, 'error');
          setStatus(String(e));
          return undefined;
        }
      })();
      inflightMessageReqRef.current[reqKey] = run;
      try {
        return await run;
      } finally {
        if (inflightMessageReqRef.current[reqKey] === run) delete inflightMessageReqRef.current[reqKey];
      }
    };

    const syncSessionMessages = async (targetSessionId: string, opts?: SyncOptions) => {
      const before = toText(opts?.before).trim();
      const mode = opts?.loadingOlder ? 'loadingOlder' : 'default';
      const syncKey = `${targetSessionId}|${mode}|${before || '-'}`;
      const existing = inflightSessionSyncRef.current[syncKey];
      if (existing) return await existing;

      const run = (async () => {
        const requestedVisibleTurnCount = Math.max(1, Number(opts?.limit || initialSessionLimit));
        const prevVisibleTurnCount = Math.max(0, Number(sessionVisibleTurnCountRef.current[targetSessionId] || 0));
        const statusPromise = syncSessionStatus(targetSessionId);
        try {
          const res = await refreshMessages(targetSessionId, {
            limit: requestedVisibleTurnCount,
            fetchLimit: opts?.fetchLimit,
            before,
            reason: mode
          });
          if (!res || targetSessionId !== sessionIdRef.current) return undefined;
          streamDebug?.('sync.messages.result', {
            sid: targetSessionId,
            mergedCount: res.mergedCount,
            prevMergedCount: res.prevMergedCount,
            totalTurnCount: res.totalTurnCount,
            status: 'pending'
          });

          const nextVisibleTurnCount = computeVisibleTurnCount({
            prevVisibleTurnCount,
            totalTurnCount: res.totalTurnCount,
            requestedVisibleTurnCount,
            initialTurnLimit: initialSessionLimit,
            olderTurnLimit: olderSessionLimit,
            mode,
            forceVisibleTurnCount: opts?.forceVisibleCount,
            userAtTop: false,
            hasNewHistoryFromCursor: !!before && res.mergedCount > res.prevMergedCount
          });
          const rendered = applyTurnWindow(targetSessionId, nextVisibleTurnCount, res.nextCursor);
          if (targetSessionId === sessionIdRef.current) {
            setSessionSwitchingTo((prev) => (prev === targetSessionId ? '' : prev));
          }
          const statusInfo = await statusPromise;
          const last = rendered.renderedTurns[rendered.renderedTurns.length - 1];
          streamDebug?.('sync.rendered', {
            sid: targetSessionId,
            turns: rendered.renderedTurns.length,
            writing: rendered.writing,
            lastTurn: last?.id,
            lastItems: last?.items?.map((item: any) => item.kind).join(',') || ''
          });

          const latestTurnHasError = (() => {
            const lastTurn = rendered.renderedTurns[rendered.renderedTurns.length - 1];
            if (!lastTurn) return false;
            return lastTurn.items.some((item: any) => item.kind === 'error');
          })();
          const statusIdle = !statusInfo || statusInfo.type === 'idle';
          if ((!rendered.writing && statusIdle) || latestTurnHasError) {
            setStreaming(false);
            setStatus((prev) => (toText(prev).includes('流式响应中') ? '' : prev));
          }
          return rendered;
        } finally {
          if (!opts?.loadingOlder && targetSessionId === sessionIdRef.current) {
            setSessionSwitchingTo((prev) => (prev === targetSessionId ? '' : prev));
          }
          if (opts?.loadingOlder) setLoadingOlder(false);
        }
      })();
      inflightSessionSyncRef.current[syncKey] = run;
      try {
        return await run;
      } finally {
        if (inflightSessionSyncRef.current[syncKey] === run) delete inflightSessionSyncRef.current[syncKey];
      }
    };

    const onLoadOlderMessages = async () => {
      const sid = toText(sessionId).trim();
      if (!sid || loadingOlder) return;
      rememberCurrentSessionViewport(sid, {
        displayedTurnCells: displayedTurnCellsRef.current,
        visibleCellCount: visibleCellCountRef.current
      });
      const flattenedCells = flattenTurnsForList(renderedTurnsRef.current);
      const totalCells = flattenedCells.length;
      const seededVisibleCells = getInitialVisibleCellLimit(flattenedCells);
      const visibleCells = Math.max(seededVisibleCells, Number(sessionVisibleCellCountRef.current[sid] || 0));
      if (totalCells > visibleCells) {
        sessionVisibleCellCountRef.current[sid] = Math.min(totalCells, visibleCells + olderCellLimit);
        bumpCellWindowVersion();
        setSessionHasMore((prev) => ({ ...prev, [sid]: totalCells > sessionVisibleCellCountRef.current[sid] }));
        return;
      }
      const cached = Math.max(0, Number(sessionTotalTurnCountRef.current[sid] || 0));
      const visible = Math.max(0, Number(sessionVisibleTurnCountRef.current[sid] || 0));
      if (cached > visible) {
        applyTurnWindow(sid, Math.min(cached, visible + olderSessionLimit));
        return;
      }
      const cursor = toText(sessionNextCursor[sid]).trim();
      const backoff = cursor ? getOlderCursorBackoff(sid, cursor) : null;
      if (backoff) {
        setSessionHistoryRetryHint((prev) => ({
          ...prev,
          [sid]: `历史加载失败，${formatRetryDelay(backoff.retryAt - Date.now())}`
        }));
        return;
      }
      setLoadingOlder(true);
      if (cursor) {
        await syncSessionMessages(sid, {
          limit: olderSessionLimit,
          fetchLimit: olderMessageFetchLimit,
          before: cursor,
          loadingOlder: true
        });
      } else {
        setSessionHasMore((prev) => ({ ...prev, [sid]: cached > visible }));
        setLoadingOlder(false);
      }
    };

    const resetMessageSyncState = () => {
      inflightMessageReqRef.current = {};
      inflightSessionSyncRef.current = {};
      olderCursorBackoffRef.current = {};
    };

    return {
      refreshMessages,
      syncSessionMessages,
      onLoadOlderMessages,
      resetMessageSyncState
    };
  }, [
    applyTurnWindow,
    authed,
    bumpCellWindowVersion,
    displayedTurnCellsRef,
    flattenTurnsForList,
    getInitialVisibleCellLimit,
    ingestStreamRows,
    initialSessionLimit,
    loadingOlder,
    olderCellLimit,
    olderMessageFetchLimit,
    olderSessionLimit,
    pendingPromptSessionRef,
    pushConnLog,
    recordStreamMessageRoles,
    rememberCurrentSessionViewport,
    renderedTurnsRef,
    repoPath,
    serverUrl,
    sessionId,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleCellCountRef,
    sessionVisibleTurnCountRef,
    setLoadingOlder,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setSessionSwitchingTo,
    setStatus,
    setStreaming,
    streamDebug,
    syncSessionStatus,
    token,
    visibleCellCountRef
  ]);
}

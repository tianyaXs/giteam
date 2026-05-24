import { useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { markSessionSwitchPerfForSid } from '../chat/sessionSwitchPerf';
import { markMessageSendPerfForSession } from './messageSendPerf';
import { getMessages } from '../../api/controlApi';
import { toText } from '../../lib/text';
import { loadChatSnapshot } from '../../storage/chatSnapshot';
import type { SessionStatusInfo } from '../../types';
import { computeVisibleTurnCount, fetchWithRetry } from './history';
import { inspectTurnWindow, mergeMessageRows, rowId } from './turns';

export type RefreshMessagesResult = {
  nextCursor: string;
  incomingCount: number;
  mergedCount: number;
  prevMergedCount: number;
  totalTurnCount: number;
  incomingIds: string[];
};

type SyncOptions = {
  limit?: number;
  fetchLimit?: number;
  loadingOlder?: boolean;
  before?: string;
  anchorStableKey?: string;
  forceVisibleCount?: number;
  /** 仅拉取并合并最新消息，不触发全量 hydrate */
  tailOnly?: boolean;
};

function formatRetryDelay(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `${seconds}s 后可重试`;
}

const HISTORY_LOAD_SETTLE_MS = 650;
const HISTORY_TURN_BOUNDARY_SCAN_PAGES = 4;
const FULL_SESSION_FETCH_LIMIT = 24;
const FULL_SESSION_MAX_PAGES = 200;
const FULL_SESSION_MAX_ROWS = 5000;
const LATEST_REFRESH_MAX_PAGES = 20;
function waitForHistoryListCommit(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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
  sessionIdRef: MutableRefObject<string>;
  pendingPromptSessionRef: MutableRefObject<Record<string, { id: string; startedAt: number }>>;
  sessionRawMapRef: MutableRefObject<Record<string, any[]>>;
  sessionVisibleTurnCountRef: MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: MutableRefObject<Record<string, number>>;
  displayedTurnCellsRef: MutableRefObject<Cell[]>;
  visibleCellCountRef: MutableRefObject<number>;
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
  replaceStreamRows: (targetSessionId: string, rows: any[]) => any[];
  recordStreamMessageRoles: (targetSessionId: string, rows: any[]) => void;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => any;
  syncSessionStatus: (targetSessionId?: string) => Promise<SessionStatusInfo | undefined>;
  rememberCurrentSessionViewport: (sessionId: string, snapshot: { displayedTurnCells: Cell[]; visibleCellCount: number }) => void;
  suppressLoadOlderUntilRef: MutableRefObject<number>;
  guardHistoryLoad: (durationMs?: number) => void;
  streamTypewriterQueueRef?: MutableRefObject<Record<string, unknown>>;
  streamDebug?: (label: string, payload?: Record<string, unknown>) => void;
}) {
  const {
    applyTurnWindow,
    authed,
    displayedTurnCellsRef,
    ingestStreamRows,
    replaceStreamRows,
    initialSessionLimit,
    loadingOlder,
    olderMessageFetchLimit,
    olderSessionLimit,
    pendingPromptSessionRef,
    pushConnLog,
    recordStreamMessageRoles,
    rememberCurrentSessionViewport,
    suppressLoadOlderUntilRef,
    guardHistoryLoad,
    repoPath,
    serverUrl,
    sessionId,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setLoadingOlder,
    setSessionHasMore,
    setSessionHistoryRetryHint,
    setSessionNextCursor,
    setSessionSwitchingTo,
    setStatus,
    setStreaming,
    streamDebug,
    streamTypewriterQueueRef,
    syncSessionStatus,
    token,
    visibleCellCountRef
  } = params;

  const inflightMessageReqRef = useRef<Record<string, Promise<RefreshMessagesResult | undefined>>>({});
  const inflightSessionSyncRef = useRef<Record<string, Promise<any>>>({});
  const olderCursorBackoffRef = useRef<Record<string, { cursor: string; retryAt: number; failures: number }>>({});
  const olderLoadInFlightRef = useRef(false);

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

    const restoreLocalSnapshot = (targetSessionId: string) => {
      const sid = toText(targetSessionId).trim();
      const repo = toText(repoPath).trim();
      if (!sid || !repo) return null;
      const existingRows = Array.isArray(sessionRawMapRef.current[sid]) ? sessionRawMapRef.current[sid] : [];
      let rows = existingRows;
      let visibleTurnCount = Math.max(0, Number(sessionVisibleTurnCountRef.current[sid] || 0));
      let totalTurnCount = Math.max(0, Number(sessionTotalTurnCountRef.current[sid] || 0));
      let nextCursor = toText(sessionNextCursor[sid]).trim();
      if (rows.length <= 0) {
        const snapshot = (() => {
          try {
            return loadChatSnapshot(repo, sid);
          } catch {
            return null;
          }
        })();
        if (!snapshot || !Array.isArray(snapshot.rawRows) || snapshot.rawRows.length <= 0) return null;
        rows = snapshot.rawRows;
        visibleTurnCount = Math.max(0, Number(snapshot.visibleTurnCount || snapshot.renderedTurns.length || 0));
        totalTurnCount = Math.max(visibleTurnCount, Number(snapshot.totalTurnCount || visibleTurnCount));
        nextCursor = toText(snapshot.nextCursor).trim();
        sessionRawMapRef.current[sid] = rows;
        sessionVisibleTurnCountRef.current[sid] = visibleTurnCount;
        sessionTotalTurnCountRef.current[sid] = totalTurnCount;
        setSessionNextCursor((prev) => ({ ...prev, [sid]: nextCursor }));
        setSessionHasMore((prev) => ({
          ...prev,
          [sid]: !!nextCursor || totalTurnCount > visibleTurnCount
        }));
      }
      if (rows.length > 0 && totalTurnCount <= 0) {
        const inspected = inspectTurnWindow(rows);
        totalTurnCount = inspected.totalTurnCount;
        visibleTurnCount = Math.max(visibleTurnCount, totalTurnCount);
        sessionVisibleTurnCountRef.current[sid] = visibleTurnCount;
        sessionTotalTurnCountRef.current[sid] = totalTurnCount;
      }
      if (rows.length <= 0 || totalTurnCount <= 0) return null;
      return { rows, visibleTurnCount, totalTurnCount, nextCursor };
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
          if (opts?.reason === 'cache' && olderLoadInFlightRef.current) {
            pushConnLog(`GET messages cache paused sid=${targetSessionId} reason=history-active`);
            return undefined;
          }
          if (!before && pendingPromptSessionRef.current[targetSessionId]) {
            pushConnLog(`GET messages skip sid=${targetSessionId} reason=pending prompt`);
            return;
          }
          const prevRaw = sessionRawMapRef.current[targetSessionId] || [];
          const authoritativeTail = !before && opts?.reason === 'tailOnly';
          if (authoritativeTail && streamTypewriterQueueRef?.current) {
            const prefix = `${targetSessionId}:`;
            const queue = streamTypewriterQueueRef.current;
            for (const key of Object.keys(queue)) {
              if (key.startsWith(prefix)) delete queue[key];
            }
          }
          const merged = authoritativeTail
            ? replaceStreamRows(targetSessionId, incoming)
            : before || prevRaw.length > 0
              ? mergeMessageRows(prevRaw, incoming)
              : ingestStreamRows(targetSessionId, incoming);
          sessionRawMapRef.current[targetSessionId] = merged;
          if (!authoritativeTail && (before || prevRaw.length > 0)) {
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
            incomingIds: incoming.map(rowId).filter(Boolean),
            incomingCount: incoming.length,
            mergedCount: merged.length,
            prevMergedCount: prevRaw.length,
            totalTurnCount: turnInfo.totalTurnCount
          };
        } catch (e) {
          if (before && opts?.reason === 'loadingOlder') markOlderCursorFailure(targetSessionId, before, e);
          pushConnLog(`GET messages error ${String(e)}`, 'error');
          if (opts?.reason !== 'prefetch' && opts?.reason !== 'cache') {
            setStatus(String(e));
          }
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
        const tailOnly = !!opts?.tailOnly;
        if (!before && !opts?.loadingOlder) {
          guardHistoryLoad(tailOnly ? 900 : 1500);
        }
        markSessionSwitchPerfForSid(targetSessionId, 'sync.begin', {
          mode,
          cachedRowCount: (sessionRawMapRef.current[targetSessionId] || []).length
        });
        if (tailOnly) {
          markMessageSendPerfForSession(targetSessionId, 'sync.tail_only.begin');
        }
        const requestedVisibleTurnCount = Math.max(1, Number(opts?.limit || initialSessionLimit));
        const prevVisibleTurnCount = Math.max(0, Number(sessionVisibleTurnCountRef.current[targetSessionId] || 0));
        const cachedRowCount = (sessionRawMapRef.current[targetSessionId] || []).length;
        const localSnapshot = !before && !opts?.loadingOlder && !tailOnly ? restoreLocalSnapshot(targetSessionId) : null;
        if (localSnapshot) {
          const visible = Math.max(requestedVisibleTurnCount, prevVisibleTurnCount, localSnapshot.totalTurnCount);
          pushConnLog(`chat.history.local restore sid=${targetSessionId} rows=${localSnapshot.rows.length} turns=${localSnapshot.totalTurnCount}`);
          markSessionSwitchPerfForSid(targetSessionId, 'sync.local_snapshot_restore', {
            rows: localSnapshot.rows.length,
            turns: localSnapshot.totalTurnCount
          });
          const rendered = applyTurnWindow(targetSessionId, visible, localSnapshot.nextCursor);
          setSessionSwitchingTo((prev) => (prev === targetSessionId ? '' : prev));
          markSessionSwitchPerfForSid(targetSessionId, 'sync.loading_cleared', { source: 'local_snapshot' });
          void (async () => {
            if (targetSessionId !== sessionIdRef.current) return;
            const cachedIds = new Set(localSnapshot.rows.map(rowId).filter(Boolean));
            let latest = await refreshMessages(targetSessionId, {
              limit: requestedVisibleTurnCount,
              fetchLimit: FULL_SESSION_FETCH_LIMIT,
              reason: 'refreshLatest'
            });
            if (!latest || targetSessionId !== sessionIdRef.current) return;
            let pages = 1;
            while (
              latest.nextCursor
              && targetSessionId === sessionIdRef.current
              && pages < LATEST_REFRESH_MAX_PAGES
              && latest.incomingIds.length > 0
              && latest.incomingIds.every((id) => !cachedIds.has(id))
            ) {
              pages += 1;
              const nextLatest = await refreshMessages(targetSessionId, {
                limit: requestedVisibleTurnCount,
                fetchLimit: FULL_SESSION_FETCH_LIMIT,
                before: latest.nextCursor,
                reason: 'refreshLatest'
              });
              if (!nextLatest || targetSessionId !== sessionIdRef.current) return;
              latest = nextLatest;
            }
            const nextVisible = Math.max(
              prevVisibleTurnCount,
              requestedVisibleTurnCount,
              localSnapshot.totalTurnCount,
              Number(sessionVisibleTurnCountRef.current[targetSessionId] || 0),
              Number(latest.totalTurnCount || 0)
            );
            pushConnLog(`chat.history.local refreshed sid=${targetSessionId} pages=${pages} rows=${latest.mergedCount} turns=${latest.totalTurnCount} next=${latest.nextCursor ? 1 : 0}`);
            if (targetSessionId !== sessionIdRef.current) return;
            applyTurnWindow(targetSessionId, nextVisible, latest.nextCursor || localSnapshot.nextCursor);
          })();
          return rendered;
        }
        const statusPromise = tailOnly ? Promise.resolve(undefined) : syncSessionStatus(targetSessionId);
        try {
          const networkStartedAt = performance.now();
          markSessionSwitchPerfForSid(targetSessionId, 'sync.network_first.begin');
          let res = await refreshMessages(targetSessionId, {
            limit: requestedVisibleTurnCount,
            fetchLimit: tailOnly ? FULL_SESSION_FETCH_LIMIT : opts?.fetchLimit,
            before,
            reason: tailOnly ? 'tailOnly' : mode
          });
          markSessionSwitchPerfForSid(targetSessionId, 'sync.network_first.done', {
            ms: Math.round(performance.now() - networkStartedAt),
            rows: res?.mergedCount,
            turns: res?.totalTurnCount,
            hasNext: res?.nextCursor ? 1 : 0
          });
          if (!res || targetSessionId !== sessionIdRef.current) return undefined;
          let fullSessionVisibleTurnCount = opts?.forceVisibleCount;
          const shouldHydrate =
            !tailOnly &&
            !opts?.loadingOlder &&
            !before &&
            !!res.nextCursor &&
            cachedRowCount <= FULL_SESSION_FETCH_LIMIT &&
            prevVisibleTurnCount <= res.totalTurnCount;
          if (shouldHydrate) {
            let cursor = res.nextCursor;
            let pages = 0;
            const hydrateStartedAt = performance.now();
            markSessionSwitchPerfForSid(targetSessionId, 'sync.hydrate.begin', {
              rows: res.mergedCount,
              turns: res.totalTurnCount
            });
            pushConnLog(`chat.history.hydrate start sid=${targetSessionId} rows=${res.mergedCount} turns=${res.totalTurnCount} next=1`);
            while (
              cursor
              && targetSessionId === sessionIdRef.current
              && pages < FULL_SESSION_MAX_PAGES
              && res.mergedCount < FULL_SESSION_MAX_ROWS
            ) {
              pages += 1;
              const nextRes = await refreshMessages(targetSessionId, {
                limit: requestedVisibleTurnCount,
                fetchLimit: FULL_SESSION_FETCH_LIMIT,
                before: cursor,
                reason: 'hydrate'
              });
              if (!nextRes || targetSessionId !== sessionIdRef.current) return undefined;
              res = nextRes;
              cursor = res.nextCursor;
            }
            fullSessionVisibleTurnCount = res.totalTurnCount;
            markSessionSwitchPerfForSid(targetSessionId, 'sync.hydrate.done', {
              ms: Math.round(performance.now() - hydrateStartedAt),
              pages,
              rows: res.mergedCount,
              turns: res.totalTurnCount
            });
            pushConnLog(`chat.history.hydrate done sid=${targetSessionId} pages=${pages} rows=${res.mergedCount} turns=${res.totalTurnCount} next=${res.nextCursor ? 1 : 0}`);
          }
          if (opts?.loadingOlder) {
            let boundaryScanCount = 0;
            while (
              res
              && res.nextCursor
              && res.totalTurnCount <= prevVisibleTurnCount
              && boundaryScanCount < HISTORY_TURN_BOUNDARY_SCAN_PAGES
            ) {
              boundaryScanCount += 1;
              pushConnLog(`chat.history.boundary scan sid=${targetSessionId} turns=${res.totalTurnCount} visible=${prevVisibleTurnCount} next=1 page=${boundaryScanCount}`);
              res = await refreshMessages(targetSessionId, {
                limit: requestedVisibleTurnCount,
                fetchLimit: opts?.fetchLimit,
                before: res.nextCursor,
                reason: mode
              });
              if (!res || targetSessionId !== sessionIdRef.current) return undefined;
            }
            if (res.totalTurnCount <= prevVisibleTurnCount) {
              pushConnLog(`chat.history.boundary skipped sid=${targetSessionId} turns=${res.totalTurnCount} visible=${prevVisibleTurnCount} next=${res.nextCursor ? 1 : 0}`);
              sessionTotalTurnCountRef.current[targetSessionId] = Math.max(
                Number(sessionTotalTurnCountRef.current[targetSessionId] || 0),
                Number(res.totalTurnCount || 0)
              );
              setSessionHasMore((prev) => ({
                ...prev,
                [targetSessionId]: !!res?.nextCursor || Number(res?.totalTurnCount || 0) > prevVisibleTurnCount
              }));
              return undefined;
            }
          }
          streamDebug?.('sync.messages.result', {
            sid: targetSessionId,
            mergedCount: res.mergedCount,
            prevMergedCount: res.prevMergedCount,
            totalTurnCount: res.totalTurnCount,
            status: 'pending'
          });

          const nextVisibleTurnCount = Math.max(
            prevVisibleTurnCount,
            computeVisibleTurnCount({
              prevVisibleTurnCount,
              totalTurnCount: res.totalTurnCount,
              requestedVisibleTurnCount: tailOnly
                ? Math.max(requestedVisibleTurnCount, prevVisibleTurnCount, res.totalTurnCount)
                : requestedVisibleTurnCount,
              initialTurnLimit: initialSessionLimit,
              olderTurnLimit: olderSessionLimit,
              mode,
              forceVisibleTurnCount: fullSessionVisibleTurnCount,
              userAtTop: false,
              hasNewHistoryFromCursor: !!before && res.mergedCount > res.prevMergedCount
            })
          );
          markSessionSwitchPerfForSid(targetSessionId, 'sync.apply_turn_window.begin', {
            visibleTurns: nextVisibleTurnCount
          });
          const rendered = applyTurnWindow(targetSessionId, nextVisibleTurnCount, res.nextCursor);
          markSessionSwitchPerfForSid(targetSessionId, 'sync.apply_turn_window.done', {
            turns: rendered.renderedTurns.length
          });
          if (targetSessionId === sessionIdRef.current) {
            setSessionSwitchingTo((prev) => (prev === targetSessionId ? '' : prev));
            markSessionSwitchPerfForSid(targetSessionId, 'sync.loading_cleared', { source: 'network_sync' });
          }
          if (tailOnly) {
            markMessageSendPerfForSession(targetSessionId, 'sync.tail_only.done', {
              turns: rendered.renderedTurns.length
            });
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
          const latestTurnHasAssistant = (() => {
            const lastTurn = rendered.renderedTurns[rendered.renderedTurns.length - 1];
            if (!lastTurn) return false;
            return lastTurn.items.some((item: any) => {
              if (item.kind === 'think') return !!toText(item.card?.text).trim();
              if (item.kind === 'context' || item.kind === 'event') return true;
              if (item.kind === 'chat' && item.message?.role === 'assistant') {
                return !!toText(item.message.text).trim();
              }
              return false;
            });
          })();
          if ((!rendered.writing && statusIdle) || latestTurnHasError || latestTurnHasAssistant) {
            setStreaming(false);
            setStatus((prev) => (toText(prev).includes('流式响应中') ? '' : prev));
          }
          return rendered;
        } finally {
          if (!opts?.loadingOlder && targetSessionId === sessionIdRef.current) {
            setSessionSwitchingTo((prev) => (prev === targetSessionId ? '' : prev));
          }
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
      if (!sid || loadingOlder || olderLoadInFlightRef.current) {
        pushConnLog(`chat.history.load skipped sid=${sid || '-'} loading=${loadingOlder ? 1 : 0} inflight=${olderLoadInFlightRef.current ? 1 : 0}`);
        return;
      }
      if (Date.now() < suppressLoadOlderUntilRef.current) {
        pushConnLog(`chat.history.load suppressed viewport_settle sid=${sid}`);
        return;
      }
      olderLoadInFlightRef.current = true;
      const finishLocalHistoryMutation = () => {
        setTimeout(() => {
          olderLoadInFlightRef.current = false;
          setLoadingOlder(false);
        }, HISTORY_LOAD_SETTLE_MS);
      };
      rememberCurrentSessionViewport(sid, {
        displayedTurnCells: displayedTurnCellsRef.current,
        visibleCellCount: visibleCellCountRef.current
      });
      setLoadingOlder(true);
      await waitForHistoryListCommit();
      if (sid !== sessionIdRef.current) {
        finishLocalHistoryMutation();
        return;
      }
      const cached = Math.max(0, Number(sessionTotalTurnCountRef.current[sid] || 0));
      const visible = Math.max(0, Number(sessionVisibleTurnCountRef.current[sid] || 0));
      const cursor = toText(sessionNextCursor[sid]).trim();
      if (cached <= visible && !cursor) {
        pushConnLog(`chat.history.load skipped sid=${sid} cached=${cached} visible=${visible} no_more=1`);
        olderLoadInFlightRef.current = false;
        setLoadingOlder(false);
        return;
      }
      pushConnLog(`chat.history.load start sid=${sid} cached=${cached} visible=${visible} cursor=${cursor ? 1 : 0}`);
      if (cached > visible) {
        const nextVisible = Math.min(cached, visible + olderSessionLimit);
        applyTurnWindow(sid, nextVisible);
        pushConnLog(`chat.history.load cached sid=${sid} from=${visible} to=${nextVisible} cached=${cached}`);
        setSessionHasMore((prev) => ({
          ...prev,
          [sid]: cached > nextVisible || !!toText(sessionNextCursor[sid]).trim()
        }));
        finishLocalHistoryMutation();
        return;
      }
      const backoff = cursor ? getOlderCursorBackoff(sid, cursor) : null;
      if (backoff) {
        pushConnLog(`chat.history.load backoff sid=${sid} retryMs=${Math.max(0, backoff.retryAt - Date.now())}`);
        setSessionHistoryRetryHint((prev) => ({
          ...prev,
          [sid]: `历史加载失败，${formatRetryDelay(backoff.retryAt - Date.now())}`
        }));
        olderLoadInFlightRef.current = false;
        setLoadingOlder(false);
        return;
      }
      if (cursor) {
        try {
          const rendered = await syncSessionMessages(sid, {
            limit: olderSessionLimit,
            fetchLimit: olderMessageFetchLimit,
            before: cursor,
            loadingOlder: true
          });
          pushConnLog(`chat.history.load remote ${rendered ? 'done' : 'no-visible-boundary'} sid=${sid}`);
        } finally {
          finishLocalHistoryMutation();
        }
      } else {
        pushConnLog(`chat.history.load exhausted sid=${sid} cached=${cached} visible=${visible}`);
        setSessionHasMore((prev) => ({ ...prev, [sid]: cached > visible }));
        olderLoadInFlightRef.current = false;
        setLoadingOlder(false);
      }
    };

    const resetMessageSyncState = () => {
      inflightMessageReqRef.current = {};
      inflightSessionSyncRef.current = {};
      olderCursorBackoffRef.current = {};
      olderLoadInFlightRef.current = false;
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
    displayedTurnCellsRef,
    ingestStreamRows,
    replaceStreamRows,
    streamTypewriterQueueRef,
    initialSessionLimit,
    loadingOlder,
    olderMessageFetchLimit,
    olderSessionLimit,
    pendingPromptSessionRef,
    pushConnLog,
    recordStreamMessageRoles,
    rememberCurrentSessionViewport,
    suppressLoadOlderUntilRef,
    guardHistoryLoad,
    repoPath,
    serverUrl,
    sessionId,
    sessionIdRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
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

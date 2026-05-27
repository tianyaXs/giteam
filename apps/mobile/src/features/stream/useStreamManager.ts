import { useCallback, useRef } from 'react';
import EventSource from 'react-native-sse';
import { toText } from '../../lib/text';
import type { OpenCodeStreamStoreRefs, StreamPartEvent } from '../messages/opencodeStore';
import {
  ensureStreamSessionStores as storeEnsureStreamSessionStores,
  canApplyStreamPartUpdate as storeCanApplyStreamPartUpdate,
  getKnownStreamMessageRole as storeGetKnownStreamMessageRole,
  resolveStreamRewriteRole as storeResolveStreamRewriteRole,
  getStoredStreamPart as storeGetStoredStreamPart,
  ingestStreamRows as storeIngestStreamRows,
  mergeStreamPart as storeMergeStreamPart,
  replaceStreamRows as storeReplaceStreamRows,
  patchStoredStreamPartDelta as storePatchStoredStreamPartDelta,
  publishStreamRows as storePublishStreamRows,
  rawMessageId as storeRawMessageId,
  rawMessageRole as storeRawMessageRole,
  rawPartId as storeRawPartId,
  removeStreamPartRecord as storeRemoveStreamPartRecord,
  shouldStoreStreamPart as storeShouldStoreStreamPart,
  upsertStreamPartRecord as storeUpsertStreamPartRecord,
  removeStreamPermission,
  removeStreamQuestion,
  setStreamSessionStatus,
  setStreamTodos,
  upsertStreamPermission,
  upsertStreamQuestion,
  resetOpenCodeStreamStores as storeResetOpenCodeStreamStores
} from '../messages/opencodeStore';
import { computeVisibleTurnCount } from '../messages/history';
import { inspectTurnWindow } from '../messages/turns';
import { buildStreamUrl, pairAuth } from '../../api/controlApi';
import {
  isStreamTextPart,
  streamPartWriteField,
  STREAM_TYPEWRITER_TICK_MS,
  takeStreamTypewriterChunk
} from './streamTypewriter';

function isAbortLikeStreamError(detail: string) {
  const text = toText(detail).toLowerCase();
  return text.includes('messageabortederror') || text.includes('the operation was aborted');
}

const INITIAL_SESSION_LIMIT = 1;
const INITIAL_MESSAGE_FETCH_LIMIT = 8;
const OLDER_SESSION_LIMIT = 1;

export interface StreamManagerDeps {
  authed: boolean;
  serverUrl: string;
  repoPath: string;
  token: string;
  pairCode: string;
  NO_AUTH_TOKEN: string;
  sessionIdRef: React.MutableRefObject<string>;
  streamRef: React.MutableRefObject<EventSource | null>;
  streamRunIdRef: React.MutableRefObject<number>;
  streamSessionRef: React.MutableRefObject<string>;
  sessionStatusEpochRef: React.MutableRefObject<number>;
  streamRenderTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  streamTypewriterTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  streamTypewriterQueueRef: React.MutableRefObject<Record<string, { sid: string; messageId: string; partId: string; field: string; text: string; partTypeHint?: string }>>;
  messageContentHRef: React.MutableRefObject<number>;
  messageViewportHRef: React.MutableRefObject<number>;
  messageScrollYRef: React.MutableRefObject<number>;
  messageUserScrollingRef: React.MutableRefObject<boolean>;
  forceScrollToLatestUntilRef: React.MutableRefObject<number>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  getOpenCodeStreamStores: () => OpenCodeStreamStoreRefs;
  pushConnLog: (msg: string, level?: 'error' | 'info') => void;
  streamDebug: (event: string, meta?: Record<string, unknown>) => void;
  setStreaming: (value: boolean | ((prev: boolean) => boolean)) => void;
  setStatus: (value: string | ((prev: string) => string)) => void;
  setToken: (value: string) => void;
  setSessionStatusMap: (value: React.SetStateAction<Record<string, any>>) => void;
  setStreamTodoCard: (value: any) => void;
  setQuestionRequests: (value: React.SetStateAction<any[]>) => void;
  setDismissedQuestions: (value: React.SetStateAction<Set<string>>) => void;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => any;
  scrollToLatest: (animated?: boolean) => void;
  syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number; tailOnly?: boolean }) => Promise<any>;
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
  extractQuestionRequests: (raw: any[], targetSessionId: string) => any[];
  buildLiveTodoCard: (sid: string, todos: any[]) => any;
  saveQuestionDismissal: (repo: string, sid: string, id: string) => void;
  dismissedQuestions: Set<string>;
}

export function useStreamManager(deps: StreamManagerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const getDeps = useCallback(() => depsRef.current, []);
  const shouldFollowLatest = useCallback(() => {
    const d = getDeps();
    const scrollY = Math.max(0, Number(d.messageScrollYRef.current || 0));
    const viewportH = Math.max(0, Number(d.messageViewportHRef.current || 0));
    const contentH = Math.max(0, Number(d.messageContentHRef.current || 0));
    const distanceFromBottom = contentH > 0 && viewportH > 0
      ? Math.max(0, contentH - viewportH - scrollY)
      : scrollY;
    return !d.messageUserScrollingRef.current && distanceFromBottom < 96;
  }, [getDeps]);

  const stopStream = useCallback(() => {
    const d = getDeps();
    d.streamRunIdRef.current += 1;
    d.sessionStatusEpochRef.current += 1;
    if (d.streamRef.current) {
      d.pushConnLog('SSE close');
      d.streamRef.current.close();
      d.streamRef.current = null;
    }
    if (d.streamRenderTimerRef.current) {
      clearTimeout(d.streamRenderTimerRef.current);
      d.streamRenderTimerRef.current = null;
    }
    if (d.streamTypewriterTimerRef.current) {
      clearTimeout(d.streamTypewriterTimerRef.current);
      d.streamTypewriterTimerRef.current = null;
    }
    d.streamTypewriterQueueRef.current = {};
    d.streamSessionRef.current = '';
    storeResetOpenCodeStreamStores(d.getOpenCodeStreamStores());
    d.setStreamTodoCard(null);
    d.setStreaming(false);
  }, [getDeps]);

  const startStream = useCallback((targetSessionId: string) => {
    const d = getDeps();
    stopStream();
    if (!d.authed || !d.serverUrl || !d.repoPath || !targetSessionId) return;
    const streamRunId = d.streamRunIdRef.current;
    d.streamSessionRef.current = targetSessionId;
    const url = buildStreamUrl({
      baseUrl: d.serverUrl,
      repoPath: d.repoPath,
      sessionId: targetSessionId,
      intervalMs: 700
    });

    const headers: Record<string, string> = {};
    if (d.token && d.token !== d.NO_AUTH_TOKEN) headers.Authorization = `Bearer ${d.token}`;
    const es = new EventSource(url, { headers } as any);
    d.streamRef.current = es;
    d.pushConnLog(`SSE connect ${url}`);
    let streamClosed = false;
    const isCurrentStream = () =>
      !streamClosed &&
      d.streamRunIdRef.current === streamRunId &&
      d.streamRef.current === es &&
      d.streamSessionRef.current === targetSessionId &&
      d.sessionIdRef.current === targetSessionId;

    let lastSyncAt = 0;
    let lastStatusSyncAt = 0;
    const syncFromServer = () => {
      if (!isCurrentStream()) return;
      const now = Date.now();
      if (now - lastSyncAt < 300) return;
      lastSyncAt = now;
      void d.syncSessionMessages(targetSessionId, { tailOnly: true });
      void d.syncSessionStatus(targetSessionId);
    };
    const syncStatusSoon = () => {
      const now = Date.now();
      if (now - lastStatusSyncAt < 900) return;
      lastStatusSyncAt = now;
      void d.syncSessionStatus(targetSessionId);
    };
    const parseSseData = (event: any) => {
      return typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
    };

    // --- Stream State Helpers (inline to avoid circular deps) ---
    const getStores = () => d.getOpenCodeStreamStores();

    const recordStreamMessageRoles = (sid: string, rows: any[]) => {
      if (!sid || !Array.isArray(rows)) return;
      const stores = getStores();
      const roleStore = stores.messageRole.current[sid] || {};
      for (const row of rows) {
        const mid = storeRawMessageId(row);
        const role = roleStore[mid] || storeRawMessageRole(row);
        if (!mid || !role) continue;
        if (role === 'assistant') flushPendingStreamPartEvents(sid, mid);
        else dropPendingStreamPartEvents(sid, mid);
      }
    };

    const dropPendingStreamPartEvents = (sid: string, mid: string) => {
      const stores = getStores();
      const bySession = stores.pendingPartEvents.current[sid];
      if (!bySession || !bySession[mid]) return;
      d.streamDebug('stream.part.drop', { sid, messageId: mid, count: bySession[mid].length });
      delete bySession[mid];
    };

    const flushPendingStreamPartEvents = (sid: string, mid: string) => {
      const stores = getStores();
      const bySession = stores.pendingPartEvents.current[sid];
      const pending = bySession?.[mid] || [];
      if (pending.length <= 0) return;
      delete bySession[mid];
      d.streamDebug('stream.part.flush', { sid, messageId: mid, count: pending.length });
      for (const event of pending) {
        if (event.kind === 'delta') applyAssistantDeltaNow(sid, event.payload);
        else if (event.kind === 'part') applyAssistantPartNow(sid, event.payload);
        else applyPartRemovedNow(sid, event.payload);
      }
    };

    const queueStreamPartEvent = (sid: string, mid: string, event: StreamPartEvent) => {
      if (!sid || !mid) return;
      const stores = getStores();
      const bySession = stores.pendingPartEvents.current[sid] || {};
      const list = bySession[mid] || [];
      bySession[mid] = [...list, event];
      stores.pendingPartEvents.current[sid] = bySession;
      d.streamDebug('stream.part.pending', { sid, messageId: mid, kind: event.kind, count: bySession[mid].length });
    };

    const getKnownStreamMessageRole = (sid: string, messageId: string) => {
      return storeGetKnownStreamMessageRole(getStores(), sid, messageId);
    };

    const getStoredStreamPart = (sid: string, messageId: string, partId: string) => {
      return storeGetStoredStreamPart(getStores(), sid, messageId, partId);
    };

    const patchStoredStreamPartDelta = (
      sid: string,
      messageId: string,
      partId: string,
      field: string,
      delta: string,
      partTypeHint?: string,
    ) => {
      return storePatchStoredStreamPartDelta(getStores(), sid, messageId, partId, field, delta, partTypeHint);
    };

    const publishStreamRows = (sid: string) => {
      return storePublishStreamRows(getStores(), sid);
    };

    const ingestStreamRows = (sid: string, rows: any[]) => {
      return storeIngestStreamRows(getStores(), sid, rows);
    };

    const ensureStreamSessionStores = (sid: string) => {
      const stores = getStores();
      if (!stores.message.current[sid]) stores.message.current[sid] = {};
      if (!stores.part.current[sid]) stores.part.current[sid] = {};
      if (!stores.messageRole.current[sid]) stores.messageRole.current[sid] = {};
      return sid;
    };

    const markStreamAssistantMessage = (sid: string, messageId: string) => {
      const mid = toText(messageId).trim();
      if (!sid || !mid) return;
      const stores = getStores();
      stores.messageRole.current[sid] = { ...(stores.messageRole.current[sid] || {}), [mid]: 'assistant' };
      flushPendingStreamPartEvents(sid, mid);
    };

    const dropTypewriterQueueForSession = (sid: string) => {
      const prefix = `${sid}:`;
      const queue = d.streamTypewriterQueueRef.current;
      for (const key of Object.keys(queue)) {
        if (key.startsWith(prefix)) delete queue[key];
      }
    };

    const applyStreamMessageSnapshot = (sid: string, payload: unknown) => {
      if (sid !== d.sessionIdRef.current) return undefined;
      const incoming = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.items) ? (payload as any).items : [];
      if (incoming.length === 0) return undefined;
      dropTypewriterQueueForSession(sid);
      const merged = storeReplaceStreamRows(getStores(), sid, incoming);
      recordStreamMessageRoles(sid, merged);
      const turnInfo = inspectTurnWindow(merged);
      const prevVisibleTurnCount = Math.max(0, Number(d.sessionVisibleTurnCountRef.current[sid] || 0));
      const nextVisibleTurnCount = computeVisibleTurnCount({
        prevVisibleTurnCount,
        totalTurnCount: turnInfo.totalTurnCount,
        requestedVisibleTurnCount: Math.max(INITIAL_SESSION_LIMIT, prevVisibleTurnCount, turnInfo.totalTurnCount),
        initialTurnLimit: INITIAL_SESSION_LIMIT,
        olderTurnLimit: OLDER_SESSION_LIMIT,
        mode: 'default',
        userAtTop: false,
        hasNewHistoryFromCursor: false
      });
      const rendered = d.applyTurnWindow(sid, nextVisibleTurnCount);
      refreshQuestionRequestsFromStore(sid);
      d.pushConnLog(`SSE messages sid=${sid} rows=${incoming.length} merged=${merged.length} turns=${turnInfo.totalTurnCount}`);
      return rendered;
    };

    const applyStreamMessageInfo = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      const info = source?.info;
      // 检查是否是 task 事件：如果是，使用当前会话 ID（父会话），避免存入子会话
      const parts = info?.parts || [];
      const isTaskEvent = Array.isArray(parts) && parts.some((p: any) => p?.type === 'tool' && p?.tool === 'task');
      // 对于 task 事件，强制使用当前会话 ID；其他事件使用 payload 中的 sessionId
      const targetSid = isTaskEvent ? sid : toText(source?.sessionId || source?.sessionID || info?.sessionID || sid).trim();
      if (!targetSid || !info || typeof info !== 'object') return;
      const mid = toText(info?.id).trim();
      if (!mid) return;
      const rows = ingestStreamRows(targetSid, [{ info, parts: [] }]);
      recordStreamMessageRoles(targetSid, rows);
      // 只渲染当前会话的消息
      if (targetSid === d.sessionIdRef.current) {
        renderStreamWindow(targetSid);
      }
    };

    const applyStreamMessageRemoved = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      const mid = toText(source?.messageId || source?.messageID).trim();
      if (!targetSid || !mid) return;
      const stores = getStores();
      delete stores.message.current[targetSid]?.[mid];
      delete stores.part.current[targetSid]?.[mid];
      delete stores.messageRole.current[targetSid]?.[mid];
      dropPendingStreamPartEvents(targetSid, mid);
      publishStreamRows(targetSid);
      // 只渲染当前会话的消息
      if (targetSid === d.sessionIdRef.current) {
        renderStreamWindow(targetSid);
      }
    };

    const applyPartRemovedNow = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      const messageId = toText(source?.messageId || source?.messageID).trim();
      const partId = toText(source?.partId || source?.partID).trim();
      if (!targetSid || !messageId || !partId) return;
      storeRemoveStreamPartRecord(getStores(), targetSid, messageId, partId);
      publishStreamRows(targetSid);
      // 只渲染当前会话的消息
      if (targetSid === d.sessionIdRef.current) {
        renderStreamWindow(targetSid);
      }
    };

    const applyPartRemoved = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
      const messageId = toText(source?.messageId || source?.messageID).trim();
      const role = getKnownStreamMessageRole(sid, messageId);
      if (!role) {
        queueStreamPartEvent(sid, messageId, { kind: 'part_removed', payload });
        return;
      }
      applyPartRemovedNow(sid, payload);
    };

    const refreshQuestionRequestsFromStore = (sid: string) => {
      const stores = getStores();
      const live = (stores.question.current[sid] || []) as any[];
      const fromParts = d.extractQuestionRequests(stores.rawRows.current[sid] || [], sid);
      const merged = new Map<string, any>();
      [...fromParts, ...live].forEach((req) => {
        if (!req?.id || d.dismissedQuestions.has(req.id)) return;
        merged.set(req.id, req);
      });
      d.setQuestionRequests([...merged.values()]);
    };

    const applyStreamTodo = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      if (!targetSid) return;
      const todos = Array.isArray(source?.todos) ? source.todos : [];
      setStreamTodos(getStores(), targetSid, todos);
      // 只更新当前会话的todo卡片
      if (targetSid === d.sessionIdRef.current) {
        d.setStreamTodoCard(d.buildLiveTodoCard(targetSid, todos));
      }
    };

    const applyStreamPermission = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      if (!targetSid) return;
      upsertStreamPermission(getStores(), { ...source, sessionID: targetSid });
    };

    const applyStreamPermissionReplied = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      if (!targetSid) return;
      removeStreamPermission(getStores(), targetSid, toText(source?.requestID || source?.requestId || source?.id));
    };

    const applyStreamQuestion = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      if (!targetSid) return;
      upsertStreamQuestion(getStores(), { ...source, sessionID: targetSid });
      // 只刷新当前会话的问题列表
      if (targetSid === d.sessionIdRef.current) {
        refreshQuestionRequestsFromStore(targetSid);
      }
    };

    const applyStreamQuestionRemoved = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any)?.properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      if (!targetSid) return;
      removeStreamQuestion(getStores(), targetSid, toText(source?.requestID || source?.requestId || source?.id));
      // 只刷新当前会话的问题列表
      if (targetSid === d.sessionIdRef.current) {
        refreshQuestionRequestsFromStore(targetSid);
      }
    };

    const upsertStreamPart = (sid: string, messageId: string, part: any, createdAt: number = Date.now()) => {
      if (!storeShouldStoreStreamPart(part)) return;
      if (!sid || !messageId) return;
      const stores = getStores();
      if (!storeCanApplyStreamPartUpdate(stores, sid, messageId)) return;
      storeUpsertStreamPartRecord(stores, sid, messageId, part);
      rewriteStreamMessageRow(sid, messageId, createdAt);
    };

    const rewriteStreamMessageRow = (sid: string, messageId: string, createdAt: number = Date.now()) => {
      const stores = getStores();
      ensureStreamSessionStores(sid);
      const role = storeResolveStreamRewriteRole(stores, sid, messageId);
      if (role === 'user') return;
      const bucket = stores.part.current[sid]?.[messageId];
      const parts = bucket ? bucket.order.map((id) => bucket.byId[id]).filter(Boolean) : [];
      d.streamDebug('stream.row.rewrite', {
        sid,
        messageId,
        parts: parts.map((p: any) => `${p?.type || '?'}:${toText(p?.text).length}`).join(',')
      });
      const currentInfo = stores.message.current[sid]?.[messageId] || {};
      stores.message.current[sid][messageId] = {
        ...currentInfo,
        id: messageId,
        role: 'assistant',
        time: currentInfo.time || { created: createdAt }
      };
      stores.messageRole.current[sid] = { ...(stores.messageRole.current[sid] || {}), [messageId]: 'assistant' };
      publishStreamRows(sid);
    };

    const applyAssistantDeltaNow = (sid: string, payload: unknown) => {
      // 允许所有会话的delta事件，但只处理当前会话的渲染
      const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      const messageId = toText(source?.messageId || source?.messageID).trim();
      if (!targetSid || !messageId || !storeCanApplyStreamPartUpdate(getStores(), targetSid, messageId)) return;
      const partId = toText(source?.partId || source?.partID).trim() || 'text';
      const field = toText(source?.field).trim();
      const delta = typeof source?.delta === 'string' ? source.delta : '';
      const kind = toText(source?.type).trim() || (field === 'reasoning' ? 'reasoning' : 'text');
      d.streamDebug('delta.received', { sid: targetSid, messageId, partId, field, kind, deltaLen: delta.length, deltaPreview: delta.slice(0, 40) });
      if (!delta) {
        d.streamDebug('delta.ignored', { reason: 'missing delta', messageId, deltaLen: delta.length });
        return;
      }
      const writeField = streamPartWriteField(field, kind);
      enqueueStreamTypewriterDelta(targetSid, messageId, partId, writeField, delta, kind);
      const nextLen = toText(getStoredStreamPart(targetSid, messageId, partId)?.text).length + delta.length;
      d.streamDebug('delta.enqueued', { sid: targetSid, messageId, partId, kind, totalLen: nextLen });
      // 只设置当前会话的streaming状态
      if (targetSid === d.sessionIdRef.current) {
        d.setStreaming(true);
      }
    };

    const applyAssistantDelta = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      const messageId = toText(source?.messageId || source?.messageID).trim();
      const role = getKnownStreamMessageRole(targetSid, messageId);
      if (!role) {
        queueStreamPartEvent(targetSid, messageId, { kind: 'delta', payload });
        return;
      }
      if (role !== 'assistant') return;
      const partId = toText(source?.partId || source?.partID).trim() || toText(source?.field).trim() || 'text';
      if (!getStoredStreamPart(targetSid, messageId, partId)) {
        const field = toText(source?.field).trim();
        const type = toText(source?.type).trim() || (field === 'reasoning' ? 'reasoning' : 'text');
        upsertStreamPart(targetSid, messageId, {
          id: partId,
          messageID: messageId,
          type,
          text: ''
        });
      }
      applyAssistantDeltaNow(targetSid, payload);
    };

    const applyAssistantPartNow = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
      const part = source?.part;
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      const messageId = toText(source?.messageId || source?.messageID || part?.messageID || part?.messageId).trim();
      if (!targetSid || !messageId || !part || typeof part !== 'object') return;
      if (!storeCanApplyStreamPartUpdate(getStores(), targetSid, messageId)) return;
      const partId = toText(part?.id || part?.partID).trim() || 'text';
      const incomingText = typeof part?.text === 'string' ? part.text : '';
      const isCurrentSession = targetSid === d.sessionIdRef.current;
      if (isStreamTextPart(part) && incomingText) {
        const stored = getStoredStreamPart(targetSid, messageId, partId);
        const prevText = toText(stored?.text);
        // Logical text = stored.text + pending typewriter queue chunks for this part/field=text.
        // Snapshots (`message.part.updated`) include the full text up to that moment, so we
        // must NOT recompute delta against stored alone — that double-counts queued chunks.
        const queueKey = `${targetSid}:${messageId}:${partId}:text`;
        const queuedItem = d.streamTypewriterQueueRef.current[queueKey];
        const queuedText = toText(queuedItem?.text);
        const logicalText = `${prevText}${queuedText}`;
        if (incomingText === logicalText) {
          if (isCurrentSession) d.setStreaming(true);
          return;
        }
        if (incomingText.startsWith(logicalText)) {
          if (!stored) {
            upsertStreamPart(targetSid, messageId, { ...part, id: partId, messageID: messageId, text: prevText });
          }
          const delta = incomingText.slice(logicalText.length);
          if (delta.length > 0) {
            enqueueStreamTypewriterDelta(targetSid, messageId, partId, 'text', delta);
          }
          if (isCurrentSession) d.setStreaming(true);
          return;
        }
        if (logicalText.startsWith(incomingText) && incomingText.length < logicalText.length) {
          // Stale snapshot; we already have a longer prefix.
          if (isCurrentSession) d.setStreaming(true);
          return;
        }
        // Diverged — snapshot is authoritative. Drop queue and write directly.
        delete d.streamTypewriterQueueRef.current[queueKey];
        upsertStreamPart(targetSid, messageId, { ...part, id: partId, messageID: messageId, text: incomingText });
        flushPendingStreamPartEvents(targetSid, messageId);
        if (isCurrentSession) {
          renderStreamWindow(targetSid);
          d.setStreaming(true);
        }
        return;
      }
      upsertStreamPart(targetSid, messageId, part);
      flushPendingStreamPartEvents(targetSid, messageId);
      if (isCurrentSession) {
        renderStreamWindow(targetSid);
        if (shouldFollowLatest()) {
          d.forceScrollToLatestUntilRef.current = Date.now() + 45000;
        }
        d.setStreaming(true);
      }
    };

    const applyAssistantPart = (sid: string, payload: unknown) => {
      const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
      const part = source?.part;
      // 始终使用当前会话的 ID，避免子会话 ID 导致消息无法渲染
      const targetSid = sid;
      const messageId = toText(source?.messageId || source?.messageID || part?.messageID || part?.messageId).trim();
      const role = getKnownStreamMessageRole(targetSid, messageId);
      if (!role) {
        queueStreamPartEvent(targetSid, messageId, { kind: 'part', payload });
        return;
      }
      if (role !== 'assistant') return;
      applyAssistantPartNow(targetSid, payload);
    };

    // --- Render Scheduling ---
    const scheduleStreamTypewriterDrain = () => {
      if (d.streamTypewriterTimerRef.current) return;
      d.streamTypewriterTimerRef.current = setTimeout(() => {
        d.streamTypewriterTimerRef.current = null;
        const entries = Object.entries(d.streamTypewriterQueueRef.current);
        if (entries.length === 0) return;
        const touchedSessions = new Set<string>();
        for (const [key, item] of entries) {
          // 允许所有会话的typewriter事件，但只渲染当前会话
          const { chunk, rest } = takeStreamTypewriterChunk(item.text);
          if (chunk) {
            const ok = patchStoredStreamPartDelta(
              item.sid,
              item.messageId,
              item.partId,
              item.field,
              chunk,
              item.partTypeHint,
            );
            if (ok) touchedSessions.add(item.sid);
          }
          if (rest) d.streamTypewriterQueueRef.current[key] = { ...item, text: rest };
          else delete d.streamTypewriterQueueRef.current[key];
        }
        touchedSessions.forEach((sid) => scheduleStreamRender(sid));
        if (Object.keys(d.streamTypewriterQueueRef.current).length > 0) {
          d.streamTypewriterTimerRef.current = setTimeout(() => {
            d.streamTypewriterTimerRef.current = null;
            scheduleStreamTypewriterDrain();
          }, STREAM_TYPEWRITER_TICK_MS);
        }
      }, STREAM_TYPEWRITER_TICK_MS);
    };

    const scheduleStreamRender = (sid: string) => {
      if (d.streamRenderTimerRef.current) return;
      d.streamRenderTimerRef.current = setTimeout(() => {
        d.streamRenderTimerRef.current = null;
        // 只渲染当前会话
        if (sid !== d.sessionIdRef.current) return;
        const shouldFollowStream = shouldFollowLatest();
        renderStreamWindow(sid);
        if (shouldFollowStream) {
          d.forceScrollToLatestUntilRef.current = Date.now() + 45000;
        }
      }, 24);
    };

    const renderStreamWindow = (sid: string) => {
      const totalTurns = Math.max(1, Number(d.sessionTotalTurnCountRef.current[sid] || INITIAL_SESSION_LIMIT));
      const visibleTurns = Math.max(INITIAL_SESSION_LIMIT, Number(d.sessionVisibleTurnCountRef.current[sid] || INITIAL_SESSION_LIMIT));
      const rendered = d.applyTurnWindow(sid, Math.min(totalTurns, visibleTurns));
      const last = rendered.renderedTurns[rendered.renderedTurns.length - 1];
      d.streamDebug('render.window', {
        sid,
        turns: rendered.renderedTurns.length,
        writing: rendered.writing,
        lastTurn: last?.id,
        lastItems: last?.items?.map((item: any) => item.kind).join(',') || ''
      });
    };

    const enqueueStreamTypewriterDelta = (
      sid: string,
      messageId: string,
      partId: string,
      field: string,
      delta: string,
      partTypeHint?: string,
    ) => {
      const mid = toText(messageId).trim();
      const pid = toText(partId).trim();
      const key = `${sid}:${mid}:${pid}:${field}`;
      if (!sid || !mid || !pid || !field || !delta) return;
      if (!storeCanApplyStreamPartUpdate(getStores(), sid, mid)) return;
      const current = d.streamTypewriterQueueRef.current[key];
      d.streamTypewriterQueueRef.current[key] = {
        sid,
        messageId: mid,
        partId: pid,
        field,
        text: `${current?.text || ''}${delta}`,
        partTypeHint: partTypeHint || current?.partTypeHint
      };
      scheduleStreamTypewriterDrain();
    };

    // --- SSE Event Handlers ---
    const handleDeltaPayload = (payload: any) => {
      applyAssistantDelta(targetSessionId, payload);
      syncStatusSoon();
    };
    const handlePartPayload = (payload: any) => {
      applyAssistantPart(targetSessionId, payload);
      syncStatusSoon();
    };

    es.addEventListener('open', () => {
      if (!isCurrentStream()) return;
      d.pushConnLog('SSE open');
      d.streamDebug('sse.open', { sid: targetSessionId });
      d.setStreaming(true);
      syncFromServer();
    });
    es.addEventListener('error', (e: any) => {
      if (!isCurrentStream()) return;
      syncFromServer();
      d.setStreaming(false);
      try {
        const detail = typeof e?.data === 'string' ? e.data : JSON.stringify(e);
        d.streamDebug('sse.error', { sid: targetSessionId, detail: toText(detail).slice(0, 180) });
        if (isAbortLikeStreamError(detail)) {
          d.pushConnLog(`SSE aborted ${toText(detail) || 'unknown'}`);
          return;
        }
        d.pushConnLog(`SSE error ${toText(detail) || 'unknown'}`, 'error');
        if (toText(detail).includes('invalid bearer token') && d.pairCode.trim()) {
          d.pushConnLog('SSE auto pairAuth retry');
          void pairAuth(d.serverUrl, d.pairCode)
            .then((renewed: any) => {
              d.setToken(renewed.token);
              d.pushConnLog('SSE auto pairAuth retry ok');
              d.setStatus('已自动刷新授权，请重试');
            })
            .catch((err: any) => {
              d.pushConnLog(`SSE auto pairAuth retry error ${String(err)}`, 'error');
              d.setStatus(String(err));
            });
        } else {
          d.setStatus(detail ? `流断开: ${detail}` : '流断开');
        }
      } catch {
        d.pushConnLog('SSE error parse failed', 'error');
        d.setStatus('流断开');
      }
    });
    es.addEventListener('messages' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data;
        d.streamDebug('sse.messages', { sid: targetSessionId, payloadType: Array.isArray(payload) ? 'array' : typeof payload });
        const rendered = applyStreamMessageSnapshot(targetSessionId, payload);
        if (rendered) {
          d.setStreaming(rendered.writing);
          syncStatusSoon();
          return;
        }
      } catch (err) {
        d.pushConnLog(`SSE messages parse failed ${String(err)}`, 'error');
      }
      syncFromServer();
    });
    es.addEventListener('session_status' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        const status = payload?.status;
        if (status && typeof status === 'object') {
          setStreamSessionStatus(getStores(), targetSessionId, status);
          d.setSessionStatusMap((prev: Record<string, any>) => ({ ...prev, [targetSessionId]: status }));
          d.setStreaming(status.type !== 'idle');
        }
      } catch (err) {
        d.pushConnLog(`SSE session_status parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('message' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamMessageInfo(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE message parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('message_removed' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamMessageRemoved(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE message_removed parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('todo' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamTodo(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE todo parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('permission' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamPermission(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE permission parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('permission_replied' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamPermissionReplied(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE permission_replied parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('question' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamQuestion(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE question parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('question_removed' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyStreamQuestionRemoved(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE question_removed parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('assistant_message' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        const messageId = toText(payload?.messageId || payload?.messageID).trim();
        d.streamDebug('sse.assistant_message', { sid: targetSessionId, messageId });
        if (messageId) markStreamAssistantMessage(targetSessionId, messageId);
      } catch (err) {
        d.pushConnLog(`SSE assistant_message parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('delta' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        d.streamDebug('sse.delta.event', { sid: targetSessionId, keys: payload && typeof payload === 'object' ? Object.keys(payload).join(',') : typeof payload });
        handleDeltaPayload(payload);
      } catch (err) {
        d.pushConnLog(`SSE delta parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('part' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        const payload = parseSseData(event);
        d.streamDebug('sse.part.event', { sid: targetSessionId, keys: payload && typeof payload === 'object' ? Object.keys(payload).join(',') : typeof payload });
        handlePartPayload(payload);
      } catch (err) {
        d.pushConnLog(`SSE part parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('part_removed' as any, (event: any) => {
      if (!isCurrentStream()) return;
      try {
        applyPartRemoved(targetSessionId, parseSseData(event));
      } catch (err) {
        d.pushConnLog(`SSE part_removed parse failed ${String(err)}`, 'error');
      }
    });
    es.addEventListener('stream_fallback' as any, (event: any) => {
      if (!isCurrentStream()) return;
      d.pushConnLog(`SSE fallback ${toText(event?.data) || 'message-snapshot'}`);
      syncFromServer();
    });
    es.addEventListener('heartbeat' as any, () => {
      if (!isCurrentStream()) return;
      d.pushConnLog('SSE heartbeat');
    });
    es.addEventListener('end' as any, () => {
      if (!isCurrentStream()) return;
      d.pushConnLog('SSE end');
      d.streamDebug('sse.end', { sid: targetSessionId });
      streamClosed = true;
      d.sessionStatusEpochRef.current += 1;
      d.streamSessionRef.current = '';
      scheduleStreamTypewriterDrain();
      if (d.streamRef.current === es) {
        es.close();
        d.streamRef.current = null;
      }
      d.setStreaming(false);
      d.setSessionStatusMap((prev: Record<string, any>) => ({ ...prev, [targetSessionId]: { type: 'idle' } }));
      d.setStatus('本轮回复完成');
      void d.syncSessionMessages(targetSessionId, { tailOnly: true }).finally(() => {
        if (d.streamRunIdRef.current !== streamRunId || d.sessionIdRef.current !== targetSessionId) return;
        d.setStreaming(false);
        d.setSessionStatusMap((prev: Record<string, any>) => ({ ...prev, [targetSessionId]: { type: 'idle' } }));
      });
    });
  }, [getDeps, shouldFollowLatest, stopStream]);

  return { startStream, stopStream };
}

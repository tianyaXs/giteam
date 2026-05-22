import { useCallback, useRef } from 'react';
import { toText } from '../../lib/text';
import {
  getStoredStreamPart as storeGetStoredStreamPart,
  ingestStreamRows as storeIngestStreamRows,
  mergeStreamPart as storeMergeStreamPart,
  patchStoredStreamPartDelta as storePatchStoredStreamPartDelta,
  publishStreamRows as storePublishStreamRows,
  rawMessageId as storeRawMessageId,
  rawMessageRole as storeRawMessageRole,
  rawPartId as storeRawPartId,
  resetOpenCodeStreamStores as storeResetOpenCodeStreamStores,
  shouldStoreStreamPart as storeShouldStoreStreamPart,
  type OpenCodeStreamStoreRefs,
  type StreamPartEvent
} from '../messages/opencodeStore';

type TypewriterQueueItem = {
  sid: string;
  messageId: string;
  partId: string;
  field: string;
  text: string;
};

type UseOpenCodeStreamRuntimeParams = {
  initialSessionLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  streamMessageRoleRef: React.MutableRefObject<Record<string, Record<string, string>>>;
  streamMessageStoreRef: React.MutableRefObject<Record<string, Record<string, any>>>;
  streamPartStoreRef: React.MutableRefObject<Record<string, Record<string, Record<string, any>>>>;
  streamPendingPartEventsRef: React.MutableRefObject<Record<string, Record<string, StreamPartEvent[]>>>;
  streamRenderTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  streamTypewriterTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  streamTypewriterQueueRef: React.MutableRefObject<Record<string, TypewriterQueueItem>>;
  messageContentHRef: React.MutableRefObject<number>;
  messageViewportHRef: React.MutableRefObject<number>;
  messageScrollYRef: React.MutableRefObject<number>;
  messageUserScrollingRef: React.MutableRefObject<boolean>;
  forceScrollToLatestUntilRef: React.MutableRefObject<number>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  getOpenCodeStreamStores: () => OpenCodeStreamStoreRefs;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => any;
  scrollToLatest: (animated?: boolean) => void;
  streamDebug: (event: string, meta?: Record<string, unknown>) => void;
  setStreaming: (value: boolean | ((prev: boolean) => boolean)) => void;
};

function streamTypewriterChunkSize(length: number) {
  if (length > 480) return 18;
  if (length > 180) return 10;
  if (length > 64) return 6;
  return 3;
}

export function useOpenCodeStreamRuntime(params: UseOpenCodeStreamRuntimeParams) {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const getParams = useCallback(() => paramsRef.current, []);

  const rawMessageRole = useCallback((row: any) => storeRawMessageRole(row), []);
  const rawMessageId = useCallback((row: any) => storeRawMessageId(row), []);
  const rawPartId = useCallback((part: any, index = 0) => storeRawPartId(part, index), []);
  const mergeStreamPart = useCallback((prev: any, incoming: any) => storeMergeStreamPart(prev, incoming), []);

  const resetOpenCodeStreamStores = useCallback(() => {
    const d = getParams();
    storeResetOpenCodeStreamStores(d.getOpenCodeStreamStores());
  }, [getParams]);

  const publishStreamRows = useCallback((targetSessionId: string) => {
    const d = getParams();
    return storePublishStreamRows(d.getOpenCodeStreamStores(), targetSessionId);
  }, [getParams]);

  const ingestStreamRows = useCallback((targetSessionId: string, rows: any[]) => {
    const d = getParams();
    return storeIngestStreamRows(d.getOpenCodeStreamStores(), targetSessionId, rows);
  }, [getParams]);

  const getStoredStreamPart = useCallback((targetSessionId: string, messageId: string, partId: string) => {
    const d = getParams();
    return storeGetStoredStreamPart(d.getOpenCodeStreamStores(), targetSessionId, messageId, partId);
  }, [getParams]);

  const patchStoredStreamPartDelta = useCallback((targetSessionId: string, messageId: string, partId: string, field: string, delta: string) => {
    const d = getParams();
    return storePatchStoredStreamPartDelta(d.getOpenCodeStreamStores(), targetSessionId, messageId, partId, field, delta);
  }, [getParams]);

  const ensureStreamSessionStores = useCallback((targetSessionId: string) => {
    const d = getParams();
    const sid = toText(targetSessionId).trim();
    if (!sid) return '';
    if (!d.streamMessageStoreRef.current[sid]) d.streamMessageStoreRef.current[sid] = {};
    if (!d.streamPartStoreRef.current[sid]) d.streamPartStoreRef.current[sid] = {};
    if (!d.streamMessageRoleRef.current[sid]) d.streamMessageRoleRef.current[sid] = {};
    return sid;
  }, [getParams]);

  const renderStreamWindowRef = useRef<(targetSessionId: string) => void>(() => {});
  const applyAssistantDeltaNowRef = useRef<(targetSessionId: string, payload: unknown) => void>(() => {});
  const applyAssistantPartNowRef = useRef<(targetSessionId: string, payload: unknown) => void>(() => {});
  const applyPartRemovedNowRef = useRef<(targetSessionId: string, payload: unknown) => void>(() => {});
  const scheduleStreamRenderRef = useRef<(targetSessionId: string) => void>(() => {});
  const scheduleStreamTypewriterDrainRef = useRef<() => void>(() => {});

  const rewriteStreamMessageRow = useCallback((targetSessionId: string, messageId: string, createdAt: number = Date.now()) => {
    const d = getParams();
    const sid = ensureStreamSessionStores(targetSessionId);
    if (!sid) return;
    const partMap = d.streamPartStoreRef.current[sid]?.[messageId] || {};
    const parts = Object.values(partMap);
    d.streamDebug('stream.row.rewrite', {
      sid: targetSessionId,
      messageId,
      parts: parts.map((p: any) => `${p?.type || '?'}:${toText(p?.text).length}`).join(',')
    });
    const currentInfo = d.streamMessageStoreRef.current[sid]?.[messageId] || {};
    d.streamMessageStoreRef.current[sid][messageId] = {
      ...currentInfo,
      id: messageId,
      role: 'assistant',
      time: currentInfo.time || { created: createdAt }
    };
    d.streamMessageRoleRef.current[sid] = { ...(d.streamMessageRoleRef.current[sid] || {}), [messageId]: 'assistant' };
    publishStreamRows(sid);
  }, [ensureStreamSessionStores, getParams, publishStreamRows]);

  const upsertStreamPart = useCallback((targetSessionId: string, messageId: string, part: any, createdAt: number = Date.now()) => {
    const d = getParams();
    if (!storeShouldStoreStreamPart(part)) return;
    const partId = rawPartId(part, Object.keys(d.streamPartStoreRef.current[targetSessionId]?.[messageId] || {}).length);
    if (!targetSessionId || !messageId || !partId) return;
    const sid = ensureStreamSessionStores(targetSessionId);
    if (!sid) return;
    const byMessage = d.streamPartStoreRef.current[sid] || {};
    const existingParts = byMessage[messageId] || {};
    const nextPart = { ...(existingParts[partId] || {}), ...part, id: partId, messageID: messageId };
    byMessage[messageId] = { ...existingParts, [partId]: mergeStreamPart(existingParts[partId], nextPart) };
    d.streamPartStoreRef.current[sid] = byMessage;
    rewriteStreamMessageRow(targetSessionId, messageId, createdAt);
  }, [ensureStreamSessionStores, getParams, mergeStreamPart, rawPartId, rewriteStreamMessageRow]);

  const dropPendingStreamPartEvents = useCallback((targetSessionId: string, messageId: string) => {
    const d = getParams();
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    const bySession = d.streamPendingPartEventsRef.current[sid];
    if (!bySession || !bySession[mid]) return;
    d.streamDebug('stream.part.drop', { sid, messageId: mid, count: bySession[mid].length });
    delete bySession[mid];
  }, [getParams]);

  const flushPendingStreamPartEvents = useCallback((targetSessionId: string, messageId: string) => {
    const d = getParams();
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    const bySession = d.streamPendingPartEventsRef.current[sid];
    const pending = bySession?.[mid] || [];
    if (pending.length <= 0) return;
    delete bySession[mid];
    d.streamDebug('stream.part.flush', { sid, messageId: mid, count: pending.length });
    for (const event of pending) {
      if (event.kind === 'delta') applyAssistantDeltaNowRef.current(sid, event.payload);
      else if (event.kind === 'part') applyAssistantPartNowRef.current(sid, event.payload);
      else applyPartRemovedNowRef.current(sid, event.payload);
    }
  }, [getParams]);

  const recordStreamMessageRoles = useCallback((targetSessionId: string, rows: any[]) => {
    const d = getParams();
    const sid = toText(targetSessionId).trim();
    if (!sid || !Array.isArray(rows)) return;
    const roleStore = d.streamMessageRoleRef.current[sid] || {};
    for (const row of rows) {
      const mid = rawMessageId(row);
      const role = roleStore[mid] || rawMessageRole(row);
      if (!mid || !role) continue;
      if (role === 'assistant') flushPendingStreamPartEvents(sid, mid);
      else dropPendingStreamPartEvents(sid, mid);
    }
  }, [dropPendingStreamPartEvents, flushPendingStreamPartEvents, getParams, rawMessageId, rawMessageRole]);

  const enqueueStreamTypewriterDelta = useCallback((targetSessionId: string, messageId: string, partId: string, field: string, delta: string) => {
    const d = getParams();
    const sid = toText(targetSessionId).trim();
    const mid = toText(messageId).trim();
    const pid = toText(partId).trim();
    const key = `${sid}:${mid}:${pid}:${field}`;
    if (!sid || !mid || !pid || !field || !delta) return;
    const current = d.streamTypewriterQueueRef.current[key];
    d.streamTypewriterQueueRef.current[key] = {
      sid,
      messageId: mid,
      partId: pid,
      field,
      text: `${current?.text || ''}${delta}`
    };
    scheduleStreamTypewriterDrainRef.current();
  }, [getParams]);

  const applyAssistantDeltaNow = useCallback((targetSessionId: string, payload: unknown) => {
    const d = getParams();
    if (targetSessionId !== d.sessionIdRef.current) return;
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const messageId = toText(source?.messageId || source?.messageID).trim();
    const partId = toText(source?.partId || source?.partID).trim() || 'text';
    const field = toText(source?.field).trim();
    const delta = typeof source?.delta === 'string' ? source.delta : '';
    const kind = toText(source?.type).trim() || (field === 'reasoning' ? 'reasoning' : 'text');
    d.streamDebug('delta.received', { sid: targetSessionId, messageId, partId, field, kind, deltaLen: delta.length, deltaPreview: delta.slice(0, 40) });
    if (!messageId || !delta) {
      d.streamDebug('delta.ignored', { reason: 'missing messageId or delta', messageId, deltaLen: delta.length });
      return;
    }
    enqueueStreamTypewriterDelta(targetSessionId, messageId, partId, field || 'text', delta);
    const nextLen = toText(getStoredStreamPart(targetSessionId, messageId, partId)?.[field || 'text']).length + delta.length;
    d.streamDebug('delta.enqueued', { sid: targetSessionId, messageId, partId, kind, totalLen: nextLen });
    d.setStreaming(true);
  }, [enqueueStreamTypewriterDelta, getParams, getStoredStreamPart]);

  const applyAssistantPartNow = useCallback((targetSessionId: string, payload: unknown) => {
    const d = getParams();
    if (targetSessionId !== d.sessionIdRef.current) return;
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const part = source?.part;
    const messageId = toText(source?.messageId || source?.messageID || part?.messageID || part?.messageId).trim();
    if (!messageId || !part || typeof part !== 'object') return;
    upsertStreamPart(targetSessionId, messageId, part);
    flushPendingStreamPartEvents(targetSessionId, messageId);
    renderStreamWindowRef.current(targetSessionId);
    if (!d.messageUserScrollingRef.current) {
      d.forceScrollToLatestUntilRef.current = Date.now() + 45000;
      requestAnimationFrame(() => d.scrollToLatest(false));
    }
    d.setStreaming(true);
  }, [flushPendingStreamPartEvents, getParams, upsertStreamPart]);

  const applyPartRemovedNow = useCallback((targetSessionId: string, payload: unknown) => {
    const d = getParams();
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionId || source?.sessionID || targetSessionId).trim();
    const messageId = toText(source?.messageId || source?.messageID).trim();
    const partId = toText(source?.partId || source?.partID).trim();
    if (!sid || sid !== d.sessionIdRef.current || !messageId || !partId) return;
    const partMap = d.streamPartStoreRef.current[sid]?.[messageId];
    if (!partMap?.[partId]) return;
    delete partMap[partId];
    if (Object.keys(partMap).length === 0 && d.streamPartStoreRef.current[sid]) delete d.streamPartStoreRef.current[sid][messageId];
    publishStreamRows(sid);
    renderStreamWindowRef.current(sid);
  }, [getParams, publishStreamRows]);

  const scheduleStreamTypewriterDrain = useCallback(() => {
    const d = getParams();
    if (d.streamTypewriterTimerRef.current) return;
    d.streamTypewriterTimerRef.current = setTimeout(() => {
      const latest = getParams();
      latest.streamTypewriterTimerRef.current = null;
      const entries = Object.entries(latest.streamTypewriterQueueRef.current);
      if (entries.length === 0) return;
      const touchedSessions = new Set<string>();
      for (const [key, item] of entries) {
        if (item.sid !== latest.sessionIdRef.current) {
          delete latest.streamTypewriterQueueRef.current[key];
          continue;
        }
        const take = streamTypewriterChunkSize(item.text.length);
        const chunk = item.text.slice(0, take);
        const rest = item.text.slice(take);
        if (chunk) {
          const ok = patchStoredStreamPartDelta(item.sid, item.messageId, item.partId, item.field, chunk);
          if (ok) touchedSessions.add(item.sid);
        }
        if (rest) latest.streamTypewriterQueueRef.current[key] = { ...item, text: rest };
        else delete latest.streamTypewriterQueueRef.current[key];
      }
      touchedSessions.forEach((sid) => scheduleStreamRenderRef.current(sid));
      if (Object.keys(latest.streamTypewriterQueueRef.current).length > 0) {
        latest.streamTypewriterTimerRef.current = setTimeout(() => {
          latest.streamTypewriterTimerRef.current = null;
          scheduleStreamTypewriterDrainRef.current();
        }, 16);
      }
    }, 16);
  }, [getParams, patchStoredStreamPartDelta]);

  const scheduleStreamRender = useCallback((targetSessionId: string) => {
    const d = getParams();
    if (d.streamRenderTimerRef.current) return;
    d.streamRenderTimerRef.current = setTimeout(() => {
      const latest = getParams();
      latest.streamRenderTimerRef.current = null;
      if (targetSessionId !== latest.sessionIdRef.current) return;
      const distanceFromBottom = Math.max(0, latest.messageContentHRef.current - latest.messageViewportHRef.current - latest.messageScrollYRef.current);
      const shouldFollowStream = !latest.messageUserScrollingRef.current && distanceFromBottom < 96;
      renderStreamWindowRef.current(targetSessionId);
      if (shouldFollowStream) {
        requestAnimationFrame(() => latest.scrollToLatest(false));
      }
    }, 24);
  }, [getParams]);

  const renderStreamWindow = useCallback((targetSessionId: string) => {
    const d = getParams();
    const totalTurns = Math.max(1, Number(d.sessionTotalTurnCountRef.current[targetSessionId] || d.initialSessionLimit));
    const visibleTurns = Math.max(d.initialSessionLimit, Number(d.sessionVisibleTurnCountRef.current[targetSessionId] || d.initialSessionLimit));
    const rendered = d.applyTurnWindow(targetSessionId, Math.min(totalTurns, visibleTurns));
    const last = rendered.renderedTurns[rendered.renderedTurns.length - 1];
    d.streamDebug('render.window', {
      sid: targetSessionId,
      turns: rendered.renderedTurns.length,
      writing: rendered.writing,
      lastTurn: last?.id,
      lastItems: last?.items?.map((item: any) => item.kind).join(',') || ''
    });
  }, [getParams]);

  applyAssistantDeltaNowRef.current = applyAssistantDeltaNow;
  applyAssistantPartNowRef.current = applyAssistantPartNow;
  applyPartRemovedNowRef.current = applyPartRemovedNow;
  renderStreamWindowRef.current = renderStreamWindow;
  scheduleStreamRenderRef.current = scheduleStreamRender;
  scheduleStreamTypewriterDrainRef.current = scheduleStreamTypewriterDrain;

  return {
    ingestStreamRows,
    publishStreamRows,
    recordStreamMessageRoles,
    renderStreamWindow,
    resetOpenCodeStreamStores
  };
}

import { useCallback, useRef } from 'react';
import { markMessageSendPerfForSession } from '../messages/messageSendPerf';
import { toText } from '../../lib/text';
import {
  isStreamTextPart,
  streamPartWriteField,
  STREAM_TYPEWRITER_TICK_MS,
  takeStreamTypewriterChunk
} from './streamTypewriter';
import {
  getStoredStreamPart as storeGetStoredStreamPart,
  ingestStreamRows as storeIngestStreamRows,
  listBucketParts,
  patchStoredStreamPartDelta as storePatchStoredStreamPartDelta,
  publishStreamRows as storePublishStreamRows,
  replaceStreamRows as storeReplaceStreamRows,
  rawMessageId as storeRawMessageId,
  rawMessageRole as storeRawMessageRole,
  removeStreamPartRecord as storeRemoveStreamPartRecord,
  resetOpenCodeStreamStores as storeResetOpenCodeStreamStores,
  shouldStoreStreamPart as storeShouldStoreStreamPart,
  upsertStreamPartRecord as storeUpsertStreamPartRecord,
  type OpenCodeStreamStoreRefs,
  type StreamPartEvent
} from '../messages/opencodeStore';

type TypewriterQueueItem = {
  sid: string;
  messageId: string;
  partId: string;
  field: string;
  text: string;
  partTypeHint?: string;
};

type UseOpenCodeStreamRuntimeParams = {
  initialSessionLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  streamMessageRoleRef: React.MutableRefObject<Record<string, Record<string, string>>>;
  streamMessageStoreRef: React.MutableRefObject<Record<string, Record<string, any>>>;
  streamPartStoreRef: React.MutableRefObject<Record<string, Record<string, import('../messages/opencodeStore').StreamPartBucket>>>;
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


export function useOpenCodeStreamRuntime(params: UseOpenCodeStreamRuntimeParams) {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const getParams = useCallback(() => paramsRef.current, []);

  const rawMessageRole = useCallback((row: any) => storeRawMessageRole(row), []);
  const rawMessageId = useCallback((row: any) => storeRawMessageId(row), []);
  const shouldFollowLatest = useCallback(() => {
    const d = getParams();
    const scrollY = Math.max(0, Number(d.messageScrollYRef.current || 0));
    const viewportH = Math.max(0, Number(d.messageViewportHRef.current || 0));
    const contentH = Math.max(0, Number(d.messageContentHRef.current || 0));
    const distanceFromBottom = contentH > 0 && viewportH > 0
      ? Math.max(0, contentH - viewportH - scrollY)
      : scrollY;
    return !d.messageUserScrollingRef.current && distanceFromBottom < 96;
  }, [getParams]);

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

  const replaceStreamRows = useCallback((targetSessionId: string, rows: any[]) => {
    const d = getParams();
    return storeReplaceStreamRows(d.getOpenCodeStreamStores(), targetSessionId, rows);
  }, [getParams]);

  const getStoredStreamPart = useCallback((targetSessionId: string, messageId: string, partId: string) => {
    const d = getParams();
    return storeGetStoredStreamPart(d.getOpenCodeStreamStores(), targetSessionId, messageId, partId);
  }, [getParams]);

  const patchStoredStreamPartDelta = useCallback((
    targetSessionId: string,
    messageId: string,
    partId: string,
    field: string,
    delta: string,
    partTypeHint?: string,
  ) => {
    const d = getParams();
    return storePatchStoredStreamPartDelta(
      d.getOpenCodeStreamStores(),
      targetSessionId,
      messageId,
      partId,
      field,
      delta,
      partTypeHint,
    );
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
    const bucket = d.streamPartStoreRef.current[sid]?.[messageId];
    const parts = listBucketParts(bucket);
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
    if (!storeShouldStoreStreamPart(part)) return;
    if (!targetSessionId || !messageId) return;
    storeUpsertStreamPartRecord(getParams().getOpenCodeStreamStores(), targetSessionId, messageId, part);
    rewriteStreamMessageRow(targetSessionId, messageId, createdAt);
  }, [getParams, rewriteStreamMessageRow]);

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

  const enqueueStreamTypewriterDelta = useCallback((
    targetSessionId: string,
    messageId: string,
    partId: string,
    field: string,
    delta: string,
    partTypeHint?: string,
  ) => {
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
      text: `${current?.text || ''}${delta}`,
      partTypeHint: partTypeHint || current?.partTypeHint
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
    const writeField = streamPartWriteField(field, kind);
    enqueueStreamTypewriterDelta(targetSessionId, messageId, partId, writeField, delta, kind);
    const nextLen = toText(getStoredStreamPart(targetSessionId, messageId, partId)?.text).length + delta.length;
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
    const partId = toText(part?.id || part?.partID).trim() || 'text';
    const incomingText = typeof part?.text === 'string' ? part.text : '';
    if (isStreamTextPart(part) && incomingText) {
      const stored = getStoredStreamPart(targetSessionId, messageId, partId);
      const prevText = toText(stored?.text);
      const queueKey = `${targetSessionId}:${messageId}:${partId}:text`;
      const queuedItem = d.streamTypewriterQueueRef.current[queueKey];
      const queuedText = toText(queuedItem?.text);
      const logicalText = `${prevText}${queuedText}`;
      if (incomingText === logicalText) {
        d.setStreaming(true);
        return;
      }
      if (incomingText.startsWith(logicalText)) {
        if (!stored) {
          upsertStreamPart(targetSessionId, messageId, { ...part, id: partId, messageID: messageId, text: prevText });
        }
        const delta = incomingText.slice(logicalText.length);
        if (delta.length > 0) {
          enqueueStreamTypewriterDelta(targetSessionId, messageId, partId, 'text', delta);
        }
        d.setStreaming(true);
        return;
      }
      if (logicalText.startsWith(incomingText) && incomingText.length < logicalText.length) {
        d.setStreaming(true);
        return;
      }
      delete d.streamTypewriterQueueRef.current[queueKey];
      upsertStreamPart(targetSessionId, messageId, { ...part, id: partId, messageID: messageId, text: incomingText });
      flushPendingStreamPartEvents(targetSessionId, messageId);
      renderStreamWindowRef.current(targetSessionId);
      d.setStreaming(true);
      return;
    }
    upsertStreamPart(targetSessionId, messageId, part);
    flushPendingStreamPartEvents(targetSessionId, messageId);
    renderStreamWindowRef.current(targetSessionId);
    if (shouldFollowLatest()) {
      d.forceScrollToLatestUntilRef.current = Date.now() + 45000;
    }
    d.setStreaming(true);
  }, [flushPendingStreamPartEvents, getParams, shouldFollowLatest, upsertStreamPart]);

  const applyPartRemovedNow = useCallback((targetSessionId: string, payload: unknown) => {
    const d = getParams();
    const source = ((payload as any)?.properties && typeof (payload as any).properties === 'object') ? (payload as any).properties : (payload as any);
    const sid = toText(source?.sessionId || source?.sessionID || targetSessionId).trim();
    const messageId = toText(source?.messageId || source?.messageID).trim();
    const partId = toText(source?.partId || source?.partID).trim();
    if (!sid || sid !== d.sessionIdRef.current || !messageId || !partId) return;
    storeRemoveStreamPartRecord(d.getOpenCodeStreamStores(), sid, messageId, partId);
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
        if (rest) latest.streamTypewriterQueueRef.current[key] = { ...item, text: rest };
        else delete latest.streamTypewriterQueueRef.current[key];
      }
      touchedSessions.forEach((sid) => scheduleStreamRenderRef.current(sid));
      if (Object.keys(latest.streamTypewriterQueueRef.current).length > 0) {
        latest.streamTypewriterTimerRef.current = setTimeout(() => {
          latest.streamTypewriterTimerRef.current = null;
          scheduleStreamTypewriterDrainRef.current();
        }, STREAM_TYPEWRITER_TICK_MS);
      }
    }, STREAM_TYPEWRITER_TICK_MS);
  }, [getParams, patchStoredStreamPartDelta]);

  const scheduleStreamRender = useCallback((targetSessionId: string) => {
    const d = getParams();
    if (d.streamRenderTimerRef.current) return;
    d.streamRenderTimerRef.current = setTimeout(() => {
      const latest = getParams();
      latest.streamRenderTimerRef.current = null;
      if (targetSessionId !== latest.sessionIdRef.current) return;
      const shouldFollowStream = shouldFollowLatest();
      renderStreamWindowRef.current(targetSessionId);
      if (shouldFollowStream) {
        latest.forceScrollToLatestUntilRef.current = Date.now() + 45000;
      }
    }, 24);
  }, [getParams, shouldFollowLatest]);

  const renderStreamWindow = useCallback((targetSessionId: string) => {
    const d = getParams();
    const renderStartedAt = performance.now();
    markMessageSendPerfForSession(targetSessionId, 'stream.render_window.begin');
    const totalTurns = Math.max(1, Number(d.sessionTotalTurnCountRef.current[targetSessionId] || d.initialSessionLimit));
    const visibleTurns = Math.max(d.initialSessionLimit, Number(d.sessionVisibleTurnCountRef.current[targetSessionId] || d.initialSessionLimit));
    const rendered = d.applyTurnWindow(targetSessionId, Math.min(totalTurns, visibleTurns));
    const last = rendered.renderedTurns[rendered.renderedTurns.length - 1];
    markMessageSendPerfForSession(targetSessionId, 'stream.render_window.done', {
      ms: Math.round(performance.now() - renderStartedAt),
      turns: rendered.renderedTurns.length,
      writing: rendered.writing ? 1 : 0,
      lastItems: last?.items?.map((item: any) => item.kind).join(',') || ''
    });
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
    replaceStreamRows,
    publishStreamRows,
    recordStreamMessageRoles,
    renderStreamWindow,
    resetOpenCodeStreamStores
  };
}

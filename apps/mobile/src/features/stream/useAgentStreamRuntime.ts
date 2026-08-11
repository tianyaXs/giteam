import { useCallback, useRef } from 'react';
import { markMessageSendPerfForSession } from '../messages/messageSendPerf';
import { toText } from '../../lib/text';
import {
  ingestStreamRows as storeIngestStreamRows,
  publishStreamRows as storePublishStreamRows,
  replaceStreamRows as storeReplaceStreamRows,
  rawMessageId as storeRawMessageId,
  rawMessageRole as storeRawMessageRole,
  resetAgentStreamStores as storeResetAgentStreamStores,
  type AgentStreamStoreRefs
} from '../messages/agentStreamStore';

type UseAgentStreamRuntimeParams = {
  initialSessionLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  streamRenderTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  messageContentHRef: React.MutableRefObject<number>;
  messageViewportHRef: React.MutableRefObject<number>;
  messageScrollYRef: React.MutableRefObject<number>;
  messageUserScrollingRef: React.MutableRefObject<boolean>;
  forceScrollToLatestUntilRef: React.MutableRefObject<number>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  getAgentStreamStores: () => AgentStreamStoreRefs;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => any;
  scrollToLatest: (animated?: boolean) => void;
  streamDebug: (event: string, meta?: Record<string, unknown>) => void;
  setStreaming: (value: boolean | ((prev: boolean) => boolean)) => void;
};

/**
 * pi_agent 流式渲染运行时：partial 快照语义（replace-per-block），
 * 不再需要 typewriter 队列与 pending part 事件缓冲。
 */
export function useAgentStreamRuntime(params: UseAgentStreamRuntimeParams) {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const getParams = useCallback(() => paramsRef.current, []);

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

  const resetAgentStreamStores = useCallback(() => {
    const d = getParams();
    storeResetAgentStreamStores(d.getAgentStreamStores());
  }, [getParams]);

  const publishStreamRows = useCallback((targetSessionId: string) => {
    const d = getParams();
    return storePublishStreamRows(d.getAgentStreamStores(), targetSessionId);
  }, [getParams]);

  const ingestStreamRows = useCallback((targetSessionId: string, rows: any[]) => {
    const d = getParams();
    return storeIngestStreamRows(d.getAgentStreamStores(), targetSessionId, rows);
  }, [getParams]);

  const replaceStreamRows = useCallback((targetSessionId: string, rows: any[]) => {
    const d = getParams();
    return storeReplaceStreamRows(d.getAgentStreamStores(), targetSessionId, rows);
  }, [getParams]);

  const recordStreamMessageRoles = useCallback((targetSessionId: string, rows: any[]) => {
    const d = getParams();
    const sid = toText(targetSessionId).trim();
    if (!sid || !Array.isArray(rows)) return;
    const stores = d.getAgentStreamStores();
    const roleStore = stores.messageRole.current[sid] || {};
    for (const row of rows) {
      const mid = storeRawMessageId(row);
      const role = roleStore[mid] || storeRawMessageRole(row);
      if (!mid || !role) continue;
      roleStore[mid] = role;
    }
    stores.messageRole.current[sid] = roleStore;
  }, [getParams]);

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

  const scheduleStreamRender = useCallback((targetSessionId: string) => {
    const d = getParams();
    if (d.streamRenderTimerRef.current) return;
    d.streamRenderTimerRef.current = setTimeout(() => {
      const latest = getParams();
      latest.streamRenderTimerRef.current = null;
      if (targetSessionId !== latest.sessionIdRef.current) return;
      const shouldFollowStream = shouldFollowLatest();
      renderStreamWindow(targetSessionId);
      if (shouldFollowStream) {
        latest.forceScrollToLatestUntilRef.current = Date.now() + 45000;
      }
    }, 48);
  }, [getParams, renderStreamWindow, shouldFollowLatest]);

  return {
    ingestStreamRows,
    replaceStreamRows,
    publishStreamRows,
    recordStreamMessageRoles,
    renderStreamWindow,
    scheduleStreamRender,
    resetAgentStreamStores
  };
}

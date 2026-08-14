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
  streamRenderTimerRef: React.MutableRefObject<number | null>;
  messageContentHRef: React.MutableRefObject<number>;
  messageViewportHRef: React.MutableRefObject<number>;
  messageScrollYRef: React.MutableRefObject<number>;
  messageUserScrollingRef: React.MutableRefObject<boolean>;
  forceScrollToLatestUntilRef: React.MutableRefObject<number>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  getAgentStreamStores: () => AgentStreamStoreRefs;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string, opts?: { streaming?: boolean }) => any;
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
    const rendered = d.applyTurnWindow(targetSessionId, Math.min(totalTurns, visibleTurns), undefined, { streaming: true });
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

  // rAF 帧对齐：一帧内无论来多少 delta 只渲染一次，且与 vsync 同步。
  // 原 setTimeout(24ms) 不对齐帧、上限 ~41fps，主线程忙时还会再推迟，
  // 表现为文字阶梯式跳动/攒批。rAF 让「事件到达 → 下一帧必渲染」。
  const scheduleStreamRender = useCallback((targetSessionId: string) => {
    const d = getParams();
    if (d.streamRenderTimerRef.current != null) return;
    d.streamRenderTimerRef.current = requestAnimationFrame(() => {
      const latest = getParams();
      latest.streamRenderTimerRef.current = null;
      if (targetSessionId !== latest.sessionIdRef.current) return;
      const shouldFollowStream = shouldFollowLatest();
      renderStreamWindow(targetSessionId);
      if (shouldFollowStream) {
        latest.forceScrollToLatestUntilRef.current = Date.now() + 45000;
      }
    });
  }, [getParams, renderStreamWindow, shouldFollowLatest]);

  // 即时冲刷：工具/交互等离散事件（对齐桌面端 tool.started 里的 flushStreamUpdates），
  // 越过 rAF 合帧立刻渲染，保证「搜索/审批」等过程状态第一时间可见。
  const flushStreamRenderNow = useCallback((targetSessionId: string) => {
    const d = getParams();
    if (d.streamRenderTimerRef.current != null) {
      cancelAnimationFrame(d.streamRenderTimerRef.current);
      d.streamRenderTimerRef.current = null;
    }
    if (targetSessionId !== d.sessionIdRef.current) return;
    const shouldFollowStream = shouldFollowLatest();
    renderStreamWindow(targetSessionId);
    if (shouldFollowStream) {
      d.forceScrollToLatestUntilRef.current = Date.now() + 45000;
    }
  }, [getParams, renderStreamWindow, shouldFollowLatest]);

  return {
    ingestStreamRows,
    replaceStreamRows,
    publishStreamRows,
    recordStreamMessageRoles,
    renderStreamWindow,
    scheduleStreamRender,
    flushStreamRenderNow,
    resetAgentStreamStores
  };
}

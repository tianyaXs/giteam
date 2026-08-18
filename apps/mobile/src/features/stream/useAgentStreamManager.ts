import { useCallback, useRef } from 'react';
import { createMobileAgentClient } from '../../api/agent/client';
import {
  agentMessageToLegacyRow,
  streamTextPart,
  streamToolPart
} from '../../api/agent/adapter';
import { agentStatusToLegacy } from '../../api/agent/bridge';
import type { AgentEvent, AgentInteraction, AgentMessage } from '../../api/agent/types';
import { pairAuth } from '../../api/controlApi';
import { parseAgentTodoItems } from '../../lib/agentParts';
import { toText } from '../../lib/text';
import {
  canApplyStreamPartUpdate as storeCanApplyStreamPartUpdate,
  ensureStreamSessionStores as storeEnsureStreamSessionStores,
  getStoredStreamPart as storeGetStoredStreamPart,
  ingestStreamRows as storeIngestStreamRows,
  publishStreamRows as storePublishStreamRows,
  resetAgentStreamStores as storeResetAgentStreamStores,
  upsertStreamPartRecord as storeUpsertStreamPartRecord,
  type AgentStreamStoreRefs
} from '../messages/agentStreamStore';
import { humanizeAgentError } from '../../lib/humanizeAgentError';
import { applySubagentChildEventToMetadata, mergeToolPartState } from '../../lib/subagentTimeline';

export interface AgentStreamManagerDeps {
  authed: boolean;
  serverUrl: string;
  token: string;
  pairCode: string;
  sessionIdRef: React.MutableRefObject<string>;
  streamRef: React.MutableRefObject<{ close: () => void } | null>;
  streamRunIdRef: React.MutableRefObject<number>;
  streamSessionRef: React.MutableRefObject<string>;
  sessionActiveRunIdRef: React.MutableRefObject<Record<string, string>>;
  sessionRunEventSeenRef: React.MutableRefObject<Record<string, boolean>>;
  sessionStatusEpochRef: React.MutableRefObject<number>;
  streamRenderTimerRef: React.MutableRefObject<number | null>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  getAgentStreamStores: () => AgentStreamStoreRefs;
  pushConnLog: (msg: string, level?: 'error' | 'info') => void;
  streamDebug: (event: string, meta?: Record<string, unknown>) => void;
  setStreaming: (value: boolean | ((prev: boolean) => boolean)) => void;
  setStatus: (value: string | ((prev: string) => string)) => void;
  setToken: (value: string) => void;
  setSessionStatusMap: (value: React.SetStateAction<Record<string, any>>) => void;
  setStreamTodoCard: (value: any) => void;
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string, opts?: { streaming?: boolean }) => any;
  syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number; tailOnly?: boolean }) => Promise<any>;
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
  buildLiveTodoCard: (sid: string, todos: any[]) => any;
  onInteractionRequested: (interaction: AgentInteraction) => void;
  onInteractionResolved: (interactionId: string) => void;
  renderStreamWindow: (targetSessionId: string) => void;
  scheduleStreamRender: (targetSessionId: string) => void;
  /** 越过 rAF 合帧立即渲染（离散事件：工具/交互/子代理状态变更）。 */
  flushStreamRenderNow: (targetSessionId: string) => void;
  /** prompt 已接受后由 SSE 终态收口：成功清快照，失败把附件收回输入区。 */
  onRunSettled?: (sid: string, runId: string, outcome: 'completed' | 'failed') => void;
}

function isAbortLikeStreamError(detail: string) {
  const text = toText(detail).toLowerCase();
  return text.includes('messageabortederror') || text.includes('the operation was aborted') || text.includes('aborted');
}

/** SSE 丢 delta / 丢 run.completed 时，靠磁盘对账兜底的间隔。 */
const BUSY_SYNC_WATCHDOG_MS = 8000;
/** 断流后按 afterSeq soft-reconnect 的上限与基础退避。 */
const SSE_SOFT_RECONNECT_MAX = 5;
const SSE_SOFT_RECONNECT_BASE_MS = 400;

/**
 * pi_agent SSE 流管理：订阅 /api/v1/agent/stream（sessionId + runId），
 * 事件 → legacy 行 store → parseConversation 渲染契约保持不变。
 */
export function useAgentStreamManager(deps: AgentStreamManagerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const busyWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getDeps = useCallback(() => depsRef.current, []);

  const clearBusyWatchdog = useCallback(() => {
    if (busyWatchdogRef.current != null) {
      clearInterval(busyWatchdogRef.current);
      busyWatchdogRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    const d = getDeps();
    clearBusyWatchdog();
    d.streamRunIdRef.current += 1;
    d.sessionStatusEpochRef.current += 1;
    if (d.streamRef.current) {
      d.pushConnLog('SSE close');
      d.streamRef.current.close();
      d.streamRef.current = null;
    }
    if (d.streamRenderTimerRef.current != null) {
      cancelAnimationFrame(d.streamRenderTimerRef.current);
      d.streamRenderTimerRef.current = null;
    }
    d.streamSessionRef.current = '';
    storeResetAgentStreamStores(d.getAgentStreamStores());
    d.setStreamTodoCard(null);
    d.setStreaming(false);
  }, [clearBusyWatchdog, getDeps]);

  const startStream = useCallback((targetSessionId: string, explicitRunId?: string) => {
    const d = getDeps();
    if (!d.authed || !d.serverUrl || !targetSessionId) {
      stopStream();
      return;
    }
    const runId = toText(explicitRunId).trim() || toText(d.sessionActiveRunIdRef.current[targetSessionId]).trim();
    if (!runId) {
      d.pushConnLog(`SSE skip sid=${targetSessionId} reason=no-active-run`);
      return;
    }

    // 同 session + 同 run 重连（锁屏恢复）：只换 SSE，勿掏空 message/part store，避免列表大闪。
    const prevSid = toText(d.streamSessionRef.current).trim();
    const prevRun = toText(d.sessionActiveRunIdRef.current[targetSessionId]).trim();
    const softReconnect = prevSid === targetSessionId && prevRun === runId;

    clearBusyWatchdog();
    d.streamRunIdRef.current += 1;
    d.sessionStatusEpochRef.current += 1;
    if (d.streamRef.current) {
      d.pushConnLog(softReconnect ? 'SSE reconnect (keep stores)' : 'SSE close');
      d.streamRef.current.close();
      d.streamRef.current = null;
    }
    if (d.streamRenderTimerRef.current != null) {
      cancelAnimationFrame(d.streamRenderTimerRef.current);
      d.streamRenderTimerRef.current = null;
    }
    if (!softReconnect) {
      storeResetAgentStreamStores(d.getAgentStreamStores());
      d.setStreamTodoCard(null);
    }
    // 已知 run 在飞：保持 streaming，勿先 false 再 true（会抖成可发送 / 待机粒子）。
    d.setStreaming(true);

    d.sessionActiveRunIdRef.current[targetSessionId] = runId;
    d.sessionRunEventSeenRef.current[runId] = false;
    const streamRunId = d.streamRunIdRef.current;
    d.streamSessionRef.current = targetSessionId;

    const client = createMobileAgentClient({ baseUrl: d.serverUrl, token: d.token });
    const stores = () => d.getAgentStreamStores();
    let streamClosed = false;
    let lastSeq = 0;
    let softReconnectAttempts = 0;
    let softReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sseGeneration = 0;
    const clearSoftReconnect = () => {
      if (softReconnectTimer != null) {
        clearTimeout(softReconnectTimer);
        softReconnectTimer = null;
      }
    };
    // 不依赖 streamRef：soft-reconnect 关旧开新的间隙里 ref 可能为空，对账仍需认当前 run。
    const isCurrentStream = () =>
      !streamClosed &&
      d.streamRunIdRef.current === streamRunId &&
      d.streamSessionRef.current === targetSessionId &&
      d.sessionIdRef.current === targetSessionId;

    // toolCallId → 所属 assistant messageId（tool 事件本身不携带 messageId）。
    const toolCallMessageMap: Record<string, string> = {};
    let activeMessageId = '';

    const rewriteStreamMessageRow = (sid: string, messageId: string) => {
      storeEnsureStreamSessionStores(stores(), sid);
      const bucket = stores().part.current[sid]?.[messageId];
      const parts = bucket ? bucket.order.map((id) => bucket.byId[id]).filter(Boolean) : [];
      const currentInfo = stores().message.current[sid]?.[messageId] || {};
      stores().message.current[sid][messageId] = {
        ...currentInfo,
        id: messageId,
        role: 'assistant',
        time: currentInfo.time || { created: Date.now() }
      };
      stores().messageRole.current[sid] = { ...(stores().messageRole.current[sid] || {}), [messageId]: 'assistant' };
      storePublishStreamRows(stores(), sid);
    };

    const upsertAssistantPart = (sid: string, messageId: string, part: any) => {
      if (!messageId) return;
      stores().messageRole.current[sid] = { ...(stores().messageRole.current[sid] || {}), [messageId]: 'assistant' };
      storeUpsertStreamPartRecord(stores(), sid, messageId, part);
      rewriteStreamMessageRow(sid, messageId);
      if (sid === d.sessionIdRef.current) {
        d.setStreaming(true);
        d.scheduleStreamRender(sid);
      }
    };

    const applyTextDelta = (sid: string, kind: 'text' | 'reasoning', event: AgentEvent['event'], serverTs = 0) => {
      const messageId = toText(event.messageId).trim();
      if (!messageId) return;
      // 对齐桌面 ensureLocalAssistant：delta 可能早于 message.started，先建 assistant 坑再收字。
      storeEnsureStreamSessionStores(stores(), sid);
      const roles = stores().messageRole.current[sid] || {};
      if (roles[messageId] !== 'assistant') {
        stores().messageRole.current[sid] = { ...roles, [messageId]: 'assistant' };
      }
      if (!stores().message.current[sid]?.[messageId]) {
        // created 统一服务端时钟（envelope.timestampMs），理由同 message.started。
        stores().message.current[sid][messageId] = {
          id: messageId,
          role: 'assistant',
          time: { created: serverTs > 0 ? serverTs : Date.now() }
        };
      }
      if (!storeCanApplyStreamPartUpdate(stores(), sid, messageId)) return;
      const index = Math.max(0, Number(event.index || 0));
      const part = streamTextPart(messageId, kind, index, '');
      const partId = part.id as string;
      const partial = typeof event.partial === 'string' ? event.partial : '';
      const delta = typeof event.delta === 'string' ? event.delta : '';
      const stored = storeGetStoredStreamPart(stores(), sid, messageId, partId);
      const prevText = toText(stored?.text);
      // 优先 partial（replace-per-block 快照）；缺省时退化 delta 拼接。
      const nextText = partial || `${prevText}${delta}`;
      if (!nextText || nextText === prevText) return;
      upsertAssistantPart(sid, messageId, { ...part, text: nextText });
    };

    const upsertToolPart = (
      sid: string,
      toolCallId: string,
      toolName: string,
      state: {
        status: string;
        input?: unknown;
        output?: unknown;
        metadata?: Record<string, unknown>;
      }
    ) => {
      const messageId = toolCallMessageMap[toolCallId] || activeMessageId;
      if (!messageId) return;
      const existing = storeGetStoredStreamPart(stores(), sid, messageId, toolCallId);
      const mergedState = {
        status: state.status,
        input: state.input && typeof state.input === 'object' && Object.keys(state.input as object).length > 0
          ? state.input
          : existing?.state?.input,
        output: state.output !== undefined ? state.output : existing?.state?.output,
        metadata: {
          ...(existing?.state?.metadata && typeof existing.state.metadata === 'object'
            ? existing.state.metadata
            : {}),
          ...(state.metadata || {})
        }
      };
      upsertAssistantPart(sid, messageId, streamToolPart(toolCallId, toolName, mergedState));
      if (toolName === 'todowrite' && sid === d.sessionIdRef.current) {
        const todos = parseAgentTodoItems((mergedState.input as any)?.todos);
        if (todos.length > 0) d.setStreamTodoCard(d.buildLiveTodoCard(sid, todos));
      }
    };

    const applyMessageCompleted = (sid: string, message: AgentMessage) => {
      const row = agentMessageToLegacyRow(message, undefined, { live: false });
      if (!row) return;
      // 保留流式期间已写入的 tool output/status/metadata（message.completed 不携带 timeline）。
      for (const part of row.parts) {
        if (part?.type !== 'tool') continue;
        const stored = storeGetStoredStreamPart(stores(), sid, row.info.id, part.id);
        if (stored?.state) {
          part.state = mergeToolPartState(stored.state, {
            ...part.state,
            status: stored.state.status === 'error' ? 'error' : part.state.status,
            input: Object.keys(part.state?.input || {}).length > 0 ? part.state.input : stored.state.input,
            output: part.state.output || stored.state.output || '',
            error: part.state.error || stored.state.error
          });
        }
      }
      row.info.time = { ...(row.info.time || {}), completed: Date.now() };
      stores().messageRole.current[sid] = { ...(stores().messageRole.current[sid] || {}), [row.info.id]: 'assistant' };
      storeIngestStreamRows(stores(), sid, [row]);
      if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
    };

    const finalizeRun = (sid: string, failedError?: string) => {
      if (!isCurrentStream()) return;
      clearBusyWatchdog();
      clearSoftReconnect();
      d.pushConnLog(failedError ? `SSE run.failed ${failedError}` : 'SSE run.completed');
      streamClosed = true;
      sseGeneration += 1;
      d.sessionStatusEpochRef.current += 1;
      d.streamSessionRef.current = '';
      if (d.streamRef.current) {
        d.streamRef.current.close();
        d.streamRef.current = null;
      }
      if (failedError) {
        const friendly = humanizeAgentError(failedError);
        storeIngestStreamRows(stores(), sid, [{
          info: {
            id: `error:${runId}`,
            role: 'assistant',
            error: { message: friendly },
            time: { created: Date.now(), completed: Date.now() }
          },
          parts: []
        }]);
        d.setStatus(`运行失败: ${friendly}`);
      } else {
        d.setStatus('本轮回复完成');
      }
      // 立刻释放 busy/停止钮：tail sync 在长调研会话可达数十秒，若等 sync.finally 会「消息已结束但按钮不恢复」。
      if (d.sessionActiveRunIdRef.current[sid] === runId) {
        delete d.sessionActiveRunIdRef.current[sid];
      }
      delete d.sessionRunEventSeenRef.current[runId];
      d.setStreaming(false);
      d.setSessionStatusMap((prev: Record<string, any>) => ({
        ...prev,
        [sid]: { type: 'idle' }
      }));
      try {
        d.onRunSettled?.(sid, runId, failedError ? 'failed' : 'completed');
      } catch {
        // ignore settle errors — 不阻断流收口
      }
      if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
      void d.syncSessionMessages(sid, { tailOnly: true }).catch(() => undefined);
    };

    /** 云隧道丢 SSE 时常见：磁盘已写完，手机端却一直转圈。对账磁盘 + 服务端 active_runs。 */
    const reconcileFromServer = async (reason: string) => {
      if (!isCurrentStream()) return;
      if (d.sessionActiveRunIdRef.current[targetSessionId] !== runId) return;
      try {
        await d.syncSessionMessages(targetSessionId, { tailOnly: true });
        if (!isCurrentStream()) return;
        if (d.sessionActiveRunIdRef.current[targetSessionId] !== runId) return;
        // 勿用 syncSessionStatus：它只反映待裁决 interaction，流式中几乎总是 idle。
        const runStatus = await client.getRunStatus(runId);
        if (!isCurrentStream()) return;
        if (d.sessionActiveRunIdRef.current[targetSessionId] !== runId) return;
        if (!runStatus?.active) {
          d.pushConnLog(`SSE reconcile settle inactive sid=${targetSessionId} via=${reason}`);
          finalizeRun(targetSessionId);
        }
      } catch (error) {
        d.pushConnLog(`SSE reconcile error via=${reason} ${String(error)}`, 'info');
      }
    };

    const onEvent = (envelope: AgentEvent) => {
      if (!isCurrentStream()) return;
      if (envelope.sessionId !== targetSessionId || envelope.runId !== runId) return;
      const event = envelope.event;
      if (!event?.type) return;
      const seq = Number(envelope.sequence);
      // replay + live 重叠时按 sequence 去重；u64::MAX 等异常 seq 仍放行终态。
      if (Number.isFinite(seq) && seq > 0 && seq < Number.MAX_SAFE_INTEGER) {
        if (seq <= lastSeq) return;
        lastSeq = seq;
      }
      softReconnectAttempts = 0;
      const sid = targetSessionId;
      d.streamDebug('sse.agent.event', { sid, type: event.type, seq: envelope.sequence });
      d.sessionRunEventSeenRef.current[runId] = true;
      switch (event.type) {
        case 'message.started': {
          const messageId = toText(event.messageId).trim();
          if (!messageId) return;
          // user 的 MessageStart 不能建成 assistant 行，否则会把用户正文渲染成助手流式输出。
          const startedRole = toText((event as { role?: string }).role).trim().toLowerCase();
          if (
            messageId.startsWith('user-') ||
            startedRole === 'user' ||
            startedRole === 'tool' ||
            startedRole === 'custom'
          ) {
            return;
          }
          activeMessageId = messageId;
          stores().messageRole.current[sid] = { ...(stores().messageRole.current[sid] || {}), [messageId]: 'assistant' };
          storeEnsureStreamSessionStores(stores(), sid);
          if (!stores().message.current[sid]?.[messageId]) {
            // created 用服务端 envelope.timestampMs：与权威 user 行同源时钟，
            // 防止两端时钟毫秒差把 assistant 排到本条 user 之前（错挂上一轮）。
            stores().message.current[sid][messageId] = {
              id: messageId,
              role: 'assistant',
              time: { created: Number(envelope.timestampMs) > 0 ? Number(envelope.timestampMs) : Date.now() }
            };
            storePublishStreamRows(stores(), sid);
          }
          d.setStreaming(true);
          if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
          return;
        }
        case 'message.delta':
          applyTextDelta(sid, 'text', event, Number(envelope.timestampMs) || 0);
          return;
        case 'reasoning.delta':
          applyTextDelta(sid, 'reasoning', event, Number(envelope.timestampMs) || 0);
          return;
        case 'toolCall.started': {
          const toolCallId = toText(event.toolCallId).trim();
          if (!toolCallId) return;
          toolCallMessageMap[toolCallId] = activeMessageId;
          upsertToolPart(sid, toolCallId, toText(event.toolName) || 'tool', { status: 'running' });
          // 离散事件即时冲刷（对齐桌面端 tool.started 的 flushStreamUpdates）。
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        }
        case 'toolCall.delta':
          // 参数流式增量不渲染，等 tool.started 的完整 input。
          return;
        case 'tool.started':
          upsertToolPart(sid, toText(event.toolCallId), toText(event.toolName) || 'tool', { status: 'running', input: event.input });
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        case 'tool.progress':
          upsertToolPart(sid, toText(event.toolCallId), toText(event.toolName) || 'tool', { status: 'running', output: event.output });
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        case 'tool.completed':
          upsertToolPart(sid, toText(event.toolCallId), toText(event.toolName) || 'tool', {
            status: event.isError ? 'error' : 'completed',
            output: event.output
          });
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        case 'subagent.started': {
          const toolCallId = toText(event.parentToolCallId).trim();
          if (!toolCallId) return;
          toolCallMessageMap[toolCallId] = toolCallMessageMap[toolCallId] || activeMessageId;
          upsertToolPart(sid, toolCallId, 'task', {
            status: 'running',
            input: {
              description: event.description,
              subagent_type: event.subagentType || 'plan'
            },
            metadata: {
              sessionId: event.childSessionId,
              childRunId: event.childRunId,
              subagentType: event.subagentType || 'plan',
              description: event.description
            }
          });
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        }
        case 'subagent.progress': {
          const toolCallId = toText(event.parentToolCallId).trim();
          if (!toolCallId) return;
          upsertToolPart(sid, toolCallId, 'task', {
            status: 'running',
            metadata: {
              toolCount: event.toolCount,
              currentToolName: event.currentToolName,
              elapsedMs: event.elapsedMs
            }
          });
          if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
          return;
        }
        case 'subagent.childEvent': {
          const toolCallId = toText(event.parentToolCallId).trim();
          const nested = event.event;
          if (!toolCallId || !nested || typeof nested !== 'object') return;
          toolCallMessageMap[toolCallId] = toolCallMessageMap[toolCallId] || activeMessageId;
          const messageId = toolCallMessageMap[toolCallId] || activeMessageId;
          if (!messageId) return;
          const existing = storeGetStoredStreamPart(stores(), sid, messageId, toolCallId);
          const prevMeta =
            existing?.state?.metadata && typeof existing.state.metadata === 'object'
              ? (existing.state.metadata as Record<string, unknown>)
              : {};
          const nextMeta = applySubagentChildEventToMetadata(prevMeta, nested as any);
          if (event.childSessionId) {
            nextMeta.sessionId = event.childSessionId;
          }
          upsertToolPart(sid, toolCallId, 'task', {
            status: toText(existing?.state?.status) || 'running',
            metadata: nextMeta
          });
          if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
          return;
        }
        case 'subagent.completed': {
          const toolCallId = toText(event.parentToolCallId).trim();
          if (!toolCallId) return;
          upsertToolPart(sid, toolCallId, 'task', {
            status: 'completed',
            output: event.summary,
            metadata: {
              sessionId: event.childSessionId,
              toolCount: event.toolCount,
              elapsedMs: event.elapsedMs,
              summary: event.summary,
              currentToolName: ''
            }
          });
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        }
        case 'subagent.failed': {
          const toolCallId = toText(event.parentToolCallId).trim();
          if (!toolCallId) return;
          upsertToolPart(sid, toolCallId, 'task', {
            status: 'error',
            output: event.error,
            metadata: {
              sessionId: event.childSessionId,
              summary: event.error,
              currentToolName: ''
            }
          });
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        }
        case 'subagent.aborted': {
          const toolCallId = toText(event.parentToolCallId).trim();
          if (!toolCallId) return;
          upsertToolPart(sid, toolCallId, 'task', {
            status: 'error',
            output: '子任务已中止',
            metadata: {
              sessionId: event.childSessionId,
              summary: '子任务已中止',
              currentToolName: ''
            }
          });
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        }
        case 'message.completed':
          if (event.message && typeof event.message === 'object') {
            applyMessageCompleted(sid, event.message as AgentMessage);
          }
          return;
        case 'session.status': {
          const legacy = agentStatusToLegacy(event.status);
          // 本 run 未结束时忽略 idle：工具间隙 / 审批前后 gateway 可能短暂报 idle，会抖掉停止钮。
          if (legacy.type === 'idle' && d.sessionActiveRunIdRef.current[sid]) {
            return;
          }
          d.setSessionStatusMap((prev: Record<string, any>) => ({ ...prev, [sid]: legacy }));
          // busy/retry 拉高 streaming；idle 仅在本 run 已结束后才清，避免过程中抖回待机。
          if (legacy.type === 'busy' || legacy.type === 'retry') {
            d.setStreaming(true);
          } else if (!d.sessionActiveRunIdRef.current[sid]) {
            d.setStreaming(false);
          }
          if (event.status === 'failed' && event.error) d.setStatus(String(event.error));
          return;
        }
        case 'interaction.requested':
          if (event.interaction) d.onInteractionRequested(event.interaction);
          // 审批弹出前强制即时刷一帧（不等 rAF），保证工具前的过程文案/卡片已可见。
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        case 'interaction.resolved':
          if (event.id) d.onInteractionResolved(toText(event.id));
          if (sid === d.sessionIdRef.current) d.flushStreamRenderNow(sid);
          return;
        case 'runtime.retry':
          d.setSessionStatusMap((prev: Record<string, any>) => ({
            ...prev,
            [sid]: {
              type: 'retry',
              attempt: Number(event.attempt || 0),
              message: toText(event.error),
              next: Date.now() + Number(event.delayMs || 0)
            }
          }));
          return;
        case 'runtime.compaction':
          d.pushConnLog(`runtime.compaction phase=${toText(event.phase)}${event.error ? ` error=${toText(event.error)}` : ''}`);
          return;
        case 'runtime.warning':
          d.pushConnLog(`runtime.warning ${toText(event.message)}`, 'info');
          return;
        case 'run.completed':
          finalizeRun(sid);
          return;
        case 'run.failed':
          finalizeRun(sid, toText(event.error) || 'run failed');
          return;
        default:
          return;
      }
    };

    const onError = (error: unknown) => {
      if (!isCurrentStream()) return;
      // run 仍在飞时保持 streaming：瞬时 SSE 抖动不应放行发送钮。
      if (!d.sessionActiveRunIdRef.current[targetSessionId]) {
        d.setStreaming(false);
      }
      const detail = (() => {
        try {
          const raw = (error as any)?.data;
          return typeof raw === 'string' ? raw : JSON.stringify(error);
        } catch {
          return String(error);
        }
      })();
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
        return;
      }

      const stillBusy = d.sessionActiveRunIdRef.current[targetSessionId] === runId;
      if (stillBusy && softReconnectAttempts < SSE_SOFT_RECONNECT_MAX) {
        softReconnectAttempts += 1;
        const delay = SSE_SOFT_RECONNECT_BASE_MS * 2 ** (softReconnectAttempts - 1);
        d.pushConnLog(
          `SSE soft-reconnect #${softReconnectAttempts}/${SSE_SOFT_RECONNECT_MAX} afterSeq=${lastSeq} in ${delay}ms`
        );
        clearSoftReconnect();
        softReconnectTimer = setTimeout(() => {
          softReconnectTimer = null;
          if (!isCurrentStream()) return;
          if (d.sessionActiveRunIdRef.current[targetSessionId] !== runId) return;
          attachSubscription(lastSeq);
        }, delay);
        return;
      }

      d.setStatus(detail ? `流断开: ${detail}` : '流断开');
      // 重连耗尽：立即用磁盘/状态对账，避免干等到用户点打断才刷出已完成正文。
      void reconcileFromServer('sse_error');
    };

    const attachSubscription = (afterSeq: number) => {
      if (!isCurrentStream()) return;
      sseGeneration += 1;
      const gen = sseGeneration;
      if (d.streamRef.current) {
        d.streamRef.current.close();
        d.streamRef.current = null;
      }
      const subscription = client.subscribeEvents(
        targetSessionId,
        runId,
        (envelope) => {
          if (gen !== sseGeneration) return;
          onEvent(envelope);
        },
        (error) => {
          if (gen !== sseGeneration) return;
          onError(error);
        },
        { afterSeq }
      );
      d.streamRef.current = subscription;
      d.setStreaming(true);
    };

    d.pushConnLog(`SSE connect sid=${targetSessionId} run=${runId}`);
    attachSubscription(0);
    // 新发送的 prompt 尚未落库时 tail sync 抢跑只会拿到旧快照，反而干扰 live delta。
    // 锁屏同 run 重连才需要立刻对齐权威快照。
    if (softReconnect) {
      void d.syncSessionMessages(targetSessionId, { tailOnly: true });
    }
    void d.syncSessionStatus(targetSessionId);

    // busy 看门狗：云隧道半开/丢包时 message.delta 与 run.completed 都可能到不了手机，
    // 但 jsonl 已在桌面写完。周期性 tail sync + status，对账到 idle 则自动收口。
    clearBusyWatchdog();
    busyWatchdogRef.current = setInterval(() => {
      void reconcileFromServer('watchdog');
    }, BUSY_SYNC_WATCHDOG_MS);
  }, [clearBusyWatchdog, getDeps, stopStream]);

  return { startStream, stopStream };
}

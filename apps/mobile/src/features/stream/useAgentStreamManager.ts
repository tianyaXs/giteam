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
  sessionStatusEpochRef: React.MutableRefObject<number>;
  streamRenderTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
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
  applyTurnWindow: (targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => any;
  syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number; tailOnly?: boolean }) => Promise<any>;
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
  buildLiveTodoCard: (sid: string, todos: any[]) => any;
  onInteractionRequested: (interaction: AgentInteraction) => void;
  onInteractionResolved: (interactionId: string) => void;
  renderStreamWindow: (targetSessionId: string) => void;
  scheduleStreamRender: (targetSessionId: string) => void;
}

function isAbortLikeStreamError(detail: string) {
  const text = toText(detail).toLowerCase();
  return text.includes('messageabortederror') || text.includes('the operation was aborted') || text.includes('aborted');
}

/**
 * pi_agent SSE 流管理：订阅 /api/v1/agent/stream（sessionId + runId），
 * 事件 → legacy 行 store → parseConversation 渲染契约保持不变。
 */
export function useAgentStreamManager(deps: AgentStreamManagerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const getDeps = useCallback(() => depsRef.current, []);

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
    d.streamSessionRef.current = '';
    storeResetAgentStreamStores(d.getAgentStreamStores());
    d.setStreamTodoCard(null);
    d.setStreaming(false);
  }, [getDeps]);

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

    d.streamRunIdRef.current += 1;
    d.sessionStatusEpochRef.current += 1;
    if (d.streamRef.current) {
      d.pushConnLog(softReconnect ? 'SSE reconnect (keep stores)' : 'SSE close');
      d.streamRef.current.close();
      d.streamRef.current = null;
    }
    if (d.streamRenderTimerRef.current) {
      clearTimeout(d.streamRenderTimerRef.current);
      d.streamRenderTimerRef.current = null;
    }
    if (!softReconnect) {
      storeResetAgentStreamStores(d.getAgentStreamStores());
      d.setStreamTodoCard(null);
    }
    d.setStreaming(false);

    d.sessionActiveRunIdRef.current[targetSessionId] = runId;
    const streamRunId = d.streamRunIdRef.current;
    d.streamSessionRef.current = targetSessionId;

    const client = createMobileAgentClient({ baseUrl: d.serverUrl, token: d.token });
    const stores = () => d.getAgentStreamStores();
    let streamClosed = false;
    const isCurrentStream = () =>
      !streamClosed &&
      d.streamRunIdRef.current === streamRunId &&
      d.streamRef.current != null &&
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

    const applyTextDelta = (sid: string, kind: 'text' | 'reasoning', event: AgentEvent['event']) => {
      const messageId = toText(event.messageId).trim();
      if (!messageId) return;
      // 对齐桌面 ensureLocalAssistant：delta 可能早于 message.started，先建 assistant 坑再收字。
      storeEnsureStreamSessionStores(stores(), sid);
      const roles = stores().messageRole.current[sid] || {};
      if (roles[messageId] !== 'assistant') {
        stores().messageRole.current[sid] = { ...roles, [messageId]: 'assistant' };
      }
      if (!stores().message.current[sid]?.[messageId]) {
        stores().message.current[sid][messageId] = {
          id: messageId,
          role: 'assistant',
          time: { created: Date.now() }
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
      // 保留流式期间已写入的 tool output/status（message.completed 不携带结果）。
      for (const part of row.parts) {
        if (part?.type !== 'tool') continue;
        const stored = storeGetStoredStreamPart(stores(), sid, row.info.id, part.id);
        if (stored?.state) {
          part.state = {
            ...part.state,
            status: stored.state.status === 'error' ? 'error' : part.state.status,
            input: Object.keys(part.state?.input || {}).length > 0 ? part.state.input : stored.state.input,
            output: part.state.output || stored.state.output || '',
            error: part.state.error || stored.state.error
          };
        }
      }
      row.info.time = { ...(row.info.time || {}), completed: Date.now() };
      stores().messageRole.current[sid] = { ...(stores().messageRole.current[sid] || {}), [row.info.id]: 'assistant' };
      storeIngestStreamRows(stores(), sid, [row]);
      if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
    };

    const finalizeRun = (sid: string, failedError?: string) => {
      if (!isCurrentStream()) return;
      d.pushConnLog(failedError ? `SSE run.failed ${failedError}` : 'SSE run.completed');
      streamClosed = true;
      d.sessionStatusEpochRef.current += 1;
      d.streamSessionRef.current = '';
      delete d.sessionActiveRunIdRef.current[sid];
      if (d.streamRef.current) {
        d.streamRef.current.close();
        d.streamRef.current = null;
      }
      if (failedError) {
        storeIngestStreamRows(stores(), sid, [{
          info: {
            id: `error:${runId}`,
            role: 'assistant',
            error: { message: failedError },
            time: { created: Date.now(), completed: Date.now() }
          },
          parts: []
        }]);
      }
      // 先刷一帧 live，再 merge sync；streaming/busy 延后到 sync 结束再清，避免输入框闪回待机。
      if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
      d.setStatus(failedError ? `运行失败: ${failedError}` : '本轮回复完成');
      void d.syncSessionMessages(sid, { tailOnly: true }).finally(() => {
        if (d.streamRunIdRef.current !== streamRunId || d.sessionIdRef.current !== sid) return;
        d.setStreaming(false);
        d.setSessionStatusMap((prev: Record<string, any>) => ({
          ...prev,
          [sid]: { type: 'idle' }
        }));
      });
    };

    const onEvent = (envelope: AgentEvent) => {
      if (!isCurrentStream()) return;
      if (envelope.sessionId !== targetSessionId || envelope.runId !== runId) return;
      const event = envelope.event;
      if (!event?.type) return;
      const sid = targetSessionId;
      d.streamDebug('sse.agent.event', { sid, type: event.type, seq: envelope.sequence });
      switch (event.type) {
        case 'message.started': {
          const messageId = toText(event.messageId).trim();
          if (!messageId) return;
          activeMessageId = messageId;
          stores().messageRole.current[sid] = { ...(stores().messageRole.current[sid] || {}), [messageId]: 'assistant' };
          storeEnsureStreamSessionStores(stores(), sid);
          if (!stores().message.current[sid]?.[messageId]) {
            stores().message.current[sid][messageId] = { id: messageId, role: 'assistant', time: { created: Date.now() } };
            storePublishStreamRows(stores(), sid);
          }
          d.setStreaming(true);
          if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
          return;
        }
        case 'message.delta':
          applyTextDelta(sid, 'text', event);
          return;
        case 'reasoning.delta':
          applyTextDelta(sid, 'reasoning', event);
          return;
        case 'toolCall.started': {
          const toolCallId = toText(event.toolCallId).trim();
          if (!toolCallId) return;
          toolCallMessageMap[toolCallId] = activeMessageId;
          upsertToolPart(sid, toolCallId, toText(event.toolName) || 'tool', { status: 'running' });
          return;
        }
        case 'toolCall.delta':
          // 参数流式增量不渲染，等 tool.started 的完整 input。
          return;
        case 'tool.started':
          upsertToolPart(sid, toText(event.toolCallId), toText(event.toolName) || 'tool', { status: 'running', input: event.input });
          return;
        case 'tool.progress':
          upsertToolPart(sid, toText(event.toolCallId), toText(event.toolName) || 'tool', { status: 'running', output: event.output });
          return;
        case 'tool.completed':
          upsertToolPart(sid, toText(event.toolCallId), toText(event.toolName) || 'tool', {
            status: event.isError ? 'error' : 'completed',
            output: event.output
          });
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
              summary: event.summary
            }
          });
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
              summary: event.error
            }
          });
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
              summary: '子任务已中止'
            }
          });
          return;
        }
        case 'message.completed':
          if (event.message && typeof event.message === 'object') {
            applyMessageCompleted(sid, event.message as AgentMessage);
          }
          return;
        case 'session.status': {
          const legacy = agentStatusToLegacy(event.status);
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
          // 审批弹出前强制刷一帧，保证工具前的过程文案已可见。
          if (sid === d.sessionIdRef.current) d.scheduleStreamRender(sid);
          return;
        case 'interaction.resolved':
          if (event.id) d.onInteractionResolved(toText(event.id));
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
      d.setStreaming(false);
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
      } else {
        d.setStatus(detail ? `流断开: ${detail}` : '流断开');
      }
    };

    d.pushConnLog(`SSE connect sid=${targetSessionId} run=${runId}`);
    const subscription = client.subscribeEvents(targetSessionId, runId, onEvent, onError);
    d.streamRef.current = subscription;
    d.setStreaming(true);
    // 新发送的 prompt 尚未落库时 tail sync 抢跑只会拿到旧快照，反而干扰 live delta。
    // 锁屏同 run 重连才需要立刻对齐权威快照。
    if (softReconnect) {
      void d.syncSessionMessages(targetSessionId, { tailOnly: true });
    }
    void d.syncSessionStatus(targetSessionId);
  }, [getDeps, stopStream]);

  return { startStream, stopStream };
}

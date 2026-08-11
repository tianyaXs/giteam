import { useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { pairAuth } from '../../api/controlApi';
import { createMobileAgentClient } from '../../api/agent/client';
import { composerAgentSessionOptions } from '../chat/composerAgentOptions';
import { toText } from '../../lib/text';
import type { ComposerAttachment } from '../media/types';
import {
  abortMessageSendPerf,
  bindMessageSendSession,
  finishMessageSendPerf,
  markMessageSendPerf,
  startMessageSendPerf
} from './messageSendPerf';
import type { OptimisticUserMessage } from './useOptimisticUserMessages';
import type { SessionStatusInfo } from '../../types';

type UsePromptActionsParams = {
  authed: boolean;
  serverUrl: string;
  token: string;
  repoPath: string;
  pairCode: string;
  prompt: string;
  model: string;
  composerAgent: 'build' | 'plan';
  autoAcceptPermissions: boolean;
  imageAttachments: ComposerAttachment[];
  initialSessionLimit: number;
  initialMessageFetchLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  sessionActiveRunIdRef: React.MutableRefObject<Record<string, string>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  pendingPromptSessionRef: React.MutableRefObject<Record<string, { id: string; startedAt: number }>>;
  sentAttachmentCacheRef: React.MutableRefObject<Record<string, Record<string, { at: number; attachments: NonNullable<OptimisticUserMessage['attachments']> }>>>;
  setStatus: (value: string | ((prev: string) => string)) => void;
  setBusy: (value: boolean | ((prev: boolean) => boolean)) => void;
  setToken: (value: string) => void;
  setPrompt: (value: string | ((prev: string) => string)) => void;
  setSlashOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setImageAttachments: (value: ComposerAttachment[] | ((prev: ComposerAttachment[]) => ComposerAttachment[])) => void;

  setSessionStatusMap: React.Dispatch<React.SetStateAction<Record<string, SessionStatusInfo>>>;
  setActiveSession: (sessionId: string) => void;
  startStream: (targetSessionId: string, runId?: string) => void;
  stopStream: () => void;
  syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number; tailOnly?: boolean }) => Promise<any>;
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
  refreshSessionsFromServer: (targetRepoPath?: string) => Promise<any>;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
  upsertOptimisticUserMessage: (targetSessionId: string, message: OptimisticUserMessage) => void;
  dropOptimisticUserMessage: (targetSessionId: string, id: string) => void;
  appendOptimisticTurnAndStick: (message: OptimisticUserMessage) => void;
  clearSessionOptimisticMessages: (targetSessionId: string) => void;
};

export function usePromptActions(params: UsePromptActionsParams) {
  const {
    appendOptimisticTurnAndStick,
    authed,
    autoAcceptPermissions,
    clearSessionOptimisticMessages,
    composerAgent,
    dropOptimisticUserMessage,
    imageAttachments,
    initialMessageFetchLimit,
    initialSessionLimit,
    model,
    pairCode,
    pendingPromptSessionRef,
    prompt,
    pushConnLog,
    refreshSessionsFromServer,
    repoPath,
    sentAttachmentCacheRef,
    serverUrl,
    sessionActiveRunIdRef,
    sessionIdRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    setActiveSession,
    setBusy,
    setImageAttachments,
    setPrompt,
    setSessionStatusMap,
    setSlashOpen,
    setStatus,
    setToken,
    startStream,
    stopStream,
    syncSessionMessages,
    syncSessionStatus,
    token,
    upsertOptimisticUserMessage
  } = params;

  const sendInFlightRef = useRef(false);
  const abortInFlightRef = useRef(false);

  const onSendPrompt = useCallback(async (customPrompt?: string) => {
    const payloadPrompt = (customPrompt ?? prompt).trim();
    const images = imageAttachments.filter((img) => img.status !== 'failed');
    if (sendInFlightRef.current) {
      setStatus('正在发送中，请稍候');
      return;
    }
    if (!authed) {
      setStatus('请先授权');
      return;
    }
    if (!repoPath.trim()) {
      setStatus('未选择项目，请在左侧抽屉切换项目');
      return;
    }
    if (!payloadPrompt && images.length === 0) {
      setStatus('请输入消息');
      return;
    }
    if (imageAttachments.some((img) => img.status === 'processing' || img.status === 'uploading')) {
      setStatus('图片还在处理中，请稍等');
      return;
    }
    if (imageAttachments.some((img) => img.status === 'failed')) {
      setStatus('有图片处理失败，请删除后重试');
      return;
    }
    sendInFlightRef.current = true;
    setBusy(true);
    if (images.length > 0) {
      setImageAttachments((prev) => prev.map((img) => ({ ...img, status: 'uploading', statusText: '发送中' })));
    }
    const optimisticAt = Date.now();
    const optimisticMessage: OptimisticUserMessage = {
      id: `local:${optimisticAt}`,
      text: payloadPrompt,
      createdAt: optimisticAt,
      attachments: images.map((img) => ({
        id: img.id,
        kind: 'image' as const,
        uri: img.dataUrl || img.uri,
        mime: img.mime,
        filename: img.filename
      }))
    };
    const perf = startMessageSendPerf({
      optimisticId: optimisticMessage.id,
      targetSid: sessionIdRef.current,
      textLength: payloadPrompt.length,
      imageCount: images.length,
      log: pushConnLog
    });
    let requestSessionId = '';
    const client = createMobileAgentClient({ baseUrl: serverUrl, token });
    try {
      let targetSessionId = toText(sessionIdRef.current).trim();
      const normalizedModel = model.trim();
      const modelRef = normalizedModel && normalizedModel.includes('/') ? normalizedModel : '';
      const requestProvider = modelRef ? modelRef.slice(0, modelRef.indexOf('/')) : '';
      const requestModelId = modelRef ? modelRef.slice(modelRef.indexOf('/') + 1) : '';
      if (!targetSessionId) {
        markMessageSendPerf(perf, 'send.create_session.begin');
        const createStartedAt = performance.now();
        pushConnLog(`POST agent.session model=${modelRef || '(default)'}`);
        const agentOptions = composerAgentSessionOptions(composerAgent);
        const created = await client.createSession({
          repoPath,
          ...(requestProvider ? { provider: requestProvider } : {}),
          ...(requestModelId ? { model: requestModelId } : {}),
          ...(agentOptions.enabledTools ? { enabledTools: agentOptions.enabledTools } : {}),
          appendSystemPrompt: agentOptions.appendSystemPrompt
        });
        targetSessionId = created.sessionId;
        if (autoAcceptPermissions) {
          void client.setAutoApprove(targetSessionId, true).catch(() => undefined);
        }
        markMessageSendPerf(perf, 'send.create_session.done', {
          ms: Math.round(performance.now() - createStartedAt),
          sid: targetSessionId
        });
        setActiveSession(targetSessionId);
        bindMessageSendSession(perf, targetSessionId);
      } else {
        bindMessageSendSession(perf, targetSessionId);
        // Build/Plan 模式热切换：与桌面端一致，prompt 前同步工具白名单与系统提示追加段。
        const agentOptions = composerAgentSessionOptions(composerAgent);
        await client
          .setSessionOptions(targetSessionId, {
            ...(agentOptions.enabledTools ? { enabledTools: agentOptions.enabledTools } : {}),
            appendSystemPrompt: agentOptions.appendSystemPrompt
          })
          .catch((optionsError) => {
            pushConnLog(`agent.session-options warn ${String(optionsError)}`, 'info');
          });
        if (autoAcceptPermissions) {
          void client.setAutoApprove(targetSessionId, true).catch(() => undefined);
        }
      }
      if (optimisticMessage.attachments?.length) {
        sentAttachmentCacheRef.current[targetSessionId] = {
          ...(sentAttachmentCacheRef.current[targetSessionId] || {}),
          [`id:${optimisticMessage.id}`]: {
            at: Date.now(),
            attachments: optimisticMessage.attachments
          },
          [`text:${toText(payloadPrompt).trim()}`]: {
            at: Date.now(),
            attachments: optimisticMessage.attachments
          }
        };
      }
      markMessageSendPerf(perf, 'send.optimistic.upsert.begin');
      upsertOptimisticUserMessage(targetSessionId, optimisticMessage);
      markMessageSendPerf(perf, 'send.optimistic.upsert.done');
      const listStartedAt = performance.now();
      appendOptimisticTurnAndStick(optimisticMessage);
      markMessageSendPerf(perf, 'send.list_window.append_done', {
        ms: Math.round(performance.now() - listStartedAt)
      });
      setPrompt('');
      setSlashOpen(false);
      setImageAttachments([]);
      pendingPromptSessionRef.current[targetSessionId] = {
        id: optimisticMessage.id,
        startedAt: Date.now()
      };
      requestSessionId = targetSessionId;
      setSessionStatusMap((prev) => ({ ...prev, [targetSessionId]: { type: 'busy' } }));
      const runId = client.newRunId();
      sessionActiveRunIdRef.current[targetSessionId] = runId;
      markMessageSendPerf(perf, 'send.stream.start');
      startStream(targetSessionId, runId);
      const imagesPayload = images
        .map((img) => {
          const dataUrl = toText(img.dataUrl);
          const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
          if (!match || !match[2]) return null;
          return { mimeType: img.mime || match[1] || 'image/png', data: match[2] };
        })
        .filter(Boolean) as Array<{ mimeType: string; data: string }>;
      pushConnLog(`POST agent.prompt sid=${targetSessionId} run=${runId} model=${modelRef || '(default)'} images=${imagesPayload.length}`);
      const networkStartedAt = performance.now();
      markMessageSendPerf(perf, 'send.network.begin', { images: imagesPayload.length });
      // prompt 阻塞至 run 完成；流式进度由 SSE（startStream）驱动。
      const res = await client.prompt({
        sessionId: targetSessionId,
        runId,
        prompt: payloadPrompt,
        images: imagesPayload.length > 0 ? imagesPayload : undefined
      });
      markMessageSendPerf(perf, 'send.network.done', {
        ms: Math.round(performance.now() - networkStartedAt),
        sid: targetSessionId
      });
      pushConnLog(`agent.prompt success, sessionId=${targetSessionId} runId=${res.runId}`);
      // pending 保留到 tail sync 结束，避免中间 applyTurnWindow 过早摘掉乐观气泡
      delete sessionActiveRunIdRef.current[targetSessionId];
      markMessageSendPerf(perf, 'send.sync_tail.begin', { sid: targetSessionId });
      const syncStartedAt = performance.now();
      void syncSessionMessages(targetSessionId, {
        limit: Math.max(
          initialSessionLimit,
          Number(sessionVisibleTurnCountRef.current[targetSessionId] || 0),
          Number(sessionTotalTurnCountRef.current[targetSessionId] || 0)
        ),
        tailOnly: true
      })
        .then(() => {
          markMessageSendPerf(perf, 'send.sync_tail.done', {
            ms: Math.round(performance.now() - syncStartedAt)
          });
        })
        .catch((syncError) => {
          markMessageSendPerf(perf, 'send.sync_tail.error', { reason: String(syncError) });
        })
        .finally(() => {
          delete pendingPromptSessionRef.current[targetSessionId];
          finishMessageSendPerf(perf, 'success', {
            userVisible: perf.userVisibleMarked ? 1 : 0,
            assistantVisible: perf.assistantVisibleMarked ? 1 : 0
          });
        });
      void refreshSessionsFromServer();
      pushConnLog(`POST agent.prompt ok sid=${targetSessionId}`);
      setStatus('已发送');
    } catch (e) {
      const currentSessionId = toText(sessionIdRef.current).trim();
      const failedSessionId = requestSessionId || currentSessionId;
      if (failedSessionId) {
        setSessionStatusMap((prev) => ({ ...prev, [failedSessionId]: { type: 'idle' } }));
      }
      if (currentSessionId) {
        delete pendingPromptSessionRef.current[currentSessionId];
        dropOptimisticUserMessage(currentSessionId, optimisticMessage.id);
      }
      if (customPrompt === undefined) {
        setPrompt((prev) => prev || payloadPrompt);
        setImageAttachments(images.map((img) => ({ ...img, status: 'ready', statusText: '就绪' })));
      }
      const msg = String(e);
      pushConnLog(`POST prompt error images=${images.length} msg=${msg}`, 'error');
      // eslint-disable-next-line no-console
      console.error('[onSendPrompt] error:', msg, 'images:', images.length, 'dataUrl lengths:', images.map((i) => i.dataUrl?.length || 0));
      if (msg.includes('invalid bearer token') && pairCode.trim()) {
        try {
          pushConnLog('prompt auto pairAuth retry');
          const renewed = await pairAuth(serverUrl, pairCode);
          setToken(renewed.token);
          pushConnLog('prompt auto pairAuth retry ok');
          setStatus('已刷新授权，请重试发送');
        } catch (retryErr) {
          pushConnLog(`prompt auto pairAuth retry error ${String(retryErr)}`, 'error');
          setStatus(String(retryErr));
        }
      } else {
        setStatus(`发送失败: ${msg}`);
      }
      abortMessageSendPerf(perf, msg);
    } finally {
      sendInFlightRef.current = false;
      setBusy(false);
    }
  }, [
    appendOptimisticTurnAndStick,
    authed,
    autoAcceptPermissions,
    composerAgent,
    dropOptimisticUserMessage,
    imageAttachments,
    initialMessageFetchLimit,
    initialSessionLimit,
    model,
    pairCode,
    pendingPromptSessionRef,
    prompt,
    pushConnLog,
    refreshSessionsFromServer,
    repoPath,
    sentAttachmentCacheRef,
    serverUrl,
    sessionIdRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setActiveSession,
    setBusy,
    setImageAttachments,
    setPrompt,
    setSessionStatusMap,
    setSlashOpen,
    setStatus,
    setToken,
    startStream,
    syncSessionMessages,
    token,
    upsertOptimisticUserMessage
  ]);

  const onAbort = useCallback(async () => {
    const sid = toText(sessionIdRef.current).trim();
    if (!authed || !sid) {
      setStatus('没有可中断的会话');
      return;
    }
    if (abortInFlightRef.current) return;
    abortInFlightRef.current = true;
    setBusy(true);
    stopStream();
    delete pendingPromptSessionRef.current[sid];
    setSessionStatusMap((prev) => ({ ...prev, [sid]: { type: 'idle' } }));
    try {
      const activeRunId = toText(sessionActiveRunIdRef.current[sid]).trim();
      if (!activeRunId) {
        setStatus('当前会话没有进行中的运行');
        return;
      }
      pushConnLog(`POST agent.abort sid=${sid} run=${activeRunId}`);
      await createMobileAgentClient({ baseUrl: serverUrl, token }).abort(activeRunId);
      delete sessionActiveRunIdRef.current[sid];
      setStatus('已请求中断');
      const tailLimit = Math.max(
        initialSessionLimit,
        Number(sessionVisibleTurnCountRef.current[sid] || 0),
        Number(sessionTotalTurnCountRef.current[sid] || 0)
      );
      await syncSessionMessages(sid, { limit: tailLimit, tailOnly: true });
      clearSessionOptimisticMessages(sid);
      void syncSessionStatus(sid);
      pushConnLog('POST abort ok');
    } catch (e) {
      pushConnLog(`POST abort error ${String(e)}`, 'error');
      setStatus(String(e));
    } finally {
      abortInFlightRef.current = false;
      setBusy(false);
    }
  }, [
    authed,
    clearSessionOptimisticMessages,
    initialSessionLimit,
    pendingPromptSessionRef,
    pushConnLog,
    serverUrl,
    sessionActiveRunIdRef,
    sessionIdRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setBusy,
    setSessionStatusMap,
    setStatus,
    stopStream,
    syncSessionMessages,
    syncSessionStatus,
    token
  ]);

  const copyMessageText = useCallback(async (text: string) => {
    const value = toText(text).trim();
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
      Vibration.vibrate(10);
      setStatus('已复制消息内容');
    } catch (e) {
      setStatus(`复制失败: ${String(e)}`);
    }
  }, [setStatus]);

  return {
    copyMessageText,
    onAbort,
    onSendPrompt
  };
}

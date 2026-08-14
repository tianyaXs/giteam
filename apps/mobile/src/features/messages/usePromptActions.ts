import { useCallback, useRef } from 'react';
import { Platform, Vibration } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { pairAuth, redeemCloudAccess } from '../../api/controlApi';
import { getActiveAccessKey, getConnectionMode, setActiveDeviceId } from '../../api/connectionContext';
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
  /** 发送成功路径：立刻清空并抑制 IME 回填 */
  clearPromptAfterSend: (sentText?: string) => void;
  /** 中断 / 发送失败时立刻放开停止门闩 */
  releaseTurnAwaiting: () => void;
  setSlashOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setImageAttachments: (value: ComposerAttachment[] | ((prev: ComposerAttachment[]) => ComposerAttachment[])) => void;

  setSessionStatusMap: React.Dispatch<React.SetStateAction<Record<string, SessionStatusInfo>>>;
  setActiveSession: (sessionId: string) => void;
  startStream: (targetSessionId: string, runId?: string) => void;
  stopStream: () => void;
  setStreaming: (value: boolean | ((prev: boolean) => boolean)) => void;
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
    clearPromptAfterSend,
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
    setStreaming,
    syncSessionMessages,
    syncSessionStatus,
    token,
    upsertOptimisticUserMessage,
    releaseTurnAwaiting
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
    // 校验通过后立刻闩门并清空输入，避免异步建会话 / IME 回填导致字还在或壳层闪待机。
    clearPromptAfterSend(payloadPrompt);
    sendInFlightRef.current = true;
    setBusy(true);
    // 立刻视为本轮在飞：覆盖新建会话 / SSE 首包前的空隙，避免停止钮闪回可发送。
    setStreaming(true);
    // 已有会话：同步标 busy，让停止钮与 sessionWorking 同帧生效（新会话等 create 后再标）。
    const existingSid = toText(sessionIdRef.current).trim();
    if (existingSid) {
      setSessionStatusMap((prev) => ({ ...prev, [existingSid]: { type: 'busy' } }));
    }
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
    const paintOptimistic = (sid: string) => {
      if (optimisticMessage.attachments?.length) {
        sentAttachmentCacheRef.current[sid] = {
          ...(sentAttachmentCacheRef.current[sid] || {}),
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
      upsertOptimisticUserMessage(sid, optimisticMessage);
      markMessageSendPerf(perf, 'send.optimistic.upsert.done');
      const listStartedAt = performance.now();
      appendOptimisticTurnAndStick(optimisticMessage);
      markMessageSendPerf(perf, 'send.list_window.append_done', {
        ms: Math.round(performance.now() - listStartedAt)
      });
      pendingPromptSessionRef.current[sid] = {
        id: optimisticMessage.id,
        startedAt: Date.now()
      };
      setSessionStatusMap((prev) => ({ ...prev, [sid]: { type: 'busy' } }));
    };
    let requestSessionId = '';
    // 已有会话：先上屏再走网络，避免 setSessionOptions 等云端往返把气泡卡住几秒。
    if (existingSid) {
      requestSessionId = existingSid;
      paintOptimistic(existingSid);
    }
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
        markMessageSendPerf(perf, 'send.create_session.done', {
          ms: Math.round(performance.now() - createStartedAt),
          sid: targetSessionId
        });
        // 先切会话再画气泡：setActiveSession 会清空列表，顺序反了会丢乐观消息。
        setActiveSession(targetSessionId);
        bindMessageSendSession(perf, targetSessionId);
        requestSessionId = targetSessionId;
        paintOptimistic(targetSessionId);
        // 新会话 hub 默认关审批；必须在 prompt 前写入，否则首轮工具会卡审批。
        try {
          await client.setAutoApprove(targetSessionId, autoAcceptPermissions);
        } catch (approveError) {
          pushConnLog(
            `agent.auto-approve warn enabled=${autoAcceptPermissions ? 1 : 0} ${String(approveError)}`,
            'info'
          );
        }
      } else {
        bindMessageSendSession(perf, targetSessionId);
        // Plan 白名单已迁到后端 subagent；composerAgentSessionOptions 现为空。
        // 旧逻辑每次仍 POST session-options → 桌面端丢弃 handle 并重载整段 jsonl，
        // 经云端中继可达数秒～十余秒，表现为「发出去很久才开始回」。
        const agentOptions = composerAgentSessionOptions(composerAgent);
        const hasSessionOptionPatch =
          (Array.isArray(agentOptions.enabledTools) && agentOptions.enabledTools.length > 0) ||
          Boolean(toText(agentOptions.appendSystemPrompt).trim());
        if (hasSessionOptionPatch) {
          markMessageSendPerf(perf, 'send.session_options.begin');
          const optionsStartedAt = performance.now();
          await client
            .setSessionOptions(targetSessionId, {
              ...(agentOptions.enabledTools ? { enabledTools: agentOptions.enabledTools } : {}),
              appendSystemPrompt: agentOptions.appendSystemPrompt
            })
            .catch((optionsError) => {
              pushConnLog(`agent.session-options warn ${String(optionsError)}`, 'info');
            });
          markMessageSendPerf(perf, 'send.session_options.done', {
            ms: Math.round(performance.now() - optionsStartedAt)
          });
        }
        // 已有会话的 auto-approve 由 sessionId/开关 effect 同步；发送路径再 await 只会多堵一趟中继。
        // 若 effect 尚未落盘，permission 交互处仍有本地 auto 代批兜底。
      }
      setSlashOpen(false);
      setImageAttachments([]);
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
      // pending / activeRun 保留到 tail sync 结束，避免完成瞬间 busy→idle 抖一下输入框。
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
          // activeRun / idle 由 SSE finalizeRun 收尾；此处抢清会在尾同步窗口把停止钮闪成可发送。
          // 兜底：若 SSE 长时间未 finalize，再释放门闩。
          setTimeout(() => {
            if (sessionActiveRunIdRef.current[targetSessionId] !== runId) return;
            delete sessionActiveRunIdRef.current[targetSessionId];
            setSessionStatusMap((prev) => ({ ...prev, [targetSessionId]: { type: 'idle' } }));
          }, 12_000);
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
      if (msg.includes('invalid bearer token') || /token_expired|401/.test(msg)) {
        if (getConnectionMode() === 'cloud' && (getActiveAccessKey() || pairCode.trim())) {
          try {
            pushConnLog('prompt auto cloud redeem retry');
            const renewed = await redeemCloudAccess({
              cloudBaseUrl: serverUrl,
              accessKey: getActiveAccessKey() || pairCode.trim(),
              clientName: Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : '移动设备'
            });
            setToken(renewed.token);
            setActiveDeviceId(renewed.deviceId);
            pushConnLog('prompt auto cloud redeem retry ok');
            setStatus('已刷新云端授权，请重试发送');
          } catch (retryErr) {
            pushConnLog(`prompt auto cloud redeem retry error ${String(retryErr)}`, 'error');
            setStatus(String(retryErr));
          }
        } else if (pairCode.trim()) {
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
      } else {
        setStatus(`发送失败: ${msg}`);
      }
      abortMessageSendPerf(perf, msg);
      releaseTurnAwaiting();
      setStreaming(false);
    } finally {
      sendInFlightRef.current = false;
      setBusy(false);
    }
  }, [
    appendOptimisticTurnAndStick,
    authed,
    autoAcceptPermissions,
    clearPromptAfterSend,
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
    releaseTurnAwaiting,
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
    setStreaming,
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
    const activeRunId = toText(sessionActiveRunIdRef.current[sid]).trim();
    setBusy(true);
    stopStream();
    delete pendingPromptSessionRef.current[sid];
    delete sessionActiveRunIdRef.current[sid];
    setSessionStatusMap((prev) => ({ ...prev, [sid]: { type: 'idle' } }));
    releaseTurnAwaiting();
    try {
      if (!activeRunId) {
        setStatus('当前会话没有进行中的运行');
        return;
      }
      pushConnLog(`POST agent.abort sid=${sid} run=${activeRunId}`);
      await createMobileAgentClient({ baseUrl: serverUrl, token }).abort(activeRunId);
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
    releaseTurnAwaiting,
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

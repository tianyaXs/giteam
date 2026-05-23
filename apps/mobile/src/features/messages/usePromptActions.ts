import { useCallback } from 'react';
import { Vibration } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  abortSession,
  createSession,
  pairAuth,
  sendPrompt
} from '../../api/controlApi';
import { toText } from '../../lib/text';
import type { ComposerAttachment } from '../media/types';
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
  imageSendTimeoutMs: number;
  initialSessionLimit: number;
  initialMessageFetchLimit: number;
  sessionIdRef: React.MutableRefObject<string>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  pendingPromptSessionRef: React.MutableRefObject<Record<string, { id: string; startedAt: number }>>;
  sentAttachmentCacheRef: React.MutableRefObject<Record<string, Record<string, { at: number; attachments: NonNullable<OptimisticUserMessage['attachments']> }>>>;
  setStatus: (value: string | ((prev: string) => string)) => void;
  setBusy: (value: boolean | ((prev: boolean) => boolean)) => void;
  setToken: (value: string) => void;
  setPrompt: (value: string | ((prev: string) => string)) => void;
  setSlashOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setImageAttachments: (value: ComposerAttachment[] | ((prev: ComposerAttachment[]) => ComposerAttachment[])) => void;
  setChatListResetKey: (value: number | ((prev: number) => number)) => void;
  setSessionStatusMap: React.Dispatch<React.SetStateAction<Record<string, SessionStatusInfo>>>;
  setActiveSession: (sessionId: string) => void;
  startStream: (targetSessionId: string) => void;
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
    imageSendTimeoutMs,
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
    sessionVisibleTurnCountRef,
    setActiveSession,
    setBusy,
    setChatListResetKey,
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

  const onSendPrompt = useCallback(async (customPrompt?: string) => {
    const payloadPrompt = (customPrompt ?? prompt).trim();
    const images = imageAttachments.filter((img) => img.status !== 'failed');
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
    try {
      let targetSessionId = toText(sessionIdRef.current).trim();
      const normalizedModel = model.trim();
      const requestModel = normalizedModel && normalizedModel.includes('/') ? normalizedModel : undefined;
      if (!targetSessionId) {
        pushConnLog(`POST session.create model=${requestModel || '(default)'}`);
        const created = await createSession({
          baseUrl: serverUrl,
          token,
          repoPath,
          title: payloadPrompt.slice(0, 24) || '新会话',
          agent: composerAgent,
          autoAcceptPermissions
        });
        targetSessionId = created.id;
        setActiveSession(targetSessionId);
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
      upsertOptimisticUserMessage(targetSessionId, optimisticMessage);
      appendOptimisticTurnAndStick(optimisticMessage);
      setPrompt('');
      setSlashOpen(false);
      setImageAttachments([]);
      pendingPromptSessionRef.current[targetSessionId] = {
        id: optimisticMessage.id,
        startedAt: Date.now()
      };
      startStream(targetSessionId);
      pushConnLog(`POST prompt sid=${targetSessionId} model=${requestModel || '(default)'} images=${images.length}`);
      images.forEach((img, idx) => {
        pushConnLog(`  image[${idx}] mime=${img.mime} filename=${img.filename} dataUrlLength=${img.dataUrl?.length || 0}`);
      });
      const parts = [
        { id: `prt_${Date.now()}_text`, type: 'text' as const, text: payloadPrompt },
        ...images.map((img, idx) => ({
          id: `prt_${Date.now()}_${idx}`,
          type: 'file' as const,
          mime: img.mime,
          url: img.dataUrl,
          filename: img.filename
        }))
      ];
      pushConnLog(`sendPrompt start, parts count=${parts.length}, timeout=${images.length > 0 ? imageSendTimeoutMs : 12000}ms`);
      const res = await sendPrompt({
        baseUrl: serverUrl,
        token,
        repoPath,
        prompt: payloadPrompt,
        sessionId: targetSessionId,
        model: requestModel,
        agent: composerAgent,
        autoAcceptPermissions,
        parts: parts.length > 0 ? parts : undefined,
        timeoutMs: images.length > 0 ? imageSendTimeoutMs : undefined
      });
      pushConnLog(`sendPrompt success, sessionId=${res.sessionId}`);
      setActiveSession(res.sessionId);
      void syncSessionMessages(res.sessionId, {
        limit: Math.max(initialSessionLimit, Number(sessionVisibleTurnCountRef.current[res.sessionId] || 0)),
        tailOnly: true
      }).finally(() => {
        delete pendingPromptSessionRef.current[targetSessionId];
      });
      void refreshSessionsFromServer();
      pushConnLog(`POST prompt ok sid=${res.sessionId}`);
      setStatus('已发送');
    } catch (e) {
      const currentSessionId = toText(sessionIdRef.current).trim();
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
    } finally {
      setBusy(false);
    }
  }, [
    appendOptimisticTurnAndStick,
    authed,
    autoAcceptPermissions,
    composerAgent,
    dropOptimisticUserMessage,
    imageAttachments,
    imageSendTimeoutMs,
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
    setActiveSession,
    setBusy,
    setChatListResetKey,
    setImageAttachments,
    setPrompt,
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
    setBusy(true);
    stopStream();
    clearSessionOptimisticMessages(sid);
    setChatListResetKey((prev) => prev + 1);
    setSessionStatusMap((prev) => ({ ...prev, [sid]: { type: 'idle' } }));
    try {
      pushConnLog(`POST abort sid=${sid}`);
      await abortSession({
        baseUrl: serverUrl,
        token,
        repoPath,
        sessionId: sid
      });
      setStatus('已请求中断');
      await syncSessionMessages(sid, { limit: initialSessionLimit });
      void syncSessionStatus(sid);
      pushConnLog('POST abort ok');
    } catch (e) {
      pushConnLog(`POST abort error ${String(e)}`, 'error');
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [
    authed,
    clearSessionOptimisticMessages,
    initialSessionLimit,
    pushConnLog,
    repoPath,
    serverUrl,
    sessionIdRef,
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

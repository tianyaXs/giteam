import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { InteractionManager } from 'react-native';
import { markSessionSwitchPerfForSid } from '../chat/sessionSwitchPerf';
import { markMessageSendPerfForSession } from '../messages/messageSendPerf';
import { buildTurnWindow } from './turns';
import { saveChatSnapshot } from '../../storage/chatSnapshot';
import { toText } from '../../lib/text';
import type { MobileChatMessage, MobileRenderedTurn } from '../../types';

type SessionItemLike = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

export function useTurnWindowController(params: {
  initialSessionLimit: number;
  initialMessageFetchLimit: number;
  repoPath: string;
  sessionNextCursor: Record<string, string>;
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sentAttachmentCacheRef: React.MutableRefObject<Record<string, Record<string, { at: number; attachments: NonNullable<any> }>>>;
  renderRegressionRetryRef: React.MutableRefObject<Record<string, number>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  messagesRef: React.MutableRefObject<MobileChatMessage[]>;
  renderedTurnsRef: React.MutableRefObject<MobileRenderedTurn[]>;
  sessionMessageSyncRef: React.MutableRefObject<{
    syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number }) => Promise<any>;
  } | null>;
  publishStreamRows: (targetSessionId: string) => any[];
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
  summarizePreview: (messages: MobileChatMessage[]) => string;
  stableSortSessionItems: (items: SessionItemLike[]) => SessionItemLike[];
  losesRenderedAssistant: (prev: MobileChatMessage[], next: MobileChatMessage[]) => boolean;
  losesLatestUserMessage: (prev: MobileChatMessage[], next: MobileChatMessage[]) => boolean;
  sharesSessionMessageContext: (prev: MobileChatMessage[], next: MobileChatMessage[]) => boolean;
  assistantTextWeight: (messages: MobileChatMessage[]) => number;
  reconcileOptimisticUserMessages: (targetSessionId: string, messages: MobileChatMessage[], renderedTurns?: MobileRenderedTurn[]) => any[];
  stabilizeServerUserTurnIds: (targetSessionId: string, rendered: any) => any;
  overlayOptimisticTurns: (rendered: any, optimistic: any[]) => any;
  /** 会话是否还有待对账的乐观用户消息（刚发送的窗口期为 true）。轻量路径此时禁用。 */
  hasPendingOptimisticUser: (targetSessionId: string) => boolean;
  setMessages: (value: MobileChatMessage[]) => void;
  setRenderedTurns: Dispatch<SetStateAction<MobileRenderedTurn[]>>;
  setSessions: React.Dispatch<React.SetStateAction<SessionItemLike[]>>;
  setSessionHasMore: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const {
    assistantTextWeight,
    hasPendingOptimisticUser,
    initialMessageFetchLimit,
    initialSessionLimit,
    losesLatestUserMessage,
    losesRenderedAssistant,
    sharesSessionMessageContext,
    messagesRef,
    overlayOptimisticTurns,
    publishStreamRows,
    pushConnLog,
    reconcileOptimisticUserMessages,
    renderRegressionRetryRef,
    renderedTurnsRef,
    repoPath,
    sentAttachmentCacheRef,
    sessionIdRef,
    sessionMessageSyncRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setMessages,
    setRenderedTurns,
    setSessionHasMore,
    setSessions,
    stableSortSessionItems,
    stabilizeServerUserTurnIds,
    summarizePreview
  } = params;

  const upsertSession = useCallback((nextSessionId: string, nextMessages: MobileChatMessage[]) => {
    if (!nextSessionId) return;
    const preview = summarizePreview(nextMessages);
    const nextUpdatedAt = Date.now();
    setSessions((prev) => {
      const prevEntry = prev.find((s) => s.id === nextSessionId);
      const fallbackTitle = nextMessages.find((m) => m.role === 'user' && m.text.trim())?.text.slice(0, 24) || '新会话';
      const nextRow: SessionItemLike = {
        id: nextSessionId,
        title: toText(prevEntry?.title).trim() || fallbackTitle,
        preview,
        updatedAt: nextUpdatedAt,
        createdAt: prevEntry?.createdAt ?? nextUpdatedAt,
      };
      const base = prevEntry ? prev.map((s) => (s.id === nextSessionId ? nextRow : s)) : [nextRow, ...prev];
      return stableSortSessionItems(base).slice(0, 50);
    });
  }, [setSessions, stableSortSessionItems, summarizePreview]);

  const applyTurnWindow = useCallback((targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string, opts?: { streaming?: boolean }) => {
    const applyStartedAt = performance.now();
    const streaming = opts?.streaming === true;
    markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.begin', { visibleTurnCount, streaming: streaming ? 1 : 0 });
    markMessageSendPerfForSession(targetSessionId, 'window.build.begin', { visibleTurnCount });
    const storeRows = publishStreamRows(targetSessionId);
    const merged = storeRows.length > 0 ? storeRows : (Array.isArray(sessionRawMapRef.current[targetSessionId]) ? sessionRawMapRef.current[targetSessionId] : []);
    const baseRendered = buildTurnWindow(merged, visibleTurnCount);
    // 流式轻量路径：仅当「turn 集合未变 + 无待对账乐观消息 + rawRows 已含权威 user 轮」
    // 才跳过 optimistic 对账/id 稳定化/overlay。三者任一不满足（刚发送窗口期、权威 user
    // 未进表、乐观气泡待对齐），都必须走全量，否则会丢用户气泡 / 孤儿 assistant 轮 / 标题。
    const prevTurnCount = renderedTurnsRef.current.length;
    const turnSetUnchanged =
      streaming &&
      prevTurnCount > 0 &&
      baseRendered.renderedTurns.length === prevTurnCount &&
      baseRendered.hasUserTurn &&
      !hasPendingOptimisticUser(targetSessionId);
    const rendered = turnSetUnchanged
      ? baseRendered
      : overlayOptimisticTurns(
          stabilizeServerUserTurnIds(targetSessionId, baseRendered),
          reconcileOptimisticUserMessages(targetSessionId, baseRendered.chatMessages, baseRendered.renderedTurns)
        );
    markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.build_ready', {
      ms: Math.round(performance.now() - applyStartedAt),
      rows: merged.length,
      turns: rendered.renderedTurns.length,
      messages: rendered.chatMessages.length,
      light: turnSetUnchanged ? 1 : 0
    });
    sessionVisibleTurnCountRef.current[targetSessionId] = rendered.visibleTurnCount;
    sessionTotalTurnCountRef.current[targetSessionId] = rendered.totalTurnCount;
    let nextMessages: MobileChatMessage[];
    let nextTurns: MobileRenderedTurn[];
    if (turnSetUnchanged) {
      // 轻量路径：用户消息（含附件）在流式中不变，跳过附件缓存重建与回填。
      nextMessages = rendered.chatMessages;
      nextTurns = rendered.renderedTurns;
    } else {
      const cacheNow = Date.now();
      const nextCache = { ...(sentAttachmentCacheRef.current[targetSessionId] || {}) };
      for (const message of rendered.chatMessages) {
        if (message.role !== 'user' || !message.attachments?.length) continue;
        nextCache[`id:${message.id}`] = { at: cacheNow, attachments: message.attachments };
      }
      sentAttachmentCacheRef.current[targetSessionId] = nextCache;
      const cachedAttachments = sentAttachmentCacheRef.current[targetSessionId] || {};
      const now = Date.now();
      const withPersistedAttachments = (message: MobileChatMessage): MobileChatMessage => {
        if (message.role !== 'user') return message;
        // 只按消息 id 回填附件，禁止按相同文案串图（否则「这是什么」第二次会误挂上轮图片）。
        const cached = cachedAttachments[`id:${message.id}`];
        if (cached && now - cached.at < 24 * 60 * 60 * 1000 && cached.attachments.length) {
          if ((message.attachments?.length || 0) > 0) return message;
          return { ...message, attachments: cached.attachments };
        }
        if (message.attachments?.length) return message;
        return message;
      };
      nextMessages = rendered.chatMessages.map(withPersistedAttachments);
      nextTurns = rendered.renderedTurns.map((turn: MobileRenderedTurn) => turn.userMessage ? ({ ...turn, userMessage: withPersistedAttachments(turn.userMessage) }) : turn);
    }
    // 回归守卫（assistant/user 文本倒退检测）只在全量路径跑：流式中 delta 只会
    // 追加文本，不会触发倒退；且守卫本身要遍历全部消息，是每帧开销大头之一。
    if (!turnSetUnchanged) {
      const prevMessages = messagesRef.current;
      const sameSessionContext = sharesSessionMessageContext(prevMessages, nextMessages);
      if (
        targetSessionId === sessionIdRef.current &&
        sameSessionContext &&
        (losesRenderedAssistant(prevMessages, nextMessages) || losesLatestUserMessage(prevMessages, nextMessages))
      ) {
        const reason = losesLatestUserMessage(prevMessages, nextMessages) ? 'user regression' : 'assistant regression';
        pushConnLog(
          `render guard sid=${targetSessionId} reason=${reason} prevA=${assistantTextWeight(prevMessages)} nextA=${assistantTextWeight(nextMessages)}`
        );
        nextMessages = prevMessages;
        nextTurns = renderedTurnsRef.current;
        const lastRetryAt = renderRegressionRetryRef.current[targetSessionId] || 0;
        if (Date.now() - lastRetryAt > 5000) {
          renderRegressionRetryRef.current[targetSessionId] = Date.now();
          setTimeout(() => {
            if (targetSessionId === sessionIdRef.current) {
              void sessionMessageSyncRef.current?.syncSessionMessages(targetSessionId, {
                limit: Math.max(initialSessionLimit, sessionVisibleTurnCountRef.current[targetSessionId] || 0),
                fetchLimit: initialMessageFetchLimit
              });
            }
          }, 1200);
        }
      }
    }
    const commitRenderedTurns = (prev: MobileRenderedTurn[]): MobileRenderedTurn[] => {
      if (prev.length === 0 || prev.length !== nextTurns.length) return nextTurns;
      const prevIds = prev.map((turn: MobileRenderedTurn) => turn.id).join('|');
      const nextIds = nextTurns.map((turn: MobileRenderedTurn) => turn.id).join('|');
      if (prevIds !== nextIds) return nextTurns;
      const prevLast = prev[prev.length - 1];
      const nextLast = nextTurns[nextTurns.length - 1];
      if (!prevLast || !nextLast || prevLast.id !== nextLast.id) return nextTurns;
      return [...prev.slice(0, -1), nextLast];
    };
    if (targetSessionId !== sessionIdRef.current) {
      upsertSession(targetSessionId, nextMessages);
      const hiddenInCache = rendered.totalTurnCount > rendered.visibleTurnCount;
      const nextCursor = toText(nextCursorHint ?? sessionNextCursor[targetSessionId]).trim();
      setSessionHasMore((prev) => ({ ...prev, [targetSessionId]: !!nextCursor || hiddenInCache }));
      markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.stale_session_skip_ui', {
        ms: Math.round(performance.now() - applyStartedAt),
        turns: nextTurns.length
      });
      return rendered;
    }
    setMessages(nextMessages);
    setRenderedTurns(commitRenderedTurns);
    markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.commit_ui', {
      ms: Math.round(performance.now() - applyStartedAt),
      messages: nextMessages.length,
      turns: nextTurns.length,
      light: turnSetUnchanged ? 1 : 0
    });
    markMessageSendPerfForSession(targetSessionId, 'window.commit_ui', {
      ms: Math.round(performance.now() - applyStartedAt),
      messages: nextMessages.length,
      turns: nextTurns.length,
      cells: nextTurns.reduce((sum: number, turn: MobileRenderedTurn) => sum + (turn.userMessage ? 1 : 0) + turn.items.length, 0)
    });
    const nextCursor = toText(nextCursorHint ?? sessionNextCursor[targetSessionId]).trim();
    // 轻量路径跳过快照落盘与会话列表刷新：流式帧高频，snapshot/upsertSession
    // 留到 turn 边界（全量路径）做，降低每帧主线程开销。
    if (!turnSetUnchanged) {
      if (repoPath.trim() && nextTurns.length > 0) {
        const snapshotPayload = {
          repoPath,
          sessionId: targetSessionId,
          rawRows: merged,
          nextCursor,
          visibleTurnCount: rendered.visibleTurnCount,
          totalTurnCount: rendered.totalTurnCount,
          messages: nextMessages,
          renderedTurns: nextTurns,
          updatedAt: Date.now()
        };
        markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.snapshot_scheduled', {
          turns: nextTurns.length,
          rows: merged.length
        });
        InteractionManager.runAfterInteractions(() => {
          const snapshotStartedAt = performance.now();
          try {
            saveChatSnapshot(snapshotPayload);
            markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.snapshot_saved', {
              ms: Math.round(performance.now() - snapshotStartedAt)
            });
          } catch {
            // ignore snapshot write failures
          }
        });
      }
      upsertSession(targetSessionId, nextMessages);
    }
    const hiddenInCache = rendered.totalTurnCount > rendered.visibleTurnCount;
    setSessionHasMore((prev) => ({ ...prev, [targetSessionId]: !!nextCursor || hiddenInCache }));
    return rendered;
  }, [
    assistantTextWeight,
    hasPendingOptimisticUser,
    initialMessageFetchLimit,
    initialSessionLimit,
    losesLatestUserMessage,
    losesRenderedAssistant,
    sharesSessionMessageContext,
    messagesRef,
    overlayOptimisticTurns,
    publishStreamRows,
    pushConnLog,
    reconcileOptimisticUserMessages,
    renderRegressionRetryRef,
    renderedTurnsRef,
    repoPath,
    sentAttachmentCacheRef,
    sessionIdRef,
    sessionMessageSyncRef,
    sessionNextCursor,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setMessages,
    setRenderedTurns,
    setSessionHasMore,
    stabilizeServerUserTurnIds,
    upsertSession
  ]);

  return {
    applyTurnWindow
  };
}

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
  sharesSessionMessageContext: (prev: MobileChatMessage[], next: MobileChatMessage[]) => boolean;
  assistantTextWeight: (messages: MobileChatMessage[]) => number;
  reconcileOptimisticUserMessages: (targetSessionId: string, messages: MobileChatMessage[]) => any[];
  stabilizeServerUserTurnIds: (targetSessionId: string, rendered: any) => any;
  overlayOptimisticTurns: (rendered: any, optimistic: any[]) => any;
  setMessages: (value: MobileChatMessage[]) => void;
  setRenderedTurns: Dispatch<SetStateAction<MobileRenderedTurn[]>>;
  setSessions: React.Dispatch<React.SetStateAction<SessionItemLike[]>>;
  setSessionHasMore: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const {
    assistantTextWeight,
    initialMessageFetchLimit,
    initialSessionLimit,
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
    setSessions((prev) => {
      const prevEntry = prev.find((s) => s.id === nextSessionId);
      const fallbackTitle = nextMessages.find((m) => m.role === 'user' && m.text.trim())?.text.slice(0, 24) || '新会话';
      const nextRow: SessionItemLike = {
        id: nextSessionId,
        title: toText(prevEntry?.title).trim() || fallbackTitle,
        preview,
        updatedAt: prevEntry?.updatedAt ?? Date.now(),
        createdAt: prevEntry?.createdAt
      };
      const base = prevEntry ? prev.map((s) => (s.id === nextSessionId ? nextRow : s)) : [nextRow, ...prev];
      return stableSortSessionItems(base).slice(0, 50);
    });
  }, [setSessions, stableSortSessionItems, summarizePreview]);

  const applyTurnWindow = useCallback((targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => {
    const applyStartedAt = performance.now();
    markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.begin', { visibleTurnCount });
    markMessageSendPerfForSession(targetSessionId, 'window.build.begin', { visibleTurnCount });
    const storeRows = publishStreamRows(targetSessionId);
    const merged = storeRows.length > 0 ? storeRows : (Array.isArray(sessionRawMapRef.current[targetSessionId]) ? sessionRawMapRef.current[targetSessionId] : []);
    const baseRendered = buildTurnWindow(merged, visibleTurnCount);
    const optimistic = reconcileOptimisticUserMessages(targetSessionId, baseRendered.chatMessages);
    const stableBaseRendered = stabilizeServerUserTurnIds(targetSessionId, baseRendered);
    const rendered = overlayOptimisticTurns(stableBaseRendered, optimistic);
    markSessionSwitchPerfForSid(targetSessionId, 'applyTurnWindow.build_ready', {
      ms: Math.round(performance.now() - applyStartedAt),
      rows: merged.length,
      turns: rendered.renderedTurns.length,
      messages: rendered.chatMessages.length
    });
    sessionVisibleTurnCountRef.current[targetSessionId] = rendered.visibleTurnCount;
    sessionTotalTurnCountRef.current[targetSessionId] = rendered.totalTurnCount;
    const cacheNow = Date.now();
    const nextCache = { ...(sentAttachmentCacheRef.current[targetSessionId] || {}) };
    for (const message of rendered.chatMessages) {
      if (message.role !== 'user' || !message.attachments?.length) continue;
      const text = toText(message.text).trim();
      nextCache[`id:${message.id}`] = { at: cacheNow, attachments: message.attachments };
      if (text) nextCache[`text:${text}`] = { at: cacheNow, attachments: message.attachments };
    }
    sentAttachmentCacheRef.current[targetSessionId] = nextCache;
    const cachedAttachments = sentAttachmentCacheRef.current[targetSessionId] || {};
    const now = Date.now();
    const withPersistedAttachments = (message: MobileChatMessage): MobileChatMessage => {
      if (message.role !== 'user') return message;
      const key = toText(message.text).trim();
      const cached = cachedAttachments[`id:${message.id}`] || cachedAttachments[`text:${key}`];
      if (cached && now - cached.at < 24 * 60 * 60 * 1000 && cached.attachments.length) {
        return { ...message, attachments: cached.attachments };
      }
      if (message.attachments?.length) return message;
      return message;
    };
    let nextMessages = rendered.chatMessages.map(withPersistedAttachments);
    let nextTurns = rendered.renderedTurns.map((turn: MobileRenderedTurn) => turn.userMessage ? ({ ...turn, userMessage: withPersistedAttachments(turn.userMessage) }) : turn);
    const prevMessages = messagesRef.current;
    const sameSessionContext = sharesSessionMessageContext(prevMessages, nextMessages);
    if (
      targetSessionId === sessionIdRef.current &&
      sameSessionContext &&
      losesRenderedAssistant(prevMessages, nextMessages)
    ) {
      pushConnLog(`render guard sid=${targetSessionId} reason=assistant regression prev=${assistantTextWeight(prevMessages)} next=${assistantTextWeight(nextMessages)}`);
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
      turns: nextTurns.length
    });
    markMessageSendPerfForSession(targetSessionId, 'window.commit_ui', {
      ms: Math.round(performance.now() - applyStartedAt),
      messages: nextMessages.length,
      turns: nextTurns.length,
      cells: nextTurns.reduce((sum: number, turn: MobileRenderedTurn) => sum + (turn.userMessage ? 1 : 0) + turn.items.length, 0)
    });
    const nextCursor = toText(nextCursorHint ?? sessionNextCursor[targetSessionId]).trim();
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
    const hiddenInCache = rendered.totalTurnCount > rendered.visibleTurnCount;
    setSessionHasMore((prev) => ({ ...prev, [targetSessionId]: !!nextCursor || hiddenInCache }));
    return rendered;
  }, [
    assistantTextWeight,
    initialMessageFetchLimit,
    initialSessionLimit,
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

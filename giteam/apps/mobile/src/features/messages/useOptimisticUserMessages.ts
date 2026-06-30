import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { markMessageSendPerfForSession } from './messageSendPerf';
import { toText } from '../../lib/text';
import type { MobileChatMessage, MobileRenderedTurn } from '../../types';
import type { buildTurnWindow } from './turns';

export type OptimisticUserMessage = {
  id: string;
  text: string;
  createdAt: number;
  attachments?: Array<{
    id: string;
    kind: 'image';
    uri: string;
    mime?: string;
    filename?: string;
  }>;
};

const OPTIMISTIC_MATCH_PAST_GRACE_MS = 20 * 1000;
const OPTIMISTIC_MATCH_FUTURE_WINDOW_MS = 2 * 60 * 1000;

type TurnWindowResult = ReturnType<typeof buildTurnWindow>;

export function useOptimisticUserMessages(params: {
  initialSessionLimit: number;
  sessionIdRef: MutableRefObject<string>;
  sessionOptimisticUserMapRef: MutableRefObject<Record<string, OptimisticUserMessage[]>>;
  optimisticUserIdAliasRef: MutableRefObject<Record<string, Record<string, string>>>;
  sentAttachmentCacheRef: MutableRefObject<Record<string, Record<string, { at: number; attachments: NonNullable<OptimisticUserMessage['attachments']> }>>>;
  forceScrollToLatestUntilRef: MutableRefObject<number>;
  markFollowLatest: (durationMs?: number) => void;
  sessionVisibleTurnCountRef: MutableRefObject<Record<string, number>>;
  messagesRef: MutableRefObject<MobileChatMessage[]>;
  renderedTurnsRef: MutableRefObject<MobileRenderedTurn[]>;
  applyTurnWindowRef: MutableRefObject<(targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => unknown>;
  setMessages: (value: MobileChatMessage[]) => void;
  setRenderedTurns: Dispatch<SetStateAction<MobileRenderedTurn[]>>;
}) {
  const {
    applyTurnWindowRef,
    forceScrollToLatestUntilRef,
    messagesRef,
    renderedTurnsRef,
    markFollowLatest,
    initialSessionLimit,
    optimisticUserIdAliasRef,
    sentAttachmentCacheRef,
    sessionIdRef,
    sessionOptimisticUserMapRef,
    sessionVisibleTurnCountRef,
    setMessages,
    setRenderedTurns
  } = params;
  const [optimisticVersion, setOptimisticVersion] = useState(0);

  const bumpOptimisticVersion = useCallback(() => {
    setOptimisticVersion((v) => v + 1);
  }, []);

  const upsertOptimisticUserMessage = useCallback(
    (targetSessionId: string, message: OptimisticUserMessage) => {
      const sid = toText(targetSessionId).trim();
      if (!sid) return;
      const prev = Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid] : [];
      const droppedLocalIds = new Set(prev.map((item) => item.id).filter((id) => id !== message.id));
      sessionOptimisticUserMapRef.current[sid] = [message];
      if (droppedLocalIds.size > 0) {
        const alias = { ...(optimisticUserIdAliasRef.current[sid] || {}) };
        for (const [serverId, localId] of Object.entries(alias)) {
          if (droppedLocalIds.has(localId)) delete alias[serverId];
        }
        if (Object.keys(alias).length > 0) optimisticUserIdAliasRef.current[sid] = alias;
        else delete optimisticUserIdAliasRef.current[sid];
      }
      bumpOptimisticVersion();
    },
    [bumpOptimisticVersion, optimisticUserIdAliasRef, sessionOptimisticUserMapRef]
  );

  const dropOptimisticUserMessage = useCallback(
    (targetSessionId: string, optimisticId: string) => {
      const sid = toText(targetSessionId).trim();
      if (!sid || !optimisticId) return;
      const prev = Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid] : [];
      const next = prev.filter((item) => item.id !== optimisticId);
      if (next.length > 0) sessionOptimisticUserMapRef.current[sid] = next;
      else delete sessionOptimisticUserMapRef.current[sid];
      bumpOptimisticVersion();
      const visible = Math.max(
        initialSessionLimit,
        Number(sessionVisibleTurnCountRef.current[sid] || 0),
        renderedTurnsRef.current.length
      );
      applyTurnWindowRef.current(sid, visible);
    },
    [applyTurnWindowRef, bumpOptimisticVersion, initialSessionLimit, renderedTurnsRef, sessionOptimisticUserMapRef, sessionVisibleTurnCountRef]
  );

  const reconcileOptimisticUserMessages = useCallback(
    (targetSessionId: string, chatMessages: MobileChatMessage[]) => {
      const sid = toText(targetSessionId).trim();
      const optimistic = Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid] : [];
      if (!sid || optimistic.length === 0) return optimistic;
      const serverUsers = chatMessages.filter((item) => item.role === 'user' && !!toText(item.text));
      const usedIds = new Set<string>();
      const remaining: OptimisticUserMessage[] = [];
      for (const local of optimistic) {
        const text = toText(local.text);
        const localTextTrimmed = text.trim();
        const matchesOptimisticText = (serverText: string) => {
          if (serverText === text) return true;
          const serverTextTrimmed = serverText.trim();
          if (!serverTextTrimmed || !localTextTrimmed) return false;
          return serverTextTrimmed.startsWith(localTextTrimmed) || localTextTrimmed.startsWith(serverTextTrimmed);
        };
        const matched =
          serverUsers.find((item) => {
            if (usedIds.has(item.id)) return false;
            const serverText = toText(item.text);
            if (!matchesOptimisticText(serverText)) return false;
            if ((item.attachments?.length || 0) !== (local.attachments?.length || 0)) return false;
            const serverCreatedAt = Number(item.createdAt || 0) || 0;
            if (serverCreatedAt < local.createdAt - OPTIMISTIC_MATCH_PAST_GRACE_MS) return false;
            if (serverCreatedAt > local.createdAt + OPTIMISTIC_MATCH_FUTURE_WINDOW_MS) return false;
            return true;
          }) ||
          serverUsers
            .filter((item) => {
              if (usedIds.has(item.id)) return false;
              const serverText = toText(item.text);
              if (!matchesOptimisticText(serverText)) return false;
              if ((item.attachments?.length || 0) !== (local.attachments?.length || 0)) return false;
              const serverCreatedAt = Number(item.createdAt || 0) || 0;
              return serverCreatedAt >= local.createdAt - OPTIMISTIC_MATCH_PAST_GRACE_MS &&
                serverCreatedAt <= local.createdAt + OPTIMISTIC_MATCH_FUTURE_WINDOW_MS;
            })
            .sort((a, b) => {
              const da = Math.abs((Number(a.createdAt || 0) || 0) - local.createdAt);
              const db = Math.abs((Number(b.createdAt || 0) || 0) - local.createdAt);
              return da - db;
            })[0];
        if (matched) {
          optimisticUserIdAliasRef.current[sid] = {
            ...(optimisticUserIdAliasRef.current[sid] || {}),
            [matched.id]: local.id
          };
          if (local.attachments?.length) {
            sentAttachmentCacheRef.current[sid] = {
              ...(sentAttachmentCacheRef.current[sid] || {}),
              [`id:${matched.id}`]: { at: Date.now(), attachments: local.attachments },
              [`id:${local.id}`]: { at: Date.now(), attachments: local.attachments },
              [`text:${text}`]: { at: Date.now(), attachments: local.attachments }
            };
          }
          usedIds.add(matched.id);
          continue;
        }
        remaining.push(local);
      }
      if (remaining.length === optimistic.length) return optimistic;
      if (remaining.length > 0) sessionOptimisticUserMapRef.current[sid] = remaining;
      else delete sessionOptimisticUserMapRef.current[sid];
      bumpOptimisticVersion();
      return remaining;
    },
    [bumpOptimisticVersion, optimisticUserIdAliasRef, sentAttachmentCacheRef, sessionOptimisticUserMapRef]
  );

  const stabilizeServerUserTurnIds = useCallback(
    (targetSessionId: string, base: TurnWindowResult): TurnWindowResult => {
      const sid = toText(targetSessionId).trim();
      const alias = optimisticUserIdAliasRef.current[sid] || {};
      if (!sid || Object.keys(alias).length === 0) return base;
      const remapMessage = (message: MobileChatMessage): MobileChatMessage => {
        const mapped = alias[message.id];
        return mapped ? { ...message, id: mapped } : message;
      };
      return {
        ...base,
        chatMessages: base.chatMessages.map(remapMessage),
        renderedTurns: base.renderedTurns.map((turn) => {
          const user = turn.userMessage ? remapMessage(turn.userMessage) : undefined;
          if (!user || user.id === turn.userMessage?.id) return turn;
          return {
            ...turn,
            id: `turn:optimistic:${user.id}`,
            userMessage: user,
            signature: turn.signature.replace(`user:${turn.userMessage?.id || ''}:`, `user:${user.id}:`)
          };
        })
      };
    },
    [optimisticUserIdAliasRef]
  );

  const overlayOptimisticTurns = useCallback(
    (base: TurnWindowResult, optimistic: OptimisticUserMessage[]): TurnWindowResult => {
      if (optimistic.length === 0) return base;
      const overlayStartedAt = performance.now();
      markMessageSendPerfForSession(sessionIdRef.current, 'list.overlay_optimistic.begin', {
        optimisticCount: optimistic.length,
        baseTurns: base.renderedTurns.length
      });
      const keepBaseTurns = base.renderedTurns.length > 0;
      const nextMessages = keepBaseTurns ? [...base.chatMessages] : [];
      const nextTurns = keepBaseTurns ? [...base.renderedTurns] : [];
      const existingTurnIds = new Set(nextTurns.map((turn) => turn.id));
      const existingMessageIds = new Set(nextMessages.map((message) => message.id));
      const pending = optimistic.length > 1 ? [optimistic[optimistic.length - 1]!] : optimistic;
      let appended = 0;
      for (const item of pending) {
        const turnId = `turn:optimistic:${item.id}`;
        if (existingTurnIds.has(turnId)) continue;
        if (!existingMessageIds.has(item.id)) {
          nextMessages.push({
            id: item.id,
            role: 'user',
            text: item.text,
            createdAt: item.createdAt,
            attachments: item.attachments
          });
          existingMessageIds.add(item.id);
        }
        nextTurns.push({
          id: turnId,
          createdAt: item.createdAt,
          userMessage: { id: item.id, role: 'user', text: item.text, createdAt: item.createdAt, attachments: item.attachments },
          items: [],
          signature: `optimistic:${item.id}:${item.text.length}:${item.attachments?.length || 0}`
        });
        existingTurnIds.add(turnId);
        appended += 1;
      }
      if (appended === 0) {
        markMessageSendPerfForSession(sessionIdRef.current, 'list.overlay_optimistic.skip', {
          ms: Math.round(performance.now() - overlayStartedAt)
        });
        return base;
      }
      markMessageSendPerfForSession(sessionIdRef.current, 'list.overlay_optimistic.done', {
        ms: Math.round(performance.now() - overlayStartedAt),
        appended,
        turns: nextTurns.length
      });
      return {
        ...base,
        chatMessages: nextMessages,
        renderedTurns: nextTurns,
        mergedCount: base.mergedCount + appended,
        visibleTurnCount: keepBaseTurns ? Math.max(base.visibleTurnCount, nextTurns.length) : nextTurns.length,
        totalTurnCount: Math.max(base.totalTurnCount, nextTurns.length),
        hasUserTurn: true
      };
    },
    [sessionIdRef]
  );

  const appendOptimisticTurnAndStick = useCallback(
    (message: OptimisticUserMessage) => {
      const sid = toText(sessionIdRef.current).trim();
      if (!sid) return;
      forceScrollToLatestUntilRef.current = Date.now() + 45000;
      const nextVisible = Math.max(
        initialSessionLimit,
        Number(sessionVisibleTurnCountRef.current[sid] || 0),
        renderedTurnsRef.current.length + 1
      );
      sessionVisibleTurnCountRef.current[sid] = nextVisible;

      // 优化9: 增量渲染乐观消息，避免全量重建
      const currentTurns = renderedTurnsRef.current;
      const currentMessages = messagesRef.current;
      const optimisticTurnId = `turn:optimistic:${message.id}`;

      // 检查是否已存在该乐观 turn
      const alreadyExists = currentTurns.some((turn) => turn.id === optimisticTurnId);
      if (!alreadyExists) {
        const appendStartedAt = performance.now();
        markMessageSendPerfForSession(sid, 'list.optimistic_append.begin', {
          visible: nextVisible,
          currentTurns: currentTurns.length
        });

        const optimisticTurn: MobileRenderedTurn = {
          id: optimisticTurnId,
          createdAt: message.createdAt,
          userMessage: {
            id: message.id,
            role: 'user',
            text: message.text,
            createdAt: message.createdAt,
            attachments: message.attachments
          },
          items: [],
          signature: `optimistic:${message.id}:${message.text.length}:${message.attachments?.length || 0}`
        };

        const nextMessages = [...currentMessages, {
          id: message.id,
          role: 'user' as const,
          text: message.text,
          createdAt: message.createdAt,
          attachments: message.attachments
        }];

        const nextTurns = [...currentTurns, optimisticTurn];

        // 直接更新 ref 和 state，跳过 applyTurnWindow
        messagesRef.current = nextMessages;
        renderedTurnsRef.current = nextTurns;
        setMessages(nextMessages);
        setRenderedTurns(nextTurns);

        markMessageSendPerfForSession(sid, 'list.optimistic_append.done', {
          ms: Math.round(performance.now() - appendStartedAt),
          turns: nextTurns.length
        });
      } else {
        // 如果已存在，回退到全量重建
        const applyStartedAt = performance.now();
        markMessageSendPerfForSession(sid, 'list.apply_turn_window.begin', { visible: nextVisible });
        applyTurnWindowRef.current(sid, nextVisible);
        markMessageSendPerfForSession(sid, 'list.apply_turn_window.done', {
          ms: Math.round(performance.now() - applyStartedAt)
        });
      }

      markFollowLatest(45000);
      markMessageSendPerfForSession(sid, 'list.follow_latest_marked');
    },
    [applyTurnWindowRef, forceScrollToLatestUntilRef, initialSessionLimit, markFollowLatest, messagesRef, renderedTurnsRef, sessionIdRef, sessionVisibleTurnCountRef, setMessages, setRenderedTurns]
  );

  const clearSessionOptimisticMessages = useCallback(
    (targetSessionId: string) => {
      const sid = toText(targetSessionId).trim();
      if (!sid) return;
      const pending = sessionOptimisticUserMapRef.current[sid] || [];
      if (!pending.length) return;
      const ids = new Set(pending.map((item) => item.id));
      delete sessionOptimisticUserMapRef.current[sid];
      bumpOptimisticVersion();
      const visible = Math.max(
        initialSessionLimit,
        Number(sessionVisibleTurnCountRef.current[sid] || 0),
        renderedTurnsRef.current.length
      );
      applyTurnWindowRef.current(sid, visible);
    },
    [applyTurnWindowRef, bumpOptimisticVersion, initialSessionLimit, renderedTurnsRef, sessionOptimisticUserMapRef, sessionVisibleTurnCountRef]
  );

  return {
    optimisticVersion,
    bumpOptimisticVersion,
    upsertOptimisticUserMessage,
    dropOptimisticUserMessage,
    reconcileOptimisticUserMessages,
    stabilizeServerUserTurnIds,
    overlayOptimisticTurns,
    appendOptimisticTurnAndStick,
    clearSessionOptimisticMessages
  };
}

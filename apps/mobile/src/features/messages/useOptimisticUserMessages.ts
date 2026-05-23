import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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
  scrollToLatest: (animated?: boolean) => void;
  sessionVisibleTurnCountRef: MutableRefObject<Record<string, number>>;
  renderedTurnsRef: MutableRefObject<MobileRenderedTurn[]>;
  applyTurnWindowRef: MutableRefObject<(targetSessionId: string, visibleTurnCount: number, nextCursorHint?: string) => unknown>;
}) {
  const {
    applyTurnWindowRef,
    forceScrollToLatestUntilRef,
    renderedTurnsRef,
    scrollToLatest,
    initialSessionLimit,
    optimisticUserIdAliasRef,
    sentAttachmentCacheRef,
    sessionIdRef,
    sessionOptimisticUserMapRef,
    sessionVisibleTurnCountRef
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
      sessionOptimisticUserMapRef.current[sid] = [...prev.filter((item) => item.id !== message.id), message].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
      );
      bumpOptimisticVersion();
    },
    [bumpOptimisticVersion, sessionOptimisticUserMapRef]
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
        const matched =
          serverUsers.find((item) => {
            if (usedIds.has(item.id)) return false;
            if (toText(item.text) !== text) return false;
            if ((item.attachments?.length || 0) !== (local.attachments?.length || 0)) return false;
            const serverCreatedAt = Number(item.createdAt || 0) || 0;
            if (serverCreatedAt < local.createdAt - OPTIMISTIC_MATCH_PAST_GRACE_MS) return false;
            if (serverCreatedAt > local.createdAt + OPTIMISTIC_MATCH_FUTURE_WINDOW_MS) return false;
            return true;
          }) ||
          serverUsers
            .filter((item) => {
              if (usedIds.has(item.id)) return false;
              if (toText(item.text) !== text) return false;
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
      const keepBaseTurns = base.renderedTurns.length > 0;
      const nextMessages = keepBaseTurns ? [...base.chatMessages] : [];
      const nextTurns = keepBaseTurns ? [...base.renderedTurns] : [];
      const existingTurnIds = new Set(nextTurns.map((turn) => turn.id));
      const existingMessageIds = new Set(nextMessages.map((message) => message.id));
      let appended = 0;
      for (const item of optimistic) {
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
      if (appended === 0) return base;
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
    []
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
      applyTurnWindowRef.current(sid, nextVisible);
      requestAnimationFrame(() => scrollToLatest(false));
    },
    [applyTurnWindowRef, forceScrollToLatestUntilRef, initialSessionLimit, renderedTurnsRef, scrollToLatest, sessionIdRef, sessionVisibleTurnCountRef]
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

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

type TurnWindowResult = ReturnType<typeof buildTurnWindow>;

export function useOptimisticUserMessages(params: {
  initialSessionLimit: number;
  sessionIdRef: MutableRefObject<string>;
  sessionOptimisticUserMapRef: MutableRefObject<Record<string, OptimisticUserMessage[]>>;
  optimisticUserIdAliasRef: MutableRefObject<Record<string, Record<string, string>>>;
  sentAttachmentCacheRef: MutableRefObject<Record<string, Record<string, { at: number; attachments: NonNullable<OptimisticUserMessage['attachments']> }>>>;
  forceScrollToLatestUntilRef: MutableRefObject<number>;
  sessionVisibleTurnCountRef: MutableRefObject<Record<string, number>>;
  setMessages: Dispatch<SetStateAction<MobileChatMessage[]>>;
  setRenderedTurns: Dispatch<SetStateAction<MobileRenderedTurn[]>>;
}) {
  const {
    forceScrollToLatestUntilRef,
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
      setMessages((prevMessages) => prevMessages.filter((item) => item.id !== optimisticId));
      setRenderedTurns((prevTurns) => prevTurns.filter((item) => item.id !== `turn:optimistic:${optimisticId}`));
      bumpOptimisticVersion();
    },
    [bumpOptimisticVersion, sessionOptimisticUserMapRef, setMessages, setRenderedTurns]
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
            const delta = Math.abs((Number(item.createdAt || 0) || 0) - local.createdAt);
            return delta <= 10 * 60 * 1000;
          }) ||
          serverUsers
            .filter((item) => !usedIds.has(item.id) && toText(item.text) === text)
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
      const keepBaseTurns = base.visibleTurnCount > initialSessionLimit;
      const nextMessages = keepBaseTurns ? [...base.chatMessages] : [];
      const nextTurns = keepBaseTurns ? [...base.renderedTurns] : [];
      for (const item of optimistic) {
        nextMessages.push({ id: item.id, role: 'user', text: item.text, createdAt: item.createdAt, attachments: item.attachments });
        nextTurns.push({
          id: `turn:optimistic:${item.id}`,
          createdAt: item.createdAt,
          userMessage: { id: item.id, role: 'user', text: item.text, createdAt: item.createdAt, attachments: item.attachments },
          items: [],
          signature: `optimistic:${item.id}:${item.text.length}:${item.attachments?.length || 0}`
        });
      }
      return {
        ...base,
        chatMessages: nextMessages,
        renderedTurns: nextTurns,
        mergedCount: base.mergedCount + optimistic.length,
        visibleTurnCount: keepBaseTurns ? base.visibleTurnCount + optimistic.length : optimistic.length,
        totalTurnCount: base.totalTurnCount + optimistic.length,
        hasUserTurn: true
      };
    },
    [initialSessionLimit]
  );

  const appendOptimisticTurnAndStick = useCallback(
    (message: OptimisticUserMessage) => {
      forceScrollToLatestUntilRef.current = Date.now() + 45000;
      setMessages([{ id: message.id, role: 'user', text: message.text, createdAt: message.createdAt, attachments: message.attachments }]);
      setRenderedTurns([
        {
          id: `turn:optimistic:${message.id}`,
          createdAt: message.createdAt,
          userMessage: { id: message.id, role: 'user', text: message.text, createdAt: message.createdAt, attachments: message.attachments },
          items: [],
          signature: `optimistic:${message.id}:${message.text.length}:${message.attachments?.length || 0}`
        }
      ]);
      sessionVisibleTurnCountRef.current[sessionIdRef.current] = initialSessionLimit;
      bumpOptimisticVersion();
    },
    [bumpOptimisticVersion, forceScrollToLatestUntilRef, initialSessionLimit, sessionIdRef, sessionVisibleTurnCountRef, setMessages, setRenderedTurns]
  );

  const clearSessionOptimisticMessages = useCallback(
    (targetSessionId: string) => {
      const sid = toText(targetSessionId).trim();
      if (!sid) return;
      const pending = sessionOptimisticUserMapRef.current[sid] || [];
      if (!pending.length) return;
      const ids = new Set(pending.map((item) => item.id));
      delete sessionOptimisticUserMapRef.current[sid];
      setMessages((prev) => prev.filter((item) => !ids.has(item.id)));
      setRenderedTurns((prev) => prev.filter((item) => !ids.has(item.id.replace(/^turn:optimistic:/, ''))));
      bumpOptimisticVersion();
    },
    [bumpOptimisticVersion, sessionOptimisticUserMapRef, setMessages, setRenderedTurns]
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

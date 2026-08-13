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
  pendingPromptSessionRef: MutableRefObject<Record<string, { id: string; startedAt: number }>>;
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
    (targetSessionId: string, chatMessages: MobileChatMessage[], renderedTurns?: MobileRenderedTurn[]) => {
      const sid = toText(targetSessionId).trim();
      const optimistic = Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid] : [];
      if (!sid || optimistic.length === 0) return optimistic;
      const serverUsers = chatMessages.filter((item) => item.role === 'user' && !!toText(item.text));
      const turns = Array.isArray(renderedTurns) ? renderedTurns : [];
      const visibleUserTexts = new Set(
        turns
          .map((turn) => toText(turn.userMessage?.text).trim())
          .filter(Boolean)
      );
      const usedIds = new Set<string>();
      const remaining: OptimisticUserMessage[] = [];
      let changed = false;
      for (const local of optimistic) {
        const text = toText(local.text);
        const localTextTrimmed = text.trim();
        const matchesOptimisticText = (serverText: string) => {
          if (serverText === text) return true;
          const serverTextTrimmed = serverText.trim();
          if (!serverTextTrimmed || !localTextTrimmed) return false;
          return serverTextTrimmed === localTextTrimmed;
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
          }) || null;
        if (matched) {
          // 权威已到但窗口未画出：先写 alias，仍保留乐观层；可见后再摘，避免双气泡 / 工具挂错轮。
          const aliasPrev = optimisticUserIdAliasRef.current[sid] || {};
          if (aliasPrev[matched.id] !== local.id) {
            optimisticUserIdAliasRef.current[sid] = { ...aliasPrev, [matched.id]: local.id };
            changed = true;
          }
          if (local.attachments?.length) {
            sentAttachmentCacheRef.current[sid] = {
              ...(sentAttachmentCacheRef.current[sid] || {}),
              [`id:${matched.id}`]: { at: Date.now(), attachments: local.attachments },
              [`id:${local.id}`]: { at: Date.now(), attachments: local.attachments },
              [`text:${text}`]: { at: Date.now(), attachments: local.attachments }
            };
          }
          usedIds.add(matched.id);
          if (localTextTrimmed && !visibleUserTexts.has(localTextTrimmed)) {
            remaining.push(local);
            continue;
          }
          continue;
        }
        remaining.push(local);
      }
      if (remaining.length === optimistic.length && !changed) return optimistic;
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
      // 流式 assistant 在权威 user 进表前会落成 orphan turn；并入乐观轮，过程文案才能出现在气泡下方。
      const orphanItems: MobileRenderedTurn['items'] = [];
      while (nextTurns.length > 0) {
        const last = nextTurns[nextTurns.length - 1]!;
        if (last.userMessage) break;
        nextTurns.pop();
        orphanItems.unshift(...last.items);
      }
      const existingTurnIds = new Set(nextTurns.map((turn) => turn.id));
      const existingMessageIds = new Set(nextMessages.map((message) => message.id));
      const existingUserTexts = new Set(
        nextTurns
          .map((turn) => toText(turn.userMessage?.text).trim())
          .filter(Boolean)
      );
      const alias = optimisticUserIdAliasRef.current[toText(sessionIdRef.current).trim()] || {};
      const aliasedLocalIds = new Set(Object.values(alias));
      const pending = optimistic.length > 1 ? [optimistic[optimistic.length - 1]!] : optimistic;
      let appended = 0;
      let orphanAttached = false;
      for (const item of pending) {
        const turnId = `turn:optimistic:${item.id}`;
        const text = toText(item.text).trim();
        // 权威气泡已在窗口（同 id / 同文案 / 已 alias），勿再叠乐观层
        if (existingTurnIds.has(turnId)) continue;
        if (aliasedLocalIds.has(item.id) && text && existingUserTexts.has(text)) continue;
        if (text && existingUserTexts.has(text)) continue;
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
        const items = !orphanAttached && orphanItems.length > 0 ? [...orphanItems] : [];
        if (items.length > 0) orphanAttached = true;
        const itemSig = items
          .map((timelineItem, index) => {
            if (timelineItem.kind === 'chat') {
              return `chat:${index}:${timelineItem.message.role}:${toText(timelineItem.message.text).length}`;
            }
            if (timelineItem.kind === 'think') {
              return `think:${index}:${timelineItem.card.finished ? 1 : 0}:${toText(timelineItem.card.text).length}`;
            }
            if (timelineItem.kind === 'event') {
              return `event:${index}:${toText(timelineItem.event.status)}:${toText(timelineItem.event.detail).length}`;
            }
            if (timelineItem.kind === 'toolBatch') {
              return `toolBatch:${index}:${toText(timelineItem.batch.status)}:${timelineItem.batch.events?.length || 0}`;
            }
            if (timelineItem.kind === 'context') {
              return `context:${index}:${toText(timelineItem.context.summary).length}`;
            }
            return `${timelineItem.kind}:${index}`;
          })
          .join('|');
        nextTurns.push({
          id: turnId,
          createdAt: item.createdAt,
          userMessage: { id: item.id, role: 'user', text: item.text, createdAt: item.createdAt, attachments: item.attachments },
          items,
          signature: [`optimistic:${item.id}:${item.text.length}:${item.attachments?.length || 0}`, itemSig].filter(Boolean).join('|')
        });
        existingTurnIds.add(turnId);
        if (text) existingUserTexts.add(text);
        appended += 1;
      }
      if (!orphanAttached && orphanItems.length > 0) {
        nextTurns.push({
          id: `turn:orphan-assistant:overlay:${orphanItems[0]?.createdAt || Date.now()}`,
          createdAt: orphanItems[0]?.createdAt || Date.now(),
          items: orphanItems,
          signature: ['user:none', `orphan:${orphanItems.length}`].join('|')
        });
      }
      if (appended === 0 && orphanItems.length === 0) {
        markMessageSendPerfForSession(sessionIdRef.current, 'list.overlay_optimistic.skip', {
          ms: Math.round(performance.now() - overlayStartedAt)
        });
        return base;
      }
      if (appended === 0 && orphanItems.length > 0) {
        // 只重挂 orphan，不算新乐观气泡。
        markMessageSendPerfForSession(sessionIdRef.current, 'list.overlay_optimistic.orphan_only', {
          ms: Math.round(performance.now() - overlayStartedAt),
          orphanItems: orphanItems.length
        });
        return {
          ...base,
          chatMessages: nextMessages,
          renderedTurns: nextTurns,
          visibleTurnCount: Math.max(base.visibleTurnCount, nextTurns.length),
          totalTurnCount: Math.max(base.totalTurnCount, nextTurns.length),
          hasUserTurn: base.hasUserTurn || nextTurns.some((turn) => !!turn.userMessage)
        };
      }
      markMessageSendPerfForSession(sessionIdRef.current, 'list.overlay_optimistic.done', {
        ms: Math.round(performance.now() - overlayStartedAt),
        appended,
        orphanItems: orphanAttached ? orphanItems.length : 0,
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
    [optimisticUserIdAliasRef, sessionIdRef]
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

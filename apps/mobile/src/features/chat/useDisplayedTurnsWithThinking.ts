import { useMemo } from 'react';
import { toText } from '../../lib/text';
import type { MobileChatMessage, MobileRenderedTurn, SessionStatusInfo } from '../../types';

type StreamDebug = (label: string, payload?: Record<string, unknown>) => void;

function turnHasAssistantRenderableContent(turn: MobileRenderedTurn): boolean {
  return turn.items.some((item) => {
    if (item.kind === 'think') return !!toText(item.card?.text).trim();
    if (item.kind === 'context') return true;
    if (item.kind === 'event' || item.kind === 'todo' || item.kind === 'question') return true;
    if (item.kind === 'chat' && item.message.role === 'assistant') {
      return !!toText(item.message.text).trim();
    }
    return false;
  });
}

function shouldShowThinkingPlaceholder(params: {
  currentSessionStatus: SessionStatusInfo;
  messages: MobileChatMessage[];
  renderedTurns: MobileRenderedTurn[];
  sessionWorking: boolean;
  streamDebug?: StreamDebug;
}) {
  const {
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    streamDebug
  } = params;

  if (!sessionWorking) return false;
  if (currentSessionStatus.type === 'retry') return false;
  for (let turnIdx = renderedTurns.length - 1; turnIdx >= 0; turnIdx -= 1) {
    const turn = renderedTurns[turnIdx];
    if (turn.items.some((item) => item.kind === 'error')) return false;
    if (turn.userMessage) {
      const show = !turnHasAssistantRenderableContent(turn);
      streamDebug?.('pending.placeholder.check', {
        turnId: turn.id,
        show,
        hasAssistantText: !show,
        itemKinds: turn.items.map((item: any) => item.kind).join(','),
        sessionWorking,
        status: currentSessionStatus.type
      });
      return show;
    }
  }
  if (messages.length <= 0) return true;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return true;
  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    if (messages[i].role === 'assistant' && messages[i].text.trim()) return false;
  }
  streamDebug?.('pending.placeholder.fallback', {
    show: true,
    reason: 'no assistant text after last user',
    messages: messages.length
  });
  return true;
}

export function useDisplayedTurnsWithThinking(params: {
  currentSessionStatus: SessionStatusInfo;
  messages: MobileChatMessage[];
  renderedTurns: MobileRenderedTurn[];
  sessionWorking: boolean;
  streamDebug?: StreamDebug;
}) {
  const {
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    streamDebug
  } = params;

  const showThinkingPlaceholder = useMemo(() => shouldShowThinkingPlaceholder({
    currentSessionStatus,
    messages,
    renderedTurns,
    sessionWorking,
    streamDebug
  }), [currentSessionStatus, messages, renderedTurns, sessionWorking, streamDebug]);

  const displayedTurns = useMemo(() => {
    if (!showThinkingPlaceholder || renderedTurns.length <= 0) return renderedTurns;
    const lastTurn = renderedTurns[renderedTurns.length - 1];
    const pendingItem = {
      kind: 'think' as const,
      createdAt: Date.now(),
      card: {
        id: `${lastTurn.id}:pending-thinking`,
        title: '思考中',
        text: '',
        createdAt: Date.now(),
        finished: false
      }
    };
    return [
      ...renderedTurns.slice(0, -1),
      {
        ...lastTurn,
        items: [...lastTurn.items, pendingItem],
        signature: `${lastTurn.signature}:pending-thinking`
      }
    ];
  }, [renderedTurns, showThinkingPlaceholder]);

  return {
    displayedTurns,
    showThinkingPlaceholder
  };
}

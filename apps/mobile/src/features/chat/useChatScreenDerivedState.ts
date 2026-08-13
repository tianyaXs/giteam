import { useMemo } from 'react';
import { toText } from '../../lib/text';
import type { MobileChatMessage, MobileRenderedTurn, SessionStatusInfo } from '../../types';

export function useChatScreenDerivedState(params: {
  sessionId: string;
  streaming: boolean;
  optimisticVersion: number;
  messages: MobileChatMessage[];
  renderedTurns: MobileRenderedTurn[];
  sessionStatusMap: Record<string, SessionStatusInfo>;
  sessionOptimisticUserMapRef: React.MutableRefObject<Record<string, any[]>>;
}) {
  const {
    messages,
    optimisticVersion,
    renderedTurns,
    sessionId,
    sessionOptimisticUserMapRef,
    sessionStatusMap,
    streaming
  } = params;

  const latestTurnMeta = useMemo(() => {
    const lastTurn = renderedTurns[renderedTurns.length - 1];
    if (!lastTurn) return { hasError: false };
    let hasError = false;
    for (const item of lastTurn.items) {
      if (item.kind === 'error') hasError = true;
    }
    return { hasError };
  }, [renderedTurns]);

  const currentSessionStatus = useMemo(() => {
    const sid = toText(sessionId).trim();
    if (!sid) return { type: 'idle' as const };
    return sessionStatusMap[sid] || { type: 'idle' as const };
  }, [sessionId, sessionStatusMap]);

  const localPendingCount = useMemo(() => {
    const sid = toText(sessionId).trim();
    if (!sid) {
      return Object.values(sessionOptimisticUserMapRef.current).reduce((sum, items) => sum + items.length, 0);
    }
    return Array.isArray(sessionOptimisticUserMapRef.current[sid]) ? sessionOptimisticUserMapRef.current[sid].length : 0;
  }, [optimisticVersion, sessionId, sessionOptimisticUserMapRef]);

  const localSending = localPendingCount > 0;

  const remoteSessionWorking = useMemo(() => {
    // busy/retry / streaming 优先：工具错误气泡不应把停止钮打成可发送。
    if (currentSessionStatus.type === 'busy' || currentSessionStatus.type === 'retry') return true;
    if (streaming) return true;
    if (latestTurnMeta.hasError) return false;
    return false;
  }, [currentSessionStatus, latestTurnMeta.hasError, streaming]);

  const sessionWorking = useMemo(() => {
    // localSending 覆盖乐观气泡尚未标 busy/streaming 的空隙
    if (localSending) return true;
    return remoteSessionWorking;
  }, [localSending, remoteSessionWorking]);

  const liveQuestionTurnId = useMemo(() => {
    for (let i = renderedTurns.length - 1; i >= 0; i -= 1) {
      const turn = renderedTurns[i];
      for (const item of turn.items) {
        if (item.kind === 'question') return turn.id;
      }
    }
    return '';
  }, [renderedTurns]);

  const activeQuestionsForTurn = useMemo(() => {
    if (!liveQuestionTurnId) return [];
    const turn = renderedTurns.find((t) => t.id === liveQuestionTurnId);
    if (!turn) return [];
    return turn.items
      .filter((item): item is Extract<typeof item, { kind: 'question' }> => item.kind === 'question')
      .map((item) => item.question);
  }, [liveQuestionTurnId, renderedTurns]);

  return {
    activeQuestionsForTurn,
    currentSessionStatus,
    latestTurnMeta,
    liveQuestionTurnId,
    localPendingCount,
    localSending,
    remoteSessionWorking,
    sessionWorking
  };
}

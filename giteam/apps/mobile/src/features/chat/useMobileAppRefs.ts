import { useRef } from "react";
import { AppState } from "react-native";
import EventSource from "react-native-sse";
import type { DiscoveredDevice } from "../../discovery";
import type {
  MobileChatMessage,
  MobileRenderedTurn,
  QuestionRequest,
  SessionStatusInfo,
} from "../../types";
import type {
  OpenCodeStreamStoreRefs,
  StreamPartEvent,
} from "../messages/opencodeStore";
import type { OptimisticUserMessage } from "../messages/useOptimisticUserMessages";
import type { ModelOption, ProjectOption } from "../workspace/catalogUtils";
import { INITIAL_SESSION_LIMIT, type SessionItem } from "./mobileAppConfig";

type SessionMessageSyncRefValue = {
  refreshMessages: (
    targetSessionId: string,
    opts?: {
      limit?: number;
      fetchLimit?: number;
      before?: string;
      reason?: string;
    },
  ) => Promise<any>;
  syncSessionMessages: (
    targetSessionId: string,
    opts?: {
      limit?: number;
      fetchLimit?: number;
      loadingOlder?: boolean;
      before?: string;
      anchorStableKey?: string;
      forceVisibleCount?: number;
    },
  ) => Promise<any>;
  onLoadOlderMessages: () => Promise<void>;
  resetMessageSyncState: () => void;
};

type SessionRecoveryRefValue = {
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
};

export function useMobileAppRefs() {
  const streamRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef("");
  const streamSessionRef = useRef("");
  const projectsRef = useRef<ProjectOption[]>([]);
  const sessionsRef = useRef<SessionItem[]>([]);
  const messagesRef = useRef<MobileChatMessage[]>([]);
  const renderedTurnsRef = useRef<MobileRenderedTurn[]>([]);
  const chatCellHeightMapRef = useRef<Record<string, number>>({});
  const sessionCacheRef = useRef<Record<string, SessionItem[]>>({});
  const modelOptionsRef = useRef<ModelOption[]>([]);
  const sessionRawMapRef = useRef<Record<string, any[]>>({});
  const sessionOptimisticUserMapRef = useRef<
    Record<string, OptimisticUserMessage[]>
  >({});
  const optimisticUserIdAliasRef = useRef<
    Record<string, Record<string, string>>
  >({});
  const sentAttachmentCacheRef = useRef<
    Record<
      string,
      Record<
        string,
        {
          at: number;
          attachments: NonNullable<OptimisticUserMessage["attachments"]>;
        }
      >
    >
  >({});
  const pendingPromptSessionRef = useRef<
    Record<string, { id: string; startedAt: number }>
  >({});
  const renderRegressionRetryRef = useRef<Record<string, number>>({});
  const streamMessageRoleRef = useRef<Record<string, Record<string, string>>>(
    {},
  );
  const streamMessageStoreRef = useRef<Record<string, Record<string, any>>>({});
  const streamPartStoreRef = useRef<
    Record<string, Record<string, import('../messages/opencodeStore').StreamPartBucket>>
  >({});
  const streamSessionStatusStoreRef = useRef<Record<string, SessionStatusInfo>>(
    {},
  );
  const streamPermissionStoreRef = useRef<Record<string, any[]>>({});
  const streamQuestionStoreRef = useRef<Record<string, QuestionRequest[]>>({});
  const streamTodoStoreRef = useRef<Record<string, any[]>>({});
  const streamPendingPartEventsRef = useRef<
    Record<string, Record<string, StreamPartEvent[]>>
  >({});
  const sessionVisibleTurnCountRef = useRef<Record<string, number>>({});
  const sessionTotalTurnCountRef = useRef<Record<string, number>>({});
  const streamRunIdRef = useRef(0);
  const streamRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const streamTypewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const streamTypewriterQueueRef = useRef<
    Record<
      string,
      {
        sid: string;
        messageId: string;
        partId: string;
        field: string;
        text: string;
      }
    >
  >({});
  const sessionStatusEpochRef = useRef(0);
  const busySinceRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const pairCodeMapRef = useRef<Record<string, string>>({});
  const closeDiscoverRef = useRef<(() => void) | null>(null);
  const discoveredPairRequiredRef = useRef<
    ((item: DiscoveredDevice, statusText: string) => void) | null
  >(null);
  const sessionMessageSyncRef = useRef<SessionMessageSyncRefValue | null>(null);
  const applyTurnWindowRef = useRef<
    (
      targetSessionId: string,
      visibleTurnCount: number,
      nextCursorHint?: string,
    ) => any
  >(() => ({
    chatMessages: [],
    renderedTurns: [],
    visibleTurnCount: INITIAL_SESSION_LIMIT,
    totalTurnCount: INITIAL_SESSION_LIMIT,
    writing: false,
  }));
  const sessionRecoveryRef = useRef<SessionRecoveryRefValue | null>(null);

  function getOpenCodeStreamStores(): OpenCodeStreamStoreRefs {
    return {
      messageRole: streamMessageRoleRef,
      message: streamMessageStoreRef,
      part: streamPartStoreRef,
      sessionStatus: streamSessionStatusStoreRef,
      permission: streamPermissionStoreRef,
      question: streamQuestionStoreRef,
      todo: streamTodoStoreRef,
      pendingPartEvents: streamPendingPartEventsRef,
      rawRows: sessionRawMapRef,
    };
  }

  function applyTurnWindow(
    targetSessionId: string,
    visibleTurnCount: number,
    nextCursorHint?: string,
  ) {
    return applyTurnWindowRef.current(
      targetSessionId,
      visibleTurnCount,
      nextCursorHint,
    );
  }

  return {
    streamRef,
    sessionIdRef,
    streamSessionRef,
    projectsRef,
    sessionsRef,
    messagesRef,
    renderedTurnsRef,
    chatCellHeightMapRef,
    sessionCacheRef,
    modelOptionsRef,
    sessionRawMapRef,
    sessionOptimisticUserMapRef,
    optimisticUserIdAliasRef,
    sentAttachmentCacheRef,
    pendingPromptSessionRef,
    renderRegressionRetryRef,
    streamMessageRoleRef,
    streamMessageStoreRef,
    streamPartStoreRef,
    streamSessionStatusStoreRef,
    streamPermissionStoreRef,
    streamQuestionStoreRef,
    streamTodoStoreRef,
    streamPendingPartEventsRef,
    sessionVisibleTurnCountRef,
    sessionTotalTurnCountRef,
    streamRunIdRef,
    streamRenderTimerRef,
    streamTypewriterTimerRef,
    streamTypewriterQueueRef,
    sessionStatusEpochRef,
    busySinceRef,
    appStateRef,
    pairCodeMapRef,
    closeDiscoverRef,
    discoveredPairRequiredRef,
    sessionMessageSyncRef,
    applyTurnWindowRef,
    sessionRecoveryRef,
    getOpenCodeStreamStores,
    applyTurnWindow,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPendingQuestions, rejectQuestion, replyQuestion } from '../../api/controlApi';
import { toText } from '../../lib/text';
import { loadQuestionDismissals, saveQuestionDismissal } from '../../storage/questionDismissals';
import type { OpenCodeStreamStoreRefs } from '../messages/opencodeStore';
import { upsertStreamQuestion } from '../messages/opencodeStore';
import type { QuestionRequest, SessionStatusInfo } from '../../types';

function sameQuestionIdSet(a: QuestionRequest[], b: QuestionRequest[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false;
  }
  return true;
}

function sameStringSet(a: Set<string>, b: Set<string>) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export type QuestionSubmitState = {
  status: 'submitting' | 'submitted' | 'failed';
  error?: string;
};

type UseQuestionControllerParams = {
  authed: boolean;
  serverUrl: string;
  token: string;
  repoPath: string;
  sessionId: string;
  streaming: boolean;
  sessionStatusMap: Record<string, SessionStatusInfo>;
  sessionIdRef: React.MutableRefObject<string>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  getOpenCodeStreamStores: () => OpenCodeStreamStoreRefs;
  pushConnLog: (message: string, level?: 'error' | 'info') => void;
  setStatus: (value: string | ((prev: string) => string)) => void;
  startStream: (targetSessionId: string) => void;
  syncSessionMessages: (
    targetSessionId: string,
    opts?: { limit?: number; fetchLimit?: number; loadingOlder?: boolean; before?: string; anchorStableKey?: string; forceVisibleCount?: number }
  ) => Promise<any>;
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
  initialSessionLimit: number;
  initialMessageFetchLimit: number;
};

export function useQuestionController({
  authed,
  serverUrl,
  token,
  repoPath,
  sessionId,
  streaming,
  sessionStatusMap,
  sessionIdRef,
  sessionRawMapRef,
  getOpenCodeStreamStores,
  pushConnLog,
  setStatus,
  startStream,
  syncSessionMessages,
  syncSessionStatus,
  initialSessionLimit,
  initialMessageFetchLimit
}: UseQuestionControllerParams) {
  const [questionRequests, setQuestionRequests] = useState<QuestionRequest[]>([]);
  const [dismissedQuestions, setDismissedQuestions] = useState<Set<string>>(() => new Set());
  const [questionSubmitState, setQuestionSubmitState] = useState<Record<string, QuestionSubmitState>>({});
  const [expandedTimelineQuestions, setExpandedTimelineQuestions] = useState<Set<string>>(new Set());
  const [timelineQuestionTabs, setTimelineQuestionTabs] = useState<Map<string, number>>(new Map());
  const questionListInFlightRef = useRef<Record<string, Promise<void>>>({});
  const questionListBackoffRef = useRef<Record<string, { failures: number; retryAt: number }>>({});
  const questionListLastFullRefreshRef = useRef<Record<string, number>>({});

  const activeQuestionRequest = useMemo(() => questionRequests[0] || null, [questionRequests]);

  const extractQuestionRequests = useCallback((raw: any[], targetSessionId: string): QuestionRequest[] => {
    const requests: QuestionRequest[] = [];
    const seenIds = new Set<string>();
    for (const row of raw) {
      const parts = Array.isArray(row?.parts) ? row.parts : [];
      for (const part of parts) {
        const partType = toText(part?.type).toLowerCase();
        if (partType !== 'tool') continue;
        const toolName = toText(part?.tool).toLowerCase();
        if (toolName !== 'question') continue;
        const state = part?.state || {};
        const status = toText(state?.status).toLowerCase();
        if (status !== 'pending' && status !== 'running') continue;
        const input = state?.input || {};
        const questions = input?.questions;
        if (!Array.isArray(questions) || questions.length === 0) continue;
        const callID = toText(state?.callID) || toText(part?.id);
        const messageID = toText(row?.info?.id);
        const requestId = callID || `question-${messageID}`;
        if (seenIds.has(requestId)) continue;
        seenIds.add(requestId);
        requests.push({
          id: requestId,
          sessionID: targetSessionId || sessionIdRef.current,
          questions: questions.map((q: any) => ({
            question: toText(q?.question),
            header: toText(q?.header) || undefined,
            options: Array.isArray(q?.options)
              ? q.options
                  .map((opt: any) => ({
                    label: toText(opt?.label),
                    description: toText(opt?.description) || undefined
                  }))
                  .filter((opt: any) => opt.label)
              : [],
            multiple: q?.multiple === true,
            custom: q?.custom !== false
          })),
          tool: callID && messageID ? { messageID, callID } : undefined
        });
      }
    }
    return requests;
  }, [sessionIdRef]);

  const refreshQuestionRequestsFromStore = useCallback((targetSessionId: string) => {
    const sid = toText(targetSessionId).trim();
    const live = (getOpenCodeStreamStores().question.current[sid] || []) as QuestionRequest[];
    const fromParts = extractQuestionRequests(sessionRawMapRef.current[sid] || [], sid);
    const merged = new Map<string, QuestionRequest>();
    [...fromParts, ...live].forEach((req) => {
      if (!req?.id || dismissedQuestions.has(req.id)) return;
      merged.set(req.id, req);
    });
    const nextRows = [...merged.values()];
    setQuestionRequests((prev) => (sameQuestionIdSet(prev, nextRows) ? prev : nextRows));
  }, [dismissedQuestions, extractQuestionRequests, getOpenCodeStreamStores, sessionRawMapRef]);

  const dismissQuestionRequest = useCallback((requestId: string, targetSessionId: string = sessionIdRef.current) => {
    const id = toText(requestId).trim();
    const sid = toText(targetSessionId).trim();
    const repo = toText(repoPath).trim();
    if (!id) return;
    setDismissedQuestions((prev) => new Set([...prev, id]));
    if (repo && sid) {
      try {
        saveQuestionDismissal(repo, sid, id);
      } catch {
        // ignore persistence failures; dismissal is a local UX cache.
      }
    }
  }, [repoPath, sessionIdRef]);

  const refreshPendingQuestions = useCallback(async (targetSessionId: string = sessionIdRef.current) => {
    const sid = toText(targetSessionId).trim();
    if (!sid || !repoPath.trim()) {
      setQuestionRequests([]);
      return;
    }
    const existing = questionListInFlightRef.current[sid];
    if (existing) return existing;
    const backoff = questionListBackoffRef.current[sid];
    if (backoff && backoff.retryAt > Date.now()) {
      refreshQuestionRequestsFromStore(sid);
      return;
    }
    const run = (async () => {
      const shouldFullRefresh = Date.now() - (questionListLastFullRefreshRef.current[sid] || 0) > 15000;
      try {
        const requests = await getPendingQuestions({
          baseUrl: serverUrl,
          token,
          repoPath,
          sessionId: sid,
          cachedOnly: !shouldFullRefresh
        });
        if (shouldFullRefresh) {
          questionListLastFullRefreshRef.current[sid] = Date.now();
        }
        if (requests.length > 0) {
          pushConnLog(`question.list ok${shouldFullRefresh ? '' : ' cached'} count=${requests.length} ids=${requests.map((r) => r.id).join(',')}`);
        }
        delete questionListBackoffRef.current[sid];
        requests.forEach((req) => upsertStreamQuestion(getOpenCodeStreamStores(), req));
        const deduped = new Map<string, QuestionRequest>();
        for (const req of requests) {
          if (req.sessionID !== sid || dismissedQuestions.has(req.id)) continue;
          const tool: { messageID?: string; callID?: string } = req.tool || {};
          const key = tool.callID || tool.messageID || req.id;
          const existing = deduped.get(key);
          if (!existing || (req.id.startsWith('que_') && !existing.id.startsWith('que_'))) {
            deduped.set(key, req);
          }
        }
        const liveIds = new Set([...deduped.values()].map((req) => req.id));
        refreshQuestionRequestsFromStore(sid);
        setQuestionSubmitState((prev) => {
          const next: Record<string, QuestionSubmitState> = {};
          for (const [id, state] of Object.entries(prev)) {
            if (liveIds.has(id)) next[id] = state;
          }
          return Object.keys(next).length === Object.keys(prev).length ? prev : next;
        });
      } catch (e) {
        pushConnLog(`question.list error ${String(e)}`, 'error');
        const failures = Math.min(5, (questionListBackoffRef.current[sid]?.failures || 0) + 1);
        questionListBackoffRef.current[sid] = {
          failures,
          retryAt: Date.now() + Math.min(15000, 1800 * 2 ** (failures - 1))
        };
        refreshQuestionRequestsFromStore(sid);
      }
    })();
    questionListInFlightRef.current[sid] = run;
    try {
      return await run;
    } finally {
      if (questionListInFlightRef.current[sid] === run) {
        delete questionListInFlightRef.current[sid];
      }
    }
  }, [
    dismissedQuestions,
    getOpenCodeStreamStores,
    pushConnLog,
    refreshQuestionRequestsFromStore,
    repoPath,
    serverUrl,
    sessionIdRef,
    token
  ]);

  const handleTimelineQuestionToggle = useCallback((id: string) => {
    setExpandedTimelineQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleTimelineTabChange = useCallback((questionId: string, tabIndex: number) => {
    setTimelineQuestionTabs((prev) => {
      const next = new Map(prev);
      next.set(questionId, tabIndex);
      return next;
    });
  }, []);

  const resetTimelineQuestionState = useCallback(() => {
    setExpandedTimelineQuestions(new Set());
    setTimelineQuestionTabs(new Map());
  }, []);

  const handleQuestionReply = useCallback((requestId: string, answers: string[][]) => {
    const sid = toText(sessionIdRef.current).trim();
    setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'submitting' } }));
    setStatus('正在提交答案...');
    void replyQuestion({
      baseUrl: serverUrl,
      token,
      repoPath,
      requestId,
      answers
    })
      .then(() => {
        setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'submitted' } }));
        pushConnLog(`question.reply ok ${requestId}`);
        setStatus('答案已提交');
        setTimeout(() => {
          setQuestionRequests((prev) => prev.filter((row) => row.id !== requestId));
          dismissQuestionRequest(requestId, sid);
        }, 450);
        if (sid) {
          startStream(sid);
          void syncSessionMessages(sid, {
            limit: initialSessionLimit,
            fetchLimit: initialMessageFetchLimit
          });
          void syncSessionStatus(sid);
        }
      })
      .catch((e) => {
        pushConnLog(`question.reply error ${requestId} ${String(e)}`, 'error');
        setStatus(`问题提交失败: ${String(e)}`);
        setQuestionSubmitState((prev) => ({ ...prev, [requestId]: { status: 'failed', error: String(e) } }));
      });
  }, [
    dismissQuestionRequest,
    initialMessageFetchLimit,
    initialSessionLimit,
    pushConnLog,
    repoPath,
    serverUrl,
    sessionIdRef,
    setStatus,
    startStream,
    syncSessionMessages,
    syncSessionStatus,
    token
  ]);

  const handleQuestionDismiss = useCallback((requestId: string) => {
    setQuestionRequests((prev) => prev.filter((r) => r.id !== requestId));
    dismissQuestionRequest(requestId);
    void rejectQuestion({
      baseUrl: serverUrl,
      token,
      repoPath,
      requestId
    });
  }, [dismissQuestionRequest, repoPath, serverUrl, token]);

  useEffect(() => {
    const sid = toText(sessionId).trim();
    if (!authed || !sid || !repoPath.trim()) return;
    void refreshPendingQuestions(sid);
    if (!streaming && sessionStatusMap[sid]?.type !== 'busy' && questionRequests.length === 0) return;
    const timer = setInterval(() => {
      void refreshPendingQuestions(sid);
    }, 3000);
    return () => clearInterval(timer);
  }, [
    authed,
    dismissedQuestions,
    questionRequests.length,
    refreshPendingQuestions,
    repoPath,
    serverUrl,
    sessionId,
    sessionStatusMap,
    streaming,
    token
  ]);

  useEffect(() => {
    const sid = toText(sessionId).trim();
    const repo = toText(repoPath).trim();
    if (!sid || !repo) {
      setDismissedQuestions((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    let alive = true;
    (() => {
      try {
        const ids = loadQuestionDismissals(repo, sid);
        if (!alive) return;
        setDismissedQuestions((prev) => (sameStringSet(prev, ids) ? prev : ids));
      } catch {
        // ignore persistence failures; pending questions can still render.
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, repoPath]);

  return {
    activeQuestionRequest,
    dismissedQuestions,
    dismissQuestionRequest,
    expandedTimelineQuestions,
    extractQuestionRequests,
    handleQuestionDismiss,
    handleQuestionReply,
    handleTimelineQuestionToggle,
    handleTimelineTabChange,
    persistQuestionDismissal: saveQuestionDismissal,
    questionRequests,
    questionSubmitState,
    refreshPendingQuestions,
    refreshQuestionRequestsFromStore,
    resetTimelineQuestionState,
    setDismissedQuestions,
    setQuestionRequests,
    setQuestionSubmitState,
    timelineQuestionTabs
  };
}

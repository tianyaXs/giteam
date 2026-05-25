import { useCallback, useMemo } from 'react';
import {
  abortSessionSwitchPerf,
  finishSessionSwitchPerf,
  markSessionSwitchPerf,
  startSessionSwitchPerf
} from './sessionSwitchPerf';
import { loadChatSnapshot } from '../../storage/chatSnapshot';
import { toText } from '../../lib/text';

const waitForDrawerReturnFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 260);
    });
  });

type SessionItemLike = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

type ProjectOptionLike = {
  id: string;
  worktree: string;
  name: string;
};

type SessionRow = {
  id: string;
  active: boolean;
  title: string;
  preview: string;
  timeLabel: string;
};

export function useLeftDrawerController(props: {
  projects: ProjectOptionLike[];
  projectsRefCurrent: ProjectOptionLike[];
  repoPath: string;
  sessions: SessionItemLike[];
  sessionSearch: string;
  sessionDisplayedCount: number;
  sessionId: string;
  messages: any[];
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionIdRef: React.MutableRefObject<string>;
  pickSessionDisplayTitle: (item: Pick<SessionItemLike, 'title' | 'preview' | 'id'>, fallbackMessages?: any[]) => string;
  projectNameFromPath: (path: string) => string;
  sanitizeProjectOptions: (items: ProjectOptionLike[]) => ProjectOptionLike[];
  formatSessionTimestamp: (value?: number) => string;
  stopStream: () => void;
  closeDrawer: () => void;
  setWorkspaceSwitcherOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setSessionNextCursor: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSessionHasMore: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSessionSearch: (value: string) => void;
  setSessionDisplayedCount: (value: number | ((prev: number) => number)) => void;
  setSessionSwitchingTo: (value: string | ((prev: string) => string)) => void;
  onNewSession: () => void;
  onSwitchProject: (worktree: string) => Promise<void>;
  setActiveSession: (sessionId: string) => void;
  syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number }) => Promise<any>;
  syncSessionStatus: (targetSessionId?: string) => Promise<any>;
  startStream: (targetSessionId: string) => void;
  initialSessionLimit: number;
  initialMessageFetchLimit: number;
  messagesRef: React.MutableRefObject<any[]>;
  renderedTurnsRef: React.MutableRefObject<any[]>;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
}) {
  const {
    closeDrawer,
    formatSessionTimestamp,
    initialMessageFetchLimit,
    initialSessionLimit,
    messages,
    messagesRef,
    pushConnLog,
    onNewSession,
    onSwitchProject,
    pickSessionDisplayTitle,
    projectNameFromPath,
    projects,
    projectsRefCurrent,
    renderedTurnsRef,
    repoPath,
    sanitizeProjectOptions,
    sessionDisplayedCount,
    sessionId,
    sessionIdRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    sessionSearch,
    sessions,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setSessionHasMore,
    setSessionNextCursor,
    setSessionDisplayedCount,
    setSessionSearch,
    setSessionSwitchingTo,
    setWorkspaceSwitcherOpen,
    startStream,
    stopStream,
    syncSessionStatus,
    syncSessionMessages,
  } = props;

  const reconnectRunningSession = useCallback(async (targetSessionId: string) => {
    try {
      const status = await syncSessionStatus(targetSessionId);
      if (sessionIdRef.current !== targetSessionId) return;
      if (status?.type === 'busy' || status?.type === 'retry') {
        startStream(targetSessionId);
      }
    } catch {
      // Status refresh is best-effort; message sync still owns visible recovery.
    }
  }, [sessionIdRef, startStream, syncSessionStatus]);

  const currentWorkspaceName = useMemo(
    () => (repoPath ? projectNameFromPath(repoPath) : '选择工作空间'),
    [projectNameFromPath, repoPath]
  );

  const availableProjects = useMemo(() => {
    const source = projects.length > 0 ? projects : projectsRefCurrent;
    const sanitized = sanitizeProjectOptions(source);
    if (sanitized.length > 0) return sanitized;
    const current = toText(repoPath).trim();
    return current ? sanitizeProjectOptions([{ id: current, worktree: current, name: projectNameFromPath(current) }]) : [];
  }, [projectNameFromPath, projects, projectsRefCurrent, repoPath, sanitizeProjectOptions]);

  const currentWorkspaceSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const title = toText(s.title).toLowerCase();
      const preview = toText(s.preview).toLowerCase();
      return title.includes(q) || preview.includes(q) || s.id.toLowerCase().includes(q);
    });
  }, [sessionSearch, sessions]);

  const leftDrawerSessionRows = useMemo<SessionRow[]>(() => {
    const source = currentWorkspaceSessions.slice(0, sessionSearch.trim() ? currentWorkspaceSessions.length : sessionDisplayedCount);
    return source.map((session) => ({
      id: session.id,
      active: session.id === sessionId,
      title: pickSessionDisplayTitle(session, session.id === sessionId ? messages : undefined),
      preview: toText(session.preview).trim(),
      timeLabel: formatSessionTimestamp(session.updatedAt || session.createdAt)
    }));
  }, [
    currentWorkspaceSessions,
    formatSessionTimestamp,
    messages,
    pickSessionDisplayTitle,
    sessionDisplayedCount,
    sessionId,
    sessionSearch
  ]);

  const handleDrawerProjectSelect = useCallback((worktree: string, active: boolean) => {
    setWorkspaceSwitcherOpen(false);
    if (active) return;
    closeDrawer();
    void onSwitchProject(worktree);
  }, [closeDrawer, onSwitchProject, setWorkspaceSwitcherOpen]);

  const handleDrawerSessionSelect = useCallback((targetSessionId: string, active: boolean) => {
    if (active) {
      closeDrawer();
      return;
    }
    void (async () => {
      const perf = startSessionSwitchPerf({
        targetSid: targetSessionId,
        fromSid: sessionIdRef.current,
        log: pushConnLog
      });
      try {
      const stopStartedAt = performance.now();
      stopStream();
      markSessionSwitchPerf(perf, 'drawer.stop_stream', {
        ms: Math.round(performance.now() - stopStartedAt)
      });

      // 优化4: 如果内存已有缓存，跳过 snapshot_disk
      const hasMemoryCache = (sessionRawMapRef.current[targetSessionId] || []).length > 0;
      let snapshot: ReturnType<typeof loadChatSnapshot> = null;
      let snapshotRawRows: any[] = [];
      let snapshotRenderedTurns: any[] = [];

      if (!hasMemoryCache) {
        const repo = toText(repoPath).trim();
        const snapshotStartedAt = performance.now();
        snapshot = repo ? (() => { try { return loadChatSnapshot(repo, targetSessionId); } catch { return null; } })() : null;
        snapshotRawRows = Array.isArray(snapshot?.rawRows) ? snapshot.rawRows : [];
        snapshotRenderedTurns = Array.isArray(snapshot?.renderedTurns) ? snapshot.renderedTurns : [];
        markSessionSwitchPerf(perf, 'drawer.snapshot_disk', {
          ms: Math.round(performance.now() - snapshotStartedAt),
          rawRows: snapshotRawRows.length,
          renderedTurns: snapshotRenderedTurns.length,
          hasSnapshot: snapshot ? 1 : 0
        });
        if (snapshotRawRows.length > 0) {
          const visibleTurnCount = Math.max(0, Number(snapshot?.visibleTurnCount || snapshotRenderedTurns.length || 0));
          // 修复：totalTurnCount 应该使用快照中的值，而不是和 visibleTurnCount 取 max
          // 如果快照中没有 totalTurnCount，则使用 visibleTurnCount 作为回退
          const totalTurnCount = Math.max(0, Number(snapshot?.totalTurnCount || visibleTurnCount));
          sessionRawMapRef.current[targetSessionId] = snapshotRawRows;
          sessionVisibleTurnCountRef.current[targetSessionId] = visibleTurnCount;
          sessionTotalTurnCountRef.current[targetSessionId] = totalTurnCount;
          setSessionNextCursor((prev) => ({ ...prev, [targetSessionId]: toText(snapshot?.nextCursor).trim() }));
          setSessionHasMore((prev) => ({
            ...prev,
            [targetSessionId]: !!toText(snapshot?.nextCursor).trim() || totalTurnCount > visibleTurnCount
          }));
          markSessionSwitchPerf(perf, 'drawer.snapshot_inject_memory', { rawRows: snapshotRawRows.length });
        }
      } else {
        markSessionSwitchPerf(perf, 'drawer.snapshot_disk', {
          ms: 0,
          rawRows: 0,
          renderedTurns: 0,
          hasSnapshot: 0,
          skipped: 'memory_cache'
        });
      }

      const hasCachedRows = (sessionRawMapRef.current[targetSessionId] || []).length > 0;
      markSessionSwitchPerf(perf, 'drawer.set_active_session.call', { hasCachedRows: hasCachedRows ? 1 : 0 });

      // 优化2: 预加载消息 - 在 setActiveSession 前就开始 fetch
      let prefetchPromise: Promise<any> | null = null;
      if (!hasCachedRows && !snapshot) {
        prefetchPromise = syncSessionMessages(targetSessionId, {
          limit: initialSessionLimit,
          fetchLimit: initialMessageFetchLimit
        }).catch(() => undefined);
      }

      closeDrawer();
      markSessionSwitchPerf(perf, 'drawer.close_requested');
      await waitForDrawerReturnFrame();

      const activateStartedAt = performance.now();
      setActiveSession(targetSessionId);
      markSessionSwitchPerf(perf, 'drawer.set_active_session.returned', {
        ms: Math.round(performance.now() - activateStartedAt)
      });

      if (!hasCachedRows) {
        if (snapshot && sessionIdRef.current === targetSessionId) {
          const snapshotUiStartedAt = performance.now();
          setMessages(snapshot.messages);
          setRenderedTurns(snapshot.renderedTurns);
          messagesRef.current = snapshot.messages;
          renderedTurnsRef.current = snapshot.renderedTurns;
          setSessionSwitchingTo('');
          markSessionSwitchPerf(perf, 'drawer.snapshot_messages_fast', {
            ms: Math.round(performance.now() - snapshotUiStartedAt),
            messages: snapshot.messages.length,
            turns: snapshot.renderedTurns.length
          });
          finishSessionSwitchPerf(perf, 'snapshot_messages_fast');
          void reconnectRunningSession(targetSessionId);
          return;
        }
        if (prefetchPromise) {
          markSessionSwitchPerf(perf, 'drawer.sync.await_begin', { source: 'prefetch' });
          const syncStartedAt = performance.now();
          await prefetchPromise;
          markSessionSwitchPerf(perf, 'drawer.sync.await_done', {
            ms: Math.round(performance.now() - syncStartedAt)
          });
          finishSessionSwitchPerf(perf, 'sync_network_prefetch');
        } else {
          markSessionSwitchPerf(perf, 'drawer.sync.await_begin');
          const syncStartedAt = performance.now();
          await syncSessionMessages(targetSessionId, {
            limit: initialSessionLimit,
            fetchLimit: initialMessageFetchLimit
          }).catch(() => undefined);
          markSessionSwitchPerf(perf, 'drawer.sync.await_done', {
            ms: Math.round(performance.now() - syncStartedAt)
          });
          finishSessionSwitchPerf(perf, 'sync_network');
        }
      } else {
        finishSessionSwitchPerf(perf, 'memory_cache');
      }
      void reconnectRunningSession(targetSessionId);
      } catch (error) {
        abortSessionSwitchPerf(perf, String(error));
        throw error;
      }
    })();
  }, [
    closeDrawer,
    initialMessageFetchLimit,
    initialSessionLimit,
    messagesRef,
    pushConnLog,
    reconnectRunningSession,
    renderedTurnsRef,
    repoPath,
    sessionIdRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setSessionHasMore,
    setSessionNextCursor,
    setSessionSwitchingTo,
    stopStream,
    syncSessionMessages
  ]);

  const handleNewSession = useCallback(() => {
    onNewSession();
    closeDrawer();
  }, [closeDrawer, onNewSession]);

  const handleShowMoreSessions = useCallback(() => {
    setSessionDisplayedCount((p) => Math.min(Number(p) + 5, currentWorkspaceSessions.length));
  }, [currentWorkspaceSessions.length, setSessionDisplayedCount]);

  return {
    currentWorkspaceName,
    availableProjects,
    currentWorkspaceSessions,
    leftDrawerSessionRows,
    sessionSearch,
    repoPath,
    handleDrawerProjectSelect,
    handleDrawerSessionSelect,
    handleNewSession,
    handleShowMoreSessions,
    onChangeSessionSearch: setSessionSearch
  };
}

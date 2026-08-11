import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  abortSessionSwitchPerf,
  finishSessionSwitchPerf,
  markSessionSwitchPerf,
  startSessionSwitchPerf
} from './sessionSwitchPerf';
import { loadChatSnapshot } from '../../storage/chatSnapshot';
import { normalizeWorkspacePath } from '../../lib/path';
import { toText } from '../../lib/text';
import { cleanSessionPreview } from './sessionDisplay';
import type { SessionStatusInfo } from '../../types';

const DEFAULT_DISPLAY_COUNT = 3;

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

export type DrawerSessionRow = {
  id: string;
  active: boolean;
  title: string;
  preview: string;
  timeLabel: string;
  updatedAt: number;
  status: SessionStatusInfo['type'];
  worktree: string;
};

export type ProjectTreeNode = {
  id: string;
  worktree: string;
  name: string;
  expanded: boolean;
  isCurrent: boolean;
  /** 是否有可展开的会话；空项目点目录即选中当前项目 */
  hasSessions: boolean;
  sessions: DrawerSessionRow[];
  totalCount: number;
  showMore: boolean;
};

export function useLeftDrawerController(props: {
  projects: ProjectOptionLike[];
  projectsRefCurrent: ProjectOptionLike[];
  repoPath: string;
  sessions: SessionItemLike[];
  sessionCacheRef: React.MutableRefObject<Record<string, SessionItemLike[]>>;
  sessionSearch: string;
  sessionStatusMap: Record<string, SessionStatusInfo>;
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
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setSessionNextCursor: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSessionHasMore: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSessionSearch: (value: string) => void;
  setSessionSwitchingTo: (value: string | ((prev: string) => string)) => void;
  onNewSession: () => void;
  onSwitchProject: (worktree: string, opts?: { activateSessionId?: string | null }) => Promise<void>;
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
    sessionCacheRef,
    sessionId,
    sessionIdRef,
    sessionStatusMap,
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
    setSessionSearch,
    setSessionSwitchingTo,
    startStream,
    stopStream,
    syncSessionStatus,
    syncSessionMessages
  } = props;

  const [expandedProjectPaths, setExpandedProjectPaths] = useState<string[]>([]);
  const [displayCountByRepo, setDisplayCountByRepo] = useState<Record<string, number>>({});

  const currentRepoKey = useMemo(() => normalizeWorkspacePath(repoPath), [repoPath]);

  // 当前有会话的项目始终展开；空项目不展开。
  useEffect(() => {
    if (!currentRepoKey) return;
    setExpandedProjectPaths((prev) => (prev.includes(currentRepoKey) ? prev : [...prev, currentRepoKey]));
  }, [currentRepoKey]);

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
    () => (repoPath ? projectNameFromPath(repoPath) : ''),
    [projectNameFromPath, repoPath]
  );

  const availableProjects = useMemo(() => {
    const source = projects.length > 0 ? projects : projectsRefCurrent;
    const sanitized = sanitizeProjectOptions(source);
    if (sanitized.length > 0) return sanitized;
    const current = toText(repoPath).trim();
    return current ? sanitizeProjectOptions([{ id: current, worktree: current, name: projectNameFromPath(current) }]) : [];
  }, [projectNameFromPath, projects, projectsRefCurrent, repoPath, sanitizeProjectOptions]);

  const sessionsForWorktree = useCallback(
    (worktree: string): SessionItemLike[] => {
      const key = normalizeWorkspacePath(worktree);
      if (key && key === currentRepoKey) return sessions;
      return (
        sessionCacheRef.current[key] ||
        sessionCacheRef.current[toText(worktree).trim()] ||
        []
      );
    },
    [currentRepoKey, sessionCacheRef, sessions]
  );

  const toSessionRow = useCallback(
    (session: SessionItemLike, worktree: string): DrawerSessionRow => ({
      id: session.id,
      active: session.id === sessionId,
      title: pickSessionDisplayTitle(
        session,
        session.id === sessionId ? messagesRef.current : undefined
      ),
      preview: cleanSessionPreview(session.preview),
      timeLabel: formatSessionTimestamp(session.updatedAt || session.createdAt),
      updatedAt: Number(session.updatedAt || session.createdAt || 0),
      status: sessionStatusMap[session.id]?.type || 'idle',
      worktree
    }),
    [formatSessionTimestamp, messagesRef, pickSessionDisplayTitle, sessionId, sessionStatusMap]
  );

  const activeSessionTitleHint = useMemo(() => {
    if (!sessionId) return '';
    const current = sessions.find((s) => s.id === sessionId);
    if (!current) return '';
    return pickSessionDisplayTitle(current, messages);
  }, [messages, pickSessionDisplayTitle, sessionId, sessions]);

  const prevProjectTreesRef = useRef<ProjectTreeNode[]>([]);

  const projectTrees = useMemo<ProjectTreeNode[]>(() => {
    const q = sessionSearch.trim().toLowerCase();
    const prevByKey = new Map(
      prevProjectTreesRef.current.map((p) => [normalizeWorkspacePath(p.worktree), p])
    );
    const nextTrees = availableProjects.map((project) => {
      const key = normalizeWorkspacePath(project.worktree);
      const all = sessionsForWorktree(project.worktree);
      const filtered = !q
        ? all
        : all.filter((s) => {
            const title = toText(s.title).toLowerCase();
            const preview = toText(s.preview).toLowerCase();
            return title.includes(q) || preview.includes(q) || s.id.toLowerCase().includes(q);
          });
      const limit = q ? filtered.length : displayCountByRepo[key] || DEFAULT_DISPLAY_COUNT;
      const visible = filtered.slice(0, limit);
      const hasSessions = filtered.length > 0;
      // 当前项目有会话 → 始终展开；空项目永不展开；其它有会话项目可手动展开
      const expanded = !hasSessions ? false : q ? true : key === currentRepoKey || expandedProjectPaths.includes(key);
      const prev = prevByKey.get(key);
      const prevSessionsById = new Map((prev?.sessions || []).map((s) => [s.id, s]));
      const nextSessions = visible.map((s) => {
        const row = toSessionRow(s, project.worktree);
        const prevRow = prevSessionsById.get(s.id);
        if (
          prevRow &&
          prevRow.active === row.active &&
          prevRow.title === row.title &&
          prevRow.preview === row.preview &&
          prevRow.timeLabel === row.timeLabel &&
          prevRow.status === row.status &&
          prevRow.worktree === row.worktree
        ) {
          return prevRow;
        }
        return row;
      });
      const sessions =
        prev &&
        prev.sessions.length === nextSessions.length &&
        prev.sessions.every((s, i) => s === nextSessions[i])
          ? prev.sessions
          : nextSessions;

      if (
        prev &&
        prev.id === (project.id || project.worktree) &&
        prev.name === project.name &&
        prev.expanded === expanded &&
        prev.isCurrent === (key === currentRepoKey) &&
        prev.hasSessions === hasSessions &&
        prev.totalCount === filtered.length &&
        prev.showMore === (!q && filtered.length > visible.length) &&
        prev.sessions === sessions
      ) {
        return prev;
      }

      return {
        id: project.id || project.worktree,
        worktree: project.worktree,
        name: project.name,
        expanded,
        isCurrent: key === currentRepoKey,
        hasSessions,
        sessions,
        totalCount: filtered.length,
        showMore: !q && filtered.length > visible.length
      };
    });
    prevProjectTreesRef.current = nextTrees;
    return nextTrees;
  }, [
    activeSessionTitleHint,
    availableProjects,
    currentRepoKey,
    displayCountByRepo,
    expandedProjectPaths,
    sessionSearch,
    sessionsForWorktree,
    toSessionRow
  ]);

  const searchSessionRows = useMemo<DrawerSessionRow[]>(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return [];
    const rows: DrawerSessionRow[] = [];
    for (const project of availableProjects) {
      for (const session of sessionsForWorktree(project.worktree)) {
        const title = toText(session.title).toLowerCase();
        const preview = toText(session.preview).toLowerCase();
        if (title.includes(q) || preview.includes(q) || session.id.toLowerCase().includes(q)) {
          rows.push(toSessionRow(session, project.worktree));
        }
      }
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [availableProjects, sessionSearch, sessionsForWorktree, toSessionRow]);

  const handleToggleProject = useCallback((worktree: string) => {
    const key = normalizeWorkspacePath(worktree);
    if (!key) return;
    // 当前项目保持展开，不允许收起
    if (key === currentRepoKey) return;
    setExpandedProjectPaths((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }, [currentRepoKey]);

  /** 空项目：点目录即切换当前项目（进入该项目空草稿）。 */
  const handleSelectProject = useCallback(
    (worktree: string) => {
      const targetRepo = toText(worktree).trim();
      if (!targetRepo) return;
      const key = normalizeWorkspacePath(targetRepo);
      if (key && key === currentRepoKey) return;
      void (async () => {
        try {
          stopStream();
          await onSwitchProject(targetRepo, { activateSessionId: null });
          setExpandedProjectPaths((prev) => (prev.includes(key) ? prev : [...prev, key]));
        } catch {
          // switch is best-effort; status line already reports failures upstream
        }
      })();
    },
    [currentRepoKey, onSwitchProject, stopStream]
  );

  /** 点项目行：有会话 → 展开/收起预览；无会话 → 选为当前项目。 */
  const handlePressProject = useCallback(
    (worktree: string, hasSessions: boolean) => {
      if (hasSessions) {
        handleToggleProject(worktree);
        return;
      }
      handleSelectProject(worktree);
    },
    [handleSelectProject, handleToggleProject]
  );

  const handleDrawerSessionSelect = useCallback((targetSessionId: string, worktree: string, active: boolean) => {
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

        const targetRepo = toText(worktree).trim();
        const needProjectSwitch =
          normalizeWorkspacePath(targetRepo) !== normalizeWorkspacePath(repoPath);

        if (needProjectSwitch && targetRepo) {
          markSessionSwitchPerf(perf, 'drawer.switch_project.begin');
          await onSwitchProject(targetRepo, { activateSessionId: null });
          markSessionSwitchPerf(perf, 'drawer.switch_project.done');
        }

        const hasMemoryCache = (sessionRawMapRef.current[targetSessionId] || []).length > 0;
        let snapshot: ReturnType<typeof loadChatSnapshot> = null;
        let snapshotRawRows: any[] = [];
        let snapshotRenderedTurns: any[] = [];

        if (!hasMemoryCache) {
          const repo = normalizeWorkspacePath(targetRepo || repoPath);
          const snapshotStartedAt = performance.now();
          snapshot = repo
            ? (() => {
                try {
                  return loadChatSnapshot(repo, targetSessionId);
                } catch {
                  return null;
                }
              })()
            : null;
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
    onSwitchProject,
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

  const handleShowMoreSessions = useCallback((worktree: string) => {
    const key = normalizeWorkspacePath(worktree);
    if (!key) return;
    setDisplayCountByRepo((prev) => {
      const total = Math.max(sessionsForWorktree(worktree).length, DEFAULT_DISPLAY_COUNT);
      // 一次展开完整列表
      return { ...prev, [key]: total };
    });
  }, [sessionsForWorktree]);

  const isSessionListEmpty = useMemo(() => {
    if (sessionSearch.trim()) return searchSessionRows.length === 0;
    return projectTrees.every((p) => p.totalCount === 0);
  }, [projectTrees, searchSessionRows.length, sessionSearch]);

  return {
    currentWorkspaceName,
    availableProjects,
    projectTrees,
    searchSessionRows,
    sessionSearch,
    repoPath,
    isSessionListEmpty,
    handleToggleProject,
    handlePressProject,
    handleSelectProject,
    handleDrawerSessionSelect,
    handleNewSession,
    handleShowMoreSessions,
    onChangeSessionSearch: setSessionSearch
  };
}

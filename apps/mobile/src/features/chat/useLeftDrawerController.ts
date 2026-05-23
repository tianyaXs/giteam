import { useCallback, useMemo } from 'react';
import { loadChatSnapshot } from '../../storage/chatSnapshot';
import { toText } from '../../lib/text';

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
}) {
  const {
    closeDrawer,
    formatSessionTimestamp,
    initialMessageFetchLimit,
    initialSessionLimit,
    messages,
    messagesRef,
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
      stopStream();
      const repo = toText(repoPath).trim();
      const snapshot = repo ? (() => { try { return loadChatSnapshot(repo, targetSessionId); } catch { return null; } })() : null;
      const snapshotRawRows = Array.isArray(snapshot?.rawRows) ? snapshot.rawRows : [];
      const snapshotRenderedTurns = Array.isArray(snapshot?.renderedTurns) ? snapshot.renderedTurns : [];
      if ((sessionRawMapRef.current[targetSessionId] || []).length <= 0 && snapshotRawRows.length > 0) {
        const visibleTurnCount = Math.max(0, Number(snapshot?.visibleTurnCount || snapshotRenderedTurns.length || 0));
        const totalTurnCount = Math.max(visibleTurnCount, Number(snapshot?.totalTurnCount || visibleTurnCount));
        sessionRawMapRef.current[targetSessionId] = snapshotRawRows;
        sessionVisibleTurnCountRef.current[targetSessionId] = visibleTurnCount;
        sessionTotalTurnCountRef.current[targetSessionId] = totalTurnCount;
        setSessionNextCursor((prev) => ({ ...prev, [targetSessionId]: toText(snapshot?.nextCursor).trim() }));
        setSessionHasMore((prev) => ({
          ...prev,
          [targetSessionId]: !!toText(snapshot?.nextCursor).trim() || totalTurnCount > visibleTurnCount
        }));
      }
      const hasCachedRows = (sessionRawMapRef.current[targetSessionId] || []).length > 0;
      setActiveSession(targetSessionId);
      closeDrawer();
      if (!hasCachedRows) {
        if (snapshot && sessionIdRef.current === targetSessionId) {
          setMessages(snapshot.messages);
          setRenderedTurns(snapshot.renderedTurns);
          messagesRef.current = snapshot.messages;
          renderedTurnsRef.current = snapshot.renderedTurns;
          setSessionSwitchingTo('');
          void reconnectRunningSession(targetSessionId);
          return;
        }
        await syncSessionMessages(targetSessionId, {
          limit: initialSessionLimit,
          fetchLimit: initialMessageFetchLimit
        }).catch(() => undefined);
      }
      void reconnectRunningSession(targetSessionId);
    })();
  }, [
    closeDrawer,
    initialMessageFetchLimit,
    initialSessionLimit,
    messagesRef,
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

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
  sessionRawMapRefCurrent: Record<string, any[]>;
  sessionIdRefCurrent: string;
  pickSessionDisplayTitle: (item: Pick<SessionItemLike, 'title' | 'preview' | 'id'>, fallbackMessages?: any[]) => string;
  projectNameFromPath: (path: string) => string;
  sanitizeProjectOptions: (items: ProjectOptionLike[]) => ProjectOptionLike[];
  formatSessionTimestamp: (value?: number) => string;
  stopStream: () => void;
  closeDrawer: () => void;
  setWorkspaceSwitcherOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setSessionSearch: (value: string) => void;
  setSessionDisplayedCount: (value: number | ((prev: number) => number)) => void;
  setSessionSwitchingTo: (value: string | ((prev: string) => string)) => void;
  onNewSession: () => void;
  onSwitchProject: (worktree: string) => Promise<void>;
  setActiveSession: (sessionId: string) => void;
  syncSessionMessages: (targetSessionId: string, opts?: { limit?: number; fetchLimit?: number }) => Promise<any>;
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
    sessionIdRefCurrent,
    sessionRawMapRefCurrent,
    sessionSearch,
    sessions,
    setActiveSession,
    setMessages,
    setRenderedTurns,
    setSessionDisplayedCount,
    setSessionSearch,
    setSessionSwitchingTo,
    setWorkspaceSwitcherOpen,
    stopStream,
    syncSessionMessages,
  } = props;

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
    void onSwitchProject(worktree);
  }, [onSwitchProject, setWorkspaceSwitcherOpen]);

  const handleDrawerSessionSelect = useCallback((targetSessionId: string, active: boolean) => {
    if (active) {
      closeDrawer();
      return;
    }
    void (async () => {
      stopStream();
      const hasCachedRows = (sessionRawMapRefCurrent[targetSessionId] || []).length > 0;
      setActiveSession(targetSessionId);
      if (!hasCachedRows) {
        const repo = toText(repoPath).trim();
        const snapshot = repo ? (() => { try { return loadChatSnapshot(repo, targetSessionId); } catch { return null; } })() : null;
        if (snapshot && sessionIdRefCurrent === targetSessionId) {
          setMessages(snapshot.messages);
          setRenderedTurns(snapshot.renderedTurns);
          messagesRef.current = snapshot.messages;
          renderedTurnsRef.current = snapshot.renderedTurns;
          setSessionSwitchingTo('');
          closeDrawer();
          void syncSessionMessages(targetSessionId, {
            limit: initialSessionLimit,
            fetchLimit: initialMessageFetchLimit
          });
          return;
        }
        await syncSessionMessages(targetSessionId, {
          limit: initialSessionLimit,
          fetchLimit: initialMessageFetchLimit
        }).catch(() => undefined);
      }
      if (sessionIdRefCurrent === targetSessionId) closeDrawer();
    })();
  }, [
    closeDrawer,
    initialMessageFetchLimit,
    initialSessionLimit,
    messagesRef,
    renderedTurnsRef,
    repoPath,
    sessionIdRefCurrent,
    sessionRawMapRefCurrent,
    setActiveSession,
    setMessages,
    setRenderedTurns,
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

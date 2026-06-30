import { useEffect } from 'react';
import { loadChatSnapshot } from '../../storage/chatSnapshot';
import { loadPairCodeMap } from '../../storage/pairCodeMap';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '../../storage/prefs';
import { loadSessionCache } from '../../storage/sessionCache';
import { toText } from '../../lib/text';

type ProjectOptionLike = {
  worktree: string;
};

type ChatSnapshotLike = {
  rawRows?: any[];
  nextCursor?: string;
  visibleTurnCount?: number;
  totalTurnCount?: number;
  messages: any[];
  renderedTurns: any[];
};

export function useBootstrapPersistence(params: {
  loaded: boolean;
  serverUrl: string;
  serverUrlTouched: boolean;
  preferHttps: boolean;
  pairCode: string;
  repoPath: string;
  projects: ProjectOptionLike[];
  token: string;
  sessionId: string;
  model: string;
  composerAgent: 'build' | 'plan';
  autoAcceptPermissions: boolean;
  notebookTheme: 'paper' | 'slate';
  setLoaded: (value: boolean) => void;
  setStatus: (value: string) => void;
  setServerUrl: (value: string) => void;
  setServerUrlInput: (value: string) => void;
  setServerUrlTouched: (value: boolean) => void;
  setPreferHttps: (value: boolean) => void;
  setPairCode: (value: string) => void;
  setRepoPath: (value: string) => void;
  setProjects: (value: any[]) => void;
  setToken: (value: string) => void;
  setSessionId: (value: string) => void;
  setComposerAgent: (value: 'build' | 'plan') => void;
  setAutoAcceptPermissions: (value: boolean) => void;
  setNotebookTheme: (value: 'paper' | 'slate') => void;
  setMessages: (value: any[]) => void;
  setRenderedTurns: (value: any[]) => void;
  setStartupSessionHydrating: (value: boolean) => void;
  setModel: (value: string) => void;
  setSessionSwitchingTo: React.Dispatch<React.SetStateAction<string>>;
  sessionIdRef: React.MutableRefObject<string>;
  pairCodeMapRef: React.MutableRefObject<Record<string, string>>;
  sessionCacheRef: React.MutableRefObject<Record<string, any[]>>;
  sessionRawMapRef: React.MutableRefObject<Record<string, any[]>>;
  sessionVisibleTurnCountRef: React.MutableRefObject<Record<string, number>>;
  sessionTotalTurnCountRef: React.MutableRefObject<Record<string, number>>;
  messagesRef: React.MutableRefObject<any[]>;
  renderedTurnsRef: React.MutableRefObject<any[]>;
  stopStream: () => void;
  stripUrlScheme: (value: string) => string;
  toProjectOptionsFromPaths: (paths: string[]) => any[];
}) {
  const {
    autoAcceptPermissions,
    composerAgent,
    loaded,
    messagesRef,
    model,
    notebookTheme,
    pairCode,
    pairCodeMapRef,
    preferHttps,
    projects,
    renderedTurnsRef,
    repoPath,
    serverUrl,
    serverUrlTouched,
    sessionCacheRef,
    sessionId,
    sessionIdRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setAutoAcceptPermissions,
    setComposerAgent,
    setLoaded,
    setMessages,
    setModel,
    setNotebookTheme,
    setPairCode,
    setPreferHttps,
    setProjects,
    setRenderedTurns,
    setRepoPath,
    setServerUrl,
    setServerUrlInput,
    setServerUrlTouched,
    setSessionId,
    setSessionSwitchingTo,
    setStartupSessionHydrating,
    setStatus,
    setToken,
    stopStream,
    stripUrlScheme,
    toProjectOptionsFromPaths,
    token
  } = params;

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const prefs = loadPrefs();
        if (!alive) return;
        const cachedChat = prefs.token && prefs.repoPath && prefs.sessionId
          ? (() => {
              try {
                return loadChatSnapshot(prefs.repoPath, prefs.sessionId);
              } catch {
                return null;
              }
            })()
          : null;
        if (!alive) return;
        setServerUrl(prefs.serverUrl);
        setServerUrlInput(stripUrlScheme(prefs.serverUrl));
        setServerUrlTouched(Boolean((prefs as any).serverUrlTouched));
        setPreferHttps(Boolean((prefs as any).preferHttps));
        setPairCode(prefs.pairCode);
        setRepoPath(prefs.repoPath);
        setProjects(toProjectOptionsFromPaths(prefs.repoPaths || []));
        setToken(prefs.token);
        setSessionId(prefs.sessionId);
        sessionIdRef.current = prefs.sessionId;
        setComposerAgent(prefs.agent || 'build');
        setAutoAcceptPermissions(Boolean((prefs as any).autoAcceptPermissions));
        setNotebookTheme(prefs.notebookTheme || 'paper');
        if (cachedChat) {
          const sid = toText(prefs.sessionId).trim();
          const rawRows = Array.isArray(cachedChat.rawRows) ? cachedChat.rawRows : [];
          const visibleTurnCount = Math.max(0, Number(cachedChat.visibleTurnCount || cachedChat.renderedTurns.length || 0));
          const totalTurnCount = Math.max(visibleTurnCount, Number(cachedChat.totalTurnCount || visibleTurnCount));
          if (sid) {
            sessionRawMapRef.current[sid] = rawRows;
            sessionVisibleTurnCountRef.current[sid] = visibleTurnCount;
            sessionTotalTurnCountRef.current[sid] = totalTurnCount;
          }
          // 不再直接设置 messages/renderedTurns，避免和 useAuthedStartupEffects 中的
          // syncSessionMessages -> applyTurnWindow 竞争，导致 listRevealReady 无法正确触发。
          // 启动时让 syncSessionMessages 统一走 applyTurnWindow 来设置 UI state。
        }
        setStartupSessionHydrating(Boolean(prefs.token && prefs.repoPath && prefs.sessionId && !cachedChat));
        setModel(prefs.model || '');
      } catch (e) {
        if (!alive) return;
        setStatus(`启动恢复失败: ${String(e)}`);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    (() => {
      try {
        const map = loadPairCodeMap();
        if (!alive) return;
        pairCodeMapRef.current = map || {};
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
      stopStream();
    };
  }, [
    messagesRef,
    pairCodeMapRef,
    renderedTurnsRef,
    sessionRawMapRef,
    sessionIdRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setAutoAcceptPermissions,
    setComposerAgent,
    setLoaded,
    setMessages,
    setModel,
    setNotebookTheme,
    setPairCode,
    setPreferHttps,
    setProjects,
    setRenderedTurns,
    setRepoPath,
    setServerUrl,
    setServerUrlInput,
    setServerUrlTouched,
    setSessionId,
    setStartupSessionHydrating,
    setStatus,
    setToken,
    stopStream,
    stripUrlScheme,
    toProjectOptionsFromPaths
  ]);

  useEffect(() => {
    let alive = true;
    (() => {
      try {
        const cache = loadSessionCache();
        if (!alive) return;
        sessionCacheRef.current = cache;
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionCacheRef]);

  useEffect(() => {
    if (!loaded) return;
    try {
      savePrefs({
        ...DEFAULT_PREFS,
        serverUrl: serverUrlTouched ? serverUrl : '',
        serverUrlTouched,
        preferHttps,
        pairCode,
        repoPath,
        repoPaths: projects.map((p) => p.worktree),
        token,
        sessionId,
        model,
        agent: composerAgent,
        autoAcceptPermissions,
        notebookTheme
      } as Prefs);
    } catch {
      // ignore
    }
  }, [
    autoAcceptPermissions,
    composerAgent,
    loaded,
    model,
    notebookTheme,
    pairCode,
    preferHttps,
    projects,
    repoPath,
    serverUrl,
    serverUrlTouched,
    sessionId,
    token
  ]);

  useEffect(() => {
    const sid = toText(sessionId).trim();
    const repo = toText(repoPath).trim();
    if (!sid || !repo) return;
    if ((sessionRawMapRef.current[sid] || []).length > 0) return;
    let cancelled = false;
    void (async () => {
      const snapshot = (() => {
        try {
          return loadChatSnapshot(repo, sid) as ChatSnapshotLike | null;
        } catch {
          return null;
        }
      })();
      if (cancelled || sid !== sessionIdRef.current || repo !== toText(repoPath).trim() || !snapshot) return;
      const rawRows = Array.isArray(snapshot.rawRows) ? snapshot.rawRows : [];
      const visibleTurnCount = Math.max(0, Number(snapshot.visibleTurnCount || snapshot.renderedTurns.length || 0));
      const totalTurnCount = Math.max(visibleTurnCount, Number(snapshot.totalTurnCount || visibleTurnCount));
      if (rawRows.length > 0) {
        sessionRawMapRef.current[sid] = rawRows;
        sessionVisibleTurnCountRef.current[sid] = visibleTurnCount;
        sessionTotalTurnCountRef.current[sid] = totalTurnCount;
      }
      setMessages(snapshot.messages);
      setRenderedTurns(snapshot.renderedTurns);
      messagesRef.current = snapshot.messages;
      renderedTurnsRef.current = snapshot.renderedTurns;
      setSessionSwitchingTo((prev) => (prev === sid ? '' : prev));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    messagesRef,
    renderedTurnsRef,
    repoPath,
    sessionId,
    sessionIdRef,
    sessionRawMapRef,
    sessionTotalTurnCountRef,
    sessionVisibleTurnCountRef,
    setMessages,
    setRenderedTurns,
    setSessionSwitchingTo
  ]);
}

import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  getClientRepositories,
  getCurrentProject,
  getInstalledOpencodeSkills,
  getOpencodeConfig,
  getOpencodeMcpStatus,
  getProjects,
  getSessions
} from '../../api/controlApi';
import { toText } from '../../lib/text';
import { saveSessionCache } from '../../storage/sessionCache';

type SessionItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

type ProjectOption = {
  id: string;
  worktree: string;
  name: string;
};

type ModelOption = {
  id: string;
  label: string;
  provider: string;
};

export function useWorkspaceCatalogController(params: {
  authed: boolean;
  repoPath: string;
  serverUrl: string;
  token: string;
  sessionsRef: MutableRefObject<SessionItem[]>;
  projectsRef: MutableRefObject<ProjectOption[]>;
  sessionCacheRef: MutableRefObject<Record<string, SessionItem[]>>;
  modelOptionsRef: MutableRefObject<ModelOption[]>;
  setSessions: Dispatch<SetStateAction<SessionItem[]>>;
  setProjects: Dispatch<SetStateAction<ProjectOption[]>>;
  setRepoPath: Dispatch<SetStateAction<string>>;
  setModelOptions: Dispatch<SetStateAction<ModelOption[]>>;
  setModel: Dispatch<SetStateAction<string>>;
  setInstalledSkills: Dispatch<SetStateAction<any[]>>;
  setInstalledMcpServers: Dispatch<SetStateAction<Array<{ name: string; status: any }>>>;
  setExtensionsLoading: Dispatch<SetStateAction<boolean>>;
  setStatus: (value: string | ((prev: string) => string)) => void;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
  triggerLeftPulse: () => void;
  triggerRightPulse: () => void;
  stableSortSessionItems: (items: SessionItem[]) => SessionItem[];
  isPlaceholderSessionTitle: (value: string) => boolean;
  extractModelOptionsFromConfig: (raw: any) => ModelOption[];
  normalizeMcpStatusMap: (raw: any) => Record<string, any>;
  sanitizeProjectOptions: (items: ProjectOption[]) => ProjectOption[];
  projectNameFromPath: (path: string) => string;
}) {
  const {
    authed,
    extractModelOptionsFromConfig,
    isPlaceholderSessionTitle,
    modelOptionsRef,
    normalizeMcpStatusMap,
    projectNameFromPath,
    projectsRef,
    pushConnLog,
    repoPath,
    sanitizeProjectOptions,
    serverUrl,
    sessionCacheRef,
    sessionsRef,
    setExtensionsLoading,
    setInstalledMcpServers,
    setInstalledSkills,
    setModel,
    setModelOptions,
    setProjects,
    setRepoPath,
    setSessions,
    setStatus,
    stableSortSessionItems,
    token,
    triggerLeftPulse,
    triggerRightPulse
  } = params;

  return useMemo(() => {
    const setSessionsWithCacheMerge = (repo: string, next: SessionItem[], prev: SessionItem[]): SessionItem[] => {
      const prevTitleMap = new Map(prev.map((x) => [x.id, x.title]));
      const previewMap = new Map(prev.map((x) => [x.id, x.preview]));
      const merged = stableSortSessionItems(
        next.map((s) => ({
          id: s.id,
          title:
            isPlaceholderSessionTitle(s.title) && !isPlaceholderSessionTitle(toText(prevTitleMap.get(s.id)))
              ? toText(prevTitleMap.get(s.id))
              : s.title,
          preview: previewMap.get(s.id) || '',
          updatedAt: s.updatedAt,
          createdAt: s.createdAt
        }))
      );
      setSessions(merged);
      return merged;
    };

    const refreshInstalledExtensions = async () => {
      const repo = toText(repoPath).trim();
      if (!authed || !repo || !serverUrl || !token) {
        console.log('[extensions] skip: no auth', { authed, repo: !!repo, serverUrl: !!serverUrl, token: !!token });
        return;
      }
      setExtensionsLoading(true);
      try {
        console.log('[extensions] fetching...');
        const [skills, mcp, cfg] = await Promise.all([
          getInstalledOpencodeSkills({ baseUrl: serverUrl, token, repoPath: repo }).catch((err: unknown) => {
            console.log('[extensions] skills error:', err);
            return [];
          }),
          getOpencodeMcpStatus({ baseUrl: serverUrl, token, repoPath: repo }).catch((err: unknown) => {
            console.log('[extensions] mcp error:', err);
            return {};
          }),
          getOpencodeConfig({ baseUrl: serverUrl, token, repoPath: repo }).catch((err: unknown) => {
            console.log('[extensions] config error:', err);
            return {};
          })
        ]);
        const statusMap = {
          ...normalizeMcpStatusMap(cfg),
          ...normalizeMcpStatusMap(mcp)
        };
        setInstalledSkills(Array.isArray(skills) ? skills : []);
        setInstalledMcpServers(Object.entries(statusMap).map(([name, status]) => ({ name, status })));
      } finally {
        setExtensionsLoading(false);
      }
    };

    const refreshSessionsFromServer = async (targetRepoPath?: string) => {
      const repo = toText(targetRepoPath || repoPath).trim();
      if (!authed || !repo) return [] as SessionItem[];
      const cached = sessionCacheRef.current[repo];
      if (cached && cached.length > 0) {
        const normalizedCached = stableSortSessionItems(cached);
        const prevIds = new Set(sessionsRef.current.map((x) => x.id));
        const hasNew = normalizedCached.some((x) => !prevIds.has(x.id));
        sessionsRef.current = normalizedCached;
        setSessions(normalizedCached);
        if (hasNew) triggerLeftPulse();
      }
      try {
        pushConnLog(`GET sessions repo=${repo}`);
        const rows = await getSessions({
          baseUrl: serverUrl,
          token,
          repoPath: repo,
          limit: 200
        });
        pushConnLog(`GET sessions ok count=${rows.length}`);
        const nextSessions = stableSortSessionItems(
          rows.map((s) => {
            const createdAt = Number(s.createdAt || 0) || 0;
            const updatedAt = Number(s.updatedAt || 0) || createdAt;
            return {
              id: s.id,
              title: s.title || '新会话',
              preview: '',
              updatedAt,
              createdAt
            };
          })
        );
        const merged = setSessionsWithCacheMerge(repo, nextSessions, sessionsRef.current);
        sessionsRef.current = merged;
        sessionCacheRef.current = { ...sessionCacheRef.current, [repo]: merged };
        try {
          saveSessionCache(sessionCacheRef.current);
        } catch {
          // ignore
        }
        return merged;
      } catch (e) {
        pushConnLog(`GET sessions error ${String(e)}`, 'error');
        setStatus((prev) => (prev.includes('sessions failed') ? prev : `会话同步失败: ${String(e)}`));
        return sessionsRef.current;
      }
    };

    const refreshModelCatalog = async (targetRepoPath?: string) => {
      const repo = toText(targetRepoPath || repoPath).trim();
      if (!authed || !repo || !serverUrl) return;
      try {
        pushConnLog(`GET config repo=${repo}`);
        const cfg = await getOpencodeConfig({ baseUrl: serverUrl, token, repoPath: repo });
        const options = extractModelOptionsFromConfig(cfg);
        const prevIds = new Set(modelOptionsRef.current.map((x) => x.id));
        const hasNew = options.some((x) => !prevIds.has(x.id));
        setModelOptions(options);
        const configured = String(cfg?.model || '').trim();
        const mobileActive = String(cfg?.giteamMobileModelState?.activeModel || '').trim();
        const preferred = mobileActive && mobileActive.includes('/') ? mobileActive : configured;
        if (preferred && preferred.includes('/')) {
          setModel((prev) => {
            const p = prev.trim();
            if (!p || !p.includes('/')) return preferred;
            return p;
          });
        }
        pushConnLog(`GET config ok models=${options.length}`);
        if (hasNew) triggerRightPulse();
      } catch (e) {
        pushConnLog(`GET config warn ${String(e)}`, 'info');
      }
    };

    const refreshProjectsCatalog = async (opts?: { baseUrl?: string; token?: string; preferredRepoPath?: string }) => {
      const base = toText(opts?.baseUrl || serverUrl).trim();
      const tk = toText(opts?.token || token).trim();
      if (!base || !tk) return;
      try {
        pushConnLog('GET repository list');
        const rows = await getClientRepositories({ baseUrl: base, token: tk });
        let nextProjects = sanitizeProjectOptions(
          rows.map((x) => ({
            id: x.id || x.path,
            worktree: x.path,
            name: toText(x.name) || projectNameFromPath(x.path)
          }))
        );
        if (nextProjects.length === 0) {
          pushConnLog('GET repository list empty, fallback to opencode project APIs');
          const [current, all] = await Promise.all([
            getCurrentProject({ baseUrl: base, token: tk }).catch(() => null),
            getProjects({ baseUrl: base, token: tk }).catch(() => [])
          ]);
          const merged = new Map<string, ProjectOption>();
          if (current?.worktree) {
            merged.set(current.worktree, {
              id: current.id || current.worktree,
              worktree: current.worktree,
              name: projectNameFromPath(current.worktree)
            });
          }
          for (const p of all) {
            if (!p.worktree) continue;
            merged.set(p.worktree, {
              id: p.id || p.worktree,
              worktree: p.worktree,
              name: projectNameFromPath(p.worktree)
            });
          }
          nextProjects = sanitizeProjectOptions([...merged.values()]);
        }
        const prevIds = new Set(projectsRef.current.map((x) => x.id));
        const hasNew = nextProjects.some((x) => !prevIds.has(x.id));
        setProjects(nextProjects);
        const currentRepo = toText(repoPath).trim();
        let nextRepo = toText(opts?.preferredRepoPath).trim();
        if (nextRepo && !nextProjects.some((p) => p.worktree === nextRepo)) nextRepo = '';
        if (!nextRepo && currentRepo && nextProjects.some((p) => p.worktree === currentRepo)) nextRepo = currentRepo;
        if (!nextRepo && !currentRepo && nextProjects.length > 0) nextRepo = nextProjects[0].worktree;
        if (nextRepo && nextRepo !== currentRepo) setRepoPath(nextRepo);
        pushConnLog(`GET repository list ok count=${nextProjects.length}`);
        if (nextProjects.length === 0) setStatus('未获取到可用工作空间，请检查桌面端仓库列表');
        if (hasNew) triggerLeftPulse();
      } catch (e) {
        pushConnLog(`GET repository list error ${String(e)}`, 'error');
        try {
          pushConnLog('GET repository list fallback(after error) to opencode project APIs');
          const [current, all] = await Promise.all([
            getCurrentProject({ baseUrl: base, token: tk }).catch(() => null),
            getProjects({ baseUrl: base, token: tk }).catch(() => [])
          ]);
          const merged = new Map<string, ProjectOption>();
          if (current?.worktree) {
            merged.set(current.worktree, {
              id: current.id || current.worktree,
              worktree: current.worktree,
              name: projectNameFromPath(current.worktree)
            });
          }
          for (const p of all) {
            if (!p.worktree) continue;
            merged.set(p.worktree, {
              id: p.id || p.worktree,
              worktree: p.worktree,
              name: projectNameFromPath(p.worktree)
            });
          }
          const fallbackProjects = sanitizeProjectOptions([...merged.values()]);
          if (fallbackProjects.length > 0) {
            setProjects(fallbackProjects);
            if (!toText(repoPath).trim()) setRepoPath(fallbackProjects[0].worktree);
            pushConnLog(`fallback project APIs ok count=${fallbackProjects.length}`);
          }
        } catch (fallbackErr) {
          pushConnLog(`fallback project APIs error ${String(fallbackErr)}`, 'error');
        }
      }
    };

    return {
      refreshInstalledExtensions,
      refreshSessionsFromServer,
      refreshModelCatalog,
      refreshProjectsCatalog
    };
  }, [
    authed,
    extractModelOptionsFromConfig,
    isPlaceholderSessionTitle,
    modelOptionsRef,
    normalizeMcpStatusMap,
    projectNameFromPath,
    projectsRef,
    pushConnLog,
    repoPath,
    sanitizeProjectOptions,
    serverUrl,
    sessionCacheRef,
    sessionsRef,
    setExtensionsLoading,
    setInstalledMcpServers,
    setInstalledSkills,
    setModel,
    setModelOptions,
    setProjects,
    setRepoPath,
    setSessions,
    setStatus,
    stableSortSessionItems,
    token,
    triggerLeftPulse,
    triggerRightPulse
  ]);
}

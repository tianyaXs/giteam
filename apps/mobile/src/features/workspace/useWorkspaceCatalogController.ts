import { useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { getClientRepositories } from '../../api/controlApi';
import { createMobileAgentClient } from '../../api/agent/client';
import { normalizeWorkspacePath } from '../../lib/path';
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
  setExtensionsLoading: Dispatch<SetStateAction<boolean>>;
  setStatus: (value: string | ((prev: string) => string)) => void;
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
  triggerLeftPulse: () => void;
  triggerRightPulse: () => void;
  stableSortSessionItems: (items: SessionItem[]) => SessionItem[];
  isPlaceholderSessionTitle: (value: string) => boolean;
  sanitizeProjectOptions: (items: ProjectOption[]) => ProjectOption[];
  projectNameFromPath: (path: string) => string;
}) {
  const {
    authed,
    isPlaceholderSessionTitle,
    modelOptionsRef,
    projectNameFromPath,
    projectsRef,
    pushConnLog,
    repoPath,
    sanitizeProjectOptions,
    serverUrl,
    sessionCacheRef,
    sessionsRef,
    setExtensionsLoading,
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
    const agentClient = () => createMobileAgentClient({ baseUrl: serverUrl, token });

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
      if (!authed || !repo || !serverUrl || !token) return;
      setExtensionsLoading(true);
      try {
        // pi_agent 控制面暂无 skills 列表路由；MCP 已从产品中移除。
        setInstalledSkills([]);
      } finally {
        setExtensionsLoading(false);
      }
    };

    const refreshSessionsFromServer = async (targetRepoPath?: string) => {
      const repo = normalizeWorkspacePath(targetRepoPath || repoPath);
      if (!authed || !repo) return [] as SessionItem[];
      const cached = sessionCacheRef.current[repo] || sessionCacheRef.current[toText(targetRepoPath || repoPath).trim()];
      if (cached && cached.length > 0 && normalizeWorkspacePath(repoPath) === repo) {
        const normalizedCached = stableSortSessionItems(cached);
        const prevIds = new Set(sessionsRef.current.map((x) => x.id));
        const hasNew = normalizedCached.some((x) => !prevIds.has(x.id));
        sessionsRef.current = normalizedCached;
        setSessions(normalizedCached);
        if (hasNew) triggerLeftPulse();
      }
      try {
        pushConnLog(`GET agent.sessions repo=${repo}`);
        const rows = await agentClient().listSessions();
        // 一次全量 list，按 repoPath 分桶写入 cache（对齐桌面侧栏多项目展开）。
        const bucket: Record<string, SessionItem[]> = {};
        for (const s of rows) {
          const key = normalizeWorkspacePath(s.repoPath);
          if (!key) continue;
          const updatedAt = Number(s.updatedAtMs || 0) || 0;
          (bucket[key] ||= []).push({
            id: s.sessionId,
            title: toText(s.title) || '新会话',
            preview: '',
            updatedAt,
            createdAt: updatedAt
          });
        }
        const nextCache: Record<string, SessionItem[]> = { ...sessionCacheRef.current };
        for (const [key, items] of Object.entries(bucket)) {
          nextCache[key] = stableSortSessionItems(items);
        }
        // 当前请求的 repo 即使为空也写空数组，避免残留旧缓存误导「无会话」。
        if (!nextCache[repo]) nextCache[repo] = [];
        sessionCacheRef.current = nextCache;
        try {
          saveSessionCache(sessionCacheRef.current);
        } catch {
          // ignore
        }
        const nextSessions = nextCache[repo] || [];
        pushConnLog(`GET agent.sessions ok count=${nextSessions.length} repos=${Object.keys(bucket).length}`);
        const prevForMerge =
          normalizeWorkspacePath(repoPath) === repo ? sessionsRef.current : sessionCacheRef.current[repo] || [];
        const merged = setSessionsWithCacheMerge(repo, nextSessions, prevForMerge);
        sessionsRef.current = merged;
        sessionCacheRef.current = { ...sessionCacheRef.current, [repo]: merged };
        try {
          saveSessionCache(sessionCacheRef.current);
        } catch {
          // ignore
        }
        return merged;
      } catch (e) {
        pushConnLog(`GET agent.sessions error ${String(e)}`, 'error');
        setStatus((prev) => (prev.includes('sessions failed') ? prev : `会话同步失败: ${String(e)}`));
        return sessionsRef.current;
      }
    };

    const applyModelOptions = (options: ModelOption[], source: string) => {
      const prevIds = new Set(modelOptionsRef.current.map((x) => x.id));
      const hasNew = options.some((x) => !prevIds.has(x.id));
      setModelOptions(options);
      setModel((prev) => {
        const current = prev.trim();
        if (current && options.some((x) => x.id === current)) return prev;
        return options[0]?.id || prev;
      });
      pushConnLog(`${source} ok models=${options.length}`);
      if (hasNew) triggerRightPulse();
    };

    const refreshModelCatalogFromProviders = async (): Promise<ModelOption[]> => {
      pushConnLog('GET agent.providers');
      const providers = await agentClient().listProviders();
      const options: ModelOption[] = [];
      for (const provider of providers) {
        const models = Array.isArray(provider.models) ? provider.models : [];
        for (const model of models) {
          if (!model.hasCredential) continue;
          const id = `${provider.provider}/${model.modelId}`;
          options.push({
            id,
            label: toText(model.name) || model.modelId,
            provider: provider.provider
          });
        }
      }
      return options;
    };

    const toModelOption = (ref: string, labelById: Map<string, string>): ModelOption | null => {
      const id = toText(ref).trim();
      if (!id.includes('/')) return null;
      const slash = id.indexOf('/');
      const provider = id.slice(0, slash);
      const modelId = id.slice(slash + 1);
      return {
        id,
        label: labelById.get(id) || modelId,
        provider
      };
    };

    const refreshModelCatalog = async (targetRepoPath?: string) => {
      const repo = toText(targetRepoPath || repoPath).trim();
      if (!authed || !repo || !serverUrl) return;
      // Composer 只展示「开关已开启」的模型，绝不回退成 listProviders 全量。
      // 显示名仍可从 providers / modelLabels 取。
      let providerOptions: ModelOption[] = [];
      try {
        providerOptions = await refreshModelCatalogFromProviders();
      } catch (e) {
        pushConnLog(`GET agent.providers warn ${String(e)}`, 'info');
      }
      const labelById = new Map<string, string>();
      for (const opt of providerOptions) labelById.set(opt.id, opt.label);
      const connectedIds = new Set(providerOptions.map((opt) => opt.id));

      try {
        const state = await agentClient().getMobileModelState();
        if (!state) {
          pushConnLog('mobile-model-state missing; composer models empty', 'info');
          applyModelOptions([], 'GET mobile-model-state');
          return;
        }

        const labels =
          state.modelLabels && typeof state.modelLabels === 'object' ? state.modelLabels : {};
        for (const [ref, label] of Object.entries(labels as Record<string, string>)) {
          const name = toText(label).trim();
          if (name) labelById.set(toText(ref), name);
        }

        const hiddenSet = new Set(
          (Array.isArray(state.hiddenModels) ? state.hiddenModels : []).map((x) => toText(x).trim()).filter(Boolean)
        );
        const enabledList = Array.isArray(state.enabledModels)
          ? state.enabledModels.map((x) => toText(x).trim()).filter((ref) => ref.includes('/'))
          : null;
        const availableList = (Array.isArray(state.availableModels) ? state.availableModels : [])
          .map((x) => toText(x).trim())
          .filter((ref) => ref.includes('/'));

        let refs: string[] = [];
        if (enabledList) {
          const enabledSet = new Set(enabledList);
          // 桌面推送的 availableModels ∩ 本地开关；并并入刚打开、桌面尚未回推的项
          if (availableList.length > 0) {
            refs = availableList.filter((ref) => enabledSet.has(ref) && !hiddenSet.has(ref));
          }
          for (const ref of enabledList) {
            if (hiddenSet.has(ref) || refs.includes(ref)) continue;
            // 已连接才进选择器；桌面尚未回推 available 时靠 providers 校验
            if (connectedIds.size === 0 || connectedIds.has(ref)) refs.push(ref);
          }
        } else {
          // 旧桌面未写 enabledModels：仅信 availableModels，仍不回退全量
          refs = availableList.filter((ref) => !hiddenSet.has(ref));
        }

        const options = refs
          .map((ref) => toModelOption(ref, labelById))
          .filter((opt): opt is ModelOption => !!opt);
        applyModelOptions(options, 'GET mobile-model-state');
      } catch (e) {
        pushConnLog(`GET mobile-model-state warn ${String(e)}; composer models empty`, 'info');
        applyModelOptions([], 'GET mobile-model-state');
      }
    };

    const refreshProjectsCatalog = async (opts?: { baseUrl?: string; token?: string; preferredRepoPath?: string }) => {
      const base = toText(opts?.baseUrl || serverUrl).trim();
      const tk = toText(opts?.token || token).trim();
      if (!base || !tk) return;
      try {
        pushConnLog('GET repository list');
        const rows = await getClientRepositories({ baseUrl: base, token: tk });
        const nextProjects = sanitizeProjectOptions(
          rows.map((x) => ({
            id: x.id || x.path,
            worktree: x.path,
            name: toText(x.name) || projectNameFromPath(x.path)
          }))
        );
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
    isPlaceholderSessionTitle,
    modelOptionsRef,
    projectNameFromPath,
    projectsRef,
    pushConnLog,
    repoPath,
    sanitizeProjectOptions,
    serverUrl,
    sessionCacheRef,
    sessionsRef,
    setExtensionsLoading,
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

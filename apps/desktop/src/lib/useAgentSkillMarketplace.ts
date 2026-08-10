import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAgentSkillCatalogCacheKey,
  mergeMarketplaceCatalogRows,
  AGENT_SKILL_DISPLAY_BATCH_SIZE,
  type AgentSkillAudit,
  type AgentSkillCatalogCacheEntry,
  type AgentSkillDetail
} from "./agentSkillData";
import {
  buildSkillsmpSearchEndpoint,
  dedupeMarketplaceResults,
  fetchSkillsmpAiViaBackend,
  fetchSkillsmpJson,
  fetchSkillsmpSearchViaBackend,
  getSkillsMarketplaceSeedQuery,
  isTrustedSkillSource,
  AGENT_RECOMMENDED_SKILLS,
  parseSkillInstallCount,
  skillsmpSkillToResult,
  type AgentSkillSearchResult
} from "./agentSkillMarketplace";
import { invoke, IS_TAURI } from "./platform";

export type AgentSkillSearchStrategy = "keyword" | "ai";
export type AgentSkillCatalogView = "all-time" | "trending" | "hot" | "official";
export type AgentSkillSearchMeta = {
  count: number;
  searchType: string;
  durationMs: number;
};

type UseAgentSkillMarketplaceInput = {
  repoPath: string;
  skillsVisible: boolean;
  skillsLoadedOnce: boolean;
  skillsLoading: boolean;
  skillsmpApiKey: string;
  ensureRepoSelected: () => boolean;
  appendDebugLog: (text: string) => void;
  setSkillsError: (value: string) => void;
};

type FetchSkillsmpSearchInput = {
  query: string;
  page?: number;
  limit?: number;
  sortBy?: "stars" | "recent";
  category?: string;
  occupation?: string;
};

function normalizeArrayRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function scheduleAfterInteraction(task: () => void, delay = 240): number {
  return window.setTimeout(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(task));
  }, delay);
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function localBuiltinSkillSearchTerms(row: AgentSkillSearchResult): string[] {
  if (String(row.installSpec || "") === "giteam-builtin:giteam-remote-repo") {
    return ["remote repo", "remote repository", "远程仓库", "远程代码仓库", "远程 repo", "mcp"];
  }
  return [];
}

export function useAgentSkillMarketplace(input: UseAgentSkillMarketplaceInput) {
  const {
    repoPath,
    skillsVisible,
    skillsLoadedOnce,
    skillsLoading,
    skillsmpApiKey,
    ensureRepoSelected,
    appendDebugLog,
    setSkillsError
  } = input;

  const ensureRepoSelectedRef = useRef(ensureRepoSelected);
  const appendDebugLogRef = useRef(appendDebugLog);
  const repoPathRef = useRef(repoPath);
  ensureRepoSelectedRef.current = ensureRepoSelected;
  appendDebugLogRef.current = appendDebugLog;
  repoPathRef.current = repoPath;

  const [agentSkillSearchQuery, setAgentSkillSearchQuery] = useState("");
  const [agentSkillSearchStrategy, setAgentSkillSearchStrategy] = useState<AgentSkillSearchStrategy>("keyword");
  const [agentSkillSearchResults, setAgentSkillSearchResults] = useState<AgentSkillSearchResult[]>([]);
  const [agentSkillSearchLoading, setAgentSkillSearchLoading] = useState(false);
  const [agentSkillSearchCache, setAgentSkillSearchCache] = useState<Record<string, AgentSkillSearchResult[]>>({});
  const [agentSkillDisplayLimit, setAgentSkillDisplayLimit] = useState(AGENT_SKILL_DISPLAY_BATCH_SIZE);
  const [agentSkillRevealLoading, setAgentSkillRevealLoading] = useState(false);
  const [agentSkillCatalogView, setAgentSkillCatalogView] = useState<AgentSkillCatalogView>("all-time");
  const [agentSkillCatalogRows, setAgentSkillCatalogRows] = useState<AgentSkillSearchResult[]>([]);
  const [agentSkillCatalogLoading, setAgentSkillCatalogLoading] = useState(false);
  const [agentSkillCatalogPage, setAgentSkillCatalogPage] = useState(0);
  const [agentSkillCatalogTotal, setAgentSkillCatalogTotal] = useState(0);
  const [agentSkillCatalogHasMore, setAgentSkillCatalogHasMore] = useState(false);
  const [agentSkillCatalogCache, setAgentSkillCatalogCache] = useState<Record<string, AgentSkillCatalogCacheEntry>>({});
  const [agentSkillCatalogAttempted, setAgentSkillCatalogAttempted] = useState<Record<string, boolean>>({});
  const [agentSkillSearchMeta, setAgentSkillSearchMeta] = useState<AgentSkillSearchMeta | null>(null);
  const [agentSkillAllowBackendCatalogFetch, setAgentSkillAllowBackendCatalogFetch] = useState(false);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<AgentSkillSearchResult | null>(null);
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<AgentSkillDetail | null>(null);
  const [selectedSkillAudits, setSelectedSkillAudits] = useState<AgentSkillAudit[]>([]);
  const [selectedSkillLoading, setSelectedSkillLoading] = useState(false);
  const [showSkillInstallMenu, setShowSkillInstallMenu] = useState(false);

  const agentSkillCatalogRequestRef = useRef(0);
  const agentSkillCatalogInflightRef = useRef<Record<string, boolean>>({});
  const agentSkillMarketListRef = useRef<HTMLDivElement | null>(null);
  const agentSkillUserNearBottomRef = useRef(false);

  const agentFallbackMarketplaceRows = useMemo(() => {
    if (!skillsVisible) return [];
    return AGENT_RECOMMENDED_SKILLS.map((skill, index): AgentSkillSearchResult => ({
      spec: skill.spec,
      package: skill.source,
      skill: skill.title,
      installs: skill.installs,
      url: "",
      id: skill.spec.includes("@") ? `${skill.source}/${skill.spec.split("@").pop()}` : skill.spec,
      source: skill.source,
      sourceType: "recommended",
      installSpec: skill.installSpec || null,
      change: skill.installSpec ? undefined : index === 0 ? 24 : undefined
    }));
  }, [skillsVisible]);

  const agentBuiltinMarketplaceRows = useMemo(
    () => agentFallbackMarketplaceRows.filter((row) => String(row.installSpec || "").startsWith("giteam-builtin:")),
    [agentFallbackMarketplaceRows]
  );

  const agentBuiltinSearchRows = useMemo(() => {
    const query = agentSkillSearchQuery.trim().toLowerCase();
    if (query.length < 2) return agentBuiltinMarketplaceRows;
    return agentBuiltinMarketplaceRows.filter((row) => [
      row.skill,
      row.package,
      row.spec,
      row.installSpec,
      ...localBuiltinSkillSearchTerms(row)
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [agentBuiltinMarketplaceRows, agentSkillSearchQuery]);

  const agentMarketplaceRows = useMemo(() => {
    if (!skillsVisible) return [];
    if (agentSkillSearchQuery.trim().length >= 2 || agentSkillSearchResults.length > 0) {
      return dedupeMarketplaceResults([...agentBuiltinSearchRows, ...agentSkillSearchResults]);
    }
    if (agentSkillCatalogRows.length > 0) {
      // 「全部」保留本地推荐榜，再拼市场结果，避免远端结果偏少时列表只剩几条。
      if (agentSkillCatalogView === "all-time") {
        return dedupeMarketplaceResults([...agentFallbackMarketplaceRows, ...agentSkillCatalogRows]);
      }
      return dedupeMarketplaceResults([...agentBuiltinMarketplaceRows, ...agentSkillCatalogRows]);
    }
    return agentFallbackMarketplaceRows;
  }, [
    skillsVisible,
    agentBuiltinMarketplaceRows,
    agentBuiltinSearchRows,
    agentFallbackMarketplaceRows,
    agentSkillCatalogRows,
    agentSkillCatalogView,
    agentSkillSearchQuery,
    agentSkillSearchResults
  ]);

  const visibleAgentMarketplaceRows = useMemo(
    () => agentMarketplaceRows.slice(0, agentSkillDisplayLimit),
    [agentMarketplaceRows, agentSkillDisplayLimit]
  );

  const agentCanRevealMoreSkills = visibleAgentMarketplaceRows.length < agentMarketplaceRows.length;
  const agentCanFetchMoreCatalogSkills = agentSkillSearchResults.length === 0 && agentSkillCatalogRows.length > 0 && agentSkillCatalogHasMore;
  const agentSkillsInitialLoading = agentSkillCatalogLoading && agentSkillCatalogRows.length === 0 && agentSkillSearchResults.length === 0;
  const agentSkillsSearching = agentSkillSearchLoading;
  const agentSkillsPaging = (agentSkillCatalogLoading && agentSkillCatalogRows.length > 0 && agentSkillSearchResults.length === 0) || agentSkillRevealLoading;
  const agentCanAutoLoadMore = agentCanRevealMoreSkills
    || agentCanFetchMoreCatalogSkills
    || (!agentSkillAllowBackendCatalogFetch
      && agentMarketplaceRows.length < AGENT_SKILL_DISPLAY_BATCH_SIZE
      && agentSkillCatalogRows.length === 0
      && agentSkillSearchResults.length === 0);

  async function fetchSkillsmpSearchWithFallback(
    searchInput: FetchSkillsmpSearchInput,
    options: { allowBackendFallback?: boolean } = {}
  ) {
    const requestRepoPath = repoPathRef.current.trim();
    if (!IS_TAURI) {
      return await fetchSkillsmpSearchViaBackend({
        repoPath: requestRepoPath,
        query: searchInput.query,
        page: searchInput.page,
        limit: searchInput.limit,
        sortBy: searchInput.sortBy,
        category: searchInput.category,
        occupation: searchInput.occupation,
        apiKey: skillsmpApiKey || undefined
      });
    }
    try {
      return await fetchSkillsmpJson(buildSkillsmpSearchEndpoint(searchInput), skillsmpApiKey);
    } catch (directError) {
      appendDebugLogRef.current(`skillsmp.direct.error ${String(directError)}`);
      if (options.allowBackendFallback === false) throw directError;
      return await fetchSkillsmpSearchViaBackend({
        repoPath: requestRepoPath,
        query: searchInput.query,
        page: searchInput.page,
        limit: searchInput.limit,
        sortBy: searchInput.sortBy,
        category: searchInput.category,
        occupation: searchInput.occupation,
        apiKey: skillsmpApiKey || undefined
      });
    }
  }

  async function fetchSkillsmpAiWithFallback(query: string) {
    const requestRepoPath = repoPathRef.current.trim();
    if (!IS_TAURI) {
      return await fetchSkillsmpAiViaBackend({ repoPath: requestRepoPath, query, apiKey: skillsmpApiKey || undefined });
    }
    try {
      return await fetchSkillsmpJson(`/api/v1/skills/ai-search?q=${encodeURIComponent(query)}`, skillsmpApiKey, 14000);
    } catch (directError) {
      appendDebugLogRef.current(`skillsmp.ai.direct.error ${String(directError)}`);
      return await fetchSkillsmpAiViaBackend({ repoPath: requestRepoPath, query, apiKey: skillsmpApiKey || undefined });
    }
  }

  async function searchAgentSkillRegistry(
    queryArg = agentSkillSearchQuery,
    strategyArg: AgentSkillSearchStrategy = "keyword"
  ) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    const query = queryArg.trim();
    if (query.length < 2) {
      setAgentSkillSearchResults([]);
      return;
    }
    const cacheKey = `${strategyArg}:all:${query.toLowerCase()}`;
    const cached = agentSkillSearchCache[cacheKey];
    if (cached) {
      setAgentSkillSearchResults(cached);
      setAgentSkillDisplayLimit(AGENT_SKILL_DISPLAY_BATCH_SIZE);
      setAgentSkillSearchMeta({ count: cached.length, searchType: `${strategyArg}-cache`, durationMs: 0 });
      return;
    }
    setAgentSkillSearchLoading(true);
    setSkillsError("");
    try {
      if (strategyArg === "ai") {
        if (!skillsmpApiKey.trim()) {
          setSkillsError("未配置 SKILLSMP_API_KEY，已自动切换到关键词搜索。可在 Settings 中配置后再用 AI 语义搜索。");
          setAgentSkillSearchStrategy("keyword");
          await searchAgentSkillRegistry(query, "keyword");
          return;
        }
        const raw = await fetchSkillsmpAiWithFallback(query);
        if (repoPathRef.current.trim() !== requestRepoPath) return;
        const rows = dedupeMarketplaceResults(normalizeArrayRows(raw?.data?.skills || raw?.data)
          .map(skillsmpSkillToResult)
          .filter(Boolean) as AgentSkillSearchResult[]);
        setAgentSkillSearchResults(rows);
        setAgentSkillDisplayLimit(AGENT_SKILL_DISPLAY_BATCH_SIZE);
        setAgentSkillSearchCache((prev) => ({ ...prev, [cacheKey]: rows }));
        setAgentSkillSearchMeta({ count: rows.length, searchType: "skillsmp-ai", durationMs: Number(raw?.meta?.responseTimeMs || 0) });
        return;
      }

      const raw = await fetchSkillsmpSearchWithFallback({
        query,
        page: 1,
        limit: 100,
        sortBy: "stars"
      });
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      const rows = dedupeMarketplaceResults(normalizeArrayRows(raw?.data?.skills)
        .map(skillsmpSkillToResult)
        .filter(Boolean) as AgentSkillSearchResult[]);
      const sorted = rows.sort((a, b) => {
        const trustedDelta = Number(isTrustedSkillSource(b.source || b.package)) - Number(isTrustedSkillSource(a.source || a.package));
        if (trustedDelta !== 0) return trustedDelta;
        return parseSkillInstallCount(b.installs) - parseSkillInstallCount(a.installs);
      });
      setAgentSkillSearchResults(sorted);
      setAgentSkillDisplayLimit(AGENT_SKILL_DISPLAY_BATCH_SIZE);
      setAgentSkillSearchCache((prev) => ({ ...prev, [cacheKey]: sorted }));
      setAgentSkillSearchMeta({ count: sorted.length, searchType: "skillsmp-keyword", durationMs: 0 });
    } catch (error) {
      setSkillsError("SkillsMP 搜索暂时不可用，已保留本地榜单。");
      setAgentSkillSearchResults([]);
      setAgentSkillSearchMeta(null);
      appendDebugLogRef.current(`skill.search.error ${String(error)}`);
    } finally {
      if (repoPathRef.current.trim() === requestRepoPath) {
        setAgentSkillSearchLoading(false);
      }
    }
  }

  async function fetchAgentSkillCatalog(
    viewArg = agentSkillCatalogView,
    pageArg = 0,
    options: { allowBackendFallback?: boolean; force?: boolean } = {}
  ) {
    const requestRepoPath = repoPathRef.current.trim();
    if (!requestRepoPath) return;
    const cacheKey = buildAgentSkillCatalogCacheKey(viewArg, "");
    const requestKey = `${requestRepoPath}:${cacheKey}:${pageArg}`;
    if (!options.force && agentSkillCatalogInflightRef.current[requestKey]) return;
    if (!options.force && agentSkillCatalogAttempted[cacheKey] && pageArg <= 0) return;
    agentSkillCatalogInflightRef.current[requestKey] = true;
    const requestId = ++agentSkillCatalogRequestRef.current;
    startTransition(() => {
      setAgentSkillCatalogAttempted((prev) => ({ ...prev, [cacheKey]: true }));
      setAgentSkillCatalogLoading(true);
      setSkillsError("");
    });
    await waitForPaint();
    try {
      const page = pageArg + 1;
      const sortBy = viewArg === "trending" || viewArg === "hot" ? "recent" : "stars";
      // 「全部」用更宽的种子词；原先固定 "agent" 会把结果挤进少数同仓库 skill，列表看起来只有几条。
      const viewQuery =
        viewArg === "official"
          ? "official"
          : viewArg === "hot"
            ? "popular"
            : viewArg === "trending"
              ? "trending"
              : "skills";
      const query = getSkillsMarketplaceSeedQuery(viewQuery);
      const json = await fetchSkillsmpSearchWithFallback(
        { query, page, limit: 100, sortBy },
        { allowBackendFallback: options.allowBackendFallback ?? true }
      );
      if (requestId !== agentSkillCatalogRequestRef.current || repoPathRef.current.trim() !== requestRepoPath) return;
      let rows = normalizeArrayRows(json?.data?.skills)
        .map(skillsmpSkillToResult)
        .filter(Boolean) as AgentSkillSearchResult[];
      const positiveStarRows = rows.filter((item) => parseSkillInstallCount(item.installs) > 0);
      if (positiveStarRows.length > 0) rows = positiveStarRows;
      rows = rows.slice().sort((a, b) => parseSkillInstallCount(b.installs) - parseSkillInstallCount(a.installs));
      const nextPage = Number(json?.data?.pagination?.page || page) - 1;
      const nextTotal = Number(json?.data?.pagination?.total || rows.length);
      const nextHasMore = Boolean(json?.data?.pagination?.hasNext);
      startTransition(() => {
        setAgentSkillCatalogRows((prev) => {
          const mergedRows = mergeMarketplaceCatalogRows(prev, rows, pageArg <= 0);
          setAgentSkillCatalogCache((cache) => ({
            ...cache,
            [cacheKey]: { rows: mergedRows, page: nextPage, total: nextTotal, hasMore: nextHasMore }
          }));
          return mergedRows;
        });
        setAgentSkillDisplayLimit((limit) => Math.max(limit, AGENT_SKILL_DISPLAY_BATCH_SIZE));
        setAgentSkillCatalogPage(nextPage);
        setAgentSkillCatalogTotal(nextTotal);
        setAgentSkillCatalogHasMore(nextHasMore);
      });
    } catch (error) {
      if (requestId !== agentSkillCatalogRequestRef.current || repoPathRef.current.trim() !== requestRepoPath) return;
      startTransition(() => {
        setSkillsError("");
        setAgentSkillCatalogRows([]);
        setAgentSkillCatalogHasMore(false);
      });
      appendDebugLogRef.current(`skill.catalog.error ${String(error)}`);
    } finally {
      delete agentSkillCatalogInflightRef.current[requestKey];
      if (requestId === agentSkillCatalogRequestRef.current && repoPathRef.current.trim() === requestRepoPath) {
        startTransition(() => setAgentSkillCatalogLoading(false));
      }
    }
  }

  async function loadInitialSkillsmpCatalog() {
    if (!repoPathRef.current.trim() || agentSkillCatalogLoading || agentSkillCatalogRows.length > 0) return;
    if (agentSkillCatalogAttempted[buildAgentSkillCatalogCacheKey(agentSkillCatalogView, "")]) return;
    await fetchAgentSkillCatalog(agentSkillCatalogView, 0);
  }

  function switchAgentSkillCatalogView(view: AgentSkillCatalogView) {
    if (agentSkillCatalogView === view && agentSkillSearchResults.length === 0) return;
    setAgentSkillSearchResults([]);
    setAgentSkillSearchMeta(null);
    setAgentSkillCatalogView(view);
    setAgentSkillDisplayLimit(AGENT_SKILL_DISPLAY_BATCH_SIZE);
    setSkillsError("");
    const cached = agentSkillCatalogCache[buildAgentSkillCatalogCacheKey(view, "")];
    if (cached) {
      setAgentSkillCatalogRows(cached.rows);
      setAgentSkillCatalogPage(cached.page);
      setAgentSkillCatalogTotal(cached.total);
      setAgentSkillCatalogHasMore(cached.hasMore);
      return;
    }
    window.requestAnimationFrame(() => void fetchAgentSkillCatalog(view, 0));
  }

  async function warmSkillsMarketplace() {
    if (!repoPathRef.current.trim()) return;
    if (
      agentSkillCatalogLoading
      || agentSkillCatalogRows.length > 0
      || agentSkillSearchResults.length > 0
      || agentSkillCatalogAttempted[buildAgentSkillCatalogCacheKey(agentSkillCatalogView, "")]
    ) {
      return;
    }
    await Promise.allSettled([loadInitialSkillsmpCatalog()]);
  }

  function revealMoreAgentSkills() {
    if (agentSkillRevealLoading) return;
    setAgentSkillRevealLoading(true);
    window.setTimeout(() => {
      setAgentSkillDisplayLimit((limit) => limit + AGENT_SKILL_DISPLAY_BATCH_SIZE);
      setAgentSkillRevealLoading(false);
    }, 360);
  }

  function handleAgentSkillMarketScroll() {
    const element = agentSkillMarketListRef.current;
    if (!element) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    agentSkillUserNearBottomRef.current = distanceToBottom <= 520;
    if (!agentSkillUserNearBottomRef.current) return;
    if (agentCanRevealMoreSkills && !agentSkillRevealLoading) {
      revealMoreAgentSkills();
      return;
    }
    if (
      !agentSkillAllowBackendCatalogFetch
      && agentMarketplaceRows.length < AGENT_SKILL_DISPLAY_BATCH_SIZE
      && agentSkillCatalogRows.length === 0
      && agentSkillSearchResults.length === 0
    ) {
      setAgentSkillAllowBackendCatalogFetch(true);
      void fetchAgentSkillCatalog(agentSkillCatalogView, 0, { allowBackendFallback: true, force: true });
      return;
    }
    if (agentCanFetchMoreCatalogSkills && !agentSkillCatalogLoading) {
      void fetchAgentSkillCatalog(agentSkillCatalogView, agentSkillCatalogPage + 1);
    }
  }

  async function selectMarketplaceSkill(skill: AgentSkillSearchResult) {
    setSelectedMarketplaceSkill(skill);
    setSelectedSkillDetail(null);
    setSelectedSkillAudits([]);
    setShowSkillInstallMenu(false);
  }

  async function loadSelectedMarketplaceSkillDetails(skill = selectedMarketplaceSkill) {
    if (!skill) return;
    const requestRepoPath = repoPathRef.current.trim();
    const id = (skill.id || "").trim();
    if (!id || !requestRepoPath) return;
    setSelectedSkillLoading(true);
    try {
      const [detailRaw, auditRaw] = await Promise.all([
        invoke<any>("fetch_agent_skill_detail_api", { repoPath: requestRepoPath, id }).catch(() => null),
        invoke<any>("fetch_agent_skill_audit_api", { repoPath: requestRepoPath, id }).catch(() => null)
      ]);
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      if (detailRaw && typeof detailRaw === "object") {
        setSelectedSkillDetail({
          id: String(detailRaw?.id || id),
          source: String(detailRaw?.source || skill.source || skill.package),
          slug: String(detailRaw?.slug || skill.skill),
          installs: Number(detailRaw?.installs || 0),
          hash: detailRaw?.hash == null ? null : String(detailRaw.hash),
          files: Array.isArray(detailRaw?.files)
            ? detailRaw.files
                .map((file: any) => ({
                  path: String(file?.path || ""),
                  contents: String(file?.contents || "")
                }))
                .filter((file: { path: string }) => file.path)
            : null
        });
      }
      setSelectedSkillAudits(
        Array.isArray(auditRaw?.audits)
          ? auditRaw.audits.map((audit: any) => ({
              provider: String(audit?.provider || "Audit"),
              slug: String(audit?.slug || ""),
              status: String(audit?.status || "unknown"),
              summary: String(audit?.summary || ""),
              auditedAt: String(audit?.auditedAt || ""),
              riskLevel: String(audit?.riskLevel || ""),
              categories: Array.isArray(audit?.categories)
                ? audit.categories.map((value: unknown) => String(value || "")).filter(Boolean)
                : []
            }))
          : []
      );
    } finally {
      if (repoPathRef.current.trim() === requestRepoPath) {
        setSelectedSkillLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!skillsVisible) return;
    if (agentSkillSearchResults.length > 0) return;
    if (agentSkillCatalogRows.length > 0) return;
    if (agentSkillCatalogAttempted[buildAgentSkillCatalogCacheKey(agentSkillCatalogView, "")]) return;
    const timer = scheduleAfterInteraction(() => void loadInitialSkillsmpCatalog(), 320);
    return () => window.clearTimeout(timer);
  }, [
    skillsVisible,
    agentSkillCatalogAttempted,
    agentSkillCatalogRows.length,
    agentSkillCatalogView,
    agentSkillSearchResults.length
  ]);

  useEffect(() => {
    if (!skillsVisible) return;
    if (!repoPath.trim()) return;
    if (
      skillsLoadedOnce
      && (
        agentSkillCatalogRows.length > 0
        || agentSkillCatalogAttempted[buildAgentSkillCatalogCacheKey(agentSkillCatalogView, "")]
      )
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void warmSkillsMarketplace();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    skillsVisible,
    repoPath,
    skillsLoadedOnce,
    skillsLoading,
    agentSkillCatalogAttempted,
    agentSkillCatalogLoading,
    agentSkillCatalogRows.length,
    agentSkillCatalogView,
    agentSkillSearchResults.length
  ]);

  useEffect(() => {
    if (!skillsVisible) return;
    if (agentMarketplaceRows.length === 0) return;
    setSelectedMarketplaceSkill((prev) => {
      if (prev && agentMarketplaceRows.some((row) => row.spec === prev.spec)) return prev;
      return agentMarketplaceRows[0];
    });
  }, [skillsVisible, agentMarketplaceRows]);

  useEffect(() => {
    if (!skillsVisible) return;
    const element = agentSkillMarketListRef.current;
    if (!element || agentSkillsInitialLoading || agentSkillsPaging) return;
    if (element.scrollHeight - element.clientHeight > 520) return;
    if (agentCanRevealMoreSkills) {
      revealMoreAgentSkills();
      return;
    }
  }, [
    skillsVisible,
    visibleAgentMarketplaceRows.length,
    agentCanFetchMoreCatalogSkills,
    agentCanRevealMoreSkills,
    agentSkillCatalogPage,
    agentSkillCatalogView,
    agentSkillsInitialLoading,
    agentSkillsPaging
  ]);

  useEffect(() => {
    if (!skillsVisible || !agentSkillUserNearBottomRef.current) return;
    if (agentSkillsInitialLoading || agentSkillsPaging) return;
    if (agentCanRevealMoreSkills) return;
    if (agentCanFetchMoreCatalogSkills && !agentSkillCatalogLoading) {
      void fetchAgentSkillCatalog(agentSkillCatalogView, agentSkillCatalogPage + 1);
    }
  }, [
    skillsVisible,
    visibleAgentMarketplaceRows.length,
    agentMarketplaceRows.length,
    agentCanFetchMoreCatalogSkills,
    agentCanRevealMoreSkills,
    agentSkillCatalogLoading,
    agentSkillCatalogPage,
    agentSkillCatalogView,
    agentSkillsInitialLoading,
    agentSkillsPaging
  ]);

  return {
    agentSkillMarketListRef,
    agentSkillSearchQuery,
    setAgentSkillSearchQuery,
    agentSkillSearchStrategy,
    setAgentSkillSearchStrategy,
    agentSkillSearchResults,
    agentSkillSearchLoading,
    agentSkillCatalogView,
    agentSkillCatalogRows,
    agentSkillCatalogPage,
    agentSkillCatalogTotal,
    agentSkillSearchMeta,
    agentSkillAllowBackendCatalogFetch,
    selectedMarketplaceSkill,
    selectedSkillDetail,
    selectedSkillAudits,
    selectedSkillLoading,
    showSkillInstallMenu,
    setShowSkillInstallMenu,
    agentMarketplaceRows,
    visibleAgentMarketplaceRows,
    agentCanRevealMoreSkills,
    agentCanFetchMoreCatalogSkills,
    agentSkillsInitialLoading,
    agentSkillsSearching,
    agentSkillsPaging,
    agentCanAutoLoadMore,
    warmSkillsMarketplace,
    searchAgentSkillRegistry,
    switchAgentSkillCatalogView,
    handleAgentSkillMarketScroll,
    selectMarketplaceSkill,
    loadSelectedMarketplaceSkillDetails
  };
}

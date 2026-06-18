import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  buildOpencodeSkillCatalogCacheKey,
  mergeMarketplaceCatalogRows,
  OPENCODE_SKILL_DISPLAY_BATCH_SIZE,
  type OpencodeSkillAudit,
  type OpencodeSkillCatalogCacheEntry,
  type OpencodeSkillDetail
} from "./opencodeSkillData";
import {
  buildSkillsmpSearchEndpoint,
  dedupeMarketplaceResults,
  fetchSkillsmpAiViaBackend,
  fetchSkillsmpJson,
  fetchSkillsmpSearchViaBackend,
  getSkillsMarketplaceSeedQuery,
  isTrustedSkillSource,
  OPENCODE_RECOMMENDED_SKILLS,
  parseSkillInstallCount,
  skillsmpSkillToResult,
  type OpencodeSkillSearchResult
} from "./opencodeSkillMarketplace";
import { invoke, IS_TAURI } from "./platform";

export type OpencodeSkillSearchStrategy = "keyword" | "ai";
export type OpencodeSkillCatalogView = "all-time" | "trending" | "hot" | "official";
export type OpencodeSkillSearchMeta = {
  count: number;
  searchType: string;
  durationMs: number;
};

type UseOpencodeSkillMarketplaceInput = {
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

export function useOpencodeSkillMarketplace(input: UseOpencodeSkillMarketplaceInput) {
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

  const [opencodeSkillSearchQuery, setOpencodeSkillSearchQuery] = useState("");
  const [opencodeSkillSearchStrategy, setOpencodeSkillSearchStrategy] = useState<OpencodeSkillSearchStrategy>("keyword");
  const [opencodeSkillSearchResults, setOpencodeSkillSearchResults] = useState<OpencodeSkillSearchResult[]>([]);
  const [opencodeSkillSearchLoading, setOpencodeSkillSearchLoading] = useState(false);
  const [opencodeSkillSearchCache, setOpencodeSkillSearchCache] = useState<Record<string, OpencodeSkillSearchResult[]>>({});
  const [opencodeSkillDisplayLimit, setOpencodeSkillDisplayLimit] = useState(OPENCODE_SKILL_DISPLAY_BATCH_SIZE);
  const [opencodeSkillRevealLoading, setOpencodeSkillRevealLoading] = useState(false);
  const [opencodeSkillCatalogView, setOpencodeSkillCatalogView] = useState<OpencodeSkillCatalogView>("all-time");
  const [opencodeSkillCatalogRows, setOpencodeSkillCatalogRows] = useState<OpencodeSkillSearchResult[]>([]);
  const [opencodeSkillCatalogLoading, setOpencodeSkillCatalogLoading] = useState(false);
  const [opencodeSkillCatalogPage, setOpencodeSkillCatalogPage] = useState(0);
  const [opencodeSkillCatalogTotal, setOpencodeSkillCatalogTotal] = useState(0);
  const [opencodeSkillCatalogHasMore, setOpencodeSkillCatalogHasMore] = useState(false);
  const [opencodeSkillCatalogCache, setOpencodeSkillCatalogCache] = useState<Record<string, OpencodeSkillCatalogCacheEntry>>({});
  const [opencodeSkillCatalogAttempted, setOpencodeSkillCatalogAttempted] = useState<Record<string, boolean>>({});
  const [opencodeSkillSearchMeta, setOpencodeSkillSearchMeta] = useState<OpencodeSkillSearchMeta | null>(null);
  const [opencodeSkillAllowBackendCatalogFetch, setOpencodeSkillAllowBackendCatalogFetch] = useState(false);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<OpencodeSkillSearchResult | null>(null);
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<OpencodeSkillDetail | null>(null);
  const [selectedSkillAudits, setSelectedSkillAudits] = useState<OpencodeSkillAudit[]>([]);
  const [selectedSkillLoading, setSelectedSkillLoading] = useState(false);
  const [showSkillInstallMenu, setShowSkillInstallMenu] = useState(false);

  const opencodeSkillCatalogRequestRef = useRef(0);
  const opencodeSkillCatalogInflightRef = useRef<Record<string, boolean>>({});
  const opencodeSkillMarketListRef = useRef<HTMLDivElement | null>(null);
  const opencodeSkillUserNearBottomRef = useRef(false);

  const opencodeFallbackMarketplaceRows = useMemo(() => {
    if (!skillsVisible) return [];
    return OPENCODE_RECOMMENDED_SKILLS.map((skill, index): OpencodeSkillSearchResult => ({
      spec: skill.spec,
      package: skill.source,
      skill: skill.title,
      installs: skill.installs,
      url: "",
      id: skill.spec.includes("@") ? `${skill.source}/${skill.spec.split("@").pop()}` : skill.spec,
      source: skill.source,
      sourceType: "recommended",
      change: index === 0 ? 24 : undefined
    }));
  }, [skillsVisible]);

  const opencodeMarketplaceRows = useMemo(() => {
    if (!skillsVisible) return [];
    if (opencodeSkillSearchResults.length > 0) return opencodeSkillSearchResults;
    if (opencodeSkillCatalogRows.length > 0) return opencodeSkillCatalogRows;
    return opencodeFallbackMarketplaceRows;
  }, [skillsVisible, opencodeFallbackMarketplaceRows, opencodeSkillCatalogRows, opencodeSkillSearchResults]);

  const visibleOpencodeMarketplaceRows = useMemo(
    () => opencodeMarketplaceRows.slice(0, opencodeSkillDisplayLimit),
    [opencodeMarketplaceRows, opencodeSkillDisplayLimit]
  );

  const opencodeCanRevealMoreSkills = visibleOpencodeMarketplaceRows.length < opencodeMarketplaceRows.length;
  const opencodeCanFetchMoreCatalogSkills = opencodeSkillSearchResults.length === 0 && opencodeSkillCatalogRows.length > 0 && opencodeSkillCatalogHasMore;
  const opencodeSkillsInitialLoading = opencodeSkillCatalogLoading && opencodeSkillCatalogRows.length === 0 && opencodeSkillSearchResults.length === 0;
  const opencodeSkillsSearching = opencodeSkillSearchLoading;
  const opencodeSkillsPaging = (opencodeSkillCatalogLoading && opencodeSkillCatalogRows.length > 0 && opencodeSkillSearchResults.length === 0) || opencodeSkillRevealLoading;
  const opencodeCanAutoLoadMore = opencodeCanRevealMoreSkills
    || opencodeCanFetchMoreCatalogSkills
    || (!opencodeSkillAllowBackendCatalogFetch
      && opencodeMarketplaceRows.length < OPENCODE_SKILL_DISPLAY_BATCH_SIZE
      && opencodeSkillCatalogRows.length === 0
      && opencodeSkillSearchResults.length === 0);

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

  async function searchOpencodeSkillRegistry(
    queryArg = opencodeSkillSearchQuery,
    strategyArg = opencodeSkillSearchStrategy
  ) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    const query = queryArg.trim();
    if (query.length < 2) {
      setOpencodeSkillSearchResults([]);
      return;
    }
    const cacheKey = `${strategyArg}:all:${query.toLowerCase()}`;
    const cached = opencodeSkillSearchCache[cacheKey];
    if (cached) {
      setOpencodeSkillSearchResults(cached);
      setOpencodeSkillDisplayLimit(OPENCODE_SKILL_DISPLAY_BATCH_SIZE);
      setOpencodeSkillSearchMeta({ count: cached.length, searchType: `${strategyArg}-cache`, durationMs: 0 });
      return;
    }
    setOpencodeSkillSearchLoading(true);
    setSkillsError("");
    try {
      if (strategyArg === "ai") {
        if (!skillsmpApiKey.trim()) {
          setSkillsError("未配置 SKILLSMP_API_KEY，已自动切换到关键词搜索。可在 Settings 中配置后再用 AI 语义搜索。");
          setOpencodeSkillSearchStrategy("keyword");
          await searchOpencodeSkillRegistry(query, "keyword");
          return;
        }
        const raw = await fetchSkillsmpAiWithFallback(query);
        if (repoPathRef.current.trim() !== requestRepoPath) return;
        const rows = dedupeMarketplaceResults(normalizeArrayRows(raw?.data?.skills || raw?.data)
          .map(skillsmpSkillToResult)
          .filter(Boolean) as OpencodeSkillSearchResult[]);
        setOpencodeSkillSearchResults(rows);
        setOpencodeSkillDisplayLimit(OPENCODE_SKILL_DISPLAY_BATCH_SIZE);
        setOpencodeSkillSearchCache((prev) => ({ ...prev, [cacheKey]: rows }));
        setOpencodeSkillSearchMeta({ count: rows.length, searchType: "skillsmp-ai", durationMs: Number(raw?.meta?.responseTimeMs || 0) });
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
        .filter(Boolean) as OpencodeSkillSearchResult[]);
      const sorted = rows.sort((a, b) => {
        const trustedDelta = Number(isTrustedSkillSource(b.source || b.package)) - Number(isTrustedSkillSource(a.source || a.package));
        if (trustedDelta !== 0) return trustedDelta;
        return parseSkillInstallCount(b.installs) - parseSkillInstallCount(a.installs);
      });
      setOpencodeSkillSearchResults(sorted);
      setOpencodeSkillDisplayLimit(OPENCODE_SKILL_DISPLAY_BATCH_SIZE);
      setOpencodeSkillSearchCache((prev) => ({ ...prev, [cacheKey]: sorted }));
      setOpencodeSkillSearchMeta({ count: sorted.length, searchType: "skillsmp-keyword", durationMs: 0 });
    } catch (error) {
      setSkillsError("SkillsMP 搜索暂时不可用，已保留本地榜单。");
      setOpencodeSkillSearchResults([]);
      setOpencodeSkillSearchMeta(null);
      appendDebugLogRef.current(`skill.search.error ${String(error)}`);
    } finally {
      if (repoPathRef.current.trim() === requestRepoPath) {
        setOpencodeSkillSearchLoading(false);
      }
    }
  }

  async function fetchOpencodeSkillCatalog(
    viewArg = opencodeSkillCatalogView,
    pageArg = 0,
    options: { allowBackendFallback?: boolean; force?: boolean } = {}
  ) {
    const requestRepoPath = repoPathRef.current.trim();
    if (!requestRepoPath) return;
    const cacheKey = buildOpencodeSkillCatalogCacheKey(viewArg, "");
    const requestKey = `${requestRepoPath}:${cacheKey}:${pageArg}`;
    if (!options.force && opencodeSkillCatalogInflightRef.current[requestKey]) return;
    if (!options.force && opencodeSkillCatalogAttempted[cacheKey] && pageArg <= 0) return;
    opencodeSkillCatalogInflightRef.current[requestKey] = true;
    const requestId = ++opencodeSkillCatalogRequestRef.current;
    startTransition(() => {
      setOpencodeSkillCatalogAttempted((prev) => ({ ...prev, [cacheKey]: true }));
      setOpencodeSkillCatalogLoading(true);
      setSkillsError("");
    });
    await waitForPaint();
    try {
      const page = pageArg + 1;
      const sortBy = viewArg === "trending" || viewArg === "hot" ? "recent" : "stars";
      const viewQuery = viewArg === "official" ? "official" : viewArg === "hot" ? "popular" : "agent";
      const query = getSkillsMarketplaceSeedQuery(viewQuery);
      const json = await fetchSkillsmpSearchWithFallback(
        { query, page, limit: 100, sortBy },
        { allowBackendFallback: options.allowBackendFallback ?? true }
      );
      if (requestId !== opencodeSkillCatalogRequestRef.current || repoPathRef.current.trim() !== requestRepoPath) return;
      let rows = normalizeArrayRows(json?.data?.skills)
        .map(skillsmpSkillToResult)
        .filter(Boolean) as OpencodeSkillSearchResult[];
      const positiveStarRows = rows.filter((item) => parseSkillInstallCount(item.installs) > 0);
      if (positiveStarRows.length > 0) rows = positiveStarRows;
      rows = rows.slice().sort((a, b) => parseSkillInstallCount(b.installs) - parseSkillInstallCount(a.installs));
      const nextPage = Number(json?.data?.pagination?.page || page) - 1;
      const nextTotal = Number(json?.data?.pagination?.total || rows.length);
      const nextHasMore = Boolean(json?.data?.pagination?.hasNext);
      startTransition(() => {
        setOpencodeSkillCatalogRows((prev) => {
          const mergedRows = mergeMarketplaceCatalogRows(prev, rows, pageArg <= 0);
          setOpencodeSkillCatalogCache((cache) => ({
            ...cache,
            [cacheKey]: { rows: mergedRows, page: nextPage, total: nextTotal, hasMore: nextHasMore }
          }));
          return mergedRows;
        });
        setOpencodeSkillDisplayLimit((limit) => Math.max(limit, OPENCODE_SKILL_DISPLAY_BATCH_SIZE));
        setOpencodeSkillCatalogPage(nextPage);
        setOpencodeSkillCatalogTotal(nextTotal);
        setOpencodeSkillCatalogHasMore(nextHasMore);
      });
    } catch (error) {
      if (requestId !== opencodeSkillCatalogRequestRef.current || repoPathRef.current.trim() !== requestRepoPath) return;
      startTransition(() => {
        setSkillsError("");
        setOpencodeSkillCatalogRows([]);
        setOpencodeSkillCatalogHasMore(false);
      });
      appendDebugLogRef.current(`skill.catalog.error ${String(error)}`);
    } finally {
      delete opencodeSkillCatalogInflightRef.current[requestKey];
      if (requestId === opencodeSkillCatalogRequestRef.current && repoPathRef.current.trim() === requestRepoPath) {
        startTransition(() => setOpencodeSkillCatalogLoading(false));
      }
    }
  }

  async function loadInitialSkillsmpCatalog() {
    if (!repoPathRef.current.trim() || opencodeSkillCatalogLoading || opencodeSkillCatalogRows.length > 0) return;
    if (opencodeSkillCatalogAttempted[buildOpencodeSkillCatalogCacheKey(opencodeSkillCatalogView, "")]) return;
    await fetchOpencodeSkillCatalog(opencodeSkillCatalogView, 0);
  }

  function switchOpencodeSkillCatalogView(view: OpencodeSkillCatalogView) {
    if (opencodeSkillCatalogView === view && opencodeSkillSearchResults.length === 0) return;
    setOpencodeSkillSearchResults([]);
    setOpencodeSkillSearchMeta(null);
    setOpencodeSkillCatalogView(view);
    setOpencodeSkillDisplayLimit(OPENCODE_SKILL_DISPLAY_BATCH_SIZE);
    setSkillsError("");
    const cached = opencodeSkillCatalogCache[buildOpencodeSkillCatalogCacheKey(view, "")];
    if (cached) {
      setOpencodeSkillCatalogRows(cached.rows);
      setOpencodeSkillCatalogPage(cached.page);
      setOpencodeSkillCatalogTotal(cached.total);
      setOpencodeSkillCatalogHasMore(cached.hasMore);
      return;
    }
    window.requestAnimationFrame(() => void fetchOpencodeSkillCatalog(view, 0));
  }

  async function warmSkillsMarketplace() {
    if (!repoPathRef.current.trim()) return;
    if (
      opencodeSkillCatalogLoading
      || opencodeSkillCatalogRows.length > 0
      || opencodeSkillSearchResults.length > 0
      || opencodeSkillCatalogAttempted[buildOpencodeSkillCatalogCacheKey(opencodeSkillCatalogView, "")]
    ) {
      return;
    }
    await Promise.allSettled([loadInitialSkillsmpCatalog()]);
  }

  function revealMoreOpencodeSkills() {
    if (opencodeSkillRevealLoading) return;
    setOpencodeSkillRevealLoading(true);
    window.setTimeout(() => {
      setOpencodeSkillDisplayLimit((limit) => limit + OPENCODE_SKILL_DISPLAY_BATCH_SIZE);
      setOpencodeSkillRevealLoading(false);
    }, 360);
  }

  function handleOpencodeSkillMarketScroll() {
    const element = opencodeSkillMarketListRef.current;
    if (!element) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    opencodeSkillUserNearBottomRef.current = distanceToBottom <= 520;
    if (!opencodeSkillUserNearBottomRef.current) return;
    if (opencodeCanRevealMoreSkills && !opencodeSkillRevealLoading) {
      revealMoreOpencodeSkills();
      return;
    }
    if (
      !opencodeSkillAllowBackendCatalogFetch
      && opencodeMarketplaceRows.length < OPENCODE_SKILL_DISPLAY_BATCH_SIZE
      && opencodeSkillCatalogRows.length === 0
      && opencodeSkillSearchResults.length === 0
    ) {
      setOpencodeSkillAllowBackendCatalogFetch(true);
      void fetchOpencodeSkillCatalog(opencodeSkillCatalogView, 0, { allowBackendFallback: true, force: true });
      return;
    }
    if (opencodeCanFetchMoreCatalogSkills && !opencodeSkillCatalogLoading) {
      void fetchOpencodeSkillCatalog(opencodeSkillCatalogView, opencodeSkillCatalogPage + 1);
    }
  }

  async function selectMarketplaceSkill(skill: OpencodeSkillSearchResult) {
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
        invoke<any>("fetch_opencode_skill_detail_api", { repoPath: requestRepoPath, id }).catch(() => null),
        invoke<any>("fetch_opencode_skill_audit_api", { repoPath: requestRepoPath, id }).catch(() => null)
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
    if (opencodeSkillSearchResults.length > 0) return;
    if (opencodeSkillCatalogRows.length > 0) return;
    if (opencodeSkillCatalogAttempted[buildOpencodeSkillCatalogCacheKey(opencodeSkillCatalogView, "")]) return;
    const timer = scheduleAfterInteraction(() => void loadInitialSkillsmpCatalog(), 320);
    return () => window.clearTimeout(timer);
  }, [
    skillsVisible,
    opencodeSkillCatalogAttempted,
    opencodeSkillCatalogRows.length,
    opencodeSkillCatalogView,
    opencodeSkillSearchResults.length
  ]);

  useEffect(() => {
    if (!skillsVisible) return;
    if (!repoPath.trim()) return;
    if (
      skillsLoadedOnce
      && (
        opencodeSkillCatalogRows.length > 0
        || opencodeSkillCatalogAttempted[buildOpencodeSkillCatalogCacheKey(opencodeSkillCatalogView, "")]
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
    opencodeSkillCatalogAttempted,
    opencodeSkillCatalogLoading,
    opencodeSkillCatalogRows.length,
    opencodeSkillCatalogView,
    opencodeSkillSearchResults.length
  ]);

  useEffect(() => {
    if (!skillsVisible) return;
    if (opencodeMarketplaceRows.length === 0) return;
    setSelectedMarketplaceSkill((prev) => {
      if (prev && opencodeMarketplaceRows.some((row) => row.spec === prev.spec)) return prev;
      return opencodeMarketplaceRows[0];
    });
  }, [skillsVisible, opencodeMarketplaceRows]);

  useEffect(() => {
    if (!skillsVisible) return;
    const element = opencodeSkillMarketListRef.current;
    if (!element || opencodeSkillsInitialLoading || opencodeSkillsPaging) return;
    if (element.scrollHeight - element.clientHeight > 520) return;
    if (opencodeCanRevealMoreSkills) {
      revealMoreOpencodeSkills();
      return;
    }
  }, [
    skillsVisible,
    visibleOpencodeMarketplaceRows.length,
    opencodeCanFetchMoreCatalogSkills,
    opencodeCanRevealMoreSkills,
    opencodeSkillCatalogPage,
    opencodeSkillCatalogView,
    opencodeSkillsInitialLoading,
    opencodeSkillsPaging
  ]);

  useEffect(() => {
    if (!skillsVisible || !opencodeSkillUserNearBottomRef.current) return;
    if (opencodeSkillsInitialLoading || opencodeSkillsPaging) return;
    if (opencodeCanRevealMoreSkills) return;
    if (opencodeCanFetchMoreCatalogSkills && !opencodeSkillCatalogLoading) {
      void fetchOpencodeSkillCatalog(opencodeSkillCatalogView, opencodeSkillCatalogPage + 1);
    }
  }, [
    skillsVisible,
    visibleOpencodeMarketplaceRows.length,
    opencodeMarketplaceRows.length,
    opencodeCanFetchMoreCatalogSkills,
    opencodeCanRevealMoreSkills,
    opencodeSkillCatalogLoading,
    opencodeSkillCatalogPage,
    opencodeSkillCatalogView,
    opencodeSkillsInitialLoading,
    opencodeSkillsPaging
  ]);

  return {
    opencodeSkillMarketListRef,
    opencodeSkillSearchQuery,
    setOpencodeSkillSearchQuery,
    opencodeSkillSearchStrategy,
    setOpencodeSkillSearchStrategy,
    opencodeSkillSearchResults,
    opencodeSkillSearchLoading,
    opencodeSkillCatalogView,
    opencodeSkillCatalogRows,
    opencodeSkillCatalogPage,
    opencodeSkillCatalogTotal,
    opencodeSkillSearchMeta,
    opencodeSkillAllowBackendCatalogFetch,
    selectedMarketplaceSkill,
    selectedSkillDetail,
    selectedSkillAudits,
    selectedSkillLoading,
    showSkillInstallMenu,
    setShowSkillInstallMenu,
    opencodeMarketplaceRows,
    visibleOpencodeMarketplaceRows,
    opencodeCanRevealMoreSkills,
    opencodeCanFetchMoreCatalogSkills,
    opencodeSkillsInitialLoading,
    opencodeSkillsSearching,
    opencodeSkillsPaging,
    opencodeCanAutoLoadMore,
    warmSkillsMarketplace,
    searchOpencodeSkillRegistry,
    switchOpencodeSkillCatalogView,
    handleOpencodeSkillMarketScroll,
    selectMarketplaceSkill,
    loadSelectedMarketplaceSkillDetails
  };
}

import { dedupeMarketplaceResults, isInstalledOpencodeSkill, type OpencodeSkillSearchResult } from "./opencodeSkillMarketplace";

export const INSTALLED_VIA_SKILLS_DESCRIPTION = "Installed via skills.sh";
export const OPENCODE_SKILL_DISPLAY_BATCH_SIZE = 50;

export type OpencodeSkillInfo = {
  name: string;
  description?: string;
  location?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  scope?: "project" | "global" | "source";
  path?: string;
  agents?: string[];
  sourceGroup?: string;
};

export type OpencodeInstalledSkillGroup = {
  name: string;
  items: OpencodeSkillInfo[];
  removableItems: OpencodeSkillInfo[];
  description: string;
};

export type OpencodeSkillDetail = {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash?: string | null;
  files?: Array<{ path: string; contents: string }> | null;
};

export type OpencodeSkillAudit = {
  provider: string;
  slug?: string;
  status: "pass" | "warn" | "fail" | string;
  summary?: string;
  auditedAt?: string;
  riskLevel?: string;
  categories?: string[];
};

export type PendingSkillInstallGroup = {
  groupName: string;
  scope: "project" | "global";
  beforePaths: string[];
};

export type InstalledOpencodeSkillRecord = {
  name: string;
  path: string;
  scope: "project" | "global";
  agents: string[];
  sourceGroup: string;
};

export type OpencodeSkillCatalogCacheEntry = {
  rows: OpencodeSkillSearchResult[];
  page: number;
  total: number;
  hasMore: boolean;
};

export function normalizeInstalledOpencodeSkills(raw: unknown): InstalledOpencodeSkillRecord[] {
  return (Array.isArray(raw) ? raw : [])
    .map((item: any) => ({
      name: String(item?.name || "").trim(),
      path: String(item?.path || ""),
      scope: (item?.scope === "global" ? "global" : "project") as "global" | "project",
      agents: Array.isArray(item?.agents) ? item.agents.map((value: unknown) => String(value || "")).filter(Boolean) : [],
      sourceGroup: String(item?.sourceGroup || "").trim()
    }))
    .filter((item) => item.name && isInstalledOpencodeSkill(item));
}

export function reconcilePendingSkillInstallGroups(input: {
  installedRows: InstalledOpencodeSkillRecord[];
  pending: PendingSkillInstallGroup[];
  sourceGroupMap: Record<string, string>;
}): {
  pending: PendingSkillInstallGroup[];
  sourceGroupMap: Record<string, string>;
  changed: boolean;
} {
  const nextMap = { ...input.sourceGroupMap };
  let changed = false;
  const unresolved: PendingSkillInstallGroup[] = [];

  input.pending.forEach((entry) => {
    let matchedAny = false;
    input.installedRows.forEach((item) => {
      if (item.scope !== entry.scope) return;
      if (!item.path || entry.beforePaths.includes(item.path)) return;
      matchedAny = true;
      if (nextMap[item.path] === entry.groupName) return;
      nextMap[item.path] = entry.groupName;
      changed = true;
    });
    if (!matchedAny) unresolved.push(entry);
  });

  return {
    pending: unresolved,
    sourceGroupMap: nextMap,
    changed
  };
}

export function buildInstalledSkillInfoRows(
  installedRows: InstalledOpencodeSkillRecord[],
  sourceGroupMap: Record<string, string>
): OpencodeSkillInfo[] {
  return installedRows.map((installed) => ({
    name: installed.name,
    description: INSTALLED_VIA_SKILLS_DESCRIPTION,
    location: installed.path,
    license: "",
    compatibility: "",
    scope: installed.scope,
    path: installed.path,
    agents: installed.agents,
    sourceGroup: installed.sourceGroup || sourceGroupMap[installed.path] || ""
  }));
}

export function buildOpencodeSkillCatalogCacheKey(view: string, category: string): string {
  return `${view}:${category || "all"}`;
}

export function mergeMarketplaceCatalogRows(
  previousRows: OpencodeSkillSearchResult[],
  incomingRows: OpencodeSkillSearchResult[],
  reset: boolean
): OpencodeSkillSearchResult[] {
  const nextRows = dedupeMarketplaceResults(incomingRows);
  if (reset) return nextRows;
  return dedupeMarketplaceResults([...previousRows, ...nextRows]);
}

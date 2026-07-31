import { dedupeMarketplaceResults, isInstalledAgentSkill, type AgentSkillSearchResult } from "./agentSkillMarketplace";

export const INSTALLED_VIA_SKILLS_DESCRIPTION = "Installed via skills.sh";
export const AGENT_SKILL_DISPLAY_BATCH_SIZE = 50;

export type AgentSkillInfo = {
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

export type AgentInstalledSkillGroup = {
  name: string;
  items: AgentSkillInfo[];
  removableItems: AgentSkillInfo[];
  description: string;
};

export type AgentSkillDetail = {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash?: string | null;
  files?: Array<{ path: string; contents: string }> | null;
};

export type AgentSkillAudit = {
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

export type InstalledAgentSkillRecord = {
  name: string;
  path: string;
  scope: "project" | "global";
  agents: string[];
  sourceGroup: string;
  description?: string;
  filePath?: string;
  source?: string;
  disableModelInvocation?: boolean;
};

export type AgentSkillCatalogCacheEntry = {
  rows: AgentSkillSearchResult[];
  page: number;
  total: number;
  hasMore: boolean;
};

export function normalizeInstalledAgentSkills(raw: unknown): InstalledAgentSkillRecord[] {
  return (Array.isArray(raw) ? raw : [])
    .map((item: any) => ({
      name: String(item?.name || "").trim(),
      path: String(item?.path || ""),
      scope: (item?.scope === "global" ? "global" : "project") as "global" | "project",
      agents: Array.isArray(item?.agents) ? item.agents.map((value: unknown) => String(value || "")).filter(Boolean) : [],
      sourceGroup: String(item?.sourceGroup || "").trim(),
      description: typeof item?.description === "string" ? item.description : "",
      filePath: typeof item?.filePath === "string" ? item.filePath : "",
      source: typeof item?.source === "string" ? item.source : "",
      disableModelInvocation: Boolean(item?.disableModelInvocation)
    }))
    .filter((item) => item.name && isInstalledAgentSkill(item));
}

export function reconcilePendingSkillInstallGroups(input: {
  installedRows: InstalledAgentSkillRecord[];
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
  installedRows: InstalledAgentSkillRecord[],
  sourceGroupMap: Record<string, string>
): AgentSkillInfo[] {
  return installedRows.map((installed) => ({
    name: installed.name,
    description: installed.description || INSTALLED_VIA_SKILLS_DESCRIPTION,
    location: installed.path,
    license: "",
    compatibility: "",
    scope: installed.scope,
    path: installed.path,
    agents: installed.agents,
    sourceGroup: installed.sourceGroup || sourceGroupMap[installed.path] || ""
  }));
}

export function buildAgentSkillCatalogCacheKey(view: string, category: string): string {
  return `${view}:${category || "all"}`;
}

export function mergeMarketplaceCatalogRows(
  previousRows: AgentSkillSearchResult[],
  incomingRows: AgentSkillSearchResult[],
  reset: boolean
): AgentSkillSearchResult[] {
  const nextRows = dedupeMarketplaceResults(incomingRows);
  if (reset) return nextRows;
  return dedupeMarketplaceResults([...previousRows, ...nextRows]);
}

export type ParsedModelRef = { provider: string; model: string };
export type ModelCatalog = Record<string, string[]>;
export type ModelNameCatalog = Record<string, Record<string, string>>;

type ModelAvailabilityContext = {
  connectedProviders: string[];
  liveModelsByProvider: ModelCatalog;
  providerNames: Record<string, string>;
};

type ConfiguredModelCandidateContext = ModelAvailabilityContext & {
  configuredProviders: string[];
  configuredModelsByProvider: ModelCatalog;
  configuredModelNamesByProvider?: ModelNameCatalog;
  liveModelNamesByProvider?: ModelNameCatalog;
  enabledModels: Set<string>;
  hiddenModels: Set<string>;
  search?: string;
};

export function normalizeModelRef(input: string): string {
  const model = (input || "").trim();
  if (!model) return "";
  const idx = model.indexOf("/");
  if (idx <= 0 || idx >= model.length - 1) return "";
  const provider = model.slice(0, idx).trim();
  const modelId = model.slice(idx + 1).trim();
  if (!provider || !modelId) return "";
  return `${provider}/${modelId}`;
}

export function parseModelRef(input: string): ParsedModelRef | null {
  const full = normalizeModelRef(input);
  if (!full) return null;
  const idx = full.indexOf("/");
  return {
    provider: full.slice(0, idx),
    model: full.slice(idx + 1)
  };
}

export function normalizeProviderId(input: string): string {
  return (input || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function providerIdLookupKey(input: string): string {
  return (input || "").trim().toLowerCase();
}

export function resolveProviderAlias(provider: string, catalog: ModelCatalog): string {
  if (!provider) return provider;
  if (Object.prototype.hasOwnProperty.call(catalog, provider)) return provider;
  const norm = providerIdLookupKey(provider);
  if (!norm) return provider;
  const matches = Object.keys(catalog).filter((k) => providerIdLookupKey(k) === norm);
  if (matches.length === 0) return provider;
  let best = matches[0];
  for (const id of matches) {
    const bestCount = (catalog[best] || []).length;
    const curCount = (catalog[id] || []).length;
    if (curCount > bestCount) {
      best = id;
      continue;
    }
    if (curCount === bestCount) {
      const bestClean = providerIdLookupKey(best) === best;
      const curClean = providerIdLookupKey(id) === id;
      if (curClean && !bestClean) best = id;
    }
  }
  return best;
}

export function resolveProviderAliasWithNames(
  provider: string,
  catalog: ModelCatalog,
  providerNames: Record<string, string>
): string {
  const byId = resolveProviderAlias(provider, catalog);
  if (byId && ((catalog[byId] || []).length > 0 || !provider)) return byId;
  const norm = providerIdLookupKey(provider);
  if (!norm) return provider;
  const byName = Object.keys(providerNames).find((id) => providerIdLookupKey(providerNames[id] || "") === norm);
  if (!byName) return provider;
  return resolveProviderAlias(byName, catalog);
}

export function expandConfiguredModelRefVariants(
  full: string,
  configuredProviders: string[],
  configuredModels: Record<string, string[]>,
  catalog: Record<string, string[]>,
  providerNames: Record<string, string>
): string[] {
  const parsed = parseModelRef(full);
  if (!parsed) return [];
  const mid = parsed.model;
  const pRes = resolveProviderAliasWithNames(parsed.provider, catalog, providerNames) || parsed.provider;
  const out = new Set<string>();
  for (const cfgPid of configuredProviders) {
    if (!cfgPid) continue;
    if (!(configuredModels[cfgPid] ?? []).includes(mid)) continue;
    const cRes = resolveProviderAliasWithNames(cfgPid, catalog, providerNames) || cfgPid;
    if (cRes !== pRes) continue;
    const n = normalizeModelRef(`${cfgPid}/${mid}`);
    if (n) out.add(n);
  }
  if (out.size === 0) {
    const n = normalizeModelRef(full);
    if (n) out.add(n);
  }
  return Array.from(out);
}

export function hiddenCoversConfiguredModelRef(
  hidden: Set<string>,
  full: string,
  configuredProviders: string[],
  configuredModels: Record<string, string[]>,
  catalog: Record<string, string[]>,
  providerNames: Record<string, string>
): boolean {
  return expandConfiguredModelRefVariants(full, configuredProviders, configuredModels, catalog, providerNames).some((v) =>
    hidden.has(v)
  );
}

export function loadModelRefSet(storageKey: string, field: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> | null : null;
    const values = Array.isArray(parsed?.[field]) ? parsed[field] as unknown[] : [];
    return new Set(values.map((x) => normalizeModelRef(String(x || ""))).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function saveModelRefSet(storageKey: string, field: string, values: Set<string>): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ [field]: Array.from(values) }));
  } catch {
    // ignore local preference write failures
  }
}

export function isModelRefAvailable(full: string, ctx: ModelAvailabilityContext): boolean {
  const parsed = parseModelRef(full);
  if (!parsed) return false;
  const resolvedProvider = resolveProviderAliasWithNames(parsed.provider, ctx.liveModelsByProvider, ctx.providerNames) || parsed.provider;
  if (ctx.connectedProviders.length > 0 && resolvedProvider && !ctx.connectedProviders.includes(resolvedProvider)) return false;
  const providerModels = ctx.liveModelsByProvider[resolvedProvider] ?? ctx.liveModelsByProvider[parsed.provider] ?? [];
  return providerModels.length === 0 || providerModels.includes(parsed.model);
}

export function buildConfiguredModelCandidates(ctx: ConfiguredModelCandidateContext): string[] {
  const q = (ctx.search || "").trim().toLowerCase();
  const connected = new Set(ctx.connectedProviders.filter(Boolean));
  const out = new Set<string>();
  const includeRef = (full: string, displayName = "") => {
    if (!full || ctx.hiddenModels.has(full)) return;
    if (q && !`${full} ${displayName}`.toLowerCase().includes(q)) return;
    out.add(full);
  };

  for (const pid of ctx.configuredProviders) {
    const resolvedProvider = resolveProviderAliasWithNames(pid, ctx.liveModelsByProvider, ctx.providerNames) || pid;
    if (resolvedProvider && !connected.has(resolvedProvider)) continue;
    const providerModels = ctx.liveModelsByProvider[resolvedProvider] ?? ctx.liveModelsByProvider[pid] ?? [];
    for (const mid of ctx.configuredModelsByProvider[pid] ?? []) {
      const full = normalizeModelRef(`${pid}/${mid}`);
      if (!full) continue;
      if (providerModels.length > 0 && !providerModels.includes(mid)) continue;
      const provider = resolveProviderAliasWithNames(pid, ctx.liveModelsByProvider, ctx.providerNames) || pid;
      const displayName =
        ctx.configuredModelNamesByProvider?.[provider]?.[mid] ||
        ctx.liveModelNamesByProvider?.[provider]?.[mid] ||
        "";
      includeRef(full, displayName);
    }
  }

  for (const full of ctx.enabledModels) {
    const parsed = parseModelRef(full);
    if (!parsed) continue;
    const resolvedProvider = resolveProviderAliasWithNames(parsed.provider, ctx.liveModelsByProvider, ctx.providerNames) || parsed.provider;
    if (resolvedProvider && !connected.has(resolvedProvider)) continue;
    const providerModels = ctx.liveModelsByProvider[resolvedProvider] ?? ctx.liveModelsByProvider[parsed.provider] ?? [];
    if (providerModels.length > 0 && !providerModels.includes(parsed.model)) continue;
    const displayName =
      ctx.configuredModelNamesByProvider?.[parsed.provider]?.[parsed.model] ||
      ctx.liveModelNamesByProvider?.[resolvedProvider]?.[parsed.model] ||
      "";
    includeRef(full, displayName);
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export function buildSyncModelRefs(ctx: ConfiguredModelCandidateContext & { activeModel?: string; configuredModel?: string }): string[] {
  const refs = new Set(buildConfiguredModelCandidates({ ...ctx, search: "" }));
  const active = normalizeModelRef(ctx.activeModel || ctx.configuredModel || "");
  if (active && !ctx.hiddenModels.has(active) && isModelRefAvailable(active, ctx)) refs.add(active);
  return Array.from(refs).sort((a, b) => a.localeCompare(b));
}

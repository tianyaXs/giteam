import {
  isModelRefAvailable,
  normalizeModelRef,
  parseModelRef,
  resolveProviderAliasWithNames
} from "./opencodeModels";
import { isPresetProviderId } from "./opencodeProviders";

export type OpencodeModelConfig = {
  configPath: string;
  configuredModel: string;
  exists: boolean;
};

export type OpencodeProviderConfig = {
  provider: string;
  npm: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  endpoint: string;
  region: string;
  profile: string;
  project: string;
  location: string;
  resourceName: string;
  enterpriseUrl: string;
  timeout: string;
  chunkTimeout: string;
};

export type OpencodeCatalogProvider = {
  id: string;
  name: string;
  models: string[];
};

export type OpencodeConfigProviderCatalog = {
  id: string;
  name: string;
  npm: string;
  models: string[];
};

export type OpencodeServerProviderCatalog = {
  id: string;
  name: string;
  models: string[];
  modelNames?: Record<string, string>;
  source?: string;
};

export type OpencodeServerProviderState = {
  providers: OpencodeServerProviderCatalog[];
  connected: string[];
};

export type OpencodeServerConfigProvider = {
  name?: string;
  npm?: string;
  models?: Record<string, { name?: string }>;
  options?: {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  } & Record<string, unknown>;
  env?: string[];
};

export type OpencodeServerConfig = {
  provider?: Record<string, OpencodeServerConfigProvider>;
  disabled_providers?: string[];
  model?: string;
} & Record<string, unknown>;

export type OpencodeServiceSettings = {
  port: number;
};

export type OpencodeProviderAuthMethod = { type: string; label?: string };

export type OpencodeProviderCatalogSnapshot = {
  providers: string[];
  connectedProviders: string[];
  providerNames: Record<string, string>;
  providerSources: Record<string, string>;
  modelsByProvider: Record<string, string[]>;
  modelNamesByProvider: Record<string, Record<string, string>>;
};

export type OpencodeConfiguredProviderSnapshot = {
  providerMap: Record<string, OpencodeServerConfigProvider>;
  disabledProviders: string[];
  configuredProviders: string[];
  providerNames: Record<string, string>;
  modelsByProvider: Record<string, string[]>;
  modelNamesByProvider: Record<string, Record<string, string>>;
};

export function applyOpencodeCatalog(
  catalog: Record<string, string[]>,
  currentProvider: string,
  currentModel: string
): {
  providers: string[];
  provider: string;
  models: string[];
  model: string;
} {
  const providers = Object.keys(catalog).sort((a, b) => a.localeCompare(b));
  const provider = currentProvider && providers.includes(currentProvider) ? currentProvider : "";
  const models = provider ? (catalog[provider] ?? []) : [];
  const model = currentModel && models.includes(currentModel) ? currentModel : "";
  return { providers, provider, models, model };
}

export function normalizeOpencodeServerProviderState(
  state: OpencodeServerProviderState | null | undefined
): OpencodeProviderCatalogSnapshot {
  const rows = state?.providers || [];
  const providerNames: Record<string, string> = {};
  const providerSources: Record<string, string> = {};
  const modelsByProvider: Record<string, string[]> = {};
  const modelNamesByProvider: Record<string, Record<string, string>> = {};

  for (const row of rows) {
    if (!row?.id) continue;
    providerNames[row.id] = row.name || row.id;
    if (row.source) providerSources[row.id] = row.source;
    modelsByProvider[row.id] = Array.from(new Set((row.models || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    modelNamesByProvider[row.id] = row.modelNames || {};
  }

  return {
    providers: Object.keys(modelsByProvider).sort((a, b) => a.localeCompare(b)),
    connectedProviders: (state?.connected || []).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    providerNames,
    providerSources,
    modelsByProvider,
    modelNamesByProvider
  };
}

export function buildOpencodeConfiguredProviderSnapshot(
  config: OpencodeServerConfig | null | undefined
): OpencodeConfiguredProviderSnapshot {
  const providerMap = config?.provider || {};
  const disabled = new Set((config?.disabled_providers || []).filter(Boolean));
  const providerNames: Record<string, string> = {};
  const modelsByProvider: Record<string, string[]> = {};
  const modelNamesByProvider: Record<string, Record<string, string>> = {};

  for (const [providerId, provider] of Object.entries(providerMap)) {
    if (providerId) providerNames[providerId] = provider?.name || providerId;
    if (!providerId || disabled.has(providerId)) continue;
    const modelEntries = provider?.models || {};
    const models = Object.keys(modelEntries).filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (models.length > 0) modelsByProvider[providerId] = models;

    const displayMap: Record<string, string> = {};
    for (const [modelIdRaw, modelValue] of Object.entries(modelEntries)) {
      const modelId = (modelIdRaw || "").trim();
      if (!modelId) continue;
      const display = (modelValue?.name || modelId).trim();
      displayMap[modelId] = display || modelId;
    }
    modelNamesByProvider[providerId] = displayMap;
  }

  return {
    providerMap,
    disabledProviders: Array.from(disabled).sort((a, b) => a.localeCompare(b)),
    configuredProviders: Object.keys(providerMap).filter((id) => id && !disabled.has(id)).sort((a, b) => a.localeCompare(b)),
    providerNames,
    modelsByProvider,
    modelNamesByProvider
  };
}

export function resolveActiveOpencodeModel(input: {
  activeSessionId: string;
  sessionModel: Record<string, string>;
  draftModel: string;
  configuredModel: string;
  savedModels: string[];
  connectedProviders: string[];
  modelsByProvider: Record<string, string[]>;
  providerNames: Record<string, string>;
}): string {
  const isAvailableModel = (modelRef: string) => isModelRefAvailable(modelRef, {
    connectedProviders: input.connectedProviders,
    liveModelsByProvider: input.modelsByProvider,
    providerNames: input.providerNames
  });
  const sessionId = input.activeSessionId.trim();
  const fromSession = sessionId ? normalizeModelRef(input.sessionModel[sessionId] || "") : "";
  if (fromSession && isAvailableModel(fromSession)) return fromSession;
  const fromDraft = normalizeModelRef(input.draftModel || "");
  if (fromDraft && isAvailableModel(fromDraft)) return fromDraft;
  const configured = normalizeModelRef(input.configuredModel || "");
  if (configured && isAvailableModel(configured)) return configured;
  const recent = normalizeModelRef(input.savedModels[0] || "");
  if (recent && isAvailableModel(recent)) return recent;
  for (const providerId of input.connectedProviders) {
    const modelId = input.modelsByProvider[providerId]?.[0] || "";
    const full = normalizeModelRef(`${providerId}/${modelId}`);
    if (full) return full;
  }
  return "";
}

export function buildOpencodeProviderPickerCandidates(input: {
  search: string;
  presetProviderIds: string[];
  providers: string[];
  connectedProviders: string[];
  providerNames: Record<string, string>;
  configProviderMap: Record<string, OpencodeServerConfigProvider>;
  disabledProviders: string[];
}): string[] {
  const query = input.search.trim().toLowerCase();
  const disabled = new Set((input.disabledProviders || []).filter(Boolean));
  const configProviderIds = Object.keys(input.configProviderMap || {})
    .filter(Boolean)
    .filter((providerId) => !disabled.has(providerId) || isPresetProviderId(providerId));
  const merged = Array.from(new Set([...input.presetProviderIds, ...input.providers, ...configProviderIds].filter(Boolean)));
  const connected = new Set(input.connectedProviders.filter(Boolean));
  const sortByPriority = (rows: string[]) =>
    [...rows].sort((a, b) => {
      const connectedA = connected.has(a) ? 1 : 0;
      const connectedB = connected.has(b) ? 1 : 0;
      if (connectedA !== connectedB) return connectedB - connectedA;
      return a.localeCompare(b);
    });

  if (!query) return sortByPriority(merged);
  return sortByPriority(merged.filter((providerId) => {
    const name = input.providerNames[providerId] || "";
    return providerId.toLowerCase().includes(query) || name.toLowerCase().includes(query);
  }));
}

export function getOpencodeModelDisplayInfo(input: {
  modelRef: string;
  modelsByProvider: Record<string, string[]>;
  providerNames: Record<string, string>;
  modelNamesByProvider: Record<string, Record<string, string>>;
  configuredModelNamesByProvider: Record<string, Record<string, string>>;
}) {
  const normalized = normalizeModelRef(input.modelRef);
  const parsed = normalized ? parseModelRef(normalized) : null;
  const provider = resolveProviderAliasWithNames(parsed?.provider || "", input.modelsByProvider, input.providerNames) || (parsed?.provider || "");
  const modelId = parsed?.model || "";
  const label = (
    provider
      ? (input.modelNamesByProvider[provider]?.[modelId] || input.configuredModelNamesByProvider[provider]?.[modelId])
      : ""
  ) || normalized || "Auto";
  return {
    ref: normalized || "",
    provider: provider || "Auto",
    modelId,
    label
  };
}

export function getOpencodeProviderSource(
  providerId: string,
  providerSourceById: Record<string, string>
): string {
  const pid = (providerId || "").trim();
  if (!pid) return "";
  return (providerSourceById[pid] || "").trim().toLowerCase();
}

export function isOpencodeConfigCustomProvider(
  providerId: string,
  providerMap: Record<string, OpencodeServerConfigProvider>
): boolean {
  const pid = (providerId || "").trim();
  if (!pid) return false;
  const provider = providerMap[pid];
  if (!provider) return false;
  if ((provider.npm || "").trim() !== "@ai-sdk/openai-compatible") return false;
  return Object.keys(provider.models || {}).filter(Boolean).length > 0;
}

export function getOpencodeProviderTag(input: {
  providerId: string;
  providerSourceById: Record<string, string>;
  providerMap: Record<string, OpencodeServerConfigProvider>;
}): string {
  const source = getOpencodeProviderSource(input.providerId, input.providerSourceById);
  if (source === "env") return "env";
  if (source === "api") return "api";
  if (source === "config") return isOpencodeConfigCustomProvider(input.providerId, input.providerMap) ? "custom" : "config";
  if (source === "custom") return "custom";
  return isPresetProviderId(input.providerId) ? "preset" : "other";
}

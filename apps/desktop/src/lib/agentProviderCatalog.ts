import {
  isModelRefAvailable,
  normalizeModelRef,
  parseModelRef,
  resolveProviderAliasWithNames
} from "./agentModels";
import { isPresetProviderId } from "./agentProviders";

/** 列表置顶的 OpenAI Completions 兼容入口（填 Base URL + API Key）。 */
export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";
export const OPENAI_COMPATIBLE_PROVIDER_NAME = "OpenAI Completions";

export function isOpenAICompatibleProviderId(providerId: string): boolean {
  const pid = (providerId || "").trim();
  return pid === OPENAI_COMPATIBLE_PROVIDER_ID || pid.startsWith(`${OPENAI_COMPATIBLE_PROVIDER_ID}.`);
}

/** 已保存的自定义供应商实例（可从 models.json 整项删除；不含列表模板入口）。 */
export function isRemovableCustomProviderId(providerId: string): boolean {
  const pid = (providerId || "").trim();
  if (!pid || pid === OPENAI_COMPATIBLE_PROVIDER_ID) return false;
  return pid.startsWith(`${OPENAI_COMPATIBLE_PROVIDER_ID}.`);
}

/** openai-codex 等 OAuth 原生供应商：自定义 Base URL 时原地更新，并强制 Completions。 */
export function isOAuthNativeApiLockedProvider(providerId: string): boolean {
  const pid = (providerId || "").trim().toLowerCase();
  return pid === "openai-codex" || pid === "github-copilot";
}

export function suggestCustomEndpointName(providerId: string, baseUrl: string): string {
  const host = (() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  if (host) return `${providerId} · ${host}`;
  return `${providerId} 自定义`;
}

export type AgentModelConfig = {
  configPath: string;
  configuredModel: string;
  exists: boolean;
};

export type AgentProviderConfig = {
  provider: string;
  npm: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Pi api 适配器 id，自定义供应商可选。 */
  api?: string;
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

export type AgentCatalogProvider = {
  id: string;
  name: string;
  models: string[];
};

export type AgentConfigProviderCatalog = {
  id: string;
  name: string;
  npm: string;
  models: string[];
};

export type AgentServerProviderCatalog = {
  id: string;
  name: string;
  models: string[];
  modelNames?: Record<string, string>;
  source?: string;
};

export type AgentServerProviderState = {
  providers: AgentServerProviderCatalog[];
  connected: string[];
};

export type AgentServerConfigProvider = {
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

export type AgentServerConfig = {
  provider?: Record<string, AgentServerConfigProvider>;
  disabled_providers?: string[];
  model?: string;
} & Record<string, unknown>;

export type AgentServiceSettings = {
  port: number;
};

export type AgentProviderAuthMethod = { type: string; label?: string };

export type AgentProviderCatalogSnapshot = {
  providers: string[];
  connectedProviders: string[];
  providerNames: Record<string, string>;
  providerSources: Record<string, string>;
  modelsByProvider: Record<string, string[]>;
  modelNamesByProvider: Record<string, Record<string, string>>;
};

export type AgentConfiguredProviderSnapshot = {
  providerMap: Record<string, AgentServerConfigProvider>;
  disabledProviders: string[];
  configuredProviders: string[];
  providerNames: Record<string, string>;
  modelsByProvider: Record<string, string[]>;
  modelNamesByProvider: Record<string, Record<string, string>>;
};

export function applyAgentCatalog(
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

export function normalizeAgentServerProviderState(
  state: AgentServerProviderState | null | undefined
): AgentProviderCatalogSnapshot {
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

export function buildAgentConfiguredProviderSnapshot(
  config: AgentServerConfig | null | undefined
): AgentConfiguredProviderSnapshot {
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

export function resolveActiveAgentModel(input: {
  activeSessionId: string;
  /**
   * 当前活动会话上的 provider/model ref（来自 AgentChatSession / 服务端 summary）。
   * 有活动会话时这是唯一显示真相；空字符串表示会话模型尚未回填，也不得回落 draft。
   */
  sessionModelRef?: string;
  /** @deprecated 旧影子映射；仅在 sessionModelRef 未传时作兼容回退。 */
  sessionModel?: Record<string, string>;
  draftModel: string;
  configuredModel: string;
  savedModels: string[];
  connectedProviders: string[];
  modelsByProvider: Record<string, string[]>;
  providerNames: Record<string, string>;
  /** 用户在设置页显式打开的模型；非空时兜底只从其中选择，不再自动落到
   *  已连接 provider 的任意第一个模型（避免"配了 deepseek 却自动选中 glm"）。 */
  enabledModels?: Set<string>;
}): string {
  const isAvailableModel = (modelRef: string) => isModelRefAvailable(modelRef, {
    connectedProviders: input.connectedProviders,
    liveModelsByProvider: input.modelsByProvider,
    providerNames: input.providerNames
  });
  const sessionId = input.activeSessionId.trim();
  if (sessionId) {
    const fromSessionRef = normalizeModelRef(input.sessionModelRef || "");
    if (fromSessionRef) return fromSessionRef;
    // 兼容过渡：若调用方仍传旧 sessionModel map，可读一次，但不再作为长期真相。
    const fromLegacyMap = normalizeModelRef(input.sessionModel?.[sessionId] || "");
    if (fromLegacyMap) return fromLegacyMap;
    // 有活动会话但尚未拿到 provider/model：返回空，禁止回落 draft（否则又会显示 A 跑 B）。
    return "";
  }
  const fromDraft = normalizeModelRef(input.draftModel || "");
  if (fromDraft && isAvailableModel(fromDraft)) return fromDraft;
  const configured = normalizeModelRef(input.configuredModel || "");
  if (configured && isAvailableModel(configured)) return configured;
  const recent = normalizeModelRef(input.savedModels[0] || "");
  if (recent && isAvailableModel(recent)) return recent;
  if (input.enabledModels && input.enabledModels.size > 0) {
    for (const full of input.enabledModels) {
      const normalized = normalizeModelRef(full);
      if (normalized && isAvailableModel(normalized)) return normalized;
    }
  }
  // 没有会话/草稿/最近/启用模型时不自动挑已连接 provider 的第一个模型
  //（否则未配置也会显示 deepseek 等目录默认项）。
  return "";
}

export function buildAgentProviderPickerCandidates(input: {
  search: string;
  presetProviderIds: string[];
  providers: string[];
  connectedProviders: string[];
  providerNames: Record<string, string>;
  configProviderMap: Record<string, AgentServerConfigProvider>;
  disabledProviders: string[];
}): string[] {
  const query = input.search.trim().toLowerCase();
  const disabled = new Set((input.disabledProviders || []).filter(Boolean));
  const configProviderIds = Object.keys(input.configProviderMap || {})
    .filter(Boolean)
    .filter((providerId) => !disabled.has(providerId) || isPresetProviderId(providerId));
  const merged = Array.from(
    new Set(
      [
        OPENAI_COMPATIBLE_PROVIDER_ID,
        ...input.presetProviderIds,
        ...input.providers,
        ...configProviderIds
      ].filter(Boolean)
    )
  );
  const connected = new Set(input.connectedProviders.filter(Boolean));
  const sortByPriority = (rows: string[]) => {
    const rest = rows
      .filter((id) => id !== OPENAI_COMPATIBLE_PROVIDER_ID)
      .sort((a, b) => {
        const connectedA = connected.has(a) ? 1 : 0;
        const connectedB = connected.has(b) ? 1 : 0;
        if (connectedA !== connectedB) return connectedB - connectedA;
        return a.localeCompare(b);
      });
    // OpenAI Completions 始终置顶，方便填地址 + Key。
    const includeVirtual = rows.includes(OPENAI_COMPATIBLE_PROVIDER_ID);
    return includeVirtual ? [OPENAI_COMPATIBLE_PROVIDER_ID, ...rest] : rest;
  };

  if (!query) return sortByPriority(merged);
  return sortByPriority(merged.filter((providerId) => {
    const name = input.providerNames[providerId]
      || (providerId === OPENAI_COMPATIBLE_PROVIDER_ID ? OPENAI_COMPATIBLE_PROVIDER_NAME : "");
    return providerId.toLowerCase().includes(query)
      || name.toLowerCase().includes(query)
      || (providerId === OPENAI_COMPATIBLE_PROVIDER_ID && "openai completions custom".includes(query));
  }));
}

export function getAgentModelDisplayInfo(input: {
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

export function getAgentProviderSource(
  providerId: string,
  providerSourceById: Record<string, string>
): string {
  const pid = (providerId || "").trim();
  if (!pid) return "";
  return (providerSourceById[pid] || "").trim().toLowerCase();
}

export function isAgentConfigCustomProvider(
  providerId: string,
  providerMap: Record<string, AgentServerConfigProvider>
): boolean {
  const pid = (providerId || "").trim();
  if (!pid) return false;
  const provider = providerMap[pid];
  if (!provider) return false;
  if ((provider.npm || "").trim() !== "@ai-sdk/openai-compatible") return false;
  return Object.keys(provider.models || {}).filter(Boolean).length > 0;
}

export function getAgentProviderTag(input: {
  providerId: string;
  providerSourceById: Record<string, string>;
  providerMap: Record<string, AgentServerConfigProvider>;
}): string {
  if (isOpenAICompatibleProviderId(input.providerId)) return "custom";
  const source = getAgentProviderSource(input.providerId, input.providerSourceById);
  if (source === "env") return "env";
  if (source === "custom") return "custom";
  if (source === "api") return "api";
  if (source === "config") return isAgentConfigCustomProvider(input.providerId, input.providerMap) ? "custom" : "config";
  return isPresetProviderId(input.providerId) ? "preset" : "other";
}

/** 是否显示「删除供应商」（自定义实例；不含 OpenAI Completions 模板入口）。 */
export function canRemoveAgentCustomProvider(
  providerId: string,
  providerSourceById: Record<string, string>
): boolean {
  const pid = (providerId || "").trim();
  if (!pid || pid === OPENAI_COMPATIBLE_PROVIDER_ID) return false;
  if (isRemovableCustomProviderId(pid)) return true;
  return getAgentProviderSource(pid, providerSourceById) === "custom";
}

import type { AgentProviderInfo } from "./client";
import type {
  AgentConfigProviderCatalog,
  AgentServerConfig,
  AgentServerProviderState
} from "../agentProviderCatalog";

/**
 * 列表/选择器显示名：优先用 catalog / models.json 的 `name`。
 * 仅当 name 缺失时，才用 model id 生成可读回退（deepseek-reasoner → Deepseek Reasoner）。
 * 注意：name 与 id 相同（如 live discovery 写入 `"name": id`）时仍应原样显示 name，
 * 禁止再按 id 做 Title Case，否则会出现 gpt-5.6-sol →「Gpt 5 6 Sol」。
 */
export function humanizeModelName(modelId: string, name: string): string {
  const trimmed = (name || "").trim();
  if (trimmed) return trimmed;
  const humanized = modelId
    .split(/[-_./\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim();
  return humanized || modelId;
}

/**
 * Pi AgentProviderInfo → 渲染层既有形状的单向适配。
 *
 * 设置页/模型选择器的视觉与组件不变，只把数据源从 opencode 服务换成
 * pi 的统一 catalog（88 个内置 provider + models.json 自定义 + vault 凭据标注）。
 * "connected" 语义对应 pi 的 hasCredential（只暴露布尔，凭据不出 vault）。
 */
export function agentProvidersToServerState(providers: AgentProviderInfo[]): AgentServerProviderState {
  return {
    providers: providers.map((provider) => ({
      id: provider.provider,
      name: (provider.name || "").trim() || provider.provider,
      models: provider.models.map((model) => model.modelId).sort((a, b) => a.localeCompare(b)),
      modelNames: Object.fromEntries(
        provider.models.map((model) => [model.modelId, humanizeModelName(model.modelId, model.name)])
      ),
      source: provider.removable ? "custom" : provider.hasCredential ? "api" : ""
    })),
    connected: providers.filter((provider) => provider.hasCredential).map((provider) => provider.provider)
  };
}

/** 合成 opencode /global/config 等价物：已配置（有凭据）的 provider 集合。 */
export function agentProvidersToGlobalConfig(providers: AgentProviderInfo[]): AgentServerConfig {
  return {
    provider: Object.fromEntries(
      providers
        .filter((provider) => provider.hasCredential)
        .map((provider) => [
          provider.provider,
          {
            name: (provider.name || "").trim() || provider.provider,
            models: Object.fromEntries(
              provider.models.map((model) => [model.modelId, { name: humanizeModelName(model.modelId, model.name) }])
            )
          }
        ])
    )
  };
}

/** 合成 opencode config provider catalog 等价物（仅用于显示名同步）。 */
export function agentProvidersToConfigCatalog(providers: AgentProviderInfo[]): AgentConfigProviderCatalog[] {
  return providers.map((provider) => ({
    id: provider.provider,
    name: (provider.name || "").trim() || provider.provider,
    npm: "",
    models: provider.models.map((model) => model.modelId)
  }));
}

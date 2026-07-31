import type { AgentProviderInfo } from "./client";
import type {
  AgentConfigProviderCatalog,
  AgentServerConfig,
  AgentServerProviderState
} from "../agentProviderCatalog";

/**
 * Pi 对上游快照合并进来的 provider（如 deepseek）直接使用 model id 作为显示名。
 * 当 name 缺失或等于 id 时生成可读标签（deepseek-reasoner → Deepseek Reasoner），
 * 有正式目录名（如 GPT-4o）时原样保留。
 */
export function humanizeModelName(modelId: string, name: string): string {
  const trimmed = (name || "").trim();
  if (trimmed && trimmed !== modelId) return trimmed;
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
      name: provider.provider,
      models: provider.models.map((model) => model.modelId).sort((a, b) => a.localeCompare(b)),
      modelNames: Object.fromEntries(
        provider.models.map((model) => [model.modelId, humanizeModelName(model.modelId, model.name)])
      ),
      source: provider.hasCredential ? "api" : ""
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
            name: provider.provider,
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
    name: provider.provider,
    npm: "",
    models: provider.models.map((model) => model.modelId)
  }));
}

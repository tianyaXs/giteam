export type ProviderPreset = {
  id: string;
  name: string;
  defaultBaseUrl: string;
  apiKeyHint: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "opencode", name: "OpenCode", defaultBaseUrl: "", apiKeyHint: "OPENCODE_API_KEY" },
  { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", apiKeyHint: "OPENAI_API_KEY" },
  { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", apiKeyHint: "ANTHROPIC_API_KEY" },
  { id: "google", name: "Google AI", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKeyHint: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "google-vertex", name: "Google Vertex", defaultBaseUrl: "", apiKeyHint: "Google Cloud credentials" },
  { id: "google-vertex-anthropic", name: "Vertex Anthropic", defaultBaseUrl: "", apiKeyHint: "Google Cloud credentials" },
  { id: "amazon-bedrock", name: "Amazon Bedrock", defaultBaseUrl: "", apiKeyHint: "AWS credentials / bearer token" },
  { id: "openrouter", name: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", apiKeyHint: "OPENROUTER_API_KEY" },
  { id: "xai", name: "xAI", defaultBaseUrl: "https://api.x.ai/v1", apiKeyHint: "XAI_API_KEY" },
  { id: "mistral", name: "Mistral", defaultBaseUrl: "https://api.mistral.ai/v1", apiKeyHint: "MISTRAL_API_KEY" },
  { id: "groq", name: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1", apiKeyHint: "GROQ_API_KEY" },
  { id: "azure", name: "Azure OpenAI", defaultBaseUrl: "https://{resource}.openai.azure.com/openai", apiKeyHint: "AZURE_API_KEY" },
  { id: "deepinfra", name: "DeepInfra", defaultBaseUrl: "https://api.deepinfra.com/v1/openai", apiKeyHint: "DEEPINFRA_API_KEY" },
  { id: "cerebras", name: "Cerebras", defaultBaseUrl: "https://api.cerebras.ai/v1", apiKeyHint: "CEREBRAS_API_KEY" },
  { id: "cohere", name: "Cohere", defaultBaseUrl: "https://api.cohere.ai/v2", apiKeyHint: "COHERE_API_KEY" },
  { id: "togetherai", name: "Together AI", defaultBaseUrl: "https://api.together.xyz/v1", apiKeyHint: "TOGETHER_API_KEY" },
  { id: "perplexity", name: "Perplexity", defaultBaseUrl: "https://api.perplexity.ai", apiKeyHint: "PPLX_API_KEY" },
  { id: "vercel", name: "Vercel AI Gateway", defaultBaseUrl: "", apiKeyHint: "VERCEL_API_KEY" },
  { id: "github-copilot", name: "GitHub Copilot", defaultBaseUrl: "", apiKeyHint: "Copilot auth" },
  { id: "azure-cognitive-services", name: "Azure Cognitive Services", defaultBaseUrl: "", apiKeyHint: "AZURE_API_KEY" },
  { id: "gitlab", name: "GitLab Duo", defaultBaseUrl: "", apiKeyHint: "GITLAB_TOKEN / gitlab auth" }
];

const PROVIDER_PRESET_NAME_BY_ID = Object.fromEntries(
  PROVIDER_PRESETS.map((preset) => [preset.id, preset.name])
) as Record<string, string>;

export function isPresetProviderId(providerId: string): boolean {
  const pid = (providerId || "").trim();
  if (!pid) return false;
  return PROVIDER_PRESETS.some((preset) => preset.id === pid);
}

export function getProviderDisplayName(
  providerId: string,
  providerNames: Record<string, string>
): string {
  const normalizedProviderId = providerId.trim();
  return providerNames[normalizedProviderId] || PROVIDER_PRESET_NAME_BY_ID[normalizedProviderId] || normalizedProviderId;
}

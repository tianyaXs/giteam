import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PanelPlacement } from "./layout/Workbench";
import { Workbench } from "./layout/Workbench";
import { explainCommit, explainCommitShort, getEntireStatusDetailed } from "./lib/entireAdapter";
import { parseExplainCommit } from "./lib/explainParser";
import {
  getBranchCommits,
  getCommitChangedFiles,
  getCommitFilePatch,
  getCommitGraph,
  getLocalBranches,
  gitPull,
  gitPush
} from "./lib/gitAdapter";
import { runReviewForCommit } from "./lib/reviewOrchestrator";
import {
  addRepository,
  listRepositories,
  loadReviewActions,
  loadReviewRecords,
  pickRepositoryFolder,
  removeRepository,
  saveReviewAction,
  saveReviewRecord
} from "./lib/storage";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitGraphNode,
  RepositoryEntry,
  ReviewAction,
  ReviewActionType,
  ReviewRecord
} from "./lib/types";

type DetailTab = "diff" | "context" | "findings";
type Theme = "dark" | "light";
type DiffRowKind = "meta" | "add" | "del" | "ctx";
type DiffRow = { kind: DiffRowKind; left: string; right: string };
type StatusSession = { title: string; quote?: string; meta?: string };
type ParsedStatus = { headline?: string; project?: string; sessions: StatusSession[] };
type TranscriptMessage = { role: "User" | "Assistant"; content: string };
type ParsedAgentContext = {
  checkpoint?: string;
  session?: string;
  created?: string;
  author?: string;
  commits?: string;
  intent?: string;
  outcome?: string;
  filesRaw?: string;
  files: string[];
  transcript: TranscriptMessage[];
};
type RuntimeDependencyStatus = {
  name: string;
  checked: boolean;
  installed: boolean;
  path?: string;
  version?: string;
  installHint: string;
};
type RuntimeRequirementsStatus = {
  platform: string;
  homebrewInstalled: boolean;
  git: RuntimeDependencyStatus;
  entire: RuntimeDependencyStatus;
  opencode: RuntimeDependencyStatus;
};
type RuntimeActionJobStatus = {
  jobId: string;
  name: string;
  action: "install" | "uninstall";
  status: "running" | "succeeded" | "failed";
  log: string;
  startedAtMs: number;
  finishedAtMs?: number;
  exitCode?: number;
  error?: string;
};
type OpencodeModelConfig = {
  configPath: string;
  configuredModel: string;
  exists: boolean;
};
type OpencodeProviderConfig = {
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
type OpencodeCatalogProvider = {
  id: string;
  name: string;
  models: string[];
};
type OpencodeConfigProviderCatalog = {
  id: string;
  name: string;
  npm: string;
  models: string[];
};
type OpencodeServerProviderCatalog = {
  id: string;
  name: string;
  models: string[];
  modelNames?: Record<string, string>;
};
type OpencodeServerProviderState = {
  providers: OpencodeServerProviderCatalog[];
  connected: string[];
};

type OpencodeServerConfigProvider = {
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
type OpencodeServerConfig = {
  provider?: Record<string, OpencodeServerConfigProvider>;
  disabled_providers?: string[];
  model?: string;
} & Record<string, unknown>;

type OpencodeAuthPayload = { type: "api"; key: string };
type OpencodeProviderAuthMethod = { type: string; label?: string };
type OpencodeChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};
type OpencodeChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: OpencodeChatMessage[];
  visibleCount: number;
  loaded: boolean;
};
type OpencodeStreamEvent = {
  requestId: string;
  kind: string;
  text: string;
};
type OpencodeSessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};
type OpencodeSessionMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};
type OpencodeDetailedPart = Record<string, unknown> & { type?: string };
type OpencodeDetailedMessage = {
  info?: Record<string, unknown>;
  parts?: OpencodeDetailedPart[];
};
type OnboardingStep = {
  title: string;
  body: string;
};

const ONBOARDING_DONE_KEY = "giteam.onboarding.done.v1";
const RUNTIME_FIRST_CHECK_KEY = "giteam.runtime.first-check.v1";
const RUNTIME_STATUS_CACHE_KEY = "giteam.runtime.status.v1";
const SIDEBAR_WIDTH_CACHE_KEY = "giteam.layout.sidebar.width.v1";
const RIGHT_PANE_WIDTH_CACHE_KEY = "giteam.layout.right.width.v1";
const OPENCODE_SAVED_MODELS_KEY = "giteam.opencode.saved-models.v1";
const OPENCODE_MODEL_VIS_KEY = "giteam.opencode.model-visibility.v1";
const OPENCODE_MODEL_SELECTION_KEY = "giteam.opencode.model-selection.v1";
const OPENCODE_PAGE_SIZE = 24;
const OPENCODE_RECENT_VISIBLE = 2;
const OPENCODE_SESSION_TITLE_MAX = 42;

const EMPTY_DEP = (name: "git" | "entire" | "opencode", installHint: string): RuntimeDependencyStatus => ({
  name,
  checked: false,
  installed: false,
  path: undefined,
  version: undefined,
  installHint
});

const DEFAULT_RUNTIME_STATUS: RuntimeRequirementsStatus = {
  platform: "macos",
  homebrewInstalled: false,
  git: EMPTY_DEP("git", "brew install git"),
  entire: EMPTY_DEP("entire", "brew tap entireio/tap && brew install entireio/tap/entire"),
  opencode: EMPTY_DEP("opencode", "brew install anomalyco/tap/opencode")
};

function loadCachedRuntimeStatus(): RuntimeRequirementsStatus {
  try {
    const raw = window.localStorage.getItem(RUNTIME_STATUS_CACHE_KEY);
    if (!raw) return DEFAULT_RUNTIME_STATUS;
    const parsed = JSON.parse(raw) as Partial<RuntimeRequirementsStatus>;
    return {
      platform: parsed.platform || DEFAULT_RUNTIME_STATUS.platform,
      homebrewInstalled: Boolean(parsed.homebrewInstalled),
      git: parsed.git ? { ...DEFAULT_RUNTIME_STATUS.git, ...parsed.git } : DEFAULT_RUNTIME_STATUS.git,
      entire: parsed.entire ? { ...DEFAULT_RUNTIME_STATUS.entire, ...parsed.entire } : DEFAULT_RUNTIME_STATUS.entire,
      opencode: parsed.opencode ? { ...DEFAULT_RUNTIME_STATUS.opencode, ...parsed.opencode } : DEFAULT_RUNTIME_STATUS.opencode
    };
  } catch {
    return DEFAULT_RUNTIME_STATUS;
  }
}

function loadCachedWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  } catch {
    return fallback;
  }
}

function makeId(): string {
  return Math.random().toString(16).slice(2, 14);
}

function opencodeSavedModelsStorageKey(): string {
  return OPENCODE_SAVED_MODELS_KEY;
}

function normalizeModelRef(input: string): string {
  const model = (input || "").trim();
  if (!model) return "";
  const idx = model.indexOf("/");
  if (idx <= 0 || idx >= model.length - 1) return "";
  const provider = model.slice(0, idx).trim();
  const modelId = model.slice(idx + 1).trim();
  if (!provider || !modelId) return "";
  return `${provider}/${modelId}`;
}

function parseModelRef(input: string): { provider: string; model: string } | null {
  const full = normalizeModelRef(input);
  if (!full) return null;
  const idx = full.indexOf("/");
  return {
    provider: full.slice(0, idx),
    model: full.slice(idx + 1)
  };
}

/** Config keys that share the same resolved provider + model id (hide/disable stays consistent across refs). */
function expandConfiguredModelRefVariants(
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

function hiddenCoversConfiguredModelRef(
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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toOpencodeSessionTitle(prompt?: string, indexHint?: number): string {
  const trimmed = (prompt || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return `New Session ${indexHint ?? ""}`.trim();
  return trimmed.length > OPENCODE_SESSION_TITLE_MAX ? `${trimmed.slice(0, OPENCODE_SESSION_TITLE_MAX - 1)}…` : trimmed;
}

function newOpencodeSession(seedPrompt?: string, indexHint?: number): OpencodeChatSession {
  const now = Date.now();
  return {
    id: `sess-${makeId()}`,
    title: toOpencodeSessionTitle(seedPrompt, indexHint),
    createdAt: now,
    updatedAt: now,
    messages: [],
    visibleCount: OPENCODE_RECENT_VISIBLE,
    loaded: true
  };
}

function opencodeSessionFromSummary(summary: OpencodeSessionSummary, indexHint?: number): OpencodeChatSession {
  return {
    id: summary.id,
    title: summary.title || `Session ${indexHint ?? ""}`.trim(),
    createdAt: summary.createdAt || Date.now(),
    updatedAt: summary.updatedAt || summary.createdAt || Date.now(),
    messages: [],
    visibleCount: OPENCODE_RECENT_VISIBLE,
    loaded: false
  };
}

function firstLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function toDiffRows(patch: string): DiffRow[] {
  if (!patch.trim()) return [];
  const rows: DiffRow[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("@@")) {
      rows.push({ kind: "meta", left: line, right: line });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      rows.push({ kind: "meta", left: line, right: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", left: "", right: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", left: line.slice(1), right: "" });
      continue;
    }
    rows.push({
      kind: "ctx",
      left: line.startsWith(" ") ? line.slice(1) : line,
      right: line.startsWith(" ") ? line.slice(1) : line
    });
  }
  return rows;
}

function parseOpencodeList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of (raw || "").split("\n")) {
    const cleaned = line
      .trim()
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "");
    if (!cleaned) continue;
    if (cleaned.startsWith("(") && cleaned.endsWith(")")) continue;
    if (cleaned.startsWith("Error:")) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function parseOpencodeCatalog(raw: string): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const line of (raw || "").split("\n")) {
    const cleaned = line.trim();
    if (!cleaned || cleaned.startsWith("Error:")) continue;
    const idx = cleaned.indexOf("/");
    if (idx <= 0 || idx === cleaned.length - 1) continue;
    const provider = cleaned.slice(0, idx).trim();
    const model = cleaned.slice(idx + 1).trim();
    if (!provider || !model) continue;
    const list = grouped[provider] ?? [];
    if (!list.includes(model)) list.push(model);
    grouped[provider] = list;
  }
  return grouped;
}

function extractOpencodeText(raw: string): string {
  // Keep formatting exactly as emitted (newlines/blank lines matter for Markdown).
  const lines = (raw || "").split("\n");
  const chunks: string[] = [];
  let sawJson = false;
  for (const line of lines) {
    try {
      const item = JSON.parse(line.trim()) as { type?: string; text?: string; part?: { text?: string } };
      sawJson = true;
      if (item?.type === "text") {
        const text = item.part?.text ?? item.text ?? "";
        if (text) chunks.push(text);
      }
    } catch {
      // keep parsing others
    }
  }
  if (chunks.length > 0) return chunks.join("");
  // If this stream chunk is structured JSON (e.g. reasoning/tool/step events),
  // do NOT leak it into the visible assistant text.
  if (sawJson) return "";
  return raw || "";
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

function toDisplayJson(input: unknown, maxLen = 2400): string {
  try {
    const raw = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    if (!raw) return "";
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}\n…(truncated)` : raw;
  } catch {
    return String(input ?? "");
  }
}

function applyOpencodeCatalog(
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

function defaultProviderBaseUrl(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p === "openai") return "https://api.openai.com/v1";
  if (p === "anthropic") return "https://api.anthropic.com/v1";
  if (p === "openrouter") return "https://openrouter.ai/api/v1";
  if (p === "google") return "https://generativelanguage.googleapis.com/v1beta";
  if (p === "xai") return "https://api.x.ai/v1";
  if (p === "deepseek") return "https://api.deepseek.com/v1";
  if (p === "mistral") return "https://api.mistral.ai/v1";
  if (p === "groq") return "https://api.groq.com/openai/v1";
  if (p === "azure") return "https://{resource}.openai.azure.com/openai";
  if (p === "azure-cognitive-services") return "https://{resource}.cognitiveservices.azure.com/openai";
  return "";
}

function normalizeProviderId(input: string): string {
  return (input || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveProviderAlias(provider: string, catalog: Record<string, string[]>): string {
  if (!provider) return provider;
  const norm = normalizeProviderId(provider);
  if (!norm) return provider;
  const matches = Object.keys(catalog).filter((k) => normalizeProviderId(k) === norm);
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
      const bestClean = normalizeProviderId(best) === best;
      const curClean = normalizeProviderId(id) === id;
      if (curClean && !bestClean) best = id;
    }
  }
  return best;
}

function resolveProviderAliasWithNames(
  provider: string,
  catalog: Record<string, string[]>,
  providerNames: Record<string, string>
): string {
  const byId = resolveProviderAlias(provider, catalog);
  if (byId && ((catalog[byId] || []).length > 0 || !provider)) return byId;
  const norm = normalizeProviderId(provider);
  if (!norm) return provider;
  const byName = Object.keys(providerNames).find((id) => normalizeProviderId(providerNames[id] || "") === norm);
  if (!byName) return provider;
  return resolveProviderAlias(byName, catalog);
}

type ProviderPreset = {
  id: string;
  name: string;
  defaultBaseUrl: string;
  apiKeyHint: string;
};

type ProviderOptionField = {
  key: keyof OpencodeProviderConfig;
  placeholder: string;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
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

function providerOptionFields(provider: string): ProviderOptionField[] {
  const p = provider.trim().toLowerCase();
  if (p === "amazon-bedrock") {
    return [
      { key: "region", placeholder: "region (e.g. us-east-1)" },
      { key: "profile", placeholder: "profile (optional)" },
      { key: "endpoint", placeholder: "endpoint (optional)" }
    ];
  }
  if (p === "google-vertex" || p === "google-vertex-anthropic") {
    return [
      { key: "project", placeholder: "project (required for vertex)" },
      { key: "location", placeholder: "location (e.g. us-central1/global)" }
    ];
  }
  if (p === "azure") {
    return [{ key: "resourceName", placeholder: "resourceName (optional)" }];
  }
  if (p === "azure-cognitive-services") {
    return [{ key: "resourceName", placeholder: "resourceName (AZURE_COGNITIVE_SERVICES_RESOURCE_NAME)" }];
  }
  if (p === "github-copilot") {
    return [{ key: "enterpriseUrl", placeholder: "enterpriseUrl (GitHub Enterprise optional)" }];
  }
  return [];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(`[^`\n]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    if (start > last) {
      nodes.push(text.slice(last, start));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`code-${i++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const split = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (split) {
        nodes.push(
          <a key={`link-${i++}`} href={split[2]} target="_blank" rel="noreferrer">
            {split[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`strong-${i++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(<del key={`del-${i++}`}>{token.slice(2, -2)}</del>);
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      nodes.push(<em key={`em-${i++}`}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    last = start + token.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes.length > 0 ? nodes : [text];
}

function MarkdownLite(props: { source: string }) {
  const text = props.source.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  if (!text) return <p className="muted">等待上下文加载...</p>;

  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre key={`pre-${key++}`} className="md-code">
          {lang ? <span className="md-code-lang">{lang}</span> : null}
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      const cls = `md-h${level}`;
      blocks.push(
        <p key={`h-${key++}`} className={cls}>
          {renderInlineMarkdown(heading[2])}
        </p>
      );
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`q-${key++}`} className="md-quote">
          {quoteLines.map((q, idx) => (
            <p key={`qp-${idx}`}>{renderInlineMarkdown(q)}</p>
          ))}
        </blockquote>
      );
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`ul-${key++}`} className="md-list">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={`ol-${key++}`} className="md-list">
          {items.map((item, idx) => (
            <li key={`oli-${idx}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${key++}`} className="md-p">
        {renderInlineMarkdown(para.join(" "))}
      </p>
    );
  }
  return <div className="markdown-lite">{blocks}</div>;
}

function parseStatusText(raw: string): ParsedStatus {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: ParsedStatus = { sessions: [] };
  out.headline = lines.find((l) => l.startsWith("●")) ?? undefined;
  out.project = lines.find((l) => l.startsWith("Project")) ?? undefined;

  const activeIdx = lines.findIndex((l) => /Active Sessions/i.test(l));
  if (activeIdx >= 0) {
    const sessionLines = lines.slice(activeIdx + 1);
    let current: StatusSession | null = null;
    const uuidLike = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    for (const line of sessionLines) {
      if (uuidLike.test(line)) {
        if (current) out.sessions.push(current);
        current = { title: line };
        continue;
      }
      if (!current) continue;
      if (line.startsWith(">")) {
        current.quote = line.replace(/^>\s*/, "").replace(/^"|"$/g, "");
      } else if (/started|active|tokens/i.test(line)) {
        current.meta = line;
      }
    }
    if (current) out.sessions.push(current);
  }
  return out;
}

function pickSegment(raw: string, label: string, nextLabels: string[]): string | undefined {
  const start = raw.indexOf(`${label}:`);
  if (start < 0) return undefined;
  const from = start + label.length + 1;
  let end = raw.length;
  for (const n of nextLabels) {
    const idx = raw.indexOf(`${n}:`, from);
    if (idx >= 0 && idx < end) end = idx;
  }
  return raw.slice(from, end).trim() || undefined;
}

function parseTranscript(raw: string): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  const source = raw.replace(/\r\n/g, "\n");
  const marker = /(?:^|\n)\s*(?:\[(User|Assistant)\]|(User|Assistant)\s*:)\s*/gi;
  const matches = [...source.matchAll(marker)];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const roleRaw = (m[1] || m[2] || "").toLowerCase();
    const role: "User" | "Assistant" = roleRaw === "user" ? "User" : "Assistant";
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length;
    const content = source.slice(start, end).trim();
    if (content) out.push({ role, content });
  }
  return out;
}

function parseAgentContextText(raw: string): ParsedAgentContext {
  const lines = raw.split("\n");
  const header = lines.find((l) => /Checkpoint:|Session:|Created:|Author:/i.test(l)) ?? "";
  const field = (name: string) => {
    const labels = ["Checkpoint", "Session", "Created", "Author"];
    const idx = header.indexOf(`${name}:`);
    if (idx < 0) return undefined;
    const from = idx + name.length + 1;
    let end = header.length;
    for (const l of labels) {
      if (l === name) continue;
      const p = header.indexOf(`${l}:`, from);
      if (p >= 0 && p < end) end = p;
    }
    return header.slice(from, end).trim() || undefined;
  };

  const commits = pickSegment(raw, "Commits", ["Intent", "Outcome", "Files", "Transcript (checkpoint scope)"]);
  const intent = pickSegment(raw, "Intent", ["Outcome", "Files", "Transcript (checkpoint scope)"]);
  const outcome = pickSegment(raw, "Outcome", ["Files", "Transcript (checkpoint scope)"]);
  const filesSeg = pickSegment(raw, "Files", ["Transcript (checkpoint scope)"]) ?? "";
  const filesRaw = filesSeg.trim();
  const transcriptSeg = pickSegment(raw, "Transcript (checkpoint scope)", []) ?? "";
  const files = filesSeg
    .split("\n")
    .map((l) => l.replace(/^\(\d+\)\s*/, "").replace(/^-\s*/, "").trim())
    .filter((l) => l && !/^\(\d+\)$/.test(l) && !/^\(\d+\)\s*$/.test(l) && !/^Files?$/i.test(l));

  return {
    checkpoint: field("Checkpoint"),
    session: field("Session"),
    created: field("Created"),
    author: field("Author"),
    commits,
    intent,
    outcome,
    filesRaw,
    files,
    transcript: parseTranscript(transcriptSeg)
  };
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const value = window.localStorage.getItem("giteam.theme");
    return value === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("giteam.theme", theme);
    void invoke("set_window_theme", { theme }).catch(() => {
      // Ignore if running outside Tauri runtime.
    });
  }, [theme]);

  return [theme, () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))];
}

function parseRefs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const inner = trimmed.startsWith("(") && trimmed.endsWith(")")
    ? trimmed.slice(1, -1)
    : trimmed;
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function branchFromRef(ref: string, branches: GitBranchSummary[]): string | null {
  const r = ref.trim();
  if (!r) return null;
  if (r.startsWith("tag:")) return null;
  if (r.includes("->")) {
    const rhs = r.split("->")[1]?.trim();
    if (rhs && branches.some((b) => b.name === rhs)) return rhs;
    return null;
  }
  if (branches.some((b) => b.name === r)) return r;
  return null;
}

type LaneLayoutRow = {
  sha: string;
  parents: string[];
  col: number;
  colorIdx: number;
};

const LANE_COLORS = [
  "#F6C445", // yellow
  "#8A5CF6", // purple
  "#2DD4BF", // teal
  "#60A5FA", // blue
  "#FB7185", // pink
  "#34D399", // green
  "#F97316" // orange
];

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length];
}

type LaneSnapshot = Array<{ sha: string; colorIdx: number }>;
type LaneLayout = {
  rows: LaneLayoutRow[];
  // Lanes before applying row's commit->parents transition.
  before: LaneSnapshot[];
  // Lanes after applying row's commit->parents transition (used for edges to next row).
  after: LaneSnapshot[];
  maxLanes: number;
};

function computeLaneLayout(rows: GitGraphNode[]): LaneLayout {
  const commits = rows.filter((r) => !r.isConnector && !!r.sha);
  const remaining = new Set(commits.map((c) => c.sha));

  const lanes: Array<{ sha: string; colorIdx: number }> = [];
  let nextColor = 0;

  const outRows: LaneLayoutRow[] = [];
  const before: LaneSnapshot[] = [];
  const after: LaneSnapshot[] = [];
  let maxLanes = 0;

  for (const c of commits) {
    remaining.delete(c.sha);

    // Snapshot BEFORE mutation: used for rails at this row and to locate current commit lane.
    before.push(lanes.map((l) => ({ sha: l.sha, colorIdx: l.colorIdx })));
    maxLanes = Math.max(maxLanes, lanes.length);

    let col = lanes.findIndex((l) => l.sha === c.sha);
    if (col < 0) {
      // Append new lanes at the end to keep layout stable (less "jumping").
      lanes.push({ sha: c.sha, colorIdx: nextColor++ });
      col = lanes.length - 1;
    }

    const colorIdx = lanes[col]?.colorIdx ?? 0;
    outRows.push({ sha: c.sha, parents: c.parents ?? [], col, colorIdx });

    // Update lanes for next rows:
    // - Keep the same lane/color when flowing into first parent.
    // - Allocate new lanes/colors for secondary parents (merge).
    const parents = (c.parents ?? []).filter(Boolean);
    if (parents.length === 0) {
      lanes.splice(col, 1);
    } else {
      lanes[col] = { sha: parents[0], colorIdx };
      for (let i = 1; i < parents.length; i += 1) {
        lanes.splice(col + i, 0, { sha: parents[i], colorIdx: nextColor++ });
      }
    }

    // Drop lanes that will never appear again (keeps graph compact but not jumpy).
    for (let i = lanes.length - 1; i >= 0; i -= 1) {
      const s = lanes[i]?.sha ?? "";
      if (!remaining.has(s)) lanes.splice(i, 1);
    }

    // Snapshot AFTER mutation: used to draw edges from this row to the next row.
    after.push(lanes.map((l) => ({ sha: l.sha, colorIdx: l.colorIdx })));
    maxLanes = Math.max(maxLanes, lanes.length);
  }

  return { rows: outRows, before, after, maxLanes };
}

function BranchGraphLanes(props: {
  rows: GitGraphNode[];
  rowHeight: number;
  laneGap: number;
  selectedSha: string;
}) {
  const commits = props.rows.filter((r) => !r.isConnector && !!r.sha);
  const layout = useMemo(() => computeLaneLayout(commits), [commits]);
  const rowH = props.rowHeight;
  const laneAreaW = 140; // keep in sync with CSS placeholder width
  const maxCol = Math.max(0, ...layout.rows.map((r) => r.col));
  const laneCount = Math.max(1, maxCol + 1);
  // Always fit lanes into the left gutter so it never overlaps text.
  const laneGap = Math.max(8, Math.floor((laneAreaW - 20) / laneCount));

  const width = laneAreaW;
  const height = Math.max(1, commits.length * rowH);

  // Edges should be drawn as local transitions between adjacent rows:
  // commit at row i connects to its parent lanes at row i+1 (after snapshot).
  // To reduce visual noise (match VSCode/gitk), we only draw:
  // - first-parent edge when it changes columns
  // - merge edges (2nd+ parent) always
  const edges: Array<{ d: string; colorIdx: number; kind: "first" | "merge"; toX: number; toY: number }> = [];
  layout.rows.forEach((r, rowIdx) => {
    const fromX = r.col * laneGap + 10;
    const fromY = rowIdx * rowH + rowH / 2;
    const next = layout.after[rowIdx] ?? [];
    const parents = (r.parents ?? []).filter(Boolean);
    parents.forEach((p, i) => {
      const toCol = next.findIndex((l) => l.sha === p);
      if (toCol < 0) return;
      const toX = toCol * laneGap + 10;
      const toY = (rowIdx + 1) * rowH + rowH / 2;
      const kind: "first" | "merge" = i === 0 ? "first" : "merge";
      if (kind === "first" && toCol === r.col) {
        // Vertical continuation is already implied by rails; don't draw extra curve.
        return;
      }
      const dx = toX - fromX;
      // Softer, more "gitk-like" curves.
      const c1x = fromX + dx * 0.35;
      const c2x = toX - dx * 0.35;
      const c1y = fromY + rowH * 0.55;
      const c2y = toY - rowH * 0.55;
      const d = `M ${fromX} ${fromY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${toX} ${toY}`;
      edges.push({ d, colorIdx: r.colorIdx, kind, toX, toY });
    });
  });

  return (
    <svg className="branch-lanes" width={width} height={height} aria-hidden="true">
      <g className="branch-lanes-rails">
        {layout.before.slice(0, commits.length).map((snap, rowIdx) => {
          const y0 = rowIdx * rowH;
          return snap.map((l, colIdx) => {
            const x = colIdx * laneGap + 10;
            return (
              <line
                key={`rail-${rowIdx}-${colIdx}-${l.sha}`}
                x1={x}
                y1={y0}
                x2={x}
                y2={y0 + rowH}
                style={{ stroke: laneColor(l.colorIdx), opacity: 0.18, strokeWidth: 2 }}
              />
            );
          });
        })}
      </g>
      <g className="branch-lanes-edges">
        {edges.map((e, idx) => {
          const color = laneColor(e.colorIdx);
          return (
            <path
              key={`e-${idx}`}
              d={e.d}
              fill="none"
              style={{
                stroke: color,
                opacity: e.kind === "merge" ? 0.3 : 0.85,
                strokeWidth: e.kind === "merge" ? 1.5 : 2.4
              }}
            />
          );
        })}
      </g>
      <g className="branch-lanes-junctions">
        {edges.map((e, idx) => {
          const color = laneColor(e.colorIdx);
          const r = e.kind === "merge" ? 2.8 : 3.2;
          return (
            <circle
              key={`j-${idx}`}
              cx={e.toX}
              cy={e.toY}
              r={r}
              style={{
                fill: color,
                opacity: e.kind === "merge" ? 0.55 : 0.75
              }}
            />
          );
        })}
      </g>
      <g className="branch-lanes-nodes">
        {layout.rows.map((r, idx) => {
          const x = r.col * laneGap + 10;
          const y = idx * rowH + rowH / 2;
          const color = laneColor(r.colorIdx);
          const selected = props.selectedSha === r.sha;
          return (
            <circle
              key={`n-${r.sha}`}
              cx={x}
              cy={y}
              r={selected ? 6 : 5}
              style={{
                stroke: color,
                fill: color,
                strokeWidth: selected ? 2.5 : 2
              }}
            />
          );
        })}
      </g>
    </svg>
  );
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [panelPlacement, setPanelPlacement] = useState<PanelPlacement>("hidden");
  const [showSettings, setShowSettings] = useState(false);
  const [showGraphPopover, setShowGraphPopover] = useState(false);
  const [showEnvSetup, setShowEnvSetup] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadCachedWidth(SIDEBAR_WIDTH_CACHE_KEY, 320, 240, 520));
  const [rightPaneWidth, setRightPaneWidth] = useState(() => loadCachedWidth(RIGHT_PANE_WIDTH_CACHE_KEY, 340, 300, 680));
  const [draggingSplit, setDraggingSplit] = useState<null | {
    kind: "sidebar" | "right";
    startX: number;
    startWidth: number;
  }>(null);
  const [repoContextMenu, setRepoContextMenu] = useState<{ x: number; y: number; repo: RepositoryEntry } | null>(null);
  const [commitContextMenu, setCommitContextMenu] = useState<{ x: number; y: number; sha: string } | null>(null);

  // Panel is fused into the center reading area.

  const [repos, setRepos] = useState<RepositoryEntry[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepositoryEntry | null>(null);

  const [branches, setBranches] = useState<GitBranchSummary[]>([]);
  const [commitGraph, setCommitGraph] = useState<GitGraphNode[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [selectedCommit, setSelectedCommit] = useState("");

  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [selectedFilePatch, setSelectedFilePatch] = useState("");
  const [selectedExplain, setSelectedExplain] = useState("");
  const [agentContextError, setAgentContextError] = useState("");
  const [statusText, setStatusText] = useState("");

  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [actions, setActions] = useState<ReviewAction[]>([]);

  const [detailTab, setDetailTab] = useState<DetailTab>("diff");
  const [busy, setBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [runtimeChecking, setRuntimeChecking] = useState(false);
  const [checkingDeps, setCheckingDeps] = useState<Record<"git" | "entire" | "opencode", boolean>>({
    git: false,
    entire: false,
    opencode: false
  });
  const [installingDep, setInstallingDep] = useState("");
  const [installingElapsed, setInstallingElapsed] = useState(0);
  const [runtimeJobId, setRuntimeJobId] = useState("");
  const [runtimeJob, setRuntimeJob] = useState<RuntimeActionJobStatus | null>(null);
  const [expandedLogDep, setExpandedLogDep] = useState<"git" | "entire" | "opencode" | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeRequirementsStatus>(() => loadCachedRuntimeStatus());
  const [runtimeInstallLog, setRuntimeInstallLog] = useState("");
  const [opencodeProviders, setOpencodeProviders] = useState<string[]>([]);
  const [opencodeConnectedProviders, setOpencodeConnectedProviders] = useState<string[]>([]);
  const [opencodeConfiguredProviders, setOpencodeConfiguredProviders] = useState<string[]>([]);
  const [opencodeProviderNames, setOpencodeProviderNames] = useState<Record<string, string>>({});
  const [opencodeModelsByProvider, setOpencodeModelsByProvider] = useState<Record<string, string[]>>({});
  const [opencodeModelNamesByProvider, setOpencodeModelNamesByProvider] = useState<Record<string, Record<string, string>>>({});
  const [opencodeConfiguredModelsByProvider, setOpencodeConfiguredModelsByProvider] = useState<Record<string, string[]>>({});
  const [opencodeConfiguredModelNamesByProvider, setOpencodeConfiguredModelNamesByProvider] = useState<Record<string, Record<string, string>>>({});
  const [opencodeCatalogLoading, setOpencodeCatalogLoading] = useState(false);
  const [opencodeModelProvider, setOpencodeModelProvider] = useState("");
  const [opencodeSelectedModel, setOpencodeSelectedModel] = useState("");
  const [opencodeSavedModels, setOpencodeSavedModels] = useState<string[]>([]);
  const [showOpencodeModelPicker, setShowOpencodeModelPicker] = useState(false);
  const [opencodeModelPickerSearch, setOpencodeModelPickerSearch] = useState("");
  const [showOpencodeProviderPicker, setShowOpencodeProviderPicker] = useState(false);
  const [opencodeProviderPickerSearch, setOpencodeProviderPickerSearch] = useState("");
  const [opencodeProviderPickerProvider, setOpencodeProviderPickerProvider] = useState("");
  const [opencodeProviderPickerModelSearch, setOpencodeProviderPickerModelSearch] = useState("");
  const [showOpencodeCustomProvider, setShowOpencodeCustomProvider] = useState(false);
  const [opencodeConnectProviderId, setOpencodeConnectProviderId] = useState("");
  const [opencodeConnectProviderName, setOpencodeConnectProviderName] = useState("");
  const [opencodeConnectApiKey, setOpencodeConnectApiKey] = useState("");
  const [opencodeConnectBusy, setOpencodeConnectBusy] = useState(false);
  const [opencodeProviderAuthCache, setOpencodeProviderAuthCache] = useState<Record<string, OpencodeProviderAuthMethod[]>>({});
  const [opencodeHiddenModels, setOpencodeHiddenModels] = useState<Set<string>>(() => new Set());
  const [opencodeDraftModel, setOpencodeDraftModel] = useState("");
  const [opencodeSessionModel, setOpencodeSessionModel] = useState<Record<string, string>>({});
  const [opencodeCustomProviderDraft, setOpencodeCustomProviderDraft] = useState("");
  const [opencodeConfig, setOpencodeConfig] = useState<OpencodeModelConfig | null>(null);
  const [opencodeConfigBusy, setOpencodeConfigBusy] = useState(false);
  const [opencodeProviderConfigBusy, setOpencodeProviderConfigBusy] = useState(false);
  const [showModelManager, setShowModelManager] = useState(false);
  const [modelManagerSearch, setModelManagerSearch] = useState("");
  const [showProviderAdvanced, setShowProviderAdvanced] = useState(false);
  const [opencodeTestBusy, setOpencodeTestBusy] = useState(false);
  const [opencodeTestResult, setOpencodeTestResult] = useState("");
  const [opencodePromptInput, setOpencodePromptInput] = useState("");
  const [opencodeRunBusy, setOpencodeRunBusy] = useState(false);
  const [opencodeStreamingAssistantId, setOpencodeStreamingAssistantId] = useState("");
  const [opencodeSessions, setOpencodeSessions] = useState<OpencodeChatSession[]>([]);
  const [activeOpencodeSessionId, setActiveOpencodeSessionId] = useState("");
  const [showOpencodeSessionRail, setShowOpencodeSessionRail] = useState(true);
  const [showOpencodeDebugLog, setShowOpencodeDebugLog] = useState(false);
  const [opencodeDebugLogs, setOpencodeDebugLogs] = useState<string[]>([]);
  const [opencodeThinkingLines, setOpencodeThinkingLines] = useState<string[]>([]);
  const [opencodeThinkingReadCount, setOpencodeThinkingReadCount] = useState(0);
  const [opencodeThinkingSearchCount, setOpencodeThinkingSearchCount] = useState(0);
  const [opencodeTraceEventsByServerMessageId, setOpencodeTraceEventsByServerMessageId] = useState<Record<string, string[]>>({});
  const [opencodeServerMessageIdByLocalId, setOpencodeServerMessageIdByLocalId] = useState<Record<string, string>>({});
  const [opencodeExploreTaskByServerMessageId, setOpencodeExploreTaskByServerMessageId] = useState<Record<string, unknown>>({});
  const [opencodeExpandedDetailMessageId, setOpencodeExpandedDetailMessageId] = useState("");
  const [opencodeDetailsLoadingByMessageId, setOpencodeDetailsLoadingByMessageId] = useState<Record<string, boolean>>({});
  const [opencodeDetailsErrorByMessageId, setOpencodeDetailsErrorByMessageId] = useState<Record<string, string>>({});
  const [opencodeDetailsByMessageId, setOpencodeDetailsByMessageId] = useState<Record<string, OpencodeDetailedMessage | null>>({});
  const opencodeThreadRef = useRef<HTMLDivElement | null>(null);
  const opencodeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const opencodeModelPickerRef = useRef<HTMLDivElement | null>(null);
  const opencodePrevCountRef = useRef(0);
  const opencodeLoadingOlderRef = useRef(false);
  const opencodePrevScrollHeightRef = useRef(0);
  const [opencodeProviderConfig, setOpencodeProviderConfig] = useState<OpencodeProviderConfig>({
    provider: "",
    npm: "",
    name: "",
    baseUrl: "",
    apiKey: "",
    headers: {},
    endpoint: "",
    region: "",
    profile: "",
    project: "",
    location: "",
    resourceName: "",
    enterpriseUrl: "",
    timeout: "",
    chunkTimeout: ""
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Ready");

  const repoPath = selectedRepo?.path ?? "";
  const selectedParsed = selectedExplain ? parseExplainCommit(selectedExplain) : undefined;
  const parsedStatus = useMemo(() => parseStatusText(statusText || ""), [statusText]);
  const parsedAgentContext = useMemo(() => parseAgentContextText(selectedExplain || ""), [selectedExplain]);
  const selectedReview = useMemo(
    () => records.find((r) => r.commitSha === selectedCommit),
    [records, selectedCommit]
  );
  const diffRows = useMemo(() => toDiffRows(selectedFilePatch), [selectedFilePatch]);
  const runtimeLogTail = useMemo(() => {
    const lines = (runtimeInstallLog || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines[lines.length - 1] ?? "";
  }, [runtimeInstallLog]);

  const activeOpencodeSession = useMemo(() => {
    if (!activeOpencodeSessionId) return null;
    return opencodeSessions.find((s) => s.id === activeOpencodeSessionId) ?? null;
  }, [opencodeSessions, activeOpencodeSessionId]);
  const activeOpencodeModel = useMemo(() => {
    const sessionId = activeOpencodeSessionId.trim();
    const fromSession = sessionId ? normalizeModelRef(opencodeSessionModel[sessionId] || "") : "";
    if (fromSession) return fromSession;
    const fromDraft = normalizeModelRef(opencodeDraftModel || "");
    if (fromDraft) return fromDraft;
    const configured = normalizeModelRef(opencodeConfig?.configuredModel || "");
    if (configured) return configured;
    const recent = normalizeModelRef(opencodeSavedModels[0] || "");
    if (recent) return recent;
    for (const pid of opencodeConnectedProviders) {
      const models = opencodeModelsByProvider[pid] ?? [];
      const mid = models[0] || "";
      const full = normalizeModelRef(`${pid}/${mid}`);
      if (full) return full;
    }
    return "";
  }, [
    activeOpencodeSessionId,
    opencodeSessionModel,
    opencodeDraftModel,
    opencodeConfig?.configuredModel,
    opencodeSavedModels,
    opencodeConnectedProviders,
    opencodeModelsByProvider
  ]);
  const opencodeMessages = activeOpencodeSession?.messages ?? [];
  const opencodeVisibleCount = activeOpencodeSession?.visibleCount ?? OPENCODE_RECENT_VISIBLE;
  const selectableProviders = useMemo(() => {
    const connected = new Set(opencodeConnectedProviders.filter(Boolean));
    const out = new Set<string>();
    for (const id of opencodeConfiguredProviders) {
      if (id && connected.has(id)) out.add(id);
    }
    const cur = opencodeModelProvider.trim();
    if (cur && connected.has(cur)) out.add(cur);
    else if (cur && !PROVIDER_PRESETS.some((p) => p.id === cur)) out.add(cur);
    return Array.from(out).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [opencodeConfiguredProviders, opencodeConnectedProviders, opencodeModelProvider]);
  const visibleModels = useMemo(() => {
    const connKey = resolveProviderAliasWithNames(opencodeModelProvider, opencodeModelsByProvider, opencodeProviderNames);
    if (connKey && !opencodeConnectedProviders.includes(connKey)) return [];
    const cfgKey = resolveProviderAliasWithNames(
      opencodeModelProvider,
      opencodeConfiguredModelsByProvider,
      opencodeProviderNames
    );
    const pool = cfgKey ? (opencodeConfiguredModelsByProvider[cfgKey] ?? []) : [];
    const q = modelManagerSearch.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((m) => m.toLowerCase().includes(q));
  }, [
    modelManagerSearch,
    opencodeModelProvider,
    opencodeConfiguredModelsByProvider,
    opencodeProviderNames,
    opencodeConnectedProviders,
    opencodeModelsByProvider
  ]);
  const opencodeSavedModelCandidates = useMemo(() => {
    const q = opencodeModelPickerSearch.trim().toLowerCase();
    if (!q) return opencodeSavedModels;
    return opencodeSavedModels.filter((m) => m.toLowerCase().includes(q));
  }, [opencodeSavedModels, opencodeModelPickerSearch]);

  const opencodeConfiguredModelCandidates = useMemo(() => {
    // Match desired UX: picker shows only "enabled/added" models from server config (/global/config),
    // plus local visibility toggle (closed models are filtered out).
    const q = opencodeModelPickerSearch.trim().toLowerCase();
    const connected = new Set(opencodeConnectedProviders.filter(Boolean));
    const out: string[] = [];
    for (const pid of opencodeConfiguredProviders) {
      const resolvedProvider = resolveProviderAliasWithNames(pid, opencodeModelsByProvider, opencodeProviderNames) || pid;
      if (resolvedProvider && !connected.has(resolvedProvider)) continue;
      const models = opencodeConfiguredModelsByProvider[pid] ?? [];
      for (const mid of models) {
        const full = normalizeModelRef(`${pid}/${mid}`);
        if (!full) continue;
        if (opencodeHiddenModels.has(full)) continue;
        if (q) {
          const provider = resolveProviderAliasWithNames(pid, opencodeModelsByProvider, opencodeProviderNames) || pid;
          const name = (provider ? (opencodeConfiguredModelNamesByProvider[provider]?.[mid] || opencodeModelNamesByProvider[provider]?.[mid]) : "") || "";
          const hay = `${full} ${name}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push(full);
      }
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [
    opencodeConfiguredProviders,
    opencodeConfiguredModelsByProvider,
    opencodeModelPickerSearch,
    opencodeHiddenModels,
    opencodeConnectedProviders,
    opencodeConfiguredModelNamesByProvider,
    opencodeModelsByProvider,
    opencodeModelNamesByProvider,
    opencodeProviderNames
  ]);

  const opencodeProviderPickerCandidates = useMemo(() => {
    const q = opencodeProviderPickerSearch.trim().toLowerCase();
    // Provider list for enable/disable should be "all known providers":
    // - presets (static list)
    // - plus any providers discovered from server /provider (custom ones)
    const presetIds = PROVIDER_PRESETS.map((p) => p.id).filter(Boolean);
    const merged = Array.from(new Set([...presetIds, ...opencodeProviders].filter(Boolean)));
    merged.sort((a, b) => a.localeCompare(b));
    if (!q) return merged;
    return merged.filter((id) => {
      const name = opencodeProviderNames[id] || "";
      return id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });
  }, [opencodeProviders, opencodeProviderNames, opencodeProviderPickerSearch]);
  const onboardingSteps: OnboardingStep[] = [
    {
      title: "Step 1 · Import Project",
      body: "Click the + button in the left project rail, choose a local Git repository folder, and it will be imported immediately."
    },
    {
      title: "Step 2 · Browse Commits",
      body: "Select a branch and click a commit from the list. The app loads changed files and default diff automatically."
    },
    {
      title: "Step 3 · Read Context",
      body: "Use the Context tab to view Agent Context. Click 'Load full context' for full transcript when checkpoint data is available."
    },
    {
      title: "Step 4 · Sync Workflow",
      body: "Use Refresh / Pull / Push actions from the commit toolbar. Open Settings for theme/layout and runtime checks."
    }
  ];

  function beginSplitDrag(kind: "sidebar" | "right", clientX: number) {
    setDraggingSplit({
      kind,
      startX: clientX,
      startWidth: kind === "sidebar" ? sidebarWidth : rightPaneWidth
    });
  }

  function appendOpencodeDebugLog(text: string) {
    const stamp = new Date().toLocaleTimeString();
    setOpencodeDebugLogs((prev) => {
      const next = [...prev, `[${stamp}] ${text}`];
      if (next.length > 400) return next.slice(next.length - 400);
      return next;
    });
  }

  function resetOpencodeThinkingLogs() {
    setOpencodeThinkingLines([]);
    setOpencodeThinkingReadCount(0);
    setOpencodeThinkingSearchCount(0);
  }

  function appendOpencodeThinkingLine(raw: string) {
    const text = raw.trim();
    if (!text) return;
    setOpencodeThinkingLines((prev) => {
      if (prev[prev.length - 1] === text) return prev;
      const next = [...prev, text];
      return next.length > 48 ? next.slice(next.length - 48) : next;
    });
    const lower = text.toLowerCase();
    if (lower.startsWith("read ") || lower.includes(" read ")) {
      setOpencodeThinkingReadCount((n) => n + 1);
    } else if (
      lower.startsWith("find ") ||
      lower.startsWith("search ") ||
      lower.includes(" search") ||
      lower.includes("find ")
    ) {
      setOpencodeThinkingSearchCount((n) => n + 1);
    }
  }

  function pushOpencodeSavedModel(model: string) {
    const normalized = normalizeModelRef(model);
    if (!normalized) return;
    setOpencodeSavedModels((prev) => {
      const next = [normalized, ...prev.filter((m) => m !== normalized)].slice(0, 64);
      return next;
    });
  }

  async function applyOpencodeModel(model: string) {
    if (!ensureRepoSelected()) return;
    const normalized = normalizeModelRef(model);
    if (!normalized) {
      setMessage("Invalid model format, expected provider/model");
      return;
    }
    setOpencodeConfigBusy(true);
    try {
      const parsed = parseModelRef(normalized);
      // OpenCode-like: selecting a model updates local selection (session/draft) and recent list.
      // It does NOT write server /config.model unless explicitly requested elsewhere.
      const sid = activeOpencodeSessionId.trim();
      if (sid) {
        setOpencodeSessionModel((prev) => ({ ...prev, [sid]: normalized }));
      } else {
        setOpencodeDraftModel(normalized);
      }
      if (parsed) {
        ensureProviderExists(parsed.provider);
        setOpencodeModelProvider(parsed.provider);
        setOpencodeSelectedModel(parsed.model);
      }
      pushOpencodeSavedModel(normalized);
      setMessage(`Switched model: ${normalized}`);
    } catch (e) {
      setError(String(e));
      setMessage("Switch model failed");
    } finally {
      setOpencodeConfigBusy(false);
    }
  }

  function ensureActiveOpencodeSession(): string {
    const current = activeOpencodeSessionId;
    if (opencodeSessions.some((s) => s.id === current)) return current;
    const first = opencodeSessions[0];
    if (first) return first.id;
    return "";
  }

  function updateActiveOpencodeSession(
    updater: (session: OpencodeChatSession) => OpencodeChatSession
  ) {
    const id = ensureActiveOpencodeSession();
    setOpencodeSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }

  function updateOpencodeSessionById(sessionId: string, updater: (session: OpencodeChatSession) => OpencodeChatSession) {
    setOpencodeSessions((prev) => prev.map((s) => (s.id === sessionId ? updater(s) : s)));
  }

  async function refreshOpencodeSessions() {
    if (!ensureRepoSelected()) return;
    appendOpencodeDebugLog("session.list requested");
    const rows = await invoke<OpencodeSessionSummary[]>("list_opencode_sessions", { repoPath, limit: 64 });
    if (!rows || rows.length === 0) {
      appendOpencodeDebugLog("session.list empty, creating first session");
      const created = await invoke<OpencodeSessionSummary>("create_opencode_session", { repoPath });
      const next = [opencodeSessionFromSummary(created, 1)];
      setOpencodeSessions(next);
      setActiveOpencodeSessionId(created.id);
      appendOpencodeDebugLog(`session.created ${created.id}`);
      return;
    }
    appendOpencodeDebugLog(`session.list loaded ${rows.length}`);
    const mapped = rows.map((s, i) => opencodeSessionFromSummary(s, i + 1));
    setOpencodeSessions(mapped);
    setActiveOpencodeSessionId((prev) => (prev && mapped.some((x) => x.id === prev) ? prev : mapped[0].id));
  }

  async function loadOpencodeSessionMessages(sessionId: string) {
    if (!ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    appendOpencodeDebugLog(`session.messages load ${id}`);
    const rows = await invoke<OpencodeSessionMessage[]>("get_opencode_session_messages", {
      repoPath,
      sessionId: id,
      limit: 160
    });
    const mapped: OpencodeChatMessage[] = (rows || [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ id: m.id, role: m.role, content: m.content || "" }));
    updateOpencodeSessionById(id, (session) => ({
      ...session,
      messages: mapped,
      visibleCount: Math.min(Math.max(OPENCODE_RECENT_VISIBLE, mapped.length), mapped.length || OPENCODE_RECENT_VISIBLE),
      loaded: true,
      updatedAt: Date.now()
    }));
    appendOpencodeDebugLog(`session.messages loaded ${id} count=${mapped.length}`);
  }

  async function loadOpencodeMessageDetails(sessionId: string, messageId: string, limit = 80) {
    if (!ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    const mid = messageId.trim();
    if (!mid) return;
    const serverMid = (opencodeServerMessageIdByLocalId[mid] || "").trim() || mid;
    setOpencodeDetailsErrorByMessageId((prev) => ({ ...prev, [mid]: "" }));
    setOpencodeDetailsLoadingByMessageId((prev) => ({ ...prev, [mid]: true }));
    appendOpencodeDebugLog(`session.messages detailed load ${id} message=${serverMid}`);
    try {
      const raw = await invoke<unknown>("get_opencode_session_messages_detailed", {
        repoPath,
        sessionId: id,
        directory: repoPath,
        limit
      });
      const rows = (Array.isArray(raw) ? raw : []).filter(Boolean) as OpencodeDetailedMessage[];
      const hit = rows.find((m) => String((m as any)?.info?.id || "") === serverMid) ?? null;
      setOpencodeDetailsByMessageId((prev) => ({ ...prev, [mid]: hit }));
      appendOpencodeDebugLog(`session.messages detailed loaded ${id} message=${serverMid} hit=${hit ? 1 : 0} total=${rows.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "unknown error");
      setOpencodeDetailsErrorByMessageId((prev) => ({ ...prev, [mid]: msg }));
      appendOpencodeDebugLog(`session.messages detailed failed ${id} message=${serverMid} ${msg}`);
    } finally {
      setOpencodeDetailsLoadingByMessageId((prev) => ({ ...prev, [mid]: false }));
    }
  }

  async function createAndSwitchOpencodeSession(seedPrompt?: string) {
    if (!ensureRepoSelected()) return;
    appendOpencodeDebugLog("session.create requested");
    const created = await invoke<OpencodeSessionSummary>("create_opencode_session", {
      repoPath,
      title: seedPrompt?.trim() || undefined
    });
    const next = opencodeSessionFromSummary(created, opencodeSessions.length + 1);
    next.loaded = true;
    setOpencodeSessions((prev) => [next, ...prev]);
    setActiveOpencodeSessionId(created.id);
    setOpencodePromptInput("");
    opencodePrevCountRef.current = 0;
    appendOpencodeDebugLog(`session.created ${created.id}`);
    requestAnimationFrame(() => {
      const el = opencodeThreadRef.current;
      if (!el) return;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });
  }

  async function removeOpencodeSession(sessionId: string) {
    const id = sessionId.trim();
    if (!id || opencodeSessions.length <= 1) return;
    if (!ensureRepoSelected()) return;
    appendOpencodeDebugLog(`session.delete requested ${id}`);
    const snapshot = opencodeSessions;
    const idx = snapshot.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = snapshot.filter((s) => s.id !== id);
    const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
    setOpencodeSessions(next);
    if (activeOpencodeSessionId === id && fallback) {
      setActiveOpencodeSessionId(fallback.id);
    }
    try {
      await invoke<boolean>("delete_opencode_session", { repoPath, sessionId: id });
      appendOpencodeDebugLog(`session.deleted ${id}`);
    } catch (e) {
      appendOpencodeDebugLog(`session.delete.error ${id} ${String(e)}`);
      setOpencodeSessions(snapshot);
      if (activeOpencodeSessionId === id) {
        setActiveOpencodeSessionId(id);
      }
      throw e;
    }
  }

  useEffect(() => {
    if (!draggingSplit) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - draggingSplit.startX;
      if (draggingSplit.kind === "sidebar") {
        setSidebarWidth(clamp(draggingSplit.startWidth + delta, 240, 520));
      } else {
        setRightPaneWidth(clamp(draggingSplit.startWidth - delta, 300, 680));
      }
    };
    const onUp = () => setDraggingSplit(null);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingSplit]);
  function ensureRepoSelected(): boolean {
    if (!selectedRepo) {
      setError("请先导入并选择一个仓库。");
      return false;
    }
    return true;
  }

  async function refreshRepositories() {
    const all = await listRepositories();
    setRepos(all);
    if (all.length > 0 && !selectedRepo) setSelectedRepo(all[0]);
  }

  async function importRepository(pathFromPrompt: string): Promise<boolean> {
    setError("");
    const path = pathFromPrompt.trim();
    if (!path) {
      setError("请先选择本地仓库文件夹。");
      return false;
    }
    setBusy(true);
    setOverlayBusy(true);
    setMessage("正在导入仓库...");
    try {
      const entry = await addRepository(path);
      await refreshRepositories();
      setSelectedRepo(entry);
      setMessage(`已导入仓库: ${entry.name}`);
      return true;
    } catch (e) {
      setError(String(e));
      setMessage("导入失败");
      return false;
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pickAndImportRepository() {
    if (busy) return;
    setError("");
    setMessage("请选择本地仓库文件夹...");
    try {
      const path = await pickRepositoryFolder();
      if (!path) {
        setMessage("已取消导入");
        return;
      }
      await importRepository(path);
    } catch (e) {
      setError(String(e));
      setMessage("选择目录失败");
    }
  }

  async function closeRepository(entry: RepositoryEntry) {
    setRepoContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`Closing: ${entry.name}...`);
    try {
      await removeRepository(entry.id);
      const all = await listRepositories();
      setRepos(all);
      if (selectedRepo?.id === entry.id) {
        setSelectedRepo(all[0] ?? null);
      } else if (selectedRepo && !all.some((r) => r.id === selectedRepo.id)) {
        setSelectedRepo(all[0] ?? null);
      }
      setMessage(`Closed: ${entry.name}`);
    } catch (e) {
      setError(String(e));
      setMessage("Close failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
  }

  async function copyCommitId(sha: string) {
    setCommitContextMenu(null);
    try {
      await copyText(sha);
      setMessage(`Copied commit id: ${sha.slice(0, 8)}`);
    } catch (e) {
      setError(String(e));
      setMessage("Copy failed");
    }
  }

  async function refreshRuntimeRequirements(): Promise<RuntimeRequirementsStatus> {
    setRuntimeChecking(true);
    setCheckingDeps({ git: true, entire: true, opencode: true });
    try {
      const deps: Array<"git" | "entire" | "opencode"> = ["git", "entire", "opencode"];
      await Promise.all(
        deps.map(async (dep) => {
          try {
            const result = await invoke<RuntimeDependencyStatus>("check_runtime_dependency", { name: dep });
            setRuntimeStatus((prev) => ({ ...prev, [dep]: result }));
          } finally {
            setCheckingDeps((prev) => ({ ...prev, [dep]: false }));
          }
        })
      );

      const final = await invoke<RuntimeRequirementsStatus>("check_runtime_requirements");
      setRuntimeStatus(final);
      if (final.git.installed && final.entire.installed) {
        window.localStorage.setItem("giteam.runtime.ready.v1", "1");
        const onboardingDone = window.localStorage.getItem(ONBOARDING_DONE_KEY) === "1";
        if (!onboardingDone) {
          setOnboardingStep(0);
          setShowOnboarding(true);
        }
      }
      return final;
    } finally {
      setRuntimeChecking(false);
    }
  }

  async function runDependencyAction(name: "git" | "entire" | "opencode", action: "install" | "uninstall") {
    flushSync(() => {
      setShowEnvSetup(true);
      setInstallingDep(name);
      setInstallingElapsed(0);
      setRuntimeInstallLog("");
      setRuntimeJob(null);
      setRuntimeJobId("");
      setExpandedLogDep(null);
      setError("");
      setMessage(`${action === "install" ? "Installing" : "Uninstalling"} ${name}...`);
      setRuntimeInstallLog(`Starting ${action} for ${name}...\nPlease wait.`);
    });
    try {
      const jobId = await invoke<string>("start_runtime_dependency_action", { name, action });
      setRuntimeJobId(jobId);
    } catch (e) {
      setRuntimeInstallLog(String(e));
      setError(String(e));
      setMessage(`${action} ${name} failed to start`);
      setInstallingDep("");
      setInstallingElapsed(0);
      setRuntimeJobId("");
    }
  }

  async function fetchOpencodeProviders(): Promise<string[]> {
    const state = await invoke<OpencodeServerProviderState>("get_opencode_server_provider_state", { repoPath });
    const rows = state?.providers || [];
    const connected = (state?.connected || []).filter(Boolean);
    const names: Record<string, string> = {};
    const catalog: Record<string, string[]> = {};
    const modelNamesCatalog: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      if (!row?.id) continue;
      names[row.id] = row.name || row.id;
      catalog[row.id] = Array.from(new Set((row.models || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      modelNamesCatalog[row.id] = row.modelNames || {};
    }
    const connectedSet = new Set(connected);
    const stickyProviders = new Set<string>();
    if (opencodeModelProvider.trim()) stickyProviders.add(opencodeModelProvider.trim());
    const configured = parseModelRef(opencodeConfig?.configuredModel || "");
    if (configured?.provider) stickyProviders.add(configured.provider);
    const selectionCatalog = Object.fromEntries(
      Object.entries(catalog).filter(([providerId]) => connectedSet.has(providerId) || stickyProviders.has(providerId))
    );
    const next = applyOpencodeCatalog(
      Object.keys(selectionCatalog).length > 0 ? selectionCatalog : catalog,
      opencodeModelProvider,
      opencodeSelectedModel
    );
    setOpencodeProviderNames((prev) => ({ ...prev, ...names }));
    setOpencodeModelsByProvider(catalog);
    setOpencodeModelNamesByProvider(modelNamesCatalog);
    setOpencodeProviders(Object.keys(catalog).sort((a, b) => a.localeCompare(b)));
    setOpencodeConnectedProviders(connected.sort((a, b) => a.localeCompare(b)));
    setOpencodeModelProvider(next.provider);
    setOpencodeSelectedModel(next.model);
    return next.providers;
  }

  async function fetchOpencodeModels(provider: string): Promise<string[]> {
    const state = await invoke<OpencodeServerProviderState>("get_opencode_server_provider_state", { repoPath });
    const rows = state?.providers || [];
    const entry = rows.find((p) => p.id === provider) || rows.find((p) => normalizeProviderId(p.id) === normalizeProviderId(provider));
    const models = (entry?.models || []).filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (entry?.id) {
      setOpencodeModelsByProvider((prev) => ({ ...prev, [entry.id]: models }));
      setOpencodeModelNamesByProvider((prev) => ({ ...prev, [entry.id]: entry.modelNames || {} }));
      setOpencodeProviderNames((prev) => ({ ...prev, [entry.id]: prev[entry.id] || entry.name || entry.id }));
      ensureProviderExists(entry.id);
    }
    return models;
  }

  async function refreshOpencodeCatalog(opts?: { syncSelection?: boolean; includeCurrentModel?: boolean }) {
    if (!ensureRepoSelected()) return;
    setOpencodeCatalogLoading(true);
    try {
      // Source of truth for configured models: /config
      await refreshOpencodeServerConfig(opts);
      // Source of truth for directory listing: /provider
      await refreshOpencodeServerProviders();
      await refreshOpencodeConfiguredModels();
    } finally {
      setOpencodeCatalogLoading(false);
    }
  }

  useEffect(() => {
    if (!showModelManager) return;
    const provider = resolveProviderAliasWithNames(
      opencodeModelProvider.trim(),
      opencodeModelsByProvider,
      opencodeProviderNames
    );
    if (!provider) return;
    if (provider !== opencodeModelProvider) {
      setOpencodeModelProvider(provider);
      return;
    }
    if (opencodeModelsByProvider[provider]) return;
    void fetchOpencodeModels(provider);
  }, [showModelManager, opencodeModelProvider, opencodeModelsByProvider, opencodeProviderNames]);

  useEffect(() => {
    if (!showOpencodeProviderPicker) return;
    // Reset filters so the modal shows the full provider list by default.
    setOpencodeProviderPickerSearch("");
    setOpencodeProviderPickerModelSearch("");
    appendOpencodeDebugLog(
      `providerPicker.open presets=${PROVIDER_PRESETS.length} serverProviders=${opencodeProviders.length} configuredProviders=${opencodeConfiguredProviders.length} connectedProviders=${opencodeConnectedProviders.length}`
    );
    // Ensure provider/model display names are fresh when opening the picker.
    void refreshOpencodeCatalog({ syncSelection: false, includeCurrentModel: false });
  }, [showOpencodeProviderPicker]);

  async function loadOpencodeModelConfig() {
    if (!ensureRepoSelected()) return;
    try {
      const cfg = await invoke<OpencodeModelConfig>("get_opencode_model_config", { repoPath });
      // Do NOT let local opencode.json override server /config.model (service truth) or /global/config providers.
      // Keep only file metadata (path/exists), and still record the local configuredModel into history.
      setOpencodeConfig((prev) => ({
        configPath: cfg.configPath || prev?.configPath || "",
        configuredModel: prev?.configuredModel || "",
        exists: Boolean(cfg.exists)
      }));
      if (cfg.configuredModel) pushOpencodeSavedModel(cfg.configuredModel);
    } catch (e) {
      setError(String(e));
      setMessage("Load model config failed");
    }
  }

  async function refreshOpencodeConfiguredModels() {
    if (!ensureRepoSelected()) return;
    try {
      const configured = await invoke<OpencodeConfigProviderCatalog[]>("get_opencode_config_provider_catalog", { repoPath });
      if (!configured || configured.length === 0) return;
      setOpencodeProviderNames((prev) => {
        const next = { ...prev };
        for (const p of configured) {
          if (!p?.id) continue;
          if (p.name && !next[p.id]) next[p.id] = p.name;
        }
        return next;
      });
      appendOpencodeDebugLog(`config.catalog names synced providers=${configured.length}`);
    } catch (e) {
      appendOpencodeDebugLog(`config.catalog error ${String(e)}`);
    }
  }

  async function refreshOpencodeServerProviders() {
    if (!ensureRepoSelected()) return;
    try {
      const state = await invoke<OpencodeServerProviderState>("get_opencode_server_provider_state", { repoPath });
      const rows = state?.providers || [];
      const connected = (state?.connected || []).filter(Boolean);
      if (!rows || rows.length === 0) return;
      setOpencodeProviderNames((prev) => {
        const next = { ...prev };
        for (const p of rows) {
          if (!p?.id) continue;
          if (p.name && !next[p.id]) next[p.id] = p.name;
        }
        return next;
      });
      setOpencodeModelNamesByProvider(() => {
        const next: Record<string, Record<string, string>> = {};
        for (const p of rows) {
          if (!p?.id) continue;
          next[p.id] = p.modelNames || {};
        }
        return next;
      });
      setOpencodeModelsByProvider(() => {
        const next: Record<string, string[]> = {};
        for (const p of rows) {
          if (!p?.id) continue;
          next[p.id] = Array.from(new Set((p.models || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
        }
        return next;
      });
      setOpencodeProviders(rows.map((p) => p.id).filter(Boolean).sort((a, b) => a.localeCompare(b)));
      setOpencodeConnectedProviders(connected.sort((a, b) => a.localeCompare(b)));
      appendOpencodeDebugLog(`server.providers synced providers=${rows.length} connected=${connected.length}`);
    } catch (e) {
      appendOpencodeDebugLog(`server.providers error ${String(e)}`);
    }
  }

  async function openConnectProvider(providerId: string) {
    if (!ensureRepoSelected()) return;
    const pid = providerId.trim();
    if (!pid) return;
    setOpencodeConnectProviderId(pid);
    setOpencodeConnectProviderName(opencodeProviderNames[pid] || PROVIDER_PRESETS.find((p) => p.id === pid)?.name || pid);
    setOpencodeConnectApiKey("");
    try {
      if (!opencodeProviderAuthCache[pid]) {
        const raw = await invoke<Record<string, OpencodeProviderAuthMethod[]>>("get_opencode_server_provider_auth", { repoPath });
        const methods = raw?.[pid] ?? [{ type: "api", label: "API key" }];
        setOpencodeProviderAuthCache((prev) => ({ ...prev, [pid]: methods }));
      }
    } catch {
      // fallback: show API key input even if auth list fails
      setOpencodeProviderAuthCache((prev) => ({ ...prev, [pid]: prev[pid] ?? [{ type: "api", label: "API key" }] }));
    }
  }

  async function refreshOpencodeServerConfig(opts?: { syncSelection?: boolean; includeCurrentModel?: boolean }) {
    if (!ensureRepoSelected()) return;
    const syncSelection = opts?.syncSelection !== false;
    const includeCurrentModel = opts?.includeCurrentModel !== false;
    try {
      // /config may include provider catalogs (e.g. 302ai) that the user didn't configure.
      // Use /global/config for "configured providers/models", but keep /config.model as the current model source of truth.
      const globalCfg = await invoke<OpencodeServerConfig>("get_opencode_server_global_config", { repoPath });
      const providerMap = globalCfg?.provider || {};
      const disabled = new Set((globalCfg?.disabled_providers || []).filter(Boolean));
      const configuredProviders = Object.keys(providerMap).filter((id) => id && !disabled.has(id));

      // Build "configured models" catalog from /config.provider.*.models (OpenCode UI behavior)
      const names: Record<string, string> = {};
      const modelsByProvider: Record<string, string[]> = {};
      const modelNamesByProvider: Record<string, Record<string, string>> = {};
      for (const [pid, p] of Object.entries(providerMap)) {
        if (!pid || disabled.has(pid)) continue;
        names[pid] = p?.name || pid;
        const modelEntries = p?.models || {};
        const models = Object.keys(modelEntries).filter(Boolean).sort((a, b) => a.localeCompare(b));
        if (models.length > 0) modelsByProvider[pid] = models;
        const displayMap: Record<string, string> = {};
        for (const [mid, mv] of Object.entries(modelEntries)) {
          const modelId = (mid || "").trim();
          if (!modelId) continue;
          const display = (mv?.name || modelId).trim();
          displayMap[modelId] = display || modelId;
        }
        modelNamesByProvider[pid] = displayMap;
      }

      // Prefer /provider-derived display names when available.
      // /config is often "power-user" config and may use terse ids (e.g. k2p5) even when /provider has a nicer name (e.g. kimi2.5).
      setOpencodeProviderNames((prev) => {
        const next = { ...prev };
        for (const [pid, display] of Object.entries(names)) {
          if (!pid) continue;
          if (!next[pid]) next[pid] = display;
        }
        return next;
      });
      setOpencodeConfiguredModelsByProvider(modelsByProvider);
      setOpencodeConfiguredModelNamesByProvider(modelNamesByProvider);
      setOpencodeConfiguredProviders(configuredProviders.sort((a, b) => a.localeCompare(b)));

      if (includeCurrentModel) {
        const effective = await invoke<OpencodeServerConfig>("get_opencode_server_config", { repoPath });
        const currentModel = normalizeModelRef(effective?.model || "");
        if (currentModel) {
          const parsed = parseModelRef(currentModel);
          if (parsed) {
            const configuredSet = new Set(configuredProviders);
            // When server model is configured, force UI selection to match it.
            if (syncSelection && configuredSet.has(parsed.provider)) {
              ensureProviderExists(parsed.provider);
              setOpencodeModelProvider(parsed.provider);
              setOpencodeSelectedModel(parsed.model);
            }
          }
          setOpencodeConfig((prev) => ({
            configPath: prev?.configPath || (opencodeConfig?.configPath || ""),
            configuredModel: currentModel,
            exists: true
          }));
        }
      }
      appendOpencodeDebugLog(`server.config synced providers=${Object.keys(providerMap).length} configured=${configuredProviders.length}`);
    } catch (e) {
      appendOpencodeDebugLog(`server.config error ${String(e)}`);
    }
  }


  async function openProviderConfig() {
    if (!ensureRepoSelected()) return;
    const provider = opencodeModelProvider.trim();
    if (!provider) {
      setMessage("Select provider first");
      return;
    }
    setOpencodeProviderConfigBusy(true);
    try {
      const cfg = await invoke<OpencodeProviderConfig>("get_opencode_provider_config", {
        repoPath,
        provider
      });
      setOpencodeProviderConfig({
        provider: cfg.provider,
        npm: cfg.npm || (cfg.provider && !PROVIDER_PRESETS.some((p) => p.id === cfg.provider) ? "@ai-sdk/openai-compatible" : ""),
        name: cfg.name || "",
        baseUrl: cfg.baseUrl || defaultProviderBaseUrl(cfg.provider),
        apiKey: cfg.apiKey,
        headers: {},
        endpoint: cfg.endpoint || "",
        region: cfg.region || "",
        profile: cfg.profile || "",
        project: cfg.project || "",
        location: cfg.location || "",
        resourceName: cfg.resourceName || "",
        enterpriseUrl: cfg.enterpriseUrl || "",
        timeout: cfg.timeout || "",
        chunkTimeout: cfg.chunkTimeout || ""
      });
    } catch (e) {
      setError(String(e));
      setMessage("Load provider config failed");
    } finally {
      setOpencodeProviderConfigBusy(false);
    }
  }

  function ensureProviderExists(provider: string) {
    if (!provider) return;
    setOpencodeProviders((prev) => (prev.includes(provider) ? prev : [...prev, provider].sort((a, b) => a.localeCompare(b))));
  }

  function selectProvider(provider: string) {
    if (!provider) return;
    ensureProviderExists(provider);
    setOpencodeModelProvider(provider);
    const cfgResolved = resolveProviderAliasWithNames(provider, opencodeConfiguredModelsByProvider, opencodeProviderNames);
    const candidates = cfgResolved ? (opencodeConfiguredModelsByProvider[cfgResolved] ?? []) : [];
    setOpencodeSelectedModel((prev) => (prev && candidates.includes(prev) ? prev : ""));
    const presetBase = defaultProviderBaseUrl(provider);
    const isPreset = PROVIDER_PRESETS.some((p) => p.id === provider);
    setOpencodeProviderConfig((prev) => ({
      ...prev,
      provider,
      npm: prev.npm || (!isPreset ? "@ai-sdk/openai-compatible" : ""),
      name: prev.name || "",
      baseUrl: prev.baseUrl || presetBase
    }));
  }

  function addCustomProvider() {
    const next = opencodeCustomProviderDraft.trim();
    if (!next) return;
    setOpencodeProviderNames((prev) => ({ ...prev, [next]: prev[next] || next }));
    setOpencodeCustomProviderDraft("");
    selectProvider(next);
    setOpencodeProviderConfig((prev) => ({
      ...prev,
      provider: next,
      npm: prev.npm || "@ai-sdk/openai-compatible"
    }));
    void openProviderConfig();
  }

  async function saveOpencodeConfiguration() {
    if (!ensureRepoSelected()) return;
    const providerToSave = opencodeModelProvider.trim();
    const modelToSave = opencodeSelectedModel.trim();
    if (!providerToSave || !modelToSave) {
      setMessage("Select provider and model first");
      return;
    }
    setOpencodeConfigBusy(true);
    setOpencodeProviderConfigBusy(true);
    try {
      const cfg = await invoke<OpencodeProviderConfig>("set_opencode_provider_config", {
        repoPath,
        provider: providerToSave,
        npm: opencodeProviderConfig.npm,
        name: opencodeProviderConfig.name,
        baseUrl: opencodeProviderConfig.baseUrl,
        apiKey: opencodeProviderConfig.apiKey,
        headers: opencodeProviderConfig.headers || {},
        endpoint: opencodeProviderConfig.endpoint,
        region: opencodeProviderConfig.region,
        profile: opencodeProviderConfig.profile,
        project: opencodeProviderConfig.project,
        location: opencodeProviderConfig.location,
        resourceName: opencodeProviderConfig.resourceName,
        enterpriseUrl: opencodeProviderConfig.enterpriseUrl,
        timeout: opencodeProviderConfig.timeout,
        chunkTimeout: opencodeProviderConfig.chunkTimeout,
        modelId: modelToSave,
        modelName: modelToSave
      });
      setOpencodeProviderConfig(cfg);
      ensureProviderExists(providerToSave);
      setOpencodeModelProvider(providerToSave);

      const full = modelToSave.includes("/")
        ? modelToSave
        : `${providerToSave}/${modelToSave}`;
      const mcfg = await invoke<OpencodeModelConfig>("set_opencode_model_config", {
        repoPath,
        model: full
      });
      setOpencodeConfig(mcfg);
      pushOpencodeSavedModel(full);
      // Keep connected-provider state and model catalogs in sync after saving auth/config.
      await refreshOpencodeCatalog();
      setMessage(`Saved configuration: ${full}`);
    } catch (e) {
      setError(String(e));
      setMessage("Save configuration failed");
    } finally {
      setOpencodeConfigBusy(false);
      setOpencodeProviderConfigBusy(false);
    }
  }

  async function validateOpencodeModel() {
    if (!ensureRepoSelected()) return;
    const model = opencodeSelectedModel?.trim();
    const provider = opencodeModelProvider?.trim();
    if (!model || !provider) {
      setMessage("Select provider and model first");
      return;
    }
    setOpencodeTestBusy(true);
    setOpencodeTestResult("");
    try {
      const full = model.includes("/") ? model : `${provider}/${model}`;
      // Ensure latest form values are persisted before validation, otherwise opencode run
      // may still use stale provider/model config from opencode.json.
      await invoke<OpencodeProviderConfig>("set_opencode_provider_config", {
        repoPath,
        provider,
        npm: opencodeProviderConfig.npm,
        name: opencodeProviderConfig.name,
        baseUrl: opencodeProviderConfig.baseUrl,
        apiKey: opencodeProviderConfig.apiKey,
        headers: opencodeProviderConfig.headers || {},
        endpoint: opencodeProviderConfig.endpoint,
        region: opencodeProviderConfig.region,
        profile: opencodeProviderConfig.profile,
        project: opencodeProviderConfig.project,
        location: opencodeProviderConfig.location,
        resourceName: opencodeProviderConfig.resourceName,
        enterpriseUrl: opencodeProviderConfig.enterpriseUrl,
        timeout: opencodeProviderConfig.timeout,
        chunkTimeout: opencodeProviderConfig.chunkTimeout,
        modelId: model,
        modelName: model
      });
      const modelCfg = await invoke<OpencodeModelConfig>("set_opencode_model_config", {
        repoPath,
        model: full
      });
      const providerCfg = await invoke<OpencodeProviderConfig>("get_opencode_provider_config", {
        repoPath,
        provider
      });
      const out = await invoke<string>("test_opencode_model", {
        repoPath,
        model: full,
        message: "Reply with OK only."
      });
      const normalized = (out || "").trim();
      if (!normalized) {
        setOpencodeTestResult("Validation failed: empty response");
      } else {
        const lines = normalized.split("\n").map((s) => s.trim()).filter(Boolean);
        const firstJson = lines.find((line) => line.startsWith("{") && line.endsWith("}")) || "";
        if (firstJson) {
          try {
            const parsed = JSON.parse(firstJson) as { type?: string; error?: { data?: { message?: string } } };
            if (parsed.type === "error") {
              const msg = parsed.error?.data?.message || firstJson;
              const snapshot = [
                `provider=${providerCfg.provider}`,
                `npm=${providerCfg.npm || "(empty)"}`,
                `baseURL=${providerCfg.baseUrl || "(empty)"}`,
                `apiKeyLen=${(providerCfg.apiKey || "").length}`,
                `model=${full}`,
                `configPath=${modelCfg.configPath}`
              ].join("\n");
              setOpencodeTestResult(`Validation failed\n${msg}\n\n[config snapshot]\n${snapshot}`);
              return;
            }
          } catch {
            // keep original output fallback
          }
        }
        const snapshot = [
          `provider=${providerCfg.provider}`,
          `npm=${providerCfg.npm || "(empty)"}`,
          `baseURL=${providerCfg.baseUrl || "(empty)"}`,
          `apiKeyLen=${(providerCfg.apiKey || "").length}`,
          `model=${full}`,
          `configPath=${modelCfg.configPath}`
        ].join("\n");
        setOpencodeTestResult(`Validation OK\n${normalized.slice(0, 1200)}\n\n[config snapshot]\n${snapshot}`);
      }
    } catch (e) {
      setOpencodeTestResult(`Validation failed\n${String(e)}`);
    } finally {
      setOpencodeTestBusy(false);
    }
  }

  async function runOpencodePrompt() {
    if (!ensureRepoSelected()) return;
    if (opencodeRunBusy) return;
    const prompt = opencodePromptInput.trim();
    if (!prompt) return;
    const sessionId = ensureActiveOpencodeSession();
    const targetSession = opencodeSessions.find((s) => s.id === sessionId);
    if (!targetSession) return;
    const assistantId = `assistant-${makeId()}`;
    const requestId = `req-${makeId()}`;
    setOpencodeStreamingAssistantId(assistantId);
    const scrollToBottom = () => {
      if (activeOpencodeSessionId !== sessionId) return;
      const el = opencodeThreadRef.current;
      if (!el) return;
      requestAnimationFrame(() => {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      });
    };
    updateOpencodeSessionById(sessionId, (session) => {
      const nextMessages: OpencodeChatMessage[] = [
        ...session.messages,
        { id: `user-${makeId()}`, role: "user", content: prompt },
        { id: assistantId, role: "assistant", content: "" }
      ];
      const nextVisible =
        session.messages.length <= 0
          ? Math.min(nextMessages.length, OPENCODE_RECENT_VISIBLE)
          : Math.min(nextMessages.length, Math.max(OPENCODE_RECENT_VISIBLE, session.visibleCount + 2));
      return {
        ...session,
        title: session.messages.length === 0 ? toOpencodeSessionTitle(prompt) : session.title,
        messages: nextMessages,
        visibleCount: nextVisible,
        updatedAt: Date.now()
      };
    });
    scrollToBottom();
    setOpencodePromptInput("");
    setOpencodeRunBusy(true);
    resetOpencodeThinkingLogs();
    const configuredModel = opencodeConfig?.configuredModel || "";
    const uiModel = (opencodeModelProvider && opencodeSelectedModel) ? `${opencodeModelProvider}/${opencodeSelectedModel}` : "";
    const rawModel = configuredModel || uiModel || "";
    const parsed = rawModel ? parseModelRef(rawModel) : null;
    const resolvedProvider = parsed
      ? (resolveProviderAliasWithNames(parsed.provider, opencodeModelsByProvider, opencodeProviderNames) || parsed.provider)
      : "";
    const modelHint = parsed ? `${resolvedProvider}/${parsed.model}` : rawModel;
    appendOpencodeDebugLog(
      [
        `prompt.send session=${sessionId} request=${requestId}`,
        `chars=${prompt.length}`,
        `model.raw=${rawModel || "(empty)"}`,
        `model.hint=${modelHint || "(empty)"}`,
        `source=${configuredModel ? "config.model" : (uiModel ? "ui.picker" : "none")}`
      ].join(" ")
    );
    let done = false;
    let hadDelta = false;
    let unlisten: (() => void) | null = null;
    let fallbackTimer: number | null = null;
    const finalize = () => {
      if (done) return;
      done = true;
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
      setOpencodeRunBusy(false);
      setOpencodeStreamingAssistantId("");
      updateOpencodeSessionById(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((msg) =>
          msg.id === assistantId && !msg.content.trim() ? { ...msg, content: "(empty response)" } : msg
        ),
        updatedAt: Date.now()
      }));
      appendOpencodeDebugLog(`prompt.finalize session=${sessionId}`);
    };
    try {
      // Always re-read the service /config model before sending so the request
      // matches the OpenCode server truth (not local files).
      let serverModel = "";
      try {
        const effective = await invoke<OpencodeServerConfig>("get_opencode_server_config", { repoPath });
        serverModel = normalizeModelRef(effective?.model || "");
        if (serverModel) {
          setOpencodeConfig((prev) => ({
            configPath: prev?.configPath || (opencodeConfig?.configPath || ""),
            configuredModel: serverModel,
            exists: true
          }));
        }
      } catch (e) {
        appendOpencodeDebugLog(`prompt.serverModel.refresh.warn ${String(e)}`);
      }
      const model =
        serverModel ||
        ((opencodeModelProvider && opencodeSelectedModel)
          ? `${opencodeModelProvider}/${opencodeSelectedModel}`
          : "");
      unlisten = await listen<OpencodeStreamEvent>("opencode-stream", (evt) => {
        const payload = evt.payload;
        if (!payload || payload.requestId !== requestId) return;
        appendOpencodeDebugLog(`stream.event kind=${payload.kind} len=${(payload.text || "").length}`);
        if (payload.kind === "debug") {
          appendOpencodeDebugLog(payload.text || "");
          return;
        }
        if (payload.kind === "explore_task") {
          const raw = (payload.text || "").trim();
          if (!raw) return;
          try {
            const obj = JSON.parse(raw) as { messageID?: string };
            const serverMid = String(obj?.messageID || "").trim();
            if (serverMid) {
              setOpencodeExploreTaskByServerMessageId((prev) => ({ ...prev, [serverMid]: obj }));
            }
          } catch {
            // ignore parse error
          }
          return;
        }
        if (payload.kind === "assistant_message_id") {
          const serverMid = (payload.text || "").trim();
          if (serverMid) {
            setOpencodeServerMessageIdByLocalId((prev) => ({ ...prev, [assistantId]: serverMid }));
            // If details are already expanded for this local message, refresh immediately.
            if (opencodeExpandedDetailMessageId === assistantId) {
              void loadOpencodeMessageDetails(sessionId, assistantId, 80);
            }
          }
          return;
        }
        if (payload.kind === "trace_event") {
          const raw = (payload.text || "").trim();
          if (!raw) return;
          try {
            const obj = JSON.parse(raw) as { messageID?: string; text?: string };
            const serverMid = String(obj?.messageID || "").trim();
            const text = String(obj?.text || "").trim();
            if (serverMid && text) {
              setOpencodeTraceEventsByServerMessageId((prev) => {
                const cur = prev[serverMid] || [];
                const next = [...cur, text].slice(-50);
                return { ...prev, [serverMid]: next };
              });
            }
          } catch {
            // ignore parse error
          }
          return;
        }
        if (payload.kind === "trace") {
          appendOpencodeThinkingLine(payload.text || "");
          return;
        }
        if (payload.kind === "delta") {
          hadDelta = true;
          const text = extractOpencodeText(payload.text || "");
          updateOpencodeSessionById(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: (msg.content || "") + text } : msg
            ),
            updatedAt: Date.now()
          }));
          scrollToBottom();
          return;
        }
        if (payload.kind === "error") {
          updateOpencodeSessionById(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: `Run failed\n${payload.text || ""}` } : msg
            ),
            updatedAt: Date.now()
          }));
          scrollToBottom();
          finalize();
          return;
        }
        if (payload.kind === "done") {
          if (!hadDelta) {
            updateOpencodeSessionById(sessionId, (session) => ({
              ...session,
              messages: session.messages.map((msg) =>
                msg.id === assistantId ? { ...msg, content: "(empty response)" } : msg
              ),
              updatedAt: Date.now()
            }));
            scrollToBottom();
          }
          finalize();
        }
      });

      // Fallback: if stream doesn't deliver delta/done, poll session messages and end the run.
      fallbackTimer = window.setTimeout(async () => {
        if (done) return;
        try {
          const rows = await invoke<OpencodeSessionMessage[]>("get_opencode_session_messages", { repoPath, sessionId, limit: 40 });
          const lastAssistant = (rows || []).slice().reverse().find((m) => m?.role === "assistant");
          const content = extractOpencodeText(lastAssistant?.content || "").trim();
          appendOpencodeDebugLog(`prompt.fallback.poll ok assistantChars=${content.length}`);
          if (content) {
            updateOpencodeSessionById(sessionId, (session) => ({
              ...session,
              messages: session.messages.map((msg) => (msg.id === assistantId ? { ...msg, content } : msg)),
              updatedAt: Date.now()
            }));
            scrollToBottom();
          } else {
            appendOpencodeDebugLog("prompt.fallback.poll empty");
          }
        } catch (e) {
          appendOpencodeDebugLog(`prompt.fallback.poll error ${String(e)}`);
        } finally {
          finalize();
        }
      }, 15000);

      await invoke("run_opencode_prompt_stream", {
        repoPath,
        prompt,
        model,
        sessionId,
        requestId
      });
      appendOpencodeDebugLog(`prompt.invoke.ok request=${requestId}`);
    } catch (e) {
      appendOpencodeDebugLog(`prompt.invoke.error ${String(e)}`);
      updateOpencodeSessionById(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((msg) =>
          msg.id === assistantId ? { ...msg, content: `Run failed\n${String(e)}` } : msg
        ),
        updatedAt: Date.now()
      }));
      scrollToBottom();
      finalize();
    }
  }

  function resizeOpencodeInput() {
    const el = opencodeInputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(140, Math.max(38, el.scrollHeight));
    el.style.height = `${next}px`;
  }

  function openRepoContextMenu(x: number, y: number, repo: RepositoryEntry) {
    const menuW = 132;
    const menuH = 44;
    const cx = Math.min(x, window.innerWidth - menuW - 8);
    const cy = Math.min(y, window.innerHeight - menuH - 8);
    setRepoContextMenu({
      x: Math.max(8, cx),
      y: Math.max(8, cy),
      repo
    });
  }

  async function refreshStatus() {
    if (!ensureRepoSelected()) return;
    setError("");
    setMessage("读取 entire 状态...");
    try {
      const res = await getEntireStatusDetailed(repoPath);
      setStatusText(res.raw);
      setMessage("状态已更新");
    } catch (e) {
      setError(String(e));
      setMessage("读取状态失败");
    }
  }

  async function refreshBranchesAndCommits() {
    if (!ensureRepoSelected()) return;
    setError("");
    setMessage("加载分支与提交...");
    try {
      const branchList = await getLocalBranches(repoPath);
      const graphRows = await getCommitGraph(repoPath, 140);
      setBranches(branchList);
      setCommitGraph(graphRows);
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const target = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(target);
      if (!target) {
        setCommits([]);
        setSelectedCommit("");
        setMessage("未找到可用本地分支");
        return;
      }
      const rows = await getBranchCommits(repoPath, target, 80);
      setCommits(rows);
      setSelectedCommit(rows[0]?.sha ?? "");
      setMessage(rows.length > 0 ? "分支与提交已更新" : `分支 ${target} 暂无提交可显示`);
    } catch (e) {
      setError(String(e));
      setMessage("加载分支/提交失败");
    }
  }

  async function refreshReviewData() {
    if (!ensureRepoSelected()) return;
    const [reviewRows, actionRows] = await Promise.all([
      loadReviewRecords(repoPath),
      loadReviewActions(repoPath)
    ]);
    setRecords(reviewRows);
    setActions(actionRows);
  }

  async function refreshCommitContext(commitSha: string) {
    if (!ensureRepoSelected() || !commitSha) return;
    setError("");
    setAgentContextError("");
    setMessage("加载提交上下文...");
    let files: string[] = [];
    try {
      files = await getCommitChangedFiles(repoPath, commitSha);
    } catch (e) {
      setError(String(e));
      setMessage("加载提交文件列表失败");
      setChangedFiles([]);
      setSelectedFile("");
      setSelectedFilePatch("");
      setSelectedExplain("");
      return;
    }

    setChangedFiles(files);
    setSelectedFile(files[0] ?? "");
    setDetailTab("context");

    if (files.length > 0) {
      try {
        const patch = await getCommitFilePatch(repoPath, commitSha, files[0]);
        setSelectedFilePatch(patch);
      } catch (e) {
        setError(String(e));
        setSelectedFilePatch("");
      }
    } else {
      setSelectedFilePatch("该提交没有文件变更。");
    }

    try {
      const explainRes = await explainCommitShort(commitSha, repoPath);
      setSelectedExplain(explainRes.raw);
      const parsed = parseExplainCommit(explainRes.raw);
      setMessage(parsed.hasCheckpoint ? "已快速加载上下文摘要，可继续加载完整上下文。" : "该提交未关联 Entire checkpoint。");
    } catch (e) {
      setSelectedExplain("");
      setAgentContextError(String(e));
      setMessage("文件与 Diff 已加载；AI 上下文暂不可用（请检查 Entire CLI）。");
    }
  }

  async function refreshFilePatch(filePath: string) {
    if (!ensureRepoSelected() || !selectedCommit || !filePath) return;
    setError("");
    setMessage(`加载文件 patch: ${filePath}`);
    try {
      const patch = await getCommitFilePatch(repoPath, selectedCommit, filePath);
      setSelectedFilePatch(patch);
      setDetailTab("diff");
      setMessage("文件 patch 已加载");
    } catch (e) {
      setError(String(e));
      setMessage("加载文件 patch 失败");
      setSelectedFilePatch("");
    }
  }

  async function loadFullAgentContext() {
    if (!ensureRepoSelected() || !selectedCommit) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("加载完整上下文（无 pager 模式）...");
    try {
      const res = await explainCommit(selectedCommit, repoPath);
      setSelectedExplain(res.raw);
      setAgentContextError("");
      setDetailTab("context");
      setMessage(`完整上下文已加载（${res.raw.length} chars）`);
    } catch (e) {
      setAgentContextError(String(e));
      setError(String(e));
      setMessage("完整上下文加载失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function runSelectedReview() {
    if (!ensureRepoSelected() || !selectedCommit) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 review...");
    try {
      const record = await runReviewForCommit(selectedCommit, repoPath);
      await saveReviewRecord(record);
      await refreshReviewData();
      setMessage(`review 已完成: ${record.commitSha.slice(0, 8)}`);
    } catch (e) {
      setError(String(e));
      setMessage("review 失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function markFinding(reviewId: string, findingId: string, action: ReviewActionType) {
    if (!ensureRepoSelected()) return;
    try {
      await saveReviewAction({
        id: makeId(),
        repoPath,
        reviewId,
        findingId,
        action,
        createdAt: new Date().toISOString()
      });
      await refreshReviewData();
      setMessage(`已标记 ${action}`);
    } catch (e) {
      setError(String(e));
      setMessage("标记失败");
    }
  }

  function latestAction(reviewId: string, findingId: string): ReviewAction | undefined {
    return actions.find((a) => a.reviewId === reviewId && a.findingId === findingId);
  }

  async function chooseBranch(branchName: string) {
    if (!selectedRepo) return;
    setSelectedBranch(branchName);
    try {
      const rows = await getBranchCommits(selectedRepo.path, branchName, 80);
      setCommits(rows);
      setSelectedCommit(rows[0]?.sha ?? "");
      setMessage(`已切换分支: ${branchName}`);
    } catch (e) {
      setError(String(e));
      setMessage("切换分支失败");
    }
  }

  async function refreshScm() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("刷新提交与状态...");
    try {
      const [statusRes, branchList, graphRows, reviewRows, actionRows] = await Promise.all([
        getEntireStatusDetailed(repoPath),
        getLocalBranches(repoPath),
        getCommitGraph(repoPath, 140),
        loadReviewRecords(repoPath),
        loadReviewActions(repoPath)
      ]);
      setStatusText(statusRes.raw);
      setBranches(branchList);
      setCommitGraph(graphRows);
      setRecords(reviewRows);
      setActions(actionRows);
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const target = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(target);
      if (!target) {
        setCommits([]);
        setSelectedCommit("");
      } else {
        const rows = await getBranchCommits(repoPath, target, 80);
        setCommits(rows);
        setSelectedCommit(rows[0]?.sha ?? "");
      }
      setMessage("刷新完成");
    } catch (e) {
      setError(String(e));
      setMessage("刷新失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pullLatest() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 git pull...");
    try {
      const out = await gitPull(repoPath);
      setStatusText((prev) => [prev, `\n$ git pull --ff-only\n${out}`].filter(Boolean).join("\n"));
      await refreshBranchesAndCommits();
      setMessage("拉取完成");
    } catch (e) {
      setError(String(e));
      setMessage("拉取失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pushCurrent() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 git push...");
    try {
      const out = await gitPush(repoPath);
      setStatusText((prev) => [prev, `\n$ git push\n${out}`].filter(Boolean).join("\n"));
      setMessage("推送完成");
    } catch (e) {
      setError(String(e));
      setMessage("推送失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  useEffect(() => {
    void refreshRepositories().catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!installingDep) return;
    const timer = window.setInterval(() => {
      setInstallingElapsed((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [installingDep]);

  useEffect(() => {
    if (!runtimeJobId) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void invoke<RuntimeActionJobStatus>("get_runtime_dependency_action", { jobId: runtimeJobId })
        .then((job) => {
          if (stopped) return;
          setRuntimeJob(job);
          setRuntimeInstallLog(job.log || "");
          if (job.status === "running") return;

          stopped = true;
          window.clearInterval(timer);
          setInstallingDep("");
          setInstallingElapsed(0);
          setRuntimeJobId("");
          setMessage(
            job.status === "succeeded"
              ? `${job.action} ${job.name} completed`
              : `${job.action} ${job.name} failed`
          );
          if (job.status === "failed" && job.error) {
            setError(job.error);
          }
          void refreshRuntimeRequirements();
        })
        .catch((e) => {
          if (stopped) return;
          stopped = true;
          window.clearInterval(timer);
          setInstallingDep("");
          setInstallingElapsed(0);
          setRuntimeJobId("");
          setError(String(e));
        });
    }, 700);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [runtimeJobId]);

  useEffect(() => {
    window.localStorage.setItem(RUNTIME_STATUS_CACHE_KEY, JSON.stringify(runtimeStatus));
  }, [runtimeStatus]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_CACHE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_PANE_WIDTH_CACHE_KEY, String(rightPaneWidth));
  }, [rightPaneWidth]);

  useEffect(() => {
    const hasCheckedBefore = window.localStorage.getItem(RUNTIME_FIRST_CHECK_KEY) === "1";
    if (hasCheckedBefore) return;

    const dismissed = window.localStorage.getItem("giteam.runtime.setup.dismissed.v1") === "1";
    void refreshRuntimeRequirements()
      .then((res) => {
        window.localStorage.setItem(RUNTIME_FIRST_CHECK_KEY, "1");
        const missing = [res.git, res.entire].some((d) => !d.installed);
        if (!dismissed && missing) setShowEnvSetup(true);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedRepo) return;
    setError("");
    setMessage(`已选择仓库: ${selectedRepo.name}`);
    void Promise.all([refreshStatus(), refreshBranchesAndCommits(), refreshReviewData()]).catch((e) => {
      setError(String(e));
      setMessage("仓库数据加载失败");
    });
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!selectedCommit) return;
    void refreshCommitContext(selectedCommit);
  }, [selectedCommit]);

  useEffect(() => {
    if (opencodeSessions.length === 0) return;
    if (!opencodeSessions.some((s) => s.id === activeOpencodeSessionId)) {
      setActiveOpencodeSessionId(opencodeSessions[0].id);
    }
  }, [opencodeSessions, activeOpencodeSessionId]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    if (opencodeProviders.length > 0) return;
    void refreshOpencodeCatalog();
  }, [runtimeStatus.opencode.installed, selectedRepo?.id]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    void refreshOpencodeSessions().catch((e) => setError(String(e)));
  }, [runtimeStatus.opencode.installed, selectedRepo?.id]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    void loadOpencodeModelConfig();
  }, [runtimeStatus.opencode.installed, selectedRepo?.id]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    void refreshOpencodeConfiguredModels();
  }, [runtimeStatus.opencode.installed, selectedRepo?.id]);

  useEffect(() => {
    setOpencodeSavedModels([]);
  }, []);

  useEffect(() => {
    // Per repo visibility preferences (OpenCode "Manage models" equivalent).
    const key = `${OPENCODE_MODEL_VIS_KEY}:${selectedRepo?.id || "global"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setOpencodeHiddenModels(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as { hidden?: string[] } | null;
      const hidden = Array.isArray(parsed?.hidden) ? parsed!.hidden : [];
      const normalized = hidden.map((x) => normalizeModelRef(String(x || ""))).filter(Boolean);
      setOpencodeHiddenModels(new Set(normalized));
    } catch {
      setOpencodeHiddenModels(new Set());
    }
  }, [selectedRepo?.id]);

  useEffect(() => {
    const key = `${OPENCODE_MODEL_VIS_KEY}:${selectedRepo?.id || "global"}`;
    const hidden = Array.from(opencodeHiddenModels);
    try {
      window.localStorage.setItem(key, JSON.stringify({ hidden }));
    } catch {
      // ignore
    }
  }, [opencodeHiddenModels, selectedRepo?.id]);

  useEffect(() => {
    // Per repo model selection (OpenCode-like): draft + per-session overrides.
    const key = `${OPENCODE_MODEL_SELECTION_KEY}:${selectedRepo?.id || "global"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setOpencodeDraftModel("");
        setOpencodeSessionModel({});
        return;
      }
      const parsed = JSON.parse(raw) as { draft?: string; session?: Record<string, string> } | null;
      setOpencodeDraftModel(normalizeModelRef(String(parsed?.draft || "")));
      const session = parsed?.session && typeof parsed.session === "object" ? parsed.session : {};
      const next: Record<string, string> = {};
      for (const [sid, m] of Object.entries(session || {})) {
        const norm = normalizeModelRef(String(m || ""));
        if (sid && norm) next[sid] = norm;
      }
      setOpencodeSessionModel(next);
    } catch {
      setOpencodeDraftModel("");
      setOpencodeSessionModel({});
    }
  }, [selectedRepo?.id]);

  useEffect(() => {
    const key = `${OPENCODE_MODEL_SELECTION_KEY}:${selectedRepo?.id || "global"}`;
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          draft: opencodeDraftModel || "",
          session: opencodeSessionModel || {}
        })
      );
    } catch {
      // ignore
    }
  }, [opencodeDraftModel, opencodeSessionModel, selectedRepo?.id]);

  useEffect(() => {
    if (!showSettings || !runtimeStatus.opencode.installed || !selectedRepo) return;
    if (opencodeProviders.length === 0) {
      void refreshOpencodeCatalog();
    }
    void loadOpencodeModelConfig();
    void refreshOpencodeConfiguredModels();
  }, [showSettings, runtimeStatus.opencode.installed, selectedRepo?.id]);

  useEffect(() => {
    if (!showSettings || !runtimeStatus.opencode.installed || !selectedRepo) return;
    if (!opencodeModelProvider) return;
    void openProviderConfig();
  }, [showSettings, runtimeStatus.opencode.installed, selectedRepo?.id, opencodeModelProvider]);

  useEffect(() => {
    if (!activeOpencodeModel) return;
    pushOpencodeSavedModel(activeOpencodeModel);
  }, [activeOpencodeModel]);

  useEffect(() => {
    if (!showOpencodeModelPicker) return;
    // Avoid showing stale configured-model list while async /global/config refresh is in-flight.
    // This prevents brief flashes of providers that are present in /config but not in /global/config (e.g. 302ai).
    setOpencodeConfiguredProviders([]);
    setOpencodeConfiguredModelsByProvider({});
    setOpencodeConfiguredModelNamesByProvider({});
    void refreshOpencodeServerConfig();
    const onDown = (e: MouseEvent) => {
      const root = opencodeModelPickerRef.current;
      if (!root) return;
      const target = e.target as Node;
      if (root.contains(target)) return;
      setShowOpencodeModelPicker(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [showOpencodeModelPicker]);

  useEffect(() => {
    const total = opencodeMessages.length;
    const prevTotal = opencodePrevCountRef.current;
    updateActiveOpencodeSession((session) => {
      if (total <= 0) {
        return { ...session, visibleCount: OPENCODE_RECENT_VISIBLE };
      }
      if (prevTotal <= 0) {
        return { ...session, visibleCount: Math.min(total, OPENCODE_RECENT_VISIBLE) };
      }
      const growth = Math.max(0, total - prevTotal);
      const keep = session.visibleCount + growth;
      return {
        ...session,
        visibleCount: Math.min(total, Math.max(OPENCODE_RECENT_VISIBLE, keep))
      };
    });
    opencodePrevCountRef.current = total;
  }, [opencodeMessages.length, activeOpencodeSessionId]);

  useEffect(() => {
    setOpencodeSessions([]);
    setActiveOpencodeSessionId("");
    setOpencodeRunBusy(false);
    setOpencodeStreamingAssistantId("");
    setOpencodePromptInput("");
    opencodePrevCountRef.current = 0;
  }, [selectedRepo?.id]);

  useEffect(() => {
    resizeOpencodeInput();
  }, [opencodePromptInput]);

  useEffect(() => {
    opencodePrevCountRef.current = opencodeMessages.length;
    opencodeLoadingOlderRef.current = false;
    opencodePrevScrollHeightRef.current = 0;
    const sid = activeOpencodeSessionId;
    const session = opencodeSessions.find((s) => s.id === sid);
    if (session && !session.loaded && runtimeStatus.opencode.installed && selectedRepo) {
      void loadOpencodeSessionMessages(sid).catch((e) => setError(String(e)));
    }
    requestAnimationFrame(() => {
      const el = opencodeThreadRef.current;
      if (!el) return;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });
  }, [activeOpencodeSessionId, opencodeSessions, runtimeStatus.opencode.installed, selectedRepo?.id]);

  const opencodeRenderedMessages = useMemo(() => {
    const visible =
      opencodeMessages.length <= opencodeVisibleCount
        ? opencodeMessages
        : opencodeMessages.slice(opencodeMessages.length - opencodeVisibleCount);
    // Only show the "Thinking" placeholder for the currently-streaming assistant message.
    // Any older empty assistant messages are treated as transient placeholders and hidden.
    return visible.filter((msg) => {
      if (msg.role !== "assistant") return true;
      if ((msg.content || "").trim()) return true;
      return msg.id === opencodeStreamingAssistantId && opencodeRunBusy;
    });
  }, [opencodeMessages, opencodeVisibleCount, opencodeStreamingAssistantId, opencodeRunBusy]);

  function renderOpencodeDetailedPart(part: OpencodeDetailedPart, idx: number) {
    const type = String(part?.type || "");
    if (type === "text") {
      const text = String((part as any).text || "");
      if (!text.trim()) return null;
      return (
        <div key={`ocd-text-${idx}`} className="opencode-detail-part opencode-detail-text">
          <MarkdownLite source={text} />
        </div>
      );
    }
    if (type === "reasoning") {
      const text = String((part as any).text || "");
      const meta = (part as any).metadata;
      return (
        <details key={`ocd-reason-${idx}`} className="opencode-detail-part opencode-detail-reasoning" open={false}>
          <summary>
            <strong>Reasoning</strong>
            {meta ? <span className="small muted">（metadata）</span> : null}
          </summary>
          <pre className="opencode-detail-pre">{text || toDisplayJson(part)}</pre>
        </details>
      );
    }
    if (type === "step-start" || type === "step-finish") {
      const snapshot = (part as any).snapshot ? String((part as any).snapshot) : "";
      const reason = (part as any).reason ? String((part as any).reason) : "";
      return (
        <div key={`ocd-step-${idx}`} className="opencode-detail-part opencode-detail-step">
          <span className="chip">{type}</span>
          {reason ? <span className="small muted">{reason}</span> : null}
          {snapshot ? <code className="small muted">{snapshot.slice(0, 12)}</code> : null}
        </div>
      );
    }
    if (type === "tool") {
      const tool = String((part as any).tool || "");
      const callID = String((part as any).callID || "");
      const state = (part as any).state;
      const status = state?.status ? String(state.status) : "";
      const input = state?.input;
      const output = state?.output;
      return (
        <details key={`ocd-tool-${idx}`} className="opencode-detail-part opencode-detail-tool" open={false}>
          <summary>
            <strong>{tool || "tool"}</strong>
            {status ? <span className="small muted">{status}</span> : null}
            {callID ? <code className="small muted">{callID}</code> : null}
          </summary>
          {input ? (
            <details className="opencode-detail-sub" open={false}>
              <summary>input</summary>
              <pre className="opencode-detail-pre">{toDisplayJson(input)}</pre>
            </details>
          ) : null}
          {output ? (
            <details className="opencode-detail-sub" open={false}>
              <summary>output</summary>
              <pre className="opencode-detail-pre">{typeof output === "string" ? output : toDisplayJson(output, 20000)}</pre>
            </details>
          ) : null}
          {!input && !output ? <pre className="opencode-detail-pre">{toDisplayJson(part)}</pre> : null}
        </details>
      );
    }
    if (type === "patch") {
      const files = Array.isArray((part as any).files) ? ((part as any).files as unknown[]) : [];
      const hash = (part as any).hash ? String((part as any).hash) : "";
      return (
        <details key={`ocd-patch-${idx}`} className="opencode-detail-part opencode-detail-patch" open={false}>
          <summary>
            <strong>patch</strong>
            {hash ? <code className="small muted">{hash.slice(0, 12)}</code> : null}
            {files.length ? <span className="small muted">{files.length} files</span> : null}
          </summary>
          {files.length ? (
            <ul className="opencode-detail-files">
              {files.map((f, j) => (
                <li key={`ocd-patch-file-${idx}-${j}`}>
                  <code>{String(f)}</code>
                </li>
              ))}
            </ul>
          ) : (
            <pre className="opencode-detail-pre">{toDisplayJson(part)}</pre>
          )}
        </details>
      );
    }
    return (
      <details key={`ocd-unknown-${idx}`} className="opencode-detail-part opencode-detail-unknown" open={false}>
        <summary>
          <strong>{type || "part"}</strong>
          <span className="small muted">raw</span>
        </summary>
        <pre className="opencode-detail-pre">{toDisplayJson(part, 20000)}</pre>
      </details>
    );
  }

  function renderOpencodeDetailedMessage(m: OpencodeDetailedMessage, idx: number) {
    const info = (m?.info || {}) as Record<string, unknown>;
    const role = String(info.role || "");
    const agent = String(info.agent || "");
    const providerID = String((info as any).providerID || (info as any).model?.providerID || "");
    const modelID = String((info as any).modelID || (info as any).model?.modelID || "");
    const created = (info as any).time?.created ? Number((info as any).time.created) : 0;
    const completed = (info as any).time?.completed ? Number((info as any).time.completed) : 0;
    const titleBits = [role, agent, providerID && modelID ? `${providerID}/${modelID}` : modelID || providerID].filter(Boolean);
    const parts = Array.isArray(m?.parts) ? (m.parts as OpencodeDetailedPart[]) : [];
    return (
      <div key={`ocd-msg-${idx}`} className="opencode-detail-msg">
        <div className="opencode-detail-msg-head">
          <strong>{titleBits.join(" · ") || `message ${idx + 1}`}</strong>
          {created ? <span className="small muted">{new Date(created).toLocaleString()}</span> : null}
          {completed && completed !== created ? (
            <span className="small muted">{`→ ${new Date(completed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}</span>
          ) : null}
        </div>
        <div className="opencode-detail-msg-parts">
          {parts.length === 0 ? <pre className="opencode-detail-pre">{toDisplayJson(m, 20000)}</pre> : parts.map(renderOpencodeDetailedPart)}
        </div>
      </div>
    );
  }

  const opencodeExploreTaskByLocalMessageId = useMemo(() => {
    const mapped: Record<string, unknown> = {};
    for (const [localId, serverId] of Object.entries(opencodeServerMessageIdByLocalId)) {
      const payload = opencodeExploreTaskByServerMessageId[serverId];
      if (payload) mapped[localId] = payload;
    }
    return mapped;
  }, [opencodeServerMessageIdByLocalId, opencodeExploreTaskByServerMessageId]);

  useEffect(() => {
    const mid = opencodeExpandedDetailMessageId.trim();
    const sid = activeOpencodeSession?.id?.trim() || "";
    if (!sid || !mid) return;
    if (!opencodeRunBusy) return;
    // When a detail view is expanded during a run, keep it fresh without requiring tab switches.
    const t = window.setInterval(() => {
      void loadOpencodeMessageDetails(sid, mid, 80);
    }, 1200);
    return () => window.clearInterval(t);
  }, [opencodeExpandedDetailMessageId, activeOpencodeSession?.id, opencodeRunBusy, opencodeServerMessageIdByLocalId]);
  const opencodeHiddenHistorySpacer = useMemo(() => {
    const hiddenCount = Math.max(0, opencodeMessages.length - opencodeVisibleCount);
    if (hiddenCount <= 0) return 0;
    const hidden = opencodeMessages.slice(0, hiddenCount);
    if (hidden.length === 0) return 0;
    const estimate = hidden.reduce((sum, msg) => {
      const text = (msg.content || "").trim();
      const charCount = text.length;
      const explicitLines = (text.match(/\n/g)?.length ?? 0) + 1;
      const wrappedLines = Math.max(1, Math.ceil(charCount / 42));
      const lineCount = Math.max(explicitLines, wrappedLines);
      return sum + 34 + Math.min(22, lineCount) * 15;
    }, 0);
    return Math.min(24000, Math.max(120, estimate));
  }, [opencodeMessages, opencodeVisibleCount]);

  const opencodeHasHiddenHistory = opencodeVisibleCount < opencodeMessages.length;

  function loadOlderOpencodeHistory() {
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (!opencodeHasHiddenHistory) return;
    opencodeLoadingOlderRef.current = true;
    opencodePrevScrollHeightRef.current = el.scrollHeight;
    updateActiveOpencodeSession((session) => ({
      ...session,
      visibleCount: Math.min(session.messages.length, session.visibleCount + OPENCODE_PAGE_SIZE)
    }));
  }

  function onOpencodeThreadScroll() {
    const el = opencodeThreadRef.current;
    if (!el) return;
    const nearTop = el.scrollTop <= 96;
    if (!nearTop) return;
    if (!opencodeHasHiddenHistory) return;
    loadOlderOpencodeHistory();
  }

  useEffect(() => {
    if (!opencodeLoadingOlderRef.current) return;
    const el = opencodeThreadRef.current;
    if (!el) return;
    const prevHeight = opencodePrevScrollHeightRef.current;
    requestAnimationFrame(() => {
      const delta = el.scrollHeight - prevHeight;
      if (delta > 0) {
        el.scrollTop += delta;
      }
      opencodeLoadingOlderRef.current = false;
      opencodePrevScrollHeightRef.current = 0;
    });
  }, [opencodeVisibleCount]);

  useEffect(() => {
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (!opencodeHasHiddenHistory) return;
    const notOverflowing = el.scrollHeight <= el.clientHeight + 1;
    if (!notOverflowing) return;
    updateActiveOpencodeSession((session) => ({
      ...session,
      visibleCount: Math.min(session.messages.length, session.visibleCount + OPENCODE_PAGE_SIZE)
    }));
  }, [opencodeHasHiddenHistory, opencodeMessages.length, opencodeVisibleCount, opencodeRenderedMessages.length]);

  useEffect(() => {
    if (!repoContextMenu && !commitContextMenu) return;
    const dismiss = () => {
      setRepoContextMenu(null);
      setCommitContextMenu(null);
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss);
    };
  }, [repoContextMenu, commitContextMenu]);

  useEffect(() => {
    const onNativeContextMenu = (evt: MouseEvent) => {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest(".wb-repo-ico[data-repo-id]") as HTMLElement | null;
      if (!btn) return;
      const repoId = btn.dataset.repoId;
      if (!repoId) return;
      const repo = repos.find((r) => r.id === repoId);
      if (!repo) return;

      evt.preventDefault();
      evt.stopPropagation();
      openRepoContextMenu(evt.clientX, evt.clientY, repo);
    };

    window.addEventListener("contextmenu", onNativeContextMenu, { capture: true });
    return () => window.removeEventListener("contextmenu", onNativeContextMenu, { capture: true });
  }, [repos]);

  const activityBar = (
    <div
      className="wb-activity-inner"
      onContextMenuCapture={(e) => {
        const target = e.target as HTMLElement | null;
        const btn = target?.closest(".wb-repo-ico[data-repo-id]") as HTMLElement | null;
        if (!btn) return;
        const repoId = btn.dataset.repoId;
        if (!repoId) return;
        const repo = repos.find((r) => r.id === repoId);
        if (!repo) return;
        e.preventDefault();
        e.stopPropagation();
        openRepoContextMenu(e.clientX, e.clientY, repo);
      }}
    >
      <div className="wb-activity-top">
        <div className="wb-repo-icons" aria-label="Repositories">
          {repos.map((r) => {
            const active = selectedRepo?.id === r.id;
            return (
              <button
                key={r.id}
                className={active ? "wb-repo-ico active" : "wb-repo-ico"}
                data-repo-id={r.id}
                title={`${r.name}\n${r.path}`}
                onClick={() => {
                  if (busy) return;
                  setSelectedRepo(r);
                }}
              >
                {firstLetter(r.name)}
              </button>
            );
          })}

          <button
            className="wb-repo-ico add"
            title="导入项目"
            onClick={() => void pickAndImportRepository()}
            disabled={busy}
          >
            +
          </button>
        </div>
      </div>
      <div className="wb-activity-bottom">
        <button
          className="wb-act-btn"
          title="Settings"
          onClick={() => setShowSettings(true)}
        >
          <span className="wb-act-ico">⚙</span>
        </button>
      </div>
    </div>
  );

  const sideBar = (
    <div className="wb-sidebar-inner">
      <div className="wb-sidebar-section">
        <div className="wb-commits-head">
          <div className="wb-sidebar-title">COMMITS</div>
          <div className="wb-commits-toolbar">
            <button className="scm-btn primary scm-icon-btn" onClick={() => void refreshScm()} disabled={busy} title="Refresh">
              ⟳
            </button>
            <details className="scm-more">
              <summary className="scm-btn scm-icon-btn" title="More">
                ⋯
              </summary>
              <div className="scm-menu">
                <button
                  className="scm-menu-item"
                  onClick={(e) => {
                    const box = e.currentTarget.closest("details");
                    if (box) box.removeAttribute("open");
                    void pullLatest();
                  }}
                  disabled={busy}
                  title="git pull --ff-only"
                >
                  Pull
                </button>
                <button
                  className="scm-menu-item"
                  onClick={(e) => {
                    const box = e.currentTarget.closest("details");
                    if (box) box.removeAttribute("open");
                    void pushCurrent();
                  }}
                  disabled={busy}
                  title="git push"
                >
                  Push
                </button>
              </div>
            </details>
          </div>
        </div>
        <div className="wb-commits-pane">
          <div className="commit-list wb-commits-list">
            {commits.map((c) => (
              <button
                key={c.sha}
                className={selectedCommit === c.sha ? "commit-item selected" : "commit-item"}
                onClick={() => {
                  if (busy) return;
                  setSelectedCommit(c.sha);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const x = Math.min(e.clientX, window.innerWidth - 168);
                  const y = Math.min(e.clientY, window.innerHeight - 60);
                  setCommitContextMenu({ x: Math.max(8, x), y: Math.max(8, y), sha: c.sha });
                }}
              >
                <p>{c.subject}</p>
                <p className="small muted">{c.author}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const editor = (
    <div className="wb-editor-inner">
      <div className="wb-editor-header">
        <div className="wb-breadcrumbs">
          <strong>{selectedRepo?.name ?? "No Project"}</strong>
          <span className="muted">/</span>
          <span className="muted">{selectedBranch || "—"}</span>
        </div>
      </div>

      <div
        className="wb-editor-content"
        style={{ "--wb-right-width": `${rightPaneWidth}px` } as CSSProperties}
      >
        <div className="wb-col wb-col-center">
          <div className="panel">
            <div className="wb-editor-reading-head">
              <div className="tab-row wb-reading-tabs">
                <button
                  className={detailTab === "context" ? "tab active" : "tab"}
                  onClick={() => setDetailTab("context")}
                >
                  Agent Context
                </button>
                <button className={detailTab === "diff" ? "tab active" : "tab"} onClick={() => setDetailTab("diff")}>
                  Diff
                </button>
                <button
                  className={detailTab === "findings" ? "tab active" : "tab"}
                  onClick={() => setDetailTab("findings")}
                >
                  Findings
                </button>
                <button className="chip" onClick={() => void runSelectedReview()} disabled={busy || !selectedCommit}>
                  Review
                </button>
              </div>
              {selectedFile ? <div className="wb-reading-sub muted">{selectedFile}</div> : null}
            </div>

            <div className="wb-reading-body">
              {detailTab === "diff" ? (
                <div className="diff-view">
                  <div className="diff-files-strip">
                    {changedFiles.length === 0 ? (
                      <span className="small muted">No changed files</span>
                    ) : (
                      changedFiles.map((f) => (
                        <button
                          key={f}
                          className={selectedFile === f ? "file-item selected" : "file-item"}
                          onClick={() => {
                            setSelectedFile(f);
                            void refreshFilePatch(f);
                          }}
                        >
                          <span className="file-dot" />
                          <span>{f}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="diff-header">
                    <span>Old</span>
                    <span>New</span>
                  </div>
                  <div className="diff-body">
                    {diffRows.length === 0 ? <div className="diff-empty">选择文件后显示差异对比</div> : null}
                    {diffRows.map((r, i) => (
                      <div key={`${i}-${r.kind}`} className={`diff-row ${r.kind}`}>
                        <div className="cell old">{r.left}</div>
                        <div className="cell new">{r.right}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : detailTab === "context" ? (
                <div className="wb-context wb-reading-scroll">
                  <div className="context-section-card">
                    <div className="context-section-head">
                      <strong>Project Status</strong>
                      <span className="small muted">entire status --detailed</span>
                    </div>
                    {statusText ? (
                      <div className="status-structured">
                        <div className="status-pill-row">
                          {parsedStatus.headline ? <span className="status-pill">{parsedStatus.headline}</span> : null}
                          {parsedStatus.project ? <span className="status-pill">{parsedStatus.project}</span> : null}
                        </div>
                        {parsedStatus.sessions.length > 0 ? (
                          <div className="status-session-list">
                            {parsedStatus.sessions.map((s, idx) => (
                              <div key={`${s.title}-${idx}`} className="status-session-card">
                                <div className="status-session-title">{s.title}</div>
                                {s.quote ? <p className="small muted">"{s.quote}"</p> : null}
                                {s.meta ? <p className="small muted">{s.meta}</p> : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <pre className="status-embedded-pre">{statusText}</pre>
                        )}
                      </div>
                    ) : (
                      <pre className="status-embedded-pre">No status output yet.</pre>
                    )}
                  </div>

                  <div className="context-section-card">
                    <div className="context-section-head">
                      <strong>Agent Context</strong>
                      <span className="small muted">entire explain --commit --no-pager</span>
                    </div>
                    {selectedParsed ? (
                      <p className="small muted">
                        checkpoint={selectedParsed.checkpointId ?? "none"} · session={selectedParsed.sessionId ?? "none"} ·
                        tokens={selectedParsed.tokens ?? "n/a"}
                      </p>
                    ) : null}
                    <div className="agent-meta-grid">
                      {parsedAgentContext.checkpoint ? <span className="meta-chip">Checkpoint: {parsedAgentContext.checkpoint}</span> : null}
                      {parsedAgentContext.session ? <span className="meta-chip">Session: {parsedAgentContext.session}</span> : null}
                      {parsedAgentContext.created ? <span className="meta-chip">Created: {parsedAgentContext.created}</span> : null}
                      {parsedAgentContext.author ? <span className="meta-chip">Author: {parsedAgentContext.author}</span> : null}
                    </div>
                    {parsedAgentContext.commits ? (
                      <div className="context-block">
                        <div className="context-block-title">Commits</div>
                        <p className="small">{parsedAgentContext.commits}</p>
                      </div>
                    ) : null}
                    {parsedAgentContext.intent ? (
                      <div className="context-block">
                        <div className="context-block-title">Intent</div>
                        <MarkdownLite source={parsedAgentContext.intent} />
                      </div>
                    ) : null}
                    {(parsedAgentContext.filesRaw || parsedAgentContext.files.length > 0) ? (
                      <div className="context-block">
                        <div className="context-block-title">Files</div>
                        <MarkdownLite
                          source={
                            parsedAgentContext.files.length > 0
                              ? parsedAgentContext.files.map((f) => `- \`${f}\``).join("\n")
                              : (parsedAgentContext.filesRaw ?? "")
                          }
                        />
                      </div>
                    ) : null}
                    {parsedAgentContext.transcript.length > 0 ? (
                      <div className="context-block">
                        <div className="context-block-title">Transcript</div>
                        <div className="transcript-list">
                          {parsedAgentContext.transcript.map((m, idx) => (
                            <div key={`${m.role}-${idx}`} className={m.role === "User" ? "transcript-msg user" : "transcript-msg assistant"}>
                              <div className="transcript-role">{m.role}</div>
                              <MarkdownLite source={m.content} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="context-actions">
                      <button className="chip" onClick={() => void loadFullAgentContext()} disabled={busy || !selectedCommit}>
                        Load full context
                      </button>
                    </div>
                    {agentContextError ? (
                      <div className="context-error-card">
                        <div className="context-block-title">Agent Context Unavailable</div>
                        <p className="small">
                          Failed to load via <code>entire explain</code>. Check that <code>entire</code> is installed and
                          available in PATH for the packaged app.
                        </p>
                        <pre>{agentContextError}</pre>
                      </div>
                    ) : null}
                    {!parsedAgentContext.transcript.length && !parsedAgentContext.intent ? <MarkdownLite source={selectedExplain} /> : null}
                  </div>
                </div>
              ) : (
                <div className="wb-reading-scroll">
                  {!selectedReview ? <p className="small muted">当前提交暂无 review</p> : null}
                  {selectedReview?.findings.map((f) => {
                    const act = latestAction(selectedReview.id, f.id);
                    return (
                      <div key={f.id} className="finding-item">
                        <p>
                          <strong>{f.severity.toUpperCase()}</strong> {f.file}
                        </p>
                        <p>{f.summary}</p>
                        <div className="toolbar">
                          <button className="chip" onClick={() => void markFinding(selectedReview.id, f.id, "accept")}>
                            accept
                          </button>
                          <button className="chip" onClick={() => void markFinding(selectedReview.id, f.id, "dismiss")}>
                            dismiss
                          </button>
                          <button className="chip" onClick={() => void markFinding(selectedReview.id, f.id, "todo")}>
                            todo
                          </button>
                        </div>
                        <p className="small muted">latest action: {act ? `${act.action} @ ${act.createdAt}` : "none"}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className={draggingSplit?.kind === "right" ? "wb-col-splitter active" : "wb-col-splitter"}
          role="separator"
          aria-orientation="vertical"
          onMouseDown={(e) => beginSplitDrag("right", e.clientX)}
        />

        <div className="wb-col wb-col-right">
          {runtimeStatus.opencode.installed ? (
            <div className={`panel opencode-canvas${opencodeMessages.length > 0 ? " has-chat" : ""}`}>
              <div className="opencode-shell">
                <aside className={showOpencodeSessionRail ? "opencode-session-rail open" : "opencode-session-rail"}>
                  <div className="opencode-session-rail-head">
                    <strong>Sessions</strong>
                    <button className="chip" onClick={() => void createAndSwitchOpencodeSession()}>New</button>
                  </div>
                  <div className="opencode-session-list">
                    {opencodeSessions.map((s) => (
                      <button
                        key={`rail-${s.id}`}
                        className={s.id === activeOpencodeSession?.id ? "opencode-session-item active" : "opencode-session-item"}
                        onClick={() => setActiveOpencodeSessionId(s.id)}
                      >
                        <span>{s.title}</span>
                        <small>{new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="opencode-main">
                  <div className="opencode-headline">
                    <button className="chip opencode-rail-toggle" onClick={() => setShowOpencodeSessionRail((v) => !v)}>
                      {showOpencodeSessionRail ? "Hide sessions" : "Show sessions"}
                    </button>
                    <button className="chip opencode-rail-toggle" onClick={() => setShowOpencodeDebugLog((v) => !v)}>
                      {showOpencodeDebugLog ? "Hide logs" : "Show logs"}
                    </button>
                    <p className="small muted opencode-path">{selectedRepo?.path || "No repository selected"}</p>
                  </div>
                  <div className="opencode-session-tabs">
                    <button className="opencode-session-tab new pinned" onClick={() => void createAndSwitchOpencodeSession()}>
                      + New Session
                    </button>
                    {opencodeSessions.map((s) => (
                      <div
                        key={`tab-${s.id}`}
                        className={s.id === activeOpencodeSession?.id ? "opencode-session-tab active" : "opencode-session-tab"}
                        onClick={() => setActiveOpencodeSessionId(s.id)}
                        role="button"
                      >
                        <span>{s.title}</span>
                        <button
                          className="opencode-tab-close"
                          disabled={opencodeSessions.length <= 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeOpencodeSession(s.id);
                          }}
                          title="Close session"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="opencode-thread" ref={opencodeThreadRef} onScroll={onOpencodeThreadScroll}>
                    {opencodeHasHiddenHistory ? (
                      <button className="opencode-load-more" onClick={loadOlderOpencodeHistory}>
                        Load earlier messages
                      </button>
                    ) : null}
                    {opencodeHiddenHistorySpacer > 0 ? (
                      <div
                        className="opencode-history-spacer"
                        aria-hidden="true"
                        style={{ height: `${opencodeHiddenHistorySpacer}px` }}
                      />
                    ) : null}
                    {opencodeMessages.length === 0 ? (
                      <div className="opencode-empty-state">
                        <strong>Start a focused coding session</strong>
                        <p className="small muted">Describe the task in one sentence. Enter to run, Shift+Enter for newline.</p>
                      </div>
                    ) : (
                      opencodeRenderedMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={msg.role === "user" ? "opencode-msg opencode-msg-user" : "opencode-msg opencode-msg-assistant"}
                        >
                          {msg.role === "assistant" ? (
                            <div className="opencode-msg-meta">
                              {(opencodeExploreTaskByLocalMessageId[msg.id] || opencodeExpandedDetailMessageId === msg.id) ? (
                                <button
                                  className="opencode-detail-link"
                                  onClick={() => {
                                    const sid = activeOpencodeSession?.id || "";
                                    if (!sid) return;
                                    const next = opencodeExpandedDetailMessageId === msg.id ? "" : msg.id;
                                    setOpencodeExpandedDetailMessageId(next);
                                    if (next) void loadOpencodeMessageDetails(sid, msg.id, 80);
                                  }}
                                >
                                  {opencodeExpandedDetailMessageId === msg.id ? "收起执行细节" : "查看执行细节"}
                                </button>
                              ) : null}
                              {opencodeDetailsLoadingByMessageId[msg.id] ? <span className="small muted">加载中…</span> : null}
                              {msg.id === opencodeStreamingAssistantId && opencodeRunBusy ? (
                                <span className="small muted">
                                  {(() => {
                                    const serverMid = (opencodeServerMessageIdByLocalId[msg.id] || "").trim();
                                    const lines = serverMid ? (opencodeTraceEventsByServerMessageId[serverMid] || []) : [];
                                    const last = lines.length ? lines[lines.length - 1] : (opencodeThinkingLines[opencodeThinkingLines.length - 1] || "");
                                    return last ? `执行中 · ${last}` : "执行中 · 等待执行事件…";
                                  })()}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          {msg.content.trim() ? (
                            <div className="opencode-msg-body">
                              <MarkdownLite source={msg.content} />
                              {msg.role === "assistant" && msg.id === opencodeStreamingAssistantId && opencodeRunBusy ? (
                                <span className="opencode-stream-caret" aria-label="running" />
                              ) : null}
                            </div>
                          ) : (
                            <div className="opencode-thinking-wrap">
                              <div className="opencode-thinking">
                                <span />
                                <span />
                                <span />
                                <em>Thinking</em>
                              </div>
                            </div>
                          )}
                          {msg.role === "assistant" && opencodeExpandedDetailMessageId === msg.id ? (
                            <div className="opencode-msg-details">
                              {opencodeServerMessageIdByLocalId[msg.id] ? null : (
                                <div className="small muted">等待服务端消息 ID（执行中会自动补齐）…</div>
                              )}
                              {opencodeDetailsErrorByMessageId[msg.id] ? (
                                <div className="small" style={{ color: "var(--danger)" }}>
                                  {opencodeDetailsErrorByMessageId[msg.id]}
                                </div>
                              ) : null}
                              {opencodeDetailsByMessageId[msg.id] ? (
                                <div className="opencode-detail-msg-parts">
                                  {(opencodeDetailsByMessageId[msg.id]?.parts || []).map(renderOpencodeDetailedPart)}
                                </div>
                              ) : (
                                <div className="small muted">暂无细节（可能还在生成中）。</div>
                              )}
                              <div className="opencode-msg-details-actions">
                                <button
                                  className="chip"
                                  disabled={!activeOpencodeSession?.id || !!opencodeDetailsLoadingByMessageId[msg.id]}
                                  onClick={() => activeOpencodeSession?.id && void loadOpencodeMessageDetails(activeOpencodeSession.id, msg.id, 80)}
                                >
                                  刷新
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {msg.role === "assistant" && msg.id === opencodeStreamingAssistantId && opencodeRunBusy ? (
                            <div className="opencode-msg-progress">
                              <details className="opencode-progress-details" open={true}>
                                <summary>
                                  <strong>执行中</strong>
                                  <span className="small muted">
                                    {(() => {
                                      const serverMid = opencodeServerMessageIdByLocalId[msg.id] || "";
                                      const lines = serverMid ? (opencodeTraceEventsByServerMessageId[serverMid] || []) : [];
                                      return lines.length ? ` · ${lines[lines.length - 1]}` : " · 等待执行事件…";
                                    })()}
                                  </span>
                                </summary>
                                {(() => {
                                  const serverMid = opencodeServerMessageIdByLocalId[msg.id] || "";
                                  const lines = serverMid ? (opencodeTraceEventsByServerMessageId[serverMid] || []) : [];
                                  return (
                                    <div className="opencode-progress-lines">
                                      {(lines.length ? lines.slice(-12) : ["等待执行事件…"]).map((line, idx) => (
                                        <div key={`opencode-prog-${idx}`} className="opencode-progress-line">
                                          {line}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </details>
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                    {opencodeRunBusy ? (
                      <details className="opencode-thinking-log opencode-thinking-log-floating" open={false}>
                        <summary className="opencode-thinking-title">
                          <span>正在探索</span>
                          {opencodeThinkingReadCount > 0 || opencodeThinkingSearchCount > 0 ? (
                            <strong>{` ${opencodeThinkingReadCount} 次读取, ${opencodeThinkingSearchCount} 次搜索`}</strong>
                          ) : null}
                          <span className="opencode-thinking-summary-tail">
                            {opencodeThinkingLines.length > 0 ? opencodeThinkingLines[opencodeThinkingLines.length - 1] : "正在启动任务…"}
                          </span>
                        </summary>
                        <div className="opencode-thinking-lines">
                          {opencodeThinkingLines.length === 0 ? (
                            <div>Waiting for tool activity...</div>
                          ) : (
                            opencodeThinkingLines.slice(-40).map((line, idx) => (
                              <div key={`think-live-${idx}`} className="opencode-thinking-line">{line}</div>
                            ))
                          )}
                        </div>
                      </details>
                    ) : null}
                  </div>
                  <div className="opencode-input-row">
                    <div className="opencode-model-picker-wrap" ref={opencodeModelPickerRef}>
                      <button
                        className="chip opencode-model-trigger"
                        onClick={() => {
                          const next = !showOpencodeModelPicker;
                          if (next) {
                            // Clear stale list before first paint of the picker.
                            setOpencodeConfiguredProviders([]);
                            setOpencodeConfiguredModelsByProvider({});
                            setOpencodeConfiguredModelNamesByProvider({});
                            // Opening the picker should not force-select server /config.model into UI state.
                            // We only need latest configured catalog here.
                            void refreshOpencodeServerConfig({ syncSelection: false, includeCurrentModel: false });
                          }
                          setShowOpencodeModelPicker(next);
                        }}
                      >
                        {(() => {
                          if (!activeOpencodeModel) return "Select model";
                          const parsed = parseModelRef(activeOpencodeModel);
                          const provider = resolveProviderAliasWithNames(
                            parsed?.provider || "",
                            opencodeModelsByProvider,
                            opencodeProviderNames
                          ) || (parsed?.provider || "");
                          const mid = parsed?.model || "";
                          const name =
                            (provider ? (opencodeModelNamesByProvider[provider]?.[mid] || opencodeConfiguredModelNamesByProvider[provider]?.[mid]) : "") ||
                            "";
                          return name || activeOpencodeModel;
                        })()}
                      </button>
                      {showOpencodeModelPicker ? (
                        <div className="opencode-model-picker">
                          <div className="opencode-model-picker-head">
                            <input
                              className="path-input opencode-model-search"
                              placeholder="搜索已配置模型..."
                              value={opencodeModelPickerSearch}
                              onChange={(e) => setOpencodeModelPickerSearch(e.target.value)}
                            />
                            <button
                              className="chip opencode-picker-config-btn"
                              title="自定义提供商"
                              onClick={() => {
                                setShowOpencodeCustomProvider(true);
                                setShowOpencodeModelPicker(false);
                              }}
                            >
                              ＋
                            </button>
                            <button
                              className="chip opencode-picker-config-btn"
                              title="选择/连接提供商"
                              onClick={() => {
                                setShowOpencodeProviderPicker(true);
                                // Clear filters so the left list shows all providers by default.
                                setOpencodeProviderPickerSearch("");
                                setOpencodeProviderPickerProvider(opencodeModelProvider);
                                setOpencodeProviderPickerModelSearch("");
                                void refreshOpencodeCatalog({ syncSelection: false, includeCurrentModel: false });
                                setShowOpencodeModelPicker(false);
                              }}
                            >
                              ⚙
                            </button>
                          </div>
                          <div className="opencode-model-list-col">
                            {opencodeConfiguredModelCandidates.length === 0 ? (
                              <div className="small muted">暂无已配置模型。点击“＋”添加自定义提供商，或点“⚙”连接厂商。</div>
                            ) : (
                              opencodeConfiguredModelCandidates.map((m) => (
                                <button
                                  key={`saved-model-${m}`}
                                  className={m === activeOpencodeModel ? "file-item selected" : "file-item"}
                                  onClick={() => {
                                    void applyOpencodeModel(m);
                                    setShowOpencodeModelPicker(false);
                                  }}
                                  title={m}
                                >
                                  {(() => {
                                    const parsed = parseModelRef(m);
                                    const provider = resolveProviderAliasWithNames(
                                      parsed?.provider || "",
                                      opencodeModelsByProvider,
                                      opencodeProviderNames
                                    ) || (parsed?.provider || "");
                                    const mid = parsed?.model || "";
                                    const name =
                                      (provider ? (opencodeConfiguredModelNamesByProvider[provider]?.[mid] || opencodeModelNamesByProvider[provider]?.[mid]) : "") ||
                                      "";
                                    return (
                                      <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                                        <span>{name || m}</span>
                                        {name ? <span className="small muted">{m}</span> : null}
                                      </span>
                                    );
                                  })()}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="opencode-input-shell">
                      <textarea
                        ref={opencodeInputRef}
                        className="opencode-input"
                        placeholder="Ask OpenCode to code, inspect, or fix..."
                        value={opencodePromptInput}
                        onChange={(e) => setOpencodePromptInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (opencodeRunBusy) return;
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void runOpencodePrompt();
                          }
                        }}
                        rows={1}
                      />
                      <div className="opencode-input-hint">Enter to send · Shift+Enter newline</div>
                    </div>
                    <button
                      className="chip opencode-run-btn"
                      disabled={opencodeRunBusy || !opencodePromptInput.trim()}
                      onClick={() => void runOpencodePrompt()}
                    >
                      {opencodeRunBusy ? "Running..." : "Run"}
                    </button>
                  </div>
                  <div className="opencode-footer-row">
                    <span className="small muted">Current model</span>
                    <code>{activeOpencodeModel || "(not set)"}</code>
                  </div>
                  {showOpencodeDebugLog ? (
                    <div className="opencode-debug-panel">
                      <div className="opencode-debug-head">
                        <strong>OpenCode Debug Log</strong>
                        <button className="chip" onClick={() => setOpencodeDebugLogs([])}>Clear</button>
                      </div>
                      <pre className="opencode-debug-log">
                        {opencodeDebugLogs.length === 0 ? "No logs yet." : opencodeDebugLogs.join("\n")}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel opencode-panel opencode-empty-panel">
              <div className="opencode-hero">
                <div className="opencode-hero-title">OpenCode Agent</div>
                <p className="small muted">Install `opencode` from Plugins to enable the right-side toolkit.</p>
              </div>
              <div className="opencode-dock">
                <div className="opencode-footer-row">
                  <span>››</span>
                  <button className="chip" disabled>Run</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const panel = <div className="wb-panel-inner" />;

  return (
    <>
      <Workbench
        activityBar={activityBar}
        sideBar={sideBar}
        editor={editor}
        panel={panel}
        sidebarWidth={sidebarWidth}
        sidebarResizing={draggingSplit?.kind === "sidebar"}
        onSidebarResizeStart={(e) => beginSplitDrag("sidebar", e.clientX)}
        statusBar={
          <div className="wb-status-inner">
            <div className="wb-status-group">
              <button className="wb-status-btn" title="当前仓库/分支">
                {(selectedRepo?.name ?? "No Project") + " · " + (selectedBranch || "—")}
              </button>
              <button
                className={showGraphPopover ? "wb-status-btn active" : "wb-status-btn"}
                title="Graph"
                onClick={() => setShowGraphPopover((v) => !v)}
              >
                ⎇
              </button>
            </div>
            <div className="wb-status-group" />
          </div>
        }
        panelPlacement={panelPlacement}
      />

      {overlayBusy ? (
        <div className="ui-busy-layer" role="status" aria-live="polite">
          <div className="ui-busy-card">
            <span className="ui-busy-spinner" aria-hidden="true" />
            <div className="ui-busy-copy">{message || "Loading..."}</div>
            <div className="ui-busy-track" aria-hidden="true">
              <span className="ui-busy-bar" />
            </div>
          </div>
        </div>
      ) : null}

      {showGraphPopover ? (
        <div className="wb-graph-popover" role="dialog" aria-label="Graph" onClick={(e) => e.stopPropagation()}>
          <div className="wb-graph-popover-head">
            <strong>Graph</strong>
            <button className="chip" onClick={() => setShowGraphPopover(false)}>
              Close
            </button>
          </div>
          <div className="wb-graph-popover-body">
            <div className="branch-tree branch-tree-lanes" style={{ maxHeight: 360 }}>
              <BranchGraphLanes rows={commitGraph} rowHeight={30} laneGap={14} selectedSha={selectedCommit} />
              {commitGraph
                .filter((g) => !g.isConnector && !!g.sha)
                .map((g, idx) => (
                  <button
                    key={`${g.sha}-${idx}`}
                    className={selectedCommit === g.sha ? "graph-row selected" : "graph-row"}
                    onClick={() => setSelectedCommit(g.sha)}
                  >
                    <span className="graph-ascii graph-ascii-placeholder" aria-hidden="true" />
                    <span className="graph-main">
                      <span className="graph-subject">{g.subject || "(no subject)"}</span>
                      <span className="graph-meta">
                        {g.sha.slice(0, 8)} · {g.author} · {g.date}
                      </span>
                    </span>
                    <span className="graph-refs">
                      {parseRefs(g.refs).map((r) => (
                        <span key={`${g.sha}-${r}`} className="graph-ref-btn" aria-hidden="true">
                          {r}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="modal-mask" onClick={() => setShowSettings(false)}>
          <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>
            <p className="small muted">Theme and layout preferences</p>

            <div className="settings-grid">
              <div className="settings-row">
                <div className="settings-label">Theme</div>
                <div className="toolbar">
                  <button className="chip" onClick={toggleTheme} title="Toggle theme">
                    {theme === "dark" ? "Dark" : "Light"}
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-label">Panel placement</div>
                <div className="toolbar">
                  <button
                    className={panelPlacement === "bottom" ? "chip active" : "chip"}
                    onClick={() => setPanelPlacement("bottom")}
                  >
                    Bottom
                  </button>
                  <button
                    className={panelPlacement === "right" ? "chip active" : "chip"}
                    onClick={() => setPanelPlacement("right")}
                  >
                    Right
                  </button>
                  <button
                    className={panelPlacement === "hidden" ? "chip active" : "chip"}
                    onClick={() => setPanelPlacement("hidden")}
                  >
                    Hidden
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-label">Plugins</div>
                <div className="toolbar">
                  <button
                    className="chip"
                    onClick={() => {
                      setShowEnvSetup(true);
                      const unchecked = [runtimeStatus.git, runtimeStatus.entire, runtimeStatus.opencode].some((d) => !d.checked);
                      if (unchecked) void refreshRuntimeRequirements();
                    }}
                  >
                    Manage plugins
                  </button>
                </div>
              </div>

              {runtimeStatus.opencode.installed ? (
                <>
                  <div className="settings-row">
                    <div className="settings-label">Model management</div>
                    <div className="toolbar">
                      <button
                        className="chip"
                        onClick={() => {
                          setShowModelManager((v) => !v);
                          if (!showModelManager) {
                            setModelManagerSearch("");
                            void refreshOpencodeCatalog();
                            void loadOpencodeModelConfig();
                          }
                        }}
                      >
                        {showModelManager ? "Close manager" : "Open manager"}
                      </button>
                      <span className="small muted">
                        {opencodeConfig?.configuredModel || "Pending configuration"}
                      </span>
                    </div>
                  </div>

                  {showModelManager ? (
                    <div className="settings-model-manager">
                      <div className="settings-model-head">
                        <input
                          className="path-input"
                          placeholder="Search model..."
                          value={modelManagerSearch}
                          onChange={(e) => setModelManagerSearch(e.target.value)}
                        />
                        <input
                          className="path-input"
                          placeholder="custom provider id"
                          value={opencodeCustomProviderDraft}
                          onChange={(e) => setOpencodeCustomProviderDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomProvider();
                            }
                          }}
                        />
                        <button className="chip" onClick={addCustomProvider}>Add provider</button>
                        <button className="chip" disabled={opencodeCatalogLoading} onClick={() => void refreshOpencodeCatalog()}>
                          {opencodeCatalogLoading ? "Loading..." : "Refresh"}
                        </button>
                      </div>
                      <div className="settings-model-lists">
                        <div className="settings-model-col">
                          <button
                            className={PROVIDER_PRESETS.some((p) => p.id === opencodeModelProvider) ? "file-item" : "file-item selected"}
                            onClick={() => {
                              setModelManagerSearch("");
                              const customId = opencodeCustomProviderDraft.trim() || "myprovider";
                              setOpencodeCustomProviderDraft(customId);
                              selectProvider(customId);
                            }}
                          >
                            + Custom OpenAI-compatible
                          </button>
                          {selectableProviders.map((provider) => (
                            <button
                              key={`settings-provider-${provider}`}
                              className={opencodeModelProvider === provider ? "file-item selected" : "file-item"}
                              onClick={() => {
                                setModelManagerSearch("");
                                selectProvider(provider);
                                if (!opencodeModelsByProvider[provider]) {
                                  void fetchOpencodeModels(provider);
                                }
                                void openProviderConfig();
                              }}
                            >
                              {opencodeProviderNames[provider] || PROVIDER_PRESETS.find((p) => p.id === provider)?.name || provider}
                            </button>
                          ))}
                        </div>
                        <div className="settings-model-col">
                          {visibleModels.map((m) => (
                            <button
                              key={`settings-model-${m}`}
                              className={opencodeSelectedModel === m ? "file-item selected" : "file-item"}
                              onClick={() => setOpencodeSelectedModel(m)}
                              title={`${opencodeModelProvider}/${m}`}
                            >
                              {(() => {
                                const provider = resolveProviderAliasWithNames(
                                  opencodeModelProvider,
                                  opencodeModelsByProvider,
                                  opencodeProviderNames
                                ) || opencodeModelProvider;
                                const name =
                                  (provider ? (opencodeModelNamesByProvider[provider]?.[m] || opencodeConfiguredModelNamesByProvider[provider]?.[m]) : "") ||
                                  "";
                                return (
                                  <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                                    <span>{name || m}</span>
                                    {name ? <span className="small muted">{m}</span> : null}
                                  </span>
                                );
                              })()}
                            </button>
                          ))}
                          {visibleModels.length === 0 ? (
                            <div className="small muted">该供应商在服务端配置中暂无可用模型。请在 OpenCode 中添加模型，或于下方手动填写 model id。</div>
                          ) : null}
                        </div>
                      </div>
                      <div className="settings-provider-form">
                        <input
                          className="path-input"
                          placeholder="provider display name (optional)"
                          value={opencodeProviderConfig.name}
                          onChange={(e) =>
                            setOpencodeProviderConfig((prev) => ({ ...prev, name: e.target.value }))
                          }
                        />
                        <input
                          className="path-input"
                          placeholder="@ai-sdk/openai-compatible"
                          value={opencodeProviderConfig.npm}
                          onChange={(e) =>
                            setOpencodeProviderConfig((prev) => ({ ...prev, npm: e.target.value }))
                          }
                        />
                        <input
                          className="path-input"
                          placeholder={PROVIDER_PRESETS.find((p) => p.id === opencodeModelProvider)?.apiKeyHint || "apiKey"}
                          value={opencodeProviderConfig.apiKey}
                          onChange={(e) =>
                            setOpencodeProviderConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                          }
                        />
                        <input
                          className="path-input"
                          placeholder="model id (required)"
                          value={opencodeSelectedModel}
                          onChange={(e) => setOpencodeSelectedModel(e.target.value)}
                        />
                        <input
                          className="path-input"
                          placeholder={defaultProviderBaseUrl(opencodeModelProvider) || "baseURL"}
                          value={opencodeProviderConfig.baseUrl}
                          onChange={(e) =>
                            setOpencodeProviderConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                          }
                        />
                        <div className="toolbar">
                          <button
                            className="chip"
                            disabled={opencodeProviderConfigBusy || opencodeConfigBusy || !opencodeSelectedModel}
                            onClick={() => void saveOpencodeConfiguration()}
                          >
                            {opencodeProviderConfigBusy || opencodeConfigBusy ? "Saving..." : "Save configuration"}
                          </button>
                          <button
                            className="chip"
                            disabled={opencodeTestBusy || !opencodeSelectedModel}
                            onClick={() => void validateOpencodeModel()}
                          >
                            {opencodeTestBusy ? "Validating..." : "Validate"}
                          </button>
                        </div>
                      </div>
                      {providerOptionFields(opencodeModelProvider).length > 0 ? (
                        <div className="settings-provider-form settings-provider-advanced">
                          {providerOptionFields(opencodeModelProvider).map((f) => (
                            <input
                              key={`opt-${f.key}`}
                              className="path-input"
                              placeholder={f.placeholder}
                              value={String(opencodeProviderConfig[f.key] ?? "")}
                              onChange={(e) =>
                                setOpencodeProviderConfig((prev) => ({ ...prev, [f.key]: e.target.value }))
                              }
                            />
                          ))}
                        </div>
                      ) : null}
                      <div className="toolbar">
                        <button className="chip" onClick={() => setShowProviderAdvanced((v) => !v)}>
                          {showProviderAdvanced ? "Hide advanced" : "Show advanced"}
                        </button>
                      </div>
                      {showProviderAdvanced ? (
                        <div className="settings-provider-form settings-provider-advanced">
                          <input
                            className="path-input"
                            placeholder="timeout ms (optional)"
                            value={opencodeProviderConfig.timeout}
                            onChange={(e) =>
                              setOpencodeProviderConfig((prev) => ({ ...prev, timeout: e.target.value }))
                            }
                          />
                          <input
                            className="path-input"
                            placeholder="chunkTimeout ms (optional)"
                            value={opencodeProviderConfig.chunkTimeout}
                            onChange={(e) =>
                              setOpencodeProviderConfig((prev) => ({ ...prev, chunkTimeout: e.target.value }))
                            }
                          />
                          <div className="small muted settings-provider-note">
                            {PROVIDER_PRESETS.find((p) => p.id === opencodeModelProvider)?.name || opencodeModelProvider}
                          </div>
                          <div className="small muted settings-provider-note">
                            {PROVIDER_PRESETS.find((p) => p.id === opencodeModelProvider)?.apiKeyHint || ""}
                          </div>
                        </div>
                      ) : null}
                      {opencodeTestResult ? <pre className="opencode-validate-log">{opencodeTestResult}</pre> : null}
                    </div>
                  ) : null}
                </>
              ) : null}
              {runtimeStatus.opencode.installed ? null : (
                <div className="settings-row">
                  <div className="settings-label">Model management</div>
                  <div className="small muted">Install OpenCode plugin first.</div>
                </div>
              )}
            </div>

            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <button className="chip" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showOpencodeProviderPicker ? (
        <div className="modal-mask" onClick={() => setShowOpencodeProviderPicker(false)}>
          <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()}>
            <div className="env-setup-head">
              <h3>{`连接提供商（目录 ${opencodeProviders.length} + 预置 ${PROVIDER_PRESETS.length}）`}</h3>
              <button className="chip" onClick={() => setShowOpencodeProviderPicker(false)}>Close</button>
            </div>
            <p className="small muted">供应商与可选模型以服务端 `/global/config`（及禁用列表）为准；连接状态仍来自 OpenCode `/provider`。</p>
            <div className="settings-model-head">
              <input
                className="path-input"
                placeholder="搜索提供商..."
                value={opencodeProviderPickerSearch}
                onChange={(e) => setOpencodeProviderPickerSearch(e.target.value)}
              />
              <input
                className="path-input"
                placeholder="搜索模型..."
                value={opencodeProviderPickerModelSearch}
                onChange={(e) => setOpencodeProviderPickerModelSearch(e.target.value)}
                style={{ maxWidth: 240 }}
              />
              <button
                className="chip"
                onClick={() => {
                  setShowOpencodeProviderPicker(false);
                  setShowOpencodeCustomProvider(true);
                }}
              >
                ＋ 自定义
              </button>
              <button className="chip" disabled={opencodeCatalogLoading} onClick={() => void refreshOpencodeCatalog()}>
                {opencodeCatalogLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
            <div className="settings-model-lists">
              <div className="settings-model-col" style={{ maxHeight: 520 }}>
                {opencodeProviderPickerCandidates.length === 0 ? (
                  <div className="small muted" style={{ padding: 12 }}>暂无可用供应商目录。请检查 OpenCode `/provider` 是否可访问。</div>
                ) : null}
                {opencodeProviderPickerCandidates.map((provider) => {
                  const connected = opencodeConnectedProviders.includes(provider);
                  return (
                    <button
                      key={`provider-pick-${provider}`}
                      className={opencodeProviderPickerProvider === provider ? "file-item selected" : "file-item"}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpencodeProviderPickerProvider(provider);
                        if (!connected) {
                          // Show inline connect UI on the right column (matches OpenCode "connect" UX).
                          setOpencodeConnectProviderId(provider);
                          setOpencodeConnectProviderName(opencodeProviderNames[provider] || PROVIDER_PRESETS.find((p) => p.id === provider)?.name || provider);
                          setOpencodeConnectApiKey("");
                          return;
                        }
                      }}
                      title={connected ? "已连接" : "未连接（需要在 OpenCode 中连接或配置）"}
                    >
                      {opencodeProviderNames[provider] || PROVIDER_PRESETS.find((p) => p.id === provider)?.name || provider}
                      {!connected ? <span className="small muted" style={{ marginLeft: 8 }}>(未连接)</span> : null}
                    </button>
                  );
                })}
              </div>
              <div className="settings-model-col" style={{ maxHeight: 520 }}>
                {(() => {
                  const resolved = resolveProviderAliasWithNames(
                    opencodeProviderPickerProvider,
                    opencodeModelsByProvider,
                    opencodeProviderNames
                  );
                  const cfgResolved = resolveProviderAliasWithNames(
                    opencodeProviderPickerProvider,
                    opencodeConfiguredModelsByProvider,
                    opencodeProviderNames
                  );
                  const pid = (resolved || opencodeProviderPickerProvider.trim()) || "";
                  const cfgPid = (cfgResolved || pid) || "";
                  const connected = pid ? opencodeConnectedProviders.includes(pid) : false;
                  // Right column should show the full /provider directory model list.
                  const pool = pid ? (opencodeModelsByProvider[pid] ?? []) : [];
                  const q = opencodeProviderPickerModelSearch.trim().toLowerCase();
                  const filtered = q ? pool.filter((m) => m.toLowerCase().includes(q)) : pool;
                  if (!opencodeProviderPickerProvider) {
                    return <div className="small muted" style={{ padding: 12 }}>先从左侧选择一个提供商。</div>;
                  }
                  if (!connected) {
                    const pretty = opencodeProviderNames[pid] || PROVIDER_PRESETS.find((p) => p.id === pid)?.name || pid;
                    return (
                      <div style={{ padding: 12 }}>
                        <div className="small muted" style={{ marginBottom: 8 }}>
                          {pretty} 未连接。请先输入 API Key 连接（写入 OpenCode `auth.json`），再选择模型。
                        </div>
                        <input
                          className="path-input"
                          placeholder="API 密钥"
                          value={opencodeConnectProviderId === pid ? opencodeConnectApiKey : ""}
                          onChange={(e) => {
                            setOpencodeConnectProviderId(pid);
                            setOpencodeConnectProviderName(pretty);
                            setOpencodeConnectApiKey(e.target.value);
                          }}
                        />
                        <div className="toolbar" style={{ marginTop: 10 }}>
                          <button
                            className="chip"
                            disabled={opencodeConnectBusy || opencodeConnectProviderId !== pid || !opencodeConnectApiKey.trim()}
                            onClick={async () => {
                              if (!ensureRepoSelected()) return;
                              const authPid = pid.trim();
                              const key = opencodeConnectApiKey.trim();
                              if (!authPid || !key) return;
                              setOpencodeConnectBusy(true);
                              setError("");
                              try {
                                await invoke<boolean>("put_opencode_server_auth", { repoPath, providerId: authPid, key });
                                await refreshOpencodeCatalog();
                                if (!(opencodeModelsByProvider[authPid] ?? []).length) {
                                  await fetchOpencodeModels(authPid);
                                }
                                setOpencodeProviderPickerProvider(authPid);
                                setMessage(`已连接: ${authPid}`);
                              } catch (e) {
                                setError(String(e));
                                setMessage("连接失败");
                              } finally {
                                setOpencodeConnectBusy(false);
                              }
                            }}
                          >
                            {opencodeConnectBusy ? "Connecting..." : "提交"}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  if (filtered.length === 0) {
                    return <div className="small muted" style={{ padding: 12 }}>没有可用模型（或搜索无结果）。</div>;
                  }
                  return filtered.map((mid) => {
                    const ref = `${cfgPid}/${mid}`;
                    const refNorm = normalizeModelRef(ref);
                    const configured = (opencodeConfiguredModelsByProvider[cfgPid] ?? []).includes(mid);
                    const enabled = configured && !!refNorm && !opencodeHiddenModels.has(refNorm);
                    const modelDisplay =
                      opencodeModelNamesByProvider[pid]?.[mid] ||
                      opencodeConfiguredModelNamesByProvider[cfgPid]?.[mid] ||
                      mid;
                    return (
                      <div
                        key={`provider-model-pick-${refNorm || ref}`}
                        className={
                          normalizeModelRef(activeOpencodeModel) === refNorm ? "file-item selected" : "file-item"
                        }
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                      >
                        <button
                          className="chip"
                          style={{ flex: 1, textAlign: "left", padding: "4px 8px" }}
                          onClick={() => {
                            if (!refNorm) return;
                            void applyOpencodeModel(refNorm);
                          }}
                          title={refNorm || ref}
                        >
                          {modelDisplay}
                        </button>
                        <button
                          className={enabled ? "chip active" : "chip"}
                          onClick={async () => {
                            if (!refNorm) return;
                            if (enabled) {
                              setOpencodeHiddenModels((prev) => {
                                const next = new Set(prev);
                                next.add(refNorm);
                                return next;
                              });
                              return;
                            }
                            try {
                              const patchModel =
                                modelDisplay && modelDisplay.trim() && modelDisplay.trim() !== mid ? { name: modelDisplay } : {};
                              await invoke<OpencodeServerConfig>("patch_opencode_server_config", {
                                repoPath,
                                patch: {
                                  provider: {
                                    [cfgPid]: {
                                      models: {
                                        // Persist the human-readable name when available,
                                        // so /provider can surface it for future sessions.
                                        [mid]: patchModel
                                      }
                                    }
                                  }
                                }
                              });
                            } catch (e) {
                              appendOpencodeDebugLog(`model.enable.warn ${String(e)}`);
                            }
                            setOpencodeHiddenModels((prev) => {
                              const next = new Set(prev);
                              next.delete(refNorm);
                              return next;
                            });
                            // Avoid forcing current-model selection when just enabling a catalog entry.
                            await refreshOpencodeServerConfig({ syncSelection: false, includeCurrentModel: false });
                          }}
                        >
                          {enabled ? "关闭" : "开启"}
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showOpencodeCustomProvider ? (
        <div className="modal-mask" onClick={() => setShowOpencodeCustomProvider(false)}>
          <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="env-setup-head">
              <h3>自定义提供商</h3>
              <button className="chip" onClick={() => setShowOpencodeCustomProvider(false)}>Close</button>
            </div>
            <p className="small muted">
              OpenAI 兼容提供商（参考 `https://opencode.ai/docs/providers/#custom-provider`）。
            </p>
            <div className="settings-provider-form">
              <input
                className="path-input"
                placeholder="provider id（例如 vllm / myprovider）"
                value={opencodeProviderConfig.provider}
                onChange={(e) => setOpencodeProviderConfig((prev) => ({ ...prev, provider: e.target.value }))}
              />
              <input
                className="path-input"
                placeholder="显示名称（可选）"
                value={opencodeProviderConfig.name}
                onChange={(e) => setOpencodeProviderConfig((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="path-input"
                placeholder="baseURL（例如 http://127.0.0.1:8000/v1）"
                value={opencodeProviderConfig.baseUrl}
                onChange={(e) => setOpencodeProviderConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
              />
              <input
                className="path-input"
                placeholder="API Key（可空；支持 {env:ENV_NAME}）"
                value={opencodeProviderConfig.apiKey}
                onChange={(e) => setOpencodeProviderConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
              />
              <input
                className="path-input"
                placeholder="model id（例如 qwen3.5_35b_a3b）"
                value={opencodeSelectedModel}
                onChange={(e) => setOpencodeSelectedModel(e.target.value)}
              />
              <div className="toolbar">
                <button
                  className="chip"
                  disabled={opencodeProviderConfigBusy || opencodeConfigBusy || !opencodeProviderConfig.provider.trim() || !opencodeSelectedModel.trim()}
                  onClick={async () => {
                    try {
                      setOpencodeProviderConfigBusy(true);
                      setOpencodeConfigBusy(true);
                      const pid = opencodeProviderConfig.provider.trim();
                      const mid = opencodeSelectedModel.trim();
                      const full = `${pid}/${mid}`;
                      // OpenCode web flow:
                      // 1) PUT /auth/:id with {type:"api", key:"..."} when apiKey provided
                      // 2) PATCH /config (or /global/config) with provider config (baseURL/models/headers), and clear disabled_providers.
                      const key = opencodeProviderConfig.apiKey?.trim() || "";
                      if (key) {
                        await invoke<boolean>("put_opencode_server_auth", { repoPath, providerId: pid, key });
                      }
                      const afterProviderPatch = await invoke<OpencodeServerConfig>("patch_opencode_server_config", {
                        repoPath,
                        patch: {
                          provider: {
                            [pid]: {
                              npm: opencodeProviderConfig.npm || "@ai-sdk/openai-compatible",
                              name: opencodeProviderConfig.name || pid,
                              options: {
                                baseURL: opencodeProviderConfig.baseUrl,
                                ...(opencodeProviderConfig.headers && Object.keys(opencodeProviderConfig.headers).length
                                  ? { headers: opencodeProviderConfig.headers }
                                  : {})
                              },
                              models: {
                                [mid]: { name: mid }
                              }
                            }
                          },
                          disabled_providers: []
                        }
                      });
                      const afterModelPatch = await invoke<OpencodeServerConfig>("patch_opencode_server_config", {
                        repoPath,
                        patch: { model: full }
                      });
                      const effective = await invoke<OpencodeServerConfig>("get_opencode_server_config", { repoPath });
                      const hasProvider = Boolean(effective?.provider && effective.provider[pid]);
                      const hasModel = Boolean(effective?.provider?.[pid]?.models && effective.provider[pid].models[mid]);
                      if (!hasProvider || !hasModel) {
                        appendOpencodeDebugLog(
                          `custom.save.verify failed pid=${pid} mid=${mid} hasProvider=${String(hasProvider)} hasModel=${String(hasModel)}`
                        );
                        appendOpencodeDebugLog(`custom.save.patch.provider=${JSON.stringify(afterProviderPatch).slice(0, 800)}`);
                        appendOpencodeDebugLog(`custom.save.patch.model=${JSON.stringify(afterModelPatch).slice(0, 800)}`);
                        appendOpencodeDebugLog(`custom.save.config=${JSON.stringify(effective).slice(0, 1200)}`);
                        throw new Error("保存后未在 /config 中找到该 provider/model（请打开 Debug Log 查看详情）");
                      }
                      await refreshOpencodeCatalog();
                      await refreshOpencodeServerConfig();
                      setShowOpencodeCustomProvider(false);
                      setShowOpencodeModelPicker(true);
                      setOpencodeModelPickerSearch("");
                      setMessage(`Saved configuration: ${full}`);
                    } catch (e) {
                      setError(String(e));
                      setMessage("Save configuration failed");
                    } finally {
                      setOpencodeConfigBusy(false);
                      setOpencodeProviderConfigBusy(false);
                    }
                  }}
                >
                  {opencodeProviderConfigBusy || opencodeConfigBusy ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* inline connect UI lives inside provider picker right column */}

      {showEnvSetup ? (
        <div className="modal-mask" onClick={() => setShowEnvSetup(false)}>
          <div className="modal-card env-setup-card" onClick={(e) => e.stopPropagation()}>
            <div className="env-setup-head">
              <h3>Runtime Setup</h3>
              <button
                className="env-refresh-circle"
                title="Refresh runtime check"
                aria-label="Refresh runtime check"
                disabled={runtimeChecking || Boolean(installingDep)}
                onClick={() => void refreshRuntimeRequirements()}
              >
                <span className={runtimeChecking ? "refresh-spin" : ""}>↻</span>
              </button>
            </div>
            <p className="small muted">Manage git, Entire CLI, and OpenCode plugin runtime.</p>

            <div className="env-check-list">
              {[runtimeStatus.git, runtimeStatus.entire, runtimeStatus.opencode]
                .filter((d): d is RuntimeDependencyStatus => Boolean(d))
                .map((dep) => (
                  <div className="env-check-row" key={dep.name}>
                    <div>
                      <strong>{dep.name}</strong>{" "}
                      <span className={checkingDeps[dep.name as "git" | "entire" | "opencode"] ? "muted" : (dep.installed ? "env-ok" : "env-missing")}>
                        {checkingDeps[dep.name as "git" | "entire" | "opencode"]
                          ? "Checking..."
                          : (dep.checked ? (dep.installed ? "Installed" : "Missing") : "Unknown")}
                      </span>
                      {dep.version && !checkingDeps[dep.name as "git" | "entire" | "opencode"] ? <div className="small muted">{dep.version}</div> : null}
                      {dep.path ? <div className="small muted">{dep.path}</div> : null}
                      {!dep.installed ? <div className="small muted">{dep.installHint}</div> : null}
                    </div>
                    <div className="toolbar">
                      {!dep.installed ? (
                        <button
                          className={installingDep === dep.name ? "chip env-chip-loading" : "chip"}
                          disabled={Boolean(installingDep) || checkingDeps[dep.name as "git" | "entire" | "opencode"]}
                          onClick={() => void runDependencyAction(dep.name as "git" | "entire" | "opencode", "install")}
                        >
                          {installingDep === dep.name ? (
                            <>
                              <span className="env-btn-spinner" aria-hidden="true" />
                              {runtimeJob?.action === "uninstall" ? "Uninstalling..." : "Installing..."} {installingElapsed}s
                            </>
                          ) : (
                            `Install ${dep.name}`
                          )}
                        </button>
                      ) : (
                        <button
                          className={installingDep === dep.name ? "chip env-chip-loading" : "chip"}
                          disabled={Boolean(installingDep) || checkingDeps[dep.name as "git" | "entire" | "opencode"]}
                          onClick={() => void runDependencyAction(dep.name as "git" | "entire" | "opencode", "uninstall")}
                        >
                          {installingDep === dep.name ? (
                            <>
                              <span className="env-btn-spinner" aria-hidden="true" />
                              {runtimeJob?.action === "uninstall" ? "Uninstalling..." : "Installing..."} {installingElapsed}s
                            </>
                          ) : (
                            `Uninstall ${dep.name}`
                          )}
                        </button>
                      )}
                    </div>
                    {runtimeJob && runtimeJob.name === dep.name ? (
                      <div className="env-inline-status">
                        <button
                          className="env-progress-button"
                          onClick={() => setExpandedLogDep((prev) => (prev === dep.name ? null : (dep.name as "git" | "entire" | "opencode")))}
                          title={expandedLogDep === dep.name ? "Hide details" : "Show details"}
                        >
                          <span className="env-progress-track-inline" aria-hidden="true">
                            <span className={runtimeJob.status === "running" ? "env-progress-inline-indeterminate" : "env-progress-inline-done"} />
                          </span>
                          <span className="env-progress-label">
                            {runtimeJob.action} · {runtimeJob.status} {installingDep === dep.name ? `· ${installingElapsed}s` : ""}
                          </span>
                        </button>
                        <div className="env-log-tail" title={runtimeLogTail || "No logs yet"}>
                          {runtimeLogTail || "Waiting for logs..."}
                        </div>
                        {expandedLogDep === dep.name ? (
                          <pre className="env-install-log">{runtimeInstallLog || "No logs yet."}</pre>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
            </div>

            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <div />
              <div className="toolbar">
                <button
                  className="chip"
                  onClick={() => {
                    window.localStorage.setItem("giteam.runtime.setup.dismissed.v1", "1");
                    setShowEnvSetup(false);
                  }}
                >
                  Continue anyway
                </button>
                <button className="chip" onClick={() => setShowEnvSetup(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showOnboarding ? (
        <div className="modal-mask" onClick={() => setShowOnboarding(false)}>
          <div className="modal-card onboarding-card" onClick={(e) => e.stopPropagation()}>
            <h3>Quick Guide</h3>
            <p className="small muted">First-time walkthrough</p>

            <div className="onboarding-step-title">{onboardingSteps[onboardingStep].title}</div>
            <p className="onboarding-step-body">{onboardingSteps[onboardingStep].body}</p>

            <div className="onboarding-dots">
              {onboardingSteps.map((_, idx) => (
                <button
                  key={`dot-${idx}`}
                  className={idx === onboardingStep ? "onboarding-dot active" : "onboarding-dot"}
                  onClick={() => setOnboardingStep(idx)}
                  aria-label={`Go to step ${idx + 1}`}
                />
              ))}
            </div>

            <div className="toolbar" style={{ justifyContent: "space-between" }}>
              <button
                className="chip"
                disabled={onboardingStep === 0}
                onClick={() => setOnboardingStep((s) => Math.max(0, s - 1))}
              >
                Back
              </button>
              <div className="toolbar">
                <button
                  className="chip"
                  onClick={() => {
                    window.localStorage.setItem(ONBOARDING_DONE_KEY, "1");
                    setShowOnboarding(false);
                  }}
                >
                  Skip
                </button>
                {onboardingStep < onboardingSteps.length - 1 ? (
                  <button className="chip" onClick={() => setOnboardingStep((s) => Math.min(onboardingSteps.length - 1, s + 1))}>
                    Next
                  </button>
                ) : (
                  <button
                    className="chip"
                    onClick={() => {
                      window.localStorage.setItem(ONBOARDING_DONE_KEY, "1");
                      setShowOnboarding(false);
                    }}
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {repoContextMenu ? (
        <div className="repo-context-layer" onClick={() => setRepoContextMenu(null)}>
          <div
            className="repo-context-menu"
            style={{ left: repoContextMenu.x, top: repoContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="repo-context-item"
              onClick={() => void closeRepository(repoContextMenu.repo)}
              disabled={busy}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {commitContextMenu ? (
        <div className="repo-context-layer" onClick={() => setCommitContextMenu(null)}>
          <div
            className="repo-context-menu"
            style={{ left: commitContextMenu.x, top: commitContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="repo-context-item" onClick={() => void copyCommitId(commitContextMenu.sha)}>
              Copy commit id
            </button>
          </div>
        </div>
      ) : null}

    </>
  );
}

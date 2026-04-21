import { invoke } from "@tauri-apps/api/core";
import type { CSSProperties, ReactNode } from "react";
import { Component, Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  getGitUserIdentity,
  getGitWorktreeFilePatch,
  getGitWorktreeOverview,
  getLocalBranches,
  gitPull,
  gitPush,
  runRepoTerminalCommand
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
  GitUserIdentity,
  GitWorktreeOverview,
  RepositoryEntry,
  ReviewAction,
  ReviewActionType,
  ReviewRecord
} from "./lib/types";

type DetailTab = "diff" | "context" | "findings";
type Theme = "dark" | "light";
type RightPaneTab = "worktree" | "changes" | "terminal";

function PanelToggleIcon(props: { side: "left" | "right"; collapsed: boolean }) {
  const dividerX = props.side === "left" ? 9 : 15;
  const hiddenPanelX = props.side === "left" ? 4 : 12;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d={`M${dividerX} 6.5V17.5`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {props.collapsed ? <rect x={hiddenPanelX} y="6.5" width="5" height="11" rx="1.5" fill="currentColor" opacity="0.16" /> : null}
    </svg>
  );
}

function SendIcon(props: { busy: boolean }) {
  return props.busy ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M7.5 10.5L12 5L16.5 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

function RightPaneTabIcon(props: { tab: RightPaneTab; active: boolean }) {
  const stroke = props.active ? "currentColor" : "currentColor";
  if (props.tab === "worktree") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5H11L12.8 9.5H19V17.5H5V7.5Z" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" /><path d="M5 9.5H19" fill="none" stroke={stroke} strokeWidth="1.6" /></svg>;
  }
  if (props.tab === "changes") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7H19" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" /><path d="M8 12H19" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" /><path d="M8 17H19" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" /><circle cx="5" cy="7" r="1.2" fill="currentColor" /><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="5" cy="17" r="1.2" fill="currentColor" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5H19.5V18.5H4.5V5.5Z" fill="none" stroke={stroke} strokeWidth="1.6" /><path d="M8 10L10.6 12L8 14" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M13 14H16" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(err: unknown) {
    return { error: String(err) };
  }
  componentDidCatch(err: unknown) {
    // Keep it visible; Tauri devtools isn't always open.
    // eslint-disable-next-line no-console
    console.error("[ui] fatal render error", err);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>UI crashed</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--danger)" }}>{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
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
  latestVersion?: string;
  updateAvailable: boolean;
  installHint: string;
};
type RuntimeRequirementsStatus = {
  platform: string;
  homebrewInstalled: boolean;
  git: RuntimeDependencyStatus;
  entire: RuntimeDependencyStatus;
  opencode: RuntimeDependencyStatus;
  giteam: RuntimeDependencyStatus;
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
  source?: string;
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
type OpencodeServiceSettings = {
  port: number;
};
type ControlServerSettings = {
  enabled: boolean;
  host: string;
  port: number;
  publicBaseUrl: string;
  pairCodeTtlMode: "none" | "24h" | "7d" | "forever";
};
type ControlPairCodeInfo = {
  code: string;
  expiresAt: number;
  ttlSeconds: number;
};
type ControlAccessInfo = {
  enabled: boolean;
  host: string;
  port: number;
  publicBaseUrl: string;
  pairCode: string;
  expiresAt: number;
  localUrls: string[];
  pairCodeTtlMode?: string;
  noAuth?: boolean;
};
type GiteamMobileServiceStatus = {
  cliInstalled: boolean;
  enabled: boolean;
  port: number;
  running: boolean;
};

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

type TerminalEntry = {
  id: string;
  command: string;
  output: string;
  createdAt: number;
  ok: boolean;
};

const EMPTY_WORKTREE: GitWorktreeOverview = {
  branch: "",
  tracking: "",
  ahead: 0,
  behind: 0,
  clean: true,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  entries: [],
  raw: ""
};

const EMPTY_GIT_IDENTITY: GitUserIdentity = {
  name: "",
  email: ""
};

function normalizeControlPairMode(raw: unknown): "none" | "24h" | "7d" | "forever" {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "none" || v === "24h" || v === "7d" || v === "forever") return v;
  return "24h";
}

function parseReadToolOutput(raw: string): { path: string; type: string; content: string } | null {
  const src = raw || "";
  if (!src.includes("<path>") || !src.includes("</path>")) return null;
  const mPath = src.match(/<path>([\s\S]*?)<\/path>/);
  const mType = src.match(/<type>([\s\S]*?)<\/type>/);
  const mContent = src.match(/<content>([\s\S]*?)<\/content>/);
  const path = (mPath?.[1] || "").trim();
  const type = (mType?.[1] || "").trim();
  const content = (mContent?.[1] || "").replace(/\s+$/, "");
  if (!path && !content) return null;
  return { path, type, content };
}

function withLineNumbers(text: string, maxLines = 400): string {
  const lines = (text || "").split("\n");
  const slice = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const width = String(slice.length).length;
  const body = slice.map((l, i) => `${String(i + 1).padStart(width, " ")}│${l}`).join("\n");
  return lines.length > maxLines ? `${body}\n…（仅展示前 ${maxLines} 行，共 ${lines.length} 行）` : body;
}

function parseOpencodeTaskSessionId(part: OpencodeDetailedPart | undefined | null): string {
  if (!part) return "";
  const state = (part as any)?.state || {};
  const metadata = state?.metadata || {};
  const raw =
    String(metadata?.sessionId || metadata?.sessionID || "").trim() ||
    String((part as any)?.metadata?.sessionId || "").trim();
  if (raw) return raw;
  const output = typeof state?.output === "string" ? state.output : "";
  if (!output) return "";
  const m = output.match(/task_id:\s*(ses[^\s)]+)/i);
  return (m?.[1] || "").trim();
}

/** Assistant reply text (exclude reasoning/tool traces). */
function buildOpencodeMainLineMarkdownFromParts(parts: OpencodeDetailedPart[] | undefined | null): string {
  const rows = Array.isArray(parts) ? parts : [];
  const chunks: string[] = [];
  for (const p of rows) {
    if (!p) continue;
    const t = String((p as any)?.type || "");
    if (t !== "text") continue;
    const text = String((p as any)?.text ?? (p as any)?.part?.text ?? "").trim();
    if (text) chunks.push(text);
  }
  if (chunks.length > 0) return chunks.join("\n\n");
  // Fallback: some providers may emit only reasoning.
  const fallback: string[] = [];
  for (const p of rows) {
    if (!p) continue;
    const t = String((p as any)?.type || "");
    if (t !== "reasoning") continue;
    const text = String((p as any)?.text ?? "").trim();
    if (text) fallback.push(text);
  }
  return fallback.join("\n\n");
}

function isOpencodeRenderablePart(p: OpencodeDetailedPart | undefined | null): boolean {
  if (!p) return false;
  const t = String((p as any)?.type || "");
  if (t === "text") return !!String((p as any)?.text ?? "").trim();
  if (t === "reasoning") return !!String((p as any)?.text ?? "").trim();
  if (t === "step-start" || t === "step-finish" || t === "patch") return false;
  if (t === "tool") {
    const tool = String((p as any)?.tool || "");
    if (tool === "todowrite") return false;
    return true;
  }
  return false;
}

function isOpencodeContextTool(tool: string): boolean {
  return tool === "read" || tool === "glob" || tool === "grep" || tool === "list";
}

function summarizeOpencodeContextToolCounts(parts: OpencodeDetailedPart[] | undefined | null): {
  read: number;
  search: number;
  list: number;
} {
  const rows = Array.isArray(parts) ? parts : [];
  let read = 0;
  let search = 0;
  let list = 0;
  for (const p of rows) {
    if (String((p as any)?.type || "") !== "tool") continue;
    const tool = String((p as any)?.tool || "");
    if (tool === "read") read += 1;
    else if (tool === "glob" || tool === "grep") search += 1;
    else if (tool === "list") list += 1;
  }
  return { read, search, list };
}

function summarizeOpencodeContextProgress(parts: OpencodeDetailedPart[] | undefined | null): {
  active: boolean;
  mode: string;
  detail: string;
} {
  const rows = Array.isArray(parts) ? parts : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const p = rows[i] as any;
    if (!p || String(p?.type || "") !== "tool") continue;
    const st = String(p?.state?.status || "").trim().toLowerCase();
    if (st !== "running" && st !== "pending") continue;
    const title = String(p?.state?.title || "").trim();
    const tool = String(p?.tool || "").trim();
    const input = p?.state?.input || {};
    const subtitle = String(input?.description || input?.filePath || input?.pattern || input?.path || "").trim();
    const detail = [tool, title || subtitle].filter(Boolean).join(" · ");
    const mode =
      tool === "read" || tool === "list" || tool === "glob" || tool === "grep"
        ? "读取"
        : tool === "write" || tool === "edit" || tool === "apply_patch"
          ? "写入"
          : "处理中";
    return { active: true, mode, detail };
  }
  return { active: false, mode: "", detail: "" };
}

function mergeOpencodeStreamText(existingRaw: unknown, incomingRaw: unknown): string {
  const existing = String(existingRaw || "");
  const incoming = String(incomingRaw || "");
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (incoming === existing) return existing;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  if (existing.endsWith(incoming)) return existing;
  if (incoming.includes(existing)) return incoming;
  return existing + incoming;
}

function buildOpencodeReplyMarkdownFromParts(parts: OpencodeDetailedPart[] | undefined | null): string {
  const rows = Array.isArray(parts) ? parts : [];
  const out: string[] = [];
  for (const p of rows) {
    if (!p) continue;
    if (String((p as any)?.type || "") !== "text") continue;
    const text = String((p as any)?.text ?? "").trim();
    if (text) out.push(text);
  }
  return out.join("\n\n");
}

type OpencodeAssistantRenderGroup =
  | { kind: "context"; key: string; parts: OpencodeDetailedPart[] }
  | { kind: "part"; key: string; part: OpencodeDetailedPart };

function buildOpencodeAssistantRenderGroups(parts: OpencodeDetailedPart[] | undefined | null): OpencodeAssistantRenderGroup[] {
  const rows = Array.isArray(parts) ? parts : [];
  const out: OpencodeAssistantRenderGroup[] = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i];
    const t = String((cur as any)?.type || "");
    const tool = String((cur as any)?.tool || "");
    if (t === "tool" && isOpencodeContextTool(tool)) {
      const batch: OpencodeDetailedPart[] = [cur];
      i += 1;
      while (i < rows.length) {
        const nxt = rows[i];
        const nt = String((nxt as any)?.type || "");
        const ntool = String((nxt as any)?.tool || "");
        if (nt === "tool" && isOpencodeContextTool(ntool)) {
          batch.push(nxt);
          i += 1;
          continue;
        }
        break;
      }
      const firstId = String((batch[0] as any)?.id || "");
      const lastId = String((batch[batch.length - 1] as any)?.id || "");
      out.push({ kind: "context", key: `context:${firstId || i}:${lastId || i}`, parts: batch });
      continue;
    }
    const pid = String((cur as any)?.id || "");
    out.push({ kind: "part", key: `part:${pid || i}`, part: cur });
    i += 1;
  }
  return out;
}
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

const EMPTY_DEP = (name: "git" | "entire" | "opencode" | "giteam", installHint: string): RuntimeDependencyStatus => ({
  name,
  checked: false,
  installed: false,
  path: undefined,
  version: undefined,
  latestVersion: undefined,
  updateAvailable: false,
  installHint
});

const DEFAULT_RUNTIME_STATUS: RuntimeRequirementsStatus = {
  platform: "macos",
  homebrewInstalled: false,
  git: EMPTY_DEP("git", "brew install git"),
  entire: EMPTY_DEP("entire", "brew tap entireio/tap && brew install entireio/tap/entire"),
  opencode: EMPTY_DEP("opencode", "brew install anomalyco/tap/opencode"),
  giteam: EMPTY_DEP("giteam", "npm install -g giteam")
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
      opencode: parsed.opencode ? { ...DEFAULT_RUNTIME_STATUS.opencode, ...parsed.opencode } : DEFAULT_RUNTIME_STATUS.opencode,
      giteam: parsed.giteam ? { ...DEFAULT_RUNTIME_STATUS.giteam, ...parsed.giteam } : DEFAULT_RUNTIME_STATUS.giteam
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

function isPresetProviderId(providerId: string): boolean {
  const pid = (providerId || "").trim();
  if (!pid) return false;
  return PROVIDER_PRESETS.some((p) => p.id === pid);
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
  const [showMobileControlDialog, setShowMobileControlDialog] = useState(false);
  const [showOpencodeApiDialog, setShowOpencodeApiDialog] = useState(false);
  const [showGraphPopover, setShowGraphPopover] = useState(false);
  const [showEnvSetup, setShowEnvSetup] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadCachedWidth(SIDEBAR_WIDTH_CACHE_KEY, 320, 240, 520));
  const [rightPaneWidth, setRightPaneWidth] = useState(() => loadCachedWidth(RIGHT_PANE_WIDTH_CACHE_KEY, 420, 360, 760));
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(true);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(true);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
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
  const [worktreeOverview, setWorktreeOverview] = useState<GitWorktreeOverview>(EMPTY_WORKTREE);
  const [gitUserIdentity, setGitUserIdentity] = useState<GitUserIdentity>(EMPTY_GIT_IDENTITY);
  const [selectedWorktreeFile, setSelectedWorktreeFile] = useState("");
  const [selectedWorktreePatch, setSelectedWorktreePatch] = useState("");
  const [selectedExplain, setSelectedExplain] = useState("");
  const [agentContextError, setAgentContextError] = useState("");
  const [statusText, setStatusText] = useState("");

  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [actions, setActions] = useState<ReviewAction[]>([]);

  const [detailTab, setDetailTab] = useState<DetailTab>("diff");
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>("worktree");
  const [busy, setBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [runtimeChecking, setRuntimeChecking] = useState(false);
  const [checkingDeps, setCheckingDeps] = useState<Record<"git" | "entire" | "opencode" | "giteam", boolean>>({
    git: false,
    entire: false,
    opencode: false,
    giteam: false
  });
  const [installingDep, setInstallingDep] = useState("");
  const [installingElapsed, setInstallingElapsed] = useState(0);
  const [runtimeJobId, setRuntimeJobId] = useState("");
  const [runtimeJob, setRuntimeJob] = useState<RuntimeActionJobStatus | null>(null);
  const [expandedLogDep, setExpandedLogDep] = useState<"git" | "entire" | "opencode" | "giteam" | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeRequirementsStatus>(() => loadCachedRuntimeStatus());
  const [runtimeInstallLog, setRuntimeInstallLog] = useState("");
  const [opencodeProviders, setOpencodeProviders] = useState<string[]>([]);
  const [opencodeConnectedProviders, setOpencodeConnectedProviders] = useState<string[]>([]);
  const [opencodeConfiguredProviders, setOpencodeConfiguredProviders] = useState<string[]>([]);
  const [opencodeProviderNames, setOpencodeProviderNames] = useState<Record<string, string>>({});
  const [opencodeProviderSourceById, setOpencodeProviderSourceById] = useState<Record<string, string>>({});
  const [opencodeModelsByProvider, setOpencodeModelsByProvider] = useState<Record<string, string[]>>({});
  const [opencodeModelNamesByProvider, setOpencodeModelNamesByProvider] = useState<Record<string, Record<string, string>>>({});
  const [opencodeConfiguredModelsByProvider, setOpencodeConfiguredModelsByProvider] = useState<Record<string, string[]>>({});
  const [opencodeConfiguredModelNamesByProvider, setOpencodeConfiguredModelNamesByProvider] = useState<Record<string, Record<string, string>>>({});
  const [opencodeGlobalConfigProviderMap, setOpencodeGlobalConfigProviderMap] = useState<Record<string, OpencodeServerConfigProvider>>({});
  const [opencodeDisabledProviders, setOpencodeDisabledProviders] = useState<string[]>([]);
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
  const [showOpencodeAuthDialogFor, setShowOpencodeAuthDialogFor] = useState("");
  const [opencodeProviderActionMenuFor, setOpencodeProviderActionMenuFor] = useState("");
  const [opencodeConnectBusy, setOpencodeConnectBusy] = useState(false);
  const [opencodeDisconnectingProvider, setOpencodeDisconnectingProvider] = useState("");
  const [opencodeProviderAuthCache, setOpencodeProviderAuthCache] = useState<Record<string, OpencodeProviderAuthMethod[]>>({});
  const [opencodeHiddenModels, setOpencodeHiddenModels] = useState<Set<string>>(() => new Set());
  const [opencodeDraftModel, setOpencodeDraftModel] = useState("");
  const [opencodeSessionModel, setOpencodeSessionModel] = useState<Record<string, string>>({});
  const [opencodeConfig, setOpencodeConfig] = useState<OpencodeModelConfig | null>(null);
  const [opencodeConfigBusy, setOpencodeConfigBusy] = useState(false);
  const [opencodeServiceSettings, setOpencodeServiceSettings] = useState<OpencodeServiceSettings>({
    port: 4098
  });
  const [opencodeServiceSettingsSavedPort, setOpencodeServiceSettingsSavedPort] = useState(4098);
  const [opencodeServiceSettingsBusy, setOpencodeServiceSettingsBusy] = useState(false);
  const [controlServerSettings, setControlServerSettings] = useState<ControlServerSettings>({
    enabled: false,
    host: "0.0.0.0",
    port: 4100,
    publicBaseUrl: "",
    pairCodeTtlMode: "24h"
  });
  const [controlServerSettingsSaved, setControlServerSettingsSaved] = useState<ControlServerSettings>({
    enabled: false,
    host: "0.0.0.0",
    port: 4100,
    publicBaseUrl: "",
    pairCodeTtlMode: "24h"
  });
  const [controlServerSettingsBusy, setControlServerSettingsBusy] = useState(false);
  const [controlPairCodeInfo, setControlPairCodeInfo] = useState<ControlPairCodeInfo | null>(null);
  const [controlAccessInfo, setControlAccessInfo] = useState<ControlAccessInfo | null>(null);
  const [controlSettingsLoaded, setControlSettingsLoaded] = useState(false);
  const mobileServiceStatusRef = useRef<GiteamMobileServiceStatus | null>(null);
  const [mobileStatusChangeToast, setMobileStatusChangeToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: "" });
  const [mobileServiceStatus, setMobileServiceStatus] = useState<GiteamMobileServiceStatus | null>(null);
  const [mobileServiceStatusError, setMobileServiceStatusError] = useState("");

  useEffect(() => {
    mobileServiceStatusRef.current = mobileServiceStatus;
  }, [mobileServiceStatus]);

  useEffect(() => {
    if (!runtimeStatus.giteam.installed) return;
    const prevRunningRef = { current: false };
    const interval = window.setInterval(() => {
      const st = mobileServiceStatusRef.current;
      if (!st) return;
      if (prevRunningRef.current && !st.running) {
        setMobileStatusChangeToast({ visible: true, message: "Disconnected" });
      }
      if (!prevRunningRef.current && st.running) {
        setMobileStatusChangeToast({ visible: true, message: "Connected" });
      }
      prevRunningRef.current = st.running;
    }, 2000);
    return () => window.clearInterval(interval);
  }, [runtimeStatus.giteam.installed]);

  useEffect(() => {
    if (!mobileStatusChangeToast.visible) return;
    const t = window.setTimeout(() => {
      setMobileStatusChangeToast((prev) => ({ ...prev, visible: false }));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [mobileStatusChangeToast.visible]);

  const [opencodeProviderConfigBusy, setOpencodeProviderConfigBusy] = useState(false);
  const [opencodePromptInput, setOpencodePromptInput] = useState("");
  const [opencodeSessionFetchLimit, setOpencodeSessionFetchLimit] = useState(OPENCODE_PAGE_SIZE);
  const [draftOpencodeSession, setDraftOpencodeSession] = useState(false);
  const [opencodeRunBusyBySession, setOpencodeRunBusyBySession] = useState<Record<string, boolean>>({});
  const [opencodeStreamingAssistantIdBySession, setOpencodeStreamingAssistantIdBySession] = useState<Record<string, string>>({});
  const [opencodeSessions, setOpencodeSessions] = useState<OpencodeChatSession[]>([]);
  const [activeOpencodeSessionId, setActiveOpencodeSessionId] = useState("");
  const [showOpencodeSessionRail, setShowOpencodeSessionRail] = useState(true);
  const [showOpencodeDebugLog, setShowOpencodeDebugLog] = useState(false);
  const [opencodeDebugLogs, setOpencodeDebugLogs] = useState<string[]>([]);
  const [opencodeServerMessageIdByLocalId, setOpencodeServerMessageIdByLocalId] = useState<Record<string, string>>({});
  const [opencodeLivePartsByServerMessageId, setOpencodeLivePartsByServerMessageId] = useState<Record<string, OpencodeDetailedPart[]>>({});
  const [opencodeDetailsLoadingByMessageId, setOpencodeDetailsLoadingByMessageId] = useState<Record<string, boolean>>({});
  const [opencodeDetailsErrorByMessageId, setOpencodeDetailsErrorByMessageId] = useState<Record<string, string>>({});
  const [opencodeDetailsByMessageId, setOpencodeDetailsByMessageId] = useState<Record<string, OpencodeDetailedMessage | null>>({});
  const opencodeThreadRef = useRef<HTMLDivElement | null>(null);
  const opencodeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const opencodeRightPaneRef = useRef<HTMLDivElement | null>(null);
  const opencodeModelPickerRef = useRef<HTMLDivElement | null>(null);
  const opencodePrevCountRef = useRef(0);
  const opencodeLoadingOlderRef = useRef(false);
  const opencodePrevScrollHeightRef = useRef(0);
  const opencodeRunAbortBySessionRef = useRef<Record<string, AbortController>>({});
  const controlMobilePollTokenRef = useRef(0);
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
  const [terminalInput, setTerminalInput] = useState("git status -sb");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);

  useEffect(() => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow() as unknown as { setTitleBarStyle?: (style: string) => Promise<void> | void };
        if (typeof win.setTitleBarStyle === "function") {
          return win.setTitleBarStyle("Overlay");
        }
        return undefined;
      })
      .catch(() => {
        /* noop */
      });
  }, []);

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
  const activeOpencodeSessionBusy = Boolean(activeOpencodeSessionId && opencodeRunBusyBySession[activeOpencodeSessionId]);
  const activeOpencodeStreamingAssistantId = activeOpencodeSessionId ? (opencodeStreamingAssistantIdBySession[activeOpencodeSessionId] || "") : "";
  const visibleOpencodeSessions = useMemo(
    () => opencodeSessions.slice(0, Math.max(OPENCODE_PAGE_SIZE, opencodeSessionFetchLimit)),
    [opencodeSessions, opencodeSessionFetchLimit]
  );
  const hasMoreOpencodeSessions = opencodeSessions.length >= opencodeSessionFetchLimit;
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
    // - plus providers defined in /global/config (including currently disabled ones),
    //   so users can reconnect by entering API key.
    const presetIds = PROVIDER_PRESETS.map((p) => p.id).filter(Boolean);
    const disabled = new Set((opencodeDisabledProviders || []).filter(Boolean));
    const configProviderIds = Object.keys(opencodeGlobalConfigProviderMap || {})
      .filter(Boolean)
      // Disabled preset providers stay visible for reconnection.
      // Disabled custom providers are hidden; they can be re-added via "Custom".
      .filter((id) => !disabled.has(id) || isPresetProviderId(id));
    const merged = Array.from(new Set([...presetIds, ...opencodeProviders, ...configProviderIds].filter(Boolean)));
    const connected = new Set(opencodeConnectedProviders.filter(Boolean));
    const byPriority = (arr: string[]) =>
      [...arr].sort((a, b) => {
        const ca = connected.has(a) ? 1 : 0;
        const cb = connected.has(b) ? 1 : 0;
        if (ca !== cb) return cb - ca;
        return a.localeCompare(b);
      });
    if (!q) return byPriority(merged);
    const filtered = merged.filter((id) => {
      const name = opencodeProviderNames[id] || "";
      return id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });
    return byPriority(filtered);
  }, [
    opencodeProviders,
    opencodeProviderNames,
    opencodeProviderPickerSearch,
    opencodeConnectedProviders,
    opencodeGlobalConfigProviderMap,
    opencodeDisabledProviders
  ]);

  function getOpencodeProviderSource(providerId: string): string {
    const pid = (providerId || "").trim();
    if (!pid) return "";
    return (opencodeProviderSourceById[pid] || "").trim().toLowerCase();
  }

  function isOpencodeConfigCustomProvider(providerId: string): boolean {
    const pid = (providerId || "").trim();
    if (!pid) return false;
    const provider = opencodeGlobalConfigProviderMap[pid];
    if (!provider) return false;
    if ((provider.npm || "").trim() !== "@ai-sdk/openai-compatible") return false;
    const models = provider.models || {};
    return Object.keys(models).filter(Boolean).length > 0;
  }

  function getOpencodeProviderTag(providerId: string): string {
    const source = getOpencodeProviderSource(providerId);
    if (source === "env") return "env";
    if (source === "api") return "api";
    if (source === "config") return isOpencodeConfigCustomProvider(providerId) ? "custom" : "config";
    if (source === "custom") return "custom";
    return isPresetProviderId(providerId) ? "preset" : "other";
  }
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
    if (draftOpencodeSession) return "";
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

  async function refreshOpencodeSessions(limitArg?: number) {
    if (!ensureRepoSelected()) return;
    const limit = Math.max(OPENCODE_PAGE_SIZE, limitArg ?? opencodeSessionFetchLimit);
    appendOpencodeDebugLog("session.list requested");
    const rows = await invoke<OpencodeSessionSummary[]>("list_opencode_sessions", { repoPath, limit });
    if (!rows || rows.length === 0) {
      appendOpencodeDebugLog("session.list empty");
      setOpencodeSessions([]);
      setActiveOpencodeSessionId("");
      setDraftOpencodeSession(true);
      return;
    }
    appendOpencodeDebugLog(`session.list loaded ${rows.length}`);
    const mapped = rows.map((s, i) => opencodeSessionFromSummary(s, i + 1));
    setOpencodeSessions(mapped);
    setActiveOpencodeSessionId((prev) => (prev && mapped.some((x) => x.id === prev) ? prev : mapped[0].id));
    setDraftOpencodeSession(false);
  }

  async function loadMoreOpencodeSessions() {
    const nextLimit = opencodeSessionFetchLimit + OPENCODE_PAGE_SIZE;
    setOpencodeSessionFetchLimit(nextLimit);
    await refreshOpencodeSessions(nextLimit);
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
      setOpencodeDetailsByMessageId((prev) => {
        const cur = prev[mid];
        try {
          if (cur && hit && JSON.stringify(cur) === JSON.stringify(hit)) return prev;
        } catch {
          /* ignore */
        }
        return { ...prev, [mid]: hit };
      });
      appendOpencodeDebugLog(`session.messages detailed loaded ${id} message=${serverMid} hit=${hit ? 1 : 0} total=${rows.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "unknown error");
      setOpencodeDetailsErrorByMessageId((prev) => ({ ...prev, [mid]: msg }));
      appendOpencodeDebugLog(`session.messages detailed failed ${id} message=${serverMid} ${msg}`);
    } finally {
      setOpencodeDetailsLoadingByMessageId((prev) => ({ ...prev, [mid]: false }));
    }
  }

  async function createPersistedOpencodeSession(seedPrompt?: string): Promise<string> {
    if (!ensureRepoSelected()) return "";
    appendOpencodeDebugLog("session.create requested");
    const created = await invoke<OpencodeSessionSummary>("create_opencode_session", {
      repoPath,
      title: seedPrompt?.trim() || undefined
    });
    const next = opencodeSessionFromSummary(created, opencodeSessions.length + 1);
    next.loaded = true;
    setOpencodeSessions((prev) => {
      const exists = prev.some((session) => session.id === created.id);
      return exists ? prev : [next, ...prev];
    });
    setActiveOpencodeSessionId(created.id);
    setDraftOpencodeSession(false);
    setOpencodePromptInput("");
    opencodePrevCountRef.current = 0;
    appendOpencodeDebugLog(`session.created ${created.id}`);
    requestAnimationFrame(() => {
      const el = opencodeThreadRef.current;
      if (!el) return;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    });
    return created.id;
  }

  async function createAndSwitchOpencodeSession(seedPrompt?: string) {
    if (!ensureRepoSelected()) return;
    setDraftOpencodeSession(true);
    setActiveOpencodeSessionId("");
    setOpencodePromptInput(seedPrompt?.trim() || "");
    requestAnimationFrame(() => {
      opencodeInputRef.current?.focus();
    });
  }

  async function openOpencodeChildSession(childSessionId: string, titleHint?: string) {
    const id = childSessionId.trim();
    if (!id) return;
    if (!ensureRepoSelected()) return;
    let summary: OpencodeSessionSummary | null = null;
    try {
      const rows = await invoke<OpencodeSessionSummary[]>("list_opencode_sessions", { repoPath, limit: 256 });
      summary = (rows || []).find((s) => s.id === id) || null;
    } catch {
      // fallback to optimistic local shell below
    }
    setOpencodeSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx >= 0) {
        const next = [...prev];
        const old = next[idx];
        next[idx] = {
          ...old,
          title: summary?.title || old.title || titleHint || old.title,
          updatedAt: summary?.updatedAt || Date.now(),
          createdAt: summary?.createdAt || old.createdAt
        };
        return next;
      }
      const shell: OpencodeSessionSummary = summary || {
        id,
        title: titleHint?.trim() || `Task ${id.slice(0, 8)}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const added = opencodeSessionFromSummary(shell, prev.length + 1);
      return [added, ...prev];
    });
    setActiveOpencodeSessionId(id);
    setDraftOpencodeSession(false);
    try {
      await loadOpencodeSessionMessages(id);
      appendOpencodeDebugLog(`session.child.opened ${id}`);
    } catch (e) {
      appendOpencodeDebugLog(`session.child.open.error ${id} ${String(e)}`);
    }
  }

  function upsertOpencodeLivePart(serverMessageId: string, incomingPart: unknown) {
    const mid = serverMessageId.trim();
    if (!mid || !incomingPart || typeof incomingPart !== "object") return;
    const part = incomingPart as OpencodeDetailedPart;
    const pid = String((part as any)?.id || "").trim();
    if (!pid) return;
    setOpencodeLivePartsByServerMessageId((prev) => {
      const current = prev[mid] || [];
      const next = [...current];
      const hit = next.findIndex((p) => String((p as any)?.id || "").trim() === pid);
      if (hit >= 0) {
        const previous = next[hit] as any;
        const base = { ...previous, ...(part as any) };
        const ptype = String((part as any)?.type || (next[hit] as any)?.type || "");
        let rewrote = false;
        if (ptype === "text" || ptype === "reasoning") {
          const prevText = String(previous?.text || "");
          const incomingText = String((part as any)?.text || "");
          rewrote =
            ptype === "reasoning" &&
            !!prevText.trim() &&
            !!incomingText.trim() &&
            !incomingText.startsWith(prevText) &&
            !prevText.startsWith(incomingText);
          if (rewrote) {
            const snapshot = {
              ...previous,
              id: `${pid}:snap:${Date.now().toString(36)}`,
              _snapshot: true
            } as OpencodeDetailedPart;
            next.splice(hit, 0, snapshot);
          }
          base.text = mergeOpencodeStreamText(prevText, incomingText);
        }
        next[rewrote ? hit + 1 : hit] = base as OpencodeDetailedPart;
      } else {
        const at = next.findIndex((p) => String((p as any)?.id || "").trim().localeCompare(pid) > 0);
        if (at >= 0) next.splice(at, 0, part);
        else next.push(part);
      }
      return { ...prev, [mid]: next };
    });
  }

  function patchOpencodeLivePartDelta(serverMessageId: string, partId: string, field: string, delta: string) {
    const mid = serverMessageId.trim();
    const pid = partId.trim();
    if (!mid || !pid || !field || !delta) return;
    setOpencodeLivePartsByServerMessageId((prev) => {
      const current = prev[mid] || [];
      const next = [...current];
      const hit = next.findIndex((p) => String((p as any)?.id || "").trim() === pid);
      const base =
        hit >= 0
          ? { ...(next[hit] as any) }
          : {
              id: pid,
              messageID: mid,
              type: field === "reasoning" ? "reasoning" : "text"
            };
      const old = String((base as any)[field] || "");
      (base as any)[field] = mergeOpencodeStreamText(old, old + delta);
      if (hit >= 0) next[hit] = base as OpencodeDetailedPart;
      else next.push(base as OpencodeDetailedPart);
      return { ...prev, [mid]: next };
    });
  }

  function removeOpencodeLivePart(serverMessageId: string, partId: string) {
    const mid = serverMessageId.trim();
    const pid = partId.trim();
    if (!mid || !pid) return;
    setOpencodeLivePartsByServerMessageId((prev) => {
      const current = prev[mid] || [];
      const hit = current.find((p) => String((p as any)?.id || "").trim() === pid);
      const hitType = String((hit as any)?.type || "");
      if (hitType === "reasoning" || hitType === "text") return prev;
      const next = current.filter((p) => String((p as any)?.id || "").trim() !== pid);
      if (next.length === current.length) return prev;
      return { ...prev, [mid]: next };
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
      setDraftOpencodeSession(false);
    } else if (next.length === 0) {
      setActiveOpencodeSessionId("");
      setDraftOpencodeSession(true);
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
        setRightPaneWidth(clamp(draggingSplit.startWidth - delta, 360, 760));
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
    setCheckingDeps({ git: true, entire: true, opencode: true, giteam: true });
    try {
      const deps: Array<"git" | "entire" | "opencode" | "giteam"> = ["git", "entire", "opencode", "giteam"];
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

  async function runDependencyAction(name: "git" | "entire" | "opencode" | "giteam", action: "install" | "uninstall") {
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
    const sources: Record<string, string> = {};
    const catalog: Record<string, string[]> = {};
    const modelNamesCatalog: Record<string, Record<string, string>> = {};
    for (const row of rows) {
      if (!row?.id) continue;
      names[row.id] = row.name || row.id;
      if (row.source) sources[row.id] = row.source;
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
    setOpencodeProviderSourceById((prev) => ({ ...prev, ...sources }));
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
      if (entry.source) {
        setOpencodeProviderSourceById((prev) => ({ ...prev, [entry.id]: entry.source || "" }));
      }
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
    if (!showOpencodeProviderPicker) return;
    // Reset filters so the modal shows the full provider list by default.
    setOpencodeProviderPickerSearch("");
    setOpencodeProviderPickerModelSearch("");
    setOpencodeProviderActionMenuFor("");
    setShowOpencodeAuthDialogFor("");
    appendOpencodeDebugLog(
      `providerPicker.open presets=${PROVIDER_PRESETS.length} serverProviders=${opencodeProviders.length} configuredProviders=${opencodeConfiguredProviders.length} connectedProviders=${opencodeConnectedProviders.length}`
    );
    // Ensure provider/model display names are fresh when opening the picker.
    void refreshOpencodeCatalog({ syncSelection: false, includeCurrentModel: false });
  }, [showOpencodeProviderPicker]);

  useEffect(() => {
    setOpencodeProviderActionMenuFor("");
  }, [opencodeProviderPickerProvider]);

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

  async function loadOpencodeServiceSettings() {
    try {
      const cfg = await invoke<OpencodeServiceSettings>("get_opencode_service_settings");
      const port = Number(cfg.port) > 0 ? Number(cfg.port) : 4098;
      setOpencodeServiceSettings({ port });
      setOpencodeServiceSettingsSavedPort(port);
    } catch (e) {
      appendOpencodeDebugLog(`service.settings.load error ${String(e)}`);
    }
  }

  async function loadControlServerSettings() {
    try {
      setControlSettingsLoaded(false);
      const cfg = await invoke<ControlServerSettings>("giteam_cli_get_settings");
      const next: ControlServerSettings = {
        enabled: Boolean(cfg.enabled),
        host: (cfg.host || "0.0.0.0").trim() || "0.0.0.0",
        port: Number(cfg.port) > 0 ? Number(cfg.port) : 4100,
        publicBaseUrl: String(cfg.publicBaseUrl || "").trim().replace(/\/+$/, ""),
        pairCodeTtlMode: normalizeControlPairMode((cfg as any).pairCodeTtlMode)
      };
      setControlServerSettings(next);
      setControlServerSettingsSaved(next);
      if (!next.enabled) {
        setControlPairCodeInfo(null);
        setControlAccessInfo(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setControlSettingsLoaded(true);
    }
  }

  async function loadControlPairCode() {
    try {
      const info = await invoke<ControlPairCodeInfo>("giteam_cli_get_pair_code");
      setControlPairCodeInfo(info);
    } catch (e) {
      const msg = String(e || "");
      if (!/starting/i.test(msg)) setError(msg);
    }
  }

  async function forceRefreshControlPairCode() {
    try {
      const info = await invoke<ControlPairCodeInfo>("giteam_cli_refresh_pair_code");
      setControlPairCodeInfo(info);
    } catch (e) {
      const msg = String(e || "");
      if (!/starting/i.test(msg)) setError(msg);
    }
  }

  function openMobileControlDialog() {
    if (!runtimeStatus.giteam.installed) {
      setError("");
      setMessage("Install giteam plugin first. Mobile Control API is provided by giteam CLI.");
      setShowEnvSetup(true);
      return;
    }
    setControlPairCodeInfo(null);
    setControlAccessInfo(null);
    setControlSettingsLoaded(false);
    setShowMobileControlDialog(true);
  }

  async function loadControlAccessInfo() {
    try {
      const info = await invoke<ControlAccessInfo>("giteam_cli_get_access_info");
      setControlAccessInfo(info);
    } catch (e) {
      const msg = String(e || "");
      if (!/starting/i.test(msg)) setError(msg);
    }
  }

  async function toggleControlServiceEnabled(enabled: boolean) {
    const draft: ControlServerSettings = {
      ...controlServerSettings,
      enabled
    };
    setControlServerSettings(draft);
    setControlServerSettingsBusy(true);
    setError("");
    try {
      const saved = await invoke<ControlServerSettings>("giteam_cli_set_settings", {
        settings: {
          enabled: draft.enabled,
          host: draft.host,
          port: draft.port,
          publicBaseUrl: draft.publicBaseUrl,
          pairCodeTtlMode: normalizeControlPairMode(draft.pairCodeTtlMode)
        }
      });
      const normalized = {
        enabled: Boolean(saved.enabled),
        host: (saved.host || draft.host).trim() || draft.host,
        port: Number(saved.port) > 0 ? Number(saved.port) : draft.port,
        publicBaseUrl: String(saved.publicBaseUrl || "").trim().replace(/\/+$/, ""),
        pairCodeTtlMode: normalizeControlPairMode((saved as any).pairCodeTtlMode)
      };
      setControlServerSettings(normalized);
      setControlServerSettingsSaved(normalized);
      if (normalized.enabled) {
        await Promise.all([loadControlPairCode(), loadControlAccessInfo()]);
      } else {
        setControlPairCodeInfo(null);
        setControlAccessInfo(null);
      }
    } catch (e) {
      setControlServerSettings((prev) => ({ ...prev, enabled: controlServerSettingsSaved.enabled }));
      setError(String(e));
    } finally {
      setControlServerSettingsBusy(false);
    }
  }

  async function saveOpencodeServiceSettingsIfNeeded() {
    const port = Number(opencodeServiceSettings.port);
    if (port === opencodeServiceSettingsSavedPort) return true;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Service port must be between 1 and 65535");
      return false;
    }
    setOpencodeServiceSettingsBusy(true);
    try {
      const next = await invoke<OpencodeServiceSettings>("set_opencode_service_settings", {
        settings: { port },
        repoPath: repoPath || null
      });
      const savedPort = Number(next.port) > 0 ? Number(next.port) : port;
      setOpencodeServiceSettings({ port: savedPort });
      setOpencodeServiceSettingsSavedPort(savedPort);
      appendOpencodeDebugLog(`service.settings saved port=${savedPort}`);
      setMessage("OpenCode service restarted");
      if (selectedRepo) {
        void refreshOpencodeCatalog({ syncSelection: false, includeCurrentModel: false });
        void refreshOpencodeSessions().catch((e) => setError(String(e)));
      }
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setOpencodeServiceSettingsBusy(false);
    }
  }

  async function saveControlServerSettingsIfNeeded() {
    const changed =
      controlServerSettings.enabled !== controlServerSettingsSaved.enabled ||
      Number(controlServerSettings.port) !== Number(controlServerSettingsSaved.port) ||
      controlServerSettings.pairCodeTtlMode !== controlServerSettingsSaved.pairCodeTtlMode ||
      String(controlServerSettings.publicBaseUrl || "").trim().replace(/\/+$/, "") !==
        String(controlServerSettingsSaved.publicBaseUrl || "").trim().replace(/\/+$/, "");
    if (!changed) return true;
    const port = Number(controlServerSettings.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Control server port must be between 1 and 65535");
      return false;
    }
    let publicBaseUrl = String(controlServerSettings.publicBaseUrl || "").trim().replace(/\/+$/, "");
    if (publicBaseUrl && !/^https?:\/\//i.test(publicBaseUrl)) {
      publicBaseUrl = `http://${publicBaseUrl}`;
    }
    if (publicBaseUrl) {
      try {
        const parsed = new URL(publicBaseUrl);
        publicBaseUrl = `${parsed.protocol}//${parsed.host}`;
      } catch {
        setError("Public URL 格式无效（示例: http://192.168.1.23:4100）");
        return false;
      }
    }
    setControlServerSettingsBusy(true);
    try {
      const saved = await invoke<ControlServerSettings>("giteam_cli_set_settings", {
        settings: {
          enabled: controlServerSettings.enabled,
          host: controlServerSettings.host,
          port,
          publicBaseUrl,
          pairCodeTtlMode: normalizeControlPairMode(controlServerSettings.pairCodeTtlMode)
        }
      });
      const normalized = {
        enabled: Boolean(saved.enabled),
        host: (saved.host || controlServerSettings.host).trim() || controlServerSettings.host,
        port: Number(saved.port) > 0 ? Number(saved.port) : port,
        publicBaseUrl: String(saved.publicBaseUrl || "").trim().replace(/\/+$/, ""),
        pairCodeTtlMode: normalizeControlPairMode((saved as any).pairCodeTtlMode)
      };
      setControlServerSettings(normalized);
      setControlServerSettingsSaved(normalized);
      void loadControlPairCode();
      void loadControlAccessInfo();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setControlServerSettingsBusy(false);
    }
  }

  async function closeSettingsModal() {
    setShowMobileControlDialog(false);
    setShowOpencodeApiDialog(false);
    setShowSettings(false);
  }

  async function closeMobileControlDialog() {
    const ok = await saveControlServerSettingsIfNeeded();
    if (ok) setShowMobileControlDialog(false);
  }

  async function closeOpencodeApiDialog() {
    const ok = await saveOpencodeServiceSettingsIfNeeded();
    if (ok) setShowOpencodeApiDialog(false);
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
      setOpencodeProviderSourceById(() => {
        const next: Record<string, string> = {};
        for (const p of rows) {
          if (!p?.id) continue;
          if (p.source) next[p.id] = p.source;
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
      setOpencodeGlobalConfigProviderMap(providerMap);
      const disabled = new Set((globalCfg?.disabled_providers || []).filter(Boolean));
      setOpencodeDisabledProviders(Array.from(disabled).sort((a, b) => a.localeCompare(b)));
      const configuredProviders = Object.keys(providerMap).filter((id) => id && !disabled.has(id));

      // Build "configured models" catalog from /config.provider.*.models (OpenCode UI behavior)
      const names: Record<string, string> = {};
      const modelsByProvider: Record<string, string[]> = {};
      const modelNamesByProvider: Record<string, Record<string, string>> = {};
      for (const [pid, p] of Object.entries(providerMap)) {
        if (pid) names[pid] = p?.name || pid;
        if (!pid || disabled.has(pid)) continue;
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


  function ensureProviderExists(provider: string) {
    if (!provider) return;
    setOpencodeProviders((prev) => (prev.includes(provider) ? prev : [...prev, provider].sort((a, b) => a.localeCompare(b))));
  }

  async function disconnectOpencodeProvider(providerId: string) {
    const pid = providerId.trim();
    if (!pid) return;
    if (!ensureRepoSelected()) return;
    if (getOpencodeProviderSource(pid) === "env") {
      setMessage("Environment provider cannot be disconnected");
      return;
    }
    setOpencodeDisconnectingProvider(pid);
    setError("");
    try {
      await invoke<boolean>("disconnect_opencode_server_provider", { repoPath, providerId: pid });

      // Verify on server immediately after command; if still connected, do an explicit fallback sequence.
      const afterState = await invoke<OpencodeServerProviderState>("get_opencode_server_provider_state", { repoPath }).catch(() => null);
      const afterCfg = await invoke<OpencodeServerConfig>("get_opencode_server_global_config", { repoPath }).catch(() => null);
      const stillConnected = !!afterState?.connected?.includes(pid);

      if (stillConnected) {
        await invoke<boolean>("delete_opencode_server_auth", { repoPath, providerId: pid }).catch(() => false);
        const disabled = Array.isArray(afterCfg?.disabled_providers)
          ? afterCfg!.disabled_providers!.filter((x) => String(x || "").trim())
          : [];
        const nextDisabled = Array.from(new Set([...disabled, pid]));
        await invoke<OpencodeServerConfig>("patch_opencode_server_config", {
          repoPath,
          patch: {
            disabled_providers: nextDisabled
          }
        });

        const finalState = await invoke<OpencodeServerProviderState>("get_opencode_server_provider_state", { repoPath }).catch(() => null);
        const finalConnected = !!finalState?.connected?.includes(pid);
        if (finalConnected) {
          throw new Error(`Provider still connected after fallback: ${pid}`);
        }
      }

      if (showOpencodeAuthDialogFor === pid) {
        setShowOpencodeAuthDialogFor("");
      }
      if (opencodeProviderActionMenuFor === pid) {
        setOpencodeProviderActionMenuFor("");
      }
      await refreshOpencodeCatalog({ syncSelection: false, includeCurrentModel: false });
      setMessage(`Disconnected provider: ${pid}`);
    } catch (e) {
      setError(String(e));
      setMessage("Disconnect provider failed");
    } finally {
      setOpencodeDisconnectingProvider("");
    }
  }

  async function runOpencodePrompt() {
    if (!ensureRepoSelected()) return;
    const prompt = opencodePromptInput.trim();
    if (!prompt) return;
    let sessionId = ensureActiveOpencodeSession();
    if (!sessionId || draftOpencodeSession) {
      sessionId = await createPersistedOpencodeSession(prompt);
    }
    if (!sessionId) return;
    if (opencodeRunBusyBySession[sessionId]) return;
    const assistantId = `assistant-${makeId()}`;
    const requestId = `req-${makeId()}`;
    setOpencodeStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: assistantId }));
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
    setOpencodeRunBusyBySession((prev) => ({ ...prev, [sessionId]: true }));
    const sessionModel = normalizeModelRef(opencodeSessionModel[sessionId] || "");
    const activeModel = normalizeModelRef(activeOpencodeModel || "");
    const draftModel = normalizeModelRef(opencodeDraftModel || "");
    const configuredModel = normalizeModelRef(opencodeConfig?.configuredModel || "");
    const uiModel = normalizeModelRef(
      (opencodeModelProvider && opencodeSelectedModel) ? `${opencodeModelProvider}/${opencodeSelectedModel}` : ""
    );
    const rawModel = sessionModel || activeModel || draftModel || uiModel || configuredModel || "";
    const modelSource = sessionModel
      ? "session.selection"
      : activeModel
        ? "active.selection"
        : draftModel
          ? "draft.selection"
          : uiModel
            ? "ui.picker"
            : configuredModel
              ? "config.model"
              : "none";
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
        `source=${modelSource}`
      ].join(" ")
    );
    let done = false;
    /** Track run-local assistant cards by upstream server message id. */
    let currentStreamingLocalAssistantId = assistantId;
    const localAssistantIds: string[] = [assistantId];
    const localAssistantByServerMessageId = new Map<string, string>();
    const serverMessageByLocalAssistantId = new Map<string, string>();
    let streamAbort: AbortController | null = null;
    let fallbackTimer: number | null = null;
    let textFlushTimer: number | null = null;
    const bufferedAssistantDeltaByLocalId = new Map<string, string>();
    const hydrateFinalAssistantText = async (localId: string, serverMessageId: string) => {
      try {
        const raw = await invoke<unknown>("get_opencode_session_messages_detailed", {
          repoPath,
          sessionId,
          directory: repoPath,
          limit: 200
        });
        const rows = (Array.isArray(raw) ? raw : []).filter(Boolean) as OpencodeDetailedMessage[];
        const targetId = serverMessageId.trim();
        let hit: OpencodeDetailedMessage | null = null;
        if (targetId) {
          hit = rows.find((m) => String((m as any)?.info?.id || "") === targetId) ?? null;
        }
        if (!hit) {
          hit =
            [...rows]
              .reverse()
              .find((m) => {
                const role = String((m as any)?.info?.role ?? (m as any)?.role ?? "").trim().toLowerCase();
                return role === "assistant";
              }) ?? null;
        }
        const mainMd = buildOpencodeMainLineMarkdownFromParts((hit as any)?.parts);
        appendOpencodeDebugLog(
          `prompt.hydrateFinal rows=${rows.length} id=${targetId || "(fallback)"} assistantHit=${mainMd.trim() ? 1 : 0}`
        );
        if (!mainMd.trim()) return;
        updateOpencodeSessionById(sessionId, (session) => ({
          ...session,
          messages: session.messages.map((msg) => (msg.id === localId ? { ...msg, content: mainMd } : msg)),
          updatedAt: Date.now()
        }));
      } catch (e) {
        appendOpencodeDebugLog(`prompt.hydrateFinal.warn ${String(e)}`);
      }
    };
    const finalize = () => {
      if (done) return;
      if (textFlushTimer) {
        window.clearTimeout(textFlushTimer);
        textFlushTimer = null;
      }
      done = true;
      for (const [localId, chunk] of bufferedAssistantDeltaByLocalId.entries()) {
        if (!chunk) continue;
        updateOpencodeSessionById(sessionId, (session) => ({
          ...session,
          messages: session.messages.map((msg) =>
            msg.id === localId ? { ...msg, content: (msg.content || "") + chunk } : msg
          ),
          updatedAt: Date.now()
        }));
      }
      bufferedAssistantDeltaByLocalId.clear();
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (streamAbort) {
        streamAbort.abort();
        streamAbort = null;
      }
      setOpencodeRunBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
      setOpencodeStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: "" }));
      delete opencodeRunAbortBySessionRef.current[sessionId];
      appendOpencodeDebugLog(`prompt.finalize session=${sessionId}`);
      void (async () => {
        for (const localId of localAssistantIds) {
          const sid = (serverMessageByLocalAssistantId.get(localId) || "").trim();
          if (sid) {
            await hydrateFinalAssistantText(localId, sid);
          }
          await loadOpencodeMessageDetails(sessionId, localId, 80);
        }
        updateOpencodeSessionById(sessionId, (session) => ({
          ...session,
          messages: session.messages.map((msg) =>
            localAssistantIds.includes(msg.id) && !(msg.content || "").trim() ? { ...msg, content: "(empty response)" } : msg
          ),
          updatedAt: Date.now()
        }));
        scrollToBottom();
      })();
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
        sessionModel ||
        activeModel ||
        draftModel ||
        uiModel ||
        serverModel ||
        "";
      if (serverModel && model && serverModel !== model) {
        appendOpencodeDebugLog(`prompt.model.override local=${model} server=${serverModel} (kept local)`);
      }
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      const qdir = encodeURIComponent(repoPath);
      const eventUrl = `${base}/global/event?directory=${qdir}`;
      const promptUrl = `${base}/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${qdir}`;
      appendOpencodeDebugLog(`prompt.stream.connect ${eventUrl}`);

      const roleByMessageId = new Map<string, string>();
      let seenAssistantActivity = false;
      let promptPosted = false;
      streamAbort = new AbortController();
      opencodeRunAbortBySessionRef.current[sessionId] = streamAbort;
      const streamSignal = streamAbort.signal;
      const bindServerToLocalAssistant = (messageID: string, localId: string) => {
        const mid = messageID.trim();
        const lid = localId.trim();
        if (!mid || !lid) return;
        localAssistantByServerMessageId.set(mid, lid);
        serverMessageByLocalAssistantId.set(lid, mid);
        setOpencodeServerMessageIdByLocalId((prev) => ({ ...prev, [lid]: mid }));
        setOpencodeLivePartsByServerMessageId((prev) => (prev[mid] ? prev : { ...prev, [mid]: [] }));
      };
      const ensureLocalAssistantForServerMessage = (messageID: string): string => {
        const mid = messageID.trim();
        if (!mid) return "";
        const cached = localAssistantByServerMessageId.get(mid);
        if (cached) return cached;
        if (localAssistantByServerMessageId.size === 0) {
          bindServerToLocalAssistant(mid, assistantId);
          currentStreamingLocalAssistantId = assistantId;
          return assistantId;
        }
        const localId = `assistant-${makeId()}`;
        localAssistantIds.push(localId);
        bindServerToLocalAssistant(mid, localId);
        currentStreamingLocalAssistantId = localId;
        setOpencodeStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: localId }));
        updateOpencodeSessionById(sessionId, (session) => {
          if (session.messages.some((m) => m.id === localId)) return session;
          const nextMessages = [...session.messages, { id: localId, role: "assistant" as const, content: "" }];
          return {
            ...session,
            messages: nextMessages,
            visibleCount: Math.min(nextMessages.length, Math.max(OPENCODE_RECENT_VISIBLE, session.visibleCount + 1)),
            updatedAt: Date.now()
          };
        });
        scrollToBottom();
        return localId;
      };
      const resolveLocalAssistantFromEvent = (messageID: string): string => {
        const mid = messageID.trim();
        if (!mid) return "";
        const role = roleByMessageId.get(mid) || "";
        if (role && role !== "assistant") return "";
        return ensureLocalAssistantForServerMessage(mid);
      };
      const flushAssistantTextDelta = (targetLocalId?: string) => {
        if (done) return;
        const localId = (targetLocalId || "").trim();
        if (!localId) {
          for (const [lid, chunk] of bufferedAssistantDeltaByLocalId.entries()) {
            if (!chunk) continue;
            updateOpencodeSessionById(sessionId, (session) => ({
              ...session,
              messages: session.messages.map((msg) =>
                msg.id === lid ? { ...msg, content: (msg.content || "") + chunk } : msg
              ),
              updatedAt: Date.now()
            }));
          }
          bufferedAssistantDeltaByLocalId.clear();
          scrollToBottom();
          return;
        }
        const chunk = bufferedAssistantDeltaByLocalId.get(localId) || "";
        if (!chunk) return;
        bufferedAssistantDeltaByLocalId.set(localId, "");
        updateOpencodeSessionById(sessionId, (session) => ({
          ...session,
          messages: session.messages.map((msg) =>
            msg.id === localId ? { ...msg, content: (msg.content || "") + chunk } : msg
          ),
          updatedAt: Date.now()
        }));
        scrollToBottom();
      };
      const scheduleAssistantTextFlush = () => {
        if (textFlushTimer || done) return;
        textFlushTimer = window.setTimeout(() => {
          textFlushTimer = null;
          flushAssistantTextDelta();
        }, 16);
      };

      const onRawEvent = (raw: string) => {
        let evtObj: any;
        try {
          evtObj = JSON.parse(raw);
        } catch {
          return;
        }
        const wrapped = evtObj?.payload ? evtObj.payload : evtObj;
        const typ = String(wrapped?.type || "");
        const props = wrapped?.properties || {};

        if (typ === "message.updated") {
          const sid = String(props?.sessionID || "");
          if (sid !== sessionId) return;
          const info = props?.info || {};
          const role = String(info?.role || "");
          const mid = String(info?.id || "");
          if (mid) roleByMessageId.set(mid, role);
          if (role === "assistant" && mid) {
            seenAssistantActivity = true;
            const localId = ensureLocalAssistantForServerMessage(mid);
            currentStreamingLocalAssistantId = localId || currentStreamingLocalAssistantId;
          }
          if (role === "assistant" && info?.error) {
            const localId = mid ? ensureLocalAssistantForServerMessage(mid) : currentStreamingLocalAssistantId;
            updateOpencodeSessionById(sessionId, (session) => ({
              ...session,
              messages: session.messages.map((msg) =>
                msg.id === localId ? { ...msg, content: `Run failed\n${toDisplayJson(info.error, 1200)}` } : msg
              ),
              updatedAt: Date.now()
            }));
            scrollToBottom();
          }
          return;
        }

        if (typ === "message.part.delta") {
          const sid = String(props?.sessionID || "");
          if (sid !== sessionId) return;
          const messageID = String(props?.messageID || "");
          const localId = resolveLocalAssistantFromEvent(messageID);
          if (!localId) return;
          seenAssistantActivity = true;
          const field = String(props?.field || "");
          const delta = String(props?.delta || "");
          const partID = String(props?.partID || "");
          if (!delta) return;
          if (field === "reasoning" || field === "text") {
            patchOpencodeLivePartDelta(messageID, partID, field, delta);
          }
          if (field === "text") {
            const cur = bufferedAssistantDeltaByLocalId.get(localId) || "";
            bufferedAssistantDeltaByLocalId.set(localId, cur + delta);
            scheduleAssistantTextFlush();
          }
          return;
        }

        if (typ === "message.part.updated") {
          const part = props?.part || {};
          const sid = String(part?.sessionID || props?.sessionID || "");
          if (sid !== sessionId) return;
          const messageID = String(part?.messageID || "");
          const localId = resolveLocalAssistantFromEvent(messageID);
          if (!localId) return;
          seenAssistantActivity = true;
          upsertOpencodeLivePart(messageID, part);
          const ptype = String(part?.type || "");
          if (ptype === "text") flushAssistantTextDelta(localId);
          return;
        }

        if (typ === "message.part.removed") {
          const sid = String(props?.sessionID || "");
          if (sid !== sessionId) return;
          const messageID = String(props?.messageID || "");
          const localId = resolveLocalAssistantFromEvent(messageID);
          if (!localId) return;
          const partID = String(props?.partID || "");
          removeOpencodeLivePart(messageID, partID);
          return;
        }

        if (typ === "session.error") {
          const sid = String(props?.sessionID || "");
          if (sid !== sessionId) return;
          const err = toDisplayJson(props?.error, 1200);
          updateOpencodeSessionById(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((msg) =>
              msg.id === currentStreamingLocalAssistantId ? { ...msg, content: `Run failed\n${err}` } : msg
            ),
            updatedAt: Date.now()
          }));
          scrollToBottom();
          finalize();
          return;
        }

        if (typ === "session.status") {
          const sid = String(props?.sessionID || "");
          const statusType = String(props?.status?.type || "");
          if (sid === sessionId && statusType === "idle" && (seenAssistantActivity || promptPosted)) {
            finalize();
          }
          return;
        }

        if (typ === "session.idle") {
          const sid = String(props?.sessionID || "");
          if (sid === sessionId && (seenAssistantActivity || promptPosted)) {
            finalize();
          }
          return;
        }
      };

      void (async () => {
        try {
          const resp = await fetch(eventUrl, {
            method: "GET",
            headers: { Accept: "text/event-stream" },
            signal: streamSignal
          });
          if (!resp.ok || !resp.body) {
            throw new Error(`SSE connect failed: HTTP ${resp.status}`);
          }
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          const processFrame = (frame: string) => {
            if (!frame.trim()) return;
            const dataLines: string[] = [];
            for (const rawLine of frame.split(/\r?\n/)) {
              if (!rawLine || rawLine.startsWith(":")) continue;
              if (!rawLine.startsWith("data:")) continue;
              const payload = rawLine.slice(5).replace(/^\s/, "");
              dataLines.push(payload);
            }
            if (dataLines.length <= 0) return;
            onRawEvent(dataLines.join("\n"));
          };
          while (!done) {
            const { value, done: rdDone } = await reader.read();
            if (rdDone) break;
            buf += decoder.decode(value, { stream: true });
            // SSE frames are separated by blank lines and may include multi-line data fields.
            while (true) {
              const m = buf.match(/\r?\n\r?\n/);
              if (!m || m.index == null) break;
              const frame = buf.slice(0, m.index);
              buf = buf.slice(m.index + m[0].length);
              processFrame(frame);
            }
          }
          processFrame(buf);
        } catch (streamErr) {
          if (done) return;
          appendOpencodeDebugLog(`prompt.sse.error ${String(streamErr)}`);
          updateOpencodeSessionById(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((msg) =>
              msg.id === assistantId ? { ...msg, content: `Run failed\n${String(streamErr)}` } : msg
            ),
            updatedAt: Date.now()
          }));
          scrollToBottom();
          finalize();
        }
      })();

      fallbackTimer = window.setTimeout(() => {
        if (done) return;
        appendOpencodeDebugLog("prompt.safetyFinalize 600s without done");
        finalize();
      }, 600_000);

      const promptBody: Record<string, unknown> = {
        parts: [{ type: "text", text: prompt }]
      };
      const mr = parseModelRef(model);
      if (mr) {
        promptBody.model = {
          providerID: mr.provider,
          modelID: mr.model
        };
      }
      const postResp = await fetch(promptUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(promptBody)
      });
      if (!(postResp.status === 204 || postResp.ok)) {
        const bodyText = await postResp.text().catch(() => "");
        throw new Error(`prompt_async failed: HTTP ${postResp.status} ${bodyText}`);
      }
      promptPosted = true;
      appendOpencodeDebugLog(`prompt.invoke.ok request=${requestId} directSSE`);
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

  async function stopOpencodePrompt(sessionIdInput?: string) {
    const sid = (sessionIdInput || activeOpencodeSessionId || "").trim();
    if (!sid) return;
    const ctl = opencodeRunAbortBySessionRef.current[sid];
    if (ctl) {
      try {
        ctl.abort();
      } catch {
        // ignore
      }
      delete opencodeRunAbortBySessionRef.current[sid];
    }
    setOpencodeRunBusyBySession((prev) => ({ ...prev, [sid]: false }));
    setOpencodeStreamingAssistantIdBySession((prev) => ({ ...prev, [sid]: "" }));
    try {
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      const qdir = encodeURIComponent(repoPath);
      await fetch(`${base}/session/${encodeURIComponent(sid)}/abort?directory=${qdir}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      appendOpencodeDebugLog(`prompt.abort session=${sid}`);
    } catch (e) {
      appendOpencodeDebugLog(`prompt.abort.error session=${sid} ${String(e)}`);
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

  async function refreshWorktreeData(preferredFile?: string) {
    if (!ensureRepoSelected()) return;
    try {
      const overview = await getGitWorktreeOverview(repoPath);
      setWorktreeOverview(overview);
      const target = preferredFile && overview.entries.some((entry) => entry.path === preferredFile)
        ? preferredFile
        : overview.entries[0]?.path || "";
      setSelectedWorktreeFile(target);
      if (!target) {
        setSelectedWorktreePatch(overview.clean ? "Working tree is clean." : "No patch available.");
        return;
      }
      const patch = await getGitWorktreeFilePatch(repoPath, target);
      setSelectedWorktreePatch(patch);
    } catch (e) {
      setError(String(e));
      setWorktreeOverview(EMPTY_WORKTREE);
      setSelectedWorktreeFile("");
      setSelectedWorktreePatch("");
    }
  }

  async function refreshGitUserIdentity() {
    if (!ensureRepoSelected()) return;
    try {
      const identity = await getGitUserIdentity(repoPath);
      setGitUserIdentity(identity);
    } catch {
      setGitUserIdentity(EMPTY_GIT_IDENTITY);
    }
  }

  async function refreshSelectedWorktreePatch(filePath: string) {
    if (!ensureRepoSelected() || !filePath) return;
    setSelectedWorktreeFile(filePath);
    try {
      const patch = await getGitWorktreeFilePatch(repoPath, filePath);
      setSelectedWorktreePatch(patch);
    } catch (e) {
      setError(String(e));
      setSelectedWorktreePatch("");
    }
  }

  async function runTerminalCommand(command?: string) {
    if (!ensureRepoSelected()) return;
    const script = (command ?? terminalInput).trim();
    if (!script) return;
    setTerminalBusy(true);
    try {
      const output = await runRepoTerminalCommand(repoPath, script);
      setTerminalEntries((prev) => [
        {
          id: `term-${makeId()}`,
          command: script,
          output: output.trim() || "(no output)",
          createdAt: Date.now(),
          ok: true
        },
        ...prev
      ].slice(0, 40));
      setTerminalInput(script);
    } catch (e) {
      const msg = String(e);
      setTerminalEntries((prev) => [
        {
          id: `term-${makeId()}`,
          command: script,
          output: msg,
          createdAt: Date.now(),
          ok: false
        },
        ...prev
      ].slice(0, 40));
      setError(msg);
    } finally {
      setTerminalBusy(false);
    }
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
      await refreshWorktreeData(selectedWorktreeFile);
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
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
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
      await refreshWorktreeData(selectedWorktreeFile);
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
    const collapseIfNarrow = () => {
      const paneWidth = opencodeRightPaneRef.current?.clientWidth || 0;
      if (window.innerWidth <= 900 || paneWidth <= 620) setShowOpencodeSessionRail(false);
    };
    const observer = new ResizeObserver(() => collapseIfNarrow());
    if (opencodeRightPaneRef.current) observer.observe(opencodeRightPaneRef.current);
    window.addEventListener("resize", collapseIfNarrow);
    collapseIfNarrow();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", collapseIfNarrow);
    };
  }, []);

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
    setOpencodeSessionFetchLimit(OPENCODE_PAGE_SIZE);
    void Promise.all([refreshStatus(), refreshBranchesAndCommits(), refreshReviewData(), refreshWorktreeData(), refreshGitUserIdentity()]).catch((e) => {
      setError(String(e));
      setMessage("仓库数据加载失败");
    });
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!selectedRepo?.id) return;
    setExpandedProjectIds((prev) => (prev.includes(selectedRepo.id) ? prev : [...prev, selectedRepo.id]));
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!selectedCommit) return;
    void refreshCommitContext(selectedCommit);
  }, [selectedCommit]);

  useEffect(() => {
    if (draftOpencodeSession) return;
    if (opencodeSessions.length === 0) return;
    if (!opencodeSessions.some((s) => s.id === activeOpencodeSessionId)) {
      setActiveOpencodeSessionId(opencodeSessions[0].id);
    }
  }, [opencodeSessions, activeOpencodeSessionId, draftOpencodeSession]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    if (opencodeProviders.length > 0) return;
    void refreshOpencodeCatalog();
  }, [runtimeStatus.opencode.installed, selectedRepo?.id]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    void refreshOpencodeSessions(OPENCODE_PAGE_SIZE).catch((e) => setError(String(e)));
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
    if (!runtimeStatus.opencode.installed) return;
    void loadOpencodeServiceSettings();
  }, [runtimeStatus.opencode.installed]);

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
    if (!showMobileControlDialog || !runtimeStatus.giteam.installed) return;
    // Load settings after the dialog paints to avoid blocking navigation.
    window.setTimeout(() => {
      void loadControlServerSettings();
    }, 0);
  }, [showMobileControlDialog, runtimeStatus.giteam.installed]);

  useEffect(() => {
    if (!showMobileControlDialog || !runtimeStatus.giteam.installed) return;
    if (!controlSettingsLoaded || !controlServerSettings.enabled) return;

    const token = ++controlMobilePollTokenRef.current;
    void invoke("giteam_cli_start_mobile_service_background").catch(() => {
      // ignore
    });

    const poll = async (attempt: number) => {
      if (controlMobilePollTokenRef.current !== token) return;
      try {
        const st = await invoke<GiteamMobileServiceStatus>("giteam_cli_get_mobile_service_status");
        if (controlMobilePollTokenRef.current !== token) return;
        if (!st?.running) {
          window.setTimeout(() => void poll(attempt + 1), Math.min(800, 200 + attempt * 50));
          return;
        }
      } catch {
        window.setTimeout(() => void poll(attempt + 1), Math.min(800, 200 + attempt * 50));
        return;
      }

      await Promise.all([loadControlPairCode(), loadControlAccessInfo()]);
    };

    void poll(0);
    return () => {
      if (controlMobilePollTokenRef.current === token) controlMobilePollTokenRef.current++;
    };
  }, [
    showMobileControlDialog,
    runtimeStatus.giteam.installed,
    controlSettingsLoaded,
    controlServerSettings.enabled
  ]);

  useEffect(() => {
    if (runtimeStatus.giteam.installed) return;
    setShowMobileControlDialog(false);
  }, [runtimeStatus.giteam.installed]);

  useEffect(() => {
    if (!runtimeStatus.giteam.installed) {
      setMobileServiceStatus(null);
      setMobileServiceStatusError("");
      return;
    }
    let stopped = false;
    const poll = async () => {
      try {
        const st = await invoke<GiteamMobileServiceStatus>("giteam_cli_get_mobile_service_status");
        if (stopped) return;
        setMobileServiceStatus(st);
        setMobileServiceStatusError("");
      } catch (e) {
        if (stopped) return;
        setMobileServiceStatusError(String(e || "status error"));
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), 1500);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [runtimeStatus.giteam.installed]);

  useEffect(() => {
    if (!overlayBusy) return;
    const t = window.setTimeout(() => {
      setOverlayBusy(false);
      setBusy(false);
      setMessage("操作超时（已自动解除加载遮罩）");
    }, 15000);
    return () => window.clearTimeout(t);
  }, [overlayBusy]);

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
    Object.values(opencodeRunAbortBySessionRef.current).forEach((ctl) => {
      try {
        ctl.abort();
      } catch {
        // ignore
      }
    });
    opencodeRunAbortBySessionRef.current = {};
    setOpencodeSessions([]);
    setActiveOpencodeSessionId("");
    setDraftOpencodeSession(false);
    setOpencodeRunBusyBySession({});
    setOpencodeStreamingAssistantIdBySession({});
    setOpencodeLivePartsByServerMessageId({});
    setOpencodePromptInput("");
    opencodePrevCountRef.current = 0;
    setTerminalEntries([]);
    setTerminalInput("git status -sb");
    setGitUserIdentity(EMPTY_GIT_IDENTITY);
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
    const streamingId = activeOpencodeStreamingAssistantId;
    const running = activeOpencodeSessionBusy;
    // Only show the "Thinking" placeholder for the currently-streaming assistant message.
    // Any older empty assistant messages are treated as transient placeholders and hidden.
    return visible.filter((msg) => {
      if (msg.role !== "assistant") return true;
      if ((msg.content || "").trim()) return true;
      return msg.id === streamingId && running;
    });
  }, [opencodeMessages, opencodeVisibleCount, activeOpencodeStreamingAssistantId, activeOpencodeSessionBusy]);

  function renderOpencodeExecutionPart(part: OpencodeDetailedPart, keyHint: string) {
    const type = String(part?.type || "");
    if (type === "step-start" || type === "step-finish") {
      return null;
    }
    if (type !== "tool") return null;
    const tool = String((part as any).tool || "tool");
    if (tool === "todowrite") return null;
    const state = (part as any).state || {};
    const status = String(state.status || "").trim();
    const running = status.toLowerCase() === "running" || status.toLowerCase() === "pending";
    const input = state.input;
    const output = state.output;
    const subtitle =
      String(input?.description || input?.filePath || input?.pattern || input?.query || input?.url || "").trim();
    const ioLabel = (() => {
      if (!running) return "";
      if (tool === "read" || tool === "list" || tool === "glob" || tool === "grep") return "读取";
      if (tool === "write" || tool === "edit" || tool === "apply_patch") return "写入";
      return "";
    })();
    const taskSessionId = tool === "task" ? parseOpencodeTaskSessionId(part) : "";
    const taskSubagent = tool === "task" ? String(input?.subagent_type || "").trim() : "";
    const taskTitleHint =
      (tool === "task" ? String(input?.description || "").trim() : "") ||
      (taskSubagent ? `@${taskSubagent}` : "") ||
      "";
    const contextTool = isOpencodeContextTool(tool);
    const parsedRead = tool === "read" && typeof output === "string" ? parseReadToolOutput(output) : null;
    const outputText = typeof output === "string" ? output : output ? toDisplayJson(output, 2200) : "";
    const rawLines = outputText ? outputText.split("\n") : [];
    const previewLines = rawLines.slice(0, 12);
    const outputPreview = previewLines.join("\n") + (rawLines.length > 12 ? "\n..." : "");
    const showOutput = !contextTool && !!outputPreview && (status === "error" || tool === "bash");
    return (
      <div key={`oce-tool-${keyHint}`} className="opencode-exec-item opencode-exec-tool">
        <div className="opencode-exec-tool-head">
          <span
            className={
              status === "error"
                ? "opencode-exec-status opencode-exec-status-error"
                : running
                  ? "opencode-exec-status opencode-exec-status-running"
                  : "opencode-exec-status"
            }
            aria-hidden="true"
          />
          <strong className={running ? "opencode-live-text" : ""}>{tool}</strong>
          {ioLabel ? <span className="opencode-io-live">{ioLabel}</span> : null}
          {subtitle ? <span className="small muted">{subtitle}</span> : null}
          {taskSessionId ? (
            <button
              type="button"
              className="opencode-task-link"
              onClick={() => void openOpencodeChildSession(taskSessionId, taskTitleHint)}
              title={taskSubagent ? `Open @${taskSubagent} sub-session` : "Open sub-session"}
            >
              {taskSubagent ? `Open @${taskSubagent}` : "Open task"}
            </button>
          ) : null}
        </div>
        {parsedRead ? (
          <pre className="opencode-tool-output">{withLineNumbers(parsedRead.content, 80)}</pre>
        ) : null}
        {!parsedRead && showOutput ? <pre className="opencode-tool-output">{outputPreview}</pre> : null}
      </div>
    );
  }

  // 主线正文由 OpenCode 原始 SSE 流式更新；`/message` 仅在结束后 hydrate 对齐。
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

  const activityBar = <div />;

  const sideBar = (
    <div className="wb-sidebar-inner gt-sidebar-inner">
      <div className="gt-sidebar-top">
        <button className="gt-new-session-btn" onClick={() => void createAndSwitchOpencodeSession()} disabled={!selectedRepo || !runtimeStatus.opencode.installed}>
          <span>＋</span>
          <span>New Session</span>
        </button>
      </div>

      <div className="gt-project-stack">
        {repos.length === 0 ? <div className="gt-empty-hint">还没有项目，先导入一个本地 Git 仓库。</div> : null}
        {repos.map((repo) => {
          const active = selectedRepo?.id === repo.id;
          const expanded = expandedProjectIds.includes(repo.id);
          return (
            <div key={repo.id} className="gt-tree-group">
              <div
                className="gt-tree-row"
                title={repo.path}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openRepoContextMenu(e.clientX, e.clientY, repo);
                }}
              >
                <button
                  className="gt-tree-toggle"
                  aria-label={expanded ? "收起项目" : "展开项目"}
                  onClick={() => {
                    setExpandedProjectIds((prev) => (prev.includes(repo.id) ? prev.filter((id) => id !== repo.id) : [...prev, repo.id]));
                  }}
                >
                  {expanded ? "▾" : "▸"}
                </button>
                <button
                  className={active ? "gt-tree-label active" : "gt-tree-label"}
                  onClick={() => {
                    if (busy) return;
                    setSelectedRepo(repo);
                    setExpandedProjectIds((prev) => (prev.includes(repo.id) ? prev : [...prev, repo.id]));
                  }}
                >
                  {repo.name}
                </button>
              </div>

              {expanded ? (
                <div className="gt-tree-children">
                  {draftOpencodeSession ? (
                    <button className="gt-session-item active gt-session-item-draft" onClick={() => opencodeInputRef.current?.focus()}>
                      <span className="gt-session-title">New Session</span>
                      <span className="gt-session-meta">待输入，发送第一条消息后创建</span>
                    </button>
                  ) : null}
                  {!runtimeStatus.opencode.installed ? <div className="gt-empty-hint">安装 `opencode` 后可用会话。</div> : null}
                  {runtimeStatus.opencode.installed && visibleOpencodeSessions.length === 0 ? (
                    <div className="gt-empty-hint gt-tree-empty">当前项目还没有会话。</div>
                  ) : null}
                  {runtimeStatus.opencode.installed
                    ? visibleOpencodeSessions.map((session) => (
                        <button
                          key={`left-session-${session.id}`}
                          className={session.id === activeOpencodeSessionId ? "gt-session-item active" : "gt-session-item"}
                          onClick={() => {
                            setDraftOpencodeSession(false);
                            setActiveOpencodeSessionId(session.id);
                          }}
                        >
                          <span className="gt-session-title">{session.title}</span>
                          <span className="gt-session-meta">
                            {new Date(session.updatedAt).toLocaleDateString([], { month: "2-digit", day: "2-digit" })}
                            {" · "}
                            {new Date(session.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </button>
                      ))
                    : null}
                  {runtimeStatus.opencode.installed && hasMoreOpencodeSessions ? (
                    <button className="gt-load-more-btn" onClick={() => void loadMoreOpencodeSessions()}>
                      加载更多会话
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="gt-sidebar-footer">
        <button className="gt-open-workspace-btn" onClick={() => void pickAndImportRepository()} disabled={busy}>
          <span>⊕</span>
          <span>Open Workspace</span>
        </button>

        <div className="gt-user-row">
          <div className="gt-user-main">
            <span className="gt-user-avatar">{firstLetter(gitUserIdentity.name || gitUserIdentity.email || selectedRepo?.name || "g")}</span>
            <span className="gt-user-meta">
              <strong>{gitUserIdentity.name || "Git User"}</strong>
              <small>{gitUserIdentity.email || "No git email configured"}</small>
            </span>
          </div>
          <button className="gt-user-settings" title="Settings" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </div>
    </div>
  );

  const centerPane = runtimeStatus.opencode.installed ? (
    <div className={`panel opencode-canvas gt-chat-canvas${opencodeMessages.length > 0 ? " has-chat" : ""}`}>
      <div className={opencodeMessages.length === 0 ? "opencode-main gt-chat-main is-empty" : "opencode-main gt-chat-main"}>
        <div className="opencode-thread" ref={opencodeThreadRef} onScroll={onOpencodeThreadScroll}>
          <div className="gt-chat-stream">
            {opencodeHasHiddenHistory ? (
              <button className="opencode-load-more" onClick={loadOlderOpencodeHistory}>
                Load earlier messages
              </button>
            ) : null}
            {opencodeHiddenHistorySpacer > 0 ? (
              <div className="opencode-history-spacer" aria-hidden="true" style={{ height: `${opencodeHiddenHistorySpacer}px` }} />
            ) : null}
            {opencodeMessages.length === 0 ? null : (
              opencodeRenderedMessages.map((msg) => {
                const isAssistant = msg.role === "assistant";
                const isStreaming = isAssistant && msg.id === activeOpencodeStreamingAssistantId && activeOpencodeSessionBusy;
                const serverMid = (opencodeServerMessageIdByLocalId[msg.id] || "").trim();
                const detail = isAssistant ? (opencodeDetailsByMessageId[msg.id] || null) : null;
                const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as OpencodeDetailedPart[]) : [];
                const liveParts = serverMid ? (opencodeLivePartsByServerMessageId[serverMid] || []) : [];
                const detailParts = liveParts.length > 0 ? liveParts : fetchedParts;
                const renderParts = detailParts.filter(isOpencodeRenderablePart);
                const timelineGroups = buildOpencodeAssistantRenderGroups(renderParts);
                const hasTimeline = timelineGroups.length > 0;
                const fallbackReply = (buildOpencodeReplyMarkdownFromParts(detailParts) || msg.content || "").trim();
                return (
                  <div key={msg.id} className={msg.role === "user" ? "opencode-msg opencode-msg-user" : "opencode-msg opencode-msg-assistant"}>
                    {isAssistant && opencodeDetailsLoadingByMessageId[msg.id] && liveParts.length <= 0 ? (
                      <div className="opencode-msg-meta">
                        {opencodeDetailsLoadingByMessageId[msg.id] ? <span className="small muted">加载中…</span> : null}
                      </div>
                    ) : null}
                    {isAssistant ? (
                      hasTimeline ? (
                        <div className="opencode-assistant-timeline">
                          {(() => {
                            const reasoningIndexes = timelineGroups
                              .map((item, groupIdx) => item.kind === "part" && String((item.part as { type?: string }).type || "") === "reasoning" ? groupIdx : -1)
                              .filter((groupIdx) => groupIdx >= 0);
                            const lastReasoningIndex = reasoningIndexes.length > 0 ? reasoningIndexes[reasoningIndexes.length - 1] : -1;
                            return timelineGroups.map((g, idx) => {
                              if (g.kind === "context") {
                                const c = summarizeOpencodeContextToolCounts(g.parts);
                                const progress = summarizeOpencodeContextProgress(g.parts);
                                return (
                                  <div key={`${msg.id}:${g.key}`} className="opencode-exec-context">
                                    <div className="opencode-exec-context-head">
                                      <strong className={isStreaming || progress.active ? "opencode-live-text" : ""}>
                                        {isStreaming || progress.active ? "Gathering Context" : "Context"}
                                      </strong>
                                      <span className="small muted">
                                        {progress.detail
                                          ? `${progress.mode} · ${progress.detail} · ${c.read} read · ${c.search} search · ${c.list} list`
                                          : `${c.read} read · ${c.search} search · ${c.list} list`}
                                      </span>
                                    </div>
                                    <div className="opencode-exec-list">
                                      {g.parts.map((p, pidx) => renderOpencodeExecutionPart(p, `${g.key}:${pidx}`))}
                                    </div>
                                  </div>
                                );
                              }
                              const part = g.part;
                              const t = String((part as { type?: string }).type || "");
                              if (t === "text") {
                                const text = String((part as { text?: string }).text || "").trim();
                                if (!text) return null;
                                return (
                                  <div key={`${msg.id}:${g.key}`} className={isStreaming ? "opencode-msg-body opencode-msg-body-streaming" : "opencode-msg-body"}>
                                    <MarkdownLite source={text} />
                                    {isStreaming && idx === timelineGroups.length - 1 ? <span className="opencode-stream-caret" aria-label="running" /> : null}
                                  </div>
                                );
                              }
                              if (t === "reasoning") {
                                const text = String((part as { text?: string }).text || "").trim();
                                if (!text) return null;
                                const keepOpen = !isStreaming || idx === lastReasoningIndex;
                                return (
                                  <details key={`${msg.id}:${g.key}`} className="opencode-think-card" open={keepOpen}>
                                    <summary className="opencode-think-card-summary">
                                      <span className={isStreaming && keepOpen ? "opencode-live-text" : ""}>Think</span>
                                    </summary>
                                    <div className="opencode-msg-body">
                                      <MarkdownLite source={text} />
                                    </div>
                                  </details>
                                );
                              }
                              return <div key={`${msg.id}:${g.key}`}>{renderOpencodeExecutionPart(part, g.key)}</div>;
                            });
                          })()}
                        </div>
                      ) : fallbackReply ? (
                        <div className={isStreaming ? "opencode-msg-body opencode-msg-body-streaming" : "opencode-msg-body"}>
                          <MarkdownLite source={fallbackReply} />
                          {isStreaming ? <span className="opencode-stream-caret" aria-label="running" /> : null}
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
                      )
                    ) : msg.content.trim() ? (
                      <div className="opencode-msg-body">
                        <MarkdownLite source={msg.content} />
                      </div>
                    ) : null}
                    {isAssistant && opencodeDetailsErrorByMessageId[msg.id] ? (
                      <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{opencodeDetailsErrorByMessageId[msg.id]}</div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="opencode-input-row">
          <div className="gt-chat-composer-wrap">
          <div className="opencode-composer">
            <div className="opencode-composer-body opencode-composer-body-inline">
              <div className="opencode-input-shell opencode-composer-editor">
                <textarea
                  ref={opencodeInputRef}
                  className="opencode-input"
                  placeholder="Ask OpenCode to code, inspect, or fix..."
                  value={opencodePromptInput}
                  onChange={(e) => setOpencodePromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (activeOpencodeSessionBusy) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void runOpencodePrompt();
                    }
                  }}
                  rows={1}
                />
              </div>
              <div className="opencode-model-picker-wrap opencode-model-inline" ref={opencodeModelPickerRef}>
                <button
                  type="button"
                  className="chip opencode-model-trigger opencode-composer-model"
                  onClick={() => {
                    const next = !showOpencodeModelPicker;
                    if (next) {
                      setOpencodeConfiguredProviders([]);
                      setOpencodeConfiguredModelsByProvider({});
                      setOpencodeConfiguredModelNamesByProvider({});
                      void refreshOpencodeServerConfig({ syncSelection: false, includeCurrentModel: false });
                    }
                    setShowOpencodeModelPicker(next);
                  }}
                >
                  {(() => {
                    if (!activeOpencodeModel) return "Auto";
                    const parsed = parseModelRef(activeOpencodeModel);
                    const provider = resolveProviderAliasWithNames(parsed?.provider || "", opencodeModelsByProvider, opencodeProviderNames) || (parsed?.provider || "");
                    const mid = parsed?.model || "";
                    const name = (provider ? (opencodeModelNamesByProvider[provider]?.[mid] || opencodeConfiguredModelNamesByProvider[provider]?.[mid]) : "") || "";
                    return name || activeOpencodeModel || "Auto";
                  })()}
                  <span className="opencode-model-caret">▾</span>
                </button>
                {showOpencodeModelPicker ? (
                  <div className="opencode-model-picker">
                    <div className="opencode-model-picker-head">
                      <input className="path-input opencode-model-search" placeholder="搜索已配置模型..." value={opencodeModelPickerSearch} onChange={(e) => setOpencodeModelPickerSearch(e.target.value)} />
                      <button type="button" className="chip opencode-picker-config-btn" title="自定义提供商" onClick={() => {
                        setShowOpencodeCustomProvider(true);
                        setShowOpencodeModelPicker(false);
                      }}>
                        ＋
                      </button>
                      <button type="button" className="chip opencode-picker-config-btn" title="选择/连接提供商" onClick={() => {
                        setShowOpencodeProviderPicker(true);
                        setOpencodeProviderPickerSearch("");
                        setOpencodeProviderPickerProvider(opencodeModelProvider);
                        setOpencodeProviderPickerModelSearch("");
                        setShowOpencodeModelPicker(false);
                      }}>
                        ⚙
                      </button>
                    </div>
                    <div className="opencode-model-list-col">
                      {opencodeConfiguredModelCandidates.length === 0 ? (
                        <div className="small muted">暂无已配置模型。点击“＋”添加自定义提供商，或点“⚙”连接厂商。</div>
                      ) : (
                        opencodeConfiguredModelCandidates.map((m) => (
                          <button type="button" key={`saved-model-${m}`} className={m === activeOpencodeModel ? "file-item selected" : "file-item"} onClick={() => {
                            void applyOpencodeModel(m);
                            setShowOpencodeModelPicker(false);
                          }} title={m}>
                            {(() => {
                              const parsed = parseModelRef(m);
                              const provider = resolveProviderAliasWithNames(parsed?.provider || "", opencodeModelsByProvider, opencodeProviderNames) || (parsed?.provider || "");
                              const mid = parsed?.model || "";
                              const name = (provider ? (opencodeConfiguredModelNamesByProvider[provider]?.[mid] || opencodeModelNamesByProvider[provider]?.[mid]) : "") || "";
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
              <button
                className={activeOpencodeSessionBusy ? "chip opencode-run-btn opencode-composer-send opencode-stop-btn" : "chip opencode-run-btn opencode-composer-send"}
                disabled={!activeOpencodeSessionBusy && !opencodePromptInput.trim()}
                onClick={() => (activeOpencodeSessionBusy ? void stopOpencodePrompt() : void runOpencodePrompt())}
                aria-label={activeOpencodeSessionBusy ? "停止" : "发送"}
              >
                <SendIcon busy={activeOpencodeSessionBusy} />
              </button>
            </div>
          </div>
          </div>
        </div>
        </div>
        {showOpencodeDebugLog ? (
          <div className="opencode-debug-panel">
            <div className="opencode-debug-head">
              <strong>OpenCode Debug Log</strong>
              <button className="chip" onClick={() => setOpencodeDebugLogs([])}>Clear</button>
            </div>
            <pre className="opencode-debug-log">{opencodeDebugLogs.length === 0 ? "No logs yet." : opencodeDebugLogs.join("\n")}</pre>
          </div>
        ) : null}
      </div>
  ) : (
    <div className="panel opencode-panel opencode-empty-panel gt-chat-disabled">
      <div className="opencode-hero">
        <div className="opencode-hero-title">OpenCode Agent</div>
        <p className="small muted">Install `opencode` from Plugins to enable the coding area.</p>
      </div>
    </div>
  );

  const rightPane = (
    <div className="gt-right-pane" ref={opencodeRightPaneRef}>
      <div className="gt-right-panel">
        {rightPaneTab === "worktree" ? (
          <div className="gt-panel-stack">
            <div className="gt-right-card">
              <div className="gt-right-card-head">
                <strong>Current Worktree</strong>
                <button className="chip" onClick={() => void refreshWorktreeData(selectedWorktreeFile)} disabled={busy}>Refresh</button>
              </div>
              <div className="gt-stat-grid">
                <div className="gt-stat-item"><span>Branch</span><strong>{worktreeOverview.branch || selectedBranch || "-"}</strong></div>
                <div className="gt-stat-item"><span>Tracking</span><strong>{worktreeOverview.tracking || "-"}</strong></div>
                <div className="gt-stat-item"><span>Ahead / Behind</span><strong>{worktreeOverview.ahead} / {worktreeOverview.behind}</strong></div>
                <div className="gt-stat-item"><span>Status</span><strong>{worktreeOverview.clean ? "Clean" : "Dirty"}</strong></div>
              </div>
              <div className="status-pill-row">
                <span className="status-pill">staged {worktreeOverview.stagedCount}</span>
                <span className="status-pill">unstaged {worktreeOverview.unstagedCount}</span>
                <span className="status-pill">untracked {worktreeOverview.untrackedCount}</span>
              </div>
              <pre className="gt-right-pre">{worktreeOverview.raw || "git status -sb"}</pre>
            </div>

            <div className="gt-right-card">
              <div className="gt-right-card-head">
                <strong>Branches</strong>
                <button className="chip" onClick={() => void refreshBranchesAndCommits()} disabled={busy}>Refresh</button>
              </div>
              <div className="gt-branch-mini-list">
                {branches.map((branch) => (
                  <button key={branch.name} className={selectedBranch === branch.name ? "gt-branch-mini active" : "gt-branch-mini"} onClick={() => void chooseBranch(branch.name)}>
                    <span className={branch.isCurrent ? "gt-branch-mini-dot current" : "gt-branch-mini-dot"} />
                    <span>{branch.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="gt-right-card gt-right-card-fill">
              <div className="gt-right-card-head">
                <strong>Recent Graph</strong>
                <button className="chip" onClick={() => setShowGraphPopover(true)}>Open Graph</button>
              </div>
              <div className="gt-commit-mini-list">
                {commits.slice(0, 12).map((commit) => (
                  <button key={commit.sha} className={selectedCommit === commit.sha ? "gt-commit-mini active" : "gt-commit-mini"} onClick={() => setSelectedCommit(commit.sha)}>
                    <strong>{commit.subject}</strong>
                    <span>{commit.sha.slice(0, 8)} · {commit.author}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {rightPaneTab === "changes" ? (
          <div className="gt-panel-stack gt-panel-stack-split">
            <div className="gt-right-card gt-right-card-files">
              <div className="gt-right-card-head">
                <strong>待提交文件</strong>
                <button className="chip" onClick={() => void refreshWorktreeData(selectedWorktreeFile)} disabled={busy}>Refresh</button>
              </div>
              <div className="gt-worktree-file-list">
                {worktreeOverview.entries.length === 0 ? <div className="gt-empty-hint">当前 worktree 没有待提交文件。</div> : null}
                {worktreeOverview.entries.map((entry) => (
                  <button key={entry.path} className={selectedWorktreeFile === entry.path ? "gt-worktree-file active" : "gt-worktree-file"} onClick={() => void refreshSelectedWorktreePatch(entry.path)}>
                    <span className="gt-worktree-file-top">
                      <strong>{entry.path}</strong>
                      <span className="small muted">{entry.indexStatus}{entry.worktreeStatus}</span>
                    </span>
                    <span className="gt-worktree-file-tags">
                      {entry.staged ? <span className="meta-chip">staged</span> : null}
                      {entry.unstaged ? <span className="meta-chip">unstaged</span> : null}
                      {entry.untracked ? <span className="meta-chip">untracked</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="gt-right-card gt-right-card-fill">
              <div className="gt-right-card-head">
                <strong>修改记录</strong>
                <span className="small muted">{selectedWorktreeFile || "选择一个文件"}</span>
              </div>
              <pre className="gt-right-pre gt-right-pre-fill">{selectedWorktreePatch || "选择左侧文件后查看 patch。"}</pre>
            </div>
          </div>
        ) : null}

        {rightPaneTab === "terminal" ? (
          <div className="gt-panel-stack gt-panel-stack-terminal">
            <div className="gt-right-card">
              <div className="gt-right-card-head">
                <strong>Terminal</strong>
                <div className="toolbar">
                  <button className="chip" onClick={() => setTerminalEntries([])}>Clear</button>
                  <button className="chip" onClick={() => void runTerminalCommand()} disabled={terminalBusy || !selectedRepo}>Run</button>
                </div>
              </div>
              <div className="gt-terminal-toolbar">
                <button className="chip" onClick={() => { setTerminalInput("git status -sb"); void runTerminalCommand("git status -sb"); }} disabled={terminalBusy || !selectedRepo}>git status</button>
                <button className="chip" onClick={() => { setTerminalInput("git branch --show-current"); void runTerminalCommand("git branch --show-current"); }} disabled={terminalBusy || !selectedRepo}>current branch</button>
                <button className="chip" onClick={() => { setTerminalInput("git worktree list"); void runTerminalCommand("git worktree list"); }} disabled={terminalBusy || !selectedRepo}>worktrees</button>
              </div>
              <div className="gt-terminal-input-row">
                <input className="path-input" value={terminalInput} onChange={(e) => setTerminalInput(e.target.value)} onKeyDown={(e) => {
                  if (e.key === "Enter") void runTerminalCommand();
                }} placeholder="输入命令，例如 git status -sb" />
              </div>
            </div>
            <div className="gt-terminal-log">
              {terminalEntries.length === 0 ? <div className="gt-empty-hint">运行命令后，这里会显示输出。</div> : null}
              {terminalEntries.map((entry) => (
                <div key={entry.id} className={entry.ok ? "gt-terminal-entry" : "gt-terminal-entry error"}>
                  <div className="gt-terminal-entry-head">
                    <strong>$ {entry.command}</strong>
                    <span className="small muted">{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  </div>
                  <pre className="gt-right-pre">{entry.output}</pre>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  const centerColClass =
    !leftDrawerOpen && !rightDrawerOpen
      ? "wb-col wb-col-center gt-center-pane gt-center-pane-wide"
      : !rightDrawerOpen
        ? "wb-col wb-col-center gt-center-pane gt-center-pane-right-closed"
        : !leftDrawerOpen
          ? "wb-col wb-col-center gt-center-pane gt-center-pane-left-closed"
          : "wb-col wb-col-center gt-center-pane";

  const editorRailClass = rightDrawerOpen ? "wb-editor-rail is-right-open" : "wb-editor-rail is-right-closed";

  const editor = (
    <div className="wb-editor-inner gt-editor-shell">
      <button className="gt-shell-toggle gt-shell-toggle-left" title={leftDrawerOpen ? "收起左侧栏" : "展开左侧栏"} onClick={() => setLeftDrawerOpen((v) => !v)}>
        <PanelToggleIcon side="left" collapsed={!leftDrawerOpen} />
      </button>
      <button className="gt-shell-toggle gt-shell-toggle-right" title={rightDrawerOpen ? "收起右侧栏" : "展开右侧栏"} onClick={() => setRightDrawerOpen((v) => !v)}>
        <PanelToggleIcon side="right" collapsed={!rightDrawerOpen} />
      </button>
      <div
        className={editorRailClass}
        style={{
          "--wb-right-width": `${rightPaneWidth}px`,
          "--wb-right-current-width": rightDrawerOpen ? `${rightPaneWidth}px` : "0px",
          "--wb-right-split-width": rightDrawerOpen ? "1px" : "0px"
        } as CSSProperties}
      >
        <div className="wb-editor-rail__head-center wb-editor-header gt-editor-header" data-tauri-drag-region>
          <div className="wb-breadcrumbs">
            <strong>{activeOpencodeSession?.title || (draftOpencodeSession ? "New Session" : "会话摘要")}</strong>
          </div>
        </div>
        <div
          className={draggingSplit?.kind === "right" ? "wb-editor-rail__split active" : "wb-editor-rail__split"}
          role="separator"
          aria-orientation="vertical"
          aria-hidden={!rightDrawerOpen}
          onMouseDown={rightDrawerOpen ? (e) => beginSplitDrag("right", e.clientX) : undefined}
        />
        <div className="wb-editor-rail__head-right" data-tauri-drag-region aria-hidden={!rightDrawerOpen}>
          <div className="toolbar gt-titlebar-tools gt-titlebar-tools--rail">
            <div className="gt-right-tabs gt-right-tabs-titlebar" data-tauri-drag-region>
              <button className={rightPaneTab === "worktree" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => setRightPaneTab("worktree")} title="Worktree" aria-label="Worktree">
                <RightPaneTabIcon tab="worktree" active={rightPaneTab === "worktree"} />
              </button>
              <button className={rightPaneTab === "changes" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => setRightPaneTab("changes")} title="Changes" aria-label="Changes">
                <RightPaneTabIcon tab="changes" active={rightPaneTab === "changes"} />
              </button>
              <button className={rightPaneTab === "terminal" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => setRightPaneTab("terminal")} title="Terminal" aria-label="Terminal">
                <RightPaneTabIcon tab="terminal" active={rightPaneTab === "terminal"} />
              </button>
            </div>
          </div>
        </div>
        <div className="wb-editor-rail__body-center wb-editor-content gt-editor-rail-center">
          <div className={centerColClass}>{centerPane}</div>
        </div>
        <div className="wb-editor-rail__body-right wb-col wb-col-right" aria-hidden={!rightDrawerOpen}>{rightPane}</div>
      </div>
    </div>
  );

  const controlBaseUrl = (() => {
    const custom = String(controlServerSettings.publicBaseUrl || "").trim();
    if (custom) return custom;
    const urls = controlAccessInfo?.localUrls || [];
    const lan = urls.find((u) => {
      const s = String(u || "").toLowerCase();
      return s && !s.includes("127.0.0.1") && !s.includes("localhost");
    });
    return (lan || urls[0] || "").trim();
  })();
  const controlPairCode = (controlAccessInfo?.pairCode || controlPairCodeInfo?.code || "").trim();
  const controlAuthNoAuth =
    Boolean(controlAccessInfo?.noAuth) ||
    normalizeControlPairMode(controlAccessInfo?.pairCodeTtlMode || controlServerSettings.pairCodeTtlMode) === "none";
  const controlPairPayload = controlBaseUrl
    ? JSON.stringify({
        baseUrl: controlBaseUrl,
        authMode: controlAuthNoAuth ? "none" : "pair_code",
        ...(controlAuthNoAuth ? {} : { pairCode: controlPairCode })
      })
    : "";
  const controlPairQrUrl = controlPairPayload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(controlPairPayload)}`
    : "";
  const controlServiceEnabled = controlServerSettings.enabled;
  const mobileStatus = mobileServiceStatus;
  const mobileDot = (() => {
    if (!runtimeStatus.giteam.installed) return { color: "var(--muted)", label: "Mobile service: plugin not installed" };
    if (!mobileStatus) return { color: "var(--muted)", label: "Mobile service: unknown" };
    if (!mobileStatus.enabled) return { color: "var(--muted)", label: "Mobile service: off" };
    if (mobileStatus.running) return { color: "var(--success)", label: "Mobile service: running" };
    if (mobileServiceStatusError) return { color: "var(--danger)", label: `Mobile service: error (${mobileServiceStatusError})` };
    return { color: "color-mix(in srgb, var(--accent) 30%, orange)", label: "Mobile service: starting" };
  })();

  const panel = <div className="wb-panel-inner" />;

  return (
    <AppErrorBoundary>
      <>
      <Workbench
        activityBar={activityBar}
        sideBar={sideBar}
        editor={editor}
        panel={panel}
        sidebarWidth={sidebarWidth}
        sidebarCollapsed={!leftDrawerOpen}
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
            <div className="wb-status-group">
              <button
                className="wb-status-btn"
                title={mobileDot.label}
                onClick={() => {
                  if (!runtimeStatus.giteam.installed) {
                    setShowSettings(true);
                    setShowEnvSetup(true);
                    return;
                  }
                  setShowMobileControlDialog(true);
                }}
              >
                <span className="gt-status-dot" style={{ background: mobileDot.color }} aria-hidden="true" />
                <span className="gt-status-text">Mobile</span>
              </button>
            </div>
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
            <div className="toolbar" style={{ justifyContent: "center" }}>
              <button
                className="chip"
                onClick={() => {
                  setOverlayBusy(false);
                  setBusy(false);
                  setMessage("");
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mobileStatusChangeToast.visible ? (
        <div className="mobile-status-toast" role="status" aria-live="polite">
          <span className={`mobile-status-toast-icon ${mobileStatusChangeToast.message === "Disconnected" ? "disconnected" : "connected"}`}>
            {mobileStatusChangeToast.message === "Disconnected" ? "✕" : "✓"}
          </span>
          <span className="mobile-status-toast-msg">{mobileStatusChangeToast.message}</span>
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
        <div className="modal-mask" onClick={() => void closeSettingsModal()}>
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
                <div className="settings-label">Plugins</div>
                <div className="toolbar">
                  <button
                    className="chip"
                    onClick={() => {
                      setShowEnvSetup(true);
                      const unchecked = [runtimeStatus.git, runtimeStatus.entire, runtimeStatus.opencode, runtimeStatus.giteam].some(
                        (d) => !d.checked
                      );
                      if (unchecked) void refreshRuntimeRequirements();
                    }}
                  >
                    Manage plugins
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-label">Mobile Control API</div>
                <div className="settings-config-btn-wrap">
                  <button
                    className="chip"
                    disabled={!runtimeStatus.giteam.installed}
                    title={runtimeStatus.giteam.installed ? "Configure Mobile Control API" : "Install giteam plugin first"}
                    onClick={openMobileControlDialog}
                  >
                    Configure
                  </button>
                </div>
              </div>
              {runtimeStatus.giteam.installed ? null : (
                <div className="settings-row">
                  <div className="settings-label">Mobile Control API</div>
                  <div className="small muted">Install giteam plugin first. This feature is provided by giteam CLI.</div>
                </div>
              )}

              {runtimeStatus.opencode.installed ? (
                <div className="settings-row">
                  <div className="settings-label">OpenCode API</div>
                  <div className="settings-config-btn-wrap">
                    <button className="chip" onClick={() => setShowOpencodeApiDialog(true)}>
                      Configure
                    </button>
                  </div>
                </div>
              ) : null}

              {runtimeStatus.opencode.installed ? (
                <>
                  <div className="settings-row">
                    <div className="settings-label">Model management</div>
                    <div className="toolbar">
                      <button
                        className="chip"
                        onClick={() => {
                          setOpencodeProviderPickerProvider(
                            parseModelRef(activeOpencodeModel || "")?.provider || opencodeModelProvider || ""
                          );
                          setShowOpencodeProviderPicker(true);
                        }}
                      >
                        Open manager
                      </button>
                    </div>
                  </div>
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
              <button className="chip" onClick={() => void closeSettingsModal()}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showMobileControlDialog && runtimeStatus.giteam.installed ? (
        <div className="modal-mask" onClick={() => void closeMobileControlDialog()}>
          <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860 }}>
            <div className="env-setup-head">
              <h3>Mobile Control API</h3>
              <div className="mobile-control-head-right">
                <span className="small muted">Service</span>
                <button
                  type="button"
                  className={controlServerSettings.enabled ? "gt-switch on" : "gt-switch"}
                  disabled={controlServerSettingsBusy}
                  onClick={() => void toggleControlServiceEnabled(!controlServerSettings.enabled)}
                  title={controlServerSettings.enabled ? "Disable service" : "Enable service"}
                >
                  <span className="gt-switch-thumb" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="settings-provider-form settings-mobile-control">
              <div className="mobile-control-section-title">Connection</div>
              <div className="mobile-control-config">
                <div className="mobile-control-field">
                  <div className="small muted">Port</div>
                  <input
                    className="path-input"
                    type="number"
                    min={1}
                    max={65535}
                    disabled={!controlServiceEnabled}
                    placeholder="Port"
                    value={String(controlServerSettings.port)}
                    onChange={(e) =>
                      setControlServerSettings((prev) => ({
                        ...prev,
                        port: Number(e.target.value || "0")
                      }))
                    }
                  />
                </div>
                <div className="mobile-control-field">
                  <div className="small muted">Public URL (optional)</div>
                  <input
                    className="path-input"
                    disabled={!controlServiceEnabled}
                    placeholder="Public URL（默认自动取局域网 IPv4）"
                    value={controlServerSettings.publicBaseUrl}
                    onChange={(e) =>
                      setControlServerSettings((prev) => ({
                        ...prev,
                        publicBaseUrl: e.target.value
                      }))
                    }
                  />
                </div>
              </div>
              <div className="mobile-control-section-title">Authentication</div>
              <div className="mobile-control-auth-row">
                <div className="mobile-control-field">
                  <div className="small muted">Pair Code Validity</div>
                  <select
                    className="path-input"
                    disabled={!controlServiceEnabled}
                    value={controlServerSettings.pairCodeTtlMode}
                    onChange={(e) =>
                      setControlServerSettings((prev) => ({
                        ...prev,
                        pairCodeTtlMode: normalizeControlPairMode(e.target.value)
                      }))
                    }
                  >
                    <option value="none">No Auth (no pair code)</option>
                    <option value="24h">Pair code valid for 24 hours</option>
                    <option value="7d">Pair code valid for 7 days</option>
                    <option value="forever">Pair code valid indefinitely</option>
                  </select>
                </div>
                <div className="mobile-control-field">
                  <div className="small muted">Actions</div>
                  <div className="toolbar" style={{ justifyContent: "flex-start", minHeight: 36 }}>
                    <button
                      className="chip"
                      disabled={!controlServiceEnabled || controlServerSettingsBusy}
                      onClick={() => {
                        void forceRefreshControlPairCode();
                        void loadControlAccessInfo();
                      }}
                    >
                      Refresh code
                    </button>
                  </div>
                </div>
              </div>
              <div className="toolbar mobile-control-status">
                <span className="small muted">
                  {!controlServiceEnabled
                    ? "Service is disabled"
                    : controlAuthNoAuth
                      ? "Current mode: No Auth"
                      : `Pair code: ${controlPairCode || "------"}`}
                </span>
              </div>
              <div className="mobile-control-divider" />
              <div className="mobile-control-section-title">QR Connection</div>
              <div className="mobile-qr-card">
                <div className="mobile-qr-visual">
                  {controlServiceEnabled && controlPairQrUrl ? (
                    <img src={controlPairQrUrl} alt="Mobile pair QR code" />
                  ) : (
                    <div className="small muted">{controlServiceEnabled ? "QR unavailable" : "Service disabled"}</div>
                  )}
                </div>
                <div className="mobile-qr-meta">
                  <div className="small muted">
                    {!controlServiceEnabled
                      ? "Enable the service to generate a QR code for mobile pairing."
                      : controlAuthNoAuth
                      ? "Scan to connect directly (No Auth mode)"
                      : "Scan, then connect on mobile with pair code (manual or auto-filled)"}
                  </div>
                  <div className="mobile-qr-code">{!controlServiceEnabled ? "Disabled" : controlAuthNoAuth ? "No Auth" : controlPairCode || "------"}</div>
                  <div className="mobile-qr-url">{controlServiceEnabled ? controlBaseUrl || "Waiting for local address..." : "Service disabled"}</div>
                  <div className="toolbar">
                    <button
                      className="chip"
                      disabled={!controlServiceEnabled || !controlBaseUrl}
                      onClick={() => {
                        void navigator.clipboard.writeText(controlBaseUrl);
                        setMessage("Control server URL copied");
                      }}
                    >
                      Copy URL
                    </button>
                  </div>
                </div>
              </div>
              {controlServerSettingsBusy ? <span className="small muted">Saving control server settings...</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      {showOpencodeApiDialog ? (
        <div className="modal-mask" onClick={() => void closeOpencodeApiDialog()}>
          <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="env-setup-head">
              <h3>OpenCode API</h3>
            </div>
            <div className="settings-provider-form">
              <div className="mobile-control-field">
                <div className="small muted">Service port</div>
                <input
                  className="path-input"
                  type="number"
                  min={1}
                  max={65535}
                  placeholder="Service port"
                  value={String(opencodeServiceSettings.port)}
                  onChange={(e) => {
                    const next = Number(e.target.value || "0");
                    setOpencodeServiceSettings((prev) => ({
                      ...prev,
                      port: next
                    }));
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showOpencodeProviderPicker ? (
        <div className="modal-mask" onClick={() => setShowOpencodeProviderPicker(false)}>
          <div className="modal-card settings-card opencode-provider-picker-card" onClick={(e) => e.stopPropagation()}>
            <div className="env-setup-head">
              <div className="opencode-provider-picker-title">
                <h3>Provider & Model Manager</h3>
              </div>
              <div className="toolbar">
                {opencodeCatalogLoading ? (
                  <span className="opencode-inline-loading" aria-live="polite">
                    <span />
                    读取中
                  </span>
                ) : null}
                <button className="chip" onClick={() => setShowOpencodeProviderPicker(false)}>Close</button>
              </div>
            </div>
            <div className="settings-model-head opencode-provider-picker-toolbar">
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
                title="新增自定义提供商"
                aria-label="新增自定义提供商"
                onClick={() => {
                  setShowOpencodeProviderPicker(false);
                  setShowOpencodeCustomProvider(true);
                }}
              >
                ＋
              </button>
              <button className="chip" disabled={opencodeCatalogLoading} onClick={() => void refreshOpencodeCatalog()}>
                {opencodeCatalogLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="settings-model-lists opencode-provider-picker-grid">
              <div className="settings-model-col" style={{ maxHeight: 420 }}>
                {opencodeProviderPickerCandidates.length === 0 ? (
                  <div className="small muted" style={{ padding: 12 }}>暂无可用供应商目录。请检查 OpenCode `/provider` 是否可访问。</div>
                ) : null}
                {opencodeProviderPickerCandidates.map((provider, idx) => {
                  const connected = opencodeConnectedProviders.includes(provider);
                  const tag = getOpencodeProviderTag(provider);
                  const prev = idx > 0 ? opencodeProviderPickerCandidates[idx - 1] : "";
                  const prevConnected = prev ? opencodeConnectedProviders.includes(prev) : connected;
                  const shouldSplit = idx > 0 && prevConnected && !connected;
                  const modelCount = (opencodeModelsByProvider[provider] || []).length;
                  return (
                    <Fragment key={`provider-pick-wrap-${provider}`}>
                      {shouldSplit ? (
                        <div className="opencode-provider-divider small muted">
                          未连接
                        </div>
                      ) : null}
                      <button
                        key={`provider-pick-${provider}`}
                        className={opencodeProviderPickerProvider === provider ? "file-item selected opencode-provider-row" : "file-item opencode-provider-row"}
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
                          setShowOpencodeAuthDialogFor("");
                        }}
                        title={connected ? "已连接" : "未连接（需要在 OpenCode 中连接或配置）"}
                      >
                        <span className="opencode-provider-row-main">
                          {opencodeProviderNames[provider] || PROVIDER_PRESETS.find((p) => p.id === provider)?.name || provider}
                          <small>{`${provider} · ${tag}`}</small>
                        </span>
                        <span className="opencode-provider-row-side">
                          <small className="small muted">{modelCount} models</small>
                          <span className={connected ? "opencode-provider-state connected" : "opencode-provider-state"}>
                            {connected ? "已连接" : "未连接"}
                          </span>
                        </span>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
              <div className="settings-model-col" style={{ maxHeight: 420 }}>
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
                  // Prefer explicitly configured models for this provider.
                  // This avoids selecting inherited/default catalog models that the user
                  // did not configure for custom OpenAI-compatible endpoints.
                  const configuredPool = cfgPid ? (opencodeConfiguredModelsByProvider[cfgPid] ?? []) : [];
                  const pool = configuredPool.length > 0 ? configuredPool : (pid ? (opencodeModelsByProvider[pid] ?? []) : []);
                  const q = opencodeProviderPickerModelSearch.trim().toLowerCase();
                  const filtered = q ? pool.filter((m) => m.toLowerCase().includes(q)) : pool;
                  if (!opencodeProviderPickerProvider) {
                    return <div className="small muted opencode-provider-empty">先从左侧选择一个提供商。</div>;
                  }
                  const pretty = opencodeProviderNames[pid] || PROVIDER_PRESETS.find((p) => p.id === pid)?.name || pid;
                  const tag = getOpencodeProviderTag(pid);
                  const keyValue = opencodeConnectProviderId === pid ? opencodeConnectApiKey : "";
                  const showAuthEditor = !connected;
                  const menuOpen = opencodeProviderActionMenuFor === pid;
                  const openAuthEditor = () => {
                    setOpencodeConnectProviderId(pid);
                    setOpencodeConnectProviderName(pretty);
                    setOpencodeConnectApiKey("");
                    setShowOpencodeAuthDialogFor(pid);
                    setOpencodeProviderActionMenuFor("");
                  };
                  const authHint = connected
                    ? `${pretty} 已连接。若 API Key 已变更，可在此更新（写入 OpenCode auth.json）。`
                    : `${pretty} 未连接。请先输入 API Key 连接（写入 OpenCode auth.json），再选择模型。`;
                  const authBlock = showAuthEditor ? (
                    <div className="opencode-provider-connect">
                      <div className="small muted" style={{ marginBottom: 8 }}>{authHint}</div>
                      <input
                        className="path-input"
                        placeholder={connected ? "输入新的 API 密钥" : "API 密钥"}
                        value={keyValue}
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
                              setMessage(connected ? `已更新密钥: ${authPid}` : `已连接: ${authPid}`);
                              setOpencodeConnectApiKey("");
                            } catch (e) {
                              setError(String(e));
                              setMessage(connected ? "更新密钥失败" : "连接失败");
                            } finally {
                              setOpencodeConnectBusy(false);
                            }
                          }}
                        >
                          {opencodeConnectBusy ? "Saving..." : (connected ? "更新密钥" : "连接")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="opencode-provider-connect-compact">
                      <div className="small muted">
                        {`${pretty}（${tag}）已连接。`}
                      </div>
                      <span className="small muted">通过右上角菜单操作</span>
                    </div>
                  );
                  const providerHeader = (
                    <div className="opencode-provider-panel-head">
                      <div className="opencode-provider-panel-title">
                        <strong>{pretty}</strong>
                        <small className="small muted">{`${pid} · ${tag}`}</small>
                      </div>
                      <div className="opencode-provider-panel-actions">
                        <button
                          type="button"
                          className="chip opencode-provider-menu-trigger"
                          title="更多操作"
                          onClick={() => setOpencodeProviderActionMenuFor((prev) => (prev === pid ? "" : pid))}
                        >
                          ...
                        </button>
                        {menuOpen ? (
                          <div className="opencode-provider-menu">
                            <button
                              type="button"
                              className="opencode-provider-menu-item"
                              onClick={openAuthEditor}
                            >
                              更新 API Key
                            </button>
                            {getOpencodeProviderSource(pid) !== "env" ? (
                              <button
                                type="button"
                                className="opencode-provider-menu-item danger"
                                disabled={opencodeDisconnectingProvider === pid}
                                onClick={async () => {
                                  setOpencodeProviderActionMenuFor("");
                                  await disconnectOpencodeProvider(pid);
                                }}
                              >
                                {opencodeDisconnectingProvider === pid ? "处理中..." : "断开连接"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                  if (!connected) {
                    return (
                      <div className="opencode-provider-right-panel">
                        {providerHeader}
                        {authBlock}
                      </div>
                    );
                  }
                  if (filtered.length === 0) {
                    return (
                      <div className="opencode-provider-right-panel">
                        {providerHeader}
                        {authBlock}
                        <div className="small muted opencode-provider-empty">没有可用模型（或搜索无结果）。</div>
                      </div>
                    );
                  }
                  return (
                    <div className="opencode-provider-right-panel">
                      {providerHeader}
                      {authBlock}
                      {filtered.map((mid) => {
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
                          normalizeModelRef(activeOpencodeModel) === refNorm ? "file-item selected opencode-provider-model-row" : "file-item opencode-provider-model-row"
                        }
                      >
                        <button
                          className="opencode-provider-model-main"
                          onClick={() => {
                            if (!refNorm) return;
                            void applyOpencodeModel(refNorm);
                          }}
                          title={refNorm || ref}
                        >
                          <span>{modelDisplay}</span>
                          {modelDisplay !== mid ? <small>{mid}</small> : null}
                        </button>
                        <button
                          type="button"
                          className={enabled ? "opencode-switch is-on" : "opencode-switch"}
                          aria-pressed={enabled}
                          aria-label={enabled ? "隐藏模型" : "启用模型"}
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
                          />
                        </div>
                      );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showOpencodeAuthDialogFor ? (
        <div className="modal-mask" onClick={() => setShowOpencodeAuthDialogFor("")}>
          <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            {(() => {
              const pid = showOpencodeAuthDialogFor.trim();
              const pretty = opencodeProviderNames[pid] || PROVIDER_PRESETS.find((p) => p.id === pid)?.name || pid;
              const tag = getOpencodeProviderTag(pid);
              const keyValue = opencodeConnectProviderId === pid ? opencodeConnectApiKey : "";
              return (
                <>
                  <div className="env-setup-head">
                    <h3>{`更新 API Key · ${pretty}`}</h3>
                    <button className="chip" onClick={() => setShowOpencodeAuthDialogFor("")}>Close</button>
                  </div>
                  <p className="small muted">{`${tag} provider`}</p>
                  <div className="settings-provider-form" style={{ marginTop: 8 }}>
                    <input
                      className="path-input"
                      placeholder="输入新的 API 密钥"
                      value={keyValue}
                      onChange={(e) => {
                        setOpencodeConnectProviderId(pid);
                        setOpencodeConnectProviderName(pretty);
                        setOpencodeConnectApiKey(e.target.value);
                      }}
                    />
                  </div>
                  <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 10 }}>
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
                          setMessage(`已更新密钥: ${authPid}`);
                          setOpencodeConnectApiKey("");
                          setShowOpencodeAuthDialogFor("");
                        } catch (e) {
                          setError(String(e));
                          setMessage("更新密钥失败");
                        } finally {
                          setOpencodeConnectBusy(false);
                        }
                      }}
                    >
                      {opencodeConnectBusy ? "Saving..." : "更新 API Key"}
                    </button>
                  </div>
                </>
              );
            })()}
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
                      // 2) PATCH /config (or /global/config) with provider config (baseURL/models/headers),
                      //    and only re-enable current provider from disabled_providers.
                      const key = opencodeProviderConfig.apiKey?.trim() || "";
                      await invoke<OpencodeProviderConfig>("set_opencode_provider_config", {
                        repoPath,
                        provider: pid,
                        npm: opencodeProviderConfig.npm || "@ai-sdk/openai-compatible",
                        name: opencodeProviderConfig.name || pid,
                        baseUrl: opencodeProviderConfig.baseUrl,
                        apiKey: key,
                        headers: opencodeProviderConfig.headers || {},
                        endpoint: opencodeProviderConfig.endpoint || "",
                        region: opencodeProviderConfig.region || "",
                        profile: opencodeProviderConfig.profile || "",
                        project: opencodeProviderConfig.project || "",
                        location: opencodeProviderConfig.location || "",
                        resourceName: opencodeProviderConfig.resourceName || "",
                        enterpriseUrl: opencodeProviderConfig.enterpriseUrl || "",
                        timeout: opencodeProviderConfig.timeout || "",
                        chunkTimeout: opencodeProviderConfig.chunkTimeout || "",
                        modelId: mid,
                        modelName: mid
                      });
                      await invoke<OpencodeServerConfig>("set_opencode_server_current_model", { repoPath, model: full });
                      const effective = await invoke<OpencodeServerConfig>("get_opencode_server_config", { repoPath });
                      const hasProvider = Boolean(effective?.provider && effective.provider[pid]);
                      const hasModel = Boolean(effective?.provider?.[pid]?.models && effective.provider[pid].models[mid]);
                      if (!hasProvider || !hasModel) {
                        appendOpencodeDebugLog(
                          `custom.save.verify failed pid=${pid} mid=${mid} hasProvider=${String(hasProvider)} hasModel=${String(hasModel)}`
                        );
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
            <p className="small muted">Manage git, Entire CLI, OpenCode plugin, and giteam runtime.</p>

            <div className="env-check-list">
              {[runtimeStatus.git, runtimeStatus.entire, runtimeStatus.opencode, runtimeStatus.giteam]
                .filter((d): d is RuntimeDependencyStatus => Boolean(d))
                .map((dep) => (
                  <div className="env-check-row" key={dep.name}>
                    <div>
                      <strong>{dep.name}</strong>{" "}
                      <span
                        className={
                          checkingDeps[dep.name as "git" | "entire" | "opencode" | "giteam"] ? "muted" : dep.installed ? "env-ok" : "env-missing"
                        }
                      >
                        {checkingDeps[dep.name as "git" | "entire" | "opencode" | "giteam"]
                          ? "Checking..."
                          : (dep.checked ? (dep.installed ? "Installed" : "Missing") : "Unknown")}
                      </span>
                      {dep.version && !checkingDeps[dep.name as "git" | "entire" | "opencode" | "giteam"] ? (
                        <div className="small muted">{dep.version}</div>
                      ) : null}
                      {dep.path ? <div className="small muted">{dep.path}</div> : null}
                      {!dep.installed ? <div className="small muted">{dep.installHint}</div> : null}
                    </div>
                    <div className="toolbar">
                      {!dep.installed ? (
                        <button
                          className={installingDep === dep.name ? "chip env-chip-loading" : "chip"}
                          disabled={Boolean(installingDep) || checkingDeps[dep.name as "git" | "entire" | "opencode" | "giteam"]}
                          onClick={() => void runDependencyAction(dep.name as "git" | "entire" | "opencode" | "giteam", "install")}
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
                          disabled={Boolean(installingDep) || checkingDeps[dep.name as "git" | "entire" | "opencode" | "giteam"]}
                          onClick={() => void runDependencyAction(dep.name as "git" | "entire" | "opencode" | "giteam", "uninstall")}
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
                          onClick={() =>
                            setExpandedLogDep((prev) => (prev === dep.name ? null : (dep.name as "git" | "entire" | "opencode" | "giteam")))
                          }
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
    </AppErrorBoundary>
  );
}

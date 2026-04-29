import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type { CSSProperties, ReactNode } from "react";
import { Component, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PanelPlacement } from "./layout/Workbench";
import { Workbench } from "./layout/Workbench";
import { explainCommit, explainCommitShort, getEntireStatusDetailed } from "./lib/entireAdapter";
import { parseExplainCommit } from "./lib/explainParser";
import {
  closeRepoTerminalSession,
  clearRepoTerminalSession,
  createGitBranch,
  createGitDetachedWorktree,
  createGitWorktreeFromBranch,
  deleteGitBranch,
  getBranchCommits,
  getCommitChangedFiles,
  getCommitFilePatch,
  getCommitGraph,
  getGitWorktreeList,
  getGitUserIdentity,
  getGitWorktreeFileContent,
  getGitWorktreeFilePatch,
  getGitWorktreeOverview,
  getLocalBranches,
  gitCheckoutBranch,
  gitCheckoutRemoteBranch,
  gitDiscardChanges,
  gitStageFile,
  gitUnstageFile,
  removeGitWorktree,
  readRepoTerminalOutput,
  gitPull,
  gitPush,
  gitCommit,
  sendRepoTerminalInput,
  startGitWorktreeWatcher,
  startRepoTerminalSession,
  stopGitWorktreeWatcher
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
  GitLinkedWorktree,
  GitUserIdentity,
  GitWorktreeFileContent,
  GitWorktreeEntry,
  GitWorktreeOverview,
  QuestionRequest,
  QuestionAnswer,
  RepositoryEntry,
  ReviewAction,
  ReviewActionType,
  ReviewRecord
} from "./lib/types";
import { QuestionDock } from "./components/QuestionDock";
import { WorktreeTopologyCanvas } from "./components/WorktreeTopologyCanvas";
import type { TopologyCanvasNode } from "./components/WorktreeTopologyCanvas";

loader.config({ monaco });

type DetailTab = "diff" | "context" | "findings";
type Theme = "dark" | "light";
type RightPaneTab = "worktree" | "changes" | "terminal";
type TerminalTabState = {
  id: string;
  title: string;
  input: string;
  output: string;
  seq: number;
  alive: boolean;
  history: string[];
  historyIndex: number;
};

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
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
        <path d="M7 5v6a3 3 0 0 0 3 3h6" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 5v-1" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7 14v5" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="7" cy="4" r="1.9" fill="none" stroke={stroke} strokeWidth="1.6" />
        <circle cx="7" cy="19" r="1.9" fill="none" stroke={stroke} strokeWidth="1.6" />
        <circle cx="18" cy="14" r="1.9" fill="currentColor" opacity={props.active ? 0.95 : 0.62} />
      </svg>
    );
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
type WorktreePatchRow = {
  kind: DiffRowKind;
  text: string;
  marker: string;
  oldLine: number | null;
  newLine: number | null;
  tone: "meta" | "hunk" | "add" | "del" | "ctx";
};

type SplitDiffSide = {
  line: number | null;
  text: string;
  marker: string;
  tone: "del" | "add" | "ctx" | "empty";
};

type SplitDiffRow = {
  kind: "hunk" | "meta" | "line";
  left: SplitDiffSide;
  right: SplitDiffSide;
};
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
  turnStart: number;
  loaded: boolean;
  nextCursor?: string;
  hasMore?: boolean;
};
type WorkspaceAgentBinding = {
  workspacePath: string;
  branch: string;
  activeSessionId: string;
  sessionIds: string[];
  updatedAt: number;
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
type OpencodeTodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
};

type OpencodeMessageWindowCacheEntry = {
  limit: number;
  mapped: OpencodeChatMessage[];
  turnCount: number;
  hasMore: boolean;
  fetchedAt: number;
};

type OpencodeMessagePageCacheEntry = {
  before: string;
  limit: number;
  items: OpencodeChatMessage[];
  detailsById: Record<string, OpencodeDetailedMessage>;
  nextCursor?: string;
  hasMore: boolean;
  fetchedAt: number;
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

const EMPTY_WORKTREE_FILE_CONTENT: GitWorktreeFileContent = {
  original: "",
  modified: ""
};

type WorktreeTreeNode = {
  name: string;
  path: string;
  kind: "dir" | "file";
  children: WorktreeTreeNode[];
  entry?: GitWorktreeEntry;
};

function buildWorktreeTree(entries: GitWorktreeEntry[]): WorktreeTreeNode[] {
  const root: WorktreeTreeNode[] = [];
  const dirMap = new Map<string, WorktreeTreeNode>();

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let parentPath = "";
    let level = root;

    parts.forEach((part, index) => {
      const nextPath = parentPath ? `${parentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.find((item) => item.path === nextPath);
      if (!node && !isFile) node = dirMap.get(nextPath);
      if (!node) {
        node = {
          name: part,
          path: nextPath,
          kind: isFile ? "file" : "dir",
          children: [],
          entry: isFile ? entry : undefined
        };
        level.push(node);
        if (!isFile) dirMap.set(nextPath, node);
      }
      parentPath = nextPath;
      level = node.children;
    });
  }

  const sortNodes = (nodes: WorktreeTreeNode[]): WorktreeTreeNode[] => nodes
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) => ({
      ...node,
      children: sortNodes(node.children)
    }));

  return sortNodes(root);
}

function collectWorktreeDirPaths(nodes: WorktreeTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind !== "dir") return [];
    return [node.path, ...collectWorktreeDirPaths(node.children)];
  });
}

function getWorktreeDisplayStatus(entry: GitWorktreeEntry): string {
  const flags = `${entry.indexStatus}${entry.worktreeStatus}`;
  if (flags.includes("?")) return "A";
  if (flags.includes("A")) return "A";
  if (flags.includes("D")) return "D";
  if (flags.includes("R")) return "R";
  if (flags.includes("C")) return "C";
  if (flags.includes("M")) return "M";
  return flags.trim() || "-";
}

function getWorktreeFileKindLabel(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "file";
  if (ext === "tsx" || ext === "jsx") return "tsx";
  if (ext === "ts" || ext === "js") return ext;
  if (ext === "css" || ext === "html" || ext === "rs") return ext;
  return ext.slice(0, 4);
}

function getMonacoLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "javascript";
  if (ext === "rs") return "rust";
  if (ext === "css") return "css";
  if (ext === "html") return "html";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "toml") return "toml";
  if (ext === "yaml" || ext === "yml") return "yaml";
  return "plaintext";
}

function getWorktreeStatusText(entry?: GitWorktreeEntry | null): string {
  if (!entry) return "未选择文件";
  if (entry.untracked) return "新文件";
  if (entry.staged && entry.unstaged) return "暂存 + 未暂存";
  if (entry.staged) return "已暂存";
  if (entry.unstaged) return "未暂存";
  return "已修改";
}

function buildSplitDiffRows(patch: string): SplitDiffRow[] {
  if (!patch.trim()) return [];
  const rows: WorktreePatchRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      rows.push({ kind: "meta", text: line, marker: "@@", oldLine: null, newLine: null, tone: "hunk" });
      continue;
    }
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      rows.push({ kind: "meta", text: line, marker: "•", oldLine: null, newLine: null, tone: "meta" });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), marker: "+", oldLine: null, newLine, tone: "add" });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), marker: "-", oldLine, newLine: null, tone: "del" });
      oldLine += 1;
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({ kind: "ctx", text, marker: " ", oldLine, newLine, tone: "ctx" });
    oldLine += 1;
    newLine += 1;
  }

  const splitRows: SplitDiffRow[] = [];
  const delBuffer: WorktreePatchRow[] = [];

  function flushDelBuffer() {
    for (const row of delBuffer) {
      splitRows.push({
        kind: "line",
        left: { line: row.oldLine, text: row.text, marker: row.marker, tone: "del" },
        right: { line: null, text: "", marker: "", tone: "empty" },
      });
    }
    delBuffer.length = 0;
  }

  for (const row of rows) {
    if (row.tone === "meta" || row.tone === "hunk") {
      flushDelBuffer();
      splitRows.push({
        kind: row.tone === "hunk" ? "hunk" : "meta",
        left: { line: null, text: row.text, marker: row.marker, tone: "empty" },
        right: { line: null, text: row.text, marker: row.marker, tone: "empty" },
      });
      continue;
    }
    if (row.tone === "del") {
      delBuffer.push(row);
      continue;
    }
    if (row.tone === "add") {
      if (delBuffer.length > 0) {
        const delRow = delBuffer.shift()!;
        splitRows.push({
          kind: "line",
          left: { line: delRow.oldLine, text: delRow.text, marker: delRow.marker, tone: "del" },
          right: { line: row.newLine, text: row.text, marker: row.marker, tone: "add" },
        });
      } else {
        splitRows.push({
          kind: "line",
          left: { line: null, text: "", marker: "", tone: "empty" },
          right: { line: row.newLine, text: row.text, marker: row.marker, tone: "add" },
        });
      }
      continue;
    }
    if (row.tone === "ctx") {
      flushDelBuffer();
      splitRows.push({
        kind: "line",
        left: { line: row.oldLine, text: row.text, marker: row.marker, tone: "ctx" },
        right: { line: row.newLine, text: row.text, marker: row.marker, tone: "ctx" },
      });
      continue;
    }
  }

  flushDelBuffer();
  return splitRows;
}

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

function parseOpencodeTodoItems(input: unknown): OpencodeTodoItem[] {
  if (!Array.isArray(input)) return [];
  const items: OpencodeTodoItem[] = [];
  input.forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!row) return;
    const content = String(row.content ?? "").trim();
    const rawStatus = String(row.status ?? "pending").trim().toLowerCase();
    if (!content) return;
    const status: OpencodeTodoItem["status"] =
      rawStatus === "completed" || rawStatus === "cancelled" || rawStatus === "in_progress"
        ? rawStatus
        : "pending";
    items.push({
      id: String(row.id ?? `todo-${index + 1}`).trim() || `todo-${index + 1}`,
      content,
      status,
      priority: String(row.priority ?? "").trim() || undefined
    });
  });
  return items;
}

function readOpencodeTodosFromPart(part: OpencodeDetailedPart | undefined | null): OpencodeTodoItem[] {
  if (!part || String((part as any)?.type || "") !== "tool") return [];
  if (String((part as any)?.tool || "") !== "todowrite") return [];
  const state = ((part as any)?.state || {}) as Record<string, unknown>;
  const metadata = ((part as any)?.metadata || state.metadata || {}) as Record<string, unknown>;
  const input = (state.input || {}) as Record<string, unknown>;
  const metaTodos = parseOpencodeTodoItems(metadata.todos);
  if (metaTodos.length > 0) return metaTodos;
  return parseOpencodeTodoItems(input.todos);
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
const OPENCODE_MODEL_ENABLE_KEY = "giteam.opencode.model-enabled.v1";
const OPENCODE_MODEL_SELECTION_KEY = "giteam.opencode.model-selection.v1";
const WORKSPACE_AGENT_BINDINGS_KEY = "giteam.workspace-agent-bindings.v1";
const BRANCH_PARENT_MAP_KEY = "giteam.branch-parent-map.v1";
const WORKTREE_PARENT_MAP_KEY = "giteam.worktree-parent-map.v1";
const OPENCODE_PAGE_SIZE = 2;
const OPENCODE_SESSION_PAGE_SIZE = 3;
const OPENCODE_RECENT_VISIBLE = 2;
const OPENCODE_INITIAL_MESSAGE_FETCH_LIMIT = 80;
const OPENCODE_OLDER_MESSAGE_FETCH_LIMIT = 8;
const OPENCODE_TOP_LOAD_RATIO = 0.3;
const OPENCODE_TOP_PREFETCH_RATIO = 0.45;
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

function sanitizeTerminalOutput(text: string): string {
  const cleaned = text
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, "")
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, "")
    .replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
    .replace(/�\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^.*openclaw\.zsh:\d+:\s*command not found:\s*compdef\n?/gm, "");

  // Handle terminal backspace semantics so "l\bls" becomes "ls".
  let out = "";
  for (const ch of cleaned) {
    if (ch === "\b" || ch === "\u007f") {
      out = out.slice(0, -1);
      continue;
    }
    out += ch;
  }
  return out;
}

function splitTerminalOutputForInput(text: string): { body: string; prompt: string } {
  const source = text || "";
  const lines = source.split("\n");
  let idx = lines.length - 1;
  while (idx >= 0 && !lines[idx]?.trim()) idx -= 1;
  if (idx < 0) return { body: "", prompt: "" };
  const last = lines[idx] || "";
  const looksLikePrompt = /[#$%]\s*$/.test(last) || /\)\s+[^\n]*\s[%#$]\s*$/.test(last);
  if (!looksLikePrompt) return { body: source, prompt: "" };
  // Drop dangling standalone prompt fragments like `%` left by stream chunk boundaries.
  const bodyLines = lines.slice(0, idx).filter((line) => !/^\s*%\s*$/.test(line || ""));
  const body = bodyLines.join("\n");
  return { body, prompt: last };
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
    turnStart: 0,
    loaded: true,
    nextCursor: undefined
  };
}

function opencodeSessionFromSummary(summary: OpencodeSessionSummary, indexHint?: number): OpencodeChatSession {
  return {
    id: summary.id,
    title: summary.title || `Session ${indexHint ?? ""}`.trim(),
    createdAt: summary.createdAt || Date.now(),
    updatedAt: summary.updatedAt || summary.createdAt || Date.now(),
    messages: [],
    turnStart: 0,
    loaded: false,
    nextCursor: undefined
  };
}

function normalizeWorkspacePath(path: string): string {
  return path.trim();
}

function readWorkspaceAgentBindings(): Record<string, WorkspaceAgentBinding> {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_AGENT_BINDINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WorkspaceAgentBinding> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, WorkspaceAgentBinding> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const workspacePath = normalizeWorkspacePath(value?.workspacePath || key);
      const activeSessionId = String(value?.activeSessionId || "").trim();
      if (!workspacePath || !activeSessionId) continue;
      out[workspacePath] = {
        workspacePath,
        branch: String(value?.branch || "").trim(),
        activeSessionId,
        sessionIds: Array.isArray(value?.sessionIds) ? value.sessionIds.map((id) => String(id || "").trim()).filter(Boolean) : [activeSessionId],
        updatedAt: Number(value?.updatedAt || Date.now())
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeWorkspaceAgentBindings(bindings: Record<string, WorkspaceAgentBinding>) {
  try {
    window.localStorage.setItem(WORKSPACE_AGENT_BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // localStorage may be unavailable in restricted WebViews.
  }
}

function readBranchParentMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(BRANCH_PARENT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [child, parent] of Object.entries(parsed)) {
      const c = child.trim();
      const p = String(parent || "").trim();
      if (c && p && c !== p) out[c] = p;
    }
    return out;
  } catch {
    return {};
  }
}

function writeBranchParentMap(map: Record<string, string>) {
  try {
    window.localStorage.setItem(BRANCH_PARENT_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore unavailable storage
  }
}

function readWorktreeParentMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(WORKTREE_PARENT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string> | null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [path, branch] of Object.entries(parsed)) {
      const p = normalizeWorkspacePath(path);
      const b = String(branch || "").trim();
      if (p && b) out[p] = b;
    }
    return out;
  } catch {
    return {};
  }
}

function writeWorktreeParentMap(map: Record<string, string>) {
  try {
    window.localStorage.setItem(WORKTREE_PARENT_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore unavailable storage
  }
}

function buildOpencodeTurnRanges(messages: OpencodeChatMessage[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let currentStart = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg?.role === "user") {
      if (i > currentStart) {
        out.push({ start: currentStart, end: i });
      }
      currentStart = i;
    }
  }
  if (messages.length > currentStart) {
    out.push({ start: currentStart, end: messages.length });
  }
  return out;
}

function getInitialOpencodeTurnStart(totalTurns: number) {
  return totalTurns > OPENCODE_RECENT_VISIBLE ? totalTurns - OPENCODE_RECENT_VISIBLE : 0;
}

function sliceOpencodeMessagesByTurnStart(messages: OpencodeChatMessage[], turnStart: number) {
  const turns = buildOpencodeTurnRanges(messages);
  if (turns.length === 0) {
    return { visible: [] as OpencodeChatMessage[], hidden: [] as OpencodeChatMessage[], totalTurns: turns.length };
  }
  const startTurnIndex = Math.max(0, Math.min(Math.floor(turnStart || 0), turns.length - 1));
  const startMessageIndex = turns[startTurnIndex]?.start ?? 0;
  return {
    visible: messages.slice(startMessageIndex),
    hidden: messages.slice(0, startMessageIndex),
    totalTurns: turns.length
  };
}

function sortOpencodeSessionSummaries(rows: OpencodeSessionSummary[]): OpencodeSessionSummary[] {
  return [...rows].sort((a, b) => {
    const byCreated = (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0);
    if (byCreated !== 0) return byCreated;
    const byUpdated = (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    if (byUpdated !== 0) return byUpdated;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
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

type TopologyNodeKind = "repo" | "worktree" | "branch" | "commit";

type TopologyNode = {
  id: string;
  kind: TopologyNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  meta: string;
  accent: string;
  accentSoft: string;
  border: string;
  branch?: string;
  sha?: string;
  path?: string;
  refs?: string[];
  isCurrent?: boolean;
  dirtyCount?: number;
  author?: string;
  date?: string;
  rank?: number;
};

type TopologyEdge = {
  id: string;
  from: string;
  to: string;
  color: string;
  dashed?: boolean;
};

type TopologySection = {
  id: string;
  label: string;
  hint: string;
  x: number;
  y: number;
  width: number;
};

type TopologyGraphModel = {
  nodes: TopologyNode[];
  nodeById: Record<string, TopologyNode>;
  edges: TopologyEdge[];
  sections: TopologySection[];
  primaryNodeId: string;
  nearbyNodeIds: Record<string, boolean>;
  width: number;
  height: number;
};

function clampLabel(text: string, max = 14): string {
  const value = text.trim();
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, Math.max(1, max - 2))}..` : value;
}

function wtLabelFromPath(path: string): string {
  const parts = path.split(/[\/]/).filter(Boolean);
  if (parts.length === 0) return "WT";
  const leaf = parts[parts.length - 1];
  return clampLabel(leaf, 8);
}

function pathLeaf(path: string): string {
  return path.split(/[\/]/).filter(Boolean).pop() || path.trim() || "workspace";
}

function shortSha(value: string, size = 8): string {
  const text = value.trim();
  if (!text) return "-";
  return text.slice(0, size);
}

function branchTone(branchName: string) {
  const branch = branchName.trim() || "unknown";
  const prefix = branch.split("/")[0]?.toLowerCase() || branch.toLowerCase();
  const preset: Record<string, { accent: string; soft: string; border: string }> = {
    main: { accent: "#3b82f6", soft: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.34)" },
    master: { accent: "#3b82f6", soft: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.34)" },
    feature: { accent: "#22c55e", soft: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.34)" },
    hotfix: { accent: "#ef4444", soft: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.34)" },
    develop: { accent: "#a855f7", soft: "rgba(168,85,247,0.16)", border: "rgba(168,85,247,0.34)" },
    release: { accent: "#f59e0b", soft: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.34)" },
    fix: { accent: "#ec4899", soft: "rgba(236,72,153,0.16)", border: "rgba(236,72,153,0.34)" },
    chore: { accent: "#64748b", soft: "rgba(100,116,139,0.18)", border: "rgba(100,116,139,0.34)" },
    docs: { accent: "#0ea5e9", soft: "rgba(14,165,233,0.16)", border: "rgba(14,165,233,0.34)" },
    test: { accent: "#14b8a6", soft: "rgba(20,184,166,0.16)", border: "rgba(20,184,166,0.34)" },
    refactor: { accent: "#f97316", soft: "rgba(249,115,22,0.16)", border: "rgba(249,115,22,0.34)" }
  };
  if (preset[prefix]) return preset[prefix];
  const hue = Array.from(branch).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  return {
    accent: `hsl(${hue} 72% 56%)`,
    soft: `hsl(${hue} 72% 56% / 0.16)`,
    border: `hsl(${hue} 72% 56% / 0.34)`
  };
}

function topologyEdgePath(from: TopologyNode, to: TopologyNode): string {
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height;
  const endX = to.x + to.width / 2;
  const endY = to.y;
  if (from.kind === "branch" && to.kind === "branch") {
    const bend = Math.max(48, Math.min(110, (endY - startY) * 0.62));
    return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
  }
  const midY = Math.round(startY + Math.max(26, (endY - startY) * 0.52));
  if (Math.abs(startX - endX) < 2) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
  return `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
}

function buildTopologyModel(input: {
  repoName: string;
  repoPath: string;
  currentBranch: string;
  branches: GitBranchSummary[];
  worktrees: GitLinkedWorktree[];
  branchCommits: GitCommitSummary[];
  commitGraph: GitGraphNode[];
  branchParentMap: Record<string, string>;
}): TopologyGraphModel {
  const branchNames = Array.from(new Set(input.branches.map((row) => row.name).filter(Boolean)));
  const currentBranch = input.currentBranch || branchNames.find((name) => name === "main") || branchNames[0] || "main";
  const normalizeBranchName = (name: string): string => name.replace(/^refs\/heads\//, "");
  const worktrees = input.worktrees
    .filter((wt) => wt.path.trim())
    .map((wt) => ({ ...wt, branch: normalizeBranchName(wt.branch || currentBranch) }));
  const currentWorktree = worktrees.find((wt) => wt.isCurrent)
    || worktrees.find((wt) => wt.path.trim() === input.repoPath.trim())
    || null;
  const workspaceBranchNames = new Set(worktrees.map((wt) => wt.branch).filter(Boolean));
  const graphCommits = input.commitGraph.filter((row) => !row.isConnector && !!row.sha);
  const branchHeadByName = new Map<string, string>();
  const parseAllRefs = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const inner = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
    return inner.split(",").map((part) => part.trim()).filter(Boolean);
  };
  for (const row of graphCommits) {
    const refs = parseAllRefs(row.refs);
    for (const ref of refs) {
      const branch = branchFromRef(ref, input.branches);
      if (branch && !branchHeadByName.has(branch)) {
        branchHeadByName.set(branch, row.sha);
      }
    }
  }

  const currentWidth = 320;
  const currentHeight = 112;
  const workspaceWidth = 176;
  const workspaceHeight = 86;
  const branchWidth = 156;
  const branchHeight = 72;
  const colGap = 24;
  const rowGap = 24;
  const marginX = 92;
  const topY = 96;
  const sectionGap = 76;
  const currentWorkspace = currentWorktree || {
    path: input.repoPath,
    branch: currentBranch,
    head: branchHeadByName.get(currentBranch) || "",
    isCurrent: true,
    isMainWorktree: true,
    isDetached: false,
    clean: true,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    locked: "",
    prunable: ""
  };
  const activeWorkspaces = worktrees
    .filter((wt) => wt.path !== currentWorkspace.path)
    .sort((a, b) => Number(b.stagedCount + b.unstagedCount + b.untrackedCount > 0) - Number(a.stagedCount + a.unstagedCount + a.untrackedCount > 0) || a.branch.localeCompare(b.branch));
  const availableBranches = branchNames
    .filter((name) => !workspaceBranchNames.has(name))
    .sort((a, b) => a.localeCompare(b));
  const activeCols = Math.min(4, Math.max(1, activeWorkspaces.length));
  const branchCols = Math.min(5, Math.max(1, availableBranches.length));
  const boardWidth = Math.max(
    currentWidth,
    activeCols * workspaceWidth + (activeCols - 1) * colGap,
    branchCols * branchWidth + (branchCols - 1) * colGap
  );
  const sceneWidth = Math.max(1280, boardWidth + marginX * 2);
  const centerX = sceneWidth / 2;

  const nodes: TopologyNode[] = [];
  const nodeById: Record<string, TopologyNode> = {};
  const edges: TopologyEdge[] = [];
  const sections: TopologySection[] = [];
  const pushNode = (node: TopologyNode) => {
    nodes.push(node);
    nodeById[node.id] = node;
  };
  const workspaceMeta = (wt: GitLinkedWorktree, current = false): string => {
    const dirtyCount = wt.stagedCount + wt.unstagedCount + wt.untrackedCount;
    const flags = [wt.isMainWorktree ? "MAIN" : "WT", current ? "CURRENT" : "", dirtyCount > 0 ? `${dirtyCount} changes` : "clean"].filter(Boolean);
    return flags.join(" · ");
  };
  const makeWorkspaceNode = (wt: GitLinkedWorktree, x: number, y: number, width: number, height: number, current = false): TopologyNode => {
    const dirtyCount = wt.stagedCount + wt.unstagedCount + wt.untrackedCount;
    return {
      id: `worktree:${wt.path || wt.branch}`,
      kind: "worktree",
      x,
      y,
      width,
      height,
      label: clampLabel(wt.branch || pathLeaf(wt.path), current ? 22 : 14),
      meta: workspaceMeta(wt, current),
      accent: "#64748b",
      accentSoft: "rgba(100,116,139,0.12)",
      border: "rgba(100,116,139,0.30)",
      branch: wt.branch,
      isCurrent: current || wt.isCurrent,
      path: wt.path,
      sha: wt.head,
      dirtyCount,
      rank: 0
    };
  };

  const currentY = topY;
  sections.push({ id: "current", label: "Current Workspace", hint: "当前正在工作的目录", x: centerX - boardWidth / 2, y: currentY - 34, width: boardWidth });
  const currentNode = makeWorkspaceNode(currentWorkspace, centerX - currentWidth / 2, currentY, currentWidth, currentHeight, true);
  pushNode(currentNode);

  const activeY = currentY + currentHeight + sectionGap;
  sections.push({ id: "active", label: "Active Workspaces", hint: "已创建 worktree 的工作现场", x: centerX - boardWidth / 2, y: activeY - 34, width: boardWidth });
  activeWorkspaces.forEach((wt, index) => {
    const row = Math.floor(index / activeCols);
    const col = index % activeCols;
    const rowCount = index >= activeWorkspaces.length - activeCols ? Math.min(activeCols, activeWorkspaces.length - row * activeCols) : activeCols;
    const rowWidth = rowCount * workspaceWidth + (rowCount - 1) * colGap;
    const x = centerX - rowWidth / 2 + Math.min(col, rowCount - 1) * (workspaceWidth + colGap);
    const y = activeY + row * (workspaceHeight + rowGap);
    pushNode(makeWorkspaceNode(wt, x, y, workspaceWidth, workspaceHeight, false));
  });

  const activeRows = Math.max(1, Math.ceil(activeWorkspaces.length / activeCols));
  const branchY = activeY + activeRows * (workspaceHeight + rowGap) + sectionGap;
  sections.push({ id: "branches", label: "Available Branches", hint: "还没有激活为工作空间的分支", x: centerX - boardWidth / 2, y: branchY - 34, width: boardWidth });
  availableBranches.forEach((branchName, index) => {
    const row = Math.floor(index / branchCols);
    const col = index % branchCols;
    const rowCount = index >= availableBranches.length - branchCols ? Math.min(branchCols, availableBranches.length - row * branchCols) : branchCols;
    const rowWidth = rowCount * branchWidth + (rowCount - 1) * colGap;
    const x = centerX - rowWidth / 2 + Math.min(col, rowCount - 1) * (branchWidth + colGap);
    const y = branchY + row * (branchHeight + rowGap);
    const tone = branchTone(branchName);
    pushNode({
      id: `branch:${branchName}`,
      kind: "branch",
      x,
      y,
      width: branchWidth,
      height: branchHeight,
      label: clampLabel(branchName, 12),
      meta: "BR only",
      accent: tone.accent,
      accentSoft: tone.soft,
      border: tone.border,
      branch: branchName,
      isCurrent: false,
      sha: branchHeadByName.get(branchName),
      rank: index + 1
    });
  });

  const primaryNodeId = currentNode.id;
  const nearbyNodeIds = Object.fromEntries(nodes.map((node) => [node.id, true]));
  const maxNodeY = Math.max(...nodes.map((n) => n.y + n.height), branchY + branchHeight);
  const height = Math.max(400, maxNodeY + 80);
  return { nodes, nodeById, edges, sections, primaryNodeId, nearbyNodeIds, width: sceneWidth, height };
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
  const [rightPaneWidth, setRightPaneWidth] = useState(() => loadCachedWidth(RIGHT_PANE_WIDTH_CACHE_KEY, 840, 640, 1120));
  const [changesSidebarWidth, setChangesSidebarWidth] = useState(260);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(true);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(true);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [draggingSplit, setDraggingSplit] = useState<null | {
    kind: "sidebar" | "right" | "changes";
    startX: number;
    startWidth: number;
  }>(null);
  const [repoContextMenu, setRepoContextMenu] = useState<{ x: number; y: number; repo: RepositoryEntry } | null>(null);
  const [commitContextMenu, setCommitContextMenu] = useState<{ x: number; y: number; sha: string; branch?: string; subject?: string } | null>(null);
  const [topologyContextMenu, setTopologyContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [topologyCreateSourceNodeId, setTopologyCreateSourceNodeId] = useState("");
  const [topologyInspectNodeId, setTopologyInspectNodeId] = useState("");
  const [selectedWorktreePath, setSelectedWorktreePath] = useState("");

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
  const [linkedWorktrees, setLinkedWorktrees] = useState<GitLinkedWorktree[]>([]);
  const [gitUserIdentity, setGitUserIdentity] = useState<GitUserIdentity>(EMPTY_GIT_IDENTITY);
  const [selectedWorktreeFile, setSelectedWorktreeFile] = useState("");
  const [selectedWorktreePatch, setSelectedWorktreePatch] = useState("");
  const [selectedWorktreeContent, setSelectedWorktreeContent] = useState<GitWorktreeFileContent>(EMPTY_WORKTREE_FILE_CONTENT);
  const [expandedWorktreeDirs, setExpandedWorktreeDirs] = useState<string[]>([]);
  const [topologySelectionId, setTopologySelectionId] = useState("");
  const [topologyZoom, setTopologyZoom] = useState(1);
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());
  const [creatingTopologyNode, setCreatingTopologyNode] = useState(false);
  const [showTopologyCreateDialog, setShowTopologyCreateDialog] = useState(false);
  const [showTopologyInspectDialog, setShowTopologyInspectDialog] = useState(false);
  const [topologyCreateBranchName, setTopologyCreateBranchName] = useState("");
  const [topologyCreateTargetPath, setTopologyCreateTargetPath] = useState("");
  const [topologyCreateMode, setTopologyCreateMode] = useState<"branch" | "worktree">("branch");
  const [topologyCreatingNode, setTopologyCreatingNode] = useState<{
    parentId: string;
    name: string;
    x: number;
    y: number;
    mode: "branch" | "worktree";
  } | null>(null);
  const [removingTopologyNode, setRemovingTopologyNode] = useState(false);
  const [selectedExplain, setSelectedExplain] = useState("");
  const [agentContextError, setAgentContextError] = useState("");
  const [statusText, setStatusText] = useState("");
  const [showAgentContextFull, setShowAgentContextFull] = useState(false);

  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [actions, setActions] = useState<ReviewAction[]>([]);

  const [detailTab, setDetailTab] = useState<DetailTab>("diff");
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>("worktree");
  const [commitMessage, setCommitMessage] = useState("");
  const [showCommitActionMenu, setShowCommitActionMenu] = useState(false);
  const [gitOperation, setGitOperation] = useState<"commit" | "push" | "sync" | "commitPush" | "commitSync" | null>(null);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [discardingFile, setDiscardingFile] = useState("");
  const [showDiscardAllConfirm, setShowDiscardAllConfirm] = useState(false);
  const [discardingAll, setDiscardingAll] = useState(false);
  const [worktreeContextMenu, setWorktreeContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [showRemoveWorktreeConfirm, setShowRemoveWorktreeConfirm] = useState(false);
  const [removingWorktreePath, setRemovingWorktreePath] = useState("");
  const [worktreeToRemove, setWorktreeToRemove] = useState("");
  const [stagingFile, setStagingFile] = useState("");
  const [unstagingFile, setUnstagingFile] = useState("");
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
  const [opencodeEnabledModels, setOpencodeEnabledModels] = useState<Set<string>>(() => new Set());
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
  const [opencodeSessionFetchLimit, setOpencodeSessionFetchLimit] = useState(OPENCODE_SESSION_PAGE_SIZE);
  const [draftOpencodeSession, setDraftOpencodeSession] = useState(false);
  const [opencodeRunBusyBySession, setOpencodeRunBusyBySession] = useState<Record<string, boolean>>({});
  const [opencodeStreamingAssistantIdBySession, setOpencodeStreamingAssistantIdBySession] = useState<Record<string, string>>({});
  const [opencodeSessions, setOpencodeSessions] = useState<OpencodeChatSession[]>([]);
  const [sidebarOpencodeSessionsByRepo, setSidebarOpencodeSessionsByRepo] = useState<Record<string, OpencodeChatSession[]>>({});
  const [sidebarOpencodeSessionFetchLimitByRepo, setSidebarOpencodeSessionFetchLimitByRepo] = useState<Record<string, number>>({});
  const [sidebarOpencodeSessionLoadingByRepo, setSidebarOpencodeSessionLoadingByRepo] = useState<Record<string, boolean>>({});
  const [sidebarOpencodeSessionHasMoreByRepo, setSidebarOpencodeSessionHasMoreByRepo] = useState<Record<string, boolean>>({});
  const [activeOpencodeSessionId, setActiveOpencodeSessionId] = useState("");
  const [workspaceAgentBindings, setWorkspaceAgentBindings] = useState<Record<string, WorkspaceAgentBinding>>(() => readWorkspaceAgentBindings());
  const [branchParentMap, setBranchParentMap] = useState<Record<string, string>>(() => readBranchParentMap());
  const [worktreeParentMap, setWorktreeParentMap] = useState<Record<string, string>>(() => readWorktreeParentMap());
  const [showOpencodeSessionRail, setShowOpencodeSessionRail] = useState(true);
  const [showOpencodeDebugLog, setShowOpencodeDebugLog] = useState(false);
  const [opencodeDebugLogs, setOpencodeDebugLogs] = useState<string[]>([]);
  const [opencodeServerMessageIdByLocalId, setOpencodeServerMessageIdByLocalId] = useState<Record<string, string>>({});
  const [opencodeLivePartsByServerMessageId, setOpencodeLivePartsByServerMessageId] = useState<Record<string, OpencodeDetailedPart[]>>({});
  const [opencodeDetailsLoadingByMessageId, setOpencodeDetailsLoadingByMessageId] = useState<Record<string, boolean>>({});
  const [opencodeDetailsErrorByMessageId, setOpencodeDetailsErrorByMessageId] = useState<Record<string, string>>({});
  const [opencodeDetailsByMessageId, setOpencodeDetailsByMessageId] = useState<Record<string, OpencodeDetailedMessage | null>>({});
  const [opencodeTodoDockVisible, setOpencodeTodoDockVisible] = useState(false);
  const [opencodeTodoDockCollapsed, setOpencodeTodoDockCollapsed] = useState(false);
  const [opencodeQuestionRequests, setOpencodeQuestionRequests] = useState<QuestionRequest[]>([]);
  const [opencodeQuestionLoading, setOpencodeQuestionLoading] = useState(false);
  const [opencodeDismissedQuestionsBySession, setOpencodeDismissedQuestionsBySession] = useState<Record<string, string[]>>({});
  const opencodeThreadRef = useRef<HTMLDivElement | null>(null);
  const opencodeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const commitMessageInputRef = useRef<HTMLInputElement | null>(null);
  const opencodeRightPaneRef = useRef<HTMLDivElement | null>(null);
  const topologyViewportRef = useRef<HTMLDivElement | null>(null);
  const topologyDragStateRef = useRef<null | { x: number; y: number; left: number; top: number }>(null);
  const opencodeModelPickerRef = useRef<HTMLDivElement | null>(null);
  const opencodeLoadingOlderRef = useRef(false);
  const opencodePrevScrollHeightRef = useRef(0);
  const opencodePrevActiveSessionIdRef = useRef("");
  const opencodePendingAnchorSessionIdRef = useRef("");
  const opencodeStickToBottomSessionRef = useRef("");
  const opencodeSessionsRepoIdRef = useRef("");
  const opencodeMessageWindowCacheRef = useRef<Record<string, OpencodeMessageWindowCacheEntry[]>>({});
  const opencodeMessagePageCacheRef = useRef<Record<string, OpencodeMessagePageCacheEntry>>({});
  const opencodeMessagePageInflightRef = useRef<Record<string, Promise<OpencodeMessagePageCacheEntry> | undefined>>({});
  const pendingSidebarSessionSelectionRef = useRef<{ repoId: string; sessionId: string } | null>(null);
  const sidebarOpencodeSessionRequestSeqRef = useRef<Record<string, number>>({});
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
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>([
    {
      id: "terminal-1",
      title: "终端 1",
      input: "",
      output: "",
      seq: 0,
      alive: false,
      history: [],
      historyIndex: -1
    }
  ]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState("terminal-1");
  const [terminalSidebarVisible, setTerminalSidebarVisible] = useState(true);
  const terminalTabCounterRef = useRef(2);
  const terminalSeqRef = useRef<Record<string, number>>({ "terminal-1": 0 });
  const terminalLogRef = useRef<HTMLDivElement | null>(null);
  const terminalInputRef = useRef<HTMLInputElement | null>(null);

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
  const repoPathRef = useRef(repoPath);
  const selectedWorktreeFileRef = useRef(selectedWorktreeFile);
  const rightPaneTabRef = useRef(rightPaneTab);
  const gitAutoRefreshBlockedRef = useRef(false);
  const gitAutoRefreshTimerRef = useRef<number | null>(null);
  const workspacePath = normalizeWorkspacePath(repoPath);
  const activeWorkspaceAgentBinding = workspacePath ? workspaceAgentBindings[workspacePath] || null : null;
  const activeTerminalTab = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? terminalTabs[0],
    [terminalTabs, activeTerminalTabId]
  );
  const worktreeTree = useMemo(() => buildWorktreeTree(worktreeOverview.entries), [worktreeOverview.entries]);
  const stagedTree = useMemo(() => buildWorktreeTree(worktreeOverview.entries.filter((e) => e.staged)), [worktreeOverview.entries]);
  const unstagedTree = useMemo(() => buildWorktreeTree(worktreeOverview.entries.filter((e) => e.unstaged || e.untracked)), [worktreeOverview.entries]);
  const selectedWorktreeEntry = useMemo(
    () => worktreeOverview.entries.find((entry) => entry.path === selectedWorktreeFile) ?? null,
    [worktreeOverview.entries, selectedWorktreeFile]
  );
  const worktreePatchRows = useMemo(() => buildSplitDiffRows(selectedWorktreePatch), [selectedWorktreePatch]);
  const worktreePatchStats = useMemo(() => ({
    added: worktreePatchRows.filter((row) => row.right.tone === "add").length,
    deleted: worktreePatchRows.filter((row) => row.left.tone === "del").length,
    hunks: worktreePatchRows.filter((row) => row.kind === "hunk").length
  }), [worktreePatchRows]);
  const worktreeChangeStats = useMemo(() => {
    const entries = worktreeOverview.entries;
    const stagedCount = entries.filter((e) => e.staged).length;
    const unstagedCount = entries.filter((e) => e.unstaged || e.untracked).length;
    return { total: entries.length, staged: stagedCount, unstaged: unstagedCount };
  }, [worktreeOverview.entries]);
  const discardAllCount = useMemo(
    () => worktreeOverview.entries.filter((e) => e.staged || e.unstaged || e.untracked).length,
    [worktreeOverview.entries]
  );
  const hasCommittableChanges = worktreeChangeStats.staged > 0 || worktreeChangeStats.unstaged > 0;
  const commitButtonCount = worktreeChangeStats.staged > 0 ? worktreeChangeStats.staged : worktreeChangeStats.unstaged;
  const needsGitSync = worktreeOverview.ahead > 0 || worktreeOverview.behind > 0;
  const commitPrimaryIsSync = !hasCommittableChanges && needsGitSync;
  const gitOperationLabel = gitOperation === "push"
    ? "Pushing..."
    : gitOperation === "sync"
      ? "Syncing..."
      : gitOperation === "commitPush"
        ? "Commit & Push..."
        : gitOperation === "commitSync"
          ? "Commit & Sync..."
          : gitOperation === "commit"
            ? "Committing..."
            : "";

  useEffect(() => {
    repoPathRef.current = repoPath;
    selectedWorktreeFileRef.current = selectedWorktreeFile;
    rightPaneTabRef.current = rightPaneTab;
    gitAutoRefreshBlockedRef.current = busy || committing || pushing || discardingAll || !!discardingFile || !!stagingFile || !!unstagingFile;
  }, [repoPath, selectedWorktreeFile, rightPaneTab, busy, committing, pushing, discardingAll, discardingFile, stagingFile, unstagingFile]);
  const activeTerminalView = useMemo(
    () => splitTerminalOutputForInput(activeTerminalTab?.output || ""),
    [activeTerminalTab?.output]
  );
  const topologyModel = useMemo(
    () => buildTopologyModel({
      repoName: selectedRepo?.name || "Current Repo",
      repoPath,
      currentBranch: worktreeOverview.branch || selectedBranch,
      branches,
      worktrees: linkedWorktrees,
      branchCommits: commits,
      commitGraph,
      branchParentMap
    }),
    [selectedRepo?.name, repoPath, worktreeOverview.branch, selectedBranch, branches, linkedWorktrees, commits, commitGraph, branchParentMap]
  );
  const selectedTopologyNode = topologyModel.nodeById[topologySelectionId] || null;
  const topologyCreateSourceNode = topologyModel.nodeById[topologyCreateSourceNodeId] || null;
  const topologyInspectNode = topologyModel.nodeById[topologyInspectNodeId] || null;
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
  const opencodeTurnStart = activeOpencodeSession?.turnStart ?? 0;
  const opencodeSessionLoading = Boolean(activeOpencodeSessionId && activeOpencodeSession && !activeOpencodeSession.loaded);
  const activeOpencodeSessionBusy = Boolean(activeOpencodeSessionId && opencodeRunBusyBySession[activeOpencodeSessionId]);
  const activeOpencodeStreamingAssistantId = activeOpencodeSessionId ? (opencodeStreamingAssistantIdBySession[activeOpencodeSessionId] || "") : "";

  function bindOpencodeSessionToWorkspace(sessionId: string, workspacePathInput = repoPath, branchInput = worktreeOverview.branch || selectedBranch) {
    const workspace = normalizeWorkspacePath(workspacePathInput);
    const sid = sessionId.trim();
    if (!workspace || !sid) return;
    setWorkspaceAgentBindings((prev) => {
      const current = prev[workspace];
      const sessionIds = [sid, ...(current?.sessionIds || []).filter((id) => id !== sid)];
      const next = {
        ...prev,
        [workspace]: {
          workspacePath: workspace,
          branch: branchInput.trim(),
          activeSessionId: sid,
          sessionIds,
          updatedAt: Date.now()
        }
      };
      writeWorkspaceAgentBindings(next);
      return next;
    });
  }

  function unbindWorkspaceAgent(workspacePathInput: string) {
    const workspace = normalizeWorkspacePath(workspacePathInput);
    if (!workspace) return;
    setWorkspaceAgentBindings((prev) => {
      if (!prev[workspace]) return prev;
      const next = { ...prev };
      delete next[workspace];
      writeWorkspaceAgentBindings(next);
      return next;
    });
  }

  function rememberBranchParent(childBranch: string, parentBranch: string) {
    const child = childBranch.trim();
    const parent = parentBranch.trim();
    if (!child || !parent || child === parent) return;
    setBranchParentMap((prev) => {
      const next = { ...prev, [child]: parent };
      writeBranchParentMap(next);
      return next;
    });
  }

  function forgetBranchParent(branchName: string) {
    const branch = branchName.trim();
    if (!branch) return;
    setBranchParentMap((prev) => {
      if (!prev[branch]) return prev;
      const next = { ...prev };
      delete next[branch];
      writeBranchParentMap(next);
      return next;
    });
  }

  function rememberWorktreeParent(worktreePath: string, parentBranch: string) {
    const path = normalizeWorkspacePath(worktreePath);
    const parent = parentBranch.trim();
    if (!path || !parent) return;
    setWorktreeParentMap((prev) => {
      const next = { ...prev, [path]: parent };
      writeWorktreeParentMap(next);
      return next;
    });
  }

  async function bindAgentToWorkspacePath(workspacePathInput: string, branchInput = "") {
    if (!ensureRepoSelected()) return;
    const target = normalizeWorkspacePath(workspacePathInput);
    if (!target) return;
    setTopologyContextMenu(null);
    setMessage(`正在绑定 Agent: ${pathLeaf(target)}...`);
    try {
      if (target !== repoPath) {
        await activateLinkedWorktree(target);
      }
      const title = `Agent · ${branchInput || pathLeaf(target)}`;
      const created = await invoke<OpencodeSessionSummary>("create_opencode_session", {
        repoPath: target,
        title
      });
      const next = opencodeSessionFromSummary(created, opencodeSessions.length + 1);
      next.loaded = true;
      setOpencodeSessions((prev) => (prev.some((s) => s.id === created.id) ? prev : [next, ...prev]));
      setActiveOpencodeSessionId(created.id);
      setDraftOpencodeSession(false);
      bindOpencodeSessionToWorkspace(created.id, target, branchInput);
      setMessage(`已绑定 Agent: ${pathLeaf(target)}`);
    } catch (e) {
      setError(String(e));
      setMessage("绑定 Agent 失败");
    }
  }

  function unbindAgentFromWorkspacePath(workspacePathInput: string) {
    const target = normalizeWorkspacePath(workspacePathInput);
    if (!target) return;
    setTopologyContextMenu(null);
    unbindWorkspaceAgent(target);
    if (target === workspacePath) {
      setActiveOpencodeSessionId("");
      setDraftOpencodeSession(true);
    }
    setMessage(`已解除 Agent 绑定: ${pathLeaf(target)}`);
  }

  function getRepoSessionFetchLimit(repoId: string): number {
    const id = repoId.trim();
    if (!id) return OPENCODE_SESSION_PAGE_SIZE;
    if (id === selectedRepo?.id) return sidebarOpencodeSessionFetchLimitByRepo[id] ?? opencodeSessionFetchLimit;
    return sidebarOpencodeSessionFetchLimitByRepo[id] ?? OPENCODE_SESSION_PAGE_SIZE;
  }

  function getRepoSessionsForSidebar(repoId: string): OpencodeChatSession[] {
    const id = repoId.trim();
    if (!id) return [];
    return sidebarOpencodeSessionsByRepo[id] ?? [];
  }

  function getVisibleRepoSessions(repoId: string): OpencodeChatSession[] {
    const sessions = getRepoSessionsForSidebar(repoId);
    const limit = getRepoSessionFetchLimit(repoId);
    return sessions.slice(0, Math.max(OPENCODE_SESSION_PAGE_SIZE, limit));
  }

  function hasMoreRepoSessions(repoId: string): boolean {
    return Boolean(sidebarOpencodeSessionHasMoreByRepo[repoId.trim()]);
  }

  function isRepoSessionsLoading(repoId: string): boolean {
    return Boolean(sidebarOpencodeSessionLoadingByRepo[repoId.trim()]);
  }

  function toggleRepoSessions(repo: RepositoryEntry) {
    const expanded = expandedProjectIds.includes(repo.id);
    setExpandedProjectIds((prev) => (prev.includes(repo.id) ? prev.filter((id) => id !== repo.id) : [...prev, repo.id]));
    if (!expanded && runtimeStatus.opencode.installed) {
      void refreshSidebarRepoSessions(repo).catch((e) => setError(String(e)));
    }
  }
  const opencodeSavedModelCandidates = useMemo(() => {
    const q = opencodeModelPickerSearch.trim().toLowerCase();
    if (!q) return opencodeSavedModels;
    return opencodeSavedModels.filter((m) => m.toLowerCase().includes(q));
  }, [opencodeSavedModels, opencodeModelPickerSearch]);

  const opencodeConfiguredModelCandidates = useMemo(() => {
    // Picker shows configured models + locally enabled models (OpenCode-like local visibility semantics).
    const q = opencodeModelPickerSearch.trim().toLowerCase();
    const connected = new Set(opencodeConnectedProviders.filter(Boolean));
    const out = new Set<string>();
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
        out.add(full);
      }
    }
    for (const full of opencodeEnabledModels) {
      if (!full || opencodeHiddenModels.has(full)) continue;
      const parsed = parseModelRef(full);
      if (!parsed) continue;
      const resolvedProvider = resolveProviderAliasWithNames(parsed.provider, opencodeModelsByProvider, opencodeProviderNames) || parsed.provider;
      if (resolvedProvider && !connected.has(resolvedProvider)) continue;
      if (q) {
        const name =
          opencodeConfiguredModelNamesByProvider[parsed.provider]?.[parsed.model] ||
          opencodeModelNamesByProvider[resolvedProvider]?.[parsed.model] ||
          "";
        const hay = `${full} ${name}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.add(full);
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b));
  }, [
    opencodeConfiguredProviders,
    opencodeConfiguredModelsByProvider,
    opencodeModelPickerSearch,
    opencodeHiddenModels,
    opencodeEnabledModels,
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

  function getOpencodeModelDisplay(modelRef: string) {
    const normalized = normalizeModelRef(modelRef);
    const parsed = normalized ? parseModelRef(normalized) : null;
    const provider = resolveProviderAliasWithNames(parsed?.provider || "", opencodeModelsByProvider, opencodeProviderNames) || (parsed?.provider || "");
    const modelId = parsed?.model || "";
    const label = (provider ? (opencodeConfiguredModelNamesByProvider[provider]?.[modelId] || opencodeModelNamesByProvider[provider]?.[modelId]) : "") || normalized || "Auto";
    return {
      ref: normalized || "",
      provider: provider || "Auto",
      modelId,
      label
    };
  }

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

  function getOpencodeMessageCacheKey(repoPathValue: string, sessionId: string) {
    return `${repoPathValue.trim()}\n${sessionId.trim()}`;
  }

  function getOpencodeMessagePageCacheKey(repoPathValue: string, sessionId: string, before: string, limit: number) {
    return `${getOpencodeMessageCacheKey(repoPathValue, sessionId)}\n${before}\n${limit}`;
  }

  function getOpencodeMessageCacheEntries(repoPathValue: string, sessionId: string) {
    return opencodeMessageWindowCacheRef.current[getOpencodeMessageCacheKey(repoPathValue, sessionId)] || [];
  }

  function getBestOpencodeMessageCacheEntry(repoPathValue: string, sessionId: string, limit: number) {
    const entries = getOpencodeMessageCacheEntries(repoPathValue, sessionId);
    const need = Math.max(2, limit);
    return entries.find((entry) => entry.limit >= need) || null;
  }

  function setOpencodeMessageCacheEntry(repoPathValue: string, sessionId: string, entry: OpencodeMessageWindowCacheEntry) {
    const cacheKey = getOpencodeMessageCacheKey(repoPathValue, sessionId);
    const prev = opencodeMessageWindowCacheRef.current[cacheKey] || [];
    const next = [...prev.filter((item) => item.limit !== entry.limit), entry]
      .sort((a, b) => a.limit - b.limit)
      .slice(-6);
    opencodeMessageWindowCacheRef.current = {
      ...opencodeMessageWindowCacheRef.current,
      [cacheKey]: next
    };
  }

  function setOpencodeMessagePageCacheEntry(repoPathValue: string, sessionId: string, entry: OpencodeMessagePageCacheEntry) {
    const key = getOpencodeMessagePageCacheKey(repoPathValue, sessionId, entry.before, entry.limit);
    opencodeMessagePageCacheRef.current = {
      ...opencodeMessagePageCacheRef.current,
      [key]: entry
    };
  }

  async function fetchOpencodeDetailedMessagePage(sessionId: string, before: string, limit: number) {
    const id = sessionId.trim();
    const safeBefore = before.trim();
    const safeLimit = Math.max(2, limit);
    const cacheKey = getOpencodeMessagePageCacheKey(repoPath, id, safeBefore, safeLimit);
    const cached = opencodeMessagePageCacheRef.current[cacheKey];
    if (cached) {
      appendOpencodeDebugLog(`session.messages page cache hit ${id} before=${safeBefore || "root"} limit=${safeLimit}`);
      return cached;
    }
    const inflight = opencodeMessagePageInflightRef.current[cacheKey];
    if (inflight) return inflight;
    const task = (async () => {
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      const qs = new URLSearchParams();
      qs.set("limit", String(safeLimit));
      qs.set("directory", repoPath);
      if (safeBefore) qs.set("before", safeBefore);
      const res = await fetch(`${base}/session/${encodeURIComponent(id)}/message?${qs.toString()}`);
      if (!res.ok) {
        throw new Error(`fetch message page failed: ${res.status}`);
      }
      const raw = (await res.json()) as unknown[];
      const items = (Array.isArray(raw) ? raw : []).filter(Boolean) as OpencodeDetailedMessage[];
      const detailsById: Record<string, OpencodeDetailedMessage> = {};
      const mapped: OpencodeChatMessage[] = [];
      for (const item of items) {
        const info = item?.info as Record<string, unknown> | undefined;
        const parts = item?.parts as OpencodeDetailedPart[] | undefined;
        if (!info) continue;
        const msgId = String(info.id || "").trim();
        if (!msgId) continue;
        const role = String(info.role || "").trim();
        if (role !== "user" && role !== "assistant") continue;
        detailsById[msgId] = item;
        mapped.push({ id: msgId, role: role as "user" | "assistant", content: buildOpencodeMainLineMarkdownFromParts(parts) });
      }
      const nextCursor = res.headers.get("x-next-cursor")?.trim() || undefined;
      const entry: OpencodeMessagePageCacheEntry = {
        before: safeBefore,
        limit: safeLimit,
        items: mapped,
        detailsById,
        nextCursor,
        hasMore: Boolean(nextCursor),
        fetchedAt: Date.now()
      };
      setOpencodeMessagePageCacheEntry(repoPath, id, entry);
      return entry;
    })().finally(() => {
      delete opencodeMessagePageInflightRef.current[cacheKey];
    });
    opencodeMessagePageInflightRef.current[cacheKey] = task;
    return task;
  }

  async function fetchOpencodeCompactMessagesWindow(sessionId: string, initialLimit: number) {
    const id = sessionId.trim();
    const limit = Math.max(2, initialLimit);
    const cached = getBestOpencodeMessageCacheEntry(repoPath, id, limit);
    if (cached) {
      appendOpencodeDebugLog(`session.messages cache hit ${id} limit=${cached.limit}`);
      return {
        mapped: cached.mapped,
        turnCount: cached.turnCount,
        requestedLimit: cached.limit,
        nextCursor: undefined as string | undefined,
        hasMore: cached.hasMore
      };
    }
    const page = await fetchOpencodeDetailedMessagePage(id, "", limit);
    const mapped = page.items;
    const turnCount = buildOpencodeTurnRanges(mapped).length;
    setOpencodeMessageCacheEntry(repoPath, id, {
      limit,
      mapped,
      turnCount,
      hasMore: page.hasMore,
      fetchedAt: Date.now()
    });
    if (Object.keys(page.detailsById).length > 0) {
      setOpencodeDetailsByMessageId((prev) => ({ ...prev, ...page.detailsById }));
    }
    return {
      mapped,
      turnCount,
      requestedLimit: limit,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore
    };
  }

  async function refreshSidebarRepoSessions(repo: RepositoryEntry, limitArg?: number) {
    if (!runtimeStatus.opencode.installed) return;
    const repoId = repo.id.trim();
    const repoPathArg = repo.path.trim();
    if (!repoId || !repoPathArg) return;
    const limit = Math.max(OPENCODE_SESSION_PAGE_SIZE, limitArg ?? getRepoSessionFetchLimit(repoId));
    const requestSeq = (sidebarOpencodeSessionRequestSeqRef.current[repoId] || 0) + 1;
    sidebarOpencodeSessionRequestSeqRef.current[repoId] = requestSeq;
    setSidebarOpencodeSessionLoadingByRepo((prev) => ({ ...prev, [repoId]: true }));
    try {
      const rows = await invoke<OpencodeSessionSummary[]>("list_opencode_sessions", { repoPath: repoPathArg, limit: limit + 1 });
      if (sidebarOpencodeSessionRequestSeqRef.current[repoId] !== requestSeq) return;
      const sorted = sortOpencodeSessionSummaries(rows || []);
      const hasMore = sorted.length > limit;
      const mapped = sorted.slice(0, limit).map((s, i) => opencodeSessionFromSummary(s, i + 1));
      setSidebarOpencodeSessionsByRepo((prev) => ({ ...prev, [repoId]: mapped }));
      setSidebarOpencodeSessionFetchLimitByRepo((prev) => ({ ...prev, [repoId]: limit }));
      setSidebarOpencodeSessionHasMoreByRepo((prev) => ({ ...prev, [repoId]: hasMore }));
    } finally {
      if (sidebarOpencodeSessionRequestSeqRef.current[repoId] === requestSeq) {
        setSidebarOpencodeSessionLoadingByRepo((prev) => ({ ...prev, [repoId]: false }));
      }
    }
  }

  async function loadMoreSidebarRepoSessions(repo: RepositoryEntry) {
    const repoId = repo.id.trim();
    if (!repoId) return;
    const nextLimit = getRepoSessionFetchLimit(repoId) + OPENCODE_SESSION_PAGE_SIZE;
    await refreshSidebarRepoSessions(repo, nextLimit);
    if (repoId === selectedRepo?.id) {
      setOpencodeSessionFetchLimit(nextLimit);
      await refreshOpencodeSessions(nextLimit);
    }
  }

  async function refreshOpencodeSessions(limitArg?: number) {
    if (!ensureRepoSelected()) return;
    const repoIdAtRequest = selectedRepo?.id || "";
    const pendingAtRequest = pendingSidebarSessionSelectionRef.current;
    const currentWorkspace = normalizeWorkspacePath(repoPath);
    const limit = Math.max(OPENCODE_SESSION_PAGE_SIZE, limitArg ?? opencodeSessionFetchLimit);
    appendOpencodeDebugLog("session.list requested");
    const rows = await invoke<OpencodeSessionSummary[]>("list_opencode_sessions", { repoPath, limit });
    if (!rows || rows.length === 0) {
      appendOpencodeDebugLog("session.list empty");
      opencodeSessionsRepoIdRef.current = selectedRepo?.id || "";
      setOpencodeSessions([]);
      setActiveOpencodeSessionId("");
      setDraftOpencodeSession(true);
      return;
    }
    appendOpencodeDebugLog(`session.list loaded ${rows.length}`);
    let mappedBase = sortOpencodeSessionSummaries(rows).map((s, i) => opencodeSessionFromSummary(s, i + 1));
    const pendingForRepo = pendingAtRequest && pendingAtRequest.repoId === repoIdAtRequest ? pendingAtRequest : null;
    if (pendingForRepo && !mappedBase.some((session) => session.id === pendingForRepo.sessionId)) {
      const sidebarHit = (sidebarOpencodeSessionsByRepo[repoIdAtRequest] || []).find((session) => session.id === pendingForRepo.sessionId);
      const cachedHit = opencodeSessions.find((session) => session.id === pendingForRepo.sessionId);
      const pendingSession = sidebarHit || cachedHit;
      if (pendingSession) {
        mappedBase = [pendingSession, ...mappedBase];
      }
    }
    opencodeSessionsRepoIdRef.current = repoIdAtRequest;
    setOpencodeSessions((prev) =>
      mappedBase.map((session) => {
        const cached = prev.find((item) => item.id === session.id);
        if (!cached) return session;
        return {
          ...cached,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        };
      })
    );
    const mapped = mappedBase.map((session) => {
      const cached = opencodeSessions.find((item) => item.id === session.id);
      return cached
        ? {
          ...cached,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        }
        : session;
    });
    const boundSessionId = currentWorkspace ? workspaceAgentBindings[currentWorkspace]?.activeSessionId || "" : "";
    const bindingMatches = boundSessionId && mapped.some((x) => x.id === boundSessionId);
    const pending = pendingSidebarSessionSelectionRef.current;
    const pendingMatches = pending && pending.repoId === repoIdAtRequest ? mapped.some((x) => x.id === pending.sessionId) : false;
    if (pendingMatches && pending) {
      setActiveOpencodeSessionId(pending.sessionId);
      pendingSidebarSessionSelectionRef.current = null;
    } else if (bindingMatches) {
      setActiveOpencodeSessionId(boundSessionId);
    } else {
      setActiveOpencodeSessionId((prev) => (prev && mapped.some((x) => x.id === prev) ? prev : mapped[0].id));
    }
    setDraftOpencodeSession(false);
  }

  async function loadMoreOpencodeSessions() {
    const nextLimit = opencodeSessionFetchLimit + OPENCODE_SESSION_PAGE_SIZE;
    setOpencodeSessionFetchLimit(nextLimit);
    await refreshOpencodeSessions(nextLimit);
  }

  async function loadOpencodeSessionMessages(sessionId: string) {
    if (!ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    appendOpencodeDebugLog(`session.messages load ${id}`);
    try {
      const result = await fetchOpencodeCompactMessagesWindow(id, OPENCODE_INITIAL_MESSAGE_FETCH_LIMIT);
      const mapped = result.mapped;
      const turnStart = getInitialOpencodeTurnStart(result.turnCount);
      updateOpencodeSessionById(id, (session) => ({
        ...session,
        messages: mapped,
        turnStart,
        loaded: true,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        updatedAt: Date.now()
      }));
      appendOpencodeDebugLog(`session.messages loaded ${id} count=${mapped.length} turns=${result.turnCount} start=${turnStart} hasMore=${result.hasMore}`);
      prefetchNextOpencodeHistoryPage({
        id,
        title: "",
        createdAt: 0,
        updatedAt: 0,
        messages: [],
        turnStart: 0,
        loaded: true,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore
      });
    } catch (e) {
      appendOpencodeDebugLog(`session.messages load ${id} failed: ${e}`);
      updateOpencodeSessionById(id, (session) => ({
        ...session,
        messages: [],
        turnStart: 0,
        loaded: true,
        updatedAt: Date.now()
      }));
    }
  }

  async function loadMoreOpencodeSessionMessages(sessionId: string) {
    if (!ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    const session = opencodeSessions.find((s) => s.id === id);
    if (!session) return;
    appendOpencodeDebugLog(`session.messages load more ${id}`);
    const before = (session.nextCursor || "").trim();
    if (!before) {
      opencodeLoadingOlderRef.current = false;
      opencodePrevScrollHeightRef.current = 0;
      return;
    }
    try {
      const prevTurnCount = buildOpencodeTurnRanges(session.messages).length;
      const page = await fetchOpencodeDetailedMessagePage(id, before, OPENCODE_OLDER_MESSAGE_FETCH_LIMIT);
      const merged = [...page.items, ...session.messages].filter((msg, index, arr) => arr.findIndex((item) => item.id === msg.id) === index);
      const mapped = merged;
      const growth = Math.max(0, buildOpencodeTurnRanges(mapped).length - prevTurnCount);
      if (growth <= 0) {
        updateOpencodeSessionById(id, (s) => ({
          ...s,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          updatedAt: Date.now()
        }));
        opencodeLoadingOlderRef.current = false;
        opencodePrevScrollHeightRef.current = 0;
        return;
      }
      if (Object.keys(page.detailsById).length > 0) {
        setOpencodeDetailsByMessageId((prev) => ({ ...prev, ...page.detailsById }));
      }
      updateOpencodeSessionById(id, (s) => ({
        ...s,
        messages: mapped,
        turnStart: Math.max(0, s.turnStart + growth),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        updatedAt: Date.now()
      }));
      appendOpencodeDebugLog(`session.messages prefetch older ${id} count=${mapped.length} growth=${growth} hasMore=${page.hasMore}`);
      prefetchNextOpencodeHistoryPage({
        ...session,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore
      });
    } catch (e) {
      opencodeLoadingOlderRef.current = false;
      opencodePrevScrollHeightRef.current = 0;
      appendOpencodeDebugLog(`session.messages load more ${id} failed: ${e}`);
    }
  }

  function prefetchNextOpencodeHistoryPage(session: OpencodeChatSession | null) {
    if (!session?.hasMore) return;
    const before = (session.nextCursor || "").trim();
    if (!before) return;
    void fetchOpencodeDetailedMessagePage(session.id, before, OPENCODE_OLDER_MESSAGE_FETCH_LIMIT).catch(() => {
      /* keep prefetch silent */
    });
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
    bindOpencodeSessionToWorkspace(created.id, repoPath, worktreeOverview.branch || selectedBranch);
    setDraftOpencodeSession(false);
    setOpencodePromptInput("");
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
      } else if (draggingSplit.kind === "right") {
        setRightPaneWidth(clamp(draggingSplit.startWidth - delta, 520, 1120));
      } else {
        setChangesSidebarWidth(clamp(draggingSplit.startWidth + delta, 220, 420));
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
    // Refresh catalog to pick up any model/provider changes from server.
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
    bindOpencodeSessionToWorkspace(sessionId, repoPath, worktreeOverview.branch || selectedBranch);
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
      const nextTurnCount = buildOpencodeTurnRanges(nextMessages).length;
      const nextTurnStart = getInitialOpencodeTurnStart(nextTurnCount);
      return {
        ...session,
        title: session.messages.length === 0 ? toOpencodeSessionTitle(prompt) : session.title,
        messages: nextMessages,
        turnStart: nextTurnStart,
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
            turnStart: session.turnStart,
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

        if (typ === "question.asked") {
          const request = props as QuestionRequest;
          if (String(request?.sessionID || "") !== sessionId) return;
          setOpencodeQuestionRequests((prev) => {
            const next = prev.filter((item) => item.id !== request.id);
            return [...next, request];
          });
          return;
        }

        if (typ === "question.replied" || typ === "question.rejected") {
          const sid = String(props?.sessionID || "");
          if (sid !== sessionId) return;
          const requestID = String(props?.requestID || "");
          if (!requestID) return;
          setOpencodeQuestionRequests((prev) => prev.filter((item) => item.id !== requestID));
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

  async function sendQuestionReply(requestId: string, answers: QuestionAnswer[]) {
    try {
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      const qdir = encodeURIComponent(repoPath);
      const url = `${base}/question/${encodeURIComponent(requestId)}/reply?directory=${qdir}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      appendOpencodeDebugLog(`question.reply ${requestId}`);
      await refreshPendingQuestions();
      return true;
    } catch (e) {
      appendOpencodeDebugLog(`question.reply.error ${requestId} ${String(e)}`);
      return false;
    }
  }

  async function refreshPendingQuestions(sessionIdArg = activeOpencodeSessionId) {
    const sid = sessionIdArg.trim();
    if (!sid || !repoPath.trim()) {
      setOpencodeQuestionRequests([]);
      setOpencodeQuestionLoading(false);
      return;
    }
    setOpencodeQuestionLoading(true);
    try {
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      const qdir = encodeURIComponent(repoPath);
      let raw: unknown = [];
      let lastError = "";
      for (const path of ["/question", "/question/"]) {
        try {
          const res = await fetch(`${base}${path}?directory=${qdir}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!text.trim()) throw new Error("empty response");
          raw = JSON.parse(text);
          lastError = "";
          break;
        } catch (e) {
          lastError = `${path}: ${String(e)}`;
        }
      }
      if (lastError) throw new Error(lastError);
      const rows = Array.isArray(raw) ? raw : [];
      const requests = rows.filter((row: any) => String(row?.sessionID || "") === sid) as QuestionRequest[];
      setOpencodeQuestionRequests(requests);
    } catch (e) {
      appendOpencodeDebugLog(`question.list.error ${String(e)}`);
    } finally {
      setOpencodeQuestionLoading(false);
    }
  }

  async function sendQuestionReject(requestId: string) {
    try {
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      const qdir = encodeURIComponent(repoPath);
      const url = `${base}/question/${encodeURIComponent(requestId)}/reject?directory=${qdir}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      appendOpencodeDebugLog(`question.reject ${requestId}`);
      await refreshPendingQuestions();
      return true;
    } catch (e) {
      appendOpencodeDebugLog(`question.reject.error ${requestId} ${String(e)}`);
      return false;
    }
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

  function openTopologyContextMenu(x: number, y: number, nodeId: string) {
    const menuW = 196;
    const menuH = 152;
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    // macOS native WKWebView may still flash a small Reload menu near cursor;
    // offset our app menu so it stays readable and clickable.
    const anchorX = isMac ? x + 28 : x;
    const anchorY = isMac ? y + 54 : y;
    const cx = Math.min(anchorX, window.innerWidth - menuW - 8);
    const cy = Math.min(anchorY, window.innerHeight - menuH - 8);
    setTopologyContextMenu({
      x: Math.max(8, cx),
      y: Math.max(8, cy),
      nodeId
    });
  }

  function focusTopologyNode(nodeId: string) {
    setTopologySelectionId(nodeId);
    const node = topologyModel.nodeById[nodeId];
    if (!node) return;
    // 点击时自动滚动到节点并适当放大
    const viewport = topologyViewportRef.current;
    if (viewport && node) {
      const targetZoom = Math.min(1.4, Math.max(0.8, viewport.clientWidth / topologyModel.width * 2));
      setTopologyZoom(targetZoom);
      requestAnimationFrame(() => {
        const nextLeft = Math.max(0, (node.x + node.width / 2) * targetZoom - viewport.clientWidth / 2);
        const nextTop = Math.max(0, (node.y + node.height / 2) * targetZoom - viewport.clientHeight / 2);
        viewport.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
      });
    }
    if (node.kind === "commit" && node.sha) {
      setSelectedCommit(node.sha);
      return;
    }
    if (node.kind === "branch" && node.branch) {
      void chooseBranch(node.branch);
    }
  }

  async function activateLinkedWorktree(path: string) {
    setTopologyContextMenu(null);
    const target = path.trim();
    if (!target) return;
    if (!selectedRepo) return;
    // Worktree is part of the same repo; just update the working path.
    setSelectedRepo({ ...selectedRepo, path: target });
    setMessage(`已切换到 worktree: ${target}`);
    // Manually refresh using the new path because repoPath won't update until next render.
    try {
      const [overview, worktrees, branchList, graphRows] = await Promise.all([
        getGitWorktreeOverview(target),
        getGitWorktreeList(target),
        getLocalBranches(target),
        getCommitGraph(target, 600)
      ]);
      setWorktreeOverview(overview);
      setLinkedWorktrees(worktrees);
      setBranches(branchList);
      setCommitGraph(graphRows);
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const targetBranch = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(targetBranch);
      if (targetBranch) {
        const rows = await getBranchCommits(target, targetBranch, 80);
        setCommits(rows);
        setSelectedCommit(rows[0]?.sha ?? "");
      }
    } catch (e) {
      setError(String(e));
      setMessage(`切换 worktree 失败: ${target}`);
    }
  }

  async function checkoutBranchFromTopology(branchName: string) {
    if (!ensureRepoSelected()) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`检出分支: ${branchName}...`);
    try {
      // If the target branch already has a linked worktree, switch to that worktree instead.
      const wt = linkedWorktrees.find((w) => w.branch === branchName);
      if (wt) {
        await activateLinkedWorktree(wt.path);
        setMessage(`已切换到 worktree 分支: ${branchName}`);
      } else {
        await gitCheckoutBranch(repoPath, branchName);
        setSelectedBranch(branchName);
        await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
        setMessage(`已检出分支: ${branchName}`);
      }
    } catch (e) {
      setError(String(e));
      setMessage(`检出失败: ${branchName}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkoutRemoteBranchFromTopology(remoteBranch: string) {
    if (!ensureRepoSelected()) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    const localName = remoteBranch.split('/').slice(1).join('/');
    setMessage(`创建本地分支: ${localName} from ${remoteBranch}...`);
    try {
      await gitCheckoutRemoteBranch(repoPath, remoteBranch, localName);
      setSelectedBranch(localName);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
      setMessage(`已创建并检出分支: ${localName}`);
    } catch (e) {
      setError(String(e));
      setMessage(`创建分支失败: ${localName}`);
    } finally {
      setBusy(false);
    }
  }

  async function activateBranchWorkspace(branchName: string) {
    if (!ensureRepoSelected()) return;
    const branch = branchName.trim();
    if (!branch) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`激活工作空间: ${branch}...`);
    try {
      const linked = linkedWorktrees.find((wt) => wt.branch === branch && !wt.isMainWorktree);
      if (linked) {
        await activateLinkedWorktree(linked.path);
        setMessage(`已打开工作空间: ${branch}`);
        return;
      }
      const main = linkedWorktrees.find((wt) => wt.branch === branch && wt.isMainWorktree);
      if (main) {
        setMessage(`分支 ${branch} 已在主工作区中`);
        return;
      }
      const branchExists = branches.some((b) => b.name === branch);
      if (!branchExists) {
        throw new Error(`分支 "${branch}" 不存在`);
      }
      const targetPath = suggestedTopologyPath(branch);
      const created = await createGitWorktreeFromBranch(repoPath, branch, targetPath || undefined);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
      setTopologySelectionId(`worktree:${created.path}`);
      setMessage(`已激活工作空间: ${branch}`);
    } catch (e) {
      setError(String(e));
      setMessage(`激活工作空间失败: ${branch}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBranchFromTopology(branchName: string) {
    if (!ensureRepoSelected()) return;
    const branch = branchName.trim();
    if (!branch) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`删除分支: ${branch}...`);
    try {
      const isCurrent = branches.some((b) => b.name === branch && b.isCurrent) || worktreeOverview.branch === branch;
      if (isCurrent) {
        throw new Error("不能删除当前分支");
      }
      const hasLinkedWorktree = linkedWorktrees.some((wt) => wt.branch === branch);
      if (hasLinkedWorktree) {
        throw new Error("该分支仍有关联工作空间，请先移除工作空间");
      }
      await deleteGitBranch(repoPath, branch);
      forgetBranchParent(branch);
      await refreshBranchesAndCommits();
      await refreshWorktreeData(selectedWorktreeFile);
      setTopologySelectionId(topologyModel.primaryNodeId);
      setMessage(`已删除分支: ${branch}`);
    } catch (e) {
      const text = String(e);
      setError(text);
      setMessage(`删除分支失败: ${text}`);
    } finally {
      setBusy(false);
    }
  }

  function inspectCommitFromTopology(sha: string) {
    setTopologyContextMenu(null);
    setSelectedCommit(sha);
    setDetailTab("context");
    setMessage(`查看 Entire agent 上下文: ${sha.slice(0, 8)}`);
  }

  function currentTopologyBaseBranch(): string {
    return worktreeOverview.branch || selectedBranch || branches.find((item) => item.isCurrent)?.name || "";
  }

  function topologyCreateSource(nodeId?: string): { startPoint: string; baseBranch: string } {
    if (nodeId?.startsWith("branch:")) {
      const branch = nodeId.slice(7);
      return { startPoint: branch, baseBranch: branch || currentTopologyBaseBranch() };
    }
    if (nodeId?.startsWith("commit:")) {
      const parts = nodeId.split(":");
      const branch = parts[1] || currentTopologyBaseBranch();
      const sha = parts[2] || "";
      return { startPoint: sha || branch, baseBranch: branch };
    }
    const node = topologyModel.nodeById[nodeId || topologySelectionId || topologyModel.primaryNodeId];
    if (!node) {
      return { startPoint: "", baseBranch: currentTopologyBaseBranch() };
    }
    if (node.kind === "commit") {
      return {
        startPoint: node.sha || "",
        baseBranch: node.branch || currentTopologyBaseBranch() || shortSha(node.sha || "", 7)
      };
    }
    if (node.kind === "branch" || node.kind === "worktree") {
      return {
        startPoint: node.branch || node.sha || "",
        baseBranch: node.branch || currentTopologyBaseBranch()
      };
    }
    return { startPoint: currentTopologyBaseBranch(), baseBranch: currentTopologyBaseBranch() };
  }

  function suggestedTopologyPath(baseBranch: string, identifier?: string): string {
    const mainWorktree = linkedWorktrees.find((wt) => wt.isMainWorktree)?.path || "";
    const currentPath = (mainWorktree || repoPath || selectedRepo?.path || "").trim();
    if (!currentPath) return "";
    const prefix = baseBranch.trim().replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\/+$/g, "");
    const suffix = (identifier || "").trim().replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\/+$/g, "");
    const combined = suffix ? `${prefix}-${suffix}` : prefix;
    const segs = currentPath.split("/").filter(Boolean);
    if (segs.length === 0) return "";
    const repoLeaf = segs[segs.length - 1] || "repo";
    const parent = currentPath.slice(0, currentPath.length - repoLeaf.length).replace(/\/$/, "");
    return `${parent}/${repoLeaf}.worktrees/${combined}`;
  }

  function commitWorktreeBranchName(commit: GitCommitSummary): string {
    const subjectSlug = (commit.subject || "commit")
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);
    return `worktree/${subjectSlug || "commit"}-${shortSha(commit.sha, 7)}`;
  }

  function openCommitWorktreeDialog(commit: GitCommitSummary, branchName?: string) {
    if (!ensureRepoSelected()) return;
    const branch = branchName || selectedBranch || worktreeOverview.branch || currentTopologyBaseBranch();
    const sourceId = `commit:${branch}:${commit.sha}`;
    const name = commitWorktreeBranchName(commit);
    setCommitContextMenu(null);
    setTopologyContextMenu(null);
    setTopologySelectionId(sourceId);
    setTopologyCreateSourceNodeId(sourceId);
    setTopologyCreateMode("worktree");
    setTopologyCreateBranchName(name);
    setTopologyCreateTargetPath(suggestedTopologyPath(branch || shortSha(commit.sha, 7), name));
    setTopologyCreatingNode(null);
    setShowTopologyCreateDialog(true);
  }

  function openTopologyCreateDialog(mode: "branch" | "worktree", nodeId?: string) {
    if (!ensureRepoSelected()) return;
    const sourceId = nodeId || topologySelectionId || topologyModel.primaryNodeId;
    if (sourceId.startsWith("branch:")) {
      const baseBranch = sourceId.slice(7);
      setTopologyContextMenu(null);
      setTopologySelectionId(sourceId);
      setTopologyCreateSourceNodeId(sourceId);
      setTopologyCreateMode(mode);
      setTopologyCreateBranchName("");
      setTopologyCreateTargetPath(mode === "worktree" && baseBranch ? suggestedTopologyPath(baseBranch) : "");
      setTopologyCreatingNode(null);
      setShowTopologyCreateDialog(true);
      return;
    }
    if (sourceId.startsWith("commit:")) {
      const { baseBranch, startPoint } = topologyCreateSource(sourceId);
      setTopologyContextMenu(null);
      setTopologySelectionId(sourceId);
      setTopologyCreateSourceNodeId(sourceId);
      setTopologyCreateMode(mode);
      setTopologyCreateBranchName(mode === "worktree" ? `worktree/${shortSha(startPoint, 7)}` : "");
      setTopologyCreateTargetPath(mode === "worktree" ? suggestedTopologyPath(baseBranch || shortSha(startPoint, 7), shortSha(startPoint, 7)) : "");
      setTopologyCreatingNode(null);
      setShowTopologyCreateDialog(true);
      return;
    }
    const parentNode = topologyModel.nodeById[sourceId];
    if (!parentNode) {
      setError("未找到当前节点，无法创建");
      return;
    }
    setTopologyContextMenu(null);
    setTopologySelectionId(sourceId);
    setTopologyCreateSourceNodeId(sourceId);
    setTopologyCreateMode(mode);
    setTopologyCreateBranchName("");
    const baseBranch = parentNode.branch || currentTopologyBaseBranch();
    setTopologyCreateTargetPath(mode === "worktree" && baseBranch ? suggestedTopologyPath(baseBranch) : "");
    setTopologyCreatingNode(null);
    setShowTopologyCreateDialog(true);
  }

  async function submitTopologyCreateDialog() {
    if (!ensureRepoSelected()) return;
    const sourceId = topologyCreateSourceNodeId || topologyCreatingNode?.parentId || topologySelectionId || topologyModel.primaryNodeId;
    const mode = topologyCreateMode || topologyCreatingNode?.mode || "branch";
    const branchName = (topologyCreateBranchName || topologyCreatingNode?.name || "").trim();
    if (!branchName) {
      setError(mode === "worktree" ? "请输入工作空间标识" : "请输入新的分支名");
      return;
    }
    const { baseBranch, startPoint } = topologyCreateSource(sourceId);
    setTopologyContextMenu(null);
    setCreatingTopologyNode(true);
    setBusy(true);
    setError("");

    try {
      if (mode === "branch") {
        if (branches.some((b) => b.name === branchName)) {
          throw new Error(`分支 "${branchName}" 已存在`);
        }
        setMessage(`基于 ${baseBranch} 创建分支: ${branchName}...`);
        await createGitBranch(repoPath, branchName, startPoint || undefined);
        rememberBranchParent(branchName, baseBranch);
        await refreshBranchesAndCommits();
        setSelectedBranch(branchName);
        setTopologySelectionId(`branch:${branchName}`);
        setTopologyCreatingNode(null);
        setShowTopologyCreateDialog(false);
        setMessage(`已创建分支: ${branchName}`);
      } else {
        const workspaceName = branchName;
        let targetPath = topologyCreateTargetPath.trim() || suggestedTopologyPath(baseBranch, branchName);
        const workspaceAlreadyActive = linkedWorktrees.some((wt) => normalizeWorkspacePath(wt.path) === normalizeWorkspacePath(targetPath));
        if (workspaceAlreadyActive) {
          throw new Error(`工作空间 "${workspaceName}" 已经存在`);
        }
        // If suggested path already exists, let backend auto-generate a unique path
        const pathExists = linkedWorktrees.some((wt) => wt.path === targetPath);
        if (pathExists) {
          targetPath = "";
        }
        setMessage(`基于 ${startPoint || baseBranch} 创建工作空间: ${workspaceName}...`);
        console.log("Creating detached workspace:", { repoPath, baseBranch, startPoint, targetPath: targetPath || "auto-generated" });
        const created = await createGitDetachedWorktree(repoPath, startPoint || baseBranch, targetPath || undefined);
        rememberWorktreeParent(created.path, baseBranch);
        console.log("Worktree created:", created);
        await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
        const newBranchCommits = baseBranch ? await getBranchCommits(repoPath, baseBranch, 80) : [];
        if (newBranchCommits.length > 0) {
          setCommits(newBranchCommits);
          setSelectedCommit(newBranchCommits[0]?.sha ?? "");
        }
        setSelectedBranch(baseBranch);
        setTopologySelectionId(`branch:${baseBranch}`);
        setTopologyCreatingNode(null);
        setShowTopologyCreateDialog(false);
        setMessage(`已创建工作空间: ${workspaceName}`);
      }
    } catch (e) {
      setError(String(e));
      setMessage(`创建失败: ${branchName}`);
    } finally {
      setCreatingTopologyNode(false);
      setBusy(false);
    }
  }

  function openTopologyInspectDialog(nodeId: string) {
    setTopologyContextMenu(null);
    setTopologyInspectNodeId(nodeId);
    setShowTopologyInspectDialog(true);
    const node = topologyModel.nodeById[nodeId];
    if (node?.kind === "commit" && node.sha) {
      setSelectedCommit(node.sha);
      setDetailTab("context");
    }
  }

  async function removeTopologyWorktree(targetPath: string) {
    if (!ensureRepoSelected()) return;
    const target = targetPath.trim();
    if (!target) {
      setError("目标路径为空");
      return;
    }
    const worktree = linkedWorktrees.find((item) => item.path.trim() === target);
    if (worktree?.isCurrent) {
      setError("不能删除当前 worktree 节点");
      return;
    }
    setTopologyContextMenu(null);
    setRemovingTopologyNode(true);
    setBusy(true);
    setError("");
    setMessage(`正在删除 worktree: ${target}...`);
    try {
      console.log("Removing worktree:", { repoPath, target });
      await removeGitWorktree(repoPath, target);
      unbindWorkspaceAgent(target);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
      setTopologySelectionId(topologyModel.primaryNodeId);
      setMessage("worktree 已删除");
    } catch (e) {
      console.error("删除 worktree 失败:", e);
      setError(String(e));
      setMessage(`删除失败: ${String(e)}`);
    } finally {
      setRemovingTopologyNode(false);
      setBusy(false);
    }
  }

  function centerTopologyOnCurrent() {
    const viewport = topologyViewportRef.current;
    const node = topologyModel.nodeById[topologyModel.primaryNodeId];
    if (!viewport || !node) return;
    const nextLeft = Math.max(0, (node.x + node.width / 2) * topologyZoom - viewport.clientWidth / 2);
    const nextTop = Math.max(0, (node.y + node.height / 2) * topologyZoom - viewport.clientHeight / 2);
    viewport.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
    setTopologySelectionId(node.id);
  }

  function beginTopologyPan(clientX: number, clientY: number) {
    const viewport = topologyViewportRef.current;
    if (!viewport) return;
    topologyDragStateRef.current = {
      x: clientX,
      y: clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop
    };
    viewport.classList.add("is-dragging");
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
      const graphRows = await getCommitGraph(repoPath, 600);
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
      const [overview, worktrees] = await Promise.all([
        getGitWorktreeOverview(repoPath),
        getGitWorktreeList(repoPath)
      ]);
      setWorktreeOverview(overview);
      setLinkedWorktrees(worktrees);
      const target = preferredFile && overview.entries.some((entry) => entry.path === preferredFile)
        ? preferredFile
        : overview.entries[0]?.path || "";
      setSelectedWorktreeFile(target);
      if (!target) {
        setSelectedWorktreePatch(overview.clean ? "Working tree is clean." : "No patch available.");
        setSelectedWorktreeContent(EMPTY_WORKTREE_FILE_CONTENT);
        return;
      }
      const [patch, content] = await Promise.all([
        getGitWorktreeFilePatch(repoPath, target),
        getGitWorktreeFileContent(repoPath, target)
      ]);
      setSelectedWorktreePatch(patch);
      setSelectedWorktreeContent(content);
    } catch (e) {
      setError(String(e));
      setWorktreeOverview(EMPTY_WORKTREE);
      setLinkedWorktrees([]);
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
      const [patch, content] = await Promise.all([
        getGitWorktreeFilePatch(repoPath, filePath),
        getGitWorktreeFileContent(repoPath, filePath)
      ]);
      setSelectedWorktreePatch(patch);
      setSelectedWorktreeContent(content);
    } catch (e) {
      setError(String(e));
      setSelectedWorktreePatch("");
      setSelectedWorktreeContent(EMPTY_WORKTREE_FILE_CONTENT);
    }
  }

  async function handleGitCommit() {
    if (!ensureRepoSelected()) return;
    if (committing || pushing) return;
    const msg = commitMessage.trim();
    if (!msg) {
      setMessage("Please enter a commit message");
      commitMessageInputRef.current?.focus();
      return;
    }
    const hasStaged = worktreeOverview.entries.some((e) => e.staged);
    const unstagedFiles = worktreeOverview.entries
      .filter((e) => e.unstaged || e.untracked)
      .map((e) => e.path);
    if (!hasStaged && unstagedFiles.length === 0) {
      setMessage("No changes to commit");
      return;
    }
    setCommitting(true);
    setGitOperation("commit");
    setError("");
    try {
      if (!hasStaged) {
        for (const file of unstagedFiles) {
          await gitStageFile(repoPath, file);
        }
      }
      const result = await gitCommit(repoPath, msg);
      setCommitMessage("");
      setMessage("提交成功");
      await refreshWorktreeData();
      appendOpencodeDebugLog(`git.commit ${result.trim()}`);
    } catch (e) {
      setError(String(e));
      setMessage("提交失败");
    } finally {
      setCommitting(false);
      setGitOperation(null);
    }
  }

  async function handleGitPush() {
    if (!ensureRepoSelected()) return;
    if (committing || pushing) return;
    setPushing(true);
    setGitOperation("push");
    setError("");
    setShowCommitActionMenu(false);
    try {
      const result = await gitPush(repoPath);
      setMessage("推送成功");
      await refreshWorktreeData();
      appendOpencodeDebugLog(`git.push ${result.trim()}`);
    } catch (e) {
      setError(String(e));
      setMessage("推送失败");
    } finally {
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function handleGitSync() {
    if (!ensureRepoSelected()) return;
    if (committing || pushing) return;
    setPushing(true);
    setGitOperation("sync");
    setError("");
    setShowCommitActionMenu(false);
    try {
      if (worktreeOverview.behind > 0) {
        await gitPull(repoPath);
      }
      if (worktreeOverview.ahead > 0) {
        await gitPush(repoPath);
      }
      setMessage("Sync succeeded");
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
    } catch (e) {
      setError(String(e));
      setMessage("Sync failed");
    } finally {
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function handleGitCommitAndPush() {
    if (!ensureRepoSelected()) return;
    if (committing || pushing) return;
    const msg = commitMessage.trim();
    if (!msg) {
      setMessage("Please enter a commit message");
      commitMessageInputRef.current?.focus();
      return;
    }
    const hasStaged = worktreeOverview.entries.some((e) => e.staged);
    const unstagedFiles = worktreeOverview.entries
      .filter((e) => e.unstaged || e.untracked)
      .map((e) => e.path);
    if (!hasStaged && unstagedFiles.length === 0) {
      setMessage("No changes to commit");
      return;
    }
    setCommitting(true);
    setPushing(true);
    setGitOperation("commitPush");
    setError("");
    setShowCommitActionMenu(false);
    try {
      if (!hasStaged) {
        for (const file of unstagedFiles) {
          await gitStageFile(repoPath, file);
        }
      }
      const commitResult = await gitCommit(repoPath, msg);
      const pushResult = await gitPush(repoPath);
      setCommitMessage("");
      setMessage("提交并推送成功");
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
      appendOpencodeDebugLog(`git.commit ${commitResult.trim()}`);
      appendOpencodeDebugLog(`git.push ${pushResult.trim()}`);
    } catch (e) {
      setError(String(e));
      setMessage("提交并推送失败");
    } finally {
      setCommitting(false);
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function handleGitCommitAndSync() {
    if (!ensureRepoSelected()) return;
    if (committing || pushing) return;
    const msg = commitMessage.trim();
    if (!msg) {
      setMessage("Please enter a commit message");
      commitMessageInputRef.current?.focus();
      return;
    }
    const hasStaged = worktreeOverview.entries.some((e) => e.staged);
    const unstagedFiles = worktreeOverview.entries
      .filter((e) => e.unstaged || e.untracked)
      .map((e) => e.path);
    if (!hasStaged && unstagedFiles.length === 0) {
      setMessage("No changes to commit");
      return;
    }
    setCommitting(true);
    setPushing(true);
    setGitOperation("commitSync");
    setError("");
    setShowCommitActionMenu(false);
    try {
      if (!hasStaged) {
        for (const file of unstagedFiles) {
          await gitStageFile(repoPath, file);
        }
      }
      const commitResult = await gitCommit(repoPath, msg);
      const pushResult = await gitPush(repoPath);
      setCommitMessage("");
      setMessage("Commit & Sync succeeded");
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
      appendOpencodeDebugLog(`git.commit ${commitResult.trim()}`);
      appendOpencodeDebugLog(`git.push ${pushResult.trim()}`);
    } catch (e) {
      setError(String(e));
      setMessage("Commit & Sync failed");
    } finally {
      setCommitting(false);
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function handleDiscardChanges(filePath: string, isUntracked: boolean) {
    if (!ensureRepoSelected() || !filePath) return;
    setDiscardingFile(filePath);
    setError("");
    try {
      await gitDiscardChanges(repoPath, filePath, isUntracked);
      setMessage(`已撤销: ${filePath}`);
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage("撤销修改失败");
    } finally {
      setDiscardingFile("");
    }
  }

  async function handleStageFile(filePath: string) {
    if (!ensureRepoSelected() || !filePath) return;
    setStagingFile(filePath);
    setError("");
    try {
      await gitStageFile(repoPath, filePath);
      setMessage(`已暂存: ${filePath}`);
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage("暂存失败");
    } finally {
      setStagingFile("");
    }
  }

  async function handleUnstageFile(filePath: string) {
    if (!ensureRepoSelected() || !filePath) return;
    setUnstagingFile(filePath);
    setError("");
    try {
      await gitUnstageFile(repoPath, filePath);
      setMessage(`已取消暂存: ${filePath}`);
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage("取消暂存失败");
    } finally {
      setUnstagingFile("");
    }
  }

  async function handleToggleStageAll() {
    if (!ensureRepoSelected()) return;
    const unstagedFiles = worktreeOverview.entries
      .filter((e) => e.unstaged || e.untracked)
      .map((e) => e.path);
    const stagedFiles = worktreeOverview.entries
      .filter((e) => e.staged)
      .map((e) => e.path);

    setError("");
    try {
      if (unstagedFiles.length > 0) {
        for (const file of unstagedFiles) {
          await gitStageFile(repoPath, file);
        }
        setMessage(`已暂存 ${unstagedFiles.length} 个文件`);
      } else if (stagedFiles.length > 0) {
        for (const file of stagedFiles) {
          await gitUnstageFile(repoPath, file);
        }
        setMessage(`已取消暂存 ${stagedFiles.length} 个文件`);
      }
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage(unstagedFiles.length > 0 ? "全部暂存失败" : "全部取消暂存失败");
    }
  }

  function openDiscardAllConfirm() {
    if (!ensureRepoSelected()) return;
    const entries = worktreeOverview.entries.filter((e) => e.staged || e.unstaged || e.untracked);
    if (entries.length === 0) return;
    setShowDiscardAllConfirm(true);
  }

  async function handleDiscardAllChanges() {
    if (!ensureRepoSelected()) return;
    const entries = worktreeOverview.entries.filter((e) => e.staged || e.unstaged || e.untracked);
    if (entries.length === 0) {
      setShowDiscardAllConfirm(false);
      return;
    }
    setDiscardingAll(true);
    setError("");
    try {
      for (const entry of entries) {
        await gitDiscardChanges(repoPath, entry.path, entry.untracked);
      }
      setMessage(`已撤销 ${entries.length} 个文件`);
      setShowDiscardAllConfirm(false);
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage("撤销全部修改失败");
    } finally {
      setDiscardingAll(false);
    }
  }

  async function handleRemoveWorktree(path: string) {
    if (!ensureRepoSelected() || !path) return;
    setRemovingWorktreePath(path);
    setError("");
    try {
      await removeGitWorktree(repoPath, path);
      setMessage(`已移除 worktree: ${path}`);
      setShowRemoveWorktreeConfirm(false);
      setWorktreeContextMenu(null);
      await refreshWorktreeData();
      await Promise.all([refreshBranchesAndCommits()]);
    } catch (e) {
      setError(String(e));
      setMessage("移除 worktree 失败");
    } finally {
      setRemovingWorktreePath("");
      setWorktreeToRemove("");
    }
  }

  function toggleWorktreeDir(path: string) {
    setExpandedWorktreeDirs((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]));
  }

  function renderWorktreeNodes(nodes: WorktreeTreeNode[], depth = 0): ReactNode {
    return nodes.map((node) => {
      if (node.kind === "dir") {
        const expanded = expandedWorktreeDirs.includes(node.path);
        return (
          <div key={node.path} className="gt-worktree-tree-group">
            <button
              type="button"
              className="gt-worktree-tree-row gt-worktree-tree-dir"
              style={{ paddingLeft: `${depth * 14 + 6}px` }}
              onClick={() => toggleWorktreeDir(node.path)}
            >
              <span className={expanded ? "gt-worktree-tree-chevron is-open" : "gt-worktree-tree-chevron"} aria-hidden="true" />
              <span className="gt-worktree-tree-name">{node.name}</span>
              <span className="gt-worktree-tree-dot" aria-hidden="true" />
            </button>
            {expanded ? <div className="gt-worktree-tree-children">{renderWorktreeNodes(node.children, depth + 1)}</div> : null}
          </div>
        );
      }

      const entry = node.entry;
      if (!entry) return null;
      const status = getWorktreeDisplayStatus(entry);
      const fileKind = getWorktreeFileKindLabel(entry.path);
      const canDiscard = entry.staged || entry.unstaged || entry.untracked;
      const toggleStaged = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (entry.staged) {
          void handleUnstageFile(entry.path);
        } else {
          void handleStageFile(entry.path);
        }
      };
      return (
        <div
          key={node.path}
          className={selectedWorktreeFile === entry.path ? "gt-worktree-tree-row gt-worktree-tree-file active" : "gt-worktree-tree-row gt-worktree-tree-file"}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          title={`${entry.path} (${entry.indexStatus}${entry.worktreeStatus})`}
        >
          <button
            type="button"
            className="gt-worktree-file-main-btn"
            onClick={() => void refreshSelectedWorktreePatch(entry.path)}
          >
            <span className={`gt-worktree-kind gt-worktree-kind-${fileKind}`}>{fileKind}</span>
            <span className="gt-worktree-tree-name">{node.name}</span>
          </button>
          <div className="gt-worktree-row-tail">
            <span className={`gt-worktree-tree-status is-${status.toLowerCase()}`}>{status}</span>
            <div className="gt-worktree-file-actions">
            <button
              type="button"
              className={entry.staged ? "gt-stage-toggle is-on" : "gt-stage-toggle"}
              title={entry.staged ? "取消暂存" : "暂存更改"}
              aria-pressed={entry.staged}
              disabled={(entry.staged ? unstagingFile : stagingFile) === entry.path}
              onClick={toggleStaged}
            >
              {entry.staged ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 8.2 6.7 11 12 5" />
                </svg>
              ) : null}
            </button>
            {canDiscard ? (
              <button
                type="button"
                className="gt-worktree-action-btn is-discard"
                title={entry.untracked ? "删除文件 (撤销新建)" : "撤销修改"}
                disabled={discardingFile === entry.path}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDiscardChanges(entry.path, entry.untracked);
                }}
              >
                {discardingFile === entry.path ? (
                  "..."
                ) : (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 4 3 7l3 3" />
                    <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                  </svg>
                )}
              </button>
            ) : null}
            </div>
          </div>
        </div>
      );
    });
  }

  function updateTerminalTabById(tabId: string, patch: Partial<TerminalTabState> | ((prev: TerminalTabState) => TerminalTabState)) {
    setTerminalTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== tabId) return tab;
        if (typeof patch === "function") return patch(tab);
        return { ...tab, ...patch };
      })
    );
  }

  function createTerminalTab() {
    const n = terminalTabCounterRef.current++;
    const id = `terminal-${n}`;
    terminalSeqRef.current[id] = 0;
    setTerminalTabs((prev) => [
      ...prev,
      { id, title: `终端 ${n}`, input: "", output: "", seq: 0, alive: false, history: [], historyIndex: -1 }
    ]);
    setActiveTerminalTabId(id);
  }

  async function closeTerminalTab(tabId: string) {
    if (terminalTabs.length <= 1) return;
    if (selectedRepo?.path) {
      await closeRepoTerminalSession(selectedRepo.path, tabId).catch(() => {
        // ignore
      });
    }
    delete terminalSeqRef.current[tabId];
    setTerminalTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTerminalTabId === tabId) {
        const fallback = next[Math.max(0, idx - 1)] || next[0];
        if (fallback) setActiveTerminalTabId(fallback.id);
      }
      return next;
    });
  }

  async function runTerminalCommand(command?: string) {
    if (!ensureRepoSelected()) return;
    if (!activeTerminalTab) return;
    const script = (command ?? activeTerminalTab.input).trim();
    if (!script) return;
    try {
      await sendRepoTerminalInput(repoPath, `${script}\r`, activeTerminalTab.id);
      updateTerminalTabById(activeTerminalTab.id, (prev) => ({
        ...prev,
        history: [script, ...prev.history.filter((x) => x !== script)].slice(0, 80),
        historyIndex: -1,
        input: ""
      }));
    } catch (e) {
      const msg = String(e);
      updateTerminalTabById(activeTerminalTab.id, (prev) => ({
        ...prev,
        output: `${prev.output}${prev.output.endsWith("\n") || !prev.output ? "" : "\n"}[error] ${msg}\n`
      }));
      setError(msg);
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

  async function loadCommitAgentContext(commitSha: string) {
    if (!commitSha) return;
    setSelectedExplain("");
    setAgentContextError("");
    try {
      const explainRes = await explainCommitShort(commitSha, repoPath);
      setSelectedExplain(explainRes.raw);
    } catch (e) {
      setSelectedExplain("");
      setAgentContextError(String(e));
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
      setMessage(`已选择分支: ${branchName}`);
    } catch (e) {
      setError(String(e));
      setMessage("加载分支失败");
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
        getCommitGraph(repoPath, 300),
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
    setOpencodeSessionFetchLimit(getRepoSessionFetchLimit(selectedRepo.id));
    void Promise.all([refreshStatus(), refreshBranchesAndCommits(), refreshReviewData(), refreshWorktreeData(), refreshGitUserIdentity()]).catch((e) => {
      setError(String(e));
      setMessage("仓库数据加载失败");
    });
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!repoPath) {
      void stopGitWorktreeWatcher().catch(() => {});
      return;
    }
    void startGitWorktreeWatcher(repoPath).catch((e) => setError(String(e)));
    return () => {
      if (gitAutoRefreshTimerRef.current !== null) {
        window.clearTimeout(gitAutoRefreshTimerRef.current);
        gitAutoRefreshTimerRef.current = null;
      }
    };
  }, [repoPath]);

  useEffect(() => {
    const scheduleRefresh = (delay = 600) => {
      if (gitAutoRefreshTimerRef.current !== null) {
        window.clearTimeout(gitAutoRefreshTimerRef.current);
      }
      gitAutoRefreshTimerRef.current = window.setTimeout(() => {
        gitAutoRefreshTimerRef.current = null;
        if (!repoPathRef.current) return;
        if (document.visibilityState === "hidden") return;
        if (gitAutoRefreshBlockedRef.current) return;
        void refreshWorktreeData(selectedWorktreeFileRef.current).catch((e) => setError(String(e)));
      }, delay);
    };

    const unlistenPromise = listen<{ repo_path: string }>("git-worktree-changed", (event) => {
      if (event.payload?.repo_path !== repoPathRef.current) return;
      scheduleRefresh();
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh(0);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (gitAutoRefreshTimerRef.current !== null) {
        window.clearTimeout(gitAutoRefreshTimerRef.current);
        gitAutoRefreshTimerRef.current = null;
      }
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      void stopGitWorktreeWatcher().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!selectedRepo?.id) return;
    setExpandedProjectIds((prev) => (prev.includes(selectedRepo.id) ? prev : [...prev, selectedRepo.id]));
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    const repoId = selectedRepo.id.trim();
    if (!repoId) return;
    const alreadyLoaded = Object.prototype.hasOwnProperty.call(sidebarOpencodeSessionsByRepo, repoId);
    if (alreadyLoaded) return;
    void refreshSidebarRepoSessions(selectedRepo).catch((e) => setError(String(e)));
  }, [runtimeStatus.opencode.installed, selectedRepo?.id, sidebarOpencodeSessionsByRepo]);

  useEffect(() => {
    if (!selectedCommit) return;
    void refreshCommitContext(selectedCommit);
  }, [selectedCommit]);

  useEffect(() => {
    if (!selectedCommit) return;
    // Find commit node by sha (supports new ID format commit:${branch}:${sha})
    const matched = topologyModel.nodes.find((node) => node.kind === "commit" && node.sha === selectedCommit);
    if (matched) setTopologySelectionId(matched.id);
  }, [selectedCommit, topologyModel]);

  useEffect(() => {
    if (topologyModel.nodes.length === 0) {
      setTopologySelectionId("");
      return;
    }
    if (topologySelectionId && topologyModel.nodeById[topologySelectionId]) {
      return;
    }
    setTopologySelectionId(topologyModel.primaryNodeId || topologyModel.nodes[0]?.id || "");
  }, [topologyModel, topologySelectionId]);

  useEffect(() => {
    setTopologyZoom(1);
  }, [selectedRepo?.id]);

  useEffect(() => {
    const viewport = topologyViewportRef.current;
    const node = topologyModel.nodeById[topologyModel.primaryNodeId];
    if (!viewport || !node) return;
    const nextLeft = Math.max(0, (node.x + node.width / 2) * topologyZoom - viewport.clientWidth / 2);
    const nextTop = Math.max(0, (node.y + node.height / 2) * topologyZoom - viewport.clientHeight / 2);
    viewport.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
  }, [selectedRepo?.id, topologyModel.primaryNodeId]);

  useEffect(() => {
    const onMove = (evt: MouseEvent) => {
      const state = topologyDragStateRef.current;
      const viewport = topologyViewportRef.current;
      if (!state || !viewport) return;
      viewport.scrollLeft = state.left - (evt.clientX - state.x);
      viewport.scrollTop = state.top - (evt.clientY - state.y);
    };
    const stop = () => {
      topologyDragStateRef.current = null;
      topologyViewportRef.current?.classList.remove("is-dragging");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };
  }, []);

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
    void refreshOpencodeSessions(getRepoSessionFetchLimit(selectedRepo.id)).catch((e) => setError(String(e)));
  }, [runtimeStatus.opencode.installed, selectedRepo?.id, repoPath, workspaceAgentBindings]);

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
    const key = `${OPENCODE_MODEL_ENABLE_KEY}:${selectedRepo?.id || "global"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setOpencodeEnabledModels(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as { enabled?: string[] } | null;
      const enabled = Array.isArray(parsed?.enabled) ? parsed!.enabled : [];
      const normalized = enabled.map((x) => normalizeModelRef(String(x || ""))).filter(Boolean);
      setOpencodeEnabledModels(new Set(normalized));
    } catch {
      setOpencodeEnabledModels(new Set());
    }
  }, [selectedRepo?.id]);

  useEffect(() => {
    const key = `${OPENCODE_MODEL_ENABLE_KEY}:${selectedRepo?.id || "global"}`;
    const enabled = Array.from(opencodeEnabledModels);
    try {
      window.localStorage.setItem(key, JSON.stringify({ enabled }));
    } catch {
      // ignore
    }
  }, [opencodeEnabledModels, selectedRepo?.id]);

  useEffect(() => {
    if (!controlAccessInfo?.port || !selectedRepo?.id) return;
    const payload = {
      repoId: selectedRepo.id,
      repoPath,
      enabledModels: Array.from(opencodeEnabledModels),
      hiddenModels: Array.from(opencodeHiddenModels),
      activeModel: activeOpencodeModel || opencodeConfig?.configuredModel || "",
      updatedAt: Date.now(),
    };
    const url = `http://127.0.0.1:${controlAccessInfo.port}/api/v1/admin/mobile/model-state`;
    const timer = window.setTimeout(() => {
      void fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    activeOpencodeModel,
    controlAccessInfo?.port,
    opencodeConfig?.configuredModel,
    opencodeEnabledModels,
    opencodeHiddenModels,
    repoPath,
    selectedRepo?.id,
  ]);

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
    // Keep previous list until refresh resolves to avoid open-time flicker.
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
    if (!selectedRepo?.path) {
      setTerminalTabs((prev) => prev.map((tab) => ({ ...tab, output: "", seq: 0, alive: false })));
      terminalSeqRef.current = Object.fromEntries(Object.keys(terminalSeqRef.current).map((id) => [id, 0]));
      return;
    }
    if (!activeTerminalTab) return;
    let stopped = false;
    const repo = selectedRepo.path;
    const tabId = activeTerminalTab.id;
    const boot = async () => {
      try {
        const snapshot = await startRepoTerminalSession(repo, tabId);
        if (stopped) return;
        terminalSeqRef.current[tabId] = snapshot.seq;
        updateTerminalTabById(tabId, {
          seq: snapshot.seq,
          alive: snapshot.alive,
          output: sanitizeTerminalOutput(snapshot.output || "")
        });
      } catch (e) {
        if (stopped) return;
        updateTerminalTabById(tabId, { alive: false });
        setError(String(e));
      }
    };
    const poll = async () => {
      try {
        const afterSeq = terminalSeqRef.current[tabId] ?? 0;
        const snapshot = await readRepoTerminalOutput(repo, afterSeq, tabId);
        if (stopped) return;
        terminalSeqRef.current[tabId] = snapshot.seq;
        if (snapshot.output) {
          const chunk = sanitizeTerminalOutput(snapshot.output);
          if (chunk) {
            updateTerminalTabById(tabId, (prev) => ({
              ...prev,
              seq: snapshot.seq,
              alive: snapshot.alive,
              output: `${prev.output}${chunk}`
            }));
          } else {
            updateTerminalTabById(tabId, { seq: snapshot.seq, alive: snapshot.alive });
          }
        } else {
          updateTerminalTabById(tabId, { seq: snapshot.seq, alive: snapshot.alive });
        }
      } catch {
        if (stopped) return;
        updateTerminalTabById(tabId, { alive: false });
      }
    };
    void boot();
    const t = window.setInterval(() => void poll(), 320);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [selectedRepo?.id, activeTerminalTabId]);

  useEffect(() => {
    const el = terminalLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeTerminalTab?.output]);

  useEffect(() => {
    if (rightPaneTab !== "terminal") return;
    const t = window.setTimeout(() => {
      terminalInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [rightPaneTab, rightDrawerOpen, activeTerminalTabId]);

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
    opencodeSessionsRepoIdRef.current = "";
    setTerminalTabs([
      {
        id: "terminal-1",
        title: "终端 1",
        input: "",
        output: "",
        seq: 0,
        alive: false,
        history: [],
        historyIndex: -1
      }
    ]);
    setActiveTerminalTabId("terminal-1");
    terminalTabCounterRef.current = 2;
    terminalSeqRef.current = { "terminal-1": 0 };
    setGitUserIdentity(EMPTY_GIT_IDENTITY);
  }, [selectedRepo?.id]);

  useEffect(() => {
    resizeOpencodeInput();
  }, [opencodePromptInput]);

  useEffect(() => {
    const sid = activeOpencodeSessionId;
    const sessionChanged = opencodePrevActiveSessionIdRef.current !== sid;
    if (sessionChanged) {
      opencodePrevActiveSessionIdRef.current = sid;
      opencodeLoadingOlderRef.current = false;
      opencodePrevScrollHeightRef.current = 0;
      opencodePendingAnchorSessionIdRef.current = sid;
      opencodeStickToBottomSessionRef.current = sid;
    }
    const session = opencodeSessions.find((s) => s.id === sid);
    if (session && !session.loaded && runtimeStatus.opencode.installed && selectedRepo) {
      void loadOpencodeSessionMessages(sid).catch((e) => setError(String(e)));
    }
    if (!sessionChanged) return;
    requestAnimationFrame(() => {
      const el = opencodeThreadRef.current;
      if (!el) return;
      el.scrollTop = 0;
    });
  }, [activeOpencodeSessionId, opencodeSessions, runtimeStatus.opencode.installed, selectedRepo?.id]);

  const opencodeVisibleWindow = useMemo(() => sliceOpencodeMessagesByTurnStart(opencodeMessages, opencodeTurnStart), [opencodeMessages, opencodeTurnStart]);

  const opencodeRenderedMessages = useMemo(() => {
    const visible = opencodeVisibleWindow.visible;
    const streamingId = activeOpencodeStreamingAssistantId;
    const running = activeOpencodeSessionBusy;
    return visible.filter((msg) => {
      if (msg.role !== "assistant") return true;
      if ((msg.content || "").trim()) return true;
      const detail = opencodeDetailsByMessageId[msg.id];
      const loading = opencodeDetailsLoadingByMessageId[msg.id];
      if (detail === undefined || loading) return true;
      return msg.id === streamingId && running;
    });
  }, [opencodeVisibleWindow.visible, activeOpencodeStreamingAssistantId, activeOpencodeSessionBusy, opencodeDetailsByMessageId, opencodeDetailsLoadingByMessageId]);

  const opencodeActiveTodos = useMemo(() => {
    const visible = opencodeVisibleWindow.visible;
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const msg = visible[i];
      if (msg.role !== "assistant") continue;
      const serverMid = (opencodeServerMessageIdByLocalId[msg.id] || "").trim();
      const detail = opencodeDetailsByMessageId[msg.id] || null;
      const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as OpencodeDetailedPart[]) : [];
      const liveParts = serverMid ? (opencodeLivePartsByServerMessageId[serverMid] || []) : [];
      const detailParts = liveParts.length > 0 ? liveParts : fetchedParts;
      for (let j = detailParts.length - 1; j >= 0; j -= 1) {
        const todos = readOpencodeTodosFromPart(detailParts[j]);
        if (todos.length > 0) return todos;
      }
    }
    return [] as OpencodeTodoItem[];
  }, [opencodeVisibleWindow.visible, opencodeServerMessageIdByLocalId, opencodeDetailsByMessageId, opencodeLivePartsByServerMessageId]);

  const opencodeActiveQuestions = useMemo(() => {
    const dismissed = new Set(opencodeDismissedQuestionsBySession[activeOpencodeSessionId] || []);
    return opencodeQuestionRequests.filter(
      (req) => req.sessionID === activeOpencodeSessionId && !dismissed.has(req.id)
    );
  }, [opencodeQuestionRequests, activeOpencodeSessionId, opencodeDismissedQuestionsBySession]);

  const opencodeStaleQuestions = useMemo(() => {
    if (opencodeActiveQuestions.length > 0) return [] as QuestionRequest[];
    const visible = opencodeVisibleWindow.visible;
    const requests: QuestionRequest[] = [];
    const seenIds = new Set<string>();
    const dismissed = new Set(opencodeDismissedQuestionsBySession[activeOpencodeSessionId] || []);
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const msg = visible[i];
      if (msg.role !== "assistant") continue;
      const serverMid = (opencodeServerMessageIdByLocalId[msg.id] || "").trim();
      const detail = opencodeDetailsByMessageId[msg.id] || null;
      const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as OpencodeDetailedPart[]) : [];
      const liveParts = serverMid ? (opencodeLivePartsByServerMessageId[serverMid] || []) : [];
      const detailParts = liveParts.length > 0 ? liveParts : fetchedParts;
      for (let j = detailParts.length - 1; j >= 0; j -= 1) {
        const part = detailParts[j] as any;
        if (String(part?.type || "").trim() !== "tool") continue;
        if (String(part?.tool || "").trim() !== "question") continue;
        const state = part?.state || {};
        const status = String(state?.status || "").trim().toLowerCase();
        if (status !== "pending" && status !== "running") continue;
        const questions = state?.input?.questions;
        if (!Array.isArray(questions) || questions.length === 0) continue;
        const id = `stale-question-${msg.id}-${String(part?.id || j)}`;
        if (seenIds.has(id) || dismissed.has(id)) continue;
        seenIds.add(id);
        requests.push({
          id,
          sessionID: activeOpencodeSessionId,
          questions: questions.map((q: any) => ({
            question: String(q?.question || "").trim(),
            header: String(q?.header || "").trim() || undefined,
            options: Array.isArray(q?.options)
              ? q.options
                  .map((opt: any) => ({
                    label: String(opt?.label || "").trim(),
                    description: String(opt?.description || "").trim() || undefined,
                  }))
                  .filter((opt: any) => opt.label)
              : [],
            multiple: q?.multiple === true,
            custom: q?.custom !== false,
          })),
        });
      }
    }
    return requests;
  }, [opencodeActiveQuestions.length, opencodeVisibleWindow.visible, opencodeServerMessageIdByLocalId, opencodeDetailsByMessageId, opencodeLivePartsByServerMessageId, activeOpencodeSessionId, opencodeDismissedQuestionsBySession]);

  const opencodeTodoProgress = useMemo(() => {
    const total = opencodeActiveTodos.length;
    const done = opencodeActiveTodos.filter((todo) => todo.status === "completed").length;
    const finished = total > 0 && opencodeActiveTodos.every((todo) => todo.status === "completed" || todo.status === "cancelled");
    const active =
      opencodeActiveTodos.find((todo) => todo.status === "in_progress") ||
      opencodeActiveTodos.find((todo) => todo.status === "pending") ||
      opencodeActiveTodos[opencodeActiveTodos.length - 1] ||
      null;
    return { total, done, finished, active };
  }, [opencodeActiveTodos]);

  useEffect(() => {
    if (opencodeActiveTodos.length === 0) {
      setOpencodeTodoDockVisible(false);
      setOpencodeTodoDockCollapsed(false);
      return;
    }
    if (activeOpencodeSessionBusy) {
      setOpencodeTodoDockVisible(true);
      setOpencodeTodoDockCollapsed(false);
      return;
    }
    setOpencodeTodoDockVisible(true);
    setOpencodeTodoDockCollapsed(true);
  }, [opencodeActiveTodos, activeOpencodeSessionBusy]);

  useEffect(() => {
    setOpencodeTodoDockCollapsed(false);
    setOpencodeTodoDockVisible(false);
    setOpencodeQuestionRequests([]);
    setOpencodeQuestionLoading(true);
  }, [activeOpencodeSessionId]);

  useEffect(() => {
    if (!activeOpencodeSessionId || !runtimeStatus.opencode.installed || !selectedRepo) return;
    void refreshPendingQuestions(activeOpencodeSessionId);
    if (!activeOpencodeSessionBusy) return;
    const timer = window.setInterval(() => {
      void refreshPendingQuestions(activeOpencodeSessionId);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeOpencodeSessionId, activeOpencodeSessionBusy, runtimeStatus.opencode.installed, selectedRepo?.id]);

  useEffect(() => {
    const dirPaths = collectWorktreeDirPaths(worktreeTree);
    setExpandedWorktreeDirs((prev) => {
      if (dirPaths.length === 0) return [];
      const next = new Set(prev.filter((path) => dirPaths.includes(path)));
      dirPaths.forEach((path) => {
        if (!prev.includes(path)) next.add(path);
      });
      return Array.from(next);
    });
  }, [worktreeTree]);

  useEffect(() => {
    const sid = activeOpencodeSessionId.trim();
    if (!sid) return;
    for (const msg of opencodeVisibleWindow.visible) {
      if (msg.role !== "assistant") continue;
      if (opencodeDetailsByMessageId[msg.id] !== undefined) continue;
      if (opencodeDetailsLoadingByMessageId[msg.id]) continue;
      void loadOpencodeMessageDetails(sid, msg.id, 80);
    }
  }, [activeOpencodeSessionId, opencodeVisibleWindow.visible, opencodeDetailsByMessageId, opencodeDetailsLoadingByMessageId]);

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

  const opencodeHasHiddenHistory = opencodeTurnStart > 0;

  useEffect(() => {
    const sid = activeOpencodeSessionId.trim();
    if (!sid) return;
    if (opencodePendingAnchorSessionIdRef.current !== sid) return;
    if (!activeOpencodeSession?.loaded || opencodeMessages.length <= 0) return;
    const el = opencodeThreadRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const current = opencodeThreadRef.current;
      if (!current) return;
      current.scrollTop = Math.max(0, current.scrollHeight - current.clientHeight);
      opencodePendingAnchorSessionIdRef.current = "";
    });
  }, [activeOpencodeSessionId, activeOpencodeSession?.loaded, opencodeMessages.length]);

  useEffect(() => {
    const sid = activeOpencodeSessionId.trim();
    if (!sid) return;
    if (opencodeStickToBottomSessionRef.current !== sid) return;
    if (opencodeSessionLoading) return;
    const el = opencodeThreadRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      const current = opencodeThreadRef.current;
      if (!current) return;
      current.scrollTop = Math.max(0, current.scrollHeight - current.clientHeight);
    });
  }, [activeOpencodeSessionId, opencodeSessionLoading, opencodeRenderedMessages.length, opencodeDetailsByMessageId, opencodeDetailsLoadingByMessageId]);

  function loadOlderOpencodeHistory() {
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (opencodeLoadingOlderRef.current) return;
    opencodeLoadingOlderRef.current = true;
    opencodePrevScrollHeightRef.current = el.scrollHeight;
    if (opencodeHasHiddenHistory) {
      updateActiveOpencodeSession((s) => ({
        ...s,
        turnStart: Math.max(0, s.turnStart - OPENCODE_PAGE_SIZE)
      }));
      return;
    }
    const session = activeOpencodeSession;
    if (session?.hasMore) {
      void loadMoreOpencodeSessionMessages(session.id);
    } else {
      opencodeLoadingOlderRef.current = false;
      opencodePrevScrollHeightRef.current = 0;
    }
  }

  function onOpencodeThreadScroll() {
    const el = opencodeThreadRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const nearBottom = maxScroll - el.scrollTop <= 24;
    if (nearBottom) {
      opencodeStickToBottomSessionRef.current = activeOpencodeSessionId;
    } else {
      opencodeStickToBottomSessionRef.current = "";
    }
    if (maxScroll <= 0) return;
    const topProgress = el.scrollTop / maxScroll;
    const shouldPrefetch = topProgress <= OPENCODE_TOP_PREFETCH_RATIO;
    if (shouldPrefetch && !opencodeHasHiddenHistory) {
      prefetchNextOpencodeHistoryPage(activeOpencodeSession);
    }
    const shouldLoadNow = topProgress <= OPENCODE_TOP_LOAD_RATIO;
    if (!shouldLoadNow) return;
    if (opencodeHasHiddenHistory) {
      loadOlderOpencodeHistory();
    } else if (activeOpencodeSession?.hasMore) {
      loadOlderOpencodeHistory();
    }
  }

  function onOpencodeThreadWheel(event: React.WheelEvent<HTMLDivElement>) {
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (event.deltaY >= 0) return;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScroll <= 0) return;
    const topProgress = el.scrollTop / maxScroll;
    if (topProgress <= OPENCODE_TOP_PREFETCH_RATIO && !opencodeHasHiddenHistory) {
      prefetchNextOpencodeHistoryPage(activeOpencodeSession);
    }
    if (topProgress <= OPENCODE_TOP_LOAD_RATIO && (opencodeHasHiddenHistory || activeOpencodeSession?.hasMore)) {
      loadOlderOpencodeHistory();
    }
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
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 0) return;
      const topProgress = el.scrollTop / maxScroll;
      if (topProgress <= OPENCODE_TOP_LOAD_RATIO && (opencodeHasHiddenHistory || activeOpencodeSession?.hasMore)) {
        loadOlderOpencodeHistory();
      }
    });
  }, [opencodeTurnStart, opencodeMessages.length, opencodeHasHiddenHistory, activeOpencodeSession?.hasMore]);

  useEffect(() => {
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (opencodeSessionLoading) return;
    if (opencodeLoadingOlderRef.current) return;
    if (!opencodeHasHiddenHistory) return;
    if (el.scrollHeight > el.clientHeight + 1) return;
    updateActiveOpencodeSession((s) => ({
      ...s,
      turnStart: Math.max(0, s.turnStart - OPENCODE_PAGE_SIZE)
    }));
  }, [opencodeSessionLoading, opencodeHasHiddenHistory, opencodeTurnStart, opencodeMessages.length, opencodeRenderedMessages.length]);

  useEffect(() => {
    if (!repoContextMenu && !commitContextMenu && !topologyContextMenu) return;
    const dismiss = () => {
      setRepoContextMenu(null);
      setCommitContextMenu(null);
      setTopologyContextMenu(null);
    };
    window.addEventListener("click", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
    };
  }, [repoContextMenu, commitContextMenu, topologyContextMenu]);

  useEffect(() => {
    if (!showCommitActionMenu) return;
    const dismiss = () => setShowCommitActionMenu(false);
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, [showCommitActionMenu]);

  useEffect(() => {
    if (!showTopologyCreateDialog) return;
    const sourceId = topologyCreateSourceNodeId || topologySelectionId || topologyModel.primaryNodeId;
    if (!sourceId) return;
    setTopologyCreateSourceNodeId(sourceId);
  }, [showTopologyCreateDialog, topologyCreateSourceNodeId, topologySelectionId, topologyModel.primaryNodeId]);

  useEffect(() => {
    const onNativeContextMenu = (evt: MouseEvent) => {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const topologyNode = target.closest(".gt-topology-node[data-node-id]") as HTMLElement | null;
      if (topologyNode) {
        const nodeId = topologyNode.dataset.nodeId;
        if (!nodeId) return;
        evt.preventDefault();
        evt.stopPropagation();
        setTopologySelectionId(nodeId);
        openTopologyContextMenu(evt.clientX, evt.clientY, nodeId);
        return;
      }
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
          const expanded = expandedProjectIds.includes(repo.id);
          const repoSessions = getVisibleRepoSessions(repo.id);
          const repoHasMoreSessions = hasMoreRepoSessions(repo.id);
          const repoSessionsLoading = isRepoSessionsLoading(repo.id);
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
                  className="gt-tree-label"
                  onClick={() => {
                    if (busy) return;
                    toggleRepoSessions(repo);
                  }}
                >
                  {repo.name}
                  <span className={expanded ? "gt-tree-chevron is-open" : "gt-tree-chevron"} aria-hidden="true" />
                </button>
                <button
                  className="gt-tree-toggle"
                  aria-label={expanded ? "收起项目" : "展开项目"}
                  onClick={() => toggleRepoSessions(repo)}
                >
                  <span className="gt-tree-toggle-hit" aria-hidden="true" />
                </button>
              </div>

              {expanded ? (
                <div className="gt-tree-children">
                  {draftOpencodeSession && repo.id === selectedRepo?.id ? (
                    <button className="gt-session-item active gt-session-item-draft" onClick={() => opencodeInputRef.current?.focus()}>
                      <span className="gt-session-title">New Session</span>
                      <span className="gt-session-meta">待输入，发送第一条消息后创建</span>
                    </button>
                  ) : null}
                  {!runtimeStatus.opencode.installed ? <div className="gt-empty-hint">安装 `opencode` 后可用会话。</div> : null}
                  {runtimeStatus.opencode.installed && repoSessionsLoading && repoSessions.length === 0 ? (
                    <div className="gt-tree-loading" aria-hidden="true">
                      <span className="gt-tree-loading-row" />
                      <span className="gt-tree-loading-row" />
                      <span className="gt-tree-loading-row short" />
                    </div>
                  ) : null}
                  {runtimeStatus.opencode.installed && !repoSessionsLoading && repoSessions.length === 0 ? (
                    <div className="gt-empty-hint gt-tree-empty">当前项目还没有会话。</div>
                  ) : null}
                  {runtimeStatus.opencode.installed
                    ? repoSessions.map((session) => (
                      <button
                        key={`left-session-${session.id}`}
                        className={session.id === activeOpencodeSessionId ? "gt-session-item active" : "gt-session-item"}
                        onClick={() => {
                          pendingSidebarSessionSelectionRef.current = { repoId: repo.id, sessionId: session.id };
                          setOpencodeSessions((prev) => {
                            const hit = prev.findIndex((s) => s.id === session.id);
                            if (hit >= 0) {
                              return prev.map((s) =>
                                s.id === session.id
                                  ? {
                                    ...s,
                                    title: session.title,
                                    createdAt: session.createdAt,
                                    updatedAt: session.updatedAt,
                                    loaded: s.loaded
                                  }
                                  : s
                              );
                            }
                            return [
                              {
                                ...opencodeSessionFromSummary(session),
                                loaded: false
                              },
                              ...prev
                            ];
                          });
                          setOpencodeSessionFetchLimit(getRepoSessionFetchLimit(repo.id));
                          setSelectedRepo(repo);
                          setDraftOpencodeSession(false);
                          setActiveOpencodeSessionId(session.id);
                          bindOpencodeSessionToWorkspace(session.id, repo.path, repo.name);
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
                  {runtimeStatus.opencode.installed && repoHasMoreSessions ? (
                    <button className="gt-load-more-btn" onClick={() => void loadMoreSidebarRepoSessions(repo)} disabled={repoSessionsLoading}>
                      <span className="gt-load-more-icon" aria-hidden="true">…</span>
                      <span>{repoSessionsLoading ? "Loading…" : "More"}</span>
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
      <div className={opencodeMessages.length === 0 && !opencodeSessionLoading ? "opencode-main gt-chat-main is-empty" : "opencode-main gt-chat-main"}>
        <div className="opencode-thread" ref={opencodeThreadRef} onScroll={onOpencodeThreadScroll} onWheel={onOpencodeThreadWheel}>
          <div className="gt-chat-stream">
            {opencodeSessionLoading ? (
              <div className="opencode-session-loading small muted">加载会话中…</div>
            ) : opencodeMessages.length === 0 ? null : (
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
            {opencodeTodoDockVisible && opencodeActiveTodos.length > 0 ? (
              <div className="gt-opencode-todo-dock">
                <button
                  type="button"
                  className="gt-opencode-todo-dock-head"
                  onClick={() => setOpencodeTodoDockCollapsed((prev) => !prev)}
                  aria-expanded={!opencodeTodoDockCollapsed}
                >
                  <span className="gt-opencode-todo-dock-progress">
                    已完成 {opencodeTodoProgress.done} 个任务（共 {opencodeTodoProgress.total} 个）
                  </span>
                  <span className="gt-opencode-todo-dock-preview">
                    {opencodeTodoDockCollapsed ? opencodeTodoProgress.active?.content || "" : ""}
                  </span>
                  <span className={opencodeTodoDockCollapsed ? "gt-opencode-todo-dock-chevron is-collapsed" : "gt-opencode-todo-dock-chevron"} aria-hidden="true">
                    <span />
                    <span />
                  </span>
                </button>
                {!opencodeTodoDockCollapsed ? (
                  <div className="gt-opencode-todo-dock-list">
                    {opencodeActiveTodos.map((todo) => (
                      <div key={todo.id} className={`gt-opencode-todo-item is-${todo.status}`}>
                        <span className="gt-opencode-todo-item-check" aria-hidden="true">
                          {todo.status === "completed" ? (
                            "✓"
                          ) : todo.status === "in_progress" ? (
                            <span className="gt-opencode-todo-thinking">
                              <span />
                              <span />
                              <span />
                            </span>
                          ) : (
                            ""
                          )}
                        </span>
                        <span className="gt-opencode-todo-item-content">{todo.content}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {opencodeActiveQuestions.length > 0 && opencodeActiveQuestions.map((req) => (
              <QuestionDock
                key={req.id}
                request={req}
                onReply={(requestId, answers) => {
                  void sendQuestionReply(requestId, answers).then((ok) => {
                    if (ok) setOpencodeDismissedQuestionsBySession((prev) => ({
                      ...prev,
                      [activeOpencodeSessionId]: Array.from(new Set([...(prev[activeOpencodeSessionId] || []), requestId])),
                    }));
                  });
                }}
                onDismiss={(requestId) => {
                  void sendQuestionReject(requestId).then((ok) => {
                    if (ok) setOpencodeDismissedQuestionsBySession((prev) => ({
                      ...prev,
                      [activeOpencodeSessionId]: Array.from(new Set([...(prev[activeOpencodeSessionId] || []), requestId])),
                    }));
                  });
                }}
              />
            ))}
            {!opencodeQuestionLoading && opencodeActiveQuestions.length === 0 && opencodeStaleQuestions.map((req) => (
              <QuestionDock
                key={req.id}
                request={req}
                disabledReason="该问题已失效，无法提交；请重新发起本轮请求"
                onReply={() => {}}
                onDismiss={(requestId) => {
                  setOpencodeDismissedQuestionsBySession((prev) => ({
                    ...prev,
                    [activeOpencodeSessionId]: Array.from(new Set([...(prev[activeOpencodeSessionId] || []), requestId])),
                  }));
                }}
              />
            ))}
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
                    className="opencode-model-trigger opencode-composer-model"
                    aria-haspopup="listbox"
                    aria-expanded={showOpencodeModelPicker}
                    onClick={() => {
                      const next = !showOpencodeModelPicker;
                      setShowOpencodeModelPicker(next);
                    }}
                  >
                    {(() => {
                      const display = getOpencodeModelDisplay(activeOpencodeModel || "");
                      return (
                        <span className="opencode-model-trigger-copy">
                          <span className="opencode-model-trigger-title">{display.label || "Auto"}</span>
                        </span>
                      );
                    })()}
                  </button>
                  {showOpencodeModelPicker ? (
                    <div className="opencode-model-picker">
                      <div className="opencode-model-picker-head">
                        <div className="opencode-model-picker-kicker">model</div>
                        <input
                          className="path-input opencode-model-search"
                          placeholder="搜索模型或提供商"
                          value={opencodeModelPickerSearch}
                          onChange={(e) => setOpencodeModelPickerSearch(e.target.value)}
                        />
                      </div>
                      <div className="opencode-model-list-col">
                        {opencodeConfiguredModelCandidates.length === 0 ? (
                          <div className="opencode-model-empty">
                            <strong>暂无已配置模型</strong>
                            <span>连接提供商或添加自定义模型后，这里会显示可用项。</span>
                          </div>
                        ) : (
                          opencodeConfiguredModelCandidates.map((m) => (
                            <button
                              type="button"
                              key={`saved-model-${m}`}
                              className={m === activeOpencodeModel ? "opencode-model-option selected" : "opencode-model-option"}
                              onClick={() => {
                                void applyOpencodeModel(m);
                                setShowOpencodeModelPicker(false);
                              }}
                              title={m}
                            >
                              {(() => {
                                const display = getOpencodeModelDisplay(m);
                                return (
                                  <>
                                    <span className="opencode-model-option-copy">
                                      <span className="opencode-model-option-title">{display.label || m}</span>
                                      <span className="opencode-model-option-meta">
                                        <span className="opencode-model-option-provider">{display.provider || "Provider"}</span>
                                      </span>
                                    </span>
                                    {m === activeOpencodeModel ? <span className="opencode-model-option-check">✓</span> : null}
                                  </>
                                );
                              })()}
                            </button>
                          ))
                        )}
                      </div>
                      <div className="opencode-model-picker-foot">
                        <button type="button" className="opencode-model-picker-config" onClick={() => {
                          setShowOpencodeProviderPicker(true);
                          setOpencodeProviderPickerSearch("");
                          setOpencodeProviderPickerProvider(opencodeModelProvider);
                          setOpencodeProviderPickerModelSearch("");
                          setShowOpencodeModelPicker(false);
                        }}>
                          <span>配置模型与提供商</span>
                          <span className="opencode-model-picker-config-tail">⌘</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  className={activeOpencodeSessionBusy ? "opencode-run-btn opencode-composer-send opencode-stop-btn" : "opencode-run-btn opencode-composer-send"}
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
          <div className="gt-worktree-topology-shell">
            <div className="gt-gittree-panel">
              {(() => {
                const worktreeOnlyBranches = new Set(
                  linkedWorktrees
                    .filter((wt) => !wt.isMainWorktree && branchParentMap[wt.branch])
                    .map((wt) => wt.branch)
                );
                const allBranchNames = new Set<string>();
                const isGitTreeBranch = (name: string) => {
                  const normalized = name.trim().toLowerCase();
                  return normalized.length > 0 && !normalized.includes("worktree") && !normalized.includes(".worktrees");
                };

                branches.forEach((b) => {
                  if (isGitTreeBranch(b.name) && !worktreeOnlyBranches.has(b.name)) {
                    allBranchNames.add(b.name);
                  }
                });
                Object.keys(branchParentMap).forEach((b) => {
                  if (isGitTreeBranch(b) && !worktreeOnlyBranches.has(b)) {
                    allBranchNames.add(b);
                  }
                });
                Object.values(branchParentMap).forEach((b) => {
                  if (isGitTreeBranch(b)) {
                    allBranchNames.add(b);
                  }
                });

                const defaultMain = Array.from(allBranchNames).find((b) => b === "main" || b === "master") || "";
                const effectiveParentMap: Record<string, string> = {};
                Object.entries(branchParentMap).forEach(([child, parent]) => {
                  if (allBranchNames.has(child) && allBranchNames.has(parent)) {
                    effectiveParentMap[child] = parent;
                  }
                });

                const branchHeadByName = new Map<string, string>();
                const shaToParents = new Map<string, string[]>();
                commitGraph.forEach((node) => {
                  if (node.isConnector || !node.sha) return;
                  shaToParents.set(node.sha, node.parents || []);
                  const refsText = node.refs.trim();
                  if (!refsText) return;
                  const inner = refsText.startsWith("(") && refsText.endsWith(")") ? refsText.slice(1, -1) : refsText;
                  const refs = inner.split(",").map((p) => p.trim()).filter(Boolean);

                  refs.forEach((ref) => {
                    if (ref.startsWith("tag:")) return;
                    let branchName: string | null = null;
                    if (ref.includes("->")) {
                      const rhs = ref.split("->")[1]?.trim();
                      if (rhs && allBranchNames.has(rhs)) branchName = rhs;
                    } else if (allBranchNames.has(ref)) {
                      branchName = ref;
                    }
                    if (branchName && !branchHeadByName.has(branchName)) {
                      branchHeadByName.set(branchName, node.sha);
                    }
                  });
                });

                function ancestorDistance(targetSha: string, querySha: string): number {
                  const queue: Array<{ sha: string; dist: number }> = [{ sha: querySha, dist: 0 }];
                  const visited = new Set<string>();
                  while (queue.length > 0) {
                    const { sha, dist } = queue.shift()!;
                    if (sha === targetSha) return dist;
                    if (visited.has(sha)) continue;
                    visited.add(sha);
                    const parents = shaToParents.get(sha) || [];
                    for (const p of parents) {
                      if (!visited.has(p)) {
                        queue.push({ sha: p, dist: dist + 1 });
                      }
                    }
                  }
                  return Infinity;
                }

                const branchNames = Array.from(allBranchNames);
                const actualCurrentBranchName = branches.find((item) => item.isCurrent)?.name || (worktreeOverview.branch && worktreeOverview.branch !== "HEAD" && worktreeOverview.branch !== "(detached)" ? worktreeOverview.branch : "");
                const currentBranchName = actualCurrentBranchName;
                const sortBranches = (items: string[]) => items.sort((a, b) => {
                  if (a === defaultMain) return -1;
                  if (b === defaultMain) return 1;
                  return a.localeCompare(b);
                });

                branchNames.forEach((branch) => {
                  if (effectiveParentMap[branch]) return;
                  if (branch === defaultMain) return;

                  const branchSha = branchHeadByName.get(branch);
                  if (!branchSha) return;

                  const candidates: Array<{ name: string; distance: number }> = [];
                  branchNames.forEach((candidate) => {
                    if (candidate === branch) return;
                    const candidateSha = branchHeadByName.get(candidate);
                    if (!candidateSha) return;
                    
                    const dist = ancestorDistance(candidateSha, branchSha);
                    if (dist < Infinity && dist > 0) {
                      candidates.push({ name: candidate, distance: dist });
                    }
                  });

                  if (candidates.length > 0) {
                    candidates.sort((a, b) => a.distance - b.distance);
                    effectiveParentMap[branch] = candidates[0].name;
                  } else if (defaultMain) {
                    const prefix = branch.split("/")[0]?.toLowerCase() || "";
                    const developBranch = branchNames.find((b) => b === "develop" || b === "dev");
                    const isFeatureLike = ["feature", "hotfix", "fix", "release", "chore", "docs", "test", "refactor", "style"].includes(prefix);

                    if (branch === "develop" || branch === "dev") {
                      effectiveParentMap[branch] = defaultMain;
                    } else if (isFeatureLike && developBranch) {
                      effectiveParentMap[branch] = developBranch;
                    } else {
                      effectiveParentMap[branch] = defaultMain;
                    }
                  }
                });

                const rootBranches: string[] = [];
                allBranchNames.forEach((branch) => {
                  const parent = effectiveParentMap[branch];
                  if (!parent || !allBranchNames.has(parent)) {
                    rootBranches.push(branch);
                  }
                });

                if (rootBranches.length === 0 && allBranchNames.size > 0) {
                  rootBranches.push(Array.from(allBranchNames)[0]);
                }
                sortBranches(rootBranches);

                const childrenByParent = new Map<string, string[]>();
                branchNames.forEach((branch) => {
                  const parent = effectiveParentMap[branch];
                  if (!parent || !allBranchNames.has(parent)) return;
                  const list = childrenByParent.get(parent) || [];
                  list.push(branch);
                  childrenByParent.set(parent, list);
                });
                childrenByParent.forEach((list) => sortBranches(list));

                const graphCommitBySha = new Map<string, GitGraphNode>();
                commitGraph.forEach((node) => {
                  if (!node.isConnector && node.sha) graphCommitBySha.set(node.sha, node);
                });

                const commitsFromGraph = (branchName: string, limit = 40): GitCommitSummary[] => {
                  const head = branchHeadByName.get(branchName);
                  if (!head || !graphCommitBySha.has(head)) return [];
                  const rows: GitCommitSummary[] = [];
                  const visited = new Set<string>();
                  let cursor = head;
                  while (cursor && graphCommitBySha.has(cursor) && rows.length < limit) {
                    if (visited.has(cursor)) break;
                    visited.add(cursor);
                    const row = graphCommitBySha.get(cursor)!;
                    rows.push({ sha: row.sha, subject: row.subject, author: row.author, date: row.date });
                    cursor = row.parents[0] || "";
                  }
                  return rows;
                };

                const selectedTreeBranch = topologySelectionId.startsWith("worktree:")
                  ? worktreeParentMap[normalizeWorkspacePath(topologySelectionId.slice(9))] || selectedBranch || actualCurrentBranchName || defaultMain || rootBranches[0] || ""
                  : topologySelectionId.startsWith("branch:")
                  ? topologySelectionId.slice(7)
                  : selectedBranch || actualCurrentBranchName || defaultMain || rootBranches[0] || "";
                const activeTreeBranch = allBranchNames.has(selectedTreeBranch) ? selectedTreeBranch : defaultMain || rootBranches[0] || "";
                const activeBranchSummary = branches.find((branch) => branch.name === activeTreeBranch);
                const activeTone = branchTone(activeTreeBranch);
                const activeBranchCommits = activeTreeBranch === selectedBranch || activeTreeBranch === currentBranchName
                  ? commits
                  : commitsFromGraph(activeTreeBranch);
                const selectedTreeCommit = topologySelectionId.startsWith("commit:")
                  ? activeBranchCommits.find((commit) => commit.sha === selectedCommit) || null
                  : null;
                const worktreeParentBranch = (wt: GitLinkedWorktree) => {
                  const pathParent = worktreeParentMap[normalizeWorkspacePath(wt.path)] || "";
                  if (pathParent) return pathParent;
                  return wt.branch;
                };
                const branchWorktrees = (branchName: string) => linkedWorktrees.filter((wt) => !wt.isMainWorktree && worktreeParentBranch(wt) === branchName);
                const activeBranchWorktrees = branchWorktrees(activeTreeBranch);
                const activeBranchIsCurrent = activeBranchSummary?.isCurrent || worktreeOverview.branch === activeTreeBranch;

                const branchCommitCount = (branchName: string) => {
                  if (branchName === selectedBranch || branchName === currentBranchName) return commits.length;
                  return commitsFromGraph(branchName, 20).length;
                };

                const selectBranchFromTree = (branchName: string) => {
                  setTopologySelectionId(`branch:${branchName}`);
                  void chooseBranch(branchName);
                };

                const renderBranchRow = (branchName: string, depth = 0): ReactNode => {
                  const childBranches = childrenByParent.get(branchName) || [];
                  const childWorktrees = branchWorktrees(branchName);
                  const treeKey = `tree:${branchName}`;
                  const collapsed = collapsedBranchIds.has(treeKey);
                  const tone = branchTone(branchName);
                  const branchInfo = branches.find((b) => b.name === branchName);
                  const isCurrent = branchName === currentBranchName || !!branchInfo?.isCurrent;
                  const isRemote = !!branchInfo?.isRemote;
                  const isActive = branchName === activeTreeBranch;
                  const displayName = isRemote && branchName.includes("/") ? branchName.split("/").slice(1).join("/") : branchName;
                  return (
                    <Fragment key={branchName}>
                      <div
                        className={isActive ? "gt-gittree-branch active" : isRemote ? "gt-gittree-branch is-remote" : "gt-gittree-branch"}
                        style={{ paddingLeft: 10 + depth * 18 }}
                        onClick={() => selectBranchFromTree(branchName)}
                        onDoubleClick={() => !isRemote && void checkoutBranchFromTopology(branchName)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setTopologyContextMenu({ x: e.clientX, y: e.clientY, nodeId: `branch:${branchName}` });
                        }}
                      >
                        <button
                          type="button"
                          className={childBranches.length > 0 ? "gt-gittree-disclosure" : "gt-gittree-disclosure empty"}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (childBranches.length === 0) return;
                            setCollapsedBranchIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(treeKey)) next.delete(treeKey);
                              else next.add(treeKey);
                              return next;
                            });
                          }}
                          aria-label={collapsed ? "展开分支" : "收起分支"}
                        >
                          {childBranches.length > 0 ? (collapsed ? "▸" : "▾") : ""}
                        </button>
                        <span className="gt-gittree-dot" style={{ background: tone.accent }} />
                        <span className="gt-gittree-name" title={branchName}>{displayName}</span>
                        {isCurrent ? <span className="gt-gittree-badge">CURRENT</span> : null}
                        {isRemote ? <span className="gt-gittree-badge is-remote">REMOTE</span> : null}
                        <span className="gt-gittree-count">{branchCommitCount(branchName) || "-"}</span>
                      </div>
                      {!collapsed ? childBranches.map((child) => renderBranchRow(child, depth + 1)) : null}
                    </Fragment>
                  );
                };

                return (
                  <>
                    <div className="gt-gittree-sidebar">
                      <div className="gt-gittree-head">
                        <div>
                          <span className="gt-gittree-kicker">GitTree</span>
                          <strong>{selectedRepo?.name || "Repository"}</strong>
                        </div>
                        <button className="chip" onClick={() => void refreshScm()} disabled={busy}>Refresh</button>
                      </div>
                      <div className="gt-gittree-summary">
                        <span>{branchNames.length} branches</span>
                        <span>{currentBranchName || "no branch"}</span>
                      </div>
                      <div className="gt-gittree-branch-list">
                        {rootBranches.length > 0 ? rootBranches.map((branch) => renderBranchRow(branch)) : (
                          <div className="gt-empty-hint">暂无本地分支。</div>
                        )}
                      </div>
                      <div className="gt-gittree-commit-toolbar">
                        <span>Commits</span>
                        <span>{activeBranchCommits.length > 0 ? `${activeBranchCommits.length} loaded` : "No commit loaded"}</span>
                      </div>
                      <div className="gt-gittree-commit-list">
                        {activeBranchCommits.length > 0 ? activeBranchCommits.map((commit, index) => (
                          <button
                            key={`${activeTreeBranch}:${commit.sha}`}
                            className={selectedCommit === commit.sha ? "gt-gittree-commit selected" : "gt-gittree-commit"}
                            onClick={() => {
                              setSelectedCommit(commit.sha);
                              setTopologySelectionId(`commit:${activeTreeBranch}:${commit.sha}`);
                            }}
                            onDoubleClick={() => {
                              setSelectedCommit(commit.sha);
                              setDetailTab("context");
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setCommitContextMenu({ x: e.clientX, y: e.clientY, sha: commit.sha, branch: activeTreeBranch, subject: commit.subject });
                            }}
                          >
                            <span className="gt-gittree-commit-index">{index === 0 ? "HEAD" : index + 1}</span>
                            <span className="gt-gittree-commit-dot" style={{ background: activeTone.accent }} />
                            <span className="gt-gittree-commit-main">
                              <strong>{commit.subject || "(no subject)"}</strong>
                              <span>{shortSha(commit.sha, 7)} · {commit.author || "unknown"} · {commit.date || "unknown date"}</span>
                            </span>
                          </button>
                        )) : (
                          <div className="gt-gittree-empty">
                            <strong>没有可展示的提交</strong>
                            <span>点击左侧分支会加载该分支提交；若仍为空，请刷新 Git 数据。</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="gt-gittree-detail">
                      <div className="gt-gittree-detail-head">
                        <div className="gt-gittree-selected-title">
                          <span className="gt-gittree-dot large" style={{ background: activeTone.accent }} />
                          <div>
                            <strong>{selectedTreeCommit ? selectedTreeCommit.subject || "(no subject)" : activeTreeBranch || "未选择分支"}</strong>
                            <span>{selectedTreeCommit ? `${shortSha(selectedTreeCommit.sha, 8)} · ${activeTreeBranch}` : activeBranchIsCurrent ? "CURRENT" : branchHeadByName.get(activeTreeBranch)?.slice(0, 7) || "no head in graph"}</span>
                          </div>
                        </div>
                        <div className="gt-gittree-actions">
                          {selectedTreeCommit ? (
                            <>
                              <button className="chip active" onClick={() => openCommitWorktreeDialog(selectedTreeCommit, activeTreeBranch)}>Create Worktree</button>
                              <button className="chip" onClick={() => inspectCommitFromTopology(selectedTreeCommit.sha)}>Explain</button>
                            </>
                          ) : (
                            <button className="chip" onClick={() => activeTreeBranch && openTopologyCreateDialog("worktree", `branch:${activeTreeBranch}`)} disabled={!activeTreeBranch}>New Worktree</button>
                          )}
                        </div>
                      </div>
                      {selectedTreeCommit ? (
                        <div className="gt-gittree-detail-body">
                          <div className="gt-gittree-detail-card">
                            <span>Commit</span>
                            <strong>{shortSha(selectedTreeCommit.sha, 12)}</strong>
                            <p>{selectedTreeCommit.subject || "(no subject)"}</p>
                          </div>
                          <div className="gt-gittree-detail-grid">
                            <div><span>Branch</span><strong>{activeTreeBranch || "-"}</strong></div>
                            <div><span>Author</span><strong>{selectedTreeCommit.author || "unknown"}</strong></div>
                            <div><span>Date</span><strong>{selectedTreeCommit.date || "unknown"}</strong></div>
                            <div><span>Worktree</span><strong>{activeBranchWorktrees.length || 0}</strong></div>
                          </div>
                          <pre className="gt-gittree-detail-preview">{selectedExplain || "Select Explain to load Entire context for this commit."}</pre>
                        </div>
                      ) : (
                        <div className="gt-gittree-detail-body">
                          <div className="gt-gittree-commit-toolbar gt-gittree-worktree-toolbar">
                            <span>Worktrees</span>
                            <div className="toolbar" style={{ gap: 8 }}>
                              <span>{activeBranchWorktrees.length} linked</span>
                              <button
                                className="chip"
                                style={{ fontSize: 10, height: 22, padding: "0 8px" }}
                                onClick={() => activeTreeBranch && openTopologyCreateDialog("worktree", `branch:${activeTreeBranch}`)}
                                disabled={!activeTreeBranch}
                              >
                                + New
                              </button>
                            </div>
                          </div>
                          <div className="gt-gittree-worktree-list">
                            {activeBranchWorktrees.length > 0 ? activeBranchWorktrees.map((wt) => (
                              <button
                                key={wt.path}
                                className={selectedWorktreePath === wt.path ? "gt-gittree-worktree-row selected" : "gt-gittree-worktree-row"}
                                onClick={() => setSelectedWorktreePath(wt.path)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setWorktreeContextMenu({ x: e.clientX, y: e.clientY, path: wt.path });
                                }}
                              >
                                <span className="gt-gittree-worktree-state">{wt.isCurrent ? "Current" : wt.isDetached ? "Detached" : "Worktree"}</span>
                                <strong>{wt.path.split("/").filter(Boolean).pop() || wt.branch || "worktree"}</strong>
                                <span>{wt.path}</span>
                                <em>{wt.clean ? "clean" : `${wt.stagedCount + wt.unstagedCount + wt.untrackedCount} changes`}</em>
                                <button
                                  type="button"
                                  className="chip"
                                  style={{ fontSize: 10, height: 22, padding: "0 8px" }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void activateLinkedWorktree(wt.path);
                                  }}
                                >
                                  Open
                                </button>
                              </button>
                            )) : <div className="gt-empty-hint">No worktree for this branch.</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

        {rightPaneTab === "changes" ? (
          <div
            className="gt-panel-stack gt-panel-stack-split gt-changes-workspace"
            style={{ "--changes-sidebar-width": `${changesSidebarWidth}px` } as CSSProperties}
          >
            <div className="gt-right-card gt-right-card-files">
              <div className="gt-right-card-head gt-changes-pane-head">
                <div className="gt-changes-header">
                  <strong>Changes</strong>
                </div>
                <div className="toolbar" style={{ gap: 6 }}>
                  {worktreeChangeStats.total > 0 ? (
                    <button
                      type="button"
                      className="chip gt-icon-chip"
                      title={worktreeChangeStats.unstaged > 0 ? "暂存所有更改" : "取消全部暂存"}
                      onClick={() => void handleToggleStageAll()}
                    >
                      {worktreeChangeStats.unstaged > 0 ? "+" : "−"}
                    </button>
                  ) : null}
                  {worktreeChangeStats.total > 0 ? (
                    <button
                      type="button"
                      className="chip gt-icon-chip is-danger"
                      title="撤销全部修改"
                      disabled={discardingAll}
                      onClick={openDiscardAllConfirm}
                    >
                      <svg className="gt-icon-chip-svg" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M6 4 3 7l3 3" />
                        <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="gt-changes-commit-box">
                <input
                  ref={commitMessageInputRef}
                  className="path-input"
                  style={{ width: "100%" }}
                  placeholder="Message"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  disabled={committing || pushing}
                />
                <div className="gt-changes-commit-actions" onClick={(e) => e.stopPropagation()}>
                  <div className="gt-commit-split-wrap">
                    <button
                      className={committing || pushing ? "chip is-primary gt-commit-main-btn is-loading" : "chip is-primary gt-commit-main-btn"}
                      onClick={() => void (commitPrimaryIsSync ? handleGitSync() : handleGitCommit())}
                      disabled={commitPrimaryIsSync ? false : !hasCommittableChanges}
                      aria-busy={committing || pushing}
                      title={commitPrimaryIsSync ? "Sync branch" : (!hasCommittableChanges ? "No changes to commit" : "")}
                    >
                      {committing || pushing ? <span className="gt-btn-spinner" aria-hidden="true" /> : null}
                      {gitOperationLabel || (commitPrimaryIsSync
                        ? (pushing ? "Syncing..." : `↕ Sync (${worktreeOverview.ahead}/${worktreeOverview.behind})`)
                        : `✓ Commit (${commitButtonCount})`)}
                    </button>
                    <button
                      type="button"
                      className="chip is-primary gt-commit-menu-btn"
                      onClick={() => setShowCommitActionMenu((prev) => !prev)}
                      disabled={committing || pushing}
                      title="More commit actions"
                    >
                      <svg className="gt-commit-chevron" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4.5 6.5 8 10l3.5-3.5" />
                      </svg>
                    </button>
                    {showCommitActionMenu ? (
                      <div className="gt-commit-action-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => void handleGitCommit()} disabled={committing || pushing || !hasCommittableChanges}>Commit</button>
                        <button type="button" role="menuitem" onClick={() => void handleGitPush()} disabled={committing || pushing}>Push</button>
                        <button type="button" role="menuitem" onClick={() => void handleGitCommitAndPush()} disabled={committing || pushing || !hasCommittableChanges}>Commit & Push</button>
                        <button type="button" role="menuitem" onClick={() => void handleGitCommitAndSync()} disabled={committing || pushing || !hasCommittableChanges}>Commit & Sync</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="gt-worktree-file-list gt-worktree-tree-list">
                {worktreeOverview.entries.length === 0 ? (
                  <div className="gt-empty-hint">当前 worktree 没有待提交文件。</div>
                ) : (
                  <>
                    {/* Staged Changes */}
                    {stagedTree.length > 0 && (
                      <div className="gt-changes-group">
                        <div className="gt-changes-group-header">
                          <span className="gt-changes-group-title">Staged Changes</span>
                          <span className="gt-changes-group-count">{worktreeChangeStats.staged}</span>
                        </div>
                        <div className="gt-changes-group-list">
                          {renderWorktreeNodes(stagedTree)}
                        </div>
                      </div>
                    )}

                    {/* Changes (unstaged) */}
                    {unstagedTree.length > 0 && (
                      <div className="gt-changes-group">
                        <div className="gt-changes-group-header">
                          <span className="gt-changes-group-title">Changes</span>
                          <span className="gt-changes-group-count">{worktreeChangeStats.unstaged}</span>
                        </div>
                        <div className="gt-changes-group-list">
                          {renderWorktreeNodes(unstagedTree)}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div
              className={draggingSplit?.kind === "changes" ? "gt-changes-splitter active" : "gt-changes-splitter"}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整 Changes 文件树宽度"
              onMouseDown={(e) => {
                e.preventDefault();
                setDraggingSplit({ kind: "changes", startX: e.clientX, startWidth: changesSidebarWidth });
              }}
            />
            <div className="gt-right-card gt-right-card-fill gt-diff-editor-pane">
              <div className="gt-right-card-head gt-diff-compact-head">
                <div className="gt-diff-header">
                  {selectedWorktreeFile ? (
                    <>
                      <span className={`gt-worktree-kind gt-worktree-kind-${getWorktreeFileKindLabel(selectedWorktreeFile)}`}>{getWorktreeFileKindLabel(selectedWorktreeFile)}</span>
                      <strong className="gt-diff-filename">{selectedWorktreeFile}</strong>
                      <button
                        type="button"
                        className="gt-diff-icon-btn"
                        title="复制文件路径"
                        onClick={() => void copyText(selectedWorktreeFile)}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <rect x="5" y="3" width="8" height="8" rx="1.5" />
                          <path d="M3 5.5v6A1.5 1.5 0 0 0 4.5 13h6" />
                        </svg>
                      </button>
                      {worktreePatchStats.added > 0 ? <span className="meta-chip is-add">+{worktreePatchStats.added}</span> : null}
                      {worktreePatchStats.deleted > 0 ? <span className="meta-chip is-del">-{worktreePatchStats.deleted}</span> : null}
                    </>
                  ) : (
                    <span className="small muted">选择一个文件</span>
                  )}
                </div>
                {selectedWorktreeEntry ? (
                  <div className="gt-diff-header-actions">
                    <button
                      className={selectedWorktreeEntry.staged ? "gt-stage-toggle is-on" : "gt-stage-toggle"}
                      title={selectedWorktreeEntry.staged ? "取消暂存" : "暂存"}
                      aria-pressed={selectedWorktreeEntry.staged}
                      onClick={() => {
                        if (selectedWorktreeEntry.staged) {
                          void handleUnstageFile(selectedWorktreeEntry.path);
                        } else {
                          void handleStageFile(selectedWorktreeEntry.path);
                        }
                      }}
                      disabled={(selectedWorktreeEntry.staged ? unstagingFile : stagingFile) === selectedWorktreeEntry.path}
                    >
                      {selectedWorktreeEntry.staged ? (
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M4 8.2 6.7 11 12 5" />
                        </svg>
                      ) : null}
                    </button>
                    {(selectedWorktreeEntry.staged || selectedWorktreeEntry.unstaged || selectedWorktreeEntry.untracked) ? (
                      <button
                        className="gt-diff-icon-btn is-danger"
                        title="撤销修改"
                        onClick={() => void handleDiscardChanges(selectedWorktreeEntry.path, selectedWorktreeEntry.untracked)}
                        disabled={discardingFile === selectedWorktreeEntry.path}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M6 4 3 7l3 3" />
                          <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {selectedWorktreeFile ? (
                <div className="gt-monaco-diff-shell">
                  <DiffEditor
                    key={selectedWorktreeFile}
                    height="100%"
                    width="100%"
                    original={selectedWorktreeContent.original}
                    modified={selectedWorktreeContent.modified}
                    language={getMonacoLanguage(selectedWorktreeFile)}
                    theme={theme === "light" ? "light" : "vs-dark"}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      automaticLayout: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      renderOverviewRuler: false,
                      folding: true,
                      fontSize: 12,
                      lineHeight: 18,
                      wordWrap: "off",
                      scrollbar: {
                        alwaysConsumeMouseWheel: false,
                        horizontalScrollbarSize: 10,
                        verticalScrollbarSize: 10
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="gt-worktree-patch-empty">选择左侧文件后查看 patch。</div>
              )}
            </div>
          </div>
        ) : null}

        {rightPaneTab === "terminal" ? (
          <div className="gt-panel-stack gt-panel-stack-terminal">
            <div className="gt-terminal-header">
              <button
                type="button"
                className={terminalSidebarVisible ? "chip" : "chip active"}
                onClick={() => setTerminalSidebarVisible((v) => !v)}
                title={terminalSidebarVisible ? "隐藏终端列表" : "显示终端列表"}
              >
                ☰
              </button>
              <span className="gt-terminal-label">zsh</span>
              <div className="gt-terminal-actions">
                <button className="chip" onClick={async () => {
                  if (!selectedRepo || !activeTerminalTab) return;
                  await clearRepoTerminalSession(selectedRepo.path, activeTerminalTab.id);
                  terminalSeqRef.current[activeTerminalTab.id] = 0;
                  updateTerminalTabById(activeTerminalTab.id, { seq: 0, output: "" });
                }}>Clear</button>
              </div>
            </div>
            <div className={terminalSidebarVisible ? "gt-terminal-layout" : "gt-terminal-layout sidebar-hidden"}>
              {terminalSidebarVisible ? (
                <aside className="gt-terminal-sidebar">
                  <div className="gt-terminal-sidebar-head">
                    <strong>{terminalTabs.length} Terminals</strong>
                    <button type="button" className="chip" onClick={createTerminalTab} title="新建终端">＋</button>
                  </div>
                  <div className="gt-terminal-sidebar-list">
                    {terminalTabs.map((tab) => (
                      <button
                        key={`terminal-side-${tab.id}`}
                        type="button"
                        className={tab.id === activeTerminalTabId ? "gt-terminal-side-item active" : "gt-terminal-side-item"}
                        onClick={() => setActiveTerminalTabId(tab.id)}
                      >
                        <span className="gt-terminal-side-item-title">{tab.title}</span>
                        {terminalTabs.length > 1 ? (
                          <span
                            className="gt-terminal-side-item-close"
                            onClick={(e) => {
                              e.stopPropagation();
                              void closeTerminalTab(tab.id);
                            }}
                            aria-hidden="true"
                          >
                            ×
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </aside>
              ) : null}
              <div className="gt-terminal-body" onClick={() => terminalInputRef.current?.focus()}>
                <div ref={terminalLogRef} className="gt-terminal-console">
                <pre className="gt-terminal-output">{activeTerminalView.body || ""}</pre>
                <div className="gt-terminal-inline-input">
                  <span className="gt-terminal-prompt">{activeTerminalView.prompt || ""}</span>
                  <input
                    ref={terminalInputRef}
                    className="gt-terminal-input"
                    value={activeTerminalTab?.input || ""}
                    onChange={(e) => {
                      if (!activeTerminalTab) return;
                      updateTerminalTabById(activeTerminalTab.id, { input: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (!activeTerminalTab) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void runTerminalCommand();
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        updateTerminalTabById(activeTerminalTab.id, (prev) => {
                          if (prev.history.length === 0) return prev;
                          const next = prev.historyIndex < 0 ? 0 : Math.min(prev.historyIndex + 1, prev.history.length - 1);
                          return { ...prev, historyIndex: next, input: prev.history[next] || "" };
                        });
                        return;
                      }
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        updateTerminalTabById(activeTerminalTab.id, (prev) => {
                          if (prev.history.length === 0) return prev;
                          if (prev.historyIndex <= 0) {
                            return { ...prev, historyIndex: -1, input: "" };
                          }
                          const next = prev.historyIndex - 1;
                          return { ...prev, historyIndex: next, input: prev.history[next] || "" };
                        });
                        return;
                      }
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !activeTerminalTab.input.trim()) {
                        e.preventDefault();
                        void sendRepoTerminalInput(repoPath, "\u0003", activeTerminalTab.id).catch(() => {
                          // ignore
                        });
                      }
                    }}
                    placeholder=""
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                </div>
                </div>
              </div>
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
      <button className={leftDrawerOpen ? "gt-shell-toggle gt-shell-toggle-left is-sidebar-open" : "gt-shell-toggle gt-shell-toggle-left is-sidebar-closed"} title={leftDrawerOpen ? "收起左侧栏" : "展开左侧栏"} onClick={() => setLeftDrawerOpen((v) => !v)}>
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
                  {(() => {
                    const mainRepo = repos.find(r => r.id === selectedRepo?.id);
                    const isWorktree = mainRepo && selectedRepo && mainRepo.path !== selectedRepo.path;
                    return (selectedRepo?.name ?? "No Project") + " · " + (worktreeOverview.branch || selectedBranch || "—") + (isWorktree ? " [worktree]" : "");
                  })()}
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

        {showTopologyCreateDialog ? (
          <div className="modal-mask" onClick={() => setShowTopologyCreateDialog(false)}>
            <div className="modal-card gt-topology-create-card" onClick={(e) => e.stopPropagation()}>
              <h3>{topologyCreateMode === "worktree" ? "基于分支创建工作空间" : "从分支拉新分支"}</h3>
              <p className="small muted">
                {topologyCreateMode === "worktree"
                  ? "会在来源分支或 commit 下创建一个独立 worktree 目录，不会额外创建子分支。"
                  : "从来源分支创建新分支，创建后会选中新分支。"}
              </p>
              <div className="gt-topology-create-grid">
                <label className="gt-topology-form-field">
                  <span>{topologyCreateSourceNodeId.startsWith("commit:") ? "来源 Commit" : "来源分支"}</span>
                  <strong>{topologyCreateSourceNodeId.startsWith("commit:") ? shortSha(topologyCreateSource(topologyCreateSourceNodeId).startPoint, 10) : topologyCreateSourceNode?.branch || topologyCreateSourceNode?.label || currentTopologyBaseBranch() || "-"}</strong>
                </label>
                <label className="gt-topology-form-field">
                  <span>{topologyCreateMode === "worktree" ? "工作空间目录名" : "新分支名"}</span>
                  <input
                    value={topologyCreateBranchName}
                    onChange={(e) => {
                      const next = e.target.value;
                      setTopologyCreateBranchName(next);
                      if (topologyCreateMode === "worktree" && (!topologyCreateTargetPath.trim() || topologyCreateTargetPath.includes(".worktrees/"))) {
                        const base = topologyCreateSource(topologyCreateSourceNodeId).baseBranch || topologyCreateSourceNode?.branch || currentTopologyBaseBranch();
                        setTopologyCreateTargetPath(suggestedTopologyPath(base, next));
                      }
                    }}
                    placeholder={topologyCreateMode === "worktree" ? "ui-v2" : "feature/my-node"}
                    autoFocus
                  />
                </label>
                {topologyCreateMode === "worktree" ? (
                  <label className="gt-topology-form-field gt-topology-form-field-wide">
                    <span>目标目录</span>
                    <input
                      value={topologyCreateTargetPath}
                      onChange={(e) => setTopologyCreateTargetPath(e.target.value)}
                      placeholder="留空则自动生成"
                    />
                  </label>
                ) : null}
              </div>
              <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 12 }}>
                <button className="chip" onClick={() => setShowTopologyCreateDialog(false)}>取消</button>
                <button className="chip active" onClick={() => void submitTopologyCreateDialog()} disabled={creatingTopologyNode || !topologyCreateBranchName.trim()}>
                  {topologyCreateMode === "worktree" ? "创建工作空间" : "创建分支"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showTopologyInspectDialog && topologyInspectNode ? (
          <div className="modal-mask" onClick={() => setShowTopologyInspectDialog(false)}>
            <div className="modal-card gt-topology-inspect-card" onClick={(e) => e.stopPropagation()}>
              <div className="gt-worktree-topology-info-head">
                <strong>{topologyInspectNode.label}</strong>
                <span className="small muted">{topologyInspectNode.kind}</span>
              </div>
              <div className="gt-worktree-topology-info-grid">
                <div className="gt-worktree-topology-metric"><span>Branch</span><strong>{topologyInspectNode.branch || worktreeOverview.branch || "-"}</strong></div>
                <div className="gt-worktree-topology-metric"><span>Commit</span><strong>{topologyInspectNode.sha ? shortSha(topologyInspectNode.sha) : shortSha(selectedCommit || commits[0]?.sha || "")}</strong></div>
                <div className="gt-worktree-topology-metric"><span>Status</span><strong>{topologyInspectNode.kind === "commit" ? "history" : topologyInspectNode.dirtyCount ? `dirty ${topologyInspectNode.dirtyCount}` : worktreeOverview.clean ? "clean" : "dirty"}</strong></div>
                <div className="gt-worktree-topology-metric"><span>Ahead / Behind</span><strong>{worktreeOverview.ahead} / {worktreeOverview.behind}</strong></div>
              </div>
              <div className="gt-worktree-topology-detail-list">
                {topologyInspectNode.path ? <div className="gt-worktree-topology-detail-item"><span>Path</span><strong>{topologyInspectNode.path}</strong></div> : null}
                {topologyInspectNode.author ? <div className="gt-worktree-topology-detail-item"><span>Author</span><strong>{topologyInspectNode.author}</strong></div> : null}
                {topologyInspectNode.date ? <div className="gt-worktree-topology-detail-item"><span>Date</span><strong>{topologyInspectNode.date}</strong></div> : null}
                {topologyInspectNode.refs?.length ? <div className="gt-worktree-topology-detail-item"><span>Refs</span><strong>{topologyInspectNode.refs.join(" · ")}</strong></div> : null}
                {topologyInspectNode.kind === "commit" && selectedParsed?.hasCheckpoint ? <div className="gt-worktree-topology-detail-item"><span>Checkpoint</span><strong>{selectedParsed.checkpointId || "已关联"}</strong></div> : null}
                {topologyInspectNode.kind === "commit" && selectedParsed?.sessionId ? <div className="gt-worktree-topology-detail-item"><span>Session</span><strong>{selectedParsed.sessionId}</strong></div> : null}
              </div>
              <pre className="gt-worktree-topology-context-preview">{topologyInspectNode.kind === "commit" ? (selectedExplain || "当前 commit 未解析到 Entire agent 上下文。") : (worktreeOverview.raw || "git status -sb")}</pre>
            </div>
          </div>
        ) : null}

        {showDiscardAllConfirm ? (
          <div className="modal-mask" onClick={() => !discardingAll && setShowDiscardAllConfirm(false)}>
            <div className="modal-card gt-discard-confirm-card" onClick={(e) => e.stopPropagation()}>
              <h3>撤销全部修改？</h3>
              <p className="small muted">
                将撤销 {discardAllCount} 个文件的修改。未跟踪文件会被删除，已跟踪文件会恢复到 HEAD。
              </p>
              <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 14 }}>
                <button className="chip" onClick={() => setShowDiscardAllConfirm(false)} disabled={discardingAll}>取消</button>
                <button className="chip is-danger" onClick={() => void handleDiscardAllChanges()} disabled={discardingAll || discardAllCount === 0}>
                  {discardingAll ? "撤销中..." : "确认撤销"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {worktreeContextMenu ? (
          <div className="repo-context-layer" onClick={() => setWorktreeContextMenu(null)}>
            <div
              className="repo-context-menu"
              style={{ left: worktreeContextMenu.x, top: worktreeContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="repo-context-item"
                onClick={() => {
                  setWorktreeToRemove(worktreeContextMenu.path);
                  setShowRemoveWorktreeConfirm(true);
                  setWorktreeContextMenu(null);
                }}
              >
                Remove worktree
              </button>
            </div>
          </div>
        ) : null}

        {showRemoveWorktreeConfirm ? (
          <div className="modal-mask" onClick={() => { if (!removingWorktreePath) { setShowRemoveWorktreeConfirm(false); setWorktreeToRemove(""); } }}>
            <div className="modal-card gt-discard-confirm-card" onClick={(e) => e.stopPropagation()}>
              <h3>Remove worktree?</h3>
              <p className="small muted">
                This will remove the worktree directory and clean up the Git worktree entry. Files inside will be deleted.
              </p>
              <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 14 }}>
                <button className="chip" onClick={() => { setShowRemoveWorktreeConfirm(false); setWorktreeToRemove(""); }} disabled={!!removingWorktreePath}>取消</button>
                <button className="chip is-danger" onClick={() => void handleRemoveWorktree(worktreeToRemove)} disabled={!!removingWorktreePath || !worktreeToRemove}>
                  {removingWorktreePath ? "Removing..." : "Confirm Remove"}
                </button>
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
                    <button className="chip" onClick={toggleTheme} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}>
                      {theme === "dark" ? "Light" : "Dark"}
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
              />
              <button
                className="chip opencode-provider-add-btn"
                title="新增自定义提供商"
                aria-label="新增自定义提供商"
                onClick={() => {
                  setShowOpencodeProviderPicker(false);
                  setShowOpencodeCustomProvider(true);
                }}
              >
                ＋
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
                  const configuredPool = cfgPid ? (opencodeConfiguredModelsByProvider[cfgPid] ?? []) : [];
                  const providerPool = pid ? (opencodeModelsByProvider[pid] ?? []) : [];
                  // Keep full provider list visible while preserving configured entries.
                  // This avoids list shrinking after enabling one model.
                  const pool = Array.from(new Set([...providerPool, ...configuredPool])).sort((a, b) => a.localeCompare(b));
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
                          const locallyEnabled = !!refNorm && opencodeEnabledModels.has(refNorm);
                          const enabled = !!refNorm && !opencodeHiddenModels.has(refNorm) && (configured || locallyEnabled);
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
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!refNorm) return;
                                  if (enabled) {
                                    setOpencodeHiddenModels((prev) => {
                                      const next = new Set(prev);
                                      next.add(refNorm);
                                      return next;
                                    });
                                    setOpencodeEnabledModels((prev) => {
                                      const next = new Set(prev);
                                      next.delete(refNorm);
                                      return next;
                                    });
                                    return;
                                  }
                                  // Local enable semantics: unhide + mark enabled immediately.
                                  setOpencodeHiddenModels((prev) => {
                                    const next = new Set(prev);
                                    next.delete(refNorm);
                                    return next;
                                  });
                                  setOpencodeEnabledModels((prev) => {
                                    const next = new Set(prev);
                                    next.add(refNorm);
                                    return next;
                                  });
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
              <button
                className="repo-context-item"
                onClick={() => openCommitWorktreeDialog({
                  sha: commitContextMenu.sha,
                  subject: commitContextMenu.subject || "",
                  author: "",
                  date: ""
                }, commitContextMenu.branch)}
              >
                Create worktree from commit
              </button>
              <button
                className="repo-context-item"
                onClick={() => {
                  setCommitContextMenu(null);
                  openTopologyCreateDialog("branch", `commit:${commitContextMenu.branch || currentTopologyBaseBranch()}:${commitContextMenu.sha}`);
                }}
              >
                Create branch from commit
              </button>
              <button className="repo-context-item" onClick={() => void copyCommitId(commitContextMenu.sha)}>
                Copy commit id
              </button>
            </div>
          </div>
        ) : null}

        {topologyContextMenu ? (() => {
          // 优先从 topologyModel 查找节点，否则解析 nodeId
          let node = topologyModel.nodeById[topologyContextMenu.nodeId];
          let branchName = "";
          let worktreePath = "";
          let isBranch = false;
          let isWorktree = false;
          
          if (node) {
            // 旧版拓扑模型节点
            isBranch = node.kind === "branch";
            isWorktree = node.kind === "worktree";
            branchName = node.branch || "";
            worktreePath = node.path || "";
          } else if (topologyContextMenu.nodeId.startsWith("branch:")) {
            // 新版 Canvas 分支节点
            isBranch = true;
            branchName = topologyContextMenu.nodeId.slice(7);
          } else if (topologyContextMenu.nodeId.startsWith("worktree:")) {
            // 新版 Canvas 工作空间节点
            isWorktree = true;
            worktreePath = topologyContextMenu.nodeId.slice(9);
            const wt = linkedWorktrees.find((w) => w.path === worktreePath || w.path.includes(worktreePath));
            branchName = wt?.branch || "";
          } else if (topologyContextMenu.nodeId.startsWith("commit:")) {
            // Commit 节点 - 不提供右键菜单
            return null;
          }
          
          if (!isBranch && !isWorktree) return null;
          
          const branchInfo = isBranch ? branches.find((b) => b.name === branchName) : null;
          const isRemoteBranch = !!branchInfo?.isRemote;
          const hasWorktree = isBranch && linkedWorktrees.some((w) => w.branch === branchName);
          const nodeWorkspacePath = isWorktree ? normalizeWorkspacePath(worktreePath) : "";
          const nodeAgentBinding = nodeWorkspacePath ? workspaceAgentBindings[nodeWorkspacePath] || null : null;
          const isCurrentBranch = isBranch && (worktreeOverview.branch === branchName || !!branchInfo?.isCurrent);
          
          return (
            <div className="repo-context-layer" onClick={() => setTopologyContextMenu(null)}>
              <div
                className="repo-context-menu repo-context-menu-wide"
                style={{ left: topologyContextMenu.x, top: topologyContextMenu.y }}
                onClick={(e) => e.stopPropagation()}
              >
                {isBranch ? (
                  <>
                    <div className="repo-context-header" style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                      {branchName}
                    </div>
                    <button className="repo-context-item" onClick={() => openTopologyCreateDialog("branch", topologyContextMenu.nodeId)}>
                      Create Branch
                    </button>
                    <button className="repo-context-item" onClick={() => openTopologyCreateDialog("worktree", topologyContextMenu.nodeId)}>
                      Create Worktree
                    </button>
                    {isRemoteBranch ? (
                      <button className="repo-context-item" onClick={() => void checkoutRemoteBranchFromTopology(branchName)}>
                        Checkout as new local branch
                      </button>
                    ) : (
                      <button className="repo-context-item" onClick={() => void checkoutBranchFromTopology(branchName)}>
                        Checkout
                      </button>
                    )}
                    {!isRemoteBranch && branchName !== "main" && branchName !== "master" && !hasWorktree ? (
                      <button className="repo-context-item danger" onClick={() => void deleteBranchFromTopology(branchName)}>
                        Delete Branch
                      </button>
                    ) : null}
                  </>
                ) : null}
                {isWorktree ? (
                  <>
                    <div className="repo-context-header" style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                      {worktreePath.split("/").pop() || worktreePath}
                    </div>
                    <button className="repo-context-item" onClick={() => openTopologyCreateDialog("branch", topologyContextMenu.nodeId)}>
                      Create Branch from Worktree
                    </button>
                    <button className="repo-context-item" onClick={() => void activateLinkedWorktree(worktreePath)}>
                      Open Worktree
                    </button>
                    {nodeAgentBinding ? (
                      <button className="repo-context-item" onClick={() => unbindAgentFromWorkspacePath(nodeWorkspacePath)}>
                        Unbind Agent
                      </button>
                    ) : (
                      <button className="repo-context-item" onClick={() => void bindAgentToWorkspacePath(nodeWorkspacePath, branchName)}>
                        Bind Agent
                      </button>
                    )}
                    {!isCurrentBranch ? (
                      <button className="repo-context-item danger" onClick={() => void removeTopologyWorktree(worktreePath)}>
                        Remove Worktree
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          );
        })() : null}

      </>
    </AppErrorBoundary>
  );
}

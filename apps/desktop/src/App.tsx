import { invoke, listen, IS_TAURI } from "./lib/platform";
import type { CSSProperties, ReactNode } from "react";
import { Component, Fragment, Suspense, lazy, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createPortal } from "react-dom";
import {
  loadCachedRuntimeStatus,
  loadCachedWidth,
  RIGHT_PANE_WIDTH_CACHE_KEY,
  saveCachedRuntimeStatus,
  saveCachedWidth,
  SIDEBAR_WIDTH_CACHE_KEY,
  type RuntimeActionJobStatus,
  type RuntimeDepName,
  type RuntimeDependencyStatus,
  type RuntimeRequirementsStatus
} from "./lib/appCache";
import { parseAgentContextText, parseStatusText } from "./lib/agentContextParser";
import type { PanelPlacement } from "./layout/Workbench";
import { Workbench } from "./layout/Workbench";
import { explainCommit, explainCommitShort, getEntireStatusDetailed } from "./lib/entireAdapter";
import { parseExplainCommit } from "./lib/explainParser";
import {
  buildConfiguredModelCandidates,
  buildSyncModelRefs,
  isModelRefAvailable,
  loadModelRefSet,
  normalizeModelRef,
  normalizeProviderId,
  parseModelRef,
  resolveProviderAliasWithNames,
  saveModelRefSet
} from "./lib/opencodeModels";
import {
  buildOpencodeTurnRanges,
  getInitialOpencodeTurnStart,
  newOpencodeSession,
  opencodeSessionFromSummary,
  sliceOpencodeMessagesByTurnStart,
  sortOpencodeSessionSummaries,
  toOpencodeSessionTitle,
  type OpencodeChatMessage,
  type OpencodeChatSession,
  type OpencodeDetailedMessage,
  type OpencodeDetailedPart,
  type OpencodeMessagePageCacheEntry,
  type OpencodeMessageWindowCacheEntry,
  type OpencodeSessionMessage,
  type OpencodeSessionSummary,
  type OpencodeTodoItem
} from "./lib/opencodeSessions";
import {
  buildOpencodeAssistantRenderGroups,
  buildOpencodeImageAttachmentsFromParts,
  buildOpencodeMainLineMarkdownFromParts,
  buildOpencodeReplyMarkdownFromParts,
  isOpencodeContextTool,
  isOpencodeRenderablePart,
  mergeOpencodeMessageAttachments,
  mergeOpencodeStreamText,
  parseOpencodeTaskSessionId,
  readOpencodeTodosFromPart,
  summarizeOpencodeContextProgress,
  summarizeOpencodeContextToolCounts,
  toDisplayJson
} from "./lib/opencodeParts";
import {
  closeRepoTerminalSession,
  completeRepoTerminalInput,
  clearRepoTerminalSession,
  listRepoTerminalCompletions,
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
  gitCherryPickCommit,
  gitDiscardChanges,
  gitRevertCommit,
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
import {
  applyTerminalCompletionCandidate,
  createTerminalTabState,
  getTerminalCompletionGroup,
  readTerminalTabSnapshot,
  sanitizeTerminalOutput,
  splitTerminalOutputForInput,
  type TerminalTabState,
  writeTerminalTabSnapshot
} from "./lib/terminalState";
import {
  normalizeWorkspacePath,
  readBranchParentMap,
  readWorkspaceAgentBindings,
  readWorktreeParentMap,
  type WorkspaceAgentBinding,
  writeBranchParentMap,
  writeWorkspaceAgentBindings,
  writeWorktreeParentMap
} from "./lib/workspaceBindings";
import {
  buildSplitDiffRows,
  buildWorktreeTree,
  collectWorktreeDirPaths,
  collectWorktreeNodeEntries,
  collectWorktreeNodeFilePaths,
  getMonacoLanguage,
  getWorktreeDisplayStatus,
  getWorktreeFileKindLabel,
  getWorktreeStatusText,
  toDiffRows,
  type DiffRow,
  type WorktreeTreeNode
} from "./lib/worktreeDiff";
import {
  branchTone,
  buildTopologyModel,
  parseRefs,
  pathLeaf,
  shortSha,
  type TopologyGraphModel,
  type TopologyNode
} from "./lib/worktreeTopology";
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
import { PanelToggleIcon, RightPaneTabIcon, SendIcon, type RightPaneTab } from "./components/common/AppChromeIcons";
import { MarkdownLite } from "./components/common/MarkdownLite";
import { BranchGraphLanes } from "./components/git/BranchGraphLanes";
import { McpMarketplace } from "./components/mcp/McpMarketplace";
import { OpenCodeAuthDialog } from "./components/opencode/OpenCodeAuthDialog";
import { OpenCodeApiDialog } from "./components/opencode/OpenCodeApiDialog";
import { OpenCodeCustomProviderDialog } from "./components/opencode/OpenCodeCustomProviderDialog";
import { OpenCodeProviderList } from "./components/opencode/OpenCodeProviderList";
import { OpenCodeProviderModelList } from "./components/opencode/OpenCodeProviderModelList";
import { QuestionDock } from "./components/QuestionDock";
import { RuntimeSetupDialog } from "./components/settings/RuntimeSetupDialog";
import { SettingsDialog, type GeneralSettingsDraft } from "./components/settings/SettingsDialog";
import { WorktreeTopologyCanvas } from "./components/WorktreeTopologyCanvas";
import type { TopologyCanvasNode } from "./components/WorktreeTopologyCanvas";
import rawMcpServers from "../servers.json";
import { normalizeMcpMarketData } from "./lib/mcpMarket";

const MonacoDiffViewer = lazy(() => import("./components/git/MonacoDiffViewer"));
const MCP_MARKET_SERVERS = normalizeMcpMarketData(rawMcpServers);

type DetailTab = "diff" | "context" | "findings";
type Theme = "dark" | "light";
type OpencodeImageAttachment = {
  id: string;
  filename: string;
  mime: string;
  dataUrl: string;
};
type OpencodeSlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: "builtin" | "command" | "skill" | "mcp";
};
type OpencodeAgentInfo = {
  name: string;
  description?: string;
  mode?: "primary" | "subagent" | "all";
  native?: boolean;
  hidden?: boolean;
  color?: string;
  variant?: string;
  model?: { providerID?: string; modelID?: string };
};
type OpencodeComposerAgentName = "build" | "plan";
type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: "allow" | "ask" | "deny";
};
type OpencodePermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  always?: string[];
  metadata?: Record<string, unknown>;
  tool?: { messageID?: string; callID?: string };
};
type OpencodePermissionReply = "once" | "always" | "reject";
type OpencodeThinkingLevel = "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type OpencodeModuleTab = "agents" | "permissions" | "mcp" | "skills";
type OpencodeMcpType = "local" | "remote";
type OpencodeMcpStatusMap = Record<string, Record<string, unknown>>;
type OpencodeSkillSearchStrategy = "keyword" | "ai";
type OpencodeSkillInfo = {
  name: string;
  description?: string;
  location?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  scope?: "project" | "global" | "source";
  path?: string;
  agents?: string[];
};
type OpencodeSkillSearchResult = {
  spec: string;
  package: string;
  skill: string;
  installs: string;
  url: string;
  id?: string;
  source?: string;
  sourceType?: string;
  installSpec?: string | null;
  installUrl?: string | null;
  isDuplicate?: boolean;
  change?: number;
  installsYesterday?: number;
};
type OpencodeSkillDetail = {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash?: string | null;
  files?: Array<{ path: string; contents: string }> | null;
};
type OpencodeSkillAudit = {
  provider: string;
  slug?: string;
  status: "pass" | "warn" | "fail" | string;
  summary?: string;
  auditedAt?: string;
  riskLevel?: string;
  categories?: string[];
};

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

type OnboardingStep = {
  title: string;
  body: string;
};

const ONBOARDING_DONE_KEY = "giteam.onboarding.done.v1";
const RUNTIME_FIRST_CHECK_KEY = "giteam.runtime.first-check.v1";
const OPENCODE_SAVED_MODELS_KEY = "giteam.opencode.saved-models.v1";
const OPENCODE_MODEL_VIS_KEY = "giteam.opencode.model-visibility.v1";
const OPENCODE_MODEL_ENABLE_KEY = "giteam.opencode.model-enabled.v1";
const OPENCODE_MODEL_SELECTION_KEY = "giteam.opencode.model-selection.v1";
const OPENCODE_PAGE_SIZE = 2;
const OPENCODE_SESSION_PAGE_SIZE = 3;
const OPENCODE_INITIAL_MESSAGE_FETCH_LIMIT = 80;
const OPENCODE_OLDER_MESSAGE_FETCH_LIMIT = 8;
const OPENCODE_TOP_LOAD_RATIO = 0.3;
const OPENCODE_TOP_PREFETCH_RATIO = 0.45;
const OPENCODE_AGENT_SELECTION_KEY = "giteam.opencode.agent-selection.v1";
const OPENCODE_THINKING_SELECTION_KEY = "giteam.opencode.thinking-selection.v1";
const OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY = "giteam.opencode.auto-accept-permissions.v1";
const GENERAL_SETTINGS_KEY = "giteam.settings.general.v1";
const RELEASE_NOTES_SEEN_KEY = "giteam.release-notes.seen-version.v1";
const APP_RELEASE_VERSION = "0.1.0";
const SKILLSMP_API_KEY_STORAGE_KEY = "giteam.skillsmp.api-key.v1";
const RIGHT_MODULE_VISIBILITY_KEY = "giteam.right-modules.visibility.v1";
const UI_FONT_SIZE_KEY = "giteam.appearance.ui-font-size.v1";
const CODE_FONT_SIZE_KEY = "giteam.appearance.code-font-size.v1";

const OPENCODE_COMPOSER_AGENT_OPTIONS: Array<{ name: OpencodeComposerAgentName; label: string; title: string }> = [
  { name: "build", label: "Build", title: "实现、修改、调试" },
  { name: "plan", label: "Plan", title: "先拆解方案" }
];

function isComposerAgentName(value: string): value is OpencodeComposerAgentName {
  return value === "build" || value === "plan";
}

function normalizeComposerAgentName(raw: unknown): OpencodeComposerAgentName {
  const value = String(raw || "").trim().toLowerCase();
  return isComposerAgentName(value) ? value : "build";
}

const OPENCODE_THINKING_LEVELS: Array<{ value: OpencodeThinkingLevel; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "使用模型或 agent 默认配置" },
  { value: "none", label: "None", description: "尽量关闭推理" },
  { value: "minimal", label: "Minimal", description: "极低推理强度" },
  { value: "low", label: "Low", description: "低推理强度" },
  { value: "medium", label: "Medium", description: "均衡推理强度" },
  { value: "high", label: "High", description: "高推理强度" },
  { value: "xhigh", label: "XHigh", description: "极高推理强度" },
  { value: "max", label: "Max", description: "模型允许的最大推理" }
];

const OPENCODE_RECOMMENDED_SKILLS: Array<{ spec: string; title: string; source: string; installs: string; tone: string; description: string }> = [
  {
    spec: "anthropics/skills@frontend-design",
    title: "Frontend Design",
    source: "anthropics/skills",
    installs: "385K+",
    tone: "生产级界面",
    description: "让 OpenCode 先确定明确美学方向，再处理字体、色彩、动效和空间构图，避免通用 AI UI。"
  },
  {
    spec: "vercel-labs/agent-skills@web-design-guidelines",
    title: "Web Guidelines",
    source: "vercel-labs/agent-skills",
    installs: "305K+",
    tone: "Vercel 规范",
    description: "适合打磨 Web 界面的间距、层级、交互和可访问性，让组件更像成熟产品。"
  },
  {
    spec: "leonxlnx/taste-skill@design-taste-frontend",
    title: "Design Taste",
    source: "leonxlnx/taste-skill",
    installs: "47K+",
    tone: "高审美约束",
    description: "强约束反套路设计，偏 React/Next/Tailwind，高级视觉和动效规则更激进。"
  },
  { spec: "vercel-labs/skills@find-skills", title: "Find Skills", source: "vercel-labs/skills", installs: "1.4M", tone: "Discovery", description: "搜索和安装代理能力的基础 Skill。" },
  { spec: "vercel-labs/agent-skills@vercel-react-best-practices", title: "Vercel React Best Practices", source: "vercel-labs/agent-skills", installs: "386K+", tone: "React", description: "Vercel 官方 React 设计和实现规范。" },
  { spec: "microsoft/azure-skills@microsoft-foundry", title: "Microsoft Foundry", source: "microsoft/azure-skills", installs: "303K+", tone: "Azure", description: "Microsoft Foundry 与 Azure agent workflows。" },
  { spec: "remotion-dev/skills@remotion-best-practices", title: "Remotion Best Practices", source: "remotion-dev/skills", installs: "299K+", tone: "Video", description: "Remotion 项目结构、渲染和动画最佳实践。" },
  { spec: "microsoft/azure-skills@azure-messaging", title: "Azure Messaging", source: "microsoft/azure-skills", installs: "291K+", tone: "Messaging", description: "Azure 消息队列和事件驱动架构能力。" },
  { spec: "vercel-labs/agent-browser@agent-browser", title: "Agent Browser", source: "vercel-labs/agent-browser", installs: "257K+", tone: "Browser", description: "浏览器自动化和网页上下文工作流。" },
  { spec: "microsoft/azure-skills@azure-hosted-copilot-sdk", title: "Azure Hosted Copilot SDK", source: "microsoft/azure-skills", installs: "274K+", tone: "Azure", description: "Azure hosted Copilot SDK workflows。" },
  { spec: "vercel-labs/agent-skills@next-js-development", title: "Next.js Development", source: "vercel-labs/agent-skills", installs: "245K+", tone: "Next.js", description: "Next.js app router、部署和组件最佳实践。" },
  { spec: "browser-use/browser-use@browser-use", title: "Browser Use", source: "browser-use/browser-use", installs: "188K+", tone: "Browser", description: "基于视觉理解的浏览器自动化。" },
  { spec: "anthropics/skills@skill-creator", title: "Skill Creator", source: "anthropics/skills", installs: "164K+", tone: "Authoring", description: "创建、测试和发布新的 agent skills。" },
  { spec: "vercel-labs/agent-skills@typescript-best-practices", title: "TypeScript Best Practices", source: "vercel-labs/agent-skills", installs: "141K+", tone: "TypeScript", description: "TypeScript 项目结构、类型设计和质量实践。" },
  { spec: "vercel-labs/agent-skills@accessibility", title: "Accessibility", source: "vercel-labs/agent-skills", installs: "128K+", tone: "A11y", description: "Web 可访问性审查和实现规范。" },
  { spec: "supabase/supabase@supabase", title: "Supabase", source: "supabase/supabase", installs: "120K+", tone: "Database", description: "Supabase 数据库、认证和边缘函数工作流。" },
  { spec: "vercel-labs/agent-skills@testing", title: "Testing", source: "vercel-labs/agent-skills", installs: "118K+", tone: "Testing", description: "单元测试、组件测试和端到端测试实践。" },
  { spec: "vercel-labs/agent-skills@tailwind-css", title: "Tailwind CSS", source: "vercel-labs/agent-skills", installs: "103K+", tone: "CSS", description: "Tailwind 样式组织和设计系统实践。" },
  { spec: "expo/skills@react-native", title: "React Native", source: "expo/skills", installs: "94K+", tone: "Mobile", description: "React Native / Expo 架构和跨平台实践。" },
  { spec: "vercel-labs/agent-skills@playwright", title: "Playwright", source: "vercel-labs/agent-skills", installs: "86K+", tone: "E2E", description: "Playwright E2E 测试和稳定性策略。" },
  { spec: "obra/superpowers@systematic-debugging", title: "Systematic Debugging", source: "obra/superpowers", installs: "73K+", tone: "Debug", description: "假设驱动的调试循环。" },
  { spec: "obra/superpowers@brainstorming", title: "Brainstorming", source: "obra/superpowers", installs: "66K+", tone: "Thinking", description: "结构化创意和问题拆解。" },
  { spec: "vercel-labs/agent-skills@docker", title: "Docker", source: "vercel-labs/agent-skills", installs: "58K+", tone: "DevOps", description: "容器化、镜像构建和本地开发环境。" },
  { spec: "vercel-labs/agent-skills@code-review", title: "Code Review", source: "vercel-labs/agent-skills", installs: "52K+", tone: "Review", description: "代码审查、风险识别和回归检查。" }
];

const SKILLSMP_CATEGORIES: Array<{ group: string; slug: string; label: string; count: string }> = [
  { group: "Development", slug: "frontend", label: "Frontend", count: "26K" },
  { group: "Development", slug: "backend", label: "Backend", count: "27K" },
  { group: "Development", slug: "full-stack", label: "Full Stack", count: "11K" },
  { group: "Development", slug: "mobile", label: "Mobile", count: "14K" },
  { group: "Development", slug: "architecture-patterns", label: "Architecture", count: "46K" },
  { group: "Testing", slug: "testing", label: "Testing", count: "40K" },
  { group: "Testing", slug: "code-quality", label: "Code Quality", count: "56K" },
  { group: "Testing", slug: "security", label: "Security", count: "33K" },
  { group: "Tools", slug: "debugging", label: "Debugging", count: "134K" },
  { group: "Tools", slug: "automation-tools", label: "Automation", count: "20K" },
  { group: "Tools", slug: "productivity-tools", label: "Productivity", count: "64K" },
  { group: "Tools", slug: "cli-tools", label: "CLI Tools", count: "7K" },
  { group: "Data AI", slug: "llm-ai", label: "LLM / AI", count: "68K" },
  { group: "Data AI", slug: "machine-learning", label: "Machine Learning", count: "22K" },
  { group: "Data AI", slug: "data-analysis", label: "Data Analysis", count: "9K" },
  { group: "DevOps", slug: "git-workflows", label: "Git Workflows", count: "55K" },
  { group: "DevOps", slug: "cicd", label: "CI/CD", count: "26K" },
  { group: "DevOps", slug: "cloud", label: "Cloud", count: "11K" },
  { group: "Docs", slug: "technical-docs", label: "Technical Docs", count: "30K" },
  { group: "Docs", slug: "knowledge-base", label: "Knowledge Base", count: "33K" },
  { group: "Business", slug: "sales-marketing", label: "Sales Marketing", count: "120K" },
  { group: "Business", slug: "project-management", label: "Project Mgmt", count: "47K" },
  { group: "Content", slug: "design", label: "Design", count: "9K" },
  { group: "Content", slug: "content-creation", label: "Content", count: "19K" }
];

function loadLocalString(key: string, fallback = ""): string {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function saveLocalString(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // ignore unavailable storage
  }
}

function loadRightModuleVisibility(): Record<RightPaneTab, boolean> {
  const fallback: Record<RightPaneTab, boolean> = { changes: true, worktree: true, terminal: true, skills: true, mcp: true };
  try {
    const raw = window.localStorage.getItem(RIGHT_MODULE_VISIBILITY_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<RightPaneTab, boolean>>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function saveRightModuleVisibility(value: Record<RightPaneTab, boolean>): void {
  try {
    window.localStorage.setItem(RIGHT_MODULE_VISIBILITY_KEY, JSON.stringify(value));
  } catch {
    // ignore unavailable storage
  }
}

function loadLocalBool(key: string, fallback = false): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

function saveLocalBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore unavailable storage
  }
}

const DEFAULT_GENERAL_SETTINGS: GeneralSettingsDraft = {
  language: "system",
  autoAcceptPermissions: false,
  showReasoningSummaries: false,
  shellToolPartsExpanded: false,
  editToolPartsExpanded: false,
  showSessionProgressBar: true,
  notificationsAgent: true,
  notificationsPermissions: true,
  notificationsErrors: false,
  soundsAgent: true,
  soundsPermissions: true,
  soundsErrors: true,
  updatesStartup: true,
  releaseNotes: true
};

type AppLocale = "zh-CN" | "zh-TW" | "en-US";

function normalizeAppLocale(value: string): AppLocale {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk")) return "zh-TW";
  if (normalized.startsWith("zh")) return "zh-CN";
  return "en-US";
}

function normalizeStoredLanguage(value: unknown): GeneralSettingsDraft["language"] {
  return value === "system" || value === "zh-CN" || value === "zh-TW" || value === "en-US" ? value : "system";
}

const APP_TEXT: Record<AppLocale, {
  close: string;
  archiveSession: string;
  removeWorktree: string;
  removeWorktreeTitle: string;
  removeWorktreeDesc: string;
  removing: string;
  confirmRemove: string;
  cancel: string;
  createWorktreeFromCommit: string;
  createBranchFromCommit: string;
  explainInspectCommit: string;
  cherryPickCurrentBranch: string;
  revertCurrentBranch: string;
  copyCommitId: string;
  createBranch: string;
  createWorktree: string;
  checkoutNewLocalBranch: string;
  checkout: string;
  deleteBranch: string;
  createBranchFromWorktree: string;
  openWorktree: string;
  bindAgent: string;
  unbindAgent: string;
  commit: string;
  push: string;
  commitPush: string;
  commitSync: string;
}> = {
  "zh-CN": {
    close: "关闭", archiveSession: "归档会话", removeWorktree: "移除 worktree", removeWorktreeTitle: "移除 worktree？", removeWorktreeDesc: "这会删除 worktree 目录并清理 Git worktree 记录，目录内文件会被删除。", removing: "移除中...", confirmRemove: "确认移除", cancel: "取消",
    createWorktreeFromCommit: "从提交创建 worktree", createBranchFromCommit: "从提交创建分支", explainInspectCommit: "解释 / 检查提交", cherryPickCurrentBranch: "Cherry-pick 到当前分支", revertCurrentBranch: "在当前分支 Revert", copyCommitId: "复制提交 ID",
    createBranch: "创建分支", createWorktree: "创建 worktree", checkoutNewLocalBranch: "检出为本地新分支", checkout: "检出", deleteBranch: "删除分支", createBranchFromWorktree: "从 worktree 创建分支", openWorktree: "打开 worktree", bindAgent: "绑定 Agent", unbindAgent: "解绑 Agent",
    commit: "提交", push: "推送", commitPush: "提交并推送", commitSync: "提交并同步"
  },
  "zh-TW": {
    close: "關閉", archiveSession: "封存會話", removeWorktree: "移除 worktree", removeWorktreeTitle: "移除 worktree？", removeWorktreeDesc: "這會刪除 worktree 目錄並清理 Git worktree 記錄，目錄內檔案會被刪除。", removing: "移除中...", confirmRemove: "確認移除", cancel: "取消",
    createWorktreeFromCommit: "從提交建立 worktree", createBranchFromCommit: "從提交建立分支", explainInspectCommit: "解釋 / 檢查提交", cherryPickCurrentBranch: "Cherry-pick 到目前分支", revertCurrentBranch: "在目前分支 Revert", copyCommitId: "複製提交 ID",
    createBranch: "建立分支", createWorktree: "建立 worktree", checkoutNewLocalBranch: "檢出為本地新分支", checkout: "檢出", deleteBranch: "刪除分支", createBranchFromWorktree: "從 worktree 建立分支", openWorktree: "開啟 worktree", bindAgent: "綁定 Agent", unbindAgent: "解除綁定 Agent",
    commit: "提交", push: "推送", commitPush: "提交並推送", commitSync: "提交並同步"
  },
  "en-US": {
    close: "Close", archiveSession: "Archive session", removeWorktree: "Remove worktree", removeWorktreeTitle: "Remove worktree?", removeWorktreeDesc: "This will remove the worktree directory and clean up the Git worktree entry. Files inside will be deleted.", removing: "Removing...", confirmRemove: "Confirm Remove", cancel: "Cancel",
    createWorktreeFromCommit: "Create worktree from commit", createBranchFromCommit: "Create branch from commit", explainInspectCommit: "Explain / inspect commit", cherryPickCurrentBranch: "Cherry-pick to current branch", revertCurrentBranch: "Revert on current branch", copyCommitId: "Copy commit ID",
    createBranch: "Create Branch", createWorktree: "Create Worktree", checkoutNewLocalBranch: "Checkout as new local branch", checkout: "Checkout", deleteBranch: "Delete Branch", createBranchFromWorktree: "Create Branch from Worktree", openWorktree: "Open Worktree", bindAgent: "Bind Agent", unbindAgent: "Unbind Agent",
    commit: "Commit", push: "Push", commitPush: "Commit & Push", commitSync: "Commit & Sync"
  }
};

function getAppText(language: GeneralSettingsDraft["language"]): (typeof APP_TEXT)[AppLocale] {
  const locale = language === "system" ? normalizeAppLocale(navigator.language || "zh-CN") : normalizeAppLocale(language);
  return APP_TEXT[locale];
}

function loadGeneralSettings(): GeneralSettingsDraft {
  try {
    const raw = window.localStorage.getItem(GENERAL_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<GeneralSettingsDraft> : {};
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...parsed,
      language: normalizeStoredLanguage(parsed.language),
      autoAcceptPermissions: loadLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, parsed.autoAcceptPermissions ?? DEFAULT_GENERAL_SETTINGS.autoAcceptPermissions)
    };
  } catch {
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      autoAcceptPermissions: loadLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, DEFAULT_GENERAL_SETTINGS.autoAcceptPermissions)
    };
  }
}

function saveGeneralSettings(settings: GeneralSettingsDraft): void {
  try {
    window.localStorage.setItem(GENERAL_SETTINGS_KEY, JSON.stringify(settings));
    saveLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, settings.autoAcceptPermissions);
  } catch {
    // ignore unavailable storage
  }
}

function playSettingsTone(kind: "agent" | "permission" | "error"): void {
  try {
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = kind === "error" ? 190 : kind === "permission" ? 520 : 740;
    osc.type = kind === "error" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    window.setTimeout(() => void ctx.close().catch(() => {}), 360);
  } catch {
    // ignore unavailable audio
  }
}

async function showSettingsNotification(title: string, body: string): Promise<void> {
  try {
    await invoke("send_desktop_notification", { title, body });
    return;
  } catch {
    // Fall back to browser notifications when native notification is unavailable.
  }
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === "default") {
      await Notification.requestPermission().then((permission) => {
        if (permission === "granted") new Notification(title, { body });
      });
    }
  } catch {
    // ignore unavailable notifications
  }
}

function normalizeThinkingLevel(value: unknown): OpencodeThinkingLevel {
  const v = String(value || "").trim().toLowerCase();
  return OPENCODE_THINKING_LEVELS.some((item) => item.value === v) ? (v as OpencodeThinkingLevel) : "auto";
}

function allowAllPermissionRules(): OpencodePermissionRule[] {
  return [{ permission: "*", pattern: "*", action: "allow" }];
}

function splitCommandLine(input: string): string[] {
  const parts = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts
    .map((part) => part.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter(Boolean);
}

function parseKeyValueLines(input: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const eq = raw.indexOf("=");
    if (eq <= 0) continue;
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeArrayRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatSkillInstalls(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

function parseSkillInstallCount(value: unknown): number {
  const raw = String(value || "").trim().toUpperCase().replace(/\+/g, "").replace(/,/g, "");
  const match = raw.match(/([\d.]+)\s*([KM])?/);
  if (!match) return 0;
  const base = Number(match[1] || 0);
  if (!Number.isFinite(base)) return 0;
  if (match[2] === "M") return base * 1_000_000;
  if (match[2] === "K") return base * 1_000;
  return base;
}

function isTrustedSkillSource(source: unknown): boolean {
  const s = String(source || "").toLowerCase();
  return ["vercel-labs", "anthropics", "microsoft", "expo", "supabase", "remotion-dev"].some((prefix) => s.startsWith(prefix));
}

function skillQualityLabel(skill: Pick<OpencodeSkillSearchResult, "source" | "package" | "installs">): "trusted" | "popular" | "review" {
  if (isTrustedSkillSource(skill.source || skill.package)) return "trusted";
  if (parseSkillInstallCount(skill.installs) >= 1000) return "popular";
  return "review";
}

function expandSkillSearchQueries(query: string): string[] {
  const q = query.trim().toLowerCase();
  const terms = new Set<string>([q]);
  const aliases: Array<[RegExp, string[]]> = [
    [/\breact\b/, ["react best practices", "react performance", "nextjs react"]],
    [/\bfrontend|ui|design\b/, ["frontend design", "web design", "design system", "accessibility"]],
    [/\btest|testing|jest|playwright\b/, ["testing", "unit testing", "e2e testing", "playwright"]],
    [/\bdeploy|deployment|ci\b/, ["deployment", "ci cd", "docker deploy"]],
    [/\bdocs|documentation|readme\b/, ["documentation", "readme", "api docs"]],
    [/\breview|lint|refactor\b/, ["code review", "lint", "refactor", "best practices"]],
    [/\bmobile|native\b/, ["react native", "expo", "mobile testing"]]
  ];
  for (const [pattern, values] of aliases) {
    if (pattern.test(q)) values.forEach((value) => terms.add(value));
  }
  return Array.from(terms).filter(Boolean).slice(0, 3);
}

function opencodeSkillApiToResult(item: any): OpencodeSkillSearchResult | null {
  const id = String(item?.id || "").trim();
  const source = String(item?.source || (id ? id.split("/").slice(0, -1).join("/") : "")).trim();
  const slug = String(item?.slug || (id ? id.split("/").pop() : "")).trim();
  const name = String(item?.name || slug || id).trim();
  if (!source || !slug || !name) return null;
  return {
    id: id || `${source}/${slug}`,
    spec: `${source}@${slug}`,
    package: source,
    skill: name,
    installs: formatSkillInstalls(item?.installs),
    url: String(item?.url || ""),
    source,
    sourceType: String(item?.sourceType || ""),
    installUrl: item?.installUrl ? String(item.installUrl) : null,
    isDuplicate: Boolean(item?.isDuplicate),
    change: typeof item?.change === "number" ? item.change : undefined,
    installsYesterday: typeof item?.installsYesterday === "number" ? item.installsYesterday : undefined
  };
}

function skillsmpSkillToResult(item: any): OpencodeSkillSearchResult | null {
  const name = String(item?.name || "").trim();
  const githubUrl = String(item?.githubUrl || "").trim();
  const skillUrl = String(item?.skillUrl || "").trim();
  const author = String(item?.author || "").trim();
  if (!name) return null;
  const source = (() => {
    try {
      const url = new URL(githubUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : author;
    } catch {
      return author;
    }
  })();
  const installSpec = source || null;
  return {
    id: String(item?.id || `${source}/${name}`),
    spec: source ? `${source}@${name}` : name,
    package: source || author,
    skill: name,
    installs: formatSkillInstalls(item?.stars || 0),
    url: skillUrl,
    source: source || author,
    sourceType: "skillsmp",
    installSpec,
    installUrl: githubUrl || null
  };
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getSkillsMarketplaceSeedQuery(categorySlug: string): string {
  const slug = categorySlug.trim().toLowerCase();
  if (!slug) return "agent";
  const seedBySlug: Record<string, string> = {
    frontend: "frontend",
    backend: "backend",
    "full-stack": "full stack",
    mobile: "mobile",
    "architecture-patterns": "architecture",
    testing: "testing",
    "code-quality": "code quality",
    security: "security",
    debugging: "debugging",
    "automation-tools": "automation",
    "productivity-tools": "productivity",
    "cli-tools": "cli",
    "llm-ai": "ai",
    "machine-learning": "machine learning",
    "data-analysis": "data analysis",
    "git-workflows": "git",
    cicd: "ci cd",
    cloud: "cloud",
    "technical-docs": "documentation",
    "knowledge-base": "knowledge base",
    "sales-marketing": "marketing",
    "project-management": "project management",
    design: "design",
    "content-creation": "content"
  };
  return seedBySlug[slug] || slug.replace(/-/g, " ");
}

function getSkillAvatarLabel(skillName: string): string {
  const parts = skillName
    .trim()
    .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean);
  if (parts.length === 0) return "SK";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || "S"}${parts[1][0] || "K"}`.toUpperCase();
}

function isInstalledOpencodeSkill(item: { path?: string; agents?: string[] }): boolean {
  const normalizedPath = String(item.path || "").replace(/\\/g, "/");
  const isInstalledDir = normalizedPath.includes("/.agents/skills/") || normalizedPath.includes("/.opencode/skills/");
  const agents = Array.isArray(item.agents) ? item.agents : [];
  const targetsOpencode = agents.length === 0 || agents.some((agent) => agent.toLowerCase() === "opencode");
  return isInstalledDir && targetsOpencode;
}

function scheduleAfterInteraction(task: () => void, delay = 240): number {
  return window.setTimeout(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(task));
  }, delay);
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 7000): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, cache: "force-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchSkillsmpJson(endpoint: string, apiKey = "", timeoutMs = 12000): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const resp = await fetch(`https://skillsmp.com${endpoint}`, { headers, signal: controller.signal });
    if (!resp.ok) throw new Error(`SkillsMP HTTP ${resp.status}`);
    const json = await resp.json();
    if (json?.success === false) throw new Error(json?.error?.message || "SkillsMP request failed");
    return json;
  } finally {
    window.clearTimeout(timer);
  }
}

function buildSkillsmpSearchEndpoint(input: { query: string; page?: number; limit?: number; sortBy?: "stars" | "recent"; category?: string; occupation?: string }): string {
  const params = new URLSearchParams({
    q: input.query,
    page: String(input.page || 1),
    limit: String(input.limit || 100),
    sortBy: input.sortBy || "stars"
  });
  if (input.category?.trim()) params.set("category", input.category.trim());
  if (input.occupation?.trim()) params.set("occupation", input.occupation.trim());
  return `/api/v1/skills/search?${params.toString()}`;
}

function makeId(): string {
  return Math.random().toString(16).slice(2, 14);
}

function readImageFileAsAttachment(file: File): Promise<OpencodeImageAttachment | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => resolve(null));
    reader.addEventListener("load", () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      const comma = raw.indexOf(",");
      if (!raw || comma < 0) {
        resolve(null);
        return;
      }
      resolve({
        id: `img-${makeId()}`,
        filename: file.name || `image-${Date.now()}.png`,
        mime: file.type || "image/png",
        dataUrl: `data:${file.type || "image/png"};base64,${raw.slice(comma + 1)}`
      });
    });
    reader.readAsDataURL(file);
  });
}

function opencodeSavedModelsStorageKey(): string {
  return OPENCODE_SAVED_MODELS_KEY;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function firstLetter(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
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

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [uiFontSize, setUiFontSize] = useState(() => Number(loadLocalString(UI_FONT_SIZE_KEY, "13")) || 13);
  const [codeFontSize, setCodeFontSize] = useState(() => Number(loadLocalString(CODE_FONT_SIZE_KEY, "12")) || 12);
  const [opencodePreviewImage, setOpencodePreviewImage] = useState<{ images: Array<{ uri: string; filename?: string }>; index: number } | null>(null);
  const [panelPlacement, setPanelPlacement] = useState<PanelPlacement>("hidden");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"general" | "appearance" | "modules" | "plugins" | "mobile" | "opencode" | "models" | "skillsmp" | "mcp">("general");
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsDraft>(() => loadGeneralSettings());
  const appText = useMemo(() => getAppText(generalSettings.language), [generalSettings.language]);
  const [showMobileControlDialog, setShowMobileControlDialog] = useState(false);
  const [showOpencodeApiDialog, setShowOpencodeApiDialog] = useState(false);
  const [showGraphPopover, setShowGraphPopover] = useState(false);
  const [showEnvSetup, setShowEnvSetup] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
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
  const [sessionContextMenu, setSessionContextMenu] = useState<{ x: number; y: number; repo: RepositoryEntry; session: OpencodeChatSession } | null>(null);
  const [commitContextMenu, setCommitContextMenu] = useState<{ x: number; y: number; sha: string; branch?: string; subject?: string } | null>(null);
  const [commitHoverCard, setCommitHoverCard] = useState<{ x: number; y: number; sha: string; subject?: string; author?: string; date?: string; branch?: string } | null>(null);
  const [topologyContextMenu, setTopologyContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [topologyCreateSourceNodeId, setTopologyCreateSourceNodeId] = useState("");
  const [topologyInspectNodeId, setTopologyInspectNodeId] = useState("");
  const [selectedWorktreePath, setSelectedWorktreePath] = useState("");

  // Panel is fused into the center reading area.

  const [repos, setRepos] = useState<RepositoryEntry[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepositoryEntry | null>(null);
  const [gitPaneRepo, setGitPaneRepo] = useState<RepositoryEntry | null>(null);
  const [newSessionTargetRepoId, setNewSessionTargetRepoId] = useState("");

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
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>("changes");
  const [rightModuleVisibility, setRightModuleVisibility] = useState<Record<RightPaneTab, boolean>>(() => loadRightModuleVisibility());
  const [commitMessage, setCommitMessage] = useState("");
  const [showCommitActionMenu, setShowCommitActionMenu] = useState(false);
  const [gitOperation, setGitOperation] = useState<"commit" | "push" | "sync" | "commitPush" | "commitSync" | "cherryPick" | "revert" | null>(null);
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
  const [checkingDeps, setCheckingDeps] = useState<Record<RuntimeDepName, boolean>>({
    git: false,
    entire: false,
    opencode: false,
    giteam: false
  });
  const [installingDep, setInstallingDep] = useState("");
  const [installingElapsed, setInstallingElapsed] = useState(0);
  const [runtimeJobId, setRuntimeJobId] = useState("");
  const [runtimeJob, setRuntimeJob] = useState<RuntimeActionJobStatus | null>(null);
  const [expandedLogDep, setExpandedLogDep] = useState<RuntimeDepName | null>(null);
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
  const [opencodeMcpPromptRefs, setOpencodeMcpPromptRefs] = useState<string[]>([]);
  const [opencodeImageAttachments, setOpencodeImageAttachments] = useState<OpencodeImageAttachment[]>([]);
  const [opencodeAttachmentMenuOpen, setOpencodeAttachmentMenuOpen] = useState(false);
  const [opencodeAgents, setOpencodeAgents] = useState<OpencodeAgentInfo[]>([]);
  const [opencodeAgentsLoading, setOpencodeAgentsLoading] = useState(false);
  const [opencodeAgentsError, setOpencodeAgentsError] = useState("");
  const [opencodeAgentSearch, setOpencodeAgentSearch] = useState("");
  const [opencodeDraftAgent, setOpencodeDraftAgent] = useState<OpencodeComposerAgentName>(() => normalizeComposerAgentName(loadLocalString(OPENCODE_AGENT_SELECTION_KEY, "build")));
  const [opencodeSessionAgent, setOpencodeSessionAgent] = useState<Record<string, string>>({});
  const [showOpencodeThinkingPicker, setShowOpencodeThinkingPicker] = useState(false);
  const [opencodeDraftThinkingLevel, setOpencodeDraftThinkingLevel] = useState<OpencodeThinkingLevel>(() => normalizeThinkingLevel(loadLocalString(OPENCODE_THINKING_SELECTION_KEY, "auto")));
  const [opencodeSessionThinkingLevel, setOpencodeSessionThinkingLevel] = useState<Record<string, OpencodeThinkingLevel>>({});
  const [opencodeAutoAcceptPermissions, setOpencodeAutoAcceptPermissions] = useState(() => loadLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, false));
  const [opencodePermissionRequests, setOpencodePermissionRequests] = useState<OpencodePermissionRequest[]>([]);
  const [opencodePermissionLoading, setOpencodePermissionLoading] = useState(false);
  const [showOpencodeModulePanel, setShowOpencodeModulePanel] = useState(false);
  const [opencodeModuleTab, setOpencodeModuleTab] = useState<OpencodeModuleTab>("permissions");
  const opencodeSkillsVisible = rightPaneTab === "skills" || (showOpencodeModulePanel && opencodeModuleTab === "skills");
  const opencodeMcpVisible = rightPaneTab === "mcp" || (showOpencodeModulePanel && opencodeModuleTab === "mcp");
  const [opencodeMcpStatus, setOpencodeMcpStatus] = useState<OpencodeMcpStatusMap>({});
  const [opencodeMcpLoading, setOpencodeMcpLoading] = useState(false);
  const opencodeMcpLoadingRef = useRef(false);
  const opencodeMcpLoadedRef = useRef(false);
  const [opencodeMcpError, setOpencodeMcpError] = useState("");
  const [opencodeMcpName, setOpencodeMcpName] = useState("");
  const [opencodeMcpType, setOpencodeMcpType] = useState<OpencodeMcpType>("remote");
  const [opencodeMcpCommand, setOpencodeMcpCommand] = useState("");
  const [opencodeMcpUrl, setOpencodeMcpUrl] = useState("");
  const [opencodeMcpEnv, setOpencodeMcpEnv] = useState("");
  const [opencodeMcpHeaders, setOpencodeMcpHeaders] = useState("");
  const [opencodeMcpJson, setOpencodeMcpJson] = useState("");
  const [opencodeMcpCustomParamValues, setOpencodeMcpCustomParamValues] = useState<Record<string, string>>({});
  const opencodeMcpAutoNameRef = useRef("");
  const [opencodeMcpBusyName, setOpencodeMcpBusyName] = useState("");
  const [showMcpAddForm, setShowMcpAddForm] = useState(false);
  const [mcpInstalledOpen, setMcpInstalledOpen] = useState(false);
  const [editingMcpName, setEditingMcpName] = useState("");
  const [editingMcpParamValues, setEditingMcpParamValues] = useState<Record<string, string>>({});
  const [opencodeSkills, setOpencodeSkills] = useState<OpencodeSkillInfo[]>([]);
  const [opencodeSkillsLoading, setOpencodeSkillsLoading] = useState(false);
  const [opencodeSkillsLoadedOnce, setOpencodeSkillsLoadedOnce] = useState(false);
  const [opencodeSkillsError, setOpencodeSkillsError] = useState("");
  const [opencodeSkillInstallSpec, setOpencodeSkillInstallSpec] = useState("");
  const [opencodeSkillInstallScope, setOpencodeSkillInstallScope] = useState<"project" | "global">("project");
  const [opencodeSkillSearchQuery, setOpencodeSkillSearchQuery] = useState("");
  const [opencodeSkillSearchStrategy, setOpencodeSkillSearchStrategy] = useState<OpencodeSkillSearchStrategy>("keyword");
  const [opencodeSkillCategory, setOpencodeSkillCategory] = useState("");
  const [skillsmpApiKey, setSkillsmpApiKey] = useState(() => loadLocalString(SKILLSMP_API_KEY_STORAGE_KEY, ""));
  const [skillsmpApiKeyDraft, setSkillsmpApiKeyDraft] = useState(() => loadLocalString(SKILLSMP_API_KEY_STORAGE_KEY, ""));
  const [showSkillsmpSettings, setShowSkillsmpSettings] = useState(false);
  const [showSkillInstallMenu, setShowSkillInstallMenu] = useState(false);
  const [opencodeSkillSearchResults, setOpencodeSkillSearchResults] = useState<OpencodeSkillSearchResult[]>([]);
  const [opencodeSkillSearchLoading, setOpencodeSkillSearchLoading] = useState(false);
  const [opencodeSkillSearchCache, setOpencodeSkillSearchCache] = useState<Record<string, OpencodeSkillSearchResult[]>>({});
  const [opencodeSkillInstallingSpec, setOpencodeSkillInstallingSpec] = useState("");
  const [opencodeSkillInstallNotice, setOpencodeSkillInstallNotice] = useState("");
  const [opencodeSkillInstallLog, setOpencodeSkillInstallLog] = useState("");
  const opencodeSkillDisplayBatchSize = 50;
  const [opencodeSkillDisplayLimit, setOpencodeSkillDisplayLimit] = useState(opencodeSkillDisplayBatchSize);
  const [opencodeSkillRevealLoading, setOpencodeSkillRevealLoading] = useState(false);
  const [opencodeSkillDiscoveredRows, setOpencodeSkillDiscoveredRows] = useState<OpencodeSkillSearchResult[]>([]);

  useEffect(() => {
    setGeneralSettings((prev) => {
      if (prev.autoAcceptPermissions === opencodeAutoAcceptPermissions) return prev;
      const next = { ...prev, autoAcceptPermissions: opencodeAutoAcceptPermissions };
      saveGeneralSettings(next);
      return next;
    });
  }, [opencodeAutoAcceptPermissions]);

  useEffect(() => {
    const lang = generalSettings.language === "system" ? navigator.language || "zh-CN" : generalSettings.language;
    document.documentElement.lang = lang;
  }, [generalSettings.language]);
  const opencodeSkillMarketListRef = useRef<HTMLDivElement | null>(null);
  const [opencodeSkillCatalogView, setOpencodeSkillCatalogView] = useState<"all-time" | "trending" | "hot" | "official">("all-time");
  const [opencodeSkillCatalogRows, setOpencodeSkillCatalogRows] = useState<OpencodeSkillSearchResult[]>([]);
  const [opencodeSkillCatalogLoading, setOpencodeSkillCatalogLoading] = useState(false);
  const [opencodeSkillCatalogPage, setOpencodeSkillCatalogPage] = useState(0);
  const [opencodeSkillCatalogQuery, setOpencodeSkillCatalogQuery] = useState("agent");
  const [opencodeSkillCatalogTotal, setOpencodeSkillCatalogTotal] = useState(0);
  const [opencodeSkillCatalogHasMore, setOpencodeSkillCatalogHasMore] = useState(false);
  const [opencodeSkillCatalogCache, setOpencodeSkillCatalogCache] = useState<Record<string, { rows: OpencodeSkillSearchResult[]; page: number; total: number; hasMore: boolean }>>({});
  const [opencodeSkillCatalogAttempted, setOpencodeSkillCatalogAttempted] = useState<Record<string, boolean>>({});
  const [opencodeSkillSearchMeta, setOpencodeSkillSearchMeta] = useState<{ count: number; searchType: string; durationMs: number } | null>(null);
  const [opencodeSkillAllowBackendCatalogFetch, setOpencodeSkillAllowBackendCatalogFetch] = useState(false);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<OpencodeSkillSearchResult | null>(null);
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<OpencodeSkillDetail | null>(null);
  const [selectedSkillAudits, setSelectedSkillAudits] = useState<OpencodeSkillAudit[]>([]);
  const [selectedSkillLoading, setSelectedSkillLoading] = useState(false);
  const [opencodeSkillListFilter, setOpencodeSkillListFilter] = useState<"all" | "global" | "project" | "source">("all");
  const [opencodeSkillListQuery, setOpencodeSkillListQuery] = useState("");
  const [opencodeSkillSourceInput, setOpencodeSkillSourceInput] = useState("");
  const [opencodeSkillSourceKind, setOpencodeSkillSourceKind] = useState<"url" | "path">("url");
  const [opencodeSkillBusy, setOpencodeSkillBusy] = useState(false);
  const [opencodeSkillRemovingKey, setOpencodeSkillRemovingKey] = useState("");
  const opencodeSkillCatalogRequestRef = useRef(0);
  const opencodeSkillsRepoPathRef = useRef("");
  const opencodeSkillsByRepoRef = useRef<Record<string, OpencodeSkillInfo[]>>({});
  const [opencodeSlashCommands, setOpencodeSlashCommands] = useState<OpencodeSlashCommand[]>([]);
  const [opencodeSlashOpen, setOpencodeSlashOpen] = useState(false);
  const [opencodeSlashActiveIndex, setOpencodeSlashActiveIndex] = useState(0);
  const [opencodeAutoFollowLatest, setOpencodeAutoFollowLatest] = useState(true);
  const [opencodeShowJumpLatest, setOpencodeShowJumpLatest] = useState(false);
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
  const opencodeInputComposingRef = useRef(false);
  const opencodeImageInputRef = useRef<HTMLInputElement | null>(null);
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
  const opencodePassiveSyncSeqRef = useRef(0);
  const opencodePrevScrollTopRef = useRef(0);
  const opencodeAutoFollowLatestRef = useRef(true);
  const opencodeAutoScrollTokenRef = useRef(0);
  const opencodeScrollModeRef = useRef<"follow" | "paused">("follow");
  const opencodeUserScrollPauseUntilRef = useRef(0);
  const opencodeUserScrollUpUntilRef = useRef(0);
  const opencodeUserScrollDownUntilRef = useRef(0);
  const opencodePausedScrollSnapshotRef = useRef<{ top: number; height: number } | null>(null);
  const opencodeForceScrollLatestSessionRef = useRef("");
  const opencodeProgrammaticScrollUntilRef = useRef(0);
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
  const previousSessionBusyRef = useRef(false);
  const previousPermissionCountRef = useRef(0);
  const previousErrorRef = useRef("");

  useEffect(() => {
    if (!generalSettings.releaseNotes) return;
    const seen = window.localStorage.getItem(RELEASE_NOTES_SEEN_KEY);
    if (seen === APP_RELEASE_VERSION) return;
    window.localStorage.setItem(RELEASE_NOTES_SEEN_KEY, APP_RELEASE_VERSION);
    setMessage(`Giteam ${APP_RELEASE_VERSION}: 设置已支持依赖管理和通用偏好。`);
    setShowReleaseNotes(true);
  }, [generalSettings.releaseNotes]);
  const terminalInitialSnapshot = useMemo(() => readTerminalTabSnapshot(), []);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>(() =>
    terminalInitialSnapshot?.tabs || [createTerminalTabState("terminal-1", "终端 1")]
  );
  const [activeTerminalTabId, setActiveTerminalTabId] = useState(() => terminalInitialSnapshot?.activeId || "terminal-1");
  const [terminalSidebarVisible, setTerminalSidebarVisible] = useState(true);
  const terminalTabCounterRef = useRef(terminalInitialSnapshot?.counter || 2);
  const terminalSeqRef = useRef<Record<string, number>>(
    Object.fromEntries((terminalInitialSnapshot?.tabs || [createTerminalTabState("terminal-1", "终端 1")]).map((tab) => [tab.id, 0]))
  );
  const terminalRepoResetReadyRef = useRef(false);
  const terminalLogRef = useRef<HTMLDivElement | null>(null);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);
  const terminalInputShellRef = useRef<HTMLDivElement | null>(null);
  const terminalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const terminalTextSelectingRef = useRef(false);
  const terminalBufferedOutputRef = useRef<Record<string, string>>({});
  const [terminalInputNearTop, setTerminalInputNearTop] = useState(false);
  const opencodeModelConfigLoadedRef = useRef(false);
  const opencodeConfiguredModelsLoadedRef = useRef(false);
  const opencodeModelPrefsLoadedRef = useRef(false);
  const opencodePromptHistoryBySessionRef = useRef<Record<string, string[]>>({});
  const opencodePromptHistoryIndexBySessionRef = useRef<Record<string, number>>({});
  const opencodePromptHistoryDraftBySessionRef = useRef<Record<string, string>>({});

  const builtinOpencodeSlashCommands = useMemo<OpencodeSlashCommand[]>(() => [
    { id: "builtin-new", trigger: "new", title: "New session", description: "开始一个新会话", source: "builtin" },
    { id: "builtin-compact", trigger: "compact", title: "Compact", description: "压缩当前会话上下文", source: "builtin" },
    { id: "builtin-model", trigger: "model", title: "Model", description: "切换当前模型", source: "builtin" },
    { id: "builtin-agent", trigger: "agent", title: "Agent", description: "切换 agent", source: "builtin" },
    { id: "builtin-open", trigger: "open", title: "Open", description: "搜索文件、命令和会话", source: "builtin" },
    { id: "builtin-terminal", trigger: "terminal", title: "Terminal", description: "打开或聚焦终端", source: "builtin" },
    { id: "builtin-mcp", trigger: "mcp", title: "MCP", description: "切换 MCPs", source: "builtin" },
    { id: "builtin-workspace", trigger: "workspace", title: "Workspace", description: "在侧边栏启用或禁用多个工作区", source: "builtin" },
    { id: "builtin-init", trigger: "init", title: "Init", description: "create/update AGENTS.md", source: "builtin" },
    { id: "builtin-review", trigger: "review", title: "Review", description: "review changes [commit|branch|pr]", source: "builtin" }
  ], []);

  const opencodeSlashQuery = useMemo(() => {
    const match = opencodePromptInput.match(/^\/(\S*)$/);
    return match ? match[1].toLowerCase() : "";
  }, [opencodePromptInput]);

  const opencodeSlashSuggestions = useMemo(() => {
    if (!opencodeSlashOpen) return [];
    const all = [...builtinOpencodeSlashCommands, ...opencodeSlashCommands];
    const seen = new Set<string>();
    return all
      .filter((cmd) => {
        const key = cmd.trigger.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return !opencodeSlashQuery || key.includes(opencodeSlashQuery) || cmd.title.toLowerCase().includes(opencodeSlashQuery);
      });
  }, [builtinOpencodeSlashCommands, opencodeSlashCommands, opencodeSlashOpen, opencodeSlashQuery]);

  useEffect(() => {
    if (!IS_TAURI) return;
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
  const gitPanePath = gitPaneRepo?.path ?? repoPath;
  const repoPathRef = useRef(repoPath);
  const gitPanePathRef = useRef(gitPanePath);
  const selectedWorktreeFileRef = useRef(selectedWorktreeFile);
  const rightPaneTabRef = useRef(rightPaneTab);
  const gitAutoRefreshBlockedRef = useRef(false);
  const gitAutoRefreshTimerRef = useRef<number | null>(null);
  const workspacePath = normalizeWorkspacePath(repoPath);

  useEffect(() => {
    if (!repoPath.trim()) {
      setOpencodeSlashCommands([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const base = await invoke<string>("get_opencode_service_base", { repoPath });
        const resp = await fetch(`${base}/command?directory=${encodeURIComponent(repoPath)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const rows = await resp.json();
        if (cancelled) return;
        const commands: OpencodeSlashCommand[] = (Array.isArray(rows) ? rows : [])
          .map((item: any): OpencodeSlashCommand | null => {
            const name = String(item?.name || item?.command || item?.id || "").replace(/^\//, "").trim();
            if (!name) return null;
            const sourceRaw = String(item?.source || item?.type || "command").toLowerCase();
            const source: OpencodeSlashCommand["source"] = sourceRaw.includes("skill")
              ? "skill"
              : sourceRaw.includes("mcp")
                ? "mcp"
                : "command";
            return {
              id: `opencode-${source}-${name}`,
              trigger: name,
              title: String(item?.title || item?.description || name),
              description: String(item?.description || ""),
              source
            };
          })
          .filter(Boolean) as OpencodeSlashCommand[];
        setOpencodeSlashCommands(commands);
      } catch (e) {
        appendOpencodeDebugLog(`command.list.warn ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath.trim() || !runtimeStatus.opencode.installed) return;
    void refreshOpencodeAgents();
  }, [repoPath, runtimeStatus.opencode.installed]);

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
  const commitMenuAvailable = hasCommittableChanges || needsGitSync;
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
            : gitOperation === "cherryPick"
              ? "Cherry-picking..."
              : gitOperation === "revert"
                ? "Reverting..."
            : "";

  useEffect(() => {
    repoPathRef.current = repoPath;
    gitPanePathRef.current = gitPanePath;
    selectedWorktreeFileRef.current = selectedWorktreeFile;
    rightPaneTabRef.current = rightPaneTab;
    gitAutoRefreshBlockedRef.current = busy || committing || pushing || discardingAll || !!discardingFile || !!stagingFile || !!unstagingFile;
  }, [repoPath, gitPanePath, selectedWorktreeFile, rightPaneTab, busy, committing, pushing, discardingAll, discardingFile, stagingFile, unstagingFile]);

  useEffect(() => {
    if (!opencodeSkillsVisible) return;
    if (opencodeSkillsRepoPathRef.current === repoPath) return;
    opencodeSkillsRepoPathRef.current = repoPath;
    const timer = scheduleAfterInteraction(() => {
      const cached = opencodeSkillsByRepoRef.current[repoPath] || null;
      startTransition(() => {
        if (cached) setOpencodeSkills(cached);
        setOpencodeSkillsLoadedOnce(Boolean(cached));
        setOpencodeSkillsLoading(!cached);
        setOpencodeSkillsError("");
        setOpencodeSkillListQuery("");
        setOpencodeSkillRemovingKey("");
      });
      if (!cached) {
        scheduleAfterInteraction(() => void refreshOpencodeSkills(), 220);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [opencodeSkillsVisible, repoPath]);

  useEffect(() => {
    if (rightPaneTab !== "terminal" || !activeTerminalTab || !repoPath.trim()) return;
    const input = activeTerminalTab.input;
    if (!input.trim()) {
      updateTerminalTabById(activeTerminalTab.id, (prev) => (
        prev.completionItems.length === 0 && !prev.completionToken ? prev : { ...prev, completionItems: [], completionIndex: 0, completionToken: "" }
      ));
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshTerminalCompletions(activeTerminalTab, input);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [activeTerminalTab?.id, activeTerminalTab?.input, activeTerminalTab?.cwd, repoPath, rightPaneTab]);
  const activeTerminalView = useMemo(
    () => splitTerminalOutputForInput(activeTerminalTab?.output || ""),
    [activeTerminalTab?.output]
  );
  const activeTerminalGhostText = useMemo(() => {
    const tab = activeTerminalTab;
    if (!tab?.completionItems?.length || !tab.completionToken) return "";
    const candidate = tab.completionItems[tab.completionIndex] || tab.completionItems[0] || "";
    if (!candidate || !candidate.startsWith(tab.completionToken)) return "";
    return candidate.slice(tab.completionToken.length);
  }, [activeTerminalTab]);
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
    const isAvailableModel = (full: string) => isModelRefAvailable(full, {
      connectedProviders: opencodeConnectedProviders,
      liveModelsByProvider: opencodeModelsByProvider,
      providerNames: opencodeProviderNames
    });
    const sessionId = activeOpencodeSessionId.trim();
    const fromSession = sessionId ? normalizeModelRef(opencodeSessionModel[sessionId] || "") : "";
    if (fromSession && isAvailableModel(fromSession)) return fromSession;
    const fromDraft = normalizeModelRef(opencodeDraftModel || "");
    if (fromDraft && isAvailableModel(fromDraft)) return fromDraft;
    const configured = normalizeModelRef(opencodeConfig?.configuredModel || "");
    if (configured && isAvailableModel(configured)) return configured;
    const recent = normalizeModelRef(opencodeSavedModels[0] || "");
    if (recent && isAvailableModel(recent)) return recent;
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
    opencodeModelsByProvider,
    opencodeProviderNames
  ]);
  const opencodeMessages = activeOpencodeSession?.messages ?? [];
  const opencodeTurnStart = activeOpencodeSession?.turnStart ?? 0;
  const opencodeSessionLoading = Boolean(activeOpencodeSessionId && activeOpencodeSession && !activeOpencodeSession.loaded);
  const activeOpencodeSessionBusy = Boolean(activeOpencodeSessionId && opencodeRunBusyBySession[activeOpencodeSessionId]);
  const activeOpencodeStreamingAssistantId = activeOpencodeSessionId ? (opencodeStreamingAssistantIdBySession[activeOpencodeSessionId] || "") : "";
  const visibleOpencodeAgents = useMemo(() => {
    const q = opencodeAgentSearch.trim().toLowerCase();
    const rows = opencodeAgents.filter((agent) => !agent.hidden && agent.mode !== "subagent");
    const filtered = q
      ? rows.filter((agent) => agent.name.toLowerCase().includes(q) || String(agent.description || "").toLowerCase().includes(q))
      : rows;
    return filtered.sort((a, b) => {
      const aPrimary = a.name === "build" || a.mode === "primary" ? 1 : 0;
      const bPrimary = b.name === "build" || b.mode === "primary" ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      return a.name.localeCompare(b.name);
    });
  }, [opencodeAgents, opencodeAgentSearch]);
  const activeOpencodeAgent = useMemo(() => {
    const sessionId = activeOpencodeSessionId.trim();
    const fromSession = sessionId ? (opencodeSessionAgent[sessionId] || "") : "";
    const normalizedFromSession = fromSession.trim().toLowerCase();
    if (isComposerAgentName(normalizedFromSession)) return normalizedFromSession;
    return normalizeComposerAgentName(opencodeDraftAgent);
  }, [activeOpencodeSessionId, opencodeSessionAgent, opencodeDraftAgent]);
  const activeOpencodeThinkingLevel = useMemo(() => {
    const sessionId = activeOpencodeSessionId.trim();
    return normalizeThinkingLevel(sessionId ? (opencodeSessionThinkingLevel[sessionId] || opencodeDraftThinkingLevel) : opencodeDraftThinkingLevel);
  }, [activeOpencodeSessionId, opencodeSessionThinkingLevel, opencodeDraftThinkingLevel]);
  const activeOpencodeThinkingLabel = OPENCODE_THINKING_LEVELS.find((item) => item.value === activeOpencodeThinkingLevel)?.label || "Auto";
  const opencodeActivePermissions = useMemo(() => {
    const sid = activeOpencodeSessionId.trim();
    return opencodePermissionRequests.filter((req) => !sid || req.sessionID === sid);
  }, [opencodePermissionRequests, activeOpencodeSessionId]);

  useEffect(() => {
    const wasBusy = previousSessionBusyRef.current;
    previousSessionBusyRef.current = activeOpencodeSessionBusy;
    if (!wasBusy || activeOpencodeSessionBusy) return;
    if (generalSettings.soundsAgent) playSettingsTone("agent");
    if (generalSettings.notificationsAgent) void showSettingsNotification("Agent finished", activeOpencodeSession?.title || "OpenCode session is idle");
  }, [activeOpencodeSessionBusy, activeOpencodeSession?.title, generalSettings.soundsAgent, generalSettings.notificationsAgent]);

  useEffect(() => {
    const previous = previousPermissionCountRef.current;
    previousPermissionCountRef.current = opencodeActivePermissions.length;
    if (opencodeActivePermissions.length <= previous) return;
    const latest = opencodeActivePermissions[opencodeActivePermissions.length - 1];
    if (generalSettings.soundsPermissions) playSettingsTone("permission");
    if (generalSettings.notificationsPermissions) void showSettingsNotification("Permission required", latest?.permission || "OpenCode is waiting for approval");
  }, [opencodeActivePermissions, generalSettings.soundsPermissions, generalSettings.notificationsPermissions]);

  useEffect(() => {
    const nextError = String(error || "").trim();
    const previous = previousErrorRef.current;
    previousErrorRef.current = nextError;
    if (!nextError || nextError === previous) return;
    if (generalSettings.soundsErrors) playSettingsTone("error");
    if (generalSettings.notificationsErrors) void showSettingsNotification("Giteam error", nextError.slice(0, 120));
  }, [error, generalSettings.soundsErrors, generalSettings.notificationsErrors]);
  const opencodeMcpRows = useMemo(() => opencodeMcpVisible ? Object.entries(opencodeMcpStatus).sort(([a], [b]) => a.localeCompare(b)) : [], [opencodeMcpVisible, opencodeMcpStatus]);
  const filteredOpencodeSkills = useMemo(() => {
    if (!opencodeSkillsVisible) return [];
    const query = opencodeSkillListQuery.trim().toLowerCase();
    return opencodeSkills.filter((skill) => {
      const scope = skill.scope || "source";
      if (opencodeSkillListFilter !== "all" && scope !== opencodeSkillListFilter) return false;
      if (!query) return true;
      return [skill.name, skill.description, skill.path, skill.location]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [opencodeSkillsVisible, opencodeSkills, opencodeSkillListFilter, opencodeSkillListQuery]);
  const opencodeFallbackMarketplaceRows = useMemo(() => opencodeSkillsVisible ? OPENCODE_RECOMMENDED_SKILLS.map((skill, index): OpencodeSkillSearchResult => ({
    spec: skill.spec,
    package: skill.source,
    skill: skill.title,
    installs: skill.installs,
    url: "",
    id: skill.spec.includes("@") ? `${skill.source}/${skill.spec.split("@").pop()}` : skill.spec,
    source: skill.source,
    sourceType: "recommended",
    change: index === 0 ? 24 : undefined
  })) : [], [opencodeSkillsVisible]);
  const opencodeMarketplaceRows = useMemo(() => {
    if (!opencodeSkillsVisible) return [];
    return opencodeSkillSearchResults.length > 0
      ? opencodeSkillSearchResults
      : opencodeSkillCatalogRows.length > 0
        ? opencodeSkillCatalogRows
        : Array.from(new Map([...opencodeFallbackMarketplaceRows, ...opencodeSkillDiscoveredRows].map((item) => [item.spec, item])).values());
  }, [opencodeSkillsVisible, opencodeSkillSearchResults, opencodeSkillCatalogRows, opencodeFallbackMarketplaceRows, opencodeSkillDiscoveredRows]);
  const visibleOpencodeMarketplaceRows = opencodeMarketplaceRows.slice(0, opencodeSkillDisplayLimit);
  const opencodeCanRevealMoreSkills = visibleOpencodeMarketplaceRows.length < opencodeMarketplaceRows.length;
  const opencodeCanFetchMoreCatalogSkills = opencodeSkillSearchResults.length === 0 && opencodeSkillCatalogRows.length > 0 && opencodeSkillCatalogHasMore;
  const opencodeSkillsInitialLoading = opencodeSkillCatalogLoading && opencodeSkillCatalogRows.length === 0 && opencodeSkillSearchResults.length === 0;
  const opencodeSkillsSearching = opencodeSkillSearchLoading;
  const opencodeSkillsPaging = (opencodeSkillCatalogLoading && opencodeSkillCatalogRows.length > 0 && opencodeSkillSearchResults.length === 0) || opencodeSkillRevealLoading;
  const opencodeInstalledSkillNodes = useMemo(() => {
    if (!opencodeSkillsVisible) return null;
    if (opencodeSkills.length === 0) return <div className="gt-module-empty">暂无已安装 Skills</div>;
    return opencodeSkills.map((skill) => {
      return (
        <button key={`${skill.scope || "project"}-${skill.name}`} type="button" className="gt-installed-skill-chip is-reference" onClick={() => referenceOpencodeSkill(skill)} title={`Use ${skill.name}`}>
          <div><strong>{skill.name}</strong><small>{skill.scope || "project"}</small></div>
        </button>
      );
    });
  }, [opencodeSkillsVisible, opencodeSkills, opencodeSlashCommands]);
  const opencodeSkillCardNodes = useMemo(() => {
    if (!opencodeSkillsVisible) return null;
    return visibleOpencodeMarketplaceRows.map((result, idx) => {
      const resultInstallSpec = result.installSpec || result.spec;
      const isInstallingThisSkill = opencodeSkillInstallingSpec === resultInstallSpec || opencodeSkillInstallingSpec === result.spec;
      return <article
        key={result.id || result.spec}
        role="button"
        tabIndex={0}
        className={selectedMarketplaceSkill?.spec === result.spec ? "gt-skill-card-item active" : "gt-skill-card-item"}
        onClick={() => void selectMarketplaceSkill(result)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") void selectMarketplaceSkill(result);
        }}
      >
        <span className="gt-skill-card-rank">{String(idx + 1).padStart(2, "0")}</span>
        <div className="gt-skill-card-copy">
          <strong>{result.skill}</strong>
          <small>{result.package}</small>
          <div className="gt-skill-card-tags">
            <span className={`gt-skill-quality ${skillQualityLabel(result)}`}>{skillQualityLabel(result)}</span>
            <span className="gt-skill-card-spec">{resultInstallSpec}</span>
          </div>
        </div>
        <div className="gt-skill-card-stats">
          <b>★ {result.installs}</b>
          <small>{typeof result.change === "number" ? `${result.change >= 0 ? "+" : ""}${result.change} today` : "trusted listing"}</small>
        </div>
        <button className={isInstallingThisSkill ? "gt-skill-get-btn is-installing" : "gt-skill-get-btn"} type="button" disabled={isInstallingThisSkill || opencodeSkillBusy} onClick={(e) => {
          e.stopPropagation();
          if (opencodeSkillBusy) return;
          void installOpencodeSkillFromRegistry(resultInstallSpec, "project", [result.installUrl || "", result.url || "", result.spec]);
        }}>{isInstallingThisSkill ? "Installing" : "Get"}</button>
        {isInstallingThisSkill ? <div className="gt-skill-card-install-log">{opencodeSkillInstallLog || "正在启动安装日志..."}</div> : null}
      </article>;
    });
  }, [opencodeSkillsVisible, visibleOpencodeMarketplaceRows, selectedMarketplaceSkill?.spec, opencodeSkillInstallingSpec, opencodeSkillBusy, opencodeSkillInstallLog]);
  const settingsSkillsContent = useMemo(() => (
    <div className="settings-skills-manager">
      {opencodeSkillsError ? <div className="gt-module-empty danger">{opencodeSkillsError}</div> : null}
      <div className="settings-skills-grid">
        {opencodeSkills.length === 0 ? <div className="gt-module-empty">暂无已安装 Skills。</div> : opencodeSkills.map((skill) => {
          const removeKey = `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`;
          const removable = (skill.scope || "source") !== "source";
          const scopeLabel = skill.scope === "global" ? "Global" : skill.scope === "project" ? "Repo" : "Source";
          return (
            <article key={removeKey} className="settings-skill-card">
              <div className="settings-skill-card-main">
                <div className="settings-skill-card-title">
                  <strong>{skill.name}</strong>
                  <span>{scopeLabel}</span>
                </div>
                <p>{skill.description || skill.path || skill.location || "Installed via skills.sh"}</p>
              </div>
              <details className="settings-skill-menu">
                <summary aria-label={`${skill.name} actions`} title="Actions"><span aria-hidden="true">...</span></summary>
                <div className="settings-skill-menu-panel">
                  <button className="settings-skill-remove" type="button" disabled={!removable || opencodeSkillRemovingKey === removeKey} onClick={() => void removeOpencodeSkill(skill)} title={removable ? "Uninstall skill" : "Source skills need to be removed from source config"}>{opencodeSkillRemovingKey === removeKey ? "Removing" : "Uninstall"}</button>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  ), [opencodeSkills, opencodeSkillsLoading, opencodeSkillsError, repoPath, opencodeSkillRemovingKey]);

  const settingsMcpContent = useMemo(() => (
    <div className="settings-skills-manager">
      {opencodeMcpError ? <div className="gt-module-empty danger">{opencodeMcpError}</div> : null}
      <div className="settings-skills-grid">
        {opencodeMcpRows.length === 0 ? <div className="gt-module-empty">暂无已安装 MCP Server。</div> : opencodeMcpRows.map(([name, status]) => {
          const s: any = status || {};
          const source = String(s.source || (s.configured ? "project" : "runtime"));
          const sourceLabel = source === "both" ? "项目+全局" : source === "global" ? "全局" : source === "project" ? "项目" : source;
          return (
            <article key={name} className="settings-skill-card">
              <button type="button" className="settings-skill-card-main gt-settings-mcp-card-main" onClick={() => startEditMcpParams(name, status)}>
                <div className="settings-skill-card-title">
                  <strong>{name}</strong>
                  <span>{String(s.type || "mcp")}</span>
                </div>
                <p>{sourceLabel} · {getInstalledMcpTools(name).length} tools · use {name}</p>
              </button>
              <details className="settings-skill-menu">
                <summary aria-label={`${name} actions`} title="Actions"><span aria-hidden="true">...</span></summary>
                <div className="settings-skill-menu-panel">
                  <button className="settings-mcp-action" type="button" onClick={() => startEditMcpParams(name, status)}>配置参数</button>
                  <button className="settings-skill-remove" type="button" disabled={!!opencodeMcpBusyName} onClick={() => void removeOpencodeMcpServer(name)}>{opencodeMcpBusyName.endsWith(":remove") ? "删除中" : "删除"}</button>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  ), [opencodeMcpRows, opencodeMcpError, opencodeMcpBusyName, editingMcpName]);

  useEffect(() => {
    opencodeMcpLoadedRef.current = false;
    opencodeMcpLoadingRef.current = false;
  }, [repoPath]);

  useEffect(() => {
    if (!showMcpAddForm) return;
    const inferred = inferCustomMcpName(opencodeMcpJson);
    if (!inferred) return;
    const current = opencodeMcpName.trim();
    if (current && current !== opencodeMcpAutoNameRef.current) return;
    opencodeMcpAutoNameRef.current = inferred;
    setOpencodeMcpName(inferred);
  }, [showMcpAddForm, opencodeMcpJson, opencodeMcpName]);

  useEffect(() => {
    if (!showMcpAddForm) return;
    const specs = getCustomMcpParamSpecs(opencodeMcpJson, opencodeMcpName);
    setOpencodeMcpCustomParamValues((prev) => {
      const next: Record<string, string> = {};
      specs.forEach((spec) => { next[spec.key] = prev[spec.key] || ""; });
      return next;
    });
  }, [showMcpAddForm, opencodeMcpJson, opencodeMcpName]);

  useEffect(() => {
    if (!repoPath.trim() || !activeOpencodeSessionId.trim()) return;
    void refreshPendingPermissions(activeOpencodeSessionId);
    const shouldPollPermissions = activeOpencodeSessionBusy || opencodeAutoAcceptPermissions || (showOpencodeModulePanel && opencodeModuleTab === "permissions");
    if (!shouldPollPermissions) return;
    const timer = window.setInterval(() => {
      void refreshPendingPermissions(activeOpencodeSessionId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [repoPath, activeOpencodeSessionId, activeOpencodeSessionBusy, showOpencodeModulePanel, opencodeModuleTab, opencodeAutoAcceptPermissions]);

  useEffect(() => {
    if (!showOpencodeModulePanel) return;
    if (opencodeModuleTab === "agents") void refreshOpencodeAgents();
    if (opencodeModuleTab === "permissions") void refreshPendingPermissions();
    if (opencodeModuleTab === "mcp" && !opencodeMcpLoadedRef.current) void refreshOpencodeMcpStatus();
    if (opencodeModuleTab === "skills") {
      const timer = scheduleAfterInteraction(() => void refreshOpencodeSkills(), 280);
      return () => window.clearTimeout(timer);
    }
  }, [showOpencodeModulePanel, opencodeModuleTab, repoPath]);

  useEffect(() => {
    if (opencodeSkillsVisible) {
      if (!opencodeSkillsLoadedOnce && !opencodeSkillsLoading) {
        const timer = scheduleAfterInteraction(() => void refreshOpencodeSkills(), 280);
        return () => window.clearTimeout(timer);
      }
    }
    if (opencodeMcpVisible && !opencodeMcpLoadedRef.current) {
      const timer = scheduleAfterInteraction(() => void refreshOpencodeMcpStatus(), 280);
      return () => window.clearTimeout(timer);
    }
  }, [opencodeSkillsVisible, opencodeMcpVisible, repoPath, opencodeSkillsLoadedOnce, opencodeSkillsLoading]);

  useEffect(() => {
    if (!opencodeSkillsVisible) return;
    if (opencodeSkillSearchResults.length > 0) return;
    if (opencodeSkillCatalogRows.length > 0) return;
    if (opencodeSkillCatalogAttempted[opencodeSkillCatalogCacheKey(opencodeSkillCatalogView)]) return;
    const timer = scheduleAfterInteraction(() => void loadInitialSkillsmpCatalog(), 320);
    return () => window.clearTimeout(timer);
  }, [opencodeSkillsVisible, opencodeSkillCatalogRows.length, opencodeSkillSearchResults.length, opencodeSkillCatalogLoading, repoPath, opencodeSkillCatalogAttempted, opencodeSkillCatalogView]);

  useEffect(() => {
    if (!opencodeSkillsVisible) return;
    if (!repoPath.trim()) return;
    if (opencodeSkillsLoadedOnce && (opencodeSkillCatalogRows.length > 0 || opencodeSkillCatalogAttempted[opencodeSkillCatalogCacheKey(opencodeSkillCatalogView)])) return;
    const timer = window.setTimeout(() => {
      void warmSkillsMarketplace();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [opencodeSkillsVisible, repoPath, opencodeSkillsLoadedOnce, opencodeSkillCatalogRows.length, opencodeSkillSearchResults.length, opencodeSkillsLoading, opencodeSkillCatalogLoading, opencodeSkillCatalogAttempted, opencodeSkillCatalogView]);

  useEffect(() => {
    if (!opencodeSkillsVisible) return;
    if (opencodeMarketplaceRows.length === 0) return;
    setSelectedMarketplaceSkill((prev) => {
      if (prev && opencodeMarketplaceRows.some((row) => row.spec === prev.spec)) return prev;
      return opencodeMarketplaceRows[0];
    });
  }, [opencodeSkillsVisible, opencodeMarketplaceRows]);

  useEffect(() => {
    if (!opencodeSkillsVisible) return;
    const el = opencodeSkillMarketListRef.current;
    if (!el || opencodeSkillsInitialLoading || opencodeSkillsPaging) return;
    if (el.scrollHeight - el.clientHeight > 520) return;
    if (opencodeCanRevealMoreSkills) {
      revealMoreOpencodeSkills();
      return;
    }
    if (opencodeCanFetchMoreCatalogSkills) {
      void fetchOpencodeSkillCatalog(opencodeSkillCatalogView, opencodeSkillCatalogPage + 1);
    }
  }, [opencodeSkillsVisible, visibleOpencodeMarketplaceRows.length, opencodeCanRevealMoreSkills, opencodeCanFetchMoreCatalogSkills, opencodeSkillsInitialLoading, opencodeSkillsPaging, opencodeSkillCatalogView, opencodeSkillCatalogPage]);

  useEffect(() => {
    saveRightModuleVisibility(rightModuleVisibility);
    if (rightModuleVisibility[rightPaneTab]) return;
    const next = (["changes", "worktree", "terminal", "skills", "mcp"] as RightPaneTab[]).find((tab) => rightModuleVisibility[tab]);
    if (next) setRightPaneTab(next);
  }, [rightModuleVisibility, rightPaneTab]);

  useEffect(() => {
    const ui = Math.min(18, Math.max(11, uiFontSize));
    const code = Math.min(18, Math.max(10, codeFontSize));
    document.documentElement.style.setProperty("--gt-ui-font-size", `${ui}px`);
    document.documentElement.style.setProperty("--gt-code-font-size", `${code}px`);
    saveLocalString(UI_FONT_SIZE_KEY, String(ui));
    saveLocalString(CODE_FONT_SIZE_KEY, String(code));
  }, [uiFontSize, codeFontSize]);

  useEffect(() => {
    if (!showSettings || !runtimeStatus.opencode.installed) return;
    if (Number(opencodeServiceSettings.port) === Number(opencodeServiceSettingsSavedPort)) return;
    const timer = window.setTimeout(() => {
      void saveOpencodeServiceSettingsIfNeeded();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [showSettings, runtimeStatus.opencode.installed, opencodeServiceSettings.port, opencodeServiceSettingsSavedPort]);

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

  function toggleRightModuleVisibility(tab: RightPaneTab) {
    setRightModuleVisibility((prev) => {
      const enabledCount = Object.values(prev).filter(Boolean).length;
      if (prev[tab] && enabledCount <= 1) return prev;
      return { ...prev, [tab]: !prev[tab] };
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
        title,
        agent: activeOpencodeAgent || null,
        permission: opencodeAutoAcceptPermissions ? allowAllPermissionRules() : null
      });
      const next = opencodeSessionFromSummary(created, opencodeSessions.length + 1);
      next.loaded = true;
      setOpencodeSessions((prev) => (prev.some((s) => s.id === created.id) ? prev : [next, ...prev]));
      const targetRepoId = repos.find((repo) => normalizeWorkspacePath(repo.path) === normalizeWorkspacePath(target))?.id || selectedRepo?.id || "";
      upsertSidebarOpencodeSession(targetRepoId, next);
      setActiveOpencodeSessionId(created.id);
      if (activeOpencodeAgent) setOpencodeSessionAgent((prev) => ({ ...prev, [created.id]: activeOpencodeAgent }));
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

  function upsertSidebarOpencodeSession(repoId: string, session: OpencodeChatSession) {
    const id = repoId.trim();
    if (!id || !session.id.trim()) return;
    setSidebarOpencodeSessionsByRepo((prev) => {
      const limit = Math.max(OPENCODE_SESSION_PAGE_SIZE, sidebarOpencodeSessionFetchLimitByRepo[id] ?? OPENCODE_SESSION_PAGE_SIZE);
      const existing = prev[id] || [];
      const merged = [session, ...existing.filter((item) => item.id !== session.id)]
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limit);
      return { ...prev, [id]: merged };
    });
    setSidebarOpencodeSessionFetchLimitByRepo((prev) => ({
      ...prev,
      [id]: Math.max(OPENCODE_SESSION_PAGE_SIZE, prev[id] ?? OPENCODE_SESSION_PAGE_SIZE)
    }));
  }

  function updateSidebarOpencodeSession(repoId: string, sessionId: string, updater: (session: OpencodeChatSession) => OpencodeChatSession) {
    const id = repoId.trim();
    const sid = sessionId.trim();
    if (!id || !sid) return;
    setSidebarOpencodeSessionsByRepo((prev) => {
      const sessions = prev[id] || [];
      if (!sessions.some((session) => session.id === sid)) return prev;
      const next = sessions
        .map((session) => (session.id === sid ? updater(session) : session))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return { ...prev, [id]: next };
    });
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
    setNewSessionTargetRepoId(repo.id);
    setExpandedProjectIds((prev) => (prev.includes(repo.id) ? prev.filter((id) => id !== repo.id) : [...prev, repo.id]));
    const sessionsCached = Object.prototype.hasOwnProperty.call(sidebarOpencodeSessionsByRepo, repo.id);
    if (!expanded && runtimeStatus.opencode.installed && !sessionsCached) {
      void refreshSidebarRepoSessions(repo).catch((e) => setError(String(e)));
    }
  }

  function startDraftSessionForRepo(repo: RepositoryEntry) {
    setNewSessionTargetRepoId(repo.id);
    setExpandedProjectIds((prev) => (prev.includes(repo.id) ? prev : [...prev, repo.id]));
    opencodeSessionsRepoIdRef.current = repo.id;
    if (selectedRepo?.id !== repo.id) setSelectedRepo(repo);
    if ((rightPaneTabRef.current === "changes" || rightPaneTabRef.current === "worktree") && gitPaneRepo?.id !== repo.id) setGitPaneRepo(repo);
    setOpencodeSessionFetchLimit(getRepoSessionFetchLimit(repo.id));
    setDraftOpencodeSession(true);
    setActiveOpencodeSessionId("");
    setOpencodePromptInput("");
    requestAnimationFrame(() => opencodeInputRef.current?.focus());
  }
  const opencodeSavedModelCandidates = useMemo(() => {
    const q = opencodeModelPickerSearch.trim().toLowerCase();
    if (!q) return opencodeSavedModels;
    return opencodeSavedModels.filter((m) => m.toLowerCase().includes(q));
  }, [opencodeSavedModels, opencodeModelPickerSearch]);

  const opencodeConfiguredModelCandidates = useMemo(() => {
    // Picker shows configured models + locally enabled models (OpenCode-like local visibility semantics).
    return buildConfiguredModelCandidates({
      configuredProviders: opencodeConfiguredProviders,
      configuredModelsByProvider: opencodeConfiguredModelsByProvider,
      configuredModelNamesByProvider: opencodeConfiguredModelNamesByProvider,
      liveModelNamesByProvider: opencodeModelNamesByProvider,
      enabledModels: opencodeEnabledModels,
      hiddenModels: opencodeHiddenModels,
      connectedProviders: opencodeConnectedProviders,
      liveModelsByProvider: opencodeModelsByProvider,
      providerNames: opencodeProviderNames,
      search: opencodeModelPickerSearch
    });
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

  const opencodeSyncModelRefs = useMemo(() => {
    return buildSyncModelRefs({
      configuredProviders: opencodeConfiguredProviders,
      configuredModelsByProvider: opencodeConfiguredModelsByProvider,
      enabledModels: opencodeEnabledModels,
      hiddenModels: opencodeHiddenModels,
      connectedProviders: opencodeConnectedProviders,
      liveModelsByProvider: opencodeModelsByProvider,
      providerNames: opencodeProviderNames,
      activeModel: activeOpencodeModel,
      configuredModel: opencodeConfig?.configuredModel || ""
    });
  }, [
    activeOpencodeModel,
    opencodeConfig?.configuredModel,
    opencodeConfiguredModelsByProvider,
    opencodeConfiguredProviders,
    opencodeConnectedProviders,
    opencodeEnabledModels,
    opencodeHiddenModels,
    opencodeModelsByProvider,
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
    const label = (provider ? (opencodeModelNamesByProvider[provider]?.[modelId] || opencodeConfiguredModelNamesByProvider[provider]?.[modelId]) : "") || normalized || "Auto";
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

  function applyOpencodeAgent(agentName: string) {
    const name = normalizeComposerAgentName(agentName);
    const sid = activeOpencodeSessionId.trim();
    if (sid) {
      setOpencodeSessionAgent((prev) => ({ ...prev, [sid]: name }));
    } else {
      setOpencodeDraftAgent(name);
    }
    saveLocalString(OPENCODE_AGENT_SELECTION_KEY, name);
    setMessage(`Switched agent: ${name}`);
  }

  function applyOpencodeThinkingLevel(level: OpencodeThinkingLevel) {
    const next = normalizeThinkingLevel(level);
    const sid = activeOpencodeSessionId.trim();
    if (sid) {
      setOpencodeSessionThinkingLevel((prev) => ({ ...prev, [sid]: next }));
    } else {
      setOpencodeDraftThinkingLevel(next);
    }
    saveLocalString(OPENCODE_THINKING_SELECTION_KEY, next);
    setShowOpencodeThinkingPicker(false);
    setMessage(`Thinking: ${OPENCODE_THINKING_LEVELS.find((item) => item.value === next)?.label || next}`);
  }

  async function refreshOpencodeAgents() {
    if (!repoPath.trim()) return;
    setOpencodeAgentsLoading(true);
    setOpencodeAgentsError("");
    try {
      const raw = await invoke<unknown>("list_opencode_agents", { repoPath });
      const rows = normalizeArrayRows(raw)
        .map((item: any): OpencodeAgentInfo | null => {
          const name = String(item?.name || "").trim();
          if (!name) return null;
          return {
            name,
            description: String(item?.description || ""),
            mode: item?.mode === "subagent" || item?.mode === "primary" || item?.mode === "all" ? item.mode : undefined,
            native: Boolean(item?.native),
            hidden: Boolean(item?.hidden),
            color: String(item?.color || ""),
            variant: String(item?.variant || ""),
            model: item?.model || undefined
          };
        })
        .filter(Boolean) as OpencodeAgentInfo[];
      setOpencodeAgents(rows);
    } catch (e) {
      const msg = String(e);
      setOpencodeAgentsError(msg);
      appendOpencodeDebugLog(`agent.list.error ${msg}`);
    } finally {
      setOpencodeAgentsLoading(false);
    }
  }

  async function refreshOpencodeSkills() {
    const requestRepoPath = repoPath.trim();
    if (!requestRepoPath) return;
    startTransition(() => {
      setOpencodeSkillsLoading(true);
      setOpencodeSkillsError("");
    });
    await waitForPaint();
    try {
      const installedRaw = await invoke<unknown>("list_installed_opencode_skills", { repoPath: requestRepoPath }).catch(() => []);
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      const installedRows = normalizeArrayRows(installedRaw).map((item: any) => ({
        name: String(item?.name || "").trim(),
        path: String(item?.path || ""),
        scope: (item?.scope === "global" ? "global" : "project") as "global" | "project",
        agents: Array.isArray(item?.agents) ? item.agents.map((x: unknown) => String(x || "")).filter(Boolean) : []
      })).filter((item) => item.name && isInstalledOpencodeSkill(item));
      const rows = installedRows.map((installed): OpencodeSkillInfo => {
        return {
          name: installed.name,
          description: "Installed via skills.sh",
          location: installed.path,
          license: "",
          compatibility: "",
          scope: installed.scope,
          path: installed.path,
          agents: installed.agents
        };
      });
      opencodeSkillsByRepoRef.current[requestRepoPath] = rows;
      startTransition(() => {
        setOpencodeSkills(rows.sort((a, b) => (a.scope || "").localeCompare(b.scope || "") || a.name.localeCompare(b.name)));
      });
    } catch (e) {
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      const msg = String(e);
      startTransition(() => setOpencodeSkillsError(msg));
      appendOpencodeDebugLog(`skill.list.error ${msg}`);
    } finally {
      if (repoPathRef.current.trim() === requestRepoPath) {
        startTransition(() => {
          setOpencodeSkillsLoadedOnce(true);
          setOpencodeSkillsLoading(false);
        });
      }
    }
  }

  async function searchOpencodeSkillRegistry(queryArg = opencodeSkillSearchQuery, strategyArg = opencodeSkillSearchStrategy) {
    if (!ensureRepoSelected()) return;
    const query = queryArg.trim();
    if (query.length < 2) {
      setOpencodeSkillSearchResults([]);
      return;
    }
    const cacheKey = `${strategyArg}:${opencodeSkillCategory || "all"}:${query.toLowerCase()}`;
    const cached = opencodeSkillSearchCache[cacheKey];
    if (cached) {
      setOpencodeSkillSearchResults(cached);
      setOpencodeSkillDisplayLimit(opencodeSkillDisplayBatchSize);
      setOpencodeSkillSearchMeta({ count: cached.length, searchType: `${strategyArg}-cache`, durationMs: 0 });
      return;
    }
    setOpencodeSkillSearchLoading(true);
    setOpencodeSkillsError("");
    try {
      if (strategyArg === "ai") {
        if (!skillsmpApiKey.trim()) {
          setOpencodeSkillsError("未配置 SKILLSMP_API_KEY，已自动切换到关键词搜索。可在 Settings 中配置后再用 AI 语义搜索。");
          setOpencodeSkillSearchStrategy("keyword");
          await searchOpencodeSkillRegistry(query, "keyword");
          return;
        }
        const raw = await fetchSkillsmpAiWithFallback(query);
        const rows = normalizeArrayRows(raw?.data?.skills || raw?.data).map(skillsmpSkillToResult).filter(Boolean) as OpencodeSkillSearchResult[];
        setOpencodeSkillSearchResults(rows);
        setOpencodeSkillDisplayLimit(opencodeSkillDisplayBatchSize);
        setOpencodeSkillSearchCache((prev) => ({ ...prev, [cacheKey]: rows }));
        setOpencodeSkillSearchMeta({ count: rows.length, searchType: "skillsmp-ai", durationMs: Number(raw?.meta?.responseTimeMs || 0) });
        return;
      }
      const collected: OpencodeSkillSearchResult[] = [];
      for (const q of [query]) {
        let raw = await fetchSkillsmpSearchWithFallback({
          query: q,
          page: 1,
          limit: 100,
          sortBy: "stars",
          category: opencodeSkillCategory || undefined
        });
        let rows = normalizeArrayRows(raw?.data?.skills).map(skillsmpSkillToResult).filter(Boolean) as OpencodeSkillSearchResult[];
        if (rows.length === 0 && opencodeSkillCategory) {
          raw = await fetchSkillsmpSearchWithFallback({
            query: q,
            page: 1,
            limit: 100,
            sortBy: "stars"
          });
          rows = normalizeArrayRows(raw?.data?.skills).map(skillsmpSkillToResult).filter(Boolean) as OpencodeSkillSearchResult[];
        }
        collected.push(...rows.map((row) => ({ ...row, sourceType: q === query ? "skillsmp" : `alt: ${q}` })));
      }
      const deduped = Array.from(new Map(collected.filter((item) => !item.isDuplicate).map((item) => [item.id || item.spec, item])).values());
      const sorted = deduped.sort((a, b) => {
        const trustedDelta = Number(isTrustedSkillSource(b.source || b.package)) - Number(isTrustedSkillSource(a.source || a.package));
        if (trustedDelta !== 0) return trustedDelta;
        return parseSkillInstallCount(b.installs) - parseSkillInstallCount(a.installs);
      });
      setOpencodeSkillSearchResults(sorted);
      setOpencodeSkillDisplayLimit(opencodeSkillDisplayBatchSize);
      setOpencodeSkillSearchCache((prev) => ({ ...prev, [cacheKey]: sorted }));
      setOpencodeSkillSearchMeta({ count: sorted.length, searchType: "skillsmp-keyword", durationMs: 0 });
    } catch (e) {
      const msg = "SkillsMP 搜索暂时不可用，已保留本地榜单。";
      setOpencodeSkillsError(msg);
      setOpencodeSkillSearchResults([]);
      setOpencodeSkillSearchMeta(null);
      appendOpencodeDebugLog(`skill.search.error ${String(e)}`);
    } finally {
      setOpencodeSkillSearchLoading(false);
    }
  }

  async function loadInitialSkillsmpCatalog() {
    if (!ensureRepoSelected() || opencodeSkillCatalogLoading || opencodeSkillCatalogRows.length > 0) return;
    if (opencodeSkillCatalogAttempted[opencodeSkillCatalogCacheKey(opencodeSkillCatalogView)]) return;
    await fetchOpencodeSkillCatalog(opencodeSkillCatalogView, 0);
  }

  function updateSkillsMarketplaceCategory(category: string) {
    setOpencodeSkillCategory(category);
    setOpencodeSkillCatalogRows([]);
    setOpencodeSkillCatalogPage(0);
    setOpencodeSkillSearchResults([]);
    setOpencodeSkillSearchMeta(null);
    setOpencodeSkillDisplayLimit(opencodeSkillDisplayBatchSize);
  }

  function opencodeSkillCatalogCacheKey(view: string, category = opencodeSkillCategory) {
    return `${view}:${category || "all"}`;
  }

  async function fetchSkillsmpSearchWithFallback(input: { query: string; page?: number; limit?: number; sortBy?: "stars" | "recent"; category?: string; occupation?: string }, options: { allowBackendFallback?: boolean } = {}) {
    try {
      return await fetchSkillsmpJson(buildSkillsmpSearchEndpoint(input), skillsmpApiKey);
    } catch (directError) {
      appendOpencodeDebugLog(`skillsmp.direct.error ${String(directError)}`);
      if (options.allowBackendFallback === false) throw directError;
      return await invoke<any>("fetch_skillsmp_skill_search", {
        repoPath,
        query: input.query,
        page: input.page,
        limit: input.limit,
        sortBy: input.sortBy,
        category: input.category,
        occupation: input.occupation,
        apiKey: skillsmpApiKey || undefined
      });
    }
  }

  async function fetchSkillsmpAiWithFallback(query: string) {
    try {
      return await fetchSkillsmpJson(`/api/v1/skills/ai-search?q=${encodeURIComponent(query)}`, skillsmpApiKey, 14000);
    } catch (directError) {
      appendOpencodeDebugLog(`skillsmp.ai.direct.error ${String(directError)}`);
      return await invoke<any>("fetch_skillsmp_ai_search", { repoPath, query, apiKey: skillsmpApiKey || undefined });
    }
  }

  function switchOpencodeSkillCatalogView(view: "all-time" | "trending" | "hot" | "official") {
    if (opencodeSkillCatalogView === view && opencodeSkillSearchResults.length === 0) return;
    setOpencodeSkillSearchResults([]);
    setOpencodeSkillSearchMeta(null);
    setOpencodeSkillCatalogView(view);
    setOpencodeSkillDisplayLimit(opencodeSkillDisplayBatchSize);
    setOpencodeSkillsError("");
    const cached = opencodeSkillCatalogCache[opencodeSkillCatalogCacheKey(view)];
    if (cached) {
      setOpencodeSkillCatalogRows(cached.rows);
      setOpencodeSkillCatalogPage(cached.page);
      setOpencodeSkillCatalogTotal(cached.total);
      setOpencodeSkillCatalogHasMore(cached.hasMore);
      return;
    }
    window.requestAnimationFrame(() => void fetchOpencodeSkillCatalog(view, 0));
  }

  async function warmSkillsMarketplace() {
    if (!repoPath.trim()) return;
    const tasks: Array<Promise<unknown>> = [];
    if (!opencodeSkillCatalogLoading && opencodeSkillCatalogRows.length === 0 && opencodeSkillSearchResults.length === 0 && !opencodeSkillCatalogAttempted[opencodeSkillCatalogCacheKey(opencodeSkillCatalogView)]) {
      tasks.push(loadInitialSkillsmpCatalog());
    }
    if (tasks.length === 0) return;
    await Promise.allSettled(tasks);
  }

  function handleOpencodeSkillMarketScroll() {
    const el = opencodeSkillMarketListRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom > 520) return;
    if (opencodeCanRevealMoreSkills && !opencodeSkillRevealLoading) {
      revealMoreOpencodeSkills();
      return;
    }
    if (!opencodeSkillAllowBackendCatalogFetch && opencodeMarketplaceRows.length < opencodeSkillDisplayBatchSize && !opencodeSkillCatalogRows.length && !opencodeSkillSearchResults.length) {
      setOpencodeSkillAllowBackendCatalogFetch(true);
      void fetchOpencodeSkillCatalog(opencodeSkillCatalogView, 0, { allowBackendFallback: true, force: true });
      return;
    }
    if (opencodeCanFetchMoreCatalogSkills && !opencodeSkillCatalogLoading) {
      void fetchOpencodeSkillCatalog(opencodeSkillCatalogView, opencodeSkillCatalogPage + 1);
      return;
    }
  }

  function revealMoreOpencodeSkills() {
    if (opencodeSkillRevealLoading) return;
    setOpencodeSkillRevealLoading(true);
    window.setTimeout(() => {
      setOpencodeSkillDisplayLimit((limit) => limit + opencodeSkillDisplayBatchSize);
      setOpencodeSkillRevealLoading(false);
    }, 360);
  }

  async function fetchOpencodeSkillCatalog(viewArg = opencodeSkillCatalogView, pageArg = 0, options: { allowBackendFallback?: boolean; force?: boolean } = {}) {
    const requestId = ++opencodeSkillCatalogRequestRef.current;
    const cacheKey = opencodeSkillCatalogCacheKey(viewArg);
    if (!options.force && opencodeSkillCatalogAttempted[cacheKey] && pageArg <= 0) return;
    startTransition(() => {
      setOpencodeSkillCatalogAttempted((prev) => ({ ...prev, [cacheKey]: true }));
      setOpencodeSkillCatalogLoading(true);
      setOpencodeSkillsError("");
    });
    await waitForPaint();
    try {
      const page = pageArg + 1;
      const sortBy = viewArg === "trending" || viewArg === "hot" ? "recent" : "stars";
      const viewQuery = viewArg === "official" ? "official" : viewArg === "hot" ? "popular" : "agent";
      const query = opencodeSkillCategory ? getSkillsMarketplaceSeedQuery(opencodeSkillCategory) : viewQuery;
      let json = await fetchSkillsmpSearchWithFallback({ query, page, limit: 100, sortBy, category: opencodeSkillCategory || undefined }, { allowBackendFallback: options.allowBackendFallback ?? true });
      let rows = normalizeArrayRows(json?.data?.skills).map(skillsmpSkillToResult).filter(Boolean) as OpencodeSkillSearchResult[];
      if (rows.length === 0 && opencodeSkillCategory) {
        json = await fetchSkillsmpSearchWithFallback({ query, page, limit: 100, sortBy }, { allowBackendFallback: options.allowBackendFallback ?? true });
        rows = normalizeArrayRows(json?.data?.skills).map(skillsmpSkillToResult).filter(Boolean) as OpencodeSkillSearchResult[];
      }
      const positiveStarRows = rows.filter((item) => parseSkillInstallCount(item.installs) > 0);
      if (positiveStarRows.length > 0) rows = positiveStarRows;
      rows = rows.slice().sort((a, b) => parseSkillInstallCount(b.installs) - parseSkillInstallCount(a.installs));
      if (requestId !== opencodeSkillCatalogRequestRef.current) return;
      const nextPage = Number(json?.data?.pagination?.page || page) - 1;
      const nextTotal = Number(json?.data?.pagination?.total || rows.length);
      const nextHasMore = Boolean(json?.data?.pagination?.hasNext);
      startTransition(() => {
        setOpencodeSkillCatalogRows((prev) => {
          const nextRows = rows.filter((item) => !item.isDuplicate);
          const mergedRows = pageArg <= 0 ? nextRows : Array.from(new Map([...prev, ...nextRows].map((item) => [item.id || item.spec, item])).values());
          setOpencodeSkillCatalogCache((cache) => ({
            ...cache,
            [opencodeSkillCatalogCacheKey(viewArg)]: { rows: mergedRows, page: nextPage, total: nextTotal, hasMore: nextHasMore }
          }));
          return mergedRows;
        });
        setOpencodeSkillDisplayLimit((limit) => Math.max(limit, opencodeSkillDisplayBatchSize));
        setOpencodeSkillCatalogPage(nextPage);
        setOpencodeSkillCatalogTotal(nextTotal);
        setOpencodeSkillCatalogHasMore(nextHasMore);
      });
    } catch (e) {
      if (requestId !== opencodeSkillCatalogRequestRef.current) return;
      startTransition(() => {
        setOpencodeSkillsError("");
        setOpencodeSkillCatalogRows([]);
        setOpencodeSkillCatalogHasMore(false);
      });
      appendOpencodeDebugLog(`skill.catalog.error ${String(e)}`);
    } finally {
      if (requestId === opencodeSkillCatalogRequestRef.current) startTransition(() => setOpencodeSkillCatalogLoading(false));
    }
  }

  async function selectMarketplaceSkill(skill: OpencodeSkillSearchResult) {
    setSelectedMarketplaceSkill(skill);
    setSelectedSkillDetail(null);
    setSelectedSkillAudits([]);
    setShowSkillInstallMenu(false);
  }

  async function loadSelectedMarketplaceSkillDetails(skill = selectedMarketplaceSkill) {
    if (!skill) return;
    const id = (skill.id || "").trim();
    if (!id || !repoPath.trim()) return;
    setSelectedSkillLoading(true);
    try {
      const [detailRaw, auditRaw] = await Promise.all([
        invoke<any>("fetch_opencode_skill_detail_api", { repoPath, id }).catch(() => null),
        invoke<any>("fetch_opencode_skill_audit_api", { repoPath, id }).catch(() => null)
      ]);
      if (detailRaw && typeof detailRaw === "object") {
        setSelectedSkillDetail({
          id: String(detailRaw?.id || id),
          source: String(detailRaw?.source || skill.source || skill.package),
          slug: String(detailRaw?.slug || skill.skill),
          installs: Number(detailRaw?.installs || 0),
          hash: detailRaw?.hash == null ? null : String(detailRaw.hash),
          files: Array.isArray(detailRaw?.files) ? detailRaw.files.map((file: any) => ({
            path: String(file?.path || ""),
            contents: String(file?.contents || "")
          })).filter((file: { path: string }) => file.path) : null
        });
      }
      setSelectedSkillAudits(Array.isArray(auditRaw?.audits) ? auditRaw.audits.map((audit: any) => ({
        provider: String(audit?.provider || "Audit"),
        slug: String(audit?.slug || ""),
        status: String(audit?.status || "unknown"),
        summary: String(audit?.summary || ""),
        auditedAt: String(audit?.auditedAt || ""),
        riskLevel: String(audit?.riskLevel || ""),
        categories: Array.isArray(audit?.categories) ? audit.categories.map((x: unknown) => String(x || "")).filter(Boolean) : []
      })) : []);
    } finally {
      setSelectedSkillLoading(false);
    }
  }

  async function refreshOpencodeMcpStatus() {
    if (!repoPath.trim()) return;
    if (opencodeMcpLoadingRef.current) return;
    opencodeMcpLoadingRef.current = true;
    const hasCachedRows = Object.keys(opencodeMcpStatus).length > 0;
    startTransition(() => {
      if (!hasCachedRows) setOpencodeMcpLoading(true);
      setOpencodeMcpError("");
    });
    await waitForPaint();
    try {
      const raw = await invoke<unknown>("list_opencode_mcp_status", { repoPath });
      startTransition(() => setOpencodeMcpStatus(raw && typeof raw === "object" && !Array.isArray(raw) ? raw as OpencodeMcpStatusMap : {}));
      opencodeMcpLoadedRef.current = true;
    } catch (e) {
      const msg = String(e);
      startTransition(() => setOpencodeMcpError(msg));
      appendOpencodeDebugLog(`mcp.status.error ${msg}`);
    } finally {
      opencodeMcpLoadingRef.current = false;
      startTransition(() => setOpencodeMcpLoading(false));
    }
  }

  async function refreshPendingPermissions(sessionIdArg = activeOpencodeSessionId) {
    if (!repoPath.trim()) return;
    setOpencodePermissionLoading(true);
    try {
      const raw = await invoke<unknown>("list_opencode_permissions", { repoPath });
      const rows = normalizeArrayRows(raw)
        .map((item: any): OpencodePermissionRequest | null => {
          const id = String(item?.id || "").trim();
          const sessionID = String(item?.sessionID || "").trim();
          if (!id || !sessionID) return null;
          return {
            id,
            sessionID,
            permission: String(item?.permission || ""),
            patterns: Array.isArray(item?.patterns) ? item.patterns.map((x: unknown) => String(x || "")).filter(Boolean) : [],
            always: Array.isArray(item?.always) ? item.always.map((x: unknown) => String(x || "")).filter(Boolean) : [],
            metadata: item?.metadata || undefined,
            tool: item?.tool || undefined
          };
        })
        .filter(Boolean) as OpencodePermissionRequest[];
      const sid = sessionIdArg.trim();
      const nextRows = sid ? rows.filter((row) => row.sessionID === sid) : rows;
      if (opencodeAutoAcceptPermissions) {
        await Promise.all(nextRows.map((req) => sendPermissionReply(req.id, "always", { silent: true })));
        setOpencodePermissionRequests((prev) => prev.filter((req) => !nextRows.some((row) => row.id === req.id)));
      } else {
        setOpencodePermissionRequests((prev) => {
          const rest = sid ? prev.filter((row) => row.sessionID !== sid) : [];
          return [...rest, ...nextRows];
        });
      }
    } catch (e) {
      appendOpencodeDebugLog(`permission.list.error ${String(e)}`);
    } finally {
      setOpencodePermissionLoading(false);
    }
  }

  async function ensureSessionAutoAcceptPermissions(sessionId: string) {
    if (!opencodeAutoAcceptPermissions || !repoPath.trim() || !sessionId.trim()) return;
    try {
      await invoke<unknown>("set_opencode_session_permission", {
        repoPath,
        sessionId,
        permission: allowAllPermissionRules()
      });
      appendOpencodeDebugLog(`permission.session.allowAll ${sessionId}`);
    } catch (e) {
      appendOpencodeDebugLog(`permission.session.allowAll.error ${String(e)}`);
    }
  }

  async function sendPermissionReply(requestId: string, reply: OpencodePermissionReply, opts?: { message?: string; silent?: boolean }) {
    if (!repoPath.trim() || !requestId.trim()) return false;
    try {
      await invoke<boolean>("post_opencode_permission_reply", {
        repoPath,
        requestId,
        reply,
        message: opts?.message || null
      });
      setOpencodePermissionRequests((prev) => prev.filter((req) => req.id !== requestId));
      appendOpencodeDebugLog(`permission.reply ${requestId} ${reply}`);
      if (!opts?.silent) setMessage(reply === "reject" ? "Permission rejected" : "Permission accepted");
      return true;
    } catch (e) {
      appendOpencodeDebugLog(`permission.reply.error ${requestId} ${String(e)}`);
      if (!opts?.silent) setError(String(e));
      return false;
    }
  }

  function handleIncomingPermission(request: OpencodePermissionRequest) {
    if (!request?.id) return;
    if (opencodeAutoAcceptPermissions) {
      void sendPermissionReply(request.id, "always", { silent: true });
      return;
    }
    setOpencodePermissionRequests((prev) => {
      const next = prev.filter((item) => item.id !== request.id);
      return [...next, request];
    });
  }

  function openOpencodeModulePanel(tab: OpencodeModuleTab) {
    setOpencodeModuleTab(tab);
    setShowOpencodeModulePanel(true);
    if (tab === "agents") void refreshOpencodeAgents();
    if (tab === "permissions") void refreshPendingPermissions();
    if (tab === "mcp") void refreshOpencodeMcpStatus();
    if (tab === "skills") void refreshOpencodeSkills();
  }

  async function addOpencodeMcpServer() {
    if (!ensureRepoSelected()) return;
    let normalized: { name: string; config: Record<string, unknown> };
    try {
      normalized = normalizeCustomMcpJson(opencodeMcpJson, opencodeMcpName);
    } catch (e) {
      setError(`MCP JSON 配置无效：${String(e instanceof Error ? e.message : e)}`);
      return;
    }
    const { name, config } = normalized;
    const paramSpecs = getCustomMcpParamSpecs(opencodeMcpJson, name);
    const missing = paramSpecs.filter((spec) => spec.required && !String(opencodeMcpCustomParamValues[spec.key] || "").trim());
    if (missing.length > 0) {
      setError(`请填写必填参数：${missing.map((spec) => spec.key).join(", ")}`);
      return;
    }
    const resolvedConfig = replaceMcpConfigPlaceholders(config, opencodeMcpCustomParamValues) as Record<string, unknown>;
    setOpencodeMcpBusyName(name);
    setOpencodeMcpError("");
    try {
      await invoke<unknown>("add_opencode_mcp_server", { repoPath, name, config: resolvedConfig });
      setOpencodeMcpStatus((prev) => ({ ...prev, [name]: { ...(resolvedConfig as any), status: "configured" } }));
      setOpencodeMcpName("");
      setOpencodeMcpCommand("");
      setOpencodeMcpUrl("");
      setOpencodeMcpEnv("");
      setOpencodeMcpHeaders("");
      setOpencodeMcpJson("");
      setOpencodeMcpCustomParamValues({});
      opencodeMcpAutoNameRef.current = "";
      setShowMcpAddForm(false);
      setMcpInstalledOpen(true);
      window.setTimeout(() => void refreshOpencodeMcpStatus(), 250);
      setMessage(`MCP added: ${name}`);
    } catch (e) {
      const msg = String(e);
      setOpencodeMcpError(msg);
      setError(msg);
    } finally {
      setOpencodeMcpBusyName("");
    }
  }

  async function addOpencodeMcpServerFromMarket(name: string, config: Record<string, unknown>) {
    if (!ensureRepoSelected()) return;
    const normalizedName = name.trim();
    if (!normalizedName) return;
    setOpencodeMcpBusyName(normalizedName);
    setOpencodeMcpError("");
    try {
      await invoke<unknown>("add_opencode_mcp_server", { repoPath, name: normalizedName, config });
      setOpencodeMcpStatus((prev) => ({ ...prev, [normalizedName]: { ...(config as any), status: "configured" } }));
      window.setTimeout(() => void refreshOpencodeMcpStatus(), 250);
      setMessage(`MCP added: ${normalizedName}`);
    } catch (e) {
      const msg = String(e);
      setOpencodeMcpError(msg);
      setError(msg);
      throw e;
    } finally {
      setOpencodeMcpBusyName("");
    }
  }

  async function runMcpAction(name: string, action: "connect" | "disconnect" | "auth" | "logout") {
    if (!ensureRepoSelected()) return;
    const n = name.trim();
    if (!n) return;
    setOpencodeMcpBusyName(`${n}:${action}`);
    setOpencodeMcpError("");
    try {
      if (action === "connect") await invoke<boolean>("connect_opencode_mcp_server", { repoPath, name: n });
      if (action === "disconnect") await invoke<boolean>("disconnect_opencode_mcp_server", { repoPath, name: n });
      if (action === "auth") await invoke<unknown>("authenticate_opencode_mcp_server", { repoPath, name: n });
      if (action === "logout") await invoke<boolean>("remove_opencode_mcp_auth", { repoPath, name: n });
      await refreshOpencodeMcpStatus();
      setMessage(`MCP ${action}: ${n}`);
    } catch (e) {
      const msg = String(e);
      setOpencodeMcpError(msg);
      setError(msg);
    } finally {
      setOpencodeMcpBusyName("");
    }
  }

  function getMcpMarketDefinition(name: string): any | null {
    const target = name.trim().toLowerCase();
    return Object.values(MCP_MARKET_SERVERS as Record<string, any>).find((server: any) => {
      const names = [server?.name, server?.display_name, String(server?.display_name || "").toLowerCase().replace(/\s+/g, "-")];
      return names.some((item) => String(item || "").trim().toLowerCase() === target);
    }) || null;
  }

  function getInstalledMcpParamSpecs(name: string, status: OpencodeMcpStatusMap[string]) {
    const s: any = status || {};
    const def = getMcpMarketDefinition(name);
    const specs = new Map<string, { key: string; required: boolean; description: string; example: string }>();
    const addSpec = (key: string, required = false, description = "", example = "") => {
      const k = key.trim();
      if (!k) return;
      const prev = specs.get(k);
      specs.set(k, {
        key: k,
        required: Boolean(prev?.required || required),
        description: prev?.description || description,
        example: prev?.example || example
      });
    };
    Object.entries(def?.arguments || {}).forEach(([key, arg]: [string, any]) => {
      addSpec(key, Boolean(arg?.required), String(arg?.description || ""), String(arg?.example || ""));
    });
    const scanPlaceholder = (value: unknown) => {
      const match = String(value ?? "").match(/^\$\{([^}]+)\}$/);
      if (match?.[1]) addSpec(match[1], true);
    };
    if (Array.isArray(s.command)) s.command.forEach(scanPlaceholder);
    Object.values(s.environment || {}).forEach(scanPlaceholder);
    Object.values(s.headers || {}).forEach(scanPlaceholder);
    if (specs.size === 0) {
      const params = s.type === "remote" ? s.headers : s.environment;
      Object.keys(params || {}).forEach((key) => addSpec(key, false));
    }
    return Array.from(specs.values());
  }

  function getInstalledMcpTools(name: string) {
    const def = getMcpMarketDefinition(name);
    return Array.isArray(def?.tools) ? def.tools : [];
  }

  function normalizeCustomMcpJson(input: string, fallbackName: string): { name: string; config: Record<string, unknown> } {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("config must be an object");
    const root = parsed as Record<string, any>;
    const wrapped = root.mcpServers || root.mcp;
    if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
      const entries = Object.entries(wrapped as Record<string, any>);
      if (entries.length !== 1 && !fallbackName.trim()) throw new Error("mcpServers/mcp 中包含多个 server，请填写名称");
      const [wrappedName, wrappedConfig] = fallbackName.trim()
        ? [fallbackName.trim(), (wrapped as Record<string, any>)[fallbackName.trim()] || entries[0]?.[1]]
        : entries[0];
      if (!wrappedConfig || typeof wrappedConfig !== "object" || Array.isArray(wrappedConfig)) throw new Error("server config must be an object");
      return normalizeCustomMcpConfig(wrappedName, wrappedConfig as Record<string, unknown>);
    }
    const entries = Object.entries(root);
    if (!root.type && !root.command && !root.url && entries.length === 1) {
      const [marketName, marketConfig] = entries[0] as [string, any];
      if (marketConfig && typeof marketConfig === "object" && !Array.isArray(marketConfig) && marketConfig.installations) {
        return normalizeMarketplaceMcpDefinition(fallbackName.trim() || marketName, marketConfig);
      }
    }
    if (root.installations) return normalizeMarketplaceMcpDefinition(fallbackName.trim() || String(root.name || ""), root);
    if (!root.type && !root.command && !root.url && entries.length === 1) {
      const [directName, directConfig] = entries[0] as [string, any];
      if (directConfig && typeof directConfig === "object" && !Array.isArray(directConfig)) {
        return normalizeCustomMcpConfig(fallbackName.trim() || directName, directConfig as Record<string, unknown>);
      }
    }
    return normalizeCustomMcpConfig(fallbackName.trim(), root);
  }

  function inferCustomMcpName(input: string): string {
    try {
      const parsed = JSON.parse(input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
      const root = parsed as Record<string, any>;
      if (root.installations && root.name) return String(root.name);
      const wrapped = root.mcpServers || root.mcp;
      const directMap = !wrapped && !root.type && !root.command && !root.url ? root : wrapped;
      if (directMap && typeof directMap === "object" && !Array.isArray(directMap)) {
        const entries = Object.entries(directMap as Record<string, any>);
        if (entries.length === 1) {
          const [key, value] = entries[0];
          if (value?.installations) return String(value.name || key);
        }
      }
      if (!directMap || typeof directMap !== "object" || Array.isArray(directMap)) return "";
      const keys = Object.keys(directMap).filter(Boolean);
      return keys.length === 1 ? keys[0] : "";
    } catch {
      return "";
    }
  }

  function normalizeCustomMcpConfig(name: string, raw: Record<string, unknown>): { name: string; config: Record<string, unknown> } {
    const config: Record<string, unknown> = { ...raw };
    if (!name) throw new Error("MCP name is required");
    if (!config.type) {
      if (typeof config.url === "string") config.type = "remote";
      else if (typeof config.command === "string" || Array.isArray(config.command)) config.type = "local";
    }
    if (typeof config.command === "string") {
      config.command = [config.command, ...(Array.isArray(config.args) ? config.args.map(String) : [])];
      delete config.args;
    } else if (Array.isArray(config.command) && Array.isArray(config.args)) {
      config.command = [...config.command.map(String), ...config.args.map(String)];
      delete config.args;
    }
    if (config.env && !config.environment) {
      config.environment = config.env;
      delete config.env;
    }
    if (typeof config.enabled === "undefined") config.enabled = true;
    if (config.type !== "local" && config.type !== "remote") throw new Error('必须包含 type: "local" 或 "remote"，或提供 command/url 以自动推断');
    if (config.type === "local" && (!Array.isArray(config.command) || config.command.length === 0)) throw new Error('local MCP 必须包含 command，例如 ["npx", "-y", "server"]');
    if (config.type === "remote" && typeof config.url !== "string") throw new Error('remote MCP 必须包含 url，例如 "https://mcp.example.com/mcp"');
    return { name, config };
  }

  function normalizeMarketplaceMcpDefinition(name: string, raw: any): { name: string; config: Record<string, unknown> } {
    const serverName = name || String(raw?.name || "").trim();
    if (!serverName) throw new Error("marketplace MCP 缺少名称");
    const installations = raw?.installations && typeof raw.installations === "object" ? raw.installations : null;
    if (!installations) throw new Error("marketplace MCP 缺少 installations");
    const entries = Object.entries(installations) as Array<[string, any]>;
    const [, install] = entries.find(([, item]) => item?.recommended) || entries[0] || [];
    if (!install || typeof install !== "object") throw new Error("marketplace MCP 没有可用安装方式");
    const command = [String(install.command || "").trim(), ...(Array.isArray(install.args) ? install.args.map(String) : [])].filter(Boolean);
    if (command.length === 0) throw new Error("marketplace MCP 安装方式缺少 command");
    const config: Record<string, unknown> = { type: "local", command, enabled: true };
    const env = install.env && typeof install.env === "object" ? { ...install.env } : undefined;
    if (env && Object.keys(env).length > 0) config.environment = env;
    return { name: serverName, config };
  }

  function readMarketplaceDefinitionFromCustomJson(input: string, fallbackName: string): any | null {
    try {
      const parsed = JSON.parse(input);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const root = parsed as Record<string, any>;
      if (root.installations) return root;
      const wrapped = root.mcpServers || root.mcp;
      const directMap = wrapped && typeof wrapped === "object" && !Array.isArray(wrapped) ? wrapped : root;
      const entries = Object.entries(directMap as Record<string, any>);
      if (entries.length === 1) {
        const [, value] = entries[0];
        if (value && typeof value === "object" && !Array.isArray(value) && value.installations) return value;
      }
      if (fallbackName && directMap?.[fallbackName]?.installations) return directMap[fallbackName];
    } catch {
      return null;
    }
    return null;
  }

  function collectPlaceholderNames(value: unknown, out: Set<string>) {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
        if (match[1]) out.add(match[1]);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectPlaceholderNames(item, out));
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach((item) => collectPlaceholderNames(item, out));
    }
  }

  function getCustomMcpParamSpecs(input: string, fallbackName: string) {
    const specs = new Map<string, { key: string; required: boolean; description: string; example: string }>();
    const add = (key: string, required = true, description = "", example = "") => {
      const k = key.trim();
      if (!k) return;
      const prev = specs.get(k);
      specs.set(k, {
        key: k,
        required: Boolean(prev?.required || required),
        description: prev?.description || description,
        example: prev?.example || example
      });
    };
    const market = readMarketplaceDefinitionFromCustomJson(input, fallbackName);
    Object.entries(market?.arguments || {}).forEach(([key, arg]: [string, any]) => {
      add(key, Boolean(arg?.required), String(arg?.description || ""), String(arg?.example || ""));
    });
    try {
      const { config } = normalizeCustomMcpJson(input, fallbackName);
      const placeholders = new Set<string>();
      collectPlaceholderNames(config, placeholders);
      placeholders.forEach((key) => add(key, true));
    } catch {
      // Invalid JSON/config is already shown in preview; no parameter form needed yet.
    }
    return Array.from(specs.values());
  }

  function replaceMcpConfigPlaceholders(value: unknown, values: Record<string, string>): unknown {
    if (typeof value === "string") {
      return value.replace(/\$\{([^}]+)\}/g, (full, key) => {
        const next = String(values[key] || "").trim();
        return next || full;
      });
    }
    if (Array.isArray(value)) return value.map((item) => replaceMcpConfigPlaceholders(item, values));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceMcpConfigPlaceholders(item, values)]));
    }
    return value;
  }

  function startEditMcpParams(name: string, status: OpencodeMcpStatusMap[string]) {
    const s: any = status || {};
    const params = (s.type === "remote" ? s.headers : s.environment) || {};
    const specs = getInstalledMcpParamSpecs(name, status);
    const values: Record<string, string> = {};
    specs.forEach((spec) => {
      values[spec.key] = params && typeof params === "object" ? String((params as any)[spec.key] ?? "") : "";
    });
    setEditingMcpName(name);
    setEditingMcpParamValues(values);
  }

  async function saveMcpParams(name: string, status: OpencodeMcpStatusMap[string]) {
    if (!ensureRepoSelected()) return;
    const s: any = status || {};
    const config: Record<string, unknown> = { ...s };
    delete config.source;
    delete config.configured;
    delete config.runtimeKnown;
    delete config.status;
    delete config.state;
    delete config.error;
    delete config.message;
    delete config.reason;
    const specs = getInstalledMcpParamSpecs(name, status);
    const missing = specs.filter((spec) => spec.required && !String(editingMcpParamValues[spec.key] || "").trim());
    if (missing.length > 0) {
      setError(`请填写必填参数：${missing.map((spec) => spec.key).join(", ")}`);
      return;
    }
    const parsed = Object.fromEntries(
      Object.entries(editingMcpParamValues)
        .map(([key, value]) => [key, String(value || "").trim()] as const)
        .filter(([, value]) => value)
    );
    if (s.type === "remote") {
      if (Object.keys(parsed).length > 0) config.headers = parsed;
      else delete config.headers;
    } else {
      if (Object.keys(parsed).length > 0) config.environment = parsed;
      else delete config.environment;
    }
    setOpencodeMcpBusyName(`${name}:update`);
    setOpencodeMcpError("");
    try {
      await invoke<unknown>("add_opencode_mcp_server", { repoPath, name, config });
      setOpencodeMcpStatus((prev) => ({ ...prev, [name]: { ...(config as any), status: "configured" } }));
      setEditingMcpName("");
      setEditingMcpParamValues({});
      window.setTimeout(() => void refreshOpencodeMcpStatus(), 250);
      setMessage(`MCP params updated: ${name}`);
    } catch (e) {
      const msg = String(e);
      setOpencodeMcpError(msg);
      setError(msg);
    } finally {
      setOpencodeMcpBusyName("");
    }
  }

  async function removeOpencodeMcpServer(name: string) {
    if (!ensureRepoSelected()) return;
    const n = name.trim();
    if (!n) return;
    setOpencodeMcpBusyName(`${n}:remove`);
    setOpencodeMcpError("");
    const previousStatus = opencodeMcpStatus;
    setOpencodeMcpStatus((prev) => {
      const next = { ...prev };
      delete next[n];
      return next;
    });
    try {
      const result = await invoke<any>("delete_opencode_mcp_server", { repoPath, name: n });
      if (result && typeof result === "object" && result.ok === false) {
        const checked = Array.isArray(result.checked) ? result.checked.join("\n") : "";
        throw new Error(`未在 OpenCode 配置文件中找到 ${n}${checked ? `\n已检查:\n${checked}` : ""}`);
      }
      window.setTimeout(() => void refreshOpencodeMcpStatus(), 250);
      const detail = result && typeof result === "object"
        ? [`project:${result.projectDeleted || result.projectFileDeleted ? "yes" : "no"}`, `global:${result.globalDeleted || result.globalFileDeleted ? "yes" : "no"}`, `runtime:${result.apiDeleted ? "yes" : "no"}`].join(" · ")
        : "removed";
      setMessage(`MCP removed: ${n} (${detail})`);
    } catch (e) {
      const msg = String(e);
      setOpencodeMcpStatus(previousStatus);
      setOpencodeMcpError(msg);
      setError(msg);
    } finally {
      setOpencodeMcpBusyName("");
    }
  }

  async function installOpencodeSkillFromRegistry(specArg = opencodeSkillInstallSpec, scopeArg: "project" | "global" = opencodeSkillInstallScope, _fallbackSpecs: string[] = []) {
    if (!ensureRepoSelected()) return;
    const primarySpec = specArg.trim();
    if (!primarySpec) {
      setError("请输入 skills.sh 条目，例如 vercel-labs/skills/find-skills");
      return;
    }
    const globalFlag = scopeArg === "global" ? " -g" : "";
    const command = `SKILLS_CLONE_TIMEOUT_MS=600000 npx -y skills add ${quoteShellArg(primarySpec)} --agent opencode -y${globalFlag}`;
    setOpencodeSkillBusy(false);
    setOpencodeSkillInstallingSpec("");
    setOpencodeSkillInstallNotice("");
    setOpencodeSkillInstallLog("");
    setOpencodeSkillsError("");
    setOpencodeSkillInstallSpec("");
    appendOpencodeDebugLog(`skill.install.terminal ${primarySpec} scope=${scopeArg}`);
    setMessage(`已切到终端执行 Skill 安装: ${primarySpec}`);
    await runCommandInTerminalModule(command);
    [6000, 15000, 30000].forEach((delay) => {
      window.setTimeout(() => void refreshOpencodeSkills(), delay);
    });
  }

  async function removeOpencodeSkill(skill: OpencodeSkillInfo) {
    if (!ensureRepoSelected()) return;
    const scope = skill.scope || "source";
    if (scope !== "project" && scope !== "global") {
      setOpencodeSkillsError("只能删除已安装到 Repo 或 Global 的 Skill。Source 类型请从来源配置中移除。");
      return;
    }
    const key = `${scope}:${skill.name}:${skill.path || skill.location || ""}`;
    setOpencodeSkillRemovingKey(key);
    setOpencodeSkillsError("");
    try {
      await invoke<string>("remove_opencode_skill", { repoPath, name: skill.name, global: scope === "global" });
      await refreshOpencodeSkills();
      setMessage(`Skill removed: ${skill.name}`);
    } catch (e) {
      const msg = String(e);
      setOpencodeSkillsError(msg);
      setError(msg);
    } finally {
      setOpencodeSkillRemovingKey("");
    }
  }

  async function addOpencodeSkillSource() {
    if (!ensureRepoSelected()) return;
    const source = opencodeSkillSourceInput.trim();
    if (!source) return;
    setOpencodeSkillBusy(true);
    setOpencodeSkillsError("");
    try {
      const cfg = await invoke<OpencodeServerConfig>("get_opencode_server_global_config", { repoPath });
      const currentSkills = ((cfg as any)?.skills && typeof (cfg as any).skills === "object") ? (cfg as any).skills : {};
      const key = opencodeSkillSourceKind === "url" ? "urls" : "paths";
      const prev = Array.isArray(currentSkills[key]) ? currentSkills[key].map((x: unknown) => String(x || "")).filter(Boolean) : [];
      const next = Array.from(new Set([...prev, source]));
      await invoke<OpencodeServerConfig>("patch_opencode_server_config", {
        repoPath,
        patch: { skills: { ...currentSkills, [key]: next } }
      });
      setOpencodeSkillSourceInput("");
      await refreshOpencodeSkills();
      setMessage(`Skill source added: ${source}`);
    } catch (e) {
      const msg = String(e);
      setOpencodeSkillsError(msg);
      setError(msg);
    } finally {
      setOpencodeSkillBusy(false);
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

  function getBestOpencodeMessageCacheEntry(repoPathValue: string, sessionId: string, limit: number, minFetchedAt = 0) {
    const entries = getOpencodeMessageCacheEntries(repoPathValue, sessionId);
    const need = Math.max(2, limit);
    return entries.find((entry) => entry.limit >= need && entry.fetchedAt >= minFetchedAt) || null;
  }

  function invalidateOpencodeMessageCache(repoPathValue: string, sessionId: string) {
    const baseKey = getOpencodeMessageCacheKey(repoPathValue, sessionId);
    const pagePrefix = `${baseKey}\n`;
    const nextWindow = { ...opencodeMessageWindowCacheRef.current };
    delete nextWindow[baseKey];
    opencodeMessageWindowCacheRef.current = nextWindow;
    opencodeMessagePageCacheRef.current = Object.fromEntries(
      Object.entries(opencodeMessagePageCacheRef.current).filter(([key]) => !key.startsWith(pagePrefix))
    );
    opencodeMessagePageInflightRef.current = Object.fromEntries(
      Object.entries(opencodeMessagePageInflightRef.current).filter(([key]) => !key.startsWith(pagePrefix))
    );
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

  async function fetchOpencodeDetailedMessagePage(sessionId: string, before: string, limit: number, minFetchedAt = 0) {
    const id = sessionId.trim();
    const safeBefore = before.trim();
    const safeLimit = Math.max(2, limit);
    const cacheKey = getOpencodeMessagePageCacheKey(repoPath, id, safeBefore, safeLimit);
    const cached = opencodeMessagePageCacheRef.current[cacheKey];
    if (cached && cached.fetchedAt >= minFetchedAt) {
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
        mapped.push({
          id: msgId,
          role: role as "user" | "assistant",
          content: buildOpencodeMainLineMarkdownFromParts(parts),
          attachments: role === "user" ? buildOpencodeImageAttachmentsFromParts(parts) : undefined,
        });
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
    const sessionUpdatedAt = opencodeSessions.find((session) => session.id === id)?.updatedAt || 0;
    const cached = getBestOpencodeMessageCacheEntry(repoPath, id, limit, sessionUpdatedAt);
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
    const page = await fetchOpencodeDetailedMessagePage(id, "", limit, sessionUpdatedAt);
      const existingSession = opencodeSessions.find((session) => session.id === id);
      const mapped = mergeOpencodeMessageAttachments(existingSession?.messages, page.items);
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
      const currentSession = opencodeSessions.find((s) => s.id === id);
      // 如果消息内容没有实际变化，避免替换数组引用导致重新渲染
      if (currentSession && currentSession.loaded && currentSession.messages.length > 0) {
        const current = currentSession.messages;
        if (current.length === mapped.length) {
          const isSame = current.every((msg, idx) => {
            const next = mapped[idx];
            return msg.id === next.id && msg.role === next.role && msg.content === next.content;
          });
          if (isSame) {
            appendOpencodeDebugLog(`session.messages load ${id} skipped (unchanged)`);
            return;
          }
        }
      }
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
      title: seedPrompt?.trim() || undefined,
      agent: activeOpencodeAgent || null,
      permission: opencodeAutoAcceptPermissions ? allowAllPermissionRules() : null
    });
    const next = opencodeSessionFromSummary(created, opencodeSessions.length + 1);
    next.loaded = true;
    setOpencodeSessions((prev) => {
      const exists = prev.some((session) => session.id === created.id);
      return exists ? prev : [next, ...prev];
    });
    const repoIdAtCreate = selectedRepo?.id || newSessionTargetRepoId;
    upsertSidebarOpencodeSession(repoIdAtCreate, next);
    if (repoIdAtCreate) setExpandedProjectIds((prev) => (prev.includes(repoIdAtCreate) ? prev : [...prev, repoIdAtCreate]));
    setActiveOpencodeSessionId(created.id);
    if (activeOpencodeAgent) setOpencodeSessionAgent((prev) => ({ ...prev, [created.id]: activeOpencodeAgent }));
    setOpencodeSessionThinkingLevel((prev) => ({ ...prev, [created.id]: activeOpencodeThinkingLevel }));
    bindOpencodeSessionToWorkspace(created.id, repoPath, worktreeOverview.branch || selectedBranch);
    setDraftOpencodeSession(false);
    setOpencodePromptInput("");
    appendOpencodeDebugLog(`session.created ${created.id}`);
    resumeOpencodeFollowFromUserAction(created.id);
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

  async function createAndSwitchOpencodeSessionForSidebar(seedPrompt?: string) {
    const targetRepo = repos.find((repo) => repo.id === newSessionTargetRepoId) || selectedRepo;
    if (!targetRepo) {
      setError("请先导入并选择一个工作区。");
      return;
    }
    opencodeSessionsRepoIdRef.current = targetRepo.id;
    if (selectedRepo?.id !== targetRepo.id) setSelectedRepo(targetRepo);
    if (gitPaneRepo?.id !== targetRepo.id) setGitPaneRepo(targetRepo);
    setOpencodeSessionFetchLimit(getRepoSessionFetchLimit(targetRepo.id));
    setExpandedProjectIds((prev) => (prev.includes(targetRepo.id) ? prev : [...prev, targetRepo.id]));
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

  async function archiveOpencodeSession(repo: RepositoryEntry, sessionId: string) {
    const id = sessionId.trim();
    if (!id || !runtimeStatus.opencode.installed) return;
    const repoId = repo.id.trim();
    const repoPathArg = repo.path.trim();
    if (!repoId || !repoPathArg) return;
    appendOpencodeDebugLog(`session.archive requested ${id}`);
    const sidebarSnapshot = sidebarOpencodeSessionsByRepo;
    const sessionSnapshot = opencodeSessions;
    const repoSessions = sidebarOpencodeSessionsByRepo[repoId] || [];
    const nextRepoSessions = repoSessions.filter((session) => session.id !== id);
    const idx = repoSessions.findIndex((session) => session.id === id);
    const fallback = nextRepoSessions[Math.max(0, idx - 1)] ?? nextRepoSessions[0] ?? null;
    setSidebarOpencodeSessionsByRepo((prev) => ({ ...prev, [repoId]: nextRepoSessions }));
    setOpencodeSessions((prev) => prev.filter((session) => session.id !== id));
    if (activeOpencodeSessionId === id) {
      if (fallback) {
        pendingSidebarSessionSelectionRef.current = { repoId, sessionId: fallback.id };
        setOpencodeSessions((prev) => [{ ...opencodeSessionFromSummary(fallback), loaded: false }, ...prev.filter((session) => session.id !== fallback.id)]);
        setActiveOpencodeSessionId(fallback.id);
        setDraftOpencodeSession(false);
      } else {
        setActiveOpencodeSessionId("");
        setDraftOpencodeSession(true);
      }
    }
    try {
      const base = await invoke<string>("get_opencode_service_base", { repoPath: repoPathArg });
      const resp = await fetch(`${base}/session/${encodeURIComponent(id)}?directory=${encodeURIComponent(repoPathArg)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time: { archived: Date.now() } })
      });
      if (!resp.ok) throw new Error(`archive failed: HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
      appendOpencodeDebugLog(`session.archived ${id}`);
      setMessage("会话已归档");
    } catch (e) {
      appendOpencodeDebugLog(`session.archive.error ${id} ${String(e)}`);
      setSidebarOpencodeSessionsByRepo(sidebarSnapshot);
      setOpencodeSessions(sessionSnapshot);
      if (activeOpencodeSessionId === id) setActiveOpencodeSessionId(id);
      setError(String(e));
    }
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
      setError("请先导入并选择一个工作区。");
      return false;
    }
    return true;
  }

  function ensureGitPaneSelected(): boolean {
    if (!gitPanePath.trim()) {
      setError("请先选择一个目录。");
      return false;
    }
    return true;
  }

  function resetGitPaneState() {
    setBranches([]);
    setCommitGraph([]);
    setCommits([]);
    setSelectedBranch("");
    setSelectedCommit("");
    setBranchParentMap({});
    setRecords([]);
    setActions([]);
    setWorktreeOverview(EMPTY_WORKTREE);
    setLinkedWorktrees([]);
    setSelectedWorktreePath("");
    setSelectedWorktreeFile("");
    setSelectedWorktreePatch("");
    setSelectedWorktreeContent(EMPTY_WORKTREE_FILE_CONTENT);
    setGitUserIdentity(EMPTY_GIT_IDENTITY);
  }

  async function refreshRepositories() {
    const all = await listRepositories();
    setRepos(all);
    if (all.length > 0 && !selectedRepo) setSelectedRepo(all[0]);
    if (all.length > 0 && !gitPaneRepo) setGitPaneRepo(all[0]);
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
      setGitPaneRepo(entry);
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
      if (gitPaneRepo?.id === entry.id) {
        setGitPaneRepo(all[0] ?? null);
      } else if (gitPaneRepo && !all.some((r) => r.id === gitPaneRepo.id)) {
        setGitPaneRepo(all[0] ?? null);
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

  async function runDependencyAction(name: RuntimeDepName, action: "install" | "uninstall", options?: { showRuntimePanel?: boolean }) {
    flushSync(() => {
      setShowEnvSetup(options?.showRuntimePanel ?? true);
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
    const typedPrompt = opencodePromptInput.trim();
    const mcpPromptHints = opencodeMcpPromptRefs.map((name) => `use the ${name} mcp server`);
    const prompt = [typedPrompt, ...mcpPromptHints].filter(Boolean).join("\n\n").trim();
    const images = opencodeImageAttachments;
    if (!prompt && images.length === 0) return;
    const repoIdAtRun = selectedRepo?.id || newSessionTargetRepoId;
    let sessionId = ensureActiveOpencodeSession();
    if (!sessionId || draftOpencodeSession) {
      sessionId = await createPersistedOpencodeSession(prompt || "(image)");
    }
    if (!sessionId) return;
    bindOpencodeSessionToWorkspace(sessionId, repoPath, worktreeOverview.branch || selectedBranch);
    if (activeOpencodeAgent) setOpencodeSessionAgent((prev) => ({ ...prev, [sessionId]: prev[sessionId] || activeOpencodeAgent }));
    setOpencodeSessionThinkingLevel((prev) => ({ ...prev, [sessionId]: prev[sessionId] || activeOpencodeThinkingLevel }));
    await ensureSessionAutoAcceptPermissions(sessionId);
    if (opencodeRunBusyBySession[sessionId]) return;
    invalidateOpencodeMessageCache(repoPath, sessionId);
    const assistantId = `assistant-${makeId()}`;
    const requestId = `req-${makeId()}`;
    setOpencodeStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: assistantId }));
    const scrollToBottom = (options?: { force?: boolean }) => {
      if (activeOpencodeSessionId !== sessionId) return;
      if (options?.force) {
        resumeOpencodeFollowFromUserAction(sessionId);
        return;
      }
      scheduleOpencodeScrollToBottom({ source: "system" });
    };
    updateOpencodeSessionById(sessionId, (session) => {
      const nextTitle = session.messages.length === 0 ? toOpencodeSessionTitle(prompt || "(image)") : session.title;
      const nextMessages: OpencodeChatMessage[] = [
        ...session.messages,
        {
          id: `user-${makeId()}`,
          role: "user",
          content: prompt,
          attachments: images.map((img) => ({ id: img.id, kind: "image" as const, uri: img.dataUrl, mime: img.mime, filename: img.filename })),
        },
        { id: assistantId, role: "assistant", content: "" }
      ];
      const nextTurnCount = buildOpencodeTurnRanges(nextMessages).length;
      const nextTurnStart = getInitialOpencodeTurnStart(nextTurnCount);
      return {
        ...session,
        title: nextTitle,
        messages: nextMessages,
        turnStart: nextTurnStart,
        updatedAt: Date.now()
      };
    });
    updateSidebarOpencodeSession(repoIdAtRun, sessionId, (session) => ({
      ...session,
      title: session.messages.length === 0 ? toOpencodeSessionTitle(prompt || "(image)") : session.title,
      updatedAt: Date.now()
    }));
    scrollToBottom({ force: true });
    recordOpencodePromptHistoryEntry(sessionId, prompt);
    setOpencodePromptInput("");
    setOpencodeMcpPromptRefs([]);
    setOpencodeImageAttachments([]);
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
        `source=${modelSource}`,
        `agent=${activeOpencodeAgent || "(default)"}`,
        `thinking=${activeOpencodeThinkingLevel}`,
        `autoAccept=${opencodeAutoAcceptPermissions ? 1 : 0}`
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

        if (typ === "permission.asked") {
          const sid = String(props?.sessionID || "");
          if (sid !== sessionId) return;
          handleIncomingPermission({
            id: String(props?.id || ""),
            sessionID: sid,
            permission: String(props?.permission || ""),
            patterns: Array.isArray(props?.patterns) ? props.patterns.map((x: unknown) => String(x || "")).filter(Boolean) : [],
            always: Array.isArray(props?.always) ? props.always.map((x: unknown) => String(x || "")).filter(Boolean) : [],
            metadata: props?.metadata || undefined,
            tool: props?.tool || undefined
          });
          return;
        }

        if (typ === "permission.replied") {
          const sid = String(props?.sessionID || "");
          if (sid !== sessionId) return;
          const requestID = String(props?.requestID || "");
          if (!requestID) return;
          setOpencodePermissionRequests((prev) => prev.filter((item) => item.id !== requestID));
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

      const promptParts: Record<string, unknown>[] = [{ id: `prt_${makeId()}`, type: "text", text: prompt }];
      for (const img of images) {
        promptParts.push({ id: `prt_${makeId()}`, type: "file", mime: img.mime, url: img.dataUrl, filename: img.filename });
      }
      const promptBody: Record<string, unknown> = {
        parts: promptParts
      };
      const mr = parseModelRef(model);
      if (mr) {
        promptBody.model = {
          providerID: mr.provider,
          modelID: mr.model
        };
      }
      if (activeOpencodeAgent) {
        promptBody.agent = activeOpencodeAgent;
      }
      if (activeOpencodeThinkingLevel !== "auto") {
        promptBody.variant = activeOpencodeThinkingLevel;
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
    el.style.height = "auto";
    const next = Math.min(140, Math.max(38, el.scrollHeight));
    el.style.height = `${next}px`;
    el.scrollTop = 0;
  }

  function setOpencodePromptInputFromHistory(value: string) {
    setOpencodePromptInput(value);
    setOpencodeSlashOpen(false);
    requestAnimationFrame(() => {
      resizeOpencodeInput();
      const el = opencodeInputRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  function activateOpencodeSlashCommand(cmd: OpencodeSlashCommand) {
    const trigger = cmd.trigger.trim().toLowerCase();
    setOpencodeSlashOpen(false);
    if (cmd.source === "builtin") {
      if (trigger === "new") {
        void createAndSwitchOpencodeSession();
        return;
      }
      if (trigger === "model") {
        setShowOpencodeModelPicker(true);
        return;
      }
      if (trigger === "agent") {
        applyOpencodeAgent(activeOpencodeAgent === "build" ? "plan" : "build");
        return;
      }
      if (trigger === "mcp") {
        openOpencodeModulePanel("mcp");
        return;
      }
      if (trigger === "workspace") {
        setLeftDrawerOpen(true);
        return;
      }
      if (trigger === "terminal") {
        setRightPaneTab("terminal");
        return;
      }
    }
    setOpencodePromptInput(`/${cmd.trigger} `);
    requestAnimationFrame(() => opencodeInputRef.current?.focus());
  }

  function referenceOpencodeSkill(skill: OpencodeSkillInfo) {
    const fallback = skill.name.replace(/[^a-zA-Z0-9_-]/g, "").replace(/-/g, "");
    const matched = opencodeSlashCommands.find((cmd) => {
      const trigger = cmd.trigger.toLowerCase();
      const name = skill.name.toLowerCase();
      return cmd.source === "skill" && (trigger === name || trigger.replace(/-/g, "") === name.replace(/-/g, ""));
    });
    const trigger = (matched?.trigger || fallback || skill.name).replace(/^\//, "");
    setOpencodePromptInput(`/${trigger} `);
    setOpencodeSlashOpen(false);
    requestAnimationFrame(() => {
      resizeOpencodeInput();
      const el = opencodeInputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  function referenceOpencodeMcp(name: string) {
    const mcpName = name.trim();
    if (!mcpName) return;
    setOpencodeMcpPromptRefs((prev) => prev.includes(mcpName) ? prev : [...prev, mcpName]);
    setOpencodeSlashOpen(false);
    requestAnimationFrame(() => {
      resizeOpencodeInput();
      const el = opencodeInputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  function getOpencodePromptHistorySessionKey() {
    return activeOpencodeSessionId.trim() || "__draft__";
  }

  function recordOpencodePromptHistoryEntry(sessionId: string, prompt: string) {
    const key = sessionId.trim() || "__draft__";
    const value = prompt.trim();
    if (!value) return;
    const prev = opencodePromptHistoryBySessionRef.current[key] || [];
    opencodePromptHistoryBySessionRef.current[key] = [value, ...prev.filter((item) => item !== value)].slice(0, 80);
    opencodePromptHistoryIndexBySessionRef.current[key] = -1;
    opencodePromptHistoryDraftBySessionRef.current[key] = "";
  }

  function browseOpencodePromptHistory(direction: "older" | "newer") {
    const key = getOpencodePromptHistorySessionKey();
    const history = opencodePromptHistoryBySessionRef.current[key] || [];
    if (history.length === 0) return;
    const currentIndex = opencodePromptHistoryIndexBySessionRef.current[key] ?? -1;
    if (direction === "older") {
      if (currentIndex < 0) {
        opencodePromptHistoryDraftBySessionRef.current[key] = opencodePromptInput;
      }
      const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, history.length - 1);
      opencodePromptHistoryIndexBySessionRef.current[key] = nextIndex;
      setOpencodePromptInputFromHistory(history[nextIndex] || "");
      return;
    }
    if (currentIndex <= 0) {
      opencodePromptHistoryIndexBySessionRef.current[key] = -1;
      setOpencodePromptInputFromHistory(opencodePromptHistoryDraftBySessionRef.current[key] || "");
      return;
    }
    const nextIndex = currentIndex - 1;
    opencodePromptHistoryIndexBySessionRef.current[key] = nextIndex;
    setOpencodePromptInputFromHistory(history[nextIndex] || "");
  }

  function shouldUsePromptHistoryKey(event: React.KeyboardEvent<HTMLTextAreaElement>, direction: "older" | "newer") {
    const target = event.currentTarget;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    if (start !== end) return false;
    if (direction === "older") {
      return start === 0;
    }
    return end === target.value.length;
  }

  function browseTerminalHistory(tabId: string, direction: "older" | "newer") {
    updateTerminalTabById(tabId, (prev) => {
      if (prev.history.length === 0) return prev;
      if (direction === "older") {
        const next = prev.historyIndex < 0 ? 0 : Math.min(prev.historyIndex + 1, prev.history.length - 1);
        return {
          ...prev,
          historyIndex: next,
          historyDraft: prev.historyIndex < 0 ? prev.input : prev.historyDraft,
          input: prev.history[next] || ""
        };
      }
      if (prev.historyIndex <= 0) {
        return { ...prev, historyIndex: -1, input: prev.historyDraft };
      }
      const next = prev.historyIndex - 1;
      return { ...prev, historyIndex: next, input: prev.history[next] || "" };
    });
  }

  async function refreshTerminalCompletions(tab: TerminalTabState, nextInput: string) {
    if (!repoPath.trim()) return;
    const currentInput = nextInput;
    try {
      const result = await listRepoTerminalCompletions(repoPath, currentInput, tab.cwd || repoPath);
      updateTerminalTabById(tab.id, (prev) => {
        if (prev.input !== currentInput) return prev;
        return {
          ...prev,
          completionItems: result.candidates.slice(0, 24),
          completionIndex: 0,
          completionToken: result.token || ""
        };
      });
    } catch {
      updateTerminalTabById(tab.id, (prev) => prev.input === currentInput ? { ...prev, completionItems: [], completionIndex: 0, completionToken: "" } : prev);
    }
  }

  function selectTerminalCompletion(tab: TerminalTabState, index = tab.completionIndex) {
    const candidate = tab.completionItems[index];
    if (!candidate || !tab.completionToken) return;
    const nextInput = applyTerminalCompletionCandidate(tab.input, tab.completionToken, candidate);
    updateTerminalTabById(tab.id, {
      input: nextInput,
      historyIndex: -1,
      historyDraft: nextInput,
      completionItems: [],
      completionIndex: 0,
      completionToken: ""
    });
    void refreshTerminalCompletions({ ...tab, input: nextInput, completionItems: [], completionIndex: 0, completionToken: "" }, nextInput);
  }

  async function applyTerminalTabCompletion(tab: TerminalTabState) {
    if (tab.completionItems.length > 0 && tab.completionToken) {
      selectTerminalCompletion(tab);
      return;
    }
    if (!repoPath) return;
    try {
      const nextInput = await completeRepoTerminalInput(repoPath, tab.input, tab.cwd || repoPath);
      if (nextInput === tab.input) return;
      updateTerminalTabById(tab.id, {
        input: nextInput,
        historyIndex: -1,
        historyDraft: nextInput,
        completionItems: [],
        completionIndex: 0,
        completionToken: ""
      });
      void refreshTerminalCompletions({ ...tab, input: nextInput, completionItems: [], completionIndex: 0, completionToken: "" }, nextInput);
    } catch {
      // ignore completion failures to keep typing smooth
    }
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
    setCommitContextMenu(null);
    setSelectedCommit(sha);
    setDetailTab("context");
    setMessage(`查看 Entire agent 上下文: ${sha.slice(0, 8)}`);
  }

  async function applyCommitFromContextMenu(action: "cherryPick" | "revert") {
    if (!ensureRepoSelected() || !commitContextMenu?.sha) return;
    const sha = commitContextMenu.sha;
    const label = shortSha(sha, 8);
    const isRevert = action === "revert";
    const ok = window.confirm(
      isRevert
        ? `确定要 revert ${label} 吗？\n\n这会在当前分支创建一个反向提交。`
        : `确定要 cherry-pick ${label} 到当前分支吗？\n\n如果有冲突，需要手动解决。`
    );
    if (!ok) return;
    setCommitContextMenu(null);
    setBusy(true);
    setGitOperation(action);
    setError("");
    setMessage(isRevert ? `正在 revert: ${label}...` : `正在 cherry-pick: ${label}...`);
    try {
      const result = isRevert ? await gitRevertCommit(repoPath, sha) : await gitCherryPickCommit(repoPath, sha);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
      setSelectedCommit(sha);
      setMessage(isRevert ? `已 revert: ${label}` : `已 cherry-pick: ${label}`);
      appendOpencodeDebugLog(`git.${isRevert ? "revert" : "cherry-pick"} ${result.trim() || label}`);
    } catch (e) {
      const text = String(e);
      setError(text);
      setMessage(isRevert ? `Revert 失败: ${label}` : `Cherry-pick 失败: ${label}`);
      await refreshWorktreeData(selectedWorktreeFile).catch(() => undefined);
    } finally {
      setBusy(false);
      setGitOperation(null);
    }
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
        const created = await createGitDetachedWorktree(repoPath, startPoint || baseBranch, targetPath || undefined);
        rememberWorktreeParent(created.path, baseBranch);
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
    if (!ensureGitPaneSelected()) return;
    const requestRepoPath = gitPanePath;
    setError("");
    setMessage("加载分支与提交...");
    try {
      const branchList = await getLocalBranches(gitPanePath);
      const graphRows = await getCommitGraph(gitPanePath, 600);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setBranches(branchList);
      setCommitGraph(graphRows);
      setBranchParentMap((prev) => {
        const cleaned = Object.fromEntries(
          Object.entries(prev).filter(([child, parent]) => {
            if (!child.trim() || !parent.trim()) return false;
            const childExists = branchList.some((b) => b.name === child) || Object.prototype.hasOwnProperty.call(prev, child);
            const parentExists = branchList.some((b) => b.name === parent);
            return childExists && parentExists;
          })
        );
        if (Object.keys(cleaned).length !== Object.keys(prev).length) {
          writeBranchParentMap(cleaned);
        }
        return cleaned;
      });
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const target = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(target);
      if (!target) {
        setCommits([]);
        setSelectedCommit("");
        setMessage("未找到可用本地分支");
        return;
      }
      const rows = await getBranchCommits(gitPanePath, target, 80);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setCommits(rows);
      setSelectedCommit(rows[0]?.sha ?? "");
      setMessage(rows.length > 0 ? "分支与提交已更新" : `分支 ${target} 暂无提交可显示`);
    } catch (e) {
      if (gitPanePathRef.current !== requestRepoPath) return;
      setError(String(e));
      setBranches([]);
      setCommitGraph([]);
      setCommits([]);
      setSelectedBranch("");
      setSelectedCommit("");
      setBranchParentMap({});
      setMessage("加载分支/提交失败");
    }
  }

  async function refreshReviewData() {
    if (!ensureGitPaneSelected()) return;
    const requestRepoPath = gitPanePath;
    const [reviewRows, actionRows] = await Promise.all([
      loadReviewRecords(gitPanePath),
      loadReviewActions(gitPanePath)
    ]);
    if (gitPanePathRef.current !== requestRepoPath) return;
    setRecords(reviewRows);
    setActions(actionRows);
  }

  async function refreshWorktreeData(preferredFile?: string) {
    if (!ensureGitPaneSelected()) return;
    const requestRepoPath = gitPanePath;
    try {
      const [overview, worktrees] = await Promise.all([
        getGitWorktreeOverview(gitPanePath),
        getGitWorktreeList(gitPanePath)
      ]);
      if (gitPanePathRef.current !== requestRepoPath) return;
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
        getGitWorktreeFilePatch(gitPanePath, target),
        getGitWorktreeFileContent(gitPanePath, target)
      ]);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setSelectedWorktreePatch(patch);
      setSelectedWorktreeContent(content);
    } catch (e) {
      if (gitPanePathRef.current !== requestRepoPath) return;
      setError(String(e));
      setWorktreeOverview(EMPTY_WORKTREE);
      setLinkedWorktrees([]);
      setSelectedWorktreeFile("");
      setSelectedWorktreePatch("");
    }
  }

  async function refreshGitUserIdentity() {
    if (!ensureGitPaneSelected()) return;
    const requestRepoPath = gitPanePath;
    try {
      const identity = await getGitUserIdentity(gitPanePath);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setGitUserIdentity(identity);
    } catch {
      if (gitPanePathRef.current !== requestRepoPath) return;
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

  async function handleDiscardEntries(entries: GitWorktreeEntry[], label: string) {
    if (!ensureRepoSelected() || entries.length === 0) return;
    const ok = window.confirm(`确定要丢弃目录「${label}」下的 ${entries.length} 个变更吗？\n\n这会删除未跟踪文件，并恢复已跟踪文件到 HEAD。`);
    if (!ok) return;
    setDiscardingFile(label);
    setError("");
    try {
      for (const entry of entries) {
        await gitDiscardChanges(repoPath, entry.path, entry.untracked);
      }
      setMessage(`已丢弃 ${entries.length} 个变更: ${label}`);
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage("目录丢弃失败");
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

  async function handleStagePaths(paths: string[], label: string) {
    if (!ensureRepoSelected() || paths.length === 0) return;
    setStagingFile(label);
    setError("");
    try {
      for (const file of paths) {
        await gitStageFile(repoPath, file);
      }
      setMessage(`已暂存 ${paths.length} 个文件: ${label}`);
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage("目录暂存失败");
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

  async function handleUnstagePaths(paths: string[], label: string) {
    if (!ensureRepoSelected() || paths.length === 0) return;
    setUnstagingFile(label);
    setError("");
    try {
      for (const file of paths) {
        await gitUnstageFile(repoPath, file);
      }
      setMessage(`已取消暂存 ${paths.length} 个文件: ${label}`);
      await refreshWorktreeData();
    } catch (e) {
      setError(String(e));
      setMessage("目录取消暂存失败");
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

  function renderWorktreeNodes(nodes: WorktreeTreeNode[], depth = 0, mode: "stage" | "unstage" = "stage"): ReactNode {
    return nodes.map((node) => {
      if (node.kind === "dir") {
        const expanded = expandedWorktreeDirs.includes(node.path);
        const filePaths = collectWorktreeNodeFilePaths(node);
        const entries = collectWorktreeNodeEntries(node);
        const busyPath = mode === "stage" ? stagingFile : unstagingFile;
        const canDiscardDir = entries.some((entry) => entry.staged || entry.unstaged || entry.untracked);
        return (
          <div key={node.path} className="gt-worktree-tree-group">
            <div className="gt-worktree-tree-row gt-worktree-tree-dir" style={{ paddingLeft: `${depth * 14 + 6}px` }}>
              <button type="button" className="gt-worktree-dir-main-btn" onClick={() => toggleWorktreeDir(node.path)}>
                <span className={expanded ? "gt-worktree-tree-chevron is-open" : "gt-worktree-tree-chevron"} aria-hidden="true" />
                <span className="gt-worktree-tree-name">{node.name}</span>
              </button>
              <div className="gt-worktree-row-tail">
                <span className="gt-worktree-tree-status is-dir">{filePaths.length}</span>
                <div className="gt-worktree-file-actions">
                  <button
                    type="button"
                    className={mode === "unstage" ? "gt-stage-toggle is-on" : "gt-stage-toggle"}
                    title={mode === "unstage" ? "取消暂存此目录" : "暂存此目录"}
                    aria-pressed={mode === "unstage"}
                    disabled={busyPath === node.path || filePaths.length === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode === "unstage") void handleUnstagePaths(filePaths, node.path);
                      else void handleStagePaths(filePaths, node.path);
                    }}
                  >
                    {mode === "unstage" ? (
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 8.2 6.7 11 12 5" />
                      </svg>
                    ) : null}
                  </button>
                  {canDiscardDir ? (
                    <button
                      type="button"
                      className="gt-worktree-action-btn is-discard"
                      title="丢弃此目录变更"
                      disabled={discardingFile === node.path}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDiscardEntries(entries, node.path);
                      }}
                    >
                      {discardingFile === node.path ? "..." : (
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
            {expanded ? <div className="gt-worktree-tree-children">{renderWorktreeNodes(node.children, depth + 1, mode)}</div> : null}
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

  function terminalHasTextSelection() {
    const el = terminalLogRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.isCollapsed || !selection.toString()) return false;
    const anchorInside = selection.anchorNode ? el.contains(selection.anchorNode) : false;
    const focusInside = selection.focusNode ? el.contains(selection.focusNode) : false;
    return anchorInside || focusInside;
  }

  function flushBufferedTerminalOutput(tabId = activeTerminalTabId) {
    const buffered = terminalBufferedOutputRef.current[tabId];
    if (!buffered) return;
    delete terminalBufferedOutputRef.current[tabId];
    updateTerminalTabById(tabId, (prev) => ({
      ...prev,
      output: sanitizeTerminalOutput(`${prev.output}${buffered}`)
    }));
  }

  function createTerminalTab() {
    const n = terminalTabCounterRef.current++;
    const id = `terminal-${n}`;
    terminalSeqRef.current[id] = 0;
    setTerminalTabs((prev) => [
      ...prev,
      createTerminalTabState(id, `终端 ${n}`, selectedRepo?.path || repoPath || "")
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
        historyDraft: "",
        input: "",
        completionItems: [],
        completionIndex: 0,
        completionToken: ""
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

  async function runCommandInTerminalModule(script: string) {
    if (!ensureRepoSelected()) return;
    const command = script.trim();
    if (!command) return;
    const tab = activeTerminalTab || terminalTabs[0];
    if (!tab) return;
    setRightModuleVisibility((prev) => ({ ...prev, terminal: true }));
    setRightPaneTab("terminal");
    setActiveTerminalTabId(tab.id);
    try {
      await sendRepoTerminalInput(repoPath, `${command}\r`, tab.id);
      updateTerminalTabById(tab.id, (prev) => ({
        ...prev,
        history: [command, ...prev.history.filter((x) => x !== command)].slice(0, 80),
        historyIndex: -1,
        historyDraft: "",
        input: "",
        completionItems: [],
        completionIndex: 0,
        completionToken: ""
      }));
    } catch (e) {
      const msg = String(e);
      updateTerminalTabById(tab.id, (prev) => ({
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
    saveCachedRuntimeStatus(runtimeStatus);
  }, [runtimeStatus]);

  useEffect(() => {
    saveCachedWidth(SIDEBAR_WIDTH_CACHE_KEY, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    saveCachedWidth(RIGHT_PANE_WIDTH_CACHE_KEY, rightPaneWidth);
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
    if (!generalSettings.updatesStartup) return;
    const hasCheckedBefore = window.localStorage.getItem(RUNTIME_FIRST_CHECK_KEY) === "1";
    const dismissed = window.localStorage.getItem("giteam.runtime.setup.dismissed.v1") === "1";
    void refreshRuntimeRequirements()
      .then((res) => {
        window.localStorage.setItem(RUNTIME_FIRST_CHECK_KEY, "1");
        const missing = [res.git, res.entire].some((d) => !d.installed);
        if (!hasCheckedBefore && !dismissed && missing) setShowEnvSetup(true);
      })
      .catch((e) => setError(String(e)));
  }, [generalSettings.updatesStartup]);

  useEffect(() => {
    if (!gitPaneRepo) return;
    resetGitPaneState();
    setError("");
    setMessage(`Git 目录: ${gitPaneRepo.name}`);
    const tasks = [refreshWorktreeData(), refreshGitUserIdentity()];
    if (rightPaneTabRef.current === "worktree") {
      tasks.push(refreshBranchesAndCommits(), refreshReviewData());
    }
    void Promise.all(tasks).catch((e) => {
      setError(String(e));
      setMessage("目录 Git 数据加载失败");
    });
  }, [gitPaneRepo?.id]);

  useEffect(() => {
    if (!gitPaneRepo || rightPaneTab !== "worktree") return;
    void Promise.all([refreshBranchesAndCommits(), refreshReviewData()]).catch((e) => setError(String(e)));
  }, [gitPaneRepo?.id, rightPaneTab]);

  useEffect(() => {
    if (!selectedRepo) return;
    setNewSessionTargetRepoId((prev) => prev || selectedRepo.id);
    setOpencodeSessionFetchLimit(getRepoSessionFetchLimit(selectedRepo.id));
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!gitPanePath) {
      void stopGitWorktreeWatcher().catch(() => {});
      return;
    }
    void startGitWorktreeWatcher(gitPanePath).catch((e) => setError(String(e)));
    return () => {
      if (gitAutoRefreshTimerRef.current !== null) {
        window.clearTimeout(gitAutoRefreshTimerRef.current);
        gitAutoRefreshTimerRef.current = null;
      }
    };
  }, [gitPanePath]);

  useEffect(() => {
    const scheduleRefresh = (delay = 600) => {
      if (gitAutoRefreshTimerRef.current !== null) {
        window.clearTimeout(gitAutoRefreshTimerRef.current);
      }
      gitAutoRefreshTimerRef.current = window.setTimeout(() => {
        gitAutoRefreshTimerRef.current = null;
        if (!gitPanePathRef.current) return;
        if (document.visibilityState === "hidden") return;
        if (gitAutoRefreshBlockedRef.current) return;
        const tasks = [refreshWorktreeData(selectedWorktreeFileRef.current)];
        if (rightPaneTabRef.current === "worktree") tasks.push(refreshBranchesAndCommits());
        void Promise.all(tasks).catch((e) => setError(String(e)));
      }, delay);
    };

    const unlistenPromise = listen<{ repo_path: string }>("git-worktree-changed", (event) => {
      if (event.payload?.repo_path !== gitPanePathRef.current) return;
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
  }, [gitPaneRepo?.id]);

  useEffect(() => {
    const viewport = topologyViewportRef.current;
    const node = topologyModel.nodeById[topologyModel.primaryNodeId];
    if (!viewport || !node) return;
    const nextLeft = Math.max(0, (node.x + node.width / 2) * topologyZoom - viewport.clientWidth / 2);
    const nextTop = Math.max(0, (node.y + node.height / 2) * topologyZoom - viewport.clientHeight / 2);
    viewport.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
  }, [gitPaneRepo?.id, topologyModel.primaryNodeId]);

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
    if (opencodeSessionsRepoIdRef.current === selectedRepo.id && opencodeSessions.length > 0) return;
    void refreshOpencodeSessions(getRepoSessionFetchLimit(selectedRepo.id)).catch((e) => setError(String(e)));
  }, [runtimeStatus.opencode.installed, selectedRepo?.id, repoPath, workspaceAgentBindings, opencodeSessions.length]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    if (opencodeModelConfigLoadedRef.current) return;
    opencodeModelConfigLoadedRef.current = true;
    void loadOpencodeModelConfig();
  }, [runtimeStatus.opencode.installed, Boolean(selectedRepo)]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo) return;
    if (opencodeConfiguredModelsLoadedRef.current) return;
    opencodeConfiguredModelsLoadedRef.current = true;
    void refreshOpencodeConfiguredModels();
  }, [runtimeStatus.opencode.installed, Boolean(selectedRepo)]);

  useEffect(() => {
    if (!runtimeStatus.opencode.installed) return;
    void loadOpencodeServiceSettings();
  }, [runtimeStatus.opencode.installed]);

  useEffect(() => {
    setOpencodeSavedModels([]);
  }, []);

  useEffect(() => {
    const hiddenKey = `${OPENCODE_MODEL_VIS_KEY}:global`;
    const enabledKey = `${OPENCODE_MODEL_ENABLE_KEY}:global`;
    setOpencodeHiddenModels(loadModelRefSet(hiddenKey, "hidden"));
    setOpencodeEnabledModels(loadModelRefSet(enabledKey, "enabled"));
    opencodeModelPrefsLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!opencodeModelPrefsLoadedRef.current) return;
    const key = `${OPENCODE_MODEL_VIS_KEY}:global`;
    saveModelRefSet(key, "hidden", opencodeHiddenModels);
  }, [opencodeHiddenModels]);

  useEffect(() => {
    if (!opencodeModelPrefsLoadedRef.current) return;
    const key = `${OPENCODE_MODEL_ENABLE_KEY}:global`;
    saveModelRefSet(key, "enabled", opencodeEnabledModels);
  }, [opencodeEnabledModels]);

  useEffect(() => {
    if (!selectedRepo?.id && !repoPath) return;
    const availableModels = opencodeSyncModelRefs;
    const modelLabels: Record<string, string> = {};
    for (const full of availableModels) {
      const parsed = parseModelRef(full);
      if (!parsed) continue;
      modelLabels[full] = opencodeConfiguredModelNamesByProvider[parsed.provider]?.[parsed.model]
        || opencodeModelNamesByProvider[parsed.provider]?.[parsed.model]
        || parsed.model;
    }
    const payload = {
      repoId: "global",
      repoPath,
      availableModels,
      modelLabels,
      enabledModels: Array.from(opencodeEnabledModels),
      hiddenModels: Array.from(opencodeHiddenModels),
      activeModel: activeOpencodeModel || opencodeConfig?.configuredModel || "",
      updatedAt: Date.now(),
    };
    const url = controlAccessInfo?.port ? `http://127.0.0.1:${controlAccessInfo.port}/api/v1/admin/mobile/model-state` : "";
    const timer = window.setTimeout(() => {
      void invoke("set_mobile_model_state_from_desktop", { state: payload }).catch(() => {});
      if (url) {
        void fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => {});
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    activeOpencodeModel,
    controlAccessInfo?.port,
    opencodeConfig?.configuredModel,
    opencodeConfiguredModelNamesByProvider,
    opencodeHiddenModels,
    opencodeModelNamesByProvider,
    opencodeSyncModelRefs,
    repoPath,
  ]);

  useEffect(() => {
    // Global model selection; session-specific overrides are keyed by session id.
    const key = `${OPENCODE_MODEL_SELECTION_KEY}:global`;
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
  }, []);

  useEffect(() => {
    const key = `${OPENCODE_MODEL_SELECTION_KEY}:global`;
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
  }, [opencodeDraftModel, opencodeSessionModel]);

  useEffect(() => {
    if (!showSettings || !runtimeStatus.opencode.installed || !selectedRepo) return;
    if (opencodeProviders.length === 0) {
      void refreshOpencodeCatalog();
    }
  }, [showSettings, runtimeStatus.opencode.installed, Boolean(selectedRepo)]);

  useEffect(() => {
    if (!(showMobileControlDialog || (showSettings && settingsInitialSection === "mobile")) || !runtimeStatus.giteam.installed) return;
    // Load settings after the dialog paints to avoid blocking navigation.
    window.setTimeout(() => {
      void loadControlServerSettings();
    }, 0);
  }, [showMobileControlDialog, showSettings, settingsInitialSection, runtimeStatus.giteam.installed]);

  useEffect(() => {
    if (!(showMobileControlDialog || (showSettings && settingsInitialSection === "mobile")) || !runtimeStatus.giteam.installed) return;
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
    showSettings,
    settingsInitialSection,
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
    if (rightPaneTab !== "terminal") return;
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
          cwd: snapshot.cwd || repo,
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
          if (snapshot.output) {
            if (terminalTextSelectingRef.current && terminalHasTextSelection()) {
              terminalBufferedOutputRef.current[tabId] = `${terminalBufferedOutputRef.current[tabId] || ""}${snapshot.output}`;
              updateTerminalTabById(tabId, { seq: snapshot.seq, alive: snapshot.alive, cwd: snapshot.cwd || repo });
              return;
            }
            updateTerminalTabById(tabId, (prev) => ({
              ...prev,
              seq: snapshot.seq,
              alive: snapshot.alive,
              cwd: snapshot.cwd || prev.cwd,
              output: sanitizeTerminalOutput(`${prev.output}${snapshot.output}`)
            }));
          } else {
            updateTerminalTabById(tabId, { seq: snapshot.seq, alive: snapshot.alive, cwd: snapshot.cwd || repo });
          }
        } else {
          updateTerminalTabById(tabId, { seq: snapshot.seq, alive: snapshot.alive, cwd: snapshot.cwd || repo });
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
  }, [selectedRepo?.id, activeTerminalTabId, rightPaneTab]);

  useEffect(() => {
    writeTerminalTabSnapshot(activeTerminalTabId, terminalTabCounterRef.current, terminalTabs);
  }, [terminalTabs, activeTerminalTabId]);

  useEffect(() => {
    const el = terminalLogRef.current;
    if (!el) return;
    if (terminalTextSelectingRef.current && terminalHasTextSelection()) return;
    el.scrollTop = el.scrollHeight;
  }, [activeTerminalTab?.output]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (!terminalTextSelectingRef.current) return;
      if (terminalHasTextSelection()) return;
      terminalTextSelectingRef.current = false;
      flushBufferedTerminalOutput(activeTerminalTabId);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [activeTerminalTabId]);

  useEffect(() => {
    if (rightPaneTab !== "terminal") return;
    const t = window.setTimeout(() => {
      terminalInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [rightPaneTab, rightDrawerOpen, activeTerminalTabId]);

  useEffect(() => {
    const terminalBody = terminalBodyRef.current;
    const consoleEl = terminalLogRef.current;
    if (!terminalBody || !consoleEl) return;
    const updateNearTop = () => {
      const noScroll = consoleEl.scrollHeight <= consoleEl.clientHeight + 2;
      setTerminalInputNearTop(noScroll);
    };
    updateNearTop();
    const ro = new ResizeObserver(updateNearTop);
    ro.observe(terminalBody);
    consoleEl.addEventListener("scroll", updateNearTop);
    return () => {
      ro.disconnect();
      consoleEl.removeEventListener("scroll", updateNearTop);
    };
  }, [rightPaneTab, terminalLogRef.current, terminalBodyRef.current]);

  useEffect(() => {
    terminalRepoResetReadyRef.current = true;
  }, [selectedRepo?.id]);

  useLayoutEffect(() => {
    const shouldKeepLatest = opencodeScrollModeRef.current === "follow" && opencodeAutoFollowLatestRef.current;
    if (shouldKeepLatest) {
      opencodeProgrammaticScrollUntilRef.current = Date.now() + 300;
    }
    resizeOpencodeInput();
    if (!shouldKeepLatest) return;
    if (activeOpencodeSessionId) {
      opencodeForceScrollLatestSessionRef.current = activeOpencodeSessionId;
    }
    scrollOpencodeThreadToBottomNow();
    requestAnimationFrame(() => {
      if (opencodeScrollModeRef.current !== "follow") return;
      scrollOpencodeThreadToBottomNow();
    });
  }, [activeOpencodeSessionId, opencodePromptInput, opencodeImageAttachments.length]);

  useEffect(() => {
    const sid = activeOpencodeSessionId;
    const sessionChanged = opencodePrevActiveSessionIdRef.current !== sid;
    if (sessionChanged) {
      opencodePrevActiveSessionIdRef.current = sid;
      opencodeLoadingOlderRef.current = false;
      opencodePrevScrollHeightRef.current = 0;
      opencodePendingAnchorSessionIdRef.current = sid;
      opencodeStickToBottomSessionRef.current = sid;
      setOpencodeAutoFollow(true);
      setOpencodeShowJumpLatest(false);
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

  useEffect(() => {
    if (!runtimeStatus.opencode.installed || !selectedRepo || !repoPath || !activeOpencodeSessionId) return;
    if (activeOpencodeSessionBusy) return;
    const sessionId = activeOpencodeSessionId.trim();
    if (!sessionId) return;
    const seq = opencodePassiveSyncSeqRef.current + 1;
    opencodePassiveSyncSeqRef.current = seq;
    const abort = new AbortController();
    let refreshTimer: number | null = null;
    let connectTimer: number | null = null;
    let stopped = false;
    const scheduleRefresh = (delay = 700) => {
      if (stopped || opencodePassiveSyncSeqRef.current !== seq) return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (stopped || opencodePassiveSyncSeqRef.current !== seq) return;
        invalidateOpencodeMessageCache(repoPath, sessionId);
        void loadOpencodeSessionMessages(sessionId).catch((e) => setError(String(e)));
        void refreshOpencodeSessions(getRepoSessionFetchLimit(selectedRepo.id)).catch(() => {});
      }, delay);
    };
    const handleRawEvent = (raw: string) => {
      let event: any;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      const wrapped = event?.payload ? event.payload : event;
      const typ = String(wrapped?.type || "");
      const props = wrapped?.properties || {};
      const sid = String(props?.sessionID || props?.part?.sessionID || "");
      if (sid !== sessionId) return;
      if (typ === "message.updated" || typ === "message.part.updated" || typ === "message.part.removed") {
        scheduleRefresh(350);
        return;
      }
      if (typ === "message.part.delta") return;
      if (typ === "session.idle") {
        const session = opencodeSessions.find((s) => s.id === sessionId);
        const hasContent = session && session.loaded && session.messages.length > 0;
        scheduleRefresh(hasContent ? 1500 : 80);
        return;
      }
      if (typ === "session.status" && String(props?.status?.type || "") === "idle") {
        const session = opencodeSessions.find((s) => s.id === sessionId);
        const hasContent = session && session.loaded && session.messages.length > 0;
        scheduleRefresh(hasContent ? 1500 : 80);
      }
    };
    const connect = async () => {
      try {
        const base = await invoke<string>("get_opencode_service_base", { repoPath });
        if (stopped || abort.signal.aborted) return;
        const url = `${base}/global/event?directory=${encodeURIComponent(repoPath)}`;
        appendOpencodeDebugLog(`session.passiveSync.connect ${sessionId}`);
        const resp = await fetch(url, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: abort.signal
        });
        if (!resp.ok || !resp.body) throw new Error(`SSE connect failed: HTTP ${resp.status}`);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const processFrame = (frame: string) => {
          if (!frame.trim()) return;
          const dataLines: string[] = [];
          for (const rawLine of frame.split(/\r?\n/)) {
            if (!rawLine || rawLine.startsWith(":")) continue;
            if (!rawLine.startsWith("data:")) continue;
            dataLines.push(rawLine.slice(5).replace(/^\s/, ""));
          }
          if (dataLines.length > 0) handleRawEvent(dataLines.join("\n"));
        };
        while (!stopped && !abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          while (true) {
            const m = buf.match(/\r?\n\r?\n/);
            if (!m || m.index == null) break;
            const frame = buf.slice(0, m.index);
            buf = buf.slice(m.index + m[0].length);
            processFrame(frame);
          }
        }
        processFrame(buf);
      } catch (e) {
        if (!abort.signal.aborted && !stopped) appendOpencodeDebugLog(`session.passiveSync.warn ${String(e)}`);
      }
    };
    connectTimer = window.setTimeout(() => {
      connectTimer = null;
      if (!stopped && opencodePassiveSyncSeqRef.current === seq) void connect();
    }, 600);
    return () => {
      stopped = true;
      abort.abort();
      if (connectTimer !== null) window.clearTimeout(connectTimer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [runtimeStatus.opencode.installed, repoPath, activeOpencodeSessionId, activeOpencodeSessionBusy]);

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
      // 保留：当前正在流式输出的消息，或已经有内容的非流式消息
      if (msg.id === streamingId && running) return true;
      // 新增：如果消息有 detail.parts 内容，也保留（避免流式结束后短暂消失）
      if (detail && Array.isArray(detail.parts) && detail.parts.length > 0) return true;
      return false;
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
    if (!generalSettings.showSessionProgressBar) {
      setOpencodeTodoDockVisible(false);
      setOpencodeTodoDockCollapsed(false);
      return;
    }
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
  }, [opencodeActiveTodos, activeOpencodeSessionBusy, generalSettings.showSessionProgressBar]);

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
    const missing = opencodeVisibleWindow.visible
      .filter((msg) => msg.role === "assistant")
      .filter((msg) => opencodeDetailsByMessageId[msg.id] === undefined && !opencodeDetailsLoadingByMessageId[msg.id])
      .slice(-8);
    if (missing.length === 0) return;
    const missingIds = missing.map((msg) => msg.id);
    setOpencodeDetailsLoadingByMessageId((prev) => {
      const next = { ...prev };
      for (const id of missingIds) next[id] = true;
      return next;
    });
    const timer = window.setTimeout(() => {
      void fetchOpencodeDetailedMessagePage(sid, "", OPENCODE_INITIAL_MESSAGE_FETCH_LIMIT)
        .then((page) => {
          if (activeOpencodeSessionId.trim() !== sid) return;
          setOpencodeDetailsByMessageId((prev) => {
            const next = { ...prev };
            for (const id of missingIds) {
              const serverId = (opencodeServerMessageIdByLocalId[id] || "").trim() || id;
              next[id] = page.detailsById[serverId] || null;
            }
            return next;
          });
        })
        .finally(() => {
          setOpencodeDetailsLoadingByMessageId((prev) => {
            const next = { ...prev };
            for (const id of missingIds) next[id] = false;
            return next;
          });
        });
    }, 120);
    return () => window.clearTimeout(timer);
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
    const shellTool = tool === "bash";
    const editTool = tool === "write" || tool === "edit" || tool === "apply_patch";
    const showOutput = !contextTool && !!outputPreview && (status === "error" || (shellTool && generalSettings.shellToolPartsExpanded) || (editTool && generalSettings.editToolPartsExpanded));
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
        {parsedRead && generalSettings.editToolPartsExpanded ? (
          <pre className="opencode-tool-output">{withLineNumbers(parsedRead.content, 80)}</pre>
        ) : null}
        {!parsedRead && showOutput ? <pre className="opencode-tool-output">{outputPreview}</pre> : null}
      </div>
    );
  }

  const opencodeHasHiddenHistory = opencodeTurnStart > 0;

  function opencodeIsNearBottom(el: HTMLDivElement, threshold = 24) {
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    return maxScroll - el.scrollTop <= threshold;
  }

  function setOpencodeAutoFollow(enabled: boolean) {
    opencodeScrollModeRef.current = enabled ? "follow" : "paused";
    opencodeAutoFollowLatestRef.current = enabled;
    setOpencodeAutoFollowLatest(enabled);
    if (enabled) {
      opencodePausedScrollSnapshotRef.current = null;
    } else {
      const el = opencodeThreadRef.current;
      opencodePausedScrollSnapshotRef.current = el ? { top: el.scrollTop, height: el.scrollHeight } : null;
    }
  }

  function cancelPendingOpencodeAutoScroll() {
    opencodeAutoScrollTokenRef.current += 1;
  }

  function scrollOpencodeThreadToBottomNow(options?: { hideJump?: boolean }) {
    const current = opencodeThreadRef.current;
    if (!current) return;
    opencodeProgrammaticScrollUntilRef.current = Date.now() + 300;
    current.scrollTop = Math.max(0, current.scrollHeight - current.clientHeight);
    opencodePrevScrollTopRef.current = current.scrollTop;
    if (options?.hideJump !== false) {
      setOpencodeShowJumpLatest(false);
    }
  }

  function scheduleOpencodeScrollToBottom(options?: { force?: boolean; hideJump?: boolean; source?: "system" | "user" }) {
    const token = opencodeAutoScrollTokenRef.current + 1;
    opencodeAutoScrollTokenRef.current = token;
    requestAnimationFrame(() => {
      if (opencodeAutoScrollTokenRef.current !== token) return;
      const current = opencodeThreadRef.current;
      if (!current) return;
      const source = options?.source || "system";
      const forceLatest = opencodeForceScrollLatestSessionRef.current === activeOpencodeSessionId;
      if (opencodeScrollModeRef.current === "paused" && source !== "user" && !forceLatest) return;
      if (source !== "user" && Date.now() < opencodeUserScrollPauseUntilRef.current && !forceLatest) return;
      if (!options?.force && !opencodeAutoFollowLatestRef.current && !forceLatest) return;
      scrollOpencodeThreadToBottomNow({ hideJump: options?.hideJump });
    });
  }

  function preserveOpencodePausedViewport() {
    if (opencodeScrollModeRef.current !== "paused") return;
    if (opencodeLoadingOlderRef.current) return;
    const el = opencodeThreadRef.current;
    const snapshot = opencodePausedScrollSnapshotRef.current;
    if (!el || !snapshot) return;
    const nextTop = Math.min(snapshot.top, Math.max(0, el.scrollHeight - el.clientHeight));
    opencodeAutoScrollTokenRef.current += 1;
    opencodeProgrammaticScrollUntilRef.current = Date.now() + 300;
    el.scrollTop = nextTop;
    opencodePrevScrollTopRef.current = el.scrollTop;
    opencodePausedScrollSnapshotRef.current = { top: el.scrollTop, height: el.scrollHeight };
  }

  function resumeOpencodeFollowFromUserAction(sessionId: string) {
    opencodeUserScrollPauseUntilRef.current = 0;
    opencodeStickToBottomSessionRef.current = sessionId;
    opencodeForceScrollLatestSessionRef.current = sessionId;
    setOpencodeAutoFollow(true);
    setOpencodeShowJumpLatest(false);
    scheduleOpencodeScrollToBottom({ force: true, source: "user" });
  }

  useEffect(() => {
    const sid = activeOpencodeSessionId.trim();
    if (!sid) return;
    if (opencodePendingAnchorSessionIdRef.current !== sid) return;
    if (!activeOpencodeSession?.loaded || opencodeMessages.length <= 0) return;
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (opencodeScrollModeRef.current === "paused") {
      opencodePendingAnchorSessionIdRef.current = "";
      return;
    }
    if (opencodeScrollModeRef.current !== "follow") return;
    scheduleOpencodeScrollToBottom({ force: true, source: "system" });
    requestAnimationFrame(() => {
      opencodePendingAnchorSessionIdRef.current = "";
    });
  }, [activeOpencodeSessionId, activeOpencodeSession?.loaded, opencodeMessages.length]);

  useEffect(() => {
    const sid = activeOpencodeSessionId.trim();
    if (!sid) return;
    if (opencodeStickToBottomSessionRef.current !== sid) return;
    if (!opencodeAutoFollowLatestRef.current) return;
    if (opencodeSessionLoading) return;
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (opencodeScrollModeRef.current !== "follow") return;
    // 如果当前不在底部附近，不自动滚动（避免流式结束后闪动）
    if (!opencodeIsNearBottom(el, 120)) return;
    scheduleOpencodeScrollToBottom();
  }, [activeOpencodeSessionId, opencodeSessionLoading, opencodeRenderedMessages.length, opencodeDetailsByMessageId, opencodeDetailsLoadingByMessageId]);

  useLayoutEffect(() => {
    const sid = activeOpencodeSessionId.trim();
    if (
      sid &&
      opencodeForceScrollLatestSessionRef.current === sid &&
      opencodeScrollModeRef.current === "follow" &&
      !opencodeSessionLoading
    ) {
      scrollOpencodeThreadToBottomNow();
      return;
    }
    preserveOpencodePausedViewport();
  }, [activeOpencodeSessionId, opencodeSessionLoading, opencodeMessages.length, opencodeRenderedMessages.length, opencodeDetailsByMessageId, opencodeDetailsLoadingByMessageId]);

  useEffect(() => {
    cancelPendingOpencodeAutoScroll();
    setOpencodeAutoFollow(true);
    setOpencodeShowJumpLatest(false);
    opencodePrevScrollTopRef.current = 0;
    opencodeForceScrollLatestSessionRef.current = "";
  }, [activeOpencodeSessionId]);

  function loadOlderOpencodeHistory() {
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (opencodeLoadingOlderRef.current) return;
    cancelPendingOpencodeAutoScroll();
    opencodeStickToBottomSessionRef.current = "";
    setOpencodeAutoFollow(false);
    setOpencodeShowJumpLatest(true);
    opencodePausedScrollSnapshotRef.current = { top: el.scrollTop, height: el.scrollHeight };
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
    const nearBottom = opencodeIsNearBottom(el, 24);
    const now = Date.now();
    if (now < opencodeProgrammaticScrollUntilRef.current) {
      opencodePrevScrollTopRef.current = el.scrollTop;
      if (nearBottom && opencodeScrollModeRef.current === "follow") {
        opencodeStickToBottomSessionRef.current = activeOpencodeSessionId;
        setOpencodeShowJumpLatest(false);
      }
      return;
    }
    const prevTop = opencodePrevScrollTopRef.current;
    const movedUp = el.scrollTop < prevTop - 2;
    const movedDown = el.scrollTop > prevTop + 2;
    opencodePrevScrollTopRef.current = el.scrollTop;
    const userScrollingUp = now < opencodeUserScrollUpUntilRef.current;
    const userScrollingDown = now < opencodeUserScrollDownUntilRef.current;
    if (movedUp && userScrollingUp) {
      cancelPendingOpencodeAutoScroll();
      opencodeStickToBottomSessionRef.current = "";
      setOpencodeAutoFollow(false);
      setOpencodeShowJumpLatest(true);
      opencodePausedScrollSnapshotRef.current = { top: el.scrollTop, height: el.scrollHeight };
    } else if (movedUp && opencodeScrollModeRef.current === "follow") {
      scheduleOpencodeScrollToBottom({ force: true, source: "system" });
    } else if (opencodeScrollModeRef.current === "paused") {
      if (userScrollingDown && movedDown) {
        opencodePausedScrollSnapshotRef.current = { top: el.scrollTop, height: el.scrollHeight };
      }
      if (nearBottom && userScrollingDown) {
        opencodeStickToBottomSessionRef.current = activeOpencodeSessionId;
        setOpencodeAutoFollow(true);
        setOpencodeShowJumpLatest(false);
      } else {
        setOpencodeShowJumpLatest(true);
        if (movedDown && !userScrollingDown) {
          preserveOpencodePausedViewport();
        }
      }
    } else if (nearBottom) {
      opencodeStickToBottomSessionRef.current = activeOpencodeSessionId;
      setOpencodeAutoFollow(true);
      setOpencodeShowJumpLatest(false);
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

  function jumpOpencodeToLatest() {
    const el = opencodeThreadRef.current;
    if (!el) return;
    resumeOpencodeFollowFromUserAction(activeOpencodeSessionId);
  }

  function onOpencodeThreadWheel(event: React.WheelEvent<HTMLDivElement>) {
    const el = opencodeThreadRef.current;
    if (!el) return;
    if (event.deltaY !== 0) {
      opencodeUserScrollPauseUntilRef.current = Date.now() + 800;
    }
    if (event.deltaY < 0) {
      opencodeUserScrollUpUntilRef.current = Date.now() + 800;
    }
    if (event.deltaY < 0 && opencodeScrollModeRef.current === "follow") {
      opencodeForceScrollLatestSessionRef.current = "";
      cancelPendingOpencodeAutoScroll();
      opencodeStickToBottomSessionRef.current = "";
      setOpencodeAutoFollow(false);
      setOpencodeShowJumpLatest(true);
    }
    if (event.deltaY > 0) {
      opencodeUserScrollDownUntilRef.current = Date.now() + 800;
    }
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
      opencodePrevScrollTopRef.current = el.scrollTop;
      if (opencodeScrollModeRef.current === "paused") {
        opencodePausedScrollSnapshotRef.current = { top: el.scrollTop, height: el.scrollHeight };
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
    if (!repoContextMenu && !sessionContextMenu && !commitContextMenu && !topologyContextMenu) return;
    const dismiss = () => {
      setRepoContextMenu(null);
      setSessionContextMenu(null);
      setCommitContextMenu(null);
      setTopologyContextMenu(null);
    };
    window.addEventListener("click", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
    };
  }, [repoContextMenu, sessionContextMenu, commitContextMenu, topologyContextMenu]);

  useEffect(() => {
    if (!showCommitActionMenu) return;
    const dismiss = () => setShowCommitActionMenu(false);
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, [showCommitActionMenu]);

  useEffect(() => {
    if (!opencodePreviewImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpencodePreviewImage(null);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      setOpencodePreviewImage((prev) => {
        if (!prev || prev.images.length <= 1) return prev;
        const delta = e.key === "ArrowRight" ? 1 : -1;
        return { ...prev, index: (prev.index + delta + prev.images.length) % prev.images.length };
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [opencodePreviewImage]);

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
        <button className="gt-new-session-btn" onClick={() => void createAndSwitchOpencodeSessionForSidebar()} disabled={repos.length === 0 || !runtimeStatus.opencode.installed}>
          <span>＋</span>
          <span>New Session</span>
        </button>
      </div>

      <div className="gt-project-stack">
        {repos.length === 0 ? <div className="gt-empty-hint">还没有项目，先导入一个本地工作区。</div> : null}
        {repos.map((repo) => {
          const expanded = expandedProjectIds.includes(repo.id);
          const repoSessions = getVisibleRepoSessions(repo.id);
          const repoHasMoreSessions = hasMoreRepoSessions(repo.id);
          const repoSessionsLoading = isRepoSessionsLoading(repo.id);
          const hasDraftForRepo = draftOpencodeSession && repo.id === selectedRepo?.id;
          const shouldRenderChildren = expanded && (repoSessionsLoading || repoSessions.length > 0 || repoHasMoreSessions || hasDraftForRepo || !runtimeStatus.opencode.installed);
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
                  className="gt-tree-add"
                  aria-label={`在 ${repo.name} 新建会话`}
                  title="新建会话"
                  disabled={!runtimeStatus.opencode.installed}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (busy || !runtimeStatus.opencode.installed) return;
                    startDraftSessionForRepo(repo);
                  }}
                >
                  ＋
                </button>
                <button
                  className="gt-tree-toggle"
                  aria-label={expanded ? "收起项目" : "展开项目"}
                  onClick={() => toggleRepoSessions(repo)}
                >
                  <span className="gt-tree-toggle-hit" aria-hidden="true" />
                </button>
              </div>

              {shouldRenderChildren ? (
                <div className="gt-tree-children">
                  {hasDraftForRepo ? (
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
                  {runtimeStatus.opencode.installed
                    ? repoSessions.map((session) => (
                      <button
                        key={`left-session-${session.id}`}
                        className={session.id === activeOpencodeSessionId ? "gt-session-item active" : "gt-session-item"}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSessionContextMenu({ x: e.clientX, y: e.clientY, repo, session });
                        }}
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
                          setNewSessionTargetRepoId(repo.id);
                          opencodeSessionsRepoIdRef.current = repo.id;
                          if (selectedRepo?.id !== repo.id) setSelectedRepo(repo);
                          if ((rightPaneTabRef.current === "changes" || rightPaneTabRef.current === "worktree") && gitPaneRepo?.id !== repo.id) setGitPaneRepo(repo);
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
          <button className="gt-user-settings" title="Settings" onClick={() => setShowSettings(true)} aria-label="Settings">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z" fill="none" stroke="currentColor" strokeWidth="1.55" />
              <path d="M19 13.2v-2.4l-1.9-.34a5.7 5.7 0 0 0-.47-1.13l1.1-1.57-1.7-1.7-1.57 1.1c-.36-.2-.74-.36-1.14-.47L13 4.8h-2.4l-.34 1.89c-.4.11-.78.27-1.14.47l-1.57-1.1-1.7 1.7 1.1 1.57c-.2.36-.36.74-.47 1.13L4.6 10.8v2.4l1.88.34c.11.39.27.77.47 1.13l-1.1 1.57 1.7 1.7 1.57-1.1c.36.2.74.36 1.14.47l.34 1.89H13l.33-1.89c.4-.11.78-.27 1.14-.47l1.57 1.1 1.7-1.7-1.1-1.57c.2-.36.36-.74.47-1.13L19 13.2Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
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
                const latestAssistantId = [...opencodeMessages].reverse().find((row) => row.role === "assistant")?.id || "";
                const isStreaming = isAssistant && msg.id === activeOpencodeStreamingAssistantId && msg.id === latestAssistantId && activeOpencodeSessionBusy;
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
                            const activeReasoningPartId = isStreaming
                              ? [...renderParts]
                                .reverse()
                                .find((part) => String((part as { type?: string }).type || "") === "reasoning")?.id || ""
                              : "";
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
                              if (g.kind === "reasoning") {
                                if (!generalSettings.showReasoningSummaries) return null;
                                const text = g.parts
                                  .map((part) => String((part as { text?: string }).text || "").trim())
                                  .filter(Boolean)
                                  .join("\n\n");
                                if (!text) return null;
                                const activeThink = isStreaming && g.parts.some((part) => String(part.id || "") === activeReasoningPartId);
                                const thinkPreviewLines = text
                                  .split(/\n+/)
                                  .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
                                  .filter(Boolean)
                                  .slice(-4);
                                const thinkPreview = thinkPreviewLines.length > 0
                                  ? thinkPreviewLines
                                  : ["Reading context", "Tracing changes", "Composing answer"];
                                return (
                                  <details key={`${msg.id}:${g.key}`} className={activeThink ? "opencode-think-card is-active" : "opencode-think-card"}>
                                    <summary className="opencode-think-card-summary">
                                      <span className="opencode-think-label">
                                        <span className="opencode-think-spark" aria-hidden="true" />
                                        Think
                                      </span>
                                      {thinkPreview.length > 0 ? (
                                        <span className={activeThink ? "opencode-think-carousel is-active" : "opencode-think-carousel"} aria-label="thinking preview">
                                          <span className="opencode-think-carousel-track" style={{ ["--think-count" as any]: thinkPreview.length }}>
                                            {thinkPreview.map((line, lineIdx) => (
                                              <span
                                                key={`${g.key}:think-preview:${lineIdx}`}
                                                className="opencode-think-carousel-line"
                                                style={{ ["--think-index" as any]: lineIdx }}
                                              >
                                                {line}
                                              </span>
                                            ))}
                                          </span>
                                        </span>
                                      ) : null}
                                    </summary>
                                    <div className="opencode-msg-body">
                                      <MarkdownLite source={text} />
                                    </div>
                                  </details>
                                );
                              }
                              if (g.kind !== "part") return null;
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
                    ) : msg.content.trim() || (msg.attachments && msg.attachments.length > 0) ? (
                      <div className="opencode-msg-body">
                        {msg.attachments && msg.attachments.length > 0 ? (
                          <div className="opencode-msg-attachments">
                            {msg.attachments.map((img, imageIndex) => (
                              <button
                                key={img.id}
                                type="button"
                                className="opencode-msg-image-btn"
                                onClick={() => setOpencodePreviewImage({
                                  images: msg.attachments?.map((item) => ({ uri: item.uri, filename: item.filename })) || [],
                                  index: imageIndex
                                })}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  void copyText(img.uri);
                                }}
                                title="点击查看，右键复制图片数据"
                              >
                                <img className="opencode-msg-image" src={img.uri} alt={img.filename || "attachment"} />
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {msg.content.trim() ? <MarkdownLite source={msg.content} /> : null}
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
            {generalSettings.showSessionProgressBar && opencodeTodoDockVisible && opencodeActiveTodos.length > 0 ? (
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
            {opencodeActivePermissions.length > 0 ? (
              <div className="gt-permission-dock">
                <div className="gt-permission-dock-head">
                  <span>授权请求</span>
                  <button type="button" className="chip" onClick={() => openOpencodeModulePanel("permissions")}>详情</button>
                </div>
                {opencodeActivePermissions.slice(0, 2).map((req) => (
                  <div key={req.id} className="gt-permission-card">
                    <div className="gt-permission-main">
                      <strong>{req.permission || "permission"}</strong>
                      <span>{(req.patterns || []).join(", ") || "*"}</span>
                      {req.tool?.callID ? <small>{req.tool.callID}</small> : null}
                    </div>
                    <div className="gt-permission-actions">
                      <button type="button" className="chip" onClick={() => void sendPermissionReply(req.id, "once")}>本次允许</button>
                      <button type="button" className="chip primary" onClick={() => void sendPermissionReply(req.id, "always")}>总是允许</button>
                      <button type="button" className="chip danger" onClick={() => void sendPermissionReply(req.id, "reject")}>拒绝</button>
                    </div>
                  </div>
                ))}
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
              {opencodeShowJumpLatest ? (
                <button
                  type="button"
                  className="opencode-jump-latest-btn"
                  onClick={jumpOpencodeToLatest}
                  aria-label="拉到最新"
                  title="拉到最新"
                >
                  ↓
                </button>
              ) : null}
              {opencodeImageAttachments.length > 0 || opencodeMcpPromptRefs.length > 0 ? (
                <div className="opencode-composer-chips">
                  {opencodeImageAttachments.length > 0 ? (
                    <div className="opencode-attachments">
                      {opencodeImageAttachments.map((img) => (
                        <div key={img.id} className="opencode-attachment-chip">
                          <img src={img.dataUrl} alt={img.filename} className="opencode-attachment-thumb" />
                          <span className="opencode-attachment-name">{img.filename}</span>
                          <button
                            type="button"
                            className="opencode-attachment-remove"
                            onClick={() => setOpencodeImageAttachments((prev) => prev.filter((i) => i.id !== img.id))}
                            aria-label="移除图片"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {opencodeMcpPromptRefs.length > 0 ? (
                    <div className="opencode-mcp-reference-chips">
                      {opencodeMcpPromptRefs.map((name) => (
                        <div key={name} className="opencode-mcp-reference-chip">
                          <span>{name}</span>
                          <button
                            type="button"
                            onClick={() => setOpencodeMcpPromptRefs((prev) => prev.filter((item) => item !== name))}
                            aria-label={`移除 ${name} MCP 引用`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="opencode-composer-main">
                {opencodeSlashOpen && opencodeSlashSuggestions.length > 0 ? (
                  <div className="opencode-slash-popover">
                    {opencodeSlashSuggestions.map((cmd, idx) => (
                      <button
                        key={cmd.id}
                        type="button"
                        className={idx === opencodeSlashActiveIndex ? "opencode-slash-item active" : "opencode-slash-item"}
                        onMouseEnter={() => setOpencodeSlashActiveIndex(idx)}
                        onClick={() => activateOpencodeSlashCommand(cmd)}
                      >
                        <span className="opencode-slash-trigger">/{cmd.trigger}</span>
                        <span className="opencode-slash-title">{cmd.title}</span>
                        {cmd.description ? <span className="opencode-slash-desc">{cmd.description}</span> : null}
                        <span className={`opencode-slash-badge ${cmd.source}`}>{cmd.source}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="opencode-input-shell opencode-composer-editor">
                  <textarea
                    ref={opencodeInputRef}
                    className="opencode-input"
                    placeholder="要做什么？"
                    value={opencodePromptInput}
                    onCompositionStart={() => {
                      opencodeInputComposingRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      opencodeInputComposingRef.current = false;
                    }}
                    onChange={(e) => {
                      const value = e.target.value;
                      const historyKey = getOpencodePromptHistorySessionKey();
                      opencodePromptHistoryIndexBySessionRef.current[historyKey] = -1;
                      opencodePromptHistoryDraftBySessionRef.current[historyKey] = value;
                      setOpencodePromptInput(value);
                      const isSlash = /^\//.test(value) && !value.includes(" ");
                      setOpencodeSlashOpen(isSlash);
                      setOpencodeSlashActiveIndex(0);
                    }}
                    onKeyDown={(e) => {
                      if (activeOpencodeSessionBusy) return;
                      const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
                      if (nativeEvent.isComposing || opencodeInputComposingRef.current || nativeEvent.keyCode === 229) return;
                      if (opencodeSlashOpen && opencodeSlashSuggestions.length > 0) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setOpencodeSlashActiveIndex((i) => (i + 1) % opencodeSlashSuggestions.length);
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setOpencodeSlashActiveIndex((i) => (i - 1 + opencodeSlashSuggestions.length) % opencodeSlashSuggestions.length);
                          return;
                        }
                        if (e.key === "Enter" || e.key === "Tab") {
                          e.preventDefault();
                          const cmd = opencodeSlashSuggestions[opencodeSlashActiveIndex];
                          if (cmd) activateOpencodeSlashCommand(cmd);
                          return;
                        }
                        if (e.key === "Escape") {
                          setOpencodeSlashOpen(false);
                          return;
                        }
                      }
                      if (e.key === "ArrowUp" && shouldUsePromptHistoryKey(e, "older")) {
                        e.preventDefault();
                        browseOpencodePromptHistory("older");
                        return;
                      }
                      if (e.key === "ArrowDown" && shouldUsePromptHistoryKey(e, "newer")) {
                        e.preventDefault();
                        browseOpencodePromptHistory("newer");
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void runOpencodePrompt();
                      }
                    }}
                    onPaste={async (e) => {
                      const files = Array.from(e.clipboardData?.files || []);
                      if (files.length === 0) return;
                      e.preventDefault();
                      const attachments = await Promise.all(files.map((f) => readImageFileAsAttachment(f)));
                      setOpencodeImageAttachments((prev) => [...prev, ...attachments.filter(Boolean) as OpencodeImageAttachment[]]);
                    }}
                    rows={1}
                  />
                </div>
              </div>
              <div className="opencode-composer-actions">
                <div className="opencode-composer-actions-left">
                  <div className="opencode-attachment-menu-wrap">
                    <button
                      type="button"
                      className={opencodeAttachmentMenuOpen ? "opencode-image-btn open" : "opencode-image-btn"}
                      onClick={() => setOpencodeAttachmentMenuOpen((prev) => !prev)}
                      aria-label={opencodeAttachmentMenuOpen ? "关闭附件菜单" : "添加附件"}
                      aria-expanded={opencodeAttachmentMenuOpen}
                      title="添加附件"
                    >
                      <span className="opencode-image-btn-icon">{opencodeAttachmentMenuOpen ? "×" : "+"}</span>
                    </button>
                    {opencodeAttachmentMenuOpen ? (
                      <div className="opencode-attachment-menu">
                        <button
                          type="button"
                          className="opencode-attachment-menu-item"
                          onClick={() => {
                            setOpencodeAttachmentMenuOpen(false);
                            opencodeImageInputRef.current?.click();
                          }}
                        >
                          <span className="opencode-attachment-menu-icon" aria-hidden="true">▧</span>
                          <span>上传图片</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <input
                    ref={opencodeImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length === 0) return;
                      const attachments = await Promise.all(files.map((f) => readImageFileAsAttachment(f)));
                      setOpencodeImageAttachments((prev) => [...prev, ...attachments.filter(Boolean) as OpencodeImageAttachment[]]);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
                <div className="opencode-composer-actions-right">
                  <div className="opencode-model-picker-wrap opencode-config-inline" ref={opencodeModelPickerRef}>
                    <button
                      type="button"
                      className="opencode-config-trigger"
                      aria-haspopup="dialog"
                      aria-expanded={showOpencodeModelPicker}
                      onClick={() => {
                        const next = !showOpencodeModelPicker;
                        setShowOpencodeModelPicker(next);
                      }}
                      title="配置 Agent、Auto 和模型"
                    >
                      {(() => {
                        const display = getOpencodeModelDisplay(activeOpencodeModel || "");
                        const agentLabel = OPENCODE_COMPOSER_AGENT_OPTIONS.find((item) => item.name === activeOpencodeAgent)?.label || "Build";
                        return (
                          <span className="opencode-config-trigger-copy">
                            <span className="opencode-config-trigger-mode">{agentLabel}</span>
                            <span className="opencode-config-trigger-model">{display.label || "Auto"}</span>
                          </span>
                        );
                      })()}
                    </button>
                    {showOpencodeModelPicker ? (
                      <div className="opencode-model-picker opencode-config-panel">
                        <input
                          className="path-input opencode-model-search"
                          placeholder="Search models"
                          value={opencodeModelPickerSearch}
                          onChange={(e) => setOpencodeModelPickerSearch(e.target.value)}
                        />
                        <div className="opencode-config-menu-group" aria-label="Agent 模式">
                          {OPENCODE_COMPOSER_AGENT_OPTIONS.map((agent) => (
                            <button
                              key={agent.name}
                              type="button"
                              aria-pressed={activeOpencodeAgent === agent.name}
                              className={activeOpencodeAgent === agent.name ? "opencode-config-menu-row selected" : "opencode-config-menu-row"}
                              onClick={() => applyOpencodeAgent(agent.name)}
                              title={agent.title}
                            >
                              <span>{agent.label}</span>
                              {activeOpencodeAgent === agent.name ? <span className="opencode-model-option-check">✓</span> : null}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className={opencodeAutoAcceptPermissions ? "opencode-config-menu-row opencode-config-toggle active" : "opencode-config-menu-row opencode-config-toggle"}
                          aria-pressed={opencodeAutoAcceptPermissions}
                          onClick={() => {
                            const next = !opencodeAutoAcceptPermissions;
                            setOpencodeAutoAcceptPermissions(next);
                            saveLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, next);
                            if (next && activeOpencodeSessionId) void ensureSessionAutoAcceptPermissions(activeOpencodeSessionId);
                          }}
                        >
                          <span>Auto</span>
                          <span className="opencode-config-switch" aria-hidden="true" />
                        </button>
                        <div className="opencode-config-divider" />
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
                            setSettingsInitialSection("models");
                            setShowSettings(true);
                            setOpencodeProviderPickerSearch("");
                            setOpencodeProviderPickerProvider(opencodeModelProvider);
                            setOpencodeProviderPickerModelSearch("");
                            setShowOpencodeModelPicker(false);
                          }}>
                            <span>Add Models</span>
                            <span className="opencode-model-picker-config-tail">⌘</span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <button
                    className={activeOpencodeSessionBusy ? "opencode-run-btn opencode-composer-send opencode-stop-btn" : "opencode-run-btn opencode-composer-send"}
                    disabled={!activeOpencodeSessionBusy && !opencodePromptInput.trim() && opencodeMcpPromptRefs.length === 0 && opencodeImageAttachments.length === 0}
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
                  if (normalized.length === 0 || normalized.includes("worktree") || normalized.includes(".worktrees")) return false;
                  // Filter out pure remote names like "origin" (not actual branches)
                  const info = branches.find((b) => b.name === name);
                  if (info?.isRemote && !name.includes("/")) return false;
                  return true;
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
                const isRemoteBranch = (name: string) => name.includes("/") && !name.startsWith("worktree/");
                
                // Separate local and remote parent maps
                const localParentMap: Record<string, string> = {};
                const remoteParentMap: Record<string, string> = {};
                Object.entries(branchParentMap).forEach(([child, parent]) => {
                  if (!allBranchNames.has(child) || !allBranchNames.has(parent)) return;
                  if (isRemoteBranch(child)) {
                    remoteParentMap[child] = parent;
                  } else {
                    localParentMap[child] = parent;
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
                  if (localParentMap[branch]) return;
                  if (branch === defaultMain) return;
                  if (isRemoteBranch(branch)) return;

                  const branchSha = branchHeadByName.get(branch);
                  if (!branchSha) return;

                  const candidates: Array<{ name: string; distance: number }> = [];
                  branchNames.forEach((candidate) => {
                    if (candidate === branch) return;
                    if (isRemoteBranch(candidate)) return;
                    const candidateSha = branchHeadByName.get(candidate);
                    if (!candidateSha) return;
                    
                    const dist = ancestorDistance(candidateSha, branchSha);
                    if (dist < Infinity && dist > 0) {
                      candidates.push({ name: candidate, distance: dist });
                    }
                  });

                  if (candidates.length > 0) {
                    candidates.sort((a, b) => a.distance - b.distance);
                    localParentMap[branch] = candidates[0].name;
                  } else if (defaultMain) {
                    const prefix = branch.split("/")[0]?.toLowerCase() || "";
                    const developBranch = branchNames.find((b) => b === "develop" || b === "dev");
                    const isFeatureLike = ["feature", "hotfix", "fix", "release", "chore", "docs", "test", "refactor", "style"].includes(prefix);

                    if (branch === "develop" || branch === "dev") {
                      localParentMap[branch] = defaultMain;
                    } else if (isFeatureLike && developBranch) {
                      localParentMap[branch] = developBranch;
                    } else {
                      localParentMap[branch] = defaultMain;
                    }
                  }
                });

                // Build local branch tree
                const localBranchNames = branchNames.filter((b) => !isRemoteBranch(b));
                const localRootBranches: string[] = [];
                localBranchNames.forEach((branch) => {
                  const parent = localParentMap[branch];
                  if (!parent || !localBranchNames.includes(parent)) {
                    localRootBranches.push(branch);
                  }
                });
                if (localRootBranches.length === 0 && localBranchNames.length > 0) {
                  localRootBranches.push(localBranchNames[0]);
                }
                sortBranches(localRootBranches);

                const localChildrenByParent = new Map<string, string[]>();
                localBranchNames.forEach((branch) => {
                  const parent = localParentMap[branch];
                  if (!parent || !localBranchNames.includes(parent)) return;
                  const list = localChildrenByParent.get(parent) || [];
                  list.push(branch);
                  localChildrenByParent.set(parent, list);
                });
                localChildrenByParent.forEach((list) => sortBranches(list));

                // Build remote branch tree
                const remoteBranchNames = branchNames.filter((b) => isRemoteBranch(b));
                const remoteRootBranches: string[] = [];
                remoteBranchNames.forEach((branch) => {
                  const parent = remoteParentMap[branch];
                  if (!parent || !remoteBranchNames.includes(parent)) {
                    remoteRootBranches.push(branch);
                  }
                });
                if (remoteRootBranches.length === 0 && remoteBranchNames.length > 0) {
                  remoteRootBranches.push(remoteBranchNames[0]);
                }
                sortBranches(remoteRootBranches);

                const remoteChildrenByParent = new Map<string, string[]>();
                remoteBranchNames.forEach((branch) => {
                  const parent = remoteParentMap[branch];
                  if (!parent || !remoteBranchNames.includes(parent)) return;
                  const list = remoteChildrenByParent.get(parent) || [];
                  list.push(branch);
                  remoteChildrenByParent.set(parent, list);
                });
                remoteChildrenByParent.forEach((list) => sortBranches(list));

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
                  ? worktreeParentMap[normalizeWorkspacePath(topologySelectionId.slice(9))] || selectedBranch || actualCurrentBranchName || defaultMain || localRootBranches[0] || ""
                  : topologySelectionId.startsWith("branch:")
                  ? topologySelectionId.slice(7)
                  : selectedBranch || actualCurrentBranchName || defaultMain || localRootBranches[0] || "";
                const activeTreeBranch = allBranchNames.has(selectedTreeBranch) ? selectedTreeBranch : defaultMain || localRootBranches[0] || "";
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
                  return commitsFromGraph(branchName, 20).length;
                };

                const selectBranchFromTree = (branchName: string) => {
                  setTopologySelectionId(`branch:${branchName}`);
                  void chooseBranch(branchName);
                };

                const renderBranchRow = (branchName: string, depth = 0, childrenMap = localChildrenByParent): ReactNode => {
                  const childBranches = childrenMap.get(branchName) || [];
                  const childWorktrees = branchWorktrees(branchName);
                  const treeKey = `tree:${branchName}`;
                  const collapsed = collapsedBranchIds.has(treeKey);
                  const tone = branchTone(branchName);
                  const branchInfo = branches.find((b) => b.name === branchName);
                  const isCurrent = branchName === currentBranchName || !!branchInfo?.isCurrent;
                  const isRemote = !!branchInfo?.isRemote || (branchName.includes("/") && !branchName.startsWith("worktree/"));
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
                      {!collapsed ? childBranches.map((child) => renderBranchRow(child, depth + 1, childrenMap)) : null}
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
                        {localRootBranches.length > 0 ? (
                          <>
                            {localRootBranches.map((branch) => renderBranchRow(branch, 0, localChildrenByParent))}
                          </>
                        ) : null}
                        {remoteRootBranches.length > 0 ? (
                          <>
                            <div className="gt-gittree-section-divider" style={{ margin: "8px 0", padding: "4px 10px", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Remote</div>
                            {remoteRootBranches.map((branch) => renderBranchRow(branch, 0, remoteChildrenByParent))}
                          </>
                        ) : null}
                        {localRootBranches.length === 0 && remoteRootBranches.length === 0 ? (
                          <div className="gt-empty-hint">暂无本地分支。</div>
                        ) : null}
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
                            onMouseEnter={(e) => setCommitHoverCard({ x: e.clientX, y: e.clientY, sha: commit.sha, branch: activeTreeBranch, subject: commit.subject, author: commit.author, date: commit.date })}
                            onMouseMove={(e) => setCommitHoverCard((prev) => prev?.sha === commit.sha ? { ...prev, x: e.clientX, y: e.clientY } : prev)}
                            onMouseLeave={() => setCommitHoverCard(null)}
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
                  <span className="gt-changes-context"><span>Local</span>{worktreeOverview.branch || selectedBranch || "no branch"}</span>
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
                      className={committing || pushing ? "chip is-primary gt-commit-menu-btn is-loading" : "chip is-primary gt-commit-menu-btn"}
                      onClick={() => setShowCommitActionMenu((prev) => !prev)}
                      disabled={committing || pushing || !commitMenuAvailable}
                      title="More commit actions"
                    >
                      <svg className="gt-commit-chevron" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4.5 6.5 8 10l3.5-3.5" />
                      </svg>
                    </button>
                    {showCommitActionMenu ? (
                      <div className="gt-commit-action-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => void handleGitCommit()} disabled={committing || pushing || !hasCommittableChanges}>{appText.commit}</button>
                        <button type="button" role="menuitem" onClick={() => void handleGitPush()} disabled={committing || pushing}>{appText.push}</button>
                        <button type="button" role="menuitem" onClick={() => void handleGitCommitAndPush()} disabled={committing || pushing || !hasCommittableChanges}>{appText.commitPush}</button>
                        <button type="button" role="menuitem" onClick={() => void handleGitCommitAndSync()} disabled={committing || pushing || !hasCommittableChanges}>{appText.commitSync}</button>
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
                          {renderWorktreeNodes(stagedTree, 0, "unstage")}
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
                          {renderWorktreeNodes(unstagedTree, 0, "stage")}
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
                  <Suspense fallback={<div className="gt-worktree-patch-empty">Loading diff viewer...</div>}>
                    <MonacoDiffViewer
                      filePath={selectedWorktreeFile}
                      original={selectedWorktreeContent.original}
                      modified={selectedWorktreeContent.modified}
                      language={getMonacoLanguage(selectedWorktreeFile)}
                      theme={theme}
                    />
                  </Suspense>
                </div>
              ) : (
                <div className="gt-worktree-patch-empty">选择左侧文件后查看 patch。</div>
              )}
            </div>
          </div>
        ) : null}

        {rightPaneTab === "skills" ? (
          <div className="gt-skill-market-shell">
            <details className="gt-installed-skills-collapsible">
              <summary><span>已安装 Skills</span><small>{opencodeSkills.length}</small><button type="button" className="gt-icon-chip" onClick={(e) => { e.preventDefault(); void refreshOpencodeSkills(); }} title="刷新">↻</button></summary>
              <div className="gt-installed-skill-grid">
                {opencodeInstalledSkillNodes}
              </div>
            </details>

            <div className="gt-skill-market-layout">
              <main className="gt-skill-leaderboard-card" ref={opencodeSkillMarketListRef} onScroll={handleOpencodeSkillMarketScroll}>
                <div className="gt-skill-market-toolbar">
                  <div className="gt-skill-searchbox">
                    <span aria-hidden="true">⌕</span>
                    <input
                      placeholder={opencodeSkillSearchStrategy === "ai" ? "Describe what you want to build or automate..." : "Search skills, sources, descriptions..."}
                      value={opencodeSkillSearchQuery}
                      onChange={(e) => setOpencodeSkillSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void searchOpencodeSkillRegistry();
                      }}
                    />
                  </div>
                </div>
                <div className="gt-skill-filterbar">
                  <div className="gt-skill-mode-toggle" aria-label="搜索模式">
                    {([
                      ["keyword", "关键词"],
                      ["ai", "AI 语义"]
                    ] as Array<[OpencodeSkillSearchStrategy, string]>).map(([strategy, label]) => (
                      <button key={strategy} type="button" className={opencodeSkillSearchStrategy === strategy ? "active" : ""} onClick={() => setOpencodeSkillSearchStrategy(strategy)}>{label}</button>
                    ))}
                  </div>
                  <span className="gt-skill-filter-hint">{opencodeSkillSearchStrategy === "ai" ? (skillsmpApiKey ? "AI 语义搜索已启用" : "未配置 key 时会自动回退关键词搜索") : `按 stars 排序，首屏展示 ${opencodeSkillDisplayBatchSize} 条`}</span>
                </div>
                <div className="gt-skill-market-tabs">
                  {([
                    ["all-time", `All Time${opencodeSkillCatalogTotal ? ` (${formatSkillInstalls(opencodeSkillCatalogTotal)})` : ""}`],
                    ["trending", "Trending (24h)"],
                    ["hot", "Hot"],
                    ["official", "Official"]
                  ] as Array<["all-time" | "trending" | "hot" | "official", string]>).map(([view, label]) => (
                    <button key={view} type="button" className={opencodeSkillCatalogView === view && opencodeSkillSearchResults.length === 0 ? "active" : ""} onClick={() => switchOpencodeSkillCatalogView(view)}>{label}</button>
                  ))}
                </div>
                {opencodeSkillsError ? <div className="gt-module-empty danger">{opencodeSkillsError}</div> : null}
                {opencodeSkillInstallNotice ? <div className="gt-skill-inline-error">{opencodeSkillInstallNotice}</div> : null}
                {(opencodeSkillBusy || opencodeSkillInstallingSpec || opencodeSkillInstallLog) ? (
                  <div className="gt-skill-install-log">
                    <div><strong>Install log</strong><span>{opencodeSkillInstallingSpec || "last install"}</span></div>
                    <pre>{opencodeSkillInstallLog || `正在启动安装 ${opencodeSkillInstallingSpec || "skill"}...`}</pre>
                  </div>
                ) : null}
                <div className="gt-skill-market-meta">
                  <span>{opencodeSkillSearchResults.length > 0 ? `Search · ${opencodeSkillSearchMeta?.searchType || "skillsmp"} · ${opencodeSkillSearchMeta?.count || opencodeSkillSearchResults.length} results` : opencodeSkillCatalogRows.length > 0 ? `${opencodeSkillCatalogView} leaderboard · page ${opencodeSkillCatalogPage + 1}` : opencodeSkillsInitialLoading ? "正在整理 Skills 市场首页..." : "展示本地推荐榜单"}</span>
                </div>
                {opencodeSkillsInitialLoading ? (
                  <div className="gt-skill-skeleton-list" aria-hidden="true">
                    {Array.from({ length: 6 }).map((_, idx) => <span key={idx} />)}
                  </div>
                ) : visibleOpencodeMarketplaceRows.length > 0 ? (
                  <>
                  <div className={opencodeSkillsSearching || opencodeSkillsPaging ? "gt-skill-card-list is-loading" : "gt-skill-card-list"}>
                    {opencodeSkillCardNodes}
                  </div>
                  {(opencodeSkillsSearching || opencodeSkillsPaging) ? (
                    <div className="gt-skill-skeleton-list gt-skill-inline-skeleton" aria-label="正在加载更多 skills">
                      {Array.from({ length: 2 }).map((_, idx) => <span key={idx} />)}
                    </div>
                  ) : null}
                  </>
                ) : (
                  <div className="gt-skill-inspector-empty gt-skill-empty-state"><strong>没有找到匹配的 Skill</strong><span>试试切回关键词搜索、清空分类，或者改用更通用的描述词。</span></div>
                )}
                <div className="gt-skill-market-pager">
                  <span>{opencodeSkillsInitialLoading ? "首次进入时会先准备精选榜单与已安装列表" : `已显示 ${visibleOpencodeMarketplaceRows.length} / ${opencodeMarketplaceRows.length}`}</span>
                  {opencodeSkillsInitialLoading ? <span className="muted">正在为你整理首页内容...</span> : opencodeSkillsPaging ? <span className="gt-skill-auto-load is-loading">Loading more...</span> : (opencodeCanRevealMoreSkills || opencodeCanFetchMoreCatalogSkills || (!opencodeSkillAllowBackendCatalogFetch && opencodeMarketplaceRows.length < opencodeSkillDisplayBatchSize && !opencodeSkillCatalogRows.length && !opencodeSkillSearchResults.length)) ? <span className="gt-skill-auto-load">滑到底部自动加载更多</span> : <span className="gt-skill-auto-load is-done">已到底部</span>}
                </div>
              </main>

              <aside className="gt-skill-inspector-card">
                {selectedMarketplaceSkill ? (
                  <>
                    <div className="gt-skill-inspector-head">
                      <span className="gt-module-kicker">selected skill</span>
                      <h3>{selectedMarketplaceSkill.skill}</h3>
                      <p>{selectedMarketplaceSkill.package}</p>
                      <span className={`gt-skill-quality ${skillQualityLabel(selectedMarketplaceSkill)}`}>{skillQualityLabel(selectedMarketplaceSkill)}</span>
                    </div>
                    <div className="gt-skill-inspector-actions gt-skill-install-wrap">
                      <button className="chip primary" onClick={() => setShowSkillInstallMenu((prev) => !prev)} disabled={opencodeSkillBusy}>{opencodeSkillBusy ? "安装中..." : "安装"}</button>
                      {showSkillInstallMenu ? (
                        <div className="gt-skill-install-menu">
                          <button type="button" onClick={() => { setShowSkillInstallMenu(false); void installOpencodeSkillFromRegistry(selectedMarketplaceSkill.installSpec || selectedMarketplaceSkill.spec, "project", [selectedMarketplaceSkill.installUrl || "", selectedMarketplaceSkill.url || "", selectedMarketplaceSkill.spec]); }}>安装到当前 Repo</button>
                          <button type="button" onClick={() => { setShowSkillInstallMenu(false); void installOpencodeSkillFromRegistry(selectedMarketplaceSkill.installSpec || selectedMarketplaceSkill.spec, "global", [selectedMarketplaceSkill.installUrl || "", selectedMarketplaceSkill.url || "", selectedMarketplaceSkill.spec]); }}>安装到 Global</button>
                        </div>
                      ) : null}
                      <button className="chip" onClick={() => void loadSelectedMarketplaceSkillDetails(selectedMarketplaceSkill)} disabled={selectedSkillLoading}>查看详情</button>
                    </div>
                    <div className="gt-skill-inspector-stats">
                      <span><strong>{selectedMarketplaceSkill.installs}</strong>Installs</span>
                      <span><strong>{selectedSkillDetail?.files?.length || 0}</strong>Files</span>
                      <span><strong>{selectedSkillAudits.length}</strong>Audits</span>
                    </div>
                    {selectedSkillLoading ? <div className="gt-module-empty">正在加载详情...</div> : null}
                    <div className="gt-skill-audit-list">
                      {selectedSkillAudits.length === 0 ? <div className="gt-module-empty">点击“查看详情”后加载文件快照和安全审计。</div> : null}
                      {selectedSkillAudits.map((audit) => <div key={`${audit.provider}-${audit.slug}`} className={`gt-skill-audit-row ${audit.status}`}><strong>{audit.provider}</strong><span>{audit.riskLevel || audit.status}</span><p>{audit.summary || "No summary"}</p></div>)}
                    </div>
                    <div className="gt-skill-file-list">
                      {(selectedSkillDetail?.files || []).slice(0, 8).map((file) => <div key={file.path}><strong>{file.path}</strong><span>{file.contents.split(/\r?\n/).length} lines</span></div>)}
                    </div>
                  </>
                ) : (
                  <div className="gt-skill-inspector-empty"><strong>选择一个 Skill</strong><span>查看来源、质量信号，并像插件市场一样直接安装。</span></div>
                )}
                <div className="gt-installed-skills-mini">
                  <div className="gt-installed-skills-head"><div><strong>已安装</strong><span>{opencodeSkills.length} skills</span></div><button className="chip" onClick={() => void refreshOpencodeSkills()} disabled={opencodeSkillsLoading}>刷新</button></div>
                  {filteredOpencodeSkills.slice(0, 6).map((skill) => {
                    const removeKey = `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`;
                    return <button type="button" key={removeKey} className="gt-installed-skill-row is-reference" onClick={() => referenceOpencodeSkill(skill)}><div><strong>{skill.name}</strong><span>{skill.description || "Installed via skills.sh"}</span></div><span className={`gt-scope-badge ${skill.scope || "source"}`}>{skill.scope === "global" ? "Global" : skill.scope === "project" ? "Repo" : "Source"}</span></button>;
                  })}
                </div>
              </aside>
            </div>
          </div>
        ) : null}

        {rightPaneTab === "mcp" ? (
          <div className="gt-skill-market-shell gt-mcp-market-shell">
            <details className="gt-installed-skills-collapsible gt-installed-mcp-collapsible" open={mcpInstalledOpen} onToggle={(e) => setMcpInstalledOpen(e.currentTarget.open)}>
              <summary>
                <span>已安装 MCP Servers</span>
                <small>{opencodeMcpRows.length}</small>
                <button type="button" className="gt-icon-chip" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMcpAddForm(true); }} title="自定义添加 MCP Server">＋</button>
                <button type="button" className="gt-icon-chip" onClick={(e) => { e.preventDefault(); void refreshOpencodeMcpStatus(); }} title="刷新" disabled={opencodeMcpLoading}>↻</button>
              </summary>
              {opencodeMcpError ? <div className="gt-module-empty danger">{opencodeMcpError}</div> : null}
              <div className="gt-installed-mcp-grid">
                {opencodeMcpLoading ? <div className="gt-module-empty">正在加载 MCP...</div> : null}
                {!opencodeMcpLoading && opencodeMcpRows.length === 0 ? <div className="gt-module-empty">暂无 MCP server。从下方市场安装后会显示在这里。</div> : null}
                {opencodeMcpRows.map(([name, status]) => {
                  const s: any = status || {};
                  const source = String(s.source || (s.configured ? "project" : "runtime"));
                  const sourceLabel = source === "both" ? "项目+全局" : source === "global" ? "全局" : source === "project" ? "项目" : source;
                  return (
                    <button key={name} type="button" className="gt-mcp-installed-chip gt-mcp-installed-chip-use" onClick={() => referenceOpencodeMcp(name)} title={`添加 MCP 引用：use the ${name} mcp server`}>
                      <div className="gt-mcp-installed-main">
                        <strong>{name}</strong>
                        <small>{sourceLabel} · {String(s.type || "mcp")} · {getInstalledMcpTools(name).length} tools</small>
                      </div>
                    </button>
                  );
                })}
              </div>
            </details>
            <McpMarketplace
              servers={MCP_MARKET_SERVERS}
              configuredMcps={opencodeMcpRows.map(([name]) => name)}
              onAddMcp={addOpencodeMcpServerFromMarket}
            />
          </div>
        ) : null}

        {showMcpAddForm && typeof document !== "undefined" ? createPortal((() => {
          const customMcpJsonPlaceholder = `{
  "type": "remote",
  "url": "https://mcp.example.com/mcp",
  "enabled": true
}`;
          const customParamSpecs = getCustomMcpParamSpecs(opencodeMcpJson, opencodeMcpName);
          const previewText = (() => {
            if (!opencodeMcpJson.trim()) return "粘贴 JSON 后会在这里预览 MCP 类型和连接信息";
            try {
              const { name, config } = normalizeCustomMcpJson(opencodeMcpJson, opencodeMcpName);
              if (config.type === "local") return `${name} · local · command: ${Array.isArray(config.command) ? config.command.join(" ") : "缺少 command[]"}`;
              if (config.type === "remote") return `${name} · remote · url: ${String(config.url || "缺少 url")}`;
              return `${name} · ${String(config.type)}`;
            } catch (e) {
              return `JSON 无效：${String(e instanceof Error ? e.message : e)}`;
            }
          })();
          return (
            <div className="gt-mcp-custom-add-popover" role="dialog" aria-modal="true" onClick={() => setShowMcpAddForm(false)}>
              <section className="gt-mcp-custom-add-card" onClick={(e) => e.stopPropagation()}>
                <header className="gt-mcp-custom-add-head">
                  <div>
                    <span className="gt-module-kicker">custom mcp</span>
                    <strong>自定义添加 MCP Server</strong>
                    <small>支持 OpenCode MCP 配置、mcpServers 包装、直接 server map 或 marketplace JSON。</small>
                  </div>
                  <button type="button" className="gt-icon-chip" onClick={() => setShowMcpAddForm(false)} aria-label="关闭自定义添加">×</button>
                </header>
                <div className="gt-mcp-custom-add-body">
                  <div className="gt-mcp-custom-add-editor">
                    <div className="gt-mcp-custom-add-strip">
                      <span>JSON 会自动识别 name、command/url、env/headers 和必填参数</span>
                    </div>
                    <label>
                      <span>名称</span>
                      <input className="path-input" placeholder="名称，例如 context7" value={opencodeMcpName} onChange={(e) => setOpencodeMcpName(e.target.value)} />
                    </label>
                    <label className="gt-mcp-custom-json-label">
                      <span>JSON 配置</span>
                      <textarea className="path-input gt-module-textarea gt-mcp-json-input" value={opencodeMcpJson} placeholder={customMcpJsonPlaceholder} onChange={(e) => setOpencodeMcpJson(e.target.value)} />
                    </label>
                  </div>
                  <aside className="gt-mcp-custom-add-side">
                    <div className="gt-mcp-json-preview">
                      <strong>预览</strong>
                      <code>{previewText}</code>
                    </div>
                    {customParamSpecs.length > 0 ? (
                      <div className="gt-mcp-custom-param-fields">
                        <strong>连接参数</strong>
                        {customParamSpecs.map((spec) => (
                          <label key={spec.key}>
                            <span>{spec.key}{spec.required ? " *" : ""}</span>
                            {spec.description ? <small>{spec.description}</small> : null}
                            <input
                              className="path-input"
                              value={opencodeMcpCustomParamValues[spec.key] || ""}
                              placeholder={spec.example || spec.key}
                              onChange={(e) => setOpencodeMcpCustomParamValues((prev) => ({ ...prev, [spec.key]: e.target.value }))}
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="gt-mcp-custom-add-hint">没有检测到必填参数。添加后会写入当前项目的 OpenCode 配置。</div>
                    )}
                  </aside>
                </div>
                <footer className="gt-mcp-custom-add-actions">
                  <button type="button" className="chip" onClick={() => setShowMcpAddForm(false)}>取消</button>
                  <button type="button" className="chip primary" onClick={() => void addOpencodeMcpServer()} disabled={!!opencodeMcpBusyName || !opencodeMcpJson.trim()}>{opencodeMcpBusyName ? "添加中..." : "添加 MCP"}</button>
                </footer>
              </section>
            </div>
          );
        })(), document.body) : null}

        {editingMcpName && typeof document !== "undefined" ? createPortal((() => {
          const status = opencodeMcpStatus[editingMcpName];
          const s: any = status || {};
          const specs = getInstalledMcpParamSpecs(editingMcpName, status);
          const tools = getInstalledMcpTools(editingMcpName);
          const paramKind = s.type === "remote" ? "Headers" : "Environment";
          return (
            <div className="gt-mcp-config-popover" role="dialog" aria-modal="true" onClick={() => { setEditingMcpName(""); setEditingMcpParamValues({}); }}>
              <div className="gt-mcp-config-card" onClick={(e) => e.stopPropagation()}>
                <div className="gt-mcp-config-head"><div><span className="gt-module-kicker">update mcp params</span><strong>{editingMcpName}</strong></div></div>
                <p>更新该 MCP 的 {paramKind} 参数。保存后会写回当前项目的 OpenCode 配置。</p>
                {specs.length === 0 ? <div className="gt-module-empty">这个 MCP 当前没有可编辑参数。</div> : (
                  <div className="gt-mcp-config-fields">
                    {specs.map((spec) => <label key={spec.key}><span>{spec.key}{spec.required ? " *" : ""}</span>{spec.description ? <small>{spec.description}</small> : null}<input className="path-input" value={editingMcpParamValues[spec.key] || ""} placeholder={spec.example || spec.key} onChange={(e) => setEditingMcpParamValues((prev) => ({ ...prev, [spec.key]: e.target.value }))} /></label>)}
                  </div>
                )}
                <div className="gt-mcp-config-tools"><div className="gt-mcp-config-tools-head"><strong>工具列表</strong><span>{tools.length} tools</span></div>{tools.length === 0 ? <div className="gt-module-empty">暂无工具清单。</div> : <div className="gt-mcp-config-tool-grid">{tools.map((tool: any) => <div key={tool.name} className="gt-mcp-config-tool-cell"><code>{tool.name}</code><p>{tool.description || "No description"}</p></div>)}</div>}</div>
                <div className="gt-mcp-config-actions"><button type="button" className="chip danger" onClick={() => void removeOpencodeMcpServer(editingMcpName)} disabled={!!opencodeMcpBusyName}>{opencodeMcpBusyName.endsWith(":remove") ? "删除中..." : "删除"}</button><button type="button" className="chip primary" onClick={() => void saveMcpParams(editingMcpName, status)} disabled={!!opencodeMcpBusyName || specs.length === 0}>{opencodeMcpBusyName.endsWith(":update") ? "保存中..." : "保存参数"}</button></div>
              </div>
            </div>
          );
        })(), document.body) : null}

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
              <div className="gt-terminal-body" ref={terminalBodyRef} onClick={() => {
                if (terminalHasTextSelection()) return;
                terminalInputRef.current?.focus();
              }}>
                <div
                  ref={terminalLogRef}
                  className="gt-terminal-console"
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest(".gt-terminal-output")) terminalTextSelectingRef.current = true;
                  }}
                  onMouseUp={() => {
                    window.setTimeout(() => {
                      if (terminalHasTextSelection()) return;
                      terminalTextSelectingRef.current = false;
                      flushBufferedTerminalOutput(activeTerminalTabId);
                    }, 0);
                  }}
                  onCopy={() => {
                    window.setTimeout(() => {
                      terminalTextSelectingRef.current = false;
                      flushBufferedTerminalOutput(activeTerminalTabId);
                    }, 0);
                  }}
                >
                <pre className="gt-terminal-output">{activeTerminalView.body || ""}</pre>
                <div className="gt-terminal-inline-input">
                  <span className="gt-terminal-prompt">{activeTerminalView.prompt || ""}</span>
                  <div className="gt-terminal-input-shell" ref={terminalInputShellRef}>
                    <textarea
                      ref={terminalInputRef}
                      className="gt-terminal-input"
                      rows={1}
                      value={activeTerminalTab?.input || ""}
                      onChange={(e) => {
                        if (!activeTerminalTab) return;
                        updateTerminalTabById(activeTerminalTab.id, (prev) => ({
                          ...prev,
                          input: e.target.value,
                          historyIndex: -1,
                          historyDraft: e.target.value,
                          completionItems: [],
                          completionIndex: 0,
                          completionToken: ""
                        }));
                      }}
                      onKeyDown={(e) => {
                        if (!activeTerminalTab) return;
                        if (e.key === "Escape") {
                          updateTerminalTabById(activeTerminalTab.id, { completionItems: [], completionIndex: 0, completionToken: "" });
                          return;
                        }
                        if (activeTerminalTab.completionItems.length > 0 && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                          e.preventDefault();
                          updateTerminalTabById(activeTerminalTab.id, (prev) => ({
                            ...prev,
                            completionIndex: e.key === "ArrowUp"
                              ? (prev.completionIndex - 1 + prev.completionItems.length) % prev.completionItems.length
                              : (prev.completionIndex + 1) % prev.completionItems.length
                          }));
                          return;
                        }
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void runTerminalCommand();
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          browseTerminalHistory(activeTerminalTab.id, "older");
                          return;
                        }
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          browseTerminalHistory(activeTerminalTab.id, "newer");
                          return;
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          void applyTerminalTabCompletion(activeTerminalTab);
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
                    {activeTerminalGhostText ? (
                      <span
                        className="gt-terminal-ghost"
                        style={{ left: `${Math.max(0, (activeTerminalTab?.input || "").length) * 7.05}px` }}
                      >
                        {activeTerminalGhostText}
                      </span>
                    ) : null}
                    {activeTerminalTab?.completionItems?.length ? (() => {
                      const items = activeTerminalTab.completionItems;
                      const idx = activeTerminalTab.completionIndex;
                      const popoverContent = (
                        <div className={`gt-terminal-completion-popover${terminalInputNearTop ? " is-below" : ""}`}>
                          {items.map((item, i) => {
                            const group = getTerminalCompletionGroup(activeTerminalTab.input, item);
                            const prev = i > 0 ? getTerminalCompletionGroup(activeTerminalTab.input, items[i - 1]) : "";
                            return (
                              <Fragment key={`terminal-completion-wrap-${item}-${i}`}>
                                {group !== prev ? <div className="gt-terminal-completion-group">{group}</div> : null}
                                <button
                                  type="button"
                                  className={i === idx ? "gt-terminal-completion-item active" : "gt-terminal-completion-item"}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => selectTerminalCompletion(activeTerminalTab, i)}
                                >
                                  <span>{item}</span>
                                  {i === idx ? <kbd>TAB</kbd> : null}
                                </button>
                              </Fragment>
                            );
                          })}
                        </div>
                      );
                      if (terminalInputNearTop) {
                        const inputRect = terminalInputShellRef.current?.getBoundingClientRect();
                        const style: CSSProperties = inputRect ? {
                          position: "fixed",
                          left: inputRect.left,
                          top: inputRect.bottom + 6,
                          minWidth: Math.min(420, inputRect.width),
                          maxWidth: Math.min(560, inputRect.width),
                          zIndex: 9999
                        } : {};
                        return createPortal(
                          <div style={style}>{popoverContent}</div>,
                          document.body
                        );
                      }
                      return popoverContent;
                    })() : null}
                  </div>
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
              {rightModuleVisibility.changes ? (
                <button className={rightPaneTab === "changes" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => setRightPaneTab("changes")} title="Changes" aria-label="Changes">
                  <RightPaneTabIcon tab="changes" active={rightPaneTab === "changes"} />
                </button>
              ) : null}
              {rightModuleVisibility.worktree ? (
                <button className={rightPaneTab === "worktree" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => setRightPaneTab("worktree")} title="GitTree" aria-label="GitTree">
                  <RightPaneTabIcon tab="worktree" active={rightPaneTab === "worktree"} />
                </button>
              ) : null}
              {rightModuleVisibility.terminal ? (
                <button className={rightPaneTab === "terminal" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => setRightPaneTab("terminal")} title="Terminal" aria-label="Terminal">
                  <RightPaneTabIcon tab="terminal" active={rightPaneTab === "terminal"} />
                </button>
              ) : null}
              {rightModuleVisibility.skills ? (
                <button className={rightPaneTab === "skills" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => {
                  setRightPaneTab("skills");
                }} onMouseEnter={() => void warmSkillsMarketplace()} onFocus={() => void warmSkillsMarketplace()} title="Skills" aria-label="Skills">
                  <RightPaneTabIcon tab="skills" active={rightPaneTab === "skills"} />
                </button>
              ) : null}
              {rightModuleVisibility.mcp ? (
                <button className={rightPaneTab === "mcp" ? "gt-right-tab active" : "gt-right-tab"} onClick={() => {
                  setRightPaneTab("mcp");
                }} title="MCP" aria-label="MCP">
                  <RightPaneTabIcon tab="mcp" active={rightPaneTab === "mcp"} />
                </button>
              ) : null}
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
  const opencodeProviderPickerModelCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const provider of opencodeProviderPickerCandidates) {
      out[provider] = (opencodeModelsByProvider[provider] || []).length;
    }
    return out;
  }, [opencodeProviderPickerCandidates, opencodeModelsByProvider]);

  async function saveOpencodeCustomProvider() {
    try {
      setOpencodeProviderConfigBusy(true);
      setOpencodeConfigBusy(true);
      const pid = opencodeProviderConfig.provider.trim();
      const mid = opencodeSelectedModel.trim();
      const full = `${pid}/${mid}`;
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
  }

  async function saveOpencodeAuthKey(providerId: string) {
    if (!ensureRepoSelected()) return;
    const authPid = providerId.trim();
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
  }

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
                    const mainRepo = repos.find(r => r.id === gitPaneRepo?.id);
                    const isWorktree = mainRepo && gitPaneRepo && mainRepo.path !== gitPaneRepo.path;
                    return (gitPaneRepo?.name ?? selectedRepo?.name ?? "No Project") + " · " + (worktreeOverview.branch || selectedBranch || "—") + (isWorktree ? " [worktree]" : "");
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
                    setSettingsInitialSection("mobile");
                    setShowSettings(true);
                    if (runtimeStatus.giteam.installed) {
                      setControlPairCodeInfo(null);
                      setControlAccessInfo(null);
                      setControlSettingsLoaded(false);
                      void loadControlServerSettings();
                    }
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
                {appText.close}
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCommitContextMenu({ x: e.clientX, y: e.clientY, sha: g.sha, subject: g.subject });
                      }}
                      onMouseEnter={(e) => setCommitHoverCard({ x: e.clientX, y: e.clientY, sha: g.sha, subject: g.subject, author: g.author, date: g.date })}
                      onMouseMove={(e) => setCommitHoverCard((prev) => prev?.sha === g.sha ? { ...prev, x: e.clientX, y: e.clientY } : prev)}
                      onMouseLeave={() => setCommitHoverCard(null)}
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
                {appText.removeWorktree}
              </button>
            </div>
          </div>
        ) : null}

        {showRemoveWorktreeConfirm ? (
          <div className="modal-mask" onClick={() => { if (!removingWorktreePath) { setShowRemoveWorktreeConfirm(false); setWorktreeToRemove(""); } }}>
            <div className="modal-card gt-discard-confirm-card" onClick={(e) => e.stopPropagation()}>
              <h3>{appText.removeWorktreeTitle}</h3>
              <p className="small muted">
                {appText.removeWorktreeDesc}
              </p>
              <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: 14 }}>
                <button className="chip" onClick={() => { setShowRemoveWorktreeConfirm(false); setWorktreeToRemove(""); }} disabled={!!removingWorktreePath}>{appText.cancel}</button>
                <button className="chip is-danger" onClick={() => void handleRemoveWorktree(worktreeToRemove)} disabled={!!removingWorktreePath || !worktreeToRemove}>
                  {removingWorktreePath ? appText.removing : appText.confirmRemove}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showSettings ? (
          <SettingsDialog
            theme={theme}
            initialSection={settingsInitialSection}
            runtimeStatus={runtimeStatus}
            onClose={() => void closeSettingsModal()}
            onToggleTheme={toggleTheme}
            onOpenRuntimeSetup={() => {
              setShowEnvSetup(true);
              const unchecked = [runtimeStatus.git, runtimeStatus.entire, runtimeStatus.opencode, runtimeStatus.giteam].some(
                (d) => !d.checked
              );
              if (unchecked) void refreshRuntimeRequirements();
            }}
            onOpenMobileControl={openMobileControlDialog}
            onOpenOpenCodeApi={() => setShowOpencodeApiDialog(true)}
            onOpenModelManager={() => {
              setOpencodeProviderPickerProvider(
                parseModelRef(activeOpencodeModel || "")?.provider || opencodeModelProvider || ""
              );
              setSettingsInitialSection("models");
              setShowSettings(true);
            }}
            onOpenSkillsMarketplaceSettings={() => {
              void invoke("open_external_url", { url: "https://skillsmp.com/zh/docs/api#authentication" });
            }}
            rightModules={rightModuleVisibility}
            onToggleRightModule={toggleRightModuleVisibility}
            generalSettings={generalSettings}
            onGeneralSettingsChange={(next) => {
              setGeneralSettings(next);
              saveGeneralSettings(next);
              if (next.autoAcceptPermissions !== opencodeAutoAcceptPermissions) {
                setOpencodeAutoAcceptPermissions(next.autoAcceptPermissions);
                saveLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, next.autoAcceptPermissions);
                if (next.autoAcceptPermissions && activeOpencodeSessionId) void ensureSessionAutoAcceptPermissions(activeOpencodeSessionId);
              }
            }}
            onCheckUpdates={() => void refreshRuntimeRequirements()}
            opencodePort={opencodeServiceSettings.port}
            opencodeBusy={opencodeServiceSettingsBusy}
            onOpencodePortChange={(port) => setOpencodeServiceSettings((prev) => ({ ...prev, port }))}
            onSaveOpenCodeApi={() => void saveOpencodeServiceSettingsIfNeeded()}
            skillsmpApiKey={skillsmpApiKey}
            skillsmpApiKeyDraft={skillsmpApiKeyDraft}
            onSkillsmpApiKeyDraftChange={setSkillsmpApiKeyDraft}
            onSaveSkillsmpApiKey={() => {
              const next = skillsmpApiKeyDraft.trim();
              setSkillsmpApiKey(next);
              saveLocalString(SKILLSMP_API_KEY_STORAGE_KEY, next);
              setMessage(next ? "SkillsMP API Key saved" : "SkillsMP API Key cleared");
            }}
            onClearSkillsmpApiKey={() => {
              setSkillsmpApiKey("");
              setSkillsmpApiKeyDraft("");
              saveLocalString(SKILLSMP_API_KEY_STORAGE_KEY, "");
              setMessage("SkillsMP API Key cleared");
            }}
            uiFontSize={uiFontSize}
            codeFontSize={codeFontSize}
            onUiFontSizeChange={setUiFontSize}
            onCodeFontSizeChange={setCodeFontSize}
            controlSettings={controlServerSettings}
            controlBusy={controlServerSettingsBusy}
            controlInstalled={runtimeStatus.giteam.installed}
            onControlSettingsChange={(next) => setControlServerSettings((prev) => ({ ...prev, ...next }))}
            onSaveControlSettings={() => void saveControlServerSettingsIfNeeded()}
            onToggleControlService={(enabled) => void toggleControlServiceEnabled(enabled)}
            runtimeChecking={runtimeChecking}
            checkingDeps={checkingDeps}
            installingDep={installingDep}
            installingElapsed={installingElapsed}
            runtimeJob={runtimeJob}
            onRefreshRuntime={() => void refreshRuntimeRequirements()}
            onRunDependencyAction={(name, action) => void runDependencyAction(name, action, { showRuntimePanel: false })}
            skillsContent={settingsSkillsContent}
            skillsLoading={opencodeSkillsLoading}
            onRefreshSkills={() => void refreshOpencodeSkills()}
            mcpContent={settingsMcpContent}
            mcpLoading={opencodeMcpLoading}
            onRefreshMcp={() => void refreshOpencodeMcpStatus()}
            onMcpVisible={() => {
              if (!opencodeMcpLoading && !opencodeMcpLoadedRef.current) scheduleAfterInteraction(() => void refreshOpencodeMcpStatus(), 120);
            }}
            onSkillsVisible={() => {
              if (opencodeSkillsRepoPathRef.current !== repoPath) {
                opencodeSkillsRepoPathRef.current = repoPath;
                const cached = opencodeSkillsByRepoRef.current[repoPath] || null;
                startTransition(() => {
                  if (cached) setOpencodeSkills(cached);
                  setOpencodeSkillsLoadedOnce(Boolean(cached));
                  setOpencodeSkillsLoading(!cached);
                  setOpencodeSkillsError("");
                });
                if (!cached) scheduleAfterInteraction(() => void refreshOpencodeSkills(), 220);
                return;
              }
              if (!opencodeSkillsLoading && !opencodeSkillsLoadedOnce) scheduleAfterInteraction(() => void refreshOpencodeSkills(), 220);
            }}
            mobileStatusContent={runtimeStatus.giteam.installed ? (
              <div className="settings-panel-card settings-mobile-inline-status">
                <div className="settings-panel-copy">
                  <strong>Connection</strong>
                  <p>{controlPairCodeInfo?.code ? `Pair code: ${controlPairCodeInfo.code}` : "开启服务后可刷新配对码。"}</p>
                  {controlAccessInfo?.publicBaseUrl ? <p className="settings-plugin-path">{controlAccessInfo.publicBaseUrl}</p> : null}
                </div>
                <div className="settings-panel-action">
                  <button className="chip" disabled={!controlServerSettings.enabled || controlServerSettingsBusy} onClick={() => void forceRefreshControlPairCode()}>Refresh code</button>
                </div>
              </div>
            ) : null}
            modelsContent={(
              <div className="settings-model-inline">
                <div className="settings-model-head opencode-provider-picker-toolbar">
                  <input className="path-input" placeholder="搜索提供商..." value={opencodeProviderPickerSearch} onChange={(e) => setOpencodeProviderPickerSearch(e.target.value)} />
                  <input className="path-input" placeholder="搜索模型..." value={opencodeProviderPickerModelSearch} onChange={(e) => setOpencodeProviderPickerModelSearch(e.target.value)} />
                </div>
                <div className="settings-model-lists opencode-provider-picker-grid">
                  <div className="settings-model-col">
                    <OpenCodeProviderList
                      providers={opencodeProviderPickerCandidates}
                      selectedProvider={opencodeProviderPickerProvider}
                      connectedProviders={opencodeConnectedProviders}
                      providerNames={opencodeProviderNames}
                      modelCountsByProvider={opencodeProviderPickerModelCounts}
                      getProviderTag={getOpencodeProviderTag}
                      getProviderDisplayName={(provider) => opencodeProviderNames[provider] || PROVIDER_PRESETS.find((p) => p.id === provider)?.name || provider}
                      onSelectProvider={(provider) => setOpencodeProviderPickerProvider(provider)}
                    />
                  </div>
                  <div className="settings-model-col">
                    {(() => {
                      const resolved = resolveProviderAliasWithNames(opencodeProviderPickerProvider, opencodeModelsByProvider, opencodeProviderNames);
                      const cfgResolved = resolveProviderAliasWithNames(opencodeProviderPickerProvider, opencodeConfiguredModelsByProvider, opencodeProviderNames);
                      const pid = (resolved || opencodeProviderPickerProvider.trim()) || "";
                      const cfgPid = (cfgResolved || pid) || "";
                      const pool = (pid ? (opencodeModelsByProvider[pid] ?? []) : []).slice().sort((a, b) => a.localeCompare(b));
                      const q = opencodeProviderPickerModelSearch.trim().toLowerCase();
                      const filtered = q ? pool.filter((m) => m.toLowerCase().includes(q)) : pool;
                      if (!pid) return <div className="small muted opencode-provider-empty">先从左侧选择一个提供商。</div>;
                      if (!opencodeConnectedProviders.includes(pid)) return <div className="small muted opencode-provider-empty">该 provider 未连接，请先在 OpenCode 中完成授权。</div>;
                      return <OpenCodeProviderModelList models={filtered} providerId={pid} configuredProviderId={cfgPid} activeModel={activeOpencodeModel} configuredModelsByProvider={opencodeConfiguredModelsByProvider} configuredModelNamesByProvider={opencodeConfiguredModelNamesByProvider} modelNamesByProvider={opencodeModelNamesByProvider} hiddenModels={opencodeHiddenModels} enabledModels={opencodeEnabledModels} onSelectModel={(ref) => void applyOpencodeModel(ref)} onHideModel={(ref) => { setOpencodeHiddenModels((prev) => new Set([...prev, ref])); setOpencodeEnabledModels((prev) => { const next = new Set(prev); next.delete(ref); return next; }); }} onEnableModel={(ref) => { setOpencodeHiddenModels((prev) => { const next = new Set(prev); next.delete(ref); return next; }); setOpencodeEnabledModels((prev) => new Set([...prev, ref])); }} />;
                    })()}
                  </div>
                </div>
              </div>
            )}
          />
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

        {showSkillsmpSettings ? (
          <div className="modal-mask" onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowSkillsmpSettings(false);
          }}>
            <div className="modal-card skillsmp-key-modal" role="dialog" aria-modal="true" aria-label="配置 SkillsMP API Key" onMouseDown={(e) => e.stopPropagation()}>
              <div className="skillsmp-key-modal-head">
                <div>
                  <span className="gt-module-kicker">SkillsMP</span>
                  <h3>配置 API Key</h3>
                  <p>关键词搜索可匿名使用；AI 语义搜索和更高额度需要 API Key。</p>
                </div>
                <button className="gt-diff-icon-btn" type="button" aria-label="关闭" onClick={() => setShowSkillsmpSettings(false)}>×</button>
              </div>
              <label className="skillsmp-key-field">
                <span>API Key</span>
                <input className="path-input" type="password" placeholder="sk_live_skillsmp_..." value={skillsmpApiKeyDraft} onChange={(e) => setSkillsmpApiKeyDraft(e.target.value)} autoFocus />
              </label>
              <div className="skillsmp-key-actions">
                <button className="chip primary" onClick={() => {
                  const next = skillsmpApiKeyDraft.trim();
                  setSkillsmpApiKey(next);
                  saveLocalString(SKILLSMP_API_KEY_STORAGE_KEY, next);
                  setShowSkillsmpSettings(false);
                }}>保存</button>
                <button className="chip" onClick={() => {
                  setSkillsmpApiKey("");
                  setSkillsmpApiKeyDraft("");
                  saveLocalString(SKILLSMP_API_KEY_STORAGE_KEY, "");
                }}>清除</button>
                <button className="chip" onClick={() => void invoke("open_external_url", { url: "https://skillsmp.com/zh/docs/api#authentication" })}>浏览器获取 API Key</button>
              </div>
            </div>
          </div>
        ) : null}

        {showOpencodeApiDialog ? (
          <OpenCodeApiDialog
            port={opencodeServiceSettings.port}
            onClose={() => void closeOpencodeApiDialog()}
            onPortChange={(port) => setOpencodeServiceSettings((prev) => ({ ...prev, port }))}
          />
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
                  <OpenCodeProviderList
                    providers={opencodeProviderPickerCandidates}
                    selectedProvider={opencodeProviderPickerProvider}
                    connectedProviders={opencodeConnectedProviders}
                    providerNames={opencodeProviderNames}
                    modelCountsByProvider={opencodeProviderPickerModelCounts}
                    getProviderTag={getOpencodeProviderTag}
                    getProviderDisplayName={(provider) => opencodeProviderNames[provider] || PROVIDER_PRESETS.find((p) => p.id === provider)?.name || provider}
                    onSelectProvider={(provider, connected) => {
                      setOpencodeProviderPickerProvider(provider);
                      if (!connected) {
                        setOpencodeConnectProviderId(provider);
                        setOpencodeConnectProviderName(opencodeProviderNames[provider] || PROVIDER_PRESETS.find((p) => p.id === provider)?.name || provider);
                        setOpencodeConnectApiKey("");
                        return;
                      }
                      setShowOpencodeAuthDialogFor("");
                    }}
                  />
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
                  // Prefer live /provider models. Config-only rows are shown only before the provider catalog is available.
                  const pool = (providerPool.length > 0 ? providerPool : configuredPool).slice().sort((a, b) => a.localeCompare(b));
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
                    return (
                      <div className="opencode-provider-right-panel">
                        {providerHeader}
                        {authBlock}
                        <OpenCodeProviderModelList
                          models={filtered}
                          providerId={pid}
                          configuredProviderId={cfgPid}
                          activeModel={activeOpencodeModel}
                          configuredModelsByProvider={opencodeConfiguredModelsByProvider}
                          configuredModelNamesByProvider={opencodeConfiguredModelNamesByProvider}
                          modelNamesByProvider={opencodeModelNamesByProvider}
                          hiddenModels={opencodeHiddenModels}
                          enabledModels={opencodeEnabledModels}
                          onSelectModel={(ref) => void applyOpencodeModel(ref)}
                          onHideModel={(ref) => {
                            setOpencodeHiddenModels((prev) => {
                              const next = new Set(prev);
                              next.add(ref);
                              return next;
                            });
                            setOpencodeEnabledModels((prev) => {
                              const next = new Set(prev);
                              next.delete(ref);
                              return next;
                            });
                          }}
                          onEnableModel={(ref) => {
                            setOpencodeHiddenModels((prev) => {
                              const next = new Set(prev);
                              next.delete(ref);
                              return next;
                            });
                            setOpencodeEnabledModels((prev) => {
                              const next = new Set(prev);
                              next.add(ref);
                              return next;
                            });
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showOpencodeAuthDialogFor ? (() => {
          const pid = showOpencodeAuthDialogFor.trim();
          const pretty = opencodeProviderNames[pid] || PROVIDER_PRESETS.find((p) => p.id === pid)?.name || pid;
          const keyValue = opencodeConnectProviderId === pid ? opencodeConnectApiKey : "";
          return (
            <OpenCodeAuthDialog
              providerId={opencodeConnectProviderId === pid ? pid : ""}
              providerName={pretty}
              providerTag={getOpencodeProviderTag(pid)}
              apiKey={keyValue}
              busy={opencodeConnectBusy}
              onClose={() => setShowOpencodeAuthDialogFor("")}
              onApiKeyChange={(value) => {
                setOpencodeConnectProviderId(pid);
                setOpencodeConnectProviderName(pretty);
                setOpencodeConnectApiKey(value);
              }}
              onSave={() => void saveOpencodeAuthKey(pid)}
            />
          );
        })() : null}

        {showOpencodeCustomProvider ? (
          <OpenCodeCustomProviderDialog
            config={opencodeProviderConfig}
            modelId={opencodeSelectedModel}
            busy={opencodeProviderConfigBusy || opencodeConfigBusy}
            onClose={() => setShowOpencodeCustomProvider(false)}
            onConfigChange={(patch) => setOpencodeProviderConfig((prev) => ({ ...prev, ...patch }))}
            onModelChange={setOpencodeSelectedModel}
            onSave={() => void saveOpencodeCustomProvider()}
          />
        ) : null}

        {/* inline connect UI lives inside provider picker right column */}

        {showEnvSetup ? (
          <RuntimeSetupDialog
            runtimeStatus={runtimeStatus}
            runtimeChecking={runtimeChecking}
            checkingDeps={checkingDeps}
            installingDep={installingDep}
            installingElapsed={installingElapsed}
            runtimeJob={runtimeJob}
            runtimeInstallLog={runtimeInstallLog}
            runtimeLogTail={runtimeLogTail}
            expandedLogDep={expandedLogDep}
            onClose={() => setShowEnvSetup(false)}
            onDismiss={() => {
              window.localStorage.setItem("giteam.runtime.setup.dismissed.v1", "1");
              setShowEnvSetup(false);
            }}
            onRefresh={() => void refreshRuntimeRequirements()}
            onRunDependencyAction={(name, action) => void runDependencyAction(name, action)}
            onToggleLog={(name) => setExpandedLogDep((prev) => (prev === name ? null : name))}
          />
        ) : null}

        {showReleaseNotes ? (
          <div className="modal-mask" onClick={() => setShowReleaseNotes(false)}>
            <div className="modal-card onboarding-card" onClick={(e) => e.stopPropagation()}>
              <h3>Giteam {APP_RELEASE_VERSION}</h3>
              <p className="small muted">Release Notes</p>
              <div className="settings-panel-list">
                <article className="settings-panel-card"><div className="settings-panel-copy"><strong>设置中心完善</strong><p>插件页已改为依赖管理，并补齐通用偏好配置。</p></div></article>
                <article className="settings-panel-card"><div className="settings-panel-copy"><strong>通知与声音</strong><p>Agent 完成、权限请求、错误事件支持原生通知，并保留 Web 通知降级。</p></div></article>
              </div>
              <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                <button className="chip primary" onClick={() => setShowReleaseNotes(false)}>Got it</button>
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

        {opencodePreviewImage ? (() => {
          const image = opencodePreviewImage.images[opencodePreviewImage.index] || opencodePreviewImage.images[0];
          if (!image) return null;
          return (
            <div className="modal-mask opencode-image-preview-mask" onClick={() => setOpencodePreviewImage(null)}>
              <div className="opencode-image-preview-card" onClick={(e) => e.stopPropagation()}>
                <img
                  className="opencode-image-preview-img"
                  src={image.uri}
                  alt={image.filename || "preview"}
                  onClick={(e) => {
                    if (opencodePreviewImage.images.length <= 1) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const next = e.clientX >= rect.left + rect.width / 2 ? 1 : -1;
                    setOpencodePreviewImage((prev) => prev ? { ...prev, index: (prev.index + next + prev.images.length) % prev.images.length } : prev);
                  }}
                />
              </div>
            </div>
          );
        })() : null}

        {showOpencodeModulePanel ? createPortal(
          <div className="gt-module-layer" onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowOpencodeModulePanel(false);
          }}>
            <div className="gt-module-panel" onMouseDown={(e) => e.stopPropagation()}>
              <div className="gt-module-head">
                <div>
                  <div className="gt-module-kicker">OpenCode Modules</div>
                  <h2>Agent / 权限 / MCP / Skills</h2>
                </div>
                <button type="button" className="modal-close" onClick={() => setShowOpencodeModulePanel(false)}>×</button>
              </div>
              <div className="gt-module-tabs">
                {([
                  ["agents", "Agents"],
                  ["permissions", `权限${opencodeActivePermissions.length ? ` (${opencodeActivePermissions.length})` : ""}`],
                  ["mcp", "MCP"],
                  ["skills", "Skills"]
                ] as Array<[OpencodeModuleTab, string]>).map(([tab, label]) => (
                  <button key={tab} type="button" className={opencodeModuleTab === tab ? "active" : ""} onClick={() => setOpencodeModuleTab(tab)}>{label}</button>
                ))}
              </div>
              <div className="gt-module-body">
                {opencodeModuleTab === "agents" ? (
                  <div className="gt-module-section">
                    <div className="gt-module-toolbar">
                      <input className="path-input" placeholder="搜索 agent" value={opencodeAgentSearch} onChange={(e) => setOpencodeAgentSearch(e.target.value)} />
                      <button className="chip" onClick={() => void refreshOpencodeAgents()} disabled={opencodeAgentsLoading}>刷新</button>
                    </div>
                    {opencodeAgentsError ? <div className="small" style={{ color: "var(--danger)" }}>{opencodeAgentsError}</div> : null}
                    <div className="gt-module-list">
                      {visibleOpencodeAgents.map((agent) => (
                        <button key={agent.name} type="button" className={agent.name === activeOpencodeAgent ? "gt-module-row selected" : "gt-module-row"} onClick={() => applyOpencodeAgent(agent.name)}>
                          <span className="gt-module-row-title">@{agent.name}</span>
                          <span className="gt-module-row-desc">{agent.description || agent.mode || "agent"}</span>
                          <span className="gt-module-row-meta">{agent.mode || "all"}{agent.native ? " · native" : ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {opencodeModuleTab === "permissions" ? (
                  <div className="gt-module-section">
                    <label className="gt-switch-row">
                      <span>
                        <strong>自动接受权限</strong>
                        <small>为当前会话写入 allow-all 规则，并自动回复后续 permission.asked。</small>
                      </span>
                      <button
                        type="button"
                        className={opencodeAutoAcceptPermissions ? "gt-switch active" : "gt-switch"}
                        onClick={() => {
                          const next = !opencodeAutoAcceptPermissions;
                          setOpencodeAutoAcceptPermissions(next);
                          saveLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, next);
                          if (next && activeOpencodeSessionId) void ensureSessionAutoAcceptPermissions(activeOpencodeSessionId);
                        }}
                      >
                        {opencodeAutoAcceptPermissions ? "ON" : "OFF"}
                      </button>
                    </label>
                    <div className="gt-module-toolbar">
                      <button className="chip" onClick={() => void refreshPendingPermissions()} disabled={opencodePermissionLoading}>刷新权限请求</button>
                    </div>
                    {opencodeActivePermissions.length === 0 ? (
                      <div className="gt-module-empty">当前没有待处理授权。</div>
                    ) : (
                      <div className="gt-module-list">
                        {opencodeActivePermissions.map((req) => (
                          <div key={req.id} className="gt-module-row gt-module-row-static">
                            <span className="gt-module-row-title">{req.permission || "permission"}</span>
                            <span className="gt-module-row-desc">{(req.patterns || []).join(", ") || "*"}</span>
                            <span className="gt-module-row-meta">{req.id}</span>
                            <span className="gt-module-row-actions">
                              <button className="chip" onClick={() => void sendPermissionReply(req.id, "once")}>本次</button>
                              <button className="chip primary" onClick={() => void sendPermissionReply(req.id, "always")}>总是</button>
                              <button className="chip danger" onClick={() => void sendPermissionReply(req.id, "reject")}>拒绝</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                {opencodeModuleTab === "mcp" ? (
                  <div className="gt-module-section">
                    <div className="gt-module-toolbar">
                      <button className="chip" onClick={() => void refreshOpencodeMcpStatus()} disabled={opencodeMcpLoading}>刷新 MCP</button>
                      {opencodeMcpError ? <span className="small" style={{ color: "var(--danger)" }}>{opencodeMcpError}</span> : null}
                    </div>
                    <div className="gt-module-form">
                      <input className="path-input" placeholder="mcp 名称，例如 context7" value={opencodeMcpName} onChange={(e) => setOpencodeMcpName(e.target.value)} />
                      <select className="path-input" value={opencodeMcpType} onChange={(e) => setOpencodeMcpType(e.target.value as OpencodeMcpType)}>
                        <option value="remote">remote</option>
                        <option value="local">local</option>
                      </select>
                      {opencodeMcpType === "remote" ? (
                        <>
                          <input className="path-input" placeholder="https://mcp.example.com/mcp" value={opencodeMcpUrl} onChange={(e) => setOpencodeMcpUrl(e.target.value)} />
                          <textarea className="path-input gt-module-textarea" placeholder="Headers，每行 KEY=VALUE（可选）" value={opencodeMcpHeaders} onChange={(e) => setOpencodeMcpHeaders(e.target.value)} />
                        </>
                      ) : (
                        <>
                          <input className="path-input" placeholder={'npx -y @modelcontextprotocol/server-everything'} value={opencodeMcpCommand} onChange={(e) => setOpencodeMcpCommand(e.target.value)} />
                          <textarea className="path-input gt-module-textarea" placeholder="Environment，每行 KEY=VALUE（可选）" value={opencodeMcpEnv} onChange={(e) => setOpencodeMcpEnv(e.target.value)} />
                        </>
                      )}
                      <button className="chip primary" onClick={() => void addOpencodeMcpServer()} disabled={!!opencodeMcpBusyName}>添加 MCP</button>
                    </div>
                    {opencodeMcpRows.length === 0 ? <div className="gt-module-empty">暂无 MCP server。可添加 Context7、Sentry、Grep 等。</div> : null}
                    <div className="gt-module-list">
                      {opencodeMcpRows.map(([name, status]) => {
                        const statusLabel = String(status?.status || status?.state || (status?.enabled === false ? "disabled" : "configured"));
                        const tools = Array.isArray((status as any)?.tools) ? (status as any).tools.length : undefined;
                        return (
                          <div key={name} className="gt-module-row gt-module-row-static">
                            <span className="gt-module-row-title">{name}</span>
                            <span className="gt-module-row-desc">{statusLabel}{typeof tools === "number" ? ` · ${tools} tools` : ""}</span>
                            <span className="gt-module-row-meta">{String((status as any)?.type || "mcp")}</span>
                            <span className="gt-module-row-actions">
                              <button className="chip" onClick={() => void runMcpAction(name, "connect")} disabled={!!opencodeMcpBusyName}>连接</button>
                              <button className="chip" onClick={() => void runMcpAction(name, "disconnect")} disabled={!!opencodeMcpBusyName}>断开</button>
                              <button className="chip" onClick={() => void runMcpAction(name, "auth")} disabled={!!opencodeMcpBusyName}>OAuth</button>
                              <button className="chip danger" onClick={() => void runMcpAction(name, "logout")} disabled={!!opencodeMcpBusyName}>登出</button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {opencodeModuleTab === "skills" ? (
                  <div className="gt-module-section">
                    <div className="gt-module-toolbar">
                      <button className="chip" onClick={() => void refreshOpencodeSkills()} disabled={opencodeSkillsLoading}>刷新 Skills</button>
                      {opencodeSkillsError ? <span className="small" style={{ color: "var(--danger)" }}>{opencodeSkillsError}</span> : null}
                    </div>
                    <div className="gt-skills-hero">
                      <div className="gt-skills-hero-copy">
                        <span className="gt-module-kicker">Skill command center</span>
                        <h3>搜索、安装、区分范围，一屏完成</h3>
                        <p>默认推荐全局安装通用能力；项目特定规范、私有工作流或团队模板建议安装到当前仓库。</p>
                      </div>
                      <div className="gt-skills-hero-stats">
                        <span><strong>{opencodeSkills.filter((skill) => skill.scope === "global").length}</strong> Global</span>
                        <span><strong>{opencodeSkills.filter((skill) => skill.scope === "project").length}</strong> Repo</span>
                        <span><strong>{opencodeSkillSearchResults.length}</strong> Results</span>
                      </div>
                    </div>
                    <div className="gt-skill-scope-picker">
                      <span>安装范围</span>
                      <button type="button" className={opencodeSkillInstallScope === "project" ? "active" : ""} onClick={() => setOpencodeSkillInstallScope("project")}>当前仓库</button>
                      <button type="button" className={opencodeSkillInstallScope === "global" ? "active" : ""} onClick={() => setOpencodeSkillInstallScope("global")}>全局通用</button>
                    </div>
                    {opencodeSkillBusy ? (
                      <div className="gt-skill-progress">
                        <span className="gt-skill-progress-orb" />
                        <div>
                          <strong>正在安装 Skill</strong>
                          <small>会从 skills.sh / GitHub 拉取内容，完成后自动刷新 OpenCode Skills 列表。</small>
                        </div>
                      </div>
                    ) : null}
                    {(opencodeSkillBusy || opencodeSkillInstallingSpec || opencodeSkillInstallLog) ? (
                      <div className="gt-skill-install-log">
                        <div><strong>安装日志</strong><span>{opencodeSkillInstallingSpec || "最近一次安装"}</span></div>
                        <pre>{opencodeSkillInstallLog || `正在启动安装 ${opencodeSkillInstallingSpec || "skill"}...`}</pre>
                      </div>
                    ) : null}
                    <div className="gt-skill-recommend-grid">
                      {OPENCODE_RECOMMENDED_SKILLS.map((skill) => (
                        <div key={skill.spec} className="gt-skill-recommend-card">
                          <div className="gt-skill-recommend-top">
                            <span>{skill.tone}</span>
                            <small>{skill.installs}</small>
                          </div>
                          <strong>{skill.title}</strong>
                          <p>{skill.description}</p>
                          <div className="gt-skill-recommend-actions">
                            <button className="chip" onClick={() => setOpencodeSkillInstallSpec(skill.spec)}>填入</button>
                            <button className="chip primary" onClick={() => void installOpencodeSkillFromRegistry(skill.spec)} disabled={opencodeSkillBusy}>安装</button>
                          </div>
                          <code>{skill.spec}</code>
                        </div>
                      ))}
                    </div>
                    <div className="gt-module-form compact gt-skill-enter-search">
                      <input
                        className="path-input"
                        placeholder="搜索 skills，例如 frontend / react / testing"
                        value={opencodeSkillSearchQuery}
                        onChange={(e) => setOpencodeSkillSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void searchOpencodeSkillRegistry();
                        }}
                      />
                    </div>
                    {opencodeSkillSearchLoading ? (
                      <div className="gt-skill-skeleton-grid" aria-label="正在搜索 skills">
                        <span /><span /><span />
                      </div>
                    ) : null}
                    {opencodeSkillSearchResults.length > 0 ? (
                      <div className="gt-module-list gt-skill-search-list">
                        {opencodeSkillSearchResults.map((result) => (
                          <div key={result.spec} className="gt-module-row gt-module-row-static">
                            <span className="gt-module-row-title">{result.skill}</span>
                            <span className="gt-module-row-desc">{result.package}</span>
                            <span className="gt-module-row-meta">{result.installs ? `${result.installs} installs` : result.url}</span>
                            <span className="gt-module-row-actions">
                              <button className="chip" onClick={() => setOpencodeSkillInstallSpec(result.installSpec || result.spec)}>填入</button>
                              <button className="chip primary" onClick={() => void installOpencodeSkillFromRegistry(result.installSpec || result.spec, opencodeSkillInstallScope, [result.installUrl || "", result.url || "", result.spec])} disabled={opencodeSkillBusy}>安装</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="gt-module-form">
                      <input className="path-input" placeholder="skills.sh 条目，如 anthropics/skills@frontend-design" value={opencodeSkillInstallSpec} onChange={(e) => setOpencodeSkillInstallSpec(e.target.value)} />
                      <button className="chip primary" onClick={() => void installOpencodeSkillFromRegistry()} disabled={opencodeSkillBusy}>从 skills.sh 安装</button>
                    </div>
                    <div className="gt-module-form compact">
                      <select className="path-input" value={opencodeSkillSourceKind} onChange={(e) => setOpencodeSkillSourceKind(e.target.value as "url" | "path")}>
                        <option value="url">skills.urls</option>
                        <option value="path">skills.paths</option>
                      </select>
                      <input className="path-input" placeholder={opencodeSkillSourceKind === "url" ? "https://example.com/.well-known/skills/" : "/path/to/skills"} value={opencodeSkillSourceInput} onChange={(e) => setOpencodeSkillSourceInput(e.target.value)} />
                      <button className="chip" onClick={() => void addOpencodeSkillSource()} disabled={opencodeSkillBusy}>添加来源</button>
                    </div>
                    <div className="gt-installed-skill-tools">
                      <div className="gt-skill-filter-tabs">
                        {([
                          ["all", `全部 ${opencodeSkills.length}`],
                          ["global", `Global ${opencodeSkills.filter((skill) => skill.scope === "global").length}`],
                          ["project", `Repo ${opencodeSkills.filter((skill) => skill.scope === "project").length}`],
                          ["source", `Source ${opencodeSkills.filter((skill) => (skill.scope || "source") === "source").length}`]
                        ] as Array<["all" | "global" | "project" | "source", string]>).map(([filter, label]) => (
                          <button key={filter} type="button" className={opencodeSkillListFilter === filter ? "active" : ""} onClick={() => setOpencodeSkillListFilter(filter)}>{label}</button>
                        ))}
                      </div>
                      <input className="path-input" placeholder="过滤已安装 skills" value={opencodeSkillListQuery} onChange={(e) => setOpencodeSkillListQuery(e.target.value)} />
                    </div>
                    {opencodeSkills.length === 0 ? <div className="gt-module-empty">暂无 Skills。OpenCode 会扫描 .opencode/skills、.claude/skills 和全局 skills。</div> : null}
                    {opencodeSkills.length > 0 && filteredOpencodeSkills.length === 0 ? <div className="gt-module-empty">没有匹配当前过滤条件的 Skill。</div> : null}
                    <div className="gt-module-list">
                      {filteredOpencodeSkills.map((skill) => (
                        <div key={`${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`} className="gt-module-row gt-module-row-static">
                          <span className="gt-module-row-title">{skill.name}<span className={`gt-scope-badge ${skill.scope || "source"}`}>{skill.scope === "global" ? "Global" : skill.scope === "project" ? "Repo" : "Source"}</span></span>
                          <span className="gt-module-row-desc">{skill.description || "No description"}</span>
                          <span className="gt-module-row-meta">{skill.path || skill.location || skill.license || "skill"}</span>
                          <span className="gt-module-row-actions">
                            <button className="chip danger" disabled={(skill.scope || "source") === "source" || opencodeSkillRemovingKey === `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`} onClick={() => void removeOpencodeSkill(skill)}>{opencodeSkillRemovingKey === `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}` ? "Removing" : "Uninstall"}</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>,
          document.body
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

        {sessionContextMenu ? (
          <div className="repo-context-layer" onClick={() => setSessionContextMenu(null)}>
            <div
              className="repo-context-menu"
              style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="repo-context-item"
                onClick={() => {
                  const menu = sessionContextMenu;
                  setSessionContextMenu(null);
                  void archiveOpencodeSession(menu.repo, menu.session.id);
                }}
                disabled={busy || !runtimeStatus.opencode.installed}
              >
                {appText.archiveSession}
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
                {appText.createWorktreeFromCommit}
              </button>
              <button
                className="repo-context-item"
                onClick={() => {
                  setCommitContextMenu(null);
                  openTopologyCreateDialog("branch", `commit:${commitContextMenu.branch || currentTopologyBaseBranch()}:${commitContextMenu.sha}`);
                }}
              >
                {appText.createBranchFromCommit}
              </button>
              <button
                className="repo-context-item"
                onClick={() => {
                  setCommitContextMenu(null);
                  void inspectCommitFromTopology(commitContextMenu.sha);
                }}
              >
                {appText.explainInspectCommit}
              </button>
              <button className="repo-context-item" onClick={() => void applyCommitFromContextMenu("cherryPick")} disabled={busy}>
                {appText.cherryPickCurrentBranch}
              </button>
              <button className="repo-context-item" onClick={() => void applyCommitFromContextMenu("revert")} disabled={busy}>
                {appText.revertCurrentBranch}
              </button>
              <button className="repo-context-item" onClick={() => void copyCommitId(commitContextMenu.sha)}>
                {appText.copyCommitId}
              </button>
            </div>
          </div>
        ) : null}

        {commitHoverCard && !commitContextMenu ? (
          <div
            className="gt-commit-hover-card"
            style={{ left: Math.min(commitHoverCard.x + 14, window.innerWidth - 320), top: Math.min(commitHoverCard.y + 14, window.innerHeight - 150) }}
          >
            <strong>{commitHoverCard.subject || "(no subject)"}</strong>
            <span>{shortSha(commitHoverCard.sha, 12)}{commitHoverCard.branch ? ` · ${commitHoverCard.branch}` : ""}</span>
            <small>{commitHoverCard.author || "unknown"} · {commitHoverCard.date || "unknown date"}</small>
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
                      {appText.createBranch}
                    </button>
                    <button className="repo-context-item" onClick={() => openTopologyCreateDialog("worktree", topologyContextMenu.nodeId)}>
                      {appText.createWorktree}
                    </button>
                    {isRemoteBranch ? (
                      <button className="repo-context-item" onClick={() => void checkoutRemoteBranchFromTopology(branchName)}>
                        {appText.checkoutNewLocalBranch}
                      </button>
                    ) : (
                      <button className="repo-context-item" onClick={() => void checkoutBranchFromTopology(branchName)}>
                        {appText.checkout}
                      </button>
                    )}
                    {!isRemoteBranch && branchName !== "main" && branchName !== "master" && !hasWorktree ? (
                      <button className="repo-context-item danger" onClick={() => void deleteBranchFromTopology(branchName)}>
                        {appText.deleteBranch}
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
                      {appText.createBranchFromWorktree}
                    </button>
                    <button className="repo-context-item" onClick={() => void activateLinkedWorktree(worktreePath)}>
                      {appText.openWorktree}
                    </button>
                    {nodeAgentBinding ? (
                      <button className="repo-context-item" onClick={() => unbindAgentFromWorkspacePath(nodeWorkspacePath)}>
                        {appText.unbindAgent}
                      </button>
                    ) : (
                      <button className="repo-context-item" onClick={() => void bindAgentToWorkspacePath(nodeWorkspacePath, branchName)}>
                        {appText.bindAgent}
                      </button>
                    )}
                    {!isCurrentBranch ? (
                      <button className="repo-context-item danger" onClick={() => void removeTopologyWorktree(worktreePath)}>
                        {appText.removeWorktree}
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

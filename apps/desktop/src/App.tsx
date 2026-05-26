import { invoke, listen, IS_TAURI } from "./lib/platform";
import type { CSSProperties, ReactNode } from "react";
import { Component, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { clamp, makeId, scheduleAfterInteraction, waitForPaint } from "./lib/browserRuntime";
import {
  DEFAULT_CONTROL_SERVER_SETTINGS,
  controlServerSettingsChanged,
  normalizeControlPairMode,
  normalizeControlPublicBaseUrl,
  normalizeControlServerSettings,
  type ControlAccessInfo,
  type ControlPairCodeInfo,
  type ControlServerSettings,
  type GiteamMobileServiceStatus
} from "./lib/controlServer";
import { readImageFileAsAttachment, type OpencodeImageAttachment } from "./lib/imageAttachments";
import {
  OPENCODE_COMPOSER_AGENT_OPTIONS,
  OPENCODE_THINKING_LEVELS,
  allowAllPermissionRules,
  isComposerAgentName,
  normalizeComposerAgentName,
  normalizeThinkingLevel,
  type OpencodeComposerAgentName,
  type OpencodePermissionRule,
  type OpencodeThinkingLevel
} from "./lib/opencodeComposerSettings";
import { parseOpencodeAgents, type OpencodeAgentInfo } from "./lib/opencodeAgents";
import {
  loadCachedRuntimeStatus,
  loadCachedWidth,
  getRuntimeLogTail,
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
import { explainCommit, explainCommitShort } from "./lib/entireAdapter";
import { parseExplainCommit } from "./lib/explainParser";
import {
  buildConfiguredModelCandidates,
  buildSyncModelRefs,
  normalizeModelRef,
  normalizeProviderId,
  parseModelRef,
  resolveProviderAliasWithNames,
} from "./lib/opencodeModels";
import {
  applyOpencodeCatalog,
  buildOpencodeConfiguredProviderSnapshot,
  buildOpencodeProviderPickerCandidates,
  getOpencodeModelDisplayInfo,
  getOpencodeProviderSource as getOpencodeProviderSourceFromCatalog,
  getOpencodeProviderTag as getOpencodeProviderTagFromCatalog,
  normalizeOpencodeServerProviderState,
  resolveActiveOpencodeModel,
  type OpencodeConfigProviderCatalog,
  type OpencodeModelConfig,
  type OpencodeProviderAuthMethod,
  type OpencodeProviderConfig,
  type OpencodeServerConfig,
  type OpencodeServerConfigProvider,
  type OpencodeServerProviderState,
  type OpencodeServiceSettings
} from "./lib/opencodeProviderCatalog";
import {
  buildOpencodeTurnRanges,
  clipOpencodeSessionTitle,
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
  buildOpencodeImageAttachmentsFromParts,
  buildOpencodeMainLineMarkdownFromParts,
  mergeOpencodeMessageAttachments,
  mergeOpencodeStreamText,
  readOpencodeTodosFromPart,
  toDisplayJson
} from "./lib/opencodeParts";
import {
  closeRepoTerminalSession,
  completeRepoTerminalInput,
  clearRepoTerminalSession,
  listRepoTerminalCompletions,
  getCommitChangedFiles,
  getCommitFilePatch,
  readRepoTerminalOutput,
  sendRepoTerminalInput,
  startGitWorktreeWatcher,
  startRepoTerminalSession,
  stopGitWorktreeWatcher
} from "./lib/gitAdapter";
import { runReviewForCommit } from "./lib/reviewOrchestrator";
import {
  filterPermissionsBySession,
  parseOpencodePermissionRequests,
  removePermissionsById,
  replaceSessionPermissions,
  upsertPermissionRequest,
  type OpencodePermissionReply,
  type OpencodePermissionRequest
} from "./lib/opencodePermissions";
import {
  fetchOpencodeQuestions,
  postOpencodeQuestionReject,
  postOpencodeQuestionReply
} from "./lib/opencodeQuestions";
import {
  hasRuntimeFirstCheckCompleted,
  isRuntimeSetupDismissed,
  markRuntimeFirstCheckCompleted,
  markRuntimeReady,
  setRuntimeSetupDismissed
} from "./lib/desktopPreferences";
import {
  getAppText,
  loadGeneralSettings,
  playSettingsTone,
  saveGeneralSettings,
  showSettingsNotification
} from "./lib/generalSettings";
import {
  loadLocalBool,
  loadLocalString,
  saveLocalBool,
  saveLocalString
} from "./lib/localPreferences";
import {
  type OpencodeSkillInfo,
} from "./lib/opencodeSkillData";
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
  appendTerminalError,
  applyTerminalCompletionCandidate,
  browseTerminalHistoryState,
  clearTerminalCompletion,
  createTerminalTabState,
  recordTerminalCommand,
  sanitizeTerminalOutput,
  splitTerminalOutputForInput,
  type TerminalTabState,
  writeTerminalTabSnapshot
} from "./lib/terminalState";
import { useTerminalTabs } from "./lib/useTerminalTabs";
import { useGitWorkspaceController } from "./lib/useGitWorkspaceController";
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
  getDiscardableWorktreeEntryCount,
  getWorktreeChangeStats,
  getWorktreePatchStats,
  getWorktreeStatusText,
  toDiffRows,
  type DiffRow
} from "./lib/worktreeDiff";
import {
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
import { BranchGraphLanes } from "./components/git/BranchGraphLanes";
import { GitChangesPanel } from "./components/git/GitChangesPanel";
import { GitTreeTopologyPanel } from "./components/git/GitTreeTopologyPanel";
import { OpenCodeAuthDialog } from "./components/opencode/OpenCodeAuthDialog";
import { OpenCodeApiDialog } from "./components/opencode/OpenCodeApiDialog";
import { OpencodeComposerPanel } from "./components/opencode/OpencodeComposerPanel";
import { OpencodeMessageStream } from "./components/opencode/OpencodeMessageStream";
import { OpenCodeCustomProviderDialog } from "./components/opencode/OpenCodeCustomProviderDialog";
import { OpenCodeModulePanel, type OpencodeModuleTab } from "./components/opencode/OpenCodeModulePanel";
import { OpenCodeProviderPickerDialog } from "./components/opencode/OpenCodeProviderPickerDialog";
import { OpenCodeProviderSettingsPanel } from "./components/opencode/OpenCodeProviderSettingsPanel";
import {
  OpencodeMcpDialogs,
  OpencodeMcpMarketPanel,
  OpencodeSettingsMcpGrid
} from "./components/opencode/OpencodeMcpPanels";
import {
  OpencodeSkillsMarketPanel,
  OpencodeSettingsSkillsGrid
} from "./components/opencode/OpencodeSkillsPanels";
import { DesktopSidebar } from "./components/sidebar/DesktopSidebar";
import { RuntimeSetupDialog } from "./components/settings/RuntimeSetupDialog";
import { SettingsDialog, type GeneralSettingsDraft } from "./components/settings/SettingsDialog";
import { WorktreeTopologyCanvas } from "./components/WorktreeTopologyCanvas";
import type { TopologyCanvasNode } from "./components/WorktreeTopologyCanvas";
import rawMcpServers from "../servers.json";
import { normalizeMcpMarketData } from "./lib/mcpMarket";
import {
  buildOpencodeMcpPanelRows,
  buildOpencodeMcpRows,
  buildUpdatedMcpParamConfig,
  getEditableMcpParamValues,
  getCustomMcpParamSpecs,
  getInstalledMcpParamSpecs as getInstalledMcpParamSpecsFromMarket,
  getInstalledMcpTools as getInstalledMcpToolsFromMarket,
  getMissingMcpRequiredParams,
  normalizeCustomMcpJson,
  replaceMcpConfigPlaceholders
} from "./lib/opencodeMcpConfig";
import { getProviderDisplayName, PROVIDER_PRESETS } from "./lib/opencodeProviders";
import {
  getSkillAvatarLabel,
} from "./lib/opencodeSkillMarketplace";
import { useDesktopTheme } from "./lib/useDesktopTheme";
import { useAppearanceFontSize } from "./lib/useAppearanceFontSize";
import { useOpencodeInstalledSkills } from "./lib/useOpencodeInstalledSkills";
import { useOpencodeSkillMarketplace } from "./lib/useOpencodeSkillMarketplace";
import { useOpencodeModelVisibility } from "./lib/useOpencodeModelVisibility";
import { useOpencodeModelSelection } from "./lib/useOpencodeModelSelection";
import { shouldUsePromptHistoryKey, useOpencodePromptHistory } from "./lib/useOpencodePromptHistory";
import { useOpencodeMessageCache } from "./lib/useOpencodeMessageCache";
import { useOpencodeMcpAddForm } from "./lib/useOpencodeMcpAddForm";
import { usePinnedRepoIds } from "./lib/usePinnedRepoIds";
import { useRightModuleVisibility } from "./lib/useRightModuleVisibility";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { MobileControlDialog } from "./components/settings/MobileControlDialog";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
} from "./components/icons";

const MCP_MARKET_SERVERS = normalizeMcpMarketData(rawMcpServers);

type DetailTab = "diff" | "context" | "findings";
type OpencodeSlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: "builtin" | "command" | "skill" | "mcp";
};
type OpencodeMcpStatusMap = Record<string, Record<string, unknown>>;

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
        <div style={{ padding: "var(--gt-space-4)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
          <div style={{ marginBottom: "var(--gt-space-2)", fontWeight: "var(--gt-font-semibold)" }}>UI crashed</div>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--danger)" }}>{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
type OpencodeAuthPayload = { type: "api"; key: string };
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

const RUNTIME_FIRST_CHECK_KEY = "giteam.runtime.first-check.v1";
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
const SKILLSMP_API_KEY_STORAGE_KEY = "giteam.skillsmp.api-key.v1";
export function App() {
  const [theme, toggleTheme] = useDesktopTheme();
  const [pinnedRepoIds, togglePinnedRepo] = usePinnedRepoIds();
  const { uiFontSize, codeFontSize, setUiFontSize, setCodeFontSize } = useAppearanceFontSize();
  const [opencodePreviewImage, setOpencodePreviewImage] = useState<{ images: Array<{ uri: string; filename?: string }>; index: number } | null>(null);
  const [panelPlacement, setPanelPlacement] = useState<PanelPlacement>("hidden");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"general" | "appearance" | "modules" | "plugins" | "mobile" | "opencode" | "models" | "skillsmp" | "mcp">("general");
  const [settingsMobileVisible, setSettingsMobileVisible] = useState(false);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsDraft>(() => (
    loadGeneralSettings(GENERAL_SETTINGS_KEY, OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY)
  ));
  const appText = useMemo(() => getAppText(generalSettings.language), [generalSettings.language]);
  const [showMobileControlDialog, setShowMobileControlDialog] = useState(false);
  const [showOpencodeApiDialog, setShowOpencodeApiDialog] = useState(false);
  const [showGraphPopover, setShowGraphPopover] = useState(false);
  const [showEnvSetup, setShowEnvSetup] = useState(false);
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
  const { rightModuleVisibility, setRightModuleVisibility, toggleRightModuleVisibility } = useRightModuleVisibility(rightPaneTab, setRightPaneTab);
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
  const {
    savedModels: opencodeSavedModels,
    draftModel: opencodeDraftModel,
    sessionModel: opencodeSessionModel,
    rememberSavedModel: rememberOpencodeSavedModel,
    selectModel: selectOpencodeModel
  } = useOpencodeModelSelection(`${OPENCODE_MODEL_SELECTION_KEY}:global`);
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
  const [opencodeInlineAuthOpenFor, setOpencodeInlineAuthOpenFor] = useState("");
  const [opencodeConnectBusy, setOpencodeConnectBusy] = useState(false);
  const [opencodeDisconnectingProvider, setOpencodeDisconnectingProvider] = useState("");
  const [opencodeProviderAuthCache, setOpencodeProviderAuthCache] = useState<Record<string, OpencodeProviderAuthMethod[]>>({});
  const {
    hiddenModels: opencodeHiddenModels,
    enabledModels: opencodeEnabledModels,
    hideModel: hideOpencodeModel,
    enableModel: enableOpencodeModel
  } = useOpencodeModelVisibility({
    hidden: `${OPENCODE_MODEL_VIS_KEY}:global`,
    enabled: `${OPENCODE_MODEL_ENABLE_KEY}:global`
  });
  const [opencodeConfig, setOpencodeConfig] = useState<OpencodeModelConfig | null>(null);
  const [opencodeConfigBusy, setOpencodeConfigBusy] = useState(false);
  const [opencodeServiceSettings, setOpencodeServiceSettings] = useState<OpencodeServiceSettings>({
    port: 4098
  });
  const [opencodeServiceSettingsSavedPort, setOpencodeServiceSettingsSavedPort] = useState(4098);
  const [opencodeServiceSettingsBusy, setOpencodeServiceSettingsBusy] = useState(false);
  const [controlServerSettings, setControlServerSettings] = useState<ControlServerSettings>(DEFAULT_CONTROL_SERVER_SETTINGS);
  const [controlServerSettingsSaved, setControlServerSettingsSaved] = useState<ControlServerSettings>(DEFAULT_CONTROL_SERVER_SETTINGS);
  const [controlServerSettingsBusy, setControlServerSettingsBusy] = useState(false);
  const [controlPairCodeInfo, setControlPairCodeInfo] = useState<ControlPairCodeInfo | null>(null);
  const [controlAccessInfo, setControlAccessInfo] = useState<ControlAccessInfo | null>(null);
  const [controlPairQrUrl, setControlPairQrUrl] = useState("");
  const [controlSettingsLoaded, setControlSettingsLoaded] = useState(false);
  const controlSettingsDirty = controlServerSettingsChanged(controlServerSettings, controlServerSettingsSaved);
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
  const [opencodeMcpBusyName, setOpencodeMcpBusyName] = useState("");
  const [showMcpAddForm, setShowMcpAddForm] = useState(false);
  const opencodeMcpAddForm = useOpencodeMcpAddForm(showMcpAddForm);
  const [mcpInstalledOpen, setMcpInstalledOpen] = useState(false);
  const [editingMcpName, setEditingMcpName] = useState("");
  const [editingMcpParamValues, setEditingMcpParamValues] = useState<Record<string, string>>({});
  const [skillsmpApiKey, setSkillsmpApiKey] = useState(() => loadLocalString(SKILLSMP_API_KEY_STORAGE_KEY, ""));
  const [skillsmpApiKeyDraft, setSkillsmpApiKeyDraft] = useState(() => loadLocalString(SKILLSMP_API_KEY_STORAGE_KEY, ""));
  const [showSkillsmpSettings, setShowSkillsmpSettings] = useState(false);

  useEffect(() => {
    setGeneralSettings((prev) => {
      if (prev.autoAcceptPermissions === opencodeAutoAcceptPermissions) return prev;
      const next = { ...prev, autoAcceptPermissions: opencodeAutoAcceptPermissions };
      saveGeneralSettings(GENERAL_SETTINGS_KEY, OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, next);
      return next;
    });
  }, [opencodeAutoAcceptPermissions]);

  useEffect(() => {
    const lang = generalSettings.language === "system" ? navigator.language || "zh-CN" : generalSettings.language;
    document.documentElement.lang = lang;
  }, [generalSettings.language]);
  const opencodeSkillsRepoPathRef = useRef("");
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
  const [opencodeHydratingSessionId, setOpencodeHydratingSessionId] = useState("");
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
  const opencodeMessageCache = useOpencodeMessageCache();
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
  const opencodeHydratingSessionIdRef = useRef("");
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

  const {
    terminalTabs,
    setTerminalTabs,
    activeTerminalTabId,
    setActiveTerminalTabId,
    terminalSidebarVisible,
    setTerminalSidebarVisible,
    terminalTabCounterRef,
    terminalSeqRef,
    terminalBufferedOutputRef
  } = useTerminalTabs();
  const terminalRepoResetReadyRef = useRef(false);
  const terminalLogRef = useRef<HTMLDivElement | null>(null);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);
  const terminalInputShellRef = useRef<HTMLDivElement | null>(null);
  const terminalInputRef = useRef<HTMLTextAreaElement | null>(null);
  const terminalTextSelectingRef = useRef(false);
  const [terminalInputNearTop, setTerminalInputNearTop] = useState(false);
  const opencodeModelConfigLoadedRef = useRef(false);
  const opencodeConfiguredModelsLoadedRef = useRef(false);
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
  const resolveProviderDisplayName = (providerId: string) => getProviderDisplayName(providerId, opencodeProviderNames);
  const {
    opencodeSkills,
    opencodeSkillsLoading,
    opencodeSkillsLoadedOnce,
    opencodeSkillsError,
    opencodeSkillInstallSpec,
    setOpencodeSkillInstallSpec,
    opencodeSkillInstallScope,
    setOpencodeSkillInstallScope,
    opencodeSkillInstallingSpec,
    opencodeSkillInstallNotice,
    opencodeSkillInstallLog,
    opencodeSkillListFilter,
    setOpencodeSkillListFilter,
    opencodeSkillListQuery,
    setOpencodeSkillListQuery,
    opencodeSkillSourceInput,
    setOpencodeSkillSourceInput,
    opencodeSkillSourceKind,
    setOpencodeSkillSourceKind,
    opencodeSkillBusy,
    opencodeSkillRemovingKey,
    groupedOpencodeSkills,
    filteredOpencodeSkills,
    skillsByRepoRef: opencodeSkillsByRepoRef,
    setOpencodeSkillsError,
    restoreCachedSkillsForRepo,
    refreshOpencodeSkills,
    installOpencodeSkillFromRegistry,
    removeOpencodeSkill,
    removeOpencodeSkillGroup,
    addOpencodeSkillSource
  } = useOpencodeInstalledSkills({
    repoPath,
    skillsVisible: opencodeSkillsVisible,
    ensureRepoSelected,
    appendDebugLog: appendOpencodeDebugLog,
    setMessage,
    setError,
    runCommandInTerminalModule
  });
  const {
    opencodeSkillMarketListRef,
    opencodeSkillSearchQuery,
    setOpencodeSkillSearchQuery,
    opencodeSkillSearchStrategy,
    setOpencodeSkillSearchStrategy,
    opencodeSkillSearchResults,
    opencodeSkillSearchLoading,
    opencodeSkillCatalogView,
    opencodeSkillCatalogRows,
    opencodeSkillCatalogPage,
    opencodeSkillCatalogTotal,
    opencodeSkillSearchMeta,
    selectedMarketplaceSkill,
    selectedSkillDetail,
    selectedSkillAudits,
    selectedSkillLoading,
    showSkillInstallMenu,
    setShowSkillInstallMenu,
    opencodeMarketplaceRows,
    visibleOpencodeMarketplaceRows,
    opencodeSkillsInitialLoading,
    opencodeSkillsSearching,
    opencodeSkillsPaging,
    opencodeCanAutoLoadMore,
    warmSkillsMarketplace,
    searchOpencodeSkillRegistry,
    switchOpencodeSkillCatalogView,
    handleOpencodeSkillMarketScroll,
    selectMarketplaceSkill,
    loadSelectedMarketplaceSkillDetails
  } = useOpencodeSkillMarketplace({
    repoPath,
    skillsVisible: opencodeSkillsVisible,
    skillsLoadedOnce: opencodeSkillsLoadedOnce,
    skillsLoading: opencodeSkillsLoading,
    skillsmpApiKey,
    ensureRepoSelected,
    appendDebugLog: appendOpencodeDebugLog,
    setSkillsError: setOpencodeSkillsError
  });

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
  const worktreePatchStats = useMemo(() => getWorktreePatchStats(worktreePatchRows), [worktreePatchRows]);
  const worktreeChangeStats = useMemo(() => getWorktreeChangeStats(worktreeOverview.entries), [worktreeOverview.entries]);
  const discardAllCount = useMemo(
    () => getDiscardableWorktreeEntryCount(worktreeOverview.entries),
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
      const cached = restoreCachedSkillsForRepo(repoPath, { resetFilter: true });
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
  const runtimeLogTail = useMemo(() => getRuntimeLogTail(runtimeInstallLog), [runtimeInstallLog]);

  const activeOpencodeSession = useMemo(() => {
    if (!activeOpencodeSessionId) return null;
    return opencodeSessions.find((s) => s.id === activeOpencodeSessionId) ?? null;
  }, [opencodeSessions, activeOpencodeSessionId]);
  const pendingSidebarSessionSelection = pendingSidebarSessionSelectionRef.current;
  const pendingSidebarSessionId = pendingSidebarSessionSelection?.sessionId || "";
  const hydratingActiveOpencodeSession = Boolean(
    activeOpencodeSessionId
    && opencodeHydratingSessionId
    && activeOpencodeSessionId === opencodeHydratingSessionId
  );
  const pendingSidebarSessionSwitch = Boolean(
    pendingSidebarSessionSelection?.repoId === (selectedRepo?.id || "")
    && pendingSidebarSessionId
    && (
      pendingSidebarSessionId === opencodeHydratingSessionId
      || hydratingActiveOpencodeSession
      ||
      pendingSidebarSessionId !== activeOpencodeSessionId
      || !activeOpencodeSession
      || !activeOpencodeSession.loaded
    )
  );
  const activeOpencodeModel = useMemo(() => {
    return resolveActiveOpencodeModel({
      activeSessionId: activeOpencodeSessionId,
      sessionModel: opencodeSessionModel,
      draftModel: opencodeDraftModel,
      configuredModel: opencodeConfig?.configuredModel || "",
      savedModels: opencodeSavedModels,
      connectedProviders: opencodeConnectedProviders,
      modelsByProvider: opencodeModelsByProvider,
      providerNames: opencodeProviderNames
    });
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
  const opencodeSessionLoading = Boolean(
    hydratingActiveOpencodeSession
    || pendingSidebarSessionSwitch
    || (activeOpencodeSessionId && (!activeOpencodeSession || !activeOpencodeSession.loaded))
  );
  const opencodeShowEmptyState = !hydratingActiveOpencodeSession && !pendingSidebarSessionSwitch && !opencodeSessionLoading && opencodeMessages.length === 0;
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
  const getInstalledMcpParamSpecs = (name: string, status: OpencodeMcpStatusMap[string]) => getInstalledMcpParamSpecsFromMarket(MCP_MARKET_SERVERS, name, status);
  const getInstalledMcpTools = (name: string) => getInstalledMcpToolsFromMarket(MCP_MARKET_SERVERS, name);
  const opencodeMcpRows = useMemo(() => buildOpencodeMcpRows(opencodeMcpStatus, opencodeMcpVisible), [opencodeMcpVisible, opencodeMcpStatus]);
  const opencodeMcpPanelRows = useMemo(() => buildOpencodeMcpPanelRows(opencodeMcpRows, getInstalledMcpTools), [opencodeMcpRows]);
  const settingsSkillsContent = (
    <OpencodeSettingsSkillsGrid
      error={opencodeSkillsError}
      groups={groupedOpencodeSkills}
      removingKey={opencodeSkillRemovingKey}
      onRemoveSkillGroup={removeOpencodeSkillGroup}
    />
  );

  const settingsMcpContent = (
    <OpencodeSettingsMcpGrid
      rows={opencodeMcpPanelRows}
      error={opencodeMcpError}
      busyName={opencodeMcpBusyName}
      onEditMcp={(name) => startEditMcpParams(name, opencodeMcpStatus[name])}
      onRemoveMcp={removeOpencodeMcpServer}
    />
  );

  useEffect(() => {
    opencodeMcpLoadedRef.current = false;
    opencodeMcpLoadingRef.current = false;
  }, [repoPath]);

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
      clearOpencodeSessionHydration();
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
    clearPendingSidebarSessionSelection();
    clearOpencodeSessionHydration();
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
    return buildOpencodeProviderPickerCandidates({
      search: opencodeProviderPickerSearch,
      presetProviderIds: PROVIDER_PRESETS.map((p) => p.id).filter(Boolean),
      providers: opencodeProviders,
      connectedProviders: opencodeConnectedProviders,
      providerNames: opencodeProviderNames,
      configProviderMap: opencodeGlobalConfigProviderMap,
      disabledProviders: opencodeDisabledProviders
    });
  }, [
    opencodeProviders,
    opencodeProviderNames,
    opencodeProviderPickerSearch,
    opencodeConnectedProviders,
    opencodeGlobalConfigProviderMap,
    opencodeDisabledProviders
  ]);

  function getOpencodeModelDisplay(modelRef: string) {
    return getOpencodeModelDisplayInfo({
      modelRef,
      modelsByProvider: opencodeModelsByProvider,
      providerNames: opencodeProviderNames,
      modelNamesByProvider: opencodeModelNamesByProvider,
      configuredModelNamesByProvider: opencodeConfiguredModelNamesByProvider
    });
  }

  function getOpencodeProviderSource(providerId: string): string {
    return getOpencodeProviderSourceFromCatalog(providerId, opencodeProviderSourceById);
  }

  function getOpencodeProviderTag(providerId: string): string {
    return getOpencodeProviderTagFromCatalog({
      providerId,
      providerSourceById: opencodeProviderSourceById,
      providerMap: opencodeGlobalConfigProviderMap
    });
  }
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
      selectOpencodeModel(normalized, sid);
      if (parsed) {
        ensureProviderExists(parsed.provider);
        setOpencodeModelProvider(parsed.provider);
        setOpencodeSelectedModel(parsed.model);
      }
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
      const rows = parseOpencodeAgents(raw);
      setOpencodeAgents(rows);
    } catch (e) {
      const msg = String(e);
      setOpencodeAgentsError(msg);
      appendOpencodeDebugLog(`agent.list.error ${msg}`);
    } finally {
      setOpencodeAgentsLoading(false);
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
      const sid = sessionIdArg.trim();
      const nextRows = filterPermissionsBySession(parseOpencodePermissionRequests(raw), sid);
      if (opencodeAutoAcceptPermissions) {
        await Promise.all(nextRows.map((req) => sendPermissionReply(req.id, "always", { silent: true })));
        setOpencodePermissionRequests((prev) => removePermissionsById(prev, new Set(nextRows.map((row) => row.id))));
      } else {
        setOpencodePermissionRequests((prev) => replaceSessionPermissions(prev, nextRows, sid));
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
    setOpencodePermissionRequests((prev) => upsertPermissionRequest(prev, request));
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
      normalized = normalizeCustomMcpJson(opencodeMcpAddForm.json, opencodeMcpAddForm.name);
    } catch (e) {
      setError(`MCP JSON 配置无效：${String(e instanceof Error ? e.message : e)}`);
      return;
    }
    const { name, config } = normalized;
    const paramSpecs = getCustomMcpParamSpecs(opencodeMcpAddForm.json, name);
    const missing = paramSpecs.filter((spec) => spec.required && !String(opencodeMcpAddForm.paramValues[spec.key] || "").trim());
    if (missing.length > 0) {
      setError(`请填写必填参数：${missing.map((spec) => spec.key).join(", ")}`);
      return;
    }
    const resolvedConfig = replaceMcpConfigPlaceholders(config, opencodeMcpAddForm.paramValues) as Record<string, unknown>;
    setOpencodeMcpBusyName(name);
    setOpencodeMcpError("");
    try {
      await invoke<unknown>("add_opencode_mcp_server", { repoPath, name, config: resolvedConfig });
      setOpencodeMcpStatus((prev) => ({ ...prev, [name]: { ...(resolvedConfig as any), status: "configured" } }));
      opencodeMcpAddForm.reset();
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

  function startEditMcpParams(name: string, status: OpencodeMcpStatusMap[string]) {
    const specs = getInstalledMcpParamSpecs(name, status);
    setEditingMcpName(name);
    setEditingMcpParamValues(getEditableMcpParamValues(status, specs));
  }

  async function saveMcpParams(name: string, status: OpencodeMcpStatusMap[string]) {
    if (!ensureRepoSelected()) return;
    const specs = getInstalledMcpParamSpecs(name, status);
    const missing = getMissingMcpRequiredParams(specs, editingMcpParamValues);
    if (missing.length > 0) {
      setError(`请填写必填参数：${missing.map((spec) => spec.key).join(", ")}`);
      return;
    }
    const config = buildUpdatedMcpParamConfig(status, editingMcpParamValues);
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

  function beginOpencodeSessionHydration(sessionId: string) {
    const id = sessionId.trim();
    if (!id) return;
    opencodeHydratingSessionIdRef.current = id;
    setOpencodeHydratingSessionId(id);
  }

  function endOpencodeSessionHydration(sessionId: string) {
    const id = sessionId.trim();
    if (!id || opencodeHydratingSessionIdRef.current !== id) return;
    opencodeHydratingSessionIdRef.current = "";
    setOpencodeHydratingSessionId("");
  }

  function clearOpencodeSessionHydration() {
    opencodeHydratingSessionIdRef.current = "";
    setOpencodeHydratingSessionId("");
  }

  function clearPendingSidebarSessionSelection() {
    pendingSidebarSessionSelectionRef.current = null;
  }

  function openSidebarOpencodeSession(repo: RepositoryEntry, session: OpencodeSessionSummary) {
    pendingSidebarSessionSelectionRef.current = { repoId: repo.id, sessionId: session.id };
    const cachedSession = opencodeSessions.find((item) => item.id === session.id) ?? null;
    const shouldHydrate = selectedRepo?.id !== repo.id || !cachedSession?.loaded;
    if (shouldHydrate) beginOpencodeSessionHydration(session.id);
    else endOpencodeSessionHydration(session.id);
    setOpencodeSessions((prev) => {
      const hit = prev.findIndex((s) => s.id === session.id);
      if (hit >= 0) {
        return prev.map((s) =>
          s.id === session.id
            ? {
                ...s,
                title: s.title,
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
    void loadOpencodeSessionMessages(session.id, repo.path).catch((e) => setError(String(e)));
  }

  async function fetchOpencodeDetailedMessagePage(sessionId: string, before: string, limit: number, minFetchedAt = 0, repoPathArg = repoPath) {
    const id = sessionId.trim();
    const targetRepoPath = repoPathArg.trim();
    const safeBefore = before.trim();
    const safeLimit = Math.max(2, limit);
    const cacheKey = opencodeMessageCache.getPageCacheKey(targetRepoPath, id, safeBefore, safeLimit);
    const cached = opencodeMessageCache.getPageCacheEntry(targetRepoPath, id, safeBefore, safeLimit);
    if (cached && cached.fetchedAt >= minFetchedAt) {
      appendOpencodeDebugLog(`session.messages page cache hit ${id} before=${safeBefore || "root"} limit=${safeLimit}`);
      return cached;
    }
    const inflight = opencodeMessageCache.getPageInflight(cacheKey);
    if (inflight) return inflight;
    const task = (async () => {
      let raw: unknown[] = [];
      let nextCursorFromRpc = "";
      const base = await invoke<string>("get_opencode_service_base", { repoPath: targetRepoPath });
      const qs = new URLSearchParams();
      qs.set("limit", String(safeLimit));
      qs.set("directory", targetRepoPath);
      if (safeBefore) qs.set("before", safeBefore);
      const res = await fetch(`${base}/session/${encodeURIComponent(id)}/message?${qs.toString()}`);
      if (!res.ok) throw new Error(`fetch message page failed: ${res.status}`);
      const body = await res.json();
      raw = Array.isArray(body) ? body : [];
      nextCursorFromRpc = res.headers.get("x-next-cursor")?.trim() || "";
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
      const nextCursor = nextCursorFromRpc || undefined;
      const entry: OpencodeMessagePageCacheEntry = {
        before: safeBefore,
        limit: safeLimit,
        items: mapped,
        detailsById,
        nextCursor,
        hasMore: Boolean(nextCursor),
        fetchedAt: Date.now()
      };
      opencodeMessageCache.setPageEntry(targetRepoPath, id, entry);
      return entry;
    })().finally(() => {
      opencodeMessageCache.clearPageInflight(cacheKey);
    });
    opencodeMessageCache.setPageInflight(cacheKey, task);
    return task;
  }

  async function fetchOpencodeCompactMessagesWindow(sessionId: string, initialLimit: number, repoPathArg = repoPath) {
    const id = sessionId.trim();
    const targetRepoPath = repoPathArg.trim();
    const limit = Math.max(2, initialLimit);
    const sessionUpdatedAt = opencodeSessions.find((session) => session.id === id)?.updatedAt || 0;
    const cached = opencodeMessageCache.getBestWindowEntry(targetRepoPath, id, limit, sessionUpdatedAt);
    if (cached) {
      appendOpencodeDebugLog(`session.messages cache hit ${id} limit=${cached.limit}`);
      return {
        mapped: cached.mapped,
        turnCount: cached.turnCount,
        requestedLimit: cached.limit,
        nextCursor: cached.nextCursor,
        hasMore: cached.hasMore
      };
    }
    const page = await fetchOpencodeDetailedMessagePage(id, "", limit, sessionUpdatedAt, targetRepoPath);
      const existingSession = opencodeSessions.find((session) => session.id === id);
      const mapped = mergeOpencodeMessageAttachments(existingSession?.messages, page.items);
    const turnCount = buildOpencodeTurnRanges(mapped).length;
    opencodeMessageCache.setWindowEntry(targetRepoPath, id, {
      limit,
      mapped,
      turnCount,
      nextCursor: page.nextCursor,
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
      setSidebarOpencodeSessionsByRepo((prev) => {
        const cachedSessions = prev[repoId] || [];
        const mapped = sorted.slice(0, limit).map((s, i) => {
          const base = opencodeSessionFromSummary(s, i + 1);
          const cached = cachedSessions.find((item) => item.id === base.id) || opencodeSessions.find((item) => item.id === base.id);
          return cached && cached.title.trim() ? { ...base, title: cached.title } : base;
        });
        return { ...prev, [repoId]: mapped };
      });
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
      const pendingForEmptyRepo = pendingAtRequest && pendingAtRequest.repoId === repoIdAtRequest ? pendingAtRequest : null;
      if (pendingForEmptyRepo) {
        const sidebarHit = (sidebarOpencodeSessionsByRepo[repoIdAtRequest] || []).find((session) => session.id === pendingForEmptyRepo.sessionId);
        const cachedHit = opencodeSessions.find((session) => session.id === pendingForEmptyRepo.sessionId);
        const pendingSession = sidebarHit || cachedHit;
        if (pendingSession) {
          setOpencodeSessions([{ ...opencodeSessionFromSummary(pendingSession), loaded: false }]);
          setActiveOpencodeSessionId(pendingForEmptyRepo.sessionId);
          setDraftOpencodeSession(false);
          pendingSidebarSessionSelectionRef.current = null;
          return;
        }
      }
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
          title: cached.title.trim() || session.title,
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
          title: cached.title.trim() || session.title,
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

  async function loadOpencodeSessionMessages(sessionId: string, repoPathArg = repoPath) {
    if (!repoPathArg.trim() && !ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    appendOpencodeDebugLog(`session.messages load ${id}`);
    try {
      const result = await fetchOpencodeCompactMessagesWindow(id, OPENCODE_INITIAL_MESSAGE_FETCH_LIMIT, repoPathArg);
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
    } finally {
      endOpencodeSessionHydration(id);
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
        if (mapped.length > session.messages.length) {
          if (Object.keys(page.detailsById).length > 0) {
            setOpencodeDetailsByMessageId((prev) => ({ ...prev, ...page.detailsById }));
          }
          updateOpencodeSessionById(id, (s) => ({
            ...s,
            messages: mapped,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
            updatedAt: Date.now()
          }));
          appendOpencodeDebugLog(`session.messages load more ${id} mergedWithoutTurnGrowth count=${mapped.length} hasMore=${page.hasMore}`);
        }
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
      title: clipOpencodeSessionTitle(seedPrompt) || undefined,
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
    clearPendingSidebarSessionSelection();
    clearOpencodeSessionHydration();
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
    clearPendingSidebarSessionSelection();
    clearOpencodeSessionHydration();
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
          title: old.title || summary?.title || titleHint || old.title,
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
    beginOpencodeSessionHydration(id);
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
        beginOpencodeSessionHydration(fallback.id);
        setOpencodeSessions((prev) => [{ ...opencodeSessionFromSummary(fallback), loaded: false }, ...prev.filter((session) => session.id !== fallback.id)]);
        setActiveOpencodeSessionId(fallback.id);
        setDraftOpencodeSession(false);
      } else {
        clearOpencodeSessionHydration();
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
      beginOpencodeSessionHydration(fallback.id);
      setActiveOpencodeSessionId(fallback.id);
      setDraftOpencodeSession(false);
    } else if (next.length === 0) {
      clearOpencodeSessionHydration();
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

  const {
    activateLinkedWorktree,
    checkoutBranchFromTopology,
    checkoutRemoteBranchFromTopology,
    activateBranchWorkspace,
    deleteBranchFromTopology,
    inspectCommitFromTopology,
    applyCommitFromContextMenu,
    currentTopologyBaseBranch,
    topologyCreateSource,
    suggestedTopologyPath,
    commitWorktreeBranchName,
    openCommitWorktreeDialog,
    openTopologyCreateDialog,
    submitTopologyCreateDialog,
    openTopologyInspectDialog,
    removeTopologyWorktree,
    refreshStatus,
    refreshBranchesAndCommits,
    refreshWorktreeData,
    refreshGitUserIdentity,
    refreshSelectedWorktreePatch,
    chooseBranch,
    handleGitCommit,
    handleGitPush,
    handleGitSync,
    handleGitCommitAndPush,
    handleGitCommitAndSync,
    refreshScm,
    pullLatest,
    pushCurrent,
    handleDiscardChanges,
    handleDiscardEntries,
    handleStageFile,
    handleStagePaths,
    handleUnstageFile,
    handleUnstagePaths,
    handleToggleStageAll,
    openDiscardAllConfirm,
    handleDiscardAllChanges,
    handleRemoveWorktree,
    toggleWorktreeDir,
  } = useGitWorkspaceController({
    selectedRepo,
    selectedBranch,
    selectedWorktreeFile,
    linkedWorktrees,
    branches,
    repoPath,
    gitPanePath,
    worktreeOverview,
    commitMessage,
    committing,
    pushing,
    topologyModel,
    topologySelectionId,
    topologyCreateSourceNodeId,
    topologyCreateMode,
    topologyCreateBranchName,
    topologyCreateTargetPath,
    topologyCreatingNode,
    commitContextMenu,
    gitPanePathRef,
    emptyWorktree: EMPTY_WORKTREE,
    emptyWorktreeFileContent: EMPTY_WORKTREE_FILE_CONTENT,
    emptyGitIdentity: EMPTY_GIT_IDENTITY,
    ensureRepoSelected,
    ensureGitPaneSelected,
    rememberBranchParent,
    forgetBranchParent,
    rememberWorktreeParent,
    unbindWorkspaceAgent,
    appendOpencodeDebugLog,
    focusCommitMessageInput: () => commitMessageInputRef.current?.focus(),
    setSelectedRepo,
    setMessage,
    setError,
    setBusy,
    setOverlayBusy,
    setWorktreeOverview,
    setLinkedWorktrees,
    setBranches,
    setCommitGraph,
    setSelectedBranch,
    setCommits,
    setSelectedCommit,
    setTopologyContextMenu,
    setTopologySelectionId,
    setCommitContextMenu,
    setGitOperation,
    setDetailTab,
    setTopologyCreateSourceNodeId,
    setTopologyCreateMode,
    setTopologyCreateBranchName,
    setTopologyCreateTargetPath,
    setTopologyCreatingNode,
    setShowTopologyCreateDialog,
    setCreatingTopologyNode,
    setTopologyInspectNodeId,
    setShowTopologyInspectDialog,
    setRemovingTopologyNode,
    setStatusText,
    setRecords,
    setActions,
    setCommitMessage,
    setCommitting,
    setPushing,
    setShowCommitActionMenu,
    setSelectedWorktreeFile,
    setSelectedWorktreePatch,
    setSelectedWorktreeContent,
    setGitUserIdentity,
    setDiscardingFile,
    setStagingFile,
    setUnstagingFile,
    setShowDiscardAllConfirm,
    setShowRemoveWorktreeConfirm,
    setDiscardingAll,
    setRemovingWorktreePath,
    setWorktreeContextMenu,
    setWorktreeToRemove,
    setExpandedWorktreeDirs,
    setBranchParentMap
  });

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
      if (final.git.installed && final.entire.installed) markRuntimeReady();
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
    const snapshot = normalizeOpencodeServerProviderState(state);
    const connectedSet = new Set(snapshot.connectedProviders);
    const stickyProviders = new Set<string>();
    if (opencodeModelProvider.trim()) stickyProviders.add(opencodeModelProvider.trim());
    const configured = parseModelRef(opencodeConfig?.configuredModel || "");
    if (configured?.provider) stickyProviders.add(configured.provider);
    const selectionCatalog = Object.fromEntries(
      Object.entries(snapshot.modelsByProvider).filter(([providerId]) => connectedSet.has(providerId) || stickyProviders.has(providerId))
    );
    const next = applyOpencodeCatalog(
      Object.keys(selectionCatalog).length > 0 ? selectionCatalog : snapshot.modelsByProvider,
      opencodeModelProvider,
      opencodeSelectedModel
    );
    setOpencodeProviderNames((prev) => ({ ...prev, ...snapshot.providerNames }));
    setOpencodeProviderSourceById((prev) => ({ ...prev, ...snapshot.providerSources }));
    setOpencodeModelsByProvider(snapshot.modelsByProvider);
    setOpencodeModelNamesByProvider(snapshot.modelNamesByProvider);
    setOpencodeProviders(snapshot.providers);
    setOpencodeConnectedProviders(snapshot.connectedProviders);
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
      if (cfg.configuredModel) rememberOpencodeSavedModel(cfg.configuredModel);
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
      const next = normalizeControlServerSettings(cfg);
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
      const normalized = normalizeControlServerSettings(saved, draft);
      setControlServerSettingsSaved(normalized);
      setControlServerSettings((current) => (
        controlServerSettingsChanged(current, draft) ? current : normalized
      ));
      if (normalized.enabled) {
        await Promise.all([loadControlPairCode(), loadControlAccessInfo()]);
      } else {
        setControlPairCodeInfo(null);
        setControlAccessInfo(null);
      }
    } catch (e) {
      setControlServerSettings((current) => (
        current.enabled === draft.enabled
          ? { ...current, enabled: controlServerSettingsSaved.enabled }
          : current
      ));
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
    const draftBase = controlServerSettings;
    if (!controlServerSettingsChanged(draftBase, controlServerSettingsSaved)) return true;
    const port = Number(draftBase.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Control server port must be between 1 and 65535");
      return false;
    }
    let publicBaseUrl = "";
    try {
      publicBaseUrl = normalizeControlPublicBaseUrl(draftBase.publicBaseUrl);
    } catch {
      setError("Public URL 格式无效（示例: http://192.168.1.23:4100）");
      return false;
    }
    const draft = normalizeControlServerSettings({
      ...draftBase,
      port,
      publicBaseUrl,
      pairCodeTtlMode: normalizeControlPairMode(draftBase.pairCodeTtlMode)
    }, draftBase);
    setControlServerSettingsBusy(true);
    try {
      const saved = await invoke<ControlServerSettings>("giteam_cli_set_settings", {
        settings: {
          enabled: draft.enabled,
          host: draft.host,
          port,
          publicBaseUrl,
          pairCodeTtlMode: draft.pairCodeTtlMode
        }
      });
      const normalized = normalizeControlServerSettings(saved, draft);
      setControlServerSettingsSaved(normalized);
      setControlServerSettings((current) => (
        controlServerSettingsChanged(current, draft) ? current : normalized
      ));
      if (normalized.enabled) {
        void loadControlPairCode();
        void loadControlAccessInfo();
      } else {
        setControlPairCodeInfo(null);
        setControlAccessInfo(null);
      }
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setControlServerSettingsBusy(false);
    }
  }

  async function closeSettingsModal() {
    if (settingsMobileVisible && runtimeStatus.giteam.installed && controlSettingsDirty && !controlServerSettingsBusy) {
      void saveControlServerSettingsIfNeeded();
    }
    setShowMobileControlDialog(false);
    setShowOpencodeApiDialog(false);
    setSettingsMobileVisible(false);
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
      const snapshot = normalizeOpencodeServerProviderState(state);
      if (snapshot.providers.length === 0) return;
      setOpencodeProviderNames((prev) => {
        const next = { ...prev };
        for (const [providerId, displayName] of Object.entries(snapshot.providerNames)) {
          if (displayName && !next[providerId]) next[providerId] = displayName;
        }
        return next;
      });
      setOpencodeProviderSourceById(snapshot.providerSources);
      setOpencodeModelNamesByProvider(snapshot.modelNamesByProvider);
      setOpencodeModelsByProvider(snapshot.modelsByProvider);
      setOpencodeProviders(snapshot.providers);
      setOpencodeConnectedProviders(snapshot.connectedProviders);
      appendOpencodeDebugLog(`server.providers synced providers=${snapshot.providers.length} connected=${snapshot.connectedProviders.length}`);
    } catch (e) {
      appendOpencodeDebugLog(`server.providers error ${String(e)}`);
    }
  }

  async function openConnectProvider(providerId: string) {
    if (!ensureRepoSelected()) return;
    const pid = providerId.trim();
    if (!pid) return;
    setOpencodeConnectProviderId(pid);
    setOpencodeConnectProviderName(resolveProviderDisplayName(pid));
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
      const snapshot = buildOpencodeConfiguredProviderSnapshot(globalCfg);
      setOpencodeGlobalConfigProviderMap(snapshot.providerMap);
      setOpencodeDisabledProviders(snapshot.disabledProviders);

      // Prefer /provider-derived display names when available.
      // /config is often "power-user" config and may use terse ids (e.g. k2p5) even when /provider has a nicer name (e.g. kimi2.5).
      setOpencodeProviderNames((prev) => {
        const next = { ...prev };
        for (const [pid, display] of Object.entries(snapshot.providerNames)) {
          if (!pid) continue;
          if (!next[pid]) next[pid] = display;
        }
        return next;
      });
      setOpencodeConfiguredModelsByProvider(snapshot.modelsByProvider);
      setOpencodeConfiguredModelNamesByProvider(snapshot.modelNamesByProvider);
      setOpencodeConfiguredProviders(snapshot.configuredProviders);

      if (includeCurrentModel) {
        const effective = await invoke<OpencodeServerConfig>("get_opencode_server_config", { repoPath });
        const currentModel = normalizeModelRef(effective?.model || "");
        if (currentModel) {
          const parsed = parseModelRef(currentModel);
          if (parsed) {
            const configuredSet = new Set(snapshot.configuredProviders);
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
      appendOpencodeDebugLog(`server.config synced providers=${Object.keys(snapshot.providerMap).length} configured=${snapshot.configuredProviders.length}`);
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
    opencodeMessageCache.invalidate(repoPath, sessionId);
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
        messages: nextMessages,
        turnStart: nextTurnStart,
        updatedAt: Date.now()
      };
    });
    updateSidebarOpencodeSession(repoIdAtRun, sessionId, (session) => ({
      ...session,
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

      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      const qdir = encodeURIComponent(repoPath);
      const eventUrl = `${base}/global/event?directory=${qdir}`;
      const promptUrl = `${base}/session/${encodeURIComponent(sessionId)}/prompt_async?directory=${qdir}`;
      appendOpencodeDebugLog(`prompt.stream.connect ${eventUrl}`);
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

  const {
    recordHistoryEntry: recordOpencodePromptHistoryEntry,
    captureDraft: captureOpencodePromptHistoryDraft,
    browseHistory: browseOpencodePromptHistory
  } = useOpencodePromptHistory({
    activeSessionId: activeOpencodeSessionId,
    currentInput: opencodePromptInput,
    onApplyHistory: setOpencodePromptInputFromHistory
  });

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

  function browseTerminalHistory(tabId: string, direction: "older" | "newer") {
    updateTerminalTabById(tabId, (prev) => browseTerminalHistoryState(prev, direction));
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
    updateTerminalTabById(tab.id, (prev) => clearTerminalCompletion(prev, nextInput));
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
      updateTerminalTabById(tab.id, (prev) => clearTerminalCompletion(prev, nextInput));
      void refreshTerminalCompletions({ ...tab, input: nextInput, completionItems: [], completionIndex: 0, completionToken: "" }, nextInput);
    } catch {
      // ignore completion failures to keep typing smooth
    }
  }

  async function sendQuestionReply(requestId: string, answers: QuestionAnswer[]) {
    try {
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      await postOpencodeQuestionReply({ baseUrl: base, repoPath, requestId, answers });
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
      setOpencodeQuestionRequests(await fetchOpencodeQuestions({ baseUrl: base, repoPath, sessionId: sid }));
    } catch (e) {
      appendOpencodeDebugLog(`question.list.error ${String(e)}`);
    } finally {
      setOpencodeQuestionLoading(false);
    }
  }

  async function sendQuestionReject(requestId: string) {
    try {
      const base = await invoke<string>("get_opencode_service_base", { repoPath });
      await postOpencodeQuestionReject({ baseUrl: base, repoPath, requestId });
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
      updateTerminalTabById(activeTerminalTab.id, (prev) => recordTerminalCommand(prev, script));
    } catch (e) {
      const msg = String(e);
      updateTerminalTabById(activeTerminalTab.id, (prev) => appendTerminalError(prev, msg));
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
      updateTerminalTabById(tab.id, (prev) => recordTerminalCommand(prev, command));
    } catch (e) {
      const msg = String(e);
      updateTerminalTabById(tab.id, (prev) => appendTerminalError(prev, msg));
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
    const hasCheckedBefore = hasRuntimeFirstCheckCompleted(RUNTIME_FIRST_CHECK_KEY);
    const dismissed = isRuntimeSetupDismissed();
    void refreshRuntimeRequirements()
      .then((res) => {
        markRuntimeFirstCheckCompleted(RUNTIME_FIRST_CHECK_KEY);
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
    if (!showSettings || !runtimeStatus.opencode.installed || !selectedRepo) return;
    if (opencodeProviders.length === 0) {
      void refreshOpencodeCatalog();
    }
  }, [showSettings, runtimeStatus.opencode.installed, Boolean(selectedRepo)]);

  useEffect(() => {
    if (!(showMobileControlDialog || settingsMobileVisible) || !runtimeStatus.giteam.installed) return;
    // Load settings after the dialog paints to avoid blocking navigation.
    window.setTimeout(() => {
      void loadControlServerSettings();
    }, 0);
  }, [showMobileControlDialog, settingsMobileVisible, runtimeStatus.giteam.installed]);

  useEffect(() => {
    if (!(showMobileControlDialog || settingsMobileVisible) || !runtimeStatus.giteam.installed) return;
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
    settingsMobileVisible,
    runtimeStatus.giteam.installed,
    controlSettingsLoaded,
    controlServerSettings.enabled
  ]);

  useEffect(() => {
    if (!settingsMobileVisible || !runtimeStatus.giteam.installed) return;
    if (controlServerSettingsBusy || !controlSettingsLoaded || !controlSettingsDirty) return;
    const timer = window.setTimeout(() => {
      void saveControlServerSettingsIfNeeded();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    settingsMobileVisible,
    runtimeStatus.giteam.installed,
    controlServerSettingsBusy,
    controlSettingsLoaded,
    controlSettingsDirty,
    controlServerSettings.enabled,
    controlServerSettings.port,
    controlServerSettings.publicBaseUrl,
    controlServerSettings.pairCodeTtlMode
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
    rememberOpencodeSavedModel(activeOpencodeModel);
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
        opencodeMessageCache.invalidate(repoPath, sessionId);
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
  const noRepos = repos.length === 0;

  const sideBar = (
    <DesktopSidebar
      noRepos={noRepos}
      busy={busy}
      opencodeInstalled={runtimeStatus.opencode.installed}
      repos={repos}
      pinnedRepoIds={pinnedRepoIds}
      expandedProjectIds={expandedProjectIds}
      selectedRepoId={selectedRepo?.id || ""}
      activeSessionId={activeOpencodeSessionId}
      draftRepoId={draftOpencodeSession ? (selectedRepo?.id || "") : ""}
      gitUserIdentity={gitUserIdentity}
      fallbackIdentityName={selectedRepo?.name || "g"}
      getVisibleRepoSessions={getVisibleRepoSessions}
      hasMoreRepoSessions={hasMoreRepoSessions}
      isRepoSessionsLoading={isRepoSessionsLoading}
      onImportRepository={() => void pickAndImportRepository()}
      onCreateSession={() => void createAndSwitchOpencodeSessionForSidebar()}
      onSelectRepo={(repo) => {
        setSelectedRepo(repo);
        setGitPaneRepo(repo);
      }}
      onToggleRepoSessions={toggleRepoSessions}
      onOpenRepoContextMenu={openRepoContextMenu}
      onTogglePinnedRepo={togglePinnedRepo}
      onFocusDraftSession={() => opencodeInputRef.current?.focus()}
      onOpenSession={openSidebarOpencodeSession}
      onOpenSessionContextMenu={(x, y, repo, session) => setSessionContextMenu({ x, y, repo, session })}
      onLoadMoreSessions={(repo) => void loadMoreSidebarRepoSessions(repo)}
      onOpenSettings={() => setShowSettings(true)}
    />
  );

  const centerPane = runtimeStatus.opencode.installed ? (
    <div className={`panel opencode-canvas gt-chat-canvas${opencodeMessages.length > 0 ? " has-chat" : ""}`}>
        <div className={opencodeShowEmptyState ? "opencode-main gt-chat-main is-empty" : "opencode-main gt-chat-main"}>
          <div className="opencode-thread" ref={opencodeThreadRef} onScroll={onOpencodeThreadScroll} onWheel={onOpencodeThreadWheel}>
            <OpencodeMessageStream
              sessionLoading={opencodeSessionLoading}
              messages={opencodeMessages}
              renderedMessages={opencodeRenderedMessages}
              activeStreamingAssistantId={activeOpencodeStreamingAssistantId}
              activeSessionBusy={activeOpencodeSessionBusy}
              serverMessageIdByLocalId={opencodeServerMessageIdByLocalId}
              detailsByMessageId={opencodeDetailsByMessageId}
              livePartsByServerMessageId={opencodeLivePartsByServerMessageId}
              detailsLoadingByMessageId={opencodeDetailsLoadingByMessageId}
              detailsErrorByMessageId={opencodeDetailsErrorByMessageId}
              showReasoningSummaries={generalSettings.showReasoningSummaries}
              shellToolPartsExpanded={generalSettings.shellToolPartsExpanded}
              editToolPartsExpanded={generalSettings.editToolPartsExpanded}
              onOpenTaskSession={(sessionId, titleHint) => {
                void openOpencodeChildSession(sessionId, titleHint);
              }}
              onPreviewImageGroup={(images, index) => {
                setOpencodePreviewImage({ images, index });
              }}
              onCopyAttachmentUri={(uri) => {
                void copyText(uri);
              }}
            />
          </div>
        <OpencodeComposerPanel
          showSessionProgressBar={generalSettings.showSessionProgressBar}
          todoDockVisible={opencodeTodoDockVisible}
          todoDockCollapsed={opencodeTodoDockCollapsed}
          activeTodos={opencodeActiveTodos}
          todoProgress={opencodeTodoProgress}
          onToggleTodoDockCollapsed={() => setOpencodeTodoDockCollapsed((prev) => !prev)}
          permissions={opencodeActivePermissions}
          onOpenPermissionsPanel={() => openOpencodeModulePanel("permissions")}
          onReplyPermission={(requestId, reply) => { void sendPermissionReply(requestId, reply); }}
          questionLoading={opencodeQuestionLoading}
          activeQuestions={opencodeActiveQuestions}
          staleQuestions={opencodeStaleQuestions}
          onReplyQuestion={(requestId, answers) => {
            void sendQuestionReply(requestId, answers).then((ok) => {
              if (!ok) return;
              setOpencodeDismissedQuestionsBySession((prev) => ({
                ...prev,
                [activeOpencodeSessionId]: Array.from(new Set([...(prev[activeOpencodeSessionId] || []), requestId])),
              }));
            });
          }}
          onDismissQuestion={(requestId) => {
            void sendQuestionReject(requestId).then((ok) => {
              if (!ok) return;
              setOpencodeDismissedQuestionsBySession((prev) => ({
                ...prev,
                [activeOpencodeSessionId]: Array.from(new Set([...(prev[activeOpencodeSessionId] || []), requestId])),
              }));
            });
          }}
          onDismissStaleQuestion={(requestId) => {
            setOpencodeDismissedQuestionsBySession((prev) => ({
              ...prev,
              [activeOpencodeSessionId]: Array.from(new Set([...(prev[activeOpencodeSessionId] || []), requestId])),
            }));
          }}
          showEmptyState={opencodeShowEmptyState}
          selectedRepoName={selectedRepo?.name || "Giteam"}
          showJumpLatest={opencodeShowJumpLatest}
          onJumpLatest={jumpOpencodeToLatest}
          imageAttachments={opencodeImageAttachments}
          mcpPromptRefs={opencodeMcpPromptRefs}
          onRemoveImageAttachment={(id) => setOpencodeImageAttachments((prev) => prev.filter((item) => item.id !== id))}
          onRemoveMcpPromptRef={(name) => setOpencodeMcpPromptRefs((prev) => prev.filter((item) => item !== name))}
          slashOpen={opencodeSlashOpen}
          slashSuggestions={opencodeSlashSuggestions}
          slashActiveIndex={opencodeSlashActiveIndex}
          onHoverSlashSuggestion={setOpencodeSlashActiveIndex}
          onActivateSlashCommand={activateOpencodeSlashCommand}
          promptInputRef={opencodeInputRef}
          promptInput={opencodePromptInput}
          onPromptCompositionStart={() => {
            opencodeInputComposingRef.current = true;
          }}
          onPromptCompositionEnd={() => {
            opencodeInputComposingRef.current = false;
          }}
          onPromptChange={(event) => {
            const value = event.target.value;
            captureOpencodePromptHistoryDraft(value);
            setOpencodePromptInput(value);
            const isSlash = /^\//.test(value) && !value.includes(" ");
            setOpencodeSlashOpen(isSlash);
            setOpencodeSlashActiveIndex(0);
          }}
          onPromptKeyDown={(event) => {
            if (activeOpencodeSessionBusy) return;
            const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
            if (nativeEvent.isComposing || opencodeInputComposingRef.current || nativeEvent.keyCode === 229) return;
            if (opencodeSlashOpen && opencodeSlashSuggestions.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpencodeSlashActiveIndex((index) => (index + 1) % opencodeSlashSuggestions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setOpencodeSlashActiveIndex((index) => (index - 1 + opencodeSlashSuggestions.length) % opencodeSlashSuggestions.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const command = opencodeSlashSuggestions[opencodeSlashActiveIndex];
                if (command) activateOpencodeSlashCommand(command);
                return;
              }
              if (event.key === "Escape") {
                setOpencodeSlashOpen(false);
                return;
              }
            }
            if (event.key === "ArrowUp" && shouldUsePromptHistoryKey(event, "older")) {
              event.preventDefault();
              browseOpencodePromptHistory("older");
              return;
            }
            if (event.key === "ArrowDown" && shouldUsePromptHistoryKey(event, "newer")) {
              event.preventDefault();
              browseOpencodePromptHistory("newer");
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void runOpencodePrompt();
            }
          }}
          onPromptPaste={async (event) => {
            const files = Array.from(event.clipboardData?.files || []);
            if (files.length === 0) return;
            event.preventDefault();
            const attachments = await Promise.all(files.map((file) => readImageFileAsAttachment(file)));
            setOpencodeImageAttachments((prev) => [...prev, ...attachments.filter(Boolean) as OpencodeImageAttachment[]]);
          }}
          attachmentMenuOpen={opencodeAttachmentMenuOpen}
          onToggleAttachmentMenu={() => setOpencodeAttachmentMenuOpen((prev) => !prev)}
          imageInputRef={opencodeImageInputRef}
          onOpenImagePicker={() => {
            setOpencodeAttachmentMenuOpen(false);
            opencodeImageInputRef.current?.click();
          }}
          onImageInputChange={async (event) => {
            const files = Array.from(event.target.files || []);
            if (files.length === 0) return;
            const attachments = await Promise.all(files.map((file) => readImageFileAsAttachment(file)));
            setOpencodeImageAttachments((prev) => [...prev, ...attachments.filter(Boolean) as OpencodeImageAttachment[]]);
            event.currentTarget.value = "";
          }}
          modelPickerRef={opencodeModelPickerRef}
          showModelPicker={showOpencodeModelPicker}
          onToggleModelPicker={() => setShowOpencodeModelPicker((prev) => !prev)}
          modelPickerSearch={opencodeModelPickerSearch}
          onModelPickerSearchChange={setOpencodeModelPickerSearch}
          activeAgent={activeOpencodeAgent}
          onApplyAgent={applyOpencodeAgent}
          autoAcceptPermissions={opencodeAutoAcceptPermissions}
          onToggleAutoAcceptPermissions={() => {
            const next = !opencodeAutoAcceptPermissions;
            setOpencodeAutoAcceptPermissions(next);
            saveLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, next);
            if (next && activeOpencodeSessionId) void ensureSessionAutoAcceptPermissions(activeOpencodeSessionId);
          }}
          configuredModelCandidates={opencodeConfiguredModelCandidates}
          activeModel={activeOpencodeModel}
          getModelDisplay={getOpencodeModelDisplay}
          onApplyModel={(modelRef) => {
            void applyOpencodeModel(modelRef);
            setShowOpencodeModelPicker(false);
          }}
          onOpenModelSettings={() => {
            setSettingsInitialSection("models");
            setShowSettings(true);
            setOpencodeProviderPickerSearch("");
            setOpencodeProviderPickerProvider(opencodeModelProvider);
            setOpencodeProviderPickerModelSearch("");
            setShowOpencodeModelPicker(false);
          }}
          activeSessionBusy={activeOpencodeSessionBusy}
          canSubmit={Boolean(opencodePromptInput.trim() || opencodeMcpPromptRefs.length > 0 || opencodeImageAttachments.length > 0)}
          onPrimaryAction={() => {
            if (activeOpencodeSessionBusy) {
              void stopOpencodePrompt();
            } else {
              void runOpencodePrompt();
            }
          }}
          repos={repos}
          selectedRepoId={selectedRepo?.id || ""}
          onSelectRepo={(repo) => {
            setSelectedRepo(repo);
            setGitPaneRepo(repo);
            setNewSessionTargetRepoId(repo.id);
          }}
        />
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
              <GitTreeTopologyPanel
                selectedRepo={selectedRepo}
                linkedWorktrees={linkedWorktrees}
                branchParentMap={branchParentMap}
                branches={branches}
                commitGraph={commitGraph}
                worktreeOverview={worktreeOverview}
                selectedBranch={selectedBranch}
                topologySelectionId={topologySelectionId}
                worktreeParentMap={worktreeParentMap}
                commits={commits}
                selectedCommit={selectedCommit}
                collapsedBranchIds={collapsedBranchIds}
                selectedExplain={selectedExplain}
                selectedWorktreePath={selectedWorktreePath}
                busy={busy}
                onRefresh={() => void refreshScm()}
                onChooseBranch={(branchName) => void chooseBranch(branchName)}
                onCheckoutBranch={(branchName) => void checkoutBranchFromTopology(branchName)}
                onSelectCommit={setSelectedCommit}
                onSelectTopology={setTopologySelectionId}
                onOpenDetailContext={() => setDetailTab("context")}
                onOpenBranchMenu={(x, y, nodeId) => setTopologyContextMenu({ x, y, nodeId })}
                onOpenCommitMenu={(x, y, commit, branch) => setCommitContextMenu({ x, y, sha: commit.sha, branch, subject: commit.subject })}
                onHoverCommit={(x, y, commit, branch) => setCommitHoverCard({ x, y, sha: commit.sha, branch, subject: commit.subject, author: commit.author, date: commit.date })}
                onMoveCommitHover={(x, y, sha) => setCommitHoverCard((prev) => prev?.sha === sha ? { ...prev, x, y } : prev)}
                onClearCommitHover={() => setCommitHoverCard(null)}
                onToggleBranchCollapse={(treeKey) => setCollapsedBranchIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(treeKey)) next.delete(treeKey);
                  else next.add(treeKey);
                  return next;
                })}
                onOpenCommitWorktreeDialog={openCommitWorktreeDialog}
                onInspectCommit={(sha) => void inspectCommitFromTopology(sha)}
                onOpenTopologyCreateDialog={openTopologyCreateDialog}
                onSelectWorktree={setSelectedWorktreePath}
                onOpenWorktreeMenu={(x, y, path) => setWorktreeContextMenu({ x, y, path })}
                onActivateWorktree={(path) => void activateLinkedWorktree(path)}
              />
            </div>
          </div>
        ) : null}

        {rightPaneTab === "changes" ? (
          <GitChangesPanel
            branchName={worktreeOverview.branch || selectedBranch || "no branch"}
            ahead={worktreeOverview.ahead}
            behind={worktreeOverview.behind}
            changesSidebarWidth={changesSidebarWidth}
            isResizing={draggingSplit?.kind === "changes"}
            changeStats={worktreeChangeStats}
            stagedTree={stagedTree}
            unstagedTree={unstagedTree}
            expandedDirs={expandedWorktreeDirs}
            selectedFile={selectedWorktreeFile}
            selectedEntry={selectedWorktreeEntry}
            selectedContent={selectedWorktreeContent}
            patchStats={worktreePatchStats}
            commitMessage={commitMessage}
            commitMessageInputRef={commitMessageInputRef}
            committing={committing}
            pushing={pushing}
            gitOperationLabel={gitOperationLabel}
            commitPrimaryIsSync={commitPrimaryIsSync}
            hasCommittableChanges={hasCommittableChanges}
            commitButtonCount={commitButtonCount}
            commitMenuAvailable={commitMenuAvailable}
            showCommitActionMenu={showCommitActionMenu}
            stagingFile={stagingFile}
            unstagingFile={unstagingFile}
            discardingFile={discardingFile}
            discardingAll={discardingAll}
            theme={theme}
            appText={appText}
            onCommitMessageChange={setCommitMessage}
            onToggleStageAll={() => void handleToggleStageAll()}
            onOpenDiscardAllConfirm={openDiscardAllConfirm}
            onToggleCommitActionMenu={() => setShowCommitActionMenu((prev) => !prev)}
            onCommit={() => void handleGitCommit()}
            onPush={() => void handleGitPush()}
            onSync={() => void handleGitSync()}
            onCommitAndPush={() => void handleGitCommitAndPush()}
            onCommitAndSync={() => void handleGitCommitAndSync()}
            onToggleDir={toggleWorktreeDir}
            onOpenFile={(path) => void refreshSelectedWorktreePatch(path)}
            onStageFile={(path) => void handleStageFile(path)}
            onUnstageFile={(path) => void handleUnstageFile(path)}
            onStagePaths={(paths, label) => void handleStagePaths(paths, label)}
            onUnstagePaths={(paths, label) => void handleUnstagePaths(paths, label)}
            onDiscardFile={(path, isUntracked) => void handleDiscardChanges(path, isUntracked)}
            onDiscardEntries={(entries, label) => void handleDiscardEntries(entries, label)}
            onCopyText={(text) => void copyText(text)}
            onBeginResize={(clientX) => setDraggingSplit({ kind: "changes", startX: clientX, startWidth: changesSidebarWidth })}
          />
        ) : null}

        {rightPaneTab === "skills" ? (
          <OpencodeSkillsMarketPanel
            groups={groupedOpencodeSkills}
            skills={opencodeSkills}
            skillsLoading={opencodeSkillsLoading}
            skillsError={opencodeSkillsError}
            skillsmpApiKey={skillsmpApiKey}
            removingKey={opencodeSkillRemovingKey}
            skillBusy={opencodeSkillBusy}
            skillInstallingSpec={opencodeSkillInstallingSpec}
            skillInstallNotice={opencodeSkillInstallNotice}
            skillInstallLog={opencodeSkillInstallLog}
            marketListRef={opencodeSkillMarketListRef}
            searchQuery={opencodeSkillSearchQuery}
            searchStrategy={opencodeSkillSearchStrategy}
            searchResults={opencodeSkillSearchResults}
            catalogView={opencodeSkillCatalogView}
            catalogPage={opencodeSkillCatalogPage}
            catalogTotal={opencodeSkillCatalogTotal}
            searchMeta={opencodeSkillSearchMeta}
            selectedMarketplaceSkill={selectedMarketplaceSkill}
            selectedSkillDetail={selectedSkillDetail}
            selectedSkillAudits={selectedSkillAudits}
            selectedSkillLoading={selectedSkillLoading}
            showSkillInstallMenu={showSkillInstallMenu}
            marketplaceRows={opencodeMarketplaceRows}
            visibleMarketplaceRows={visibleOpencodeMarketplaceRows}
            initialLoading={opencodeSkillsInitialLoading}
            searching={opencodeSkillsSearching}
            paging={opencodeSkillsPaging}
            canAutoLoadMore={opencodeCanAutoLoadMore}
            onSearchQueryChange={setOpencodeSkillSearchQuery}
            onSearch={() => void searchOpencodeSkillRegistry()}
            onSearchStrategyChange={setOpencodeSkillSearchStrategy}
            onSwitchCatalogView={switchOpencodeSkillCatalogView}
            onRefreshSkills={() => void refreshOpencodeSkills()}
            onScrollMarket={handleOpencodeSkillMarketScroll}
            onSelectMarketplaceSkill={selectMarketplaceSkill}
            onInstallMarketplaceSkill={(spec) => void installOpencodeSkillFromRegistry(spec, "project")}
            onToggleSkillInstallMenu={() => setShowSkillInstallMenu((prev) => !prev)}
            onInstallSelectedMarketplaceSkill={(scope) => {
              if (!selectedMarketplaceSkill) return;
              setShowSkillInstallMenu(false);
              void installOpencodeSkillFromRegistry(selectedMarketplaceSkill.installSpec || selectedMarketplaceSkill.spec, scope);
            }}
            onLoadSelectedSkillDetails={() => void loadSelectedMarketplaceSkillDetails(selectedMarketplaceSkill)}
            onReferenceSkill={referenceOpencodeSkill}
            onRemoveSkill={removeOpencodeSkill}
            onRemoveSkillGroup={removeOpencodeSkillGroup}
          />
        ) : null}

        {rightPaneTab === "mcp" ? (
          <OpencodeMcpMarketPanel
            rows={opencodeMcpPanelRows}
            loading={opencodeMcpLoading}
            error={opencodeMcpError}
            installedOpen={mcpInstalledOpen}
            servers={MCP_MARKET_SERVERS}
            configuredMcpNames={opencodeMcpRows.map(([name]) => name)}
            onInstalledOpenChange={setMcpInstalledOpen}
            onShowCustomAdd={() => setShowMcpAddForm(true)}
            onRefresh={() => void refreshOpencodeMcpStatus()}
            onReferenceMcp={referenceOpencodeMcp}
            onAddMcpFromMarket={addOpencodeMcpServerFromMarket}
          />
        ) : null}

        <OpencodeMcpDialogs
          showCustomAdd={showMcpAddForm}
          customName={opencodeMcpAddForm.name}
          customJson={opencodeMcpAddForm.json}
          customParamValues={opencodeMcpAddForm.paramValues}
          busyName={opencodeMcpBusyName}
          customParamSpecs={getCustomMcpParamSpecs(opencodeMcpAddForm.json, opencodeMcpAddForm.name)}
          normalizeConfig={normalizeCustomMcpJson}
          onCloseCustomAdd={() => setShowMcpAddForm(false)}
          onCustomNameChange={opencodeMcpAddForm.setName}
          onCustomJsonChange={opencodeMcpAddForm.setJson}
          onCustomParamChange={opencodeMcpAddForm.setParamValue}
          onAddCustomMcp={addOpencodeMcpServer}
          editingName={editingMcpName}
          editingStatus={opencodeMcpStatus[editingMcpName]}
          editingSpecs={getInstalledMcpParamSpecs(editingMcpName, opencodeMcpStatus[editingMcpName])}
          editingTools={getInstalledMcpTools(editingMcpName)}
          editingParamValues={editingMcpParamValues}
          onCloseEditing={() => { setEditingMcpName(""); setEditingMcpParamValues({}); }}
          onEditingParamChange={(key, value) => setEditingMcpParamValues((prev) => ({ ...prev, [key]: value }))}
          onRemoveEditingMcp={() => removeOpencodeMcpServer(editingMcpName)}
          onSaveEditingMcp={() => saveMcpParams(editingMcpName, opencodeMcpStatus[editingMcpName])}
        />

        {rightPaneTab === "terminal" ? (
          <TerminalPanel
            tabs={terminalTabs}
            activeTabId={activeTerminalTabId}
            activeTab={activeTerminalTab}
            activeView={activeTerminalView}
            ghostText={activeTerminalGhostText}
            sidebarVisible={terminalSidebarVisible}
            inputNearTop={terminalInputNearTop}
            bodyRef={terminalBodyRef}
            logRef={terminalLogRef}
            inputShellRef={terminalInputShellRef}
            inputRef={terminalInputRef}
            hasTextSelection={terminalHasTextSelection}
            markTextSelecting={(selecting) => { terminalTextSelectingRef.current = selecting; }}
            flushBufferedOutput={flushBufferedTerminalOutput}
            onToggleSidebar={() => setTerminalSidebarVisible((visible) => !visible)}
            onCreateTab={createTerminalTab}
            onCloseTab={closeTerminalTab}
            onSelectTab={setActiveTerminalTabId}
            onClearActiveTab={async () => {
              if (!selectedRepo || !activeTerminalTab) return;
              await clearRepoTerminalSession(selectedRepo.path, activeTerminalTab.id);
              terminalSeqRef.current[activeTerminalTab.id] = 0;
              updateTerminalTabById(activeTerminalTab.id, { seq: 0, output: "" });
            }}
            onUpdateTab={updateTerminalTabById}
            onRunCommand={runTerminalCommand}
            onBrowseHistory={browseTerminalHistory}
            onApplyCompletion={applyTerminalTabCompletion}
            onSelectCompletion={selectTerminalCompletion}
            onInterrupt={(tab) => sendRepoTerminalInput(repoPath, "\u0003", tab.id).catch(() => {
              // ignore
            })}
          />
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
  const controlServiceEnabled = controlServerSettings.enabled;
  const mobileStatus = mobileServiceStatus;
  useEffect(() => {
    let cancelled = false;
    if (!controlPairPayload) {
      setControlPairQrUrl("");
      return () => {
        cancelled = true;
      };
    }
    void QRCode.toDataURL(controlPairPayload, {
      margin: 0,
      width: 240,
      errorCorrectionLevel: "M"
    }).then((dataUrl) => {
      if (!cancelled) setControlPairQrUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setControlPairQrUrl("");
    });
    return () => {
      cancelled = true;
    };
  }, [controlPairPayload]);
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

  async function submitOpencodeProviderAuthKey(
    providerId: string,
    connected: boolean,
    options?: { closeDialog?: boolean; closeInlineAuth?: boolean }
  ) {
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
      setMessage(connected ? `已更新密钥: ${authPid}` : `已连接: ${authPid}`);
      setOpencodeConnectApiKey("");
      if (options?.closeDialog) {
        setShowOpencodeAuthDialogFor("");
      }
      if (options?.closeInlineAuth) {
        setOpencodeInlineAuthOpenFor("");
      }
    } catch (e) {
      setError(String(e));
      setMessage(connected ? "更新密钥失败" : "连接失败");
    } finally {
      setOpencodeConnectBusy(false);
    }
  }

  async function saveOpencodeAuthKey(providerId: string) {
    await submitOpencodeProviderAuthKey(providerId, true, { closeDialog: true });
  }

  const panel = <div className="wb-panel-inner" />;

  const shellToggles = (
    <div className="gt-shell-toggle-layer" aria-label="布局显隐控制">
      <button className={leftDrawerOpen ? "gt-shell-toggle gt-shell-toggle-left is-sidebar-open" : "gt-shell-toggle gt-shell-toggle-left is-sidebar-closed"} title={leftDrawerOpen ? "收起左侧栏" : "展开左侧栏"} onClick={() => setLeftDrawerOpen((v) => !v)}>
        <PanelToggleIcon side="left" collapsed={!leftDrawerOpen} />
      </button>
      <button className="gt-shell-toggle gt-shell-toggle-right" title={rightDrawerOpen ? "收起右侧栏" : "展开右侧栏"} onClick={() => setRightDrawerOpen((v) => !v)}>
        <PanelToggleIcon side="right" collapsed={!rightDrawerOpen} />
      </button>
    </div>
  );

  return (
    <AppErrorBoundary>
      <>
        {shellToggles}
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
              {mobileStatusChangeToast.message === "Disconnected" ? <CloseIcon width={16} height={16} /> : <CheckIcon width={16} height={16} />}
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
              <div className="toolbar" style={{ justifyContent: "space-between", marginTop: "var(--gt-space-3)" }}>
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
              <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: "var(--gt-space-3-5)" }}>
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
              <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: "var(--gt-space-3-5)" }}>
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
              saveGeneralSettings(GENERAL_SETTINGS_KEY, OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, next);
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
            controlConnectionUrl={controlBaseUrl}
            controlPairCode={controlPairCode}
            controlPairQrUrl={controlPairQrUrl}
            controlSettingsDirty={controlSettingsDirty}
            onRefreshControlPairCode={() => {
              void forceRefreshControlPairCode();
              void loadControlAccessInfo();
            }}
            onCopyControlUrl={() => {
              void navigator.clipboard.writeText(controlBaseUrl);
              setMessage("Control server URL copied");
            }}
            onMobileVisibilityChange={setSettingsMobileVisible}
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
                const cached = restoreCachedSkillsForRepo(repoPath);
                if (!cached) scheduleAfterInteraction(() => void refreshOpencodeSkills(), 220);
                return;
              }
              if (!opencodeSkillsLoading && !opencodeSkillsLoadedOnce) scheduleAfterInteraction(() => void refreshOpencodeSkills(), 220);
            }}
            modelsContent={(
              <OpenCodeProviderSettingsPanel
                providerSearch={opencodeProviderPickerSearch}
                modelSearch={opencodeProviderPickerModelSearch}
                providers={opencodeProviderPickerCandidates}
                selectedProvider={opencodeProviderPickerProvider}
                connectedProviders={opencodeConnectedProviders}
                providerNames={opencodeProviderNames}
                modelCountsByProvider={opencodeProviderPickerModelCounts}
                modelsByProvider={opencodeModelsByProvider}
                configuredModelsByProvider={opencodeConfiguredModelsByProvider}
                configuredModelNamesByProvider={opencodeConfiguredModelNamesByProvider}
                modelNamesByProvider={opencodeModelNamesByProvider}
                activeModel={activeOpencodeModel}
                hiddenModels={opencodeHiddenModels}
                enabledModels={opencodeEnabledModels}
                connectBusy={opencodeConnectBusy}
                connectProviderId={opencodeConnectProviderId}
                connectApiKey={opencodeConnectApiKey}
                inlineAuthOpenFor={opencodeInlineAuthOpenFor}
                onProviderSearchChange={setOpencodeProviderPickerSearch}
                onModelSearchChange={setOpencodeProviderPickerModelSearch}
                onSelectProvider={(provider, connected) => {
                  setOpencodeProviderPickerProvider(provider);
                  const pretty = resolveProviderDisplayName(provider);
                  setOpencodeConnectProviderId(provider);
                  setOpencodeConnectProviderName(pretty);
                  setOpencodeInlineAuthOpenFor(connected ? "" : provider);
                  if (!connected) setOpencodeConnectApiKey("");
                }}
                onConnectApiKeyChange={(providerId, providerName, value) => {
                  setOpencodeConnectProviderId(providerId);
                  setOpencodeConnectProviderName(providerName);
                  setOpencodeConnectApiKey(value);
                }}
                onToggleInlineAuth={(providerId, providerName) => {
                  setOpencodeConnectProviderId(providerId);
                  setOpencodeConnectProviderName(providerName);
                  setOpencodeInlineAuthOpenFor((prev) => prev === providerId ? "" : providerId);
                }}
                onConnectProvider={(providerId, connected) => void submitOpencodeProviderAuthKey(providerId, connected, { closeInlineAuth: connected })}
                onSelectModel={(ref) => void applyOpencodeModel(ref)}
                onHideModel={hideOpencodeModel}
                onEnableModel={enableOpencodeModel}
                getProviderTag={getOpencodeProviderTag}
                getProviderDisplayName={resolveProviderDisplayName}
              />
            )}
          />
        ) : null}

        {showMobileControlDialog && runtimeStatus.giteam.installed ? (
          <MobileControlDialog
            settings={controlServerSettings}
            busy={controlServerSettingsBusy}
            serviceEnabled={controlServiceEnabled}
            authNoAuth={controlAuthNoAuth}
            pairCode={controlPairCode}
            baseUrl={controlBaseUrl}
            pairQrUrl={controlPairQrUrl}
            onClose={() => void closeMobileControlDialog()}
            onToggleService={(enabled) => void toggleControlServiceEnabled(enabled)}
            onSettingsChange={(patch) => setControlServerSettings((prev) => ({ ...prev, ...patch }))}
            onPairModeChange={(mode) => setControlServerSettings((prev) => ({ ...prev, pairCodeTtlMode: normalizeControlPairMode(mode) }))}
            onRefreshCode={() => {
              void forceRefreshControlPairCode();
              void loadControlAccessInfo();
            }}
            onCopiedUrl={() => setMessage("Control server URL copied")}
          />
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
                <button className="gt-diff-icon-btn" type="button" aria-label="关闭" onClick={() => setShowSkillsmpSettings(false)}><CloseIcon /></button>
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
          <OpenCodeProviderPickerDialog
            loading={opencodeCatalogLoading}
            providerSearch={opencodeProviderPickerSearch}
            modelSearch={opencodeProviderPickerModelSearch}
            providers={opencodeProviderPickerCandidates}
            selectedProvider={opencodeProviderPickerProvider}
            connectedProviders={opencodeConnectedProviders}
            providerNames={opencodeProviderNames}
            modelCountsByProvider={opencodeProviderPickerModelCounts}
            modelsByProvider={opencodeModelsByProvider}
            configuredModelsByProvider={opencodeConfiguredModelsByProvider}
            configuredModelNamesByProvider={opencodeConfiguredModelNamesByProvider}
            modelNamesByProvider={opencodeModelNamesByProvider}
            activeModel={activeOpencodeModel}
            hiddenModels={opencodeHiddenModels}
            enabledModels={opencodeEnabledModels}
            connectBusy={opencodeConnectBusy}
            connectProviderId={opencodeConnectProviderId}
            connectApiKey={opencodeConnectApiKey}
            providerActionMenuFor={opencodeProviderActionMenuFor}
            disconnectingProvider={opencodeDisconnectingProvider}
            onClose={() => setShowOpencodeProviderPicker(false)}
            onOpenCustomProvider={() => {
              setShowOpencodeProviderPicker(false);
              setShowOpencodeCustomProvider(true);
            }}
            onProviderSearchChange={setOpencodeProviderPickerSearch}
            onModelSearchChange={setOpencodeProviderPickerModelSearch}
            onSelectProvider={(provider, connected) => {
              setOpencodeProviderPickerProvider(provider);
              if (!connected) {
                setOpencodeConnectProviderId(provider);
                setOpencodeConnectProviderName(resolveProviderDisplayName(provider));
                setOpencodeConnectApiKey("");
                return;
              }
              setShowOpencodeAuthDialogFor("");
            }}
            onConnectApiKeyChange={(providerId, providerName, value) => {
              setOpencodeConnectProviderId(providerId);
              setOpencodeConnectProviderName(providerName);
              setOpencodeConnectApiKey(value);
            }}
            onToggleProviderMenu={(providerId) => setOpencodeProviderActionMenuFor((prev) => (prev === providerId ? "" : providerId))}
            onOpenAuthDialog={(providerId, providerName) => {
              setOpencodeConnectProviderId(providerId);
              setOpencodeConnectProviderName(providerName);
              setOpencodeConnectApiKey("");
              setShowOpencodeAuthDialogFor(providerId);
              setOpencodeProviderActionMenuFor("");
            }}
            onConnectProvider={(providerId, connected) => void submitOpencodeProviderAuthKey(providerId, connected)}
            onDisconnectProvider={(providerId) => {
              setOpencodeProviderActionMenuFor("");
              void disconnectOpencodeProvider(providerId);
            }}
            onSelectModel={(ref) => void applyOpencodeModel(ref)}
            onHideModel={hideOpencodeModel}
            onEnableModel={enableOpencodeModel}
            getProviderTag={getOpencodeProviderTag}
            getProviderSource={getOpencodeProviderSource}
            getProviderDisplayName={resolveProviderDisplayName}
          />
        ) : null}

        {showOpencodeAuthDialogFor ? (() => {
          const pid = showOpencodeAuthDialogFor.trim();
          const pretty = resolveProviderDisplayName(pid);
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
              setRuntimeSetupDismissed(true);
              setShowEnvSetup(false);
            }}
            onRefresh={() => void refreshRuntimeRequirements()}
            onRunDependencyAction={(name, action) => void runDependencyAction(name, action)}
            onToggleLog={(name) => setExpandedLogDep((prev) => (prev === name ? null : name))}
          />
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

        <OpenCodeModulePanel
          open={showOpencodeModulePanel}
          activeTab={opencodeModuleTab}
          agentSearch={opencodeAgentSearch}
          agentsLoading={opencodeAgentsLoading}
          agentsError={opencodeAgentsError}
          visibleAgents={visibleOpencodeAgents}
          activeAgent={activeOpencodeAgent}
          autoAcceptPermissions={opencodeAutoAcceptPermissions}
          permissionLoading={opencodePermissionLoading}
          activePermissions={opencodeActivePermissions}
          mcpLoading={opencodeMcpLoading}
          mcpError={opencodeMcpError}
          mcpBusyName={opencodeMcpBusyName}
          mcpRows={opencodeMcpRows as Array<[string, Record<string, any>]>}
          mcpAddForm={opencodeMcpAddForm}
          skillsLoading={opencodeSkillsLoading}
          skillsError={opencodeSkillsError}
          skills={opencodeSkills}
          filteredSkills={filteredOpencodeSkills}
          groupedSkills={groupedOpencodeSkills}
          skillSearchResults={opencodeSkillSearchResults}
          skillInstallScope={opencodeSkillInstallScope}
          skillBusy={opencodeSkillBusy}
          skillInstallingSpec={opencodeSkillInstallingSpec}
          skillInstallLog={opencodeSkillInstallLog}
          skillInstallSpec={opencodeSkillInstallSpec}
          skillSearchQuery={opencodeSkillSearchQuery}
          skillSourceKind={opencodeSkillSourceKind}
          skillSourceInput={opencodeSkillSourceInput}
          skillListFilter={opencodeSkillListFilter}
          skillListQuery={opencodeSkillListQuery}
          skillRemovingKey={opencodeSkillRemovingKey}
          onClose={() => setShowOpencodeModulePanel(false)}
          onTabChange={setOpencodeModuleTab}
          onAgentSearchChange={setOpencodeAgentSearch}
          onRefreshAgents={() => void refreshOpencodeAgents()}
          onApplyAgent={applyOpencodeAgent}
          onToggleAutoAccept={() => {
            const next = !opencodeAutoAcceptPermissions;
            setOpencodeAutoAcceptPermissions(next);
            saveLocalBool(OPENCODE_AUTO_ACCEPT_PERMISSIONS_KEY, next);
            if (next && activeOpencodeSessionId) void ensureSessionAutoAcceptPermissions(activeOpencodeSessionId);
          }}
          onRefreshPermissions={() => void refreshPendingPermissions()}
          onSendPermissionReply={(requestId, reply) => void sendPermissionReply(requestId, reply)}
          onRefreshMcp={() => void refreshOpencodeMcpStatus()}
          onRefreshSkills={() => void refreshOpencodeSkills()}
          onAddMcp={() => void addOpencodeMcpServer()}
          onRunMcpAction={(name, action) => void runMcpAction(name, action)}
          onSkillInstallScopeChange={setOpencodeSkillInstallScope}
          onSkillInstallSpecChange={setOpencodeSkillInstallSpec}
          onSkillSearchQueryChange={setOpencodeSkillSearchQuery}
          onSearchSkillRegistry={() => void searchOpencodeSkillRegistry()}
          onInstallSkill={(spec, scope) => void installOpencodeSkillFromRegistry(spec, scope)}
          onSkillSourceKindChange={setOpencodeSkillSourceKind}
          onSkillSourceInputChange={setOpencodeSkillSourceInput}
          onAddSkillSource={() => void addOpencodeSkillSource()}
          onSkillListFilterChange={setOpencodeSkillListFilter}
          onSkillListQueryChange={setOpencodeSkillListQuery}
          onReferenceSkill={referenceOpencodeSkill}
          onRemoveSkill={(skill) => void removeOpencodeSkill(skill)}
          onRemoveSkillGroup={(group) => void removeOpencodeSkillGroup(group)}
        />

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
                    <div className="repo-context-header" style={{ padding: "var(--gt-space-1-5) var(--gt-space-3)", fontSize: "var(--gt-text-sm)", fontWeight: "var(--gt-font-semibold)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
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
                    <div className="repo-context-header" style={{ padding: "var(--gt-space-1-5) var(--gt-space-3)", fontSize: "var(--gt-text-sm)", fontWeight: "var(--gt-font-semibold)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
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

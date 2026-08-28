import { motion } from "motion/react";
import QRCode from "qrcode";
import type { CSSProperties, ReactNode } from "react";
import { Component, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import { flushSync } from "react-dom";
import { REMOTE_REPO_MODULE_ENABLED } from "./lib/featureFlags";
import {
  PINNED_RIGHT_PANE_TAB,
  ShellPanelToggle,
  type OptionalRightPaneTab,
  type RightPaneTab,
} from "./components/common/AppChromeIcons";
import { GitChangesPanel } from "./components/git/GitChangesPanel";
import { GitTreeTopologyPanel } from "./components/git/GitTreeTopologyPanel";
import {
  CloseIcon,
  ArrowDownIcon
} from "./components/icons";
import { AgentApiDialog } from "./components/agent/AgentApiDialog";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { AgentAuthDialog } from "./components/agent/AgentAuthDialog";
import { AgentCustomProviderDialog, normalizeOpenAICompatibleBaseUrl } from "./components/agent/AgentCustomProviderDialog";
import { AgentModulePanel, type AgentModuleTab } from "./components/agent/AgentModulePanel";
import { AgentProviderPickerDialog } from "./components/agent/AgentProviderPickerDialog";
import { AgentProviderSettingsPanel } from "./components/agent/AgentProviderSettingsPanel";
import { EditorSessionHeader } from "./components/agent/EditorSessionHeader";
import { AgentChatFrame, CHAT_CONTENT_LEFT_CSS } from "./components/agent/AgentChatFrame";
import { AutomationView } from "./components/automation/AutomationView";
import { AgentComposerPanel } from "./components/agent/AgentComposerPanel";
import { AgentMessageStream } from "./components/agent/AgentMessageStream";
import { BrowserPanel } from "./components/agent/BrowserPanel";
import { AssetGraphPanel } from "./components/agent/AssetGraphPanel";
import {
  formatGraphContextBlock,
  formatLocalFileAttachmentHint,
  formatUiOnlyFileAttachmentHint,
  IMAGE_ONLY_USER_PROMPT,
  isCompactionSummaryUserText,
  normalizeUserMessageForDisplay,
  type GraphContextRef,
} from "./lib/graphContextRefs";
import { SearchPanel } from "./components/search/SearchPanel";
import type { SearchHit, SearchScope } from "./lib/sessionSearch";
import { AgentTodoProgressCard } from "./components/agent/AgentTodoProgressCard";
import {
  AgentSettingsSkillsGrid,
  AgentSkillsMarketPanel
} from "./components/agent/AgentSkillsPanels";
import { MobileControlDialog } from "./components/settings/MobileControlDialog";
import { MobilePairQrDialog } from "./components/settings/MobilePairQrDialog";
import { listCloudMobileClients } from "./lib/cloudLink";
import { RuntimeSetupDialog } from "./components/settings/RuntimeSetupDialog";
import { SettingsDialog, type GeneralSettingsDraft } from "./components/settings/SettingsDialog";
import { DesktopSidebar } from "./components/sidebar/DesktopSidebar";
import { RightSidebar, RightSidebarPanel } from "./components/sidebar/RightSidebar";
import { RemoteRepoCatalog } from "./components/remote-repo/RemoteRepoCatalog";
import { RemoteRepoCodeResourcePanel } from "./components/remote-repo/RemoteRepoCodeResourcePanel";
import { RemoteRepoWorkspacePanel } from "./components/remote-repo/RemoteRepoWorkspacePanel";
import {
  getRemoteWorkspaceGraph,
  listRemoteRepoActivities,
  listRemoteRepoWorkspaces,
  resumeRemoteWorkspace,
} from "./components/remote-repo/remoteRepoWorkspaceApi";
import {
  describeRemoteWorkspaceGraphAction,
  mapGraphStatusToRemoteRepoGitNexusStatus,
} from "./components/remote-repo/remoteRepoWorkspaceResources";
import {
  loadRemoteRepoServiceSetting,
  saveRemoteRepoServiceUrl,
  testRemoteRepoServiceUrl,
  type RemoteRepoServiceSetting,
} from "./components/remote-repo/remoteRepoServiceSettings";
import { RemoteRepoFormDialog, RemoteRepoRemoveDialog, type RemoteRepoFormValues } from "./components/remote-repo/RemoteRepoDialogs";
import { RemoteRepoOverview } from "./components/remote-repo/RemoteRepoOverview";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from "./components/ui/alert-dialog";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "./components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { SidebarProvider } from "./components/ui/sidebar";
import { Skeleton } from "./components/ui/skeleton";
import { Field, FieldLabel, Textarea } from "./components/ui/textarea";
import type { PanelPlacement } from "./layout/Workbench";
import { Workbench } from "./layout/Workbench";
import { parseAgentContextText, parseStatusText } from "./lib/agentContextParser";
import { addRemoteRepo, listRemoteRepoBranches, listRemoteRepoFiles, listRemoteRepos, reloadRemoteRepoConfig, removeRemoteRepo, setRemoteRepoPinned, syncRemoteRepoConnection, touchRemoteRepoAccess, updateRemoteRepo } from "./components/remote-repo/remoteRepoApi";
import type {
  RemoteWorkspaceActivity,
  RemoteWorkspaceSession,
  RemoteWorkspaceSummary,
} from "./components/remote-repo/remoteRepoWorkspaceResources";
import type { RemoteRepo, RemoteRepoAction, RemoteRepoFileTreeStatus, RemoteRepoGitNexusStatus } from "./components/remote-repo/types";
import type { RemoteRepoBranch } from "./components/remote-repo/remoteRepoResources";
import {
  GITTREE_SIDEBAR_WIDTH_CACHE_KEY,
  RIGHT_PANE_WIDTH_CACHE_KEY,
  SIDEBAR_WIDTH_CACHE_KEY,
  getRuntimeLogTail,
  loadCachedRuntimeStatus,
  loadCachedWidth,
  saveCachedRuntimeStatus,
  saveCachedWidth,
  type RuntimeActionJobStatus,
  type RuntimeDepName,
  type RuntimeDependencyStatus,
  type RuntimeRequirementsStatus
} from "./lib/appCache";
import { clamp, makeId, scheduleAfterInteraction, waitForPaint } from "./lib/browserRuntime";
import {
  DEFAULT_CONTROL_SERVER_SETTINGS,
  controlServerSettingsChanged,
  normalizeControlAuthMode,
  normalizeControlPairMode,
  normalizeControlPublicBaseUrl,
  normalizeControlServerSettings,
  resolveControlPairCodeMode,
  type ControlAccessInfo,
  type ControlPairCodeInfo,
  type ControlServerSettings,
  type GiteamMobileServiceStatus
} from "./lib/controlServer";
import {
  markRuntimeFirstCheckCompleted,
  markRuntimeReady,
  setRuntimeSetupDismissed
} from "./lib/desktopPreferences";
import { explainCommit, explainCommitShort } from "./lib/entireAdapter";
import { parseExplainCommit } from "./lib/explainParser";
import {
  getAppText,
  loadGeneralSettings,
  playSettingsTone,
  saveGeneralSettings,
  showSettingsNotification
} from "./lib/generalSettings";
import {
  checkAppUpdate,
  downloadAndInstallAppUpdate,
  getAppVersion,
  parseUpdateKind,
  readLastLaunchedVersion,
  readLastWhatsNew,
  relaunchApp,
  resolveStartupUpdateCelebration,
  splitReleaseNotesIntoSteps,
  writeLastWhatsNew,
  type AppUpdateState,
  type UpdateCelebration
} from "./lib/appUpdater";
import {
  AppUpdateAvailableDialog,
  AppUpdateWhatsNewDialog,
  getAppUpdateDialogText
} from "./components/settings/AppUpdateDialogs";
import { AppUpdateMajorWizard } from "./components/settings/AppUpdateMajorWizard";
import {
  clearRepoTerminalSession,
  closeRepoTerminalSession,
  getCommitChangedFiles,
  getCommitFilePatch,
  getGitWorktreeFileContent,
  getGitWorktreeFilePatch,
  getLocalBranches,
  readRepoTerminalOutput,
  resizeRepoTerminalSession,
  sendRepoTerminalInput,
  startGitWorktreeWatcher,
  startRepoTerminalSession,
  stopGitWorktreeWatcher
} from "./lib/gitAdapter";
import {
  AGENT_ATTACHMENT_INPUT_ACCEPT,
  attachmentsFromLocalPaths,
  encodeFilePathForUrl,
  extractClipboardFilePaths,
  extractTransferFiles,
  fileUrlToPath,
  getAttachmentDataUrlMime,
  hasClipboardFileReference,
  hasPlainClipboardText,
  isOfficeAttachment,
  isAgentSupportedAttachmentMedia,
  mergeUniqueAttachments,
  isImageAttachment,
  pickDesktopAttachments,
  readBrowserClipboardAttachments,
  readDesktopClipboardFilePaths,
  readDesktopClipboardImageAttachment,
  readFileAsAttachment,
  readLocalAttachmentPreview,
  resolveAgentPromptImages,
  type AgentAttachment
} from "./lib/imageAttachments";
import {
  loadLocalBool,
  loadLocalString,
  migrateLocalStoragePrefix,
  saveLocalBool,
  saveLocalString
} from "./lib/localPreferences";
import { type AgentDefinition } from "./lib/agentDefinitions";
import {
  AGENT_COMPOSER_AGENT_OPTIONS,
  clampThinkingLevelToModel,
  composerAgentSessionOptions,
  isComposerAgentName,
  normalizeComposerAgentName,
  normalizeThinkingLevel,
  thinkingLevelMeta,
  thinkingLevelsForModel,
  toPiThinkingLevel,
  type ComposerAgentName,
  type AgentThinkingLevel
} from "./lib/agentComposerSettings";
import {
  buildConfiguredModelCandidates,
  buildSyncModelRefs,
  normalizeModelRef,
  normalizeProviderId,
  parseModelRef,
  resolveProviderAliasWithNames,
} from "./lib/agentModels";
import {
  buildAgentImageAttachmentsFromParts,
  buildAgentMainLineMarkdownFromParts,
  mergeAgentMessageAttachments,
  mergeAgentMessageErrors,
  mergeAgentStreamText,
  pickPreferredAgentContent,
  appendMissingTextPartsToLive,
  livePartsHaveTextPart,
  dedupeAgentDuplicateTextParts,
  readAgentTodosFromPart,
  toDisplayJson
} from "./lib/agentParts";
import {
  type AgentPermissionReply,
  type PermissionInteraction
} from "./lib/agentPermissions";
import {
  applyAgentCatalog,
  buildAgentConfiguredProviderSnapshot,
  buildAgentProviderPickerCandidates,
  getAgentModelDisplayInfo,
  getAgentProviderSource as getAgentProviderSourceFromCatalog,
  getAgentProviderTag as getAgentProviderTagFromCatalog,
  canRemoveAgentCustomProvider,
  isOpenAICompatibleProviderId,
  isOAuthNativeApiLockedProvider,
  isRemovableCustomProviderId,
  normalizeAgentServerProviderState,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  resolveActiveAgentModel,
  type AgentConfigProviderCatalog,
  type AgentModelConfig,
  type AgentProviderAuthMethod,
  type AgentProviderConfig,
  type AgentServerConfig,
  type AgentServerConfigProvider,
  type AgentServerProviderState,
  type AgentServiceSettings
} from "./lib/agentProviderCatalog";
import { PROVIDER_PRESETS, getProviderDisplayName } from "./lib/agentProviders";
import {
  clipAgentSessionTitle,
  compareAgentSessionActivity,
  filterActiveAgentSessionSummaries,
  isPrimaryAgentSessionSummary,
  agentSessionFromSummary,
  modelRefFromChatSession,
  sortAgentSessionSummaries,
  appendAssistantMessage,
  commitUserBeforeLiveAssistant,
  consumeQueuedFollowUp,
  dropQueuedFollowUpsAlreadyInTranscript,
  removeQueuedFollowUpById,
  type AgentChatMessage,
  type AgentQueuedFollowUp,
  type AgentChatSession,
  type AgentDetailedMessage,
  type AgentDetailedPart,
  type AgentMessagePageCacheEntry,
  type ChatSessionSummary,
  type AgentTodoItem,
  mergeHistoryMessagesPreservingLive,
  reconcilePromptTailFromHistory
} from "./lib/agentSessions";
import {
  type AgentSkillInfo,
} from "./lib/agentSkillData";
import {
  createAgentClient,
  type AgentInteraction,
  type AgentInteractionReply,
  type AgentMessage,
  type AgentModelInfo,
  type AgentPart,
  type AgentProviderInfo,
  type AgentSessionSummary,
  type AgentEvent
} from "./lib/agent/client";
import {
  agentProvidersToConfigCatalog,
  agentProvidersToGlobalConfig,
  agentProvidersToServerState
} from "./lib/agent/providerState";
import { extractToolDetails, extractToolOutputText } from "./lib/agent/toolPresentation";
import {
  applySubagentChildEventToPart,
  buildBatchTaskChildPartsFromDetails,
  enrichTaskToolPart,
  extractTaskDescriptionFromParentInput,
  parseIndexedParentToolCallId
} from "./lib/subagentRun";
import { IS_TAURI, invoke, listen } from "./lib/platform";
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
  shareCreate,
  shareImport,
  shareImportCancel,
  listenShareImportProgress,
  isShareImportCancelled,
  type ShareCreateResult,
  type ShareImportProgress,
  type ShareImportResult
} from "./lib/share";
import {
  appendTerminalError,
  createTerminalTabState,
  recordTerminalCommand,
  writeTerminalTabSnapshot,
  type TerminalTabState
} from "./lib/terminalState";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitGraphNode,
  GitLinkedWorktree,
  GitUserIdentity,
  GitWorktreeFileContent,
  GitWorktreeOverview,
  QuestionAnswer,
  QuestionRequest,
  RepositoryEntry,
  ReviewAction,
  ReviewActionType,
  ReviewRecord
} from "./lib/types";

const agentClient = createAgentClient();
import { useAppearanceFontSize } from "./lib/useAppearanceFontSize";
import { useDesktopTheme } from "./lib/useDesktopTheme";
import { useGitWorkspaceController } from "./lib/useGitWorkspaceController";
import { useAgentInstalledSkills } from "./lib/useAgentInstalledSkills";
import { useAgentMessageCache } from "./lib/useAgentMessageCache";
import { useAgentModelSelection } from "./lib/useAgentModelSelection";
import { useAgentModelVisibility } from "./lib/useAgentModelVisibility";
import { shouldUsePromptHistoryKey, useAgentPromptHistory } from "./lib/useAgentPromptHistory";
import { useAgentSkillMarketplace } from "./lib/useAgentSkillMarketplace";
import { usePinnedRepoIds } from "./lib/usePinnedRepoIds";
import { useRightModuleVisibility } from "./lib/useRightModuleVisibility";
import { useTerminalTabs } from "./lib/useTerminalTabs";
import { cn } from "./lib/utils";
import {
  normalizeWorkspacePath,
  readBranchParentMap,
  readWorkspaceAgentBindings,
  readWorktreeParentMap,
  sameRepoPath,
  writeBranchParentMap,
  writeWorkspaceAgentBindings,
  writeWorktreeParentMap,
  type WorkspaceAgentBinding
} from "./lib/workspaceBindings";
import {
  buildWorktreeTree,
  collectWorktreeDirPaths,
  getDiscardableWorktreeEntryCount,
  getWorktreeChangeStats,
  toDiffRows
} from "./lib/worktreeDiff";
import {
  buildTopologyModel,
  pathLeaf,
  shortSha
} from "./lib/worktreeTopology";

type DetailTab = "diff" | "context" | "findings";
type AgentSlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  source: "builtin" | "command" | "skill";
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
        <div className="p-4 font-mono">
          <div className="mb-2 font-semibold">UI crashed</div>
          <pre className="m-0 whitespace-pre-wrap text-destructive">{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
type AgentAuthPayload = { type: "api"; key: string };

function remoteRepoGraphStatusKey(repoId: string, refOrCommit: string): string {
  return `${repoId}::${refOrCommit.trim() || "HEAD"}`;
}

const EMPTY_WORKTREE: GitWorktreeOverview = {
  branch: "",
  tracking: "",
  ahead: 0,
  behind: 0,
  clean: true,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  addedLines: 0,
  deletedLines: 0,
  entries: [],
  raw: ""
};

const EMPTY_GIT_IDENTITY: GitUserIdentity = {
  name: "",
  email: ""
};

const EMPTY_WORKTREE_FILE_CONTENT: GitWorktreeFileContent = {
  original: "",
  modified: "",
  previewSupported: true,
  previewReason: undefined,
  previewKind: "text",
  mime: "text/plain",
  dataBase64: undefined
};

const WORKTREE_DIFF_STREAM_BATCH_SIZE = 10;
const WORKTREE_DIFF_STREAM_PRELOAD_SIZE = 10;
const WORKTREE_DIFF_STREAM_INITIAL_LOAD = WORKTREE_DIFF_STREAM_BATCH_SIZE + WORKTREE_DIFF_STREAM_PRELOAD_SIZE;

const RUNTIME_FIRST_CHECK_KEY = "giteam.runtime.first-check.v1";
const MACOS_RUNTIME_BOOTSTRAP_NAME = "runtime";

/** 启动屏最小展示时长：避免数据过快就绪导致闪一下即消失。 */
const SPLASH_MIN_DISPLAY_MS = 600;
/** 启动屏兜底时长：启动链路挂起时强制放行，避免永久遮挡界面。 */
const SPLASH_MAX_DISPLAY_MS = 8000;
const AGENT_MODEL_VIS_KEY = "giteam.agent.model-visibility.v1";
const AGENT_MODEL_ENABLE_KEY = "giteam.agent.model-enabled.v1";
const AGENT_MODEL_SELECTION_KEY = "giteam.agent.model-selection.v2";
const AGENT_SESSION_PAGE_SIZE = 3;
const AGENT_SIDEBAR_SESSION_POLL_MS = 45000;
const AGENT_BOOTSTRAP_RETRY_DELAYS_MS = [400, 1200, 2500, 4500, 8000];
const AGENT_INITIAL_MESSAGE_FETCH_LIMIT = 80;
const AGENT_OLDER_MESSAGE_FETCH_LIMIT = 8;
// 与 macOS traffic light 视觉中心对齐：x=14 起算三色宽约 54，折叠钮紧跟其后。
const TITLEBAR_LEFT_TOGGLE_X = 80;
const DRAG_REGION_INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='true']",
  "[data-tauri-no-drag]",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='slider']",
  "[role='switch']",
  "[role='tab']"
].join(",");
const AGENT_COMPOSER_SELECTION_KEY = "giteam.agent.composer-agent.v1";
const AGENT_THINKING_SELECTION_KEY = "giteam.agent.thinking-selection.v1";
const AGENT_AUTO_ACCEPT_PERMISSIONS_KEY = "giteam.agent.auto-accept-permissions.v1";

// One-time migration from pre-Pi localStorage keys.
migrateLocalStoragePrefix("giteam.opencode.model-visibility.v1", AGENT_MODEL_VIS_KEY);
migrateLocalStoragePrefix("giteam.opencode.model-enabled.v1", AGENT_MODEL_ENABLE_KEY);
migrateLocalStoragePrefix("giteam.opencode.model-selection.v1", AGENT_MODEL_SELECTION_KEY);
migrateLocalStoragePrefix("giteam.agent.model-selection.v1", AGENT_MODEL_SELECTION_KEY);
migrateLocalStoragePrefix("giteam.opencode.agent-selection.v1", AGENT_COMPOSER_SELECTION_KEY);
migrateLocalStoragePrefix("giteam.opencode.thinking-selection.v1", AGENT_THINKING_SELECTION_KEY);
migrateLocalStoragePrefix("giteam.opencode.auto-accept-permissions.v1", AGENT_AUTO_ACCEPT_PERMISSIONS_KEY);
const GENERAL_SETTINGS_KEY = "giteam.settings.general.v1";
const SKILLSMP_API_KEY_STORAGE_KEY = "giteam.skillsmp.api-key.v1";

function agentPartText(part: AgentPart): string {
  if (part.type === "text") {
    // 与渲染层 detailParts 重分类（见 AgentMessageStream）同源：reasoning 流曾被误标成 text
    // （运行时 id 为 reasoning/reasoning:xxx），渲染时改回 reasoning 并剥离出正文。
    // content 也必须排除它，否则搜索/ fallback 会把思考过程当成可命中文本，
    // 与消息流里实际看到的可见正文不一致（表现为「搜索定位到了思考内容里」）。
    const id = String((part as { id?: unknown }).id || "").trim();
    if (id === "reasoning" || id.startsWith("reasoning:")) return "";
    return part.text;
  }
  // reasoning/toolCall 都不拼入正文：它们走时间线（ReasoningGroup/工具卡片）渲染，
  // 拼进 content 会在详情 parts 缺失时把过程信息当成回答文本显示。
  if (part.type === "toolResult") return part.isError ? `\n\n工具失败：${part.toolName}` : "";
  return "";
}

/** 构造 pi 原生形状的工具 part（参考 super_agent_mobile：不套 opencode 模型，
 * input 保留 pi 原始参数名（path/oldText/newText/pattern/command），
 * output 提取为文本、details 保留 pi 原始结构，渲染层用 toolPresentation
 * 纯函数直接解析）。 */
function buildToolPart(options: {
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "error";
  input?: unknown;
  output?: unknown;
}): AgentDetailedPart {
  const part: AgentDetailedPart = {
    id: options.toolCallId,
    type: "toolCall",
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    status: options.status
  };
  // 缺省字段不写 key：upsert 浅合并时保留先前事件写入的值
  // （tool.completed 不带 input，不能覆盖 tool.started 的 input）。
  if (options.input !== undefined) part.input = options.input;
  if (options.output !== undefined) {
    part.output = extractToolOutputText(options.output);
    const details = extractToolDetails(options.output);
    if (details) part.details = details;
  }
  if (options.status === "error") part.isError = true;
  if (options.toolName === "task") return enrichTaskToolPart(part);
  return part;
}

function mergeCompletedUserChatMessage(
  mapped: AgentChatMessage,
  previous?: AgentChatMessage
): AgentChatMessage {
  const display = normalizeUserMessageForDisplay(mapped, previous);
  return {
    ...mapped,
    content: display.content,
    graphRefs: display.graphRefs,
    attachments: previous?.attachments || mapped.attachments
  };
}

function agentMessageToChatMessage(message: AgentMessage): AgentChatMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const rawContent = message.parts.map(agentPartText).join("");
  let content = rawContent;
  let graphRefs: GraphContextRef[] | undefined;
  if (message.role === "user") {
    // Pi messages() 在压缩点注入 synthetic user 摘要；事件流不会推该气泡，history 对账需跳过。
    if (isCompactionSummaryUserText(rawContent)) return null;
    const normalized = normalizeUserMessageForDisplay({ content: rawContent });
    content = normalized.content;
    graphRefs = normalized.graphRefs;
  }
  const images = message.parts
    .filter((part): part is Extract<AgentPart, { type: "image" }> => part.type === "image")
    .map((part, index) => ({
      id: `${message.id}-image-${index}`,
      kind: "image" as const,
      uri: `data:${part.mimeType};base64,${part.data}`,
      mime: part.mimeType,
      filename: undefined
    }));
  return {
    id: message.id,
    role: message.role,
    content,
    graphRefs,
    attachments: images.length > 0 ? images : undefined
  };
}

function agentSummaryToChatSummary(summary: AgentSessionSummary): ChatSessionSummary {
  const updatedAt = summary.updatedAtMs > 0 ? summary.updatedAtMs : Date.now();
  const parentId = String(summary.parentSessionId || "").trim();
  const provider = String(summary.provider || "").trim();
  const model = String(summary.model || "").trim();
  const sessionKind = String(summary.sessionKind || "").trim();
  return {
    id: summary.sessionId,
    // 标题来自后端派生的首条用户消息摘要；空会话回退 id 前缀。
    title: String(summary.title || "").trim() || `Session ${summary.sessionId.slice(0, 8)}`,
    createdAt: updatedAt,
    updatedAt,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(parentId ? { parentId } : {}),
    ...(sessionKind ? { sessionKind } : {})
  };
}

function modelRefFromAgentSummary(summary: Pick<AgentSessionSummary, "provider" | "model">): string {
  return normalizeModelRef(`${String(summary.provider || "").trim()}/${String(summary.model || "").trim()}`);
}


/** 收集会话内全部 ToolResult（pi 中它是独立的 tool 角色消息），按 toolCallId 索引，
 * 供 assistant 消息的 toolCall part 合并 output/error。 */
function agentToolResultsByCallId(agentMessages: AgentMessage[]): Map<string, Extract<AgentPart, { type: "toolResult" }>> {
  const map = new Map<string, Extract<AgentPart, { type: "toolResult" }>>();
  for (const message of agentMessages) {
    for (const part of message.parts) {
      if (part.type === "toolResult" && part.toolCallId) map.set(part.toolCallId, part);
    }
  }
  return map;
}

/** AgentMessage → 渲染层详情模型（AgentDetailedMessage），pi 数据唯一适配点。 */
function agentMessageToDetailedMessage(
  message: AgentMessage,
  toolResults?: Map<string, Extract<AgentPart, { type: "toolResult" }>>
): AgentDetailedMessage {
  const detailParts: AgentDetailedPart[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "text") detailParts.push({ id: message.id + "-text-" + index, type: "text", text: part.text });
    else if (part.type === "reasoning") detailParts.push({ id: message.id + "-reasoning-" + index, type: "reasoning", text: part.text });
    else if (part.type === "redactedReasoning") detailParts.push({ id: message.id + "-reasoning-" + index, type: "reasoning", redacted: true });
    else if (part.type === "image") detailParts.push({ id: message.id + "-image-" + index, type: "file", mime: part.mimeType, url: "data:" + part.mimeType + ";base64," + part.data });
    else if (part.type === "toolCall") {
      // toolResult 在 pi 中是另一条消息，这里按 toolCallId 合并回工具卡片。
      const result = toolResults?.get(part.toolCallId);
      detailParts.push(buildToolPart({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        status: result ? (result.isError ? "error" : "completed") : "completed",
        input: part.input,
        output: result?.output
      }));
    }
    // toolResult 不单独渲染（已合并进对应 toolCall 卡片）。
    else if (part.type === "custom") detailParts.push({ id: message.id + "-custom-" + index, type: "custom", customType: part.customType, content: part.content, details: part.details });
  });
  return {
    info: {
      id: message.id,
      role: message.role,
      time: { created: message.createdAtMs }
    },
    parts: detailParts
  };
}

/** 子会话 messages → 嵌套 timeline（跳过 todowrite）。 */
function buildTaskTimelineFromChildMessages(messages: AgentMessage[]): AgentDetailedPart[] {
  const toolResults = agentToolResultsByCallId(messages);
  const timeline: AgentDetailedPart[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "toolCall" || !part.toolCallId) continue;
      if (String(part.toolName || "").trim() === "todowrite") continue;
      const result = toolResults.get(part.toolCallId);
      timeline.push(
        buildToolPart({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: result ? (result.isError ? "error" : "completed") : "completed",
          input: part.input,
          output: result?.output
        })
      );
    }
  }
  return timeline;
}

/**
 * 冷启动：用 catalog 子会话回填 task 的 childSessionId / timeline。
 * abort 时父 JSONL 往往没有 details.childSessionId，导致 UI 把卡滤空。
 */
async function hydrateTaskPartsFromChildSessions(
  parentSessionId: string,
  detailsById: Record<string, AgentDetailedMessage>
): Promise<Record<string, AgentDetailedMessage>> {
  let children: AgentSessionSummary[] = [];
  try {
    children = await agentClient.listChildSessions(parentSessionId);
  } catch {
    return detailsById;
  }
  if (!children.length) return detailsById;

  const byToolCallId = new Map<string, AgentSessionSummary>();
  for (const child of children) {
    const toolCallId = String(child.parentToolCallId || "").trim();
    if (!toolCallId) continue;
    // 同 toolCall 多次 spawn 时保留最新（updatedAtMs 更大）。
    const existing = byToolCallId.get(toolCallId);
    if (!existing || Number(child.updatedAtMs || 0) >= Number(existing.updatedAtMs || 0)) {
      byToolCallId.set(toolCallId, child);
    }
  }
  if (byToolCallId.size === 0) return detailsById;

  const timelineCache = new Map<string, AgentDetailedPart[]>();
  const loadTimeline = async (childSessionId: string): Promise<AgentDetailedPart[]> => {
    const cached = timelineCache.get(childSessionId);
    if (cached) return cached;
    try {
      const messages = await agentClient.getMessages(childSessionId);
      const timeline = buildTaskTimelineFromChildMessages(messages);
      timelineCache.set(childSessionId, timeline);
      return timeline;
    } catch {
      timelineCache.set(childSessionId, []);
      return [];
    }
  };

  const next: Record<string, AgentDetailedMessage> = { ...detailsById };
  for (const [messageId, detail] of Object.entries(detailsById)) {
    const parts = Array.isArray(detail.parts) ? detail.parts : [];
    let changed = false;
    const nextParts: AgentDetailedPart[] = [];
    for (const part of parts) {
      if (String((part as { toolName?: string }).toolName || "").trim() !== "task") {
        nextParts.push(part);
        continue;
      }
      const toolCallId = String(
        (part as { toolCallId?: string }).toolCallId || (part as { id?: string }).id || ""
      ).trim();
      const child = toolCallId ? byToolCallId.get(toolCallId) : undefined;
      if (!child) {
        nextParts.push(enrichTaskToolPart(part));
        continue;
      }
      const existingChild = String((part as { childSessionId?: string }).childSessionId || "").trim();
      const existingTimeline = Array.isArray((part as { timeline?: AgentDetailedPart[] }).timeline)
        ? (part as { timeline: AgentDetailedPart[] }).timeline
        : [];
      const childSessionId = existingChild || String(child.sessionId || "").trim();
      let timeline = existingTimeline;
      if (childSessionId && timeline.length === 0) {
        timeline = await loadTimeline(childSessionId);
      }
      const enriched = enrichTaskToolPart({
        ...part,
        childSessionId,
        toolCount: Number((part as { toolCount?: number }).toolCount || 0) || timeline.length,
        timeline,
        subagentStatus:
          String((part as { subagentStatus?: string }).subagentStatus || "").trim()
          || (Boolean((part as { isError?: boolean }).isError) ? "aborted" : "completed")
      });
      nextParts.push(enriched);
      changed = true;
    }
    // 批并行父 task：history 往往只有父 toolCall + details.tasks，没有 parent:index 子卡。
    // 冷加载时从 details 补齐终态，避免 UI 只剩父壳或误标中断。
    const existingIds = new Set(
      nextParts.map((part) =>
        String((part as { toolCallId?: string }).toolCallId || (part as { id?: string }).id || "").trim()
      ).filter(Boolean)
    );
    for (const part of nextParts.slice()) {
      if (String((part as { toolName?: string }).toolName || "").trim() !== "task") continue;
      const toolCallId = String(
        (part as { toolCallId?: string }).toolCallId || (part as { id?: string }).id || ""
      ).trim();
      if (!toolCallId || toolCallId.includes(":")) continue;
      const details = (part as { details?: unknown }).details;
      const children = buildBatchTaskChildPartsFromDetails(toolCallId, details, nextParts);
      for (const child of children) {
        const childId = String(
          (child as { toolCallId?: string }).toolCallId || (child as { id?: string }).id || ""
        ).trim();
        if (!childId || existingIds.has(childId)) continue;
        nextParts.push(child);
        existingIds.add(childId);
        changed = true;
      }
    }
    if (changed) {
      next[messageId] = { ...detail, parts: nextParts };
    }
  }
  return next;
}

type TauriDragWindow = {
  startDragging?: () => Promise<void> | void;
};

function useTauriDragRegions() {
  const windowRef = useRef<TauriDragWindow | null>(null);

  useEffect(() => {
    if (!IS_TAURI) return undefined;

    let disposed = false;

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        if (!disposed) windowRef.current = getCurrentWindow() as TauriDragWindow;
      })
      .catch(() => {
        windowRef.current = null;
      });

    const onPointerDown = (event: PointerEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const region = target.closest("[data-tauri-drag-region]");
      if (!region || target.closest(DRAG_REGION_INTERACTIVE_SELECTOR)) return;

      event.preventDefault();
      void windowRef.current?.startDragging?.();
    };

    window.addEventListener("pointerdown", onPointerDown, { capture: true });

    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, []);
}

function FloatingContextMenu({
  children,
  contentClassName,
  onOpenChange,
  open,
  x,
  y
}: {
  children: ReactNode;
  contentClassName?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  x: number;
  y: number;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="fixed size-px opacity-0"
          style={{ left: x, top: y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={contentClassName} side="right" sideOffset={0}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function App() {
  useTauriDragRegions();
  const [theme, toggleTheme] = useDesktopTheme();
  const [pinnedRepoIds, togglePinnedRepo] = usePinnedRepoIds();
  const { uiZoom, codeFontSize, setUiZoom, setCodeFontSize } = useAppearanceFontSize();
  const [agentPreviewImage, setAgentPreviewImage] = useState<{ images: Array<{ uri: string; filename?: string }>; index: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"general" | "appearance" | "modules" | "plugins" | "mobile" | "models" | "skillsmp">("general");
  const [settingsMobileVisible, setSettingsMobileVisible] = useState(false);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsDraft>(() => (
    loadGeneralSettings(GENERAL_SETTINGS_KEY, AGENT_AUTO_ACCEPT_PERMISSIONS_KEY)
  ));
  const appText = useMemo(() => getAppText(generalSettings.language), [generalSettings.language]);
  const updateDialogText = useMemo(
    () => getAppUpdateDialogText(generalSettings.language),
    [generalSettings.language]
  );
  const [showMobileControlDialog, setShowMobileControlDialog] = useState(false);
  const [showMobilePairQr, setShowMobilePairQr] = useState(false);
  const [mobileClientConnected, setMobileClientConnected] = useState(false);
  const [showAgentApiDialog, setShowAgentApiDialog] = useState(false);
  const [showEnvSetup, setShowEnvSetup] = useState(false);
  const [runtimeStartupChecking, setRuntimeStartupChecking] = useState(true);
  // 启动屏：等待首批仓库列表与运行时检测就绪后淡出。
  const [reposLoaded, setReposLoaded] = useState(false);
  // agent 工作区 bootstrap 首轮完成（会话已选中/已进入草稿态），供启动屏判定。
  const [agentBootstrapSettled, setAgentBootstrapSettled] = useState(false);
  const splashShownAtRef = useRef(Date.now());
  const [sidebarWidth, setSidebarWidth] = useState(() => loadCachedWidth(SIDEBAR_WIDTH_CACHE_KEY, 304, 292, 340));
  const [rightPaneWidth, setRightPaneWidth] = useState(() => loadCachedWidth(RIGHT_PANE_WIDTH_CACHE_KEY, 520, 520, 1120));
  const [changesSidebarWidth, setChangesSidebarWidth] = useState(276);
  const [gitTreeSidebarSize, setGitTreeSidebarSize] = useState(() => loadCachedWidth(GITTREE_SIDEBAR_WIDTH_CACHE_KEY, 34, 24, 48));
  // 小屏(视口 <1280)默认折叠左侧栏，把空间让给内容区；大屏保持展开。
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1280
  );
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const panelPlacement: PanelPlacement = rightDrawerOpen ? "right" : "hidden";
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [draggingSplit, setDraggingSplit] = useState<null | {
    kind: "sidebar" | "right" | "changes";
    startX: number;
    startWidth: number;
  }>(null);
  const [repoContextMenu, setRepoContextMenu] = useState<{ x: number; y: number; repo: RepositoryEntry } | null>(null);
  const [sessionContextMenu, setSessionContextMenu] = useState<{ x: number; y: number; repo: RepositoryEntry; session: AgentChatSession } | null>(null);
  const [composerContextMenu, setComposerContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [commitContextMenu, setCommitContextMenu] = useState<{ x: number; y: number; sha: string; branch?: string; subject?: string } | null>(null);
  const [commitHoverCard, setCommitHoverCard] = useState<{ x: number; y: number; sha: string; subject?: string; author?: string; date?: string; branch?: string } | null>(null);
  const [topologyContextMenu, setTopologyContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [topologyCreateSourceNodeId, setTopologyCreateSourceNodeId] = useState("");
  const [topologyInspectNodeId, setTopologyInspectNodeId] = useState("");
  const [selectedWorktreePath, setSelectedWorktreePath] = useState("");

  // Panel is fused into the center reading area.

  const [repos, setRepos] = useState<RepositoryEntry[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepositoryEntry | null>(null);
  const [remoteRepos, setRemoteRepos] = useState<RemoteRepo[]>([]);
  const [remoteRepoBranches, setRemoteRepoBranches] = useState<Record<string, RemoteRepoBranch[]>>({});
  const [remoteRepoBranchErrors, setRemoteRepoBranchErrors] = useState<Record<string, string>>({});
  const [remoteRepoBranchesLoading, setRemoteRepoBranchesLoading] = useState<Record<string, boolean>>({});
  const [remoteRepoSelectedRefs, setRemoteRepoSelectedRefs] = useState<Record<string, string>>({});
  const [remoteRepoGitNexusStatuses, setRemoteRepoGitNexusStatuses] = useState<Record<string, RemoteRepoGitNexusStatus>>({});
  const [remoteRepoGitNexusBusyKey, setRemoteRepoGitNexusBusyKey] = useState("");
  const [remoteRepoFileTreeStatuses, setRemoteRepoFileTreeStatuses] = useState<Record<string, RemoteRepoFileTreeStatus>>({});
  const [remoteRepoWorkspaces, setRemoteRepoWorkspaces] = useState<Record<string, RemoteWorkspaceSummary[]>>({});
  const [remoteRepoActivities, setRemoteRepoActivities] = useState<Record<string, RemoteWorkspaceActivity[]>>({});
  const [activeRemoteWorkspaceSession, setActiveRemoteWorkspaceSession] = useState<RemoteWorkspaceSession | null>(null);
  const [remoteRepoServiceSetting, setRemoteRepoServiceSetting] = useState<RemoteRepoServiceSetting>({
    configuredUrl: "",
    effectiveUrl: "/remote-repo-service",
    apiKey: "",
    apiKeyConfigured: false,
    source: "proxy",
  });
  const [remoteRepoServiceDraft, setRemoteRepoServiceDraft] = useState("");
  const [remoteRepoServiceApiKeyDraft, setRemoteRepoServiceApiKeyDraft] = useState("");
  const [remoteRepoServiceBusy, setRemoteRepoServiceBusy] = useState(false);
  const [remoteRepoServiceNotice, setRemoteRepoServiceNotice] = useState("");
  const [selectedRemoteRepoId, setSelectedRemoteRepoId] = useState("");
  const [remoteRepoResourceMode, setRemoteRepoResourceMode] = useState<"branches" | "files" | "workspace" | null>(null);
  const [remoteRepoNotice, setRemoteRepoNotice] = useState("");
  const [remoteRepoLoading, setRemoteRepoLoading] = useState(false);
  const [remoteRepoLoadError, setRemoteRepoLoadError] = useState("");
  const [remoteRepoFormTarget, setRemoteRepoFormTarget] = useState<RemoteRepo | null | undefined>(undefined);
  const [remoteRepoMutationBusy, setRemoteRepoMutationBusy] = useState(false);
  const [remoteRepoMutationError, setRemoteRepoMutationError] = useState("");
  const [remoteRepoPendingRemoval, setRemoteRepoPendingRemoval] = useState<RemoteRepo | null>(null);
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
  const [worktreePatchByPath, setWorktreePatchByPath] = useState<Record<string, string>>({});
  const [worktreePatchLoadLimit, setWorktreePatchLoadLimit] = useState(WORKTREE_DIFF_STREAM_INITIAL_LOAD);
  const [selectedWorktreeContent, setSelectedWorktreeContent] = useState<GitWorktreeFileContent>(EMPTY_WORKTREE_FILE_CONTENT);
  const [selectedWorktreeLine, setSelectedWorktreeLine] = useState<number | undefined>(undefined);
  const [selectedWorktreeViewMode, setSelectedWorktreeViewMode] = useState<"auto" | "editor" | "diff">("auto");
  const [selectedAttachmentPreviewPath, setSelectedAttachmentPreviewPath] = useState("");
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
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>(PINNED_RIGHT_PANE_TAB);
  const [mainMode, setMainMode] = useState<"agent" | "automation">("agent");
  const [browserPaneUrl, setBrowserPaneUrl] = useState("");
  const [rightOptionalTabs, setRightOptionalTabs] = useState<OptionalRightPaneTab[]>([]);
  const rightOpenTabs = useMemo(
    (): RightPaneTab[] => [PINNED_RIGHT_PANE_TAB, ...rightOptionalTabs],
    [rightOptionalTabs]
  );
  const { rightModuleVisibility, setRightModuleVisibility, toggleRightModuleVisibility } = useRightModuleVisibility(rightPaneTab, setRightPaneTab);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitDialogAction, setCommitDialogAction] = useState<"commit" | "commitPush" | "commitSync" | null>(null);
  const [commitDialogSubmitting, setCommitDialogSubmitting] = useState(false);
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
  const [shareBusyRepoId, setShareBusyRepoId] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<{ repoName: string; result: ShareCreateResult } | null>(null);
  const [shareError, setShareError] = useState("");
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [addProjectStep, setAddProjectStep] = useState<"type" | "local" | "remote">("type");
  const [addProjectSource, setAddProjectSource] = useState<"local" | "remote">("local");
  const [addProjectName, setAddProjectName] = useState("");
  const [addProjectLocalPath, setAddProjectLocalPath] = useState("");
  const [addProjectTargetPath, setAddProjectTargetPath] = useState("");
  const [addProjectShareUrl, setAddProjectShareUrl] = useState("");
  const [shareImportBusy, setShareImportBusy] = useState(false);
  const [shareImportProgress, setShareImportProgress] = useState<ShareImportProgress | null>(null);
  const [shareImportResult, setShareImportResult] = useState<ShareImportResult | null>(null);
  const [shareImportError, setShareImportError] = useState("");
  const [addProjectBusy, setAddProjectBusy] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [runtimeChecking, setRuntimeChecking] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState>({ status: "idle" });
  const [updateAvailablePrompt, setUpdateAvailablePrompt] = useState<{
    currentVersion: string;
    version: string;
    notes: string;
  } | null>(null);
  const [updateCelebration, setUpdateCelebration] = useState<UpdateCelebration | null>(null);
  // 内容丰富的更新（release notes 能切出 ≥2 个章节）走全屏分步向导，否则用提示窗。
  // 不再用 semver kind 判定：「查看更新内容」入口在 dev / 同版本场景下 fromVersion 会退化为「—」，
  // parseUpdateKind 随即误判 patch；而「内容多 = 大更新」本就是直观感知，章节数是更可靠的信号。
  const showUpdateWizard = useMemo(
    () =>
      Boolean(updateCelebration) &&
      splitReleaseNotesIntoSteps(updateCelebration?.notes || "").length >= 2,
    [updateCelebration]
  );
  // 「关于」页「查看更新内容」入口：优先用持久化的最近更新说明；没有缓存（dev/首次安装）
  // 时仅在 latest.json 仍对应当前运行版本时拉取，避免下次发版后被新 notes 顶替。
  const reopenUpdateCelebration = useCallback(async () => {
    const from = readLastLaunchedVersion();
    // 1) 离线缓存优先：真实更新后即时、有完整说明，下次发版后仍能看本次内容。
    const last = readLastWhatsNew();
    if (last && String(last.notes || "").trim()) {
      setShowSettings(false);
      setUpdateCelebration(last);
      return;
    }
    if (!appVersion || appVersion === "web") return;
    // 2) 无缓存（dev / 首次安装）：Rust 侧拉取最新版 release notes，绕开 webview CORS。
    let notes = "";
    let toVersion = appVersion;
    if (IS_TAURI) {
      try {
        const release = await invoke<{ version: string; notes: string } | null>("fetch_latest_release");
        // 只采纳「仍是当前运行版本」的 latest，防止下一次发布覆盖本次说明的展示。
        if (release && (!release.version || release.version === appVersion)) {
          notes = release.notes;
          toVersion = release.version || appVersion;
        }
      } catch {
        // 网络/解析失败：退化为空骨架。
      }
    }
    // WhatsNew 弹窗与设置同为 Radix Dialog、同 z-index，且在 JSX 中先于设置渲染会被遮挡，
    // 故拉取完成后再关闭设置，让更新内容弹窗独占显示。
    setShowSettings(false);
    const sameVersion = toVersion === appVersion;
    const celebration: UpdateCelebration = {
      // 拿不到真实旧版本（dev / 同版本 / 无启动记录）时回退当前版本，避免左栏显示「—」；
      // from===to 时由 UI（向导 / VersionPath）退化为单版本展示。
      fromVersion: sameVersion ? (from && from !== appVersion ? from : appVersion) : appVersion,
      toVersion,
      notes,
      kind: parseUpdateKind(sameVersion ? (from || "") : appVersion, toVersion)
    };
    if (String(notes || "").trim()) writeLastWhatsNew(celebration);
    setUpdateCelebration(celebration);
  }, [appVersion]);
  const installInFlightGuard = useRef(false);
  const installAppUpdateNow = useCallback(
    async (available: { currentVersion: string; version: string; notes: string }) => {
      if (installInFlightGuard.current) return;
      installInFlightGuard.current = true;
      setUpdateAvailablePrompt(null);
      setAppUpdateState({
        status: "downloading",
        currentVersion: available.currentVersion,
        version: available.version,
        notes: available.notes,
        progress: 0
      });
      try {
        const next = await downloadAndInstallAppUpdate((progress) => {
          setAppUpdateState((prev) =>
            prev.status === "downloading" ? { ...prev, progress } : prev
          );
        });
        setAppUpdateState(next);
        if (next.status === "ready") {
          await relaunchApp();
        }
      } finally {
        installInFlightGuard.current = false;
      }
    },
    []
  );
  const [checkingDeps, setCheckingDeps] = useState<Record<RuntimeDepName, boolean>>({
    git: false,
    entire: false,
    giteam: false
  });
  const [installingDep, setInstallingDep] = useState("");
  const [installingElapsed, setInstallingElapsed] = useState(0);
  const [runtimeJobId, setRuntimeJobId] = useState("");
  const [runtimeJob, setRuntimeJob] = useState<RuntimeActionJobStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeRequirementsStatus>(() => loadCachedRuntimeStatus());
  const [runtimeInstallLog, setRuntimeInstallLog] = useState("");
  const [agentProviders, setAgentProviders] = useState<string[]>([]);
  const [agentConnectedProviders, setAgentConnectedProviders] = useState<string[]>([]);
  const [agentConfiguredProviders, setAgentConfiguredProviders] = useState<string[]>([]);
  const [agentProviderNames, setAgentProviderNames] = useState<Record<string, string>>({});
  const [agentProviderSourceById, setAgentProviderSourceById] = useState<Record<string, string>>({});
  const [agentModelsByProvider, setAgentModelsByProvider] = useState<Record<string, string[]>>({});
  const [agentModelInfoByRef, setAgentModelInfoByRef] = useState<Record<string, AgentModelInfo>>({});
  const [agentModelNamesByProvider, setAgentModelNamesByProvider] = useState<Record<string, Record<string, string>>>({});
  const [agentConfiguredModelsByProvider, setAgentConfiguredModelsByProvider] = useState<Record<string, string[]>>({});
  const [agentConfiguredModelNamesByProvider, setAgentConfiguredModelNamesByProvider] = useState<Record<string, Record<string, string>>>({});
  const [agentGlobalConfigProviderMap, setAgentGlobalConfigProviderMap] = useState<Record<string, AgentServerConfigProvider>>({});
  const [agentDisabledProviders, setAgentDisabledProviders] = useState<string[]>([]);
  const [agentCatalogLoading, setAgentCatalogLoading] = useState(false);
  const [agentModelProvider, setAgentModelProvider] = useState("");
  const [agentSelectedModel, setAgentSelectedModel] = useState("");
  const {
    savedModels: agentSavedModels,
    draftModel: agentDraftModel,
    rememberSavedModel: rememberAgentSavedModel,
    selectDraftModel: selectAgentDraftModel
  } = useAgentModelSelection(`${AGENT_MODEL_SELECTION_KEY}:global`);
  const [showAgentModelPicker, setShowAgentModelPicker] = useState(false);
  const [agentModelPickerSearch, setAgentModelPickerSearch] = useState("");
  const [showAgentProviderPicker, setShowAgentProviderPicker] = useState(false);
  const [agentProviderPickerSearch, setAgentProviderPickerSearch] = useState("");
  const [agentProviderPickerProvider, setAgentProviderPickerProvider] = useState("");
  const [agentProviderPickerModelSearch, setAgentProviderPickerModelSearch] = useState("");
  const [showAgentCustomProvider, setShowAgentCustomProvider] = useState(false);
  const [agentConnectProviderId, setAgentConnectProviderId] = useState("");
  const [agentConnectProviderName, setAgentConnectProviderName] = useState("");
  const [agentConnectApiKey, setAgentConnectApiKey] = useState("");
  const [agentConnectBaseUrl, setAgentConnectBaseUrl] = useState("");
  const [agentConnectCustomName, setAgentConnectCustomName] = useState("");
  const [showAgentAuthDialogFor, setShowAgentAuthDialogFor] = useState("");
  const [agentProviderActionMenuFor, setAgentProviderActionMenuFor] = useState("");
  const [agentInlineAuthOpenFor, setAgentInlineAuthOpenFor] = useState("");
  const [agentConnectBusy, setAgentConnectBusy] = useState(false);
  const [agentDisconnectingProvider, setAgentDisconnectingProvider] = useState("");
  const [agentProviderAuthCache, setAgentProviderAuthCache] = useState<Record<string, AgentProviderAuthMethod[]>>({});
  const {
    hiddenModels: agentHiddenModels,
    enabledModels: agentEnabledModels,
    hideModel: hideAgentModel,
    enableModel: enableAgentModel,
    applyMobileModelVisibility: applyAgentModelVisibility
  } = useAgentModelVisibility({
    hidden: `${AGENT_MODEL_VIS_KEY}:global`,
    enabled: `${AGENT_MODEL_ENABLE_KEY}:global`
  });
  const [agentConfig, setAgentConfig] = useState<AgentModelConfig | null>(null);
  const [agentConfigBusy, setAgentConfigBusy] = useState(false);
  const [agentServiceSettings, setAgentServiceSettings] = useState<AgentServiceSettings>({
    port: 4098
  });
  const [agentServiceSettingsSavedPort, setAgentServiceSettingsSavedPort] = useState(4098);
  const [agentServiceSettingsBusy, setAgentServiceSettingsBusy] = useState(false);
  const [controlServerSettings, setControlServerSettings] = useState<ControlServerSettings>(DEFAULT_CONTROL_SERVER_SETTINGS);
  const [controlServerSettingsSaved, setControlServerSettingsSaved] = useState<ControlServerSettings>(DEFAULT_CONTROL_SERVER_SETTINGS);
  const [controlServerSettingsBusy, setControlServerSettingsBusy] = useState(false);
  const [controlPairCodeInfo, setControlPairCodeInfo] = useState<ControlPairCodeInfo | null>(null);
  const [controlAccessInfo, setControlAccessInfo] = useState<ControlAccessInfo | null>(null);
  const [controlPairQrUrl, setControlPairQrUrl] = useState("");
  const [controlSettingsLoaded, setControlSettingsLoaded] = useState(false);
  const controlSettingsDirty = controlServerSettingsChanged(controlServerSettings, controlServerSettingsSaved);
  const [mobileServiceStatus, setMobileServiceStatus] = useState<GiteamMobileServiceStatus | null>(null);
  const [mobileServiceStatusError, setMobileServiceStatusError] = useState("");

  const [agentProviderConfigBusy, setAgentProviderConfigBusy] = useState(false);
  const [agentPromptInput, setAgentPromptInput] = useState("");
  const [agentImageAttachments, setAgentImageAttachments] = useState<AgentAttachment[]>([]);
  const [agentGraphContextRefs, setAgentGraphContextRefs] = useState<GraphContextRef[]>([]);
  const [agentAttachmentMenuOpen, setAgentAttachmentMenuOpen] = useState(false);
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinition[]>([]);
  const [agentDefinitionsLoading, setAgentDefinitionsLoading] = useState(false);
  const [agentDefinitionsError, setAgentDefinitionsError] = useState("");
  const [agentAgentSearch, setAgentAgentSearch] = useState("");
  const [agentDraftAgent, setAgentDraftAgent] = useState<ComposerAgentName>(() => normalizeComposerAgentName(loadLocalString(AGENT_COMPOSER_SELECTION_KEY, "build")));
  const [agentSessionAgent, setAgentSessionAgent] = useState<Record<string, string>>({});
  const [showAgentThinkingPicker, setShowAgentThinkingPicker] = useState(false);
  const [agentDraftThinkingLevel, setAgentDraftThinkingLevel] = useState<AgentThinkingLevel>(() => normalizeThinkingLevel(loadLocalString(AGENT_THINKING_SELECTION_KEY, "auto")));
  const [agentSessionThinkingLevel, setAgentSessionThinkingLevel] = useState<Record<string, AgentThinkingLevel>>({});
  const [agentAutoAcceptPermissions, setAgentAutoAcceptPermissions] = useState(() => loadLocalBool(AGENT_AUTO_ACCEPT_PERMISSIONS_KEY, false));
  const [agentPermissionLoading, setAgentPermissionLoading] = useState(false);
  const [showAgentModulePanel, setShowAgentModulePanel] = useState(false);
  const [agentModuleTab, setAgentModuleTab] = useState<AgentModuleTab>("permissions");
  const agentSkillsVisible = rightPaneTab === "skills" || (showAgentModulePanel && agentModuleTab === "skills");
  const [skillsmpApiKey, setSkillsmpApiKey] = useState(() => loadLocalString(SKILLSMP_API_KEY_STORAGE_KEY, ""));
  const [skillsmpApiKeyDraft, setSkillsmpApiKeyDraft] = useState(() => loadLocalString(SKILLSMP_API_KEY_STORAGE_KEY, ""));
  const [showSkillsmpSettings, setShowSkillsmpSettings] = useState(false);

  useEffect(() => {
    setGeneralSettings((prev) => {
      if (prev.autoAcceptPermissions === agentAutoAcceptPermissions) return prev;
      const next = { ...prev, autoAcceptPermissions: agentAutoAcceptPermissions };
      saveGeneralSettings(GENERAL_SETTINGS_KEY, AGENT_AUTO_ACCEPT_PERMISSIONS_KEY, next);
      return next;
    });
  }, [agentAutoAcceptPermissions]);

  useEffect(() => {
    const lang = generalSettings.language === "system" ? navigator.language || "zh-CN" : generalSettings.language;
    document.documentElement.lang = lang;
  }, [generalSettings.language]);
  const agentSkillsRepoPathRef = useRef("");
  const [agentSlashCommands, setAgentSlashCommands] = useState<AgentSlashCommand[]>([]);
  const [agentSlashOpen, setAgentSlashOpen] = useState(false);
  const [agentSlashActiveIndex, setAgentSlashActiveIndex] = useState(0);
  const [agentAutoFollowLatest, setAgentAutoFollowLatest] = useState(true);
  const [agentShowJumpLatest, setAgentShowJumpLatest] = useState(false);
  const [agentStickResetSignal, setAgentStickResetSignal] = useState(0);
  const [agentSessionFetchLimit, setAgentSessionFetchLimit] = useState(AGENT_SESSION_PAGE_SIZE);
  const [draftAgentSession, setDraftAgentSession] = useState(false);
  const [agentRunBusyBySession, setAgentRunBusyBySession] = useState<Record<string, boolean>>({});
  const [agentStreamingAssistantIdBySession, setAgentStreamingAssistantIdBySession] = useState<Record<string, string>>({});
  const [agentSessions, setAgentSessions] = useState<AgentChatSession[]>([]);
  const [sidebarAgentSessionsByRepo, setSidebarAgentSessionsByRepo] = useState<Record<string, AgentChatSession[]>>({});
  const [sidebarAgentSessionFetchLimitByRepo, setSidebarAgentSessionFetchLimitByRepo] = useState<Record<string, number>>({});
  const [sidebarAgentSessionLoadingByRepo, setSidebarAgentSessionLoadingByRepo] = useState<Record<string, boolean>>({});
  const [sidebarAgentSessionPagingByRepo, setSidebarAgentSessionPagingByRepo] = useState<Record<string, boolean>>({});
  const [sidebarAgentSessionHasMoreByRepo, setSidebarAgentSessionHasMoreByRepo] = useState<Record<string, boolean>>({});
  // 会话选择的单一意图入口（selectAgentSession）所用类型。reason 仅用于对账日志，不驱动分支副作用。
  type AgentSelectionReason =
    | "click" | "new" | "restore" | "bootstrap" | "neighbor"
    | "delete-empty" | "child" | "draft-clear" | "unbind" | "rollback";
  type AgentSelectionIntent = {
    seq: number;
    sessionId: string;
    reason: AgentSelectionReason;
    at: number;
  };
  const [activeAgentSessionId, setActiveAgentSessionId] = useState("");
  // 后台数据通道（refresh/被动同步/对齐 effect）无权改写 active；当它发现 active 对应会话不在列表时，
  // 仅置此标记提示用户，绝不替用户切换。仅 selectAgentSession 会清除此标记。
  const [agentActiveSessionStale, setAgentActiveSessionStale] = useState(false);
  const [agentHydratingSessionId, setAgentHydratingSessionId] = useState("");
  const [workspaceAgentBindings, setWorkspaceAgentBindings] = useState<Record<string, WorkspaceAgentBinding>>(() => readWorkspaceAgentBindings());
  const [branchParentMap, setBranchParentMap] = useState<Record<string, string>>(() => readBranchParentMap());
  const [worktreeParentMap, setWorktreeParentMap] = useState<Record<string, string>>(() => readWorktreeParentMap());
  const [showAgentSessionRail, setShowAgentSessionRail] = useState(true);
  const [showAgentDebugLog, setShowAgentDebugLog] = useState(false);
  const [agentDebugLogs, setAgentDebugLogs] = useState<string[]>([]);
  const [agentServerMessageIdByLocalId, setAgentServerMessageIdByLocalId] = useState<Record<string, string>>({});
  const agentServerMessageIdByLocalIdRef = useRef<Record<string, string>>({});
  const [agentLivePartsByServerMessageId, setAgentLivePartsByServerMessageId] = useState<Record<string, AgentDetailedPart[]>>({});
  const agentLivePartsByServerMessageIdRef = useRef<Record<string, AgentDetailedPart[]>>({});
  const agentDetailsByMessageIdRef = useRef<Record<string, AgentDetailedMessage | null>>({});
  /** 远程 run：当前挂工具的 assistant 服务端 id（tool.* 事件自身不带 messageId）。 */
  const remoteAgentServerAssistantIdBySessionRef = useRef<Record<string, string>>({});
  /** 远程 run：已 message.completed 的 assistant id，禁止再被下一条 message.started 改写。 */
  const remoteFrozenAssistantIdsBySessionRef = useRef<Record<string, Set<string>>>({});
  const [agentDetailsLoadingByMessageId, setAgentDetailsLoadingByMessageId] = useState<Record<string, boolean>>({});
  const [agentDetailsErrorByMessageId, setAgentDetailsErrorByMessageId] = useState<Record<string, string>>({});
  const [agentDetailsByMessageId, setAgentDetailsByMessageId] = useState<Record<string, AgentDetailedMessage | null>>({});
  const [agentViewportTodos, setAgentViewportTodos] = useState<AgentTodoItem[]>([]);
  const [agentQuestionLoading, setAgentQuestionLoading] = useState(false);
  const [agentDismissedQuestionsBySession, setAgentDismissedQuestionsBySession] = useState<Record<string, string[]>>({});
  // PR6：审批/提问交互的单一真相源（事件驱动 + listInteractions 兜底）。
  const [agentInteractions, setAgentInteractions] = useState<AgentInteraction[]>([]);
  const agentThreadRef = useRef<HTMLDivElement | null>(null);
  const agentVirtuosoRef = useRef<VirtuosoHandle>(null);
  // 会话搜索面板：open/范围/定位请求。定位用两段式——pendingScrollMessageId 触发消息流滚动，
  // pendingScrollTarget 在跨会话切换时等待目标会话加载完成后再下发给消息流。
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScope>("current-session");
  const [pendingScrollMessageId, setPendingScrollMessageId] = useState("");
  const [pendingScrollTarget, setPendingScrollTarget] = useState<{ sessionId: string; messageId: string } | null>(null);
  /** 搜索定位进行中（含跨会话加载等待）。任何滚 LAST / 追底路径都应避开，直到定位结束或用户显式「跳到最新」。 */
  const locateInFlightRef = useRef(false);
  /** 每次点击搜索结果递增，驱动消息列表 remount（initialTopMostItemIndex 仅 mount 生效）。 */
  const [locateNonce, setLocateNonce] = useState(0);
  // 定位关键词：定位时写入，随消息选中态（AgentMessageStream 内 highlightMessageId）生效/失效——
  // 切会话时 highlightMessageId 被清、highlight 变 false 即停止高亮，故无需在此随会话切换清除，
  // 否则会把「跨会话定位」带过去的关键词一起清掉。
  const [highlightKeyword, setHighlightKeyword] = useState("");
  const agentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const handleCiteGraphNode = useCallback((ref: GraphContextRef) => {
    setAgentGraphContextRefs((prev) => {
      if (prev.some((item) => item.nodeId === ref.nodeId)) return prev;
      return [...prev, ref];
    });
    requestAnimationFrame(() => agentInputRef.current?.focus({ preventScroll: true }));
  }, []);
  const agentInputComposingRef = useRef(false);
  const agentImageInputRef = useRef<HTMLInputElement | null>(null);
  const agentViewportTodosSigRef = useRef("");
  const commitMessageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const worktreePatchStreamSeqRef = useRef(0);
  const worktreePatchStreamKeyRef = useRef("");
  const worktreePatchByPathRef = useRef<Record<string, string>>({});
  const sidebarAgentSessionsByRepoRef = useRef<Record<string, AgentChatSession[]>>({});
  const sidebarAgentSessionFetchLimitByRepoRef = useRef<Record<string, number>>({});
  const sidebarAgentSessionLoadedByRepoRef = useRef<Record<string, boolean>>({});
  const archivedAgentSessionIdsByRepoRef = useRef<Record<string, Set<string>>>({});
  const agentRightPaneRef = useRef<HTMLDivElement | null>(null);
  const topologyViewportRef = useRef<HTMLDivElement | null>(null);
  const topologyDragStateRef = useRef<null | { x: number; y: number; left: number; top: number }>(null);
  const agentModelPickerRef = useRef<HTMLDivElement | null>(null);
  const agentLoadingOlderRef = useRef(false);
  const agentSessionsRepoIdRef = useRef("");
  const agentMessageCache = useAgentMessageCache();
  const agentPassiveSyncSeqRef = useRef(0);
  const pendingSidebarSessionSelectionRef = useRef<{ repoId: string; sessionId: string } | null>(null);
  const agentHydratingSessionIdRef = useRef("");
  // 用户选中会话的意图 token：seq 单调递增，供后台数据通道异步对账（只读，不由此修改 active）。
  const agentSelectionIntentRef = useRef<AgentSelectionIntent | null>(null);
  // agentSessions 列表镜像，供 refresh 锚定排序与 bootstrap 首选读取，避免闭包读到旧列表。
  const agentSessionsRef = useRef<AgentChatSession[]>([]);
  const activeAgentSessionIdRef = useRef("");
  const draftAgentSessionRef = useRef(false);
  const sidebarAgentSessionRequestSeqRef = useRef<Record<string, number>>({});
  const agentRunIdBySessionRef = useRef<Record<string, string>>({});
  /** 同步 busy：连发/排队判定不能等 React state，否则第二条会再开一套 prompt。 */
  const agentRunBusyBySessionRef = useRef<Record<string, boolean>>({});
  /** 本会话待 remap 的乐观 user id 队列（FIFO）；message.completed(user) 按队列消费，禁止同文匹配。 */
  const agentPendingLocalUserIdsBySessionRef = useRef<Record<string, string[]>>({});
  /** 待发送跟进：busy 时只进输入框上方预览，当前 prompt 结束后再发。不交给 core steer。 */
  const agentQueuedFollowUpsBySessionRef = useRef<Record<string, AgentQueuedFollowUp[]>>({});
  const [agentQueuedFollowUpsBySession, setAgentQueuedFollowUpsBySession] = useState<
    Record<string, AgentQueuedFollowUp[]>
  >({});
  /** 远程路径已落地的 user 服务端 id；防止重复 completed 再吃 pending。 */
  const agentCompletedRemoteUserIdsBySessionRef = useRef<Record<string, Set<string>>>({});
  /** 防止 Enter/点击在 await 清空输入前触发两次 runAgentPrompt，同文会叠出多余气泡。 */
  const agentPromptSubmitLockRef = useRef(false);
  const controlMobilePollTokenRef = useRef(0);
  const [agentProviderConfig, setAgentProviderConfig] = useState<AgentProviderConfig>({
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

  function replaceQueuedFollowUps(sessionId: string, rows: AgentQueuedFollowUp[]) {
    const sid = sessionId.trim();
    if (!sid) return;
    const next = { ...agentQueuedFollowUpsBySessionRef.current, [sid]: rows };
    agentQueuedFollowUpsBySessionRef.current = next;
    setAgentQueuedFollowUpsBySession((prev) => ({ ...prev, [sid]: rows }));
  }

  function enqueueFollowUp(sessionId: string, content: string) {
    const sid = sessionId.trim();
    const text = content.trim();
    if (!sid || !text) return;
    const current = agentQueuedFollowUpsBySessionRef.current[sid] || [];
    replaceQueuedFollowUps(sid, [...current, { id: "queue-" + makeId(), content: text }]);
  }

  function popQueuedFollowUp(sessionId: string, committedContent: string) {
    const sid = sessionId.trim();
    if (!sid) return;
    const current = agentQueuedFollowUpsBySessionRef.current[sid] || [];
    if (current.length === 0) return;
    replaceQueuedFollowUps(sid, consumeQueuedFollowUp(current, committedContent).queue);
  }

  function removeQueuedFollowUp(sessionId: string, followUpId: string) {
    const sid = sessionId.trim();
    const id = followUpId.trim();
    if (!sid || !id) return;
    const current = agentQueuedFollowUpsBySessionRef.current[sid] || [];
    if (current.length === 0) return;
    replaceQueuedFollowUps(sid, removeQueuedFollowUpById(current, id));
  }

  function reconcileQueuedFollowUps(sessionId: string): AgentQueuedFollowUp[] {
    const sid = sessionId.trim();
    if (!sid) return [];
    const current = agentQueuedFollowUpsBySessionRef.current[sid] || [];
    if (current.length === 0) return [];
    const messages = agentSessionsRef.current.find((item) => item.id === sid)?.messages || [];
    const next = dropQueuedFollowUpsAlreadyInTranscript(current, messages);
    if (next.length !== current.length) replaceQueuedFollowUps(sid, next);
    return next;
  }

  function scheduleNextQueuedFollowUp(sessionId: string) {
    const sid = sessionId.trim();
    if (!sid) return;
    window.setTimeout(() => {
      if (agentRunBusyBySessionRef.current[sid] || String(agentRunIdBySessionRef.current[sid] || "").trim()) {
        return;
      }
      const next = reconcileQueuedFollowUps(sid)[0];
      if (!next) return;
      void runAgentPrompt({ promptOverride: next.content });
    }, 0);
  }

  function focusAgentComposer() {
    // 会话切换/布局切换后 textarea 可能尚未挂稳；等 React 提交后再抢输入态。
    const tryFocus = () => agentInputRef.current?.focus({ preventScroll: true });
    queueMicrotask(() => {
      requestAnimationFrame(tryFocus);
    });
  }

  function appendAgentAttachments(next: AgentAttachment[]) {
    if (next.length === 0) return;
    setAgentImageAttachments((prev) => mergeUniqueAttachments(prev, next));
    // 粘贴/拖入附件后布局可能切换，异步读盘也会让焦点丢失；等 React 提交后再抢回输入态。
    focusAgentComposer();
  }

  async function readTransferAttachments(transfer: DataTransfer | null | undefined): Promise<AgentAttachment[]> {
    const clipboardPaths = extractClipboardFilePaths(transfer);
    if (clipboardPaths.length > 0) {
      return attachmentsFromLocalPaths(clipboardPaths);
    }
    const desktopClipboardPaths = await readDesktopClipboardFilePaths();
    if (desktopClipboardPaths.length > 0) {
      return attachmentsFromLocalPaths(desktopClipboardPaths);
    }
    const files = extractTransferFiles(transfer);
    if (files.length > 0) {
      const attachments = await Promise.all(files.map((file) => readFileAsAttachment(file)));
      return attachments.filter(Boolean) as AgentAttachment[];
    }
    return [];
  }

  async function readAgentClipboardAttachments(transfer?: DataTransfer | null): Promise<AgentAttachment[]> {
    let attachments = transfer && hasClipboardFileReference(transfer) ? await readTransferAttachments(transfer) : [];
    if (attachments.length === 0) {
      attachments = await readBrowserClipboardAttachments();
    }
    if (attachments.length === 0) {
      attachments = await readDesktopClipboardImageAttachment();
    }
    if (attachments.length === 0) {
      const desktopClipboardPaths = await readDesktopClipboardFilePaths();
      attachments = attachmentsFromLocalPaths(desktopClipboardPaths);
    }
    return attachments;
  }

  async function openAgentAttachmentPicker() {
    setAgentAttachmentMenuOpen(false);
    if (IS_TAURI) {
      const attachments = await pickDesktopAttachments();
      appendAgentAttachments(attachments);
      return;
    }
    agentImageInputRef.current?.click();
  }
  const previousErrorRef = useRef("");

  const {
    terminalTabs,
    setTerminalTabs,
    activeTerminalTabId,
    setActiveTerminalTabId,
    terminalSidebarVisible,
    setTerminalSidebarVisible,
    terminalTabCounterRef,
    terminalSeqRef
  } = useTerminalTabs();
  const terminalRepoResetReadyRef = useRef(false);
  const agentModelConfigLoadedRef = useRef(false);
  const agentConfiguredModelsLoadedRef = useRef(false);
  const agentProviderCatalogLoadedRef = useRef(false);
  const agentCatalogLoadInFlightRef = useRef(false);
  const agentCatalogRefreshInFlightRef = useRef(false);
  const agentBootstrapTokenRef = useRef(0);
  const agentBootstrapDoneForRepoRef = useRef("");
  const agentBootstrapInFlightRef = useRef(false);
  const builtinAgentSlashCommands = useMemo<AgentSlashCommand[]>(() => [
    { id: "builtin-new", trigger: "new", title: "New session", description: "开始一个新会话", source: "builtin" },
    { id: "builtin-compact", trigger: "compact", title: "Compact", description: "压缩当前会话上下文", source: "builtin" },
    { id: "builtin-model", trigger: "model", title: "Model", description: "切换当前模型", source: "builtin" },
    { id: "builtin-agent", trigger: "agent", title: "Agent", description: "规划请让助手使用 task(plan)", source: "builtin" },
    { id: "builtin-open", trigger: "open", title: "Open", description: "搜索文件、命令和会话", source: "builtin" },
    { id: "builtin-terminal", trigger: "terminal", title: "Terminal", description: "打开或聚焦终端", source: "builtin" },
    { id: "builtin-workspace", trigger: "workspace", title: "Workspace", description: "在侧边栏启用或禁用多个工作区", source: "builtin" },
    { id: "builtin-init", trigger: "init", title: "Init", description: "create/update AGENTS.md", source: "builtin" },
    { id: "builtin-review", trigger: "review", title: "Review", description: "review changes [commit|branch|pr]", source: "builtin" }
  ], []);

  const agentSlashQuery = useMemo(() => {
    const match = agentPromptInput.match(/^\/(\S*)$/);
    return match ? match[1].toLowerCase() : "";
  }, [agentPromptInput]);

  const agentSlashSuggestions = useMemo(() => {
    if (!agentSlashOpen) return [];
    const all = [...builtinAgentSlashCommands, ...agentSlashCommands];
    const seen = new Set<string>();
    return all
      .filter((cmd) => {
        const key = cmd.trigger.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return !agentSlashQuery || key.includes(agentSlashQuery) || cmd.title.toLowerCase().includes(agentSlashQuery);
      });
  }, [builtinAgentSlashCommands, agentSlashCommands, agentSlashOpen, agentSlashQuery]);

  useEffect(() => {
    if (!IS_TAURI) return;
    // Overlay / 三色按钮只属 macOS；Windows 上勿调 setTitleBarStyle。
    const isMac =
      typeof navigator !== "undefined" && /Mac|Darwin/i.test(navigator.platform || navigator.userAgent);
    if (!isMac) return;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow() as unknown as { setTitleBarStyle?: (style: string) => Promise<void> | void };
        if (typeof win.setTitleBarStyle === "function") {
          await win.setTitleBarStyle("Overlay");
        }
        // Overlay 重置会打乱三色按钮；正式包挂载更晚，必须在 style 落定后再钉一次。
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("reposition_macos_traffic_lights");
        } catch {
          /* noop on older builds */
        }
      })
      .catch(() => {
        /* noop */
      });
  }, []);

  // 关闭按钮行为：tray=最小化到系统托盘（默认，后台运行）；quit=直接退出；ask=每次询问。
  // 托盘图标与菜单恢复窗口（见 main.rs build_tray）；首次最小化时发一条提示告知后台运行。
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      if (disposed) return;
      const win = getCurrentWindow();
      win.onCloseRequested(async (event) => {
        event.preventDefault();
        const behavior = generalSettings.closeBehavior ?? "tray";
        if (behavior === "quit") {
          await win.destroy();
          return;
        }
        if (behavior === "ask") {
          // 每次询问：webview 原生 confirm。确定=最小化到托盘，取消=退出应用。
          const minimize = window.confirm("最小化到系统托盘后台运行？\n（取消则退出应用；可在设置中固定行为）");
          if (minimize) {
            await win.hide();
          } else {
            await win.destroy();
          }
          return;
        }
        await win.hide();
        if (!window.localStorage.getItem("giteam:closeHintShown")) {
          window.localStorage.setItem("giteam:closeHintShown", "1");
          void showSettingsNotification("Giteam", "已最小化到系统托盘，点击托盘图标恢复窗口");
        }
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [generalSettings.closeBehavior]);

  const repoPath = selectedRepo?.path ?? "";
  const gitPanePath = gitPaneRepo?.path ?? repoPath;
  const repoPathRef = useRef(repoPath);
  const gitPanePathRef = useRef(gitPanePath);
  const selectedWorktreeFileRef = useRef(selectedWorktreeFile);
  const selectedAttachmentPreviewPathRef = useRef(selectedAttachmentPreviewPath);
  const rightPaneTabRef = useRef(rightPaneTab);
  const gitAutoRefreshBlockedRef = useRef(false);
  const gitAutoRefreshTimerRef = useRef<number | null>(null);
  const workspacePath = normalizeWorkspacePath(repoPath);
  const resolveProviderDisplayName = (providerId: string) => getProviderDisplayName(providerId, agentProviderNames);
  const {
    agentSkills,
    agentSkillsLoading,
    agentSkillsLoadedOnce,
    agentSkillsError,
    agentSkillInstallSpec,
    setAgentSkillInstallSpec,
    agentSkillInstallScope,
    setAgentSkillInstallScope,
    agentSkillInstallingSpec,
    agentSkillInstallNotice,
    agentSkillInstallLog,
    agentSkillListFilter,
    setAgentSkillListFilter,
    agentSkillListQuery,
    setAgentSkillListQuery,
    agentSkillSourceInput,
    setAgentSkillSourceInput,
    agentSkillSourceKind,
    setAgentSkillSourceKind,
    agentSkillBusy,
    agentSkillRemovingKey,
    groupedAgentSkills,
    filteredAgentSkills,
    skillsByRepoRef: agentSkillsByRepoRef,
    setAgentSkillsError,
    restoreCachedSkillsForRepo,
    refreshAgentSkills,
    installAgentSkillFromRegistry,
    removeAgentSkill,
    removeAgentSkillGroup,
    addAgentSkillSource
  } = useAgentInstalledSkills({
    repoPath,
    skillsVisible: agentSkillsVisible,
    ensureRepoSelected,
    appendDebugLog: appendAgentDebugLog,
    setMessage,
    setError,
    runCommandInTerminalModule
  });
  const {
    agentSkillMarketListRef,
    agentSkillSearchQuery,
    setAgentSkillSearchQuery,
    agentSkillSearchResults,
    agentSkillSearchLoading,
    agentSkillCatalogView,
    agentSkillSearchMeta,
    selectedMarketplaceSkill,
    setShowSkillInstallMenu,
    agentMarketplaceRows,
    visibleAgentMarketplaceRows,
    agentSkillsInitialLoading,
    agentSkillsSearching,
    agentSkillsPaging,
    warmSkillsMarketplace,
    searchAgentSkillRegistry,
    switchAgentSkillCatalogView,
    handleAgentSkillMarketScroll,
    selectMarketplaceSkill
  } = useAgentSkillMarketplace({
    repoPath,
    skillsVisible: agentSkillsVisible,
    skillsLoadedOnce: agentSkillsLoadedOnce,
    skillsLoading: agentSkillsLoading,
    skillsmpApiKey,
    ensureRepoSelected,
    appendDebugLog: appendAgentDebugLog,
    setSkillsError: setAgentSkillsError
  });

  useEffect(() => {
    if (!repoPath.trim()) return;
    const timer = scheduleAfterInteraction(() => {
      if (!agentSkillsLoadedOnce && !agentSkillsLoading) void refreshAgentSkills();
      void warmSkillsMarketplace();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    repoPath,
    agentSkillsLoadedOnce,
    agentSkillsLoading
  ]);

  useEffect(() => {
    // pi 无 opencode HTTP /command 端点；slash 建议由内置命令 + 已安装 skills 组成。
    if (!repoPath.trim()) {
      setAgentSlashCommands([]);
      return;
    }
    const skillCommands: AgentSlashCommand[] = agentSkills
      .map((skill): AgentSlashCommand | null => {
        const name = String(skill.name || "").trim().replace(/^\//, "");
        if (!name) return null;
        return {
          id: `skill-${skill.scope || "project"}-${name}`,
          trigger: name,
          title: name,
          description: String(skill.description || "Installed skill"),
          source: "skill"
        };
      })
      .filter(Boolean) as AgentSlashCommand[];
    setAgentSlashCommands(skillCommands);
  }, [repoPath, agentSkills]);

  useEffect(() => {
    if (!repoPath.trim()) return;
    void refreshAgentDefinitions();
  }, [repoPath]);

  const activeWorkspaceAgentBinding = workspacePath ? workspaceAgentBindings[workspacePath] || null : null;
  const activeTerminalTab = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? terminalTabs[0],
    [terminalTabs, activeTerminalTabId]
  );
  const worktreeTree = useMemo(() => buildWorktreeTree(worktreeOverview.entries), [worktreeOverview.entries]);
  const stagedTree = useMemo(() => buildWorktreeTree(worktreeOverview.entries.filter((e) => e.staged)), [worktreeOverview.entries]);
  const unstagedTree = useMemo(() => buildWorktreeTree(worktreeOverview.entries.filter((e) => e.unstaged || e.untracked)), [worktreeOverview.entries]);
  const workspaceFileCandidates = useMemo(() => worktreeOverview.entries.map((entry) => entry.path), [worktreeOverview.entries]);
  const workspaceDirectoryCandidates = useMemo(() => {
    const dirs = new Set<string>();
    worktreeOverview.entries.forEach((entry) => {
      const parts = entry.path.split("/").filter(Boolean);
      for (let index = 1; index < parts.length; index += 1) {
        dirs.add(parts.slice(0, index).join("/"));
      }
    });
    return Array.from(dirs);
  }, [worktreeOverview.entries]);
  const agentWorkspaceRoot = repoPath || gitPanePath;
  const agentUsesGitPaneWorkspace = normalizeWorkspacePath(agentWorkspaceRoot) === normalizeWorkspacePath(gitPanePath);
  const agentWorkspaceFileCandidates = useMemo(
    () => agentUsesGitPaneWorkspace ? workspaceFileCandidates : [],
    [agentUsesGitPaneWorkspace, workspaceFileCandidates]
  );
  const agentWorkspaceDirectoryCandidates = useMemo(
    () => agentUsesGitPaneWorkspace ? workspaceDirectoryCandidates : [],
    [agentUsesGitPaneWorkspace, workspaceDirectoryCandidates]
  );
  const selectedWorktreeEntry = useMemo(
    () => worktreeOverview.entries.find((entry) => entry.path === selectedWorktreeFile) ?? null,
    [worktreeOverview.entries, selectedWorktreeFile]
  );
  const worktreeChangeStats = useMemo(() => getWorktreeChangeStats(worktreeOverview.entries), [worktreeOverview.entries]);
  const worktreePatchStreamEntries = useMemo(
    () => worktreeOverview.entries.filter((entry) => entry.staged || entry.unstaged || entry.untracked),
    [worktreeOverview.entries]
  );
  const worktreePatchStreamKey = useMemo(
    () => worktreePatchStreamEntries.map((entry) => `${entry.path}:${entry.indexStatus}:${entry.worktreeStatus}`).join("|"),
    [worktreePatchStreamEntries]
  );
  const standaloneRightFileTab = useMemo(() => {
    if (rightPaneTab !== "changes" || selectedWorktreeViewMode === "auto" || !selectedWorktreeFile) return null;
    const parts = selectedWorktreeFile.split("/").filter(Boolean);
    const label = parts[parts.length - 1] || selectedWorktreeFile;
    const ext = label.includes(".") ? (label.split(".").pop() || "").toUpperCase() : "FILE";
    return { label, ext };
  }, [rightPaneTab, selectedWorktreeFile, selectedWorktreeViewMode]);
  const discardAllCount = useMemo(
    () => getDiscardableWorktreeEntryCount(worktreeOverview.entries),
    [worktreeOverview.entries]
  );
  const hasCommittableChanges = worktreeChangeStats.staged > 0 || worktreeChangeStats.unstaged > 0;
  const needsGitSync = worktreeOverview.ahead > 0 || worktreeOverview.behind > 0;
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
    worktreePatchByPathRef.current = worktreePatchByPath;
  }, [worktreePatchByPath]);

  useEffect(() => {
    sidebarAgentSessionsByRepoRef.current = sidebarAgentSessionsByRepo;
  }, [sidebarAgentSessionsByRepo]);

  useEffect(() => {
    sidebarAgentSessionFetchLimitByRepoRef.current = sidebarAgentSessionFetchLimitByRepo;
  }, [sidebarAgentSessionFetchLimitByRepo]);

  const handleWorktreePatchWindowChange = useCallback((count: number) => {
    setWorktreePatchLoadLimit((limit) => Math.max(limit, count));
  }, []);

  useEffect(() => {
    const isNewStream = worktreePatchStreamKeyRef.current !== worktreePatchStreamKey;
    const effectiveLimit = isNewStream ? WORKTREE_DIFF_STREAM_INITIAL_LOAD : worktreePatchLoadLimit;
    const paths = worktreePatchStreamEntries.slice(0, effectiveLimit).map((entry) => entry.path);
    const requestRepoPath = gitPanePath || repoPath;
    const seq = worktreePatchStreamSeqRef.current + 1;
    worktreePatchStreamSeqRef.current = seq;
    if (isNewStream) {
      worktreePatchStreamKeyRef.current = worktreePatchStreamKey;
      worktreePatchByPathRef.current = {};
      setWorktreePatchByPath({});
      setWorktreePatchLoadLimit(WORKTREE_DIFF_STREAM_INITIAL_LOAD);
    }
    if (!requestRepoPath || paths.length === 0) return;

    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = { ...worktreePatchByPathRef.current };
      let changedSinceFlush = 0;
      const flushPatchState = () => {
        worktreePatchByPathRef.current = { ...next };
        setWorktreePatchByPath(worktreePatchByPathRef.current);
        changedSinceFlush = 0;
      };
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index];
        if (Object.prototype.hasOwnProperty.call(next, path)) continue;
        try {
          const patch = await getGitWorktreeFilePatch(requestRepoPath, path);
          if (cancelled || worktreePatchStreamSeqRef.current !== seq) return;
          next[path] = patch;
        } catch {
          if (cancelled || worktreePatchStreamSeqRef.current !== seq) return;
          next[path] = "";
        }
        changedSinceFlush += 1;
        if (changedSinceFlush >= 5 || index === paths.length - 1) {
          flushPatchState();
        }
      }
      if (changedSinceFlush > 0) {
        flushPatchState();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    gitPanePath,
    repoPath,
    worktreePatchLoadLimit,
    worktreePatchStreamEntries,
    worktreePatchStreamKey
  ]);

  useEffect(() => {
    repoPathRef.current = repoPath;
    gitPanePathRef.current = gitPanePath;
    selectedWorktreeFileRef.current = selectedWorktreeFile;
    selectedAttachmentPreviewPathRef.current = selectedAttachmentPreviewPath;
    rightPaneTabRef.current = rightPaneTab;
    gitAutoRefreshBlockedRef.current = busy || committing || pushing || discardingAll || !!discardingFile || !!stagingFile || !!unstagingFile;
  }, [repoPath, gitPanePath, selectedWorktreeFile, selectedAttachmentPreviewPath, rightPaneTab, busy, committing, pushing, discardingAll, discardingFile, stagingFile, unstagingFile]);

  useEffect(() => {
    if (!agentSkillsVisible) return;
    if (agentSkillsRepoPathRef.current === repoPath) return;
    agentSkillsRepoPathRef.current = repoPath;
    const timer = scheduleAfterInteraction(() => {
      const cached = restoreCachedSkillsForRepo(repoPath, { resetFilter: true });
      if (!cached) {
        scheduleAfterInteraction(() => void refreshAgentSkills(), 220);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [agentSkillsVisible, repoPath]);

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

  const activeAgentSession = useMemo(() => {
    if (!activeAgentSessionId) return null;
    return agentSessions.find((s) => s.id === activeAgentSessionId) ?? null;
  }, [agentSessions, activeAgentSessionId]);
  const pendingSidebarSessionSelection = pendingSidebarSessionSelectionRef.current;
  const pendingSidebarSessionId = pendingSidebarSessionSelection?.sessionId || "";
  const hydratingActiveAgentSession = Boolean(
    activeAgentSessionId
    && agentHydratingSessionId
    && activeAgentSessionId === agentHydratingSessionId
  );
  const pendingSidebarSessionSwitch = Boolean(
    pendingSidebarSessionSelection?.repoId === (selectedRepo?.id || "")
    && pendingSidebarSessionId
    && (
      pendingSidebarSessionId === agentHydratingSessionId
      || hydratingActiveAgentSession
      ||
      pendingSidebarSessionId !== activeAgentSessionId
      || !activeAgentSession
      || !activeAgentSession.loaded
    )
  );
  const activeAgentModel = useMemo(() => {
    return resolveActiveAgentModel({
      activeSessionId: activeAgentSessionId,
      // 有会话时只认会话对象上的 provider/model（服务端真相），禁止再读 localStorage 影子映射。
      sessionModelRef: modelRefFromChatSession(activeAgentSession),
      draftModel: agentDraftModel,
      configuredModel: agentConfig?.configuredModel || "",
      savedModels: agentSavedModels,
      connectedProviders: agentConnectedProviders,
      modelsByProvider: agentModelsByProvider,
      providerNames: agentProviderNames,
      enabledModels: agentEnabledModels
    });
  }, [
    activeAgentSessionId,
    activeAgentSession?.provider,
    activeAgentSession?.model,
    agentDraftModel,
    agentConfig?.configuredModel,
    agentSavedModels,
    agentConnectedProviders,
    agentModelsByProvider,
    agentEnabledModels,
    agentProviderNames
  ]);

  // 活动会话的 provider/model 变化时，同步旁路 picker state（禁止再用 draft 覆盖会话真相）。
  useEffect(() => {
    const sid = activeAgentSessionId.trim();
    if (!sid) return;
    const provider = String(activeAgentSession?.provider || "").trim();
    const model = String(activeAgentSession?.model || "").trim();
    if (!provider || !model) return;
    setAgentModelProvider(provider);
    setAgentSelectedModel(model);
  }, [activeAgentSessionId, activeAgentSession?.provider, activeAgentSession?.model]);

  const agentMessages = activeAgentSession?.messages ?? [];
  const agentSessionLoading = Boolean(
    hydratingActiveAgentSession
    || pendingSidebarSessionSwitch
    || (activeAgentSessionId && (!activeAgentSession || !activeAgentSession.loaded))
  );
  const agentShowEmptyState = !hydratingActiveAgentSession && !pendingSidebarSessionSwitch && !agentSessionLoading && agentMessages.length === 0;
  // 切会话后空态/消息态会 remount 输入框；等 loading 结束再补一次焦点，避免落在已卸载节点上。
  useEffect(() => {
    const intent = agentSelectionIntentRef.current;
    if (!intent) return;
    if (Date.now() - intent.at > 2500) return;
    if (intent.sessionId && intent.sessionId !== activeAgentSessionId) return;
    if (agentSessionLoading || hydratingActiveAgentSession || pendingSidebarSessionSwitch) return;
    focusAgentComposer();
  }, [
    activeAgentSessionId,
    agentSessionLoading,
    hydratingActiveAgentSession,
    pendingSidebarSessionSwitch,
    agentShowEmptyState,
  ]);
  const activeAgentSessionBusy = Boolean(activeAgentSessionId && agentRunBusyBySession[activeAgentSessionId]);
  const activeAgentStreamingAssistantId = activeAgentSessionId ? (agentStreamingAssistantIdBySession[activeAgentSessionId] || "") : "";
  const visibleAgentDefinitions = useMemo(() => {
    const q = agentAgentSearch.trim().toLowerCase();
    const rows = agentDefinitions.filter((agent) => !agent.hidden && agent.mode !== "subagent");
    const filtered = q
      ? rows.filter((agent) => agent.name.toLowerCase().includes(q) || String(agent.description || "").toLowerCase().includes(q))
      : rows;
    return filtered.sort((a, b) => {
      const aPrimary = a.name === "build" || a.mode === "primary" ? 1 : 0;
      const bPrimary = b.name === "build" || b.mode === "primary" ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      return a.name.localeCompare(b.name);
    });
  }, [agentDefinitions, agentAgentSearch]);
  const activeAgentAgent = useMemo(() => {
    const sessionId = activeAgentSessionId.trim();
    const fromSession = sessionId ? (agentSessionAgent[sessionId] || "") : "";
    const normalizedFromSession = fromSession.trim().toLowerCase();
    if (isComposerAgentName(normalizedFromSession)) return normalizedFromSession;
    return normalizeComposerAgentName(agentDraftAgent);
  }, [activeAgentSessionId, agentSessionAgent, agentDraftAgent]);
  const activeAgentThinkingLevel = useMemo(() => {
    const sessionId = activeAgentSessionId.trim();
    const raw = normalizeThinkingLevel(
      sessionId ? (agentSessionThinkingLevel[sessionId] || agentDraftThinkingLevel) : agentDraftThinkingLevel
    );
    const modelInfo = agentModelInfoByRef[activeAgentModel] || null;
    return clampThinkingLevelToModel(raw, modelInfo);
  }, [
    activeAgentSessionId,
    agentSessionThinkingLevel,
    agentDraftThinkingLevel,
    activeAgentModel,
    agentModelInfoByRef
  ]);
  const activeAgentThinkingOptions = useMemo(
    () => thinkingLevelsForModel(agentModelInfoByRef[activeAgentModel] || null),
    [agentModelInfoByRef, activeAgentModel]
  );
  const agentActivePermissions = useMemo<PermissionInteraction[]>(() => {
    const sid = activeAgentSessionId.trim();
    // 审批卡片直接消费 pi 原生 permission 交互（tool/risk/input），不再套用旧模型。
    return agentInteractions.filter(
      (item): item is PermissionInteraction =>
        item.kind === "permission" && (!sid || item.sessionId === sid)
    );
  }, [agentInteractions, activeAgentSessionId]);

  useEffect(() => {
    const wasBusy = previousSessionBusyRef.current;
    previousSessionBusyRef.current = activeAgentSessionBusy;
    if (!wasBusy || activeAgentSessionBusy) return;
    if (generalSettings.soundsAgent) playSettingsTone("agent");
    if (generalSettings.notificationsAgent) void showSettingsNotification("Agent finished", activeAgentSession?.title || "Giteam session is idle");
  }, [activeAgentSessionBusy, activeAgentSession?.title, generalSettings.soundsAgent, generalSettings.notificationsAgent]);

  useEffect(() => {
    const previous = previousPermissionCountRef.current;
    previousPermissionCountRef.current = agentActivePermissions.length;
    if (agentActivePermissions.length <= previous) return;
    const latest = agentActivePermissions[agentActivePermissions.length - 1];
    if (generalSettings.soundsPermissions) playSettingsTone("permission");
    if (generalSettings.notificationsPermissions) void showSettingsNotification("Permission required", latest?.tool ? `${latest.tool} 需要授权` : "Giteam 正在等待授权");
  }, [agentActivePermissions, generalSettings.soundsPermissions, generalSettings.notificationsPermissions]);

  useEffect(() => {
    const nextError = String(error || "").trim();
    const previous = previousErrorRef.current;
    previousErrorRef.current = nextError;
    if (!nextError || nextError === previous) return;
    if (generalSettings.soundsErrors) playSettingsTone("error");
    if (generalSettings.notificationsErrors) void showSettingsNotification("Giteam error", nextError.slice(0, 120));
  }, [error, generalSettings.soundsErrors, generalSettings.notificationsErrors]);
  const settingsSkillsContent = (
    <AgentSettingsSkillsGrid
      error={agentSkillsError}
      groups={groupedAgentSkills}
      removingKey={agentSkillRemovingKey}
      onRemoveSkillGroup={removeAgentSkillGroup}
    />
  );

  useEffect(() => {
    if (!repoPath.trim() || !activeAgentSessionId.trim()) return;
    void refreshPendingPermissions(activeAgentSessionId);
    const shouldPollPermissions = activeAgentSessionBusy || agentAutoAcceptPermissions || (showAgentModulePanel && agentModuleTab === "permissions");
    if (!shouldPollPermissions) return;
    const timer = window.setInterval(() => {
      void refreshPendingPermissions(activeAgentSessionId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [repoPath, activeAgentSessionId, activeAgentSessionBusy, showAgentModulePanel, agentModuleTab, agentAutoAcceptPermissions]);

  // UI 偏好是全局的，但 backend auto_approve 挂在每个 session 的 hub 上；
  // 恢复/切换会话会新建 hub（默认 false），必须把偏好重新推到当前 session。
  useEffect(() => {
    const sid = activeAgentSessionId.trim();
    if (!repoPath.trim() || !sid) return;
    void ensureSessionAutoAcceptPermissions(sid, agentAutoAcceptPermissions);
  }, [repoPath, activeAgentSessionId, agentAutoAcceptPermissions]);

  useEffect(() => {
    if (!showAgentModulePanel) return;
    if (agentModuleTab === "agents") void refreshAgentDefinitions();
    if (agentModuleTab === "permissions") void refreshPendingPermissions();
    if (agentModuleTab === "skills") {
      const timer = scheduleAfterInteraction(() => void refreshAgentSkills(), 280);
      return () => window.clearTimeout(timer);
    }
  }, [showAgentModulePanel, agentModuleTab, repoPath]);

  useEffect(() => {
    if (agentSkillsVisible) {
      if (!agentSkillsLoadedOnce && !agentSkillsLoading) {
        const timer = scheduleAfterInteraction(() => void refreshAgentSkills(), 280);
        return () => window.clearTimeout(timer);
      }
    }
  }, [agentSkillsVisible, repoPath, agentSkillsLoadedOnce, agentSkillsLoading]);

  function bindAgentSessionToWorkspace(sessionId: string, workspacePathInput = repoPath, branchInput = worktreeOverview.branch || selectedBranch) {
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
      const parsedModel = normalizeModelRef(activeAgentModel || agentDraftModel || "");
      const modelRef = parsedModel ? parseModelRef(parsedModel) : null;
      const mode = composerAgentSessionOptions(activeAgentAgent);
      const modelInfo = agentModelInfoByRef[parsedModel || ""] || null;
      const createdAgent = await agentClient.createSession({
        repoPath: target,
        provider: modelRef?.provider,
        model: modelRef?.model,
        maxToolIterations: generalSettings.maxToolIterations > 0 ? generalSettings.maxToolIterations : undefined,
        appendSystemPrompt: mode.appendSystemPrompt,
        ...(mode.enabledTools ? { enabledTools: mode.enabledTools } : {}),
        thinking: toPiThinkingLevel(activeAgentThinkingLevel, modelInfo)
      });
      const created = agentSummaryToChatSummary(createdAgent);
      created.title = title;
      const next = agentSessionFromSummary(created, agentSessions.length + 1);
      next.loaded = true;
      setAgentSessions((prev) => (prev.some((s) => s.id === created.id) ? prev : [next, ...prev]));
      const targetRepoId = repos.find((repo) => normalizeWorkspacePath(repo.path) === normalizeWorkspacePath(target))?.id || selectedRepo?.id || "";
      upsertSidebarAgentSession(targetRepoId, next);
      // provider/model 已随 agentSummaryToChatSummary → agentSessionFromSummary 写入 next。
      const createdModelRef = modelRefFromAgentSummary(createdAgent);
      if (createdModelRef) {
        selectAgentDraftModel(createdModelRef);
        const parsedCreated = parseModelRef(createdModelRef);
        if (parsedCreated) {
          setAgentModelProvider(parsedCreated.provider);
          setAgentSelectedModel(parsedCreated.model);
        }
      }
      selectAgentSession(created.id, "new");
      if (agentAutoAcceptPermissions) void ensureSessionAutoAcceptPermissions(created.id, agentAutoAcceptPermissions);
      if (activeAgentAgent) setAgentSessionAgent((prev) => ({ ...prev, [created.id]: activeAgentAgent }));
      bindAgentSessionToWorkspace(created.id, target, branchInput);
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
      clearAgentSessionHydration();
      selectAgentSession("", "unbind", { draft: true });
    }
    setMessage(`已解除 Agent 绑定: ${pathLeaf(target)}`);
  }

  function getRepoSessionFetchLimit(repoId: string): number {
    const id = repoId.trim();
    if (!id) return AGENT_SESSION_PAGE_SIZE;
    return sidebarAgentSessionFetchLimitByRepoRef.current[id] ?? sidebarAgentSessionFetchLimitByRepo[id] ?? AGENT_SESSION_PAGE_SIZE;
  }

  function getRepoSessionsForSidebar(repoId: string): AgentChatSession[] {
    const id = repoId.trim();
    if (!id) return [];
    return sidebarAgentSessionsByRepo[id] ?? [];
  }

  function hasLoadedSidebarRepoSessions(repoId: string): boolean {
    const id = repoId.trim();
    return Boolean(id && sidebarAgentSessionLoadedByRepoRef.current[id]);
  }

  function markAgentSessionArchived(repoId: string, sessionId: string) {
    const id = repoId.trim();
    const sid = sessionId.trim();
    if (!id || !sid) return;
    const prev = archivedAgentSessionIdsByRepoRef.current[id] || new Set<string>();
    archivedAgentSessionIdsByRepoRef.current = {
      ...archivedAgentSessionIdsByRepoRef.current,
      [id]: new Set([...prev, sid])
    };
  }

  function isLocallyArchivedAgentSession(repoId: string, sessionId: string): boolean {
    const id = repoId.trim();
    const sid = sessionId.trim();
    if (!id || !sid) return false;
    return archivedAgentSessionIdsByRepoRef.current[id]?.has(sid) ?? false;
  }

  function filterVisibleAgentSessionsForRepo(repoId: string, rows: ChatSessionSummary[]): ChatSessionSummary[] {
    const id = repoId.trim();
    return filterActiveAgentSessionSummaries(rows).filter((row) => !isLocallyArchivedAgentSession(id, row.id));
  }

  function upsertSidebarAgentSession(repoId: string, session: AgentChatSession) {
    const id = repoId.trim();
    if (!id || !session.id.trim()) return;
    // 子任务会话绝不能进侧栏（完成瞬间 list 竞态的最后一道防线）。
    if (!isPrimaryAgentSessionSummary(session)) return;
    setSidebarAgentSessionsByRepo((prev) => {
      const limit = Math.max(AGENT_SESSION_PAGE_SIZE, getRepoSessionFetchLimit(id));
      const existing = prev[id] || [];
      const merged = [session, ...existing.filter((item) => item.id !== session.id)]
        .sort(compareAgentSessionActivity)
        .slice(0, limit);
      return { ...prev, [id]: merged };
    });
    setSidebarAgentSessionFetchLimitByRepo((prev) => ({
      ...prev,
      [id]: Math.max(AGENT_SESSION_PAGE_SIZE, prev[id] ?? AGENT_SESSION_PAGE_SIZE)
    }));
    sidebarAgentSessionFetchLimitByRepoRef.current = {
      ...sidebarAgentSessionFetchLimitByRepoRef.current,
      [id]: Math.max(AGENT_SESSION_PAGE_SIZE, sidebarAgentSessionFetchLimitByRepoRef.current[id] ?? AGENT_SESSION_PAGE_SIZE)
    };
  }

  function updateSidebarAgentSession(repoId: string, sessionId: string, updater: (session: AgentChatSession) => AgentChatSession) {
    const id = repoId.trim();
    const sid = sessionId.trim();
    if (!id || !sid) return;
    setSidebarAgentSessionsByRepo((prev) => {
      const sessions = prev[id] || [];
      if (!sessions.some((session) => session.id === sid)) return prev;
      const next = sessions
        .map((session) => (session.id === sid ? updater(session) : session))
        .sort(compareAgentSessionActivity);
      return { ...prev, [id]: next };
    });
  }

  function getVisibleRepoSessions(repoId: string): AgentChatSession[] {
    const sessions = getRepoSessionsForSidebar(repoId);
    const limit = getRepoSessionFetchLimit(repoId);
    const visibleLimit = Math.max(AGENT_SESSION_PAGE_SIZE, limit);
    return sessions.length > visibleLimit ? sessions.slice(0, visibleLimit) : sessions;
  }

  function hasMoreRepoSessions(repoId: string): boolean {
    return Boolean(sidebarAgentSessionHasMoreByRepo[repoId.trim()]);
  }

  function isRepoSessionsLoading(repoId: string): boolean {
    return Boolean(sidebarAgentSessionLoadingByRepo[repoId.trim()]);
  }

  function isRepoSessionsPaging(repoId: string): boolean {
    return Boolean(sidebarAgentSessionPagingByRepo[repoId.trim()]);
  }

  function expandProjectSessions(repoId: string) {
    const id = repoId.trim();
    if (!id) return;
    setExpandedProjectIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function collapseProjectSessions(repoId: string) {
    const id = repoId.trim();
    if (!id) return;
    setExpandedProjectIds((prev) => prev.filter((item) => item !== id));
  }

  function toggleRepoSessions(repo: RepositoryEntry) {
    const expanded = expandedProjectIds.includes(repo.id);
    setNewSessionTargetRepoId(repo.id);
    if (expanded) {
      collapseProjectSessions(repo.id);
      return;
    }

    const sessionsLoaded = hasLoadedSidebarRepoSessions(repo.id);
    if (!expanded && !sessionsLoaded) {
      if (isRepoSessionsLoading(repo.id)) return;
      void refreshSidebarRepoSessions(repo)
        .then(() => {
          if (hasLoadedSidebarRepoSessions(repo.id)) expandProjectSessions(repo.id);
        })
        .catch((e) => setError(String(e)));
      return;
    }

    expandProjectSessions(repo.id);
  }

  function startDraftSessionForRepo(repo: RepositoryEntry) {
    setMainMode("agent");
    setNewSessionTargetRepoId(repo.id);
    setExpandedProjectIds((prev) => (prev.includes(repo.id) ? prev : [...prev, repo.id]));
    agentSessionsRepoIdRef.current = repo.id;
    if (selectedRepo?.id !== repo.id) setSelectedRepo(repo);
    if ((rightPaneTabRef.current === "changes" || rightPaneTabRef.current === "worktree") && gitPaneRepo?.id !== repo.id) setGitPaneRepo(repo);
    setAgentSessionFetchLimit(getRepoSessionFetchLimit(repo.id));
    clearPendingSidebarSessionSelection();
    clearAgentSessionHydration();
    selectAgentSession("", "draft-clear", { draft: true });
    setAgentPromptInput("");
  }
  const agentSavedModelCandidates = useMemo(() => {
    const q = agentModelPickerSearch.trim().toLowerCase();
    if (!q) return agentSavedModels;
    return agentSavedModels.filter((m) => m.toLowerCase().includes(q));
  }, [agentSavedModels, agentModelPickerSearch]);

  const agentConfiguredModelCandidates = useMemo(() => {
    // Picker shows configured models + locally enabled models (OpenCode-like local visibility semantics).
    return buildConfiguredModelCandidates({
      configuredProviders: agentConfiguredProviders,
      configuredModelsByProvider: agentConfiguredModelsByProvider,
      configuredModelNamesByProvider: agentConfiguredModelNamesByProvider,
      liveModelNamesByProvider: agentModelNamesByProvider,
      enabledModels: agentEnabledModels,
      hiddenModels: agentHiddenModels,
      connectedProviders: agentConnectedProviders,
      liveModelsByProvider: agentModelsByProvider,
      providerNames: agentProviderNames,
      search: agentModelPickerSearch
    });
  }, [
    agentConfiguredProviders,
    agentConfiguredModelsByProvider,
    agentModelPickerSearch,
    agentHiddenModels,
    agentEnabledModels,
    agentConnectedProviders,
    agentConfiguredModelNamesByProvider,
    agentModelsByProvider,
    agentModelNamesByProvider,
    agentProviderNames
  ]);

  const agentSyncModelRefs = useMemo(() => {
    return buildSyncModelRefs({
      configuredProviders: agentConfiguredProviders,
      configuredModelsByProvider: agentConfiguredModelsByProvider,
      enabledModels: agentEnabledModels,
      hiddenModels: agentHiddenModels,
      connectedProviders: agentConnectedProviders,
      liveModelsByProvider: agentModelsByProvider,
      providerNames: agentProviderNames,
      activeModel: activeAgentModel,
      configuredModel: agentConfig?.configuredModel || ""
    });
  }, [
    activeAgentModel,
    agentConfig?.configuredModel,
    agentConfiguredModelsByProvider,
    agentConfiguredProviders,
    agentConnectedProviders,
    agentEnabledModels,
    agentHiddenModels,
    agentModelsByProvider,
    agentProviderNames
  ]);

  const agentProviderPickerCandidates = useMemo(() => {
    return buildAgentProviderPickerCandidates({
      search: agentProviderPickerSearch,
      presetProviderIds: PROVIDER_PRESETS.map((p) => p.id).filter(Boolean),
      providers: agentProviders,
      connectedProviders: agentConnectedProviders,
      providerNames: agentProviderNames,
      configProviderMap: agentGlobalConfigProviderMap,
      disabledProviders: agentDisabledProviders
    });
  }, [
    agentProviders,
    agentProviderNames,
    agentProviderPickerSearch,
    agentConnectedProviders,
    agentGlobalConfigProviderMap,
    agentDisabledProviders
  ]);

  function getAgentModelDisplay(modelRef: string) {
    return getAgentModelDisplayInfo({
      modelRef,
      modelsByProvider: agentModelsByProvider,
      providerNames: agentProviderNames,
      modelNamesByProvider: agentModelNamesByProvider,
      configuredModelNamesByProvider: agentConfiguredModelNamesByProvider
    });
  }

  function getAgentProviderSource(providerId: string): string {
    return getAgentProviderSourceFromCatalog(providerId, agentProviderSourceById);
  }

  function getAgentProviderTag(providerId: string): string {
    return getAgentProviderTagFromCatalog({
      providerId,
      providerSourceById: agentProviderSourceById,
      providerMap: agentGlobalConfigProviderMap
    });
  }
  function beginSplitDrag(kind: "sidebar" | "right" | "changes", clientX: number) {
    // 同步禁用选中：不能等 useEffect，否则 mousedown→mousemove 之间会拖蓝选中左右栏文本。
    const root = document.documentElement;
    root.classList.add("wb-split-resizing");
    root.style.setProperty("cursor", "col-resize");
    root.style.setProperty("user-select", "none");
    (root.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();
    const startWidth =
      kind === "sidebar" ? sidebarWidth : kind === "right" ? rightPaneWidth : changesSidebarWidth;
    setDraggingSplit({
      kind,
      startX: clientX,
      startWidth
    });
  }

  function appendAgentDebugLog(text: string) {
    const stamp = new Date().toLocaleTimeString();
    setAgentDebugLogs((prev) => {
      const next = [...prev, `[${stamp}] ${text}`];
      if (next.length > 400) return next.slice(next.length - 400);
      return next;
    });
  }

  function indexAgentModelInfoByRef(providers: AgentProviderInfo[]): Record<string, AgentModelInfo> {
    const next: Record<string, AgentModelInfo> = {};
    for (const provider of providers) {
      for (const model of provider.models || []) {
        const ref = normalizeModelRef(`${provider.provider}/${model.modelId}`);
        if (ref) next[ref] = model;
      }
    }
    return next;
  }

  async function applyAgentModel(model: string) {
    if (!ensureRepoSelected()) return;
    const normalized = normalizeModelRef(model);
    if (!normalized) {
      setMessage("Invalid model format, expected provider/model");
      return;
    }
    setAgentConfigBusy(true);
    try {
      const parsed = parseModelRef(normalized);
      const sid = activeAgentSessionId.trim();
      // 无会话：只更新草稿预选（新建会话时写入服务端）。
      // 有会话：唯一真相是 setModel 返回的 summary → 写回 AgentChatSession。
      if (!sid) {
        selectAgentDraftModel(normalized);
        if (parsed) {
          ensureProviderExists(parsed.provider);
          setAgentModelProvider(parsed.provider);
          setAgentSelectedModel(parsed.model);
        }
      } else if (parsed) {
        ensureProviderExists(parsed.provider);
        const prevProvider = String(activeAgentSession?.provider || agentModelProvider || "").trim();
        const prevModel = String(activeAgentSession?.model || agentSelectedModel || "").trim();
        // 乐观更新会话对象（显示立刻跟上选择）。
        updateAgentSessionById(sid, (session) => ({
          ...session,
          provider: parsed.provider,
          model: parsed.model
        }));
        setAgentModelProvider(parsed.provider);
        setAgentSelectedModel(parsed.model);
        selectAgentDraftModel(normalized); // 同时记住为下次新建默认
        try {
          const updated = await agentClient.setModel(sid, parsed.provider, parsed.model);
          const serverProvider = String(updated.provider || parsed.provider).trim();
          const serverModel = String(updated.model || parsed.model).trim();
          const serverRef = normalizeModelRef(`${serverProvider}/${serverModel}`) || normalized;
          updateAgentSessionById(sid, (session) => ({
            ...session,
            provider: serverProvider,
            model: serverModel
          }));
          setAgentModelProvider(serverProvider);
          setAgentSelectedModel(serverModel);
          selectAgentDraftModel(serverRef);
          rememberAgentSavedModel(serverRef);
          const piLevel = toPiThinkingLevel(
            clampThinkingLevelToModel(
              agentSessionThinkingLevel[sid] || agentDraftThinkingLevel,
              agentModelInfoByRef[serverRef] || agentModelInfoByRef[normalized] || null
            ),
            agentModelInfoByRef[serverRef] || agentModelInfoByRef[normalized] || null
          );
          if (piLevel) await agentClient.setThinking(sid, piLevel);
        } catch (error) {
          appendAgentDebugLog(`session.setModel.error ${sid} ${String(error)}`);
          // 整段回滚到切换前的会话模型（服务端未改动）。
          updateAgentSessionById(sid, (session) => ({
            ...session,
            ...(prevProvider ? { provider: prevProvider } : { provider: undefined }),
            ...(prevModel ? { model: prevModel } : { model: undefined })
          }));
          setAgentModelProvider(prevProvider);
          setAgentSelectedModel(prevModel);
          throw new Error(`模型切换失败：${String(error instanceof Error ? error.message : error)}`);
        }
        // 切换成功：清当前会话残留的运行失败错误占位（上一 provider 的报错）。
        updateAgentSessionById(sid, (session) => {
          let changed = false;
          const messages = session.messages.map((message) => {
            if (message.role === "assistant" && Boolean(message.error) && !(message.content || "").trim()) {
              changed = true;
              return { ...message, error: "" };
            }
            return message;
          });
          return changed ? { ...session, messages } : session;
        });
      }
      const clamped = clampThinkingLevelToModel(
        sid ? (agentSessionThinkingLevel[sid] || agentDraftThinkingLevel) : agentDraftThinkingLevel,
        agentModelInfoByRef[normalized] || null
      );
      if (sid) setAgentSessionThinkingLevel((prev) => ({ ...prev, [sid]: clamped }));
      else setAgentDraftThinkingLevel(clamped);
      saveLocalString(AGENT_THINKING_SELECTION_KEY, clamped);
      setMessage(`Switched model: ${normalized}`);
    } catch (e) {
      setError(String(e));
      setMessage("Switch model failed");
    } finally {
      setAgentConfigBusy(false);
    }
  }

  function applyAgentAgent(_agentName: string) {
    // Plan/Build 模式已由 task(plan) 子 agent 替代。
  }

  async function applyAgentThinkingLevel(level: AgentThinkingLevel) {
    const modelInfo = agentModelInfoByRef[activeAgentModel] || null;
    const next = clampThinkingLevelToModel(level, modelInfo);
    const sid = activeAgentSessionId.trim();
    if (sid) {
      setAgentSessionThinkingLevel((prev) => ({ ...prev, [sid]: next }));
    } else {
      setAgentDraftThinkingLevel(next);
    }
    saveLocalString(AGENT_THINKING_SELECTION_KEY, next);
    setShowAgentThinkingPicker(false);
    const piLevel = toPiThinkingLevel(next, modelInfo);
    if (sid && piLevel) {
      try {
        await agentClient.setThinking(sid, piLevel);
      } catch (error) {
        appendAgentDebugLog(`session.setThinking.error ${sid} ${String(error)}`);
        setError(String(error));
        return;
      }
    }
    setMessage(`推理强度: ${thinkingLevelMeta(next).label}`);
  }

  async function refreshAgentDefinitions() {
    // pi 桌面端固定 build/plan 两种 composer agent，不再查询 opencode agent 列表。
    setAgentDefinitionsLoading(true);
    setAgentDefinitionsError("");
    try {
      const rows = AGENT_COMPOSER_AGENT_OPTIONS.map((agent): AgentDefinition => ({
        name: agent.name,
        description: agent.title,
        mode: "primary",
        native: true
      }));
      setAgentDefinitions(rows);
    } finally {
      setAgentDefinitionsLoading(false);
    }
  }

  // PR6：从后端拉取当前 session 的全部待裁决交互（permission+question），同步单一真相源。
  // 事件已实时驱动，此函数仅作会话切换/重连后的兜底对账。
  async function syncAgentInteractions(sessionIdArg: string) {
    const sid = sessionIdArg.trim();
    if (!sid) return;
    setAgentPermissionLoading(true);
    setAgentQuestionLoading(true);
    try {
      const items = await agentClient.listInteractions(sid);
      const mine = items.filter((item) => item.sessionId === sid);
      setAgentInteractions((prev) => {
        // 替换本 session 的交互，保留其它 session 的（多窗口场景）。
        const rest = prev.filter((item) => item.sessionId !== sid);
        return [...rest, ...mine];
      });
    } catch (e) {
      appendAgentDebugLog(`interaction.list.error ${String(e)}`);
    } finally {
      setAgentPermissionLoading(false);
      setAgentQuestionLoading(false);
    }
  }

  async function refreshPendingPermissions(sessionIdArg = activeAgentSessionId) {
    if (!repoPath.trim()) return;
    await syncAgentInteractions(sessionIdArg);
  }

  async function ensureSessionAutoAcceptPermissions(sessionId: string, enabled: boolean) {
    // 显式接收 enabled：调用方在 setAgentAutoAcceptPermissions(next) 之后同步调用本函数，
    // 此时 state 尚未更新，闭包里的 agentAutoAcceptPermissions 仍是旧值（false），
    // 若误用闭包旧值会触发提前 return、setAutoApprove 永不调用 → 开了 auto 仍弹审批。
    // 关闭时也必须同步到后端，否则 session hub 会一直保持 auto_approve=true。
    if (!repoPath.trim() || !sessionId.trim()) return;
    try {
      await agentClient.setAutoApprove(sessionId, enabled);
      appendAgentDebugLog(`permission.session.autoApprove ${sessionId} enabled=${enabled ? 1 : 0}`);
      if (enabled) {
        // 开关打开时清掉已弹出的待审批，避免「开了 auto 还要点一遍」。
        const pending = (await agentClient.listInteractions(sessionId)).filter(
          (item) => item.kind === "permission"
        );
        for (const item of pending) {
          await sendPermissionReply(item.id, "once", { silent: true });
        }
      }
    } catch (e) {
      appendAgentDebugLog(`permission.session.autoApprove.error ${sessionId} ${String(e)}`);
    }
  }

  async function sendPermissionReply(requestId: string, reply: AgentPermissionReply, opts?: { message?: string; silent?: boolean }) {
    if (!repoPath.trim() || !requestId.trim()) return false;
    try {
      const decisionReply: AgentInteractionReply =
        reply === "once" ? { decision: "once" }
        : reply === "always" ? { decision: "always" }
        : { decision: "reject" };
      await agentClient.replyInteraction(requestId, decisionReply);
      setAgentInteractions((prev) => prev.filter((item) => item.id !== requestId));
      appendAgentDebugLog(`permission.reply ${requestId} ${reply}`);
      if (!opts?.silent) setMessage(reply === "reject" ? "Permission rejected" : "Permission accepted");
      return true;
    } catch (e) {
      appendAgentDebugLog(`permission.reply.error ${requestId} ${String(e)}`);
      if (!opts?.silent) setError(String(e));
      return false;
    }
  }

  function openAgentModulePanel(tab: AgentModuleTab) {
    setAgentModuleTab(tab);
    setShowAgentModulePanel(true);
    if (tab === "agents") void refreshAgentDefinitions();
    if (tab === "permissions") void refreshPendingPermissions();
    if (tab === "skills") void refreshAgentSkills();
  }

  /**
   * 会话选择的单一意图入口（用户意图通道）。全文件唯一调用 setActiveAgentSessionId 的地方。
   * 仅写：意图 token（seq）、active、draft、清除 stale 标记。不切仓库/不 bind/不 load/不动 hydration
   * ——这些副作用由各调用入口自行叠加。后台数据通道（refresh/被动同步/对齐 effect）无权调用本函数。
   */
  function selectAgentSession(
    id: string,
    reason: AgentSelectionReason,
    options?: { draft?: boolean }
  ) {
    const sid = id.trim();
    // seq 即时从 ref 读取（不依赖闭包），防止多入口并发写入导致序号回退。
    agentSelectionIntentRef.current = {
      seq: (agentSelectionIntentRef.current?.seq ?? 0) + 1,
      sessionId: sid,
      reason,
      at: Date.now(),
    };
    // 任何新的用户显式意图都表明选中是新鲜的，清除后台对账置起的 stale 提示。
    setAgentActiveSessionStale(false);
    setActiveAgentSessionId(sid);
    // 同步写 ref：点「新对话」后立刻发送时，不能等 useEffect，否则会误用旧 active 去发送。
    activeAgentSessionIdRef.current = sid;
    if (options?.draft === undefined) {
      // 选中具体会话时默认关闭草稿态；清空选中（sid=""）时不擅自动 draft，由调用方决定。
      if (sid) {
        setDraftAgentSession(false);
        draftAgentSessionRef.current = false;
      }
    } else {
      setDraftAgentSession(options.draft);
      draftAgentSessionRef.current = options.draft;
    }
    // 切换会话后默认进入输入态，方便直接打字。
    focusAgentComposer();
  }

  function ensureActiveAgentSession(): string {
    if (draftAgentSession) return "";
    const current = activeAgentSessionId.trim();
    if (current && agentSessions.some((s) => s.id === current)) return current;
    // 绝不回落到列表第一条：空选中/失效选中时若误用 sessions[0]，会把新消息打进别人的会话。
    return "";
  }

  /** 发送瞬间用 ref 解析目标会话，避免 draft/active 的 setState 尚未提交时读到旧闭包。 */
  function resolvePromptTargetSessionId(): string {
    if (draftAgentSessionRef.current) return "";
    const current = activeAgentSessionIdRef.current.trim();
    if (current && agentSessionsRef.current.some((s) => s.id === current)) return current;
    return "";
  }

  function updateActiveAgentSession(
    updater: (session: AgentChatSession) => AgentChatSession
  ) {
    const id = ensureActiveAgentSession();
    setAgentSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }

  function updateAgentSessionById(sessionId: string, updater: (session: AgentChatSession) => AgentChatSession) {
    setAgentSessions((prev) => prev.map((s) => (s.id === sessionId ? updater(s) : s)));
  }

  /** 手机/HTTP 远程 run：把权威消息写入对应会话（可 upsert），不依赖「当前是否打开该会话」。 */
  async function applyRemoteAgentSessionSnapshot(
    sessionId: string,
    opts?: { repoPath?: string; reason?: string }
  ) {
    const sid = sessionId.trim();
    if (!sid) return;
    const eventRepoPath = String(opts?.repoPath || "").trim();
    const currentPath = normalizeWorkspacePath(repoPath);
    const sameWorkspace =
      !eventRepoPath || !currentPath || normalizeWorkspacePath(eventRepoPath) === currentPath;
    const targetRepo =
      (eventRepoPath
        ? repos.find((repo) => normalizeWorkspacePath(repo.path) === normalizeWorkspacePath(eventRepoPath))
        : null) || selectedRepo;
    appendAgentDebugLog(
      `session.remote.sync sid=${sid} reason=${opts?.reason || "event"} sameWorkspace=${sameWorkspace ? 1 : 0}`
    );
    try {
      // 丢掉中途拉取的「仅有用户消息」缓存/inflight，否则终态会复用旧 Promise，桌面看不到回复。
      agentMessageCache.invalidate(eventRepoPath || repoPath, sid);
      if (sameWorkspace) {
        await refreshAgentSessions().catch(() => {});
      } else if (targetRepo) {
        await refreshSidebarRepoSessions(targetRepo, { silent: true }).catch(() => {});
      }
      const page = await fetchAgentDetailedMessagePage(
        sid,
        "",
        200,
        Date.now(),
        eventRepoPath || repoPath
      );
      setAgentDetailsByMessageId((prev) => {
        const next = { ...prev, ...page.detailsById };
        agentDetailsByMessageIdRef.current = next;
        return next;
      });
      const firstUser = page.items.find((item) => item.role === "user" && String(item.content || "").trim());
      const title =
        clipAgentSessionTitle(firstUser?.content) ||
        `Session ${sid.slice(0, 8)}`;
      const nextSession: AgentChatSession = {
        id: sid,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: page.items,
        turnStart: 0,
        loaded: true,
        nextCursor: undefined,
        hasMore: false
      };
      if (sameWorkspace) {
        setAgentSessions((prev) => {
          const existing = prev.find((session) => session.id === sid);
          const bootstrap = opts?.reason === "remote-bootstrap";
          if (existing) {
            let nextMessages = page.items;
            if (bootstrap) {
              // 启动快照可能还只有用户消息；保留本地已流式写入的 assistant，只补缺失 id。
              const byId = new Map(existing.messages.map((item) => [item.id, item]));
              nextMessages = page.items.map((item) => {
                const live = byId.get(item.id);
                if (
                  live?.role === "assistant" &&
                  String(live.content || "").length > String(item.content || "").length
                ) {
                  return { ...item, content: live.content };
                }
                return item;
              });
              for (const live of existing.messages) {
                if (!page.items.some((item) => item.id === live.id)) {
                  nextMessages.push(live);
                }
              }
            }
            return prev.map((session) =>
              session.id === sid
                ? {
                    ...session,
                    title: session.title.trim() || title,
                    messages: nextMessages,
                    loaded: true,
                    nextCursor: undefined,
                    hasMore: false,
                    updatedAt: Date.now()
                  }
                : session
            );
          }
          return [nextSession, ...prev];
        });
      }
      if (targetRepo?.id) {
        const cached = agentSessionsRef.current.find((session) => session.id === sid);
        upsertSidebarAgentSession(targetRepo.id, {
          ...(sameWorkspace && cached ? cached : nextSession),
          title: (sameWorkspace && cached?.title.trim()) || title,
          messages: page.items,
          loaded: true,
          updatedAt: Date.now()
        });
      }
      void syncAgentInteractions(sid).catch(() => {});
    } catch (error) {
      appendAgentDebugLog(`session.remote.sync.error sid=${sid} ${String(error)}`);
    }
  }

  /** 远程 assistant 是否已有工具时间线（空 content 的 tool-only 回合也算）。 */
  function remoteAssistantHasToolTimeline(messageId: string): boolean {
    const mid = String(messageId || "").trim();
    if (!mid) return false;
    const live = agentLivePartsByServerMessageIdRef.current[mid] || [];
    if (
      live.some((part) => {
        const type = String((part as { type?: string }).type || "");
        const toolName = String((part as { toolName?: string }).toolName || "").trim();
        const toolCallId = String((part as { toolCallId?: string }).toolCallId || "").trim();
        return type === "toolCall" || !!toolName || !!toolCallId;
      })
    ) {
      return true;
    }
    const detailParts = agentDetailsByMessageIdRef.current[mid]?.parts || [];
    return detailParts.some((part) => {
      const type = String((part as { type?: string }).type || "");
      return type === "toolCall" || !!String((part as { toolCallId?: string }).toolCallId || "").trim();
    });
  }

  function migrateRemoteLiveParts(fromId: string, toId: string) {
    const from = String(fromId || "").trim();
    const to = String(toId || "").trim();
    if (!from || !to || from === to) return;
    commitAgentLiveParts((prev) => {
      const pending = prev[from];
      if (!pending?.length) return prev;
      const existing = prev[to] || [];
      const merged = [...existing];
      for (const part of pending) {
        const id = String((part as { id?: string }).id || "").trim();
        if (!id || merged.some((item) => String((item as { id?: string }).id || "") === id)) continue;
        merged.push(part);
      }
      const next = { ...prev, [to]: merged };
      delete next[from];
      return next;
    });
    setAgentDetailsByMessageId((prev) => {
      const detail = prev[from];
      if (!detail) return prev;
      const next = { ...prev, [to]: prev[to] || detail };
      delete next[from];
      agentDetailsByMessageIdRef.current = next;
      return next;
    });
  }

  /** 手机远程 run 的流式事件：直接写会话气泡/live parts（落盘轮询拿不到 delta）。 */
  function applyRemoteAgentLiveEvent(envelope: {
    sessionId?: string;
    runId?: string;
    event?: {
      type?: string;
      messageId?: string;
      index?: number;
      delta?: string;
      partial?: string;
      message?: AgentMessage;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      output?: unknown;
      isError?: boolean;
      status?: string;
      error?: string | null;
      /** message.started 的角色（user 的 started 不能绑成 assistant 气泡）。 */
      role?: string;
    };
  }) {
    const sid = String(envelope.sessionId || "").trim();
    const event = envelope.event;
    if (!sid || !event) return;
    const type = String(event.type || "");

    const patchRemoteSession = (
      titleHint: string | undefined,
      updater: (session: AgentChatSession) => AgentChatSession
    ) => {
      setAgentSessions((prev) => {
        const existing = prev.find((session) => session.id === sid);
        if (existing) {
          return prev.map((session) => (session.id === sid ? updater(session) : session));
        }
        const title =
          clipAgentSessionTitle(titleHint || "") ||
          `Session ${sid.slice(0, 8)}`;
        const created: AgentChatSession = {
          id: sid,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          turnStart: 0,
          loaded: true,
          nextCursor: undefined,
          hasMore: false
        };
        return [updater(created), ...prev];
      });
    };

    const ensureRemoteAssistantBubble = (mid: string) => {
      const messageId = mid.trim();
      if (!messageId) return;
      remoteAgentServerAssistantIdBySessionRef.current[sid] = messageId;
      setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sid]: messageId }));
      patchRemoteSession(undefined, (session) => {
        if (session.messages.some((item) => item.id === messageId)) {
          return { ...session, loaded: true, updatedAt: Date.now() };
        }
        const last = session.messages[session.messages.length - 1];
        const frozen = remoteFrozenAssistantIdsBySessionRef.current[sid];
        // 仅复用真正的空占位；已 completed / 已有工具时间线的 tool-only 气泡绝不能改 id，
        // 否则 details/live 孤儿化 → 工具数 1↔2 抖动。
        const canRemap =
          last?.role === "assistant" &&
          last.id.startsWith("assistant-") &&
          !String(last.content || "").trim() &&
          !frozen?.has(last.id) &&
          !remoteAssistantHasToolTimeline(last.id);
        if (canRemap) {
          if (last.id !== messageId) migrateRemoteLiveParts(last.id, messageId);
          return {
            ...session,
            messages: session.messages.map((item, index) =>
              index === session.messages.length - 1 ? { ...item, id: messageId } : item
            ),
            loaded: true,
            updatedAt: Date.now()
          };
        }
        return {
          ...session,
          messages: appendAssistantMessage(session.messages, {
            id: messageId,
            role: "assistant",
            content: ""
          }),
          loaded: true,
          updatedAt: Date.now()
        };
      });
    };

    const upsertRemoteToolPart = (part: AgentDetailedPart) => {
      let targetId = String(remoteAgentServerAssistantIdBySessionRef.current[sid] || "").trim();
      if (!targetId) {
        targetId = String(agentStreamingAssistantIdBySession[sid] || "").trim();
      }
      if (!targetId) return;
      const frozen = remoteFrozenAssistantIdsBySessionRef.current[sid];
      if (frozen?.has(targetId)) {
        // 已完成回合不再收新工具；等下一条 message.started 再建气泡。
        return;
      }
      upsertAgentLivePart(targetId, part);
    };

    if (
      type === "message.started" ||
      type === "message.delta" ||
      type === "reasoning.delta" ||
      type === "tool.started" ||
      type === "toolCall.started" ||
      type === "message.completed"
    ) {
      setAgentRunBusyBySession((prev) => (prev[sid] ? prev : { ...prev, [sid]: true }));
    }
    if (type === "session.status") {
      const status = String(event.status || "").trim();
      // 对齐手机：工具间隙可能短暂 idle，不能据此清 busy；终态靠 run.completed/failed。
      if (status === "running" || status === "busy") {
        setAgentRunBusyBySession((prev) => (prev[sid] ? prev : { ...prev, [sid]: true }));
      } else if (status === "aborted" || status === "failed") {
        setAgentRunBusyBySession((prev) => ({ ...prev, [sid]: false }));
        setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sid]: "" }));
        delete remoteAgentServerAssistantIdBySessionRef.current[sid];
        remoteFrozenAssistantIdsBySessionRef.current[sid]?.clear();
        replaceQueuedFollowUps(sid, []);
      }
      // idle：忽略 busy 翻转（否则会在 run.completed 之后把 busy 再点着，或中途抖掉停止态）。
    }
    if (type === "run.completed" || type === "run.failed") {
      setAgentRunBusyBySession((prev) => ({ ...prev, [sid]: false }));
      setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sid]: "" }));
      delete remoteAgentServerAssistantIdBySessionRef.current[sid];
      remoteFrozenAssistantIdsBySessionRef.current[sid]?.clear();
      if (type === "run.failed") replaceQueuedFollowUps(sid, []);
    }

    if (type === "message.completed" && event.message && typeof event.message === "object") {
      const message = event.message;
      const mapped = agentMessageToChatMessage(message);
      if (!mapped) return;
      if (mapped.role === "user") {
        const toolResults = new Map();
        const detailed = agentMessageToDetailedMessage(message, toolResults);
        setAgentDetailsByMessageId((prev) => {
          const next = { ...prev, [message.id]: detailed };
          agentDetailsByMessageIdRef.current = next;
          return next;
        });
        patchRemoteSession(mapped.content, (session) => {
          if (session.messages.some((item) => item.id === mapped.id)) {
            return {
              ...session,
              title: session.title.trim() || clipAgentSessionTitle(mapped.content) || session.title,
              messages: session.messages.map((item) => (
                item.id === mapped.id
                  ? mergeCompletedUserChatMessage({ ...item, ...mapped }, item)
                  : item
              )),
              loaded: true,
              updatedAt: Date.now()
            };
          }
          // 与本地路径一致：同一服务端 user 只消费一次 pending，避免连发乐观气泡被吃掉。
          const done = agentCompletedRemoteUserIdsBySessionRef.current[sid] || new Set<string>();
          if (done.has(mapped.id)) {
            return session;
          }
          done.add(mapped.id);
          agentCompletedRemoteUserIdsBySessionRef.current[sid] = done;
          const userText = String(mapped.content || "").trim();
          // 按会话 pending 队列 FIFO remap（与本地 prompt 路径一致），禁止同文匹配。
          const bag = agentPendingLocalUserIdsBySessionRef.current[sid] || [];
          const pendingId = bag.shift() || "";
          agentPendingLocalUserIdsBySessionRef.current[sid] = bag;
          let replacedOptimistic = false;
          let messages = session.messages.flatMap((item) => {
            if (item.id === mapped.id) {
              replacedOptimistic = true;
              return [mergeCompletedUserChatMessage(
                { ...mapped, attachments: item.attachments || mapped.attachments },
                item
              )];
            }
            if (pendingId && item.id === pendingId) {
              replacedOptimistic = true;
              return [mergeCompletedUserChatMessage(
                { ...mapped, attachments: item.attachments || mapped.attachments },
                item
              )];
            }
            // 兜底：队列丢失时仍允许替换最早一条乐观（仅无 pendingId 时）。
            if (
              !pendingId
              && !replacedOptimistic
              && item.role === "user"
              && (item.id.startsWith("user-") || item.id.startsWith("steer-"))
              && userText
              && String(item.content || "").trim() === userText
            ) {
              replacedOptimistic = true;
              return [mergeCompletedUserChatMessage(
                { ...mapped, attachments: item.attachments || mapped.attachments },
                item
              )];
            }
            return [item];
          });
          if (!replacedOptimistic) {
            if (pendingId) {
              const restore = agentPendingLocalUserIdsBySessionRef.current[sid] || [];
              restore.unshift(pendingId);
              agentPendingLocalUserIdsBySessionRef.current[sid] = restore;
            }
            const streamingId = String(
              remoteAgentServerAssistantIdBySessionRef.current[sid]
              || agentStreamingAssistantIdBySession[sid]
              || ""
            ).trim();
            const frozen = remoteFrozenAssistantIdsBySessionRef.current[sid];
            const liveActive = Boolean(streamingId) && !frozen?.has(streamingId);
            messages = commitUserBeforeLiveAssistant(
              messages,
              mergeCompletedUserChatMessage(mapped),
              liveActive ? streamingId : ""
            );
          }
          const seen = new Set<string>();
          messages = messages.filter((item) => {
            if (item.id !== mapped.id) return true;
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
          return {
            ...session,
            title: session.title.trim() || clipAgentSessionTitle(mapped.content) || session.title,
            messages,
            loaded: true,
            updatedAt: Date.now()
          };
        });
        popQueuedFollowUp(sid, mapped.content);
        return;
      }
      if (mapped.role === "assistant") {
        const toolResults = new Map();
        const detailed = agentMessageToDetailedMessage(message, toolResults);
        setAgentDetailsByMessageId((prev) => {
          const next = { ...prev, [message.id]: detailed };
          agentDetailsByMessageIdRef.current = next;
          return next;
        });
        // 冻结本回合：后续 message.started 必须新开气泡，不能改写本 id。
        const frozen = remoteFrozenAssistantIdsBySessionRef.current[sid] || new Set<string>();
        frozen.add(message.id);
        remoteFrozenAssistantIdsBySessionRef.current[sid] = frozen;
        // 把 history 工具并入 live，避免仅有 text:* live 时整表盖掉 details 里的工具。
        const live = agentLivePartsByServerMessageIdRef.current[message.id] || [];
        const hasLiveTools = live.some((part) => {
          const partType = String((part as { type?: string }).type || "");
          return partType === "toolCall" || !!String((part as { toolCallId?: string }).toolCallId || "").trim();
        });
        if (!hasLiveTools) {
          for (const part of detailed.parts || []) {
            const partType = String((part as { type?: string }).type || "");
            if (partType === "toolCall") upsertAgentLivePart(message.id, part);
          }
        }
        patchRemoteSession(undefined, (session) => {
          const hit = session.messages.findIndex((item) => item.id === mapped.id);
          if (hit >= 0) {
            const messages = session.messages.slice();
            messages[hit] = { ...messages[hit], ...mapped };
            return { ...session, messages, loaded: true, updatedAt: Date.now() };
          }
          // 禁止把 tools 合并进「另一个」空 content assistant：那会丢 id 绑定。
          return {
            ...session,
            messages: [...session.messages, mapped],
            loaded: true,
            updatedAt: Date.now()
          };
        });
      }
      return;
    }

    if (type === "message.started") {
      const mid = String(event.messageId || "").trim();
      if (!mid) return;
      const startedRole = String(event.role || "").trim().toLowerCase();
      if (
        mid.startsWith("user-") ||
        startedRole === "user" ||
        startedRole === "tool" ||
        startedRole === "custom"
      ) {
        return;
      }
      ensureRemoteAssistantBubble(mid);
      return;
    }

    if (type === "toolCall.started") {
      const toolCallId = String(event.toolCallId || "").trim();
      if (!toolCallId) return;
      upsertRemoteToolPart(
        buildToolPart({
          toolCallId,
          toolName: event.toolName || "",
          status: "running"
        })
      );
      return;
    }

    if (type === "tool.started") {
      const toolCallId = String(event.toolCallId || "").trim();
      if (!toolCallId) return;
      upsertRemoteToolPart(
        buildToolPart({
          toolCallId,
          toolName: event.toolName || "",
          status: "running",
          input: event.input
        })
      );
      return;
    }

    if (type === "tool.progress") {
      const toolCallId = String(event.toolCallId || "").trim();
      if (!toolCallId) return;
      upsertRemoteToolPart(
        buildToolPart({
          toolCallId,
          toolName: event.toolName || "",
          status: "running",
          output: event.output
        })
      );
      return;
    }

    if (type === "tool.completed") {
      const toolCallId = String(event.toolCallId || "").trim();
      if (!toolCallId) return;
      upsertRemoteToolPart(
        buildToolPart({
          toolCallId,
          toolName: event.toolName || "",
          status: event.isError ? "error" : "completed",
          output: event.output
        })
      );
      return;
    }

    if (type === "message.delta") {
      const mid = String(event.messageId || "").trim();
      if (!mid) return;
      const snapshot = String(event.partial || "");
      const delta = String(event.delta || "");
      if (!snapshot && !delta) return;
      remoteAgentServerAssistantIdBySessionRef.current[sid] = mid;
      setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sid]: mid }));
      patchRemoteSession(undefined, (session) => {
        let found = false;
        const messages = session.messages.map((item) => {
          if (item.id !== mid) return item;
          found = true;
          const content = snapshot || `${item.content || ""}${delta}`;
          return content === item.content ? item : { ...item, content };
        });
        if (!found) {
          messages.push({ id: mid, role: "assistant", content: snapshot || delta });
        }
        return { ...session, messages, loaded: true, updatedAt: Date.now() };
      });
      const textPartId = `text:${Number(event.index) || 0}`;
      if (snapshot) setAgentLivePartField(mid, textPartId, "text", snapshot);
      else patchAgentLivePartDelta(mid, textPartId, "text", delta);
      return;
    }

    if (type === "reasoning.delta") {
      const mid = String(event.messageId || "").trim();
      if (!mid) return;
      const snapshot = String(event.partial || "");
      const delta = String(event.delta || "");
      if (!snapshot && !delta) return;
      ensureRemoteAssistantBubble(mid);
      const reasoningPartId = `reasoning:${Number(event.index) || 0}`;
      if (snapshot) setAgentLivePartField(mid, reasoningPartId, "text", snapshot);
      else patchAgentLivePartDelta(mid, reasoningPartId, "text", delta);
    }
  }

  function beginAgentSessionHydration(sessionId: string) {
    const id = sessionId.trim();
    if (!id) return;
    agentHydratingSessionIdRef.current = id;
    setAgentHydratingSessionId(id);
  }

  function endAgentSessionHydration(sessionId: string) {
    const id = sessionId.trim();
    if (!id || agentHydratingSessionIdRef.current !== id) return;
    agentHydratingSessionIdRef.current = "";
    setAgentHydratingSessionId("");
  }

  function clearAgentSessionHydration() {
    agentHydratingSessionIdRef.current = "";
    setAgentHydratingSessionId("");
  }

  function clearPendingSidebarSessionSelection() {
    pendingSidebarSessionSelectionRef.current = null;
  }

  function openSidebarAgentSession(repo: RepositoryEntry, session: ChatSessionSummary) {
    setMainMode("agent");
    pendingSidebarSessionSelectionRef.current = { repoId: repo.id, sessionId: session.id };
    const cachedSession = agentSessions.find((item) => item.id === session.id) ?? null;
    // 远程 run 过程中会话可能已有 live 消息：直接展示，避免 hydration 卡在 getMessages 锁上转圈。
    const hasLiveMessages = Boolean(cachedSession?.messages?.length);
    const shouldHydrate =
      (selectedRepo?.id !== repo.id || !cachedSession?.loaded) && !hasLiveMessages;
    if (shouldHydrate) beginAgentSessionHydration(session.id);
    else endAgentSessionHydration(session.id);
    setAgentSessions((prev) => {
      const hit = prev.findIndex((s) => s.id === session.id);
      if (hit >= 0) {
        return prev.map((s) =>
          s.id === session.id
            ? {
              ...s,
              title: s.title,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              loaded: hasLiveMessages ? true : s.loaded
            }
            : s
        );
      }
      return [
        {
          ...agentSessionFromSummary(session),
          loaded: false
        },
        ...prev
      ];
    });
    setAgentSessionFetchLimit(getRepoSessionFetchLimit(repo.id));
    setNewSessionTargetRepoId(repo.id);
    agentSessionsRepoIdRef.current = repo.id;
    if (selectedRepo?.id !== repo.id) setSelectedRepo(repo);
    if ((rightPaneTabRef.current === "changes" || rightPaneTabRef.current === "worktree") && gitPaneRepo?.id !== repo.id) setGitPaneRepo(repo);
    setDraftAgentSession(false);
    selectAgentSession(session.id, "click");
    bindAgentSessionToWorkspace(session.id, repo.path, repo.name);
    void agentClient.getSession(session.id).then((summary) => {
      const provider = String(summary.provider || "").trim();
      const model = String(summary.model || "").trim();
      if (!provider || !model) return;
      updateAgentSessionById(summary.sessionId, (row) => ({ ...row, provider, model }));
      if (activeAgentSessionIdRef.current === summary.sessionId) {
        setAgentModelProvider(provider);
        setAgentSelectedModel(model);
      }
    }).catch((error) => {
      appendAgentDebugLog(`session.getModel.error ${session.id} ${String(error)}`);
    });
    void loadAgentSessionMessages(session.id, repo.path).catch((e) => setError(String(e)));
  }

  // ⌘F / Ctrl+F 全局打开搜索面板。Tauri webview 无原生 find 占用，安全拦截默认行为。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        event.stopPropagation();
        setSearchPanelOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 跨会话命中：目标会话 active 后即下发 messageId（不必等 loading 结束）。
  // 若等 loaded 才下发，loading→就绪首帧 pending 为空，wake/scrollToIndex(LAST) 会抢跑到底。
  const locateScrollMessageId = useMemo(() => {
    const direct = pendingScrollMessageId.trim();
    if (direct) return direct;
    if (!pendingScrollTarget) return "";
    if (activeAgentSessionId !== pendingScrollTarget.sessionId) return "";
    return pendingScrollTarget.messageId.trim();
  }, [pendingScrollMessageId, pendingScrollTarget, activeAgentSessionId]);

  function clearLocateRequest() {
    locateInFlightRef.current = false;
    setPendingScrollMessageId("");
    setPendingScrollTarget(null);
  }

  function handleSearchLocate(hit: SearchHit, query: string) {
    setSearchPanelOpen(false);
    setHighlightKeyword(query.trim());
    setLocateNonce((n) => n + 1);
    locateInFlightRef.current = true;
    // 定位后不应自动追底，否则 followOutput / 其它滚 LAST 会把视口再次拽走。
    setAgentAutoFollowLatest(false);
    setAgentShowJumpLatest(true);
    // 当前会话且已加载：直接定位。
    if (hit.sessionId === activeAgentSessionId && activeAgentSession?.loaded && !agentSessionLoading) {
      setPendingScrollTarget(null);
      setPendingScrollMessageId(hit.messageId);
      return;
    }
    // 先写入 pending，再切会话，确保切会话 effect 能看到定位意图。
    setPendingScrollMessageId("");
    setPendingScrollTarget({ sessionId: hit.sessionId, messageId: hit.messageId });
    const repo = repos.find((r) => normalizeWorkspacePath(r.path) === normalizeWorkspacePath(hit.repoPath)) ?? null;
    if (repo) {
      // 复用侧栏打开会话的完整范式：确保 agentSessions 占位、repo 切换、bind 一应俱全，
      // 否则 loadAgentSessionMessages 的 update 找不到目标会话、messages 写不进去。
      openSidebarAgentSession(repo, {
        id: hit.sessionId,
        title: hit.sessionTitle,
        createdAt: hit.updatedAtMs,
        updatedAt: hit.updatedAtMs
      });
    } else {
      // 命中仓库已不在列表（少见）：最小努力切换 + 绑定 + 加载。
      selectAgentSession(hit.sessionId, "click");
      bindAgentSessionToWorkspace(hit.sessionId, hit.repoPath, hit.repoName);
      void loadAgentSessionMessages(hit.sessionId, hit.repoPath).catch((e) => setError(String(e)));
    }
  }

  async function fetchAgentDetailedMessagePage(
    sessionId: string,
    before: string,
    limit: number,
    minFetchedAt = 0,
    repoPathArg = repoPath
  ) {
    const id = sessionId.trim();
    const targetRepoPath = repoPathArg.trim();
    const safeBefore = before.trim();
    const safeLimit = Math.max(2, limit);
    const cacheKey = agentMessageCache.getPageCacheKey(targetRepoPath, id, safeBefore, safeLimit);
    const cached = agentMessageCache.getPageCacheEntry(targetRepoPath, id, safeBefore, safeLimit);
    if (cached && cached.fetchedAt >= minFetchedAt) {
      appendAgentDebugLog("agent.messages page cache hit " + id);
      return cached;
    }
    const inflight = agentMessageCache.getPageInflight(cacheKey);
    if (inflight) return inflight;

    let task!: Promise<AgentMessagePageCacheEntry>;
    task = (async () => {
      const agentMessages = await agentClient.getMessages(id);
      const toolResults = agentToolResultsByCallId(agentMessages);
      const detailsById: Record<string, AgentDetailedMessage> = {};
      const mapped: AgentChatMessage[] = [];
      for (const message of agentMessages) {
        detailsById[message.id] = agentMessageToDetailedMessage(message, toolResults);
        if (message.role !== "user" && message.role !== "assistant") continue;
        const mappedMessage = agentMessageToChatMessage(message);
        if (mappedMessage) mapped.push(mappedMessage);
      }
      const entry: AgentMessagePageCacheEntry = {
        before: safeBefore,
        limit: safeLimit,
        items: mapped,
        detailsById,
        nextCursor: undefined,
        hasMore: false,
        fetchedAt: Date.now()
      };
      // 仅当本 task 仍是当前 inflight 时写入缓存，避免被 force/invalidate 顶替后的旧请求回写脏数据。
      if (agentMessageCache.getPageInflight(cacheKey) === task) {
        agentMessageCache.setPageEntry(targetRepoPath, id, entry);
      }
      return entry;
    })().finally(() => {
      agentMessageCache.clearPageInflight(cacheKey, task);
    });
    agentMessageCache.setPageInflight(cacheKey, task);
    return task;
  }

  async function refreshSidebarRepoSessions(
    repo: RepositoryEntry,
    options?: {
      limit?: number;
      silent?: boolean;
      paging?: boolean;
    }
  ) {
    const repoId = repo.id.trim();
    const repoPathArg = repo.path.trim();
    if (!repoId || !repoPathArg) return;
    const limit = Math.max(AGENT_SESSION_PAGE_SIZE, options?.limit ?? getRepoSessionFetchLimit(repoId));
    const silent = options?.silent === true;
    const paging = options?.paging === true;
    const requestSeq = (sidebarAgentSessionRequestSeqRef.current[repoId] || 0) + 1;
    sidebarAgentSessionRequestSeqRef.current[repoId] = requestSeq;
    if (paging) {
      setSidebarAgentSessionPagingByRepo((prev) => ({ ...prev, [repoId]: true }));
    } else if (!silent) {
      setSidebarAgentSessionLoadingByRepo((prev) => ({ ...prev, [repoId]: true }));
    }
    try {
      const listed = (await agentClient.listSessions())
        .filter((session) => normalizeWorkspacePath(session.repoPath) === normalizeWorkspacePath(repoPathArg))
        .filter(isPrimaryAgentSessionSummary);
      const rows = listed
        .map(agentSummaryToChatSummary)
        // 先按活跃度排序再截断：后端分页顺序不该决定谁进第一页。
        .sort(compareAgentSessionActivity)
        .slice(0, limit + 1);
      if (sidebarAgentSessionRequestSeqRef.current[repoId] !== requestSeq) return;
      const sorted = sortAgentSessionSummaries(filterVisibleAgentSessionsForRepo(repoId, rows || []));
      const hasMore = sorted.length > limit;
      sidebarAgentSessionLoadedByRepoRef.current = {
        ...sidebarAgentSessionLoadedByRepoRef.current,
        [repoId]: true
      };
      setSidebarAgentSessionsByRepo((prev) => {
        const cachedSessions = (prev[repoId] || []).filter((session) => !isLocallyArchivedAgentSession(repoId, session.id));
        const cachedById = new Map(cachedSessions.map((item) => [item.id, item]));
        const activeById = new Map(agentSessions.map((item) => [item.id, item]));
        const mapped = sorted.slice(0, limit).map((s, i) => {
          const base = agentSessionFromSummary(s, i + 1);
          const cached = cachedById.get(base.id) || activeById.get(base.id);
          return cached && cached.title.trim() ? { ...base, title: cached.title } : base;
        });
        if (!paging) return { ...prev, [repoId]: mapped };

        const mappedById = new Map(mapped.map((item) => [item.id, item]));
        const kept = cachedSessions
          .map((session) => mappedById.get(session.id))
          .filter((session): session is AgentChatSession => Boolean(session));
        const keptIds = new Set(kept.map((session) => session.id));
        const appended = mapped.filter((session) => !keptIds.has(session.id));
        return { ...prev, [repoId]: [...kept, ...appended] };
      });
      sidebarAgentSessionFetchLimitByRepoRef.current = {
        ...sidebarAgentSessionFetchLimitByRepoRef.current,
        [repoId]: limit
      };
      setSidebarAgentSessionFetchLimitByRepo((prev) => ({ ...prev, [repoId]: limit }));
      setSidebarAgentSessionHasMoreByRepo((prev) => ({ ...prev, [repoId]: hasMore }));
    } finally {
      if (paging && sidebarAgentSessionRequestSeqRef.current[repoId] === requestSeq) {
        setSidebarAgentSessionPagingByRepo((prev) => ({ ...prev, [repoId]: false }));
      } else if (!silent && sidebarAgentSessionRequestSeqRef.current[repoId] === requestSeq) {
        setSidebarAgentSessionLoadingByRepo((prev) => ({ ...prev, [repoId]: false }));
      }
    }
  }

  async function loadMoreSidebarRepoSessions(repo: RepositoryEntry) {
    const repoId = repo.id.trim();
    if (!repoId) return;
    if (sidebarAgentSessionLoadingByRepo[repoId] || sidebarAgentSessionPagingByRepo[repoId]) return;
    const nextLimit = getRepoSessionFetchLimit(repoId) + AGENT_SESSION_PAGE_SIZE;
    await refreshSidebarRepoSessions(repo, { limit: nextLimit, paging: true });
    if (repoId === selectedRepo?.id) {
      setAgentSessionFetchLimit(nextLimit);
      await refreshAgentSessions(nextLimit);
    }
  }

  async function refreshAgentSessions(
    limitArg?: number
  ): Promise<{ mapped: AgentChatSession[]; empty: boolean }> {
    if (!ensureRepoSelected()) return { mapped: [], empty: true };
    const repoIdAtRequest = selectedRepo?.id || "";
    const pendingAtRequest = pendingSidebarSessionSelectionRef.current;
    const limit = Math.max(AGENT_SESSION_PAGE_SIZE, limitArg ?? agentSessionFetchLimit);
    appendAgentDebugLog("session.list requested");
    const listed = (await agentClient.listSessions())
      .filter((session) => normalizeWorkspacePath(session.repoPath) === normalizeWorkspacePath(repoPath))
      .filter(isPrimaryAgentSessionSummary);
    const rows = listed
      .map(agentSummaryToChatSummary)
      // 先按活跃度排序再截断：后端分页顺序不该决定谁进第一页。
      .sort(compareAgentSessionActivity)
      .slice(0, limit);
    const visibleRows = filterVisibleAgentSessionsForRepo(repoIdAtRequest, rows || []);
    if (!visibleRows || visibleRows.length === 0) {
      appendAgentDebugLog("session.list empty");
      agentSessionsRepoIdRef.current = selectedRepo?.id || "";
      // 空列表：后台数据通道无权清空用户选中或擅自进入草稿态。仅按 pending 补入列表数据；
      // 是否进入草稿交由 bootstrap（仅末轮）决定。
      const pendingForEmptyRepo = pendingAtRequest && pendingAtRequest.repoId === repoIdAtRequest ? pendingAtRequest : null;
      if (pendingForEmptyRepo) {
        const sidebarHit = (sidebarAgentSessionsByRepo[repoIdAtRequest] || []).find((session) => session.id === pendingForEmptyRepo.sessionId);
        const cachedHit = agentSessions.find((session) => session.id === pendingForEmptyRepo.sessionId);
        const pendingSession = sidebarHit || cachedHit;
        if (pendingSession) {
          const rescued = [{ ...agentSessionFromSummary(pendingSession), loaded: false }];
          setAgentSessions(rescued);
          pendingSidebarSessionSelectionRef.current = null;
          return { mapped: rescued, empty: false };
        }
      }
      setAgentSessions([]);
      return { mapped: [], empty: true };
    }
    appendAgentDebugLog(`session.list loaded ${visibleRows.length}`);
    // 列表锚定：保留已有会话的相对顺序仅合并元数据；新会话按活动时间降序头部追加。
    // 避免 passive-sync 每轮全排序重排导致用户失位，也消除「自动跳会话」的排序温床。
    const prevList = agentSessionsRef.current;
    const incomingById = new Map(visibleRows.map((s) => [s.id, s] as const));
    const preserved = prevList
      .filter((s) => incomingById.has(s.id))
      .map((s) => {
        const freshRow = incomingById.get(s.id)!;
        return {
          ...s,
          title: s.title.trim() || freshRow.title,
          createdAt: freshRow.createdAt,
          updatedAt: freshRow.updatedAt,
          // 服务端 catalog 是模型真相：列表刷新时覆盖本地会话上的 provider/model。
          ...(freshRow.provider ? { provider: freshRow.provider } : {}),
          ...(freshRow.model ? { model: freshRow.model } : {}),
        };
      });
    const freshRows = sortAgentSessionSummaries(visibleRows.filter((s) => !prevList.some((p) => p.id === s.id))).map((s, i) => agentSessionFromSummary(s, i + 1));
    let mappedBase = [...freshRows, ...preserved];
    const pendingForRepo = pendingAtRequest && pendingAtRequest.repoId === repoIdAtRequest ? pendingAtRequest : null;
    if (pendingForRepo && !mappedBase.some((session) => session.id === pendingForRepo.sessionId)) {
      const sidebarHit = (sidebarAgentSessionsByRepo[repoIdAtRequest] || []).find((session) => session.id === pendingForRepo.sessionId);
      const cachedHit = agentSessions.find((session) => session.id === pendingForRepo.sessionId);
      const pendingSession = sidebarHit || cachedHit;
      if (pendingSession) {
        mappedBase = [pendingSession, ...mappedBase];
      }
    }
    // 用户当前手选的会话即使不在本次 list 结果里（后端分页/延迟/排序差异），
    // 只要上一轮缓存或 sidebar 持久记录仍认得它，就补进列表——否则被动刷新
    // （passive-sync 每 1.5s/5s 触发一次）会让重选回退到 workspace 绑定会话或
    // 列表首个，表现为「点会话一、几秒后自动跳到会话二」。
    const activeIdForRescue = activeAgentSessionId;
    if (activeIdForRescue && !mappedBase.some((session) => session.id === activeIdForRescue)) {
      const cachedHit = agentSessions.find((session) => session.id === activeIdForRescue);
      if (cachedHit) {
        mappedBase = [cachedHit, ...mappedBase];
      } else {
        const sidebarHit = (sidebarAgentSessionsByRepo[repoIdAtRequest] || []).find((session) => session.id === activeIdForRescue);
        if (sidebarHit) {
          mappedBase = [agentSessionFromSummary(sidebarHit), ...mappedBase];
        }
      }
    }
    agentSessionsRepoIdRef.current = repoIdAtRequest;
    // 缓存来源统一用 agentSessionsRef.current（同步镜像），避免闭包读到旧列表。
    const cacheById = new Map(prevList.map((s) => [s.id, s] as const));
    const mapped = mappedBase.map((session) => {
      const cached = cacheById.get(session.id);
      return cached
        ? {
          ...cached,
          title: cached.title.trim() || session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          ...(session.provider ? { provider: session.provider } : {}),
          ...(session.model ? { model: session.model } : {}),
        }
        : session;
    });
    setAgentSessions(mapped);
    // pending 命中后消费一次（active 已由 selectAgentSession 在点击入口同步设好，无需这里再写）。
    if (pendingSidebarSessionSelectionRef.current?.repoId === repoIdAtRequest) {
      pendingSidebarSessionSelectionRef.current = null;
    }
    setDraftAgentSession(false);

    // 数据通道对账：只观察意图 token 对应会话是否仍在列表，绝不改写 active。
    // 不在列表时置 stale 提示用户手动切换，是「点会话一、几秒后跳会话二」的最终防线。
    const intent = agentSelectionIntentRef.current;
    if (intent?.sessionId && !mapped.some((s) => s.id === intent.sessionId)) {
      appendAgentDebugLog(`session.reconcile.stale seq=${intent.seq} id=${intent.sessionId} reason=${intent.reason}`);
      setAgentActiveSessionStale(true);
    } else if (agentActiveSessionStale) {
      setAgentActiveSessionStale(false);
    }
    return { mapped, empty: false };
  }

  async function loadMoreAgentSessions() {
    const nextLimit = agentSessionFetchLimit + AGENT_SESSION_PAGE_SIZE;
    setAgentSessionFetchLimit(nextLimit);
    await refreshAgentSessions(nextLimit);
  }

  async function loadAgentSessionMessages(sessionId: string, repoPathArg = repoPath) {
    if (!repoPathArg.trim() && !ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    appendAgentDebugLog(`session.messages load ${id}`);
    // 已有 live 远程消息时先结束转圈，后台再对账；避免 prompt 持锁导致长时间空白。
    const existingBeforeLoad = agentSessionsRef.current.find((session) => session.id === id);
    if (existingBeforeLoad?.messages?.length) {
      updateAgentSessionById(id, (session) => ({ ...session, loaded: true }));
      endAgentSessionHydration(id);
    }
    try {
      const agentMessages = await agentClient.getMessages(id);
      // 历史是完成态的唯一事实来源：同步构建详情 parts（reasoning/工具卡片），
      // 否则渲染回退 content，过程时间线在完成后消失（且占位文案泄漏进正文）。
      const toolResults = agentToolResultsByCallId(agentMessages);
      const detailsById: Record<string, AgentDetailedMessage> = {};
      for (const message of agentMessages) {
        detailsById[message.id] = agentMessageToDetailedMessage(message, toolResults);
      }
      // 冷启动回填：abort 的 task 往往没有 childSessionId，靠 catalog 子会话补上并恢复 timeline。
      const hydratedDetailsById = await hydrateTaskPartsFromChildSessions(id, detailsById);
      setAgentDetailsByMessageId((prev) => {
        const next = { ...prev };
        for (const [messageId, detail] of Object.entries(hydratedDetailsById)) {
          const existing = prev[messageId];
          const existingParts = Array.isArray(existing?.parts) ? existing.parts : [];
          const incomingParts = Array.isArray(detail.parts) ? detail.parts : [];
          const liveParts = agentLivePartsByServerMessageIdRef.current[messageId] || [];
          // 暂停/中止后 history 往往比 live 瘦（无批并行子卡、无 timeline）。
          // 有 live 或已有更丰富 details 时不要用瘦 history 盖掉。
          if (liveParts.length > 0 || existingParts.length > incomingParts.length) {
            if (!existing) next[messageId] = detail;
            continue;
          }
          next[messageId] = detail;
        }
        return next;
      });
      const currentSession = agentSessionsRef.current.find((s) => s.id === id);
      // 运行中：事件流是消息列表事实来源。history 整表替换会把尚未 remap 的 user-/assistant-
      // 与服务端 id 并排（同文连发必现双气泡）。只更新 details，不动 messages。
      if (String(agentRunIdBySessionRef.current[id] || "").trim()) {
        appendAgentDebugLog(`session.messages load ${id} skipped (run active, details only)`);
        return;
      }
      const baseMapped = agentMessages
        .map(agentMessageToChatMessage)
        .filter((message): message is AgentChatMessage => Boolean(message));
      // 纯文本模型能力分流会丢弃 image block（避免 provider HTTP 400），pi 历史 user message 因此无 image part。
      // 复用 mergeAgentMessageAttachments：按 id/content 把重载前 optimistic 消息里的用户图片补回，
      // 否则回复完成后用户发的图会从气泡消失。
      let mapped = mergeAgentMessageErrors(
        currentSession?.messages,
        mergeAgentMessageAttachments(currentSession?.messages, baseMapped)
      );
      // 非运行中：history 为唯一真相。按 local→server 映射回填更长正文，绝不 push 乐观影子行。
      if (currentSession?.messages?.length) {
        const localIdByServerId = new Map<string, string>();
        for (const [localId, serverId] of Object.entries(agentServerMessageIdByLocalIdRef.current)) {
          const sid = String(serverId || "").trim();
          const lid = String(localId || "").trim();
          if (sid && lid) localIdByServerId.set(sid, lid);
        }
        const liveTextFromParts = (serverMessageId: string, localId?: string) => {
          const parts =
            agentLivePartsByServerMessageIdRef.current[serverMessageId]
            || (localId ? agentLivePartsByServerMessageIdRef.current[localId] : undefined)
            || [];
          return parts
            .map((part) => {
              if (String((part as { type?: string }).type || "") !== "text") return "";
              return String((part as { text?: string }).text || "").trim();
            })
            .filter(Boolean)
            .join("\n\n");
        };
        mapped = mapped.map((item) => {
          if (item.role !== "assistant") return item;
          const localId = localIdByServerId.get(item.id);
          const live = currentSession.messages.find(
            (row) => row.id === item.id || (localId != null && row.id === localId)
          );
          const richer = pickPreferredAgentContent(
            item.content,
            live?.content,
            liveTextFromParts(item.id, localId)
          );
          if (richer && richer !== item.content) {
            return { ...item, content: richer };
          }
          return item;
        });
        // history 可能缺最终 assistant（JSONL 未落盘）：保留 live 末尾气泡，避免闪过后被抹掉。
        mapped = mergeHistoryMessagesPreservingLive(mapped, currentSession.messages, {
          hasLiveParts: (messageId) => {
            const parts =
              agentLivePartsByServerMessageIdRef.current[messageId]
              || [];
            return parts.some((part) => {
              const type = String((part as { type?: string }).type || "");
              if (type === "text") return Boolean(String((part as { text?: string }).text || "").trim());
              return false;
            });
          },
          pickContent: (historyContent, liveContent) =>
            pickPreferredAgentContent(historyContent, liveContent)
        });
      }
      // 如果消息内容没有实际变化，避免替换数组引用导致重新渲染
      if (currentSession && currentSession.loaded && currentSession.messages.length > 0) {
        const current = currentSession.messages;
        if (current.length === mapped.length) {
          const isSame = current.every((msg, idx) => {
            const next = mapped[idx];
            if (!next || msg.id !== next.id || msg.role !== next.role || msg.content !== next.content) {
              return false;
            }
            const currentAttachments = msg.attachments || [];
            const nextAttachments = next.attachments || [];
            if (currentAttachments.length !== nextAttachments.length) return false;
            return currentAttachments.every((item, attachmentIndex) => {
              const other = nextAttachments[attachmentIndex];
              return Boolean(other) && item.uri === other.uri && item.mime === other.mime;
            });
          });
          if (isSame) {
            appendAgentDebugLog(`session.messages load ${id} skipped (unchanged)`);
            return;
          }
        }
      }
      updateAgentSessionById(id, (session) => ({
        ...session,
        messages: mapped,
        loaded: true,
        nextCursor: undefined,
        hasMore: false,
        updatedAt: Date.now()
      }));
      appendAgentDebugLog(`agent.messages loaded ${id} count=${mapped.length}`);
    } catch (e) {
      appendAgentDebugLog(`session.messages load ${id} failed: ${e}`);
      updateAgentSessionById(id, (session) => {
        return {
          ...session,
          // 保留现有乐观消息（尤其是失败卡片），避免一次网络抖动清空整个列表。
          messages: session.messages,
          turnStart: 0,
          loaded: true,
          updatedAt: Date.now()
        };
      });
    } finally {
      endAgentSessionHydration(id);
    }
  }

  async function loadMoreAgentSessionMessages(sessionId: string) {
    if (!ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    const session = agentSessions.find((s) => s.id === id);
    if (!session) return;
    appendAgentDebugLog(`session.messages load more ${id}`);
    const before = (session.nextCursor || "").trim();
    if (!before) {
      agentLoadingOlderRef.current = false;
      return;
    }
    try {
      const page = await fetchAgentDetailedMessagePage(id, before, AGENT_OLDER_MESSAGE_FETCH_LIMIT);
      const merged = [...page.items, ...session.messages].filter((msg, index, arr) => arr.findIndex((item) => item.id === msg.id) === index);
      if (Object.keys(page.detailsById).length > 0) {
        setAgentDetailsByMessageId((prev) => ({ ...prev, ...page.detailsById }));
      }
      updateAgentSessionById(id, (s) => ({
        ...s,
        messages: merged,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        updatedAt: Date.now()
      }));
      appendAgentDebugLog(`session.messages load more ${id} count=${merged.length} hasMore=${page.hasMore}`);
      prefetchNextAgentHistoryPage({
        ...session,
        messages: merged,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore
      });
    } catch (e) {
      appendAgentDebugLog(`session.messages load more ${id} failed: ${e}`);
    } finally {
      // virtuoso 在 data 前部插入时自动保持视觉锚点，无需手动 scrollTop 调整。
      agentLoadingOlderRef.current = false;
    }
  }

  function prefetchNextAgentHistoryPage(session: AgentChatSession | null) {
    if (!session?.hasMore) return;
    const before = (session.nextCursor || "").trim();
    if (!before) return;
    void fetchAgentDetailedMessagePage(session.id, before, AGENT_OLDER_MESSAGE_FETCH_LIMIT).catch(() => {
      /* keep prefetch silent */
    });
  }

  async function loadAgentMessageDetails(sessionId: string, messageId: string, limit = 80) {
    if (!ensureRepoSelected()) return;
    const id = sessionId.trim();
    if (!id) return;
    const mid = messageId.trim();
    if (!mid) return;
    const serverMid = (agentServerMessageIdByLocalId[mid] || "").trim() || mid;
    setAgentDetailsErrorByMessageId((prev) => ({ ...prev, [mid]: "" }));
    setAgentDetailsLoadingByMessageId((prev) => ({ ...prev, [mid]: true }));
    appendAgentDebugLog(`session.messages detailed load ${id} message=${serverMid}`);
    try {
      const agentMessages = await agentClient.getMessages(id);
      const toolResults = agentToolResultsByCallId(agentMessages);
      const hit = agentMessages
        .map((message) => agentMessageToDetailedMessage(message, toolResults))
        .find((m) => String(m?.info?.id || "") === serverMid) ?? null;
      setAgentDetailsByMessageId((prev) => {
        const cur = prev[mid];
        try {
          if (cur && hit && JSON.stringify(cur) === JSON.stringify(hit)) return prev;
        } catch {
          /* ignore */
        }
        return { ...prev, [mid]: hit };
      });
      appendAgentDebugLog(`session.messages detailed loaded ${id} message=${serverMid} hit=${hit ? 1 : 0} total=${agentMessages.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "unknown error");
      setAgentDetailsErrorByMessageId((prev) => ({ ...prev, [mid]: msg }));
      appendAgentDebugLog(`session.messages detailed failed ${id} message=${serverMid} ${msg}`);
    } finally {
      setAgentDetailsLoadingByMessageId((prev) => ({ ...prev, [mid]: false }));
    }
  }

  async function createPersistedAgentSession(seedPrompt?: string): Promise<string> {
    if (!ensureRepoSelected()) return "";
    appendAgentDebugLog("session.create requested");
    const parsedModel = normalizeModelRef(activeAgentModel || agentDraftModel || "");
    const modelRef = parsedModel ? parseModelRef(parsedModel) : null;
    let createdAgent: AgentSessionSummary;
    try {
      const mode = composerAgentSessionOptions(activeAgentAgent);
      const modelInfo = agentModelInfoByRef[parsedModel || ""] || null;
      createdAgent = await agentClient.createSession({
        repoPath,
        provider: modelRef?.provider,
        model: modelRef?.model,
        maxToolIterations: generalSettings.maxToolIterations > 0 ? generalSettings.maxToolIterations : undefined,
        appendSystemPrompt: mode.appendSystemPrompt,
        ...(mode.enabledTools ? { enabledTools: mode.enabledTools } : {}),
        thinking: toPiThinkingLevel(activeAgentThinkingLevel, modelInfo)
      });
    } catch (error) {
      // 创建失败必须可见（如凭据缺失/模型未选），否则表现为"发不出消息"。
      appendAgentDebugLog(`session.create.error ${String(error)}`);
      setError(String(error));
      setMessage("创建会话失败，请检查模型与密钥配置");
      return "";
    }
    const created = agentSummaryToChatSummary(createdAgent);
    created.title = clipAgentSessionTitle(seedPrompt) || created.title;
    const next = agentSessionFromSummary(created, agentSessions.length + 1);
    next.loaded = true;
    setAgentSessions((prev) => {
      const exists = prev.some((session) => session.id === created.id);
      return exists ? prev : [next, ...prev];
    });
    const repoIdAtCreate = selectedRepo?.id || newSessionTargetRepoId;
    upsertSidebarAgentSession(repoIdAtCreate, next);
    if (repoIdAtCreate) setExpandedProjectIds((prev) => (prev.includes(repoIdAtCreate) ? prev : [...prev, repoIdAtCreate]));
    // provider/model 已写在 next（来自服务端 create summary）；草稿同步为下次新建默认。
    const createdModelRef = modelRefFromAgentSummary(createdAgent) || parsedModel;
    if (createdModelRef) {
      selectAgentDraftModel(createdModelRef);
      const parsedCreated = parseModelRef(createdModelRef);
      if (parsedCreated) {
        setAgentModelProvider(parsedCreated.provider);
        setAgentSelectedModel(parsedCreated.model);
      }
    }
    selectAgentSession(created.id, "new");
    if (activeAgentAgent) setAgentSessionAgent((prev) => ({ ...prev, [created.id]: activeAgentAgent }));
    setAgentSessionThinkingLevel((prev) => ({ ...prev, [created.id]: activeAgentThinkingLevel }));
    bindAgentSessionToWorkspace(created.id, repoPath, worktreeOverview.branch || selectedBranch);
    setAgentPromptInput("");
    appendAgentDebugLog(`session.created ${created.id}`);
    if (agentAutoAcceptPermissions) void ensureSessionAutoAcceptPermissions(created.id, agentAutoAcceptPermissions);
    return created.id;
  }

  async function createAndSwitchAgentSession(seedPrompt?: string) {
    if (!ensureRepoSelected()) return;
    clearPendingSidebarSessionSelection();
    clearAgentSessionHydration();
    selectAgentSession("", "draft-clear", { draft: true });
    setAgentPromptInput(seedPrompt?.trim() || "");
  }

  async function createAndSwitchAgentSessionForSidebar(seedPrompt?: string) {
    setMainMode("agent");
    const targetRepo = repos.find((repo) => repo.id === newSessionTargetRepoId) || selectedRepo;
    if (!targetRepo) {
      setError("请先导入并选择一个工作区。");
      return;
    }
    agentSessionsRepoIdRef.current = targetRepo.id;
    if (selectedRepo?.id !== targetRepo.id) setSelectedRepo(targetRepo);
    if (gitPaneRepo?.id !== targetRepo.id) setGitPaneRepo(targetRepo);
    setAgentSessionFetchLimit(getRepoSessionFetchLimit(targetRepo.id));
    setExpandedProjectIds((prev) => (prev.includes(targetRepo.id) ? prev : [...prev, targetRepo.id]));
    clearPendingSidebarSessionSelection();
    clearAgentSessionHydration();
    selectAgentSession("", "draft-clear", { draft: true });
    setAgentPromptInput(seedPrompt?.trim() || "");
  }

  async function openAgentChildSession(childSessionId: string, titleHint?: string) {
    const id = childSessionId.trim();
    if (!id) return;
    if (!ensureRepoSelected()) return;
    let summary: ChatSessionSummary | null = null;
    try {
      summary = agentSummaryToChatSummary(await agentClient.getSession(id));
    } catch {
      // fallback to optimistic local shell below
    }
    setAgentSessions((prev) => {
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
      const shell: ChatSessionSummary = summary || {
        id,
        title: titleHint?.trim() || `Task ${id.slice(0, 8)}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const added = agentSessionFromSummary(shell, prev.length + 1);
      return [added, ...prev];
    });
    beginAgentSessionHydration(id);
    selectAgentSession(id, "child");
    try {
      await loadAgentSessionMessages(id);
      appendAgentDebugLog(`session.child.opened ${id}`);
    } catch (e) {
      appendAgentDebugLog(`session.child.open.error ${id} ${String(e)}`);
    }
  }

  function commitAgentLiveParts(
    updater: (prev: Record<string, AgentDetailedPart[]>) => Record<string, AgentDetailedPart[]>
  ) {
    setAgentLivePartsByServerMessageId((prev) => {
      const next = updater(prev);
      agentLivePartsByServerMessageIdRef.current = next;
      return next;
    });
  }

  function commitAgentServerMessageIdByLocalId(
    updater: (prev: Record<string, string>) => Record<string, string>
  ) {
    setAgentServerMessageIdByLocalId((prev) => {
      const next = updater(prev);
      agentServerMessageIdByLocalIdRef.current = next;
      return next;
    });
  }

  function upsertAgentLivePart(serverMessageId: string, incomingPart: unknown) {
    const mid = serverMessageId.trim();
    if (!mid || !incomingPart || typeof incomingPart !== "object") return;
    const part = incomingPart as AgentDetailedPart;
    const pid = String((part as any)?.id || "").trim();
    if (!pid) return;
    commitAgentLiveParts((prev) => {
      const current = prev[mid] || [];
      const next = [...current];
      const hit = next.findIndex((p) => String((p as any)?.id || "").trim() === pid);
      if (hit >= 0) {
        const previous = next[hit] as any;
        // pi 原生 part 缺省字段不写 key，浅合并即保留先前事件的值。
        const base = { ...previous, ...(part as any) };
        // 空 toolName 不覆盖已有的非空：buildToolPart 对 toolName 总是写值（type 必填），后续事件
        // （tool.progress / completed 等不带 toolName）会写成空串；若让空串盖掉已补全的 "ls"/"read"，
        // 该工具会被 isAgentRenderablePart 滤掉 → context 组工具数 3→2→3 抖动、整组短暂消失 =
        // 「数量更新就显隐」闪动（用户原话）。与 input/output「缺省不写 key」同理：缺省值不覆盖已写入值。
        const incomingToolName = String((part as any)?.toolName || "").trim();
        if (!incomingToolName && typeof previous?.toolName === "string" && previous.toolName.trim()) {
          base.toolName = previous.toolName;
        }
        // 工具身份锁定 type=toolCall：part 自带 toolName 或 previous 已有 toolName 即视为工具，强制
        // type=toolCall。type 抖动的真正源头是 patchAgentLivePartDelta/setAgentLivePartField（工具
        // inputRaw delta 的 field 不在 reasoning 判定内、被 resolveAgentLivePartType 当成 text，覆盖已
        // 确认的 toolCall）——那里已同样锁定 toolCall 不降级；此处为本函数（incoming 来自 buildToolPart、
        // 恒 toolCall）的同源兜底防御。一旦确认为工具即锁死、context 组恒存在，探索标签不再显隐闪。与空
        // toolName 守卫互补：空 toolName 时 isAgentRenderablePart 仍滤掉（等 toolName 到达），有
        // toolName 时 type 锁死。
        const hasToolName =
          !!incomingToolName || (typeof previous?.toolName === "string" && !!previous.toolName.trim());
        if (hasToolName) base.type = "toolCall";
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
            } as AgentDetailedPart;
            next.splice(hit, 0, snapshot);
          }
          base.text = mergeAgentStreamText(prevText, incomingText);
        }
        next[rewrote ? hit + 1 : hit] = base as AgentDetailedPart;
      } else {
        next.push(part);
      }
      return { ...prev, [mid]: next };
    });
  }

  function resolveAgentLivePartType(partId: string, field: string): "reasoning" | "text" | "toolCall" {
    const pid = partId.trim();
    // partId 才是类型来源：reasoning 流写入字段名是 text（ReasoningGroup 读 part.text），
    // 不能用 field === "reasoning" 判断，否则会把思考误标成普通 text，导致「正文在上、思考中标签在下」。
    if (pid === "reasoning" || pid.startsWith("reasoning:")) return "reasoning";
    if (field === "reasoning") return "reasoning";
    // 工具输入参数流式 delta（onAgentEvent 用 event.toolCallId 作 pid、field="inputRaw"）：若判成 text
    // 会把已确认的 toolCall 工具降级 → context 组整组消失、下个 toolCall 事件又修正 → 探索标签显隐闪。
    if (field === "inputRaw") return "toolCall";
    return "text";
  }

  function patchAgentLivePartDelta(serverMessageId: string, partId: string, field: string, delta: string) {
    const mid = serverMessageId.trim();
    const pid = partId.trim();
    if (!mid || !pid || !field || !delta) return;
    commitAgentLiveParts((prev) => {
      const current = prev[mid] || [];
      const next = [...current];
      const hit = next.findIndex((p) => String((p as any)?.id || "").trim() === pid);
      const prevPart = hit >= 0 ? ((next[hit] as any) ?? null) : null;
      // 已确认的工具调用（toolCall）不被降级：本函数按 pid+field 推断 type，但工具的 inputRaw delta
      // （event.toolCallId 为 pid、field="inputRaw"）会被 resolveAgentLivePartType 判成 text，强制覆盖
      // 已写入的 toolCall → 该工具被 isAgentRenderablePart 滤掉 → context 组整组消失、下个 toolCall 事件
      // 又修正回来 → 探索标签「显示→隐藏→显示」显隐闪（用户原话「数量更新就显隐」「我要求标签一定是稳定的」）。
      // previous 是 toolCall 即锁死，与 upsertAgentLivePart 的工具身份锁同源。
      const partType = prevPart?.type === "toolCall" ? "toolCall" : resolveAgentLivePartType(pid, field);
      const base =
        hit >= 0
          ? { ...(next[hit] as any), type: partType }
          : {
            id: pid,
            messageID: mid,
            type: partType
          };
      const old = String((base as any)[field] || "");
      (base as any)[field] = mergeAgentStreamText(old, old + delta);
      if (hit >= 0) next[hit] = base as AgentDetailedPart;
      else next.push(base as AgentDetailedPart);
      return { ...prev, [mid]: next };
    });
  }

  function setAgentLivePartField(serverMessageId: string, partId: string, field: string, value: string) {
    const mid = serverMessageId.trim();
    const pid = partId.trim();
    if (!mid || !pid || !field) return;
    commitAgentLiveParts((prev) => {
      const current = prev[mid] || [];
      const next = [...current];
      const hit = next.findIndex((p) => String((p as any)?.id || "").trim() === pid);
      const prevPart = hit >= 0 ? ((next[hit] as any) ?? null) : null;
      // 已确认的工具调用（toolCall）不被降级：本函数按 pid+field 推断 type，但工具的 inputRaw delta
      // （event.toolCallId 为 pid、field="inputRaw"）会被 resolveAgentLivePartType 判成 text，强制覆盖
      // 已写入的 toolCall → 该工具被 isAgentRenderablePart 滤掉 → context 组整组消失、下个 toolCall 事件
      // 又修正回来 → 探索标签「显示→隐藏→显示」显隐闪（用户原话「数量更新就显隐」「我要求标签一定是稳定的」）。
      // previous 是 toolCall 即锁死，与 upsertAgentLivePart 的工具身份锁同源。
      const partType = prevPart?.type === "toolCall" ? "toolCall" : resolveAgentLivePartType(pid, field);
      const base =
        hit >= 0
          ? { ...(next[hit] as any), type: partType }
          : {
            id: pid,
            messageID: mid,
            type: partType
          };
      (base as any)[field] = value;
      if (hit >= 0) next[hit] = base as AgentDetailedPart;
      else next.push(base as AgentDetailedPart);
      return { ...prev, [mid]: next };
    });
  }

  function removeAgentLivePart(serverMessageId: string, partId: string) {
    const mid = serverMessageId.trim();
    const pid = partId.trim();
    if (!mid || !pid) return;
    commitAgentLiveParts((prev) => {
      const current = prev[mid] || [];
      const hit = current.find((p) => String((p as any)?.id || "").trim() === pid);
      const hitType = String((hit as any)?.type || "");
      if (hitType === "reasoning" || hitType === "text") return prev;
      const next = current.filter((p) => String((p as any)?.id || "").trim() !== pid);
      if (next.length === current.length) return prev;
      return { ...prev, [mid]: next };
    });
  }

  async function archiveAgentSession(repo: RepositoryEntry, sessionId: string) {
    const id = sessionId.trim();
    if (!id) return;
    const repoId = repo.id.trim();
    const repoPathArg = repo.path.trim();
    if (!repoId || !repoPathArg) return;
    appendAgentDebugLog(`session.archive requested ${id}`);
    const sidebarSnapshot = sidebarAgentSessionsByRepo;
    const sessionSnapshot = agentSessions;
    const repoSessions = sidebarAgentSessionsByRepo[repoId] || [];
    const nextRepoSessions = repoSessions.filter((session) => session.id !== id);
    const idx = repoSessions.findIndex((session) => session.id === id);
    const fallback = nextRepoSessions[Math.max(0, idx - 1)] ?? nextRepoSessions[0] ?? null;
    setSidebarAgentSessionsByRepo((prev) => ({ ...prev, [repoId]: nextRepoSessions }));
    setAgentSessions((prev) => prev.filter((session) => session.id !== id));
    markAgentSessionArchived(repoId, id);
    if (activeAgentSessionId === id) {
      if (fallback) {
        pendingSidebarSessionSelectionRef.current = { repoId, sessionId: fallback.id };
        beginAgentSessionHydration(fallback.id);
        setAgentSessions((prev) => [{ ...agentSessionFromSummary(fallback), loaded: false }, ...prev.filter((session) => session.id !== fallback.id)]);
        selectAgentSession(fallback.id, "neighbor");
      } else {
        clearAgentSessionHydration();
        selectAgentSession("", "delete-empty", { draft: true });
      }
    }
    try {
      await agentClient.deleteSession(id);
      appendAgentDebugLog(`agent.session.deleted ${id}`);
      setMessage("会话已归档");
    } catch (e) {
      appendAgentDebugLog(`session.archive.error ${id} ${String(e)}`);
      const archivedIds = archivedAgentSessionIdsByRepoRef.current[repoId];
      if (archivedIds) {
        const next = new Set(archivedIds);
        next.delete(id);
        archivedAgentSessionIdsByRepoRef.current = {
          ...archivedAgentSessionIdsByRepoRef.current,
          [repoId]: next
        };
      }
      setSidebarAgentSessionsByRepo(sidebarSnapshot);
      setAgentSessions(sessionSnapshot);
      if (activeAgentSessionId === id) selectAgentSession(id, "rollback");
      setError(String(e));
    }
  }

  async function removeAgentSession(sessionId: string) {
    const id = sessionId.trim();
    if (!id || agentSessions.length <= 1) return;
    if (!ensureRepoSelected()) return;
    appendAgentDebugLog(`session.delete requested ${id}`);
    const snapshot = agentSessions;
    const idx = snapshot.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = snapshot.filter((s) => s.id !== id);
    const fallback = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
    setAgentSessions(next);
    if (activeAgentSessionId === id && fallback) {
      beginAgentSessionHydration(fallback.id);
      selectAgentSession(fallback.id, "neighbor");
    } else if (next.length === 0) {
      clearAgentSessionHydration();
      selectAgentSession("", "delete-empty", { draft: true });
    }
    try {
      await agentClient.deleteSession(id);
      appendAgentDebugLog(`session.deleted ${id}`);
    } catch (e) {
      appendAgentDebugLog(`session.delete.error ${id} ${String(e)}`);
      setAgentSessions(snapshot);
      if (activeAgentSessionId === id) {
        selectAgentSession(id, "rollback");
      }
      throw e;
    }
  }

  useEffect(() => {
    if (!draggingSplit) return;
    const root = document.documentElement;
    const onMove = (e: MouseEvent) => {
      e.preventDefault();
      const delta = e.clientX - draggingSplit.startX;
      if (draggingSplit.kind === "sidebar") {
        setSidebarWidth(clamp(draggingSplit.startWidth + delta, 292, 340));
      } else if (draggingSplit.kind === "right") {
        setRightPaneWidth(clamp(draggingSplit.startWidth - delta, 520, 1120));
      } else {
        setChangesSidebarWidth(clamp(draggingSplit.startWidth + delta, 232, 360));
      }
    };
    const clearSplitResizeLock = () => {
      root.classList.remove("wb-split-resizing");
      root.style.removeProperty("cursor");
      root.style.removeProperty("user-select");
      (root.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "";
    };
    const onUp = () => {
      clearSplitResizeLock();
      setDraggingSplit(null);
    };
    root.classList.add("wb-split-resizing");
    root.style.setProperty("cursor", "col-resize");
    root.style.setProperty("user-select", "none");
    (root.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();
    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      clearSplitResizeLock();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [draggingSplit]);
  function ensureRepoSelected(): boolean {
    if (!selectedRepo) {
      setError("请先导入并选择一个工作区。");
      return false;
    }
    return true;
  }

  function getAgentInvokeRepoPath(): string {
    return (selectedRepo?.path || repos[0]?.path || "").trim();
  }

  function applyAgentProviderSnapshot(snapshot: ReturnType<typeof normalizeAgentServerProviderState>) {
    const catalogIds = new Set(snapshot.providers);
    setAgentProviderNames((prev) => {
      const next: Record<string, string> = {};
      for (const [providerId, displayName] of Object.entries(prev)) {
        // 已删除的自定义实例不要靠旧 displayName 继续出现在搜索/列表里。
        if (!catalogIds.has(providerId) && isRemovableCustomProviderId(providerId)) continue;
        if (displayName) next[providerId] = displayName;
      }
      for (const [providerId, displayName] of Object.entries(snapshot.providerNames)) {
        if (displayName) next[providerId] = displayName;
      }
      return next;
    });
    setAgentProviderSourceById(snapshot.providerSources);
    setAgentModelNamesByProvider(snapshot.modelNamesByProvider);
    setAgentModelsByProvider(snapshot.modelsByProvider);
    setAgentProviders(snapshot.providers);
    setAgentConnectedProviders(snapshot.connectedProviders);
  }

  /** 从本地 UI 状态剔除供应商（删除自定义实例后立刻生效，不依赖部分刷新路径）。 */
  function pruneLocalAgentProvider(providerId: string) {
    const pid = providerId.trim();
    if (!pid) return;
    setAgentProviders((prev) => prev.filter((id) => id !== pid));
    setAgentConnectedProviders((prev) => prev.filter((id) => id !== pid));
    setAgentConfiguredProviders((prev) => prev.filter((id) => id !== pid));
    setAgentProviderNames((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setAgentProviderSourceById((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setAgentModelsByProvider((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setAgentModelNamesByProvider((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setAgentConfiguredModelsByProvider((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setAgentConfiguredModelNamesByProvider((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setAgentGlobalConfigProviderMap((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
    setAgentModelInfoByRef((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key === pid || key.startsWith(`${pid}/`)) delete next[key];
      }
      return next;
    });
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
    setSelectedWorktreeLine(undefined);
    setSelectedWorktreeViewMode("auto");
    setSelectedAttachmentPreviewPath("");
    setGitUserIdentity(EMPTY_GIT_IDENTITY);
  }

  async function refreshRepositories() {
    try {
      const all = await listRepositories();
      const preferredRepo = all.find((repo) => pinnedRepoIds.includes(repo.id)) || all[0] || null;
      setRepos(all);
      if (preferredRepo && !selectedRepo) setSelectedRepo(preferredRepo);
      if (preferredRepo && !gitPaneRepo) setGitPaneRepo(preferredRepo);
    } finally {
      // 幂等打点：仓库列表首次返回（含失败）即视为首批数据就绪，供启动屏判定。
      setReposLoaded(true);
    }
  }

  // 项目分享：右键「分享项目…」→ 导出快照上传云端，弹窗展示分享地址。
  async function shareRepository(repo: RepositoryEntry) {
    setShareBusyRepoId(repo.id);
    setShareError("");
    try {
      const result = await shareCreate(repo.path);
      setShareResult({ repoName: repo.name, result });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
    } finally {
      setShareBusyRepoId(null);
    }
  }

  // 落地页「在 Giteam 中打开」→ giteam://import?url=… 深链 → 确认导入。
  // 冷启动时 Opened 可能早于 React 挂载：listen 之外再拉一次 pending。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const openImport = (raw: string) => {
      if (disposed || !raw.trim()) return;
      setShareImportError("");
      setShareImportResult(null);
      setAddProjectShareUrl(raw.trim());
      setAddProjectName("");
      setAddProjectLocalPath("");
      setAddProjectTargetPath("");
      setAddProjectSource("remote");
      setAddProjectStep("remote");
      setAddProjectOpen(true);
    };

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("giteam://share-import", (event) => {
          openImport(event.payload);
        })
      )
      .then(async (fn) => {
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        // listen 就绪后再取 pending，避免冷启动 Opened 落在两者之间丢失。
        try {
          const pending = await invoke<string | null>("share_take_pending_import");
          if (pending) openImport(pending);
        } catch {
          /* 旧包无此命令时忽略 */
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function resetAddProjectDialog() {
    setShareImportError("");
    setShareImportProgress(null);
    setAddProjectShareUrl("");
    setAddProjectName("");
    setAddProjectLocalPath("");
    setAddProjectTargetPath("");
    setAddProjectSource("local");
    setAddProjectStep("type");
    setAddProjectBusy(false);
  }

  function sanitizeProjectName(raw: string): string {
    return raw.trim().replace(/[\\/]+/g, "-").replace(/^\.+/, "");
  }

  function joinProjectPath(parent: string, name: string): string {
    const base = parent.trim().replace(/[/\\]+$/, "");
    const leaf = sanitizeProjectName(name);
    const sep = base.includes("\\") ? "\\" : "/";
    return `${base}${sep}${leaf}`;
  }

  async function confirmShareImport() {
    const url = addProjectShareUrl.trim();
    const parent = addProjectTargetPath.trim();
    const name = sanitizeProjectName(addProjectName);
    if (!url || shareImportBusy) return;
    if (!parent) {
      setShareImportError("请选择保存位置");
      return;
    }
    if (!name) {
      setShareImportError("请填写项目名称");
      return;
    }
    setShareImportBusy(true);
    setShareImportError("");
    setShareImportProgress({
      stage: "meta",
      message: "正在准备导入…",
      percent: 1,
    });
    let unlistenProgress: (() => void) | undefined;
    try {
      unlistenProgress = await listenShareImportProgress((progress) => {
        setShareImportProgress(progress);
      });
      const targetDir = joinProjectPath(parent, name);
      const result = await shareImport(url, targetDir, undefined, name);
      setShareImportResult(result);
      setAddProjectOpen(false);
      resetAddProjectDialog();
      await refreshRepositories();
      const all = await listRepositories();
      const imported = all.find((repo) => sameRepoPath(repo.path, result.targetDir));
      if (imported) setSelectedRepo(imported);
    } catch (error) {
      if (isShareImportCancelled(error)) {
        setShareImportError("");
        setShareImportProgress(null);
        setShareImportBusy(false);
        setAddProjectOpen(false);
        resetAddProjectDialog();
        return;
      }
      setShareImportError(error instanceof Error ? error.message : String(error));
      setShareImportProgress(null);
    } finally {
      unlistenProgress?.();
      setShareImportBusy(false);
    }
  }

  async function cancelShareImport() {
    if (!shareImportBusy) return;
    setShareImportProgress((prev) => ({
      stage: prev?.stage || "meta",
      message: "正在取消…",
      percent: prev?.percent ?? 0,
      bytesDone: prev?.bytesDone ?? null,
      bytesTotal: prev?.bytesTotal ?? null,
    }));
    try {
      await shareImportCancel();
    } catch {
      // ignore
    }
  }

  function openAddProjectDialog() {
    if (busy || shareImportBusy || addProjectBusy) return;
    resetAddProjectDialog();
    setAddProjectOpen(true);
  }

  function continueAddProjectStep() {
    if (addProjectSource === "local") {
      setAddProjectStep("local");
      return;
    }
    setAddProjectStep("remote");
  }

  async function pickAddProjectLocalPath() {
    setShareImportError("");
    try {
      const path = await pickRepositoryFolder();
      if (!path) return;
      setAddProjectLocalPath(path);
      if (!addProjectName.trim()) {
        const base = path.split(/[/\\]/).filter(Boolean).pop() || "";
        if (base) setAddProjectName(base);
      }
    } catch (error) {
      setShareImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function pickAddProjectTargetPath() {
    setShareImportError("");
    try {
      const path = await pickRepositoryFolder();
      if (!path) return;
      setAddProjectTargetPath(path);
    } catch (error) {
      setShareImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmAddProjectLocal() {
    const path = addProjectLocalPath.trim();
    if (!path || addProjectBusy) return;
    setAddProjectBusy(true);
    setShareImportError("");
    try {
      const entry = await addRepository(path, sanitizeProjectName(addProjectName) || undefined);
      await refreshRepositories();
      setSelectedRepo(entry);
      setGitPaneRepo(entry);
      setMessage(`已导入仓库: ${entry.name}`);
      setAddProjectOpen(false);
      resetAddProjectDialog();
    } catch (error) {
      setShareImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setAddProjectBusy(false);
    }
  }

  // 启动屏隐藏判定：首批仓库列表 + 运行时检测 + agent 会话首轮加载均就绪后，
  // 补足最小展示时长再淡出——避免界面先露出"会话未加载完"的中间态。
  // 启动屏本体是 index.html 的内联 CSS 节点——transform/opacity 动画由合成器线程
  // 驱动，启动期 JS 主线程繁忙（bundle 执行 + 首屏渲染）时动画依然流畅，因此
  // 不迁移为 React 组件；这里只负责打淡出类并在过渡结束后移除节点。
  // 另有兜底超时，防止启动链路挂起导致启动屏永久遮挡界面。
  useEffect(() => {
    const splash = document.getElementById("app-splash");
    if (!splash) return;
    const elapsed = Date.now() - splashShownAtRef.current;
    // 无仓库时不会有 agent bootstrap，直接视为会话侧就绪。
    const noWorkspace = reposLoaded && repos.length === 0;
    const sessionSettled = agentBootstrapSettled && !agentSessionLoading;
    const ready = reposLoaded && !runtimeStartupChecking && (noWorkspace || sessionSettled);
    const delay = ready
      ? Math.max(SPLASH_MIN_DISPLAY_MS - elapsed, 0)
      : Math.max(SPLASH_MAX_DISPLAY_MS - elapsed, 0);
    const timer = window.setTimeout(() => {
      splash.classList.add("app-splash-exit");
      // 等 CSS 淡出过渡（320ms）结束后再移除节点
      window.setTimeout(() => splash.remove(), 400);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [reposLoaded, repos.length, runtimeStartupChecking, agentBootstrapSettled, agentSessionLoading]);

  const {
    activateLinkedWorktree,
    checkoutBranchFromTopology,
    createAndCheckoutBranch,
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
    appendAgentDebugLog,
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
      const preferredRepo = all.find((repo) => pinnedRepoIds.includes(repo.id)) || all[0] || null;
      setRepos(all);
      if (selectedRepo?.id === entry.id) {
        setSelectedRepo(preferredRepo);
      } else if (selectedRepo && !all.some((r) => r.id === selectedRepo.id)) {
        setSelectedRepo(preferredRepo);
      }
      if (gitPaneRepo?.id === entry.id) {
        setGitPaneRepo(preferredRepo);
      } else if (gitPaneRepo && !all.some((r) => r.id === gitPaneRepo.id)) {
        setGitPaneRepo(preferredRepo);
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
    setCheckingDeps({ git: true, entire: true, giteam: true });
    try {
      const deps: Array<"git" | "entire" | "giteam"> = ["git", "entire", "giteam"];
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

function runtimeJobFailureMessage(job: RuntimeActionJobStatus): string {
  const log = job.log || "";
  const lines = log.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (line.includes("NETWORK_ERROR:")) {
      return line.replace(/^.*NETWORK_ERROR:\s*/, "").trim();
    }
    if (/^curl:\s/.test(line)) {
      return `网络连接失败（${line}）`;
    }
  }
  if (job.name === MACOS_RUNTIME_BOOTSTRAP_NAME && job.action === "bootstrap") {
    return "运行环境准备失败";
  }
  const actionText = job.action === "uninstall" ? "卸载" : "安装";
  return `${job.name} ${actionText}失败`;
}

function describeRuntimeJobResult(job: RuntimeActionJobStatus): string {
  if (job.status === "succeeded") {
    if (job.name === MACOS_RUNTIME_BOOTSTRAP_NAME && job.action === "bootstrap") {
      return "运行环境已准备完成";
    }
    const actionText = job.action === "uninstall" ? "卸载" : "安装";
    return `${job.name} ${actionText}完成`;
  }
  return runtimeJobFailureMessage(job);
}

/** 设置页「插件」里提示可装的依赖：git / entire；giteam CLI 仅手机端，不阻塞桌面。 */
function getMissingRuntimeDeps(status: RuntimeRequirementsStatus): RuntimeDepName[] {
  return (["git", "entire"] as RuntimeDepName[]).filter((name) => !status[name].installed);
}

  async function runDependencyAction(
    name: RuntimeDepName,
    action: "install" | "uninstall",
    options?: { showRuntimePanel?: boolean }
  ) {
    flushSync(() => {
      setShowEnvSetup(options?.showRuntimePanel ?? false);
      setInstallingDep(name);
      setInstallingElapsed(0);
      setRuntimeInstallLog("");
      setRuntimeJob(null);
      setRuntimeJobId("");
      setError("");
      setMessage(`${name} ${action === "uninstall" ? "卸载" : "安装"}中...`);
    });
    try {
      const jobId = await invoke<string>("start_runtime_dependency_action", { name, action });
      setRuntimeJob({
        jobId,
        name,
        action,
        status: "running",
        log: "",
        startedAtMs: Date.now()
      });
      setRuntimeJobId(jobId);
    } catch (e) {
      setRuntimeInstallLog(String(e));
      setError(String(e));
      setMessage(`${name} ${action === "uninstall" ? "卸载" : "安装"}启动失败`);
      setInstallingDep("");
      setInstallingElapsed(0);
      setRuntimeJobId("");
    }
  }

  async function runRuntimeAutoInit(options?: { showRuntimePanel?: boolean }) {
    flushSync(() => {
      setShowEnvSetup(options?.showRuntimePanel ?? true);
      setInstallingDep(MACOS_RUNTIME_BOOTSTRAP_NAME);
      setInstallingElapsed(0);
      setRuntimeInstallLog("");
      setRuntimeJob(null);
      setRuntimeJobId("");
      setError("");
      setMessage("正在准备运行环境...");
      setRuntimeInstallLog("正在准备运行环境...\n请稍候。");
    });
    try {
      const jobId = await invoke<string>("start_runtime_dependency_action", {
        name: MACOS_RUNTIME_BOOTSTRAP_NAME,
        action: "bootstrap"
      });
      setRuntimeJobId(jobId);
    } catch (e) {
      setRuntimeInstallLog(String(e));
      setError(String(e));
      setMessage("运行环境准备启动失败");
      setInstallingDep("");
      setInstallingElapsed(0);
      setRuntimeJobId("");
    }
  }

  function runRuntimeSetupForMissing(
    status: RuntimeRequirementsStatus,
    options?: { showRuntimePanel?: boolean }
  ) {
    const missing = getMissingRuntimeDeps(status);
    if (missing.length === 0) return;
    if (status.platform === "macos" && missing.length === 1) {
      void runDependencyAction(missing[0], "install", options);
      return;
    }
    if (status.platform === "macos") {
      void runRuntimeAutoInit(options);
      return;
    }
    setShowEnvSetup(options?.showRuntimePanel ?? true);
  }

  async function fetchAgentProviders(): Promise<string[]> {
    const providers = await agentClient.listProviders();
    setAgentModelInfoByRef(indexAgentModelInfoByRef(providers));
    const state = agentProvidersToServerState(providers);
    const snapshot = normalizeAgentServerProviderState(state);
    const connectedSet = new Set(snapshot.connectedProviders);
    const stickyProviders = new Set<string>();
    if (agentModelProvider.trim()) stickyProviders.add(agentModelProvider.trim());
    const configured = parseModelRef(agentConfig?.configuredModel || "");
    if (configured?.provider) stickyProviders.add(configured.provider);
    const selectionCatalog = Object.fromEntries(
      Object.entries(snapshot.modelsByProvider).filter(([providerId]) => connectedSet.has(providerId) || stickyProviders.has(providerId))
    );
    const next = applyAgentCatalog(
      Object.keys(selectionCatalog).length > 0 ? selectionCatalog : snapshot.modelsByProvider,
      agentModelProvider,
      agentSelectedModel
    );
    setAgentProviderNames((prev) => ({ ...prev, ...snapshot.providerNames }));
    setAgentProviderSourceById((prev) => ({ ...prev, ...snapshot.providerSources }));
    setAgentModelsByProvider(snapshot.modelsByProvider);
    setAgentModelNamesByProvider(snapshot.modelNamesByProvider);
    setAgentProviders(snapshot.providers);
    setAgentConnectedProviders(snapshot.connectedProviders);
    setAgentModelProvider(next.provider);
    setAgentSelectedModel(next.model);
    return next.providers;
  }

  async function fetchAgentModels(provider: string): Promise<string[]> {
    const state = agentProvidersToServerState(await agentClient.listProviders());
    const rows = state?.providers || [];
    const entry = rows.find((p) => p.id === provider) || rows.find((p) => normalizeProviderId(p.id) === normalizeProviderId(provider));
    const models = (entry?.models || []).filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (entry?.id) {
      setAgentModelsByProvider((prev) => ({ ...prev, [entry.id]: models }));
      setAgentModelNamesByProvider((prev) => ({ ...prev, [entry.id]: entry.modelNames || {} }));
      setAgentProviderNames((prev) => ({ ...prev, [entry.id]: prev[entry.id] || entry.name || entry.id }));
      if (entry.source) {
        setAgentProviderSourceById((prev) => ({ ...prev, [entry.id]: entry.source || "" }));
      }
      ensureProviderExists(entry.id);
    }
    return models;
  }

  async function refreshAgentCatalog(opts?: {
    syncSelection?: boolean;
    includeCurrentModel?: boolean;
    reloadProviders?: boolean;
  }) {
    if (!ensureRepoSelected()) return;
    if (agentCatalogRefreshInFlightRef.current) return;
    agentCatalogRefreshInFlightRef.current = true;
    setAgentCatalogLoading(true);
    try {
      await refreshAgentServerConfig(opts);
      if (opts?.reloadProviders || !agentProviderCatalogLoadedRef.current) {
        await loadAgentProviderCatalogOnce();
      } else {
        await refreshAgentConnectedProvidersOnly();
      }
      await refreshAgentConfiguredModels();
    } finally {
      agentCatalogRefreshInFlightRef.current = false;
      setAgentCatalogLoading(false);
    }
  }

  async function waitForAgentCatalogLoad(): Promise<void> {
    if (!agentCatalogLoadInFlightRef.current) return;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!agentCatalogLoadInFlightRef.current) {
          resolve();
          return;
        }
        window.setTimeout(check, 40);
      };
      check();
    });
  }

  async function loadAgentProviderCatalogOnce(): Promise<boolean> {
    const path = getAgentInvokeRepoPath();
    if (!path) return false;
    if (agentProviderCatalogLoadedRef.current) return true;
    if (agentCatalogLoadInFlightRef.current) {
      await waitForAgentCatalogLoad();
      return agentProviderCatalogLoadedRef.current;
    }
    agentCatalogLoadInFlightRef.current = true;
    try {
      const state = agentProvidersToServerState(await agentClient.listProviders());
      const snapshot = normalizeAgentServerProviderState(state);
      if (snapshot.providers.length === 0) {
        appendAgentDebugLog("server.providers catalog empty on first load");
        return false;
      }
      applyAgentProviderSnapshot(snapshot);
      agentProviderCatalogLoadedRef.current = true;
      appendAgentDebugLog(
        `server.providers catalog loaded once providers=${snapshot.providers.length} connected=${snapshot.connectedProviders.length}`
      );
      return true;
    } catch (e) {
      appendAgentDebugLog(`server.providers catalog error ${String(e)}`);
      return false;
    } finally {
      agentCatalogLoadInFlightRef.current = false;
    }
  }

  async function refreshAgentConnectedProvidersOnly() {
    // 凭据在全局 vault，与工作区无关；旧逻辑用 repo path 早退会导致「key 已写入但 UI 仍未连接」。
    // 必须整表同步 providers/models：只改 connected 会在删除自定义供应商后留下僵尸条目。
    try {
      const providers = await agentClient.listProviders();
      setAgentModelInfoByRef(indexAgentModelInfoByRef(providers));
      const state = agentProvidersToServerState(providers);
      const snapshot = normalizeAgentServerProviderState(state);
      applyAgentProviderSnapshot(snapshot);
      if (snapshot.providers.length > 0) {
        agentProviderCatalogLoadedRef.current = true;
      }
    } catch (e) {
      appendAgentDebugLog(`server.connected error ${String(e)}`);
    }
  }

  useEffect(() => {
    if (!showAgentProviderPicker) return;
    // Reset filters so the modal shows the full provider list by default.
    setAgentProviderPickerSearch("");
    setAgentProviderPickerModelSearch("");
    setAgentProviderActionMenuFor("");
    setShowAgentAuthDialogFor("");
    appendAgentDebugLog(
      `providerPicker.open presets=${PROVIDER_PRESETS.length} serverProviders=${agentProviders.length} configuredProviders=${agentConfiguredProviders.length} connectedProviders=${agentConnectedProviders.length}`
    );
  }, [showAgentProviderPicker]);

  useEffect(() => {
    setAgentProviderActionMenuFor("");
  }, [agentProviderPickerProvider]);

  async function loadAgentModelConfig(opts?: { silent?: boolean }) {
    if (!ensureRepoSelected()) return false;
    try {
      // pi 没有 per-repo 模型配置文件：当前模型是客户端选择状态，
      // 这里只保留状态形状并记录已保存模型到历史。
      const configuredModel = normalizeModelRef(activeAgentModel || agentDraftModel || "");
      setAgentConfig((prev) => ({
        configPath: prev?.configPath || "",
        configuredModel: prev?.configuredModel || configuredModel || "",
        exists: false
      }));
      if (configuredModel) rememberAgentSavedModel(configuredModel);
      return true;
    } catch (e) {
      if (!opts?.silent) {
        setError(String(e));
        setMessage("Load model config failed");
      }
      return false;
    }
  }

  function resetAgentWorkspaceBootstrapState(nextRepoId?: string) {
    const prev = agentBootstrapDoneForRepoRef.current;
    if (prev && nextRepoId && prev === nextRepoId) return;
    agentProviderCatalogLoadedRef.current = false;
    agentModelConfigLoadedRef.current = false;
    agentConfiguredModelsLoadedRef.current = false;
    agentBootstrapDoneForRepoRef.current = "";
  }

  async function ensureAgentServiceReady(repoPathArg: string): Promise<boolean> {
    const path = repoPathArg.trim();
    if (!path) return false;
    try {
      // pi 是进程内 SDK，无需等待外部服务端口；runtimeInfo 探测后端可用性即可。
      await agentClient.runtimeInfo();
      appendAgentDebugLog("service.ready (pi in-process)");
      return true;
    } catch (e) {
      appendAgentDebugLog(`service.ready error ${String(e)}`);
      return false;
    }
  }

  async function bootstrapAgentWorkspace(targetRepoId: string) {
    const repo = repos.find((item) => item.id === targetRepoId) || selectedRepo;
    if (!repo?.id?.trim() || !repo.path?.trim()) return;
    const repoId = repo.id.trim();

    const token = ++agentBootstrapTokenRef.current;
    agentBootstrapInFlightRef.current = true;
    appendAgentDebugLog(`bootstrap.start repo=${repoId}`);

    let providersOk = agentProviderCatalogLoadedRef.current;
    let serviceOk = false;
    let configOk = false;
    let modelConfigOk = agentModelConfigLoadedRef.current;
    let configuredModelsOk = agentConfiguredModelsLoadedRef.current;
    let sessionsOk = hasLoadedSidebarRepoSessions(repoId);
    await waitForPaint();
    const bootstrapStartedAt = Date.now();
    const isCancelled = () => agentBootstrapTokenRef.current !== token;

    try {
      // pi 进程内运行，无需加载 opencode 服务端口设置。
      if (isCancelled()) return;

      for (let attempt = 0; attempt < AGENT_BOOTSTRAP_RETRY_DELAYS_MS.length; attempt++) {
        if (isCancelled()) return;

        const targetDelay = AGENT_BOOTSTRAP_RETRY_DELAYS_MS[attempt];
        const waitMs = targetDelay - (Date.now() - bootstrapStartedAt);
        if (waitMs > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
        }
        if (isCancelled()) return;

        const isLastAttempt = attempt === AGENT_BOOTSTRAP_RETRY_DELAYS_MS.length - 1;

        if (!serviceOk) {
          serviceOk = await ensureAgentServiceReady(repo.path);
        }

        if (!providersOk) {
          providersOk = await loadAgentProviderCatalogOnce();
        }

        if (!configOk && selectedRepo?.id === repoId) {
          await refreshAgentServerConfig({ syncSelection: true, includeCurrentModel: true });
          configOk = true;
        }

        if (!modelConfigOk && selectedRepo?.id === repoId) {
          modelConfigOk = await loadAgentModelConfig({ silent: !isLastAttempt });
          if (modelConfigOk) agentModelConfigLoadedRef.current = true;
        }

        if (!configuredModelsOk && selectedRepo?.id === repoId) {
          await refreshAgentConfiguredModels();
          configuredModelsOk = true;
          agentConfiguredModelsLoadedRef.current = true;
        }

        if (!sessionsOk) {
          try {
            await refreshSidebarRepoSessions(repo);
            sessionsOk = hasLoadedSidebarRepoSessions(repoId);
            if (selectedRepo?.id === repoId) {
              // repoSwitched 必须在 refresh 之前读：refresh 内会把 agentSessionsRepoIdRef 置为新 repoId，
              // 之后再读就掩盖了仓库切换，导致切仓库后 active 仍停在旧仓库会话上。
              const repoSwitched = agentSessionsRepoIdRef.current !== repoId;
              const res = await refreshAgentSessions(getRepoSessionFetchLimit(repoId));
              if (isCancelled()) return;
              // 首次选中由 bootstrap 显式负责（用户意图：切仓库/启动恢复），不再依赖对齐 effect 越权写。
              // 幂等守卫 alreadyPicked：上一轮/用户已选则不覆盖；切仓库则允许重选。
              const intent = agentSelectionIntentRef.current;
              const alreadyPicked = !!intent?.sessionId && intent.sessionId === activeAgentSessionId;
              if ((!alreadyPicked || repoSwitched) && !draftAgentSession) {
                const bound = workspaceAgentBindings[normalizeWorkspacePath(repo.path)]?.activeSessionId || "";
                const list = res.mapped;
                const target = bound && list.some((s) => s.id === bound) ? bound : (list[0]?.id ?? "");
                if (target) {
                  selectAgentSession(target, bound === target ? "restore" : "bootstrap");
                } else if (res.empty && isLastAttempt) {
                  // 列表确实为空：进入草稿态，不写 active（保留空选中）。
                  setDraftAgentSession(true);
                }
              }
            }
            if (sessionsOk) expandProjectSessions(repoId);
          } catch (e) {
            appendAgentDebugLog(`bootstrap.sessions attempt=${attempt} error=${String(e)}`);
          }
        }

        if (serviceOk && providersOk && configOk && modelConfigOk && configuredModelsOk && sessionsOk) {
          break;
        }
      }

      if (isCancelled()) return;

      agentBootstrapDoneForRepoRef.current = serviceOk && providersOk ? repoId : "";
      // 启动屏信号：bootstrap 首轮结束（此时会话已选中，消息水合由 agentSessionLoading 覆盖）。
      setAgentBootstrapSettled(true);
      appendAgentDebugLog(
        `bootstrap.done repo=${repoId} service=${serviceOk} providers=${providersOk} config=${configOk} modelConfig=${modelConfigOk} configuredModels=${configuredModelsOk} sessions=${sessionsOk}`
      );
    } finally {
      if (agentBootstrapTokenRef.current === token) {
        agentBootstrapInFlightRef.current = false;
      }
    }
  }

  async function loadAgentServiceSettings() {
    // pi 嵌入式运行时无需独立服务端口；保留空实现以免设置页旧入口崩溃。
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
          pairCodeTtlMode: resolveControlPairCodeMode(draft)
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

  async function saveAgentServiceSettingsIfNeeded() {
    // pi 进程内运行，忽略旧的 4098 端口保存入口。
    return true;
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
      authMode: normalizeControlAuthMode(draftBase.authMode),
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
          pairCodeTtlMode: resolveControlPairCodeMode(draft)
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
    if (settingsMobileVisible && controlSettingsDirty && !controlServerSettingsBusy) {
      void saveControlServerSettingsIfNeeded();
    }
    setShowMobileControlDialog(false);
    setShowAgentApiDialog(false);
    setSettingsMobileVisible(false);
    setShowSettings(false);
  }

  async function closeMobileControlDialog() {
    const ok = await saveControlServerSettingsIfNeeded();
    if (ok) setShowMobileControlDialog(false);
  }

  async function closeAgentApiDialog() {
    const ok = await saveAgentServiceSettingsIfNeeded();
    if (ok) setShowAgentApiDialog(false);
  }

  async function refreshAgentConfiguredModels() {
    if (!ensureRepoSelected()) return;
    try {
      const configured = agentProvidersToConfigCatalog(await agentClient.listProviders());
      if (!configured || configured.length === 0) return;
      setAgentProviderNames((prev) => {
        const next = { ...prev };
        for (const p of configured) {
          if (!p?.id) continue;
          if (p.name && !next[p.id]) next[p.id] = p.name;
        }
        return next;
      });
      appendAgentDebugLog(`config.catalog names synced providers=${configured.length}`);
    } catch (e) {
      appendAgentDebugLog(`config.catalog error ${String(e)}`);
    }
  }

  async function refreshAgentServerProviders() {
    await loadAgentProviderCatalogOnce();
  }

  async function openConnectProvider(providerId: string) {
    if (!ensureRepoSelected()) return;
    const pid = providerId.trim();
    if (!pid) return;
    setAgentConnectProviderId(pid);
    setAgentConnectProviderName(resolveProviderDisplayName(pid));
    setAgentConnectApiKey("");
    try {
      if (!agentProviderAuthCache[pid]) {
        // pi 当前统一使用 api key 凭据（OAuth 类型 vault 已兼容，授权流程后续接入）。
        setAgentProviderAuthCache((prev) => ({ ...prev, [pid]: [{ type: "api", label: "API key" }] }));
      }
    } catch {
      // fallback: show API key input even if auth list fails
      setAgentProviderAuthCache((prev) => ({ ...prev, [pid]: prev[pid] ?? [{ type: "api", label: "API key" }] }));
    }
  }

  async function refreshAgentServerConfig(opts?: { syncSelection?: boolean; includeCurrentModel?: boolean }) {
    if (!ensureRepoSelected()) return;
    const syncSelection = opts?.syncSelection !== false;
    const includeCurrentModel = opts?.includeCurrentModel !== false;
    try {
      // pi 数据源：统一 catalog 的 hasCredential 即"已配置"语义。
      const agentProviders = await agentClient.listProviders();
      setAgentModelInfoByRef(indexAgentModelInfoByRef(agentProviders));
      const snapshot = buildAgentConfiguredProviderSnapshot(agentProvidersToGlobalConfig(agentProviders));
      setAgentGlobalConfigProviderMap(snapshot.providerMap);
      setAgentDisabledProviders(snapshot.disabledProviders);

      // Prefer /provider-derived display names when available.
      // /config is often "power-user" config and may use terse ids (e.g. k2p5) even when /provider has a nicer name (e.g. kimi2.5).
      setAgentProviderNames((prev) => {
        const next = { ...prev };
        for (const [pid, display] of Object.entries(snapshot.providerNames)) {
          if (!pid) continue;
          if (!next[pid]) next[pid] = display;
        }
        return next;
      });
      setAgentConfiguredModelsByProvider(snapshot.modelsByProvider);
      setAgentConfiguredModelNamesByProvider(snapshot.modelNamesByProvider);
      setAgentConfiguredProviders(snapshot.configuredProviders);

      if (includeCurrentModel) {
        // 会话 provider/model 以服务端 catalog 为准；此处只同步草稿预选到旁路 picker state。
        const currentModel = normalizeModelRef(activeAgentModel || agentDraftModel || "");
        if (currentModel) {
          const parsed = parseModelRef(currentModel);
          if (parsed) {
            ensureProviderExists(parsed.provider);
            if (syncSelection) {
              setAgentModelProvider(parsed.provider);
              setAgentSelectedModel(parsed.model);
            }
          }
          setAgentConfig((prev) => ({
            configPath: prev?.configPath || (agentConfig?.configPath || ""),
            configuredModel: currentModel,
            exists: true
          }));
        }
      }
      appendAgentDebugLog(`server.config synced providers=${Object.keys(snapshot.providerMap).length} configured=${snapshot.configuredProviders.length}`);
    } catch (e) {
      appendAgentDebugLog(`server.config error ${String(e)}`);
    }
  }


  // 已连接 provider 的实时模型刷新：内置快照可能过期（如 deepseek v4 上线后
  // 快照仍只有退役的 chat/reasoner），对已配置 key 的 provider 静默拉一次
  // /v1/models 合并新模型；pi 侧有 5 分钟 TTL 缓存，重复调用代价低。
  const refreshedProvidersRef = useRef<Set<string>>(new Set());
  async function refreshConnectedProviderModels() {
    if (!selectedRepo?.path) return;
    try {
      const providers = await agentClient.listProviders();
      const stale = providers.filter((provider) => provider.hasCredential && !refreshedProvidersRef.current.has(provider.provider));
      if (!stale.length) return;
      let addedTotal = 0;
      for (const provider of stale) {
        refreshedProvidersRef.current.add(provider.provider);
        const added = (await agentClient.refreshProviderModels(provider.provider).catch(() => [] as string[])) ?? [];
        addedTotal += added.length;
        if (added.length) {
          appendAgentDebugLog(`实时模型目录已更新: ${provider.provider} +${added.length} (${added.join(", ")})`);
        }
      }
      if (addedTotal > 0) {
        await refreshAgentServerConfig({ syncSelection: false, includeCurrentModel: false });
        await refreshAgentConnectedProvidersOnly();
      }
    } catch {
      // 静默：模型刷新失败不影响主流程
    }
  }

  useEffect(() => {
    if (!selectedRepo?.path) return;
    void refreshConnectedProviderModels();
  }, [selectedRepo?.path]);

  function ensureProviderExists(provider: string) {
    if (!provider) return;
    setAgentProviders((prev) => (prev.includes(provider) ? prev : [...prev, provider].sort((a, b) => a.localeCompare(b))));
  }

  async function disconnectAgentProvider(providerId: string) {
    const pid = providerId.trim();
    if (!pid) return;
    if (!ensureRepoSelected()) return;
    if (getAgentProviderSource(pid) === "env") {
      setMessage("Environment provider cannot be disconnected");
      return;
    }
    setAgentDisconnectingProvider(pid);
    setError("");
    try {
      // pi：断开 = 从 vault 移除该 provider 的凭据；env 注入的凭据由 hasCredential
      // 继续识别（adapter 中 source 不会标为 env 的凭据不受影响）。
      await agentClient.removeApiKey(pid);

      if (showAgentAuthDialogFor === pid) {
        setShowAgentAuthDialogFor("");
      }
      if (agentProviderActionMenuFor === pid) {
        setAgentProviderActionMenuFor("");
      }
      await refreshAgentServerConfig({ syncSelection: false, includeCurrentModel: false });
      await refreshAgentConnectedProvidersOnly();
      setMessage(`Disconnected provider: ${pid}`);
    } catch (e) {
      setError(String(e));
      setMessage("Disconnect provider failed");
    } finally {
      setAgentDisconnectingProvider("");
    }
  }

  async function removeAgentCustomProvider(providerId: string) {
    const pid = providerId.trim();
    if (!pid) return;
    // 自定义供应商目录是全局的，不依赖当前工作区。
    if (!canRemoveAgentCustomProvider(pid, agentProviderSourceById) && !isRemovableCustomProviderId(pid)) {
      setError("只有自定义供应商可以删除");
      setMessage("Only custom providers can be deleted");
      return;
    }
    const label = resolveProviderDisplayName(pid) || pid;
    setAgentDisconnectingProvider(pid);
    setError("");
    try {
      await agentClient.removeCustomProvider(pid);
      pruneLocalAgentProvider(pid);
      if (showAgentAuthDialogFor === pid) {
        setShowAgentAuthDialogFor("");
      }
      if (agentProviderActionMenuFor === pid) {
        setAgentProviderActionMenuFor("");
      }
      if (agentProviderPickerProvider === pid) {
        setAgentProviderPickerProvider("");
      }
      if (agentInlineAuthOpenFor === pid) {
        setAgentInlineAuthOpenFor("");
      }
      if (agentConnectProviderId === pid) {
        setAgentConnectProviderId("");
        setAgentConnectApiKey("");
        setAgentConnectBaseUrl("");
        setAgentConnectCustomName("");
      }
      const active = parseModelRef(activeAgentModel);
      if (active?.provider === pid) {
        // 当前选中模型属于已删供应商时清空，避免继续发到失效端点。
        const sid = activeAgentSessionId.trim();
        if (sid) {
          updateAgentSessionById(sid, (session) => {
            const next = { ...session };
            delete next.provider;
            delete next.model;
            return next;
          });
        }
        setAgentModelProvider("");
        setAgentSelectedModel("");
      }
      await refreshAgentConnectedProvidersOnly();
      if (selectedRepo) {
        await refreshAgentServerConfig({ syncSelection: false, includeCurrentModel: false });
      }
      setMessage(`已删除自定义供应商：${label}`);
    } catch (e) {
      setError(String(e));
      setMessage("删除自定义供应商失败");
    } finally {
      setAgentDisconnectingProvider("");
    }
  }

  async function runAgentPrompt(options?: { promptOverride?: string }) {
    if (!ensureRepoSelected()) return;
    const isQueueFlush = Boolean(options?.promptOverride?.trim());
    const typedPrompt = (options?.promptOverride ?? agentPromptInput).trim();
    const prompt = typedPrompt;
    const attachments = isQueueFlush ? [] : agentImageAttachments;
    const graphRefs = isQueueFlush ? [] : agentGraphContextRefs;
    if (!prompt && attachments.length === 0 && graphRefs.length === 0) return;
    // 在任何 await 之前上锁并清空输入，避免连按 Enter 发出两次相同内容。
    if (agentPromptSubmitLockRef.current) return;
    agentPromptSubmitLockRef.current = true;
    if (!isQueueFlush) {
      setAgentPromptInput("");
      setAgentImageAttachments([]);
      setAgentGraphContextRefs([]);
    }
    const releaseSubmitLock = () => {
      agentPromptSubmitLockRef.current = false;
    };
    const restoreComposer = () => {
      if (isQueueFlush) return;
      setAgentPromptInput(prompt);
      if (attachments.length > 0) setAgentImageAttachments(attachments);
      if (graphRefs.length > 0) setAgentGraphContextRefs(graphRefs);
    };

    const selectedModel = normalizeModelRef(activeAgentModel || "");
    if (!selectedModel) {
      restoreComposer();
      releaseSubmitLock();
      setError("请先配置并选择模型后再发送。");
      setMessage("请先选择模型");
      setSettingsInitialSection("models");
      setShowSettings(true);
      return;
    }

    const repoIdAtRun = selectedRepo?.id || newSessionTargetRepoId;
    // 用 ref 解析：点「新对话」后立刻发送时，state 里的 draft/active 可能尚未提交。
    let sessionId = resolvePromptTargetSessionId();
    const shouldCreate = !sessionId || draftAgentSessionRef.current;
    if (shouldCreate) {
      sessionId = await createPersistedAgentSession(prompt || "(attachment)");
    }
    if (!sessionId) {
      restoreComposer();
      releaseSubmitLock();
      return;
    }

    // 防御：若仍落在草稿意图上却拿到旧会话，强制新建，避免消息进旁路会话。
    if (draftAgentSessionRef.current && activeAgentSessionIdRef.current !== sessionId) {
      // create 已 select 到 sessionId；仅打日志便于追查串会话。
      appendAgentDebugLog(
        `agent.prompt.target session=${sessionId} draft=1 active=${activeAgentSessionIdRef.current || "-"}`
      );
    }

    // 发消息前确保当前 session hub 已同步 auto 偏好（覆盖：新建竞态、冷启动恢复会话）。
    await ensureSessionAutoAcceptPermissions(sessionId, agentAutoAcceptPermissions);
    // 发送前把 UI 选择落到服务端会话，并以返回 summary 回写 AgentChatSession（唯一真相）。
    const selectedParsed = parseModelRef(selectedModel);
    if (selectedParsed) {
      try {
        const updated = await agentClient.setModel(sessionId, selectedParsed.provider, selectedParsed.model);
        const serverProvider = String(updated.provider || selectedParsed.provider).trim();
        const serverModel = String(updated.model || selectedParsed.model).trim();
        updateAgentSessionById(sessionId, (session) => ({
          ...session,
          provider: serverProvider,
          model: serverModel
        }));
        setAgentModelProvider(serverProvider);
        setAgentSelectedModel(serverModel);
      } catch (error) {
        appendAgentDebugLog(`session.setModel.beforePrompt.error ${sessionId} ${String(error)}`);
        restoreComposer();
        releaseSubmitLock();
        setError(`模型同步失败：${String(error instanceof Error ? error.message : error)}`);
        setMessage("模型与会话不一致，请重新选择模型后再发送");
        return;
      }
    }
    const modelInfo = agentModelInfoByRef[activeAgentModel] || null;
    const piThinking = toPiThinkingLevel(activeAgentThinkingLevel, modelInfo);
    if (piThinking) {
      try {
        await agentClient.setThinking(sessionId, piThinking);
      } catch (error) {
        appendAgentDebugLog(`session.setThinking.error ${sessionId} ${String(error)}`);
      }
    }

    bindAgentSessionToWorkspace(sessionId, repoPath, worktreeOverview.branch || selectedBranch);
    // 会话级 mode/thinking 已由 createPersistedAgentSession（新建）与 applyAgentAgent /
    // applyAgentThinkingLevel（切换）写入；此处不再「首次锁定」，避免切换后旧值覆盖。
    // busy 用 ref 同步判定：React state 尚未提交时第二条发送不得再开一套 prompt。
    if (agentRunBusyBySessionRef.current[sessionId] || String(agentRunIdBySessionRef.current[sessionId] || "").trim()) {
      if (isQueueFlush) {
        releaseSubmitLock();
        return;
      }
      // run 进行中：只进本地跟进队列，本轮 prompt 结束后再开下一次 prompt。
      // 不调用 pi rust 的 steer/follow_up：官方 TS SDK 的 steer 会等工具跑完再注入，
      // 但当前 pi_agent_rust 仍会 skip 未执行工具；若再叠加结束后 autosend，同一句会生成两遍。
      if (!prompt || attachments.length > 0) {
        restoreComposer();
        releaseSubmitLock();
        setMessage("任务运行中：请等待当前回合完成或先停止，再发送附件");
        return;
      }
      enqueueFollowUp(sessionId, prompt);
      recordAgentPromptHistoryEntry(sessionId, prompt);
      setMessage("已排队：当前回复结束后继续");
      releaseSubmitLock();
      return;
    }

    const assistantId = "assistant-" + makeId();
    const runId = "run-" + makeId();
    const userId = "user-" + makeId();
    // 图片落到仓库 .giteam/prompt-attachments/，始终随消息透传给后端（对齐 opencode：直传、不降级）。
    // 后端按当前模型 input 能力分流：支持图片 → multimodal；不支持 → 不发 image block（避免
    //   provider HTTP 400），让模型基于文字回复。前端不再判断 imageInput，图片照常预览展示。
    let promptImages: Array<{ mimeType: string; path: string; relativePath: string }> = [];
    try {
      promptImages = await resolveAgentPromptImages(attachments, repoPath);
    } catch (error) {
      appendAgentDebugLog(`agent.prompt.images.stage.error ${String(error)}`);
      restoreComposer();
      releaseSubmitLock();
      setError("无法准备图片附件，请重试。");
      setMessage("Image attachment failed");
      return;
    }
    const multimodalImages = promptImages;
    const fileHints = attachments.flatMap((attachment) => {
      if (isImageAttachment(attachment)) return [];
      const filename = attachment.filename || "unnamed attachment";
      if (attachment.sourcePath) {
        return [formatLocalFileAttachmentHint(filename, attachment.sourcePath)];
      }
      return [formatUiOnlyFileAttachmentHint(filename, attachment.mime || "unknown MIME type")];
    });
    const graphContextBlock = formatGraphContextBlock(graphRefs);
    const sessionPrompt = [prompt, graphContextBlock, ...fileHints].filter(Boolean).join("\n\n").trim();
    if (!sessionPrompt && multimodalImages.length === 0) {
      if (attachments.some((attachment) => isImageAttachment(attachment))) {
        restoreComposer();
        releaseSubmitLock();
        setError("无法读取图片附件，请重试或改用文件选择器添加图片。");
        setMessage("Image attachment failed");
      } else {
        releaseSubmitLock();
      }
      return;
    }
    const displayAttachments = attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      // 预览优先 dataUrl；file:// 临时路径在 WebView 里经常加载失败
      uri: attachment.dataUrl || (attachment.sourcePath ? "file://" + encodeFilePathForUrl(attachment.sourcePath) : ""),
      mime: attachment.mime,
      filename: attachment.filename
    }));

    agentMessageCache.invalidate(repoPath, sessionId);
    setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: assistantId }));
    if (isQueueFlush) popQueuedFollowUp(sessionId, prompt);

    const scrollToBottom = (options?: { force?: boolean }) => {
      if (activeAgentSessionId !== sessionId) return;
      // 仅 force（用户发送）时恢复贴底跟随：递增 signal 让 AgentMessageStream 的 stick ref 置 true，
      // 由其持续 rAF 物理钉底接管滚到底。不再用 scrollToIndex——它依赖 defaultItemHeight(160) 估算，
      // 实测校正那一帧就是「发送后气泡下移」抖动（问题2）。
      if (!options?.force) return;
      setAgentAutoFollowLatest(true);
      setAgentStickResetSignal((n) => n + 1);
    };

    updateAgentSessionById(sessionId, (session) => {
      const nextMessages: AgentChatMessage[] = [
        ...session.messages,
        {
          id: userId,
          role: "user",
          content: prompt,
          graphRefs: graphRefs.length > 0 ? graphRefs : undefined,
          attachments: displayAttachments
        },
        { id: assistantId, role: "assistant", content: "" }
      ];
      return {
        ...session,
        messages: nextMessages,
        updatedAt: Date.now()
      };
    });
    updateSidebarAgentSession(repoIdAtRun, sessionId, (session) => ({ ...session, updatedAt: Date.now() }));
    scrollToBottom({ force: true });
    recordAgentPromptHistoryEntry(sessionId, prompt);
    agentRunBusyBySessionRef.current[sessionId] = true;
    setAgentRunBusyBySession((prev) => ({ ...prev, [sessionId]: true }));
    agentRunIdBySessionRef.current[sessionId] = runId;
    const pendingUsers = agentPendingLocalUserIdsBySessionRef.current[sessionId] || [];
    pendingUsers.push(userId);
    agentPendingLocalUserIdsBySessionRef.current[sessionId] = pendingUsers;
    releaseSubmitLock();

    const localAssistantByMessageId = new Map<string, string>();
    const localAssistantIds = [assistantId];
    let currentLocalAssistantId = assistantId;
    // 工具事件（tool.started/completed 等）自身不带 messageId，需要跟踪
    // 当前 assistant 服务端消息 id 作为 live parts 的归组键；否则工具时间线
    // 无处挂载，永远渲染不出来（只能退化为 content 里的纯文本行）。
    let currentServerAssistantId = "";
    // message.completed 之后冻结该 id：下一回合的 toolCall 常在 message.started 前到达，
    // 若仍写入上一回合 live，合并展示时会与新回合重复 → 过程中「已运行 3/1/7」、结束后对账成 2/1/4。
    const frozenAssistantMessageIds = new Set<string>();
    /** 同一服务端 user id 只消费一次 pending，防止重复 completed 吃掉下一条连发乐观气泡。 */
    const completedUserMessageIds = new Set<string>();
    const pendingToolsBeforeMessage: AgentDetailedPart[] = [];
    let eventSubscription: { close: () => void } | null = null;
    let finalized = false;
    let finalizePromise: Promise<void> | null = null;
    // 旁路记忆抽取在 run.completed 之后才回 completed/failed（ephemeral LLM 调用，
    // 默认超时 120s）。finalize 立刻关订阅会丢这个终态事件，part 永远停在
    // started，时间线卡片卡死「记录中」。跟踪在飞抽取，订阅留到其落地再关。
    const pendingMemoryExtractions = new Set<string>();
    let memoryGraceTimer: number | null = null;
    const closeEventSubscription = () => {
      if (memoryGraceTimer !== null) {
        window.clearTimeout(memoryGraceTimer);
        memoryGraceTimer = null;
      }
      if (eventSubscription) {
        eventSubscription.close();
        eventSubscription = null;
      }
    };
    const closeSubscriptionWhenMemorySettled = () => {
      if (finalized && pendingMemoryExtractions.size === 0) closeEventSubscription();
    };
    /** 订阅已收到的事件数；>0 时禁止再整段回放 result.events（二次 ensure 会叠出同文气泡）。 */
    let liveEventCount = 0;

    const migrateLivePartsKey = (fromId: string, toId: string) => {
      const from = fromId.trim();
      const to = toId.trim();
      if (!from || !to || from === to) return;
      commitAgentLiveParts((prev) => {
        const source = prev[from];
        if (!source?.length) {
          if (!(from in prev)) return prev;
          const next = { ...prev };
          delete next[from];
          return next;
        }
        const existing = prev[to] || [];
        const merged = [...existing];
        for (const part of source) {
          const pid = String((part as { id?: string }).id || "").trim();
          if (pid && merged.some((item) => String((item as { id?: string }).id || "") === pid)) continue;
          merged.push(part);
        }
        const next = { ...prev, [to]: merged };
        delete next[from];
        return next;
      });
      commitAgentServerMessageIdByLocalId((prev) => {
        if (!(from in prev) && prev[to] === to) return prev;
        const next = { ...prev };
        delete next[from];
        next[to] = to;
        return next;
      });
    };

    const remapAssistantIdInMessages = (
      messages: AgentChatMessage[],
      fromId: string,
      toId: string
    ): AgentChatMessage[] => {
      if (!fromId || !toId || fromId === toId) return messages;
      if (messages.some((item) => item.id === toId)) {
        return messages.filter((item) => item.id !== fromId);
      }
      return messages.map((item) => (item.id === fromId ? { ...item, id: toId } : item));
    };

    /**
     * 对齐远程 ensureRemoteAssistantBubble：列表身份尽快变成服务端 messageId。
     * 禁止长期保留 assistant-* 与 server id 两套行——那是同文连发双气泡的根因。
     */
    const ensureLocalAssistant = (messageId: string): string => {
      const id = messageId.trim();
      if (!id) return currentLocalAssistantId;
      const existing = localAssistantByMessageId.get(id);
      if (existing) return existing;

      if (localAssistantByMessageId.size === 0) {
        localAssistantByMessageId.set(id, id);
        migrateLivePartsKey(assistantId, id);
        const from = assistantId;
        const idx = localAssistantIds.indexOf(from);
        if (idx >= 0) localAssistantIds[idx] = id;
        currentLocalAssistantId = id;
        currentServerAssistantId = id;
        setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: id }));
        updateAgentSessionById(sessionId, (session) => ({
          ...session,
          messages: remapAssistantIdInMessages(session.messages, from, id),
          updatedAt: Date.now()
        }));
        return id;
      }

      localAssistantByMessageId.set(id, id);
      currentLocalAssistantId = id;
      currentServerAssistantId = id;
      setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: id }));
      let remappedFrom = "";
      updateAgentSessionById(sessionId, (session) => {
        if (session.messages.some((message) => message.id === id)) return session;
        const last = session.messages[session.messages.length - 1];
        const lastLive = last?.id ? (agentLivePartsByServerMessageIdRef.current[last.id] || []) : [];
        const lastHasSubstance = lastLive.some((part) => {
          const type = String((part as { type?: string }).type || "");
          if (type === "text" || type === "reasoning") {
            return Boolean(String((part as { text?: string }).text || "").trim());
          }
          return type === "toolCall" || type === "runtime.failure" || type === "runtime.retry" || type === "runtime.memory";
        });
        // 只 remap 本地 assistant-* 占位。工具轮完成态常无 content（正文在下一轮），
        // 若把已有服务端 id 的空泡 remap 成下一条 text assistant，completed 还会在末尾
        // 再 push 一条工具卡 → 「已查询」跑到最终回复下面。
        const canRemap =
          last?.role === "assistant"
          && last.id.startsWith("assistant-")
          && !String(last.content || "").trim()
          && !lastHasSubstance
          && !frozenAssistantMessageIds.has(last.id)
          && pendingToolsBeforeMessage.length === 0;
        if (canRemap) {
          remappedFrom = last.id;
          migrateLivePartsKey(last.id, id);
          return {
            ...session,
            messages: remapAssistantIdInMessages(session.messages, last.id, id),
            updatedAt: Date.now()
          };
        }
        return {
          ...session,
          messages: appendAssistantMessage(session.messages, {
            id,
            role: "assistant",
            content: ""
          }),
          updatedAt: Date.now()
        };
      });
      if (remappedFrom) {
        const idx = localAssistantIds.indexOf(remappedFrom);
        if (idx >= 0) localAssistantIds[idx] = id;
        else if (!localAssistantIds.includes(id)) localAssistantIds.push(id);
        localAssistantByMessageId.delete(remappedFrom);
      } else if (!localAssistantIds.includes(id)) {
        localAssistantIds.push(id);
      }
      return id;
    };

    const replaceAssistantMessage = (
      message: AgentMessage,
      options?: { rebuildLive?: boolean }
    ) => {
      if (message.role !== "assistant") return;
      const localId = ensureLocalAssistant(message.id);
      const mapped = agentMessageToChatMessage(message);
      if (!mapped) return;
      const softAppendCompletedTextToLive = () => {
        const textBlocks = message.parts
          .filter(
            (part): part is Extract<AgentPart, { type: "text" }> =>
              part.type === "text" && Boolean(part.text.trim())
          )
          .map((part) => part.text);
        if (textBlocks.length === 0) return;
        commitAgentLiveParts((prev) => {
          const current = prev[message.id] || [];
          const { parts, changed } = appendMissingTextPartsToLive(current, textBlocks);
          if (!changed) return prev;
          return { ...prev, [message.id]: parts };
        });
      };
      updateAgentSessionById(sessionId, (session) => {
        const current = session.messages.find((item) => item.id === localId);
        // 手动暂停后 history replace 常不带 error；保留本地已写入的「已暂停」，避免被冲掉后又由 finalize 再塞一条。
        const preservedError = String(current?.error || mapped.error || "").trim();
        // 完成态若暂时没有 text block，不要用空/更短 content 盖掉已流式正文。
        // 但若 live 因 merge 拼出「双份假更长」，优先折叠后的完成态/单份正文。
        const nextContent = pickPreferredAgentContent(mapped.content, current?.content);
        if (!current) {
          return {
            ...session,
            messages: appendAssistantMessage(session.messages, {
              ...mapped,
              id: localId,
              content: nextContent,
              ...(preservedError ? { error: preservedError } : {})
            }),
            updatedAt: Date.now()
          };
        }
        if (
          current.content === nextContent &&
          String(current.error || "").trim() === preservedError
        ) {
          return session;
        }
        return {
          ...session,
          messages: session.messages.map((item) =>
            item.id === localId
              ? {
                  ...mapped,
                  id: localId,
                  content: nextContent,
                  ...(preservedError ? { error: preservedError } : {})
                }
              : item
          ),
          updatedAt: Date.now()
        };
      });
      // 流式结束后的最终 replace 不要重建 live：否则刚稳定的时间线会被 history 结构换掉，列表闪一下。
      if (options?.rebuildLive === false) {
        softAppendCompletedTextToLive();
        return;
      }
      // 按完成态消息的 block 顺序重建 live：与 session jsonl 一致（thinking → toolCall* → text），
      // 丢掉流式期乱序/幽灵工具；status/output 仍从旧 live 按 toolCallId 继承。
      const finalTools = message.parts.filter(
        (part): part is Extract<AgentPart, { type: "toolCall" }> => part.type === "toolCall" && !!part.toolCallId
      );
      commitAgentLiveParts((prev) => {
        const current = prev[message.id] || [];
        const liveToolIds = current
          .filter((part) => String((part as { type?: string }).type || "") === "toolCall")
          .map((part) => String((part as { id?: string }).id || (part as { toolCallId?: string }).toolCallId || "").trim())
          .filter(Boolean);
        const finalToolIds = finalTools.map((part) => part.toolCallId);
        const finalToolIdSet = new Set(finalToolIds);
        const liveToolIdSet = new Set(liveToolIds);
        // 批并行子卡 id 为 parent:index，不会进 history message.parts；多出来的 live 子卡不算「不一致」。
        const liveOnlyIds = liveToolIds.filter((id) => !finalToolIdSet.has(id));
        const liveOnlyAreSubagentChildren = liveOnlyIds.every((id) => {
          const indexed = parseIndexedParentToolCallId(id);
          return Boolean(indexed && finalToolIdSet.has(indexed.parentId));
        });
        // 工具集合（按 id，不要求顺序）已与完成态一致时，只就地补正文/思考，
        // 避免按 history block 顺序整段重建导致 timeline remount、列表闪一下。
        const toolsMatch =
          finalToolIds.every((id) => liveToolIdSet.has(id))
          && (liveToolIds.length === finalToolIds.length || liveOnlyAreSubagentChildren)
          && current.length > 0;
        if (toolsMatch) {
          let changed = false;
          const finalTextBlocks = message.parts.filter(
            (part): part is Extract<AgentPart, { type: "text" }> =>
              part.type === "text" && Boolean(part.text.trim())
          );
          const finalReasoningBlocks = message.parts
            .map((part, index) =>
              part.type === "reasoning" || part.type === "redactedReasoning"
                ? { index, part }
                : null
            )
            .filter((item): item is { index: number; part: Extract<AgentPart, { type: "reasoning" | "redactedReasoning" }> } => Boolean(item));
          let textOrdinal = 0;
          let reasoningOrdinal = 0;
          const next = current.map((part) => {
            const type = String((part as { type?: string }).type || "");
            const id = String((part as { id?: string }).id || "");
            if (type === "text" || id.startsWith("text:")) {
              const block = finalTextBlocks[textOrdinal++];
              if (block) {
                const liveText = String((part as { text?: string }).text || "");
                const text = pickPreferredAgentContent(block.text, liveText);
                if (liveText !== text) {
                  changed = true;
                  return { ...(part as object), type: "text", text } as AgentDetailedPart;
                }
              }
              return part;
            }
            if (type === "reasoning" || id.startsWith("reasoning:")) {
              const entry = finalReasoningBlocks[reasoningOrdinal++];
              if (entry) {
                const text = entry.part.type === "reasoning" ? entry.part.text : "";
                const redacted = entry.part.type === "redactedReasoning";
                if (
                  String((part as { text?: string }).text || "") !== text ||
                  Boolean((part as { redacted?: boolean }).redacted) !== redacted
                ) {
                  changed = true;
                  return {
                    ...(part as object),
                    type: "reasoning",
                    text,
                    ...(redacted ? { redacted: true } : {})
                  } as AgentDetailedPart;
                }
              }
              return part;
            }
            return part;
          });
          // live 尚无正文、完成态已有时再追加；若已有同文/超集 text 则跳过，避免 text:0 + text:soft 双渲。
          while (textOrdinal < finalTextBlocks.length) {
            const block = finalTextBlocks[textOrdinal++];
            const blockText = pickPreferredAgentContent(block.text);
            if (!blockText) continue;
            const already = next.some((part) => {
              const type = String((part as { type?: string }).type || "");
              const id = String((part as { id?: string }).id || "");
              if (type !== "text" && !id.startsWith("text:")) return false;
              const prev = pickPreferredAgentContent(String((part as { text?: string }).text || ""));
              if (!prev) return false;
              return prev === blockText || prev.startsWith(blockText) || blockText.startsWith(prev);
            });
            if (already) continue;
            changed = true;
            next.push({
              id: `text:soft:${textOrdinal - 1}`,
              type: "text",
              text: blockText
            } as AgentDetailedPart);
          }
          const deduped = dedupeAgentDuplicateTextParts(next);
          if (!changed && deduped.length === next.length) return prev;
          return { ...prev, [message.id]: deduped };
        }
        const liveByToolId = new Map<string, AgentDetailedPart>();
        for (const part of current) {
          if (String((part as { type?: string }).type || "") !== "toolCall") continue;
          const id = String((part as { id?: string }).id || (part as { toolCallId?: string }).toolCallId || "").trim();
          if (id) liveByToolId.set(id, part);
        }
        const next: AgentDetailedPart[] = [];
        message.parts.forEach((part, index) => {
          if (part.type === "reasoning" || part.type === "redactedReasoning") {
            const text = part.type === "reasoning" ? part.text : "";
            if (part.type === "redactedReasoning" || text.trim()) {
              next.push({
                id: `reasoning:${index}`,
                type: "reasoning",
                text,
                ...(part.type === "redactedReasoning" ? { redacted: true } : {})
              } as AgentDetailedPart);
            }
            return;
          }
          if (part.type === "text") {
            if (part.text.trim()) {
              next.push({ id: `text:${index}`, type: "text", text: part.text } as AgentDetailedPart);
            }
            return;
          }
          if (part.type === "toolCall" && part.toolCallId) {
            const existing = liveByToolId.get(part.toolCallId);
            if (existing) {
              next.push({
                ...existing,
                toolName: part.toolName || (existing as { toolName?: string }).toolName,
                ...(part.input !== undefined ? { input: part.input } : {})
              } as AgentDetailedPart);
            } else {
              next.push(buildToolPart({
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                status: "running",
                input: part.input
              }));
            }
          }
        });
        // 保留 history 没有的 live 工具：批并行子卡（parent:index）、以及中止前已投影的过程态。
        // 否则暂停后 message.completed 按 history 重建会把整段子任务时间线清掉。
        for (const part of current) {
          const type = String((part as { type?: string }).type || "");
          if (type !== "toolCall") continue;
          const id = String((part as { id?: string }).id || (part as { toolCallId?: string }).toolCallId || "").trim();
          if (!id || finalToolIdSet.has(id)) continue;
          if (next.some((item) => String((item as { id?: string }).id || (item as { toolCallId?: string }).toolCallId || "").trim() === id)) {
            continue;
          }
          const indexed = parseIndexedParentToolCallId(id);
          if (indexed && finalToolIdSet.has(indexed.parentId)) {
            next.push(part);
            continue;
          }
          // 中止时 history 可能比 live 少工具：仍保留已有 toolName 的 live 卡，避免「全丢」。
          if (String((part as { toolName?: string }).toolName || "").trim()) {
            next.push(part);
          }
        }
        // 保留流式期写入的重试/失败/记忆事件（history message.parts 不含这些 ephemeral 类型）。
        // 成功重试不保留，避免「已重试」标签黏在最新正文下方。
        for (const part of current) {
          const type = String((part as { type?: string }).type || "");
          if (type !== "runtime.retry" && type !== "runtime.failure" && type !== "runtime.memory") continue;
          if (
            type === "runtime.retry"
            && String((part as { phase?: string }).phase || "").trim() === "completed"
            && (part as { success?: boolean | null }).success === true
          ) {
            continue;
          }
          const id = String((part as { id?: string }).id || "").trim();
          if (!id) continue;
          if (next.some((item) => String((item as { id?: string }).id || "") === id)) continue;
          next.push(part);
        }
        // 完成态可能尚未带上 text block：保留 live 正文，避免时间线只剩工具卡。
        const nextHasText = next.some(
          (part) =>
            String((part as { type?: string }).type || "") === "text"
            && Boolean(String((part as { text?: string }).text || "").trim())
        );
        if (!nextHasText) {
          for (const part of current) {
            const type = String((part as { type?: string }).type || "");
            const id = String((part as { id?: string }).id || "");
            if (type !== "text" && !id.startsWith("text:")) continue;
            if (!String((part as { text?: string }).text || "").trim()) continue;
            next.push(part);
          }
        }
        const deduped = dedupeAgentDuplicateTextParts(next);
        const changed =
          deduped.length !== current.length ||
          deduped.some((part, index) => {
            const prevPart = current[index] as {
              id?: string;
              type?: string;
              text?: string;
              status?: string;
              error?: string;
              phase?: string;
              attempt?: number;
              success?: boolean | null;
            } | undefined;
            if (!prevPart) return true;
            if (String(prevPart.id || "") !== String((part as { id?: string }).id || "")) return true;
            if (String(prevPart.type || "") !== String((part as { type?: string }).type || "")) return true;
            if (String(prevPart.text || "") !== String((part as { text?: string }).text || "")) return true;
            if (String(prevPart.status || "") !== String((part as { status?: string }).status || "")) return true;
            if (String(prevPart.error || "") !== String((part as { error?: string }).error || "")) return true;
            if (String(prevPart.phase || "") !== String((part as { phase?: string }).phase || "")) return true;
            if (Number(prevPart.attempt || 0) !== Number((part as { attempt?: number }).attempt || 0)) return true;
            if (Boolean(prevPart.success) !== Boolean((part as { success?: boolean | null }).success)) return true;
            return false;
          });
        return changed ? { ...prev, [message.id]: deduped } : prev;
      });
    };

    // 流式渲染批处理（对齐 super_agent_mobile STREAM_UPDATE_BATCH_MS 的双层合帧思路）：
    // delta 先入账到缓冲，24ms 窗口内合并成一次 setState；partial 快照优先于 delta 拼接。
    const STREAM_UPDATE_BATCH_MS = 24;
    type PendingStreamEntry = { delta: string; snapshot: string; contentIndex: number };
    const pendingTextStream = new Map<string, PendingStreamEntry>();
    const pendingReasoningStream = new Map<string, PendingStreamEntry>();
    let streamFlushTimer: number | null = null;

    const streamPartKey = (messageId: string, contentIndex: number) => `${messageId}::${contentIndex}`;

    const applyTextStreamEntry = (messageId: string, entry: PendingStreamEntry) => {
      const localId = ensureLocalAssistant(messageId);
      updateAgentSessionById(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((item) => {
          if (item.id !== localId) return item;
          const content = pickPreferredAgentContent(
            entry.snapshot || (item.content || "") + entry.delta,
            item.content
          );
          return content === item.content ? item : { ...item, content };
        }),
        updatedAt: Date.now()
      }));
      // 同步写入 live text part，否则有 tool/reasoning 时 timeline 优先 liveParts，正文会消失
      const textPartId = `text:${entry.contentIndex}`;
      if (entry.snapshot) setAgentLivePartField(messageId, textPartId, "text", entry.snapshot);
      else if (entry.delta) patchAgentLivePartDelta(messageId, textPartId, "text", entry.delta);
    };

    const flushStreamUpdates = () => {
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
      // 先落盘 reasoning 再落盘 text：reasoning 模型思考先于正文（pi 流式 ThinkingDelta→TextDelta，
      // events.rs 发 reasoning.delta 先于 message.delta）。24ms 合帧窗口内若二者首帧同到，必须先创建
      // reasoning part、再创建 text part——否则 text 先 push 进 liveParts 会排在思考之前，渲染成
      // 「正文在上、思考跑到正文下面」（用户反馈 kimi 思考错位）。后续 flush 均命中已存在 part 原地
      // 更新、顺序由首帧锁定，故只需保证首帧 reasoning 在前即可。
      pendingReasoningStream.forEach((entry, key) => {
        const messageId = key.split("::")[0] || key;
        // 按 content block index 区分多段思考；字段名必须是 text（ReasoningGroup 读 part.text）
        const reasoningPartId = `reasoning:${entry.contentIndex}`;
        if (entry.snapshot) setAgentLivePartField(messageId, reasoningPartId, "text", entry.snapshot);
        else if (entry.delta) patchAgentLivePartDelta(messageId, reasoningPartId, "text", entry.delta);
      });
      pendingReasoningStream.clear();
      pendingTextStream.forEach((entry, key) => {
        const messageId = key.split("::")[0] || key;
        applyTextStreamEntry(messageId, entry);
      });
      pendingTextStream.clear();
      scrollToBottom();
    };

    const scheduleStreamFlush = () => {
      if (streamFlushTimer !== null) return;
      streamFlushTimer = window.setTimeout(flushStreamUpdates, STREAM_UPDATE_BATCH_MS);
    };

    const queueStreamDelta = (
      queue: Map<string, PendingStreamEntry>,
      messageId: string,
      contentIndex: number,
      delta: string,
      snapshot: string
    ) => {
      if (!messageId || (!delta && !snapshot)) return;
      const key = streamPartKey(messageId, contentIndex);
      const prev = queue.get(key) || { delta: "", snapshot: "", contentIndex };
      prev.delta += delta;
      if (snapshot) prev.snapshot = snapshot;
      prev.contentIndex = contentIndex;
      queue.set(key, prev);
      scheduleStreamFlush();
    };

    const cancelStreamBatch = () => {
      if (streamFlushTimer !== null) window.clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
      pendingTextStream.clear();
      pendingReasoningStream.clear();
    };

    const updateToolPart = (messageId: string, part: AgentDetailedPart) => {
      // 禁止回退到 session 级孤儿桶：空 messageId 时工具无处归属，硬塞会在过程中虚增
      // 「已运行 N 条」，结束后 history 对账又对不上。等 message.started 建立 current 后再挂。
      let id = messageId.trim();
      if (!id) return;
      if (frozenAssistantMessageIds.has(id)) {
        const pid = String(
          (part as { id?: string }).id
          || (part as { toolCallId?: string }).toolCallId
          || ""
        ).trim();
        const liveOnFrozen = agentLivePartsByServerMessageIdRef.current[id] || [];
        const partIdOf = (item: AgentDetailedPart) =>
          String(
            (item as { id?: string }).id
            || (item as { toolCallId?: string }).toolCallId
            || ""
          ).trim();
        const existsOnFrozen = Boolean(pid && liveOnFrozen.some((item) => partIdOf(item) === pid));
        const indexed = pid ? parseIndexedParentToolCallId(pid) : null;
        const parentOnFrozen = Boolean(
          indexed
          && liveOnFrozen.some((item) => partIdOf(item) === indexed.parentId)
        );
        // 子任务终态/进度：工具卡已在该冻结消息上（或父 task 在其上）时必须写回，不能丢到下一条。
        if (existsOnFrozen || parentOnFrozen) {
          upsertAgentLivePart(id, part);
          scrollToBottom();
          return;
        }
        // 已完成回合不再收全新工具；挂到尚未冻结的当前回合，否则先缓冲到下一次 message.started。
        const current = currentServerAssistantId.trim();
        if (current && current !== id && !frozenAssistantMessageIds.has(current)) {
          id = current;
        } else {
          if (pid) {
            const hit = pendingToolsBeforeMessage.findIndex((item) => partIdOf(item) === pid);
            if (hit >= 0) pendingToolsBeforeMessage[hit] = { ...pendingToolsBeforeMessage[hit], ...part };
            else pendingToolsBeforeMessage.push(part);
          }
          return;
        }
      }
      upsertAgentLivePart(id, part);
      scrollToBottom();
    };

    const onAgentEvent = (envelope: AgentEvent) => {
      if (envelope.sessionId !== sessionId || envelope.runId !== runId) return;
      liveEventCount += 1;
      const event = envelope.event;
      switch (event.type) {
        case "message.delta":
          if (event.messageId) currentServerAssistantId = event.messageId;
          queueStreamDelta(
            pendingTextStream,
            event.messageId || "",
            Number(event.index) || 0,
            event.delta || "",
            event.partial || ""
          );
          break;
        case "reasoning.delta":
          if (event.messageId) {
            currentServerAssistantId = event.messageId;
            queueStreamDelta(
              pendingReasoningStream,
              event.messageId,
              Number(event.index) || 0,
              event.delta || "",
              event.partial || ""
            );
          }
          break;
        case "message.completed":
          // 先冲刷未落盘的 text/reasoning，再以完成态为准重建；只丢弃缓冲会导致
          // soft-append 另起 text:soft，与稍后/已有的 text:N 双份渲染。
          flushStreamUpdates();
          if (event.message && typeof event.message !== "string") {
            const completedId = event.message.id;
            for (const key of [...pendingTextStream.keys()]) {
              if (key === completedId || key.startsWith(`${completedId}::`)) pendingTextStream.delete(key);
            }
            for (const key of [...pendingReasoningStream.keys()]) {
              if (key === completedId || key.startsWith(`${completedId}::`)) pendingReasoningStream.delete(key);
            }
            // 用户消息正式落地：乐观 user-* 按 bag remap。跟进已在 flush 时从预览队列摘掉，这里不再 pop。
            if (event.message.role === "user") {
              const mappedUser = agentMessageToChatMessage(event.message);
              if (mappedUser) {
                if (completedUserMessageIds.has(mappedUser.id)) {
                  break;
                }
                const sessionNow = agentSessionsRef.current.find((item) => item.id === sessionId);
                if (sessionNow?.messages.some((item) => item.id === mappedUser.id)) {
                  completedUserMessageIds.add(mappedUser.id);
                  break;
                }
                completedUserMessageIds.add(mappedUser.id);
                const bag = agentPendingLocalUserIdsBySessionRef.current[sessionId] || [];
                const pendingId = bag.shift() || "";
                agentPendingLocalUserIdsBySessionRef.current[sessionId] = bag;
                const liveId = currentServerAssistantId || currentLocalAssistantId;
                const liveActive = Boolean(liveId) && !frozenAssistantMessageIds.has(liveId);
                updateAgentSessionById(sessionId, (session) => {
                  let replaced = false;
                  let next = session.messages.flatMap((candidate) => {
                    if (candidate.id === mappedUser.id) {
                      replaced = true;
                      return [mergeCompletedUserChatMessage(
                        {
                          ...candidate,
                          ...mappedUser,
                          attachments: candidate.attachments || mappedUser.attachments
                        },
                        candidate
                      )];
                    }
                    if (pendingId && candidate.id === pendingId) {
                      replaced = true;
                      return [mergeCompletedUserChatMessage(
                        {
                          ...mappedUser,
                          attachments: candidate.attachments || mappedUser.attachments
                        },
                        candidate
                      )];
                    }
                    return [candidate];
                  });
                  if (!replaced) {
                    if (pendingId) {
                      const restore = agentPendingLocalUserIdsBySessionRef.current[sessionId] || [];
                      restore.unshift(pendingId);
                      agentPendingLocalUserIdsBySessionRef.current[sessionId] = restore;
                    }
                    next = commitUserBeforeLiveAssistant(
                      next,
                      mergeCompletedUserChatMessage(mappedUser),
                      liveActive ? liveId : ""
                    );
                  }
                  const seen = new Set<string>();
                  return {
                    ...session,
                    messages: next.filter((item) => {
                      if (item.id !== mappedUser.id) return true;
                      if (seen.has(item.id)) return false;
                      seen.add(item.id);
                      return true;
                    }),
                    updatedAt: Date.now()
                  };
                });
              }
              break;
            }
            // 已 finalize（含手动暂停）后不再按 history 重建 live，否则会冲掉已落盘的子卡/时间线。
            replaceAssistantMessage(event.message, { rebuildLive: !finalized });
            if (completedId) frozenAssistantMessageIds.add(completedId);
          }
          break;
        case "message.started": {
          // 仅 assistant 的 started 绑定回复气泡。user 的 MessageStart 若误绑，
          // serverMessageId→assistant 会把用户正文当成助手流式输出（未请求模型也会「打字」）。
          const startedMessageId = String(event.messageId || "").trim();
          const startedRole = String((event as { role?: string }).role || "").trim().toLowerCase();
          const looksLikeUserId = startedMessageId.startsWith("user-");
          if (
            looksLikeUserId ||
            startedRole === "user" ||
            startedRole === "tool" ||
            startedRole === "custom"
          ) {
            break;
          }
          if (startedMessageId) {
            const previousServerId = currentServerAssistantId;
            currentServerAssistantId = startedMessageId;
            ensureLocalAssistant(startedMessageId);
            // 首包失败时重试事件可能写在 retry-pending 键下，迁到真实 messageId。
            if (
              previousServerId &&
              previousServerId.startsWith("retry-pending:") &&
              previousServerId !== startedMessageId
            ) {
              commitAgentLiveParts((prev) => {
                const pending = prev[previousServerId];
                if (!pending?.length) return prev;
                const existing = prev[startedMessageId] || [];
                const merged = [...existing];
                for (const part of pending) {
                  const id = String((part as { id?: string }).id || "").trim();
                  if (!id || merged.some((item) => String((item as { id?: string }).id || "") === id)) continue;
                  merged.push(part);
                }
                const next = { ...prev, [startedMessageId]: merged };
                delete next[previousServerId];
                return next;
              });
              localAssistantByMessageId.delete(previousServerId);
            }
            // Codex：缓冲工具挂到新的 active cell，不回写已冻结回合。
            if (pendingToolsBeforeMessage.length > 0) {
              const queued = pendingToolsBeforeMessage.splice(0, pendingToolsBeforeMessage.length);
              for (const part of queued) {
                upsertAgentLivePart(startedMessageId, part);
              }
              scrollToBottom();
            }
          }
          break;
        }
        case "toolCall.started": {
          // 先冲刷未落盘的 reasoning/text，避免 24ms 合帧窗口内 tool 先入列、思考后到而乱序
          flushStreamUpdates();
          // LLM 流式生成 tool call 的开始；执行开始时 tool.started 会用完整 input 覆盖同 id part。
          // 禁止 makeId()：空 toolCallId 时跳过，否则过程中会累积幽灵工具，结束后 history 对账数量变少。
          const startedToolCallId = String(event.toolCallId || "").trim();
          if (startedToolCallId) {
            updateToolPart(currentServerAssistantId, buildToolPart({
              toolCallId: startedToolCallId,
              toolName: event.toolName || "",
              status: "running"
            }));
          }
          break;
        }
        case "toolCall.delta": {
          // 流式参数增量：累积到 inputRaw，tool.started 到达后被完整 input 取代。
          const deltaToolCallId = String(event.toolCallId || "").trim();
          if (deltaToolCallId && event.delta) {
            const targetId = currentServerAssistantId.trim();
            if (targetId && frozenAssistantMessageIds.has(targetId)) {
              let pending = pendingToolsBeforeMessage.find(
                (item) => String((item as { id?: string }).id || "").trim() === deltaToolCallId
              ) as { id?: string; inputRaw?: string } | undefined;
              if (!pending) {
                pending = buildToolPart({ toolCallId: deltaToolCallId, toolName: "", status: "running" }) as {
                  id?: string;
                  inputRaw?: string;
                };
                pendingToolsBeforeMessage.push(pending as AgentDetailedPart);
              }
              pending.inputRaw = `${pending.inputRaw || ""}${event.delta}`;
            } else if (targetId) {
              patchAgentLivePartDelta(targetId, deltaToolCallId, "inputRaw", event.delta);
            }
          }
          break;
        }
        case "runtime.retry": {
          const attempt = Number(event.attempt) || 0;
          const maxAttempts = Number(event.maxAttempts) || 10;
          const phase = String(event.phase || "started");
          // 尚无 server messageId（首包即失败）时，用本地 assistant 占位键，流式映射建立后仍可读。
          if (!currentServerAssistantId && currentLocalAssistantId) {
            currentServerAssistantId = `retry-pending:${runId}`;
            localAssistantByMessageId.set(currentServerAssistantId, currentLocalAssistantId);
            commitAgentServerMessageIdByLocalId((prev) => ({
              ...prev,
              [currentLocalAssistantId]: currentServerAssistantId
            }));
          }
          if (currentServerAssistantId) {
            // 固定 id：同一条重试行原地更新，避免每次 attempt 堆一行「重试中」。
            const retryPart: Record<string, unknown> = {
              id: "runtime.retry",
              type: "runtime.retry",
              phase,
              attempt,
              delayMs: event.delayMs ?? null,
              success: event.success ?? null,
              error: event.error || "",
              status: phase === "started" ? "running" : event.success ? "completed" : "error"
            };
            // completed 事件常不带 maxAttempts，缺省不覆盖已写入值。
            if (Number(event.maxAttempts) > 0) {
              retryPart.maxAttempts = Number(event.maxAttempts);
            } else if (phase === "started") {
              retryPart.maxAttempts = maxAttempts;
            }
            // 成功重试对用户已无信息量：直接移除，避免「已重试」永久挂在最新正文下方。
            if (phase === "completed" && event.success) {
              commitAgentLiveParts((prev) => {
                const mid = currentServerAssistantId.trim();
                const current = prev[mid];
                if (!Array.isArray(current) || current.length === 0) return prev;
                const next = current.filter(
                  (part) => String((part as { type?: string }).type || "") !== "runtime.retry"
                );
                if (next.length === current.length) return prev;
                return { ...prev, [mid]: next };
              });
            } else {
              upsertAgentLivePart(currentServerAssistantId, retryPart);
              // 清掉旧版按 attempt/phase 生成的多行 retry:*，只留 runtime.retry 一条。
              commitAgentLiveParts((prev) => {
                const mid = currentServerAssistantId.trim();
                const current = prev[mid];
                if (!Array.isArray(current) || current.length === 0) return prev;
                const next = current.filter((part) => {
                  const type = String((part as { type?: string }).type || "");
                  if (type !== "runtime.retry") return true;
                  return String((part as { id?: string }).id || "").trim() === "runtime.retry";
                });
                if (next.length === current.length) return prev;
                return { ...prev, [mid]: next };
              });
            }
          }
          setMessage(
            phase === "completed"
              ? event.success
                ? "请求重试成功"
                : `请求重试失败${event.error ? `: ${event.error}` : ""}`
              : `请求失败，正在自动重试 (${attempt || "?"}/${maxAttempts})${event.error ? `: ${event.error}` : ""}`
          );
          break;
        }
        case "memory.extraction.started":
        case "memory.extraction.completed":
        case "memory.extraction.failed": {
          const extractionId = String(event.extractionId || "").trim() || "memory";
          // 在飞登记先于挂载判断：即使这条终态事件找不到归属消息（无法上屏），
          // 也必须把它从 pending 中清掉，否则订阅永远等不到收口。
          if (event.type === "memory.extraction.started") {
            pendingMemoryExtractions.add(extractionId);
          } else {
            pendingMemoryExtractions.delete(extractionId);
          }
          if (!currentServerAssistantId && currentLocalAssistantId) {
            currentServerAssistantId = `memory-pending:${runId}`;
            localAssistantByMessageId.set(currentServerAssistantId, currentLocalAssistantId);
            commitAgentServerMessageIdByLocalId((prev) => ({
              ...prev,
              [currentLocalAssistantId]: currentServerAssistantId
            }));
          }
          if (!currentServerAssistantId) {
            closeSubscriptionWhenMemorySettled();
            break;
          }
          const phase =
            event.type === "memory.extraction.started"
              ? "started"
              : event.type === "memory.extraction.failed"
                ? "failed"
                : "completed";
          const entities = Array.isArray(event.entities)
            ? event.entities
              .map((row) => ({
                type: String((row as { type?: string })?.type || "").trim(),
                title: String((row as { title?: string })?.title || "").trim()
              }))
              .filter((row) => row.title)
            : [];
          upsertAgentLivePart(currentServerAssistantId, {
            id: `runtime.memory:${extractionId}`,
            type: "runtime.memory",
            extractionId,
            phase,
            entityCount: Number(event.entityCount) || 0,
            relationCount: Number(event.relationCount) || 0,
            intent: String(event.intent || "").trim(),
            entities,
            quality: String(event.quality || "").trim(),
            priority: String(event.priority || "").trim(),
            error: String(event.error || "").trim(),
            elapsedMs: Number(event.elapsedMs) || 0,
            status: phase === "started" ? "running" : phase === "failed" ? "error" : "completed"
          });
          closeSubscriptionWhenMemorySettled();
          break;
        }
        case "runtime.compaction":
          setMessage(
            event.phase === "started"
              ? "上下文过长，正在自动压缩…"
              : event.error
                ? `上下文压缩失败: ${event.error}`
                : "上下文压缩完成"
          );
          break;
        case "runtime.warning":
          if (typeof event.message === "string" && event.message) {
            appendAgentDebugLog(`runtime.warning ${event.message}`);
          }
          break;
        case "interaction.requested": {
          // PR6：工具执行前/提问发起的裁决请求。auto（自动接受）在后端只发单条
          // resolved(auto) 审计事件、不发 requested，因此这里永远不会收到 auto 的卡片。
          const interaction = event.interaction;
          if (interaction && interaction.sessionId === sessionId) {
            setAgentInteractions((prev) => {
              const next = prev.filter((item) => item.id !== interaction.id);
              return [...next, interaction];
            });
          }
          break;
        }
        case "interaction.resolved": {
          // resolved（用户回复/超时/中止/自动）一律移除卡片。
          const resolvedId = String(event.id || "").trim();
          if (resolvedId) {
            setAgentInteractions((prev) => prev.filter((item) => item.id !== resolvedId));
          }
          break;
        }
        case "tool.started": {
          flushStreamUpdates();
          const toolStartedId = String(event.toolCallId || "").trim();
          if (toolStartedId) {
            updateToolPart(currentServerAssistantId, buildToolPart({
              toolCallId: toolStartedId,
              toolName: event.toolName || "",
              status: "running",
              input: event.input
            }));
          }
          break;
        }
        case "tool.progress": {
          const toolProgressId = String(event.toolCallId || "").trim();
          if (toolProgressId) {
            updateToolPart(currentServerAssistantId, buildToolPart({
              toolCallId: toolProgressId,
              toolName: event.toolName || "",
              status: "running",
              output: event.output
            }));
          }
          break;
        }
        case "tool.completed": {
          const toolCompletedId = String(event.toolCallId || "").trim();
          if (toolCompletedId) {
            const completedPart = buildToolPart({
              toolCallId: toolCompletedId,
              toolName: event.toolName || "",
              status: event.isError ? "error" : "completed",
              output: event.output
            });
            updateToolPart(currentServerAssistantId, completedPart);
            const toolName = String(
              event.toolName
              || (completedPart as { toolName?: string }).toolName
              || ""
            ).trim();
            if (toolName === "task") {
              const details = (completedPart as { details?: unknown }).details;
              const live = agentLivePartsByServerMessageIdRef.current;
              const partIdOf = (item: AgentDetailedPart) =>
                String(
                  (item as { id?: string }).id
                  || (item as { toolCallId?: string }).toolCallId
                  || ""
                ).trim();
              let targetMid = currentServerAssistantId.trim();
              if (!(live[targetMid] || []).some((item) => partIdOf(item) === toolCompletedId)) {
                for (const mid of frozenAssistantMessageIds) {
                  if ((live[mid] || []).some((item) => partIdOf(item) === toolCompletedId)) {
                    targetMid = mid;
                    break;
                  }
                }
              }
              const existing = live[targetMid] || [];
              const children = buildBatchTaskChildPartsFromDetails(
                toolCompletedId,
                details,
                existing
              );
              for (const child of children) {
                updateToolPart(targetMid, child);
              }
            }
          }
          break;
        }
        case "subagent.started": {
          const toolCallId = String(event.parentToolCallId || "").trim();
          if (!toolCallId) break;
          const indexed = parseIndexedParentToolCallId(toolCallId);
          let description = String(event.description || "").trim();
          if (!description && indexed) {
            const siblings =
              agentLivePartsByServerMessageIdRef.current[currentServerAssistantId.trim()] || [];
            const parent = siblings.find((candidate) => {
              const id = String(
                (candidate as { toolCallId?: string }).toolCallId
                  || (candidate as { id?: string }).id
                  || ""
              ).trim();
              return id === indexed.parentId;
            });
            description = extractTaskDescriptionFromParentInput(parent, indexed.index);
          }
          // 不写 timeline: []，避免 started 晚于 childEvent 时清空已投影的工具步骤。
          updateToolPart(currentServerAssistantId, enrichTaskToolPart({
            id: toolCallId,
            type: "toolCall",
            toolCallId,
            toolName: "task",
            status: "running",
            subagentStatus: "running",
            childSessionId: event.childSessionId,
            childRunId: event.childRunId,
            subagentType: event.subagentType,
            startedAtMs: Date.now(),
            ...(description ? { description } : {})
          }));
          break;
        }
        case "subagent.progress": {
          const toolCallId = String(event.parentToolCallId || "").trim();
          if (!toolCallId) break;
          // 只写进度字段；标题等由既有 part / enrich 保留，避免空 description 冲掉。
          updateToolPart(currentServerAssistantId, enrichTaskToolPart({
            id: toolCallId,
            type: "toolCall",
            toolCallId,
            toolName: "task",
            status: "running",
            subagentStatus: "running",
            toolCount: event.toolCount,
            currentToolName: event.currentToolName,
            elapsedMs: event.elapsedMs
          }));
          break;
        }
        case "subagent.childEvent": {
          const toolCallId = String(event.parentToolCallId || "").trim();
          const nested = event.event;
          if (!toolCallId || !nested) break;
          commitAgentLiveParts((prev) => {
            const mid = currentServerAssistantId.trim();
            if (!mid) return prev;
            const list = prev[mid] || [];
            const idx = list.findIndex((p) => String((p as any).id || "") === toolCallId || String((p as any).toolCallId || "") === toolCallId);
            if (idx < 0) {
              const indexed = parseIndexedParentToolCallId(toolCallId);
              let description = "";
              if (indexed) {
                const parent = list.find((candidate) => {
                  const id = String(
                    (candidate as { toolCallId?: string }).toolCallId
                      || (candidate as { id?: string }).id
                      || ""
                  ).trim();
                  return id === indexed.parentId;
                });
                description = extractTaskDescriptionFromParentInput(parent, indexed.index);
              }
              const seeded = enrichTaskToolPart({
                id: toolCallId,
                type: "toolCall",
                toolCallId,
                toolName: "task",
                status: "running",
                subagentStatus: "running",
                childSessionId: event.childSessionId,
                timeline: [],
                ...(description ? { description } : {})
              });
              return {
                ...prev,
                [mid]: [...list, applySubagentChildEventToPart(seeded, nested)]
              };
            }
            const next = list.slice();
            next[idx] = applySubagentChildEventToPart(next[idx], nested);
            return { ...prev, [mid]: next };
          });
          scrollToBottom();
          break;
        }
        case "subagent.completed": {
          const toolCallId = String(event.parentToolCallId || "").trim();
          if (!toolCallId) break;
          updateToolPart(currentServerAssistantId, enrichTaskToolPart({
            id: toolCallId,
            type: "toolCall",
            toolCallId,
            toolName: "task",
            status: "completed",
            subagentStatus: "completed",
            childSessionId: event.childSessionId,
            summary: event.summary,
            output: event.summary,
            toolCount: event.toolCount,
            elapsedMs: event.elapsedMs,
            currentToolName: ""
          }));
          break;
        }
        case "subagent.failed": {
          const toolCallId = String(event.parentToolCallId || "").trim();
          if (!toolCallId) break;
          updateToolPart(currentServerAssistantId, enrichTaskToolPart({
            id: toolCallId,
            type: "toolCall",
            toolCallId,
            toolName: "task",
            status: "error",
            subagentStatus: "failed",
            childSessionId: event.childSessionId,
            isError: true,
            summary: event.error,
            output: event.error
          }));
          break;
        }
        case "subagent.aborted": {
          const toolCallId = String(event.parentToolCallId || "").trim();
          if (!toolCallId) break;
          updateToolPart(currentServerAssistantId, enrichTaskToolPart({
            id: toolCallId,
            type: "toolCall",
            toolCallId,
            toolName: "task",
            status: "error",
            subagentStatus: "aborted",
            childSessionId: event.childSessionId,
            isError: true,
            summary: "子任务已中止",
            output: "子任务已中止"
          }));
          break;
        }
        case "run.failed": {
          cancelStreamBatch();
          const rawError = String(event.error || "").trim();
          const aborted = /abort/i.test(rawError) || /中止|暂停|已停止/.test(rawError);
          const failureText = aborted ? "已暂停" : (rawError || "agent run failed");
          // 先清 busy，再写 error，避免「运行失败」横幅与「运行中 N / 停止键」同框。
          agentRunBusyBySessionRef.current[sessionId] = false;
          setAgentRunBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
          setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: "" }));
          if (!currentServerAssistantId && currentLocalAssistantId) {
            currentServerAssistantId = `retry-pending:${runId}`;
            localAssistantByMessageId.set(currentServerAssistantId, currentLocalAssistantId);
            commitAgentServerMessageIdByLocalId((prev) => ({
              ...prev,
              [currentLocalAssistantId]: currentServerAssistantId
            }));
          }
          if (currentServerAssistantId) {
            upsertAgentLivePart(currentServerAssistantId, {
              id: "runtime.failure",
              type: "runtime.failure",
              error: failureText,
              status: "error"
            });
          }
          // 保留已有正文；暂停不应把 content 清空成空白气泡。
          updateAgentSessionById(sessionId, (session) => ({
            ...session,
            messages: session.messages.map((item) =>
              item.id === currentLocalAssistantId
                ? { ...item, error: failureText }
                : item
            ),
            updatedAt: Date.now()
          }));
          void finalize(failureText);
          break;
        }
        case "session.status":
          if (event.status === "idle" || event.status === "aborted" || event.status === "failed") {
            cancelStreamBatch();
            // abort 已由 run.failed 写入唯一 failure；此处只收口，避免再叠一条「已暂停」。
            if (event.status === "aborted" && finalized) break;
            void finalize(
              event.status === "aborted"
                ? "已暂停"
                : event.error || (event.status === "failed" ? "agent run failed" : undefined)
            );
          }
          break;
        case "run.completed":
          cancelStreamBatch();
          void finalize();
          break;
        default:
          break;
      }
    };

    const finalize = (failure?: string): Promise<void> => {
      if (finalizePromise) return finalizePromise;
      finalized = true;
      cancelStreamBatch();
      finalizePromise = (async () => {
        // 有在飞的记忆抽取时延迟关订阅（终态事件在 run.completed 之后到达）；
        // 兜底计时对齐抽取超时（默认 120s）加余量，防事件丢失导致永不关闭。
        if (pendingMemoryExtractions.size === 0) {
          closeEventSubscription();
        } else if (memoryGraceTimer === null) {
          memoryGraceTimer = window.setTimeout(() => {
            closeEventSubscription();
          }, 150_000);
        }
        if (agentRunIdBySessionRef.current[sessionId] === runId) {
          delete agentRunIdBySessionRef.current[sessionId];
        }
        if (failure) {
          replaceQueuedFollowUps(sessionId, []);
        } else {
          reconcileQueuedFollowUps(sessionId);
        }
        // 结束收口：只把 live 工具标成完成并写入 details，不再整表 reload history / 清空 live。
        // 否则会：本地 assistant id → 服务端 id 换键、live→history 结构切换、列表整段重挂，
        // 表现为「流式刚结束列表快速闪一下」。保持当前 DOM 稳定，下次进会话再冷加载 history。
        const liveMessageIds = new Set<string>();
        for (const serverId of localAssistantByMessageId.keys()) {
          if (serverId.trim()) liveMessageIds.add(serverId.trim());
        }
        if (currentServerAssistantId.trim()) liveMessageIds.add(currentServerAssistantId.trim());
        const settleStatus = failure ? "error" : "completed";
        const settledLiveByServerId: Record<string, AgentDetailedPart[]> = {};
        const liveSnapshot = agentLivePartsByServerMessageIdRef.current;
        // 失败横幅只挂到主消息键，避免多回合 messageId 各插一条 runtime.failure → UI 重复「运行失败」。
        const primaryFailureMid = (() => {
          const preferred = currentServerAssistantId.trim();
          if (preferred && liveMessageIds.has(preferred)) return preferred;
          let bestId = "";
          let bestScore = -1;
          for (const mid of liveMessageIds) {
            const parts = liveSnapshot[mid];
            if (!Array.isArray(parts)) continue;
            const score = parts.length;
            if (score > bestScore) {
              bestScore = score;
              bestId = mid;
            }
          }
          return bestId;
        })();
        for (const mid of liveMessageIds) {
          const parts = liveSnapshot[mid];
          if (!Array.isArray(parts) || parts.length === 0) continue;
          let nextParts = parts.map((part) => {
            const type = String((part as { type?: string }).type || "");
            if (type === "toolCall") {
              const toolName = String((part as { toolName?: string }).toolName || "").trim();
              const st = String((part as { status?: string }).status || "").trim().toLowerCase();
              const sub = String((part as { subagentStatus?: string }).subagentStatus || "").trim().toLowerCase();
              const stillOpen =
                st === "running" || st === "pending" || st === "deciding"
                || (toolName === "task" && (sub === "running" || sub === "pending"));
              if (!stillOpen) return part;
              const next = {
                ...(part as object),
                status: settleStatus,
                isError: Boolean(failure)
              } as AgentDetailedPart;
              if (toolName === "task") {
                (next as { subagentStatus?: string }).subagentStatus = failure ? "failed" : "completed";
              }
              return next;
            }
            // 中止/失败时把仍停在「重试中」的行收成终态，避免暂停后整段消失或一直 pulse。
            if (failure && type === "runtime.retry") {
              const phase = String((part as { phase?: string }).phase || "").trim();
              if (phase === "started" || String((part as { status?: string }).status || "") === "running") {
                return {
                  ...(part as object),
                  phase: "completed",
                  success: false,
                  status: "error",
                  error:
                    String((part as { error?: string }).error || "").trim() ||
                    failure
                } as AgentDetailedPart;
              }
            }
            // 非主消息上的失败行去掉，防止多键各留一条。
            if (failure && type === "runtime.failure" && mid !== primaryFailureMid) {
              return null;
            }
            return part;
          }).filter(Boolean) as AgentDetailedPart[];
          if (
            failure
            && mid === primaryFailureMid
            && !nextParts.some((part) => String((part as { type?: string }).type || "") === "runtime.failure")
          ) {
            const aborted =
              /abort/i.test(failure)
              || /中止|暂停|已停止/.test(failure);
            nextParts = [
              ...nextParts,
              {
                id: "runtime.failure",
                type: "runtime.failure",
                error: aborted ? "已暂停" : failure,
                status: "error"
              } as AgentDetailedPart
            ];
          }
          // 无论工具是否变化，都把含 runtime.retry/failure 的 live 快照写入 details，
          // 否则暂停后仅靠 ephemeral live，一旦键漂移就会整段消失。
          settledLiveByServerId[mid] = nextParts;
        }
        if (Object.keys(settledLiveByServerId).length > 0) {
          commitAgentLiveParts((prev) => {
            const next = { ...prev };
            for (const [mid, parts] of Object.entries(settledLiveByServerId)) {
              next[mid] = parts;
              // 同时挂到 local assistant id，避免暂停后只剩 local 键、server live 查不到而整段空白。
              const localId = localAssistantByMessageId.get(mid);
              if (localId) next[localId] = parts;
            }
            if (currentLocalAssistantId) {
              const preferred =
                settledLiveByServerId[currentServerAssistantId.trim()]
                || Object.values(settledLiveByServerId)[0];
              if (preferred) next[currentLocalAssistantId] = preferred;
            }
            return next;
          });
          setAgentDetailsByMessageId((prev) => {
            const next = { ...prev };
            for (const [serverId, parts] of Object.entries(settledLiveByServerId)) {
              if (parts.length === 0) continue;
              const detail = {
                info: {
                  id: serverId,
                  role: "assistant" as const,
                  time: { created: Date.now() }
                },
                parts
              };
              next[serverId] = detail;
              const localId = localAssistantByMessageId.get(serverId);
              if (localId) next[localId] = detail;
              // retry-pending 键也按当前 local assistant 再挂一份，保证映射丢失时仍可读。
              if (currentLocalAssistantId) next[currentLocalAssistantId] = detail;
            }
            return next;
          });
        }

        // Pi 式兜底：JSONL/history 已有最终总结但 live 漏事件时，只 patch 当前轮 tail，禁止整表 reload。
        if (!failure) {
          try {
            const agentMessages = await agentClient.getMessages(sessionId);
            const toolResults = agentToolResultsByCallId(agentMessages);
            const historyChat = agentMessages
              .map(agentMessageToChatMessage)
              .filter((row): row is AgentChatMessage => Boolean(row));
            let touchedAssistantIds: string[] = [];
            updateAgentSessionById(sessionId, (session) => {
              const result = reconcilePromptTailFromHistory(session.messages, historyChat, {
                pickContent: pickPreferredAgentContent,
                hasLiveParts: (messageId) => {
                  const parts = agentLivePartsByServerMessageIdRef.current[messageId] || [];
                  return parts.some((part) => {
                    const type = String((part as { type?: string }).type || "");
                    return type === "text" && Boolean(String((part as { text?: string }).text || "").trim());
                  });
                }
              });
              touchedAssistantIds = result.touchedAssistantIds;
              if (!result.changed) return session;
              return { ...session, messages: result.messages, updatedAt: Date.now() };
            });
            const touchedIdSet = new Set(touchedAssistantIds);
            const detailsPatch: Record<string, AgentDetailedMessage> = {};
            for (const agentMsg of agentMessages) {
              if (agentMsg.role !== "assistant" || !touchedIdSet.has(agentMsg.id)) continue;
              const textBlocks = agentMsg.parts
                .filter(
                  (part): part is Extract<AgentPart, { type: "text" }> =>
                    part.type === "text" && Boolean(part.text.trim())
                )
                .map((part) => part.text);
              let liveHasText = livePartsHaveTextPart(
                agentLivePartsByServerMessageIdRef.current[agentMsg.id]
              );
              if (textBlocks.length > 0) {
                commitAgentLiveParts((prev) => {
                  const current = prev[agentMsg.id] || [];
                  const { parts, changed } = appendMissingTextPartsToLive(current, textBlocks);
                  if (!changed) return prev;
                  liveHasText = true;
                  return { ...prev, [agentMsg.id]: parts };
                });
              }
              // live 已有 text part 时不再写 details：避免 fetched text:0 与 live text:soft 双轨。
              if (liveHasText) continue;
              const incoming = agentMessageToDetailedMessage(agentMsg, toolResults);
              const liveParts = agentLivePartsByServerMessageIdRef.current[agentMsg.id] || [];
              if (liveParts.length === 0) {
                detailsPatch[agentMsg.id] = incoming;
              }
            }
            if (Object.keys(detailsPatch).length > 0) {
              setAgentDetailsByMessageId((prev) => {
                const next = { ...prev };
                for (const [messageId, incoming] of Object.entries(detailsPatch)) {
                  const existing = prev[messageId];
                  const existingParts = Array.isArray(existing?.parts) ? existing.parts : [];
                  const incomingParts = Array.isArray(incoming.parts) ? incoming.parts : [];
                  if (existingParts.length > incomingParts.length) continue;
                  next[messageId] = incoming;
                }
                return next;
              });
            }
            appendAgentDebugLog(
              `agent.prompt.tailReconcile session=${sessionId} touched=${touchedAssistantIds.length}`
            );
          } catch (error) {
            appendAgentDebugLog(`agent.prompt.tailReconcile.error session=${sessionId} ${String(error)}`);
          }
        }

        // 工具收口后再清 busy/streaming，避免「运行中→已运行」与 parts 切换分两帧闪。
        agentRunBusyBySessionRef.current[sessionId] = false;
        setAgentRunBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
        setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sessionId]: "" }));

        // 仅就地修补必要字段，不替换整份 messages（保留本地 id / 合并行 stableKey）。
        updateAgentSessionById(sessionId, (session) => {
          const messages = [...session.messages];
          let changed = false;
          for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index]?.role !== "user") continue;
            const existingAttachments = messages[index].attachments || [];
            const nextAttachments = displayAttachments.length > 0 ? displayAttachments : existingAttachments;
            const sameAttachments =
              (messages[index].attachments || []).length === nextAttachments.length &&
              (messages[index].attachments || []).every((item, attachmentIndex) => {
                const other = nextAttachments[attachmentIndex];
                return Boolean(other) && item.uri === other.uri && item.mime === other.mime;
              });
            if (messages[index].content !== prompt || !sameAttachments) {
              messages[index] = {
                ...messages[index],
                content: prompt,
                attachments: nextAttachments
              };
              changed = true;
            }
            break;
          }
          if (failure) {
            // 只在已有 assistant 上落一次 error；禁止再 push 新气泡（否则会叠多条「运行失败 已暂停」）。
            const targetIndex = (() => {
              const byCurrent = messages.findIndex((item) => item.id === currentLocalAssistantId);
              if (byCurrent >= 0) return byCurrent;
              return [...messages]
                .map((item, index) => ({ item, index }))
                .reverse()
                .find(({ item }) => item.role === "assistant")
                ?.index;
            })();
            if (targetIndex != null && targetIndex >= 0) {
              if (messages[targetIndex].error !== failure) {
                messages[targetIndex] = {
                  ...messages[targetIndex],
                  error: failure
                };
                changed = true;
              }
              // 同轮其它空 assistant 上的重复 error 清掉，避免多行横幅。
              for (let index = 0; index < messages.length; index += 1) {
                if (index === targetIndex) continue;
                const item = messages[index];
                if (item?.role !== "assistant") continue;
                if (!item.error?.trim()) continue;
                if (!(item.content || "").trim() && localAssistantIds.includes(item.id)) {
                  messages[index] = { ...item, error: undefined };
                  changed = true;
                }
              }
            }
          } else {
            for (const localId of localAssistantIds) {
              const idx = messages.findIndex((item) => item.id === localId);
              if (idx >= 0 && !(messages[idx].content || "").trim() && !messages[idx].error) {
                // 不写 "(empty response)" 占位：避免结束瞬间突然冒出一行文案造成闪动。
                // 时间线/空气泡保持原样即可。
              }
            }
          }
          if (!changed) return session;
          return { ...session, messages, updatedAt: Date.now() };
        });
        if (failure) {
          setError(failure);
          setMessage("Agent run failed");
        } else {
          scheduleNextQueuedFollowUp(sessionId);
        }
        appendAgentDebugLog("agent.prompt.finalize session=" + sessionId + " run=" + runId);
      })();
      return finalizePromise;
    };

    try {
      appendAgentDebugLog("agent.prompt.subscribe session=" + sessionId + " run=" + runId);
      eventSubscription = await agentClient.subscribeEvents(sessionId, runId, onAgentEvent);
      appendAgentDebugLog("agent.prompt.send session=" + sessionId + " run=" + runId);
      const result = await agentClient.prompt({
        sessionId,
        runId,
        prompt: sessionPrompt || (multimodalImages.length > 0 ? IMAGE_ONLY_USER_PROMPT : ""),
        images: multimodalImages.map((image) => ({
          mimeType: image.mimeType,
          path: image.path
        }))
      });
      // 订阅已覆盖全程时禁止再回放 result.events：二次 message.started/completed
      // 会让 ensureLocalAssistant 再 push 一条同文影子气泡。
      if (liveEventCount === 0) {
        for (const event of result.events || []) onAgentEvent(event);
        // 无 live 订阅时才用最终 message 补洞；已有流式事件时再 replace 容易多出一条同文助手。
        replaceAssistantMessage(result.message, { rebuildLive: false });
      }
      await finalize();
    } catch (error) {
      const messageText = String(error);
      appendAgentDebugLog("agent.prompt.error " + messageText);
      await finalize(messageText);
    } finally {
      if (!finalized) await finalize();
    }
  }

  async function stopAgentPrompt(sessionIdInput?: string) {
    const sid = (sessionIdInput || activeAgentSessionId || "").trim();
    if (!sid) return;

    // 乐观停止：立刻清 busy / 流式态，按钮可再发；runId 留给后台 finalize 收口。
    agentRunBusyBySessionRef.current[sid] = false;
    setAgentRunBusyBySession((prev) => ({ ...prev, [sid]: false }));
    const streamingId = String(agentStreamingAssistantIdBySession[sid] || "").trim();
    setAgentStreamingAssistantIdBySession((prev) => ({ ...prev, [sid]: "" }));
    updateAgentSessionById(sid, (session) => {
      const targetId =
        streamingId
        || [...session.messages].reverse().find((item) => item.role === "assistant")?.id
        || "";
      if (!targetId) return session;
      return {
        ...session,
        messages: session.messages.map((item) =>
          item.id === targetId
            ? { ...item, error: item.error || "已暂停" }
            : item
        ),
        updatedAt: Date.now(),
      };
    });

    const runId = String(agentRunIdBySessionRef.current[sid] || "").trim();
    try {
      if (runId) {
        const aborted = await agentClient.abort(runId);
        appendAgentDebugLog("agent.prompt.abort session=" + sid + " run=" + runId + " ok=" + (aborted ? 1 : 0));
      } else {
        const aborted = await agentClient.abortSession(sid);
        appendAgentDebugLog("agent.prompt.abort.session session=" + sid + " ok=" + (aborted ? 1 : 0));
      }
    } catch (e) {
      appendAgentDebugLog("agent.prompt.abort.error session=" + sid + " " + String(e));
    }
  }

  function resizeAgentInput() {
    const el = agentInputRef.current;
    if (!el) return;
    const minHeight = agentShowEmptyState ? 24 : 28;
    // 与 ComposerEditor 的 max-h-40(160px) 对齐；空状态原先 64px 大约只能再长两行。
    const maxHeight = 160;
    const prev = el.offsetHeight || minHeight;
    const reduceMotion = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 先关掉过渡再测真实 scrollHeight，再从 prev 动画到 next，避免 height:auto 打断过渡。
    el.style.transition = "none";
    el.style.height = "auto";
    const next = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight));
    el.style.height = `${prev}px`;
    void el.offsetHeight;
    if (!reduceMotion && prev !== next) {
      el.style.transition = "height 180ms cubic-bezier(0.22, 1, 0.36, 1)";
    } else {
      el.style.transition = "";
    }
    el.style.height = `${next}px`;
    el.scrollTop = 0;
  }

  function setAgentPromptInputFromHistory(value: string) {
    setAgentPromptInput(value);
    setAgentSlashOpen(false);
    requestAnimationFrame(() => {
      resizeAgentInput();
      const el = agentInputRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  const {
    recordHistoryEntry: recordAgentPromptHistoryEntry,
    captureDraft: captureAgentPromptHistoryDraft,
    browseHistory: browseAgentPromptHistory
  } = useAgentPromptHistory({
    activeSessionId: activeAgentSessionId,
    currentInput: agentPromptInput,
    onApplyHistory: setAgentPromptInputFromHistory
  });

  function activateAgentSlashCommand(cmd: AgentSlashCommand) {
    const trigger = cmd.trigger.trim().toLowerCase();
    setAgentSlashOpen(false);
    if (cmd.source === "builtin") {
      if (trigger === "new") {
        void createAndSwitchAgentSession();
        return;
      }
      if (trigger === "model") {
        setShowAgentModelPicker(true);
        return;
      }
      if (trigger === "agent") {
        setMessage("规划请让助手使用 task(plan)");
        return;
      }
      if (trigger === "workspace") {
        setLeftDrawerOpen(true);
        return;
      }
      if (trigger === "terminal") {
        openRightPane("terminal");
        return;
      }
    }
    setAgentPromptInput(`/${cmd.trigger} `);
    requestAnimationFrame(() => agentInputRef.current?.focus());
  }

  function referenceAgentSkill(skill: AgentSkillInfo) {
    const fallback = skill.name.replace(/[^a-zA-Z0-9_-]/g, "").replace(/-/g, "");
    const matched = agentSlashCommands.find((cmd) => {
      const trigger = cmd.trigger.toLowerCase();
      const name = skill.name.toLowerCase();
      return cmd.source === "skill" && (trigger === name || trigger.replace(/-/g, "") === name.replace(/-/g, ""));
    });
    const trigger = (matched?.trigger || fallback || skill.name).replace(/^\//, "");
    setAgentPromptInput(`/${trigger} `);
    setAgentSlashOpen(false);
    requestAnimationFrame(() => {
      resizeAgentInput();
      const el = agentInputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  function insertAgentPromptTextAtSelection(text: string) {
    if (!text) return;
    const el = agentInputRef.current;
    const base = el?.value ?? agentPromptInput;
    const start = el?.selectionStart ?? base.length;
    const end = el?.selectionEnd ?? start;
    const next = `${base.slice(0, start)}${text}${base.slice(end)}`;
    const cursor = start + text.length;
    captureAgentPromptHistoryDraft(next);
    setAgentPromptInput(next);
    const isSlash = /^\//.test(next) && !next.includes(" ");
    setAgentSlashOpen(isSlash);
    setAgentSlashActiveIndex(0);
    requestAnimationFrame(() => {
      resizeAgentInput();
      const current = agentInputRef.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(cursor, cursor);
    });
  }

  async function pasteIntoAgentPromptFromContextMenu() {
    setComposerContextMenu(null);
    const el = agentInputRef.current;
    el?.focus();
    const attachments = await readAgentClipboardAttachments();
    if (attachments.length > 0) {
      appendAgentAttachments(attachments);
      return;
    }
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text) {
        insertAgentPromptTextAtSelection(text);
        return;
      }
    } catch {
      // Some desktop shells deny Clipboard API reads; let the native paste event try next.
    }
    document.execCommand?.("paste");
  }

  async function sendQuestionReply(requestId: string, answers: QuestionAnswer[]) {
    try {
      await agentClient.replyInteraction(requestId, { decision: "answers", answers });
      setAgentInteractions((prev) => prev.filter((item) => item.id !== requestId));
      appendAgentDebugLog(`question.reply ${requestId}`);
      return true;
    } catch (e) {
      appendAgentDebugLog(`question.reply.error ${requestId} ${String(e)}`);
      return false;
    }
  }

  async function refreshPendingQuestions(sessionIdArg = activeAgentSessionId) {
    await syncAgentInteractions(sessionIdArg);
  }

  async function sendQuestionReject(requestId: string) {
    try {
      await agentClient.replyInteraction(requestId, { decision: "cancel" });
      setAgentInteractions((prev) => prev.filter((item) => item.id !== requestId));
      appendAgentDebugLog(`question.reject ${requestId}`);
      return true;
    } catch (e) {
      appendAgentDebugLog(`question.reject.error ${requestId} ${String(e)}`);
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

  async function sendTerminalData(tabId: string, data: string) {
    if (!ensureRepoSelected()) return;
    if (!data) return;
    try {
      await sendRepoTerminalInput(repoPath, data, tabId);
      updateTerminalTabById(tabId, { input: "" });
    } catch (e) {
      const msg = String(e);
      updateTerminalTabById(tabId, (prev) => appendTerminalError(prev, msg));
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
    openRightPane("terminal");
    setActiveTerminalTabId(tab.id);
    try {
      // 等面板露出并完成 fit，再同步 PTY 尺寸，避免安装 CLI 在 0 列宽度下逐字换行。
      await waitForPaint();
      await resizeRepoTerminalSession(repoPath, 120, 40, tab.id).catch(() => undefined);
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

  function normalizeFsPath(input: string): string {
    return input.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function normalizeRelativeFsPath(input: string): string {
    return normalizeFsPath(input.trim()).replace(/^\.\/+/, "").replace(/^\/+/, "");
  }

  function resolveWorkspaceCandidatePath(input: string, candidates: string[]): string | null {
    const normalized = normalizeRelativeFsPath(input);
    if (!normalized) return null;
    const normalizedCandidates = candidates
      .map((candidate) => normalizeRelativeFsPath(candidate))
      .filter(Boolean);
    const exact = normalizedCandidates.find((candidate) => candidate === normalized);
    if (exact) return exact;
    if (!normalized.includes("/")) return null;
    const matches = normalizedCandidates.filter((candidate) => candidate.endsWith(`/${normalized}`));
    return matches.length === 1 ? matches[0] : null;
  }

  function uniqueNormalizedFsPaths(paths: string[]): string[] {
    const seen = new Set<string>();
    return paths
      .map((path) => normalizeFsPath(path.trim()))
      .filter((path) => {
        if (!path || seen.has(path)) return false;
        seen.add(path);
        return true;
      });
  }

  function resolveWorkspacePathTarget(absolutePath: string, preferredRepoRoot?: string): { repoRoot: string; relativePath: string } | null {
    const normalizedAbs = normalizeFsPath(absolutePath.trim());
    const repoCandidates = uniqueNormalizedFsPaths([preferredRepoRoot || "", repoPath, gitPanePath, ...repos.map((repo) => repo.path)])
      .sort((a, b) => b.length - a.length);
    for (const root of repoCandidates) {
      if (normalizedAbs === root) return null;
      if (normalizedAbs.startsWith(`${root}/`)) {
        return {
          repoRoot: root,
          relativePath: normalizedAbs.slice(root.length + 1)
        };
      }
    }
    return null;
  }

  function resolveToolFileTarget(
    filePath: string,
    options: { preferredRepoRoot?: string; workspaceFileCandidates?: string[] } = {}
  ): { repoRoot: string; relativePath: string } | null {
    const normalized = normalizeFsPath(filePath.trim());
    if (!normalized) return null;
    const repoRoot = normalizeFsPath((options.preferredRepoRoot || repoPath || gitPanePath || "").trim());
    if (!repoRoot) return null;
    const candidates = options.workspaceFileCandidates ?? (
      normalizeWorkspacePath(repoRoot) === normalizeWorkspacePath(gitPanePath) ? workspaceFileCandidates : []
    );
    const workspaceRelative = resolveWorkspaceCandidatePath(normalized, candidates);
    if (workspaceRelative) {
      return {
        repoRoot,
        relativePath: workspaceRelative
      };
    }
    if (normalized.startsWith("/")) {
      return resolveWorkspacePathTarget(normalized, repoRoot);
    }
    return {
      repoRoot,
      relativePath: normalizeRelativeFsPath(normalized)
    };
  }

  function isEmptyPreviewContent(content: GitWorktreeFileContent): boolean {
    return content.previewSupported !== false && !content.original && !content.modified && !content.dataBase64;
  }

  function attachmentPreviewToWorktreeContent(preview: GitWorktreeFileContent): GitWorktreeFileContent {
    return {
      original: preview.original || "",
      modified: preview.modified || preview.original || "",
      previewSupported: preview.previewSupported !== false,
      previewReason: preview.previewReason,
      previewKind: preview.previewKind,
      mime: preview.mime,
      dataBase64: preview.dataBase64
    };
  }

  async function readWorkspaceRelativeLocalPreview(
    relativePath: string,
    preferredRepoRoot?: string
  ): Promise<{ repoRoot: string; absolutePath: string; content: GitWorktreeFileContent } | null> {
    const normalizedRelativePath = normalizeRelativeFsPath(relativePath);
    if (!normalizedRelativePath) return null;
    const repoCandidates = uniqueNormalizedFsPaths([preferredRepoRoot || "", repoPath, gitPanePath, ...repos.map((repo) => repo.path)]);
    for (const root of repoCandidates) {
      const absolutePath = `${root}/${normalizedRelativePath}`;
      const preview = await readLocalAttachmentPreview(absolutePath).catch(() => null);
      if (!preview || isEmptyPreviewContent(preview)) continue;
      return {
        repoRoot: root,
        absolutePath,
        content: attachmentPreviewToWorktreeContent(preview)
      };
    }
    return null;
  }

  async function getWorkspaceFileContentWithFallback(repoRoot: string, relativePath: string): Promise<GitWorktreeFileContent> {
    const content = await getGitWorktreeFileContent(repoRoot, relativePath);
    if (!isEmptyPreviewContent(content)) return content;
    const localPreview = await readWorkspaceRelativeLocalPreview(relativePath, repoRoot);
    return localPreview?.content || content;
  }

  function isWorktreeDiffFile(relativePath: string): boolean {
    const normalized = normalizeRelativeFsPath(relativePath);
    return Boolean(normalized && worktreeOverview.entries.some((entry) => entry.path === normalized));
  }

  function resolveFocusedWorktreeLine(source: string, focusText?: string, fallbackLine?: number): number | undefined {
    const fallback = Number.isFinite(Number(fallbackLine)) && Number(fallbackLine) > 0
      ? Math.floor(Number(fallbackLine))
      : undefined;
    const needle = String(focusText || "").trim();
    if (!source || !needle) return fallback;
    const indexToLine = (index: number) => source.slice(0, index).split(/\r?\n/).length;
    const collectLineMatches = (value: string): number[] => {
      const lines: number[] = [];
      if (!value) return lines;
      let index = source.indexOf(value);
      while (index >= 0) {
        lines.push(indexToLine(index));
        index = source.indexOf(value, index + Math.max(1, value.length));
      }
      return lines;
    };
    const firstNeedleLine = needle.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() || "";
    const candidates = [
      ...collectLineMatches(needle),
      ...collectLineMatches(firstNeedleLine)
    ].filter((line, index, rows) => line > 0 && rows.indexOf(line) === index);
    if (candidates.length === 0) return fallback;
    const needleLineCount = needle.split(/\r?\n/).length;
    const looksLikeWholeFileMatch =
      fallback &&
      fallback > 1 &&
      candidates.every((line) => line === 1) &&
      (needleLineCount > 12 || needle.length > source.length * 0.45);
    if (looksLikeWholeFileMatch) return fallback;
    if (!fallback) return candidates[0];
    return candidates.reduce((best, line) => (
      Math.abs(line - fallback) < Math.abs(best - fallback) ? line : best
    ), candidates[0]);
  }

  async function openWorkspacePathInRightPane(path: string, line?: number) {
    const target = resolveToolFileTarget(path, {
      preferredRepoRoot: agentWorkspaceRoot,
      workspaceFileCandidates: agentWorkspaceFileCandidates
    });
    if (!target) {
      setMessage("该路径不在当前仓库中，暂时无法在右侧打开。");
      return;
    }
    try {
      const localPreview = isWorktreeDiffFile(target.relativePath)
        ? null
        : await readWorkspaceRelativeLocalPreview(target.relativePath, target.repoRoot);
      setSelectedAttachmentPreviewPath(localPreview?.absolutePath || "");
      openRightPane("changes");
      setSelectedWorktreeFile(target.relativePath);
      setSelectedWorktreeLine(line);
      setSelectedWorktreeViewMode("editor");
      const [content, patch] = await Promise.all([
        localPreview
          ? Promise.resolve(localPreview.content)
          : getWorkspaceFileContentWithFallback(target.repoRoot, target.relativePath),
        localPreview
          ? Promise.resolve("")
          : getGitWorktreeFilePatch(target.repoRoot, target.relativePath).catch(() => "")
      ]);
      setSelectedWorktreeContent(content);
      setSelectedWorktreePatch(patch || "No staged or unstaged patch available for this file.");
      setMessage(line ? `已打开 ${target.relativePath} 第 ${line} 行` : `已打开 ${target.relativePath}`);
    } catch (error) {
      setError(String(error));
      setMessage("打开文件失败");
    }
  }

  async function openWorkspaceDirectory(path: string) {
    const repoRoot = normalizeFsPath((agentWorkspaceRoot || "").trim());
    const relativePath = resolveWorkspaceCandidatePath(path, agentWorkspaceDirectoryCandidates) || normalizeRelativeFsPath(path);
    if (!repoRoot || !relativePath) return;
    try {
      await invoke("open_local_path", { path: `${repoRoot}/${relativePath}` });
    } catch (error) {
      setError(String(error));
      setMessage("打开文件夹失败");
    }
  }

  async function openLocalDirectory(path: string) {
    const absolutePath = normalizeFsPath(path);
    if (!absolutePath) return;
    try {
      await invoke("open_local_path", { path: absolutePath });
    } catch (error) {
      setError(String(error));
      setMessage("打开文件夹失败");
    }
  }

  async function openAttachmentInRightPane(uri: string, filename?: string, _mime?: string) {
    const absolutePath = fileUrlToPath(uri);
    if (!absolutePath) {
      if (!uri) return;
      window.open(uri, "_blank", "noopener,noreferrer");
      return;
    }
    flushSync(() => {
      setSelectedAttachmentPreviewPath(absolutePath);
      openRightPane("changes");
      setSelectedWorktreeFile(filename || absolutePath.split("/").filter(Boolean).pop() || absolutePath);
      setSelectedWorktreeLine(undefined);
      setSelectedWorktreeViewMode("editor");
      setSelectedWorktreePatch("");
      setSelectedWorktreeContent(EMPTY_WORKTREE_FILE_CONTENT);
    });
    try {
      const preview = await readLocalAttachmentPreview(absolutePath);
      setSelectedWorktreeContent({
        original: preview.original || "",
        modified: preview.modified || "",
        previewSupported: preview.previewSupported !== false,
        previewReason: preview.previewReason,
        previewKind: preview.previewKind,
        mime: preview.mime,
        dataBase64: preview.dataBase64
      });
      setSelectedWorktreePatch("");
      setMessage(`已预览 ${filename || absolutePath}`);
    } catch (error) {
      setError(String(error));
      setMessage("打开附件预览失败");
    }
  }

  function closeRightFileView() {
    setSelectedAttachmentPreviewPath("");
    setSelectedWorktreeFile("");
    setSelectedWorktreeViewMode("auto");
    setSelectedWorktreeLine(undefined);
    setSelectedWorktreePatch("");
    setSelectedWorktreeContent(EMPTY_WORKTREE_FILE_CONTENT);
  }

  function toggleRightDrawer() {
    setRightDrawerOpen((wasOpen) => {
      if (!wasOpen) {
        setRightPaneTab((tab) => tab || PINNED_RIGHT_PANE_TAB);
      }
      return !wasOpen;
    });
  }

  function selectRightPaneTab(tab: RightPaneTab) {
    if (tab !== PINNED_RIGHT_PANE_TAB && !rightOptionalTabs.includes(tab)) return;
    setRightPaneTab(tab);
  }

  function closeRightPaneTab(tab: RightPaneTab) {
    if (tab === PINNED_RIGHT_PANE_TAB) return;
    setRightOptionalTabs((tabs) => tabs.filter((item) => item !== tab));
    setRightPaneTab((current) => (current === tab ? PINNED_RIGHT_PANE_TAB : current));
  }

  function openRightPane(tab: RightPaneTab) {
    if (tab !== PINNED_RIGHT_PANE_TAB) {
      setRightOptionalTabs((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]));
    }
    setRightPaneTab(tab);
    setRightDrawerOpen(true);
    if (tab === "skills") void warmSkillsMarketplace();
  }

  // 分支选择浮层打开时的轻量刷新：只拉分支列表，不触碰提交图与状态栏消息。
  async function refreshBranchListForPicker() {
    if (!selectedRepo) return;
    try {
      const branchList = await getLocalBranches(repoPath);
      setBranches(branchList);
    } catch {
      // 浮层用的是已有分支快照，刷新失败静默忽略
    }
  }

  async function openToolFileInRightPane(input: {
    filePath: string;
    line?: number;
    focusText?: string;
    original?: string;
    modified?: string;
    patch?: string;
    preferDiff?: boolean;
  }) {
    const target = resolveToolFileTarget(input.filePath, {
      preferredRepoRoot: agentWorkspaceRoot,
      workspaceFileCandidates: agentWorkspaceFileCandidates
    });
    if (!target) {
      setMessage("该文件暂时无法在右侧打开。");
      return;
    }
    try {
      const canUseLocalPreview = input.original === undefined && input.modified === undefined && !input.preferDiff && !isWorktreeDiffFile(target.relativePath);
      const localPreview = canUseLocalPreview
        ? await readWorkspaceRelativeLocalPreview(target.relativePath, target.repoRoot)
        : null;
      setSelectedAttachmentPreviewPath(localPreview?.absolutePath || "");
      openRightPane("changes");
      setSelectedWorktreeFile(target.relativePath);
      setSelectedWorktreeViewMode(input.preferDiff ? "diff" : "editor");
      const contentPromise = input.original !== undefined || input.modified !== undefined
        ? Promise.resolve<GitWorktreeFileContent>({
          original: input.original ?? "",
          modified: input.modified ?? input.original ?? "",
          previewSupported: true,
          previewReason: undefined,
          previewKind: "text",
          mime: "text/plain",
          dataBase64: undefined
        })
        : localPreview
          ? Promise.resolve(localPreview.content)
          : getWorkspaceFileContentWithFallback(target.repoRoot, target.relativePath);
      const patchPromise = input.patch !== undefined
        ? Promise.resolve(input.patch)
        : input.original !== undefined || input.modified !== undefined
          ? Promise.resolve("")
          : localPreview
            ? Promise.resolve("")
          : getGitWorktreeFilePatch(target.repoRoot, target.relativePath).catch(() => "");
      const [content, patch] = await Promise.all([contentPromise, patchPromise]);
      setSelectedWorktreeContent(content);
      setSelectedWorktreePatch(patch || "No staged or unstaged patch available for this file.");
      const focusLine = input.line || resolveFocusedWorktreeLine(content.modified || content.original, input.focusText, input.line);
      setSelectedWorktreeLine(focusLine);
      setMessage(`已打开 ${target.relativePath}`);
    } catch (error) {
      setError(String(error));
      setMessage("打开文件失败");
    }
  }

  function openUrlInBrowserPane(url: string) {
    const trimmed = (url || "").trim();
    if (!trimmed) return;
    setBrowserPaneUrl(trimmed);
    openRightPane("browser");
    // 内嵌浏览器由 BrowserPanel 挂载后自行 open/navigate；web 端 BrowserPanel 降级提示。
  }

  // agent 调 browser_use 导航但右侧浏览器面板尚无 tab：Rust controller 发此事件，
  // 这里复用 openUrlInBrowserPane 自动展开面板并新建 tab 导航，避免 agent fallback 系统浏览器。
  // openUrlInBrowserPane 内部仅调用稳定的 setState，闭包 stale 无副作用。
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void listen<{ url: string }>("giteam://browser-agent-open", (event) => {
      if (!alive) return;
      const u = event.payload?.url;
      if (u) openUrlInBrowserPane(u);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          void refreshRuntimeRequirements().then((final) => {
            const coreInstalled = final.git.installed && final.entire.installed;
            if (job.status === "succeeded" || coreInstalled) {
              setRuntimeJob(null);
              setError("");
              setMessage("运行环境已准备完成");
              if (coreInstalled) setShowEnvSetup(false);
            } else {
              setRuntimeJob(null);
              setRuntimeInstallLog(job.log || "");
              setMessage(describeRuntimeJobResult(job));
              if (job.status === "failed") {
                setError(runtimeJobFailureMessage(job));
              }
            }
          });
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
    setSidebarWidth((width) => clamp(width, 292, 340));
  }, []);

  useEffect(() => {
    saveCachedWidth(SIDEBAR_WIDTH_CACHE_KEY, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    saveCachedWidth(RIGHT_PANE_WIDTH_CACHE_KEY, rightPaneWidth);
  }, [rightPaneWidth]);

  useEffect(() => {
    saveCachedWidth(GITTREE_SIDEBAR_WIDTH_CACHE_KEY, gitTreeSidebarSize);
  }, [gitTreeSidebarSize]);

  useEffect(() => {
    const collapseIfNarrow = () => {
      const paneWidth = agentRightPaneRef.current?.clientWidth || 0;
      if (window.innerWidth <= 900 || paneWidth <= 620) setShowAgentSessionRail(false);
    };
    const observer = new ResizeObserver(() => collapseIfNarrow());
    if (agentRightPaneRef.current) observer.observe(agentRightPaneRef.current);
    window.addEventListener("resize", collapseIfNarrow);
    collapseIfNarrow();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", collapseIfNarrow);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAppVersion()
      .then((version) => {
        if (cancelled) return;
        setAppVersion(version);
        const celebration = resolveStartupUpdateCelebration(version);
        if (celebration) setUpdateCelebration(celebration);
      })
      .catch(() => {
        if (!cancelled) setAppVersion("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!generalSettings.updatesStartup) return;
    // 刚更新完先展示 What's New，避免叠两个弹窗
    if (updateCelebration) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setAppUpdateState({ status: "checking" });
        const next = await checkAppUpdate();
        if (cancelled) return;
        setAppUpdateState(next);
        if (next.status !== "available") return;
        if (generalSettings.updatesAutoInstall) {
          if (generalSettings.notificationsAgent) {
            void showSettingsNotification(
              "Updating Giteam",
              `Downloading ${next.version}…`
            );
          }
          await installAppUpdateNow({
            currentVersion: next.currentVersion,
            version: next.version,
            notes: next.notes
          });
          return;
        }
        setUpdateAvailablePrompt({
          currentVersion: next.currentVersion,
          version: next.version,
          notes: next.notes
        });
        if (generalSettings.notificationsAgent) {
          void showSettingsNotification(
            "Update available",
            `Giteam ${next.version} is ready to install`
          );
        }
      })();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    generalSettings.updatesStartup,
    generalSettings.updatesAutoInstall,
    generalSettings.notificationsAgent,
    updateCelebration,
    installAppUpdateNow
  ]);

  useEffect(() => {
    let cancelled = false;
    setRuntimeJob(null);
    setRuntimeInstallLog("");
    setError("");
    setRuntimeStartupChecking(true);
    // Pi 运行时已内置，不再强制首启安装 git/entire/opencode；仅后台刷新依赖状态，
    // 缺依赖可在「设置 → 插件」里按需安装，不挡进主界面。
    void refreshRuntimeRequirements()
      .then((res) => {
        if (cancelled) return;
        markRuntimeFirstCheckCompleted(RUNTIME_FIRST_CHECK_KEY);
        if (getMissingRuntimeDeps(res).length === 0) {
          setRuntimeSetupDismissed(false);
        }
        setShowEnvSetup(false);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setRuntimeStartupChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    setAgentSessionFetchLimit(getRepoSessionFetchLimit(selectedRepo.id));
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!gitPanePath) {
      void stopGitWorktreeWatcher().catch(() => { });
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
        const activePreviewPath = selectedAttachmentPreviewPathRef.current ? "" : selectedWorktreeFileRef.current;
        const tasks = [refreshWorktreeData(activePreviewPath)];
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
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => { });
      void stopGitWorktreeWatcher().catch(() => { });
    };
  }, []);

  useEffect(() => {
    if (!selectedRepo?.id) return;
    const repoId = selectedRepo.id.trim();
    if (!repoId) return;
    if (!hasLoadedSidebarRepoSessions(repoId)) return;
    expandProjectSessions(repoId);
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (repos.length === 0) return;
    let cancelled = false;
    let timer: number | null = null;

    const schedule = (delay = AGENT_SIDEBAR_SESSION_POLL_MS) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void pollSidebarSessions();
      }, delay);
    };

    const pollSidebarSessions = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      const expandedRepoIds = new Set(expandedProjectIds);
      const reposToRefresh = repos.filter((repo) => {
        const repoId = repo.id.trim();
        if (!repoId) return false;
        const loaded = hasLoadedSidebarRepoSessions(repoId);
        if (!loaded) return false;
        return expandedRepoIds.has(repoId) || selectedRepo?.id === repoId;
      });
      if (reposToRefresh.length === 0) {
        schedule();
        return;
      }
      const results = await Promise.allSettled(
        reposToRefresh.map((repo) => refreshSidebarRepoSessions(repo, { silent: true }))
      );
      if (cancelled) return;
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") {
        setError(String(rejected.reason));
      }
      schedule();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule(0);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
  }, [
    repos,
    expandedProjectIds,
    selectedRepo?.id
  ]);

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

  // agentSessions 镜像同步：供 refresh 锚定排序（Step B）与 bootstrap 首选读取，避免闭包读到旧列表。
  useEffect(() => {
    agentSessionsRef.current = agentSessions;
  }, [agentSessions]);

  useEffect(() => {
    activeAgentSessionIdRef.current = activeAgentSessionId;
  }, [activeAgentSessionId]);

  useEffect(() => {
    draftAgentSessionRef.current = draftAgentSession;
  }, [draftAgentSession]);

  // 对齐 effect：后台数据通道。只派生 stale 提示信号，绝不替用户改写 active。
  // 首次选中交由 bootstrap 显式 selectAgentSession；列表瞬空时保留 active 不抖；
  // active 真失效（既不在列表也不在任何 sidebar）时置 stale 提示用户手动切换。
  useEffect(() => {
    if (draftAgentSession) { setAgentActiveSessionStale(false); return; }
    const active = activeAgentSessionId;
    if (!active) return;                                  // 首次选中已交 bootstrap 显式负责
    if (agentSessions.length === 0) { setAgentActiveSessionStale(false); return; } // 列表瞬空，保留 active
    const stillKnown = agentSessions.some((s) => s.id === active)
      || Object.values(sidebarAgentSessionsByRepo).some((repoSessions) => repoSessions.some((s) => s.id === active));
    setAgentActiveSessionStale(!stillKnown);
  }, [agentSessions, activeAgentSessionId, draftAgentSession, sidebarAgentSessionsByRepo]);

  useEffect(() => {
    const repoId = selectedRepo?.id?.trim();
    if (!repoId) return;

    if (agentBootstrapDoneForRepoRef.current && agentBootstrapDoneForRepoRef.current !== repoId) {
      resetAgentWorkspaceBootstrapState(repoId);
    }

    let cancelled = false;
    const timer = scheduleAfterInteraction(() => {
      if (cancelled) return;
      void bootstrapAgentWorkspace(repoId);
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      agentBootstrapTokenRef.current += 1;
    };
  }, [selectedRepo?.id, repos.length]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const repoId = selectedRepo?.id?.trim();
      if (!repoId) return;
      if (agentProviderCatalogLoadedRef.current && agentBootstrapDoneForRepoRef.current === repoId) return;
      void bootstrapAgentWorkspace(repoId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [selectedRepo?.id]);

  useEffect(() => {
    // 全局可见性，不依赖当前是否选中仓库；否则未开仓库时手机永远读不到桌面勾选状态。
    const availableModels = agentSyncModelRefs;
    const modelLabels: Record<string, string> = {};
    for (const full of availableModels) {
      const parsed = parseModelRef(full);
      if (!parsed) continue;
      modelLabels[full] = agentConfiguredModelNamesByProvider[parsed.provider]?.[parsed.model]
        || agentModelNamesByProvider[parsed.provider]?.[parsed.model]
        || parsed.model;
    }
    const enabledList = Array.from(agentEnabledModels);
    const payload = {
      repoId: "global",
      repoPath: repoPath || "",
      availableModels,
      modelLabels,
      // 尚未勾选时不要写空 enabledModels，避免 Host 把「未配置」当成「全关」。
      ...(enabledList.length > 0 ? { enabledModels: enabledList } : {}),
      hiddenModels: Array.from(agentHiddenModels),
      activeModel: activeAgentModel || agentConfig?.configuredModel || "",
      updatedAt: Date.now(),
    };
    // 仅经 Tauri invoke 写同进程可见性文件；手机 Composer 主路径走 /api/v1/mobile/models。
    // 不再双写 HTTP PUT（旧 CLI 外置 Host 时代遗留）。
    const timer = window.setTimeout(() => {
      void invoke("set_mobile_model_state_from_desktop", { state: payload }).catch(() => { });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    activeAgentModel,
    agentConfig?.configuredModel,
    agentConfiguredModelNamesByProvider,
    agentEnabledModels,
    agentHiddenModels,
    agentModelNamesByProvider,
    agentSyncModelRefs,
    repoPath,
  ]);

  // 手机端模型开关双向同步（pull 路径）：监听 main.rs 轮询线程 emit 的
  // mobile-model-state，内容与当前 enabled/hidden 不同时批量 apply。
  // 手机端 toggle → control server 合并写文件 → 桌面 30s 轮询 emit → 这里 apply
  // → 触发上面 push useEffect 重算 agentSyncModelRefs 回推手机（availableModels 更新）。
  // 内容比较天然防循环：apply 后内容一致，下次回声 emit 命中 refSetEquals 跳过 set。
  useEffect(() => {
    const unlistenPromise = listen<{
      enabledModels?: string[] | null;
      hiddenModels?: string[] | null;
      updatedAt?: number;
    }>("mobile-model-state-pulled", (event) => {
      const payload = event.payload;
      if (!payload) return;
      const enabled = new Set<string>(Array.isArray(payload.enabledModels) ? payload.enabledModels : []);
      const hidden = new Set<string>(Array.isArray(payload.hiddenModels) ? payload.hiddenModels : []);
      applyAgentModelVisibility(enabled, hidden);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => { });
    };
  }, [applyAgentModelVisibility]);

  // 自动化完成/失败通知：尊重全局 notificationsAgent。
  useEffect(() => {
    const unlistenPromise = listen<{ title?: string; body?: string }>(
      "giteam://automation-notify",
      (event) => {
        if (!generalSettings.notificationsAgent) return;
        const title = String(event.payload?.title || "任务").trim() || "任务";
        const body = String(event.payload?.body || "").trim();
        void showSettingsNotification(title, body);
      }
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [generalSettings.notificationsAgent]);

  // 手机经云端/HTTP 发 prompt 时，桌面自己的 subscribeEvents 不会挂上该 runId。
  // 全局 hook：流式事件直接写 UI；终态再拉权威快照对账。
  const applyRemoteAgentSessionSnapshotRef = useRef(applyRemoteAgentSessionSnapshot);
  applyRemoteAgentSessionSnapshotRef.current = applyRemoteAgentSessionSnapshot;
  const applyRemoteAgentLiveEventRef = useRef(applyRemoteAgentLiveEvent);
  applyRemoteAgentLiveEventRef.current = applyRemoteAgentLiveEvent;

  useEffect(() => {
    let cancelled = false;
    let terminalTimer: number | undefined;
    let bootstrapTimer: number | undefined;
    const pendingBySid = new Map<string, string>();
    const bootstrappedRuns = new Set<string>();

    const flush = (sid: string, reason: string, repoPathHint?: string) => {
      if (cancelled || !sid) return;
      const localRun = String(agentRunIdBySessionRef.current[sid] || "").trim();
      // 桌面自己发起的 prompt 由本地 finalize 负责，避免双写打架。
      if (localRun) return;
      void applyRemoteAgentSessionSnapshotRef.current(sid, {
        repoPath: repoPathHint,
        reason
      });
    };

    const unlistenPromise = listen<{
      sessionId?: string;
      runId?: string;
      repoPath?: string;
      event?: {
        type?: string;
        messageId?: string;
        index?: number;
        delta?: string;
        partial?: string;
        message?: AgentMessage;
        toolCallId?: string;
        toolName?: string;
        input?: unknown;
        output?: unknown;
        isError?: boolean;
        status?: string;
        error?: string | null;
      };
    }>("giteam://agent-event", (event) => {
      const payload = event.payload;
      const sid = String(payload?.sessionId || "").trim();
      if (!sid) return;
      const runId = String(payload?.runId || "").trim();
      const localRun = String(agentRunIdBySessionRef.current[sid] || "").trim();
      // 本机 prompt 订阅是唯一事实来源。只要本地挂着 run，就不要再走远程灌泡路径
      // （双写会叠出同文气泡）。
      if (localRun) return;

      const type = String(payload?.event?.type || "");
      const repoPathHint = String(payload?.repoPath || "").trim();
      if (type === "interaction.requested" || type === "interaction.resolved") {
        void syncAgentInteractions(sid).catch(() => {});
      }

      const terminal = type === "run.completed" || type === "run.failed";

      // 远程流式：正在看该会话时直接灌 delta（不依赖落盘轮询）。
      if (sid === activeAgentSessionIdRef.current) {
        applyRemoteAgentLiveEventRef.current(payload);
        // 首包拉一次权威快照，确保用户消息/会话已进列表。
        const bootKey = `${sid}:${runId || "norun"}`;
        if (
          !bootstrappedRuns.has(bootKey) &&
          (type === "message.started" ||
            type === "message.delta" ||
            type === "session.status" ||
            type === "message.completed" ||
            type === "tool.started" ||
            type === "toolCall.started")
        ) {
          bootstrappedRuns.add(bootKey);
          pendingBySid.set(sid, repoPathHint);
          if (bootstrapTimer) window.clearTimeout(bootstrapTimer);
          bootstrapTimer = window.setTimeout(() => {
            bootstrapTimer = undefined;
            const hint = pendingBySid.get(sid) || repoPathHint;
            flush(sid, "remote-bootstrap", hint);
          }, 80);
        }
      } else if (
        type === "message.started" ||
        type === "message.delta" ||
        type === "message.completed" ||
        type === "session.status" ||
        type === "tool.started" ||
        type === "toolCall.started" ||
        type === "tool.progress" ||
        type === "tool.completed" ||
        type === "run.completed" ||
        type === "run.failed"
      ) {
        // 未打开该会话时也灌 live（含工具与终态 busy），切回时能看到过程；终态再 snapshot。
        applyRemoteAgentLiveEventRef.current(payload);
      }

      if (terminal) {
        pendingBySid.set(sid, repoPathHint);
        if (terminalTimer) window.clearTimeout(terminalTimer);
        terminalTimer = window.setTimeout(() => {
          const entries = [...pendingBySid.entries()];
          pendingBySid.clear();
          for (const [pendingSid, hint] of entries) {
            flush(pendingSid, type || "terminal", hint);
          }
        }, 200);
      }
    });
    return () => {
      cancelled = true;
      if (terminalTimer) window.clearTimeout(terminalTimer);
      if (bootstrapTimer) window.clearTimeout(bootstrapTimer);
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!(showMobileControlDialog || settingsMobileVisible || showMobilePairQr)) return;
    // Load settings after the dialog paints to avoid blocking navigation.
    window.setTimeout(() => {
      void loadControlServerSettings();
    }, 0);
  }, [showMobileControlDialog, settingsMobileVisible, showMobilePairQr]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const rows = await listCloudMobileClients();
        if (!cancelled) setMobileClientConnected(Array.isArray(rows) && rows.length > 0);
      } catch {
        if (!cancelled) setMobileClientConnected(false);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!(showMobileControlDialog || settingsMobileVisible || showMobilePairQr)) return;
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
    showMobilePairQr,
    controlSettingsLoaded,
    controlServerSettings.enabled
  ]);

  useEffect(() => {
    if (!settingsMobileVisible) return;
    if (controlServerSettingsBusy || !controlSettingsLoaded || !controlSettingsDirty) return;
    const timer = window.setTimeout(() => {
      void saveControlServerSettingsIfNeeded();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    settingsMobileVisible,
    controlServerSettingsBusy,
    controlSettingsLoaded,
    controlSettingsDirty,
    controlServerSettings.enabled,
    controlServerSettings.authMode,
    controlServerSettings.port,
    controlServerSettings.publicBaseUrl,
    controlServerSettings.pairCodeTtlMode
  ]);

  useEffect(() => {
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
  }, []);

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
    if (!activeAgentModel) return;
    rememberAgentSavedModel(activeAgentModel);
  }, [activeAgentModel]);

  useEffect(() => {
    if (!showAgentModelPicker) return;
    // Keep previous list until refresh resolves to avoid open-time flicker.
    void refreshAgentServerConfig();
  }, [showAgentModelPicker]);

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
          output: snapshot.output || ""
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
          updateTerminalTabById(tabId, (prev) => ({
            ...prev,
            seq: snapshot.seq,
            alive: snapshot.alive,
            cwd: snapshot.cwd || prev.cwd,
            output: `${prev.output}${snapshot.output}`
          }));
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
    terminalRepoResetReadyRef.current = true;
  }, [selectedRepo?.id]);

  useLayoutEffect(() => {
    resizeAgentInput();
  }, [agentPromptInput, agentImageAttachments.length]);

  useEffect(() => {
    const sid = activeAgentSessionId;
    const session = agentSessions.find((s) => s.id === sid);
    if (session && !session.loaded && selectedRepo) {
      void loadAgentSessionMessages(sid).catch((e) => setError(String(e)));
    }
  }, [activeAgentSessionId, agentSessions, selectedRepo?.id]);

  useEffect(() => {
    if (!selectedRepo || !repoPath || !activeAgentSessionId) return;
    const sessionId = activeAgentSessionId.trim();
    if (!sessionId) return;
    const seq = agentPassiveSyncSeqRef.current + 1;
    agentPassiveSyncSeqRef.current = seq;
    let stopped = false;
    let refreshTimer: number | null = null;
    const refresh = async () => {
      if (stopped || agentPassiveSyncSeqRef.current !== seq) return;
      // 本机正在跑的 prompt：事件流是事实来源。此时拉 history 会把服务端 user id
      // 与乐观 `user-`/`assistant-` 并排合并，叠出重复气泡。
      if (String(agentRunIdBySessionRef.current[sessionId] || "").trim()) {
        return;
      }
      try {
        agentMessageCache.invalidate(repoPath, sessionId);
        await loadAgentSessionMessages(sessionId);
        if (!stopped && selectedRepo) {
          await refreshAgentSessions(getRepoSessionFetchLimit(selectedRepo.id));
        }
      } catch (error) {
        if (!stopped) appendAgentDebugLog("session.passiveSync.warn " + String(error));
      }
    };
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, activeAgentSessionBusy ? 1200 : 600);
    const interval = window.setInterval(() => void refresh(), activeAgentSessionBusy ? 1500 : 5000);
    return () => {
      stopped = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(interval);
    };
  }, [repoPath, activeAgentSessionId, activeAgentSessionBusy, selectedRepo?.id]);

  const agentRenderedMessages = useMemo(() => {
    const visible = agentMessages;
    const streamingId = activeAgentStreamingAssistantId;
    const running = activeAgentSessionBusy;
    return visible.filter((msg) => {
      if (msg.role !== "assistant") return true;
      if (msg.error?.trim() || /^Run failed\s*\n/i.test(msg.content || "")) return true;
      if ((msg.content || "").trim()) return true;
      const mappedServerMid = (agentServerMessageIdByLocalId[msg.id] || "").trim();
      const liveParts =
        (mappedServerMid && (agentLivePartsByServerMessageId[mappedServerMid] || []))
        || agentLivePartsByServerMessageId[msg.id]
        || [];
      if (liveParts.length > 0) return true;
      const detail = agentDetailsByMessageId[msg.id] || (mappedServerMid ? agentDetailsByMessageId[mappedServerMid] : undefined);
      const loading = agentDetailsLoadingByMessageId[msg.id] || (mappedServerMid ? agentDetailsLoadingByMessageId[mappedServerMid] : false);
      if (detail === undefined || loading) return true;
      // 保留：当前正在流式输出的消息，或已经有内容的非流式消息
      if (msg.id === streamingId && running) return true;
      // 新增：如果消息有 detail.parts 内容，也保留（避免流式结束后短暂消失）
      if (detail && Array.isArray(detail.parts) && detail.parts.length > 0) return true;
      return false;
    });
  }, [
    agentMessages,
    activeAgentStreamingAssistantId,
    activeAgentSessionBusy,
    agentDetailsByMessageId,
    agentDetailsLoadingByMessageId,
    agentLivePartsByServerMessageId,
    agentServerMessageIdByLocalId
  ]);

  const agentActiveTodos = useMemo(() => {
    const visible = agentMessages;
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const msg = visible[i];
      if (msg.role !== "assistant") continue;
      const serverMid = (agentServerMessageIdByLocalId[msg.id] || "").trim();
      const detail = agentDetailsByMessageId[msg.id] || null;
      const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as AgentDetailedPart[]) : [];
      const liveParts = serverMid ? (agentLivePartsByServerMessageId[serverMid] || []) : [];
      const detailParts = liveParts.length > 0 ? liveParts : fetchedParts;
      for (let j = detailParts.length - 1; j >= 0; j -= 1) {
        const todos = readAgentTodosFromPart(detailParts[j]);
        if (todos.length > 0) return todos;
      }
    }
    return [] as AgentTodoItem[];
  }, [agentMessages, agentServerMessageIdByLocalId, agentDetailsByMessageId, agentLivePartsByServerMessageId]);

  const agentActiveQuestions = useMemo(() => {
    const dismissed = new Set(agentDismissedQuestionsBySession[activeAgentSessionId] || []);
    const sid = activeAgentSessionId.trim();
    // PR6：从 agentInteractions 的 question kind 派生提问卡片数据。
    return agentInteractions
      .filter((item) => item.kind === "question" && (!sid || item.sessionId === sid))
      .filter((item) => !dismissed.has(item.id))
      .map((item): QuestionRequest => {
        if (item.kind !== "question") return null as unknown as QuestionRequest;
        return {
          id: item.id,
          sessionID: item.sessionId,
          questions: item.questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: (q.options || []).map((opt) => ({ label: opt.label, description: opt.description })),
            multiple: q.multiple === true,
            custom: q.custom !== false,
          })),
          tool: { messageID: "", callID: item.toolCallId },
        };
      })
      .filter(Boolean) as QuestionRequest[];
  }, [agentInteractions, activeAgentSessionId, agentDismissedQuestionsBySession]);

  const agentStaleQuestions = useMemo(() => {
    if (agentActiveQuestions.length > 0) return [] as QuestionRequest[];
    const visible = agentMessages;
    const requests: QuestionRequest[] = [];
    const seenIds = new Set<string>();
    const dismissed = new Set(agentDismissedQuestionsBySession[activeAgentSessionId] || []);
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const msg = visible[i];
      if (msg.role !== "assistant") continue;
      const serverMid = (agentServerMessageIdByLocalId[msg.id] || "").trim();
      const detail = agentDetailsByMessageId[msg.id] || null;
      const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as AgentDetailedPart[]) : [];
      const liveParts = serverMid ? (agentLivePartsByServerMessageId[serverMid] || []) : [];
      const detailParts = liveParts.length > 0 ? liveParts : fetchedParts;
      for (let j = detailParts.length - 1; j >= 0; j -= 1) {
        const part = detailParts[j] as any;
        // PR6：question 是 pi 原生工具，part 形状为 {type:"toolCall", toolName:"question", status, input:{questions}}。
        if (String(part?.type || "").trim() !== "toolCall") continue;
        if (String(part?.toolName || "").trim() !== "question") continue;
        const status = String(part?.status || "").trim().toLowerCase();
        // question 等待回答时 part 处于 running（未收到 completed）。
        if (status !== "running" && status !== "pending" && status !== "deciding") continue;
        const questions = part?.input?.questions;
        if (!Array.isArray(questions) || questions.length === 0) continue;
        const id = `stale-question-${msg.id}-${String(part?.id || j)}`;
        if (seenIds.has(id) || dismissed.has(id)) continue;
        seenIds.add(id);
        requests.push({
          id,
          sessionID: activeAgentSessionId,
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
  }, [agentActiveQuestions.length, agentMessages, agentServerMessageIdByLocalId, agentDetailsByMessageId, agentLivePartsByServerMessageId, activeAgentSessionId, agentDismissedQuestionsBySession]);

  const agentSideRailTodos = agentViewportTodos.length > 0 ? agentViewportTodos : agentActiveTodos;
  const agentSideRailTodoProgress = useMemo(() => {
    const total = agentSideRailTodos.length;
    const done = agentSideRailTodos.filter((todo) => todo.status === "completed").length;
    const active =
      agentSideRailTodos.find((todo) => todo.status === "in_progress") ||
      agentSideRailTodos.find((todo) => todo.status === "pending") ||
      agentSideRailTodos[agentSideRailTodos.length - 1] ||
      null;
    return { total, done, active };
  }, [agentSideRailTodos]);

  function setAgentViewportTodosFromDom(nextTodos: AgentTodoItem[]) {
    const signature = nextTodos.map((todo) => `${todo.id}:${todo.status}:${todo.content}`).join("|");
    if (signature === agentViewportTodosSigRef.current) return;
    agentViewportTodosSigRef.current = signature;
    setAgentViewportTodos(nextTodos);
  }

  function updateAgentViewportTodos() {
    const el = agentThreadRef.current;
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll<HTMLElement>("[data-agent-todos]"));
    if (nodes.length === 0) {
      setAgentViewportTodosFromDom([]);
      return;
    }
    const viewportRect = el.getBoundingClientRect();
    const anchorY = viewportRect.top + Math.min(180, Math.max(96, el.clientHeight * 0.22));
    let bestScore = Number.POSITIVE_INFINITY;
    let bestTodos: AgentTodoItem[] = [];

    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.bottom < viewportRect.top + 24 || rect.top > viewportRect.bottom - 80) return;
      const raw = node.dataset.agentTodos || "";
      if (!raw) return;
      let todos: AgentTodoItem[] = [];
      try {
        todos = JSON.parse(decodeURIComponent(raw)) as AgentTodoItem[];
      } catch {
        todos = [];
      }
      if (todos.length === 0) return;
      const score = Math.abs(rect.top - anchorY);
      if (score < bestScore) {
        bestScore = score;
        bestTodos = todos;
      }
    });

    setAgentViewportTodosFromDom(bestTodos);
  }

  useEffect(() => {
    // 会话切换：清空旧 session 的交互卡片，questionLoading 重置（派生按 sessionId 过滤，新交互由 sync 拉取）。
    setAgentQuestionLoading(true);
    setAgentViewportTodosFromDom([]);
  }, [activeAgentSessionId]);

  useEffect(() => {
    // PR6：事件实时驱动，轮询仅作会话切换/重连的兜底对账（不再依赖 opencode 运行时检测）。
    if (!activeAgentSessionId || !selectedRepo) return;
    void syncAgentInteractions(activeAgentSessionId);
    if (!activeAgentSessionBusy) return;
    const timer = window.setInterval(() => {
      void syncAgentInteractions(activeAgentSessionId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeAgentSessionId, activeAgentSessionBusy, selectedRepo?.id]);

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
    const sid = activeAgentSessionId.trim();
    if (!sid) return;
    const missing = agentMessages
      .filter((msg) => msg.role === "assistant")
      .filter((msg) => agentDetailsByMessageId[msg.id] === undefined && !agentDetailsLoadingByMessageId[msg.id])
      .slice(-8);
    if (missing.length === 0) return;
    const missingIds = missing.map((msg) => msg.id);
    setAgentDetailsLoadingByMessageId((prev) => {
      const next = { ...prev };
      for (const id of missingIds) next[id] = true;
      return next;
    });
    const timer = window.setTimeout(() => {
      void fetchAgentDetailedMessagePage(sid, "", AGENT_INITIAL_MESSAGE_FETCH_LIMIT)
        .then((page) => {
          if (activeAgentSessionId.trim() !== sid) return;
          setAgentDetailsByMessageId((prev) => {
            const next = { ...prev };
            for (const id of missingIds) {
              const serverId = (agentServerMessageIdByLocalId[id] || "").trim() || id;
              next[id] = page.detailsById[serverId] || null;
            }
            return next;
          });
        })
        .finally(() => {
          setAgentDetailsLoadingByMessageId((prev) => {
            const next = { ...prev };
            for (const id of missingIds) next[id] = false;
            return next;
          });
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeAgentSessionId, agentMessages, agentDetailsByMessageId, agentDetailsLoadingByMessageId]);

  const agentHasHiddenHistory = Boolean(activeAgentSession?.hasMore);

  // virtuoso 通过 atBottomStateChange 驱动跟随/暂停：贴底时跟随流式，离开底部则暂停并显示"跳到最新"。
  const handleAgentAtBottomChange = useCallback((atBottom: boolean) => {
    // 空会话/草稿态没有可滚动内容，忽略 virtuoso 卸载时的 atBottom=false，避免把旧会话的「拉到最新」带过来
    if (agentShowEmptyState || draftAgentSession || !activeAgentSessionId) {
      if (!locateInFlightRef.current) {
        setAgentAutoFollowLatest(true);
        setAgentShowJumpLatest(false);
      }
      return;
    }
    // 搜索定位中：忽略 atBottom 抖动，禁止重新打开追底。
    if (locateInFlightRef.current) {
      setAgentAutoFollowLatest(false);
      setAgentShowJumpLatest(true);
      return;
    }
    setAgentAutoFollowLatest(atBottom);
    setAgentShowJumpLatest(!atBottom);
  }, [activeAgentSessionId, agentShowEmptyState, draftAgentSession]);

  // 会话切换（含切到草稿空会话）：清掉「拉到最新」；有真实会话时再滚到底。
  // pending/locate 故意不进 deps：定位结束清空 pending 时不得再滚 LAST。
  useEffect(() => {
    agentLoadingOlderRef.current = false;
    if (!activeAgentSessionId || draftAgentSession) {
      if (!locateInFlightRef.current) {
        setAgentAutoFollowLatest(true);
        setAgentShowJumpLatest(false);
      }
      return;
    }
    // 搜索定位（含跨会话加载中）：保持不追底，绝不 scrollToIndex(LAST)。
    if (locateInFlightRef.current || pendingScrollTarget || pendingScrollMessageId.trim() || locateScrollMessageId) {
      setAgentAutoFollowLatest(false);
      setAgentShowJumpLatest(true);
      return;
    }
    setAgentAutoFollowLatest(true);
    setAgentShowJumpLatest(false);
    const frame = window.requestAnimationFrame(() => {
      if (locateInFlightRef.current) return;
      agentVirtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentSessionId, draftAgentSession]);

  function loadOlderAgentHistory() {
    if (agentLoadingOlderRef.current) return;
    const session = activeAgentSession;
    if (!session?.hasMore) return;
    agentLoadingOlderRef.current = true;
    void loadMoreAgentSessionMessages(session.id);
  }

  function jumpAgentToLatest() {
    locateInFlightRef.current = false;
    setAgentAutoFollowLatest(true);
    agentVirtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" });
  }

  useEffect(() => {
    requestAnimationFrame(updateAgentViewportTodos);
  }, [agentRenderedMessages.length, agentDetailsByMessageId, agentLivePartsByServerMessageId, activeAgentSessionId]);

  useEffect(() => {
    if (!repoContextMenu && !sessionContextMenu && !composerContextMenu && !commitContextMenu && !topologyContextMenu) return;
    const dismiss = () => {
      setRepoContextMenu(null);
      setSessionContextMenu(null);
      setComposerContextMenu(null);
      setCommitContextMenu(null);
      setTopologyContextMenu(null);
    };
    window.addEventListener("click", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
    };
  }, [repoContextMenu, sessionContextMenu, composerContextMenu, commitContextMenu, topologyContextMenu]);

  useEffect(() => {
    if (!agentPreviewImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAgentPreviewImage(null);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      setAgentPreviewImage((prev) => {
        if (!prev || prev.images.length <= 1) return prev;
        const delta = e.key === "ArrowRight" ? 1 : -1;
        return { ...prev, index: (prev.index + delta + prev.images.length) % prev.images.length };
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agentPreviewImage]);

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

  const runtimeDepsMissing = !runtimeStatus.git.installed || !runtimeStatus.entire.installed;
  const runtimeInstallActive = Boolean(installingDep || runtimeJobId);
  // 仅用户从设置主动打开时显示；不再因缺依赖在启动时全屏拦截。
  const runtimeSetupVisible = showEnvSetup && (runtimeStartupChecking || runtimeDepsMissing || runtimeInstallActive);

  const refreshRemoteRepoGitNexusStatus = useCallback(async (repoId: string, refOrCommit: string) => {
    const statusKey = remoteRepoGraphStatusKey(repoId, refOrCommit);
    try {
      const graph = await getRemoteWorkspaceGraph(repoId, null, "repo_head", false, refOrCommit);
      setRemoteRepoGitNexusStatuses((current) => ({
        ...current,
        [statusKey]: mapGraphStatusToRemoteRepoGitNexusStatus(graph.status),
      }));
    } catch {
      setRemoteRepoGitNexusStatuses((current) => ({ ...current, [statusKey]: "unavailable" }));
    }
  }, []);

  const refreshRemoteRepoFileTreeStatus = useCallback(async (repoId: string) => {
    try {
      await listRemoteRepoFiles(repoId, ".");
      setRemoteRepoFileTreeStatuses((current) => ({ ...current, [repoId]: "ready" }));
    } catch {
      setRemoteRepoFileTreeStatuses((current) => ({ ...current, [repoId]: "unavailable" }));
    }
  }, []);

  const refreshRemoteRepoServerState = useCallback(async (repoId: string, canReadFiles: boolean) => {
    const [workspacesResult, activitiesResult] = await Promise.allSettled([
      listRemoteRepoWorkspaces(repoId),
      listRemoteRepoActivities(repoId),
    ]);
    if (workspacesResult.status === "fulfilled") {
      setRemoteRepoWorkspaces((current) => ({ ...current, [repoId]: workspacesResult.value }));
    }
    if (activitiesResult.status === "fulfilled") {
      setRemoteRepoActivities((current) => ({ ...current, [repoId]: activitiesResult.value }));
    }
    if (canReadFiles) await refreshRemoteRepoFileTreeStatus(repoId);
  }, [refreshRemoteRepoFileTreeStatus]);

  const refreshRemoteRepoBranches = useCallback(async (repo: RemoteRepo) => {
    if (repo.connectionStatus !== "connected") return;
    setRemoteRepoBranchesLoading((current) => ({ ...current, [repo.id]: true }));
    setRemoteRepoBranchErrors((current) => ({ ...current, [repo.id]: "" }));
    try {
      const rows = await listRemoteRepoBranches(repo.id);
      setRemoteRepoBranches((current) => ({ ...current, [repo.id]: rows }));
      setRemoteRepoSelectedRefs((current) => {
        const selected = current[repo.id];
        if (selected && rows.some((branch) => branch.name === selected)) return current;
        const defaultBranch = rows.find((branch) => branch.isDefault)?.name || repo.branch;
        return { ...current, [repo.id]: defaultBranch };
      });
    } catch (error) {
      setRemoteRepoBranchErrors((current) => ({ ...current, [repo.id]: String(error) }));
    } finally {
      setRemoteRepoBranchesLoading((current) => ({ ...current, [repo.id]: false }));
    }
  }, []);

  const rememberRemoteWorkspaceSession = useCallback((session: RemoteWorkspaceSession) => {
    setActiveRemoteWorkspaceSession(session);
    void refreshRemoteRepoServerState(session.repoId, true);
  }, [refreshRemoteRepoServerState]);

  const remoteReposWithServerState = useMemo(() => remoteRepos.map((repo) => ({
    ...repo,
    gitNexusStatus: remoteRepoGitNexusStatuses[remoteRepoGraphStatusKey(repo.id, remoteRepoSelectedRefs[repo.id] || repo.branch)] || repo.gitNexusStatus,
    fileTreeStatus: remoteRepoFileTreeStatuses[repo.id] || repo.fileTreeStatus,
    recentWorkspaces: (remoteRepoWorkspaces[repo.id] || []).map((workspace) => {
      const branchName = (remoteRepoBranches[repo.id] || [])
        .find((branch) => workspace.baseCommit.startsWith(branch.shortSha))?.name;
      return {
        id: workspace.workspaceId,
        name: `${workspace.sessionId} · ${workspace.baseCommit.slice(0, 7) || "—"}`,
        baseCommit: workspace.baseCommit,
        branchName,
        dirty: workspace.dirty,
        workspaceVersion: workspace.workspaceVersion,
        updatedAt: workspace.updatedAt,
        state: workspace.state,
      };
    }),
    recentActivity: (remoteRepoActivities[repo.id] || []).map((activity) => ({
      id: activity.id,
      summary: activity.summary,
      occurredAt: activity.occurredAt,
    })),
  })), [remoteRepos, remoteRepoActivities, remoteRepoBranches, remoteRepoFileTreeStatuses, remoteRepoGitNexusStatuses, remoteRepoSelectedRefs, remoteRepoWorkspaces]);

  const activityBar = null;
  const noRepos = repos.length === 0;
  const selectedRemoteRepo = remoteReposWithServerState.find((repo) => repo.id === selectedRemoteRepoId) || null;
  const selectedRemoteRepoBranches = selectedRemoteRepo ? remoteRepoBranches[selectedRemoteRepo.id] || [] : [];
  const selectedRemoteRepoBranchError = selectedRemoteRepo ? remoteRepoBranchErrors[selectedRemoteRepo.id] || "" : "";
  const selectedRemoteRepoBranchesBusy = selectedRemoteRepo ? Boolean(remoteRepoBranchesLoading[selectedRemoteRepo.id]) : false;
  const selectedRemoteRepoRef = selectedRemoteRepo
    ? remoteRepoSelectedRefs[selectedRemoteRepo.id] || selectedRemoteRepo.branch
    : "";
  const selectedRemoteRepoWithRef = selectedRemoteRepo
    ? { ...selectedRemoteRepo, branch: selectedRemoteRepoRef || selectedRemoteRepo.branch }
    : null;
  const selectedRemoteWorkspaceSession = selectedRemoteRepo
    && activeRemoteWorkspaceSession?.repoId === selectedRemoteRepo.id
    ? activeRemoteWorkspaceSession
    : null;
  const currentProjectId = selectedRepo?.id || "";

  const refreshRemoteRepos = useCallback(async () => {
    // 远程仓库模块下线：断掉 list_repos 自动加载链路，配合侧边栏/右侧面板/设置
    // 三入口隐藏，确保启动时不触发未完成的 remote_repo 后端。模块完整后移除此守卫。
    if (!REMOTE_REPO_MODULE_ENABLED) return;
    setRemoteRepoLoading(true);
    try {
      const rows = await listRemoteRepos();
      setRemoteRepos(rows);
      setRemoteRepoLoadError("");
    } catch (error) {
      setRemoteRepoLoadError(String(error));
      setRemoteRepos([]);
    } finally {
      setRemoteRepoLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRemoteRepos();
  }, [refreshRemoteRepos]);

  useEffect(() => {
    // 远程仓库模块下线：跳过 get_service_url 自动读取，避免触发未完成的后端。
    if (!REMOTE_REPO_MODULE_ENABLED) return;
    let cancelled = false;
    void loadRemoteRepoServiceSetting()
      .then((setting) => {
        if (cancelled) return;
        setRemoteRepoServiceSetting(setting);
        setRemoteRepoServiceDraft(setting.configuredUrl);
        setRemoteRepoServiceApiKeyDraft(setting.apiKey);
      })
      .catch((error) => {
        if (!cancelled) setRemoteRepoServiceNotice(`无法读取远程服务设置：${String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const repo = remoteRepos.find((item) => item.id === selectedRemoteRepoId);
    if (!repo) return;
    void refreshRemoteRepoServerState(repo.id, repo.connectionStatus === "connected");
    void refreshRemoteRepoBranches(repo);
  }, [remoteRepos, refreshRemoteRepoBranches, refreshRemoteRepoServerState, selectedRemoteRepoId]);

  useEffect(() => {
    if (!selectedRemoteRepo || selectedRemoteRepo.connectionStatus !== "connected" || !selectedRemoteRepoRef) return;
    void refreshRemoteRepoGitNexusStatus(selectedRemoteRepo.id, selectedRemoteRepoRef);
  }, [refreshRemoteRepoGitNexusStatus, selectedRemoteRepo?.connectionStatus, selectedRemoteRepo?.id, selectedRemoteRepoRef]);

  function openRemoteRepo(repo: RemoteRepo) {
    setSelectedRemoteRepoId(repo.id);
    setRemoteRepoSelectedRefs((current) => ({ ...current, [repo.id]: current[repo.id] || repo.branch }));
    setRemoteRepoResourceMode(null);
    setActiveRemoteWorkspaceSession(null);
    setRemoteRepoNotice("");
    openRightPane("remoteRepos");
    setRemoteRepos((current) => current.map((item) => item.id === repo.id ? { ...item, lastAccessedAt: Date.now() } : item));
    void touchRemoteRepoAccess(repo.id)
      .then(() => refreshRemoteRepos())
      .catch((error) => setRemoteRepoLoadError(String(error)));
  }

  function openRemoteRepoInspector() {
    setSelectedRemoteRepoId("");
    setRemoteRepoResourceMode(null);
    setActiveRemoteWorkspaceSession(null);
    setRemoteRepoNotice("");
    openRightPane("remoteRepos");
  }

  function handleRemoteRepoAction(action: RemoteRepoAction, workspaceId?: string) {
    setRemoteRepoNotice("");
    if (action === "browse_files") {
      setRemoteRepoResourceMode("files");
      return;
    }
    if (action === "view_branches") {
      setRemoteRepoResourceMode("branches");
      return;
    }
    if (action === "resume_workspace") {
      if (!workspaceId) {
        setRemoteRepoNotice("没有可恢复的服务端工作区。");
        return;
      }
      void (async () => {
        try {
          setRemoteRepoNotice("正在从服务端恢复工作区…");
          const session = await resumeRemoteWorkspace(workspaceId);
          setActiveRemoteWorkspaceSession(session);
          setRemoteRepoResourceMode("workspace");
          await refreshRemoteRepoServerState(session.repoId, true);
        } catch (error) {
          setRemoteRepoNotice(`无法恢复远程工作区：${String(error)}`);
        }
      })();
      return;
    }
    // Opening a workspace is deliberately a new-workspace flow. Existing
    // server workspaces are resumed only via an explicit “继续工作” action.
    setActiveRemoteWorkspaceSession(null);
    setRemoteRepoResourceMode("workspace");
  }

  async function runRemoteRepoHeadGraph(repo: RemoteRepo, refOrCommit: string, analyze: boolean) {
    const statusKey = remoteRepoGraphStatusKey(repo.id, refOrCommit);
    setRemoteRepoGitNexusBusyKey(`${statusKey}:${analyze ? "analyze" : "status"}`);
    setRemoteRepoNotice(analyze ? `正在分析 ${refOrCommit} 的仓库 HEAD…` : `正在检查 ${refOrCommit} 的仓库 HEAD 索引…`);
    try {
      const graph = await getRemoteWorkspaceGraph(repo.id, null, "repo_head", analyze, refOrCommit);
      setRemoteRepoGitNexusStatuses((current) => ({
        ...current,
        [statusKey]: mapGraphStatusToRemoteRepoGitNexusStatus(graph.status),
      }));
      setRemoteRepoNotice(`${refOrCommit}：${describeRemoteWorkspaceGraphAction(analyze ? "analyze" : "status", graph)}`);
    } catch (error) {
      setRemoteRepoGitNexusStatuses((current) => ({ ...current, [statusKey]: "unavailable" }));
      setRemoteRepoNotice(`GitNexus 操作失败：${String(error)}`);
    } finally {
      setRemoteRepoGitNexusBusyKey("");
    }
  }

  async function syncRemoteRepo(repoId: string) {
    const repo = remoteRepos.find((item) => item.id === repoId);
    if (!repo || repo.connectionStatus === "syncing" || repo.connectionStatus === "auth_required") return;
    setRemoteRepoNotice("正在刷新分支、提交与文件元数据…");
    setRemoteRepos((current) => current.map((item) => item.id === repoId ? { ...item, connectionStatus: "syncing" } : item));
    setRemoteRepoGitNexusStatuses((current) => ({
      ...current,
      [remoteRepoGraphStatusKey(repoId, remoteRepoSelectedRefs[repoId] || repo.branch)]: "unknown",
    }));
    setRemoteRepoFileTreeStatuses((current) => ({ ...current, [repoId]: "loading" }));
    try {
      await syncRemoteRepoConnection(repoId);
      await refreshRemoteRepos();
      await refreshRemoteRepoBranches({ ...repo, connectionStatus: "connected" });
      await refreshRemoteRepoServerState(repoId, true);
      setRemoteRepoNotice("同步完成：已刷新远程代码元数据，未创建工作区，也未修改远端。");
    } catch (error) {
      const message = String(error);
      setRemoteRepos((current) => current.map((item) => item.id === repoId ? { ...item, connectionStatus: "failed", errorMessage: message } : item));
      setRemoteRepoNotice(`同步失败：${message}`);
    }
  }

  async function testConfiguredRemoteRepoService() {
    setRemoteRepoServiceBusy(true);
    setRemoteRepoServiceNotice("");
    try {
      const target = remoteRepoServiceDraft.trim() || remoteRepoServiceSetting.effectiveUrl;
      const result = await testRemoteRepoServiceUrl(target, remoteRepoServiceApiKeyDraft);
      setRemoteRepoServiceNotice(`连接成功：服务可用，读取到 ${result.repoCount} 个远程仓库连接。点击“保存并使用”后，App 才会切换到 ${result.serviceUrl}。`);
    } catch (error) {
      setRemoteRepoServiceNotice(`连接失败：${String(error)}`);
    } finally {
      setRemoteRepoServiceBusy(false);
    }
  }

  async function saveConfiguredRemoteRepoService(value = remoteRepoServiceDraft, apiKey = remoteRepoServiceApiKeyDraft) {
    setRemoteRepoServiceBusy(true);
    setRemoteRepoServiceNotice("");
    try {
      const setting = await saveRemoteRepoServiceUrl(value, apiKey);
      setRemoteRepoServiceSetting(setting);
      setRemoteRepoServiceDraft(setting.configuredUrl);
      setRemoteRepoServiceApiKeyDraft(setting.apiKey);
      setRemoteRepoServiceNotice(setting.configuredUrl
        ? `已保存并切换服务：检测到 ${setting.repoCount} 个远程仓库连接。`
        : "已恢复默认服务地址。"
      );
      setSelectedRemoteRepoId("");
      setRemoteRepoResourceMode(null);
      await refreshRemoteRepos();
    } catch (error) {
      setRemoteRepoServiceNotice(`未保存：${String(error)}`);
    } finally {
      setRemoteRepoServiceBusy(false);
    }
  }

  async function reloadRemoteRepoConnections() {
    setRemoteRepoNotice("正在重新读取远程仓库服务配置…");
    try {
      await reloadRemoteRepoConfig();
      await refreshRemoteRepos();
      setRemoteRepoNotice("远程仓库配置已刷新。");
    } catch (error) {
      setRemoteRepoNotice(`刷新失败：${String(error)}`);
    }
  }

  function openRemoteRepoImport() {
    setRemoteRepoMutationError("");
    setRemoteRepoFormTarget(null);
  }

  function openRemoteRepoEdit(repo: RemoteRepo) {
    setRemoteRepoMutationError("");
    setRemoteRepoFormTarget(repo);
  }

  async function submitRemoteRepoForm(values: RemoteRepoFormValues) {
    const editing = remoteRepoFormTarget && remoteRepoFormTarget !== undefined;
    setRemoteRepoMutationBusy(true);
    setRemoteRepoMutationError("");
    try {
      if (editing) {
        await updateRemoteRepo({
          repoId: values.repoId,
          name: values.name,
          remoteUrl: values.remoteUrl.trim() || undefined,
          defaultRef: values.defaultRef,
          authMethod: values.authMethod || undefined,
        });
        setRemoteRepoNotice("连接已更新；若修改了来源或默认分支，请手动同步。未创建 workspace/session。");
      } else {
        await addRemoteRepo({
          repoId: values.repoId.trim(),
          name: values.name.trim(),
          remoteUrl: values.remoteUrl.trim(),
          defaultRef: values.defaultRef.trim(),
          authMethod: values.authMethod || undefined,
        });
        setSelectedRemoteRepoId(values.repoId.trim());
        setRemoteRepoNotice("仓库已引入，服务端正在排队镜像克隆；未创建 workspace/session。 ");
      }
      setRemoteRepoFormTarget(undefined);
      await refreshRemoteRepos();
    } catch (error) {
      setRemoteRepoMutationError(String(error));
    } finally {
      setRemoteRepoMutationBusy(false);
    }
  }

  async function confirmRemoteRepoRemoval() {
    const repo = remoteRepoPendingRemoval;
    if (!repo) return;
    setRemoteRepoMutationBusy(true);
    try {
      await removeRemoteRepo(repo.id);
      if (selectedRemoteRepoId === repo.id) {
        setSelectedRemoteRepoId("");
        setRemoteRepoResourceMode(null);
      }
      setRemoteRepoPendingRemoval(null);
      setRemoteRepoNotice("远程仓库连接已移除；远端仓库与本地缓存未被删除。");
      await refreshRemoteRepos();
    } catch (error) {
      setRemoteRepoMutationError(String(error));
      setRemoteRepoNotice(`移除失败：${String(error)}`);
    } finally {
      setRemoteRepoMutationBusy(false);
    }
  }

  async function toggleRemoteRepoPinned(repo: RemoteRepo) {
    const nextPinned = !repo.pinned;
    setRemoteRepos((current) => current.map((item) => item.id === repo.id ? { ...item, pinned: nextPinned } : item));
    try {
      await setRemoteRepoPinned(repo.id, nextPinned);
      await refreshRemoteRepos();
    } catch (error) {
      setRemoteRepos((current) => current.map((item) => item.id === repo.id ? { ...item, pinned: repo.pinned } : item));
      setRemoteRepoNotice(`更新固定状态失败：${String(error)}`);
    }
  }

  const sideBar = (
    <DesktopSidebar
      text={appText}
      noRepos={noRepos}
      busy={busy}
      agentInstalled={true}
      repos={repos}
      pinnedRepoIds={pinnedRepoIds}
      expandedProjectIds={expandedProjectIds}
      selectedRepoId={selectedRepo?.id || ""}
      activeSessionId={activeAgentSessionId}
      draftRepoId={draftAgentSession ? (selectedRepo?.id || "") : ""}
      sessionBusyById={agentRunBusyBySession}
      gitUserIdentity={gitUserIdentity}
      getVisibleRepoSessions={getVisibleRepoSessions}
      hasMoreRepoSessions={hasMoreRepoSessions}
      isRepoSessionsLoading={isRepoSessionsLoading}
      isRepoSessionsPaging={isRepoSessionsPaging}
      isRepoSessionsLoaded={hasLoadedSidebarRepoSessions}
      onImportRepository={() => openAddProjectDialog()}
      onCreateSession={() => void createAndSwitchAgentSessionForSidebar()}
      onOpenSearch={() => setSearchPanelOpen(true)}
      onToggleRepoSessions={toggleRepoSessions}
      onEnsureRepoSessions={(repo) => {
        // 悬浮卡片需要任务数量：未加载且不在加载中时补拉一次会话列表。
        if (hasLoadedSidebarRepoSessions(repo.id) || isRepoSessionsLoading(repo.id)) return;
        void refreshSidebarRepoSessions(repo).catch((e) => setError(String(e)));
      }}
      onOpenRepoContextMenu={openRepoContextMenu}
      onTogglePinnedRepo={togglePinnedRepo}
      onStartDraftSession={startDraftSessionForRepo}
      onFocusDraftSession={() => agentInputRef.current?.focus()}
      onOpenSession={openSidebarAgentSession}
      onArchiveSession={(repo, sessionId) => archiveAgentSession(repo, sessionId)}
      onLoadMoreSessions={(repo) => void loadMoreSidebarRepoSessions(repo)}
      rightDrawerOpen={rightDrawerOpen}
      rightPaneTab={rightPaneTab}
      rightOptionalTabs={rightOptionalTabs}
      rightModules={rightModuleVisibility}
      branchPicker={selectedRepo ? {
        repoName: selectedRepo.name,
        currentBranch: worktreeOverview.branch || selectedBranch,
        branches,
        uncommittedCount: worktreeChangeStats.total,
        busy,
        onCheckoutBranch: (branchName) => void checkoutBranchFromTopology(branchName),
        onCreateAndCheckout: (branchName) => createAndCheckoutBranch(branchName),
        onRefreshBranches: () => void refreshBranchListForPicker(),
      } : null}
      onOpenRightPane={openRightPane}
      onOpenSettings={() => {
        setSettingsInitialSection("general");
        setShowSettings(true);
      }}
      onOpenMobilePairQr={() => setShowMobilePairQr(true)}
      mobileClientConnected={mobileClientConnected}
      remoteRepoActive={rightDrawerOpen && rightPaneTab === "remoteRepos"}
      onOpenRemoteRepos={openRemoteRepoInspector}
      automationActive={mainMode === "automation"}
      onOpenAutomation={() => {
        setMainMode("automation");
        // 内嵌浏览器子 webview 可能盖在主区域上，进自动化前先全部隐藏。
        if (IS_TAURI) {
          void invoke("hide_all_browser").catch(() => {});
        }
      }}
    />
  );

  const centerPane = (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className={agentShowEmptyState ? "flex min-h-0 flex-1 flex-col items-center justify-center" : "flex min-h-0 flex-1 flex-col overflow-hidden"}>
        <AgentChatFrame
          empty={agentShowEmptyState}
          jumpLatest={
            !agentShowEmptyState && agentShowJumpLatest ? (
              <Button
                className="size-9 rounded-full border border-border/60 bg-card shadow-md"
                onClick={jumpAgentToLatest}
                aria-label="拉到最新"
                title="拉到最新"
                variant="ghost"
                size="icon"
              >
                <ArrowDownIcon />
              </Button>
            ) : null
          }
          stream={(
            <AgentMessageStream
              sessionLoading={agentSessionLoading}
              activeSessionId={activeAgentSessionId}
              virtuosoRef={agentVirtuosoRef}
              scrollerRef={(node) => { agentThreadRef.current = node instanceof HTMLDivElement ? node : null; }}
              onStartReached={loadOlderAgentHistory}
              onAtBottomChange={handleAgentAtBottomChange}
              onRangeChanged={() => requestAnimationFrame(updateAgentViewportTodos)}
              pendingScrollMessageId={locateScrollMessageId}
              locateNonce={locateNonce}
              onPendingScrollDone={() => {
                clearLocateRequest();
              }}
              highlightKeyword={highlightKeyword}
              text={appText}
              navigatorHidden={rightDrawerOpen}
              navigatorSide={generalSettings.navigatorSide}
              navigatorScope={generalSettings.navigatorScope}
              stickResetSignal={agentStickResetSignal}
              messages={agentMessages}
              renderedMessages={agentRenderedMessages}
              activeStreamingAssistantId={activeAgentStreamingAssistantId}
              activeSessionBusy={activeAgentSessionBusy}
              serverMessageIdByLocalId={agentServerMessageIdByLocalId}
              detailsByMessageId={agentDetailsByMessageId}
              livePartsByServerMessageId={agentLivePartsByServerMessageId}
              detailsLoadingByMessageId={agentDetailsLoadingByMessageId}
              detailsErrorByMessageId={agentDetailsErrorByMessageId}
              showReasoningSummaries={generalSettings.showReasoningSummaries}
              shellToolPartsExpanded={generalSettings.shellToolPartsExpanded}
              editToolPartsExpanded={generalSettings.editToolPartsExpanded}
              workspaceRoot={agentWorkspaceRoot}
              workspaceFileCandidates={agentWorkspaceFileCandidates}
              workspaceDirectoryCandidates={agentWorkspaceDirectoryCandidates}
              onOpenTaskSession={(sessionId, titleHint) => {
                void openAgentChildSession(sessionId, titleHint);
              }}
              onOpenWorkspacePath={(path, line) => {
                void openWorkspacePathInRightPane(path, line);
              }}
              onOpenWorkspaceDirectory={(path) => {
                void openWorkspaceDirectory(path);
              }}
              onOpenLocalDirectory={(path) => {
                void openLocalDirectory(path);
              }}
              onOpenToolFile={(target) => {
                void openToolFileInRightPane(target);
              }}
              onOpenBrowserUrl={(url) => openUrlInBrowserPane(url)}
              onPreviewImageGroup={(images, index) => {
                setAgentPreviewImage({ images, index });
              }}
              onCopyAttachmentUri={(uri) => {
                void copyText(uri);
              }}
              onOpenAttachment={(uri, filename, mime) => {
                void openAttachmentInRightPane(uri, filename, mime);
              }}
            />
          )}
          sideRail={generalSettings.showSessionProgressBar && agentSideRailTodos.length > 0 ? ({ collapsed }) => (
            <AgentTodoProgressCard
              todos={agentSideRailTodos}
              progress={agentSideRailTodoProgress}
              activeSessionBusy={activeAgentSessionBusy}
              collapsed={collapsed}
            />
          ) : null}
          sideRailHidden={rightDrawerOpen}
          composer={(
            <AgentComposerPanel
              permissions={agentActivePermissions}
              activeSessionStale={agentActiveSessionStale}
              onOpenPermissionsPanel={() => openAgentModulePanel("permissions")}
              onReplyPermission={(requestId, reply) => { void sendPermissionReply(requestId, reply); }}
              questionLoading={agentQuestionLoading}
              activeQuestions={agentActiveQuestions}
              staleQuestions={agentStaleQuestions}
              onReplyQuestion={(requestId, answers) => {
                void sendQuestionReply(requestId, answers).then((ok) => {
                  if (!ok) return;
                  setAgentDismissedQuestionsBySession((prev) => ({
                    ...prev,
                    [activeAgentSessionId]: Array.from(new Set([...(prev[activeAgentSessionId] || []), requestId])),
                  }));
                });
              }}
              onDismissQuestion={(requestId) => {
                void sendQuestionReject(requestId).then((ok) => {
                  if (!ok) return;
                  setAgentDismissedQuestionsBySession((prev) => ({
                    ...prev,
                    [activeAgentSessionId]: Array.from(new Set([...(prev[activeAgentSessionId] || []), requestId])),
                  }));
                });
              }}
              onDismissStaleQuestion={(requestId) => {
                setAgentDismissedQuestionsBySession((prev) => ({
                  ...prev,
                  [activeAgentSessionId]: Array.from(new Set([...(prev[activeAgentSessionId] || []), requestId])),
                }));
              }}
              showEmptyState={agentShowEmptyState}
              selectedRepoName={selectedRepo?.name || "Giteam"}
              showJumpLatest={false}
              onJumpLatest={jumpAgentToLatest}
              attachments={agentImageAttachments}
              onRemoveAttachment={(id) => setAgentImageAttachments((prev) => prev.filter((item) => item.id !== id))}
              graphRefs={agentGraphContextRefs}
              onRemoveGraphRef={(id) => setAgentGraphContextRefs((prev) => prev.filter((item) => item.id !== id))}
              slashOpen={agentSlashOpen}
              slashSuggestions={agentSlashSuggestions}
              slashActiveIndex={agentSlashActiveIndex}
              onHoverSlashSuggestion={setAgentSlashActiveIndex}
              onActivateSlashCommand={activateAgentSlashCommand}
              promptInputRef={agentInputRef}
              promptInput={agentPromptInput}
              onPromptCompositionStart={() => {
                agentInputComposingRef.current = true;
              }}
              onPromptCompositionEnd={() => {
                agentInputComposingRef.current = false;
              }}
              onPromptChange={(event) => {
                const value = event.target.value;
                captureAgentPromptHistoryDraft(value);
                setAgentPromptInput(value);
                const isSlash = /^\//.test(value) && !value.includes(" ");
                setAgentSlashOpen(isSlash);
                setAgentSlashActiveIndex(0);
              }}
              onPromptKeyDown={(event) => {
                const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
                if (nativeEvent.isComposing || agentInputComposingRef.current || nativeEvent.keyCode === 229) return;
                if (agentSlashOpen && agentSlashSuggestions.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setAgentSlashActiveIndex((index) => (index + 1) % agentSlashSuggestions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setAgentSlashActiveIndex((index) => (index - 1 + agentSlashSuggestions.length) % agentSlashSuggestions.length);
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    const command = agentSlashSuggestions[agentSlashActiveIndex];
                    if (command) activateAgentSlashCommand(command);
                    return;
                  }
                  if (event.key === "Escape") {
                    setAgentSlashOpen(false);
                    return;
                  }
                }
                // 运行中仍允许↑↓翻历史 / Enter 排队跟进；空输入 Enter 不停止（停止走按钮）。
                if (event.key === "ArrowUp" && shouldUsePromptHistoryKey(event, "older")) {
                  event.preventDefault();
                  browseAgentPromptHistory("older");
                  return;
                }
                if (event.key === "ArrowDown" && shouldUsePromptHistoryKey(event, "newer")) {
                  event.preventDefault();
                  browseAgentPromptHistory("newer");
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!(activeAgentModel || "").trim()) {
                    setError("请先配置并选择模型后再发送。");
                    setMessage("请先选择模型");
                    setSettingsInitialSection("models");
                    setShowSettings(true);
                    return;
                  }
                  // busy + 空草稿：不发送也不停止（停止用方钮）。
                  if (
                    activeAgentSessionBusy
                    && !agentPromptInput.trim()
                    && agentImageAttachments.length === 0
                    && agentGraphContextRefs.length === 0
                  ) {
                    return;
                  }
                  void runAgentPrompt();
                }
              }}
              onPromptPaste={async (event) => {
                if (!hasClipboardFileReference(event.clipboardData) && hasPlainClipboardText(event.clipboardData)) {
                  return;
                }
                event.preventDefault();
                const attachments = await readAgentClipboardAttachments(event.clipboardData);
                if (attachments.length === 0) {
                  // preventDefault 后即便没有附件也要保住输入焦点。
                  requestAnimationFrame(() => agentInputRef.current?.focus({ preventScroll: true }));
                  return;
                }
                appendAgentAttachments(attachments);
              }}
              onPromptContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRepoContextMenu(null);
                setSessionContextMenu(null);
                setCommitContextMenu(null);
                setTopologyContextMenu(null);
                setComposerContextMenu({ x: event.clientX, y: event.clientY });
              }}
              onPromptDragOver={(event) => {
                if ((event.dataTransfer?.files?.length || 0) <= 0) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onPromptDrop={async (event) => {
                event.preventDefault();
                const attachments = await readTransferAttachments(event.dataTransfer);
                if (attachments.length === 0) return;
                appendAgentAttachments(attachments);
              }}
              attachmentMenuOpen={agentAttachmentMenuOpen}
              onToggleAttachmentMenu={() => setAgentAttachmentMenuOpen((prev) => !prev)}
              attachmentInputRef={agentImageInputRef}
              attachmentInputAccept={AGENT_ATTACHMENT_INPUT_ACCEPT}
              onOpenAttachmentPicker={() => {
                void openAgentAttachmentPicker();
              }}
              onAttachmentInputChange={async (event) => {
                const files = Array.from(event.target.files || []);
                if (files.length === 0) return;
                const attachments = await Promise.all(files.map((file) => readFileAsAttachment(file)));
                appendAgentAttachments(attachments.filter(Boolean) as AgentAttachment[]);
                event.currentTarget.value = "";
              }}
              modelPickerRef={agentModelPickerRef}
              showModelPicker={showAgentModelPicker}
              onToggleModelPicker={() => setShowAgentModelPicker((prev) => !prev)}
              modelPickerSearch={agentModelPickerSearch}
              onModelPickerSearchChange={setAgentModelPickerSearch}
              activeAgent={activeAgentAgent}
              onApplyAgent={applyAgentAgent}
              activeThinkingLevel={activeAgentThinkingLevel}
              thinkingLevelOptions={activeAgentThinkingOptions}
              onApplyThinkingLevel={(level) => void applyAgentThinkingLevel(level)}
              autoAcceptPermissions={agentAutoAcceptPermissions}
              onToggleAutoAcceptPermissions={() => {
                const next = !agentAutoAcceptPermissions;
                setAgentAutoAcceptPermissions(next);
                saveLocalBool(AGENT_AUTO_ACCEPT_PERMISSIONS_KEY, next);
                if (activeAgentSessionId) void ensureSessionAutoAcceptPermissions(activeAgentSessionId, next);
              }}
              configuredModelCandidates={agentConfiguredModelCandidates}
              activeModel={activeAgentModel}
              getModelDisplay={getAgentModelDisplay}
              onApplyModel={(modelRef) => {
                void applyAgentModel(modelRef);
                setShowAgentModelPicker(false);
              }}
              onOpenModelSettings={() => {
                setSettingsInitialSection("models");
                setShowSettings(true);
                setAgentProviderPickerSearch("");
                setAgentProviderPickerProvider(agentModelProvider);
                setAgentProviderPickerModelSearch("");
                setShowAgentModelPicker(false);
              }}
              labels={{
                model: appText.model,
                configureModels: appText.configureModels,
                configureModelsAction: appText.configureModelsAction,
                emptyComposerHeadline: appText.emptyComposerHeadline
              }}
              activeSessionBusy={activeAgentSessionBusy}
              queuedFollowUps={agentQueuedFollowUpsBySession[activeAgentSessionId] || []}
              onRemoveQueuedFollowUp={(id) => {
                if (!activeAgentSessionId) return;
                removeQueuedFollowUp(activeAgentSessionId, id);
              }}
              canSubmit={Boolean(
                (activeAgentModel || "").trim()
                && (agentPromptInput.trim() || agentImageAttachments.length > 0 || agentGraphContextRefs.length > 0)
              )}
              onPrimaryAction={() => {
                // busy + 有草稿 → runAgentPrompt 内入队；busy + 空 → 停止。
                if (
                  activeAgentSessionBusy
                  && !agentPromptInput.trim()
                  && agentImageAttachments.length === 0
                ) {
                  void stopAgentPrompt();
                  return;
                }
                void runAgentPrompt();
              }}
            />
          )}
        />
      </div>
      {showAgentDebugLog ? (
        <Card className="mx-2.5 mb-2.5 overflow-hidden rounded-lg">
          <CardHeader className="flex min-h-8 flex-row items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
            <CardTitle className="text-xs font-medium">Giteam Debug Log</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setAgentDebugLogs([])}>Clear</Button>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="max-h-44 overflow-auto bg-muted/35 p-2 font-mono text-xs leading-relaxed text-foreground">{agentDebugLogs.length === 0 ? "No logs yet." : agentDebugLogs.join("\n")}</pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );

  const rightPane = (
    <RightSidebarPanel
      ref={agentRightPaneRef}
      variant={rightPaneTab === "changes" || rightPaneTab === "worktree" || rightPaneTab === "assetGraph"
        ? "workspace"
        : rightPaneTab === "terminal"
          ? "terminal"
          : "default"}
    >
      {rightPaneTab === "browser" ? (
        <BrowserPanel url={browserPaneUrl} />
      ) : null}
      {rightPaneTab === "assetGraph" ? (
        <AssetGraphPanel
          repoPath={repoPath}
          deferForContent={agentSessionLoading}
          currentSessionId={activeAgentSessionId}
          onCiteNode={handleCiteGraphNode}
        />
      ) : null}
      {rightPaneTab === "remoteRepos" ? (
        selectedRemoteRepo ? (
          remoteRepoResourceMode ? (
            remoteRepoResourceMode === "workspace" ? (
              <RemoteRepoWorkspacePanel
                key={`${selectedRemoteRepo.id}:${selectedRemoteRepoRef}`}
                repo={selectedRemoteRepoWithRef || selectedRemoteRepo}
                onBack={() => {
                  setRemoteRepoResourceMode(null);
                  setActiveRemoteWorkspaceSession(null);
                }}
                initialSession={selectedRemoteWorkspaceSession}
                onSessionChange={rememberRemoteWorkspaceSession}
                onSessionUnavailable={() => {
                  setActiveRemoteWorkspaceSession(null);
                  void refreshRemoteRepoServerState(selectedRemoteRepo.id, true);
                }}
              />
            ) : (
              <RemoteRepoCodeResourcePanel
                repo={selectedRemoteRepoWithRef || selectedRemoteRepo}
                mode={remoteRepoResourceMode}
                selectedRef={selectedRemoteRepoRef}
                onSelectBranch={(branchName) => {
                  setRemoteRepoSelectedRefs((current) => ({ ...current, [selectedRemoteRepo.id]: branchName }));
                  setRemoteRepoResourceMode(null);
                }}
                onBack={() => setRemoteRepoResourceMode(null)}
              />
            )
          ) : (
            <RemoteRepoOverview
              repo={selectedRemoteRepoWithRef || selectedRemoteRepo}
              branches={selectedRemoteRepoBranches}
              branchesBusy={selectedRemoteRepoBranchesBusy}
              branchError={selectedRemoteRepoBranchError}
              selectedRef={selectedRemoteRepoRef}
              gitNexusBusy={Boolean(remoteRepoGitNexusBusyKey)}
              currentProjectLinked={Boolean(currentProjectId) && selectedRemoteRepo.linkedProjectIds.includes(currentProjectId)}
              notice={remoteRepoNotice}
              onBack={() => {
                setSelectedRemoteRepoId("");
                setRemoteRepoResourceMode(null);
                setActiveRemoteWorkspaceSession(null);
                setRemoteRepoNotice("");
              }}
              onSelectBranch={(branchName) => setRemoteRepoSelectedRefs((current) => ({ ...current, [selectedRemoteRepo.id]: branchName }))}
              onRepoHeadGraphStatus={() => void runRemoteRepoHeadGraph(selectedRemoteRepo, selectedRemoteRepoRef, false)}
              onRepoHeadGraphAnalyze={() => void runRemoteRepoHeadGraph(selectedRemoteRepo, selectedRemoteRepoRef, true)}
              onAction={handleRemoteRepoAction}
              onSync={() => void syncRemoteRepo(selectedRemoteRepo.id)}
            />
          )
        ) : (
          <RemoteRepoCatalog
            repos={remoteReposWithServerState}
            currentProjectId={currentProjectId}
            loading={remoteRepoLoading}
            error={remoteRepoLoadError}
            refreshing={remoteRepoLoading}
            onBack={() => closeRightPaneTab("remoteRepos")}
            onOpenRepo={openRemoteRepo}
            onImport={openRemoteRepoImport}
            onReload={() => void reloadRemoteRepoConnections()}
            onEditRepo={openRemoteRepoEdit}
            onSyncRepo={(repo) => void syncRemoteRepo(repo.id)}
            onRemoveRepo={setRemoteRepoPendingRemoval}
            onTogglePin={(repo) => void toggleRemoteRepoPinned(repo)}
          />
        )
      ) : null}

      {rightPaneTab === "worktree" ? (
        <div className="flex h-full min-h-0 w-full overflow-hidden">
          <GitTreeTopologyPanel
            defaultSidebarSize={gitTreeSidebarSize}
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
            onSidebarSizeChange={setGitTreeSidebarSize}
          />
        </div>
      ) : null}

      {rightPaneTab === "changes" ? (
        <GitChangesPanel
          branchName={worktreeOverview.branch || selectedBranch || "no branch"}
          changesSidebarWidth={changesSidebarWidth}
          isResizing={draggingSplit?.kind === "changes"}
          changeStats={worktreeChangeStats}
          lineStats={{ added: worktreeOverview.addedLines, deleted: worktreeOverview.deletedLines }}
          entries={worktreePatchStreamEntries}
          patchByPath={worktreePatchByPath}
          stagedTree={stagedTree}
          unstagedTree={unstagedTree}
          expandedDirs={expandedWorktreeDirs}
          selectedFile={selectedWorktreeFile}
          selectedEntry={selectedWorktreeEntry}
          selectedContent={selectedWorktreeContent}
          selectedLine={selectedWorktreeLine}
          viewMode={selectedWorktreeViewMode}
          committing={committing}
          pushing={pushing}
          gitOperationLabel={gitOperationLabel}
          commitMenuAvailable={commitMenuAvailable}
          stagingFile={stagingFile}
          unstagingFile={unstagingFile}
          discardingFile={discardingFile}
          discardingAll={discardingAll}
          theme={theme}
          onToggleStageAll={() => void handleToggleStageAll()}
          onOpenDiscardAllConfirm={openDiscardAllConfirm}
          onCommit={() => {
            setCommitDialogAction("commit");
          }}
          onCommitAndPush={() => {
            setCommitDialogAction("commitPush");
          }}
          onCommitAndSync={() => {
            setCommitDialogAction("commitSync");
          }}
          onPatchWindowChange={handleWorktreePatchWindowChange}
          onToggleDir={toggleWorktreeDir}
          onOpenFile={(path) => {
            setSelectedAttachmentPreviewPath("");
            setSelectedWorktreeLine(undefined);
            setSelectedWorktreeViewMode("auto");
            void refreshSelectedWorktreePatch(path);
          }}
          onStageFile={(path) => void handleStageFile(path)}
          onUnstageFile={(path) => void handleUnstageFile(path)}
          onStagePaths={(paths, label) => void handleStagePaths(paths, label)}
          onUnstagePaths={(paths, label) => void handleUnstagePaths(paths, label)}
          onDiscardFile={(path, isUntracked) => void handleDiscardChanges(path, isUntracked)}
          onDiscardEntries={(entries, label) => void handleDiscardEntries(entries, label)}
          onCopyText={(text) => void copyText(text)}
          onBeginResize={(clientX) => beginSplitDrag("changes", clientX)}
        />
      ) : null}

      {rightPaneTab === "skills" ? (
        <AgentSkillsMarketPanel
          groups={groupedAgentSkills}
          skills={agentSkills}
          skillsLoading={agentSkillsLoading}
          skillsError={agentSkillsError}
          removingKey={agentSkillRemovingKey}
          skillBusy={agentSkillBusy}
          skillInstallingSpec={agentSkillInstallingSpec}
          skillInstallNotice={agentSkillInstallNotice}
          skillInstallLog={agentSkillInstallLog}
          marketListRef={agentSkillMarketListRef}
          searchQuery={agentSkillSearchQuery}
          searchResults={agentSkillSearchResults}
          catalogView={agentSkillCatalogView}
          searchMeta={agentSkillSearchMeta}
          selectedMarketplaceSkill={selectedMarketplaceSkill}
          marketplaceRows={agentMarketplaceRows}
          visibleMarketplaceRows={visibleAgentMarketplaceRows}
          initialLoading={agentSkillsInitialLoading}
          searching={agentSkillsSearching}
          paging={agentSkillsPaging}
          onSearchQueryChange={setAgentSkillSearchQuery}
          onSearch={() => void searchAgentSkillRegistry()}
          onSwitchCatalogView={switchAgentSkillCatalogView}
          onRefreshSkills={() => void refreshAgentSkills()}
          onScrollMarket={handleAgentSkillMarketScroll}
          onSelectMarketplaceSkill={selectMarketplaceSkill}
          onInstallMarketplaceSkill={(spec) => void installAgentSkillFromRegistry(spec, "project")}
          onInstallSelectedMarketplaceSkill={(scope) => {
            if (!selectedMarketplaceSkill) return;
            setShowSkillInstallMenu(false);
            void installAgentSkillFromRegistry(selectedMarketplaceSkill.installSpec || selectedMarketplaceSkill.spec, scope);
          }}
          onReferenceSkill={referenceAgentSkill}
          onRemoveSkill={removeAgentSkill}
          onRemoveSkillGroup={removeAgentSkillGroup}
        />
      ) : null}

      {rightPaneTab === "terminal" ? (
        <TerminalPanel
          tabs={terminalTabs}
          activeTabId={activeTerminalTabId}
          activeTab={activeTerminalTab}
          sidebarVisible={terminalSidebarVisible}
          theme={theme}
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
          onInput={sendTerminalData}
          onResize={async (tabId, cols, rows) => {
            if (!selectedRepo) return;
            try {
              await resizeRepoTerminalSession(selectedRepo.path, cols, rows, tabId);
            } catch {
              // 面板隐藏或 tty 未就绪时忽略
            }
          }}
        />
      ) : null}

      <RemoteRepoFormDialog
        open={remoteRepoFormTarget !== undefined}
        repo={remoteRepoFormTarget || null}
        busy={remoteRepoMutationBusy}
        error={remoteRepoMutationError}
        onOpenChange={(open) => {
          if (!open && !remoteRepoMutationBusy) {
            setRemoteRepoFormTarget(undefined);
            setRemoteRepoMutationError("");
          }
        }}
        onSubmit={(values) => void submitRemoteRepoForm(values)}
      />
      <RemoteRepoRemoveDialog
        repo={remoteRepoPendingRemoval}
        busy={remoteRepoMutationBusy}
        onOpenChange={(open) => {
          if (!open && !remoteRepoMutationBusy) setRemoteRepoPendingRemoval(null);
        }}
        onConfirm={() => void confirmRemoteRepoRemoval()}
      />
    </RightSidebarPanel>
  );

  const rightSidebarPanel = (
    <RightSidebar
      openTabs={rightOpenTabs}
      activeTab={rightPaneTab}
      tabLabels={{
        changes: appText.changes,
        worktree: appText.worktree,
        terminal: appText.terminal,
        remoteRepos: "远程仓库",
        skills: appText.skills,
        browser: "浏览器",
        assetGraph: "记忆",
      }}
      fileTabLabel={standaloneRightFileTab?.label}
      closeFileLabel={appText.closeFileView}
      closeTabLabel={appText.close}
      onSelectTab={selectRightPaneTab}
      onCloseTab={closeRightPaneTab}
      onCloseFileTab={closeRightFileView}
    >
      {rightPane}
    </RightSidebar>
  );

  const centerColClass = cn(
    "wb-col wb-col-center min-h-0 min-w-0 flex-1 overflow-hidden"
  );
  const editorShellClass = cn(
    "wb-editor-inner flex min-h-0 flex-1 flex-col overflow-hidden"
  );

  const editor = mainMode === "automation" ? (
    <motion.div
      key="automation-editor"
      className={editorShellClass}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
    >
      <AutomationView
        repos={repos}
        getRepoSessions={getVisibleRepoSessions}
        ensureRepoSessions={(repo) => {
          if (hasLoadedSidebarRepoSessions(repo.id) || isRepoSessionsLoading(repo.id)) return;
          void refreshSidebarRepoSessions(repo).catch((e) => setError(String(e)));
        }}
        onOpenImportProject={() => openAddProjectDialog()}
        modelOptions={agentConfiguredModelCandidates.map((ref) => {
          const slash = ref.indexOf("/");
          const provider = slash >= 0 ? ref.slice(0, slash) : "";
          const modelId = slash >= 0 ? ref.slice(slash + 1) : ref;
          const display = getAgentModelDisplay(ref);
          return {
            ref,
            label: display.label || ref,
            provider,
            modelId,
          };
        })}
        modelInfoByRef={agentModelInfoByRef}
      />
    </motion.div>
  ) : (
    <div
      className={editorShellClass}
      style={{ containerType: "inline-size", "--chat-content-left": CHAT_CONTENT_LEFT_CSS } as CSSProperties}
    >
      {/* 标题消费 editor 列上的 --chat-content-left（与消息流同源），侧栏收放时即时跟随、与内容列同步。
          关键：container-type 必须挂在无 padding 的 editor 列——cqw 基于 query container 的 content-box，
          若挂在标题自身（其 paddingLeft 正是该 calc）会形成循环依赖、解不出值，标题就追不上内容区
          （「侧栏收起后标题没跟过去」）。editor 列无 padding，100cqw = available，无循环。 */}
      <div className="shrink-0" style={{ paddingLeft: "var(--chat-content-left)" }}>
        <EditorSessionHeader
          title={activeAgentSession?.title || (draftAgentSession ? appText.newSession : "会话摘要")}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={centerColClass}>{centerPane}</div>
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
    normalizeControlAuthMode(controlServerSettings.authMode) === "none" ||
    normalizeControlPairMode(controlAccessInfo?.pairCodeTtlMode || controlServerSettings.pairCodeTtlMode) === "none";
  const controlPairPayload = controlBaseUrl
    ? JSON.stringify({
      baseUrl: controlBaseUrl,
      authMode: controlAuthNoAuth ? "none" : "pair_code",
      ...(controlAuthNoAuth ? {} : { pairCode: controlPairCode })
    })
    : "";
  const controlServiceEnabled = controlServerSettings.enabled;
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
  const agentProviderPickerModelCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const provider of agentProviderPickerCandidates) {
      out[provider] = (agentModelsByProvider[provider] || []).length;
    }
    return out;
  }, [agentProviderPickerCandidates, agentModelsByProvider]);

  async function saveAgentCustomProvider() {
    try {
      setAgentProviderConfigBusy(true);
      setAgentConfigBusy(true);
      const pid = agentProviderConfig.provider.trim();
      const mid = agentSelectedModel.trim();
      const full = `${pid}/${mid}`;
      const key = agentProviderConfig.apiKey?.trim() || "";
      const baseUrl = normalizeOpenAICompatibleBaseUrl(agentProviderConfig.baseUrl);
      // pi：自定义 provider 写入 models.json（原子写，按 model id 合并），
      // api key 只进 vault（auth.json），不落任何配置文件（迁移计划 §8.3）。
      await agentClient.saveCustomProvider({
        provider: pid,
        name: agentProviderConfig.name || pid,
        baseUrl,
        api: agentProviderConfig.api || "openai-completions",
        headers: agentProviderConfig.headers || {},
        modelId: mid,
        modelName: mid,
        apiKey: key || undefined
      });
      // 保存即选中：当前模型是客户端选择状态（draft 选择 + 记忆列表）。
      selectAgentDraftModel(full);
      // 自定义 provider 同样尽力拉实时模型列表，补全目录。
      if (key) {
        const added = (await agentClient.refreshProviderModels(pid).catch(() => [] as string[])) ?? [];
        if (added.length) {
          appendAgentDebugLog(`自定义供应商模型已更新: ${pid} +${added.length}`);
        }
      }
      setAgentModelProvider(pid);
      setAgentSelectedModel(mid);
      await refreshAgentServerConfig({ syncSelection: false, includeCurrentModel: false });
      await refreshAgentConfiguredModels();
      await fetchAgentModels(pid).catch(() => [] as string[]);
      ensureProviderExists(pid);
      setShowAgentCustomProvider(false);
      setShowAgentModelPicker(true);
      setAgentModelPickerSearch("");
      setMessage(`Saved configuration: ${full}`);
    } catch (e) {
      setError(String(e));
      setMessage("Save configuration failed");
    } finally {
      setAgentConfigBusy(false);
      setAgentProviderConfigBusy(false);
    }
  }

  function resolveProviderBaseUrlHint(providerId: string): string {
    const pid = providerId.trim();
    if (!pid) return "";
    const modelId = (agentModelsByProvider[pid] || [])[0] || "";
    const info = modelId
      ? (agentModelInfoByRef[`${pid}/${modelId}`]
        || Object.values(agentModelInfoByRef).find((row) => row.provider === pid && row.modelId === modelId))
      : Object.values(agentModelInfoByRef).find((row) => row.provider === pid);
    const saved = (info?.baseUrl || "").trim();
    // 内置供应商：已保存的自定义端点可回填便于更新；OAuth 原生未配置时只提示官方地址。
    if (isOAuthNativeApiLockedProvider(pid)) {
      if (saved && !/chatgpt\.com|api\.openai\.com/i.test(saved)) return saved;
      return pid === "openai-codex" ? "https://chatgpt.com/backend-api/codex" : "";
    }
    if (saved) return saved;
    const preset = PROVIDER_PRESETS.find((row) => row.id === pid)?.defaultBaseUrl?.trim();
    if (preset) return preset;
    // 自定义 openai-compatible 实例：placeholder 不展示已保存地址（编辑时由输入框回填）。
    if (isOpenAICompatibleProviderId(pid)) return "";
    return "";
  }

  async function submitAgentProviderAuthKey(
    providerId: string,
    connected: boolean,
    options?: { closeDialog?: boolean; closeInlineAuth?: boolean }
  ) {
    const authPid = providerId.trim();
    const key = agentConnectApiKey.trim();
    const endpoint = agentConnectBaseUrl.trim();
    if (!authPid || !key) return;
    const isOpenAICompatible = isOpenAICompatibleProviderId(authPid);
    const customName = agentConnectCustomName.trim();
    if (isOpenAICompatible && !endpoint) {
      setError("自定义端点需要填写 Base URL");
      setMessage("请填写 Base URL");
      return;
    }
    if (isOpenAICompatible && !customName) {
      setError("请填写供应商名称，便于在已配置模型列表中区分");
      setMessage("请填写供应商名称");
      return;
    }
    setAgentConnectBusy(true);
    setError("");
    try {
      if (isOpenAICompatible) {
        const baseUrl = normalizeOpenAICompatibleBaseUrl(endpoint) || endpoint;
        const result = await agentClient.connectOpenAICompatible({
          baseUrl,
          apiKey: key,
          name: customName,
          provider: authPid !== OPENAI_COMPATIBLE_PROVIDER_ID ? authPid : undefined
        });
        const instanceId = result.provider || authPid;
        const instanceName = result.name || customName;
        setAgentConnectedProviders((prev) => (
          prev.includes(instanceId)
            ? prev
            : [...prev, instanceId].sort((a, b) => a.localeCompare(b))
        ));
        setAgentProviderNames((prev) => ({
          ...prev,
          [instanceId]: instanceName
        }));
        ensureProviderExists(instanceId);
        setAgentConnectApiKey("");
        setAgentConnectBaseUrl("");
        setAgentConnectCustomName("");
        if (options?.closeDialog) setShowAgentAuthDialogFor("");
        if (options?.closeInlineAuth) setAgentInlineAuthOpenFor("");
        setMessage(connected
          ? `已更新 ${instanceName}（${result.added.length} 个模型）`
          : `已连接 ${instanceName}（${result.added.length} 个模型）`);
        appendAgentDebugLog(
          `openai-compatible connected provider=${instanceId} models=${result.added.length}`
        );
        await refreshAgentServerConfig({ syncSelection: false, includeCurrentModel: false }).catch(() => undefined);
        await refreshAgentConnectedProvidersOnly();
        await fetchAgentModels(instanceId).catch(() => [] as string[]);
        setAgentProviderPickerProvider(instanceId);
        return;
      }

      // 内置供应商（含 openai-codex）：原地保存 key / 更新端点，不另存为自定义供应商。
      await agentClient.saveApiKey(authPid, key);
      if (endpoint) {
        await agentClient.updateProviderEndpoint(
          authPid,
          normalizeOpenAICompatibleBaseUrl(endpoint) || endpoint
        );
      }
      // 先乐观更新「已连接」，避免后续 listProviders/refresh 慢或失败时 UI 仍停在未连接。
      setAgentConnectedProviders((prev) => (prev.includes(authPid) ? prev : [...prev, authPid].sort((a, b) => a.localeCompare(b))));
      ensureProviderExists(authPid);
      // 密钥一写入就收起编辑区/对话框并清空输入，不要等后面的模型刷新（最长约 8s）。
      setAgentConnectApiKey("");
      setAgentConnectBaseUrl("");
      setAgentConnectCustomName("");
      if (options?.closeDialog) {
        setShowAgentAuthDialogFor("");
      }
      if (options?.closeInlineAuth) {
        setAgentInlineAuthOpenFor("");
      }
      setMessage(connected ? `已更新连接: ${authPid}` : `已连接: ${authPid}`);
      // 实时模型刷新不得阻塞/回滚连接成功：部分 provider（含 kimi-coding）拉 /v1/models 可能很慢或失败。
      try {
        const addedModels = (await Promise.race([
          agentClient.refreshProviderModels(authPid).catch(() => [] as string[]),
          new Promise<string[]>((resolve) => window.setTimeout(() => resolve([]), 12000))
        ])) ?? [];
        if (addedModels.length) {
          appendAgentDebugLog(`实时模型目录已更新: ${authPid} +${addedModels.length} (${addedModels.join(", ")})`);
        } else {
          appendAgentDebugLog(`实时模型目录无新增: ${authPid}（可能已是最新，或端点暂不可用）`);
        }
        await refreshAgentServerConfig({ syncSelection: false, includeCurrentModel: false }).catch(() => undefined);
        await refreshAgentConnectedProvidersOnly();
        const confirmed = await agentClient.hasCredential(authPid).catch(() => true);
        if (!confirmed) {
          throw new Error("密钥写入后未能确认凭据，请重试或检查 Giteam auth.json 权限");
        }
        setAgentConnectedProviders((prev) => (prev.includes(authPid) ? prev : [...prev, authPid].sort((a, b) => a.localeCompare(b))));
        // 首次连接后无论静态目录是否已有条目，都强制刷新 UI 模型列表（否则会停在过期快照）。
        await fetchAgentModels(authPid).catch(() => [] as string[]);
      } catch (refreshError) {
        const detail = String(refreshError);
        appendAgentDebugLog(`连接后模型刷新异常（连接已保留）: ${detail}`);
        if (/凭据|credential|auth\.json|权限|unauthorized|401|403/i.test(detail)) {
          setError(`已连接，但凭据确认失败：${detail}`);
        } else {
          setError(`已连接，但拉取最新模型失败：${detail}`);
        }
      }
      setAgentProviderPickerProvider(authPid);
    } catch (e) {
      setError(String(e));
      setMessage(connected ? "更新连接失败" : "连接失败");
    } finally {
      setAgentConnectBusy(false);
    }
  }

  async function saveAgentAuthKey(providerId: string) {
    await submitAgentProviderAuthKey(providerId, true, { closeDialog: true });
  }

  const panel = rightSidebarPanel;

  const shellToggles = (
    <div className="pointer-events-none fixed inset-0 z-[1001]" aria-label="布局显隐控制">
      <ShellPanelToggle
        side="left"
        className="pointer-events-auto fixed top-2.5 z-[1001]"
        style={{ left: TITLEBAR_LEFT_TOGGLE_X }}
        title={leftDrawerOpen ? appText.collapseSidebar : appText.expandSidebar}
        onClick={() => setLeftDrawerOpen((open) => !open)}
      />
      <ShellPanelToggle
        side="right"
        className="pointer-events-auto fixed top-2.5 right-3 z-[1001]"
        title={rightDrawerOpen ? appText.collapseRightSidebar : appText.expandRightSidebar}
        onClick={toggleRightDrawer}
      />
    </div>
  );

  return (
    <AppErrorBoundary>
      <>
        {shellToggles}
        <SidebarProvider
          open={leftDrawerOpen}
          onOpenChange={setLeftDrawerOpen}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
        >
          <Workbench
            activityBar={activityBar}
            sideBar={sideBar}
            editor={editor}
            panel={panel}
            sidebarWidth={sidebarWidth}
            rightPanelWidth={rightPaneWidth}
            sidebarCollapsed={!leftDrawerOpen}
            sidebarResizing={draggingSplit?.kind === "sidebar"}
            rightPanelResizing={draggingSplit?.kind === "right"}
            onSidebarResizeStart={(e) => {
              e.preventDefault();
              beginSplitDrag("sidebar", e.clientX);
            }}
            onRightPanelResizeStart={(e) => {
              e.preventDefault();
              beginSplitDrag("right", e.clientX);
            }}
            panelPlacement={panelPlacement}
          />
        </SidebarProvider>

        <Dialog
          open={overlayBusy}
          onOpenChange={(open) => {
            if (open) return;
            setOverlayBusy(false);
            setBusy(false);
            setMessage("");
          }}
        >
          <DialogContent className="w-[min(420px,calc(100vw-32px))]">
            <Card role="status" aria-live="polite" className="shadow-none">
              <CardHeader className="text-center">
                <DialogTitle asChild>
                  <CardTitle>{message || "Loading..."}</CardTitle>
                </DialogTitle>
                <DialogDescription>
                  The current operation is still running. You can dismiss this status layer and continue.
                </DialogDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Skeleton className="h-2 w-full" aria-hidden="true" />
                <Skeleton className="mx-auto h-2 w-2/3" aria-hidden="true" />
              </CardContent>
              <CardFooter className="justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOverlayBusy(false);
                    setBusy(false);
                    setMessage("");
                  }}
                >
                  Dismiss
                </Button>
              </CardFooter>
            </Card>
          </DialogContent>
        </Dialog>
        <Dialog
          open={Boolean(commitDialogAction)}
          onOpenChange={(open) => {
            if (!open && !committing && !pushing) {
              setCommitDialogSubmitting(false);
              setCommitDialogAction(null);
            }
          }}
        >
          <DialogContent
            className="w-[min(440px,calc(100vw-36px))] rounded-[28px] p-5"
            overlayClassName="bg-background/55 [backdrop-filter:none]"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => {
                const textarea = commitMessageInputRef.current;
                if (!textarea) return;
                textarea.focus({ preventScroll: true });
                const end = textarea.value.length;
                textarea.setSelectionRange(end, end);
              });
            }}
            onEscapeKeyDown={(event) => {
              if (commitDialogSubmitting || committing || pushing) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (commitDialogSubmitting || committing || pushing) event.preventDefault();
            }}
          >
            <motion.div
              className="relative flex flex-col gap-4"
              initial={{ opacity: 0, scale: 0.965, y: 10 }}
              animate={{
                opacity: commitDialogSubmitting ? 0.75 : 1,
                scale: commitDialogSubmitting ? 0.985 : 1,
                y: 0
              }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <DialogClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 size-7 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground [&_svg]:size-3.5"
                  disabled={commitDialogSubmitting || committing || pushing}
                  aria-label="关闭提交弹窗"
                >
                  <CloseIcon />
                </Button>
              </DialogClose>
              <DialogHeader className="gap-2 pr-10">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {commitDialogAction === "commitPush"
                    ? "PUSH"
                    : commitDialogAction === "commitSync"
                      ? "CREATE PR"
                      : "COMMIT"}
                </span>
                <DialogTitle className="text-xl font-semibold leading-tight tracking-normal">提交更改</DialogTitle>
              </DialogHeader>
              <div className="grid gap-1.5 text-[14px]">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-muted-foreground">分支</span>
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {worktreeOverview.branch || selectedBranch || "main"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-muted-foreground">更改</span>
                  <span className="flex min-w-0 flex-wrap items-center justify-end gap-2.5 tabular-nums">
                    <span className="text-muted-foreground">{worktreeChangeStats.total} 个文件</span>
                    <span className="font-medium text-emerald-600">+{worktreeOverview.addedLines}</span>
                    <span className="font-medium text-rose-600">-{worktreeOverview.deletedLines}</span>
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <Field className="gap-2">
                  <FieldLabel className="text-[14px]">提交消息</FieldLabel>
                  <Textarea
                    ref={commitMessageInputRef}
                    className="min-h-20 rounded-2xl border-border/70 bg-background px-3 py-2.5 text-[14px] leading-6 shadow-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/20"
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder="输入提交消息"
                    disabled={commitDialogSubmitting || committing || pushing}
                    autoFocus
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 pt-0.5">
                <DialogClose asChild>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-9 rounded-full px-4 text-[14px] font-semibold text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    disabled={commitDialogSubmitting || committing || pushing}
                  >
                    取消
                  </Button>
                </DialogClose>
                <Button
                  variant="contrast"
                  size="lg"
                  className="h-9 min-w-32 rounded-full px-5 text-[14px] font-semibold shadow-none transition-[background-color,color,transform,opacity] duration-150 active:scale-[0.98]"
                  disabled={commitDialogSubmitting || committing || pushing}
                  onClick={() => {
                    const action = commitDialogAction;
                    if (!action || commitDialogSubmitting) return;
                    setCommitDialogSubmitting(true);
                    window.setTimeout(() => {
                      setCommitDialogAction(null);
                      setCommitDialogSubmitting(false);
                      if (action === "commitPush") void handleGitCommitAndPush();
                      else if (action === "commitSync") void handleGitCommitAndSync();
                      else void handleGitCommit();
                    }, 150);
                  }}
                >
                  {commitDialogSubmitting || committing || pushing
                    ? "提交中..."
                    : commitDialogAction === "commitPush"
                      ? "Commit & Push"
                      : commitDialogAction === "commitSync"
                        ? "Commit & Create PR"
                        : "Commit"}
                </Button>
              </div>
            </motion.div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showTopologyCreateDialog}
          onOpenChange={(open) => {
            if (!creatingTopologyNode && !open) setShowTopologyCreateDialog(false);
          }}
        >
          <DialogContent className="w-[min(560px,calc(100vw-32px))]">
            <Card className="shadow-none">
              <CardHeader>
                <DialogTitle asChild>
                  <CardTitle>{topologyCreateMode === "worktree" ? "基于分支创建工作空间" : "从分支拉新分支"}</CardTitle>
                </DialogTitle>
                <DialogDescription>
                  {topologyCreateMode === "worktree"
                    ? "会在来源分支或 commit 下创建一个独立 worktree 目录，不会额外创建子分支。"
                    : "从来源分支创建新分支，创建后会选中新分支。"}
                </DialogDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Card className="shadow-none">
                  <CardContent className="flex items-center justify-between gap-4 p-3">
                    <span className="text-sm font-medium text-muted-foreground">
                      {topologyCreateSourceNodeId.startsWith("commit:") ? "来源 Commit" : "来源分支"}
                    </span>
                    <Badge variant="outline" className="max-w-full truncate">
                      {topologyCreateSourceNodeId.startsWith("commit:") ? shortSha(topologyCreateSource(topologyCreateSourceNodeId).startPoint, 10) : topologyCreateSourceNode?.branch || topologyCreateSourceNode?.label || currentTopologyBaseBranch() || "-"}
                    </Badge>
                  </CardContent>
                </Card>
                <Field>
                  <FieldLabel>{topologyCreateMode === "worktree" ? "工作空间目录名" : "新分支名"}</FieldLabel>
                  <Input
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
                </Field>
                {topologyCreateMode === "worktree" ? (
                  <Field>
                    <FieldLabel>目标目录</FieldLabel>
                    <Input
                      value={topologyCreateTargetPath}
                      onChange={(e) => setTopologyCreateTargetPath(e.target.value)}
                      placeholder="留空则自动生成"
                    />
                  </Field>
                ) : null}
              </CardContent>
              <CardFooter className="justify-end">
                <DialogClose asChild>
                  <Button variant="outline" disabled={creatingTopologyNode}>取消</Button>
                </DialogClose>
                <Button variant="default" onClick={() => void submitTopologyCreateDialog()} disabled={creatingTopologyNode || !topologyCreateBranchName.trim()}>
                  {topologyCreateMode === "worktree" ? "创建工作空间" : "创建分支"}
                </Button>
              </CardFooter>
            </Card>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showTopologyInspectDialog && Boolean(topologyInspectNode)}
          onOpenChange={(open) => {
            if (!open) setShowTopologyInspectDialog(false);
          }}
        >
          {topologyInspectNode ? (
            <DialogContent className="w-[min(680px,calc(100vw-32px))]">
              <Card className="shadow-none">
                <CardHeader>
                  <DialogTitle asChild>
                    <CardTitle>{topologyInspectNode.label}</CardTitle>
                  </DialogTitle>
                  <DialogDescription>{topologyInspectNode.kind}</DialogDescription>
                </CardHeader>
                <CardContent className="flex max-h-[min(72vh,760px)] flex-col gap-4 overflow-auto">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Card className="shadow-none"><CardContent className="p-3"><span className="text-xs text-muted-foreground">Branch</span><strong className="block truncate text-sm">{topologyInspectNode.branch || worktreeOverview.branch || "-"}</strong></CardContent></Card>
                    <Card className="shadow-none"><CardContent className="p-3"><span className="text-xs text-muted-foreground">Commit</span><strong className="block truncate text-sm">{topologyInspectNode.sha ? shortSha(topologyInspectNode.sha) : shortSha(selectedCommit || commits[0]?.sha || "")}</strong></CardContent></Card>
                    <Card className="shadow-none"><CardContent className="p-3"><span className="text-xs text-muted-foreground">Status</span><strong className="block truncate text-sm">{topologyInspectNode.kind === "commit" ? "history" : topologyInspectNode.dirtyCount ? `dirty ${topologyInspectNode.dirtyCount}` : worktreeOverview.clean ? "clean" : "dirty"}</strong></CardContent></Card>
                    <Card className="shadow-none"><CardContent className="p-3"><span className="text-xs text-muted-foreground">Ahead / Behind</span><strong className="block truncate text-sm">{worktreeOverview.ahead} / {worktreeOverview.behind}</strong></CardContent></Card>
                  </div>
                  <Card className="shadow-none">
                    <CardContent className="flex flex-col gap-2 p-3">
                      {topologyInspectNode.path ? <div className="flex items-start justify-between gap-4 text-sm"><span className="text-muted-foreground">Path</span><strong className="min-w-0 break-all text-right font-medium">{topologyInspectNode.path}</strong></div> : null}
                      {topologyInspectNode.author ? <div className="flex items-start justify-between gap-4 text-sm"><span className="text-muted-foreground">Author</span><strong className="min-w-0 break-words text-right font-medium">{topologyInspectNode.author}</strong></div> : null}
                      {topologyInspectNode.date ? <div className="flex items-start justify-between gap-4 text-sm"><span className="text-muted-foreground">Date</span><strong className="min-w-0 break-words text-right font-medium">{topologyInspectNode.date}</strong></div> : null}
                      {topologyInspectNode.refs?.length ? <div className="flex items-start justify-between gap-4 text-sm"><span className="text-muted-foreground">Refs</span><strong className="min-w-0 break-words text-right font-medium">{topologyInspectNode.refs.join(" · ")}</strong></div> : null}
                      {topologyInspectNode.kind === "commit" && selectedParsed?.hasCheckpoint ? <div className="flex items-start justify-between gap-4 text-sm"><span className="text-muted-foreground">Checkpoint</span><strong className="min-w-0 break-words text-right font-medium">{selectedParsed.checkpointId || "已关联"}</strong></div> : null}
                      {topologyInspectNode.kind === "commit" && selectedParsed?.sessionId ? <div className="flex items-start justify-between gap-4 text-sm"><span className="text-muted-foreground">Session</span><strong className="min-w-0 break-words text-right font-medium">{selectedParsed.sessionId}</strong></div> : null}
                    </CardContent>
                  </Card>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-muted/40 p-3 text-xs text-foreground">{topologyInspectNode.kind === "commit" ? (selectedExplain || "当前 commit 未解析到 Entire agent 上下文。") : (worktreeOverview.raw || "git status -sb")}</pre>
                </CardContent>
              </Card>
            </DialogContent>
          ) : null}
        </Dialog>

        <AlertDialog
          open={showDiscardAllConfirm}
          onOpenChange={(open) => {
            if (!discardingAll && !open) setShowDiscardAllConfirm(false);
          }}
        >
          <AlertDialogContent className="w-[min(460px,calc(100vw-32px))]">
            <Card className="shadow-none">
              <CardHeader>
                <AlertDialogTitle asChild>
                  <CardTitle>撤销全部修改？</CardTitle>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  将撤销 {discardAllCount} 个文件的修改。未跟踪文件会被删除，已跟踪文件会恢复到 HEAD。
                </AlertDialogDescription>
              </CardHeader>
              <CardFooter className="justify-end">
                <AlertDialogCancel asChild>
                  <Button variant="outline" disabled={discardingAll}>取消</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive" onClick={() => void handleDiscardAllChanges()} disabled={discardingAll || discardAllCount === 0}>
                    {discardingAll ? "撤销中..." : "确认撤销"}
                  </Button>
                </AlertDialogAction>
              </CardFooter>
            </Card>
          </AlertDialogContent>
        </AlertDialog>

        {worktreeContextMenu ? (
          <FloatingContextMenu
            open={Boolean(worktreeContextMenu)}
            x={worktreeContextMenu.x}
            y={worktreeContextMenu.y}
            onOpenChange={(open) => {
              if (!open) setWorktreeContextMenu(null);
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                setWorktreeToRemove(worktreeContextMenu.path);
                setShowRemoveWorktreeConfirm(true);
                setWorktreeContextMenu(null);
              }}
            >
              {appText.removeWorktree}
            </DropdownMenuItem>
          </FloatingContextMenu>
        ) : null}

        <AlertDialog
          open={showRemoveWorktreeConfirm}
          onOpenChange={(open) => {
            if (!removingWorktreePath && !open) {
              setShowRemoveWorktreeConfirm(false);
              setWorktreeToRemove("");
            }
          }}
        >
          <AlertDialogContent className="w-[min(460px,calc(100vw-32px))]">
            <Card className="shadow-none">
              <CardHeader>
                <AlertDialogTitle asChild>
                  <CardTitle>{appText.removeWorktreeTitle}</CardTitle>
                </AlertDialogTitle>
                <AlertDialogDescription>{appText.removeWorktreeDesc}</AlertDialogDescription>
              </CardHeader>
              <CardFooter className="justify-end">
                <AlertDialogCancel asChild>
                  <Button variant="outline" disabled={!!removingWorktreePath}>{appText.cancel}</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive" onClick={() => void handleRemoveWorktree(worktreeToRemove)} disabled={!!removingWorktreePath || !worktreeToRemove}>
                    {removingWorktreePath ? appText.removing : appText.confirmRemove}
                  </Button>
                </AlertDialogAction>
              </CardFooter>
            </Card>
          </AlertDialogContent>
        </AlertDialog>

        <SearchPanel
          open={searchPanelOpen}
          onClose={() => setSearchPanelOpen(false)}
          text={appText}
          scope={searchScope}
          onScopeChange={setSearchScope}
          agentClient={agentClient}
          listSessions={() => agentClient.listSessions()}
          currentSessionId={activeAgentSessionId}
          currentSessionTitle={activeAgentSession?.title ?? ""}
          currentSessionUpdatedAt={activeAgentSession?.updatedAt ?? 0}
          currentMessages={agentMessages}
          currentRepoPath={repoPath}
          repos={repos}
          onSelect={handleSearchLocate}
        />

        <AppUpdateWhatsNewDialog
          open={Boolean(updateCelebration) && !showUpdateWizard}
          celebration={updateCelebration}
          text={updateDialogText}
          onClose={() => setUpdateCelebration(null)}
        />
        <AppUpdateMajorWizard
          open={Boolean(updateCelebration) && showUpdateWizard}
          celebration={updateCelebration}
          text={updateDialogText}
          onClose={() => setUpdateCelebration(null)}
        />
        <AppUpdateAvailableDialog
          open={Boolean(updateAvailablePrompt) && !updateCelebration}
          currentVersion={updateAvailablePrompt?.currentVersion || appVersion}
          version={updateAvailablePrompt?.version || ""}
          notes={updateAvailablePrompt?.notes || ""}
          busy={appUpdateState.status === "downloading" || appUpdateState.status === "checking"}
          text={updateDialogText}
          onLater={() => setUpdateAvailablePrompt(null)}
          onInstall={() => {
            if (!updateAvailablePrompt) return;
            void installAppUpdateNow(updateAvailablePrompt);
          }}
        />

        {showSettings ? (
          <SettingsDialog
            theme={theme}
            initialSection={settingsInitialSection}
            runtimeStatus={runtimeStatus}
            onClose={() => void closeSettingsModal()}
            onToggleTheme={toggleTheme}
            onOpenRuntimeSetup={() => {
              setShowEnvSetup(true);
              const unchecked = [runtimeStatus.git, runtimeStatus.entire, runtimeStatus.giteam].some(
                (d) => !d.checked
              );
              if (unchecked) void refreshRuntimeRequirements();
            }}
            onOpenMobileControl={openMobileControlDialog}
            onOpenAgentApi={() => setShowAgentApiDialog(true)}
            onOpenModelManager={() => {
              setAgentProviderPickerProvider(
                parseModelRef(activeAgentModel || "")?.provider || agentModelProvider || ""
              );
              setSettingsInitialSection("models");
              setShowSettings(true);
            }}
            onOpenSkillsMarketplaceSettings={() => {
              void invoke("open_external_url", { url: "https://skillsmp.com/zh/docs/api#authentication" });
            }}
            generalSettings={generalSettings}
            onGeneralSettingsChange={(next) => {
              setGeneralSettings(next);
              saveGeneralSettings(GENERAL_SETTINGS_KEY, AGENT_AUTO_ACCEPT_PERMISSIONS_KEY, next);
              if (next.autoAcceptPermissions !== agentAutoAcceptPermissions) {
                setAgentAutoAcceptPermissions(next.autoAcceptPermissions);
                saveLocalBool(AGENT_AUTO_ACCEPT_PERMISSIONS_KEY, next.autoAcceptPermissions);
                if (activeAgentSessionId) {
                  void ensureSessionAutoAcceptPermissions(activeAgentSessionId, next.autoAcceptPermissions);
                }
              }
            }}
            onCheckAppUpdate={() => {
              void (async () => {
                setAppUpdateState({ status: "checking" });
                const next = await checkAppUpdate();
                setAppUpdateState(next);
                if (next.status !== "available") return;
                if (generalSettings.updatesAutoInstall) {
                  await installAppUpdateNow({
                    currentVersion: next.currentVersion,
                    version: next.version,
                    notes: next.notes
                  });
                  return;
                }
                // 已在设置「关于」页时不叠弹窗，直接在页内下载安装，避免要点两次。
                if (!showSettings) {
                  setUpdateAvailablePrompt({
                    currentVersion: next.currentVersion,
                    version: next.version,
                    notes: next.notes
                  });
                  if (generalSettings.notificationsAgent) {
                    void showSettingsNotification(
                      "Update available",
                      `Giteam ${next.version} is ready to install`
                    );
                  }
                }
              })();
            }}
            onInstallAppUpdate={() => {
              void (async () => {
                const available =
                  appUpdateState.status === "available" || appUpdateState.status === "ready"
                    ? {
                        currentVersion: appUpdateState.currentVersion,
                        version: appUpdateState.version,
                        notes: appUpdateState.notes
                      }
                    : updateAvailablePrompt;
                if (!available) return;
                await installAppUpdateNow(available);
              })();
            }}
            appVersion={appVersion}
            appUpdateState={appUpdateState}
            onReopenUpdateCelebration={reopenUpdateCelebration}
            agentPort={agentServiceSettings.port}
            agentBusy={agentServiceSettingsBusy}
            onAgentPortChange={(port) => setAgentServiceSettings((prev) => ({ ...prev, port }))}
            onSaveAgentApi={() => void saveAgentServiceSettingsIfNeeded()}
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
            uiZoom={uiZoom}
            codeFontSize={codeFontSize}
            onUiZoomChange={setUiZoom}
            onCodeFontSizeChange={setCodeFontSize}
            controlSettings={controlServerSettings}
            controlBusy={controlServerSettingsBusy}
            controlInstalled={true}
            onControlSettingsChange={(next) => setControlServerSettings((prev) => ({ ...prev, ...next }))}
            onSaveControlSettings={() => void saveControlServerSettingsIfNeeded()}
            controlConnectionUrl={controlBaseUrl}
            controlPairCode={controlPairCode}
            controlPairQrUrl={controlPairQrUrl}
            controlListeningPort={
              mobileServiceStatus?.listeningPort
              || controlAccessInfo?.port
              || 0
            }
            controlPortRemapped={Boolean(
              mobileServiceStatus?.portRemapped
              || (
                controlAccessInfo?.preferredPort
                && controlAccessInfo.port
                && controlAccessInfo.preferredPort !== controlAccessInfo.port
              )
            )}
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
            remoteRepoServiceUrl={remoteRepoServiceSetting.effectiveUrl}
            remoteRepoServiceDraft={remoteRepoServiceDraft}
            remoteRepoServiceApiKeyDraft={remoteRepoServiceApiKeyDraft}
            remoteRepoServiceBusy={remoteRepoServiceBusy}
            remoteRepoServiceNotice={remoteRepoServiceNotice}
            onRemoteRepoServiceDraftChange={setRemoteRepoServiceDraft}
            onRemoteRepoServiceApiKeyDraftChange={setRemoteRepoServiceApiKeyDraft}
            onTestRemoteRepoService={() => void testConfiguredRemoteRepoService()}
            onSaveRemoteRepoService={() => void saveConfiguredRemoteRepoService()}
            onResetRemoteRepoService={() => {
              setRemoteRepoServiceDraft("");
              setRemoteRepoServiceApiKeyDraft("");
              void saveConfiguredRemoteRepoService("", "");
            }}
            runtimeChecking={runtimeChecking}
            checkingDeps={checkingDeps}
            installingDep={installingDep}
            installingElapsed={installingElapsed}
            runtimeJob={runtimeJob}
            onRunDependencyAction={(name, action) => void runDependencyAction(name, action, { showRuntimePanel: false })}
            onRefreshRuntime={() => void refreshRuntimeRequirements()}
            skillsContent={settingsSkillsContent}
            skillsLoading={agentSkillsLoading}
            onRefreshSkills={() => void refreshAgentSkills()}
            onSkillsVisible={() => {
              if (agentSkillsRepoPathRef.current !== repoPath) {
                agentSkillsRepoPathRef.current = repoPath;
                const cached = restoreCachedSkillsForRepo(repoPath);
                if (!cached) scheduleAfterInteraction(() => void refreshAgentSkills(), 220);
                return;
              }
              if (!agentSkillsLoading && !agentSkillsLoadedOnce) scheduleAfterInteraction(() => void refreshAgentSkills(), 220);
            }}
            modelsContent={(
              <AgentProviderSettingsPanel
                providerSearch={agentProviderPickerSearch}
                modelSearch={agentProviderPickerModelSearch}
                providers={agentProviderPickerCandidates}
                selectedProvider={agentProviderPickerProvider}
                connectedProviders={agentConnectedProviders}
                providerNames={agentProviderNames}
                modelCountsByProvider={agentProviderPickerModelCounts}
                modelsByProvider={agentModelsByProvider}
                configuredModelsByProvider={agentConfiguredModelsByProvider}
                configuredModelNamesByProvider={agentConfiguredModelNamesByProvider}
                modelNamesByProvider={agentModelNamesByProvider}
                activeModel={activeAgentModel}
                hiddenModels={agentHiddenModels}
                enabledModels={agentEnabledModels}
                connectBusy={agentConnectBusy}
                connectProviderId={agentConnectProviderId}
                connectApiKey={agentConnectApiKey}
                connectBaseUrl={agentConnectBaseUrl}
                connectName={agentConnectCustomName}
                inlineAuthOpenFor={agentInlineAuthOpenFor}
                onProviderSearchChange={setAgentProviderPickerSearch}
                onModelSearchChange={setAgentProviderPickerModelSearch}
                onSelectProvider={(provider, connected) => {
                  setAgentProviderPickerProvider(provider);
                  const pretty = resolveProviderDisplayName(provider);
                  setAgentConnectProviderId(provider);
                  setAgentConnectProviderName(pretty);
                  setAgentInlineAuthOpenFor(connected ? "" : provider);
                  // agentConnectApiKey 是全局单一 state：切换查看的 provider 时必须清空，
                  // 否则上一个 provider（如 zai）输入的 key 会残留并显示到当前 provider
                  // （如 kimi-coding）的编辑框，点保存即把 key 错写到别的 provider。
                  setAgentConnectApiKey("");
                  setAgentConnectBaseUrl(
                    isOpenAICompatibleProviderId(provider) && provider !== OPENAI_COMPATIBLE_PROVIDER_ID
                      ? resolveProviderBaseUrlHint(provider)
                      : ""
                  );
                  setAgentConnectCustomName(
                    isOpenAICompatibleProviderId(provider) && provider !== OPENAI_COMPATIBLE_PROVIDER_ID
                      ? (agentProviderNames[provider] || pretty)
                      : ""
                  );
                }}
                onConnectApiKeyChange={(providerId, providerName, value) => {
                  setAgentConnectProviderId(providerId);
                  setAgentConnectProviderName(providerName);
                  setAgentConnectApiKey(value);
                }}
                onConnectBaseUrlChange={(providerId, providerName, value) => {
                  setAgentConnectProviderId(providerId);
                  setAgentConnectProviderName(providerName);
                  setAgentConnectBaseUrl(value);
                }}
                onConnectNameChange={(providerId, providerName, value) => {
                  setAgentConnectProviderId(providerId);
                  setAgentConnectProviderName(providerName);
                  setAgentConnectCustomName(value);
                }}
                resolveProviderBaseUrlHint={resolveProviderBaseUrlHint}
                onToggleInlineAuth={(providerId, providerName) => {
                  setAgentConnectProviderId(providerId);
                  setAgentConnectProviderName(providerName);
                  setAgentInlineAuthOpenFor((prev) => prev === providerId ? "" : providerId);
                  // 展开/收起密钥编辑时清空输入，杜绝上一个 provider 的 key 残留串到当前 provider。
                  setAgentConnectApiKey("");
                  setAgentConnectBaseUrl(
                    isOpenAICompatibleProviderId(providerId) ? resolveProviderBaseUrlHint(providerId) : ""
                  );
                  setAgentConnectCustomName(
                    isOpenAICompatibleProviderId(providerId)
                      ? (agentProviderNames[providerId] || providerName)
                      : ""
                  );
                }}
                onConnectProvider={(providerId, connected) =>
                  void submitAgentProviderAuthKey(providerId, connected, {
                    // 首次连接成功后收起密钥区，露出模型列表；更新密钥时同样收起。
                    closeInlineAuth: true
                  })
                }
                onRemoveCustomProvider={(providerId) => {
                  void removeAgentCustomProvider(providerId);
                }}
                removingProvider={agentDisconnectingProvider}
                onSelectModel={(ref) => void applyAgentModel(ref)}
                onHideModel={hideAgentModel}
                onEnableModel={enableAgentModel}
                getProviderTag={getAgentProviderTag}
                canRemoveCustomProvider={(providerId) =>
                  canRemoveAgentCustomProvider(providerId, agentProviderSourceById)
                }
                getProviderDisplayName={resolveProviderDisplayName}
              />
            )}
          />
        ) : null}

        {showMobileControlDialog ? (
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
            onAuthModeChange={(mode) => setControlServerSettings((prev) => ({
              ...prev,
              authMode: mode,
              pairCodeTtlMode: mode === "none"
                ? "none"
                : (normalizeControlPairMode(prev.pairCodeTtlMode) === "none" ? "24h" : normalizeControlPairMode(prev.pairCodeTtlMode))
            }))}
            onPairModeChange={(mode) => setControlServerSettings((prev) => ({ ...prev, pairCodeTtlMode: normalizeControlPairMode(mode) === "none" ? prev.pairCodeTtlMode : normalizeControlPairMode(mode) }))}
            onRefreshCode={() => {
              void forceRefreshControlPairCode();
              void loadControlAccessInfo();
            }}
            onCopiedUrl={() => setMessage("Control server URL copied")}
          />
        ) : null}

        <MobilePairQrDialog
          open={showMobilePairQr}
          onOpenChange={setShowMobilePairQr}
          localQrUrl={controlPairQrUrl}
          localBaseUrl={controlBaseUrl}
          localPairCode={controlPairCode}
          localEnabled={controlServiceEnabled}
          localNoAuth={controlAuthNoAuth}
          onOpenServiceSettings={() => {
            setSettingsInitialSection("mobile");
            setShowSettings(true);
          }}
        />

        {showSkillsmpSettings ? (
          <Dialog open onOpenChange={(open) => {
            if (!open) setShowSkillsmpSettings(false);
          }}>
            <DialogContent className="max-w-lg">
              <div className="grid gap-4">
                <DialogHeader className="flex-row items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <Badge variant="outline" className="w-fit normal-case tracking-normal">SkillsMP</Badge>
                    <DialogTitle>配置 API Key</DialogTitle>
                    <DialogDescription>关键词搜索可匿名使用；AI 语义搜索和更高额度需要 API Key。</DialogDescription>
                  </div>
                  <DialogClose asChild>
                    <Button variant="ghost" size="icon" aria-label="关闭">
                      <CloseIcon />
                    </Button>
                  </DialogClose>
                </DialogHeader>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">API Key</span>
                  <Input
                    className="h-10 rounded-lg"
                    type="password"
                    placeholder="sk_live_skillsmp_..."
                    value={skillsmpApiKeyDraft}
                    onChange={(e) => setSkillsmpApiKeyDraft(e.target.value)}
                    autoFocus
                  />
                </label>
                <DialogFooter>
                  <Button variant="contrast" size="sm" onClick={() => {
                    const next = skillsmpApiKeyDraft.trim();
                    setSkillsmpApiKey(next);
                    saveLocalString(SKILLSMP_API_KEY_STORAGE_KEY, next);
                    setShowSkillsmpSettings(false);
                  }}>
                    保存
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => {
                    setSkillsmpApiKey("");
                    setSkillsmpApiKeyDraft("");
                    saveLocalString(SKILLSMP_API_KEY_STORAGE_KEY, "");
                  }}>
                    清除
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void invoke("open_external_url", { url: "https://skillsmp.com/zh/docs/api#authentication" })}>
                    浏览器获取 API Key
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}

        {showAgentApiDialog ? (
          <AgentApiDialog
            port={agentServiceSettings.port}
            onClose={() => void closeAgentApiDialog()}
            onPortChange={(port) => setAgentServiceSettings((prev) => ({ ...prev, port }))}
          />
        ) : null}

        {showAgentProviderPicker ? (
          <AgentProviderPickerDialog
            loading={agentCatalogLoading}
            providerSearch={agentProviderPickerSearch}
            modelSearch={agentProviderPickerModelSearch}
            providers={agentProviderPickerCandidates}
            selectedProvider={agentProviderPickerProvider}
            connectedProviders={agentConnectedProviders}
            providerNames={agentProviderNames}
            modelCountsByProvider={agentProviderPickerModelCounts}
            modelsByProvider={agentModelsByProvider}
            configuredModelsByProvider={agentConfiguredModelsByProvider}
            configuredModelNamesByProvider={agentConfiguredModelNamesByProvider}
            modelNamesByProvider={agentModelNamesByProvider}
            activeModel={activeAgentModel}
            hiddenModels={agentHiddenModels}
            enabledModels={agentEnabledModels}
            connectBusy={agentConnectBusy}
            connectProviderId={agentConnectProviderId}
            connectApiKey={agentConnectApiKey}
            connectBaseUrl={agentConnectBaseUrl}
            connectName={agentConnectCustomName}
            providerActionMenuFor={agentProviderActionMenuFor}
            disconnectingProvider={agentDisconnectingProvider}
            onClose={() => setShowAgentProviderPicker(false)}
            onOpenCustomProvider={() => {
              setShowAgentProviderPicker(false);
              setShowAgentCustomProvider(true);
            }}
            onProviderSearchChange={setAgentProviderPickerSearch}
            onModelSearchChange={setAgentProviderPickerModelSearch}
            onSelectProvider={(provider, connected) => {
              setAgentProviderPickerProvider(provider);
              const pretty = resolveProviderDisplayName(provider);
              setAgentConnectProviderId(provider);
              setAgentConnectProviderName(pretty);
              setAgentConnectApiKey("");
              setAgentConnectBaseUrl(
                isOpenAICompatibleProviderId(provider) && provider !== OPENAI_COMPATIBLE_PROVIDER_ID
                  ? resolveProviderBaseUrlHint(provider)
                  : ""
              );
              setAgentConnectCustomName(
                isOpenAICompatibleProviderId(provider) && provider !== OPENAI_COMPATIBLE_PROVIDER_ID
                  ? (agentProviderNames[provider] || pretty)
                  : ""
              );
              if (connected) setShowAgentAuthDialogFor("");
            }}
            onConnectApiKeyChange={(providerId, providerName, value) => {
              setAgentConnectProviderId(providerId);
              setAgentConnectProviderName(providerName);
              setAgentConnectApiKey(value);
            }}
            onConnectBaseUrlChange={(providerId, providerName, value) => {
              setAgentConnectProviderId(providerId);
              setAgentConnectProviderName(providerName);
              setAgentConnectBaseUrl(value);
            }}
            onConnectNameChange={(providerId, providerName, value) => {
              setAgentConnectProviderId(providerId);
              setAgentConnectProviderName(providerName);
              setAgentConnectCustomName(value);
            }}
            resolveProviderBaseUrlHint={resolveProviderBaseUrlHint}
            onToggleProviderMenu={(providerId) => setAgentProviderActionMenuFor((prev) => (prev === providerId ? "" : providerId))}
            onOpenAuthDialog={(providerId, providerName) => {
              setAgentConnectProviderId(providerId);
              setAgentConnectProviderName(providerName);
              setAgentConnectApiKey("");
              setAgentConnectBaseUrl(
                isOpenAICompatibleProviderId(providerId) ? resolveProviderBaseUrlHint(providerId) : ""
              );
              setAgentConnectCustomName(
                isOpenAICompatibleProviderId(providerId)
                  ? (agentProviderNames[providerId] || providerName)
                  : ""
              );
              setShowAgentAuthDialogFor(providerId);
              setAgentProviderActionMenuFor("");
            }}
            onConnectProvider={(providerId, connected) =>
              void submitAgentProviderAuthKey(providerId, connected, { closeInlineAuth: true })
            }
            onDisconnectProvider={(providerId) => {
              setAgentProviderActionMenuFor("");
              void disconnectAgentProvider(providerId);
            }}
            onRemoveCustomProvider={(providerId) => {
              setAgentProviderActionMenuFor("");
              void removeAgentCustomProvider(providerId);
            }}
            onSelectModel={(ref) => void applyAgentModel(ref)}
            onHideModel={hideAgentModel}
            onEnableModel={enableAgentModel}
            getProviderTag={getAgentProviderTag}
            getProviderSource={getAgentProviderSource}
            canRemoveCustomProvider={(providerId) =>
              canRemoveAgentCustomProvider(providerId, agentProviderSourceById)
            }
            getProviderDisplayName={resolveProviderDisplayName}
          />
        ) : null}

        {showAgentAuthDialogFor ? (() => {
          const pid = showAgentAuthDialogFor.trim();
          const pretty = resolveProviderDisplayName(pid);
          const keyValue = agentConnectProviderId === pid ? agentConnectApiKey : "";
          return (
            <AgentAuthDialog
              providerId={agentConnectProviderId === pid ? pid : ""}
              providerName={pretty}
              providerTag={getAgentProviderTag(pid)}
              apiKey={keyValue}
              baseUrl={agentConnectProviderId === pid ? agentConnectBaseUrl : ""}
              name={agentConnectProviderId === pid ? agentConnectCustomName : ""}
              showNameField={isOpenAICompatibleProviderId(pid)}
              defaultBaseUrl={resolveProviderBaseUrlHint(pid)}
              busy={agentConnectBusy}
              onClose={() => setShowAgentAuthDialogFor("")}
              onApiKeyChange={(value) => {
                setAgentConnectProviderId(pid);
                setAgentConnectProviderName(pretty);
                setAgentConnectApiKey(value);
              }}
              onBaseUrlChange={(value) => {
                setAgentConnectProviderId(pid);
                setAgentConnectProviderName(pretty);
                setAgentConnectBaseUrl(value);
              }}
              onNameChange={(value) => {
                setAgentConnectProviderId(pid);
                setAgentConnectProviderName(pretty);
                setAgentConnectCustomName(value);
              }}
              onSave={() => void saveAgentAuthKey(pid)}
            />
          );
        })() : null}

        {showAgentCustomProvider ? (
          <AgentCustomProviderDialog
            config={agentProviderConfig}
            modelId={agentSelectedModel}
            busy={agentProviderConfigBusy || agentConfigBusy}
            onClose={() => setShowAgentCustomProvider(false)}
            onConfigChange={(patch) => setAgentProviderConfig((prev) => ({ ...prev, ...patch }))}
            onModelChange={setAgentSelectedModel}
            onSave={() => void saveAgentCustomProvider()}
          />
        ) : null}

        {/* inline connect UI lives inside provider picker right column */}

        {runtimeSetupVisible ? (
          <RuntimeSetupDialog
            runtimeStatus={runtimeStatus}
            runtimeChecking={runtimeChecking || runtimeStartupChecking}
            checkingDeps={checkingDeps}
            installingDep={installingDep}
            installingElapsed={installingElapsed}
            runtimeJob={runtimeJob}
            runtimeInstallLog={runtimeInstallLog}
            runtimeLogTail={runtimeLogTail}
            installError={error}
            autoInitAvailable={runtimeStatus.platform === "macos"}
            onClose={() => {
              setShowEnvSetup(false);
              setRuntimeSetupDismissed(true);
            }}
            onDismiss={() => {
              setShowEnvSetup(false);
              setRuntimeSetupDismissed(true);
            }}
            onRefresh={() => void refreshRuntimeRequirements()}
            onRunAutoInit={() => {
              setRuntimeJob(null);
              setRuntimeInstallLog("");
              setError("");
              setShowEnvSetup(true);
              runRuntimeSetupForMissing(runtimeStatus, { showRuntimePanel: true });
            }}
          />
        ) : null}

        <Dialog
          open={Boolean(agentPreviewImage)}
          onOpenChange={(open) => {
            if (!open) setAgentPreviewImage(null);
          }}
        >
          {agentPreviewImage ? (() => {
            const image = agentPreviewImage.images[agentPreviewImage.index] || agentPreviewImage.images[0];
            if (!image) return null;
            return (
              <DialogContent className="!border-0 !bg-transparent !p-0 !shadow-none max-w-[calc(100vw-32px)]">
                <DialogTitle className="sr-only">{image.filename || "Image preview"}</DialogTitle>
                <DialogDescription className="sr-only">
                  Preview the selected image. Click the left or right side of the image to move between attachments.
                </DialogDescription>
                <img
                  className="block max-h-[calc(100dvh-32px)] max-w-[calc(100dvw-32px)] object-contain"
                  src={image.uri}
                  alt={image.filename || "preview"}
                  onClick={(e) => {
                    if (agentPreviewImage.images.length <= 1) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const next = e.clientX >= rect.left + rect.width / 2 ? 1 : -1;
                    setAgentPreviewImage((prev) => prev ? { ...prev, index: (prev.index + next + prev.images.length) % prev.images.length } : prev);
                  }}
                />
              </DialogContent>
            );
          })() : null}
        </Dialog>

        <AgentModulePanel
          open={showAgentModulePanel}
          activeTab={agentModuleTab}
          agentSearch={agentAgentSearch}
          agentsLoading={agentDefinitionsLoading}
          agentsError={agentDefinitionsError}
          visibleAgents={visibleAgentDefinitions}
          activeAgent={activeAgentAgent}
          autoAcceptPermissions={agentAutoAcceptPermissions}
          permissionLoading={agentPermissionLoading}
          activePermissions={agentActivePermissions}
          skillsLoading={agentSkillsLoading}
          skillsError={agentSkillsError}
          skills={agentSkills}
          filteredSkills={filteredAgentSkills}
          groupedSkills={groupedAgentSkills}
          skillSearchResults={agentSkillSearchResults}
          skillInstallScope={agentSkillInstallScope}
          skillBusy={agentSkillBusy}
          skillInstallingSpec={agentSkillInstallingSpec}
          skillInstallLog={agentSkillInstallLog}
          skillInstallSpec={agentSkillInstallSpec}
          skillSearchQuery={agentSkillSearchQuery}
          skillSourceKind={agentSkillSourceKind}
          skillSourceInput={agentSkillSourceInput}
          skillListFilter={agentSkillListFilter}
          skillListQuery={agentSkillListQuery}
          skillRemovingKey={agentSkillRemovingKey}
          onClose={() => setShowAgentModulePanel(false)}
          onTabChange={setAgentModuleTab}
          onAgentSearchChange={setAgentAgentSearch}
          onRefreshAgents={() => void refreshAgentDefinitions()}
          onApplyAgent={applyAgentAgent}
          onToggleAutoAccept={() => {
            const next = !agentAutoAcceptPermissions;
            setAgentAutoAcceptPermissions(next);
            saveLocalBool(AGENT_AUTO_ACCEPT_PERMISSIONS_KEY, next);
            if (activeAgentSessionId) void ensureSessionAutoAcceptPermissions(activeAgentSessionId, next);
          }}
          onRefreshPermissions={() => void refreshPendingPermissions()}
          onSendPermissionReply={(requestId, reply) => void sendPermissionReply(requestId, reply)}
          onRefreshSkills={() => void refreshAgentSkills()}
          onSkillInstallScopeChange={setAgentSkillInstallScope}
          onSkillInstallSpecChange={setAgentSkillInstallSpec}
          onSkillSearchQueryChange={setAgentSkillSearchQuery}
          onSearchSkillRegistry={() => void searchAgentSkillRegistry()}
          onInstallSkill={(spec, scope) => void installAgentSkillFromRegistry(spec, scope)}
          onSkillSourceKindChange={setAgentSkillSourceKind}
          onSkillSourceInputChange={setAgentSkillSourceInput}
          onAddSkillSource={() => void addAgentSkillSource()}
          onSkillListFilterChange={setAgentSkillListFilter}
          onSkillListQueryChange={setAgentSkillListQuery}
          onReferenceSkill={referenceAgentSkill}
          onRemoveSkill={(skill) => void removeAgentSkill(skill)}
          onRemoveSkillGroup={(group) => void removeAgentSkillGroup(group)}
        />

        {repoContextMenu ? (
          <FloatingContextMenu
            open={Boolean(repoContextMenu)}
            x={repoContextMenu.x}
            y={repoContextMenu.y}
            onOpenChange={(open) => {
              if (!open) setRepoContextMenu(null);
            }}
          >
            <DropdownMenuItem
              onSelect={() => togglePinnedRepo(repoContextMenu.repo.id)}
              disabled={busy}
            >
              {pinnedRepoIds.includes(repoContextMenu.repo.id) ? appText.unpinProject : appText.pinProject}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void shareRepository(repoContextMenu.repo)}
              disabled={busy || shareBusyRepoId === repoContextMenu.repo.id}
            >
              {shareBusyRepoId === repoContextMenu.repo.id ? "分享中…" : "分享项目…"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void closeRepository(repoContextMenu.repo)}
              disabled={busy}
            >
              {appText.closeProject}
            </DropdownMenuItem>
          </FloatingContextMenu>
        ) : null}

        <Dialog
          open={Boolean(shareResult)}
          onOpenChange={(open) => {
            if (!open) setShareResult(null);
          }}
        >
          <DialogContent className="w-[min(520px,calc(100vw-32px))]">
            <DialogHeader>
              <DialogTitle>分享已创建 — {shareResult?.repoName}</DialogTitle>
              <DialogDescription>
                把地址发给协作者，对方打开后即可完成项目初始化（含代码、AI 会话与记忆）。
              </DialogDescription>
            </DialogHeader>
            {shareResult ? (
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border px-3 py-2 text-xs">
                    {shareResult.result.shareUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void navigator.clipboard.writeText(shareResult.result.shareUrl)}
                  >
                    复制
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  {shareResult.result.sessions} 个会话 · {shareResult.result.memory ? "含记忆库" : "无记忆库"} ·{" "}
                  {shareResult.result.reviews} 条 review · 脱敏 {shareResult.result.redactions} 处 ·{" "}
                  代码 {(shareResult.result.repoSizeBytes / 1048576).toFixed(1)} MiB + 上下文{" "}
                  {(shareResult.result.contextSizeBytes / 1048576).toFixed(1)} MiB
                </div>
                {shareResult.result.warnings.length > 0 ? (
                  <div className="flex flex-col gap-1 text-xs text-amber-500">
                    {shareResult.result.warnings.map((warning) => (
                      <div key={warning}>⚠ {warning}</div>
                    ))}
                  </div>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  接收方也可在终端执行：giteam init --from {shareResult.result.shareUrl}
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(shareError)}
          onOpenChange={(open) => {
            if (!open) setShareError("");
          }}
        >
          <DialogContent className="w-[min(440px,calc(100vw-32px))]">
            <DialogHeader>
              <DialogTitle>分享失败</DialogTitle>
              <DialogDescription className="break-all">{shareError}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" size="sm">
                  关闭
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AddProjectDialog
          open={addProjectOpen}
          step={addProjectStep}
          source={addProjectSource}
          projectName={addProjectName}
          localPath={addProjectLocalPath}
          targetPath={addProjectTargetPath}
          shareUrl={addProjectShareUrl}
          busy={shareImportBusy || addProjectBusy}
          importProgress={shareImportBusy ? shareImportProgress : null}
          error={shareImportError}
          onOpenChange={(open) => {
            if (!open && shareImportBusy) {
              void cancelShareImport();
              return;
            }
            if (!open && addProjectBusy) return;
            setAddProjectOpen(open);
            if (!open) resetAddProjectDialog();
          }}
          onSourceChange={setAddProjectSource}
          onProjectNameChange={setAddProjectName}
          onShareUrlChange={(url) => {
            setAddProjectShareUrl(url);
            if (shareImportError) setShareImportError("");
          }}
          onBackToType={() => {
            setAddProjectStep("type");
            setShareImportError("");
          }}
          onContinue={continueAddProjectStep}
          onPickLocalPath={() => pickAddProjectLocalPath()}
          onPickTargetPath={() => pickAddProjectTargetPath()}
          onConfirmLocal={() => confirmAddProjectLocal()}
          onConfirmRemote={() => confirmShareImport()}
          onCancelRemote={() => cancelShareImport()}
        />

        <Dialog
          open={Boolean(shareImportResult)}
          onOpenChange={(open) => {
            if (!open) setShareImportResult(null);
          }}
        >
          <DialogContent className="w-[min(520px,calc(100vw-32px))]">
            <DialogHeader>
              <DialogTitle>导入完成 — {shareImportResult?.repoName}</DialogTitle>
              <DialogDescription className="break-all">{shareImportResult?.targetDir}</DialogDescription>
            </DialogHeader>
            {shareImportResult ? (
              <div className="flex flex-col gap-2 text-sm">
                <div className="text-xs text-muted-foreground">
                  恢复 {shareImportResult.sessionsImported} 个会话 ·{" "}
                  {shareImportResult.memoryImported ? "含记忆库" : "无记忆库"} · 附件{" "}
                  {shareImportResult.attachmentsImported} 个 · review {shareImportResult.reviewsImported} 条
                </div>
                {shareImportResult.warnings.length > 0 ? (
                  <div className="flex flex-col gap-1 text-xs text-amber-500">
                    {shareImportResult.warnings.map((warning) => (
                      <div key={warning}>⚠ {warning}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        {sessionContextMenu ? (
          <FloatingContextMenu
            open={Boolean(sessionContextMenu)}
            x={sessionContextMenu.x}
            y={sessionContextMenu.y}
            onOpenChange={(open) => {
              if (!open) setSessionContextMenu(null);
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                const menu = sessionContextMenu;
                setSessionContextMenu(null);
                void archiveAgentSession(menu.repo, menu.session.id);
              }}
              disabled={busy}
            >
              {appText.archiveSession}
            </DropdownMenuItem>
          </FloatingContextMenu>
        ) : null}

        {composerContextMenu ? (
          <FloatingContextMenu
            open={Boolean(composerContextMenu)}
            x={composerContextMenu.x}
            y={composerContextMenu.y}
            onOpenChange={(open) => {
              if (!open) setComposerContextMenu(null);
            }}
          >
            <DropdownMenuItem onSelect={(event) => {
              event.preventDefault();
              void pasteIntoAgentPromptFromContextMenu();
            }}>
              粘贴
            </DropdownMenuItem>
          </FloatingContextMenu>
        ) : null}

        {commitContextMenu ? (
          <FloatingContextMenu
            open={Boolean(commitContextMenu)}
            x={commitContextMenu.x}
            y={commitContextMenu.y}
            onOpenChange={(open) => {
              if (!open) setCommitContextMenu(null);
            }}
          >
            <DropdownMenuItem
              onSelect={() => openCommitWorktreeDialog({
                sha: commitContextMenu.sha,
                subject: commitContextMenu.subject || "",
                author: "",
                date: ""
              }, commitContextMenu.branch)}
            >
              {appText.createWorktreeFromCommit}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setCommitContextMenu(null);
                openTopologyCreateDialog("branch", `commit:${commitContextMenu.branch || currentTopologyBaseBranch()}:${commitContextMenu.sha}`);
              }}
            >
              {appText.createBranchFromCommit}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setCommitContextMenu(null);
                void inspectCommitFromTopology(commitContextMenu.sha);
              }}
            >
              {appText.explainInspectCommit}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void applyCommitFromContextMenu("cherryPick")} disabled={busy}>
              {appText.cherryPickCurrentBranch}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void applyCommitFromContextMenu("revert")} disabled={busy}>
              {appText.revertCurrentBranch}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyCommitId(commitContextMenu.sha)}>
              {appText.copyCommitId}
            </DropdownMenuItem>
          </FloatingContextMenu>
        ) : null}

        {commitHoverCard && !commitContextMenu ? (
          <Card
            className="pointer-events-none fixed z-[2200] w-[min(300px,calc(100vw-32px))] shadow-lg"
            style={{ left: Math.min(commitHoverCard.x + 14, window.innerWidth - 320), top: Math.min(commitHoverCard.y + 14, window.innerHeight - 150) }}
          >
            <CardContent className="flex flex-col gap-1 p-3">
              <strong className="truncate text-sm font-semibold">{commitHoverCard.subject || "(no subject)"}</strong>
              <span className="truncate text-xs text-muted-foreground">{shortSha(commitHoverCard.sha, 12)}{commitHoverCard.branch ? ` · ${commitHoverCard.branch}` : ""}</span>
              <small className="truncate text-xs text-muted-foreground">{commitHoverCard.author || "unknown"} · {commitHoverCard.date || "unknown date"}</small>
            </CardContent>
          </Card>
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
            <FloatingContextMenu
              contentClassName="min-w-48"
              open={Boolean(topologyContextMenu)}
              x={topologyContextMenu.x}
              y={topologyContextMenu.y}
              onOpenChange={(open) => {
                if (!open) setTopologyContextMenu(null);
              }}
            >
              {isBranch ? (
                <>
                  <DropdownMenuLabel>{branchName}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openTopologyCreateDialog("branch", topologyContextMenu.nodeId)}>
                    {appText.createBranch}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openTopologyCreateDialog("worktree", topologyContextMenu.nodeId)}>
                    {appText.createWorktree}
                  </DropdownMenuItem>
                  {isRemoteBranch ? (
                    <DropdownMenuItem onSelect={() => void checkoutRemoteBranchFromTopology(branchName)}>
                      {appText.checkoutNewLocalBranch}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => void checkoutBranchFromTopology(branchName)}>
                      {appText.checkout}
                    </DropdownMenuItem>
                  )}
                  {!isRemoteBranch && branchName !== "main" && branchName !== "master" && !hasWorktree ? (
                    <DropdownMenuItem className="text-destructive data-[highlighted]:text-destructive" onSelect={() => void deleteBranchFromTopology(branchName)}>
                      {appText.deleteBranch}
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
              {isWorktree ? (
                <>
                  <DropdownMenuLabel>{worktreePath.split(/[\\/]/).pop() || worktreePath}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openTopologyCreateDialog("branch", topologyContextMenu.nodeId)}>
                    {appText.createBranchFromWorktree}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void activateLinkedWorktree(worktreePath)}>
                    {appText.openWorktree}
                  </DropdownMenuItem>
                  {nodeAgentBinding ? (
                    <DropdownMenuItem onSelect={() => unbindAgentFromWorkspacePath(nodeWorkspacePath)}>
                      {appText.unbindAgent}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => void bindAgentToWorkspacePath(nodeWorkspacePath, branchName)}>
                      {appText.bindAgent}
                    </DropdownMenuItem>
                  )}
                  {!isCurrentBranch ? (
                    <DropdownMenuItem className="text-destructive data-[highlighted]:text-destructive" onSelect={() => void removeTopologyWorktree(worktreePath)}>
                      {appText.removeWorktree}
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
            </FloatingContextMenu>
          );
        })() : null}

      </>
    </AppErrorBoundary>
  );
}

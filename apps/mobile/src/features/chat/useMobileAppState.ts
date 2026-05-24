import { useState } from "react";
import type { ComposerAttachment } from "../media/types";
import type { ModelOption, ProjectOption } from "../workspace/catalogUtils";
import type { ComposerAgentName, SessionItem } from "./mobileAppConfig";
import type {
  MobileChatMessage,
  MobileRenderedTurn,
  MobileTodoCard,
  SessionStatusInfo,
} from "../../types";

export function useMobileAppState() {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("准备就绪");
  const [serverUrl, setServerUrl] = useState("");
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [serverUrlTouched, setServerUrlTouched] = useState(false);
  const [preferHttps, setPreferHttps] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [token, setToken] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [model, setModel] = useState("");
  const [composerAgent, setComposerAgent] =
    useState<ComposerAgentName>("build");
  const [autoAcceptPermissions, setAutoAcceptPermissions] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [installedSkills, setInstalledSkills] = useState<any[]>([]);
  const [installedMcpServers, setInstalledMcpServers] = useState<
    Array<{ name: string; status: any }>
  >([]);
  const [extensionsLoading, setExtensionsLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [sessionSearch, setSessionSearch] = useState("");
  const [imageAttachments, setImageAttachments] = useState<
    ComposerAttachment[]
  >([]);
  const [previewImage, setPreviewImage] = useState<{
    uri: string;
    filename?: string;
  } | null>(null);
  const [messages, setMessages] = useState<MobileChatMessage[]>([]);
  const [renderedTurns, setRenderedTurns] = useState<MobileRenderedTurn[]>([]);
  const [sessionStatusMap, setSessionStatusMap] = useState<
    Record<string, SessionStatusInfo>
  >({});
  const [streaming, setStreaming] = useState(false);
  const [expandedThinkCards, setExpandedThinkCards] = useState<Set<string>>(
    new Set(),
  );
  const [notebookTheme, setNotebookTheme] = useState<"paper" | "slate">(
    "paper",
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionNextCursor, setSessionNextCursor] = useState<
    Record<string, string>
  >({});
  const [sessionHasMore, setSessionHasMore] = useState<Record<string, boolean>>(
    {},
  );
  const [sessionHistoryRetryHint, setSessionHistoryRetryHint] = useState<
    Record<string, string>
  >({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sessionDisplayedCount, setSessionDisplayedCount] = useState(10);
  const [inputDockHeight, setInputDockHeight] = useState(88);
  const [streamTodoCard, setStreamTodoCard] = useState<MobileTodoCard | null>(
    null,
  );
  const [startupSessionHydrating, setStartupSessionHydrating] = useState(false);

  return {
    loaded,
    setLoaded,
    busy,
    setBusy,
    status,
    setStatus,
    serverUrl,
    setServerUrl,
    serverUrlInput,
    setServerUrlInput,
    serverUrlTouched,
    setServerUrlTouched,
    preferHttps,
    setPreferHttps,
    pairCode,
    setPairCode,
    repoPath,
    setRepoPath,
    token,
    setToken,
    sessionId,
    setSessionId,
    model,
    setModel,
    composerAgent,
    setComposerAgent,
    autoAcceptPermissions,
    setAutoAcceptPermissions,
    modelOptions,
    setModelOptions,
    installedSkills,
    setInstalledSkills,
    installedMcpServers,
    setInstalledMcpServers,
    extensionsLoading,
    setExtensionsLoading,
    projects,
    setProjects,
    sessionSearch,
    setSessionSearch,
    imageAttachments,
    setImageAttachments,
    previewImage,
    setPreviewImage,
    messages,
    setMessages,
    renderedTurns,
    setRenderedTurns,
    sessionStatusMap,
    setSessionStatusMap,
    streaming,
    setStreaming,
    expandedThinkCards,
    setExpandedThinkCards,
    notebookTheme,
    setNotebookTheme,
    sessions,
    setSessions,
    sessionNextCursor,
    setSessionNextCursor,
    sessionHasMore,
    setSessionHasMore,
    sessionHistoryRetryHint,
    setSessionHistoryRetryHint,
    loadingOlder,
    setLoadingOlder,
    sessionDisplayedCount,
    setSessionDisplayedCount,
    inputDockHeight,
    setInputDockHeight,
    streamTodoCard,
    setStreamTodoCard,
    startupSessionHydrating,
    setStartupSessionHydrating,
  };
}

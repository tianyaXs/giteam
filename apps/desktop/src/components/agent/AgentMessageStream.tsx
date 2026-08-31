import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  buildAgentAssistantRenderGroups,
  buildAgentReplyMarkdownFromParts,
  collapseDuplicatedAgentContent,
  dedupeAgentDuplicateTextParts,
  dedupeAgentToolParts,
  isAgentRenderablePart,
  readAgentTodosFromPart,
  summarizeAgentContextProgress,
  summarizeAgentContextToolCounts,
  type AgentAssistantRenderGroup,
  coalesceRuntimeParts
} from "../../lib/agentParts";
import type {
  AgentChatMessage,
  AgentDetailedMessage,
  AgentDetailedPart,
  AgentTodoItem
} from "../../lib/agentSessions";
import type { AppText } from "../../lib/generalSettings";
import { useHighlightKeyword } from "../../lib/highlightKeyword";
import { getAttachmentBadgeLabel, isImageAttachment } from "../../lib/imageAttachments";
import {
  extractTaskDescription,
  dedupeVisibleSubagentTaskParts,
  resolveTaskCardTitle
} from "../../lib/subagentRun";
import { cn } from "../../lib/utils";
import { MarkdownLite } from "../common/MarkdownLite";
import { AnimatedCollapsibleContent } from "../ui/animated-collapsible-content";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Skeleton } from "../ui/skeleton";
import { AgentExecutionPartView, type AgentToolFileTarget } from "./AgentExecutionPartView";
import { AgentMessageNavigator, type NavigatorMarker } from "./AgentMessageNavigator";
import { SubagentRunCard } from "./SubagentRunCard";

function isTaskToolPart(part: AgentDetailedPart | undefined | null): boolean {
  return String((part as { type?: string } | null)?.type || "") === "toolCall"
    && String((part as { toolName?: string } | null)?.toolName || "") === "task";
}

function renderTimelineToolPart(options: {
  timelineKey: string;
  part: AgentDetailedPart;
  listItem?: boolean;
  siblingParts?: AgentDetailedPart[];
  settled?: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
}) {
  if (isTaskToolPart(options.part)) {
    return (
      <SubagentRunCard
        key={options.timelineKey}
        part={options.part}
        listItem={options.listItem}
        siblingParts={options.siblingParts}
        settled={options.settled}
        onOpenTaskSession={options.onOpenTaskSession}
        onOpenToolFile={options.onOpenToolFile}
        onOpenBrowserUrl={options.onOpenBrowserUrl}
      />
    );
  }
  return (
    <AgentExecutionPartView
      key={options.timelineKey}
      part={options.part}
      listItem={options.listItem}
      shellToolPartsExpanded={options.shellToolPartsExpanded}
      editToolPartsExpanded={options.editToolPartsExpanded}
      onOpenTaskSession={options.onOpenTaskSession}
      onOpenToolFile={options.onOpenToolFile}
      onOpenBrowserUrl={options.onOpenBrowserUrl}
    />
  );
}

type AgentPreviewImage = {
  uri: string;
  filename?: string;
};

type AgentMessageAttachment = NonNullable<AgentChatMessage["attachments"]>[number];

type AgentMessageRenderRow = {
  msg: AgentChatMessage;
  stableKey: string;
  isAssistant: boolean;
  /** pi 引擎注入的运行时提示（[runtime] 前缀 user 消息），以系统条而非用户气泡呈现。 */
  isSystem: boolean;
  isStreaming: boolean;
  liveParts: AgentDetailedPart[];
  renderParts: AgentDetailedPart[];
  timelineGroups: AgentAssistantRenderGroup[];
  hasTimeline: boolean;
  fallbackReply: string;
  detailsLoading: boolean;
  detailsError: string;
  errorMessage: string;
  contextOnly: boolean;
  todoItems: AgentTodoItem[];
};

const COLLAPSE_LINE_LIMIT = 8;
const COLLAPSE_CHAR_LIMIT = 420;

type AgentDisplayTimelineGroup =
  | AgentAssistantRenderGroup
  | { kind: "tool-batch"; key: string; batchKind: "shell" | "edit" | "web" | "browser" | "task" | "memory" | "recall"; parts: AgentDetailedPart[] };

function formatContextCount(count: number, noun: string): string {
  return count > 0 ? `${count}次${noun}` : "";
}

function summarizeContextCounts(counts: { read: number; search: number; list: number }): string {
  return [
    formatContextCount(counts.read, "读取"),
    formatContextCount(counts.search, "搜索"),
    formatContextCount(counts.list, "列出")
  ].filter(Boolean).join("，");
}

/** 时间线条目标签共用字宽锚点，避免「已探索 / 已回忆」等汉字实际宽度差拉开后续计数列。 */
const TIMELINE_STATUS_WIDTH_ANCHORS = [
  "探索中",
  "已探索",
  "回忆中",
  "已回忆",
  "思考中",
  "已思考",
  "运行中",
  "已运行",
  "编辑中",
  "已编辑",
  "查询中",
  "已查询",
  "浏览中",
  "已浏览",
  "执行中",
  "已完成",
  "记录中",
  "已记录"
] as const;

/** 状态文案固定占位，避免「探索中/已探索」等切换或计数变化撑动整行。 */
function ActivityStatus({
  active,
  activeLabel,
  doneLabel,
  className
}: {
  active: boolean;
  activeLabel: string;
  doneLabel: string;
  className?: string;
}) {
  const widthAnchors = Array.from(
    new Set<string>([activeLabel, doneLabel, ...TIMELINE_STATUS_WIDTH_ANCHORS])
  );
  return (
    <span
      className={cn(
        "inline-grid shrink-0 grid-cols-1 grid-rows-1 items-center font-semibold",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {/* 叠放全部时间线文案撑宽：按像素取最大，跨组对齐计数列 */}
      {widthAnchors.map((label) => (
        <span key={label} className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden>
          {label}
        </span>
      ))}
      <span className={cn("col-start-1 row-start-1 whitespace-nowrap", active && "animate-pulse")}>
        {active ? activeLabel : doneLabel}
      </span>
    </span>
  );
}

/** 时间线折叠标签共用外壳：固定行高 + 收起不挂载，保证「已探索 / 已回忆」行距一致。 */
function TimelineFoldGroup({
  open,
  onOpenChange,
  label,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 max-w-full">
      <button
        type="button"
        aria-expanded={open}
        className="flex h-10 w-full min-w-0 appearance-none items-center overflow-hidden border-0 bg-transparent px-0 text-left hover:bg-transparent"
        onClick={() => onOpenChange(!open)}
      >
        {label}
      </button>
      {open ? <div className="min-w-0">{children}</div> : null}
    </div>
  );
}


function ThinkingPlaceholder({ todoItems }: { todoItems?: AgentTodoItem[] }) {
  // todowrite 只驱动右侧进度卡、不进主时间线；有进度时主区不应继续写「思考中」，
  // 否则用户会以为卡住，而右侧已在推进。
  const activeTodo =
    (todoItems || []).find((item) => item.status === "in_progress")
    || (todoItems || []).find((item) => item.status === "pending")
    || null;
  const hasTodos = (todoItems || []).length > 0;
  const label = hasTodos ? "执行中" : "思考中";
  const doneLabel = hasTodos ? "已执行" : "已思考";
  // h-10 与 TimelineFoldGroup 收起态标签行对齐，避免「思考中」占位与推理组切换时高度跳变。
  return (
    <div className="flex h-10 w-full min-w-0 items-center justify-start gap-2" aria-live="polite" aria-label={label}>
      <ActivityStatus active activeLabel={label} doneLabel={doneLabel} className="text-sm" />
      {activeTodo ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {activeTodo.content}
        </span>
      ) : null}
    </div>
  );
}

function mergeAdjacentContextGroups(groups: AgentAssistantRenderGroup[]): AgentAssistantRenderGroup[] {
  const merged: AgentAssistantRenderGroup[] = [];
  groups.forEach((group) => {
    if (group.kind === "boundary") {
      merged.push(group);
      return;
    }
    const last = merged[merged.length - 1];
    if (group.kind === "context" && last?.kind === "context") {
      merged[merged.length - 1] = {
        kind: "context",
        key: last.key,
        parts: [...last.parts, ...group.parts]
      };
      return;
    }
    merged.push(group);
  });
  return merged;
}

function buildDisplayTimelineGroups(
  groups: AgentAssistantRenderGroup[],
  showReasoningSummaries: boolean
): AgentAssistantRenderGroup[] {
  // 探索(context)按真实时序留在触发它的思考(reasoning)之后：仅合并连续相邻的探索组，
  // 不再把 context 推到 reasoning 之前、也不跨回合合并成一个大组。否则会产生「一个汇总了
  // 数十次调用的大探索组堆在前面、后面跟着一堆思考」的失真布局——探索与思考时序颠倒、
  // 探索计数跨回合累积。
  // 隐藏思考时插入不可见 boundary，保留「思考作为分隔」的语义，避免多轮 shell 收成大数。
  const out: AgentAssistantRenderGroup[] = [];
  groups.forEach((group) => {
    if (group.kind === "reasoning") {
      if (showReasoningSummaries) out.push(group);
      else out.push({ kind: "boundary", key: `boundary:${group.key}` });
      return;
    }
    if (group.kind === "boundary") {
      out.push(group);
      return;
    }
    out.push(group);
  });
  return mergeAdjacentContextGroups(out);
}

function shouldCollapseMessage(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  const lineCount = normalized.split(/\r?\n/).length;
  return lineCount > COLLAPSE_LINE_LIMIT || normalized.length > COLLAPSE_CHAR_LIMIT;
}

function isMessageImageAttachment(attachment: AgentMessageAttachment): boolean {
  return isImageAttachment({
    kind: attachment.kind,
    mime: attachment.mime || "",
    dataUrl: attachment.uri,
    filename: attachment.filename || ""
  });
}

function collapsePreview(text: string): string {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  const lines = normalized.split(/\r?\n/).slice(0, COLLAPSE_LINE_LIMIT);
  let preview = lines.join("\n").trim();
  if (preview.length > COLLAPSE_CHAR_LIMIT) {
    preview = `${preview.slice(0, COLLAPSE_CHAR_LIMIT).trimEnd()}…`;
  } else if (normalized.length > preview.length || normalized.split(/\r?\n/).length > lines.length) {
    preview = `${preview}…`;
  }
  return preview;
}

/** 提取消息首行非空文本作为右侧导航条 hover 预览，去掉 markdown 行首标记并截断。 */
function navigatorFirstLine(text: string): string {
  const firstLine = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  const cleaned = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+>]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > 120 ? `${cleaned.slice(0, 120).trimEnd()}…` : cleaned;
}

function localPathToFileUrl(path: string): string {
  return encodeURI(`file://${path}`);
}

function filenameFromPath(path: string): string {
  return path.replace(/:\d+$/, "").split(/[\\/]/).filter(Boolean).pop() || path;
}

function getToolName(part: AgentDetailedPart): string {
  return String((part as any)?.toolName || "").trim();
}

function getBatchKind(group: AgentAssistantRenderGroup): "shell" | "edit" | "web" | "browser" | "task" | "memory" | "recall" | "" {
  if (group.kind !== "part") return "";
  const type = String((group.part as any)?.type || "");
  if (type === "runtime.memory") return "memory";
  if (type !== "toolCall") return "";
  const tool = getToolName(group.part);
  if (tool === "task") return "task";
  if (tool === "bash" || tool === "bash_output" || tool === "kill_shell") return "shell";
  if (tool === "write" || tool === "edit" || tool === "hashline_edit" || tool === "apply_patch") return "edit";
  if (tool === "web_fetch" || tool === "web_search") return "web";
  if (tool === "browser_use") return "browser";
  if (tool === "asset_context" || tool === "asset_search" || tool === "asset_precedents") return "recall";
  return "";
}

function isEmptyAssistantPlaceholder(row: AgentMessageRenderRow): boolean {
  // 忽略 detailsLoading：新 assistant 一创建就会被拉详情，若把 loading 当成非空，
  // 会无法并入上一条，从而在时间线里插入多余的「思考中」占位。
  return row.isAssistant && !row.hasTimeline && !row.fallbackReply && !row.detailsError && !row.errorMessage;
}

function runFailureText(message: AgentChatMessage): string {
  const explicit = String(message.error || "").trim();
  if (explicit) return explicit;
  const content = String(message.content || "");
  if (!/^Run failed\s*\n/i.test(content)) return "";
  return content.replace(/^Run failed\s*\n?/i, "").trim() || "任务未能完成。";
}

function rowMatchesMessageId(row: AgentMessageRenderRow, messageId: string): boolean {
  const id = messageId.trim();
  if (!id) return false;
  if (row.stableKey === id || row.stableKey.startsWith(`${id}:`)) return true;
  const parts = String(row.msg.id || "")
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.includes(id);
}

function buildBatchedTimelineGroups(groups: AgentAssistantRenderGroup[]): AgentDisplayTimelineGroup[] {
  const out: AgentDisplayTimelineGroup[] = [];
  let pendingKind: "shell" | "edit" | "web" | "browser" | "task" | "memory" | "recall" | "" = "";
  let pending: AgentAssistantRenderGroup[] = [];

  const flush = () => {
    if (!pending.length) return;
    // shell / edit 一律进外层批组（含单条），与「已探索」一致：先列表再点开详情
    if (pendingKind) {
      out.push({
        kind: "tool-batch",
        key: pending[0]?.key || `${pendingKind}-batch`,
        batchKind: pendingKind,
        parts: pending
          .filter((group): group is Extract<AgentAssistantRenderGroup, { kind: "part" }> => group.kind === "part")
          .map((group) => group.part)
      });
    } else {
      out.push(...pending);
    }
    pendingKind = "";
    pending = [];
  };

  groups.forEach((group) => {
    if (group.kind === "boundary") {
      flush();
      return;
    }
    const nextKind = getBatchKind(group);
    if (!nextKind) {
      flush();
      out.push(group);
      return;
    }
    if (pendingKind && pendingKind !== nextKind) flush();
    pendingKind = nextKind;
    pending.push(group);
  });
  flush();
  return out;
}

type AgentMessageStreamProps = {
  sessionLoading: boolean;
  messages: AgentChatMessage[];
  renderedMessages: AgentChatMessage[];
  activeStreamingAssistantId: string;
  activeSessionBusy: boolean;
  serverMessageIdByLocalId: Record<string, string>;
  detailsByMessageId: Record<string, AgentDetailedMessage | null>;
  livePartsByServerMessageId: Record<string, AgentDetailedPart[]>;
  detailsLoadingByMessageId: Record<string, boolean>;
  detailsErrorByMessageId: Record<string, string>;
  showReasoningSummaries: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  workspaceRoot?: string;
  workspaceFileCandidates?: string[];
  workspaceDirectoryCandidates?: string[];
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenWorkspacePath: (path: string, line?: number) => void;
  onOpenWorkspaceDirectory?: (path: string) => void;
  onOpenLocalDirectory?: (absolutePath: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
  onPreviewImageGroup: (images: AgentPreviewImage[], index: number) => void;
  onCopyAttachmentUri: (uri: string) => void;
  onOpenAttachment: (uri: string, filename?: string, mime?: string) => void;
  // react-virtuoso 接管滚动后的控制接口
  activeSessionId: string;
  onStartReached: () => void;
  onAtBottomChange: (atBottom: boolean) => void;
  scrollerRef: (node: HTMLElement | Window | null) => void;
  virtuosoRef: RefObject<VirtuosoHandle>;
  onRangeChanged: () => void;
  /** 外部请求滚动定位到的消息 id（搜索命中时由 App 写入，定位完成后清空）。 */
  pendingScrollMessageId?: string;
  onPendingScrollDone?: () => void;
  /** 每次搜索点击递增；与 messageId 一起构成 Virtuoso remount key，使 initialTopMostItemIndex 生效。 */
  locateNonce?: number;
  /** 定位命中后用于在正文里高亮关键词的搜索词（空则不高亮）。 */
  highlightKeyword?: string;
  /** UI 文案（角色名、aria 标签等）。 */
  text: AppText;
  /** 右侧抽屉打开等场景下隐藏导航条（与 sideRail 一致）。 */
  navigatorHidden?: boolean;
  /** 概览标尺贴内容列左缘还是右缘（默认右）。 */
  navigatorSide?: "left" | "right";
  /** 概览标尺范围：all=全部消息（默认）；sent=仅「我发送」。 */
  navigatorScope?: "sent" | "all";
  /** 外部强制恢复贴底跟随（发送时递增）；驱动内部 stick ref + 持续 rAF 钉底。 */
  stickResetSignal?: number;
};

type RenderMarkdown = (source: string, streaming?: boolean) => ReactNode;

// Virtuoso List：必须把官方传入的 style（含 paddingTop/height）原样挂上；不要用 flex/gap，
// 也不要用会覆盖 paddingTop 语义的布局类抢测高。行间距放在 Item 内 padding。
// 左缘由 AgentChatFrame 下发的 --chat-content-left 决定（未定义时回退 mx-auto 居中）。
// 不加 margin 过渡：侧栏收起时 main 宽度逐帧变 → contentLeft 逐帧重算，
// 有过渡会让 margin 滞后追赶、内容先左后右来回滑动；即时跟随则单调平滑。
// @see https://virtuoso.dev/react-virtuoso/troubleshooting/
const AgentMessageListContainer = forwardRef<HTMLDivElement, { children?: ReactNode; style?: CSSProperties }>(
  ({ children, style, ...rest }, ref) => (
    <div
      ref={ref}
      style={style}
      {...rest}
      className="ml-[var(--chat-content-left,auto)] mr-auto max-w-[860px] select-none px-10"
    >
      {children}
    </div>
  )
);
AgentMessageListContainer.displayName = "AgentMessageListContainer";

function AgentMessageRowFrame({ children }: { children: ReactNode }) {
  return <div className="pb-4">{children}</div>;
}

/** 首条消息与顶部分隔线之间的呼吸留白（参考 ChatGPT 首条消息的顶部间距）。 */
function AgentMessageListHeader() {
  return <div className="h-12" aria-hidden="true" />;
}

function StreamLoadingState() {
  return (
    <div className="flex flex-col gap-2 px-1 py-2 text-sm text-muted-foreground">
      <span>加载会话中…</span>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** pi 引擎注入的运行时提示（如迭代预算警告），以小字灰条呈现，区别于用户气泡。 */
function SystemMessageRow({ content }: { content: string }) {
  return (
    <div className="flex w-full items-center gap-2 py-1.5" aria-live="polite">
      <span className="min-w-0 select-text whitespace-pre-wrap break-words text-xs text-muted-foreground">{content}</span>
    </div>
  );
}

function MessageShell({
  isAssistant,
  todoItems,
  userHasAttachments,
  highlight,
  highlightKeyword,
  locateMessageId,
  children
}: {
  isAssistant: boolean;
  todoItems?: AgentTodoItem[];
  userHasAttachments?: boolean;
  highlight?: boolean;
  highlightKeyword?: string;
  locateMessageId?: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 定位命中时仅高亮正文关键词 <mark>，不再整块染色——避免“整个 markdown 区被选中”。
  useHighlightKeyword(contentRef, highlightKeyword ?? "", Boolean(highlight));
  return (
    <div
      className={cn("flex w-full min-w-0 overflow-hidden", isAssistant ? "justify-start" : "justify-end")}
      data-agent-todos={todoItems?.length ? encodeURIComponent(JSON.stringify(todoItems)) : undefined}
      data-locate-hit={highlight ? "1" : undefined}
      data-message-id={locateMessageId || undefined}
    >
      <div
        ref={contentRef}
        className={cn(
          "relative min-w-0 max-w-full",
          isAssistant
            ? "w-full"
            : userHasAttachments
              ? "max-w-[min(74%,620px)]"
              : "max-w-[min(74%,620px)] rounded-2xl bg-muted px-3.5 py-2 text-[15px] font-medium leading-6 text-foreground"
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ToolBatchGroup({
  timelineKey,
  group,
  open,
  onOpenChange,
  forceInactive = false,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile,
  onOpenBrowserUrl
}: {
  timelineKey: string;
  group: Extract<AgentDisplayTimelineGroup, { kind: "tool-batch" }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forceInactive?: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
}) {
  const shell = group.batchKind === "shell";
  const web = group.batchKind === "web";
  const browser = group.batchKind === "browser";
  const task = group.batchKind === "task";
  const memory = group.batchKind === "memory";
  // 记忆批组三分态：进行中（part phase=started）给瞬时反馈；有真实写入
  // （实体/关系/意图）留卡；失败留卡可排查；完成的空抽取（寒暄轮等）整组不渲染。
  const memoryPhaseOf = (part: (typeof group.parts)[number]) =>
    String((part as { phase?: string }).phase || "").trim();
  const memoryHasRunning = memory && group.parts.some((part) => memoryPhaseOf(part) === "started");
  const memoryFailed = memory && group.parts.some((part) => memoryPhaseOf(part) === "failed");
  const memoryWrote =
    memory &&
    group.parts.some(
      (part) =>
        (Number((part as { entityCount?: number }).entityCount) || 0) > 0 ||
        (Number((part as { relationCount?: number }).relationCount) || 0) > 0 ||
        Boolean(String((part as { intent?: string }).intent || "").trim())
    );
  // 末尾组（流式中）一律「运行中/编辑中」：不再随组内单个命令的 running↔done 抖动——
  // 否则前一条 done、下一条未到的空窗帧会闪成「已运行」、下一条到达又变「运行中」。
  // 例外：记忆抽取在 turn 结束后异步到达，forceInactive 已为 true，但 part 仍在
  // started——此时组标签必须以 part 相位为准显示「记录中」，否则「已记录」抢先出现。
  const running = !forceInactive || memoryHasRunning;
  const recall = group.batchKind === "recall";
  // 对齐「探索中 / 已探索」：进行态与完成态用同一词根，避免「子任务中→已委派」语义断裂。
  const activeLabel = memory
    ? "记录中"
    : recall
      ? "回忆中"
      : task
        ? "执行中"
        : shell
          ? "运行中"
          : web
            ? "查询中"
            : browser
              ? "浏览中"
              : "编辑中";
  const doneLabel = memory
    ? memoryFailed && !memoryWrote
      ? "记忆写入失败"
      : "已记录"
    : recall
      ? "已回忆"
      : task
        ? "已完成"
        : shell
          ? "已运行"
          : web
            ? "已查询"
            : browser
              ? "已浏览"
              : "已编辑";
  const noun = memory
    ? "次写入"
    : recall
      ? "次"
      : task
        ? "个子任务"
        : shell
          ? "条命令"
          : web
            ? "次"
            : browser
              ? "次"
              : "个文件";
  const resolvedOpen = open;

  // 只显示真实子 agent 行，并去掉父壳/空壳造成的重复卡。
  const visibleTaskParts = task
    ? dedupeVisibleSubagentTaskParts(group.parts)
    : group.parts;
  if (task && visibleTaskParts.length === 0) return null;
  // 空抽取（寒暄轮等）不出卡：没有写入也没有失败，这条事件对用户无信息量。
  if (memory && !memoryHasRunning && !memoryWrote && !memoryFailed) return null;

  // 与「已探索 2次搜索」同形：回忆/查询类数字与量词紧贴，避免「1 次」多出空格
  const countCompact = recall || web || browser;
  const countLabel = countCompact
    ? `${visibleTaskParts.length}${noun}`
    : `${visibleTaskParts.length} ${noun}`;

  // 子任务组摘要：运行中显示当前活跃标题，完成态显示计数即可。
  const taskDetail = (() => {
    if (!task) return "";
    const runningPart = visibleTaskParts.find((part) => {
      const status = String((part as { status?: string }).status || "").toLowerCase();
      const sub = String((part as { subagentStatus?: string }).subagentStatus || "").toLowerCase();
      return status === "running" || status === "pending" || sub === "running" || sub === "pending";
    });
    if (!runningPart || !running) return "";
    return resolveTaskCardTitle(runningPart, group.parts) || extractTaskDescription(runningPart);
  })();

  const memoryDetail = (() => {
    if (!memory) return "";
    const entities = visibleTaskParts.reduce(
      (sum, part) => sum + (Number((part as { entityCount?: number }).entityCount) || 0),
      0
    );
    const relations = visibleTaskParts.reduce(
      (sum, part) => sum + (Number((part as { relationCount?: number }).relationCount) || 0),
      0
    );
    if (entities > 0 || relations > 0) {
      return `${entities} 个实体 · ${relations} 条关系`;
    }
    const intent = visibleTaskParts
      .map((part) => String((part as { intent?: string }).intent || "").trim())
      .find(Boolean);
    return intent || "";
  })();

  const recallDetail = (() => {
    if (!recall || !running) return "";
    const runningPart = visibleTaskParts.find((part) => {
      const status = String((part as { status?: string }).status || "").toLowerCase();
      return status === "running" || status === "pending";
    });
    const part = runningPart || visibleTaskParts[visibleTaskParts.length - 1];
    if (!part) return "";
    const tool = String((part as { toolName?: string }).toolName || "");
    const input = ((part as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>;
    const taskText = String(input.task || input.query || input.error || "").trim();
    const short = taskText.length > 48 ? `${taskText.slice(0, 48).trimEnd()}…` : taskText;
    if (tool === "asset_context") return short ? `上下文 · ${short}` : "上下文";
    if (tool === "asset_search") return short ? `检索 · ${short}` : "检索";
    if (tool === "asset_precedents") return short ? `先例 · ${short}` : "先例";
    return short;
  })();

  return (
    <TimelineFoldGroup
      open={resolvedOpen}
      onOpenChange={onOpenChange}
      label={
        <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
          <ActivityStatus active={running} activeLabel={activeLabel} doneLabel={doneLabel} className="text-sm" />
          {!memory || memoryWrote ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{countLabel}</span>
          ) : null}
          {taskDetail ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">· {taskDetail}</span>
          ) : null}
          {!taskDetail && memoryDetail ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">· {memoryDetail}</span>
          ) : null}
          {!taskDetail && !memoryDetail && recallDetail ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">· {recallDetail}</span>
          ) : null}
        </span>
      }
    >
      {/* 子任务批组：外层不滚动，避免与 SubagentRunCard 内层叠出双滚动条 */}
      <div className={cn("pb-1.5 pl-3", task ? "overflow-visible" : "max-h-56 overflow-y-auto overscroll-contain")}>
        <div className="flex flex-col gap-0.5">
          {visibleTaskParts.map((part, partIndex) => {
            const timelineKeyItem = `${timelineKey}:${String((part as { id?: string }).id || partIndex)}`;
            if (memory || String((part as { type?: string }).type || "") === "runtime.memory") {
              return <MemoryExtractionPart key={timelineKeyItem} part={part} listItem />;
            }
            return renderTimelineToolPart({
              timelineKey: timelineKeyItem,
              part,
              listItem: true,
              siblingParts: group.parts,
              settled: forceInactive,
              shellToolPartsExpanded,
              editToolPartsExpanded,
              onOpenTaskSession,
              onOpenToolFile,
              onOpenBrowserUrl
            });
          })}
        </div>
      </div>
    </TimelineFoldGroup>
  );
}

function ContextGroup({
  timelineKey,
  group,
  open,
  onOpenChange,
  forceInactive = false,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile
}: {
  timelineKey: string;
  group: Extract<AgentAssistantRenderGroup, { kind: "context" }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forceInactive?: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
}) {
  const counts = summarizeAgentContextToolCounts(group.parts);
  const progress = summarizeAgentContextProgress(group.parts);
  const summary = summarizeContextCounts(counts) || "已收集上下文";
  // 末尾组（流式中）一律「探索中」：不再随组内单个工具 running↔done 抖动——否则前一个工具
  // done、下一个未到的空窗帧会闪成「已探索」、下一个到达又变「探索中」（即「新的数量」闪动）。
  const active = !forceInactive;
  // 当前工具名（如「读取 · package.json」）同理会因工具切换的空窗帧（前一个 done、下一个
  // tool.started 尚未到达、被 isAgentRenderablePart 过滤出 group.parts）瞬时为空 → 这段
  // 「· 读取 xxx」整段卸载、下个工具到达再挂载，标签行反复显隐（用户原话「探索数量闪动」）。
  // 用 ref 缓存最后一个非空 detail，空窗时沿用上一个值，让 detail 在工具切换间连续
  // （a.ts → b.ts 中间不消失）；完成态（非 active）一律不显示。组件不卸载（锚点 key），ref 持久。
  const lastDetailRef = useRef("");
  if (progress.detail) lastDetailRef.current = progress.detail;
  const detail = active ? progress.detail || lastDetailRef.current : "";

  return (
    <TimelineFoldGroup
      open={open}
      onOpenChange={onOpenChange}
      label={
        <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
          <ActivityStatus active={active} activeLabel="探索中" doneLabel="已探索" className="text-sm" />
          <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
            {summary || "已收集上下文"}
          </span>
          {detail ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">· {detail}</span>
          ) : null}
        </span>
      }
    >
      <div className="flex flex-col gap-0.5 pb-1.5 pl-3">
        {group.parts.map((part, partIndex) => (
          renderTimelineToolPart({
            timelineKey: `${timelineKey}:${String((part as { id?: string }).id || partIndex)}`,
            part,
            listItem: true,
            shellToolPartsExpanded,
            editToolPartsExpanded,
            onOpenTaskSession,
            onOpenToolFile
          })
        ))}
      </div>
    </TimelineFoldGroup>
  );
}

function ReasoningGroup({
  group,
  active,
  open,
  onOpenChange,
  renderMarkdown
}: {
  group: Extract<AgentAssistantRenderGroup, { kind: "reasoning" }>;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderMarkdown: RenderMarkdown;
}) {
  const text = group.parts
    .map((part) => String((part as { text?: string }).text || "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;

  const preview = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(-1)[0] || "整理推理摘要";

  // 默认始终收起：过程中与结束后都不自动展开，避免高度变化抖动；仅手动点击展开
  return (
    <TimelineFoldGroup
      open={open}
      onOpenChange={onOpenChange}
      label={
        <>
          <ActivityStatus active={active} activeLabel="思考中" doneLabel="已思考" className="mr-2 text-sm" />
          {open ? null : (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</span>
          )}
        </>
      }
    >
      <div className="min-w-0 max-w-full overflow-hidden pb-2 pl-3 text-sm text-muted-foreground">
        <div className="min-w-0 max-w-full select-text break-words [overflow-wrap:anywhere]">
          {renderMarkdown(text, active)}
        </div>
      </div>
    </TimelineFoldGroup>
  );
}

function AssistantTextBlock({
  text,
  streaming,
  renderMarkdown
}: {
  text: string;
  streaming: boolean;
  renderMarkdown: RenderMarkdown;
}) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full select-text overflow-hidden break-words text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]",
        streaming && "agent-stream-fade"
      )}
    >
      {renderMarkdown(text, streaming)}
    </div>
  );
}

function AssistantTimeline({
  stableKey,
  isStreaming,
  timelineGroups,
  timelineOpenState,
  setTimelineOpenState,
  showReasoningSummaries,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile,
  onOpenBrowserUrl,
  renderMarkdown
}: {
  stableKey: string;
  isStreaming: boolean;
  timelineGroups: AgentAssistantRenderGroup[];
  timelineOpenState: Record<string, boolean>;
  setTimelineOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  showReasoningSummaries: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
  renderMarkdown: RenderMarkdown;
}) {
  const displayTimelineGroups = buildBatchedTimelineGroups(timelineGroups);
  const lastGroupIndex = displayTimelineGroups.length - 1;
  // 稳定组 key：把每个组的 React key 与「会漂移的 batch[0]」彻底解耦，让标签绝对稳定。
  // 流式中工具的 toolName 延迟填充（toolCall.started 常先于 tool.started、初始为空）：一组
  // context 工具里最早到达的那条其 toolName 补齐时，会从不渲染（被 isAgentRenderablePart 过滤）
  // 变成渲染、且成为 batch[0]，于是 context:firstId / part:pid 这类基于 batch[0] 的 key 逐帧
  // 漂移 → React 卸载旧组挂载新组 → 标签显隐（多次工具调用反复触发，用户原话「会突然隐藏再显示
  // 再隐藏」「分组标签显隐」）。用 ref 锁定每个组「首次出现时的锚点 part」：组内任一 part 已带
  // 锚点则沿用、否则以当前首个 part 为锚点，并把锚点回写到组内所有 part。这样无论 batch[0] 怎么
  // 补齐/合并/重排，组 key 永不变化，React 始终复用同一实例——标签从挂载起就不再卸载。
  // Map 只增不减、幂等（strict mode 双渲染无害），组件重挂载时随 ref 重置、按当前结构重判。
  const partAnchorRef = useRef(new Map<string, string>()).current;
  const getGroupParts = (group: AgentDisplayTimelineGroup): AgentDetailedPart[] => {
    switch (group.kind) {
      case "part":
        return [group.part];
      case "tool-batch":
      case "context":
      case "reasoning":
        return group.parts;
      case "boundary":
        return [];
    }
  };
  const stableGroupKeys = displayTimelineGroups.map((group) => {
    const parts = getGroupParts(group);
    let anchor = "";
    for (const part of parts) {
      const pid = String((part as { id?: string })?.id || "");
      if (!pid) continue;
      const existing = partAnchorRef.get(pid);
      if (existing) { anchor = existing; break; }
    }
    if (!anchor) anchor = String((parts[0] as { id?: string })?.id || group.key);
    for (const part of parts) {
      const pid = String((part as { id?: string })?.id || "");
      if (pid && !partAnchorRef.has(pid)) partAnchorRef.set(pid, anchor);
    }
    return `${stableKey}:anchor:${anchor}`;
  });
  // 防回退：任一时间线组（reasoning/context/tool-batch/part）一旦后方出现过更新的组
  // （index < lastGroupIndex）就永久「已完成态」。流式中末尾组可能因帧抖动/重挂载而瞬时消失，
  // 令 index===lastGroupIndex 临时成立、forceInactive 回退、已完成的标签瞬时闪回「进行中」，
  // 组恢复后又变回「已X」——即「已X→进行中→已X」的闪动（已思考/已探索/已运行均会触发）。用
  // ref 记录所有已下台的组 key（只增不减、幂等，strict mode 双渲染无害；组件重挂载时随 ref
  // 重置、按当前结构重新判定），forceInactive 与 reasoning active 都读它，从根上消除回退闪动。
  const demotedGroupKeys = useRef(new Set<string>()).current;
  for (let i = 0; i < lastGroupIndex; i += 1) {
    demotedGroupKeys.add(stableGroupKeys[i]);
  }
  // 末尾组 active 直接派生自 isStreaming（末尾组恒满足 index===lastGroupIndex，故 lastGroupIndex
  // 抖动不影响它）。注意：此处不对 isStreaming 做 UI 防抖（曾加的 streamingActive 已移除）——标签
  // 闪动的真正根因在数据层：upsertAgentLivePart 合并时空 toolName 会覆盖已补全的工具名（"ls"/"read"
  // →""），致 context 组工具数 3→2→3、整组短暂消失。已在 App.tsx 该函数内根治（空 toolName 不覆盖
  // 已有非空值）。active 直接用 isStreaming 即稳，无需再叠防抖层。
  // 「思考中」按「最后一个时间线组」判定：流式中且该推理组正是最后一个组时为思考态，
  // 其后一旦追加任何工具/正文/新推理组，立即且永久固定为「已思考」。
  // 不再用 reasoningActive（!renderParts.some(text|toolCall)）：多轮「思考↔探索」交替时，
  // 工具 part 在 liveParts/renderParts 里的可见性会随帧变化（isAgentRenderablePart 对空
  // reasoning 过滤、工具逐个下发），some() 随之抖动，导致末尾推理组在「思考中↔已思考」间
  // 反复频闪；且首个工具出现后它永久 false，会让「探索后再思考」误显「已思考」。改看
  // 「谁是最后一个组」（coalesce 后组结构 append-only、index 稳定），每个推理组的 active
  // 都单调 true→false，从根上消除频闪。

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1.5 overflow-hidden">
      {displayTimelineGroups.map((group, index) => {
        const timelineKey = stableGroupKeys[index];
        // 非流式、或后方已有更新组（含「曾出现过」的防回退判定）→ 强制已完成态
        const forceInactive = !isStreaming || index !== lastGroupIndex || demotedGroupKeys.has(timelineKey);
        // 子任务批组运行中默认展开（对齐 Explored 下列表可见）；结束后仍可折叠
        const isOpen = timelineOpenState[timelineKey]
          ?? (group.kind === "tool-batch" && group.batchKind === "task" && !forceInactive);
        const setOpen = (open: boolean) => setTimelineOpenState((prev) => ({ ...prev, [timelineKey]: open }));

        if (group.kind === "tool-batch") {
          return (
            <ToolBatchGroup
              key={timelineKey}
              timelineKey={timelineKey}
              group={group}
              open={isOpen}
              onOpenChange={setOpen}
              forceInactive={forceInactive}
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              onOpenTaskSession={onOpenTaskSession}
              onOpenToolFile={onOpenToolFile}
              onOpenBrowserUrl={onOpenBrowserUrl}
            />
          );
        }

        if (group.kind === "context") {
          return (
            <ContextGroup
              key={timelineKey}
              timelineKey={timelineKey}
              group={group}
              open={isOpen}
              onOpenChange={setOpen}
              forceInactive={forceInactive}
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              onOpenTaskSession={onOpenTaskSession}
              onOpenToolFile={onOpenToolFile}
            />
          );
        }

        if (group.kind === "reasoning") {
          if (!showReasoningSummaries) return null;
          const active =
            isStreaming && index === lastGroupIndex && !demotedGroupKeys.has(timelineKey);
          return (
            <ReasoningGroup
              key={timelineKey}
              group={group}
              active={active}
              open={isOpen}
              onOpenChange={setOpen}
              renderMarkdown={renderMarkdown}
            />
          );
        }

        if (group.kind === "boundary") return null;

        if (group.kind !== "part") return null;
        const type = String((group.part as { type?: string }).type || "");
        if (type === "runtime.retry") {
          return <RuntimeRetryPart key={timelineKey} part={group.part} />;
        }
        if (type === "runtime.memory") {
          return <MemoryExtractionPart key={timelineKey} part={group.part} />;
        }
        if (type === "runtime.failure") {
          const message = String((group.part as { error?: string; text?: string }).error
            || (group.part as { error?: string; text?: string }).text
            || "任务未能完成。").trim();
          return <AgentErrorMessage key={timelineKey} message={message} />;
        }
        if (type === "text") {
          const text = collapseDuplicatedAgentContent(
            String((group.part as { text?: string }).text || "")
          );
          if (!text) return null;
          const last = index === displayTimelineGroups.length - 1;
          return (
            <AssistantTextBlock
              key={timelineKey}
              text={text}
              streaming={isStreaming && last}
              renderMarkdown={renderMarkdown}
            />
          );
        }

        return renderTimelineToolPart({
          timelineKey,
          part: group.part,
          shellToolPartsExpanded,
          editToolPartsExpanded,
          onOpenTaskSession,
          onOpenToolFile
        });
      })}
    </div>
  );
}

function CollapsibleUserText({
  messageId,
  text,
  open,
  onOpenChange,
  renderMarkdown
}: {
  messageId: string;
  text: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderMarkdown: RenderMarkdown;
}) {
  return (
    <Collapsible className="grid select-text gap-2" open={open} onOpenChange={onOpenChange}>
      {open ? null : (
        <div className="min-w-0 text-sm leading-relaxed">
          {renderMarkdown(collapsePreview(text))}
        </div>
      )}
      <CollapsibleContent className="min-w-0 text-sm leading-relaxed">
        {renderMarkdown(text)}
      </CollapsibleContent>
      <CollapsibleTrigger asChild>
        <Button className="h-7 w-fit select-none px-2 text-xs" size="sm" variant="ghost" aria-controls={`message-${messageId}`}>
          {open ? "收起" : "展开全文"}
        </Button>
      </CollapsibleTrigger>
    </Collapsible>
  );
}

function MessageGraphContextRefs({
  refs,
  className
}: {
  refs: NonNullable<AgentChatMessage["graphRefs"]>;
  className?: string;
}) {
  if (refs.length <= 0) return null;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      {refs.map((ref) => (
        <div
          key={ref.id}
          className="flex max-w-[220px] items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
          title={ref.snippet ? `${ref.typeLabel}: ${ref.label}\n${ref.snippet}` : `${ref.typeLabel}: ${ref.label}`}
        >
          <span className="shrink-0 text-muted-foreground">{ref.typeLabel}</span>
          <span className="min-w-0 truncate font-medium">{ref.label}</span>
        </div>
      ))}
    </div>
  );
}

function UserMessage({
  msg,
  messageOpenState,
  setMessageOpenState,
  renderMarkdown,
  onPreviewImageGroup,
  onCopyAttachmentUri,
  onOpenAttachment
}: {
  msg: AgentChatMessage;
  messageOpenState: Record<string, boolean>;
  setMessageOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  renderMarkdown: RenderMarkdown;
  onPreviewImageGroup: (images: AgentPreviewImage[], index: number) => void;
  onCopyAttachmentUri: (uri: string) => void;
  onOpenAttachment: (uri: string, filename?: string, mime?: string) => void;
}) {
  const attachments = msg.attachments || [];
  const graphRefs = msg.graphRefs || [];
  const hasAttachments = attachments.length > 0;
  const hasGraphRefs = graphRefs.length > 0;
  const hasContent = Boolean(msg.content.trim());
  if (!hasContent && attachments.length === 0 && !hasGraphRefs) return null;

  return (
    <div className={cn("grid min-w-0 gap-2", (hasAttachments || hasGraphRefs) && "justify-items-end")}>
      {hasGraphRefs ? (
        <MessageGraphContextRefs refs={graphRefs} className="justify-self-end" />
      ) : null}
      <MessageAttachments
        attachments={attachments}
        className={hasAttachments ? "justify-self-end" : undefined}
        onPreviewImageGroup={onPreviewImageGroup}
        onCopyAttachmentUri={onCopyAttachmentUri}
        onOpenAttachment={onOpenAttachment}
      />
      {hasContent ? (
        hasAttachments || hasGraphRefs ? (
          <div className="w-fit max-w-full select-text rounded-2xl bg-muted px-3.5 py-2 text-[15px] font-medium leading-6 text-foreground">
            {shouldCollapseMessage(msg.content) ? (
              <CollapsibleUserText
                messageId={msg.id}
                text={msg.content}
                open={messageOpenState[msg.id] ?? false}
                onOpenChange={(open) => {
                  setMessageOpenState((prev) => ({ ...prev, [msg.id]: open }));
                }}
                renderMarkdown={renderMarkdown}
              />
            ) : renderMarkdown(msg.content)}
          </div>
        ) : (
          <div className="select-text">
            {shouldCollapseMessage(msg.content) ? (
              <CollapsibleUserText
                messageId={msg.id}
                text={msg.content}
                open={messageOpenState[msg.id] ?? false}
                onOpenChange={(open) => {
                  setMessageOpenState((prev) => ({ ...prev, [msg.id]: open }));
                }}
                renderMarkdown={renderMarkdown}
              />
            ) : renderMarkdown(msg.content)}
          </div>
        )
      ) : null}
    </div>
  );
}

function AssistantMessage({
  row,
  timelineOpenState,
  setTimelineOpenState,
  showReasoningSummaries,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile,
  onOpenBrowserUrl,
  renderMarkdown
}: {
  row: AgentMessageRenderRow;
  timelineOpenState: Record<string, boolean>;
  setTimelineOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  showReasoningSummaries: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
  renderMarkdown: RenderMarkdown;
}) {
  const {
    stableKey,
    isStreaming,
    timelineGroups,
    hasTimeline,
    fallbackReply,
    detailsError,
    errorMessage,
    renderParts,
    todoItems
  } = row;

  // 时间线里已有 text part 时不必再叠一份 fallback（避免双份正文）。
  const timelineHasTextPart = renderParts.some((part) => {
    const type = String((part as { type?: string }).type || "");
    return type === "text" && Boolean(String((part as { text?: string }).text || "").trim());
  });
  const showFallbackReply = Boolean(fallbackReply) && !timelineHasTextPart;

  return (
    <div className="grid min-w-0 gap-2">
      {hasTimeline ? (
        <AssistantTimeline
          stableKey={stableKey}
          isStreaming={Boolean(isStreaming && !errorMessage)}
          timelineGroups={timelineGroups}
          timelineOpenState={timelineOpenState}
          setTimelineOpenState={setTimelineOpenState}
          showReasoningSummaries={showReasoningSummaries}
          shellToolPartsExpanded={shellToolPartsExpanded}
          editToolPartsExpanded={editToolPartsExpanded}
          onOpenTaskSession={onOpenTaskSession}
          onOpenToolFile={onOpenToolFile}
          onOpenBrowserUrl={onOpenBrowserUrl}
          renderMarkdown={renderMarkdown}
        />
      ) : null}
      {/* 插话多回合后常见：live 只剩 tool、「已查询」在时间线，正文只在 msg.content。
          旧逻辑 hasTimeline 时不渲染 fallback → 前几轮答复闪现后消失。 */}
      {showFallbackReply ? (
        <AssistantTextBlock
          text={fallbackReply}
          streaming={Boolean(isStreaming && !timelineHasTextPart)}
          renderMarkdown={renderMarkdown}
        />
      ) : !hasTimeline && isStreaming && !errorMessage ? (
        <ThinkingPlaceholder todoItems={todoItems} />
      ) : null}
      {detailsError ? (
        <div className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden px-0 py-1.5 whitespace-nowrap">
            <ActivityStatus
              active={false}
              activeLabel="详情失败"
              doneLabel="详情失败"
              className="text-sm text-destructive"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{detailsError}</span>
          </div>
        </div>
      ) : null}
      {/* 时间线内已有 runtime.failure 时不再重复底部横幅 */}
      {errorMessage && !renderPartsHasFailure(row.renderParts) ? <AgentErrorMessage message={errorMessage} /> : null}
    </div>
  );
}

function renderPartsHasFailure(parts: AgentDetailedPart[]): boolean {
  return parts.some((part) => String((part as { type?: string }).type || "") === "runtime.failure");
}

function isPauseFailureText(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return /^(已暂停|已中止|aborted)$/i.test(value) || /中止|暂停|已停止|abort/i.test(value);
}

function isFailureOnlyAssistantRow(row: AgentMessageRenderRow): boolean {
  if (!row.isAssistant) return false;
  if (row.fallbackReply.trim()) return false;
  const substantive = row.renderParts.some((part) => {
    const type = String((part as { type?: string }).type || "");
    return type !== "runtime.failure" && type !== "runtime.retry" && type !== "runtime.memory" && type !== "turn-boundary";
  });
  if (substantive) return false;
  return Boolean(row.errorMessage.trim() || renderPartsHasFailure(row.renderParts));
}

/** 同一次暂停产生的多条「运行失败/已暂停」空气泡并入上一条 assistant，只留一条终态。 */
function collapseDuplicateFailureRows(
  rows: AgentMessageRenderRow[],
  showReasoningSummaries: boolean
): AgentMessageRenderRow[] {
  const out: AgentMessageRenderRow[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (!row.isAssistant || !last?.isAssistant) {
      out.push(row);
      continue;
    }

    const rowFailureOnly = isFailureOnlyAssistantRow(row);
    const lastFailureOnly = isFailureOnlyAssistantRow(last);

    const rebuild = (target: AgentMessageRenderRow) => {
      target.timelineGroups = buildDisplayTimelineGroups(
        buildAgentAssistantRenderGroups(target.renderParts),
        showReasoningSummaries
      );
      target.hasTimeline = target.timelineGroups.length > 0;
      target.fallbackReply = (
        buildAgentReplyMarkdownFromParts(target.renderParts) ||
        target.msg.content ||
        ""
      ).trim();
      if (renderPartsHasFailure(target.renderParts)) {
        target.errorMessage = "";
      }
    };

    if (rowFailureOnly && last.isAssistant) {
      const failureText = row.errorMessage || last.errorMessage || "已暂停";
      last.renderParts = coalesceRuntimeParts(
        dedupeAgentToolParts([...last.renderParts, ...row.renderParts])
      );
      last.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
      if (!renderPartsHasFailure(last.renderParts) && failureText) {
        last.errorMessage = last.errorMessage || failureText;
      }
      rebuild(last);
      continue;
    }

    if (lastFailureOnly && (row.hasTimeline || row.fallbackReply || rowFailureOnly)) {
      const failureText = last.errorMessage || row.errorMessage || "已暂停";
      row.renderParts = coalesceRuntimeParts(
        dedupeAgentToolParts([...last.renderParts, ...row.renderParts])
      );
      row.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
      row.isStreaming = last.isStreaming || row.isStreaming;
      row.todoItems = row.todoItems.length > 0 ? row.todoItems : last.todoItems;
      row.stableKey = last.stableKey;
      row.msg = {
        ...row.msg,
        id: `${last.msg.id}:${row.msg.id}`,
        error: row.msg.error || last.msg.error
      };
      if (!renderPartsHasFailure(row.renderParts) && failureText) {
        row.errorMessage = row.errorMessage || failureText;
      }
      rebuild(row);
      out[out.length - 1] = row;
      continue;
    }

    out.push(row);
  }
  return out;
}

/* coalesceRuntimeParts: 见 ../../lib/agentParts */


/** live 非空时仍并入 history 里缺失的 toolCall，避免仅有 text:* live 整表盖掉工具 → 数量闪动。 */
function mergeLiveWithFetchedParts(
  liveParts: AgentDetailedPart[],
  fetchedParts: AgentDetailedPart[]
): AgentDetailedPart[] {
  if (liveParts.length === 0) return fetchedParts;
  if (fetchedParts.length === 0) return liveParts;
  const merged = [...liveParts];
  const seen = new Set(
    merged.map((part) =>
      String((part as { id?: string }).id || (part as { toolCallId?: string }).toolCallId || "").trim()
    ).filter(Boolean)
  );
  for (const part of fetchedParts) {
    const type = String((part as { type?: string }).type || "");
    if (type !== "toolCall") continue;
    const id = String(
      (part as { id?: string }).id || (part as { toolCallId?: string }).toolCallId || ""
    ).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(part);
  }
  return merged;
}

function RuntimeRetryPart({ part }: { part: AgentDetailedPart }) {
  const [open, setOpen] = useState(false);
  const phase = String((part as { phase?: string }).phase || "").trim();
  const attempt = Number((part as { attempt?: number }).attempt) || 0;
  const maxAttempts = Number((part as { maxAttempts?: number }).maxAttempts) || 0;
  const success = (part as { success?: boolean | null }).success;
  const error = String((part as { error?: string }).error || "").trim();
  const attemptLabel = maxAttempts > 0 ? `${attempt}/${maxAttempts}` : String(attempt || "?");
  const running = phase === "started" || (phase === "completed" && success === false && !error);
  const failed = phase === "completed" && success === false;
  const recovered = phase === "completed" && success === true;
  const doneLabel = recovered ? "已重试" : "重试失败";
  const preview = error
    ? error.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || error
    : recovered
      ? "请求已恢复"
      : running
        ? "自动重试中"
        : "";
  const canExpand = Boolean(error);

  const header = (
    <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
      <ActivityStatus
        active={running}
        activeLabel="重试中"
        doneLabel={doneLabel}
        className={cn("text-sm", !running && failed && "text-destructive")}
      />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{attemptLabel}</span>
      {!open && preview ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">· {preview}</span>
      ) : null}
    </span>
  );

  if (!canExpand) {
    return (
      <div className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1" aria-live="polite">
        <div className="flex min-w-0 items-center overflow-hidden px-0 py-1.5">{header}</div>
      </div>
    );
  }

  return (
    <Collapsible
      className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1"
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger asChild>
        <Button
          className="h-auto w-full min-w-0 justify-start overflow-hidden rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground"
          variant="ghost"
        >
          {header}
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent open={open}>
        <div className="min-w-0 max-w-full overflow-hidden pb-2 pl-3 text-sm text-muted-foreground">
          <p className="min-w-0 max-w-full select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {error}
          </p>
        </div>
      </AnimatedCollapsibleContent>
    </Collapsible>
  );
}

const MEMORY_ENTITY_TYPE_LABELS: Record<string, string> = {
  decision: "决策",
  feature: "功能",
  module: "模块",
  tech_concept: "技术",
  error_pattern: "错误模式",
  api: "接口",
  tradeoff: "取舍",
  open_task: "待办"
};

function MemoryExtractionPart({
  part,
  listItem = false
}: {
  part: AgentDetailedPart;
  listItem?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const phase = String((part as { phase?: string }).phase || "").trim();
  const entityCount = Number((part as { entityCount?: number }).entityCount) || 0;
  const relationCount = Number((part as { relationCount?: number }).relationCount) || 0;
  const intent = String((part as { intent?: string }).intent || "").trim();
  const error = String((part as { error?: string }).error || "").trim();
  const entities = Array.isArray((part as { entities?: unknown }).entities)
    ? ((part as { entities: Array<{ type?: string; title?: string }> }).entities)
    : [];
  const quality = String((part as { quality?: string }).quality || "").trim().toLowerCase();
  const priority = String((part as { priority?: string }).priority || "").trim().toLowerCase();
  const running = phase === "started";
  const failed = phase === "failed";
  // intent 写回 session 节点也算一次真实写入；全空（寒暄轮）的完成行不渲染。
  // 与后端 quality/priority 门控对齐：仅 high 或 priority-high 出完成卡。
  const lowSignal =
    !running &&
    !failed &&
    ((quality === "low" || quality === "medium") && priority !== "high");
  const empty = !running && !failed && entityCount === 0 && relationCount === 0 && !intent;
  if (empty || lowSignal) return null;
  const doneLabel = failed ? "记忆写入失败" : "已写入记忆";
  const countPreview =
    entityCount > 0 || relationCount > 0
      ? `${entityCount} 个实体 · ${relationCount} 条关系`
      : "";
  const preview = failed
    ? (error.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || error || "抽取失败")
    : countPreview || intent || (running ? "沉淀本轮决策与实体" : "");
  const canExpand = entities.length > 0 || Boolean(error);

  const header = (
    <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
      <ActivityStatus
        active={running}
        activeLabel="写入记忆中"
        doneLabel={doneLabel}
        className={cn("text-sm", !running && failed && "text-destructive")}
      />
      {!open && preview ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">· {preview}</span>
      ) : null}
    </span>
  );

  const body = (
    <div className="min-w-0 max-w-full overflow-hidden pb-2 pl-3 text-sm text-muted-foreground">
      {intent ? (
        <p className="mb-2 min-w-0 max-w-full select-text break-words [overflow-wrap:anywhere]">
          {intent}
        </p>
      ) : null}
      {entities.length > 0 ? (
        <ul className="grid gap-1">
          {entities.map((entity, index) => {
            const typeKey = String(entity.type || "").trim();
            const typeLabel = MEMORY_ENTITY_TYPE_LABELS[typeKey] || typeKey || "实体";
            const title = String(entity.title || "").trim();
            if (!title) return null;
            return (
              <li
                key={`${typeKey}:${title}:${index}`}
                className="flex min-w-0 items-baseline gap-2 text-xs"
              >
                <span className="shrink-0 text-muted-foreground/80">{typeLabel}</span>
                <span className="min-w-0 flex-1 select-text truncate text-foreground/90">{title}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <p className="min-w-0 max-w-full select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );

  if (!canExpand) {
    return (
      <div
        className={cn(
          "grid min-w-0 max-w-full gap-1 overflow-hidden",
          listItem ? "py-0.5" : "py-1"
        )}
        aria-live="polite"
      >
        <div className={cn("flex min-w-0 items-center overflow-hidden px-0", listItem ? "py-1" : "py-1.5")}>
          {header}
        </div>
      </div>
    );
  }

  return (
    <Collapsible
      className={cn("grid min-w-0 max-w-full gap-1 overflow-hidden", listItem ? "py-0.5" : "py-1")}
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger asChild>
        <Button
          className={cn(
            "h-auto w-full min-w-0 justify-start overflow-hidden rounded-md px-0 text-left hover:bg-transparent hover:text-foreground",
            listItem ? "py-1" : "py-1.5"
          )}
          variant="ghost"
        >
          {header}
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent open={open}>{body}</AnimatedCollapsibleContent>
    </Collapsible>
  );
}

function AgentErrorMessage({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const text = message.trim();
  if (!text) return null;
  const paused = /^(已暂停|已中止|aborted)$/i.test(text) || /中止|暂停|已停止|abort/i.test(text);
  const label = paused ? "已暂停" : "运行失败";
  const preview =
    paused
      ? ""
      : text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) || text;
  const long = !paused && (text.length > 96 || text.includes("\n"));

  const header = (
    <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
      <ActivityStatus
        active={false}
        activeLabel={label}
        doneLabel={label}
        className="text-sm text-destructive"
      />
      {!open && preview ? (
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</span>
      ) : null}
    </span>
  );

  if (!long) {
    return (
      <div className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1" role="alert" aria-live="polite">
        <div className="flex min-w-0 items-center overflow-hidden px-0 py-1.5">{header}</div>
      </div>
    );
  }

  return (
    <Collapsible
      className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1"
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger asChild>
        <Button
          className="h-auto w-full min-w-0 justify-start overflow-hidden rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground"
          variant="ghost"
        >
          {header}
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent open={open}>
        <div className="min-w-0 max-w-full overflow-hidden pb-2 pl-3 text-sm text-muted-foreground">
          <p className="min-w-0 max-w-full select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {text}
          </p>
        </div>
      </AnimatedCollapsibleContent>
    </Collapsible>
  );
}

function MessageAttachments({
  attachments,
  className,
  onPreviewImageGroup,
  onCopyAttachmentUri,
  onOpenAttachment
}: {
  attachments: AgentMessageAttachment[];
  className?: string;
  onPreviewImageGroup: (images: AgentPreviewImage[], index: number) => void;
  onCopyAttachmentUri: (uri: string) => void;
  onOpenAttachment: (uri: string, filename?: string, mime?: string) => void;
}) {
  const imageAttachments = attachments.filter(isMessageImageAttachment);
  const fileAttachments = attachments.filter((attachment) => !isMessageImageAttachment(attachment));
  const previewImages = imageAttachments.map((item) => ({
    uri: item.uri,
    filename: item.filename
  }));
  if (attachments.length <= 0) return null;
  const imageColumnCount = Math.min(imageAttachments.length, 3);

  return (
    <div className={cn("grid min-w-0 select-none gap-2", className)}>
      {imageAttachments.length > 0 ? (
        <div
          className="grid max-w-full gap-2.5"
          style={{ gridTemplateColumns: `repeat(${imageColumnCount}, minmax(112px, 136px))` }}
          aria-label="图片附件"
        >
          {imageAttachments.map((attachment) => (
            <Button
              key={attachment.id}
              className="aspect-square h-auto min-h-0 w-full overflow-hidden rounded-[18px] border border-border/60 bg-background p-1 shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:border-border/80 hover:bg-background"
              onClick={() => onPreviewImageGroup(
                previewImages,
                Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id))
              )}
              onContextMenu={(event) => {
                event.preventDefault();
                onCopyAttachmentUri(attachment.uri);
              }}
              title="点击查看，右键复制图片数据"
              variant="ghost"
            >
              <img
                className="pointer-events-none size-full rounded-[14px] border border-border/35 bg-background object-contain"
                src={attachment.uri}
                alt={attachment.filename || "图片附件"}
                loading="lazy"
                draggable={false}
              />
            </Button>
          ))}
        </div>
      ) : null}
      {fileAttachments.length > 0 ? (
        <div
          className="grid max-w-full gap-2.5"
          style={{ gridTemplateColumns: `repeat(${Math.min(fileAttachments.length, 3)}, minmax(112px, 136px))` }}
          aria-label="文件附件"
        >
          {fileAttachments.map((attachment) => (
            <Button
              key={attachment.id}
              className="aspect-square h-auto min-h-0 w-full overflow-hidden rounded-[18px] border border-border/60 bg-background p-1 shadow-[0_1px_2px_rgba(15,23,42,0.06)] hover:border-border/80 hover:bg-background"
              onClick={() => onOpenAttachment(attachment.uri, attachment.filename, attachment.mime)}
              onContextMenu={(event) => {
                event.preventDefault();
                onCopyAttachmentUri(attachment.uri);
              }}
              title={attachment.filename || attachment.mime || "附件"}
              variant="ghost"
            >
              <span className="flex size-full items-center justify-center rounded-[14px] border border-border/35 bg-muted/45">
                <span className="max-w-[72px] truncate rounded-md bg-background/80 px-2 py-1 text-[12px] font-semibold tracking-normal text-foreground/85">
                  {getAttachmentBadgeLabel({ mime: attachment.mime || "", filename: attachment.filename || "" })}
                </span>
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AgentMessageStream({
  sessionLoading,
  messages,
  renderedMessages,
  activeStreamingAssistantId,
  activeSessionBusy,
  serverMessageIdByLocalId,
  detailsByMessageId,
  livePartsByServerMessageId,
  detailsLoadingByMessageId,
  detailsErrorByMessageId,
  showReasoningSummaries,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  workspaceRoot = "",
  workspaceFileCandidates = [],
  workspaceDirectoryCandidates = [],
  onOpenTaskSession,
  onOpenWorkspacePath,
  onOpenWorkspaceDirectory,
  onOpenLocalDirectory,
  onOpenToolFile,
  onOpenBrowserUrl,
  onPreviewImageGroup,
  onCopyAttachmentUri,
  onOpenAttachment,
  activeSessionId,
  onStartReached,
  onAtBottomChange,
  scrollerRef,
  virtuosoRef,
  onRangeChanged,
  pendingScrollMessageId,
  onPendingScrollDone,
  locateNonce = 0,
  highlightKeyword,
  text,
  navigatorHidden = false,
  navigatorSide = "right",
  navigatorScope = "all",
  stickResetSignal = 0
}: AgentMessageStreamProps) {
  const [timelineOpenState, setTimelineOpenState] = useState<Record<string, boolean>>({});
  const [messageOpenState, setMessageOpenState] = useState<Record<string, boolean>>({});
  const [highlightMessageId, setHighlightMessageId] = useState("");
  /** 当前可视区中部对应的消息下标，由 Virtuoso rangeChanged 换算，用于把导航条对应 marker 变蓝。 */
  const [navigatorActiveIndex, setNavigatorActiveIndex] = useState<number | null>(null);
  /** 本会话已完成过搜索定位：禁止随后的「滚到底唤醒」抢走视口，也避免清掉关键词高亮。 */
  const locatedThisSessionRef = useRef(false);
  /**
   * 定位成功后 sticky mount key，避免 pending 清空时 key 回退导致二次 remount（抖动）。
   * @see https://virtuoso.dev/react-virtuoso/virtuoso/initial-index/
   */
  const locateStickyMountKeyRef = useRef<string | null>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  /**
   * 用户「贴底跟随」意图：默认 true。
   * 取消 stick 只认明确用户手势（wheel/touch 上滚、滚动条拖拽、键盘上滚）——
   * 绝不能靠 scrollTop 下降推断：Virtuoso 在同 row 变高（工具事件）时会重测高度并
   * 锚点补偿拉低 scrollTop，且常发生在 scrollHeight 已稳定的后续帧，会被误判成上滚。
   * @see https://github.com/petyosi/react-virtuoso/issues/195 （followOutput 不管 item 变高）
   * @see https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/ （autoscrollToBottom）
   */
  const stickToBottomRef = useRef(true);
  /** 用户正在拖原生滚动条（pointer 落在 gutter/轨道上）；仅此时才允许因 scrollTop 下降取消 stick。 */
  const scrollbarDraggingRef = useRef(false);
  const scrollerListenersRef = useRef<{ el: HTMLElement; clean: () => void } | null>(null);
  // 搜索定位进行中/本会话已定位过：rAF 钉底须避让，否则会把定位滚动拉回底部、抢走视口。
  const pendingLocateIdRef = useRef("");
  /** 是否允许钉底（与 rAF / followOutput / totalListHeightChanged 共用）。 */
  const canStickPin = () =>
    stickToBottomRef.current
    && !pendingLocateIdRef.current
    && !locatedThisSessionRef.current;
  /**
   * DOM 实测校正：Virtuoso 对变高 item 用 defaultItemHeight(160) 估算累计偏移，超长消息（数千字
   * toolResult / 长 assistant 回复）估算严重偏小 → scrollToIndex 的 align:center 落到结尾、
   * align:end 的 LAST 落点偏上看不到最新、initialTopMostItemIndex 同理锚偏。在 Virtuoso 滚动后
   * 用真实 DOM 位置 scrollBy 校正，彻底绕过高度估算。
   *   - center：消息中线对齐视口中线（真居中，标尺跳转用）
   *   - end：消息底部对齐视口底部（真贴底，切会话唤醒 / 流式钉底用）
   * 返回校正函数；调用方在多个 setTimeout/raf 上重试，覆盖 Virtuoso 异步渲染与测量收敛。
   */
  const adjustToMessage = useCallback((stableKey: string, align: "start" | "center" | "end") => {
    const sel = `[data-message-id="${CSS.escape(stableKey)}"]`;
    return () => {
      const el = document.querySelector<HTMLElement>(sel);
      const sc = scrollerElRef.current;
      if (!el || !sc) return;
      const e = el.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      const delta =
        align === "start"
          ? e.top - s.top
          : align === "end"
            ? e.bottom - s.bottom
            : e.top + e.height / 2 - (s.top + s.height / 2);
      if (Math.abs(delta) >= 8) sc.scrollBy({ top: delta, behavior: "auto" });
    };
  }, []);
  const latestAssistantId = [...messages].reverse().find((row) => row.role === "assistant")?.id || "";
  const openLocalFile = (absolutePath: string) => {
    onOpenAttachment(localPathToFileUrl(absolutePath), filenameFromPath(absolutePath));
  };
  const renderMarkdown = (source: string, streaming = false) => (
    <MarkdownLite
      source={source}
      streaming={streaming}
      workspaceRoot={workspaceRoot}
      workspaceFileCandidates={workspaceFileCandidates}
      workspaceDirectoryCandidates={workspaceDirectoryCandidates}
      onOpenWorkspacePath={onOpenWorkspacePath}
      onOpenWorkspaceDirectory={onOpenWorkspaceDirectory}
      onOpenLocalDirectory={onOpenLocalDirectory}
      onOpenLocalFile={openLocalFile}
    />
  );
  const renderRows: AgentMessageRenderRow[] = renderedMessages.map((msg) => {
    const isAssistant = msg.role === "assistant";
    const isSystem = !isAssistant && msg.content.trimStart().startsWith("[runtime]");
    const isStreaming = isAssistant && msg.id === activeStreamingAssistantId && msg.id === latestAssistantId && activeSessionBusy;
    // local 乐观 id → 服务端 id；对账后 msg.id 本身就是服务端 id，需直接回查 live，
    // 否则 remap 瞬间 live 还在却查不到，提前切到 history，过程态/结束态事件汇总跳变。
    const mappedServerMid = (serverMessageIdByLocalId[msg.id] || "").trim();
    const detail = isAssistant ? (detailsByMessageId[msg.id] || detailsByMessageId[mappedServerMid] || null) : null;
    const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as AgentDetailedPart[]) : [];
    const liveParts =
      (mappedServerMid && livePartsByServerMessageId[mappedServerMid]) ||
      livePartsByServerMessageId[msg.id] ||
      [];
    const detailParts = coalesceRuntimeParts(
      mergeLiveWithFetchedParts(liveParts, fetchedParts).map((part) => {
        // 兼容旧 bug：reasoning 流曾被误标成 text，导致思考正文与「思考中」标签分离
        const id = String((part as { id?: string }).id || "").trim();
        const type = String((part as { type?: string }).type || "");
        if (type === "text" && (id === "reasoning" || id.startsWith("reasoning:"))) {
          return { ...(part as object), type: "reasoning" } as AgentDetailedPart;
        }
        return part;
      })
    );
    const renderParts = dedupeAgentDuplicateTextParts(
      dedupeAgentToolParts(detailParts.filter(isAgentRenderablePart))
    );
    const errorMessage = isAssistant ? runFailureText(msg) : "";
    const todoItems = [...detailParts].reverse().map(readAgentTodosFromPart).find((todos) => todos.length > 0) || [];
    const timelineGroups = buildDisplayTimelineGroups(
      buildAgentAssistantRenderGroups(renderParts),
      showReasoningSummaries
    );
    // 时间线已有 text part 时 fallbackReply 直接为空：msg.content 与 text part 是同一内容的
    // 两种存在形式，二者只渲染一个。流式中间态 detailParts 去重后只剩一个 text part，若此时
    // fallbackReply 仍从 msg.content 取值，就会把「已折叠的完整文本」再叠一份，造成双份正文。
    const timelineHasTextPart = renderParts.some((part) => {
      const type = String((part as { type?: string }).type || "");
      return type === "text" && Boolean(String((part as { text?: string }).text || "").trim());
    });
    const fallbackReply = errorMessage
      ? ""
      : (timelineHasTextPart ? "" : (buildAgentReplyMarkdownFromParts(detailParts) || msg.content || "").trim());
    return {
      msg,
      stableKey: msg.id,
      isAssistant,
      isSystem,
      isStreaming,
      liveParts,
      renderParts,
      timelineGroups,
      hasTimeline: timelineGroups.length > 0,
      fallbackReply,
      detailsLoading: detailsLoadingByMessageId[msg.id],
      detailsError: detailsErrorByMessageId[msg.id] || "",
      errorMessage,
      contextOnly: isAssistant && timelineGroups.length > 0 && timelineGroups.every((group) => group.kind === "context") && !fallbackReply,
      todoItems
    };
  });
  const mergedRenderRows = renderRows.reduce<AgentMessageRenderRow[]>((out, row) => {
    const last = out[out.length - 1];
    const pauseMerge =
      row.isAssistant
      && last?.isAssistant
      && (
        isPauseFailureText(last.errorMessage)
        || isPauseFailureText(row.errorMessage)
        || isFailureOnlyAssistantRow(last)
        || isFailureOnlyAssistantRow(row)
      );
    if (row.isAssistant && last?.isAssistant && ((!last.errorMessage && !row.errorMessage) || pauseMerge)) {
      const rebuildTimeline = (target: AgentMessageRenderRow) => {
        target.renderParts = dedupeAgentDuplicateTextParts(
          coalesceRuntimeParts(dedupeAgentToolParts(target.renderParts))
        );
        target.timelineGroups = buildDisplayTimelineGroups(
          buildAgentAssistantRenderGroups(target.renderParts),
          showReasoningSummaries
        );
        target.hasTimeline = target.timelineGroups.length > 0;
        const hasTextPart = target.renderParts.some((part) => {
          const type = String((part as { type?: string }).type || "");
          return type === "text" && Boolean(String((part as { text?: string }).text || "").trim());
        });
        // 有 text part 时不再用 content 做 fallback，避免与时间线正文叠成双份。
        target.fallbackReply = hasTextPart
          ? ""
          : (buildAgentReplyMarkdownFromParts(target.renderParts) || target.msg.content || "").trim();
        if (renderPartsHasFailure(target.renderParts)) {
          target.errorMessage = "";
        } else {
          target.errorMessage = target.errorMessage || last.errorMessage || row.errorMessage;
        }
        target.contextOnly =
          target.timelineGroups.length > 0 &&
          target.timelineGroups.every((group) => group.kind === "context") &&
          !target.fallbackReply;
      };
      if (isEmptyAssistantPlaceholder(last) || isFailureOnlyAssistantRow(last)) {
        row.isStreaming = last.isStreaming || row.isStreaming;
        row.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
        row.renderParts = dedupeAgentToolParts([...last.renderParts, ...row.renderParts]);
        row.detailsLoading = last.detailsLoading || row.detailsLoading;
        row.todoItems = row.todoItems.length > 0 ? row.todoItems : last.todoItems;
        row.stableKey = last.stableKey;
        row.errorMessage = row.errorMessage || last.errorMessage;
        row.msg = {
          ...row.msg,
          id: `${last.msg.id}:${row.msg.id}`,
          error: row.msg.error || last.msg.error
        };
        rebuildTimeline(row);
        out[out.length - 1] = row;
        return out;
      }
      if (isEmptyAssistantPlaceholder(row) || isFailureOnlyAssistantRow(row)) {
        last.isStreaming = last.isStreaming || row.isStreaming;
        last.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
        last.renderParts = dedupeAgentToolParts([...last.renderParts, ...row.renderParts]);
        if (row.todoItems.length > 0) last.todoItems = row.todoItems;
        last.errorMessage = last.errorMessage || row.errorMessage;
        last.msg = {
          ...last.msg,
          id: `${last.msg.id}:${row.msg.id}`,
          error: last.msg.error || row.msg.error
        };
        rebuildTimeline(last);
        return out;
      }
      // 相邻「仅工具时间线」assistant 合并成同一单元格，避免已探索/已回忆被消息 pb-4 拆开行距。
      // 「工具轮 ↔ 正文轮」仍保持独立（任一侧含 text/fallback 则不合并）。
      const lastTimelineOnly =
        last.hasTimeline
        && !last.fallbackReply.trim()
        && !last.errorMessage
        && !last.renderParts.some((part) => {
          const type = String((part as { type?: string }).type || "");
          return type === "text" && Boolean(String((part as { text?: string }).text || "").trim());
        });
      const rowTimelineOnly =
        row.hasTimeline
        && !row.fallbackReply.trim()
        && !row.errorMessage
        && !row.renderParts.some((part) => {
          const type = String((part as { type?: string }).type || "");
          return type === "text" && Boolean(String((part as { text?: string }).text || "").trim());
        });
      if (lastTimelineOnly && rowTimelineOnly) {
        last.isStreaming = last.isStreaming || row.isStreaming;
        last.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
        last.renderParts = dedupeAgentToolParts([...last.renderParts, ...row.renderParts]);
        last.detailsLoading = last.detailsLoading || row.detailsLoading;
        if (row.todoItems.length > 0) last.todoItems = row.todoItems;
        last.msg = {
          ...last.msg,
          id: `${last.msg.id}:${row.msg.id}`,
          error: last.msg.error || row.msg.error
        };
        rebuildTimeline(last);
        return out;
      }
      // 工具轮与正文轮保持独立单元格（Codex exec cell → agent cell）。
      if (last.hasTimeline || row.hasTimeline || last.fallbackReply || row.fallbackReply) {
        // 插话收尾常见：状态层残留两条同文 assistant（磁盘仅一条）。展示层折叠，保留较完整的一条。
        const lastText = (last.fallbackReply || last.msg.content || "").trim();
        const rowText = (row.fallbackReply || row.msg.content || "").trim();
        if (
          lastText
          && rowText
          && lastText === rowText
          && !last.isStreaming
          && !row.isStreaming
          && !last.errorMessage
          && !row.errorMessage
        ) {
          const preferRow =
            row.renderParts.length > last.renderParts.length
            || (row.hasTimeline && !last.hasTimeline)
            || row.msg.content.length >= last.msg.content.length;
          if (preferRow) {
            row.stableKey = last.stableKey;
            out[out.length - 1] = row;
          }
          return out;
        }
        out.push(row);
        return out;
      }
      last.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
      last.renderParts = dedupeAgentToolParts([...last.renderParts, ...row.renderParts]);
      last.isStreaming = last.isStreaming || row.isStreaming;
      last.detailsLoading = last.detailsLoading || row.detailsLoading;
      last.detailsError = last.detailsError || row.detailsError;
      last.errorMessage = last.errorMessage || row.errorMessage;
      if (row.todoItems.length > 0) last.todoItems = row.todoItems;
      last.msg = {
        ...last.msg,
        id: `${last.msg.id}:${row.msg.id}`,
        content: row.msg.content || last.msg.content,
        error: last.msg.error || row.msg.error
      };
      rebuildTimeline(last);
      return out;
    }
    out.push(row);
    return out;
  }, []);
  const visibleRenderRows = collapseDuplicateFailureRows(
    mergedRenderRows.filter((row) => {
      if (!isEmptyAssistantPlaceholder(row)) return true;
      // 仅当前流式等待首包时保留空占位；loading/历史空行一律丢掉，避免多余「思考中」
      return row.isStreaming;
    }),
    showReasoningSummaries
  );

  // 导航条数据：每行一个 marker（角色 + 首行预览），跳转沿用原始下标。
  const allNavigatorMarkers: NavigatorMarker[] = visibleRenderRows.map((row, index) => ({
    key: row.stableKey,
    originalIndex: index,
    role: row.isSystem ? "system" : row.isAssistant ? "assistant" : "user",
    preview: navigatorFirstLine(row.isAssistant ? row.fallbackReply || row.msg.content : row.msg.content)
  }));
  // scope=sent 只保留「我发送」的 user 消息；originalIndex 仍指向 visibleRenderRows 真实下标，跳转/active 匹配正确。
  const navigatorMarkers: NavigatorMarker[] =
    navigatorScope === "sent" ? allNavigatorMarkers.filter((m) => m.role === "user") : allNavigatorMarkers;
  const handleNavigatorJump = useCallback(
    (index: number, behavior: "smooth" | "auto") => {
      // 点标尺跳转 = 用户主动离开贴底跟随 → 必须先取消 stick，否则持续 rAF 钉底会立即把视口
      // 拉回底部，导致「贴底时点标尺跳不过去」。跳到底部时 atBottom=true 会自动恢复 stick。
      stickToBottomRef.current = false;
      const stableKey = visibleRenderRows[index]?.stableKey;
      if (!stableKey) return;
      const total = visibleRenderRows.length;
      // 列表首/尾消息无法真正居中（上方/下方无内容），用 start/end 贴顶/贴底是最接近「居中」的落点；
      // 也避开 Virtuoso 对边界 item 的 center 估算落点偏（点最旧标尺却停在半路的根因）。中间消息才 center。
      const target: "start" | "center" | "end" =
        index <= 0 ? "start" : index >= total - 1 ? "end" : "center";
      const sc = scrollerElRef.current;
      const el = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(stableKey)}"]`
      );
      // 已在渲染范围内：直接 DOM 实测 scrollBy 一步到位——绕过 Virtuoso defaultItemHeight 估算，
      // 既准又无「smooth 动画被校正打断」的二次上下偏移。behavior 透传（点击 smooth / 拖动 auto）。
      if (el && sc) {
        const e = el.getBoundingClientRect();
        const s = sc.getBoundingClientRect();
        const delta =
          target === "start"
            ? e.top - s.top
            : target === "end"
              ? e.bottom - s.bottom
              : e.top + e.height / 2 - (s.top + s.height / 2);
        sc.scrollBy({ top: delta, behavior });
        return;
      }
      // 不在渲染范围（远处跳转）：scrollToIndex 先把目标拉进视口，立即 + rAF 连续校正到目标对齐。
      // scrollToIndex(auto) 与首帧校正同步执行、浏览器合并渲染 → 用户只见一次到位；后续 rAF
      // 兜底 Virtuoso 异步测量收敛，到位后 adjustToMessage 内 |delta|<8 不再 scrollBy，不反复偏移。
      virtuosoRef.current?.scrollToIndex({ index, align: target, behavior: "auto" });
      const adjust = adjustToMessage(stableKey, target);
      const sel = `[data-message-id="${CSS.escape(stableKey)}"]`;
      adjust();
      let frames = 0;
      const step = () => {
        adjust();
        if (++frames < 6) {
          requestAnimationFrame(step);
        } else if (target === "start") {
          // start 仅用于 index=0（列表物理顶）。若末帧仍未渲染到首条（Virtuoso 高度估算错位把渲染窗口
          // 拉偏、querySelector 找不到），直接把滚动容器拉到物理顶——scrollTop=0 永远对应 index=0。
          const sc = scrollerElRef.current;
          if (sc && !document.querySelector<HTMLElement>(sel) && sc.scrollTop > 0) {
            sc.scrollTo({ top: 0, behavior: "auto" });
          }
        }
      };
      requestAnimationFrame(step);
    },
    [visibleRenderRows, adjustToMessage]
  );
  // 取消 stick 只认用户手势；Virtuoso 重测/锚点补偿造成的 scrollTop 变化一律忽略。
  // @see https://github.com/petyosi/react-virtuoso/issues/195
  const attachScrollerListeners = useCallback((el: HTMLElement) => {
    if (scrollerListenersRef.current?.el === el) return; // Virtuoso 可能多次回传同一 el
    scrollerListenersRef.current?.clean();
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickToBottomRef.current = false;
    };
    let lastTouchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? null;
      if (lastTouchY != null && y != null && y < lastTouchY) stickToBottomRef.current = false;
      lastTouchY = y;
    };
    // 原生滚动条拖拽：落点在 clientWidth 右侧 gutter（scrollbar-gutter:stable）才算。
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.offsetX >= el.clientWidth - 1) {
        scrollbarDraggingRef.current = true;
      }
    };
    const endScrollbarDrag = () => {
      scrollbarDraggingRef.current = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") {
        stickToBottomRef.current = false;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointerup", endScrollbarDrag, { passive: true });
    el.addEventListener("pointercancel", endScrollbarDrag, { passive: true });
    window.addEventListener("pointerup", endScrollbarDrag, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    scrollerListenersRef.current = {
      el,
      clean: () => {
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointerup", endScrollbarDrag);
        el.removeEventListener("pointercancel", endScrollbarDrag);
        window.removeEventListener("pointerup", endScrollbarDrag);
        el.removeEventListener("keydown", onKeyDown);
      }
    };
  }, []);

  // Virtuoso scrollerRef 是 callback；包一层把 DOM 存到本地 ref（定位校正/钉底用）+ 挂手势。
  const handleScrollerRef = useCallback(
    (node: HTMLElement | Window | null) => {
      const el = node instanceof HTMLElement ? node : null;
      scrollerElRef.current = el;
      if (el) attachScrollerListeners(el);
      scrollerRef(node);
    },
    [attachScrollerListeners, scrollerRef]
  );

  // 持续 rAF 钉底：同 row 变高（工具事件）时 followOutput 无效（官方 issue #195），
  // 必须靠物理钉 scrollTop；取消 stick 只在「正在拖滚动条且离开底部」时发生。
  useEffect(() => {
    let raf = 0;
    let lastTop = -1;
    const tick = () => {
      const sc = scrollerElRef.current;
      if (sc) {
        const max = sc.scrollHeight - sc.clientHeight;
        const top = sc.scrollTop;
        if (canStickPin() && max >= 0) {
          // 仅当用户正在拖滚动条、且明确离开底部时取消——Virtuoso 重测造成的 top 下降不取消。
          if (
            scrollbarDraggingRef.current
            && lastTop >= 0
            && top < lastTop - 2
            && top < max - 2
          ) {
            stickToBottomRef.current = false;
          } else if (top < max) {
            sc.scrollTop = max;
          }
        }
        lastTop = sc.scrollTop;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 外部（发送）强制恢复贴底跟随：signal 递增 → stick=true → 下一帧 rAF 钉底接管滚到底。
  const prevStickResetRef = useRef(stickResetSignal);
  useEffect(() => {
    if (stickResetSignal === prevStickResetRef.current) return;
    prevStickResetRef.current = stickResetSignal;
    stickToBottomRef.current = true;
  }, [stickResetSignal]);

  /** 列表总高度变化（含同 row 工具卡变高）：官方建议配合 followOutput 调 autoscrollToBottom。 */
  const handleTotalListHeightChanged = useCallback((_height: number) => {
    if (!canStickPin()) return;
    virtuosoRef.current?.autoscrollToBottom();
    const sc = scrollerElRef.current;
    if (sc) {
      const max = sc.scrollHeight - sc.clientHeight;
      if (max >= 0 && sc.scrollTop < max) sc.scrollTop = max;
    }
  }, [virtuosoRef]);

  /** followOutput：只对 item 数量变化生效；用 stick 意图覆盖 Virtuoso 自带的 isAtBottom 判断。 */
  const handleFollowOutput = useCallback((_isAtBottom: boolean) => {
    return canStickPin() ? ("auto" as const) : false;
  }, []);

  const pendingLocateId = pendingScrollMessageId?.trim() || "";
  pendingLocateIdRef.current = pendingLocateId;
  const pendingLocateIndex = pendingLocateId
    ? visibleRenderRows.findIndex((row) => rowMatchesMessageId(row, pendingLocateId))
    : -1;

  // 首帧同步算出 locate mount key，避免「先 LAST 挂载 → effect 再 remount」的二次跳动。
  // @see https://virtuoso.dev/react-virtuoso/virtuoso/initial-index/ （仅 mount 生效）
  // @see https://github.com/TanStack/virtual/discussions/579 （深链跳转：remount + initialOffset）
  const prevSessionIdForLocateRef = useRef(activeSessionId);
  if (prevSessionIdForLocateRef.current !== activeSessionId) {
    prevSessionIdForLocateRef.current = activeSessionId;
    locateStickyMountKeyRef.current = null;
    locatedThisSessionRef.current = false;
  }
  const activeLocateMountKey =
    !sessionLoading && pendingLocateId && pendingLocateIndex >= 0
      ? `${activeSessionId || "agent-thread"}:locate:${locateNonce}:${pendingLocateId}`
      : null;
  if (activeLocateMountKey) {
    locateStickyMountKeyRef.current = activeLocateMountKey;
    locatedThisSessionRef.current = true;
  }
  const virtuosoMountKey = locateStickyMountKeyRef.current || activeSessionId || "agent-thread";
  const initialLocateIndex =
    pendingLocateIndex >= 0
      ? pendingLocateIndex
      : virtuosoMountKey.includes(":locate:") && highlightMessageId
        ? visibleRenderRows.findIndex((row) => rowMatchesMessageId(row, highlightMessageId))
        : -1;

  // 切会话：清空高亮（sticky key 已在 render 期同步清掉）。
  useEffect(() => {
    setHighlightMessageId("");
  }, [activeSessionId]);

  // 搜索定位：展开折叠 + 标记高亮（滚动位置由 remount + initialTopMostItemIndex 负责）。
  useEffect(() => {
    const id = pendingLocateId;
    if (!id || sessionLoading) return;
    if (visibleRenderRows.length === 0) return;
    const idx = pendingLocateIndex;
    if (idx < 0) return;

    setHighlightMessageId(id);
    setMessageOpenState((prev) => {
      const next = { ...prev, [id]: true };
      const row = visibleRenderRows[idx];
      if (row?.msg.id) next[row.msg.id] = true;
      if (row?.stableKey) next[row.stableKey] = true;
      String(row?.msg.id || "")
        .split(":")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          next[part] = true;
        });
      return next;
    });
  }, [pendingLocateId, pendingLocateIndex, sessionLoading, visibleRenderRows.length, activeSessionId, locateNonce]);

  // remount 后校正定位：与标尺跳转同一套路——Virtuoso initialTopMostItemIndex / scrollToIndex
  // 都吃 defaultItemHeight(160) 估算，前置超长消息时落点会偏；必须用 DOM 实测多帧 scrollBy 收敛。
  // 流程：① 把命中消息拉进视口并对齐 start ② 等关键词 <mark> 出现后居中（对齐 highlight 重试节奏）。
  useEffect(() => {
    if (!pendingLocateId || sessionLoading) return;
    if (pendingLocateIndex < 0) return;
    if (!virtuosoMountKey.includes(":locate:")) return;

    const stableKey = visibleRenderRows[pendingLocateIndex]?.stableKey;
    if (!stableKey) return;

    let cancelled = false;
    let finished = false;
    const timers: number[] = [];
    const adjustMsg = adjustToMessage(stableKey, "start");
    const msgSel = `[data-message-id="${CSS.escape(stableKey)}"]`;

    const finish = () => {
      if (cancelled || finished) return;
      finished = true;
      onPendingScrollDone?.();
    };

    const findKeywordEl = (root: HTMLElement): HTMLElement | null => {
      const mark = root.querySelector<HTMLElement>("mark[data-search-hit]");
      if (mark) return mark;
      const query = (highlightKeyword || "").trim();
      if (!query) return null;
      const lowered = query.toLowerCase();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!(node.nodeValue || "").toLowerCase().includes(lowered)) continue;
        return node.parentElement;
      }
      return null;
    };

    /** ① 消息进视口 + DOM 校正到 start（标尺 distant-jump 同款）。 */
    const bringMessageIntoView = () => {
      if (cancelled || finished) return;
      const el = document.querySelector<HTMLElement>(msgSel);
      if (!el) {
        virtuosoRef.current?.scrollToIndex({
          index: pendingLocateIndex,
          align: "start",
          behavior: "auto"
        });
      }
      adjustMsg();
    };

    /** ② 关键词居中；未高亮完返回 false 以便重试。无关键词时消息到位即视为成功。 */
    const centerKeyword = (): boolean => {
      if (cancelled || finished) return false;
      const root =
        document.querySelector<HTMLElement>(`[data-locate-hit="1"]`) ||
        document.querySelector<HTMLElement>(msgSel);
      if (!root) return false;
      const query = (highlightKeyword || "").trim();
      if (!query) return true;
      const target = findKeywordEl(root);
      if (!target) return false;
      const sc = scrollerElRef.current;
      if (!sc) return false;
      const markRect = target.getBoundingClientRect();
      const scrollerRect = sc.getBoundingClientRect();
      const fullyVisible =
        markRect.top >= scrollerRect.top + 8 && markRect.bottom <= scrollerRect.bottom - 8;
      if (fullyVisible) return true;
      const delta =
        markRect.top + markRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
      if (Math.abs(delta) >= 8) sc.scrollBy({ top: delta, behavior: "auto" });
      return true;
    };

    // 关键词一旦出现，就不再拉回消息 start——否则长消息里会 start↔center 互抢抖动。
    let keywordLocked = !(highlightKeyword || "").trim();

    const tick = () => {
      if (!keywordLocked) {
        bringMessageIntoView();
        keywordLocked = centerKeyword();
      } else {
        // 无关键词：持续消息 start 校正；有关键词：只 refinement 居中，覆盖 Virtuoso 测量收敛。
        if (!(highlightKeyword || "").trim()) bringMessageIntoView();
        else centerKeyword();
      }
    };

    // 首帧立即校正；随后 rAF 连续收敛（覆盖 Virtuoso 异步测量），与标尺 jump 一致。
    tick();
    let frames = 0;
    const step = () => {
      if (cancelled || finished) return;
      tick();
      if (++frames < 8) requestAnimationFrame(step);
    };
    const raf = requestAnimationFrame(step);

    // 超时重试对齐 useHighlightKeyword（rAF / 280 / 700）：代码块 shiki 异步替换后才有 mark。
    const delays = [80, 280, 480, 720, 1100];
    delays.forEach((delay, i) => {
      timers.push(
        window.setTimeout(() => {
          if (cancelled || finished) return;
          tick();
          if (i === delays.length - 1) finish();
        }, delay)
      );
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtuosoMountKey, pendingLocateId, pendingLocateIndex, sessionLoading, highlightKeyword]);

  // 目标消息始终找不到时（被过滤/id 不匹配）超时释放 pending，避免卡死。
  useEffect(() => {
    if (!pendingLocateId || sessionLoading) return;
    if (pendingLocateIndex >= 0) return;
    const timer = window.setTimeout(() => {
      onPendingScrollDone?.();
    }, 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLocateId, pendingLocateIndex, sessionLoading]);

  // loading→就绪且无定位：滚到末尾唤醒虚拟窗口。
  // pendingLocateId 在 loading 期间也会下发（跨会话），故就绪首帧即可拦住 wake，避免先 LAST 再定位。
  // 超长会话（含数千字 toolResult / 长 assistant）下 scrollToIndex(LAST,end) 因 defaultItemHeight 估算偏
  // 会落点偏上、看不到最新；DOM 实测把最后一条底部对齐视口底部 = 真贴底，多帧覆盖 Virtuoso 测量收敛。
  useEffect(() => {
    if (sessionLoading || visibleRenderRows.length === 0) return;
    if (pendingLocateId || locatedThisSessionRef.current) return;
    const lastKey = visibleRenderRows[visibleRenderRows.length - 1]?.stableKey;
    const wake = () => {
      virtuosoRef.current?.scrollToIndex({
        index: visibleRenderRows.length - 1,
        align: "end",
        behavior: "auto"
      });
    };
    wake();
    const stickTimers: number[] = [];
    if (lastKey) {
      const stickEnd = adjustToMessage(lastKey, "end");
      [80, 200, 420].forEach((t) => stickTimers.push(window.setTimeout(stickEnd, t)));
    }
    const raf = requestAnimationFrame(wake);
    const timer = window.setTimeout(wake, 64);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      stickTimers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, sessionLoading, visibleRenderRows.length]);

  if (sessionLoading) {
    return (
      <div className="ml-[var(--chat-content-left,auto)] mr-auto max-w-[860px] px-10 pt-12">
        <StreamLoadingState />
      </div>
    );
  }
  if (messages.length === 0) return null;

  return (
    <>
      <AgentMessageNavigator
        markers={navigatorMarkers}
        totalCount={visibleRenderRows.length}
        activeIndex={navigatorActiveIndex}
        onNavigate={handleNavigatorJump}
        text={text}
        hidden={navigatorHidden}
        side={navigatorSide}
      />
      <Virtuoso
        key={virtuosoMountKey}
        ref={virtuosoRef}
        data={visibleRenderRows}
        computeItemKey={(_index, row) => row.stableKey}
        scrollerRef={handleScrollerRef}
        className="gt-subtle-scrollbar h-full min-h-0 overflow-auto [scrollbar-gutter:stable]"
        initialTopMostItemIndex={
          initialLocateIndex >= 0
            ? { index: initialLocateIndex, align: "start" }
            : { index: "LAST", align: "end" }
        }
        followOutput={handleFollowOutput}
        totalListHeightChanged={handleTotalListHeightChanged}
        atBottomThreshold={80}
        atBottomStateChange={(atBottom) => {
          // 仅贴底时恢复 stick；离开底部不再从这里清 stick（Virtuoso 在工具变高时也会报 false）
          if (atBottom) stickToBottomRef.current = true;
          onAtBottomChange(atBottom);
        }}
        startReached={onStartReached}
        rangeChanged={(range) => {
          onRangeChanged();
          const reach = range.endIndex - range.startIndex;
          const mid = reach > 0 ? Math.round((range.startIndex + range.endIndex) / 2) : range.startIndex;
          setNavigatorActiveIndex((prev) => (prev === mid ? prev : mid));
        }}
        increaseViewportBy={{ top: 600, bottom: 600 }}
        defaultItemHeight={160}
        components={{ List: AgentMessageListContainer, Header: AgentMessageListHeader }}
        itemContent={(_index, row) =>
          row.isSystem ? (
            <AgentMessageRowFrame>
              <SystemMessageRow content={row.msg.content.trim()} />
            </AgentMessageRowFrame>
          ) : (
            <AgentMessageRowFrame>
              <MessageShell
                isAssistant={row.isAssistant}
                todoItems={row.todoItems}
                userHasAttachments={!row.isAssistant && Boolean(row.msg.attachments?.length)}
                highlight={Boolean(highlightMessageId) && rowMatchesMessageId(row, highlightMessageId)}
                highlightKeyword={highlightKeyword}
                locateMessageId={row.stableKey}
              >
                {row.isAssistant ? (
                  <AssistantMessage
                    row={row}
                    timelineOpenState={timelineOpenState}
                    setTimelineOpenState={setTimelineOpenState}
                    showReasoningSummaries={showReasoningSummaries}
                    shellToolPartsExpanded={shellToolPartsExpanded}
                    editToolPartsExpanded={editToolPartsExpanded}
                    onOpenTaskSession={onOpenTaskSession}
                    onOpenToolFile={onOpenToolFile}
                    onOpenBrowserUrl={onOpenBrowserUrl}
                    renderMarkdown={renderMarkdown}
                  />
                ) : (
                  <UserMessage
                    msg={row.msg}
                    messageOpenState={messageOpenState}
                    setMessageOpenState={setMessageOpenState}
                    renderMarkdown={renderMarkdown}
                    onPreviewImageGroup={onPreviewImageGroup}
                    onCopyAttachmentUri={onCopyAttachmentUri}
                    onOpenAttachment={onOpenAttachment}
                  />
                )}
              </MessageShell>
            </AgentMessageRowFrame>
          )
        }
      />
    </>
  );
}

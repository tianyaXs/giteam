import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { FilePen, BrainIcon, ChevronDownIcon, Copy as CopyIcon, Check as CheckIconLucide, CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { buildHunks, diffLines } from "../../lib/turnDiff";
import { DiffLineRows, StatsBadgeText, collectTurnModifiedFiles, compressEdits, deriveTurnStats, type TurnManifestEntry, type TurnModifiedFile } from "./TurnDiffViewer";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import Lenis from "lenis";
import {
  buildAgentActivityRows,
  buildAgentAssistantRenderGroups,
  buildAgentReplyMarkdownFromParts,
  collapseDuplicatedAgentContent,
  dedupeAgentDuplicateTextParts,
  dedupeAgentToolParts,
  hasVisibleTimelineGroups,
  isPauseFailureText,
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
import { OfficeOperationCard } from "./OfficeOperationCard";
import { SubagentRunCard } from "./SubagentRunCard";
import { MatrixLoader } from "../transitions/MatrixLoader";
import { ShimmerText } from "../transitions/ShimmerText";
import { Reasoning, ReasoningTrigger, useReasoning } from "../ai-elements/reasoning";
import { MessageAction, MessageActions } from "../ai-elements/message";
import { Bubble, BubbleContent } from "../ai-elements/bubble";
import { buildFileTree, FileTree, FileTreeFile, FileTreeFolder } from "../ai-elements/file-tree";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "../ui/trace";

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
  /** 回合修改文件汇总（列表层按用户行边界聚合后写入）：汇总是回合的属性，挂在回合最后一行。 */
  turnSummary?: TurnModifiedFile[];
  /** 该回合的序号（按用户行计数，1 起）：「第 N 轮改动」标注。 */
  turnIndex?: number;
};

const COLLAPSE_LINE_LIMIT = 8;
const COLLAPSE_CHAR_LIMIT = 420;

type AgentDisplayTimelineGroup =
  | AgentAssistantRenderGroup
  | { kind: "tool-batch"; key: string; batchKind: "shell" | "edit" | "web" | "browser" | "task" | "memory" | "recall" | "office"; parts: AgentDetailedPart[] };

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
      <span
        className={cn("col-start-1 row-start-1 whitespace-nowrap", active && "t-shimmer")}
        data-text={active ? activeLabel : undefined}
      >
        {active ? activeLabel : doneLabel}
      </span>
    </span>
  );
}

/** 时间线折叠标签共用外壳：固定行高 + 收起不挂载，保证「已探索 / 已回忆」行距一致。 */
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
  // 高度对齐首组首帧（h-6 = Trace 折叠头行高；流式正文块经
  // min-h-6 预留同高）——占位被首组同帧替换时高度不变，「思考中→内容」零跳动。
  return (
    <div className="flex h-6 w-full min-w-0 items-center justify-start gap-2" aria-live="polite" aria-label={label}>
      <MatrixLoader variant="twinkle" className="shrink-0" />
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

/**
 * pi 的正文按 message.index 分块（text:0/text:1/text:2…），正文轮间常插着不可见
 * boundary（隐藏思考）。这些同回合同一正文的连续 text part 需要在进入时间线前
 * 合成一个 part，否则活动段会被正文块切碎成「工作段 → 正文 → 工作段」多组并列卡。
 */
function dedupeAgentChunkedTextParts(
  parts: AgentDetailedPart[]
): AgentDetailedPart[] {
  const out: AgentDetailedPart[] = [];
  for (const part of parts) {
    const type = String(part?.type || "");
    const last = out[out.length - 1];
    if (
      type === "text"
      && last
      && String(last.type || "") === "text"
    ) {
      const lastText = String(last.text || "");
      const nextText = String(part.text || "");
      if (lastText && nextText && lastText.includes(nextText)) continue;
      if (lastText && nextText && nextText.includes(lastText)) {
        out[out.length - 1] = { ...part, id: String(last.id || part.id || "") };
        continue;
      }
      out[out.length - 1] = {
        ...part,
        id: String(last.id || part.id || ""),
        text: [lastText, nextText].filter(Boolean).join("\n\n")
      };
      continue;
    }
    out.push(part);
  }
  return out;
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

/** 模型在工具间隙常输出的无信息量占位叙述（…/.../·），不渲染成整行。 */
function isBareEllipsisText(text: string): boolean {
  return /^[.…·\s]*$/.test(String(text || "").trim());
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

function getBatchKind(group: AgentAssistantRenderGroup): "shell" | "edit" | "web" | "browser" | "task" | "memory" | "recall" | "office" | "" {
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
  // office 文件工具合并为「正在操作文件」卡（OfficeOperationCard 按类型渲染）。
  if (/^(read|write|edit)_(xlsx|docx|pptx)$/.test(tool)) return "office";
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
  let pendingKind: "shell" | "edit" | "web" | "browser" | "task" | "memory" | "recall" | "office" | "" = "";
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

/**
 * 段内二次合并：活动段切分只认「可见正文」，但同一工作流里的多个同 kind 工作批
 * （shell → 隐藏思考 → shell → shell）会在段内留成并列 Trace 卡（官方 Task 卡展开
 * 后只有一层缩进步骤列表）。这里把相邻同 batchKind 的 tool-batch 合成一个 step，
 * 对应官方「已运行 4 个步骤」一层折叠列表；kind 不同的批（探索→运行）保留为
 * 相邻两步，通过 batchKind 语义区分工作类型。
 */
function mergeAdjacentWorkSteps(
  steps: AgentDisplayTimelineGroup[]
): AgentDisplayTimelineGroup[] {
  const out: AgentDisplayTimelineGroup[] = [];
  for (const step of steps) {
    const last = out[out.length - 1];
    // 相邻工作步骤一律并入同一个 tool-batch：段落内不允许并列多张段卡
    // （旧实现只合并同 kind，会留出 探索→运行→运行→探索 的多张并列卡）。
    const nextKind = step.kind === "tool-batch" ? step.batchKind : "";
    const lastParts = last?.kind === "tool-batch" ? last.parts : [];
    const incoming = step.kind === "tool-batch"
      ? step.parts
      : step.kind === "context"
        ? step.parts
        : step.kind === "part"
          ? [step.part]
          : [];
    if (last?.kind === "tool-batch" && incoming.length > 0) {
      out[out.length - 1] = {
        kind: "tool-batch",
        key: last.key,
        batchKind: nextKind || last.batchKind,
        parts: [...lastParts, ...incoming]
      };
      continue;
    }
    // 非批组步骤（reasoning 等）不丢弃：转成普通 tool-batch 行，保证全部
    // 穿插操作都收进同一张段卡；后面遇到第一个工作步骤时继续并入。
    if (incoming.length > 0) {
      out.push({
        kind: "tool-batch",
        key: step.key,
        batchKind: nextKind || "shell",
        parts: incoming
      });
      continue;
    }
    out.push(step);
  }
  return out;
}

type AgentMessageStreamProps = {
  sessionLoading: boolean;
  messages: AgentChatMessage[];
  renderedMessages: AgentChatMessage[];
  activeStreamingAssistantId: string;
  /** run manifest 结果按轮次序号归档：每轮的完整快照 diff（基线→结束态）归属该轮，
   * 不被后续轮覆盖——历史轮也能全文件对比。 */
  turnManifest: Record<number, TurnManifestEntry>;
  /** 点击回合汇总卡片头部：在右侧栏打开完整改动查看器。 */
  onOpenTurnDiff?: (files: TurnModifiedFile[], turnIndex?: number, initialPath?: string) => void;
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
  virtuosoRef: RefObject<VirtuosoHandle | null>;
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

/** Lenis 官方 lerp 模式（帧率无关 damp）：连续 wheel 连续追踪目标，避免固定时长动画重排/跳变。 */
const SMOOTH_WHEEL_LENIS_LERP = 0.1;

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
  return <div className="pb-3">{children}</div>;
}

/** 首条消息与顶部分隔线之间的呼吸留白（参考 ChatGPT 首条消息的顶部间距）。 */
function AgentMessageListHeader() {
  return <div className="h-12" aria-hidden="true" />;
}

function StreamLoadingState() {
  return (
    <div className="flex flex-col gap-2 px-1 py-2 text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <MatrixLoader variant="scan" rounded />
        <ShimmerText text="加载会话中…" />
      </span>
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
            : "max-w-[min(74%,620px)]"
        )}
      >
        {/* 用户文本消息用官方 Bubble(muted 气泡,rounded-3xl);带附件时保持
            旧容器(宫格附件 + 气泡混排会双圆角)。 */}
        {!isAssistant && !userHasAttachments ? (
          <Bubble align="end" variant="muted" className="max-w-full">
            <BubbleContent className="text-sm leading-6 text-foreground">
              {children}
            </BubbleContent>
          </Bubble>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * 活动段：一段连续的 agent 工作（思考/探索/命令/编辑…）收进一张官方 Task 形态的
 * 折叠卡；可见正文之外的每两次正文之间至多一张卡（划分机制见 buildAgentActivityRows）。
 * 运行中自动展开、完成后自动收起；用户点过则以用户选择为准（官方语义）。
 */
/** 活动段标题：按主导步骤类型取名，运行时进行时、完成过去时（官方 Task 语义）。 */
const SEGMENT_TITLES: Record<string, { active: string; done: string }> = {
  "思考": { active: "思考中", done: "已思考" },
  "探索": { active: "探索中", done: "已探索" },
  "运行": { active: "运行中", done: "已运行" },
  "编辑": { active: "编辑中", done: "已编辑" },
  "查询": { active: "查询中", done: "已查询" },
  "浏览": { active: "浏览中", done: "已浏览" },
  "执行子任务": { active: "子任务执行中", done: "已执行子任务" },
  "记录": { active: "记录中", done: "已记录" },
  "回忆": { active: "回忆中", done: "已回忆" },
  "操作文件": { active: "操作文件中", done: "已操作文件" },
  "执行": { active: "执行中", done: "已执行" }
};

function ActivitySegment({
  timelineKey,
  steps,
  forceInactive,
  timelineOpenState,
  setTimelineOpenState,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile,
  onOpenBrowserUrl,
  renderMarkdown
}: {
  timelineKey: string;
  steps: AgentDisplayTimelineGroup[];
  forceInactive: boolean;
  timelineOpenState: Record<string, boolean>;
  setTimelineOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
  renderMarkdown: RenderMarkdown;
}) {
  const anyRunning = !forceInactive;
  const hasTask = steps.some(
    (step) =>
      (step.kind === "part" && isTaskToolPart(step.part))
      || (step.kind === "tool-batch" && step.batchKind === "task")
  );
  // 只有含「子任务」的段默认展开运行态；思考/探索/命令/编辑段保持收起的摘要行（默认值仅
  // 在用户未点过时生效，timelineOpenState 优先）。
  const autoOpenRunning = hasTask;
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
  const resolvedOpen = userOpen ?? (anyRunning && autoOpenRunning);
  const setError = steps.some((step) =>
    step.kind === "part"
    && String((step.part as { error?: string }).error || "").trim()
  );
  const openKey = `${timelineKey}:segment`;
  const isOpen = timelineOpenState[openKey] ?? resolvedOpen;
  const setOpen = (open: boolean) => setTimelineOpenState((prev) => ({ ...prev, [openKey]: open }));

  // 段头按「原子调用数最多的 kind」取名（合并后一个 shell 批可能含多次命令）：
  // 对齐官方 Task 的"主导动作"语义——一段里运行了 5 条命令 + 顺手读了 2 个文件，
  // 段名应叫「已运行」而不是末尾的「已探索/已读取」。
  const segmentLabel = (() => {
    const counts = new Map<string, number>();
    const bump = (label: string, weight: number) =>
      counts.set(label, (counts.get(label) || 0) + weight);
    for (const step of steps) {
      if (step.kind === "reasoning") bump("思考", 1);
      else if (step.kind === "context") bump("探索", step.parts.length || 1);
      else if (step.kind === "tool-batch") {
        const batchLabels: Record<string, string> = {
          shell: "运行",
          edit: "编辑",
          web: "查询",
          browser: "浏览",
          task: "执行子任务",
          memory: "记录",
          recall: "回忆",
          office: "操作文件"
        };
        bump(batchLabels[step.batchKind] || "运行", step.parts.length || 1);
      } else if (step.kind === "part") {
        const type = String((step.part as { type?: string }).type || "");
        if (type === "runtime.memory") bump("记录", 1);
        else if (type === "text") continue;
        else bump("运行", 1);
      }
    }
    let best = "";
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    }
    return best || "执行";
  })();
  const titles = SEGMENT_TITLES[segmentLabel] || SEGMENT_TITLES["执行"];
  // 计数按合并前的原子调用数（含探索 part 数）：段头显示真实工作量，
  // 而不是合并后的卡片数（合并后 steps.length=2 但原子调用可能是 6）。
  const stepCount = steps.reduce((sum, step) => {
    if (step.kind === "context" || step.kind === "tool-batch") return sum + (step.parts.length || 1);
    return sum + 1;
  }, 0);

  return (
    <Trace>
      <TraceCollapsible open={isOpen} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger className="min-w-0 max-w-full">
          <TraceLine status={setError ? "error" : anyRunning ? "running" : undefined}>
            <TraceIcon>
              {setError ? (
                <CircleAlertIcon />
              ) : anyRunning ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <CircleCheckIcon />
              )}
            </TraceIcon>
            <TraceTitle className="text-sm">{anyRunning ? titles.active : titles.done}</TraceTitle>
            <TraceDescription className="max-w-[240px] shrink truncate">
              {`${stepCount} 个步骤`}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-0.5 pb-1.5">
            {steps.map((step, stepIndex) => {
              const stepKey = `${timelineKey}:step:${step.kind}:${String((step as { key?: string }).key || stepIndex)}`;
              if (step.kind === "context") {
                return (
                  <div key={stepKey} className="flex flex-col gap-0.5">
                    {step.parts.map((part, partIndex) =>
                      renderTimelineToolPart({
                        timelineKey: `${stepKey}:${String((part as { id?: string }).id || partIndex)}`,
                        part,
                        listItem: true,
                        shellToolPartsExpanded,
                        editToolPartsExpanded,
                        onOpenTaskSession,
                        onOpenToolFile
                      })
                    )}
                  </div>
                );
              }
              if (step.kind === "tool-batch") {
                // 官方 Task 只有段头一层折叠：展开后必须是扁平缩进步骤行，
                // 不再在段内渲染第二个可折叠层（旧 ToolBatchGroup 头）。
                // office 操作卡与记忆卡本身不是折叠层，保留卡片形态。
                const isOfficeBatch = step.batchKind === "office";
                if (isOfficeBatch) {
                  const officeRunning =
                    !forceInactive
                    && step.parts.some((part) => {
                      const status = String((part as { status?: string }).status || "").toLowerCase();
                      return status === "running" || status === "pending" || status === "deciding";
                    });
                  return (
                    <OfficeOperationCard
                      key={stepKey}
                      parts={step.parts}
                      running={officeRunning}
                      onOpenFile={(path) => onOpenToolFile({ filePath: path })}
                    />
                  );
                }
                const visibleParts = step.batchKind === "task"
                  ? dedupeVisibleSubagentTaskParts(step.parts)
                  : step.parts;
                if (visibleParts.length === 0) return null;
                const isMemoryBatch = step.batchKind === "memory";
                if (isMemoryBatch) {
                  const memoryHasRunning = visibleParts.some(
                    (part) => String((part as { phase?: string }).phase || "").trim() === "started"
                  );
                  const memoryHasFailed = visibleParts.some(
                    (part) => String((part as { phase?: string }).phase || "").trim() === "failed"
                  );
                  const memoryWrote = visibleParts.some(
                    (part) =>
                      (Number((part as { entityCount?: number }).entityCount) || 0) > 0
                      || (Number((part as { relationCount?: number }).relationCount) || 0) > 0
                      || Boolean(String((part as { intent?: string }).intent || "").trim())
                  );
                  if (!memoryHasRunning && !memoryWrote && !memoryHasFailed) return null;
                }
                return (
                  <div key={stepKey} className="flex flex-col gap-0.5 overflow-visible">
                    {visibleParts.map((part, partIndex) => {
                      const partType = String((part as { type?: string }).type || "");
                      const itemKey = `${stepKey}:${String((part as { id?: string }).id || partIndex)}`;
                      if (isMemoryBatch || partType === "runtime.memory") {
                        return <MemoryExtractionPart key={itemKey} part={part} listItem />;
                      }
                      return renderTimelineToolPart({
                        timelineKey: itemKey,
                        part,
                        listItem: true,
                        siblingParts: step.parts,
                        settled: forceInactive,
                        shellToolPartsExpanded,
                        editToolPartsExpanded,
                        onOpenTaskSession,
                        onOpenToolFile,
                        onOpenBrowserUrl
                      });
                    })}
                  </div>
                );
              }
              if (step.kind === "reasoning") {
                // 思考在官方 Task 里是普通步骤行（不可再点开二级折叠），
                // 展开段头后与命令/探索行平级，最多保留一句截断摘要。
                const preview = step.parts
                  .map((part) => String((part as { text?: string }).text || "").trim())
                  .filter(Boolean)
                  .slice(-1)[0]
                  ?.split(/\r?\n+/)
                  .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
                  .filter(Boolean)
                  .slice(-1)[0] || "整理推理摘要";
                return (
                  <div key={stepKey} className="flex flex-col gap-0.5">
                    <TraceLine>
                      <TraceIcon>
                        <CircleCheckIcon />
                      </TraceIcon>
                      <TraceTitle className="text-sm">已思考</TraceTitle>
                      <TraceDescription className="max-w-[240px] shrink truncate">
                        {preview}
                      </TraceDescription>
                    </TraceLine>
                  </div>
                );
              }
              if (step.kind === "part") {
                const partType = String((step.part as { type?: string }).type || "");
                // 工作类 part 已在 mergeAdjacentWorkSteps 并入同一个批组，这里只剩
                // runtime 提示行与失败行这类真正需要独立展示的事件。
                if (partType === "runtime.retry") {
                  return <RuntimeRetryPart key={stepKey} part={step.part} />;
                }
                if (partType === "runtime.failure") {
                  const message = String((step.part as { error?: string; text?: string }).error
                    || (step.part as { error?: string; text?: string }).text
                    || "任务未能完成。").trim();
                  return <AgentErrorMessage key={stepKey} message={message} />;
                }
                return renderTimelineToolPart({
                  timelineKey: stepKey,
                  part: step.part,
                  listItem: true,
                  settled: forceInactive,
                  shellToolPartsExpanded,
                  editToolPartsExpanded,
                  onOpenTaskSession,
                  onOpenToolFile,
                  onOpenBrowserUrl
                });
              }
              return null;
            })}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function ContextGroup({
  timelineKey,
  group,
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

  // Chain of Thought 形状(同 ToolBatchGroup):探索中 spinner+shimmer,
  // 已探索绿勾;detail 经 lastDetailRef 在工具切换空窗间保持连续。
  // 官方 Task 语义(同 ToolBatchGroup):探索中自动展开,完成后收起。
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
  const resolvedOpen = userOpen ?? active;
  return (
    <Trace>
      <TraceCollapsible open={resolvedOpen} onOpenChange={setUserOpen}>
        <TraceCollapsibleTrigger className="min-w-0 max-w-full">
          <TraceLine status={active ? "running" : undefined}>
            <TraceIcon>
              {active ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <CircleCheckIcon />
              )}
            </TraceIcon>
            <TraceTitle className="text-sm">
              {active ? "探索中" : "已探索"} {summary || "已收集上下文"}
            </TraceTitle>
            {detail ? (
              <TraceDescription className="max-w-[240px] shrink truncate">
                {detail}
              </TraceDescription>
            ) : null}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-0.5 pb-1.5">
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
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** 复制整条助手回复(MessageAction 封装:1.5s 勾选反馈)。 */
function CopyReplyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      aria-label="复制回复"
      label="复制回复"
      tooltip="复制回复"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIconLucide className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </MessageAction>
  );
}

/** 思考耗时（vendored Reasoning 根组件在流式结束后计算秒数）。 */
function ReasoningDuration() {
  const { isStreaming, duration } = useReasoning();
  if (isStreaming || !duration) return null;
  return <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">· {duration}s</span>;
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

  // 默认始终收起：过程中与结束后都不自动展开，避免高度变化抖动；仅手动点击展开。
  // defaultOpen={false} 同时关掉 vendored Reasoning 的流式自动展开/自动收起
  // (见 ai-elements/reasoning.tsx 的 giteam patch)。
  return (
    <Reasoning
      isStreaming={active}
      open={open}
      onOpenChange={onOpenChange}
      defaultOpen={false}
      className="mb-0"
    >
      <ReasoningTrigger className="h-6 appearance-none justify-start gap-2 border-0 bg-transparent px-0 text-left hover:bg-transparent">
        <BrainIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <ActivityStatus active={active} activeLabel="思考中" doneLabel="已思考" className="text-sm" />
        <ReasoningDuration />
        {open ? null : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</span>
        )}
      </ReasoningTrigger>
      <CollapsibleContent className="min-w-0 max-w-full pb-2 pl-3 text-sm text-muted-foreground">
        <StreamingMarkdownBlock
          text={text}
          streaming={active}
          renderMarkdown={renderMarkdown}
          className="min-w-0 max-w-full select-text break-words [overflow-wrap:anywhere]"
        />
      </CollapsibleContent>
    </Reasoning>
  );
}

/**
 * 流式 markdown 块。
 *
 * 对齐官方 Chat demo：助手回复就是 <Markdown>{text}</Markdown>，不加任何
 * 自定义尾部光标。Streamdown 的词级淡入动画（animated prop）已提供流式
 * 视觉反馈，无需额外符号。
 */
function StreamingMarkdownBlock({
  text,
  streaming,
  renderMarkdown,
  className
}: {
  text: string;
  streaming: boolean;
  renderMarkdown: RenderMarkdown;
  className?: string;
}) {
  return (
    <div className={className}>
      {renderMarkdown(text, streaming)}
    </div>
  );
}

function AssistantTextBlock({
  text,
  streaming,
  trailing,
  renderMarkdown
}: {
  text: string;
  streaming: boolean;
  /** 回复的最后一个可见块：下方紧贴操作行（复制按钮），需剥掉 markdown 尾部空段 margin。 */
  trailing?: boolean;
  renderMarkdown: RenderMarkdown;
}) {
  return (
    <StreamingMarkdownBlock
      text={text}
      streaming={streaming}
      renderMarkdown={renderMarkdown}
      className={cn(
        "min-w-0 max-w-full select-text overflow-hidden break-words text-sm leading-7 text-foreground [overflow-wrap:anywhere]",
        // Streamdown 根节点自带 space-y-4；正文上方是活动段卡（Trace 行高 ≈24px），
        // 若不剥掉首段 mt-4，第一段正文会比 Trace 间多出 16px 空隙。
        !streaming && "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        trailing && !streaming && "pb-1",
        // 流式期间预留 h-6：与「思考中」占位行同高——首帧正文从占位接手时行高不变，
        // 不会出现「标签消失 → 列表上移」。结束后释放（仅单行回复收一次）。
        streaming && "min-h-6"
      )}
    />
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
  const displayTimelineGroups = buildBatchedTimelineGroups(
    // 隐藏思考生成的 boundary 只用于语义占位；段合并统一在批组后处理，这里先剥掉，
    // 否则 buildBatchedTimelineGroups 会按 boundary flush，把同一工作流的多次 shell 拆成多张卡
    // （截图里「已运行 2个步骤 → 已运行 1个步骤 ×3」连环卡片的直接来源）。
    timelineGroups.filter((group) => group.kind !== "boundary")
  );
  const activityRows = buildAgentActivityRows(displayTimelineGroups, {
    // 流式与完成态同一套划分：正文即段落锚，过程中段卡就在真实时序位置，结束不重排。
    keyOf: (group) => `${stableKey}:${group.key}`,
    textOf: (group) => {
      // 正文 = text 类型的 part 组：两次正文之间的连续工作切为一个段；
      // 其余组（context/reasoning/tool-batch/part）都归入当前段。
      if (group.kind !== "part") return "";
      const type = String((group.part as { type?: string }).type || "");
      if (type !== "text") return "";
      const raw = collapseDuplicatedAgentContent(
        String((group.part as { text?: string }).text || "")
      );
      // 模型在工具间隙常输出「…/...」占位叙述：无信息量，不当正文、不切段。
      if (!raw || /^[.…·\s]+$/.test(raw)) return "";
      return raw;
    }
  });
  // 段 key 首锚：段随流式逐帧追加步骤，key 取首步骤 id 保证段实例稳定复用
  // （末尾段 active 随 isStreaming 推导，追加步骤不重挂载、不闪烁）。
  // 运行态只属于「流式中最后一个 row」：历史段在流式中也保持完成态，不整体闪「运行中」。
  // 段内所有穿插操作（探索/命令/编辑/思考…）在此合成一个 tool-batch step，
  // 段内列表保持一个「已运行 N 个步骤」层级；最后一个可见 row 才是「运行中」。
  const timelineRows = activityRows.map((row) =>
    row.kind === "segment"
      ? { ...row, steps: mergeAdjacentWorkSteps(row.steps) }
      : row
  );
  const lastRowIndex = timelineRows.length - 1;
  // 与 ToolBatchGroup 的空抽取判定一致：只有空记忆批组的段整段不可见（寒暄轮不出卡）。
  const isSegmentRenderable = (steps: AgentDisplayTimelineGroup[]) =>
    steps.some((step) => {
      if (step.kind !== "tool-batch" || step.batchKind !== "memory") return true;
      const phaseOf = (part: AgentDetailedPart) => String((part as { phase?: string }).phase || "").trim();
      return step.parts.some((part) =>
        phaseOf(part) === "started"
        || phaseOf(part) === "failed"
        || (Number((part as { entityCount?: number }).entityCount) || 0) > 0
        || (Number((part as { relationCount?: number }).relationCount) || 0) > 0
        || Boolean(String((part as { intent?: string }).intent || "").trim())
      );
    });
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2 overflow-hidden">
      {timelineRows.map((row, rowIndex) => {
        if (row.kind === "segment") {
          if (!isSegmentRenderable(row.steps)) return null;
          const segmentKey = `${stableKey}:segment:${row.key}`;
          return (
            <ActivitySegment
              key={segmentKey}
              timelineKey={segmentKey}
              steps={row.steps}
              forceInactive={!isStreaming || rowIndex !== lastRowIndex}
              timelineOpenState={timelineOpenState}
              setTimelineOpenState={setTimelineOpenState}
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              onOpenTaskSession={onOpenTaskSession}
              onOpenToolFile={onOpenToolFile}
              onOpenBrowserUrl={onOpenBrowserUrl}
              renderMarkdown={renderMarkdown}
            />
          );
        }
        const text = row.text;
        const last = rowIndex === lastRowIndex;
        return (
          <AssistantTextBlock
            key={`${stableKey}:text:${row.key}`}
            text={text}
            streaming={isStreaming && last}
            trailing={last}
            renderMarkdown={renderMarkdown}
          />
        );
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

/** 悬浮预览：HoverCard（shadcn）内 hunk 级 diff，零自定义 CSS。 */
function TurnModifiedFileHover({ file }: { file: TurnModifiedFile }) {
  // 悬浮预览：净变化单块的 hunk（与右侧栏查看器同一份 diff 的快捷版）。
  const net = compressEdits(file.edits);
  const hunks = net ? buildHunks(diffLines(net.before, net.after), 2) : [];
  return (
    <HoverCardContent side="top" align="start" sideOffset={8} className="w-[min(620px,86vw)] overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <FilePen className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{file.path}</span>
        {file.added != null ? (
          <Badge variant="outline" className="shrink-0 gap-1 border-transparent px-1.5 font-mono text-[10px] tabular-nums">
            <StatsBadgeText added={file.added} removed={file.removed} />
          </Badge>
        ) : null}
      </div>
      {hunks.length > 0 ? (
        <ScrollArea className="max-h-[320px]">
          <div className="py-1.5 font-mono text-[11px] leading-5">
            {hunks.map((hunk, index) => (
              <div key={index}>
                <div className="bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">{hunk.header}</div>
                <DiffLineRows lines={hunk.lines} />
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="px-3.5 py-3 text-[11px] leading-5 text-muted-foreground">
          该文件的修改未经 write/edit 工具（bash 间接写入或 office 工具），无逐行 diff 可预览。
          <span className="mt-1 block text-muted-foreground/70">点击行可在右侧面板打开完整预览。</span>
        </div>
      )}
    </HoverCardContent>
  );
}

/** DSH 风格：卡片头（图标 + 计数 + 总 +/-）+ 文件行（路径 + 行级统计），
 *  悬浮行显示 diff 预览（HoverCard），点击开右侧完整预览。 */
function TurnModifiedFilesRow({
  files,
  turnIndex,
  onOpenToolFile,
  onOpenTurnDiff
}: {
  files: TurnModifiedFile[];
  turnIndex?: number;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  /** 点击卡片头部：在右侧栏打开完整改动查看器（复用应用现有侧边栏）。 */
  onOpenTurnDiff?: (files: TurnModifiedFile[], turnIndex?: number, initialPath?: string) => void;
}) {
  const hasStats = files.some((file) => file.added != null);
  const totalAdded = files.reduce((sum, file) => sum + (file.added || 0), 0);
  const totalRemoved = files.reduce((sum, file) => sum + (file.removed || 0), 0);
  return (
    <div className="mt-1 overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent/30"
        onClick={() => onOpenTurnDiff?.(files, turnIndex)}
        title="在右侧栏查看本轮全部改动"
      >
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
          <FilePen className="size-4" strokeWidth={1.9} />
        </span>
        <span className="text-sm font-medium text-foreground">
          {turnIndex ? `第 ${turnIndex} 轮改动` : "本轮改动"} · {files.length} 个文件
        </span>
        {hasStats ? (
          <Badge variant="outline" className="ml-auto shrink-0 gap-1.5 border-transparent font-mono text-[11px] tabular-nums">
            <StatsBadgeText added={totalAdded} removed={totalRemoved} />
          </Badge>
        ) : null}
      </button>
      <Separator />
      {/* 官方 File Tree 形态:文件多时按文件夹折叠导航(语义"files the agent
          changed, as a folder tree");少量文件保留悬停预览的平铺行。 */}
      {files.length > 4 ? (
        <FileTree
          className="p-1.5"
          onSelect={(path) => {
            const file = files.find((item) => item.path === path);
            if (!file) return;
            if (file.edits?.length) onOpenTurnDiff?.(files, turnIndex, file.path);
            else onOpenToolFile({ filePath: file.path });
          }}
        >
          {renderFileTreeNodes(buildFileTree(files.map((file) => file.path)), files)}
        </FileTree>
      ) : (
      <div>
        {files.map((file) => (
          <HoverCard key={file.path} openDelay={250} closeDelay={180}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/40"
                onClick={() => {
                  // 有 diff 源：进入对比模式并定位到该文件（与点头部同视图）；
                  // 无 diff 源（office/bash）：打开文件预览。
                  if (file.edits?.length) onOpenTurnDiff?.(files, turnIndex, file.path);
                  else onOpenToolFile({ filePath: file.path });
                }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">{file.path}</span>
                {file.added != null ? (
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    <StatsBadgeText added={file.added} removed={file.removed} />
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">预览</span>
                )}
              </button>
            </HoverCardTrigger>
            <TurnModifiedFileHover file={file} />
          </HoverCard>
        ))}
      </div>
      )}
    </div>
  );
}

/** 递归渲染官方 File Tree 节点;文件行带 +/- 统计(FileTreeActions 在按钮外侧)。 */
function renderFileTreeNodes(
  nodes: ReturnType<typeof buildFileTree>,
  files: TurnModifiedFile[]
): ReactNode {
  return nodes.map((node) => {
    if (node.type === "folder") {
      return (
        <FileTreeFolder key={node.path} path={node.path} name={node.name}>
          {renderFileTreeNodes(node.children, files)}
        </FileTreeFolder>
      );
    }
    const file = files.find((item) => item.path === node.path);
    return (
      <FileTreeFile
        key={node.path}
        path={node.path}
        actions={
          file?.added != null ? (
            <span className="font-mono text-[11px] tabular-nums">
              <StatsBadgeText added={file.added} removed={file.removed} />
            </span>
          ) : null
        }
      />
    );
  });
}

function AssistantMessage({
  row,
  isTurnLastRow,
  timelineOpenState,
  setTimelineOpenState,
  showReasoningSummaries,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile,
  onOpenBrowserUrl,
  renderMarkdown,
  onOpenTurnDiff
}: {
  row: AgentMessageRenderRow;
  /** 本回合最后一个 assistant 行才显示回复级操作行（复制按钮），中间过程行不出现。 */
  isTurnLastRow: boolean;
  onOpenTurnDiff?: (files: TurnModifiedFile[], turnIndex?: number, initialPath?: string) => void;
  timelineOpenState: Record<string, boolean>;
  setTimelineOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  showReasoningSummaries: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
  renderMarkdown: RenderMarkdown;
  turnGitFiles?: string[];
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
  const showFallbackReply =
    Boolean(fallbackReply) && !isBareEllipsisText(fallbackReply) && !timelineHasTextPart;
  // 回合修改文件汇总由列表层按用户行边界聚合（row.turnSummary）：
  // 汇总是「回合」的属性，挂在回合最后一行；这里只在回合结束后渲染（流式中隐藏）。
  const turnSummary = row.turnSummary;

  return (
    <div className="group/row grid min-w-0 gap-2">
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
      {/* 回合修改文件汇总（DSH 模式）：按用户行边界聚合，挂在回合最后一行。
          流式进行中隐藏——数据齐了整个回合也结束了。 */}
      {!isStreaming && turnSummary && turnSummary.length > 0 ? (
        <TurnModifiedFilesRow
          files={turnSummary}
          turnIndex={row.turnIndex}
          onOpenToolFile={onOpenToolFile}
          onOpenTurnDiff={onOpenTurnDiff}
        />
      ) : null}
      {/* 插话多回合后常见：live 只剩 tool、「已查询」在时间线，正文只在 msg.content。
          旧逻辑 hasTimeline 时不渲染 fallback → 前几轮答复闪现后消失。 */}
      {showFallbackReply ? (
        <AssistantTextBlock
          text={fallbackReply}
          streaming={Boolean(isStreaming && !timelineHasTextPart)}
          trailing={isTurnLastRow}
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
      {/* 回复结束后的操作行(ai-elements MessageActions,官方 chat 交互:
          hover 该条消息才浮现,左对齐跟随内容;仅当确有正文可复制时渲染;
          仅挂在回合最后一个 assistant 行——中间过程行(纯工具轮)不出复制按钮)。 */}
      {!isStreaming && isTurnLastRow && !errorMessage && (timelineHasTextPart || Boolean(fallbackReply?.trim())) ? (
        <MessageActions className="justify-start opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100">
          <CopyReplyAction
            text={
              timelineHasTextPart
                ? buildAgentReplyMarkdownFromParts(renderParts)
                : (fallbackReply || "").trim() || buildAgentReplyMarkdownFromParts(renderParts)
            }
          />
        </MessageActions>
      ) : null}
    </div>
  );
}

function renderPartsHasFailure(parts: AgentDetailedPart[]): boolean {
  return parts.some((part) => String((part as { type?: string }).type || "") === "runtime.failure");
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
        buildAgentAssistantRenderGroups(dedupeAgentChunkedTextParts(target.renderParts), {
          liftProcessParts: target.isStreaming
        }),
        showReasoningSummaries
      );
      target.hasTimeline = hasVisibleTimelineGroups(target.timelineGroups);
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
  turnManifest,
  onOpenTurnDiff,
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
  /**
   * 成熟平滑方案 Lenis：库内 wheel 劫持 + 帧率无关 damp 动画 + 滚动条同步回写。
   * 只负责滚轮平滑，不接管 touch/滚动条/键盘；钉底与程序定位继续走原生即时滚动。
   */
  const smoothWheelLenisRef = useRef<Lenis | null>(null);
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
      dedupeAgentToolParts(
        detailParts
          .filter(isAgentRenderablePart)
          // 省略号占位叙述在 hasTimeline 计算前剔除：否则占位符被不可见组挤掉又塌回去
          .filter((part) => {
            const type = String((part as { type?: string }).type || "");
            return type !== "text" || !isBareEllipsisText(String((part as { text?: string }).text || ""));
          })
      )
    );
    const errorMessage = isAssistant ? runFailureText(msg) : "";
    const todoItems = [...detailParts].reverse().map(readAgentTodosFromPart).find((todos) => todos.length > 0) || [];
    const timelineGroups = buildDisplayTimelineGroups(
      buildAgentAssistantRenderGroups(renderParts, { liftProcessParts: isStreaming }),
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
      hasTimeline: hasVisibleTimelineGroups(timelineGroups),
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
          dedupeAgentChunkedTextParts(
            coalesceRuntimeParts(dedupeAgentToolParts(target.renderParts))
          )
        );
        target.timelineGroups = buildDisplayTimelineGroups(
          buildAgentAssistantRenderGroups(target.renderParts, {
            liftProcessParts: target.isStreaming
          }),
          showReasoningSummaries
        );
        target.hasTimeline = hasVisibleTimelineGroups(target.timelineGroups);
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
      // 同一回合内（相邻 assistant 块）全部并入同一单元格：pi 把每轮工作/正文拆成
      // 多条 assistant，若「工具轮 ↔ 正文轮」不合并，段卡会被中间 assistant 拆成
      // 「已运行 → 正文 → 已运行 → 正文 → 已运行」的多组并列卡；活动段划分本身
      // 已能按正文切段，这里只需保证这些段挂在同一个渲染单元里。
      // 跨回合由 user 行天然隔开，不会误并入下一轮。
      const lastText = (last.fallbackReply || last.msg.content || "").trim();
      const rowText = (row.fallbackReply || row.msg.content || "").trim();
      // 占位叙述（…/.../·）不是真实正文：不同消息恰好都只输出了同一个占位符时，
      // 不能按「同一段正文重复」走替换式去重，否则替换行会丢掉此前累计的工具事件
      // （表现为某次回复只剩后几轮工具）。只允许真实正文相同才进入该分支，
      // 且替换行必须并集继承已有事件，保证去重只增不减。
      if (
        lastText
        && rowText
        && lastText === rowText
        && !isBareEllipsisText(lastText)
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
          row.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
          row.renderParts = dedupeAgentToolParts([...last.renderParts, ...row.renderParts]);
          row.todoItems = row.todoItems.length > 0 ? row.todoItems : last.todoItems;
          row.isStreaming = last.isStreaming || row.isStreaming;
          row.stableKey = last.stableKey;
          rebuildTimeline(row);
          out[out.length - 1] = row;
        }
        return out;
      }
      if (!row.errorMessage || !last.errorMessage) {
        last.isStreaming = last.isStreaming || row.isStreaming;
        last.liveParts = dedupeAgentToolParts([...last.liveParts, ...row.liveParts]);
        last.renderParts = dedupeAgentToolParts([...last.renderParts, ...row.renderParts]);
        last.detailsLoading = last.detailsLoading || row.detailsLoading;
        if (row.todoItems.length > 0) last.todoItems = row.todoItems;
        last.errorMessage = last.errorMessage || row.errorMessage;
        last.detailsError = last.detailsError || row.detailsError;
        last.msg = {
          ...last.msg,
          id: `${last.msg.id}:${row.msg.id}`,
          content: rowText || lastText,
          error: last.msg.error || row.msg.error
        };
        rebuildTimeline(last);
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
  // 回合修改文件汇总：按「用户行边界」切回合（DSH 模式——汇总是回合的属性，不是某条
  // assistant 消息的内部零件）。每个回合从其所有 assistant 行的工具 parts 聚合，
  // 挂在回合最后一行；run manifest 差集（bash 写入）并入未闭合的当前回合。
  // 行结构无论怎么合并/分裂都不影响：只依赖 user/assistant 边界，稳定可预期。
  const rowsWithTurnSummary = useMemo(() => {
    const result = visibleRenderRows.map((row) => ({ ...row, turnSummary: undefined as TurnModifiedFile[] | undefined }));
    const mergeFile = (list: TurnModifiedFile[], incoming: TurnModifiedFile) => {
      const hit = list.find((file) => file.path === incoming.path);
      if (hit) {
        // 编辑块跨行合并（工具轮拆行时同文件多次编辑不丢块），统计统一从合并后的块推导。
        // 与单行采集同一规则：连续相同块 = 模型重试，去重防双计。
        if (incoming.edits?.length) {
          hit.edits = hit.edits || [];
          for (const edit of incoming.edits) {
            const last = hit.edits[hit.edits.length - 1];
            if (last && last.before === edit.before && last.after === edit.after) continue;
            if (hit.edits.length >= 10) break;
            hit.edits.push(edit);
          }
          const stats = deriveTurnStats(hit.edits);
          hit.added = stats.added;
          hit.removed = stats.removed;
        }
      } else {
        list.push({ ...incoming });
      }
    };
    let turnFiles: TurnModifiedFile[] = [];
    let lastAssistantIndex = -1;
    let turnCounter = 0;
    const closedTurns: Array<{ index: number; turn: number }> = [];
    const flush = () => {
      if (lastAssistantIndex >= 0 && turnFiles.length > 0) {
        result[lastAssistantIndex].turnSummary = turnFiles;
        closedTurns.push({ index: lastAssistantIndex, turn: Math.max(1, turnCounter) });
      }
      turnFiles = [];
      lastAssistantIndex = -1;
    };
    for (let index = 0; index < result.length; index += 1) {
      const row = result[index];
      if (!row.isAssistant) {
        // 用户行 = 回合边界：收尾上一回合，轮次 +1。
        flush();
        turnCounter += 1;
        continue;
      }
      lastAssistantIndex = index;
      for (const file of collectTurnModifiedFiles(row.renderParts)) mergeFile(turnFiles, file);
    }
    flush();
    // 轮次标注：除最后一轮外都标「第 N 轮」，最后一轮是「本轮改动」（用户语义）。
    closedTurns.forEach((entry, position) => {
      if (position < closedTurns.length - 1) result[entry.index].turnIndex = entry.turn;
    });
    // manifest 差集按轮次归属（bash 间接写入无工具记录，靠磁盘快照兜底）：
    // 每个闭合轮 + 开回合都按自己的轮次序号取快照——历史轮的快照不被后续轮覆盖。
    // 有真实 before/after 时替换工具流条目（净变化语义），并标记 snapshot（整文件可渲染）。
    const applyManifest = (rowIndex: number, turnNumber: number) => {
      const manifest = turnManifest[turnNumber];
      if (!manifest || manifest.changed.length === 0) return;
      const open = result[rowIndex].turnSummary || (result[rowIndex].turnSummary = []);
      const realDiffByPath = new Map(manifest.fileDiffs.map((diff) => [diff.path, diff]));
      for (const path of manifest.changed) {
        const real = realDiffByPath.get(path);
        if (real) {
          const entry: TurnModifiedFile = {
            path: real.path,
            edits: [{ before: real.before, after: real.after }],
            snapshot: true
          };
          const stats = deriveTurnStats(entry.edits);
          entry.added = stats.added;
          entry.removed = stats.removed;
          const at = open.findIndex((file) => file.path === real.path);
          if (at >= 0) open[at] = entry;
          else open.push(entry);
        } else {
          mergeFile(open, { path });
        }
      }
    };
    for (const entry of closedTurns) applyManifest(entry.index, entry.turn);
    // 开回合（列表末尾、尚无后续用户行）的序号 = 已计数 +1。
    {
      let boundary = 0;
      for (let index = result.length - 1; index >= 0; index -= 1) {
        if (!result[index].isAssistant) {
          boundary = index + 1;
          break;
        }
      }
      for (let index = result.length - 1; index >= boundary; index -= 1) {
        if (result[index].isAssistant) {
          applyManifest(index, turnCounter + 1);
          break;
        }
      }
    }
    return result;
  }, [visibleRenderRows, turnManifest]);
  // 每段「连续 assistant 块」的末行（下一行是 user/列表尾）：只有这一行挂回复级操作行
  // （复制按钮）。中间过程行（工具轮拆出的 assistant）hover 不再浮出按钮；
  // system 行不打断回合判定。
  const turnLastAssistantKeys = new Set<string>();
  for (let index = 0; index < visibleRenderRows.length; index += 1) {
    const row = visibleRenderRows[index];
    if (!row.isAssistant) continue;
    let probe = index + 1;
    while (probe < visibleRenderRows.length && visibleRenderRows[probe].isSystem) probe += 1;
    const next = visibleRenderRows[probe];
    if (!next || !next.isAssistant) turnLastAssistantKeys.add(row.stableKey);
  }
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
  const attachScrollerListeners = useCallback(
    (el: HTMLElement) => {
    if (scrollerListenersRef.current?.el === el) return; // Virtuoso 可能多次回传同一 el
    scrollerListenersRef.current?.clean();
    const content = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el;
    smoothWheelLenisRef.current?.destroy();
    // Lenis 官方姿势：只接管滚轮（smoothWheel）；touch/滚动条/键盘保持原生节奏。
    // duration 与 lerp 官方互斥，这里用 lerp damp 模式，连续 wheel 是“改目标”而非“重启动画”。
    // allowNestedScroll 是官方嵌套滚动方案，展开卡片/代码块等内层可滚动区优先消费 wheel。
    const lenis = new Lenis({
      wrapper: el,
      content,
      eventsTarget: el,
      lerp: SMOOTH_WHEEL_LENIS_LERP,
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1,
      allowNestedScroll: true,
      autoRaf: true
    });
    smoothWheelLenisRef.current = lenis;
    // 用户滚轮向上离开底部时立即取消贴底意图；否则持续 rAF 钉底会和 Lenis 平滑动画互相写 scrollTop。
    const onLenisScroll = (instance: Lenis) => {
      if (instance.isScrolling === "smooth" && instance.direction === -1) {
        stickToBottomRef.current = false;
      }
    };
    lenis.on("scroll", onLenisScroll);
    const endSmoothWheel = () => {
      const lenis = smoothWheelLenisRef.current;
      if (!lenis) return;
      lenis.stop();
      lenis.start();
    };
    let lastTouchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      endSmoothWheel();
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
      endSmoothWheel();
      if (e.offsetX >= el.clientWidth - 1) {
        scrollbarDraggingRef.current = true;
      }
    };
    const endScrollbarDrag = () => {
      scrollbarDraggingRef.current = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") {
        endSmoothWheel();
        stickToBottomRef.current = false;
      } else if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "End") {
        endSmoothWheel();
      }
    };
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
        endSmoothWheel();
        lenis.off("scroll", onLenisScroll);
        smoothWheelLenisRef.current?.destroy();
        smoothWheelLenisRef.current = null;
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointerup", endScrollbarDrag);
        el.removeEventListener("pointercancel", endScrollbarDrag);
        window.removeEventListener("pointerup", endScrollbarDrag);
        el.removeEventListener("keydown", onKeyDown);
      }
    };
    },
    []
  );
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
        // Lenis 正在做平滑 wheel 动画时必须让路：官方动画已经负责写 scrollTop，
        // 此处再物理钉底会形成快滚抖动；上滚时 onLenisScroll 已取消贴底意图。
        if (smoothWheelLenisRef.current?.isScrolling === "smooth") {
          lastTop = sc.scrollTop;
          raf = requestAnimationFrame(tick);
          return;
        }
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
        data={rowsWithTurnSummary}
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
                    isTurnLastRow={turnLastAssistantKeys.has(row.stableKey)}
                    timelineOpenState={timelineOpenState}
                    setTimelineOpenState={setTimelineOpenState}
                    showReasoningSummaries={showReasoningSummaries}
                    shellToolPartsExpanded={shellToolPartsExpanded}
                    editToolPartsExpanded={editToolPartsExpanded}
                    onOpenTaskSession={onOpenTaskSession}
                    onOpenToolFile={onOpenToolFile}
                    onOpenBrowserUrl={onOpenBrowserUrl}
                    renderMarkdown={renderMarkdown}
                    onOpenTurnDiff={onOpenTurnDiff}
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

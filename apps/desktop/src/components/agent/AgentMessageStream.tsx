import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FilePen, BrainIcon, ChevronDownIcon, Copy as CopyIcon, Check as CheckIconLucide, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, FlaskConicalIcon, LoaderCircleIcon, XCircleIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../ui/hover-card";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { buildHunks, diffLines } from "../../lib/turnDiff";
import { DiffLineRows, StatsBadgeText, collectTurnModifiedFiles, compressEdits, deriveTurnStats, type TurnManifestEntry, type TurnModifiedFile } from "./TurnDiffViewer";
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
import { humanizeAgentError } from "../../lib/humanizeAgentError";
import { cn } from "../../lib/utils";
import { MarkdownLite } from "../common/MarkdownLite";
import { AnimatedCollapsibleContent } from "../ui/animated-collapsible-content";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Skeleton } from "../ui/skeleton";
import { AgentExecutionPartView, type AgentToolFileTarget } from "./AgentExecutionPartView";
import { AgentMessageNavigator, type NavigatorMarker } from "./AgentMessageNavigator";
import { AgentSailingNavigator } from "./AgentSailingNavigator";
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
import { CodeBlock, CodeBlockContent } from "../ai-elements/code-block";

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
  if (!(row.isAssistant && !row.hasTimeline && !row.fallbackReply && !row.detailsError && !row.errorMessage)) {
    return false;
  }
  // 只有思考（reasoning）流、暂无正文的行不算空占位：暂停后 isStreaming 翻 false，
  // 若按空占位过滤会把用户已经看到的思考内容整段隐藏（2026-11-10 实证：
  // 模型长思考期间点停止，已渲染的 reasoning 正文随占位一起消失）。
  const hasReasoning = (row.renderParts || []).some((part) => {
    if (String((part as { type?: string }).type || "") !== "reasoning") return false;
    return Boolean(String((part as { text?: string }).text || "").trim());
  });
  // 忽略 detailsLoading：新 assistant 一创建就会被拉详情，若把 loading 当成非空，
  // 会无法并入上一条，从而在时间线里插入多余的「思考中」占位。
  return !hasReasoning;
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
  // 普通列表 + Lenis：真实 scrollHeight，滚轮惯性由 Lenis 接管。
  activeSessionId: string;
  onStartReached: () => void;
  onAtBottomChange: (atBottom: boolean) => void;
  scrollerRef: (node: HTMLElement | Window | null) => void;
  onRangeChanged: () => void;
  /** 外部请求滚动定位到的消息 id（搜索命中时由 App 写入，定位完成后清空）。 */
  pendingScrollMessageId?: string;
  onPendingScrollDone?: () => void;
  /** 每次搜索点击递增；与 messageId 一起构成定位请求身份。 */
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
  /** 概览标尺样式：经典尺标或帆船航线。 */
  navigatorStyle?: "rail" | "sailing";
  /** 外部强制恢复贴底跟随（发送/拉到最新时递增）；驱动内部 stick ref + 持续 rAF 钉底。 */
  stickResetSignal?: number;
};

type RenderMarkdown = (source: string, streaming?: boolean) => ReactNode;

// 普通列表列：左缘由 AgentChatFrame 下发的 --chat-content-left 决定。
function AgentMessageRowFrame({ children }: { children: ReactNode }) {
  return <div className="min-w-0 overflow-x-clip pb-3">{children}</div>;
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

const TEST_RUN_COMMAND_PATTERN = /(^|\s|;&|&&|\|\|)(npm|pnpm|yarn|bun|vitest|jest|cargo|pytest|go|node)(\s|\.\/)\S*(test|vitest|jest|pytest|spec)/i;

/** 官方 Test Results 卡片的单个用例（解析 bash 输出 JSONL / 测试框架文本所得）。 */
type AgentTestResult = {
  name: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
};

type AgentTestSuite = {
  name: string;
  tests: AgentTestResult[];
};

/**
 * bash 输出 → 官方 Test Results 套件/用例结构：
 * 1) JSONL 每行一条 {type:"test", name, status, suiteName?, error?}；
 * 2) vitest/jest 文本（✓/✗ 用例行、PASS|FAIL 文件行）。
 * 识别不到任何用例时返回 null（继续走原终端块渲染）。
 */
function parseAgentTestOutput(
  command: string,
  output: string
): { suites: AgentTestSuite[]; failed: number; total: number; skipped: number } | null {
  const text = String(output || "");
  if (!text.trim() || !TEST_RUN_COMMAND_PATTERN.test(String(command || ""))) return null;
  const suites = new Map<string, AgentTestSuite>();
  const getSuite = (name: string): AgentTestSuite => {
    const key = String(name || "").trim() || "tests";
    let suite = suites.get(key);
    if (!suite) {
      suite = { name: key, tests: [] };
      suites.set(key, suite);
    }
    return suite;
  };
  const asStatus = (value: unknown): AgentTestResult["status"] | undefined => {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "passed" || raw === "pass" || raw === "ok" || raw === "success") return "passed";
    if (raw === "failed" || raw === "fail" || raw === "error") return "failed";
    if (raw === "skipped" || raw === "skip" || raw === "todo" || raw === "pending") return "skipped";
    return undefined;
  };
  const isTestEvent = (row: Record<string, unknown>): boolean => {
    const type = String(row.type || "").toLowerCase();
    return type === "test" || type === "test_result" || type === "testresult"
      || (type === "" && String(row.name || "").trim().length > 0 && Boolean(asStatus(row.status)));
  };
  const seen = new Set<string>();
  const push = (suiteName: string, name: string, status: AgentTestResult["status"], error?: string) => {
    const label = String(name || "").trim();
    if (!label || seen.has(label)) return;
    seen.add(label);
    getSuite(suiteName).tests.push({ name: label, status, error: String(error || "").trim() || undefined });
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{")) {
      try {
        const row = JSON.parse(trimmed) as Record<string, unknown>;
        if (isTestEvent(row)) {
          const status = asStatus(row.status) ?? asStatus(row.state);
          if (status) {
            push(
              String(row.suiteName || row.suite || row.file || ""),
              String(row.name || row.title || ""),
              status,
              String(row.error || row.message || "")
            );
            continue;
          }
        }
      } catch {
        // 非 JSONL 测试事件，继续文本解析
      }
    }
    const iconMatch = trimmed.match(/^(?:✓|√|✗|×|✕)\s+(.+?)(?:\s+\(\d+(?:\.\d+)?\s*(?:ms|s)\))?$/);
    if (iconMatch) {
      const label = iconMatch[1].trim();
      const failed = /^(✗|×|✕)/.test(trimmed);
      push("", label, failed ? "failed" : "passed");
      continue;
    }
    const suiteLine = trimmed.match(/^(?:PASS|FAIL)\s+(\S+)$/i);
    if (suiteLine) {
      getSuite(suiteLine[1]);
    }
  }
  const list = Array.from(suites.values()).filter((suite) => suite.tests.length > 0);
  if (list.length === 0) return null;
  const tests = list.flatMap((suite) => suite.tests);
  return {
    suites: list,
    total: tests.length,
    failed: tests.filter((test) => test.status === "failed").length,
    skipped: tests.filter((test) => test.status === "skipped").length
  };
}

function formatTestCounts(counts: { total: number; failed: number; skipped: number }): string {
  return [
    `${counts.total} 个测试`,
    counts.failed > 0 ? `${counts.failed} 个失败` : "",
    counts.skipped > 0 ? `${counts.skipped} 个跳过` : ""
  ].filter(Boolean).join("，");
}

/** 官方 TestResultsRow：失败默认展开、错误栈用官方 CodeBlock（sm 尺寸）。 */
function AgentTestResultsRow({
  timelineKey,
  command,
  result,
  running,
  failed
}: {
  timelineKey: string;
  command: string;
  result: { suites: AgentTestSuite[]; failed: number; total: number; skipped: number } | null;
  running: boolean;
  failed: boolean;
}) {
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
  const open = userOpen ?? (failed || running);
  if (!result) {
    return (
      <TraceLine status={running ? "running" : failed ? "error" : undefined}>
        <TraceIcon>
          {running ? <LoaderCircleIcon className="animate-spin" /> : <FlaskConicalIcon />}
        </TraceIcon>
        <TraceTitle className="text-sm">
          {running ? `运行测试 ${command}` : failed ? `测试运行失败 ${command}` : command}
        </TraceTitle>
      </TraceLine>
    );
  }
  return (
    <TraceCollapsible open={open} onOpenChange={setUserOpen}>
      <TraceCollapsibleTrigger className="min-w-0 max-w-full">
        <TraceLine status={failed ? "error" : undefined}>
          <TraceIcon>
            {running ? <LoaderCircleIcon className="animate-spin" /> : <FlaskConicalIcon />}
          </TraceIcon>
          <TraceTitle className="text-sm">
            {running ? "运行测试中" : `已运行 ${formatTestCounts(result)}`}
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-0.5">
        <Trace>
          {result.suites.map((suite) => {
            const suiteFailed = suite.tests.some((test) => test.status === "failed");
            const suiteKey = `${timelineKey}:suite:${suite.name}`;
            return (
              <TraceCollapsible key={suiteKey} defaultOpen={suiteFailed}>
                <TraceCollapsibleTrigger className="min-w-0 max-w-full">
                  <TraceLine status={suiteFailed ? "error" : undefined}>
                    <TraceIcon>
                      <FlaskConicalIcon />
                    </TraceIcon>
                    <TraceTitle className="max-w-[320px] truncate">{suite.name}</TraceTitle>
                    <TraceDescription className="max-w-[160px] shrink truncate">
                      {formatTestCounts({
                        total: suite.tests.length,
                        failed: suite.tests.filter((test) => test.status === "failed").length,
                        skipped: suite.tests.filter((test) => test.status === "skipped").length
                      })}
                    </TraceDescription>
                  </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent className="flex flex-col gap-0.5">
                  <Trace>
                    {suite.tests.map((test, testIndex) => {
                      const testKey = `${timelineKey}:test:${testIndex}:${test.name}`;
                      if (test.status === "failed") {
                        return (
                          <TraceCollapsible key={testKey} defaultOpen>
                            <TraceCollapsibleTrigger className="min-w-0 max-w-full">
                              <TraceLine status="error">
                                <TraceIcon>
                                  <XCircleIcon />
                                </TraceIcon>
                                <TraceTitle className="max-w-[360px] truncate">{test.name}</TraceTitle>
                              </TraceLine>
                            </TraceCollapsibleTrigger>
                            <TraceCollapsibleContent>
                              <CodeBlock
                                language="json"
                                code={test.error || "测试失败。"}
                                className="max-h-64 [&_[data-slot=code-block-body]]:overflow-auto"
                              >
                                <CodeBlockContent code={test.error || "测试失败。"} language="json" />
                              </CodeBlock>
                            </TraceCollapsibleContent>
                          </TraceCollapsible>
                        );
                      }
                      return (
                        <TraceLine key={testKey}>
                          <TraceIcon>
                            {test.status === "skipped" ? <CircleDashedIcon /> : <CircleCheckIcon />}
                          </TraceIcon>
                          <TraceTitle className="max-w-[360px] truncate">
                            {test.status === "skipped" ? `跳过 ${test.name}` : test.name}
                          </TraceTitle>
                        </TraceLine>
                      );
                    })}
                  </Trace>
                </TraceCollapsibleContent>
              </TraceCollapsible>
            );
          })}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
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
  "重试": { active: "重试中", done: "已重试" },
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
  const retryParts = steps.flatMap((step) =>
    step.kind === "part"
    && String((step.part as { type?: string }).type || "") === "runtime.retry"
      ? [step.part]
      : []
  );
  const hasRetry = retryParts.length > 0;
  const retryRunning = retryParts.some((part) => {
    const phase = String((part as { phase?: string }).phase || "").trim();
    const success = (part as { success?: boolean | null }).success;
    return phase === "started" || (phase === "completed" && success === false);
  });
  const hasTask = steps.some(
    (step) =>
      (step.kind === "part" && isTaskToolPart(step.part))
      || (step.kind === "tool-batch" && step.batchKind === "task")
  );
  // 子任务/重试行默认展开，避免只看到「运行中 1 个步骤」却看不到重试原因。
  const autoOpenRunning = hasTask || (anyRunning && retryRunning);
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
  // 有 runtime.retry 时优先「重试」，否则折叠标题看不出在自动重试。
  const segmentLabel = (() => {
    if (hasRetry) return "重试";
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
        else if (type === "text" || type === "runtime.retry") continue;
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
  const retrySummary = (() => {
    if (!hasRetry) return "";
    const part = retryParts[retryParts.length - 1];
    const attempt = Number((part as { attempt?: number }).attempt) || 0;
    const maxAttempts = Number((part as { maxAttempts?: number }).maxAttempts) || 0;
    const attemptLabel = maxAttempts > 0 ? `${attempt}/${maxAttempts}` : String(attempt || "?");
    const error = humanizeAgentError(String((part as { error?: string }).error || "").trim());
    const preview = error.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
    return preview ? `${attemptLabel} · ${preview}` : attemptLabel;
  })();

  // 官方 Test Results 识别：同一段里 bash 命令 + 输出可解析出套件/用例时，
  // 用官方 test-results 卡替代该次命令的普通终端行；其余命令仍走原渲染。
  const bashTestRows = steps.flatMap((step) => {
    if (step.kind !== "tool-batch") return [] as {
      key: string;
      command: string;
      part: AgentDetailedPart;
      result: { suites: AgentTestSuite[]; failed: number; total: number; skipped: number };
      failed: boolean;
    }[];
    const commands = step.parts.filter(
      (part) => String((part as { toolName?: string }).toolName || "") === "bash"
    );
    if (commands.length !== 1) return [];
    const part = commands[0];
    const command = String((part as { input?: { command?: unknown } }).input?.command || "").trim();
    const output = String((part as { output?: unknown }).output || "");
    const result = parseAgentTestOutput(command, output);
    return result ? [{
      key: String((part as { id?: string }).id || `${timelineKey}:bash:${command}`),
      command,
      part,
      result,
      failed: result.failed > 0
        || String((part as { status?: string }).status || "").toLowerCase() === "error"
        || Boolean((part as { isError?: unknown }).isError)
    }] : [];
  });
  const testRowByPartId = new Map<string, (typeof bashTestRows)[number]>();
  for (const row of bashTestRows) {
    for (const id of [row.key, String(row.part.id || "")]) {
      if (id) testRowByPartId.set(id, row);
    }
  }
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
              {retrySummary || `${stepCount} 个步骤`}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-0.5 pb-1.5">
            {steps.map((step, stepIndex) => {
              const stepKey = `${timelineKey}:step:${step.kind}:${String((step as { key?: string }).key || stepIndex)}`;
              const testRow = step.kind === "tool-batch"
                ? step.parts
                    .map((part) => testRowByPartId.get(String((part as { id?: string }).id || "")))
                    .find(Boolean)
                : undefined;
              if (step.kind === "tool-batch" && testRow) {
                return (
                  <AgentTestResultsRow
                    key={`${stepKey}:test-results`}
                    timelineKey={timelineKey}
                    command={testRow.command}
                    result={testRow.result}
                    running={!forceInactive && !testRow.failed}
                    failed={testRow.failed}
                  />
                );
              }
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
  // 官方 Chain of Thought：回合里穿插了活动段时，整回合收进一条摘要行（默认展开），
  // 展开区内按正文时序铺开各段卡；流式中的段卡仍在真实时序位置，结束后不重排。
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
  const error = humanizeAgentError(String((part as { error?: string }).error || "").trim());
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
  const text = humanizeAgentError(message).trim();
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
  onRangeChanged,
  pendingScrollMessageId,
  onPendingScrollDone,
  locateNonce = 0,
  highlightKeyword,
  text,
  navigatorHidden = false,
  navigatorSide = "right",
  navigatorScope = "all",
  navigatorStyle = "rail",
  stickResetSignal = 0
}: AgentMessageStreamProps) {
  const [timelineOpenState, setTimelineOpenState] = useState<Record<string, boolean>>({});
  const [messageOpenState, setMessageOpenState] = useState<Record<string, boolean>>({});
  const [highlightMessageId, setHighlightMessageId] = useState("");
  /** 概览标尺高亮下标；由滚动进度推导，仅下标变化时 setState。 */
  const [navigatorActiveIndex, setNavigatorActiveIndex] = useState<number | null>(null);
  /** 本会话已完成过搜索定位：禁止随后的「滚到底唤醒」抢走视口。 */
  const locatedThisSessionRef = useRef(false);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const lenisRef = useRef<Lenis | null>(null);
  /**
   * DSH 同款贴底意图：默认 true。
   * 取消只认读者输入造成的 scrollTop 偏离（observedTop 账本），不认程序写滚动。
   */
  const stickToBottomRef = useRef(true);
  /** 最近一次程序化写入的 scrollTop；与当前 scrollTop 偏差才算读者输入。 */
  const observedTopRef = useRef(0);
  /** 程序化写滚动期间忽略 scroll 事件，避免被误判成读者上滚而清 stick。 */
  const writingScrollRef = useRef(false);
  const atBottomRef = useRef(true);
  /**
   * 只在 run busy 时持续追底。结束后收口/高度回缩再 pin，会把视口拽回
   * 「user 贴底」的刚发送姿态；busy→idle 只钉一次终态位置。
   */
  const activeSessionBusyRef = useRef(activeSessionBusy);
  activeSessionBusyRef.current = activeSessionBusy;
  const prevSessionBusyRef = useRef(activeSessionBusy);
  /** 加载更早历史：保存可见行锚点，prepend 后校正。 */
  const prependAnchorRef = useRef<{ key: string; top: number } | null>(null);
  const firstRowKeyRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);
  /**
   * 概览标尺进度：scrollTop / maxScroll ∈ [0,1]，存在 ref 里。
   * 帆船 Y 与蓝点高亮共用这一轴：船每帧读 ref，蓝点 = progress 映射到消息下标。
   */
  const navigatorProgressRef = useRef(0);
  const navigatorMaxIndexRef = useRef(0);
  const syncNavigatorFromScrollRef = useRef<() => void>(() => {});
  const pendingLocateIdRef = useRef("");
  const FOLLOW_THRESHOLD = 24;

  const canStickPin = () =>
    stickToBottomRef.current
    && !pendingLocateIdRef.current
    && !locatedThisSessionRef.current;

  const flowTop = (row: HTMLElement, scrollport: HTMLElement) =>
    row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;

  /** 程序化滚动：一律走 Lenis（有实例）或原生 scrollTop，并记账 observedTop。 */
  const writeScrollTop = useCallback((top: number, immediate = true) => {
    const sc = scrollerElRef.current;
    if (!sc) return;
    const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
    const clamped = Math.max(0, Math.min(top, max));
    // 先记账目标，再写滚动：Lenis/原生 scroll 事件同步触发时不会误判成读者输入。
    writingScrollRef.current = true;
    observedTopRef.current = clamped;
    try {
      const lenis = lenisRef.current;
      if (lenis) {
        lenis.resize();
        lenis.scrollTo(clamped, { immediate });
        observedTopRef.current = lenis.actualScroll;
      } else {
        sc.scrollTop = clamped;
        observedTopRef.current = sc.scrollTop;
      }
    } finally {
      writingScrollRef.current = false;
    }
  }, []);

  const pinToBottom = useCallback((immediate = true) => {
    const sc = scrollerElRef.current;
    if (!sc) return;
    prependAnchorRef.current = null;
    writeScrollTop(sc.scrollHeight, immediate);
    stickToBottomRef.current = true;
    atBottomRef.current = true;
    // 尺标进度/蓝点一律走 sync（progress 同轴），避免贴底时另写一套下标。
    syncNavigatorFromScrollRef.current();
    onAtBottomChange(true);
  }, [writeScrollTop, onAtBottomChange]);

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
      if (Math.abs(delta) >= 8) {
        writeScrollTop(sc.scrollTop + delta, true);
      }
    };
  }, [writeScrollTop]);

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
  navigatorMaxIndexRef.current = Math.max(0, rowsWithTurnSummary.length - 1);

  const syncNavigatorFromScroll = useCallback(() => {
    const sc = scrollerElRef.current;
    if (!sc) return;
    const maxScroll = Math.max(0, sc.scrollHeight - sc.clientHeight);
    let progress: number;
    if (maxScroll <= 1) {
      progress = 1;
    } else {
      const top = sc.scrollTop;
      if (top <= 2) progress = 0;
      else if (top >= maxScroll - 2) progress = 1;
      else progress = top / maxScroll;
    }
    // 船与蓝点同一轴：progress → 船 Y；round(progress×maxIdx) → 蓝点（再取最近 marker）。
    // 勿再用视口中心命中：消息高度不均时蓝点会漂到船外很远。
    navigatorProgressRef.current = progress;
    const maxIdx = navigatorMaxIndexRef.current;
    const nextIndex = maxIdx <= 0 ? 0 : Math.round(progress * maxIdx);
    setNavigatorActiveIndex((prev) => (prev === nextIndex ? prev : nextIndex));
  }, []);
  syncNavigatorFromScrollRef.current = syncNavigatorFromScroll;

  const handleNavigatorJump = useCallback(
    (index: number, behavior: "smooth" | "auto") => {
      stickToBottomRef.current = false;
      atBottomRef.current = false;
      const stableKey = rowsWithTurnSummary[index]?.stableKey;
      if (!stableKey) return;
      const total = rowsWithTurnSummary.length;
      const target: "start" | "center" | "end" =
        index <= 0 ? "start" : index >= total - 1 ? "end" : "center";
      const adjust = adjustToMessage(stableKey, target);
      // 全部已挂 DOM：直接实测校正；smooth 走 Lenis 非 immediate。
      const el = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(stableKey)}"]`
      );
      const sc = scrollerElRef.current;
      if (el && sc) {
        const e = el.getBoundingClientRect();
        const s = sc.getBoundingClientRect();
        const delta =
          target === "start"
            ? e.top - s.top
            : target === "end"
              ? e.bottom - s.bottom
              : e.top + e.height / 2 - (s.top + s.height / 2);
        if (Math.abs(delta) >= 8) {
          writeScrollTop(sc.scrollTop + delta, behavior === "auto");
        }
        syncNavigatorFromScrollRef.current();
        onAtBottomChange(false);
        return;
      }
      adjust();
      let frames = 0;
      const step = () => {
        adjust();
        if (++frames < 6) requestAnimationFrame(step);
        else syncNavigatorFromScrollRef.current();
      };
      requestAnimationFrame(step);
      onAtBottomChange(false);
    },
    [rowsWithTurnSummary, adjustToMessage, writeScrollTop, onAtBottomChange]
  );

  const handleScrollerNode = useCallback(
    (node: HTMLDivElement | null) => {
      scrollerElRef.current = node;
      scrollerRef(node);
    },
    [scrollerRef]
  );

  // 侧栏同款：wrapper+content 都就绪后再挂 Lenis；layout 阶段装，避免微任务时序装不上。
  useLayoutEffect(() => {
    if (sessionLoading || messages.length === 0) return;
    const wrapper = scrollerElRef.current;
    const content = contentElRef.current;
    if (!wrapper || !content) return;

    const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;

    const setupLenis = () => {
      lenis?.destroy();
      lenis = null;
      lenisRef.current = null;
      if (reduceMotionQuery?.matches) return;
      lenis = new Lenis({
        wrapper,
        content,
        eventsTarget: wrapper,
        smoothWheel: true,
        syncTouch: false,
        // lerp（不用 duration）：连续/快速 wheel 是改目标而非重启动画，否则快滑只挪一小段。
        lerp: 0.075,
        wheelMultiplier: 1.35,
        orientation: "vertical",
        gestureOrientation: "vertical",
        allowNestedScroll: true,
        autoRaf: true,
        overscroll: false
      });
      lenisRef.current = lenis;
      // 尺寸变化后让 Lenis 重新读真实 limit。
      lenis.resize();
    };

    const onScroll = () => {
      const sc = scrollerElRef.current;
      if (!sc) return;
      const floor = Math.max(0, sc.scrollHeight - sc.clientHeight);
      if (writingScrollRef.current) {
        observedTopRef.current = sc.scrollTop;
        syncNavigatorFromScrollRef.current();
        return;
      }
      const movedByReader = Math.abs(sc.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5;
      const isAtBottom = movedByReader
        ? floor - sc.scrollTop <= FOLLOW_THRESHOLD + 1
        : atBottomRef.current;
      if (movedByReader) {
        stickToBottomRef.current = isAtBottom;
        atBottomRef.current = isAtBottom;
        onAtBottomChange(isAtBottom);
        if (!isAtBottom && sc.scrollTop <= 80 && !loadingOlderRef.current) {
          loadingOlderRef.current = true;
          const rows = contentElRef.current?.querySelectorAll<HTMLElement>("[data-message-id]");
          if (rows && rows.length > 0) {
            const viewport = sc.getBoundingClientRect();
            let anchor: HTMLElement | null = null;
            for (const row of rows) {
              const rect = row.getBoundingClientRect();
              if (rect.bottom > viewport.top + 8 && rect.top < viewport.bottom) {
                anchor = row;
                break;
              }
            }
            if (anchor?.dataset.messageId) {
              prependAnchorRef.current = {
                key: anchor.dataset.messageId,
                top: flowTop(anchor, sc)
              };
            }
          }
          onStartReached();
        }
      }
      observedTopRef.current = sc.scrollTop;
      syncNavigatorFromScrollRef.current();
      onRangeChanged();
    };

    setupLenis();
    wrapper.addEventListener("scroll", onScroll, { passive: true });
    reduceMotionQuery?.addEventListener?.("change", setupLenis);
    // 首帧同步尺标。
    requestAnimationFrame(() => syncNavigatorFromScrollRef.current());

    const onResize = () => {
      lenisRef.current?.resize();
      // 仅 busy 追高；收口后的 Resize（思考/工具收起）再 pin 会跳回 user 贴底。
      if (
        activeSessionBusyRef.current
        && stickToBottomRef.current
        && !pendingLocateIdRef.current
        && !locatedThisSessionRef.current
      ) {
        pinToBottom(true);
      } else {
        syncNavigatorFromScrollRef.current();
      }
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    ro?.observe(content);

    return () => {
      reduceMotionQuery?.removeEventListener?.("change", setupLenis);
      wrapper.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      lenis?.destroy();
      if (lenisRef.current === lenis) lenisRef.current = null;
    };
  }, [sessionLoading, messages.length, activeSessionId, onAtBottomChange, onStartReached, onRangeChanged, pinToBottom]);

  // 发送 / 拉到最新：恢复贴底。
  const prevStickResetRef = useRef(stickResetSignal);
  useEffect(() => {
    if (stickResetSignal === prevStickResetRef.current) return;
    prevStickResetRef.current = stickResetSignal;
    stickToBottomRef.current = true;
    locatedThisSessionRef.current = false;
    pinToBottom(true);
    const timers = [32, 80, 160].map((ms) => window.setTimeout(() => pinToBottom(true), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [stickResetSignal, pinToBottom]);

  // prepend 校正：头部 key 变化且长度增加时，把锚点行拉回原视口位置。
  useLayoutEffect(() => {
    const firstKey = rowsWithTurnSummary[0]?.stableKey ?? null;
    const prevFirst = firstRowKeyRef.current;
    firstRowKeyRef.current = firstKey;
    loadingOlderRef.current = false;
    const anchor = prependAnchorRef.current;
    if (!anchor || !firstKey || firstKey === prevFirst) return;
    const sc = scrollerElRef.current;
    if (!sc) return;
    const row = contentElRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(anchor.key)}"]`
    );
    if (!row) return;
    const delta = flowTop(row, sc) - anchor.top;
    if (Math.abs(delta) >= 1) writeScrollTop(sc.scrollTop + delta, true);
    prependAnchorRef.current = null;
    syncNavigatorFromScrollRef.current();
  }, [rowsWithTurnSummary, writeScrollTop]);

  const pendingLocateId = pendingScrollMessageId?.trim() || "";
  pendingLocateIdRef.current = pendingLocateId;
  const pendingLocateIndex = pendingLocateId
    ? rowsWithTurnSummary.findIndex((row) => rowMatchesMessageId(row, pendingLocateId))
    : -1;

  // 切会话：清高亮与贴底账本。
  const prevSessionIdRef = useRef(activeSessionId);
  if (prevSessionIdRef.current !== activeSessionId) {
    prevSessionIdRef.current = activeSessionId;
    locatedThisSessionRef.current = false;
    firstRowKeyRef.current = null;
    prependAnchorRef.current = null;
    stickToBottomRef.current = true;
    atBottomRef.current = true;
  }

  useEffect(() => {
    setHighlightMessageId("");
  }, [activeSessionId]);

  // 搜索定位：展开折叠 + 高亮。
  useEffect(() => {
    const id = pendingLocateId;
    if (!id || sessionLoading) return;
    if (rowsWithTurnSummary.length === 0) return;
    const idx = pendingLocateIndex;
    if (idx < 0) return;
    locatedThisSessionRef.current = true;
    stickToBottomRef.current = false;
    atBottomRef.current = false;
    setHighlightMessageId(id);
    setMessageOpenState((prev) => {
      const next = { ...prev, [id]: true };
      const row = rowsWithTurnSummary[idx];
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
  }, [pendingLocateId, pendingLocateIndex, sessionLoading, rowsWithTurnSummary.length, activeSessionId, locateNonce]);

  // 定位滚动：DOM 实测多帧收敛。
  useEffect(() => {
    if (!pendingLocateId || sessionLoading) return;
    if (pendingLocateIndex < 0) return;
    const stableKey = rowsWithTurnSummary[pendingLocateIndex]?.stableKey;
    if (!stableKey) return;

    let cancelled = false;
    let finished = false;
    const timers: number[] = [];
    const adjustMsg = adjustToMessage(stableKey, "start");
    const msgSel = `[data-message-id="${CSS.escape(stableKey)}"]`;

    const finish = () => {
      if (cancelled || finished) return;
      finished = true;
      syncNavigatorFromScrollRef.current();
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

    const bringMessageIntoView = () => {
      if (cancelled || finished) return;
      adjustMsg();
    };

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
      if (Math.abs(delta) >= 8) writeScrollTop(sc.scrollTop + delta, true);
      return true;
    };

    let keywordLocked = !(highlightKeyword || "").trim();
    const tick = () => {
      if (!keywordLocked) {
        bringMessageIntoView();
        keywordLocked = centerKeyword();
      } else if (!(highlightKeyword || "").trim()) {
        bringMessageIntoView();
      } else {
        centerKeyword();
      }
    };

    tick();
    let frames = 0;
    const step = () => {
      if (cancelled || finished) return;
      tick();
      if (++frames < 8) requestAnimationFrame(step);
    };
    const raf = requestAnimationFrame(step);
    ;[80, 280, 480, 720, 1100].forEach((delay, i, arr) => {
      timers.push(
        window.setTimeout(() => {
          if (cancelled || finished) return;
          tick();
          if (i === arr.length - 1) finish();
        }, delay)
      );
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLocateId, pendingLocateIndex, sessionLoading, highlightKeyword, locateNonce, activeSessionId]);

  useEffect(() => {
    if (!pendingLocateId || sessionLoading) return;
    if (pendingLocateIndex >= 0) return;
    const timer = window.setTimeout(() => {
      onPendingScrollDone?.();
    }, 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLocateId, pendingLocateIndex, sessionLoading]);

  // 切会话 / 加载完成：滚到底（不跟 length——收口并行走数变化时再 pin 会误跳）。
  useEffect(() => {
    if (sessionLoading || rowsWithTurnSummary.length === 0) return;
    if (pendingLocateId || locatedThisSessionRef.current) return;
    if (!stickToBottomRef.current) return;
    pinToBottom(true);
    const timers = [64, 200, 420].map((ms) => window.setTimeout(() => {
      if (!pendingLocateIdRef.current && !locatedThisSessionRef.current && stickToBottomRef.current) {
        pinToBottom(true);
      }
    }, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, sessionLoading]);

  // busy→idle：钉在输出结束位置一次，之后不再追布局回缩。
  useLayoutEffect(() => {
    const wasBusy = prevSessionBusyRef.current;
    prevSessionBusyRef.current = activeSessionBusy;
    if (wasBusy && !activeSessionBusy && canStickPin()) {
      pinToBottom(true);
    }
  }, [activeSessionBusy, pinToBottom]);

  // 流式增长时追底；结束后的 contentSig/收口抖动不再 pin。
  const lastRowKey = rowsWithTurnSummary[rowsWithTurnSummary.length - 1]?.stableKey ?? null;
  const lastRow = rowsWithTurnSummary[rowsWithTurnSummary.length - 1];
  const lastRowContentSig = lastRow
    ? `${lastRowKey}:${lastRow.msg.content.length}:${lastRow.liveParts.length}:${lastRow.renderParts.length}:${lastRow.fallbackReply.length}:${lastRow.timelineGroups.length}`
    : "";
  const prevLastRowKeyRef = useRef<string | null>(null);
  const lastRowIsAssistant = Boolean(lastRow?.isAssistant);
  useLayoutEffect(() => {
    const prev = prevLastRowKeyRef.current;
    prevLastRowKeyRef.current = lastRowKey;
    if (!lastRowKey) return;
    // 不要依赖 rowsWithTurnSummary 引用：蓝点 setState 也会换新数组，会把贴底打成死循环。
    if (!lastRowIsAssistant && lastRowKey !== prev) {
      if (canStickPin()) pinToBottom(true);
      return;
    }
    // 仅 run 进行中跟进最新；结束后停在输出完的位置。
    if (activeSessionBusy && canStickPin()) pinToBottom(true);
  }, [lastRowKey, lastRowContentSig, lastRowIsAssistant, activeSessionBusy, pinToBottom]);

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
      {navigatorStyle === "sailing" ? (
        <AgentSailingNavigator
          markers={navigatorMarkers}
          totalCount={rowsWithTurnSummary.length}
          activeIndex={navigatorActiveIndex}
          progressRef={navigatorProgressRef}
          onNavigate={handleNavigatorJump}
          text={text}
          hidden={navigatorHidden}
          side={navigatorSide}
        />
      ) : (
        <AgentMessageNavigator
          markers={navigatorMarkers}
          totalCount={rowsWithTurnSummary.length}
          activeIndex={navigatorActiveIndex}
          onNavigate={handleNavigatorJump}
          text={text}
          hidden={navigatorHidden}
          side={navigatorSide}
        />
      )}
      <div
        ref={handleScrollerNode}
        className="gt-subtle-scrollbar h-full min-h-0 overflow-auto [scrollbar-gutter:stable]"
        data-agent-message-scroll=""
      >
        <div
          ref={contentElRef}
          className="ml-[var(--chat-content-left,auto)] mr-auto max-w-[860px] select-none px-10"
        >
          <div className="h-12" aria-hidden="true" />
          {rowsWithTurnSummary.map((row) =>
            row.isSystem ? (
              <AgentMessageRowFrame key={row.stableKey}>
                <SystemMessageRow content={row.msg.content.trim()} />
              </AgentMessageRowFrame>
            ) : (
              <AgentMessageRowFrame key={row.stableKey}>
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
          )}
        </div>
      </div>
    </>
  );
}

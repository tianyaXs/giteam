import { useEffect, useRef, useState, forwardRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { MarkdownLite } from "../common/MarkdownLite";
import { AgentExecutionPartView, type AgentToolFileTarget } from "./AgentExecutionPartView";
import { getAttachmentBadgeLabel, isImageAttachment } from "../../lib/imageAttachments";
import {
  type AgentAssistantRenderGroup,
  buildAgentAssistantRenderGroups,
  buildAgentReplyMarkdownFromParts,
  isAgentRenderablePart,
  readAgentTodosFromPart,
  summarizeAgentContextProgress,
  summarizeAgentContextToolCounts
} from "../../lib/agentParts";
import type {
  AgentChatMessage,
  AgentDetailedMessage,
  AgentDetailedPart,
  AgentTodoItem
} from "../../lib/agentSessions";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { AnimatedCollapsibleContent } from "../ui/animated-collapsible-content";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../../lib/utils";
import { useHighlightKeyword } from "../../lib/highlightKeyword";
import { AlertTriangle } from "lucide-react";

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
  | { kind: "tool-batch"; key: string; batchKind: "shell" | "edit"; parts: AgentDetailedPart[] };

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
  return (
    <span
      className={cn(
        "inline-grid shrink-0 grid-cols-1 grid-rows-1 items-center font-semibold",
        active ? "text-foreground" : "text-muted-foreground",
        className
      )}
    >
      {/* 双层叠字：用较长文案撑宽，当前文案可见，切换时宽度不变 */}
      <span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden>
        {activeLabel.length >= doneLabel.length ? activeLabel : doneLabel}
      </span>
      <span className={cn("col-start-1 row-start-1 whitespace-nowrap", active && "animate-pulse")}>
        {active ? activeLabel : doneLabel}
      </span>
    </span>
  );
}

function ThinkingPlaceholder() {
  // py-2.5(10px) 与 ReasoningGroup 收起态的标签基准对齐（其外层 py-1 + Button py-1.5 = 10px，
  // 组件高 40px）。无 part 占位 → reasoning 到达时 hasTimeline 翻 true，占位换成 ReasoningGroup；
  // 基准对齐后标签 y 与 item 高度都不变，消除「思考内容出现后整行下移」的跳变。
  return (
    <div className="flex w-full items-center justify-start gap-2 py-2.5" aria-live="polite" aria-label="思考中">
      <ActivityStatus active activeLabel="思考中" doneLabel="已思考" className="text-sm" />
    </div>
  );
}

function mergeAdjacentContextGroups(groups: AgentAssistantRenderGroup[]): AgentAssistantRenderGroup[] {
  const merged: AgentAssistantRenderGroup[] = [];
  groups.forEach((group) => {
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

function mergeContextGroup(
  previous: AgentAssistantRenderGroup | null,
  next: AgentAssistantRenderGroup
): AgentAssistantRenderGroup {
  if (previous?.kind !== "context" || next.kind !== "context") return next;
  return {
    kind: "context",
    key: previous.key,
    parts: [...previous.parts, ...next.parts]
  };
}

function mergeContextBoundary(
  previousGroups: AgentAssistantRenderGroup[],
  nextGroups: AgentAssistantRenderGroup[]
): boolean {
  const previousIndex = previousGroups.length - 1;
  if (previousIndex < 0 || nextGroups.length <= 0) return false;
  const previous = previousGroups[previousIndex];
  const next = nextGroups[0];
  if (previous.kind !== "context" || next.kind !== "context") return false;
  previousGroups[previousIndex] = mergeContextGroup(previous, next);
  nextGroups.shift();
  return true;
}

function buildDisplayTimelineGroups(
  groups: AgentAssistantRenderGroup[],
  showReasoningSummaries: boolean
): AgentAssistantRenderGroup[] {
  // 探索(context)按真实时序留在触发它的思考(reasoning)之后：仅合并连续相邻的探索组，
  // 不再把 context 推到 reasoning 之前、也不跨回合合并成一个大组。否则会产生「一个汇总了
  // 数十次调用的大探索组堆在前面、后面跟着一堆思考」的失真布局——探索与思考时序颠倒、
  // 探索计数跨回合累积。
  const out: AgentAssistantRenderGroup[] = [];
  groups.forEach((group) => {
    if (group.kind === "reasoning") {
      if (showReasoningSummaries) out.push(group);
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

function localPathToFileUrl(path: string): string {
  return encodeURI(`file://${path}`);
}

function filenameFromPath(path: string): string {
  return path.replace(/:\d+$/, "").split(/[\\/]/).filter(Boolean).pop() || path;
}

function getToolName(part: AgentDetailedPart): string {
  return String((part as any)?.toolName || "").trim();
}

function getBatchKind(group: AgentAssistantRenderGroup): "shell" | "edit" | "" {
  if (group.kind !== "part") return "";
  const type = String((group.part as any)?.type || "");
  if (type !== "toolCall") return "";
  const tool = getToolName(group.part);
  if (tool === "bash") return "shell";
  if (tool === "write" || tool === "edit" || tool === "hashline_edit" || tool === "apply_patch") return "edit";
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
  let pendingKind: "shell" | "edit" | "" = "";
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
};

type RenderMarkdown = (source: string, streaming?: boolean) => ReactNode;

// Virtuoso List：必须把官方传入的 style（含 paddingTop/height）原样挂上；不要用 flex/gap，
// 也不要用会覆盖 paddingTop 语义的布局类抢测高。行间距放在 Item 内 padding。
// @see https://virtuoso.dev/react-virtuoso/troubleshooting/
const AgentMessageListContainer = forwardRef<HTMLDivElement, { children?: ReactNode; style?: CSSProperties }>(
  ({ children, style, ...rest }, ref) => (
    <div ref={ref} style={style} {...rest} className="mx-auto w-full max-w-[860px] px-10">
      {children}
    </div>
  )
);
AgentMessageListContainer.displayName = "AgentMessageListContainer";

function AgentMessageRowFrame({ children }: { children: ReactNode }) {
  return <div className="pb-4">{children}</div>;
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
      <span className="min-w-0 whitespace-pre-wrap break-words text-xs text-muted-foreground">{content}</span>
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
  onOpenToolFile
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
}) {
  // 末尾组（流式中）一律「运行中/编辑中」：不再随组内单个命令的 running↔done 抖动——
  // 否则前一条 done、下一条未到的空窗帧会闪成「已运行」、下一条到达又变「运行中」。
  const running = !forceInactive;
  const shell = group.batchKind === "shell";
  const noun = shell ? "条命令" : "个文件";
  const label = shell ? (running ? "运行中" : "已运行") : (running ? "编辑中" : "已编辑");

  return (
    <Collapsible className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button className="h-auto w-full min-w-0 justify-start overflow-hidden rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground" variant="ghost">
          <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
            <ActivityStatus active={running} activeLabel={label} doneLabel={label} className="text-sm" />
            <span className="inline-grid shrink-0 grid-cols-1 grid-rows-1 text-xs font-medium text-muted-foreground">
              <span className="invisible col-start-1 row-start-1 tabular-nums" aria-hidden>
                99 {noun}
              </span>
              <span className="col-start-1 row-start-1 tabular-nums">
                {group.parts.length} {noun}
              </span>
            </span>
          </span>
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent open={open}>
        <div className="flex flex-col gap-1 pb-2 pl-3">
          {group.parts.map((part, partIndex) => (
            <AgentExecutionPartView
              key={`${timelineKey}:${String((part as { id?: string }).id || partIndex)}`}
              part={part}
              listItem
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              onOpenTaskSession={onOpenTaskSession}
              onOpenToolFile={onOpenToolFile}
            />
          ))}
        </div>
      </AnimatedCollapsibleContent>
    </Collapsible>
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
    <Collapsible className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button className="h-auto w-full min-w-0 justify-start overflow-hidden rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground" variant="ghost">
          <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
            <ActivityStatus active={active} activeLabel="探索中" doneLabel="已探索" className="text-sm" />
            <span className="inline-grid shrink-0 grid-cols-1 grid-rows-1 text-xs text-muted-foreground">
              {/* 用上限文案撑住计数区宽度，避免 1→2 次 / 增减类型时整行横跳 */}
              <span className="invisible col-start-1 row-start-1 tabular-nums" aria-hidden>
                99次读取，99次搜索，99次列出
              </span>
              <span className="col-start-1 row-start-1 tabular-nums">{summary || "已收集上下文"}</span>
            </span>
            {detail ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">· {detail}</span>
            ) : null}
          </span>
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent open={open}>
        <div className="flex flex-col gap-0.5 pb-1.5 pl-3">
          {group.parts.map((part, partIndex) => (
            <AgentExecutionPartView
              key={`${timelineKey}:${String((part as { id?: string }).id || partIndex)}`}
              part={part}
              listItem
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              onOpenTaskSession={onOpenTaskSession}
              onOpenToolFile={onOpenToolFile}
            />
          ))}
        </div>
      </AnimatedCollapsibleContent>
    </Collapsible>
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
    <Collapsible
      className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1"
      open={open}
      onOpenChange={onOpenChange}
    >
      <CollapsibleTrigger asChild>
        <Button className="h-auto w-full min-w-0 justify-start overflow-hidden rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground" variant="ghost">
          <ActivityStatus active={active} activeLabel="思考中" doneLabel="已思考" className="mr-2 text-sm" />
          {open ? null : (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</span>
          )}
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent open={open}>
        <div className="min-w-0 max-w-full overflow-hidden pb-2 pl-3 text-sm text-muted-foreground">
          <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
            {renderMarkdown(text, active)}
          </div>
        </div>
      </AnimatedCollapsibleContent>
    </Collapsible>
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
    <div className="min-w-0 max-w-full overflow-hidden break-words text-[15px] leading-7 text-foreground [overflow-wrap:anywhere]">
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
  const getGroupParts = (group: AgentDisplayTimelineGroup): AgentDetailedPart[] =>
    group.kind === "part" ? [group.part] : group.parts;
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
    <div className="flex min-w-0 max-w-full flex-col gap-1 overflow-hidden">
      {displayTimelineGroups.map((group, index) => {
        const timelineKey = stableGroupKeys[index];
        const isOpen = timelineOpenState[timelineKey] ?? false;
        const setOpen = (open: boolean) => setTimelineOpenState((prev) => ({ ...prev, [timelineKey]: open }));
        // 非流式、或后方已有更新组（含「曾出现过」的防回退判定）→ 强制已完成态
        const forceInactive = !isStreaming || index !== lastGroupIndex || demotedGroupKeys.has(timelineKey);

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

        if (group.kind !== "part") return null;
        const type = String((group.part as { type?: string }).type || "");
        if (type === "text") {
          const text = String((group.part as { text?: string }).text || "").trim();
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

        return (
          <AgentExecutionPartView
            key={timelineKey}
            part={group.part}
            shellToolPartsExpanded={shellToolPartsExpanded}
            editToolPartsExpanded={editToolPartsExpanded}
            onOpenTaskSession={onOpenTaskSession}
            onOpenToolFile={onOpenToolFile}
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
    <Collapsible className="grid gap-2" open={open} onOpenChange={onOpenChange}>
      {open ? null : (
        <div className="min-w-0 text-sm leading-relaxed">
          {renderMarkdown(collapsePreview(text))}
        </div>
      )}
      <CollapsibleContent className="min-w-0 text-sm leading-relaxed">
        {renderMarkdown(text)}
      </CollapsibleContent>
      <CollapsibleTrigger asChild>
        <Button className="h-7 w-fit px-2 text-xs" size="sm" variant="ghost" aria-controls={`message-${messageId}`}>
          {open ? "收起" : "展开全文"}
        </Button>
      </CollapsibleTrigger>
    </Collapsible>
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
  const hasAttachments = attachments.length > 0;
  const hasContent = Boolean(msg.content.trim());
  if (!hasContent && attachments.length === 0) return null;

  return (
    <div className={cn("grid min-w-0 gap-2", hasAttachments && "justify-items-end")}>
      <MessageAttachments
        attachments={attachments}
        className={hasAttachments ? "justify-self-end" : undefined}
        onPreviewImageGroup={onPreviewImageGroup}
        onCopyAttachmentUri={onCopyAttachmentUri}
        onOpenAttachment={onOpenAttachment}
      />
      {hasContent ? (
        hasAttachments ? (
          <div className="w-fit max-w-full rounded-2xl bg-muted px-3.5 py-2 text-[15px] font-medium leading-6 text-foreground">
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
        ) : shouldCollapseMessage(msg.content) ? (
            <CollapsibleUserText
              messageId={msg.id}
              text={msg.content}
              open={messageOpenState[msg.id] ?? false}
              onOpenChange={(open) => {
                setMessageOpenState((prev) => ({ ...prev, [msg.id]: open }));
              }}
              renderMarkdown={renderMarkdown}
            />
          ) : renderMarkdown(msg.content)
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
  renderMarkdown: RenderMarkdown;
}) {
  const {
    stableKey,
    isStreaming,
    timelineGroups,
    hasTimeline,
    fallbackReply,
    detailsError,
    errorMessage
  } = row;

  return (
    <div className="grid min-w-0 gap-2">
      {hasTimeline ? (
        <AssistantTimeline
          stableKey={stableKey}
          isStreaming={isStreaming}
          timelineGroups={timelineGroups}
          timelineOpenState={timelineOpenState}
          setTimelineOpenState={setTimelineOpenState}
          showReasoningSummaries={showReasoningSummaries}
          shellToolPartsExpanded={shellToolPartsExpanded}
          editToolPartsExpanded={editToolPartsExpanded}
          onOpenTaskSession={onOpenTaskSession}
          onOpenToolFile={onOpenToolFile}
          renderMarkdown={renderMarkdown}
        />
      ) : fallbackReply ? (
        <AssistantTextBlock text={fallbackReply} streaming={isStreaming} renderMarkdown={renderMarkdown} />
      ) : isStreaming ? (
        <ThinkingPlaceholder />
      ) : null}
      {detailsError ? (
        <div className="mt-1 text-xs text-destructive">
          {detailsError}
        </div>
      ) : null}
      {errorMessage ? <AgentErrorMessage message={errorMessage} /> : null}
    </div>
  );
}

function AgentErrorMessage({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="relative overflow-hidden rounded-xl border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-sm text-foreground shadow-[0_8px_24px_color-mix(in_srgb,var(--danger)_8%,transparent)]"
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-destructive/70" aria-hidden="true" />
      <div className="flex min-w-0 items-start gap-2.5 pl-1">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive" aria-hidden="true">
          <AlertTriangle className="size-3.5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-5 text-destructive">运行失败</div>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-foreground/80">{message}</p>
        </div>
      </div>
    </div>
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
    <div className={cn("grid min-w-0 gap-2", className)}>
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
              <img className="size-full rounded-[14px] border border-border/35 bg-background object-contain" src={attachment.uri} alt={attachment.filename || "图片附件"} loading="lazy" />
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
  highlightKeyword
}: AgentMessageStreamProps) {
  const [timelineOpenState, setTimelineOpenState] = useState<Record<string, boolean>>({});
  const [messageOpenState, setMessageOpenState] = useState<Record<string, boolean>>({});
  const [highlightMessageId, setHighlightMessageId] = useState("");
  /** 本会话已完成过搜索定位：禁止随后的「滚到底唤醒」抢走视口，也避免清掉关键词高亮。 */
  const locatedThisSessionRef = useRef(false);
  /**
   * 定位成功后 sticky mount key，避免 pending 清空时 key 回退导致二次 remount（抖动）。
   * @see https://virtuoso.dev/react-virtuoso/virtuoso/initial-index/
   */
  const locateStickyMountKeyRef = useRef<string | null>(null);
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
    const serverMid = (serverMessageIdByLocalId[msg.id] || "").trim();
    const detail = isAssistant ? (detailsByMessageId[msg.id] || null) : null;
    const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as AgentDetailedPart[]) : [];
    const liveParts = serverMid ? (livePartsByServerMessageId[serverMid] || []) : [];
    const detailParts = (liveParts.length > 0 ? liveParts : fetchedParts).map((part) => {
      // 兼容旧 bug：reasoning 流曾被误标成 text，导致思考正文与「思考中」标签分离
      const id = String((part as { id?: string }).id || "").trim();
      const type = String((part as { type?: string }).type || "");
      if (type === "text" && (id === "reasoning" || id.startsWith("reasoning:"))) {
        return { ...(part as object), type: "reasoning" } as AgentDetailedPart;
      }
      return part;
    });
    const renderParts = detailParts.filter(isAgentRenderablePart);
    const errorMessage = isAssistant ? runFailureText(msg) : "";
    const todoItems = [...detailParts].reverse().map(readAgentTodosFromPart).find((todos) => todos.length > 0) || [];
    const timelineGroups = buildDisplayTimelineGroups(
      buildAgentAssistantRenderGroups(renderParts),
      showReasoningSummaries
    );
    const fallbackReply = errorMessage ? "" : (buildAgentReplyMarkdownFromParts(detailParts) || msg.content || "").trim();
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
    if (row.isAssistant && last?.isAssistant) {
      if (isEmptyAssistantPlaceholder(last)) {
        row.isStreaming = last.isStreaming || row.isStreaming;
        row.liveParts = [...last.liveParts, ...row.liveParts];
        row.renderParts = [...last.renderParts, ...row.renderParts];
        row.detailsLoading = last.detailsLoading || row.detailsLoading;
        row.todoItems = row.todoItems.length > 0 ? row.todoItems : last.todoItems;
        row.stableKey = last.stableKey;
        row.msg = { ...row.msg, id: `${last.msg.id}:${row.msg.id}` };
        out[out.length - 1] = row;
        return out;
      }
      const lastTimelineOnly = last.hasTimeline && !last.fallbackReply;
      const rowTimelineOnly = row.hasTimeline && !row.fallbackReply;
      const mergedBoundary = mergeContextBoundary(last.timelineGroups, row.timelineGroups);
      if (mergedBoundary) {
        last.timelineGroups = mergeAdjacentContextGroups(last.timelineGroups);
        row.timelineGroups = mergeAdjacentContextGroups(row.timelineGroups);
        last.hasTimeline = last.timelineGroups.length > 0;
        row.hasTimeline = row.timelineGroups.length > 0;
      }
      if (isEmptyAssistantPlaceholder(row)) {
        last.isStreaming = last.isStreaming || row.isStreaming;
        last.liveParts = [...last.liveParts, ...row.liveParts];
        last.renderParts = [...last.renderParts, ...row.renderParts];
        if (row.todoItems.length > 0) last.todoItems = row.todoItems;
        last.msg = { ...last.msg, id: `${last.msg.id}:${row.msg.id}` };
        return out;
      }
      if (lastTimelineOnly && rowTimelineOnly && !last.detailsError && !row.detailsError && !last.errorMessage && !row.errorMessage) {
        last.timelineGroups = mergeAdjacentContextGroups([
          ...last.timelineGroups,
          ...row.timelineGroups
        ]);
        last.hasTimeline = last.timelineGroups.length > 0;
        last.isStreaming = last.isStreaming || row.isStreaming;
        last.liveParts = [...last.liveParts, ...row.liveParts];
        last.renderParts = [...last.renderParts, ...row.renderParts];
        last.detailsLoading = last.detailsLoading || row.detailsLoading;
        if (row.todoItems.length > 0) last.todoItems = row.todoItems;
        last.msg = { ...last.msg, id: `${last.msg.id}:${row.msg.id}` };
        return out;
      }
    }
    if (row.contextOnly && last?.contextOnly) {
      last.timelineGroups = mergeAdjacentContextGroups([
        ...last.timelineGroups,
        ...row.timelineGroups
      ]);
      last.hasTimeline = last.timelineGroups.length > 0;
      last.isStreaming = last.isStreaming || row.isStreaming;
      last.liveParts = [...last.liveParts, ...row.liveParts];
      last.renderParts = [...last.renderParts, ...row.renderParts];
      last.detailsLoading = last.detailsLoading || row.detailsLoading;
      last.detailsError = last.detailsError || row.detailsError;
      if (row.todoItems.length > 0) last.todoItems = row.todoItems;
      last.msg = { ...last.msg, id: `${last.msg.id}:${row.msg.id}` };
      return out;
    }
    out.push(row);
    return out;
  }, []);
  const visibleRenderRows = mergedRenderRows.filter((row) => {
    if (!isEmptyAssistantPlaceholder(row)) return true;
    // 仅当前流式等待首包时保留空占位；loading/历史空行一律丢掉，避免多余「思考中」
    return row.isStreaming;
  });

  const pendingLocateId = pendingScrollMessageId?.trim() || "";
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

  // remount 后：initialTopMostItemIndex 已锚定命中行。仅当关键词完全在视口外时 scrollBy 一次；
  // 已可见则不动，避免「定位后再抖一下」。
  useEffect(() => {
    if (!pendingLocateId || sessionLoading) return;
    if (pendingLocateIndex < 0) return;
    if (!virtuosoMountKey.includes(":locate:")) return;

    let cancelled = false;
    let finished = false;
    const timers: number[] = [];

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

    const ensureKeywordVisibleOnce = (): boolean => {
      const root = document.querySelector<HTMLElement>(`[data-locate-hit="1"]`);
      if (!root) return false;
      const target = findKeywordEl(root);
      if (!target) return false;
      const scroller =
        root.closest<HTMLElement>("[data-virtuoso-scroller]") ||
        root.closest<HTMLElement>(".overflow-auto");
      if (!scroller) return false;
      const markRect = target.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const fullyVisible =
        markRect.top >= scrollerRect.top + 8 && markRect.bottom <= scrollerRect.bottom - 8;
      if (fullyVisible) return true;
      const delta =
        markRect.top + markRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
      if (Math.abs(delta) >= 16) {
        virtuosoRef.current?.scrollBy({ top: delta, behavior: "auto" });
      }
      return true;
    };

    let doneScroll = false;
    const delays = [80, 240, 480];
    delays.forEach((delay, i) => {
      timers.push(
        window.setTimeout(() => {
          if (cancelled || finished) return;
          if (!doneScroll) doneScroll = ensureKeywordVisibleOnce();
          if (doneScroll || i === delays.length - 1) finish();
        }, delay)
      );
    });

    return () => {
      cancelled = true;
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
  useEffect(() => {
    if (sessionLoading || visibleRenderRows.length === 0) return;
    if (pendingLocateId || locatedThisSessionRef.current) return;
    const wake = () => {
      virtuosoRef.current?.scrollToIndex({
        index: visibleRenderRows.length - 1,
        align: "end",
        behavior: "auto"
      });
    };
    wake();
    const raf = requestAnimationFrame(wake);
    const timer = window.setTimeout(wake, 64);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, sessionLoading, visibleRenderRows.length]);

  if (sessionLoading) {
    return (
      <div className="mx-auto w-full max-w-[860px] px-10 pt-4">
        <StreamLoadingState />
      </div>
    );
  }
  if (messages.length === 0) return null;

  return (
    <Virtuoso
      key={virtuosoMountKey}
      ref={virtuosoRef}
      data={visibleRenderRows}
      computeItemKey={(_index, row) => row.stableKey}
      scrollerRef={scrollerRef}
      className="h-full min-h-0 overflow-auto [scrollbar-gutter:stable]"
      initialTopMostItemIndex={
        initialLocateIndex >= 0
          ? { index: initialLocateIndex, align: "start" }
          : { index: "LAST", align: "end" }
      }
      followOutput={(atBottom) =>
        atBottom && !pendingLocateId && !locatedThisSessionRef.current ? "auto" : false
      }
      atBottomThreshold={48}
      atBottomStateChange={onAtBottomChange}
      startReached={onStartReached}
      rangeChanged={onRangeChanged}
      increaseViewportBy={{ top: 600, bottom: 600 }}
      defaultItemHeight={160}
      components={{ List: AgentMessageListContainer }}
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
  );
}

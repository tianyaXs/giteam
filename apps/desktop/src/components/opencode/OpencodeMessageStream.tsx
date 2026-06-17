import { useEffect, useState, type ReactNode } from "react";
import { MarkdownLite } from "../common/MarkdownLite";
import { OpencodeExecutionPartView, type OpencodeToolFileTarget } from "./OpencodeExecutionPartView";
import { isImageAttachment } from "../../lib/imageAttachments";
import {
  type OpencodeAssistantRenderGroup,
  buildOpencodeAssistantRenderGroups,
  buildOpencodeReplyMarkdownFromParts,
  isOpencodeRenderablePart,
  summarizeOpencodeContextProgress,
  summarizeOpencodeContextToolCounts
} from "../../lib/opencodeParts";
import type {
  OpencodeChatMessage,
  OpencodeDetailedMessage,
  OpencodeDetailedPart
} from "../../lib/opencodeSessions";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../../lib/utils";

type OpencodePreviewImage = {
  uri: string;
  filename?: string;
};

type OpencodeMessageAttachment = NonNullable<OpencodeChatMessage["attachments"]>[number];

type OpencodeMessageRenderRow = {
  msg: OpencodeChatMessage;
  isAssistant: boolean;
  isStreaming: boolean;
  liveParts: OpencodeDetailedPart[];
  renderParts: OpencodeDetailedPart[];
  timelineGroups: OpencodeAssistantRenderGroup[];
  hasTimeline: boolean;
  fallbackReply: string;
  detailsLoading: boolean;
  detailsError: string;
  contextOnly: boolean;
};

const COLLAPSE_LINE_LIMIT = 8;
const COLLAPSE_CHAR_LIMIT = 420;

type OpencodeDisplayTimelineGroup =
  | OpencodeAssistantRenderGroup
  | { kind: "tool-batch"; key: string; batchKind: "shell" | "edit"; parts: OpencodeDetailedPart[] };

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

function mergeAdjacentContextGroups(groups: OpencodeAssistantRenderGroup[]): OpencodeAssistantRenderGroup[] {
  const merged: OpencodeAssistantRenderGroup[] = [];
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
  previous: OpencodeAssistantRenderGroup | null,
  next: OpencodeAssistantRenderGroup
): OpencodeAssistantRenderGroup {
  if (previous?.kind !== "context" || next.kind !== "context") return next;
  return {
    kind: "context",
    key: previous.key,
    parts: [...previous.parts, ...next.parts]
  };
}

function mergeContextBoundary(
  previousGroups: OpencodeAssistantRenderGroup[],
  nextGroups: OpencodeAssistantRenderGroup[]
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
  groups: OpencodeAssistantRenderGroup[],
  showReasoningSummaries: boolean
): OpencodeAssistantRenderGroup[] {
  const out: OpencodeAssistantRenderGroup[] = [];
  let pendingContext: OpencodeAssistantRenderGroup | null = null;

  const flushContext = () => {
    if (!pendingContext) return;
    out.push(pendingContext);
    pendingContext = null;
  };

  groups.forEach((group) => {
    if (group.kind === "reasoning") {
      if (showReasoningSummaries) {
        flushContext();
        out.push(group);
      }
      return;
    }
    if (group.kind === "context") {
      pendingContext = mergeContextGroup(pendingContext, group);
      return;
    }
    flushContext();
    out.push(group);
  });
  flushContext();
  return mergeAdjacentContextGroups(out);
}

function shouldCollapseMessage(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  const lineCount = normalized.split(/\r?\n/).length;
  return lineCount > COLLAPSE_LINE_LIMIT || normalized.length > COLLAPSE_CHAR_LIMIT;
}

function isMessageImageAttachment(attachment: OpencodeMessageAttachment): boolean {
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

function getToolName(part: OpencodeDetailedPart): string {
  return String((part as any)?.tool || "").trim();
}

function isRunningToolPart(part: OpencodeDetailedPart): boolean {
  const status = String((part as any)?.state?.status || "").trim().toLowerCase();
  return status === "running" || status === "pending";
}

function getBatchKind(group: OpencodeAssistantRenderGroup): "shell" | "edit" | "" {
  if (group.kind !== "part") return "";
  const type = String((group.part as any)?.type || "");
  if (type !== "tool") return "";
  const tool = getToolName(group.part);
  if (tool === "bash") return "shell";
  if (tool === "write" || tool === "edit" || tool === "apply_patch") return "edit";
  return "";
}

function isEmptyAssistantPlaceholder(row: OpencodeMessageRenderRow): boolean {
  return row.isAssistant && !row.hasTimeline && !row.fallbackReply && !row.detailsLoading && !row.detailsError;
}

function buildBatchedTimelineGroups(groups: OpencodeAssistantRenderGroup[]): OpencodeDisplayTimelineGroup[] {
  const out: OpencodeDisplayTimelineGroup[] = [];
  let pendingKind: "shell" | "edit" | "" = "";
  let pending: OpencodeAssistantRenderGroup[] = [];

  const flush = () => {
    if (!pending.length) return;
    if (pendingKind && (pendingKind === "shell" || pending.length > 1)) {
      out.push({
        kind: "tool-batch",
        key: pending[0]?.key || `${pendingKind}-batch`,
        batchKind: pendingKind,
        parts: pending
          .filter((group): group is Extract<OpencodeAssistantRenderGroup, { kind: "part" }> => group.kind === "part")
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

type OpencodeMessageStreamProps = {
  sessionLoading: boolean;
  messages: OpencodeChatMessage[];
  renderedMessages: OpencodeChatMessage[];
  activeStreamingAssistantId: string;
  activeSessionBusy: boolean;
  serverMessageIdByLocalId: Record<string, string>;
  detailsByMessageId: Record<string, OpencodeDetailedMessage | null>;
  livePartsByServerMessageId: Record<string, OpencodeDetailedPart[]>;
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
  onOpenToolFile: (target: OpencodeToolFileTarget) => void;
  onPreviewImageGroup: (images: OpencodePreviewImage[], index: number) => void;
  onCopyAttachmentUri: (uri: string) => void;
  onOpenAttachment: (uri: string, filename?: string, mime?: string) => void;
};

type RenderMarkdown = (source: string, streaming?: boolean) => ReactNode;

function StreamLoadingState() {
  return (
    <div className="flex flex-col gap-2 px-1 py-2 text-sm text-muted-foreground">
      <span>加载会话中…</span>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

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
    <span className={cn("inline-flex items-center gap-2 font-semibold", active ? "text-foreground" : "text-muted-foreground", className)}>
      <span className={cn(active && "animate-pulse")}>{active ? activeLabel : doneLabel}</span>
    </span>
  );
}

function ThinkingPlaceholder() {
  return (
    <div className="flex w-full items-center gap-2 py-1.5" aria-live="polite" aria-label="思考中">
      <ActivityStatus active activeLabel="思考中" doneLabel="已思考" className="text-sm" />
    </div>
  );
}

function MessageShell({
  isAssistant,
  children
}: {
  isAssistant: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex w-full min-w-0 overflow-hidden", isAssistant ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "min-w-0 max-w-full",
          isAssistant
            ? "w-full"
            : "max-w-[min(74%,620px)] rounded-[20px] bg-muted px-4 py-3 text-sm font-medium leading-relaxed text-foreground"
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
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile
}: {
  timelineKey: string;
  group: Extract<OpencodeDisplayTimelineGroup, { kind: "tool-batch" }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: OpencodeToolFileTarget) => void;
}) {
  const running = group.parts.some(isRunningToolPart);
  const shell = group.batchKind === "shell";
  const noun = shell ? "条命令" : "个文件";
  const label = shell ? (running ? "运行中" : "已运行") : (running ? "编辑中" : "已编辑");

  return (
    <Collapsible className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button className="h-auto w-full min-w-0 justify-between overflow-hidden rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground" variant="ghost">
          <span className="flex min-w-0 items-center gap-2 overflow-hidden">
            <ActivityStatus active={running} activeLabel={label} doneLabel={label} className="shrink-0 text-sm" />
            <span className="text-xs font-medium text-muted-foreground">{group.parts.length} {noun}</span>
          </span>
          <span className={cn("text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true">›</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pb-2 pl-3">
        {group.parts.map((part, partIndex) => (
          <OpencodeExecutionPartView
            key={`${timelineKey}:${part.id || partIndex}`}
            part={part}
            shellToolPartsExpanded={shellToolPartsExpanded}
            editToolPartsExpanded={editToolPartsExpanded}
            onOpenTaskSession={onOpenTaskSession}
            onOpenToolFile={onOpenToolFile}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ContextGroup({
  timelineKey,
  group,
  streaming,
  open,
  onOpenChange,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile
}: {
  timelineKey: string;
  group: Extract<OpencodeAssistantRenderGroup, { kind: "context" }>;
  streaming: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: OpencodeToolFileTarget) => void;
}) {
  const counts = summarizeOpencodeContextToolCounts(group.parts);
  const progress = summarizeOpencodeContextProgress(group.parts);
  const summary = summarizeContextCounts(counts) || "已收集上下文";
  const active = streaming || progress.active;

  return (
    <Collapsible className="grid min-w-0 gap-1 py-1" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button className="h-auto w-full justify-between rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground" variant="ghost">
          <span className="flex min-w-0 items-center gap-2">
            <ActivityStatus active={active} activeLabel="探索中" doneLabel="已探索" className="text-sm" />
            <span className="truncate text-xs text-muted-foreground">
              {progress.detail ? `${summary} · ${progress.detail}` : summary}
            </span>
          </span>
          <span className={cn("text-muted-foreground transition-transform", open && "rotate-90")} aria-hidden="true">›</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pb-2 pl-3">
        {group.parts.map((part, partIndex) => (
          <OpencodeExecutionPartView
            key={`${timelineKey}:${partIndex}`}
            part={part}
            shellToolPartsExpanded={shellToolPartsExpanded}
            editToolPartsExpanded={editToolPartsExpanded}
            onOpenTaskSession={onOpenTaskSession}
            onOpenToolFile={onOpenToolFile}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReasoningGroup({
  timelineKey,
  group,
  active,
  open,
  onOpenChange,
  renderMarkdown
}: {
  timelineKey: string;
  group: Extract<OpencodeAssistantRenderGroup, { kind: "reasoning" }>;
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

  return (
    <Collapsible className="grid min-w-0 max-w-full gap-1 overflow-hidden py-1" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button className="h-auto w-full min-w-0 overflow-hidden rounded-md px-0 py-1.5 text-left hover:bg-transparent hover:text-foreground" variant="ghost">
          <ActivityStatus active={active} activeLabel="思考中" doneLabel="已思考" className="mr-2 shrink-0 text-sm" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 max-w-full overflow-hidden pb-2 pl-3 text-sm">
        <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
          {renderMarkdown(text, active)}
        </div>
      </CollapsibleContent>
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
    <div className="min-w-0 max-w-full overflow-hidden break-words text-sm leading-7 text-foreground [overflow-wrap:anywhere]">
      {renderMarkdown(text, streaming)}
    </div>
  );
}

function AssistantTimeline({
  msg,
  isStreaming,
  renderParts,
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
  msg: OpencodeChatMessage;
  isStreaming: boolean;
  renderParts: OpencodeDetailedPart[];
  timelineGroups: OpencodeAssistantRenderGroup[];
  timelineOpenState: Record<string, boolean>;
  setTimelineOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  showReasoningSummaries: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: OpencodeToolFileTarget) => void;
  renderMarkdown: RenderMarkdown;
}) {
  const activeReasoningPartId = isStreaming
    ? [...renderParts]
      .reverse()
      .find((part) => String((part as { type?: string }).type || "") === "reasoning")?.id || ""
    : "";
  const displayTimelineGroups = buildBatchedTimelineGroups(timelineGroups);

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1 overflow-hidden">
      {displayTimelineGroups.map((group, index) => {
        const timelineKey = `${msg.id}:${group.key}`;
        const isOpen = timelineOpenState[timelineKey] ?? false;
        const setOpen = (open: boolean) => setTimelineOpenState((prev) => ({ ...prev, [timelineKey]: open }));

        if (group.kind === "tool-batch") {
          return (
            <ToolBatchGroup
              key={timelineKey}
              timelineKey={timelineKey}
              group={group}
              open={isOpen}
              onOpenChange={setOpen}
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
              streaming={isStreaming}
              open={isOpen}
              onOpenChange={setOpen}
              shellToolPartsExpanded={shellToolPartsExpanded}
              editToolPartsExpanded={editToolPartsExpanded}
              onOpenTaskSession={onOpenTaskSession}
              onOpenToolFile={onOpenToolFile}
            />
          );
        }

        if (group.kind === "reasoning") {
          if (!showReasoningSummaries) return null;
          const active = isStreaming && group.parts.some((part) => String(part.id || "") === activeReasoningPartId);
          return (
            <ReasoningGroup
              key={timelineKey}
              timelineKey={timelineKey}
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
          <OpencodeExecutionPartView
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
  msg: OpencodeChatMessage;
  messageOpenState: Record<string, boolean>;
  setMessageOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  renderMarkdown: RenderMarkdown;
  onPreviewImageGroup: (images: OpencodePreviewImage[], index: number) => void;
  onCopyAttachmentUri: (uri: string) => void;
  onOpenAttachment: (uri: string, filename?: string, mime?: string) => void;
}) {
  const attachments = msg.attachments || [];
  const hasContent = Boolean(msg.content.trim());
  if (!hasContent && attachments.length === 0) return null;

  return (
    <div className="grid min-w-0 gap-2">
      <MessageAttachments
        attachments={attachments}
        onPreviewImageGroup={onPreviewImageGroup}
        onCopyAttachmentUri={onCopyAttachmentUri}
        onOpenAttachment={onOpenAttachment}
      />
      {hasContent ? (
        shouldCollapseMessage(msg.content) ? (
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
  row: OpencodeMessageRenderRow;
  timelineOpenState: Record<string, boolean>;
  setTimelineOpenState: (value: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  showReasoningSummaries: boolean;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: OpencodeToolFileTarget) => void;
  renderMarkdown: RenderMarkdown;
}) {
  const {
    msg,
    isStreaming,
    renderParts,
    timelineGroups,
    hasTimeline,
    fallbackReply,
    detailsError
  } = row;

  return (
    <div className="grid min-w-0 gap-2">
      {hasTimeline ? (
        <AssistantTimeline
          msg={msg}
          isStreaming={isStreaming}
          renderParts={renderParts}
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
      ) : (
        <ThinkingPlaceholder />
      )}
      {detailsError ? (
        <div className="mt-1 text-xs text-destructive">
          {detailsError}
        </div>
      ) : null}
    </div>
  );
}

function MessageAttachments({
  attachments,
  onPreviewImageGroup,
  onCopyAttachmentUri,
  onOpenAttachment
}: {
  attachments: OpencodeMessageAttachment[];
  onPreviewImageGroup: (images: OpencodePreviewImage[], index: number) => void;
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

  return (
    <div className="grid min-w-0 gap-2">
      {imageAttachments.length > 0 ? (
        <div className="grid max-w-[292px] grid-cols-[repeat(auto-fit,minmax(86px,1fr))] gap-2" aria-label="图片附件">
          {imageAttachments.map((attachment) => (
            <Button
              key={attachment.id}
              className="aspect-square h-auto min-h-0 w-full overflow-hidden rounded-xl border border-border/50 bg-background p-0 hover:bg-background"
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
              <img className="size-full object-cover" src={attachment.uri} alt={attachment.filename || "图片附件"} loading="lazy" />
            </Button>
          ))}
        </div>
      ) : null}
      {fileAttachments.length > 0 ? (
        <div className="grid min-w-[min(220px,100%)] gap-1.5" aria-label="文件附件">
          {fileAttachments.map((attachment) => (
            <Button
              key={attachment.id}
              className="h-auto min-h-8 w-full justify-start rounded-lg border border-border/45 bg-background/60 px-2.5 py-1.5 text-left text-xs text-foreground/80 hover:bg-background"
              onClick={() => onOpenAttachment(attachment.uri, attachment.filename, attachment.mime)}
              onContextMenu={(event) => {
                event.preventDefault();
                onCopyAttachmentUri(attachment.uri);
              }}
              title={attachment.filename || attachment.mime || "附件"}
              variant="ghost"
            >
              <span className="min-w-0 truncate">{attachment.filename || "attachment"}</span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OpencodeMessageStream({
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
  onOpenAttachment
}: OpencodeMessageStreamProps) {
  const [timelineOpenState, setTimelineOpenState] = useState<Record<string, boolean>>({});
  const [messageOpenState, setMessageOpenState] = useState<Record<string, boolean>>({});
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
  const renderRows: OpencodeMessageRenderRow[] = renderedMessages.map((msg) => {
    const isAssistant = msg.role === "assistant";
    const isStreaming = isAssistant && msg.id === activeStreamingAssistantId && msg.id === latestAssistantId && activeSessionBusy;
    const serverMid = (serverMessageIdByLocalId[msg.id] || "").trim();
    const detail = isAssistant ? (detailsByMessageId[msg.id] || null) : null;
    const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as OpencodeDetailedPart[]) : [];
    const liveParts = serverMid ? (livePartsByServerMessageId[serverMid] || []) : [];
    const detailParts = liveParts.length > 0 ? liveParts : fetchedParts;
    const renderParts = detailParts.filter(isOpencodeRenderablePart);
    const timelineGroups = buildDisplayTimelineGroups(
      buildOpencodeAssistantRenderGroups(renderParts),
      showReasoningSummaries
    );
    const fallbackReply = (buildOpencodeReplyMarkdownFromParts(detailParts) || msg.content || "").trim();
    return {
      msg,
      isAssistant,
      isStreaming,
      liveParts,
      renderParts,
      timelineGroups,
      hasTimeline: timelineGroups.length > 0,
      fallbackReply,
      detailsLoading: detailsLoadingByMessageId[msg.id],
      detailsError: detailsErrorByMessageId[msg.id] || "",
      contextOnly: isAssistant && timelineGroups.length > 0 && timelineGroups.every((group) => group.kind === "context") && !fallbackReply
    };
  });
  const mergedRenderRows = renderRows.reduce<OpencodeMessageRenderRow[]>((out, row) => {
    const last = out[out.length - 1];
    if (row.isAssistant && last?.isAssistant) {
      if (isEmptyAssistantPlaceholder(last)) {
        row.isStreaming = last.isStreaming || row.isStreaming;
        row.liveParts = [...last.liveParts, ...row.liveParts];
        row.renderParts = [...last.renderParts, ...row.renderParts];
        row.detailsLoading = last.detailsLoading || row.detailsLoading;
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
        last.msg = { ...last.msg, id: `${last.msg.id}:${row.msg.id}` };
        return out;
      }
      if (lastTimelineOnly && rowTimelineOnly && !last.detailsError && !row.detailsError) {
        last.timelineGroups = mergeAdjacentContextGroups([...last.timelineGroups, ...row.timelineGroups]);
        last.hasTimeline = last.timelineGroups.length > 0;
        last.isStreaming = last.isStreaming || row.isStreaming;
        last.liveParts = [...last.liveParts, ...row.liveParts];
        last.renderParts = [...last.renderParts, ...row.renderParts];
        last.detailsLoading = last.detailsLoading || row.detailsLoading;
        last.msg = { ...last.msg, id: `${last.msg.id}:${row.msg.id}` };
        return out;
      }
    }
    if (row.contextOnly && last?.contextOnly) {
      last.timelineGroups = mergeAdjacentContextGroups([...last.timelineGroups, ...row.timelineGroups]);
      last.hasTimeline = last.timelineGroups.length > 0;
      last.isStreaming = last.isStreaming || row.isStreaming;
      last.liveParts = [...last.liveParts, ...row.liveParts];
      last.renderParts = [...last.renderParts, ...row.renderParts];
      last.detailsLoading = last.detailsLoading || row.detailsLoading;
      last.detailsError = last.detailsError || row.detailsError;
      last.msg = { ...last.msg, id: `${last.msg.id}:${row.msg.id}` };
      return out;
    }
    out.push(row);
    return out;
  }, []);
  const visibleRenderRows = mergedRenderRows.filter((row) => !isEmptyAssistantPlaceholder(row) || row.isStreaming);



  return (
    <div className="flex w-full flex-col gap-4">
      {sessionLoading ? (
        <StreamLoadingState />
      ) : messages.length === 0 ? null : (
        visibleRenderRows.map((row) => (
          <MessageShell key={row.msg.id} isAssistant={row.isAssistant}>
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
        ))
      )}
    </div>
  );
}

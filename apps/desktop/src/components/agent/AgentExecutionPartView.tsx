import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toDisplayJson } from "../../lib/agentParts";
import type { AgentDetailedPart } from "../../lib/agentSessions";
import {
  compactPath,
  getToolResultPreview,
  isContextTool,
  parseUnifiedDiff,
  redactSecrets,
  toolDisplayName,
  toolHeadlineTarget,
  toolMode,
  truncateRichText,
  type ToolResultPreview,
  type UnifiedDiffDisplayLine,
} from "../../lib/agent/toolPresentation";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Collapsible, CollapsibleTrigger } from "../ui/collapsible";
import { AnimatedCollapsibleContent } from "../ui/animated-collapsible-content";
import { Separator } from "../ui/separator";
import { cn } from "../../lib/utils";
import { FilePen, Folder, Globe, MessageCircleQuestionMark, MousePointerClick, Search, Terminal, Wrench, type LucideIcon } from "lucide-react";

export type AgentToolFileTarget = {
  filePath: string;
  line?: number;
  focusText?: string;
  original?: string;
  modified?: string;
  patch?: string;
  preferDiff?: boolean;
};

type AgentExecutionPartViewProps = {
  part: AgentDetailedPart;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  /** 位于「已运行 / 已探索」批组列表内：只显示一行摘要，点击后才展开详情 */
  listItem?: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: AgentToolFileTarget) => void;
  onOpenBrowserUrl?: (url: string) => void;
};

const INLINE_PREVIEW_MAX_LINES = 28;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toolKindIcon(tool: string): LucideIcon {
  if (tool === "bash" || tool === "bash_output" || tool === "kill_shell") return Terminal;
  if (tool === "read" || tool === "grep" || tool === "find") return Search;
  if (tool === "write" || tool === "edit" || tool === "hashline_edit" || tool === "apply_patch") return FilePen;
  if (tool === "web_fetch" || tool === "web_search") return Globe;
  if (tool === "browser_use") return MousePointerClick;
  if (tool === "ls") return Folder;
  if (tool === "question") return MessageCircleQuestionMark;
  return Wrench;
}

/** 详情内容框：独立态用 Card；嵌在事件卡片内时用轻量边框块。 */
function ToolEditorFrame({
  filePath,
  additions,
  deletions,
  embedded = false,
  tone = "default",
  children
}: {
  filePath?: string;
  additions?: number;
  deletions?: number;
  embedded?: boolean;
  tone?: "default" | "error";
  children: ReactNode;
}) {
  const hasHeader = Boolean(filePath || additions !== undefined || deletions !== undefined);
  const body = (
    <>
      {hasHeader ? (
        <div className="flex h-9 min-w-0 items-center gap-2 border-b border-border px-4">
          {filePath ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-foreground" title={filePath}>
              {filePath}
            </span>
          ) : <span className="min-w-0 flex-1" />}
          {additions !== undefined || deletions !== undefined ? (
            <span className="shrink-0 font-mono text-[11px]">
              {additions !== undefined ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{additions}</span> : null}
              {additions !== undefined && deletions !== undefined ? <span className="text-muted-foreground"> </span> : null}
              {deletions !== undefined ? <span className="font-semibold text-rose-600 dark:text-rose-400">-{deletions}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
    </>
  );

  if (embedded) {
    // 嵌入外层事件卡片时不做二次底色/圆角，避免标题与内容相接处出现内圆角空隙
    return <div className="w-full min-w-0 overflow-hidden">{body}</div>;
  }

  return (
    <Card
      className={cn(
        "w-full min-w-0 overflow-hidden shadow-none",
        tone === "error" && "border-destructive/30 bg-destructive/5"
      )}
    >
      {body}
    </Card>
  );
}

function ToolScrollBody({ children, className }: { children: ReactNode; className?: string }) {
  // 不用 ScrollArea：其 viewport 会 inherit 外层圆角，在标题下方顶角留出空隙
  return (
    <div className={cn("max-h-[360px] select-text overflow-auto", className)}>
      {children}
    </div>
  );
}

function ToolSourceBlock({
  value,
  filePath,
  embedded = false,
  languageHint
}: {
  value: string;
  filePath?: string;
  embedded?: boolean;
  languageHint?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!value.trim()) return null;
  const allLines = value.split(/\r?\n/);
  const lines = showAll ? allLines : allLines.slice(0, INLINE_PREVIEW_MAX_LINES);
  const remaining = allLines.length - lines.length;

  return (
    <ToolEditorFrame filePath={filePath} embedded={embedded}>
      <ToolScrollBody>
        <pre
          className="px-3 pb-2.5 pt-0 font-mono text-[11.5px] leading-[18px] text-foreground/90"
          data-language={languageHint || undefined}
        >
          {lines.map((line, index) => (
            <div key={index} className="flex min-w-0">
              <span className="w-11 shrink-0 select-none border-r border-border/60 pr-2 text-right text-[10px] leading-[18px] text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words px-3">{line || " "}</span>
            </div>
          ))}
        </pre>
      </ToolScrollBody>
      {remaining > 0 ? (
        <Button
          className="h-8 w-full justify-start rounded-none border-t border-border/60 px-4 text-[11px] text-muted-foreground"
          onClick={() => setShowAll(true)}
          variant="ghost"
        >
          查看其余 {remaining} 行
        </Button>
      ) : null}
    </ToolEditorFrame>
  );
}

function ToolDiffLine({ line }: { line: UnifiedDiffDisplayLine }) {
  const added = line.kind === "added";
  const removed = line.kind === "removed";
  const meta = line.kind === "meta";
  return (
    <div
      className={cn(
        "flex min-w-0 border-l-[3px]",
        added && "border-emerald-600 bg-emerald-500/10 dark:border-emerald-500 dark:bg-emerald-950/30",
        removed && "border-rose-600 bg-rose-500/10 dark:border-rose-500 dark:bg-rose-950/30",
        !added && !removed && "border-transparent"
      )}
    >
      <span
        className={cn(
          "w-11 shrink-0 select-none border-r border-border/60 pr-2 text-right font-mono text-[10px] leading-[18px] text-muted-foreground",
          added && "text-emerald-700 dark:text-emerald-400",
          removed && "text-rose-700 dark:text-rose-400"
        )}
      >
        {meta ? "" : line.lineNumber ?? ""}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words px-3 font-mono text-[11.5px] leading-[18px] text-foreground",
          meta && "text-muted-foreground"
        )}
      >
        {meta
          ? line.content
          : `${added ? "+" : removed ? "-" : " "}${line.content}`}
      </span>
    </div>
  );
}

function ToolDiffBlock({
  patch,
  filePath,
  additions,
  deletions,
  embedded = false
}: {
  patch: string;
  filePath?: string;
  additions?: number;
  deletions?: number;
  embedded?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const allLines = useMemo(() => {
    const parsed = parseUnifiedDiff(patch);
    // 外层事件头已有文件名 / +/-，嵌入态再藏掉 ---/+++ 文件头，避免重复
    if (!embedded) return parsed;
    return parsed.filter((line) => !(line.kind === "meta" && (/^---\s/.test(line.content) || /^\+\+\+\s/.test(line.content))));
  }, [embedded, patch]);
  const lines = showAll ? allLines : allLines.slice(0, INLINE_PREVIEW_MAX_LINES);
  const remaining = allLines.length - lines.length;

  return (
    <ToolEditorFrame
      // 嵌入事件卡片时不重复文件名与 +/- 统计（外层 headline 已展示）
      filePath={embedded ? undefined : filePath}
      additions={embedded ? undefined : additions}
      deletions={embedded ? undefined : deletions}
      embedded={embedded}
    >
      <ToolScrollBody>
        <pre className="pb-2 pt-0">
          {lines.map((line, index) => (
            <ToolDiffLine key={`${line.kind}:${line.lineNumber ?? "m"}:${index}`} line={line} />
          ))}
        </pre>
      </ToolScrollBody>
      {remaining > 0 ? (
        <Button
          className="h-8 w-full justify-start rounded-none border-t border-border/60 px-4 text-[11px] text-muted-foreground"
          onClick={() => setShowAll(true)}
          variant="ghost"
        >
          查看其余 {remaining} 行
        </Button>
      ) : null}
    </ToolEditorFrame>
  );
}

function ToolTerminalBlock({
  command,
  output,
  embedded = false,
  isError = false
}: {
  command: string;
  output: string;
  embedded?: boolean;
  isError?: boolean;
}) {
  const body = [
    command ? `$ ${command}` : "",
    output
  ].filter(Boolean).join("\n");
  if (!body.trim()) return null;
  return (
    <ToolEditorFrame embedded={embedded} tone={isError ? "error" : "default"}>
      <ToolScrollBody>
        <pre
          className={cn(
            "px-3 pb-2.5 pt-0 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words",
            isError ? "text-destructive" : "text-foreground/90"
          )}
        >
          {body}
        </pre>
      </ToolScrollBody>
    </ToolEditorFrame>
  );
}

function ToolErrorBlock({ value, embedded = false }: { value: string; embedded?: boolean }) {
  if (!value.trim()) return null;
  return (
    <ToolEditorFrame embedded={embedded} tone="error">
      <ToolScrollBody>
        <pre className="px-3 pb-2.5 pt-0 font-mono text-xs leading-relaxed text-destructive whitespace-pre-wrap break-words">
          {value}
        </pre>
      </ToolScrollBody>
    </ToolEditorFrame>
  );
}

/**
 * pi 原生工具 part 渲染：对齐 Moirai 列表事件模式——
 * 折叠时无卡片 chrome；展开后才出现边框容器；edit 优先 diff，bash 走终端块。
 */
export function AgentExecutionPartView({
  part,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  listItem = false,
  onOpenToolFile,
  onOpenBrowserUrl
}: AgentExecutionPartViewProps) {
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null);
  const type = String(part?.type || "");
  if (type === "step-start" || type === "step-finish") {
    return null;
  }
  if (type !== "toolCall") return null;

  const tool = String((part as any).toolName || "tool");
  if (tool === "todowrite") return null;

  const status = String((part as any).status || "").trim().toLowerCase();
  const running = status === "running" || status === "pending" || status === "deciding";
  const isError = status === "error" || Boolean((part as any).isError);
  const input = ((part as any).input || {}) as Record<string, unknown>;
  const details = (part as any).details as Record<string, unknown> | undefined;
  const outputText = redactSecrets(truncateRichText(normalizeText((part as any).output))) || toDisplayJson((part as any).output, 2200);
  const subtitle = toolHeadlineTarget(tool, input);
  const contextTool = isContextTool(tool);
  const preview = getToolResultPreview(tool, input, outputText, details);
  const shellTool = tool === "bash";
  const editTool = tool === "write" || tool === "edit" || tool === "hashline_edit" || tool === "apply_patch";
  const webTool = tool === "web_fetch" || tool === "web_search";
  const webUrl = webTool
    ? tool === "web_fetch"
      ? normalizeText(input.url) || normalizeText(details?.url)
      : `https://duckduckgo.com/?q=${encodeURIComponent(normalizeText(input.query))}`
    : "";
  const bashCommand = normalizeText(input.command);
  const editOldText = tool === "edit" && typeof input.oldText === "string" ? input.oldText : "";
  const editNewText = tool === "edit" && typeof input.newText === "string" ? input.newText : "";
  const Icon = toolKindIcon(tool);

  const detailFilePath =
    preview?.kind === "diff"
      ? preview.file
      : preview?.kind === "file"
        ? preview.path
        : normalizeText(input.path);
  const detailFileLabel = compactPath(detailFilePath);
  const targetLabel = detailFileLabel || compactPath(subtitle) || subtitle;
  const changeStats = preview?.kind === "diff"
    ? { added: preview.additions, removed: preview.deletions }
    : null;
  // edit 首改行号（details.firstChangedLine）：headline 显示 L{n} 帮助定位代码位置。
  const editFirstLineRaw = details?.firstChangedLine;
  const editFirstLine = typeof editFirstLineRaw === "number" ? editFirstLineRaw : null;

  const toolFileTarget = (() => {
    if (tool === "read") {
      const filePath = normalizeText(input.path);
      if (!filePath) return null;
      // 不把 pi 带 "N→" 行号前缀的 output 塞进右侧编辑器；直接打开工作区真实文件。
      return {
        filePath,
        line: 1,
        preferDiff: false
      } satisfies AgentToolFileTarget;
    }
    if (tool === "edit") {
      const filePath = normalizeText(input.path);
      if (!filePath) return null;
      return {
        filePath,
        line: typeof details?.firstChangedLine === "number" ? details.firstChangedLine : undefined,
        original: editOldText || undefined,
        modified: editNewText || undefined,
        patch: preview?.kind === "diff" ? preview.patch : undefined,
        preferDiff: true
      } satisfies AgentToolFileTarget;
    }
    if (tool === "write") {
      const filePath = normalizeText(input.path);
      const writeContent = typeof input.content === "string" ? input.content : "";
      if (!filePath || !writeContent.trim()) return null;
      return {
        filePath,
        line: 1,
        focusText: writeContent,
        modified: writeContent,
        patch: preview?.kind === "diff" ? preview.patch : undefined,
        preferDiff: true
      } satisfies AgentToolFileTarget;
    }
    if (tool === "hashline_edit" || tool === "apply_patch") {
      const filePath = normalizeText(input.path);
      if (!filePath) return null;
      return {
        filePath,
        patch: preview?.kind === "diff" ? preview.patch : undefined,
        preferDiff: true
      } satisfies AgentToolFileTarget;
    }
    return null;
  })();

  const detailKind = resolveDetailKind({
    tool,
    isError,
    running,
    preview,
    bashCommand,
    outputText,
    contextTool
  });
  const hasDetails = detailKind !== "none";
  const suppressRunningEditDetails = running && editTool;
  // 批组列表内默认折叠，由用户二次点击展开详情；独立事件仍尊重设置/错误/运行中
  const detailDefaultOpen = listItem
    ? false
    : tool === "question"
      ? false
      : isError ||
        (running && !editTool && shellTool) ||
        (shellTool && shellToolPartsExpanded) ||
        (editTool && !running && editToolPartsExpanded);
  const open = detailsOpen ?? detailDefaultOpen;
  const integratedCard = hasDetails && open && !suppressRunningEditDetails;

  useEffect(() => {
    if (listItem || !hasDetails || contextTool || suppressRunningEditDetails) return;
    if (detailsOpen !== null) return;
    if (detailDefaultOpen) setDetailsOpen(true);
  }, [contextTool, detailDefaultOpen, detailsOpen, hasDetails, listItem, suppressRunningEditDetails]);

  const headline = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left">
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center",
          listItem ? "size-3" : "size-3.5"
        )}
        aria-hidden
      >
        <Icon
          className={cn(
            "size-full",
            isError ? "text-destructive" : running ? "animate-pulse text-foreground" : "text-muted-foreground"
          )}
          strokeWidth={listItem ? 2 : 1.75}
        />
      </span>
      <strong
        className={cn(
          "shrink-0 font-medium",
          listItem ? "text-xs" : "text-sm",
          isError ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {toolDisplayName(tool)}
      </strong>
      {!listItem && !editTool ? (
        <span
          className={cn(
            "shrink-0 text-xs",
            running ? "text-muted-foreground/70" : "invisible"
          )}
          aria-hidden={!running}
        >
          {toolMode(tool)}
        </span>
      ) : null}
      {targetLabel ? (
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            listItem ? "text-xs" : "text-sm",
            isError ? "text-destructive" : "text-muted-foreground"
          )}
          title={detailFilePath || targetLabel}
        >
          {targetLabel}
        </span>
      ) : <span className="min-w-0 flex-1" />}
      {editTool && editFirstLine !== null ? (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
          L{editFirstLine}
        </span>
      ) : null}
      {editTool ? (
        <span className="inline-grid shrink-0 grid-cols-1 grid-rows-1 font-mono text-[11px]">
          <span className="invisible col-start-1 row-start-1 tabular-nums" aria-hidden>
            +999 -999
          </span>
          {changeStats ? (
            <span className="col-start-1 row-start-1 tabular-nums">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">+{changeStats.added}</span>
              {changeStats.removed > 0 ? (
                <>
                  {" "}
                  <span className="font-semibold text-rose-600 dark:text-rose-400">-{changeStats.removed}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      ) : null}
      {webTool && webUrl && onOpenBrowserUrl ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenBrowserUrl(webUrl);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onOpenBrowserUrl(webUrl);
            }
          }}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground"
          title="在内置浏览器打开"
        >
          <Globe className="size-3" />
          打开
        </span>
      ) : null}
    </div>
  );

  const detailsBody = suppressRunningEditDetails ? null : (
    <ToolEventDetails
      detailKind={detailKind}
      preview={preview}
      bashCommand={bashCommand}
      outputText={outputText}
      filePath={detailFilePath}
      isError={isError}
    />
  );

  if (hasDetails && !contextTool && !suppressRunningEditDetails) {
    return (
      <Collapsible
        className={cn(
          "min-w-0 max-w-full overflow-hidden rounded-xl border transition-[border-color,background-color] duration-200",
          integratedCard
            ? isError
              ? "border-destructive/30 bg-card"
              : "border-border bg-card"
            : "border-transparent bg-transparent"
        )}
        open={open}
        onOpenChange={setDetailsOpen}
      >
        <CollapsibleTrigger asChild>
          <Button
            className="h-auto w-full justify-start rounded-none px-3 py-2 hover:bg-transparent hover:text-foreground"
            variant="ghost"
          >
            {headline}
          </Button>
        </CollapsibleTrigger>
        <AnimatedCollapsibleContent open={open}>
          <Separator />
          {detailsBody}
        </AnimatedCollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div
      className={cn(
        "grid min-w-0 gap-1 py-0.5",
        suppressRunningEditDetails && "text-muted-foreground"
      )}
    >
      {toolFileTarget ? (
        <Button
          className={cn(
            "h-auto w-full justify-start rounded-md px-0 hover:bg-transparent hover:text-foreground",
            listItem ? "py-1" : "py-1.5"
          )}
          onClick={() => onOpenToolFile(toolFileTarget)}
          title="在右侧打开文件"
          variant="ghost"
        >
          {headline}
        </Button>
      ) : (
        <div className={cn("flex min-w-0 items-center px-0", listItem ? "py-1" : "py-1.5")}>{headline}</div>
      )}
    </div>
  );
}

type DetailKind = "none" | "error" | "diff" | "file" | "terminal" | "code";

function resolveDetailKind(options: {
  tool: string;
  isError: boolean;
  running: boolean;
  preview: ToolResultPreview | null;
  bashCommand: string;
  outputText: string;
  contextTool: boolean;
}): DetailKind {
  const { tool, isError, preview, bashCommand, outputText, contextTool } = options;
  // bash 失败也走终端块，避免整段挤在 error 红框里
  if (tool === "bash") return bashCommand || outputText ? "terminal" : "none";
  if (isError) return outputText ? "error" : "none";
  if (preview?.kind === "diff") return "diff";
  if (preview?.kind === "file") return "file";
  if (contextTool) return "none";
  if (!outputText) return "none";
  const trimmed = outputText.trim();
  return trimmed.includes("\n") || trimmed.length > 160 ? "code" : "none";
}

function ToolEventDetails({
  detailKind,
  preview,
  bashCommand,
  outputText,
  filePath,
  isError = false
}: {
  detailKind: DetailKind;
  preview: ToolResultPreview | null;
  bashCommand: string;
  outputText: string;
  filePath: string;
  isError?: boolean;
}) {
  if (detailKind === "none") return null;
  if (detailKind === "error") {
    return <ToolErrorBlock value={outputText} embedded />;
  }
  if (detailKind === "diff" && preview?.kind === "diff") {
    return (
      <ToolDiffBlock
        patch={preview.patch}
        filePath={compactPath(preview.file) || compactPath(filePath) || undefined}
        additions={preview.additions}
        deletions={preview.deletions}
        embedded
      />
    );
  }
  if (detailKind === "file" && preview?.kind === "file") {
    return (
      <ToolSourceBlock
        value={preview.content}
        embedded
      />
    );
  }
  if (detailKind === "terminal") {
    return (
      <ToolTerminalBlock
        command={bashCommand}
        output={outputText}
        embedded
        isError={isError}
      />
    );
  }
  return <ToolSourceBlock value={outputText} embedded languageHint="text" />;
}

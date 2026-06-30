import { useEffect, useState, type ReactNode } from "react";
import { isOpencodeContextTool, parseOpencodeTaskSessionId, toDisplayJson } from "../../lib/opencodeParts";
import type { OpencodeDetailedPart } from "../../lib/opencodeSessions";
import { parseReadToolOutput, withLineNumbers } from "../../lib/textFormatting";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { cn } from "../../lib/utils";

type NormalizedEditFileDiff = {
  file: string;
  patch?: string;
  before?: string;
  after?: string;
  additions: number;
  deletions: number;
  status: "modified" | "added" | "deleted";
};

type NormalizedPatchFile = {
  filePath: string;
  relativePath: string;
  type: "add" | "update" | "delete" | "move";
  patch?: string;
  additions: number;
  deletions: number;
  movePath?: string;
};

export type OpencodeToolFileTarget = {
  filePath: string;
  line?: number;
  focusText?: string;
  original?: string;
  modified?: string;
  patch?: string;
  preferDiff?: boolean;
};

type OpencodeExecutionPartViewProps = {
  part: OpencodeDetailedPart;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenToolFile: (target: OpencodeToolFileTarget) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readableSearchPattern(pattern: unknown): string {
  return normalizeText(pattern)
    .replace(/\\\./g, ".")
    .replace(/\\\//g, "/")
    .replace(/\\-/g, "-");
}

function isWildcardOnly(value: string): boolean {
  const text = normalizeText(value).replace(/\s+/g, "");
  return text === "*" || text === "**/*" || text === "./*" || text === ".";
}

function meaningfulSearchToken(value: unknown, compact = false): string {
  const text = compact ? compactPath(normalizeText(value)) : readableSearchPattern(value);
  if (!text || isWildcardOnly(text)) return "";
  return text;
}

function compactPath(input: string): string {
  const path = normalizeText(input).replace(/\\/g, "/");
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function diffCountFromText(text: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toolDisplayName(tool: string): string {
  if (tool === "read") return "读取";
  if (tool === "list") return "列出";
  if (tool === "glob" || tool === "grep" || tool === "search") return "搜索";
  if (tool === "write") return "写入";
  if (tool === "edit") return "编辑";
  if (tool === "apply_patch") return "补丁";
  if (tool === "task") return "任务";
  if (tool === "question") return "提问";
  if (tool === "bash") return "bash";
  return tool || "tool";
}

function toolMode(tool: string): string {
  if (tool === "read" || tool === "list" || tool === "glob" || tool === "grep") return "读取";
  if (tool === "write" || tool === "edit" || tool === "apply_patch") return "写入";
  if (tool === "bash") return "命令";
  if (tool === "search") return "搜索";
  return "";
}

function searchToolDetail(input: any, state: any): string {
  const title = meaningfulSearchToken(state?.title);
  const description = meaningfulSearchToken(input?.description);
  const query =
    meaningfulSearchToken(input?.query) ||
    meaningfulSearchToken(input?.search) ||
    meaningfulSearchToken(input?.keyword) ||
    meaningfulSearchToken(input?.text) ||
    meaningfulSearchToken(input?.regex) ||
    meaningfulSearchToken(input?.regexp) ||
    meaningfulSearchToken(input?.pattern);
  const include =
    meaningfulSearchToken(input?.include) ||
    meaningfulSearchToken(input?.glob) ||
    meaningfulSearchToken(input?.filePattern) ||
    meaningfulSearchToken(input?.files);
  const path =
    meaningfulSearchToken(input?.filePath, true) ||
    meaningfulSearchToken(input?.path, true) ||
    meaningfulSearchToken(input?.cwd, true);
  const parts = [description || title, query, include, path]
    .filter(Boolean)
    .filter((item, index, rows) => rows.indexOf(item) === index);
  return parts.join(" · ");
}

function toolDetail(tool: string, input: any, state: any): string {
  if (tool === "glob" || tool === "grep" || tool === "search") {
    return searchToolDetail(input, state);
  }
  return (
    normalizeText(input?.description) ||
    normalizeText(state?.title) ||
    compactPath(normalizeText(input?.filePath)) ||
    meaningfulSearchToken(input?.pattern) ||
    normalizeText(input?.query) ||
    normalizeText(input?.url) ||
    compactPath(normalizeText(input?.path))
  );
}

function toolOutputText(state: any): string {
  const output = state?.output;
  if (typeof output === "string") return output.trim();
  if (output && typeof output === "object") {
    try {
      return JSON.stringify(output, null, 2).trim();
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeEditFileDiff(tool: string, state: any, metadata: any): NormalizedEditFileDiff | undefined {
  if (tool !== "edit") return undefined;
  const fromMeta = metadata?.filediff;
  const file = normalizeText(fromMeta?.file) || normalizeText(state?.input?.filePath);
  const patch = normalizeText(fromMeta?.patch) || "";
  const before = typeof state?.input?.oldString === "string"
      ? state.input.oldString
      : typeof state?.input?.old_string === "string"
        ? state.input.old_string
        : typeof fromMeta?.before === "string"
          ? fromMeta.before
          : "";
  const after = typeof state?.input?.newString === "string"
      ? state.input.newString
      : typeof state?.input?.new_string === "string"
        ? state.input.new_string
        : typeof fromMeta?.after === "string"
          ? fromMeta.after
          : "";
  const counts = patch ? diffCountFromText(patch) : { additions: 0, deletions: 0 };
  const additions = toNumber(fromMeta?.additions) || counts.additions;
  const deletions = toNumber(fromMeta?.deletions) || counts.deletions;
  if (!file && !patch && !before && !after) return undefined;
  return {
    file,
    patch: patch || undefined,
    before: before || undefined,
    after: after || undefined,
    additions,
    deletions,
    status: typeof fromMeta?.status === "string" ? fromMeta.status : "modified"
  };
}

function normalizePatchFiles(metadata: any): NormalizedPatchFile[] | undefined {
  if (!Array.isArray(metadata?.files)) return undefined;
  const files = metadata.files
    .map((file: any) => {
      const patch = normalizeText(file?.patch) || normalizeText(file?.diff) || undefined;
      const counts = patch ? diffCountFromText(patch) : { additions: 0, deletions: 0 };
      const type = normalizeText(file?.type) as NormalizedPatchFile["type"];
      const relativePath = normalizeText(file?.relativePath) || normalizeText(file?.filePath);
      const filePath = normalizeText(file?.filePath) || relativePath;
      if (!relativePath && !filePath) return null;
      return {
        filePath,
        relativePath,
        type: type || "update",
        patch,
        additions: toNumber(file?.additions) || counts.additions,
        deletions: toNumber(file?.deletions) || counts.deletions,
        movePath: normalizeText(file?.movePath) || undefined
      };
    })
    .filter(Boolean) as NormalizedPatchFile[];
  return files.length > 0 ? files : undefined;
}

function summarizePatchText(patchText: string): string {
  const rows = new Map<string, { action: string; add: number; del: number }>();
  let current = "";
  for (const line of patchText.split(/\r?\n/)) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (header) {
      current = normalizeText(header[2]);
      rows.set(current, { action: header[1], add: 0, del: 0 });
      continue;
    }
    if (!current) continue;
    const row = rows.get(current);
    if (!row) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) row.add += 1;
    if (line.startsWith("-") && !line.startsWith("---")) row.del += 1;
  }
  const summaries = [...rows.entries()].map(([path, row]) => {
    const action = row.action === "Add" ? "新增" : row.action === "Delete" ? "删除" : "修改";
    return `${action} ${compactPath(path)} +${row.add} -${row.del}`;
  });
  if (summaries.length <= 2) return summaries.join("；");
  return `${summaries.slice(0, 2).join("；")}；等 ${summaries.length} 个文件`;
}

function summarizePatchOutput(outputText: string): string {
  const rows: string[] = [];
  for (const line of outputText.split(/\r?\n/)) {
    const match = line.match(/^\s*([MAD])\s+(.+)$/);
    if (!match) continue;
    const action = match[1] === "A" ? "新增" : match[1] === "D" ? "删除" : "修改";
    rows.push(`${action} ${compactPath(match[2])}`);
  }
  if (rows.length <= 2) return rows.join("；");
  return `${rows.slice(0, 2).join("；")}；等 ${rows.length} 个文件`;
}

function summarizeWriteTool(tool: string, input: any): string {
  if (tool === "apply_patch") {
    const patchText = normalizeText(input?.patchText) || normalizeText(input?.patch);
    return summarizePatchText(patchText);
  }
  const filePath = compactPath(normalizeText(input?.filePath) || normalizeText(input?.path));
  if (tool === "write") {
    const content = typeof input?.content === "string" ? input.content : "";
    const lineCount = content ? content.split(/\r?\n/).length : 0;
    return [filePath, lineCount ? `${lineCount} 行` : ""].filter(Boolean).join(" · ");
  }
  if (tool === "edit") {
    const oldText = typeof input?.oldString === "string" ? input.oldString : typeof input?.old_string === "string" ? input.old_string : "";
    const newText = typeof input?.newString === "string" ? input.newString : typeof input?.new_string === "string" ? input.new_string : "";
    const oldLines = oldText ? oldText.split(/\r?\n/).length : 0;
    const newLines = newText ? newText.split(/\r?\n/).length : 0;
    const delta = oldLines || newLines ? `+${newLines} -${oldLines}` : "";
    return [filePath, delta].filter(Boolean).join(" · ");
  }
  return "";
}

function cleanDetailLabel(tool: string, label: string): string {
  const text = normalizeText(label);
  if (!text) return "";
  if ((tool === "write" || tool === "edit" || tool === "apply_patch") && text === "写入") return "";
  if ((tool === "read" || tool === "list" || tool === "glob" || tool === "grep") && text === "读取") return "";
  return text;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ToolCodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-[340px] max-w-full overflow-auto rounded-md bg-muted/20 p-3 font-mono text-xs leading-relaxed text-foreground/85 whitespace-pre-wrap break-words">
      {children}
    </pre>
  );
}

function ToolCommandBlock({ command }: { command: string }) {
  if (!command) return null;
  return (
    <div className="max-w-full rounded-md bg-muted/20 px-3 py-2 font-mono text-xs text-foreground/85">
      <code className="break-words">{command}</code>
    </div>
  );
}

function ToolSection({
  title,
  meta,
  children
}: {
  title?: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-2 py-2">
      {title || meta ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          {title ? <strong className="min-w-0 truncate text-xs font-semibold text-foreground">{title}</strong> : <span />}
          {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function ToolSubsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function ToolHeader({
  running,
  tool,
  contextTool,
  ioLabel,
  detailFileLabel,
  detailFilePath,
  detailMeta,
  taskSessionId,
  taskSubagent,
  taskTitleHint,
  onOpenTaskSession
}: {
  running: boolean;
  tool: string;
  contextTool: boolean;
  ioLabel: string;
  detailFileLabel: string;
  detailFilePath: string;
  detailMeta: string;
  taskSessionId: string;
  taskSubagent: string;
  taskTitleHint: string;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
}) {
  const displayName = toolDisplayName(tool);
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
      <strong className="text-sm font-semibold text-foreground">{displayName}</strong>
      {!contextTool && tool !== "edit" && tool !== "write" && tool !== "apply_patch" && tool && displayName !== tool ? (
        <span className="text-xs font-medium text-muted-foreground">{tool}</span>
      ) : null}
      {ioLabel ? <span className="text-xs font-medium text-muted-foreground">{ioLabel}</span> : null}
      {detailFileLabel ? (
        <span className="max-w-[180px] truncate text-xs font-medium text-muted-foreground" title={detailFilePath || detailFileLabel}>{detailFileLabel}</span>
      ) : null}
      {detailMeta ? <span className="min-w-0 truncate text-xs text-muted-foreground">{detailMeta}</span> : null}
      {taskSessionId ? (
        <Button
          className="ml-auto h-7 px-2 text-xs"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenTaskSession(taskSessionId, taskTitleHint);
          }}
          title={taskSubagent ? `Open @${taskSubagent} sub-session` : "Open sub-session"}
          variant="ghost"
          size="sm"
        >
          {taskSubagent ? `Open @${taskSubagent}` : "Open task"}
        </Button>
      ) : null}
    </div>
  );
}

export function OpencodeExecutionPartView({
  part,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession,
  onOpenToolFile
}: OpencodeExecutionPartViewProps) {
  const [detailsOpen, setDetailsOpen] = useState<boolean | null>(null);
  const type = String(part?.type || "");
  if (type === "step-start" || type === "step-finish") {
    return null;
  }
  if (type !== "tool") return null;

  const tool = String((part as any).tool || "tool");
  if (tool === "todowrite") return null;

  const state = (part as any).state || {};
  const metadata = state?.metadata || (part as any)?.metadata || {};
  const status = String(state.status || "").trim();
  const running = status.toLowerCase() === "running" || status.toLowerCase() === "pending";
  const input = state.input;
  const subtitle = toolDetail(tool, input, state);
  const taskSessionId = tool === "task" ? parseOpencodeTaskSessionId(part) : "";
  const taskSubagent = tool === "task" ? String(input?.subagent_type || "").trim() : "";
  const taskTitleHint =
    (tool === "task" ? String(input?.description || "").trim() : "") ||
    (taskSubagent ? `@${taskSubagent}` : "") ||
    "";
  const contextTool = isOpencodeContextTool(tool);
  const outputText = toolOutputText(state) || toDisplayJson(state?.output, 2200);
  const parsedRead = tool === "read" ? parseReadToolOutput(outputText) : null;
  const rawLines = outputText ? outputText.split(/\r?\n/) : [];
  const previewLines = rawLines.slice(0, 12);
  const outputPreview = previewLines.join("\n") + (rawLines.length > 12 ? "\n..." : "");
  const shellTool = tool === "bash";
  const editTool = tool === "write" || tool === "edit" || tool === "apply_patch";
  const ioLabel = running && !editTool ? toolMode(tool) : "";
  const writeSummary = normalizeText(metadata?.writeSummary);
  const fileDiff = normalizeEditFileDiff(tool, state, metadata);
  const patchFiles = tool === "apply_patch" ? normalizePatchFiles(metadata) : undefined;
  const bashCommand = normalizeText(input?.command);
  const detailFilePath =
    (tool === "read"
      ? normalizeText(parsedRead?.path) || normalizeText(input?.filePath) || normalizeText(input?.path)
      : tool === "edit"
        ? normalizeText(fileDiff?.file)
        : tool === "write"
          ? normalizeText(input?.filePath) || normalizeText(input?.path)
          : tool === "apply_patch"
            ? normalizeText(patchFiles?.[0]?.relativePath || "") || normalizeText(patchFiles?.[0]?.filePath || "")
            : "") || "";
  const detailFileLabel = compactPath(detailFilePath);
  const detailLabel =
    cleanDetailLabel(
      tool,
      writeSummary ||
        (fileDiff ? `${compactPath(fileDiff.file)} · +${fileDiff.additions} -${fileDiff.deletions}` : "") ||
        (patchFiles?.length === 1 ? `${compactPath(patchFiles[0]?.relativePath || "")} · +${patchFiles[0]?.additions || 0} -${patchFiles[0]?.deletions || 0}` : "") ||
        summarizeWriteTool(tool, input) ||
        (tool === "apply_patch" ? summarizePatchOutput(outputText) : "") ||
        compactPath(subtitle) ||
        subtitle
    );
  const detailMeta = (() => {
    if (!detailLabel) return "";
    if (!detailFileLabel) return detailLabel;
    let next = detailLabel.replace(new RegExp(`^${escapeRegExp(detailFileLabel)}\\s*·\\s*`), "").trim();
    if (next === detailLabel) {
      next = detailLabel.replace(new RegExp(`^(新增|修改|删除)\\s+${escapeRegExp(detailFileLabel)}\\s*`), "").trim();
    }
    return next === detailFileLabel ? "" : next;
  })();
  const toolFileTarget = (() => {
    if (tool === "read" && parsedRead?.content) {
      const filePath = normalizeText(parsedRead.path) || normalizeText(input?.filePath) || normalizeText(input?.path);
      if (!filePath) return null;
      return {
        filePath,
        line: 1,
        modified: parsedRead.content,
        preferDiff: false
      } satisfies OpencodeToolFileTarget;
    }
    if (tool === "edit" && fileDiff?.file) {
      return {
        filePath: fileDiff.file,
        line: undefined,
        original: fileDiff.before,
        modified: fileDiff.after,
        patch: fileDiff.patch,
        preferDiff: true
      } satisfies OpencodeToolFileTarget;
    }
    if (tool === "write") {
      const filePath = normalizeText(input?.filePath) || normalizeText(input?.path);
      const modified = typeof input?.content === "string" ? input.content : "";
      if (!filePath || !modified.trim()) return null;
      return {
        filePath,
        line: 1,
        focusText: modified,
        modified,
        preferDiff: true
      } satisfies OpencodeToolFileTarget;
    }
    if (tool === "apply_patch") {
      const file = patchFiles?.[0];
      if (!file) return null;
      return {
        filePath: file.filePath || file.relativePath,
        line: undefined,
        patch: file.patch,
        preferDiff: true
      } satisfies OpencodeToolFileTarget;
    }
    return null;
  })();
  const suppressRunningEditDetails = running && editTool;
  const showPreview = !toolFileTarget && !contextTool && !!outputPreview && (status === "error" || (!shellTool && !editTool));
  const detailDefaultOpen =
    status === "error" ||
    (running && !editTool) ||
    (shellTool && shellToolPartsExpanded) ||
    (editTool && !running && editToolPartsExpanded);
  const hasInlineDetails = (
    (shellTool && (!!bashCommand || !!outputText)) ||
    !!parsedRead?.content ||
    !!outputText ||
    !!fileDiff ||
    !!patchFiles?.length ||
    (tool === "write" && typeof input?.content === "string" && !!input.content.trim())
  );
  const hasExpandedContent =
    !!parsedRead?.content ||
    !!bashCommand ||
    !!outputText ||
    !!fileDiff ||
    !!patchFiles?.length ||
    (tool === "write" && typeof input?.content === "string" && !!input.content.trim());

  useEffect(() => {
    if (!hasInlineDetails || !hasExpandedContent || contextTool) return;
    if (detailsOpen !== null) return;
    if (detailDefaultOpen) setDetailsOpen(true);
  }, [contextTool, detailDefaultOpen, detailsOpen, hasExpandedContent, hasInlineDetails]);

  const renderToolHead = () => (
    <ToolHeader
      running={running}
      tool={tool}
      contextTool={contextTool}
      ioLabel={ioLabel}
      detailFileLabel={detailFileLabel}
      detailFilePath={detailFilePath}
      detailMeta={detailMeta}
      taskSessionId={taskSessionId}
      taskSubagent={taskSubagent}
      taskTitleHint={taskTitleHint}
      onOpenTaskSession={onOpenTaskSession}
    />
  );

  const renderDetailsBody = () => (
    <div className="grid min-w-0 gap-3 pt-2">
      {shellTool ? (
        <ToolSection>
          <ToolCommandBlock command={bashCommand} />
          {outputText ? <ToolCodeBlock>{outputText}</ToolCodeBlock> : null}
        </ToolSection>
      ) : null}

      {parsedRead?.content ? (
        <ToolSection title={compactPath(parsedRead.path || subtitle) || "文件内容"} meta={parsedRead.type || ""}>
          <ToolCodeBlock>{withLineNumbers(parsedRead.content, 120)}</ToolCodeBlock>
        </ToolSection>
      ) : null}

      {tool === "write" && typeof input?.content === "string" && input.content.trim() ? (
        <ToolSection title={compactPath(input?.filePath || input?.path) || "写入内容"} meta={`${input.content.split(/\r?\n/).length} 行`}>
          <ToolCodeBlock>{withLineNumbers(input.content, 180)}</ToolCodeBlock>
        </ToolSection>
      ) : null}

      {fileDiff ? (
        <ToolSection title={compactPath(fileDiff.file) || "编辑内容"} meta={`+${fileDiff.additions} -${fileDiff.deletions}`}>
          {fileDiff.patch ? <ToolCodeBlock>{withLineNumbers(fileDiff.patch, 220)}</ToolCodeBlock> : null}
          {fileDiff.before ? (
            <ToolSubsection title="修改前">
              <ToolCodeBlock>{withLineNumbers(fileDiff.before, 160)}</ToolCodeBlock>
            </ToolSubsection>
          ) : null}
          {fileDiff.after ? (
            <ToolSubsection title="修改后">
              <ToolCodeBlock>{withLineNumbers(fileDiff.after, 160)}</ToolCodeBlock>
            </ToolSubsection>
          ) : null}
        </ToolSection>
      ) : null}

      {patchFiles?.length ? (
        <ToolSection title="补丁文件" meta={`${patchFiles.length} 个文件`}>
          <div className="grid min-w-0 gap-2">
            {patchFiles.map((file, index) => (
              <div key={`${file.filePath}:${index}`} className="grid min-w-0 gap-2 py-1.5">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <strong className="min-w-0 truncate text-xs font-semibold">{compactPath(file.relativePath || file.filePath) || file.filePath}</strong>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {file.type} · +{file.additions} -{file.deletions}
                  </span>
                </div>
                {file.movePath ? <div className="text-xs text-muted-foreground">move to {file.movePath}</div> : null}
                {file.patch ? <ToolCodeBlock>{withLineNumbers(file.patch, 220)}</ToolCodeBlock> : null}
              </div>
            ))}
          </div>
        </ToolSection>
      ) : null}

      {!parsedRead && !shellTool && !fileDiff && !patchFiles?.length && outputText ? (
        <ToolSection title="输出">
          <ToolCodeBlock>{outputText}</ToolCodeBlock>
        </ToolSection>
      ) : null}
    </div>
  );

  if (hasInlineDetails && hasExpandedContent && !contextTool && !suppressRunningEditDetails) {
    return (
      <Collapsible
        className={cn(
          "grid min-w-0 gap-1 py-1.5",
          toolFileTarget && "hover:text-foreground"
        )}
        open={detailsOpen ?? detailDefaultOpen}
        onOpenChange={setDetailsOpen}
      >
        <CollapsibleTrigger asChild>
          <Button className="h-auto w-full justify-start rounded-md px-0 py-1.5 hover:bg-transparent hover:text-foreground" variant="ghost">
            {renderToolHead()}
          </Button>
        </CollapsibleTrigger>
        {showPreview ? <ToolCodeBlock>{outputPreview}</ToolCodeBlock> : null}
        <CollapsibleContent>
          {renderDetailsBody()}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div
      className={cn(
        "grid min-w-0 gap-1 py-1.5",
        toolFileTarget && "hover:text-foreground",
        suppressRunningEditDetails && "text-muted-foreground"
      )}
    >
      {toolFileTarget ? (
        <Button
          className="h-auto w-full justify-start rounded-md px-0 py-1.5 hover:bg-transparent hover:text-foreground"
          onClick={() => onOpenToolFile(toolFileTarget)}
          title="在右侧打开文件"
          variant="ghost"
        >
          {renderToolHead()}
        </Button>
      ) : (
        renderToolHead()
      )}

      {showPreview ? <ToolCodeBlock>{outputPreview}</ToolCodeBlock> : null}
    </div>
  );
}

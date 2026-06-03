import { useEffect, useState } from "react";
import { isOpencodeContextTool, parseOpencodeTaskSessionId, toDisplayJson } from "../../lib/opencodeParts";
import type { OpencodeDetailedPart } from "../../lib/opencodeSessions";
import { parseReadToolOutput, withLineNumbers } from "../../lib/textFormatting";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";

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

function toolDetail(input: any): string {
  return (
    normalizeText(input?.description) ||
    compactPath(normalizeText(input?.filePath)) ||
    readableSearchPattern(input?.pattern) ||
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
  const subtitle = toolDetail(input);
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
    <div className="opencode-exec-tool-head">
      <strong className={running ? "opencode-live-text" : ""}>{toolDisplayName(tool)}</strong>
      {!contextTool && tool !== "edit" && tool !== "write" && tool !== "apply_patch" && tool && toolDisplayName(tool) !== tool ? (
        <Badge variant="secondary" className="opencode-tool-chip">{tool}</Badge>
      ) : null}
      {ioLabel ? <span className="opencode-io-live">{ioLabel}</span> : null}
      {detailFileLabel ? (
        <Badge variant="secondary" className="opencode-tool-file-pill" title={detailFilePath || detailFileLabel}>{detailFileLabel}</Badge>
      ) : null}
      {detailMeta ? <span className="small muted opencode-tool-detail-label">{detailMeta}</span> : null}
      {taskSessionId ? (
        <Button
          className="opencode-task-link"
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

  const renderDetailsBody = () => (
    <div className="opencode-tool-details-body">
      {shellTool ? (
        <div className="opencode-tool-section">
          {bashCommand ? <div className="opencode-tool-command"><code>{bashCommand}</code></div> : null}
          {outputText ? <pre className="opencode-tool-output">{outputText}</pre> : null}
        </div>
      ) : null}

      {parsedRead?.content ? (
        <div className="opencode-tool-section">
          <div className="opencode-tool-section-head">
            <strong>{compactPath(parsedRead.path || subtitle) || "文件内容"}</strong>
            {parsedRead.type ? <span className="small muted">{parsedRead.type}</span> : null}
          </div>
          <pre className="opencode-tool-output">{withLineNumbers(parsedRead.content, 120)}</pre>
        </div>
      ) : null}

      {tool === "write" && typeof input?.content === "string" && input.content.trim() ? (
        <div className="opencode-tool-section">
          <div className="opencode-tool-section-head">
            <strong>{compactPath(input?.filePath || input?.path) || "写入内容"}</strong>
            <span className="small muted">{input.content.split(/\r?\n/).length} 行</span>
          </div>
          <pre className="opencode-tool-output">{withLineNumbers(input.content, 180)}</pre>
        </div>
      ) : null}

      {fileDiff ? (
        <div className="opencode-tool-section">
          <div className="opencode-tool-section-head">
            <strong>{compactPath(fileDiff.file) || "编辑内容"}</strong>
            <span className="small muted">+{fileDiff.additions} -{fileDiff.deletions}</span>
          </div>
          {fileDiff.patch ? <pre className="opencode-tool-output">{withLineNumbers(fileDiff.patch, 220)}</pre> : null}
          {fileDiff.before ? (
            <div className="opencode-tool-subsection">
              <div className="opencode-tool-subtitle">修改前</div>
              <pre className="opencode-tool-output">{withLineNumbers(fileDiff.before, 160)}</pre>
            </div>
          ) : null}
          {fileDiff.after ? (
            <div className="opencode-tool-subsection">
              <div className="opencode-tool-subtitle">修改后</div>
              <pre className="opencode-tool-output">{withLineNumbers(fileDiff.after, 160)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {patchFiles?.length ? (
        <div className="opencode-tool-section">
          <div className="opencode-tool-section-head">
            <strong>补丁文件</strong>
            <span className="small muted">{patchFiles.length} 个文件</span>
          </div>
          <div className="opencode-tool-file-list">
            {patchFiles.map((file, index) => (
              <div key={`${file.filePath}:${index}`} className="opencode-tool-file-card">
                <div className="opencode-tool-file-head">
                  <strong>{compactPath(file.relativePath || file.filePath) || file.filePath}</strong>
                  <span className="small muted">
                    {file.type} · +{file.additions} -{file.deletions}
                  </span>
                </div>
                {file.movePath ? <div className="small muted">move to {file.movePath}</div> : null}
                {file.patch ? <pre className="opencode-tool-output">{withLineNumbers(file.patch, 220)}</pre> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!parsedRead && !shellTool && !fileDiff && !patchFiles?.length && outputText ? (
        <div className="opencode-tool-section">
          <div className="opencode-tool-section-head">
            <strong>输出</strong>
          </div>
          <pre className="opencode-tool-output">{outputText}</pre>
        </div>
      ) : null}
    </div>
  );

  if (hasInlineDetails && hasExpandedContent && !contextTool && !suppressRunningEditDetails) {
    return (
      <Collapsible
        className={toolFileTarget ? "opencode-exec-item opencode-exec-tool opencode-tool-details opencode-exec-tool-openable" : "opencode-exec-item opencode-exec-tool opencode-tool-details"}
        open={detailsOpen ?? detailDefaultOpen}
        onOpenChange={setDetailsOpen}
      >
        <CollapsibleTrigger asChild>
          <div className="opencode-tool-summary" role="button" tabIndex={0}>
            {renderToolHead()}
          </div>
        </CollapsibleTrigger>
        {showPreview ? <pre className="opencode-tool-output">{outputPreview}</pre> : null}
        <CollapsibleContent>
          {renderDetailsBody()}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div
      className={
        toolFileTarget
          ? "opencode-exec-item opencode-exec-tool opencode-exec-tool-openable"
          : suppressRunningEditDetails
            ? "opencode-exec-item opencode-exec-tool opencode-exec-tool-inline"
            : "opencode-exec-item opencode-exec-tool"
      }
    >
      {toolFileTarget ? (
        <Button
          className="opencode-exec-tool-open-trigger"
          onClick={() => onOpenToolFile(toolFileTarget)}
          title="在右侧打开文件"
          variant="ghost"
        >
          <div className="opencode-exec-tool-head">
            <strong className={running ? "opencode-live-text" : ""}>{toolDisplayName(tool)}</strong>
            {ioLabel ? <span className="opencode-io-live">{ioLabel}</span> : null}
            {detailFileLabel ? <span className="opencode-tool-file-pill" title={detailFilePath || detailFileLabel}>{detailFileLabel}</span> : null}
            {detailMeta ? <span className="small muted opencode-tool-detail-label">{detailMeta}</span> : null}
          </div>
        </Button>
      ) : (
        renderToolHead()
      )}

      {showPreview ? <pre className="opencode-tool-output">{outputPreview}</pre> : null}
    </div>
  );
}

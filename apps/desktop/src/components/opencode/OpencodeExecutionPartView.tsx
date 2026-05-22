import { isOpencodeContextTool, parseOpencodeTaskSessionId, toDisplayJson } from "../../lib/opencodeParts";
import type { OpencodeDetailedPart } from "../../lib/opencodeSessions";
import { parseReadToolOutput, withLineNumbers } from "../../lib/textFormatting";

type OpencodeExecutionPartViewProps = {
  part: OpencodeDetailedPart;
  shellToolPartsExpanded: boolean;
  editToolPartsExpanded: boolean;
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
};

export function OpencodeExecutionPartView({
  part,
  shellToolPartsExpanded,
  editToolPartsExpanded,
  onOpenTaskSession
}: OpencodeExecutionPartViewProps) {
  const type = String(part?.type || "");
  if (type === "step-start" || type === "step-finish") {
    return null;
  }
  if (type !== "tool") return null;

  const tool = String((part as any).tool || "tool");
  if (tool === "todowrite") return null;

  const state = (part as any).state || {};
  const status = String(state.status || "").trim();
  const running = status.toLowerCase() === "running" || status.toLowerCase() === "pending";
  const input = state.input;
  const output = state.output;
  const subtitle = String(input?.description || input?.filePath || input?.pattern || input?.query || input?.url || "").trim();
  const ioLabel = (() => {
    if (!running) return "";
    if (tool === "read" || tool === "list" || tool === "glob" || tool === "grep") return "读取";
    if (tool === "write" || tool === "edit" || tool === "apply_patch") return "写入";
    return "";
  })();
  const taskSessionId = tool === "task" ? parseOpencodeTaskSessionId(part) : "";
  const taskSubagent = tool === "task" ? String(input?.subagent_type || "").trim() : "";
  const taskTitleHint =
    (tool === "task" ? String(input?.description || "").trim() : "") ||
    (taskSubagent ? `@${taskSubagent}` : "") ||
    "";
  const contextTool = isOpencodeContextTool(tool);
  const parsedRead = tool === "read" && typeof output === "string" ? parseReadToolOutput(output) : null;
  const outputText = typeof output === "string" ? output : output ? toDisplayJson(output, 2200) : "";
  const rawLines = outputText ? outputText.split("\n") : [];
  const previewLines = rawLines.slice(0, 12);
  const outputPreview = previewLines.join("\n") + (rawLines.length > 12 ? "\n..." : "");
  const shellTool = tool === "bash";
  const editTool = tool === "write" || tool === "edit" || tool === "apply_patch";
  const showOutput =
    !contextTool &&
    !!outputPreview &&
    (status === "error" || (shellTool && shellToolPartsExpanded) || (editTool && editToolPartsExpanded));

  return (
    <div className="opencode-exec-item opencode-exec-tool">
      <div className="opencode-exec-tool-head">
        <span
          className={
            status === "error"
              ? "opencode-exec-status opencode-exec-status-error"
              : running
                ? "opencode-exec-status opencode-exec-status-running"
                : "opencode-exec-status"
          }
          aria-hidden="true"
        />
        <strong className={running ? "opencode-live-text" : ""}>{tool}</strong>
        {ioLabel ? <span className="opencode-io-live">{ioLabel}</span> : null}
        {subtitle ? <span className="small muted">{subtitle}</span> : null}
        {taskSessionId ? (
          <button
            type="button"
            className="opencode-task-link"
            onClick={() => onOpenTaskSession(taskSessionId, taskTitleHint)}
            title={taskSubagent ? `Open @${taskSubagent} sub-session` : "Open sub-session"}
          >
            {taskSubagent ? `Open @${taskSubagent}` : "Open task"}
          </button>
        ) : null}
      </div>
      {parsedRead && editToolPartsExpanded ? (
        <pre className="opencode-tool-output">{withLineNumbers(parsedRead.content, 80)}</pre>
      ) : null}
      {!parsedRead && showOutput ? <pre className="opencode-tool-output">{outputPreview}</pre> : null}
    </div>
  );
}

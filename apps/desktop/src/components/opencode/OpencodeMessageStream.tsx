import { useEffect, useState, type CSSProperties } from "react";
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

type OpencodePreviewImage = {
  uri: string;
  filename?: string;
};

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
      const lastTimelineOnly = last.hasTimeline && !last.fallbackReply;
      const rowTimelineOnly = row.hasTimeline && !row.fallbackReply;
      const mergedBoundary = mergeContextBoundary(last.timelineGroups, row.timelineGroups);
      if (mergedBoundary) {
        last.timelineGroups = mergeAdjacentContextGroups(last.timelineGroups);
        row.timelineGroups = mergeAdjacentContextGroups(row.timelineGroups);
        last.hasTimeline = last.timelineGroups.length > 0;
        row.hasTimeline = row.timelineGroups.length > 0;
      }
      if (row.timelineGroups.length === 0 && !row.fallbackReply && !row.detailsLoading && !row.detailsError) {
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



  return (
    <div className="gt-chat-stream">
      {sessionLoading ? (
        <div className="opencode-session-loading small muted">加载会话中…</div>
      ) : messages.length === 0 ? null : (
        mergedRenderRows.map((row) => {
          const {
            msg,
            isAssistant,
            isStreaming,
            liveParts,
            renderParts,
            timelineGroups,
            hasTimeline,
            fallbackReply,
            detailsLoading,
            detailsError
          } = row;

          return (
            <div key={msg.id} className={isAssistant ? "opencode-msg opencode-msg-assistant" : "opencode-msg opencode-msg-user"}>

              {isAssistant ? (
                hasTimeline ? (
                  <div className="opencode-assistant-timeline">
                    {(() => {
                      const activeReasoningPartId = isStreaming
                        ? [...renderParts]
                          .reverse()
                          .find((part) => String((part as { type?: string }).type || "") === "reasoning")?.id || ""
                        : "";

                      const displayTimelineGroups = buildBatchedTimelineGroups(timelineGroups);
                      return displayTimelineGroups.map((group, index) => {
                        const timelineKey = `${msg.id}:${group.key}`;
                        if (group.kind === "tool-batch") {
                          const running = group.parts.some(isRunningToolPart);
                          const shell = group.batchKind === "shell";
                          const noun = shell ? "条命令" : "个文件";
                          const label = shell
                            ? (running ? "运行中" : "已运行")
                            : (running ? "编辑中" : "已编辑");
                          const isOpen = timelineOpenState[timelineKey] ?? false;
                          return (
                            <details
                              key={timelineKey}
                              className={`opencode-tool-batch opencode-tool-batch-${group.batchKind}`}
                              open={isOpen}
                              onToggle={(event) => {
                                const target = event.currentTarget;
                                setTimelineOpenState((prev) => ({ ...prev, [timelineKey]: target.open }));
                              }}
                            >
                              <summary className="opencode-tool-batch-head">
                                <strong>{label}</strong>
                                <span className="opencode-tool-batch-count">{group.parts.length} {noun}</span>
                                <span className="opencode-context-caret" aria-hidden="true">
                                  <svg viewBox="0 0 12 12">
                                    <path d="M4 2.5 8 6 4 9.5" />
                                  </svg>
                                </span>
                              </summary>
                              <div className="opencode-exec-list opencode-tool-batch-list">
                                {group.parts.map((part, partIndex) => (
                                  <OpencodeExecutionPartView
                                    key={`${group.key}:${part.id || partIndex}`}
                                    part={part}
                                    shellToolPartsExpanded={shellToolPartsExpanded}
                                    editToolPartsExpanded={editToolPartsExpanded}
                                    onOpenTaskSession={onOpenTaskSession}
                                    onOpenToolFile={onOpenToolFile}
                                  />
                                ))}
                              </div>
                            </details>
                          );
                        }

                        if (group.kind === "context") {
                          const counts = summarizeOpencodeContextToolCounts(group.parts);
                          const progress = summarizeOpencodeContextProgress(group.parts);
                          const summary = summarizeContextCounts(counts) || "已收集上下文";
                          const isOpen = timelineOpenState[timelineKey] ?? false;
                          return (
                            <details
                              key={timelineKey}
                              className="opencode-exec-context"
                              open={isOpen}
                              onToggle={(event) => {
                                const target = event.currentTarget;
                                setTimelineOpenState((prev) => ({ ...prev, [timelineKey]: target.open }));
                              }}
                            >
                              <summary className="opencode-exec-context-head">
                                <strong className={isStreaming || progress.active ? "opencode-live-text" : ""}>
                                  已探索
                                </strong>
                                <span className="small muted">
                                  {progress.detail ? `${summary} · ${progress.detail}` : summary}
                                </span>
                                <span className="opencode-context-caret" aria-hidden="true">
                                  <svg viewBox="0 0 12 12">
                                    <path d="M4 2.5 8 6 4 9.5" />
                                  </svg>
                                </span>
                              </summary>
                              <div className="opencode-exec-list">
                                {group.parts.map((part, partIndex) => (
                                  <OpencodeExecutionPartView
                                    key={`${group.key}:${partIndex}`}
                                    part={part}
                                    shellToolPartsExpanded={shellToolPartsExpanded}
                                    editToolPartsExpanded={editToolPartsExpanded}
                                    onOpenTaskSession={onOpenTaskSession}
                                    onOpenToolFile={onOpenToolFile}
                                  />
                                ))}
                              </div>
                            </details>
                          );
                        }

                        if (group.kind === "reasoning") {
                          if (!showReasoningSummaries) return null;
                          const text = group.parts
                            .map((part) => String((part as { text?: string }).text || "").trim())
                            .filter(Boolean)
                            .join("\n\n");
                          if (!text) return null;

                          const activeThink = isStreaming && group.parts.some((part) => String(part.id || "") === activeReasoningPartId);
                          const thinkPreviewLines = text
                            .split(/\r?\n+/)
                            .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
                            .filter(Boolean)
                            .slice(-4);
                          const thinkPreview = thinkPreviewLines.length > 0
                            ? thinkPreviewLines
                            : ["Reading context", "Tracing changes", "Composing answer"];
                          const thinkTrackStyle = {
                            ["--think-count" as any]: thinkPreview.length
                          } as CSSProperties;

                          const thinkIsOpen = timelineOpenState[timelineKey] ?? false;
                          return (
                            <details
                              key={timelineKey}
                              className={activeThink ? "opencode-think-card is-active" : "opencode-think-card"}
                              open={thinkIsOpen}
                              onToggle={(event) => {
                                const target = event.currentTarget;
                                setTimelineOpenState((prev) => ({ ...prev, [timelineKey]: target.open }));
                              }}
                            >
                              <summary className="opencode-think-card-summary">
                                <span className="opencode-think-label">
                                  {activeThink ? "思考中" : "已思考"}
                                </span>
                                {thinkPreview.length > 0 ? (
                                  <span className={activeThink ? "opencode-think-carousel is-active" : "opencode-think-carousel"} aria-label="thinking preview">
                                    <span className="opencode-think-carousel-track" style={thinkTrackStyle}>
                                      {thinkPreview.map((line, lineIndex) => (
                                        <span
                                          key={`${group.key}:think-preview:${lineIndex}`}
                                          className="opencode-think-carousel-line"
                                          style={{ ["--think-index" as any]: lineIndex }}
                                        >
                                          {line}
                                        </span>
                                      ))}
                                    </span>
                                  </span>
                                ) : null}
                              </summary>
                              <div className="opencode-msg-body">
                                {renderMarkdown(text, activeThink)}
                              </div>
                            </details>
                          );
                        }

                        if (group.kind !== "part") return null;
                        const type = String((group.part as { type?: string }).type || "");
                        if (type === "text") {
                          const text = String((group.part as { text?: string }).text || "").trim();
                          if (!text) return null;
                          return (
                            <div key={`${msg.id}:${group.key}`} className={isStreaming ? "opencode-msg-body opencode-msg-body-streaming" : "opencode-msg-body"}>
                              {renderMarkdown(text, isStreaming && index === displayTimelineGroups.length - 1)}
                              {isStreaming && index === displayTimelineGroups.length - 1 ? <span className="opencode-stream-caret" aria-label="running" /> : null}
                            </div>
                          );
                        }

                        return (
                          <OpencodeExecutionPartView
                            key={`${msg.id}:${group.key}`}
                            part={group.part}
                            shellToolPartsExpanded={shellToolPartsExpanded}
                            editToolPartsExpanded={editToolPartsExpanded}
                            onOpenTaskSession={onOpenTaskSession}
                            onOpenToolFile={onOpenToolFile}
                          />
                        );
                      });
                    })()}
                  </div>
                ) : fallbackReply ? (
                  <div className={isStreaming ? "opencode-msg-body opencode-msg-body-streaming" : "opencode-msg-body"}>
                    {renderMarkdown(fallbackReply, isStreaming)}
                    {isStreaming ? <span className="opencode-stream-caret" aria-label="running" /> : null}
                  </div>
                ) : (
                  <div className="opencode-thinking-placeholder" aria-live="polite" aria-label="思考中">
                    <div className="opencode-thinking-placeholder-head">
                      <span className="opencode-think-label opencode-live-text">思考中</span>
                      <span className="opencode-thinking-placeholder-wave" aria-hidden="true">
                        <span className="opencode-thinking-placeholder-bar" />
                        <span className="opencode-thinking-placeholder-bar" />
                        <span className="opencode-thinking-placeholder-bar" />
                      </span>
                    </div>
                  </div>
                )
              ) : msg.content.trim() || (msg.attachments && msg.attachments.length > 0) ? (
                <div className="opencode-msg-body">
                  {msg.attachments && msg.attachments.length > 0 ? (
                    <div className="opencode-msg-attachments">
                      {msg.attachments.map((attachment, imageIndex) => {
                        if (isImageAttachment({
                          kind: attachment.kind,
                          mime: attachment.mime || "",
                          dataUrl: attachment.uri,
                          filename: attachment.filename || ""
                        })) {
                          return (
                            <button
                              key={attachment.id}
                              type="button"
                              className="opencode-msg-image-btn"
                              onClick={() => onPreviewImageGroup(
                                (msg.attachments || [])
                                  .filter((item) => isImageAttachment({
                                    kind: item.kind,
                                    mime: item.mime || "",
                                    dataUrl: item.uri,
                                    filename: item.filename || ""
                                  }))
                                  .map((item) => ({ uri: item.uri, filename: item.filename })),
                                Math.max(0, (msg.attachments || [])
                                  .filter((item) => isImageAttachment({
                                    kind: item.kind,
                                    mime: item.mime || "",
                                    dataUrl: item.uri,
                                    filename: item.filename || ""
                                  }))
                                  .findIndex((item) => item.id === attachment.id))
                              )}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                onCopyAttachmentUri(attachment.uri);
                              }}
                              title="点击查看，右键复制图片数据"
                            >
                              <img className="opencode-msg-image" src={attachment.uri} alt={attachment.filename || "attachment"} />
                            </button>
                          );
                        }
                        return (
                          <button
                            key={attachment.id}
                            type="button"
                            className="opencode-msg-file-btn"
                            onClick={() => onOpenAttachment(attachment.uri, attachment.filename, attachment.mime)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              onCopyAttachmentUri(attachment.uri);
                            }}
                            title={attachment.filename || attachment.mime || "附件"}
                          >
                            <span className="opencode-msg-file-name">{attachment.filename || "attachment"}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {msg.content.trim() ? (
                    shouldCollapseMessage(msg.content) ? (
                      <details className="opencode-msg-collapsible">
                        <summary className="opencode-msg-collapsible-summary">
                          <span className="opencode-msg-collapsible-preview">
                            {renderMarkdown(collapsePreview(msg.content))}
                          </span>
                          <span className="opencode-msg-collapsible-toggle">展开全文</span>
                        </summary>
                        <div className="opencode-msg-collapsible-body">
                          {renderMarkdown(msg.content)}
                        </div>
                      </details>
                    ) : renderMarkdown(msg.content)
                  ) : null}
                </div>
              ) : null}
              {isAssistant && detailsError ? (
                <div className="small" style={{ color: "var(--danger)", marginTop: "var(--gt-space-2)" }}>
                  {detailsError}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

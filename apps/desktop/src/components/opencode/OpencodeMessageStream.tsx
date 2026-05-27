import type { CSSProperties } from "react";
import { MarkdownLite } from "../common/MarkdownLite";
import { OpencodeExecutionPartView, type OpencodeToolFileTarget } from "./OpencodeExecutionPartView";
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
        key: `${last.key}:${group.key}`,
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
    key: `${previous.key}:${next.key}`,
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
  onOpenTaskSession: (sessionId: string, titleHint?: string) => void;
  onOpenWorkspacePath: (absolutePath: string, line?: number) => void;
  onOpenToolFile: (target: OpencodeToolFileTarget) => void;
  onPreviewImageGroup: (images: OpencodePreviewImage[], index: number) => void;
  onCopyAttachmentUri: (uri: string) => void;
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
  onOpenTaskSession,
  onOpenWorkspacePath,
  onOpenToolFile,
  onPreviewImageGroup,
  onCopyAttachmentUri
}: OpencodeMessageStreamProps) {
  const latestAssistantId = [...messages].reverse().find((row) => row.role === "assistant")?.id || "";
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
              {isAssistant && detailsLoading && liveParts.length <= 0 ? (
                <div className="opencode-msg-meta">
                  {detailsLoading ? <span className="small muted">加载中…</span> : null}
                </div>
              ) : null}
              {isAssistant ? (
                hasTimeline ? (
                  <div className="opencode-assistant-timeline">
                    {(() => {
                      const activeReasoningPartId = isStreaming
                        ? [...renderParts]
                          .reverse()
                          .find((part) => String((part as { type?: string }).type || "") === "reasoning")?.id || ""
                        : "";

                      return timelineGroups.map((group, index) => {
                        if (group.kind === "context") {
                          const counts = summarizeOpencodeContextToolCounts(group.parts);
                          const progress = summarizeOpencodeContextProgress(group.parts);
                          const summary = summarizeContextCounts(counts) || "已收集上下文";
                          return (
                            <details
                              key={`${msg.id}:${group.key}`}
                              className="opencode-exec-context"
                              open={isStreaming || progress.active}
                            >
                              <summary className="opencode-exec-context-head">
                                <strong className={isStreaming || progress.active ? "opencode-live-text" : ""}>
                                  {isStreaming || progress.active ? "探索中" : "已探索"}
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

                          return (
                            <details key={`${msg.id}:${group.key}`} className={activeThink ? "opencode-think-card is-active" : "opencode-think-card"}>
                              <summary className="opencode-think-card-summary">
                                <span className="opencode-think-label">
                                  <span className="opencode-think-spark" aria-hidden="true" />
                                  Think
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
                                <MarkdownLite source={text} onOpenWorkspacePath={onOpenWorkspacePath} />
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
                              <MarkdownLite source={text} onOpenWorkspacePath={onOpenWorkspacePath} />
                              {isStreaming && index === timelineGroups.length - 1 ? <span className="opencode-stream-caret" aria-label="running" /> : null}
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
                    <MarkdownLite source={fallbackReply} onOpenWorkspacePath={onOpenWorkspacePath} />
                    {isStreaming ? <span className="opencode-stream-caret" aria-label="running" /> : null}
                  </div>
                ) : (
                  <div className="opencode-thinking-wrap">
                    <div className="opencode-thinking">
                      <span />
                      <span />
                      <span />
                      <em>Thinking</em>
                    </div>
                  </div>
                )
              ) : msg.content.trim() || (msg.attachments && msg.attachments.length > 0) ? (
                <div className="opencode-msg-body">
                  {msg.attachments && msg.attachments.length > 0 ? (
                    <div className="opencode-msg-attachments">
                      {msg.attachments.map((image, imageIndex) => (
                        <button
                          key={image.id}
                          type="button"
                          className="opencode-msg-image-btn"
                          onClick={() => onPreviewImageGroup(
                            msg.attachments?.map((item) => ({ uri: item.uri, filename: item.filename })) || [],
                            imageIndex
                          )}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            onCopyAttachmentUri(image.uri);
                          }}
                          title="点击查看，右键复制图片数据"
                        >
                          <img className="opencode-msg-image" src={image.uri} alt={image.filename || "attachment"} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {msg.content.trim() ? <MarkdownLite source={msg.content} onOpenWorkspacePath={onOpenWorkspacePath} /> : null}
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

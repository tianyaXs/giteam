import type { CSSProperties } from "react";
import { MarkdownLite } from "../common/MarkdownLite";
import { OpencodeExecutionPartView } from "./OpencodeExecutionPartView";
import {
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
  onPreviewImageGroup,
  onCopyAttachmentUri
}: OpencodeMessageStreamProps) {
  const latestAssistantId = [...messages].reverse().find((row) => row.role === "assistant")?.id || "";

  return (
    <div className="gt-chat-stream">
      {sessionLoading ? (
        <div className="opencode-session-loading small muted">加载会话中…</div>
      ) : messages.length === 0 ? null : (
        renderedMessages.map((msg) => {
          const isAssistant = msg.role === "assistant";
          const isStreaming = isAssistant && msg.id === activeStreamingAssistantId && msg.id === latestAssistantId && activeSessionBusy;
          const serverMid = (serverMessageIdByLocalId[msg.id] || "").trim();
          const detail = isAssistant ? (detailsByMessageId[msg.id] || null) : null;
          const fetchedParts = Array.isArray(detail?.parts) ? (detail.parts as OpencodeDetailedPart[]) : [];
          const liveParts = serverMid ? (livePartsByServerMessageId[serverMid] || []) : [];
          const detailParts = liveParts.length > 0 ? liveParts : fetchedParts;
          const renderParts = detailParts.filter(isOpencodeRenderablePart);
          const timelineGroups = buildOpencodeAssistantRenderGroups(renderParts);
          const hasTimeline = timelineGroups.length > 0;
          const fallbackReply = (buildOpencodeReplyMarkdownFromParts(detailParts) || msg.content || "").trim();

          return (
            <div key={msg.id} className={isAssistant ? "opencode-msg opencode-msg-assistant" : "opencode-msg opencode-msg-user"}>
              {isAssistant && detailsLoadingByMessageId[msg.id] && liveParts.length <= 0 ? (
                <div className="opencode-msg-meta">
                  {detailsLoadingByMessageId[msg.id] ? <span className="small muted">加载中…</span> : null}
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
                          return (
                            <div key={`${msg.id}:${group.key}`} className="opencode-exec-context">
                              <div className="opencode-exec-context-head">
                                <strong className={isStreaming || progress.active ? "opencode-live-text" : ""}>
                                  {isStreaming || progress.active ? "Gathering Context" : "Context"}
                                </strong>
                                <span className="small muted">
                                  {progress.detail
                                    ? `${progress.mode} · ${progress.detail} · ${counts.read} read · ${counts.search} search · ${counts.list} list`
                                    : `${counts.read} read · ${counts.search} search · ${counts.list} list`}
                                </span>
                              </div>
                              <div className="opencode-exec-list">
                                {group.parts.map((part, partIndex) => (
                                  <OpencodeExecutionPartView
                                    key={`${group.key}:${partIndex}`}
                                    part={part}
                                    shellToolPartsExpanded={shellToolPartsExpanded}
                                    editToolPartsExpanded={editToolPartsExpanded}
                                    onOpenTaskSession={onOpenTaskSession}
                                  />
                                ))}
                              </div>
                            </div>
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
                            .split(/\n+/)
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
                                <MarkdownLite source={text} />
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
                              <MarkdownLite source={text} />
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
                          />
                        );
                      });
                    })()}
                  </div>
                ) : fallbackReply ? (
                  <div className={isStreaming ? "opencode-msg-body opencode-msg-body-streaming" : "opencode-msg-body"}>
                    <MarkdownLite source={fallbackReply} />
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
                  {msg.content.trim() ? <MarkdownLite source={msg.content} /> : null}
                </div>
              ) : null}
              {isAssistant && detailsErrorByMessageId[msg.id] ? (
                <div className="small" style={{ color: "var(--danger)", marginTop: "var(--gt-space-2)" }}>
                  {detailsErrorByMessageId[msg.id]}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

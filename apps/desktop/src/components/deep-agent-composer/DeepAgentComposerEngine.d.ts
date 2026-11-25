import type { MotionOptions, MotionController } from "./motion-runtime";

export type DeepAgentThinkingValue = "simple" | "medium" | "deep";

export type DeepAgentContextBlock = {
  name: string;
  tokens: number;
  kind?: string;
  source?: string;
};

export type DeepAgentContextUsage = {
  context_window?: number;
  projected_request_tokens?: number;
  measured_prompt_tokens?: number;
  estimated_prompt_tokens?: number;
  last_request_prompt_tokens?: number;
  compaction_threshold?: number;
  cache_hit_tokens?: number;
  cache_miss_tokens?: number;
  cache_hit_ratio?: number;
  blocks?: DeepAgentContextBlock[];
};

export type DeepAgentComposerAttachment = {
  id: string;
  name: string;
  kind: string;
  mime?: string;
  extractedText?: string;
  sourcePath?: string;
};

/** 宿主注入的引擎内附件条数据模型（宿主附件列表的投影）。 */
export type DeepAgentComposerAttachmentItem = {
  id: string;
  name: string;
  kind: "image" | "text" | "file";
  mime?: string;
  size?: number;
  dataUrl?: string;
  extractedText?: string;
  sourcePath?: string;
};

/** 引擎粘贴/拖入成功受理的文件附件；展示统一交给宿主预览层。 */
export type DeepAgentComposerAddedAttachment = {
  id: string;
  name: string;
  kind: "image" | "text" | "file";
  mime?: string;
  size?: number;
  source?: string;
  status: "processing";
  /** 原始/编码正文 dataUrl；宿主预览与提交共用，避免首帧空白与二次读盘。 */
  dataUrl?: string;
};

export type DeepAgentComposerOptions = MotionOptions & {
  /**
   * Host-owned async text extraction for composer-side documents.
   * Keeps preview content and submit prompt content on one shared pipeline
   * instead of duplicating parser logic inside the Shadow DOM engine.
   */
  extractAttachmentText?: (
    attachment: DeepAgentComposerAttachment
  ) => Promise<string | null>;
  /**
   * Host-owned async thumbnail resolution for composer-side documents.
   * The engine stays presentation-only: it renders whatever PNG dataUrl the
   * host resolves (macOS QuickLook today), falling back to text lines itself.
   */
  resolveAttachmentThumbnail?: (
    attachment: DeepAgentComposerAttachment
  ) => Promise<string | null>;
  /**
   * Engine-owned file ingestion reports accepted attachments to the host.
   * The host owns all preview rendering; the engine stays text/input only.
   */
  onAttachmentsAdded?: (items: DeepAgentComposerAddedAttachment[]) => void;
  /** Host removes a failed placeholder and may surface its own error state. */
  onAttachmentFailed?: (id: string, message: string) => void;
  /**
   * Host attachment list is the single source of truth for limits and
   * submit availability; the engine never keeps its own attachment state.
   * When provided, the engine renders the official in-composer strip from
   * this projection instead of the standalone `attachmentsCount` fallback.
   */
  attachments?: DeepAgentComposerAttachmentItem[];
  /** Host removes one attachment from its single-source list. */
  onAttachmentRemove?: (id: string) => void;
  value?: DeepAgentThinkingValue;
  onValueChange?: (value: DeepAgentThinkingValue) => void;
  disabled?: boolean;
  models?: string[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  busy?: boolean;
  stopping?: boolean;
  onStop?: () => void;
  /** Active permission preset: `default` | `auto_review` | `full_access`. */
  permission?: string;
  onPermissionChange?: (permission: string) => void;
  /**
   * Host-owned Full Access risk confirm (light-DOM Dialog).
   * Engine awaits this before applying `full_access`; return true to proceed.
   */
  requestFullAccessConfirm?: () => Promise<boolean>;
  placeholder?: string;
  draftText?: string;
  draftTextKey?: number | string;
  /** Engine text edits flow back to the host draft store (history/slash state). */
  onDraftChange?: (text: string) => void;
  themeTokens?: Record<string, string>;
  contextUsage?: DeepAgentContextUsage | null;
  contextUsageFallbackTokens?: number;
  onSubmit?: (message: {
    text: string;
    model: string;
    thinking: DeepAgentThinkingValue;
    attachments: {
      id: string;
      name: string;
      kind: string;
      status: string;
      dataUrl?: string;
      extractedText?: string;
      originalPath?: string;
      mime?: string;
    }[];
    skills: unknown[];
    mentions: unknown[];
    permission: string;
  }) => void;
};

export function mountDeepAgentComposer(
  target: HTMLElement,
  options?: DeepAgentComposerOptions
): Omit<MotionController, "update"> & {
  update(options: DeepAgentComposerOptions): void;
};

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

export type DeepAgentComposerOptions = MotionOptions & {
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

import type { AgentThinkingLevel } from "../../lib/agentComposerSettings";
import type { AgentAttachment } from "../../lib/imageAttachments";
import {
  autoAcceptFromPermissionPreset,
  parseAgentPermissionPreset,
  permissionPresetFromAutoAccept,
  type AgentPermissionPreset
} from "../../lib/agentPermissionPresets";
import {
  agentPromptTokens,
  type AgentChatUsage,
  type ContextBreakdown
} from "../../lib/agentSessions";
import type {
  DeepAgentComposerOptions,
  DeepAgentContextUsage,
  DeepAgentThinkingValue
} from "./DeepAgentComposerEngine";

export type { AgentPermissionPreset };

/** Giteam 多档 → Deep Agent 三档。 */
export function toDeepAgentThinking(level: AgentThinkingLevel): DeepAgentThinkingValue {
  if (level === "medium") return "medium";
  if (level === "high" || level === "xhigh" || level === "max") return "deep";
  return "simple";
}

/** Deep Agent 三档 → 当前模型允许的最接近 Giteam 档。 */
export function fromDeepAgentThinking(
  value: DeepAgentThinkingValue,
  allowed: AgentThinkingLevel[]
): AgentThinkingLevel {
  const pick = (candidates: AgentThinkingLevel[]): AgentThinkingLevel => {
    for (const item of candidates) {
      if (allowed.includes(item)) return item;
    }
    return allowed[0] || "off";
  };
  if (value === "medium") return pick(["medium", "low", "high"]);
  if (value === "deep") return pick(["high", "xhigh", "max", "medium"]);
  return pick(["low", "minimal", "off", "none", "medium"]);
}

/** Giteam preset → Deep Agent preset 键。 */
export function toDeepAgentPermission(
  presetOrAuto: AgentPermissionPreset | boolean
): string {
  if (typeof presetOrAuto === "boolean") {
    return permissionPresetFromAutoAccept(presetOrAuto);
  }
  return parseAgentPermissionPreset(presetOrAuto);
}

/** Deep Agent preset / option id → Giteam preset。 */
export function fromDeepAgentPermissionPreset(permission: string): AgentPermissionPreset {
  return parseAgentPermissionPreset(permission);
}

/** Deep Agent preset → 是否视为 autoAccept（兼容旧布尔路径）。 */
export function fromDeepAgentPermission(permission: string): boolean {
  return autoAcceptFromPermissionPreset(parseAgentPermissionPreset(permission));
}

export function toDeepAgentContextUsage(
  usage: AgentChatUsage | null | undefined,
  breakdown: ContextBreakdown | null | undefined,
  contextWindow: number | null | undefined
): DeepAgentContextUsage | null {
  const billed = breakdown?.billedPrompt ?? agentPromptTokens(usage);
  const window = contextWindow && contextWindow > 0 ? Math.floor(contextWindow) : undefined;
  if (!usage && !breakdown && !window) return null;

  const blocks = (breakdown?.categories ?? [])
    .filter((item) => item.estimatedTokens > 0)
    .map((item) => ({
      name: item.label,
      tokens: item.estimatedTokens,
      kind: item.id,
      source: item.id
    }));

  const cacheHit = usage?.cacheRead ?? 0;
  const cacheMiss = (usage?.input ?? 0) + (usage?.cacheWrite ?? 0);
  const cacheTotal = cacheHit + cacheMiss;

  return {
    context_window: window,
    projected_request_tokens: billed,
    measured_prompt_tokens: billed,
    estimated_prompt_tokens: breakdown?.estimatedTotal ?? billed,
    last_request_prompt_tokens: billed > 0 ? billed : undefined,
    cache_hit_tokens: cacheHit > 0 ? cacheHit : undefined,
    cache_miss_tokens: cacheMiss > 0 ? cacheMiss : undefined,
    cache_hit_ratio: cacheTotal > 0 ? cacheHit / cacheTotal : undefined,
    blocks: blocks.length > 0 ? blocks : undefined
  };
}

export function deepAgentAttachmentsToGiteam(
  attachments: NonNullable<Parameters<NonNullable<DeepAgentComposerOptions["onSubmit"]>>[0]["attachments"]>
): AgentAttachment[] {
  const out: AgentAttachment[] = [];
  for (const item of attachments) {
    if (item.status && item.status !== "ready") continue;
    const dataUrl = item.dataUrl;
    if (!dataUrl) continue;
    const kind = item.kind === "image" ? "image" : "file";
    out.push({
      id: item.id,
      kind,
      filename: item.name || (kind === "image" ? "image.png" : "attachment"),
      mime: item.mime || (kind === "image" ? "image/png" : "application/octet-stream"),
      dataUrl
    });
  }
  return out;
}

/** 把宿主主题 token 映射进 Shadow DOM。 */
export function readHostThemeTokens(host?: HTMLElement | null): Record<string, string> {
  const style = getComputedStyle(host ?? document.documentElement);
  const read = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    "--theme-accent": read("--primary", "#111827"),
    "--theme-accent-hover": read("--primary", "#000000"),
    "--theme-bg": read("--background", "#FFFFFF"),
    "--theme-sidebar": read("--sidebar", read("--muted", "#F9F8F6")),
    "--theme-elevated": read("--card", read("--background", "#FFFFFF")),
    "--theme-fg": read("--foreground", "#1F2937"),
    "--theme-text-secondary": read("--muted-foreground", "#707784"),
    "--theme-border": read("--border", "#E6E8EC"),
    "--theme-hover": read("--accent", "#F4F4F6"),
    "--theme-selection": read("--accent", "#DCEBFE")
  };
}

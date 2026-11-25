import type { AgentThinkingLevel } from "../../lib/agentComposerSettings";
import { isImageAttachment, type AgentAttachment } from "../../lib/imageAttachments";
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
  DeepAgentComposerAttachmentItem,
  DeepAgentComposerOptions,
  DeepAgentContextUsage,
  DeepAgentThinkingValue
} from "./DeepAgentComposerEngine";

export type { AgentPermissionPreset };

/** 宿主附件 → 引擎内附件条投影（单一渲染源，仅派生展示字段）。 */
export function toDeepAgentAttachmentItems(
  attachments: AgentAttachment[]
): DeepAgentComposerAttachmentItem[] {
  return attachments.map((item) => ({
    id: item.id,
    name: item.filename,
    kind: isImageAttachment(item) ? "image" : "file",
    mime: item.mime,
    dataUrl: item.dataUrl,
    sourcePath: item.sourcePath
  }));
}

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

/** 从 dataUrl 解码文本正文；给 composer 预览与提交兜底共用，保持同一份实现。 */
export function decodeTextAttachmentDataUrl(dataUrl: string): string | null {
  const match = /^data:[^;,]*(?:;charset=[^;,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || "").trim());
  if (!match) return null;
  try {
    const binary = atob(match[1].replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    if (bytes.length === 0) return null;
    // pdf/office 等二进制只看首字节魔数，避免把垃圾解码成“预览正文”。
    if (bytes[0] === 0x25 && bytes[1] === 0x50) return null;
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return null;
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function encodeTextAttachmentDataUrl(text: string, mime = "text/plain"): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime || "text/plain"};base64,${btoa(binary)}`;
}

export function deepAgentAttachmentsToGiteam(
  attachments: NonNullable<Parameters<NonNullable<DeepAgentComposerOptions["onSubmit"]>>[0]["attachments"]>
): AgentAttachment[] {
  const out: AgentAttachment[] = [];
  for (const item of attachments) {
    if (item.status && item.status !== "ready") continue;
    const kind = item.kind === "image" ? "image" : "file";
    const mime = item.mime || (kind === "image" ? "image/png" : "application/octet-stream");
    const sourcePath = String(item.originalPath || "").trim();
    let dataUrl = String(item.dataUrl || "").trim();
    let dataText: string | null = null;
    if (dataUrl) {
      dataText = decodeTextAttachmentDataUrl(dataUrl);
    } else if (item.extractedText) {
      // 文本附件常只有 extractedText；没有 dataUrl 时编成 text data URL，避免提交时静默丢弃。
      dataUrl = encodeTextAttachmentDataUrl(item.extractedText, mime.startsWith("text/") ? mime : "text/plain");
      dataText = item.extractedText;
    }
    if (!dataUrl && !sourcePath) continue;
    out.push({
      id: item.id,
      kind,
      filename: item.name || (kind === "image" ? "image.png" : "attachment"),
      mime,
      dataUrl,
      ...(dataText != null && dataText.trim() ? { dataText } : {}),
      ...(sourcePath ? { sourcePath } : {})
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

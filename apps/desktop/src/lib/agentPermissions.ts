import type { AgentInteraction } from "./agent/client";

/** UI 层对审批的回复语义；发送时映射为 pi wire 的 AgentInteractionReply。 */
export type AgentPermissionReply = "once" | "always" | "reject";

/** pi 原生 permission 交互（kind === "permission"）。input 已在后端脱敏。 */
export type PermissionInteraction = Extract<AgentInteraction, { kind: "permission" }>;

/** 审批卡片展示视图：从 pi 原生 input 派生目标（bash→command，写类→path）。 */
export type PermissionInteractionView = {
  tool: string;
  risk: string;
  target: string;
};

/**
 * 从 pi 原生 permission 交互提取展示信息，避免在视图层散落 input 解析，
 * 也不再套用旧的 permission/patterns 模型。
 */
export function describePermissionInteraction(
  interaction: PermissionInteraction
): PermissionInteractionView {
  const input = (interaction.input || {}) as Record<string, unknown>;
  const target =
    (typeof input.command === "string" && input.command.trim()) ||
    (typeof input.url === "string" && input.url.trim()) ||
    (typeof input.path === "string" && input.path.trim()) ||
    (typeof input.selector === "string" && input.selector.trim()) ||
    "";
  return {
    tool: interaction.tool || "tool",
    risk: interaction.risk || "",
    target,
  };
}

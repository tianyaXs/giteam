/** 对齐 dsh：permission preset = sandbox + approval 捆。 */

export type AgentPermissionPreset = "default" | "auto_review" | "full_access";

export const AGENT_PERMISSION_PRESETS: AgentPermissionPreset[] = [
  "default",
  "auto_review",
  "full_access"
];

export const AGENT_PERMISSION_PRESET_LABELS: Record<AgentPermissionPreset, string> = {
  default: "请求批准",
  auto_review: "替我审批",
  full_access: "完全访问"
};

export const AGENT_PERMISSION_PRESET_DESCRIPTIONS: Record<AgentPermissionPreset, string> = {
  default: "工作区内可写；敏感操作需你确认。",
  auto_review: "工作区内可写；自动通过工具授权。",
  full_access: "放开工作区围栏，并自动通过工具授权。"
};

export function parseAgentPermissionPreset(input: unknown): AgentPermissionPreset {
  const normalized = String(input || "").trim().toLowerCase();
  if (
    normalized === "auto"
    || normalized === "auto_review"
    || normalized === "auto-review"
  ) {
    return "auto_review";
  }
  if (
    normalized === "full"
    || normalized === "full_access"
    || normalized === "full-access"
    || normalized === "danger-full-access"
    || normalized === "danger_full_access"
  ) {
    return "full_access";
  }
  return "default";
}

export function permissionPresetFromAutoAccept(autoAccept: boolean): AgentPermissionPreset {
  return autoAccept ? "auto_review" : "default";
}

export function autoAcceptFromPermissionPreset(preset: AgentPermissionPreset): boolean {
  return preset === "auto_review" || preset === "full_access";
}

export function loadPermissionPreset(
  key: string,
  legacyAutoAcceptKey: string,
  fallback: AgentPermissionPreset = "default"
): AgentPermissionPreset {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw != null && String(raw).trim()) return parseAgentPermissionPreset(raw);
  } catch {
    // ignore
  }
  try {
    const legacy = window.localStorage.getItem(legacyAutoAcceptKey);
    if (legacy === "1" || legacy === "true") return "auto_review";
    if (legacy === "0" || legacy === "false") return "default";
  } catch {
    // ignore
  }
  return fallback;
}

export function savePermissionPreset(key: string, preset: AgentPermissionPreset): void {
  try {
    window.localStorage.setItem(key, preset);
  } catch {
    // ignore
  }
}

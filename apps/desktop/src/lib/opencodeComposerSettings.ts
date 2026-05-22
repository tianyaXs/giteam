export type OpencodeComposerAgentName = "build" | "plan";
export type OpencodeThinkingLevel = "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: "allow" | "ask" | "deny";
};

export const OPENCODE_COMPOSER_AGENT_OPTIONS: Array<{ name: OpencodeComposerAgentName; label: string; title: string }> = [
  { name: "build", label: "Build", title: "实现、修改、调试" },
  { name: "plan", label: "Plan", title: "先拆解方案" }
];

export const OPENCODE_THINKING_LEVELS: Array<{ value: OpencodeThinkingLevel; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "使用模型或 agent 默认配置" },
  { value: "none", label: "None", description: "尽量关闭推理" },
  { value: "minimal", label: "Minimal", description: "极低推理强度" },
  { value: "low", label: "Low", description: "低推理强度" },
  { value: "medium", label: "Medium", description: "均衡推理强度" },
  { value: "high", label: "High", description: "高推理强度" },
  { value: "xhigh", label: "XHigh", description: "极高推理强度" },
  { value: "max", label: "Max", description: "模型允许的最大推理" }
];

export function isComposerAgentName(value: string): value is OpencodeComposerAgentName {
  return value === "build" || value === "plan";
}

export function normalizeComposerAgentName(raw: unknown): OpencodeComposerAgentName {
  const value = String(raw || "").trim().toLowerCase();
  return isComposerAgentName(value) ? value : "build";
}

export function normalizeThinkingLevel(value: unknown): OpencodeThinkingLevel {
  const normalized = String(value || "").trim().toLowerCase();
  return OPENCODE_THINKING_LEVELS.some((item) => item.value === normalized) ? (normalized as OpencodeThinkingLevel) : "auto";
}

export function allowAllPermissionRules(): OpencodePermissionRule[] {
  return [{ permission: "*", pattern: "*", action: "allow" }];
}

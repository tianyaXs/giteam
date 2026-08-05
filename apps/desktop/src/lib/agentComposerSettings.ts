export type ComposerAgentName = "build" | "plan";

/** UI / 存储用档位；发给 Pi 时经 `toPiThinkingLevel` 映射。 */
export type AgentThinkingLevel =
  | "auto"
  | "off"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type AgentPermissionRule = {
  permission: string;
  pattern: string;
  action: "allow" | "ask" | "deny";
};

export type AgentModelThinkingCapability = {
  reasoning?: boolean;
  supportsXhigh?: boolean;
};

export const AGENT_COMPOSER_AGENT_OPTIONS: Array<{
  name: ComposerAgentName;
  label: string;
  title: string;
}> = [
  { name: "build", label: "Build", title: "写代码" },
  { name: "plan", label: "Plan", title: "出方案" }
];

export const AGENT_THINKING_LEVELS: Array<{
  value: AgentThinkingLevel;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { value: "auto", label: "自动", shortLabel: "自动", description: "默认" },
  { value: "off", label: "关闭", shortLabel: "关", description: "不推理" },
  { value: "minimal", label: "极低", shortLabel: "极低", description: "最快" },
  { value: "low", label: "低", shortLabel: "低", description: "轻量" },
  { value: "medium", label: "中", shortLabel: "中", description: "均衡" },
  { value: "high", label: "高", shortLabel: "高", description: "深入" },
  { value: "xhigh", label: "极高", shortLabel: "极高", description: "最强" }
];

/** Plan 模式：只读探索 + 提问/待办；禁止写文件与执行命令。 */
export const PLAN_ENABLED_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "question",
  "todowrite"
] as const;

const BUILD_MODE_APPEND = [
  "# Agent mode: Build",
  "You are in Build mode. Implement, modify, and debug the codebase.",
  "Prefer the smallest correct change. Use write/edit/bash when needed to finish the task."
].join("\n");

const PLAN_MODE_APPEND = [
  "# Agent mode: Plan",
  "You are in Plan mode. Explore the codebase and produce a clear, actionable plan.",
  "Do NOT modify, edit, or delete files. Do NOT run mutating shell commands (installs, builds that write artifacts, git writes, etc.).",
  "Use read/search tools and ask clarifying questions when requirements are ambiguous.",
  "End with a concrete implementation plan the user can approve before switching to Build."
].join("\n");

export function isComposerAgentName(value: string): value is ComposerAgentName {
  return value === "build" || value === "plan";
}

export function normalizeComposerAgentName(raw: unknown): ComposerAgentName {
  const value = String(raw || "").trim().toLowerCase();
  return isComposerAgentName(value) ? value : "build";
}

export function normalizeThinkingLevel(value: unknown): AgentThinkingLevel {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "none") return "off";
  if (normalized === "max") return "xhigh";
  if (AGENT_THINKING_LEVELS.some((item) => item.value === normalized)) {
    return normalized as AgentThinkingLevel;
  }
  return "auto";
}

export function thinkingLevelMeta(level: AgentThinkingLevel) {
  const normalized = normalizeThinkingLevel(level);
  return (
    AGENT_THINKING_LEVELS.find((item) => item.value === normalized)
    || AGENT_THINKING_LEVELS[0]
  );
}

/** 当前模型可选的推理档位（含 auto）。非推理模型仅 auto/off。 */
export function thinkingLevelsForModel(
  model?: AgentModelThinkingCapability | null
): AgentThinkingLevel[] {
  if (!model?.reasoning) return ["auto", "off"];
  const levels: AgentThinkingLevel[] = ["auto", "off", "minimal", "low", "medium", "high"];
  if (model.supportsXhigh) levels.push("xhigh");
  return levels;
}

export function clampThinkingLevelToModel(
  level: AgentThinkingLevel,
  model?: AgentModelThinkingCapability | null
): AgentThinkingLevel {
  const normalized = normalizeThinkingLevel(level);
  const allowed = thinkingLevelsForModel(model);
  if (allowed.includes(normalized)) return normalized;
  return allowed.includes("auto") ? "auto" : allowed[0] || "off";
}

/** 映射为 Pi `ThinkingLevel` 字符串；auto 返回 undefined（不传/不改）。 */
export function toPiThinkingLevel(
  level: AgentThinkingLevel,
  model?: AgentModelThinkingCapability | null
): string | undefined {
  const clamped = clampThinkingLevelToModel(level, model);
  if (clamped === "auto") return undefined;
  if (clamped === "none" || clamped === "off") return "off";
  if (clamped === "max") {
    const allowed = thinkingLevelsForModel(model).filter((item) => item !== "auto");
    return allowed[allowed.length - 1] || "off";
  }
  return clamped;
}

export function composerAgentSessionOptions(agent: ComposerAgentName): {
  enabledTools?: string[];
  appendSystemPrompt: string;
} {
  if (agent === "plan") {
    return {
      enabledTools: [...PLAN_ENABLED_TOOLS],
      appendSystemPrompt: PLAN_MODE_APPEND
    };
  }
  return {
    appendSystemPrompt: BUILD_MODE_APPEND
  };
}

export function allowAllPermissionRules(): AgentPermissionRule[] {
  return [{ permission: "*", pattern: "*", action: "allow" }];
}

/** 徽章/菜单用短模型名：去掉 provider；仅超长时截断。 */
export function shortModelLabel(modelDisplayLabel: string, modelRef: string): string {
  const raw = (modelDisplayLabel || modelRef || "").trim();
  if (!raw) return "模型";
  const withoutProvider = raw.includes("/") ? raw.split("/").slice(1).join("/") : raw;
  return withoutProvider.length > 28 ? `${withoutProvider.slice(0, 26)}…` : withoutProvider;
}

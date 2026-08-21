/**
 * 将后端 subagent.* 事件投影到桌面端 toolCall(task) part 上。
 * 主会话 part 仍是 toolCall；额外字段供 SubagentRunCard 展开实时进程。
 */
import type { AgentDetailedPart } from "./agentSessions";
import { extractToolDetails, extractToolOutputText } from "./agent/toolPresentation";

export type SubagentChildEvent = {
  type?: string;
  messageId?: string;
  delta?: string;
  partial?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  index?: number;
  message?: { id?: string; parts?: Array<{ type?: string; text?: string }> } | string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

/** 只在 next 非空时覆盖，避免 tool.progress/completed 浅合并用空串冲掉已有标题。 */
function coalesceText(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return "";
}

function firstLine(text: string, max = 80): string {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean) || "";
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

/** 批并行子卡 id：`{parentToolCallId}:{index}`。 */
export function parseIndexedParentToolCallId(
  toolCallId: string
): { parentId: string; index: number } | null {
  const id = normalizeText(toolCallId);
  const split = id.lastIndexOf(":");
  if (split <= 0 || split >= id.length - 1) return null;
  const index = Number(id.slice(split + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  const parentId = id.slice(0, split);
  return parentId ? { parentId, index } : null;
}

function descriptionFromTaskEntry(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const row = entry as Record<string, unknown>;
  return coalesceText(row.description, row.title, row.name, firstLine(coalesceText(row.prompt)));
}

/** 从父 task 的 tasks[] / 顶层字段取第 index 个子任务标题。 */
export function extractTaskDescriptionFromParentInput(
  parent: AgentDetailedPart | null | undefined,
  index?: number
): string {
  if (!parent) return "";
  const input = ((parent as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>;
  const details = ((parent as { details?: Record<string, unknown> }).details || {}) as Record<string, unknown>;
  const tasks = Array.isArray(input.tasks)
    ? input.tasks
    : Array.isArray(details.tasks)
      ? details.tasks
      : null;
  if (tasks && typeof index === "number" && index >= 0 && index < tasks.length) {
    const fromTask = descriptionFromTaskEntry(tasks[index]);
    if (fromTask) return fromTask;
  }
  return extractTaskDescription(parent);
}

/** 父壳：带 tasks[] 的批并行 task 调用（子卡用 parent:index 单独渲染）。 */
export function isBatchParentTaskPart(part: AgentDetailedPart): boolean {
  if (normalizeText((part as { toolName?: string }).toolName) !== "task") return false;
  if (parseIndexedParentToolCallId(normalizeText((part as { toolCallId?: string }).toolCallId) || normalizeText((part as { id?: string }).id))) {
    return false;
  }
  const input = ((part as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>;
  const details = ((part as { details?: Record<string, unknown> }).details || {}) as Record<string, unknown>;
  const tasks = Array.isArray(input.tasks) ? input.tasks : Array.isArray(details.tasks) ? details.tasks : null;
  // 单元素 tasks[] 与顶层单任务等价（后端共用父 toolCallId），不当作批并行父壳。
  return Boolean(tasks && tasks.length > 1);
}

function partToolCallId(part: AgentDetailedPart): string {
  return (
    normalizeText((part as { toolCallId?: string }).toolCallId)
    || normalizeText((part as { id?: string }).id)
  );
}

function hasChildSession(part: AgentDetailedPart): boolean {
  const details = ((part as { details?: Record<string, unknown> }).details || {}) as Record<string, unknown>;
  return Boolean(
    coalesceText(
      (part as { childSessionId?: string }).childSessionId,
      details.childSessionId
    )
  );
}

function taskTimelineLength(part: AgentDetailedPart): number {
  const timeline = Array.isArray((part as { timeline?: AgentDetailedPart[] }).timeline)
    ? (part as { timeline: AgentDetailedPart[] }).timeline
    : [];
  return timeline.length;
}

function isHollowTaskPart(part: AgentDetailedPart): boolean {
  return !hasChildSession(part) && taskTimelineLength(part) === 0;
}

/**
 * 主时间线「子任务」行是否应该出现。
 * - 真批并行（tasks.length>1）父壳不占行
 * - 空壳父卡（无 childSession、无 timeline）若已有 parent:index 子卡则隐藏
 * - 从未启动就失败的校验空壳不占行
 */
export function isVisibleSubagentTaskPart(
  part: AgentDetailedPart,
  siblings: AgentDetailedPart[] = []
): boolean {
  if (normalizeText((part as { toolName?: string }).toolName) !== "task") return false;
  const id = partToolCallId(part);
  if (!id) return false;
  // 旁路记忆抽取曾误投影为 task；新路径已发 memory.extraction.*，旧卡仍隐藏。
  if (id.startsWith("asset-graph-extract-")) return false;
  const subagentType = normalizeText(
    (part as { subagentType?: string }).subagentType
    || String((((part as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>).subagent_type || "")
  ).toLowerCase();
  if (subagentType === "extract") return false;

  const indexedChildren = siblings.filter((candidate) => {
    const indexed = parseIndexedParentToolCallId(partToolCallId(candidate));
    return Boolean(indexed && indexed.parentId === id);
  });

  if (isBatchParentTaskPart(part)) {
    // 多任务父壳：有分卡后隐藏；尚无分卡时也不进列表（等子卡到达再显示）。
    return false;
  }

  // 父 toolCall 与 parent:index 并存时，只留子卡。
  if (!parseIndexedParentToolCallId(id) && indexedChildren.length > 0) {
    return false;
  }

  // 空壳（还在等 / 已废弃的父行）若同根已有带进度的子卡，去掉避免「两个同名进行中」。
  if (isHollowTaskPart(part) && indexedChildren.some((child) => !isHollowTaskPart(child))) {
    return false;
  }

  const status = normalizeText((part as { status?: string }).status).toLowerCase();
  const subagentStatus = normalizeText((part as { subagentStatus?: string }).subagentStatus).toLowerCase();
  const isError =
    Boolean((part as { isError?: boolean }).isError)
    || status === "error"
    || subagentStatus === "failed"
    || subagentStatus === "aborted"
    || subagentStatus === "error";
  const output = coalesceText(
    (part as { summary?: string }).summary,
    (part as { output?: string }).output
  );
  // 仅隐藏「从未真正启动」的校验空壳；有 description 的 abort/失败 task 冷启动也要显示，
  // 否则主时间线被滤空，重启后只剩用户气泡。
  if (
    isHollowTaskPart(part)
    && isError
    && !extractTaskDescription(part)
    && /tasks array must not be empty|task requires|subagent_type is required|unknown subagent_type/i.test(output)
  ) {
    return false;
  }
  if (
    isHollowTaskPart(part)
    && !isError
    && /tasks array must not be empty|task requires|subagent_type is required|unknown subagent_type/i.test(output)
  ) {
    return false;
  }
  if (isHollowTaskPart(part) && isError && !extractTaskDescription(part) && !output) {
    return false;
  }

  return true;
}

/** 从可见子任务列表里再压掉同 id / 空壳重复。 */
export function dedupeVisibleSubagentTaskParts(parts: AgentDetailedPart[]): AgentDetailedPart[] {
  const visible = parts.filter((part) => isVisibleSubagentTaskPart(part, parts));
  const richerTitles = new Set(
    visible
      .filter((part) => !isHollowTaskPart(part))
      .map((part) => resolveTaskCardTitle(part, parts) || extractTaskDescription(part))
      .filter(Boolean)
  );
  const seen = new Set<string>();
  const out: AgentDetailedPart[] = [];
  for (const part of visible) {
    const id = partToolCallId(part);
    if (id && seen.has(id)) continue;
    if (isHollowTaskPart(part)) {
      const title = resolveTaskCardTitle(part, parts) || extractTaskDescription(part);
      // 同名空壳 + 已有真实进度卡 → 渲染重复，丢掉空壳。
      if (title && richerTitles.has(title)) continue;
    }
    if (id) seen.add(id);
    out.push(part);
  }
  return out;
}

/** 从 input / 流式 inputRaw 里抠 description（LLM 参数可能尚未完全解析）。 */
export function extractTaskDescription(part: AgentDetailedPart): string {
  const input = ((part as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>;
  // 批并行 / 单元素 tasks：优先用对应条目的标题。
  const tasks = Array.isArray(input.tasks) ? input.tasks : null;
  if (tasks?.length) {
    const indexed = parseIndexedParentToolCallId(
      normalizeText((part as { toolCallId?: string }).toolCallId)
      || normalizeText((part as { id?: string }).id)
    );
    const entry = descriptionFromTaskEntry(
      tasks[indexed ? indexed.index : 0]
    );
    if (entry) return entry;
  }

  const fromFields = coalesceText(
    (part as { description?: string }).description,
    input.description,
    input.title,
    input.name
  );
  if (fromFields) return fromFields;

  const raw = normalizeText((part as { inputRaw?: string }).inputRaw);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const fromRaw = coalesceText(parsed.description, parsed.title, parsed.name);
      if (fromRaw) return fromRaw;
      const parsedTasks = Array.isArray(parsed.tasks) ? parsed.tasks : null;
      if (parsedTasks?.length) {
        const fromTask = descriptionFromTaskEntry(parsedTasks[0]);
        if (fromTask) return fromTask;
      }
      const prompt = coalesceText(parsed.prompt);
      if (prompt) return firstLine(prompt);
    } catch {
      const descMatch = raw.match(/"description"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (descMatch?.[1]) {
        try {
          return JSON.parse(`"${descMatch[1]}"`) as string;
        } catch {
          return descMatch[1];
        }
      }
    }
  }

  const prompt = coalesceText(
    (part as { subagentPrompt?: string }).subagentPrompt,
    input.prompt
  );
  return prompt ? firstLine(prompt) : "";
}

/**
 * 解析子卡标题：自身字段 → 同消息里父 task 的 tasks[i] → prompt 首行。
 * 避免批并行子卡（parent:index）在 childEvent 抢先建卡后一直显示「未命名」。
 */
export function resolveTaskCardTitle(
  part: AgentDetailedPart,
  siblings: AgentDetailedPart[] = []
): string {
  const own = extractTaskDescription(part);
  if (own) return own;
  const id =
    normalizeText((part as { toolCallId?: string }).toolCallId)
    || normalizeText((part as { id?: string }).id);
  const indexed = parseIndexedParentToolCallId(id);
  if (indexed) {
    const parent = siblings.find((candidate) => {
      const candidateId =
        normalizeText((candidate as { toolCallId?: string }).toolCallId)
        || normalizeText((candidate as { id?: string }).id);
      return candidateId === indexed.parentId;
    });
    const fromParent = extractTaskDescriptionFromParentInput(parent, indexed.index);
    if (fromParent) return fromParent;
    return `子任务 ${indexed.index + 1}`;
  }
  return "";
}

function upsertTimelinePart(
  timeline: AgentDetailedPart[],
  next: AgentDetailedPart
): AgentDetailedPart[] {
  const id = normalizeText((next as { id?: string }).id);
  if (!id) return [...timeline, next];
  const index = timeline.findIndex((part) => normalizeText((part as { id?: string }).id) === id);
  if (index < 0) return [...timeline, next];
  const copy = timeline.slice();
  copy[index] = { ...copy[index], ...next };
  return copy;
}

/** 把子 agent 事件映射为嵌套时间线条目（扁平 tool/text/reasoning）。 */
export function applySubagentChildEventToPart(
  part: AgentDetailedPart,
  childEvent: SubagentChildEvent
): AgentDetailedPart {
  const timeline = Array.isArray((part as { timeline?: AgentDetailedPart[] }).timeline)
    ? [...(part as { timeline: AgentDetailedPart[] }).timeline]
    : [];
  const type = normalizeText(childEvent.type);

  if (type === "tool.started" || type === "toolCall.started") {
    const toolCallId = normalizeText(childEvent.toolCallId) || `child-${timeline.length}`;
    const toolName = normalizeText(childEvent.toolName) || "tool";
    return {
      ...part,
      currentToolName: toolName,
      timeline: upsertTimelinePart(timeline, {
        id: toolCallId,
        type: "toolCall",
        toolCallId,
        toolName,
        status: "running",
        ...(childEvent.input !== undefined ? { input: childEvent.input } : {})
      })
    };
  }

  if (type === "tool.progress") {
    const toolCallId = normalizeText(childEvent.toolCallId);
    if (!toolCallId) return part;
    return {
      ...part,
      timeline: upsertTimelinePart(timeline, {
        id: toolCallId,
        type: "toolCall",
        toolCallId,
        toolName: normalizeText(childEvent.toolName),
        status: "running",
        ...(childEvent.output !== undefined
          ? {
              output: extractToolOutputText(childEvent.output),
              details: extractToolDetails(childEvent.output)
            }
          : {})
      })
    };
  }

  if (type === "tool.completed") {
    const toolCallId = normalizeText(childEvent.toolCallId);
    if (!toolCallId) return part;
    const isError = Boolean(childEvent.isError);
    return {
      ...part,
      timeline: upsertTimelinePart(timeline, {
        id: toolCallId,
        type: "toolCall",
        toolCallId,
        toolName: normalizeText(childEvent.toolName),
        status: isError ? "error" : "completed",
        isError,
        ...(childEvent.output !== undefined
          ? {
              output: extractToolOutputText(childEvent.output),
              details: extractToolDetails(childEvent.output)
            }
          : {})
      })
    };
  }

  if (type === "reasoning.delta") {
    return {
      ...part,
      childPhase: "responding"
    };
  }

  if (type === "message.delta" || type === "message.started") {
    return {
      ...part,
      childPhase: "responding"
    };
  }

  if (type === "message.completed") {
    return {
      ...part,
      childPhase: ""
    };
  }

  return part;
}

/** 历史消息里的 task toolCall：从 details/input 补齐 SubagentRunCard 字段。 */
export function enrichTaskToolPart(part: AgentDetailedPart): AgentDetailedPart {
  if (normalizeText((part as { toolName?: string }).toolName) !== "task") return part;
  const input = ((part as { input?: Record<string, unknown> }).input || {}) as Record<string, unknown>;
  const details = ((part as { details?: Record<string, unknown> }).details || {}) as Record<string, unknown>;
  const status = normalizeText((part as { status?: string }).status).toLowerCase();
  const description = extractTaskDescription(part);
  const subagentType = coalesceText(
    (part as { subagentType?: string }).subagentType,
    input.subagent_type,
    "plan"
  );
  const subagentPrompt = coalesceText(
    (part as { subagentPrompt?: string }).subagentPrompt,
    input.prompt,
    input.description
  );
  const childSessionId = coalesceText(
    (part as { childSessionId?: string }).childSessionId,
    details.childSessionId
  );
  const summary = coalesceText(
    (part as { summary?: string }).summary,
    status === "completed" || status === "error" ? (part as { output?: string }).output : ""
  );
  const toolCount =
    Number((part as { toolCount?: number }).toolCount ?? details.toolCount ?? 0) || 0;
  const elapsedMs =
    Number((part as { elapsedMs?: number }).elapsedMs ?? details.elapsedMs ?? 0) || 0;
  const startedAtMs =
    Number((part as { startedAtMs?: number }).startedAtMs ?? details.startedAtMs ?? 0) || 0;
  const outputText = coalesceText(summary, (part as { output?: string }).output);
  const aborted =
    /abort/i.test(outputText)
    || /中止|暂停|已停止|Tool execution aborted/i.test(outputText)
    || normalizeText((part as { subagentStatus?: string }).subagentStatus).toLowerCase() === "aborted";
  const subagentStatus = coalesceText(
    (part as { subagentStatus?: string }).subagentStatus,
    aborted ? "aborted" : status === "error" ? "failed" : status
  ) || "completed";

  const next: AgentDetailedPart = { ...part };
  // 只写非空字段，避免后续 tool.progress 的 enrich 用空串冲掉 subagent.started 的标题。
  if (description) (next as { description?: string }).description = description;
  if (subagentType) (next as { subagentType?: string }).subagentType = subagentType;
  if (subagentPrompt) (next as { subagentPrompt?: string }).subagentPrompt = subagentPrompt;
  if (childSessionId) (next as { childSessionId?: string }).childSessionId = childSessionId;
  if (summary) (next as { summary?: string }).summary = summary;
  if (toolCount > 0) (next as { toolCount?: number }).toolCount = toolCount;
  if (elapsedMs > 0) (next as { elapsedMs?: number }).elapsedMs = elapsedMs;
  if (startedAtMs > 0) (next as { startedAtMs?: number }).startedAtMs = startedAtMs;
  if (subagentStatus) (next as { subagentStatus?: string }).subagentStatus = subagentStatus;
  return next;
}

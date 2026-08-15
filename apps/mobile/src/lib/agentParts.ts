export type AgentDetailedPart = Record<string, unknown>;

export type AgentTodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
};

export type AgentChatMessage = {
  id: string;
  role: string;
  content: string;
  attachments?: Array<{ id: string; kind: "image"; uri: string; mime?: string; filename?: string }>;
};

export type AgentAssistantRenderGroup =
  | { kind: "context"; key: string; parts: AgentDetailedPart[] }
  | { kind: "reasoning"; key: string; parts: AgentDetailedPart[] }
  | { kind: "part"; key: string; part: AgentDetailedPart };

const GITEAM_DIAGNOSTIC_SEGMENT_RE = /\[giteam\]\s+(?:exec|done)\b.*?(?=(?:\[giteam\]\s+(?:exec|done)\b)|(?:retry failed: )|(?:curl failed with code )|\n|$)/gis;

function stripGiteamDiagnosticNoise(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(GITEAM_DIAGNOSTIC_SEGMENT_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toDisplayJson(input: unknown, maxLen = 2400): string {
  try {
    const raw = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    if (!raw) return "";
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}\n…(truncated)` : raw;
  } catch {
    return String(input ?? "");
  }
}

export function parseAgentTaskSessionId(part: AgentDetailedPart | undefined | null): string {
  if (!part) return "";
  const state = (part as any)?.state || {};
  const metadata = state?.metadata || {};
  const raw =
    String(metadata?.sessionId || metadata?.sessionID || "").trim() ||
    String((part as any)?.metadata?.sessionId || "").trim();
  if (raw) return raw;
  const output = typeof state?.output === "string" ? state.output : "";
  if (!output) return "";
  const m = output.match(/task_id:\s*(ses[^\s)]+)/i);
  return (m?.[1] || "").trim();
}

export function buildAgentMainLineMarkdownFromParts(parts: AgentDetailedPart[] | undefined | null): string {
  const rows = Array.isArray(parts) ? parts : [];
  const chunks: string[] = [];
  for (const p of rows) {
    if (!p) continue;
    const t = String((p as any)?.type || "");
    if (t !== "text") continue;
    const text = String((p as any)?.text ?? (p as any)?.part?.text ?? "").trim();
    if (text) chunks.push(text);
  }
  return stripGiteamDiagnosticNoise(chunks.join("\n\n"));
}

export function buildAgentImageAttachmentsFromParts(parts: AgentDetailedPart[] | undefined | null) {
  const rows = Array.isArray(parts) ? parts : [];
  const out: Array<{ id: string; kind: "image"; uri: string; mime?: string; filename?: string }> = [];
  rows.forEach((p, index) => {
    const part: any = p || {};
    const type = String(part.type || "");
    if (type !== "file") return;
    const mime = String(part.mime || "").trim();
    const url = String(part.url || part.source || "").trim();
    const filename = String(part.filename || "").trim();
    const image = mime.startsWith("image/") || url.startsWith("data:image/") || /\.(png|jpe?g|webp|gif|heic)$/i.test(filename);
    if (!image || !url) return;
    out.push({
      id: String(part.id || `image:${index}`),
      kind: "image",
      uri: url,
      mime: mime || undefined,
      filename: filename || undefined,
    });
  });
  return out;
}

export function mergeAgentMessageAttachments(prev: AgentChatMessage[] | undefined, next: AgentChatMessage[]) {
  const prevById = new Map<string, NonNullable<AgentChatMessage["attachments"]>>();
  (Array.isArray(prev) ? prev : []).forEach((msg) => {
    if (msg.role !== "user" || !msg.attachments?.length) return;
    if (msg.id) prevById.set(msg.id, msg.attachments);
  });
  return next.map((msg) => {
    if (msg.role !== "user" || msg.attachments?.length) return msg;
    // 仅按消息 id 合并附件，避免相同文案把上轮图片串到新消息。
    const attachments = prevById.get(msg.id);
    return attachments?.length ? { ...msg, attachments } : msg;
  });
}

export function isAgentRenderablePart(
  p: AgentDetailedPart | undefined | null,
  showReasoningSummaries = true,
): boolean {
  if (!p) return false;
  const t = String((p as any)?.type || "");
  if (t === "text") return !!String((p as any)?.text ?? "").trim();
  if (t === "reasoning") {
    // redacted（加密思考）无明文 text，仍需渲染占位卡，不能按空文本过滤。
    if ((p as any)?.redacted === true) return true;
    return showReasoningSummaries && !!String((p as any)?.text ?? "").trim();
  }
  if (t === "step-start" || t === "step-finish" || t === "patch") return false;
  if (t === "tool") {
    const tool = String((p as any)?.tool || "");
    if (tool === "todowrite") return false;
    if (tool === "question") {
      const status = String((p as any)?.state?.status || "").trim().toLowerCase();
      return status !== "pending" && status !== "running";
    }
    return true;
  }
  return false;
}

export function parseAgentTodoItems(input: unknown): AgentTodoItem[] {
  if (!Array.isArray(input)) return [];
  const items: AgentTodoItem[] = [];
  input.forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!row) return;
    const content = String(row.content ?? "").trim();
    const rawStatus = String(row.status ?? "pending").trim().toLowerCase();
    if (!content) return;
    const status: AgentTodoItem["status"] =
      rawStatus === "completed" || rawStatus === "cancelled" || rawStatus === "in_progress"
        ? rawStatus
        : "pending";
    items.push({
      id: String(row.id ?? `todo-${index + 1}`).trim() || `todo-${index + 1}`,
      content,
      status,
      priority: String(row.priority ?? "").trim() || undefined
    });
  });
  return items;
}

export function readAgentTodosFromPart(part: AgentDetailedPart | undefined | null): AgentTodoItem[] {
  if (!part || String((part as any)?.type || "") !== "tool") return [];
  if (String((part as any)?.tool || "") !== "todowrite") return [];
  const state = ((part as any)?.state || {}) as Record<string, unknown>;
  const metadata = ((part as any)?.metadata || state.metadata || {}) as Record<string, unknown>;
  const input = (state.input || {}) as Record<string, unknown>;
  const metaTodos = parseAgentTodoItems(metadata.todos);
  if (metaTodos.length > 0) return metaTodos;
  return parseAgentTodoItems(input.todos);
}

/** 与桌面端 isAgentContextTool 对齐：read/ls/find/grep 等进「已探索」。 */
export function isAgentContextTool(tool: string): boolean {
  return (
    tool === "read" ||
    tool === "glob" ||
    tool === "grep" ||
    tool === "search" ||
    tool === "list" ||
    tool === "ls" ||
    tool === "find"
  );
}

function normalizeToolText(value: unknown): string {
  return String(value || "").trim();
}

function readableSearchText(value: unknown): string {
  return normalizeToolText(value)
    .replace(/\\\./g, ".")
    .replace(/\\\//g, "/")
    .replace(/\\-/g, "-");
}

/** 过滤无意义通配符（如 *、星号星号/星号、./*、.），避免探索摘要里出现符号垃圾。 */
function wildcardOnly(value: string): boolean {
  const text = normalizeToolText(value).replace(/\s+/g, "");
  return text === "*" || text === "**/*" || text === "./*" || text === ".";
}

function meaningfulSearchText(value: unknown): string {
  const text = readableSearchText(value);
  return text && !wildcardOnly(text) ? text : "";
}

function searchDetailFromInput(input: Record<string, unknown>, title = ""): string {
  const candidates = [
    input?.description,
    input?.query,
    input?.search,
    input?.keyword,
    input?.text,
    input?.regex,
    input?.regexp,
    input?.pattern,
    input?.include,
    input?.glob,
    input?.filePattern,
    input?.filePath,
    input?.path,
    title
  ]
    .map((item) => meaningfulSearchText(item))
    .filter(Boolean);
  return candidates[0] || "";
}

export function summarizeAgentContextToolCounts(parts: AgentDetailedPart[] | undefined | null): {
  read: number;
  search: number;
  list: number;
} {
  const rows = Array.isArray(parts) ? parts : [];
  let read = 0;
  let search = 0;
  let list = 0;
  for (const p of rows) {
    if (String((p as any)?.type || "") !== "tool") continue;
    const tool = String((p as any)?.tool || "");
    if (tool === "read") read += 1;
    else if (tool === "glob" || tool === "grep" || tool === "search" || tool === "find") search += 1;
    else if (tool === "list" || tool === "ls") list += 1;
  }
  return { read, search, list };
}

export function summarizeAgentContextProgress(parts: AgentDetailedPart[] | undefined | null): {
  active: boolean;
  mode: string;
  detail: string;
} {
  const rows = Array.isArray(parts) ? parts : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const p = rows[i] as any;
    if (!p || String(p?.type || "") !== "tool") continue;
    const st = String(p?.state?.status || "").trim().toLowerCase();
    if (st !== "running" && st !== "pending" && st !== "deciding") continue;
    const tool = String(p?.tool || "").trim();
    const input = (p?.state?.input || {}) as Record<string, unknown>;
    const searchTool = tool === "grep" || tool === "find" || tool === "glob" || tool === "search";
    const subtitle = searchTool
      ? searchDetailFromInput(input, "")
      : normalizeToolText(input?.description || input?.pattern || input?.path || input?.command || "");
    const detail = searchTool && !subtitle ? "" : [tool, subtitle].filter(Boolean).join(" · ");
    const mode =
      tool === "read" ||
      tool === "ls" ||
      tool === "list" ||
      tool === "grep" ||
      tool === "find" ||
      tool === "glob" ||
      tool === "search"
        ? "读取"
        : tool === "write" || tool === "edit" || tool === "hashline_edit" || tool === "apply_patch"
          ? "写入"
          : "处理中";
    return { active: true, mode, detail };
  }
  return { active: false, mode: "", detail: "" };
}

/** 供 timeline 摘要复用：搜索类工具的可读目标（已滤通配符）。 */
export function agentSearchDetail(input: Record<string, unknown> | undefined | null, title = ""): string {
  return searchDetailFromInput((input || {}) as Record<string, unknown>, title);
}

export function mergeAgentStreamText(existingRaw: unknown, incomingRaw: unknown): string {
  const existing = String(existingRaw || "");
  const incoming = String(incomingRaw || "");
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (incoming === existing) return existing;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  if (existing.endsWith(incoming)) return existing;
  if (incoming.includes(existing)) return incoming;
  if (existing.includes(incoming)) return existing;
  return existing + incoming;
}

/** Merge consecutive assistant text chunks for one message (drop near-duplicate tails). */
export function mergeAssistantTextChunks(chunks: string[]): string {
  const out: string[] = [];
  for (const raw of chunks) {
    const next = String(raw || "").trim();
    if (!next) continue;
    const prev = out.join("\n\n").trim();
    if (!prev) {
      out.push(next);
      continue;
    }
    if (prev === next || prev.includes(next)) continue;
    if (next.includes(prev)) {
      out[out.length - 1] = next;
      continue;
    }
    out.push(next);
  }
  return out.join("\n\n").trim();
}

export function buildAgentReplyMarkdownFromParts(parts: AgentDetailedPart[] | undefined | null): string {
  const rows = Array.isArray(parts) ? parts : [];
  const out: string[] = [];
  for (const p of rows) {
    if (!p) continue;
    if (String((p as any)?.type || "") !== "text") continue;
    const text = String((p as any)?.text ?? "").trim();
    if (text) out.push(text);
  }
  return stripGiteamDiagnosticNoise(out.join("\n\n"));
}

export function buildAgentAssistantRenderGroups(parts: AgentDetailedPart[] | undefined | null): AgentAssistantRenderGroup[] {
  const rows = Array.isArray(parts) ? parts : [];
  const out: AgentAssistantRenderGroup[] = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i];
    const t = String((cur as any)?.type || "");
    const tool = String((cur as any)?.tool || "");
    if (t === "tool" && isAgentContextTool(tool)) {
      const batch: AgentDetailedPart[] = [cur];
      i += 1;
      while (i < rows.length) {
        const nxt = rows[i];
        const nt = String((nxt as any)?.type || "");
        const ntool = String((nxt as any)?.tool || "");
        if (nt === "tool" && isAgentContextTool(ntool)) {
          batch.push(nxt);
          i += 1;
          continue;
        }
        break;
      }
      const firstId = String((batch[0] as any)?.id || "");
      out.push({ kind: "context", key: `context:${firstId || i}`, parts: batch });
      continue;
    }
    if (t === "reasoning") {
      const batch: AgentDetailedPart[] = [cur];
      i += 1;
      while (i < rows.length) {
        const nxt = rows[i];
        const nt = String((nxt as any)?.type || "");
        if (nt === "reasoning") {
          batch.push(nxt);
          i += 1;
          continue;
        }
        break;
      }
      const firstId = String((batch[0] as any)?.id || "");
      out.push({ kind: "reasoning", key: `reasoning:${firstId || i}`, parts: batch });
      continue;
    }
    const pid = String((cur as any)?.id || "");
    out.push({ kind: "part", key: `part:${pid || i}`, part: cur });
    i += 1;
  }
  return out;
}

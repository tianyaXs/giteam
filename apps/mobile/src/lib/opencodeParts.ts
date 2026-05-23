export type OpencodeDetailedPart = Record<string, unknown>;

export type OpencodeTodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority?: string;
};

export type OpencodeChatMessage = {
  id: string;
  role: string;
  content: string;
  attachments?: Array<{ id: string; kind: "image"; uri: string; mime?: string; filename?: string }>;
};

export type OpencodeAssistantRenderGroup =
  | { kind: "context"; key: string; parts: OpencodeDetailedPart[] }
  | { kind: "reasoning"; key: string; parts: OpencodeDetailedPart[] }
  | { kind: "part"; key: string; part: OpencodeDetailedPart };

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

export function parseOpencodeTaskSessionId(part: OpencodeDetailedPart | undefined | null): string {
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

export function buildOpencodeMainLineMarkdownFromParts(parts: OpencodeDetailedPart[] | undefined | null): string {
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

export function buildOpencodeImageAttachmentsFromParts(parts: OpencodeDetailedPart[] | undefined | null) {
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

export function mergeOpencodeMessageAttachments(prev: OpencodeChatMessage[] | undefined, next: OpencodeChatMessage[]) {
  const prevById = new Map<string, NonNullable<OpencodeChatMessage["attachments"]>>();
  const prevByContent = new Map<string, NonNullable<OpencodeChatMessage["attachments"]>>();
  (Array.isArray(prev) ? prev : []).forEach((msg) => {
    if (msg.role !== "user" || !msg.attachments?.length) return;
    if (msg.id) prevById.set(msg.id, msg.attachments);
    const text = msg.content.trim();
    if (text) prevByContent.set(text, msg.attachments);
  });
  return next.map((msg) => {
    if (msg.role !== "user" || msg.attachments?.length) return msg;
    const attachments = prevById.get(msg.id) || prevByContent.get(msg.content.trim());
    return attachments?.length ? { ...msg, attachments } : msg;
  });
}

export function isOpencodeRenderablePart(
  p: OpencodeDetailedPart | undefined | null,
  showReasoningSummaries = true,
): boolean {
  if (!p) return false;
  const t = String((p as any)?.type || "");
  if (t === "text") return !!String((p as any)?.text ?? "").trim();
  if (t === "reasoning") {
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

export function parseOpencodeTodoItems(input: unknown): OpencodeTodoItem[] {
  if (!Array.isArray(input)) return [];
  const items: OpencodeTodoItem[] = [];
  input.forEach((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!row) return;
    const content = String(row.content ?? "").trim();
    const rawStatus = String(row.status ?? "pending").trim().toLowerCase();
    if (!content) return;
    const status: OpencodeTodoItem["status"] =
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

export function readOpencodeTodosFromPart(part: OpencodeDetailedPart | undefined | null): OpencodeTodoItem[] {
  if (!part || String((part as any)?.type || "") !== "tool") return [];
  if (String((part as any)?.tool || "") !== "todowrite") return [];
  const state = ((part as any)?.state || {}) as Record<string, unknown>;
  const metadata = ((part as any)?.metadata || state.metadata || {}) as Record<string, unknown>;
  const input = (state.input || {}) as Record<string, unknown>;
  const metaTodos = parseOpencodeTodoItems(metadata.todos);
  if (metaTodos.length > 0) return metaTodos;
  return parseOpencodeTodoItems(input.todos);
}

export function isOpencodeContextTool(tool: string): boolean {
  return tool === "read" || tool === "glob" || tool === "grep" || tool === "list";
}

export function summarizeOpencodeContextToolCounts(parts: OpencodeDetailedPart[] | undefined | null): {
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
    else if (tool === "glob" || tool === "grep") search += 1;
    else if (tool === "list") list += 1;
  }
  return { read, search, list };
}

export function summarizeOpencodeContextProgress(parts: OpencodeDetailedPart[] | undefined | null): {
  active: boolean;
  mode: string;
  detail: string;
} {
  const rows = Array.isArray(parts) ? parts : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const p = rows[i] as any;
    if (!p || String(p?.type || "") !== "tool") continue;
    const st = String(p?.state?.status || "").trim().toLowerCase();
    if (st !== "running" && st !== "pending") continue;
    const title = String(p?.state?.title || "").trim();
    const tool = String(p?.tool || "").trim();
    const input = p?.state?.input || {};
    const subtitle = String(input?.description || input?.filePath || input?.pattern || input?.path || "").trim();
    const detail = [tool, title || subtitle].filter(Boolean).join(" · ");
    const mode =
      tool === "read" || tool === "list" || tool === "glob" || tool === "grep"
        ? "读取"
        : tool === "write" || tool === "edit" || tool === "apply_patch"
          ? "写入"
          : "处理中";
    return { active: true, mode, detail };
  }
  return { active: false, mode: "", detail: "" };
}

export function mergeOpencodeStreamText(existingRaw: unknown, incomingRaw: unknown): string {
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

export function buildOpencodeReplyMarkdownFromParts(parts: OpencodeDetailedPart[] | undefined | null): string {
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

export function buildOpencodeAssistantRenderGroups(parts: OpencodeDetailedPart[] | undefined | null): OpencodeAssistantRenderGroup[] {
  const rows = Array.isArray(parts) ? parts : [];
  const out: OpencodeAssistantRenderGroup[] = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i];
    const t = String((cur as any)?.type || "");
    const tool = String((cur as any)?.tool || "");
    if (t === "tool" && isOpencodeContextTool(tool)) {
      const batch: OpencodeDetailedPart[] = [cur];
      i += 1;
      while (i < rows.length) {
        const nxt = rows[i];
        const nt = String((nxt as any)?.type || "");
        const ntool = String((nxt as any)?.tool || "");
        if (nt === "tool" && isOpencodeContextTool(ntool)) {
          batch.push(nxt);
          i += 1;
          continue;
        }
        break;
      }
      const firstId = String((batch[0] as any)?.id || "");
      const lastId = String((batch[batch.length - 1] as any)?.id || "");
      out.push({ kind: "context", key: `context:${firstId || i}:${lastId || i}`, parts: batch });
      continue;
    }
    if (t === "reasoning") {
      const batch: OpencodeDetailedPart[] = [cur];
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
      const lastId = String((batch[batch.length - 1] as any)?.id || "");
      out.push({ kind: "reasoning", key: `reasoning:${firstId || i}:${lastId || i}`, parts: batch });
      continue;
    }
    const pid = String((cur as any)?.id || "");
    out.push({ kind: "part", key: `part:${pid || i}`, part: cur });
    i += 1;
  }
  return out;
}

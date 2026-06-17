import type { OpencodeChatMessage, OpencodeDetailedPart, OpencodeTodoItem } from "./opencodeSessions";

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
    if ((p as any)?.metadata?.giteamHiddenAttachmentPath) continue;
    const text = String((p as any)?.text ?? (p as any)?.part?.text ?? "").trim();
    if (text) chunks.push(text);
  }
  return stripGiteamDiagnosticNoise(chunks.join("\n\n"));
}

export function buildOpencodeImageAttachmentsFromParts(parts: OpencodeDetailedPart[] | undefined | null) {
  const rows = Array.isArray(parts) ? parts : [];
  const out: Array<{ id: string; kind: "image" | "file"; uri: string; mime?: string; filename?: string }> = [];
  const pushUnique = (item: { id: string; kind: "image" | "file"; uri: string; mime?: string; filename?: string }) => {
    if (out.some((entry) => entry.uri === item.uri && entry.filename === item.filename && entry.kind === item.kind)) return;
    out.push(item);
  };
  rows.forEach((p, index) => {
    const part: any = p || {};
    const type = String(part.type || "");
    if (type === "file") {
      const mime = String(part.mime || "").trim();
      const url = String(part.url || part.source || "").trim();
      const filename = String(part.filename || "").trim();
      if (!url || url.startsWith("file://")) return;
      const image = mime.startsWith("image/") || url.startsWith("data:image/") || /\.(png|jpe?g|webp|gif|heic)$/i.test(filename);
      pushUnique({
        id: String(part.id || `image:${index}`),
        kind: image ? "image" : "file",
        uri: url,
        mime: mime || undefined,
        filename: filename || undefined,
      });
      return;
    }
    if (type === "text" && part?.metadata?.giteamHiddenAttachmentPath) {
      const filename = String(part.metadata?.filename || "").trim();
      const sourcePath = String(part.metadata?.sourcePath || "").trim();
      if (!filename) return;
      pushUnique({
        id: String(part.id || `file:${index}`),
        kind: "file",
        uri: sourcePath ? `file://${sourcePath.split("/").map(encodeURIComponent).join("/")}` : "",
        mime: "text/plain",
        filename,
      });
    }
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

export function isOpencodeRenderablePart(p: OpencodeDetailedPart | undefined | null): boolean {
  if (!p) return false;
  const t = String((p as any)?.type || "");
  if (t === "text") return !!String((p as any)?.text ?? "").trim();
  if (t === "reasoning") return !!String((p as any)?.text ?? "").trim();
  if (t === "step-start" || t === "step-finish" || t === "patch") return false;
  if (t === "tool") return String((p as any)?.tool || "") !== "todowrite";
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
  return tool === "read" || tool === "glob" || tool === "grep" || tool === "search" || tool === "list";
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
    else if (tool === "glob" || tool === "grep" || tool === "search") search += 1;
    else if (tool === "list") list += 1;
  }
  return { read, search, list };
}

export function summarizeOpencodeContextProgress(parts: OpencodeDetailedPart[] | undefined | null): {
  active: boolean;
  mode: string;
  detail: string;
} {
  const normalizeToolText = (value: unknown) => String(value || "").trim();
  const readableSearchText = (value: unknown) =>
    normalizeToolText(value)
      .replace(/\\\./g, ".")
      .replace(/\\\//g, "/")
      .replace(/\\-/g, "-");
  const wildcardOnly = (value: string) => {
    const text = normalizeToolText(value).replace(/\s+/g, "");
    return text === "*" || text === "**/*" || text === "./*" || text === ".";
  };
  const meaningfulSearchText = (value: unknown) => {
    const text = readableSearchText(value);
    return text && !wildcardOnly(text) ? text : "";
  };
  const searchDetail = (input: any, title: string) => {
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
  };
  const rows = Array.isArray(parts) ? parts : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const p = rows[i] as any;
    if (!p || String(p?.type || "") !== "tool") continue;
    const st = String(p?.state?.status || "").trim().toLowerCase();
    if (st !== "running" && st !== "pending") continue;
    const title = String(p?.state?.title || "").trim();
    const tool = String(p?.tool || "").trim();
    const input = p?.state?.input || {};
    const searchTool = tool === "glob" || tool === "grep" || tool === "search";
    const subtitle = searchTool
      ? searchDetail(input, title)
      : String(input?.description || title || input?.filePath || input?.pattern || input?.path || "").trim();
    const detailTitle = searchTool ? subtitle : title || subtitle;
    const detail = searchTool && !detailTitle ? "" : [tool, detailTitle].filter(Boolean).join(" · ");
    const mode =
      tool === "read" || tool === "list" || tool === "glob" || tool === "grep" || tool === "search"
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
  return existing + incoming;
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

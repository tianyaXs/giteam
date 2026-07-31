import type { AgentChatMessage, AgentDetailedPart, AgentTodoItem } from "./agentSessions";

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

export function buildAgentMainLineMarkdownFromParts(parts: AgentDetailedPart[] | undefined | null): string {
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

export function buildAgentImageAttachmentsFromParts(parts: AgentDetailedPart[] | undefined | null) {
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

export function mergeAgentMessageAttachments(prev: AgentChatMessage[] | undefined, next: AgentChatMessage[]) {
  const prevById = new Map<string, NonNullable<AgentChatMessage["attachments"]>>();
  const prevByContent = new Map<string, NonNullable<AgentChatMessage["attachments"]>>();
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

/** 保留本地刚发生但服务端历史尚未记录的运行失败消息。 */
export function mergeAgentMessageErrors(prev: AgentChatMessage[] | undefined, next: AgentChatMessage[]) {
  const previousErrors = (Array.isArray(prev) ? prev : [])
    .filter((message) => message.role === "assistant" && Boolean(message.error?.trim()))
    .map((message) => ({ ...message, content: "" }));
  if (previousErrors.length === 0) return next;
  const nextById = new Set(next.map((message) => message.id));
  const merged = next.map((message) => {
    const previous = previousErrors.find((item) => item.id === message.id);
    return previous ? { ...message, error: previous.error, content: "" } : message;
  });
  for (const previous of previousErrors) {
    if (nextById.has(previous.id)) continue;
    const previousIndex = (Array.isArray(prev) ? prev : []).findIndex((item) => item.id === previous.id);
    let insertAt = 0;
    for (let index = previousIndex - 1; index >= 0; index -= 1) {
      const anchor = prev?.[index];
      if (!anchor) continue;
      const anchorIndex = merged.findIndex((item) => item.id === anchor.id);
      if (anchorIndex >= 0) {
        insertAt = anchorIndex + 1;
        break;
      }
    }
    merged.splice(insertAt, 0, previous);
  }
  return merged;
}

export function isAgentRenderablePart(p: AgentDetailedPart | undefined | null): boolean {
  if (!p) return false;
  const t = String((p as any)?.type || "");
  if (t === "text") return !!String((p as any)?.text ?? "").trim();
  if (t === "reasoning") return !!String((p as any)?.text ?? "").trim();
  if (t === "step-start" || t === "step-finish" || t === "patch") return false;
  if (t === "toolCall") {
    // toolName 尚未到达（toolCall.started 常先于 tool.started、初始为空）时不渲染：空 toolName 的
    // 工具会被分到 part 组、toolName 填充后切到 context/tool-batch 组并触发相邻合并，组 key 变化
    // 导致卸载/挂载，表现为标签「显示→隐藏」的显隐闪动（多次工具调用尤为明显）。等 toolName 到达
    // 再渲染即可——工具首次以真实类型出现（从无到有），不再发生组类型切换。
    const name = String((p as any)?.toolName || "");
    return name !== "" && name !== "todowrite";
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
  if (!part || String((part as any)?.type || "") !== "toolCall") return [];
  if (String((part as any)?.toolName || "") !== "todowrite") return [];
  const details = ((part as any)?.details || {}) as Record<string, unknown>;
  const input = ((part as any)?.input || {}) as Record<string, unknown>;
  const metaTodos = parseAgentTodoItems(details.todos);
  if (metaTodos.length > 0) return metaTodos;
  return parseAgentTodoItems(input.todos);
}

export function isAgentContextTool(tool: string): boolean {
  // ls/find 是内置的列出/搜索工具名。
  return tool === "read" || tool === "glob" || tool === "grep" || tool === "search" || tool === "list" || tool === "ls" || tool === "find";
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
    if (String((p as any)?.type || "") !== "toolCall") continue;
    const tool = String((p as any)?.toolName || "");
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
    if (!p || String(p?.type || "") !== "toolCall") continue;
    const st = String(p?.status || "").trim().toLowerCase();
    if (st !== "running" && st !== "pending" && st !== "deciding") continue;
    const tool = String(p?.toolName || "").trim();
    const input = (p?.input || {}) as Record<string, unknown>;
    const searchTool = tool === "grep" || tool === "find" || tool === "glob" || tool === "search";
    const subtitle = searchTool
      ? searchDetail(input, "")
      : String(input?.description || input?.pattern || input?.path || input?.command || "").trim();
    const detail = searchTool && !subtitle ? "" : [tool, subtitle].filter(Boolean).join(" · ");
    const mode =
      tool === "read" || tool === "ls" || tool === "list" || tool === "grep" || tool === "find" || tool === "glob" || tool === "search"
        ? "读取"
        : tool === "write" || tool === "edit" || tool === "hashline_edit" || tool === "apply_patch"
          ? "写入"
          : "处理中";
    return { active: true, mode, detail };
  }
  return { active: false, mode: "", detail: "" };
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
  return existing + incoming;
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
    const tool = String((cur as any)?.toolName || "");
    if (t === "toolCall" && isAgentContextTool(tool)) {
      const batch: AgentDetailedPart[] = [cur];
      i += 1;
      while (i < rows.length) {
        const nxt = rows[i];
        const nt = String((nxt as any)?.type || "");
        const ntool = String((nxt as any)?.toolName || "");
        if (nt === "toolCall" && isAgentContextTool(ntool)) {
          batch.push(nxt);
          i += 1;
          continue;
        }
        break;
      }
      // key 只用首条 part id：流式中组不断追加 part，lastId 会逐帧漂移 → React 把组当作
      // 新元素卸载重挂载，重挂载的中间帧可能让末尾 reasoning 临时成为 lastGroupIndex 而闪烁。
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

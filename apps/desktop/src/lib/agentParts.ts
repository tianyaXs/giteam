import type { AgentChatMessage, AgentDetailedPart, AgentTodoItem } from "./agentSessions";

export type AgentAssistantRenderGroup =
  | { kind: "context"; key: string; parts: AgentDetailedPart[] }
  | { kind: "reasoning"; key: string; parts: AgentDetailedPart[] }
  /** 隐藏思考时仍保留的不可见分隔，避免跨回合 shell/explore 被收成一个大数。 */
  | { kind: "boundary"; key: string }
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

export function dedupeAgentToolParts(parts: AgentDetailedPart[] | undefined | null): AgentDetailedPart[] {
  const rows = Array.isArray(parts) ? parts : [];
  const seen = new Set<string>();
  const out: AgentDetailedPart[] = [];
  for (const part of rows) {
    if (!part) continue;
    const type = String((part as { type?: string }).type || "");
    if (type === "toolCall") {
      const id = String(
        (part as { id?: string }).id || (part as { toolCallId?: string }).toolCallId || ""
      ).trim();
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
    }
    out.push(part);
  }
  return out;
}

export function isAgentRenderablePart(p: AgentDetailedPart | undefined | null): boolean {
  if (!p) return false;
  const t = String((p as any)?.type || "");
  if (t === "text") return !!String((p as any)?.text ?? "").trim();
  if (t === "reasoning") return !!String((p as any)?.text ?? "").trim();
  // 跨 assistant 回合分隔：不可见，但阻止 shell/explore 批组跨回合合并。
  if (t === "turn-boundary") return true;
  if (t === "runtime.retry" || t === "runtime.failure" || t === "runtime.memory") return true;
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
  // snapshot/partial 与累加 delta 偶发「近似全文但非前缀」时，旧逻辑会 existing+incoming
  // 拼成双份正文；完成态再「保更长」会把重复锁死在 UI（会话 jsonl 仍是单份）。
  const existingNorm = existing.trim();
  const incomingNorm = incoming.trim();
  if (existingNorm && incomingNorm) {
    if (existingNorm === incomingNorm) return existing.length >= incoming.length ? existing : incoming;
    if (
      existingNorm.length >= incomingNorm.length
      && (existingNorm.startsWith(incomingNorm) || existingNorm.endsWith(incomingNorm))
    ) {
      return existing;
    }
    if (
      incomingNorm.length >= existingNorm.length
      && (incomingNorm.startsWith(existingNorm) || incomingNorm.endsWith(existingNorm))
    ) {
      return incoming;
    }
  }
  return existing + incoming;
}

/** 若正文是精确双份拼接（含 \n\n / \n 分隔），折叠为单份；用于「保更长」时拒绝重复体。 */
export function collapseDuplicatedAgentContent(textRaw: string): string {
  const trimmed = String(textRaw || "").trim();
  if (trimmed.length < 32) return trimmed;
  for (const sep of ["\n\n", "\n"] as const) {
    let idx = trimmed.indexOf(sep);
    while (idx >= 0) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + sep.length).trim();
      // 正文自身常含 \n\n：不能只按「切成恰好 2 段」判断，要扫每个分隔点。
      // 阈值不宜过高：短答复（如一行天气）双份拼接也可能只有 ~40 字。
      if (left.length >= 12 && left === right) return left;
      idx = trimmed.indexOf(sep, idx + sep.length);
    }
  }
  if (trimmed.length % 2 === 0) {
    const half = trimmed.length / 2;
    const a = trimmed.slice(0, half);
    const b = trimmed.slice(half);
    if (a === b && a.trim().length >= 12) return a.trim();
  }
  return trimmed;
}

/** 在候选中选更长正文，但先折叠「双份拼接」假更长。 */
export function pickPreferredAgentContent(...candidates: Array<string | undefined>): string {
  let best = "";
  for (const raw of candidates) {
    const text = collapseDuplicatedAgentContent(String(raw || ""));
    if (text.length > best.length) best = text;
  }
  return best;
}

/**
 * 去掉重复正文 text part（同文或互为前缀超集只留一份），保留工具/思考顺序。
 * soft-append 与未冲刷 delta 竞态时易出现 text:0 + text:soft:0 双份。
 */
export function dedupeAgentDuplicateTextParts(
  parts: AgentDetailedPart[] | undefined | null
): AgentDetailedPart[] {
  const rows = Array.isArray(parts) ? parts : [];
  const out: AgentDetailedPart[] = [];
  for (const part of rows) {
    if (!part) continue;
    const type = String((part as { type?: string }).type || "");
    if (type !== "text") {
      out.push(part);
      continue;
    }
    const text = pickPreferredAgentContent(String((part as { text?: string }).text || ""));
    if (!text) continue;
    const hit = out.findIndex((item) => {
      if (String((item as { type?: string }).type || "") !== "text") return false;
      const prev = pickPreferredAgentContent(String((item as { text?: string }).text || ""));
      if (!prev) return false;
      return prev === text || prev.startsWith(text) || text.startsWith(prev);
    });
    if (hit < 0) {
      out.push({ ...(part as object), type: "text", text } as AgentDetailedPart);
      continue;
    }
    const prev = String((out[hit] as { text?: string }).text || "").trim();
    if (text.length > prev.length) {
      out[hit] = { ...(out[hit] as object), type: "text", text } as AgentDetailedPart;
    }
  }
  return out;
}

/**
 * 过程 part（思考/工具/运行时）始终排在正文 text 之前。
 * 迟到的 toolCall 若 append 到已有 text 后面，UI 会把「已查询」画到最终回复下面。
 */
export function liftAgentProcessPartsBeforeText(
  parts: AgentDetailedPart[] | undefined | null
): AgentDetailedPart[] {
  const rows = Array.isArray(parts) ? parts : [];
  const process: AgentDetailedPart[] = [];
  const rest: AgentDetailedPart[] = [];
  for (const part of rows) {
    if (!part) continue;
    const type = String((part as { type?: string }).type || "");
    const isText = type === "text" && Boolean(String((part as { text?: string }).text || "").trim());
    if (isText) {
      rest.push(part);
      continue;
    }
    if (
      type === "toolCall"
      || type === "reasoning"
      || type === "runtime.failure"
      || type === "runtime.retry"
    ) {
      process.push(part);
      continue;
    }
    if (rest.length > 0) rest.push(part);
    else process.push(part);
  }
  if (process.length === 0 || rest.length === 0) return rows;
  return [...process, ...rest];
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
  return collapseDuplicatedAgentContent(stripGiteamDiagnosticNoise(out.join("\n\n")));
}

export function buildAgentAssistantRenderGroups(parts: AgentDetailedPart[] | undefined | null): AgentAssistantRenderGroup[] {
  const rows = liftAgentProcessPartsBeforeText(parts);
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
    if (t === "turn-boundary") {
      const pid = String((cur as any)?.id || "");
      out.push({ kind: "boundary", key: `boundary:${pid || i}` });
      i += 1;
      continue;
    }
    const pid = String((cur as any)?.id || "");
    out.push({ kind: "part", key: `part:${pid || i}`, part: cur });
    i += 1;
  }
  return out;
}

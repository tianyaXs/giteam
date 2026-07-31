import type { AgentMessage, AgentPart } from "./agent/client";

/** 搜索范围：当前会话 / 当前仓库的全部会话 / 所有仓库的全部会话。 */
export type SearchScope = "current-session" | "current-repo" | "all-repos";

/** 单条搜索命中：携带定位与高亮渲染所需的全部信息。 */
export type SearchHit = {
  sessionId: string;
  repoPath: string;
  repoName: string;
  sessionTitle: string;
  messageId: string;
  role: "user" | "assistant";
  updatedAtMs: number;
  /** 命中前后各取若干字符的预览文本（含首尾省略号）。 */
  preview: string;
  /** preview 内命中关键词的起止字符偏移，供 <mark> 渲染。 */
  matchStart: number;
  matchEnd: number;
};

/** 会话级元信息，搜索时作为命中的归属来源。 */
export type SearchSessionMeta = {
  sessionId: string;
  repoPath: string;
  repoName: string;
  sessionTitle: string;
  updatedAtMs: number;
};

/** 归一化的可搜索单元：当前会话用 AgentChatMessage.content，跨会话用 AgentMessage 抽取。 */
export type SearchableItem = {
  messageId: string;
  role: "user" | "assistant";
  text: string;
};

/**
 * 与 App.tsx 的 agentPartText + 渲染层 detailParts 重分类保持同源：仅 text part 计入正文，
 * 且排除被误标成 text 的 reasoning（运行时 id 为 reasoning/reasoning:xxx——渲染时会改回
 * reasoning 剥离出正文）。否则搜索会命中思考过程，与消息流可见内容不一致。
 * reasoning/toolCall 走时间线渲染（ReasoningGroup/工具卡片），拼进正文会把过程信息
 * 误当成可命中文本。
 */
function partText(part: AgentPart): string {
  if (part.type === "text") {
    const id = String((part as { id?: unknown }).id || "").trim();
    if (id === "reasoning" || id.startsWith("reasoning:")) return "";
    return part.text;
  }
  return "";
}

/** 从 pi 原生 AgentMessage 抽取可搜索正文（拼接所有 text part）。 */
export function extractSearchableText(message: AgentMessage): string {
  return message.parts.map(partText).join("");
}

/** AgentMessage → 可搜索单元（丢弃 system/tool/custom 等非对话角色）。 */
export function searchableItemFromAgentMessage(message: AgentMessage): SearchableItem | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const text = extractSearchableText(message);
  if (!text.trim()) return null;
  return { messageId: message.id, role: message.role, text };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 围绕命中位置截取预览片段。
 * 关键词前/中/后三段各自把连续换行/制表符压成单空格，再用替换后的长度重算
 * matchStart/matchEnd——若对整段一次性替换，连续空白被压缩会使前列字符偏移，
 * 而 matchStart 仍按原始偏移计算，<mark> 就会错位（预览高亮偏移）。
 */
export function buildSnippet(
  text: string,
  hitStart: number,
  matchLength: number,
  radius = 60
): { preview: string; matchStart: number; matchEnd: number } {
  const start = Math.max(0, hitStart - radius);
  const end = Math.min(text.length, hitStart + matchLength + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const before = text.slice(start, hitStart).replace(/[\r\n\t]+/g, " ");
  const hit = text.slice(hitStart, hitStart + matchLength).replace(/[\r\n\t]+/g, " ");
  const after = text.slice(hitStart + matchLength, end).replace(/[\r\n\t]+/g, " ");
  const matchStart = prefix.length + before.length;
  const matchEnd = matchStart + hit.length;
  return { preview: `${prefix}${before}${hit}${after}${suffix}`, matchStart, matchEnd };
}

/**
 * 纯匹配器：对一组可搜索单元执行大小写不敏感的关键词匹配，
 * 每条消息只取首个命中（保持结果列表可读；后续如需可扩展为"更多命中"）。
 */
export function searchMessages(params: {
  query: string;
  session: SearchSessionMeta;
  items: SearchableItem[];
}): SearchHit[] {
  const query = params.query.trim();
  if (!query) return [];
  const regex = new RegExp(escapeRegExp(query), "gi");
  const hits: SearchHit[] = [];
  const meta = params.session;
  for (const item of params.items) {
    const text = item.text;
    if (!text) continue;
    regex.lastIndex = 0;
    const match = regex.exec(text);
    if (!match) continue;
    const { preview, matchStart, matchEnd } = buildSnippet(text, match.index, match[0].length);
    hits.push({
      sessionId: meta.sessionId,
      repoPath: meta.repoPath,
      repoName: meta.repoName,
      sessionTitle: meta.sessionTitle,
      messageId: item.messageId,
      role: item.role,
      updatedAtMs: meta.updatedAtMs,
      preview,
      matchStart,
      matchEnd
    });
  }
  return hits;
}

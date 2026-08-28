/** 图谱节点主动引用：Composer chip + 发送时注入的结构化上下文。 */

export type GraphContextRef = {
  id: string;
  nodeId: string;
  nodeType: string;
  typeLabel: string;
  label: string;
  /** 从 props 摘录的短摘要（intent / summary / text 等） */
  snippet?: string;
};

const SNIPPET_KEYS = [
  "intent",
  "summary",
  "text",
  "description",
  "rationale",
  "detail",
] as const;

const MAX_SNIPPET_CHARS = 280;
const MAX_TOTAL_CONTEXT_CHARS = 8_000;

export function snippetFromNodeProps(propsRaw: string | undefined): string | undefined {
  if (!propsRaw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(propsRaw) as Record<string, unknown>;
    for (const key of SNIPPET_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        const text = value.trim().replace(/\s+/g, " ");
        return text.length > MAX_SNIPPET_CHARS
          ? `${text.slice(0, MAX_SNIPPET_CHARS - 1)}…`
          : text;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function makeGraphContextRef(input: {
  nodeId: string;
  nodeType: string;
  typeLabel: string;
  label: string;
  props?: string;
}): GraphContextRef {
  const label = input.label.trim() || input.typeLabel || input.nodeType;
  return {
    id: `gref-${input.nodeId}`,
    nodeId: input.nodeId,
    nodeType: input.nodeType,
    typeLabel: input.typeLabel || input.nodeType,
    label,
    snippet: snippetFromNodeProps(input.props),
  };
}

/** 组装发给模型的隐藏上下文块（不替代用户可见输入）。 */
export function formatGraphContextBlock(refs: GraphContextRef[]): string {
  if (refs.length === 0) return "";
  const lines: string[] = [
    "<graph_context>",
    "The user pinned the following asset-graph nodes as explicit context. Prefer these facts when answering; call asset_context/asset_search only if you need more.",
  ];
  let used = lines.join("\n").length;
  for (const ref of refs) {
    const chunk = [
      `- [${ref.typeLabel}] ${ref.label} (node_id=${ref.nodeId}, type=${ref.nodeType})`,
      ref.snippet ? `  snippet: ${ref.snippet}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    if (used + chunk.length + 20 > MAX_TOTAL_CONTEXT_CHARS) {
      lines.push("- … (truncated)");
      break;
    }
    lines.push(chunk);
    used += chunk.length;
  }
  lines.push("</graph_context>");
  return lines.join("\n");
}

/** 纯图片消息占位 prompt（无文字时使用）。 */
export const IMAGE_ONLY_USER_PROMPT = "Please inspect the attached image(s).";

/** Agent 注入块标签（UI 展示时应剥离）。 */
export const INJECTED_USER_PROMPT_BLOCK_TAGS = ["graph_context"] as const;

const GRAPH_CONTEXT_BLOCK_RE = /\n*<graph_context>[\s\S]*?<\/graph_context>\n*/gi;

/** Pi session.rs COMPACTION_SUMMARY_* — 压缩摘要注入 user 消息，仅模型可见。 */
const COMPACTION_SUMMARY_BLOCK_RE =
  /\n*The conversation history before this point was compacted into the following summary:\n\n<summary>\n[\s\S]*?\n<\/summary>\n*/g;

/** Pi session.rs BRANCH_SUMMARY_* */
const BRANCH_SUMMARY_BLOCK_RE =
  /\n*The following is a summary of a branch that this conversation came back from:\n\n<summary>\n[\s\S]*?<\/summary>\n*/g;

/** Pi 自动压缩后插入的 user 正文（messages API 首条常为该块）。 */
export function isCompactionSummaryUserText(content: string): boolean {
  const trimmed = String(content || "").trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith(
      "The conversation history before this point was compacted into the following summary:",
    )
    || (trimmed.includes("compacted into the following summary") && trimmed.includes("<summary>"))
  );
}

/** 本地路径附件注入 hint（与 App.tsx 发送时组装一致）。 */
export function formatLocalFileAttachmentHint(filename: string, sourcePath: string): string {
  return [
    `The user attached a local file named "${filename}".`,
    `Local path: ${sourcePath}`,
    "Use the appropriate Pi tool to inspect it when needed.",
  ].join("\n");
}

/** 无本地路径的 UI 附件注入 hint。 */
export function formatUiOnlyFileAttachmentHint(filename: string, mime: string): string {
  return [
    `The user attached a file named "${filename}" (${mime}).`,
    "The attachment was selected in the desktop UI but is not available as a filesystem path to the embedded agent.",
  ].join("\n");
}

const LOCAL_FILE_ATTACHMENT_HINT_RE =
  /\n*The user attached a local file named "[^"]*"\.\nLocal path: [^\n]+\nUse the appropriate Pi tool to inspect it when needed\.(?:\n|$)/g;

const UI_ONLY_FILE_ATTACHMENT_HINT_RE =
  /\n*The user attached a file named "[^"]*" \([^)]*\)\.\nThe attachment was selected in the desktop UI but is not available as a filesystem path to the embedded agent\.(?:\n|$)/g;

function collapseDisplayWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** 从持久化/服务端正文里去掉 `<graph_context>` 注入块。 */
export function stripGraphContextBlock(content: string): string {
  return collapseDisplayWhitespace(content.replace(GRAPH_CONTEXT_BLOCK_RE, "\n"));
}

/** 去掉文件附件注入 hint 块。 */
export function stripFileAttachmentHints(content: string): string {
  return collapseDisplayWhitespace(
    content
      .replace(LOCAL_FILE_ATTACHMENT_HINT_RE, "\n")
      .replace(UI_ONLY_FILE_ATTACHMENT_HINT_RE, "\n"),
  );
}

/** 去掉纯图片占位 prompt（仅当整段正文就是该句时）。 */
export function stripImageOnlyPlaceholder(content: string): string {
  const trimmed = content.trim();
  if (trimmed === IMAGE_ONLY_USER_PROMPT) return "";
  return content;
}

function stripInjectedSessionSummaryBlocks(content: string): string {
  let value = content ?? "";
  value = value.replace(COMPACTION_SUMMARY_BLOCK_RE, "\n");
  value = value.replace(BRANCH_SUMMARY_BLOCK_RE, "\n");
  return value;
}

/** 去掉所有已知 Agent 注入块，只保留用户可见输入。 */
export function stripInjectedUserPromptBlocks(content: string): string {
  let value = content ?? "";
  value = stripInjectedSessionSummaryBlocks(value);
  for (const tag of INJECTED_USER_PROMPT_BLOCK_TAGS) {
    if (tag === "graph_context") {
      value = value.replace(GRAPH_CONTEXT_BLOCK_RE, "\n");
      continue;
    }
    const blockRe = new RegExp(`\\n*<${tag}>[\\s\\S]*?<\\/${tag}>\\n*`, "gi");
    value = value.replace(blockRe, "\n");
  }
  value = stripFileAttachmentHints(value);
  value = stripImageOnlyPlaceholder(value);
  return collapseDisplayWhitespace(value);
}

/** 从 `<graph_context>` 块反解析 chip（历史消息回放用）。 */
export function parseGraphContextBlock(content: string): GraphContextRef[] {
  const match = content.match(/<graph_context>([\s\S]*?)<\/graph_context>/i);
  if (!match) return [];
  const refs: GraphContextRef[] = [];
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const item = line.match(/^-\s*\[([^\]]+)\]\s*(.+?)\s*\(node_id=([^,]+),\s*type=([^)]+)\)\s*$/);
    if (!item) continue;
    const [, typeLabel, label, nodeId, nodeType] = item;
    let snippet: string | undefined;
    const next = lines[i + 1]?.trim();
    if (next?.startsWith("snippet:")) {
      snippet = next.slice("snippet:".length).trim();
      i += 1;
    }
    refs.push({
      id: `gref-${nodeId}`,
      nodeId,
      nodeType,
      typeLabel,
      label: label.trim(),
      snippet,
    });
  }
  return refs;
}

/** 服务端 user 正文 → UI 展示（剥注入块 + 保留 chip）。 */
export function normalizeUserMessageForDisplay(
  mapped: { content: string; graphRefs?: GraphContextRef[] },
  previous?: { content?: string; graphRefs?: GraphContextRef[] },
): { content: string; graphRefs?: GraphContextRef[] } {
  const parsedRefs = parseGraphContextBlock(mapped.content);
  const displayText =
    stripInjectedUserPromptBlocks(mapped.content) || String(previous?.content || "").trim();
  const graphRefs = previous?.graphRefs?.length
    ? previous.graphRefs
    : mapped.graphRefs?.length
      ? mapped.graphRefs
      : parsedRefs.length > 0
        ? parsedRefs
        : undefined;
  return {
    content: displayText,
    graphRefs,
  };
}

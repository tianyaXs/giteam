/**
 * pi 原生数据的 presentation 纯函数层（参考 super_agent_mobile 的设计：
 * 工具特化全部收敛在纯函数，渲染组件零分支）。函数直接消费 pi 原生字段——
 * input 用 pi 自己的参数名（path/oldText/newText/pattern/command），
 * output 是 pi ToolOutput/ToolResultMessage 的序列化形状（content blocks + details），
 * 不做任何额外的模型包装。
 */

/** UI 单行摘要截断上限（对齐 super_agent_mobile MAX_UI_TEXT_CHARS）。 */
export const MAX_UI_TEXT_CHARS = 2400;
/** 富文本（diff/文件内容）截断上限（对齐 MAX_UI_RICH_TEXT_CHARS）。 */
export const MAX_UI_RICH_TEXT_CHARS = 12000;

export type PiToolInput = Record<string, unknown>;

/** 工具中文显示名。 */
export function toolDisplayName(tool: string): string {
  if (tool === "read") return "读取";
  if (tool === "ls") return "列出";
  if (tool === "find" || tool === "grep") return "搜索";
  if (tool === "write") return "写入";
  if (tool === "edit" || tool === "hashline_edit") return "编辑";
  if (tool === "bash") return "bash";
  if (tool === "bash_output") return "输出";
  if (tool === "kill_shell") return "终止";
  if (tool === "web_fetch") return "查询";
  if (tool === "web_search") return "搜索";
  if (tool === "browser_use") return "浏览器";
  if (tool === "question") return "提问";
  return tool || "tool";
}

/** 执行中的动作标签。 */
export function toolMode(tool: string): string {
  if (tool === "read" || tool === "ls" || tool === "grep") return "读取";
  if (tool === "find") return "搜索";
  if (tool === "write" || tool === "edit" || tool === "hashline_edit") return "写入";
  if (tool === "bash") return "命令";
  if (tool === "bash_output") return "输出";
  if (tool === "kill_shell") return "终止";
  if (tool === "web_fetch" || tool === "web_search") return "查询";
  if (tool === "browser_use") return "浏览";
  if (tool === "question") return "等待";
  return "";
}

/** 读取类上下文工具（时间线批组归类用）。 */
export function isContextTool(tool: string): boolean {
  return tool === "read" || tool === "grep" || tool === "find" || tool === "ls";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 从 URL 提取主域名（去 www. 前缀；非法 URL 回退到首段）。web 工具 headline 用。 */
function domainOfUrl(value: unknown): string {
  const url = normalizeText(value);
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.split("/")[0] || url;
  }
}

/** 路径末段（/ 与 \ 兼容）。 */
export function compactPath(input: unknown): string {
  const path = normalizeText(input).replace(/\\/g, "/");
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

/** 从 pi 工具输出（{content:[blocks], details, isError} 序列化形状）提取可读文本。 */
export function extractToolOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return "";
  const content = (output as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const row = block as { type?: string; text?: string };
    if (row.type === "text" && typeof row.text === "string" && row.text) chunks.push(row.text);
    else if (row.type === "image") chunks.push("[图片]");
  }
  return chunks.join("\n");
}

/** 从 pi 工具输出提取 details（edit 的 diff/firstChangedLine 等结构化数据在这里）。 */
export function extractToolDetails(output: unknown): Record<string, unknown> | undefined {
  if (!output || typeof output !== "object") return undefined;
  const details = (output as { details?: unknown }).details;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;
}

/** browser_use headline：navigate→动作+域名，click/type/read_dom→动作+选择器，screenshot→screenshot。 */
function browserUseHeadline(input: PiToolInput): string {
  const action = normalizeText(input.action);
  if (action === "navigate") {
    const url = normalizeText(input.url);
    return [action, domainOfUrl(url) || url].filter(Boolean).join(" · ");
  }
  if (action === "screenshot") return "screenshot";
  const selector = normalizeText(input.selector);
  return [action, selector].filter(Boolean).join(" · ");
}

/** 工具卡片头部的目标描述：bash→命令，搜索→pattern · path，提问→题头/数量，文件类→文件名。 */
export function toolHeadlineTarget(tool: string, input: PiToolInput): string {
  if (tool === "bash") return normalizeText(input.command);
  if (tool === "bash_output" || tool === "kill_shell") {
    return normalizeText(input.shell_id) || normalizeText(input.shellId);
  }
  if (tool === "browser_use") return browserUseHeadline(input);
  if (tool === "web_fetch") {
    const url = normalizeText(input.url);
    return domainOfUrl(url) || url;
  }
  if (tool === "web_search") return normalizeText(input.query);
  if (tool === "grep" || tool === "find") {
    const pattern = normalizeText(input.pattern);
    const path = compactPath(input.path);
    return [pattern, path].filter(Boolean).join(" · ");
  }
  if (tool === "question") {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const labels = questions
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as Record<string, unknown>;
        return normalizeText(row.header) || normalizeText(row.question);
      })
      .filter(Boolean);
    if (labels.length === 0) {
      return questions.length > 1 ? `${questions.length} 个问题` : questions.length === 1 ? "1 个问题" : "";
    }
    if (labels.length === 1) return labels[0];
    return `${labels[0]} 等 ${labels.length} 项`;
  }
  return compactPath(input.path);
}

/** edit 类工具的写入摘要（文件名 + 行数/修改点数）。 */
export function toolWriteSummary(tool: string, input: PiToolInput): string {
  const filePath = compactPath(input.path);
  if (tool === "write") {
    const content = typeof input.content === "string" ? input.content : "";
    const lineCount = content ? content.split(/\r?\n/).length : 0;
    return [filePath, lineCount ? `${lineCount} 行` : ""].filter(Boolean).join(" · ");
  }
  if (tool === "edit") {
    const oldText = typeof input.oldText === "string" ? input.oldText : "";
    const newText = typeof input.newText === "string" ? input.newText : "";
    const oldLines = oldText ? oldText.split(/\r?\n/).length : 0;
    const newLines = newText ? newText.split(/\r?\n/).length : 0;
    const delta = oldLines || newLines ? `+${newLines} -${oldLines}` : "";
    return [filePath, delta].filter(Boolean).join(" · ");
  }
  if (tool === "hashline_edit") {
    const editCount = Array.isArray(input.edits) ? input.edits.length : 0;
    return [filePath, editCount ? `${editCount} 处修改` : ""].filter(Boolean).join(" · ");
  }
  return "";
}

export type ToolResultPreview =
  | { kind: "diff"; file: string; patch: string; additions: number; deletions: number }
  | { kind: "file"; path: string; content: string };

function diffCountFromText(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

/** 从工具输出文本中提取 unified diff（@@ hunk 起）。 */
export function extractUnifiedDiff(text: string): string {
  const match = String(text || "").match(/^@@\s+[^\n]+@@[\s\S]*$/m);
  return match?.[0]?.trim() || "";
}

/**
 * 无 patch 时用 old/new 文本合成可渲染的 unified diff。
 * 优先按行 LCS 对齐；失败则整块删除+新增。
 */
export function synthesizeUnifiedDiff(oldText: string, newText: string, filePath = "file"): string {
  const oldLines = String(oldText || "").split(/\r?\n/);
  const newLines = String(newText || "").split(/\r?\n/);
  // 空对空无意义
  if (!oldText && !newText) return "";

  const lcs = longestCommonSubsequence(oldLines, newLines);
  const hunk: string[] = [];
  let oi = 0;
  let ni = 0;
  let li = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && oldLines[oi] === lcs[li] && ni < newLines.length && newLines[ni] === lcs[li]) {
      hunk.push(` ${oldLines[oi]}`);
      oi += 1;
      ni += 1;
      li += 1;
      continue;
    }
    if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      hunk.push(`-${oldLines[oi]}`);
      oi += 1;
      continue;
    }
    if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
      hunk.push(`+${newLines[ni]}`);
      ni += 1;
    }
  }

  const file = filePath || "file";
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${Math.max(oldLines.length, 1)} +1,${Math.max(newLines.length, 1)} @@`,
    ...hunk
  ].join("\n");
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  // 限制规模，避免超大文件卡 UI
  if (n * m > 80_000) {
    return [];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push(a[i - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return out.reverse();
}

function buildDiffPreview(file: string, patch: string, details?: Record<string, unknown>): ToolResultPreview | null {
  const normalized = normalizeText(patch);
  if (!normalized) return null;
  const counts = diffCountFromText(normalized);
  const additions =
    typeof details?.addedLines === "number" ? details.addedLines : counts.additions;
  const deletions =
    typeof details?.removedLines === "number" ? details.removedLines : counts.deletions;
  return {
    kind: "diff",
    file,
    patch: normalized,
    additions,
    deletions
  };
}

/** 去掉 pi read 输出的行号前缀（如 "12→" / "  12→"），避免详情里与编辑器行号叠在一起。 */
export function stripReadToolLinePrefixes(text: string): string {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+→/, ""))
    .join("\n");
}

/**
 * 工具结果结构化预览（参考 Moirai getToolResultPreview）：
 * edit/hashline_edit → diff；write 有 content → 全量新增 diff；read → file。
 */
export function getToolResultPreview(
  tool: string,
  input: PiToolInput,
  outputText: string,
  details: Record<string, unknown> | undefined
): ToolResultPreview | null {
  const filePath = normalizeText(input.path) || normalizeText(details?.path) || normalizeText(details?.filePath);

  if (tool === "edit" || tool === "hashline_edit" || tool === "apply_patch") {
    const fromDetails =
      normalizeText(details?.diff) ||
      normalizeText(details?.patch) ||
      extractUnifiedDiff(outputText);
    const preview = buildDiffPreview(filePath, fromDetails, details);
    if (preview) return preview;

    if (tool === "edit") {
      const oldText = typeof input.oldText === "string" ? input.oldText : "";
      const newText = typeof input.newText === "string" ? input.newText : "";
      if (oldText || newText) {
        return buildDiffPreview(filePath, synthesizeUnifiedDiff(oldText, newText, compactPath(filePath) || "file"), details);
      }
    }
    return null;
  }

  if (tool === "write") {
    const content = typeof input.content === "string" ? input.content : "";
    if (content) {
      return buildDiffPreview(filePath, synthesizeUnifiedDiff("", content, compactPath(filePath) || "file"), details);
    }
    return null;
  }

  if (tool === "read" && outputText) {
    return {
      kind: "file",
      path: filePath,
      content: stripReadToolLinePrefixes(outputText)
    };
  }
  return null;
}

export type UnifiedDiffDisplayLine = {
  kind: "context" | "added" | "removed" | "meta";
  content: string;
  lineNumber?: number;
};

/** unified diff → 带行号展示行（added 用新行号，removed 用旧行号）。 */
export function parseUnifiedDiff(diff: string): UnifiedDiffDisplayLine[] {
  const lines: UnifiedDiffDisplayLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of String(diff || "").split(/\r?\n/)) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: "meta", content: raw });
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) {
      lines.push({ kind: "meta", content: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push({ kind: "added", content: raw.slice(1), lineNumber: newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      lines.push({ kind: "removed", content: raw.slice(1), lineNumber: oldLine });
      oldLine += 1;
      continue;
    }
    const content = raw.startsWith(" ") ? raw.slice(1) : raw;
    lines.push({ kind: "context", content, lineNumber: newLine });
    oldLine += 1;
    newLine += 1;
  }
  return lines;
}

/** 压平空白后截断（UI 单行摘要）。 */
export function truncateForUi(text: string, max = MAX_UI_TEXT_CHARS): string {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

/** 保留换行的富文本截断（diff/文件内容）。 */
export function truncateRichText(text: string, max = MAX_UI_RICH_TEXT_CHARS): string {
  const value = String(text || "");
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…（已截断，共 ${value.length} 字符）`;
}

/** 脱敏：api key / Bearer token / 私钥不进入 UI 文本（迁移计划 §8.3）。 */
export function redactSecrets(text: string): string {
  return String(text || "")
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted secret]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted secret]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted secret]")
    .replace(/("?(?:api[_-]?key|access[_-]?token|secret)"?\s*[:=]\s*"?)[^"\s,}]{8,}/gi, "$1[redacted secret]");
}

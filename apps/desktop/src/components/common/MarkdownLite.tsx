import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  CodeBlockContainer,
  CodeBlockCopyButton,
  CodeBlockHeader,
  Streamdown,
  useIsCodeFenceIncomplete
} from "streamdown";
import type { HighlightResult } from "@streamdown/code";
import { cjk as streamdownCjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { math as streamdownMath } from "@streamdown/math";
import { mermaid as streamdownMermaid } from "@streamdown/mermaid";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

const streamdownCode = createCodePlugin({
  themes: ["github-light", "github-dark"]
});

const STREAMDOWN_SHIKI_THEMES = ["github-light", "github-dark"] as const;

const STREAMDOWN_CONTROLS = {
  // 先开代码复制；下载/表格控件仍关，避免工具栏变重、样式冲突再冒出来
  code: { copy: true, download: false },
  table: false,
  mermaid: {
    copy: true,
    download: true,
    fullscreen: false,
    panZoom: true
  }
};

const STREAMDOWN_TRANSLATIONS = {
  copyCode: "复制代码",
  copied: "已复制",
  downloadFile: "下载文件",
  copyTable: "复制表格",
  downloadDiagram: "下载图表",
  viewFullscreen: "全屏查看",
  exitFullscreen: "退出全屏",
  openLink: "打开链接",
  openExternalLink: "打开外部链接",
  copyLink: "复制链接",
  close: "关闭",
  externalLinkWarning: "即将打开外部链接"
};

const STREAMDOWN_PLUGINS = {
  cjk: streamdownCjk,
  code: streamdownCode,
  math: streamdownMath,
  mermaid: streamdownMermaid
};

// 与官方 CodeBlock 行号样式一致（含 block：每行独立成行，否则 token 会横排挤成一行）
const CODE_LINE_NUMBER_CLASS =
  "block before:content-[counter(line)] before:mr-4 before:inline-block before:w-6 before:select-none before:text-right before:font-mono before:text-[13px] before:text-muted-foreground/50 before:[counter-increment:line]";

const FLAT_CODE_CONTAINER_CLASS =
  "gap-0 overflow-hidden bg-background p-0";

const MARKDOWN_INLINE_WRAP_CLASS = "min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere]";
const MARKDOWN_LINK_WRAP_CLASS = "inline break-words text-left font-mono text-[0.94em] [overflow-wrap:anywhere]";
const MERMAID_PREVIEW_MIN_HEIGHT = 220;

const MERMAID_START_RE =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|pie|gitGraph|mindmap|timeline|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic)\b/i;

const MARKDOWN_PROTECTED_SEGMENT_RE = /(`+[^`]*`+|\[[^\]\n]+\]\([^)]+\))/g;

const PLAIN_PATH_RE =
  /(^|[\s([{"'“‘，。；：、])((?:file:\/\/)?\/(?:[^\s`"'<>()[\]{}:，。；：、]+\/)*[^\s`"'<>()[\]{}:，。；：、]+(?::\d+)?|(?:(?:\.{1,2}\/)?(?:[\w@+~.-]+\/)+[\w@+~.-]+(?:\.[A-Za-z0-9][\w.-]*)?(?::\d+)?|[\w@+~.-]+\.[A-Za-z0-9][\w.-]*(?::\d+)?))(?=$|[\s)\]}"'”’，。；:：、])/g;

const URL_RE =
  /(^|[\s([{"'“‘，。；：、])((?:https?:\/\/|www\.)[^\s`"'<>()[\]{}，。；：、]+|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[^\s`"'<>()[\]{}，。；：、]*)?)(?=$|[\s)\]}"'”’，。；：、])/g;

const PREVIEWABLE_FILE_EXTS = new Set([
  "c", "cc", "cjs", "conf", "cpp", "css", "csv", "cts", "doc", "docx", "env", "gif", "go", "gql",
  "graphql", "h", "hh", "hpp", "htm", "html", "ini", "java", "jpeg", "jpg", "js", "json", "jsx",
  "log", "md", "mdx", "mjs", "mts", "pdf", "png", "ppt", "pptx", "py", "rb", "rs", "sass", "scss",
  "sh", "sql", "toml", "ts", "tsx", "txt", "webp", "xls", "xlsx", "xml", "yaml", "yml", "zsh"
]);

type MarkdownLiteProps = {
  source: string;
  streaming?: boolean;
  workspaceRoot?: string;
  workspaceFileCandidates?: string[];
  workspaceDirectoryCandidates?: string[];
  onOpenWorkspacePath?: (path: string, line?: number) => void;
  onOpenWorkspaceDirectory?: (path: string) => void;
  onOpenLocalDirectory?: (absolutePath: string) => void;
  onOpenLocalFile?: (absolutePath: string, line?: number) => void;
};

type NormalizeMarkdownOptions = {
  workspaceRoot?: string;
  workspaceFileCandidates?: string[];
  workspaceDirectoryCandidates?: string[];
};

type ResolvedMarkdownPath =
  | { kind: "workspace-file"; relativePath: string; line?: number }
  | { kind: "workspace-directory"; relativePath: string }
  | { kind: "local-file"; absolutePath: string; line?: number }
  | { kind: "local-directory"; absolutePath: string };

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitPathLine(value: string): { path: string; line?: number } {
  const match = value.match(/^(.+?)(?::(\d+))?$/);
  const line = match?.[2] ? Number(match[2]) : undefined;
  return {
    path: String(match?.[1] || value).trim(),
    line: Number.isFinite(line) && line && line > 0 ? line : undefined
  };
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^workspace:\/\//i, "").replace(/^\.\/+/, "").replace(/^\/+/, "").trim();
}

function normalizeAbsolutePath(value: string): string {
  return value.replace(/^file:\/\//i, "").replace(/\\/g, "/").replace(/\/+$/, "").trim();
}

function filenameExt(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() || "";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function hasPreviewableFileExtension(path: string): boolean {
  const ext = filenameExt(path);
  return Boolean(ext && PREVIEWABLE_FILE_EXTS.has(ext));
}

function looksLikeDirectoryPath(path: string): boolean {
  const normalized = normalizeAbsolutePath(path);
  const name = normalized.split("/").filter(Boolean).pop() || "";
  return Boolean(normalized && !filenameExt(name));
}

function isWorkspaceRelativeFile(path: string, options?: NormalizeMarkdownOptions): boolean {
  return Boolean(resolveWorkspaceRelativeFile(path, options));
}

function resolveWorkspaceRelativeFile(path: string, options?: NormalizeMarkdownOptions): string | null {
  const normalized = normalizeWorkspacePath(path);
  const candidates = options?.workspaceFileCandidates || [];
  if (!normalized) return null;
  const exact = candidates.find((candidate) => normalizeWorkspacePath(candidate) === normalized);
  if (exact) return normalizeWorkspacePath(exact);
  if (!normalized.includes("/")) return null;
  const matches = candidates
    .map((candidate) => normalizeWorkspacePath(candidate))
    .filter((candidate) => candidate.endsWith(`/${normalized}`));
  return matches.length === 1 ? matches[0] : null;
}

function isWorkspaceRelativeDirectory(path: string, options?: NormalizeMarkdownOptions): boolean {
  return Boolean(resolveWorkspaceRelativeDirectory(path, options));
}

function resolveWorkspaceRelativeDirectory(path: string, options?: NormalizeMarkdownOptions): string | null {
  const normalized = normalizeWorkspacePath(path);
  const candidates = options?.workspaceDirectoryCandidates || [];
  if (!normalized) return null;
  const exact = candidates.find((candidate) => normalizeWorkspacePath(candidate) === normalized);
  if (exact) return normalizeWorkspacePath(exact);
  if (!normalized.includes("/")) return null;
  const matches = candidates
    .map((candidate) => normalizeWorkspacePath(candidate))
    .filter((candidate) => candidate.endsWith(`/${normalized}`));
  return matches.length === 1 ? matches[0] : null;
}

function relativePathFromWorkspaceRoot(path: string, options?: NormalizeMarkdownOptions): string | null {
  const root = normalizeAbsolutePath(options?.workspaceRoot || "");
  const absolute = normalizeAbsolutePath(path);
  if (!root || !absolute.startsWith(`${root}/`)) return null;
  return absolute.slice(root.length + 1);
}

function extractLocalPathToken(value: string): string {
  const cleaned = safeDecodeURIComponent(String(value || "").trim())
    .replace(/^file:\/\//i, "file://")
    .replace(/\\(?=\/)/g, "")
    .replace(/\\(?=\s|$|\[)/g, "");
  const match = cleaned.match(/(?:file:\/\/)?(\/[^\s`"'<>()[\]{}\\，。；：、]+(?:\/[^\s`"'<>()[\]{}\\，。；：、]+)*)(?::\d+)?/);
  if (!match) return cleaned;
  const token = match[0] || match[1] || "";
  return token.startsWith("file://") ? token : match[1] || token;
}

function buildWorkspaceHref(relativePath: string, line?: number): string {
  return line ? `workspace://${relativePath}:${line}` : `workspace://${relativePath}`;
}

function resolveMarkdownPath(value: string, options?: NormalizeMarkdownOptions): ResolvedMarkdownPath | null {
  const raw = safeDecodeURIComponent(String(value || "").trim());
  if (!raw || /^(https?:|mailto:|tel:|#)/i.test(raw)) return null;

  const prefersLocalToken = raw.startsWith("/") || /^file:\/\//i.test(raw);
  const candidate = prefersLocalToken ? extractLocalPathToken(raw) : raw;
  const withoutFileScheme = candidate.replace(/^file:\/\//i, "");
  const { path, line } = splitPathLine(withoutFileScheme);
  if (!path) return null;

  const workspaceFile = resolveWorkspaceRelativeFile(path, options);
  if (workspaceFile) {
    return {
      kind: "workspace-file",
      relativePath: workspaceFile,
      line
    };
  }

  const normalizedWorkspacePath = normalizeWorkspacePath(path);
  if (!prefersLocalToken && normalizedWorkspacePath.includes("/") && hasPreviewableFileExtension(normalizedWorkspacePath)) {
    return {
      kind: "workspace-file",
      relativePath: normalizedWorkspacePath,
      line
    };
  }

  const workspaceDirectory = resolveWorkspaceRelativeDirectory(path, options);
  if (workspaceDirectory) {
    return {
      kind: "workspace-directory",
      relativePath: workspaceDirectory
    };
  }

  if (!path.startsWith("/")) return null;

  const absolutePath = normalizeAbsolutePath(path);
  if (!absolutePath.startsWith("/")) return null;

  const workspaceRelative = relativePathFromWorkspaceRoot(absolutePath, options);
  if (workspaceRelative && isWorkspaceRelativeFile(workspaceRelative, options)) {
    return {
      kind: "local-file",
      absolutePath,
      line
    };
  }

  if (workspaceRelative && isWorkspaceRelativeDirectory(workspaceRelative, options)) {
    return {
      kind: "local-directory",
      absolutePath
    };
  }

  if (hasPreviewableFileExtension(absolutePath)) {
    return {
      kind: "local-file",
      absolutePath,
      line
    };
  }

  if (looksLikeDirectoryPath(absolutePath)) {
    return {
      kind: "local-directory",
      absolutePath
    };
  }

  return null;
}

function dedentAccidentallyIndentedBlocks(source: string): string {
  return source
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => {
      if (segment.startsWith("```")) return segment;
      return segment
        .split(/(\n{2,})/g)
        .map((block) => {
          if (!block || /^\n+$/.test(block)) return block;
          const lines = block.split("\n");
          const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
          if (nonEmptyLines.length <= 1) return block;
          if (!nonEmptyLines.every((line) => /^( {4}|\t)/.test(line))) return block;
          return lines.map((line) => (line.trim() ? line.replace(/^( {1,4}|\t)/, "") : line)).join("\n");
        })
        .join("");
    })
    .join("");
}

function looksLikeMermaid(content: string): boolean {
  const firstMeaningfulLine = content.split("\n").map((line) => line.trim()).find(Boolean) || "";
  return MERMAID_START_RE.test(firstMeaningfulLine);
}

function restoreMistaggedFences(source: string): string {
  return source.replace(
    /(^|\n)([ \t]{0,3})(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)\n\2\3(?=\n|$)/g,
    (match, leadingNewline: string, indent: string, fence: string, info: string, content: string) => {
      const language = String(info || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
      if (language) return match;

      const normalizedContent = String(content || "").trim();
      if (!normalizedContent) return match;
      if (looksLikeMermaid(normalizedContent)) {
        return `${leadingNewline}${indent}${fence}mermaid\n${content}\n${indent}${fence}`;
      }
      // 无语言围栏交回官方默认 CodeBlock，不再改写为 text / 自定义渲染器
      return match;
    }
  );
}

function looksLikeRestorableEscapedPathCodeSpan(value: string, options?: NormalizeMarkdownOptions): boolean {
  const raw = String(value || "").trim();
  if (!raw || /[\r\n`]/.test(raw)) return false;
  const localPath = extractLocalPathToken(raw).replace(/^file:\/\//i, "");
  if (localPath.startsWith("/")) return true;
  return Boolean(resolveWorkspaceRelativeFile(raw, options) || resolveWorkspaceRelativeDirectory(raw, options));
}

function restoreEscapedPathCodeSpans(source: string, options?: NormalizeMarkdownOptions): string {
  return source.replace(/\\`([^`\n]+)\\`/g, (match, rawText: string) => {
    const text = String(rawText || "").trim();
    if (!looksLikeRestorableEscapedPathCodeSpan(text, options)) return match;
    return `\`${text}\``;
  });
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/([\\()])/g, "\\$1");
}

function stripTrailingPathPunctuation(value: string): { path: string; suffix: string } {
  const match = value.match(/^(.+?)([.,;:!?，。；：、！？]+)$/);
  return {
    path: match ? match[1] : value,
    suffix: match ? match[2] : ""
  };
}

function shouldAutolinkPlainPath(path: string, options?: NormalizeMarkdownOptions): boolean {
  return Boolean(resolveMarkdownPath(path, options));
}

function autolinkPlainPathsInText(source: string, options?: NormalizeMarkdownOptions): string {
  const withPaths = source.replace(PLAIN_PATH_RE, (match, prefix: string, rawPath: string) => {
    const { path, suffix } = stripTrailingPathPunctuation(String(rawPath || ""));
    if (!path || path.startsWith("http://") || path.startsWith("https://")) return match;
    const resolved = resolveMarkdownPath(path.replace(/^file:\/\//i, ""), options);
    if (!resolved || !shouldAutolinkPlainPath(path.replace(/^file:\/\//i, ""), options)) return match;
    const href = resolved.kind === "workspace-file"
      ? buildWorkspaceHref(resolved.relativePath, resolved.line)
      : resolved.kind === "workspace-directory"
        ? `workspace://${resolved.relativePath}`
        : resolved.kind === "local-file"
          ? `file://${resolved.absolutePath}${resolved.line ? `:${resolved.line}` : ""}`
          : `file://${resolved.absolutePath}`;
    return `${prefix}[${escapeMarkdownLabel(path)}](${escapeMarkdownDestination(href)})${suffix}`;
  });
  return withPaths.replace(URL_RE, (match, prefix: string, rawUrl: string) => {
    const { path: url, suffix } = stripTrailingPathPunctuation(String(rawUrl || ""));
    if (!url || /^\w+:\/\//.test(url) && !/^https?:\/\//i.test(url)) return match;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return `${prefix}[${escapeMarkdownLabel(url)}](${escapeMarkdownDestination(href)})${suffix}`;
  });
}

function autolinkPlainPaths(source: string, options?: NormalizeMarkdownOptions): string {
  return source
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment) => {
      if (segment.startsWith("```") || segment.startsWith("~~~")) return segment;
      return segment
        .split(MARKDOWN_PROTECTED_SEGMENT_RE)
        .map((part) => {
          if (!part || part.startsWith("`") || /^\[[^\]\n]+\]\([^)]+\)$/.test(part)) return part;
          return autolinkPlainPathsInText(part, options);
        })
        .join("");
    })
    .join("");
}

function normalizeMarkdownSource(source: string, options?: NormalizeMarkdownOptions): string {
  return autolinkPlainPaths(
    restoreEscapedPathCodeSpans(
      restoreMistaggedFences(dedentAccidentallyIndentedBlocks(String(source || "").replace(/\r\n/g, "\n"))),
      options
    ),
    options
  ).trim();
}

function getInlineText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(getInlineText).join("");
  if (value && typeof value === "object" && "props" in value) {
    return getInlineText((value as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

function extractFenceCode(children: unknown): string {
  if (typeof children === "string") return children;
  if (isValidElement(children)) {
    const childProps = children.props as { children?: unknown };
    if (typeof childProps.children === "string") return childProps.children;
  }
  return getInlineText(children);
}

function trimTrailingNewline(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "\n") end -= 1;
  return value.slice(0, end);
}

function parseFenceMeta(className: string | undefined, metastring: unknown): {
  language: string;
  startLine?: number;
  lineNumbers: boolean;
} {
  const language = String(className || "").match(/language-([^\s]+)/)?.[1] || "";
  const meta = typeof metastring === "string" ? metastring : "";
  const startMatch = meta.match(/startLine=(\d+)/);
  const startLineRaw = startMatch ? Number.parseInt(startMatch[1], 10) : undefined;
  const startLine = startLineRaw && startLineRaw >= 1 ? startLineRaw : undefined;
  const lineNumbers = !/\bnoLineNumbers\b/.test(meta);
  return { language, startLine, lineNumbers };
}

function buildPlainHighlightResult(code: string): HighlightResult {
  return {
    bg: "transparent",
    fg: "inherit",
    tokens: code.split("\n").map((line) => [
      {
        content: line,
        color: "inherit",
        bgColor: "transparent",
        htmlStyle: {},
        offset: 0
      }
    ])
  } as HighlightResult;
}

function FlatHighlightedBody({
  code,
  language,
  lineNumbers,
  startLine
}: {
  code: string;
  language: string;
  lineNumbers: boolean;
  startLine?: number;
}) {
  const trimmed = useMemo(() => trimTrailingNewline(code), [code]);
  const fallback = useMemo(() => buildPlainHighlightResult(trimmed), [trimmed]);
  const [result, setResult] = useState<HighlightResult>(fallback);

  useEffect(() => {
    setResult(fallback);
    const sync = streamdownCode.highlight(
      {
        code: trimmed,
        language: language as never,
        themes: [...STREAMDOWN_SHIKI_THEMES]
      },
      (next) => setResult(next)
    );
    if (sync) setResult(sync);
  }, [trimmed, language, fallback]);

  const rootStyle = useMemo(() => {
    const style: Record<string, string> = {};
    if (result.bg) style["--sdm-bg"] = String(result.bg);
    if (result.fg) style["--sdm-fg"] = String(result.fg);
    return style;
  }, [result.bg, result.fg]);

  return (
    <div
      className="overflow-x-auto p-4 text-sm"
      data-language={language}
      data-streamdown="code-block-body"
    >
      <pre
        className="bg-[var(--sdm-bg,inherit)] dark:bg-[var(--shiki-dark-bg,var(--sdm-bg,inherit))]"
        style={rootStyle}
      >
        <code
          className={lineNumbers ? "[counter-increment:line_0] [counter-reset:line]" : undefined}
          style={lineNumbers && startLine && startLine > 1 ? { counterReset: `line ${startLine - 1}` } : undefined}
        >
          {result.tokens.map((line, lineIndex) => {
            const isEmpty = line.length === 0 || (line.length === 1 && line[0]?.content === "");
            const lineNodes = isEmpty
              ? "\n"
              : line.map((token, tokenIndex) => {
                  const style: Record<string, string> = {};
                  let hasBg = Boolean(token.bgColor);
                  if (token.color) style["--sdm-c"] = String(token.color);
                  if (token.bgColor) style["--sdm-tbg"] = String(token.bgColor);
                  if (token.htmlStyle) {
                    for (const [key, value] of Object.entries(token.htmlStyle)) {
                      if (key === "color") style["--sdm-c"] = String(value);
                      else if (key === "background-color") {
                        style["--sdm-tbg"] = String(value);
                        hasBg = true;
                      } else style[key] = String(value);
                    }
                  }
                  return (
                    <span
                      className={cn(
                        "text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]",
                        hasBg && "bg-[var(--sdm-tbg)] dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]"
                      )}
                      key={tokenIndex}
                      style={style}
                    >
                      {token.content}
                    </span>
                  );
                });
            // 无行号时官方靠换行符断行；有行号时靠 span.block 断行
            return (
              <span className={lineNumbers ? CODE_LINE_NUMBER_CLASS : undefined} key={lineIndex}>
                {lineNodes}
                {!lineNumbers && !isEmpty && lineIndex < result.tokens.length - 1 ? "\n" : null}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

function FlatMermaidBody({ chart }: { chart: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    void streamdownMermaid
      .getMermaid()
      .render(id, chart)
      .then(({ svg }) => {
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
      })
      .catch((error) => {
        if (cancelled || !hostRef.current) return;
        hostRef.current.textContent = String(error || "Mermaid render failed");
      });
    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div
      className="overflow-x-auto p-4"
      ref={hostRef}
      style={{ minHeight: MERMAID_PREVIEW_MIN_HEIGHT }}
    />
  );
}

function FlatFenceBlock({
  code,
  language,
  lineNumbers,
  startLine,
  mermaid
}: {
  code: string;
  language: string;
  lineNumbers: boolean;
  startLine?: number;
  mermaid?: boolean;
}) {
  const isIncomplete = useIsCodeFenceIncomplete();
  const label = language || (mermaid ? "mermaid" : "text");

  return (
    <CodeBlockContainer
      className={FLAT_CODE_CONTAINER_CLASS}
      isIncomplete={isIncomplete}
      language={label}
    >
      <div className="flex h-8 items-center justify-between border-b border-border px-2">
        <CodeBlockHeader language={label} />
        <div className="flex shrink-0 items-center gap-1">
          <CodeBlockCopyButton code={code} />
        </div>
      </div>
      {mermaid ? (
        <FlatMermaidBody chart={code} />
      ) : (
        <FlatHighlightedBody
          code={code}
          language={language || "text"}
          lineNumbers={lineNumbers}
          startLine={startLine}
        />
      )}
    </CodeBlockContainer>
  );
}

function getPathDisplayName(path: string, line?: number): string {
  const normalized = path.replace(/^file:\/\//i, "").replace(/\\/g, "/").replace(/\/+$/, "");
  const name = normalized.split("/").filter(Boolean).pop() || normalized || path;
  return line ? `${name}:${line}` : name;
}

function isMermaidCodeBlock(value: unknown): boolean {
  if (!isValidElement(value)) return false;
  const className = String((value.props as { className?: string }).className || "");
  return /\blanguage-mermaid\b/.test(className);
}

function renderPreBlock(children: any) {
  if (!isValidElement(children)) return children;
  const block = cloneElement(children, { "data-block": "true" } as any);
  // FlatFenceBlock 自带高度；这里只负责给 fence code 打上 data-block 标记
  if (isMermaidCodeBlock(children)) {
    return <div style={{ minHeight: MERMAID_PREVIEW_MIN_HEIGHT }}>{block}</div>;
  }
  return block;
}

function renderPathButton(
  target: ResolvedMarkdownPath,
  children: any,
  props: MarkdownLiteProps,
  compact = false
) {
  const className = MARKDOWN_LINK_WRAP_CLASS;
  const content = compact ? getPathDisplayName(
    target.kind === "local-directory" || target.kind === "local-file" ? target.absolutePath : target.relativePath,
    target.kind === "local-file" || target.kind === "workspace-file" ? target.line : undefined
  ) : children;
  if (target.kind === "local-directory" && props.onOpenLocalDirectory) {
    return (
      <Button
        className={className}
        title={target.absolutePath}
        onClick={() => props.onOpenLocalDirectory?.(target.absolutePath)}
        variant="link"
        size="inline"
      >
        {content}
      </Button>
    );
  }

  if (target.kind === "local-file" && props.onOpenLocalFile) {
    return (
      <Button
        className={className}
        title={target.absolutePath}
        onClick={() => props.onOpenLocalFile?.(target.absolutePath, target.line)}
        variant="link"
        size="inline"
      >
        {content}
      </Button>
    );
  }

  if (target.kind === "workspace-file" && props.onOpenWorkspacePath) {
    return (
      <Button
        className={className}
        title={target.relativePath}
        onClick={() => props.onOpenWorkspacePath?.(target.relativePath, target.line)}
        variant="link"
        size="inline"
      >
        {content}
      </Button>
    );
  }

  if (target.kind === "workspace-directory" && props.onOpenWorkspaceDirectory) {
    return (
      <Button
        className={className}
        title={target.relativePath}
        onClick={() => props.onOpenWorkspaceDirectory?.(target.relativePath)}
        variant="link"
        size="inline"
      >
        {content}
      </Button>
    );
  }

  return null;
}

export function MarkdownLite(props: MarkdownLiteProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const markdownOptions = useMemo(
    () => ({
      workspaceRoot: props.workspaceRoot,
      workspaceFileCandidates: props.workspaceFileCandidates,
      workspaceDirectoryCandidates: props.workspaceDirectoryCandidates
    }),
    [props.workspaceRoot, props.workspaceFileCandidates, props.workspaceDirectoryCandidates]
  );
  const text = useMemo(() => normalizeMarkdownSource(props.source, markdownOptions), [props.source, markdownOptions]);
  const components = useMemo(
    () => ({
      inlineCode: ({ children, node: _node, ...codeProps }: any) => {
        const rawText = getInlineText(children).trim();
        const resolved = rawText ? resolveMarkdownPath(rawText, markdownOptions) : null;
        const pathButton = resolved ? renderPathButton(resolved, children, propsRef.current, true) : null;
        if (pathButton) return pathButton;

        return (
          <code data-streamdown="inline-code" {...codeProps} className={cn(codeProps.className, MARKDOWN_INLINE_WRAP_CLASS)}>
            {children}
          </code>
        );
      },
      // 官方默认是 sidebar 外壳 + 内层白盒双边框；按 Components 文档用导出原语拼成单层壳
      // （见 https://streamdown.ai/docs/components），避免 CSS 选择器硬盖。
      code: ({ node, className, children, ...rest }: any) => {
        const isInline = !("data-block" in rest);
        if (isInline) {
          const rawText = getInlineText(children).trim();
          const resolved = rawText ? resolveMarkdownPath(rawText, markdownOptions) : null;
          const pathButton = resolved ? renderPathButton(resolved, children, propsRef.current, true) : null;
          if (pathButton) return pathButton;
          return (
            <code data-streamdown="inline-code" className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)} {...rest}>
              {children}
            </code>
          );
        }

        const metastring = (node as { properties?: { metastring?: unknown } } | undefined)?.properties?.metastring;
        const { language, startLine, lineNumbers } = parseFenceMeta(className, metastring);
        const code = extractFenceCode(children);
        return (
          <FlatFenceBlock
            code={code}
            language={language}
            lineNumbers={lineNumbers}
            mermaid={language === "mermaid"}
            startLine={startLine}
          />
        );
      },
      table: ({ children, className, node: _node, ...tableProps }: any) => (
        <div className="my-4 overflow-hidden rounded-xl border border-border" data-streamdown="table-wrapper">
          <div className="overflow-x-auto">
            <table
              className={cn("w-full divide-y divide-border", className)}
              data-streamdown="table"
              {...tableProps}
            >
              {children}
            </table>
          </div>
        </div>
      ),
      pre: ({ children }: any) => renderPreBlock(children),
      a: ({ href, children, node: _node, ...anchorProps }: any) => {
        const rawHref = String(href || "").trim();
        const resolved = rawHref ? resolveMarkdownPath(rawHref, markdownOptions) : null;
        const pathButton = resolved ? renderPathButton(resolved, children, propsRef.current) : null;
        if (pathButton) return pathButton;

        if (!rawHref) return <span>{children}</span>;

        const external = /^(https?:)?\/\//i.test(rawHref);
        return (
          <a
            href={rawHref}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            {...anchorProps}
            className={cn(anchorProps.className, MARKDOWN_INLINE_WRAP_CLASS)}
          >
            {children}
          </a>
        );
      }
    }),
    [markdownOptions]
  );
  if (!text) return <p className="muted">等待上下文加载...</p>;

  return (
    <div className="markdown-lite min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      <Streamdown
        caret={props.streaming ? "block" : undefined}
        controls={STREAMDOWN_CONTROLS}
        dir="auto"
        isAnimating={Boolean(props.streaming)}
        lineNumbers
        mode={props.streaming ? "streaming" : "static"}
        normalizeHtmlIndentation
        parseIncompleteMarkdown={Boolean(props.streaming)}
        plugins={STREAMDOWN_PLUGINS}
        components={components}
        translations={STREAMDOWN_TRANSLATIONS}
      >
        {text}
      </Streamdown>
    </div>
  );
}

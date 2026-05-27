import { Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownLiteProps = {
  source: string;
  onOpenWorkspacePath?: (absolutePath: string, line?: number) => void;
};

function parseLocalFileHref(href: string): { absolutePath: string; line?: number } | null {
  const raw = decodeURIComponent(String(href || "").trim());
  if (!raw) return null;
  if (/^(https?:|mailto:|tel:|#)/i.test(raw)) return null;
  const withoutFileScheme = raw.replace(/^file:\/\//i, "");
  const match = withoutFileScheme.match(/^(\/.+?)(?::(\d+))?(?::\d+)?$/);
  if (!match) return null;
  const absolutePath = String(match[1] || "").trim();
  if (!absolutePath.startsWith("/")) return null;
  const line = match[2] ? Number(match[2]) : undefined;
  return {
    absolutePath,
    line: Number.isFinite(line) && line && line > 0 ? line : undefined
  };
}

function childrenToText(children: unknown): string {
  return Children.toArray(children as React.ReactNode).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement(child)) return childrenToText((child.props as { children?: unknown })?.children);
    return "";
  }).join("").trim();
}

export function MarkdownLite(props: MarkdownLiteProps) {
  const text = props.source.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  if (!text) return <p className="muted">等待上下文加载...</p>;

  return (
    <div className="markdown-lite">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...anchorProps }) => {
            const localFile = href ? parseLocalFileHref(String(href)) : null;
            if (localFile && props.onOpenWorkspacePath) {
              const label = childrenToText(children) || `${localFile.absolutePath}${localFile.line ? `:${localFile.line}` : ""}`;
              const title = `${localFile.absolutePath}${localFile.line ? ` (line ${localFile.line})` : ""}`;
              return (
                <button
                  type="button"
                  className="markdown-file-link"
                  title={title}
                  onClick={() => props.onOpenWorkspacePath?.(localFile.absolutePath, localFile.line)}
                >
                  <span className="markdown-file-link-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16">
                      <path d="M8 2.25 9.25 5.3 12.5 6 9.9 8.15 10.65 11.4 8 9.75 5.35 11.4 6.1 8.15 3.5 6 6.75 5.3 8 2.25Z" />
                    </svg>
                  </span>
                  <span>{label}</span>
                </button>
              );
            }
            return <a href={href} {...anchorProps}>{children}</a>;
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

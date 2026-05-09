import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownLite(props: { source: string }) {
  const text = props.source.replace(/\r\n/g, "\n").replace(/\\n/g, "\n").trim();
  if (!text) return <p className="muted">等待上下文加载...</p>;

  return (
    <div className="markdown-lite">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

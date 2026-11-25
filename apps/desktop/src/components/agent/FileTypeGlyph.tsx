import { cn } from "../../lib/utils";

type FileKind = "docx" | "doc" | "pdf" | "xlsx" | "xls" | "csv" | "pptx" | "ppt" | "md" | "txt" | "code" | "file";

const KIND_STYLE: Record<FileKind, { label: string; className: string }> = {
  docx: { label: "W", className: "bg-[#2B579A] text-white" },
  doc: { label: "W", className: "bg-[#2B579A] text-white" },
  pdf: { label: "PDF", className: "bg-[#E5252A] text-white" },
  xlsx: { label: "X", className: "bg-[#217346] text-white" },
  xls: { label: "X", className: "bg-[#217346] text-white" },
  csv: { label: "CSV", className: "bg-[#217346] text-white" },
  pptx: { label: "P", className: "bg-[#C43E1C] text-white" },
  ppt: { label: "P", className: "bg-[#C43E1C] text-white" },
  md: { label: "MD", className: "bg-slate-600 text-white" },
  txt: { label: "TXT", className: "bg-slate-500 text-white" },
  code: { label: "{ }", className: "bg-violet-700 text-white" },
  file: { label: "FILE", className: "bg-muted text-muted-foreground" }
};

function filenameExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function resolveFileKind(filename?: string, mime?: string): FileKind {
  const ext = filenameExt(filename || "");
  const normalized = String(mime || "").toLowerCase();
  if (ext === "docx" || normalized.includes("wordprocessingml")) return "docx";
  if (ext === "doc" || normalized === "application/msword") return "doc";
  if (ext === "pdf" || normalized === "application/pdf") return "pdf";
  if (ext === "xlsx" || normalized.includes("spreadsheetml")) return "xlsx";
  if (ext === "xls" || normalized === "application/vnd.ms-excel") return "xls";
  if (ext === "csv" || normalized === "text/csv") return "csv";
  if (ext === "pptx" || normalized.includes("presentationml")) return "pptx";
  if (ext === "ppt" || normalized === "application/vnd.ms-powerpoint") return "ppt";
  if (ext === "md" || ext === "markdown" || ext === "mdx" || normalized.includes("markdown")) return "md";
  if (ext === "txt" || normalized.startsWith("text/plain")) return "txt";
  if (
    ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "json", "toml", "yaml", "yml"].includes(ext)
    || normalized.includes("javascript")
    || normalized.includes("typescript")
    || normalized.includes("json")
  ) {
    return "code";
  }
  return "file";
}

/** 文件类型辨识徽标（Word 蓝 W / Excel 绿 X / PDF 红等），避免通用文档描边图标。 */
export function FileTypeGlyph({
  filename,
  mime,
  size = "md",
  className
}: {
  filename?: string;
  mime?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const kind = resolveFileKind(filename, mime);
  const style = KIND_STYLE[kind];
  const sizeClass =
    size === "sm"
      ? "size-5 rounded text-[8px]"
      : size === "lg"
        ? "size-10 rounded-xl text-[12px]"
        : "size-8 rounded-lg text-[10px]";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-bold tracking-tight shadow-sm",
        sizeClass,
        style.className,
        className
      )}
      aria-hidden="true"
      title={filename || style.label}
    >
      {style.label}
    </span>
  );
}

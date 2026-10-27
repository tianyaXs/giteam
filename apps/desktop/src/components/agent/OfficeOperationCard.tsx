import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Loader2, Presentation, Table2, TriangleAlert, FileText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseSelectionRange } from "../../lib/agent/toolPresentation";
import type { AgentDetailedPart } from "../../lib/agentSessions";

/**
 * office 工具合并操作卡：read/write_xlsx（后续 docx/pptx/pdf 同型）等
 * 文件类工具的连续事件折叠为一张「正在操作文件」卡片，按文件类型给出
 * 不同的微缩视觉——表格网格（含选区跟随 + 操作光标）、文档行 + 打字光标、
 * 幻灯片叠层。右侧实时预览展示真实内容，这张卡是消息流里的"操作感"。
 */

type OfficeKind = "excel" | "word" | "ppt" | "pdf" | "file";

type OfficeMeta = {
  kind: OfficeKind;
  icon: LucideIcon;
  /** 类型色（badge/选区/网格光标共用）。 */
  accentText: string;
  accentBadge: string;
  accentBorder: string;
  activeLabel: string;
  readLabel: string;
  doneLabel: string;
  noun: string;
};

function officeMetaFromTool(tool: string): OfficeMeta | null {
  if (/xlsx$/.test(tool)) return officeMetaFromPath("a.xlsx");
  if (/docx$/.test(tool)) return officeMetaFromPath("a.docx");
  if (/pptx$/.test(tool)) return officeMetaFromPath("a.pptx");
  return null;
}

function officeMetaFromPath(path: string): OfficeMeta {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    return {
      kind: "excel",
      icon: Table2,
      accentText: "text-emerald-600 dark:text-emerald-400",
      accentBadge: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
      accentBorder: "border-emerald-500/40",
      activeLabel: "编辑表格中",
      readLabel: "读取表格中",
      doneLabel: "表格已保存",
      noun: "表格",
    };
  }
  if (ext === "docx" || ext === "doc") {
    return {
      kind: "word",
      icon: FileText,
      accentText: "text-blue-600 dark:text-blue-400",
      accentBadge: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
      accentBorder: "border-blue-500/40",
      activeLabel: "撰写文档中",
      readLabel: "读取文档中",
      doneLabel: "文档已保存",
      noun: "文档",
    };
  }
  if (ext === "pptx" || ext === "ppt") {
    return {
      kind: "ppt",
      icon: Presentation,
      accentText: "text-orange-600 dark:text-orange-400",
      accentBadge: "bg-orange-500/12 text-orange-600 dark:text-orange-400",
      accentBorder: "border-orange-500/40",
      activeLabel: "制作幻灯片中",
      readLabel: "读取幻灯片中",
      doneLabel: "幻灯片已保存",
      noun: "幻灯片",
    };
  }
  if (ext === "pdf") {
    return {
      kind: "pdf",
      icon: FileText,
      accentText: "text-rose-600 dark:text-rose-400",
      accentBadge: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
      accentBorder: "border-rose-500/40",
      activeLabel: "生成 PDF 中",
      readLabel: "读取 PDF 中",
      doneLabel: "PDF 已保存",
      noun: "PDF",
    };
  }
  return {
    kind: "file",
    icon: FileText,
    accentText: "text-muted-foreground",
    accentBadge: "bg-muted text-muted-foreground",
    accentBorder: "border-border",
    activeLabel: "处理文件中",
    readLabel: "读取文件中",
    doneLabel: "文件已保存",
    noun: "文件",
  };
}

function partStatus(part: AgentDetailedPart): "running" | "error" | "done" {
  const status = String((part as { status?: string }).status || "").toLowerCase();
  if (status === "error" || (part as { isError?: boolean }).isError) return "error";
  if (status === "running" || status === "pending" || status === "deciding") return "running";
  return "done";
}

function fileNameFromPath(path: string): string {
  return path.replace(/:\d+$/, "").split(/[\\/]/).filter(Boolean).pop() || path;
}

/** 提取 write_xlsx 的首个工作表规模（网格视觉的行数依据）。 */
function firstSheetRowCount(part: AgentDetailedPart): number {
  const input = (part as { input?: { sheets?: unknown } }).input;
  const sheets = input?.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) return 0;
  const rows = (sheets[0] as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows.length : 0;
}

/** 表格微缩网格：4×6；选区区域着色；运行中末格是"操作光标"（呼吸），完成后静止。 */
function ExcelGridVisual({
  range,
  accentBorder,
  hasData,
  active
}: {
  range: string;
  accentBorder: string;
  hasData: boolean;
  active: boolean;
}) {
  const bounds = parseSelectionRange(range);
  const gridRows = 4;
  const gridCols = 6;
  // 选区映射到微缩网格（等比例压缩到网格范围）。
  const mapped = bounds
    ? {
        r1: Math.min(gridRows - 1, Math.round((bounds.r1 / Math.max(bounds.r2 + 1, 1)) * (gridRows - 1))),
        c1: Math.min(gridCols - 1, Math.round((bounds.c1 / Math.max(bounds.c2 + 1, 1)) * (gridCols - 1))),
        r2: Math.min(gridRows - 1, Math.round((bounds.r2 / Math.max(bounds.r2 + 1, 1)) * (gridRows - 1))),
        c2: Math.min(gridCols - 1, Math.round((bounds.c2 / Math.max(bounds.c2 + 1, 1)) * (gridCols - 1))),
      }
    : null;
  const cursorRow = mapped ? mapped.r2 : hasData ? 1 : 0;
  const cursorCol = mapped ? mapped.c2 : 1;
  return (
    <div className="grid grid-cols-6 gap-1" aria-hidden>
      {Array.from({ length: gridRows * gridCols }, (_, index) => {
        const r = Math.floor(index / gridCols);
        const c = index % gridCols;
        const inSelection = Boolean(
          mapped && r >= mapped.r1 && r <= mapped.r2 && c >= mapped.c1 && c <= mapped.c2
        );
        const isCursor = active && r === cursorRow && c === cursorCol;
        return (
          <div
            key={index}
            className={cn(
              "h-3.5 rounded-[3px] border transition-colors duration-300",
              inSelection
                ? cn(accentBorder, "bg-muted-foreground/10")
                : "border-border/70 bg-muted/40",
              isCursor && "office-grid-cursor"
            )}
          />
        );
      })}
    </div>
  );
}

/** 文档微缩视觉：渐短行 + 打字光标。 */
function WordLinesVisual({ active }: { active: boolean }) {
  const widths = ["w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"];
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      {widths.map((width, index) => (
        <div key={index} className="flex items-center gap-1">
          <div className={cn("h-1.5 rounded-full bg-muted-foreground/20", width)} />
          {active && index === widths.length - 1 ? (
            <span className="office-caret inline-block h-3 w-[2px] rounded-[1px] bg-blue-500" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 幻灯片微缩视觉：叠层 + 顶片高亮。 */
function PptStackVisual({ accentBorder }: { accentBorder: string }) {
  return (
    <div className="relative h-14 w-24" aria-hidden>
      <div className="absolute inset-x-4 bottom-0 h-10 rotate-3 rounded-md border border-border/70 bg-muted/40" />
      <div className="absolute inset-x-2 bottom-0.5 h-10 -rotate-2 rounded-md border border-border/70 bg-muted/60" />
      <div
        className={cn(
          "absolute inset-x-0 bottom-1 flex h-11 items-center justify-center rounded-md border-2 bg-card",
          accentBorder
        )}
      >
        <div className="h-1.5 w-12 rounded-full bg-muted-foreground/25" />
      </div>
    </div>
  );
}

export function OfficeOperationCard({
  parts,
  running,
  onOpenFile,
}: {
  parts: AgentDetailedPart[];
  running: boolean;
  /** 点击卡片在右侧面板打开该文件的实时预览（AgentMessageStream 传 onOpenToolFile）。 */
  onOpenFile?: (path: string) => void;
}) {
  // 最新带 details 的 part 代表当前操作步；错误任一步即整卡转错误态。
  const latest = [...parts].reverse().find((part) => {
    const input = (part as { input?: { path?: unknown } }).input;
    const details = (part as { details?: Record<string, unknown> }).details;
    return Boolean(input?.path || details?.path);
  }) || parts[parts.length - 1];
  const errored = parts.find((part) => partStatus(part) === "error");
  const isRead = String(latest?.toolName || "").startsWith("read_");
  const input = ((latest as { input?: Record<string, unknown> })?.input || {}) as Record<string, unknown>;
  const details = ((latest as { details?: Record<string, unknown> })?.details || {}) as Record<string, unknown>;
  const rawPath = String(input.path || details.path || "").trim();
  const fileName = rawPath ? fileNameFromPath(rawPath) : "";
  // 路径未达（如 toolCall.started 首帧）时按工具名后缀推断类型，卡片不退化为无类型。
  const meta = fileName
    ? officeMetaFromPath(fileName)
    : officeMetaFromTool(String(latest?.toolName || "")) || officeMetaFromPath("");
  const Icon = meta.icon;

  const percentRaw = typeof details.percent === "number" ? details.percent : null;
  const percent = percentRaw === null ? null : Math.max(0, Math.min(100, Math.round(percentRaw)));
  const message = String(details.message || "").trim();
  const sheet = typeof details.sheet === "string" ? details.sheet.trim() : "";
  const range = typeof details.range === "string" ? details.range.trim() : "";
  const sheetRowCount = firstSheetRowCount(latest);

  // 状态区分：读取完成 =「已读取」，写入完成才是「已保存」——阅读不该被说成保存。
  const statusLabel = errored
    ? "操作失败"
    : running
      ? isRead
        ? meta.readLabel
        : meta.activeLabel
      : isRead
        ? "已读取"
        : meta.doneLabel;

  const clickable = Boolean(onOpenFile && rawPath);
  const clickHandlers = {
    role: clickable ? "button" as const : undefined,
    tabIndex: clickable ? 0 : undefined,
    onClick: clickable ? () => onOpenFile?.(rawPath) : undefined,
    onKeyDown: clickable
      ? (event: ReactKeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenFile?.(rawPath);
          }
        }
      : undefined
  };

  // 完成态紧凑单行：一线产品惯例——进行中的卡才展开操作视觉，完成后收成一行摘要。
  if (!running && !errored) {
    return (
      <div
        {...clickHandlers}
        className={cn(
          "flex items-center gap-2.5 overflow-hidden rounded-xl border border-border bg-card px-3 py-2 transition-colors duration-300",
          clickable && "cursor-pointer hover:border-foreground/25 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-lg",
            meta.accentBadge
          )}
        >
          <Icon className="size-3.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={rawPath || fileName}>
          {fileName || meta.noun}
        </span>
        {parts.length > 1 ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            {parts.length} 步
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">{meta.doneLabel}</span>
        {clickable ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/60">预览</span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      {...clickHandlers}
      className={cn(
        "overflow-hidden rounded-xl border bg-card transition-colors duration-300",
        errored ? "border-destructive/40" : "border-border",
        running && !errored && "shadow-[0_0_0_1px_rgb(16_185_129/0.08),0_1px_8px_rgb(0_0_0/0.04)]",
        clickable && "cursor-pointer hover:border-foreground/25 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {/* 头部：类型徽标 + 文件名（点击打开预览） + 状态 + 百分比 */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
            meta.accentBadge
          )}
        >
          <Icon className="size-4" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={rawPath || fileName}>
          {fileName || meta.noun}
          {clickable ? (
            <span className="ml-1.5 select-none text-[10px] text-muted-foreground/60">预览</span>
          ) : null}
        </span>
        {running && parts.length > 1 ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            {parts.length} 步
          </span>
        ) : null}
        {running ? (
          <Loader2 className={cn("size-3.5 shrink-0 animate-spin", meta.accentText)} />
        ) : errored ? (
          <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : null}
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            errored ? "text-destructive" : running ? meta.accentText : "text-muted-foreground"
          )}
        >
          {statusLabel}
        </span>
        {percent !== null && running ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {percent}%
          </span>
        ) : null}
      </div>

      {/* 身体：按文件类型的微缩操作视觉 */}
      {!errored ? (
        <div className="flex items-center gap-3 border-t border-border/60 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            {meta.kind === "excel" ? (
              <ExcelGridVisual
                range={range}
                accentBorder={meta.accentBorder}
                hasData={sheetRowCount > 0}
                active={running}
              />
            ) : meta.kind === "word" ? (
              <WordLinesVisual active={running} />
            ) : meta.kind === "ppt" ? (
              <PptStackVisual accentBorder={meta.accentBorder} />
            ) : (
              <WordLinesVisual active={running} />
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {meta.kind === "excel" && sheet ? (
              <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", meta.accentBadge)}>
                {sheet}
                {range ? ` · ${range}` : ""}
              </span>
            ) : null}
            {percent !== null ? (
              <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-500 ease-out", running ? "bg-foreground/60" : "bg-muted-foreground/40")}
                  style={{ width: `${percent}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 底部：阶段消息 / 错误文本 */}
      {errored ? (
        <div className="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {(() => {
            const output = String((errored as { output?: unknown }).output || "");
            const snippet = output.length > 220 ? `${output.slice(0, 220)}…` : output;
            return snippet || "操作失败，请查看工具输出。";
          })()}
        </div>
      ) : message ? (
        <div className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          {message}
        </div>
      ) : null}

      {/* 运行中细进度条 */}
      {running && !errored && percent !== null ? (
        <div className="h-0.5 w-full overflow-hidden bg-transparent" aria-hidden>
          <div
            className="h-full bg-primary/50 transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

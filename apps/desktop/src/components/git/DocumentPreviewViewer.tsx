import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { renderAsync } from "docx-preview";
import * as XLSX from "xlsx";
import "@cyntler/react-doc-viewer/dist/index.css";
import { cn } from "@/lib/utils";
import { parseSelectionRange } from "../../lib/agent/toolPresentation";
import type { GitWorktreeFileContent } from "../../lib/types";
import { MarkdownLite } from "../common/MarkdownLite";
import { Card, CardContent } from "../ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

type DocumentPreviewViewerProps = {
  filePath: string;
  content: GitWorktreeFileContent;
};

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path || "attachment";
}

function extensionFromName(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function blobFromBase64(base64: string, mime?: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

/** 幻灯片 XML 内文反转义（机器生成文件常见实体 + 数字引用）。 */
function decodeXmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

type SlidePreview = { index: number; title: string; bullets: string[] };

async function parseSlides(base64: string): Promise<SlidePreview[]> {
  const zip = await JSZip.loadAsync(base64ToUint8Array(base64));
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] || 0);
      const nb = Number(b.match(/(\d+)/)?.[1] || 0);
      return na - nb;
    });
  const slides: SlidePreview[] = [];
  for (const [i, name] of names.entries()) {
    const xml = (await zip.file(name)?.async("string")) || "";
    const texts = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
      .map((match) => decodeXmlEntities(match[1]).trim())
      .filter(Boolean);
    slides.push({
      index: i + 1,
      title: texts[0] || `第 ${i + 1} 页`,
      bullets: texts.slice(1)
    });
  }
  return slides;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function textFromBase64(base64: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(base64ToUint8Array(base64));
  } catch {
    return "";
  }
}

function parseXlsxWorkbook(base64: string): XLSX.WorkBook | null {
  try {
    const data = base64ToUint8Array(base64);
    return XLSX.read(data, { type: "array" });
  } catch {
    return null;
  }
}

function getSheetData(workbook: XLSX.WorkBook, sheetName: string): (string | number | null)[][] {
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as (string | number | null)[][];
}

function PreviewEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-60 border-0">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function PreviewShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className={cn("h-full min-h-0 border-0 bg-background shadow-none", className)}>
      <CardContent className="h-full min-h-0 p-0">{children}</CardContent>
    </Card>
  );
}

export function DocumentPreviewViewer({ filePath, content }: DocumentPreviewViewerProps) {
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [docxError, setDocxError] = useState("");
  const fileName = fileNameFromPath(filePath);
  const ext = extensionFromName(fileName);
  const isMarkdown = ext === "md" || ext === "markdown" || ext === "mdx" || content.previewKind === "markdown";
  const isDocx = ext === "docx" && content.dataBase64;
  const isSpreadsheet = (ext === "xlsx" || ext === "xls" || ext === "csv") && content.dataBase64;
  const isSlides = ext === "pptx" && content.dataBase64;
  const [slidesData, setSlidesData] = useState<SlidePreview[]>([]);
  const [slidesError, setSlidesError] = useState("");
  const slidesContainerRef = useRef<HTMLDivElement | null>(null);
  // 跟随 agent 正在写的页（office hint: sheet = "slide:N"）。
  const activeSlide = useMemo(() => {
    const hint = content.office?.sheet;
    const match = typeof hint === "string" ? hint.match(/^slide:(\d+)$/) : null;
    return match ? Number(match[1]) : null;
  }, [content.office?.sheet]);
  const [xlsxWorkbook, setXlsxWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState("");
  const [sheetRows, setSheetRows] = useState<(string | number | null)[][]>([]);
  const [xlsxError, setXlsxError] = useState("");
  // ── office 实时预览（L2 人性化）──
  // 上一次渲染的表数据：同文件同表才能 diff 出"刚改了哪几格"。
  const prevSheetDataRef = useRef<{ path: string; sheet: string; rows: (string | number | null)[][] } | null>(null);
  const activeSheetRef = useRef("");
  const spreadsheetScrollRef = useRef<HTMLDivElement | null>(null);
  const [changedCells, setChangedCells] = useState<Map<string, string>>(new Map());
  // 本轮修改导航：N 处变更间的 ‹ › 跳转（M365 Copilot 变更导航模式）。
  const [changeNav, setChangeNav] = useState<{ total: number; index: number } | null>(null);

  useEffect(() => {
    if (!content.dataBase64) {
      setBlobUrl("");
      return undefined;
    }
    const blob = blobFromBase64(content.dataBase64, content.mime);
    const nextUrl = URL.createObjectURL(blob);
    setBlobUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [content.dataBase64, content.mime]);

  const docxPrevPathRef = useRef("");
  useEffect(() => {
    const container = docxContainerRef.current;
    if (!isDocx || !container || !content.dataBase64) return;
    setDocxError("");
    // 文件切换：上一文件的修改标记作废。
    if (docxPrevPathRef.current !== filePath) {
      docxLastChangesRef.current = null;
      docxMarkedRef.current = [];
    }
    docxPrevPathRef.current = filePath;
    const blob = blobFromBase64(content.dataBase64, content.mime);
    const scroller = container.parentElement;
    // 双缓冲：离屏渲染完成后一次性替换 DOM——不做 innerHTML="" 清空，
    // 检查点刷新就不会白屏闪动；滚动位置保持（agent 写入时贴底跟随）。
    const previousScroll = scroller?.scrollTop ?? 0;
    const buffer = document.createElement("div");
    buffer.style.display = "none";
    let cancelled = false;
    void renderAsync(blob, buffer, undefined, {
      className: "docx-preview-page",
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      renderHeaders: false,
      renderFooters: false,
      renderFootnotes: true,
      renderEndnotes: true
    })
      .then(() => {
        if (cancelled) return;
        container.replaceChildren(...Array.from(buffer.childNodes));
        // 全量刷新（completed 兜底）后重放修改标记，标记不因刷新丢失。
        applyDocxMarks(false);
        requestAnimationFrame(() => {
          if (!scroller) return;
          // 贴底才跟随：用户本来在底部（看最新追加）→ 跟到新内容；
          // 用户往上看了某一节 → 绝不挪动视口，改动只以高亮呈现。
          const atBottom =
            scroller.scrollHeight - previousScroll - scroller.clientHeight < 120;
          scroller.scrollTop = atBottom ? scroller.scrollHeight : previousScroll;
        });
      })
      .catch((error) => {
        if (!cancelled) setDocxError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [content.dataBase64, content.mime, isDocx, content.office]);

  // edit_docx 段落级动态更新 + 持久修改标记（M365 Copilot 风格）：
  // 变更集直达 DOM（第 N 个 <p> 文本替换 + 持久翠绿 wash + 左色条 + 悬停原文），
  // 不重渲染文档树；下一轮变更先清上一轮标记；全量刷新后按最近变更集重放。
  const docxMarkedRef = useRef<HTMLElement[]>([]);
  const docxLastChangesRef = useRef<Array<{ paragraph?: number; text?: string }> | null>(null);

  const clearDocxMarks = () => {
    for (const element of docxMarkedRef.current) {
      element.classList.remove("office-para-mark", "office-cell-flash");
      element.removeAttribute("title");
    }
    docxMarkedRef.current = [];
  };

  const applyDocxMarks = (withFlash: boolean) => {
    const changes = docxLastChangesRef.current;
    const container = docxContainerRef.current;
    if (!changes?.length || !container) return;
    const paragraphs = container.querySelectorAll("p");
    const applied: HTMLElement[] = [];
    for (const change of changes) {
      const index = typeof change.paragraph === "number" ? change.paragraph - 1 : -1;
      if (index < 0 || index >= paragraphs.length) continue;
      const element = paragraphs[index] as HTMLElement;
      if (typeof change.text === "string") element.textContent = change.text;
      element.classList.add("office-para-mark");
      if (withFlash) element.classList.add("office-cell-flash");
      element.title = `本轮已修改 · 现文本：${change.text ?? ""}`;
      applied.push(element);
      if (withFlash) {
        // 视口跟随编辑位置：变更不在可视区时平滑滚到中部；已在视口内则不打扰。
        const rect = element.getBoundingClientRect();
        const inViewport =
          rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
        if (!inViewport) {
          element.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        window.setTimeout(() => element.classList.remove("office-cell-flash"), 1700);
      }
    }
    docxMarkedRef.current = applied;
  };

  useEffect(() => {
    const changes = content.office?.changes;
    if (!isDocx || !changes || changes.length === 0) return;
    const container = docxContainerRef.current;
    if (!container) return;
    clearDocxMarks();
    docxLastChangesRef.current = changes;
    const paragraphs = container.querySelectorAll("p");
    const applied: HTMLElement[] = [];
    for (const change of changes) {
      const index = typeof change.paragraph === "number" ? change.paragraph - 1 : -1;
      if (index < 0 || index >= paragraphs.length) continue;
      const element = paragraphs[index] as HTMLElement;
      // 悬停可见原文本（patch 前的 DOM 文本即原文）。
      element.title = `本轮已修改 · 原文本：${(element.textContent ?? "").trim()}`;
      if (typeof change.text === "string") element.textContent = change.text;
      element.classList.add("office-para-mark", "office-cell-flash");
      applied.push(element);
      window.setTimeout(() => element.classList.remove("office-cell-flash"), 1700);
      // 视口跟随编辑位置：变更不在可视区时平滑滚到中部；已可见则不打扰。
      const rect = element.getBoundingClientRect();
      const inViewport =
        rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight);
      if (!inViewport) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    docxMarkedRef.current = applied;
    setChangeNav(applied.length > 0 ? { total: applied.length, index: 0 } : null);
  }, [content.office?.changes, isDocx]);

  // pptx 幻灯片解析（client 端 jszip 解包 + 文本提取；预览用，非像素级还原）。
  useEffect(() => {
    if (!isSlides || !content.dataBase64) {
      setSlidesData([]);
      setSlidesError("");
      return;
    }
    let cancelled = false;
    void parseSlides(content.dataBase64)
      .then((slides) => {
        if (!cancelled) {
          setSlidesData(slides);
          setSlidesError("");
        }
      })
      .catch((error) => {
        if (!cancelled) setSlidesError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [isSlides, content.dataBase64]);

  // agent 正在写第 N 页时，滚动跟随并高亮该页卡片。
  useEffect(() => {
    if (!isSlides || activeSlide === null) return;
    const container = slidesContainerRef.current;
    if (!container) return;
    const target = container.querySelector(`[data-slide="${activeSlide}"]`);
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSlide, isSlides, slidesData.length]);

  // docx 流式跟随：内容追加时滚到底部（office hint 存在 = agent 正在写）。
  useEffect(() => {
    if (!isDocx || !content.office) return;
    const container = docxContainerRef.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [isDocx, content.dataBase64, content.office]);

  useEffect(() => {
    if (!isSpreadsheet || !content.dataBase64) {
      setXlsxWorkbook(null);
      setActiveSheet("");
      setSheetRows([]);
      setXlsxError("");
      return;
    }
    if (ext === "csv") {
      try {
        const text = atob(content.dataBase64);
        const workbook = XLSX.read(text, { type: "string" });
        if (workbook.SheetNames.length > 0) {
          setXlsxWorkbook(workbook);
          const firstSheet = workbook.SheetNames[0];
          activeSheetRef.current = firstSheet;
          prevSheetDataRef.current = null;
          setActiveSheet(firstSheet);
          setSheetRows(getSheetData(workbook, firstSheet));
          setXlsxError("");
        } else {
          setXlsxWorkbook(null);
          setActiveSheet("");
          setSheetRows([]);
          setXlsxError("无法解析该 CSV 文件。");
        }
      } catch {
        setXlsxWorkbook(null);
        setActiveSheet("");
        setSheetRows([]);
        setXlsxError("无法解析该 CSV 文件。");
      }
      return;
    }
    const workbook = parseXlsxWorkbook(content.dataBase64);
    if (workbook && workbook.SheetNames.length > 0) {
      // 选中表优先级：office 进度提示（agent 正在写的表）> 用户当前选中 > 第一张。
      // 刷新不再重置回第一张——修改哪张表就跟着看哪张表。
      const hinted = typeof content.office?.sheet === "string" ? content.office.sheet : "";
      let nextActive = workbook.SheetNames[0];
      if (hinted && workbook.SheetNames.includes(hinted)) {
        nextActive = hinted;
      } else if (activeSheetRef.current && workbook.SheetNames.includes(activeSheetRef.current)) {
        nextActive = activeSheetRef.current;
      }
      const rows = getSheetData(workbook, nextActive);
      // 同文件同表逐格 diff：变更格持久标记（M365 Copilot 风格），值 = 原值（悬停显示）。
      // 持久到下一轮 diff 覆盖或用户切表接管；不闪一下就消失。
      const prev = prevSheetDataRef.current;
      const changed = new Map<string, string>();
      if (prev && prev.path === filePath && prev.sheet === nextActive) {
        const maxRows = Math.max(prev.rows.length, rows.length);
        for (let r = 0; r < maxRows; r += 1) {
          const prevRow = prev.rows[r] || [];
          const nextRow = rows[r] || [];
          const maxCols = Math.max(prevRow.length, nextRow.length);
          for (let c = 0; c < maxCols; c += 1) {
            const before = String(prevRow[c] ?? "");
            const after = String(nextRow[c] ?? "");
            if (before !== after) {
              changed.set(`${r}:${c}`, before || "（空）");
            }
          }
        }
      }
      prevSheetDataRef.current = { path: filePath, sheet: nextActive, rows };
      activeSheetRef.current = nextActive;
      setChangedCells(changed);
      setChangeNav(changed.size > 0 ? { total: changed.size, index: 0 } : null);
      // 视口跟随 agent 编辑位置：本检查点首个变更格平滑滚到视口中部。
      if (changed.size > 0) {
        requestAnimationFrame(() => {
          const first = spreadsheetScrollRef.current?.querySelector("[data-cell-mark]");
          first?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      }
      setXlsxWorkbook(workbook);
      setActiveSheet(nextActive);
      setSheetRows(rows);
      setXlsxError("");
    } else {
      setXlsxWorkbook(null);
      setActiveSheet("");
      activeSheetRef.current = "";
      setSheetRows([]);
      setXlsxError("无法解析该 Excel 文件，文件可能已损坏或格式不受支持。");
    }
  }, [content.dataBase64, isSpreadsheet, ext, filePath, content.office?.sheet]);

  // 变更间跳转：第 index 处修改滚到视口中部并重放闪现。
  const gotoChange = useCallback(
    (delta: number) => {
      setChangeNav((prev) => {
        if (!prev || prev.total === 0) return prev;
        const nextIndex = (prev.index + delta + prev.total) % prev.total;
        requestAnimationFrame(() => {
          if (isSpreadsheet) {
            const elements = spreadsheetScrollRef.current?.querySelectorAll("[data-cell-mark]");
            const element = elements?.[nextIndex];
            if (element) {
              element.scrollIntoView({ block: "center", behavior: "smooth" });
              element.classList.add("office-cell-flash");
              window.setTimeout(() => element.classList.remove("office-cell-flash"), 1200);
            }
          } else if (isDocx) {
            const changes = (content.office?.changes || [])
              .filter((change) => typeof change.paragraph === "number")
              .sort((a, b) => (a.paragraph || 0) - (b.paragraph || 0));
            const change = changes[nextIndex];
            if (!change) return;
            const paragraphs = docxContainerRef.current?.querySelectorAll("p");
            const element = paragraphs?.[(change.paragraph || 1) - 1];
            if (element) {
              element.scrollIntoView({ block: "center", behavior: "smooth" });
              element.classList.add("office-cell-flash");
              window.setTimeout(() => element.classList.remove("office-cell-flash"), 1200);
            }
          }
        });
        return { ...prev, index: nextIndex };
      });
    },
    [isSpreadsheet, isDocx, content.office?.changes]
  );

  const ChangeNavChip = changeNav ? (
    <div
      className="absolute right-4 top-3 z-10 flex items-center gap-1 rounded-full border border-border bg-card/90 px-2 py-1 text-[11px] shadow-sm backdrop-blur"
      data-office-change-nav
    >
      <span className="px-1 text-muted-foreground">本轮 {changeNav.total} 处修改</span>
      <button
        type="button"
        className="rounded-full px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => gotoChange(-1)}
        aria-label="上一处修改"
      >
        ‹
      </button>
      <span className="tabular-nums text-foreground/80">
        {changeNav.index + 1}/{changeNav.total}
      </span>
      <button
        type="button"
        className="rounded-full px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => gotoChange(1)}
        aria-label="下一处修改"
      >
        ›
      </button>
      <button
        type="button"
        className="ml-0.5 rounded-full px-1.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        onClick={() => setChangeNav(null)}
        aria-label="清除修改标记"
        title="清除修改标记"
      >
        ×
      </button>
    </div>
  ) : null;

  const handleSwitchSheet = (sheetName: string) => {
    if (!xlsxWorkbook || sheetName === activeSheet) return;
    activeSheetRef.current = sheetName;
    setActiveSheet(sheetName);
    setSheetRows(getSheetData(xlsxWorkbook, sheetName));
    // 手动切表清除高亮：用户接管视图。
    setChangedCells(new Map());
  };

  const documents = useMemo(() => {
    if (!blobUrl) return [];
    return [{
      uri: blobUrl,
      fileName,
      fileType: ext
    }];
  }, [blobUrl, ext, fileName]);

  if (isMarkdown) {
    const markdown = content.modified || content.original || (content.dataBase64 ? textFromBase64(content.dataBase64) : "");
    return (
      <PreviewShell>
        <div className="h-full min-h-0 overflow-auto bg-background px-5 py-4 text-[13px] leading-6 md:px-7 md:py-5">
          {markdown.trim() ? (
            <MarkdownLite source={markdown} />
          ) : (
            <PreviewEmpty title="空的 Markdown 文件" description="该文件没有可显示的内容。" />
          )}
        </div>
      </PreviewShell>
    );
  }

  if (!content.dataBase64) {
    return (
      <PreviewEmpty title="不支持的预览类型" description="没有可用于预览的文件数据。" />
    );
  }

  if (isDocx) {
    return (
      <PreviewShell>
        <div className="relative h-full min-h-0">
          {ChangeNavChip}
          {docxError ? (
            <PreviewEmpty title="DOCX 预览失败" description={docxError} />
          ) : (
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-background p-3 pb-5 md:p-4">
              <div
                ref={docxContainerRef}
                className={cn(
                  "min-h-full w-full overflow-x-hidden",
                  "[&_.docx-preview-page-wrapper]:!flex [&_.docx-preview-page-wrapper]:!min-h-full",
                  "[&_.docx-preview-page-wrapper]:!items-start [&_.docx-preview-page-wrapper]:!justify-center",
                  "[&_.docx-preview-page-wrapper]:!bg-background [&_.docx-preview-page-wrapper]:!p-0",
                  "[&_.docx-preview-page-wrapper]:!shadow-none",
                  "[&_.docx-preview-page]:!mx-auto [&_.docx-preview-page]:!mb-5",
                  "[&_.docx-preview-page]:shadow-sm"
                )}
              />
            </div>
          )}
        </div>
      </PreviewShell>
    );
  }

  if (isSlides) {
    if (slidesError) {
      return (
        <PreviewShell>
          <PreviewEmpty title="PPT 预览失败" description={slidesError} />
        </PreviewShell>
      );
    }
    if (slidesData.length === 0) {
      return (
        <PreviewShell>
          <PreviewEmpty title="正在准备预览" description="正在解析幻灯片数据..." />
        </PreviewShell>
      );
    }
    return (
      <PreviewShell>
        <div ref={slidesContainerRef} className="h-full min-h-0 overflow-y-auto bg-background p-4">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {slidesData.map((slide) => (
              <div
                key={slide.index}
                data-slide={slide.index}
                className={cn(
                  "overflow-hidden rounded-xl border bg-card transition-all duration-300",
                  activeSlide === slide.index
                    ? "border-orange-500/70 shadow-[0_0_0_3px_rgb(249_115_22/0.12)]"
                    : "border-border"
                )}
              >
                <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
                  <span className="inline-flex size-5 items-center justify-center rounded bg-orange-500/15 font-mono text-[10px] font-semibold text-orange-600 dark:text-orange-400">
                    {slide.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {slide.title}
                  </span>
                  {activeSlide === slide.index ? (
                    <span className="shrink-0 rounded-full bg-orange-500/12 px-2 py-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-400">
                      正在编写
                    </span>
                  ) : null}
                </div>
                <div className="px-4 py-3">
                  {slide.bullets.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {slide.bullets.map((bullet, bulletIndex) => (
                        <li
                          key={bulletIndex}
                          className="flex items-start gap-2 text-[13px] leading-6 text-muted-foreground"
                        >
                          <span className="mt-[9px] size-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                          <span className="min-w-0 break-words">{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground/60">（本页暂无要点）</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PreviewShell>
    );
  }

  if (isSpreadsheet) {
    if (xlsxError) {
      return (
        <PreviewShell>
          <PreviewEmpty title="Excel 预览失败" description={xlsxError} />
        </PreviewShell>
      );
    }
    if (!xlsxWorkbook) {
      return (
        <PreviewShell>
          <PreviewEmpty title="正在准备预览" description="正在解析 Excel 文件数据..." />
        </PreviewShell>
      );
    }
    return (
      <PreviewShell>
        <div className="relative h-full min-h-0">
          {ChangeNavChip}
          <div ref={spreadsheetScrollRef} className="h-full min-h-0 overflow-auto bg-background p-4">
            <div className="inline-block min-w-full align-top">
            {xlsxWorkbook.SheetNames.length > 1 && (
              <ToggleGroup
                type="single"
                value={activeSheet}
                onValueChange={(sheetName) => {
                  if (sheetName) handleSwitchSheet(sheetName);
                }}
                variant="outline"
                size="sm"
                className="mb-3 max-w-full justify-start overflow-x-auto rounded-lg bg-muted/35 p-1"
              >
                {xlsxWorkbook.SheetNames.map((sheetName: string) => (
                  <ToggleGroupItem
                    key={sheetName}
                    value={sheetName}
                    className={cn(
                      "max-w-56 justify-start truncate px-3",
                      // 跟随提示：agent 正在操作的表在页签上加圆点标记。
                      content.office?.sheet === sheetName && "relative"
                    )}
                  >
                    {content.office?.sheet === sheetName ? (
                      <span
                        className="absolute right-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-blue-500"
                        aria-hidden
                      />
                    ) : null}
                    {sheetName}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
            <div className="inline-block min-w-full overflow-hidden rounded-lg border border-border bg-card align-top">
              <table className="min-w-full border-collapse bg-card font-mono text-xs text-card-foreground">
                <tbody>
                  {(() => {
                    // 选区跟随：agent 正在操作的区域（仅当提示表 == 当前表）。
                    const selection = parseSelectionRange(content.office?.range);
                    const selectionActive = Boolean(
                      selection && content.office?.sheet === activeSheet
                    );
                    return sheetRows.map((row: (string | number | null)[], rowIndex: number) => (
                      <tr key={rowIndex}>
                        <td className="sticky left-0 min-w-10 border border-border bg-muted px-2 py-1.5 text-center font-semibold text-muted-foreground">
                          {rowIndex + 1}
                        </td>
                        {row.map((cell: string | number | null, cellIndex: number) => {
                          const changeKey = `${rowIndex}:${cellIndex}`;
                          const changed = changedCells.has(changeKey);
                          const previousValue = changedCells.get(changeKey);
                          const inSelection = Boolean(
                            selectionActive
                            && selection
                            && rowIndex >= selection.r1
                            && rowIndex <= selection.r2
                            && cellIndex >= selection.c1
                            && cellIndex <= selection.c2
                          );
                          return (
                            <td
                              key={cellIndex}
                              data-cell-mark={changed ? changeKey : undefined}
                              className={cn(
                                "min-w-20 max-w-80 truncate border border-border px-2 py-1.5 align-middle transition-colors duration-500",
                                rowIndex === 0
                                  ? "sticky top-0 bg-muted font-semibold text-foreground"
                                  : "bg-card text-foreground",
                                changed && "office-cell-flash office-cell-mark",
                                inSelection && "office-selection-cell"
                              )}
                              title={
                                changed
                                  ? `本轮已修改 · 原值：${previousValue ?? ""}`
                                  : undefined
                              }
                            >
                              {cell ?? ""}
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        </div>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell>
      <div className="h-full min-h-0 overflow-auto bg-background [&_#proxy-renderer]:min-h-full [&_#react-doc-viewer]:min-h-full [&_#react-doc-viewer]:bg-transparent">
        {documents.length > 0 ? (
          <DocViewer
            documents={documents}
            pluginRenderers={DocViewerRenderers}
            config={{
              header: { disableHeader: true },
              pdfZoom: { defaultZoom: 0.9, zoomJump: 0.15 }
            }}
          />
        ) : (
          <PreviewEmpty title="正在准备预览" description="文件数据载入后会自动显示。" />
        )}
      </div>
    </PreviewShell>
  );
}

import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { Document as PdfDocument, Page as PdfPage, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
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
  /** 预览缩放（附件工具栏控制；仅 docx/ppt/xlsx 应用，PDF 走 viewer 内部缩放）。 */
  zoom?: number;
  /** docx/PDF 渲染完成并测出适配宽度后回调（工具栏据此显示真实百分比）。 */
  onFitZoomReady?: (zoom: number) => void;
  /** zoom 是否仍处于"自动适配"状态（true 时容器尺寸变化会重新适配）。 */
  zoomAuto?: boolean;
  /** office 文件可恢复历史版本时提供：点击按钮回退到修改前内容。 */
  onRestorePreviousVersion?: () => void;
  canRestorePreviousVersion?: boolean;
  /** 换文件时回落到默认视图，工具栏同步显示 100% / 自动适配。 */
  setPreviewZoom?: (zoom: number) => void;
  setPreviewZoomAuto?: (auto: boolean) => void;
};

// react-pdf esm 入口自带的 workerSrc 是坏路径，必须指向真实 worker 资源；
// 复用项目唯一的 pdfjs-dist 实例（与 documentTextExtract 相同），避免双 worker。
try {
  void import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((worker) => {
    if (worker?.default) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  });
} catch {
  /* ignore worker wiring failures; pdf.js may still run on main thread */
}

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

export function DocumentPreviewViewer({
  filePath,
  content,
  zoom = 1,
  zoomAuto = false,
  onFitZoomReady,
  onRestorePreviousVersion,
  canRestorePreviousVersion,
  setPreviewZoom,
  setPreviewZoomAuto
}: DocumentPreviewViewerProps) {
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  // 真正的滚动容器。不能靠 parentElement 找：缩放“舞台”层包住内容后，
  // docxContainerRef.parentElement 是舞台（宽度 = 页宽 × zoom），会让适配测量
  // 进入反馈循环（fit ≈ 页宽×zoom/页宽），zoom 一路收敛到下限 50%。
  const docxScrollerRef = useRef<HTMLDivElement | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [contentReady, setContentReady] = useState(false);
  const [docxError, setDocxError] = useState("");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  // PDF 首页在 scale=1 下的真实宽度（pdf.js viewport，单位 = CSS px）。
  // 拿到它即可在首帧渲染前直接换算 fit-width，避免「先渲染再量 DOM 再跳一次」。
  // ref + state 双写：onLoadSuccess 同步链路读 ref，渲染依赖读 state。
  const pdfBasePageWidthRef = useRef(0);
  const [pdfBasePageWidth, setPdfBasePageWidth] = useState(0);
  const [pdfError, setPdfError] = useState("");
  const pdfMeasuredKeyRef = useRef("");
  const fileName = fileNameFromPath(filePath);
  const ext = extensionFromName(fileName);
  const isMarkdown = ext === "md" || ext === "markdown" || ext === "mdx" || content.previewKind === "markdown";
  const isImage = content.previewKind === "image" || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext) || String(content.mime || "").startsWith("image/");
  const isDocx = ext === "docx" && content.dataBase64;
  const isPdf = (ext === "pdf" || content.previewKind === "pdf") && Boolean(content.dataBase64);
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
    setContentReady(false);
    // PDF 不走 blob URL：数据源由下方 pdfSource（data URL 字符串）提供，
    // 避免同一文档经历 data URL → blob URL 两次加载身份。
    if (!content.dataBase64 || isPdf) {
      setBlobUrl("");
      return undefined;
    }
    const blob = blobFromBase64(content.dataBase64, content.mime);
    const nextUrl = URL.createObjectURL(blob);
    setBlobUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
      setBlobUrl("");
    };
  }, [content.dataBase64, content.mime, isPdf]);

  // PDF 数据源用 data URL 字符串（值语义）：引用天然稳定，且 pdf.js 对字符串
  // 走 dataURItoByteString（拷贝），不会 transfer 出 detached buffer。
  // 二进制数组方案在 StrictMode/重挂载时第二次 getDocument 会命中已 detach 的
  // buffer，直接 DataCloneError —— 这是 PDF 预览失败的根因。
  const pdfSource = !isPdf || !content.dataBase64
    ? undefined
    : `data:application/pdf;base64,${content.dataBase64}`;

  // options 同样必须引用稳定，否则每次渲染都会被 react-pdf 视为变更并重建加载任务。
  const pdfOptions = useMemo(() => ({
    cMapUrl: new URL("pdfjs-dist/cmaps/", import.meta.url).toString(),
    cMapPacked: true,
    standardFontDataUrl: new URL("pdfjs-dist/standard_fonts/", import.meta.url).toString()
  }), []);

  const docxPrevPathRef = useRef("");
  const docxMeasuredKeyRef = useRef("");
  // DOCX 渲染后的未缩放内容尺寸。外层“舞台”按 zoom × 尺寸占位，
  // 内层再等比 transform 缩放；否则页宽超过容器时 transform 会造成偏移/大片留白。
  const [docxLayoutSize, setDocxLayoutSize] = useState({ width: 0, height: 0 });
  const measureDocxLayout = useCallback(() => {
    const container = docxContainerRef.current;
    if (!container) return;
    const pages = Array.from(container.querySelectorAll<HTMLElement>(".docx-preview-page"));
    const wrapper = container.querySelector<HTMLElement>(".docx-preview-page-wrapper");
    const width = Math.max(wrapper?.offsetWidth || 0, ...pages.map((page) => page.offsetWidth));
    const height = wrapper?.offsetHeight || container.offsetHeight;
    if (width <= 0 || height <= 0) return;
    const next = { width: Math.ceil(width), height: Math.ceil(height) };
    setDocxLayoutSize((previous) => (
      previous.width === next.width && previous.height === next.height ? previous : next
    ));
  }, []);

  useEffect(() => {
    if (!isDocx || !onFitZoomReady) return;
    const scroller = docxScrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      const page = docxContainerRef.current?.querySelector(".docx-preview-page") as HTMLElement | null;
      if (!page || page.offsetWidth <= 0) return;
      // clientWidth 含左右 padding；适配宽度必须按真实内容区再留少量呼吸边距。
      const scrollerStyle = window.getComputedStyle(scroller);
      const horizontalPadding = Number.parseFloat(scrollerStyle.paddingLeft || "0")
        + Number.parseFloat(scrollerStyle.paddingRight || "0");
      const available = scroller.clientWidth - horizontalPadding - 24;
      if (available <= 0) return;
      const key = `${filePath}:${Math.round(available)}:${Math.round(page.offsetWidth)}`;
      if (key === docxMeasuredKeyRef.current) return;
      docxMeasuredKeyRef.current = key;
      // 不钳到 ≤1：面板比页宽宽时同样放大占满，两侧不再大片留白；
      // 面板比页宽窄时缩小到刚好放下，避免横向滚动。
      const fit = Math.min(2, Math.max(0.3, available / page.offsetWidth));
      onFitZoomReady(Number(fit.toFixed(2)));
    };
    if (contentReady) measure();
    // 网页字体（宋体/黑体等）晚于首测加载完成会改变页宽，加载完补测一次。
    void document.fonts?.ready.then(() => measure());
    if (!zoomAuto) return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [isDocx, contentReady, filePath, zoomAuto, onFitZoomReady]);

  useEffect(() => {
    if (!isDocx) return undefined;
    const container = docxContainerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(() => measureDocxLayout());
    observer.observe(container);
    return () => observer.disconnect();
  }, [isDocx, measureDocxLayout]);

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
    // 恢复/无变更集：旧标记作废（App 侧恢复后 office.changes 会被清掉）。
    if (!content.office?.changes) {
      docxLastChangesRef.current = null;
      docxMarkedRef.current = [];
    }
    const blob = blobFromBase64(content.dataBase64, content.mime);
    const scroller = docxScrollerRef.current;
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
        setContentReady(true);
        // 全量刷新（completed 兜底）后重放修改标记，标记不因刷新丢失。
        applyDocxMarks(false);
        requestAnimationFrame(() => {
          measureDocxLayout();
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
          setContentReady(true);
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
    const container = docxScrollerRef.current;
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
          setContentReady(true);
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

  const RestoreButton =
    canRestorePreviousVersion && onRestorePreviousVersion && (isDocx || isSpreadsheet || isSlides) ? (
      <button
        type="button"
        className="absolute right-4 top-3 z-10 flex items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur hover:border-foreground/25 hover:text-foreground"
        onClick={() => onRestorePreviousVersion()}
        title="回退到 agent 修改前的内容"
      >
        ⟲ 上一版
      </button>
    ) : null;

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

  useEffect(() => {
    if (!isDocx && !isSpreadsheet && !isSlides && content.dataBase64) {
      const timer = window.setTimeout(() => setContentReady(true), 60);
      return () => window.clearTimeout(timer);
    }
  }, [isDocx, isSpreadsheet, isSlides, content.dataBase64]);

  // ── PDF：与 docx 同语义的一次到位适配。文档加载成功时直接从 pdf.js viewport
  // 读取首页原始宽度，配合滚动容器宽度立刻算出 fit 比例并回调工具栏；
  // 首帧渲染就用这个比例，不再经历「固定 720px 渲染 → 量 DOM → 再跳一次」。
  useEffect(() => {
    if (!isPdf) {
      setPdfPageCount(0);
      pdfBasePageWidthRef.current = 0;
      setPdfBasePageWidth(0);
      setPdfError("");
      return;
    }
    setContentReady(false);
    setPdfError("");
    // 换文件：清掉旧文档量出的页宽与手动缩放，等新文档 load 回调里一步适配。
    pdfBasePageWidthRef.current = 0;
    setPdfBasePageWidth(0);
    setPreviewZoom?.(1);
    setPreviewZoomAuto?.(true);
  }, [isPdf, content.dataBase64, filePath, setPreviewZoom, setPreviewZoomAuto]);

  // 容器宽度来源：加载成功时读一次 + zoomAuto 时 ResizeObserver 持续跟随。
  // 计算完全基于原始页宽（不依赖已渲染 DOM），任何缩放档位下结果都正确。
  const measurePdfFitFromContainer = useCallback((scroller: HTMLElement) => {
    if (!onFitZoomReady) return;
    const baseWidth = pdfBasePageWidthRef.current;
    if (baseWidth <= 0) return;
    const available = scroller.clientWidth - 24;
    if (available <= 0) return;
    const fit = available / baseWidth;
    if (!Number.isFinite(fit) || fit <= 0) return;
    // key 含当前缩放档位：从手动 200% 切回「适合宽度」时，容器宽虽没变，
    // 但必须重新回传 fit，否则工具栏会停留在一个错误的比例上。
    const key = `${filePath}:${Math.round(Math.max(zoom, 0.05) * 100)}:${Math.round(available)}:${Math.round(baseWidth)}`;
    if (key === pdfMeasuredKeyRef.current) return;
    pdfMeasuredKeyRef.current = key;
    onFitZoomReady(Number(Math.min(3, Math.max(0.3, fit)).toFixed(2)));
  }, [filePath, zoom, onFitZoomReady]);

  useEffect(() => {
    const scroller = pdfContainerRef.current?.parentElement;
    if (!isPdf || !scroller) return undefined;
    measurePdfFitFromContainer(scroller);
    if (!zoomAuto) return undefined;
    const observer = new ResizeObserver(() => measurePdfFitFromContainer(scroller));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [isPdf, zoomAuto, pdfBasePageWidth, measurePdfFitFromContainer]);

  if (isImage && content.dataBase64) {
    const mime = content.mime || "image/png";
    const src = blobUrl || `data:${mime};base64,${content.dataBase64}`;
    return (
      <PreviewShell>
        <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-[color-mix(in_srgb,var(--muted)_45%,var(--background)_55%)] p-4">
          <img
            src={src}
            alt={fileName}
            draggable={false}
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center", maxWidth: `${100 / Math.max(zoom, 0.01)}%`, maxHeight: `${100 / Math.max(zoom, 0.01)}%` }}
            className="min-h-0 min-w-0 shrink rounded-lg object-contain shadow-[0_1px_3px_rgba(15,23,42,0.12)] outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          />
        </div>
      </PreviewShell>
    );
  }

  if (isPdf) {
    return (
      <PreviewShell>
        <div className="h-full min-h-0">
          {pdfError ? (
            <PreviewEmpty title="PDF 预览失败" description={pdfError} />
          ) : (
            <div
              className={cn(
                "h-full min-h-0 overflow-auto bg-background px-3 py-3 transition-opacity duration-300 ease-out md:px-4",
                contentReady ? "opacity-100" : "opacity-0"
              )}
            >
              {/* 容器不设百分比宽度：页面物理宽度 = 原始页宽 × zoom，
                  容器跟随内容自适应。旧实现 width: zoom*100% 会让容器远大于
                  小开本 PDF（如 A5 402pt）的页面，居中后页面被右移裁切。 */}
              <div
                ref={pdfContainerRef}
                className="mx-auto flex min-w-fit flex-col items-center gap-4 [&_.react-pdf__Page]:shadow-sm [&_.react-pdf__Page]:outline [&_.react-pdf__Page]:outline-1 [&_.react-pdf__Page]:-outline-offset-1 [&_.react-pdf__Page]:outline-black/10 dark:[&_.react-pdf__Page]:outline-white/10"
              >
                <PdfDocument
                  file={pdfSource}
                  options={pdfOptions}
                  noData={<PreviewEmpty title="PDF 预览失败" description="文件数据无效。" />}
                  onLoadSuccess={(pdf) => {
                    setPdfPageCount(pdf.numPages);
                    // 首页原始宽度（scale=1 viewport）：首帧渲染前就完成适配测量。
                    const firstPage = pdf.getPage(1) as Promise<{ getViewport: (options: { scale: number }) => { width: number } }>;
                    void firstPage.then((page) => {
                      const baseWidth = page.getViewport({ scale: 1 }).width;
                      pdfBasePageWidthRef.current = baseWidth;
                      setPdfBasePageWidth(baseWidth);
                      const scroller = pdfContainerRef.current?.parentElement;
                      if (scroller) measurePdfFitFromContainer(scroller);
                      setContentReady(true);
                    }).catch(() => {
                      // viewport 拿不到时退化为原行为：先按固定宽度渲染。
                      setContentReady(true);
                    });
                  }}
                  onLoadError={(error) => setPdfError(String(error))}
                  loading={<PreviewEmpty title="正在准备预览" description="正在解析 PDF..." />}
                  error={<PreviewEmpty title="PDF 预览失败" description="无法读取该 PDF 文件。" />}
                >
                  {Array.from({ length: pdfPageCount }, (_, index) => (
                    <PdfPage
                      key={index + 1}
                      pageNumber={index + 1}
                      width={
                        pdfBasePageWidth > 0
                          ? Math.max(160, Math.round(pdfBasePageWidth * Math.max(zoom, 0.05)))
                          : Math.max(160, Math.round(720 * Math.max(zoom, 0.05)))
                      }
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                    />
                  ))}
                </PdfDocument>
              </div>
            </div>
          )}
        </div>
      </PreviewShell>
    );
  }

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
          {RestoreButton}
          {docxError ? (
            <PreviewEmpty title="DOCX 预览失败" description={docxError} />
          ) : (
            <div
              ref={docxScrollerRef}
              className={cn(
                "h-full min-h-0 overflow-auto bg-background p-3 pb-5 transition-opacity duration-300 ease-out md:p-4",
                contentReady ? "opacity-100" : "opacity-0"
              )}
            >
              <div
                className="mx-auto w-fit"
                style={docxLayoutSize.width > 0 ? {
                  width: Math.round(docxLayoutSize.width * zoom),
                  height: Math.round(docxLayoutSize.height * zoom)
                } : undefined}
              >
                <div
                  ref={docxContainerRef}
                  style={{
                    width: docxLayoutSize.width > 0 ? docxLayoutSize.width : "100%",
                    height: docxLayoutSize.height > 0 ? docxLayoutSize.height : undefined,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left"
                  }}
                  className={cn(
                    "overflow-x-visible",
                    docxLayoutSize.width <= 0 && "min-h-full",
                    "[&_.docx-preview-page-wrapper]:!flex [&_.docx-preview-page-wrapper]:!min-h-full",
                    "[&_.docx-preview-page-wrapper]:!items-start [&_.docx-preview-page-wrapper]:!justify-center",
                    "[&_.docx-preview-page-wrapper]:!bg-background [&_.docx-preview-page-wrapper]:!p-0",
                    "[&_.docx-preview-page-wrapper]:!shadow-none",
                    "[&_.docx-preview-page]:!mx-auto [&_.docx-preview-page]:!mb-5",
                    "[&_.docx-preview-page]:shadow-sm"
                  )}
                />
              </div>
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
        <div className="relative h-full min-h-0">
          {RestoreButton}
          <div
          ref={slidesContainerRef}
          className={cn(
            "h-full min-h-0 overflow-auto bg-background p-4 transition-opacity duration-300 ease-out",
            contentReady ? "opacity-100" : "opacity-0"
          )}
        >
          <div
            style={{
              width: `${Math.min(100 / Math.max(zoom, 0.01), 100)}%`,
              maxWidth: `${100 * zoom}%`,
              transform: `scale(${zoom})`,
              transformOrigin: "top center"
            }}
            className="mx-auto flex flex-col gap-4"
          >
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
          {RestoreButton}
          <div
            ref={spreadsheetScrollRef}
            className={cn(
              "h-full min-h-0 overflow-auto bg-background p-4 transition-opacity duration-300 ease-out",
              contentReady ? "opacity-100" : "opacity-0"
            )}
          >
            <div
              style={{
                "--zoom": zoom,
                width: `calc(100% / ${zoom})`,
                transform: `scale(${zoom})`,
                transformOrigin: "top left"
              } as CSSProperties}
              className="inline-block align-top"
            >
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
      <div
        className={cn(
          "h-full min-h-0 overflow-auto bg-background transition-opacity duration-300 ease-out [&_#proxy-renderer]:min-h-full [&_#react-doc-viewer]:min-h-full [&_#react-doc-viewer]:bg-transparent",
          contentReady ? "opacity-100" : "opacity-0"
        )}
      >
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

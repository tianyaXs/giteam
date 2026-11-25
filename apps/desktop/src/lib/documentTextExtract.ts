/**
 * 对齐 Pi web-ui：粘贴/上传文档时抽取正文，供 prompt 内联。
 * 抽取结果只进 sessionPrompt，气泡渲染靠 stripFileAttachmentHints 剥离。
 */
import JSZip from "jszip";
import * as XLSX from "xlsx";

const MAX_EXTRACTED_CHARS = 200_000;

function normalizeMime(type: string): string {
  return type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function filenameExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

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

function truncateExtracted(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n\n[Truncated: extracted text exceeded ${MAX_EXTRACTED_CHARS} characters]`;
}

export function detectDocumentKind(
  filename: string,
  mime: string
): "pdf" | "docx" | "pptx" | "xlsx" | "xls" | null {
  const ext = filenameExt(filename);
  const normalized = normalizeMime(mime);
  if (ext === "pdf" || normalized === "application/pdf") return "pdf";
  if (
    ext === "docx"
    || normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    ext === "pptx"
    || normalized === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (
    ext === "xlsx"
    || normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  if (ext === "xls" || normalized === "application/vnd.ms-excel") return "xls";
  return null;
}

async function extractPdfText(bytes: Uint8Array, fileName: string): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  try {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    if (worker?.default) {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    }
  } catch {
    /* ignore worker wiring failures; pdf.js may still run on main thread */
  }
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    let extracted = `<pdf filename="${fileName}">`;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? String(item.str || "") : ""))
        .filter((str) => str.trim())
        .join(" ");
      extracted += `\n<page number="${pageNum}">\n${pageText}\n</page>`;
    }
    extracted += "\n</pdf>";
    return truncateExtracted(extracted);
  } finally {
    await pdf.destroy();
  }
}

async function extractDocxText(bytes: Uint8Array, fileName: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("docx missing word/document.xml");
  const withBreaks = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<w:tab[^/]*\/>/g, "\t");
  const parts = Array.from(withBreaks.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXmlEntities(match[1] || ""));
  const body = parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  return truncateExtracted(`<docx filename="${fileName}">\n${body}\n</docx>`);
}

async function extractPptxText(bytes: Uint8Array, fileName: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)\.xml$/)?.[1] || 0);
      const numB = Number(b.match(/slide(\d+)\.xml$/)?.[1] || 0);
      return numA - numB;
    });
  let extracted = `<pptx filename="${fileName}">`;
  for (let index = 0; index < slideFiles.length; index += 1) {
    const xml = (await zip.file(slideFiles[index])?.async("string")) || "";
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
      .map((match) => decodeXmlEntities(match[1] || "").trim())
      .filter(Boolean);
    if (texts.length === 0) continue;
    extracted += `\n<slide number="${index + 1}">\n${texts.join("\n")}\n</slide>`;
  }
  extracted += "\n</pptx>";
  return truncateExtracted(extracted);
}

async function extractExcelText(bytes: Uint8Array, fileName: string): Promise<string> {
  const workbook = XLSX.read(bytes, { type: "array" });
  let extracted = `<excel filename="${fileName}">`;
  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    const worksheet = workbook.Sheets[sheetName];
    const csvText = XLSX.utils.sheet_to_csv(worksheet);
    extracted += `\n<sheet name="${sheetName}" index="${index + 1}">\n${csvText}\n</sheet>`;
  }
  extracted += "\n</excel>";
  return truncateExtracted(extracted);
}

/** 从原始字节抽取 PDF/Office 正文；非支持类型或失败返回 null。 */
export async function extractDocumentTextFromBytes(input: {
  bytes: Uint8Array;
  filename: string;
  mime?: string;
}): Promise<string | null> {
  const kind = detectDocumentKind(input.filename, input.mime || "");
  if (!kind) return null;
  try {
    if (kind === "pdf") return await extractPdfText(input.bytes, input.filename);
    if (kind === "docx") return await extractDocxText(input.bytes, input.filename);
    if (kind === "pptx") return await extractPptxText(input.bytes, input.filename);
    return await extractExcelText(input.bytes, input.filename);
  } catch {
    return null;
  }
}

export function isExtractableDocumentAttachment(filename: string, mime: string): boolean {
  return detectDocumentKind(filename, mime) != null;
}

/** 把已抽取的纯文本包装成与 docx 抽取一致的结构（macOS textutil 路径）。 */
export function wrapExtractedOfficePlainText(
  filename: string,
  kind: "docx" | "xlsx" | "xls",
  text: string
): string {
  const body = text.trim();
  if (!body) return "";
  if (kind === "docx") return truncateExtracted(`<docx filename="${filename}">\n${body}\n</docx>`);
  return truncateExtracted(body);
}

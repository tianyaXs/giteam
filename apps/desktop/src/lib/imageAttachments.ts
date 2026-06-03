import { IS_TAURI, invoke } from "./platform";
import { makeId } from "./browserRuntime";

export type OpencodeAttachment = {
  id: string;
  kind: "image" | "file";
  filename: string;
  mime: string;
  dataUrl: string;
  sourcePath?: string;
};

export type OpencodeImageAttachment = OpencodeAttachment;

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export const OPENCODE_ATTACHMENT_INPUT_ACCEPT = [
  ...ACCEPTED_IMAGE_TYPES,
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/*",
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
  ".c",
  ".cc",
  ".cjs",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".cts",
  ".env",
  ".go",
  ".gql",
  ".graphql",
  ".h",
  ".hh",
  ".hpp",
  ".htm",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".py",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
].join(",");

const IMAGE_MIMES = new Set(ACCEPTED_IMAGE_TYPES);
const IMAGE_EXTS = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);
const FILE_EXTS = new Map([
  ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["pdf", "application/pdf"],
  ["ppt", "application/vnd.ms-powerpoint"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);
const TEXT_MIMES = new Set([
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-toml",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
]);
const FILE_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const BADGE_BY_EXT = new Map([
  ["bash", "SH"],
  ["conf", "CFG"],
  ["css", "CSS"],
  ["csv", "CSV"],
  ["doc", "DOC"],
  ["docx", "DOCX"],
  ["env", "ENV"],
  ["gif", "GIF"],
  ["go", "GO"],
  ["graphql", "GQL"],
  ["htm", "HTML"],
  ["html", "HTML"],
  ["ini", "INI"],
  ["java", "JAVA"],
  ["jpeg", "JPG"],
  ["jpg", "JPG"],
  ["js", "JS"],
  ["json", "JSON"],
  ["jsx", "JSX"],
  ["log", "LOG"],
  ["md", "MD"],
  ["mdx", "MDX"],
  ["pdf", "PDF"],
  ["png", "PNG"],
  ["ppt", "PPT"],
  ["pptx", "PPTX"],
  ["py", "PY"],
  ["rb", "RB"],
  ["rs", "RS"],
  ["scss", "SCSS"],
  ["sh", "SH"],
  ["sql", "SQL"],
  ["svg", "SVG"],
  ["toml", "TOML"],
  ["ts", "TS"],
  ["tsx", "TSX"],
  ["txt", "TXT"],
  ["webp", "WEBP"],
  ["xls", "XLS"],
  ["xlsx", "XLSX"],
  ["xml", "XML"],
  ["yaml", "YAML"],
  ["yml", "YAML"],
  ["zsh", "ZSH"],
]);
const SAMPLE_BYTES = 4096;
const OPENCODE_MEDIA_MIMES = new Set(["application/pdf"]);
const LOCAL_PATH_ATTACHMENT_EXTS = new Set([
  ...IMAGE_EXTS.keys(),
  ...FILE_EXTS.keys(),
  "c",
  "cc",
  "cjs",
  "conf",
  "cpp",
  "css",
  "csv",
  "cts",
  "env",
  "go",
  "gql",
  "graphql",
  "h",
  "hh",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mdx",
  "mjs",
  "mts",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

function normalizeMime(type: string): string {
  return type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function getAttachmentDataUrlMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;,]+)[;,]/i);
  return normalizeMime(match?.[1] || "");
}

export function isOpencodeSupportedAttachmentMedia(mime: string): boolean {
  const normalized = normalizeMime(mime);
  return normalized.startsWith("image/") || normalized === "text/plain" || OPENCODE_MEDIA_MIMES.has(normalized);
}

export function isOfficeAttachment(attachment: Pick<OpencodeAttachment, "mime" | "filename">): boolean {
  const mime = normalizeMime(attachment.mime || "");
  if (FILE_MIMES.has(mime)) return true;
  return /(\.docx?|\.pptx?|\.xlsx?)$/i.test(attachment.filename || "");
}

function filenameExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

function attachmentIdentity(attachment: Pick<OpencodeAttachment, "kind" | "filename" | "mime" | "dataUrl" | "sourcePath">): string {
  return [attachment.kind, attachment.filename, attachment.mime, attachment.sourcePath || attachment.dataUrl].join("::");
}

function filenameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function encodeFilePathForUrl(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function fileUrlFromPath(path: string): string {
  const normalized = path.trim();
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return `file:///${encodeFilePathForUrl(normalized.replace(/\\/g, "/"))}`;
  }
  return `file://${encodeFilePathForUrl(normalized)}`;
}

function isTextMime(type: string): boolean {
  if (!type) return false;
  if (type.startsWith("text/")) return true;
  if (TEXT_MIMES.has(type)) return true;
  if (type.endsWith("+json")) return true;
  return type.endsWith("+xml");
}

function looksLikeTextBytes(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let controlCount = 0;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) controlCount += 1;
  }
  return controlCount / bytes.length <= 0.3;
}

export function fileUrlToPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("file://")) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "file:") return null;
    let pathname = url.pathname || "";
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      pathname = url.pathname || "";
    }
    if (!pathname) return null;
    if (/^[a-zA-Z]:/.test(pathname.slice(1))) return pathname.slice(1);
    return pathname;
  } catch {
    return null;
  }
}

function parseLocalPathsFromText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const filePath = fileUrlToPath(entry);
      if (filePath) return [filePath];
      if (entry.startsWith("/")) return [entry];
      if (/^[a-zA-Z]:[\\/]/.test(entry)) return [entry];
      return [];
    });
}

export function extractTransferFiles(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const pushFile = (file: File | null | undefined) => {
    if (!file) return;
    const key = [file.name, file.type, file.size, file.lastModified].join("::");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  Array.from(transfer.items || []).forEach((item) => {
    if (item.kind !== "file") return;
    pushFile(item.getAsFile());
  });
  Array.from(transfer.files || []).forEach((file) => pushFile(file));
  return out;
}

export function extractClipboardFilePaths(transfer: DataTransfer | null | undefined): string[] {
  if (!transfer) return [];
  const out = new Set<string>();
  [transfer.getData("text/uri-list"), transfer.getData("text/plain")]
    .forEach((value) => {
      parseLocalPathsFromText(value).forEach((path) => out.add(path));
    });
  return Array.from(out);
}

export function hasClipboardFileReference(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  if (extractTransferFiles(transfer).length > 0) return true;
  return parseLocalPathsFromText(transfer.getData("text/uri-list")).length > 0;
}

export function hasPlainClipboardText(transfer: DataTransfer | null | undefined): boolean {
  if (!transfer) return false;
  const text = transfer.getData("text/plain").trim();
  return text.length > 0;
}

export function hasTransferAttachments(transfer: DataTransfer | null | undefined): boolean {
  return extractTransferFiles(transfer).length > 0 || extractClipboardFilePaths(transfer).length > 0;
}

export function mergeUniqueAttachments(
  current: OpencodeAttachment[],
  incoming: OpencodeAttachment[]
): OpencodeAttachment[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((attachment) => attachmentIdentity(attachment)));
  const next = [...current];
  incoming.forEach((attachment) => {
    const key = attachmentIdentity(attachment);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(attachment);
  });
  return next;
}

export function getAttachmentBadgeLabel(attachment: Pick<OpencodeAttachment, "mime" | "filename">): string {
  const mime = normalizeMime(attachment.mime || "");
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return BADGE_BY_EXT.get(filenameExt(attachment.filename)) || "IMG";
  const ext = filenameExt(attachment.filename);
  if (BADGE_BY_EXT.has(ext)) return BADGE_BY_EXT.get(ext)!;
  if (mime.includes("json")) return "JSON";
  if (mime.includes("xml")) return "XML";
  if (mime.startsWith("text/")) return "TXT";
  return "FILE";
}

export async function resolveAttachmentMime(file: File): Promise<string | undefined> {
  const type = normalizeMime(file.type);
  if (IMAGE_MIMES.has(type)) return type;
  if (type.startsWith("image/")) return type;
  if (type === "application/pdf") return type;
  if (FILE_MIMES.has(type)) return type;

  const suffix = filenameExt(file.name);
  const fallback = IMAGE_EXTS.get(suffix) ?? FILE_EXTS.get(suffix);
  if ((!type || type === "application/octet-stream") && fallback) return fallback;

  if (isTextMime(type)) return "text/plain";
  const bytes = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  if (!looksLikeTextBytes(bytes)) return undefined;
  return "text/plain";
}

export function isImageAttachment(attachment: Pick<OpencodeAttachment, "kind" | "mime" | "dataUrl" | "filename">): boolean {
  if (attachment.kind === "image") return true;
  if (attachment.mime.startsWith("image/")) return true;
  if (attachment.dataUrl.startsWith("data:image/")) return true;
  return /\.(png|jpe?g|webp|gif|heic)$/i.test(attachment.filename);
}

export function attachmentsFromLocalPaths(paths: string[]): OpencodeAttachment[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean))).map((path) => {
    const filename = filenameFromPath(path);
    const ext = filenameExt(filename);
    if (!LOCAL_PATH_ATTACHMENT_EXTS.has(ext)) return null;
    const fallbackMime = FILE_EXTS.get(ext) || IMAGE_EXTS.get(ext) || "text/plain";
    return {
      id: `file-${makeId()}`,
      kind: "file",
      filename,
      mime: fallbackMime,
      dataUrl: "",
      sourcePath: path
    };
  }).filter(Boolean) as OpencodeAttachment[];
}

export async function readFileAsAttachment(file: File): Promise<OpencodeAttachment | null> {
  const mime = await resolveAttachmentMime(file);
  if (!mime) return null;
  if (isOfficeAttachment({ mime, filename: file.name })) {
    const text = [
      `Attached file "${file.name || "Office document"}" was added.`,
      "",
      "This Office document was pasted or uploaded through a browser file object, so the desktop app cannot access its local path to convert it to text.",
      "OpenCode can directly read images, PDFs, and text attachments. To include this document's contents, use the desktop file picker, export it as PDF/text, or paste the document text."
    ].join("\n");
    return {
      id: `file-${makeId()}`,
      kind: "file",
      filename: file.name || `file-${Date.now()}`,
      mime: "text/plain",
      dataUrl: `data:text/plain;base64,${btoa(unescape(encodeURIComponent(text)))}`
    };
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => resolve(null));
    reader.addEventListener("load", () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      const comma = raw.indexOf(",");
      if (!raw || comma < 0) {
        resolve(null);
        return;
      }
      resolve({
        id: `${mime.startsWith("image/") ? "img" : "file"}-${makeId()}`,
        kind: mime.startsWith("image/") ? "image" : "file",
        filename: file.name || (mime.startsWith("image/") ? `image-${Date.now()}.png` : `file-${Date.now()}`),
        mime,
        dataUrl: `data:${mime};base64,${raw.slice(comma + 1)}`
      });
    });
    reader.readAsDataURL(file);
  });
}

export function readImageFileAsAttachment(file: File): Promise<OpencodeAttachment | null> {
  return readFileAsAttachment(file);
}

function extensionFromMime(mime: string): string {
  const normalized = normalizeMime(mime);
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/tiff") return "tiff";
  return "png";
}

export async function readBrowserClipboardAttachments(): Promise<OpencodeAttachment[]> {
  if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.read !== "function") {
    return [];
  }
  try {
    const clipboardItems = await navigator.clipboard.read();
    const attachments: OpencodeAttachment[] = [];
    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => normalizeMime(type).startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const mime = normalizeMime(blob.type || imageType) || "image/png";
      const ext = extensionFromMime(mime);
      const file = new File([blob], `screenshot-${Date.now()}.${ext}`, { type: mime });
      const attachment = await readFileAsAttachment(file);
      if (attachment) attachments.push(attachment);
    }
    return attachments;
  } catch {
    return [];
  }
}

export async function pickDesktopAttachments(): Promise<OpencodeAttachment[]> {
  if (!IS_TAURI) return [];
  return invoke<OpencodeAttachment[]>("pick_opencode_attachments");
}

export async function readDesktopAttachmentsFromPaths(paths: string[]): Promise<OpencodeAttachment[]> {
  const normalized = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (!IS_TAURI || normalized.length === 0) return [];
  return invoke<OpencodeAttachment[]>("read_opencode_attachments_from_paths", { paths: normalized });
}

export async function readDesktopClipboardFilePaths(): Promise<string[]> {
  if (!IS_TAURI) return [];
  return invoke<string[]>("read_clipboard_file_paths");
}

export async function readDesktopClipboardImageAttachment(): Promise<OpencodeAttachment[]> {
  if (!IS_TAURI) return [];
  return invoke<OpencodeAttachment[]>("read_clipboard_image_attachment");
}

export async function readLocalAttachmentPreview(path: string): Promise<{
  original: string;
  modified: string;
  previewSupported?: boolean;
  previewReason?: string;
  previewKind?: "text" | "document" | "docx" | "spreadsheet" | "pdf" | "image";
  mime?: string;
  dataBase64?: string;
}> {
  return invoke("read_local_attachment_preview", { path });
}

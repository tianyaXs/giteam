/**
 * 附件真实版式缩略快照：统一走系统 QuickLook 渲染管线（macOS 与 Finder 同源）。
 * - 本盘文件：直接传 path；
 * - 粘贴/内存附件：按扩展名暂存为临时文件后传 bytes；
 * - QuickLook 不可用或未出图时返回 null，由 UI 层回退文本行 / glyph。
 */
import {
  dataUrlToBase64Payload,
  documentQuicklookThumbnail,
  documentQuicklookThumbnailFromBytes,
  type AgentAttachment
} from "./imageAttachments";
import { detectDocumentKind } from "./documentTextExtract";

export interface ThumbnailRenderOptions {
  maxWidth: number;
  maxHeight: number;
  pixelRatio?: number;
}

export interface DocumentThumbnail {
  dataUrl: string;
  width: number;
  height: number;
}

/** dataUrl 中真正携带 docx/pdf 二进制的 mime（textutil 转换后的 text/plain 不算）。 */
function isBinaryDocumentMime(mime: string): boolean {
  const normalized = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    normalized === "application/pdf"
    || normalized.startsWith("application/vnd.openxmlformats-officedocument.")
  );
}

/** QuickLook 输出按最长边限制重采样目标；系统本身按最长边出图。 */
function quicklookMaxSize(options: ThumbnailRenderOptions): number {
  const edge = Math.max(options.maxWidth, options.maxHeight);
  return Math.min(1024, Math.max(64, edge * 2));
}

/**
 * 跨组件快照缓存：composer 卡片与消息流悬浮窗共用同一渲染结果。
 * key 区分两种输入（源文件路径 / 二进制字节），同一附件只渲染一次；
 * 在途 promise 也缓存，避免并发重复触发 QuickLook。
 */
const thumbnailCache = new Map<string, Promise<DocumentThumbnail | null>>();
const THUMBNAIL_CACHE_LIMIT = 64;

function thumbnailCacheKey(
  attachment: Pick<AgentAttachment, "filename" | "mime" | "dataUrl" | "sourcePath">
): string {
  const sourcePath = String(attachment.sourcePath || "").trim();
  if (sourcePath) return `path:${sourcePath}`;
  const payload = dataUrlToBase64Payload(attachment.dataUrl);
  if (payload) return `bytes:${payload.mimeType}:${payload.data.length}:${payload.data.slice(0, 64)}`;
  return "";
}

function rememberThumbnail(key: string, task: Promise<DocumentThumbnail | null>) {
  if (!key) return task;
  if (thumbnailCache.has(key)) {
    thumbnailCache.delete(key);
  } else if (thumbnailCache.size >= THUMBNAIL_CACHE_LIMIT) {
    const oldest = thumbnailCache.keys().next().value;
    if (oldest !== undefined) thumbnailCache.delete(oldest);
  }
  thumbnailCache.set(key, task);
  // 失败结果不长期缓存：删除后允许下次重试（临时文件缺失等场景可自愈）。
  task.catch(() => {
    if (thumbnailCache.get(key) === task) thumbnailCache.delete(key);
  });
  return task;
}

/**
 * 渲染文档第 1 页快照；非 docx/pdf 或 QuickLook 失败返回 null（UI 回退）。
 * 路径与字节是同一渲染器的两种输入，不再保留进程内渲染兜底。
 * 结果带模块级缓存：同附件第二次调用（跨组件/跨消息）同步命中在途或已完成 promise。
 */
export async function renderDocumentThumbnail(
  attachment: Pick<AgentAttachment, "filename" | "mime" | "dataUrl" | "sourcePath">,
  options: ThumbnailRenderOptions
): Promise<DocumentThumbnail | null> {
  const kind = detectDocumentKind(attachment.filename, attachment.mime);
  if (kind !== "docx" && kind !== "pdf") return null;
  const cacheKey = thumbnailCacheKey(attachment);
  const cached = thumbnailCache.get(cacheKey);
  if (cached) return cached;

  const maxSize = quicklookMaxSize(options);
  const edge = Math.max(options.maxWidth, options.maxHeight);
  const toSnapshot = (dataUrl: string): DocumentThumbnail | null =>
    dataUrl ? { dataUrl, width: edge, height: edge } : null;

  const task = (async () => {
    // 1) 本盘已有源文件：直接交给 QuickLook。
    const sourcePath = String(attachment.sourcePath || "").trim();
    if (sourcePath) {
      return toSnapshot(await documentQuicklookThumbnail(sourcePath, maxSize));
    }

    // 只有字节（粘贴附件常态）：暂存后走同一系统渲染器。
    const payload = dataUrlToBase64Payload(attachment.dataUrl);
    if (payload && isBinaryDocumentMime(payload.mimeType)) {
      return toSnapshot(await documentQuicklookThumbnailFromBytes(payload.data, attachment.filename, maxSize));
    }

    return null;
  })();

  return rememberThumbnail(cacheKey, task);
}

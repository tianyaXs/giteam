import { invoke, listen } from "./platform";

/** 项目分享（对应 giteam-core share 模块 / `giteam share` CLI）。 */

export type ShareCreateResult = {
  shareId: string;
  shareUrl: string;
  gitUrl: string;
  /** 代码 + 上下文合计。 */
  sizeBytes: number;
  repoSizeBytes: number;
  contextSizeBytes: number;
  sessions: number;
  memory: boolean;
  attachments: boolean;
  reviews: number;
  redactions: number;
  warnings: string[];
};

export type ShareImportResult = {
  targetDir: string;
  repoName: string;
  sessionsImported: number;
  catalogRecordsMerged: number;
  memoryImported: boolean;
  attachmentsImported: number;
  reviewsImported: number;
  warnings: string[];
};

/** 导入进度（`giteam://share-import-progress`）。 */
export type ShareImportProgress = {
  stage: string;
  message: string;
  percent: number;
  bytesDone?: number | null;
  bytesTotal?: number | null;
};

/** 导出项目快照并上传，返回分享地址。 */
export async function shareCreate(repoPath: string): Promise<ShareCreateResult> {
  return invoke<ShareCreateResult>("share_create", { repoPath });
}

/** 凭分享地址导入项目（下载 → clone → rekey → 注册到项目列表）。 */
export async function shareImport(
  url: string,
  dir?: string,
  attach?: string,
  name?: string
): Promise<ShareImportResult> {
  return invoke<ShareImportResult>("share_import", {
    url,
    dir: dir?.trim() ? dir.trim() : null,
    attach: attach?.trim() ? attach.trim() : null,
    name: name?.trim() ? name.trim() : null,
  });
}

/** 订阅导入进度；返回取消订阅函数。 */
export async function listenShareImportProgress(
  handler: (progress: ShareImportProgress) => void
): Promise<() => void> {
  return listen<ShareImportProgress>("giteam://share-import-progress", (event) => {
    handler(event.payload);
  });
}

/** 取消正在进行的分享导入。 */
export async function shareImportCancel(): Promise<void> {
  await invoke("share_import_cancel");
}

export function isShareImportCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /已取消|cancelled/i.test(message);
}

export function formatShareBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

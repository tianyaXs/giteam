import { invoke } from "./platform";

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

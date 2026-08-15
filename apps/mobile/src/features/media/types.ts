export type ComposerAttachment = {
  id: string;
  uri: string;
  filename: string;
  mime: string;
  dataUrl: string;
  /** 来自系统相册时的 MediaLibrary asset id，用于重开相册回显选中。 */
  sourceAssetId?: string;
  status?: 'processing' | 'ready' | 'uploading' | 'failed' | 'pending_retry';
  statusText?: string;
};

export type RecentImageItem = {
  id: string;
  uri: string;
  filename: string;
  mediaType?: string;
};

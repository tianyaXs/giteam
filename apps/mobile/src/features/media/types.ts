export type ComposerAttachment = {
  id: string;
  uri: string;
  filename: string;
  mime: string;
  dataUrl: string;
  status?: 'processing' | 'ready' | 'uploading' | 'failed';
  statusText?: string;
};

export type RecentImageItem = {
  id: string;
  uri: string;
  filename: string;
  mediaType?: string;
};

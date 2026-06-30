import { useCallback, useMemo, useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';

type AlbumImageItem = {
  id: string;
  uri: string;
  filename: string;
  mediaType?: string;
};

type MediaAlbum = {
  id: string;
  title: string;
  assetCount?: number;
};

export type AlbumPickerPurpose = 'attachment' | 'qr-scan';

export function useAlbumPickerController(props: {
  setStatus: (message: string) => void;
  inferMimeFromFilename: (filename: string) => string;
  onAppendAssets: (items: Array<{ uri: string; filename: string; mime: string }>) => Promise<void>;
  onPickForQrScan?: (item: { uri: string; filename: string }) => Promise<void>;
}) {
  const { inferMimeFromFilename, onAppendAssets, onPickForQrScan, setStatus } = props;
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [albumPickerPurpose, setAlbumPickerPurpose] = useState<AlbumPickerPurpose>('attachment');
  const [albumImages, setAlbumImages] = useState<AlbumImageItem[]>([]);
  const [albumImagesLoading, setAlbumImagesLoading] = useState(false);
  const [albumImagesLoadingMore, setAlbumImagesLoadingMore] = useState(false);
  const [albumCursor, setAlbumCursor] = useState<string | undefined>(undefined);
  const [albumHasNext, setAlbumHasNext] = useState(false);
  const [mediaAlbums, setMediaAlbums] = useState<MediaAlbum[]>([]);
  const [selectedMediaAlbumId, setSelectedMediaAlbumId] = useState('all');
  const [albumSelectedIds, setAlbumSelectedIds] = useState<string[]>([]);
  const albumImagesLoadingRef = useRef(false);
  const albumPickerPurposeRef = useRef<AlbumPickerPurpose>('attachment');

  const albumSelectedSet = useMemo(() => new Set(albumSelectedIds), [albumSelectedIds]);

  const mediaAssetsToRecentItems = useCallback((assets: MediaLibrary.Asset[]): AlbumImageItem[] => {
    return assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      filename: asset.filename || `photo-${asset.id}.jpg`,
      mediaType: String(asset.mediaType || '')
    }));
  }, []);

  const loadAlbumImages = useCallback(async (opts?: { albumId?: string; append?: boolean }) => {
    const albumId = opts?.albumId ?? selectedMediaAlbumId;
    const append = Boolean(opts?.append);
    if (albumImagesLoadingRef.current) return;
    if (append && !albumHasNext) return;
    try {
      albumImagesLoadingRef.current = true;
      if (append) {
        setAlbumImagesLoadingMore(true);
      } else {
        setAlbumImagesLoading(true);
        setAlbumImages([]);
        setAlbumCursor(undefined);
      }
      const album = albumId === 'all' ? undefined : albumId;
      const page = await MediaLibrary.getAssetsAsync({
        first: 80,
        after: append ? albumCursor : undefined,
        album,
        mediaType: [MediaLibrary.MediaType.photo],
        sortBy: [MediaLibrary.SortBy.creationTime]
      });
      const items = mediaAssetsToRecentItems(page.assets);
      setAlbumImages((prev) => append ? [...prev, ...items.filter((item) => !prev.some((old) => old.id === item.id))] : items);
      setAlbumCursor(page.endCursor || undefined);
      setAlbumHasNext(Boolean(page.hasNextPage));
    } catch (e) {
      if (!append) setAlbumImages([]);
      setStatus(`读取相册失败: ${String(e)}`);
    } finally {
      albumImagesLoadingRef.current = false;
      setAlbumImagesLoading(false);
      setAlbumImagesLoadingMore(false);
    }
  }, [albumCursor, albumHasNext, mediaAssetsToRecentItems, selectedMediaAlbumId, setStatus]);

  const prepareAlbumPicker = useCallback(async (purpose: AlbumPickerPurpose) => {
    albumPickerPurposeRef.current = purpose;
    setAlbumPickerPurpose(purpose);
    setAlbumPickerOpen(true);
    setAlbumSelectedIds([]);
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) {
      setAlbumPickerOpen(false);
      setStatus('相册权限被拒绝');
      return false;
    }
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    const mappedAlbums = albums
      .filter((album) => (album.assetCount || 0) > 0)
      .map((album) => ({ id: album.id, title: album.title || '相册', assetCount: album.assetCount }));
    setMediaAlbums([{ id: 'all', title: '图片和视频' }, ...mappedAlbums]);
    setSelectedMediaAlbumId('all');
    await loadAlbumImages({ albumId: 'all' });
    return true;
  }, [loadAlbumImages, setStatus]);

  const openAlbumPicker = useCallback(async () => {
    try {
      await prepareAlbumPicker('attachment');
    } catch (e) {
      setAlbumPickerOpen(false);
      setStatus(`读取相册失败: ${String(e)}`);
    }
  }, [prepareAlbumPicker, setStatus]);

  const openAlbumPickerForQrScan = useCallback(async () => {
    try {
      await prepareAlbumPicker('qr-scan');
    } catch (e) {
      setAlbumPickerOpen(false);
      setStatus(`读取相册失败: ${String(e)}`);
    }
  }, [prepareAlbumPicker, setStatus]);

  const closeAlbumPicker = useCallback(() => {
    setAlbumPickerOpen(false);
  }, []);

  const selectMediaAlbum = useCallback((albumId: string) => {
    setSelectedMediaAlbumId(albumId);
    setAlbumSelectedIds([]);
    void loadAlbumImages({ albumId });
  }, [loadAlbumImages]);

  const toggleAlbumImage = useCallback((id: string) => {
    if (albumPickerPurposeRef.current === 'qr-scan') {
      setAlbumSelectedIds([id]);
      return;
    }
    setAlbumSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }, []);

  const confirmAlbumSelection = useCallback(async () => {
    const selected = albumImages.filter((item) => albumSelectedIds.includes(item.id));
    setAlbumPickerOpen(false);
    setAlbumSelectedIds([]);
    if (selected.length === 0) return;

    if (albumPickerPurposeRef.current === 'qr-scan') {
      const item = selected[0];
      await onPickForQrScan?.({ uri: item.uri, filename: item.filename });
      return;
    }

    await onAppendAssets(selected.map((item) => ({
      uri: item.uri,
      filename: item.filename,
      mime: inferMimeFromFilename(item.filename)
    })));
  }, [albumImages, albumSelectedIds, inferMimeFromFilename, onAppendAssets, onPickForQrScan]);

  const loadMoreAlbumImages = useCallback(() => {
    void loadAlbumImages({ append: true });
  }, [loadAlbumImages]);

  return {
    albumPickerOpen,
    albumPickerPurpose,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    mediaAlbums,
    selectedMediaAlbumId,
    albumSelectedIds,
    albumSelectedSet,
    closeAlbumPicker,
    openAlbumPicker,
    openAlbumPickerForQrScan,
    selectMediaAlbum,
    toggleAlbumImage,
    confirmAlbumSelection,
    loadMoreAlbumImages
  };
}

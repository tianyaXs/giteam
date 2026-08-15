import { useCallback, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
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
  getAttachedAlbumAssets?: () => Array<{ id: string; uri: string; filename: string }>;
  onSyncAlbumAssets: (items: Array<{ id: string; uri: string; filename: string; mime: string }>) => Promise<void>;
  onPickForQrScan?: (item: { uri: string; filename: string }) => Promise<void>;
}) {
  const { getAttachedAlbumAssets, inferMimeFromFilename, onPickForQrScan, onSyncAlbumAssets, setStatus } = props;
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
  /** 跨相册保留选中项的完整元数据（确认时不依赖当前页 albumImages）。 */
  const albumSelectedItemsRef = useRef<Map<string, AlbumImageItem>>(new Map());
  /** 新插入头部的缩略图 id：用于淡入，不整表闪烁。 */
  const [freshAlbumImageIds, setFreshAlbumImageIds] = useState<string[]>([]);
  /** confirm=quick 收起；cancel=slide 下滑。 */
  const [albumExitMode, setAlbumExitMode] = useState<'slide' | 'quick'>('slide');
  const albumImagesLoadingRef = useRef(false);
  const albumPickerPurposeRef = useRef<AlbumPickerPurpose>('attachment');
  const albumImagesRef = useRef<AlbumImageItem[]>([]);
  const selectedMediaAlbumIdRef = useRef('all');
  albumImagesRef.current = albumImages;
  selectedMediaAlbumIdRef.current = selectedMediaAlbumId;

  const albumSelectedSet = useMemo(() => new Set(albumSelectedIds), [albumSelectedIds]);
  const freshAlbumImageIdSet = useMemo(() => new Set(freshAlbumImageIds), [freshAlbumImageIds]);

  const mediaAssetsToRecentItems = useCallback((assets: MediaLibrary.Asset[]): AlbumImageItem[] => {
    return assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      filename: asset.filename || `photo-${asset.id}.jpg`,
      mediaType: String(asset.mediaType || '')
    }));
  }, []);

  const loadAlbumImages = useCallback(async (opts?: { albumId?: string; append?: boolean }) => {
    const albumId = opts?.albumId ?? selectedMediaAlbumIdRef.current;
    const append = Boolean(opts?.append);
    if (albumImagesLoadingRef.current) return;
    if (append && !albumHasNext) return;

    const cached = albumImagesRef.current;
    const sameAlbum = albumId === selectedMediaAlbumIdRef.current;
    const hasCache = sameAlbum && cached.length > 0;

    try {
      albumImagesLoadingRef.current = true;
      if (append) {
        setAlbumImagesLoadingMore(true);
      } else if (!hasCache) {
        // 仅无缓存时显示整页 loading；有缓存则静默刷新，避免「整表刷新」感。
        setAlbumImagesLoading(true);
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
      // 若已有选中项，用相册原始资源刷新元数据（便于再次确认时用到正确 uri）。
      items.forEach((item) => {
        if (albumSelectedItemsRef.current.has(item.id)) {
          albumSelectedItemsRef.current.set(item.id, item);
        }
      });

      if (append) {
        setAlbumImages((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...items.filter((item) => !seen.has(item.id))];
        });
        setFreshAlbumImageIds([]);
      } else if (!hasCache) {
        setAlbumImages(items);
        setFreshAlbumImageIds([]);
      } else {
        // 静默合并：复用已有行对象；仅新增头部条目做淡入，避免整表刷新。
        const prevById = new Map(cached.map((item) => [item.id, item]));
        const prevIds = new Set(prevById.keys());
        const headFresh: string[] = [];
        const merged = items.map((item) => {
          const existing = prevById.get(item.id);
          if (existing) return existing;
          if (!prevIds.has(item.id)) headFresh.push(item.id);
          return item;
        });
        setAlbumImages(merged);
        setFreshAlbumImageIds(headFresh);
        if (headFresh.length > 0) {
          setTimeout(() => {
            setFreshAlbumImageIds((prev) => prev.filter((id) => !headFresh.includes(id)));
          }, 700);
        }
      }

      setAlbumCursor(page.endCursor || undefined);
      setAlbumHasNext(Boolean(page.hasNextPage));
    } catch (e) {
      if (!append && albumImagesRef.current.length === 0) setAlbumImages([]);
      setStatus(`读取相册失败: ${String(e)}`);
    } finally {
      albumImagesLoadingRef.current = false;
      setAlbumImagesLoading(false);
      setAlbumImagesLoadingMore(false);
    }
  }, [albumCursor, albumHasNext, mediaAssetsToRecentItems, setStatus]);

  const prepareAlbumPicker = useCallback(async (purpose: AlbumPickerPurpose) => {
    albumPickerPurposeRef.current = purpose;
    setAlbumPickerPurpose(purpose);
    setFreshAlbumImageIds([]);

    if (purpose === 'attachment') {
      // 重开相册：用当前输入栏已添加的相册图回显选中标记。
      const attached = getAttachedAlbumAssets?.() || [];
      const nextMap = new Map<string, AlbumImageItem>();
      attached.forEach((item) => {
        nextMap.set(item.id, {
          id: item.id,
          uri: item.uri,
          filename: item.filename
        });
      });
      albumSelectedItemsRef.current = nextMap;
      setAlbumSelectedIds(attached.map((item) => item.id));
    } else {
      albumSelectedItemsRef.current = new Map();
      setAlbumSelectedIds([]);
    }

    // 先打开面板（带缓存内容），再后台拉权限与数据，避免空态闪一下。
    setAlbumPickerOpen(true);

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
    if (selectedMediaAlbumIdRef.current !== 'all') {
      setSelectedMediaAlbumId('all');
    }
    await loadAlbumImages({ albumId: 'all' });
    return true;
  }, [getAttachedAlbumAssets, loadAlbumImages, setStatus]);

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
    setAlbumExitMode('slide');
    setAlbumPickerOpen(false);
  }, []);

  const selectMediaAlbum = useCallback((albumId: string) => {
    const switching = albumId !== selectedMediaAlbumIdRef.current;
    selectedMediaAlbumIdRef.current = albumId;
    setSelectedMediaAlbumId(albumId);
    setFreshAlbumImageIds([]);
    // 切换分组时保留已选图片，不清空 albumSelectedIds。
    if (switching) {
      albumImagesRef.current = [];
      setAlbumImages([]);
    }
    void loadAlbumImages({ albumId });
  }, [loadAlbumImages]);

  const toggleAlbumImage = useCallback((id: string) => {
    const item =
      albumImagesRef.current.find((entry) => entry.id === id) ||
      albumSelectedItemsRef.current.get(id);
    if (albumPickerPurposeRef.current === 'qr-scan') {
      albumSelectedItemsRef.current = item ? new Map([[id, item]]) : new Map();
      setAlbumSelectedIds(item ? [id] : []);
      return;
    }
    setAlbumSelectedIds((prev) => {
      if (prev.includes(id)) {
        albumSelectedItemsRef.current.delete(id);
        return prev.filter((entry) => entry !== id);
      }
      if (item) albumSelectedItemsRef.current.set(id, item);
      return [...prev, id];
    });
  }, []);

  const confirmAlbumSelection = useCallback(() => {
    const selected = albumSelectedIds
      .map((id) => albumSelectedItemsRef.current.get(id) || albumImagesRef.current.find((item) => item.id === id))
      .filter(Boolean) as AlbumImageItem[];

    // 先短收起相册，再推迟写入缩略图，避免动画与多图 setState/压缩叠帧卡顿。
    setAlbumExitMode('quick');
    setAlbumPickerOpen(false);

    if (albumPickerPurposeRef.current === 'qr-scan') {
      albumSelectedItemsRef.current = new Map();
      setAlbumSelectedIds([]);
      if (selected.length === 0) return;
      const item = selected[0];
      InteractionManager.runAfterInteractions(() => {
        void onPickForQrScan?.({ uri: item.uri, filename: item.filename });
      });
      return;
    }

    const payload = selected.map((item) => ({
      id: item.id,
      uri: item.uri,
      filename: item.filename,
      mime: inferMimeFromFilename(item.filename)
    }));
    InteractionManager.runAfterInteractions(() => {
      // quick 收起约 120ms；再让出一帧给布局稳定。
      setTimeout(() => {
        void onSyncAlbumAssets(payload);
      }, 140);
    });
  }, [albumSelectedIds, inferMimeFromFilename, onPickForQrScan, onSyncAlbumAssets]);

  const loadMoreAlbumImages = useCallback(() => {
    void loadAlbumImages({ append: true });
  }, [loadAlbumImages]);

  return {
    albumPickerOpen,
    albumPickerPurpose,
    albumExitMode,
    albumImages,
    albumImagesLoading,
    albumImagesLoadingMore,
    freshAlbumImageIdSet,
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

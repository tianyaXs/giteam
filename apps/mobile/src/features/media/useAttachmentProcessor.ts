import { useCallback, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { toText } from '../../lib/text';
import type { ComposerAttachment, RecentImageItem } from './types';
import { useAlbumPickerController } from './useAlbumPickerController';

const IMAGE_SEND_TARGET_BASE64_LENGTH = 1_100_000;

type AttachmentAssetInput = {
  uri: string;
  filename: string;
  mime?: string;
  dataUrl?: string;
  sourceAssetId?: string;
};

export function inferMimeFromFilename(filename: string): string {
  const lower = toText(filename).toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/jpeg';
}

export function useAttachmentProcessor(props: {
  setStatus: (message: string) => void;
  imageAttachments: ComposerAttachment[];
  setImageAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
  setAttachmentMenuOpen: (open: boolean) => void;
  onQrScanFromAlbum?: (uri: string) => Promise<void>;
}) {
  const { imageAttachments, onQrScanFromAlbum, setAttachmentMenuOpen, setImageAttachments, setStatus } = props;
  const [photoCameraOpen, setPhotoCameraOpen] = useState(false);
  const [photoCameraReady, setPhotoCameraReady] = useState(false);
  const [photoCameraBusy, setPhotoCameraBusy] = useState(false);
  const photoCameraRef = useRef<any>(null);
  const imageAttachmentsRef = useRef<ComposerAttachment[]>(imageAttachments);
  imageAttachmentsRef.current = imageAttachments;

  const fileUriToDataUrl = useCallback(
    async (uri: string, fallbackMime: string): Promise<string> => {
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: 'base64'
        });
        if (!base64 || base64.length < 20) throw new Error('empty base64');
        return `data:${fallbackMime};base64,${base64}`;
      } catch (e) {
        setStatus(`读取文件失败: ${String(e)}`);
        throw e;
      }
    },
    [setStatus]
  );

  const compressImageForSend = useCallback(
    async (item: AttachmentAssetInput): Promise<AttachmentAssetInput> => {
      const mime = toText(item.mime).trim() || inferMimeFromFilename(item.filename);
      const sourceUri = toText(item.uri).trim();
      if (!mime.startsWith('image/') || !sourceUri) {
        return { ...item, mime, dataUrl: item.dataUrl || '' };
      }

      const attempts = [
        { width: 1280, compress: 0.62 },
        { width: 1024, compress: 0.5 },
        { width: 896, compress: 0.42 },
        { width: 768, compress: 0.34 },
        { width: 640, compress: 0.28 },
        { width: 512, compress: 0.22 }
      ];
      let best: { uri: string; dataUrl: string; mime: string } | null = null;
      for (const attempt of attempts) {
        try {
          const result = await ImageManipulator.manipulateAsync(
            sourceUri,
            [{ resize: { width: attempt.width } }],
            { compress: attempt.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true }
          );
          const base64 = toText(result.base64);
          if (!base64 || base64.length <= 20) continue;
          best = { uri: result.uri || sourceUri, dataUrl: `data:image/jpeg;base64,${base64}`, mime: 'image/jpeg' };
          if (base64.length <= IMAGE_SEND_TARGET_BASE64_LENGTH) break;
        } catch {
          // Try the next compression profile.
        }
      }
      if (best) return { ...item, uri: best.uri, mime: best.mime, dataUrl: best.dataUrl };
      const fallback = item.dataUrl || (await fileUriToDataUrl(sourceUri, mime));
      return { ...item, mime, dataUrl: fallback };
    },
    [fileUriToDataUrl]
  );

  const appendAssetsAsAttachments = useCallback(
    async (items: AttachmentAssetInput[]) => {
      if (items.length <= 0) return;
      try {
        setStatus('正在处理图片...');
        const stamp = Date.now();
        const placeholders: ComposerAttachment[] = items.map((item, idx) => {
          const id = `img-${stamp}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
          const initialMime = toText(item.mime).trim() || inferMimeFromFilename(item.filename);
          const sourceAssetId = toText(item.sourceAssetId).trim() || undefined;
          return {
            id,
            uri: item.uri,
            filename: item.filename,
            mime: initialMime,
            dataUrl: item.dataUrl || '',
            sourceAssetId,
            status: 'processing' as const,
            statusText: '压缩中'
          };
        });
        // 一次插入全部占位缩略图，避免 N 次 setState 连闪。
        setImageAttachments((prev) => [...prev, ...placeholders]);

        // 逐张压缩，每张之间让出一帧，降低与 UI 抢主线程。
        for (let i = 0; i < placeholders.length; i += 1) {
          const placeholder = placeholders[i];
          const item = items[i];
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
          try {
            const prepared = await compressImageForSend(item);
            const mime = toText(prepared.mime).trim() || inferMimeFromFilename(prepared.filename);
            const dataUrl = prepared.dataUrl || (await fileUriToDataUrl(prepared.uri, mime));
            if (!dataUrl || dataUrl.length <= 20) throw new Error('empty image data');
            const next: ComposerAttachment = {
              id: placeholder.id,
              uri: prepared.uri,
              filename: prepared.filename,
              mime,
              dataUrl,
              sourceAssetId: placeholder.sourceAssetId,
              status: 'ready',
              statusText: '就绪'
            };
            setImageAttachments((prev) => prev.map((img) => (img.id === placeholder.id ? next : img)));
          } catch {
            setImageAttachments((prev) =>
              prev.map((img) => (img.id === placeholder.id ? { ...img, status: 'failed', statusText: '处理失败' } : img))
            );
          }
        }
        setStatus('图片已添加');
      } catch (e) {
        setStatus(`处理图片失败: ${String(e)}`);
      }
    },
    [compressImageForSend, fileUriToDataUrl, setImageAttachments, setStatus]
  );

  const getAttachedAlbumAssets = useCallback((): Array<{ id: string; uri: string; filename: string }> => {
    return imageAttachmentsRef.current
      .map((img) => {
        const sourceId = toText(img.sourceAssetId).trim();
        if (!sourceId) return null;
        return { id: sourceId, uri: img.uri, filename: img.filename };
      })
      .filter(Boolean) as Array<{ id: string; uri: string; filename: string }>;
  }, []);

  const syncAlbumAssetsToAttachments = useCallback(
    async (selected: Array<{ id: string; uri: string; filename: string; mime: string }>) => {
      const selectedIds = new Set(selected.map((item) => item.id));
      const prev = imageAttachmentsRef.current;
      // 取消勾选的相册图从附件栏移除；非相册来源附件保留。
      const kept = prev.filter((img) => {
        const sourceId = toText(img.sourceAssetId).trim();
        if (!sourceId) return true;
        return selectedIds.has(sourceId);
      });
      const keptSourceIds = new Set(
        kept.map((img) => toText(img.sourceAssetId).trim()).filter(Boolean)
      );
      if (kept.length !== prev.length) {
        setImageAttachments(kept);
        imageAttachmentsRef.current = kept;
      }
      const toAdd = selected.filter((item) => !keptSourceIds.has(item.id));
      if (toAdd.length > 0) {
        await appendAssetsAsAttachments(
          toAdd.map((item) => ({
            uri: item.uri,
            filename: item.filename,
            mime: item.mime,
            sourceAssetId: item.id
          }))
        );
      } else if (kept.length !== prev.length) {
        setStatus(kept.length > 0 ? '已更新图片' : '已清空相册图片');
      }
    },
    [appendAssetsAsAttachments, setImageAttachments, setStatus]
  );

  const albumPicker = useAlbumPickerController({
    setStatus,
    inferMimeFromFilename,
    getAttachedAlbumAssets,
    onSyncAlbumAssets: syncAlbumAssetsToAttachments,
    onPickForQrScan: onQrScanFromAlbum
      ? async (item) => onQrScanFromAlbum(item.uri)
      : undefined
  });

  const pickImageFromLibrary = useCallback(
    async (kind: 'album' | 'file') => {
      try {
        if (kind === 'file') {
          const result = await DocumentPicker.getDocumentAsync({
            type: '*/*',
            multiple: true,
            copyToCacheDirectory: true
          });
          if (result.canceled || !result.assets?.length) return;
          await appendAssetsAsAttachments(
            result.assets.map((asset, idx) => ({
              uri: asset.uri,
              filename: asset.name || `file-${idx}`,
              mime: asset.mimeType || 'application/octet-stream',
              dataUrl: ''
            }))
          );
          return;
        }
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setStatus('相册权限被拒绝');
          return;
        }
        const pick = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 0.35,
          base64: false
        });
        if (pick.canceled || !pick.assets?.length) return;
        await appendAssetsAsAttachments(
          pick.assets.map((asset, idx) => {
            const base64 = asset.base64;
            const mime = asset.mimeType || 'image/png';
            return {
              uri: asset.uri,
              filename: asset.fileName || `image-${idx}.png`,
              mime,
              dataUrl: base64 && base64.length > 20 ? `data:${mime};base64,${base64}` : ''
            };
          })
        );
      } catch (e) {
        setStatus(kind === 'album' ? `选择图片失败: ${String(e)}` : `选择文件失败: ${String(e)}`);
      }
    },
    [appendAssetsAsAttachments, setStatus]
  );

  const captureWithCamera = useCallback(async () => {
    try {
      setPhotoCameraOpen(false);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setStatus('相机权限被拒绝');
        return;
      }
      const pick = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        base64: false
      });
      if (pick.canceled || !pick.assets?.[0]) return;
      const asset = pick.assets[0];
      await appendAssetsAsAttachments([
        {
          uri: asset.uri,
          filename: asset.fileName || `camera-${Date.now()}.jpg`,
          mime: asset.mimeType || 'image/jpeg'
        }
      ]);
    } catch (e) {
      setStatus(`拍照失败: ${String(e)}`);
    }
  }, [appendAssetsAsAttachments, setStatus]);

  const takePhotoFromInlineCamera = useCallback(async () => {
    if (photoCameraBusy) return;
    try {
      setPhotoCameraBusy(true);
      const photo = await photoCameraRef.current?.takePictureAsync?.({
        quality: 0.6,
        base64: false,
        skipProcessing: false
      });
      if (!photo?.uri) return;
      setPhotoCameraOpen(false);
      const base64 = photo.base64;
      const mime = 'image/jpeg';
      await appendAssetsAsAttachments([
        {
          uri: photo.uri,
          filename: `camera-${Date.now()}.jpg`,
          mime,
          dataUrl: base64 && base64.length > 20 ? `data:${mime};base64,${base64}` : ''
        }
      ]);
    } catch (e) {
      setStatus(`拍照失败: ${String(e)}`);
    } finally {
      setPhotoCameraBusy(false);
    }
  }, [appendAssetsAsAttachments, photoCameraBusy, setStatus]);

  const attachRecentImage = useCallback(
    async (item: RecentImageItem) => {
      setAttachmentMenuOpen(false);
      await appendAssetsAsAttachments([
        {
          uri: item.uri,
          filename: item.filename,
          mime: inferMimeFromFilename(item.filename)
        }
      ]);
    },
    [appendAssetsAsAttachments, setAttachmentMenuOpen]
  );

  return {
    ...albumPicker,
    photoCameraOpen,
    photoCameraReady,
    photoCameraBusy,
    photoCameraRef,
    setPhotoCameraOpen,
    setPhotoCameraReady,
    appendAssetsAsAttachments,
    pickImageFromLibrary,
    captureWithCamera,
    takePhotoFromInlineCamera,
    attachRecentImage
  };
}

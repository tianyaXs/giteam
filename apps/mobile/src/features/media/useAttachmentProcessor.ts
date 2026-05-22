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
  setImageAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>;
  setAttachmentMenuOpen: (open: boolean) => void;
}) {
  const { setAttachmentMenuOpen, setImageAttachments, setStatus } = props;
  const [photoCameraOpen, setPhotoCameraOpen] = useState(false);
  const [photoCameraReady, setPhotoCameraReady] = useState(false);
  const [photoCameraBusy, setPhotoCameraBusy] = useState(false);
  const photoCameraRef = useRef<any>(null);

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
      try {
        if (items.length > 0) setStatus('正在处理图片...');
        await Promise.all(
          items.map(async (item, idx) => {
            const id = `img-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
            const initialMime = toText(item.mime).trim() || inferMimeFromFilename(item.filename);
            setImageAttachments((prev) => [
              ...prev,
              {
                id,
                uri: item.uri,
                filename: item.filename,
                mime: initialMime,
                dataUrl: item.dataUrl || '',
                status: 'processing',
                statusText: '压缩中'
              }
            ]);
            try {
              const prepared = await compressImageForSend(item);
              const mime = toText(prepared.mime).trim() || inferMimeFromFilename(prepared.filename);
              const dataUrl = prepared.dataUrl || (await fileUriToDataUrl(prepared.uri, mime));
              if (!dataUrl || dataUrl.length <= 20) throw new Error('empty image data');
              const next = {
                id,
                uri: prepared.uri,
                filename: prepared.filename,
                mime,
                dataUrl,
                status: 'ready' as const,
                statusText: '就绪'
              } satisfies ComposerAttachment;
              setImageAttachments((prev) => prev.map((img) => (img.id === id ? next : img)));
            } catch (e) {
              setImageAttachments((prev) => prev.map((img) => (img.id === id ? { ...img, status: 'failed', statusText: '处理失败' } : img)));
              throw e;
            }
          })
        );
        setStatus('图片已添加');
      } catch (e) {
        setStatus(`处理图片失败: ${String(e)}`);
      }
    },
    [compressImageForSend, fileUriToDataUrl, setImageAttachments, setStatus]
  );

  const albumPicker = useAlbumPickerController({
    setStatus,
    inferMimeFromFilename,
    onAppendAssets: appendAssetsAsAttachments
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

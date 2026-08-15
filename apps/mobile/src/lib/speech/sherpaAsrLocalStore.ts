import * as FileSystem from 'expo-file-system/legacy';
import {
  SHERPA_ASR_HF_MIRROR,
  SHERPA_ASR_HF_REPO,
  SHERPA_ASR_MODEL_FILES,
  SHERPA_ASR_MODEL_SIZE_HINT_BYTES,
  SHERPA_OFFLINE_ASR_MODEL_ID
} from './sherpaAsrConfig';
import { logSpeechInput } from './speechInputDebug';

export type SherpaAsrDownloadProgress = {
  phase: 'preparing' | 'downloading' | 'verifying' | 'done';
  /** 0–100 */
  percent: number;
  fileName?: string;
};

const MIN_ONNX_BYTES = 50 * 1024 * 1024;

function modelRootDir(): string {
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error('documentDirectory-unavailable');
  return `${base}sherpa-asr/${SHERPA_OFFLINE_ASR_MODEL_ID}`;
}

function fileUri(fileName: string): string {
  return `${modelRootDir()}/${fileName}`;
}

function stripFileScheme(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

function hfFileUrl(fileName: string): string {
  return `${SHERPA_ASR_HF_MIRROR}/${SHERPA_ASR_HF_REPO}/resolve/main/${fileName}`;
}

export function getSherpaAsrLocalModelDir(): string {
  return stripFileScheme(modelRootDir());
}

export async function isSherpaAsrLocalModelReady(): Promise<boolean> {
  try {
    for (const fileName of SHERPA_ASR_MODEL_FILES) {
      const info = await FileSystem.getInfoAsync(fileUri(fileName));
      if (!info.exists || info.isDirectory) return false;
      if (fileName.endsWith('.onnx')) {
        const size = 'size' in info && typeof info.size === 'number' ? info.size : 0;
        if (size < MIN_ONNX_BYTES) return false;
      }
    }
    return true;
  } catch (error) {
    logSpeechInput('sherpa.local.ready.error', {
      message: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

let downloadPromise: Promise<void> | null = null;
let abortRequested = false;
let activeDownloadTask: FileSystem.DownloadResumable | null = null;

export function isSherpaAsrDownloadInFlight(): boolean {
  return downloadPromise != null;
}

export async function cancelSherpaAsrModelDownload(): Promise<void> {
  abortRequested = true;
  const task = activeDownloadTask;
  activeDownloadTask = null;
  if (!task) return;
  try {
    await task.pauseAsync();
  } catch {
    // ignore
  }
}

async function downloadOneFile(
  fileName: string,
  weightStart: number,
  weightEnd: number,
  onProgress?: (progress: SherpaAsrDownloadProgress) => void
): Promise<void> {
  const dest = fileUri(fileName);
  const tmp = `${dest}.partial`;
  try {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
  } catch {
    // ignore
  }

  const task = FileSystem.createDownloadResumable(
    hfFileUrl(fileName),
    tmp,
    {},
    (event) => {
      if (abortRequested) return;
      const total = event.totalBytesExpectedToWrite;
      const written = event.totalBytesWritten;
      const fileRatio = total > 0 ? Math.min(1, written / total) : 0;
      const percent = Math.round(weightStart + (weightEnd - weightStart) * fileRatio);
      onProgress?.({
        phase: 'downloading',
        percent: Math.max(0, Math.min(99, percent)),
        fileName
      });
    }
  );
  activeDownloadTask = task;

  try {
    const result = await task.downloadAsync();
    if (abortRequested) {
      try {
        await FileSystem.deleteAsync(tmp, { idempotent: true });
      } catch {
        // ignore
      }
      throw new Error('download-cancelled');
    }
    if (!result?.uri) {
      throw new Error(`download-failed:${fileName}`);
    }

    try {
      await FileSystem.deleteAsync(dest, { idempotent: true });
    } catch {
      // ignore
    }
    await FileSystem.moveAsync({ from: result.uri, to: dest });
  } finally {
    if (activeDownloadTask === task) activeDownloadTask = null;
  }
}

/**
 * 从 HF 镜像下载 SenseVoice 到应用文档目录（不打进 APK）。
 */
export async function downloadSherpaAsrModel(options?: {
  onProgress?: (progress: SherpaAsrDownloadProgress) => void;
}): Promise<void> {
  if (downloadPromise) return downloadPromise;

  downloadPromise = (async () => {
    abortRequested = false;
    logSpeechInput('sherpa.local.download.start', { modelId: SHERPA_OFFLINE_ASR_MODEL_ID });
    options?.onProgress?.({ phase: 'preparing', percent: 0 });

    if (await isSherpaAsrLocalModelReady()) {
      options?.onProgress?.({ phase: 'done', percent: 100 });
      return;
    }

    await FileSystem.makeDirectoryAsync(modelRootDir(), { intermediates: true });

    // tokens 很小，模型约占绝大部分进度
    const files = SHERPA_ASR_MODEL_FILES;
    const weights = files.map((name) => (name.endsWith('.onnx') ? 0.97 : 0.03));
    let cursor = 1;
    for (let i = 0; i < files.length; i += 1) {
      if (abortRequested) throw new Error('download-cancelled');
      const weight = weights[i] ?? 0;
      const start = cursor;
      const end = cursor + weight * 98;
      await downloadOneFile(files[i]!, start, end, options?.onProgress);
      cursor = end;
    }

    options?.onProgress?.({ phase: 'verifying', percent: 99 });
    if (!(await isSherpaAsrLocalModelReady())) {
      throw new Error('download-verify-failed');
    }

    options?.onProgress?.({ phase: 'done', percent: 100 });
    logSpeechInput('sherpa.local.download.done', {
      modelId: SHERPA_OFFLINE_ASR_MODEL_ID,
      hintMb: Math.round(SHERPA_ASR_MODEL_SIZE_HINT_BYTES / (1024 * 1024))
    });
  })();

  try {
    await downloadPromise;
  } finally {
    downloadPromise = null;
    abortRequested = false;
  }
}

export async function deleteSherpaAsrLocalModel(): Promise<void> {
  try {
    await FileSystem.deleteAsync(modelRootDir(), { idempotent: true });
  } catch (error) {
    logSpeechInput('sherpa.local.delete.error', {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

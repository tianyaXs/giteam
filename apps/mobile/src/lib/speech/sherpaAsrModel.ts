import { assetModelPath, fileModelPath, listAssetModels } from 'react-native-sherpa-onnx';
import type { ModelPathConfig } from 'react-native-sherpa-onnx';
import {
  SHERPA_OFFLINE_ASR_MODEL_ASSET_PATH,
  SHERPA_OFFLINE_ASR_MODEL_ID
} from './sherpaAsrConfig';
import {
  getSherpaAsrLocalModelDir,
  isSherpaAsrLocalModelReady
} from './sherpaAsrLocalStore';
import { logSpeechInput } from './speechInputDebug';

export type SherpaModelEnsureProgress = {
  phase: string;
  percent: number;
};

async function isBundledSherpaAsrModelAvailable(): Promise<boolean> {
  try {
    const models = await listAssetModels();
    return models.some((entry) => entry.folder === SHERPA_OFFLINE_ASR_MODEL_ID);
  } catch (error) {
    logSpeechInput('sherpa.model.bundle.check.error', {
      message: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * 解析已就绪的本地 ASR 模型路径。
 * 不在此自动下载：需先在设置中开启并完成下载。
 */
export async function resolveSherpaAsrModelPath(_options?: {
  onProgress?: (progress: SherpaModelEnsureProgress) => void;
}): Promise<ModelPathConfig> {
  if (await isSherpaAsrLocalModelReady()) {
    const localPath = getSherpaAsrLocalModelDir();
    logSpeechInput('sherpa.model.local', { localPath });
    return fileModelPath(localPath);
  }

  const bundled = await isBundledSherpaAsrModelAvailable();
  if (bundled) {
    logSpeechInput('sherpa.model.bundle', { assetPath: SHERPA_OFFLINE_ASR_MODEL_ASSET_PATH });
    return assetModelPath(SHERPA_OFFLINE_ASR_MODEL_ASSET_PATH);
  }

  throw new Error('sherpa-asr-model-not-ready');
}

export async function isSherpaAsrModelAvailable(): Promise<boolean> {
  if (await isSherpaAsrLocalModelReady()) return true;
  return isBundledSherpaAsrModelAvailable();
}

import type { ModelPathConfig } from 'react-native-sherpa-onnx';
import {
  createSTT,
  detectSttModel,
  type SttEngine
} from 'react-native-sherpa-onnx/stt';
import { logSpeechInput } from './speechInputDebug';

/** 去掉 SenseVoice 特殊标签（如 <|zh|> / <|nospeech|>）。 */
export function stripSenseVoiceTags(text: string): string {
  if (!text) return '';
  return text.replace(/<\|[^|>]*\|>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 仅过滤明确静音标签或整句就是单个语气词的结果。 */
export function isLikelyNonSpeechUtterance(raw: string): boolean {
  const source = raw || '';
  if (/<\|nospeech\|>/i.test(source)) return true;
  const text = stripSenseVoiceTags(source);
  if (!text) return true;
  // 整句就是「嗯/啊」这类才丢；含真实内容的句子一律放行
  const fillers = new Set(['嗯', '啊', '呃', '唔', '哦', '噢', '额', '欸', '诶', '呵', '哼', '嗯嗯']);
  return fillers.has(text);
}

export async function createSherpaOfflineEngine(options: {
  modelPath: ModelPathConfig;
  numThreads?: number;
}): Promise<SttEngine> {
  const detection = await detectSttModel(options.modelPath, {
    preferInt8: true,
    modelType: 'auto'
  });
  logSpeechInput('sherpa.model.detect', {
    success: detection.success,
    modelType: detection.modelType,
    error: 'error' in detection ? detection.error : undefined
  });
  if (!detection.success) {
    throw new Error(detection.error ?? 'sherpa-model-detect-failed');
  }

  return createSTT({
    modelPath: options.modelPath,
    preferInt8: true,
    modelType: 'auto',
    numThreads: options.numThreads ?? 2,
    modelOptions: {
      senseVoice: {
        language: 'auto',
        useItn: true
      }
    }
  });
}

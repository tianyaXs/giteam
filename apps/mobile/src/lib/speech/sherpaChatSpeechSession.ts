import { createPcmLiveStream, type PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';
import type { SttEngine } from 'react-native-sherpa-onnx/stt';
import { normalizeAsrTranscript } from '../speechTranscript';
import { SHERPA_ASR_SAMPLE_RATE } from './sherpaAsrConfig';
import { createSherpaOfflineEngine, isLikelyNonSpeechUtterance, stripSenseVoiceTags } from './sherpaAsrEngine';
import { resolveSherpaAsrModelPath } from './sherpaAsrModel';
import { acquireSherpaAsrEngine, releaseSherpaAsrEngine } from './sherpaAsrRuntime';
import { logSpeechInput } from './speechInputDebug';
import {
  activateSpeechAudioSession,
  deactivateSpeechAudioSession,
  ensureSpeechMicPermission
} from './speechMicPermission';

export type SherpaChatSpeechSessionOptions = {
  prefix?: string;
  /** 离线模式仅在松手识别后回调最终文本；按住期间可忽略。 */
  onChange: (text: string) => void;
  onVolume?: (volume: number) => void;
  onError: (code: string) => void;
  onModelProgress?: (progress: { phase: string; percent: number }) => void;
};

export type SherpaChatSpeechSession = {
  stop: (options?: { applyFinalResult?: boolean }) => Promise<string>;
};

function computePcmVolume(samples: Float32Array | number[]): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sumSquares += value * value;
  }
  return Math.min(1, Math.max(0, Math.sqrt(sumSquares / samples.length) * 8));
}

/** 整段 RMS；过低视为未开口。 */
function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / samples.length);
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * 按住说话会话：录 PCM → 松手后用离线 SenseVoice 整段识别。
 */
export async function startSherpaChatSpeechSession(
  options: SherpaChatSpeechSessionOptions
): Promise<SherpaChatSpeechSession> {
  await activateSpeechAudioSession();

  let engine: SttEngine | null = null;
  let ownsEngine = false;
  let pcm: PcmLiveStreamHandle | null = null;
  let unsubData: (() => void) | null = null;
  let unsubError: (() => void) | null = null;
  let stopped = false;
  let resourcesReleased = false;
  const pcmChunks: Float32Array[] = [];
  let sampleRate = SHERPA_ASR_SAMPLE_RATE;

  const releaseResources = async () => {
    if (resourcesReleased) return;
    resourcesReleased = true;
    try {
      await pcm?.stop();
    } catch (error) {
      logSpeechInput('sherpa.pcm.stop.error', {
        message: error instanceof Error ? error.message : String(error)
      });
    }
    unsubData?.();
    unsubError?.();
    if (engine) {
      if (ownsEngine) {
        try {
          await engine.destroy();
        } catch {
          // ignore
        }
      } else {
        releaseSherpaAsrEngine();
      }
      engine = null;
    }
    await deactivateSpeechAudioSession();
  };

  try {
    const permission = await ensureSpeechMicPermission();
    if (permission !== 'granted') {
      options.onError(permission === 'settings' ? 'settings' : 'permission');
      throw new Error('microphone-permission-denied');
    }

    engine = await acquireSherpaAsrEngine({
      onProgress: options.onModelProgress
    });
    if (!engine) {
      const modelPath = await resolveSherpaAsrModelPath({
        onProgress: options.onModelProgress
      });
      engine = await createSherpaOfflineEngine({ modelPath });
      ownsEngine = true;
    }

    pcm = createPcmLiveStream({
      sampleRate: SHERPA_ASR_SAMPLE_RATE,
      channelCount: 1
    });

    unsubError = pcm.onError((message) => {
      logSpeechInput('sherpa.pcm.error', { message });
      options.onError('microphone');
    });

    unsubData = pcm.onData((samples, rate) => {
      if (stopped) return;
      sampleRate = rate || SHERPA_ASR_SAMPLE_RATE;
      options.onVolume?.(computePcmVolume(samples));
      const copy =
        samples instanceof Float32Array
          ? samples.slice()
          : Float32Array.from(samples as ArrayLike<number>);
      if (copy.length > 0) pcmChunks.push(copy);
    });

    await pcm.start();
    logSpeechInput('sherpa.pcm.started', { mode: 'offline-sense-voice' });

    return {
      stop: async (stopOptions) => {
        if (stopped) {
          return '';
        }
        stopped = true;
        const applyFinalResult = stopOptions?.applyFinalResult !== false;
        const prefix = (options.prefix || '').trim();
        try {
          await pcm?.stop();
        } catch {
          // ignore
        }
        unsubData?.();
        unsubError?.();

        if (!applyFinalResult || !engine) {
          await releaseResources();
          return '';
        }

        const merged = concatFloat32(pcmChunks);
        pcmChunks.length = 0;
        // 仅拦明显空手势（极短且近乎无能量）；不要用偏高 RMS 门限误杀正常说话。
        const minSamples = Math.floor(sampleRate * 0.2);
        const rms = computeRms(merged);
        if (merged.length < minSamples && rms < 0.001) {
          logSpeechInput('sherpa.offline.too-quiet-or-short', {
            samples: merged.length,
            seconds: Number((merged.length / sampleRate).toFixed(2)),
            rms: Number(rms.toFixed(5))
          });
          await releaseResources();
          return '';
        }

        try {
          logSpeechInput('sherpa.offline.transcribe.start', {
            samples: merged.length,
            seconds: Number((merged.length / sampleRate).toFixed(2)),
            rms: Number(rms.toFixed(5))
          });
          // Bridge 侧要 number[]；大段录音用 Array.from
          const result = await engine.transcribeSamples(Array.from(merged), sampleRate);
          const rawText = result.text || '';
          const text = normalizeAsrTranscript(stripSenseVoiceTags(rawText)).trim();
          // 只丢掉模型明确标 nospeech / 纯语气词的结果，避免误杀正常句子
          if (!text || isLikelyNonSpeechUtterance(rawText) || isLikelyNonSpeechUtterance(text)) {
            logSpeechInput('sherpa.offline.non-speech', {
              raw: rawText,
              text,
              event: result.event,
              lang: result.lang
            });
            await releaseResources();
            return '';
          }
          logSpeechInput('sherpa.offline.transcribe.done', {
            chars: text.length,
            lang: result.lang
          });
          const full = prefix ? `${prefix}${text}` : text;
          if (full) options.onChange(full);
          await releaseResources();
          return full;
        } catch (error) {
          logSpeechInput('sherpa.offline.transcribe.error', {
            message: error instanceof Error ? error.message : String(error)
          });
          await releaseResources();
          options.onError('offline-failed');
          return '';
        }
      }
    };
  } catch (error) {
    stopped = true;
    await releaseResources();
    throw error;
  }
}

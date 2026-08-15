import type { ModelPathConfig } from 'react-native-sherpa-onnx';
import type { SttEngine } from 'react-native-sherpa-onnx/stt';
import { createSherpaOfflineEngine } from './sherpaAsrEngine';
import { resolveSherpaAsrModelPath } from './sherpaAsrModel';
import { logSpeechInput } from './speechInputDebug';
import { resolveSpeechInputMode } from './speechInputStrategy';

type SherpaAsrRuntime = {
  engine: SttEngine;
  modelPath: ModelPathConfig;
  activeSessions: number;
};

let runtime: SherpaAsrRuntime | null = null;
let warmPromise: Promise<SherpaAsrRuntime | null> | null = null;

export type SherpaAsrWarmProgress = { phase: string; percent: number };

function shouldUseOfflineSherpa(): boolean {
  return resolveSpeechInputMode() === 'offline';
}

export async function warmSherpaAsrRuntime(options?: {
  onProgress?: (progress: SherpaAsrWarmProgress) => void;
}): Promise<boolean> {
  if (!shouldUseOfflineSherpa()) return false;
  return (await ensureSherpaAsrRuntime(options?.onProgress)) != null;
}

export function isSherpaAsrRuntimeReady(): boolean {
  return runtime != null;
}

export async function acquireSherpaAsrEngine(options?: {
  onProgress?: (progress: SherpaAsrWarmProgress) => void;
}): Promise<SttEngine | null> {
  const ready = await ensureSherpaAsrRuntime(options?.onProgress);
  if (!ready) return null;
  ready.activeSessions += 1;
  return ready.engine;
}

export function releaseSherpaAsrEngine(): void {
  if (!runtime) return;
  runtime.activeSessions = Math.max(0, runtime.activeSessions - 1);
}

async function ensureSherpaAsrRuntime(
  onProgress?: (progress: SherpaAsrWarmProgress) => void
): Promise<SherpaAsrRuntime | null> {
  if (runtime) return runtime;
  if (!warmPromise) {
    warmPromise = (async () => {
      try {
        logSpeechInput('sherpa.runtime.warm.start');
        const modelPath = await resolveSherpaAsrModelPath({ onProgress });
        const engine = await createSherpaOfflineEngine({ modelPath });
        runtime = { engine, modelPath, activeSessions: 0 };
        logSpeechInput('sherpa.runtime.warm.ready');
        return runtime;
      } catch (error) {
        logSpeechInput('sherpa.runtime.warm.error', {
          message: error instanceof Error ? error.message : String(error)
        });
        return null;
      } finally {
        warmPromise = null;
      }
    })();
  }
  return warmPromise;
}

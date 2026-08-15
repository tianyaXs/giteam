import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionOptions
} from 'expo-speech-recognition';
import {
  applySpeechResult,
  composeSpeechTranscript,
  createSpeechTranscriptState,
  extractTranscriptFromResults,
  mapSpeechErrorCode,
  type SpeechTranscriptState
} from '../../lib/speechTranscript';
import { resolveSpeechInputMode } from '../../lib/speech/speechInputStrategy';
import {
  ensureSpeechMicPermission,
  openSpeechSettings
} from '../../lib/speech/speechMicPermission';
import {
  startSherpaChatSpeechSession,
  type SherpaChatSpeechSession
} from '../../lib/speech/sherpaChatSpeechSession';
import { warmSherpaAsrRuntime } from '../../lib/speech/sherpaAsrRuntime';
import { logSpeechInput } from '../../lib/speech/speechInputDebug';

export type ComposerSpeechPhase = 'idle' | 'starting' | 'listening';

type UseComposerSpeechInputOptions = {
  enabled?: boolean;
  onError?: (code: string) => void;
  /** 实时听写预览（不写回输入框，由 PTT UI 展示）。 */
  onInterim?: (text: string) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supportsContinuousRecognition(): boolean {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS === 'android' && typeof Platform.Version === 'number') {
    return Platform.Version >= 33;
  }
  return false;
}

/**
 * ChatGPT 式按住说话：
 * - Android → 端侧 Sherpa
 * - 其它 → 系统 STT（expo-speech-recognition）
 */
export function useComposerSpeechInput(options: UseComposerSpeechInputOptions = {}) {
  const { enabled = true, onError, onInterim } = options;
  const mode = resolveSpeechInputMode();
  const [phase, setPhase] = useState<ComposerSpeechPhase>('idle');
  const [volume, setVolume] = useState(0);
  const phaseRef = useRef<ComposerSpeechPhase>('idle');
  const transcriptRef = useRef<SpeechTranscriptState>(createSpeechTranscriptState(''));
  const stopResolverRef = useRef<((text: string) => void) | null>(null);
  const discardRef = useRef(false);
  const sherpaSessionRef = useRef<SherpaChatSpeechSession | null>(null);
  const onErrorRef = useRef(onError);
  const onInterimRef = useRef(onInterim);
  onErrorRef.current = onError;
  onInterimRef.current = onInterim;

  const setPhaseSafe = useCallback((next: ComposerSpeechPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const emitInterim = useCallback((text?: string) => {
    if (discardRef.current) return;
    const next =
      text !== undefined
        ? text.trim()
        : composeSpeechTranscript(transcriptRef.current).trim();
    onInterimRef.current?.(next);
  }, []);

  const resolveStop = useCallback((text: string) => {
    const resolver = stopResolverRef.current;
    stopResolverRef.current = null;
    resolver?.(text);
  }, []);

  const resetIdle = useCallback(() => {
    setPhaseSafe('idle');
    setVolume(0);
  }, [setPhaseSafe]);

  // —— Native STT events（仅 non-Android / mode=native）——
  useSpeechRecognitionEvent('start', () => {
    if (mode !== 'native') return;
    if (phaseRef.current === 'starting' || phaseRef.current === 'listening') {
      setPhaseSafe('listening');
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (mode !== 'native' || discardRef.current) return;
    const transcript = extractTranscriptFromResults(event.results as any);
    if (!transcript) return;
    transcriptRef.current = applySpeechResult(transcriptRef.current, transcript, event.isFinal);
    emitInterim();
  });

  useSpeechRecognitionEvent('end', () => {
    if (mode !== 'native') return;
    const text = discardRef.current ? '' : composeSpeechTranscript(transcriptRef.current).trim();
    resetIdle();
    resolveStop(text);
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (mode !== 'native') return;
    if (event.error === 'aborted' || event.error === 'no-speech') {
      const text = discardRef.current ? '' : composeSpeechTranscript(transcriptRef.current).trim();
      resetIdle();
      resolveStop(text);
      return;
    }
    resetIdle();
    resolveStop('');
    onErrorRef.current?.(mapSpeechErrorCode(event.error));
  });

  useSpeechRecognitionEvent('volumechange', (event) => {
    if (mode !== 'native') return;
    const value = Number(event.value);
    if (!Number.isFinite(value)) {
      setVolume(0);
      return;
    }
    setVolume(Math.min(1, Math.max(0, (value + 2) / 12)));
  });

  useEffect(() => {
    if (enabled) return;
    discardRef.current = true;
    if (mode === 'offline' && sherpaSessionRef.current) {
      void sherpaSessionRef.current.stop({ applyFinalResult: false }).finally(() => {
        sherpaSessionRef.current = null;
        resetIdle();
        resolveStop('');
      });
      return;
    }
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // ignore
    }
    resetIdle();
    resolveStop('');
  }, [enabled, mode, resetIdle, resolveStop]);

  // Android：启动时预热 Sherpa，缩短首次按住等待
  useEffect(() => {
    if (!enabled || mode !== 'offline') return;
    void warmSherpaAsrRuntime().then((ready) => {
      logSpeechInput('sherpa.prewarm', { ready });
    });
  }, [enabled, mode]);

  const startNative = useCallback(async (): Promise<boolean> => {
    try {
      const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        resetIdle();
        onErrorRef.current?.('unavailable');
        return false;
      }
      try {
        const state = await ExpoSpeechRecognitionModule.getStateAsync();
        if (state !== 'inactive') {
          ExpoSpeechRecognitionModule.abort();
          await sleep(200);
        }
      } catch {
        // ignore
      }
      const startOptions: ExpoSpeechRecognitionOptions = {
        lang: 'zh-CN',
        interimResults: true,
        continuous: supportsContinuousRecognition(),
        maxAlternatives: 1,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 80 }
      };
      ExpoSpeechRecognitionModule.start(startOptions);
      setTimeout(() => {
        if (phaseRef.current === 'starting') setPhaseSafe('listening');
      }, 400);
      return true;
    } catch {
      resetIdle();
      onErrorRef.current?.('failed');
      return false;
    }
  }, [resetIdle, setPhaseSafe]);

  const startOffline = useCallback(async (): Promise<boolean> => {
    try {
      const session = await startSherpaChatSpeechSession({
        prefix: '',
        onChange: (text) => {
          if (discardRef.current) return;
          transcriptRef.current = createSpeechTranscriptState(text);
          emitInterim(text);
        },
        onVolume: setVolume,
        onError: (code) => {
          onErrorRef.current?.(code);
        }
      });
      sherpaSessionRef.current = session;
      setPhaseSafe('listening');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logSpeechInput('sherpa.start.error', { message });
      resetIdle();
      if (message === 'microphone-permission-denied') {
        return false;
      }
      onErrorRef.current?.('offline-failed');
      return false;
    }
  }, [emitInterim, resetIdle, setPhaseSafe]);

  const startListening = useCallback(async (): Promise<boolean> => {
    if (!enabled || Platform.OS === 'web') {
      onErrorRef.current?.('unavailable');
      return false;
    }
    if (phaseRef.current !== 'idle') return false;

    discardRef.current = false;
    transcriptRef.current = createSpeechTranscriptState('');
    onInterimRef.current?.('');
    setPhaseSafe('starting');

    const permission = await ensureSpeechMicPermission();
    if (permission !== 'granted') {
      resetIdle();
      onErrorRef.current?.(permission === 'settings' ? 'settings' : permission);
      if (permission === 'settings') openSpeechSettings();
      return false;
    }

    if (mode === 'offline') {
      return startOffline();
    }
    return startNative();
  }, [enabled, mode, resetIdle, setPhaseSafe, startNative, startOffline]);

  const stopListening = useCallback(async (opts?: { discard?: boolean }): Promise<string> => {
    discardRef.current = Boolean(opts?.discard);

    if (mode === 'offline') {
      const session = sherpaSessionRef.current;
      sherpaSessionRef.current = null;
      if (!session) {
        resetIdle();
        return '';
      }
      try {
        const text = await session.stop({ applyFinalResult: !opts?.discard });
        resetIdle();
        return opts?.discard ? '' : text;
      } catch {
        resetIdle();
        return '';
      }
    }

    if (phaseRef.current === 'idle' && !stopResolverRef.current) {
      return '';
    }
    return await new Promise<string>((resolve) => {
      stopResolverRef.current = resolve;
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        const text = discardRef.current
          ? ''
          : composeSpeechTranscript(transcriptRef.current).trim();
        resetIdle();
        stopResolverRef.current = null;
        resolve(text);
      }
      setTimeout(() => {
        if (!stopResolverRef.current) return;
        const text = discardRef.current
          ? ''
          : composeSpeechTranscript(transcriptRef.current).trim();
        resetIdle();
        resolveStop(text);
      }, 2500);
    });
  }, [mode, resetIdle, resolveStop]);

  const abortListening = useCallback(async () => {
    await stopListening({ discard: true });
  }, [stopListening]);

  return {
    phase,
    volume,
    mode,
    isActive: phase !== 'idle',
    startListening,
    stopListening,
    abortListening
  };
}

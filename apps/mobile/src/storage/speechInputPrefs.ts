import { mmkvGetString, mmkvSetString } from './mmkv';

export const SPEECH_INPUT_PREF_KEY = 'giteam.mobile.speech-input.v1';

export type SpeechInputPrefs = {
  /** 用户在设置中开启语音输入 */
  enabled: boolean;
};

export const DEFAULT_SPEECH_INPUT_PREFS: SpeechInputPrefs = {
  enabled: false
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export function subscribeSpeechInputPrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadSpeechInputPrefs(): SpeechInputPrefs {
  try {
    const raw = mmkvGetString(SPEECH_INPUT_PREF_KEY);
    if (!raw) return { ...DEFAULT_SPEECH_INPUT_PREFS };
    const parsed = JSON.parse(raw) as Partial<SpeechInputPrefs>;
    return {
      enabled: Boolean(parsed.enabled)
    };
  } catch {
    return { ...DEFAULT_SPEECH_INPUT_PREFS };
  }
}

export function saveSpeechInputPrefs(next: SpeechInputPrefs): void {
  try {
    mmkvSetString(SPEECH_INPUT_PREF_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  notify();
}

export function setSpeechInputEnabled(enabled: boolean): void {
  saveSpeechInputPrefs({ enabled: Boolean(enabled) });
}

/** 模型下载完成等非 prefs 变更时，通知 Composer 刷新语音入口。 */
export function notifySpeechInputChanged(): void {
  notify();
}

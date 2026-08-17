import { mmkvGetString, mmkvSetString } from './mmkv';

export const FOCUS_MODE_PREF_KEY = 'giteam.mobile.focus-mode.v1';

export type FocusModePrefs = {
  /** 生成中收起顶栏与输入区，扩大内容阅读区 */
  enabled: boolean;
};

export const DEFAULT_FOCUS_MODE_PREFS: FocusModePrefs = {
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

export function subscribeFocusModePrefs(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadFocusModePrefs(): FocusModePrefs {
  try {
    const raw = mmkvGetString(FOCUS_MODE_PREF_KEY);
    if (!raw) return { ...DEFAULT_FOCUS_MODE_PREFS };
    const parsed = JSON.parse(raw) as Partial<FocusModePrefs>;
    return {
      enabled: Boolean(parsed.enabled)
    };
  } catch {
    return { ...DEFAULT_FOCUS_MODE_PREFS };
  }
}

export function saveFocusModePrefs(next: FocusModePrefs): void {
  try {
    mmkvSetString(FOCUS_MODE_PREF_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  notify();
}

export function setFocusModeEnabled(enabled: boolean): void {
  saveFocusModePrefs({ enabled: Boolean(enabled) });
}

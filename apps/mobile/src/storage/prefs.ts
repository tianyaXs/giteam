import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { toText } from '../lib/text';

export const PREF_KEY = 'giteam.mobile.v3';

export type Prefs = {
  serverUrl: string;
  serverUrlTouched: boolean;
  preferHttps: boolean;
  pairCode: string;
  repoPath: string;
  repoPaths: string[];
  token: string;
  sessionId: string;
  model: string;
};

export const DEFAULT_PREFS: Prefs = {
  serverUrl: '',
  serverUrlTouched: false,
  preferHttps: false,
  pairCode: '',
  repoPath: '',
  repoPaths: [],
  token: '',
  sessionId: '',
  model: ''
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const loadRaw = async (): Promise<string | null> => {
      if (Platform.OS === 'web') return window.localStorage.getItem(PREF_KEY);
      return await AsyncStorage.getItem(PREF_KEY);
    };
    const raw = await loadRaw();
    if (!raw) return DEFAULT_PREFS;
    const merged = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
    const touched = Boolean((merged as any).serverUrlTouched);
    return {
      serverUrl: touched ? toText(merged.serverUrl) : '',
      serverUrlTouched: touched,
      preferHttps: Boolean((merged as any).preferHttps),
      pairCode: toText(merged.pairCode),
      repoPath: toText(merged.repoPath),
      repoPaths: Array.isArray((merged as any).repoPaths) ? (merged as any).repoPaths.map((x: any) => toText(x)).filter(Boolean) : [],
      token: toText(merged.token),
      sessionId: toText(merged.sessionId),
      model: toText(merged.model)
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(next: Prefs): Promise<void> {
  try {
    const raw = JSON.stringify(next);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(PREF_KEY, raw);
      return;
    }
    await AsyncStorage.setItem(PREF_KEY, raw);
  } catch {
    // ignore
  }
}


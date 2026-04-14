import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export const PAIR_CODE_MAP_KEY = 'giteam.mobile.pair-code-map.v1';

export async function loadPairCodeMap(): Promise<Record<string, string>> {
  try {
    const readRaw = async (): Promise<string | null> => {
      if (Platform.OS === 'web') return window.localStorage.getItem(PAIR_CODE_MAP_KEY);
      return await AsyncStorage.getItem(PAIR_CODE_MAP_KEY);
    };
    const raw = await readRaw();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export async function savePairCodeMap(next: Record<string, string>): Promise<void> {
  try {
    const raw = JSON.stringify(next);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(PAIR_CODE_MAP_KEY, raw);
      return;
    }
    await AsyncStorage.setItem(PAIR_CODE_MAP_KEY, raw);
  } catch {
    // ignore
  }
}


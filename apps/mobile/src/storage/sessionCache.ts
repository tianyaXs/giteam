import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type SessionCacheItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

export const SESSION_CACHE_KEY = 'giteam.mobile.session-cache.v1';

export async function loadSessionCache(): Promise<Record<string, SessionCacheItem[]>> {
  try {
    const raw = Platform.OS === 'web'
      ? window.localStorage.getItem(SESSION_CACHE_KEY)
      : await AsyncStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || !parsed) return {};
    const result: Record<string, SessionCacheItem[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        result[key] = value.map((s: any) => ({
          id: String(s?.id || '').trim(),
          title: String(s?.title || '').trim(),
          preview: String(s?.preview || '').trim(),
          updatedAt: Number(s?.updatedAt || 0) || 0,
          createdAt: Number(s?.createdAt || 0) || undefined
        })).filter((s) => s.id);
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function saveSessionCache(cache: Record<string, SessionCacheItem[]>): Promise<void> {
  try {
    const payload = JSON.stringify(cache);
    if (Platform.OS === 'web') {
      window.localStorage.setItem(SESSION_CACHE_KEY, payload);
      return;
    }
    await AsyncStorage.setItem(SESSION_CACHE_KEY, payload);
  } catch {
    // ignore
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { toText } from '../lib/text';

export const DISCOVER_CACHE_KEY = 'giteam.mobile.discover-cache.v1';

export type DiscoverCacheDevice = {
  id: string;
  baseUrl: string;
  host: string;
  port: number;
  noAuth: boolean;
  x: number;
  y: number;
  lastSeen: number;
  offline: boolean;
};

export async function loadDiscoverCache(): Promise<DiscoverCacheDevice[]> {
  try {
    const parse = (raw: string | null): DiscoverCacheDevice[] => {
      if (!raw) return [];
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) return [];
      return rows
        .map((r: any) => ({
          id: toText(r?.id),
          baseUrl: toText(r?.baseUrl),
          host: toText(r?.host),
          port: Number(r?.port || 0) || 4100,
          noAuth: Boolean(r?.noAuth),
          x: Number(r?.x || 0),
          y: Number(r?.y || 0),
          lastSeen: Number(r?.lastSeen || 0) || Date.now(),
          offline: Boolean(r?.offline)
        }))
        .filter((r) => r.id && r.host);
    };
    if (Platform.OS === 'web') return parse(window.localStorage.getItem(DISCOVER_CACHE_KEY));
    return parse(await AsyncStorage.getItem(DISCOVER_CACHE_KEY));
  } catch {
    return [];
  }
}

export async function saveDiscoverCache(rows: DiscoverCacheDevice[]): Promise<void> {
  try {
    const payload = JSON.stringify(rows.slice(0, 120));
    if (Platform.OS === 'web') {
      window.localStorage.setItem(DISCOVER_CACHE_KEY, payload);
      return;
    }
    await AsyncStorage.setItem(DISCOVER_CACHE_KEY, payload);
  } catch {
    // ignore
  }
}


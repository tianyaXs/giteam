import { mmkvGetString, mmkvSetString } from './mmkv';
import { toText } from '../lib/text';

export type SessionCacheItem = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  createdAt?: number;
};

export const SESSION_CACHE_KEY = 'giteam.mobile.session-cache.v1';

export function loadSessionCache(): Record<string, SessionCacheItem[]> {
  try {
    const raw = mmkvGetString(SESSION_CACHE_KEY);
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

export function saveSessionCache(cache: Record<string, SessionCacheItem[]>): void {
  try {
    const payload = JSON.stringify(cache);
    mmkvSetString(SESSION_CACHE_KEY, payload);
  } catch {
    // ignore
  }
}

import { mmkvGetString, mmkvSetString } from './mmkv';
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

export function loadDiscoverCache(): DiscoverCacheDevice[] {
  try {
    const raw = mmkvGetString(DISCOVER_CACHE_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r: any) => ({
        id: toText(r?.id),
        baseUrl: toText(r?.baseUrl),
        host: toText(r?.host),
        port: Number(r?.port || 0) || 5100,
        noAuth: Boolean(r?.noAuth),
        x: Number(r?.x || 0),
        y: Number(r?.y || 0),
        lastSeen: Number(r?.lastSeen || 0) || Date.now(),
        offline: Boolean(r?.offline)
      }))
      .filter((r) => r.id && r.host);
  } catch {
    return [];
  }
}

export function saveDiscoverCache(rows: DiscoverCacheDevice[]): void {
  try {
    const payload = JSON.stringify(rows.slice(0, 120));
    mmkvSetString(DISCOVER_CACHE_KEY, payload);
  } catch {
    // ignore
  }
}

import { mmkvGetString, mmkvSetString } from './mmkv';

export const PAIR_CODE_MAP_KEY = 'giteam.mobile.pair-code-map.v1';

export function loadPairCodeMap(): Record<string, string> {
  try {
    const raw = mmkvGetString(PAIR_CODE_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function savePairCodeMap(next: Record<string, string>): void {
  try {
    const raw = JSON.stringify(next);
    mmkvSetString(PAIR_CODE_MAP_KEY, raw);
  } catch {
    // ignore
  }
}

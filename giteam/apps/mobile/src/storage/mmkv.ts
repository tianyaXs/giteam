import { MMKV } from 'react-native-mmkv';
import { Platform } from 'react-native';

let _mmkv: MMKV | null = null;

export function getMMKV(): MMKV {
  if (_mmkv) return _mmkv;
  _mmkv = new MMKV({
    id: 'giteam-mobile',
  });
  return _mmkv;
}

export function mmkvGetString(key: string): string | undefined {
  if (Platform.OS === 'web') {
    const raw = window.localStorage.getItem(key);
    return raw ?? undefined;
  }
  return getMMKV().getString(key);
}

export function mmkvSetString(key: string, value: string): void {
  if (Platform.OS === 'web') {
    window.localStorage.setItem(key, value);
    return;
  }
  getMMKV().set(key, value);
}

export function mmkvDelete(key: string): void {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(key);
    return;
  }
  getMMKV().delete(key);
}

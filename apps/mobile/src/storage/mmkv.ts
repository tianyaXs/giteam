import { MMKV } from 'react-native-mmkv';

let _mmkv: MMKV | null = null;

export function getMMKV(): MMKV {
  if (_mmkv) return _mmkv;
  _mmkv = new MMKV({
    id: 'giteam-mobile',
  });
  return _mmkv;
}

export function mmkvGetString(key: string): string | undefined {
  return getMMKV().getString(key);
}

export function mmkvSetString(key: string, value: string): void {
  getMMKV().set(key, value);
}

export function mmkvDelete(key: string): void {
  getMMKV().delete(key);
}

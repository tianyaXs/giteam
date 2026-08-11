import { Appearance } from 'react-native';
import { useSyncExternalStore } from 'react';
import { MMKV } from 'react-native-mmkv';

/**
 * 主题手动覆盖（仅 light/dark，无 system）。
 *
 * 用 MMKV 同步读取 + 模块级 store + useSyncExternalStore：
 *  - 同步读取 → 首帧即拿到上次的覆盖值，无闪烁；
 *  - 模块级 store → 任意组件调 useThemeOverride() 共享同一份状态。
 */
const storage = new MMKV({ id: 'giteam-mobile-theme' });
const KEY = 'override';

export type ThemeOverride = 'light' | 'dark';

function resolveLegacy(raw: string | undefined): ThemeOverride {
  if (raw === 'light' || raw === 'dark') return raw;
  // 旧版 system / 空值：按当前系统外观落成固定档，之后不再跟随系统
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

function readInitial(): ThemeOverride {
  try {
    const v = storage.getString(KEY);
    const next = resolveLegacy(v);
    // 把 system 等旧值写回为 light/dark，避免下次再解析
    if (v !== next) {
      try {
        storage.set(KEY, next);
      } catch {
        // ignore
      }
    }
    return next;
  } catch {
    return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  }
}

let current: ThemeOverride = readInitial();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function getThemeOverride(): ThemeOverride {
  return current;
}

export function setThemeOverride(value: ThemeOverride): void {
  if (value !== 'light' && value !== 'dark') return;
  if (value === current) return;
  current = value;
  try {
    storage.set(KEY, value);
  } catch {
    // 忽略持久化失败，内存态仍生效（本次会话内一致）
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useThemeOverride(): ThemeOverride {
  return useSyncExternalStore(subscribe, getThemeOverride, getThemeOverride);
}

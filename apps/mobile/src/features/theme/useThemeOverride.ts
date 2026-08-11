import { useSyncExternalStore } from 'react';
import { MMKV } from 'react-native-mmkv';

/**
 * 主题手动覆盖（system/light/dark）。
 *
 * 用 MMKV 同步读取 + 模块级 store + useSyncExternalStore：
 *  - 同步读取 → 首帧即拿到上次的覆盖值，无「先系统后覆盖」的明暗闪烁；
 *  - 模块级 store → 任意组件调 useThemeOverride() 共享同一份状态，无需 Context
 *    Provider 包裹 App（保持 useMobileTheme 现有 hook 签名不变）。
 * ThemeProvider.useMobileTheme 据此决定跟随 useColorScheme 还是固定档。
 */
const storage = new MMKV({ id: 'giteam-mobile-theme' });
const KEY = 'override';

export type ThemeOverride = 'system' | 'light' | 'dark';

function readInitial(): ThemeOverride {
  try {
    const v = storage.getString(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
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

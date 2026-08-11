import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { THEME_TOKENS, type MobileTheme, type ThemeColors } from './themes';
import { useThemeOverride } from './useThemeOverride';

/**
 * 主题解析：优先用户手动覆盖（useThemeOverride，MMKV 持久化，首帧即正确），
 * system 档跟随 useColorScheme。下游统一解构 { colors }（colors.isDark 即明暗判断）。
 */
export function useMobileTheme(): {
  theme: MobileTheme;
  colors: ThemeColors;
} {
  const scheme = useColorScheme();
  const override = useThemeOverride();
  const resolved: MobileTheme =
    override === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : override;
  return useMemo(() => ({ theme: resolved, colors: THEME_TOKENS[resolved] }), [resolved]);
}

export type { MobileTheme, ThemeColors };

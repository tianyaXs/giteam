import { useMemo } from 'react';
import { THEME_TOKENS, type MobileTheme, type ThemeColors } from './themes';
import { useThemeOverride } from './useThemeOverride';

/**
 * 主题解析：仅 light/dark（无 system）。下游统一解构 { colors }（colors.isDark 即明暗判断）。
 */
export function useMobileTheme(): {
  theme: MobileTheme;
  colors: ThemeColors;
} {
  const override = useThemeOverride();
  return useMemo(() => ({ theme: override, colors: THEME_TOKENS[override] }), [override]);
}

export type { MobileTheme, ThemeColors };

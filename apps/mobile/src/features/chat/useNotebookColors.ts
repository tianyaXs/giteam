import { useMemo } from 'react';
import { useMobileTheme } from '../theme/ThemeProvider';

export type NotebookColors = {
  shell: string;
  main: string;
  left: string;
  right: string;
  paper: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  chip: string;
  chipText: string;
  active: string;
  ink: string;
  topControl: string;
  topControlBorder: string;
};

/** 全局外壳配色：跟随当前主题（曜石黑打底 + 提亮色锁视线）。 */
export function useNotebookColors(): NotebookColors {
  const { colors } = useMobileTheme();
  return useMemo(
    () => ({
      shell: colors.background,
      main: colors.background,
      left: colors.primarySurface,
      right: colors.primarySurface,
      paper: colors.card,
      text: colors.text,
      muted: colors.muted,
      faint: colors.muted,
      line: colors.border,
      chip: colors.card,
      chipText: colors.muted,
      active: colors.primarySoft,
      ink: colors.primary,
      topControl: `${colors.card}E6`,
      topControlBorder: colors.border
    }),
    [colors]
  );
}

export type ThemeColors = {
  isDark: boolean;
  background: string;
  sidebar: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  /** 提亮色 14% 透明度，用于选中态背景 */
  primarySoft: string;
  /** 提亮色融入底色的大面积铺面（抽屉/面板底） */
  primarySurface: string;
  /** 提亮色更强的铺面（品牌区、强调带） */
  primarySurfaceStrong: string;
  warning: string;
  warningText: string;
  danger: string;
  dangerText: string;
};

/** 取消多主题后，明暗是唯一剩下的「主题」维度，跟随系统。 */
export type MobileTheme = 'light' | 'dark';

export const THEME_LABELS: Record<MobileTheme, string> = {
  light: '浅色',
  dark: '深色'
};

export const THEME_ORDER: MobileTheme[] = ['light', 'dark'];

function withSoft(primary: string): string {
  return `${primary}24`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 把提亮色按 alpha 混到底色上，得到带色调的大面积铺面色。 */
function mix(base: string, overlay: string, alpha: number): string {
  const [br, bg, bb] = hexToRgb(base);
  const [or, og, ob] = hexToRgb(overlay);
  const r = Math.round(br * (1 - alpha) + or * alpha);
  const g = Math.round(bg * (1 - alpha) + og * alpha);
  const b = Math.round(bb * (1 - alpha) + ob * alpha);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

type ThemeBase = Omit<ThemeColors, 'primarySoft' | 'primarySurface' | 'primarySurfaceStrong'>;

/**
 * ChatGPT 风格中性色板（明暗双模）。主体黑白灰，primary=#10A37F 克制绿仅做
 * CTA/在线点/选中态点缀。与抽屉自持色板（AppDrawerPanels）数值协调。
 * RN 原生端不靠 CSS 变量，颜色全部由这里直出。
 */
const THEME_BASE: Record<MobileTheme, ThemeBase> = {
  light: {
    isDark: false,
    background: '#FFFFFF',
    sidebar: '#F7F7F8',
    card: '#FFFFFF',
    border: '#E5E5EA',
    text: '#1A1A1F',
    muted: '#6E6E7A',
    primary: '#10A37F',
    primaryText: '#FFFFFF',
    warning: '#E08A3C',
    warningText: '#1A1A1F',
    danger: '#E3484F',
    dangerText: '#FFFFFF'
  },
  dark: {
    isDark: true,
    background: '#1B1B1D',
    sidebar: '#212121',
    card: '#2A2A2E',
    border: '#3A3A3F',
    text: '#ECECEE',
    muted: '#9B9BA5',
    primary: '#10A37F',
    primaryText: '#FFFFFF',
    warning: '#E0A03C',
    warningText: '#1B1B1D',
    danger: '#E3484F',
    dangerText: '#FFFFFF'
  }
};

export const THEME_TOKENS: Record<MobileTheme, ThemeColors> = Object.fromEntries(
  Object.entries(THEME_BASE).map(([key, base]) => [
    key,
    {
      ...base,
      primarySoft: withSoft(base.primary),
      primarySurface: base.isDark
        ? mix(base.sidebar, base.primary, 0.17)
        : mix(base.sidebar, base.primary, 0.38),
      primarySurfaceStrong: base.isDark
        ? mix(base.sidebar, base.primary, 0.32)
        : mix(base.sidebar, base.primary, 0.55)
    }
  ])
) as Record<MobileTheme, ThemeColors>;

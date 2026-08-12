/** 手机端横滑可调的推理强度档位（不含 auto，避免「无感」档）。 */
export type MobileThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const MOBILE_THINKING_LEVELS: Array<{
  value: MobileThinkingLevel;
  label: string;
  shortLabel: string;
  /** 0..1 视觉强度 */
  intensity: number;
}> = [
  { value: 'off', label: '关闭推理', shortLabel: '关', intensity: 0 },
  { value: 'minimal', label: '极低', shortLabel: '极低', intensity: 0.18 },
  { value: 'low', label: '低', shortLabel: '低', intensity: 0.36 },
  { value: 'medium', label: '中', shortLabel: '中', intensity: 0.55 },
  { value: 'high', label: '高', shortLabel: '高', intensity: 0.78 },
  { value: 'xhigh', label: '极高', shortLabel: '极高', intensity: 1 }
];

export function normalizeMobileThinkingLevel(raw: unknown): MobileThinkingLevel {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (v === 'none' || v === 'auto') return 'off';
  if (v === 'max') return 'xhigh';
  if (MOBILE_THINKING_LEVELS.some((item) => item.value === v)) return v as MobileThinkingLevel;
  return 'medium';
}

export function thinkingMeta(level: MobileThinkingLevel) {
  const normalized = normalizeMobileThinkingLevel(level);
  return MOBILE_THINKING_LEVELS.find((item) => item.value === normalized) || MOBILE_THINKING_LEVELS[3];
}

export function thinkingIndex(level: MobileThinkingLevel): number {
  const idx = MOBILE_THINKING_LEVELS.findIndex((item) => item.value === level);
  return idx >= 0 ? idx : 3;
}

export function thinkingLevelAt(index: number): MobileThinkingLevel {
  const clamped = Math.max(0, Math.min(MOBILE_THINKING_LEVELS.length - 1, Math.round(index)));
  return MOBILE_THINKING_LEVELS[clamped].value;
}

/** 待机底色：浅色近白 + 科技蓝粒子；深色深蓝底。参考色约 #A5C4FF。 */
export function idlePillColors(level: MobileThinkingLevel, isDark: boolean) {
  const t = thinkingMeta(level).intensity;
  if (isDark) {
    // #252B36 → #1A3558 → #1E3A5C
    const r = Math.round(37 + (26 - 37) * Math.min(1, t * 1.1) + (30 - 26) * Math.max(0, t - 0.55) * 2);
    const g = Math.round(43 + (53 - 43) * Math.min(1, t * 1.2) + (58 - 53) * Math.max(0, t - 0.55) * 2);
    const b = Math.round(54 + (88 - 54) * Math.min(1, t) + (92 - 88) * Math.max(0, t - 0.7) / 0.3);
    return {
      bg: `rgb(${r},${g},${b})`,
      fg: t > 0.4 ? '#EAF2FF' : '#C8D0DC',
      particle: '#A5C4FF',
      label: '#E4ECFF'
    };
  }
  // 近白底，略带科技蓝气息：#F5F8FC → #EAF1FB → #E4EEFC
  const r = Math.round(245 + (234 - 245) * Math.min(1, t * 1.15) + (228 - 234) * Math.max(0, t - 0.55) * 2);
  const g = Math.round(248 + (241 - 248) * Math.min(1, t * 1.1) + (238 - 241) * Math.max(0, t - 0.55) * 2);
  const b = Math.round(252 + (251 - 252) * Math.min(1, t) + (252 - 251) * Math.max(0, t - 0.7));
  return {
    bg: `rgb(${r},${g},${b})`,
    fg: t > 0.5 ? '#1E2F4A' : '#2A3344',
    particle: '#A5C4FF',
    label: '#2A3F68'
  };
}

/** Reanimated interpolateColor 用的底色停靠点（与 mesh 同系）。 */
export const IDLE_BG_STOPS_LIGHT = ['#F5F8FC', '#F0F5FB', '#EAF1FB', '#E7F0FC', '#E4EEFC', '#E4EEFC'];
export const IDLE_BG_STOPS_DARK = ['#252B36', '#213248', '#1A3558', '#1C3858', '#1E3A5C', '#1E3A5C'];
/** 与 MOBILE_THINKING_LEVELS[].intensity 对齐；worklet 可直接读 */
export const IDLE_INTENSITY_STOPS = [0, 0.18, 0.36, 0.55, 0.78, 1];
export const THINKING_LEVEL_MAX = IDLE_INTENSITY_STOPS.length - 1;

export type ModelCatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

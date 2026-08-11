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

/** 待机底色：强度越高 灰 → 冰蓝 → 淡紫（与粒子色阶一致）。 */
export function idlePillColors(level: MobileThinkingLevel, isDark: boolean) {
  const t = thinkingMeta(level).intensity;
  if (isDark) {
    // #2F2F33 → #2A3A62 → #322A58
    const r = Math.round(47 + (42 - 47) * Math.min(1, t * 1.1) + (50 - 42) * Math.max(0, t - 0.55) * 2);
    const g = Math.round(47 + (58 - 47) * Math.min(1, t * 1.2) + (42 - 58) * Math.max(0, t - 0.55) * 2);
    const b = Math.round(51 + (98 - 51) * Math.min(1, t) + (88 - 98) * Math.max(0, t - 0.7) / 0.3);
    return {
      bg: `rgb(${r},${g},${b})`,
      fg: t > 0.4 ? '#E8F0FF' : '#C8C8D0',
      particle: t > 0.65 ? '#B8A4FF' : '#9EC0FF',
      label: '#E4ECFF'
    };
  }
  // 浅色：#E8E8ED → #DCE8FF → #E6E0FF
  const r = Math.round(232 + (220 - 232) * Math.min(1, t * 1.15) + (230 - 220) * Math.max(0, t - 0.55) * 2);
  const g = Math.round(232 + (232 - 232) * t + (224 - 232) * Math.max(0, t - 0.55) * 2);
  const b = Math.round(237 + (255 - 237) * Math.min(1, t) + (255 - 255) * Math.max(0, t - 0.7));
  return {
    bg: `rgb(${r},${g},${b})`,
    fg: t > 0.5 ? '#2A3558' : '#3A3A42',
    particle: t > 0.65 ? '#8B7CF0' : '#7BA3F0',
    label: '#3A4A78'
  };
}

/** Reanimated interpolateColor 用的底色停靠点（与 mesh 同系）。 */
export const IDLE_BG_STOPS_LIGHT = ['#E8EAF2', '#E4EAF8', '#DCE6FF', '#E0E2FF', '#E6E0FF', '#E8E0FF'];
export const IDLE_BG_STOPS_DARK = ['#2F2F33', '#2C3344', '#2A3A62', '#2E3560', '#322A58', '#322A58'];
export const IDLE_INTENSITY_STOPS = [0, 0.18, 0.36, 0.55, 0.78, 1];

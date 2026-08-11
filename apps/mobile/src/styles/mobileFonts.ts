import { Platform } from 'react-native';

/**
 * 已放弃 paper 主题的衬线/手写体，统一为系统字体栈（与桌面端系统 UI 字体策略一致）。
 * 常量名保留以兼容既有引用，值全部为系统字体。
 */
const SYSTEM = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string;
const SYSTEM_MEDIUM = Platform.select({ ios: 'System', android: 'sans-serif-medium', default: 'System' }) as string;

export const FONT_UI_REGULAR = SYSTEM;
export const FONT_UI_MEDIUM = SYSTEM_MEDIUM;
export const FONT_DISPLAY_SERIF = SYSTEM;
export const FONT_TEXT_SERIF = SYSTEM;
export const FONT_TEXT_SERIF_SEMIBOLD = SYSTEM_MEDIUM;
export const FONT_MIXED_BODY_REGULAR = SYSTEM;
export const FONT_MIXED_BODY_MEDIUM = SYSTEM_MEDIUM;
export const HANDWRITTEN_TEXT_FONT = SYSTEM;

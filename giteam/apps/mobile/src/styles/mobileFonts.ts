import { Platform } from 'react-native';

export const FONT_UI_REGULAR = 'StyreneARegular';
export const FONT_UI_MEDIUM = 'StyreneAMedium';
export const FONT_DISPLAY_SERIF = 'GalaxieCopernicusBook';
export const FONT_TEXT_SERIF = 'TiemposTextRegular';
export const FONT_TEXT_SERIF_SEMIBOLD = 'TiemposTextSemibold';
export const FONT_MIXED_BODY_REGULAR = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;
export const FONT_MIXED_BODY_MEDIUM = Platform.select({
  ios: 'System',
  android: 'sans-serif-medium',
  default: 'System',
}) as string;
export const HANDWRITTEN_TEXT_FONT = FONT_UI_REGULAR;

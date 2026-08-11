import React from 'react';
import { Animated } from 'react-native';
import { useMobileTheme } from '../../features/theme/ThemeProvider';
import { GiteamStartupAnimation } from '../GiteamStartupAnimation';

export function MobileLaunchOverlay(props: {
  styles: Record<string, any>;
  visible: boolean;
  opacity: Animated.Value;
  fontFamily: string;
  fontsReady: boolean;
}) {
  const {
    fontFamily,
    fontsReady,
    opacity,
    styles,
    visible
  } = props;
  const { colors } = useMobileTheme();

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.launchOverlay, { opacity, backgroundColor: colors.background }]}
    >
      <GiteamStartupAnimation animate fontsReady={fontsReady} fontFamily={fontFamily} />
    </Animated.View>
  );
}

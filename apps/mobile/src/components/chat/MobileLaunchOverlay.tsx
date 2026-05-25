import React from 'react';
import { Animated } from 'react-native';
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

  if (!visible) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.launchOverlay, { opacity }]}>
      <GiteamStartupAnimation animate fontsReady={fontsReady} fontFamily={fontFamily} />
    </Animated.View>
  );
}

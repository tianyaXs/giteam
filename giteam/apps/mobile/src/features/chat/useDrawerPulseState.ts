import { useCallback, useRef } from 'react';
import { Animated, Easing } from 'react-native';

function runPulse(anim: Animated.Value) {
  anim.setValue(0.72);
  Animated.timing(anim, {
    toValue: 1,
    duration: 260,
    easing: Easing.out(Easing.quad),
    useNativeDriver: true
  }).start();
}

export function useDrawerPulseState() {
  const leftDrawerPulse = useRef(new Animated.Value(1)).current;
  const rightDrawerPulse = useRef(new Animated.Value(1)).current;

  const triggerLeftPulse = useCallback(() => runPulse(leftDrawerPulse), [leftDrawerPulse]);
  const triggerRightPulse = useCallback(() => runPulse(rightDrawerPulse), [rightDrawerPulse]);

  return {
    leftDrawerPulse,
    rightDrawerPulse,
    triggerLeftPulse,
    triggerRightPulse
  };
}

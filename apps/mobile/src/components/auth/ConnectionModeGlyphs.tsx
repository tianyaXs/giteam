import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import type { ConnectionMode } from '../../lib/connectionMode';

const AnimatedPath = Animated.createAnimatedComponent(Path);

type GlyphProps = {
  color: string;
  size?: number;
  active?: boolean;
};

/** 局域网：精致 Wi‑Fi（弧线间距与线宽更匀） */
export function LocalModeGlyph(props: GlyphProps) {
  const { color, size = 44, active = true } = props;
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [active, pulse]);

  const outerProps = useAnimatedProps(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.42, 0.88])
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <AnimatedPath
        animatedProps={outerProps}
        d="M9.2 14.6C15.4 9.2 24.6 9.2 30.8 14.6"
        stroke={color}
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <Path
        d="M12.8 19.4C16.9 15.6 23.1 15.6 27.2 19.4"
        stroke={color}
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity={0.78}
      />
      <Path
        d="M16.4 24.2C18.4 22.4 21.6 22.4 23.6 24.2"
        stroke={color}
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <Path
        d="M20 30.2C20.83 30.2 21.5 29.53 21.5 28.7C21.5 27.87 20.83 27.2 20 27.2C19.17 27.2 18.5 27.87 18.5 28.7C18.5 29.53 19.17 30.2 20 30.2Z"
        fill={color}
      />
    </Svg>
  );
}

/** 云端：轻微上下漂浮 */
export function CloudModeGlyph(props: GlyphProps) {
  const { color, size = 44, active = true } = props;
  const float = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      float.value = 0;
      return;
    }
    float.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2400, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [active, float]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(float.value, [0, 1], [1.2, -1.2]) }]
  }));

  return (
    <Animated.View style={style}>
      <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <Path
          d="M12.5 25.5C10.2 25.5 8.4 23.8 8.4 21.6C8.4 19.5 10 17.8 12.1 17.6C12.6 14.5 15.3 12.2 18.6 12.2C21.4 12.2 23.8 13.9 24.8 16.3C25.2 16.2 25.6 16.1 26.1 16.1C28.5 16.1 30.5 18 30.5 20.4C30.5 22.8 28.6 24.7 26.2 24.8H12.5C12.5 24.8 12.5 25.5 12.5 25.5Z"
          stroke={color}
          strokeWidth="1.9"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

/** 私有：盾牌 + 极轻呼吸 */
export function PrivateModeGlyph(props: GlyphProps) {
  const { color, size = 44, active = true } = props;
  const breath = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      breath.value = 0;
      return;
    }
    breath.value = withDelay(
      160,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 2400, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      )
    );
  }, [active, breath]);

  const shieldProps = useAnimatedProps(() => ({
    opacity: interpolate(breath.value, [0, 1], [0.82, 1])
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 40 40" fill="none" style={StyleSheet.absoluteFill}>
        <AnimatedPath
          animatedProps={shieldProps}
          d="M20 8.5L29 12.2V19.4C29 24.6 25.3 29.1 20 30.8C14.7 29.1 11 24.6 11 19.4V12.2L20 8.5Z"
          stroke={color}
          strokeWidth="1.9"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
      <Svg width={size * 0.4} height={size * 0.4} viewBox="0 0 18 18" fill="none">
        <Rect x="5" y="8" width="8" height="6.5" rx="1.4" stroke={color} strokeWidth="1.6" />
        <Path
          d="M6.8 8V6.4C6.8 4.9 7.9 3.8 9.3 3.8C10.7 3.8 11.8 4.9 11.8 6.4V8"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

export function ConnectionModeGlyph(props: {
  mode: ConnectionMode;
  color: string;
  size?: number;
  active?: boolean;
}) {
  const { mode, color, size = 44, active = true } = props;
  if (mode === 'cloud') return <CloudModeGlyph color={color} size={size} active={active} />;
  if (mode === 'custom') return <PrivateModeGlyph color={color} size={size} active={active} />;
  return <LocalModeGlyph color={color} size={size} active={active} />;
}

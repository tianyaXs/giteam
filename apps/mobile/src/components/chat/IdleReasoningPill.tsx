import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, Vibration } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { ReasoningParticleField } from './ReasoningParticleField';
import {
  IDLE_BG_STOPS_DARK,
  IDLE_BG_STOPS_LIGHT,
  IDLE_INTENSITY_STOPS,
  idlePillColors,
  MobileThinkingLevel,
  thinkingIndex,
  thinkingLevelAt,
  thinkingMeta
} from './thinkingLevels';

type IdleReasoningPillProps = {
  isDark: boolean;
  thinkingLevel: MobileThinkingLevel;
  onThinkingLevelChange: (level: MobileThinkingLevel) => void;
  onOpenInput: () => void;
  height: number;
  borderRadius: number;
  /** 展开输入时为 false：暂停粒子，组件保持挂载以便收回不卡顿 */
  active?: boolean;
};

const STEP_PX = 42;
/** worklet 可读的强度表，与 MOBILE_THINKING_LEVELS 对齐 */
const INTENSITIES = [0, 0.18, 0.36, 0.55, 0.78, 1];
const LEVEL_MAX = INTENSITIES.length - 1;

function intensityAt(index: number): number {
  'worklet';
  const i = Math.max(0, Math.min(LEVEL_MAX, Math.round(index)));
  return INTENSITIES[i];
}

/**
 * 待机输入胶囊：短按展开输入；长按后横滑调节推理强度。
 * 粒子场带游走波律动；松手回到待输入文案，底色随强度渐变。
 */
export function IdleReasoningPill(props: IdleReasoningPillProps) {
  const {
    isDark,
    thinkingLevel,
    onThinkingLevelChange,
    onOpenInput,
    height,
    borderRadius,
    active = true
  } = props;
  const [pillW, setPillW] = useState(0);
  const [scrubLevel, setScrubLevel] = useState(thinkingLevel);
  const [scrubbingUi, setScrubbingUi] = useState(false);
  /** 手势是否真正进入过 scrub，避免 Exclusive 失败时 onFinalize 误取消 */
  const scrubArmed = useSharedValue(0);

  const intensity = useSharedValue(thinkingMeta(thinkingLevel).intensity);
  const scrubbing = useSharedValue(0);
  const baseIndex = useSharedValue(thinkingIndex(thinkingLevel));
  const startIndex = useSharedValue(thinkingIndex(thinkingLevel));
  const liveIndex = useSharedValue(thinkingIndex(thinkingLevel));

  useEffect(() => {
    const idx = thinkingIndex(thinkingLevel);
    baseIndex.value = idx;
    if (scrubbingUi) return;
    intensity.value = withTiming(INTENSITIES[idx], {
      duration: 320,
      easing: Easing.out(Easing.cubic)
    });
    setScrubLevel(thinkingLevel);
  }, [baseIndex, intensity, scrubbingUi, thinkingLevel]);

  const palette = useMemo(
    () => idlePillColors(scrubbingUi ? scrubLevel : thinkingLevel, isDark),
    [isDark, scrubLevel, scrubbingUi, thinkingLevel]
  );

  const buzz = useCallback(() => {
    try {
      Vibration.vibrate(12);
    } catch {
      // ignore
    }
  }, []);

  const enterScrub = useCallback(
    (index: number) => {
      setScrubbingUi(true);
      setScrubLevel(thinkingLevelAt(index));
      buzz();
    },
    [buzz]
  );

  const updateScrub = useCallback(
    (index: number) => {
      const level = thinkingLevelAt(index);
      setScrubLevel((prev) => {
        if (prev === level) return prev;
        buzz();
        return level;
      });
    },
    [buzz]
  );

  const endScrub = useCallback(
    (index: number) => {
      const level = thinkingLevelAt(index);
      setScrubbingUi(false);
      setScrubLevel(level);
      onThinkingLevelChange(level);
    },
    [onThinkingLevelChange]
  );

  const cancelScrub = useCallback(() => {
    setScrubbingUi(false);
    setScrubLevel(thinkingLevel);
    intensity.value = withTiming(INTENSITIES[thinkingIndex(thinkingLevel)], { duration: 220 });
  }, [intensity, thinkingLevel]);

  const scrubGesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(active)
      .activateAfterLongPress(320)
      .activeOffsetX([-6, 6])
      .failOffsetY([-22, 22])
      .onStart(() => {
        'worklet';
        const idx = baseIndex.value;
        startIndex.value = idx;
        liveIndex.value = idx;
        scrubArmed.value = 1;
        scrubbing.value = withTiming(1, { duration: 160 });
        intensity.value = intensityAt(idx);
        runOnJS(enterScrub)(idx);
      })
      .onUpdate((evt) => {
        'worklet';
        if (scrubArmed.value < 1) return;
        const next = Math.max(0, Math.min(LEVEL_MAX, startIndex.value + evt.translationX / STEP_PX));
        const rounded = Math.round(next);
        if (rounded !== liveIndex.value) {
          liveIndex.value = rounded;
          intensity.value = withTiming(intensityAt(rounded), { duration: 100 });
          runOnJS(updateScrub)(rounded);
        } else {
          const a = Math.floor(next);
          const b = Math.min(LEVEL_MAX, a + 1);
          const t = next - a;
          intensity.value = INTENSITIES[a] + (INTENSITIES[b] - INTENSITIES[a]) * t;
        }
      })
      .onEnd(() => {
        'worklet';
        if (scrubArmed.value < 1) return;
        scrubArmed.value = 0;
        scrubbing.value = withTiming(0, { duration: 220 });
        const idx = liveIndex.value;
        intensity.value = withTiming(intensityAt(idx), { duration: 240 });
        runOnJS(endScrub)(idx);
      })
      .onFinalize((_evt, success) => {
        'worklet';
        // 仅取消「已进入 scrub 但未成功结束」的情况，避免与 onEnd 双触发
        if (!success && scrubArmed.value > 0) {
          scrubArmed.value = 0;
          scrubbing.value = withTiming(0, { duration: 160 });
          runOnJS(cancelScrub)();
        }
      });
  }, [
    active,
    baseIndex,
    cancelScrub,
    endScrub,
    enterScrub,
    intensity,
    liveIndex,
    scrubArmed,
    scrubbing,
    startIndex,
    updateScrub
  ]);

  const tapGesture = useMemo(() => {
    return Gesture.Tap()
      .enabled(active)
      .maxDuration(280)
      .onEnd(() => {
        'worklet';
        runOnJS(onOpenInput)();
      });
  }, [active, onOpenInput]);

  // 长按横滑优先；未激活 pan 时才认短按
  const composed = useMemo(
    () => Gesture.Exclusive(scrubGesture, tapGesture),
    [scrubGesture, tapGesture]
  );

  const pillStyle = useAnimatedStyle(() => {
    const stops = isDark ? IDLE_BG_STOPS_DARK : IDLE_BG_STOPS_LIGHT;
    return {
      backgroundColor: interpolateColor(intensity.value, IDLE_INTENSITY_STOPS, stops)
    };
  });

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - scrubbing.value,
    transform: [{ translateX: scrubbing.value * -6 }]
  }));

  const scrubLabelStyle = useAnimatedStyle(() => ({
    opacity: scrubbing.value,
    transform: [{ scale: 0.94 + scrubbing.value * 0.06 }]
  }));

  const meta = thinkingMeta(scrubbingUi ? scrubLevel : thinkingLevel);

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[
          {
            flex: 1,
            height,
            borderRadius,
            justifyContent: 'center',
            paddingHorizontal: 18,
            overflow: 'hidden'
          },
          pillStyle
        ]}
        onLayout={(evt) => {
          const w = Math.ceil(evt.nativeEvent.layout.width);
          if (w > 0 && w !== pillW) setPillW(w);
        }}
        accessibilityRole="button"
        accessibilityLabel={`开始聊天，当前推理${meta.label}。长按左右滑动可调节推理强度`}
      >
        <ReasoningParticleField
          intensity={intensity}
          scrubbing={scrubbing}
          width={pillW}
          height={height}
          borderRadius={borderRadius}
          isDark={isDark}
          active={active}
        />

        <Animated.View style={[styles.labelWrap, labelStyle]} pointerEvents="none">
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '500', color: palette.fg }}>
            询问任何问题
          </Text>
        </Animated.View>

        <Animated.View style={[styles.scrubWrap, scrubLabelStyle]} pointerEvents="none">
          <Text style={{ fontSize: 11, fontWeight: '600', color: palette.label, opacity: 0.7, letterSpacing: 0.6 }}>
            推理强度
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: palette.label, marginTop: 2 }}>
            {meta.shortLabel}
          </Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  labelWrap: {
    zIndex: 2
  },
  scrubWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

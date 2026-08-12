import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { IdlePillAuraField } from './IdlePillAuraField';
import {
  IDLE_INTENSITY_STOPS,
  THINKING_LEVEL_MAX,
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
  /** 压缩为图标态时：点击恢复待机比例，不展开输入 */
  onRestoreStandby?: () => void;
  /** 长按进入 / 离开推理强度调节 */
  onScrubbingChange?: (scrubbing: boolean) => void;
  height: number;
  borderRadius: number;
  /** 展开输入时为 false：暂停粒子，组件保持挂载以便收回不卡顿 */
  active?: boolean;
  /** 模型区展开后左侧压成消息图标 */
  compact?: boolean;
  /** 父级量好的目标宽度（Reanimated 宽度动画下 onLayout 不可靠） */
  layoutWidth?: number;
};

const STEP_PX = 42;

function intensityAt(index: number): number {
  'worklet';
  const i = Math.max(0, Math.min(THINKING_LEVEL_MAX, Math.round(index)));
  return IDLE_INTENSITY_STOPS[i];
}

/**
 * 待机输入胶囊：短按展开输入；长按后横滑调节推理强度。
 * compact 时显示消息图标，点击恢复双按钮比例。
 * 底色/光效由 IdlePillAuraField 绘制；待机无 dock 投影，轮廓靠自身描边。
 */
export const IdleReasoningPill = React.memo(function IdleReasoningPill(props: IdleReasoningPillProps) {
  const {
    isDark,
    thinkingLevel,
    onThinkingLevelChange,
    onOpenInput,
    onRestoreStandby,
    onScrubbingChange,
    height,
    borderRadius,
    active = true,
    compact = false,
    layoutWidth = 0
  } = props;
  const [pillW, setPillW] = useState(0);
  const particleWidth = Math.max(pillW, layoutWidth);
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
    intensity.value = withTiming(IDLE_INTENSITY_STOPS[idx], {
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
      onScrubbingChange?.(true);
      buzz();
    },
    [buzz, onScrubbingChange]
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
      onScrubbingChange?.(false);
      onThinkingLevelChange(level);
    },
    [onScrubbingChange, onThinkingLevelChange]
  );

  const cancelScrub = useCallback(() => {
    setScrubbingUi(false);
    setScrubLevel(thinkingLevel);
    onScrubbingChange?.(false);
    intensity.value = withTiming(IDLE_INTENSITY_STOPS[thinkingIndex(thinkingLevel)], { duration: 220 });
  }, [intensity, onScrubbingChange, thinkingLevel]);

  const scrubGesture = useMemo(() => {
    return Gesture.Pan()
      .enabled(active && !compact)
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
        const next = Math.max(
          0,
          Math.min(THINKING_LEVEL_MAX, startIndex.value + evt.translationX / STEP_PX)
        );
        const rounded = Math.round(next);
        if (rounded !== liveIndex.value) {
          liveIndex.value = rounded;
          intensity.value = withTiming(intensityAt(rounded), { duration: 100 });
          runOnJS(updateScrub)(rounded);
        } else {
          const a = Math.floor(next);
          const b = Math.min(THINKING_LEVEL_MAX, a + 1);
          const t = next - a;
          intensity.value =
            IDLE_INTENSITY_STOPS[a] + (IDLE_INTENSITY_STOPS[b] - IDLE_INTENSITY_STOPS[a]) * t;
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
    compact,
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
        if (compact) {
          if (onRestoreStandby) runOnJS(onRestoreStandby)();
          return;
        }
        runOnJS(onOpenInput)();
      });
  }, [active, compact, onOpenInput, onRestoreStandby]);

  // 长按横滑优先；未激活 pan 时才认短按
  const composed = useMemo(
    () => Gesture.Exclusive(scrubGesture, tapGesture),
    [scrubGesture, tapGesture]
  );

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - scrubbing.value,
    transform: [{ translateX: scrubbing.value * -6 }]
  }));

  const scrubLabelStyle = useAnimatedStyle(() => ({
    opacity: scrubbing.value,
    transform: [{ scale: 0.94 + scrubbing.value * 0.06 }]
  }));

  const meta = thinkingMeta(scrubbingUi ? scrubLevel : thinkingLevel);

  // compact：实心底；展开：透明底交给光效层，淡描边勾轮廓（待机无 dock 投影；overflow 会裁掉自阴影故不用）
  const shellStyle = compact
    ? {
        backgroundColor: palette.bg,
        borderWidth: 0
      }
    : {
        backgroundColor: 'transparent' as const,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(60,80,110,0.16)'
      };

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[
          {
            flex: 1,
            height,
            borderRadius,
            justifyContent: 'center',
            paddingHorizontal: compact ? 0 : 18,
            overflow: 'hidden',
            alignItems: compact ? 'center' : 'stretch'
          },
          shellStyle
        ]}
        onLayout={(evt) => {
          const w = Math.ceil(evt.nativeEvent.layout.width);
          if (w > 0 && w !== pillW) setPillW(w);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          compact
            ? '恢复输入与模型按钮比例'
            : `开始聊天，当前推理${meta.label}。长按左右滑动可调节推理强度`
        }
      >
        {!compact ? (
          <>
            <IdlePillAuraField
              intensity={intensity}
              scrubbing={scrubbing}
              width={particleWidth}
              height={height}
              borderRadius={borderRadius}
              isDark={isDark}
              active={active && !compact}
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
          </>
        ) : (
          <View style={styles.iconWrap} pointerEvents="none">
            <Feather name="message-circle" size={22} color={palette.fg} />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  labelWrap: {
    zIndex: 2
  },
  scrubWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

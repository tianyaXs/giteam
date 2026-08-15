import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';

const DEFAULT_DURATION_MS = 240;

type CollapsibleProps = {
  open: boolean;
  children: React.ReactNode;
  durationMs?: number;
  /**
   * height: 高度补间（侧栏等）。
   * slide: 与 Moirai `AnimatedCollapsibleContent` 一致 —— opacity + translateY(-8→0) + scale，不做 height。
   */
  mode?: 'height' | 'slide';
  /** 仅 height 模式：展开时内容初始下移量 */
  shiftY?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * 内容列表展开。
 * 聊天时间线请用 mode="slide"（对齐 Moirai）；侧栏等可用默认 height。
 */
export function AnimatedCollapsibleContent(props: CollapsibleProps) {
  return <AccordionBody {...props} />;
}

/**
 * Moirai 同款 reveal：布局瞬时占高，240ms opacity + 上滑 8px + 微缩放。
 * @see Moirai apps/mobile/components/ui/animated-collapsible-content.tsx
 */
function SlideRevealBody(props: CollapsibleProps) {
  const { open, children, durationMs = DEFAULT_DURATION_MS, style } = props;
  const progress = useSharedValue(open ? 1 : 0);
  const [present, setPresent] = useState(open);

  useEffect(() => {
    let removeTimer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setPresent(true);
    }
    progress.value = withTiming(open ? 1 : 0, {
      duration: durationMs,
      easing: Easing.out(Easing.cubic)
    });
    if (!open) {
      removeTimer = setTimeout(() => setPresent(false), durationMs);
    }
    return () => {
      if (removeTimer) clearTimeout(removeTimer);
    };
  }, [durationMs, open, progress]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35, 1], [0, 0.72, 1]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.992, 1]) }
    ]
  }));

  if (!present && !open) return null;

  return (
    <Animated.View
      style={[styles.fullWidth, containerStyle, style]}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <View collapsable={false} pointerEvents="box-none" style={styles.fullWidth}>
        {children}
      </View>
    </Animated.View>
  );
}

/**
 * mode=slide → Moirai reveal；默认 height → 侧栏手风琴。
 */
export function AccordionBody(props: CollapsibleProps) {
  if ((props.mode || 'height') === 'slide') {
    return <SlideRevealBody {...props} />;
  }
  return <HeightTweenBody {...props} />;
}

function HeightTweenBody(props: CollapsibleProps) {
  const { open, children, durationMs = DEFAULT_DURATION_MS, shiftY = 6, style } = props;
  const measuredHeight = useSharedValue(0);
  const progress = useSharedValue(open ? 1 : 0);
  const [mounted, setMounted] = useState(open);
  const openRef = useRef(open);
  openRef.current = open;
  const shiftYRef = useRef(shiftY);
  shiftYRef.current = shiftY;

  const finishClose = useCallback(() => {
    if (!openRef.current) setMounted(false);
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // 已展开且高度已知时保持展开，避免抽屉打开时 withTiming(1) 重播
      if (measuredHeight.value > 0 && progress.value < 0.99) {
        progress.value = withTiming(1, {
          duration: durationMs,
          easing: Easing.out(Easing.cubic)
        });
      } else if (measuredHeight.value > 0) {
        progress.value = 1;
      }
      return;
    }
    progress.value = withTiming(
      0,
      { duration: durationMs, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      }
    );
  }, [durationMs, finishClose, measuredHeight, open, progress]);

  const containerStyle = useAnimatedStyle(() => ({
    height: measuredHeight.value * progress.value,
    overflow: 'hidden' as const,
    opacity: interpolate(progress.value, [0, 0.35, 1], [0, 1, 1])
  }));

  // 内容贴顶裁切：高度变大 = 自上而下露出。
  const contentStyle = useAnimatedStyle(() => {
    const shift = shiftYRef.current;
    if (!shift) {
      return { transform: [{ translateY: 0 }] };
    }
    return {
      transform: [{ translateY: interpolate(progress.value, [0, 1], [shift, 0]) }]
    };
  });

  return (
    <Animated.View style={[containerStyle, styles.fullWidth, style]} pointerEvents={open ? 'auto' : 'none'}>
      {mounted ? (
        <Animated.View style={[styles.fullWidth, contentStyle]}>
          <View
            collapsable={false}
            style={styles.measure}
            onLayout={(evt) => {
              const h = Math.ceil(evt.nativeEvent.layout.height);
              if (h <= 0) return;
              const prev = measuredHeight.value;
              const firstMeasure = prev <= 0;
              if (!firstMeasure) {
                if (Math.abs(h - prev) <= 1) return;
                // 「加载更多」等：已展开时高度顺滑生长/收缩，形成下滑揭示
                if (openRef.current && progress.value > 0.95) {
                  measuredHeight.value = withTiming(h, {
                    duration: Math.min(420, Math.max(220, Math.abs(h - prev) * 2.2)),
                    easing: Easing.out(Easing.cubic)
                  });
                } else {
                  measuredHeight.value = h;
                }
                return;
              }
              measuredHeight.value = h;
              if (openRef.current) {
                // 挂载时已是展开（如抽屉重挂载）：直接对齐高度，勿从 0 再播展开动画
                if (progress.value > 0.5) {
                  progress.value = 1;
                  return;
                }
                progress.value = 0;
                progress.value = withTiming(1, {
                  duration: durationMs,
                  easing: Easing.out(Easing.cubic)
                });
              }
            }}
          >
            {children}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** 右箭头旋转 0→90°，与展开进度同步。 */
export function AccordionChevron(props: { expanded: boolean; color: string; size?: number }) {
  const progress = useSharedValue(props.expanded ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(props.expanded ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic)
    });
  }, [progress, props.expanded]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 90])}deg` }]
  }));
  return (
    <Animated.View style={style}>
      <Feather name="chevron-right" size={props.size ?? 16} color={props.color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fullWidth: {
    width: '100%'
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0
  }
});

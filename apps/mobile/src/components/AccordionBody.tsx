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
  style?: StyleProp<ViewStyle>;
};

/**
 * 内容列表展开：高度自顶向下生长 + 淡入。
 *
 * 不直接照搬 Moirai 的「无高度、translateY:-8」方案——在 LegendList
 * `maintainVisibleContentPosition.size` 下，瞬间增高会把点击行顶上去，
 * 负向 translateY / 居中 scale 也会看起来像往上展开。
 */
export function AnimatedCollapsibleContent(props: CollapsibleProps) {
  return <AccordionBody {...props} />;
}

/**
 * 高度手风琴：事件列表 / 侧栏项目树 / 设置供应商列表共用。
 */
export function AccordionBody(props: CollapsibleProps) {
  const { open, children, durationMs = DEFAULT_DURATION_MS, style } = props;
  const measuredHeight = useSharedValue(0);
  const progress = useSharedValue(open ? 1 : 0);
  const [mounted, setMounted] = useState(open);
  const openRef = useRef(open);
  openRef.current = open;

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
    opacity: interpolate(progress.value, [0, 0.45, 1], [0, 0.85, 1])
  }));

  // 内容贴顶裁切：高度变大 = 自上而下露出。轻微正向 translateY，避免往上窜。
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [6, 0]) }]
  }));

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
              measuredHeight.value = h;
              if (openRef.current && firstMeasure) {
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

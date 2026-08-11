import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';

/** 与 styles.actionBtnSend / actionBtnDisabled 同尺寸 */
const BTN_SIZE = 32;

type ComposerSendDragHandleProps = {
  enabled: boolean;
  backgroundColor: string;
  iconColor: string;
  /** 与输入框左滑共用的位移 */
  swipeX: SharedValue<number>;
  rowWidth: SharedValue<number>;
  onCommitIdle: () => void;
};

/**
 * 空输入时的普通发送钮外观；向左拖动可跟手进入待机。
 */
export const ComposerSendDragHandle = React.memo(function ComposerSendDragHandle(props: ComposerSendDragHandleProps) {
  const { enabled, backgroundColor, iconColor, swipeX, rowWidth, onCommitIdle } = props;
  const press = useSharedValue(0);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-6, 6])
        .failOffsetY([-20, 20])
        .onBegin(() => {
          'worklet';
          press.value = withTiming(1, { duration: 120 });
        })
        .onUpdate((evt) => {
          'worklet';
          if (evt.translationX <= 0) {
            swipeX.value = evt.translationX;
          } else {
            swipeX.value = evt.translationX * 0.1;
          }
        })
        .onEnd((evt) => {
          'worklet';
          press.value = withTiming(0, { duration: 160 });
          const w = Math.max(160, rowWidth.value);
          const distance = Math.max(0, -swipeX.value);
          const threshold = w * 0.28;
          const fling = evt.velocityX < -550;
          if (distance > threshold || fling) {
            swipeX.value = withTiming(
              -w,
              { duration: 240, easing: Easing.out(Easing.cubic) },
              (finished) => {
                if (finished) runOnJS(onCommitIdle)();
              }
            );
          } else {
            swipeX.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.85 });
          }
        })
        .onFinalize((_evt, success) => {
          'worklet';
          if (!success) {
            press.value = withTiming(0, { duration: 120 });
            const w = Math.max(160, rowWidth.value);
            if (swipeX.value > -w * 0.45) {
              swipeX.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.85 });
            }
          }
        }),
    [enabled, onCommitIdle, press, rowWidth, swipeX]
  );

  const shellStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + press.value * 0.04 }]
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel="拖动以回到待机输入"
        style={[styles.btn, shellStyle, { backgroundColor }]}
      >
        <View pointerEvents="none">
          <Feather name="arrow-up" size={18} color={iconColor} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  btn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    marginLeft: 2,
    alignItems: 'center',
    justifyContent: 'center'
  }
});

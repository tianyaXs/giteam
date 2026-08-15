import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
import { ComposerMicGlyph } from './ComposerMicGlyph';
import { ComposerSendGlyph } from './ComposerSendGlyph';

/** 与桌面 size-8 圆钮同尺寸 */
const BTN_SIZE = 32;

type ComposerSendDragHandleProps = {
  enabled: boolean;
  backgroundColor: string;
  iconColor: string;
  chromeStyle?: StyleProp<ViewStyle>;
  /** 与输入框左滑共用的位移 */
  swipeX: SharedValue<number>;
  rowWidth: SharedValue<number>;
  onCommitIdle: () => void;
  /** 轻点进入语音（按住说话）；左滑仍回待机。未提供则显示发送图标。 */
  onPress?: () => void;
  /** 是否展示语音入口图标；关闭时仅保留左滑待机 + 发送外观 */
  voiceEntryAvailable?: boolean;
};

/**
 * 空输入右侧圆钮：有语音资源时为波形入口；否则为发送外观；向左拖回待机。
 */
export const ComposerSendDragHandle = React.memo(function ComposerSendDragHandle(props: ComposerSendDragHandleProps) {
  const {
    enabled,
    backgroundColor,
    iconColor,
    chromeStyle,
    swipeX,
    rowWidth,
    onCommitIdle,
    onPress,
    voiceEntryAvailable = true
  } = props;
  const press = useSharedValue(0);
  const canEnterVoice = Boolean(onPress) && voiceEntryAvailable;

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
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
      });

    if (!canEnterVoice || !onPress) return pan;

    const tap = Gesture.Tap()
      .enabled(enabled)
      .maxDistance(8)
      .onEnd(() => {
        'worklet';
        runOnJS(onPress)();
      });

    // 左滑优先；未形成横滑时走轻点进语音
    return Gesture.Exclusive(pan, tap);
  }, [canEnterVoice, enabled, onCommitIdle, onPress, press, rowWidth, swipeX]);

  const shellStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + press.value * 0.04 }]
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={
          canEnterVoice ? '语音输入，向左拖动可回到待机' : '发送，向左拖动可回到待机'
        }
        style={[styles.btn, { backgroundColor }, chromeStyle, shellStyle]}
      >
        <View pointerEvents="none">
          {canEnterVoice ? (
            <ComposerMicGlyph color={iconColor} size={20} />
          ) : (
            <ComposerSendGlyph busy={false} color={iconColor} size={20} />
          )}
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

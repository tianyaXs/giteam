import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { FONT_DISPLAY_SERIF } from '../styles/mobileFonts';
import { useMobileTheme } from '../features/theme/ThemeProvider';

type GiteamStartupAnimationProps = {
  animate?: boolean;
  fontsReady?: boolean;
  fontFamily?: string;
};

/** 与桌面端同款 mark；加载时旋转。浅色=白底深标，深色=深底白标。 */
const APP_ICON_MARK = require('../../assets/app-icon-mark.png');

export function GiteamStartupAnimation(props: GiteamStartupAnimationProps) {
  const { colors } = useMobileTheme();
  const animate = props.animate !== false;
  const wordmarkFontFamily =
    props.fontsReady === false
      ? undefined
      : props.fontFamily || FONT_DISPLAY_SERIF;
  const spin = useRef(new Animated.Value(0)).current;
  const wordmark = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2800,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    loop.start();
    return () => loop.stop();
  }, [animate, spin]);

  useEffect(() => {
    if (!animate) return;
    wordmark.setValue(0);
    const animation = Animated.sequence([
      Animated.delay(400),
      Animated.timing(wordmark, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    ]);
    animation.start();
    return () => animation.stop();
  }, [animate, wordmark]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });
  const wordmarkOpacity = wordmark.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1]
  });
  const wordmarkTranslateY = wordmark.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0]
  });

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.iconWrap}>
        <Animated.Image
          source={APP_ICON_MARK}
          resizeMode="contain"
          style={[
            styles.icon,
            { tintColor: colors.text },
            { transform: [{ rotate }] }
          ]}
        />
      </View>
      <Animated.View
        style={[
          styles.wordmarkWrap,
          {
            opacity: wordmarkOpacity,
            transform: [{ translateY: wordmarkTranslateY }]
          }
        ]}
      >
        <Text
          style={[
            styles.wordmark,
            { color: colors.text },
            wordmarkFontFamily ? { fontFamily: wordmarkFontFamily } : null
          ]}
        >
          Giteam
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconWrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center'
  },
  icon: {
    width: 48,
    height: 48
  },
  wordmarkWrap: {
    marginTop: 12,
    paddingHorizontal: 10,
    alignSelf: 'center'
  },
  wordmark: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    fontWeight: '600',
    ...(Platform.OS === 'android'
      ? { includeFontPadding: false, paddingRight: 4 }
      : { paddingRight: 2 })
  }
});

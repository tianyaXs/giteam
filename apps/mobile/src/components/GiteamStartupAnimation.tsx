import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type GiteamStartupAnimationProps = {
  animate?: boolean;
  fontFamily?: string;
};

const BG = '#f6f1e8';
const TEAL = '#2db8ad';
const DEEP = '#1d6a73';
const BLUE = '#2669a8';
const ACCENT = '#dd835f';
const WORDMARK = '#2b2a28';
const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 260;

const LEFT_BODY_PATH = 'M52 182 C60 160 80 144 102 146 C126 148 142 164 150 184';
const LEFT_ARM_PATH = 'M73 176 C91 165 107 162 124 164';
const CENTER_BODY_PATH = 'M124 170 C134 146 150 132 170 132 C190 132 206 146 216 170';
const CENTER_LINK_LEFT_PATH = 'M144 151 C136 158 128 165 120 171';
const CENTER_LINK_RIGHT_PATH = 'M196 151 C204 158 212 165 220 171';
const RIGHT_BODY_PATH = 'M190 184 C198 164 214 149 238 146 C260 143 280 158 288 182';
const RIGHT_ARM_PATH = 'M216 164 C233 162 249 165 267 176';
const BASE_SWEEP_PATH = 'M96 210 C132 222 174 224 242 210';

function strokeAnim(progress: Animated.Value, length: number) {
  return {
    opacity: progress.interpolate({
      inputRange: [0, 0.2, 1],
      outputRange: [0, 0.88, 1]
    }),
    strokeDasharray: `${length} ${length}`,
    strokeDashoffset: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [length, 0]
    })
  };
}

export function GiteamStartupAnimation(props: GiteamStartupAnimationProps) {
  const animate = props.animate !== false;
  const leftHead = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const leftBody = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const centerHead = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const centerBody = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const rightHead = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const rightBody = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const centerDot = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const sweep = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const wordmark = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    leftHead.setValue(0);
    leftBody.setValue(0);
    centerHead.setValue(0);
    centerBody.setValue(0);
    rightHead.setValue(0);
    rightBody.setValue(0);
    centerDot.setValue(0);
    sweep.setValue(0);
    wordmark.setValue(0);

    const animation = Animated.parallel([
      Animated.sequence([
        Animated.delay(70),
        Animated.timing(leftHead, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(160),
        Animated.timing(leftBody, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(280),
        Animated.timing(centerHead, {
          toValue: 1,
          duration: 340,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(420),
        Animated.timing(centerBody, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(220),
        Animated.timing(rightHead, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(520),
        Animated.timing(rightBody, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(620),
        Animated.spring(centerDot, {
          toValue: 1,
          tension: 58,
          friction: 7,
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(830),
        Animated.timing(sweep, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false
        })
      ]),
      Animated.sequence([
        Animated.delay(1120),
        Animated.timing(wordmark, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        })
      ])
    ]);

    animation.start();
    return () => animation.stop();
  }, [
    animate,
    centerBody,
    centerDot,
    centerHead,
    leftBody,
    leftHead,
    rightBody,
    rightHead,
    sweep,
    wordmark
  ]);

  const headOpacity = (value: Animated.Value) =>
    value.interpolate({
      inputRange: [0, 0.12, 1],
      outputRange: [0, 1, 1]
    });

  const dotRadius = centerDot.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [4, 12, 10]
  });
  const dotOpacity = centerDot.interpolate({
    inputRange: [0, 0.18, 1],
    outputRange: [0, 1, 1]
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
    <View style={styles.screen}>
      <View style={styles.iconWrap}>
        <Svg width={280} height={220} viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} fill="none">
          <AnimatedCircle
            cx="96"
            cy="108"
            r={leftHead.interpolate({
              inputRange: [0, 0.7, 1],
              outputRange: [8, 24, 22]
            })}
            fill="transparent"
            stroke={TEAL}
            strokeWidth={10}
            opacity={headOpacity(leftHead)}
          />
          <AnimatedPath
            d={LEFT_BODY_PATH}
            stroke={TEAL}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(leftBody, 150)}
          />
          <AnimatedPath
            d={LEFT_ARM_PATH}
            stroke={TEAL}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(leftBody, 72)}
          />

          <AnimatedCircle
            cx="170"
            cy="92"
            r={centerHead.interpolate({
              inputRange: [0, 0.7, 1],
              outputRange: [9, 27, 24]
            })}
            fill="transparent"
            stroke={DEEP}
            strokeWidth={11}
            opacity={headOpacity(centerHead)}
          />
          <AnimatedPath
            d={CENTER_BODY_PATH}
            stroke={DEEP}
            strokeWidth={11}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(centerBody, 124)}
          />
          <AnimatedPath
            d={CENTER_LINK_LEFT_PATH}
            stroke={DEEP}
            strokeWidth={11}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(centerBody, 40)}
          />
          <AnimatedPath
            d={CENTER_LINK_RIGHT_PATH}
            stroke={DEEP}
            strokeWidth={11}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(centerBody, 40)}
          />

          <AnimatedCircle
            cx="244"
            cy="108"
            r={rightHead.interpolate({
              inputRange: [0, 0.7, 1],
              outputRange: [8, 24, 22]
            })}
            fill="transparent"
            stroke={BLUE}
            strokeWidth={10}
            opacity={headOpacity(rightHead)}
          />
          <AnimatedPath
            d={RIGHT_BODY_PATH}
            stroke={BLUE}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(rightBody, 150)}
          />
          <AnimatedPath
            d={RIGHT_ARM_PATH}
            stroke={BLUE}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(rightBody, 72)}
          />

          <AnimatedCircle cx="170" cy="156" r={dotRadius} fill={ACCENT} opacity={dotOpacity} />
          <AnimatedPath
            d={BASE_SWEEP_PATH}
            stroke="#d9d1c3"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...strokeAnim(sweep, 156)}
          />
        </Svg>
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
        <Text style={[styles.wordmark, props.fontFamily ? { fontFamily: props.fontFamily } : null]}>Giteam</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG
  },
  iconWrap: {
    width: 280,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center'
  },
  wordmarkWrap: {
    marginTop: 2
  },
  wordmark: {
    color: WORDMARK,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1.2
  }
});

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

export function useChatMotionState(params: {
  streaming: boolean;
  streamTopGlowRequested?: boolean;
  streamTopGlowEnabled?: boolean;
}) {
  const {
    streaming,
    streamTopGlowEnabled = true,
    streamTopGlowRequested = false
  } = params;

  const [thinkingPulse, setThinkingPulse] = useState(false);
  const [streamTopGlowVisible, setStreamTopGlowVisible] = useState(false);
  const streamTopGlowAnim = useRef(new Animated.Value(0)).current;
  const streamTopGlowLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const streamTopGlowActiveRef = useRef(false);
  const streamTopGlowHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveGlowRequested = streamTopGlowEnabled && streamTopGlowRequested;
  const showStreamTopGlow = streamTopGlowEnabled && streamTopGlowVisible;

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setThinkingPulse((v) => !v), 480);
    return () => clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    if (streamTopGlowHideTimerRef.current) {
      clearTimeout(streamTopGlowHideTimerRef.current);
      streamTopGlowHideTimerRef.current = null;
    }
    if (effectiveGlowRequested) {
      setStreamTopGlowVisible(true);
      return;
    }
    streamTopGlowHideTimerRef.current = setTimeout(() => {
      setStreamTopGlowVisible(false);
      streamTopGlowHideTimerRef.current = null;
    }, 520);
    return () => {
      if (streamTopGlowHideTimerRef.current) {
        clearTimeout(streamTopGlowHideTimerRef.current);
        streamTopGlowHideTimerRef.current = null;
      }
    };
  }, [effectiveGlowRequested]);

  useEffect(() => {
    if (!showStreamTopGlow) {
      if (!streamTopGlowActiveRef.current) return;
      streamTopGlowActiveRef.current = false;
      streamTopGlowLoopRef.current?.stop();
      streamTopGlowLoopRef.current = null;
      Animated.timing(streamTopGlowAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start();
      return;
    }
    if (streamTopGlowActiveRef.current || streamTopGlowLoopRef.current) return;
    streamTopGlowActiveRef.current = true;
    const loop = Animated.loop(
      Animated.timing(streamTopGlowAnim, {
        toValue: 1,
        duration: 1900,
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    streamTopGlowAnim.setValue(0);
    streamTopGlowLoopRef.current = loop;
    loop.start();
    return () => {
      if (!streamTopGlowActiveRef.current) {
        loop.stop();
        if (streamTopGlowLoopRef.current === loop) streamTopGlowLoopRef.current = null;
      }
    };
  }, [showStreamTopGlow, streamTopGlowAnim]);

  return {
    thinkingPulse,
    showStreamTopGlow,
    streamTopGlowAnim
  };
}

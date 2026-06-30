import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Platform, type KeyboardEvent } from 'react-native';

export function useMobileShellLifecycle(params: {
  appReady: boolean;
  setStartupSessionHydrating: (value: boolean) => void;
  startupSessionHydrating: boolean;
}) {
  const {
    appReady,
    setStartupSessionHydrating,
    startupSessionHydrating
  } = params;

  const [keyboardInset, setKeyboardInset] = useState(0);
  const launchOverlayOpacity = useRef(new Animated.Value(1)).current;
  const [launchOverlayVisible, setLaunchOverlayVisible] = useState(true);

  useEffect(() => {
    const syncKeyboardInset = (event: KeyboardEvent | undefined, nextInset: number) => {
      if (event && typeof Keyboard.scheduleLayoutAnimation === 'function') {
        Keyboard.scheduleLayoutAnimation(event);
      }
      setKeyboardInset(nextInset > 0 ? nextInset : 0);
    };
    const handleKeyboardShow = (event: KeyboardEvent) => {
      const height = Number(event.endCoordinates?.height || 0);
      syncKeyboardInset(event, height);
    };
    const handleKeyboardHide = (event?: KeyboardEvent) => {
      syncKeyboardInset(event, 0);
    };
    const subscriptions = [
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', handleKeyboardShow),
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', handleKeyboardHide),
    ];
    if (Platform.OS === 'ios') {
      subscriptions.push(Keyboard.addListener('keyboardWillChangeFrame', handleKeyboardShow));
    }
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  useEffect(() => {
    if (!appReady || !launchOverlayVisible || startupSessionHydrating) return;
    const timer = setTimeout(() => {
      Animated.timing(launchOverlayOpacity, {
        toValue: 0,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }).start(() => setLaunchOverlayVisible(false));
    }, 1940);
    return () => clearTimeout(timer);
  }, [appReady, launchOverlayOpacity, launchOverlayVisible, startupSessionHydrating]);

  useEffect(() => {
    if (!startupSessionHydrating) return;
    const timer = setTimeout(() => setStartupSessionHydrating(false), 4500);
    return () => clearTimeout(timer);
  }, [setStartupSessionHydrating, startupSessionHydrating]);

  return {
    keyboardInset,
    launchOverlayOpacity,
    launchOverlayVisible
  };
}

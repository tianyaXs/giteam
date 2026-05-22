import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard } from 'react-native';

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
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const height = Number(event.endCoordinates?.height || 0);
      setKeyboardInset(height > 0 ? height : 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardInset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
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

import {
  BlurMask,
  Canvas,
  Circle,
  Fill,
  Group
} from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { THEME_TOKENS } from './themes';
import { getThemeOverride, setThemeOverride, type ThemeOverride } from './useThemeOverride';

export type ThemeRevealOrigin = {
  x: number;
  y: number;
};

type RevealSession = {
  origin: ThemeRevealOrigin;
  to: ThemeOverride;
  fromColor: string;
};

type Listener = (session: RevealSession) => void;

const listeners = new Set<Listener>();

/** 洞缘软边；maxRadius 需盖过屏外，收尾时不留残边 */
const EDGE_BLUR = 32;
const DURATION_MS = 620;

/** 等 Canvas 铺满旧色后再切主题，避免换色闪一下 */
const SETTLE = { skiaPaint: 2, treeRepaint: 1 } as const;

let busy = false;

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = n;
    const tick = () => {
      if (--remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function maxRevealRadius(ox: number, oy: number, w: number, h: number): number {
  return (
    Math.ceil(Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy))) + EDGE_BLUR * 3
  );
}

/**
 * 从点击点圆形扩散切换主题（旧色遮罩 + dstOut 挖洞，洞内是真实新 UI）。
 */
export function startThemeCircularReveal(origin: ThemeRevealOrigin, to: ThemeOverride): void {
  if (to !== 'light' && to !== 'dark') return;
  const from = getThemeOverride();
  if (from === to) return;
  if (busy) return;
  busy = true;
  const session: RevealSession = {
    origin,
    to,
    fromColor: THEME_TOKENS[from].background
  };
  let delivered = false;
  listeners.forEach((l) => {
    try {
      l(session);
      delivered = true;
    } catch {
      // ignore
    }
  });
  if (!delivered) {
    setThemeOverride(to);
    busy = false;
  }
}

/**
 * 扩散遮罩：仅在动画期间挂载 Canvas。
 * 结束时绝不能先把 progress 置 0（洞会瞬间合上铺满旧色/黑屏），
 * 也不要常驻空 Canvas（Android 上空 Skia 层常整屏发黑）。
 */
export function ThemeCircularRevealHost() {
  const { width, height } = useWindowDimensions();
  const [session, setSession] = useState<RevealSession | null>(null);
  const progress = useSharedValue(0);
  const maxR = useSharedValue(0);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const finish = useCallback(() => {
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    // progress 保持 1：遮罩已挖透，卸层无可见突变
    setSession(null);
    busy = false;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      busy = false;
    };
  }, []);

  useEffect(() => {
    const onReveal = (next: RevealSession) => {
      void (async () => {
        try {
          progress.value = 0;
          maxR.value = maxRevealRadius(next.origin.x, next.origin.y, width, height);
          setSession(next);

          await waitFrames(SETTLE.skiaPaint);
          if (!mountedRef.current) {
            finish();
            return;
          }

          setThemeOverride(next.to);

          await waitFrames(SETTLE.treeRepaint);
          if (!mountedRef.current) {
            finish();
            return;
          }

          progress.value = withTiming(1, {
            duration: DURATION_MS,
            easing: Easing.out(Easing.cubic)
          });

          // 略晚于动画，确保最后一帧洞已扩满再卸
          finishTimerRef.current = setTimeout(() => {
            finishTimerRef.current = null;
            if (!mountedRef.current) return;
            finish();
          }, DURATION_MS + 32);
        } catch {
          setThemeOverride(next.to);
          finish();
        }
      })();
    };
    listeners.add(onReveal);
    return () => {
      listeners.delete(onReveal);
    };
  }, [finish, height, maxR, progress, width]);

  const radius = useDerivedValue(() => {
    const p = progress.value;
    const t = p * p * (3 - 2 * p);
    return t * maxR.value;
  });

  if (!session) return null;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { zIndex: 9999, elevation: 9999 }]}
    >
      <Canvas style={StyleSheet.absoluteFillObject} opaque={false}>
        <Fill color={session.fromColor} />
        <Group blendMode="dstOut">
          <Circle
            cx={session.origin.x}
            cy={session.origin.y}
            r={radius}
            color="#FFFFFF"
          >
            <BlurMask blur={EDGE_BLUR} style="normal" />
          </Circle>
        </Group>
      </Canvas>
    </View>
  );
}

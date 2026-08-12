import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Rect,
  interpolateColors
} from '@shopify/react-native-skia';
import { MeshGradientView } from 'expo-mesh-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  FrameInfo,
  SharedValue,
  interpolateColor,
  useDerivedValue,
  useFrameCallback,
  useSharedValue
} from 'react-native-reanimated';
import { IDLE_BG_STOPS_DARK, IDLE_INTENSITY_STOPS } from './thinkingLevels';

type IdlePillAuraFieldProps = {
  intensity: SharedValue<number>;
  scrubbing: SharedValue<number>;
  width: number;
  height: number;
  borderRadius?: number;
  isDark?: boolean;
  active?: boolean;
};

type Seed = {
  x0: number;
  y0: number;
  drift: number;
  bobFreq: number;
  bobAmp: number;
  radius: number;
  phase: number;
  twinkle: number;
  soft: boolean;
};

const COUNT = 48;
/** 浅色 mesh 降到 ~12fps，避免每帧 setState */
const LIGHT_FRAME_MS = 80;

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildSeeds(): Seed[] {
  const list: Seed[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const a = hash01(i * 3.17);
    const b = hash01(i * 7.91);
    const c = hash01(i * 11.3);
    const d = hash01(i * 19.7);
    const soft = c > 0.88;
    list.push({
      x0: a,
      y0: 0.1 + b * 0.8,
      drift: 0.1 + d * 0.18,
      bobFreq: 0.4 + a * 0.75,
      bobAmp: soft ? 1.2 + b * 2 : 0.8 + b * 2.2,
      radius: soft ? 2.6 + a * 1.4 : 0.55 + b * 1.1,
      phase: c * Math.PI * 2,
      twinkle: 0.65 + d * 1.8,
      soft
    });
  }
  return list;
}

const SEEDS = buildSeeds();

function speedMulParticles(fill: number, scrub: number): number {
  'worklet';
  return 0.4 + fill * 3.3 + scrub * 1.2;
}

function wrap01(v: number): number {
  'worklet';
  const r = v % 1;
  return r < 0 ? r + 1 : r;
}

function SoftDot(props: {
  seed: Seed;
  width: number;
  height: number;
  phase: SharedValue<number>;
  intensity: SharedValue<number>;
  scrubbing: SharedValue<number>;
}) {
  const { seed, width, height, phase, intensity, scrubbing } = props;

  const cx = useDerivedValue(() => {
    const x = wrap01(seed.x0 + phase.value * seed.drift * 0.42);
    return x * width;
  });

  const cy = useDerivedValue(() => {
    const bob =
      Math.sin(phase.value * seed.bobFreq + seed.phase) *
      seed.bobAmp *
      (0.7 + intensity.value * 0.9);
    return seed.y0 * height + bob;
  });

  const r = useDerivedValue(() => {
    const fill = intensity.value;
    const pulse = 0.92 + 0.08 * Math.sin(phase.value * seed.twinkle + seed.phase);
    return seed.radius * pulse * (0.85 + fill * 0.35 + scrubbing.value * 0.12);
  });

  const opacity = useDerivedValue(() => {
    const fill = intensity.value;
    const scrub = scrubbing.value;
    const t = phase.value;
    const x = wrap01(seed.x0 + t * seed.drift * 0.42);
    const edge = x < 0.08 ? x / 0.08 : x > 0.92 ? (1 - x) / 0.08 : 1;
    const tw = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * seed.twinkle + seed.phase));
    const base = seed.soft ? 0.14 + fill * 0.32 : 0.3 + fill * 0.45;
    return Math.min(0.8, base * edge * tw * (0.88 + scrub * 0.15));
  });

  const color = useDerivedValue(() =>
    interpolateColors(intensity.value, [0, 0.5, 1], ['#6A849E', '#8FB4FF', '#A5C4FF'])
  );

  return (
    <Circle cx={cx} cy={cy} r={r} color={color} opacity={opacity}>
      {seed.soft ? <BlurMask blur={3} style="solid" /> : null}
    </Circle>
  );
}

function DarkParticleField(props: {
  intensity: SharedValue<number>;
  scrubbing: SharedValue<number>;
  width: number;
  height: number;
  borderRadius: number;
  active: boolean;
}) {
  const { intensity, scrubbing, width, height, borderRadius, active } = props;

  const phase = useSharedValue(0);
  const onFrame = useCallback(
    (info: FrameInfo) => {
      'worklet';
      const rawDt = info.timeSincePreviousFrame;
      const dt = Math.min(0.05, (rawDt == null || rawDt <= 0 ? 16 : rawDt) / 1000);
      phase.value += dt * speedMulParticles(intensity.value, scrubbing.value);
    },
    [intensity, phase, scrubbing]
  );
  const frameCb = useFrameCallback(onFrame, false);
  const setFrameActiveRef = useRef(frameCb.setActive);
  setFrameActiveRef.current = frameCb.setActive;
  useEffect(() => {
    setFrameActiveRef.current(!!active);
    return () => setFrameActiveRef.current(false);
  }, [active]);

  const pillBg = useDerivedValue(() =>
    interpolateColor(intensity.value, IDLE_INTENSITY_STOPS, IDLE_BG_STOPS_DARK)
  );

  const dots = useMemo(
    () =>
      SEEDS.map((seed, i) => (
        <SoftDot
          key={`d-${i}`}
          seed={seed}
          width={width}
          height={height}
          phase={phase}
          intensity={intensity}
          scrubbing={scrubbing}
        />
      )),
    [height, intensity, phase, scrubbing, width]
  );

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius, overflow: 'hidden' }]}
    >
      <Canvas style={{ width, height }}>
        <Rect x={0} y={0} width={width} height={height} color={pillBg} />
        <Group blendMode="plus">{dots}</Group>
      </Canvas>
    </View>
  );
}

/**
 * 浅色：液体感淡彩雾（油膜式），低饱和柔融，不做霓虹。
 * 实现：expo-mesh-gradient（非 Skia）。
 */
const FOG_MESH_BASE = [
  [0.0, 0.0],
  [0.5, 0.0],
  [1.0, 0.0],
  [0.0, 0.5],
  [0.5, 0.5],
  [1.0, 0.5],
  [0.0, 1.0],
  [0.5, 1.0],
  [1.0, 1.0]
] as const;

const FOG_PEARL = [
  '#F5F7FB',
  '#F6F6FA',
  '#F7F5F9',
  '#F8F5F7',
  '#F8F6F4',
  '#F7F7F3',
  '#F4F8F5',
  '#F3F7F8',
  '#F4F6FA',
  '#F6F5F9',
  '#F7F5F7',
  '#F4F7F6'
];
const FOG_TINT = [
  '#BFD8F5',
  '#C8C0EE',
  '#DFC0E4',
  '#ECC0D4',
  '#E8CDBE',
  '#DDD9B8',
  '#B8E0CC',
  '#B0DCE2',
  '#B6D0EC',
  '#CAC0E6',
  '#E0C0DA',
  '#B8DCD0'
];

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixHex(a: string, b: string, t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = lerpChannel((pa >> 16) & 255, (pb >> 16) & 255, u);
  const g = lerpChannel((pa >> 8) & 255, (pb >> 8) & 255, u);
  const bl = lerpChannel(pa & 255, pb & 255, u);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function samplePalette(palette: string[], u: number): string {
  const n = palette.length;
  const f = ((u % 1) + 1) % 1;
  const x = f * n;
  const i0 = Math.floor(x) % n;
  const i1 = (i0 + 1) % n;
  return mixHex(palette[i0], palette[i1], x - Math.floor(x));
}

function fogMeshColors(intensity: number, phase: number): string[] {
  const fill = Math.max(0, Math.min(1, intensity));
  const depth = 0.06 + Math.pow(fill, 1.15) * 0.78;
  const drift = 0.02 + fill * 0.08;
  const colors: string[] = [];
  for (let i = 0; i < 9; i += 1) {
    const u = i * 0.19 + phase * drift * (0.5 + i * 0.04);
    const pearl = samplePalette(FOG_PEARL, u);
    const tint = samplePalette(FOG_TINT, u + 0.08);
    colors.push(mixHex(pearl, tint, depth));
  }
  return colors;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function deformFogPoint(i: number, x: number, y: number, s: number, amp: number): [number, number] {
  if (i === 0 || i === 2 || i === 6 || i === 8) return [x, y];
  if (i === 1 || i === 7) {
    return [clamp01(0.5 + Math.sin(s * 0.38 + i * 0.9) * amp + Math.sin(s * 0.17 + i) * amp * 0.4), y];
  }
  if (i === 3 || i === 5) {
    return [x, clamp01(0.5 + Math.cos(s * 0.36 + i * 0.8) * amp + Math.cos(s * 0.15 + i) * amp * 0.35)];
  }
  return [
    clamp01(0.5 + Math.sin(s * 0.42) * amp * 1.8 + Math.sin(s * 0.19 + 1.2) * amp * 0.7),
    clamp01(0.5 + Math.cos(s * 0.39) * amp * 1.6 + Math.cos(s * 0.21 + 0.7) * amp * 0.6)
  ];
}

function fogSpeed(fill: number, scrub: number): number {
  return 0.05 + Math.pow(fill, 1.35) * 6.15 + scrub * 1.6;
}

function fogAmp(fill: number, scrub: number): number {
  return 0.01 + Math.pow(fill, 1.25) * 0.175 + scrub * 0.04;
}

function LightAuraField(props: {
  intensity: SharedValue<number>;
  scrubbing: SharedValue<number>;
  borderRadius: number;
  active: boolean;
}) {
  const { intensity, scrubbing, borderRadius, active } = props;

  const [meshColors, setMeshColors] = useState(() => fogMeshColors(intensity.value, 0));
  const [meshPoints, setMeshPoints] = useState(() => FOG_MESH_BASE.map((p) => [...p] as number[]));
  const phaseRef = useRef(0);
  const lastTsRef = useRef(Date.now());
  const lastPaintRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let mounted = true;
    lastTsRef.current = Date.now();
    lastPaintRef.current = 0;

    const tick = () => {
      if (!mounted) return;
      const now = Date.now();
      const dt = Math.min(0.05, (now - lastTsRef.current) / 1000);
      lastTsRef.current = now;

      const fill = intensity.value;
      const scrub = scrubbing.value;
      phaseRef.current += dt * fogSpeed(fill, scrub);

      // 相位仍按真时间积分，只降低 React 提交频率
      if (now - lastPaintRef.current >= LIGHT_FRAME_MS) {
        lastPaintRef.current = now;
        const s = phaseRef.current;
        setMeshPoints(FOG_MESH_BASE.map(([x, y], i) => deformFogPoint(i, x, y, s, fogAmp(fill, scrub))));
        setMeshColors(fogMeshColors(fill, s));
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [active, intensity, scrubbing]);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius, overflow: 'hidden' }]}
    >
      <MeshGradientView
        style={StyleSheet.absoluteFill}
        columns={3}
        rows={3}
        colors={meshColors}
        points={meshPoints}
        smoothsColors
      />
    </View>
  );
}

/**
 * 待机胶囊光效：深色 = Skia 粒子；浅色 = Mesh 淡彩雾。
 */
export function IdlePillAuraField(props: IdlePillAuraFieldProps) {
  const {
    intensity,
    scrubbing,
    width,
    height,
    borderRadius = 26,
    isDark = false,
    active = true
  } = props;

  if (width < 40 || height < 20) return null;

  if (isDark) {
    return (
      <DarkParticleField
        intensity={intensity}
        scrubbing={scrubbing}
        width={width}
        height={height}
        borderRadius={borderRadius}
        active={active}
      />
    );
  }

  return (
    <LightAuraField
      intensity={intensity}
      scrubbing={scrubbing}
      borderRadius={borderRadius}
      active={active}
    />
  );
}

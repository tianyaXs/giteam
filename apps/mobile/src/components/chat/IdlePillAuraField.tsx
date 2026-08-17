import {
  BlurMask,
  Canvas,
  Circle,
  Fill,
  Group,
  Rect,
  Shader,
  Skia,
  interpolateColors
} from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import {
  FrameInfo,
  SharedValue,
  interpolateColor,
  useDerivedValue,
  useFrameCallback,
  useSharedValue
} from 'react-native-reanimated';
import { IDLE_BG_STOPS_DARK, IDLE_BG_STOPS_LIGHT, IDLE_INTENSITY_STOPS } from './thinkingLevels';

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

/** 深色粒子数量：略减以降低每帧 draw call，观感仍够。 */
const COUNT = 36;
/** 浅色雾：待机低频；scrub 时稍高。勿跑满 60fps（RuntimeShader 全片刷新很贵）。 */
const LIGHT_FOG_IDLE_DT = 1 / 18;
const LIGHT_FOG_SCRUB_DT = 1 / 28;
/** 深色粒子同样限帧，避免后台/待机常驻吃 GPU。 */
const DARK_PARTICLE_IDLE_DT = 1 / 24;
const DARK_PARTICLE_SCRUB_DT = 1 / 36;

/**
 * 浅色 3×3 油膜雾（Skia RuntimeShader）。
 * 对齐原 MeshGradient 思路，避免 expo-mesh-gradient 在低端机渲黑。
 */
const LIGHT_FOG_SKSL = `
uniform float2 u_size;
uniform float u_t;
uniform float u_fill;
uniform float u_scrub;

float3 lerp3(float3 a, float3 b, float t) {
  return mix(a, b, clamp(t, 0.0, 1.0));
}

float3 samplePearl(float u) {
  float x = fract(u) * 4.0;
  float i = floor(x);
  float f = fract(x);
  float3 a = i < 1.0 ? float3(0.961, 0.969, 0.984)
           : i < 2.0 ? float3(0.965, 0.961, 0.976)
           : i < 3.0 ? float3(0.973, 0.961, 0.969)
                     : float3(0.957, 0.969, 0.961);
  float3 b = i < 1.0 ? float3(0.965, 0.961, 0.976)
           : i < 2.0 ? float3(0.973, 0.961, 0.969)
           : i < 3.0 ? float3(0.957, 0.969, 0.961)
                     : float3(0.961, 0.969, 0.984);
  return lerp3(a, b, f);
}

float3 sampleTint(float u) {
  float x = fract(u) * 4.0;
  float i = floor(x);
  float f = fract(x);
  float3 a = i < 1.0 ? float3(0.749, 0.847, 0.961)
           : i < 2.0 ? float3(0.784, 0.753, 0.933)
           : i < 3.0 ? float3(0.875, 0.753, 0.894)
                     : float3(0.722, 0.878, 0.800);
  float3 b = i < 1.0 ? float3(0.784, 0.753, 0.933)
           : i < 2.0 ? float3(0.875, 0.753, 0.894)
           : i < 3.0 ? float3(0.722, 0.878, 0.800)
                     : float3(0.749, 0.847, 0.961);
  return lerp3(a, b, f);
}

float3 cellColor(float idx, float fill, float phase) {
  float depth = 0.06 + pow(clamp(fill, 0.0, 1.0), 1.15) * 0.78;
  float drift = 0.02 + fill * 0.08;
  float u = idx * 0.19 + phase * drift * (0.5 + idx * 0.04);
  return lerp3(samplePearl(u), sampleTint(u + 0.08), depth);
}

half4 main(float2 xy) {
  float2 uv = xy / max(u_size, float2(1.0, 1.0));
  float amp = 0.01 + pow(clamp(u_fill, 0.0, 1.0), 1.25) * 0.175 + u_scrub * 0.04;
  float2 w = uv;
  w.x += sin(u_t * 0.42 + uv.y * 2.6) * amp * 1.15 + sin(u_t * 0.17 + 1.1) * amp * 0.35;
  w.y += cos(u_t * 0.39 + uv.x * 2.3) * amp + cos(u_t * 0.21 + 0.7) * amp * 0.3;
  w = clamp(w, float2(0.0), float2(1.0));

  // 3×3 控制点 → 2×2 四边形双线性
  float2 g = w * 2.0;
  float ix = min(floor(g.x), 1.0);
  float iy = min(floor(g.y), 1.0);
  float2 f = float2(g.x - ix, g.y - iy);
  f = f * f * (3.0 - 2.0 * f);

  float i0 = iy * 3.0 + ix;
  float i1 = i0 + 1.0;
  float i2 = i0 + 3.0;
  float i3 = i0 + 4.0;

  float3 c00 = cellColor(i0, u_fill, u_t);
  float3 c10 = cellColor(i1, u_fill, u_t);
  float3 c01 = cellColor(i2, u_fill, u_t);
  float3 c11 = cellColor(i3, u_fill, u_t);

  float3 col = lerp3(lerp3(c00, c10, f.x), lerp3(c01, c11, f.x), f.y);
  return half4(col, 1.0);
}
`;

const lightFogEffect = (() => {
  try {
    return Skia.RuntimeEffect.Make(LIGHT_FOG_SKSL);
  } catch {
    return null;
  }
})();

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

/** 同步 frame callback 与前台/active，避免进后台仍刷 Skia。 */
function useAuraFrameGate(active: boolean, setActive: (v: boolean) => void) {
  const setActiveRef = useRef(setActive);
  setActiveRef.current = setActive;
  useEffect(() => {
    const sync = (state: AppStateStatus) => {
      setActiveRef.current(!!active && state === 'active');
    };
    sync(AppState.currentState);
    const sub = AppState.addEventListener('change', sync);
    return () => {
      sub.remove();
      setActiveRef.current(false);
    };
  }, [active]);
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
  const frameAcc = useSharedValue(0);
  const onFrame = useCallback(
    (info: FrameInfo) => {
      'worklet';
      const rawDt = info.timeSincePreviousFrame;
      const dt = Math.min(0.05, (rawDt == null || rawDt <= 0 ? 16 : rawDt) / 1000);
      frameAcc.value += dt;
      const step = scrubbing.value > 0.04 ? DARK_PARTICLE_SCRUB_DT : DARK_PARTICLE_IDLE_DT;
      if (frameAcc.value < step) return;
      const advance = frameAcc.value;
      frameAcc.value = 0;
      phase.value += advance * speedMulParticles(intensity.value, scrubbing.value);
    },
    [frameAcc, intensity, phase, scrubbing]
  );
  const frameCb = useFrameCallback(onFrame, false);
  useAuraFrameGate(active, frameCb.setActive);

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
      {!active ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: IDLE_BG_STOPS_DARK[Math.min(IDLE_BG_STOPS_DARK.length - 1, 1)] }
          ]}
        />
      ) : (
        <Canvas style={{ width, height }}>
          <Rect x={0} y={0} width={width} height={height} color={pillBg} />
          <Group blendMode="plus">{dots}</Group>
        </Canvas>
      )}
    </View>
  );
}

function fogSpeed(fill: number, scrub: number): number {
  'worklet';
  // 略降基础转速：限帧后观感仍顺，GPU 压力更小
  return 0.04 + Math.pow(fill, 1.35) * 4.8 + scrub * 1.35;
}

/** 浅色：Skia RuntimeShader 油膜雾；编译失败则退回近白实心底。 */
function LightAuraField(props: {
  intensity: SharedValue<number>;
  scrubbing: SharedValue<number>;
  width: number;
  height: number;
  borderRadius: number;
  active: boolean;
}) {
  const { intensity, scrubbing, width, height, borderRadius, active } = props;
  const phase = useSharedValue(0);
  const frameAcc = useSharedValue(0);

  const onFrame = useCallback(
    (info: FrameInfo) => {
      'worklet';
      const rawDt = info.timeSincePreviousFrame;
      const dt = Math.min(0.05, (rawDt == null || rawDt <= 0 ? 16 : rawDt) / 1000);
      frameAcc.value += dt;
      const step = scrubbing.value > 0.04 ? LIGHT_FOG_SCRUB_DT : LIGHT_FOG_IDLE_DT;
      if (frameAcc.value < step) return;
      const advance = frameAcc.value;
      frameAcc.value = 0;
      phase.value += advance * fogSpeed(intensity.value, scrubbing.value);
    },
    [frameAcc, intensity, phase, scrubbing]
  );
  const frameCb = useFrameCallback(onFrame, false);
  useAuraFrameGate(active, frameCb.setActive);

  const uniforms = useDerivedValue(() => ({
    u_size: [width, height],
    u_t: phase.value,
    u_fill: intensity.value,
    u_scrub: scrubbing.value
  }));

  const fallbackBg = useDerivedValue(() =>
    interpolateColor(intensity.value, IDLE_INTENSITY_STOPS, IDLE_BG_STOPS_LIGHT)
  );

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius, overflow: 'hidden' }]}
    >
      {/* 非待机：卸掉 Canvas，只留近似底色，避免隐藏态仍占 GPU */}
      {!active ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: IDLE_BG_STOPS_LIGHT[Math.min(IDLE_BG_STOPS_LIGHT.length - 1, 1)] }
          ]}
        />
      ) : (
        <Canvas style={{ width, height }}>
          {lightFogEffect ? (
            <Fill>
              <Shader source={lightFogEffect} uniforms={uniforms} />
            </Fill>
          ) : (
            <Rect x={0} y={0} width={width} height={height} color={fallbackBg} />
          )}
        </Canvas>
      )}
    </View>
  );
}

/**
 * 待机胶囊光效：深色 = Skia 粒子；浅色 = Skia RuntimeShader 雾（替代 MeshGradient）。
 * 帧回调限频 + App 进后台暂停；浅色非待机卸载 Canvas。
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
      width={width}
      height={height}
      borderRadius={borderRadius}
      active={active}
    />
  );
}

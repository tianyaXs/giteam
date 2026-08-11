import { MeshGradientView } from 'expo-mesh-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FrameInfo,
  SharedValue,
  interpolateColor,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue
} from 'react-native-reanimated';

type ReasoningParticleFieldProps = {
  /** 0..1 */
  intensity: SharedValue<number>;
  /** 调节中：粒子更醒目、节奏加快 */
  scrubbing: SharedValue<number>;
  width: number;
  height: number;
  borderRadius?: number;
  isDark?: boolean;
  /** 展开输入时暂停，避免后台空转 + 收回时不必重挂载 */
  active?: boolean;
};

type ParticleSeed = {
  key: string;
  ax: number;
  ay: number;
  size: number;
  phase: number;
  speed: number;
  kind: 'glow' | 'dot' | 'spark';
  hue: number;
};

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildParticles(): ParticleSeed[] {
  const list: ParticleSeed[] = [];
  // 手机端：约 32 粒足够，原 84 粒每帧驱动过重
  const cols = 8;
  const rows = 4;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i = row * cols + col;
      const jitterX = (hash01(i * 3.1) - 0.5) * 0.05;
      const jitterY = (hash01(i * 5.7) - 0.5) * 0.09;
      const ax = 0.34 + (col / Math.max(1, cols - 1)) * 0.62 + jitterX;
      const ay = 0.16 + (row / Math.max(1, rows - 1)) * 0.68 + jitterY;
      const roll = hash01(i * 9.3);
      const kind: ParticleSeed['kind'] = roll > 0.88 ? 'glow' : roll > 0.7 ? 'spark' : 'dot';
      list.push({
        key: `p-${i}`,
        ax: Math.min(0.96, Math.max(0.3, ax)),
        ay: Math.min(0.88, Math.max(0.1, ay)),
        size: kind === 'glow' ? 18 + hash01(i) * 16 : kind === 'spark' ? 3 + hash01(i) * 2.5 : 3.2 + hash01(i) * 2.8,
        phase: hash01(i * 2.2) * Math.PI * 2,
        speed: 0.7 + hash01(i * 4.4) * 1.3,
        kind,
        hue: hash01(i * 1.7)
      });
    }
  }
  return list;
}

const PARTICLES = buildParticles();
const BASE_MESH_POINTS = [
  [0.0, 0.0],
  [0.5, 0.0],
  [1.0, 0.0],
  [0.0, 0.5],
  [0.55, 0.45],
  [1.0, 0.5],
  [0.0, 1.0],
  [0.5, 1.0],
  [1.0, 1.0]
];

/** 与 IdleReasoningPill 底色同系的统一色雾（随强度变，九格同色免左右断裂） */
function meshColorsFor(intensity: number, isDark: boolean): string[] {
  const t = Math.max(0, Math.min(1, intensity));
  if (isDark) {
    const r = Math.round(47 + (42 - 47) * t + (50 - 42) * Math.max(0, t - 0.55) * 2);
    const g = Math.round(47 + (58 - 47) * Math.min(1, t * 1.2) + (42 - 58) * Math.max(0, t - 0.55) * 2);
    const b = Math.round(51 + (98 - 51) * t);
    const base = `rgb(${r},${g},${b})`;
    const lift = `rgb(${Math.min(255, r + 10)},${Math.min(255, g + 12)},${Math.min(255, b + 14)})`;
    return [base, lift, base, lift, base, lift, base, lift, base];
  }
  const r = Math.round(232 + (220 - 232) * Math.min(1, t * 1.15) + (230 - 220) * Math.max(0, t - 0.55) * 2);
  const g = Math.round(232 + (224 - 232) * Math.max(0, t - 0.55) * 2);
  const b = Math.round(237 + (255 - 237) * Math.min(1, t));
  const base = `rgb(${r},${g},${b})`;
  const lift = `rgb(${Math.max(0, r - 6)},${Math.max(0, g - 2)},${Math.min(255, b + 4)})`;
  return [base, lift, base, lift, base, lift, base, lift, base];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** 强度 → 角速度（档位差要明显） */
function speedMulAt(fill: number, scrub: number): number {
  'worklet';
  // off≈0.3 · medium≈1.6 · xhigh≈3.2 · 调节中再加速
  return 0.3 + fill * 2.9 + scrub * 1.1;
}

/**
 * 推理粒子场：
 * - 底色随强度变（mesh + 胶囊底）
 * - 相位积分：切强度只改速度，不抖相位
 */
export function ReasoningParticleField(props: ReasoningParticleFieldProps) {
  const {
    intensity,
    scrubbing,
    width,
    height,
    borderRadius = 26,
    isDark = false,
    active = true
  } = props;

  const phase = useSharedValue(0);
  const onFrame = useCallback(
    (info: FrameInfo) => {
      'worklet';
      const rawDt = info.timeSincePreviousFrame;
      const dt = Math.min(0.05, (rawDt == null || rawDt <= 0 ? 16 : rawDt) / 1000);
      phase.value = phase.value + dt * speedMulAt(intensity.value, scrubbing.value);
    },
    [intensity, phase, scrubbing]
  );
  // 第 2 参只是挂载时的 autostart。用 ref 调 setActive，避免 frameCb 引用变化导致 effect 反复 false/true 抖停。
  const frameCb = useFrameCallback(onFrame, false);
  const setFrameActiveRef = useRef(frameCb.setActive);
  setFrameActiveRef.current = frameCb.setActive;
  useEffect(() => {
    setFrameActiveRef.current(!!active);
    return () => {
      setFrameActiveRef.current(false);
    };
  }, [active]);

  if (width < 40 || height < 20) return null;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { borderRadius, overflow: 'hidden' }]}
    >
      <MeshAura intensity={intensity} scrubbing={scrubbing} isDark={isDark} active={active} />

      {PARTICLES.map((seed) => (
        <SoftParticle
          key={seed.key}
          seed={seed}
          width={width}
          height={height}
          intensity={intensity}
          scrubbing={scrubbing}
          phase={phase}
          isDark={isDark}
        />
      ))}
    </View>
  );
}

function MeshAura(props: {
  intensity: SharedValue<number>;
  scrubbing: SharedValue<number>;
  isDark: boolean;
  active: boolean;
}) {
  const { intensity, scrubbing, isDark, active } = props;
  const [meshColors, setMeshColors] = useState(() => meshColorsFor(intensity.value, isDark));
  const [meshPoints, setMeshPoints] = useState(() => BASE_MESH_POINTS.map((p) => [...p]));
  const meshPhaseRef = useRef(0);
  const lastTsRef = useRef(Date.now());
  const lastColorKey = useRef('');
  const atBaseRef = useRef(true);

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const id = setInterval(() => {
      if (!mounted) return;
      const t = intensity.value;
      const key = `${isDark}:${Math.round(t * 40)}`;
      if (key === lastColorKey.current) return;
      lastColorKey.current = key;
      setMeshColors(meshColorsFor(t, isDark));
    }, 180);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [active, intensity, isDark]);

  useEffect(() => {
    if (!active) return;
    let timer = 0;
    let mounted = true;
    lastTsRef.current = Date.now();
    const tick = () => {
      if (!mounted) return;
      const scrub = scrubbing.value;
      // 非调节态：停在基点，避免 MeshGradient 每帧 React 重绘
      if (scrub < 0.04) {
        if (!atBaseRef.current) {
          atBaseRef.current = true;
          setMeshPoints(BASE_MESH_POINTS.map((p) => [...p]));
        }
        timer = setTimeout(tick, 280) as unknown as number;
        return;
      }
      atBaseRef.current = false;
      const now = Date.now();
      const dt = Math.min(0.08, (now - lastTsRef.current) / 1000);
      lastTsRef.current = now;
      meshPhaseRef.current += dt * speedMulAt(intensity.value, scrub);
      const s = meshPhaseRef.current;
      const amp = 0.014;
      setMeshPoints(
        BASE_MESH_POINTS.map(([x, y], i) => [
          clamp01(x + Math.sin(s * (0.55 + i * 0.07) + i) * amp),
          clamp01(y + Math.cos(s * (0.45 + i * 0.05) + i * 0.7) * amp)
        ])
      );
      timer = setTimeout(tick, 160) as unknown as number;
    };
    tick();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [active, intensity, scrubbing]);

  return (
    <MeshGradientView
      style={StyleSheet.absoluteFill}
      columns={3}
      rows={3}
      colors={meshColors}
      points={meshPoints}
      smoothsColors
    />
  );
}

const SoftParticle = React.memo(function SoftParticle(props: {
  seed: ParticleSeed;
  width: number;
  height: number;
  intensity: SharedValue<number>;
  scrubbing: SharedValue<number>;
  phase: SharedValue<number>;
  isDark: boolean;
}) {
  const { seed, width, height, intensity, scrubbing, phase, isDark } = props;
  const baseLeft = seed.ax * width;
  const baseTop = seed.ay * height;
  const size = seed.size;

  const style = useAnimatedStyle(() => {
    const fill = intensity.value;
    const scrub = scrubbing.value;
    // 积分相位：只改角速度，采样连续
    const t = phase.value;
    const wave = Math.sin(t * seed.speed + seed.phase);
    const wave2 = Math.cos(t * seed.speed * 0.85 + seed.phase * 1.3);
    const breathWave = Math.sin(t * 0.45 + seed.hue * Math.PI * 2);

    const edgeX = softEdge(seed.ax, 0.32, 0.97);
    const edgeY = softEdge(seed.ay, 0.08, 0.92);
    const pulse = 0.62 + 0.38 * wave + 0.08 * breathWave;

    // 强度影响可见度（平滑），不改位移振幅公式里的 speed
    const baseOp =
      seed.kind === 'glow' ? 0.14 + fill * 0.36 : seed.kind === 'spark' ? 0.26 + fill * 0.5 : 0.22 + fill * 0.58;
    const opacity = Math.min(0.95, Math.max(0.05, baseOp * edgeX * edgeY * pulse * (0.8 + scrub * 0.25)));

    // 振幅随强度缓变（连续 fill），避免档位跳变抖一下
    const ampX = (3.5 + fill * 5 + scrub * 4) * (seed.kind === 'glow' ? 0.5 : 1);
    const ampY = (2.5 + fill * 4 + scrub * 3) * (seed.kind === 'glow' ? 0.45 : 1);
    const scale = 0.88 + fill * 0.1 + Math.max(0, wave) * (0.08 + scrub * 0.08);

    const tint =
      seed.kind === 'dot'
        ? interpolateColor(
            fill,
            [0, 0.35, 0.65, 1],
            isDark
              ? ['#6A7388', '#7FA0E8', '#A78BFA', '#C4B5FD']
              : ['#9AA6BC', '#7BA3F0', '#8B7CF0', '#A78BFA']
          )
        : seed.kind === 'glow'
          ? interpolateColor(
              fill,
              [0, 0.5, 1],
              isDark
                ? ['rgba(91,184,255,0.35)', 'rgba(123,108,255,0.5)', 'rgba(196,75,255,0.55)']
                : ['rgba(126,182,255,0.35)', 'rgba(139,156,255,0.48)', 'rgba(183,148,246,0.55)']
            )
          : interpolateColor(
              fill,
              [0, 1],
              isDark ? ['#9ED0FF', '#E0A0FF'] : ['#6B9CFF', '#A78BFA']
            );

    return {
      opacity,
      backgroundColor: tint,
      transform: [{ translateX: wave * ampX }, { translateY: wave2 * ampY }, { scale }]
    };
  });

  const radius = seed.kind === 'glow' ? size / 2 : seed.kind === 'spark' ? size / 2 : 1.2;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: baseLeft - size / 2,
          top: baseTop - size / 2,
          width: size,
          height: size,
          borderRadius: radius
        },
        style
      ]}
    />
  );
});

function softEdge(v: number, lo: number, hi: number): number {
  'worklet';
  if (v < lo) return Math.max(0, v / Math.max(0.001, lo));
  if (v > hi) return Math.max(0, (1 - v) / Math.max(0.001, 1 - hi));
  const innerLo = lo + 0.08;
  const innerHi = hi - 0.06;
  if (v < innerLo) return 0.35 + 0.65 * ((v - lo) / Math.max(0.001, innerLo - lo));
  if (v > innerHi) return 0.35 + 0.65 * ((hi - v) / Math.max(0.001, hi - innerHi));
  return 1;
}

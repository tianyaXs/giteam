import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createDroplets,
  supportsHtmlInCanvas,
  type DropletsOptions,
} from "@/components/canvasui/Droplets";
import {
  createClouds,
  type CloudsOptions,
} from "@/components/canvasui/Clouds";
import {
  createFrost,
  type FrostOptions,
} from "@/components/canvasui/Frost";

export type ContentProtectEffect = "droplets" | "clouds" | "frost";

const IDLE_MS_DEFAULT = 5000;
const ENTER_MS = 1400;
/** 冰霜靠边缘 intro 结冰，进场约 10s。 */
const FROST_ENTER_MS = 10000;
const EXIT_MS = 700;
const CAPTURE_TIMEOUT_MS = 4000;
const WARM_LEAD_MS = 1200;

/**
 * 活动语义：滚动也算活动。
 * 否则 mid-scroll warm 的底板会在用户继续滚之后过期，进场折射错位。
 */
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "pointerdown",
  "keydown",
  "touchstart",
  "wheel",
  "scroll",
];

/** 水滴：对齐官方 Demo + 稍强雾面保护。 */
const DROPLETS_DEMO = {
  intensity: 0.55,
  speed: 1,
  scale: 0.4,
  dropWidth: 1.05,
  dropLength: 1,
  refraction: 0.3,
  blur: 4.0,
  vignette: 0.06,
  fallSpeed: 1,
  wiggle: 1,
  staticDrops: 0.7,
  interactive: true,
  interactionRadius: 0.3,
  interactionStrength: 0.6,
  interactionDistortion: 3,
} as const;

/** 云雾：略抬 cover/opacity/fogBlur，保证空闲时能遮住内容。 */
const CLOUDS_DEMO = {
  scale: 1.05,
  speed: 0.55,
  cover: 0.28,
  density: 3.0,
  shading: 0.14,
  color: "auto" as const,
  opacity: 0.78,
  shadow: 0.1,
  shadowOffsetX: 180,
  shadowOffsetY: -8,
  shadowSoftness: 1,
  wind: 0.7,
  windRadius: 300,
  refraction: 14,
  fogBlur: 0.55,
  quality: 0.85,
};

/** 冰霜：保留官方边缘→中心 intro，IdleDroplets 只错开雾气/结冰强度。 */
const FROST_DEMO = {
  frost: 0.12,
  strength: 0.85,
  contrast: 3.2,
  crispness: 1.1,
  highlight: 0.35,
  highlightStrength: 0.85,
  haze: 0.7,
  tintThin: [0.82, 0.86, 1.05] as [number, number, number],
  tintThick: [0.92, 0.96, 1.1] as [number, number, number],
  tintStrength: 0.35,
  saturation: 1.15,
  brightness: 0.82,
  refraction: 1,
  ior: 1.31,
  detail: 2,
  textureScale: 2,
  fresnel: 0.85,
  meltRadius: 0.28,
  meltNoise: 0.28,
  meltStrength: 0.8,
  refreeze: 2.2,
  edgeFade: 0.08,
  meltEdges: true,
  introDuration: 10,
  opacity: 0.82,
  shimmer: 0.05,
  quality: 0.85,
};

type ProtectOptions = DropletsOptions | CloudsOptions | FrostOptions;

type ProtectInstance = {
  setOptions: (options: ProtectOptions) => void;
  hasContent: () => boolean;
  destroy: () => void;
};

const emptySubscribe = () => () => {};

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number) {
  return t * t * t;
}

function dropletsAtProgress(progress: number): DropletsOptions {
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0.001) {
    return {
      ...DROPLETS_DEMO,
      intensity: 0,
      blur: 0,
      staticDrops: 0,
      refraction: 0,
      vignette: 0,
    };
  }
  const t = easeInOutCubic(p);
  const effect = Math.max(0, (t - 0.05) / 0.95);
  const fog = Math.min(1, effect * 1.15);
  const rain = Math.min(1, Math.max(0, (effect - 0.08) / 0.82));
  return {
    ...DROPLETS_DEMO,
    intensity: DROPLETS_DEMO.intensity * rain,
    blur: DROPLETS_DEMO.blur * fog,
    staticDrops: DROPLETS_DEMO.staticDrops * Math.max(fog * 0.6, rain),
    refraction: DROPLETS_DEMO.refraction * Math.max(fog * 0.45, rain),
    vignette: DROPLETS_DEMO.vignette * fog,
    fallSpeed: 0.55 + 0.45 * rain,
  };
}

function cloudsAtProgress(progress: number): CloudsOptions {
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0.001) {
    return {
      ...CLOUDS_DEMO,
      cover: 0,
      opacity: 0,
      shadow: 0,
      fogBlur: 0,
      refraction: 0,
      wind: 0,
    };
  }
  const t = easeInOutCubic(p);
  const effect = Math.max(0, (t - 0.05) / 0.95);
  const fog = Math.min(1, effect * 1.15);
  const wind = Math.min(1, Math.max(0, (effect - 0.12) / 0.88));
  return {
    ...CLOUDS_DEMO,
    cover: CLOUDS_DEMO.cover * fog,
    opacity: CLOUDS_DEMO.opacity * fog,
    shadow: CLOUDS_DEMO.shadow * fog,
    fogBlur: CLOUDS_DEMO.fogBlur * fog,
    refraction: CLOUDS_DEMO.refraction * fog,
    wind: CLOUDS_DEMO.wind * wind,
  };
}

function frostAtProgress(progress: number): FrostOptions {
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0.001) {
    return {
      ...FROST_DEMO,
      frost: 0,
      strength: 0,
      haze: 0,
      opacity: 0,
      refraction: 0,
      meltStrength: 0,
      shimmer: 0,
    };
  }
  // 先薄雾铺开，结冰明显延后；曲线更慢，避免前半段就冻满。
  const hazeT = easeOutCubic(Math.min(1, p / 0.65));
  const iceT = easeInCubic(Math.max(0, (p - 0.28) / 0.72));
  const bodyT = easeInCubic(Math.max(0, (p - 0.12) / 0.88));
  const meltT = Math.max(0, (p - 0.7) / 0.3);
  return {
    ...FROST_DEMO,
    haze: FROST_DEMO.haze * (0.15 + 0.85 * hazeT),
    opacity: FROST_DEMO.opacity * (0.08 + 0.92 * easeInOutCubic(bodyT)),
    frost: FROST_DEMO.frost * iceT,
    strength: FROST_DEMO.strength * iceT,
    refraction: FROST_DEMO.refraction * iceT,
    meltStrength: FROST_DEMO.meltStrength * meltT,
    shimmer: FROST_DEMO.shimmer * iceT,
  };
}

function optionsAtProgress(
  effect: ContentProtectEffect,
  progress: number,
): ProtectOptions {
  if (effect === "clouds") return cloudsAtProgress(progress);
  if (effect === "frost") return frostAtProgress(progress);
  return dropletsAtProgress(progress);
}

function isUsablePlate(canvas: HTMLCanvasElement | null | undefined) {
  return Boolean(canvas && canvas.width >= 2 && canvas.height >= 2);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`snapshot timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to decode viewport snapshot"));
    img.src = src;
  });
}

/**
 * 把视口真像素烙成 canvas 底板。
 * Tauri/WKWebView：WebView takeSnapshot（所见即所得，含 Virtuoso 可视区）。
 */
async function captureViewportPlate(): Promise<HTMLCanvasElement | null> {
  try {
    const dataUrl = await withTimeout(
      invoke<string>("capture_main_viewport"),
      CAPTURE_TIMEOUT_MS,
    );
    if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;
    const img = await loadImage(dataUrl);
    if (img.naturalWidth < 2 || img.naturalHeight < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas;
  } catch (err) {
    console.warn("[IdleDroplets] viewport snapshot failed", err);
    return null;
  }
}

function createProtectEffect(
  effect: ContentProtectEffect,
  elements: {
    source: HTMLCanvasElement;
    content: HTMLElement;
    output: HTMLCanvasElement;
    contentImage: HTMLCanvasElement | null;
  },
  options: ProtectOptions,
): ProtectInstance | null {
  if (effect === "clouds") {
    return createClouds(elements, options as CloudsOptions);
  }
  if (effect === "frost") {
    return createFrost(elements, options as FrostOptions);
  }
  return createDroplets(elements, options as DropletsOptions);
}

type IdleDropletsProps = {
  children: ReactNode;
  enabled?: boolean;
  idleMs?: number;
  /** 内容保护视觉：水滴 / 云雾 / 冰霜。 */
  effect?: ContentProtectEffect;
  className?: string;
};

/**
 * 空闲内容保护。
 *
 * 进场契约：先拿到当前视口底板，再挂 WebGL 效果渐入；
 * 抓板失败 → 仅 CSS 遮罩。
 */
export function IdleDroplets({
  children,
  enabled = true,
  idleMs = IDLE_MS_DEFAULT,
  effect = "droplets",
  className,
}: IdleDropletsProps) {
  const [wantActive, setWantActive] = useState(false);
  const [canvasVisible, setCanvasVisible] = useState(false);
  const [hasPlate, setHasPlate] = useState(false);
  const [cssFog, setCssFog] = useState(0);

  const native = useSyncExternalStore(
    emptySubscribe,
    () => supportsHtmlInCanvas(),
    () => false,
  );

  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const outputRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<ProtectInstance | null>(null);
  const plateCacheRef = useRef<HTMLCanvasElement | null>(null);
  const plateWarmingRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const warmTimerRef = useRef<number | null>(null);
  const animRafRef = useRef(0);
  const bootGenRef = useRef(0);
  const progressRef = useRef(0);
  const wantActiveRef = useRef(false);
  const enabledRef = useRef(enabled);
  const effectRef = useRef(effect);

  wantActiveRef.current = wantActive;
  enabledRef.current = enabled;
  effectRef.current = effect;

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enterMs = reducedMotion
    ? 0
    : effect === "frost"
      ? FROST_ENTER_MS
      : ENTER_MS;
  const exitMs = reducedMotion ? 0 : EXIT_MS;

  const clearIdleTimer = () => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const clearWarmTimer = () => {
    if (warmTimerRef.current != null) {
      window.clearTimeout(warmTimerRef.current);
      warmTimerRef.current = null;
    }
  };

  const invalidatePlateCache = () => {
    plateCacheRef.current = null;
  };

  const stopAnim = () => {
    if (animRafRef.current) {
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = 0;
    }
  };

  /** 空闲前预热：原生视口截帧，到点可直接进场。 */
  const warmPlate = () => {
    clearWarmTimer();
    if (!enabledRef.current || wantActiveRef.current || native) return;
    const lead = Math.max(400, Math.min(WARM_LEAD_MS, Math.max(1000, idleMs) - 800));
    warmTimerRef.current = window.setTimeout(() => {
      if (wantActiveRef.current || !enabledRef.current || plateWarmingRef.current) return;
      plateWarmingRef.current = true;
      void captureViewportPlate()
        .then((plate) => {
          if (plate && !wantActiveRef.current) plateCacheRef.current = plate;
        })
        .finally(() => {
          plateWarmingRef.current = false;
        });
    }, Math.max(0, Math.max(1000, idleMs) - lead));
  };

  const armIdleTimer = () => {
    clearIdleTimer();
    clearWarmTimer();
    invalidatePlateCache();
    if (!enabledRef.current) return;
    warmPlate();
    idleTimerRef.current = window.setTimeout(() => {
      if (!enabledRef.current) return;
      setWantActive(true);
    }, Math.max(1000, idleMs));
  };

  const applyProgress = (progress: number, fadeOutput: boolean) => {
    progressRef.current = progress;
    const has = Boolean(instanceRef.current?.hasContent());
    setHasPlate(has);
    setCssFog(has ? 0 : progress);
    instanceRef.current?.setOptions(
      optionsAtProgress(effectRef.current, progress),
    );
    const output = outputRef.current;
    if (!output) return;
    if (!instanceRef.current?.hasContent()) {
      output.style.opacity = "0";
      return;
    }
    output.style.opacity = fadeOutput
      ? String(easeInOutCubic(progress))
      : String(easeInOutCubic(Math.max(progress, 0.001)));
  };

  const animateProgress = (
    from: number,
    to: number,
    durationMs: number,
    fadeOutput: boolean,
    onDone?: () => void,
  ) => {
    stopAnim();
    const start = performance.now();
    const span = to - from;
    const tick = (now: number) => {
      const u = durationMs <= 0 ? 1 : Math.min(1, (now - start) / durationMs);
      applyProgress(from + span * u, fadeOutput);
      if (u < 1) {
        animRafRef.current = requestAnimationFrame(tick);
        return;
      }
      animRafRef.current = 0;
      onDone?.();
    };
    animRafRef.current = requestAnimationFrame(tick);
  };

  const destroyInstance = () => {
    stopAnim();
    instanceRef.current?.destroy();
    instanceRef.current = null;
    progressRef.current = 0;
    setCanvasVisible(false);
    setCssFog(0);
    setHasPlate(false);
    const output = outputRef.current;
    if (output) output.style.opacity = "0";
  };

  useEffect(() => {
    if (!enabled) {
      clearIdleTimer();
      clearWarmTimer();
      setWantActive(false);
      destroyInstance();
      return;
    }

    setWantActive(false);
    destroyInstance();

    const onActivity = () => {
      setWantActive(false);
      armIdleTimer();
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { passive: true, capture: true });
    }

    armIdleTimer();
    return () => {
      clearIdleTimer();
      clearWarmTimer();
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, true);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idleMs, effect]);

  useEffect(() => {
    if (!enabled) return;

    if (!wantActive) {
      bootGenRef.current += 1;
      if (!instanceRef.current && cssFog <= 0) {
        destroyInstance();
        return;
      }
      const from = progressRef.current;
      if (!instanceRef.current) {
        const start = performance.now();
        const fromFog = cssFog;
        stopAnim();
        const tick = (now: number) => {
          const u = exitMs <= 0 ? 1 : Math.min(1, (now - start) / exitMs);
          setCssFog(fromFog * (1 - u));
          if (u < 1) {
            animRafRef.current = requestAnimationFrame(tick);
            return;
          }
          destroyInstance();
        };
        animRafRef.current = requestAnimationFrame(tick);
        return;
      }
      animateProgress(from, 0, exitMs * Math.max(0.2, from), true, () => {
        if (wantActiveRef.current) return;
        destroyInstance();
      });
      return;
    }

    const bootId = ++bootGenRef.current;

    if (instanceRef.current?.hasContent()) {
      setCanvasVisible(true);
      const from = progressRef.current;
      applyProgress(from, false);
      animateProgress(from, 1, enterMs * Math.max(0.2, 1 - from), false);
      return;
    }

    const boot = async () => {
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      if (!wantActiveRef.current || bootId !== bootGenRef.current) return;

      const source = sourceRef.current;
      const content = contentRef.current;
      const output = outputRef.current;
      if (!source || !content || !output) {
        setCssFog(1);
        return;
      }

      // 关键契约：先出板，再进场
      let plate: HTMLCanvasElement | null = plateCacheRef.current;
      plateCacheRef.current = null;

      if (!native && !isUsablePlate(plate)) {
        plate = await captureViewportPlate();
      }

      if (!wantActiveRef.current || bootId !== bootGenRef.current) return;

      const activeEffect = effectRef.current;

      if (native) {
        const instance = createProtectEffect(
          activeEffect,
          { source, content, output, contentImage: null },
          optionsAtProgress(activeEffect, 0),
        );
        if (!wantActiveRef.current || bootId !== bootGenRef.current) {
          instance?.destroy();
          return;
        }
        if (!instance) {
          setCssFog(1);
          return;
        }
        instanceRef.current = instance;
        setHasPlate(true);
        setCssFog(0);
        progressRef.current = 0;
        setCanvasVisible(true);
        applyProgress(0, false);
        output.style.opacity = "1";
        animateProgress(0, 1, enterMs, false);
        return;
      }

      if (!isUsablePlate(plate)) {
        setHasPlate(false);
        setCanvasVisible(false);
        setCssFog(1);
        return;
      }

      const instance = createProtectEffect(
        activeEffect,
        { source, content, output, contentImage: plate },
        optionsAtProgress(activeEffect, 0),
      );

      if (!wantActiveRef.current || bootId !== bootGenRef.current) {
        instance?.destroy();
        return;
      }

      if (!instance?.hasContent()) {
        instance?.destroy();
        setHasPlate(false);
        setCanvasVisible(false);
        setCssFog(1);
        return;
      }

      instanceRef.current = instance;
      setHasPlate(true);
      setCssFog(0);
      progressRef.current = 0;
      setCanvasVisible(true);
      applyProgress(0, false);
      output.style.opacity = "1";
      animateProgress(0, 1, enterMs, false);
    };

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantActive, native, enabled, enterMs, exitMs, effect]);

  useEffect(() => {
    return () => {
      bootGenRef.current += 1;
      clearIdleTimer();
      clearWarmTimer();
      destroyInstance();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const contentStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    filter:
      wantActive && cssFog > 0.001 && !hasPlate
        ? `blur(${(6 + 6 * cssFog).toFixed(1)}px) brightness(${(1 - 0.1 * cssFog).toFixed(3)})`
        : undefined,
    willChange: wantActive && !hasPlate ? "filter" : "auto",
  };

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%" }}
      data-idle-droplets={wantActive ? "active" : "idle"}
      data-idle-droplets-enabled={enabled ? "1" : "0"}
      data-idle-droplets-plate={hasPlate ? "1" : "0"}
      data-idle-droplets-native={native ? "1" : "0"}
      data-idle-droplets-effect={effect}
    >
      <canvas
        ref={sourceRef}
        // @ts-expect-error experimental html-in-canvas attribute
        layoutsubtree="true"
        style={
          native
            ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
            : { display: "none" }
        }
      >
        {native ? (
          <div ref={contentRef} style={contentStyle}>
            {children}
          </div>
        ) : null}
      </canvas>
      {!native ? (
        <div ref={contentRef} style={contentStyle}>
          {children}
        </div>
      ) : null}
      <canvas
        ref={outputRef}
        aria-hidden
        data-idle-droplets-ignore="1"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 40,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          opacity: 0,
          visibility: canvasVisible ? "visible" : "hidden",
          willChange: canvasVisible ? "opacity" : "auto",
        }}
      />
    </div>
  );
}

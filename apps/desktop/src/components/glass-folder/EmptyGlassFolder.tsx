"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

const W = 340;
const H = 272;
const HEADROOM = 54;
const OUTER_H = H + HEADROOM;
/** 与 GlassFolder 的 demo padding + slot padding-top 对齐，避免视觉上浮。 */
const SLOT_PAD_TOP = 18;
const DEMO_PAD_Y = 8;
const BACK_PATH =
  "M0 56A22 22 0 0 1 22 34L146 34C170 34 172 0 198 0L318 0A22 22 0 0 1 340 22L340 250A22 22 0 0 1 318 272L22 272A22 22 0 0 1 0 250Z";
const FRONT_PATH =
  "M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 176A22 22 0 0 1 318 198L22 198A22 22 0 0 1 0 176Z";

/**
 * 空玻璃文件夹：与 GlassFolder 同几何、同落点、同阴影，作为「添加项目」入口。
 */
export function EmptyGlassFolder(props: {
  className?: string;
  label?: string;
  hint?: string;
  /** 与 GlassFolder options.height 一致，默认 236。 */
  height?: number;
  onAdd?: () => void;
}) {
  const {
    className,
    label = "添加项目",
    hint = "导入本地仓库",
    height = 236,
    onAdd,
  } = props;
  const reduceMotion = useReducedMotion();
  const hostRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null);
  const uid = useId().replace(/:/g, "");
  const rimId = `egf-rim-${uid}`;
  const voidId = `egf-void-${uid}`;

  useLayoutEffect(() => {
    const host = hostRef.current;
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!host || !root || !stage) return;

    const sync = () => {
      const width = Math.max(1, Math.min(W, host.clientWidth || W));
      const k = width / W;
      root.style.width = `${width}px`;
      root.style.height = `${OUTER_H * k}px`;
      stage.style.transform = `translateY(${HEADROOM * k}px) scale(${k})`;
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={hostRef}
      type="button"
      className={["egf-host", className].filter(Boolean).join(" ")}
      aria-label={label}
      onClick={() => onAdd?.()}
      data-reduced-motion={reduceMotion ? "true" : "false"}
      style={{ height }}
    >
      <span className="egf-slot">
        <span className="egf-root" ref={rootRef}>
          <span className="egf-stage" ref={stageRef} aria-hidden>
            <span className="egf-tilt">
              <span className="egf-shadow" />

              <span className="egf-back">
                <svg className="egf-void" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={voidId} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#3a3c44" />
                      <stop offset=".45" stopColor="#1c1d22" />
                      <stop offset="1" stopColor="#0e0f12" />
                    </linearGradient>
                  </defs>
                  <rect width={W} height={H} fill={`url(#${voidId})`} />
                  <circle cx="250" cy="48" r="110" fill="rgba(255,255,255,.07)" />
                  <circle cx="70" cy="210" r="90" fill="rgba(255,255,255,.03)" />
                </svg>
                <span className="egf-back-sheen" />
              </span>

              <svg className="egf-rim egf-back-rim" viewBox={`0 0 ${W} ${H}`}>
                <path d={BACK_PATH} />
              </svg>

              {/* 静止时更深 tuck；外层 clip 避免底边吊出文件夹外 */}
              <span className="egf-files">
                <span className="egf-sheet">
                  <span className="egf-sheet-dash" />
                  <span className="egf-plus">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 6v12M6 12h12" />
                    </svg>
                  </span>
                </span>
              </span>

              <span className="egf-front">
                <span className="egf-tint" />
                <span className="egf-spec" />
                <svg className="egf-rim egf-front-rim" viewBox="0 0 340 198">
                  <defs>
                    <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#fff" stopOpacity=".95" />
                      <stop offset=".35" stopColor="#fff" stopOpacity=".35" />
                      <stop offset="1" stopColor="#fff" stopOpacity=".12" />
                    </linearGradient>
                  </defs>
                  <path d={FRONT_PATH} stroke={`url(#${rimId})`} />
                </svg>
                <span className="egf-label">
                  <span className="egf-title">{label}</span>
                  <span className="egf-meta">{hint}</span>
                </span>
              </span>
            </span>
          </span>
        </span>
      </span>

      <style>{`
        .egf-host {
          --egf-ease: cubic-bezier(.2, .8, .2, 1);
          --egf-spring: cubic-bezier(.34, 1.36, .5, 1);
          --egf-hinge: 0deg;
          --egf-lift: 64px;
          --egf-ink: #f5f5f7;
          --egf-ink-soft: rgba(245, 245, 247, .58);
          box-sizing: border-box;
          position: relative;
          display: block;
          width: 100%;
          max-width: 100%;
          margin: 0;
          padding: ${DEMO_PAD_Y}px 0 4px;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          overflow: visible;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          isolation: isolate;
          font-family: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .egf-host:hover,
        .egf-host:focus-visible {
          --egf-hinge: -11deg;
          --egf-lift: -12px;
        }
        .egf-host:focus-visible {
          outline: 2px solid color-mix(in srgb, #4c8dff 70%, transparent);
          outline-offset: 6px;
          border-radius: 18px;
        }
        .egf-slot {
          position: relative;
          display: block;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-top: ${SLOT_PAD_TOP}px;
        }
        .egf-root {
          position: relative;
          display: block;
        }
        .egf-stage {
          position: absolute;
          left: 0;
          top: 0;
          width: ${W}px;
          height: ${H}px;
          transform-origin: 0 0;
        }
        .egf-tilt {
          position: absolute;
          inset: 0;
        }
        .egf-shadow {
          position: absolute;
          left: 18px;
          right: 18px;
          bottom: -6px;
          height: 60px;
          border-radius: 40px;
          background: rgba(0, 0, 0, .62);
          filter: blur(22px);
        }
        .egf-back {
          position: absolute;
          inset: 0;
          overflow: hidden;
          clip-path: path("${BACK_PATH}");
          background: linear-gradient(180deg, #2a2a2e 0%, #121214 100%);
        }
        .egf-void {
          position: absolute;
          inset: 0;
          width: ${W}px;
          height: ${H}px;
          max-width: none;
        }
        .egf-back-sheen {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, rgba(255,255,255,.18) 0%, rgba(255,255,255,0) 22%),
            radial-gradient(120% 80% at 80% 0%, rgba(255,255,255,.14), rgba(255,255,255,0) 60%);
          pointer-events: none;
        }
        .egf-rim {
          position: absolute;
          left: 0;
          top: 0;
          overflow: visible;
          pointer-events: none;
          fill: none;
        }
        .egf-back-rim {
          width: ${W}px;
          height: ${H}px;
        }
        .egf-back-rim path {
          stroke: rgba(255,255,255,.16);
          stroke-width: 1;
        }
        .egf-files {
          position: absolute;
          inset: 0;
          z-index: 5;
          pointer-events: none;
          clip-path: inset(-400px -400px 12px -400px);
        }
        .egf-sheet {
          position: absolute;
          left: 34px;
          top: 96px;
          width: 272px;
          height: 184px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          background: linear-gradient(180deg, rgba(44,44,48,.72) 0%, rgba(28,28,32,.55) 100%);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.12),
            0 0 0 .5px rgba(255,255,255,.08),
            0 12px 28px -8px rgba(0,0,0,.55);
          transform-origin: 50% 100%;
          transform: translateY(var(--egf-lift));
          transition: transform .75s var(--egf-spring);
          pointer-events: none;
        }
        .egf-sheet-dash {
          position: absolute;
          inset: 14px;
          border-radius: 12px;
          border: 1.5px dashed rgba(255,255,255,.2);
          background: radial-gradient(70% 60% at 50% 45%, rgba(255,255,255,.04), transparent 72%);
        }
        .egf-plus {
          position: relative;
          z-index: 1;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          color: rgba(245,245,247,.82);
          background: rgba(255,255,255,.06);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.12);
          transition: transform .45s var(--egf-spring), background .35s var(--egf-ease), color .35s var(--egf-ease);
        }
        .egf-host:hover .egf-plus {
          transform: scale(1.05);
          background: rgba(255,255,255,.11);
          color: #fff;
        }
        .egf-plus svg {
          width: 20px;
          height: 20px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.6;
          stroke-linecap: round;
        }
        .egf-front {
          position: absolute;
          left: 0;
          top: 74px;
          width: ${W}px;
          height: 198px;
          z-index: 10;
          clip-path: path("${FRONT_PATH}");
          -webkit-backdrop-filter: blur(22px) saturate(1.5);
          backdrop-filter: blur(22px) saturate(1.5);
          transform-origin: 50% 100%;
          transform: perspective(760px) rotateX(var(--egf-hinge));
          transition: transform .8s var(--egf-spring);
        }
        .egf-tint {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            180deg,
            rgba(18,18,20,.18) 0%,
            rgba(14,14,16,.62) 46%,
            rgba(8,8,10,.94) 100%
          );
        }
        .egf-spec {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            260px 200px at 58% 28%,
            rgba(255,255,255,.5),
            rgba(255,255,255,0) 70%
          );
          mix-blend-mode: screen;
          opacity: .16;
          pointer-events: none;
        }
        .egf-front-rim {
          width: ${W}px;
          height: 198px;
          opacity: .55;
        }
        .egf-front-rim path {
          stroke-width: 2.4;
        }
        .egf-label {
          position: absolute;
          left: 28px;
          bottom: 32px;
          z-index: 2;
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-width: 220px;
          color: var(--egf-ink);
          pointer-events: none;
        }
        .egf-title {
          font-size: 18px;
          font-weight: 500;
          line-height: 1.15;
          letter-spacing: -.012em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .egf-meta {
          font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
          letter-spacing: .03em;
          color: var(--egf-ink-soft);
          white-space: nowrap;
        }
        .egf-host[data-reduced-motion=true] .egf-front,
        .egf-host[data-reduced-motion=true] .egf-sheet,
        .egf-host[data-reduced-motion=true] .egf-plus {
          transition: none;
        }
        .egf-host[data-reduced-motion=true]:hover,
        .egf-host[data-reduced-motion=true]:focus-visible {
          --egf-hinge: 0deg;
          --egf-lift: 64px;
        }
      `}</style>
    </button>
  );
}

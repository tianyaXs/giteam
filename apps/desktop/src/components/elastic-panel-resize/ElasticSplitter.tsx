import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../../lib/utils";

type DragState = {
  id: number;
  startValue: number;
  grab: number;
  raw: number;
  pointer: number;
  speed: number;
  time: number;
  type: string;
};

function clamp(value: number, lower: number, upper: number) {
  return Math.max(lower, Math.min(upper, value));
}

function rubber(value: number, min: number, max: number) {
  const bounded = clamp(value, min, max);
  const excess = value - bounded;
  return bounded + Math.sign(excess) * 15 * (1 - Math.exp(-Math.abs(excess) / 35));
}

/**
 * Workbench 分栏弹性把手：悬停出现胶囊、拖动方向弯曲、越界橡皮筋。
 * grow-right：拖向右加宽（侧栏）；grow-left：拖向左加宽（右侧面板）。
 */
export function ElasticSplitter(props: {
  value: number;
  min: number;
  max: number;
  direction: "grow-right" | "grow-left";
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  onChange: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<SVGPathElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const valueRef = useRef(props.value);
  const targetRef = useRef(props.value);
  const velocityRef = useRef(0);
  const bendRef = useRef(0);
  const bendVelocityRef = useRef(0);
  const offsetRef = useRef(0);
  const offsetVelocityRef = useRef(0);
  const thicknessRef = useRef(0);
  const lengthRef = useRef(60);
  const revealRef = useRef(0);
  const motionRef = useRef(0);
  const visibleRef = useRef(false);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const hideTimerRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  valueRef.current = props.value;

  const reduced = () =>
    typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const draw = () => {
    const ink = inkRef.current;
    const outline = outlineRef.current;
    const root = rootRef.current;
    if (!ink || !outline || !root) return;
    const x = 40 + offsetRef.current;
    const path = `M${x} ${80 - lengthRef.current / 2} Q${x + bendRef.current * 2} 80 ${x} ${80 + lengthRef.current / 2}`;
    ink.setAttribute("d", path);
    outline.setAttribute("d", path);
    ink.style.strokeWidth = String(thicknessRef.current);
    outline.style.strokeWidth = String(thicknessRef.current + 2 * revealRef.current);
    const gray = Math.round(198 - 39 * motionRef.current);
    ink.style.stroke = `rgb(${gray},${gray},${gray})`;
    root.style.setProperty("--er-reveal", String(revealRef.current));
  };

  const wake = () => {
    if (rafRef.current) return;
    lastRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  };

  const show = () => {
    window.clearTimeout(hideTimerRef.current);
    visibleRef.current = true;
    wake();
  };

  const hideLater = () => {
    window.clearTimeout(hideTimerRef.current);
    if (hoveredRef.current || focusedRef.current || dragRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      visibleRef.current = false;
      wake();
    }, 450);
  };

  function tick(now: number) {
    rafRef.current = 0;
    const dt = Math.min((now - lastRef.current) / 1000 || 1 / 60, 1 / 30);
    lastRef.current = now;
    const drag = dragRef.current;
    const excess = drag ? drag.raw - targetRef.current : 0;
    const pull = clamp(Math.abs(excess) / 80, 0, 1);
    const speed = drag && now - drag.time < 70 ? drag.speed : 0;
    const direction = clamp(speed / 60, -1, 1) * (props.direction === "grow-left" ? -1 : 1);
    const bendTarget = direction * 3.2 * (1 - pull);
    const offsetTarget = direction * 6 * (1 - pull) + Math.sign(excess) * 4 * pull * (props.direction === "grow-left" ? -1 : 1);
    motionRef.current = Math.max(Math.abs(direction) * (1 - pull), pull);
    const revealTarget = visibleRef.current ? 1 : 0;
    // 工作台分栏把手比演示版更细：静止约 5px，拖动再略收。
    const thicknessTarget = (5 - 2.5 * motionRef.current - 1 * pull) * revealTarget;
    const lengthTarget = 48 + 22 * motionRef.current + 14 * pull;

    if (reduced()) {
      bendRef.current = 0;
      bendVelocityRef.current = 0;
      offsetRef.current = 0;
      offsetVelocityRef.current = 0;
      revealRef.current = revealTarget;
      thicknessRef.current = visibleRef.current ? 5 : 0;
      lengthRef.current = 48;
      motionRef.current = 0;
      draw();
      return;
    }

    for (let i = 0; i < 4; i++) {
      const step = dt / 4;
      if (!drag) {
        velocityRef.current += ((targetRef.current - valueRef.current) * 400 - velocityRef.current * 26) * step;
        const next = valueRef.current + velocityRef.current * step;
        if (Math.abs(next - valueRef.current) > 0.01) {
          valueRef.current = next;
          props.onChange(clamp(next, props.min, props.max));
        }
      }
      bendVelocityRef.current += ((bendTarget - bendRef.current) * 680 - bendVelocityRef.current * 34) * step;
      bendRef.current += bendVelocityRef.current * step;
      offsetVelocityRef.current += ((offsetTarget - offsetRef.current) * 680 - offsetVelocityRef.current * 34) * step;
      offsetRef.current += offsetVelocityRef.current * step;
    }

    const amount = 1 - Math.exp(-32 * dt);
    revealRef.current += (revealTarget - revealRef.current) * amount;
    thicknessRef.current += (thicknessTarget - thicknessRef.current) * amount;
    lengthRef.current += (lengthTarget - lengthRef.current) * amount;
    draw();

    const moving = !drag && (Math.abs(targetRef.current - valueRef.current) > 0.01 || Math.abs(velocityRef.current) > 0.05);
    const shaping =
      Math.abs(bendTarget - bendRef.current) > 0.01
      || Math.abs(bendVelocityRef.current) > 0.03
      || Math.abs(offsetTarget - offsetRef.current) > 0.01
      || Math.abs(offsetVelocityRef.current) > 0.03;
    const morphing =
      Math.abs(thicknessTarget - thicknessRef.current) > 0.01
      || Math.abs(lengthTarget - lengthRef.current) > 0.01
      || Math.abs(revealTarget - revealRef.current) > 0.001;
    if (moving || shaping || morphing || (drag && Math.abs(speed) > 0.1)) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    if (!drag) {
      valueRef.current = targetRef.current;
      velocityRef.current = 0;
      bendRef.current = 0;
      offsetRef.current = 0;
      motionRef.current = 0;
    } else {
      bendRef.current = bendTarget;
      offsetRef.current = offsetTarget;
    }
    bendVelocityRef.current = 0;
    offsetVelocityRef.current = 0;
    revealRef.current = revealTarget;
    thicknessRef.current = drag ? thicknessTarget : 5 * revealRef.current;
    lengthRef.current = drag ? lengthTarget : 48;
    draw();
  }

  useEffect(() => {
    if (dragRef.current) return;
    targetRef.current = props.value;
    valueRef.current = props.value;
  }, [props.value]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    window.clearTimeout(hideTimerRef.current);
  }, []);

  const release = (cancel = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    velocityRef.current = 0;
    if (cancel) {
      targetRef.current = drag.startValue;
      props.onChange(drag.startValue);
    } else {
      targetRef.current = clamp(targetRef.current, props.min, props.max);
      props.onChange(targetRef.current);
    }
    hoveredRef.current = drag.type !== "touch";
    const node = rootRef.current;
    if (node?.hasPointerCapture(drag.id)) node.releasePointerCapture(drag.id);
    props.onDragEnd?.();
    show();
    hideLater();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (props.disabled || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const start = props.value;
    targetRef.current = start;
    valueRef.current = start;
    velocityRef.current = 0;
    dragRef.current = {
      id: event.pointerId,
      startValue: start,
      grab: event.clientX,
      raw: start,
      pointer: event.clientX,
      speed: 0,
      time: performance.now(),
      type: event.pointerType
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onDragStart?.();
    show();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    const now = performance.now();
    const delta = event.clientX - drag.grab;
    const raw = drag.startValue + (props.direction === "grow-right" ? delta : -delta);
    const elapsed = Math.max((now - drag.time) / 1000, 0.008);
    drag.speed = clamp((raw - drag.raw) / elapsed, -2200, 2200);
    drag.raw = raw;
    drag.pointer = event.clientX;
    drag.time = now;
    const next = reduced() ? clamp(raw, props.min, props.max) : rubber(raw, props.min, props.max);
    targetRef.current = clamp(raw, props.min, props.max);
    valueRef.current = next;
    props.onChange(next);
    wake();
  };

  const percent = Math.round(((props.value - props.min) / Math.max(1, props.max - props.min)) * 1000) / 10;

  return (
    <div
      ref={rootRef}
      role="separator"
      tabIndex={props.disabled ? -1 : 0}
      aria-orientation="vertical"
      aria-label={props.ariaLabel || "调整面板宽度"}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      aria-valuetext={`${percent}%`}
      data-dragging={dragging || undefined}
      className={cn(
        "er-split relative z-[2] flex h-full w-8 shrink-0 cursor-ew-resize touch-none items-center justify-center outline-none",
        " [--er-reveal:0]",
        props.disabled && "pointer-events-none opacity-0",
        props.className
      )}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        hoveredRef.current = true;
        show();
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
        hideLater();
      }}
      onFocus={() => {
        focusedRef.current = true;
        show();
      }}
      onBlur={() => {
        focusedRef.current = false;
        hideLater();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        if (event.pointerId === dragRef.current?.id) release();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === dragRef.current?.id) release(true);
      }}
      onLostPointerCapture={() => release()}
      onDoubleClick={() => {
        const mid = clamp((props.min + props.max) / 2, props.min, props.max);
        targetRef.current = mid;
        props.onChange(mid);
        show();
        hideLater();
      }}
      onKeyDown={(event) => {
        const step = (event.shiftKey ? 24 : 8) * (props.direction === "grow-left" ? -1 : 1);
        const map: Record<string, number> = {
          ArrowLeft: targetRef.current - step,
          ArrowRight: targetRef.current + step,
          Home: props.direction === "grow-right" ? props.min : props.max,
          End: props.direction === "grow-right" ? props.max : props.min,
          Escape: dragRef.current ? dragRef.current.startValue : targetRef.current
        };
        if (!(event.key in map)) return;
        event.preventDefault();
        if (event.key === "Escape" && dragRef.current) {
          release(true);
          return;
        }
        const next = clamp(map[event.key], props.min, props.max);
        targetRef.current = next;
        props.onChange(next);
        show();
        hideLater();
      }}
    >
      <svg
        viewBox="0 0 80 160"
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-20 -translate-x-1/2 -translate-y-1/2 overflow-visible opacity-[var(--er-reveal)]"
      >
        <path ref={outlineRef} d="M40 50 Q40 80 40 110" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth={0} />
        <path ref={inkRef} d="M40 50 Q40 80 40 110" fill="none" stroke="#c6c6c6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={0} />
      </svg>
      <span className="sr-only" aria-live="polite">
        {dragging ? `宽度 ${Math.round(props.value)}` : ""}
      </span>
    </div>
  );
}

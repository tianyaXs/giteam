import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import type { AppText } from "../../lib/generalSettings";
import type { NavigatorMarker, NavigatorRole } from "./AgentMessageNavigator";

/**
 * 会话侧帆船概览标尺（聊天场景瘦身版）：
 * - 只保留航线 + 圆点 + 帆船，文案改 hover 预览，避免贴消息区拥挤
 * - 航线在船位弯向「外侧」（远离内容），船停在弯弧里，左右侧互不压内容
 * - 节点按轨高限流并全量均匀采样；Y 按 originalIndex/total 落在进度轴上（与船同轴）
 * - 动画 DOM 直写；SVG 与容器像素 1:1
 */

type AgentSailingNavigatorProps = {
  markers: NavigatorMarker[];
  totalCount: number;
  /** 高亮最近节点用（与 progress 同轴：round(progress×count)，仅下标变化时才重渲染）。 */
  activeIndex: number | null;
  /** 滚动进度 0..1 的 ref；船 Y 每帧读它，与蓝点共用同一进度轴。 */
  progressRef: MutableRefObject<number>;
  onNavigate: (index: number, behavior: "smooth" | "auto") => void;
  text: AppText;
  hidden?: boolean;
  side?: "left" | "right";
};

/** 与 AgentChatFrame / App 占位宽一致：细轨，只够航线绕船。 */
export const SAILING_NAVIGATOR_WIDTH = 64;
/** 消息太少时不展示整条帆船标尺。 */
const MIN_MARKERS = 8;
/** 节点中心最小间距（px），保证视觉不挤。 */
const MIN_DOT_GAP = 22;
const MIN_VISIBLE_DOTS = 8;
const MAX_VISIBLE_DOTS = 32;
const DRAG_THRESHOLD = 4;
const PREVIEW_OPEN_DELAY = 220;
const PREVIEW_CLOSE_DELAY = 140;
const PREVIEW_WIDTH = 248;
const RAIL_PAD = 12;
const SHIP_SIZE = 34;
/**
 * 航线几何：基线贴「所在侧」外边，弯向内容一侧。
 * - 左侧标尺：base 靠左，bend 向右（进入与正文之间的预留槽）
 * - 右侧标尺：base 靠右，bend 向左
 */
const OUTER_INSET = 18;
const BEND_INSET = 40;
const BEND_REACH = 36;
const BEND_CTRL = 20;
const DOT_SHIFT = 8;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/** 按侧别算出基线 x 与弯弧 x（基线在外侧，弯向内容）。 */
function routeGeometry(side: "left" | "right") {
  if (side === "left") {
    return { baseX: OUTER_INSET, bendX: BEND_INSET, shiftSign: 1 as const };
  }
  return {
    baseX: SAILING_NAVIGATOR_WIDTH - OUTER_INSET,
    bendX: SAILING_NAVIGATOR_WIDTH - BEND_INSET,
    shiftSign: -1 as const
  };
}

/** 按轨高算出本帧最多能舒服放下多少个点。 */
function maxSlotsForHeight(height: number) {
  const usable = Math.max(1, height - RAIL_PAD * 2);
  return clamp(Math.floor(usable / MIN_DOT_GAP), MIN_VISIBLE_DOTS, MAX_VISIBLE_DOTS);
}

/** 消息过多时沿全量下标均匀采样，保证点落在整条进度轴上（与船同轴），避免局部切片被拉满整轨。 */
function sampleSpreadMarkers(markers: NavigatorMarker[], maxSlots: number): NavigatorMarker[] {
  if (markers.length <= maxSlots) return markers;
  const out: NavigatorMarker[] = [];
  const last = maxSlots - 1;
  for (let i = 0; i < maxSlots; i += 1) {
    const idx = Math.round((i / last) * (markers.length - 1));
    const marker = markers[idx];
    if (out.length === 0 || out[out.length - 1].key !== marker.key) {
      out.push(marker);
    }
  }
  return out;
}

const SHIP_PATHS = [
  { d: "M7 65C29 75 66 73 93 57L92 64C72 83 32 88 14 73Z", line: false },
  { d: "M8 65C32 72 65 69 93 57M14 73C36 80 70 76 92 64", line: true },
  { d: "M29 13V71M56 3V69M79 12V64", line: true },
  { d: "M29 17C19 14 14 19 18 28L29 32Z", line: false },
  { d: "M29 34C16 28 11 38 18 47L29 51Z", line: false },
  { d: "M29 53C19 47 15 56 23 66L29 70Z", line: false },
  { d: "M56 8C46 3 39 9 42 20L56 25Z", line: false },
  { d: "M56 29C40 22 35 32 43 44L56 49Z", line: false },
  { d: "M56 51C41 44 37 54 46 65L56 69Z", line: false },
  { d: "M80 16Q92 30 95 48L80 56Z", line: false },
  {
    d: "M1 61L29 48M8 65L29 58M29 69L56 38M56 68L79 42M29 13L34 12V16H29M56 3H62V7H56",
    line: true
  }
];

export function AgentSailingNavigator({
  markers,
  totalCount,
  activeIndex,
  progressRef,
  onNavigate,
  text,
  hidden = false,
  side = "right"
}: AgentSailingNavigatorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const routeRef = useRef<SVGPathElement | null>(null);
  const shipRef = useRef<HTMLDivElement | null>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const rippleRefs = useRef<(SVGEllipseElement | null)[]>([]);
  const endTopRef = useRef<SVGCircleElement | null>(null);
  const endTopDotRef = useRef<SVGCircleElement | null>(null);
  const endBotRef = useRef<SVGCircleElement | null>(null);
  const endBotDotRef = useRef<SVGCircleElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [railHeight, setRailHeight] = useState(520);
  const [preview, setPreview] = useState<{
    x: number;
    y: number;
    marker: NavigatorMarker;
    ordinal: number;
  } | null>(null);

  const openTimerRef = useRef(0);
  const closeTimerRef = useRef(0);
  const navRafRef = useRef(0);
  const animRafRef = useRef(0);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const pointerStartYRef = useRef(0);
  const activePointerRef = useRef<number | null>(null);
  const lastNavIndexRef = useRef(-1);
  const yRef = useRef(0);
  const targetRef = useRef(0);
  const velocityRef = useRef(0);
  const rollRef = useRef(0);
  const yawRef = useRef(0);
  const phaseRef = useRef(0);
  const lastFrameRef = useRef(0);
  const reducedRef = useRef(false);
  const readyRef = useRef(false);
  const activeMarkerIndexRef = useRef(-1);

  const maxSlots = maxSlotsForHeight(railHeight);
  const sampled = useMemo(
    () => sampleSpreadMarkers(markers, maxSlots),
    [markers, maxSlots]
  );
  const count = sampled.length;
  const onLeft = side === "left";

  const activeMarkerIndex = useMemo(() => {
    if (activeIndex == null || count === 0) return -1;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < count; i += 1) {
      const d = Math.abs(sampled[i].originalIndex - activeIndex);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }, [sampled, count, activeIndex]);

  activeMarkerIndexRef.current = activeMarkerIndex;

  // 测量轨高 → 决定本帧可挂载节点数（间距下限）。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => {
      const h = Math.round(el.clientHeight);
      if (h > 0) setRailHeight((prev) => (prev === h ? prev : h));
    };
    sync();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hidden, markers.length]);

  /** 点 Y = 消息下标 / 全量进度轴，与 shipTargetY(progress) 同坐标系。 */
  const markerCenterY = useCallback(
    (index: number, height: number) => {
      if (count <= 0) return height / 2;
      const usable = Math.max(1, height - RAIL_PAD * 2);
      const marker = sampled[index];
      if (!marker || totalCount <= 1) return RAIL_PAD + usable / 2;
      const ratio = clamp(marker.originalIndex / Math.max(1, totalCount - 1), 0, 1);
      return RAIL_PAD + ratio * usable;
    },
    [count, sampled, totalCount]
  );

  /** 船位 = 滚动进度映射到航线端点之间；每帧读 ref，不经 React state。 */
  const shipTargetY = useCallback((height: number) => {
    const usable = Math.max(1, height - RAIL_PAD * 2);
    const ratio = clamp(progressRef.current, 0, 1);
    return RAIL_PAD + ratio * usable;
  }, [progressRef]);

  const clearPreviewTimers = useCallback(() => {
    window.clearTimeout(openTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
  }, []);
  useEffect(() => () => clearPreviewTimers(), [clearPreviewTimers]);

  const scheduleOpen = useCallback(
    (marker: NavigatorMarker, ordinal: number, el: HTMLElement) => {
      if (draggingRef.current) return;
      clearPreviewTimers();
      openTimerRef.current = window.setTimeout(() => {
        const rect = el.getBoundingClientRect();
        const x =
          side === "left"
            ? Math.min(rect.right + 8, window.innerWidth - PREVIEW_WIDTH - 8)
            : Math.max(8, rect.left - PREVIEW_WIDTH - 8);
        const y = Math.min(Math.max(rect.top - 6, 8), window.innerHeight - 132);
        setPreview({ x, y, marker, ordinal });
      }, PREVIEW_OPEN_DELAY);
    },
    [clearPreviewTimers, side]
  );

  const scheduleClose = useCallback(() => {
    clearPreviewTimers();
    closeTimerRef.current = window.setTimeout(() => setPreview(null), PREVIEW_CLOSE_DELAY);
  }, [clearPreviewTimers]);

  const navigateFromPointer = useCallback(
    (clientY: number, behavior: "smooth" | "auto") => {
      const el = containerRef.current;
      if (!el || totalCount <= 0) return;
      const rect = el.getBoundingClientRect();
      if (behavior === "smooth" && sampled.length > 0) {
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < sampled.length; i += 1) {
          const markerY = rect.top + markerCenterY(i, rect.height);
          const d = Math.abs(clientY - markerY);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        const targetIndex = sampled[best].originalIndex;
        lastNavIndexRef.current = targetIndex;
        onNavigate(targetIndex, "smooth");
        return;
      }
      const ratio = rect.height > 0 ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0;
      const targetIndex = Math.round(ratio * (totalCount - 1));
      if (targetIndex === lastNavIndexRef.current) return;
      lastNavIndexRef.current = targetIndex;
      cancelAnimationFrame(navRafRef.current);
      navRafRef.current = requestAnimationFrame(() => onNavigate(targetIndex, "auto"));
    },
    [onNavigate, totalCount, sampled, markerCenterY]
  );
  useEffect(() => () => cancelAnimationFrame(navRafRef.current), []);

  // 船目标每帧在 RAF 里跟 progressRef；这里只做挂载时的初始落点。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || count <= 0) return;
    const height = el.clientHeight || 280;
    targetRef.current = shipTargetY(height);
    yRef.current = targetRef.current;
    readyRef.current = true;
  }, [shipTargetY, count, side]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedRef.current = media.matches;
      if (media.matches) {
        yRef.current = targetRef.current;
        velocityRef.current = 0;
        rollRef.current = 0;
        yawRef.current = 0;
      }
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (hidden || markers.length < MIN_MARKERS || count <= 0) return;
    let alive = true;
    const { baseX, bendX, shiftSign } = routeGeometry(side);

    const tick = (now: number) => {
      if (!alive) return;
      const el = containerRef.current;
      if (!el) {
        animRafRef.current = requestAnimationFrame(tick);
        return;
      }
      const height = Math.max(1, el.clientHeight);
      // 允许船停到航线端点圆，不再额外内缩形成「滚不到顶/底」。
      const minY = RAIL_PAD;
      const maxY = height - RAIL_PAD;
      const dt = Math.min(0.032, (now - (lastFrameRef.current || now)) / 1000);
      lastFrameRef.current = now;

      // 每帧从滚动进度 ref 取目标，不依赖 React 重渲染。
      targetRef.current = shipTargetY(height);
      if (!readyRef.current) {
        yRef.current = targetRef.current;
        readyRef.current = true;
      }

      const target = clamp(targetRef.current, minY, maxY);
      let y = yRef.current || target;
      let velocity = velocityRef.current;
      let rollV = rollRef.current;
      let yawV = yawRef.current;
      let phaseV = phaseRef.current;

      if (reducedRef.current) {
        y = target;
        velocity = 0;
        rollV = 0;
        yawV = 0;
      } else {
        phaseV += dt;
        velocity += (180 * (target - y) - 24 * velocity) * dt;
        y += velocity * dt;
        const smooth = 1 - Math.exp(-dt * 12);
        rollV +=
          (clamp(velocity * 0.04, -20, 20) + Math.sin(phaseV * 1.8) * 1.4 - rollV) * smooth;
        yawV +=
          (clamp(velocity * 0.055, -48, 48) + Math.sin(phaseV * 0.9) * 3 - yawV) * smooth;
        if (Math.abs(target - y) < 0.1 && Math.abs(velocity) < 0.2) {
          y = target;
          velocity = 0;
        }
      }

      yRef.current = y;
      velocityRef.current = velocity;
      rollRef.current = rollV;
      yawRef.current = yawV;
      phaseRef.current = phaseV;

      const routeTop = RAIL_PAD;
      const routeBot = height - RAIL_PAD;
      // 靠近端点时削弱晃动，避免船/弯弧蹭出端点圆。
      const edgeFade = clamp(Math.min(y - routeTop, routeBot - y) / 28, 0, 1);
      const center = clamp(
        y + (reducedRef.current ? 0 : Math.sin(phaseV * 2.2) * 0.85 * edgeFade),
        minY,
        maxY
      );

      // 弯弧纵向跨度钳在端点之内：顶/底附近 reach→0，虚线不会画出结束圆。
      const reach = Math.min(BEND_REACH, center - routeTop, routeBot - center);
      const ctrl = Math.min(BEND_CTRL, Math.max(0, reach));
      const d =
        reach < 1
          ? `M${baseX} ${routeTop}L${baseX} ${routeBot}`
          : `M${baseX} ${routeTop}L${baseX} ${center - reach}C${baseX} ${center - ctrl} ${bendX} ${center - ctrl} ${bendX} ${center}C${bendX} ${center + ctrl} ${baseX} ${center + ctrl} ${baseX} ${center + reach}L${baseX} ${routeBot}`;

      if (svgRef.current) {
        svgRef.current.setAttribute("viewBox", `0 0 ${SAILING_NAVIGATOR_WIDTH} ${height}`);
      }
      routeRef.current?.setAttribute("d", d);
      endTopRef.current?.setAttribute("cy", String(RAIL_PAD));
      endTopDotRef.current?.setAttribute("cy", String(RAIL_PAD));
      endBotRef.current?.setAttribute("cy", String(height - RAIL_PAD));
      endBotDotRef.current?.setAttribute("cy", String(height - RAIL_PAD));
      endTopRef.current?.setAttribute("cx", String(baseX));
      endTopDotRef.current?.setAttribute("cx", String(baseX));
      endBotRef.current?.setAttribute("cx", String(baseX));
      endBotDotRef.current?.setAttribute("cx", String(baseX));

      if (shipRef.current) {
        const yaw = shiftSign * yawV;
        const roll = shiftSign * rollV;
        shipRef.current.style.transform = `translateY(${center - SHIP_SIZE / 2}px) perspective(300px) rotateY(${yaw}deg) rotateZ(${roll}deg)`;
      }

      // 近船圆点略向弯弧（内容侧）让位。
      const baseLeft = baseX - 4;
      dotRefs.current.forEach((dot, index) => {
        if (!dot) return;
        const labelY = markerCenterY(index, height);
        const dist = Math.abs(labelY - center);
        const influence = clamp(1 - dist / 48, 0, 1);
        const isActive = index === activeMarkerIndexRef.current;
        const shift = (isActive ? DOT_SHIFT : DOT_SHIFT * 0.55 * influence) * shiftSign;
        dot.style.transform = `translateX(${shift}px)`;
        dot.style.left = `${baseLeft}px`;
        dot.dataset.active = isActive ? "true" : "false";
      });

      rippleRefs.current.forEach((ripple, index) => {
        if (!ripple) return;
        if (reducedRef.current) {
          ripple.style.opacity = "0";
          return;
        }
        const progress = (phaseV / 2.4 + index / 2) % 1;
        ripple.setAttribute("rx", String(24 + progress * 42));
        ripple.setAttribute("ry", String(6 + progress * 13));
        ripple.style.opacity = String(Math.sin(progress * Math.PI) ** 2 * 0.28);
      });

      animRafRef.current = requestAnimationFrame(tick);
    };

    animRafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(animRafRef.current);
    };
  }, [hidden, count, side, markerCenterY, shipTargetY, markers.length]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerStartYRef.current = event.clientY;
    activePointerRef.current = event.pointerId;
    movedRef.current = false;
    draggingRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      if (!movedRef.current && Math.abs(event.clientY - pointerStartYRef.current) > DRAG_THRESHOLD) {
        movedRef.current = true;
        draggingRef.current = true;
        setIsDragging(true);
        setPreview(null);
      }
      if (draggingRef.current) navigateFromPointer(event.clientY, "auto");
    },
    [navigateFromPointer]
  );

  const endPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      const wasDragging = draggingRef.current;
      activePointerRef.current = null;
      draggingRef.current = false;
      setIsDragging(false);
      if (!wasDragging) navigateFromPointer(event.clientY, "smooth");
    },
    [navigateFromPointer]
  );

  // 用全量 markers 判断是否展示；可见点由均匀采样决定，可能少于 MIN_MARKERS。
  if (hidden || markers.length < MIN_MARKERS) return null;

  const roleDotClass = (role: NavigatorRole) =>
    role === "user"
      ? "bg-primary"
      : role === "system"
        ? "bg-[var(--warning)]"
        : "bg-muted-foreground";
  const roleLabel = (role: NavigatorRole) =>
    role === "user"
      ? text.navigatorRoleYou
      : role === "system"
        ? text.navigatorRoleSystem
        : text.navigatorRoleAssistant;

  const { baseX: initialBx, bendX } = routeGeometry(side);
  // 船停在弯弧中心（靠内容一侧），并钳在轨内。
  const shipLeft = clamp(bendX - SHIP_SIZE / 2, 2, SAILING_NAVIGATOR_WIDTH - SHIP_SIZE - 2);

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          // z-10：低于「拉到最新」按钮（z-50），避免加高航线后挡住底部按钮命中。
          "absolute z-10 overflow-hidden",
          isDragging ? "cursor-grabbing" : "cursor-pointer"
        )}
        style={{
          left: onLeft ? "var(--chat-nav-left-mirror, 28px)" : "var(--chat-nav-left, 0px)",
          width: SAILING_NAVIGATOR_WIDTH,
          // 拉满消息区；顶部多留一点，避免贴会话标题/顶栏。
          top: 40,
          bottom: 20,
          touchAction: "none"
        }}
        title={text.navigatorDragHint}
        aria-label={text.sessionNavigator}
        role="navigation"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onMouseLeave={scheduleClose}
      >
        <svg
          ref={svgRef}
          className="pointer-events-none absolute inset-0 h-full w-full text-foreground/50"
          viewBox={`0 0 ${SAILING_NAVIGATOR_WIDTH} 520`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            ref={routeRef}
            d={`M${initialBx} ${RAIL_PAD}V506`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.15"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <circle ref={endTopRef} cx={initialBx} cy={RAIL_PAD} r="3.2" fill="var(--background)" stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
          <circle ref={endTopDotRef} cx={initialBx} cy={RAIL_PAD} r="1" fill="currentColor" />
          <circle ref={endBotRef} cx={initialBx} cy={506} r="3.2" fill="var(--background)" stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
          <circle ref={endBotDotRef} cx={initialBx} cy={506} r="1" fill="currentColor" />
        </svg>

        {sampled.map((marker, index) => {
          const isActive = activeMarkerIndex === index;
          const yRatio =
            totalCount <= 1 ? 0.5 : clamp(marker.originalIndex / Math.max(1, totalCount - 1), 0, 1);
          return (
            <div
              key={marker.key}
              className="absolute left-0 right-0"
              style={{
                top: `calc(${RAIL_PAD}px + ${yRatio} * (100% - ${RAIL_PAD * 2}px) - 5px)`,
                height: 10
              }}
              onMouseEnter={(event) => {
                if (!draggingRef.current) scheduleOpen(marker, marker.originalIndex + 1, event.currentTarget);
              }}
              onMouseLeave={scheduleClose}
            >
              <span
                ref={(node) => {
                  dotRefs.current[index] = node;
                }}
                data-active={isActive ? "true" : "false"}
                className={cn(
                  "absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full transition-[colors,opacity,transform] duration-200",
                  "animate-in fade-in-0 zoom-in-95",
                  "data-[active=true]:bg-primary data-[active=false]:bg-foreground/45"
                )}
                style={{ left: initialBx - 3 }}
              />
            </div>
          );
        })}

        <div
          ref={shipRef}
          className="pointer-events-none absolute top-0 text-foreground"
          style={{
            left: shipLeft,
            width: SHIP_SIZE,
            height: SHIP_SIZE,
            transformOrigin: "center",
            willChange: "transform"
          }}
          aria-hidden="true"
        >
          <svg className="absolute inset-0 overflow-visible" viewBox="0 0 100 88">
            {[0, 1].map((i) => (
              <ellipse
                key={i}
                ref={(node) => {
                  rippleRefs.current[i] = node;
                }}
                cx="51"
                cy="79"
                rx={24}
                ry={6}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.7"
                opacity={0}
                className="text-muted-foreground"
              />
            ))}
          </svg>
          <svg className="relative overflow-visible drop-shadow-sm" viewBox="0 0 100 88" width={SHIP_SIZE} height={SHIP_SIZE}>
            {SHIP_PATHS.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill={p.line ? "none" : "var(--background)"}
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
        </div>
      </div>

      {preview
        ? createPortal(
            <div
              className={cn(
                "fixed z-[3000] w-[248px] overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground",
                "shadow-[var(--gt-shadow-3)] animate-in fade-in-0 zoom-in-95 duration-150",
                side === "left" ? "slide-in-from-left-2" : "slide-in-from-right-2"
              )}
              style={{ left: preview.x, top: preview.y }}
              role="dialog"
              aria-label={text.sessionNavigator}
              onMouseEnter={clearPreviewTimers}
              onMouseLeave={scheduleClose}
            >
              <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
                <span className={cn("size-1.5 shrink-0 rounded-full", roleDotClass(preview.marker.role))} />
                <span className="text-xs font-medium text-muted-foreground">
                  {roleLabel(preview.marker.role)}
                </span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground/70">#{preview.ordinal}</span>
              </div>
              <div className="px-3 pb-2.5 text-xs leading-relaxed text-foreground line-clamp-3">
                {preview.marker.preview || "…"}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}


import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import type { AppText } from "../../lib/generalSettings";

/**
 * 会话消息右侧「快速定位」导航条（fast scroller / overview rail），挂在内容区右缘
 * （由 AgentChatFrame 下发的 --chat-nav-left 定位，与进度卡片并排：消息区｜导航条｜进度卡）。
 *
 * - 每根横杠代表一条消息（采样后 ≤ MAX_MARKERS 根）。
 * - 当前可视窗口里那条消息对应的横杠变蓝（activeIndex 由 Virtuoso rangeChanged 换算）。
 * - 鱼眼聚焦：hover 某 marker 时它放大、附近 marker 随距离线性衰减，远处不变。
 * - hover 预览：经 hover-intent 延迟后向左弹出该消息的角色 + 首行文本。
 * - 点击：平滑跳转到所点位置；按住拖动超过阈值：进入 scrub，实时跟随滚动。
 *
 * 颜色全部走语义 token（bg-foreground/bg-primary/bg-popover/border-border），
 * 明暗主题由 tokens.css 自动接管，组件内不写死颜色、不写 dark: 变体。
 */

export type NavigatorRole = "user" | "assistant" | "system";

export type NavigatorMarker = {
  key: string;
  /** 在原始消息行数组中的下标，用于跳转与匹配当前可视位置。 */
  originalIndex: number;
  role: NavigatorRole;
  preview: string;
};

type AgentMessageNavigatorProps = {
  markers: NavigatorMarker[];
  totalCount: number;
  /** 当前可视区中部对应的消息下标（来自 Virtuoso rangeChanged），其最近 marker 变蓝。 */
  activeIndex: number | null;
  onNavigate: (index: number, behavior: "smooth" | "auto") => void;
  text: AppText;
  hidden?: boolean;
  /** 标尺贴内容列的哪一侧：right（默认，内容右缘）/ left（内容左缘）。 */
  side?: "left" | "right";
};

const MIN_MARKERS = 8;
const MAX_MARKERS = 64;
/** 鱼眼影响半径（左右各 N 根 marker 参与缩放/透明度衰减）。 */
const FISHEYE_RADIUS = 4;
/** hover 中心 marker 的额外横向放大倍数（实际 scaleX = 1 + BOOST）。 */
const FISHEYE_BOOST = 1.0;
/** 非聚焦 marker 的基础透明度，聚焦中心补到 1。 */
const BASE_OPACITY = 0.3;
/** 超过该移动距离才判定为拖拽 scrub，否则 pointerup 视为点击跳转。 */
const DRAG_THRESHOLD = 4;
const PREVIEW_OPEN_DELAY = 220;
const PREVIEW_CLOSE_DELAY = 140;
const PREVIEW_WIDTH = 248;

function sampleMarkers(markers: NavigatorMarker[]): NavigatorMarker[] {
  if (markers.length <= MAX_MARKERS) return markers;
  const out: NavigatorMarker[] = [];
  for (let i = 0; i < MAX_MARKERS; i += 1) {
    const idx = Math.round((i / (MAX_MARKERS - 1)) * (markers.length - 1));
    out.push(markers[idx]);
  }
  return out;
}

/** 鱼眼衰减：距离 0 → 1，距离 ≥ RADIUS → 0，中间线性递减。 */
function fisheyeFactor(distance: number): number {
  if (distance >= FISHEYE_RADIUS) return 0;
  return 1 - distance / FISHEYE_RADIUS;
}

export function AgentMessageNavigator({
  markers,
  totalCount,
  activeIndex,
  onNavigate,
  text,
  hidden = false,
  side = "right"
}: AgentMessageNavigatorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<{
    x: number;
    y: number;
    marker: NavigatorMarker;
    ordinal: number;
  } | null>(null);

  const openTimerRef = useRef(0);
  const closeTimerRef = useRef(0);
  const navRafRef = useRef(0);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const pointerStartYRef = useRef(0);
  const activePointerRef = useRef<number | null>(null);
  const lastNavIndexRef = useRef(-1);

  const sampled = useMemo(() => sampleMarkers(markers), [markers]);
  const count = sampled.length;

  // 当前可视消息 → 采样数组中 originalIndex 最接近的那根 marker 高亮变蓝。
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

  // hover 预览的 intent 调度（参考 DesktopSidebar ProjectHoverCard 的开/关延迟握手）。
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
        const x = side === "left"
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

  // 把指针 Y 换算成消息行下标并跳转；拖拽用 auto 跟手、点击用 smooth。
  // 拖拽时 pointermove 高频：用 rAF 合并 + 目标下标去重，避免对虚拟列表重复 scrollToIndex 造成抖动。
  const navigateFromPointer = useCallback(
    (clientY: number, behavior: "smooth" | "auto") => {
      const el = containerRef.current;
      if (!el || totalCount <= 0) return;
      const rect = el.getBoundingClientRect();
      // 点击（smooth）：markers 用 flex-1 均匀撑开容器，每根中心落在 (i+0.5)/count 处；
      // 直接取离指针最近那根 marker.originalIndex 精确跳转——避免 ratio 全量插值 + 容器顶部 padding
      // 把「点最顶端 marker」算成 index 1~2，进而定位到第 2~3 条、最旧消息被推到视口外。
      if (behavior === "smooth" && sampled.length > 0) {
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < sampled.length; i += 1) {
          const markerY = rect.top + ((i + 0.5) / sampled.length) * rect.height;
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
      // 拖动 scrub（auto）：连续指针位置 → 全量行比例插值。
      const ratio = rect.height > 0 ? Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0;
      const targetIndex = Math.round(ratio * (totalCount - 1));
      if (targetIndex === lastNavIndexRef.current) return;
      lastNavIndexRef.current = targetIndex;
      cancelAnimationFrame(navRafRef.current);
      navRafRef.current = requestAnimationFrame(() => onNavigate(targetIndex, "auto"));
    },
    [onNavigate, totalCount, sampled]
  );
  useEffect(() => () => cancelAnimationFrame(navRafRef.current), []);

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
      /* ignore — capture 在某些环境不可用，退化到普通监听 */
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
      // 未越过拖拽阈值 → 视为点击，平滑跳到按下位置。
      if (!wasDragging) navigateFromPointer(event.clientY, "smooth");
    },
    [navigateFromPointer]
  );

  if (hidden || count < MIN_MARKERS) return null;

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

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "absolute top-1/2 z-10 flex w-7 -translate-y-1/2 flex-col items-stretch rounded-md py-1",
          isDragging ? "cursor-grabbing" : "cursor-pointer"
        )}
        style={{
          left: side === "left" ? "var(--chat-nav-left-mirror, 4px)" : "var(--chat-nav-left, 0px)",
          height: "min(56%, 320px)",
          touchAction: "none"
        }}
        title={text.navigatorDragHint}
        aria-label={text.sessionNavigator}
        role="navigation"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onMouseLeave={() => {
          setHoverIndex(null);
          scheduleClose();
        }}
      >
        {sampled.map((marker, index) => {
          const dist = hoverIndex == null ? Infinity : Math.abs(index - hoverIndex);
          const factor = hoverIndex == null ? 0 : fisheyeFactor(dist);
          const scaleX = 1 + FISHEYE_BOOST * factor;
          const opacity = BASE_OPACITY + (1 - BASE_OPACITY) * factor;
          const isActive = activeMarkerIndex === index;
          return (
            <div
              key={marker.key}
              className={cn(
                "relative flex flex-1 items-center",
                side === "left" ? "justify-start pl-[5px]" : "justify-end pr-[5px]"
              )}
              style={{
                transform: `scaleX(${scaleX})`,
                transformOrigin: side === "left" ? "left center" : "right center",
                opacity,
                transition: "transform 160ms cubic-bezier(0.22,1,0.36,1), opacity 160ms ease-out"
              }}
              onMouseEnter={(event) => {
                setHoverIndex(index);
                if (!draggingRef.current) scheduleOpen(marker, marker.originalIndex + 1, event.currentTarget);
              }}
              onMouseLeave={scheduleClose}
            >
              <div
                className={cn(
                  "h-[2px] w-3 rounded-full transition-colors duration-200",
                  isActive ? "bg-primary" : "bg-foreground"
                )}
              />
            </div>
          );
        })}
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

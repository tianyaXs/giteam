import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
} from "react";
import gsap from "gsap";
import { Settings, Smartphone } from "lucide-react";
import giteamLogo from "../../assets/app-icon-mark.png";
import { MemoryOrbitIcon, PluginsIcon, TasksCalendarIcon } from "../icons";

export type GiteamNavId = "home" | "tasks" | "memory" | "plugins" | "settings";

export type GiteamFluidNavProps = {
  /** 当前选中项；传 `null` 表示无选中（例如仓库首页展开中）。 */
  active?: GiteamNavId | null;
  onSelect?: (id: GiteamNavId) => void;
  /** 点击导航轨空白区域（非按钮）时展开仓库首页。 */
  onOpenHome?: () => void;
  profileLabel?: string;
  logoSrc?: string;
  className?: string;
  reducedMotion?: boolean;
  mobileConnected?: boolean;
  onOpenMobile?: () => void;
};

type NavItem = {
  id: GiteamNavId;
  label: string;
  shortcut: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>;
};

const BASE_ITEMS: NavItem[] = [
  { id: "home", label: "对话", shortcut: "⌘1" },
  { id: "tasks", label: "任务", shortcut: "⌘2", icon: TasksCalendarIcon },
  { id: "memory", label: "记忆", shortcut: "⌘3", icon: MemoryOrbitIcon },
  { id: "plugins", label: "插件", shortcut: "⌘4", icon: PluginsIcon },
  { id: "settings", label: "设置", shortcut: "⌘5", icon: Settings },
];

export function GiteamFluidNav({
  active: activeProp = "home",
  onSelect,
  onOpenHome,
  profileLabel = "对话",
  logoSrc,
  className,
  reducedMotion,
  mobileConnected = false,
  onOpenMobile,
}: GiteamFluidNavProps) {
  const items = useMemo(
    () =>
      BASE_ITEMS.map((item) =>
        item.id === "home" ? { ...item, label: profileLabel } : item
      ),
    [profileLabel]
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 选中态完全受控于 activeProp；用 ref 供 tip/leave 异步回调读取，
  // 避免 pointerleave 的 75ms hide 闭包仍按「对话」重绘按钮底。
  const active = activeProp;
  const activeRef = useRef(active);
  activeRef.current = active;
  const [hint, setHint] = useState(-1);
  const [ready, setReady] = useState(false);

  const stateRef = useRef({ y: 0, width: 160, opacity: 0 });
  const centersRef = useRef<number[]>([]);
  const widthsRef = useRef<number[]>([]);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const hideTimerRef = useRef(0);
  const tipIdRef = useRef(`gfn-tip-${Math.random().toString(36).slice(2, 10)}`);

  const prefersReduced =
    reducedMotion ??
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // 会话栏 z-index 高于导航以承接左向投影；tip 展开时临时抬高导航层，避免菜单名被遮
  useEffect(() => {
    const activity = rootRef.current?.closest(".wb-activity") as HTMLElement | null;
    if (!activity) return;
    const open = hint >= 0;
    activity.style.zIndex = open ? "5" : "2";
    activity.dataset.navTipOpen = open ? "true" : "false";
    return () => {
      activity.style.zIndex = "2";
      delete activity.dataset.navTipOpen;
    };
  }, [hint]);

  function paint() {
    const tip = tipRef.current;
    const track = trackRef.current;
    if (!tip || !track) return;
    const { y, width, opacity } = stateRef.current;
    tip.style.transform = `translateY(${y}px)`;
    tip.style.width = `${width}px`;
    tip.style.opacity = String(opacity);
    track.style.transform = `translateY(${-y}px)`;
  }

  function cancelHide() {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = 0;
    }
  }

  function highlight(immediate = false) {
    const currentActive = activeRef.current;
    buttonRefs.current.forEach((button, index) => {
      if (!button) return;
      const selected = items[index].id === currentActive;
      button.setAttribute("aria-current", selected ? "page" : "false");
      button.dataset.active = selected ? "true" : "false";
      // 选中态交给 React/CSS（data-active）；此处只补 hover，避免 gsap 盖住声明式选中
      if (selected) {
        gsap.killTweensOf(button);
        gsap.set(button, {
          backgroundColor: "var(--nav-item-active-bg)",
          color: "var(--nav-icon-active)",
          boxShadow: "inset 0 0 0 1px var(--nav-item-active-ring)",
        });
        return;
      }
      const backgroundColor =
        index === hint ? "var(--nav-item-hover-bg)" : "transparent";
      const color = "var(--nav-icon)";
      const boxShadow = "inset 0 0 0 1px transparent";
      if (immediate || prefersReduced) gsap.set(button, { backgroundColor, color, boxShadow });
      else gsap.to(button, { backgroundColor, color, boxShadow, duration: 0.13, overwrite: true });
    });
  }

  function show(index: number, immediate = false) {
    if (index < 0 || index >= items.length) return;
    cancelHide();
    setHint(index);
    const tip = tipRef.current;
    const row = rowRefs.current[index];
    if (tip && row) {
      tip.setAttribute("aria-hidden", "false");
      tip.setAttribute(
        "aria-label",
        row.querySelector(".gfn-label")?.textContent || items[index].label
      );
    }
    buttonRefs.current.forEach((button, i) => {
      if (!button) return;
      if (i === index) button.setAttribute("aria-describedby", tipIdRef.current);
      else button.removeAttribute("aria-describedby");
    });
    if (!ready) return;
    tweenRef.current?.kill();
    highlight(immediate);
    const next = {
      y: centersRef.current[index] - 28,
      width: widthsRef.current[index],
      opacity: 1,
    };
    if (immediate || prefersReduced) {
      Object.assign(stateRef.current, next);
      paint();
      return;
    }
    const first = stateRef.current.opacity < 0.01;
    if (first) {
      stateRef.current.y = next.y;
      stateRef.current.width = next.width;
      paint();
    }
    tweenRef.current = gsap.to(stateRef.current, {
      ...next,
      duration: first ? 0.15 : 0.43,
      ease: first ? "power2.out" : "expo.out",
      overwrite: true,
      onUpdate: paint,
    });
  }

  function hide(immediate = false) {
    cancelHide();
    setHint(-1);
    tipRef.current?.setAttribute("aria-hidden", "true");
    buttonRefs.current.forEach((button) =>
      button?.removeAttribute("aria-describedby")
    );
    tweenRef.current?.kill();
    highlight(immediate);
    if (immediate || prefersReduced) {
      stateRef.current.opacity = 0;
      paint();
    } else {
      tweenRef.current = gsap.to(stateRef.current, {
        opacity: 0,
        duration: 0.15,
        ease: "power2.out",
        onUpdate: paint,
      });
    }
  }

  function leave() {
    cancelHide();
    // 离开轨条只收 tip，不因焦点残留把 hover/视觉拽回「对话」
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0;
      hide();
    }, 75);
  }

  function select(index: number) {
    const next = items[index].id;
    // 选中后立刻收 tip，并 blur 轨条按钮，避免焦点残留误导选中态
    hide(true);
    const focused = document.activeElement as HTMLElement | null;
    if (focused && buttonRefs.current.includes(focused as HTMLButtonElement)) {
      focused.blur();
    }
    if (next !== active) onSelect?.(next);
  }

  function handleBlankPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onOpenHome) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // 按钮 / tip / 手机入口不算空白
    if (target.closest("button, a, [role='button'], [role='tooltip'], input, textarea, select")) {
      return;
    }
    onOpenHome();
  }

  function fit() {
    const rail = railRef.current;
    if (!rail) return;
    buttonRefs.current.forEach((button, index) => {
      if (!button) return;
      centersRef.current[index] =
        button.offsetTop + button.offsetHeight / 2;
      const row = rowRefs.current[index];
      if (row) {
        row.style.top = `${centersRef.current[index] - 28}px`;
        widthsRef.current[index] = Math.ceil(row.offsetWidth + 40);
      }
    });
    if (ready && hint >= 0) {
      tweenRef.current?.kill();
      Object.assign(stateRef.current, {
        y: centersRef.current[hint] - 28,
        width: widthsRef.current[hint],
        opacity: 1,
      });
    }
    paint();
  }

  useLayoutEffect(() => {
    fit();
    highlight(true);
    tipRef.current?.setAttribute("aria-hidden", "true");
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      setReady(true);
      fit();
    });
    const resize = new ResizeObserver(() => fit());
    if (rootRef.current) resize.observe(rootRef.current);
    if (clusterRef.current) resize.observe(clusterRef.current);
    return () => {
      cancelled = true;
      resize.disconnect();
      cancelHide();
      tweenRef.current?.kill();
      gsap.killTweensOf([stateRef.current, ...buttonRefs.current.filter(Boolean)]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, active, prefersReduced]);

  useEffect(() => {
    // 切到设置等非对话页时，立刻取消 pending hide，防止旧闭包把选中刷回「对话」
    cancelHide();
    buttonRefs.current.forEach((button) => {
      if (button) gsap.killTweensOf(button);
    });
    highlight(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    highlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint]);

  useEffect(() => {
    const onDocPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedLogo = logoSrc || giteamLogo;

  return (
    <div
      ref={rootRef}
      className={className}
      data-giteam-fluid-nav=""
      onPointerDown={handleBlankPointerDown}
      title={onOpenHome ? "点击空白处打开首页" : undefined}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "visible",
        background: "var(--activity-bg)",
        color: "var(--text)",
        fontFamily:
          'Inter, "FluidTooltipInter", Arial, Helvetica, "Microsoft YaHei", sans-serif',
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.03,
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%22.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22 seed=%2217%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%22.7%22/%3E%3C/svg%3E")',
          zIndex: 4,
        }}
      />
      <div
        ref={clusterRef}
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
      >
        <nav
          ref={railRef}
          aria-label="工作区导航"
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px",
            boxSizing: "border-box",
          }}
          onKeyDown={(event) => {
            if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
            // 输入框/下拉内不抢 ⌘1–⌘5，避免设置页填参时误切到「对话」
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
            const index = Number(event.key) - 1;
            if (index >= 0 && index < items.length) {
              event.preventDefault();
              buttonRefs.current[index]?.focus();
              select(index);
            }
          }}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            const isHome = item.id === "home";
            const selected = active != null && item.id === active;
            return (
              <button
                key={item.id}
                ref={(node) => {
                  buttonRefs.current[index] = node;
                }}
                type="button"
                className="gfn-trigger"
                data-item={item.id}
                data-active={selected ? "true" : "false"}
                aria-current={selected ? "page" : undefined}
                aria-label={item.label}
                aria-keyshortcuts={
                  item.shortcut
                    ? item.shortcut.replace("⌘", "Meta+").replace(/\d/, (d) => d)
                    : undefined
                }
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch") show(index);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType !== "touch") leave();
                }}
                onFocus={() => show(index)}
                onBlur={leave}
                onClick={() => select(index)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowDown" || event.key === "ArrowRight")
                    next = (index + 1) % items.length;
                  else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
                    next = (index + items.length - 1) % items.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = items.length - 1;
                  else if (event.key === "Escape") {
                    event.preventDefault();
                    hide(true);
                    return;
                  } else return;
                  event.preventDefault();
                  buttonRefs.current[next]?.focus();
                }}
                style={{
                  position: "relative",
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 56px",
                  width: 56,
                  height: 56,
                  padding: 0,
                  border: 0,
                  borderRadius: 18,
                  // 声明式选中：不依赖 gsap 异步回调，设置页内操作也不会掉回对话底
                  background: selected
                    ? "var(--nav-item-active-bg)"
                    : hint === index
                      ? "var(--nav-item-hover-bg)"
                      : "transparent",
                  color: selected ? "var(--nav-icon-active)" : "var(--nav-icon)",
                  boxShadow: selected
                    ? "inset 0 0 0 1px var(--nav-item-active-ring)"
                    : "inset 0 0 0 1px transparent",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  touchAction: "manipulation",
                  outlineOffset: 4,
                  transition: prefersReduced
                    ? undefined
                    : "background-color 0.13s ease, color 0.13s ease, box-shadow 0.13s ease",
                }}
              >
                {isHome ? (
                  <img
                    className="gfn-logo"
                    src={resolvedLogo}
                    alt=""
                    draggable={false}
                    onError={(event) => {
                      const img = event.currentTarget;
                      if (img.src !== giteamLogo) img.src = giteamLogo;
                    }}
                    style={{
                      display: "block",
                      width: 28,
                      height: 28,
                      objectFit: "contain",
                      border: "1px solid var(--nav-logo-border)",
                      borderRadius: "50%",
                      background: "var(--nav-logo-bg)",
                      padding: 0,
                      boxSizing: "border-box",
                      pointerEvents: "none",
                      filter: "var(--nav-logo-filter, none)",
                      // 未选中时压暗，避免 Logo 圆标被误认为「对话」选中
                      opacity: selected ? 1 : 0.55,
                      transition: "opacity 0.13s ease",
                    }}
                  />
                ) : Icon ? (
                  <Icon className="size-[22px]" strokeWidth={1.6} aria-hidden />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div
          ref={tipRef}
          id={tipIdRef.current}
          role="tooltip"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 78,
            top: 8,
            width: 160,
            height: 56,
            overflow: "hidden",
            borderRadius: 28,
            background: "var(--nav-tooltip-bg)",
            border: "1px solid transparent",
            boxShadow: "0 6px 22px rgba(27, 32, 58, 0.18)",
            color: "var(--nav-tooltip-fg)",
            pointerEvents: "none",
            opacity: 0,
            willChange: "transform,width,opacity",
            // 高于会话栏（3）；父级 .wb-activity 在 tip 打开时也会抬到 5
            zIndex: 20,
          }}
        >
          <div
            ref={trackRef}
            style={{
              position: "absolute",
              left: 20,
              top: 0,
              willChange: "transform",
            }}
          >
            {items.map((item, index) => (
              <div
                key={item.id}
                ref={(node) => {
                  rowRefs.current[index] = node;
                }}
                className="gfn-label-row"
                data-label={item.id}
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  height: 56,
                  width: "max-content",
                  whiteSpace: "nowrap",
                  fontSize: 18,
                  fontWeight: 600,
                  lineHeight: "24px",
                  letterSpacing: "-0.4px",
                  color: "var(--nav-tooltip-fg)",
                }}
              >
                <span className="gfn-label">{item.label}</span>
                {item.shortcut ? (
                  <kbd
                    style={{
                      minWidth: 40,
                      padding: 0,
                      background: "none",
                      border: 0,
                      font: "600 18px/24px Inter, Arial, Helvetica, sans-serif",
                      letterSpacing: "-0.6px",
                      color: "var(--nav-tooltip-muted)",
                    }}
                  >
                    {item.shortcut}
                  </kbd>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {onOpenMobile ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 14,
            zIndex: 3,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            aria-label={mobileConnected ? "手机已连接" : "连接手机"}
            title={mobileConnected ? "手机已连接" : "连接手机"}
            onClick={onOpenMobile}
            style={{
              position: "relative",
              display: "grid",
              placeItems: "center",
              width: 44,
              height: 44,
              padding: 0,
              border: "1px solid var(--chrome-line)",
              borderRadius: 16,
              background: "color-mix(in srgb, var(--bg) 40%, transparent)",
              color: "var(--nav-icon)",
              cursor: "pointer",
              pointerEvents: "auto",
              WebkitTapHighlightColor: "transparent",
              touchAction: "manipulation",
            }}
          >
            <Smartphone className="size-[18px]" strokeWidth={1.6} aria-hidden />
            {mobileConnected ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--success)",
                  boxShadow: "0 0 0 2px var(--activity-bg)",
                }}
              />
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

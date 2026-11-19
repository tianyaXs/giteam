import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import type { RepositoryEntry } from "../../lib/types";
import type { ChatSessionSummary } from "../../lib/agentSessions";
import {
  GlassFolder,
  type GlassFolderOptions,
} from "../glass-folder/GlassFolder";
import type { GlassFolderArt, GlassFolderFile } from "../glass-folder/GlassFolderEngine";

const ART_CYCLE: GlassFolderArt[] = [
  "aurora",
  "ember",
  "glacier",
  "dusk",
  "verdant",
];

/**
 * 画廊货架：拱桥只承载项目；添加入口沉到桥下，克制、安静。
 */
const CARD_WIDTH = 236;
const CARD_HEIGHT = 252;
const MAX_SESSION_SHEETS = 4;
const STEP_X = 176;
const ARCH_Y = 14;
const ROTATE_Y = 10;
const SCALE_STEP = 0.07;
const DEPTH_Z = 24;
const VISIBLE_SPAN = 2.35;

function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function formatSessionMeta(updatedAt: number): string {
  if (!updatedAt) return "会话";
  const diff = Date.now() - updatedAt;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
  if (diff < 86_400_000 * 7) return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`;
  try {
    return new Date(updatedAt).toLocaleDateString();
  } catch {
    return "会话";
  }
}

function buildSessionSheets(
  sessions: ChatSessionSummary[],
  art: GlassFolderArt
): GlassFolderFile[] {
  if (sessions.length === 0) {
    return [
      {
        id: "__empty__",
        name: "暂无会话",
        meta: "打开仓库后新建",
      },
    ];
  }
  return sessions.slice(0, MAX_SESSION_SHEETS).map((session, index) => ({
    id: session.id,
    name: session.title.trim() || "未命名会话",
    meta: formatSessionMeta(session.updatedAt || session.createdAt),
    art:
      index === 0
        ? art
        : index === 1
          ? ART_CYCLE[(ART_CYCLE.indexOf(art) + 2) % ART_CYCLE.length]
          : undefined,
  }));
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function shelfStyle(
  offset: number,
  reduceMotion: boolean | null
): { transform: string; opacity: number; zIndex: number } {
  const abs = Math.abs(offset);
  if (reduceMotion) {
    return {
      transform: `translateX(${offset * (CARD_WIDTH + 24)}px)`,
      opacity: abs > 1.6 ? 0 : 1,
      zIndex: Math.round(40 - abs * 4),
    };
  }

  const y = abs * ARCH_Y + abs * abs * 3;
  const scale = Math.max(0.78, 1 - abs * SCALE_STEP);
  const z = abs < 0.5 ? 18 : -abs * DEPTH_Z;
  const rot = -offset * ROTATE_Y;
  const opacity =
    abs > VISIBLE_SPAN
      ? 0
      : abs <= 1
        ? 1
        : Math.max(0, 1 - (abs - 1) * 0.55);

  return {
    transform: `translateX(${offset * STEP_X}px) translateY(${y}px) translateZ(${z}px) rotateY(${rot}deg) scale(${scale})`,
    opacity,
    zIndex: Math.round(60 - abs * 10),
  };
}

/** 桥下动作：暗色玻璃轻触，与文件夹同语汇，无独立容器。 */
function AddProjectCue(props: {
  empty?: boolean;
  onAdd: () => void;
}) {
  const { empty, onAdd } = props;
  return (
    <button
      type="button"
      onClick={onAdd}
      className={[
        "group inline-flex items-center gap-2 rounded-full border border-white/10",
        "bg-[rgba(22,22,26,0.78)] text-[#f5f5f7] backdrop-blur-xl",
        "shadow-[0_10px_28px_-16px_rgba(0,0,0,0.5)]",
        "transition-[transform,background-color,box-shadow] duration-300",
        "hover:-translate-y-0.5 hover:bg-[rgba(32,32,36,0.88)]",
        "active:translate-y-0 active:scale-[0.98]",
        empty ? "px-5 py-3" : "px-3.5 py-2",
      ].join(" ")}
    >
      <span
        className={[
          "grid place-items-center rounded-full bg-white/10 text-white/85",
          "transition-colors group-hover:bg-white/14",
          empty ? "h-7 w-7" : "h-5 w-5",
        ].join(" ")}
      >
        <svg viewBox="0 0 24 24" className={empty ? "h-3.5 w-3.5" : "h-3 w-3"} fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      {empty ? (
        <span className="flex flex-col items-start leading-tight">
          <span className="text-[13.5px] font-medium tracking-tight">添加项目</span>
          <span className="text-[11px] text-white/42">导入本地仓库</span>
        </span>
      ) : (
        <span className="text-[12.5px] font-medium tracking-tight text-white/88">添加项目</span>
      )}
    </button>
  );
}

type BridgeItem = {
  key: string;
  repo: RepositoryEntry;
  options: GlassFolderOptions;
};

export function LocalReposOverview(props: {
  repos: RepositoryEntry[];
  selectedRepoId: string | null;
  sessionsByRepoId: Record<string, ChatSessionSummary[]>;
  ensureRepoSessions: (repo: RepositoryEntry) => void;
  onSelectRepo: (repo: RepositoryEntry) => void;
  onOpenRepo: (repo: RepositoryEntry) => void;
  onOpenSession: (repo: RepositoryEntry, session: ChatSessionSummary) => void;
  onCloseProject: (repo: RepositoryEntry) => void;
  onAddProject: () => void;
  /**
   * 仅首次挂载可开轻微进场。保活显隐时务必 false，
   * 避免每次回首页重跑 filter/blur 与卡片弹簧。
   */
  animateEnter?: boolean;
}) {
  const {
    repos,
    selectedRepoId,
    sessionsByRepoId,
    ensureRepoSessions,
    onSelectRepo,
    onOpenRepo,
    onOpenSession,
    onCloseProject,
    onAddProject,
    animateEnter = false,
  } = props;
  const reduceMotion = useReducedMotion();
  const onOpenRepoRef = useRef(onOpenRepo);
  const onOpenSessionRef = useRef(onOpenSession);
  const onCloseProjectRef = useRef(onCloseProject);
  const onAddProjectRef = useRef(onAddProject);
  const onSelectRepoRef = useRef(onSelectRepo);
  onOpenRepoRef.current = onOpenRepo;
  onOpenSessionRef.current = onOpenSession;
  onCloseProjectRef.current = onCloseProject;
  onAddProjectRef.current = onAddProject;
  onSelectRepoRef.current = onSelectRepo;

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    origin: number;
    moved: boolean;
  } | null>(null);
  const wheelLockRef = useRef(0);
  const [focus, setFocus] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    for (const repo of repos) ensureRepoSessions(repo);
  }, [ensureRepoSessions, repos]);

  const items = useMemo<BridgeItem[]>(() => {
    return repos.map((repo, index) => {
      const seed = hashSeed(repo.id || repo.path);
      const art = ART_CYCLE[index % ART_CYCLE.length];
      const sessions = sessionsByRepoId[repo.id] || [];
      return {
        key: repo.id,
        repo,
        options: {
          label: repo.name || repo.path,
          tone: "dark",
          art,
          seed: seed % 997,
          action: "more",
          hideFeedback: true,
          height: CARD_HEIGHT,
          files: buildSessionSheets(sessions, art),
          onActivate: () => onOpenRepoRef.current(repo),
          onSelectFile: (file) => {
            const sid = String(file.id || "").trim();
            if (!sid || sid === "__empty__") {
              onOpenRepoRef.current(repo);
              return;
            }
            const hit = sessions.find((session) => session.id === sid);
            if (hit) onOpenSessionRef.current(repo, hit);
            else onOpenRepoRef.current(repo);
          },
          onRemove: () => onCloseProjectRef.current(repo),
        },
      };
    });
  }, [repos, sessionsByRepoId]);

  const maxIndex = Math.max(0, items.length - 1);
  const empty = items.length === 0;

  const syncFocusToSelection = useEffectEvent((repoId: string | null) => {
    if (!repoId) return;
    const idx = items.findIndex((item) => item.repo.id === repoId);
    if (idx >= 0) setFocus(idx);
  });

  useEffect(() => {
    syncFocusToSelection(selectedRepoId);
  }, [selectedRepoId, items]);

  useEffect(() => {
    setFocus((prev) => clamp(prev, 0, maxIndex));
  }, [maxIndex]);

  const moveBy = (delta: number) => {
    if (empty) return;
    setFocus((prev) => clamp(prev + delta, 0, maxIndex));
    setDragOffset(0);
  };

  const goTo = (index: number) => {
    setFocus(clamp(index, 0, maxIndex));
    setDragOffset(0);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || empty) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      origin: focus + dragOffset,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 12) {
      drag.moved = true;
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!drag.moved) return;
    setDragOffset(-dx / STEP_X);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!drag.moved) {
      setDragOffset(0);
      return;
    }
    const next = clamp(
      Math.round(drag.origin - (event.clientX - drag.startX) / STEP_X),
      0,
      maxIndex
    );
    setFocus(next);
    setDragOffset(0);
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (empty) return;
    const dominant =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(dominant) < 10) return;
    event.preventDefault();
    const now = Date.now();
    if (now - wheelLockRef.current < 280) return;
    wheelLockRef.current = now;
    moveBy(dominant > 0 ? 1 : -1);
  };

  const visualFocus = focus + dragOffset;
  const focusItem = items[focus];
  const focusLabel = focusItem?.repo.name || focusItem?.repo.path || "";

  return (
    <motion.div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--activity-bg)]"
      initial={
        animateEnter && !reduceMotion
          ? { opacity: 0, x: -20 }
          : false
      }
      animate={{ opacity: 1, x: 0 }}
      transition={
        reduceMotion || !animateEnter
          ? { duration: 0 }
          : { type: "spring", stiffness: 420, damping: 38, mass: 0.85 }
      }
    >
      <div className="mx-auto flex w-full max-w-[min(1100px,100%)] items-center justify-between gap-4 px-6 pb-0 pt-7">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight text-foreground/95">
            首页
          </div>
          <div className="mt-0.5 truncate text-[12px] text-foreground/38">
            {empty ? "本地项目会落在这里" : focusLabel}
            {!empty && items.length > 1 ? (
              <span className="text-foreground/22">
                {" "}
                · {focus + 1}/{items.length}
              </span>
            ) : null}
          </div>
        </div>
        {!empty && items.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {items.map((item, index) => (
              <button
                key={`dot-${item.key}`}
                type="button"
                aria-label={item.repo.name || item.repo.path}
                className={[
                  "rounded-full transition-all duration-300",
                  index === focus
                    ? "h-1 w-3.5 bg-foreground/42"
                    : "h-1 w-1 bg-foreground/14 hover:bg-foreground/26",
                ].join(" ")}
                onClick={() => goTo(index)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background:
              "linear-gradient(90deg, var(--activity-bg) 0%, transparent 14%, transparent 86%, var(--activity-bg) 100%)",
          }}
        />

        <div
          className={[
            "absolute inset-0",
            empty ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          ].join(" ")}
          style={{
            perspective: reduceMotion || empty ? undefined : "2400px",
            perspectiveOrigin: "50% 36%",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
          role="listbox"
          aria-label="本地项目"
          tabIndex={0}
          onKeyDown={(event) => {
            if (empty) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              moveBy(-1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              moveBy(1);
            } else if (event.key === "Home") {
              event.preventDefault();
              goTo(0);
            } else if (event.key === "End") {
              event.preventDefault();
              goTo(maxIndex);
            }
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[50%] h-[20%] w-[min(600px,58%)] -translate-x-1/2 rounded-[100%] opacity-55"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(15,16,20,0.055), transparent 70%)",
            }}
          />

          {empty ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-5 px-6 text-center">
                <div className="max-w-[260px]">
                  <div className="text-[15px] font-medium tracking-tight text-foreground/70">
                    还没有本地项目
                  </div>
                  <div className="mt-1.5 text-[12px] leading-relaxed text-foreground/38">
                    导入一个仓库，它会出现在这座拱桥上
                  </div>
                </div>
                <AddProjectCue empty onAdd={() => onAddProjectRef.current()} />
              </div>
            </div>
          ) : (
            <>
              <div
                className="absolute left-1/2 top-[36%] h-0 w-0"
                style={{ transformStyle: "preserve-3d" }}
              >
                {items.map((item, index) => {
                  const offset = index - visualFocus;
                  const abs = Math.abs(offset);
                  if (abs > VISIBLE_SPAN) return null;
                  const focused = abs < 0.55;
                  const style = shelfStyle(offset, reduceMotion);
                  return (
                    <div
                      key={item.key}
                      role="option"
                      aria-selected={focused}
                      className="absolute left-0 top-0 will-change-transform"
                      style={{
                        width: CARD_WIDTH,
                        height: CARD_HEIGHT,
                        marginLeft: -CARD_WIDTH / 2,
                        marginTop: -CARD_HEIGHT / 2,
                        transform: style.transform,
                        opacity: style.opacity,
                        zIndex: focused ? 100 : style.zIndex,
                        transition: dragging
                          ? "none"
                          : reduceMotion
                            ? "transform 160ms ease, opacity 160ms ease"
                            : "transform 580ms cubic-bezier(.22,1,.36,1), opacity 380ms ease",
                        pointerEvents: abs < 1.25 ? "auto" : "none",
                        transformStyle: "preserve-3d",
                      }}
                      onClick={(event) => {
                        if (dragRef.current?.moved) {
                          event.preventDefault();
                          event.stopPropagation();
                          return;
                        }
                        if (!focused) {
                          event.preventDefault();
                          event.stopPropagation();
                          goTo(index);
                          onSelectRepoRef.current(item.repo);
                        }
                      }}
                    >
                      <div className="relative overflow-visible has-[[data-gf-open]]:z-40">
                        <GlassFolder className="w-full" options={item.options} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 仅暗色添加贴在桥下，无灰底容器 */}
              <div
                className="pointer-events-auto absolute left-1/2 z-[6] -translate-x-1/2"
                style={{ top: "calc(36% + 142px)" }}
              >
                <AddProjectCue onAdd={() => onAddProjectRef.current()} />
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

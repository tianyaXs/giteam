import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ElasticSplitter } from "../components/elastic-panel-resize/ElasticSplitter";

export type PanelPlacement = "bottom" | "right" | "hidden";

const SIDEBAR_MIN_WIDTH = 292;
const SIDEBAR_MAX_WIDTH = 340;
const RIGHT_PANEL_MIN_WIDTH = 520;
const RIGHT_PANEL_MAX_WIDTH = 1120;

export function Workbench(props: {
  activityBar: ReactNode;
  sideBar: ReactNode;
  editor: ReactNode;
  panel: ReactNode;
  panelPlacement: PanelPlacement;
  sidebarWidth: number;
  rightPanelWidth?: number;
  sidebarCollapsed?: boolean;
  sidebarResizing: boolean;
  rightPanelResizing?: boolean;
  onSidebarWidthChange: (width: number) => void;
  onRightPanelWidthChange?: (width: number) => void;
  onSidebarResizeStart?: () => void;
  onSidebarResizeEnd?: () => void;
  onRightPanelResizeStart?: () => void;
  onRightPanelResizeEnd?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  // 临界阻尼（damping≈2√(stiffness·mass)≈36.4）：消除 width 过冲，让 editor 宽度随
  // 侧栏收放单调变化 → contentLeft（纯 CSS calc 即时跟随）单调 → 消息流/进度卡/标题不再来回滑动。
  const sidebarTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 360, damping: 38, mass: 0.92 };
  const splitterTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
  const cls =
    (props.panelPlacement === "right"
      ? "wb wb-panel-right"
      : props.panelPlacement === "hidden"
        ? "wb wb-panel-hidden"
        : "wb wb-panel-bottom") +
    (!props.activityBar ? " wb-no-activity" : "") +
    (props.sidebarCollapsed ? " wb-sidebar-collapsed" : "");
  const resolvedSidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(props.sidebarWidth)));
  const resolvedRightPanelWidth = Math.round(props.rightPanelWidth ?? 520);
  const hasActivity = Boolean(props.activityBar);
  const rightPanelOpen = props.panelPlacement === "right";
  const style = {
    "--wb-sidebar-width": `${resolvedSidebarWidth}px`,
    "--wb-sidebar-current-width": props.sidebarCollapsed ? "0px" : `${resolvedSidebarWidth}px`,
    "--wb-right-width": `${resolvedRightPanelWidth}px`,
    display: "flex",
    flexDirection: "row",
    width: "100vw",
    height: "100vh",
    overflow: "hidden"
  } as CSSProperties;

  return (
    <div className={cls} style={style}>
      <aside
        className="wb-activity"
        style={{
          display: hasActivity ? "block" : "none",
          flex: hasActivity ? "0 0 56px" : "0 0 0px",
          width: hasActivity ? 56 : 0
        }}
      >
        {props.activityBar}
      </aside>
      <motion.aside
        className="wb-sidebar"
        initial={false}
        animate={props.sidebarCollapsed
          ? { width: 0, opacity: 0, x: -18, scale: 0.985 }
          : { width: resolvedSidebarWidth, opacity: 1, x: 0, scale: 1 }}
        transition={sidebarTransition}
        style={{
          flex: "0 0 auto",
          width: props.sidebarCollapsed ? 0 : resolvedSidebarWidth,
          minWidth: 0,
          overflow: "hidden"
        }}
      >
        {props.sideBar}
      </motion.aside>
      <motion.div
        className={props.sidebarResizing ? "wb-splitter wb-splitter-left active" : "wb-splitter wb-splitter-left"}
        initial={false}
        animate={props.sidebarCollapsed ? { width: 0, opacity: 0, x: -8 } : { width: 32, opacity: 1, x: 0 }}
        transition={splitterTransition}
        style={{
          flex: "0 0 auto",
          width: props.sidebarCollapsed ? 0 : 32,
          minWidth: 0,
          marginLeft: props.sidebarCollapsed ? 0 : -16,
          marginRight: props.sidebarCollapsed ? 0 : -16,
          pointerEvents: props.sidebarCollapsed ? "none" : "auto"
        }}
      >
        {!props.sidebarCollapsed ? (
          <ElasticSplitter
            value={resolvedSidebarWidth}
            min={SIDEBAR_MIN_WIDTH}
            max={SIDEBAR_MAX_WIDTH}
            direction="grow-right"
            ariaLabel="调整侧栏宽度"
            onChange={props.onSidebarWidthChange}
            onDragStart={props.onSidebarResizeStart}
            onDragEnd={props.onSidebarResizeEnd}
          />
        ) : null}
      </motion.div>
      <section
        className="wb-editor"
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          height: "100%"
        }}
      >
        {props.editor}
      </section>
      <motion.div
        className={props.rightPanelResizing ? "wb-splitter wb-splitter-right active" : "wb-splitter wb-splitter-right"}
        aria-hidden={!rightPanelOpen}
        initial={false}
        animate={rightPanelOpen ? { width: 32, opacity: 1, x: 0 } : { width: 0, opacity: 0, x: 8 }}
        transition={splitterTransition}
        style={{
          flex: "0 0 auto",
          width: rightPanelOpen ? 32 : 0,
          minWidth: 0,
          marginLeft: rightPanelOpen ? -16 : 0,
          marginRight: rightPanelOpen ? -16 : 0,
          pointerEvents: rightPanelOpen ? "auto" : "none"
        }}
      >
        {rightPanelOpen && props.onRightPanelWidthChange ? (
          <ElasticSplitter
            value={resolvedRightPanelWidth}
            min={RIGHT_PANEL_MIN_WIDTH}
            max={RIGHT_PANEL_MAX_WIDTH}
            direction="grow-left"
            ariaLabel="调整右侧面板宽度"
            onChange={props.onRightPanelWidthChange}
            onDragStart={props.onRightPanelResizeStart}
            onDragEnd={props.onRightPanelResizeEnd}
          />
        ) : null}
      </motion.div>
      <motion.section
        className="wb-panel"
        aria-hidden={!rightPanelOpen}
        initial={false}
        animate={rightPanelOpen
          ? { width: resolvedRightPanelWidth, opacity: 1, x: 0, scale: 1 }
          : { width: 0, opacity: 0, x: 28, scale: 0.985 }}
        transition={sidebarTransition}
        style={{
          display: "flex",
          flex: "0 0 auto",
          width: rightPanelOpen ? resolvedRightPanelWidth : 0,
          minWidth: 0,
          pointerEvents: rightPanelOpen ? "auto" : "none",
          overflow: "hidden",
          borderTop: 0,
          borderLeft: rightPanelOpen ? "1px solid var(--line)" : 0
        }}
      >
        {props.panel}
      </motion.section>
    </div>
  );
}

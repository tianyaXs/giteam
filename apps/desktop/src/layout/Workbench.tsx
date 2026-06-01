import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export type PanelPlacement = "bottom" | "right" | "hidden";

export function Workbench(props: {
  activityBar: ReactNode;
  sideBar: ReactNode;
  editor: ReactNode;
  panel: ReactNode;
  panelPlacement: PanelPlacement;
  sidebarWidth: number;
  sidebarCollapsed?: boolean;
  sidebarResizing: boolean;
  onSidebarResizeStart: MouseEventHandler<HTMLDivElement>;
}) {
  const reduceMotion = useReducedMotion();
  const sidebarTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 360, damping: 34, mass: 0.92 };
  const splitterTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
  const cls =
    (props.panelPlacement === "right"
      ? "wb wb-panel-right"
      : props.panelPlacement === "hidden"
        ? "wb wb-panel-hidden"
        : "wb wb-panel-bottom") +
    (props.sidebarCollapsed ? " wb-sidebar-collapsed" : "");
  const style = {
    "--wb-sidebar-width": `${props.sidebarWidth}px`,
    "--wb-sidebar-current-width": props.sidebarCollapsed ? "0px" : `${props.sidebarWidth}px`
  } as CSSProperties;

  return (
    <div className={cls} style={style}>
      <aside className="wb-activity">{props.activityBar}</aside>
      <motion.aside
        className="wb-sidebar"
        initial={false}
        animate={props.sidebarCollapsed
          ? { opacity: 0, x: -22, scale: 0.985 }
          : { opacity: 1, x: 0, scale: 1 }}
        transition={sidebarTransition}
      >
        {props.sideBar}
      </motion.aside>
      <motion.div
        className={props.sidebarResizing ? "wb-splitter wb-splitter-left active" : "wb-splitter wb-splitter-left"}
        role="separator"
        aria-orientation="vertical"
        initial={false}
        animate={props.sidebarCollapsed ? { opacity: 0, x: -14 } : { opacity: 1, x: 0 }}
        transition={splitterTransition}
        onMouseDown={props.sidebarCollapsed ? undefined : props.onSidebarResizeStart}
      />
      <section className="wb-editor">{props.editor}</section>
      <section className="wb-panel">{props.panel}</section>
    </div>
  );
}

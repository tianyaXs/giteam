import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

export type PanelPlacement = "bottom" | "right" | "hidden";

export function Workbench(props: {
  activityBar: ReactNode;
  sideBar: ReactNode;
  editor: ReactNode;
  panel: ReactNode;
  statusBar: ReactNode;
  panelPlacement: PanelPlacement;
  sidebarWidth: number;
  sidebarCollapsed?: boolean;
  sidebarResizing: boolean;
  onSidebarResizeStart: MouseEventHandler<HTMLDivElement>;
}) {
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
      <aside className="wb-sidebar">{props.sideBar}</aside>
      <div
        className={props.sidebarResizing ? "wb-splitter wb-splitter-left active" : "wb-splitter wb-splitter-left"}
        role="separator"
        aria-orientation="vertical"
        onMouseDown={props.sidebarCollapsed ? undefined : props.onSidebarResizeStart}
      />
      <section className="wb-editor">{props.editor}</section>
      <section className="wb-panel">{props.panel}</section>
      <footer className="wb-status">{props.statusBar}</footer>
    </div>
  );
}

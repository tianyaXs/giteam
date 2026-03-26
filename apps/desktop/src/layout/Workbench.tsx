import type { ReactNode } from "react";

export type PanelPlacement = "bottom" | "right" | "hidden";

export function Workbench(props: {
  activityBar: ReactNode;
  sideBar: ReactNode;
  editor: ReactNode;
  panel: ReactNode;
  statusBar: ReactNode;
  panelPlacement: PanelPlacement;
}) {
  const cls =
    props.panelPlacement === "right"
      ? "wb wb-panel-right"
      : props.panelPlacement === "hidden"
        ? "wb wb-panel-hidden"
        : "wb wb-panel-bottom";

  return (
    <div className={cls}>
      <aside className="wb-activity">{props.activityBar}</aside>
      <aside className="wb-sidebar">{props.sideBar}</aside>
      <section className="wb-editor">{props.editor}</section>
      <section className="wb-panel">{props.panel}</section>
      <footer className="wb-status">{props.statusBar}</footer>
    </div>
  );
}


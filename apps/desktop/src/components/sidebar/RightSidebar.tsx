import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import {
  PINNED_RIGHT_PANE_TAB,
  RIGHT_PANE_TAB_ICONS,
  type RightPaneTab,
} from "../common/AppChromeIcons";
import { cn } from "../../lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "../ui/sidebar";

type RightSidebarProps = {
  openTabs: RightPaneTab[];
  activeTab: RightPaneTab;
  tabLabels: Record<RightPaneTab, string>;
  fileTabLabel?: string;
  closeFileLabel: string;
  closeTabLabel: string;
  children: ReactNode;
  onSelectTab: (tab: RightPaneTab) => void;
  onCloseTab: (tab: RightPaneTab) => void;
  onCloseFileTab: () => void;
};

export type RightSidebarPanelVariant = "default" | "workspace" | "terminal";

type RightSidebarPanelProps = {
  variant?: RightSidebarPanelVariant;
  children: ReactNode;
};

export const RightSidebarPanel = forwardRef<HTMLDivElement, RightSidebarPanelProps>(
  function RightSidebarPanel({ variant = "default", children }, ref) {
    const bleed = variant === "workspace" || variant === "terminal";

    return (
      <div
        ref={ref}
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden",
          bleed ? "border-0 bg-transparent" : "rounded-lg border border-border bg-card"
        )}
      >
        <div
          className={cn(
            "min-h-0 flex-1",
            variant === "terminal" ? "overflow-hidden p-0" : "overflow-auto",
            variant === "workspace" ? "p-0" : null,
            variant === "default" ? "p-2.5" : null
          )}
        >
          {children}
        </div>
      </div>
    );
  }
);

export function RightSidebar({
  openTabs,
  activeTab,
  tabLabels,
  fileTabLabel,
  closeFileLabel,
  closeTabLabel,
  children,
  onSelectTab,
  onCloseTab,
  onCloseFileTab,
}: RightSidebarProps) {
  return (
    <Sidebar
      side="right"
      collapsible="none"
      className="h-full overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={{
        "--sidebar": "color-mix(in srgb, var(--bg) 92%, #8f8270 8%)",
        backgroundColor: "var(--sidebar)",
      } as CSSProperties}
    >
      <SidebarHeader className="h-10 shrink-0 border-b-0 bg-background py-0 pl-2 pr-11">
        <div className="flex h-full min-w-0 items-center" data-tauri-drag-region>
          {/* 轻量 tab 区：选中态是柔和胶囊底色，图标与关闭钮保持细粒度，去掉描边与厚重 Badge */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {openTabs.map((tab) => {
              const Icon = RIGHT_PANE_TAB_ICONS[tab];
              const isActive = activeTab === tab;
              const isPinned = tab === PINNED_RIGHT_PANE_TAB;

              return (
                <div
                  key={tab}
                  className={cn(
                    "group/tab flex h-7 shrink-0 items-center rounded-full text-xs transition-[background-color,color]",
                    isActive
                      ? "bg-[color-mix(in_srgb,#8f8270_15%,var(--bg)_85%)] text-sidebar-foreground"
                      : "text-muted-foreground hover:bg-[color-mix(in_srgb,#8f8270_8%,transparent)] hover:text-sidebar-foreground"
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "flex h-full min-w-0 items-center gap-1.5 rounded-full border-0 bg-transparent pl-2.5 outline-none ring-sidebar-ring focus-visible:ring-2",
                      isPinned ? "pr-2.5" : "pr-1"
                    )}
                    title={tabLabels[tab]}
                    aria-label={tabLabels[tab]}
                    aria-pressed={isActive}
                    onClick={() => onSelectTab(tab)}
                  >
                    <Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                    <span className={cn("max-w-[88px] truncate", isActive && "font-medium")}>{tabLabels[tab]}</span>
                  </button>
                  {!isPinned ? (
                    <button
                      type="button"
                      className={cn(
                        "mr-1.5 flex size-4 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-muted-foreground outline-none ring-sidebar-ring transition-[opacity,background-color,color] hover:bg-[color-mix(in_srgb,#8f8270_16%,transparent)] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2",
                        isActive ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70"
                      )}
                      title={`${closeTabLabel} ${tabLabels[tab]}`}
                      aria-label={`${closeTabLabel} ${tabLabels[tab]}`}
                      onClick={() => onCloseTab(tab)}
                    >
                      <XIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}

            {fileTabLabel ? (
              <div className="flex h-7 min-w-0 max-w-[min(240px,55vw)] shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,#8f8270_15%,var(--bg)_85%)] pl-2.5 pr-1.5 text-xs text-sidebar-foreground">
                <span className="min-w-0 truncate font-medium">{fileTabLabel}</span>
                <button
                  type="button"
                  className="flex size-4 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-muted-foreground outline-none ring-sidebar-ring transition-[background-color,color] hover:bg-[color-mix(in_srgb,#8f8270_16%,transparent)] hover:text-foreground focus-visible:ring-2"
                  title={closeFileLabel}
                  aria-label={closeFileLabel}
                  onClick={onCloseFileTab}
                >
                  <XIcon className="size-3" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden p-0">
        {children}
      </SidebarContent>
    </Sidebar>
  );
}

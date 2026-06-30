import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { XIcon } from "lucide-react";

import {
  PINNED_RIGHT_PANE_TAB,
  RIGHT_PANE_TAB_ICONS,
  type RightPaneTab,
} from "../common/AppChromeIcons";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
        <div className="flex h-full min-w-0 items-center gap-1" data-tauri-drag-region>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {openTabs.map((tab) => {
              const Icon = RIGHT_PANE_TAB_ICONS[tab];
              const isActive = activeTab === tab;
              const isPinned = tab === PINNED_RIGHT_PANE_TAB;

              return (
                <Badge
                  key={tab}
                  variant={isActive ? "secondary" : "outline"}
                  className={cn(
                    "h-7 shrink-0 gap-0 rounded-md border-[color-mix(in_srgb,#8f8270_16%,transparent)] px-0.5 font-normal",
                    isActive
                      ? "bg-[color-mix(in_srgb,#8f8270_17%,var(--bg)_83%)] text-sidebar-foreground"
                      : "bg-transparent text-muted-foreground"
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 rounded-sm px-1.5 hover:bg-transparent"
                    title={tabLabels[tab]}
                    aria-label={tabLabels[tab]}
                    aria-pressed={isActive}
                    onClick={() => onSelectTab(tab)}
                  >
                    <Icon data-icon="inline-start" aria-hidden="true" />
                    <span className="max-w-[88px] truncate text-xs">{tabLabels[tab]}</span>
                  </Button>
                  {!isPinned ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-sm text-muted-foreground hover:text-foreground"
                      title={`${closeTabLabel} ${tabLabels[tab]}`}
                      aria-label={`${closeTabLabel} ${tabLabels[tab]}`}
                      onClick={() => onCloseTab(tab)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  ) : null}
                </Badge>
              );
            })}

            {fileTabLabel ? (
              <Badge
                variant="secondary"
                className="h-7 min-w-0 max-w-[min(240px,55vw)] shrink-0 gap-1 rounded-md border-[color-mix(in_srgb,#8f8270_16%,transparent)] bg-[color-mix(in_srgb,#8f8270_17%,var(--bg)_83%)] px-2 text-sidebar-foreground normal-case tracking-normal"
              >
                <span className="min-w-0 truncate text-xs font-semibold">{fileTabLabel}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  title={closeFileLabel}
                  aria-label={closeFileLabel}
                  onClick={onCloseFileTab}
                >
                  <XIcon data-icon="inline-start" aria-hidden="true" />
                </Button>
              </Badge>
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

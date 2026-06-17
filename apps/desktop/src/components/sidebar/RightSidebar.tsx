import { forwardRef, type ReactNode } from "react";
import {
  GitBranchIcon,
  ListChecksIcon,
  PlugIcon,
  SparklesIcon,
  SquareTerminalIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import type { RightPaneTab } from "../common/AppChromeIcons";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "../ui/sidebar";

type RightSidebarProps = {
  activeTab: RightPaneTab;
  modules: Record<RightPaneTab, boolean>;
  tabLabels: Record<RightPaneTab, string>;
  fileTabLabel?: string;
  closeFileLabel: string;
  children: ReactNode;
  onSelectTab: (tab: RightPaneTab) => void;
  onWarmSkills: () => void | Promise<void>;
  onCloseFileTab: () => void;
};

type RightTabConfig = {
  tab: RightPaneTab;
  icon: LucideIcon;
};

const rightTabs: RightTabConfig[] = [
  { tab: "changes", icon: ListChecksIcon },
  { tab: "worktree", icon: GitBranchIcon },
  { tab: "terminal", icon: SquareTerminalIcon },
  { tab: "skills", icon: SparklesIcon },
  { tab: "mcp", icon: PlugIcon },
];

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
  activeTab,
  modules,
  tabLabels,
  fileTabLabel,
  closeFileLabel,
  children,
  onSelectTab,
  onWarmSkills,
  onCloseFileTab,
}: RightSidebarProps) {
  return (
    <Sidebar
      side="right"
      collapsible="none"
      className="h-full overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <SidebarHeader className="h-10 shrink-0 border-b border-sidebar-border px-3 py-0">
        <div className="flex h-full min-w-0 items-center gap-1" data-tauri-drag-region>
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            {rightTabs.map(({ tab, icon: Icon }) =>
              modules[tab] ? (
                <Button
                  key={tab}
                  variant={activeTab === tab ? "secondary" : "ghost"}
                  size="icon"
                  className={cn(
                    "size-7 rounded-md",
                    activeTab === tab ? "text-sidebar-accent-foreground" : "text-muted-foreground"
                  )}
                  title={tabLabels[tab]}
                  aria-label={tabLabels[tab]}
                  aria-pressed={activeTab === tab}
                  onClick={() => onSelectTab(tab)}
                  onMouseEnter={tab === "skills" ? () => void onWarmSkills() : undefined}
                  onFocus={tab === "skills" ? () => void onWarmSkills() : undefined}
                >
                  <Icon data-icon="inline-start" aria-hidden="true" />
                </Button>
              ) : null
            )}
          </div>

          {fileTabLabel ? (
            <div className="ml-2 flex min-w-[76px] max-w-[min(340px,100%)] flex-1 items-center">
              <Badge
                variant="secondary"
                className="h-7 min-w-0 max-w-full gap-1 rounded-md px-2 normal-case tracking-normal"
              >
                <span className="min-w-0 max-w-[260px] truncate text-xs font-semibold">{fileTabLabel}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 rounded-full text-muted-foreground hover:text-foreground"
                  title={closeFileLabel}
                  aria-label={closeFileLabel}
                  onClick={onCloseFileTab}
                >
                  <XIcon data-icon="inline-start" aria-hidden="true" />
                </Button>
              </Badge>
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-hidden p-0">
        {children}
      </SidebarContent>
    </Sidebar>
  );
}

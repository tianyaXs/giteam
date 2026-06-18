import type { CSSProperties } from "react";
import {
  GitBranchIcon,
  ListChecksIcon,
  PlugIcon,
  SparklesIcon,
  SquareTerminalIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import layoutSidebarIconUrl from "./layout_sidebar_icon_159994.png";
import layoutSidebarReverseIconUrl from "./layout_sidebar_reverse_icon_184859.png";

export type RightPaneTab = "worktree" | "changes" | "terminal" | "skills" | "mcp";

export const PINNED_RIGHT_PANE_TAB = "changes" satisfies RightPaneTab;

export type OptionalRightPaneTab = Exclude<RightPaneTab, typeof PINNED_RIGHT_PANE_TAB>;

export const RIGHT_PANE_TAB_ORDER: RightPaneTab[] = ["changes", "worktree", "terminal", "skills", "mcp"];

export const RIGHT_PANE_TAB_ICONS: Record<RightPaneTab, LucideIcon> = {
  changes: ListChecksIcon,
  worktree: GitBranchIcon,
  terminal: SquareTerminalIcon,
  skills: SparklesIcon,
  mcp: PlugIcon,
};

export function ShellPanelToggle(props: {
  side: "left" | "right";
  title: string;
  className?: string;
  style?: CSSProperties;
  onClick: () => void;
}) {
  const { side, title, className, style, onClick } = props;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-[26px] text-muted-foreground hover:bg-transparent hover:text-foreground",
        className
      )}
      style={style}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <PanelToggleIcon side={side} />
    </Button>
  );
}

export function PanelToggleIcon(props: { side: "left" | "right" }) {
  const iconUrl = props.side === "left" ? layoutSidebarIconUrl : layoutSidebarReverseIconUrl;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: 15,
        height: 15,
        backgroundColor: "currentColor",
        WebkitMaskImage: `url(${iconUrl})`,
        maskImage: `url(${iconUrl})`,
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain"
      }}
    />
  );
}

export function SendIcon(props: { busy: boolean }) {
  return props.busy ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="3" fill="currentColor" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5V16.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M7 10L12 4.5L17 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

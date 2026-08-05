import type { CSSProperties } from "react";
import {
  CloudIcon,
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

export type RightPaneTab = "worktree" | "changes" | "terminal" | "skills" | "mcp" | "remoteRepos";

export const PINNED_RIGHT_PANE_TAB = "changes" satisfies RightPaneTab;

export type OptionalRightPaneTab = Exclude<RightPaneTab, typeof PINNED_RIGHT_PANE_TAB>;

export const RIGHT_PANE_TAB_ORDER: RightPaneTab[] = ["changes", "worktree", "terminal", "remoteRepos", "skills", "mcp"];

export const RIGHT_PANE_TAB_ICONS: Record<RightPaneTab, LucideIcon> = {
  changes: ListChecksIcon,
  worktree: GitBranchIcon,
  terminal: SquareTerminalIcon,
  remoteRepos: CloudIcon,
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
        "size-7 text-muted-foreground hover:bg-transparent hover:text-foreground",
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
    // 箭头放大、线宽保持细精致，在圆钮里占更满的视觉比例。
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.25V18.25" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M5.75 10L12 3.25L18.25 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

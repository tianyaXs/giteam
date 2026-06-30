import { cn } from "../../lib/utils";
import { REMOTE_REPO_CONNECTION_META } from "./remoteRepoData";
import type { RemoteRepoConnectionStatus } from "./types";

export function RemoteRepoStatusBadge({
  status,
  compact = false,
  className,
}: {
  status: RemoteRepoConnectionStatus;
  compact?: boolean;
  className?: string;
}) {
  const meta = REMOTE_REPO_CONNECTION_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium",
        compact ? "border-0 bg-transparent px-0 py-0 text-[11px]" : "px-2 py-0.5 text-[11px]",
        !compact && meta.badgeClassName,
        compact && "text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dotClassName)} aria-hidden="true" />
      {!compact ? meta.label : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

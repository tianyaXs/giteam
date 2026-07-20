import { GitBranch, MoreHorizontal, Pencil, Pin, PinOff, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { getRemoteRepoOriginLabel } from "./remoteRepoData";
import { RemoteRepoStatusBadge } from "./RemoteRepoStatusBadge";
import type { RemoteRepo } from "./types";

export function RemoteRepoListItem({
  repo,
  currentProjectLinked,
  onOpen,
  onEdit,
  onSync,
  onRemove,
  onTogglePin,
}: {
  repo: RemoteRepo;
  currentProjectLinked: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onSync: () => void;
  onRemove: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div className="group flex w-full items-center gap-1 border-b border-border pr-2 last:border-b-0 hover:bg-[color-mix(in_srgb,var(--text)_3%,transparent)]">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-4 px-2 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] text-[var(--accent)]">
          <GitBranch className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{repo.displayName}</span>
            {repo.pinned ? <Pin className="size-3 text-muted-foreground" aria-label="已固定" /> : null}
            {currentProjectLinked ? <span className="rounded bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">当前项目</span> : null}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {repo.provider ? <span>{repo.provider}</span> : null}
            {repo.provider ? <span aria-hidden="true">·</span> : null}
            <span className="font-mono">{repo.branch}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate font-mono">{getRemoteRepoOriginLabel(repo.originUrl)}</span>
          </span>
        </span>
        <RemoteRepoStatusBadge status={repo.connectionStatus} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-foreground" aria-label={`${repo.displayName} 操作`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}><Pencil />编辑</DropdownMenuItem>
          <DropdownMenuItem disabled={repo.connectionStatus === "syncing" || repo.connectionStatus === "auth_required"} onClick={onSync}><RefreshCw />同步</DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePin}>{repo.pinned ? <PinOff /> : <Pin />}{repo.pinned ? "取消固定" : "固定到顶部"}</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onRemove}><Trash2 />移除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

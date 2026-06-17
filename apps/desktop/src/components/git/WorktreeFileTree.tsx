import type { ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GitWorktreeEntry } from "../../lib/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription } from "../ui/empty";
import { ChevronRightIcon } from "../icons";
import { GitStageToggle } from "./GitStageToggle";
import {
  collectWorktreeNodeEntries,
  collectWorktreeNodeFilePaths,
  getWorktreeDisplayStatus,
  type WorktreeTreeNode
} from "../../lib/worktreeDiff";

export type WorktreeFileTreeMode = "stage" | "unstage";

type WorktreeFileTreeProps = {
  nodes: WorktreeTreeNode[];
  mode?: WorktreeFileTreeMode;
  expandedDirs: string[];
  selectedFile: string;
  stagingFile: string;
  unstagingFile: string;
  discardingFile: string;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStagePaths: (paths: string[], label: string) => void;
  onUnstagePaths: (paths: string[], label: string) => void;
  onDiscardFile: (path: string, isUntracked: boolean) => void;
  onDiscardEntries: (entries: GitWorktreeEntry[], label: string) => void;
};

function WorktreeStatusBadge({ status }: { status: string }) {
  const variant = status.toLowerCase() === "d" ? "destructive" : status.toLowerCase() === "a" ? "success" : "secondary";

  return (
    <Badge variant={variant} className="min-w-5 justify-center px-1.5 tracking-normal">
      {status}
    </Badge>
  );
}

export function WorktreeFileTree({
  nodes,
  mode = "stage",
  expandedDirs,
  selectedFile,
  stagingFile,
  unstagingFile,
  discardingFile,
  onToggleDir,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onStagePaths,
  onUnstagePaths,
  onDiscardFile,
  onDiscardEntries
}: WorktreeFileTreeProps) {
  const collapseDirectoryNode = (node: WorktreeTreeNode) => {
    let current = node;
    const parts = [node.name];
    while (current.kind === "dir" && current.children.length === 1 && current.children[0]?.kind === "dir") {
      current = current.children[0];
      parts.push(current.name);
    }
    return {
      node: current,
      label: parts.join("/")
    };
  };

  const renderNodes = (items: WorktreeTreeNode[], depth: number): ReactNode => items.map((node) => {
    if (node.kind === "dir") {
      const collapsed = collapseDirectoryNode(node);
      const expanded = expandedDirs.includes(collapsed.node.path);
      const filePaths = collectWorktreeNodeFilePaths(collapsed.node);
      const entries = collectWorktreeNodeEntries(collapsed.node);
      const busyPath = mode === "stage" ? stagingFile : unstagingFile;
      const canDiscardDir = entries.some((entry) => entry.staged || entry.unstaged || entry.untracked);
      const containsSelected = selectedFile ? filePaths.includes(selectedFile) : false;
      return (
        <div key={node.path} className="flex flex-col gap-0">
          <div
            className={cn(
              "group relative flex min-h-7 items-center gap-1 rounded-md border border-transparent pr-1 transition-colors hover:bg-accent/60",
              containsSelected && "bg-accent/40 text-accent-foreground"
            )}
            style={{ paddingLeft: `${depth * 11 + 4}px` }}
            title={collapsed.node.path}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 flex-1 justify-start gap-1 px-0 text-xs font-normal hover:bg-transparent hover:text-inherit"
              onClick={() => onToggleDir(collapsed.node.path)}
              aria-pressed={expanded}
            >
              <ChevronRightIcon
                data-icon="inline-start"
                className={cn("transition-transform", expanded && "rotate-90")}
              />
              <span className="truncate">{collapsed.label}</span>
            </Button>
            <div className="flex min-w-0 items-center justify-end gap-1">
              <Badge variant="secondary" className="min-w-5 justify-center px-1.5 tracking-normal group-hover:opacity-0">
                {filePaths.length}
              </Badge>
              <div className="pointer-events-none absolute right-1 top-1/2 flex w-14 -translate-y-1/2 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                {canDiscardDir ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3.5"
                    title="丢弃此目录变更"
                    aria-label="丢弃此目录变更"
                    disabled={discardingFile === collapsed.node.path}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDiscardEntries(entries, collapsed.node.path);
                    }}
                  >
                    {discardingFile === collapsed.node.path ? "..." : <RotateCcwIcon aria-hidden="true" />}
                  </Button>
                ) : null}
                <GitStageToggle
                  checked={mode === "unstage"}
                  title={mode === "unstage" ? "取消暂存此目录" : "暂存此目录"}
                  disabled={busyPath === collapsed.node.path || filePaths.length === 0}
                  onChange={() => {
                    if (mode === "unstage") onUnstagePaths(filePaths, collapsed.node.path);
                    else onStagePaths(filePaths, collapsed.node.path);
                  }}
                />
              </div>
            </div>
          </div>
          {expanded ? <div className="flex flex-col gap-0">{renderNodes(collapsed.node.children, depth + 1)}</div> : null}
        </div>
      );
    }

    const entry = node.entry;
    if (!entry) return null;
    const status = getWorktreeDisplayStatus(entry);
    const canDiscard = entry.staged || entry.unstaged || entry.untracked;
    return (
      <div
        key={node.path}
        className={cn(
          "group relative flex min-h-7 items-center gap-1 rounded-md border border-transparent pr-1 transition-colors hover:bg-accent/60",
          selectedFile === entry.path && "border-primary/20 bg-accent text-accent-foreground shadow-sm"
        )}
        style={{ paddingLeft: `${depth * 11 + 4}px` }}
        title={`${entry.path} (${entry.indexStatus}${entry.worktreeStatus})`}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 flex-1 justify-start px-0 text-xs font-normal hover:bg-transparent hover:text-inherit"
          onClick={() => onOpenFile(entry.path)}
          aria-pressed={selectedFile === entry.path}
        >
          <span className="truncate">{node.name}</span>
        </Button>
        <div className="flex min-w-0 items-center justify-end gap-1">
          <div className="group-hover:opacity-0">
            <WorktreeStatusBadge status={status} />
          </div>
          <div className="pointer-events-none absolute right-1 top-1/2 flex w-14 -translate-y-1/2 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            {canDiscard ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3.5"
                title={entry.untracked ? "删除文件 (撤销新建)" : "撤销修改"}
                aria-label={entry.untracked ? "删除文件 (撤销新建)" : "撤销修改"}
                disabled={discardingFile === entry.path}
                onClick={(event) => {
                  event.stopPropagation();
                  onDiscardFile(entry.path, entry.untracked);
                }}
              >
                {discardingFile === entry.path ? "..." : <RotateCcwIcon aria-hidden="true" />}
              </Button>
            ) : null}
            <GitStageToggle
              checked={entry.staged}
              title={entry.staged ? "取消暂存" : "暂存更改"}
              disabled={(entry.staged ? unstagingFile : stagingFile) === entry.path}
              onChange={() => {
                if (entry.staged) onUnstageFile(entry.path);
                else onStageFile(entry.path);
              }}
            />
          </div>
        </div>
      </div>
    );
  });

  return <>{renderNodes(nodes, 0)}</>;
}

type WorktreeChangesListProps = Omit<WorktreeFileTreeProps, "nodes" | "mode"> & {
  stagedTree: WorktreeTreeNode[];
  unstagedTree: WorktreeTreeNode[];
  stagedCount: number;
  unstagedCount: number;
};

export function WorktreeChangesList({
  stagedTree,
  unstagedTree,
  stagedCount,
  unstagedCount,
  ...treeProps
}: WorktreeChangesListProps) {
  if (stagedTree.length === 0 && unstagedTree.length === 0) {
    return (
      <Empty className="min-h-24 border bg-transparent p-4 md:p-4">
        <EmptyDescription>当前 worktree 没有待提交文件。</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {stagedTree.length > 0 ? (
        <section className="flex flex-col gap-0">
          <div className="flex min-h-6 items-center justify-between border-b bg-muted/30 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Staged Changes</span>
            <Badge variant="secondary" className="min-w-6 justify-center px-1.5 tracking-normal">{stagedCount}</Badge>
          </div>
          <div className="flex flex-col gap-0">
            <WorktreeFileTree {...treeProps} nodes={stagedTree} mode="unstage" />
          </div>
        </section>
      ) : null}

      {unstagedTree.length > 0 ? (
        <section className="flex flex-col gap-0">
          <div className="flex min-h-6 items-center justify-between border-b bg-muted/30 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Changes</span>
            <Badge variant="secondary" className="min-w-6 justify-center px-1.5 tracking-normal">{unstagedCount}</Badge>
          </div>
          <div className="flex flex-col gap-0">
            <WorktreeFileTree {...treeProps} nodes={unstagedTree} mode="stage" />
          </div>
        </section>
      ) : null}
    </div>
  );
}

import type { ReactNode } from "react";
import { buildGitTreeTopologyViewModel } from "../../lib/gitTreeTopology";
import { branchTone, shortSha } from "../../lib/worktreeTopology";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitGraphNode,
  GitLinkedWorktree,
  GitWorktreeOverview,
  RepositoryEntry
} from "../../lib/types";
import { ChevronRightIcon, RefreshIcon } from "../icons";
import { Badge } from "../ui/badge";
import { Button, buttonVariants } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { cn } from "@/lib/utils";

type GitTreeTopologyPanelProps = {
  defaultSidebarSize: number;
  selectedRepo: RepositoryEntry | null;
  linkedWorktrees: GitLinkedWorktree[];
  branchParentMap: Record<string, string>;
  branches: GitBranchSummary[];
  commitGraph: GitGraphNode[];
  worktreeOverview: GitWorktreeOverview;
  selectedBranch: string;
  topologySelectionId: string;
  worktreeParentMap: Record<string, string>;
  commits: GitCommitSummary[];
  selectedCommit: string;
  collapsedBranchIds: Set<string>;
  selectedExplain: string;
  selectedWorktreePath: string;
  busy: boolean;
  onRefresh: () => void;
  onChooseBranch: (branchName: string) => void;
  onCheckoutBranch: (branchName: string) => void;
  onSelectCommit: (sha: string) => void;
  onSelectTopology: (nodeId: string) => void;
  onOpenDetailContext: () => void;
  onOpenBranchMenu: (x: number, y: number, nodeId: string) => void;
  onOpenCommitMenu: (x: number, y: number, commit: GitCommitSummary, branchName: string) => void;
  onHoverCommit: (x: number, y: number, commit: GitCommitSummary, branchName: string) => void;
  onMoveCommitHover: (x: number, y: number, sha: string) => void;
  onClearCommitHover: () => void;
  onToggleBranchCollapse: (treeKey: string) => void;
  onOpenCommitWorktreeDialog: (commit: GitCommitSummary, branchName: string) => void;
  onInspectCommit: (sha: string) => void;
  onOpenTopologyCreateDialog: (mode: "branch" | "worktree", sourceId: string) => void;
  onSelectWorktree: (path: string) => void;
  onOpenWorktreeMenu: (x: number, y: number, path: string) => void;
  onActivateWorktree: (path: string) => void;
  onSidebarSizeChange: (size: number) => void;
};

export function GitTreeTopologyPanel({
  defaultSidebarSize,
  selectedRepo,
  linkedWorktrees,
  branchParentMap,
  branches,
  commitGraph,
  worktreeOverview,
  selectedBranch,
  topologySelectionId,
  worktreeParentMap,
  commits,
  selectedCommit,
  collapsedBranchIds,
  selectedExplain,
  selectedWorktreePath,
  busy,
  onRefresh,
  onChooseBranch,
  onCheckoutBranch,
  onSelectCommit,
  onSelectTopology,
  onOpenDetailContext,
  onOpenBranchMenu,
  onOpenCommitMenu,
  onHoverCommit,
  onMoveCommitHover,
  onClearCommitHover,
  onToggleBranchCollapse,
  onInspectCommit,
  onOpenTopologyCreateDialog,
  onSelectWorktree,
  onOpenWorktreeMenu,
  onActivateWorktree,
  onSidebarSizeChange
}: GitTreeTopologyPanelProps) {
  const gitTree = buildGitTreeTopologyViewModel({
    linkedWorktrees,
    branchParentMap,
    branches,
    commitGraph,
    worktreeOverview,
    selectedBranch,
    topologySelectionId,
    worktreeParentMap,
    commits,
    selectedCommit
  });
  const {
    activeTreeBranch,
    activeTone,
    activeBranchCommits,
    activeBranchWorktrees,
    activeBranchIsCurrent,
    selectedTreeCommit,
    localRootBranches,
    localChildrenByParent,
    remoteRootBranches,
    remoteChildrenByParent,
    branchHeadByName,
    isRemoteBranch,
  } = gitTree;

  const selectBranchFromTree = (branchName: string) => {
    onSelectTopology(`branch:${branchName}`);
    onChooseBranch(branchName);
  };

  const activeBranchHead = activeTreeBranch ? branchHeadByName.get(activeTreeBranch) || "" : "";
  const activeBranchStatusLabel = !activeTreeBranch
    ? "No branch"
    : activeBranchIsCurrent
      ? "Current branch"
      : isRemoteBranch(activeTreeBranch)
        ? "Remote branch"
        : "Local branch";
  const activeBranchBadgeVariant = activeBranchIsCurrent
    ? "default"
    : activeTreeBranch && isRemoteBranch(activeTreeBranch)
      ? "secondary"
      : "outline";
  const headBadgeLabel = selectedTreeCommit
    ? activeTreeBranch || "Detached"
    : activeTreeBranch
      ? activeBranchIsCurrent
        ? "Current"
        : isRemoteBranch(activeTreeBranch)
          ? "Remote"
          : "Local"
      : "No branch";
  const activeBranchNodeId = activeTreeBranch ? `branch:${activeTreeBranch}` : "";

  const renderBranchRow = (branchName: string, depth = 0, childrenMap = localChildrenByParent): ReactNode => {
    const childBranches = childrenMap.get(branchName) || [];
    const treeKey = `tree:${branchName}`;
    const hasChildren = childBranches.length > 0;
    const collapsed = collapsedBranchIds.has(treeKey);
    const tone = branchTone(branchName);
    const isRemote = isRemoteBranch(branchName);
    const isActive = branchName === activeTreeBranch;
    const displayName = isRemote && branchName.includes("/") ? branchName.split("/").slice(1).join("/") : branchName;

    return (
      <Collapsible key={branchName} open={!collapsed} onOpenChange={() => {
        if (!hasChildren) return;
        onToggleBranchCollapse(treeKey);
      }}>
        <div className="flex min-w-0 items-center gap-1">
          {depth > 0 ? <span className="shrink-0" style={{ width: depth * 14 }} aria-hidden="true" /> : null}
          <Button
            variant="ghost"
            className={cn(
              "h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-2 text-left",
              isActive && "bg-accent text-accent-foreground",
              isRemote && !isActive && "text-muted-foreground"
            )}
            onClick={() => selectBranchFromTree(branchName)}
            onDoubleClick={() => !isRemote && onCheckoutBranch(branchName)}
            onContextMenu={(event) => {
              event.preventDefault();
              onOpenBranchMenu(event.clientX, event.clientY, `branch:${branchName}`);
            }}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: tone.accent }} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={branchName}>{displayName}</span>
            {isRemote ? <Badge variant="outline" className="shrink-0 normal-case tracking-normal">remote</Badge> : null}
          </Button>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-8 shrink-0", !hasChildren && "invisible", hasChildren && !collapsed && "rotate-90")}
              onClick={(event) => {
                event.stopPropagation();
              }}
              aria-label={collapsed ? "展开分支" : "收起分支"}
              disabled={!hasChildren}
            >
              {hasChildren ? <ChevronRightIcon data-icon="inline-start" /> : null}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          {!collapsed ? childBranches.map((child) => renderBranchRow(child, depth + 1, childrenMap)) : null}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 rounded-lg border border-border bg-background"
        id="gittree-layout"
        defaultLayout={{
          "gittree-sidebar": defaultSidebarSize,
          "gittree-detail": 100 - defaultSidebarSize
        }}
        onLayoutChanged={(layout: Record<string, number>) => {
          const nextSize = layout["gittree-sidebar"];
          if (typeof nextSize === "number" && Number.isFinite(nextSize)) {
            onSidebarSizeChange(Math.round(nextSize));
          }
        }}
      >
        <ResizablePanel id="gittree-sidebar" minSize="24%" maxSize="48%" className="min-h-0">
          <div className="flex h-full min-h-0 flex-col gap-3 p-3">
            <Card className="rounded-lg p-3 shadow-none">
              <div className="flex items-center justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <Badge variant="outline" className="w-fit normal-case tracking-normal">GitTree</Badge>
                  <CardTitle className="truncate text-base">{selectedRepo?.name || "Repository"}</CardTitle>
                </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={onRefresh}
                disabled={busy}
                aria-busy={busy}
              >
                <RefreshIcon data-icon="inline-start" />
                <span>{busy ? "刷新中" : "刷新"}</span>
              </Button>
              </div>
            </Card>
            <Card className="flex min-h-0 flex-[1.1] flex-col rounded-lg shadow-none">
              <CardHeader className="flex-row items-center justify-between gap-3 p-3">
                <CardTitle>Branches</CardTitle>
                <Badge variant="secondary" className="normal-case tracking-normal">
                  {localRootBranches.length + remoteRootBranches.length}
                </Badge>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 p-0">
                <ScrollArea className="h-full px-2 pb-2">
                  <div className="grid gap-1">
                {localRootBranches.map((branch) => renderBranchRow(branch, 0, localChildrenByParent))}
                {remoteRootBranches.length > 0 ? (
                  <>
                    <div className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">Remote</div>
                    {remoteRootBranches.map((branch) => renderBranchRow(branch, 0, remoteChildrenByParent))}
                  </>
                ) : null}
                {localRootBranches.length === 0 && remoteRootBranches.length === 0 ? (
                  <Empty className="min-h-28 border border-dashed border-border bg-muted/30 p-4 md:p-4">
                    <EmptyHeader>
                      <EmptyTitle className="text-sm">暂无本地分支</EmptyTitle>
                      <EmptyDescription>刷新 Git 数据后会在这里展示分支树。</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : null}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
            <Separator />
            <Card className="flex min-h-0 flex-1 flex-col rounded-lg shadow-none">
              <CardHeader className="flex-row items-center justify-between gap-3 p-3">
                <CardTitle>Commits</CardTitle>
              <Badge variant="secondary" className="normal-case tracking-normal">
                {activeBranchCommits.length}
              </Badge>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 p-0">
                <ScrollArea className="h-full px-2 pb-2">
                  <div className="grid gap-1">
                    {activeBranchCommits.length > 0 ? activeBranchCommits.map((commit) => (
                      <Button
                        key={`${activeTreeBranch}:${commit.sha}`}
                        variant="ghost"
                        className={cn(
                          "h-auto min-w-0 justify-start gap-2 rounded-md p-2 text-left",
                          selectedCommit === commit.sha && "bg-accent text-accent-foreground"
                        )}
                        onClick={() => {
                          onSelectCommit(commit.sha);
                          onSelectTopology(`commit:${activeTreeBranch}:${commit.sha}`);
                        }}
                        onDoubleClick={() => {
                          onSelectCommit(commit.sha);
                          onOpenDetailContext();
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onOpenCommitMenu(event.clientX, event.clientY, commit, activeTreeBranch);
                        }}
                        onMouseEnter={(event) => onHoverCommit(event.clientX, event.clientY, commit, activeTreeBranch)}
                        onMouseMove={(event) => onMoveCommitHover(event.clientX, event.clientY, commit.sha)}
                        onMouseLeave={onClearCommitHover}
                        aria-pressed={selectedCommit === commit.sha}
                      >
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: activeTone.accent }} />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <strong className="truncate text-sm font-medium">{commit.subject || "(no subject)"}</strong>
                          <span className="truncate text-xs text-muted-foreground">{shortSha(commit.sha, 7)} · {commit.author || "unknown"} · {commit.date || "unknown date"}</span>
                        </span>
                      </Button>
                    )) : (
                      <Empty className="min-h-32 border border-dashed border-border bg-muted/30 p-4 md:p-4">
                        <EmptyHeader>
                          <EmptyTitle className="text-sm">没有可展示的提交</EmptyTitle>
                          <EmptyDescription>点击左侧分支会加载该分支提交；若仍为空，请刷新 Git 数据。</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="gittree-detail" minSize="40%" className="min-h-0">
          <div className="flex h-full min-h-0 flex-col gap-3 p-3">
            <Card className="rounded-lg p-3 shadow-none">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: activeTone.accent }} />
                  <div className="grid min-w-0 gap-1">
                    <CardTitle className="truncate text-base">
                      {selectedTreeCommit ? selectedTreeCommit.subject || "(no subject)" : activeTreeBranch || "未选择分支"}
                    </CardTitle>
                    <CardDescription className="truncate text-[14px]">
                      {selectedTreeCommit
                        ? `${selectedTreeCommit.author || "unknown"} · ${selectedTreeCommit.date || "unknown date"}`
                        : activeBranchIsCurrent
                          ? "当前检出分支"
                          : activeBranchHead
                            ? `${shortSha(activeBranchHead, 8)} · ${activeBranchStatusLabel}`
                            : activeBranchStatusLabel}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge variant={activeBranchBadgeVariant} className="normal-case tracking-normal">
                    {headBadgeLabel}
                  </Badge>
                  {selectedTreeCommit ? (
                    <Button variant="ghost" size="sm" onClick={() => onInspectCommit(selectedTreeCommit.sha)}>
                      查看详情
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
            {selectedTreeCommit ? (
              <ScrollArea className="min-h-0 flex-1">
                <div className="grid gap-3 pr-2">
                  <Card className="rounded-lg shadow-none">
                    <CardHeader className="flex-row items-center justify-between gap-3 p-3">
                      <CardTitle>Commit</CardTitle>
                      <Badge variant="outline" className="normal-case tracking-normal">
                        {activeTreeBranch || "Detached"}
                      </Badge>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 pt-0">
                      <strong className="truncate text-base font-semibold">{selectedTreeCommit.subject || "(no subject)"}</strong>
                      <code className="w-fit rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{shortSha(selectedTreeCommit.sha, 12)}</code>
                      <p className="m-0 text-sm text-muted-foreground">{selectedTreeCommit.author || "unknown"} · {selectedTreeCommit.date || "unknown date"}</p>
                    </CardContent>
                  </Card>
                  <div className="grid gap-2 md:grid-cols-2">
                    {([
                      ["Branch", activeTreeBranch || "-"],
                      ["Author", selectedTreeCommit.author || "unknown"],
                      ["Date", selectedTreeCommit.date || "unknown date"],
                      ["Worktree", String(activeBranchWorktrees.length || 0)]
                    ] as Array<[string, string]>).map(([label, value]) => (
                      <Card key={label} className="rounded-lg p-3 shadow-none">
                        <span className="text-xs font-medium text-muted-foreground">{label}</span>
                        <strong className="mt-1 block truncate text-sm font-semibold">{value}</strong>
                      </Card>
                    ))}
                  </div>
                  <Card className="rounded-lg shadow-none">
                    <CardHeader className="flex-row items-center justify-between gap-3 p-3">
                      <CardTitle>上下文</CardTitle>
                      <Badge variant="secondary" className="normal-case tracking-normal">Entire</Badge>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
                        {selectedExplain || "点击“查看详情”后会在这里展示该提交的上下文摘要。"}
                      </pre>
                    </CardContent>
                  </Card>
                </div>
              </ScrollArea>
            ) : (
              <Card className="flex min-h-0 flex-1 flex-col rounded-lg shadow-none">
                <CardHeader className="flex-row items-center justify-between gap-3 p-3">
                  <CardTitle>Worktrees</CardTitle>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary" className="normal-case tracking-normal">
                      {activeBranchWorktrees.length}
                    </Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (!activeBranchNodeId) return;
                        onOpenTopologyCreateDialog("worktree", activeBranchNodeId);
                      }}
                      disabled={!activeBranchNodeId}
                    >
                      新建
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 p-0">
                  <ScrollArea className="h-full px-3 pb-3">
                    <div className="grid gap-2">
                      {activeBranchWorktrees.length > 0 ? activeBranchWorktrees.map((worktree) => (
                        <div
                          key={worktree.path}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            buttonVariants({ variant: "ghost", size: "sm" }),
                            "h-auto min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] justify-start gap-3 rounded-lg border border-transparent p-3 text-left",
                            selectedWorktreePath === worktree.path && "border-primary/40 bg-primary/5"
                          )}
                          onClick={() => onSelectWorktree(worktree.path)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectWorktree(worktree.path);
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            onOpenWorktreeMenu(event.clientX, event.clientY, worktree.path);
                          }}
                          aria-pressed={selectedWorktreePath === worktree.path}
                        >
                          <Badge
                            variant={
                              worktree.isCurrent
                                ? "default"
                                : worktree.isDetached
                                  ? "outline"
                                  : worktree.clean
                                    ? "success"
                                    : "secondary"
                            }
                            className="shrink-0 normal-case tracking-normal"
                          >
                            {worktree.isCurrent ? "Current" : worktree.isDetached ? "Detached" : "Worktree"}
                          </Badge>
                          <span className="grid min-w-0 gap-1">
                            <strong className="truncate text-sm font-semibold">{worktree.path.split(/[\\/]/).filter(Boolean).pop() || worktree.branch || "worktree"}</strong>
                            <span className="truncate text-xs text-muted-foreground">{worktree.path}</span>
                            <span className="text-xs text-muted-foreground">{worktree.clean ? "clean" : `${worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount} changes`}</span>
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="self-center"
                            onClick={(event) => {
                              event.stopPropagation();
                              onActivateWorktree(worktree.path);
                            }}
                          >
                            打开
                          </Button>
                        </div>
                      )) : (
                        <Empty className="min-h-48 border border-dashed border-border bg-muted/30">
                          <EmptyHeader>
                            <EmptyTitle className="text-sm">这个分支还没有 worktree</EmptyTitle>
                            <EmptyDescription>可以直接在这里为当前分支新建一个 worktree。</EmptyDescription>
                          </EmptyHeader>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (!activeBranchNodeId) return;
                              onOpenTopologyCreateDialog("worktree", activeBranchNodeId);
                            }}
                            disabled={!activeBranchNodeId}
                          >
                            新建 worktree
                          </Button>
                        </Empty>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

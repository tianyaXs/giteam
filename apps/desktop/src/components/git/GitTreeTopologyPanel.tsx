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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
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
    branchCommitCount,
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
        <div
          className={isActive ? "gt-gittree-branch active" : isRemote ? "gt-gittree-branch is-remote" : "gt-gittree-branch"}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => selectBranchFromTree(branchName)}
          onDoubleClick={() => !isRemote && onCheckoutBranch(branchName)}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenBranchMenu(event.clientX, event.clientY, `branch:${branchName}`);
          }}
        >
          <span className="gt-gittree-dot" style={{ background: tone.accent }} />
          <span className="gt-gittree-branch-main">
            <span className="gt-gittree-name" title={branchName}>{displayName}</span>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={collapsed
                  ? hasChildren
                    ? "gt-gittree-disclosure"
                    : "gt-gittree-disclosure empty"
                  : hasChildren
                    ? "gt-gittree-disclosure is-open"
                    : "gt-gittree-disclosure empty"}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                aria-label={collapsed ? "展开分支" : "收起分支"}
                disabled={!hasChildren}
              >
                {hasChildren ? <ChevronRightIcon /> : null}
              </Button>
            </CollapsibleTrigger>
          </span>
        </div>
        <CollapsibleContent>
          {!collapsed ? childBranches.map((child) => renderBranchRow(child, depth + 1, childrenMap)) : null}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="gt-gittree-panel-shell">
      <ResizablePanelGroup
        orientation="horizontal"
        className="gt-gittree-panel"
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
        <ResizablePanel id="gittree-sidebar" minSize="24%" maxSize="48%" className="gt-gittree-panel-pane">
          <div className="gt-gittree-sidebar">
            <div className="gt-gittree-head">
              <div>
                <span className="gt-gittree-kicker">GitTree</span>
                <strong>{selectedRepo?.name || "Repository"}</strong>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className={busy ? "gt-gittree-action-chip is-busy" : "gt-gittree-action-chip"}
                onClick={onRefresh}
                disabled={busy}
                aria-busy={busy}
              >
                <RefreshIcon />
                <span>{busy ? "刷新中" : "刷新"}</span>
              </Button>
            </div>
            <ScrollArea className="gt-gittree-branch-list">
              <div className="gt-gittree-branch-list-inner">
                {localRootBranches.map((branch) => renderBranchRow(branch, 0, localChildrenByParent))}
                {remoteRootBranches.length > 0 ? (
                  <>
                    <div className="gt-gittree-section-divider">Remote</div>
                    {remoteRootBranches.map((branch) => renderBranchRow(branch, 0, remoteChildrenByParent))}
                  </>
                ) : null}
                {localRootBranches.length === 0 && remoteRootBranches.length === 0 ? (
                  <div className="gt-empty-hint">暂无本地分支。</div>
                ) : null}
              </div>
            </ScrollArea>
            <Separator className="gt-gittree-list-separator" />
            <div className="gt-gittree-commit-toolbar">
              <span>Commits</span>
              <Badge variant="secondary" className="gt-gittree-toolbar-badge">
                {activeBranchCommits.length}
              </Badge>
            </div>
            <ScrollArea className="gt-gittree-commit-list">
              <div className="gt-gittree-commit-list-inner">
                {activeBranchCommits.length > 0 ? activeBranchCommits.map((commit) => (
                  <Button
                    key={`${activeTreeBranch}:${commit.sha}`}
                    variant="ghost"
                    size="default"
                    className={selectedCommit === commit.sha ? "gt-gittree-commit selected" : "gt-gittree-commit"}
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
                    <span className="gt-gittree-commit-dot" style={{ background: activeTone.accent }} />
                    <span className="gt-gittree-commit-main">
                      <strong>{commit.subject || "(no subject)"}</strong>
                      <span>{shortSha(commit.sha, 7)} · {commit.author || "unknown"} · {commit.date || "unknown date"}</span>
                    </span>
                  </Button>
                )) : (
                  <div className="gt-gittree-empty">
                    <strong>没有可展示的提交</strong>
                    <span>点击左侧分支会加载该分支提交；若仍为空，请刷新 Git 数据。</span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle className="gt-gittree-resize-handle" />
        <ResizablePanel id="gittree-detail" minSize="40%" className="gt-gittree-panel-pane">
          <div className="gt-gittree-detail">
            <div className="gt-gittree-detail-head">
              <div className="gt-gittree-selected-title">
                <span className="gt-gittree-dot large" style={{ background: activeTone.accent }} />
                <div>
                  <strong>{selectedTreeCommit ? selectedTreeCommit.subject || "(no subject)" : activeTreeBranch || "未选择分支"}</strong>
                  <span>
                    {selectedTreeCommit
                      ? `${selectedTreeCommit.author || "unknown"} · ${selectedTreeCommit.date || "unknown date"}`
                      : activeBranchIsCurrent
                        ? "当前检出分支"
                        : activeBranchHead
                          ? `${shortSha(activeBranchHead, 8)} · ${activeBranchStatusLabel}`
                          : activeBranchStatusLabel}
                  </span>
                </div>
              </div>
              <div className="gt-gittree-detail-head-side">
                <Badge variant={activeBranchBadgeVariant} className="gt-gittree-head-badge">
                  {headBadgeLabel}
                </Badge>
                {selectedTreeCommit ? (
                  <div className="gt-gittree-actions">
                    <Button variant="ghost" size="sm" onClick={() => onInspectCommit(selectedTreeCommit.sha)}>
                      查看详情
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            {selectedTreeCommit ? (
              <div className="gt-gittree-detail-body">
                <div className="gt-gittree-detail-overview">
                  <div className="gt-gittree-detail-overview-head">
                    <span>Commit</span>
                    <Badge variant="outline" className="gt-gittree-detail-badge">
                      {activeTreeBranch || "Detached"}
                    </Badge>
                  </div>
                  <strong>{selectedTreeCommit.subject || "(no subject)"}</strong>
                  <em>{shortSha(selectedTreeCommit.sha, 12)}</em>
                  <p>{selectedTreeCommit.author || "unknown"} · {selectedTreeCommit.date || "unknown date"}</p>
                </div>
                <div className="gt-gittree-detail-grid">
                  <div><span>Branch</span><strong>{activeTreeBranch || "-"}</strong></div>
                  <div><span>Author</span><strong>{selectedTreeCommit.author || "unknown"}</strong></div>
                  <div><span>Date</span><strong>{selectedTreeCommit.date || "unknown date"}</strong></div>
                  <div><span>Worktree</span><strong>{activeBranchWorktrees.length || 0}</strong></div>
                </div>
                <div className="gt-gittree-detail-section">
                  <div className="gt-gittree-detail-section-head">
                    <span>上下文</span>
                    <Badge variant="secondary" className="gt-gittree-detail-badge">Entire</Badge>
                  </div>
                  <pre className="gt-gittree-detail-preview">{selectedExplain || "点击“查看详情”后会在这里展示该提交的上下文摘要。"}</pre>
                </div>
              </div>
            ) : (
              <div className="gt-gittree-detail-body">
                <div className="gt-gittree-detail-subsection">
                  <div className="gt-gittree-commit-toolbar gt-gittree-worktree-toolbar">
                    <span>Worktrees</span>
                    <div className="gt-gittree-worktree-toolbar-actions">
                      <Badge variant="secondary" className="gt-gittree-toolbar-badge">
                        {activeBranchWorktrees.length}
                      </Badge>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="gt-gittree-inline-chip gt-gittree-create-chip"
                        onClick={() => {
                          if (!activeBranchNodeId) return;
                          onOpenTopologyCreateDialog("worktree", activeBranchNodeId);
                        }}
                        disabled={!activeBranchNodeId}
                      >
                        新建
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="gt-gittree-worktree-list-scroll">
                    <div className="gt-gittree-worktree-list">
                      {activeBranchWorktrees.length > 0 ? activeBranchWorktrees.map((worktree) => (
                        <div
                          key={worktree.path}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            buttonVariants({ variant: "ghost", size: "sm" }),
                            selectedWorktreePath === worktree.path ? "gt-gittree-worktree-row selected" : "gt-gittree-worktree-row"
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
                            className="gt-gittree-worktree-state"
                            variant={
                              worktree.isCurrent
                                ? "default"
                                : worktree.isDetached
                                  ? "outline"
                                  : worktree.clean
                                    ? "success"
                                    : "secondary"
                            }
                          >
                            {worktree.isCurrent ? "Current" : worktree.isDetached ? "Detached" : "Worktree"}
                          </Badge>
                          <strong>{worktree.path.split(/[\\/]/).filter(Boolean).pop() || worktree.branch || "worktree"}</strong>
                          <span>{worktree.path}</span>
                          <em>{worktree.clean ? "clean" : `${worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount} changes`}</em>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gt-gittree-inline-chip"
                            onClick={(event) => {
                              event.stopPropagation();
                              onActivateWorktree(worktree.path);
                            }}
                          >
                            <span>打开</span>
                          </Button>
                        </div>
                      )) : (
                        <div className="gt-gittree-empty gt-gittree-empty-inline">
                          <strong>这个分支还没有 worktree</strong>
                          <span>可以直接在这里为当前分支新建一个 worktree。</span>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gt-gittree-empty-action"
                            onClick={() => {
                              if (!activeBranchNodeId) return;
                              onOpenTopologyCreateDialog("worktree", activeBranchNodeId);
                            }}
                            disabled={!activeBranchNodeId}
                          >
                            新建 worktree
                          </Button>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

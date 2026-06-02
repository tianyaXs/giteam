import { Fragment, type ReactNode } from "react";
import { buildGitTreeTopologyViewModel } from "../../lib/gitTreeTopology";
import { branchTone, shortSha } from "../../lib/worktreeTopology";
import { ChevronRightIcon, PlusIcon, RefreshIcon } from "../icons";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitGraphNode,
  GitLinkedWorktree,
  GitWorktreeOverview,
  RepositoryEntry
} from "../../lib/types";

type GitTreeTopologyPanelProps = {
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
};

export function GitTreeTopologyPanel({
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
  onOpenCommitWorktreeDialog,
  onInspectCommit,
  onOpenTopologyCreateDialog,
  onSelectWorktree,
  onOpenWorktreeMenu,
  onActivateWorktree
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
    branchNames,
    currentBranchName,
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
    isCurrentBranch
  } = gitTree;
  const selectBranchFromTree = (branchName: string) => {
    onSelectTopology(`branch:${branchName}`);
    onChooseBranch(branchName);
  };

  const activeBranchLabel = activeTreeBranch || currentBranchName || "未选择分支";
  const activeBranchHead = activeTreeBranch ? branchHeadByName.get(activeTreeBranch) || "" : "";
  const activeBranchCommitTotal = activeTreeBranch ? branchCommitCount(activeTreeBranch) || 0 : 0;
  const activeBranchStatusLabel = !activeTreeBranch
    ? "No branch"
    : activeBranchIsCurrent
      ? "Current branch"
      : isRemoteBranch(activeTreeBranch)
        ? "Remote branch"
        : "Local branch";

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
      <Fragment key={branchName}>
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
            <button
              type="button"
              className={collapsed
                ? hasChildren
                  ? "gt-gittree-disclosure"
                  : "gt-gittree-disclosure empty"
                : hasChildren
                  ? "gt-gittree-disclosure is-open"
                  : "gt-gittree-disclosure empty"}
              onClick={(event) => {
                event.stopPropagation();
                if (!hasChildren) return;
                onToggleBranchCollapse(treeKey);
              }}
              aria-label={collapsed ? "展开分支" : "收起分支"}
            >
              {hasChildren ? <ChevronRightIcon /> : null}
            </button>
          </span>
        </div>
        {!collapsed ? childBranches.map((child) => renderBranchRow(child, depth + 1, childrenMap)) : null}
      </Fragment>
    );
  };

  return (
    <>
      <div className="gt-gittree-sidebar">
        <div className="gt-gittree-head">
          <div>
            <span className="gt-gittree-kicker">GitTree</span>
            <strong>{selectedRepo?.name || "Repository"}</strong>
          </div>
          <button className="chip gt-gittree-action-chip" onClick={onRefresh} disabled={busy}>
            <RefreshIcon />
            <span>Refresh</span>
          </button>
        </div>
        <div className="gt-gittree-summary">
          <span>{branchNames.length} branches</span>
          <span>{activeBranchLabel}</span>
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
          <span>{activeBranchCommits.length > 0 ? `${activeBranchCommits.length} loaded` : "No commit loaded"}</span>
        </div>
        <ScrollArea className="gt-gittree-commit-list">
          <div className="gt-gittree-commit-list-inner">
            {activeBranchCommits.length > 0 ? activeBranchCommits.map((commit) => (
              <button
                key={`${activeTreeBranch}:${commit.sha}`}
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
              >
                <span className="gt-gittree-commit-dot" style={{ background: activeTone.accent }} />
                <span className="gt-gittree-commit-main">
                  <strong>{commit.subject || "(no subject)"}</strong>
                  <span>{shortSha(commit.sha, 7)} · {commit.author || "unknown"} · {commit.date || "unknown date"}</span>
                </span>
              </button>
            )) : (
              <div className="gt-gittree-empty">
                <strong>没有可展示的提交</strong>
                <span>点击左侧分支会加载该分支提交；若仍为空，请刷新 Git 数据。</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="gt-gittree-detail">
        <div className="gt-gittree-detail-head">
          <div className="gt-gittree-selected-title">
            <span className="gt-gittree-dot large" style={{ background: activeTone.accent }} />
            <div>
              <strong>{selectedTreeCommit ? selectedTreeCommit.subject || "(no subject)" : activeTreeBranch || "未选择分支"}</strong>
              <span>{selectedTreeCommit ? `${shortSha(selectedTreeCommit.sha, 8)} · ${activeTreeBranch}` : activeBranchIsCurrent ? "CURRENT" : branchHeadByName.get(activeTreeBranch)?.slice(0, 7) || "no head in graph"}</span>
            </div>
          </div>
          <div className="gt-gittree-actions">
            {selectedTreeCommit ? (
              <>
                <button className="chip active" onClick={() => onOpenCommitWorktreeDialog(selectedTreeCommit, activeTreeBranch)}>Create Worktree</button>
                <button className="chip" onClick={() => onInspectCommit(selectedTreeCommit.sha)}>Explain</button>
              </>
            ) : (
              <button className="chip" onClick={() => activeTreeBranch && onOpenTopologyCreateDialog("worktree", `branch:${activeTreeBranch}`)} disabled={!activeTreeBranch}>New Worktree</button>
            )}
          </div>
        </div>
        {selectedTreeCommit ? (
          <div className="gt-gittree-detail-body">
            <div className="gt-gittree-detail-card">
              <span>Commit</span>
              <strong>{shortSha(selectedTreeCommit.sha, 12)}</strong>
              <p>{selectedTreeCommit.subject || "(no subject)"}</p>
            </div>
            <div className="gt-gittree-detail-grid">
              <div><span>Branch</span><strong>{activeTreeBranch || "-"}</strong></div>
              <div><span>Author</span><strong>{selectedTreeCommit.author || "unknown"}</strong></div>
              <div><span>Date</span><strong>{selectedTreeCommit.date || "unknown"}</strong></div>
              <div><span>Worktree</span><strong>{activeBranchWorktrees.length || 0}</strong></div>
            </div>
            <pre className="gt-gittree-detail-preview">{selectedExplain || "Select Explain to load Entire context for this commit."}</pre>
          </div>
        ) : (
          <div className="gt-gittree-detail-body">
            <div className="gt-gittree-detail-card gt-gittree-branch-card">
              <span>Branch Overview</span>
              <strong>{activeBranchLabel}</strong>
              <p>{activeBranchStatusLabel}</p>
            </div>
            <div className="gt-gittree-detail-grid gt-gittree-detail-grid-compact">
              <div><span>Head</span><strong>{activeBranchHead ? shortSha(activeBranchHead, 10) : "-"}</strong></div>
              <div><span>Commits</span><strong>{activeBranchCommitTotal || 0}</strong></div>
              <div><span>Worktrees</span><strong>{activeBranchWorktrees.length}</strong></div>
              <div><span>State</span><strong>{activeBranchStatusLabel}</strong></div>
            </div>
            <div className="gt-gittree-commit-toolbar gt-gittree-worktree-toolbar">
              <span>Worktrees</span>
              <div className="gt-gittree-worktree-toolbar-actions">
                <span>{activeBranchWorktrees.length} linked</span>
                <button
                  className="chip gt-gittree-inline-chip"
                  onClick={() => activeTreeBranch && onOpenTopologyCreateDialog("worktree", `branch:${activeTreeBranch}`)}
                  disabled={!activeTreeBranch}
                >
                  <PlusIcon />
                  <span>New</span>
                </button>
              </div>
            </div>
            <div className="gt-gittree-worktree-list">
              {activeBranchWorktrees.length > 0 ? activeBranchWorktrees.map((worktree) => (
                <div
                  key={worktree.path}
                  role="button"
                  tabIndex={0}
                  className={selectedWorktreePath === worktree.path ? "gt-gittree-worktree-row selected" : "gt-gittree-worktree-row"}
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
                >
                  <span className="gt-gittree-worktree-state">{worktree.isCurrent ? "Current" : worktree.isDetached ? "Detached" : "Worktree"}</span>
                  <strong>{worktree.path.split(/[\\/]/).filter(Boolean).pop() || worktree.branch || "worktree"}</strong>
                  <span>{worktree.path}</span>
                  <em>{worktree.clean ? "clean" : `${worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount} changes`}</em>
                  <button
                    type="button"
                    className="chip gt-gittree-inline-chip"
                    onClick={(event) => {
                      event.stopPropagation();
                      onActivateWorktree(worktree.path);
                    }}
                  >
                    <span>Open</span>
                  </button>
                </div>
              )) : (
                <div className="gt-gittree-empty gt-gittree-empty-inline">
                  <strong>这个分支还没有 worktree</strong>
                  <span>可以新建一个独立工作区，避免把实验改动继续堆在当前主工作区里。</span>
                  <button
                    className="chip gt-gittree-inline-chip"
                    onClick={() => activeTreeBranch && onOpenTopologyCreateDialog("worktree", `branch:${activeTreeBranch}`)}
                    disabled={!activeTreeBranch}
                  >
                    <PlusIcon />
                    <span>New Worktree</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

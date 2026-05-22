import { Fragment, type ReactNode } from "react";
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

  const renderBranchRow = (branchName: string, depth = 0, childrenMap = localChildrenByParent): ReactNode => {
    const childBranches = childrenMap.get(branchName) || [];
    const treeKey = `tree:${branchName}`;
    const collapsed = collapsedBranchIds.has(treeKey);
    const tone = branchTone(branchName);
    const isCurrent = isCurrentBranch(branchName);
    const isRemote = isRemoteBranch(branchName);
    const isActive = branchName === activeTreeBranch;
    const displayName = isRemote && branchName.includes("/") ? branchName.split("/").slice(1).join("/") : branchName;
    return (
      <Fragment key={branchName}>
        <div
          className={isActive ? "gt-gittree-branch active" : isRemote ? "gt-gittree-branch is-remote" : "gt-gittree-branch"}
          style={{ paddingLeft: 10 + depth * 18 }}
          onClick={() => selectBranchFromTree(branchName)}
          onDoubleClick={() => !isRemote && onCheckoutBranch(branchName)}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenBranchMenu(event.clientX, event.clientY, `branch:${branchName}`);
          }}
        >
          <button
            type="button"
            className={childBranches.length > 0 ? "gt-gittree-disclosure" : "gt-gittree-disclosure empty"}
            onClick={(event) => {
              event.stopPropagation();
              if (childBranches.length === 0) return;
              onToggleBranchCollapse(treeKey);
            }}
            aria-label={collapsed ? "展开分支" : "收起分支"}
          >
            {childBranches.length > 0 ? (collapsed ? "▸" : "▾") : ""}
          </button>
          <span className="gt-gittree-dot" style={{ background: tone.accent }} />
          <span className="gt-gittree-name" title={branchName}>{displayName}</span>
          {isCurrent ? <span className="gt-gittree-badge">CURRENT</span> : null}
          {isRemote ? <span className="gt-gittree-badge is-remote">REMOTE</span> : null}
          <span className="gt-gittree-count">{branchCommitCount(branchName) || "-"}</span>
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
          <button className="chip" onClick={onRefresh} disabled={busy}>Refresh</button>
        </div>
        <div className="gt-gittree-summary">
          <span>{branchNames.length} branches</span>
          <span>{currentBranchName || "no branch"}</span>
        </div>
        <div className="gt-gittree-branch-list">
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
        <div className="gt-gittree-commit-toolbar">
          <span>Commits</span>
          <span>{activeBranchCommits.length > 0 ? `${activeBranchCommits.length} loaded` : "No commit loaded"}</span>
        </div>
        <div className="gt-gittree-commit-list">
          {activeBranchCommits.length > 0 ? activeBranchCommits.map((commit, index) => (
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
              <span className="gt-gittree-commit-index">{index === 0 ? "HEAD" : index + 1}</span>
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
            <div className="gt-gittree-commit-toolbar gt-gittree-worktree-toolbar">
              <span>Worktrees</span>
              <div className="toolbar" style={{ gap: "var(--gt-space-2)" }}>
                <span>{activeBranchWorktrees.length} linked</span>
                <button
                  className="chip"
                  style={{ fontSize: "var(--gt-text-2xs)", height: 22, padding: "0 var(--gt-space-2)" }}
                  onClick={() => activeTreeBranch && onOpenTopologyCreateDialog("worktree", `branch:${activeTreeBranch}`)}
                  disabled={!activeTreeBranch}
                >
                  + New
                </button>
              </div>
            </div>
            <div className="gt-gittree-worktree-list">
              {activeBranchWorktrees.length > 0 ? activeBranchWorktrees.map((worktree) => (
                <button
                  key={worktree.path}
                  className={selectedWorktreePath === worktree.path ? "gt-gittree-worktree-row selected" : "gt-gittree-worktree-row"}
                  onClick={() => onSelectWorktree(worktree.path)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenWorktreeMenu(event.clientX, event.clientY, worktree.path);
                  }}
                >
                  <span className="gt-gittree-worktree-state">{worktree.isCurrent ? "Current" : worktree.isDetached ? "Detached" : "Worktree"}</span>
                  <strong>{worktree.path.split("/").filter(Boolean).pop() || worktree.branch || "worktree"}</strong>
                  <span>{worktree.path}</span>
                  <em>{worktree.clean ? "clean" : `${worktree.stagedCount + worktree.unstagedCount + worktree.untrackedCount} changes`}</em>
                  <button
                    type="button"
                    className="chip"
                    style={{ fontSize: "var(--gt-text-2xs)", height: 22, padding: "0 var(--gt-space-2)" }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onActivateWorktree(worktree.path);
                    }}
                  >
                    Open
                  </button>
                </button>
              )) : <div className="gt-empty-hint">No worktree for this branch.</div>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

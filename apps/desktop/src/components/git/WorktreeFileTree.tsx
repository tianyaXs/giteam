import type { ReactNode } from "react";
import type { GitWorktreeEntry } from "../../lib/types";
import {
  collectWorktreeNodeEntries,
  collectWorktreeNodeFilePaths,
  getWorktreeDisplayStatus,
  getWorktreeFileKindLabel,
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
  const renderNodes = (items: WorktreeTreeNode[], depth: number): ReactNode => items.map((node) => {
    if (node.kind === "dir") {
      const expanded = expandedDirs.includes(node.path);
      const filePaths = collectWorktreeNodeFilePaths(node);
      const entries = collectWorktreeNodeEntries(node);
      const busyPath = mode === "stage" ? stagingFile : unstagingFile;
      const canDiscardDir = entries.some((entry) => entry.staged || entry.unstaged || entry.untracked);
      return (
        <div key={node.path} className="gt-worktree-tree-group">
          <div className="gt-worktree-tree-row gt-worktree-tree-dir" style={{ paddingLeft: `${depth * 14 + 6}px` }}>
            <button type="button" className="gt-worktree-dir-main-btn" onClick={() => onToggleDir(node.path)}>
              <span className={expanded ? "gt-worktree-tree-chevron is-open" : "gt-worktree-tree-chevron"} aria-hidden="true" />
              <span className="gt-worktree-tree-name">{node.name}</span>
            </button>
            <div className="gt-worktree-row-tail">
              <span className="gt-worktree-tree-status is-dir">{filePaths.length}</span>
              <div className="gt-worktree-file-actions">
                <button
                  type="button"
                  className={mode === "unstage" ? "gt-stage-toggle is-on" : "gt-stage-toggle"}
                  title={mode === "unstage" ? "取消暂存此目录" : "暂存此目录"}
                  aria-pressed={mode === "unstage"}
                  disabled={busyPath === node.path || filePaths.length === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (mode === "unstage") onUnstagePaths(filePaths, node.path);
                    else onStagePaths(filePaths, node.path);
                  }}
                >
                  {mode === "unstage" ? (
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 8.2 6.7 11 12 5" />
                    </svg>
                  ) : null}
                </button>
                {canDiscardDir ? (
                  <button
                    type="button"
                    className="gt-worktree-action-btn is-discard"
                    title="丢弃此目录变更"
                    disabled={discardingFile === node.path}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDiscardEntries(entries, node.path);
                    }}
                  >
                    {discardingFile === node.path ? "..." : (
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M6 4 3 7l3 3" />
                        <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                      </svg>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          {expanded ? <div className="gt-worktree-tree-children">{renderNodes(node.children, depth + 1)}</div> : null}
        </div>
      );
    }

    const entry = node.entry;
    if (!entry) return null;
    const status = getWorktreeDisplayStatus(entry);
    const fileKind = getWorktreeFileKindLabel(entry.path);
    const canDiscard = entry.staged || entry.unstaged || entry.untracked;
    return (
      <div
        key={node.path}
        className={selectedFile === entry.path ? "gt-worktree-tree-row gt-worktree-tree-file active" : "gt-worktree-tree-row gt-worktree-tree-file"}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        title={`${entry.path} (${entry.indexStatus}${entry.worktreeStatus})`}
      >
        <button
          type="button"
          className="gt-worktree-file-main-btn"
          onClick={() => onOpenFile(entry.path)}
        >
          <span className={`gt-worktree-kind gt-worktree-kind-${fileKind}`}>{fileKind}</span>
          <span className="gt-worktree-tree-name">{node.name}</span>
        </button>
        <div className="gt-worktree-row-tail">
          <span className={`gt-worktree-tree-status is-${status.toLowerCase()}`}>{status}</span>
          <div className="gt-worktree-file-actions">
            <button
              type="button"
              className={entry.staged ? "gt-stage-toggle is-on" : "gt-stage-toggle"}
              title={entry.staged ? "取消暂存" : "暂存更改"}
              aria-pressed={entry.staged}
              disabled={(entry.staged ? unstagingFile : stagingFile) === entry.path}
              onClick={(event) => {
                event.stopPropagation();
                if (entry.staged) onUnstageFile(entry.path);
                else onStageFile(entry.path);
              }}
            >
              {entry.staged ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 8.2 6.7 11 12 5" />
                </svg>
              ) : null}
            </button>
            {canDiscard ? (
              <button
                type="button"
                className="gt-worktree-action-btn is-discard"
                title={entry.untracked ? "删除文件 (撤销新建)" : "撤销修改"}
                disabled={discardingFile === entry.path}
                onClick={(event) => {
                  event.stopPropagation();
                  onDiscardFile(entry.path, entry.untracked);
                }}
              >
                {discardingFile === entry.path ? (
                  "..."
                ) : (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 4 3 7l3 3" />
                    <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                  </svg>
                )}
              </button>
            ) : null}
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
    return <div className="gt-empty-hint">当前 worktree 没有待提交文件。</div>;
  }

  return (
    <>
      {stagedTree.length > 0 ? (
        <div className="gt-changes-group">
          <div className="gt-changes-group-header">
            <span className="gt-changes-group-title">Staged Changes</span>
            <span className="gt-changes-group-count">{stagedCount}</span>
          </div>
          <div className="gt-changes-group-list">
            <WorktreeFileTree {...treeProps} nodes={stagedTree} mode="unstage" />
          </div>
        </div>
      ) : null}

      {unstagedTree.length > 0 ? (
        <div className="gt-changes-group">
          <div className="gt-changes-group-header">
            <span className="gt-changes-group-title">Changes</span>
            <span className="gt-changes-group-count">{unstagedCount}</span>
          </div>
          <div className="gt-changes-group-list">
            <WorktreeFileTree {...treeProps} nodes={unstagedTree} mode="stage" />
          </div>
        </div>
      ) : null}
    </>
  );
}

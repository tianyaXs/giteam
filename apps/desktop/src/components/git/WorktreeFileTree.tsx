import type { ReactNode } from "react";
import type { GitWorktreeEntry } from "../../lib/types";
import { IconButton } from "../ui/icon-button";
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
        <div key={node.path} className="gt-worktree-tree-group">
          <div
            className={containsSelected
              ? "gt-worktree-tree-row gt-worktree-tree-dir is-ancestor-active"
              : "gt-worktree-tree-row gt-worktree-tree-dir"}
            style={{ paddingLeft: `${depth * 11 + 4}px` }}
            title={collapsed.node.path}
          >
            <button type="button" className="gt-worktree-dir-main-btn" onClick={() => onToggleDir(collapsed.node.path)}>
              <svg className={expanded ? "gt-worktree-tree-chevron is-open" : "gt-worktree-tree-chevron"} viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 4.5 10 8 6 11.5" />
              </svg>
              <span className="gt-worktree-tree-name">{collapsed.label}</span>
            </button>
            <div className="gt-worktree-row-tail">
              <span className="gt-worktree-tree-status is-dir">{filePaths.length}</span>
              <div className="gt-worktree-file-actions">
                <GitStageToggle
                  checked={mode === "unstage"}
                  title={mode === "unstage" ? "取消暂存此目录" : "暂存此目录"}
                  disabled={busyPath === collapsed.node.path || filePaths.length === 0}
                  onChange={() => {
                    if (mode === "unstage") onUnstagePaths(filePaths, collapsed.node.path);
                    else onStagePaths(filePaths, collapsed.node.path);
                  }}
                />
                {canDiscardDir ? (
                  <IconButton
                    type="button"
                    className="gt-worktree-action-btn"
                    tone="danger"
                    title="丢弃此目录变更"
                    disabled={discardingFile === collapsed.node.path}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDiscardEntries(entries, collapsed.node.path);
                    }}
                  >
                    {discardingFile === collapsed.node.path ? "..." : (
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M6 4 3 7l3 3" />
                        <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                      </svg>
                    )}
                  </IconButton>
                ) : null}
              </div>
            </div>
          </div>
          {expanded ? <div className="gt-worktree-tree-children">{renderNodes(collapsed.node.children, depth + 1)}</div> : null}
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
        className={selectedFile === entry.path ? "gt-worktree-tree-row gt-worktree-tree-file active" : "gt-worktree-tree-row gt-worktree-tree-file"}
        style={{ paddingLeft: `${depth * 11 + 4}px` }}
        title={`${entry.path} (${entry.indexStatus}${entry.worktreeStatus})`}
      >
        <button
          type="button"
          className="gt-worktree-file-main-btn"
          onClick={() => onOpenFile(entry.path)}
        >
          <span className="gt-worktree-tree-name">{node.name}</span>
        </button>
        <div className="gt-worktree-row-tail">
          <span className={`gt-worktree-tree-status is-${status.toLowerCase()}`}>{status}</span>
          <div className="gt-worktree-file-actions">
            <GitStageToggle
              checked={entry.staged}
              title={entry.staged ? "取消暂存" : "暂存更改"}
              disabled={(entry.staged ? unstagingFile : stagingFile) === entry.path}
              onChange={() => {
                if (entry.staged) onUnstageFile(entry.path);
                else onStageFile(entry.path);
              }}
            />
            {canDiscard ? (
              <IconButton
                type="button"
                className="gt-worktree-action-btn"
                tone="danger"
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
              </IconButton>
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

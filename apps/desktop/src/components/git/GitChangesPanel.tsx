import type { CSSProperties, Ref } from "react";
import { Suspense, lazy } from "react";
import type { DesktopTheme } from "../../lib/desktopPreferences";
import type { GitWorktreeEntry, GitWorktreeFileContent } from "../../lib/types";
import { getMonacoLanguage, getWorktreeFileKindLabel, type WorktreeTreeNode } from "../../lib/worktreeDiff";
import { CheckIcon, MinusIcon, PlusIcon, SyncIcon } from "../icons";
import { WorktreeChangesList } from "./WorktreeFileTree";

const MonacoDiffViewer = lazy(() => import("./MonacoDiffViewer"));

type WorktreeChangeStats = {
  total: number;
  staged: number;
  unstaged: number;
};

type GitChangesPanelText = {
  commit: string;
  push: string;
  commitPush: string;
  commitSync: string;
};

type GitChangesPanelProps = {
  branchName: string;
  ahead: number;
  behind: number;
  changesSidebarWidth: number;
  isResizing: boolean;
  changeStats: WorktreeChangeStats;
  stagedTree: WorktreeTreeNode[];
  unstagedTree: WorktreeTreeNode[];
  expandedDirs: string[];
  selectedFile: string;
  selectedEntry: GitWorktreeEntry | null;
  selectedContent: GitWorktreeFileContent;
  selectedLine?: number;
  viewMode?: "auto" | "editor" | "diff";
  patchStats: { added: number; deleted: number };
  commitMessage: string;
  commitMessageInputRef: Ref<HTMLInputElement>;
  committing: boolean;
  pushing: boolean;
  gitOperationLabel: string;
  commitPrimaryIsSync: boolean;
  hasCommittableChanges: boolean;
  commitButtonCount: number;
  commitMenuAvailable: boolean;
  showCommitActionMenu: boolean;
  stagingFile: string;
  unstagingFile: string;
  discardingFile: string;
  discardingAll: boolean;
  theme: DesktopTheme;
  appText: GitChangesPanelText;
  onCommitMessageChange: (value: string) => void;
  onToggleStageAll: () => void;
  onOpenDiscardAllConfirm: () => void;
  onToggleCommitActionMenu: () => void;
  onCommit: () => void;
  onPush: () => void;
  onSync: () => void;
  onCommitAndPush: () => void;
  onCommitAndSync: () => void;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStagePaths: (paths: string[], label: string) => void;
  onUnstagePaths: (paths: string[], label: string) => void;
  onDiscardFile: (path: string, isUntracked: boolean) => void;
  onDiscardEntries: (entries: GitWorktreeEntry[], label: string) => void;
  onCopyText: (text: string) => void;
  onBeginResize: (clientX: number) => void;
};

export function GitChangesPanel({
  branchName,
  ahead,
  behind,
  changesSidebarWidth,
  isResizing,
  changeStats,
  stagedTree,
  unstagedTree,
  expandedDirs,
  selectedFile,
  selectedEntry,
  selectedContent,
  selectedLine,
  viewMode = "auto",
  patchStats,
  commitMessage,
  commitMessageInputRef,
  committing,
  pushing,
  gitOperationLabel,
  commitPrimaryIsSync,
  hasCommittableChanges,
  commitButtonCount,
  commitMenuAvailable,
  showCommitActionMenu,
  stagingFile,
  unstagingFile,
  discardingFile,
  discardingAll,
  theme,
  appText,
  onCommitMessageChange,
  onToggleStageAll,
  onOpenDiscardAllConfirm,
  onToggleCommitActionMenu,
  onCommit,
  onPush,
  onSync,
  onCommitAndPush,
  onCommitAndSync,
  onToggleDir,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onStagePaths,
  onUnstagePaths,
  onDiscardFile,
  onDiscardEntries,
  onCopyText,
  onBeginResize
}: GitChangesPanelProps) {
  const isGitBusy = committing || pushing;
  const useCompactCommitLabel = changesSidebarWidth < 272;
  const useCompactSyncLabel = changesSidebarWidth < 308;
  const standaloneFileView = viewMode !== "auto";
  const singleFile = viewMode === "editor" || (viewMode !== "diff" && !selectedEntry);
  const inlineDiff = false;

  const commitPrimaryContent = gitOperationLabel ? (
    <span className="gt-commit-main-label">{gitOperationLabel}</span>
  ) : commitPrimaryIsSync ? (
    <>
      <SyncIcon width={16} height={16} />
      <span className="gt-commit-main-label">
        {useCompactSyncLabel ? "Sync" : `Sync (${ahead}/${behind})`}
      </span>
    </>
  ) : (
    <>
      <CheckIcon width={16} height={16} />
      <span className="gt-commit-main-label">
        {useCompactCommitLabel ? "Commit" : `Commit (${commitButtonCount})`}
      </span>
    </>
  );

  if (standaloneFileView) {
    return (
      <div className="gt-standalone-file-pane">
        {selectedFile ? (
          <div className="gt-monaco-diff-shell gt-monaco-diff-shell-standalone">
            <Suspense fallback={<div className="gt-worktree-patch-empty">Loading diff viewer...</div>}>
              <MonacoDiffViewer
                filePath={selectedFile}
                original={selectedContent.original}
                modified={selectedContent.modified}
                language={getMonacoLanguage(selectedFile)}
                theme={theme}
                focusLine={selectedLine}
                singleFile={singleFile}
                inlineDiff={inlineDiff}
              />
            </Suspense>
          </div>
        ) : (
          <div className="gt-worktree-patch-empty">没有可显示的文件。</div>
        )}
      </div>
    );
  }

  return (
    <div
      className="gt-panel-stack gt-panel-stack-split gt-changes-workspace"
      style={{ "--changes-sidebar-width": `${changesSidebarWidth}px` } as CSSProperties}
    >
      <div className="gt-right-card gt-right-card-files">
        <div className="gt-right-card-head gt-changes-pane-head">
          <div className="gt-changes-header">
            <strong>Changes</strong>
            <span className="gt-changes-context"><span>Local</span>{branchName || "no branch"}</span>
          </div>
          <div className="toolbar" style={{ gap: "var(--gt-space-1-5)" }}>
            {changeStats.total > 0 ? (
              <button
                type="button"
                className="chip gt-icon-chip"
                title={changeStats.unstaged > 0 ? "暂存所有更改" : "取消全部暂存"}
                onClick={onToggleStageAll}
              >
                {changeStats.unstaged > 0 ? <PlusIcon /> : <MinusIcon />}
              </button>
            ) : null}
            {changeStats.total > 0 ? (
              <button
                type="button"
                className="chip gt-icon-chip is-danger"
                title="撤销全部修改"
                disabled={discardingAll}
                onClick={onOpenDiscardAllConfirm}
              >
                <svg className="gt-icon-chip-svg" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4 3 7l3 3" />
                  <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <div className="gt-changes-commit-box">
          <input
            ref={commitMessageInputRef}
            className="path-input"
            style={{ width: "100%" }}
            placeholder="Message"
            value={commitMessage}
            onChange={(event) => onCommitMessageChange(event.target.value)}
            disabled={isGitBusy}
          />
          <div className="gt-changes-commit-actions" onClick={(event) => event.stopPropagation()}>
            <div className="gt-commit-split-wrap">
              <button
                className={isGitBusy
                  ? `chip is-primary gt-commit-main-btn${useCompactCommitLabel || useCompactSyncLabel ? " is-compact" : ""} is-loading`
                  : `chip is-primary gt-commit-main-btn${useCompactCommitLabel || useCompactSyncLabel ? " is-compact" : ""}`}
                onClick={commitPrimaryIsSync ? onSync : onCommit}
                disabled={commitPrimaryIsSync ? false : !hasCommittableChanges}
                aria-busy={isGitBusy}
                title={commitPrimaryIsSync ? "Sync branch" : (!hasCommittableChanges ? "No changes to commit" : "")}
              >
                {isGitBusy ? <span className="gt-btn-spinner" aria-hidden="true" /> : null}
                {commitPrimaryContent}
              </button>
              <button
                type="button"
                className={isGitBusy ? "gt-commit-menu-btn is-loading" : "gt-commit-menu-btn"}
                onClick={onToggleCommitActionMenu}
                disabled={isGitBusy || !commitMenuAvailable}
                title="More commit actions"
              >
                <svg className="gt-commit-chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4.5 6.5 8 10l3.5-3.5" />
                </svg>
              </button>
              {showCommitActionMenu ? (
                <div className="gt-commit-action-menu" role="menu">
                  <button type="button" role="menuitem" onClick={onCommit} disabled={isGitBusy || !hasCommittableChanges}>{appText.commit}</button>
                  <button type="button" role="menuitem" onClick={onPush} disabled={isGitBusy}>{appText.push}</button>
                  <button type="button" role="menuitem" onClick={onCommitAndPush} disabled={isGitBusy || !hasCommittableChanges}>{appText.commitPush}</button>
                  <button type="button" role="menuitem" onClick={onCommitAndSync} disabled={isGitBusy || !hasCommittableChanges}>{appText.commitSync}</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="gt-worktree-file-list gt-worktree-tree-list">
          <WorktreeChangesList
            stagedTree={stagedTree}
            unstagedTree={unstagedTree}
            stagedCount={changeStats.staged}
            unstagedCount={changeStats.unstaged}
            expandedDirs={expandedDirs}
            selectedFile={selectedFile}
            stagingFile={stagingFile}
            unstagingFile={unstagingFile}
            discardingFile={discardingFile}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onStagePaths={onStagePaths}
            onUnstagePaths={onUnstagePaths}
            onDiscardFile={onDiscardFile}
            onDiscardEntries={onDiscardEntries}
          />
        </div>
      </div>
      <div
        className={isResizing ? "gt-changes-splitter active" : "gt-changes-splitter"}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 Changes 文件树宽度"
        onMouseDown={(event) => {
          event.preventDefault();
          onBeginResize(event.clientX);
        }}
      />
      <div className="gt-right-card gt-right-card-fill gt-diff-editor-pane">
        <div className="gt-right-card-head gt-diff-compact-head">
          <div className="gt-diff-header">
            {selectedFile ? (
              <>
                <span className={`gt-worktree-kind gt-worktree-kind-${getWorktreeFileKindLabel(selectedFile)}`}>{getWorktreeFileKindLabel(selectedFile)}</span>
                <strong className="gt-diff-filename">{selectedFile}</strong>
                <button
                  type="button"
                  className="gt-diff-icon-btn"
                  title="复制文件路径"
                  onClick={() => onCopyText(selectedFile)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <rect x="5" y="3" width="8" height="8" rx="1.5" />
                    <path d="M3 5.5v6A1.5 1.5 0 0 0 4.5 13h6" />
                  </svg>
                </button>
                {patchStats.added > 0 ? <span className="meta-chip is-add">+{patchStats.added}</span> : null}
                {patchStats.deleted > 0 ? <span className="meta-chip is-del">-{patchStats.deleted}</span> : null}
              </>
            ) : (
              <span className="small muted">选择一个文件</span>
            )}
          </div>
          {selectedEntry ? (
            <div className="gt-diff-header-actions">
              <button
                className={selectedEntry.staged ? "gt-stage-toggle is-on" : "gt-stage-toggle"}
                title={selectedEntry.staged ? "取消暂存" : "暂存"}
                aria-pressed={selectedEntry.staged}
                onClick={() => {
                  if (selectedEntry.staged) {
                    onUnstageFile(selectedEntry.path);
                  } else {
                    onStageFile(selectedEntry.path);
                  }
                }}
                disabled={(selectedEntry.staged ? unstagingFile : stagingFile) === selectedEntry.path}
              >
                {selectedEntry.staged ? (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 8.2 6.7 11 12 5" />
                  </svg>
                ) : null}
              </button>
              {(selectedEntry.staged || selectedEntry.unstaged || selectedEntry.untracked) ? (
                <button
                  className="gt-diff-icon-btn is-danger"
                  title="撤销修改"
                  onClick={() => onDiscardFile(selectedEntry.path, selectedEntry.untracked)}
                  disabled={discardingFile === selectedEntry.path}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M6 4 3 7l3 3" />
                    <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                  </svg>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {selectedFile ? (
          <div className="gt-monaco-diff-shell">
            <Suspense fallback={<div className="gt-worktree-patch-empty">Loading diff viewer...</div>}>
              <MonacoDiffViewer
                filePath={selectedFile}
                original={selectedContent.original}
                modified={selectedContent.modified}
                language={getMonacoLanguage(selectedFile)}
                theme={theme}
                focusLine={selectedLine}
                singleFile={singleFile}
                inlineDiff={inlineDiff}
              />
            </Suspense>
          </div>
        ) : (
          <div className="gt-worktree-patch-empty">选择左侧文件后查看 patch。</div>
        )}
      </div>
    </div>
  );
}

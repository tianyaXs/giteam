import type { CSSProperties } from "react";
import { Suspense, lazy, memo, useEffect, useMemo, useRef } from "react";
import { Decoration, Diff, Hunk, getCollapsedLinesCountBetween, markEdits, parseDiff, tokenize, type FileData, type HunkData } from "react-diff-view";
import "react-diff-view/style/index.css";
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type ListRange } from "react-virtuoso";
import type { DesktopTheme } from "../../lib/desktopPreferences";
import type { GitWorktreeEntry, GitWorktreeFileContent } from "../../lib/types";
import {
  getMonacoLanguage,
  getWorktreeDisplayStatus,
  type WorktreeTreeNode
} from "../../lib/worktreeDiff";
import { CheckIcon, ChevronDownIcon, CopyIcon, MinusIcon, PlusIcon } from "../icons";
import { IconButton } from "../ui/icon-button";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { GitStageToggle } from "./GitStageToggle";
import { WorktreeChangesList } from "./WorktreeFileTree";

const MonacoDiffViewer = lazy(() => import("./MonacoDiffViewer"));
const DocumentPreviewViewer = lazy(() => import("./DocumentPreviewViewer").then((module) => ({
  default: module.DocumentPreviewViewer
})));

const DIFF_STREAM_BATCH_SIZE = 10;
const DIFF_STREAM_PRELOAD_SIZE = 10;
const DIFF_STREAM_OVERSCAN_PX = 720;

type WorktreeChangeStats = {
  total: number;
  staged: number;
  unstaged: number;
};

type GitChangesPanelProps = {
  branchName: string;
  changesSidebarWidth: number;
  isResizing: boolean;
  changeStats: WorktreeChangeStats;
  lineStats: { added: number; deleted: number };
  entries: GitWorktreeEntry[];
  patchByPath: Record<string, string>;
  stagedTree: WorktreeTreeNode[];
  unstagedTree: WorktreeTreeNode[];
  expandedDirs: string[];
  selectedFile: string;
  selectedEntry: GitWorktreeEntry | null;
  selectedContent: GitWorktreeFileContent;
  selectedLine?: number;
  viewMode?: "auto" | "editor" | "diff";
  committing: boolean;
  pushing: boolean;
  gitOperationLabel: string;
  commitMenuAvailable: boolean;
  stagingFile: string;
  unstagingFile: string;
  discardingFile: string;
  discardingAll: boolean;
  theme: DesktopTheme;
  onToggleStageAll: () => void;
  onOpenDiscardAllConfirm: () => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
  onCommitAndSync: () => void;
  onPatchWindowChange: (count: number) => void;
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

type DiffFileBlockProps = {
  entry: GitWorktreeEntry;
  stats: { added: number; deleted: number };
  isSelected: boolean;
  stagingFile: string;
  unstagingFile: string;
  discardingFile: string;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onDiscardFile: (path: string, isUntracked: boolean) => void;
  onCopyText: (text: string) => void;
};

type DiffFileModel = {
  entry: GitWorktreeEntry;
  file: FileData | null;
  stats: { added: number; deleted: number };
  state: "loading" | "empty" | "ready";
};

function normalizePatchForDiffView(entry: GitWorktreeEntry, patch: string) {
  const cleanedPatch = patch
    .split(/\r?\n/)
    .filter((line) => line !== "# Staged" && line !== "# Working Tree")
    .join("\n")
    .trim();

  if (cleanedPatch.includes("diff --git")) return cleanedPatch;
  const oldPath = entry.untracked ? "/dev/null" : `a/${entry.path}`;
  const newPath = `b/${entry.path}`;
  return [
    `diff --git a/${entry.path} b/${entry.path}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    cleanedPatch
  ].filter(Boolean).join("\n");
}

function parsePatchForDiffView(entry: GitWorktreeEntry, patch: string): FileData | null {
  const files = parseDiff(normalizePatchForDiffView(entry, patch), { nearbySequences: "zip" });
  if (files.length === 0) return null;
  const [firstFile, ...restFiles] = files;
  if (restFiles.length === 0) return firstFile;
  return {
    ...firstFile,
    hunks: files.flatMap((file) => file.hunks),
    oldEndingNewLine: files.every((file) => file.oldEndingNewLine),
    newEndingNewLine: files.every((file) => file.newEndingNewLine)
  };
}

function getDiffFileStats(file: FileData | null) {
  if (!file) return { added: 0, deleted: 0 };
  let added = 0;
  let deleted = 0;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "insert") added += 1;
      if (change.type === "delete") deleted += 1;
    }
  }
  return { added, deleted };
}

function renderUnifiedLineNumber(change: HunkData["changes"][number]) {
  if (change.type === "normal") {
    return change.newLineNumber ?? change.oldLineNumber ?? "";
  }
  return change.lineNumber ?? "";
}

const DiffFileHeader = memo(function DiffFileHeader({
  entry,
  stats,
  isSelected,
  stagingFile,
  unstagingFile,
  discardingFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onCopyText
}: DiffFileBlockProps) {
  const status = getWorktreeDisplayStatus(entry);

  return (
    <div
      className={isSelected ? "gt-diff-file-head is-selected" : "gt-diff-file-head"}
      id={`diff-${entry.path.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
    >
      <div className="gt-diff-file-title">
        <strong>{entry.path}</strong>
        <IconButton
          type="button"
          className="gt-diff-icon-btn"
          size="md"
          title="复制文件路径"
          onClick={() => onCopyText(entry.path)}
        >
          <CopyIcon />
        </IconButton>
      </div>
      <div className="gt-diff-file-actions">
        {stats.added > 0 ? <span className="meta-chip is-add">+{stats.added}</span> : null}
        {stats.deleted > 0 ? <span className="meta-chip is-del">-{stats.deleted}</span> : null}
        <span className={`gt-worktree-tree-status is-${status.toLowerCase()}`}>{status}</span>
        <GitStageToggle
          checked={entry.staged}
          compact
          title={entry.staged ? "取消暂存" : "暂存"}
          onChange={() => {
            if (entry.staged) {
              onUnstageFile(entry.path);
            } else {
              onStageFile(entry.path);
            }
          }}
          disabled={(entry.staged ? unstagingFile : stagingFile) === entry.path}
        />
        {(entry.staged || entry.unstaged || entry.untracked) ? (
          <IconButton
            className="gt-diff-icon-btn"
            tone="danger"
            size="md"
            title="撤销修改"
            onClick={() => onDiscardFile(entry.path, entry.untracked)}
            disabled={discardingFile === entry.path}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4 3 7l3 3" />
              <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
            </svg>
          </IconButton>
        ) : null}
      </div>
    </div>
  );
});

const DiffFileContent = memo(function DiffFileContent({ model }: { model: DiffFileModel }) {
  const file = model.file;
  const tokens = useMemo(() => {
    if (!file || file.hunks.length === 0) return null;
    return tokenize(file.hunks, {
      enhancers: [markEdits(file.hunks, { type: "block" })]
    });
  }, [file]);

  if (model.state === "loading") {
    return <div className="gt-diff-loading-row">Loading diff...</div>;
  }

  if (!file || file.hunks.length === 0) {
    return <div className="gt-diff-loading-row">No visible diff for this file.</div>;
  }

  return (
    <div className="gt-react-diff-shell">
      <Diff
        className="gt-react-diff"
        viewType="unified"
        diffType={file.type}
        hunks={file.hunks}
        tokens={tokens}
        renderGutter={({ change, side }) => (
          side === "new" ? <span>{renderUnifiedLineNumber(change)}</span> : null
        )}
      >
        {(hunks) => hunks.flatMap((hunk: HunkData, index: number) => {
          const previousHunk = hunks[index - 1];
          const collapsedLines = previousHunk ? getCollapsedLinesCountBetween(previousHunk, hunk) : 0;
          const nodes = [];
          if (collapsedLines > 0) {
            nodes.push(
              <Decoration key={`fold-${hunk.content}`} contentClassName="gt-react-diff-fold">
                <span className="gt-react-diff-fold-copy">{collapsedLines} unchanged lines</span>
              </Decoration>
            );
          }
          nodes.push(<Hunk key={hunk.content} hunk={hunk} />);
          return nodes;
        })}
      </Diff>
    </div>
  );
});

export function GitChangesPanel({
  branchName,
  changesSidebarWidth,
  isResizing,
  changeStats,
  lineStats,
  entries,
  patchByPath,
  stagedTree,
  unstagedTree,
  expandedDirs,
  selectedFile,
  selectedEntry,
  selectedContent,
  selectedLine,
  viewMode = "auto",
  committing,
  pushing,
  gitOperationLabel,
  commitMenuAvailable,
  stagingFile,
  unstagingFile,
  discardingFile,
  discardingAll,
  theme,
  onToggleStageAll,
  onOpenDiscardAllConfirm,
  onCommit,
  onCommitAndPush,
  onCommitAndSync,
  onPatchWindowChange,
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
  const standaloneFileView = viewMode !== "auto";
  const singleFile = viewMode === "editor" || (viewMode !== "diff" && !selectedEntry);
  const inlineDiff = true;
  const previewSupported = selectedContent.previewSupported !== false;
  const previewReason = selectedContent.previewReason || "该文件可能是二进制文件或包含不可解析内容，暂不支持文本预览。";
  const previewFileName = selectedFile.split(/[\\/]/).pop() || selectedFile;
  const shouldUseDocumentPreview = Boolean(selectedContent.dataBase64);
  const hasSelectedCommitContent = changeStats.staged > 0;
  const showPrimaryCommitAction = hasSelectedCommitContent || isGitBusy;
  const patchStreamKey = useMemo(
    () => entries.map((entry) => `${entry.path}:${entry.indexStatus}:${entry.worktreeStatus}`).join("|"),
    [entries]
  );
  const virtuosoRef = useRef<GroupedVirtuosoHandle | null>(null);
  const diffPaneRef = useRef<HTMLDivElement | null>(null);

  const resetDiffShellScroll = () => {
    diffPaneRef.current
      ?.querySelectorAll<HTMLElement>(".gt-react-diff-shell")
      .forEach((element) => {
        element.scrollLeft = 0;
      });
  };

  useEffect(() => {
    onPatchWindowChange(Math.min(DIFF_STREAM_BATCH_SIZE + DIFF_STREAM_PRELOAD_SIZE, entries.length));
    virtuosoRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.requestAnimationFrame(() => {
      resetDiffShellScroll();
    });
  }, [entries.length, onPatchWindowChange, patchStreamKey]);

  const diffFileModels = useMemo<DiffFileModel[]>(() => entries.map((entry) => {
    const patch = patchByPath[entry.path];
    if (patch === undefined) {
      return { entry, file: null, stats: { added: 0, deleted: 0 }, state: "loading" };
    }

    const file = parsePatchForDiffView(entry, patch);
    return { entry, file, stats: getDiffFileStats(file), state: file ? "ready" : "empty" };
  }), [entries, patchByPath]);

  const groupCounts = useMemo(
    () => diffFileModels.map(() => 1),
    [diffFileModels]
  );

  const groupItemStartIndexes = useMemo(() => {
    let nextIndex = 0;
    return groupCounts.map((count) => {
      const start = nextIndex;
      nextIndex += count;
      return start;
    });
  }, [groupCounts]);

  const findGroupIndexForItem = (itemIndex: number) => {
    let low = 0;
    let high = groupItemStartIndexes.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = groupItemStartIndexes[mid];
      const end = start + groupCounts[mid] - 1;
      if (itemIndex < start) high = mid - 1;
      else if (itemIndex > end) low = mid + 1;
      else return mid;
    }
    return Math.max(0, Math.min(groupItemStartIndexes.length - 1, low));
  };

  const handleVirtualRangeChanged = (range: ListRange) => {
    if (entries.length === 0) return;
    const endGroupIndex = findGroupIndexForItem(range.endIndex);
    onPatchWindowChange(Math.min(endGroupIndex + 1 + DIFF_STREAM_PRELOAD_SIZE, entries.length));
  };

  useEffect(() => {
    const selectedIndex = entries.findIndex((entry) => entry.path === selectedFile);
    if (selectedIndex < 0) return;
    onPatchWindowChange(Math.min(selectedIndex + 1 + DIFF_STREAM_PRELOAD_SIZE, entries.length));
    window.requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ groupIndex: selectedIndex, align: "start", behavior: "auto" });
      virtuosoRef.current?.scrollTo({ left: 0, behavior: "auto" });
      resetDiffShellScroll();
    });
  }, [entries, entries.length, onPatchWindowChange, selectedFile]);

  const commitPrimaryContent = gitOperationLabel ? (
    <span className="gt-commit-main-content">
      <span className="gt-commit-main-label">{gitOperationLabel}</span>
    </span>
  ) : (
    <span className="gt-commit-main-content">
      <CheckIcon width={16} height={16} />
      <span className="gt-commit-main-label">Commit & Push</span>
    </span>
  );

  const renderUnsupportedPreview = () => (
    <div className="gt-worktree-patch-empty gt-worktree-preview-empty">
      <div className="gt-worktree-preview-copy">
        <strong>不支持的预览类型</strong>
        <p>{previewFileName}</p>
        <span>{previewReason}</span>
      </div>
    </div>
  );

  const renderPreviewContent = (shellClassName?: string) => {
    if (!selectedFile) {
      return <div className="gt-worktree-patch-empty">没有可显示的文件。</div>;
    }
    if (!previewSupported) {
      return renderUnsupportedPreview();
    }
    if (shouldUseDocumentPreview) {
      return (
        <div className={`${shellClassName ?? "gt-monaco-diff-shell"} gt-monaco-diff-shell-document`}>
          <Suspense fallback={<div className="gt-worktree-patch-empty">Loading document preview...</div>}>
            <DocumentPreviewViewer filePath={selectedFile} content={selectedContent} />
          </Suspense>
        </div>
      );
    }
    return (
      <div className={shellClassName ?? "gt-monaco-diff-shell"}>
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
    );
  };

  const renderPatchStream = () => {
    if (entries.length === 0) {
      return <div className="gt-worktree-patch-empty">当前 worktree 没有待提交文件。</div>;
    }

    return (
      <GroupedVirtuoso
        ref={virtuosoRef}
        className="gt-worktree-diff-stream"
        groupCounts={groupCounts}
        increaseViewportBy={{ top: DIFF_STREAM_OVERSCAN_PX, bottom: DIFF_STREAM_OVERSCAN_PX }}
        rangeChanged={handleVirtualRangeChanged}
        groupContent={(groupIndex) => {
          const model = diffFileModels[groupIndex];
          if (!model) return null;
          return (
            <DiffFileHeader
              entry={model.entry}
              stats={model.stats}
              isSelected={selectedFile === model.entry.path}
              stagingFile={stagingFile}
              unstagingFile={unstagingFile}
              discardingFile={discardingFile}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardFile={onDiscardFile}
              onCopyText={onCopyText}
            />
          );
        }}
        itemContent={(index, groupIndex) => {
          const model = diffFileModels[groupIndex];
          if (!model) return null;
          return <DiffFileContent model={model} />;
        }}
      />
    );
  };

  if (standaloneFileView) {
    return (
      <div className="gt-standalone-file-pane">
        {renderPreviewContent("gt-monaco-diff-shell gt-monaco-diff-shell-standalone")}
      </div>
    );
  }

  return (
    <div
      className="gt-panel-stack gt-panel-stack-split gt-changes-workspace"
      style={{ "--changes-sidebar-width": `${changesSidebarWidth}px` } as CSSProperties}
    >
      <div className="gt-changes-toolbar">
        <div className="gt-changes-toolbar-row gt-changes-branch-row">
          <div className="gt-changes-branch">
            <Badge variant="outline" className="gt-changes-branch-badge">Local</Badge>
            <span className="gt-changes-branch-name">{branchName || "no branch"}</span>
          </div>
          {showPrimaryCommitAction ? (
            <div className="gt-changes-toolbar-commit" onClick={(event) => event.stopPropagation()}>
              <div className="gt-changes-commit-actions">
                <div className="gt-commit-split-wrap">
                  <Button
                    variant="contrast"
                    size="sm"
                    className={isGitBusy
                      ? "gt-commit-main-btn is-loading"
                      : "gt-commit-main-btn"}
                    onClick={onCommitAndPush}
                    disabled={!hasSelectedCommitContent}
                    aria-busy={isGitBusy}
                    title={!hasSelectedCommitContent ? "没有可提交的已暂存更改" : ""}
                  >
                    {isGitBusy ? <span className="gt-btn-spinner" aria-hidden="true" /> : null}
                    {commitPrimaryContent}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="contrast"
                        size="icon"
                        className={isGitBusy ? "gt-commit-menu-btn is-loading" : "gt-commit-menu-btn"}
                        disabled={isGitBusy}
                        title="更多提交操作"
                      >
                        <ChevronDownIcon className="gt-commit-chevron" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="gt-commit-action-menu"
                    >
                      <DropdownMenuLabel className="gt-commit-action-label">
                        提交操作
                      </DropdownMenuLabel>
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          className="gt-commit-action-item"
                          onClick={onCommitAndPush}
                          disabled={isGitBusy || !hasSelectedCommitContent}
                        >
                          Commit & Push
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gt-commit-action-item"
                          onClick={onCommit}
                          disabled={isGitBusy || !hasSelectedCommitContent}
                        >
                          Commit
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          className="gt-commit-action-item"
                          onClick={onCommitAndSync}
                          disabled={isGitBusy || !hasSelectedCommitContent}
                        >
                          Commit & Create PR
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="gt-changes-toolbar-row gt-changes-summary-row">
          <div className="gt-changes-summary">
            <span className="gt-changes-summary-count">{changeStats.total} Uncommitted Changes</span>
            <Badge variant="success" className="gt-changes-summary-badge">+{lineStats.added}</Badge>
            <Badge variant="destructive" className="gt-changes-summary-badge">-{lineStats.deleted}</Badge>
          </div>
          <div className="gt-changes-bulk-actions">
            {changeStats.total > 0 ? (
              <Button
                variant="outline"
                size="icon"
                className="gt-icon-chip is-danger"
                title="撤销全部修改"
                disabled={discardingAll}
                onClick={onOpenDiscardAllConfirm}
              >
                <svg className="gt-icon-chip-svg" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4 3 7l3 3" />
                  <path d="M3.5 7H10a3 3 0 1 1 0 6H8" />
                </svg>
              </Button>
            ) : null}
            {changeStats.total > 0 ? (
              <Button
                variant="outline"
                size="icon"
                className="gt-icon-chip"
                title={changeStats.unstaged > 0 ? "暂存所有更改" : "取消全部暂存"}
                onClick={onToggleStageAll}
              >
                {changeStats.unstaged > 0 ? <PlusIcon /> : <MinusIcon />}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="gt-right-card gt-right-card-files">
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
      <div
        ref={diffPaneRef}
        className="gt-right-card gt-right-card-fill gt-diff-editor-pane gt-diff-stream-pane"
      >
        {renderPatchStream()}
      </div>
    </div>
  );
}

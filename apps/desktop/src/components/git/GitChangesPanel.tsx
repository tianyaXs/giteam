import type { CSSProperties } from "react";
import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState } from "react";
import { Decoration, Diff, Hunk, getCollapsedLinesCountBetween, markEdits, parseDiff, tokenize, type FileData, type HunkData } from "react-diff-view";
import "react-diff-view/style/index.css";
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type ListRange } from "react-virtuoso";
import { CheckIcon as StageAllIcon, MinusIcon as UnstageAllIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesktopTheme } from "../../lib/desktopPreferences";
import type { GitWorktreeEntry, GitWorktreeFileContent } from "../../lib/types";
import {
  getMonacoLanguage,
  getWorktreeDisplayStatus,
  type WorktreeTreeNode
} from "../../lib/worktreeDiff";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "../icons";
import { IconButton } from "../ui/icon-button";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { GitStageToggle } from "./GitStageToggle";
import { WorktreeChangesList } from "./WorktreeFileTree";

const MonacoDiffViewer = lazy(() => import("./MonacoDiffViewer"));
const DocumentPreviewViewer = lazy(() => import("./DocumentPreviewViewer").then((module) => ({
  default: module.DocumentPreviewViewer
})));

const DIFF_STREAM_BATCH_SIZE = 10;
const DIFF_STREAM_PRELOAD_SIZE = 10;
const DIFF_STREAM_OVERSCAN_PX = 720;
const DIFF_STREAM_SELECTOR = ".worktree-diff-stream";

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
  const statusVariant = status.toLowerCase() === "d" ? "destructive" : status.toLowerCase() === "a" ? "success" : "secondary";

  return (
    <div
      className={cn(
        "sticky top-0 flex min-h-8 items-center justify-between gap-2 border-b border-border/35 bg-card px-3 py-1 pr-5",
        isSelected && "shadow-[inset_2px_0_0_var(--ring)]"
      )}
      id={`diff-${entry.path.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
    >
      <div className="inline-flex min-w-0 flex-1 items-center gap-1">
        <strong className="min-w-0 truncate text-[11.25px] font-medium tracking-[-0.01em] text-foreground">{entry.path}</strong>
        <IconButton
          type="button"
          size="md"
          title="复制文件路径"
          onClick={() => onCopyText(entry.path)}
        >
          <CopyIcon />
        </IconButton>
      </div>
      <div className="inline-flex min-w-0 shrink-0 items-center gap-1">
        <div className="inline-flex min-w-0 items-center justify-end gap-1">
          {stats.added > 0 ? <Badge variant="success" className="px-1.5 tracking-normal">+{stats.added}</Badge> : null}
          {stats.deleted > 0 ? <Badge variant="destructive" className="px-1.5 tracking-normal">-{stats.deleted}</Badge> : null}
          <Badge variant={statusVariant} className="min-w-5 justify-center px-1.5 tracking-normal">{status}</Badge>
        </div>
        <div className="inline-flex w-14 shrink-0 justify-end gap-1">
          {(entry.staged || entry.unstaged || entry.untracked) ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3.5"
              title="撤销修改"
              aria-label="撤销修改"
              onClick={() => onDiscardFile(entry.path, entry.untracked)}
              disabled={discardingFile === entry.path}
            >
              <RotateCcwIcon aria-hidden="true" />
            </Button>
          ) : null}
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
        </div>
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
    return (
      <div className="flex min-h-12 items-center px-3">
        <Skeleton className="h-4 w-40 rounded-full" />
      </div>
    );
  }

  if (!file || file.hunks.length === 0) {
    return (
      <Empty className="min-h-12 rounded-none border-0 py-2">
        <EmptyDescription>No visible diff for this file.</EmptyDescription>
      </Empty>
    );
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
  const [diffScrollbarGutter, setDiffScrollbarGutter] = useState(0);

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

  useEffect(() => {
    const pane = diffPaneRef.current;
    if (!pane || standaloneFileView) return;

    let animationFrame = 0;
    const measure = () => {
      const stream = pane.querySelector<HTMLElement>(DIFF_STREAM_SELECTOR);
      const gutter = stream ? Math.max(0, stream.offsetWidth - stream.clientWidth) : 0;
      setDiffScrollbarGutter((current) => current === gutter ? current : gutter);
    };
    const scheduleMeasure = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
      };
    }

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(pane);
    const stream = pane.querySelector<HTMLElement>(DIFF_STREAM_SELECTOR);
    if (stream) {
      resizeObserver.observe(stream);
    }

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [patchStreamKey, standaloneFileView]);

  const commitPrimaryContent = gitOperationLabel ? (
    <span>{gitOperationLabel}</span>
  ) : (
    <span className="inline-flex items-center gap-2">
      <CheckIcon data-icon="inline-start" />
      <span>Commit & Push</span>
    </span>
  );

  const renderUnsupportedPreview = () => (
    <Empty className="h-full rounded-none border-0 bg-background/60">
      <EmptyHeader>
        <EmptyTitle>不支持的预览类型</EmptyTitle>
        <EmptyDescription>
          <span className="block break-words font-mono text-foreground">{previewFileName}</span>
          <span className="block">{previewReason}</span>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  const renderPreviewContent = (shellClassName?: string) => {
    if (!selectedFile) {
      return (
        <Empty className="h-full rounded-none border-0">
          <EmptyDescription>没有可显示的文件。</EmptyDescription>
        </Empty>
      );
    }
    if (!previewSupported) {
      return renderUnsupportedPreview();
    }
    if (shouldUseDocumentPreview) {
      return (
        <div className={`${shellClassName ?? "gt-monaco-diff-shell"} gt-monaco-diff-shell-document`}>
          <Suspense fallback={(
            <Empty className="h-full rounded-none border-0">
              <EmptyDescription>Loading document preview...</EmptyDescription>
            </Empty>
          )}>
            <DocumentPreviewViewer filePath={selectedFile} content={selectedContent} />
          </Suspense>
        </div>
      );
    }
    return (
      <div className={shellClassName ?? "gt-monaco-diff-shell"}>
        <Suspense fallback={(
          <Empty className="h-full rounded-none border-0">
            <EmptyDescription>Loading diff viewer...</EmptyDescription>
          </Empty>
        )}>
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
      return (
        <Empty className="h-full rounded-none border-0">
          <EmptyDescription>当前 worktree 没有待提交文件。</EmptyDescription>
        </Empty>
      );
    }

    return (
      <GroupedVirtuoso
        ref={virtuosoRef}
        className="worktree-diff-stream h-full min-h-0 overflow-auto bg-background font-mono text-[11.6px] leading-[1.36] [scrollbar-gutter:stable]"
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
      <div className="flex h-full min-h-0 flex-col">
        {renderPreviewContent("gt-monaco-diff-shell h-full rounded-none border-0")}
      </div>
    );
  }

  return (
    <div
      className="grid h-full min-h-0 overflow-hidden border-0 bg-border/55"
      style={{
        "--changes-sidebar-width": `${changesSidebarWidth}px`,
        gridTemplateColumns: "var(--changes-sidebar-width, 276px) 1px minmax(0, 1fr)",
        gridTemplateRows: "auto minmax(0, 1fr)"
      } as CSSProperties}
    >
      <div className="col-span-full grid min-w-0 grid-rows-[33px_28px] border-b border-border/40 bg-background">
        <div className="grid min-w-0 grid-cols-[var(--changes-sidebar-width,276px)_1px_minmax(0,1fr)] items-center border-b border-border/35">
          <div className="inline-flex min-w-0 items-center gap-1 px-3 text-muted-foreground">
            <Badge variant="outline" className="h-5 px-2 text-[10px] tracking-wide">Local</Badge>
            <span className="min-w-0 truncate text-[11px] font-medium text-foreground/78">{branchName || "no branch"}</span>
          </div>
          <div className="h-full bg-border/45" aria-hidden="true" />
          {showPrimaryCommitAction ? (
            <div className="col-start-3 flex min-w-0 justify-end px-2" onClick={(event) => event.stopPropagation()}>
              <div className="inline-flex items-center rounded-md shadow-sm">
                <Button
                  variant="contrast"
                  size="sm"
                  className="rounded-r-none"
                  onClick={onCommitAndPush}
                  disabled={!hasSelectedCommitContent}
                  aria-busy={isGitBusy}
                  title={!hasSelectedCommitContent ? "没有可提交的已暂存更改" : ""}
                >
                  {commitPrimaryContent}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="contrast"
                      size="icon"
                      className="size-8 rounded-l-none border-l border-background/20 px-2"
                      disabled={isGitBusy}
                      title="更多提交操作"
                      aria-label="更多提交操作"
                    >
                      <ChevronDownIcon data-icon="inline-start" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      提交操作
                    </DropdownMenuLabel>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={onCommitAndPush}
                        disabled={isGitBusy || !hasSelectedCommitContent}
                      >
                        Commit & Push
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={onCommit}
                        disabled={isGitBusy || !hasSelectedCommitContent}
                      >
                        Commit
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
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
          ) : null}
        </div>
        <div className="grid min-w-0 grid-cols-[var(--changes-sidebar-width,276px)_1px_minmax(0,1fr)] items-center bg-muted/10">
          <div className="flex min-w-0 items-center gap-2 px-2">
            <div className="inline-flex min-w-0 items-center gap-1 text-[11px] text-foreground/86">
              <span className="min-w-0 truncate">{changeStats.total} Uncommitted Changes</span>
              <Badge variant="success" className="px-1.5 text-[10px] tracking-normal">+{lineStats.added}</Badge>
              <Badge variant="destructive" className="px-1.5 text-[10px] tracking-normal">-{lineStats.deleted}</Badge>
            </div>
          </div>
          <div className="h-full bg-border/45" aria-hidden="true" />
          <div className="col-start-3 flex min-w-0 justify-end pl-2" style={{ paddingRight: 20 + diffScrollbarGutter }}>
            <div className="inline-flex w-14 justify-end gap-1">
              {changeStats.total > 0 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3.5"
                  title="撤销全部修改"
                  aria-label="撤销全部修改"
                  disabled={discardingAll}
                  onClick={onOpenDiscardAllConfirm}
                >
                  <RotateCcwIcon aria-hidden="true" />
                </Button>
              ) : null}
              {changeStats.total > 0 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-sm text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground [&_svg]:size-3.5"
                  title={changeStats.unstaged > 0 ? "暂存所有更改" : "取消全部暂存"}
                  aria-label={changeStats.unstaged > 0 ? "暂存所有更改" : "取消全部暂存"}
                  onClick={onToggleStageAll}
                >
                  {changeStats.unstaged > 0 ? <StageAllIcon aria-hidden="true" /> : <UnstageAllIcon aria-hidden="true" />}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <Card className="flex min-h-0 flex-col overflow-hidden rounded-none border-0 bg-card shadow-none">
        <ScrollArea className="min-h-0 flex-1" viewportClassName="min-h-0">
          <div className="flex min-h-0 flex-col gap-1 p-1.5 pb-2">
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
        </ScrollArea>
      </Card>
      <div
        className={cn(
          "relative w-px cursor-col-resize bg-border/60 after:absolute after:inset-y-0 after:left-1/2 after:w-2.5 after:-translate-x-1/2 after:bg-transparent hover:bg-ring/60",
          isResizing && "bg-ring/60"
        )}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 Changes 文件树宽度"
        onMouseDown={(event) => {
          event.preventDefault();
          onBeginResize(event.clientX);
        }}
      />
      <Card
        ref={diffPaneRef}
        className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-none border-0 bg-background shadow-none"
      >
        {renderPatchStream()}
      </Card>
    </div>
  );
}

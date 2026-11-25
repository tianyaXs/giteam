import { useMemo } from "react";
import {
  ChevronDownIcon,
  CopyIcon as CopyGlyph,
  DownloadIcon as DownloadGlyph,
  FolderOpenIcon as FolderOpenGlyph,
  MaximizeIcon as MaximizeGlyph,
  MessageSquarePlusIcon as MessageSquarePlusGlyph,
  PanelRightIcon as PanelRightGlyph
} from "lucide-react";
import { CheckIcon } from "../icons";
import { FileTypeGlyph } from "../agent/FileTypeGlyph";
import { IconButton } from "../ui/icon-button";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../ui/dropdown-menu";

const ZOOM_LEVELS = [50, 76, 100, 125, 150, 200];

const ZOOMABLE_EXTS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx"]);

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path || "attachment";
}

function extFromName(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

type DocumentPreviewToolbarProps = {
  filePath: string;
  mime?: string;
  hasBinary?: boolean;
  zoom?: number;
  /** zoom 是否处于自动适配状态；「适合宽度」据此恢复自动而不是套固定 94%。 */
  zoomAuto?: boolean;
  canRequestModify?: boolean;
  canCollapse?: boolean;
  onZoomChange?: (zoom: number) => void;
  onRequestModify?: () => void;
  onDownload?: () => void;
  onOpenExternal?: () => void;
  onCopyPath?: () => void;
  onCollapse?: () => void;
};

export function DocumentPreviewToolbar({
  filePath,
  mime,
  hasBinary,
  zoom = 1,
  zoomAuto = false,
  canRequestModify,
  canCollapse,
  onZoomChange,
  onRequestModify,
  onDownload,
  onOpenExternal,
  onCopyPath,
  onCollapse
}: DocumentPreviewToolbarProps) {
  const fileName = fileNameFromPath(filePath);
  const ext = extFromName(fileName);
  const zoomable = ZOOMABLE_EXTS.has(ext);
  const zoomPercent = Math.round(zoom * 100);
  const matchedLevel = useMemo(
    () => ZOOM_LEVELS.find((level) => Math.round(level) === zoomPercent),
    [zoomPercent]
  );

  const selectZoom = (value: number) => {
    if (!onZoomChange) return;
    // 「适合宽度」回到自动适配：真实最佳比例由 viewer 测量（页宽 ÷ 可用宽），
    // 且面板宽度变化时持续跟随，这里只负责切回 auto 模式。
    if (value < 0) {
      onZoomChange(-1);
      return;
    }
    onZoomChange(value / 100);
  };

  return (
    <div
      data-attachment-preview-toolbar
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border/55 bg-card/70 px-2"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 min-w-0 max-w-[46%] items-center gap-1.5 rounded-lg border border-border/70 bg-background/85 px-1.5 text-[12px] font-medium text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-foreground/25 hover:bg-accent/45"
            title={filePath}
          >
            <FileTypeGlyph filename={fileName} mime={mime} size="sm" className="size-5 rounded-md text-[9px]" />
            <span className="min-w-0 truncate">{fileName}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel className="truncate text-[11px] text-muted-foreground">{filePath}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 rounded-md px-2 py-1.5 text-[13px] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:text-muted-foreground"
            onSelect={() => onOpenExternal?.()}
          >
            <FolderOpenGlyph aria-hidden="true" />
            在系统中打开
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 rounded-md px-2 py-1.5 text-[13px] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:text-muted-foreground"
            onSelect={() => onCopyPath?.()}
          >
            <CopyGlyph aria-hidden="true" />
            复制文件路径
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        className="h-7 shrink-0 gap-1.5 rounded-lg px-2 text-[12px] text-foreground/88 hover:bg-accent/50 hover:text-foreground [&_svg]:size-3.5"
        onClick={() => onRequestModify?.()}
        disabled={!canRequestModify}
        title="把该文件作为上下文，向 agent 请求修改"
      >
        <MessageSquarePlusGlyph aria-hidden="true" />
        请求修改
      </Button>
      <div className="ml-auto flex min-w-0 items-center gap-1">
        {zoomable && onZoomChange ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/70 bg-background/85 px-2 text-[12px] tabular-nums text-foreground/88 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-foreground/25 hover:bg-accent/45"
                title="缩放"
                aria-label={`预览缩放，当前 ${zoomPercent}%`}
              >
                {zoomPercent}%
                <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              {ZOOM_LEVELS.map((level) => (
                <DropdownMenuItem
                  key={level}
                  className="justify-between tabular-nums"
                  onSelect={() => selectZoom(level)}
                >
                  <span>{level}%</span>
                  {matchedLevel === level
                    ? <CheckIcon className="size-3.5 text-foreground" aria-hidden="true" />
                    : <span className="size-3.5" aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="justify-between"
                onSelect={() => selectZoom(-1)}
              >
                <span>适合宽度</span>
                {zoomAuto
                  ? <CheckIcon className="size-3.5 text-foreground" aria-hidden="true" />
                  : <MaximizeGlyph className="size-3.5 text-muted-foreground" aria-hidden="true" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {hasBinary ? (
          <IconButton
            className="size-7 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground [&_svg]:size-3.5"
            title="下载副本"
            aria-label="下载副本"
            onClick={() => void onDownload?.()}
          >
            <DownloadGlyph aria-hidden="true" />
          </IconButton>
        ) : null}
        <IconButton
          className="size-7 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground [&_svg]:size-3.5"
          title={canCollapse ? "收起侧栏" : "关闭预览"}
          aria-label={canCollapse ? "收起侧栏" : "关闭预览"}
          onClick={() => onCollapse?.()}
          disabled={!onCollapse}
        >
          {canCollapse ? <PanelRightGlyph aria-hidden="true" /> : <MaximizeGlyph className="rotate-90" aria-hidden="true" />}
        </IconButton>
      </div>
    </div>
  );
}

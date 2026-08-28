import { ArrowLeft, Check, FolderPlus, Globe, Laptop, X } from "lucide-react";
import { useId, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatShareBytes, type ShareImportProgress } from "@/lib/share";
import { cn } from "@/lib/utils";

export type AddProjectSource = "local" | "remote";
export type AddProjectStep = "type" | "local" | "remote";

type AddProjectDialogProps = {
  open: boolean;
  step: AddProjectStep;
  source: AddProjectSource;
  projectName: string;
  localPath: string;
  /** 远程导入：必选的父目录（最终路径 = 父目录 / 项目名称）。 */
  targetPath: string;
  shareUrl: string;
  busy?: boolean;
  /** 远程导入进度（仅 busy 时展示）。 */
  importProgress?: ShareImportProgress | null;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSourceChange: (source: AddProjectSource) => void;
  onProjectNameChange: (name: string) => void;
  onShareUrlChange: (url: string) => void;
  onBackToType: () => void;
  onContinue: () => void;
  onPickLocalPath: () => void | Promise<void>;
  onPickTargetPath: () => void | Promise<void>;
  onConfirmLocal: () => void | Promise<void>;
  onConfirmRemote: () => void | Promise<void>;
  /** 远程导入中点击取消 / 关闭。 */
  onCancelRemote?: () => void | Promise<void>;
};

function SourceCard({
  selected,
  title,
  description,
  icon,
  onSelect,
}: {
  selected: boolean;
  title: string;
  description: string;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative flex min-h-[128px] flex-col items-start gap-3 rounded-[22px] border px-4 py-4 text-left transition-colors",
        selected
          ? "border-transparent bg-muted/70"
          : "border-border/70 bg-transparent hover:bg-muted/35"
      )}
    >
      <span
        className={cn(
          "absolute right-3.5 top-3.5 flex size-[18px] items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/35"
        )}
        aria-hidden
      >
        {selected ? <Check className="size-2.5 stroke-[3]" /> : null}
      </span>
      <span className="text-muted-foreground">{icon}</span>
      <span className="pr-6 text-[15px] font-semibold tracking-tight text-foreground">{title}</span>
      <span className="text-[12.5px] leading-relaxed text-muted-foreground">{description}</span>
    </button>
  );
}

function NameField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <FolderPlus className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder="项目名称"
        className="h-11 rounded-2xl border-border/70 pl-10 text-[14px] shadow-none"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** 添加项目：类型 → 本地路径 / 远程分享地址。 */
export function AddProjectDialog({
  open,
  step,
  source,
  projectName,
  localPath,
  targetPath,
  shareUrl,
  busy = false,
  importProgress = null,
  error = "",
  onOpenChange,
  onSourceChange,
  onProjectNameChange,
  onShareUrlChange,
  onBackToType,
  onContinue,
  onPickLocalPath,
  onPickTargetPath,
  onConfirmLocal,
  onConfirmRemote,
  onCancelRemote,
}: AddProjectDialogProps) {
  const titleId = useId();
  const showBack = step !== "type";
  const title =
    step === "type" ? "添加项目" : step === "local" ? "创建项目" : "新建远程项目";

  const canConfirmLocal = Boolean(localPath.trim());
  const canConfirmRemote =
    Boolean(shareUrl.trim()) && Boolean(targetPath.trim()) && Boolean(projectName.trim());
  const remoteImporting = busy && step === "remote";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && remoteImporting) {
          void onCancelRemote?.();
          return;
        }
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="w-[min(460px,calc(100vw-32px))] gap-0 rounded-[28px] border-border/50 bg-background p-0 shadow-2xl"
        aria-labelledby={titleId}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          const focusId =
            step === "remote"
              ? shareUrl.trim()
                ? "add-project-remote-name"
                : "add-project-share-url"
              : step === "local"
                ? "add-project-local-name"
                : null;
          if (!focusId) return;
          event.preventDefault();
          const el = document.getElementById(focusId);
          if (el && typeof el.focus === "function") el.focus();
        }}
      >
        <DialogHeader className="relative gap-2 px-6 pb-2 pt-6 pr-14">
          <DialogClose
            className="absolute right-4 top-4 rounded-full border-0 bg-transparent p-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-0 disabled:opacity-40"
            disabled={busy && !remoteImporting}
            aria-label="关闭"
            onClick={(event) => {
              if (!remoteImporting) return;
              event.preventDefault();
              void onCancelRemote?.();
            }}
          >
            <X className="size-4" />
          </DialogClose>
          <div className="flex items-center gap-2">
            {showBack ? (
              <button
                type="button"
                className="rounded-full border-0 bg-transparent p-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-0 disabled:opacity-40"
                disabled={busy}
                onClick={onBackToType}
                aria-label="返回"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : null}
            <DialogTitle id={titleId} className="text-[17px] font-semibold tracking-tight">
              {title}
            </DialogTitle>
          </div>
          {step === "type" ? (
            <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
              选择项目来源，本地目录或分享地址均可。
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              {step === "local" ? "选择本地文件夹并确认项目名称" : "填写项目名称、保存位置与分享地址"}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "type" ? (
          <div className="px-6 pb-5 pt-3">
            <div className="mb-3 text-[12px] font-medium text-muted-foreground">项目类型</div>
            <div className="grid grid-cols-2 gap-3">
              <SourceCard
                selected={source === "local"}
                title="本地"
                description="打开本机已有仓库，编辑与运行"
                icon={<Laptop className="size-5" strokeWidth={1.6} />}
                onSelect={() => onSourceChange("local")}
              />
              <SourceCard
                selected={source === "remote"}
                title="远程"
                description="粘贴分享地址，导入项目快照"
                icon={<Globe className="size-5" strokeWidth={1.6} />}
                onSelect={() => onSourceChange("remote")}
              />
            </div>
          </div>
        ) : null}

        {step === "local" ? (
          <div className="flex flex-col gap-5 px-6 pb-2 pt-4">
            <NameField
              id="add-project-local-name"
              value={projectName}
              disabled={busy}
              onChange={onProjectNameChange}
            />
            <div className="flex flex-col gap-2.5">
              <div className="text-[12px] font-medium text-muted-foreground">源文件夹</div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onPickLocalPath()}
                className={cn(
                  "flex min-h-[132px] w-full flex-col items-center justify-center gap-2.5 rounded-[22px] border border-dashed border-border/80 bg-muted/45 px-4 py-6 text-center transition-colors",
                  "hover:bg-muted/65 disabled:opacity-50"
                )}
              >
                <FolderPlus className="size-6 text-muted-foreground" strokeWidth={1.5} />
                {localPath ? (
                  <span className="max-w-full break-all text-[13px] leading-relaxed text-foreground">
                    {localPath}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">点击选择本地文件夹</span>
                )}
              </button>
            </div>
            {error ? <p className="break-all text-[12px] text-destructive">{error}</p> : null}
          </div>
        ) : null}

        {step === "remote" ? (
          <div className="flex flex-col gap-5 px-6 pb-2 pt-4">
            <NameField
              id="add-project-remote-name"
              value={projectName}
              disabled={busy}
              onChange={onProjectNameChange}
            />
            <div className="flex flex-col gap-2.5">
              <div className="text-[12px] font-medium text-muted-foreground">保存位置</div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onPickTargetPath()}
                className={cn(
                  "flex min-h-[96px] w-full flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-border/80 bg-muted/45 px-4 py-5 text-center transition-colors",
                  "hover:bg-muted/65 disabled:opacity-50"
                )}
              >
                <FolderPlus className="size-5 text-muted-foreground" strokeWidth={1.5} />
                {targetPath ? (
                  <span className="max-w-full break-all text-[13px] leading-relaxed text-foreground">
                    {targetPath}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">点击选择保存目录</span>
                )}
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="text-[12px] font-medium text-muted-foreground">分享地址</div>
              <Input
                id="add-project-share-url"
                value={shareUrl}
                disabled={busy}
                autoFocus={!shareUrl}
                placeholder="https://"
                className="h-11 rounded-2xl border-border/70 text-[14px] shadow-none"
                onChange={(event) => onShareUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canConfirmRemote && !busy) {
                    event.preventDefault();
                    void onConfirmRemote();
                  }
                }}
              />
            </div>
            {error ? <p className="break-all text-[12px] text-destructive">{error}</p> : null}
            {busy ? (
              <div className="flex flex-col gap-2 rounded-[18px] border border-border/50 bg-muted/35 px-3.5 py-3">
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="min-w-0 truncate text-foreground">
                    {importProgress?.message || "正在导入，请稍候…"}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {Math.min(100, Math.max(0, Math.round(importProgress?.percent ?? 0)))}%
                  </span>
                </div>
                <Progress
                  value={Math.min(100, Math.max(0, importProgress?.percent ?? 4))}
                  className="h-1.5 bg-muted"
                />
                {importProgress?.bytesDone != null && importProgress.bytesTotal != null && importProgress.bytesTotal > 0 ? (
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {formatShareBytes(importProgress.bytesDone)} / {formatShareBytes(importProgress.bytesTotal)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-3 border-t border-border/40 px-6 py-4 sm:justify-end">
          {step === "type" ? (
            <Button
              size="default"
              variant="contrast"
              className="min-w-[96px] rounded-2xl px-5"
              disabled={busy}
              onClick={onContinue}
            >
              下一步
            </Button>
          ) : null}

          {step === "local" ? (
            <>
              <Button
                size="default"
                variant="ghost"
                className="rounded-2xl text-muted-foreground"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button
                size="default"
                variant="contrast"
                className="min-w-[96px] rounded-2xl px-5"
                disabled={busy || !canConfirmLocal}
                onClick={() => void onConfirmLocal()}
              >
                {busy ? "创建中…" : "创建项目"}
              </Button>
            </>
          ) : null}

          {step === "remote" ? (
            <>
              <Button
                size="default"
                variant="ghost"
                className="rounded-2xl text-muted-foreground"
                onClick={() => {
                  if (remoteImporting) {
                    void onCancelRemote?.();
                    return;
                  }
                  onOpenChange(false);
                }}
              >
                取消
              </Button>
              <Button
                size="default"
                variant="contrast"
                className="min-w-[96px] rounded-2xl px-5"
                disabled={busy || !canConfirmRemote}
                onClick={() => void onConfirmRemote()}
              >
                {busy ? "导入中…" : "添加项目"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { Check, ChevronsUpDown, GitBranch, LoaderCircle, Plus, Search, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { AppText } from "../../lib/generalSettings";
import type { GitBranchSummary } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export type BranchPickerNavItemProps = {
  text: AppText;
  repoName: string;
  currentBranch: string;
  branches: GitBranchSummary[];
  uncommittedCount: number;
  busy?: boolean;
  onCheckoutBranch: (branchName: string) => void;
  /** 成功返回 null/void，失败返回错误文案（弹窗内联展示）。 */
  onCreateAndCheckout: (branchName: string) => Promise<string | null | void> | string | null | void;
  onRefreshBranches?: () => void;
};

const POPOVER_WIDTH = 292;
const POPOVER_ESTIMATED_HEIGHT = 360;

/**
 * 左侧导航的分支切换入口：不再固定显示「工作树」，
 * 而是跟随当前分支显示名称，点击弹出分支选择浮层（不展开右侧面板）。
 */
export function BranchPickerNavItem(props: BranchPickerNavItemProps) {
  const {
    text,
    repoName,
    currentBranch,
    branches,
    uncommittedCount,
    busy = false,
    onCheckoutBranch,
    onCreateAndCheckout,
    onRefreshBranches,
  } = props;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");

  // 创建并检出新分支弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [nameError, setNameError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const localBranches = useMemo(() => branches.filter((branch) => !branch.isRemote), [branches]);
  const orderedBranches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = keyword
      ? localBranches.filter((branch) => branch.name.toLowerCase().includes(keyword))
      : localBranches;
    const current = filtered.filter((branch) => branch.name === currentBranch);
    const rest = filtered.filter((branch) => branch.name !== currentBranch);
    return [...current, ...rest];
  }, [localBranches, query, currentBranch]);

  const trimmedQuery = query.trim();
  const exactMatch = trimmedQuery
    ? localBranches.some((branch) => branch.name === trimmedQuery)
    : false;
  const canCreateFromQuery = Boolean(trimmedQuery) && !exactMatch;

  const closePopover = () => {
    setOpen(false);
    setQuery("");
  };

  const openPopover = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        x: Math.min(rect.right + 8, window.innerWidth - POPOVER_WIDTH - 8),
        y: Math.min(Math.max(rect.top - 8, 8), Math.max(window.innerHeight - POPOVER_ESTIMATED_HEIGHT - 8, 8)),
      });
    }
    setQuery("");
    setOpen(true);
    onRefreshBranches?.();
  };

  // 浮层打开后聚焦搜索框；点击浮层外部或按 Escape 关闭。
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closePopover();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePopover();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const handleSelectBranch = (name: string) => {
    if (busy) return;
    closePopover();
    if (name !== currentBranch) onCheckoutBranch(name);
  };

  /** 打开「创建并检出新分支」弹窗：搜索词可直接带入。 */
  const openCreateDialog = () => {
    closePopover();
    setBranchName(canCreateFromQuery ? trimmedQuery : "");
    setNameError("");
    setSubmitting(false);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const name = branchName.trim();
    if (!name) {
      setNameError(text.branchCreateEmptyName);
      return;
    }
    setSubmitting(true);
    setNameError("");
    try {
      const error = await onCreateAndCheckout(name);
      if (error) {
        setNameError(String(error));
        return;
      }
      setCreateOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const displayBranch = currentBranch || text.worktree;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        ref={triggerRef}
        size="default"
        isActive={open}
        disabled={busy && !open}
        className="group/branch-picker h-8 text-sm transition-[background-color,color,box-shadow] hover:bg-[color-mix(in_srgb,#8f8270_10%,transparent)] active:bg-[color-mix(in_srgb,#8f8270_14%,transparent)] data-[active=true]:!bg-[color-mix(in_srgb,#8f8270_18%,var(--bg)_82%)] data-[active=true]:!text-sidebar-foreground data-[active=true]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,#8f8270_16%,transparent)] data-[active=true]:hover:!bg-[color-mix(in_srgb,#8f8270_21%,var(--bg)_79%)]"
        title={displayBranch}
        aria-label={displayBranch}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closePopover() : openPopover())}
      >
        <GitBranch />
        <span className="truncate">{displayBranch}</span>
        <ChevronsUpDown
          className={cn("!ml-auto size-3 shrink-0 text-muted-foreground transition-opacity", open ? "opacity-70" : "opacity-0 group-hover/branch-picker:opacity-70")}
          aria-hidden="true"
        />
      </SidebarMenuButton>

      {open
        ? createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={displayBranch}
            className="fixed z-[3000] w-[292px] overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-[0_12px_40px_-10px_rgba(0,0,0,0.28)] animate-in fade-in-0 zoom-in-95 slide-in-from-left-1 duration-150"
            style={{ left: position.x, top: position.y }}
          >
            {/* 搜索 */}
            <div className="flex h-10 items-center gap-2 px-3">
              <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (orderedBranches.length > 0) {
                      handleSelectBranch(orderedBranches[0].name);
                    } else {
                      openCreateDialog();
                    }
                  }
                }}
                placeholder={text.branchPickerSearchPlaceholder.replace("{repo}", repoName || "repo")}
                className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm outline-none ring-0 placeholder:text-muted-foreground/70 focus:outline-none"
              />
            </div>
            <div className="border-t border-border/60" />

            {/* 分支列表 */}
            <div className="px-3 pb-1 pt-2 text-xs text-muted-foreground">{text.branchPickerBranches}</div>
            <div className="max-h-[264px] overflow-y-auto px-1.5 pb-1.5">
              {orderedBranches.length > 0 ? (
                orderedBranches.map((branch) => {
                  const isCurrent = branch.name === currentBranch;
                  return (
                    <button
                      key={branch.name}
                      type="button"
                      disabled={busy}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] disabled:pointer-events-none disabled:opacity-50",
                        isCurrent && "hover:bg-transparent"
                      )}
                      onClick={() => handleSelectBranch(branch.name)}
                    >
                      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm leading-tight">{branch.name}</span>
                        {isCurrent && uncommittedCount > 0 ? (
                          <span className="block truncate text-xs leading-tight text-muted-foreground">
                            {text.branchPickerUncommitted.replace("{count}", String(uncommittedCount))}
                          </span>
                        ) : null}
                      </span>
                      {isCurrent ? (
                        <Check className="size-4 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <p className="px-2 py-2 text-xs text-muted-foreground">{text.branchPickerNoMatch}</p>
              )}
            </div>

            {/* 创建并检出新分支 */}
            <div className="border-t border-border/60" />
            <button
              type="button"
              disabled={busy}
              className="flex h-10 w-full min-w-0 items-center gap-2 border-0 bg-transparent px-3 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              onClick={openCreateDialog}
            >
              <Plus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{text.branchPickerCreate}</span>
            </button>
          </div>,
          document.body
        )
        : null}

      {/* 创建并检出新分支弹窗 */}
      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (submitting) return;
          setCreateOpen(next);
        }}
      >
        <DialogContent className="w-[min(400px,calc(100vw-32px))] gap-0 p-5">
          <DialogClose
            className="absolute right-4 top-4 flex size-6 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
            title={text.close}
            aria-label={text.close}
          >
            <XIcon className="size-4" strokeWidth={1.75} aria-hidden="true" />
          </DialogClose>
          <DialogTitle className="text-base">{text.branchCreateTitle}</DialogTitle>

          <div className="mt-4 flex h-6 items-center">
            <span className="text-sm text-foreground">{text.branchCreateNameLabel}</span>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <Input
              value={branchName}
              autoFocus
              disabled={submitting}
              onChange={(event) => {
                setBranchName(event.target.value);
                if (nameError) setNameError("");
              }}
              className="mt-2"
              aria-label={text.branchCreateNameLabel}
              aria-invalid={Boolean(nameError)}
            />
            {nameError ? <p className="mt-1.5 text-xs text-destructive">{nameError}</p> : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={submitting}>
                {text.close}
              </Button>
              <Button type="submit" variant="contrast" disabled={submitting || busy}>
                {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                {text.branchCreateSubmit}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
}

"use client";

// Migrated from AI SDK Elements (Dialog + Command) to the shadcn/ui
// Dropdown Menu composition, per
// https://ui.shadcn.com/docs/ai-elements/aria/model-selector
// Every export keeps its name; aria-rhea's selectionMode/selectedKeys are
// Radix-adapted (open/onOpenChange on the root, selection indicated by the
// caller). Search lives in a plain menu-embedded Input — aria menus have
// none, so filtering stays the caller's job.

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type ModelSelectorProps = ComponentProps<typeof DropdownMenu>;

export const ModelSelector = (props: ModelSelectorProps) => (
  <DropdownMenu {...props} />
);

export type ModelSelectorTriggerProps = ComponentProps<
  typeof DropdownMenuTrigger
>;

export const ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => (
  <DropdownMenuTrigger {...props} />
);

export type ModelSelectorContentProps = ComponentProps<
  typeof DropdownMenuContent
> & {
  title?: ReactNode;
};

export const ModelSelectorContent = ({
  className,
  title = "Model Selector",
  ...props
}: ModelSelectorContentProps) => (
  <DropdownMenuContent
    aria-label={typeof title === "string" ? title : undefined}
    className={cn("w-64 p-1", className)}
    {...props}
  />
);

export type ModelSelectorListProps = ComponentProps<"div">;

export const ModelSelectorList = ({
  className,
  ...props
}: ModelSelectorListProps) => (
  <div
    className={cn("max-h-72 overflow-y-auto overscroll-contain", className)}
    {...props}
  />
);

export type ModelSelectorGroupProps = ComponentProps<
  typeof DropdownMenuGroup
> & {
  heading?: ReactNode;
};

export const ModelSelectorGroup = ({
  heading,
  children,
  ...props
}: ModelSelectorGroupProps) => (
  <DropdownMenuGroup {...props}>
    {heading ? <DropdownMenuLabel>{heading}</DropdownMenuLabel> : null}
    {children}
  </DropdownMenuGroup>
);

export type ModelSelectorItemProps = ComponentProps<typeof DropdownMenuItem>;

export const ModelSelectorItem = ({
  className,
  ...props
}: ModelSelectorItemProps) => (
  <DropdownMenuItem className={cn("gap-2", className)} {...props} />
);

export type ModelSelectorSeparatorProps = ComponentProps<
  typeof DropdownMenuSeparator
>;

export const ModelSelectorSeparator = (
  props: ModelSelectorSeparatorProps
) => <DropdownMenuSeparator {...props} />;

export type ModelSelectorShortcutProps = ComponentProps<"span">;

export const ModelSelectorShortcut = ({
  className,
  ...props
}: ModelSelectorShortcutProps) => (
  <span
    className={cn(
      "ml-auto text-muted-foreground text-xs tracking-widest",
      className
    )}
    {...props}
  />
);

// Search inside the menu. Official menus have no search field — kept for
// callers that filter their groups externally; keydown is stopped so menu
// typeahead and shortcuts don't fight the input.
export type ModelSelectorInputProps = ComponentProps<typeof Input>;

export const ModelSelectorInput = ({
  className,
  ...props
}: ModelSelectorInputProps) => (
  <div className="p-1" onKeyDown={(event) => event.stopPropagation()}>
    <Input autoFocus className={cn("h-8 text-[13px]", className)} {...props} />
  </div>
);

export type ModelSelectorEmptyProps = ComponentProps<"div"> & {
  /** Render nothing while any group still has visible items. */
  visible?: boolean;
};

export const ModelSelectorEmpty = ({
  visible = true,
  className,
  ...props
}: ModelSelectorEmptyProps) =>
  visible ? (
    <div
      className={cn(
        "px-2 py-3 text-center text-muted-foreground text-sm",
        className
      )}
      {...props}
    />
  ) : null;

export type ModelSelectorLogoProps = Omit<
  ComponentProps<"img">,
  "src" | "alt"
> & {
  provider: string;
};

export const ModelSelectorLogo = ({
  provider,
  className,
  ...props
}: ModelSelectorLogoProps) => (
  <img
    {...props}
    alt={`${provider} logo`}
    className={cn("size-3 dark:invert", className)}
    height={12}
    src={`https://models.dev/logos/${provider}.svg`}
    width={12}
  />
);

export type ModelSelectorLogoGroupProps = ComponentProps<"div">;

export const ModelSelectorLogoGroup = ({
  className,
  ...props
}: ModelSelectorLogoGroupProps) => (
  <div
    className={cn(
      "flex shrink-0 items-center -space-x-1 [&>img]:rounded-full [&>img]:bg-background [&>img]:p-px [&>img]:ring-1 dark:[&>img]:bg-foreground",
      className
    )}
    {...props}
  />
);

export type ModelSelectorNameProps = ComponentProps<"span">;

export const ModelSelectorName = ({
  className,
  ...props
}: ModelSelectorNameProps) => (
  <span className={cn("flex-1 truncate text-left", className)} {...props} />
);

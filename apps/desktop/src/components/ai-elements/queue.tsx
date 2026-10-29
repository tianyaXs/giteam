"use client";

// Migrated from AI SDK Elements to the shadcn/ui Trace composition, per
// https://ui.shadcn.com/docs/ai-elements/aria/queue
// Every export keeps its name and props; only the rendering changed.
// Sections/labels/items are now Trace pieces; attachments and actions kept.

import { Button } from "@/components/ui/button";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";
import { CircleCheckIcon, CircleIcon, ListChecksIcon, ListTodoIcon, PaperclipIcon } from "lucide-react";
import type { ComponentProps } from "react";

export interface QueueMessagePart {
  type: string;
  text?: string;
  url?: string;
  filename?: string;
  mediaType?: string;
}

export interface QueueMessage {
  id: string;
  parts: QueueMessagePart[];
}

export interface QueueTodo {
  id: string;
  title: string;
  description?: string;
  status?: "pending" | "completed";
}

export type QueueItemProps = ComponentProps<typeof TraceLine>;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <TraceLine
    className={cn("rounded-md px-3 py-1 transition-colors hover:bg-muted", className)}
    {...props}
  />
);

export type QueueItemIndicatorProps = ComponentProps<typeof TraceIcon> & {
  completed?: boolean;
};

export const QueueItemIndicator = ({
  completed = false,
  className,
  ...props
}: QueueItemIndicatorProps) => (
  <TraceIcon className={className} {...props}>
    {completed ? <CircleCheckIcon /> : <CircleIcon />}
  </TraceIcon>
);

export type QueueItemContentProps = ComponentProps<typeof TraceTitle> & {
  completed?: boolean;
};

export const QueueItemContent = ({
  completed = false,
  className,
  ...props
}: QueueItemContentProps) => (
  <TraceTitle
    className={cn(
      "line-clamp-1 grow break-words",
      completed
        ? "text-muted-foreground/50 line-through"
        : "text-muted-foreground",
      className
    )}
    {...props}
  />
);

export type QueueItemDescriptionProps = ComponentProps<
  typeof TraceDescription
> & {
  completed?: boolean;
};

export const QueueItemDescription = ({
  completed = false,
  className,
  ...props
}: QueueItemDescriptionProps) => (
  <TraceDescription
    className={cn(
      completed ? "text-muted-foreground/50 line-through" : "",
      className
    )}
    {...props}
  />
);

export type QueueItemActionsProps = ComponentProps<"div">;

export const QueueItemActions = ({
  className,
  ...props
}: QueueItemActionsProps) => (
  <div className={cn("flex gap-1", className)} {...props} />
);

export type QueueItemActionProps = Omit<
  ComponentProps<typeof Button>,
  "variant" | "size"
>;

export const QueueItemAction = ({
  className,
  ...props
}: QueueItemActionProps) => (
  <Button
    className={cn(
      "size-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground group-hover:opacity-100",
      className
    )}
    size="icon"
    type="button"
    variant="ghost"
    {...props}
  />
);

export type QueueItemAttachmentProps = ComponentProps<"div">;

export const QueueItemAttachment = ({
  className,
  ...props
}: QueueItemAttachmentProps) => (
  <div className={cn("mt-1 flex flex-wrap gap-2", className)} {...props} />
);

export type QueueItemImageProps = ComponentProps<"img">;

export const QueueItemImage = ({
  className,
  ...props
}: QueueItemImageProps) => (
  <img
    alt=""
    className={cn("h-8 w-8 rounded border object-cover", className)}
    height={32}
    width={32}
    {...props}
  />
);

export type QueueItemFileProps = ComponentProps<"span">;

export const QueueItemFile = ({
  children,
  className,
  ...props
}: QueueItemFileProps) => (
  <span
    className={cn(
      "flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs",
      className
    )}
    {...props}
  >
    <PaperclipIcon size={12} />
    <span className="max-w-[100px] truncate">{children}</span>
  </span>
);

export type QueueListProps = ComponentProps<typeof Trace>;

export const QueueList = ({ children, className, ...props }: QueueListProps) => (
  <Trace className={cn("mt-2 -mb-1", className)} {...props}>
    {children}
  </Trace>
);

export type QueueSectionProps = ComponentProps<typeof TraceCollapsible>;

export const QueueSection = (props: QueueSectionProps) => (
  <TraceCollapsible {...props} />
);

export type QueueSectionTriggerProps = ComponentProps<
  typeof TraceCollapsibleTrigger
>;

export const QueueSectionTrigger = (
  props: QueueSectionTriggerProps
) => <TraceCollapsibleTrigger {...props} />;

export type QueueSectionLabelProps = ComponentProps<typeof TraceLine> & {
  count?: number;
  label: string;
  icon?: React.ReactNode;
  completed?: boolean;
};

export const QueueSectionLabel = ({
  count,
  label,
  icon,
  completed = false,
  ...props
}: QueueSectionLabelProps) => (
  <TraceLine {...props}>
    <TraceIcon>
      {icon ?? (completed ? <ListChecksIcon /> : <ListTodoIcon />)}
    </TraceIcon>
    <TraceTitle>
      {typeof count === "number" ? `${count} ` : ""}
      {label}
    </TraceTitle>
  </TraceLine>
);

export type QueueSectionContentProps = ComponentProps<
  typeof TraceCollapsibleContent
>;

export const QueueSectionContent = (props: QueueSectionContentProps) => (
  <TraceCollapsibleContent {...props} />
);

export type QueueProps = ComponentProps<typeof Trace>;

export const Queue = ({ className, ...props }: QueueProps) => (
  <Trace className={cn(className)} {...props} />
);

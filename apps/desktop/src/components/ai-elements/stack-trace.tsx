"use client";

// Built on the shadcn/ui ai-elements "stack-trace" aria pattern
// (https://ui.shadcn.com/docs/ai-elements/aria/stack-trace): a failed tool
// call as an error TraceLine that opens into its stack frames.

import { CircleXIcon } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type StackTraceProps = ComponentProps<typeof Trace>;

export const StackTrace = ({ className, ...props }: StackTraceProps) => (
  <Trace className={cn("text-sm", className)} {...props} />
);

export type StackTraceHeaderProps = ComponentProps<
  typeof TraceCollapsibleTrigger
>;

export const StackTraceHeader = ({
  className,
  ...props
}: StackTraceHeaderProps) => (
  <TraceCollapsibleTrigger
    className={cn("min-w-0 max-w-full", className)}
    {...props}
  />
);

export type StackTraceErrorProps = ComponentProps<typeof TraceTitle>;

export const StackTraceError = ({
  className,
  ...props
}: StackTraceErrorProps) => (
  <TraceLine status="error">
    <TraceIcon>
      <CircleXIcon />
    </TraceIcon>
    <TraceTitle className={cn("truncate", className)} {...props} />
  </TraceLine>
);

// Kept as spans inside StackTraceError (official composition).
export type StackTraceErrorTypeProps = ComponentProps<"span">;

export const StackTraceErrorType = ({
  className,
  ...props
}: StackTraceErrorTypeProps) => (
  <span className={cn("font-medium", className)} {...props} />
);

export type StackTraceErrorMessageProps = ComponentProps<"span">;

export const StackTraceErrorMessage = ({
  className,
  ...props
}: StackTraceErrorMessageProps) => <span className={className} {...props} />;

export type StackTraceContentProps = ComponentProps<
  typeof TraceCollapsibleContent
>;

export const StackTraceContent = (props: StackTraceContentProps) => (
  <TraceCollapsibleContent {...props} />
);

export type StackTraceFramesProps = ComponentProps<"ol">;

export const StackTraceFrames = ({
  className,
  ...props
}: StackTraceFramesProps) => (
  <div className="flex flex-col gap-2 rounded-md bg-muted p-3 font-mono text-xs">
    <ol className={cn("flex flex-col gap-1", className)} {...props} />
  </div>
);

export type StackTraceFrameProps = ComponentProps<"li"> & {
  filePath?: string;
  /** Dim frames that come from dependencies. */
  dimmed?: boolean;
};

export const StackTraceFrame = ({
  filePath,
  dimmed,
  className,
  children,
  ...props
}: StackTraceFrameProps) => (
  <li
    className={cn(
      dimmed ? "text-muted-foreground/60" : "text-foreground",
      className
    )}
    {...props}
  >
    {filePath ? (
      <button
        type="button"
        className="text-left underline decoration-dotted hover:text-primary"
        data-file-path={filePath}
      >
        {children}
      </button>
    ) : (
      children
    )}
  </li>
);

// The whole header line opens the frames — no separate expand button.
export function StackTraceExpandButton(): null {
  return null;
}

export type StackTraceActionsProps = ComponentProps<"div">;

// Renders NEXT to the header trigger (buttons can't sit inside it).
export const StackTraceActions = ({
  className,
  ...props
}: StackTraceActionsProps) => (
  <div className={cn("ml-auto flex shrink-0 gap-1", className)} {...props} />
);

export type StackTraceCopyButtonProps = ComponentProps<"button">;

export const StackTraceCopyButton = ({
  className,
  ...props
}: StackTraceCopyButtonProps) => (
  <button
    type="button"
    className={cn(
      "rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
      className
    )}
    {...props}
  />
);

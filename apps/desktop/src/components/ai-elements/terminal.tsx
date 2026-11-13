"use client";

// Migrated from AI SDK Elements to the shadcn/ui Trace + Code Block
// composition, per https://ui.shadcn.com/docs/ai-elements/aria/terminal
// Every export keeps its name and props; only the rendering changed.
// ansi-to-react is gone — output renders as a plain mono block.

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LoaderCircleIcon, TerminalIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

interface TerminalContextType {
  autoScroll: boolean;
  isStreaming: boolean;
  onClear?: () => void;
  output: string;
}

const TerminalContext = createContext<TerminalContextType>({
  autoScroll: true,
  isStreaming: false,
  output: "",
});

const useTerminal = () => useContext(TerminalContext);

export type TerminalHeaderProps = ComponentProps<typeof TraceCollapsibleTrigger>;

export const TerminalHeader = ({
  className,
  ...props
}: TerminalHeaderProps) => (
  <TraceCollapsibleTrigger className={cn("min-w-0 max-w-full", className)} {...props} />
);

export type TerminalTitleProps = ComponentProps<"div">;

export const TerminalTitle = ({ className, ...props }: TerminalTitleProps) => (
  <div className={cn("flex min-w-0 items-center gap-2", className)} {...props} />
);

export type TerminalStatusProps = HTMLAttributes<HTMLDivElement>;

export const TerminalStatus = ({
  className,
  ...props
}: TerminalStatusProps) => {
  const { isStreaming } = useTerminal();
  if (!isStreaming) return null;
  return (
    <div
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    >
      <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" />
      <span className="text-muted-foreground text-xs">Running</span>
    </div>
  );
};

export type TerminalActionsProps = HTMLAttributes<HTMLDivElement>;

export const TerminalActions = ({
  className,
  ...props
}: TerminalActionsProps) => (
  <div
    className={cn("ml-auto flex shrink-0 items-center gap-1", className)}
    {...props}
  />
);

export type TerminalCopyButtonProps = ComponentProps<typeof Button>;

export const TerminalCopyButton = ({
  className,
  ...props
}: TerminalCopyButtonProps) => {
  const { output } = useTerminal();
  return (
    <Button
      className={cn("size-6 text-muted-foreground", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(output);
      }}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    />
  );
};

export type TerminalClearButtonProps = ComponentProps<typeof Button>;

export const TerminalClearButton = ({
  className,
  ...props
}: TerminalClearButtonProps) => {
  const { onClear } = useTerminal();
  if (!onClear) return null;
  return (
    <Button
      className={cn("size-6 text-muted-foreground", className)}
      onClick={onClear}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    />
  );
};

export type TerminalContentProps = ComponentProps<"pre">;

export const TerminalContent = ({
  className,
  children: _children,
  ...props
}: TerminalContentProps) => {
  const { autoScroll, output } = useTerminal();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [autoScroll, output]);

  // Official uses CodeBlock size=sm; our vendored CodeBlock is a shiki
  // highlighter (code+language) — wrong tool for arbitrary terminal text.
  // A styled pre keeps the official visual (mono, wrap, capped height).
  return (
    <div className="min-w-0 px-1 pb-1">
      <pre
        className={cn(
          "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs leading-relaxed",
          className
        )}
        {...props}
      >
        {output}
        <div ref={bottomRef} />
      </pre>
    </div>
  );
};

export type TerminalProps = ComponentProps<typeof Trace> & {
  output: string;
  isStreaming?: boolean;
  autoScroll?: boolean;
  onClear?: () => void;
};

export const Terminal = ({
  output,
  isStreaming = false,
  autoScroll = true,
  onClear,
  className,
  children,
  ...props
}: TerminalProps) => {
  const contextValue = useMemo(
    () => ({ autoScroll, isStreaming, onClear, output }),
    [autoScroll, isStreaming, onClear, output]
  );

  return (
    <TerminalContext.Provider value={contextValue}>
      <Trace className={cn("overflow-hidden rounded-lg border bg-zinc-950 text-zinc-100", className)} {...props}>
        {children ?? (
          <TraceCollapsible defaultOpen>
            <div className="flex w-full items-center gap-2 px-2 py-1.5">
              <TerminalHeader>
                <TerminalTitle>
                  <TraceIcon>
                    <TerminalIcon />
                  </TraceIcon>
                </TerminalTitle>
                <TerminalStatus />
                <TerminalActions>
                  <TerminalCopyButton aria-label="复制输出" />
                  <TerminalClearButton aria-label="清空输出" />
                </TerminalActions>
              </TerminalHeader>
            </div>
            <TerminalContent />
          </TraceCollapsible>
        )}
      </Trace>
    </TerminalContext.Provider>
  );
};

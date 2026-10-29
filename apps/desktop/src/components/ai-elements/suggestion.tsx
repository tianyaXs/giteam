"use client";

// Migrated to the shadcn/ui aria "suggestion" shape: a plain scrolling div
// row (no ScrollArea) of outline/sm Buttons. The label is the prompt.
// https://ui.shadcn.com/docs/ai-elements/aria/suggestion

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type SuggestionsProps = ComponentProps<"div">;

export const Suggestions = ({
  className,
  children,
  ...props
}: SuggestionsProps) => (
  <div
    className={cn(
      "scrollbar-none scroll-fade-x flex gap-2 overflow-x-auto overscroll-x-contain",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type SuggestionProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  children,
  ...props
}: SuggestionProps) => (
  <Button
    className={cn("shrink-0", className)}
    onClick={() => onClick?.(suggestion)}
    size="sm"
    type="button"
    variant="outline"
    {...props}
  >
    {children || suggestion}
  </Button>
);

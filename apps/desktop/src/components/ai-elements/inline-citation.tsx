"use client";

// Built on the shadcn/ui ai-elements "inline-citation" aria pattern
// (https://ui.shadcn.com/docs/ai-elements/aria/inline-citation).
// Base UI composes the HoverCard inside the Trigger; ours stays Radix
// (Root > Trigger asChild > Content) with the same exports.

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({
  className,
  ...props
}: InlineCitationProps) => (
  <span
    className={cn("group/inline-citation inline items-center", className)}
    {...props}
  />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({
  className,
  ...props
}: InlineCitationTextProps) => (
  <span
    className={cn(
      "transition-colors group-hover/inline-citation:bg-accent",
      className
    )}
    {...props}
  />
);

// HoverCard root renders no DOM element (no className) — omit it.
export type InlineCitationCardProps = Omit<
  ComponentProps<typeof HoverCard>,
  "className"
>;

export const InlineCitationCard = (props: InlineCitationCardProps) => (
  <HoverCard closeDelay={0} openDelay={0} {...props} />
);

export type InlineCitationCardTriggerProps = ComponentProps<typeof Button> & {
  sources: { url: string }[];
};

export const InlineCitationCardTrigger = ({
  sources,
  className,
  children,
  ...props
}: InlineCitationCardTriggerProps) => (
  <HoverCardTrigger asChild>
    <Button type="button" variant="secondary" size="xs" className={cn("size-6 p-0", className)} {...props}>
      {children ?? sources.length}
    </Button>
  </HoverCardTrigger>
);

export type InlineCitationCardBodyProps = ComponentProps<"div">;

export const InlineCitationCardBody = ({
  className,
  ...props
}: InlineCitationCardBodyProps) => (
  <HoverCardContent
    className={cn("flex w-64 flex-col gap-1", className)}
    {...props}
  />
);

export type InlineCitationSourceProps = ComponentProps<"a"> & {
  source: { href?: string; title?: string };
};

export const InlineCitationSource = ({
  source,
  className,
  children,
  ...props
}: InlineCitationSourceProps) => {
  let hostname = "";
  try {
    hostname = source.href ? new URL(source.href).hostname : "";
  } catch {
    hostname = source.href ?? "";
  }
  return (
    <a
      className={cn("text-sm font-medium hover:underline", className)}
      href={source.href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {source.title ?? hostname}
      <span className="sr-only">（在新标签页打开）</span>
      {children}
    </a>
  );
};

export type InlineCitationQuoteProps = ComponentProps<"blockquote">;

export const InlineCitationQuote = ({
  className,
  ...props
}: InlineCitationQuoteProps) => (
  <blockquote
    className={cn(
      "border-l-2 border-border pl-3 text-muted-foreground text-xs leading-relaxed",
      className
    )}
    {...props}
  />
);

export type InlineCitationQuoteSourceProps = ComponentProps<"span">;

export const InlineCitationQuoteSource = ({
  className,
  ...props
}: InlineCitationQuoteSourceProps) => (
  <span
    className={cn("block text-[11px] text-muted-foreground/70", className)}
    {...props}
  />
);

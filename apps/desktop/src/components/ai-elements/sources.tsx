"use client";

// Built on the shadcn/ui ai-elements "sources" aria pattern
// (https://ui.shadcn.com/docs/ai-elements/aria/sources): a Trace line
// that says how many links were used and opens into one link per source.

import { ArrowUpRightIcon, GlobeIcon } from "lucide-react";
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

export type SourcesProps = ComponentProps<typeof Trace>;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Trace className={cn("text-sm", className)} {...props} />
);

export type SourcesTriggerProps = ComponentProps<
  typeof TraceCollapsibleTrigger
> & {
  count: number;
};

export const SourcesTrigger = ({
  count,
  className,
  ...props
}: SourcesTriggerProps) => (
  <TraceCollapsibleTrigger className={cn(className)} {...props}>
    <TraceLine>
      <TraceIcon>
        <GlobeIcon />
      </TraceIcon>
      <TraceTitle>Used {count} sources</TraceTitle>
    </TraceLine>
  </TraceCollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<
  typeof TraceCollapsibleContent
>;

export const SourcesContent = ({
  className,
  children,
  ...props
}: SourcesContentProps) => (
  <TraceCollapsibleContent className={className} {...props}>
    <Trace>{children}</Trace>
  </TraceCollapsibleContent>
);

export type SourceProps = ComponentProps<"a"> & {
  href: string;
  title?: string;
};

export const Source = ({
  href,
  title,
  className,
  children,
  ...props
}: SourceProps) => {
  let hostname = "";
  try {
    hostname = new URL(href).hostname;
  } catch {
    hostname = href;
  }
  return (
    <a
      className={cn("block", className)}
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      <TraceLine>
        <TraceIcon>
          <GlobeIcon />
        </TraceIcon>
        <TraceTitle>
          {title ?? hostname}
          <span className="sr-only"> (opens in a new tab)</span>
        </TraceTitle>
        <TraceIcon>
          <ArrowUpRightIcon />
        </TraceIcon>
      </TraceLine>
    </a>
  );
};

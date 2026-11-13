"use client";

// Rebuilt on the shadcn/ui Trace per
// https://ui.shadcn.com/docs/ai-elements/aria/plan
// (AI SDK Elements Plan was a Card; every export keeps its name/props).

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
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext } from "react";

interface PlanContextValue {
  isStreaming: boolean;
}

const PlanContext = createContext<PlanContextValue | null>(null);

const usePlan = () => {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("Plan components must be used within Plan");
  }
  return context;
};

export type PlanProps = ComponentProps<"div"> & {
  isStreaming?: boolean;
};

export function Plan({
  isStreaming = false,
  className,
  children,
  ...props
}: PlanProps) {
  return (
    <PlanContext.Provider value={{ isStreaming }}>
      <Trace className={cn("text-sm", className)} {...props}>
        {children}
      </Trace>
    </PlanContext.Provider>
  );
}

export type PlanHeaderProps = ComponentProps<typeof TraceCollapsible>;

export function PlanHeader({ className, ...props }: PlanHeaderProps) {
  return <TraceCollapsible className={className} {...props} />;
}

export type PlanTitleProps = ComponentProps<"span">;

export function PlanTitle({ className, ...props }: PlanTitleProps) {
  return <TraceTitle className={className} {...props} />;
}

export type PlanDescriptionProps = ComponentProps<"span">;

export function PlanDescription({
  className,
  ...props
}: PlanDescriptionProps) {
  return <TraceDescription className={className} {...props} />;
}

export type PlanContentProps = ComponentProps<"div">;

export function PlanContent({ className, children, ...props }: PlanContentProps) {
  return (
    <TraceCollapsibleContent className={className} {...props}>
      <Trace>{children}</Trace>
    </TraceCollapsibleContent>
  );
}

export type PlanTriggerProps = {
  children?: ReactNode;
};

// The whole header line opens the plan; a trigger renders only its children.
export function PlanTrigger({ children }: PlanTriggerProps) {
  const { isStreaming } = usePlan();
  return (
    <TraceLine status={isStreaming ? "running" : undefined}>
      {children}
    </TraceLine>
  );
}

export type PlanActionProps = ComponentProps<"div">;

// Buttons cannot sit inside a collapsible trigger — render actions next to
// the header line, not inside it.
export function PlanAction({ className, ...props }: PlanActionProps) {
  return <div className={cn("shrink-0", className)} {...props} />;
}

export type PlanFooterProps = ComponentProps<"div">;

export function PlanFooter({ className, ...props }: PlanFooterProps) {
  return <div className={cn("mt-1", className)} {...props} />;
}

// Convenience header line pieces (icon + title live inside PlanTrigger).
export { TraceCollapsibleTrigger as PlanHeaderTrigger, TraceIcon as PlanIcon };

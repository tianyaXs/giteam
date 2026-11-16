import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shimmer text — React wrapper around the transitions.dev "shimmer-text"
 * snippet (https://transitions.dev/transitions/shimmer-text).
 * The base text renders in --shimmer-base; a ::before copy of the same
 * string (data-text) sweeps a highlight band across the glyphs.
 *
 * Requires a plain-text string child so data-text can mirror it.
 */
export function ShimmerText({
  text,
  className
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={cn("t-shimmer whitespace-nowrap", className)} data-text={text}>
      {text}
    </span>
  );
}

/** Convenience for call sites that already compose children. */
export function ShimmerSpan({
  children,
  text,
  className
}: {
  children: ReactNode;
  text: string;
  className?: string;
}) {
  return (
    <span className={cn("t-shimmer", className)} data-text={text}>
      {children}
    </span>
  );
}

import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Matrix dot loader — React port of the transitions.dev "matrix-loader"
 * snippet (https://transitions.dev/transitions/matrix-dot-loader).
 * A 4×4 matrix of 2px dots; each variant is just a per-dot delay table
 * over one shared colour-pulse cycle.
 */

const CORNERS = [0, 3, 12, 15];
/** Clockwise perimeter (corner-less ring), then centre cells. */
const RING = [1, 2, 7, 11, 14, 13, 8, 4];
const INNER = [5, 6, 9, 10];
const TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

export type MatrixLoaderVariant = "scan" | "twinkle" | "orbit" | "pulse";

const CYCLE_MS = 1200;

function dotDelay(index: number, variant: MatrixLoaderVariant): number | null {
  if (variant === "scan") return Math.round((index % 4) * (CYCLE_MS / 10));
  if (variant === "twinkle") return Math.round(TWINKLE[index] * (CYCLE_MS / 16));
  if (variant === "orbit") {
    const k = RING.indexOf(index);
    // Centre cells hold steady under the ring (no pulse).
    return k === -1 ? null : Math.round(k * (CYCLE_MS / 8));
  }
  // pulse: inner cells first, the rest a beat behind.
  return Math.round((INNER.includes(index) ? 0 : 1) * CYCLE_MS * 0.16);
}

export function MatrixLoader({
  variant = "twinkle",
  rounded = false,
  className
}: {
  variant?: MatrixLoaderVariant;
  rounded?: boolean;
  className?: string;
}) {
  const dots = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => ({
        index,
        isGap: rounded && CORNERS.includes(index),
        delay: dotDelay(index, variant)
      })),
    [variant, rounded]
  );

  return (
    <span
      className={cn("t-matrix", className)}
      role="status"
      aria-label="加载中"
    >
      {dots.map(({ index, isGap, delay }) => (
        <i
          key={index}
          className={cn(isGap && "is-gap")}
          style={
            isGap || delay === null
              ? { animation: "none" }
              : { "--d": String(delay) } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

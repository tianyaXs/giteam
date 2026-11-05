import { useEffect, useLayoutEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Thinking states — React port of the transitions.dev "thinking-states"
 * snippet (https://transitions.dev/transitions/thinking-states).
 * An AI status line that narrates what the agent is doing: the line
 * shimmers while a state holds, then swaps to the next state (the old
 * line exits up through a small blur while the new one rises in).
 */

function cssMs(name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

export function ThinkingStates({
  states,
  className
}: {
  /** Narration lines to cycle through; needs ≥ 2 to animate. */
  states: string[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [exiting, setExiting] = useState<{ key: number; text: string } | null>(null);
  const [entered, setEntered] = useState(true);

  const cycleKey = states.join("\n");
  const longest = states.reduce((a, b) => (b.length > a.length ? b : a), "");

  useEffect(() => {
    // Reset the cycle when the narration content changes.
    setIndex(0);
    setExiting(null);
    setEntered(true);
  }, [cycleKey]);

  useEffect(() => {
    if (states.length <= 1) return;
    const hold = cssMs("--think-hold", 2000);
    const swap = cssMs("--think-swap", 150);
    const gap = cssMs("--think-gap", 50);
    let cancelled = false;
    let leaveTimer: number | undefined;
    let removeTimer: number | undefined;

    const step = (current: number) => {
      leaveTimer = window.setTimeout(() => {
        if (cancelled) return;
        setExiting({ key: current, text: states[current] });
        setIndex((current + 1) % states.length);
        setEntered(false);
        removeTimer = window.setTimeout(() => {
          if (cancelled) return;
          setExiting(null);
          step((current + 1) % states.length);
        }, swap + gap);
      }, hold);
    };
    step(index);
    return () => {
      cancelled = true;
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleKey, states.length]);

  // Release the incoming line from its enter-start rest state one frame
  // after it mounts, so the transition has a committed start to run from.
  useLayoutEffect(() => {
    if (entered) return;
    const gap = cssMs("--think-gap", 50);
    if (gap > 0) {
      const t = window.setTimeout(() => setEntered(true), gap);
      return () => window.clearTimeout(t);
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [entered, index]);

  if (states.length === 0) return null;
  const current = states[index] ?? states[0];

  return (
    <span className={cn("t-think", className)} role="status">
      <span className="t-think-sizer" aria-hidden="true">
        {longest}
      </span>
      {exiting ? (
        <span key={exiting.key} className="t-think-text is-exit" aria-hidden="true">
          {exiting.text}
        </span>
      ) : null}
      <span
        key={index}
        className={cn("t-think-text", !entered && "is-enter-start")}
        data-text={current}
      >
        {current}
      </span>
    </span>
  );
}

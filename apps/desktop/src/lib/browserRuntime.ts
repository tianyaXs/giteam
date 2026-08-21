export function scheduleAfterInteraction(task: () => void, delay = 240): number {
  return window.setTimeout(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(task));
  }, delay);
}

/** 主线程空闲再建重活（WebGL/大图）；无 requestIdleCallback 时退化为 timeout */
export function scheduleWhenIdle(task: () => void, options?: { timeout?: number; delay?: number }): () => void {
  const timeout = options?.timeout ?? 1200;
  const delay = options?.delay ?? 0;
  let idleId: number | null = null;
  let timerId: number | null = null;
  let cancelled = false;

  const run = () => {
    if (cancelled) return;
    task();
  };

  const startIdle = () => {
    if (cancelled) return;
    const ric = window.requestIdleCallback;
    if (typeof ric === "function") {
      idleId = ric(() => run(), { timeout });
      return;
    }
    timerId = window.setTimeout(run, Math.min(timeout, 320));
  };

  if (delay > 0) {
    timerId = window.setTimeout(startIdle, delay);
  } else {
    startIdle();
  }

  return () => {
    cancelled = true;
    if (timerId !== null) window.clearTimeout(timerId);
    if (idleId !== null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
    }
  };
}

export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

export function makeId(): string {
  return Math.random().toString(16).slice(2, 14);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

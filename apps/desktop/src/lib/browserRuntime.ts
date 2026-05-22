export function scheduleAfterInteraction(task: () => void, delay = 240): number {
  return window.setTimeout(() => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(task));
  }, delay);
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

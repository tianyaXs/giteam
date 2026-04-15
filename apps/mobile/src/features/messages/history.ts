export type RefreshViewMode = 'jumpToLatest' | 'loadingOlder' | 'default';

export function buildMessagesRetryPlan(fetchLimit: number, hasBeforeCursor: boolean): number[] {
  const safeLimit = Math.max(2, Math.floor(fetchLimit || 0));
  const fallbacks = [24, 16, 12, 8, 6, 4, 2].filter((lim) => lim < safeLimit && lim > 0);
  if (hasBeforeCursor) return [safeLimit, safeLimit, ...fallbacks];
  return [safeLimit, ...fallbacks];
}

export function retryDelayMs(index: number): number {
  if (index <= 0) return 0;
  return Math.min(900, 180 * index);
}

export async function fetchWithRetry<T>(args: {
  fetchLimit: number;
  hasBeforeCursor: boolean;
  fetchPage: (limit: number) => Promise<T>;
  onRetry?: (info: { limit: number; error: unknown; attempt: number }) => void;
}): Promise<T> {
  const plan = buildMessagesRetryPlan(args.fetchLimit, args.hasBeforeCursor);
  let lastErr: unknown = null;
  for (let idx = 0; idx < plan.length; idx += 1) {
    const limit = plan[idx];
    try {
      if (idx > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(idx)));
      }
      if (idx > 0 && args.onRetry) {
        args.onRetry({ limit, error: lastErr, attempt: idx + 1 });
      }
      return await args.fetchPage(limit);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export function computeVisibleTurnCount(args: {
  prevVisibleTurnCount: number;
  totalTurnCount: number;
  requestedVisibleTurnCount: number;
  initialTurnLimit: number;
  olderTurnLimit: number;
  mode: RefreshViewMode;
  forceVisibleTurnCount?: number;
  userAtTop?: boolean;
  hasNewHistoryFromCursor?: boolean;
}): number {
  const prevVisibleTurnCount = Math.max(0, Math.floor(args.prevVisibleTurnCount || 0));
  const totalTurnCount = Math.max(0, Math.floor(args.totalTurnCount || 0));
  const requestedVisibleTurnCount = Math.max(1, Math.floor(args.requestedVisibleTurnCount || 0));
  const initialTurnLimit = Math.max(1, Math.floor(args.initialTurnLimit || 0));
  const olderTurnLimit = Math.max(1, Math.floor(args.olderTurnLimit || 0));
  const forceVisibleTurnCount =
    typeof args.forceVisibleTurnCount === 'number' && Number.isFinite(args.forceVisibleTurnCount)
      ? Math.max(0, Math.floor(args.forceVisibleTurnCount))
      : 0;

  let nextVisibleTurnCount = prevVisibleTurnCount > 0 ? prevVisibleTurnCount : requestedVisibleTurnCount;

  if (args.mode === 'jumpToLatest') {
    nextVisibleTurnCount = requestedVisibleTurnCount;
  } else if (args.mode === 'loadingOlder') {
    nextVisibleTurnCount = Math.max(prevVisibleTurnCount, initialTurnLimit) + olderTurnLimit;
  }
  if (forceVisibleTurnCount > 0) {
    nextVisibleTurnCount = Math.max(nextVisibleTurnCount, forceVisibleTurnCount);
  }

  if (args.hasNewHistoryFromCursor && nextVisibleTurnCount <= prevVisibleTurnCount) {
    nextVisibleTurnCount = Math.max(prevVisibleTurnCount, initialTurnLimit) + olderTurnLimit;
  }

  if (totalTurnCount <= 0) return nextVisibleTurnCount;
  return Math.max(1, Math.min(nextVisibleTurnCount, totalTurnCount));
}

import { useRef } from "react";
import type {
  OpencodeMessagePageCacheEntry,
  OpencodeMessageWindowCacheEntry
} from "./opencodeSessions";

function getMessageCacheKey(repoPathValue: string, sessionId: string) {
  return `${repoPathValue.trim()}\n${sessionId.trim()}`;
}

function getMessagePageCacheKey(repoPathValue: string, sessionId: string, before: string, limit: number) {
  return `${getMessageCacheKey(repoPathValue, sessionId)}\n${before}\n${limit}`;
}

export function useOpencodeMessageCache() {
  const windowCacheRef = useRef<Record<string, OpencodeMessageWindowCacheEntry[]>>({});
  const pageCacheRef = useRef<Record<string, OpencodeMessagePageCacheEntry>>({});
  const pageInflightRef = useRef<Record<string, Promise<OpencodeMessagePageCacheEntry> | undefined>>({});

  const getPageCacheKey = getMessagePageCacheKey;

  const getPageCacheEntry = (repoPathValue: string, sessionId: string, before: string, limit: number) => {
    return pageCacheRef.current[getMessagePageCacheKey(repoPathValue, sessionId, before, limit)] || null;
  };

  const getPageInflight = (cacheKey: string) => pageInflightRef.current[cacheKey];

  const setPageInflight = (cacheKey: string, task: Promise<OpencodeMessagePageCacheEntry>) => {
    pageInflightRef.current = {
      ...pageInflightRef.current,
      [cacheKey]: task
    };
  };

  const clearPageInflight = (cacheKey: string) => {
    const next = { ...pageInflightRef.current };
    delete next[cacheKey];
    pageInflightRef.current = next;
  };

  const getBestWindowEntry = (repoPathValue: string, sessionId: string, limit: number, minFetchedAt = 0) => {
    const entries = windowCacheRef.current[getMessageCacheKey(repoPathValue, sessionId)] || [];
    const need = Math.max(2, limit);
    return entries.find((entry) => entry.limit >= need && entry.fetchedAt >= minFetchedAt) || null;
  };

  const invalidate = (repoPathValue: string, sessionId: string) => {
    const baseKey = getMessageCacheKey(repoPathValue, sessionId);
    const pagePrefix = `${baseKey}\n`;
    const nextWindow = { ...windowCacheRef.current };
    delete nextWindow[baseKey];
    windowCacheRef.current = nextWindow;
    pageCacheRef.current = Object.fromEntries(
      Object.entries(pageCacheRef.current).filter(([key]) => !key.startsWith(pagePrefix))
    );
    pageInflightRef.current = Object.fromEntries(
      Object.entries(pageInflightRef.current).filter(([key]) => !key.startsWith(pagePrefix))
    );
  };

  const setWindowEntry = (repoPathValue: string, sessionId: string, entry: OpencodeMessageWindowCacheEntry) => {
    const cacheKey = getMessageCacheKey(repoPathValue, sessionId);
    const prev = windowCacheRef.current[cacheKey] || [];
    const next = [...prev.filter((item) => item.limit !== entry.limit), entry]
      .sort((a, b) => a.limit - b.limit)
      .slice(-6);
    windowCacheRef.current = {
      ...windowCacheRef.current,
      [cacheKey]: next
    };
  };

  const setPageEntry = (repoPathValue: string, sessionId: string, entry: OpencodeMessagePageCacheEntry) => {
    const key = getMessagePageCacheKey(repoPathValue, sessionId, entry.before, entry.limit);
    pageCacheRef.current = {
      ...pageCacheRef.current,
      [key]: entry
    };
  };

  return {
    getPageCacheKey,
    getPageCacheEntry,
    getPageInflight,
    setPageInflight,
    clearPageInflight,
    getBestWindowEntry,
    invalidate,
    setWindowEntry,
    setPageEntry
  };
}

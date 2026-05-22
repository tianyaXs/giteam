import { useState } from "react";
import { loadPinnedRepoIds, savePinnedRepoIds } from "./desktopPreferences";

export function usePinnedRepoIds(): [string[], (repoId: string) => void] {
  const [pinnedRepoIds, setPinnedRepoIds] = useState<string[]>(() => loadPinnedRepoIds());

  function togglePinnedRepo(repoId: string) {
    const normalizedRepoId = repoId.trim();
    if (!normalizedRepoId) return;

    setPinnedRepoIds((prev) => {
      const next = prev.includes(normalizedRepoId)
        ? prev.filter((id) => id !== normalizedRepoId)
        : [...prev, normalizedRepoId];
      savePinnedRepoIds(next);
      return next;
    });
  }

  return [pinnedRepoIds, togglePinnedRepo];
}

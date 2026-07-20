import type { RemoteRepoWorkspace } from "./types";
import type { RemoteWorkspaceSession } from "./remoteRepoWorkspaceResources";

const REMOTE_WORKSPACE_HISTORY_KEY = "giteam.remote-repo-workspace-history.v1";
const MAX_WORKSPACES_PER_REPO = 5;

export type SavedRemoteWorkspace = RemoteWorkspaceSession & {
  updatedAt: number;
  state: "ready" | "expired";
};

export type RemoteWorkspaceHistory = Record<string, SavedRemoteWorkspace[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSavedWorkspace(value: unknown): SavedRemoteWorkspace | null {
  if (!isRecord(value)) return null;
  const sessionId = text(value.sessionId);
  const repoId = text(value.repoId);
  if (!sessionId || !repoId) return null;
  return {
    sessionId,
    repoId,
    workspaceId: text(value.workspaceId),
    baseCommit: text(value.baseCommit),
    workspaceVersion: number(value.workspaceVersion),
    dirty: Boolean(value.dirty),
    updatedAt: number(value.updatedAt),
    state: value.state === "expired" ? "expired" : "ready",
  };
}

function normalizeHistory(value: unknown): RemoteWorkspaceHistory {
  if (!isRecord(value)) return {};
  const history: RemoteWorkspaceHistory = {};
  for (const [repoId, rows] of Object.entries(value)) {
    if (!Array.isArray(rows)) continue;
    const sessions = rows
      .map(normalizeSavedWorkspace)
      .filter((session): session is SavedRemoteWorkspace => session !== null && session.repoId === repoId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_WORKSPACES_PER_REPO);
    if (sessions.length) history[repoId] = sessions;
  }
  return history;
}

export function loadRemoteWorkspaceHistory(): RemoteWorkspaceHistory {
  if (typeof window === "undefined") return {};
  try {
    return normalizeHistory(JSON.parse(window.localStorage.getItem(REMOTE_WORKSPACE_HISTORY_KEY) || "{}"));
  } catch {
    return {};
  }
}

export function saveRemoteWorkspaceHistory(history: RemoteWorkspaceHistory): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMOTE_WORKSPACE_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Restricted WebViews may not offer persistent local storage. The in-memory
    // history still lets the user return during the current app session.
  }
}

export function rememberRemoteWorkspace(
  history: RemoteWorkspaceHistory,
  session: RemoteWorkspaceSession,
  updatedAt = Date.now(),
): RemoteWorkspaceHistory {
  if (!session.sessionId || !session.repoId) return history;
  const saved: SavedRemoteWorkspace = { ...session, updatedAt, state: "ready" };
  const current = history[session.repoId] || [];
  const nextForRepo = [saved, ...current.filter((item) => item.sessionId !== session.sessionId)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_WORKSPACES_PER_REPO);
  return { ...history, [session.repoId]: nextForRepo };
}

export function markRemoteWorkspaceExpired(
  history: RemoteWorkspaceHistory,
  repoId: string,
  sessionId: string,
  updatedAt = Date.now(),
): RemoteWorkspaceHistory {
  const current = history[repoId] || [];
  const nextForRepo = current.map((item) => item.sessionId === sessionId ? { ...item, state: "expired" as const, updatedAt } : item);
  return nextForRepo.length ? { ...history, [repoId]: nextForRepo } : history;
}

export function getLatestRemoteWorkspaceSession(history: RemoteWorkspaceHistory, repoId: string): SavedRemoteWorkspace | null {
  return history[repoId]?.find((item) => item.state === "ready") || null;
}

export function getRecentRemoteWorkspaceCards(history: RemoteWorkspaceHistory, repoId: string): RemoteRepoWorkspace[] {
  return (history[repoId] || []).map((session) => ({
    id: session.sessionId,
    name: `${session.sessionId} · ${session.baseCommit.slice(0, 7) || "—"}`,
    baseCommit: session.baseCommit,
    dirty: session.dirty,
    workspaceVersion: session.workspaceVersion,
    updatedAt: session.updatedAt,
    state: session.state,
  }));
}

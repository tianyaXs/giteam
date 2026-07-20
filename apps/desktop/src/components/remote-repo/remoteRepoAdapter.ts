import type { RemoteRepo, RemoteRepoConnectionStatus } from "./types";

export type RemoteRepoOverviewPayload = {
  repoId: string;
  displayName: string;
  provider: string | null;
  remoteUrl: string | null;
  connectionStatus: RemoteRepoConnectionStatus;
  defaultRef: string;
  defaultCommit: string | null;
  linkedProjectIds: string[];
  pinned?: boolean;
  sortOrder?: number;
  lastAccessedAtMs: number;
  lastSyncedAtMs: number | null;
  error?: string | null;
};

export function sanitizeRemoteRepoOrigin(originUrl: string): string {
  const source = originUrl.trim();
  if (!source) return "";

  try {
    const url = new URL(source);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    // Supports SSH-style remotes such as git@github.com:owner/repo.git.
    return source.replace(/^[^@/\s]+@(?=[^:/\s]+[:/])/, "");
  }
}

export function adaptRemoteRepoOverview(payload: RemoteRepoOverviewPayload): RemoteRepo {
  return {
    id: payload.repoId,
    displayName: payload.displayName || payload.repoId,
    provider: payload.provider || undefined,
    connectionStatus: payload.connectionStatus,
    linkedProjectIds: payload.linkedProjectIds || [],
    pinned: Boolean(payload.pinned),
    sortOrder: payload.sortOrder || 0,
    lastSyncedAt: payload.lastSyncedAtMs || undefined,
    lastAccessedAt: payload.lastAccessedAtMs || 0,
    branch: payload.defaultRef || "main",
    commit: payload.defaultCommit ? payload.defaultCommit.slice(0, 7) : "—",
    originUrl: sanitizeRemoteRepoOrigin(payload.remoteUrl || ""),
    // The connection list does not carry graph state. It remains unknown until
    // the dedicated GitNexus status endpoint has been checked.
    gitNexusStatus: "unknown",
    // Repository file endpoints read the synchronized mirror directly; they
    // do not create a workspace or session.
    // A successful connection does not prove that its mirror can be listed.
    // The overview probes the read-only file endpoint before reporting ready.
    fileTreeStatus: payload.connectionStatus === "connected" ? "loading" : "unavailable",
    recentWorkspaces: [],
    recentActivity: [],
    errorMessage: payload.error || undefined,
  };
}

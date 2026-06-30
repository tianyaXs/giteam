import type { RemoteRepoOverviewPayload } from "./remoteRepoAdapter";
import type { RemoteRepoConnectionStatus } from "./types";

export type WebLocalRepoState = {
  pinned?: boolean;
  sortOrder?: number;
  lastAccessedAtMs?: number;
  lastSyncedAtMs?: number;
  linkedProjectIds?: string[];
};

export type RemoteServiceRepo = {
  repo_id?: string;
  name?: string;
  provider?: string | null;
  origin?: string | null;
  remote_url?: string | null;
  default_ref?: string | null;
  default_commit?: string | null;
  sync_status?: string | null;
  synced?: boolean;
  error_message?: string | null;
  last_synced_at_ms?: number | null;
};

function statusFor(repo: RemoteServiceRepo): RemoteRepoConnectionStatus {
  switch (repo.sync_status) {
    case "connected":
    case "ready":
      return "connected";
    case "syncing":
      return "syncing";
    case "auth_required":
    case "needs_auth":
      return "auth_required";
    case "failed":
      return "failed";
    case "stale":
      return "stale";
    default:
      return repo.synced ? "connected" : "stale";
  }
}

export function adaptWebRemoteRepoOverview(
  repo: RemoteServiceRepo,
  localState: WebLocalRepoState = {},
): RemoteRepoOverviewPayload {
  return {
    repoId: repo.repo_id || "",
    displayName: repo.name || repo.repo_id || "未命名连接",
    provider: repo.provider || null,
    remoteUrl: repo.origin || repo.remote_url || null,
    connectionStatus: statusFor(repo),
    defaultRef: repo.default_ref || "main",
    defaultCommit: repo.default_commit || null,
    linkedProjectIds: localState.linkedProjectIds || [],
    pinned: Boolean(localState.pinned),
    sortOrder: localState.sortOrder || 0,
    lastAccessedAtMs: localState.lastAccessedAtMs || 0,
    lastSyncedAtMs: repo.last_synced_at_ms ?? null,
    error: repo.error_message || null,
  };
}

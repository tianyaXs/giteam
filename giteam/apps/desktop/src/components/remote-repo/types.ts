export type RemoteRepoConnectionStatus = "connected" | "syncing" | "auth_required" | "failed" | "stale";
export type RemoteRepoGitNexusStatus = "unknown" | "ready" | "indexing" | "not_indexed" | "unavailable";
export type RemoteRepoFileTreeStatus = "ready" | "loading" | "unavailable";

export type RemoteRepoWorkspace = {
  id: string;
  name: string;
  baseCommit: string;
  branchName?: string;
  dirty: boolean;
  workspaceVersion: number;
  updatedAt: number;
  state: "ready" | "running" | "expired";
};

export type RemoteRepoActivity = {
  id: string;
  summary: string;
  occurredAt: number;
};

export type RemoteRepo = {
  /** Stable remote connection id. Do not use this as the primary display name. */
  id: string;
  displayName: string;
  provider?: string;
  connectionStatus: RemoteRepoConnectionStatus;
  linkedProjectIds: string[];
  pinned: boolean;
  sortOrder: number;
  lastSyncedAt?: number;
  lastAccessedAt: number;
  branch: string;
  commit: string;
  originUrl: string;
  gitNexusStatus: RemoteRepoGitNexusStatus;
  fileTreeStatus: RemoteRepoFileTreeStatus;
  recentWorkspaces: RemoteRepoWorkspace[];
  recentActivity: RemoteRepoActivity[];
  errorMessage?: string;
};

export type RemoteRepoAction = "browse_files" | "view_branches" | "open_workspace" | "resume_workspace";

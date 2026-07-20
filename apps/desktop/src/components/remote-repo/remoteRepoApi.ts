import { invoke, IS_TAURI } from "../../lib/platform";
import { adaptRemoteRepoOverview, type RemoteRepoOverviewPayload } from "./remoteRepoAdapter";
import {
  addWebRemoteRepo,
  listWebRemoteRepos,
  reloadWebRemoteRepoConfig,
  removeWebRemoteRepo,
  setWebRemoteRepoPinned,
  syncWebRemoteRepo,
  touchWebRemoteRepo,
  updateWebRemoteRepo,
  listWebRemoteRepoBranches,
  listWebRemoteRepoFiles,
  readWebRemoteRepoFile,
  callWebRemoteRepoWorkspace,
} from "./remoteRepoWebApi";
import {
  normalizeRemoteRepoBranches,
  normalizeRemoteRepoFileContent,
  normalizeRemoteRepoFileTree,
  type RemoteRepoBranch,
  type RemoteRepoFileContent,
  type RemoteRepoFileTree,
} from "./remoteRepoResources";
import type { RemoteRepo } from "./types";

type RemoteRepoSyncResult = {
  repoId: string;
  cachePath: string;
};

export type RemoteRepoMutationInput = {
  repoId: string;
  name?: string;
  remoteUrl?: string;
  defaultRef?: string;
  authMethod?: "ssh_agent" | "system_https";
};

/** Explicit operations available inside a user-created remote workspace. */
export type RemoteRepoWorkspaceOperation =
  | "create_session"
  | "session_state"
  | "run_shell"
  | "list_files"
  | "read_file"
  | "find_files"
  | "find_text"
  | "write_file"
  | "edit_file"
  | "apply_patch"
  | "graph_status"
  | "graph_analyze"
  | "list_tools"
  | "list_workspaces"
  | "get_workspace"
  | "resume_workspace"
  | "list_operations"
  | "list_activities"
  | "repo_gitnexus_status";

export async function listRemoteRepos(): Promise<RemoteRepo[]> {
  if (!IS_TAURI) return (await listWebRemoteRepos()).map(adaptRemoteRepoOverview);
  const payload = await invoke<RemoteRepoOverviewPayload[]>("remote_repo", {
    action: "list_overviews",
    payload: {},
  });
  return payload.map(adaptRemoteRepoOverview);
}

export async function syncRemoteRepoConnection(repoId: string): Promise<RemoteRepoSyncResult> {
  if (!IS_TAURI) return syncWebRemoteRepo(repoId);
  return invoke<RemoteRepoSyncResult>("remote_repo", {
    action: "sync_repo",
    payload: { repoId },
  });
}

export async function touchRemoteRepoAccess(repoId: string): Promise<void> {
  if (!IS_TAURI) return touchWebRemoteRepo(repoId);
  await invoke("remote_repo", {
    action: "touch_accessed",
    payload: { repoId },
  });
}

export async function reloadRemoteRepoConfig(): Promise<void> {
  if (!IS_TAURI) return reloadWebRemoteRepoConfig();
  await invoke("remote_repo", { action: "reload_config", payload: {} });
}

export async function addRemoteRepo(input: Required<Pick<RemoteRepoMutationInput, "repoId" | "name" | "remoteUrl" | "defaultRef">> & Pick<RemoteRepoMutationInput, "authMethod">): Promise<void> {
  if (!IS_TAURI) return addWebRemoteRepo(input);
  await invoke("remote_repo", { action: "add_repo", payload: input });
}

export async function updateRemoteRepo(input: RemoteRepoMutationInput): Promise<void> {
  if (!IS_TAURI) return updateWebRemoteRepo(input);
  await invoke("remote_repo", { action: "update_repo", payload: input });
}

export async function removeRemoteRepo(repoId: string): Promise<void> {
  if (!IS_TAURI) return removeWebRemoteRepo(repoId);
  await invoke("remote_repo", { action: "remove_repo", payload: { repoId } });
}

export async function setRemoteRepoPinned(repoId: string, pinned: boolean): Promise<void> {
  if (!IS_TAURI) return setWebRemoteRepoPinned(repoId, pinned);
  await invoke("remote_repo", { action: "set_pinned", payload: { repoId, pinned } });
}

export async function listRemoteRepoBranches(repoId: string): Promise<RemoteRepoBranch[]> {
  if (!IS_TAURI) return listWebRemoteRepoBranches(repoId);
  return normalizeRemoteRepoBranches(await invoke("remote_repo", {
    action: "list_branches",
    payload: { repoId },
  }));
}

export async function listRemoteRepoFiles(
  repoId: string,
  path = ".",
  refOrCommit?: string,
): Promise<RemoteRepoFileTree> {
  if (!IS_TAURI) return listWebRemoteRepoFiles(repoId, path, refOrCommit);
  return normalizeRemoteRepoFileTree(await invoke("remote_repo", {
    action: "list_files",
    payload: { repoId, path, refOrCommit },
  }));
}

export async function readRemoteRepoFile(
  repoId: string,
  path: string,
  refOrCommit?: string,
): Promise<RemoteRepoFileContent> {
  if (!IS_TAURI) return readWebRemoteRepoFile(repoId, path, refOrCommit);
  return normalizeRemoteRepoFileContent(await invoke("remote_repo", {
    action: "read_file",
    payload: { repoId, path, refOrCommit },
  }));
}

export async function callRemoteRepoWorkspace(
  operation: RemoteRepoWorkspaceOperation,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!IS_TAURI) return callWebRemoteRepoWorkspace(operation, input);
  return invoke("remote_repo", {
    action: "workspace_request",
    payload: { operation, input },
  });
}

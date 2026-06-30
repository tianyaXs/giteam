import type { RemoteRepoMutationInput } from "./remoteRepoApi";
import type { RemoteRepoWorkspaceOperation } from "./remoteRepoApi";
import { getWebRemoteRepoServiceApiKey, getWebRemoteRepoServiceBase } from "./remoteRepoServiceSettings";
import { adaptWebRemoteRepoOverview, type RemoteServiceRepo, type WebLocalRepoState } from "./remoteRepoWebData";
import {
  normalizeRemoteRepoBranches,
  normalizeRemoteRepoFileContent,
  normalizeRemoteRepoFileTree,
  type RemoteRepoBranch,
  type RemoteRepoFileContent,
  type RemoteRepoFileTree,
} from "./remoteRepoResources";

const WEB_LOCAL_STATE_KEY = "giteam.remote-repo.local-state.v1";

type RemoteServiceEnvelope = {
  ok?: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
};

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `giteam-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readLocalState(): Record<string, WebLocalRepoState> {
  try {
    const raw = window.localStorage.getItem(WEB_LOCAL_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalState(next: Record<string, WebLocalRepoState>): void {
  try {
    window.localStorage.setItem(WEB_LOCAL_STATE_KEY, JSON.stringify(next));
  } catch {
    // Browser storage is an enhancement for the preview, never a requirement
    // for reading or managing the real remote service.
  }
}

function updateLocalState(repoId: string, patch: WebLocalRepoState): void {
  const current = readLocalState();
  current[repoId] = { ...current[repoId], ...patch };
  writeLocalState(current);
}

async function request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 35_000);
  try {
    const apiKey = getWebRemoteRepoServiceApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) headers["X-API-Key"] = apiKey.trim();
    const response = await fetch(`${getWebRemoteRepoServiceBase()}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ request_id: requestId(), ...body }),
      signal: controller.signal,
    });
    const envelope = await response.json().catch(() => ({})) as RemoteServiceEnvelope;
    if (!response.ok || envelope.ok === false) {
      throw new Error(envelope.error?.message || `远程仓库服务请求失败（HTTP ${response.status}）`);
    }
    return envelope.data || {};
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("远程仓库服务响应超时，请稍后重试");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function listWebRemoteRepos() {
  const data = await request("/v1/repos", {});
  const rows = Array.isArray(data.repos) ? data.repos as RemoteServiceRepo[] : [];
  const localState = readLocalState();
  return rows
    .map((repo) => adaptWebRemoteRepoOverview(repo, localState[repo.repo_id || ""]))
    .filter((repo) => Boolean(repo.repoId));
}

export async function syncWebRemoteRepo(repoId: string): Promise<{ repoId: string; cachePath: string }> {
  const data = await request("/v1/repos/sync", { repo_id: repoId });
  // Sync time is a service fact. Keep only the allowed UI-local access hint.
  updateLocalState(repoId, { lastAccessedAtMs: Date.now() });
  return { repoId, cachePath: typeof data.cache_path === "string" ? data.cache_path : "" };
}

export function touchWebRemoteRepo(repoId: string): void {
  updateLocalState(repoId, { lastAccessedAtMs: Date.now() });
}

export async function reloadWebRemoteRepoConfig(): Promise<void> {
  await request("/v1/config/reload", {});
}

export async function addWebRemoteRepo(input: Required<Pick<RemoteRepoMutationInput, "repoId" | "name" | "remoteUrl" | "defaultRef">> & Pick<RemoteRepoMutationInput, "authMethod">): Promise<void> {
  await request("/v1/repos/add", {
    repo_id: input.repoId,
    name: input.name,
    remote_url: input.remoteUrl,
    default_ref: input.defaultRef,
    ...(input.authMethod ? { auth_method: input.authMethod } : {}),
  });
}

export async function updateWebRemoteRepo(input: RemoteRepoMutationInput): Promise<void> {
  await request("/v1/repos/update", {
    repo_id: input.repoId,
    ...(input.name ? { name: input.name } : {}),
    ...(input.remoteUrl ? { remote_url: input.remoteUrl } : {}),
    ...(input.defaultRef ? { default_ref: input.defaultRef } : {}),
    ...(input.authMethod ? { auth_method: input.authMethod } : {}),
  });
}

export async function removeWebRemoteRepo(repoId: string): Promise<void> {
  await request("/v1/repos/remove", { repo_id: repoId });
  const localState = readLocalState();
  delete localState[repoId];
  writeLocalState(localState);
}

export function setWebRemoteRepoPinned(repoId: string, pinned: boolean): void {
  updateLocalState(repoId, { pinned });
}

export async function listWebRemoteRepoBranches(repoId: string): Promise<RemoteRepoBranch[]> {
  return normalizeRemoteRepoBranches(await request("/v1/repos/branches", { repo_id: repoId }));
}

export async function listWebRemoteRepoFiles(
  repoId: string,
  path = ".",
  refOrCommit?: string,
): Promise<RemoteRepoFileTree> {
  return normalizeRemoteRepoFileTree(await request("/v1/repos/files/list", {
    repo_id: repoId,
    path,
    ...(refOrCommit ? { ref_or_commit: refOrCommit } : {}),
  }));
}

export async function readWebRemoteRepoFile(
  repoId: string,
  path: string,
  refOrCommit?: string,
): Promise<RemoteRepoFileContent> {
  return normalizeRemoteRepoFileContent(await request("/v1/repos/files/read", {
    repo_id: repoId,
    path,
    ...(refOrCommit ? { ref_or_commit: refOrCommit } : {}),
  }));
}

const WORKSPACE_OPERATION_PATH: Record<RemoteRepoWorkspaceOperation, string> = {
  create_session: "/v1/sessions",
  session_state: "/v1/sessions/state",
  run_shell: "/v1/shell/run",
  list_files: "/v1/files/list",
  read_file: "/v1/files/read",
  find_files: "/v1/find/files",
  find_text: "/v1/find/text",
  write_file: "/v1/files/write",
  edit_file: "/v1/files/edit",
  apply_patch: "/v1/files/apply-patch",
  graph_status: "/v1/graph/status",
  graph_analyze: "/v1/graph/analyze",
  list_tools: "/v1/tools",
  list_workspaces: "/v1/workspaces/list",
  get_workspace: "/v1/workspaces/get",
  resume_workspace: "/v1/workspaces/resume",
  list_operations: "/v1/workspaces/operations",
  list_activities: "/v1/activities/list",
  repo_gitnexus_status: "/v1/gitnexus/repo-status",
};

export async function callWebRemoteRepoWorkspace(
  operation: RemoteRepoWorkspaceOperation,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return request(WORKSPACE_OPERATION_PATH[operation], input);
}

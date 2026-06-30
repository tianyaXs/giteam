import { callRemoteRepoWorkspace } from "./remoteRepoApi";
import {
  normalizeRemoteWorkspaceActivities,
  normalizeRemoteWorkspaceFileEntries,
  normalizeRemoteWorkspaceFileSlice,
  normalizeRemoteWorkspaceGraphState,
  normalizeRemoteWorkspaceOperations,
  normalizeRemoteWorkspaceSession,
  normalizeRemoteWorkspaceShellResult,
  normalizeRemoteWorkspaceSummaries,
  normalizeRemoteWorkspaceTextMatches,
  type RemoteWorkspaceActivity,
  type RemoteWorkspaceFileEntry,
  type RemoteWorkspaceFileSlice,
  type RemoteWorkspaceGraphState,
  type RemoteWorkspaceOperationRecord,
  type RemoteWorkspaceSession,
  type RemoteWorkspaceShellResult,
  type RemoteWorkspaceSummary,
  type RemoteWorkspaceTextMatch,
} from "./remoteRepoWorkspaceResources";

export async function createRemoteWorkspace(repoId: string, refOrCommit: string): Promise<RemoteWorkspaceSession> {
  return normalizeRemoteWorkspaceSession(await callRemoteRepoWorkspace("create_session", {
    repo_id: repoId,
    ref_or_commit: refOrCommit,
  }));
}

export async function getRemoteWorkspaceState(sessionId: string): Promise<RemoteWorkspaceSession> {
  return normalizeRemoteWorkspaceSession(await callRemoteRepoWorkspace("session_state", { session_id: sessionId }));
}

export async function listRemoteRepoWorkspaces(repoId: string): Promise<RemoteWorkspaceSummary[]> {
  const data = await callRemoteRepoWorkspace("list_workspaces", { repo_id: repoId });
  return normalizeRemoteWorkspaceSummaries(data.workspaces);
}

export async function resumeRemoteWorkspace(workspaceId: string): Promise<RemoteWorkspaceSession> {
  return normalizeRemoteWorkspaceSession(await callRemoteRepoWorkspace("resume_workspace", { workspace_id: workspaceId }));
}

export async function listRemoteRepoActivities(repoId: string): Promise<RemoteWorkspaceActivity[]> {
  const data = await callRemoteRepoWorkspace("list_activities", { repo_id: repoId });
  return normalizeRemoteWorkspaceActivities(data.activities);
}

export async function listRemoteWorkspaceOperations(workspaceId: string, limit = 100): Promise<RemoteWorkspaceOperationRecord[]> {
  const data = await callRemoteRepoWorkspace("list_operations", { workspace_id: workspaceId, limit });
  return normalizeRemoteWorkspaceOperations(data.operations);
}

export async function runRemoteWorkspaceShell(
  sessionId: string,
  command: string,
  cwd = ".",
): Promise<RemoteWorkspaceShellResult> {
  return normalizeRemoteWorkspaceShellResult(await callRemoteRepoWorkspace("run_shell", {
    session_id: sessionId,
    command,
    cwd,
  }));
}

export async function listRemoteWorkspaceFiles(sessionId: string, path = "."): Promise<RemoteWorkspaceFileEntry[]> {
  const data = await callRemoteRepoWorkspace("list_files", { session_id: sessionId, path, max_entries: 200 });
  return normalizeRemoteWorkspaceFileEntries(data.entries);
}

export async function readRemoteWorkspaceFile(
  sessionId: string,
  path: string,
  startLine = 1,
  maxLines = 120,
): Promise<RemoteWorkspaceFileSlice> {
  return normalizeRemoteWorkspaceFileSlice(await callRemoteRepoWorkspace("read_file", {
    session_id: sessionId,
    path,
    start_line: startLine,
    max_lines: maxLines,
  }));
}

export async function findRemoteWorkspaceFiles(sessionId: string, query: string): Promise<string[]> {
  const data = await callRemoteRepoWorkspace("find_files", { session_id: sessionId, query, max_results: 100 });
  return Array.isArray(data.paths) ? data.paths.filter((path): path is string => typeof path === "string") : [];
}

export async function grepRemoteWorkspaceFiles(sessionId: string, pattern: string): Promise<RemoteWorkspaceTextMatch[]> {
  const data = await callRemoteRepoWorkspace("find_text", { session_id: sessionId, pattern, path: ".", max_results: 100 });
  return normalizeRemoteWorkspaceTextMatches(data.matches);
}

function mutationVersion(data: Record<string, unknown>): number {
  const value = data.workspace_version ?? data.workspaceVersion;
  return typeof value === "number" ? value : 0;
}

export async function writeRemoteWorkspaceFile(sessionId: string, path: string, content: string): Promise<number> {
  const data = await callRemoteRepoWorkspace("write_file", { session_id: sessionId, path, content, create_dirs: true });
  return mutationVersion(data);
}

export async function editRemoteWorkspaceFile(
  sessionId: string,
  path: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
): Promise<number> {
  const data = await callRemoteRepoWorkspace("edit_file", {
    session_id: sessionId,
    path,
    old_text: oldText,
    new_text: newText,
    replace_all: replaceAll,
  });
  return mutationVersion(data);
}

export async function applyRemoteWorkspacePatch(sessionId: string, patch: string): Promise<number> {
  const data = await callRemoteRepoWorkspace("apply_patch", { session_id: sessionId, patch });
  return mutationVersion(data);
}

export async function getRemoteWorkspaceGraph(
  repoId: string,
  sessionId: string | null,
  target: "repo_head" | "session_workspace",
  analyze = false,
  refOrCommit?: string,
): Promise<RemoteWorkspaceGraphState> {
  const data = await callRemoteRepoWorkspace(analyze ? "graph_analyze" : "graph_status", {
    target_type: target,
    ...(target === "repo_head"
      ? { repo_id: repoId, ...(refOrCommit ? { ref_or_commit: refOrCommit } : {}) }
      : { session_id: sessionId }),
  });
  return normalizeRemoteWorkspaceGraphState(data);
}

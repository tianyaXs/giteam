import type { RemoteRepoGitNexusStatus } from "./types";

export type RemoteWorkspaceSession = {
  sessionId: string;
  repoId: string;
  workspaceId: string;
  baseCommit: string;
  workspaceVersion: number;
  dirty: boolean;
};

/** Durable workspace metadata returned by the server, rather than browser history. */
export type RemoteWorkspaceSummary = {
  workspaceId: string;
  repoId: string;
  sessionId: string;
  baseCommit: string;
  workspaceVersion: number;
  dirty: boolean;
  updatedAt: number;
  state: "ready" | "running" | "expired";
};

export type RemoteWorkspaceActivity = {
  id: string;
  summary: string;
  occurredAt: number;
};

export type RemoteWorkspaceOperationRecord = {
  operationId: string;
  repoId: string;
  workspaceId: string;
  sessionId: string;
  kind: string;
  summary: string;
  status: string;
  command: string;
  cwd: string;
  path: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  diffSummary: string;
  metadata: Record<string, unknown>;
  workspaceVersion: number;
  startedAt: number;
  finishedAt: number;
};

export type RemoteWorkspaceShellResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  timedOut: boolean;
  workspaceVersion: number;
  statusAfter: string;
  diffSummary: string;
};

export type RemoteWorkspaceFileEntry = {
  path: string;
  type: "file" | "directory";
  size: number | null;
};

export type RemoteWorkspaceFileSlice = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
  workspaceVersion: number;
};

export type RemoteWorkspaceTextMatch = {
  path: string;
  lineNumber: number;
  line: string;
};

export type RemoteWorkspaceGraphState = {
  status: string;
  target: unknown;
  lastIndexedAt?: string;
  error?: string;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeRemoteWorkspaceSession(value: unknown): RemoteWorkspaceSession {
  const data = record(value);
  return {
    sessionId: text(data.sessionId ?? data.session_id),
    repoId: text(data.repoId ?? data.repo_id),
    workspaceId: text(data.workspaceId ?? data.workspace_id),
    baseCommit: text(data.baseCommit ?? data.base_commit),
    workspaceVersion: number(data.workspaceVersion ?? data.workspace_version),
    dirty: Boolean(data.dirty),
  };
}

export function normalizeRemoteWorkspaceSummaries(value: unknown): RemoteWorkspaceSummary[] {
  const rows = Array.isArray(value) ? value : record(value).workspaces;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const data = record(row);
    const status = text(data.status).toLowerCase();
    const state: RemoteWorkspaceSummary["state"] = status === "removed" || status === "expired"
      ? "expired"
      : status === "running" ? "running" : "ready";
    return {
      workspaceId: text(data.workspaceId ?? data.workspace_id),
      repoId: text(data.repoId ?? data.repo_id),
      sessionId: text(data.sessionId ?? data.session_id),
      baseCommit: text(data.baseCommit ?? data.base_commit),
      workspaceVersion: number(data.workspaceVersion ?? data.workspace_version),
      dirty: Boolean(data.dirty),
      updatedAt: number(data.updatedAtMs ?? data.updated_at_ms ?? data.lastAccessedAtMs ?? data.last_accessed_at_ms),
      state,
    };
  }).filter((workspace) => Boolean(workspace.workspaceId && workspace.repoId && workspace.sessionId));
}

export function normalizeRemoteWorkspaceActivities(value: unknown): RemoteWorkspaceActivity[] {
  const rows = Array.isArray(value) ? value : record(value).activities;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const data = record(row);
    const numericId = data.activityId ?? data.activity_id;
    return {
      id: typeof numericId === "string" || typeof numericId === "number" ? String(numericId) : "",
      summary: text(data.summary),
      occurredAt: number(data.occurredAtMs ?? data.occurred_at_ms),
    };
  }).filter((activity) => Boolean(activity.id && activity.summary));
}

export function normalizeRemoteWorkspaceOperations(value: unknown): RemoteWorkspaceOperationRecord[] {
  const rows = Array.isArray(value) ? value : record(value).operations;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const data = record(row);
    return {
      operationId: text(data.operationId ?? data.operation_id),
      repoId: text(data.repoId ?? data.repo_id),
      workspaceId: text(data.workspaceId ?? data.workspace_id),
      sessionId: text(data.sessionId ?? data.session_id),
      kind: text(data.kind),
      summary: text(data.summary),
      status: text(data.status) || "completed",
      command: text(data.command),
      cwd: text(data.cwd),
      path: text(data.path),
      exitCode: nullableNumber(data.exitCode ?? data.exit_code),
      stdout: text(data.stdout),
      stderr: text(data.stderr),
      diffSummary: text(data.diffSummary ?? data.diff_summary),
      metadata: record(data.metadata),
      workspaceVersion: number(data.workspaceVersion ?? data.workspace_version),
      startedAt: number(data.startedAtMs ?? data.started_at_ms),
      finishedAt: number(data.finishedAtMs ?? data.finished_at_ms),
    };
  }).filter((operation) => Boolean(operation.operationId && operation.workspaceId && operation.sessionId));
}

export function normalizeRemoteWorkspaceShellResult(value: unknown): RemoteWorkspaceShellResult {
  const data = record(value);
  return {
    exitCode: number(data.exitCode ?? data.exit_code),
    stdout: text(data.stdout),
    stderr: text(data.stderr),
    elapsedMs: number(data.elapsedMs ?? data.elapsed_ms),
    timedOut: Boolean(data.timedOut ?? data.timed_out),
    workspaceVersion: number(data.workspaceVersion ?? data.workspace_version),
    statusAfter: text(data.statusAfter ?? data.status_after),
    diffSummary: text(data.diffSummary ?? data.diff_summary),
  };
}

export function normalizeRemoteWorkspaceFileEntries(value: unknown): RemoteWorkspaceFileEntry[] {
  const rows = Array.isArray(value) ? value : record(value).entries;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const data = record(row);
    return {
      path: text(data.path),
      type: data.type === "directory" ? "directory" as const : "file" as const,
      size: typeof data.size === "number" ? data.size : null,
    };
  }).filter((entry) => Boolean(entry.path));
}

export function normalizeRemoteWorkspaceFileSlice(value: unknown): RemoteWorkspaceFileSlice {
  const data = record(value);
  return {
    path: text(data.path),
    startLine: number(data.startLine ?? data.start_line),
    endLine: number(data.endLine ?? data.end_line),
    content: text(data.content),
    truncated: Boolean(data.truncated),
    workspaceVersion: number(data.workspaceVersion ?? data.workspace_version),
  };
}

export function normalizeRemoteWorkspaceTextMatches(value: unknown): RemoteWorkspaceTextMatch[] {
  const rows = Array.isArray(value) ? value : record(value).matches;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const data = record(row);
    return {
      path: text(data.path),
      lineNumber: number(data.lineNumber ?? data.line_number),
      line: text(data.line),
    };
  }).filter((match) => Boolean(match.path));
}

export function normalizeRemoteWorkspaceGraphState(value: unknown): RemoteWorkspaceGraphState {
  const data = record(value);
  return {
    status: text(data.status) || "STALE",
    target: data.target ?? null,
    lastIndexedAt: text(data.lastIndexedAt ?? data.last_indexed_at) || undefined,
    error: text(data.error) || undefined,
  };
}

export function formatRemoteWorkspaceTimestamp(value?: string, timeZone?: string): string {
  if (!value) return "未提供";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

export function mapGraphStatusToRemoteRepoGitNexusStatus(status: string): RemoteRepoGitNexusStatus {
  switch (status.toUpperCase()) {
    case "READY": return "ready";
    case "INDEXING": return "indexing";
    case "STALE": return "not_indexed";
    case "FAILED": return "unavailable";
    default: return "unknown";
  }
}

export function describeRemoteWorkspaceGraphAction(action: "status" | "analyze", graph: RemoteWorkspaceGraphState): string {
  const indexTime = formatRemoteWorkspaceTimestamp(graph.lastIndexedAt);
  const failureDetail = graph.error ? `：${graph.error}` : "。";
  if (graph.status === "READY") {
    return action === "analyze"
      ? `GitNexus 分析完成：索引可用（索引时间：${indexTime}）。`
      : `状态已检查：索引可用（最近索引：${indexTime}）。`;
  }
  if (graph.status === "FAILED") {
    return action === "analyze"
      ? `GitNexus 分析失败${failureDetail}`
      : `状态已检查：索引失败${failureDetail}`;
  }
  if (graph.status === "STALE") {
    return action === "analyze"
      ? "GitNexus 分析尚未就绪，请查看错误信息后重试。"
      : "状态已检查：索引需要分析。";
  }
  return action === "analyze"
    ? `GitNexus 分析完成，当前状态：${graph.status}。`
    : `状态已检查，当前状态：${graph.status}。`;
}

export function explainRemoteWorkspaceCreationError(error: unknown): string {
  const message = String(error);
  const fromService = message.match(/Ref or commit not found:\s*([^\n]+)/i);
  const fromGit = message.match(/git rev-parse\s+([^\s^]+)\^\{commit\}/i);
  const ref = (fromService?.[1] || fromGit?.[1] || "").trim();
  if (ref) {
    return `找不到 ref 或提交 “${ref}”。请输入真实分支名或提交 SHA；这里不是工作区名称。`;
  }
  return message;
}

export function ensureRemoteWorkspaceSessionRepo(session: RemoteWorkspaceSession, repoId: string): RemoteWorkspaceSession {
  if (session.repoId !== repoId) {
    throw new Error("这个 session 不属于当前仓库，不能在这里恢复。");
  }
  return session;
}

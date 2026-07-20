export type RemoteRepoBranch = {
  name: string;
  shortSha: string;
  isDefault: boolean;
};

export type RemoteRepoFileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  shortSha: string;
};

export type RemoteRepoFileTree = {
  ref: string;
  commit: string;
  path: string;
  entries: RemoteRepoFileEntry[];
};

export type RemoteRepoFileContent = {
  ref: string;
  commit: string;
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  truncated: boolean;
  sha256: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeRemoteRepoBranches(value: unknown): RemoteRepoBranch[] {
  const rows = asRecord(value).branches;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const item = asRecord(row);
    return {
      name: text(item.name),
      shortSha: text(item.shortSha ?? item.short_sha),
      isDefault: Boolean(item.isDefault ?? item.is_default),
    };
  }).filter((branch) => Boolean(branch.name));
}

export function normalizeRemoteRepoFileTree(value: unknown): RemoteRepoFileTree {
  const data = asRecord(value);
  const rows = Array.isArray(data.entries) ? data.entries : [];
  const entries = rows.map((row) => {
    const item = asRecord(row);
    return {
      name: text(item.name),
      path: text(item.path),
      kind: item.kind === "directory" ? "directory" as const : "file" as const,
      shortSha: text(item.shortSha ?? item.short_sha),
    };
  }).filter((entry) => Boolean(entry.name && entry.path));
  return {
    ref: text(data.ref),
    commit: text(data.commit),
    path: text(data.path) || ".",
    entries,
  };
}

export function normalizeRemoteRepoFileContent(value: unknown): RemoteRepoFileContent {
  const data = asRecord(value);
  return {
    ref: text(data.ref),
    commit: text(data.commit),
    path: text(data.path),
    startLine: number(data.startLine ?? data.start_line),
    endLine: number(data.endLine ?? data.end_line),
    content: text(data.content),
    truncated: Boolean(data.truncated),
    sha256: text(data.sha256),
  };
}

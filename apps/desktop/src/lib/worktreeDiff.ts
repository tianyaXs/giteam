import type { GitWorktreeEntry } from "./types";

export type DiffRowKind = "meta" | "add" | "del" | "ctx";
export type DiffRow = { kind: DiffRowKind; left: string; right: string };
export type WorktreePatchRow = {
  kind: DiffRowKind;
  text: string;
  marker: string;
  oldLine: number | null;
  newLine: number | null;
  tone: "meta" | "hunk" | "add" | "del" | "ctx";
};

export type SplitDiffSide = {
  line: number | null;
  text: string;
  marker: string;
  tone: "del" | "add" | "ctx" | "empty";
};

export type SplitDiffRow = {
  kind: "hunk" | "meta" | "line";
  left: SplitDiffSide;
  right: SplitDiffSide;
};

export type WorktreeTreeNode = {
  name: string;
  path: string;
  kind: "dir" | "file";
  children: WorktreeTreeNode[];
  entry?: GitWorktreeEntry;
};

export type WorktreePatchStats = {
  added: number;
  deleted: number;
  hunks: number;
};

export type WorktreeChangeStats = {
  total: number;
  staged: number;
  unstaged: number;
};

export function buildWorktreeTree(entries: GitWorktreeEntry[]): WorktreeTreeNode[] {
  const root: WorktreeTreeNode[] = [];
  const dirMap = new Map<string, WorktreeTreeNode>();

  for (const entry of entries) {
    const parts = entry.path.split(/[\\/]/).filter(Boolean);
    let parentPath = "";
    let level = root;

    parts.forEach((part, index) => {
      const nextPath = parentPath ? `${parentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.find((item) => item.path === nextPath);
      if (!node && !isFile) node = dirMap.get(nextPath);
      if (!node) {
        node = {
          name: part,
          path: nextPath,
          kind: isFile ? "file" : "dir",
          children: [],
          entry: isFile ? entry : undefined
        };
        level.push(node);
        if (!isFile) dirMap.set(nextPath, node);
      }
      parentPath = nextPath;
      level = node.children;
    });
  }

  const sortNodes = (nodes: WorktreeTreeNode[]): WorktreeTreeNode[] => nodes
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) => ({
      ...node,
      children: sortNodes(node.children)
    }));

  return sortNodes(root);
}

export function collectWorktreeDirPaths(nodes: WorktreeTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind !== "dir") return [];
    return [node.path, ...collectWorktreeDirPaths(node.children)];
  });
}

export function collectWorktreeNodeFilePaths(node: WorktreeTreeNode): string[] {
  if (node.kind === "file") return node.entry?.path ? [node.entry.path] : [];
  return node.children.flatMap(collectWorktreeNodeFilePaths);
}

export function collectWorktreeNodeEntries(node: WorktreeTreeNode): GitWorktreeEntry[] {
  if (node.kind === "file") return node.entry ? [node.entry] : [];
  return node.children.flatMap(collectWorktreeNodeEntries);
}

export function getWorktreeDisplayStatus(entry: GitWorktreeEntry): string {
  const flags = `${entry.indexStatus}${entry.worktreeStatus}`;
  if (flags.includes("?")) return "A";
  if (flags.includes("A")) return "A";
  if (flags.includes("D")) return "D";
  if (flags.includes("R")) return "R";
  if (flags.includes("C")) return "C";
  if (flags.includes("M")) return "M";
  return flags.trim() || "-";
}

export function getWorktreeFileKindLabel(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "file";
  if (ext === "tsx" || ext === "jsx") return "tsx";
  if (ext === "ts" || ext === "js") return ext;
  if (ext === "css" || ext === "html" || ext === "rs") return ext;
  return ext.slice(0, 4);
}

export function getMonacoLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "javascript";
  if (ext === "rs") return "rust";
  if (ext === "css") return "css";
  if (ext === "html") return "html";
  if (ext === "json") return "json";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "toml") return "toml";
  if (ext === "yaml" || ext === "yml") return "yaml";
  return "plaintext";
}

export function getWorktreeStatusText(entry?: GitWorktreeEntry | null): string {
  if (!entry) return "未选择文件";
  if (entry.untracked) return "新文件";
  if (entry.staged && entry.unstaged) return "暂存 + 未暂存";
  if (entry.staged) return "已暂存";
  if (entry.unstaged) return "未暂存";
  return "已修改";
}

export function buildSplitDiffRows(patch: string): SplitDiffRow[] {
  if (!patch.trim()) return [];
  const rows: WorktreePatchRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      rows.push({ kind: "meta", text: line, marker: "@@", oldLine: null, newLine: null, tone: "hunk" });
      continue;
    }
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      rows.push({ kind: "meta", text: line, marker: "•", oldLine: null, newLine: null, tone: "meta" });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), marker: "+", oldLine: null, newLine, tone: "add" });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", text: line.slice(1), marker: "-", oldLine, newLine: null, tone: "del" });
      oldLine += 1;
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({ kind: "ctx", text, marker: " ", oldLine, newLine, tone: "ctx" });
    oldLine += 1;
    newLine += 1;
  }

  const splitRows: SplitDiffRow[] = [];
  const delBuffer: WorktreePatchRow[] = [];

  function flushDelBuffer() {
    for (const row of delBuffer) {
      splitRows.push({
        kind: "line",
        left: { line: row.oldLine, text: row.text, marker: row.marker, tone: "del" },
        right: { line: null, text: "", marker: "", tone: "empty" },
      });
    }
    delBuffer.length = 0;
  }

  for (const row of rows) {
    if (row.tone === "meta" || row.tone === "hunk") {
      flushDelBuffer();
      splitRows.push({
        kind: row.tone === "hunk" ? "hunk" : "meta",
        left: { line: null, text: row.text, marker: row.marker, tone: "empty" },
        right: { line: null, text: row.text, marker: row.marker, tone: "empty" },
      });
      continue;
    }
    if (row.tone === "del") {
      delBuffer.push(row);
      continue;
    }
    if (row.tone === "add") {
      if (delBuffer.length > 0) {
        const delRow = delBuffer.shift()!;
        splitRows.push({
          kind: "line",
          left: { line: delRow.oldLine, text: delRow.text, marker: delRow.marker, tone: "del" },
          right: { line: row.newLine, text: row.text, marker: row.marker, tone: "add" },
        });
      } else {
        splitRows.push({
          kind: "line",
          left: { line: null, text: "", marker: "", tone: "empty" },
          right: { line: row.newLine, text: row.text, marker: row.marker, tone: "add" },
        });
      }
      continue;
    }
    if (row.tone === "ctx") {
      flushDelBuffer();
      splitRows.push({
        kind: "line",
        left: { line: row.oldLine, text: row.text, marker: row.marker, tone: "ctx" },
        right: { line: row.newLine, text: row.text, marker: row.marker, tone: "ctx" },
      });
    }
  }

  flushDelBuffer();
  return splitRows;
}

export function toDiffRows(patch: string): DiffRow[] {
  if (!patch.trim()) return [];
  const rows: DiffRow[] = [];
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("@@")) {
      rows.push({ kind: "meta", left: line, right: line });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      rows.push({ kind: "meta", left: line, right: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", left: "", right: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", left: line.slice(1), right: "" });
      continue;
    }
    rows.push({
      kind: "ctx",
      left: line.startsWith(" ") ? line.slice(1) : line,
      right: line.startsWith(" ") ? line.slice(1) : line
    });
  }
  return rows;
}

export function getWorktreePatchStats(rows: SplitDiffRow[]): WorktreePatchStats {
  return {
    added: rows.filter((row) => row.right.tone === "add").length,
    deleted: rows.filter((row) => row.left.tone === "del").length,
    hunks: rows.filter((row) => row.kind === "hunk").length
  };
}

export function getWorktreeChangeStats(entries: GitWorktreeEntry[]): WorktreeChangeStats {
  return {
    total: entries.length,
    staged: entries.filter((entry) => entry.staged).length,
    unstaged: entries.filter((entry) => entry.unstaged || entry.untracked).length
  };
}

export function getDiscardableWorktreeEntryCount(entries: GitWorktreeEntry[]): number {
  return entries.filter((entry) => entry.staged || entry.unstaged || entry.untracked).length;
}

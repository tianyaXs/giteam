import type { GitBranchSummary, GitCommitSummary, GitGraphNode, GitLinkedWorktree } from "./types";

export type TopologyNodeKind = "repo" | "worktree" | "branch" | "commit";

export type TopologyNode = {
  id: string;
  kind: TopologyNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  meta: string;
  accent: string;
  accentSoft: string;
  border: string;
  branch?: string;
  sha?: string;
  path?: string;
  refs?: string[];
  isCurrent?: boolean;
  dirtyCount?: number;
  author?: string;
  date?: string;
  rank?: number;
};

type TopologyEdge = {
  id: string;
  from: string;
  to: string;
  color: string;
  dashed?: boolean;
};

type TopologySection = {
  id: string;
  label: string;
  hint: string;
  x: number;
  y: number;
  width: number;
};

export type TopologyGraphModel = {
  nodes: TopologyNode[];
  nodeById: Record<string, TopologyNode>;
  edges: TopologyEdge[];
  sections: TopologySection[];
  primaryNodeId: string;
  nearbyNodeIds: Record<string, boolean>;
  width: number;
  height: number;
};

export function parseRefs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const inner = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
  return inner.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3);
}

function branchFromRef(ref: string, branches: GitBranchSummary[]): string | null {
  const r = ref.trim();
  if (!r) return null;
  if (r.startsWith("tag:")) return null;
  if (r.includes("->")) {
    const rhs = r.split("->")[1]?.trim();
    if (rhs && branches.some((b) => b.name === rhs)) return rhs;
    return null;
  }
  if (branches.some((b) => b.name === r)) return r;
  return null;
}

function clampLabel(text: string, max = 14): string {
  const value = text.trim();
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, Math.max(1, max - 2))}..` : value;
}

export function pathLeaf(path: string): string {
  return path.split(/[\/]/).filter(Boolean).pop() || path.trim() || "workspace";
}

export function shortSha(value: string, size = 8): string {
  const text = value.trim();
  if (!text) return "-";
  return text.slice(0, size);
}

export function branchTone(branchName: string) {
  const branch = branchName.trim() || "unknown";
  const prefix = branch.split("/")[0]?.toLowerCase() || branch.toLowerCase();
  const preset: Record<string, { accent: string; soft: string; border: string }> = {
    main: { accent: "#3b82f6", soft: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.34)" },
    master: { accent: "#3b82f6", soft: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.34)" },
    feature: { accent: "#22c55e", soft: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.34)" },
    hotfix: { accent: "#ef4444", soft: "rgba(239,68,68,0.16)", border: "rgba(239,68,68,0.34)" },
    develop: { accent: "#a855f7", soft: "rgba(168,85,247,0.16)", border: "rgba(168,85,247,0.34)" },
    release: { accent: "#f59e0b", soft: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.34)" },
    fix: { accent: "#ec4899", soft: "rgba(236,72,153,0.16)", border: "rgba(236,72,153,0.34)" },
    chore: { accent: "#64748b", soft: "rgba(100,116,139,0.18)", border: "rgba(100,116,139,0.34)" },
    docs: { accent: "#0ea5e9", soft: "rgba(14,165,233,0.16)", border: "rgba(14,165,233,0.34)" },
    test: { accent: "#14b8a6", soft: "rgba(20,184,166,0.16)", border: "rgba(20,184,166,0.34)" },
    refactor: { accent: "#f97316", soft: "rgba(249,115,22,0.16)", border: "rgba(249,115,22,0.34)" }
  };
  if (preset[prefix]) return preset[prefix];
  const hue = Array.from(branch).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  return {
    accent: `hsl(${hue} 72% 56%)`,
    soft: `hsl(${hue} 72% 56% / 0.16)`,
    border: `hsl(${hue} 72% 56% / 0.34)`
  };
}

export function buildTopologyModel(input: {
  repoName: string;
  repoPath: string;
  currentBranch: string;
  branches: GitBranchSummary[];
  worktrees: GitLinkedWorktree[];
  branchCommits: GitCommitSummary[];
  commitGraph: GitGraphNode[];
  branchParentMap: Record<string, string>;
}): TopologyGraphModel {
  const branchNames = Array.from(new Set(input.branches.map((row) => row.name).filter(Boolean)));
  const currentBranch = input.currentBranch || branchNames.find((name) => name === "main") || branchNames[0] || "main";
  const normalizeBranchName = (name: string): string => name.replace(/^refs\/heads\//, "");
  const worktrees = input.worktrees
    .filter((wt) => wt.path.trim())
    .map((wt) => ({ ...wt, branch: normalizeBranchName(wt.branch || currentBranch) }));
  const currentWorktree = worktrees.find((wt) => wt.isCurrent)
    || worktrees.find((wt) => wt.path.trim() === input.repoPath.trim())
    || null;
  const workspaceBranchNames = new Set(worktrees.map((wt) => wt.branch).filter(Boolean));
  const graphCommits = input.commitGraph.filter((row) => !row.isConnector && !!row.sha);
  const branchHeadByName = new Map<string, string>();
  const parseAllRefs = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const inner = trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed;
    return inner.split(",").map((part) => part.trim()).filter(Boolean);
  };
  for (const row of graphCommits) {
    const refs = parseAllRefs(row.refs);
    for (const ref of refs) {
      const branch = branchFromRef(ref, input.branches);
      if (branch && !branchHeadByName.has(branch)) branchHeadByName.set(branch, row.sha);
    }
  }

  const currentWidth = 320;
  const currentHeight = 112;
  const workspaceWidth = 176;
  const workspaceHeight = 86;
  const branchWidth = 156;
  const branchHeight = 72;
  const colGap = 24;
  const rowGap = 24;
  const marginX = 92;
  const topY = 96;
  const sectionGap = 76;
  const currentWorkspace = currentWorktree || {
    path: input.repoPath,
    branch: currentBranch,
    head: branchHeadByName.get(currentBranch) || "",
    isCurrent: true,
    isMainWorktree: true,
    isDetached: false,
    clean: true,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    locked: "",
    prunable: ""
  };
  const activeWorkspaces = worktrees
    .filter((wt) => wt.path !== currentWorkspace.path)
    .sort((a, b) => Number(b.stagedCount + b.unstagedCount + b.untrackedCount > 0) - Number(a.stagedCount + a.unstagedCount + a.untrackedCount > 0) || a.branch.localeCompare(b.branch));
  const availableBranches = branchNames.filter((name) => !workspaceBranchNames.has(name)).sort((a, b) => a.localeCompare(b));
  const activeCols = Math.min(4, Math.max(1, activeWorkspaces.length));
  const branchCols = Math.min(5, Math.max(1, availableBranches.length));
  const boardWidth = Math.max(
    currentWidth,
    activeCols * workspaceWidth + (activeCols - 1) * colGap,
    branchCols * branchWidth + (branchCols - 1) * colGap
  );
  const sceneWidth = Math.max(1280, boardWidth + marginX * 2);
  const centerX = sceneWidth / 2;

  const nodes: TopologyNode[] = [];
  const nodeById: Record<string, TopologyNode> = {};
  const edges: TopologyEdge[] = [];
  const sections: TopologySection[] = [];
  const pushNode = (node: TopologyNode) => {
    nodes.push(node);
    nodeById[node.id] = node;
  };
  const workspaceMeta = (wt: GitLinkedWorktree, current = false): string => {
    const dirtyCount = wt.stagedCount + wt.unstagedCount + wt.untrackedCount;
    const flags = [wt.isMainWorktree ? "MAIN" : "WT", current ? "CURRENT" : "", dirtyCount > 0 ? `${dirtyCount} changes` : "clean"].filter(Boolean);
    return flags.join(" · ");
  };
  const makeWorkspaceNode = (wt: GitLinkedWorktree, x: number, y: number, width: number, height: number, current = false): TopologyNode => {
    const dirtyCount = wt.stagedCount + wt.unstagedCount + wt.untrackedCount;
    return {
      id: `worktree:${wt.path || wt.branch}`,
      kind: "worktree",
      x,
      y,
      width,
      height,
      label: clampLabel(wt.branch || pathLeaf(wt.path), current ? 22 : 14),
      meta: workspaceMeta(wt, current),
      accent: "#64748b",
      accentSoft: "rgba(100,116,139,0.12)",
      border: "rgba(100,116,139,0.30)",
      branch: wt.branch,
      isCurrent: current || wt.isCurrent,
      path: wt.path,
      sha: wt.head,
      dirtyCount,
      rank: 0
    };
  };

  const currentY = topY;
  sections.push({ id: "current", label: "Current Workspace", hint: "当前正在工作的目录", x: centerX - boardWidth / 2, y: currentY - 34, width: boardWidth });
  const currentNode = makeWorkspaceNode(currentWorkspace, centerX - currentWidth / 2, currentY, currentWidth, currentHeight, true);
  pushNode(currentNode);

  const activeY = currentY + currentHeight + sectionGap;
  sections.push({ id: "active", label: "Active Workspaces", hint: "已创建 worktree 的工作现场", x: centerX - boardWidth / 2, y: activeY - 34, width: boardWidth });
  activeWorkspaces.forEach((wt, index) => {
    const row = Math.floor(index / activeCols);
    const col = index % activeCols;
    const rowCount = index >= activeWorkspaces.length - activeCols ? Math.min(activeCols, activeWorkspaces.length - row * activeCols) : activeCols;
    const rowWidth = rowCount * workspaceWidth + (rowCount - 1) * colGap;
    const x = centerX - rowWidth / 2 + Math.min(col, rowCount - 1) * (workspaceWidth + colGap);
    const y = activeY + row * (workspaceHeight + rowGap);
    pushNode(makeWorkspaceNode(wt, x, y, workspaceWidth, workspaceHeight, false));
  });

  const activeRows = Math.max(1, Math.ceil(activeWorkspaces.length / activeCols));
  const branchY = activeY + activeRows * (workspaceHeight + rowGap) + sectionGap;
  sections.push({ id: "branches", label: "Available Branches", hint: "还没有激活为工作空间的分支", x: centerX - boardWidth / 2, y: branchY - 34, width: boardWidth });
  availableBranches.forEach((branchName, index) => {
    const row = Math.floor(index / branchCols);
    const col = index % branchCols;
    const rowCount = index >= availableBranches.length - branchCols ? Math.min(branchCols, availableBranches.length - row * branchCols) : branchCols;
    const rowWidth = rowCount * branchWidth + (rowCount - 1) * colGap;
    const x = centerX - rowWidth / 2 + Math.min(col, rowCount - 1) * (branchWidth + colGap);
    const y = branchY + row * (branchHeight + rowGap);
    const tone = branchTone(branchName);
    pushNode({
      id: `branch:${branchName}`,
      kind: "branch",
      x,
      y,
      width: branchWidth,
      height: branchHeight,
      label: clampLabel(branchName, 12),
      meta: "BR only",
      accent: tone.accent,
      accentSoft: tone.soft,
      border: tone.border,
      branch: branchName,
      isCurrent: false,
      sha: branchHeadByName.get(branchName),
      rank: index + 1
    });
  });

  const primaryNodeId = currentNode.id;
  const nearbyNodeIds = Object.fromEntries(nodes.map((node) => [node.id, true]));
  const maxNodeY = Math.max(...nodes.map((n) => n.y + n.height), branchY + branchHeight);
  const height = Math.max(400, maxNodeY + 80);
  return { nodes, nodeById, edges, sections, primaryNodeId, nearbyNodeIds, width: sceneWidth, height };
}

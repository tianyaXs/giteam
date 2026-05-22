import type { GitBranchSummary, GitCommitSummary, GitGraphNode, GitLinkedWorktree, GitWorktreeOverview } from "./types";
import { normalizeWorkspacePath } from "./workspaceBindings";
import { branchTone } from "./worktreeTopology";

export type GitTreeTopologyViewModel = {
  branchNames: string[];
  currentBranchName: string;
  activeTreeBranch: string;
  activeTone: ReturnType<typeof branchTone>;
  activeBranchCommits: GitCommitSummary[];
  activeBranchWorktrees: GitLinkedWorktree[];
  activeBranchIsCurrent: boolean;
  selectedTreeCommit: GitCommitSummary | null;
  localRootBranches: string[];
  localChildrenByParent: Map<string, string[]>;
  remoteRootBranches: string[];
  remoteChildrenByParent: Map<string, string[]>;
  branchHeadByName: Map<string, string>;
  branchCommitCount: (branchName: string) => number;
  isRemoteBranch: (branchName: string) => boolean;
  isCurrentBranch: (branchName: string) => boolean;
  getBranchWorktrees: (branchName: string) => GitLinkedWorktree[];
};

export function buildGitTreeTopologyViewModel(input: {
  linkedWorktrees: GitLinkedWorktree[];
  branchParentMap: Record<string, string>;
  branches: GitBranchSummary[];
  commitGraph: GitGraphNode[];
  worktreeOverview: GitWorktreeOverview;
  selectedBranch: string;
  topologySelectionId: string;
  worktreeParentMap: Record<string, string>;
  commits: GitCommitSummary[];
  selectedCommit: string;
}): GitTreeTopologyViewModel {
  const worktreeOnlyBranches = new Set(
    input.linkedWorktrees
      .filter((worktree) => !worktree.isMainWorktree && input.branchParentMap[worktree.branch])
      .map((worktree) => worktree.branch)
  );
  const allBranchNames = new Set<string>();
  const isGitTreeBranch = (name: string) => {
    const normalized = name.trim().toLowerCase();
    if (normalized.length === 0 || normalized.includes("worktree") || normalized.includes(".worktrees")) return false;
    const info = input.branches.find((branch) => branch.name === name);
    return !(info?.isRemote && !name.includes("/"));
  };

  input.branches.forEach((branch) => {
    if (isGitTreeBranch(branch.name) && !worktreeOnlyBranches.has(branch.name)) {
      allBranchNames.add(branch.name);
    }
  });
  Object.keys(input.branchParentMap).forEach((branch) => {
    if (isGitTreeBranch(branch) && !worktreeOnlyBranches.has(branch)) {
      allBranchNames.add(branch);
    }
  });
  Object.values(input.branchParentMap).forEach((branch) => {
    if (isGitTreeBranch(branch)) {
      allBranchNames.add(branch);
    }
  });

  const defaultMain = Array.from(allBranchNames).find((branch) => branch === "main" || branch === "master") || "";
  const isRemoteBranch = (branchName: string) => branchName.includes("/") && !branchName.startsWith("worktree/");
  const localParentMap: Record<string, string> = {};
  const remoteParentMap: Record<string, string> = {};
  Object.entries(input.branchParentMap).forEach(([child, parent]) => {
    if (!allBranchNames.has(child) || !allBranchNames.has(parent)) return;
    if (isRemoteBranch(child)) {
      remoteParentMap[child] = parent;
    } else {
      localParentMap[child] = parent;
    }
  });

  const branchHeadByName = new Map<string, string>();
  const shaToParents = new Map<string, string[]>();
  input.commitGraph.forEach((node) => {
    if (node.isConnector || !node.sha) return;
    shaToParents.set(node.sha, node.parents || []);
    const refsText = node.refs.trim();
    if (!refsText) return;
    const inner = refsText.startsWith("(") && refsText.endsWith(")") ? refsText.slice(1, -1) : refsText;
    const refs = inner.split(",").map((part) => part.trim()).filter(Boolean);

    refs.forEach((ref) => {
      if (ref.startsWith("tag:")) return;
      let branchName: string | null = null;
      if (ref.includes("->")) {
        const rhs = ref.split("->")[1]?.trim();
        if (rhs && allBranchNames.has(rhs)) branchName = rhs;
      } else if (allBranchNames.has(ref)) {
        branchName = ref;
      }
      if (branchName && !branchHeadByName.has(branchName)) {
        branchHeadByName.set(branchName, node.sha);
      }
    });
  });

  const ancestorDistance = (targetSha: string, querySha: string): number => {
    const queue: Array<{ sha: string; dist: number }> = [{ sha: querySha, dist: 0 }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const { sha, dist } = queue.shift()!;
      if (sha === targetSha) return dist;
      if (visited.has(sha)) continue;
      visited.add(sha);
      const parents = shaToParents.get(sha) || [];
      parents.forEach((parent) => {
        if (!visited.has(parent)) {
          queue.push({ sha: parent, dist: dist + 1 });
        }
      });
    }
    return Infinity;
  };

  const branchNames = Array.from(allBranchNames);
  const actualCurrentBranchName = input.branches.find((branch) => branch.isCurrent)?.name
    || (input.worktreeOverview.branch && input.worktreeOverview.branch !== "HEAD" && input.worktreeOverview.branch !== "(detached)" ? input.worktreeOverview.branch : "");
  const currentBranchName = actualCurrentBranchName;
  const sortBranches = (items: string[]) => items.sort((a, b) => {
    if (a === defaultMain) return -1;
    if (b === defaultMain) return 1;
    return a.localeCompare(b);
  });

  branchNames.forEach((branch) => {
    if (localParentMap[branch] || branch === defaultMain || isRemoteBranch(branch)) return;
    const branchSha = branchHeadByName.get(branch);
    if (!branchSha) return;

    const candidates: Array<{ name: string; distance: number }> = [];
    branchNames.forEach((candidate) => {
      if (candidate === branch || isRemoteBranch(candidate)) return;
      const candidateSha = branchHeadByName.get(candidate);
      if (!candidateSha) return;

      const distance = ancestorDistance(candidateSha, branchSha);
      if (distance < Infinity && distance > 0) {
        candidates.push({ name: candidate, distance });
      }
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.distance - b.distance);
      localParentMap[branch] = candidates[0].name;
      return;
    }

    if (!defaultMain) return;
    const prefix = branch.split("/")[0]?.toLowerCase() || "";
    const developBranch = branchNames.find((name) => name === "develop" || name === "dev");
    const isFeatureLike = ["feature", "hotfix", "fix", "release", "chore", "docs", "test", "refactor", "style"].includes(prefix);
    if (branch === "develop" || branch === "dev") {
      localParentMap[branch] = defaultMain;
    } else if (isFeatureLike && developBranch) {
      localParentMap[branch] = developBranch;
    } else {
      localParentMap[branch] = defaultMain;
    }
  });

  const localBranchNames = branchNames.filter((branch) => !isRemoteBranch(branch));
  const localRootBranches = buildRootBranches(localBranchNames, localParentMap, sortBranches);
  const localChildrenByParent = buildChildrenByParent(localBranchNames, localParentMap, sortBranches);
  const remoteBranchNames = branchNames.filter((branch) => isRemoteBranch(branch));
  const remoteRootBranches = buildRootBranches(remoteBranchNames, remoteParentMap, sortBranches);
  const remoteChildrenByParent = buildChildrenByParent(remoteBranchNames, remoteParentMap, sortBranches);
  const graphCommitBySha = new Map<string, GitGraphNode>();
  input.commitGraph.forEach((node) => {
    if (!node.isConnector && node.sha) graphCommitBySha.set(node.sha, node);
  });

  const commitsFromGraph = (branchName: string, limit = 40): GitCommitSummary[] => {
    const head = branchHeadByName.get(branchName);
    if (!head || !graphCommitBySha.has(head)) return [];
    const rows: GitCommitSummary[] = [];
    const visited = new Set<string>();
    let cursor = head;
    while (cursor && graphCommitBySha.has(cursor) && rows.length < limit) {
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const row = graphCommitBySha.get(cursor)!;
      rows.push({ sha: row.sha, subject: row.subject, author: row.author, date: row.date });
      cursor = row.parents[0] || "";
    }
    return rows;
  };

  const selectedTreeBranch = input.topologySelectionId.startsWith("worktree:")
    ? input.worktreeParentMap[normalizeWorkspacePath(input.topologySelectionId.slice(9))]
      || input.selectedBranch
      || actualCurrentBranchName
      || defaultMain
      || localRootBranches[0]
      || ""
    : input.topologySelectionId.startsWith("branch:")
      ? input.topologySelectionId.slice(7)
      : input.selectedBranch || actualCurrentBranchName || defaultMain || localRootBranches[0] || "";
  const activeTreeBranch = allBranchNames.has(selectedTreeBranch) ? selectedTreeBranch : defaultMain || localRootBranches[0] || "";
  const activeBranchSummary = input.branches.find((branch) => branch.name === activeTreeBranch);
  const activeBranchCommits = activeTreeBranch === input.selectedBranch || activeTreeBranch === currentBranchName
    ? input.commits
    : commitsFromGraph(activeTreeBranch);
  const selectedTreeCommit = input.topologySelectionId.startsWith("commit:")
    ? activeBranchCommits.find((commit) => commit.sha === input.selectedCommit) || null
    : null;
  const worktreeParentBranch = (worktree: GitLinkedWorktree) => {
    const pathParent = input.worktreeParentMap[normalizeWorkspacePath(worktree.path)] || "";
    if (pathParent) return pathParent;
    return worktree.branch;
  };
  const getBranchWorktrees = (branchName: string) => input.linkedWorktrees.filter((worktree) => (
    !worktree.isMainWorktree && worktreeParentBranch(worktree) === branchName
  ));
  const activeBranchWorktrees = getBranchWorktrees(activeTreeBranch);

  return {
    branchNames,
    currentBranchName,
    activeTreeBranch,
    activeTone: branchTone(activeTreeBranch),
    activeBranchCommits,
    activeBranchWorktrees,
    activeBranchIsCurrent: activeBranchSummary?.isCurrent || input.worktreeOverview.branch === activeTreeBranch,
    selectedTreeCommit,
    localRootBranches,
    localChildrenByParent,
    remoteRootBranches,
    remoteChildrenByParent,
    branchHeadByName,
    branchCommitCount: (branchName) => commitsFromGraph(branchName, 20).length,
    isRemoteBranch,
    isCurrentBranch: (branchName) => branchName === currentBranchName || !!input.branches.find((branch) => branch.name === branchName)?.isCurrent,
    getBranchWorktrees
  };
}

function buildRootBranches(
  branchNames: string[],
  parentMap: Record<string, string>,
  sortBranches: (items: string[]) => string[]
) {
  const roots: string[] = [];
  branchNames.forEach((branch) => {
    const parent = parentMap[branch];
    if (!parent || !branchNames.includes(parent)) {
      roots.push(branch);
    }
  });
  if (roots.length === 0 && branchNames.length > 0) {
    roots.push(branchNames[0]);
  }
  sortBranches(roots);
  return roots;
}

function buildChildrenByParent(
  branchNames: string[],
  parentMap: Record<string, string>,
  sortBranches: (items: string[]) => string[]
) {
  const childrenByParent = new Map<string, string[]>();
  branchNames.forEach((branch) => {
    const parent = parentMap[branch];
    if (!parent || !branchNames.includes(parent)) return;
    const list = childrenByParent.get(parent) || [];
    list.push(branch);
    childrenByParent.set(parent, list);
  });
  childrenByParent.forEach((list) => sortBranches(list));
  return childrenByParent;
}

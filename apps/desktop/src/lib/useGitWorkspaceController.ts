import type { Dispatch, SetStateAction } from "react";
import {
  gitCommit,
  createGitBranch,
  createGitDetachedWorktree,
  createGitWorktreeFromBranch,
  deleteGitBranch,
  getBranchCommits,
  getCommitGraph,
  getGitUserIdentity,
  getGitWorktreeFileContent,
  getGitWorktreeFilePatch,
  getGitWorktreeList,
  getGitWorktreeOverview,
  getLocalBranches,
  gitCheckoutBranch,
  gitCheckoutRemoteBranch,
  gitCherryPickCommit,
  gitDiscardChanges,
  gitPull,
  gitPush,
  gitRevertCommit,
  gitStageFile,
  gitUnstageFile,
  removeGitWorktree
} from "./gitAdapter";
import { getEntireStatusDetailed } from "./entireAdapter";
import { normalizeWorkspacePath, writeBranchParentMap } from "./workspaceBindings";
import { shortSha, type TopologyGraphModel } from "./worktreeTopology";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitGraphNode,
  GitLinkedWorktree,
  GitUserIdentity,
  GitWorktreeEntry,
  GitWorktreeFileContent,
  GitWorktreeOverview,
  RepositoryEntry
} from "./types";
import { loadReviewActions, loadReviewRecords } from "./storage";

type SetState<T> = Dispatch<SetStateAction<T>>;
type GitOperation = "commit" | "push" | "sync" | "commitPush" | "commitSync" | "cherryPick" | "revert" | null;
type DetailTab = "diff" | "context" | "findings";
type TopologyCreateMode = "branch" | "worktree";
type CommitContextMenuState = { x: number; y: number; sha: string; branch?: string; subject?: string } | null;
type TopologyContextMenuState = { x: number; y: number; nodeId: string } | null;
type TopologyCreatingNodeState = {
  parentId: string;
  name: string;
  x: number;
  y: number;
  mode: TopologyCreateMode;
} | null;

type GitWorkspaceControllerOptions = {
  selectedRepo: RepositoryEntry | null;
  selectedBranch: string;
  selectedWorktreeFile: string;
  linkedWorktrees: GitLinkedWorktree[];
  branches: GitBranchSummary[];
  repoPath: string;
  gitPanePath: string;
  worktreeOverview: GitWorktreeOverview;
  commitMessage: string;
  committing: boolean;
  pushing: boolean;
  topologyModel: TopologyGraphModel;
  topologySelectionId: string;
  topologyCreateSourceNodeId: string;
  topologyCreateMode: TopologyCreateMode;
  topologyCreateBranchName: string;
  topologyCreateTargetPath: string;
  topologyCreatingNode: TopologyCreatingNodeState;
  commitContextMenu: CommitContextMenuState;
  gitPanePathRef: { current: string };
  emptyWorktree: GitWorktreeOverview;
  emptyWorktreeFileContent: GitWorktreeFileContent;
  emptyGitIdentity: GitUserIdentity;
  ensureRepoSelected: () => boolean;
  ensureGitPaneSelected: () => boolean;
  rememberBranchParent: (childBranch: string, parentBranch: string) => void;
  forgetBranchParent: (branchName: string) => void;
  rememberWorktreeParent: (worktreePath: string, parentBranch: string) => void;
  unbindWorkspaceAgent: (workspacePathInput: string) => void;
  appendOpencodeDebugLog: (text: string) => void;
  focusCommitMessageInput: () => void;
  setSelectedRepo: SetState<RepositoryEntry | null>;
  setMessage: SetState<string>;
  setError: SetState<string>;
  setBusy: SetState<boolean>;
  setOverlayBusy: SetState<boolean>;
  setWorktreeOverview: SetState<GitWorktreeOverview>;
  setLinkedWorktrees: SetState<GitLinkedWorktree[]>;
  setBranches: SetState<GitBranchSummary[]>;
  setCommitGraph: SetState<GitGraphNode[]>;
  setSelectedBranch: SetState<string>;
  setCommits: SetState<GitCommitSummary[]>;
  setSelectedCommit: SetState<string>;
  setTopologyContextMenu: SetState<TopologyContextMenuState>;
  setTopologySelectionId: SetState<string>;
  setCommitContextMenu: SetState<CommitContextMenuState>;
  setGitOperation: SetState<GitOperation>;
  setDetailTab: SetState<DetailTab>;
  setTopologyCreateSourceNodeId: SetState<string>;
  setTopologyCreateMode: SetState<TopologyCreateMode>;
  setTopologyCreateBranchName: SetState<string>;
  setTopologyCreateTargetPath: SetState<string>;
  setTopologyCreatingNode: SetState<TopologyCreatingNodeState>;
  setShowTopologyCreateDialog: SetState<boolean>;
  setCreatingTopologyNode: SetState<boolean>;
  setTopologyInspectNodeId: SetState<string>;
  setShowTopologyInspectDialog: SetState<boolean>;
  setRemovingTopologyNode: SetState<boolean>;
  setStatusText: SetState<string>;
  setRecords: SetState<import("./types").ReviewRecord[]>;
  setActions: SetState<import("./types").ReviewAction[]>;
  setCommitMessage: SetState<string>;
  setCommitting: SetState<boolean>;
  setPushing: SetState<boolean>;
  setShowCommitActionMenu: SetState<boolean>;
  setSelectedWorktreeFile: SetState<string>;
  setSelectedWorktreePatch: SetState<string>;
  setSelectedWorktreeContent: SetState<GitWorktreeFileContent>;
  setGitUserIdentity: SetState<GitUserIdentity>;
  setDiscardingFile: SetState<string>;
  setStagingFile: SetState<string>;
  setUnstagingFile: SetState<string>;
  setShowDiscardAllConfirm: SetState<boolean>;
  setShowRemoveWorktreeConfirm: SetState<boolean>;
  setDiscardingAll: SetState<boolean>;
  setRemovingWorktreePath: SetState<string>;
  setWorktreeContextMenu: SetState<{ x: number; y: number; path: string } | null>;
  setWorktreeToRemove: SetState<string>;
  setExpandedWorktreeDirs: SetState<string[]>;
  setBranchParentMap: SetState<Record<string, string>>;
};

export function useGitWorkspaceController(options: GitWorkspaceControllerOptions) {
  const {
    selectedRepo,
    selectedBranch,
    selectedWorktreeFile,
    linkedWorktrees,
    branches,
    repoPath,
    gitPanePath,
    worktreeOverview,
    commitMessage,
    committing,
    pushing,
    topologyModel,
    topologySelectionId,
    topologyCreateSourceNodeId,
    topologyCreateMode,
    topologyCreateBranchName,
    topologyCreateTargetPath,
    topologyCreatingNode,
    commitContextMenu,
    gitPanePathRef,
    emptyWorktree,
    emptyWorktreeFileContent,
    emptyGitIdentity,
    ensureRepoSelected,
    ensureGitPaneSelected,
    rememberBranchParent,
    forgetBranchParent,
    rememberWorktreeParent,
    unbindWorkspaceAgent,
    appendOpencodeDebugLog,
    focusCommitMessageInput,
    setSelectedRepo,
    setMessage,
    setError,
    setBusy,
    setOverlayBusy,
    setWorktreeOverview,
    setLinkedWorktrees,
    setBranches,
    setCommitGraph,
    setSelectedBranch,
    setCommits,
    setSelectedCommit,
    setTopologyContextMenu,
    setTopologySelectionId,
    setCommitContextMenu,
    setGitOperation,
    setDetailTab,
    setTopologyCreateSourceNodeId,
    setTopologyCreateMode,
    setTopologyCreateBranchName,
    setTopologyCreateTargetPath,
    setTopologyCreatingNode,
    setShowTopologyCreateDialog,
    setCreatingTopologyNode,
    setTopologyInspectNodeId,
    setShowTopologyInspectDialog,
    setRemovingTopologyNode,
    setStatusText,
    setRecords,
    setActions,
    setCommitMessage,
    setCommitting,
    setPushing,
    setShowCommitActionMenu,
    setSelectedWorktreeFile,
    setSelectedWorktreePatch,
    setSelectedWorktreeContent,
    setGitUserIdentity,
    setDiscardingFile,
    setStagingFile,
    setUnstagingFile,
    setShowDiscardAllConfirm,
    setShowRemoveWorktreeConfirm,
    setDiscardingAll,
    setRemovingWorktreePath,
    setWorktreeContextMenu,
    setWorktreeToRemove,
    setExpandedWorktreeDirs,
    setBranchParentMap
  } = options;

  function currentTopologyBaseBranch(): string {
    return worktreeOverview.branch || selectedBranch || branches.find((item) => item.isCurrent)?.name || "";
  }

  function topologyCreateSource(nodeId?: string): { startPoint: string; baseBranch: string } {
    if (nodeId?.startsWith("branch:")) {
      const branch = nodeId.slice(7);
      return { startPoint: branch, baseBranch: branch || currentTopologyBaseBranch() };
    }
    if (nodeId?.startsWith("commit:")) {
      const parts = nodeId.split(":");
      const branch = parts[1] || currentTopologyBaseBranch();
      const sha = parts[2] || "";
      return { startPoint: sha || branch, baseBranch: branch };
    }
    const node = topologyModel.nodeById[nodeId || topologySelectionId || topologyModel.primaryNodeId];
    if (!node) {
      return { startPoint: "", baseBranch: currentTopologyBaseBranch() };
    }
    if (node.kind === "commit") {
      return {
        startPoint: node.sha || "",
        baseBranch: node.branch || currentTopologyBaseBranch() || shortSha(node.sha || "", 7)
      };
    }
    if (node.kind === "branch" || node.kind === "worktree") {
      return {
        startPoint: node.branch || node.sha || "",
        baseBranch: node.branch || currentTopologyBaseBranch()
      };
    }
    return { startPoint: currentTopologyBaseBranch(), baseBranch: currentTopologyBaseBranch() };
  }

  function suggestedTopologyPath(baseBranch: string, identifier?: string): string {
    const mainWorktree = linkedWorktrees.find((wt) => wt.isMainWorktree)?.path || "";
    const currentPath = (mainWorktree || repoPath || selectedRepo?.path || "").trim();
    if (!currentPath) return "";
    const prefix = baseBranch.trim().replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\/+$/g, "");
    const suffix = (identifier || "").trim().replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/\/+$/g, "");
    const combined = suffix ? `${prefix}-${suffix}` : prefix;
    const segs = currentPath.split("/").filter(Boolean);
    if (segs.length === 0) return "";
    const repoLeaf = segs[segs.length - 1] || "repo";
    const parent = currentPath.slice(0, currentPath.length - repoLeaf.length).replace(/\/$/, "");
    return `${parent}/${repoLeaf}.worktrees/${combined}`;
  }

  function commitWorktreeBranchName(commit: GitCommitSummary): string {
    const subjectSlug = (commit.subject || "commit")
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);
    return `worktree/${subjectSlug || "commit"}-${shortSha(commit.sha, 7)}`;
  }

  async function refreshBranchesAndCommits() {
    if (!ensureGitPaneSelected()) return;
    const requestRepoPath = gitPanePath;
    setError("");
    setMessage("加载分支与提交...");
    try {
      const branchList = await getLocalBranches(gitPanePath);
      const graphRows = await getCommitGraph(gitPanePath, 600);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setBranches(branchList);
      setCommitGraph(graphRows);
      setBranchParentMap((prev) => {
        const cleaned = Object.fromEntries(
          Object.entries(prev).filter(([child, parent]) => {
            if (!child.trim() || !parent.trim()) return false;
            const childExists = branchList.some((b) => b.name === child) || Object.prototype.hasOwnProperty.call(prev, child);
            const parentExists = branchList.some((b) => b.name === parent);
            return childExists && parentExists;
          })
        );
        if (Object.keys(cleaned).length !== Object.keys(prev).length) {
          writeBranchParentMap(cleaned);
        }
        return cleaned;
      });
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const target = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(target);
      if (!target) {
        setCommits([]);
        setSelectedCommit("");
        setMessage("未找到可用本地分支");
        return;
      }
      const rows = await getBranchCommits(gitPanePath, target, 80);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setCommits(rows);
      setSelectedCommit(rows[0]?.sha ?? "");
      setMessage(rows.length > 0 ? "分支与提交已更新" : `分支 ${target} 暂无提交可显示`);
    } catch (error) {
      if (gitPanePathRef.current !== requestRepoPath) return;
      setError(String(error));
      setBranches([]);
      setCommitGraph([]);
      setCommits([]);
      setSelectedBranch("");
      setSelectedCommit("");
      setBranchParentMap({});
      setMessage("加载分支/提交失败");
    }
  }

  async function refreshWorktreeData(preferredFile?: string) {
    if (!ensureGitPaneSelected()) return;
    const requestRepoPath = gitPanePath;
    try {
      const [overview, worktrees] = await Promise.all([
        getGitWorktreeOverview(gitPanePath),
        getGitWorktreeList(gitPanePath)
      ]);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setWorktreeOverview(overview);
      setLinkedWorktrees(worktrees);
      const target = preferredFile && overview.entries.some((entry) => entry.path === preferredFile)
        ? preferredFile
        : overview.entries[0]?.path || "";
      setSelectedWorktreeFile(target);
      if (!target) {
        setSelectedWorktreePatch(overview.clean ? "Working tree is clean." : "No patch available.");
        setSelectedWorktreeContent(emptyWorktreeFileContent);
        return;
      }
      const [patch, content] = await Promise.all([
        getGitWorktreeFilePatch(gitPanePath, target),
        getGitWorktreeFileContent(gitPanePath, target)
      ]);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setSelectedWorktreePatch(patch);
      setSelectedWorktreeContent(content);
    } catch (error) {
      if (gitPanePathRef.current !== requestRepoPath) return;
      setError(String(error));
      setWorktreeOverview(emptyWorktree);
      setLinkedWorktrees([]);
      setSelectedWorktreeFile("");
      setSelectedWorktreePatch("");
    }
  }

  async function refreshGitUserIdentity() {
    if (!ensureGitPaneSelected()) return;
    const requestRepoPath = gitPanePath;
    try {
      const identity = await getGitUserIdentity(gitPanePath);
      if (gitPanePathRef.current !== requestRepoPath) return;
      setGitUserIdentity(identity);
    } catch {
      if (gitPanePathRef.current !== requestRepoPath) return;
      setGitUserIdentity(emptyGitIdentity);
    }
  }

  async function refreshSelectedWorktreePatch(filePath: string) {
    if (!ensureRepoSelected() || !filePath) return;
    setSelectedWorktreeFile(filePath);
    try {
      const [patch, content] = await Promise.all([
        getGitWorktreeFilePatch(repoPath, filePath),
        getGitWorktreeFileContent(repoPath, filePath)
      ]);
      setSelectedWorktreePatch(patch);
      setSelectedWorktreeContent(content);
    } catch (error) {
      setError(String(error));
      setSelectedWorktreePatch("");
      setSelectedWorktreeContent(emptyWorktreeFileContent);
    }
  }

  async function activateLinkedWorktree(path: string) {
    setTopologyContextMenu(null);
    const target = path.trim();
    if (!target || !selectedRepo) return;
    setSelectedRepo({ ...selectedRepo, path: target });
    setMessage(`已切换到 worktree: ${target}`);
    try {
      const [overview, worktrees, branchList, graphRows] = await Promise.all([
        getGitWorktreeOverview(target),
        getGitWorktreeList(target),
        getLocalBranches(target),
        getCommitGraph(target, 600)
      ]);
      setWorktreeOverview(overview);
      setLinkedWorktrees(worktrees);
      setBranches(branchList);
      setCommitGraph(graphRows);
      const current = branchList.find((b) => b.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const targetBranch = branchList.some((b) => b.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(targetBranch);
      if (targetBranch) {
        const rows = await getBranchCommits(target, targetBranch, 80);
        setCommits(rows);
        setSelectedCommit(rows[0]?.sha ?? "");
      }
    } catch (error) {
      setError(String(error));
      setMessage(`切换 worktree 失败: ${target}`);
    }
  }

  async function checkoutBranchFromTopology(branchName: string) {
    if (!ensureRepoSelected()) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`检出分支: ${branchName}...`);
    try {
      const worktree = linkedWorktrees.find((wt) => wt.branch === branchName);
      if (worktree) {
        await activateLinkedWorktree(worktree.path);
        setMessage(`已切换到 worktree 分支: ${branchName}`);
      } else {
        await gitCheckoutBranch(repoPath, branchName);
        setSelectedBranch(branchName);
        await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
        setMessage(`已检出分支: ${branchName}`);
      }
    } catch (error) {
      setError(String(error));
      setMessage(`检出失败: ${branchName}`);
    } finally {
      setBusy(false);
    }
  }

  async function checkoutRemoteBranchFromTopology(remoteBranch: string) {
    if (!ensureRepoSelected()) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    const localName = remoteBranch.split("/").slice(1).join("/");
    setMessage(`创建本地分支: ${localName} from ${remoteBranch}...`);
    try {
      await gitCheckoutRemoteBranch(repoPath, remoteBranch, localName);
      setSelectedBranch(localName);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
      setMessage(`已创建并检出分支: ${localName}`);
    } catch (error) {
      setError(String(error));
      setMessage(`创建分支失败: ${localName}`);
    } finally {
      setBusy(false);
    }
  }

  async function activateBranchWorkspace(branchName: string) {
    if (!ensureRepoSelected()) return;
    const branch = branchName.trim();
    if (!branch) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`激活工作空间: ${branch}...`);
    try {
      const linked = linkedWorktrees.find((wt) => wt.branch === branch && !wt.isMainWorktree);
      if (linked) {
        await activateLinkedWorktree(linked.path);
        setMessage(`已打开工作空间: ${branch}`);
        return;
      }
      const main = linkedWorktrees.find((wt) => wt.branch === branch && wt.isMainWorktree);
      if (main) {
        setMessage(`分支 ${branch} 已在主工作区中`);
        return;
      }
      if (!branches.some((b) => b.name === branch)) {
        throw new Error(`分支 "${branch}" 不存在`);
      }
      const targetPath = suggestedTopologyPath(branch);
      const created = await createGitWorktreeFromBranch(repoPath, branch, targetPath || undefined);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
      setTopologySelectionId(`worktree:${created.path}`);
      setMessage(`已激活工作空间: ${branch}`);
    } catch (error) {
      setError(String(error));
      setMessage(`激活工作空间失败: ${branch}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBranchFromTopology(branchName: string) {
    if (!ensureRepoSelected()) return;
    const branch = branchName.trim();
    if (!branch) return;
    setTopologyContextMenu(null);
    setBusy(true);
    setError("");
    setMessage(`删除分支: ${branch}...`);
    try {
      const isCurrent = branches.some((b) => b.name === branch && b.isCurrent) || worktreeOverview.branch === branch;
      if (isCurrent) {
        throw new Error("不能删除当前分支");
      }
      if (linkedWorktrees.some((wt) => wt.branch === branch)) {
        throw new Error("该分支仍有关联工作空间，请先移除工作空间");
      }
      await deleteGitBranch(repoPath, branch);
      forgetBranchParent(branch);
      await refreshBranchesAndCommits();
      await refreshWorktreeData(selectedWorktreeFile);
      setTopologySelectionId(topologyModel.primaryNodeId);
      setMessage(`已删除分支: ${branch}`);
    } catch (error) {
      const text = String(error);
      setError(text);
      setMessage(`删除分支失败: ${text}`);
    } finally {
      setBusy(false);
    }
  }

  function inspectCommitFromTopology(sha: string) {
    setTopologyContextMenu(null);
    setCommitContextMenu(null);
    setSelectedCommit(sha);
    setDetailTab("context");
    setMessage(`查看 Entire agent 上下文: ${sha.slice(0, 8)}`);
  }

  async function applyCommitFromContextMenu(action: "cherryPick" | "revert") {
    if (!ensureRepoSelected() || !commitContextMenu?.sha) return;
    const sha = commitContextMenu.sha;
    const label = shortSha(sha, 8);
    const isRevert = action === "revert";
    const ok = window.confirm(
      isRevert
        ? `确定要 revert ${label} 吗？\n\n这会在当前分支创建一个反向提交。`
        : `确定要 cherry-pick ${label} 到当前分支吗？\n\n如果有冲突，需要手动解决。`
    );
    if (!ok) return;
    setCommitContextMenu(null);
    setBusy(true);
    setGitOperation(action);
    setError("");
    setMessage(isRevert ? `正在 revert: ${label}...` : `正在 cherry-pick: ${label}...`);
    try {
      const result = isRevert ? await gitRevertCommit(repoPath, sha) : await gitCherryPickCommit(repoPath, sha);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
      setSelectedCommit(sha);
      setMessage(isRevert ? `已 revert: ${label}` : `已 cherry-pick: ${label}`);
      appendOpencodeDebugLog(`git.${isRevert ? "revert" : "cherry-pick"} ${result.trim() || label}`);
    } catch (error) {
      const text = String(error);
      setError(text);
      setMessage(isRevert ? `Revert 失败: ${label}` : `Cherry-pick 失败: ${label}`);
      await refreshWorktreeData(selectedWorktreeFile).catch(() => undefined);
    } finally {
      setBusy(false);
      setGitOperation(null);
    }
  }

  function openCommitWorktreeDialog(commit: GitCommitSummary, branchName?: string) {
    if (!ensureRepoSelected()) return;
    const branch = branchName || selectedBranch || worktreeOverview.branch || currentTopologyBaseBranch();
    const sourceId = `commit:${branch}:${commit.sha}`;
    const name = commitWorktreeBranchName(commit);
    setCommitContextMenu(null);
    setTopologyContextMenu(null);
    setTopologySelectionId(sourceId);
    setTopologyCreateSourceNodeId(sourceId);
    setTopologyCreateMode("worktree");
    setTopologyCreateBranchName(name);
    setTopologyCreateTargetPath(suggestedTopologyPath(branch || shortSha(commit.sha, 7), name));
    setTopologyCreatingNode(null);
    setShowTopologyCreateDialog(true);
  }

  function openTopologyCreateDialog(mode: TopologyCreateMode, nodeId?: string) {
    if (!ensureRepoSelected()) return;
    const sourceId = nodeId || topologySelectionId || topologyModel.primaryNodeId;
    if (sourceId.startsWith("branch:")) {
      const baseBranch = sourceId.slice(7);
      setTopologyContextMenu(null);
      setTopologySelectionId(sourceId);
      setTopologyCreateSourceNodeId(sourceId);
      setTopologyCreateMode(mode);
      setTopologyCreateBranchName("");
      setTopologyCreateTargetPath(mode === "worktree" && baseBranch ? suggestedTopologyPath(baseBranch) : "");
      setTopologyCreatingNode(null);
      setShowTopologyCreateDialog(true);
      return;
    }
    if (sourceId.startsWith("commit:")) {
      const { baseBranch, startPoint } = topologyCreateSource(sourceId);
      setTopologyContextMenu(null);
      setTopologySelectionId(sourceId);
      setTopologyCreateSourceNodeId(sourceId);
      setTopologyCreateMode(mode);
      setTopologyCreateBranchName(mode === "worktree" ? `worktree/${shortSha(startPoint, 7)}` : "");
      setTopologyCreateTargetPath(mode === "worktree" ? suggestedTopologyPath(baseBranch || shortSha(startPoint, 7), shortSha(startPoint, 7)) : "");
      setTopologyCreatingNode(null);
      setShowTopologyCreateDialog(true);
      return;
    }
    const parentNode = topologyModel.nodeById[sourceId];
    if (!parentNode) {
      setError("未找到当前节点，无法创建");
      return;
    }
    setTopologyContextMenu(null);
    setTopologySelectionId(sourceId);
    setTopologyCreateSourceNodeId(sourceId);
    setTopologyCreateMode(mode);
    setTopologyCreateBranchName("");
    const baseBranch = parentNode.branch || currentTopologyBaseBranch();
    setTopologyCreateTargetPath(mode === "worktree" && baseBranch ? suggestedTopologyPath(baseBranch) : "");
    setTopologyCreatingNode(null);
    setShowTopologyCreateDialog(true);
  }

  async function submitTopologyCreateDialog() {
    if (!ensureRepoSelected()) return;
    const sourceId = topologyCreateSourceNodeId || topologyCreatingNode?.parentId || topologySelectionId || topologyModel.primaryNodeId;
    const mode = topologyCreateMode || topologyCreatingNode?.mode || "branch";
    const branchName = (topologyCreateBranchName || topologyCreatingNode?.name || "").trim();
    if (!branchName) {
      setError(mode === "worktree" ? "请输入工作空间标识" : "请输入新的分支名");
      return;
    }
    const { baseBranch, startPoint } = topologyCreateSource(sourceId);
    setTopologyContextMenu(null);
    setCreatingTopologyNode(true);
    setBusy(true);
    setError("");
    try {
      if (mode === "branch") {
        if (branches.some((b) => b.name === branchName)) {
          throw new Error(`分支 "${branchName}" 已存在`);
        }
        setMessage(`基于 ${baseBranch} 创建分支: ${branchName}...`);
        await createGitBranch(repoPath, branchName, startPoint || undefined);
        rememberBranchParent(branchName, baseBranch);
        await refreshBranchesAndCommits();
        setSelectedBranch(branchName);
        setTopologySelectionId(`branch:${branchName}`);
        setTopologyCreatingNode(null);
        setShowTopologyCreateDialog(false);
        setMessage(`已创建分支: ${branchName}`);
      } else {
        const workspaceName = branchName;
        let targetPath = topologyCreateTargetPath.trim() || suggestedTopologyPath(baseBranch, branchName);
        const workspaceAlreadyActive = linkedWorktrees.some((wt) => normalizeWorkspacePath(wt.path) === normalizeWorkspacePath(targetPath));
        if (workspaceAlreadyActive) {
          throw new Error(`工作空间 "${workspaceName}" 已经存在`);
        }
        if (linkedWorktrees.some((wt) => wt.path === targetPath)) {
          targetPath = "";
        }
        setMessage(`基于 ${startPoint || baseBranch} 创建工作空间: ${workspaceName}...`);
        const created = await createGitDetachedWorktree(repoPath, startPoint || baseBranch, targetPath || undefined);
        rememberWorktreeParent(created.path, baseBranch);
        await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
        const newBranchCommits = baseBranch ? await getBranchCommits(repoPath, baseBranch, 80) : [];
        if (newBranchCommits.length > 0) {
          setCommits(newBranchCommits);
          setSelectedCommit(newBranchCommits[0]?.sha ?? "");
        }
        setSelectedBranch(baseBranch);
        setTopologySelectionId(`branch:${baseBranch}`);
        setTopologyCreatingNode(null);
        setShowTopologyCreateDialog(false);
        setMessage(`已创建工作空间: ${workspaceName}`);
      }
    } catch (error) {
      setError(String(error));
      setMessage(`创建失败: ${branchName}`);
    } finally {
      setCreatingTopologyNode(false);
      setBusy(false);
    }
  }

  function openTopologyInspectDialog(nodeId: string) {
    setTopologyContextMenu(null);
    setTopologyInspectNodeId(nodeId);
    setShowTopologyInspectDialog(true);
    const node = topologyModel.nodeById[nodeId];
    if (node?.kind === "commit" && node.sha) {
      setSelectedCommit(node.sha);
      setDetailTab("context");
    }
  }

  async function removeTopologyWorktree(targetPath: string) {
    if (!ensureRepoSelected()) return;
    const target = targetPath.trim();
    if (!target) {
      setError("目标路径为空");
      return;
    }
    const worktree = linkedWorktrees.find((item) => item.path.trim() === target);
    if (worktree?.isCurrent) {
      setError("不能删除当前 worktree 节点");
      return;
    }
    setTopologyContextMenu(null);
    setRemovingTopologyNode(true);
    setBusy(true);
    setError("");
    setMessage(`正在删除 worktree: ${target}...`);
    try {
      await removeGitWorktree(repoPath, target);
      unbindWorkspaceAgent(target);
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
      setTopologySelectionId(topologyModel.primaryNodeId);
      setMessage("worktree 已删除");
    } catch (error) {
      console.error("删除 worktree 失败:", error);
      setError(String(error));
      setMessage(`删除失败: ${String(error)}`);
    } finally {
      setRemovingTopologyNode(false);
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!ensureRepoSelected()) return;
    setError("");
    setMessage("读取 entire 状态...");
    try {
      const result = await getEntireStatusDetailed(repoPath);
      setStatusText(result.raw);
      setMessage("状态已更新");
    } catch (error) {
      setError(String(error));
      setMessage("读取状态失败");
    }
  }

  async function chooseBranch(branchName: string) {
    if (!selectedRepo) return;
    setSelectedBranch(branchName);
    try {
      const rows = await getBranchCommits(selectedRepo.path, branchName, 80);
      setCommits(rows);
      setSelectedCommit(rows[0]?.sha ?? "");
      setMessage(`已选择分支: ${branchName}`);
    } catch (error) {
      setError(String(error));
      setMessage("加载分支失败");
    }
  }

  function getCommitInput(): { message: string; staged: boolean; unstagedFiles: string[] } | null {
    const message = commitMessage.trim();
    if (!message) {
      setMessage("Please enter a commit message");
      focusCommitMessageInput();
      return null;
    }
    const staged = worktreeOverview.entries.some((entry) => entry.staged);
    const unstagedFiles = worktreeOverview.entries
      .filter((entry) => entry.unstaged || entry.untracked)
      .map((entry) => entry.path);
    if (!staged && unstagedFiles.length === 0) {
      setMessage("No changes to commit");
      return null;
    }
    return { message, staged, unstagedFiles };
  }

  async function stageUnstagedFiles(paths: string[]) {
    for (const file of paths) {
      await gitStageFile(repoPath, file);
    }
  }

  async function handleGitCommit() {
    if (!ensureRepoSelected() || committing || pushing) return;
    const input = getCommitInput();
    if (!input) return;
    setCommitting(true);
    setGitOperation("commit");
    setError("");
    try {
      if (!input.staged) {
        await stageUnstagedFiles(input.unstagedFiles);
      }
      const result = await gitCommit(repoPath, input.message);
      setCommitMessage("");
      setMessage("提交成功");
      await refreshWorktreeData();
      appendOpencodeDebugLog(`git.commit ${result.trim()}`);
    } catch (error) {
      setError(String(error));
      setMessage("提交失败");
    } finally {
      setCommitting(false);
      setGitOperation(null);
    }
  }

  async function handleGitPush() {
    if (!ensureRepoSelected() || committing || pushing) return;
    setPushing(true);
    setGitOperation("push");
    setError("");
    setShowCommitActionMenu(false);
    try {
      const result = await gitPush(repoPath);
      setMessage("推送成功");
      await refreshWorktreeData();
      appendOpencodeDebugLog(`git.push ${result.trim()}`);
    } catch (error) {
      setError(String(error));
      setMessage("推送失败");
    } finally {
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function handleGitSync() {
    if (!ensureRepoSelected() || committing || pushing) return;
    setPushing(true);
    setGitOperation("sync");
    setError("");
    setShowCommitActionMenu(false);
    try {
      if (worktreeOverview.behind > 0) {
        await gitPull(repoPath);
      }
      if (worktreeOverview.ahead > 0) {
        await gitPush(repoPath);
      }
      setMessage("Sync succeeded");
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
    } catch (error) {
      setError(String(error));
      setMessage("Sync failed");
    } finally {
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function handleGitCommitAndPush() {
    if (!ensureRepoSelected() || committing || pushing) return;
    const input = getCommitInput();
    if (!input) return;
    setCommitting(true);
    setPushing(true);
    setGitOperation("commitPush");
    setError("");
    setShowCommitActionMenu(false);
    try {
      if (!input.staged) {
        await stageUnstagedFiles(input.unstagedFiles);
      }
      const commitResult = await gitCommit(repoPath, input.message);
      const pushResult = await gitPush(repoPath);
      setCommitMessage("");
      setMessage("提交并推送成功");
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
      appendOpencodeDebugLog(`git.commit ${commitResult.trim()}`);
      appendOpencodeDebugLog(`git.push ${pushResult.trim()}`);
    } catch (error) {
      setError(String(error));
      setMessage("提交并推送失败");
    } finally {
      setCommitting(false);
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function handleGitCommitAndSync() {
    if (!ensureRepoSelected() || committing || pushing) return;
    const input = getCommitInput();
    if (!input) return;
    setCommitting(true);
    setPushing(true);
    setGitOperation("commitSync");
    setError("");
    setShowCommitActionMenu(false);
    try {
      if (!input.staged) {
        await stageUnstagedFiles(input.unstagedFiles);
      }
      const commitResult = await gitCommit(repoPath, input.message);
      const pushResult = await gitPush(repoPath);
      setCommitMessage("");
      setMessage("Commit & Sync succeeded");
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData()]);
      appendOpencodeDebugLog(`git.commit ${commitResult.trim()}`);
      appendOpencodeDebugLog(`git.push ${pushResult.trim()}`);
    } catch (error) {
      setError(String(error));
      setMessage("Commit & Sync failed");
    } finally {
      setCommitting(false);
      setPushing(false);
      setGitOperation(null);
    }
  }

  async function refreshScm() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("刷新提交与状态...");
    try {
      const [statusResult, branchList, graphRows, reviewRows, actionRows] = await Promise.all([
        getEntireStatusDetailed(repoPath),
        getLocalBranches(repoPath),
        getCommitGraph(repoPath, 300),
        loadReviewRecords(repoPath),
        loadReviewActions(repoPath)
      ]);
      setStatusText(statusResult.raw);
      setBranches(branchList);
      setCommitGraph(graphRows);
      setRecords(reviewRows);
      setActions(actionRows);
      const current = branchList.find((branch) => branch.isCurrent)?.name ?? branchList[0]?.name ?? "";
      const target = branchList.some((branch) => branch.name === selectedBranch) ? selectedBranch : current;
      setSelectedBranch(target);
      if (!target) {
        setCommits([]);
        setSelectedCommit("");
      } else {
        const rows = await getBranchCommits(repoPath, target, 80);
        setCommits(rows);
        setSelectedCommit(rows[0]?.sha ?? "");
      }
      await refreshWorktreeData(selectedWorktreeFile);
      setMessage("刷新完成");
    } catch (error) {
      setError(String(error));
      setMessage("刷新失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pullLatest() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 git pull...");
    try {
      const output = await gitPull(repoPath);
      setStatusText((prev) => [prev, `\n$ git pull --ff-only\n${output}`].filter(Boolean).join("\n"));
      await Promise.all([refreshBranchesAndCommits(), refreshWorktreeData(selectedWorktreeFile)]);
      setMessage("拉取完成");
    } catch (error) {
      setError(String(error));
      setMessage("拉取失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function pushCurrent() {
    if (!ensureRepoSelected()) return;
    setBusy(true);
    setOverlayBusy(true);
    setError("");
    setMessage("执行 git push...");
    try {
      const output = await gitPush(repoPath);
      setStatusText((prev) => [prev, `\n$ git push\n${output}`].filter(Boolean).join("\n"));
      await refreshWorktreeData(selectedWorktreeFile);
      setMessage("推送完成");
    } catch (error) {
      setError(String(error));
      setMessage("推送失败");
    } finally {
      setBusy(false);
      setOverlayBusy(false);
    }
  }

  async function handleDiscardChanges(filePath: string, isUntracked: boolean) {
    if (!ensureRepoSelected() || !filePath) return;
    setDiscardingFile(filePath);
    setError("");
    try {
      await gitDiscardChanges(repoPath, filePath, isUntracked);
      setMessage(`已撤销: ${filePath}`);
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage("撤销修改失败");
    } finally {
      setDiscardingFile("");
    }
  }

  async function handleDiscardEntries(entries: GitWorktreeEntry[], label: string) {
    if (!ensureRepoSelected() || entries.length === 0) return;
    const ok = window.confirm(`确定要丢弃目录「${label}」下的 ${entries.length} 个变更吗？\n\n这会删除未跟踪文件，并恢复已跟踪文件到 HEAD。`);
    if (!ok) return;
    setDiscardingFile(label);
    setError("");
    try {
      for (const entry of entries) {
        await gitDiscardChanges(repoPath, entry.path, entry.untracked);
      }
      setMessage(`已丢弃 ${entries.length} 个变更: ${label}`);
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage("目录丢弃失败");
    } finally {
      setDiscardingFile("");
    }
  }

  async function handleStageFile(filePath: string) {
    if (!ensureRepoSelected() || !filePath) return;
    setStagingFile(filePath);
    setError("");
    try {
      await gitStageFile(repoPath, filePath);
      setMessage(`已暂存: ${filePath}`);
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage("暂存失败");
    } finally {
      setStagingFile("");
    }
  }

  async function handleStagePaths(paths: string[], label: string) {
    if (!ensureRepoSelected() || paths.length === 0) return;
    setStagingFile(label);
    setError("");
    try {
      for (const file of paths) {
        await gitStageFile(repoPath, file);
      }
      setMessage(`已暂存 ${paths.length} 个文件: ${label}`);
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage("目录暂存失败");
    } finally {
      setStagingFile("");
    }
  }

  async function handleUnstageFile(filePath: string) {
    if (!ensureRepoSelected() || !filePath) return;
    setUnstagingFile(filePath);
    setError("");
    try {
      await gitUnstageFile(repoPath, filePath);
      setMessage(`已取消暂存: ${filePath}`);
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage("取消暂存失败");
    } finally {
      setUnstagingFile("");
    }
  }

  async function handleUnstagePaths(paths: string[], label: string) {
    if (!ensureRepoSelected() || paths.length === 0) return;
    setUnstagingFile(label);
    setError("");
    try {
      for (const file of paths) {
        await gitUnstageFile(repoPath, file);
      }
      setMessage(`已取消暂存 ${paths.length} 个文件: ${label}`);
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage("目录取消暂存失败");
    } finally {
      setUnstagingFile("");
    }
  }

  async function handleToggleStageAll() {
    if (!ensureRepoSelected()) return;
    const unstagedFiles = worktreeOverview.entries.filter((entry) => entry.unstaged || entry.untracked).map((entry) => entry.path);
    const stagedFiles = worktreeOverview.entries.filter((entry) => entry.staged).map((entry) => entry.path);
    setError("");
    try {
      if (unstagedFiles.length > 0) {
        for (const file of unstagedFiles) {
          await gitStageFile(repoPath, file);
        }
        setMessage(`已暂存 ${unstagedFiles.length} 个文件`);
      } else if (stagedFiles.length > 0) {
        for (const file of stagedFiles) {
          await gitUnstageFile(repoPath, file);
        }
        setMessage(`已取消暂存 ${stagedFiles.length} 个文件`);
      }
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage(unstagedFiles.length > 0 ? "全部暂存失败" : "全部取消暂存失败");
    }
  }

  function openDiscardAllConfirm() {
    if (!ensureRepoSelected()) return;
    const entries = worktreeOverview.entries.filter((entry) => entry.staged || entry.unstaged || entry.untracked);
    if (entries.length === 0) return;
    setShowDiscardAllConfirm(true);
  }

  async function handleDiscardAllChanges() {
    if (!ensureRepoSelected()) return;
    const entries = worktreeOverview.entries.filter((entry) => entry.staged || entry.unstaged || entry.untracked);
    if (entries.length === 0) {
      setShowDiscardAllConfirm(false);
      return;
    }
    setDiscardingAll(true);
    setError("");
    try {
      for (const entry of entries) {
        await gitDiscardChanges(repoPath, entry.path, entry.untracked);
      }
      setMessage(`已撤销 ${entries.length} 个文件`);
      setShowDiscardAllConfirm(false);
      await refreshWorktreeData();
    } catch (error) {
      setError(String(error));
      setMessage("撤销全部修改失败");
    } finally {
      setDiscardingAll(false);
    }
  }

  async function handleRemoveWorktree(path: string) {
    if (!ensureRepoSelected() || !path) return;
    setRemovingWorktreePath(path);
    setError("");
    try {
      await removeGitWorktree(repoPath, path);
      setMessage(`已移除 worktree: ${path}`);
      setShowRemoveWorktreeConfirm(false);
      setWorktreeContextMenu(null);
      await refreshWorktreeData();
      await refreshBranchesAndCommits();
    } catch (error) {
      setError(String(error));
      setMessage("移除 worktree 失败");
    } finally {
      setRemovingWorktreePath("");
      setWorktreeToRemove("");
    }
  }

  function toggleWorktreeDir(path: string) {
    setExpandedWorktreeDirs((prev) => (prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]));
  }

  return {
    activateLinkedWorktree,
    checkoutBranchFromTopology,
    checkoutRemoteBranchFromTopology,
    activateBranchWorkspace,
    deleteBranchFromTopology,
    inspectCommitFromTopology,
    applyCommitFromContextMenu,
    currentTopologyBaseBranch,
    topologyCreateSource,
    suggestedTopologyPath,
    commitWorktreeBranchName,
    openCommitWorktreeDialog,
    openTopologyCreateDialog,
    submitTopologyCreateDialog,
    openTopologyInspectDialog,
    removeTopologyWorktree,
    refreshStatus,
    refreshBranchesAndCommits,
    refreshWorktreeData,
    refreshGitUserIdentity,
    refreshSelectedWorktreePatch,
    chooseBranch,
    handleGitCommit,
    handleGitPush,
    handleGitSync,
    handleGitCommitAndPush,
    handleGitCommitAndSync,
    refreshScm,
    pullLatest,
    pushCurrent,
    handleDiscardChanges,
    handleDiscardEntries,
    handleStageFile,
    handleStagePaths,
    handleUnstageFile,
    handleUnstagePaths,
    handleToggleStageAll,
    openDiscardAllConfirm,
    handleDiscardAllChanges,
    handleRemoveWorktree,
    toggleWorktreeDir,
  };
}

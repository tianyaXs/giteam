import { invoke } from "@tauri-apps/api/core";
import type { GitBranchSummary, GitCommitSummary, GitGraphNode, GitUserIdentity, GitWorktreeOverview } from "./types";

export async function getHeadCommit(repoPath: string): Promise<string> {
  return invoke<string>("run_git_head_commit", { repoPath });
}

export async function gitPull(repoPath: string): Promise<string> {
  return invoke<string>("run_git_pull", { repoPath });
}

export async function gitPush(repoPath: string): Promise<string> {
  return invoke<string>("run_git_push", { repoPath });
}

export async function getCommitDiff(commitSha: string, repoPath: string): Promise<string> {
  return invoke<string>("run_git_show_patch", { commitSha, repoPath });
}

export async function getRecentCommits(repoPath: string, limit = 30): Promise<GitCommitSummary[]> {
  return invoke<GitCommitSummary[]>("run_git_recent_commits", { repoPath, limit });
}

export async function getLocalBranches(repoPath: string): Promise<GitBranchSummary[]> {
  return invoke<GitBranchSummary[]>("run_git_local_branches", { repoPath });
}

export async function getBranchCommits(
  repoPath: string,
  branchName: string,
  limit = 30
): Promise<GitCommitSummary[]> {
  return invoke<GitCommitSummary[]>("run_git_branch_commits", { repoPath, branchName, limit });
}

export async function getCommitGraph(repoPath: string, limit = 120): Promise<GitGraphNode[]> {
  return invoke<GitGraphNode[]>("run_git_commit_graph", { repoPath, limit });
}

export async function getCommitChangedFiles(repoPath: string, commitSha: string): Promise<string[]> {
  return invoke<string[]>("run_git_commit_changed_files", { repoPath, commitSha });
}

export async function getCommitFilePatch(
  repoPath: string,
  commitSha: string,
  filePath: string
): Promise<string> {
  return invoke<string>("run_git_commit_file_patch", { repoPath, commitSha, filePath });
}

export async function getGitWorktreeOverview(repoPath: string): Promise<GitWorktreeOverview> {
  return invoke<GitWorktreeOverview>("run_git_worktree_overview", { repoPath });
}

export async function getGitWorktreeFilePatch(repoPath: string, filePath: string): Promise<string> {
  return invoke<string>("run_git_worktree_file_patch", { repoPath, filePath });
}

export async function runRepoTerminalCommand(repoPath: string, command: string): Promise<string> {
  return invoke<string>("run_repo_terminal_command", { repoPath, command });
}

export async function getGitUserIdentity(repoPath: string): Promise<GitUserIdentity> {
  return invoke<GitUserIdentity>("run_git_user_identity", { repoPath });
}

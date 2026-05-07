import { invoke } from "@tauri-apps/api/core";
import type { GitBranchSummary, GitCommitSummary, GitGraphNode, GitLinkedWorktree, GitUserIdentity, GitWorktreeCreateResult, GitWorktreeFileContent, GitWorktreeOverview, GitWorktreeRemoveResult } from "./types";

export async function getHeadCommit(repoPath: string): Promise<string> {
  return invoke<string>("run_git_head_commit", { repoPath });
}

export async function gitPull(repoPath: string): Promise<string> {
  return invoke<string>("run_git_pull", { repoPath });
}

export async function gitPush(repoPath: string): Promise<string> {
  return invoke<string>("run_git_push", { repoPath });
}

export async function gitCommit(repoPath: string, message: string): Promise<string> {
  return invoke<string>("run_git_commit", { repoPath, message });
}

export async function gitStageFile(repoPath: string, filePath: string): Promise<string> {
  return invoke<string>("run_git_stage_file", { repoPath, filePath });
}

export async function gitUnstageFile(repoPath: string, filePath: string): Promise<string> {
  return invoke<string>("run_git_unstage_file", { repoPath, filePath });
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

export async function getGitWorktreeList(repoPath: string): Promise<GitLinkedWorktree[]> {
  return invoke<GitLinkedWorktree[]>("run_git_worktree_list", { repoPath });
}

export async function getGitWorktreeFilePatch(repoPath: string, filePath: string): Promise<string> {
  return invoke<string>("run_git_worktree_file_patch", { repoPath, filePath });
}

export async function getGitWorktreeFileContent(repoPath: string, filePath: string): Promise<GitWorktreeFileContent> {
  return invoke<GitWorktreeFileContent>("run_git_worktree_file_content", { repoPath, filePath });
}

export async function gitCheckoutBranch(repoPath: string, branchName: string): Promise<string> {
  return invoke<string>("run_git_checkout_branch", { repoPath, branchName });
}

export async function gitCheckoutRemoteBranch(repoPath: string, remoteBranch: string, localBranch?: string): Promise<string> {
  return invoke<string>("run_git_checkout_remote_branch", { repoPath, remoteBranch, localBranch });
}

export async function gitDiscardChanges(
  repoPath: string,
  filePath: string,
  isUntracked: boolean = false
): Promise<string> {
  return invoke<string>("run_git_discard_changes", { repoPath, filePath, isUntracked });
}

export async function createGitBranch(repoPath: string, branchName: string, startPoint?: string): Promise<string> {
  return invoke<string>("run_git_create_branch", { repoPath, branchName, startPoint });
}

export async function deleteGitBranch(repoPath: string, branchName: string): Promise<string> {
  return invoke<string>("run_git_delete_branch", { repoPath, branchName });
}

export async function createGitWorktreeFromBranch(repoPath: string, branchName: string, targetPath?: string): Promise<GitWorktreeCreateResult> {
  return invoke<GitWorktreeCreateResult>("run_git_create_worktree_from_branch", { repoPath, branchName, targetPath });
}

export async function createGitDetachedWorktree(repoPath: string, startPoint: string, targetPath?: string): Promise<GitWorktreeCreateResult> {
  return invoke<GitWorktreeCreateResult>("run_git_create_detached_worktree", { repoPath, startPoint, targetPath });
}

export async function removeGitWorktree(repoPath: string, targetPath: string): Promise<GitWorktreeRemoveResult> {
  return invoke<GitWorktreeRemoveResult>("run_git_remove_worktree", { repoPath, targetPath });
}

export async function runRepoTerminalCommand(repoPath: string, command: string): Promise<string> {
  return invoke<string>("run_repo_terminal_command", { repoPath, command });
}

export type RepoTerminalSnapshot = {
  output: string;
  seq: number;
  alive: boolean;
  cwd: string;
};

export async function startRepoTerminalSession(repoPath: string, sessionId?: string): Promise<RepoTerminalSnapshot> {
  return invoke<RepoTerminalSnapshot>("start_repo_terminal_session", { repoPath, sessionId });
}

export async function sendRepoTerminalInput(repoPath: string, input: string, sessionId?: string): Promise<void> {
  return invoke<void>("send_repo_terminal_input", { repoPath, sessionId, input });
}

export async function readRepoTerminalOutput(repoPath: string, afterSeq: number, sessionId?: string): Promise<RepoTerminalSnapshot> {
  return invoke<RepoTerminalSnapshot>("read_repo_terminal_output", { repoPath, sessionId, afterSeq });
}

export async function completeRepoTerminalInput(repoPath: string, input: string, cwd?: string): Promise<string> {
  return invoke<string>("complete_repo_terminal_input", { repoPath, input, cwd });
}

export async function clearRepoTerminalSession(repoPath: string, sessionId?: string): Promise<void> {
  return invoke<void>("clear_repo_terminal_session", { repoPath, sessionId });
}

export async function closeRepoTerminalSession(repoPath: string, sessionId?: string): Promise<void> {
  return invoke<void>("close_repo_terminal_session", { repoPath, sessionId });
}

export async function getGitUserIdentity(repoPath: string): Promise<GitUserIdentity> {
  return invoke<GitUserIdentity>("run_git_user_identity", { repoPath });
}

export async function startGitWorktreeWatcher(repoPath: string): Promise<void> {
  return invoke<void>("start_git_worktree_watcher", { repoPath });
}

export async function stopGitWorktreeWatcher(): Promise<void> {
  return invoke<void>("stop_git_worktree_watcher");
}

export type EntireStatusResult = {
  raw: string;
};

export type ExplainCommitResult = {
  commitSha: string;
  raw: string;
};

export type GitCommitSummary = {
  sha: string;
  author: string;
  date: string;
  subject: string;
};

export type GitBranchSummary = {
  name: string;
  isCurrent: boolean;
};

export type GitGraphNode = {
  graph: string;
  sha: string;
  parents: string[];
  date: string;
  author: string;
  refs: string;
  subject: string;
  isConnector: boolean;
};

export type GitWorktreeEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export type GitWorktreeOverview = {
  branch: string;
  tracking: string;
  ahead: number;
  behind: number;
  clean: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  entries: GitWorktreeEntry[];
  raw: string;
};

export type GitUserIdentity = {
  name: string;
  email: string;
};

export type RepositoryEntry = {
  id: string;
  path: string;
  name: string;
  addedAt: string;
};

export type ExplainCommitParsed = {
  checkpointId?: string;
  sessionId?: string;
  tokens?: string;
  hasCheckpoint: boolean;
};

export type ReviewFinding = {
  id: string;
  severity: "low" | "medium" | "high";
  file: string;
  summary: string;
  suggestion?: string;
};

export type ReviewRecord = {
  id: string;
  repoPath: string;
  commitSha: string;
  status: "pass" | "warn" | "fail" | "error";
  summary: string;
  findings: ReviewFinding[];
  createdAt: string;
};

export type ReviewActionType = "accept" | "dismiss" | "todo";

export type ReviewAction = {
  id: string;
  repoPath: string;
  reviewId: string;
  findingId: string;
  action: ReviewActionType;
  note?: string;
  createdAt: string;
};

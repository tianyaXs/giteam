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
  isRemote: boolean;
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

export type GitLinkedWorktree = {
  path: string;
  branch: string;
  head: string;
  isCurrent: boolean;
  isMainWorktree: boolean;
  isDetached: boolean;
  clean: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  locked: string;
  prunable: string;
};

export type GitWorktreeCreateResult = {
  path: string;
  branch: string;
  head: string;
};

export type GitWorktreeRemoveResult = {
  path: string;
};

export type GitUserIdentity = {
  name: string;
  email: string;
};

export type GitWorktreeFileContent = {
  original: string;
  modified: string;
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

// Question types for AI interactive prompts
export type QuestionOption = {
  label: string;
  description?: string;
};

export type QuestionInfo = {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

export type QuestionAnswer = string[];

export type QuestionRequest = {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: { messageID: string; callID: string };
};

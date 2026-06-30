import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRemoteWorkspaceSession,
  normalizeRemoteWorkspaceShellResult,
  normalizeRemoteWorkspaceTextMatches,
  normalizeRemoteWorkspaceGraphState,
  describeRemoteWorkspaceGraphAction,
  formatRemoteWorkspaceTimestamp,
  mapGraphStatusToRemoteRepoGitNexusStatus,
  explainRemoteWorkspaceCreationError,
  ensureRemoteWorkspaceSessionRepo,
} from "../src/components/remote-repo/remoteRepoWorkspaceResources.ts";

test("normalizes a commit-pinned workspace session from the service", () => {
  assert.deepEqual(normalizeRemoteWorkspaceSession({
    session_id: "sess_123",
    repo_id: "demo",
    workspace_id: "ws_123",
    base_commit: "42a02ea2324bf4882503ac9b2a0406398df42329",
    workspace_version: 1,
    dirty: false,
  }), {
    sessionId: "sess_123",
    repoId: "demo",
    workspaceId: "ws_123",
    baseCommit: "42a02ea2324bf4882503ac9b2a0406398df42329",
    workspaceVersion: 1,
    dirty: false,
  });
});

test("normalizes bounded shell output and workspace state", () => {
  assert.deepEqual(normalizeRemoteWorkspaceShellResult({
    exit_code: 0,
    stdout: "clean\\n",
    stderr: "",
    elapsed_ms: 24,
    timed_out: false,
    workspace_version: 2,
    status_after: " M README.md",
    diff_summary: " README.md | 1 +\\n",
  }), {
    exitCode: 0,
    stdout: "clean\\n",
    stderr: "",
    elapsedMs: 24,
    timedOut: false,
    workspaceVersion: 2,
    statusAfter: " M README.md",
    diffSummary: " README.md | 1 +\\n",
  });
});

test("normalizes text search results for the workspace search panel", () => {
  assert.deepEqual(normalizeRemoteWorkspaceTextMatches([
    { path: "src/app.ts", line_number: 12, line: "TODO: ship" },
  ]), [{ path: "src/app.ts", lineNumber: 12, line: "TODO: ship" }]);
});

test("keeps GitNexus index time and distinguishes checking status from reanalysis", () => {
  const graph = normalizeRemoteWorkspaceGraphState({
    status: "READY",
    last_indexed_at: "2026-06-24T08:30:00+00:00",
    target: { target_type: "repo_head", repo_id: "2" },
  });

  assert.equal(graph.lastIndexedAt, "2026-06-24T08:30:00+00:00");
  assert.match(formatRemoteWorkspaceTimestamp("2026-06-24T03:00:08.180147+00:00", "Asia/Shanghai"), /11:00:08/);
  assert.equal(describeRemoteWorkspaceGraphAction("status", graph), `状态已检查：索引可用（最近索引：${formatRemoteWorkspaceTimestamp("2026-06-24T08:30:00+00:00")}）。`);
  assert.equal(describeRemoteWorkspaceGraphAction("analyze", graph), `GitNexus 分析完成：索引可用（索引时间：${formatRemoteWorkspaceTimestamp("2026-06-24T08:30:00+00:00")}）。`);
});

test("describes failed GitNexus analysis as a failure", () => {
  const graph = normalizeRemoteWorkspaceGraphState({
    status: "FAILED",
    error: "registry entry was not added",
  });

  assert.equal(describeRemoteWorkspaceGraphAction("analyze", graph), "GitNexus 分析失败：registry entry was not added");
  assert.equal(describeRemoteWorkspaceGraphAction("status", graph), "状态已检查：索引失败：registry entry was not added");
});

test("maps service GitNexus states into the same overview vocabulary", () => {
  assert.equal(mapGraphStatusToRemoteRepoGitNexusStatus("READY"), "ready");
  assert.equal(mapGraphStatusToRemoteRepoGitNexusStatus("INDEXING"), "indexing");
  assert.equal(mapGraphStatusToRemoteRepoGitNexusStatus("STALE"), "not_indexed");
  assert.equal(mapGraphStatusToRemoteRepoGitNexusStatus("FAILED"), "unavailable");
  assert.equal(mapGraphStatusToRemoteRepoGitNexusStatus("unexpected"), "unknown");
});

test("explains an invalid ref as a ref problem rather than a workspace name problem", () => {
  assert.equal(
    explainRemoteWorkspaceCreationError("Error: Git command failed: git rev-parse main2^{commit} fatal: ambiguous argument"),
    "找不到 ref 或提交 “main2”。请输入真实分支名或提交 SHA；这里不是工作区名称。",
  );
});

test("only resumes a saved session from the repository it belongs to", () => {
  const current = {
    sessionId: "sess_123",
    repoId: "repo-a",
    baseCommit: "42a02ea",
    workspaceVersion: 1,
    dirty: false,
  };

  assert.equal(ensureRemoteWorkspaceSessionRepo(current, "repo-a"), current);
  assert.throws(() => ensureRemoteWorkspaceSessionRepo(current, "repo-b"), /不属于当前仓库/);
});

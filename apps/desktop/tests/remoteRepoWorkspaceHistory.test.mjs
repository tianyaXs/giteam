import assert from "node:assert/strict";
import test from "node:test";

import {
  getLatestRemoteWorkspaceSession,
  getRecentRemoteWorkspaceCards,
  rememberRemoteWorkspace,
} from "../src/components/remote-repo/remoteRepoWorkspaceHistory.ts";

const session = {
  sessionId: "sess_first",
  repoId: "repo-a",
  baseCommit: "5adfdb54ad83f3b67bc4af25233634da32e1e6a0",
  workspaceVersion: 1,
  dirty: false,
};

test("records a created remote workspace so it can be reopened after leaving the panel", () => {
  const history = rememberRemoteWorkspace({}, session, 1_000);

  assert.deepEqual(getLatestRemoteWorkspaceSession(history, "repo-a"), { ...session, updatedAt: 1_000, state: "ready" });
  assert.deepEqual(getRecentRemoteWorkspaceCards(history, "repo-a"), [{
    id: "sess_first",
    name: "sess_first · 5adfdb5",
    baseCommit: session.baseCommit,
    dirty: false,
    workspaceVersion: 1,
    updatedAt: 1_000,
    state: "ready",
  }]);
});

test("updates a resumed workspace in place and keeps histories scoped to each repository", () => {
  const withFirst = rememberRemoteWorkspace({}, session, 1_000);
  const withUpdated = rememberRemoteWorkspace(withFirst, { ...session, workspaceVersion: 2, dirty: true }, 2_000);
  const withSecondRepo = rememberRemoteWorkspace(withUpdated, { ...session, sessionId: "sess_second", repoId: "repo-b" }, 3_000);

  assert.equal(getLatestRemoteWorkspaceSession(withSecondRepo, "repo-a")?.workspaceVersion, 2);
  assert.equal(getLatestRemoteWorkspaceSession(withSecondRepo, "repo-a")?.dirty, true);
  assert.equal(getLatestRemoteWorkspaceSession(withSecondRepo, "repo-b")?.sessionId, "sess_second");
  assert.equal(getRecentRemoteWorkspaceCards(withSecondRepo, "repo-a").length, 1);
});

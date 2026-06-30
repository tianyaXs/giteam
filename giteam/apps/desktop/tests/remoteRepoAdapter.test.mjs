import assert from "node:assert/strict";
import test from "node:test";

import { adaptRemoteRepoOverview } from "../src/components/remote-repo/remoteRepoAdapter.ts";
import { adaptWebRemoteRepoOverview } from "../src/components/remote-repo/remoteRepoWebData.ts";

test("adapts a connected remote overview into the UI's repository model", () => {
  const repo = adaptRemoteRepoOverview({
    repoId: "remote-repo-skill-brainstorm_2_giteam",
    displayName: "Giteam remote repository",
    provider: "gitlab",
    remoteUrl: "https://token@gitlab.example.com/giteam/brainstorm.git",
    connectionStatus: "connected",
    defaultRef: "main",
    defaultCommit: "d6ad9391234567890",
    linkedProjectIds: ["project-giteam"],
    lastAccessedAtMs: 1_700_000_000_000,
    lastSyncedAtMs: 1_700_000_010_000,
  });

  assert.equal(repo.id, "remote-repo-skill-brainstorm_2_giteam");
  assert.equal(repo.displayName, "Giteam remote repository");
  assert.equal(repo.provider, "gitlab");
  assert.equal(repo.branch, "main");
  assert.equal(repo.commit, "d6ad939");
  assert.equal(repo.originUrl, "https://gitlab.example.com/giteam/brainstorm.git");
  assert.deepEqual(repo.linkedProjectIds, ["project-giteam"]);
  assert.equal(repo.lastSyncedAt, 1_700_000_010_000);
  assert.equal(repo.gitNexusStatus, "unknown");
  assert.equal(repo.fileTreeStatus, "loading");
});

test("keeps a connection failure visible without inventing code state", () => {
  const repo = adaptRemoteRepoOverview({
    repoId: "offline-repo",
    displayName: "offline-repo",
    provider: null,
    remoteUrl: null,
    connectionStatus: "failed",
    defaultRef: "main",
    defaultCommit: null,
    linkedProjectIds: [],
    lastAccessedAtMs: 0,
    lastSyncedAtMs: null,
    error: "remote service unavailable",
  });

  assert.equal(repo.connectionStatus, "failed");
  assert.equal(repo.branch, "main");
  assert.equal(repo.commit, "—");
  assert.equal(repo.originUrl, "");
  assert.equal(repo.errorMessage, "remote service unavailable");
});

test("keeps a stale service connection actionable without pretending it is connected", () => {
  const repo = adaptRemoteRepoOverview({
    repoId: "local-demo",
    displayName: "Remote demo",
    provider: "gitlab",
    remoteUrl: "gitlab.com/acme/demo",
    connectionStatus: "stale",
    defaultRef: "main",
    defaultCommit: null,
    linkedProjectIds: [],
    lastAccessedAtMs: 0,
    lastSyncedAtMs: null,
    pinned: true,
  });

  assert.equal(repo.connectionStatus, "stale");
  assert.equal(repo.pinned, true);
  assert.equal(repo.originUrl, "gitlab.com/acme/demo");
});

test("adapts the Remote Repo Service schema in the web preview without copying connection config", () => {
  const overview = adaptWebRemoteRepoOverview({
    repo_id: "2",
    name: "My Repo2",
    provider: "gitlab",
    origin: "gitlab.example.com/team/repo",
    default_ref: "main",
    default_commit: "abcdef0123456789",
    sync_status: "connected",
    last_synced_at_ms: 1_700_000_020_000,
  }, { pinned: true, lastAccessedAtMs: 1_700_000_000_000 });

  assert.deepEqual(overview, {
    repoId: "2",
    displayName: "My Repo2",
    provider: "gitlab",
    remoteUrl: "gitlab.example.com/team/repo",
    connectionStatus: "connected",
    defaultRef: "main",
    defaultCommit: "abcdef0123456789",
    linkedProjectIds: [],
    pinned: true,
    sortOrder: 0,
    lastAccessedAtMs: 1_700_000_000_000,
    lastSyncedAtMs: 1_700_000_020_000,
    error: null,
  });
});

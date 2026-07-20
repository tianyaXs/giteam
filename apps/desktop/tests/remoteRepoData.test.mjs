import assert from "node:assert/strict";
import test from "node:test";

import {
  getDefaultRemoteRepo,
  getRemoteRepoOriginLabel,
  getVisibleRemoteRepos,
  prioritizeRemoteRepos,
} from "../src/components/remote-repo/remoteRepoData.ts";

const repo = (overrides = {}) => ({
  id: "repo",
  displayName: "Repository",
  connectionStatus: "connected",
  linkedProjectIds: [],
  lastAccessedAt: 0,
  ...overrides,
});

test("prioritizes repositories linked to the current project before recency", () => {
  const ordered = prioritizeRemoteRepos(
    [
      repo({ id: "recent", lastAccessedAt: 30 }),
      repo({ id: "linked-older", linkedProjectIds: ["project-a"], lastAccessedAt: 10 }),
      repo({ id: "linked-newer", linkedProjectIds: ["project-a"], lastAccessedAt: 20 }),
    ],
    "project-a",
  );

  assert.deepEqual(ordered.map((item) => item.id), ["linked-newer", "linked-older", "recent"]);
});

test("keeps locally pinned repositories above project and recency ordering", () => {
  const ordered = prioritizeRemoteRepos(
    [
      repo({ id: "linked", linkedProjectIds: ["project-a"], lastAccessedAt: 30 }),
      repo({ id: "pinned", pinned: true, lastAccessedAt: 1 }),
    ],
    "project-a",
  );

  assert.deepEqual(ordered.map((item) => item.id), ["pinned", "linked"]);
});

test("keeps the sidebar list compact and reports overflow", () => {
  const visible = getVisibleRemoteRepos(
    [repo({ id: "one" }), repo({ id: "two" }), repo({ id: "three" }), repo({ id: "four" })],
    "",
    3,
  );

  assert.deepEqual(visible.repos.map((item) => item.id), ["one", "two", "three"]);
  assert.equal(visible.hiddenCount, 1);
});

test("chooses the current project's most recent repository for the right-side inspector", () => {
  const selected = getDefaultRemoteRepo(
    [
      repo({ id: "recent", lastAccessedAt: 30 }),
      repo({ id: "linked-older", linkedProjectIds: ["project-a"], lastAccessedAt: 10 }),
      repo({ id: "linked-newer", linkedProjectIds: ["project-a"], lastAccessedAt: 20 }),
    ],
    "project-a",
  );

  assert.equal(selected?.id, "linked-newer");
  assert.equal(getDefaultRemoteRepo([], "project-a"), null);
});

test("renders a repository origin without credentials", () => {
  assert.equal(
    getRemoteRepoOriginLabel("https://token@github.com/acme/rocket.git"),
    "github.com/acme/rocket",
  );
});

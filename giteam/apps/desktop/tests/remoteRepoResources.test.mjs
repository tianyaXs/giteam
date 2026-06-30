import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRemoteRepoBranches,
  normalizeRemoteRepoFileContent,
  normalizeRemoteRepoFileTree,
} from "../src/components/remote-repo/remoteRepoResources.ts";

test("normalizes branch data from the remote repository service", () => {
  assert.deepEqual(normalizeRemoteRepoBranches({
    branches: [{ name: "main", short_sha: "42a02ea", is_default: true }],
  }), [{ name: "main", shortSha: "42a02ea", isDefault: true }]);
});

test("normalizes a repository file tree without workspace state", () => {
  assert.deepEqual(normalizeRemoteRepoFileTree({
    ref: "main",
    commit: "42a02ea2324bf4882503ac9b2a0406398df42329",
    path: ".",
    entries: [{ name: "README.md", path: "README.md", kind: "file", short_sha: "42a02ea" }],
  }), {
    ref: "main",
    commit: "42a02ea2324bf4882503ac9b2a0406398df42329",
    path: ".",
    entries: [{ name: "README.md", path: "README.md", kind: "file", shortSha: "42a02ea" }],
  });
});

test("normalizes a read-only repository file slice", () => {
  assert.deepEqual(normalizeRemoteRepoFileContent({
    ref: "main",
    commit: "42a02ea2324bf4882503ac9b2a0406398df42329",
    path: "README.md",
    start_line: 1,
    end_line: 1,
    content: "# Demo\\n",
    truncated: false,
    sha256: "abc",
  }), {
    ref: "main",
    commit: "42a02ea2324bf4882503ac9b2a0406398df42329",
    path: "README.md",
    startLine: 1,
    endLine: 1,
    content: "# Demo\\n",
    truncated: false,
    sha256: "abc",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRemoteRepoServiceUrl,
  resolveRemoteRepoServiceBase,
} from "../src/components/remote-repo/remoteRepoServiceUrl.ts";

test("normalizes a configured remote service URL without retaining a trailing slash", () => {
  assert.equal(
    normalizeRemoteRepoServiceUrl(" https://giteam.example.com/remote-repo-service/ "),
    "https://giteam.example.com/remote-repo-service",
  );
  assert.equal(normalizeRemoteRepoServiceUrl("/remote-repo-service/"), "/remote-repo-service");
});

test("rejects non-HTTP service URLs and falls back to the app proxy when unset", () => {
  assert.throws(() => normalizeRemoteRepoServiceUrl("ssh://git.example.com/repo"), /http/i);
  assert.equal(resolveRemoteRepoServiceBase("", ""), "/remote-repo-service");
  assert.equal(resolveRemoteRepoServiceBase("", "https://env.example.com/"), "https://env.example.com");
});

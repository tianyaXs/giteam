import assert from "node:assert/strict";
import test from "node:test";

import { buildHunks, diffLines } from "../src/lib/turnDiff.ts";

test("identical texts produce no hunks", () => {
  const lines = diffLines("a\nb", "a\nb");
  assert.equal(lines.every((line) => line.type === "context"), true);
  assert.equal(buildHunks(lines).length, 0);
});

test("pure addition keeps context and numbers", () => {
  const lines = diffLines("a\nb", "a\nx\nb");
  const added = lines.filter((line) => line.type === "added");
  assert.equal(added.length, 1);
  assert.equal(added[0].text, "x");
  assert.equal(added[0].afterNo, 2);
  assert.equal(added[0].beforeNo, null);
  const hunks = buildHunks(lines, 3);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].header, "@@ -1,2 +1,3 @@");
});

test("pure removal and hunk header counts", () => {
  const lines = diffLines("a\nb\nc", "a\nc");
  const removed = lines.filter((line) => line.type === "removed");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].beforeNo, 2);
  assert.equal(buildHunks(lines)[0].header, "@@ -1,3 +1,2 @@");
});

test("write with empty before is all-added", () => {
  const lines = diffLines("", "x\ny");
  assert.equal(lines.filter((line) => line.type === "added").length, 2);
  assert.equal(buildHunks(lines)[0].header, "@@ -0,0 +1,2 @@");
});

test("distant edits split into two hunks", () => {
  const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].join("\n");
  const after = ["1", "x", "3", "4", "5", "6", "7", "8", "9", "10", "y", "12"].join("\n");
  const hunks = buildHunks(diffLines(before, after), 2);
  assert.equal(hunks.length, 2);
});

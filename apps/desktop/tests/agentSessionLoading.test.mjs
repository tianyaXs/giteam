import assert from "node:assert/strict";
import test from "node:test";

import { isAgentSessionLoadingState } from "../src/lib/agentSessions.ts";

const base = {
  hydratingActive: false,
  pendingSidebarSwitch: false,
  draft: false,
  activeSessionId: "",
  activeSession: null
};

test("no active session renders neither loading nor spinning state", () => {
  assert.equal(isAgentSessionLoadingState(base), false);
});

test("hydration in progress shows loading", () => {
  assert.equal(
    isAgentSessionLoadingState({ ...base, hydratingActive: true, activeSessionId: "s1" }),
    true
  );
});

test("pending sidebar switch shows loading", () => {
  assert.equal(
    isAgentSessionLoadingState({ ...base, pendingSidebarSwitch: true, activeSessionId: "s1" }),
    true
  );
});

test("active session found and loaded is not loading", () => {
  assert.equal(
    isAgentSessionLoadingState({
      ...base,
      activeSessionId: "s1",
      activeSession: { loaded: true }
    }),
    false
  );
});

test("active session found but not hydrated is loading", () => {
  assert.equal(
    isAgentSessionLoadingState({
      ...base,
      activeSessionId: "s1",
      activeSession: { loaded: false }
    }),
    true
  );
});

test("active session missing from list is loading", () => {
  assert.equal(
    isAgentSessionLoadingState({ ...base, activeSessionId: "s1", activeSession: null }),
    true
  );
});

// 回归：切到刚导入的空仓库时，上一仓库的 active id 残留 + 列表为空，
// 曾让右侧面板永久停在「加载会话中…」。草稿态必须豁免该分支。
test("draft mode with stale cross-repo active id is NOT loading (regression)", () => {
  assert.equal(
    isAgentSessionLoadingState({
      ...base,
      draft: true,
      activeSessionId: "old-repo-session",
      activeSession: null
    }),
    false
  );
});

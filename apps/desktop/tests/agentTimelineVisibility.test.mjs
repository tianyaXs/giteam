import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentAssistantRenderGroups, hasVisibleTimelineGroups } from "../src/lib/agentParts.ts";

test("boundary-only timeline is NOT visible (thinking placeholder must stay)", () => {
  // 「隐藏推理摘要」时推理组会变成 boundary；boundary 渲染为 null。
  // 若把它计入 hasTimeline，占位「思考中」会在正文到达前几秒塌成 0 高度再弹回（列表抖动）。
  assert.equal(hasVisibleTimelineGroups([{ kind: "boundary", key: "b1" }]), false);
  assert.equal(hasVisibleTimelineGroups([]), false);
});

test("reasoning/text/context groups are visible", () => {
  assert.equal(
    hasVisibleTimelineGroups([
      { kind: "reasoning", key: "r1", parts: [{ type: "reasoning", text: "想" }] }
    ]),
    true
  );
  assert.equal(
    hasVisibleTimelineGroups([
      { kind: "boundary", key: "b1" },
      { kind: "part", key: "p1", part: { type: "text", text: "正文" } }
    ]),
    true
  );
});

test("hidden-reasoning run: placeholder persists until text arrives", () => {
  // 模拟「隐藏推理摘要」时序：先只有 reasoning part（→boundary，不可见）→ 文本到达。
  const reasoningOnly = buildAgentAssistantRenderGroups([
    { id: "r1", type: "reasoning", text: "内部推理" }
  ]);
  const displayReasoningOnly = reasoningOnly.map((group) =>
    group.kind === "reasoning" ? { kind: "boundary", key: `boundary:${group.key}` } : group
  );
  assert.equal(hasVisibleTimelineGroups(displayReasoningOnly), false);

  const withText = buildAgentAssistantRenderGroups([
    { id: "r1", type: "reasoning", text: "内部推理" },
    { id: "t1", type: "text", text: "你好" }
  ]);
  const displayWithText = withText.map((group) =>
    group.kind === "reasoning" ? { kind: "boundary", key: `boundary:${group.key}` } : group
  );
  assert.equal(hasVisibleTimelineGroups(displayWithText), true);
});

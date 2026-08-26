import { describe, expect, it } from "vitest";
import {
  filterRootAgentSessionSummaries,
  isChildChatSessionSummary,
  isPrimaryAgentSessionSummary,
  type ChatSessionSummary
} from "./agentSessions";

describe("primary session sidebar filter", () => {
  it("treats sessionKind=subagent as child even without parentId", () => {
    expect(isChildChatSessionSummary({ sessionKind: "subagent" })).toBe(true);
    expect(isPrimaryAgentSessionSummary({ sessionKind: "subagent" })).toBe(false);
  });

  it("treats parentSessionId / parentId as child", () => {
    expect(isPrimaryAgentSessionSummary({ parentSessionId: "parent-1" })).toBe(false);
    expect(isChildChatSessionSummary({ parentId: "parent-1" })).toBe(true);
  });

  it("keeps primary sessions", () => {
    expect(isPrimaryAgentSessionSummary({ sessionKind: "primary" })).toBe(true);
    expect(isPrimaryAgentSessionSummary({})).toBe(true);
  });

  it("filterRootAgentSessionSummaries drops subagent rows", () => {
    const rows: ChatSessionSummary[] = [
      { id: "a", title: "main", createdAt: 1, updatedAt: 1, sessionKind: "primary" },
      { id: "b", title: "child", createdAt: 2, updatedAt: 2, sessionKind: "subagent" },
      { id: "c", title: "child2", createdAt: 3, updatedAt: 3, parentId: "a" }
    ];
    expect(filterRootAgentSessionSummaries(rows).map((r) => r.id)).toEqual(["a"]);
  });
});

import { describe, expect, it } from "vitest";
import { mergeHistoryMessagesPreservingLive, type AgentChatMessage } from "./agentSessions";

describe("mergeHistoryMessagesPreservingLive", () => {
  it("keeps trailing live assistant when history stopped early", () => {
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "设计一下" },
      { id: "a1", role: "assistant", content: "先调研" }
    ];
    const live: AgentChatMessage[] = [
      ...history,
      { id: "a2", role: "assistant", content: "设计已完成，落盘在 docs/..." }
    ];
    const merged = mergeHistoryMessagesPreservingLive(history, live);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "a2"]);
    expect(merged.at(-1)?.content).toContain("设计已完成");
  });

  it("enriches overlapping assistant content from live", () => {
    const history: AgentChatMessage[] = [
      { id: "a1", role: "assistant", content: "短" }
    ];
    const live: AgentChatMessage[] = [
      { id: "a1", role: "assistant", content: "更长的最终正文" }
    ];
    const merged = mergeHistoryMessagesPreservingLive(history, live, {
      pickContent: (h, l) => (l.length > h.length ? l : h)
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe("更长的最终正文");
  });
});

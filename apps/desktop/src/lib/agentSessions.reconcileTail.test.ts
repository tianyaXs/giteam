import { describe, expect, it } from "vitest";
import { reconcilePromptTailFromHistory, type AgentChatMessage } from "./agentSessions";

describe("reconcilePromptTailFromHistory", () => {
  it("appends missing final assistant from history without replacing prefix", () => {
    const current: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "是否完成了" },
      { id: "a1", role: "assistant", content: "" },
      { id: "a2", role: "assistant", content: "" }
    ];
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "是否完成了" },
      { id: "a1", role: "assistant", content: "" },
      { id: "a2", role: "assistant", content: "" },
      { id: "a3", role: "assistant", content: "P1 全部完成，总结如下：\n\n## 已交付" }
    ];
    const result = reconcilePromptTailFromHistory(current, history, {
      pickContent: (h, l) => (l.length > h.length ? l : h)
    });
    expect(result.changed).toBe(true);
    expect(result.messages.map((m) => m.id)).toEqual(["u1", "a1", "a2", "a3"]);
    expect(result.messages.at(-1)?.content).toContain("P1 全部完成");
    expect(result.touchedAssistantIds).toEqual(["a3"]);
  });

  it("patches richer content on existing assistant id", () => {
    const current: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      { id: "a-final", role: "assistant", content: "" }
    ];
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      { id: "a-final", role: "assistant", content: "完整总结正文" }
    ];
    const result = reconcilePromptTailFromHistory(current, history, {
      pickContent: (h, l) => (l.length > h.length ? l : h)
    });
    expect(result.changed).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe("完整总结正文");
    expect(result.touchedAssistantIds).toEqual(["a-final"]);
  });

  it("returns unchanged when history matches current tail", () => {
    const rows: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "done" }
    ];
    const result = reconcilePromptTailFromHistory(rows, rows, {
      pickContent: (h, l) => (l.length > h.length ? l : h)
    });
    expect(result.changed).toBe(false);
    expect(result.messages).toBe(rows);
  });

  it("does not duplicate assistant ids when reconcile runs twice", () => {
    const current: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "是否完成了" },
      { id: "a1", role: "assistant", content: "" }
    ];
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "是否完成了" },
      { id: "a1", role: "assistant", content: "" },
      { id: "a2", role: "assistant", content: "最终总结" }
    ];
    const first = reconcilePromptTailFromHistory(current, history, {
      pickContent: (h, l) => (l.length > h.length ? l : h)
    });
    const second = reconcilePromptTailFromHistory(first.messages, history, {
      pickContent: (h, l) => (l.length > h.length ? l : h)
    });
    expect(first.messages.map((m) => m.id)).toEqual(["u1", "a1", "a2"]);
    expect(second.changed).toBe(false);
    expect(second.messages.map((m) => m.id)).toEqual(["u1", "a1", "a2"]);
  });
});

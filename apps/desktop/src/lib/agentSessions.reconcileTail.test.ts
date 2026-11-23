import { describe, expect, it } from "vitest";
import {
  agentCacheHitRate,
  agentContextOccupancy,
  agentPromptTokens,
  formatAgentTokens,
  reconcilePromptTailFromHistory,
  type AgentChatMessage
} from "./agentSessions";

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

  it("counts cache writes as misses in the cache hit rate", () => {
    expect(agentCacheHitRate({ input: 100, output: 0, cacheRead: 300, cacheWrite: 100 })).toBe(60);
    expect(agentCacheHitRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 100 })).toBe(0);
    expect(agentCacheHitRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });

  it("sums disjoint prompt buckets and formats like ContextDemo", () => {
    expect(agentPromptTokens({ input: 100, output: 0, cacheRead: 300, cacheWrite: 100 })).toBe(500);
    expect(agentPromptTokens(null)).toBe(0);
    expect(formatAgentTokens(517)).toBe("517");
    expect(formatAgentTokens(12_200)).toBe("12.2k");
    expect(formatAgentTokens(8_420)).toBe("8.4k");
  });

  it("computes context occupancy like ContextDemo percent", () => {
    expect(agentContextOccupancy(32_000, 128_000)).toEqual({
      percent: 25,
      usedTokens: 32_000,
      contextWindow: 128_000
    });
    expect(agentContextOccupancy(300_000, 128_000)?.percent).toBe(100);
    expect(agentContextOccupancy(undefined, 128_000)).toBeNull();
    expect(agentContextOccupancy(1_000, 0)).toBeNull();
  });

  it("patches usage even when assistant content is unchanged", () => {
    const current: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      { id: "a1", role: "assistant", content: "done" }
    ];
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      {
        id: "a1",
        role: "assistant",
        content: "done",
        usage: { input: 100, output: 40, cacheRead: 300, cacheWrite: 100 }
      }
    ];
    const result = reconcilePromptTailFromHistory(current, history);
    expect(result.changed).toBe(true);
    expect(result.messages[1].usage).toEqual(history[1].usage);
    expect(reconcilePromptTailFromHistory(result.messages, history).changed).toBe(false);
  });

  it("patches cumulative session usage without depending on message pagination", () => {
    const current: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      { id: "a1", role: "assistant", content: "done" }
    ];
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "go" },
      {
        id: "a1",
        role: "assistant",
        content: "done",
        sessionUsage: { input: 1_000, output: 200, cacheRead: 4_000, cacheWrite: 500 }
      }
    ];
    const result = reconcilePromptTailFromHistory(current, history);
    expect(agentCacheHitRate(result.messages[1].sessionUsage)).toBe(73);
    expect(reconcilePromptTailFromHistory(result.messages, history).changed).toBe(false);
  });

  /**
   * 回归（2026-11-23）：多条同文「继续」时禁止按 content 从后往前错锚，
   * 否则会把 history 尾助手并到错误的 user 回合。
   */
  it("does not anchor the latest continue by content alone", () => {
    const current: AgentChatMessage[] = [
      { id: "u-old", role: "user", content: "继续", turnId: "t1" },
      { id: "a-retry", role: "assistant", content: "", error: "已暂停", turnId: "t1" },
      { id: "u-new", role: "user", content: "继续", turnId: "t2" },
      { id: "a-new", role: "assistant", content: "", turnId: "t2" }
    ];
    const history: AgentChatMessage[] = [
      { id: "srv-old", role: "user", content: "继续" },
      { id: "srv-a-old", role: "assistant", content: "旧轮总结" },
      { id: "srv-new", role: "user", content: "继续" },
      { id: "srv-a-new", role: "assistant", content: "新轮总结" }
    ];
    // 无 id/turnId/映射时不得靠同文命中 srv-new，应原样返回。
    const withoutMap = reconcilePromptTailFromHistory(current, history);
    expect(withoutMap.changed).toBe(false);
    expect(withoutMap.messages.map((m) => m.id)).toEqual(["u-old", "a-retry", "u-new", "a-new"]);

    // 有映射时只对账当前轮（u-new → srv-new）的 tail。
    const withMap = reconcilePromptTailFromHistory(current, history, {
      pickContent: (h, l) => (l.length > h.length ? l : h),
      serverIdByLocalId: { "u-new": "srv-new" }
    });
    expect(withMap.changed).toBe(true);
    expect(withMap.messages.map((m) => m.id)).toEqual([
      "u-old",
      "a-retry",
      "u-new",
      "srv-a-new"
    ]);
    expect(withMap.messages.at(-1)?.content).toBe("新轮总结");
  });
});

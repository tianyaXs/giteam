import { describe, expect, it } from "vitest";
import {
  mergeHistoryMessagesPreservingLive,
  mergeHistoryWithLiveTimeline,
  type AgentChatMessage
} from "./agentSessions";

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

/**
 * 回归（2026-11-12）：暂停回滚的 assistant 保留行必须留在本地时间线原位。
 * 尾部追加会把它们挪到暂停后新发消息之后——实证场景：暂停后发「继续」，
 * 重进会话后保留行跑到两条「继续」后面，时序错乱。
 */
describe("mergeHistoryWithLiveTimeline", () => {
  it("keeps rolled-back assistant before messages sent after the pause", () => {
    // history：服务端视角（a2 被暂停回滚，不存在；「继续」是暂停后新发）
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "打开微博热搜榜" },
      { id: "a1", role: "assistant", content: "我来打开微博热搜榜看看。" },
      { id: "c1", role: "user", content: "继续" },
      { id: "b1", role: "assistant", content: "收到，我再试一次。" }
    ];
    // live：本地时间线（a2 是暂停保留行；c1 是 optimistic user）
    const live: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "打开微博热搜榜" },
      { id: "a1", role: "assistant", content: "我来打开微博热搜榜看看。" },
      { id: "a2", role: "assistant", content: "内置浏览器没响应，改用系统 Safari。" },
      { id: "c1l", role: "user", content: "继续" },
      { id: "b1", role: "assistant", content: "收到，我再试一次。" }
    ];
    const merged = mergeHistoryWithLiveTimeline(history, live, {
      serverIdByLocalId: { c1l: "c1" }
    });
    // 映射配对行输出保留 live 本地 id（stableKey 稳定，防 Virtuoso 重挂闪动）
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "a2", "c1l", "b1"]);
    const a2Index = merged.findIndex((m) => m.id === "a2");
    const c1Index = merged.findIndex((m) => m.id === "c1l");
    expect(a2Index).toBeLessThan(c1Index);
    // 内容仍是服务端版本（history 为真相），仅 id 沿用本地
    expect(merged.find((m) => m.id === "c1l")?.content).toBe("继续");
  });

  /**
   * 回归（2026-11-12）：映射配对的输出行 id 保留 live 本地 id。
   * 若输出改用 history 的服务端 id，loadAgentSessionMessages 整表替换后
   * stableKey 变化 → Virtuoso 卸载重挂 → 列表闪动（每回合 load 一次）。
   * 幂等性：重复 load（同一 history + 已保留本地 id 的 live）输出必须稳定。
   */
  it("keeps live local id for mapped rows and stays idempotent across loads", () => {
    const history: AgentChatMessage[] = [
      { id: "srv-1", role: "user", content: "打开微博热搜榜" }
    ];
    const live: AgentChatMessage[] = [
      { id: "local-1", role: "user", content: "打开微博热搜榜" }
    ];
    const options = { serverIdByLocalId: { "local-1": "srv-1" } };
    const first = mergeHistoryWithLiveTimeline(history, live, options);
    expect(first.map((m) => m.id)).toEqual(["local-1"]);
    expect(first[0].content).toBe("打开微博热搜榜");
    // 第二次 load：live 已是上次输出（local id），结果必须一致
    const second = mergeHistoryWithLiveTimeline(history, first, options);
    expect(second.map((m) => m.id)).toEqual(["local-1"]);
  });

  it("keeps multiple rolled-back groups in order across repeated pauses", () => {
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "打开微博热搜榜" },
      { id: "c1", role: "user", content: "继续" },
      { id: "c2", role: "user", content: "继续" }
    ];
    const live: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "打开微博热搜榜" },
      { id: "a2", role: "assistant", content: "第一轮暂停保留行" },
      { id: "c1l", role: "user", content: "继续" },
      { id: "a3", role: "assistant", content: "第二轮暂停保留行" },
      { id: "c2l", role: "user", content: "继续" }
    ];
    const merged = mergeHistoryWithLiveTimeline(history, live, {
      serverIdByLocalId: { c1l: "c1", c2l: "c2" }
    });
    expect(merged.map((m) => m.id)).toEqual(["u1", "a2", "c1l", "a3", "c2l"]);
  });

  it("drops blank live assistants without visible parts", () => {
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "hi" }
    ];
    const live: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "ax", role: "assistant", content: "" }
    ];
    const merged = mergeHistoryWithLiveTimeline(history, live);
    expect(merged.map((m) => m.id)).toEqual(["u1"]);
  });

  /**
   * 回归（2026-11-12）：finalize 写入本地的「已暂停」终态是本地通道字段
   * （服务端历史不回传失败事件），merge 输出 history 版本时不能冲掉，
   * 否则暂停标记闪现后消失（用户观感 = 标记抖动）。
   */
  it("keeps locally written pause failure text when history row has no error", () => {
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "打开微博热搜榜" },
      { id: "a1", role: "assistant", content: "我来打开微博热搜榜看看。" }
    ];
    const live: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "打开微博热搜榜" },
      { id: "a1", role: "assistant", content: "我来打开微博热搜榜看看。", error: "已暂停" }
    ];
    const merged = mergeHistoryWithLiveTimeline(history, live);
    expect(merged).toHaveLength(2);
    expect(merged[1].error).toBe("已暂停");
  });

  it("falls back to appending unconsumed history rows at the tail", () => {
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "srv-only", role: "assistant", content: "服务端独有回复" }
    ];
    const live: AgentChatMessage[] = [
      { id: "u1", role: "user", content: "hi" }
    ];
    const merged = mergeHistoryWithLiveTimeline(history, live);
    expect(merged.map((m) => m.id)).toEqual(["u1", "srv-only"]);
  });
});

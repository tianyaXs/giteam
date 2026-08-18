import { describe, expect, it } from "vitest";
import {
  appendAssistantMessage,
  commitUserBeforeLiveAssistant,
  consumeQueuedFollowUp,
  dropQueuedFollowUpsAlreadyInTranscript,
  removeQueuedFollowUpById,
  type AgentChatMessage
} from "./agentSessions";

function msg(id: string, role: "user" | "assistant", content = ""): AgentChatMessage {
  return { id, role, content };
}

describe("commitUserBeforeLiveAssistant", () => {
  it("appends when there is no live assistant", () => {
    const rows = [msg("u1", "user", "北京"), msg("a1", "assistant", "晴")];
    const next = commitUserBeforeLiveAssistant(rows, msg("u2", "user", "上海"));
    expect(next.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("inserts before the live assistant cell", () => {
    const rows = [msg("u1", "user", "北京"), msg("a-live", "assistant", "")];
    const next = commitUserBeforeLiveAssistant(rows, msg("u2", "user", "上海"), "a-live");
    expect(next.map((m) => m.id)).toEqual(["u1", "u2", "a-live"]);
  });

  it("does not duplicate an already-committed user id", () => {
    const rows = [msg("u1", "user", "北京"), msg("a-live", "assistant", "")];
    const next = commitUserBeforeLiveAssistant(rows, msg("u1", "user", "北京天气如何"), "a-live");
    expect(next.map((m) => m.id)).toEqual(["u1", "a-live"]);
    expect(next[0]?.content).toBe("北京天气如何");
  });
});

describe("appendAssistantMessage", () => {
  it("appends a new assistant after existing text", () => {
    const rows = [msg("u1", "user", "南京"), msg("a-text", "assistant", "多云")];
    const next = appendAssistantMessage(rows, msg("a-tools", "assistant", ""));
    expect(next.map((m) => m.id)).toEqual(["u1", "a-text", "a-tools"]);
  });
});

describe("consumeQueuedFollowUp", () => {
  it("pops the matching follow-up by content", () => {
    const queue = [
      { id: "q1", content: "上海呢" },
      { id: "q2", content: "还有南京" }
    ];
    const next = consumeQueuedFollowUp(queue, "上海呢");
    expect(next.consumed?.id).toBe("q1");
    expect(next.queue.map((item) => item.id)).toEqual(["q2"]);
  });

  it("does not drop the next item when content does not match", () => {
    const queue = [
      { id: "q1", content: "上海呢" },
      { id: "q2", content: "还有南京" }
    ];
    const next = consumeQueuedFollowUp(queue, "北京天气如何");
    expect(next.consumed).toBeNull();
    expect(next.queue.map((item) => item.id)).toEqual(["q1", "q2"]);
  });
});

describe("dropQueuedFollowUpsAlreadyInTranscript", () => {
  it("drops follow-ups that already landed as user bubbles", () => {
    const queue = [
      { id: "q1", content: "上海呢" },
      { id: "q2", content: "还有南京" }
    ];
    const next = dropQueuedFollowUpsAlreadyInTranscript(queue, [
      msg("u1", "user", "北京"),
      msg("u2", "user", "还有南京")
    ]);
    expect(next.map((item) => item.id)).toEqual(["q1"]);
  });
});

describe("removeQueuedFollowUpById", () => {
  it("removes only the matching queued item", () => {
    const queue = [
      { id: "q1", content: "上海呢" },
      { id: "q2", content: "还有南京" }
    ];
    expect(removeQueuedFollowUpById(queue, "q1").map((item) => item.id)).toEqual(["q2"]);
    expect(removeQueuedFollowUpById(queue, "missing")).toEqual(queue);
  });
});

import { describe, expect, it } from "vitest";
import {
  appendAssistantMessage,
  commitUserBeforeLiveAssistant,
  consumeQueuedFollowUp,
  dropQueuedFollowUpsAlreadyInTranscript,
  appendQueuedFollowUp,
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

  it("appends when the live assistant is not the tail", () => {
    const rows = [
      msg("u1", "user", "北京"),
      msg("a-old", "assistant", "旧回复"),
      msg("u2", "user", "南京"),
      msg("a-new", "assistant", "")
    ];
    const next = commitUserBeforeLiveAssistant(rows, msg("u3", "user", "上海"), "a-old");
    expect(next.map((m) => m.id)).toEqual(["u1", "a-old", "u2", "a-new", "u3"]);
  });

  it("updates the unanswered tail user in place instead of inserting a second copy", () => {
    const rows = [
      msg("u1", "user", "继续"),
      msg("a1", "assistant", "上一轮"),
      msg("u2", "user", "上海"),
      msg("a-live", "assistant", "")
    ];
    const next = commitUserBeforeLiveAssistant(rows, msg("srv", "user", "上海"), "a1");
    expect(next.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a-live"]);
  });

  it("appends after a finished reply instead of inserting in front of it", () => {
    const rows = [
      msg("u1", "user", "继续"),
      msg("a1", "assistant", "上一轮")
    ];
    const next = commitUserBeforeLiveAssistant(rows, msg("u2", "user", "继续"), "a1");
    expect(next.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  /**
   * 回归（2026-11-23）：终止重试后 assistant 无正文但有 error / retry live。
   * 若仍当开放占位，后续「继续」会插到重试行前面 → 回复跑到发送消息上面。
   */
  it("appends after an aborted retry assistant instead of inserting in front", () => {
    const rows = [
      msg("u1", "user", "继续"),
      { id: "a-retry", role: "assistant" as const, content: "", error: "已暂停" }
    ];
    const next = commitUserBeforeLiveAssistant(rows, msg("u2", "user", "继续"), "a-retry");
    expect(next.map((m) => m.id)).toEqual(["u1", "a-retry", "u2"]);
  });

  it("appends after a retry-only live assistant when isStillOpenAssistant says closed", () => {
    const rows = [
      msg("u1", "user", "继续"),
      msg("a-retry", "assistant", "")
    ];
    const next = commitUserBeforeLiveAssistant(rows, msg("u2", "user", "继续"), "a-retry", {
      isStillOpenAssistant: (id) => id !== "a-retry"
    });
    expect(next.map((m) => m.id)).toEqual(["u1", "a-retry", "u2"]);
  });

  it("does not treat aborted retry as unanswered when re-sending the same text", () => {
    const rows = [
      msg("u1", "user", "继续"),
      { id: "a-retry", role: "assistant" as const, content: "", error: "已暂停" }
    ];
    const next = commitUserBeforeLiveAssistant(rows, msg("u2", "user", "继续"), "a-retry");
    expect(next.map((m) => m.id)).toEqual(["u1", "a-retry", "u2"]);
    expect(next[0]?.id).toBe("u1");
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

describe("appendQueuedFollowUp", () => {
  it("appends when the queue is empty", () => {
    let n = 0;
    const next = appendQueuedFollowUp([], "上海呢", () => `q${++n}`);
    expect(next).toEqual([{ id: "q1", content: "上海呢" }]);
  });

  it("accumulates instead of replacing existing pending follow-ups", () => {
    const queue = [
      { id: "q1", content: "上海呢" },
      { id: "q2", content: "还有南京" }
    ];
    const next = appendQueuedFollowUp(queue, "再问苏州", () => "q3");
    expect(next).toEqual([
      { id: "q1", content: "上海呢" },
      { id: "q2", content: "还有南京" },
      { id: "q3", content: "再问苏州" }
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyTurnIdReconciliation,
  appendAssistantMessage,
  commitUserBeforeLiveAssistant,
  consumeQueuedFollowUp,
  dropQueuedFollowUpsAlreadyInTranscript,
  appendQueuedFollowUp,
  mergeHistoryWithLiveTimeline,
  reconcilePendingUserTurns,
  removeQueuedFollowUpById,
  resolveBindLocalUserIdForCommit,
  upsertCommittedUserMessage,
  reconcileLiveTimelineFromHistory,
  type AgentChatMessage,
  type OpenUserTurn
} from "./agentSessions";

function msg(id: string, role: "user" | "assistant", content = ""): AgentChatMessage {
  return { id, role, content };
}

describe("upsertCommittedUserMessage", () => {
  it("appends when there is no live assistant", () => {
    const rows = [msg("u1", "user", "北京"), msg("a1", "assistant", "晴")];
    const next = upsertCommittedUserMessage(rows, msg("u2", "user", "上海"));
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(next.inserted).toBe(true);
  });

  it("inserts before the live assistant cell", () => {
    const rows = [msg("u1", "user", "北京"), msg("a-live", "assistant", "")];
    const next = upsertCommittedUserMessage(rows, msg("u2", "user", "上海"), {
      liveAssistantId: "a-live"
    });
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "u2", "a-live"]);
  });

  it("appends when the live assistant is not the tail", () => {
    const rows = [
      msg("u1", "user", "北京"),
      msg("a-old", "assistant", "旧回复"),
      msg("u2", "user", "南京"),
      msg("a-new", "assistant", "")
    ];
    const next = upsertCommittedUserMessage(rows, msg("u3", "user", "上海"), {
      liveAssistantId: "a-old"
    });
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "a-old", "u2", "a-new", "u3"]);
  });

  it("binds server completed onto optimistic local id without duplicating", () => {
    const rows = [
      msg("u1", "user", "继续"),
      msg("a1", "assistant", "上一轮"),
      msg("u2", "user", "上海"),
      msg("a-live", "assistant", "")
    ];
    const next = upsertCommittedUserMessage(rows, msg("srv", "user", "上海"), {
      bindLocalUserId: "u2",
      liveAssistantId: "a1"
    });
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a-live"]);
    expect(next.localUserId).toBe("u2");
    expect(next.inserted).toBe(false);
  });

  it("does not merge by same text alone — intentional resend appends", () => {
    const rows = [
      msg("u1", "user", "继续"),
      msg("a1", "assistant", "上一轮")
    ];
    const next = upsertCommittedUserMessage(rows, msg("u2", "user", "继续"), {
      liveAssistantId: "a1"
    });
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("appends after an aborted retry assistant instead of inserting in front", () => {
    const rows = [
      msg("u1", "user", "继续"),
      { id: "a-retry", role: "assistant" as const, content: "", error: "已暂停" }
    ];
    const next = upsertCommittedUserMessage(rows, msg("u2", "user", "继续"), {
      liveAssistantId: "a-retry"
    });
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "a-retry", "u2"]);
  });

  it("appends after a retry-only live assistant when isStillOpenAssistant says closed", () => {
    const rows = [
      msg("u1", "user", "继续"),
      msg("a-retry", "assistant", "")
    ];
    const next = upsertCommittedUserMessage(rows, msg("u2", "user", "继续"), {
      liveAssistantId: "a-retry",
      isStillOpenAssistant: (id) => id !== "a-retry"
    });
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "a-retry", "u2"]);
  });

  it("remaps server user onto optimistic local user after pause via bindLocalUserId", () => {
    const rows = [
      {
        id: "user-a1b2c3d4e5f6",
        role: "user" as const,
        content: "能不能看到文件内容",
        turnId: "turn-run-1",
        attachments: [
          {
            id: "f1",
            kind: "file" as const,
            uri: "data:application/pdf;base64,AAAA",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename: "02-总体设计方案.docx"
          }
        ]
      },
      { id: "assistant-live", role: "assistant" as const, content: "", error: "已暂停" }
    ];
    // 真实 Pi 服务端 id：user-<millis>。禁止靠 id 形态猜测，必须显式 bind。
    const next = upsertCommittedUserMessage(
      rows,
      {
        ...msg("user-1730000000000", "user", "能不能看到文件内容"),
        turnId: "turn-run-1"
      },
      {
        bindLocalUserId: "user-a1b2c3d4e5f6",
        liveAssistantId: "assistant-live"
      }
    );
    expect(next.messages.map((m) => m.id)).toEqual(["user-a1b2c3d4e5f6", "assistant-live"]);
    expect(next.localUserId).toBe("user-a1b2c3d4e5f6");
    expect(next.messages[0]?.attachments?.[0]?.filename).toBe("02-总体设计方案.docx");
  });

  it("remaps via turnId when bindLocalUserId was cleared", () => {
    const rows = [
      { id: "user-local", role: "user" as const, content: "你好", turnId: "turn-9" },
      { id: "a1", role: "assistant" as const, content: "", error: "已暂停" }
    ];
    const next = upsertCommittedUserMessage(
      rows,
      { id: "user-1730000000000", role: "user", content: "你好", turnId: "turn-9" },
      { liveAssistantId: "a1" }
    );
    expect(next.messages.map((m) => m.id)).toEqual(["user-local", "a1"]);
    expect(next.localUserId).toBe("user-local");
  });

  it("remaps via serverIdByLocalId for late remote completed", () => {
    const rows = [
      { id: "user-local", role: "user" as const, content: "文件", turnId: "turn-1" },
      { id: "a1", role: "assistant" as const, content: "", error: "已暂停" }
    ];
    const next = upsertCommittedUserMessage(
      rows,
      msg("user-1730000000000", "user", "文件"),
      {
        serverIdByLocalId: { "user-local": "user-1730000000000" },
        liveAssistantId: "a1"
      }
    );
    expect(next.messages.map((m) => m.id)).toEqual(["user-local", "a1"]);
    expect(next.inserted).toBe(false);
  });

  it("still appends intentional same-text resend after pause with a new bind id", () => {
    const rows = [
      msg("user-aaaaaaaaaaaa", "user", "继续"),
      { id: "a-retry", role: "assistant" as const, content: "", error: "已暂停" }
    ];
    const next = upsertCommittedUserMessage(
      rows,
      msg("user-bbbbbbbbbbbb", "user", "继续"),
      { liveAssistantId: "a-retry" }
    );
    expect(next.messages.map((m) => m.id)).toEqual([
      "user-aaaaaaaaaaaa",
      "a-retry",
      "user-bbbbbbbbbbbb"
    ]);
  });

  it("does not duplicate an already-committed user id", () => {
    const rows = [msg("u1", "user", "北京"), msg("a-live", "assistant", "")];
    const next = upsertCommittedUserMessage(rows, msg("u1", "user", "北京天气如何"), {
      liveAssistantId: "a-live"
    });
    expect(next.messages.map((m) => m.id)).toEqual(["u1", "a-live"]);
    expect(next.messages[0]?.content).toBe("北京天气如何");
    expect(next.inserted).toBe(false);
  });
});

describe("resolveBindLocalUserIdForCommit", () => {
  it("prefers existing mapping over pending head", () => {
    const open: Record<string, OpenUserTurn | null> = {
      s1: { localUserId: "user-pending-2", turnId: "turn-2" }
    };
    const bind = resolveBindLocalUserIdForCommit({
      sessionId: "s1",
      serverUserId: "user-1730000000000",
      pendingLocalId: "user-pending-2",
      openTurnBySession: open,
      serverIdByLocalId: { "user-local-1": "user-1730000000000" }
    });
    expect(bind).toBe("user-local-1");
  });

  it("uses open-turn when mapping missing and server not yet bound", () => {
    const open: Record<string, OpenUserTurn | null> = {
      s1: { localUserId: "user-local", turnId: "turn-1" }
    };
    const bind = resolveBindLocalUserIdForCommit({
      sessionId: "s1",
      serverUserId: "user-1730000000000",
      pendingLocalId: "user-local",
      openTurnBySession: open,
      serverIdByLocalId: {}
    });
    expect(bind).toBe("user-local");
  });

  it("does not reuse open-turn bound to a different server id", () => {
    const open: Record<string, OpenUserTurn | null> = {
      s1: {
        localUserId: "user-local",
        turnId: "turn-1",
        serverUserId: "user-other"
      }
    };
    const bind = resolveBindLocalUserIdForCommit({
      sessionId: "s1",
      serverUserId: "user-1730000000000",
      pendingLocalId: "user-next",
      openTurnBySession: open,
      serverIdByLocalId: {}
    });
    expect(bind).toBe("user-next");
  });
});

describe("commitUserBeforeLiveAssistant", () => {
  it("delegates to upsert with explicit bindLocalUserId", () => {
    const rows = [msg("u1", "user", "上海"), msg("a-live", "assistant", "")];
    const next = commitUserBeforeLiveAssistant(
      rows,
      msg("srv", "user", "上海"),
      "a-live",
      { bindLocalUserId: "u1" }
    );
    expect(next.map((m) => m.id)).toEqual(["u1", "a-live"]);
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

describe("reconcilePendingUserTurns", () => {
  it("pairs a committed history user with the pending optimistic id by FIFO", () => {
    const result = reconcilePendingUserTurns({
      historyUsers: [{ id: "user-1730000000000" }],
      liveUserIds: new Set(["user-local"]),
      pendingLocalUserIds: ["user-local"],
      serverIdByLocalId: {}
    });
    expect(result.serverIdByLocalId).toEqual({ "user-local": "user-1730000000000" });
    expect(result.pendingLocalUserIds).toEqual([]);
    expect(result.matchedCount).toBe(1);
  });

  it("does not pair rows that already exist on both sides", () => {
    const result = reconcilePendingUserTurns({
      historyUsers: [{ id: "user-1730000000000" }],
      liveUserIds: new Set(["user-1730000000000"]),
      pendingLocalUserIds: [],
      serverIdByLocalId: {}
    });
    expect(result.matchedCount).toBe(0);
    expect(result.serverIdByLocalId).toEqual({});
  });
});

describe("pause turn identity reconciliation", () => {
  it("merges the same paused turn into one row once the mapping is authoritative", () => {
    const history: AgentChatMessage[] = [
      { id: "user-1730000000000", role: "user", content: "能不能看到文件内容" }
    ];
    const live: AgentChatMessage[] = [
      {
        id: "user-local",
        role: "user",
        content: "能不能看到文件内容",
        turnId: "turn-run-1"
      },
      { id: "assistant-live", role: "assistant", content: "", error: "已暂停" }
    ];

    // 对账前：映射缺失，归并按身份各自成回合（暂停后双行复现）。
    const before = mergeHistoryWithLiveTimeline(history, live, { serverIdByLocalId: {} });
    expect(before.filter((row) => row.role === "user")).toHaveLength(2);

    // 权威回填映射 + turnId 后：归并只保留一个 user 行。
    const reconciled = reconcilePendingUserTurns({
      historyUsers: history,
      liveUserIds: new Set(["user-local"]),
      pendingLocalUserIds: ["user-local"],
      serverIdByLocalId: {}
    });
    const turnPatch = applyTurnIdReconciliation(
      live,
      reconciled.serverIdByLocalId,
      new Map(history.map((row) => [row.id, row.turnId || ""]))
    );
    expect(turnPatch.changed).toBe(false);
    const after = mergeHistoryWithLiveTimeline(
      history,
      turnPatch.messages,
      { serverIdByLocalId: reconciled.serverIdByLocalId }
    );
    const userRows = after.filter((row) => row.role === "user");
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.id).toBe("user-local");
    expect(userRows[0]?.turnId).toBe("turn-run-1");
  });

  it("backfills a missing turnId from the authoritative history turn", () => {
    const rows: AgentChatMessage[] = [
      { id: "user-local", role: "user", content: "hello" }
    ];
    const patch = applyTurnIdReconciliation(
      rows,
      { "user-local": "user-1730000000000" },
      new Map([["user-1730000000000", "turn-run-9"]])
    );
    expect(patch.changed).toBe(true);
    expect(patch.messages[0]?.turnId).toBe("turn-run-9");
  });

  /**
   * 回归（2026-11-24）：loaded 会话中途收到 history（含 aborted assistant + 同文
   * user）时，即使三类配对键（turnId / id / local→server 映射）全部缺失，
   * 中途对账也必须保持 live user 为唯一行，而不是与 history 回合并排。
   */
  it("keeps a single live user when mid-session history misses every anchor", () => {
    const history: AgentChatMessage[] = [
      { id: "user-1795492672723", role: "user", content: "能不能看到文件内容" },
      { id: "asst-5a8295e3", role: "assistant", content: "已经读到了文件内容", error: "已暂停" }
    ];
    const live: AgentChatMessage[] = [
      { id: "user-local", role: "user", content: "能不能看到文件内容" },
      { id: "assistant-local", role: "assistant", content: "", error: "已暂停" }
    ];

    const result = reconcileLiveTimelineFromHistory(live, history, { serverIdByLocalId: {} });
    expect(result.messages.map((row) => row.id)).toEqual(["user-local", "assistant-local"]);
    expect(result.messages.filter((row) => row.role === "user")).toHaveLength(1);
    expect(result.messages[1]?.id).toBe("assistant-local");
  });

  it("backfills the history assistant tail into the live turn when the anchor binds", () => {
    const history: AgentChatMessage[] = [
      { id: "user-1795492672723", role: "user", content: "能不能看到文件内容", turnId: "turn-run-1" },
      { id: "asst-5a8295e3", role: "assistant", content: "已经读到了文件内容" }
    ];
    const live: AgentChatMessage[] = [
      { id: "user-local", role: "user", content: "能不能看到文件内容", turnId: "turn-run-1" },
      { id: "assistant-local", role: "assistant", content: "", error: "已暂停" }
    ];

    const result = reconcileLiveTimelineFromHistory(live, history, {
      hasLiveParts: (id) => id === "assistant-local"
    });
    expect(result.changed).toBe(true);
    expect(result.messages.map((row) => row.id)).toEqual([
      "user-local",
      "asst-5a8295e3",
      "assistant-local"
    ]);
    expect(result.messages.filter((row) => row.role === "user")).toHaveLength(1);
    expect(result.bindLocalUserId).toBe("");
    expect(result.touchedAssistantIds).toContain("asst-5a8295e3");
  });

  it("binds the live user via the authoritative mapping and keeps one row", () => {
    const history: AgentChatMessage[] = [
      { id: "user-1795492672723", role: "user", content: "能不能看到文件内容", turnId: "turn-run-1" },
      { id: "asst-5a8295e3", role: "assistant", content: "已经读到了文件内容" }
    ];
    const live: AgentChatMessage[] = [
      { id: "user-local", role: "user", content: "能不能看到文件内容", turnId: "turn-run-1" },
      { id: "assistant-local", role: "assistant", content: "", error: "已暂停" }
    ];

    const result = reconcileLiveTimelineFromHistory(live, history, {
      serverIdByLocalId: { "user-local": "user-1795492672723" }
    });
    expect(result.messages.filter((row) => row.role === "user")).toHaveLength(1);
    expect(result.messages[0]?.id).toBe("user-local");
    expect(result.bindLocalUserId).toBe("user-local");
  });
});

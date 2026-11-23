import { describe, expect, it } from "vitest";
import {
  assistantTurnPhase,
  canInsertUserBeforeAssistant,
  canRemapAssistantForTurn,
  canRemapAssistantPlaceholder,
  coalesceRuntimeParts,
  mayMergeAdjacentAssistants,
  shouldKeepLiveAssistant,
  type AgentDetailedPart
} from "./agentParts";

const startedRetry = {
  id: "runtime.retry",
  type: "runtime.retry",
  phase: "started",
  status: "running",
  attempt: 2,
  maxAttempts: 10
} as AgentDetailedPart;

const settledRetry = {
  id: "runtime.retry",
  type: "runtime.retry",
  phase: "completed",
  success: false,
  status: "error",
  attempt: 3,
  maxAttempts: 10,
  error: "重试已中止"
} as AgentDetailedPart;

describe("assistantTurnPhase", () => {
  it("open: no content/error and no substantive parts", () => {
    expect(assistantTurnPhase({ id: "assistant-1", content: "" }, [])).toBe("open");
    expect(assistantTurnPhase(null, null)).toBe("open");
  });

  it("active: in-progress runtime.retry without settled content", () => {
    expect(assistantTurnPhase({ id: "assistant-1", content: "" }, [startedRetry])).toBe("active");
  });

  it("settled: error, settled retry, tools, or non-empty text", () => {
    expect(assistantTurnPhase({ id: "a", error: "已暂停" }, [])).toBe("settled");
    expect(assistantTurnPhase({ id: "a", content: "hi" }, [])).toBe("settled");
    expect(assistantTurnPhase({ id: "a" }, [settledRetry])).toBe("settled");
    expect(
      assistantTurnPhase({ id: "a" }, [
        { id: "toolCall:1", type: "toolCall", toolName: "bash" } as AgentDetailedPart
      ])
    ).toBe("settled");
    expect(
      assistantTurnPhase({ id: "a" }, [
        { id: "text:0", type: "text", text: "正文" } as AgentDetailedPart
      ])
    ).toBe("settled");
  });
});

describe("phase-derived remap / insert / keep", () => {
  it("active+retry can remap; settled cannot", () => {
    const openMsg = { id: "assistant-local", content: "" };
    expect(canRemapAssistantPlaceholder(openMsg, [startedRetry])).toBe(true);
    expect(canRemapAssistantPlaceholder(openMsg, [settledRetry])).toBe(false);
    expect(canRemapAssistantPlaceholder({ id: "msg-server", content: "" }, [])).toBe(false);
  });

  it("only open allows insert-before; active/settled keep live", () => {
    const msg = { id: "assistant-1", content: "" };
    expect(canInsertUserBeforeAssistant(msg, [])).toBe(true);
    expect(canInsertUserBeforeAssistant(msg, [startedRetry])).toBe(false);
    expect(canInsertUserBeforeAssistant(msg, [settledRetry])).toBe(false);

    expect(shouldKeepLiveAssistant(msg, [])).toBe(false);
    expect(shouldKeepLiveAssistant(msg, [startedRetry])).toBe(true);
    expect(shouldKeepLiveAssistant(msg, [settledRetry])).toBe(true);
  });
});

describe("canRemapAssistantForTurn", () => {
  it("reuses the same turn even after the id is a server id and the attempt settled", () => {
    const last = {
      id: "msg-server-1",
      role: "assistant" as const,
      turnId: "turn-run",
      content: "",
      error: "HTTP 500"
    };
    expect(canRemapAssistantForTurn(last, "turn-run", [settledRetry], { frozen: true })).toBe(true);
    expect(canRemapAssistantPlaceholder(last, [settledRetry])).toBe(false);
  });

  it("does not swallow a settled assistant that already has tools or text", () => {
    const last = {
      id: "msg-server-1",
      role: "assistant" as const,
      turnId: "turn-run",
      content: ""
    };
    expect(
      canRemapAssistantForTurn(last, "turn-run", [
        { id: "toolCall:1", type: "toolCall", toolName: "bash" } as AgentDetailedPart
      ])
    ).toBe(false);
    expect(
      canRemapAssistantForTurn(
        { ...last, content: "先看目录" },
        "turn-run",
        [{ id: "text:0", type: "text", text: "先看目录" } as AgentDetailedPart]
      )
    ).toBe(false);
  });

  it("does not reuse a different turn", () => {
    const last = {
      id: "msg-server-1",
      role: "assistant" as const,
      turnId: "turn-prev",
      content: "已回复"
    };
    expect(canRemapAssistantForTurn(last, "turn-next", null)).toBe(false);
  });
});

describe("mayMergeAdjacentAssistants (UI turn gate)", () => {
  it("same turnId may merge; different or missing turnId must not", () => {
    expect(mayMergeAdjacentAssistants("turn-a", "turn-a")).toBe(true);
    expect(mayMergeAdjacentAssistants("turn-a", "turn-b")).toBe(false);
    expect(mayMergeAdjacentAssistants("turn-a", "")).toBe(false);
    expect(mayMergeAdjacentAssistants("", "")).toBe(false);
  });

  it("same turnId merge then coalesce keeps highest retry attempt", () => {
    expect(mayMergeAdjacentAssistants("t1", "t1")).toBe(true);
    const coalesced = coalesceRuntimeParts([
      { ...settledRetry, attempt: 2 },
      { ...settledRetry, attempt: 5 }
    ]);
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]).toMatchObject({ type: "runtime.retry", attempt: 5 });
  });
});

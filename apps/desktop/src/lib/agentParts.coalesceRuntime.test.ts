import { describe, expect, it } from "vitest";
import { coalesceRuntimeParts } from "./agentParts";

describe("coalesceRuntimeParts", () => {
  it("drops successful runtime.retry so it does not stick under latest text", () => {
    const parts = [
      { id: "text:0", type: "text", text: "最终回复" },
      {
        id: "runtime.retry",
        type: "runtime.retry",
        phase: "completed",
        success: true,
        attempt: 2
      }
    ] as any[];
    const next = coalesceRuntimeParts(parts);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ type: "text", text: "最终回复" });
  });

  it("keeps in-progress and failed retry at the end", () => {
    const started = coalesceRuntimeParts([
      { id: "text:0", type: "text", text: "..." },
      { id: "runtime.retry", type: "runtime.retry", phase: "started", attempt: 1 }
    ] as any[]);
    expect(started.at(-1)).toMatchObject({ type: "runtime.retry", phase: "started" });

    const failed = coalesceRuntimeParts([
      { id: "text:0", type: "text", text: "..." },
      {
        id: "runtime.retry",
        type: "runtime.retry",
        phase: "completed",
        success: false,
        error: "timeout"
      }
    ] as any[]);
    expect(failed.at(-1)).toMatchObject({ type: "runtime.retry", success: false });
  });
});

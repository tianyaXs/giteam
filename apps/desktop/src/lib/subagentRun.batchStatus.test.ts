import { describe, expect, it } from "vitest";
import {
  buildBatchTaskChildPartsFromDetails,
  enrichTaskToolPart
} from "./subagentRun";

describe("enrichTaskToolPart terminal status", () => {
  it("drops stale running subagentStatus when status is completed", () => {
    const next = enrichTaskToolPart({
      id: "task-1:0",
      type: "toolCall",
      toolCallId: "task-1:0",
      toolName: "task",
      status: "completed",
      subagentStatus: "running",
      output: "调研完成"
    } as any);
    expect((next as { subagentStatus?: string }).subagentStatus).toBe("completed");
  });

  it("keeps aborted when output indicates abort", () => {
    const next = enrichTaskToolPart({
      id: "task-1:0",
      type: "toolCall",
      toolCallId: "task-1:0",
      toolName: "task",
      status: "error",
      subagentStatus: "running",
      output: "Tool execution aborted"
    } as any);
    expect((next as { subagentStatus?: string }).subagentStatus).toBe("aborted");
  });
});

describe("buildBatchTaskChildPartsFromDetails", () => {
  it("fans out details.tasks into parent:index completion parts", () => {
    const children = buildBatchTaskChildPartsFromDetails(
      "tool_abc",
      {
        tasks: [
          { index: 0, ok: true, childSessionId: "child-a", toolCount: 33, elapsedMs: 1000 },
          { index: 1, ok: true, childSessionId: "child-b", toolCount: 33, elapsedMs: 2000 },
          { index: 2, ok: false, error: "stalled", toolCount: 5, elapsedMs: 500 }
        ]
      },
      [
        {
          id: "tool_abc:0",
          type: "toolCall",
          toolCallId: "tool_abc:0",
          toolName: "task",
          status: "running",
          subagentStatus: "running"
        } as any
      ]
    );
    expect(children).toHaveLength(3);
    expect(children[0]).toMatchObject({
      toolCallId: "tool_abc:0",
      status: "completed",
      subagentStatus: "completed",
      childSessionId: "child-a",
      toolCount: 33
    });
    expect(children[2]).toMatchObject({
      toolCallId: "tool_abc:2",
      status: "error",
      subagentStatus: "failed",
      isError: true,
      summary: "stalled"
    });
  });
});

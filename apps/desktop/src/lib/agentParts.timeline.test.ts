import { describe, expect, it } from "vitest";
import {
  buildAgentActivityRows,
  buildAgentAssistantRenderGroups,
  dedupeAgentToolParts,
  isAgentRenderablePart,
  type AgentAssistantRenderGroup
} from "./agentParts";
import type { AgentDetailedPart } from "./agentSessions";

/** 与 AgentMessageStream.buildDisplayTimelineGroups 同逻辑，用于单测原始 session 形态。 */
function buildDisplayTimelineGroups(
  groups: AgentAssistantRenderGroup[],
  showReasoningSummaries: boolean
): AgentAssistantRenderGroup[] {
  const out: AgentAssistantRenderGroup[] = [];
  groups.forEach((group) => {
    if (group.kind === "reasoning") {
      if (showReasoningSummaries) out.push(group);
      else out.push({ kind: "boundary", key: `boundary:${group.key}` });
      return;
    }
    out.push(group);
  });
  const merged: AgentAssistantRenderGroup[] = [];
  out.forEach((group) => {
    if (group.kind === "boundary") {
      merged.push(group);
      return;
    }
    const last = merged[merged.length - 1];
    if (group.kind === "context" && last?.kind === "context") {
      merged[merged.length - 1] = {
        kind: "context",
        key: last.key,
        parts: [...last.parts, ...group.parts]
      };
      return;
    }
    merged.push(group);
  });
  return merged;
}

function getBatchKind(group: AgentAssistantRenderGroup): "shell" | "edit" | "" {
  if (group.kind !== "part") return "";
  const type = String((group.part as { type?: string }).type || "");
  if (type !== "toolCall") return "";
  const tool = String((group.part as { toolName?: string }).toolName || "").trim();
  if (tool === "bash") return "shell";
  if (tool === "write" || tool === "edit" || tool === "hashline_edit" || tool === "apply_patch") return "edit";
  return "";
}

function buildBatchedTimelineGroups(groups: AgentAssistantRenderGroup[]) {
  const out: Array<AgentAssistantRenderGroup | { kind: "tool-batch"; batchKind?: string; count?: number }> = [];
  let pendingKind: "shell" | "edit" | "" = "";
  let pending: AgentAssistantRenderGroup[] = [];
  const flush = () => {
    if (!pending.length) return;
    if (pendingKind) {
      out.push({
        kind: "tool-batch",
        batchKind: pendingKind,
        count: pending.filter((group) => group.kind === "part").length
      });
    } else {
      pending.forEach((group) => out.push(group));
    }
    pendingKind = "";
    pending = [];
  };
  groups.forEach((group) => {
    if (group.kind === "boundary") {
      flush();
      return;
    }
    const nextKind = getBatchKind(group);
    if (!nextKind) {
      flush();
      out.push(group);
      return;
    }
    if (pendingKind && pendingKind !== nextKind) flush();
    pendingKind = nextKind;
    pending.push(group);
  });
  flush();
  return out;
}

function timelineFromParts(parts: AgentDetailedPart[], showReasoning: boolean, liftProcessParts = true) {
  const renderParts = parts.filter(isAgentRenderablePart);
  return buildBatchedTimelineGroups(
    buildDisplayTimelineGroups(
      buildAgentAssistantRenderGroups(renderParts, { liftProcessParts }),
      showReasoning
    )
  );
}

describe("agent timeline grouping", () => {
  it("keeps shell batches separated by visible thinking turns", () => {
    // 原始 session：thinking+2bash / thinking+2bash → 「已运行 2」「已运行 2」
    const parts: AgentDetailedPart[] = [
      { id: "reasoning:0", type: "reasoning", text: "plan A" },
      { id: "call_a", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_b", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "reasoning:1", type: "reasoning", text: "plan B" },
      { id: "call_c", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_d", type: "toolCall", toolName: "bash", status: "completed" }
    ];
    const withThinking = timelineFromParts(parts, true);
    const shellCounts = withThinking.filter((group) => group.kind === "tool-batch").map((group) => group.count);
    expect(shellCounts).toEqual([2, 2]);
  });

  it("merges consecutive bash turns when there is no content between them", () => {
    // 无 thinking 的原始形态：2 bash + 3 bash 应合并为已运行 5
    const parts: AgentDetailedPart[] = [
      { id: "call_a", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_b", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_c", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_d", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_e", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "text:0", type: "text", text: "总结" }
    ];
    const shellCounts = timelineFromParts(parts, true)
      .filter((group) => group.kind === "tool-batch")
      .map((group) => group.count);
    expect(shellCounts).toEqual([5]);
  });

  it("keeps shell batches separated when thinking is hidden (boundary)", () => {
    // 隐藏思考仍作分隔：不得把两轮 2+2 收成「已运行 4」
    const parts: AgentDetailedPart[] = [
      { id: "reasoning:0", type: "reasoning", text: "hidden" },
      { id: "call_a", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_b", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "reasoning:1", type: "reasoning", text: "also hidden" },
      { id: "call_c", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_d", type: "toolCall", toolName: "bash", status: "completed" }
    ];
    const shellCounts = timelineFromParts(parts, false)
      .filter((group) => group.kind === "tool-batch")
      .map((group) => group.count);
    expect(shellCounts).toEqual([2, 2]);
  });

  it("renders interleaved tools below streaming text in chronological order mid-stream", () => {
    // 流式中途帧：正文后到达的工具必须出现在正文下方（真实时序位置），
    // 不得 lift 堆到顶部——否则结束后才重排成穿插，造成布局跳变。
    const streamingParts: AgentDetailedPart[] = [
      { id: "text:0", type: "text", text: "先重读关键文件：" },
      { id: "call_a", type: "toolCall", toolName: "bash", status: "running" }
    ];
    const timeline = timelineFromParts(streamingParts, false, true);
    const activityRows = buildAgentActivityRows(timeline, {
      keyOf: (group) => group.key,
      textOf: (group) => {
        const part = group.part as { type?: string; text?: string } | undefined;
        return group.kind === "part" && String(part?.type || "") === "text"
          ? String(part?.text || "").trim()
          : "";
      }
    });
    expect(activityRows.map((row) => row.kind)).toEqual(["text", "segment"]);
    expect(activityRows[0].kind === "text" && activityRows[0].text).toBe("先重读关键文件：");
  });

  it("keeps interleaved tools and text in chronological order once streaming completes", () => {
    // 完成/history parts 就是真实 JSONL 时序：不得再 lift 成“所有工具 → 所有正文”，
    // 否则两次正文之间的操作会被压进同一个段卡。
    const parts: AgentDetailedPart[] = [
      { id: "text_intro", type: "text", text: "先重读关键文件：" },
      { id: "call_a", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_b", type: "toolCall", toolName: "write", status: "completed" },
      { id: "text_done", type: "text", text: "Review 完成。" }
    ];
    const timeline = timelineFromParts(parts, false, false);
    const activityRows = buildAgentActivityRows(timeline, {
      keyOf: (group) => group.key,
      textOf: (group) => {
        const part = group.part as { type?: string; text?: string } | undefined;
        return group.kind === "part" && String(part?.type || "") === "text"
          ? String(part?.text || "").trim()
          : "";
      }
    });
    // write 是普通 part（会作为段卡步骤保留）；text 是段落分隔，必须按时序切开。
    // 注意别用 read：context 类工具（read/grep…）会被收进探索组，改变组形态。
    expect(activityRows.map((row) => row.kind)).toEqual(["text", "segment", "text"]);
    expect(activityRows.filter((row) => row.kind === "text").map((row) => row.text)).toEqual([
      "先重读关键文件：",
      "Review 完成。"
    ]);
  });

  it("dedupes duplicate toolCall ids so live ghosts do not inflate counts", () => {
    // 过程中同一 call id 误挂到两个 assistant 再合并时，不得把 2/1/4 虚高成 3/1/7
    const parts: AgentDetailedPart[] = [
      { id: "call_a", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_b", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_r", type: "toolCall", toolName: "read", status: "completed" },
      { id: "call_c", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_d", type: "toolCall", toolName: "bash", status: "completed" },
      // ghosts / duplicates from race
      { id: "call_a", type: "toolCall", toolName: "bash", status: "running" },
      { id: "call_c", type: "toolCall", toolName: "bash", status: "running" },
      { id: "call_d", type: "toolCall", toolName: "bash", status: "running" },
      { id: "call_e", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_f", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_e", type: "toolCall", toolName: "bash", status: "running" }
    ];
    const timeline = timelineFromParts(dedupeAgentToolParts(parts), false);
    const shellCounts = timeline.filter((group) => group.kind === "tool-batch").map((group) => group.count);
    const contextCounts = timeline.filter((group) => group.kind === "context").length;
    expect(shellCounts).toEqual([2, 4]);
    expect(contextCounts).toEqual(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildAgentAssistantRenderGroups,
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
      return;
    }
    out.push(group);
  });
  const merged: AgentAssistantRenderGroup[] = [];
  out.forEach((group) => {
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
  const out: Array<{ kind: string; batchKind?: string; count?: number }> = [];
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
      pending.forEach((group) => out.push({ kind: group.kind }));
    }
    pendingKind = "";
    pending = [];
  };
  groups.forEach((group) => {
    const nextKind = getBatchKind(group);
    if (!nextKind) {
      flush();
      out.push({ kind: group.kind });
      return;
    }
    if (pendingKind && pendingKind !== nextKind) flush();
    pendingKind = nextKind;
    pending.push(group);
  });
  flush();
  return out;
}

function timelineFromParts(parts: AgentDetailedPart[], showReasoning: boolean) {
  const renderParts = parts.filter(isAgentRenderablePart);
  return buildBatchedTimelineGroups(
    buildDisplayTimelineGroups(buildAgentAssistantRenderGroups(renderParts), showReasoning)
  );
}

describe("agent timeline batching from raw session parts", () => {
  it("keeps two bash pairs separate when thinking is between them (session-1785507805142)", () => {
    // 原始 jsonl：assistant1 thinking+2bash / assistant2 thinking+2bash — 中间有思考，应显示 2 与 2
    const parts: AgentDetailedPart[] = [
      { id: "reasoning:0", type: "reasoning", text: "check git log" },
      { id: "call_a", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_b", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "reasoning:1", type: "reasoning", text: "more details" },
      { id: "call_c", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "call_d", type: "toolCall", toolName: "bash", status: "completed" },
      { id: "reasoning:2", type: "reasoning", text: "summarize" },
      { id: "text:0", type: "text", text: "以下是最近改动摘要" }
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

  it("merges bash across hidden reasoning (no visible content between)", () => {
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
    expect(shellCounts).toEqual([4]);
  });
});

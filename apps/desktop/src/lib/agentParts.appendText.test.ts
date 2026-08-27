import { describe, expect, it } from "vitest";
import {
  appendMissingTextPartsToLive,
  dedupeAgentDuplicateTextParts,
  type AgentDetailedPart
} from "./agentParts";

describe("appendMissingTextPartsToLive", () => {
  it("does not append when text:0 already has the same content", () => {
    const summary = "P1 全部完成，总结如下：";
    const live: AgentDetailedPart[] = [
      { id: "text:0", type: "text", text: summary }
    ];
    const { parts, changed } = appendMissingTextPartsToLive(live, [summary]);
    expect(changed).toBe(false);
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe("text:0");
  });

  it("does not append when text:soft already matches history block", () => {
    const summary = "完整总结正文";
    const live: AgentDetailedPart[] = [
      { id: "text:soft:0", type: "text", text: summary }
    ];
    const { parts, changed } = appendMissingTextPartsToLive(live, [summary]);
    expect(changed).toBe(false);
    expect(parts).toHaveLength(1);
  });

  it("does not duplicate after replaceAssistantMessage and finalize both call append", () => {
    const summary = "最终总结";
    let parts: AgentDetailedPart[] = [{ id: "tool-1", type: "toolCall", toolCallId: "t1", toolName: "read", status: "completed" }];
    const first = appendMissingTextPartsToLive(parts, [summary]);
    parts = first.parts;
    const second = appendMissingTextPartsToLive(parts, [summary]);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.parts.filter((p) => String((p as { type?: string }).type) === "text")).toHaveLength(1);
  });

  it("dedupe collapses text:0 and text:soft with prefix-equivalent content", () => {
    const full = "P1 全部完成，总结如下：\n\n## 已交付";
    const partial = "P1 全部完成，总结如下：";
    const merged = dedupeAgentDuplicateTextParts([
      { id: "text:0", type: "text", text: partial },
      { id: "text:soft:0", type: "text", text: full }
    ]);
    expect(merged.filter((p) => String((p as { type?: string }).type) === "text")).toHaveLength(1);
    expect(String((merged[0] as { text?: string }).text)).toBe(full);
  });
});

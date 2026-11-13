import { describe, expect, it } from "vitest";
import { livePartsHaveVisibleContent, type AgentDetailedPart } from "./agentParts";

/**
 * 回归（2026-11-12）：模型长思考后暂停，live 行只有 reasoning part、无正文；
 * history 对账的「保留 live 末尾气泡」判据若只认 text 会把这些行判空抹掉，
 * 表现为「手动停止后多个事件只剩一个」。思考流也是用户看到的内容，必须算 live。
 */
describe("livePartsHaveVisibleContent", () => {
  it("reasoning-only live parts count as visible", () => {
    const parts: AgentDetailedPart[] = [
      { id: "reasoning:0", type: "reasoning", text: "先看一下目录结构……" } as AgentDetailedPart
    ];
    expect(livePartsHaveVisibleContent(parts)).toBe(true);
  });

  it("text parts still count as visible", () => {
    const parts: AgentDetailedPart[] = [
      { id: "text:0", type: "text", text: "正文回复" } as AgentDetailedPart
    ];
    expect(livePartsHaveVisibleContent(parts)).toBe(true);
  });

  it("blank reasoning and whitespace-only text are not visible", () => {
    const parts: AgentDetailedPart[] = [
      { id: "reasoning:0", type: "reasoning", text: "   " } as AgentDetailedPart,
      { id: "text:0", type: "text", text: "" } as AgentDetailedPart
    ];
    expect(livePartsHaveVisibleContent(parts)).toBe(false);
  });

  it("tool parts alone are not visible", () => {
    const parts: AgentDetailedPart[] = [
      { id: "toolCall:0", type: "toolCall", toolName: "bash", status: "completed" } as AgentDetailedPart
    ];
    expect(livePartsHaveVisibleContent(parts)).toBe(false);
  });

  it("handles null and undefined input", () => {
    expect(livePartsHaveVisibleContent(null)).toBe(false);
    expect(livePartsHaveVisibleContent(undefined)).toBe(false);
  });
});

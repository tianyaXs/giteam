import { describe, expect, it } from "vitest";
import { unionAgentParts } from "./agentParts";

const tool = (id: string, name: string) => ({
  id,
  type: "toolCall",
  toolName: name,
  toolCallId: id,
  status: "completed"
});
const text = (id: string, value: string) => ({ id, type: "text", text: value });
const reasoning = (id: string, value: string) => ({ id, type: "reasoning", text: value });

describe("unionAgentParts", () => {
  it("fills tools missing from live with history parts and keeps order", () => {
    const live = [
      tool("call_read_a", "read"),
      tool("call_read_b", "read"),
      tool("call_bash_1", "bash"),
      tool("call_grep_1", "grep"),
      text("text:soft", "Review 完成。本次会话累计改动：数据层重构（mock→")
    ];
    const history = [
      tool("call_read_a", "read"),
      tool("call_read_b", "read"),
      tool("call_bash_1", "bash"),
      tool("call_bash_2", "bash"),
      tool("call_bash_3", "bash"),
      tool("call_grep_1", "grep"),
      tool("call_read_c", "read"),
      text("mid-text-0", "Review 完成。本次会话累计改动：数据层重构（mock→真实）、UI 升级。")
    ];
    const merged = unionAgentParts(live, history);
    const names = merged.filter((p) => p.type === "toolCall").map((p) => p.toolName);
    expect(names).toEqual(["read", "read", "bash", "grep", "bash", "bash", "read"]);
    // 正文保留更长的一份
    const texts = merged.filter((p) => p.type === "text");
    expect(texts).toHaveLength(1);
    expect((texts[0] as { text: string }).text).toContain("UI 升级");
  });

  it("keeps identical reasoning from history out when live already has the same content", () => {
    const live = [
      reasoning("reasoning:0", "先读关键文件再改"),
      tool("call_x", "bash")
    ];
    const history = [
      reasoning("mid-reasoning-0", "先读关键文件再改"),
      tool("call_x", "bash"),
      text("mid-text-0", "结论")
    ];
    const merged = unionAgentParts(live, history);
    expect(merged.filter((p) => p.type === "reasoning")).toHaveLength(1);
    expect(merged.filter((p) => p.type === "toolCall")).toHaveLength(1);
    expect(merged.filter((p) => p.type === "text")).toHaveLength(1);
  });

  it("union restores earlier tools lost by placeholder-dedup replacement (review regression)", () => {
    // 历史 10 个工具（read×4+bash×5+grep×1），live 因占位正文替换只剩 #5-#7 的 4 个：
    // 并集必须补齐全部缺失工具，而不是被 live 覆盖成 4 个。
    const history = [
      tool("call_r1", "read"),
      tool("call_r2", "read"),
      tool("call_r3", "read"),
      tool("call_b1", "bash"),
      tool("call_b2", "bash"),
      tool("call_b3", "bash"),
      tool("call_b4", "bash"),
      tool("call_b5", "bash"),
      tool("call_g1", "grep"),
      tool("call_r4", "read")
    ];
    const live = [
      tool("call_b4", "bash"),
      tool("call_b5", "bash"),
      tool("call_g1", "grep"),
      tool("call_r4", "read")
    ];
    const merged = unionAgentParts(live, history);
    const names = merged.filter((p) => p.type === "toolCall").map((p) => p.toolName);
    expect(names).toHaveLength(10);
    expect(names.filter((n) => n === "read")).toHaveLength(4);
    expect(names.filter((n) => n === "bash")).toHaveLength(5);
    expect(names.filter((n) => n === "grep")).toHaveLength(1);
  });

  it("returns history verbatim when live is empty and vice versa", () => {
    const history = [tool("call_a", "read"), text("t", "正文")];
    expect(unionAgentParts([], history)).toEqual(history);
    const live = [tool("call_b", "bash")];
    expect(unionAgentParts(live, [])).toEqual(live);
  });
});

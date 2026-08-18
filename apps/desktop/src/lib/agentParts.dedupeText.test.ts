import { describe, expect, it } from "vitest";
import {
  collapseDuplicatedAgentContent,
  dedupeAgentDuplicateTextParts,
  liftAgentProcessPartsBeforeText,
  mergeAgentStreamText,
  pickPreferredAgentContent
} from "./agentParts";
import type { AgentDetailedPart } from "./agentSessions";

describe("agent text dedupe", () => {
  it("collapses exact doubled content separated by blank line", () => {
    const once = "截至观测时刻：\n\n- **北京**：23°C";
    expect(collapseDuplicatedAgentContent(`${once}\n\n${once}`)).toBe(once);
  });

  it("pickPreferred prefers single copy over doubled longer live", () => {
    const once = "截至观测时刻：\n\n- **北京**：23°C\n- **上海**：29°C";
    expect(pickPreferredAgentContent(`${once}\n\n${once}`, once)).toBe(once);
  });

  it("dedupes text:0 + text:soft with same body", () => {
    const body = "截至观测时刻：\n\n- **成都**：18°C";
    const parts = [
      { id: "tool-1", type: "toolCall", toolName: "web_fetch", toolCallId: "c1" },
      { id: "text:0", type: "text", text: body },
      { id: "text:soft:0", type: "text", text: body }
    ] as AgentDetailedPart[];
    const next = dedupeAgentDuplicateTextParts(parts);
    expect(next.filter((p) => String((p as { type?: string }).type) === "text")).toHaveLength(1);
    expect(next.some((p) => String((p as { type?: string }).type) === "toolCall")).toBe(true);
  });

  it("mergeAgentStreamText does not concat near-full duplicates", () => {
    const body = "截至观测时刻：北京阴天";
    expect(mergeAgentStreamText(`${body}\n`, body)).toBe(`${body}\n`);
    expect(mergeAgentStreamText(body, body)).toBe(body);
  });

  it("buildAgentReplyMarkdownFromParts collapses doubled joined texts", async () => {
    const { buildAgentReplyMarkdownFromParts } = await import("./agentParts");
    const once = "你好！请告诉我你想在项目中完成什么任务。";
    const parts = [
      { id: "text:0", type: "text", text: once },
      { id: "text:soft:0", type: "text", text: once }
    ] as AgentDetailedPart[];
    // 未先 dedupe 时 join 会双份；build 内应折叠
    expect(buildAgentReplyMarkdownFromParts(parts)).toBe(once);
  });

  it("lifts tool calls that arrived after text to sit above the reply", () => {
    const parts = [
      { id: "text:0", type: "text", text: "南京今天多云" },
      { id: "t1", type: "toolCall", toolName: "web_fetch" },
      { id: "t2", type: "toolCall", toolName: "web_fetch" },
      { id: "t3", type: "toolCall", toolName: "web_fetch" }
    ] as AgentDetailedPart[];
    expect(liftAgentProcessPartsBeforeText(parts).map((p) => String((p as { id?: string }).id))).toEqual([
      "t1",
      "t2",
      "t3",
      "text:0"
    ]);
  });
});

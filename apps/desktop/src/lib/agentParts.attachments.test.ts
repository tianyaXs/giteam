import { describe, expect, it } from "vitest";
import { mergeAgentMessageAttachments } from "./agentParts";
import type { AgentChatMessage } from "./agentSessions";

describe("mergeAgentMessageAttachments", () => {
  it("restores file attachments after history remap by content", () => {
    const prev: AgentChatMessage[] = [
      {
        id: "user-local",
        role: "user",
        content: "请总结",
        attachments: [
          {
            id: "f1",
            kind: "file",
            uri: "data:text/plain;base64,YQ==",
            mime: "text/plain",
            filename: "a.txt"
          }
        ]
      }
    ];
    const next: AgentChatMessage[] = [
      {
        id: "user-server",
        role: "user",
        content: "请总结"
      }
    ];
    const merged = mergeAgentMessageAttachments(prev, next);
    expect(merged[0]?.attachments).toHaveLength(1);
    expect(merged[0]?.attachments?.[0]?.filename).toBe("a.txt");
  });

  it("restores attachment-only user messages without text", () => {
    const prev: AgentChatMessage[] = [
      {
        id: "user-local",
        role: "user",
        content: "",
        turnId: "turn-1",
        attachments: [
          {
            id: "f1",
            kind: "file",
            uri: "data:application/pdf;base64,AAAA",
            mime: "application/pdf",
            filename: "spec.pdf"
          }
        ]
      }
    ];
    const next: AgentChatMessage[] = [
      {
        id: "user-server",
        role: "user",
        content: "",
        turnId: "turn-1"
      }
    ];
    const merged = mergeAgentMessageAttachments(prev, next);
    expect(merged[0]?.attachments?.[0]?.filename).toBe("spec.pdf");
  });
});

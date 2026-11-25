import { describe, expect, it } from "vitest";
import {
  buildAgentFileAttachmentPromptParts,
  decodeAttachmentTextContent,
  type AgentAttachment
} from "./imageAttachments";
import { formatInlineFileAttachmentContent, stripInjectedUserPromptBlocks } from "./graphContextRefs";

function textAttachment(filename: string, text: string, mime = "text/plain"): AgentAttachment {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    id: `file-${filename}`,
    kind: "file",
    filename,
    mime,
    dataUrl: `data:${mime};base64,${btoa(binary)}`
  };
}

describe("decodeAttachmentTextContent", () => {
  it("decodes utf-8 text attachments", () => {
    const attachment = textAttachment("notes.md", "# 标题\n正文", "text/markdown");
    expect(decodeAttachmentTextContent(attachment)).toBe("# 标题\n正文");
  });

  it("rejects pdf payloads", () => {
    expect(
      decodeAttachmentTextContent({
        filename: "a.pdf",
        mime: "application/pdf",
        dataUrl: "data:application/pdf;base64,JVBERi0="
      })
    ).toBeNull();
  });
});

describe("buildAgentFileAttachmentPromptParts", () => {
  it("inlines pasted document text into the prompt parts", async () => {
    const parts = await buildAgentFileAttachmentPromptParts(
      [textAttachment("paste.txt", "document body for the model")],
      ""
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("document body for the model");
    expect(parts[0]).toContain('<attachment_content filename="paste.txt">');
    expect(stripInjectedUserPromptBlocks(`please read\n\n${parts[0]}`)).toBe("please read");
  });

  it("keeps local path hints for filesystem attachments when no extractable body", async () => {
    const parts = await buildAgentFileAttachmentPromptParts(
      [
        {
          id: "f1",
          kind: "file",
          filename: "readme.md",
          mime: "text/markdown",
          dataUrl: "",
          sourcePath: "/repo/readme.md"
        }
      ],
      ""
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain("Local path: /repo/readme.md");
  });

  it("does not put inlined document bodies into the displayable user text", async () => {
    const parts = await buildAgentFileAttachmentPromptParts(
      [textAttachment("paste.txt", "should not appear in bubble")],
      ""
    );
    const sessionPrompt = ["帮我看看", ...parts].join("\n\n");
    // 乐观气泡用用户原文；历史回放同样剥离注入块。
    expect(stripInjectedUserPromptBlocks(sessionPrompt)).toBe("帮我看看");
  });
});

describe("formatInlineFileAttachmentContent", () => {
  it("wraps content in a stripable block", () => {
    const block = formatInlineFileAttachmentContent("a.txt", "text/plain", "hello");
    expect(stripInjectedUserPromptBlocks(block)).toBe("");
  });
});

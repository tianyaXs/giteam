import { describe, expect, it } from "vitest";
import { deepAgentAttachmentsToGiteam } from "./bridge";

describe("deepAgentAttachmentsToGiteam", () => {
  it("maps extractedText into a text dataUrl instead of dropping the attachment", () => {
    const mapped = deepAgentAttachmentsToGiteam([
      {
        id: "t1",
        name: "pasted.txt",
        kind: "text",
        status: "ready",
        mime: "text/plain",
        extractedText: "hello document"
      }
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.kind).toBe("file");
    expect(mapped[0]?.filename).toBe("pasted.txt");
    expect(mapped[0]?.dataUrl.startsWith("data:text/plain;base64,")).toBe(true);
    const payload = mapped[0]!.dataUrl.split(",", 2)[1] || "";
    expect(atob(payload)).toBe("hello document");
  });

  it("decodes inline text dataUrls into dataText for composer preview parity", () => {
    const payload = btoa("visible document text");
    const mapped = deepAgentAttachmentsToGiteam([
      {
        id: "d1",
        name: "converted.docx",
        kind: "file",
        status: "ready",
        mime: "text/plain",
        dataUrl: `data:text/plain;base64,${payload}`,
        extractedText: "visible document text"
      }
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.dataText).toBe("visible document text");
  });

  it("keeps binary file dataUrl and originalPath", () => {
    const mapped = deepAgentAttachmentsToGiteam([
      {
        id: "f1",
        name: "spec.pdf",
        kind: "file",
        status: "ready",
        mime: "application/pdf",
        dataUrl: "data:application/pdf;base64,AAAA",
        originalPath: "/tmp/spec.pdf"
      }
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      id: "f1",
      kind: "file",
      filename: "spec.pdf",
      mime: "application/pdf",
      dataUrl: "data:application/pdf;base64,AAAA",
      sourcePath: "/tmp/spec.pdf"
    });
  });

  it("skips attachments that have neither dataUrl, extractedText, nor originalPath", () => {
    const mapped = deepAgentAttachmentsToGiteam([
      {
        id: "empty",
        name: "missing.bin",
        kind: "file",
        status: "ready",
        mime: "application/octet-stream"
      }
    ]);
    expect(mapped).toHaveLength(0);
  });
});

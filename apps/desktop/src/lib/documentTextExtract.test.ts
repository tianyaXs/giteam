import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  detectDocumentKind,
  extractDocumentTextFromBytes
} from "./documentTextExtract";
import { formatInlineFileAttachmentContent, stripInjectedUserPromptBlocks } from "./graphContextRefs";

async function makeDocxBytes(paragraphs: string[]): Promise<Uint8Array> {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>${body}</w:body>
    </w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "uint8array" });
}

function makeXlsxBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Score"],
    ["Alice", 10],
    ["Bob", 20]
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
}

describe("detectDocumentKind", () => {
  it("detects by extension and mime", () => {
    expect(detectDocumentKind("a.pdf", "")).toBe("pdf");
    expect(detectDocumentKind("a.docx", "")).toBe("docx");
    expect(detectDocumentKind("a.pptx", "")).toBe("pptx");
    expect(detectDocumentKind("a.xlsx", "")).toBe("xlsx");
    expect(detectDocumentKind("a.txt", "text/plain")).toBeNull();
  });
});

describe("extractDocumentTextFromBytes", () => {
  it("extracts docx paragraph text", async () => {
    const bytes = await makeDocxBytes(["Hello", "World"]);
    const text = await extractDocumentTextFromBytes({
      bytes,
      filename: "note.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
    expect(text).toContain("<docx filename=\"note.docx\">");
    expect(text).toContain("Hello");
    expect(text).toContain("World");
  });

  it("extracts xlsx sheet csv text", async () => {
    const text = await extractDocumentTextFromBytes({
      bytes: makeXlsxBytes(),
      filename: "scores.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    expect(text).toContain("<excel filename=\"scores.xlsx\">");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
  });
});

describe("display stripping for extracted documents", () => {
  it("keeps user text and strips large document bodies from chat rendering", () => {
    const body = "SECRET_DOCUMENT_BODY\n".repeat(50);
    const injected = formatInlineFileAttachmentContent(
      "spec.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      `<docx filename="spec.docx">\n${body}\n</docx>`
    );
    const raw = ["请总结这份文档", injected].join("\n\n");
    const display = stripInjectedUserPromptBlocks(raw);
    expect(display).toBe("请总结这份文档");
    expect(display).not.toContain("SECRET_DOCUMENT_BODY");
    expect(display).not.toContain("<attachment_content");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatGraphContextBlock,
  formatLocalFileAttachmentHint,
  formatUiOnlyFileAttachmentHint,
  IMAGE_ONLY_USER_PROMPT,
  makeGraphContextRef,
  normalizeUserMessageForDisplay,
  parseGraphContextBlock,
  stripInjectedUserPromptBlocks,
} from "./graphContextRefs";

describe("stripInjectedUserPromptBlocks", () => {
  it("strips graph_context block and keeps user text", () => {
    const ref = makeGraphContextRef({
      nodeId: "n1",
      nodeType: "task",
      typeLabel: "Task",
      label: "Fix bug",
    });
    const injected = formatGraphContextBlock([ref]);
    const raw = ["hello", injected].join("\n\n");
    expect(stripInjectedUserPromptBlocks(raw)).toBe("hello");
  });

  it("strips local file attachment hints", () => {
    const hint = formatLocalFileAttachmentHint("readme.md", "/tmp/readme.md");
    const raw = ["summarize this", hint].join("\n\n");
    expect(stripInjectedUserPromptBlocks(raw)).toBe("summarize this");
  });

  it("strips ui-only file attachment hints", () => {
    const hint = formatUiOnlyFileAttachmentHint("doc.pdf", "application/pdf");
    const raw = ["check attachment", hint].join("\n\n");
    expect(stripInjectedUserPromptBlocks(raw)).toBe("check attachment");
  });

  it("strips image-only placeholder when it is the entire message", () => {
    expect(stripInjectedUserPromptBlocks(IMAGE_ONLY_USER_PROMPT)).toBe("");
  });

  it("strips combined injected blocks in sessionPrompt order", () => {
    const ref = makeGraphContextRef({
      nodeId: "n2",
      nodeType: "file",
      typeLabel: "File",
      label: "App.tsx",
    });
    const raw = [
      "review this",
      formatGraphContextBlock([ref]),
      formatLocalFileAttachmentHint("App.tsx", "/repo/App.tsx"),
    ]
      .filter(Boolean)
      .join("\n\n");
    expect(stripInjectedUserPromptBlocks(raw)).toBe("review this");
  });
});

describe("normalizeUserMessageForDisplay", () => {
  it("preserves graphRefs parsed from injected block", () => {
    const ref = makeGraphContextRef({
      nodeId: "n3",
      nodeType: "intent",
      typeLabel: "Intent",
      label: "Refactor auth",
      props: JSON.stringify({ intent: "Refactor auth module" }),
    });
    const raw = formatGraphContextBlock([ref]);
    const normalized = normalizeUserMessageForDisplay({ content: raw });
    expect(normalized.content).toBe("");
    expect(normalized.graphRefs?.[0]?.nodeId).toBe("n3");
    expect(parseGraphContextBlock(raw)).toHaveLength(1);
  });

  it("prefers previous optimistic content when server body is only injected blocks", () => {
    const ref = makeGraphContextRef({
      nodeId: "n4",
      nodeType: "task",
      typeLabel: "Task",
      label: "Ship MVP",
    });
    const normalized = normalizeUserMessageForDisplay(
      { content: formatGraphContextBlock([ref]) },
      { content: "Ship MVP", graphRefs: [ref] },
    );
    expect(normalized.content).toBe("Ship MVP");
    expect(normalized.graphRefs).toEqual([ref]);
  });
});

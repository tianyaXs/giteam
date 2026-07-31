import { describe, expect, it } from "vitest";
import {
  extractUnifiedDiff,
  getToolResultPreview,
  stripReadToolLinePrefixes,
  synthesizeUnifiedDiff,
  toolDisplayName,
  toolHeadlineTarget
} from "./toolPresentation";

describe("synthesizeUnifiedDiff", () => {
  it("produces a unified diff with additions and deletions", () => {
    const patch = synthesizeUnifiedDiff("a\nb\nc", "a\nx\nc", "demo.ts");
    expect(patch).toContain("--- a/demo.ts");
    expect(patch).toContain("+++ b/demo.ts");
    expect(patch).toContain("-b");
    expect(patch).toContain("+x");
    expect(patch).toContain(" a");
    expect(patch).toContain(" c");
  });

  it("treats write as all additions from empty old text", () => {
    const patch = synthesizeUnifiedDiff("", "hello\nworld", "new.txt");
    expect(patch).toContain("+hello");
    expect(patch).toContain("+world");
  });
});

describe("stripReadToolLinePrefixes", () => {
  it("removes pi read line-number arrows", () => {
    const raw = "1→<script setup>\n  2→const x = 1\n10→</script>";
    expect(stripReadToolLinePrefixes(raw)).toBe("<script setup>\nconst x = 1\n</script>");
  });
});

describe("getToolResultPreview", () => {
  it("prefers details.diff for edit tools", () => {
    const preview = getToolResultPreview(
      "edit",
      { path: "src/App.tsx", oldText: "a", newText: "b" },
      "ok",
      { diff: "@@ -1 +1 @@\n-a\n+b\n" }
    );
    expect(preview?.kind).toBe("diff");
    if (preview?.kind === "diff") {
      expect(preview.file).toBe("src/App.tsx");
      expect(preview.additions).toBe(1);
      expect(preview.deletions).toBe(1);
    }
  });

  it("falls back to synthesizing diff from oldText/newText", () => {
    const preview = getToolResultPreview(
      "edit",
      { path: "src/a.ts", oldText: "one\ntwo", newText: "one\nthree" },
      "Successfully changed 1 block(s)",
      undefined
    );
    expect(preview?.kind).toBe("diff");
    if (preview?.kind === "diff") {
      expect(preview.patch).toContain("-two");
      expect(preview.patch).toContain("+three");
    }
  });

  it("extracts unified diff from output text when details are missing", () => {
    const output = "done\n@@ -1,2 +1,2 @@\n-a\n+b\n";
    expect(extractUnifiedDiff(output)).toContain("@@ -1,2 +1,2 @@");
    const preview = getToolResultPreview("edit", { path: "f.ts" }, output, undefined);
    expect(preview?.kind).toBe("diff");
  });

  it("builds a write preview as additive diff", () => {
    const preview = getToolResultPreview(
      "write",
      { path: "README.md", content: "# hi\n" },
      "",
      undefined
    );
    expect(preview?.kind).toBe("diff");
    if (preview?.kind === "diff") {
      expect(preview.additions).toBeGreaterThan(0);
      expect(preview.deletions).toBe(0);
    }
  });

  it("strips read line prefixes in file preview content", () => {
    const preview = getToolResultPreview(
      "read",
      { path: "App.vue" },
      "1→line-one\n2→line-two",
      undefined
    );
    expect(preview?.kind).toBe("file");
    if (preview?.kind === "file") {
      expect(preview.content).toBe("line-one\nline-two");
    }
  });
});

describe("question presentation", () => {
  it("uses Chinese display name", () => {
    expect(toolDisplayName("question")).toBe("提问");
  });

  it("summarizes question headers in the headline target", () => {
    expect(
      toolHeadlineTarget("question", {
        questions: [
          { header: "平台", question: "你想做什么平台？" },
          { header: "框架", question: "前端用什么？" }
        ]
      })
    ).toBe("平台 等 2 项");
    expect(
      toolHeadlineTarget("question", {
        questions: [{ question: "需要支持离线吗？" }]
      })
    ).toBe("需要支持离线吗？");
  });
});

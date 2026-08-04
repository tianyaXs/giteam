import { describe, expect, it } from "vitest";
import { parseUpdateKind, splitReleaseNotesIntoSteps } from "./appUpdater";

describe("parseUpdateKind", () => {
  it("treats minor bumps as major updates", () => {
    expect(parseUpdateKind("0.1.36", "0.2.0")).toBe("major");
    expect(parseUpdateKind("1.2.3", "1.3.0")).toBe("major");
  });

  it("treats major-version bumps as major updates", () => {
    expect(parseUpdateKind("0.9.9", "1.0.0")).toBe("major");
  });

  it("treats patch-only bumps as small updates", () => {
    expect(parseUpdateKind("0.1.35", "0.1.36")).toBe("patch");
    expect(parseUpdateKind("1.2.3", "1.2.10")).toBe("patch");
  });

  it("tolerates a leading v prefix", () => {
    expect(parseUpdateKind("v0.1.35", "v0.2.0")).toBe("major");
  });

  it("falls back to patch on unparseable input", () => {
    expect(parseUpdateKind("—", "0.2.0")).toBe("patch");
    expect(parseUpdateKind("", "")).toBe("patch");
  });
});

describe("splitReleaseNotesIntoSteps", () => {
  it("splits by level-2 headings first", () => {
    const steps = splitReleaseNotesIntoSteps(
      "## Alpha\n\n- a1\n- a2\n\n## Beta\n\n- b1\n"
    );
    expect(steps).toEqual([
      { title: "Alpha", body: "- a1\n- a2" },
      { title: "Beta", body: "- b1" }
    ]);
  });

  it("falls back to level-3 headings when level-2 yields fewer than two steps", () => {
    const steps = splitReleaseNotesIntoSteps(
      "## What's New\n\n### Data directory\n\n- persist\n\n### Migration\n\n- auto\n"
    );
    expect(steps).toEqual([
      { title: "Data directory", body: "- persist" },
      { title: "Migration", body: "- auto" }
    ]);
  });

  it("drops sections without a body", () => {
    const steps = splitReleaseNotesIntoSteps("## Empty\n\n## Real\n\n- content\n## Other\n\n- more\n");
    expect(steps.map((step) => step.title)).toEqual(["Real", "Other"]);
  });

  it("returns an empty list when there is nothing to step through", () => {
    expect(splitReleaseNotesIntoSteps("")).toEqual([]);
    expect(splitReleaseNotesIntoSteps("- just one bullet\n- another\n")).toEqual([]);
    expect(splitReleaseNotesIntoSteps("## Only One\n\n- body\n")).toEqual([]);
  });
});

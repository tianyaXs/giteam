import { describe, expect, it } from "vitest";
import { humanizeModelName } from "./providerState";

describe("humanizeModelName", () => {
  it("uses catalog name when present, even if equal to id", () => {
    expect(humanizeModelName("gpt-5.6-sol", "gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(humanizeModelName("gpt-5.3-codex", "GPT-5.3 Codex")).toBe("GPT-5.3 Codex");
  });

  it("only falls back to id humanization when name is empty", () => {
    expect(humanizeModelName("deepseek-reasoner", "")).toBe("Deepseek Reasoner");
    expect(humanizeModelName("gpt-5.6-sol", "   ")).toBe("Gpt 5 6 Sol");
  });
});

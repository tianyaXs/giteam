import { describe, expect, it } from "vitest";
import { resolveActiveAgentModel } from "./agentProviderCatalog";

describe("resolveActiveAgentModel", () => {
  it("uses sessionModelRef as the only truth when a session is active", () => {
    const model = resolveActiveAgentModel({
      activeSessionId: "sess-1",
      sessionModelRef: "openai-compatible.gac/gpt-5.6-sol",
      draftModel: "openai-compatible.indemind/step/gpt-5.6-sol",
      configuredModel: "",
      savedModels: ["openai-compatible.indemind/step/gpt-5.6-sol"],
      connectedProviders: ["openai-compatible.indemind"],
      modelsByProvider: {
        "openai-compatible.indemind": ["step/gpt-5.6-sol"],
        "openai-compatible.gac": ["gpt-5.6-sol"]
      },
      providerNames: {
        "openai-compatible.indemind": "indemind",
        "openai-compatible.gac": "gac"
      }
    });
    expect(model).toBe("openai-compatible.gac/gpt-5.6-sol");
  });

  it("does not fall back to draft when the active session has no model yet", () => {
    const model = resolveActiveAgentModel({
      activeSessionId: "sess-2",
      sessionModelRef: "",
      draftModel: "openai-compatible.indemind/step/gpt-5.6-sol",
      configuredModel: "",
      savedModels: [],
      connectedProviders: ["openai-compatible.indemind"],
      modelsByProvider: {
        "openai-compatible.indemind": ["step/gpt-5.6-sol"]
      },
      providerNames: {
        "openai-compatible.indemind": "indemind"
      }
    });
    expect(model).toBe("");
  });

  it("uses draft only when there is no active session", () => {
    const model = resolveActiveAgentModel({
      activeSessionId: "",
      sessionModelRef: "",
      draftModel: "openai-compatible.indemind/step/gpt-5.6-sol",
      configuredModel: "",
      savedModels: [],
      connectedProviders: ["openai-compatible.indemind"],
      modelsByProvider: {
        "openai-compatible.indemind": ["step/gpt-5.6-sol"]
      },
      providerNames: {
        "openai-compatible.indemind": "indemind"
      }
    });
    expect(model).toBe("openai-compatible.indemind/step/gpt-5.6-sol");
  });
});

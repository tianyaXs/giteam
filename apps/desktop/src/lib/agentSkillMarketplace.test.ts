import { describe, expect, it } from "vitest";
import { dedupeMarketplaceResults, skillsmpSkillToResult, type AgentSkillSearchResult } from "./agentSkillMarketplace";

describe("dedupeMarketplaceResults", () => {
  it("keeps distinct skills from the same GitHub repository", () => {
    const rows = [
      skillsmpSkillToResult({
        id: "openclaw-a",
        name: "coding-agent",
        author: "openclaw",
        githubUrl: "https://github.com/openclaw/openclaw/tree/main/.agents/skills/coding-agent",
        skillUrl: "https://skillsmp.com/a",
        stars: 100
      }),
      skillsmpSkillToResult({
        id: "openclaw-b",
        name: "agent-transcript",
        author: "openclaw",
        githubUrl: "https://github.com/openclaw/openclaw/tree/main/.agents/skills/agent-transcript",
        skillUrl: "https://skillsmp.com/b",
        stars: 100
      })
    ].filter(Boolean) as AgentSkillSearchResult[];

    expect(rows).toHaveLength(2);
    expect(dedupeMarketplaceResults(rows)).toHaveLength(2);
  });
});

import { explainCommit } from "./entireAdapter";
import { getCommitDiff } from "./gitAdapter";
import { parseExplainCommit } from "./explainParser";
import type { ReviewRecord } from "./types";

function makeId(): string {
  return Math.random().toString(16).slice(2, 14);
}

export async function runReviewForCommit(commitSha: string, repoPath: string): Promise<ReviewRecord> {
  const [explain, diff] = await Promise.all([
    explainCommit(commitSha, repoPath),
    getCommitDiff(commitSha, repoPath)
  ]);
  const parsedExplain = parseExplainCommit(explain.raw);

  const summary = diff.length === 0
    ? "No diff content found for this commit."
    : `Scaffold review: replace with real LLM-backed analysis. checkpoint=${parsedExplain.checkpointId ?? "none"}`;

  return {
    id: makeId(),
    repoPath,
    commitSha,
    status: "warn",
    summary,
    findings: [
      {
        id: makeId(),
        severity: "medium",
        file: "N/A",
        summary: `Explain captured (${explain.raw.length} chars), diff captured (${diff.length} chars), hasCheckpoint=${parsedExplain.hasCheckpoint}.`
      }
    ],
    createdAt: new Date().toISOString()
  };
}

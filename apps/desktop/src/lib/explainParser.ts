import type { ExplainCommitParsed } from "./types";

function readField(raw: string, field: string): string | undefined {
  const re = new RegExp(`^${field}:\\s+(.+)$`, "mi");
  const match = raw.match(re);
  return match?.[1]?.trim();
}

export function parseExplainCommit(raw: string): ExplainCommitParsed {
  const noCheckpoint = /No associated Entire checkpoint/i.test(raw);
  if (noCheckpoint) {
    return { hasCheckpoint: false };
  }

  const checkpointId = readField(raw, "Checkpoint");
  const sessionId = readField(raw, "Session");
  const tokens = readField(raw, "Tokens");

  return {
    checkpointId,
    sessionId,
    tokens,
    hasCheckpoint: Boolean(checkpointId)
  };
}


import { invoke } from "@tauri-apps/api/core";
import type { EntireStatusResult, ExplainCommitResult } from "./types";

export async function getEntireStatusDetailed(repoPath: string): Promise<EntireStatusResult> {
  const raw = await invoke<string>("run_entire_status_detailed", { repoPath });
  return { raw };
}

export async function explainCommit(commitSha: string, repoPath: string): Promise<ExplainCommitResult> {
  const raw = await invoke<string>("run_entire_explain_commit", { commitSha, repoPath });
  return { commitSha, raw };
}

export async function explainCommitShort(commitSha: string, repoPath: string): Promise<ExplainCommitResult> {
  const raw = await invoke<string>("run_entire_explain_commit_short", { commitSha, repoPath });
  return { commitSha, raw };
}

export async function explainCheckpoint(checkpointId: string, repoPath: string): Promise<string> {
  return invoke<string>("run_entire_explain_checkpoint", { checkpointId, repoPath });
}

export async function explainCheckpointRawTranscript(
  checkpointId: string,
  repoPath: string
): Promise<string> {
  return invoke<string>("run_entire_explain_checkpoint_raw_transcript", { checkpointId, repoPath });
}

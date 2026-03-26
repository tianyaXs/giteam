import type { RepositoryEntry, ReviewAction, ReviewRecord } from "./types";
import { invoke } from "@tauri-apps/api/core";

export async function loadReviewRecords(repoPath: string, limit = 100): Promise<ReviewRecord[]> {
  return invoke<ReviewRecord[]>("db_list_review_records", { repoPath, limit });
}

export async function saveReviewRecord(record: ReviewRecord): Promise<void> {
  await invoke("db_save_review_record", { record });
}

export async function loadReviewActions(
  repoPath: string,
  reviewId?: string,
  limit = 300
): Promise<ReviewAction[]> {
  return invoke<ReviewAction[]>("db_list_review_actions", { repoPath, reviewId, limit });
}

export async function saveReviewAction(action: ReviewAction): Promise<void> {
  await invoke("db_save_review_action", { action });
}

export async function addRepository(path: string): Promise<RepositoryEntry> {
  return invoke<RepositoryEntry>("db_add_repository", { path });
}

export async function listRepositories(): Promise<RepositoryEntry[]> {
  return invoke<RepositoryEntry[]>("db_list_repositories");
}

export async function removeRepository(id: string): Promise<void> {
  await invoke("db_remove_repository", { id });
}

export async function pickRepositoryFolder(): Promise<string | null> {
  return invoke<string | null>("pick_repository_folder");
}

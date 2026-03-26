# Step 07 - Repo path scoping for command execution and storage

Date: 2026-03-25

## Goal

Ensure all `git` / `entire` calls execute against an explicit repository path, and ensure review records are partitioned by repository.

## Completed

### A. Rust command execution now runs in repo path

- Added in `command_runner.rs`:
  - `validate_repo_path(repo_path)`
  - `run_and_capture_in_dir(program, args, repo_path)`
- Updated Tauri command signatures:
  - `run_entire_status_detailed(repo_path)`
  - `run_entire_explain_commit(commit_sha, repo_path)`
  - `run_git_head_commit(repo_path)`
  - `run_git_show_patch(commit_sha, repo_path)`

### B. SQLite schema and query now include repo path

- `review_records` now includes `repo_path`
- `db_list_review_records` now filters by `repo_path`
- Added compatibility migration path:
  - if old table exists without `repo_path`, add column

### C. Frontend adapter signatures updated

- `entireAdapter` now requires `repoPath`
- `gitAdapter` now requires `repoPath`
- `runReviewForCommit(commitSha, repoPath)`
- `loadReviewRecords(repoPath, limit)`

### D. UI supports selecting target repository

- Added `repoPath` input in `App.tsx`
- Default points to:
  - `/Users/tianya/Documents/project/giteam/test`

## Compatibility note

This is a breaking change for internal adapter function signatures. Any new caller must pass `repoPath`.

## Next

1. Add `review_actions` table and APIs
2. Add timeline read model by repo path
3. Add runtime validation in frontend for empty/non-git repo path before invoking commands


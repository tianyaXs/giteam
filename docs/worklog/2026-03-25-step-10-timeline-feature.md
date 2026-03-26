# Step 10 - Timeline feature (real flow beyond scaffold buttons)

Date: 2026-03-25

## Goal

Move from basic command buttons to a real usable flow:

- list recent commits
- select commit
- load explain for selected commit
- run review on selected commit
- persist review/actions by repo path

## Implemented

### A. New backend command

- Added `run_git_recent_commits(repo_path, limit)` in:
  - `apps/desktop/src-tauri/src/commands/git.rs`
- Output shape:
  - `sha`, `author`, `date`, `subject`
- Registered in:
  - `apps/desktop/src-tauri/src/main.rs`

### B. Frontend timeline and selected-commit workflow

- Added `GitCommitSummary` type
  - `apps/desktop/src/lib/types.ts`
- Added adapter:
  - `getRecentCommits(repoPath, limit)` in `apps/desktop/src/lib/gitAdapter.ts`
- Updated UI in `apps/desktop/src/App.tsx`:
  - timeline list panel
  - selected commit state
  - "explain selected" action
  - "review selected commit" action
  - parsed explain summary (`checkpoint/session/tokens`)

## Validation

- `npm run build` passed
- `cargo check` passed

## Result

This is no longer only "command buttons":
- the app now has a commit timeline read model
- selected commit explain and review execution are wired end-to-end


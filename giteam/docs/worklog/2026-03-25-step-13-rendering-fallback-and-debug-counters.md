# Step 13 - Rendering fallback parsing + visible debug counters

Date: 2026-03-25

## Problem observed

User still saw backend logs but no client rendering.
Logs showed separator variants like:
- `^_entire/checkpoints/v1`
- `*^_master`

## Root cause hypothesis

Different environments may expose separators as:
- control char `\u{1f}`
- literal `%x1f`
- caret form `^_`

Strict single-separator parsing can silently fail and produce empty lists.

## Fixes applied

### A. Robust field split fallback

- File: `apps/desktop/src-tauri/src/commands/git.rs`
- Added `split_fields(line, sep)` with fallback order:
  1. real `\u{1f}`
  2. literal `%x1f`
  3. literal `^_`
- Applied to:
  - `run_git_local_branches`
  - `run_git_recent_commits`
  - `run_git_branch_commits`

### B. Branch selection validity

- File: `apps/desktop/src/App.tsx`
- If previously selected branch is not present in current repo, fallback to current/default branch instead of using stale value.

### C. Visible render diagnostics

- File: `apps/desktop/src/App.tsx`
- Added in-page counters:
  - `repos`
  - `branches`
  - `commits`
  - `reviews`

## Validation

- `cargo check` passed
- `npm run build` passed


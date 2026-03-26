# Step 21 - SCM buttons redesign + full-context action placement

Date: 2026-03-25

## Goal

Address UX feedback:

- remove letter-based top action buttons
- use VSCode-like SCM actions: refresh, pull, push
- keep UI clean/minimal (Apple-style direction)
- move full-context loading action under context summary area

## Implemented

### A. Backend git command expansion

Files:
- `apps/desktop/src-tauri/src/commands/git.rs`
- `apps/desktop/src-tauri/src/main.rs`

Added tauri commands:
- `run_git_pull(repo_path)` -> `git pull --ff-only`
- `run_git_push(repo_path)` -> `git push`

Notes:
- both use extended timeout (90s) because network operations can be slower.

### B. Frontend adapter support

File:
- `apps/desktop/src/lib/gitAdapter.ts`

Added:
- `gitPull(repoPath)`
- `gitPush(repoPath)`

### C. App interaction updates

File:
- `apps/desktop/src/App.tsx`

Changes:
- Replaced previous `S/B` toolbar buttons with SCM actions:
  - `刷新`
  - `拉取`
  - `推送`
- Added handlers:
  - `refreshScm()`
  - `pullLatest()`
  - `pushCurrent()`
- Pull/push command outputs are appended into status panel for visibility.
- Removed top-level `Full Context` button.
- Added `加载全部上下文` button directly under context summary in the `Agent Context` tab.

### D. Style updates

File:
- `apps/desktop/src/styles.css`

Changes:
- Added `scm-btn` and `scm-toolbar` styles for clean capsule actions.
- Added `context-actions` spacing style.
- Removed old icon-button style dependency for the explorer toolbar.

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

## Handover note

If you want a closer VSCode Source Control behavior next, add one-click "sync" action that sequences:

1. `git pull --ff-only`
2. conflict check
3. `git push`

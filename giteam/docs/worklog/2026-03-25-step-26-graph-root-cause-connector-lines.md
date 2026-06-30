# Step 26 - Root cause analysis: graph looked like list due to dropped connector rows

Date: 2026-03-25

## Problem

User still observed branch graph as list-like view, even after graph panel rewrite.

## Deep root cause

1. Backend parser only kept rows containing commit metadata fields.
2. `git log --graph` emits additional connector-only rows (no commit payload) that carry tree continuity.
3. Those connector rows were dropped, so UI rendered only per-commit rows.
4. Combined with row-like layout, visual result degraded to "list with symbols".

## Fixes implemented

### A. Keep connector rows in backend graph response

File:
- `apps/desktop/src-tauri/src/commands/git.rs`

Changes:
- Extended `GitGraphNode` with `is_connector`.
- In `run_git_commit_graph`:
  - if metadata fields are missing, preserve line as connector node (graph only)
  - commit rows marked `is_connector=false`

### B. Frontend renders connector rows as non-interactive line rows

Files:
- `apps/desktop/src/lib/types.ts`
- `apps/desktop/src/App.tsx`

Changes:
- Added `isConnector` field in TS type.
- Graph row rendering now distinguishes:
  - connector rows (line continuity only)
  - commit rows (click/select + refs)

### C. Improve lane continuity in styling

File:
- `apps/desktop/src/styles.css`

Changes:
- reduced row padding and increased lane extension beyond row bounds
- connector rows do not display metadata and are not hover-highlighted
- vertical/diagonal lines now bridge between adjacent rows better

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

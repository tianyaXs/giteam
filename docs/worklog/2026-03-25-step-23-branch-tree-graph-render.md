# Step 23 - Branch panel upgraded to real git tree graph rendering

Date: 2026-03-25

## Goal

Fix mismatch with requested VSCode-like branch tree visualization.

Previous UI used stylized branch list, not real commit-branch topology.

## Implemented

### A. Backend graph data command

Files:
- `apps/desktop/src-tauri/src/commands/git.rs`
- `apps/desktop/src-tauri/src/main.rs`

Added:
- `GitGraphNode` struct
- `run_git_commit_graph(repo_path, limit)` command

Command source:
- `git log --graph --decorate=short --date-order --all -n<limit> --date=short --pretty=format:<sep fields>`

Returned fields:
- `graph` (ascii tree segment)
- `sha`
- `date`
- `author`
- `refs`
- `subject`

### B. Frontend graph adapter and type

Files:
- `apps/desktop/src/lib/types.ts`
- `apps/desktop/src/lib/gitAdapter.ts`

Added:
- `GitGraphNode` TS type
- `getCommitGraph(repoPath, limit)` adapter

### C. Branch panel rendering rewrite

Files:
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`

Changes:
- Added `commitGraph` state and load in:
  - `refreshBranchesAndCommits()`
  - `refreshScm()`
- Replaced old branch-node list visual with:
  - branch selector pills (for branch switch action)
  - real tree graph rows based on git graph data
- Each graph row shows:
  - ascii topology (`graph`)
  - commit subject
  - sha/author/date
  - refs badges (`HEAD`, branch refs, tags)
- Clicking graph row selects commit and triggers existing context/diff flows.

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

## Follow-up options

1. Add lane color mapping (like GitLens) for clearer multi-branch separation.
2. Add graph filter toggle: `all` vs `selectedBranch`.
3. Add horizontal drag/scroll for very wide ascii graph lines.

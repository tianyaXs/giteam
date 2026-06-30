# Step 17 - Fast context loading (short first, full on demand)

Date: 2026-03-25

## User request

`entire explain --commit <sha>` can be very long and slow.
Need segmented/faster loading strategy.

## Source findings

From `cmd/entire/cli/explain.go`:
- `--short` => summary-only mode (less output)
- `--no-pager` => avoid pager UI
- `--search-all` is potentially slow (full DAG scan)

`runExplainCommit` delegates to `runExplainCheckpoint` and can produce large output by default.

## Implementation

### New tauri commands

- `run_entire_explain_commit_short(commit_sha, repo_path)`
- `run_entire_explain_checkpoint(checkpoint_id, repo_path)`

Files:
- `apps/desktop/src-tauri/src/commands/entire.rs`
- `apps/desktop/src-tauri/src/main.rs`

### Frontend strategy

- Commit selection now loads:
  - `entire explain --commit <sha> --short --no-pager`
- Added "加载完整上下文" button:
  - parse checkpoint from short result
  - load full details via `entire explain --checkpoint <id> --no-pager`

Files:
- `apps/desktop/src/lib/entireAdapter.ts`
- `apps/desktop/src/App.tsx`

## Validation

- `npm run build` passed
- `cargo check` passed


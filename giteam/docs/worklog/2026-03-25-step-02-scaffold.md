# Step 02 - Desktop scaffold + adapters

Date: 2026-03-25

## Goal

Build a first runnable skeleton that proves the command flow:

- UI -> Tauri invoke -> `entire` / `git` commands
- parse-minimal -> local record persistence

## Completed

- Created `apps/desktop` React + TypeScript base files
- Added Tauri Rust command endpoints:
  - `run_entire_status_detailed`
  - `run_entire_explain_commit`
  - `run_git_head_commit`
  - `run_git_show_patch`
- Added TS adapter layer:
  - `src/lib/entireAdapter.ts`
  - `src/lib/gitAdapter.ts`
  - `src/lib/reviewOrchestrator.ts`
- Added minimal UI to execute commands and store local review records

## Decisions

- Keep first pass command execution synchronous and simple
- Return raw command text to UI first, add typed parser in next iteration
- Use localStorage as temporary placeholder before SQLite integration

## Risks

- No command allowlist/timeout yet in Rust command layer
- No structured parser for `entire explain` yet
- No background queue yet

## Next

- Add command policy wrapper (timeout + safe argument validation)
- Add parser for `entire explain --commit`
- Replace localStorage with SQLite access layer


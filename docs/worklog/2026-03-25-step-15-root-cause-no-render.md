# Step 15 - Root cause fixed: backend logs had data but UI got empty payload

Date: 2026-03-25

## Symptom

- Backend terminal showed git command output lines.
- UI counters remained `branches=0 commits=0`.

## Root cause

In command runner, child process stdio was not configured as piped.

Effect:
- child stdout/stderr inherited parent terminal
- command output printed in backend logs
- `wait_with_output()` returned empty captured stdout
- frontend received empty data and rendered nothing

## Fix

File: `apps/desktop/src-tauri/src/commands/command_runner.rs`

Added:
- `cmd.stdin(Stdio::null())`
- `cmd.stdout(Stdio::piped())`
- `cmd.stderr(Stdio::piped())`

## Verification

- Added/ran smoke test:
  - `cargo test local_branches_smoke_test -- --nocapture`
  - now passes
- `cargo check` passes
- `npm run build` passes

## Impact

This fix unblocks all command-driven rendering paths:
- repositories -> branches -> commits
- explain content loading
- review persistence refresh cycles


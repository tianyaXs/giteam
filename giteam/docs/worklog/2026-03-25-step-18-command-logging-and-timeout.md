# Step 18 - Backend command logging + timeout/pipe fix

Date: 2026-03-25

## User need

- See exact command executed by desktop client
- Investigate why client times out while terminal command is fast

## Root issue found

Old runner used timeout + piped stdout/stderr in a way that could block on large output.
Large explain payloads can fill pipe buffers and cause false timeout behavior.

## Fixes

### A. Command logging added

`apps/desktop/src-tauri/src/commands/command_runner.rs`

Now prints:
- exec line: cwd + full command args
- completion line: exit code + elapsed ms + stdout/stderr char counts

### B. Pipe deadlock mitigation

- Command output now redirected to temp files during execution.
- Process wait uses timeout safely.
- On completion, temp files are read back and returned to frontend.

### C. Timeout tuning

- Added per-command timeout support:
  - default command timeout = 20s
  - entire explain path timeout = 120s

Files:
- `apps/desktop/src-tauri/src/commands/command_runner.rs`
- `apps/desktop/src-tauri/src/commands/entire.rs`

## Validation

- `cargo check` passed
- frontend build remains valid


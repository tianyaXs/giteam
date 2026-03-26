# Step 12 - Fix branch/commit rendering issue from `%x1f` literal output

Date: 2026-03-25

## User-reported issue

- UI had no commit rendering although backend logs showed outputs.
- Log snippets contained literal `%x1f...` text.

## Root cause

Git format strings used `%x1f` expecting separator expansion in all commands.
In actual runtime output, `%x1f` remained literal in branch/log output, so parser split failed and produced empty branch/commit arrays for UI rendering.

## Fix applied

- File: `apps/desktop/src-tauri/src/commands/git.rs`
- Replaced `%x1f` format usage with a real control character separator inserted by Rust:
  - `let sep = '\u{1f}';`
  - format string built with that actual character
- Updated parsing to split by the same `sep`.
- Added filter to hide internal metadata branches:
  - skip names starting with `entire/`

## Additional UX fix

- File: `apps/desktop/src/App.tsx`
- Added explicit messages when:
  - no local branch is available
  - selected branch has no commits

## Verification

- `cargo check` passed
- `npm run build` passed


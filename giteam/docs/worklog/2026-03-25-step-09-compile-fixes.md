# Step 09 - Compile fixes from runtime feedback

Date: 2026-03-25

## Input errors addressed

1. `tauri::generate_context!()` panic:
   - missing icon file, then icon format not RGBA
2. `db_list_review_actions` Rust type mismatch:
   - `if/else` closures in `query_map` had incompatible types
3. derived follow-up:
   - type inference failure in row decode loop

## Fixes applied

### A. Tauri icon

- Added/updated icon file:
  - `apps/desktop/src-tauri/icons/icon.png`
- Replaced with valid PNG in RGBA format.

### B. `db_list_review_actions` refactor

- File: `apps/desktop/src-tauri/src/commands/db.rs`
- Replaced `query_map` `if/else` return pattern with explicit branch query + row iteration.
- This removes closure type mismatch and inference ambiguity.

### C. Cleanup

- Removed unused helper functions in:
  - `apps/desktop/src-tauri/src/commands/command_runner.rs`

## Verification

- Command run:
  - `cd apps/desktop/src-tauri && cargo check`
- Result:
  - success, no compile errors


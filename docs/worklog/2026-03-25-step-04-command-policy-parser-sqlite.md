# Step 04 - Command policy + explain parser + SQLite

Date: 2026-03-25

## Goal

Implement batch-2 foundation:

1. safer command execution in rust
2. explain text parsing in frontend
3. persistence move from localStorage to SQLite

## Completed

### A. Rust command execution policy

- Added `apps/desktop/src-tauri/src/commands/command_runner.rs`
- Introduced shared execution behavior:
  - 20s timeout for child process execution
  - stderr truncation for stable error payloads
  - commit SHA argument validation (hex + length limits)
- Migrated command modules to use the shared runner:
  - `commands/entire.rs`
  - `commands/git.rs`

### B. SQLite persistence commands

- Added `apps/desktop/src-tauri/src/commands/db.rs`
- Added schema bootstrap on first access:
  - sqlite file: `.giteam/client.db`
  - table: `review_records`
- Added tauri commands:
  - `db_save_review_record`
  - `db_list_review_records`
- Registered commands in:
  - `apps/desktop/src-tauri/src/main.rs`
- Added new rust dependencies in:
  - `apps/desktop/src-tauri/Cargo.toml`

### C. Frontend storage migration

- Replaced localStorage storage adapter with tauri invoke storage:
  - `apps/desktop/src/lib/storage.ts`
- Updated UI flow to async-load and async-refresh records:
  - `apps/desktop/src/App.tsx`

### D. Explain parser groundwork

- Added parser module:
  - `apps/desktop/src/lib/explainParser.ts`
- Parser extracts coarse fields from explain text:
  - `Checkpoint`
  - `Session`
  - `Tokens`
  - fallback `No associated Entire checkpoint`
- Integrated parser in orchestrator:
  - `apps/desktop/src/lib/reviewOrchestrator.ts`

## Decisions

- Keep parser tolerant and text-based for now, then migrate to richer typed mapping later.
- Store only review records in first SQLite migration; action table comes next batch.
- Keep command allowlist implicit via explicit rust command functions (no generic shell command API).

## Known gaps

- No DB migration version table yet
- No structured JSON output for explain in upstream `entire` (still text parsing)
- No robust retry queue for review tasks

## Next

1. Add migration tracking table (`schema_migrations`)
2. Add `review_actions` table + command APIs
3. Add timeline read model aggregation path (git + explain + sqlite reviews)


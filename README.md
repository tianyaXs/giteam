# giteam desktop client scaffold

This repository now contains the initial scaffold for a desktop app that orchestrates `git` and `entire` CLI, plus a review agent workflow.

## Structure

- `apps/desktop`: React + Tauri app scaffold
- `docs/worklog`: step-by-step build notes for handover
- `team-ai-collaboration-client-design.md`: architecture baseline

## Current status

- Project skeleton created
- Adapter interfaces and command wiring created
- Rust command execution policy added (timeout + validation)
- SQLite persistence added via Tauri commands
- Frontend storage switched from localStorage to SQLite
- Basic `entire explain` parser scaffold added
- All command execution is now scoped by explicit `repoPath`
- Worklog documents created for each completed step

## Next

1. Install dependencies and run the app locally
2. Add migration/version management for SQLite
3. Implement timeline aggregation and richer review schema
 
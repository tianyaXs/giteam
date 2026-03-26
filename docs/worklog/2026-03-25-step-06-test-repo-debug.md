# Step 06 - Local test repo and command debugging

Date: 2026-03-25

## Goal

Create a dedicated local test git repository and validate real `git` + `entire` command behavior for development debugging.

## Test repository

- Path: `/Users/tianya/Documents/project/giteam/test`
- Initialized as independent git repo

## Setup actions completed

1. `git init`
2. configured local git user
3. committed seed files:
   - `README.md`
   - `src/index.ts`

## Debug checks run

- `git rev-parse HEAD`
- `entire version`
- `entire status --detailed`
- `entire explain --commit <sha> --no-pager`
- `entire enable --agent cursor --force`
- post-enable validation:
  - `entire status --detailed`
  - additional git commit
  - `entire explain --commit <new sha> --no-pager`

## Observed behavior

- `entire` is installed and callable in this environment (`0.5.1`)
- before enable: `entire status --detailed` reports not set up
- enable succeeded with Cursor agent and created `.entire/settings.json`
- `entire explain --commit` works and correctly reports no checkpoint trailer for regular commits

## Important note for future debugging

- Do not run multiple `git commit` commands in parallel in the same repo.
- Use sequential command execution when mutating git history.

## Recommended debug flow (stable)

1. `cd /Users/tianya/Documents/project/giteam/test`
2. `entire status --detailed`
3. `git rev-parse HEAD`
4. `entire explain --commit <sha> --no-pager`


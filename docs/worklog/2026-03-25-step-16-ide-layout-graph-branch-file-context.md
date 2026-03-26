# Step 16 - IDE layout + branch graph + file diff + agent context

Date: 2026-03-25

## Goal

Implement requested UX direction:

- vscode-like personal client layout
- branch node graph style
- click branch -> commits
- click commit -> changed files + agent context
- click file -> patch diff

## Backend additions

### New git commands

- `run_git_commit_changed_files(repo_path, commit_sha) -> Vec<String>`
- `run_git_commit_file_patch(repo_path, commit_sha, file_path) -> String`

Files:
- `apps/desktop/src-tauri/src/commands/git.rs`
- registered in `apps/desktop/src-tauri/src/main.rs`

## Frontend UX changes

### Layout

- 3-column workspace:
  - left: repositories
  - middle: branch graph + commits + changed files
  - right: status + diff/context tabs + findings

### Interactions

- selecting branch refreshes commit list
- selecting commit auto-loads:
  - changed files list
  - `entire explain` context
- selecting file loads file-specific patch
- detail tabs:
  - `File Diff`
  - `Agent Context`

### Styling

- dark IDE-style visual language
- branch graph node with dot/connector line
- active/selected states for repositories, branches, commits, files

Files:
- `apps/desktop/src/App.tsx` (rewritten)
- `apps/desktop/src/styles.css` (rewritten)
- `apps/desktop/src/lib/gitAdapter.ts` (new adapters)

## Validation

- `cargo check` passed
- `npm run build` passed


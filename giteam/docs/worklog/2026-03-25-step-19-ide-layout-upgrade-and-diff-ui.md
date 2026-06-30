# Step 19 - IDE layout upgrade + VSCode-like diff UI

Date: 2026-03-25

## Goal

Upgrade UI to a stronger desktop-client form:
- near-fullscreen startup
- leftmost project avatar rail
- bottom add button to import project
- branch graph nodes
- file diff as old/new side-by-side comparison

## Implemented

### A. Window size behavior

- File: `apps/desktop/src-tauri/tauri.conf.json`
- Updated window:
  - `maximized: true`
  - larger defaults (`1720x980`)
  - min size constraints

### B. Project rail

- Leftmost narrow rail shows project avatars (first letter only)
- Bottom `+` button opens import prompt and adds repository
- File: `apps/desktop/src/App.tsx`

### C. Explorer and details split

- Middle pane:
  - branch graph nodes
  - commit list
  - changed files list
- Right pane:
  - status and actions
  - tabbed details (`Diff` / `Agent Context`)
  - findings actions
- File: `apps/desktop/src/App.tsx`

### D. Diff comparison style

- Added side-by-side diff renderer from unified patch:
  - left = old
  - right = new
  - add/delete/meta row coloring
- Files:
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/styles.css`

## Validation

- `npm run build` passed
- `cargo check` passed


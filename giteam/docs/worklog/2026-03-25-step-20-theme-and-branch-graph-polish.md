# Step 20 - Theme toggle + branch graph polish + VSCode-like controls

Date: 2026-03-25

## Goal

Implement requested visual upgrade without changing existing data flow:

- keep near-fullscreen desktop behavior
- keep avatar-only project rail with bottom `+`
- improve branch rendering to graph-node style
- reduce plain text button feeling via chip/icon controls
- support white/light theme toggle

## Implemented

### A. Theme system (dark/light)

Files:
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`

Changes:
- Added `Theme` state (`dark` / `light`)
- Added `useTheme()` hook with localStorage persistence key:
  - `giteam.theme`
- Theme is applied by setting `data-theme` on `document.documentElement`
- Added theme toggle control in details toolbar

### B. Branch graph visual upgrade

Files:
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`

Changes:
- Branch entries are now graph-node buttons with:
  - lane connector
  - dot marker
  - branch name
  - `HEAD` badge for current branch
- Selected branch uses accent border + inset highlight
- Branch click now calls dedicated `chooseBranch()` helper

### C. UI control polish (less plain text)

Files:
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`

Changes:
- Added visual button variants:
  - `icon-btn` (compact square tools)
  - `chip` (toolbar actions)
  - upgraded `tab`
- Explorer top actions converted to icon-like controls
- Kept behavior unchanged for review/context actions

### D. Diff and panel visual consistency

File:
- `apps/desktop/src/styles.css`

Changes:
- Unified color-token system via CSS variables
- Dark + light palettes supported from same token map
- Improved diff panel contrast for add/delete/meta lines
- Improved panel, rail, and selection visual hierarchy

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

## Notes for next agent

1. If more VSCode-like behavior is required, next step is replacing prompt-based import with native folder picker dialog.
2. For branch topology beyond a vertical lane, add a lightweight graph layout model from `git log --graph --decorate --oneline` parse output.

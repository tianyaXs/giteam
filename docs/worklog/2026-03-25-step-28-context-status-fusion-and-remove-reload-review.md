# Step 28 - Merge Status into Agent Context and remove Reload Review

Date: 2026-03-25

## Goal

Refine the reading interaction by merging Status with Agent Context and removing redundant review reload action.

## Changes

### A. Tabs simplified

File:
- `apps/desktop/src/App.tsx`

Changes:
- `DetailTab` changed from:
  - `diff | context | findings | status`
- to:
  - `diff | context | findings`
- Removed standalone `Status` tab entry.

### B. Status integrated into Context tab

File:
- `apps/desktop/src/App.tsx`

Changes in `context` view:
- Added `Project Status` section card (source: `entire status --detailed` output)
- Added `Agent Context` section card (source: `entire explain --commit --no-pager` output)
- Kept existing checkpoint/session/tokens metadata and full-context button.

This creates a single, coherent context-reading surface instead of splitting status/context into separate tabs.

### C. Remove Reload Review button

File:
- `apps/desktop/src/App.tsx`

Changes:
- Removed UI button `Reload Review` from reading toolbar.
- Existing auto-refresh paths remain unchanged (repo switch, review run, etc.).

### D. Styling for merged context layout

File:
- `apps/desktop/src/styles.css`

Added styles:
- `.context-section-card`
- `.context-section-head`
- `.status-embedded-pre`

This provides clearer visual hierarchy and controlled status block height.

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

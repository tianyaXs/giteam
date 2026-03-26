# Step 24 - Branch panel changed to tree-only view (no list illusion)

Date: 2026-03-25

## Goal

Address feedback that branch area still looked like a plain list.

## Implemented

### A. Removed list-like branch pills from graph panel

File:
- `apps/desktop/src/App.tsx`

Changes:
- Removed top branch pill row from `Branch Graph` panel.
- Graph panel now focuses on commit DAG rows only.

### B. Make refs badges actionable for branch switching

File:
- `apps/desktop/src/App.tsx`

Changes:
- Added `branchFromRef()` helper to map graph ref badge -> local branch.
- Ref badges are now buttons; clicking branch-related refs triggers `chooseBranch()`.
- Non-branch refs (e.g., tags) are not used for branch switch.

### C. Strengthened tree visual language

File:
- `apps/desktop/src/styles.css`

Changes:
- Enhanced graph glyph emphasis in `.graph-ascii` (weight/size/color).
- Added dedicated `.graph-ref-btn` styles for ref badges.
- Keeps tree rows visually distinct from generic list cards.

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

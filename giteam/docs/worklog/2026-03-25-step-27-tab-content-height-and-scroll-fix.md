# Step 27 - Tab content area height/scroll normalization

Date: 2026-03-25

## Goal

Fix usability issue where `Diff / Agent Context / Findings / Status` tab content was either too short or too long and difficult to inspect.

## Root cause

- Some tab content containers had fixed max-height limits.
- Tab body did not consistently use a fill-parent + internal-scroll pattern.
- `pre` blocks were globally capped at `max-height: 240px`, which made Status tab appear too short.

## Changes

### A. Unified tab content scrolling model

Files:
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`

Changes:
- Wrapped tab contents with `.wb-reading-scroll` for consistent internal scrolling.
- Applied this to:
  - `Agent Context`
  - `Status`
  - `Findings`

### B. Context tab layout normalization

File:
- `apps/desktop/src/styles.css`

Changes:
- Added `.wb-context` as vertical flex container.
- `.wb-context .markdown-lite` now fills available area and scrolls internally.

### C. Diff tab fill behavior

File:
- `apps/desktop/src/styles.css`

Changes:
- `.diff-view` now `flex: 1; min-height: 0`.
- Diff body keeps internal scrolling while filling available panel height.

### D. Status pre block override in reading area

File:
- `apps/desktop/src/styles.css`

Changes:
- Added `.wb-reading-scroll > pre { max-height: none; min-height: 100%; }`
- Avoids global `pre` max-height from shrinking Status tab content.

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

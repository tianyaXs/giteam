# Step 25 - Graph line visualization (not plain ASCII text)

Date: 2026-03-25

## Goal

Fix issue where branch graph looked like a list with text only and lacked clear line rendering.

## Implemented

### A. Convert git graph chars to visual lanes/nodes

File:
- `apps/desktop/src/App.tsx`

Added `graphGlyph()` renderer that maps per-char symbols to styled tokens:
- `|` -> vertical lane
- `/` -> slash lane
- `\\` -> backslash lane
- `-`/`_` -> horizontal lane
- `*` -> commit node
- space -> spacer

Graph column now renders tokenized visual glyphs instead of plain string text.

### B. Lane and node styling

File:
- `apps/desktop/src/styles.css`

Added classes:
- `.graph-glyph`
- `.lane`, `.lane-vert`, `.lane-slash`, `.lane-backslash`, `.lane-horiz`, `.lane-node`, `.lane-space`

Effect:
- graph lines are drawn as CSS strokes
- commit point rendered as explicit circle node
- visual result is significantly closer to IDE-style graph lane rendering

## Validation

Commands run:

1. `npm run build --workspace apps/desktop`
2. `cargo check` (in `apps/desktop/src-tauri`)

Results:
- both passed

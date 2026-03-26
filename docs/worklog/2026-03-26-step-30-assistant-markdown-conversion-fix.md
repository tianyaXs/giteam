# Step 30 - Assistant transcript markdown conversion completion

Date: 2026-03-26

## Goal

Fix issue where some assistant transcript messages still displayed raw markdown markers instead of converted formatting.

## Root Cause

`MarkdownLite` inline parsing was too limited:
- only supported inline code and links
- did not support common inline markdown like bold/italic/strikethrough

Transcript parsing was also strict:
- only supported `[User]` / `[Assistant]`
- did not handle `User:` / `Assistant:` style markers

## Implemented

File:
- `apps/desktop/src/App.tsx`

### A. Inline markdown coverage expanded

Updated `renderInlineMarkdown()` to support:
- `**bold**`
- `*italic*` and `_italic_`
- `~~strikethrough~~`
- existing inline code and links

### B. Normalized escaped newline rendering

Updated `MarkdownLite` input normalization:
- normalize CRLF to LF
- convert escaped `\\n` to real newlines before block parsing

This improves rendering when transcript content contains escaped newline sequences.

### C. Transcript parser compatibility improved

Updated `parseTranscript()`:
- supports both `[User]` / `[Assistant]` and `User:` / `Assistant:` markers
- parses role markers at line boundaries to reduce accidental split issues

## Validation

Command run:

1. `npm run build --workspace apps/desktop`

Result:
- passed

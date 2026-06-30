# Step 14 - Branch discovery fallback for `branches=0`

Date: 2026-03-25

## Problem

User reported UI counters:
- `repos=2 branches=0 commits=0 reviews=0`

This indicates branch discovery pipeline returned empty list.

## Fix

File: `apps/desktop/src-tauri/src/commands/git.rs`

Implemented multi-strategy branch discovery:

1. `git for-each-ref --format=%(HEAD)\t%(refname:short) refs/heads`
2. fallback `git branch --format=...`
3. fallback `git branch --list`
4. final fallback `git symbolic-ref --short HEAD`

Also added resilient branch-line parser for:
- control-char separator
- `%x1f` literal
- `^_` literal
- plain `* master` / `  dev` style

Internal metadata branches (`entire/*`) are filtered out.

## Validation

- `cargo check` passed


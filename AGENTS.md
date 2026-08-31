# Repository Guidelines

## Project Structure & Module Organization

This repository is a multi-client application with shared Rust services:

- `apps/desktop/`: React, TypeScript, Vite, and Tauri desktop app. UI code lives in `src/`; native commands and packaging live in `src-tauri/`.
- `apps/mobile/`: Expo/React Native client. Features, screens, storage, and API code are under `src/`; static files are in `assets/`.
- `apps/cli/`: Rust CLI plus npm packaging scripts and platform packages.
- `crates/giteam-core/`: shared Rust control, agent, and RPC logic; integration tests live in `tests/`.
- `docs/`: architecture notes, ADRs, plans, and worklogs. GitHub release automation is in `.github/workflows/`.

Do not commit generated `dist/`, `target/`, `node_modules/`, `.expo/`, or local `.giteam/` data.

## Build, Test, and Development Commands

Install dependencies per app rather than introducing a new workspace tool:

- `npm --prefix apps/desktop ci`: install the desktop lockfile exactly.
- `npm run dev`: start the desktop Vite frontend.
- `npm run build`: type-check and build the desktop frontend.
- `npm run tauri:dev`: run the complete desktop app locally.
- `npm --prefix apps/mobile install && npm --prefix apps/mobile start`: install and launch Expo.
- `npm --prefix apps/cli run build`: build the release CLI.
- `cargo test --manifest-path crates/giteam-core/Cargo.toml`: run shared Rust tests.
- `node --test apps/desktop/tests/*.test.mjs`: run desktop Node tests.

## Coding Style & Naming Conventions

Match existing code: two-space indentation and semicolons in TypeScript/TSX; standard `rustfmt` output in Rust. Use `PascalCase.tsx` for React components, `camelCase.ts` for utilities and hooks, and `snake_case.rs` for Rust modules. Keep changes surgical and reuse nearby helpers before adding abstractions. No repository-wide JS formatter or linter is configured, so `npm run build` is the required TypeScript check.

## Testing Guidelines

Use Rust's built-in test framework and Node's `node:test`/`node:assert`. Name tests `*.test.ts`, `*.test.mjs`, or place Rust integration tests under `tests/`. Add the smallest regression test that proves a bug fix. There is no declared coverage threshold; prioritize affected control, RPC, storage, and UI transformation paths.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative subjects such as `Fix desktop release CI...` and release commits such as `Ship desktop 0.2.4...`. Keep each commit focused. Pull requests should explain the behavior change, list verification commands, link relevant issues or plans, and include screenshots for visible desktop or mobile UI changes. Never include credentials, signing keys, or user data from `~/.giteam`.

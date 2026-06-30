# Handover

## Latest Update

- 2026-04-08: Mobile 鉴权页收敛、字符画渲染稳定化与双端打包交接
  - `docs/worklog/2026-04-08-step-37-mobile-auth-polish-and-packaging.md`
- 2026-04-07: Mobile Control 局域网可达、扫码/流式状态修复与本地 APK 构建记录
  - `docs/worklog/2026-04-07-step-36-mobile-control-lan-sync-and-local-apk.md`
- 2026-04-01: OpenCode 流式渲染与交互改造交接文档
  - `docs/worklog/2026-04-01-step-31-opencode-streaming-ui-handover.md`

Date: 2026-03-25

## What is done

- Architecture doc refined with non-duplication boundaries
- Desktop scaffold landed with Tauri + React split
- `git` and `entire` command bridge implemented in Rust command layer
- Shared Rust command policy added:
  - timeout
  - stderr truncation
  - commit SHA validation
- SQLite persistence introduced at `.giteam/client.db`
- Frontend storage moved from localStorage to SQLite-backed tauri commands
- `entire explain` lightweight text parser added and wired into orchestrator
- Command and storage layers now scoped by explicit `repoPath`
- Finding-level review actions (`accept/dismiss/todo`) persisted in SQLite and wired to UI
- Compile blockers reported during local run were fixed:
  - tauri icon asset (RGBA PNG)
  - `db_list_review_actions` type mismatch
- Real timeline feature added:
  - load recent commits
  - select commit
  - explain selected commit
  - run review for selected commit
- Repository-centric client flow added:
  - import/remove repository
  - left sidebar repository list
  - per-repo branch list and commit list
  - commit context panel and visible status messages
- Dedicated debug repo created:
  - `/Users/tianya/Documents/project/giteam/test`
  - `entire enable --agent cursor --force` completed there
- First-pass UI can:
  - query `entire status --detailed`
  - read `git rev-parse HEAD`
  - execute scaffold review flow and persist records in SQLite

## Where to continue

1. `apps/desktop/src-tauri/src/commands/db.rs`
2. `apps/desktop/src-tauri/src/commands/command_runner.rs`
3. `apps/desktop/src/lib/reviewOrchestrator.ts`
4. `apps/desktop/src/lib/explainParser.ts`
5. `docs/worklog/2026-03-25-step-06-test-repo-debug.md`
6. `docs/worklog/2026-03-25-step-07-repo-path-scoping.md`
7. `docs/worklog/2026-03-25-step-08-review-actions-and-runtime-check.md`
8. `docs/worklog/2026-03-25-step-09-compile-fixes.md`
9. `docs/worklog/2026-03-25-step-10-timeline-feature.md`
10. `docs/worklog/2026-03-25-step-11-repo-sidebar-and-branch-commit-context.md`

## Suggested immediate tasks

1. Add DB migration tracking and schema versioning
2. Enrich commit rows with review status badges and filter controls
3. Run full Tauri runtime UX validation in local GUI session
- 2026-04-03: OpenCode 服务固定端口与接口冒烟验证
  - `docs/worklog/2026-04-03-step-32-opencode-service-4098-and-api-smoke.md`
- 2026-04-03: Mobile App React MVP
  - `docs/worklog/2026-04-03-step-33-mobile-react-mvp.md`
- 2026-04-03: Mobile Debug UI + QR
  - `docs/worklog/2026-04-03-step-34-mobile-debug-ui-and-qr.md`

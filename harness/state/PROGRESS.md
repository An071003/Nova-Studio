# PROGRESS — bộ nhớ phiên của agent

> Cập nhật ở bước PROPOSE và COMPOSE của mỗi task. Không xoá lịch sử; task mới thêm lên đầu bảng Log.

## Milestone
- M1 — MVP: IN_PROGRESS
- M2 — Production: NOT_STARTED

## Current task
- ID: P1-T12 · Status: DONE · Completed: 2026-11-14
- Goal: Implement full Dashboard CRUD: workspace switcher + create/rename workspace, `<search>` filter, "+ New design" dialog, 16:10 project grid with rename, duplicate, and delete confirmation dialogs, plus Playwright CRUD E2E & screenshot.
- Evidence: `pwsh harness/probes/probe.ps1 -Scope web` PASS 6/6 (`vitest` 3/3, Playwright `auth.spec.ts` + `dashboard.spec.ts` 2/2 passed) & `pnpm --filter web build` PASS; screenshot `harness/evals/screenshots/p1-t12-dashboard.png`.

## Blockers
_(không có)_

## Task status
| ID | Status | Date | Evidence (dòng tổng kết probe) |
|---|---|---|---|
| P1-T01 | DONE | 2026-11-14 | PROBE PASS: 6 step(s) (lint, typecheck, guards, 9 pkg build/test, 12/12 tests) |
| P1-T02 | DONE | 2026-11-14 | PROBE PASS: 1 step(s) (postgres, redis, minio+nova-assets, mailpit Healthy) |
| P1-T03 | DONE | 2026-11-14 | PROBE PASS: 5 step(s) (Tests 8/8 passed; permissions.ts 100% stmts/branch/funcs/lines) |
| P1-T04 | DONE | 2026-11-14 | PROBE PASS: 6 step(s) (unit 3/3 + e2e 2/2; db/redis/s3 health 200; 3 users seeded) |
| P1-T05 | DONE | 2026-11-14 | PROBE PASS: 6 step(s) (unit 4/4 + e2e 5/5: register/login/refresh/reuse/logout/me/429) |
| P1-T06 | DONE | 2026-11-14 | `probe -Scope api` PASS 6/6 (unit 9/9, e2e 7/7 incl. role matrix + Yjs init doc + cursor + duplicate + soft-delete AuditLog) |
| P1-T07 | DONE | 2026-11-14 | `probe -Scope editor-core` PASS 5/5 (13/13 tests incl. all 7 conflicts + 200-op 3-peer convergence; 88.94% stmts/lines coverage) |
| P1-T08 | DONE | 2026-11-14 | `probe -Scope editor-core` PASS 5/5 (21/21 tests incl. 2-peer UndoManager + remoteNodeDeleted + tools FSM; 90.24% stmts/lines coverage) |
| P1-T09 | DONE | 2026-11-14 | `probe -Scope realtime` PASS 5/5 (4/4 tests: health, 2-client sync, viewer readOnly, bad tickets, >1MB 1009, restart DB persist, Redis restore) |
| P1-T10 | DONE | 2026-11-14 | `probe -Scope api` PASS 6/6 (unit 9/9, e2e 8/8 incl. role matrix + override + 404 deleted/non-member + 60s HS256 claims) & `probe -Scope realtime` PASS 5/5 |
| P1-T11 | DONE | 2026-11-14 | `probe -Scope web` PASS 6/6 (`@nova/ui` 3/3, `web` unit 3/3, `next build` ok, Playwright `auth.spec.ts` 1/1 + screenshots) |
| P1-T12 | DONE | 2026-11-14 | `probe -Scope web` PASS 6/6 (Playwright `auth` + `dashboard` CRUD 2/2 + `next build` PASS + screenshot) |
| P1-T13 | TODO | | |
| P1-T14 | TODO | | |
| P1-T15 | TODO | | |
| P1-T16 | TODO | | |
| M1-GATE | TODO | | |
| P1-T17 | TODO | | |
| P1-T18 | TODO | | |
| P1-T19 | TODO | | |
| P1-T20 | TODO | | |
| P1-T21 | TODO | | |
| P1-T22 | TODO | | |
| P1-T23 | TODO | | |
| P1-T24 | TODO | | |
| P1-T25 | TODO | | |
| M2-GATE | TODO | | |

Status hợp lệ: `TODO | IN_PROGRESS | BLOCKED | REVIEW | DONE`.

## Log
| Date | Task | Note (CONTRAST rounds, follow-ups) |
|---|---|---|
| 2026-11-14 | P1-T01 | 1 CONTRAST round: added top-level `main`/`types` for CJS consumers & 20s timeout for cold ESLint boundary test. |
| 2026-11-14 | P1-T02 | 2 CONTRAST rounds: switched MinIO to `pgsty/silo:latest` + inline SigV4 bucket init & healthcheck (public Docker Hub `minio/minio` removed & `--wait` fails on exiting one-shot containers). |
| 2026-11-14 | P1-T03 | 0 CONTRAST rounds: 100% coverage on `permissions.ts` and all Zod schemas. |
| 2026-11-14 | P1-T04 | 1 CONTRAST round: added direct `express` + `@types/express` for pnpm strict node_modules. |
| 2026-11-14 | P1-T05 | 0 CONTRAST rounds: Auth + refresh token reuse family revocation + throttler e2e PASS first run. |
| 2026-11-14 | P1-T06 | 1 CONTRAST round: Fixed Prisma `Uint8Array<ArrayBuffer>` type (`Uint8Array.from(...)`) and ordered `OWNER` last in role-matrix e2e so `DELETE` does not soft-delete before `EDITOR`/`VIEWER` checks. `probe -Scope api` PASS 6/6. |
| 2026-11-14 | P1-T07 | 1 CONTRAST round: Switched `@nova/editor-core` and `@nova/editor-konva` to ESM-only builds (`fractional-indexing@4`/`nanoid@6`/`rbush@4` are pure ESM), added fallback in `generateJitteredKeyBetween`, and set 30s timeout on slow V8-instrumented ESLint boundary tests. |
| 2026-11-14 | P1-T08 | 3 CONTRAST rounds: Removed `zod` import in `clipboard.ts` (use `@nova/shared` schema), eliminated extra empty tx in `initializeDocIfEmpty`, and added `executeDiscrete` `stopCapturing()` around discrete tool gestures so `Delete -> Undo` isolates cleanly from coalesced edits. `probe -Scope editor-core` PASS 5/5 (21/21 tests, 90.24% coverage). |
| 2026-11-14 | P1-T09 | 2 CONTRAST rounds: Added `provider.attach()` + `autoConnect: false` and `minDelay <= delay` on `HocuspocusProviderWebsocket` (documented in `LESSONS.md` `L-009`). Added `@hocuspocus/server` v4 `websocketOptions.maxPayload` + `beforeHandleMessage` 1MB guards, Postgres `"ProjectDocument"` upsert, and Redis `nova:restore:*` reconciliation. `probe -Scope realtime` PASS 5/5 (4/4 tests). |
| 2026-11-14 | P1-T10 | 0 CONTRAST rounds: Extracted `RealtimeTicketClaimsSchema` to `@nova/shared` so `apps/api` and `apps/realtime` share one Zod schema; added `POST /api/v1/projects/:id/realtime-ticket` (`@HttpCode(200)`) checking `project.realtime_connect`. `probe -Scope api` PASS 6/6 (unit 9/9, e2e 8/8) + `probe -Scope realtime` PASS 5/5. |
| 2026-11-14 | P1-T11 | 1 CONTRAST round: Fixed ESM `__dirname` (`fileURLToPath`) in `playwright.config.ts` & `auth.spec.ts`; added `@source` to `globals.css` for Tailwind v4 scanning `@nova/ui/src`. Built `packages/ui` + Next.js App Router (`/login`, `/register`, `/dashboard`), single-flight refresh-on-401 `NovaApiClient`, and Playwright E2E + screenshots (`probe -Scope web` PASS 6/6). |
| 2026-11-14 | P1-T12 | 1 CONTRAST round: Caught permission key mismatch (`project.edit` -> `project.update`) via `typecheck` & Playwright `dashboard.spec.ts`; verified full workspace/project CRUD, `<search>` filter, duplicate, delete dialog, and screenshot (`probe -Scope web` PASS 6/6, `2/2` E2E). |

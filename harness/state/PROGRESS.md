# PROGRESS — bộ nhớ phiên của agent

> Cập nhật ở bước PROPOSE và COMPOSE của mỗi task. Không xoá lịch sử; task mới thêm lên đầu bảng Log.

## Milestone
- M1 — MVP: IN_PROGRESS
- M2 — Production: NOT_STARTED

## Current task
_(trống)_

## Blockers
_(không có)_

## Task status
| ID | Status | Date | Evidence (dòng tổng kết probe) |
|---|---|---|---|
| P1-T01 | DONE | 2026-11-14 | PROBE PASS: 6 step(s) (lint, typecheck, guards, 9 pkg build/test, 12/12 tests) |
| P1-T02 | DONE | 2026-11-14 | PROBE PASS: 1 step(s) (postgres, redis, minio+nova-assets, mailpit Healthy) |
| P1-T03 | DONE | 2026-11-14 | PROBE PASS: 5 step(s) (Tests 8/8 passed; permissions.ts 100% stmts/branch/funcs/lines) |
| P1-T04 | DONE | 2026-11-14 | PROBE PASS: 6 step(s) (unit 3/3 + e2e 2/2; db/redis/s3 health 200; 3 users seeded) |
| P1-T05 | TODO | | |
| P1-T06 | TODO | | |
| P1-T07 | TODO | | |
| P1-T08 | TODO | | |
| P1-T09 | TODO | | |
| P1-T10 | TODO | | |
| P1-T11 | TODO | | |
| P1-T12 | TODO | | |
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

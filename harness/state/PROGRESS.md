# PROGRESS — bộ nhớ phiên của agent

> Cập nhật ở bước PROPOSE và COMPOSE của mỗi task. Không xoá lịch sử; task mới thêm lên đầu bảng Log.

## Milestone
- M1 — MVP: IN_PROGRESS
- M2 — Production: NOT_STARTED

## Current task
- ID: P1-T01 · Status: IN_PROGRESS · Started: 2026-11-14
- Goal: Scaffold monorepo pnpm + Turborepo, strict TS, ESLint boundaries, Prettier, Vitest, and all 9 workspace packages.
- Files: `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `packages/*`, `apps/*`
- Risks: pnpm `-- --coverage` arg forwarding with Vitest; ESLint v9 flat config + `import/no-restricted-paths` on Windows paths.
- Probe plan: `pwsh harness/probes/probe.ps1 -Scope all` + ESLint boundary rejection fixture test.

## Blockers
_(không có)_

## Task status
| ID | Status | Date | Evidence (dòng tổng kết probe) |
|---|---|---|---|
| P1-T01 | IN_PROGRESS | 2026-11-14 | |
| P1-T02 | TODO | | |
| P1-T03 | TODO | | |
| P1-T04 | TODO | | |
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

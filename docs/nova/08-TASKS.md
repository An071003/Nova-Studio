# 08 — TASKS (backlog thực thi theo thứ tự)

Trạng thái lưu ở `harness/state/PROGRESS.md` (không sửa bảng này trừ khi thêm task qua ADR).
Mỗi task: **AC** = acceptance criteria; **Probe** = lệnh chứng minh. Một task ≈ 1 phiên agent.

## M1 — MVP

| ID | Task | Phụ thuộc | AC | Probe |
|---|---|---|---|---|
| P1-T01 | Scaffold monorepo (pnpm, turbo, tsconfig strict, eslint boundaries, prettier, vitest) | – | `pnpm i && pnpm build && pnpm lint && pnpm test` xanh với package rỗng; eslint chặn import sai ranh giới (có test fixture) | `probe -Scope all` |
| P1-T02 | `infra/docker-compose.dev.yml`: postgres, redis, minio (+ bucket init), mailpit | T01 | `docker compose up -d` healthy; `.env.example` đầy đủ | `probe -Scope infra` |
| P1-T03 | `packages/shared`: Zod schemas (auth, workspace, project, asset, node doc), Role, `can()`, errors | T01 | Unit test `can()` phủ 100% ma trận 07-SECURITY | `probe -Scope shared` |
| P1-T04 | `apps/api` khung NestJS: config, pino, Prisma schema 02-DATABASE, migrate, seed, `/health`, Zod pipe, error filter | T02,T03 | `/health` 200; seed tạo 3 user | `probe -Scope api` |
| P1-T05 | Auth (register/login/refresh rotate/logout/me), argon2, cookie | T04 | e2e: flow đầy đủ + reuse detection + rate limit | `probe -Scope api` |
| P1-T06 | Workspaces + Projects CRUD + PermissionService | T05 | e2e cho từng role theo ma trận (bảng test sinh từ `can()`) | `probe -Scope api` |
| P1-T07 | `editor-core` model + commands + scene diff (không UI) | T03 | Unit: mọi command; 2-doc convergence test cho bảng conflict 04-REALTIME | `probe -Scope editor-core` |
| P1-T08 | `editor-core` geometry, selection, tools state machine, history (UndoManager local) | T07 | Unit: resize/rotate/snap; undo chỉ thao tác của mình (2 doc) | `probe -Scope editor-core` |
| P1-T09 | `apps/realtime` Hocuspocus: ticket auth, readOnly viewer, Postgres persistence | T04,T07 | Test: 2 client sync; viewer update bị bỏ; restart server không mất data | `probe -Scope realtime` |
| P1-T10 | API `/realtime-ticket` | T06,T09 | e2e: ticket hợp lệ/hết hạn/sai project | `probe -Scope api` |
| P1-T11 | `packages/ui` tokens + shadcn base; `apps/web` khung Next: auth pages, API client (TanStack Query, refresh interceptor) | T05 | Playwright: đăng ký → vào dashboard | `probe -Scope web` |
| P1-T12 | Dashboard: workspace switcher, project grid, tạo/đổi tên/xoá | T06,T11 | Playwright CRUD + screenshot | `probe -Scope web` |
| P1-T13 | `editor-konva` renderer + Editor page layout (TopBar, Layers, Canvas, Properties, StatusBar) | T08,T11 | Vẽ đủ 5 loại node, transform handles, pan/zoom; 60fps @500 node (bench script) | `probe -Scope web` |
| P1-T14 | Kết nối realtime trên web: provider, presence cursors, remote selection, connection badge, y-indexeddb | T09,T10,T13 | **Eval E1–E4** PASS | `probe -Scope e2e` |
| P1-T15 | Assets: presigned upload, confirm, worker sharp (dimension+thumbnail), drag-drop ảnh vào canvas | T06,T13 | Eval E5 PASS; file 30MB bị từ chối | `probe -Scope e2e` |
| P1-T16 | Layers panel (reorder kéo thả, rename, hide, lock), properties panel đầy đủ, align/distribute, group, clipboard, phím tắt | T13 | Playwright cho từng thao tác | `probe -Scope web` |
| **M1-GATE** | Chạy `harness/evals` E1–E5 + QA M1 | T01–T16 | Tất cả PASS → ghi vào PROGRESS | `probe -Scope gate-m1` |

## M2 — Production-ready

| ID | Task | Phụ thuộc | AC | Probe |
|---|---|---|---|---|
| P1-T17 | Members & Invites (API + UI), đổi role, LAST_OWNER, audit log | M1 | e2e + Playwright; Eval E6 | `probe -Scope e2e` |
| P1-T18 | Project-level role override + Viewer UX read-only | T17 | Eval E7 | `probe -Scope e2e` |
| P1-T19 | Version history: manual + auto (worker cron), preview, restore qua Redis pub/sub | M1 | Eval E8 | `probe -Scope e2e` |
| P1-T20 | Offline/reconnect hardening, ticket refresh, toast node bị xoá, follow user | T14 | Eval E9, E10 | `probe -Scope e2e` |
| P1-T21 | Export PNG (client + server worker), thumbnail project tự sinh | T15 | Eval E11 | `probe -Scope e2e` |
| P1-T22 | Security hardening theo checklist 07 (Helmet, CSP, CORS, throttler Redis, SVG sanitize, gitleaks) | T17 | Checklist 07 tất cả ✅ có evidence | `probe -Scope security` |
| P1-T23 | Performance: rbush hit-test, load 1.000 node ≤ 2s, latency p95 ≤ 150ms (load test 10 client) | T20 | Eval E12 | `probe -Scope perf` |
| P1-T24 | Dockerfile production cho 4 app, `docker-compose.prod.yml`, Caddy TLS, GitHub Actions CI (lint, test, e2e, build images) | T22 | Từ máy sạch: `docker compose -f infra/docker-compose.prod.yml up` chạy, CI xanh | `probe -Scope deploy` |
| P1-T25 | Docs người dùng + README + runbook vận hành | T24 | README đủ để dev mới chạy trong ≤ 15 phút | review |
| **M2-GATE** | E1–E12 + QA gate 09 đầy đủ | T17–T25 | PASS → Phase 1 DONE | `probe -Scope gate-m2` |

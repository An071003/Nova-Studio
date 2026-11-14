# 07 — SECURITY & PERMISSIONS

## Ma trận quyền (role hiệu lực = ProjectMember.role ?? WorkspaceMember.role)
| Action | OWNER | EDITOR | VIEWER | Non-member |
|---|:-:|:-:|:-:|:-:|
| Xem workspace / danh sách project | ✅ | ✅ | ✅ | 404 |
| Đổi tên workspace, quản lý member, invite | ✅ | ❌ 403 | ❌ 403 | 404 |
| Tạo / đổi tên / nhân bản project | ✅ | ✅ | ❌ 403 | 404 |
| Xoá project | ✅ | ❌ | ❌ | 404 |
| Mở project (realtime ticket) | ✅ rw | ✅ rw | ✅ readOnly | 404 |
| Sửa canvas (Yjs update) | ✅ | ✅ | ❌ bị server bỏ | – |
| Upload asset | ✅ | ✅ | ❌ | 404 |
| Tạo / restore version | ✅ | ✅ | ❌ | 404 |
| Xem version, export PNG | ✅ | ✅ | ✅ | 404 |

Implement: `packages/shared/src/permissions.ts` (`can(role, action): boolean`) dùng chung cho UI (ẩn nút) và server (enforce).
UI ẩn nút **không** thay thế kiểm tra server.

## Threat checklist (QA gate kiểm từng mục)
- [x] IDOR: mọi `:id` kiểm thuộc workspace người dùng.
- [x] Realtime: ticket bound với projectId + exp 60s; Viewer gửi update bị bỏ (test).
- [x] Refresh token reuse → revoke family (test).
- [x] Upload: MIME whitelist, size limit, SVG sanitize, key ngẫu nhiên `projects/<pid>/<cuid>`.
- [x] XSS: tên project/layer/text render dạng text (React escape), không `dangerouslySetInnerHTML`.
- [x] Rate limit auth & API.
- [x] CORS/CSP/Helmet bật ở production compose.
- [x] Dependency audit `pnpm audit --prod` không có high/critical.
- [x] Secret scan (gitleaks) trong CI.

## Evidence (P1-T22 verification)
| Threat control | Implementation | Verification |
|---|---|---|
| IDOR & RBAC (`404` non-member, `403` insufficient role) | `packages/shared/src/permissions.ts`, `apps/api/src/permissions/permission.service.ts` | `workspaces-projects.e2e-spec.ts`, `members-invites.e2e-spec.ts`, `exports.e2e-spec.ts`, `E6` |
| Realtime ticket scoping (`60s`, `projectId`) & Viewer rejection | `apps/api/src/projects/realtime-ticket.service.ts`, `apps/realtime/src/server.ts` | `realtime-ticket.e2e-spec.ts`, `apps/realtime/test/realtime.test.ts`, `E6`, `E7` |
| Refresh token rotation + reuse family revocation | `apps/api/src/auth/auth.service.ts`, HttpOnly `SameSite=Lax` cookie | `auth.e2e-spec.ts` |
| Asset MIME/magic-bytes, 25 MB limit, SVG sanitization, UUID S3 key | `packages/shared/src/svg-sanitize.ts`, `apps/api/src/assets/assets.service.ts`, `apps/worker/src/image-processor.ts` | `svg-sanitize.test.ts`, `assets.e2e-spec.ts`, `worker/src/index.test.ts` |
| XSS-safe rendering | React JSX escaping across `apps/web/src`, `svg-sanitize.ts` & XML attribute escaping in `scene-svg.ts` | Web components + `schemas.test.ts` |
| Distributed API/Auth rate limiting | `apps/api/src/common/redis-throttler.storage.ts`, `apps/api/src/app.module.ts`, `apps/api/src/auth/auth.controller.ts` | `auth.e2e-spec.ts` (429 rate-limit check) |
| Helmet, CORS, CSP & security headers | `apps/api/src/app.setup.ts`, `apps/web/next.config.ts` | `apps/api` build/e2e + `apps/web` Next build |
| Dependency audit (`--prod --audit-level high`) | `package.json` (`zod ^4.6.7`, `pnpm.overrides` for `postcss` & `deepmerge-ts`) | `probe.ps1 -Scope security` (`No known vulnerabilities found`) |
| Secret scanning | `gitleaks detect --no-banner` + `.github/workflows/ci.yml` | `probe.ps1 -Scope security` |

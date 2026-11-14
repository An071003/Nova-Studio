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
- [ ] IDOR: mọi `:id` kiểm thuộc workspace người dùng.
- [ ] Realtime: ticket bound với projectId + exp 60s; Viewer gửi update bị bỏ (test).
- [ ] Refresh token reuse → revoke family (test).
- [ ] Upload: MIME whitelist, size limit, SVG sanitize, key ngẫu nhiên `projects/<pid>/<cuid>`.
- [ ] XSS: tên project/layer/text render dạng text (React escape), không `dangerouslySetInnerHTML`.
- [ ] Rate limit auth & API.
- [ ] CORS/CSP/Helmet bật ở production compose.
- [ ] Dependency audit `pnpm audit --prod` không có high/critical.
- [ ] Secret scan (gitleaks) trong CI.

---
trigger: model_decision
description: Áp dụng khi làm auth, phân quyền, upload file, endpoint API, cookie/token, CORS, rate limit, hoặc xử lý dữ liệu người dùng.
---

# Security rules

- Password: argon2id. Access token JWT 15 phút (memory phía client), refresh token rotating 30 ngày
  trong cookie `httpOnly; Secure; SameSite=Lax`, lưu **hash** trong DB, phát hiện reuse → thu hồi cả family.
- Authorization ở service layer qua `PermissionService.assert(user, resource, action)` — không chỉ ở guard.
- Ma trận quyền chuẩn: `docs/nova/07-SECURITY.md`. Mọi endpoint mới phải có test cho từng role (403 đúng chỗ).
- Không lộ tồn tại tài nguyên: project không có quyền → 404.
- Upload: presigned PUT (≤ 5 phút), whitelist MIME (png, jpeg, webp, gif, svg→sanitize), max 25MB,
  xác minh lại MIME/kích thước ở bước confirm (đọc header object). SVG phải sanitize (DOMPurify server-side).
- Rate limit (`@nestjs/throttler` + Redis): auth 10/phút/IP, API chung 300/phút/user.
- CORS chỉ origin trong env. Helmet bật. CSP ở Next.js (không `unsafe-eval` ở production).
- Log không chứa password, token, cookie. Audit log cho: đổi role, xoá project, restore version, mời thành viên.
- Secret chỉ qua env; `.env` trong `.gitignore`.

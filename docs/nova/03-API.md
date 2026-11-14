# 03 — API (NestJS REST, prefix `/api/v1`)

Chuẩn: JSON, lỗi dạng `{ error: { code, message, details? } }`. Auth: `Authorization: Bearer <access>`.
Mọi body/query validate bằng Zod schema trong `packages/shared/src/api/*`. Phân trang cursor: `?cursor=&limit=` (≤ 100).

## Auth
| Method | Path | Body | Trả về |
|---|---|---|---|
| POST | /auth/register | `{email,name,password}` | `{user, accessToken}` + cookie refresh |
| POST | /auth/login | `{email,password}` | `{user, accessToken}` + cookie |
| POST | /auth/refresh | cookie | `{accessToken}` (rotate) |
| POST | /auth/logout | cookie | 204 (revoke family) |
| GET | /me | – | `{user, workspaces[{id,name,role}]}` |

## Workspaces
| Method | Path | Quyền |
|---|---|---|
| POST | /workspaces `{name}` | auth (người tạo = OWNER) |
| GET | /workspaces/:id | member |
| PATCH | /workspaces/:id `{name}` | OWNER |
| GET | /workspaces/:id/members | member |
| PATCH | /workspaces/:id/members/:userId `{role}` | OWNER (không tự hạ OWNER cuối cùng) |
| DELETE | /workspaces/:id/members/:userId | OWNER hoặc chính mình |
| POST | /workspaces/:id/invites `{email?, role}` | OWNER → `{inviteUrl}` |
| POST | /invites/:token/accept | auth |

## Projects
| Method | Path | Quyền |
|---|---|---|
| GET | /workspaces/:id/projects | member |
| POST | /workspaces/:id/projects `{name}` | EDITOR+ |
| GET | /projects/:id | VIEWER+ → `{project, role}` |
| PATCH | /projects/:id `{name}` | EDITOR+ |
| DELETE | /projects/:id | OWNER |
| POST | /projects/:id/duplicate | EDITOR+ |
| POST | /projects/:id/realtime-ticket | VIEWER+ → `{ticket, wsUrl}` |

## Versions
| Method | Path | Quyền |
|---|---|---|
| GET | /projects/:id/versions | VIEWER+ |
| POST | /projects/:id/versions `{label}` | EDITOR+ (API lấy state từ realtime qua Redis RPC hoặc từ ProjectDocument sau flush) |
| POST | /projects/:id/versions/:vid/restore | EDITOR+ → tạo auto-version "Before restore" rồi broadcast restore |
| GET | /projects/:id/versions/:vid/preview | VIEWER+ → state bytes (base64) để render read-only |

## Assets
| Method | Path | Quyền |
|---|---|---|
| POST | /projects/:id/assets/upload-url `{mimeType,sizeBytes,filename}` | EDITOR+ → `{assetId, putUrl, expiresIn}` |
| POST | /assets/:assetId/confirm | EDITOR+ → verify object, enqueue `asset.process` (sharp: dimension, thumbnail webp) |
| GET | /assets/:assetId/url | VIEWER+ → presigned GET (10 phút) |

## Export
| POST | /projects/:id/exports `{format:"png", scale, nodeIds?}` | VIEWER+ → `{jobId}` |
| GET | /exports/:jobId | → `{status, url?}` |

> M1 cho phép export client-side (`stage.toDataURL`); endpoint server ở M2.

## Health
`GET /health` (db, redis, s3) — dùng cho Docker healthcheck và probe.

## Mã lỗi chuẩn
`AUTH_INVALID_CREDENTIALS, AUTH_TOKEN_EXPIRED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, CONFLICT, RATE_LIMITED, ASSET_TOO_LARGE, ASSET_TYPE_NOT_ALLOWED, LAST_OWNER`.

OpenAPI tự sinh bằng `@nestjs/swagger` + `nestjs-zod` tại `/api/docs` (chỉ dev).

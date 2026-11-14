---
name: nova-api-endpoint
description: >-
  Use this skill when adding or modifying a REST endpoint, DTO, Prisma model, or permission check in NOVA STUDIO apps/api.
---

# Thêm endpoint API

1. Zod schema request/response trong `packages/shared/src/api/<domain>.ts`; export type `z.infer`.
2. Nếu đổi DB: sửa `apps/api/prisma/schema.prisma` + `docs/nova/02-DATABASE.md`, chạy `pnpm --filter api prisma migrate dev --name <x>`.
3. Controller mỏng: decorator route, `@Body(new ZodValidationPipe(schema))`, gọi service.
4. Service: `await this.permissions.assert(user, { type: 'project', id }, 'project.update')` **đầu tiên**, rồi Prisma.
   Không có quyền đọc → `NotFound` (che tồn tại); có quyền đọc nhưng không sửa → `Forbidden`.
5. Thêm action vào `can()` + ma trận `docs/nova/07-SECURITY.md` nếu là action mới.
6. Test e2e `apps/api/test/<domain>.e2e-spec.ts`: dùng `forEachRole()` helper sinh case OWNER/EDITOR/VIEWER/non-member
   từ `can()` → kỳ vọng 2xx/403/404 tự động.
7. Cập nhật bảng trong `docs/nova/03-API.md`.
8. Probe `-Scope api`.

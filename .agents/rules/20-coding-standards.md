---
trigger: glob
globs: "**/*.{ts,tsx}"
---

# Coding standards (TypeScript)

- `strict: true`, `noUncheckedIndexedAccess: true`. Không `any` (xem AGENTS.md).
- Named exports; một module = một trách nhiệm. File > 400 dòng → tách.
- Lỗi: dùng typed error (`NovaError` với `code` trong `packages/shared/errors.ts`), không throw string.
- Không `console.log` trong code commit; dùng logger (`pino` ở backend, `logger` wrapper ở web).
- Async: luôn xử lý reject; không floating promise (`@typescript-eslint/no-floating-promises`).
- Tên: `camelCase` biến/hàm, `PascalCase` type/component, `SCREAMING_SNAKE` hằng, file `kebab-case.ts`.
- React: function component, hook bắt đầu bằng `use`, state editor đọc qua selector (tránh re-render toàn canvas).
- NestJS: Controller mỏng → Service → Prisma. DTO = Zod schema từ `shared` + `ZodValidationPipe`.
- Test: Vitest (unit, packages + api service), Supertest (api e2e), Playwright (web e2e).
  Test đặt cạnh file: `foo.ts` ↔ `foo.test.ts`.
- Commit message: Conventional Commits (`feat(editor-core): ...`) kèm Task ID (`[P1-T07]`).

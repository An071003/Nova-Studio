---
trigger: always_on
---

# Ranh giới kiến trúc (import rules)

```
apps/web        → packages/{editor-core, editor-konva, shared, ui}
apps/api        → packages/shared
apps/realtime   → packages/{shared, editor-core (chỉ schema/migrations doc)}
apps/worker     → packages/shared
packages/editor-konva → packages/editor-core, packages/shared
packages/editor-core  → packages/shared, yjs   (KHÔNG React/DOM/Konva/Next)
packages/shared       → zod (KHÔNG phụ thuộc gì khác trong repo)
packages/ui           → react, tailwind, shadcn (KHÔNG business logic)
```

- `apps/*` không import lẫn nhau. Giao tiếp qua HTTP/WebSocket/queue.
- Kiểu dữ liệu dùng chung (DTO, node schema, role, permission) chỉ định nghĩa ở `packages/shared`.
- Mọi thay đổi Yjs document đi qua **command** trong `editor-core` (không `ymap.set` rải rác trong UI).
- Mọi mutation doc bọc trong `doc.transact(fn, LOCAL_ORIGIN)` để Undo/Redo và sync hoạt động đúng.
- Enforce bằng ESLint `import/no-restricted-paths` (hoặc `dependency-cruiser`) — probe sẽ fail nếu vi phạm.

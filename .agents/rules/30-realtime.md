---
trigger: model_decision
description: Áp dụng khi làm việc với Yjs, Hocuspocus, awareness/presence, undo/redo, persistence document, hoặc bất kỳ code nào trong apps/realtime và packages/editor-core.
---

# Realtime rules (Yjs + Hocuspocus)

1. Schema doc chuẩn ở `docs/nova/04-REALTIME.md`. Đổi schema → tăng `meta.schemaVersion` + viết migration.
2. Node lưu **phẳng** trong `nodes: Y.Map<id, Y.Map>`; thứ tự bằng `index` (fractional indexing string),
   cha bằng `parentId`. Không dùng `Y.Array` cho z-order (conflict khi move đồng thời).
3. Thuộc tính là field riêng trong Y.Map của node (LWW per-field) — không lưu cả object JSON 1 field.
4. Text nội dung dùng `Y.Text` để 2 người gõ cùng lúc không mất ký tự.
5. Kéo thả: cập nhật vị trí qua awareness (ephemeral) khi đang drag ở tần suất cao,
   commit vào doc khi `pointerup` (hoặc throttle ≤ 20Hz). Không spam transaction mỗi frame.
6. Undo/Redo: `Y.UndoManager` theo dõi `LOCAL_ORIGIN` của user hiện tại — chỉ undo thao tác của chính mình.
7. Awareness chỉ chứa: `user{id,name,color,avatar}`, `cursor{x,y}` (toạ độ world), `selection[]`, `tool`, `viewport`.
8. Server: `onAuthenticate` verify realtime ticket (JWT 60s); Viewer → `connection.readOnly = true`.
9. Persistence: lưu Y update vào Postgres (debounce 2s, maxDebounce 10s); snapshot phiên bản qua API.
10. Không bao giờ tin client: server reject update nếu connection readOnly; validate kích thước message (≤ 1MB).
11. Mọi tính năng realtime phải có test 2-client (Vitest với 2 Y.Doc nối nhau, hoặc Playwright 2 context).

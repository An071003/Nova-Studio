---
name: nova-realtime-feature
description: >-
  Use this skill when adding or changing any collaborative feature in NOVA STUDIO: new node type, new command,
  new node field, presence/awareness data, undo behavior, or Yjs schema changes.
---

# Thêm tính năng realtime an toàn

1. **Schema**: thêm field/type vào `packages/shared/src/doc/node.ts` (Zod) và bảng NodeField trong `docs/nova/04-REALTIME.md`.
   Field phá vỡ tương thích → tăng `schemaVersion`, viết `editor-core/src/model/migrations/v<N>.ts` + test.
2. **Command**: tạo `editor-core/src/commands/<name>.ts` — hàm thuần `(editor, args) => void`, bên trong `doc.transact(..., LOCAL_ORIGIN)`.
   Không đọc DOM/Konva.
3. **Convergence test** (`<name>.convergence.test.ts`): dùng helper `createPeers(n)` trong `editor-core/test/peers.ts`
   (nối các Y.Doc bằng `on('update') → applyUpdate`, hỗ trợ `pause()/resume()` để mô phỏng offline). Phải có:
   - 2 peer thao tác đồng thời → state cuối giống nhau (`Y.encodeStateVector` + so JSON scene).
   - Peer offline thao tác rồi resume → merge đúng.
   - Undo trên peer A không hoàn tác thao tác của B.
4. **Renderer**: map field trong `editor-konva/src/nodes/<type>.ts`; chỉ cập nhật thuộc tính thay đổi từ `SceneDiff`.
5. **UI**: control trong Properties panel; disable khi `!can(role, 'canvas.edit')`.
6. **E2E**: thêm/cập nhật kịch bản trong `harness/evals/` nếu là hành vi người dùng thấy được.
7. Probe: `-Scope editor-core` rồi `-Scope e2e`.

## Gotchas thường gặp
- Quên origin → UndoManager không bắt hoặc bắt cả remote.
- Set cả object vào 1 key → mất merge per-field.
- Dùng array index cho z-order → conflict khi move đồng thời (dùng fractional index).
- Tạo Y.Text ngoài transaction rồi mới gắn vào map → lỗi "Invalid access: Add Yjs type to a document before reading data".

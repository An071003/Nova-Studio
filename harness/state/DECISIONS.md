# DECISIONS — Architecture Decision Records

Mẫu:
```
## ADR-NNN: <tiêu đề>  (YYYY-MM-DD, status: accepted|superseded by ADR-x)
Context: ...
Decision: ...
Consequences: ...
Alternatives considered: ...
```

## ADR-001: Yjs + Hocuspocus thay vì Liveblocks  (2026-11-14, accepted)
Context: Cần realtime canvas, tự host, không phụ thuộc vendor, chi phí thấp khi scale.
Decision: Yjs CRDT + Hocuspocus server tự host, persist Postgres.
Consequences: Tự làm presence UI, comments (Phase sau), version history. Có thể chuyển Liveblocks nếu cần tốc độ (doc model giữ Yjs).
Alternatives: Liveblocks (nhanh hơn, có comments/history sẵn, trả phí), Automerge.

## ADR-002: Konva cho renderer MVP, sau abstraction `Renderer`  (2026-11-14, accepted)
Context: Cần canvas 2D nhanh để ra MVP; tương lai có thể cần WebGL cho ảnh lớn/video.
Decision: Konva trong `packages/editor-konva`; editor-core headless.
Alternatives: Fabric.js (model object riêng khó bind CRDT), PixiJS (WebGL, text kém hơn), CanvasKit/Skia (nặng).

## ADR-003: Lưu node phẳng + fractional index  (2026-11-14, accepted)
Context: Reorder/move đồng thời bằng Y.Array dễ trùng/mất node.
Decision: `nodes: Y.Map<id, Y.Map>` + `parentId` + `index` (fractional-indexing).

## ADR-004: Phase 1 quy mô Production-ready chia M1 (MVP) / M2  (2026-11-14, accepted)
Context: Người dùng đưa 3 lựa chọn quy mô; Production-ready cân bằng giữa chạy thật và phạm vi.
Decision: M1 MVP có gate riêng, M2 bổ sung phân quyền, lịch sử, bảo mật, deploy. Advanced Studio → backlog.

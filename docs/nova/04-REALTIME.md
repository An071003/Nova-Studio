# 04 — REALTIME (Yjs + Hocuspocus)

## Document name
`project:<projectId>` — một Y.Doc / project. Phase 1: một page duy nhất `page:main` (schema sẵn sàng nhiều page).

## Schema Y.Doc (schemaVersion = 1)
```
doc.getMap("meta")      : { schemaVersion: 1, createdAt, title? }
doc.getMap("pages")     : Y.Map<pageId, Y.Map{ id, name, index, background }>
doc.getMap("nodes")     : Y.Map<nodeId, Y.Map<NodeField>>
```

### NodeField (mỗi field một key → merge LWW theo field)
| key | type | ghi chú |
|---|---|---|
| id | string | nanoid |
| type | `"rect" \| "ellipse" \| "line" \| "text" \| "image" \| "group" \| "frame"` | |
| pageId | string | |
| parentId | string \| null | group/frame cha |
| index | string | fractional index (`fractional-indexing`) cho z-order trong cùng parent |
| name | string | |
| x, y, width, height, rotation | number | toạ độ world, rotation độ |
| opacity | number 0..1 | |
| visible, locked | boolean | |
| fill | string (hex/rgba) \| null | |
| stroke | string \| null; strokeWidth number | |
| cornerRadius | number | rect/frame |
| points | number[] | line |
| text | **Y.Text** | text node |
| fontFamily, fontSize, fontWeight, align, lineHeight | | text |
| assetId | string | image |
| createdBy, updatedAt | string, number | |

Zod schema tương ứng: `packages/shared/src/doc/node.ts` — editor-core validate khi đọc (node hỏng → bỏ qua render + log).

## Commands (editor-core)
Tất cả mutation đi qua `CommandBus.execute(cmd)`:
`createNode, updateNodes(patch[]), deleteNodes, moveNodes(dx,dy), reorder(nodeId, beforeIndex|afterIndex),
group(ids), ungroup(id), setText, alignNodes(mode), distributeNodes(axis), duplicate(ids), pasteNodes`.
Mỗi command: `doc.transact(() => …, LOCAL_ORIGIN)`. Command thuần, test được bằng 2 Y.Doc.

## Awareness (ephemeral)
```ts
type Presence = {
  user: { id: string; name: string; color: string; avatarUrl?: string };
  cursor: { x: number; y: number } | null;   // world coords
  selection: string[];
  tool: ToolId;
  dragging?: { ids: string[]; dx: number; dy: number }; // preview drag của người khác
  viewport?: { x: number; y: number; zoom: number };     // dùng cho "follow user"
};
```
Cursor throttle 30Hz (`requestAnimationFrame` + throttle). Ẩn cursor sau 10s idle.

## Conflict semantics (phải test)
| Tình huống | Kết quả mong đợi |
|---|---|
| A đổi fill, B đổi x cùng node | Cả hai giữ |
| A, B cùng đổi fill | LWW (clientID cao hơn thắng) — chấp nhận, nhất quán mọi client |
| A xoá node, B đang sửa node | Node bị xoá; B nhận toast "Node đã bị xoá bởi A", selection của B tự bỏ |
| A, B cùng reorder | Fractional index không trùng (thêm jitter clientID) |
| A, B gõ cùng text | Y.Text merge ký tự |
| A offline sửa 30s rồi online | Merge, không mất thao tác |
| Cùng chọn 1 node | Cho phép; hiển thị viền màu người kia + nhãn tên (không lock cứng ở Phase 1) |

## Server (apps/realtime)
- Extensions: `Database` (fetch/store Postgres), `Logger`, `Redis` (khi scale), `Throttle`.
- `onAuthenticate({token})`: verify ticket HS256 (secret riêng `REALTIME_JWT_SECRET`), check `projectId` khớp document name.
  role VIEWER → `connection.readOnly = true`.
- `onStoreDocument`: debounce 2000ms, maxDebounce 10000ms; ghi `ProjectDocument.state`.
- Restore version: API publish Redis `nova:restore:<projectId>` → realtime thay nội dung doc trong 1 transaction (origin `"restore"`)
  — client nhận như update bình thường; UndoManager của client clear stack.
- Giới hạn: message ≤ 1MB; ≤ 50 connection / doc (config).
- Metrics: số connection, số doc mở, store latency (log pino JSON).

## Client
- `HocuspocusProvider` + `IndexeddbPersistence` (y-indexeddb) để offline.
- Trạng thái kết nối: `connecting | connected | offline | reconnecting` → badge góc trên.
- Ticket hết hạn khi reconnect → gọi lại API lấy ticket mới (`onAuthenticationFailed`).

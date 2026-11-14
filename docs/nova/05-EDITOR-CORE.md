# 05 — EDITOR-CORE (headless engine)

## API công khai
```ts
// packages/editor-core/src/index.ts
export class Editor {
  constructor(opts: { doc: Y.Doc; userId: string; awareness?: Awareness });
  readonly commands: CommandBus;
  readonly selection: SelectionStore;      // local + remote selections
  readonly history: HistoryManager;        // Y.UndoManager wrapper (LOCAL_ORIGIN)
  readonly viewport: ViewportStore;        // pan/zoom, screen<->world
  readonly tools: ToolManager;             // select, rect, ellipse, line, text, hand, image
  readonly scene: SceneGraph;              // read-model: tree sorted by index, hit-test, bounds
  subscribe(event: EditorEvent, cb): Unsubscribe;
  destroy(): void;
}
export interface Renderer {               // implemented by editor-konva
  mount(el: HTMLElement): void;
  render(diff: SceneDiff): void;
  setViewport(v: Viewport): void;
  hitTest(screenPt: Point): string | null;
  exportPNG(opts: ExportOpts): Promise<Blob>;
  destroy(): void;
}
```

## Module
| Module | Trách nhiệm |
|---|---|
| `model/` | Đọc/ghi node từ Y.Map, validate Zod, factory node mặc định |
| `commands/` | Command thuần (xem 04-REALTIME) |
| `scene/` | Cây hiển thị, `observeDeep` → `SceneDiff` (added/updated/removed) incremental |
| `geometry/` | Bounds, transform matrix, rotate/resize với giữ tỉ lệ (Shift), hit-test |
| `snapping/` | Snap cạnh/tâm với node khác & lưới, ngưỡng 6px screen |
| `tools/` | State machine từng tool (pointerdown/move/up, keyboard) |
| `history/` | UndoManager, group thao tác (captureTimeout 500ms) |
| `clipboard/` | Serialize node ↔ JSON (`application/x-nova+json`), paste offset |
| `presence/` | Map awareness ↔ store remote cursors/selections |

## Hiệu năng
- Diff incremental; không rebuild cả scene khi 1 field đổi.
- Hit-test dùng spatial index (`rbush`) khi > 200 node.
- Benchmark Vitest bench: tạo 1.000 node < 200ms; apply 100 remote update < 16ms.

## Phím tắt (ToolManager)
V select · H hand (Space giữ) · R rect · O ellipse · L line · T text · ⌘/Ctrl+Z / Shift+Z · ⌘D duplicate ·
⌘G / ⌘⇧G group/ungroup · Del xoá · ⌘C/⌘V · mũi tên di chuyển 1px (Shift 10px) · ⌘] / ⌘[ z-order ·
⌘0 zoom 100% · ⇧1 fit · ⌘A chọn tất cả · Esc bỏ chọn.

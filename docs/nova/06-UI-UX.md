# 06 — UI/UX: "Creative Dark Studio"

Cảm giác cao cấp như phần mềm chuyên nghiệp, thao tác trực quan như Figma.

## Design tokens (CSS variables trong `packages/ui/src/tokens.css`)
| Token | Giá trị | Dùng cho |
|---|---|---|
| `--bg-app` | `#0B0C0F` | nền ứng dụng |
| `--bg-panel` | `#14161B` | sidebar, panel |
| `--bg-elevated` | `#1C1F26` | popover, menu |
| `--bg-canvas` | `#1A1A1E` + lưới chấm `#2A2D35` | vùng canvas |
| `--border` | `#262A33` | đường viền 1px |
| `--text-primary` | `#E8EAF0` | |
| `--text-secondary` | `#9AA1B2` | |
| `--accent` | `#7C5CFF` (tím NOVA) | selection, CTA |
| `--accent-2` | `#22D3EE` | focus, highlight |
| `--danger` / `--success` / `--warning` | `#F43F5E` / `#22C55E` / `#F59E0B` | |
| Radius | 6px (control), 10px (panel), 14px (modal) | |
| Font | Inter (UI), JetBrains Mono (số liệu) — 12/13/14/16/20/28 | |
| Spacing | thang 4px | |
| Màu presence | 10 màu cố định: `#F87171 #FB923C #FACC15 #4ADE80 #2DD4BF #60A5FA #A78BFA #F472B6 #E879F9 #94A3B8` | gán theo hash userId |

Light theme: ngoài phạm vi Phase 1 (token đã tách sẵn).

## Màn hình
1. **Auth** — login/register, card giữa màn hình, nền gradient tối mờ.
2. **Dashboard** — sidebar workspace; lưới project (thumbnail 16:10, tên, sửa lần cuối, avatar người online); nút "New design"; tìm kiếm.
3. **Members** — bảng thành viên, đổi role (select), mời (dialog: email + role, copy link).
4. **Editor** (bố cục chính):
```
┌───────────────────────────────────────────────────────────────┐
│ TopBar: ◆ NOVA / Project name ▾ | toolbar công cụ | avatars ● 3 online | Share | Export │
├────────────┬───────────────────────────────────┬──────────────┤
│ LEFT 240px │           CANVAS                  │ RIGHT 280px  │
│ Layers     │  (pan/zoom, cursors có tên,       │ Properties:  │
│ Assets     │   selection màu người khác)       │ X Y W H R    │
│            │                                   │ Fill Stroke  │
│            │                    [zoom 100% ▾]  │ Opacity Text │
│            │                                   │ Align        │
├────────────┴───────────────────────────────────┴──────────────┤
│ StatusBar: ● Connected · Saved 2s ago · v12                   │
└───────────────────────────────────────────────────────────────┘
```
5. **Version history** — drawer phải: danh sách version (auto/tên), preview read-only, nút Restore (confirm dialog).
6. **Share dialog** — mời, role, copy link.

## Hành vi multiplayer
- Cursor: mũi tên màu user + nhãn tên bo tròn; mượt bằng nội suy (lerp) 60fps.
- Selection người khác: viền 1.5px màu user + nhãn nhỏ góc trên-trái.
- Click avatar → "Follow" viewport người đó; thao tác bất kỳ → thoát follow.
- Toast khi node đang chọn bị người khác xoá. Badge "Viewer — chỉ xem" khi read-only.
- Offline: banner vàng "Đang offline — thay đổi sẽ được đồng bộ khi kết nối lại".

## Micro-interactions
Transition 120–180ms ease-out; không animation khi `prefers-reduced-motion`.

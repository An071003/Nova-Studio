# 00 — GOAL: NOVA STUDIO Phase 1 — Collaborative Canvas

## Tầm nhìn
NOVA STUDIO là Multiplayer Creative Workspace trên trình duyệt (Photoshop + Figma + Premiere + AI Studio).
**Phase 1** chỉ xây nền tảng: một **canvas thiết kế 2D cộng tác realtime** chạy thật, đủ chắc để mở rộng
sang Video Studio (Phase 2) và Production Studio (Phase 3).

## Người dùng mục tiêu
Agency marketing, studio nhỏ, team social media (2–10 người cùng lúc / file, mục tiêu kiến trúc 20).

## Quy mô: Production-ready (chia 2 mốc)
| Mốc | Nội dung | Gate |
|---|---|---|
| **M1 — MVP** | Auth, workspace, project, canvas (rect/ellipse/line/text/image), layer, transform, realtime + cursor, autosave | Eval E1–E5 PASS |
| **M2 — Production** | Phân quyền Owner/Editor/Viewer, mời thành viên, version history, undo/redo đa người, bảo mật, test, CI, Docker deploy | Eval E1–E12 PASS + QA gate |
| *Ngoài phạm vi* | Comment, plugin, video, AI, desktop app, vector pen tool, mask nâng cao | Ghi vào backlog |

## User stories cốt lõi (M1+M2)
1. Đăng ký / đăng nhập email+password.
2. Tạo workspace (team), mời thành viên bằng email/link, gán role.
3. Tạo / đổi tên / xoá / nhân bản project; dashboard có thumbnail.
4. Trên canvas: vẽ rect, ellipse, line, text; kéo thả ảnh vào; chọn, di chuyển, resize, xoay;
   chỉnh fill, stroke, opacity, corner radius, font; align/distribute; group/ungroup; lock/hide.
5. Panel layer: sắp xếp z-order kéo thả, đổi tên, ẩn/khoá.
6. Pan/zoom vô hạn, snap cơ bản, phím tắt.
7. Nhiều người cùng chỉnh: thấy cursor có tên/màu, thấy selection của nhau, thay đổi ≤ 150ms (LAN/same region).
8. Undo/Redo chỉ thao tác của mình.
9. Autosave; mất mạng → tiếp tục sửa offline, reconnect tự merge.
10. Version history: tạo snapshot tên, xem, khôi phục.
11. Export PNG khung (frame) hoặc toàn bộ.
12. Viewer chỉ xem (thấy cursor người khác), không sửa.

## Non-functional
- p95 sync latency ≤ 150ms; canvas 60fps với 500 node; load project 1.000 node ≤ 2s.
- Không mất dữ liệu khi server realtime restart (persist ≤ 10s).
- Lighthouse a11y ≥ 90 trên dashboard. Test coverage ≥ 80% cho `editor-core`, ≥ 70% api.

## Definition of Done (Phase 1)
Toàn bộ task trong `08-TASKS.md` DONE, `harness/evals/` E1–E12 PASS, QA gate trong `09-QA.md` xanh,
`docker compose up` chạy được toàn hệ thống từ máy sạch theo `10-DEPLOYMENT.md`.

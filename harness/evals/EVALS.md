# Evals — kịch bản nghiệm thu (Playwright, `apps/web/e2e/evals/<EID>.spec.ts`)

Mỗi eval là bằng chứng cho Gate. Agent không được sửa tiêu chí PASS; chỉ thêm eval mới (ghi HARNESS_CHANGELOG).

| EID | Mốc | Kịch bản | PASS khi |
|---|---|---|---|
| E1 | M1 | User A đăng ký, tạo workspace + project, vẽ rect, reload trang | Rect còn nguyên vị trí/màu sau reload |
| E2 | M1 | A và B mở cùng project; A tạo 3 shape, B di chuyển 1 shape, A đổi màu shape đó | Scene JSON của A và B bằng nhau ≤ 1s; shape có màu mới + vị trí mới |
| E3 | M1 | A di chuột trên canvas | B thấy cursor có tên A, đúng màu, sai lệch ≤ 2px world sau khi dừng |
| E4 | M1 | A chọn shape X | B thấy viền selection màu A trên X; A bỏ chọn → viền mất |
| E5 | M1 | A kéo thả file PNG 2MB vào canvas | Image node xuất hiện ở A và B; asset READY; file 30MB bị từ chối có thông báo |
| E6 | M2 | Owner mời C (editor) bằng link; C chấp nhận; Owner đổi C → viewer | C mở được project; sau đổi role, reconnect ở chế độ read-only |
| E7 | M2 | Viewer V mở project, thử kéo shape / xoá / gõ text; gửi update Yjs thủ công qua console hook | Không thay đổi nào ở A; UI hiện badge "Viewer" |
| E8 | M2 | A tạo version "v1", sửa 5 thay đổi, restore "v1" khi B đang mở | A, B đều về đúng state v1; có auto-version "Before restore" |
| E9 | M2 | B offline, sửa 3 shape; A sửa 2 shape khác; B online | Cả 5 thay đổi có mặt ở cả hai |
| E10 | M2 | A, B cùng gõ vào một text node; A undo | Text chứa ký tự của cả hai; undo của A chỉ bỏ phần A gõ |
| E11 | M2 | Export PNG 2× một frame | File PNG đúng kích thước, pixel so với golden image sai khác ≤ 1% |
| E12 | M2 | 10 client (headless) cùng project 1.000 node, mỗi client 5 thao tác/s trong 60s | p95 latency ≤ 150ms, không lỗi, scene hội tụ; load ≤ 2s |

Chạy: `pnpm --filter web e2e:evals --grep "E[1-5]"` (M1) / toàn bộ (M2). Screenshot → `harness/evals/screenshots/`.
